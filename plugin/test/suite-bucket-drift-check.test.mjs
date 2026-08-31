// @test-group engine
// suite-bucket-drift-check.test.mjs — gap-suite-bucket-dynamic-truth-drift-detector (②/③ ACs).
//
// THE DEFECT THIS CLOSES: suite-bucket-attribution's STATIC reference closure cannot see a subject
// reached through a VARIABLE path segment — worktree-root-fs-check.test.mjs does
// `const pluginDir = path.resolve(__dirname, "..")` then
// `spawnSync("bash", [path.join(pluginDir, "scripts", "quay-init.sh")])`, so the static closure sees
// only the `scripts/quay-init.sh` fragment (no `plugin/scripts` prefix) and attributes the test S
// (from its `--test-command scripts/test.sh` mention), missing the M subject entirely. That
// mis-attribution was SILENT. This test pins:
//   ②-AC1  the dynamic trace captures the variable-path.join path (both synthetically and on the
//          real worktree-root-fs-check.test.mjs) — each can take false.
//   ②-AC2  incremental cache: an unchanged test is skipped, never re-traced.
//   ③-AC1  static S singleton + dynamic M ⇒ static-vs-truth-drift RED (the loud half).
//   ③-AC2  negative control: a correctly-attributed test reports no drift.
//   ③-AC3  the checker is wired into run_static_checks (the registry, not a prose claim).
//
// Run:
//   scripts/test.sh plugin/test/suite-bucket-drift-check.test.mjs
//   node --test plugin/test/suite-bucket-drift-check.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");

import { traceOne, updateTraceCache, loadTraceCache, contentHash } from "../scripts/suite-fs-trace.ts";
import { checkStaticVsTruth, checkTruthSelection, missingDynamicBuckets } from "../scripts/suite-bucket-drift-check.ts";
import { bucketSetOf } from "../scripts/suite-bucket-attribution.ts";

function makeTmp(prefix) { return fs.mkdtempSync(path.join(os.tmpdir(), `sbdc-${prefix}-`)); }
function cleanup(dir) { try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* best-effort */ } }

/** A fixture root with the minimal suite dirs + files (a test file, an optional trace cache). */
function makeFixture(files) {
  const root = makeTmp("fix");
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(root, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content, "utf8");
  }
  return root;
}

// ── ②-AC1 — the dynamic trace captures a variable-path.join path (the static blind spot) ────────────

test("②-AC1 — traceOne captures a variable path.join subject (pluginDir is a VARIABLE, not a literal)", () => {
  const root = makeFixture({
    "plugin/scripts/quay-init.sh": "#!/usr/bin/env bash\nexit 0\n",
    "plugin/test/varjoin.test.mjs": [
      `import { spawnSync } from "node:child_process";`,
      `import path from "node:path";`,
      `import { fileURLToPath } from "node:url";`,
      `import { test } from "node:test";`,
      `const __dirname = path.dirname(fileURLToPath(import.meta.url));`,
      `const pluginDir = path.resolve(__dirname, "..");`,
      `test("probe", () => {`,
      `  spawnSync("bash", [path.join(pluginDir, "scripts", "quay-init.sh"), "--help"], { encoding: "utf8" });`,
      `});`,
    ].join("\n"),
  });
  try {
    const r = traceOne("plugin/test/varjoin.test.mjs", root);
    assert.equal(r.status, 0, `trace must run clean, got status ${r.status}: ${r.error}`);
    assert.ok(
      r.reads.includes("plugin/scripts/quay-init.sh") || r.writes.includes("plugin/scripts/quay-init.sh"),
      `the dynamic truth must contain plugin/scripts/quay-init.sh, got reads=${JSON.stringify(r.reads)} writes=${JSON.stringify(r.writes)}`,
    );
  } finally { cleanup(root); }
});

