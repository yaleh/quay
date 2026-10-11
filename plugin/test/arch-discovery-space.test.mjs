// @test-group engine
// Fixture tests for the architecture-discovery SPACE instrument's decision rules
// (docs/analysis/arch-discovery-space.mjs). Pure functions only — no git, no repo, no network.
//
// Fixture families (Plan step 4):
//   1. stale / legit / undetermined under the PRE-REGISTERED rule.
//   2. the E3 fix: a test counts only if it IMPORTS the literal's own module (specifier resolved),
//      not merely because it contains the symbol's bare name.
// Every emitted record kind/value is also validated against the PRODUCTION store, so the test fails
// if the store's vocabulary drifts away from what the tool writes.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

import {
  classifySpace, e3Hits, importSpecifiers, resolveSpecifier, sameModuleResolved,
  RULE_TO_STORE_VERDICT, sourceEvidence, carrierEvidence, Sink,
  RULE_DRIFT, RULE_LEGIT, RULE_UNDETERMINED,
  findingFp, assignFindingFps, makeBudget, BoundExceeded, BOUND_EXIT_CODES,
  streamLines, streamJsonl, runSpaceScan, cli, PROVENANCE_TASK_DEFAULT, defaultOut,
} from "../../docs/analysis/arch-discovery-space.mjs";
import { validateRecord } from "../../docs/analysis/architecture-evidence-store.mjs";

const E = (named) => ({ state: "evaluated", named });
const H = (hits) => ({ state: "evaluated", hits });
const NE = () => ({ state: "not-evaluated" });

// ── family 1: the pre-registered rule ───────────────────────────────────────────────────────────────
test("rule: E1=stale ∧ ¬E2 ∧ ¬E3 ⇒ drift-hypothesis", () => {
  assert.equal(classifySpace({ e1: "stale", e2: E([]), e3: H([]) }), RULE_DRIFT);
  assert.equal(classifySpace({ e1: "stale", e2: E([]), e3: NE() }), RULE_DRIFT);
});

test("rule: (E2 ∨ E3) ∧ E1≠stale ⇒ legit-difference", () => {
  assert.equal(classifySpace({ e1: "authored-after", e2: E(["needs-human"]), e3: H([]) }), RULE_LEGIT);
  assert.equal(classifySpace({ e1: "authored-after", e2: E([]), e3: H(["plugin/test/x.test.mjs"]) }), RULE_LEGIT);
});

test("rule: everything else ⇒ undetermined — including stale-with-a-named-comment", () => {
  // authored-after with no rationale at all: neither the drift branch (E1 not stale) nor the legit branch.
  assert.equal(classifySpace({ e1: "authored-after", e2: E([]), e3: H([]) }), RULE_UNDETERMINED);
  // a not-evaluated reading never resolves to a verdict — NOT-EVALUATED must not share a value with "legit".
  assert.equal(classifySpace({ e1: "not-evaluated", e2: E([]), e3: H([]) }), RULE_UNDETERMINED);
  assert.equal(classifySpace({ e1: "authored-after", e2: NE(), e3: H([]) }), RULE_UNDETERMINED);
  // stale AND a comment names a missing value: the drift branch is blocked by E2, the legit branch by stale.
  assert.equal(classifySpace({ e1: "stale", e2: E(["draft"]), e3: H([]) }), RULE_UNDETERMINED);
});

test("rule labels map onto the store's DISCOVERY verdict vocabulary (no domain word as a verdict)", () => {
  assert.deepEqual(RULE_TO_STORE_VERDICT, { [RULE_DRIFT]: "supported", [RULE_LEGIT]: "refuted", [RULE_UNDETERMINED]: "undetermined" });
  for (const v of Object.values(RULE_TO_STORE_VERDICT)) assert.ok(["supported", "refuted", "undetermined"].includes(v));
});

// ── family 2: the E3 import-resolution fix ──────────────────────────────────────────────────────────
const MOD = "plugin/scripts/dev-stats-collect.ts";
const SRC_TEST = { path: "plugin/test/dev-stats-collect.test.mjs", content: `import { collect } from "../scripts/dev-stats-collect.ts";\nconst named = ["done"];` };
// A test that names the symbol but imports a DIFFERENT module — the E3 fix must not count it. The other
// module is a real sibling script on purpose: a fixture import of a non-existent `scripts/<name>` would be
// read as a real (impl-deleted) import by `test-impl-census-check.ts`.
const OTHER_TEST = { path: "plugin/test/elsewhere.test.mjs", content: `import { statuses } from "../scripts/task-status.ts";\nconst named = ["done"];` };
const BARE_TEST = { path: "plugin/test/mention-only.test.mjs", content: `const named = ["done"];` };

