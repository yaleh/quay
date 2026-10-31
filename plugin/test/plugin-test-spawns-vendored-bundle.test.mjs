// @test-group engine
// plugin-test-spawns-vendored-bundle.test.mjs — tasks/gap-main-checkout-vendored-dist-stale
// (AC1/AC2): the main checkout's vendored Core bundle
// `plugin/vendor/quay/dist/quay.js` must carry the SAME version as `plugin/VERSION`.
//
// WHAT WAS BROKEN (measured 2026-10-31): `plugin/VERSION` had moved to 0.30.0-dev while the
// gitignored vendored bundle still said 0.25.0-dev — it had never been `sync-vendor --sync-dist`
// rebuilt since the 0.25.0-dev build. The staleness was SILENT: `--version` and `VERSION`
// disagreed but nothing checked (same failure shape as [[plugin-test-spawns-vendored-bundle-
// needs-sync-vendor]]). `publish-dist-branch.sh` then copied that stale dist into a consumer's
// stable location, overwriting a newer install with 0.25.0-dev.
//
// The two arms here are a DETECTION, not a rebuild: this file IS the "version bump without
// rebuild ⇒ red" guard. (The rebuild itself is done by scripts/test.sh's build_dist_once +
// sync-vendor --sync-dist before tests run; a hand-run `node --test` on this file bypasses that,
// so it also reds on a genuinely stale checkout — the exact situation the gap names.)
//
//   - AC1/positive arm: `node plugin/vendor/quay/dist/quay.js --version` == `plugin/VERSION`.
//   - AC2/negative arm (能取假): patch a COPY of the bundle's inlined version token to an OLD
//     version, then the SAME detection must report mismatch / a non-zero exit. The copy is a
//     throwaway in the tmp dir — this test never writes inside the repo (test-isolation contract).

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { readEmbeddedVersion, restampEmbeddedVersion } from "../../scripts/version-consistency-check.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../..");
const PLUGIN_DIR = path.join(REPO_ROOT, "plugin");
const VERSION_FILE = path.join(PLUGIN_DIR, "VERSION");
const DIST_BUNDLE = path.join(PLUGIN_DIR, "vendor", "quay", "dist", "quay.js");

/** The single source the bundle must agree with — plugin/VERSION (a version carrier). */
function pluginVersion() {
  const v = fs.readFileSync(VERSION_FILE, "utf8").trim();
  assert.ok(v.length > 0, "plugin/VERSION must be a non-empty version string");
  return v;
}

/**
 * THE DETECTION (AC2): the vendored dist's `--version` output must equal `expectedVersion`.
 * Returns the exit code the check would produce (0 = match, 1 = stale) plus the raw readings,
 * so both arms assert the SAME function body — the negative arm cannot "prove" a different
 * predicate than the positive arm (硬规则 3b / 4: a detection whose two arms judge different
 * things is not a detection).
 */
function detectStaleDist(distPath, expectedVersion) {
  const r = spawnSync(process.execPath, [distPath, "--version"], { encoding: "utf8" });
  const distVersion = (r.stdout ?? "").trim();
  const exitCode = r.status === 0 && distVersion === expectedVersion ? 0 : 1;
  return {
    exitCode,
    distVersion,
    expectedVersion,
    spawnStatus: r.status,
    stderr: (r.stderr ?? "").trim(),
  };
}

test("AC1: the vendored Core bundle --version equals plugin/VERSION (a stale dist reds here)", () => {
  const expected = pluginVersion();
  const r = detectStaleDist(DIST_BUNDLE, expected);
  assert.equal(
    r.spawnStatus,
    0,
    `vendored dist --version must run cleanly (stderr: ${r.stderr || "(none)"})`
  );
  assert.equal(
    r.exitCode,
    0,
    `vendored dist --version (${r.distVersion}) must equal plugin/VERSION (${r.expectedVersion}) ` +
      `— the bundle is stale; rebuild via scripts/test.sh (build_dist_once + sync-vendor --sync-dist)`
  );
});

test("AC2 negative arm: a stale bundle (old inlined version) makes the SAME detection exit non-zero", () => {
  const expected = pluginVersion();
  const staleVersion = "0.0.0-stale-fixture";

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "vendored-dist-stale-"));
  try {
    const staleDist = path.join(tmp, "quay.js");
    fs.copyFileSync(DIST_BUNDLE, staleDist);

    // Positive pre-condition on the fixture: the copy starts CONSISTENT, so a later failure is
    // attributable to the stale patch, not to a broken copy (硬规则 3b — a red that says nothing
    // about staleness is not a control).
    const before = detectStaleDist(staleDist, expected);
    assert.equal(
      before.exitCode,
      0,
      `the unpatched copy must match plugin/VERSION first (got ${before.distVersion}); otherwise the negative control is vacuous`
    );

    // Patch the bundle's INLINED version token (the same token --version reads) to an OLD version.
    const wrote = restampEmbeddedVersion(staleDist, staleVersion);
    assert.equal(wrote, true, "the stale patch must actually rewrite the inlined version token");
    assert.equal(
      readEmbeddedVersion(staleDist).version,
      staleVersion,
      "the inlined token must read back as the stale version (the patch must hit the version field, not some other token)"
    );

    // The SAME detection, same expectedVersion, on the stale copy — must now report mismatch.
    const after = detectStaleDist(staleDist, expected);
    assert.equal(after.distVersion, staleVersion, `the stale copy must report ${staleVersion} (got ${after.distVersion})`);
    assert.equal(
      after.exitCode,
      1,
      `a stale vendored dist must fail the detection with exit 1 (dist ${after.distVersion} != plugin/VERSION ${after.expectedVersion})`
    );
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
