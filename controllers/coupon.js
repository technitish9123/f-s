const Coupon = require("../models/coupon");

exports.create = async (req, res) => {
  try {
    const { name, expiry, discount, minOrder, maxUses, firstOrderOnly } = req.body;
    res.json(await new Coupon({ name, expiry, discount, minOrder, maxUses, firstOrderOnly }).save());
  } catch (err) {
    res.status(400).json({ err: err.code === 11000 ? "A coupon with this name already exists." : err.message });
  }
};

exports.list = async (req, res) => res.json(await Coupon.find({}).sort({ createdAt: -1 }).lean());

exports.remove = async (req, res) => res.json(await Coupon.findByIdAndDelete(req.params.coupon_id).lean());
