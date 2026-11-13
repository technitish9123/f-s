const mongoose = require("mongoose");
const { ObjectId } = mongoose.Schema;

const orderSchema = new mongoose.Schema(
  {
    products: [
      {
        product: {
          type: ObjectId,
          ref: "Product",
        },
        count: Number,
        color: String,
        variant: String, // colour code when the product has colour options
      },
    ],
    paymentIntent: {
     
    },
    orderStatus: {
      type: String,
      default: "Not Processed",
      enum: [
        "Not Processed",
        "Processing",
        "Dispatched",
        "Delivered",
        "Cancelled",
      ],
    },
    shippingInfo: {},

    orderedBy: { type: ObjectId, ref: "User" },
    userEmail: {
      type: String,
    },
    // GST invoice number, consecutive per financial year (lib/invoiceNo.js).
    invoiceNo: { type: String },
    coupon: { type: String },
    statusHistory: [{ status: String, at: { type: Date, default: Date.now }, _id: false }],
    tracking: { courier: String, number: String, url: String },
    refund: { id: String, amount: Number, at: Date },
  },
  { timestamps: true }
);

orderSchema.index({ orderedBy: 1, createdAt: -1 });
// One order per Stripe payment, enforced by the database (no double-spend race).
orderSchema.index({ "paymentIntent.paymentInfo.id": 1 }, { unique: true, sparse: true });
orderSchema.index({ invoiceNo: 1 }, { unique: true, sparse: true });

module.exports = mongoose.model("Order", orderSchema);
