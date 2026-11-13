const Category = require("../models/category");
const Sub = require("../models/sub");
const taxonomy = require("../lib/taxonomy");

module.exports = {
  ...taxonomy({ Model: Category, label: "category", key: "category", field: "category" }),

  // Sub-categories belonging to a category.
  getSubs: async (req, res) => {
    try {
      res.json(await Sub.find({ parent: req.params._id }).lean());
    } catch (err) {
      res.send(err); // previous behaviour: the error object with status 200
    }
  },
};
