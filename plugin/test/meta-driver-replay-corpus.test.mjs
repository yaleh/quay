// @test-group engine
// Dataset-integrity tests for plugin/fixtures/meta-driver-replay/ — see its README.md and
// tasks/gap-meta-driver-offline-replay-corpus-goal030-033.md. These tests guard the corpus's
// own structural promises (cutoff/input/reference separation, schema completeness, no
// reference leaking into the default prompt, unique case ids) — they do NOT score any
// candidate's architectural judgment.
//
// Run: scripts/test.sh plugin/test/meta-driver-replay-corpus.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  CORPUS_ROOT,
  listCaseIds,
  loadCaseInput,
  loadCaseReference,
  loadCaseOutcome,
  buildDefaultPrompt,
  scoreResponse,
} from "./helpers/meta-driver-replay-harness.mjs";

const INPUT_REQUIRED = ["case_id", "cutoff", "context", "decision_prompt_schema"];
const REFERENCE_REQUIRED = [
  "case_id",
  "selected_concern",
  "selected_slice",
  "why_now",
  "why_not_others",
  "risk",
  "scope_discipline",
  "acceptance_evidence",
  "stop_abandon_condition",
  "leakage_markers",
  "investigation_or_goal_reference",
  "granularity_rationale",
];
const GRANULARITY_RATIONALE_REQUIRED = [
  "granularity_label",
  "why_not_broader",
  "why_not_finer",
  "harnessable_subproblems",
  "investigation_required_subproblems",
  "primitives_reused",
];
const OUTCOME_REQUIRED = ["case_id", "status"];

test("corpus has exactly the expected 4 cases, unique ids matching directory names", () => {
  const ids = listCaseIds();
  assert.deepEqual(ids, ["GOAL-030", "GOAL-031", "GOAL-032", "GOAL-033"]);
  const seen = new Set();
  for (const id of ids) {
    assert.ok(!seen.has(id), `duplicate case id ${id}`);
    seen.add(id);
    const input = loadCaseInput(id);
    const reference = loadCaseReference(id);
    const outcome = loadCaseOutcome(id);
    assert.equal(input.case_id, id, `input.json case_id must match directory name for ${id}`);
    assert.equal(reference.case_id, id, `reference.json case_id must match directory name for ${id}`);
    assert.equal(outcome.case_id, id, `outcome.json case_id must match directory name for ${id}`);
  }
});

