#!/usr/bin/env node
// Generator for the two-stage GOAL-030..033 replay corpus.
//
// WHY THIS EXISTS (from the design audit):
//   The v1 corpus presented a T0-ish (concern-discovery) evidence bundle but scored against a
//   T1-ish (decision-ready) gold — the human had already investigated before writing the goal.
//   That is a hindsight mismatch, not a model failure. It also (a) allowed only ONE correct slice,
//   (b) gave the model ~600 chars of evidence where the human had the whole repo, and (c) drove
//   investigate-vs-goal from a state where "investigate" was the instructed answer.
//
// WHAT IT WRITES, per case:
//   stage_a.json  — T0 discovery input: concern-discovery state ONLY, no investigation results.
//   stage_b.json  — T1 decomposition input: a CONFIRMED concern + the findings the human actually
//                   established during investigation, with a small buffer made explicit in
//                   `not_established_at_T1`. Outcome/solution details are NEVER included.
//   reference.json (patched) — adds alternative/adjacent slices, too-broad & too-fragmented
//                   counterfactuals, the T0/T1 timeline, and per-stage gold.
//
// ⛔ T1 is "decision-ready", NOT "outcome-known". In particular GOAL-033's real T1 belief was
//    that the SCC would go 6→5; the later 6→4 correction is recorded as OUTCOME, never as input.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CORPUS = path.resolve(HERE, "..", "..", "plugin", "fixtures", "meta-driver-replay");

const COMMON_QUESTIONS_A = [
  "a) What ownership / canonicalization / dependency-boundary concerns are visible in this state? (<=3)",
  "b) For each concern, which evidence refs ground it?",
  "c) Does it need investigation before any slice can be defined, or is it decision-ready?",
  "d) How confident are you, and what would raise or lower that confidence?",
  "e) If nothing ownership-shaped is visible, say so (abstain) — that is a valid answer.",
];

const COMMON_QUESTIONS_B = [
  "a) What candidate slices follow from this concern? (<=3, ordered)",
  "b) Which one should be done first, and why is it minimum-sufficient?",
  "c) investigate, or propose-goal? Justify from the T1 findings.",
  "d) Scope and explicit non-goals.",
  "e) What mechanical before/after delta would evidence success?",
  "f) What negative control distinguishes 'it worked' from 'it looks like it worked'?",
  "g) What would make you abandon or materially revise this?",
  "h) Is this harnessable as stated (inputs/outputs/constraints/acceptance/failure mode)?",
];

const RESPONSE_A = {
  type: "object",
  required: ["concerns", "overall_assessment"],
  properties: {
    concerns: {
      type: "array",
      maxItems: 3,
      items: {
        type: "object",
        required: ["concern", "evidence_refs", "needs_investigation", "confidence"],
        properties: {
          concern: { type: "string" },
          evidence_refs: { type: "array", items: { type: "string" } },
          needs_investigation: { type: "boolean" },
          what_to_investigate: { type: "string" },
          confidence: { enum: ["low", "medium", "high"] },
        },
      },
    },
    overall_assessment: { enum: ["no_concern_visible", "concerns_found"] },
  },
};

const RESPONSE_B = {
  type: "object",
  required: [
    "candidate_slices", "recommended_first", "investigate_or_goal", "scope",
    "expected_mechanical_delta", "negative_control", "abandon_or_reconsider_condition",
    "harnessability", "minimum_sufficiency_rationale",
  ],
  properties: {
    candidate_slices: {
      type: "array",
      maxItems: 3,
      items: { type: "object", properties: { title: { type: "string" }, description: { type: "string" }, why_plausible: { type: "string" } } },
    },
    recommended_first: { type: "string" },
    investigate_or_goal: { enum: ["investigate", "propose-goal"] },
    scope: { type: "object", properties: { in_scope: { type: "array", items: { type: "string" } }, non_goals: { type: "array", items: { type: "string" } } } },
    expected_mechanical_delta: { type: "string" },
    negative_control: { type: "string" },
    abandon_or_reconsider_condition: { type: "string" },
    harnessability: {
      type: "object",
      required: ["inputs", "outputs", "constraints", "acceptance", "failure_mode"],
      properties: {
        inputs: { type: "string" }, outputs: { type: "string" }, constraints: { type: "string" },
        acceptance: { type: "string" }, failure_mode: { type: "string" },
      },
    },
    minimum_sufficiency_rationale: { type: "string" },
  },
};

