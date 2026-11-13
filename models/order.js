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
  },
  { timestamps: true }
);

orderSchema.index({ orderedBy: 1, createdAt: -1 });
// One order per Stripe payment, enforced by the database (no double-spend race).
orderSchema.index({ "paymentIntent.paymentInfo.id": 1 }, { unique: true, sparse: true });

module.exports = mongoose.model("Order", orderSchema);
