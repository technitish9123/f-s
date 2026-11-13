const crypto = require("crypto");

/*
 * Razorpay over its REST API (no SDK). Needs RAZORPAY_KEY_ID and
 * RAZORPAY_KEY_SECRET; the webhook also needs RAZORPAY_WEBHOOK_SECRET.
 */
const API = "https://api.razorpay.com/v1";

const keys = () => {
  const id = process.env.RAZORPAY_KEY_ID, secret = process.env.RAZORPAY_KEY_SECRET;
  return id && secret ? { id, secret } : null;
};
exports.configured = () => !!keys();
exports.keyId = () => keys()?.id;

const call = async (method, path, body) => {
  const k = keys();
  if (!k) throw Object.assign(new Error("Razorpay is not configured"), { status: 503 });
  const res = await fetch(API + path, {
    method,
    headers: {
      Authorization: `Basic ${Buffer.from(`${k.id}:${k.secret}`).toString("base64")}`,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(json.error?.description || `Razorpay error ${res.status}`), { status: 502 });
  return json;
};

exports.createOrder = (amount, receipt, notes) => call("POST", "/orders", { amount, currency: "INR", receipt, notes });
exports.fetchOrder = (id) => call("GET", `/orders/${encodeURIComponent(id)}`);
exports.fetchPayment = (id) => call("GET", `/payments/${encodeURIComponent(id)}`);
exports.capture = (id, amount) => call("POST", `/payments/${encodeURIComponent(id)}/capture`, { amount, currency: "INR" });
exports.refund = (id) => call("POST", `/payments/${encodeURIComponent(id)}/refund`, {});

const safeEqual = (a, b) => {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};
const hmac = (secret, data) => crypto.createHmac("sha256", secret).update(data).digest("hex");

// Checkout's handler signature: HMAC(order_id|payment_id) with the key secret.
exports.checkoutSignatureOk = (orderId, paymentId, signature) =>
  !!keys() && safeEqual(hmac(keys().secret, `${orderId}|${paymentId}`), signature);

// Webhook signature: HMAC of the raw body with the webhook secret.
exports.webhookSignatureOk = (rawBody, signature) =>
  !!process.env.RAZORPAY_WEBHOOK_SECRET && safeEqual(hmac(process.env.RAZORPAY_WEBHOOK_SECRET, rawBody), signature || "");

/*
 * A captured Razorpay payment in the shape the order code already uses
 * (amount in paise, status "succeeded", our ids in metadata), so the same
 * verification and fulfilment serve both payment providers.
 */
exports.asPayment = (p, notes) => ({
  id: p.id,
  provider: "razorpay",
  status: p.status === "captured" ? "succeeded" : p.status,
  amount: p.amount,
  currency: String(p.currency || "").toLowerCase(),
  metadata: notes || p.notes || {},
  method: p.method,
  order_id: p.order_id,
  created: p.created_at,
});
