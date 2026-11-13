const express = require("express");

const router = express.Router();

//middlewares
const v = require("../lib/validate");
const { authCheck } = require("../middlewares/auth");

//controllers
const {
  userCart,
  getUserCart,
  emptyCart,
  saveAddress,
  applyCouponDiscount,
  createOrder,
  orders,
  wishlist,
  addToWishlist,
  removeFromWishlist,
  profile,
  saveProfile,
} = require("../controllers/user");

//route
router.get("/user/wishlist", authCheck, wishlist);
router.get("/user/orders", authCheck, orders);
router.get("/user/cart", authCheck, getUserCart);
router.post("/user/cart", authCheck, v.body({ cart: v.arr(v.obj({ _id: v.id, count: v.num(1, 1000), color: v.opt(v.str(100)) }), 100) }), userCart);
router.post("/user/cart/coupon", authCheck, v.body({ coupon: v.str(50) }), applyCouponDiscount);
router.post("/user/wishlist", authCheck, v.body({ productId: v.id }), addToWishlist);
router.post("/user/order", authCheck, v.body({ paymentIntent: v.obj({ paymentInfo: v.obj({ id: v.str(100) }), shippingAdd: v.opt(v.obj()) }) }), createOrder);
router.delete("/user/cart", authCheck, emptyCart);
router.put("/user/address", authCheck, v.body({ address: (x) => v.str(2000)(x) || v.obj()(x) }), saveAddress);
router.put("/user/wishlist/:productId", authCheck, v.params({ productId: v.id }), removeFromWishlist);

const GSTIN = /^\d{2}[A-Z]{5}\d{4}[A-Z][A-Z\d]Z[A-Z\d]$/;
router.get("/user/profile", authCheck, profile);
router.put(
  "/user/profile",
  authCheck,
  v.body({
    name: v.opt(v.str(80)),
    phone: v.opt((x) => typeof x === "string" && /^[+\d][\d\s-]{6,18}$/.test(x)),
    gstin: v.opt((x) => typeof x === "string" && GSTIN.test(x.toUpperCase())),
    addresses: v.opt(v.arr(v.obj({ label: v.opt(v.str(30)), name: v.str(80), mobileNum: v.str(20), add: v.str(400) }), 5)),
  }),
  saveProfile
);

module.exports = router;
