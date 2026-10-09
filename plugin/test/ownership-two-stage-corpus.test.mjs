// @test-group engine
// Integrity tests for the TWO-STAGE GOAL-030..033 replay corpus.
// Implements the benchmark-redesign requirements: T0/T1 separation, no outcome leakage into
// either stage, alternative-answer tolerance, and a granularity dimension that can come out false.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  CORPUS_ROOT, listCases, stageAInstructions, stageBInstructions, reference,
  scoreStageA, scoreStageB,
} from "../../docs/analysis/ownership-two-stage-evaluator.mjs";

const CASES = listCases();

// The chosen artifacts / measured outcomes of each real goal. None of these may appear in a
// model-facing stage file — that is the whole point of the redesign.
const OUTCOME_IDENTIFIERS = {
  "GOAL-030": ["task-transition.ts", "decideTransition", "branch-selfhost-probe", "LIFECYCLE_EDGES", "patchStatusField"],
  "GOAL-031": ["isTaskStatus", "dispersion 5 -> 4", "dispersion 5 → 4", "6 -> 1", "6 → 1"],
  "GOAL-032": ["verdict-parse.ts", "parseBinaryVerdict", "薄包装", "thin wrapper"],
  "GOAL-033": ["driver-control.ts", "driver-vocab.ts", "probeInstruments", "6 -> 4", "6 → 4"],
};

test("both stage files exist for every case and declare the right stage", () => {
  assert.deepEqual(CASES, ["GOAL-030", "GOAL-031", "GOAL-032", "GOAL-033"]);
  for (const c of CASES) {
    const a = stageAInstructions(c), b = stageBInstructions(c);
    assert.equal(a.stage, "A");
    assert.equal(b.stage, "B");
    assert.equal(a.case_id, c);
    assert.equal(b.case_id, c);
  }
});

test("T0 precedes T1 precedes real activation, for every case", () => {
  for (const c of CASES) {
    const a = stageAInstructions(c), b = stageBInstructions(c), r = reference(c);
    const t0 = new Date(a.cutoff).getTime(), t1 = new Date(b.cutoff).getTime();
    const act = new Date(r.timeline.activated_at).getTime();
    assert.ok(t0 < t1, `${c}: T0 (${a.cutoff}) must precede T1 (${b.cutoff})`);
    assert.ok(t1 <= act, `${c}: T1 (${b.cutoff}) must not be after activation`);
    assert.equal(a.cutoff_label, "T0-concern-discovery");
    assert.equal(b.cutoff_label, "T1-decision-ready");
  }
});

test("NO outcome/solution identifier appears in either stage file (the core anti-leak guard)", () => {
  for (const c of CASES) {
    const a = fs.readFileSync(path.join(CORPUS_ROOT, c, "stage_a.json"), "utf8");
    const b = fs.readFileSync(path.join(CORPUS_ROOT, c, "stage_b.json"), "utf8");
    for (const marker of OUTCOME_IDENTIFIERS[c]) {
      assert.ok(!a.includes(marker), `${c}: outcome identifier "${marker}" leaked into stage_a (T0)`);
      assert.ok(!b.includes(marker), `${c}: outcome identifier "${marker}" leaked into stage_b (T1)`);
    }
  }
});

test("T0 carries no investigation conclusion that T1 is supposed to add", () => {
  // GOAL-032: the equivalence verdict is a T1 finding, not a T0 fact.
  const a32 = fs.readFileSync(path.join(CORPUS_ROOT, "GOAL-032", "stage_a.json"), "utf8");
  assert.ok(!/\bequivalent\b/i.test(a32), "GOAL-032 T0 must not state the equivalence conclusion");
  assert.ok(!/equivalence_investigation_status/.test(a32), "GOAL-032 T0 must not carry the investigation-status field");
  const b32 = stageBInstructions("GOAL-032");
  assert.ok(b32.investigation_findings.some((f) => /equivale/i.test(f)), "GOAL-032 T1 must carry the equivalence finding");

  // GOAL-033: the exact edge enumeration is a T1 finding.
  const a33 = fs.readFileSync(path.join(CORPUS_ROOT, "GOAL-033", "stage_a.json"), "utf8");
  assert.ok(!/exactly 2/.test(a33), "GOAL-033 T0 must not carry the enumerated edge count");
  const b33 = stageBInstructions("GOAL-033");
  assert.ok(b33.investigation_findings.some((f) => /exactly 2/.test(f)), "GOAL-033 T1 must carry the enumeration");

  // GOAL-031: the per-hit classification is a T1 finding.
  const b31 = stageBInstructions("GOAL-031");
  assert.ok(b31.investigation_findings.some((f) => /FALSE POSITIVE/i.test(f)), "GOAL-031 T1 must carry the classification");
});

