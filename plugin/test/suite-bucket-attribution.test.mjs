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
//   (a) 8 `packages/quay/test/*` files that touch `plugin/scripts`  → cross-bucket P AND M
//   (b) 20 `plugin/test/*` files that touch `packages/*/src|bin|dist` → cross-bucket (contain P)
//   (c) statically-unlocatable `plugin/test/*` files                   → UNRESOLVED
//
// Note on (c): the phase-goal baseline names "11 不可定位" as a COUNT, not a list. The strict
// reference closure implemented here (relative imports + the three path-literal prefixes, comments
// counted only as textual references where the baseline reproduces) yields the 4 files below as
// UNRESOLVED — the delta vs the baseline's count is because the baseline's "路径字面量" (167)
// was a broader subject-location heuristic than this AC's stated criterion (import relative paths +
// the three path prefixes). Those 4 are asserted here; the delta is reported, not papered over.
// (The group previously held 8 files; 4 of them — integration-batch-merge, measure-suite,
// plugin-vendor-standalone, sync-lag-check — moved to (d) once the segmented-literal signal ④ of
// gap-path-join-segmented-parse-blind-spot could read their `path.join(…, "plugin", "scripts", …)`
// subject. The 4 that remain have their `plugin` prefix in a computed variable or a helper module.)
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
  extractJoinedPathSegments,
  resolveRelative,
} from "../scripts/suite-bucket-attribution.ts";

// Repo root, derived from this test file's own location (plugin/test/ → up two levels). Deterministic,
// independent of `.quay/config.yml` (which is gitignored and absent from a fresh worktree).
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

// ── AC2 known-sample groups (exact lists, replay of the baseline) ───────────────────────────────────

// (a) 8 `packages/quay/test/*` files that touch `plugin/scripts` → cross-bucket P+M.
const GROUP_A = [
  "build-plugin-dist.test.mjs",
  "gap-dashboard-parallelize.test.mjs",
  "install-config-driven-e2e.test.mjs",
  "mcp-server.test.mjs",
  "npm-pack-e2e.test.mjs",
  "serve-ac95-views.test.mjs",
  "serve-board.test.mjs",
  "serve.test.mjs",
];

// (b) 20 `plugin/test/*` files that touch `packages/*/src|bin|dist` → cross-bucket (contain P).
// gap-suite-split-15-over-30s-test-files (2026-09-17): three entries here were split into `<stem>-sNN`
// shards. The list names the SHARD that still carries the cross-bucket reference, because the bucket is
// a property of a file's own text — the other shards of the same stem legitimately carry no P (they
// hold the tests that never touch packages/), and naming a shard without P would assert a falsehood.
// 2026-09-17 measurement: fan-in-execute-paths → s01+s03; resource-gate → s03; slot-refill → s10.
const GROUP_B = [
  "branch-model.test.mjs",
  "build-evidence-manifest.test.mjs",
  "checker-mutation-check.test.mjs",
  "codex-stage1-adapter.test.mjs",
  "direct-to-develop-bypass-check.test.mjs",
  "execute-suite-fix-scope-gate.test.mjs",
  "fan-in-execute-paths-s01.test.mjs",
  "fan-in-execute-paths-s03.test.mjs",
  "fan-in-ts-typecheck-gate.test.mjs",
  "prepare-admission-check.test.mjs",
  "provision-verify-worktree.test.mjs",
  "resource-gate-s03.test.mjs",
  "retreat-ac-uncheck.test.mjs",
  "select-tests-for-touches.test.mjs",
  "slot-refill-s10.test.mjs",
  "task-contract-check.test.mjs",
  "task-status-drift-check.test.mjs",
  "test-isolation-check.test.mjs",
  "touches-orthogonality-check.test.mjs",
  "touches-parser-parity.test.mjs",
];

// (c) statically-unlocatable `plugin/test/*` files → UNRESOLVED. Each subject's `plugin` prefix is a
// computed variable (`pluginDir = path.resolve(__dirname, "..")` — signal ④ joins only the LITERAL
// arguments, so `path.join(pluginDir, "scripts", …)` → `scripts/…`, no `plugin/` prefix); the
// mechanism must say so, not guess.
const GROUP_C = [
  "manager-arm-loop.test.mjs",
  "outer-tick-log-check.test.mjs",
  "user-scope-reinstall.test.mjs",
];

// (d) `path.join(…, "plugin", "scripts", …)` / `path.resolve(…)` adjacent-literal subject — the
// "path.join 分段拼接" blind spot (gap-path-join-segmented-parse-blind-spot). The subject is spelled
// out as ADJACENT string-literal arguments, invisible to signal ② (needs the whole path in one quote
// pair) and signal ③ (needs contiguous text — a comma-space breaks it); joining the adjacent run
// recovers it. Map: file → exact expected bucket set (a singleton).
const GROUP_D = {
  "integration-batch-merge.test.mjs": ["M"], // join(repoRoot, "plugin", "scripts", …) — destructured `join`
  "sync-lag-check.test.mjs": ["M"],          // join(repoRoot, "plugin", "scripts", …)
  "plugin-vendor-standalone.test.mjs": ["P"], // path.join(repoRoot, "packages", "quay-native", "bin", …)
};

