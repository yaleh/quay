#!/usr/bin/env node
// ownership-active LIMITED PROPOSAL MODE — phase C of the end-to-end architecture self-bootstrap.
//
// The shadow loop (`ownership-active-loop.mjs`) is a STRUCTURAL SANDBOX: it only ever appends a carrier
// record and never creates a Goal/task (`ownership-active-loop.test.mjs` pins that red line). This module is
// the OTHER half the experiment needs and never had: ONE small call site, INDEPENDENT of the loop, that can
// turn exactly ONE *already-qualified* carrier record into exactly ONE `draft` Goal.
//
//   carrier records for one candidate  (`.quay/ownership-shadow-proposals.jsonl`)
//     -> evaluateEntryBar(records)     (PURE) four entry conditions, each with its own reason
//     -> proposeDraftGoal(rec, ids)    ONLY when eligible: one draft AC (the exit condition) + one draft GOAL
//     -> STOP. Nothing is activated, no goal branch is opened, no code is refactored.
//
// ⛔ STRUCTURAL RED LINE (the NEXT instance of the loop's own "an automatic mechanism never executes a
//    high-risk operation" rule — asserted by plugin/test/ownership-active-limited-proposal.test.mjs):
//    this module never writes a `active` status and never imports a lifecycle/promote surface. A draft Goal
//    is the ONLY legal terminal state before a human rules on it (the repo's existing draft-goal convention:
//    `origin` must cite the human's ruling). The decision "from draft to active" is the human's, always.
//
// ⛔ 硬规则 3b (I could not evaluate must NOT look like "I evaluated and it passed"): `evaluateEntryBar`
//    returns a STATUS ENUM plus a condition-specific reason; a record whose concern_kind cannot be read is
//    NOT silently treated as "not package-cycle" — it is reported as its own undetermined state.
//
// The four entry conditions are taken VERBATIM from `ownership-active-replay.md` §6 (suggested entry
// conditions a–d), not re-invented here:
//   (1) concern_kind is a REGISTERED kind whose detector is LANDED — see the dated amendment below
//       (2026-10-22) and `ownership-active-replay.md` §8. Before the amendment this was the literal
//       `=== "package-cycle"`; it is now a registry lookup, and "registered but not yet mechanized" is
//       its OWN state (`NOT_YET_MECHANIZED`), never "not in scope" (硬规则 3b);
//   (2) the delta was COMPUTED by the ArchGuard `slice-delta` primitive (not model-asserted), its negative
//       control is falsified, and `provenanceConsistency === "match"`;
//   (3) the decision memory was CONSULTED, its input was READABLE, and it says "not-known" (not a known
//       exemption / not a known-not-yet-filed item). An absent `decision_memory` field or an
//       `unreadable_input:true` reading is `MEMORY_NOT_EVALUATED` — 未查, which fails closed (硬规则 6);
//   (4) ≥ N consecutive PRODUCTION live runs on the same candidate carry a consistent computed delta,
//       and the concern must have OCCURRED at least `occurrenceThreshold` times (the registry's own
//       field — DIR-133 ruling 1). The streak and the occurrence count are DIFFERENT quantities: a
//       slice of [hit, miss, hit] has occurrences=2 but streak=1.
//
// ── AMEND 2026-10-22: admission widened from ONE constant to a concern-kind REGISTRY (DIR-133 F1) ────
// `CONCERN_KIND_IN_SCOPE` used to be the whole of condition (1), and its comment said package-cycle was
// "the only kind with a computable, falsifiable delta". That was true of the INSTRUMENTS, not of the
// concerns: `design-evolution-readings.ts` has since mechanized a second kind end to end (a detector, a
// computable delta with a declared caliber, and a repair direction that makes the signal go dark). The
// other two kinds DIR-133 names have NO detector yet, and pretending otherwise by simply widening the
// string would be "making the prose rule longer", not making the driver stronger (ADR-004).
// ⇒ three states now, never two:
//      NOT_MET              the kind is not in the registry at all (stays in shadow);
//      NOT_YET_MECHANIZED   the kind is registered with `mechanized:false` — its detector/delta/negative
//                           control are not landed, so ⛔ no proposal may leave the carrier for it, and
//                           this is reported as ITS OWN state (硬规则 3b: it must not look like NOT_MET);
//      IN_SCOPE             registered AND mechanized — only then are conditions (2)–(4) even consulted.
// The registry is the single judge; `CONCERN_KIND_IN_SCOPE` is kept only as the identity of the
// package-cycle entry (and as the structural fallback `deriveConcernKind` still needs).
//
// ── AMEND 2026-10-22 (b): C1 DISPATCHES on `admission` (GOAL-911 / AC-918) ──────────────────────────
// "Registered + mechanized" answers whether the INSTRUMENT is landed; it does not answer WHO must CONFIRM.
// `admissionRoute(entry)` resolves the registry's `admission` into `mechanical` / `semantic-judged` /
// `unreadable`, and condition (1) branches on it:
//   mechanical       → the existing (2)–(4) mechanical delta path, unchanged;
//   semantic-judged  → the mechanical delta is NEVER read (a clue is not a verdict, 硬规则 4b). An injected
//                      `opts.semanticAdmission(record, entry)` judge must return `{admit, verdict?,
//                      counterfactual?}`; a confirmation without a counterfactual is refused by name, and a
//                      missing/throwing/unreadable judge is NOT_EVALUATED (its own value);
//   unreadable       → CONDITION_1_UNDETERMINED, fail closed.
// `mechanized` and `admission` stay orthogonal: a semantic-judged kind does not become confirmable by
// accumulating mechanical signals, and this module defines NO verdict vocabulary of its own (that contract
// lives in its own module) — it consumes only the judge's `admit` boolean and `verdict` string.
//
// ── AMEND 2026-10-22 (c): the gate CONSUMES the registry's `admission` field (GOAL-911 / AC-923) ─────
// `registryAdmissionViolations` existed but had ZERO production consumers: a registry whose `admission` was
// misspelt (`"bogus"`), non-string, or absent was carried through untouched and the gate continued into the
// mechanical delta path as if the field named a route. `evaluateEntryBar` now validates the WHOLE registry
// through that same validator before condition (1) branches, and refuses with
// CONDITION_1_UNDETERMINED naming every violating kind. `invalid` (a wrong value) and `missing` (no string
// field at all) are reported separately — 硬规则 3b: deleting a field ≠ writing a wrong value. This is a
// LEGALITY check only: it changes no routing, so a lawful `admission` reaches exactly the same branch as
// before (AC-918's dispatch face stays untouched).

import fs from "node:fs";
import path from "node:path";

// ── the entry bar (all four conditions are DATA so a refusal reason is enumerable and testable) ──────
export const ENTRY_BAR_STREAK = 3;                       // N=3 (§6(c): "require ≥ N consecutive shadow runs")
export const CONCERN_KIND_IN_SCOPE = "package-cycle";    // §6(a) pre-amendment constant — now the identity of
                                                         // the package-cycle REGISTRY entry, ⛔ not the judge.
export const CONDITIONS = Object.freeze({
  KIND: "C1_concern_kind",
  DELTA: "C2_computed_delta_falsifiable_control_provenance",
  MEMORY: "C3_decision_memory",
  STREAK: "C4_run_streak",
});

/** The one line every auto-produced candidate must carry — the human approval it is waiting for. */
export const APPROVAL_REQUIRED_LINE =
  "本 Goal 为自动投研机制产出的候选，须人工审批后才能从 draft 转 active，本机制不执行该转换。";

const isObj = (x) => x !== null && typeof x === "object" && !Array.isArray(x);
const isStr = (x, n = 1) => typeof x === "string" && x.trim().length >= n;

/** The second mechanized kind's identity (`CONCERN_KIND_REGISTRY` below). Kept as constants because the
 *  reader (`deriveConcernKind`) must recognise BOTH spellings: the `concern_kind` field a caller may set,
 *  and the machine-written `dupKind` token the production findings carrier carries. */
export const DESIGN_EVOLUTION_KIND = "design-evolution-regression";
export const DESIGN_EVOLUTION_DUP_KIND = "evolution-regression";

// ── reading a carrier record (STATUS ENUM, never a boolean — 硬规则 3) ───────────────────────────────
/**
 * The concern kind of a run record.
 * A shadow-carrier record does not carry `concern_kind` as a field, so this derives it STRUCTURALLY:
 *   - `slice_delta` non-null  ⇒ package-cycle — by construction of the loop, a slice is computed ONLY for
 *     `concern_kind === "package-cycle"` (`ownership-active-loop.mjs`, the `computeSliceDelta` guard);
 *   - a PRODUCTION `.quay/routine-findings.jsonl` record whose `dupKind` is the design-evolution killer's
 *     machine-written token ⇒ design-evolution-regression (the token is emitted by
 *     `design-evolution-readings.ts::evolutionFindingRecord`, ⛔ never typed by a model);
 *   - otherwise the loop's envelope already names the kind as a machine-written token
 *     `concern_kind=<kind>` (it is emitted by `toEnvelope`, not typed by the model).
 * @returns {string|null} the kind, or null when it cannot be read (its own state — never "not package-cycle")
 */
export function deriveConcernKind(rec) {
  if (!isObj(rec)) return null;
  if (isStr(rec.concern_kind, 1)) return rec.concern_kind;
  if (isObj(rec.slice_delta)) return CONCERN_KIND_IN_SCOPE;
  // The producer's wire token (design-evolution-readings.ts `dupKind`). The suite asserts this constant
  // still equals what the producer emits — a local copy that drifts would silently stop matching.
  if (rec.dupKind === DESIGN_EVOLUTION_DUP_KIND) return DESIGN_EVOLUTION_KIND;
  const delta = rec.envelope?.expected_mechanical_delta;
  const m = typeof delta === "string" ? delta.match(/concern_kind=([a-z0-9-]+)/) : null;
  return m ? m[1] : null;
}

