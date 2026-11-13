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
} = require("../controllers/sub");

// routes
router.post("/sub", authCheck, adminCheck, v.body({ name: v.str(64), parent: v.id }), create);
router.get("/subs", list);
router.get("/sub/:slug", read);
router.put("/sub/:slug", authCheck, adminCheck, v.body({ name: v.str(64), parent: v.opt(v.id) }), update);
router.delete("/sub/:slug", authCheck, adminCheck, remove);

module.exports = router;