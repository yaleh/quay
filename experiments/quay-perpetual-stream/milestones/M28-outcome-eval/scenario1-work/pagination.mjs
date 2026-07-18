// pagination.mjs — M28-outcome-eval scenario 1 scratch deliverable.
// Standalone paginate() helper, motivated by the duplicated page-size /
// page-index clamping logic in packages/quay/bin/quay.js (resolvePageSize)
// and packages/quay/src/serve.js (separate query-param pageSize handling).
// This module does NOT modify either product file (out of scope for this
// milestone) — it demonstrates the shared logic as a standalone, tested
// unit, per scenario 1's Plan.

export function paginate(items, pageSize, pageIndex) {
  if (typeof pageSize !== "number" || !Number.isInteger(pageSize) || pageSize <= 0) {
    throw new Error(`paginate: pageSize must be a positive integer (got ${JSON.stringify(pageSize)})`);
  }
  const start = pageSize * pageIndex;
  if (start < 0 || start >= items.length) return [];
  return items.slice(start, start + pageSize);
}
