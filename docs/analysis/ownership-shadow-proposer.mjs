// ownership-shadow-proposer.mjs — the ownership-scoped SHADOW proposer: a single entry
// `propose(evidence) -> envelope`, plus `deterministicGate(envelope, opts)` — a PURE function that
// accepts or rejects an envelope. Nothing here calls a model: the proposer is deterministic and the
// gate is arithmetic over the envelope plus the supplied evidence universe.
//
// WHAT THIS IS SCOPED TO (the "owned concern" boundary, deliberately NOT a product planner): only
// ownership / canonicalization / dependency-boundary / small-slice architecture opportunities. An
// envelope whose concern class is outside that set is rejected by the gate as out of bounds.
//
// THE SANDBOX BOUNDARY (structural, not a discipline promise): this module's ONLY write surface is
// the sandbox carrier `appendSandboxRecord()` — a JSONL file under `.quay/`. It does not open work
// items, does not activate a goal branch, and does not write lifecycle status; the paired test
// (plugin/test/ownership-shadow-proposer.test.mjs) pins that by reading this file's source and by
// asserting its import graph reaches nothing but `node:` builtins. See
// docs/analysis/ownership-shadow-replay.md for the honest limits of the 4-case replay.
//
// Pure functions are exported and unit-tested; the replay runner
// (docs/analysis/ownership-shadow-replay.mjs) is the only in-repo consumer.

import fs from "node:fs";
import path from "node:path";

export const PROPOSER_ID = "ownership-shadow-proposer/v1";

/** The only carrier this module may write. Relative to the workspace root passed to
 *  `appendSandboxRecord()`; the caller (replay runner) resolves the root. */
export const SANDBOX_CARRIER_BASENAME = "ownership-shadow-proposals.jsonl";
export const SANDBOX_DIR = ".quay";

/** The three actions a proposal is ALLOWED to recommend. Anything else (including a write verb such
 *  as create-task / activate-goal / write-status) is a forbidden action, rejected by the gate. */
export const RECOMMENDED_ACTIONS = ["abstain", "investigate", "propose-goal"];

/** The allowed concern classes — the ownership/canonicalization/dependency-boundary/small-slice
 *  domain. An envelope naming a class outside this set is out of scope. */
export const OWNERSHIP_CONCERN_CLASSES = [
  "canonicalization",
  "duplication",
  "dependency-boundary",
  "ownership-placement",
  "small-slice-architecture",
];

/** Action verbs a proposal must never carry. Kept as hyphenated tokens (they are the ABI verb
 *  spellings), scanned over the ACTIONABLE surface only — see findForbiddenAction(). */
export const FORBIDDEN_ACTION_TOKENS = ["create-task", "activate-goal", "write-status"];

export const MAX_CANDIDATE_INTERVENTIONS = 3;
export const MAX_CONCERN_KEY_STATEMENT_CHARS = 120;

/** Gate verdict codes. ⛔ One code per distinct cause — a missing field, an unresolvable evidence
 *  ref, an out-of-domain concern and a forbidden action must NOT share one output shape (硬规则 3b:
 *  读不懂 / 越界 / 越权 each get their own value, and none of them may look like ACCEPT). */
export const GATE_CODES = {
  ACCEPT: "accepted",
  SCHEMA_INCOMPLETE: "schema_incomplete",
  EVIDENCE_REF_UNRESOLVABLE: "evidence_ref_unresolvable",
  SCOPE_OUT_OF_BOUNDS: "scope_out_of_bounds",
  FORBIDDEN_ACTION: "forbidden_action",
  TOO_MANY_INTERVENTIONS: "too_many_interventions",
  DUPLICATE_CONCERN: "duplicate_concern",
  NOT_EVALUATED: "not-evaluated",
};

const ENVELOPE_FIELDS = [
  "proposer_id",
  "concern",
  "evidence_refs",
  "candidate_interventions",
  "recommended_next_action",
  "scope",
  "expected_mechanical_delta",
  "negative_control",
  "abandon_or_reconsider_condition",
  "confidence",
];

// ── evidence → concern class ─────────────────────────────────────────────────────────────────────
// A deterministic priority ladder over MECHANICALLY-EXTRACTED features. The ladder order is the
// claim about which reading the historical decision acted on; it is a stub classifier, NOT a model
// — the replay .md states plainly that recall on 4 single-domain cases measures the readings, not
// this classifier's judgment.

/** Feature extraction: which ArchGuard-class reading is present, plus whether the context's code
 *  pointers point at a lifecycle-status-write surface. Both are mechanical reads of `evidence`. */
