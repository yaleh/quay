// ownership-shadow-replay.mjs — the OFFLINE replay runner for the ownership shadow proposer.
//
// For each case in the real `plugin/fixtures/meta-driver-replay/` corpus it:
//   1. builds the case's default prompt via the EXISTING harness (`buildDefaultPrompt` — the default
//      input-only path, so an input-vs-reference leak would be caught by the harness's own tests);
//   2. derives MECHANICAL evidence from that case's `input.json` context;
//   3. runs a candidate proposer (default: the deterministic stub in ownership-shadow-proposer.mjs;
//      injectable via `--candidate <module>` so a future model-backed proposer can be scored the
//      same way) to produce the fixed envelope;
//   4. passes the envelope through the deterministic gate;
//   5. scores the accepted envelope with the EXISTING `scoreResponse` (⛔ no second evaluator — a
//      second one would drift from the harness's metric immediately);
//   6. appends the accepted envelope to the sandbox carrier (the proposer's only write surface).
//
// It then writes a per-case + aggregate results JSON. NO model call, NO work-item creation, NO
// goal activation. See docs/analysis/ownership-shadow-replay.md for the honest limits.
//
// Usage:
//   node docs/analysis/ownership-shadow-replay.mjs --out docs/analysis/ownership-shadow-replay.results.json
//   node docs/analysis/ownership-shadow-replay.mjs                 # prints JSON to stdout
//   node docs/analysis/ownership-shadow-replay.mjs --root <dir>    # sandbox carrier root (default: repo root)
//   node docs/analysis/ownership-shadow-replay.mjs --no-sandbox    # do not write the sandbox carrier
//   node docs/analysis/ownership-shadow-replay.mjs --candidate <module-path>

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  CORPUS_ROOT,
  listCaseIds,
  loadCaseInput,
  buildDefaultPrompt,
  scoreResponse,
} from "../../plugin/test/helpers/meta-driver-replay-harness.mjs";

import {
  PROPOSER_ID,
  appendSandboxRecord,
  deterministicGate,
  propose,
  usedEvidenceRefs,
} from "./ownership-shadow-proposer.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(HERE, "..", "..");

const INVESTIGATION_NOTE_RE = /not yet|has not been|unresolved|not decidable|must be investigated|not been made|not been determined/i;

/** Build the mechanical evidence for one case from its `input.json` context ALONE. The readings are
 *  keyed by a stable ref so the gate can resolve `evidence_refs` by name. */
export function evidenceFromInput(input) {
  const ctx = input.context ?? {};
  const arb = ctx.archguard_readings_before ?? {};
  const toolCall = typeof arb.tool_call === "string" ? arb.tool_call : "";
  const readings = {};

  const archguardReading = { kind: "archguard", tool_call: toolCall || null, value: arb.reading_at_cutoff ?? arb, note: arb.note ?? null };
  if (/dispersion/i.test(toolCall)) readings["archguard.dispersion"] = archguardReading;
  if (/duplicat/i.test(toolCall)) readings["archguard.duplicate"] = archguardReading;
  if (/cycles/i.test(toolCall)) readings["archguard.cycle"] = archguardReading;
  if (!toolCall) readings["archguard.package_fanin_out"] = archguardReading;

  if (Array.isArray(ctx.prior_goal_precedents) && ctx.prior_goal_precedents.length) {
    readings["goals.recent_precedents"] = { kind: "goals", value: ctx.prior_goal_precedents };
  }
  if (Array.isArray(ctx.related_landed_tasks) && ctx.related_landed_tasks.length) {
    readings["tasks.recent_landed"] = { kind: "tasks", value: ctx.related_landed_tasks };
  }
  readings["corpus.context"] = { kind: "context", value: ctx.repo_state_summary ?? "" };

  const pointers = Array.isArray(ctx.code_pointers) ? ctx.code_pointers.map(String) : [];
  const noteText = [arb.note, ...(ctx.archguard_readings_before?.note ? [ctx.archguard_readings_before.note] : [])]
    .filter((s) => typeof s === "string")
    .join(" ");
  return {
    case_id: input.case_id,
    cutoff: input.cutoff ?? null,
    readings,
    pointers,
    repo_state_summary: ctx.repo_state_summary ?? "",
    investigation_note: INVESTIGATION_NOTE_RE.test(noteText) ? noteText : null,
  };
}

/** Map the fixed proposer envelope onto the harness `response_schema` shape (the runner owns this
 *  adapter — the proposer stays in its own vocabulary). */
export function envelopeToResponse(envelope) {
  const c0 = envelope.candidate_interventions[0] ?? { title: "", rationale: "", decomposition: {} };
  const action = envelope.recommended_next_action;
  return {
    concerns: [envelope.concern.statement],
    candidate_interventions: envelope.candidate_interventions.map((c) => ({ title: c.title, rationale: c.rationale })),
    recommended: `${c0.title} — ${c0.rationale}`,
    investigation_or_goal: action === "propose-goal" ? "goal" : action === "investigate" ? "investigation" : "",
    scope: envelope.scope,
    expected_mechanical_delta: envelope.expected_mechanical_delta,
    negative_control: envelope.negative_control,
    revision_evidence: envelope.abandon_or_reconsider_condition,
    decomposition_rationale: c0.decomposition ?? {},
  };
}

function sha256(text) {
  return crypto.createHash("sha256").update(text).digest("hex");
}

