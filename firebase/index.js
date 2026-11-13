const fs = require("fs");
const admin = require("firebase-admin");

/*
 * The service-account key is a secret and must never be committed.
 * It is read, in order of preference, from:
 *   1. FIREBASE_SERVICE_ACCOUNT_B64  – base64 of the JSON key (Render env var)
 *   2. FIREBASE_SERVICE_ACCOUNT_PATH – path to the JSON key file
 *   3. /etc/secrets/fbServiceAccountKey.json – Render secret file
 *   4. config/fbServiceAccountKey.json – local development (git-ignored)
 */
function loadServiceAccount() {
  if (process.env.FIREBASE_SERVICE_ACCOUNT_B64) {
    return JSON.parse(
      Buffer.from(process.env.FIREBASE_SERVICE_ACCOUNT_B64, "base64").toString("utf8")
    );
  }
  const candidates = [
    process.env.FIREBASE_SERVICE_ACCOUNT_PATH,
    "/etc/secrets/fbServiceAccountKey.json",
    `${__dirname}/../config/fbServiceAccountKey.json`,
  ].filter(Boolean);
  for (const file of candidates) {
    if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, "utf8"));
  }
  throw new Error(
    "Firebase service account not found: set FIREBASE_SERVICE_ACCOUNT_B64 or FIREBASE_SERVICE_ACCOUNT_PATH."
  );
}

admin.initializeApp({
  credential: admin.credential.cert(loadServiceAccount()),
});

module.exports = admin;
