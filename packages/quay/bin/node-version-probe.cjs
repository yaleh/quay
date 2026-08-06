#!/usr/bin/env node
// node-version-probe.cjs — ACTIVE Node-version probe for the quay source-execution
// entry (bin/quay.cjs -> bin/quay.ts via `node --experimental-strip-types`).
//
// gap-no-active-node-version-check-users-cant-tell-upgrade: the source-execution path
// (`node --experimental-strip-types bin/quay.ts`) requires Node >= 22.6. package.json's
// `engines` field is a PASSIVE declaration (npm install warns; a direct invocation does
// not), so a Node 20 LTS user who follows the documented invocation hits the bare
// `bad option` error with no hint that upgrading Node fixes it. This probe is the ACTIVE
// check that FAILS CLOSED with a clear message naming the required floor + an upgrade hint.
//
// CHICKEN-EGG (AC3): this file MUST execute on the oldest Node that can possibly run it
// (down to and below the floor it enforces — e.g. Node 18), so it is plain CommonJS with
// ZERO strip-types / ESM-only syntax. Nothing here may require a newer Node than it checks
// for: only `require`, `process`, and `console` — all present since Node 0.x.
//
// AC4 cross-label: the DIST path (dist/quay.js — the transpiled bundle installed via
// package.json `bin`) does NOT run through this probe; it has its own declared floor
// (dist-verify-node-floor CI), separate from the source-execution strip-types floor. See
// tasks/gap-upgrade-channel-cant-sync-build-artifacts-dist-stale.md.
"use strict";

// `node --experimental-strip-types` needs Node >= 22.6 (the source-execution floor).
const REQUIRED = { major: 22, minor: 6 };

/**
 * Parse a Node version string ("v25.2.0" / "25.2.0") into { major, minor, patch }.
 * Returns null for an unparseable value (the caller treats an unparseable version as
 * NOT meeting the floor — fail closed, never guess).
 */
function parseNodeVersion(v) {
  const m = /^v?(\d+)\.(\d+)\.(\d+)/.exec(String(v || "").trim());
  if (!m) return null;
  return { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3]) };
}

/**
 * Check a Node version string against the required floor. The criterion is parsed from the
 * version string the way Node reports it in `process.versions.node` — it does NOT trust the
 * passive `engines` declaration (that is exactly the passivity this task exists to replace).
 *
 * When `versionString` is omitted, the REAL runtime's `process.versions.node` is checked,
 * subject to the `QUAY_TEST_NODE_VERSION` deterministic test seam (DIR-009-style env
 * override, cf. QUAY_ACTION_MOCK_LOG): substituting the REPORTED version lets a scoped/CI
 * test exercise the fail-closed branch without installing an old Node. It cannot create a
 * false pass on a genuinely-too-old runtime — skipping this probe only re-surfaces the bare
 * `bad option` error the probe exists to replace.
 *
 * Returns { ok, current, required, message }:
 *   ok       — true when current >= required (safe to proceed)
 *   current  — the version string that was checked
 *   required — the floor as "22.6"
 *   message  — the fail-closed error text (meaningful only when !ok)
 */
function checkNodeVersion(versionString) {
  const current = String(
    versionString || process.env.QUAY_TEST_NODE_VERSION || process.versions.node
  );
  const required = `${REQUIRED.major}.${REQUIRED.minor}`;
  const v = parseNodeVersion(current);
  const ok =
    v !== null &&
    (v.major > REQUIRED.major || (v.major === REQUIRED.major && v.minor >= REQUIRED.minor));
  if (ok) return { ok: true, current, required, message: "" };
  return {
    ok: false,
    current,
    required,
    message:
      `quay: requires Node >= ${required} to run from source (this is Node ${current}).\n` +
      `quay: \`node --experimental-strip-types\` needs Node >= ${required}; upgrade Node and re-run.\n` +
      `quay: 升级提示 — upgrade Node (e.g. nvm install ${REQUIRED.major}) and re-run, or use the built ` +
      `dist/quay.js whose floor is declared separately (AC4).`,
  };
}

// When run directly (`node bin/node-version-probe.cjs`), act as the entry probe.
if (require.main === module) {
  const result = checkNodeVersion();
  if (!result.ok) {
    console.error(result.message);
    process.exit(1);
  }
  process.exit(0);
}

module.exports = { checkNodeVersion, parseNodeVersion, REQUIRED };
