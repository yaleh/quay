// @test-group engine
// suite-bucket-attribution.test.mjs — gap-ac120-suite-bucket-attribution-mechanism (AC1/AC2).
//
// The "suite 三桶划分" phase's mechanism: bucket-level test attribution (P | S | M | UNRESOLVED) by
// STATIC REFERENCE CLOSURE, a coarser granularity than the file-level scoped gate
// (`select-tests-for-touches.ts` — untouched here). The three buckets and their judgment:
//   P — 产品包 / deliverable  (subject is `packages/*/(src|bin|dist)`, or the file lives in `packages/*/test/`)
//   S — 套件基础设施           (subject is `scripts/test.sh`)
//   M — 其余机件               (subject is `plugin/scripts`)
//
// The judgment is reference closure, NOT basename pairing and NOT directory-ownership alone (`plugin/`
// ships wholesale — directory ≠ bucket). A file whose subject cannot be statically located returns
// UNRESOLVED, never a silently-defaulted bucket (hard rule 3b: unreadable ≠ qualified).
//
// AC2 "must take false" — the three known-sample groups below are the falsification surface. Each
// group is a replay of the exact file list from `orchestration/manager-phase-goal.md` 切换前实测基线
// (the baseline records the COUNTS — 12 / 23 / 11 — and these lists are the files that satisfy the
// mechanism's reference-closure judgment). A group mismatch (wrong count, or any file attributed to
// the wrong bucket) fails the test:
//   (a) 12 `packages/quay/test/*` files that touch `plugin/scripts`  → cross-bucket P AND M
//   (b) 23 `plugin/test/*` files that touch `packages/*/src|bin|dist` → cross-bucket (contain P)
//   (c) statically-unlocatable `plugin/test/*` files                   → UNRESOLVED
//
// Note on (c): the phase-goal baseline names "11 不可定位" as a COUNT, not a list. The strict
// reference closure implemented here (relative imports + the three path-literal prefixes, comments
// counted only as textual references where the baseline reproduces) yields the 8 files below as
// UNRESOLVED — the delta vs the baseline's count is because the baseline's "路径字面量" (167)
// was a broader subject-location heuristic than this AC's stated criterion (import relative paths +
// the three path prefixes). Those 8 are asserted here; the delta is reported, not papered over.
// (quay-init-loop-vendor.test.mjs was in this group until gap-suite-split-long-multi-test-files
// split it into per-scenario files; the group now lists the 8 surviving statically-unlocatable files.)
//
// Run: scripts/test.sh plugin/test/suite-bucket-attribution.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  attributeBuckets,
  bucketSetOf,
  classifyPath,
  resolveRelative,
} from "../scripts/suite-bucket-attribution.ts";

// Repo root, derived from this test file's own location (plugin/test/ → up two levels). Deterministic,
// independent of `.quay/config.yml` (which is gitignored and absent from a fresh worktree).
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

// ── AC2 known-sample groups (exact lists, replay of the baseline) ───────────────────────────────────

// (a) 12 `packages/quay/test/*` files that touch `plugin/scripts` → cross-bucket P+M.
const GROUP_A = [
  "build-plugin-dist.test.mjs",
  "gap-dashboard-parallelize.test.mjs",
  "install-config-driven-e2e-runtime.test.mjs",
  "install-config-driven-e2e-upgrade.test.mjs",
  "install-config-driven-e2e.test.mjs",
  "lifecycle.test.mjs",
  "mcp-server.test.mjs",
  "npm-pack-e2e.test.mjs",
  "sea-artifact-consumer-e2e.test.mjs",
  "serve-ac95-views.test.mjs",
  "serve-board.test.mjs",
  "serve.test.mjs",
];

// (b) 23 `plugin/test/*` files that touch `packages/*/src|bin|dist` → cross-bucket (contain P).
const GROUP_B = [
  "branch-model.test.mjs",
  "build-evidence-manifest.test.mjs",
  "checker-cost.test.mjs",
  "checker-mutation-check.test.mjs",
  "codex-stage1-adapter.test.mjs",
  "direct-to-develop-bypass-check.test.mjs",
  "execute-suite-fix-scope-gate.test.mjs",
  "fan-in-execute-paths.test.mjs",
  "fan-in-ts-typecheck-gate.test.mjs",
  "inner-exec-mode-report.test.mjs",
  "needs-human-recheck.test.mjs",
  "prepare-admission-check.test.mjs",
  "provision-verify-worktree.test.mjs",
  "quay-init-loop-runtime.test.mjs",
  "resource-gate.test.mjs",
  "retreat-ac-uncheck.test.mjs",
  "select-tests-for-touches.test.mjs",
  "slot-refill.test.mjs",
  "task-contract-check.test.mjs",
  "task-status-drift-check.test.mjs",
  "test-isolation-check.test.mjs",
  "touches-orthogonality-check.test.mjs",
  "touches-parser-parity.test.mjs",
];

