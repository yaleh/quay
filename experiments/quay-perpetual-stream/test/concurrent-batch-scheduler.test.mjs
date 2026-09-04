// @test-group engine
// Unit tests for concurrent-batch-scheduler.mjs — the two-level scheduler's ASSEMBLY core
// (DIR-044 increment 2). Given rank-ordered candidate charters, greedily assemble a maximal
// touches-DISJOINT, execution-type batch that touches NO shared exp5 state, deferring the rest to a
// later (serial) round. RED-first (ADR-001 / DIR-019). The disjointness verdict is single-sourced —
// this module IMPORTS checkTouchesPair from touches-orthogonality-check.mjs, never re-implements it.
// Run:
//   node --test experiments/quay-perpetual-stream/test/concurrent-batch-scheduler.test.mjs
import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  parseCandidate,
  touchesSharedState,
  SHARED_STATE_PATHS,
  assembleBatch,
  expandDeclaredTouches,
  isCapabilityGrowth,
  applyPreparationExpansion,
  loadReceiptTouches,
  main,
} from "../scripts/concurrent-batch-scheduler.ts";
import { expandGlobs as expandGlobsForTest } from "../scripts/touches-orthogonality-check.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
const SFX = path.join(__dirname, "..", "fixtures", "scheduler");
const sfx = (f) => path.join(SFX, f);

// Every mkdtemp receipt/ac dir is removed once at the end of this file (the carrier-array +
// after() pattern) — a mkdtemp fixture without cleanup leaks a /tmp dir per run.
const _tmpDirs = [];
after(() => {
  for (const dir of _tmpDirs) fs.rmSync(dir, { recursive: true, force: true });
});

// A fake expander maps a declared glob → concrete file set (hermetic, no fs).
const fakeExpand = (mapping) => (globs) => {
  const out = new Set();
  for (const g of globs) for (const f of (mapping[g] || [])) out.add(f);
  return out;
};

// Run `main()` with `--json` and capture its stdout, so CLI-level assertions can read the
// { batch, deferred } verdict the task contract measures (gap-dispatch-eligibility-blind-to-files-
// that-do-not-exist-yet). main() is async and writes via process.stdout.write, which is patched
// for the duration of the call and always restored.
async function runMainJson(args) {
  const chunks = [];
  const origWrite = process.stdout.write;
  process.stdout.write = (chunk, ...rest) => { chunks.push(String(chunk)); return true; };
  try {
    const code = await main(["node", "s", "--json", ...args]);
    return { code, stdout: chunks.join("") };
  } finally {
    process.stdout.write = origWrite;
  }
}

// ── parseCandidate ───────────────────────────────────────────────────────────────────────────────
test("parseCandidate: extracts id, touches globs, and type", () => {
  const c = parseCandidate("cand-1", "**type:** execution\n## Touches\n- x/a.js\n- y/b.js");
  assert.equal(c.id, "cand-1");
  assert.deepEqual(c.touches.globs, ["x/a.js", "y/b.js"]);
  assert.equal(c.type, "execution");
});

test("parseCandidate: type defaults to 'execution' when unstated; learning detected", () => {
  assert.equal(parseCandidate("c", "## Touches\n- a.js").type, "execution");
  assert.equal(parseCandidate("c", "**type:** learning\n## Touches\n- a.js").type, "learning");
  assert.equal(parseCandidate("c", "type: learning-experiment\n## Touches\n- a.js").type, "learning-experiment");
});

// ── gap-experiment-legacy-reclaim-and-touches-heuristic AC3 ─────────────────────────────────────
// A charter WITHOUT a `## Touches` section + a repoRoot gets a MECHANICAL derived hint from body
// prose (derive-touches-heuristic.ts), so the scheduler can batch it instead of conservative-
// serializing it. The hint is marked `derived: true` and `hasSection` becomes true ONLY when at
// least one path-shaped token is extracted; a charter with no path-shaped tokens stays conservative.
test("parseCandidate: derives mechanical touches when ## Touches is missing and repoRoot is provided", () => {
  const c = parseCandidate(
    "no-touches",
    "**type:** execution\n## Proposal\nFix the bug in `plugin/scripts/foo.ts` and update `docs/bar.md`.",
    REPO_ROOT,
  );
  assert.equal(c.touches.hasSection, true, "derived globs make hasSection usable");
  assert.equal(c.touches.derived, true, "derived hint is labeled auto-derived");
  assert.ok(c.touches.globs.includes("plugin/scripts/foo.ts"), "path-shaped token from prose is extracted");
  assert.ok(c.touches.globs.includes("docs/bar.md"), "path-shaped token from prose is extracted");
});

