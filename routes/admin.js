const express = require("express");

const router = express.Router();

//middlewares
const v = require("../lib/validate");
const { authCheck, adminCheck } = require("../middlewares/auth");

//controllers
const { orders, orderStatus , uploadSliderImage} = require("../controllers/admin");

//routes
router.get("/admin/orders", authCheck, adminCheck, orders);

router.put("/admin/order-status", authCheck, adminCheck, v.body({ orderId: v.id, orderStatus: v.str(30) }), orderStatus);

router.put("/admin/uploadSliderImage", authCheck, adminCheck, v.body({ name: v.str(200) }), uploadSliderImage);

module.exports = router;