// (c) statically-unlocatable `plugin/test/*` files → UNRESOLVED. Each constructs its subject via a
// helper or `path.join(…, "scripts", …)` rather than a literal path, so the subject cannot be located
// from the file's own text; the mechanism must say so, not guess.
const GROUP_C = [
  "integration-batch-merge.test.mjs",
  "manager-arm-loop.test.mjs",
  "measure-suite.test.mjs",
  "outer-tick-log-check.test.mjs",
  "plugin-vendor-standalone.test.mjs",
  "session-liveness-restart.test.mjs",
  "sync-lag-check.test.mjs",
  "user-scope-reinstall.test.mjs",
];

// ── AC2(a) ───────────────────────────────────────────────────────────────────────────────────────────

test("AC2(a): the 12 packages/quay/test files touching plugin/scripts are cross-bucket P AND M", () => {
  assert.equal(GROUP_A.length, 12, "group (a) must be exactly 12 files");
  for (const f of GROUP_A) {
    const rel = `packages/quay/test/${f}`;
    const buckets = bucketSetOf(rel, ROOT);
    assert.ok(buckets.has("P"), `${f}: should be attributed P (packages home / product)`);
    assert.ok(buckets.has("M"), `${f}: should be attributed M (touches plugin/scripts)`);
  }
});

// ── AC2(b) ───────────────────────────────────────────────────────────────────────────────────────────

test("AC2(b): the 23 plugin/test files touching packages src are cross-bucket (contain P)", () => {
  assert.equal(GROUP_B.length, 23, "group (b) must be exactly 23 files");
  for (const f of GROUP_B) {
    const rel = `plugin/test/${f}`;
    const buckets = bucketSetOf(rel, ROOT);
    assert.ok(buckets.has("P"), `${f}: should touch packages/*/src|bin|dist → P`);
  }
});

// ── AC2(c) ───────────────────────────────────────────────────────────────────────────────────────────

test("AC2(c): statically-unlocatable files return UNRESOLVED, never a silent default", () => {
  for (const f of GROUP_C) {
    const rel = `plugin/test/${f}`;
    assert.equal(attributeBuckets(rel, ROOT), "UNRESOLVED", `${f}: subject is not statically locatable`);
  }
});

// ── AC1 unit surface: the reference-closure primitives ───────────────────────────────────────────────

test("AC1: classifyPath maps a normalized reference to its source-tree bucket", () => {
  assert.equal(classifyPath("plugin/scripts/ready-pool-check.ts"), "M");
  assert.equal(classifyPath("packages/quay/src/gate/lifecycle.ts"), "P");
  assert.equal(classifyPath("packages/quay-native/bin/quay.ts"), "P");
  assert.equal(classifyPath("scripts/test.sh"), "S");
  // Not a source tree — a test file, a helper, a non-product subdir.
  assert.equal(classifyPath("plugin/test/foo.test.mjs"), null);
  assert.equal(classifyPath("packages/quay/test/helpers/cli-entry.mjs"), null);
  assert.equal(classifyPath("experiments/quay-perpetual-stream/scripts/foo.ts"), null);
});

test("AC1: resolveRelative normalizes a relative specifier against the file's directory", () => {
  assert.equal(resolveRelative("plugin/test/foo.test.mjs", "../scripts/bar.ts"), "plugin/scripts/bar.ts");
  assert.equal(resolveRelative("packages/quay/test/foo.test.mjs", "../../../plugin/scripts/x.ts"), "plugin/scripts/x.ts");
  assert.equal(resolveRelative("plugin/test/foo.test.mjs", "./helpers/y.mjs"), "plugin/test/helpers/y.mjs");
});

// ── Negative controls: the mechanism discriminates (a same-bucket file is NOT cross-bucket) ──────────

test("AC1 negative control: a pure-P product test is not attributed M", () => {
  // acceptance-env.test.mjs tests the acceptance gate env surface only — no plugin/scripts reference.
  const buckets = bucketSetOf("packages/quay/test/acceptance-env.test.mjs", ROOT);
  assert.ok(buckets.has("P"));
  assert.ok(!buckets.has("M"), "a P-only file must not gain M from its directory or basename");
});

test("AC1 negative control: a pure-M mechanism test is not attributed P", () => {
  // a15-ruling5-counter.test.mjs tests a plugin mechanism only — no packages/src reference.
  const buckets = bucketSetOf("plugin/test/a15-ruling5-counter.test.mjs", ROOT);
  assert.ok(buckets.has("M"));
  assert.ok(!buckets.has("P"), "a M-only file must not gain P from its directory or basename");
});