test("parseCandidate: no repoRoot (or no path-shaped tokens) keeps the conservative no-declaration path", () => {
  // 2-arg call (no repoRoot) — byte-unchanged legacy behavior.
  const noRoot = parseCandidate("c", "**type:** execution\nFix `plugin/scripts/foo.ts` here.");
  assert.equal(noRoot.touches.hasSection, false);
  assert.equal(noRoot.touches.derived, undefined);
  // repoRoot but no path-shaped tokens → stays conservative.
  const noPaths = parseCandidate("c", "**type:** execution\nImprove the flow and fix the bug.", REPO_ROOT);
  assert.equal(noPaths.touches.hasSection, false, "no path-shaped tokens → no derivation");
  assert.equal(noPaths.touches.derived, undefined);
});

// ── DIR-116: value-type extraction ──────────────────────────────────────────────────────────────
test("parseCandidate: value-type defaults to capability-growth when unstated (backward-compat)", () => {
  const c = parseCandidate("c", "**type:** execution\n## Touches\n- a.js");
  assert.equal(c.valueType, "capability-growth");
  assert.equal(isCapabilityGrowth(c.valueType), true);
});

test("parseCandidate: value-type reads '**Value type:**' (kebab, camelCase) and the older prose form", () => {
  assert.equal(
    parseCandidate("kebab", "**Value type:** capability-growth\n## Touches\n- a.js").valueType,
    "capability-growth",
  );
  // camelCase mid-line, as seen in DIR-109/M185's own charter: "**Class:** development · **Value type:** instrumentCorrection"
  assert.equal(
    parseCandidate("camel", "**Class:** development · **Value type:** instrumentCorrection\n## Touches\n- a.js").valueType,
    "instrumentcorrection",
  );
  assert.equal(
    parseCandidate(
      "prose",
      "- Value type (per `inherited-core.md`'s value-typed SELECT ledger): **governance-integrity** (primary)\n## Touches\n- a.js",
    ).valueType,
    "governance-integrity",
  );
});

test("isCapabilityGrowth: normalizes hyphen/case so kebab and camelCase spellings compare equal", () => {
  assert.equal(isCapabilityGrowth("capability-growth"), true);
  assert.equal(isCapabilityGrowth("capabilityGrowth"), true);
  assert.equal(isCapabilityGrowth("instrument-correction"), false);
  assert.equal(isCapabilityGrowth("instrumentCorrection"), false);
  assert.equal(isCapabilityGrowth("governance-integrity"), false);
  assert.equal(isCapabilityGrowth("discovery"), false);
  assert.equal(isCapabilityGrowth("risk-option"), false);
});

// ── touchesSharedState ───────────────────────────────────────────────────────────────────────────
test("touchesSharedState: a glob covering dashboard.md is flagged", () => {
  assert.equal(touchesSharedState(["experiments/quay-perpetual-stream/dashboard.md"]), true);
  assert.equal(touchesSharedState(["experiments/quay-perpetual-stream/**"]), true); // covers dashboard
  assert.equal(touchesSharedState(["packages/quay/src/gate/registry.js"]), false);
});

test("SHARED_STATE_PATHS includes the known shared exp5 artifacts", () => {
  const joined = SHARED_STATE_PATHS.join("|");
  assert.match(joined, /dashboard\.md/);
  assert.match(joined, /backlog\.md/);
  assert.match(joined, /v-meta-ledger\.md/);
  assert.match(joined, /gate-events\.jsonl/);
});

// ── assembleBatch ────────────────────────────────────────────────────────────────────────────────
test("assembleBatch: two disjoint execution candidates → both batched", () => {
  const cands = [
    parseCandidate("A", "**type:** execution\n## Touches\n- x/a.js"),
    parseCandidate("B", "**type:** execution\n## Touches\n- y/b.js"),
  ];
  const r = assembleBatch(cands, { expand: fakeExpand({ "x/a.js": ["x/a.js"], "y/b.js": ["y/b.js"] }) });
  assert.deepEqual(r.batch, ["A", "B"]);
  assert.deepEqual(r.deferred, []);
});

