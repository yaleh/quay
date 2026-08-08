// node-version-check.cjs — pure-JS Node floor probe for quay's
// SOURCE-execution path (task gap-no-active-node-version-check-users-cant-tell-upgrade).
//
// WHY pure JS + CommonJS: the probe must run on a Node too old to execute the
// real CLI. `node --experimental-strip-types bin/quay.ts` needs Node >= 22.6;
// on Node < 22.6 the flag itself is rejected by node with a bare
// `bad option: --experimental-strip-types` and the user gets no hint that
// upgrading Node fixes it. A `.cjs` file runs on ANY Node with zero flags, so
// the probe can produce a clear, actionable error exactly where node's own
// error is opaque (AC3: probe is pure JS, runnable on old node).
//
// FLOOR SCOPE (AC4): the floor here (Node >= 22.6) is for the source-execution
// path ONLY. The shipped npm bin (dist/quay.js) is an esbuild bundle that runs
// on the DIST floor (Node 20, proven by the dist-verify-node-floor CI job) and
// does NOT go through this probe — the dist floor is judged separately.
"use strict";

// strip-types (`node --experimental-strip-types`) landed in Node 22.6.0.
const STRIP_TYPES_FLOOR = [22, 6]; // Node >= 22.6

// Parse "v22.6.0" or "22.6.0" → [22, 6]. Returns null for a non-parsable
// version (callers fail-open: an unparseable version never blocks).
function parseNodeVersion(raw) {
  const m = /^v?(\d+)\.(\d+)(?:\.|$)/.exec(String(raw || ""));
  if (!m) return null;
  return [Number(m[1]), Number(m[2])];
}

// Both are [major, minor]. Returns true when `actual` < `floor`.
function belowFloor(actual, floor) {
  if (actual[0] !== floor[0]) return actual[0] < floor[0];
  return actual[1] < floor[1];
}

/**
 * Core version check. Reads process.versions.node unless overridden (the
 * QUAY_NODE_VERSION_OVERRIDE env var is a deterministic test hook — the same
 * shape the dist build's QUAY_BUILD_DIST_ENTRY/OUTFILE hooks use).
 *
 * @param {{floor?: [number, number], label?: string,
 *          version?: string}} [opts] floor = [major, minor]; label names the
 *   path being judged (defaults to the source-execution path). version
 *   overrides the read version (testability).
 * @returns {{ok: boolean, version: string, floor: string, message: string}}
 *   message is non-empty exactly when ok is false.
 */
function checkNodeVersion(opts = {}) {
  const floor = opts.floor ?? STRIP_TYPES_FLOOR;
  const label =
    opts.label ??
    "the quay CLI (source-execution path: `node --experimental-strip-types bin/quay.ts`)";
  const version =
    opts.version !== undefined
      ? opts.version
      : process.env.QUAY_NODE_VERSION_OVERRIDE || process.versions.node;
  const parsed = parseNodeVersion(version);
  const ok = parsed !== null && !belowFloor(parsed, floor);
  const floorLabel = `${floor[0]}.${floor[1]}`;
  const message = ok
    ? ""
    : [
        `quay requires Node >= ${floorLabel} (needed to run ${label}), but you are running Node ${version}.`,
        `Upgrade Node to >= ${floorLabel} to run quay — e.g. with nvm: nvm install ${floor[0]} && nvm use ${floor[0]}`,
      ].join("\n");
  return { ok, version, floor: floorLabel, message };
}

// Standalone invocation (`node node-version-check.cjs`) — the AC1 real-run
// surface and the mechanism bin/quay.js delegates its own pre-flight to.
if (require.main === module) {
  const res = checkNodeVersion();
  if (!res.ok) {
    console.error(res.message);
    process.exit(1);
  }
  console.log(`Node ${res.version} meets quay's source-execution floor (>= ${res.floor})`);
  process.exit(0);
}

module.exports = { checkNodeVersion, parseNodeVersion, belowFloor, STRIP_TYPES_FLOOR };
