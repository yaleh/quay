#!/usr/bin/env node
// ownership/architecture shadow proposer — a NARROW, project-local proposer over mechanical
// ownership/canonicalization/dependency-boundary evidence.
// Implements tasks/gap-ownership-shadow-proposer-contract-and-replay.md.
//
// ⛔ STRUCTURAL SANDBOX GUARANTEE (asserted by plugin/test/ownership-shadow-proposer.test.mjs,
// not by discipline): this module does NOT import fileProposals / driveItems / fileDecisions and
// never creates a task/goal/AC or writes a status. Its only output is an envelope value, and the
// only thing that ever persists one is the runner writing to a gitignored sandbox carrier.
//
// Division of labour (ADR-033): the LLM (if any) may only fill the *semantic* fields of an
// envelope; everything downstream — scope policing, evidence resolution, dedup, quota, forbidden
// actions, schema — is deterministicGate(), plain JS.

// ── the owned domain: anything outside this is REJECTED by the gate, not "handled loosely" ──────
export const OWNED_CONCERN_KEYWORDS = [
  "owner", "ownership", "canonical", "canonicalization", "duplicat", "dispersion",
  "dependency", "cycle", "scc", "boundary", "layer", "kernel", "import", "fan-in", "fan-out",
  "slice", "granularity", "vocabulary", "literal",
];
export const FORBIDDEN_ACTIONS = ["create-task", "activate-goal", "write-status", "file-task", "merge"];
export const MAX_INTERVENTIONS = 3;

export const RECOMMENDED_ACTIONS = ["abstain", "investigate", "propose-goal"];

/** Canonical envelope shape (every key required; the gate fails closed on a missing one). */
export function emptyEnvelope(proposerId = "ownership-shadow") {
  return {
    proposer_id: proposerId,
    concern: "",
    evidence_refs: [],
    candidate_interventions: [],
    recommended_next_action: "abstain",
    scope: { in_scope: [], non_goals: [] },
    expected_mechanical_delta: "",
    negative_control: "",
    abandon_or_reconsider_condition: "",
    confidence: { level: "low", basis: "" },
  };
}

const ENVELOPE_KEYS = Object.keys(emptyEnvelope());

export function normalizeConcernKey(concern) {
  return String(concern || "").toLowerCase().replace(/[^a-z0-9一-鿿]+/g, " ").trim().slice(0, 200);
}

/**
 * Deterministic gate — PURE (no I/O, no clock, no LLM). Returns {ok, reasons[]}. `reasons` is
 * ALWAYS a list of DISTINCT-coded strings so four different rejection causes can never collapse
 * into one indistinguishable message (CLAUDE.md hard rule 3b).
 *
 * @param envelope  candidate value (unknown on purpose — a malformed one must be REPORTED, not
 *                  silently accepted as "no findings")
 * @param opts.evidenceRefs  the set of evidence ids actually available THIS round; a proposal
 *                  citing anything else is rejected (an invented reading must not pass)
 * @param opts.existingConcernKeys  normalized keys already proposed (dedup), optional
 */
export function deterministicGate(envelope, opts = {}) {
  const reasons = [];
  const evidenceRefs = opts.evidenceRefs instanceof Set ? opts.evidenceRefs : new Set(opts.evidenceRefs || []);
  const existingConcernKeys = new Set(opts.existingConcernKeys || []);

  if (envelope === null || typeof envelope !== "object" || Array.isArray(envelope)) {
    return { ok: false, reasons: ["MALFORMED:not-an-object"] };
  }

  // 1. schema completeness
  const missing = ENVELOPE_KEYS.filter((k) => !(k in envelope));
  if (missing.length) reasons.push(`SCHEMA_MISSING:${missing.join(",")}`);
  for (const k of ["concern", "expected_mechanical_delta", "negative_control", "abandon_or_reconsider_condition"]) {
    if (typeof envelope[k] !== "string" || envelope[k].trim().length < 10) reasons.push(`FIELD_TOO_THIN:${k}`);
  }
  if (!Array.isArray(envelope.evidence_refs) || envelope.evidence_refs.length === 0) reasons.push("EVIDENCE_REFS_EMPTY");
  if (!Array.isArray(envelope.candidate_interventions)) reasons.push("INTERVENTIONS_NOT_ARRAY");
  if (!envelope.scope || typeof envelope.scope !== "object" || !Array.isArray(envelope.scope.in_scope) || !Array.isArray(envelope.scope.non_goals)) {
    reasons.push("SCOPE_MALFORMED");
  }

  // 2. evidence refs must RESOLVE in this round's readings
  if (Array.isArray(envelope.evidence_refs)) {
    const unresolvable = envelope.evidence_refs.filter((r) => !evidenceRefs.has(r));
    if (unresolvable.length) reasons.push(`EVIDENCE_UNRESOLVED:${unresolvable.slice(0, 5).join(",")}`);
  }

  // 3. scope policing — owned domain only, never a product planner
  const concernText = `${envelope.concern || ""} ${JSON.stringify(envelope.scope || {})}`.toLowerCase();
  const onDomain = OWNED_CONCERN_KEYWORDS.some((k) => concernText.includes(k));
  if (!onDomain) reasons.push("OUT_OF_DOMAIN:concern-not-ownership-canonicalization-or-dependency-boundary");

  // 4. forbidden actions — anywhere they could hide
  const actionText = JSON.stringify({
    i: envelope.candidate_interventions || [],
    r: envelope.recommended_next_action,
  }).toLowerCase();
  const hit = FORBIDDEN_ACTIONS.filter((a) => actionText.includes(a));
  if (hit.length) reasons.push(`FORBIDDEN_ACTION:${hit.join(",")}`);
  if (!RECOMMENDED_ACTIONS.includes(envelope.recommended_next_action)) {
    reasons.push(`ACTION_NOT_IN_VOCAB:${String(envelope.recommended_next_action)}`);
  }

  // 5. per-round cap
  if (Array.isArray(envelope.candidate_interventions) && envelope.candidate_interventions.length > MAX_INTERVENTIONS) {
    reasons.push(`TOO_MANY_INTERVENTIONS:${envelope.candidate_interventions.length}>${MAX_INTERVENTIONS}`);
  }

  // 6. dedup by normalized concern key
  const key = normalizeConcernKey(envelope.concern);
  if (key && existingConcernKeys.has(key)) reasons.push(`DUPLICATE_CONCERN:${key}`);

  return { ok: reasons.length === 0, reasons, concern_key: key };
}