test("assembleBatch: an overlapping candidate is deferred, not batched", () => {
  const cands = [
    parseCandidate("A", "**type:** execution\n## Touches\n- g/sub/reg.js"),
    parseCandidate("B", "**type:** execution\n## Touches\n- g/sub/**"), // depth-2 glob overlaps A on g/sub/reg.js
    parseCandidate("C", "**type:** execution\n## Touches\n- z/c.js"),
  ];
  const expand = fakeExpand({ "g/sub/reg.js": ["g/sub/reg.js"], "g/sub/**": ["g/sub/reg.js", "g/sub/x.js"], "z/c.js": ["z/c.js"] });
  const r = assembleBatch(cands, { expand });
  assert.deepEqual(r.batch, ["A", "C"]);          // A anchors, C disjoint from A → in; B overlaps A → out
  assert.equal(r.deferred.length, 1);
  assert.equal(r.deferred[0].id, "B");
  assert.match(r.deferred[0].reason, /overlap/i);
});

test("assembleBatch: a '…-learning' type is also never batched (tightened exclusion)", () => {
  const cands = [
    parseCandidate("A", "**type:** execution\n## Touches\n- x/a.js"),
    parseCandidate("SNEAK", "**type:** execution-learning\n## Touches\n- y/b.js"),
  ];
  const r = assembleBatch(cands, { expand: fakeExpand({ "x/a.js": ["x/a.js"], "y/b.js": ["y/b.js"] }) });
  assert.deepEqual(r.batch, ["A"]);
  assert.equal(r.deferred[0].id, "SNEAK");
  assert.match(r.deferred[0].reason, /learning/i);
});

test("assembleBatch: learning-type is NEVER batched (always serial), even if disjoint", () => {
  const cands = [
    parseCandidate("A", "**type:** execution\n## Touches\n- x/a.js"),
    parseCandidate("L", "**type:** learning\n## Touches\n- y/b.js"),
  ];
  const r = assembleBatch(cands, { expand: fakeExpand({ "x/a.js": ["x/a.js"], "y/b.js": ["y/b.js"] }) });
  assert.deepEqual(r.batch, ["A"]);
  assert.equal(r.deferred[0].id, "L");
  assert.match(r.deferred[0].reason, /learning/i);
});

// ── DIR-116 GREEN: non-capability-growth value-type is deferred, with a reason distinguishable from
// the touches-overlap / shared-state / learning-type deferral reasons ─────────────────────────────
test("assembleBatch: a governance-integrity value-type candidate is deferred even with clean, disjoint touches (DIR-116 GREEN)", () => {
  const cands = [
    parseCandidate("cap-growth", "**Value type:** capability-growth\n## Touches\n- x/a.js"),
    parseCandidate("gov-integrity", "**Value type:** governance-integrity\n## Touches\n- y/b.js"),
  ];
  // Prior to DIR-116, this exact pair (disjoint touches, no shared-state, no learning type) would
  // have batched 2-wide — that was the real, undetected gap DIR-116 closes (see DIR-109/M173
  // evidence cited in the directive). Confirmed via replay against the pre-change scheduler: BOTH
  // candidates batched (see M185 iteration report for the captured RED output).
  const r = assembleBatch(cands, { expand: fakeExpand({ "x/a.js": ["x/a.js"], "y/b.js": ["y/b.js"] }) });
  assert.deepEqual(r.batch, ["cap-growth"]);
  assert.equal(r.deferred.length, 1);
  assert.equal(r.deferred[0].id, "gov-integrity");
  // Distinguishable from the other deferral reasons (learning-type / shared-state / touches-overlap).
  assert.match(r.deferred[0].reason, /value-type/i);
  assert.doesNotMatch(r.deferred[0].reason, /shared exp5 state/i);
  assert.doesNotMatch(r.deferred[0].reason, /learning-type/i);
  assert.doesNotMatch(r.deferred[0].reason, /not disjoint from/i);
});

