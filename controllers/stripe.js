const User = require("../models/user");
const { getStripe } = require("../lib/stripe");
const { loadCart, paymentMatches, placeOrder } = require("../lib/orders");
const { id } = require("../lib/validate");
const { log } = require("../lib/log");

// Stripe -> us. Records the order even if the customer closed the tab right
// after paying. Signed by Stripe; needs STRIPE_WEBHOOK_SECRET.
exports.webhook = async (req, res) => {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) return res.status(503).json({ err: "Webhook not configured." });

  let event;
  try {
    event = getStripe().webhooks.constructEvent(req.body, req.headers["stripe-signature"], secret);
  } catch (err) {
    return res.status(400).json({ err: "Invalid signature." });
  }

  if (event.type === "payment_intent.succeeded") {
    const payment = event.data.object;
    const { userId, cartId, shipping } = payment.metadata || {};
    const ok = id(userId) && id(cartId);
    const [user, cart] = ok ? await Promise.all([
      User.findById(userId).select("_id email"),
      loadCart({ _id: cartId, orderedBy: userId }),
    ]) : [];
    // No cart means the browser already placed the order (it empties the cart).
    if (user && cart && cart.products.length && paymentMatches(payment, user, cart)) {
      let shippingAdd;
      try { shippingAdd = shipping ? JSON.parse(shipping) : undefined; } catch { /* truncated: leave empty */ }
      const created = await placeOrder({ user, cart, payment, shippingAdd });
      if (created) log("info", { event: "order_from_webhook", payment: payment.id });
    }
  }
  res.json({ received: true });
};
