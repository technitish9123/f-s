const express = require("express");

const router = express.Router();

//middlewares
const v = require("../lib/validate");
const { authCheck, adminCheck } = require("../middlewares/auth");

//controllers
const { orders, orderStatus, uploadSliderImage, refund, stats, customers, importProducts } = require("../controllers/admin");

//routes
router.get("/admin/orders", authCheck, adminCheck, orders);

router.put(
  "/admin/order-status",
  authCheck, adminCheck,
  v.body({
    orderId: v.id,
    orderStatus: v.str(30),
    tracking: v.opt(v.obj({ courier: v.opt(v.str(60)), number: v.opt(v.str(60)), url: v.opt((x) => typeof x === "string" && /^https?:\/\/\S{3,300}$/.test(x)) })),
  }),
  orderStatus
);
router.post("/admin/orders/:id/refund", authCheck, adminCheck, v.params({ id: v.id }), refund);
router.get("/admin/stats", authCheck, adminCheck, stats);
router.get("/admin/customers", authCheck, adminCheck, customers);
router.post("/admin/products/import", authCheck, adminCheck, v.body({ products: v.arr(v.obj(), 500) }), v.importRows, importProducts);

router.put("/admin/uploadSliderImage", authCheck, adminCheck, v.body({ name: v.str(200) }), uploadSliderImage);

module.exports = router;