test("hindsight metadata (what the T1 belief got WRONG) lives in reference only, never in the prompt", () => {
  for (const c of CASES) {
    const b = fs.readFileSync(path.join(CORPUS_ROOT, c, "stage_b.json"), "utf8");
    assert.ok(!/not_established_at_T1|not_at_T1/.test(b), `${c}: hindsight-gap field must not be model-facing`);
    const r = reference(c);
    assert.ok(Array.isArray(r.t1_belief_gaps) && r.t1_belief_gaps.length > 0, `${c}: evaluator-side t1_belief_gaps missing`);
  }
  // The sharpest case: GOAL-033's real T1 belief was 6->5; the 6->4 correction is outcome-only.
  const r33 = reference("GOAL-033");
  assert.ok(r33.t1_belief_gaps.join(" ").includes("fan-in"), "GOAL-033 belief gap should record the fan-in collateral");
});

test("the reference tolerates alternative valid slices (the historical slice is not the sole answer)", () => {
  for (const c of CASES) {
    const sb = reference(c).stage_b_reference;
    assert.ok(Array.isArray(sb.alternative_valid_slices) && sb.alternative_valid_slices.length >= 2,
      `${c}: needs >=2 alternative valid slices`);
    assert.ok(Array.isArray(sb.clearly_too_broad) && sb.clearly_too_broad.length > 0, `${c}: needs too-broad counterfactuals`);
    assert.ok(Array.isArray(sb.clearly_too_fragmented) && sb.clearly_too_fragmented.length > 0, `${c}: needs too-fragmented counterfactuals`);
    assert.ok(sb.minimum_sufficiency_rationale && sb.minimum_sufficiency_rationale.length > 80, `${c}: min-sufficiency rationale too thin`);
  }
});

test("granularity is FALSIFIABLE: a too-broad and a too-fragmented candidate each score as such (not vacuously sufficient)", () => {
  for (const c of CASES) {
    const sb = reference(c).stage_b_reference;
    const base = {
      investigate_or_goal: sb.investigate_or_goal,
      scope: { in_scope: ["x"], non_goals: ["y"] },
      expected_mechanical_delta: "1 -> 0", negative_control: "x".repeat(50),
      abandon_or_reconsider_condition: "abandon if the premise fails",
      harnessability: { inputs: "a", outputs: "b", constraints: "c", acceptance: "d", failure_mode: "e" },
    };
    const broad = scoreStageB(c, { ...base, candidate_slices: [{ title: sb.clearly_too_broad[0], description: sb.clearly_too_broad[0] }] });
    const frag = scoreStageB(c, { ...base, candidate_slices: [{ title: sb.clearly_too_fragmented[0], description: sb.clearly_too_fragmented[0] }] });
    const good = scoreStageB(c, { ...base, candidate_slices: [{ title: sb.reference_slice.slice(0, 200), description: sb.reference_slice.slice(0, 300) }] });
    assert.equal(broad.granularity.verdict, "too-broad", `${c}: too-broad counterfactual must score too-broad`);
    assert.equal(frag.granularity.verdict, "too-fragmented", `${c}: too-fragmented counterfactual must score too-fragmented`);
    assert.equal(good.granularity.verdict, "sufficient", `${c}: the reference slice must score sufficient`);
  }
});

test("stage A: correct abstention and a missed visible concern are distinguished", () => {
  const c = "GOAL-030";
  const ref = reference(c).stage_a_reference;
  assert.equal(ref.abstain_acceptable, false, "GOAL-030 has a visible concern, so abstaining is not acceptable");
  const abstain = scoreStageA(c, { concerns: [], overall_assessment: "no_concern_visible" });
  assert.equal(abstain.abstention.verdict, "missed_a_visible_concern");
  const found = scoreStageA(c, {
    concerns: [{ concern: ref.expected_concerns[0], evidence_refs: [stageAInstructions(c).citable_evidence_refs[0]], needs_investigation: true, confidence: "medium" }],
    overall_assessment: "concerns_found",
  });
  assert.equal(found.concern_validity.any_matches_expected, true);
  assert.equal(found.ranking.valid_concern_ranked_first, true);
});

test("stage A: an invented evidence ref is reported as an unsupported claim", () => {
  const c = "GOAL-030";
  const r = scoreStageA(c, {
    concerns: [{ concern: "anything at all about ownership", evidence_refs: ["archguard:invented_reading"], confidence: "high" }],
    overall_assessment: "concerns_found",
  });
  assert.equal(r.grounding.all_cited_refs_resolve, false);
  assert.deepEqual(r.grounding.unsupported_claims, ["archguard:invented_reading"]);
});

test("no stage file is a clone of the v1 input.json (the redesign actually changed the evidence)", () => {
  for (const c of CASES) {
    const v1 = fs.readFileSync(path.join(CORPUS_ROOT, c, "input.json"), "utf8");
    const a = fs.readFileSync(path.join(CORPUS_ROOT, c, "stage_a.json"), "utf8");
    assert.notEqual(a, v1, `${c}: stage_a must not be a verbatim copy of the v1 input`);
    const v1c = JSON.parse(v1).context, ac = JSON.parse(a).context;
    assert.notDeepEqual(ac, v1c, `${c}: stage_a context must differ from the v1 context`);
  }
});
