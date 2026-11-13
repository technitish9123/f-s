const Product = require("../models/product");
const Cart = require("../models/cart");
const Order = require("../models/order");
const Coupon = require("../models/coupon");
const { toPaise } = require("./stripe");
const { sendOrderConfirmation } = require("./mailer");
const { nextInvoiceNo } = require("./invoiceNo");
const { log } = require("./log");

// The cart with what checkout and fulfilment need from each product.
exports.loadCart = (filter) => Cart.findOne(filter).populate("products.product", "_id title price quantity");

// Products in the cart that don't have enough stock (only products that track it).
exports.stockProblems = (cart) =>
  cart.products
    .filter((p) => p.product && typeof p.product.quantity === "number" && p.product.quantity < p.count)
    .map((p) => (p.product.quantity > 0 ? `Only ${p.product.quantity} left of ${p.product.title}.` : `${p.product.title} is out of stock.`));

// Fail closed: the payment must be a succeeded INR payment for this exact
// user and cart, for the cart's total (with or without the coupon).
exports.paymentMatches = (payment, user, cart) => {
  const meta = payment.metadata || {};
  const allowed = [toPaise(cart.cartTotal), toPaise(cart.totalAfterDiscount)].filter((a) => a > 0);
  return (
    payment.status === "succeeded" &&
    payment.currency === "inr" &&
    allowed.includes(payment.amount) &&
    meta.userId === String(user._id) &&
    meta.cartId === String(cart._id)
  );
};

// Records the order once per payment, updates sales and stock, empties the
// cart and emails the customer. Returns false if the payment was already recorded.
exports.placeOrder = async ({ user, cart, payment, shippingAdd }) => {
  let order;
  try {
    order = await new Order({
      products: cart.products.map((p) => ({ product: p.product && p.product._id, count: p.count, color: p.color })),
      paymentIntent: {
        shippingAdd,
        paymentInfo: { id: payment.id, status: payment.status, stripeResponse: payment },
      },
      orderedBy: user._id,
      userEmail: user.email,
      coupon: cart.coupon && cart.totalAfterDiscount && payment.amount === toPaise(cart.totalAfterDiscount) ? cart.coupon : undefined,
      statusHistory: [{ status: "Not Processed" }],
    }).save();
  } catch (err) {
    if (err && err.code === 11000) return false; // unique payment id: already recorded
    throw err;
  }

  // Numbered only once the order is safely stored, so a rejected duplicate
  // never uses up a number and the series has no gaps.
  order.invoiceNo = await nextInvoiceNo(order.createdAt);
  await Order.updateOne({ _id: order._id }, { invoiceNo: order.invoiceNo });

  const items = cart.products.filter((p) => p.product);
  if (items.length) {
    await Product.bulkWrite(
      items.flatMap((p) => [
        { updateOne: { filter: { _id: p.product._id }, update: { $inc: { sold: p.count } } } },
        {
          // Stock never goes below zero.
          updateOne: {
            filter: { _id: p.product._id, quantity: { $type: "number" } },
            update: [{ $set: { quantity: { $max: [0, { $subtract: ["$quantity", p.count] }] } } }],
          },
        },
      ]),
      { ordered: false }
    );
  }
  await Cart.deleteOne({ _id: cart._id });
  if (order.coupon) {
    // Counted atomically; if two people beat the limit at the same moment the
    // order still stands (it's paid) but we log it for the showroom.
    const counted = await Coupon.updateOne(
      { name: order.coupon, $or: [{ maxUses: 0 }, { $expr: { $lt: ["$usedCount", "$maxUses"] } }] },
      { $inc: { usedCount: 1 } }
    );
    if (!counted.modifiedCount) log("error", { event: "coupon_over_limit", coupon: order.coupon, order: String(order._id) });
  }

  sendOrderConfirmation(order, items.map((p) => ({ title: p.product.title, price: p.product.price, count: p.count })));
  return true;
};

// Order lists carry each product with its category name (the invoice needs it
// for the unit and HSN code).
exports.ORDER_PRODUCTS = { path: "products.product", populate: { path: "category", select: "name slug" } };

// Why a coupon can't be used on this cart right now ("" when it can).
exports.couponProblem = async (coupon, userId, cartTotal) => {
  if (!coupon || (coupon.expiry && new Date(coupon.expiry) < new Date())) return "Invalid Coupon";
  if (coupon.maxUses && coupon.usedCount >= coupon.maxUses) return "This coupon has been fully redeemed.";
  if (coupon.minOrder && cartTotal < coupon.minOrder) {
    return `This coupon needs a bag of Rs. ${coupon.minOrder.toLocaleString("en-IN")} or more.`;
  }
  if (coupon.firstOrderOnly && (await Order.exists({ orderedBy: userId }))) return "This coupon is for your first order only.";
  return "";
};
