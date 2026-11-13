const Stripe = require("stripe");

// Created on first use: current stripe-node throws when the key is missing,
// which would otherwise stop the whole API from booting.
let client;
exports.getStripe = () => {
  if (!client) client = Stripe(process.env.STRIPE_SECRET);
  return client;
};

// Stripe amounts are integers in paise.
exports.toPaise = (rupees) => Math.round(Number(rupees || 0) * 100);
