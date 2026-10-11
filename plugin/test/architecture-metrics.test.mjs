// @test-group engine
// Tests for the architecture METRICS (task gap-architecture-evidence-store-and-decision-memory, AC3/AC5).
// The central contract is 硬规则 6: a production run has NO ground truth, so the three judgement readings
// must come back as exactly `{state:"not-evaluated"}` — never 0, which would read as "measured, and it was
// perfect". AC5 asserts that shape exactly; the tests here pin it from both sides.

import { test } from "node:test";
import assert from "node:assert/strict";

import { computeRunMetrics, evidenceCost, touchedFilesOf, aggregateMetrics, NOT_EVALUATED, normalizeGroundTruth } from "../../docs/analysis/architecture-metrics.mjs";

// A run that read one file and proposed moving another.
const readOnly = (over = {}) => ({
  usage: { rounds: 5, evidence_requests: 4, evidence_bytes: 12345 },
  steps: [
    { round: 1, outcome: "evidence", request: { kind: "read_file", path: "packages/quay/src/serve.ts" } },
    { round: 2, outcome: "evidence", request: { kind: "grep", paths: ["packages/quay/src"] } },
  ],
  evidence: [{ id: "ev-1", request: { kind: "read_file", path: "packages/quay/src/serve.ts" }, provenance: { path: "packages/quay/src/serve.ts" } }],
  envelope: { concern: "unresolved", scope: { in_scope: [] }, candidate_interventions: [] },
  ...over,
});
const proposing = (files, over = {}) => readOnly({
  terminal: { kind: "propose_slice" },
  envelope: { concern: `relocate ${files[0]} into the root layer`, scope: { in_scope: files.map((f) => `${f} (the module to relocate)`) }, candidate_interventions: [{ title: `Move ${files[0]} to the root`, rationale: "lower layer" }] },
  ...over,
});

const GT = { goal: "GOAL-033", concern_kind: "package-cycle", changed_files: ["packages/quay/src/cli/driver.ts", "packages/quay/src/driver-control.ts"], slice_files: ["packages/quay/src/cli/driver.ts"] };

// ── AC5: production honesty ───────────────────────────────────────────────────────────────────
test("AC5: a run with NO ground truth returns exactly {state:'not-evaluated'} for the three judgement readings", () => {
  const m = computeRunMetrics(readOnly());
  assert.deepEqual(m.falsePositiveRate, { state: "not-evaluated" });
  assert.deepEqual(m.locality, { state: "not-evaluated" });
  assert.deepEqual(m.recoveryRounds, { state: "not-evaluated" });
  assert.deepEqual(Object.keys(m.falsePositiveRate), ["state"], "the not-evaluated value carries no numeric field that could be mistaken for a reading");
  assert.deepEqual(NOT_EVALUATED, { state: "not-evaluated" });
});

test("AC5: evidenceCost is ALWAYS concrete — it counts what happened and needs no ground truth", () => {
  const m = computeRunMetrics(readOnly());
  assert.deepEqual(m.evidenceCost, { rounds: 5, requests: 4, bytes: 12345 });
  assert.deepEqual(evidenceCost({ usage: { rounds: 1, evidence_requests: 0, evidence_bytes: 0 } }), { rounds: 1, requests: 0, bytes: 0 });
  assert.equal(computeRunMetrics(proposing(["packages/quay/src/cli/driver.ts"])).evidenceCost.rounds, 5, "a proposing run reports its cost too");
});

test("passing null/undefined ground truth is the SAME as passing none (no accidental evaluation)", () => {
  for (const gt of [null, undefined]) assert.deepEqual(computeRunMetrics(readOnly(), gt).locality, { state: "not-evaluated" });
});

// ── AC3: with ground truth, all four readings are concrete ────────────────────────────────────
test("AC3: with ground truth all four readings are concrete (never not-evaluated)", () => {
  const m = computeRunMetrics(proposing(["packages/quay/src/cli/driver.ts"]), GT);
  assert.equal(m.evidenceCost.rounds, 5);
  assert.equal(m.falsePositiveRate.state, "evaluated");
  assert.equal(typeof m.falsePositiveRate.value, "number");
  assert.equal(m.locality.state, "evaluated");
  assert.equal(typeof m.locality.value, "number");
  assert.equal(m.recoveryRounds.state, "evaluated");
  assert.equal(typeof m.recoveryRounds.rounds, "number");
  assert.equal(typeof m.recoveryRounds.recovered, "boolean");
});

