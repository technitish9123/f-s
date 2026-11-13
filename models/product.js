const mongoose = require("mongoose");
const { ObjectId } = mongoose.Schema;

const productSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      trim: true,
      required: true,
      maxlength: 80,
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
      // Imported articles can be "price on request" until a price list arrives.
      required: function () {
        return !this.priceOnRequest;
      },
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
    // Supplier's code for this exact colourway (e.g. JAB "CH1249/069") and its article.
    sku: { type: String, trim: true, maxlength: 40 },
    articleCode: { type: String, trim: true, maxlength: 40 },
    priceOnRequest: { type: Boolean, default: false },
    // Colours of one article (one product per article, e.g. 243 colours of JAB
    // CH1249). Each has the supplier code, a name, its picture and optional stock.
    variants: {
      type: [
        {
          _id: false,
          code: { type: String, trim: true, maxlength: 40, required: true },
          colour: { type: String, trim: true, maxlength: 60 },
          image: { type: String, maxlength: 1000 },
          quantity: { type: Number },
        },
      ],
      default: undefined,
    },
    // Search/filter index maintained by lib/facets.js (never set by hand).
    idx: {
      type: { type: [String], default: undefined },
      use: { type: [String], default: undefined },
      colour: { type: [String], default: undefined },
      pattern: { type: [String], default: undefined },
      composition: { type: [String], default: undefined },
      family: String,
      search: String,
    },
    // GST HSN code; the invoice falls back to the category's code when empty.
    hsn: { type: String, trim: true, maxlength: 8 },
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
productSchema.index({ sku: 1 }, { unique: true, sparse: true });
productSchema.index({ "idx.family": 1 });
productSchema.index({ articleCode: 1 }, { sparse: true });
productSchema.index({ subs: 1 });
productSchema.index({ price: 1 });

module.exports = mongoose.model("Product", productSchema);