// ── AC2(a) ───────────────────────────────────────────────────────────────────────────────────────────

test("AC2(a): the 8 packages/quay/test files touching plugin/scripts are cross-bucket P AND M", () => {
  assert.equal(GROUP_A.length, 8, "group (a) must be exactly 8 files");
  for (const f of GROUP_A) {
    const rel = `packages/quay/test/${f}`;
    const buckets = bucketSetOf(rel, ROOT);
    assert.ok(buckets.has("P"), `${f}: should be attributed P (packages home / product)`);
    assert.ok(buckets.has("M"), `${f}: should be attributed M (touches plugin/scripts)`);
  }
});

// ── AC2(b) ───────────────────────────────────────────────────────────────────────────────────────────

test("AC2(b): the 20 plugin/test files touching packages src are cross-bucket (contain P)", () => {
  assert.equal(GROUP_B.length, 20, "group (b) must be exactly 20 files (3 monoliths → 4 P-carrying shards, 2026-09-17)");
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

// ── AC2(d) — the segmented-literal blind spot ────────────────────────────────────────────────────────

test("AC2(d): segmented path.join/path.resolve subjects attribute to their source-tree bucket", () => {
  assert.equal(Object.keys(GROUP_D).length, 3, "group (d) must be exactly 3 files");
  for (const [f, want] of Object.entries(GROUP_D)) {
    const rel = `plugin/test/${f}`;
    const buckets = bucketSetOf(rel, ROOT);
    assert.deepEqual(
      [...buckets].sort(),
      want,
      `${f}: segmented subject must attribute exactly ${want.join("+")}`,
    );
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

test("AC1: extractJoinedPathSegments joins adjacent string-literal argument runs", () => {
  // path.join with a leading non-literal, then a 3-literal run.
  assert.deepEqual(
    extractJoinedPathSegments(`const x = path.join(repoRoot, "plugin", "scripts", "measure-suite-reporter.mjs");`),
    ["plugin/scripts/measure-suite-reporter.mjs"],
  );
  // destructured bare join, and a `..`-prefixed run (a relative anchor) is still extracted verbatim.
  assert.deepEqual(
    extractJoinedPathSegments(`const a = join(__dirname, "..", ".."); const b = join(a, "plugin", "scripts", "x.sh");`),
    ["../..", "plugin/scripts/x.sh"],
  );
  // a run interrupted by a non-literal is NOT joined past the interruption.
  assert.deepEqual(
    extractJoinedPathSegments(`path.join(pluginDir, "scripts", "manager-arm-loop.sh")`),
    ["scripts/manager-arm-loop.sh"],
  );
  // an interpolated template literal breaks the run (it is not a static segment).
  assert.deepEqual(
    extractJoinedPathSegments(`path.join(r, "plugin", "scripts", \`\${name}.ts\`)`),
    ["plugin/scripts"],
  );
  // a single literal argument is not a "run" (signal ③ already sees the contiguous form).
  assert.deepEqual(
    extractJoinedPathSegments(`path.join(r, "plugin/scripts/foo.ts")`),
    [],
  );
});

// ── Negative controls: the mechanism discriminates (a same-bucket file is NOT cross-bucket) ──────────

test("AC1 negative control: a pure-P product test is not attributed M", () => {
  // acceptance-env.test.mjs tests the acceptance gate env surface only — no plugin/scripts reference.
  const buckets = bucketSetOf("packages/quay/test/acceptance-env.test.mjs", ROOT);
  assert.ok(buckets.has("P"));
  assert.ok(!buckets.has("M"), "a P-only file must not gain M from its directory or basename");
});

test("AC1 negative control: a pure-M mechanism test is not attributed P", () => {
  // outer-driver.test.mjs tests a plugin mechanism only — no packages/src reference.
  // (was a15-ruling5-counter.test.mjs — retired 2026-08-29 with gap-retire-halt-file-driver-based.)
  const buckets = bucketSetOf("plugin/test/outer-driver.test.mjs", ROOT);
  assert.ok(buckets.has("M"));
  assert.ok(!buckets.has("P"), "a M-only file must not gain P from its directory or basename");
});

test("AC1 negative control: a RELATIVE segmented run does not substring-match a bucket", () => {
  // delivery-status-single-source.test.mjs has
  //   path.resolve(__dirname, "..", "..", "packages", "quay", "src", "serve-send.ts")
  // — a RELATIVE run whose joined `../../packages/quay/src/serve-send.ts` EMBEDS the P prefix. Signal ④
  // must NOT classify it (classifyPath would substring-match the embedded `packages/quay/src/` on a
  // `.`-prefixed run — a false P). The file stays M (its `plugin/scripts/transcript-delivery-check.ts`
  // header reference), not P+M.
  const buckets = bucketSetOf("plugin/test/delivery-status-single-source.test.mjs", ROOT);
  assert.ok(buckets.has("M"), "delivery-status-single-source references the M checker (header)");
  assert.ok(!buckets.has("P"), "a relative `../../packages/…` run must not substring-match P");
});