for (const id of ["GOAL-030", "GOAL-031", "GOAL-032", "GOAL-033"]) {
  test(`${id}: input.json has all required schema keys, including the decomposition question (i) and response schema`, () => {
    const input = loadCaseInput(id);
    for (const key of INPUT_REQUIRED) assert.ok(key in input, `input.json missing ${key}`);
    const { questions, response_schema } = input.decision_prompt_schema;
    assert.ok(Array.isArray(questions) && questions.length === 9, "must have exactly 9 questions (a-h plus the decomposition question i)");
    assert.ok(questions.some((q) => q.startsWith("i)") && /decompose/i.test(q)), "question (i) must ask for decomposition reasoning");
    assert.ok(typeof response_schema === "object");
    assert.ok(
      response_schema.required.includes("decomposition_rationale"),
      "response_schema must require decomposition_rationale — otherwise decomposition quality cannot be scored at all"
    );
    const drSchema = response_schema.properties.decomposition_rationale;
    assert.ok(drSchema, "response_schema.properties.decomposition_rationale missing");
    for (const key of ["granularity_assessment", "why_not_broader", "why_not_finer", "harnessable_subproblems", "investigation_required_subproblems", "primitives_reused"]) {
      assert.ok(key in drSchema.properties, `decomposition_rationale schema missing property ${key}`);
    }
  });

  test(`${id}: reference.json has all required schema keys, including granularity_rationale (why this is minimal-sufficient)`, () => {
    const reference = loadCaseReference(id);
    for (const key of REFERENCE_REQUIRED) assert.ok(key in reference, `reference.json missing ${key}`);
    assert.ok(Array.isArray(reference.leakage_markers) && reference.leakage_markers.length > 0, "leakage_markers must be a non-empty array");
    assert.ok(Array.isArray(reference.scope_discipline.non_goals) && reference.scope_discipline.non_goals.length > 0);
    assert.ok(Array.isArray(reference.scope_discipline.stop_signals) && reference.scope_discipline.stop_signals.length > 0);

    const gr = reference.granularity_rationale;
    for (const key of GRANULARITY_RATIONALE_REQUIRED) assert.ok(key in gr, `granularity_rationale missing ${key} for ${id}`);
    assert.equal(gr.granularity_label, "sufficient", `all 4 real gold cases are real landed/in-progress decisions, so their own ground truth granularity must be "sufficient" for ${id}`);
    assert.ok(gr.why_not_broader.trim().length >= 40, `why_not_broader too thin to actually justify minimal-sufficiency for ${id}`);
    assert.ok(gr.why_not_finer.trim().length >= 40, `why_not_finer too thin to actually justify minimal-sufficiency for ${id}`);
    assert.ok(Array.isArray(gr.harnessable_subproblems) && gr.harnessable_subproblems.length > 0, `harnessable_subproblems must be non-empty for ${id}`);
    assert.ok(Array.isArray(gr.investigation_required_subproblems) && gr.investigation_required_subproblems.length > 0, `investigation_required_subproblems must be non-empty for ${id}`);
    assert.ok(Array.isArray(gr.primitives_reused) && gr.primitives_reused.length > 0, `primitives_reused must be non-empty for ${id}`);
  });

  test(`${id}: outcome.json has all required schema keys`, () => {
    const outcome = loadCaseOutcome(id);
    for (const key of OUTCOME_REQUIRED) assert.ok(key in outcome, `outcome.json missing ${key}`);
    assert.ok(["landed", "in-progress"].includes(outcome.status), `unexpected status ${outcome.status}`);
  });

  test(`${id}: none of reference.json's leakage_markers appear anywhere in input.json`, () => {
    const reference = loadCaseReference(id);
    const inputRaw = JSON.stringify(loadCaseInput(id));
    for (const marker of reference.leakage_markers) {
      assert.ok(!inputRaw.includes(marker), `leakage marker "${marker}" found in ${id}/input.json — hindsight leak`);
    }
  });

  test(`${id}: cutoff is strictly before the real goal's activatedAt`, () => {
    const input = loadCaseInput(id);
    const goalFiles = fs.readdirSync(path.join(CORPUS_ROOT, "..", "..", "..", "goals")).filter((f) => f.startsWith(id + "-") && f.endsWith(".md"));
    assert.ok(goalFiles.length === 1, `expected exactly one goals/${id}-*.md file, found ${goalFiles.length}`);
    const goalText = fs.readFileSync(path.join(CORPUS_ROOT, "..", "..", "..", "goals", goalFiles[0]), "utf8");
    const m = goalText.match(/^activatedAt:\s*(\S+)/m);
    assert.ok(m, `could not find activatedAt in goals/${goalFiles[0]}`);
    const activatedAt = new Date(m[1]).getTime();
    const cutoff = new Date(input.cutoff).getTime();
    assert.ok(cutoff < activatedAt, `cutoff (${input.cutoff}) must be strictly before activatedAt (${m[1]}) for ${id}`);
  });

  test(`${id}: buildDefaultPrompt works even with reference.json and outcome.json removed (behavioral leakage guard)`, () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "meta-driver-replay-corpus-test-"));
    try {
      const caseTmp = path.join(tmpDir, id);
      fs.mkdirSync(caseTmp);
      fs.copyFileSync(path.join(CORPUS_ROOT, id, "input.json"), path.join(caseTmp, "input.json"));
      // deliberately do NOT copy reference.json or outcome.json
      const promptFromReal = buildDefaultPrompt(id, CORPUS_ROOT);
      const promptFromTmp = buildDefaultPrompt(id, tmpDir);
      assert.equal(promptFromTmp, promptFromReal, "prompt built without reference/outcome present must be identical to the real one");
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
}

