// @test-group engine
// Tests for the ownership/architecture shadow proposer — see
// tasks/gap-ownership-shadow-proposer-contract-and-replay.md.
//
// Two things are pinned here: (1) the STRUCTURAL sandbox guarantee (the proposer module cannot
// reach the task/goal-writing machinery at all), and (2) the deterministic gate's ability to
// REJECT — each rejection cause with its own distinguishable code, so "rejected" can never be
// confused with "accepted" (CLAUDE.md hard rule 3b).

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { emptyEnvelope, deterministicGate, normalizeConcernKey } from "../../docs/analysis/ownership-shadow-proposer.mjs";
import { baselinePropose, buildEvidenceIndex, runReplay } from "../../docs/analysis/ownership-shadow-replay.mjs";
import { runLiveRound, readLiveEvidence, readCarrierHistory } from "../../docs/analysis/ownership-shadow-live.mjs";
import { loadCaseInput, listCaseIds } from "./helpers/meta-driver-replay-harness.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PROPOSER_SRC = path.join(HERE, "..", "..", "docs", "analysis", "ownership-shadow-proposer.mjs");
const REPLAY_SRC = path.join(HERE, "..", "..", "docs", "analysis", "ownership-shadow-replay.mjs");

const VALID = {
  ...emptyEnvelope("t"),
  concern: "a dispersed canonical vocabulary literal indicates an ownership problem in the status domain",
  evidence_refs: ["archguard:reading"],
  candidate_interventions: [{ title: "converge consumers onto the canonical module", rationale: "reuse, do not mint a second source" }],
  recommended_next_action: "propose-goal",
  scope: { in_scope: ["converge genuine consumers"], non_goals: ["do not touch unrelated literals"] },
  expected_mechanical_delta: "dispersion count drops by the number of genuine un-migrated consumers",
  negative_control: "re-run the dispersion query and justify every remaining hit as a non-defect",
  abandon_or_reconsider_condition: "abandon if the original numeric target is unreachable without widening scope",
  confidence: { level: "medium", basis: "mechanical reading" },
};
const REFS = new Set(["archguard:reading"]);

/** Strip comments so a symbol NAMED in prose never counts as a reference (CLAUD.md hard rule 2:
 *  按位置判定 — a mention in a comment or string is not a use). The proposer's own header comment
 *  legitimately names the forbidden symbols while explaining that it does not use them. */
function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/[^\n]*/g, "$1 ");
}

test("structural sandbox: the proposer module cannot reach the task/goal-writing machinery", () => {
  for (const p of [PROPOSER_SRC, REPLAY_SRC]) {
    const src = stripComments(fs.readFileSync(p, "utf8"));
    for (const forbidden of ["fileProposals", "driveItems", "fileDecisions", "task_write", "createTask"]) {
      assert.ok(
        !src.includes(forbidden),
        `${path.basename(p)} references ${forbidden} in CODE (not just a comment) — the shadow proposer must be structurally incapable of creating tasks/goals`
      );
    }
  }
});

test("gate ACCEPTS a well-formed, in-domain, evidence-grounded envelope (anti-vacuous: the gate is not just always-rejecting)", () => {
  const r = deterministicGate(VALID, { evidenceRefs: REFS });
  assert.equal(r.ok, true, `expected accept, got ${JSON.stringify(r.reasons)}`);
});

test("gate REJECTS a malformed envelope with a SCHEMA code (distinct from every other cause)", () => {
  const bad = { concern: "x" };
  const r = deterministicGate(bad, { evidenceRefs: REFS });
  assert.equal(r.ok, false);
  assert.ok(r.reasons.some((x) => x.startsWith("SCHEMA_MISSING:")), `expected SCHEMA_MISSING, got ${JSON.stringify(r.reasons)}`);
});

test("gate REJECTS a citation of evidence that does not exist this round (an invented reading must not pass)", () => {
  const bad = { ...VALID, evidence_refs: ["archguard:reading", "archguard:invented"] };
  const r = deterministicGate(bad, { evidenceRefs: REFS });
  assert.equal(r.ok, false);
  assert.ok(r.reasons.some((x) => x === "EVIDENCE_UNRESOLVED:archguard:invented"), `got ${JSON.stringify(r.reasons)}`);
});

test("gate REJECTS an out-of-domain concern (the proposer must not become a product planner)", () => {
  const bad = { ...VALID, concern: "we should reprioritise the product roadmap and bundle pricing for next quarter", scope: { in_scope: ["roadmap"], non_goals: [] } };
  const r = deterministicGate(bad, { evidenceRefs: REFS });
  assert.equal(r.ok, false);
  assert.ok(r.reasons.some((x) => x.startsWith("OUT_OF_DOMAIN:")), `got ${JSON.stringify(r.reasons)}`);
});

test("gate REJECTS a forbidden action (create-task / activate-goal / write-status) even when hidden inside an intervention", () => {
  const bad = { ...VALID, candidate_interventions: [{ title: "just create-task for this", rationale: "shortcut" }] };
  const r = deterministicGate(bad, { evidenceRefs: REFS });
  assert.equal(r.ok, false);
  assert.ok(r.reasons.some((x) => x.startsWith("FORBIDDEN_ACTION:")), `got ${JSON.stringify(r.reasons)}`);
});

test("gate REJECTS an action outside the declared vocabulary", () => {
  const bad = { ...VALID, recommended_next_action: "do-it-now" };
  const r = deterministicGate(bad, { evidenceRefs: REFS });
  assert.equal(r.ok, false);
  assert.ok(r.reasons.some((x) => x.startsWith("ACTION_NOT_IN_VOCAB:")), `got ${JSON.stringify(r.reasons)}`);
});