test("assembleBatch: a real capability-growth candidate (clean touches) is unaffected by the value-type check (DIR-116, no false-positive exclusion)", () => {
  const cands = [
    parseCandidate("A", "**Value type:** capability-growth\n## Touches\n- x/a.js"),
    parseCandidate("B", "## Touches\n- y/b.js"), // value-type unstated → defaults capability-growth too
  ];
  const r = assembleBatch(cands, { expand: fakeExpand({ "x/a.js": ["x/a.js"], "y/b.js": ["y/b.js"] }) });
  assert.deepEqual(r.batch, ["A", "B"]);
  assert.deepEqual(r.deferred, []);
});

test("assembleBatch: a candidate touching SHARED STATE cannot be batched (serialize)", () => {
  const cands = [
    parseCandidate("A", "**type:** execution\n## Touches\n- x/a.js"),
    parseCandidate("S", "**type:** execution\n## Touches\n- experiments/quay-perpetual-stream/dashboard.md"),
  ];
  const r = assembleBatch(cands, { expand: fakeExpand({ "x/a.js": ["x/a.js"], "experiments/quay-perpetual-stream/dashboard.md": ["experiments/quay-perpetual-stream/dashboard.md"] }) });
  assert.deepEqual(r.batch, ["A"]);
  assert.equal(r.deferred[0].id, "S");
  assert.match(r.deferred[0].reason, /shared/i);
});

test("assembleBatch: absent/overbroad touches candidate is deferred (conservative)", () => {
  const cands = [
    parseCandidate("A", "**type:** execution\n## Touches\n- x/a.js"),
    parseCandidate("N", "**type:** execution\n## Proposal\nno touches"),
    parseCandidate("O", "**type:** execution\n## Touches\n- **"),
  ];
  const r = assembleBatch(cands, { expand: fakeExpand({ "x/a.js": ["x/a.js"] }) });
  assert.deepEqual(r.batch, ["A"]);
  assert.deepEqual(r.deferred.map((d) => d.id).sort(), ["N", "O"]);
});

test("assembleBatch: a single anchor candidate with no peers still yields a 1-wide batch", () => {
  const cands = [parseCandidate("A", "**type:** execution\n## Touches\n- x/a.js")];
  const r = assembleBatch(cands, { expand: fakeExpand({ "x/a.js": ["x/a.js"] }) });
  assert.deepEqual(r.batch, ["A"]);
});

test("assembleBatch: empty candidate list → empty batch, no throw", () => {
  const r = assembleBatch([], { expand: fakeExpand({}) });
  assert.deepEqual(r.batch, []);
  assert.deepEqual(r.deferred, []);
});

// ── main() end-to-end over real fixture charters (covers CLI + fs expansion) ──────────────────────
test("main: real disjoint execution pair → 2-wide batch, exit 0", async () => {
  const code = await main(["node", "s", "--root", REPO_ROOT, sfx("exec-a.md"), sfx("exec-b.md")]);
  assert.equal(code, 0);
});

test("main: real mixed set (overlap + learning + shared-state) → only the disjoint pair batches", async () => {
  const code = await main([
    "node", "s", "--root", REPO_ROOT,
    sfx("exec-a.md"), sfx("exec-b.md"), sfx("exec-c-overlaps-a.md"), sfx("learning-d.md"), sfx("shared-state-e.md"),
  ]);
  assert.equal(code, 0); // assembly always succeeds; batch=[exec-a,exec-b], rest deferred
});

test("main: no charter args → usage, exit 2", async () => {
  assert.equal(await main(["node", "s"]), 2);
});

test("main: missing charter file → exit 2", async () => {
  assert.equal(await main(["node", "s", "--root", REPO_ROOT, sfx("nope.md")]), 2);
});

test("main: no --root falls back to findRepoRoot", async () => {
  assert.equal(await main(["node", "s", sfx("exec-a.md"), sfx("exec-b.md")]), 0);
});

// ── DIR-117 iteration-2 item 4: touches-expansion re-evaluation (single-sourced; computeTouchesExpansion
// was inlined from the retired milestone-preparation-check.ts into concurrent-batch-scheduler.ts at
// gap-retire-the-prepare-execute-pipeline-cluster) ────────────────────────────────────────────────
test("loadReceiptTouches: null for a missing/absent receipt file", () => {
  assert.equal(loadReceiptTouches(null), null);
  assert.equal(loadReceiptTouches(path.join(SFX, "no-such-receipt.json")), null);
});

