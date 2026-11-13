const Product = require("../models/product");
const User = require("../models/user");
const slugify = require("slugify");
const { toLegacyUpdateResult } = require("../lib/legacyUpdateResult");

// Every product response carries its category and sub-categories as plain objects.
const withRefs = (query) => query.populate("category").populate("subs").lean();

exports.create = async (req, res) => {
  try {
    req.body.slug = slugify(req.body.title);
    res.json(await new Product(req.body).save());
  } catch (err) {
    res.status(400).json({ err: err.message });
  }
};

exports.listAll = async (req, res) => {
  const count = Math.min(Math.max(parseInt(req.params.count, 10) || 0, 0), 2000);
  res.json(await withRefs(Product.find({}).sort({ createdAt: -1 }).limit(count)));
};

exports.deleteProduct = async (req, res) => {
  try {
    res.json(await Product.findOneAndDelete({ slug: req.params.slug }).lean());
  } catch (err) {
    res.status(400).json({ err: err.message });
  }
};

exports.read = async (req, res) => res.json(await withRefs(Product.findOne({ slug: req.params.slug })));

exports.update = async (req, res) => {
  try {
    res.json(await Product.findOneAndUpdate({ slug: req.params.slug }, req.body, { new: true }).lean());
  } catch (err) {
    res.status(400).send("product update failed");
  }
};

// Paginated list (3 per page), sorted by any field.
const PER_PAGE = 3;
exports.list = async (req, res) => {
  const { sort = "createdAt", order = "desc", page = 1 } = req.body;
  const skip = (Math.max(parseInt(page, 10) || 1, 1) - 1) * PER_PAGE;
  res.json(await withRefs(Product.find({}).sort({ [sort]: order }).skip(skip).limit(PER_PAGE)));
};

exports.productsCount = async (req, res) => res.json(await Product.estimatedDocumentCount());

exports.productStar = async (req, res) => {
  const star = Math.round(Number(req.body.star));
  if (!(star >= 1 && star <= 5)) return res.status(400).json({ err: "Rating must be 1-5." });

  const [product, user] = await Promise.all([
    Product.findById(req.params.product_id).select("ratings").lean(),
    User.findOne({ email: req.user.email }).select("_id").lean(),
  ]);
  if (!product || !user) return res.status(404).json({ err: "Not found." });

  const mine = product.ratings.find((r) => String(r.postedBy) === String(user._id));
  if (!mine) {
    return res.json(
      await Product.findByIdAndUpdate(product._id, { $push: { ratings: { star, postedBy: user._id } } }, { new: true })
    );
  }
  res.json(
    toLegacyUpdateResult(
      await Product.updateOne(
        { _id: product._id, "ratings.postedBy": user._id },
        { $set: { "ratings.$.star": star } }
      )
    )
  );
};

exports.listRelated = async (req, res) => {
  const product = await Product.findById(req.params.productId).select("category").lean();
  if (!product) return res.json([]);
  res.json(await withRefs(Product.find({ _id: { $ne: product._id }, category: product.category }).limit(3)));
};

/*
 * Search & filters. Builds ONE query from whichever filters are present
 * (they used to be eight separate handlers; combining two filters crashed
 * with "headers already sent").
 */
exports.searchFilters = async (req, res) => {
  const { query, price, category, stars, sub, shipping, color, brand } = req.body;
  const filter = {};

  if (query) filter.$text = { $search: query };
  if (Array.isArray(price)) filter.price = { $gte: Number(price[0]) || 0, $lte: Number(price[1]) || Number.MAX_SAFE_INTEGER };
  if (category) filter.category = category;
  if (sub) filter.subs = sub;
  if (shipping) filter.shipping = shipping;
  if (color) filter.color = color;
  if (brand) filter.brand = brand;
  if (stars) filter.$expr = { $eq: [{ $floor: { $avg: "$ratings.star" } }, Number(stars)] };

  let q = Product.find(filter);
  if (stars) q = q.limit(12); // previous behaviour for the rating filter
  res.json(await withRefs(q));
};
