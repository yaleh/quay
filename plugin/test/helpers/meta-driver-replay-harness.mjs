// Harness for plugin/fixtures/meta-driver-replay/ — see its README.md and
// tasks/gap-meta-driver-offline-replay-corpus-goal030-033.md. Test-only helper module, not a
// shipped plugin/scripts/*.ts driver capability (same scoping choice already used for the
// self-health backtest / liveness-check tasks). Importable (consumed by
// plugin/test/meta-driver-replay-corpus.test.mjs) AND runnable directly as a CLI.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const CORPUS_ROOT = path.join(HERE, "..", "..", "fixtures", "meta-driver-replay");

export function listCaseIds(corpusRoot = CORPUS_ROOT) {
  return fs
    .readdirSync(corpusRoot, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();
}

/** Reads ONLY input.json. Structurally cannot touch reference.json/outcome.json — there is no
 *  code path in this function that constructs either of those filenames. */
export function loadCaseInput(caseId, corpusRoot = CORPUS_ROOT) {
  const p = path.join(corpusRoot, caseId, "input.json");
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

/** Explicit, separate, opt-in — never called by buildDefaultPrompt. */
export function loadCaseReference(caseId, corpusRoot = CORPUS_ROOT) {
  const p = path.join(corpusRoot, caseId, "reference.json");
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

/** Explicit, separate, opt-in — never called by buildDefaultPrompt. */
export function loadCaseOutcome(caseId, corpusRoot = CORPUS_ROOT) {
  const p = path.join(corpusRoot, caseId, "outcome.json");
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

/** Built from loadCaseInput() alone. */
export function buildDefaultPrompt(caseId, corpusRoot = CORPUS_ROOT) {
  const input = loadCaseInput(caseId, corpusRoot);
  const { instructions, questions, response_schema } = input.decision_prompt_schema;
  return [
    `# Case ${input.case_id} — cutoff ${input.cutoff}`,
    "",
    instructions,
    "",
    "## Context",
    JSON.stringify(input.context, null, 2),
    "",
    "## Questions",
    ...questions.map((q) => `- ${q}`),
    "",
    "## Required response JSON schema",
    JSON.stringify(response_schema, null, 2),
  ].join("\n");
}

// Caught by a deliberate negative-control test (a nonsense response like "the weather is nice"
// was scoring non-zero overlap against real reference text before this filter existed) — common
// English function words have length > 2 and create spurious overlap on short candidate text.
const STOPWORDS = new Set([
  "the", "and", "for", "are", "but", "not", "you", "all", "can", "had", "her", "was",
  "one", "our", "out", "day", "get", "has", "him", "his", "how", "man", "new", "now",
  "old", "see", "two", "way", "who", "boy", "did", "its", "let", "put", "say", "she",
  "too", "use", "this", "that", "with", "from", "they", "have", "will", "would", "about",
  "which", "when", "there", "their", "been", "were", "what", "into", "than", "then",
]);

function tokenize(text) {
  return new Set(
    String(text || "")
      .toLowerCase()
      .replace(/[^a-z0-9一-鿿]+/g, " ")
      .split(/\s+/)
      .filter((t) => t.length > 2 && !STOPWORDS.has(t))
  );
}

function overlapScore(a, b) {
  const ta = tokenize(a);
  const tb = tokenize(b);
  if (ta.size === 0 || tb.size === 0) return 0;
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter++;
  return inter / Math.min(ta.size, tb.size); // asymmetric: "does b cover a's key terms"
}

const OVERLAP_THRESHOLD = 0.25; // rule-of-thumb, not calibrated — see README "not a validated benchmark"

/** Rule-assisted scoring against the real reference decision. Returns the 8 metrics named in
 *  the origin instruction, each a weak/approximate signal (point 5: minimal viable, not a
 *  pretend-precise aggregate score — there is deliberately NO single overall number returned). */
export function scoreResponse(caseId, response, corpusRoot = CORPUS_ROOT) {
  const reference = loadCaseReference(caseId, corpusRoot);
  const concerns = Array.isArray(response?.concerns) ? response.concerns : [];
  const concernOverlaps = concerns.map((c) => overlapScore(reference.selected_concern, c));
  const concern_recall = concernOverlaps.some((s) => s >= OVERLAP_THRESHOLD) ? 1 : 0;
  const concern_precision = concerns.length
    ? concernOverlaps.filter((s) => s >= OVERLAP_THRESHOLD).length / concerns.length
    : 0;

  const recommendedText = [response?.recommended, ...(response?.candidate_interventions || []).map((c) => `${c?.title} ${c?.rationale}`)].join(" ");
  const chosen_slice_overlap = overlapScore(reference.selected_slice, recommendedText);
  const chosen_slice_agreement = chosen_slice_overlap >= OVERLAP_THRESHOLD ? "near_match" : "no_match";

  const investigation_vs_goal_agreement = response?.investigation_or_goal === reference.investigation_or_goal_reference;

  const nonGoalTerms = (reference.scope_discipline?.non_goals || []).join(" ");
  const candidateScopeText = JSON.stringify(response?.scope || {});
  const scope_expansion_violation = overlapScore(nonGoalTerms, candidateScopeText) >= OVERLAP_THRESHOLD;

  const expected_delta_quality = /\d/.test(String(response?.expected_mechanical_delta || "")) ? "has_numeric_claim" : "no_numeric_claim";

  const negCtl = String(response?.negative_control || "");
  const falsifiability_negative_control_presence = negCtl.trim().length >= 20 ? "present" : "absent_or_too_thin";

  const leaked = (reference.leakage_markers || []).filter((m) => JSON.stringify(response || {}).includes(m));
  const hindsight_leakage_guard = leaked.length ? { flagged: true, matched_markers: leaked } : { flagged: false, matched_markers: [] };

  const revisionText = String(response?.revision_evidence || "");
  const abstention_uncertainty_reasonableness = revisionText.trim().length >= 20 ? "specific" : "generic_or_missing";

  // --- Decomposition-quality dimensions (added per the "harness spends intelligence only on
  // residual uncertainty" principle applied to THIS dataset: scoring must test whether a
  // candidate compressed an open problem into a minimal-sufficient, harness-able slice, not just
  // whether it happened to name the right final target). All of these are rule-assisted, weak
  // signals, deliberately NOT folded into a single pretend-precise score — see README.md.
  const dr = response?.decomposition_rationale || {};
  const refGr = reference.granularity_rationale || {};

  const drFieldsPresent = ["why_not_broader", "why_not_finer"].filter((k) => String(dr[k] || "").trim().length >= 20).length;
  const drArraysPresent = ["harnessable_subproblems", "investigation_required_subproblems", "primitives_reused"].filter(
    (k) => Array.isArray(dr[k]) && dr[k].length > 0
  ).length;
  const decomposition_quality = {
    structured_fields_present: `${drFieldsPresent}/2 prose fields, ${drArraysPresent}/3 array fields non-empty`,
    why_not_broader_overlap: overlapScore(refGr.why_not_broader, dr.why_not_broader),
    why_not_finer_overlap: overlapScore(refGr.why_not_finer, dr.why_not_finer),
  };

  // slice_semantic_coherence: a deliberately weak heuristic — counts how many distinct
  // "and also" / ";" / enumerated-clause joins appear in the recommended text, as a crude proxy
  // for "one coherent slice" vs. "a bundle of loosely related changes." Not a semantic check.
  const joinMarkers = (recommendedText.match(/;|\band also\b|\bas well as\b|\bin addition to\b/gi) || []).length;
  const slice_semantic_coherence = joinMarkers === 0 ? "single_coherent_slice_heuristic" : `possible_bundling_heuristic(${joinMarkers}_joins)`;

  const granularity = dr.granularity_assessment === refGr.granularity_label ? "agreement" : dr.granularity_assessment ? "disagreement" : "not_stated";

  const harnessability_components = {
    has_scope_non_goals: Array.isArray(response?.scope?.non_goals) && response.scope.non_goals.length > 0,
    has_negative_control: falsifiability_negative_control_presence === "present",
    has_numeric_expected_delta: expected_delta_quality === "has_numeric_claim",
  };
  const harnessability = Object.values(harnessability_components).every(Boolean) ? "harness_ready" : "incomplete";

  const candidatePrimitives = Array.isArray(dr.primitives_reused) ? dr.primitives_reused : [];
  const referencePrimitives = Array.isArray(refGr.primitives_reused) ? refGr.primitives_reused : [];
  const primitiveOverlaps = candidatePrimitives.map((p) => Math.max(0, ...referencePrimitives.map((rp) => overlapScore(rp, p))));
  const primitive_reuse = {
    mentioned_any: candidatePrimitives.length > 0,
    overlap_with_reference: primitiveOverlaps.length ? Math.max(...primitiveOverlaps) : 0,
  };

  // unnecessary_decomposition / coordination-cost flag: fires if the candidate proposes a narrow
  // slice (few in_scope items) but gives no coordination-cost reasoning for why it isn't split
  // further, OR explicitly over-fragments without justification. Heuristic, not a verdict.
  const coordinationNoteLen = String(dr.coordination_cost_note || "").trim().length;
  const whyNotFinerLen = String(dr.why_not_finer || "").trim().length;
  const unnecessary_decomposition_flag =
    (response?.scope?.in_scope?.length || 0) <= 1 && coordinationNoteLen < 20 && whyNotFinerLen < 20;

  return {
    case_id: caseId,
    concern_recall,
    concern_precision,
    chosen_slice_agreement,
    chosen_slice_overlap_score: chosen_slice_overlap,
    investigation_vs_goal_agreement,
    scope_expansion_violation,
    expected_delta_quality,
    falsifiability_negative_control_presence,
    decomposition_quality,
    slice_semantic_coherence,
    granularity,
    harnessability,
    harnessability_components,
    primitive_reuse,
    unnecessary_decomposition_flag,
    hindsight_leakage_guard,
    abstention_uncertainty_reasonableness,
    note: "rule-assisted, minimal-viable metrics — not a calibrated aggregate score (see README.md)",
  };
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--case") out.case = argv[++i];
    else if (a === "--response") out.response = argv[++i];
    else if (a === "--print-prompt") out.printPrompt = true;
    else if (a === "--score") out.score = true;
    else if (a === "--list") out.list = true;
  }
  return out;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.list) {
    for (const id of listCaseIds()) console.log(id);
    return;
  }
  if (!args.case) {
    console.error("usage: --list | --case <id> --print-prompt | --case <id> --response <path> --score");
    process.exit(2);
  }
  if (args.printPrompt) {
    console.log(buildDefaultPrompt(args.case));
    return;
  }
  if (args.score) {
    if (!args.response) {
      console.error("--score requires --response <path>");
      process.exit(2);
    }
    const response = JSON.parse(fs.readFileSync(args.response, "utf8"));
    console.log(JSON.stringify(scoreResponse(args.case, response), null, 2));
    return;
  }
  console.error("nothing to do: pass --print-prompt or --response <path> --score");
  process.exit(2);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
