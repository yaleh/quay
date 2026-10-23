#!/usr/bin/env node
// semantic-admission-contract — THE ONE reusable contract for the two-stage admission pipeline
// (GOAL-911; acceptance surface AC-919, consumed by AC-920's unencapsulated-state pipeline).
//
// Stage 1 is MECHANICAL: a clue reader scans its input and reports one of three clue states — a
// mechanical signal fired (hand it to the semantic judge), nothing fired, or the reader could not read
// its input at all. Stage 2 is SEMANTIC: a judge reads one candidate clue and returns one of three
// verdicts.
//
// ⛔ 硬规则 3b (the reason stage 1 carries no verdict value): "I could not evaluate" must never share a
//    shape with "I evaluated and it passed". The clue layer therefore has its own three values and none
//    of the judge's, and `checkVocabulariesDisjoint` is written so that a file where the two layers
//    collapsed back into one shared list can actually go red instead of reporting "fine".
//
// ⛔ 唯一契约模块 (single contract module): a new concern kind adds a clue detector and a judge — it
//    NEVER copies these value lists. `CONCERN_KIND_REGISTRY` in ownership-active-limited-proposal.mjs
//    records WHERE a kind's detector lives; it deliberately does not restate the vocabularies.
//
// Zero runtime dependencies, pure ESM, no I/O. Every export here is a pure function of its arguments.

// ── stage 1: the clue layer ─────────────────────────────────────────────────────────────────────────
/** What a CLUE READER may report. `candidate` = a mechanical signal fired, defer to the semantic
 *  judge; `clear` = scanned, mechanical predicate did not fire; `not-evaluated` = the reader could not
 *  read its input (缺值 = 未查, 硬规则 6 — never collapsed into `clear`). */
export const CLUE_STATES = Object.freeze(["candidate", "clear", "not-evaluated"]);

/** Named constants for the clue layer, so call sites never spell the strings themselves. */
export const CLUE_STATE = Object.freeze({
  CANDIDATE: "candidate",
  CLEAR: "clear",
  NOT_EVALUATED: "not-evaluated",
});

// Internal alias so the rest of this file does not repeat the exported identifier; the public name,
// and the only one other modules should import, remains `CLUE_STATES` above.
const CLUE = CLUE_STATES;

// ── stage 2: the judge layer ────────────────────────────────────────────────────────────────────────
// The judge answers a different question than the clue reader: not "did a mechanical signal fire?" but
// "is the concern actually present, on evidence?" Its vocabulary is therefore disjoint from stage 1 by
// construction — a shared value would let a mechanical miss masquerade as a semantic acquittal, which
// is exactly the isomorphism 硬规则 3b forbids. `needs-more-evidence` is its own verdict: it is neither
// an acquittal nor a finding, so a judge that cannot yet decide has somewhere to say so.
/** What a SEMANTIC JUDGE may return for one candidate clue. */
export const JUDGE_VERDICTS = Object.freeze(["confirmed", "refuted", "needs-more-evidence"]);

/** Named constants for the judge layer. */
export const JUDGE_VERDICT = Object.freeze({
  CONFIRMED: "confirmed",
  REFUTED: "refuted",
  NEEDS_MORE_EVIDENCE: "needs-more-evidence",
});

// ── shared helpers ──────────────────────────────────────────────────────────────────────────────────
const isStr = (x, n = 1) => typeof x === "string" && x.trim().length >= n;

const legalValues = (values) => values.join(", ");

/** Raised by the record builders when a caller tries to put a value from the wrong layer into a record.
 *  Named so callers can distinguish a contract violation from an unrelated runtime failure. */
export class SemanticAdmissionContractError extends Error {
  constructor(message, { field = null, value = null } = {}) {
    super(message);
    this.name = "SemanticAdmissionContractError";
    this.field = field;
    this.value = value;
  }
}

/** Is `v` one of the clue-layer states? (A string test, never a coercion.) */
export function isClueState(v) {
  return typeof v === "string" && CLUE.includes(v);
}

/** Is `v` one of the judge-layer verdicts? */
export function isJudgeVerdict(v) {
  return typeof v === "string" && JUDGE_VERDICTS.includes(v);
}

/** Can the two vocabularies be told apart at all?
 *
 *  Returns `{ evaluated, violations, cause }` — ⛔ NEVER a bare boolean, and never `evaluated:false`
 *  shaped like a pass (硬规则 3b): an input this function cannot read reports `evaluated:false` with a
 *  non-empty `cause`, while a readable-but-overlapping pair reports `evaluated:true` with named
 *  `violations`. "Not evaluated" and "evaluated and clean" therefore never share an output shape. */
