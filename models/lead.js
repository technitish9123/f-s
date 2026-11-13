const mongoose = require("mongoose");
const { ObjectId } = mongoose.Schema;

/*
 * Anything a visitor asks for that the showroom follows up by hand:
 * swatch samples, product enquiries, showroom/video visits and
 * "tell me when it's back in stock".
 */
const leadSchema = new mongoose.Schema(
  {
    type: { type: String, enum: ["sample", "enquiry", "visit", "restock"], required: true },
    name: { type: String, trim: true, maxlength: 80 },
    email: { type: String, trim: true, lowercase: true, maxlength: 120 },
    phone: { type: String, trim: true, maxlength: 20 },
    address: { type: String, trim: true, maxlength: 400 },
    message: { type: String, trim: true, maxlength: 1000 },
    products: [{ product: { type: ObjectId, ref: "Product" }, title: String, slug: String }],
    visit: { date: String, slot: String, mode: { type: String, enum: ["showroom", "video"] } },
    status: { type: String, enum: ["new", "contacted", "converted", "closed"], default: "new" },
    notes: { type: String, maxlength: 2000 },
    user: { type: ObjectId, ref: "User" },
  },
  { timestamps: true }
);
leadSchema.index({ status: 1, createdAt: -1 });
leadSchema.index({ type: 1, status: 1, "products.product": 1 });

module.exports = mongoose.model("Lead", leadSchema);