/**
 * The verdict when the decision memory was never consulted / could not be read. It gets its OWN value
 * (硬规则 3b: "I could not evaluate" must not be shaped like "I evaluated and nothing matched") and it is
 * NOT a member of `architecture-decision-memory.mjs`'s `DECISION_STATUS` enum on purpose: the memory's
 * `not-known` means "the matcher ran and no entry matched", while this means "the matcher's verdict never
 * reached this record at all" — the two must never collapse (硬规则 6: 缺值 = 未查, 不是「为假」).
 */
export const MEMORY_NOT_EVALUATED = "not-evaluated";

/**
 * Read the decision-memory verdict carried on a carrier record, ENUMERATING the reason it could not be read
 * (the C3 refusal reason must be able to name WHICH kind of unreadability — 硬规则 4c: the guarantee that
 * `architecture-decision-memory.mjs::isKnownExemption` makes for `unreadable_input` did not survive the call
 * boundary, because only `status` was copied across it).
 *
 * @returns {{status:string, cause:"read"|"absent"|"unreadable", detail:string|null}}
 *   `cause:"absent"`     — the record carries no `decision_memory` field at all (the memory was never consulted
 *                           for this run). This is the MAJORITY state of the production carrier (see the
 *                           report's C3 section for the dated reading) — previously read as `not-known`.
 *   `cause:"unreadable"` — the field is present but cannot be read: `unreadable_input === true` (the memory's
 *                           own "I could not read my input" flag), or no readable `status` at all.
 */
export function decisionMemoryReading(rec) {
  const dm = rec?.decision_memory;
  if (dm === undefined || dm === null) {
    return { status: MEMORY_NOT_EVALUATED, cause: "absent", detail: "the record carries no decision_memory field (the decision memory was never consulted for this run)" };
  }
  if (!isObj(dm)) {
    return { status: MEMORY_NOT_EVALUATED, cause: "unreadable", detail: `decision_memory is present but is not an object (${JSON.stringify(dm)})` };
  }
  if (dm.unreadable_input === true) {
    return { status: MEMORY_NOT_EVALUATED, cause: "unreadable", detail: "the decision memory reports unreadable_input=true — its input could not be read, so the absence of a match is UNREAD, not 'nothing matched'" };
  }
  if (!isStr(dm.status, 1)) {
    return { status: MEMORY_NOT_EVALUATED, cause: "unreadable", detail: `decision_memory carries no readable status (${JSON.stringify(dm.status ?? null)})` };
  }
  return { status: dm.status, cause: "read", detail: null };
}

/**
 * The decision-memory verdict carried on the record — the STATUS ENUM only (see `decisionMemoryReading` for
 * the enumerated cause). An absent or unreadable memory returns `MEMORY_NOT_EVALUATED`, never `not-known`.
 */
export function decisionMemoryStatus(rec) {
  return decisionMemoryReading(rec).status;
}

/**
 * What the record says about its computed delta. Every sub-reading is enumerated so the reason can name
 * the exact one that failed (硬规则 3b: "not computed" and "computed but the control did not falsify"
 * are different facts, and neither may collapse into a generic "no delta").
 */
export function deltaEvidence(rec) {
  const sd = isObj(rec?.slice_delta) ? rec.slice_delta : (isObj(rec?.computed_delta) ? rec.computed_delta : null);
  if (!sd) return { present: false, computed: false, control_falsified: false, provenance_match: false, provenance_status: null, detail: "no slice_delta on the record" };
  const computed = sd.status === "evaluated" && isObj(sd.delta);
  const control_falsified = sd.negative_control?.falsified === true;
  const provenance_status =
    sd.provenance?.provenance_consistency?.status ?? sd.provenance_consistency?.status ?? null;
  return {
    present: true,
    computed,
    control_falsified,
    provenance_match: provenance_status === "match",
    provenance_status,
    delta: computed ? sd.delta : null,
    detail: computed ? null : `slice-delta status=${String(sd.status)}${sd.reason ? ` (${sd.reason})` : ""}`,
    control_detail: `falsified=${JSON.stringify(sd.negative_control?.falsified ?? null)}`,
  };
}

// ── the design-evolution-regression delta — the SECOND registered kind (amend 2026-10-22) ───────────
// Detector (already mechanized, ⛔ not built here): `plugin/scripts/design-evolution-readings.ts`
// appends one finding record (its `kind` field) per trigger to `.quay/routine-findings.jsonl` with
// `dupKind:"evolution-regression"`, and the SAME trigger numbers ride along as `deltaCentral` /
// `deltaNonCentral` / `deltaDenominator` / `sharePercent`. This reader consumes those NUMBERS: it never
// parses prose, never trusts the producer's boolean, and never re-derives the delta from the finding's
// rationale text.
//
// CALIBER — DECLARED ONCE, HERE, because the entry must pin one and the two are measurably different:
//   **净口径 (net line delta)**: `share = centralΔ / (centralΔ + nonCentralΔ)`, computed over the
//   baseline window the reading declares. ⛔ Not "只计新增". The two calibers differ on the SAME window
//   (measured: serve 1.31% net vs 2.25% additions-only), so an entry that leaves the caliber unsaid is
//   not replayable. (The corpus-level caliber correction lives in
//   `gap-design-evolution-share-caliber-net-vs-additions`; this module only reads the caliber the record
//   declares, and the record declares NET — that is what `design-evolution-readings.ts` computes.)
//
// THE DELTA PREDICATE = the readings' OWN declared trigger boundary, RE-COMPUTED here from the raw
// numbers (硬规则 2: judge by structure, not by a label):
//     regression window  ⇔  deltaCentral > 0 ∧ deltaDenominator > 0
// The declared boundary is load-bearing: `Δdenominator <= 0` is NOT a regression even when Δcentral > 0
// (a window that only moved lines INTO the central file is not "new code landing in central"), and a
// repair — new code going to module files instead of the central file — drives Δcentral to ≤ 0, which is
// exactly the direction that must extinguish the signal.
export function designEvolutionRegression(rec) {
  const r = isObj(rec?.design_evolution) ? rec.design_evolution : rec;
  const missing = ["deltaCentral", "deltaNonCentral", "deltaDenominator"].filter((k) => !Number.isFinite(r?.[k]));
  if (missing.length) {
    const trigger = isStr(r?.trigger, 1) ? `trigger=${r.trigger}` : "no trigger";
    return {
      evaluated: false,
      hit: false,
      target: isStr(r?.target, 1) ? r.target : null,
      reason: `${trigger}: the record carries no computable window (${missing.join(", ")} not finite) — a trigger with no numbers has no delta to propose on`,
    };
  }
  return {
    evaluated: true,
    hit: r.deltaCentral > 0 && r.deltaDenominator > 0,
    target: isStr(r.target, 1) ? r.target : null,
    deltaCentral: r.deltaCentral,
    deltaNonCentral: r.deltaNonCentral,
    deltaDenominator: r.deltaDenominator,
    sharePercent: Number.isFinite(r.sharePercent) ? r.sharePercent : null,
    reason: null,
  };
}

/** The BUILT-IN control pair for the predicate above — 硬规则 4 推论二's detection half, borrowed from
 *  `design-evolution-readings.ts`'s RM2 `predicate-selfcheck-failed` shape. A predicate that cannot say NO
 *  proves nothing, so before it is allowed to judge a real record it must SEPARATE two samples of known
 *  sign: one regression window and one repair window. ⛔ Both samples are constants of the PREDICATE, not
 *  readings: this proves the instrument can tell the two directions apart, it does NOT claim any real
 *  subsystem regressed. */
export const DESIGN_EVOLUTION_PREDICATE_SAMPLES = Object.freeze({
  regression: Object.freeze({ deltaCentral: 288, deltaNonCentral: -6, deltaDenominator: 282, sharePercent: 102.13 }),
  repaired: Object.freeze({ deltaCentral: -40, deltaNonCentral: 120, deltaDenominator: 80, sharePercent: 60 }),
});

/** ⇔ the SHARE-UP trigger's predicate is falsifiable. `ok:false` is its own value (never "clean"). */
export function designEvolutionPredicateSelfCheck() {
  const up = designEvolutionRegression(DESIGN_EVOLUTION_PREDICATE_SAMPLES.regression);
  const down = designEvolutionRegression(DESIGN_EVOLUTION_PREDICATE_SAMPLES.repaired);
  const ok = up.evaluated && up.hit && down.evaluated && down.hit === false;
  return {
    ok,
    regression_hit: up.hit,
    repaired_hit: down.hit,
    reason: ok ? null : `predicate-selfcheck-failed: the built-in regression window hit=${up.hit}, the built-in repair window hit=${down.hit} — the predicate cannot separate a regression from a repair, so every verdict it renders is unread`,
  };
}

/**
 * The C2-shaped evidence for a design-evolution reading/finding record. Same four sub-readings as
 * `deltaEvidence` so `evaluateEntryBar` stays one code path, but each is read from THIS kind's numbers:
 *   present           the record carries the three window numbers (a `dark-streak` finding does not);
 *   computed          the record says the window ROSE, re-computed here (a repaired/quiet window is
 *                     `computed:false` — that is the negative control doing its job, not a producer bug);
 *   control_falsified the predicate separated the built-in regression/repair pair;
 *   provenance_match  the window's TWO ends are identified (`readingTs` + `priorReadingTs`) and the
 *                     target is named — a delta whose comparison cannot be located is not replayable.
 */
