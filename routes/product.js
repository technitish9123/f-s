const express = require("express");
const router = express.Router();

const v = require("../lib/validate");
const { authCheck, adminCheck } = require("../middlewares/auth");

const {
  create,
  listAll,
  deleteProduct,
  read,
  update,
  list,
  productsCount,
  productStar,
  listRelated,
  searchFilters
} = require("../controllers/product");

router.get("/product/:slug", read);
router.get("/products/total", productsCount);
router.get("/products/:count", listAll);
router.get("/product/related/:productId", v.params({ productId: v.id }), listRelated);
router.post("/products", v.body({ sort: v.opt((x) => ["createdAt", "updatedAt", "price", "sold", "title"].includes(x)), order: v.opt((x) => ["asc", "desc"].includes(x)), page: v.opt(v.num(1, 10000)) }), list);
router.post("/product", authCheck, adminCheck, v.product, v.normaliseRefs, create);
router.post("/search/filters", searchFilters)
router.delete("/product/:slug", authCheck, adminCheck, deleteProduct);
router.put("/product/:slug", authCheck, adminCheck, v.productUpdate, v.normaliseRefs, update);

router.put("/product/star/:product_id", authCheck, v.params({ product_id: v.id }), v.body({ star: v.num(1, 5) }), productStar);

//SEARCH

module.exports = router;
