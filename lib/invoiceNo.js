const Counter = require("../models/counter");

// Indian financial year (April-March, IST) of a date: 13 Nov 2026 -> "26-27".
const financialYear = (date) => {
  const [y, m] = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "numeric" })
    .formatToParts(date).filter((p) => p.type !== "literal").map((p) => Number(p.value));
  const start = m >= 4 ? y : y - 1;
  return `${String(start).slice(2)}-${String(start + 1).slice(2)}`;
};

// Next number in the website's own consecutive series for that year, e.g.
// "FIF/WEB/1/26-27". Kept apart from the showroom's Tally series (FIF/19/22-23)
// so the two can never collide. Restarts at 1 every April.
exports.nextInvoiceNo = async (date = new Date()) => {
  const fy = financialYear(date);
  const { seq } = await Counter.findOneAndUpdate(
    { _id: `invoice:${fy}` },
    { $inc: { seq: 1 } },
    { new: true, upsert: true }
  ).lean();
  return `FIF/WEB/${seq}/${fy}`;
};
exports.financialYear = financialYear;