export function designEvolutionDeltaEvidence(rec) {
  const r = isObj(rec?.design_evolution) ? rec.design_evolution : rec;
  const self = designEvolutionPredicateSelfCheck();
  const empty = { present: false, computed: false, control_falsified: self.ok, provenance_match: false, provenance_status: null, delta: null, control_detail: `predicate-selfcheck=${self.ok}` };
  if (!isObj(r)) return { ...empty, detail: "no design-evolution reading record" };
  if (!["deltaCentral", "deltaNonCentral", "deltaDenominator"].some((k) => k in r)) {
    return { ...empty, detail: "no deltaCentral/deltaNonCentral/deltaDenominator on the record — it carries no design-evolution window (e.g. a dark-streak finding)" };
  }
  const pred = designEvolutionRegression(r);
  const target = isStr(r.target, 1) ? r.target : null;
  const readingTs = isStr(r.readingTs, 1) ? r.readingTs : null;
  const priorTs = isStr(r.priorReadingTs, 1) ? r.priorReadingTs : null;
  const provenance_status = target !== null && readingTs !== null && priorTs !== null ? "match" : "incomplete-window";
  const delta = pred.evaluated
    ? { target, trigger: isStr(r.trigger, 1) ? r.trigger : null, deltaCentral: pred.deltaCentral, deltaNonCentral: pred.deltaNonCentral, deltaDenominator: pred.deltaDenominator, sharePercent: pred.sharePercent }
    : null;
  const detail = !self.ok
    ? self.reason
    : !pred.evaluated
      ? pred.reason
      : !pred.hit
        ? `not-a-regression-window: Δcentral=${r.deltaCentral} Δdenominator=${r.deltaDenominator} — the share did NOT rise (a repaired or quiet window: new code went OUTSIDE the central file), so the signal is extinguished`
        : null;
  return {
    present: true,
    computed: pred.evaluated && pred.hit,
    control_falsified: self.ok,
    provenance_match: provenance_status === "match",
    provenance_status,
    delta,
    detail,
    control_detail: `predicate-selfcheck=${self.ok}`,
  };
}

/** The identity a design-evolution candidate's delta is compared on: the SUBSYSTEM, not the window's
 *  numbers. Two consecutive rounds of the same regression carry different Δ (each window differs), so a
 *  numeric fingerprint would break the streak on every round; "the same delta" here means "the same
 *  subsystem regressing on the same trigger". ⛔ Not the producer's dedup key — that key is the routine
 *  gate's business, and copying its construction rule here would be a second place to drift. */
export function designEvolutionFingerprint(rec) {
  const r = isObj(rec?.design_evolution) ? rec.design_evolution : rec;
  const target = isStr(r?.target, 1) ? r.target : null;
  if (target === null) return null;
  return deltaFingerprint({ target, trigger: isStr(r?.trigger, 1) ? r.trigger : null });
}

// ── the concern-kind REGISTRY (amend 2026-10-22) — the ONE judge for condition (1) ────────────────────
/** The four condition-(1) states. ⛔ Each is distinct: "not a registered kind" and "registered but its
 *  detector is not landed" must never share a shape (硬规则 3b). */
export const CONCERN_KIND_STATES = Object.freeze({
  IN_SCOPE: "in-scope",
  NOT_MET: "not-in-scope",
  NOT_YET_MECHANIZED: "not-yet-mechanized",
  UNDETERMINED: "undetermined",
});

/** WHO confirms a concern of this kind — the legal values of the registry's `admission` field. The two
 *  axes are pinned in the registry's own header comment below; ⛔ do not restate them here as well. */
export const CONCERN_ADMISSIONS = Object.freeze({
  MECHANICAL: "mechanical",
  SEMANTIC_JUDGED: "semantic-judged",
});

/**
 * The registry. Each entry carries the five fields the amendment pins, plus the kind's own readers:
 *   kind                 the token `deriveConcernKind` produces;
 *   admission            WHO confirms a concern of this kind (`CONCERN_ADMISSIONS`): `mechanical` = a
 *                        machine can falsifiably confirm it; `semantic-judged` = the confirmation needs a
 *                        semantic judgment, and mechanical signals may only ever produce CANDIDATES;
 *   detector             WHERE the mechanism that produces the concern lives (a path + function, never a
 *                        prose promise) — for a not-yet-mechanized kind, the task that must land it;
 *   deltaComputable      is there a COMPUTABLE delta, not a model-asserted one?
 *   negativeControl      is there a direction in which the signal must go DARK (a real falsifier)?
 *   occurrenceThreshold  how many times the concern must have OCCURRED before a proposal may leave the
 *                        carrier (DIR-133 ruling 1: 2). ⛔ Read by `evaluateEntryBar` — never a literal;
 *   mechanized           are the three above actually LANDED? false ⇒ NOT_YET_MECHANIZED, ⛔ not admission.
 *
 * ⛔ `admission` and `mechanized` are ORTHOGONAL — never merge them, never derive one from the other:
 *   `admission` answers 「确认靠谁」 (who must confirm: a falsifiable machine reading vs a semantic
 *   judgment), while `mechanized` answers 「仪器是否落地」 (has the detector / computable delta / negative
 *   control actually been built?). `package-cycle` is mechanical AND mechanized; a mechanical kind whose
 *   instrument has not landed is `mechanized:false` while staying `mechanical`; a `semantic-judged` kind
 *   never becomes mechanized by piling on mechanical signals — only by landing the judge.
 *
 * A new kind may only flip `mechanized` to true when it brings all three: a detector, a computable
 * falsifiable delta, and a negative control that is demonstrated to extinguish the signal. Widening the
 * string without them is "making the prose rule longer", not making the driver stronger (ADR-004).
 */
// ⚠️ `kind` and `admission` are written as QUOTED LITERALS here (not the constants' names) because the
// GOAL-911 / AC-918 criterion reads this SOURCE TEXT and pairs `kind: "<token>"` with the following
// `admission: "<token>"`. The constants have not lost their identity: the suite asserts every entry's
// `kind` === the matching constant and every `admission` === a `CONCERN_ADMISSIONS` member, so the literal
// spelling and the constant are pinned to each other by a test (⛔ a comment mentioning the literal is NOT
// a hit — 硬规则 2 — and must never be used to feed that criterion).
export const CONCERN_KIND_REGISTRY = Object.freeze([
  Object.freeze({
    kind: "package-cycle",
    admission: "mechanical",
    detector: "ArchGuard slice-delta (installed CLI, computed) — ownership-active-loop.mjs computeSliceDelta + .quay/ownership-shadow-proposals.jsonl",
    deltaComputable: true,
    negativeControl: true,
    negativeControlDetail: "the slice's restore_edges make the primitive report falsified=true; an unfalsifiable cut is refused at C2",
    occurrenceThreshold: 2,
    mechanized: true,
    deltaCaliber: "ArchGuard slice-delta: before/after SCC members + removed_edges",
    readDelta: deltaEvidence,
    fingerprintOf: (rec) => deltaFingerprint(rec?.slice_delta?.delta),
  }),
  Object.freeze({
    kind: "design-evolution-regression",
    admission: "mechanical",
    detector: "plugin/scripts/design-evolution-readings.ts evolutionFindings() → .quay/routine-findings.jsonl (dupKind=evolution-regression, trigger=share-up)",
    deltaComputable: true,
    negativeControl: true,
    negativeControlDetail: "built-in regression/repair sample pair (designEvolutionPredicateSelfCheck) + a repaired window (Δcentral<=0 ∨ Δdenominator<=0) makes the same predicate return hit=false",
    occurrenceThreshold: 2,
    mechanized: true,
    deltaCaliber: "net line delta: share = centralΔ/(centralΔ+nonCentralΔ) over the record's baseline window; regression window ⇔ deltaCentral>0 ∧ deltaDenominator>0",
    readDelta: designEvolutionDeltaEvidence,
    fingerprintOf: designEvolutionFingerprint,
  }),
  Object.freeze({
    kind: "spine-without-extension-point",
    admission: "semantic-judged",
    detector: "NOT LANDED — the detector is tasks/gap-worker-fan-in-cross-cutting-hooks-not-covered-by-extension-point (ready). Until its extension point registry lands there is no machine-readable signal to admit on",
    deltaComputable: false,
    negativeControl: false,
    negativeControlDetail: null,
    occurrenceThreshold: null,
    mechanized: false,
    deltaCaliber: null,
    readDelta: null,
    fingerprintOf: null,
  }),
  Object.freeze({
    kind: "god-file-size",
    admission: "semantic-judged",
    detector: "NOT LANDED — no detector exists AND the EVENT is undefined (what counts as one occurrence of 'a god file'?). A line-count threshold is 硬规则 4 推论's forbidden zone until that definition plus a historical occurrence reading exist, so this task registers the SLOT only",
    deltaComputable: false,
    negativeControl: false,
    negativeControlDetail: null,
    occurrenceThreshold: null,
    mechanized: false,
    deltaCaliber: null,
    readDelta: null,
    fingerprintOf: null,
  }),
  // LANDED 2026-10-23 (task gap-unencapsulated-state-clue-judge-e2e, GOAL-911 AC-924). The registry's
  // own rule for this slot was "a semantic-judged kind ... only by landing the judge" — and the judge is
  // now landed: the clue reader below emits candidates and the recorded-verdict judge decides them.
  // ⛔ This is NOT the mechanical shortcut the rule forbids (piling on mechanical signals); the
  // confirmation still comes only from the judge, and `admission` stays `semantic-judged`.
  // ⛔ `kind` and `admission` stay ADJACENT quoted literals: the GOAL-911 / AC-918 criterion pairs them in
  // this source text, so no comment may sit between the two lines.
  Object.freeze({
    kind: "unencapsulated-state",
    admission: "semantic-judged",
    detector: "STAGE 1 clue reader plugin/scripts/unencapsulated-state-clue.ts (CLI: --root <dir> --json; emits candidate/clear/not-evaluated only) → STAGE 2 recorded-verdict judge plugin/scripts/unencapsulated-state-judge.ts (replayVerdict / semanticAdmissionFromJudge over plugin/fixtures/unencapsulated-state/recorded-verdicts.json). Confirmation requires verdict=confirmed WITH a counterfactual; mechanical signals are candidates only",
    deltaComputable: false,
    negativeControl: true,
    negativeControlDetail: "the four vendored samples (true-state-cluster / memoized-probe / diagnostic-counter / encapsulated-registry) are the judge's falsifier: the clue reader fires on ALL FOUR, while the recorded verdicts REFUTE three of them — so a rule that reads the clue as a verdict is demonstrably wrong on 3/4 of its own inputs",
    occurrenceThreshold: null,
    mechanized: true,
    deltaCaliber: null,
    readDelta: null,
    fingerprintOf: null,
  }),
]);