function mean(xs) {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
}

/** Run the replay over a corpus and return the results object (pure of any file write). */
export function runReplay({ candidate = propose, corpusRoot = CORPUS_ROOT, onAccepted = null } = {}) {
  const cases = {};
  const acceptedKeys = [];

  for (const caseId of listCaseIds(corpusRoot)) {
    const input = loadCaseInput(caseId, corpusRoot);
    const prompt = buildDefaultPrompt(caseId, corpusRoot);
    const evidence = evidenceFromInput(input);
    const envelope = candidate(evidence, { case_id: caseId, prompt });
    const gate = deterministicGate(envelope, {
      knownEvidenceRefs: usedEvidenceRefs(evidence),
      seenConcernKeys: acceptedKeys,
    });

    if (!gate.accepted) {
      cases[caseId] = {
        case_id: caseId,
        prompt_sha256: sha256(prompt),
        proposer: { concern_class: envelope?.concern?.class ?? null, recommended_next_action: envelope?.recommended_next_action ?? null, evidence_refs: envelope?.evidence_refs ?? [] },
        gate,
      };
      continue;
    }

    acceptedKeys.push(gate.concern_key);
    if (onAccepted) onAccepted(caseId, envelope, evidence);
    const response = envelopeToResponse(envelope);
    const metrics = scoreResponse(caseId, response, corpusRoot);

    cases[caseId] = {
      ...metrics,
      prompt_sha256: sha256(prompt),
      proposer: {
        concern_class: envelope.concern.class,
        recommended_next_action: envelope.recommended_next_action,
        evidence_refs: envelope.evidence_refs,
        candidate_intervention_count: envelope.candidate_interventions.length,
      },
      gate,
    };
  }

  const ids = Object.keys(cases);
  const accepted = ids.filter((id) => cases[id].gate.accepted);
  const gateCodeCounts = {};
  for (const id of ids) gateCodeCounts[cases[id].gate.code] = (gateCodeCounts[cases[id].gate.code] || 0) + 1;

  const summary = {
    cases_total: ids.length,
    cases_accepted: accepted.length,
    cases_rejected: ids.length - accepted.length,
    gate_code_counts: gateCodeCounts,
    concern_recall_mean: mean(accepted.map((id) => cases[id].concern_recall)),
    concern_precision_mean: mean(accepted.map((id) => cases[id].concern_precision)),
    investigation_vs_goal_agreement_count: accepted.filter((id) => cases[id].investigation_vs_goal_agreement === true).length,
    chosen_slice_near_match_count: accepted.filter((id) => cases[id].chosen_slice_agreement === "near_match").length,
    scope_expansion_violation_count: accepted.filter((id) => cases[id].scope_expansion_violation === true).length,
    harnessability_ready_count: accepted.filter((id) => cases[id].harnessability === "harness_ready").length,
    negative_control_present_count: accepted.filter((id) => cases[id].falsifiability_negative_control_presence === "present").length,
    expected_delta_numeric_count: accepted.filter((id) => cases[id].expected_delta_quality === "has_numeric_claim").length,
    granularity_agreement_count: accepted.filter((id) => cases[id].granularity === "agreement").length,
    abstention_specific_count: accepted.filter((id) => cases[id].abstention_uncertainty_reasonableness === "specific").length,
    hindsight_leakage_flagged_count: accepted.filter((id) => cases[id].hindsight_leakage_guard?.flagged === true).length,
  };

  return {
    proposer_id: PROPOSER_ID,
    corpus_root: path.relative(REPO_ROOT, corpusRoot) || corpusRoot,
    scoring: "plugin/test/helpers/meta-driver-replay-harness.mjs#scoreResponse",
    note: "Offline replay of a DETERMINISTIC stub proposer over a 4-case, single-domain corpus. These numbers read the corpus, not a calibrated judgment — see docs/analysis/ownership-shadow-replay.md.",
    cases,
    summary,
  };
}

// ── CLI ──────────────────────────────────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--out") out.out = argv[++i];
    else if (a === "--root") out.root = argv[++i];
    else if (a === "--candidate") out.candidate = argv[++i];
    else if (a === "--no-sandbox") out.noSandbox = true;
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const root = args.root ? path.resolve(args.root) : REPO_ROOT;

  let candidate = propose;
  if (args.candidate) {
    const mod = await import(pathToFileURL(path.resolve(args.candidate)).href);
    if (typeof mod.propose !== "function") {
      console.error(`--candidate ${args.candidate} does not export propose()`);
      process.exit(2);
    }
    candidate = mod.propose;
  }

  const onAccepted = args.noSandbox ? null : (caseId, envelope) => {
    appendSandboxRecord(root, { case_id: caseId, proposer_id: envelope.proposer_id, concern: envelope.concern, recommended_next_action: envelope.recommended_next_action, evidence_refs: envelope.evidence_refs });
  };

  const results = runReplay({ candidate, onAccepted });
  const json = `${JSON.stringify(results, null, 2)}\n`;

  if (args.out) {
    fs.mkdirSync(path.dirname(path.resolve(args.out)), { recursive: true });
    fs.writeFileSync(path.resolve(args.out), json, "utf8");
    console.error(`ownership-shadow-replay: wrote ${args.out} (${Object.keys(results.cases).length} cases)`);
  } else {
    process.stdout.write(json);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((e) => {
    console.error(e?.stack ?? String(e));
    process.exit(1);
  });
}
