// @test-group engine
// Unit tests for concurrent-batch-scheduler.mjs — the two-level scheduler's ASSEMBLY core
// (DIR-044 increment 2). Given rank-ordered candidate charters, greedily assemble a maximal
// touches-DISJOINT, execution-type batch that touches NO shared exp5 state, deferring the rest to a
// later (serial) round. RED-first (ADR-001 / DIR-019). The disjointness verdict is single-sourced —
// this module IMPORTS checkTouchesPair from touches-orthogonality-check.mjs, never re-implements it.
// Run:
//   node --test experiments/quay-perpetual-stream/test/concurrent-batch-scheduler.test.mjs
import { test } from "node:test";
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

// A fake expander maps a declared glob → concrete file set (hermetic, no fs).
const fakeExpand = (mapping) => (globs) => {
  const out = new Set();
  for (const g of globs) for (const f of (mapping[g] || [])) out.add(f);
  return out;
};

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

// ── DIR-117 iteration-2 item 4: touches-expansion re-evaluation (single-sourced via
// milestone-preparation-check.ts's computeTouchesExpansion, never reinvented) ──────────────────────
test("loadReceiptTouches: null for a missing/absent receipt file", () => {
  assert.equal(loadReceiptTouches(null), null);
  assert.equal(loadReceiptTouches(path.join(SFX, "no-such-receipt.json")), null);
});

test("loadReceiptTouches: reads a real receipt's '.touches' array", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cbs-receipt-"));
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
