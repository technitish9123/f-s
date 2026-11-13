/*
 * Mongoose 5 resolved Model.updateOne() with the raw MongoDB write result
 * `{ n, nModified, ok }` (or `{ ok: 0, n: 0, nModified: 0 }` when the update
 * was empty after casting). Mongoose 6+ resolves with
 * `{ acknowledged, matchedCount, modifiedCount, upsertedId, upsertedCount }`
 * (or just `{ acknowledged: false }` for an empty update).
 *
 * Routes that send that result straight to the client use this to keep the
 * response body the frontend has always received.
 */
exports.toLegacyUpdateResult = (result) => ({
  n: (result && result.matchedCount) || 0,
  nModified: (result && result.modifiedCount) || 0,
  ok: result && result.acknowledged ? 1 : 0,
});
