const Product = require("../models/product");
const User = require("../models/user");
const Cart = require("../models/cart");
const Coupon = require("../models/coupon");
const Order = require("../models/order");
const { getStripe, toPaise } = require("../lib/stripe");
const { sendOrderConfirmation } = require("../lib/mailer");

// The signed-in customer's database record (null if they have none yet).
const currentUser = (req, select) => {
  const q = User.findOne({ email: req.user.email });
  return select ? q.select(select) : q;
};

exports.userCart = async (req, res) => {
  const { cart } = req.body;
  if (!Array.isArray(cart)) return res.status(400).json({ err: "Invalid cart." });

  const user = await currentUser(req);
  if (!user) return res.status(404).json({ err: "User not found." });

  // Prices always come from the database, never from the browser.
  const ids = cart.map((c) => c && c._id).filter(Boolean);
  const priced = await Product.find({ _id: { $in: ids } }).select("price").lean().exec();
  const priceById = new Map(priced.map((p) => [String(p._id), p.price]));

  const products = [];
  for (const item of cart) {
    const price = priceById.get(String(item && item._id));
    const count = Math.floor(Number(item && item.count));
    if (price === undefined || !Number.isFinite(count) || count < 1 || count > 1000) continue;
    products.push({ product: item._id, count, color: item.color, price });
  }

  const cartTotal = products.reduce((sum, p) => sum + p.price * p.count, 0);

  await Cart.deleteOne({ orderedBy: user._id }).exec();
  await new Cart({ products, cartTotal, orderedBy: user._id }).save();

  res.json({ ok: true });
};

exports.getUserCart = async (req, res) => {
  const user = await currentUser(req, "_id").lean();
  const cart = user && (await Cart.findOne({ orderedBy: user._id }).populate("products.product", "_id title price gst").lean());
  const { totalAfterDiscount, products = [], cartTotal = 0 } = cart || {};
  res.json({ totalAfterDiscount, products, cartTotal });
};

exports.emptyCart = async (req, res) => {
  const user = await currentUser(req, "_id").lean();
  res.json(user ? await Cart.findOneAndDelete({ orderedBy: user._id }).lean() : null);
};

exports.saveAddress = async (req, res) => {
  const updated = await User.findOneAndUpdate({ email: req.user.email }, { address: req.body.address }).select("_id").lean();
  res.status(updated ? 200 : 404).json(updated ? { ok: true } : { err: "User not found." });
};

exports.applyCouponDiscount = async (req, res) => {
  const { coupon } = req.body;

  const validCoupon = await Coupon.findOne({ name: String(coupon || "").toUpperCase() }).exec();
  if (!validCoupon || (validCoupon.expiry && new Date(validCoupon.expiry) < new Date())) {
    return res.json({ error: "Invalid Coupon" });
  }

  const user = await currentUser(req, "_id").lean();
  const cart = user && (await Cart.findOne({ orderedBy: user._id }).exec());
  if (!cart) return res.json({ error: "Your bag is empty" });

  const discounted = cart.cartTotal - cart.cartTotal * (validCoupon.discount / 100);
  const totalAfterDiscount = Math.round(discounted * 100) / 100;

  await Cart.updateOne({ _id: cart._id }, { totalAfterDiscount }).exec();

  res.json({ discount: totalAfterDiscount });
};

exports.createOrder = async (req, res) => {
  const { paymentIntent } = req.body; // { shippingAdd, paymentInfo: { id, ... } }

  const user = await currentUser(req);
  if (!user) return res.status(404).json({ err: "User not found." });

  const cart = await Cart.findOne({ orderedBy: user._id })
    .populate("products.product", "_id title price")
    .exec();
  if (!cart || !cart.products.length) {
    return res.status(400).json({ err: "Your bag is empty." });
  }

  // ---- Verify the payment with Stripe; never trust the browser's word -----
  const paymentId = paymentIntent && paymentIntent.paymentInfo && paymentIntent.paymentInfo.id;
  if (!paymentId) return res.status(400).json({ err: "Payment details are missing." });

  // Idempotent: a retried request for an already-recorded payment succeeds.
  const existing = await Order.findOne({ "paymentIntent.paymentInfo.id": paymentId }).lean().exec();
  if (existing) return res.json({ ok: true });

  let stripePayment;
  try {
    stripePayment = await getStripe().paymentIntents.retrieve(paymentId);
  } catch (err) {
    return res.status(400).json({ err: "Payment could not be verified." });
  }

  const allowed = [toPaise(cart.cartTotal), toPaise(cart.totalAfterDiscount)].filter((a) => a > 0);
  // Fail closed: the payment must have been created by createPaymentsInteg
  // for this user and this exact cart.
  const meta = stripePayment.metadata || {};
  const ownerOk = meta.userId === String(user._id) && meta.cartId === String(cart._id);
  if (
    stripePayment.status !== "succeeded" ||
    stripePayment.currency !== "inr" ||
    !allowed.includes(stripePayment.amount) ||
    !ownerOk
  ) {
    return res.status(400).json({ err: "Payment could not be verified." });
  }

  // Store Stripe's own record (same shape the invoice and account pages read).
  // The unique index on the payment id makes a concurrent replay fail here.
  let newOrder;
  try {
    newOrder = await new Order({
    products: cart.products.map((p) => ({ product: p.product && p.product._id, count: p.count, color: p.color })),
    paymentIntent: {
      shippingAdd: paymentIntent.shippingAdd,
      paymentInfo: { id: stripePayment.id, status: stripePayment.status, stripeResponse: stripePayment },
    },
    orderedBy: user._id,
    userEmail: user.email,
    }).save();
  } catch (err) {
    if (err && err.code === 11000) return res.json({ ok: true }); // already recorded
    throw err;
  }

  // Track sales; adjust stock only for products that track it.
  const ops = cart.products
    .filter((p) => p.product)
    .flatMap((p) => [
      { updateOne: { filter: { _id: p.product._id }, update: { $inc: { sold: p.count } } } },
      {
        updateOne: {
          filter: { _id: p.product._id, quantity: { $type: "number", $gt: 0 } },
          update: { $inc: { quantity: -p.count } },
        },
      },
    ]);
  if (ops.length) await Product.bulkWrite(ops, { ordered: false });

  sendOrderConfirmation(
    newOrder,
    cart.products.filter((p) => p.product).map((p) => ({ title: p.product.title, price: p.product.price, count: p.count }))
  );

  res.json({ ok: true });
};

exports.orders = async (req, res) => {
  const user = await currentUser(req, "_id").lean();
  res.json(user ? await Order.find({ orderedBy: user._id }).populate("products.product").lean() : []);
};

exports.addToWishlist = async (req, res) => {
  await User.updateOne({ email: req.user.email }, { $addToSet: { wishlist: req.body.productId } });
  res.json({ ok: true });
};

exports.wishlist = async (req, res) => res.json(await currentUser(req, "wishlist").populate("wishlist").lean());

exports.removeFromWishlist = async (req, res) => {
  await User.updateOne({ email: req.user.email }, { $pull: { wishlist: req.params.productId } });
  res.json({ ok: true });
};
