const express = require('express')
const router = express.Router();

const v = require("../lib/validate");
const { authCheck } = require("../middlewares/auth");

const {createPaymentsInteg} = require("../controllers/stripe")

router.post("/create-payment-integration", authCheck, v.body({ couponApplied: v.opt(v.bool), shippingAdd: v.opt(v.obj()) }), createPaymentsInteg)

module.exports = router