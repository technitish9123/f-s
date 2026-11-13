const { randomUUID } = require("crypto");

// One JSON line per request: id, method, path, status, duration. The id is
// returned in the x-request-id header so a user's error can be found in the logs.
// Query strings are left out (they can carry personal data).
const log = (level, data) => (level === "error" ? console.error : console.log)(JSON.stringify({ t: new Date().toISOString(), ...data }));

exports.log = log;
exports.requestLog = (req, res, next) => {
  const start = process.hrtime.bigint();
  req.id = String(req.headers["x-request-id"] || randomUUID()).slice(0, 36);
  res.setHeader("x-request-id", req.id);
  res.on("finish", () => {
    if (req.path === "/api/health") return;
    log(res.statusCode >= 500 ? "error" : "info", {
      id: req.id,
      m: req.method,
      p: req.originalUrl.split("?")[0],
      s: res.statusCode,
      ms: Math.round(Number(process.hrtime.bigint() - start) / 1e6),
    });
  });
  next();
};