function evidenceRefs(list) {
  return list.map((r) => `- ${r}`).join("\n");
}

function writeStageA(c) {
  const doc = {
    case_id: c.id,
    stage: "A",
    stage_name: "discovery",
    cutoff: c.t0,
    cutoff_label: "T0-concern-discovery",
    cutoff_rationale: c.t0_rationale,
    context: c.t0_context,
    citable_evidence_refs: c.refs,
    task: {
      instructions:
        "You are a NARROW ownership/architecture analyst. This is a DISCOVERY stage: identify what, if anything, ownership-shaped is visible in the state below. You are NOT asked to match any historical decision, and you do NOT need to propose a fix. Saying no concern is visible is a valid and sometimes correct answer. Cite only the listed evidence refs; do not invent readings.",
      questions: COMMON_QUESTIONS_A,
      response_schema: RESPONSE_A,
      citable_evidence_refs: c.refs,
    },
  };
  fs.writeFileSync(path.join(CORPUS, c.id, "stage_a.json"), JSON.stringify(doc, null, 2) + "\n", "utf8");
}

function writeStageB(c) {
  const doc = {
    case_id: c.id,
    stage: "B",
    stage_name: "decomposition",
    cutoff: c.t1,
    cutoff_label: "T1-decision-ready",
    cutoff_rationale: c.t1_rationale,
    confirmed_concern: c.concern,
    investigation_findings: c.t1_findings,
    // ⛔ `not_at_t1` is deliberately NOT emitted here: it names what the T1 belief got WRONG
    //    (e.g. "fan-in leaves too"), which is outcome knowledge. It lives in reference.json as
    //    metadata for the evaluator's hindsight check, never in the model-facing prompt.
    context: c.t1_context,
    citable_evidence_refs: c.refs,
    task: {
      instructions:
        "You are a NARROW ownership/architecture proposer. This is a DECOMPOSITION stage: the concern below is already confirmed, and the investigation findings are established facts as of T1. Propose the minimal-sufficient slice. Several decompositions may be defensible — you are scored on whether yours is coherent, minimum-sufficient and harnessable, NOT on matching one historical artifact. Cite only the listed evidence refs; do not invent readings.",
      questions: COMMON_QUESTIONS_B,
      response_schema: RESPONSE_B,
      citable_evidence_refs: c.refs,
    },
  };
  fs.writeFileSync(path.join(CORPUS, c.id, "stage_b.json"), JSON.stringify(doc, null, 2) + "\n", "utf8");
}

function patchReference(c) {
  const p = path.join(CORPUS, c.id, "reference.json");
  const ref = JSON.parse(fs.readFileSync(p, "utf8"));
  ref.timeline = { t0: c.t0, t1: c.t1, activated_at: c.activated_at, note: c.timeline_note };
  ref.t1_belief_gaps = c.not_at_T1; // evaluator-side metadata only (never fed to the model)
  ref.stage_a_reference = c.stage_a_ref;
  ref.stage_b_reference = {
    investigate_or_goal: c.stage_b_ref.investigate_or_goal,
    investigate_or_goal_rationale: c.stage_b_ref.rationale,
    minimum_sufficiency_rationale: c.stage_b_ref.min_sufficiency,
    reference_slice: ref.selected_slice,
    alternative_valid_slices: c.stage_b_ref.alternatives,
    adjacent_reasonable_slices: c.stage_b_ref.adjacent,
    clearly_too_broad: c.stage_b_ref.too_broad,
    clearly_too_fragmented: c.stage_b_ref.too_fragmented,
    expected_delta_predicted_at_t1: c.stage_b_ref.predicted_delta,
    expected_delta_observed: c.stage_b_ref.observed_delta,
  };
  // v1 field kept for backward compat with the existing evaluator, but the T1-stage gold supersedes it.
  ref.deprecated_note = "investigation_or_goal_reference is the v1 single-stage gold; use stage_b_reference for the two-stage benchmark.";
  fs.writeFileSync(p, JSON.stringify(ref, null, 2) + "\n", "utf8");
}

const CASES = JSON.parse(fs.readFileSync(path.join(HERE, "two-stage-corpus-spec.json"), "utf8"));

for (const c of CASES.cases) {
  writeStageA(c);
  writeStageB(c);
  patchReference(c);
  process.stderr.write(`  wrote ${c.id}: stage_a, stage_b, reference.patched\n`);
}
process.stderr.write(`done: ${CASES.cases.length} cases\n`);
