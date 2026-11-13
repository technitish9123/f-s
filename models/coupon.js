const mongoose = require("mongoose");
const { ObjectId } = mongoose.Schema;

const couponSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      trim: true,
      unique: true,
      required: ["Name is Required"],
      uppercase: true,
      minlength: [6, "too short"],
      maxlength: [12, "too long"],
    },
    expiry: {
      type: Date,
      required: true,
    },
    discount: {
      type: Number,
      required: true,
    },
    // Optional rules: smallest bag value, total uses, first order only.
    minOrder: { type: Number, default: 0 },
    maxUses: { type: Number, default: 0 }, // 0 = unlimited
    usedCount: { type: Number, default: 0 },
    firstOrderOnly: { type: Boolean, default: false },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Coupon", couponSchema);