/**
 * Validate the `admission` field across a registry. Returns NAMED violations, never a bare boolean — a
 * caller must be able to say WHICH kind is wrong (硬规则 3). And "I could not read the registry" gets its
 * OWN shape (`evaluated:false` + a `cause`), ⛔ never the same shape as "read it, zero violations"
 * (硬规则 3b): an instrument failure must not be disguised as a pass.
 * @returns {{evaluated:boolean, missing:string[], invalid:string[], cause:string|null}}
 *   missing — the entry carries no string `admission` at all;
 *   invalid — the entry carries one, but it is not one of `CONCERN_ADMISSIONS`' values;
 *   cause   — non-null iff `evaluated` is false (the registry itself could not be read).
 */
export function registryAdmissionViolations(registry = CONCERN_KIND_REGISTRY) {
  if (!Array.isArray(registry)) return { evaluated: false, missing: [], invalid: [], cause: "registry-is-not-an-array" };
  if (registry.length === 0) return { evaluated: false, missing: [], invalid: [], cause: "registry-is-empty" };
  const legal = Object.values(CONCERN_ADMISSIONS);
  const missing = [];
  const invalid = [];
  registry.forEach((entry, i) => {
    // An entry without a readable kind still has to be NAMED — an index token is worse than a kind but far
    // better than dropping the entry on the floor (a silent skip would read exactly like "no violation").
    const name = isStr(entry?.kind, 1) ? entry.kind : `entry[${i}]:no-kind`;
    const admission = isObj(entry) ? entry.admission : undefined;
    if (typeof admission !== "string") missing.push(name);
    else if (!legal.includes(admission)) invalid.push(name);
  });
  return { evaluated: true, missing, invalid, cause: null };
}

/** Look a kind up. Returns the entry, or null when the kind is not registered. */
export function concernKindEntry(kind, registry = CONCERN_KIND_REGISTRY) {
  if (!isStr(kind, 1) || !Array.isArray(registry)) return null;
  return registry.find((e) => e.kind === kind) ?? null;
}

/**
 * WHO confirms a registered kind — the C1 ADMISSION ROUTE. Three-valued, and the third value is its own
 * shape (硬规则 3b): "I could not read the admission field" must never be reported as either legal route,
 * because both routes are promises the module then has to keep (mechanical = the delta path is authoritative;
 * semantic-judged = mechanical signals are candidates ONLY and a semantic judge must confirm).
 *
 * @returns {{evaluated:boolean, route:"mechanical"|"semantic-judged"|"unreadable", cause:string|null}}
 *   `evaluated:false` ⇒ `route:"unreadable"` and a non-empty `cause` naming why (⛔ never a legal route).
 */
export function admissionRoute(entry) {
  if (!isObj(entry)) return { evaluated: false, route: "unreadable", cause: "entry-is-not-an-object" };
  const admission = entry.admission;
  if (typeof admission !== "string" || admission.trim() === "") {
    return { evaluated: false, route: "unreadable", cause: `entry ${isStr(entry.kind, 1) ? entry.kind : "<no-kind>"} carries no string admission field` };
  }
  const legal = Object.values(CONCERN_ADMISSIONS);
  if (!legal.includes(admission)) {
    return { evaluated: false, route: "unreadable", cause: `entry ${isStr(entry.kind, 1) ? entry.kind : "<no-kind>"} carries admission ${JSON.stringify(admission)}, which is not one of ${legal.join(" / ")}` };
  }
  return { evaluated: true, route: admission, cause: null };
}

/**
 * Resolve a kind to ONE of the four condition-(1) states, plus the entry (null unless registered).
 * `token` names WHICH kind got WHICH state (`in-scope:package-cycle`), so two kinds sharing a state are
 * still distinguishable in one reading — a bare state string would make them look identical.
 * @returns {{state:string, token:string, kind:string|null, entry:object|null}}
 */
export function concernKindState(kind, registry = CONCERN_KIND_REGISTRY) {
  const unreadable = !isStr(kind, 1);
  const entry = unreadable ? null : concernKindEntry(kind, registry);
  const state = unreadable
    ? CONCERN_KIND_STATES.UNDETERMINED
    : entry === null
      ? CONCERN_KIND_STATES.NOT_MET
      : entry.mechanized === true
        ? CONCERN_KIND_STATES.IN_SCOPE
        : CONCERN_KIND_STATES.NOT_YET_MECHANIZED;
  return { state, token: `${state}:${unreadable ? "unreadable" : kind}`, kind: unreadable ? null : kind, entry };
}

/** A production (non-replay) live run. The BLIND/benchmark replays must never enter the streak. */
export function isProductionRun(rec) {
  if (!isObj(rec)) return false;
  const label = typeof rec.label === "string" ? rec.label : "";
  const runId = typeof rec.run_id === "string" ? rec.run_id : "";
  if (label.startsWith("replay") || runId.startsWith("replay")) return false;
  if (label.startsWith("holdout") || runId.startsWith("holdout")) return false;
  return true;
}

/** A stable identity for a delta, so "the same delta across N runs" is a comparison of computed content.
 *  ⚠️ The recursion is load-bearing: `JSON.stringify(v, keysArray)` is a REPLACER ARRAY — it keeps only the
 *  named keys AT EVERY LEVEL, so nested differences (`after.scc_size`, `removed_edges[i].names`) would be
 *  silently erased and two genuinely different deltas would collide. Canonicalise depth-first instead. */
export function canonicalize(x) {
  if (Array.isArray(x)) return x.map(canonicalize);
  if (isObj(x)) return Object.fromEntries(Object.keys(x).sort().map((k) => [k, canonicalize(x[k])]));
  return x;
}
export function deltaFingerprint(delta) {
  if (!isObj(delta)) return null;
  return JSON.stringify(canonicalize(delta));
}

/**
 * C1's SEMANTIC-JUDGED route: the confirmation comes from an injected judge (`opts.semanticAdmission`), never
 * from the record's mechanical delta. The module deliberately does NOT define the judge's verdict vocabulary
 * (`confirmed` / `refuted` / `needs-more-evidence` — that single contract belongs to its own task); it only
 * consumes the `admit` boolean and the `verdict` string, so the clue pipeline and the judge pipeline can be
 * wired together by a later caller without a second vocabulary living here.
 *
 * Every refusal is NAMED and has its own value (硬规则 3b/4 推论四):
 *   missing judge / judge throws / unreadable return   CONDITION_1_SEMANTIC_NOT_EVALUATED
 *   admit:true without a counterfactual                CONDITION_1_SEMANTIC_COUNTERFACTUAL_MISSING
 *   admit:false (+ a verdict)                          CONDITION_1_SEMANTIC_REFUSED verdict=<verdict>
 *   admit:true with a counterfactual                   ELIGIBLE, matchedConditions = [C1] only
 */
