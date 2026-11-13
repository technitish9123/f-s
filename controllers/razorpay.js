const Product = require("../models/product");
const User = require("../models/user");
const Cart = require("../models/cart");
const Coupon = require("../models/coupon");
const Razorpay = require("razorpay");
const uniqueId = require("uniqid");

// Keys come from the environment (they used to be hard-coded in this public
// repo; rotate the old test keys). The route answers 503 when unset.
let instance;
const getRazorpay = () => {
  if (!process.env.RAZORPAY_KEY_ID || !process.env.RAZORPAY_KEY_SECRET) return null;
  if (!instance) {
    instance = new Razorpay({
      key_id: process.env.RAZORPAY_KEY_ID,
      key_secret: process.env.RAZORPAY_KEY_SECRET,
    });
  }
  return instance;
};

exports.createPaymentsIntegs = async (req, res) => {
    const razorpay = getRazorpay();
    if (!razorpay) return res.status(503).json({ err: "Razorpay is not configured." });
    const { couponApplied } = req.body;
  
    //cart total
    let user = await User.findOne({ email: req.user.email }).exec();
  
    const { cartTotal, totalAfterDiscount } = await Cart.findOne({
      orderedBy: user._id,
    }).exec();
  
    // console.log("CART total ==> ", totalAfterDiscount);
  
    let finalAmount = 0;
  
    if (couponApplied && totalAfterDiscount) {
      finalAmount = (totalAfterDiscount * 100)
    } else {
      finalAmount = (cartTotal * 100)
    }
  
    //discount total whether coupon applied
  
    //payments intent by applying order amount and currency
  
    await razorpay.orders.create({
      amount: finalAmount,
      currency: "INR",
      receipt:uniqueId()
    },
    function(err, order){
        if (err){
            return res.status(500).json({
                error:err
            })
        }
        res.json({order,cartTotal,
            totalAfterDiscount,
            payable: finalAmount})
    }
    );
  
    // res.send({
    //   clientSecret: createPaymentIntent.client_secret,
    //   cartTotal,
    //   totalAfterDiscount,
    //   payable: finalAmount
    // });
  };
 
  