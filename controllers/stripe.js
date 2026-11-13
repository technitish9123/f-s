const User = require("../models/user");
const { getStripe, toPaise } = require("../lib/stripe");
const { loadCart, stockProblems, paymentMatches, placeOrder } = require("../lib/orders");
const { id } = require("../lib/validate");
const { log } = require("../lib/log");

exports.createPaymentsInteg = async (req, res) => {
  const { couponApplied, shippingAdd } = req.body;

  const user = await User.findOne({ email: req.user.email }).select("_id").lean();
  const cart = user && (await loadCart({ orderedBy: user._id }));
  if (!cart || !cart.products.length) return res.status(400).json({ err: "Your bag is empty." });

  const problems = stockProblems(cart);
  if (problems.length) return res.status(409).json({ err: problems.join(" ") });

  const { cartTotal, totalAfterDiscount } = cart;
  // Stripe needs whole paise; discounted totals can have fractions.
  const payable = toPaise(couponApplied && totalAfterDiscount ? totalAfterDiscount : cartTotal);

  let payment;
  try {
    payment = await getStripe().paymentIntents.create({
      amount: payable,
      currency: "inr",
      // The checkout uses Stripe's card field, so ask for cards explicitly (newer
      // Stripe versions otherwise expect payment methods enabled in the dashboard).
      payment_method_types: ["card"],
      // Ties the payment to this customer and cart; the webhook also needs the
      // shipping address in case the browser never reports back.
      metadata: {
        userId: String(user._id),
        cartId: String(cart._id),
        ...(shippingAdd && { shipping: JSON.stringify(shippingAdd).slice(0, 500) }),
      },
    });
  } catch (err) {
    log("error", { id: req.id, event: "stripe_create_failed", err: err.message });
    return res.status(502).json({ err: "Payments are unavailable right now. Please try again in a few minutes." });
  }

  res.send({ clientSecret: payment.client_secret, cartTotal, totalAfterDiscount, payable });
};

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
