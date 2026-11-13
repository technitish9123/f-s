const express = require("express");
const router = express.Router();

// middlewares
const v = require("../lib/validate");
const { authCheck, adminCheck } = require("../middlewares/auth");

// controller
const { create, remove, list } = require("../controllers/coupon");

router.post("/coupon", authCheck, adminCheck, v.body({ name: v.str(50), expiry: (x) => typeof x === "string" && !isNaN(Date.parse(x)), discount: v.num(1, 100), minOrder: v.opt(v.num(0, 1e8)), maxUses: v.opt(v.num(0, 1e6)), firstOrderOnly: v.opt(v.bool) }), create);
router.get("/coupons", authCheck, adminCheck, list);
router.delete("/coupon/:coupon_id", authCheck, adminCheck, v.params({ coupon_id: v.id }), remove);

module.exports = router