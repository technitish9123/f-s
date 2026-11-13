const User = require("../models/user");
const Order = require("../models/order");
const Coupon = require("../models/coupon");
const Cart = require("../models/cart");
const rzp = require("../lib/razorpay");
const { toPaise } = require("../lib/stripe");
const { loadCart, stockProblems, paymentMatches, placeOrder, couponProblem } = require("../lib/orders");
const { id } = require("../lib/validate");
const { log } = require("../lib/log");

const unavailable = (res) => res.status(503).json({ err: "Payments are unavailable right now. Please call 7777045811 to place your order." });

// Step 1: a Razorpay order for exactly what's in the bag.
exports.createOrder = async (req, res) => {
  if (!rzp.configured()) return unavailable(res);
  const { couponApplied, shippingAdd } = req.body;

  const user = await User.findOne({ email: req.user.email }).select("_id email name").lean();
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
  const amount = toPaise(discounted ? cart.totalAfterDiscount : cart.cartTotal);
  // Razorpay notes: max 15 keys, 256 chars each.
  const notes = { userId: String(user._id), cartId: String(cart._id), ...(shippingAdd && { shipping: JSON.stringify(shippingAdd).slice(0, 255) }) };

  try {
    const order = await rzp.createOrder(amount, `cart_${cart._id}`.slice(0, 40), notes);
    res.json({ key: rzp.keyId(), orderId: order.id, amount, currency: "INR", name: user.name || "", email: (shippingAdd && shippingAdd.email) || user.email });
  } catch (err) {
    log("error", { id: req.id, event: "razorpay_order_failed", err: err.message });
    unavailable(res);
  }
};

// Fetch, capture if needed, verify against the cart, record. Shared by the browser and the webhook.
const fulfil = async (paymentId, userFilter) => {
  let p = await rzp.fetchPayment(paymentId);
  const rzOrder = await rzp.fetchOrder(p.order_id);
  const notes = rzOrder.notes || {};
  if (p.status === "authorized") p = await rzp.capture(p.id, p.amount); // accounts without auto-capture
  const payment = rzp.asPayment(p, notes);
  if (payment.status !== "succeeded" || p.amount !== rzOrder.amount) return { ok: false, reason: "not_captured" };

  const existing = await Order.findOne({ "paymentIntent.paymentInfo.id": payment.id }).select("invoiceNo userEmail").lean();
  if (existing) return { ok: true, order: existing };

  if (!id(notes.userId) || !id(notes.cartId) || (userFilter && userFilter !== notes.userId)) return { ok: false, reason: "not_yours" };
  const [user, cart] = await Promise.all([User.findById(notes.userId).select("_id email"), loadCart({ _id: notes.cartId, orderedBy: notes.userId })]);
  if (!user || !cart || !cart.products.length || !paymentMatches(payment, user, cart)) return { ok: false, reason: "unmatched", payment };

  let shippingAdd;
  try { shippingAdd = notes.shipping ? JSON.parse(notes.shipping) : undefined; } catch { /* truncated */ }
  await placeOrder({ user, cart, payment, shippingAdd });
  return { ok: true, order: await Order.findOne({ "paymentIntent.paymentInfo.id": payment.id }).select("invoiceNo userEmail").lean() };
};

// Step 2: Razorpay Checkout's success handler posts here.
exports.verify = async (req, res) => {
  if (!rzp.configured()) return unavailable(res);
  const { razorpay_order_id: orderId, razorpay_payment_id: paymentId, razorpay_signature: signature } = req.body;
  if (!rzp.checkoutSignatureOk(orderId, paymentId, signature)) return res.status(400).json({ err: "Payment could not be verified." });

  const user = await User.findOne({ email: req.user.email }).select("_id").lean();
  if (!user) return res.status(404).json({ err: "User not found." });
  try {
    const r = await fulfil(paymentId, String(user._id));
    if (r.ok) return res.json({ paid: true, invoiceNo: r.order.invoiceNo, email: r.order.userEmail });
    log("error", { id: req.id, event: "razorpay_unmatched", payment: paymentId, reason: r.reason });
    // Paid but not matched (e.g. bag changed): the showroom reconciles it.
    return res.json({ paid: r.reason !== "not_captured", pending: true });
  } catch (err) {
    log("error", { id: req.id, event: "razorpay_verify_failed", payment: paymentId, err: err.message });
    return res.status(502).json({ err: "We couldn't confirm the payment yet. If money was taken, your order will be recorded automatically." });
  }
};

// Razorpay -> us: records the order even if the customer closed the tab.
exports.webhook = async (req, res) => {
  if (!process.env.RAZORPAY_WEBHOOK_SECRET) return res.status(503).json({ err: "Webhook not configured." });
  if (!rzp.webhookSignatureOk(req.body, req.headers["x-razorpay-signature"])) return res.status(400).json({ err: "Invalid signature." });
  let event;
  try { event = JSON.parse(req.body.toString("utf8")); } catch { return res.status(400).json({ err: "Bad payload." }); }
  if (event.event === "payment.captured" || event.event === "order.paid") {
    const paymentId = event.payload?.payment?.entity?.id;
    if (paymentId) {
      const r = await fulfil(paymentId).catch((err) => ({ ok: false, reason: err.message }));
      log(r.ok ? "info" : "error", { event: "razorpay_webhook", payment: paymentId, ok: r.ok, reason: r.reason });
    }
  }
  res.json({ received: true });
};

exports.fulfil = fulfil;
