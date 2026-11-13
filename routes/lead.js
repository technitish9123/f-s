const express = require("express");
const router = express.Router();
const v = require("../lib/validate");
const { authCheck, adminCheck } = require("../middlewares/auth");
const { create, list, update } = require("../controllers/lead");

const email = (x) => typeof x === "string" && x.length <= 120 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(x);
const today = () => new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10); // IST
const SLOTS = ["11:00", "12:30", "14:00", "15:30", "17:00", "18:30"];

// Each type requires its own fields on top of the shared ones.
const byType = (req, res, next) => {
  const b = req.body;
  const need = {
    sample: () => b.name && b.phone && b.address && b.products && b.products.length >= 1 && b.products.length <= 5,
    enquiry: () => b.name && b.message && b.products && b.products.length === 1,
    visit: () => b.name && b.phone && b.visit && /^\d{4}-\d{2}-\d{2}$/.test(b.visit.date) && b.visit.date > today()
      && SLOTS.includes(b.visit.slot) && ["showroom", "video"].includes(b.visit.mode),
    restock: () => b.products && b.products.length === 1,
  }[b.type];
  if (!need || !need()) return res.status(400).json({ err: "Please fill in the required details." });
  next();
};

router.post(
  "/leads",
  v.body({
    type: (x) => ["sample", "enquiry", "visit", "restock"].includes(x),
    name: v.opt(v.str(80)), email, phone: v.opt((x) => typeof x === "string" && /^[+\d][\d\s-]{6,18}$/.test(x)),
    address: v.opt(v.str(400)), message: v.opt(v.str(1000)), products: v.opt(v.arr(v.id, 5)),
    visit: v.opt(v.obj({ date: v.str(10), slot: v.str(10), mode: v.str(10) })),
  }),
  byType,
  create
);
router.get("/admin/leads", authCheck, adminCheck, list);
router.put(
  "/admin/leads/:id",
  authCheck, adminCheck, v.params({ id: v.id }),
  v.body({ status: v.opt((x) => ["new", "contacted", "converted", "closed"].includes(x)), notes: v.opt(v.str(2000)) }),
  update
);

module.exports = router;
