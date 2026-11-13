const formData = require("form-data");
const Mailgun = require("mailgun.js");

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
  } catch (err) {
    console.error("Order email failed:", err && err.message);
  }
};

const STATUS_COPY = {
  Dispatched: "is on its way",
  Delivered: "has been delivered",
  Cancelled: "has been cancelled",
};

// Tells the customer when the showroom moves their order along. Never throws.
exports.sendStatusUpdate = async (order) => {
  const mg = getClient();
  const copy = STATUS_COPY[order && order.orderStatus];
  if (!mg || !copy || !order.userEmail) return;
  const orderNo = String(order._id).slice(-8).toUpperCase();
  try {
    await mg.messages.create(process.env.MAILGUN_DOMIAN, {
      from: "First Impression <meher@firstimp.in>",
      to: order.userEmail,
      subject: `Your order ${orderNo} ${copy}`,
      text: [
        `Your First Impression order ${orderNo} ${copy}.`,
        "",
        "See the details any time under My account > Orders:",
        "https://firstimp.in/user/history",
        "",
        "Questions? Call 7777045811 or reply to meher@firstimp.in.",
        "",
        "First Impression, Kemps Corner, Mumbai",
      ].join("\n"),
    });
  } catch (err) {
    console.error("Status email failed:", err && err.message);
  }
};
