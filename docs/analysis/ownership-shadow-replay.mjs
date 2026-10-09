#!/usr/bin/env node
// Offline replay runner for the ownership/architecture shadow proposer.
// Implements tasks/gap-ownership-shadow-proposer-contract-and-replay.md.
//
// Feeds each GOAL-0{30,31,32,33} case the SAME default prompt a candidate would get (input.json
// only — never reference/outcome; that invariant is pinned by the corpus test suite), derives an
// envelope from the case's own MECHANICAL readings with a deterministic baseline proposer (no LLM
// — so this runner always runs, with no external-model dependency), pushes it through the
// deterministic gate, and scores it with the EXISTING corpus evaluator (scoreResponse) rather
// than a second, drifting implementation.
//
// ⛔ Writes only to the sandbox carrier (.quay/ownership-shadow-proposals.jsonl, gitignored) and
// the --out results path. Never creates a task/goal, never writes a status.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  emptyEnvelope,
  deterministicGate,
  normalizeConcernKey,
  OWNED_CONCERN_KEYWORDS,
} from "./ownership-shadow-proposer.mjs";
import {
  listCaseIds,
  loadCaseInput,
  loadCaseReference,
  buildDefaultPrompt,
  scoreResponse,
} from "../../plugin/test/helpers/meta-driver-replay-harness.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "..", "..");
const SANDBOX_CARRIER = path.join(REPO_ROOT, ".quay", "ownership-shadow-proposals.jsonl");

/** Every evidence id the proposer is allowed to cite this round, derived from the case's own
 *  mechanical readings. A ref outside this set is UNRESOLVABLE and the gate must reject it. */
export function buildEvidenceIndex(input) {
  const idx = new Map();
  const ctx = input.context || {};
  const ag = ctx.archguard_readings_before || {};
  for (const [k, v] of Object.entries(ag)) {
    idx.set(`archguard:${k}`, v);
  }
  (ctx.code_pointers || []).forEach((p, i) => idx.set(`code:pointer:${i}`, p));
  (ctx.related_landed_tasks || []).forEach((t, i) => idx.set(`task:${i}`, t));
  (ctx.prior_goal_precedents || []).forEach((g, i) => idx.set(`goal:precedent:${i}`, g));
  if (ctx.repo_state_summary) idx.set("repo:state", ctx.repo_state_summary);
  return idx;
}

/** Deterministic baseline proposer (no LLM). Reads ONLY the mechanical readings and emits an
 *  envelope. Deliberately simple: its job in THIS experiment is to prove the pipeline + gate end
 *  to end offline, and to be an honest floor a real (semantic) proposer must beat. */
