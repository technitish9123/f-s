/*
 * Catalogue facets, computed on the server so the shop can filter and count
 * tens of thousands of products without loading them into the browser.
 * The product data was typed by hand over the years (misspellings, trailing
 * spaces, comma lists), so every facet goes through a small mapping here.
 * Each product stores the result in `idx` (see reindex below).
 */
const Product = require("../models/product");

const COLOUR_FAMILIES = [
  ["White", ["White", "Ivory"]],
  ["Beige", ["Beige", "PeachPuff", "Bisque", "BurlyWood", "Khaki"]],
  ["Brown", ["Brown"]],
  ["Grey", ["Grey", "Gray"]],
  ["Black", ["Black"]],
  ["Red", ["Red", "Maroon", "Coral", "OrangeRed"]],
  ["Pink", ["Pink", "Magenta"]],
  ["Orange", ["Orange"]],
  ["Yellow", ["Yellow", "Gold"]],
  ["Green", ["Green", "Olive", "Lime", "GreenYellow"]],
  ["Blue", ["Blue", "Navy", "Aqua", "Teal", "Turquoise", "RoyalBlue"]],
  ["Purple", ["Purple", "Lavender"]],
];
const colourLookup = Object.fromEntries(COLOUR_FAMILIES.flatMap(([k, names]) => names.map((n) => [n.toLowerCase(), k])));
// Families also match by plain words ("dark green", "Grün" stays unmatched).
const colourWords = Object.fromEntries(COLOUR_FAMILIES.map(([k]) => [k.toLowerCase(), k]));

const PATTERNS = [["Plain", /^plain|^uni\b/], ["Stripes", /^strip/], ["Floral", /^(floral|flower)/], ["Geometric", /^geom/],
  ["Graphic", /^gra/], ["Checks", /^check/], ["Highlight", /^highlight/], ["Polo", /^po/], ["Ornamental", /^orna/], ["Wood", /^wood/],
  ["Structure", /^struct/], ["Animal", /^animal/]];
const USES = [["Curtains", /curtain|decoration/], ["Upholstery", /upholster/], ["Blinds", /blind/], ["Cushions", /cushion/],
  ["Bedcovers", /^bed/], ["Table linen", /^dining|^table/], ["Wallcovering", /wallpaper|wallcover/], ["Outdoor", /outdoor/]];
const FIBRES = [["Cotton", /cotton/], ["Polyester", /polyester/], ["Silk", /silk/], ["Wool", /wool/], ["Linen", /linen/],
  ["Viscose", /viscose/], ["Vinyl", /vin[yl]{2}/], ["Non-woven", /non[\s-]?woven/], ["Paper", /paper/], ["Acrylic", /acryl/]];

exports.ORDER = {
  use: USES.map(([k]) => k),
  colour: COLOUR_FAMILIES.map(([k]) => k),
  pattern: PATTERNS.map(([k]) => k),
  composition: FIBRES.map(([k]) => k),
};
exports.FACET_KEYS = ["type", "use", "colour", "pattern", "composition"];

const words = (s) => String(s || "").toLowerCase();

const colourFamily = (name) => colourLookup[words(name).trim()] || words(name).split(/[\s,/]+/).map((w) => colourWords[w]).find(Boolean);
// Every colour family the product comes in (its own colour, plus each colour option).
const colourOf = (p) => [...new Set([p.color, ...(p.variants || []).map((v) => v.colour)].map(colourFamily).filter(Boolean))];
const patternOf = (p) => {
  const v = words(p.design).trim();
  const hit = v && PATTERNS.find(([, re]) => re.test(v));
  return hit ? [hit[0]] : [];
};
const usesOf = (p) => {
  const out = new Set();
  words(p.application).split(",").map((s) => s.trim()).filter(Boolean)
    .forEach((part) => USES.forEach(([k, re]) => re.test(part) && out.add(k)));
  return [...out];
};
const fibresOf = (p) => FIBRES.filter(([, re]) => re.test(words(p.material))).map(([k]) => k);

// "Seiichi J-1158" and "Seiichi J-1163" are colourways of one design; imported
// articles say so directly with their article code.
const familyOf = (p) =>
  (p.articleCode ? `a:${p.articleCode}` : String(p.title || "").trim().split(/\s+(?=[A-Z]{0,3}[-\s]?\d)/)[0].replace(/[\s\-–:]+$/, "")).toLowerCase();

exports.indexOf = (p, categoryName) => {
  const idx = {
    type: categoryName ? [categoryName.trim()] : [],
    use: usesOf(p),
    colour: colourOf(p),
    pattern: patternOf(p),
    composition: fibresOf(p),
    family: familyOf(p),
  };
  idx.search = [p.title, p.sku, p.articleCode, p.brand, p.color, p.design, p.material, p.application, p.style, categoryName,
    ...(p.variants || []).flatMap((v) => [v.code, v.colour]), ...idx.use, ...idx.colour, ...idx.pattern, ...idx.composition].filter(Boolean).join(" ").toLowerCase();
  return idx;
};

// Recompute idx for some (or all) products; cheap enough to run after any write.
exports.reindex = async (filter = {}) => {
  const Category = require("../models/category");
  const names = new Map((await Category.find({}).select("name").lean()).map((c) => [String(c._id), c.name]));
  const ops = [];
  const cursor = Product.find(filter).select("title sku articleCode brand color design material application style category variants.code variants.colour").lean().cursor();
  for await (const p of cursor) {
    ops.push({ updateOne: { filter: { _id: p._id }, update: { $set: { idx: exports.indexOf(p, names.get(String(p.category))) } } } });
    if (ops.length === 1000) await Product.bulkWrite(ops.splice(0), { ordered: false });
  }
  if (ops.length) await Product.bulkWrite(ops, { ordered: false });
};
