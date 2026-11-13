const User = require("../models/user");
const Order = require("../models/order");
const { getStripe, toPaise } = require("../lib/stripe");
const { loadCart, stockProblems, paymentMatches, placeOrder, couponProblem } = require("../lib/orders");
const Coupon = require("../models/coupon");
const Cart = require("../models/cart");
const { id } = require("../lib/validate");
const { log } = require("../lib/log");

// Where Stripe sends the customer back to: the site they came from, if it is ours.
const SITES = [/^https:\/\/(www\.)?firstimp\.in$/, /^https:\/\/f-c(-[a-z0-9-]+)?\.onrender\.com$/, /^http:\/\/localhost:\d+$/];
const siteOf = (req) => {
  const origin = (req.headers && req.headers.origin) || "";
  return SITES.some((re) => re.test(origin)) ? origin : "https://firstimp.in";
};

/*
 * Stripe-hosted checkout: the customer pays on checkout.stripe.com and comes
 * back to /payment/complete. Needs only the secret key.
 */
exports.createCheckoutSession = async (req, res) => {
  const { couponApplied, shippingAdd } = req.body;

  const user = await User.findOne({ email: req.user.email }).select("_id email").lean();
  const cart = user && (await loadCart({ orderedBy: user._id }));
  if (!cart || !cart.products.length) return res.status(400).json({ err: "Your bag is empty." });

  const problems = stockProblems(cart);
  if (problems.length) return res.status(409).json({ err: problems.join(" ") });

  let discounted = couponApplied && cart.totalAfterDiscount && cart.totalAfterDiscount < cart.cartTotal;
  if (discounted) {
    // Rules are checked again right before charging (the coupon may have run out meanwhile).
    const problem = await couponProblem(await Coupon.findOne({ name: cart.coupon }).lean(), user._id, cart.cartTotal);
    if (problem) {
      await Cart.updateOne({ _id: cart._id }, { $unset: { totalAfterDiscount: 1, coupon: 1 } });
      return res.status(409).json({ err: `${problem} Your bag is back to the full price.`, couponRemoved: true });
    }
  }
  const payable = toPaise(discounted ? cart.totalAfterDiscount : cart.cartTotal);
  const items = cart.products.filter((p) => p.product);
  let lineItems = items.map((p) => ({
    price_data: { currency: "inr", product_data: { name: p.product.title }, unit_amount: toPaise(p.product.price) },
    quantity: p.count,
  }));
  // With a coupon (or any rounding difference) charge one line for the exact total.
  if (discounted || lineItems.reduce((t, l) => t + l.price_data.unit_amount * l.quantity, 0) !== payable) {
    lineItems = [{
      price_data: {
        currency: "inr",
        product_data: {
          name: "First Impression order",
          description: `${items.map((p) => `${p.product.title} x ${p.count}`).join(", ").slice(0, 400)}${cart.coupon ? ` (coupon ${cart.coupon})` : ""}`,
        },
        unit_amount: payable,
      },
      quantity: 1,
    }];
  }

  const metadata = {
    userId: String(user._id),
    cartId: String(cart._id),
    ...(shippingAdd && { shipping: JSON.stringify(shippingAdd).slice(0, 500) }),
  };
  const site = siteOf(req);
  try {
    const session = await getStripe().checkout.sessions.create({
      mode: "payment",
      payment_method_types: ["card"],
      line_items: lineItems,
      customer_email: (shippingAdd && shippingAdd.email) || user.email,
      client_reference_id: String(cart._id),
      metadata,
      payment_intent_data: { metadata, description: "First Impression order" },
      success_url: `${site}/payment/complete?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${site}/checkout?cancelled=1`,
    });
    res.json({ url: session.url, payable });
  } catch (err) {
    log("error", { id: req.id, event: "stripe_session_failed", err: err.message });
    res.status(502).json({ err: "Payments are unavailable right now. Please try again in a few minutes." });
  }
};

// The customer is back from Stripe: record the order (if the webhook hasn't yet).
exports.confirmCheckoutSession = async (req, res) => {
  let session;
  try {
    session = await getStripe().checkout.sessions.retrieve(req.params.id, { expand: ["payment_intent"] });
  } catch (err) {
    return res.status(404).json({ err: "Payment not found." });
  }
  const user = await User.findOne({ email: req.user.email }).select("_id email").lean();
  const payment = session.payment_intent;
  if (!user || !payment || (session.metadata || {}).userId !== String(user._id)) {
    return res.status(404).json({ err: "Payment not found." });
  }
  if (session.payment_status !== "paid" || payment.status !== "succeeded") return res.json({ paid: false });

  const summary = (order) => ({ paid: true, orderId: order._id, invoiceNo: order.invoiceNo, email: order.userEmail });
  const existing = await Order.findOne({ "paymentIntent.paymentInfo.id": payment.id }).select("invoiceNo userEmail").lean();
  if (existing) return res.json(summary(existing));

  const cart = await loadCart({ _id: payment.metadata.cartId, orderedBy: user._id });
  if (!cart || !paymentMatches(payment, user, cart)) {
    // Paid but the cart changed or vanished: the webhook/admin will reconcile.
    log("error", { id: req.id, event: "paid_session_unmatched", payment: payment.id });
    return res.json({ paid: true, pending: true });
  }
  let shippingAdd;
  try { shippingAdd = payment.metadata.shipping ? JSON.parse(payment.metadata.shipping) : undefined; } catch { /* truncated */ }
  await placeOrder({ user, cart, payment, shippingAdd });
  res.json(summary(await Order.findOne({ "paymentIntent.paymentInfo.id": payment.id }).select("invoiceNo userEmail").lean()));
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