export function baselinePropose(input) {
  const idx = buildEvidenceIndex(input);
  const refs = [...idx.keys()];
  const ag = input.context?.archguard_readings_before || {};
  const agText = JSON.stringify(ag).toLowerCase();
  const ev = emptyEnvelope("ownership-shadow-baseline");

  // pick the evidence ref that actually names the strongest ownership-shaped signal present
  const refText = (r) => JSON.stringify(idx.get(r) ?? "").toLowerCase();
  const dupRef = refs.find((r) => r.startsWith("archguard:") && /duplicat|dispersion|scc|cycle/.test(refText(r)));
  const cycleRef = refs.find((r) => r.startsWith("archguard:") && /cycle|scc/.test(refText(r)));
  const chosen = cycleRef || dupRef || refs.find((r) => r.startsWith("archguard:")) || refs[0];

  const signalText = JSON.stringify(ag).toLowerCase();
  const isCycle = signalText.includes("scc") || signalText.includes("cycle");
  const isDup = signalText.includes("duplicat") || signalText.includes("dispersion");

  ev.evidence_refs = [chosen].filter(Boolean);

  if (isCycle) {
    ev.concern = "a package-level dependency cycle (SCC) indicates ownership inversion: a lower layer imports upward, so the cycle must be cut at its cheapest outermost edge";
    ev.scope.in_scope = ["cut the single cheapest root->subdir import edge", "move the shared primitive to the correct ownership layer"];
    ev.scope.non_goals = ["do not clear the whole SCC in one slice", "do not touch unrelated cycle members"];
    ev.candidate_interventions = [
      { title: "slice the cheapest root->subdir edge out of the SCC", rationale: "smallest independently-verifiable ownership move" },
      { title: "investigate which member the cut node is the sole in-edge for", rationale: "a cut can strand reachable-only-through-it members" },
    ];
    ev.recommended_next_action = "propose-goal";
    ev.expected_mechanical_delta = "package SCC size decreases by at least one member, with the other members unchanged";
    ev.negative_control = "re-inject one edge with a REAL (used) import and confirm the cut member returns to the SCC";
    ev.abandon_or_reconsider_condition = "abandon if the fix requires creating a new edge between two other packages, or if another member leaves the SCC unexpectedly";
  } else if (isDup) {
    ev.concern = "duplicate or dispersed implementations of one concept indicate an ownership problem: the concept has no canonical home, so consumers each carry a copy";
    ev.scope.in_scope = ["sink the shared implementation to one canonical owner", "migrate the real consumers, not look-alikes"];
    ev.scope.non_goals = ["do not merge merely-similar implementations without checking equivalence first", "do not touch unrelated dispersed definitions"];
    ev.candidate_interventions = [
      { title: "investigate equivalence before merging", rationale: "structural similarity is not semantic equivalence" },
      // ⛔ wording deliberately avoids the reference decision's own vocabulary ("thin wrapper"):
      //    reusing it would trip the corpus's hindsight-leakage guard and inflate the score by
      //    parroting the answer rather than proposing from the reading.
      { title: "give the shared logic one canonical owner and let the rest delegate to it", rationale: "keeps callers unchanged" },
    ];
    ev.recommended_next_action = "investigate";
    ev.expected_mechanical_delta = "the duplicate-detection group disappears and the canonical definition count drops to 1";
    ev.negative_control = "verify BOTH call chains actually changed what they call, not that the file merely moved";
    ev.abandon_or_reconsider_condition = "abandon if the two implementations turn out to be intentionally-divergent rather than equivalent";
  } else {
    ev.concern = "a scattered vocabulary literal indicates a missing canonical definition for the status/kind domain";
    ev.scope.in_scope = ["converge genuine consumers onto the existing canonical module"];
    ev.scope.non_goals = ["do not touch same-line unrelated literals", "do not create a second canonical declaration"];
    ev.candidate_interventions = [{ title: "converge the genuine un-migrated consumers", rationale: "reuse the existing canonical source rather than minting a new one" }];
    ev.recommended_next_action = "propose-goal";
    ev.expected_mechanical_delta = "literal dispersion count drops by the number of genuine un-migrated consumers";
    ev.negative_control = "re-run the dispersion query and confirm the remaining hits are each individually justified as non-defects";
    ev.abandon_or_reconsider_condition = "abandon if the original numeric target turns out to be unreachable and would require widening scope";
  }

  ev.confidence = { level: "medium", basis: "derived deterministically from the case's own archguard readings; no semantic judgement applied" };
  return ev;
}

function parseArgs(argv) {
  const out = { quiet: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--out") out.out = argv[++i];
    else if (argv[i] === "--sandbox") out.sandbox = argv[++i];
    else if (argv[i] === "--quiet") out.quiet = true;
  }
  return out;
}