function evaluateSemanticAdmission(head, entry, kind, opts, mismatch) {
  const judge = opts?.semanticAdmission;
  if (typeof judge !== "function") {
    return mismatch(`CONDITION_1_SEMANTIC_NOT_EVALUATED:concern_kind=${kind} — admission=semantic-judged but no semanticAdmission judge was injected; its mechanical signals are candidates only and can never confirm it`);
  }
  let judgment;
  try {
    judgment = judge(head, entry);
  } catch (err) {
    return mismatch(`CONDITION_1_SEMANTIC_NOT_EVALUATED:concern_kind=${kind} — the injected semanticAdmission judge threw: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (!isObj(judgment) || typeof judgment.admit !== "boolean") {
    return mismatch(`CONDITION_1_SEMANTIC_NOT_EVALUATED:concern_kind=${kind} — the injected semanticAdmission judge returned an unreadable verdict (expected an object with a boolean \`admit\`; got ${JSON.stringify(judgment)})`);
  }
  if (judgment.admit === false) {
    if (!isStr(judgment.verdict, 1)) {
      return mismatch(`CONDITION_1_SEMANTIC_NOT_EVALUATED:concern_kind=${kind} — the semanticAdmission judge refused (admit:false) without naming a verdict; a refusal must be attributable`);
    }
    return mismatch(`CONDITION_1_SEMANTIC_REFUSED:concern_kind=${kind} verdict=${judgment.verdict} — the semantic judge did not confirm this concern; its mechanical delta is a clue only`);
  }
  const counterfactual = isStr(judgment.counterfactual, 1) ? judgment.counterfactual.trim() : null;
  if (counterfactual === null) {
    return mismatch(`CONDITION_1_SEMANTIC_COUNTERFACTUAL_MISSING:concern_kind=${kind} — a semantic confirmation must carry the counterfactual that would have made the verdict different (硬规则 4 推论四: a claim that explains every outcome is not a tested conclusion)`);
  }
  return {
    eligible: true,
    reason: `ELIGIBLE:concern_kind=${kind} admission=semantic-judged; semantic confirmation verdict=${judgment.verdict ?? "confirmed"}; counterfactual=${counterfactual}`,
    matchedConditions: [CONDITIONS.KIND],
    conditions: { kind: { kind, admission: CONCERN_ADMISSIONS.SEMANTIC_JUDGED }, semantic: { admit: true, verdict: judgment.verdict ?? null, counterfactual }, delta: null, memory: null },
    // No streak was consulted on this route, and reporting one would imply a mechanical count was run.
    streak: { length: 0, required: ENTRY_BAR_STREAK, occurrences: 0, occurrence_threshold: null, delta_fingerprint: null },
  };
}

// ── the entry bar ────────────────────────────────────────────────────────────────────────────────
/**
 * Judge whether ONE candidate's carrier records clear the four-entry bar.
 * PURE: the records are passed in (a read-only slice of the carrier for a SINGLE candidate — grouping is
 * the caller's job; `groupByCandidate` below is the helper that produces that slice from the whole carrier).
 *
 * ⚠️ INPUT ORDER IS AUTHORITATIVE. The carrier is append-ordered (`appendFileSync`), so the slice's order is
 *    its chronology. This is deliberately NOT re-derived from `ts` fields: some records in this carrier carry
 *    no timestamp at all, and sorting on a missing key silently hoists them to the head (a proxy量 read
 *    through an unverified layer — 硬规则 4b). The last element IS the latest run.
 *
 * @param {Array<object>} carrierRecords  the run records for one candidate, oldest first
 * @param {{registry?:Array<object>, semanticAdmission?:(record:object, entry:object)=>{admit:boolean, verdict?:string, counterfactual?:string}}} [opts]
 *        `registry`  — the registry to judge against (defaults to `CONCERN_KIND_REGISTRY`). Injectable so a
 *        caller — and the suite — can pin a DIFFERENT `occurrenceThreshold` and see the judgment move, i.e.
 *        prove the field is read rather than declared.
 *        `semanticAdmission` — the C1 judge injected for semantic-judged kinds. Their mechanical
 *        delta is NEVER read here; without this function a semantic-judged kind is
 *        `CONDITION_1_SEMANTIC_NOT_EVALUATED` (its own value, ⛔ not eligible and ⛔ not a delta refusal).
 * @returns {{eligible:boolean, reason:string, matchedConditions:string[], conditions:object, streak:{length:number, required:number, occurrences:number, occurrence_threshold:number|null, delta_fingerprint:string|null}}}
 */
export function evaluateEntryBar(carrierRecords, opts = {}) {
  const registry = Array.isArray(opts?.registry) ? opts.registry : CONCERN_KIND_REGISTRY;
  const records = Array.isArray(carrierRecords) ? carrierRecords.filter(isObj) : [];
  const mismatch = (reason, conditions = {}) => ({ eligible: false, reason, matchedConditions: [], conditions, streak: { length: 0, required: ENTRY_BAR_STREAK, occurrences: 0, occurrence_threshold: null, delta_fingerprint: null } });
  if (records.length === 0) return mismatch("CONDITION_1_NOT_MET:no carrier records supplied for this candidate — nothing to evaluate");

  const ordered = [...records];   // append order == chronology (see the doc comment above)
  const head = ordered[ordered.length - 1];
  const matched = [];

  // (1) concern_kind — a REGISTRY lookup, and FOUR states, not two (amend 2026-10-22).
  const kindReading = concernKindState(deriveConcernKind(head), registry);
  const kind = kindReading.kind;

  // (1a) THE REGISTRY'S `admission` FIELD IS A CONTRACT THE GATE MUST CONSUME (GOAL-911 / AC-923). An
  // unlawful registry is an INSTRUMENT failure, so it gets its own refusal value (硬规则 3b) and is
  // detected HERE — before any route is chosen or any delta is read — so a misspelt/absent admission can
  // never fall through to the mechanical path. `registryAdmissionViolations` is reused verbatim (single
  // source of truth: a second validator here would drift from the one the AC-921 suite pins). Every
  // violating kind is NAMED, and `invalid` (wrong value) is kept in its own list, separate from `missing`
  // (no string field at all) — 硬规则 3 (a count + a list, never a boolean) / 3b (deleted ≠ wrong).
  const admissionLawfulness = registryAdmissionViolations(registry);
  if (!admissionLawfulness.evaluated) {
    return mismatch(`CONDITION_1_UNDETERMINED:concern_kind=${kind ?? "<unreadable>"} — the CONCERN_KIND_REGISTRY could not be read for admission (${admissionLawfulness.cause}); an unreadable registry may not be treated as a lawful one`);
  }
  const unlawful = [];
  if (admissionLawfulness.invalid.length > 0) unlawful.push(`invalid admission value for kind(s): ${admissionLawfulness.invalid.join(", ")}`);
  if (admissionLawfulness.missing.length > 0) unlawful.push(`missing admission field for kind(s): ${admissionLawfulness.missing.join(", ")}`);
  if (unlawful.length > 0) {
    return mismatch(`CONDITION_1_UNDETERMINED:concern_kind=${kind ?? "<unreadable>"} — the CONCERN_KIND_REGISTRY's admission field is not lawful: ${unlawful.join("; ")}. A legal admission is one of ${Object.values(CONCERN_ADMISSIONS).join(" / ")}; an illegal or absent admission names NO route, so the gate refuses instead of falling through to the mechanical delta path`);
  }

  if (kindReading.state === CONCERN_KIND_STATES.UNDETERMINED) return mismatch(`CONDITION_1_UNDETERMINED:the concern_kind of the latest record could not be read (no concern_kind field, no slice_delta, no dupKind, no machine-written concern_kind=<kind> token)`);
  if (kindReading.state === CONCERN_KIND_STATES.NOT_MET) {
    return mismatch(`CONDITION_1_NOT_MET:concern_kind=${kind} — not a registered concern kind (CONCERN_KIND_REGISTRY: ${registry.map((e) => e.kind).join(", ")}); as amended 2026-10-22 only registered+mechanized kinds are admitted, and unregistered kinds stay in shadow (§6(a))`);
  }
  if (kindReading.state === CONCERN_KIND_STATES.NOT_YET_MECHANIZED) {
    // 硬规则 3b: this is ITS OWN value. A registered kind whose detector has not landed must not be
    // reported the same way as one that is out of scope — the difference is "wait for a task", not "no".
    return mismatch(`CONDITION_1_NOT_YET_MECHANIZED:concern_kind=${kind} — registered in CONCERN_KIND_REGISTRY but mechanized=false: ${kindReading.entry.detector}. With no landed detector/delta/negative control, nothing may leave the carrier for this kind`);
  }
  const entry = kindReading.entry;

  // (1b) WHO confirms this kind — the ADMISSION ROUTE (GOAL-911 / AC-918). `mechanized` answered "is the
  // instrumentation landed"; `admission` answers "who must confirm". A semantic-judged kind is confirmed
  // ONLY by the semantic judge — reading its mechanical delta would silently promote a clue to a
  // confirmation (硬规则 4b, "a mechanical signal is a lead, never the verdict"), so this branch is taken
  // BEFORE any delta is read. `unreadable` is its own value: an entry that does not say who confirms it
  // must not be treated as either route (硬规则 3/3b).
  const route = admissionRoute(entry);
  if (!route.evaluated) {
    return mismatch(`CONDITION_1_UNDETERMINED:concern_kind=${kind} — its CONCERN_KIND_REGISTRY entry does not say WHO confirms it (${route.cause}); an unreadable admission may not be treated as either route`);
  }
  if (route.route === CONCERN_ADMISSIONS.SEMANTIC_JUDGED) {
    return evaluateSemanticAdmission(head, entry, kind, opts, mismatch);
  }
  matched.push(CONDITIONS.KIND);

  // A registry entry that claims `mechanized:true` but carries no readers is an INSTRUMENT failure, not a
  // failed measurement (硬规则 3b) — its own value, ⛔ never "the delta is not computed".
  const readDelta = typeof entry.readDelta === "function" ? entry.readDelta : null;
  const fingerprintOf = typeof entry.fingerprintOf === "function" ? entry.fingerprintOf : null;
  if (readDelta === null || fingerprintOf === null) {
    return withMatched(mismatch(`CONDITION_2_UNDETERMINED:concern_kind=${kind} is registered with mechanized=true but its CONCERN_KIND_REGISTRY entry has no ${readDelta === null ? "readDelta" : "fingerprintOf"} reader — a malformed entry cannot judge anything`), matched);
  }

  // (2) the delta: computed by the KIND'S OWN detector, falsifiable control, identifiable window
  const d = readDelta(head);
  if (!d.present) return withMatched(mismatch(`CONDITION_2_NOT_MET:${d.detail} — the delta is not computed by the detector for concern_kind=${kind} (${entry.detector})`), matched);
  if (!d.computed) return withMatched(mismatch(`CONDITION_2_NOT_MET:the delta is not computed (${d.detail}) — a declared/estimated delta may not leave the carrier (§6(a))`), matched);
  if (!d.control_falsified) return withMatched(mismatch(`CONDITION_2_NOT_MET:the negative control is not falsified (${d.control_detail ?? `falsified=${JSON.stringify(head.slice_delta?.negative_control?.falsified ?? null)}`}) — an unfalsifiable delta proves nothing`), matched);
  if (!d.provenance_match) return withMatched(mismatch(`CONDITION_2_NOT_MET:provenanceConsistency=${String(d.provenance_status)} — the delta is not shown to have been computed from the windows the proposal cites`), matched);
  matched.push(CONDITIONS.DELTA);

  // (3) decision memory: a recorded exemption or a known-but-unfiled item must NOT be repackaged as a Goal.
  //     硬规则 6/3b (gap-entry-bar-c3-passes-on-absent-or-unreadable-decision-memory): an ABSENT memory
  //     (the memory was never consulted for this run) and a present-but-UNREADABLE one are BOTH 未查 —
  //     they must not pass as "已查过、非已知豁免". Only a READ verdict of `not-known` clears the bar.
  const memoryReading = decisionMemoryReading(head);
  const memory = memoryReading.status;
  if (memory === "exempted") return withMatched(mismatch(`CONDITION_3_NOT_MET:decision_memory=exempted (${head.decision_memory?.matched_entry?.id ?? "unknown entry"}) — a human already ruled this item is not to be changed`), matched);
  if (memory === "known-not-yet-filed") return withMatched(mismatch(`CONDITION_3_NOT_MET:decision_memory=known-not-yet-filed (${head.decision_memory?.matched_entry?.id ?? "unknown entry"}) — a known defect must be filed through its own path, not re-wrapped by this mechanism`), matched);
  if (memory === MEMORY_NOT_EVALUATED) {
    const named = memoryReading.cause === "absent"
      ? "is ABSENT on the record (缺席 — the decision memory was never consulted for this run; 缺值 = 未查, never 'not-known')"
      : `could not be READ (不可读 — ${memoryReading.detail})`;
    return withMatched(mismatch(`CONDITION_3_UNDETERMINED:decision_memory ${named} — a candidate whose decision-memory verdict is not evaluated may not clear the entry bar`), matched);
  }
  if (memory !== "not-known") return withMatched(mismatch(`CONDITION_3_UNDETERMINED:decision_memory status ${JSON.stringify(memory)} is not a recognised verdict`), matched);
  matched.push(CONDITIONS.MEMORY);

  // (4) run-streak: the MOST RECENT N production runs must all clear (1)–(3) with the SAME delta, AND
  //     the concern must have OCCURRED at least `entry.occurrenceThreshold` times (the registry's field —
  //     DIR-133 ruling 1). The two floors measure different things and are both required:
  //       streak      — CONSECUTIVE qualifying production runs ending at the head (§6(c));
  //       occurrences — qualifying production runs ANYWHERE in the slice (a [hit, miss, hit] slice has
  //                     occurrences=2 but streak=1), i.e. "how often has this concern actually happened".
  const fingerprint = fingerprintOf(head);
  const qualifies = (r) => {
    if (deriveConcernKind(r) !== kind) return false;
    const rd = readDelta(r);
    return rd.computed && rd.control_falsified && rd.provenance_match && fingerprintOf(r) === fingerprint;
  };
  let streak = 0;
  for (let i = ordered.length - 1; i >= 0; i--) {
    // A replay / holdout record is NOT a production run — it neither counts toward the streak nor breaks
    // it (§6(c) counts production live runs). The first PRODUCTION run that fails to qualify ends it.
    if (!isProductionRun(ordered[i])) continue;
    if (!qualifies(ordered[i])) break;
    streak++;
  }
  const occurrences = ordered.filter((r) => isProductionRun(r) && qualifies(r)).length;
  const occurrenceThreshold = Number.isFinite(entry.occurrenceThreshold) ? entry.occurrenceThreshold : null;
  const occurrenceShort = occurrenceThreshold !== null && occurrences < occurrenceThreshold;
  const streakReading = { length: streak, required: ENTRY_BAR_STREAK, occurrences, occurrence_threshold: occurrenceThreshold, delta_fingerprint: fingerprint };
  if (streak < ENTRY_BAR_STREAK || occurrenceShort) {
    const failures = [];
    if (streak < ENTRY_BAR_STREAK) failures.push(`run_streak=${streak}/${ENTRY_BAR_STREAK}`);
    if (occurrenceShort) failures.push(`occurrences=${occurrences}/${occurrenceThreshold} (CONCERN_KIND_REGISTRY occurrenceThreshold for concern_kind=${kind})`);
    return {
      eligible: false,
      reason: `CONDITION_4_NOT_MET:${failures.join("; ")} — ${streak} consecutive production run(s) carry the same computed, falsifiable delta; a one-off fluctuation must not trigger a proposal (§6(c), DIR-133 ruling 1)`,
      matchedConditions: matched,
      conditions: { kind: kindReading, delta: d, memory },
      streak: streakReading,
    };
  }
  matched.push(CONDITIONS.STREAK);
  return {
    eligible: true,
    reason: `ELIGIBLE:concern_kind=${kind} (detector=${entry.detector}); computed falsifiable delta (${entry.deltaCaliber}); provenanceConsistency=match; decision_memory=not-known; run_streak=${streak}/${ENTRY_BAR_STREAK}; occurrences=${occurrences}/${String(occurrenceThreshold)}`,
    matchedConditions: matched,
    conditions: { kind: kindReading, delta: d, memory },
    streak: streakReading,
  };
}

const withMatched = (verdict, matched) => ({ ...verdict, matchedConditions: matched });

/** Group a whole carrier into per-candidate slices. Candidate identity = its structural file set when the
 *  record carries one, else the loop's normalised `concern_key`. ⛔ Not the model's prose. */
export function groupByCandidate(records) {
  const groups = new Map();
  for (const r of Array.isArray(records) ? records : []) {
    if (!isObj(r)) continue;
    const files = Array.isArray(r.subject_files) && r.subject_files.length ? [...r.subject_files].sort().join(",") : null;
    const key = files ?? (isStr(r.concern_key, 1) ? r.concern_key : null);
    if (key === null) continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(r);
  }
  return groups;
}

// ── reading a carrier FILE (a line that cannot be read is COUNTED, never silently dropped) ──────────────
/**
 * Read a carrier file into `{records, malformed_lines}`.
 *
 * 硬规则 3b/5 (gap-entry-bar-c3-passes-on-absent-or-unreadable-decision-memory): a line that cannot be
 * parsed is NOT "a line that was not there". Dropping it silently is fail-OPEN in the worst place — if the
 * dropped line is the non-qualifying production run that would have BROKEN a run-streak, the streak looks
 * un-broken and condition 4's input is falsified. The field name `malformed_lines` mirrors
 * `architecture-evidence-store.mjs::readCarrier` so both readers of the same carrier report the same thing.
 *
 * A line counts as malformed when it is non-empty AND (its JSON does not parse OR it does not parse to an
 * object). Blank lines are structural (they separate records) and are not malformed.
 *
 * @returns {{records:Array<object>, malformed_lines:number, exists:boolean}}
 */
export function readCarrier(file) {
  if (!file || !fs.existsSync(file)) return { records: [], malformed_lines: 0, exists: false };
  const records = [];
  let malformed = 0;
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    if (line.trim() === "") continue;
    let v;
    try { v = JSON.parse(line); } catch { malformed++; continue; }
    if (!isObj(v)) { malformed++; continue; }
    records.push(v);
  }
  return { records, malformed_lines: malformed, exists: true };
}

