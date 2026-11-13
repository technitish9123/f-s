const Order = require("../models/order");
const slugify = require("slugify");
const SliderImage = require("../models/sliderImage");
const { toLegacyUpdateResult } = require("../lib/legacyUpdateResult");
const { sendStatusUpdate } = require("../lib/mailer");

const STATUSES = ["Not Processed", "Processing", "Dispatched", "Delivered", "Cancelled"];

exports.orders = async (req, res) => {
  let allOrders = await Order.find({})
    .sort("createdAt")
    .populate("products.product")
    .exec();

  res.json(allOrders);
};

exports.orderStatus = async (req, res) => {
  const { orderId, orderStatus } = req.body;
  if (!STATUSES.includes(orderStatus)) return res.status(400).json({ err: "Unknown status." });

  const before = await Order.findById(orderId).select("orderStatus").lean().exec();
  const updated = await Order.findByIdAndUpdate(orderId, { orderStatus }, { new: true }).exec();

  // Only email when the status actually changes.
  if (updated && before && before.orderStatus !== orderStatus) sendStatusUpdate(updated);

  res.json(updated);
};



// exports.uploadSliderImage = async (req, res) => {
//   try {
//     console.log(req.body);
//     res.json(await new sliderImg(req.body).save());
//   } catch (err) {
//     console.log(err);
//     // res.status(400).send("Create Product Failed");
//     res.status(400).json({
//       err: err.message,
//     });
//   }
// };

// exports.uploadSliderImage = async (req, res) => {
//   let SliderImage = await SliderImg.update(
   
//     { SliderImage: req.body.sliderImages }
//   ).exec();

//   if (SliderImage) {
//     res.json({ ok: true });
//   }
// };

exports.uploadSliderImage = async (req, res) => {
  const { name } = req.body;
  try {
    const updated = toLegacyUpdateResult(
      await SliderImage.updateOne({ name }, { new: true })
    );
    res.json(updated);
  } catch (err) {
    res.status(400).send("image upload update failed");
  }
};