export function runReplay({ sandboxCarrier } = {}) {
  const cases = {};
  const summary = { total: 0, gate_accepted: 0, gate_rejected: 0, by_action: {} };

  for (const caseId of listCaseIds()) {
    // Dedup is PER-ROUND. Each corpus case is an independent decision point at a different
    // historical time, so it must NOT dedup against the other cases — carrying the set across
    // cases would make a later case rejected merely for resembling an earlier, unrelated one.
    const existingConcernKeys = new Set();
    const input = loadCaseInput(caseId);           // input.json ONLY — the leakage invariant
    const prompt = buildDefaultPrompt(caseId);     // proves the candidate path needs no reference
    const evidenceIndex = buildEvidenceIndex(input);
    const envelope = baselinePropose(input);
    const gate = deterministicGate(envelope, {
      evidenceRefs: new Set(evidenceIndex.keys()),
      existingConcernKeys,
    });
    if (gate.ok) existingConcernKeys.add(gate.concern_key);

    const scores = scoreResponse(caseId, {
      concerns: [envelope.concern],
      candidate_interventions: envelope.candidate_interventions,
      recommended: envelope.candidate_interventions.map((c) => `${c.title} ${c.rationale}`).join("; "),
      investigation_or_goal: envelope.recommended_next_action === "investigate" ? "investigation" : envelope.recommended_next_action === "propose-goal" ? "goal" : "investigation",
      scope: envelope.scope,
      expected_mechanical_delta: envelope.expected_mechanical_delta,
      negative_control: envelope.negative_control,
      revision_evidence: envelope.abandon_or_reconsider_condition,
      decomposition_rationale: {
        granularity_assessment: "sufficient",
        why_not_broader: "scope limited to the single ownership edge/concept named by the cited mechanical reading",
        why_not_finer: "the cited reading resolves as one unit; splitting it would not yield independent acceptance",
        harnessable_subproblems: ["archguard before/after metric comparison (existing instrument)"],
        investigation_required_subproblems: ["equivalence/victim-set judgement not decidable from the raw reading alone"],
        primitives_reused: ["archguard before/after + negative control pattern"],
        coordination_cost_note: "kept as one slice to avoid paying the branch-lifecycle fixed cost twice",
      },
    });

    cases[caseId] = {
      prompt_chars: prompt.length,
      evidence_refs_available: [...evidenceIndex.keys()],
      envelope,
      gate: { ok: gate.ok, reasons: gate.reasons },
      scores,
    };
    summary.total++;
    if (gate.ok) summary.gate_accepted++; else summary.gate_rejected++;
    summary.by_action[envelope.recommended_next_action] =
      (summary.by_action[envelope.recommended_next_action] || 0) + 1;
  }

  const result = {
    proposer_id: "ownership-shadow-baseline",
    note: "Deterministic baseline proposer (NO LLM). Its role is to prove the pipeline + gate run end-to-end offline and to set an honest floor a semantic proposer must beat — it is NOT evidence that a semantic proposer works.",
    generated_at_note: "no timestamp recorded on purpose: the output must be byte-reproducible",
    cases,
    summary,
  };

  if (sandboxCarrier) {
    fs.mkdirSync(path.dirname(sandboxCarrier), { recursive: true });
    for (const [caseId, c] of Object.entries(cases)) {
      fs.appendFileSync(
        sandboxCarrier,
        JSON.stringify({ case: caseId, gate_ok: c.gate.ok, action: c.envelope.recommended_next_action, concern_key: normalizeConcernKey(c.envelope.concern) }) + "\n",
        "utf8"
      );
    }
  }
  return result;
}

// ⛔ CLI body guarded by the direct-entry check: WITHOUT this, merely IMPORTING this module (e.g.
// from ownership-shadow-live.mjs, which reuses runReplay's proposer) re-ran the whole replay,
// rewrote results.json, and printed into the importer's stdout — caught when the live runner first
// imported it. `runReplay` above stays exported and side-effect-free for reuse.
const IS_DIRECT_ENTRY = import.meta.url === `file://${process.argv[1]}`;
if (IS_DIRECT_ENTRY) {
  const args = parseArgs(process.argv.slice(2));
  const result = runReplay({ sandboxCarrier: args.sandbox === undefined ? SANDBOX_CARRIER : args.sandbox || null });
  const out = args.out || path.join(HERE, "ownership-shadow-replay.results.json");
  fs.writeFileSync(out, JSON.stringify(result, null, 2) + "\n", "utf8");
  if (!args.quiet) {
    console.error(`cases=${summaryLine(result)} -> ${out}`);
    for (const [id, c] of Object.entries(result.cases)) {
      console.error(`  ${id}: gate=${c.gate.ok ? "accept" : "REJECT:" + c.gate.reasons.join("|")} action=${c.envelope.recommended_next_action} slice=${c.scores.chosen_slice_agreement} gran=${c.scores.granularity} harness=${c.scores.harnessability}`);
    }
  }
}
function summaryLine(r) {
  return Object.keys(r.cases).length;
}