test("scoreResponse: known-false sample (generic/irrelevant response) scores near-zero across overlap-based dimensions", () => {
  // Regression pin for a real bug caught during manual smoke-testing: the tokenizer's
  // stopword list was missing, so a generic irrelevant response like this one scored
  // concern_recall=1 purely from common English function words overlapping reference prose.
  const bad = {
    concerns: ["the weather is nice"],
    candidate_interventions: [{ title: "rewrite everything", rationale: "because" }],
    recommended: "rewrite the entire orchestration layer from scratch",
    investigation_or_goal: "investigation",
    scope: { in_scope: ["everything"], non_goals: [] },
    expected_mechanical_delta: "things will be better",
    negative_control: "",
    revision_evidence: "",
    decomposition_rationale: {
      granularity_assessment: "too-broad",
      why_not_broader: "n/a",
      why_not_finer: "n/a",
      harnessable_subproblems: [],
      investigation_required_subproblems: [],
      primitives_reused: [],
      coordination_cost_note: "",
    },
  };
  const result = scoreResponse("GOAL-030", bad);
  assert.equal(result.concern_recall, 0, "a response about 'the weather' must not recall the real concern");
  assert.equal(result.chosen_slice_agreement, "no_match");
  assert.equal(result.harnessability, "incomplete");
  assert.equal(result.primitive_reuse.mentioned_any, false);
  assert.equal(result.primitive_reuse.possible_reinvention, true, "reference names real primitives but candidate named none");
  assert.equal(result.granularity, "disagreement", "candidate said too-broad, reference says sufficient");
  assert.equal(result.investigation_vs_goal_agreement, false, "candidate said investigation, reference's ground truth is goal");
  assert.equal(result.expected_delta_quality, "no_numeric_claim");
  assert.equal(result.falsifiability_negative_control_presence, "absent_or_too_thin");
  assert.equal(result.abstention_uncertainty_reasonableness, "generic_or_missing");
  assert.equal(result.scope_expansion_violation, false, "empty non_goals list cannot overlap anything — this is a vacuous pass, not evidence scope-checking works");
});

test("scoreResponse: scope_expansion_violation fires when the candidate's own scope overlaps a real non-goal", () => {
  const reference = loadCaseReference("GOAL-030");
  const violating = {
    scope: { in_scope: [reference.scope_discipline.non_goals[0]], non_goals: [] },
  };
  const result = scoreResponse("GOAL-030", violating);
  assert.equal(result.scope_expansion_violation, true, "echoing a real non-goal back as in-scope must be caught");
});

test("scoreResponse: unnecessary_decomposition_flag fires for multiple proposed interventions with no coordination-cost reasoning", () => {
  const fragmented = {
    candidate_interventions: [
      { title: "fix A", rationale: "..." },
      { title: "fix B", rationale: "..." },
      { title: "fix C", rationale: "..." },
    ],
    decomposition_rationale: { coordination_cost_note: "", why_not_finer: "" },
  };
  const result = scoreResponse("GOAL-030", fragmented);
  assert.equal(result.decomposition_breadth.interventions_proposed, 3);
  assert.equal(result.coordination_cost_reasoning_given, false);
  assert.equal(result.unnecessary_decomposition_flag, true, "3 interventions with zero coordination-cost reasoning should flag");
});

test("scoreResponse: unnecessary_decomposition_flag does NOT fire for multiple interventions that DO carry coordination-cost reasoning", () => {
  const justified = {
    candidate_interventions: [
      { title: "fix A", rationale: "..." },
      { title: "fix B", rationale: "..." },
    ],
    decomposition_rationale: { coordination_cost_note: "these two are independently acceptable and run in parallel without shared state, so splitting them costs nothing extra" },
  };
  const result = scoreResponse("GOAL-030", justified);
  assert.equal(result.coordination_cost_reasoning_given, true);
  assert.equal(result.unnecessary_decomposition_flag, false, "multiple interventions ARE fine when justified");
});

test("scoreResponse: granularity is 'not_stated' (not silently 'agreement') when the candidate omits a self-assessment", () => {
  const result = scoreResponse("GOAL-030", { decomposition_rationale: {} });
  assert.equal(result.granularity, "not_stated", "an omitted self-assessment must not be conflated with a correct or incorrect one");
});

