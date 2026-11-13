const formData = require("form-data");
const Mailgun = require("mailgun.js");
const { log } = require("./log");

const inr = (n) => `Rs. ${Number(n || 0).toLocaleString("en-IN")}`;

let client;
const getClient = () => {
  if (!process.env.MAILGUN_API_KEY || !process.env.MAILGUN_DOMIAN) return null;
  if (!client) client = new Mailgun(formData).client({ username: "api", key: process.env.MAILGUN_API_KEY });
  return client;
};

/*
 * Order confirmation. Never throws: a mail failure must not fail the order,
 * which has already been paid for.
 */
exports.sendOrderConfirmation = async (order, items) => {
  const mg = getClient();
  if (!mg || !order.userEmail) return;

  const orderNo = String(order._id).slice(-8).toUpperCase();
  const ship = (order.paymentIntent && order.paymentIntent.shippingAdd) || {};
  const amount = order.paymentIntent && order.paymentIntent.paymentInfo
    && order.paymentIntent.paymentInfo.stripeResponse
    && order.paymentIntent.paymentInfo.stripeResponse.amount;

  const lines = items.map((i) => `  ${i.title}  x ${i.count}  ${inr(i.price * i.count)}`).join("\n");
  const text = [
    `Thank you for your order${ship.name ? `, ${ship.name}` : ""}.`,
    "",
    `Order ${orderNo}`,
    ...(order.invoiceNo ? [`Invoice ${order.invoiceNo}`] : []),
    "",
    lines,
    "",
    `Total paid: ${amount ? inr(amount / 100) : "-"}`,
    "",
    ship.add ? `Delivering to:\n  ${ship.add}${ship.mobileNum ? `\n  ${ship.mobileNum}` : ""}\n` : "",
    "We'll email you again when your order is dispatched.",
    "You can follow it any time under My account > Orders at https://firstimp.in/user/history",
    "",
    "First Impression",
    "8-11 Om Chambers, Kemps Corner, Mumbai 400036",
    "7777045811 · meher@firstimp.in",
  ].join("\n");

  try {
    await mg.messages.create(process.env.MAILGUN_DOMIAN, {
      from: "First Impression <meher@firstimp.in>",
      to: order.userEmail,
      subject: `Your First Impression order ${orderNo}`,
      text,
    });
    log("info", { event: "order_email_sent", order: String(order._id) });
  } catch (err) {
    log("error", { event: "order_email_failed", order: String(order._id), err: err && err.message });
  }
};

const SIGNATURE = ["", "First Impression", "8-11 Om Chambers, Kemps Corner, Mumbai 400036", "7777045811 · meher@firstimp.in"];
const BUSINESS = () => process.env.BUSINESS_EMAIL || "meher@firstimp.in";
const SITE = "https://firstimp.in";

// Plain-text email. Never throws: mail must never fail the request it follows.
const send = async (to, subject, lines, event) => {
  const mg = getClient();
  if (!mg || !to) return false;
  try {
    await mg.messages.create(process.env.MAILGUN_DOMIAN, {
      from: "First Impression <meher@firstimp.in>",
      to,
      subject,
      text: lines.filter((l) => l !== null && l !== undefined).join("\n"),
    });
    log("info", { event: `${event}_sent` });
    return true;
  } catch (err) {
    log("error", { event: `${event}_failed`, err: err && err.message });
    return false;
  }
};
exports.send = send;

const STATUS_COPY = {
  Processing: "is being prepared",
  Dispatched: "is on its way",
  Delivered: "has been delivered",
  Cancelled: "has been cancelled",
};

// Tells the customer when the showroom moves their order along.
exports.sendStatusUpdate = (order) => {
  const copy = STATUS_COPY[order && order.orderStatus];
  if (!copy || !order.userEmail) return;
  const orderNo = String(order._id).slice(-8).toUpperCase();
  const t = order.tracking || {};
  return send(order.userEmail, `Your order ${orderNo} ${copy}`, [
    `Your First Impression order ${orderNo} ${copy}.`,
    ...(order.orderStatus === "Dispatched" && (t.courier || t.number)
      ? ["", `Courier: ${t.courier || "-"}`, `Tracking number: ${t.number || "-"}`, t.url ? `Track it: ${t.url}` : null]
      : []),
    ...(order.refund && order.refund.amount
      ? ["", `A refund of ${inr(order.refund.amount)} has been issued to your card. It usually appears within 5-7 working days.`]
      : []),
    "",
    "See the details any time under My account > Orders:",
    `${SITE}/user/history`,
    ...SIGNATURE,
  ], "status_email");
};

const LEAD_TITLE = { sample: "Sample request", enquiry: "Product enquiry", visit: "Visit booking", restock: "Back-in-stock request" };

// New lead -> showroom inbox, and a short acknowledgement to the customer.
exports.sendLeadEmails = (lead, { acknowledge = true } = {}) => {
  const items = (lead.products || []).map((p) => `  - ${p.title}${p.slug ? ` (${SITE}/product/${p.slug})` : ""}`);
  const v = lead.visit || {};
  send(BUSINESS(), `${LEAD_TITLE[lead.type]}: ${lead.name || lead.email}`, [
    `${LEAD_TITLE[lead.type]} from the website`,
    "",
    `Name: ${lead.name || "-"}`,
    `Email: ${lead.email || "-"}`,
    `Phone: ${lead.phone || "-"}`,
    lead.address ? `Address: ${lead.address}` : null,
    v.date ? `Visit: ${v.date} ${v.slot || ""} (${v.mode === "video" ? "video call" : "at the showroom"})` : null,
    ...(items.length ? ["", "Products:", ...items] : []),
    lead.message ? `\nMessage:\n${lead.message}` : null,
    "",
    `Manage leads: ${SITE}/admin/leads`,
  ], "lead_business_email");

  if (lead.type === "restock" || !acknowledge) return; // the restock email itself is the reply
  const ack = {
    sample: "We've received your sample request and will dispatch the swatches within 2-3 working days.",
    enquiry: "We've received your enquiry. Our team will get back to you within one working day.",
    visit: `We've noted your ${v.mode === "video" ? "video consultation" : "showroom visit"} on ${v.date} (${v.slot}). We'll call you to confirm.`,
  }[lead.type];
  // Sent to an address nobody has verified, so it carries only our own wording
  // and catalogue data, never text typed into the form.
  send(lead.email, `${LEAD_TITLE[lead.type]} received - First Impression`, [
    "Thank you for contacting First Impression.", "", ack, ...(items.length ? ["", ...items.map((i) => i.replace(/ \(.*\)$/, ""))] : []),
    "", "If you didn't make this request, please ignore this email.", ...SIGNATURE,
  ], "lead_ack_email");
};

// "It's back" email for one product.
exports.sendRestockEmail = (lead, product) =>
  send(lead.email, `${product.title} is back in stock`, [
    `Good news${lead.name ? `, ${lead.name}` : ""}: ${product.title} is available again.`,
    "",
    `${SITE}/product/${product.slug}`,
    ...SIGNATURE,
  ], "restock_email");