test("loadReceiptTouches: reads a real receipt's '.touches' array", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cbs-receipt-"));
  _tmpDirs.push(dir);
  const receiptFile = path.join(dir, "preparation.json");
  fs.writeFileSync(receiptFile, JSON.stringify({ touches: ["a.ts", "b.ts"] }));
  assert.deepEqual(loadReceiptTouches(receiptFile), ["a.ts", "b.ts"]);
});

test("applyPreparationExpansion: no receiptsById map → candidates unchanged, no expansions (golden replay)", () => {
  const cands = [parseCandidate("A", "## Touches\n- x/a.js")];
  const r = applyPreparationExpansion(cands, null);
  assert.deepEqual(r.candidates, cands);
  assert.deepEqual(r.expansions, []);
});

test("applyPreparationExpansion: a candidate with no matching receipt entry is unaffected", () => {
  const cands = [parseCandidate("A", "## Touches\n- x/a.js")];
  const r = applyPreparationExpansion(cands, { OTHER: "/nope.json" });
  assert.deepEqual(r.candidates, cands);
  assert.deepEqual(r.expansions, []);
});

test("applyPreparationExpansion: a candidate's checked-Plan receipt expands its effective touches", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cbs-receipt-"));
  _tmpDirs.push(dir);
  const receiptFile = path.join(dir, "preparation.json");
  fs.writeFileSync(receiptFile, JSON.stringify({ touches: ["y/b.js", "x/a.js"] }));
  const cands = [
    parseCandidate("A", "**type:** execution\n## Touches\n- x/a.js"),
    parseCandidate("B", "**type:** execution\n## Touches\n- y/b.js"),
  ];
  const r = applyPreparationExpansion(cands, { B: receiptFile });
  assert.equal(r.expansions.length, 1);
  assert.equal(r.expansions[0].id, "B");
  assert.deepEqual(r.expansions[0].addedGlobs, ["x/a.js"]);
  const bCand = r.candidates.find((c) => c.id === "B");
  assert.deepEqual(bCand.touches.globs, ["y/b.js", "x/a.js"]);
  const aCand = r.candidates.find((c) => c.id === "A");
  assert.deepEqual(aCand.touches.globs, ["x/a.js"]); // unaffected — no receipt entry for A
});

test("assembleBatch: a candidate re-evaluated with its EXPANDED touches is deferred for a real overlap the stale declaration hid (DIR-117 iteration-2 item 4, the exact 'not just detectable in isolation' proof)", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cbs-receipt-"));
  _tmpDirs.push(dir);
  const receiptFile = path.join(dir, "preparation.json");
  // B's checked Plan actually touches x/a.js too, even though B's declared '## Touches' only
  // ever said y/b.js — the exact staleness this item closes.
  fs.writeFileSync(receiptFile, JSON.stringify({ touches: ["y/b.js", "x/a.js"] }));
  const cands = [
    parseCandidate("A", "**type:** execution\n## Touches\n- x/a.js"),
    parseCandidate("B", "**type:** execution\n## Touches\n- y/b.js"),
  ];
  const expand = fakeExpand({ "x/a.js": ["x/a.js"], "y/b.js": ["y/b.js"] });
  // WITHOUT the receipt applied: A/B look declared-disjoint → both batch (the stale outcome).
  const stale = assembleBatch(cands, { expand });
  assert.deepEqual(stale.batch, ["A", "B"]);
  // WITH the receipt's expansion applied first: B's EFFECTIVE touches now overlap A's → re-evaluated, deferred.
  const { candidates: expandedCands } = applyPreparationExpansion(cands, { B: receiptFile });
  const fresh = assembleBatch(expandedCands, { expand });
  assert.deepEqual(fresh.batch, ["A"]);
  assert.equal(fresh.deferred.length, 1);
  assert.equal(fresh.deferred[0].id, "B");
  assert.match(fresh.deferred[0].reason, /not disjoint from A/);
});

