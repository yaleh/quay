// @test-group engine
// suite-bucket-select.test.mjs — gap-ac124-suite-bucket-production-carrier-benefit: the bucket-level
// test SELECTOR (the fan-out consumer of AC120 attribution + AC121 reattribution + AC122 hub list +
// AC123 both-sides). This is the enablement half of the phase's final task: a change ⇒ which bucket
// (P-only ⇒ P, M-only ⇒ M, hub ⇒ full, no-bucket ⇒ full fail-closed), and which test files that bucket
// runs — with UNRESOLVED always selected (AC123 安全侧不做减法: a test whose subject cannot be located
// must not be skipped).
//
// Assertions are INVARIANTS over the real repo, not hardcoded file counts (which drift as tests are
// added/renamed): cross-bucket both-sides, UNRESOLVED-always-selected, hub fallback, no-bucket
// fail-closed, and the P/M/S/mirror triggered-bucket classification.
//
// Run: scripts/test.sh plugin/test/suite-bucket-select.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  listSuiteFiles,
  loadReattribution,
  effectiveBucketSet,
  effectiveBucketAttribution,
  computeEffectiveAttribution,
  writeBucketAttribution,
  triggeredBuckets,
  selectBucketsForTouches,
} from "../scripts/suite-bucket-select.ts";
import { bucketSetOf } from "../scripts/suite-bucket-attribution.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

// ── triggered-bucket classification (the change's source files → buckets) ──────────────────────────

test("triggeredBuckets classifies P/M/S source trees, incl. the experiments mirror fold", () => {
  assert.deepEqual([...triggeredBuckets(["packages/quay/src/gate/lifecycle.ts"])], ["P"]);
  assert.deepEqual([...triggeredBuckets(["packages/quay-native/bin/foo.ts"])], ["P"]);
  assert.deepEqual([...triggeredBuckets(["plugin/scripts/ready-pool-check.ts"])], ["M"]);
  assert.deepEqual([...triggeredBuckets(["scripts/test.sh"])], ["S"]);
  // the experiments→plugin scripts mirror folds to M (single-source mirror convention)
  assert.deepEqual([...triggeredBuckets(["experiments/quay-perpetual-stream/scripts/foo.ts"])], ["M"]);
  // a test-file / doc / task path triggers no source bucket
  assert.deepEqual([...triggeredBuckets(["plugin/test/foo.test.mjs", "tasks/bar.md", "docs/x.md"])], []);
  // P+M
  assert.deepEqual(
    [...triggeredBuckets(["packages/quay/src/a.ts", "plugin/scripts/b.ts"])].sort(),
    ["M", "P"],
  );
});

// ── effective bucket set: reattribution override vs AC120 attribution ───────────────────────────────

test("effectiveBucketSet applies the AC121 reattribution override as a singleton", () => {
  const reattr = loadReattribution(ROOT);
  assert.ok(reattr.size > 0, "the reattribution map must be present in this repo");
  // a "test.sh-as-shell" test re-attributed to M (its AC120 closure would also see S)
  const overridden = [...reattr.keys()].find((f) => reattr.get(f) === "M");
  assert.ok(overridden, "there must be at least one M-judgment entry");
  const eff = effectiveBucketSet(overridden, reattr, ROOT);
  assert.deepEqual([...eff], ["M"], `${overridden} must be re-attributed to a singleton M`);
});

test("effectiveBucketSet falls back to AC120 attribution for non-reattributed files", () => {
  const reattr = loadReattribution(ROOT);
  const ptest = "packages/quay/test/npm-pack-e2e.test.mjs";
  assert.ok(fs.existsSync(path.join(ROOT, ptest)), "fixture test must exist");
  const eff = effectiveBucketSet(ptest, reattr, ROOT);
  // a product test that references plugin/scripts — cross-bucket {P,M} by AC120
  assert.ok(eff.has("P"), `${ptest} must be attributed P`);
  assert.ok(eff.has("M"), `${ptest} must be attributed M (cross-bucket)`);
});

