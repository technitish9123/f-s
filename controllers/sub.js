const Sub = require("../models/sub");
const taxonomy = require("../lib/taxonomy");

module.exports = taxonomy({ Model: Sub, label: "Sub", key: "sub", field: "subs", extra: ["parent"] });