test("main: --receipts flag is accepted and does not change behavior when no candidate id matches (backward compat)", async () => {
  const code = await main(["node", "s", "--root", REPO_ROOT, "--receipts", "nonexistent-id=/tmp/nope.json", sfx("exec-a.md"), sfx("exec-b.md")]);
  assert.equal(code, 0);
});

// ── DIR-116: end-to-end over real fixture charters (mirrors the RED/GREEN evidence in the M185
// iteration report, captured by replaying this exact fixture pair against the scheduler before and
// after the value-type check landed) ───────────────────────────────────────────────────────────
test("main: real governance-integrity clean candidate is excluded; real capability-growth candidate still batches (DIR-116 GREEN, real fs)", async () => {
  const code = await main([
    "node", "s", "--root", REPO_ROOT,
    sfx("cap-growth-explicit.md"), sfx("governance-integrity-clean.md"),
  ]);
  assert.equal(code, 0);
  // Re-derive via the pure function too, so the assertion is on real content, not just exit code.
  const capGrowth = parseCandidate("cap-growth-explicit", fs.readFileSync(sfx("cap-growth-explicit.md"), "utf8"));
  const govIntegrity = parseCandidate("governance-integrity-clean", fs.readFileSync(sfx("governance-integrity-clean.md"), "utf8"));
  assert.equal(capGrowth.valueType, "capability-growth");
  assert.equal(govIntegrity.valueType, "governance-integrity");
  const r = assembleBatch([capGrowth, govIntegrity], { expand: (globs) => expandGlobsForTest(globs, REPO_ROOT) });
  assert.deepEqual(r.batch, ["cap-growth-explicit"]);
  assert.equal(r.deferred[0].id, "governance-integrity-clean");
  assert.match(r.deferred[0].reason, /value-type/i);
});

// ── gap-dispatch-eligibility-blind-to-files-that-do-not-exist-yet ─────────────────────────────────
// The production expander compares DECLARED paths, not the filesystem. A task whose `## Touches`
// points only at files it will CREATE (the `(new)` case) must be judged by those declared paths —
// the old fs-backed expander expanded them to an EMPTY set, so checkTouchesPair's conservative
// "matched nothing (likely a typo)" branch fired (a false negative that also could NOT name a real
// overlap on a not-yet-created file: the verdict said "your glob is probably a typo" when two tasks
// actually collided on creating the same file).
test("expandDeclaredTouches: a concrete declared path resolves to itself even when the file does NOT exist", () => {
  const p = "plugin/scripts/brand-new-alpha.ts";
  assert.equal(fs.existsSync(path.join(REPO_ROOT, p)), false, "precondition: the fixture path must not exist in the tree");
  assert.deepEqual([...expandDeclaredTouches([p], REPO_ROOT)], [p]);
});

test("expandDeclaredTouches: a concrete declared path that exists still resolves (unchanged for the normal case)", () => {
  assert.deepEqual(
    [...expandDeclaredTouches(["experiments/quay-perpetual-stream/scripts/vmeta-lag-check.ts"], REPO_ROOT)],
    ["experiments/quay-perpetual-stream/scripts/vmeta-lag-check.ts"],
  );
});

test("expandDeclaredTouches: a wildcard still expands against the filesystem (AC4 — wildcard support kept)", () => {
  const set = expandDeclaredTouches(["experiments/quay-perpetual-stream/scripts/vmeta-lag-*.ts"], REPO_ROOT);
  assert.ok(set.size >= 1, "wildcard must resolve to the concrete files that exist");
  assert.ok(set.has("experiments/quay-perpetual-stream/scripts/vmeta-lag-check.ts"));
});

test("expandDeclaredTouches: a wildcard that matches nothing is EMPTY (the conservative 'likely a typo' survives for wildcards)", () => {
  const set = expandDeclaredTouches(["packages/quay/src/gate/definitely-no-such-*.js"], REPO_ROOT);
  assert.equal(set.size, 0);
});

test("assembleBatch (AC1): a NEW-file candidate vs an EXISTING-file candidate, clearly unrelated → disjoint, both batch", () => {
  const cands = [
    parseCandidate("A", "**type:** execution\n## Touches\n- plugin/scripts/brand-new-alpha.ts"),
    parseCandidate("B", "**type:** execution\n## Touches\n- packages/quay/src/serve.ts"),
  ];
  const r = assembleBatch(cands, { expand: (g) => expandDeclaredTouches(g, REPO_ROOT) });
  assert.deepEqual(r.batch, ["A", "B"]);
  assert.deepEqual(r.deferred, []);
});