test("②-AC1 (literal) — the real worktree-root-fs-check.test.mjs dynamic truth contains plugin/scripts/quay-init.sh (static attribution says S)", () => {
  // Static proof the blind spot exists: the static attribution is S (not M)…
  assert.equal(bucketSetOf("plugin/test/worktree-root-fs-check.test.mjs", REPO_ROOT).has("S"), true, "static attribution must be S (its scripts/test.sh mention)");
  assert.equal(bucketSetOf("plugin/test/worktree-root-fs-check.test.mjs", REPO_ROOT).has("M"), false, "static attribution must MISS M (the variable path.join)");
  // …and the dynamic trace sees it.
  const r = traceOne("plugin/test/worktree-root-fs-check.test.mjs", REPO_ROOT, 120_000);
  assert.equal(r.status, 0, `trace must run clean, got status ${r.status}: ${r.error}`);
  assert.ok(
    r.reads.includes("plugin/scripts/quay-init.sh"),
    `the dynamic truth must contain plugin/scripts/quay-init.sh, got reads=${JSON.stringify(r.reads)}`,
  );
});

// ── ②-AC2 — incremental cache ────────────────────────────────────────────────────────────────────────

test("②-AC2 — updateTraceCache re-runs the trace only for changed/new tests (an unchanged test is skipped)", () => {
  const root = makeFixture({
    "plugin/scripts/quay-init.sh": "#!/usr/bin/env bash\nexit 0\n",
    "plugin/test/varjoin.test.mjs": [
      `import { spawnSync } from "node:child_process";`,
      `import path from "node:path";`,
      `import { fileURLToPath } from "node:url";`,
      `import { test } from "node:test";`,
      `const __dirname = path.dirname(fileURLToPath(import.meta.url));`,
      `const pluginDir = path.resolve(__dirname, "..");`,
      `test("probe", () => { spawnSync("bash", [path.join(pluginDir, "scripts", "quay-init.sh")], { encoding: "utf8" }); });`,
    ].join("\n"),
  });
  try {
    const files = ["plugin/test/varjoin.test.mjs"];
    const first = updateTraceCache(root, files);
    assert.equal(first.traced.length, 1, "first update traces the (new) test");
    assert.equal(first.failed.length, 0, `first update must not fail: ${first.failed.join("; ")}`);
    const second = updateTraceCache(root, files);
    assert.equal(second.traced.length, 0, "second update must NOT re-trace the unchanged test (②-AC2)");
    assert.equal(second.skipped.length, 1, "second update must skip the unchanged test");
    const entry = loadTraceCache(root).get("plugin/test/varjoin.test.mjs");
    assert.ok(entry && entry.hash === contentHash(path.join(root, "plugin/test/varjoin.test.mjs")), "cache entry carries the content hash");
    assert.ok(entry.reads.includes("plugin/scripts/quay-init.sh"), "cached entry holds the dynamic truth");
  } finally { cleanup(root); }
});

// ── ③-AC1 / ③-AC2 — static-vs-truth drift RED + negative control ────────────────────────────────────

test("③-AC1 — static S singleton + dynamic M ⇒ static-vs-truth-drift RED", () => {
  const root = makeFixture({
    // static attribution: S (the scripts/test.sh mention in a spawn arg — not a Run: header).
    "plugin/test/a.test.mjs": [
      `import { test } from "node:test";`,
      `import { spawnSync } from "node:child_process";`,
      `test("a", () => { spawnSync("bash", ["--test-command", "scripts/test.sh"], { encoding: "utf8" }); });`,
    ].join("\n"),
    ".quay/suite-fs-trace.jsonl": `{"file":"plugin/test/a.test.mjs","hash":"abc","reads":["plugin/scripts/quay-init.sh"],"writes":[]}\n`,
  });
  try {
    const staticSet = bucketSetOf("plugin/test/a.test.mjs", root);
    assert.deepEqual([...staticSet], ["S"], "fixture static attribution must be S (the drift precondition)");
    const rep = checkStaticVsTruth(root);
    assert.equal(rep.evaluated, true, "with a cache the check must be evaluated");
    assert.equal(rep.drifts.length, 1, `must report exactly 1 drift, got ${JSON.stringify(rep.drifts)}`);
    assert.equal(rep.drifts[0].file, "plugin/test/a.test.mjs");
    assert.ok(rep.drifts[0].evidence.includes("plugin/scripts/quay-init.sh"), "evidence names the missed M path");
  } finally { cleanup(root); }
});

