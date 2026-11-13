const express = require("express");
const router = express.Router();
const v = require("../lib/validate");
const { search, more } = require("../controllers/catalogue");

router.get("/catalogue", search);
router.get("/product/:slug/more", v.params({ slug: v.str(120) }), more);

module.exports = router;