/** The ONE fail-closed reason for an unreadable carrier, so the CLI and `evaluateCarrier` cannot drift. */
function malformedCarrierReason(malformedLines, underlyingReason) {
  return `MALFORMED_CARRIER_LINES:the carrier contains ${malformedLines} unreadable (non-JSON / non-record) line(s); a malformed line cannot be attributed to a candidate, so it cannot be excluded from that candidate's run-streak and the streak input is untrustworthy — every candidate is refused (硬规则 3b/5) [underlying verdict: ${underlyingReason}]`;
}

/**
 * Judge an ENTIRE carrier (as returned by `readCarrier`) candidate by candidate.
 *
 * ⛔ FAIL-CLOSED on any malformed line (硬规则 3b/4c): because a bad line cannot be attributed to a
 *    candidate, NO candidate's streak can be trusted while one exists — so every candidate's `eligible`
 *    is forced to `false` and its `reason` names the bad-line count. The underlying per-candidate verdict is
 *    preserved verbatim in the same reason string, so the reading is still inspectable.
 *
 * @param {object} carrier  `{records, malformed_lines}` — as returned by `readCarrier`.
 * @param {{semanticAdmission?:(record:object, entry:object)=>{admit:boolean, verdict?:string, counterfactual?:string}}} [opts]
 *   `semanticAdmission` is forwarded VERBATIM to `evaluateEntryBar` (GOAL-911 / AC-924). Without it a
 *   `semantic-judged` kind reports `CONDITION_1_SEMANTIC_NOT_EVALUATED` per candidate — its own value,
 *   never a mechanical confirmation and never a delta refusal. The CLI does NOT load a judge by default:
 *   the injector is the caller, because the only shipped judge today is a recorded-verdict replay and a
 *   default would silently bind the Planner to one corpus.
 *
 * @returns {{malformed_lines:number, carrier_unreadable:boolean, candidates:Array<object>}}
 *   each candidate entry carries `groupRecords` (its raw slice — used by the CLI's `--write` path); the CLI
 *   must NOT serialise that field to stdout.
 */
export function evaluateCarrier(carrier, opts = {}) {
  const records = Array.isArray(carrier?.records) ? carrier.records : [];
  const malformed_lines = Number.isInteger(carrier?.malformed_lines) && carrier.malformed_lines > 0 ? carrier.malformed_lines : 0;
  const carrier_unreadable = malformed_lines > 0;
  const candidateOpts = { semanticAdmission: opts?.semanticAdmission };
  const candidates = [];
  for (const [key, group] of groupByCandidate(records)) {
    const verdict = evaluateEntryBar(group, candidateOpts);
    const row = {
      candidate: key,
      n_records: group.length,
      eligible: verdict.eligible,
      reason: verdict.reason,
      matchedConditions: verdict.matchedConditions,
      streak: verdict.streak,
      groupRecords: group,
    };
    if (carrier_unreadable) {
      row.eligible = false;
      row.reason = malformedCarrierReason(malformed_lines, verdict.reason);
      row.suppressed_by = "MALFORMED_CARRIER_LINES";
    }
    candidates.push(row);
  }
  return { malformed_lines, carrier_unreadable, candidates };
}

// ── numbering (dynamic; no literal id is ever hard-coded — 硬规则 8: ids are never reused) ───────────
/** The next open GOAL id = max existing + 1. Reads whatever list it is given, so a caller that just read
 *  `goal_list` cannot race a session that created a goal in between — it re-reads before it writes. */
