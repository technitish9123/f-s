const Order = require("../models/order");
const SliderImage = require("../models/sliderImage");
const { toLegacyUpdateResult } = require("../lib/legacyUpdateResult");
const { sendStatusUpdate } = require("../lib/mailer");
const { ORDER_PRODUCTS, variantStock } = require("../lib/orders");
const Product = require("../models/product");
const User = require("../models/user");
const Lead = require("../models/lead");
const slugify = require("slugify");
const { reindex } = require("../lib/facets");
const { getStripe } = require("../lib/stripe");
const razorpay = require("../lib/razorpay");
const { log } = require("../lib/log");

const STATUSES = ["Not Processed", "Processing", "Dispatched", "Delivered", "Cancelled"];

exports.orders = async (req, res) =>
  res.json(await Order.find({}).sort("createdAt").populate(ORDER_PRODUCTS).lean());

exports.orderStatus = async (req, res) => {
  const { orderId, orderStatus, tracking } = req.body;
  if (!STATUSES.includes(orderStatus)) return res.status(400).json({ err: "Unknown status." });

  const before = await Order.findById(orderId).select("orderStatus").lean();
  if (!before) return res.status(404).json({ err: "Order not found." });
  const changed = before.orderStatus !== orderStatus;
  const updated = await Order.findByIdAndUpdate(
    orderId,
    {
      orderStatus,
      ...(tracking && { tracking }),
      ...(changed && { $push: { statusHistory: { status: orderStatus, at: new Date() } } }),
    },
    { new: true }
  );

  // Only email when the status actually changes.
  if (changed) sendStatusUpdate(updated);
  res.json(updated);
};

/*
 * Cancel and refund in one step: refunds the card through Stripe, puts the
 * stock back, records the refund and tells the customer.
 */
exports.refund = async (req, res) => {
  const order = await Order.findById(req.params.id).populate("products.product", "_id quantity");
  if (!order) return res.status(404).json({ err: "Order not found." });
  if (order.refund && order.refund.id) return res.status(409).json({ err: "This order has already been refunded." });
  const paymentId = order.paymentIntent && order.paymentIntent.paymentInfo && order.paymentIntent.paymentInfo.id;
  if (!paymentId) return res.status(400).json({ err: "This order has no card payment to refund." });

  let refund;
  try {
    refund = paymentId.startsWith("pay_")
      ? await razorpay.refund(paymentId) // amount in paise, like Stripe
      : await getStripe().refunds.create({ payment_intent: paymentId, reason: "requested_by_customer" });
  } catch (err) {
    log("error", { id: req.id, event: "refund_failed", order: String(order._id), err: err.message });
    return res.status(502).json({ err: `The refund was refused: ${err.message}` });
  }

  order.refund = { id: refund.id, amount: refund.amount / 100, at: new Date() };
  if (order.orderStatus !== "Cancelled") order.statusHistory.push({ status: "Cancelled", at: new Date() });
  order.orderStatus = "Cancelled";
  await order.save();

  const items = order.products.filter((p) => p.product);
  if (items.length) {
    await Product.bulkWrite(
      items.flatMap((p) => [
        { updateOne: { filter: { _id: p.product._id }, update: { $inc: { sold: -p.count } } } },
        p.variant
          ? { updateOne: { filter: { _id: p.product._id, "variants.code": p.variant }, update: variantStock(p.variant, p.count) } }
          : { updateOne: { filter: { _id: p.product._id, quantity: { $type: "number" } }, update: { $inc: { quantity: p.count } } } },
      ]),
      { ordered: false }
    );
  }
  log("info", { id: req.id, event: "order_refunded", order: String(order._id), amount: order.refund.amount });
  sendStatusUpdate(order);
  res.json(order);
};

// Dashboard numbers: monthly sales, top sellers, low stock, open leads.
exports.stats = async (req, res) => {
  const paid = { "paymentIntent.paymentInfo.status": "succeeded", orderStatus: { $ne: "Cancelled" } };
  const [monthly, top, lowStock, openLeads, statusCounts] = await Promise.all([
    Order.aggregate([
      { $match: paid },
      { $group: {
        _id: { $dateToString: { format: "%Y-%m", date: "$createdAt", timezone: "Asia/Kolkata" } },
        orders: { $sum: 1 },
        revenue: { $sum: { $divide: [{ $ifNull: ["$paymentIntent.paymentInfo.stripeResponse.amount", 0] }, 100] } },
      } },
      { $sort: { _id: -1 } },
      { $limit: 12 },
    ]),
    Product.find({ sold: { $gt: 0 } }).sort({ sold: -1 }).limit(5).select("title slug sold price").lean(),
    Product.find({ quantity: { $type: "number", $lte: Number(req.query.threshold) || 5 } })
      .sort({ quantity: 1 }).limit(100).select("title slug quantity images").lean(),
    Lead.countDocuments({ status: "new" }),
    Order.aggregate([{ $group: { _id: "$orderStatus", n: { $sum: 1 } } }]),
  ]);
  res.json({
    monthly,
    top,
    lowStock: lowStock.map((p) => ({ ...p, image: p.images && p.images[0] && p.images[0].url, images: undefined })),
    openLeads,
    statusCounts: Object.fromEntries(statusCounts.map((s) => [s._id, s.n])),
  });
};

