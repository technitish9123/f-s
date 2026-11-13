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
  removeFromWishlist
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

module.exports = router;