test("E3 (old, by bare name) counts a generic local in ANY test — the known weakness", () => {
  const r = e3Hits({ testFiles: [SRC_TEST, OTHER_TEST, BARE_TEST], moduleFile: MOD, symbol: "named", mode: "name" });
  assert.equal(r.state, "evaluated");
  assert.deepEqual(r.hits.sort(), ["plugin/test/dev-stats-collect.test.mjs", "plugin/test/elsewhere.test.mjs", "plugin/test/mention-only.test.mjs"]);
});

test("E3 (fixed) counts ONLY a test that imports the literal's own module — a 197→1 collapse", () => {
  const r = e3Hits({ testFiles: [SRC_TEST, OTHER_TEST, BARE_TEST], moduleFile: MOD, symbol: "named", mode: "import" });
  assert.deepEqual(r.hits, ["plugin/test/dev-stats-collect.test.mjs"]);
  const byName = e3Hits({ testFiles: [SRC_TEST, OTHER_TEST, BARE_TEST], moduleFile: MOD, symbol: "named", mode: "name" });
  assert.equal(byName.hits.length, 3);
});

test("E3 is not-evaluated (never a silent zero) when the literal declares no symbol", () => {
  const r = e3Hits({ testFiles: [SRC_TEST], moduleFile: MOD, symbol: null, mode: "import" });
  assert.equal(r.state, "not-evaluated");
  assert.deepEqual(r.hits, []);
});

test("import specifiers: static, bare, and dynamic forms are all collected; packages are not repo files", () => {
  const src = `import a from "./a.ts";\nexport { b } from "../b.ts";\nimport "./side-effect.ts";\nconst c = await import("./dyn.ts");\nimport node from "node:fs";\nimport pkg from "@scope/pkg";`;
  assert.deepEqual(importSpecifiers(src).sort(), ["../b.ts", "./a.ts", "./dyn.ts", "./side-effect.ts", "@scope/pkg", "node:fs"]);
  assert.equal(resolveSpecifier("../scripts/foo.ts", "plugin/test/x.test.mjs"), "plugin/scripts/foo.ts");
  assert.equal(resolveSpecifier("node:fs", "plugin/test/x.test.mjs"), null);
  assert.equal(resolveSpecifier("@scope/pkg", "plugin/test/x.test.mjs"), null);
});

test("extension-swap equivalence: an import written .js resolves to the .ts literal's module", () => {
  assert.equal(sameModuleResolved("plugin/scripts/foo.js", "plugin/scripts/foo.ts"), true);
  assert.equal(sameModuleResolved("plugin/scripts/foo.mjs", "plugin/scripts/foo.ts"), true);
  assert.equal(sameModuleResolved("plugin/scripts/foobar.ts", "plugin/scripts/foo.ts"), false);
  assert.equal(sameModuleResolved(null, "plugin/scripts/foo.ts"), false);
});

// ── records go through the PRODUCTION validator ─────────────────────────────────────────────────────
test("evidence records the tool emits validate against the store (source form and carrier form)", () => {
  const src = sourceEvidence("enum-surface-parity-check", "packages/quay/src/serve-goal.ts", 225, "  const GOAL_STATUS_ORDER = [", "c010f023a78b3634ed204d9bb23a0a90417a267e", { subject_key: "enum-surface:goal-status|packages/quay/src/serve-goal.ts#225" });
  assert.deepEqual(validateRecord("evidence", src), { ok: true, reasons: [] });
  const car = carrierEvidence("dependency-task-carrier", "tasks/x.md", 7, "## Acceptance Criteria", { provenance_task: "x" });
  assert.deepEqual(validateRecord("evidence", car), { ok: true, reasons: [] });
});

test("a Sink tally separates accepted from refused (a malformed record is REPORTED, never hidden)", () => {
  const s = new Sink();
  s.add("evidence", sourceEvidence("t", "a/b.ts", 1, "x", "0123456789"));
  s.add("evidence", { tool: "t" });                       // deliberately missing required fields
  assert.equal(s.validator.accepted, 1);
  assert.equal(s.validator.refused, 1);
  assert.ok(Object.keys(s.validator.reasons).some((r) => r.startsWith("SCHEMA_MISSING:")));
});