test("falsePositiveRate is 0 for a proposal that names a file the goal actually moved, 1 for one that does not", () => {
  assert.equal(computeRunMetrics(proposing(["packages/quay/src/cli/driver.ts"]), GT).falsePositiveRate.value, 0);
  const fp = computeRunMetrics(proposing(["packages/quay/src/gate/config/loader.ts"]), GT);
  assert.equal(fp.falsePositiveRate.value, 1);
  assert.deepEqual(fp.falsePositiveRate.matched_slice_files, []);
});

test("a run that proposed NOTHING is not a false positive — and says so rather than reporting a bare 0", () => {
  const m = computeRunMetrics(readOnly(), GT);
  assert.equal(m.falsePositiveRate.value, 0);
  assert.equal(m.falsePositiveRate.proposals, 0);
  assert.match(m.falsePositiveRate.reason, /no proposal/);
});

test("locality is the fraction of everything touched that sits inside the goal's real change set", () => {
  const m = computeRunMetrics(proposing(["packages/quay/src/cli/driver.ts"]), GT);
  // touched = serve.ts (read) + cli/driver.ts (proposed); only the latter is in the goal's change set.
  assert.equal(m.locality.value, 0.5);
  assert.deepEqual({ touched: m.locality.touched, in_goal: m.locality.in_goal }, { touched: 2, in_goal: 1 });
});

test("recoveryRounds names the round the run first touched the goal's real area, and reports whether it did", () => {
  const m = computeRunMetrics(proposing(["packages/quay/src/cli/driver.ts"]), GT);
  assert.equal(m.recoveryRounds.recovered, true);
  assert.equal(m.recoveryRounds.rounds, 5, "the proposal is the terminal round, so nothing earlier matched");
  const never = computeRunMetrics(proposing(["packages/quay/src/gate/config/loader.ts"]), GT);
  assert.equal(never.recoveryRounds.recovered, false, "`never` must be distinguishable from `recovered at the last round`");
  assert.equal(never.recoveryRounds.rounds, 5, "…and the round count is still a concrete number");
});

test("touchedFilesOf unions READ files and proposed files — a grep's directory scope is not a file it touched", () => {
  assert.deepEqual(touchedFilesOf(proposing(["packages/quay/src/cli/driver.ts"])), ["packages/quay/src/cli/driver.ts", "packages/quay/src/serve.ts"]);
  const grepOnly = readOnly({ evidence: [{ id: "ev-1", request: { kind: "grep", paths: ["packages/quay/src"] }, provenance: { tool: "grep" } }] });
  assert.deepEqual(touchedFilesOf(grepOnly), [], "a directory scope is not a touched file");
});

test("normalizeGroundTruth tolerates a missing slice_files (falls back to the changed set)", () => {
  const g = normalizeGroundTruth({ goal: "G", changed_files: ["a/b.ts"] });
  assert.deepEqual([...g.slice_files], ["a/b.ts"]);
  assert.deepEqual([...normalizeGroundTruth({ changed_files: ["./a/b.ts"] }).changed_files], ["a/b.ts"]);
});

// ── aggregation (the Holdout A/B comparison table) ────────────────────────────────────────────
test("aggregateMetrics never invents a value for a corpus that was not evaluated", () => {
  const prod = [readOnly(), readOnly()].map((r) => computeRunMetrics(r));
  const a = aggregateMetrics(prod);
  assert.equal(a.falsePositiveRate.state, "not-evaluated");
  assert.equal(a.falsePositiveRate.value, null);
  assert.equal(a.locality.state, "not-evaluated");
  assert.equal(a.evidenceCost.rounds, 10, "cost aggregates even when the judgements do not");
  const withGt = [readOnly(), proposing(["packages/quay/src/cli/driver.ts"])].map((r) => computeRunMetrics(r, GT));
  const b = aggregateMetrics(withGt);
  assert.equal(b.falsePositiveRate.state, "evaluated");
  assert.equal(b.falsePositiveRate.evaluated_runs, 2);
  assert.equal(b.falsePositiveRate.false_positives, 0);
});

test("evidenceCost of an empty corpus is 0, not null — a count of nothing is still a count", () => {
  const a = aggregateMetrics([]);
  assert.deepEqual(a.evidenceCost, { rounds: 0, requests: 0, bytes: 0 });
  assert.equal(a.runs, 0);
});