test("③-AC2 — negative control: a correctly-attributed test reports NO drift (dynamic ⊆ static)", () => {
  const root = makeFixture({
    // static attribution: M (a relative import into plugin/scripts).
    "plugin/test/b.test.mjs": [
      `import { test } from "node:test";`,
      `import { classifyPath } from "../scripts/suite-bucket-attribution.ts";`,
      `test("b", () => { classifyPath("plugin/scripts/x"); });`,
    ].join("\n"),
    // dynamic truth: M only (the same subject) — dynamic ⊆ static ⇒ no drift.
    ".quay/suite-fs-trace.jsonl": `{"file":"plugin/test/b.test.mjs","hash":"abc","reads":["plugin/scripts/suite-bucket-attribution.ts"],"writes":[]}\n`,
  });
  try {
    const staticSet = bucketSetOf("plugin/test/b.test.mjs", root);
    assert.equal(staticSet.has("M"), true, "fixture static attribution must be M");
    const rep = checkStaticVsTruth(root);
    assert.equal(rep.evaluated, true);
    assert.equal(rep.drifts.length, 0, `a correctly-attributed test must not drift, got ${JSON.stringify(rep.drifts)}`);
  } finally { cleanup(root); }
});

test("hard rule 3b — NO trace cache ⇒ NOT-EVALUATED (never conflated with '0 drift')", () => {
  const root = makeFixture({ "plugin/test/c.test.mjs": `import { test } from "node:test"; test("c", () => {});\n` });
  try {
    const rep = checkStaticVsTruth(root);
    assert.equal(rep.evaluated, false, "no cache ⇒ evaluated=false");
    assert.equal(rep.drifts.length, 0);
  } finally { cleanup(root); }
});

test("missingDynamicBuckets — dynamic ⊄ static is the only drift direction", () => {
  assert.deepEqual([...missingDynamicBuckets(new Set(["S"]), new Set(["M"]))], ["M"], "M ∉ {S} ⇒ missing");
  assert.deepEqual([...missingDynamicBuckets(new Set(["M"]), new Set(["S", "M"]))], ["S"], "S ∉ {M} ⇒ missing (the other direction)");
  assert.deepEqual([...missingDynamicBuckets(new Set(["S", "M"]), new Set(["M"]))], [], "dynamic ⊆ static ⇒ no drift");
  assert.deepEqual([...missingDynamicBuckets(new Set(), new Set(["M"]))], ["M"], "empty static is UNRESOLVED (reported elsewhere, not this drift)");
});

// ── truth-selection-drift (plan item 5) ──────────────────────────────────────────────────────────────

test("truth-selection — a dynamic-truth-covering test that the bucket selection missed ⇒ RED", () => {
  const root = makeFixture({
    // static S (not M), but its runtime truth covers plugin/scripts/foo.ts (the touched file).
    "plugin/test/d.test.mjs": [
      `import { test } from "node:test";`,
      `import { spawnSync } from "node:child_process";`,
      `test("d", () => { spawnSync("bash", ["--test-command", "scripts/test.sh"], { encoding: "utf8" }); });`,
    ].join("\n"),
    "plugin/scripts/foo.ts": `export const x = 1;\n`,
    ".quay/suite-fs-trace.jsonl": `{"file":"plugin/test/d.test.mjs","hash":"abc","reads":["plugin/scripts/foo.ts"],"writes":[]}\n`,
  });
  try {
    const rep = checkTruthSelection(root, ["plugin/scripts/foo.ts"]);
    assert.equal(rep.evaluated, true, "with a cache + literal touched file the check must be evaluated");
    assert.ok(
      rep.drifts.some((d) => d.file === "plugin/test/d.test.mjs"),
      `the covering test must be flagged as unselected, got ${JSON.stringify(rep.drifts)}`,
    );
  } finally { cleanup(root); }
});

// ── ③-AC3 — wired into run_static_checks ─────────────────────────────────────────────────────────────

