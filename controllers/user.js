const Product = require("../models/product");
const User = require("../models/user");
const Cart = require("../models/cart");
const Coupon = require("../models/coupon");
const Order = require("../models/order");
const { getStripe } = require("../lib/stripe");
const { loadCart, paymentMatches, placeOrder, ORDER_PRODUCTS, couponProblem } = require("../lib/orders");

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

  const validCoupon = await Coupon.findOne({ name: String(coupon || "").toUpperCase() }).lean();
  if (!validCoupon) return res.json({ error: "Invalid Coupon" });

  const user = await currentUser(req, "_id").lean();
  const cart = user && (await Cart.findOne({ orderedBy: user._id }).exec());
  if (!cart) return res.json({ error: "Your bag is empty" });
  const problem = await couponProblem(validCoupon, user._id, cart.cartTotal);
  if (problem) return res.json({ error: problem });

  const discounted = cart.cartTotal - cart.cartTotal * (validCoupon.discount / 100);
  const totalAfterDiscount = Math.round(discounted * 100) / 100;

  await Cart.updateOne({ _id: cart._id }, { totalAfterDiscount, coupon: validCoupon.name }).exec();

  res.json({ discount: totalAfterDiscount });
};

exports.createOrder = async (req, res) => {
  const { paymentIntent } = req.body; // { shippingAdd, paymentInfo: { id } }
  const paymentId = paymentIntent?.paymentInfo?.id;
  if (typeof paymentId !== "string") return res.status(400).json({ err: "Payment details are missing." });

  // Idempotent: the Stripe webhook (or a retry) may have recorded it already.
  if (await Order.exists({ "paymentIntent.paymentInfo.id": paymentId })) return res.json({ ok: true });

  const user = await currentUser(req);
  if (!user) return res.status(404).json({ err: "User not found." });
  const cart = await loadCart({ orderedBy: user._id });
  if (!cart || !cart.products.length) return res.status(400).json({ err: "Your bag is empty." });

  // Verify the payment with Stripe; never trust the browser's word.
  let payment;
  try {
    payment = await getStripe().paymentIntents.retrieve(paymentId);
  } catch (err) {
    return res.status(400).json({ err: "Payment could not be verified." });
  }
  if (!paymentMatches(payment, user, cart)) return res.status(400).json({ err: "Payment could not be verified." });

  await placeOrder({ user, cart, payment, shippingAdd: paymentIntent.shippingAdd });
  res.json({ ok: true });
};

exports.orders = async (req, res) => {
  const user = await currentUser(req, "_id").lean();
  res.json(user ? await Order.find({ orderedBy: user._id }).populate(ORDER_PRODUCTS).lean() : []);
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

// ---- Profile: name, phone, GSTIN and saved delivery addresses ----
const PROFILE = "name email phone gstin addresses";
exports.profile = async (req, res) => res.json(await currentUser(req, PROFILE).lean());

exports.saveProfile = async (req, res) => {
  const { name, phone, gstin, addresses } = req.body;
  const updated = await User.findOneAndUpdate(
    { email: req.user.email },
    { ...(name !== undefined && { name }), ...(phone !== undefined && { phone }), ...(gstin !== undefined && { gstin }),
      ...(addresses && { addresses }) },
    { new: true, runValidators: true }
  ).select(PROFILE).lean();
  res.status(updated ? 200 : 404).json(updated || { err: "User not found." });
};
