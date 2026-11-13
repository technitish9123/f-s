const mongoose = require("mongoose");
const { ObjectId } = mongoose.Schema;

const productSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      trim: true,
      required: true,
      maxlength: 32,
      text: true,
    },
    slug: {
      type: String,
      unique: true,
      lowercase: true,
      index: true,
    },
    description: {
      type: String,
      required: true,
      maxlength: 2000,
      // Not text-indexed: MongoDB allows one text index per collection and
      // production already has it on title.
    },
    price: {
      type: Number,
      required: true,
      trim: true,
      maxlength: 32,
    },
    gst: {
      type: String,
      required: true,
    },
    category: {
      type: ObjectId,
      ref: "Category",
    },
    subs: [
      {
        type: ObjectId,
        ref: "Sub",
      },
    ],
    quantity: {
      type: Number,
    },
    sold: {
      type: Number,
      default: 0,
    },
    images: {
      type: Array,
    },
    shipping: {
      type: String,
      enum: ["Yes", "No"],
    },
    color: {
      type: String,
    },
    brand: {
      type: String,
    },
    material: {
      type: String,
    },
    property: {
      type: String,
    },
    design: {
      type: String,
    },
    style: {
      type: String,
    },
    application: {
      type: String,
    },
    instruction: {},
    width: {
      type: Number,
    },
    length: {
      type: Number,
    },
    weight: {
      type: Number,
    },
    repeatLength: {
      type: Number,
    },
    rollLength: {
      type: Number,
    },
    ratings: [
      {
        star: Number,
        postedBy: { type: ObjectId, ref: "User" },
      },
    ],
  },
  { timestamps: true }
);

productSchema.index({ category: 1, createdAt: -1 });
productSchema.index({ createdAt: -1 });
productSchema.index({ sold: -1 });

module.exports = mongoose.model("Product", productSchema);
