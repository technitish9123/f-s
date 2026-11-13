const mongoose = require("mongoose");
const Product = require("../models/product");
const Category = require("../models/category");
const Sub = require("../models/sub");
const { FACET_KEYS, ORDER } = require("../lib/facets");

// What a product card needs, nothing more (keeps 24-card pages small).
const CARD = {
  title: 1, slug: 1, price: 1, priceOnRequest: 1, quantity: 1, color: 1, brand: 1, sku: 1, createdAt: 1, sold: 1,
  images: { $slice: ["$images", 2] }, category: 1, "idx.family": 1,
};
const SORTS = {
  featured: { sold: -1, createdAt: -1, _id: 1 },
  newest: { createdAt: -1, _id: 1 },
  bestselling: { sold: -1, _id: 1 },
  "price-asc": { porLast: 1, price: 1, _id: 1 },
  "price-desc": { porLast: 1, price: -1, _id: 1 },
};
const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const list = (v) => (typeof v === "string" && v ? v.split(",").map((x) => x.trim()).filter(Boolean).slice(0, 20) : []);

// Attach {name, slug} categories to cards (one small lookup instead of populate).
const withCategories = async (items) => {
  const cats = new Map((await Category.find({}).select("name slug").lean()).map((c) => [String(c._id), { _id: c._id, name: c.name, slug: c.slug }]));
  return items.map((p) => ({ ...p, category: cats.get(String(p.category)) || null }));
};

/*
 * GET /catalogue: search, filter, sort and page the whole catalogue on the
 * server. Facet counts follow the usual rule: each facet is counted with all
 * the *other* active filters applied, so options never dead-end.
 */
exports.search = async (req, res) => {
  // Only plain strings count; anything else in the query string is ignored.
  const q = Object.fromEntries(Object.entries(req.query).filter(([, v]) => typeof v === "string"));
  const limit = Math.min(Math.max(parseInt(q.limit, 10) || 24, 1), 60);
  const page = Math.min(Math.max(parseInt(q.page, 10) || 1, 1), 2000);
  const sort = SORTS[q.sort] ? q.sort : "featured";

  // Scope: a category or sub-category page.
  const base = {};
  let scope = null;
  if (q.category) {
    const c = await Category.findOne({ slug: String(q.category) }).select("name slug").lean();
    if (!c) return res.json({ items: [], total: 0, facets: {}, price: null, scope: null });
    base.category = c._id;
    scope = c;
  } else if (q.sub) {
    const s = await Sub.findOne({ slug: String(q.sub) }).select("name slug").lean();
    if (!s) return res.json({ items: [], total: 0, facets: {}, price: null, scope: null });
    base.subs = s._id;
    scope = s;
  }
  // Every word must match somewhere ("green floral curtain"); plurals tolerated.
  const terms = String(q.q || "").toLowerCase().split(/\s+/).filter(Boolean).slice(0, 8).map((w) => w.replace(/s$/, ""));
  if (terms.length) base.$and = terms.map((w) => ({ "idx.search": { $regex: escape(w) } }));
  if (q.ids) base._id = { $in: list(q.ids).filter((x) => mongoose.isValidObjectId(x)).map((x) => new mongoose.Types.ObjectId(x)) };

  const selected = Object.fromEntries(FACET_KEYS.map((k) => [k, list(q[k])]));
  const facetMatch = (skip) => Object.fromEntries(
    FACET_KEYS.filter((k) => k !== skip && selected[k].length).map((k) => [`idx.${k}`, { $in: selected[k] }])
  );
  const min = Number(q.min), max = Number(q.max);
  const priceMatch = Number.isFinite(min) && Number.isFinite(max) && q.min !== undefined ? { price: { $gte: min, $lte: max }, priceOnRequest: { $ne: true } } : {};

  const counter = (k) => [
    { $match: { ...facetMatch(k), ...priceMatch } },
    { $unwind: `$idx.${k}` },
    { $group: { _id: `$idx.${k}`, count: { $sum: 1 } } },
  ];
  const [r] = await Product.aggregate([
    { $match: base },
    {
      $facet: {
        items: [
          { $match: { ...facetMatch(), ...priceMatch } },
          { $addFields: { porLast: { $cond: [{ $eq: ["$priceOnRequest", true] }, 1, 0] } } },
          { $sort: SORTS[sort] },
          { $skip: (page - 1) * limit },
          { $limit: limit },
          { $project: CARD },
        ],
        total: [{ $match: { ...facetMatch(), ...priceMatch } }, { $count: "n" }],
        price: [
          { $match: { ...facetMatch(), priceOnRequest: { $ne: true }, price: { $gt: 0 } } },
          { $group: { _id: null, min: { $min: "$price" }, max: { $max: "$price" } } },
        ],
        ...Object.fromEntries(FACET_KEYS.map((k) => [k, counter(k)])),
      },
    },
  ]).allowDiskUse(true);

  const facets = Object.fromEntries(FACET_KEYS.map((k) => {
    const rows = r[k].map((x) => ({ value: x._id, count: x.count }));
    const order = ORDER[k];
    rows.sort((a, b) => (order ? order.indexOf(a.value) - order.indexOf(b.value) : String(a.value).localeCompare(b.value)));
    return [k, rows];
  }));
  res.json({
    items: await withCategories(r.items),
    total: r.total[0]?.n || 0,
    page,
    pages: Math.ceil((r.total[0]?.n || 0) / limit),
    facets,
    price: r.price[0] ? { min: r.price[0].min, max: r.price[0].max } : null,
    scope,
  });
};

// GET /product/:slug/more: colourways of the same design, related designs and "complete the look".
exports.more = async (req, res) => {
  const p = await Product.findOne({ slug: req.params.slug }).select("category idx design color sold").lean();
  if (!p) return res.json({ colourways: [], related: [], look: [] });
  const family = p.idx?.family;
  const colour = p.idx?.colour?.[0];
  const pattern = p.idx?.pattern?.[0];
  const project = { $project: CARD };
  const [colourways, related, look] = await Promise.all([
    family ? Product.aggregate([{ $match: { "idx.family": family } }, { $sort: { sku: 1, title: 1 } }, { $limit: 300 }, project]) : [],
    Product.aggregate([
      { $match: { _id: { $ne: p._id }, category: p.category, "idx.family": { $ne: family } } },
      { $addFields: { score: { $add: [
        { $cond: [{ $in: [pattern || "-", { $ifNull: ["$idx.pattern", []] }] }, 2, 0] },
        { $cond: [{ $in: [colour || "-", { $ifNull: ["$idx.colour", []] }] }, 2, 0] },
      ] } } },
      { $sort: { score: -1, sold: -1, _id: 1 } },
      { $limit: 8 },
      project,
    ]),
    colour
      ? Product.aggregate([
          { $match: { category: { $ne: p.category }, "idx.colour": colour, quantity: { $ne: 0 } } },
          { $sort: { sold: -1, _id: 1 } },
          { $limit: 8 },
          project,
        ])
      : [],
  ]);
  const [c, rel, l] = await Promise.all([withCategories(colourways), withCategories(related), withCategories(look)]);
  res.json({ colourways: c, related: rel, look: l });
};
