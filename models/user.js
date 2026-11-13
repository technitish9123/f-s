const mongoose = require("mongoose");
const { ObjectId } = mongoose.Schema;

const userSchema = new mongoose.Schema(
  {
    name: String,
    email: {
      type: String,
      required: true,
      index: true,
    },
    role: {
      type: String,
      default: "subscriber",
    },
    cart: {
      type: Array,
      default: [],
    },
    address: String,
    phone: { type: String, trim: true, maxlength: 20 },
    gstin: { type: String, trim: true, uppercase: true, maxlength: 15 },
    // Saved delivery addresses for checkout.
    addresses: [
      {
        label: { type: String, maxlength: 30 },
        name: { type: String, maxlength: 80 },
        mobileNum: { type: String, maxlength: 20 },
        add: { type: String, maxlength: 400 },
      },
    ],
    wishlist: [{ type: ObjectId, ref: "Product" }],
  },
  { timestamps: true }
);

module.exports = mongoose.model("User", userSchema);
