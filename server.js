const express = require("express");
// Async route handlers that throw/reject now reach the error handler below
// (Express 4 would otherwise leave the request hanging).
require("express-async-errors");
const compression = require("compression");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const mongoose = require("mongoose");
const morgan = require("morgan");
const cors = require("cors");
const { readdirSync } = require("fs");
require("dotenv").config({ quiet: true });

// app
const app = express();

// Node >= 15 terminates the process on an unhandled promise rejection. Several
// async route handlers can reject (e.g. a missing user/cart, or a rejected
// third-party call) and Express 4 does not catch async errors. Node 14, which
// this app previously ran on, only logged these, so keep that behaviour rather
// than letting one bad request take the whole server down.
process.on("unhandledRejection", (reason) => {
  console.error("UNHANDLED REJECTION", reason);
});

// db
// Mongoose 6+ dropped useNewUrlParser/useCreateIndex/useFindAndModify/
// useUnifiedTopology (they are always on). strictQuery=false matches the
// Mongoose 5 default (unknown filter keys are passed through to MongoDB).
// strictPopulate=false keeps Mongoose 5 behaviour of silently ignoring
// populate() on paths that are not in the schema (e.g. Product "postedBy").
mongoose.set("strictQuery", false);
mongoose.set("strictPopulate", false);

mongoose
  .connect(process.env.DATABASE)
  .then(() => console.log("DB CONNECTED"))
  .catch((err) => console.log("DB CONNECTION ERR", err));

// middlewares
// Render sits behind a proxy; needed for correct client IPs (rate limits).
app.set("trust proxy", 1);
app.disable("x-powered-by");

app.use(helmet({ crossOriginResourcePolicy: { policy: "cross-origin" } }));
app.use(compression());
app.use(morgan(process.env.NODE_ENV === "production" ? "tiny" : "dev"));
app.use(express.json({ limit: "2mb" }));

// Only the storefront (and local development) may call the API from a browser.
const allowedOrigins = [
  /^https:\/\/(www\.)?firstimp\.in$/,
  /^https:\/\/f-c(-[a-z0-9-]+)?\.onrender\.com$/,
  /^http:\/\/localhost:\d+$/,
];
app.use(
  cors({
    origin: (origin, cb) => cb(null, !origin || allowedOrigins.some((re) => re.test(origin))),
  })
);

// Rate limits: generous overall, tighter on payment and order creation.
app.use("/api", rateLimit({ windowMs: 60 * 1000, limit: 300, standardHeaders: "draft-7", legacyHeaders: false }));
const paymentLimiter = rateLimit({ windowMs: 10 * 60 * 1000, limit: 30, standardHeaders: "draft-7", legacyHeaders: false });
app.use(["/api/create-payment-integration", "/api/create-payment-integrations", "/api/user/order"], paymentLimiter);

// Health check for Render / uptime monitors.
app.get("/api/health", (req, res) =>
  res.json({ ok: true, db: mongoose.connection.readyState === 1 ? "up" : "down" })
);

app.disable('etag');

// routes middleware

readdirSync("./routes/").map((r) => app.use("/api", require("./routes/" + r)));


// Unknown API routes and unhandled errors return JSON instead of hanging.
app.use("/api", (req, res) => res.status(404).json({ err: "Not found" }));
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error(`${req.method} ${req.originalUrl} failed:`, err && err.message);
  if (res.headersSent) return;
  const status = err.name === "CastError" ? 400 : err.status || 500;
  res.status(status).json({ err: status === 400 ? "Invalid request" : "Something went wrong" });
});

// port
const port = process.env.PORT || 8000;


app.listen(port, () => console.log(`Server is running on port ${port}`));