// ── finding identity: stable across runs, blind to every wall-clock field ───────────────────────────
test("finding_fp is identical for two otherwise-identical records that differ only in ts", () => {
  const rows = (ts) => [
    { kind: "evidence", ref: "r", sha256: "a".repeat(64), subject_key: "s|f#1", ts },
    { kind: "outcome", verdict: "supported", rule_verdict: "drift-hypothesis", subject_key: "s|f#1", experiment_ref: "h", ts },
  ];
  const a = assignFindingFps(rows("2020-01-01T00:00:00.000Z"))[1].finding_fp;
  const b = assignFindingFps(rows("2026-10-11T23:59:59.999Z"))[1].finding_fp;
  assert.equal(a, b);
  // ... and it still DISCRIMINATES: a different evidence hash (or subject/verdict) moves it.
  const c = assignFindingFps([
    { kind: "evidence", ref: "r", sha256: "b".repeat(64), subject_key: "s|f#1", ts: "2026-01-01T00:00:00Z" },
    { kind: "outcome", verdict: "supported", rule_verdict: "drift-hypothesis", subject_key: "s|f#1", experiment_ref: "h", ts: "2026-01-01T00:00:00Z" },
  ])[1].finding_fp;
  assert.notEqual(a, c);
  assert.equal(findingFp("s", "v", ["z", "a"]), findingFp("s", "v", ["a", "z"]));   // order-insensitive
  assert.equal(findingFp("s", "v"), findingFp("s", "v", []));
});

// ── bounds: a breach exits with its OWN code and writes NOTHING (fail-closed) ───────────────────────
test("bounds: makeBudget gives each bound a distinct code; a breached budget throws BoundExceeded", () => {
  assert.equal(BOUND_EXIT_CODES["max-ms"], 4);
  assert.equal(BOUND_EXIT_CODES["max-records"], 5);
  assert.equal(BOUND_EXIT_CODES["max-candidates"], 6);
  const b = makeBudget({ maxRecords: 2, maxCandidates: 1, maxGroups: 0 });
  b.countRecords(2);                                        // at the cap: allowed
  assert.throws(() => b.countRecords(3), (e) => e instanceof BoundExceeded && e.exitCode === 5);
  assert.throws(() => b.countCandidates(2), (e) => e.exitCode === 6);
  assert.throws(() => b.countGroups(1), (e) => e.bound === "max-groups" && e.exitCode === 6);
  // `--max-ms 0` breaches at the FIRST consultation — deterministic, not a race against the clock.
  assert.throws(() => makeBudget({ maxMs: 0 }).checkTime(), (e) => e.exitCode === 4);
  // ⛔ no bound installed ⇒ no bound enforced (硬规则 4 推论二: "no limit" is the ABSENCE of the limit).
  assert.doesNotThrow(() => { const n = makeBudget(); n.countRecords(1e9); n.checkTime(Date.now() + 1e12); });
});

// ── the streaming reader: same rows as a whole-file read, bounded memory, multibyte-safe ────────────
test("streamJsonl reads every line the whole-file read would, holding multibyte chars across chunks", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "arch-stream-"));
  const file = path.join(dir, "c.jsonl");
  const rows = Array.from({ length: 50 }, (_, i) => JSON.stringify({ i, note: `中文-${i}-${"汉".repeat(20)}` }));
  fs.writeFileSync(file, rows.join("\n") + "\n");
  const seen = [];
  const res = streamLines(file, (l) => seen.push(l), { chunk: 64 });   // tiny chunks → many boundary splits
  assert.equal(res.lines, 50);
  const parsed = streamJsonl(file, () => true, { chunk: 64 });
  assert.deepEqual(parsed.rows.map((r) => JSON.parse(r.raw).i), [...Array(50).keys()]);
  for (const { raw } of parsed.rows) assert.ok(!raw.includes("�"), "no multibyte character was split");
  assert.equal(streamJsonl(path.join(dir, "absent.jsonl")).missing, true);
  fs.rmSync(dir, { recursive: true, force: true });
});

// ── scan mode on a FIXTURE repo: determinism (a), bounds (b) ────────────────────────────────────────
/** A tiny git repo the scan can read: one authority + two surfaces that lag it by one value, plus a
 *  test file importing surface A. Everything is inside `plugin/` so the checker's own discovery roots
 *  and the E3 test glob both see it. The registry is passed with `--registry` (the checker's own fixture
 *  seam), so the scan never touches this repo's real registry. */
function makeScanFixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "arch-scan-fixture-"));
  fs.mkdirSync(path.join(dir, "plugin/scripts"), { recursive: true });
  fs.mkdirSync(path.join(dir, "plugin/test"), { recursive: true });
  fs.writeFileSync(path.join(dir, "plugin/scripts/fixture-authority.ts"), `export const FIXTURE_VALUES = ["alpha", "beta"];\n`);
  fs.writeFileSync(path.join(dir, "plugin/scripts/fixture-surface-a.ts"), `export const FIXTURE_SURFACE_A = ["alpha"];\n`);
  fs.writeFileSync(path.join(dir, "plugin/scripts/fixture-surface-b.ts"), `export const FIXTURE_SURFACE_B = ["alpha"];\n`);
  fs.writeFileSync(path.join(dir, "plugin/test/fixture-surface.test.mjs"), `import { FIXTURE_SURFACE_A } from "../scripts/fixture-surface-a.ts";\nexport const seen = FIXTURE_SURFACE_A;\n`);
  const registry = {
    authorities: [{ id: "fixture-values", file: "plugin/scripts/fixture-authority.ts", symbol: "FIXTURE_VALUES", extract: "ts-array" }],
    surfaces: [
      { id: "fixture-surface-a", authority: "fixture-values", file: "plugin/scripts/fixture-surface-a.ts", extract: "ts-array", symbol: "FIXTURE_SURFACE_A", policy: "exact" },
      { id: "fixture-surface-b", authority: "fixture-values", file: "plugin/scripts/fixture-surface-b.ts", extract: "ts-array", symbol: "FIXTURE_SURFACE_B", policy: "exact" },
    ],
    knownDrift: [
      { surface: "fixture-surface-a", extra: [], missing: ["beta"], reason: "fixture: recorded drift (a)" },
      { surface: "fixture-surface-b", extra: [], missing: ["beta"], reason: "fixture: recorded drift (b)" },
    ],
  };
  const registryFile = path.join(dir, "fixture-registry.json");
  fs.writeFileSync(registryFile, JSON.stringify(registry));
  const git = (args) => execFileSync("git", ["-C", dir, ...args], { encoding: "utf8" });
  git(["init", "-q"]);
  git(["add", "-A"]);
  git(["-c", "user.email=fixture@example.com", "-c", "user.name=fixture", "-c", "commit.gpgsign=false", "commit", "-q", "-m", "fixture"]);
  return { dir, registryFile, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

const scanOpts = (fx) => ({ root: fx.dir, rev: "HEAD", registry: fx.registryFile, e3Mode: "import", provenanceTask: PROVENANCE_TASK_DEFAULT });
const fpsOf = (out) => out.sink.rows.filter((r) => r.finding_fp).map((r) => r.finding_fp).sort();

test("(a) two --scan runs on the same fixture give identical finding_fp sets", async () => {
  const fx = makeScanFixture();
  try {
    const a = await runSpaceScan(scanOpts(fx));
    const b = await runSpaceScan(scanOpts(fx));
    assert.equal(a.cost.candidates, 2, "the fixture's two known-drift surfaces are the candidate set");
    assert.ok(fpsOf(a).length > 0, "the fixture must yield at least one fingerprinted finding");
    assert.deepEqual(fpsOf(a), fpsOf(b));
    assert.deepEqual(a.results.map((r) => r.verdict), b.results.map((r) => r.verdict));
    assert.equal(a.a3.skipped, true, "A3 is not-applicable in scan mode");
    // scan mode scores nothing: there is no label set to score against.
    assert.equal(a.score.unlabelled.length, a.results.length);
    assert.equal(a.validator.refused, 0, `every emitted record must validate: ${JSON.stringify(a.validator.reasons)}`);
  } finally { fx.cleanup(); }
});

test("(b) each bound exits with its own code and leaves the out file byte-identical", async () => {
  const fx = makeScanFixture();
  const out = path.join(fx.dir, "out.jsonl");
  const SENTINEL = "PRE-EXISTING OUTPUT\n";
  try {
    // `--max-ms 0` breaches at the first consultation; the record/candidate caps breach at the 2nd row.
    for (const [bound, value, code] of [["--max-ms", "0", 4], ["--max-records", "1", 5], ["--max-candidates", "1", 6]]) {
      fs.writeFileSync(out, SENTINEL);
      const got = await cli(["--scan", "--root", fx.dir, "--registry", fx.registryFile, "--out", out, bound, value]);
      assert.equal(got, code, `${bound} ${value} must exit ${code}`);
      assert.equal(fs.readFileSync(out, "utf8"), SENTINEL, `${bound} ${value} must write NOTHING`);
    }
  } finally { fx.cleanup(); }
});

test("the default --out path is the one the repo's .gitignore covers", () => {
  assert.equal(defaultOut("/x"), "/x/.quay/arch-discovery-shadow/space-records.jsonl");
  assert.match(path.join("/x", ".quay/arch-discovery-shadow/"), /\.quay\/arch-discovery-shadow\/$/);
});
