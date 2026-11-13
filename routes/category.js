const express = require("express");
const router = express.Router();

// middlewares
const v = require("../lib/validate");
const { authCheck, adminCheck } = require("../middlewares/auth");

// controller
const {
  create,
  read,
  update,
  remove,
  list,
  getSubs
} = require("../controllers/category");

// routes
router.post("/category", authCheck, adminCheck, v.body({ name: v.str(64) }), create);
router.get("/categories", list);
router.get("/category/:slug", read);
router.put("/category/:slug", authCheck, adminCheck, v.body({ name: v.str(64) }), update);
router.delete("/category/:slug", authCheck, adminCheck, remove);
router.get("/product/subs/:_id", v.params({ _id: v.id }), getSubs);

module.exports = router;
