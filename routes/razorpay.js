const express = require("express");
const router = express.Router();
const v = require("../lib/validate");
const { authCheck } = require("../middlewares/auth");
const { createOrder, verify } = require("../controllers/razorpay");

const rzpId = (prefix) => (x) => typeof x === "string" && new RegExp(`^${prefix}_[A-Za-z0-9]{6,40}$`).test(x);

router.post("/razorpay/order", authCheck, v.body({ couponApplied: v.opt(v.bool), shippingAdd: v.opt(v.obj()) }), createOrder);
router.post(
  "/razorpay/verify",
  authCheck,
  v.body({ razorpay_order_id: rzpId("order"), razorpay_payment_id: rzpId("pay"), razorpay_signature: (x) => typeof x === "string" && /^[a-f0-9]{64}$/.test(x) }),
  verify
);

module.exports = router;
