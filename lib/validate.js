const mongoose = require("mongoose");

/*
 * Tiny request validator (no dependency). `body({ field: check })` rejects a
 * request whose fields fail their check with 400 and drops every field that
 * is not listed, so nothing unexpected reaches a controller or MongoDB.
 */
const opt = (check) => (v) => v === undefined || v === null || v === "" || check(v);
const str = (max = 200) => (v) => typeof v === "string" && v.length <= max;
const num = (min, max) => (v) => v !== "" && Number.isFinite(Number(v)) && typeof v !== "object" && Number(v) >= min && Number(v) <= max;
const id = (v) => typeof v === "string" && mongoose.isValidObjectId(v);
const bool = (v) => typeof v === "boolean";
const arr = (check, max = 200) => (v) => Array.isArray(v) && v.length <= max && v.every(check);
// An object whose listed keys pass; other keys are allowed but must not be operators.
const obj = (shape = {}) => (v) =>
  v !== null && typeof v === "object" && !Array.isArray(v) &&
  !Object.keys(v).some((k) => k.startsWith("$")) &&
  Object.entries(shape).every(([k, check]) => check(v[k]));
const ref = (v) => id(v) || (obj({ _id: id })(v)); // id, or a populated doc

const body = (shape) => (req, res, next) => {
  const src = req.body && typeof req.body === "object" ? req.body : {};
  const out = {};
  for (const [key, check] of Object.entries(shape)) {
    if (!check(src[key])) return res.status(400).json({ err: `Invalid ${key}.` });
    if (src[key] !== undefined) out[key] = src[key];
  }
  req.body = out;
  next();
};

const params = (shape) => (req, res, next) => {
  for (const [key, check] of Object.entries(shape)) {
    if (!check(req.params[key])) return res.status(400).json({ err: `Invalid ${key}.` });
  }
  next();
};

const text = opt(str(2000));
const n = opt(num(0, 1e9));

// Admin product form: every editable field, never ratings/sold/slug.
const PRODUCT = {
  title: str(32), description: str(2000), price: num(0, 1e9), gst: num(0, 100),
  category: opt(ref), subs: opt(arr(ref, 50)), quantity: n, images: opt(arr(obj({ url: str(1000) }), 30)),
  shipping: opt((v) => v === "Yes" || v === "No"), color: text, brand: text, material: text,
  property: text, design: text, style: text, application: text, instruction: opt((v) => str(2000)(v) || obj()(v)),
  width: n, length: n, weight: n, repeatLength: n, rollLength: n,
};
const product = body(PRODUCT);
// Updates may send any subset of the fields.
const productUpdate = body(Object.fromEntries(Object.entries(PRODUCT).map(([k, c]) => [k, opt(c)])));

// Populated refs from the admin form are reduced to plain ids.
const toId = (v) => (v && typeof v === "object" ? v._id : v);
const normaliseRefs = (req, res, next) => {
  if (req.body.category !== undefined) req.body.category = toId(req.body.category) || undefined;
  if (Array.isArray(req.body.subs)) req.body.subs = req.body.subs.map(toId);
  for (const k of ["shipping", "quantity", "width", "length", "weight", "repeatLength", "rollLength"]) {
    if (req.body[k] === "") delete req.body[k];
  }
  next();
};

module.exports = { opt, str, num, id, bool, arr, obj, ref, body, params, product, productUpdate, normaliseRefs };