export function checkVocabulariesDisjoint(clue = CLUE, judge = JUDGE_VERDICTS) {
  const problems = [];
  for (const [name, list] of [["clue", clue], ["judge", judge]]) {
    if (!Array.isArray(list)) {
      problems.push(`${name} is not an array (got ${list === null ? "null" : typeof list})`);
      continue;
    }
    if (list.length === 0) problems.push(`${name} is empty`);
    for (let i = 0; i < list.length; i += 1) {
      if (!isStr(list[i])) problems.push(`${name}[${i}] is not a non-empty string`);
    }
  }
  if (problems.length > 0) {
    return { evaluated: false, violations: [], cause: `vocabulary not readable: ${problems.join("; ")}` };
  }
  const shared = clue.filter((v) => judge.includes(v));
  const violations = shared.map(
    (v) => `value ${JSON.stringify(v)} appears in both vocabularies (硬规则 3b: clue must not be isomorphic to verdict)`,
  );
  return { evaluated: true, violations, cause: null };
}

// ── stage 1 record: what a clue reader emits ────────────────────────────────────────────────────────
/** Build one clue record. Minimal schema — `kind` + `subject` identify WHAT was scanned, `state` is
 *  the clue-layer outcome, `proxy_reading` is required (and must be non-empty) when the state is
 *  `candidate` because that is the mechanical evidence a judge will read, and `evidence_ref` points
 *  at where the reading came from.
 *
 *  A caller passing a judge value (e.g. `"confirmed"`) is rejected BY NAME together with the legal
 *  clue values — the layers stay unconfusable at the write site, not only in the vocabulary check. */
export function clueRecord({ kind, subject, state, proxy_reading = null, evidence_ref = null } = {}) {
  if (!isStr(kind)) {
    throw new SemanticAdmissionContractError("clueRecord: kind must be a non-empty string", { field: "kind", value: kind ?? null });
  }
  if (!isStr(subject)) {
    throw new SemanticAdmissionContractError("clueRecord: subject must be a non-empty string", { field: "subject", value: subject ?? null });
  }
  if (!isClueState(state)) {
    throw new SemanticAdmissionContractError(
      `clueRecord: state ${JSON.stringify(state ?? null)} is not a clue state; legal values: ${legalValues(CLUE_STATES)}`,
      { field: "state", value: state ?? null },
    );
  }
  if (state === CLUE_STATE.CANDIDATE && !isStr(proxy_reading)) {
    throw new SemanticAdmissionContractError(
      "clueRecord: state \"candidate\" requires a non-empty proxy_reading (the mechanical evidence the judge will read)",
      { field: "proxy_reading", value: proxy_reading ?? null },
    );
  }
  return Object.freeze({
    kind,
    subject,
    state,
    proxy_reading: isStr(proxy_reading) ? proxy_reading : null,
    evidence_ref: isStr(evidence_ref) ? evidence_ref : null,
  });
}

// ── stage 2 record: what a judge emits ──────────────────────────────────────────────────────────────
/** Build one judge record. `candidate_ref` points back at the clue record it judges, and `rationale`
 *  is the reasoning. A `confirmed` verdict additionally requires a non-empty `counterfactual` — the
 *  control that would have produced a different result if the claim were false (硬规则 4 推论四: a
 *  statement that can only explain is not a statement that was tested). `refuted` and
 *  `needs-more-evidence` do not require it. */
export function judgeRecord({ candidate_ref, verdict, rationale, counterfactual = null } = {}) {
  if (!isStr(candidate_ref)) {
    throw new SemanticAdmissionContractError("judgeRecord: candidate_ref must be a non-empty string", { field: "candidate_ref", value: candidate_ref ?? null });
  }
  if (!isJudgeVerdict(verdict)) {
    throw new SemanticAdmissionContractError(
      `judgeRecord: verdict ${JSON.stringify(verdict ?? null)} is not a judge verdict; legal values: ${legalValues(JUDGE_VERDICTS)}`,
      { field: "verdict", value: verdict ?? null },
    );
  }
  if (!isStr(rationale)) {
    throw new SemanticAdmissionContractError("judgeRecord: rationale must be a non-empty string", { field: "rationale", value: rationale ?? null });
  }
  if (verdict === JUDGE_VERDICT.CONFIRMED && !isStr(counterfactual)) {
    throw new SemanticAdmissionContractError(
      "judgeRecord: verdict \"confirmed\" requires a non-empty counterfactual (the control that would differ if the claim were false)",
      { field: "counterfactual", value: counterfactual ?? null },
    );
  }
  return Object.freeze({
    candidate_ref,
    verdict,
    rationale,
    counterfactual: isStr(counterfactual) ? counterfactual : null,
  });
}
