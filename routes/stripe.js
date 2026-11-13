const express = require("express");
const router = express.Router();
const v = require("../lib/validate");
const { authCheck } = require("../middlewares/auth");
const { createCheckoutSession, confirmCheckoutSession } = require("../controllers/stripe");

router.post("/checkout-session", authCheck, v.body({ couponApplied: v.opt(v.bool), shippingAdd: v.opt(v.obj()) }), createCheckoutSession);
router.get(
  "/checkout-session/:id",
  authCheck,
  v.params({ id: (x) => typeof x === "string" && /^cs_[A-Za-z0-9_]{10,200}$/.test(x) }),
  confirmCheckoutSession
);

module.exports = router;
