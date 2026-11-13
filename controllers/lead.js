const Lead = require("../models/lead");
const Product = require("../models/product");
const { sendLeadEmails } = require("../lib/mailer");

// Public: sample request, enquiry, visit booking or back-in-stock request.
exports.create = async (req, res) => {
  const { type, name, email, phone, address, message, products = [], visit } = req.body;
  const found = products.length
    ? await Product.find({ _id: { $in: products } }).select("title slug quantity").lean()
    : [];
  if (products.length && !found.length) return res.status(400).json({ err: "Product not found." });

  if (type === "restock") {
    // One open request per person and product is enough.
    const open = await Lead.exists({ type, email: email.toLowerCase(), status: "new", "products.product": found[0]._id });
    if (open) return res.json({ ok: true });
  }

  // At most one acknowledgement per address per day (the form is public).
  const recent = await Lead.countDocuments({ email: email.toLowerCase(), createdAt: { $gt: new Date(Date.now() - 864e5) } });
  const lead = await new Lead({
    type, name, email, phone, address, message, visit,
    products: found.map((p) => ({ product: p._id, title: p.title, slug: p.slug })),
  }).save();
  sendLeadEmails(lead, { acknowledge: recent === 0 });
  res.json({ ok: true });
};

exports.list = async (req, res) => res.json(await Lead.find({}).sort({ createdAt: -1 }).limit(1000).lean());

exports.update = async (req, res) => {
  const { status, notes } = req.body;
  const lead = await Lead.findByIdAndUpdate(req.params.id, { ...(status && { status }), ...(notes !== undefined && { notes }) }, { new: true }).lean();
  res.status(lead ? 200 : 404).json(lead || { err: "Not found." });
};