// Customers with their order count and lifetime spend.
exports.customers = async (req, res) => {
  const [users, spend] = await Promise.all([
    User.find({}).select("name email phone role createdAt").sort({ createdAt: -1 }).limit(2000).lean(),
    Order.aggregate([
      { $match: { orderStatus: { $ne: "Cancelled" } } },
      { $group: {
        _id: "$orderedBy",
        orders: { $sum: 1 },
        spent: { $sum: { $divide: [{ $ifNull: ["$paymentIntent.paymentInfo.stripeResponse.amount", 0] }, 100] } },
        last: { $max: "$createdAt" },
      } },
    ]),
  ]);
  const byUser = new Map(spend.map((s) => [String(s._id), s]));
  res.json(users.map((u) => {
    const s = byUser.get(String(u._id)) || {};
    return { ...u, orders: s.orders || 0, spent: s.spent || 0, lastOrder: s.last };
  }));
};

/*
 * Bulk product import (rows already validated by the route). Rows with a
 * supplier code (sku) are matched on it: existing products are updated
 * (e.g. a new price list), new ones created. Rows without a price become
 * "price on request".
 */
/*
 * Bulk import. Rows that share an articleCode become ONE product with a
 * colour option per row (sku = that colour's code, color = its name, first
 * image = its picture). Re-importing updates by article/code, so the same
 * file (or a later price list) can be loaded again safely.
 */
exports.importProducts = async (req, res) => {
  const { products } = req.body;
  const results = [];
  const touched = [];
  const groups = new Map();
  products.forEach((row, i) => {
    const key = row.articleCode ? `a:${row.articleCode.toLowerCase()}` : `r:${i}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push({ i, row });
  });

  for (const rows of groups.values()) {
    const report = (r) => rows.forEach(({ i }) => results.push({ row: i + 1, ...r }));
    try {
      const r = rows[0].row.articleCode ? await importArticle(rows.map((x) => x.row)) : await importSingle(rows[0].row);
      if (r.id) touched.push(r.id);
      report(r.ok ? { ok: true, slug: r.slug, ...(r.updated && { updated: true }) } : { ok: false, err: r.err });
    } catch (err) {
      report({ ok: false, err: err.code === 11000 ? "Duplicate product." : err.message });
    }
  }
  results.sort((a, b) => a.row - b.row);
  if (touched.length) await reindex({ _id: { $in: touched } });
  const ok = results.filter((r) => r.ok);
  res.json({
    created: ok.filter((r) => !r.updated).length,
    updated: ok.filter((r) => r.updated).length,
    products: new Set(ok.map((r) => r.slug)).size,
    results,
  });
};

// A product without an article: one row, matched by its code (sku) if it has one.
const importSingle = async (row) => {
  const data = { ...row, priceOnRequest: row.price === undefined || row.price === null };
  const existing = row.sku ? await Product.findOne({ sku: row.sku }).select("_id slug").lean() : null;
  if (existing) {
    if (data.priceOnRequest) delete data.priceOnRequest; // a catalogue refresh never wipes a known price
    await Product.updateOne({ _id: existing._id }, { $set: data });
    return { ok: true, id: existing._id, slug: existing.slug, updated: true };
  }
  const slug = slugify(row.sku ? `${row.title} ${row.sku.replace(/\//g, "-")}` : row.title, { lower: true, strict: true });
  if (await Product.exists({ slug })) return { ok: false, err: "A product with this title already exists." };
  const doc = await new Product({ ...data, slug }).save();
  return { ok: true, id: doc._id, slug: doc.slug };
};

// One article: product details from its first row, a colour option per row.
const importArticle = async (rows) => {
  const head = rows[0];
  const priced = rows.find((r) => r.price !== undefined && r.price !== null);
  const incoming = rows.filter((r) => r.sku).map((r) => ({
    code: r.sku,
    colour: r.color,
    image: r.images && r.images[0] && r.images[0].url,
    quantity: r.quantity,
  }));
  // Product-level fields; colour, code and stock belong to the colour options.
  const { sku, color, quantity, price, ...data } = head; // eslint-disable-line no-unused-vars
  if (!data.images || !data.images.length) delete data.images;
  if (priced) Object.assign(data, { price: priced.price, priceOnRequest: false });

  const existing = await Product.findOne({ articleCode: head.articleCode }).select("_id slug variants").lean();
  if (existing) {
    // Merge colours by code: known ones are refreshed (stock kept unless given), new ones added.
    const byCode = new Map((existing.variants || []).map((v) => [v.code, v]));
    for (const v of incoming) {
      const old = byCode.get(v.code) || {};
      byCode.set(v.code, { ...old, ...Object.fromEntries(Object.entries(v).filter(([, x]) => x !== undefined && x !== null)) });
    }
    await Product.updateOne({ _id: existing._id }, { $set: { ...data, variants: [...byCode.values()].slice(0, 400) } });
    return { ok: true, id: existing._id, slug: existing.slug, updated: true };
  }
  const slug = slugify(`${head.title} ${head.articleCode.replace(/\//g, "-")}`, { lower: true, strict: true });
  if (await Product.exists({ slug })) return { ok: false, err: "A product with this title already exists." };
  const images = data.images || (incoming[0] && incoming[0].image ? [{ url: incoming[0].image, public_id: "" }] : undefined);
  const doc = await new Product({ ...data, images, priceOnRequest: !priced, variants: incoming.length ? incoming : undefined, slug }).save();
  return { ok: true, id: doc._id, slug: doc.slug };
};

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