test("③-AC3 — the checker is registered in run_static_checks (the static-gate registry, not a prose claim)", () => {
  const gate = fs.readFileSync(path.join(REPO_ROOT, "plugin", "scripts", "runner-static-gate.ts"), "utf8");
  const body = gate.slice(gate.indexOf("run_static_checks()"), gate.indexOf("run_static_checks()") === -1 ? gate.length : gate.indexOf("\n}\n", gate.indexOf("run_static_checks()")));
  assert.ok(
    /suite-bucket-drift-check\.ts/.test(body),
    "run_static_checks must invoke suite-bucket-drift-check.ts (the drift check is wired into the static-gate chain)",
  );
  assert.ok(/# @static-tier (always|change|full)/.test(body), "the checker must carry a @static-tier annotation");
});

// ── ③-AC4 — production trigger (the --buckets path collects the trace cache from real runs) ─────────

test("③-AC4 — scripts/test.sh --buckets path invokes suite-fs-trace.ts --update (the production trigger, not fixture injection)", () => {
  const sh = fs.readFileSync(path.join(REPO_ROOT, "scripts", "test.sh"), "utf8");
  const start = sh.indexOf('elif [ "${1:-}" = "--buckets" ]');
  const end = sh.indexOf("elif all_flags", start);
  const bucketBranch = start === -1 ? "" : sh.slice(start, end === -1 ? sh.length : end);
  assert.ok(
    /suite-fs-trace\.ts["']?[^\n]*--update/.test(bucketBranch),
    "the --buckets branch must invoke suite-fs-trace.ts --update (the production trigger that populates .quay/suite-fs-trace.jsonl from real runs)",
  );
});

test("③-AC4 — updateTraceCache --limit bounds the trace batch (cost-bounded production trigger)", () => {
  const root = makeFixture({
    "plugin/test/a.test.mjs": `import { test } from "node:test";\ntest("a", () => {});\n`,
    "plugin/test/b.test.mjs": `import { test } from "node:test";\ntest("b", () => {});\n`,
  });
  try {
    const files = ["plugin/test/a.test.mjs", "plugin/test/b.test.mjs"];
    const first = updateTraceCache(root, files, { limit: 1 });
    assert.equal(first.traced.length, 1, `limit=1 must trace at most 1 file per call, got ${first.traced.length}`);
    const second = updateTraceCache(root, files, { limit: 1 });
    assert.equal(second.traced.length, 1, `the second call traces the remaining un-cached file, got ${second.traced.length}`);
    assert.equal(loadTraceCache(root).size, 2, "both files end up cached across the two bounded calls");
  } finally { cleanup(root); }
});

// ── ③-AC5 — a real collect feeds checkStaticVsTruth a real verdict, not NOT-EVALUATED ───────────────

test("③-AC5 — a real collect (updateTraceCache) feeds the checker a real verdict (evaluated=true, covered>0)", () => {
  const root = makeFixture({
    "plugin/scripts/quay-init.sh": "#!/usr/bin/env bash\nexit 0\n",
    "plugin/test/varjoin.test.mjs": [
      `import { spawnSync } from "node:child_process";`,
      `import path from "node:path";`,
      `import { fileURLToPath } from "node:url";`,
      `import { test } from "node:test";`,
      `const __dirname = path.dirname(fileURLToPath(import.meta.url));`,
      `const pluginDir = path.resolve(__dirname, "..");`,
      `test("probe", () => { spawnSync("bash", [path.join(pluginDir, "scripts", "quay-init.sh")], { encoding: "utf8" }); });`,
    ].join("\n"),
  });
  try {
    const collect = updateTraceCache(root, ["plugin/test/varjoin.test.mjs"]);
    assert.equal(collect.failed.length, 0, `the real collect must succeed, got ${collect.failed.join("; ")}`);
    assert.ok(collect.traced.includes("plugin/test/varjoin.test.mjs"), "the test must be traced by the real collect");
    const rep = checkStaticVsTruth(root);
    assert.equal(rep.evaluated, true, "after a real collect the checker must be evaluated (③-AC5 — never the constant NOT-EVALUATED)");
    assert.ok(rep.coveredCount >= 1, `the covered count must be a real number from the real cache, got ${rep.coveredCount}`);
  } finally { cleanup(root); }
});
