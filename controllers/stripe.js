const Product = require("../models/product");
const User = require("../models/user");
const Cart = require("../models/cart");
const Coupon = require("../models/coupon");
const { getStripe, toPaise } = require("../lib/stripe");

exports.createPaymentsInteg = async (req, res) => {
  const { couponApplied } = req.body;

  //cart total
  let user = await User.findOne({ email: req.user.email }).exec();

  const cart = await Cart.findOne({ orderedBy: user._id }).lean().exec();
  if (!cart || !cart.products || !cart.products.length) {
    return res.status(400).json({ err: "Your bag is empty." });
  }
  const { cartTotal, totalAfterDiscount } = cart;

  let finalAmount = 0;

  // Stripe needs whole paise; discounted totals can have fractions.
  if (couponApplied && totalAfterDiscount) {
    finalAmount = toPaise(totalAfterDiscount);
  } else {
    finalAmount = toPaise(cartTotal);
  }
  let userAdd = user.address;
  //discount total whether coupon applied

  //payments intent by applying order amount and currency
  let createPaymentIntent = await getStripe().paymentIntents.create({
    amount: finalAmount,
    currency: "inr",
    // Lets createOrder confirm this payment belongs to this customer.
    metadata: { userId: String(user._id), cartId: String(cart._id) },
  });

  res.send({
    clientSecret: createPaymentIntent.client_secret,
    cartTotal,
    totalAfterDiscount,
    payable: finalAmount,
  });
};