test("mirror fold: an experiments test importing ../scripts/X.ts attributes to M, not UNRESOLVED", () => {
  const reattr = loadReattribution(ROOT);
  // task-schema.test.mjs imports ../scripts/task-schema.ts — the experiments mirror of plugin/scripts,
  // which AC120's classifyPath alone cannot resolve (it only knows plugin/scripts).
  const eff = effectiveBucketSet("experiments/quay-perpetual-stream/test/task-schema.test.mjs", reattr, ROOT);
  assert.ok(eff.has("M"), "a mirror-importing experiments test must attribute M (folded)");
});

// ── the selection: P-only / M-only / hub / no-bucket ────────────────────────────────────────────────

const CROSS_BUCKET_P = "packages/quay/test/npm-pack-e2e.test.mjs"; // {P,M} — AC123 both-sides sample
const PURE_M = "plugin/test/concurrent-batch-scheduler.test.mjs"; // reattributed M (test.sh-as-shell)

function unresolvedFiles() {
  const reattr = loadReattribution(ROOT);
  return listSuiteFiles(ROOT).filter((f) => effectiveBucketSet(f, reattr, ROOT).size === 0);
}

test("P-only change: selects P bucket, includes cross-bucket + UNRESOLVED, excludes pure-M", () => {
  const sel = selectBucketsForTouches(["packages/quay/src/gate/lifecycle.ts"], ROOT);
  assert.equal(sel.fullSuite, false, "a P-only change is not full-suite");
  assert.equal(sel.buckets, "P");
  assert.ok(sel.selectedFiles.includes(CROSS_BUCKET_P), "cross-bucket P test must be in the P selection");
  const unresolved = unresolvedFiles();
  assert.ok(unresolved.length > 0, "there must be UNRESOLVED tests in this repo");
  for (const u of unresolved) {
    assert.ok(sel.selectedFiles.includes(u), `UNRESOLVED ${u} must always be selected (safe side)`);
  }
  assert.ok(!sel.selectedFiles.includes(PURE_M), "a pure-M test must NOT be in the P selection");
  assert.ok(sel.fileCount < listSuiteFiles(ROOT).length, "P bucket is a strict subset of the full suite");
});

test("M-only change: selects M bucket, cross-bucket P test included (AC123 both-sides)", () => {
  const sel = selectBucketsForTouches(["plugin/scripts/ready-pool-check.ts"], ROOT);
  assert.equal(sel.fullSuite, false);
  assert.equal(sel.buckets, "M");
  assert.ok(sel.selectedFiles.includes(CROSS_BUCKET_P), "cross-bucket P test must be in the M selection too (both-sides)");
  assert.ok(sel.selectedFiles.includes(PURE_M), "a pure-M test must be in the M selection");
  assert.ok(sel.fileCount < listSuiteFiles(ROOT).length, "M bucket is a strict subset of the full suite");
});

test("hub change: touching any hub file falls back to the FULL suite unconditionally", () => {
  for (const hub of [
    "scripts/test.sh",
    "plugin/scripts/full-suite-runner.ts",
    "plugin/scripts/select-tests-for-touches.ts",
  ]) {
    const sel = selectBucketsForTouches([hub], ROOT);
    assert.equal(sel.fullSuite, true, `${hub} must force full suite`);
    assert.equal(sel.buckets, "full");
    assert.equal(sel.fileCount, listSuiteFiles(ROOT).length, "full = the whole suite file list");
  }
});

test("no-bucket change (doc/task only) fails closed to FULL suite", () => {
  const sel = selectBucketsForTouches(["tasks/foo.md", "docs/proposals/x.md"], ROOT);
  assert.equal(sel.fullSuite, true, "an unclassifiable code change must not look like 'nothing to run'");
  assert.equal(sel.buckets, "full");
});

test("P+M change selects the union of both buckets", () => {
  const sel = selectBucketsForTouches(["packages/quay/src/a.ts", "plugin/scripts/b.ts"], ROOT);
  assert.equal(sel.fullSuite, false);
  assert.equal(sel.buckets, "P+M");
  assert.ok(sel.selectedFiles.includes(CROSS_BUCKET_P));
  assert.ok(sel.selectedFiles.includes(PURE_M));
});