export function extractFeatures(evidence) {
  const readings = (evidence && evidence.readings) || {};
  const pointers = (evidence && evidence.pointers) || [];
  return {
    hasDuplicateReading: Boolean(readings["archguard.duplicate"]),
    hasDispersionReading: Boolean(readings["archguard.dispersion"]),
    hasCycleReading: Boolean(readings["archguard.cycle"]),
    hasEdgeCountReading: Boolean(readings["archguard.package_fanin_out"]),
    statusWritePointers: pointers.filter((p) => /status-write|todo->ready|ready->todo/i.test(String(p))).length,
    importEdgePointers: pointers.filter((p) => /\bimport\b/i.test(String(p))).length,
  };
}

/** The concern class this evidence points at. Priority: an explicit ArchGuard reading of the
 *  concern shape first, then the context's code-pointer shape, then the generic small-slice floor. */
export function deriveConcernClass(evidence) {
  const f = extractFeatures(evidence);
  if (f.hasDuplicateReading) return "duplication";
  if (f.hasDispersionReading) return "canonicalization";
  if (f.hasCycleReading) return "dependency-boundary";
  if (f.statusWritePointers > 0) return "ownership-placement";
  if (f.hasEdgeCountReading) return "ownership-placement";
  return "small-slice-architecture";
}

/** The reading refs actually used to classify — the envelope's evidence_refs. */
export function usedEvidenceRefs(evidence) {
  const readings = (evidence && evidence.readings) || {};
  return Object.keys(readings).sort();
}

function instrumentName(evidence) {
  const readings = (evidence && evidence.readings) || {};
  for (const r of Object.values(readings)) {
    if (r && typeof r.tool_call === "string" && r.tool_call) return r.tool_call;
  }
  return "archguard reading";
}

function firstInteger(text) {
  const m = String(text == null ? "" : text).match(/\d+/);
  return m ? Number(m[0]) : null;
}

function evidenceValueText(evidence) {
  const readings = (evidence && evidence.readings) || {};
  return JSON.stringify(readings);
}

// ── the deterministic stub proposer ──────────────────────────────────────────────────────────────
// `propose(evidence, opts)` derives an envelope from mechanical evidence alone. It is injectable
// (the replay runner accepts `--candidate <module>`); this is the offline default so the runner
// needs no external model.

export function propose(evidence, opts = {}) {
  const caseId = (evidence && evidence.case_id) || (opts.case_id ?? "UNKNOWN");
  const concernClass = deriveConcernClass(evidence);
  const refs = usedEvidenceRefs(evidence);
  const instrument = instrumentName(evidence);
  const summary = String((evidence && evidence.repo_state_summary) || "").trim();
  const readingText = evidenceValueText(evidence);
  const pointerText = ((evidence && evidence.pointers) || []).join("; ");

  // The concern STATEMENT is an extract of the evidence (the mechanical summary + the reading
  // text), not an independent judgment — this stub summarizes, it does not reason. Stated plainly
  // so the replay's overlap metrics are read as "the readings point at the right place", not "the
  // proposer is smart".
  const statement = [summary, readingText].filter(Boolean).join(" ").slice(0, 600);

  const n = firstInteger(readingText);
  const before = n == null ? 1 : n;
  const after = Math.max(0, before - 1);

  const decomposition = {
    granularity_assessment: "sufficient",
    why_not_broader: `A broader slice would extend past the single ${instrument} reading that localizes this concern; the reading names one bounded unit, so widening it would bundle concerns the evidence does not cover.`,
    why_not_finer: `The minimal unit that actually clears the ${instrument} reading is the whole named unit; a smaller change would leave the reading unresolved rather than partially resolved, so there is no smaller complete slice.`,
    harnessable_subproblems: [
      `${instrument} before/after re-read (an existing instrument; the reading is re-taken unchanged)`,
      "a structural grep of the named surface (mechanical, already the established convention)",
    ],
    investigation_required_subproblems:
      (evidence && evidence.investigation_note) ? [String(evidence.investigation_note)] : [],
    primitives_reused: [
      "three-state exit-code convention (0 achieved / 1 not-achieved+CAUSE= / 3 not-evaluated)",
      `${instrument} before/after comparison (an existing instrument, reused not rebuilt)`,
    ],
    coordination_cost_note: `Proposing one slice rather than several: splitting this unit would multiply branch-lifecycle overhead for no independently-acceptance story of its own.`,
  };

  const envelope = {
    proposer_id: PROPOSER_ID,
    concern: { class: concernClass, statement },
    evidence_refs: refs,
    candidate_interventions: [
      {
        title: `${concernClass}: act on the unit localized by ${instrument}`,
        rationale: `The ${instrument} reading localizes a single ${concernClass} concern${pointerText ? ` around ${pointerText}` : ""}; acting on exactly that unit keeps the change small and independently verifiable.`,
        decomposition,
      },
    ],
    recommended_next_action: "propose-goal",
    scope: {
      in_scope: pointerText ? pointerText.split("; ").filter(Boolean) : [instrument],
      non_goals: [
        "do not act outside the single reading this proposal is derived from",
        "do not open new work items or activate any branch at this stage",
        "do not bundle unrelated slices into this proposal",
      ],
    },
    expected_mechanical_delta: `Re-read ${instrument}: the flagged-item count goes ${before} -> ${after} within the named unit, and nowhere else (a numeric before/after).`,
    negative_control: `Re-run ${instrument} over an untouched sibling scope and confirm its count is unchanged there; if any other scope's count moves, the "only this unit changed" claim is falsified.`,
    abandon_or_reconsider_condition: `Abandon if a re-read shows the ${instrument} count unchanged, or if finishing the slice requires touching a file outside the derived in-scope set (the scope grew, so the premise was wrong).`,
    confidence: {
      level: refs.length >= 1 ? "medium" : "low",
      basis: `Derived deterministically from ${refs.length} mechanical reading(s) at case ${caseId}; single-domain corpus, so this is a stub reading, not a calibrated judgment.`,
    },
  };
  return envelope;
}