test("gate REJECTS more than 3 interventions, and a duplicate concern key", () => {
  const many = { ...VALID, candidate_interventions: [{ title: "a" }, { title: "b" }, { title: "c" }, { title: "d" }] };
  assert.ok(deterministicGate(many, { evidenceRefs: REFS }).reasons.some((x) => x.startsWith("TOO_MANY_INTERVENTIONS:")));

  const dup = deterministicGate(VALID, { evidenceRefs: REFS, existingConcernKeys: [normalizeConcernKey(VALID.concern)] });
  assert.ok(dup.reasons.some((x) => x.startsWith("DUPLICATE_CONCERN:")), `got ${JSON.stringify(dup.reasons)}`);
});

test("the six rejection causes are pairwise DISTINGUISHABLE (no two collapse to the same code)", () => {
  const cases = [
    deterministicGate({ concern: "x" }, { evidenceRefs: REFS }),
    deterministicGate({ ...VALID, evidence_refs: ["nope"] }, { evidenceRefs: REFS }),
    deterministicGate({ ...VALID, concern: "quarterly roadmap and pricing strategy", scope: { in_scope: [], non_goals: [] } }, { evidenceRefs: REFS }),
    deterministicGate({ ...VALID, candidate_interventions: [{ title: "create-task" }] }, { evidenceRefs: REFS }),
    deterministicGate({ ...VALID, recommended_next_action: "whatever" }, { evidenceRefs: REFS }),
    deterministicGate({ ...VALID, candidate_interventions: [{}, {}, {}, {}] }, { evidenceRefs: REFS }),
  ];
  const firstCodes = cases.map((c) => c.reasons[0].split(":")[0]);
  assert.equal(new Set(firstCodes).size, firstCodes.length, `rejection codes collapsed: ${JSON.stringify(firstCodes)}`);
});

test("baselinePropose cites only evidence that RESOLVES for the case it was given", () => {
  for (const caseId of listCaseIds()) {
    const input = loadCaseInput(caseId);
    const idx = buildEvidenceIndex(input);
    const env = baselinePropose(input);
    assert.ok(env.evidence_refs.length > 0, `${caseId}: must cite at least one reading`);
    for (const r of env.evidence_refs) {
      assert.ok(idx.has(r), `${caseId}: cited ${r} which its own evidence index cannot resolve`);
    }
  }
});

test("runReplay: all 4 cases accepted, every case carries the full evaluator key set", () => {
  const result = runReplay({});
  assert.deepEqual(Object.keys(result.cases).sort(), ["GOAL-030", "GOAL-031", "GOAL-032", "GOAL-033"]);
  for (const [id, c] of Object.entries(result.cases)) {
    assert.equal(c.gate.ok, true, `${id} should pass the gate: ${JSON.stringify(c.gate.reasons)}`);
    for (const k of ["concern_recall", "chosen_slice_agreement", "investigation_vs_goal_agreement", "scope_expansion_violation", "granularity", "harnessability", "hindsight_leakage_guard"]) {
      assert.ok(k in c.scores, `${id}: evaluator output missing ${k}`);
    }
    assert.equal(c.scores.hindsight_leakage_guard.flagged, false, `${id}: the proposer must not emit a hindsight leakage marker`);
  }
});

test("live shadow: records to the sandbox carrier, never executes, and dedups ACROSS live rounds (not vacuously)", () => {
  const carrier = path.join(os.tmpdir(), `ownership-shadow-live-test-${process.pid}-${Date.now()}.jsonl`);
  try {
    const a = runLiveRound({ carrier });
    assert.equal(a.executed, false, "live shadow must never execute a proposal");
    assert.equal(a.is_repeat, false, "the FIRST live round cannot be a repeat (else dedup is vacuously true)");
    assert.equal(a.gate_ok, true, `first live round should pass the gate, got ${JSON.stringify(a.gate_reasons)}`);

    const b = runLiveRound({ carrier });
    assert.equal(b.is_repeat, true, "an identical second live round must be mechanically flagged as a repeat");
    assert.ok(b.gate_reasons.some((r) => r.startsWith("DUPLICATE_CONCERN:")), `got ${JSON.stringify(b.gate_reasons)}`);
    assert.equal(readCarrierHistory(carrier).length, 2);
  } finally {
    fs.rmSync(carrier, { force: true });
  }
});

test("live shadow: the gate polices the SAME evidence namespace the proposer cites from", () => {
  // Regression pin for a real bug the OFFLINE replay never hit: the live runner derived the
  // gate's evidence set from a DIFFERENT index than the proposer used, so every citation came
  // back EVIDENCE_UNRESOLVED. Both sides must agree.
  const carrier = path.join(os.tmpdir(), `ownership-shadow-ns-test-${process.pid}-${Date.now()}.jsonl`);
  try {
    const r = runLiveRound({ carrier });
    const unresolved = (r.gate_reasons || []).filter((x) => x.startsWith("EVIDENCE_UNRESOLVED:"));
    assert.deepEqual(unresolved, [], `proposer citations must resolve, got ${JSON.stringify(unresolved)}`);
  } finally {
    fs.rmSync(carrier, { force: true });
  }
});

test("importing the replay module must NOT run its CLI body (side-effect regression pin)", () => {
  const src = fs.readFileSync(path.join(HERE, "..", "..", "docs", "analysis", "ownership-shadow-replay.mjs"), "utf8");
  assert.match(src, /IS_DIRECT_ENTRY/, "the replay CLI body must be guarded by a direct-entry check");
});