// ── enumeration sanity (the selector must list the SAME universe test.sh runs, not a recursive one) ──

test("listSuiteFiles matches test.sh's shallow glob universe (no nested fixtures)", () => {
  const files = listSuiteFiles(ROOT);
  assert.ok(files.length > 400, `expected >400 suite files, got ${files.length}`);
  // the nested runner-fixtures are NOT part of test.sh's shallow glob — they must be excluded
  assert.ok(!files.includes("plugin/test/runner-fixtures/nodecl.test.mjs"), "nested fixture must be excluded");
  assert.ok(files.includes("packages/quay/test/npm-pack-e2e.test.mjs"));
});

// ── single truth source (gap-bucket-second-truth-source-page-recompute) ─────────────────────────────

test("effectiveBucketAttribution records which path won (reattr | static | mirror-fold | unresolved)", () => {
  const reattr = loadReattribution(ROOT);
  // The reattribution override (AC121) wins for a test.sh-as-shell re-attributed to M.
  assert.equal(effectiveBucketAttribution("plugin/test/dead-loop-check.test.mjs", reattr, ROOT).source, "reattr");
  // A non-reattributed product test wins via the static closure (AC120), not the override.
  assert.equal(effectiveBucketAttribution("packages/quay/test/npm-pack-e2e.test.mjs", reattr, ROOT).source, "static");
  // A mirror-importing experiments test wins via the mirror fold (AC120 alone cannot resolve it).
  assert.equal(effectiveBucketAttribution("experiments/quay-perpetual-stream/test/task-schema.test.mjs", reattr, ROOT).source, "mirror-fold");
});

test("single truth source: the artifact carries effectiveBucketSet + source, and the two formerly-divergent examples resolve to the reattribution judgment M", () => {
  const files = listSuiteFiles(ROOT);
  const reattr = loadReattribution(ROOT);
  const attribution = computeEffectiveAttribution(files, reattr, ROOT);

  // The two files the display mirror used to mis-colour (its self-computed {S} / {S,M} vs the
  // dispatch's reattributed M). The single truth source must say M for BOTH.
  for (const f of ["plugin/test/dead-loop-check.test.mjs", "plugin/test/fan-in-ff-protocol-check.test.mjs"]) {
    const a = attribution.get(f);
    assert.ok(a, `${f} must be in the attribution map`);
    assert.deepEqual([...a.buckets], ["M"], `${f} must attribute to the reattribution judgment M`);
    assert.equal(a.source, "reattr", `${f} wins via the reattribution override`);
  }

  // Every attribution carries one of the four provenance values, and an unresolved attribution is an
  // empty bucket set (never a silent default — hard rule 3b).
  for (const [, a] of attribution) {
    assert.ok(["reattr", "static", "mirror-fold", "unresolved"].includes(a.source), `source ${a.source} is one of the four provenance values`);
    if (a.source === "unresolved") assert.equal(a.buckets.size, 0, "an unresolved attribution is an empty bucket set");
  }

  // The artifact is written to `.quay/suite-bucket-effective.jsonl` (a TEMP root so the test never
  // dirties the repo's own .quay/), keyed by repo-relative path, with the same map.
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "quay-bucket-effective-"));
  try {
    fs.mkdirSync(path.join(tmp, ".quay"), { recursive: true });
    writeBucketAttribution(tmp, attribution);
    const written = fs.readFileSync(path.join(tmp, ".quay", "suite-bucket-effective.jsonl"), "utf8");
    const parsed = new Map(
      written.split(/\r?\n/).filter(Boolean).map((l) => {
        const o = JSON.parse(l);
        return [o.file, o];
      }),
    );
    assert.equal(parsed.size, attribution.size, "the artifact carries one line per suite file");
    for (const f of ["plugin/test/dead-loop-check.test.mjs", "plugin/test/fan-in-ff-protocol-check.test.mjs"]) {
      assert.deepEqual(parsed.get(f).buckets, ["M"], `artifact line for ${f} carries buckets ["M"]`);
      assert.equal(parsed.get(f).source, "reattr", `artifact line for ${f} carries source "reattr"`);
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
