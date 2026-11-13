const express = require("express");
const mongoose = require("mongoose");
const morgan = require("morgan");
const cors = require("cors");
const { readdirSync } = require("fs");
require("dotenv").config({ quiet: true });
const path = require("path");

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
app.use(morgan("dev"));
app.use(express.json({ limit: "2mb" }));
app.use(cors());
console.log("cors enabled")

app.disable('etag');

// routes middleware

readdirSync("./routes/").map((r) => app.use("/api", require("./routes/" + r)));


// port
const port = process.env.PORT || 8000;

if (process.env.NODE_ENV === "production") {

  app.use(express.static(path.join(__dirname, "../client/build")));
  app.get("*", (req, res) => {
      res.sendFile(path.join(__dirname, "../client/build/index.html"));
  });
}

app.listen(port, () => console.log(`Server is running on port ${port}`));