// ── the deterministic gate (pure) ────────────────────────────────────────────────────────────────

function isPlainObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

/** Which required fields are missing or ill-typed. Returns [] when the SHAPE is complete; enum
 *  membership of `recommended_next_action` is deliberately NOT judged here (that is the forbidden-
 *  action arm) so "wrong value" never shares an output with "missing field". */
export function missingEnvelopeFields(envelope) {
  const bad = [];
  if (!isPlainObject(envelope)) return ["<envelope is not an object>"];
  for (const f of ENVELOPE_FIELDS) if (!(f in envelope)) bad.push(f);
  if (bad.length) return bad;
  if (typeof envelope.proposer_id !== "string" || !envelope.proposer_id) bad.push("proposer_id");
  if (!isPlainObject(envelope.concern) || typeof envelope.concern.class !== "string" || typeof envelope.concern.statement !== "string") bad.push("concern");
  if (!Array.isArray(envelope.evidence_refs) || envelope.evidence_refs.some((r) => typeof r !== "string")) bad.push("evidence_refs");
  if (!Array.isArray(envelope.candidate_interventions)) bad.push("candidate_interventions");
  if (typeof envelope.recommended_next_action !== "string") bad.push("recommended_next_action");
  if (!isPlainObject(envelope.scope) || !Array.isArray(envelope.scope.in_scope) || !Array.isArray(envelope.scope.non_goals)) bad.push("scope");
  if (typeof envelope.expected_mechanical_delta !== "string") bad.push("expected_mechanical_delta");
  if (typeof envelope.negative_control !== "string") bad.push("negative_control");
  if (typeof envelope.abandon_or_reconsider_condition !== "string") bad.push("abandon_or_reconsider_condition");
  if (!isPlainObject(envelope.confidence) || typeof envelope.confidence.level !== "string" || typeof envelope.confidence.basis !== "string") bad.push("confidence");
  return bad;
}

/** The ACTIONABLE surface: the fields that say what the proposal would DO. `scope.non_goals` is the
 *  explicitly-not-doing surface and is deliberately excluded — a non-goal that names a forbidden
 *  verb is naming it to forbid it. */
export function actionSurface(envelope) {
  const parts = [];
  if (envelope && isPlainObject(envelope.concern)) parts.push(String(envelope.concern.class), String(envelope.concern.statement));
  parts.push(String(envelope && envelope.recommended_next_action));
  for (const c of (envelope && envelope.candidate_interventions) || []) {
    parts.push(String(c && c.title), String(c && c.rationale));
  }
  if (envelope && isPlainObject(envelope.scope)) parts.push(...(envelope.scope.in_scope || []).map(String));
  return parts.join(" \n ");
}

/** The first forbidden hit on the action surface, or null. Two arms, both reported as the SAME
 *  code FORBIDDEN_ACTION with a distinguishing detail (⛔ not two codes for one cause — but the
 *  detail string must say which arm fired). */
