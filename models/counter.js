const mongoose = require("mongoose");

// Named sequences, incremented atomically (e.g. "invoice:26-27" -> 1, 2, 3 …).
const counterSchema = new mongoose.Schema({ _id: String, seq: { type: Number, default: 0 } }, { versionKey: false });

module.exports = mongoose.model("Counter", counterSchema);
