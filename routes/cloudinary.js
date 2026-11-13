const express = require('express');
const router = express.Router();

const v = require("../lib/validate");
const { authCheck, adminCheck } = require("../middlewares/auth");

const {upload, remove , sliderUpload, sliderRemove} = require("../controllers/cloudinary");

router.post('/uploadimages', authCheck, adminCheck, v.body({ image: v.str(3_000_000) }), upload)
router.post('/removeimages', authCheck, adminCheck, v.body({ public_id: v.str(300) }), remove)

router.post('/uploadsliderimages', authCheck, adminCheck, v.body({ image: v.str(3_000_000) }), sliderUpload)
router.post('/removesliderimages', authCheck, adminCheck, v.body({ public_id: v.str(300) }), sliderRemove)

module.exports = router;