export function findForbiddenAction(envelope) {
  const action = envelope && envelope.recommended_next_action;
  if (typeof action === "string" && !RECOMMENDED_ACTIONS.includes(action)) {
    return `recommended_next_action="${action}" is outside the allowed set {${RECOMMENDED_ACTIONS.join(", ")}}`;
  }
  const surface = actionSurface(envelope).toLowerCase();
  for (const tok of FORBIDDEN_ACTION_TOKENS) if (surface.includes(tok)) return `action surface carries the forbidden verb "${tok}"`;
  return null;
}

/** The dedup key, same SHAPE as routine-file-gate's concern key: a normalized, class-qualified
 *  scalar. Two envelopes whose class + normalized statement prefix agree are one proposal. */
export function normalizeConcernKey(concern) {
  const cls = String((concern && concern.class) || "").toLowerCase();
  const stmt = String((concern && concern.statement) || "")
    .toLowerCase()
    .replace(/[^a-z0-9一-鿿]+/g, " ")
    .trim()
    .slice(0, MAX_CONCERN_KEY_STATEMENT_CHARS);
  return `ownership:${cls}:${stmt}`;
}

/**
 * The pure, deterministic gate. `opts`:
 *   - knownEvidenceRefs: string[] | undefined — the evidence universe the refs are resolved against.
 *     ⛔ undefined ⇒ NOT_EVALUATED (an unjudgeable ref set must not be silently ACCEPTed — 硬规则 3b).
 *   - seenConcernKeys: string[] — keys already proposed this round (dedup). Defaults to [] — "no
 *     prior keys" is a real state, not an unknown one.
 * Returns { accepted, code, reason, concern_key }.
 */
export function deterministicGate(envelope, opts = {}) {
  const reject = (code, reason) => ({ accepted: false, code, reason, concern_key: null });

  const missing = missingEnvelopeFields(envelope);
  if (missing.length) return reject(GATE_CODES.SCHEMA_INCOMPLETE, `missing or ill-typed field(s): ${missing.join(", ")}`);

  const forbidden = findForbiddenAction(envelope);
  if (forbidden) return reject(GATE_CODES.FORBIDDEN_ACTION, forbidden);

  if (!OWNERSHIP_CONCERN_CLASSES.includes(envelope.concern.class)) {
    return reject(
      GATE_CODES.SCOPE_OUT_OF_BOUNDS,
      `concern.class "${envelope.concern.class}" is not an ownership-domain class (allowed: ${OWNERSHIP_CONCERN_CLASSES.join(", ")})`
    );
  }

  // ⛔ The evidence universe has NO sensible default — without it, ref resolvability is not a
  // judgment this gate can make. That is NOT-EVALUATED, and it must not look like ACCEPT.
  if (!Array.isArray(opts.knownEvidenceRefs)) {
    return reject(GATE_CODES.NOT_EVALUATED, "no evidence universe supplied (opts.knownEvidenceRefs) — evidence_refs cannot be judged");
  }
  const known = new Set(opts.knownEvidenceRefs);
  const unresolvable = envelope.evidence_refs.filter((r) => !known.has(r));
  if (unresolvable.length) {
    return reject(
      GATE_CODES.EVIDENCE_REF_UNRESOLVABLE,
      `evidence_ref(s) not present in the supplied evidence universe: ${unresolvable.join(", ")}`
    );
  }

  if (envelope.candidate_interventions.length > MAX_CANDIDATE_INTERVENTIONS) {
    return reject(
      GATE_CODES.TOO_MANY_INTERVENTIONS,
      `${envelope.candidate_interventions.length} candidate interventions exceeds the per-round cap of ${MAX_CANDIDATE_INTERVENTIONS}`
    );
  }
  if (envelope.candidate_interventions.length === 0) {
    return reject(GATE_CODES.SCHEMA_INCOMPLETE, "candidate_interventions is empty — an envelope must carry at least one");
  }

  const key = normalizeConcernKey(envelope.concern);
  const seen = Array.isArray(opts.seenConcernKeys) ? opts.seenConcernKeys : [];
  if (seen.includes(key)) {
    return reject(GATE_CODES.DUPLICATE_CONCERN, `concern key already proposed this round: ${key}`);
  }

  return { accepted: true, code: GATE_CODES.ACCEPT, reason: "all deterministic checks passed", concern_key: key };
}

// ── the sandbox carrier (the ONLY write surface of this module) ──────────────────────────────────

/** Append one accepted proposal to the sandbox carrier `<root>/.quay/<basename>`. This is the only
 *  place this module touches the filesystem for writing. */
export function appendSandboxRecord(root, record) {
  const dir = path.join(root, SANDBOX_DIR);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, SANDBOX_CARRIER_BASENAME);
  fs.appendFileSync(file, `${JSON.stringify(record)}\n`, "utf8");
  return file;
}