export function nextGoalId(existingGoalIds) {
  return nextId("GOAL", existingGoalIds);
}
export function nextAcId(existingAcIds) {
  return nextId("AC", existingAcIds);
}
function nextId(prefix, ids) {
  let max = 0;
  for (const id of Array.isArray(ids) ? ids : []) {
    const m = String(isObj(id) ? id.id : id ?? "").match(new RegExp(`^${prefix}-(\\d{3,})$`));
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `${prefix}-${String(max + 1).padStart(3, "0")}`;
}

// ── ADVISORY ownership review (gap-ownership-semantic-review-of-proposed-slice) ────────────────────
// ⛔ THIS CHANGES NO JUDGEMENT. `evaluateEntryBar` / `evaluateCarrier` are untouched by the flag, and the
//    test suite asserts every candidate's `eligible` / `reason` / `streak` is byte-identical with the flag
//    on and off. The review is printed beside the verdict and (only under the pre-existing `--write`)
//    attached to the draft body a human still has to rule on. Whether `reject` should become a FIFTH entry
//    condition is a question for a human AFTER this layer's readings exist (硬规则 12 / 硬规则 4 推论).

/** The record whose slice the review judges: the LATEST run that carries a computed delta and a slice. */
export function reviewableRecord(groupRecords) {
  const records = Array.isArray(groupRecords) ? groupRecords.filter(isObj) : [];
  for (let i = records.length - 1; i >= 0; i--) {
    const r = records[i];
    const d = deltaEvidence(r);
    if (d.computed && isObj(r.proposed_slice) && Array.isArray(r.proposed_slice.moves) && r.proposed_slice.moves.length) {
      return { ok: true, record: r, reason: `run_id=${r.run_id ?? "n/a"}` };
    }
  }
  return { ok: false, record: null, reason: "NO_COMPUTED_DELTA_WITH_SLICE: no run of this candidate carries both a computed delta and a proposed slice — there is no cut to review" };
}

/**
 * Review ONE candidate's slice. PURE apart from the injected judge: it assembles commit-locked evidence,
 * derives the mechanical facts, and asks the blind judge. The slice's own record supplies commit /
 * scope_root / moves — nothing is taken from a GOAL body.
 *
 * @returns {Promise<object>} `{state, cause?, review?}` — `state:"not-evaluated"` with a named cause when
 *          the review could not run; it is NEVER reported as an abstain (硬规则 3b).
 */
export async function reviewCandidate(groupRecords, { root, invokeJudge, graph = null, deps = {} }) {
  const pick = reviewableRecord(groupRecords);
  if (!pick.ok) return { state: "not-evaluated", cause: "NO_COMPUTED_DELTA_WITH_SLICE", reason: pick.reason };
  const rec = pick.record;
  const slice = rec.proposed_slice;
  if (typeof invokeJudge !== "function" && !deps.reviewOwnership) {
    return { state: "not-evaluated", cause: "NO_JUDGE_SEAM", reason: "no launcher was injected — refusing to report a review that never ran (硬规则 3b)" };
  }
  const mod = deps.reviewModule || await import("./ownership-semantic-review.mjs");
  const commit = isStr(rec.commit, 1) ? rec.commit : null;
  if (commit === null) return { state: "not-evaluated", cause: "RECORD_HAS_NO_COMMIT", reason: "the run record carries no commit, so no reading could be taken at a pinned tree" };
  const bundle = mod.assembleOwnershipEvidence({ root, commit, scopeRoot: slice.scope_root, slice });
  const facts = mod.ownershipFacts(bundle, graph);
  const leakage = mod.auditHoldoutLeakage(bundle);
  const review = await (deps.reviewOwnership ?? mod.reviewOwnership)({ bundle, facts, invokeJudge });
  return { state: review.state, review, facts, leakage, bundle_bytes: bundle.bytes, commit, run_id: rec.run_id ?? null };
}

/** Render the review as the lines a draft body carries. Deterministic — no prose is invented here. */
export function renderReviewSection(reviewResult) {
  if (!reviewResult || reviewResult.state !== "evaluated") {
    return [`- 归属审查：未评估（${reviewResult?.cause ?? "unknown"}）——${String(reviewResult?.reason ?? "").slice(0, 300)}`];
  }
  const r = reviewResult.review;
  const lines = [
    `- 整体建议：**${r.overall.recommendation}**（置信度 ${r.overall.confidence ?? "n/a"}）`,
    `- judge prompt sha256：${r.prompt_sha256}`,
    `- 逐 move：`,
  ];
  for (const m of r.moves) {
    lines.push(`  - move ${m.move_index}（${m.file} → ${m.to}）：**${m.recommendation}**/${m.confidence ?? "n/a"}${m.cause ? ` [${m.cause}${m.downgraded_from ? ` ← ${m.downgraded_from}` : ""}]` : ""}`);
    if (m.responsibility_hypothesis) lines.push(`    - 假设：${m.responsibility_hypothesis}`);
    lines.push(`    - 证据：${m.evidence_refs.length ? m.evidence_refs.join(", ") : "(none)"}${m.counter_evidence_refs.length ? `；反证回应：${m.counter_evidence_refs.join(", ")}` : ""}`);
  }
  lines.push("- 本审查为 advisory 层，不改变准入判据；是否升格为准入条件由人裁定。");
  return lines;
}

// ── the constrained write: exactly one draft Goal (and its exit-condition AC) ─────────────────────
/**
 * Build the two records a draft Goal needs. PURE — no I/O. The GOAL body carries, as the task requires:
 * the evidence-chain reference, the ArchGuard-COMPUTED predicted delta, the reversibility assessment, and
 * the human-approval line. The AC is the goal's exit condition and is written FIRST: the goal write surface
 * refuses a GOAL born in {draft, active} with zero ACs, and that refusal is the store's own invariant
 * (AC-217), not this module's.
 *
 * `review` is OPTIONAL and ADVISORY: when supplied it only appends a section to the body. It cannot change
 * the status (still hard-coded `draft`), the title, the origin, or the AC — a review can never authorise
 * anything (硬规则 12: the layer measures first, the human rules after).
 */
export function buildDraftGoal(eligibleRecord, { goalId, acId, review = null }) {
  const kind = deriveConcernKind(eligibleRecord) ?? "unknown";
  // The delta is read through the KIND'S OWN registry reader — the body may not describe a
  // design-evolution candidate with package-cycle's vocabulary (it has no slice and no ArchGuard delta).
  const entry = concernKindEntry(kind);
  const evidence = typeof entry?.readDelta === "function" ? entry.readDelta(eligibleRecord) : null;
  const delta = evidence?.delta ?? eligibleRecord.slice_delta?.delta ?? null;
  const evidenceIds = [
    ...(Array.isArray(eligibleRecord.envelope?.evidence_refs) ? eligibleRecord.envelope.evidence_refs : []),
    ...(Array.isArray(eligibleRecord.evidence) ? eligibleRecord.evidence.map((e) => e.id).filter(Boolean) : []),
  ];
  const uniqueEvidence = [...new Set(evidenceIds)];
  const files = Array.isArray(eligibleRecord.subject_files) ? eligibleRecord.subject_files : [];
  const renderedDelta = isStr(eligibleRecord.envelope?.expected_mechanical_delta, 1)
    ? eligibleRecord.envelope.expected_mechanical_delta
    : JSON.stringify(delta, null, 1);
  const title = `[auto-proposal] ${kind} 收敛候选：${(files.length ? files.join(", ") : eligibleRecord.concern_key || eligibleRecord.target || "unlabelled candidate").slice(0, 90)}`;

  const origin = [
    `自动投研机制产出的候选（ownership-active limited-proposal mode, 端到端架构自举实验 阶段 C）。`,
    `证据载体 .quay/ownership-shadow-proposals.jsonl；run_id=${eligibleRecord.run_id ?? "n/a"}；commit=${eligibleRecord.commit ?? "n/a"}。`,
    `准入判据 evaluateEntryBar 四条全过：concern_kind=${kind}（探测器：${entry?.detector ?? "unregistered"}）；delta 由 ${entry?.deltaCaliber ?? "该 kind 的探测器"} 计算且负对照已证伪；决策记忆=not-known；连续 ${ENTRY_BAR_STREAK} 次生产 live run 一致，出现次数 ≥ CONCERN_KIND_REGISTRY occurrenceThreshold。`,
    `人在审批前不得把本 Goal 转 active——这是本机制唯一的合法终态。`,
  ].join("\n");

  const body = [
    "## 背景",
    `本候选由「ownership-active limited-proposal mode」从生产 live shadow run 的 carrier 记录中筛出，是端到端架构自举实验阶段 C 的自动产出物之一。它只声明一个 ${kind} 的收敛改动面，不承诺任何实现方式。`,
    "",
    "## 证据链",
    `- carrier：.quay/ownership-shadow-proposals.jsonl`,
    `- run_id：${eligibleRecord.run_id ?? "n/a"}`,
    `- 被测 commit：${eligibleRecord.commit ?? "n/a"}`,
    `- 涉及文件：${files.length ? files.join(", ") : "(见 run 记录)"}`,
    `- 引用的证据读数 id：[${uniqueEvidence.join(", ")}]`,
    `- 决策记忆：not-known（无命中条目）`,
    "",
    `## 预测 delta（由 ${entry?.deltaCaliber ?? "该 kind 的探测器"} 计算，非模型自述）`,
    renderedDelta,
    `- 负对照：${evidence?.control_detail ?? "falsified=true"}；provenanceConsistency=${evidence?.provenance_status ?? "match"}`,
    "",
    ...(review ? ["", "## 领域归属审查（advisory；不改变准入判据）", ...renderReviewSection(review)] : []),
    "",
    "## 范围与非目标",
    `- 在范围内：${kind} 候选本身声明的改动面（见上 delta）。`,
    "- 非目标：任何未在 delta 中命名的改动；任何产物化/长期保证；任何把本 Goal 自行转 active 的动作。",
    "",
    "## 可逆性评估",
    `本候选的改动以独立的 goal 分支（goal/<本 Goal id>）承载：若人裁定否决，整条分支可直接丢弃，develop 无残留——与本仓库既有的「整分支丢弃」先例同形。因此本候选的代价是可逆的，不需要在审批前做任何预防性回退。`,
    "",
    "## 退出条件",
    `${acId} —— 本 Goal 离开 draft（active=认可；superseded=否决）即视为已裁定。`,
    "",
    `> ${APPROVAL_REQUIRED_LINE}`,
  ].join("\n");

  const acCriterion = `goal_file=$(ls goals/${goalId}-*.md 2>/dev/null | head -1); [ -n "$goal_file" ] && grep -Eq "^status: *(active|superseded)" "$goal_file" || { echo "${goalId} 仍为 draft——须人工裁定后才可离开待裁定面" >&2; exit 1; }`;

  return {
    goal: { kind: "goal", id: goalId, fields: { title, status: "draft", origin, body, intent: "absent" } },
    ac: {
      kind: "criterion", id: acId,
      fields: {
        title: `${title} — 退出条件`,
        status: "draft",
        goal: goalId,
        criterion: acCriterion,
        expect: `该候选已被人工裁定：${goalId} 离开 draft（active=认可；superseded=否决）。draft 期间判据为假并写出成因。`,
        origin,
        intent: "absent",
      },
    },
  };
}

/**
 * Create exactly ONE draft Goal (plus its exit-condition AC, written first — see buildDraftGoal).
 * ⛔ PRECONDITION: the caller has already confirmed `evaluateEntryBar(candidateRecords).eligible === true`.
 *    This function does NOT re-judge (a single record cannot show a run-streak), and it does NOT activate
 *    anything — the draft status is hard-coded here and nowhere in this module is a non-draft status written.
 * ⛔ FAIL-CLOSED (硬规则 3b): with no `deps.write` seam there is NOTHING to report as created — the call
 *    returns `{ok:false}` and never a fabricated Goal. With a failing write it reports the failure.
 *
 * @param {object} eligibleRecord  the qualifying carrier record (the LAST run of the streak)
 * @param {Array} existingGoalIds  open GOAL ids (from goal_list) — the number is computed, never hard-coded
 * @param {object} deps  { write(record)->{ok,id,error?}, existingAcIds?:Array }
 * @returns {{ok:boolean, id:string|null, goal:object|null, ac:object|null, reason:string}}
 */
export function proposeDraftGoal(eligibleRecord, existingGoalIds, deps = {}) {
  const goalId = nextGoalId(existingGoalIds);
  const acId = nextAcId(deps.existingAcIds ?? []);
  const { goal, ac } = buildDraftGoal(eligibleRecord, { goalId, acId, review: deps.review ?? null });
  if (typeof deps.write !== "function") {
    return { ok: false, id: null, goal: null, ac: null, reason: "NO_WRITE_SEAM:refusing to report a draft Goal that was not persisted (硬规则 3b)" };
  }
  const acRes = deps.write(ac);
  if (!acRes || acRes.ok !== true) {
    return { ok: false, id: null, goal: null, ac: null, reason: `AC_WRITE_FAILED:${acRes?.error ?? acRes?.reason ?? "unknown"} — the goal is refused by the store without its exit-condition AC (AC-217); nothing was created` };
  }
  const goalRes = deps.write(goal);
  if (!goalRes || goalRes.ok !== true) {
    return { ok: false, id: null, goal: null, ac: null, reason: `GOAL_WRITE_FAILED:${goalRes?.error ?? goalRes?.reason ?? "unknown"}` };
  }
  return { ok: true, id: goalId, goal, ac, reason: `draft ${goalId} created (status=draft; awaiting human approval)` };
}

/**
 * The real write seam over a goal store (`packages/quay/src/goal-store.ts::createGoalStore(goalDir)`),
 * passed IN so this module never statically imports the Core tree. `write` is the ONLY side-effecting
 * thing this module does, and it can only ever write `draft` records built by buildDraftGoal.
 */
export function createGoalStoreWrite(store) {
  if (!store || typeof store.write !== "function") throw new Error("createGoalStoreWrite: a goal store with a write() method is required");
  return (record) => {
    try {
      const vm = store.write(record.id, { ...record.fields });
      return { ok: true, id: vm.id };
    } catch (e) {
      return { ok: false, id: record.id, error: String(e?.message ?? e) };
    }
  };
}

// ── CLI: a real (non-fixture) reading + an optional constrained write ────────────────────────────────
/**
 * The CLI body, exported so the suite can drive the REAL flag path in-process (and inject the judge)
 * instead of spawning a process that would have to reach a model to answer AC7. `cli()` is a thin wrapper.
 *
 * @param {object} o
 * @param {string[]} o.argv   the argument vector (without the node/script prefix)
 * @param {string} o.repoRoot the module's own repo root (for the goal store + driver-runtime)
 * @param {object} [o.deps]   { invokeJudge, semanticAdmission } — `invokeJudge` is the ADVISORY review's
 *   launcher (injected only by the suite); `semanticAdmission` is the C1 judge for `semantic-judged` kinds
 *   (GOAL-911 / AC-924), forwarded to `evaluateCarrier` → `evaluateEntryBar`. Neither is loaded by default:
 *   a run without `deps.semanticAdmission` reports `CONDITION_1_SEMANTIC_NOT_EVALUATED` for those kinds
 *   instead of quietly binding the Planner to one judge.
 * @returns {Promise<object>} the object the CLI serialises
 */
export async function runProposalCli({ argv, repoRoot, deps = {} }) {
  const { fileURLToPath } = await import("node:url");
  const REPO_ROOT = repoRoot ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
  const args = argv;
  const val = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
  const root = val("--root", REPO_ROOT);
  const carrier = val("--carrier", path.join(root, ".quay", "ownership-shadow-proposals.jsonl"));
  const { records, malformed_lines } = readCarrier(carrier);
  const evaluated = evaluateCarrier({ records, malformed_lines }, { semanticAdmission: deps.semanticAdmission });
  const out = [];
  const write = args.includes("--write");
  let store = null, writeSeam = null;
  if (write) {
    const { createGoalStore } = await import(path.join(REPO_ROOT, "packages", "quay", "src", "core", "goal-store.ts"));
    store = createGoalStore(path.join(root, "goals"), {});
    writeSeam = createGoalStoreWrite(store);
  }
  // ADVISORY review seam: the SAME tool-less launcher the investigation loop uses. Built only when asked,
  // so a run without `--review` neither spawns a model nor loads the review module.
  const reviewOn = args.includes("--review");
  let invokeJudge = deps.invokeJudge ?? null;
  if (reviewOn && !invokeJudge) {
    const { launchArgv, runAsync } = await import(path.join(REPO_ROOT, "plugin", "scripts", "driver-runtime.ts"));
    const role = val("--role", "meta-driver");
    invokeJudge = async (prompt) => {
      const argv = launchArgv(role, prompt, root, { promptViaStdin: true });
      argv.splice(argv.length - 1, 0, "--tools", "", "--disable-slash-commands", "--no-session-persistence", "--strict-mcp-config");
      return runAsync(argv, { timeoutMs: 600_000, collectStderr: true, stdinData: prompt });
    };
  }
  const graphFile = val("--graph", null);
  const graph = graphFile ? (() => { try { return JSON.parse(fs.readFileSync(graphFile, "utf8"))?.extensions?.tsAnalysis?.moduleGraph ?? null; } catch { return null; } })() : null;

  for (const row of evaluated.candidates) {
    // Explicitly pick the report fields — `row.groupRecords` must never reach stdout (it is the raw carrier slice).
    const outRow = { candidate: row.candidate, n_records: row.n_records, eligible: row.eligible, reason: row.reason, matchedConditions: row.matchedConditions, streak: row.streak };
    if (row.suppressed_by) outRow.suppressed_by = row.suppressed_by;
    // ADVISORY, and placed AFTER the verdict fields are already fixed: every verdict field above is computed
    // by evaluateCarrier and is untouched by this flag (asserted byte-for-byte by the test suite).
    let reviewResult = null;
    if (reviewOn && !evaluated.carrier_unreadable) {
      // `--repo` is the tree the evidence is read from (git); `--root` is the workspace the Goal would be
      // written into. They coincide by default and are separate because the review must read the real repo
      // even when the write target is a scratch workspace.
      reviewResult = await reviewCandidate(row.groupRecords, { root: val("--repo", REPO_ROOT), invokeJudge, graph });
      outRow.review = { state: reviewResult.state, cause: reviewResult.cause ?? null, commit: reviewResult.commit ?? null, run_id: reviewResult.run_id ?? null, bundle_bytes: reviewResult.bundle_bytes ?? null, leakage: reviewResult.leakage ? { ok: reviewResult.leakage.ok, hits: reviewResult.leakage.hits.length } : null, overall: reviewResult.review?.overall ?? null, moves: (reviewResult.review?.moves ?? []).map((m) => ({ move_index: m.move_index, file: m.file, to: m.to, recommendation: m.recommendation, confidence: m.confidence, cause: m.cause, evidence_refs: m.evidence_refs, counter_evidence_refs: m.counter_evidence_refs, hypothesis: m.responsibility_hypothesis })) };
    }
    // `--write` cannot fire on a malformed carrier: evaluateCarrier has already forced eligible=false for
    // EVERY candidate, so no Goal can be written from an unreadable streak input.
    if (row.eligible && write) {
      const existing = store.list().map((g) => g.id);
      outRow.proposed = proposeDraftGoal(row.groupRecords[row.groupRecords.length - 1], existing, { write: writeSeam, existingAcIds: existing, review: reviewResult });
    }
    out.push(outRow);
  }
  return { carrier, records: records.length, malformed_lines, carrier_unreadable: evaluated.carrier_unreadable, candidates: out.length, results: out };
}

// ── CLI entry (a thin wrapper over the exported body) ───────────────────────────────────────────────
async function cli() {
  const out = await runProposalCli({ argv: process.argv.slice(2) });
  process.stdout.write(JSON.stringify(out, null, 2) + "\n");
}

if (import.meta.url === `file://${process.argv[1]}`) cli();
