const slugify = require("slugify");
const Product = require("../models/product");

/*
 * Shared CRUD for the two taxonomy models (Category, Sub). Both used to have
 * copy-pasted controllers; responses and error messages are unchanged.
 *   Model    the mongoose model
 *   label    used in error messages ("Create category failed")
 *   key      response key for the single read ("category" | "sub")
 *   field    Product field that references this model ("category" | "subs")
 *   extra    extra fields accepted on create (Sub needs "parent")
 */
module.exports = ({ Model, label, key, field, extra = [] }) => ({
  create: async (req, res) => {
    try {
      const doc = { name: req.body.name, slug: slugify(req.body.name) };
      for (const f of extra) doc[f] = req.body[f];
      res.json(await new Model(doc).save());
    } catch (err) {
      res.status(400).send(`Create ${label} failed`);
    }
  },

  list: async (req, res) => res.json(await Model.find({}).sort({ createdAt: -1 }).lean()),

  read: async (req, res) => {
    const item = await Model.findOne({ slug: req.params.slug }).lean();
    const products = item ? await Product.find({ [field]: item._id }).populate("category").lean() : [];
    res.json({ [key]: item, products });
  },

  update: async (req, res) => {
    try {
      const { name } = req.body;
      res.json(await Model.findOneAndUpdate({ slug: req.params.slug }, { name, slug: slugify(name) }, { new: true }).lean());
    } catch (err) {
      res.status(400).send(`${label[0].toUpperCase()}${label.slice(1)} update failed`);
    }
  },

  remove: async (req, res) => {
    try {
      res.json(await Model.findOneAndDelete({ slug: req.params.slug }).lean());
    } catch (err) {
      res.status(400).send(`${label[0].toUpperCase()}${label.slice(1)} delete failed`);
    }
  },
});