test("scoreResponse: slice_semantic_coherence flags a bundled/incoherent recommendation", () => {
  const bundled = {
    recommended: "sink the lifecycle writes into a kernel module; as well as rewrite the dashboard UI; and also migrate the CLI to a new argument parser",
  };
  const result = scoreResponse("GOAL-030", bundled);
  assert.match(result.slice_semantic_coherence, /possible_bundling_heuristic/, "multiple unrelated joined clauses should trip the weak coherence heuristic");
});

test("scoreResponse: known-true sample (a close paraphrase of the real reference decision) scores agreement across overlap-based dimensions", () => {
  const good = {
    concerns: ["lifecycle status writes are scattered across orchestration scripts with no structured event record"],
    candidate_interventions: [{ title: "sink status-write logic into a shared decision module with event logging", rationale: "removes the scatter and adds an audit trail" }],
    recommended: "sink lifecycle status-write logic into a shared decision layer and write a structured event per transition, as a small real goal-branch pilot",
    investigation_or_goal: "goal",
    scope: { in_scope: ["todo->ready and ready->todo writes"], non_goals: ["fan-in writes", "needs-human writes"] },
    expected_mechanical_delta: "plugin/scripts to kernel edge strength should go from 14 to 15",
    negative_control: "feed a fabricated event whose writer module lives in the main checkout and confirm it is classified as loaded-main-checkout-code",
    revision_evidence: "if the branch worktree is ever shown to load main-checkout code, abandon immediately",
    decomposition_rationale: {
      granularity_assessment: "sufficient",
      why_not_broader: "including fan-in or needs-human writes would add debugging surface area on the first real trial of the mechanism itself",
      why_not_finer: "splitting todo->ready and ready->todo into two goals would double branch-lifecycle overhead for no independent acceptance benefit",
      harnessable_subproblems: ["ArchGuard edge-count before/after", "branch merge-shape check"],
      investigation_required_subproblems: ["proving a worktree loads its own branch's code, not the main checkout's"],
      primitives_reused: ["three-state exit code convention", "ArchGuard single-root scope analysis"],
      coordination_cost_note: "keeping both writes in one goal avoids paying the branch-lifecycle fixed cost twice",
    },
  };
  const result = scoreResponse("GOAL-030", good);
  assert.equal(result.concern_recall, 1);
  assert.equal(result.chosen_slice_agreement, "near_match");
  assert.equal(result.harnessability, "harness_ready");
  assert.equal(result.granularity, "agreement");
  assert.equal(result.primitive_reuse.mentioned_any, true);
  assert.equal(result.primitive_reuse.possible_reinvention, false);
  assert.ok(result.primitive_reuse.overlap_with_reference > 0.5);
  assert.equal(result.unnecessary_decomposition_flag, false);
  assert.equal(result.investigation_vs_goal_agreement, true);
  assert.equal(result.expected_delta_quality, "has_numeric_claim");
  assert.equal(result.falsifiability_negative_control_presence, "present");
  assert.equal(result.abstention_uncertainty_reasonableness, "specific");
  assert.equal(result.scope_expansion_violation, false);
  assert.ok(result.decomposition_quality.why_not_broader_overlap > 0.5);
  assert.ok(result.decomposition_quality.why_not_finer_overlap > 0.5);
});

test("scoreResponse: hindsight_leakage_guard flags a response that happens to contain a real leakage marker", () => {
  const leaky = { recommended: "build packages/quay/src/kernel/task-transition.ts as the fix" };
  const result = scoreResponse("GOAL-030", leaky);
  assert.equal(result.hindsight_leakage_guard.flagged, true);
  assert.ok(result.hindsight_leakage_guard.matched_markers.includes("task-transition.ts"));
});

test("README.md exists and states the first-version/not-a-benchmark caveat", () => {
  const readme = fs.readFileSync(path.join(CORPUS_ROOT, "README.md"), "utf8");
  assert.match(readme, /not a validated statistical benchmark/i);
  assert.match(readme, /not to be over-fit/i);
});