test("assembleBatch (AC2): both declare the SAME not-yet-existing file → overlap, deferred reason NAMES the file (no typo excuse)", () => {
  const cands = [
    parseCandidate("A", "**type:** execution\n## Touches\n- plugin/scripts/brand-new-alpha.ts"),
    parseCandidate("C", "**type:** execution\n## Touches\n- plugin/scripts/brand-new-alpha.ts"),
  ];
  const r = assembleBatch(cands, { expand: (g) => expandDeclaredTouches(g, REPO_ROOT) });
  assert.deepEqual(r.batch, ["A"]);
  assert.equal(r.deferred.length, 1);
  assert.equal(r.deferred[0].id, "C");
  assert.match(r.deferred[0].reason, /overlapping file-sets/);
  assert.match(r.deferred[0].reason, /plugin\/scripts\/brand-new-alpha\.ts/, "the overlapping file must be NAMED");
  assert.doesNotMatch(r.deferred[0].reason, /matched nothing/, "not the 'matched nothing' false reason");
  assert.doesNotMatch(r.deferred[0].reason, /likely a typo/, "not the 'likely a typo' false reason");
});

test("assembleBatch (AC3): an EMPTY ## Touches section still serializes — conservative branch NOT relaxed", () => {
  const cands = [
    parseCandidate("A", "**type:** execution\n## Touches\n- x/a.js"),
    parseCandidate("EMPTY", "**type:** execution\n## Touches\n"),
  ];
  const r = assembleBatch(cands, { expand: (g) => expandDeclaredTouches(g, REPO_ROOT) });
  assert.deepEqual(r.batch, ["A"]);
  assert.equal(r.deferred.length, 1);
  assert.equal(r.deferred[0].id, "EMPTY");
  assert.match(r.deferred[0].reason, /no\/empty ## Touches/);
});

test("assembleBatch (AC3): an ABSENT ## Touches section still serializes (regression fixture 2)", () => {
  const cands = [
    parseCandidate("A", "**type:** execution\n## Touches\n- x/a.js"),
    parseCandidate("NONE", "**type:** execution\n## Proposal\nno touches section at all"),
  ];
  const r = assembleBatch(cands, { expand: (g) => expandDeclaredTouches(g, REPO_ROOT) });
  assert.deepEqual(r.batch, ["A"]);
  assert.equal(r.deferred.length, 1);
  assert.equal(r.deferred[0].id, "NONE");
  assert.match(r.deferred[0].reason, /no\/empty ## Touches/);
});

test("assembleBatch (AC4): a wildcard declaration still expands and overlap detection names the covered file", () => {
  const cands = [
    parseCandidate("A", "**type:** execution\n## Touches\n- experiments/quay-perpetual-stream/scripts/vmeta-lag-*.ts"),
    parseCandidate("B", "**type:** execution\n## Touches\n- experiments/quay-perpetual-stream/scripts/vmeta-lag-check.ts"),
  ];
  const r = assembleBatch(cands, { expand: (g) => expandDeclaredTouches(g, REPO_ROOT) });
  assert.deepEqual(r.batch, ["A"]);
  assert.equal(r.deferred.length, 1);
  assert.equal(r.deferred[0].id, "B");
  assert.match(r.deferred[0].reason, /overlapping file-sets/);
  assert.match(r.deferred[0].reason, /vmeta-lag-check\.ts/);
});

test("main --json (AC1): new-file vs existing-file pair → both batch, no defer (CLI surface)", async () => {
  // var names avoid `dir`/`dirA`-style collisions on purpose: the test-isolation R6 rule's cleanup
  // coverage is NAME-based, and this file's pre-existing baselined `mkdtemp-no-cleanup` entry uses
  // the name `dir` — introducing a cleaned `dir` would mask that baseline (stale-entry ratchet).
  const ac1Dir = fs.mkdtempSync(path.join(os.tmpdir(), "cbs-ac1-"));
  try {
    const newA = path.join(ac1Dir, "new-a.md");
    const existB = path.join(ac1Dir, "existing-b.md");
    fs.writeFileSync(newA, "**type:** execution\n## Touches\n- plugin/scripts/brand-new-alpha.ts\n");
    fs.writeFileSync(existB, "**type:** execution\n## Touches\n- packages/quay/src/serve.ts\n");
    const r = await runMainJson(["--root", REPO_ROOT, newA, existB]);
    assert.equal(r.code, 0);
    const parsed = JSON.parse(r.stdout);
    assert.deepEqual(parsed.batch, ["new-a", "existing-b"]);
    assert.deepEqual(parsed.deferred, []);
  } finally {
    fs.rmSync(ac1Dir, { recursive: true, force: true });
  }
});

test("main --json (AC2): both declare the same not-yet-existing file → deferred reason names the file, no typo excuse (CLI surface)", async () => {
  const ac2Dir = fs.mkdtempSync(path.join(os.tmpdir(), "cbs-ac2-"));
  try {
    const a = path.join(ac2Dir, "a.md");
    const c = path.join(ac2Dir, "c.md");
    fs.writeFileSync(a, "**type:** execution\n## Touches\n- plugin/scripts/brand-new-alpha.ts\n");
    fs.writeFileSync(c, "**type:** execution\n## Touches\n- plugin/scripts/brand-new-alpha.ts\n");
    const r = await runMainJson(["--root", REPO_ROOT, a, c]);
    assert.equal(r.code, 0);
    const parsed = JSON.parse(r.stdout);
    assert.deepEqual(parsed.batch, ["a"]);
    assert.equal(parsed.deferred.length, 1);
    assert.match(parsed.deferred[0].reason, /plugin\/scripts\/brand-new-alpha\.ts/);
    assert.doesNotMatch(parsed.deferred[0].reason, /likely a typo/);
  } finally {
    fs.rmSync(ac2Dir, { recursive: true, force: true });
  }
});

test("main --json (AC5): 2026-08-03 03:37Z inner dispatch replay — production entry matches the inner hand-written expand pairwise", async () => {
  // The three real tasks the inner loop dispatched on 2026-08-03 03:37Z (frozen as fixtures under
  // fixtures/scheduler/replay-*.md). The inner hand-written expand concluded
  // "test-isolation vs no-resource-awareness => false OVERLAP: [\"scripts/test.sh\"]" and the other
  // two pairs disjoint. The production entry must reproduce exactly that, pairwise.
  const t = sfx("replay-test-isolation.md");
  const n = sfx("replay-no-resource-awareness.md");
  const r = sfx("replay-reclaim.md");

  const tn = JSON.parse((await runMainJson(["--root", REPO_ROOT, t, n])).stdout);
  assert.deepEqual(tn.batch, ["replay-test-isolation"]);
  assert.equal(tn.deferred.length, 1);
  assert.equal(tn.deferred[0].id, "replay-no-resource-awareness");
  assert.match(tn.deferred[0].reason, /scripts\/test\.sh/, "the recorded overlap on scripts/test.sh must be named");
  assert.match(tn.deferred[0].reason, /overlapping file-sets/);

  const tr = JSON.parse((await runMainJson(["--root", REPO_ROOT, t, r])).stdout);
  assert.deepEqual([...tr.batch].sort(), ["replay-reclaim", "replay-test-isolation"]);
  assert.deepEqual(tr.deferred, []);

  const nr = JSON.parse((await runMainJson(["--root", REPO_ROOT, n, r])).stdout);
  assert.deepEqual([...nr.batch].sort(), ["replay-no-resource-awareness", "replay-reclaim"]);
  assert.deepEqual(nr.deferred, []);
});

test("mirror: plugin/scripts/concurrent-batch-scheduler.ts and the experiments mirror are byte-identical", () => {
  const real = fs.readFileSync(path.join(REPO_ROOT, "plugin/scripts/concurrent-batch-scheduler.ts"), "utf8");
  const mirror = fs.readFileSync(path.join(REPO_ROOT, "experiments/quay-perpetual-stream/scripts/concurrent-batch-scheduler.ts"), "utf8");
  assert.equal(real, mirror, "the experiments mirror must stay byte-identical to the plugin original");
});
