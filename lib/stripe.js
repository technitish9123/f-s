const Stripe = require("stripe");

// Pinned to the account's API version. Newer versions the library would
// default to drop `payment_method_types` and require payment methods to be
// enabled in the Stripe dashboard; the webhook also receives events in this version.
const API_VERSION = "2020-08-27";

// Created on first use: current stripe-node throws when the key is missing,
// which would otherwise stop the whole API from booting.
let client;
exports.getStripe = () => {
  if (!client) client = Stripe(process.env.STRIPE_SECRET, { apiVersion: API_VERSION });
  return client;
};

// Stripe amounts are integers in paise.
exports.toPaise = (rupees) => Math.round(Number(rupees || 0) * 100);
