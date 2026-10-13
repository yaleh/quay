#!/usr/bin/env node
// DISCOVERY PORTFOLIO — the value ledger that JOINS one Finding to its fix, that fix's landing, a later
// recurrence, a human rating and the gateway cost spent on it.
//
// WHY THIS EXISTS (the evaluation target changed on 2026-10-12): the measure of Quay's self-bootstrapping
// discovery is not sealed-holdout hit rate. It is (A) real net-new engineering value in open domains,
// (B) a capability coverage map, (C) capability gain before/after learning. Nothing recorded value end to
// end: the evidence store records verdicts, the Experience ledger records outcomes, tasks record fixes —
// and NOTHING joined them. So "value" could only be counted as Finding or Supported counts, which is
// trivially inflatable (a run that emits 50 refuted findings would look as productive as one that lands
// five fixes).
//
// ⛔ WHAT THIS MODULE IS NOT (scope check, so it does not duplicate its siblings):
//   • `architecture-evidence-store.mjs` — the evidence trail of ONE investigation (evidence/hypothesis/
//     experiment/outcome/counterexample). It has no fix, no landing, no cost, no rating.
//   • `discovery-experience-ledger.mjs` — the Experience ROLES (missed-by-tooling / found-and-fixed / …)
//     keyed by outcome. It does not resolve a fix TASK, does not read git for a landing, and does not cost.
//   • `discovery-method-registry.mjs` — a reusable METHOD, versioned. A method is not a finding.
// This module adds exactly ONE thing: a per-Finding value record + the derivations that make its
// value-relevant fields unassertable — plus the anti-inflation metric that reads them.
//
// ⛔ STRUCTURAL SANDBOX (same spirit as the two siblings): no filing machinery, no goal/AC write, no
// scheduler, no CLI verb, no detection. Its ONLY persistence is append-only lines to
// `.quay/discovery-portfolio.jsonl`.
//
// ── THE THREE DERIVATIONS (Plan 3). NONE is taken from the caller's word ──────────────────────────
//   1. `fix_landed_commit`  READ FROM GIT: the last `develop` commit on `tasks/<fix_task>.md` whose
//      subject marks the task done. A caller MAY supply it, but a value that disagrees with git is
//      REFUSED (`DERIVED_DISAGREES`) — the git reading is the record, the supplied value is only a
//      cross-check.
//   2. `recurred`  READ FROM THE EVIDENCE STORE: a LATER `outcome` record with verdict `supported` whose
//      `subject_files` intersect the finding's component set. `false` (checked, nothing came back) and
//      `null` (could not check) are DIFFERENT values — 硬规则 3b.
//   3. `cost`  COMPUTED from recorded usage × the gateway's own published rates
//      (`GET <gateway>/model_group/info`, the same source the method-regression report reads). The
//      caller supplies USAGE (model calls / tokens / the model group it was billed under); the USD figure
//      is never accepted from the caller. Missing usage — or an unreadable gateway — yields `cost: null`
//      and a `cost_reason`, NEVER `0` (硬规则 4: `0` is a value; "nobody recorded it" is not).
//
// ── THE ANTI-INFLATION METRIC (Plan 4) ───────────────────────────────────────────────────────────
// `net_new_value` counts a record only when it is `supported` ∧ its fix LANDED ∧ not a duplicate ∧ not
// rated `noise`. Finding count and supported count are returned under `context` and are NEVER the
// headline; `noise` ratings, refuted claims and duplicates are returned under `zero_or_negative` as
// explicit zero-value lists. The two properties that make it non-gameable are directly tested:
//   • adding N refuted records cannot move `net_new_value` (AC g);
//   • counting "supported findings" instead of "landed fixes" makes (g) go red — the mutation control.
//
// ── HUMAN RATINGS ARE NOT WRITABLE BY A WORKER (Plan 6) ─────────────────────────────────────────
// The `human_rating` field is written ONLY through `rateFinding({finding_id, value, by, actor})`, and
// `actor` — the PROCESS writing the line, not a claim in its text — must be `operator-session`. A
// `task-worker` actor is refused outright (`RATING_BY_NON_HUMAN`), the same axis discipline the
// Experience ledger uses for `reported_by:"user"`. `ingestFinding` refuses a non-null `human_rating`
// altogether: a rating is a separate append-only line, never a field of the finding it rates.
//
// ── THE CAPABILITY COVERAGE MAP (Plan (B), the 2026-10-12 strategy change) ───────────────────────
// `coverageMap(root)` grades each of the six domains the USER named — shared semantics; config→behavior;
// writer/checker contract; state transitions; reuse refutation; method trustworthiness — and it is
// DERIVED, never stored: it reads the carrier and the method registry on every call.
//
// ⛔ COVERAGE IS NOT VALUE, and keeping them apart is the point. A landed fix is value
// (`valueMetrics`); a CORRECT REFUTATION is capability WITHOUT value (N01 sits in
// `zero_or_negative.refuted` and grades its domain `autonomous` here). A domain covered only by
// operator teaching is capability-with-assistance. The map reports the two arms separately
// (`via: "landed-fix"` / `via: "refutation"`) so no row can be read as more than it is.
//
// THE TWO THINGS THIS MAP REFUSES, both anti-inflation:
//   • a TEACHING-level case never grades `autonomous` (Plan 3) — the answer was known before any tool
//     ran, so it demonstrates transcription, not discovery. `transfer` is refused for the same reason
//     (learned on one case, applied to a second, is not a blind find). This is the clause the AC3
//     mutation control flips, and case (a) is the assertion that turns red when it is removed.
//   • the domain is never GUESSED — not from the claim text, not from the components. It is an explicit
//     `domain` field stated at ingest together with a `domain_reason`, and a finding that carries none
//     is reported under `unclassified`. A guess would make the map's grades unfalsifiable.
// A method contributes nothing while it is `retired` or on the contaminated-verdict ledger (Plan 4).
//
// ── CORRECTING A FINDING AFTER IT IS INGESTED (the append-only correction kind, 2026-10-12) ───────
// A finding is written ONCE and its id is keyed on `finding_id`, so re-ingesting one to fix a field is a
// `DUPLICATE_ID` no-op by construction (see the domain-assignment note below). But a finding's value
// fields are JUDGMENTS MADE AT INGEST, and a later check can overturn one: what looked like a new defect
// turns out to be a duplicate of an earlier one, or its mechanism is refuted, or its fix lands after the
// fact. Without a way to record that, the carrier keeps asserting the original claim and the value
// metrics are wrong in BOTH directions at once (the 2026-10-12 gain experiment: one real defect fixed and
// landed but uncounted because no `fix_task` was ever attached — undercount; and two findings recorded
// `supported` that the operator re-check called a duplicate and a refutation — overclaim).
//
// ⛔ SO A CORRECTION IS ITS OWN APPEND-ONLY LINE (`kind:"portfolio_correction"`), never a rewrite. It
//    names the finding and a patch drawn from a CLOSED set of correctable fields — `outcome`,
//    `duplicate_of`, `fix_task`. The original line stays byte-identical; `readPortfolio` folds the
//    corrections onto it in append order and reports BOTH values (`corrected_from` + `correction_ids`),
//    so "corrected" can never be mistaken for "was always right".
// ⛔ THE PATCH SET IS CLOSED ON PURPOSE. A correction able to patch `claim`/`components`/`cost` would be
//    a supported way to rewrite what the finding says was found, which is exactly what an append-only
//    carrier forbids. The fields that are DERIVED (`fix_landed_commit`, `recurred`, `cost`, …) are
//    refused with their OWN code: supplying one is not "a field you may not patch", it is an attempt to
//    ASSERT a value this module exists to read.
// ⛔ `fix_task` IS RE-DERIVED, NEVER SUPPLIED. Patching `fix_task` re-runs `deriveFixLandedCommit` on
//    read, so the landing of a corrected fix is a git reading like every other landing — a correction
//    written before the fix landed starts counting the moment it lands, and one whose landing is not
//    derivable contributes NOTHING to `net_new_value` (the derivation's `null`, not the caller's word).
// ⛔ A DUPLICATE TARGET MUST PRECEDE ITS DUPLICATE and must not itself be a duplicate. That is not
//    decoration: the ingest path's own duplicate rule searches only EARLIER records and reads
//    `duplicate_of === null`, so a correction pointing forward or onto another duplicate would produce a
//    pair whose "which one is the original" answer depends on which reader you ask. A chain that loops
//    back onto the finding being corrected is refused too (`CORRECTION_DUPLICATE_OF_CYCLE`) — only a
//    hand-edited carrier can already hold such a link, and closing the loop would leave a pair where
//    NEITHER row is the original, so the very finding that is net-new disappears from the accounting.
// ⛔ A CORRECTION IS NOT A RATING. `rateFinding` is human-only (`RATING_ACTORS`), because "worthless" is
//    a value judgment only a human may make. A correction asserts something CHECKABLE — the landing is in
//    git, the duplicate is in the carrier — so the writer set is different (`CORRECTION_ACTORS`) and a
//    task worker that a report or an operator check already established may write one. What is NOT
//    relaxed is that the writer must NAME ITSELF: `actor` (the process) and `by` (the namer) are both
//    required, and an absent actor is refused rather than defaulted (that default IS the defect).

// ⛔ THE ONE PLACE THE CARRIER IS APPEND-ONLY AND THE FIELD IS NOT: the 13 production rows were
//   ingested on 2026-10-12 BEFORE `domain` existed, and the carrier is append-only with an id keyed on
//   `finding_id`, so a re-ingest is a `DUPLICATE_ID` no-op and cannot add the field. Their domains
//   therefore arrive as their own `portfolio_domain` lines (the same overlay model the RATINGS use),
//   appended by `backfill` on a re-run. `readPortfolio` merges them and reports which arm the value
//   came from (`domain_source`), so "stated at ingest" and "added later" are different values.
//
// CARRIER: `.quay/discovery-portfolio.jsonl`, resolved through the ledger module's shared-checkout
// resolver (`carrierFile` / `appendCarrierLine` / `readCarrier`) — a task worktree being torn down must
// not take the portfolio with it (task gap-discovery-carriers-ephemeral-in-worktree). ⛔ The path is NOT
// added to `DISCOVERY_CARRIERS` (the siblings' one table of append-only line carriers): that table lives
// in a file outside this task's declared ## Touches, and `carrierEntry`/`appendCarrierLine` already take
// a carrier-shaped path directly, so no second definition of the path is needed.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

// Reuse the evidence store's primitives (content addressing + the carrier reader that COUNTS unparseable
// lines) and the ledger module's carrier persistence (atomic append, idempotent by id, shared-checkout
// resolution). Re-implementing any of them would be a second definition to keep in sync.
import { recordId, readRecords, EVIDENCE_STORE_REL } from "./architecture-evidence-store.mjs";
import {
  carrierFile, readCarrier, appendCarrierLine, resolveCarrierRoot,
} from "./discovery-experience-ledger.mjs";
// The coverage map's METHOD half reads the registry (a method that claims a domain is evidence of
// capability, and a `retired`/contaminated one is not). Reused, never re-implemented: "which version of
// a method is current" and "which verdicts are contaminated" are the registry's own judgments.
import { readMethodRegistry, contaminatedVerdictIds, CONTAMINATED_VERDICTS_REL, METHOD_STATUSES } from "./discovery-method-registry.mjs";

/** The one fixed sink, relative to the SHARED checkout. */
export const PORTFOLIO_REL = ".quay/discovery-portfolio.jsonl";
/** The record kind a Finding carries. */
export const PORTFOLIO_KIND = "portfolio_finding";
/** The record kind a human RATING carries — a separate append-only line, applied on read. */
export const PORTFOLIO_RATING_KIND = "portfolio_rating";
/** The record kind a DOMAIN ASSIGNMENT carries — the same overlay model, for findings ingested before
 *  the `domain` field existed (see the header). Separate kind so "stated at ingest" and "added later"
 *  can never be confused on read-back. */
export const PORTFOLIO_DOMAIN_KIND = "portfolio_domain";
/** The record kind a CORRECTION carries — the same overlay model again, for the fields a later check
 *  overturns (see the header). A separate kind so a corrected value and a value that was always right
 *  are never the same reading. */
export const PORTFOLIO_CORRECTION_KIND = "portfolio_correction";

/**
 * The ONLY fields a correction may patch — the closed set Plan item 1 names. ⛔ Restricting the set is
 * the point: `claim` / `components` / `domain` describe WHAT WAS FOUND, and a supported way to rewrite
 * them would make the carrier's account of its own findings unfalsifiable. These three are the
 * POST-INGEST JUDGMENTS: the verdict, the duplicate relation, and the fix the finding was assigned.
 */
export const CORRECTABLE_FIELDS = Object.freeze(["outcome", "duplicate_of", "fix_task"]);

/**
 * The fields a correction may NOT patch because they are DERIVED — from git (`fix_landed_commit`,
 * `fix_landed_reason`), from the evidence store (`recurred`), from recorded usage × the gateway's rates
 * (`cost`), or from the origin carrier (`origin_carrier`). ⛔ They get their OWN refusal code rather
 * than falling under `CORRECTION_FIELD_NOT_CORRECTABLE`: supplying one is not "a field outside the
 * patch set", it is an attempt to ASSERT a value this module exists to read from its source.
 */
export const DERIVED_RECORD_FIELDS = Object.freeze([
  "fix_landed_commit", "fix_landed_reason", "recurred", "recurred_reason", "cost", "cost_reason", "origin_carrier",
]);

/**
 * The processes that may write a correction. ⛔ Deliberately NOT `RATING_ACTORS`: a rating is a human's
 * VALUE judgment (only `operator-session` may make one), while a correction asserts something checkable
 * against git or the carrier — so a task worker acting on an operator's re-check (the 2026-10-12 gain
 * experiment is exactly that) may write one. What is NOT relaxed is that the process must name itself.
 */
export const CORRECTION_ACTORS = Object.freeze(["operator-session", "task-worker"]);

/** The floor on a correction's `reason` — the same 8 non-whitespace characters the dispatch record and
 *  the ledger's own correction use: a correction with no reason is an edit with no audit trail. */
export const MIN_CORRECTION_REASON_CHARS = 8;

/** Where a finding came from. The five values the Plan names — the reconstruction's finer labels
 *  (`operator-led`, `autonomous-blind-experiment`, `operator-production-reading`) map onto these. */
export const ORIGINS = Object.freeze([
  "autonomous-routine", "autonomous-experiment", "operator", "user", "mechanical-instrument",
]);

/**
 * HOW WELL the finding was known before it was examined — the axis that separates a discovery from a
 * transcription:
 *   • `teaching`        — the answer was known (taught / user-stated) before any tool ran.
 *   • `transfer`        — learned on one case and applied to a second, unrelated one.
 *   • `independent`     — found by a blind investigator, no answer supplied.
 *   • `production-open` — found by an instrument or routine reading the open production surface.
 */
export const EVIDENCE_LEVELS = Object.freeze(["teaching", "transfer", "independent", "production-open"]);

/** The verdict vocabulary, shared with the evidence store on purpose (a portfolio claim and an outcome
 *  verdict are the same claim; a second enum would drift). */
export const OUTCOMES = Object.freeze(["supported", "refuted", "undetermined"]);

// ── the SIX domains the user named (Plan (B)) and the coverage grades over them ───────────────────

/** The domains the coverage map grades, in the order the user named them. A slug set, not a free string:
 *  a domain outside this list is refused at ingest (`DOMAIN_NOT_IN_VOCAB`), because a typo'd domain
 *  would silently create a seventh bucket that no report ever reads. */
export const DOMAINS = Object.freeze([
  "shared-semantics", "config-to-behavior", "writer-checker-contract",
  "state-transitions", "reuse-refutation", "method-trustworthiness",
]);

/** The human label per slug — the spelling the user and the operator baseline use. */
export const DOMAIN_LABELS = Object.freeze({
  "shared-semantics": "shared semantics",
  "config-to-behavior": "config→behavior",
  "writer-checker-contract": "writer/checker contract",
  "state-transitions": "state transitions",
  "reuse-refutation": "reuse refutation",
  "method-trustworthiness": "method trustworthiness",
});

/** What a METHOD's `applicability` text must literally say to claim a domain. The registry's
 *  `domain_signals` are free prose, so the only non-guessing rule is a NAME match: a method claims a
 *  domain by naming it (any of these spellings, case-insensitive). ⛔ Deliberately narrow — a keyword
 *  heuristic over prose would invent claims the method never made, which is the same defect as guessing
 *  a finding's domain from its claim. */
export const DOMAIN_NAME_ALIASES = Object.freeze({
  "shared-semantics": ["shared semantics", "shared-semantics"],
  "config-to-behavior": ["config→behavior", "config->behavior", "config-to-behavior", "config to behavior"],
  "writer-checker-contract": ["writer/checker contract", "writer/checker", "writer-checker-contract"],
  "state-transitions": ["state transitions", "state-transitions", "state transition"],
  "reuse-refutation": ["reuse refutation", "reuse-refutation"],
  "method-trustworthiness": ["method trustworthiness", "method-trustworthiness"],
});

/** The bucket a finding with NO `domain` field lands in. Its OWN value — never folded into a domain,
 *  and never `none` (which would read as "this domain has no coverage" rather than "this finding was
 *  never classified"). */
export const UNCLASSIFIED = "unclassified";

/** The three coverage grades, strongest first. */
export const GRADES = Object.freeze(["autonomous", "assisted", "none"]);

/** The origins that make a finding AUTONOMOUS work — the system found it with no human in the loop. */
export const AUTONOMOUS_ORIGINS = Object.freeze(["autonomous-routine", "autonomous-experiment"]);

/** The evidence levels that make an autonomous finding DISCOVERY rather than transcription. `teaching`
 *  (the answer was known) and `transfer` (learned on one case, applied to a second) are both excluded —
 *  ⛔ THIS is the map's anti-inflation line, and the AC3 mutation control removes exactly this clause. */
export const AUTONOMOUS_EVIDENCE_LEVELS = Object.freeze(["independent", "production-open"]);

/** The operation that PRODUCED a finding, per origin — the Plan's "verifier call, routine probe,
 *  instrument". Derived from the origin, which is itself a validated ingest field; the concrete
 *  operation a row names is its `origin_ref` (a runId#findingId, an E-… cluster, a tool name, a task). */
export const ORIGIN_OPERATIONS = Object.freeze({
  "autonomous-routine": "routine-probe",
  "autonomous-experiment": "verifier-call",
  "mechanical-instrument": "instrument",
  operator: "operator-work",
  user: "user-report",
});

/** Human rating vocabulary. `noise` is the value that SUBTRACTS from value — it is why a rating can
 *  never be inferred: only a human can say "this was real, but worthless". */
export const RATING_VALUES = Object.freeze(["high", "medium", "low", "noise"]);

/** The ONLY actor that may write a human rating. `task-worker` is refused (see the header). */
export const RATING_ACTORS = Object.freeze(["operator-session"]);

/** Per-input required fields. `method_ref` / `fix_task` / `human_rating` / `domain` are required to be
 *  PRESENT but may be `null` — "no method", "no fix filed", "unrated" and "never classified" are VALUES,
 *  not missing keys (硬规则 6). `domain_reason` travels with a non-null `domain` (see `validateFindingInput`). */
export const REQUIRED_INPUT_FIELDS = Object.freeze([
  "finding_id", "origin", "origin_ref", "evidence_level", "method_ref", "claim", "outcome",
  "fix_task", "human_rating", "domain", "domain_reason",
]);

/** Every field of a STORED record. The derived ones (`fix_landed_commit`, `recurred`, `cost`,
 *  `duplicate_of`) are present here too — validation on read-back must see them. */
export const REQUIRED_RECORD_FIELDS = Object.freeze([
  ...REQUIRED_INPUT_FIELDS,
  "components", "origin_carrier", "fix_landed_commit", "fix_landed_reason",
  "recurred", "recurred_reason", "cost", "cost_reason", "duplicate_of", "ts",
]);

/** The `false` in a git subject that marks a task done: the driver writes `tasks: 翻 <id> done（…）`.
 *  `\b` on both sides so `abandoned`/`done-ness` cannot match. */
export const DONE_SUBJECT_RE = /\bdone\b/;

/** The default branch the landing is read from. Overridable per call (a fixture repo names its own). */
export const DEFAULT_LANDING_BRANCH = "develop";

/** The gateway endpoint the RATES come from — the Plan names it, and it is the same source the method
 *  regression report's cost table reads. The rates are never hardcoded here. */
export const GATEWAY_INFO_URL = "http://127.0.0.1:26510/model_group/info";

/** Where the gateway key lives. The file is a shell SNIPPET (`# comment` + `export K="sk-…"`), so the
 *  token is EXTRACTED — piping it raw into a header splits the request (measured, regression report). */
export const DEFAULT_GATEWAY_KEY_FILE = "~/.local/etc/fjdac-api-key";
export const API_KEY_RE = /(sk-[A-Za-z0-9_-]{8,})/;

/** The finding id / component-set vocabulary bounds. A record with no components cannot be compared for
 *  duplication, so its duplicate status is its own value (`null`-free: the record says `components: []`
 *  and the duplicate rule is stated over possibly-empty sets — see `sameComponentSet`). */
const isStr = (x, n = 1) => typeof x === "string" && x.trim().length >= n;
const isObj = (x) => x !== null && typeof x === "object" && !Array.isArray(x);
const isBool = (x) => typeof x === "boolean";
const supplied = (o, k) => Object.prototype.hasOwnProperty.call(o, k) && o[k] !== undefined;
const strArr = (x) => Array.isArray(x) && x.every((s) => isStr(s, 1));
const nonWs = (s) => String(s ?? "").replace(/\s+/g, "").length;
const round6 = (n) => Math.round(n * 1e6) / 1e6;

/** Absolute path of the portfolio carrier under the SHARED checkout (`null` when unresolvable — its OWN
 *  value, never "an empty portfolio" that would let a write land in the caller's worktree). */
export const portfolioFile = (root) => carrierFile(root, PORTFOLIO_REL);

/** Deterministic id, keyed on the FINDING (its natural key, `finding_id`), so a re-ingest of the same
 *  finding is a `DUPLICATE_ID` no-op rather than a second record that inflates every count. `ts` is
 *  deliberately NOT in the key: two ingests of one finding differ only by the clock, and a clock is not
 *  an identity. */
export const findingRecordId = (rec) => recordId(PORTFOLIO_KIND, { finding_id: String(rec?.finding_id ?? "") });

// ── component sets (the thing a duplicate is judged over) ────────────────────────────────────────

/** `plugin/scripts/x.ts:88` and `plugin/scripts/x.ts` are the SAME component: the line suffix a routine
 *  finding carries (`files: ["…/task-schema.ts:88"]`) is a location, not an identity. */
export const componentOf = (s) => String(s ?? "").trim().replace(/:\d+(-\d+)?$/, "");

/** Normalize a component list: line suffixes stripped, deduplicated, sorted. Sorted so "the same set
 *  written in another order" is the same value (a duplicate check must not depend on input order). */
export const normalizeComponents = (xs) =>
  [...new Set((Array.isArray(xs) ? xs : []).filter((c) => isStr(c, 1)).map(componentOf))].sort();

/** Set equality over normalized component lists — possibly empty on both sides (two findings about
 *  nothing in particular, with the same claim, are still the same finding). */
export function sameComponentSet(a, b) {
  const A = normalizeComponents(a), B = normalizeComponents(b);
  return A.length === B.length && A.every((x, i) => x === B[i]);
}

/** A claim's identity for the duplicate rule: whitespace collapsed, lowercased. A duplicate is the same
 *  claim about the same components — not necessarily the same bytes. */
export const normalizeClaim = (s) => String(s ?? "").trim().replace(/\s+/g, " ").toLowerCase();

// ── validation (PURE — a malformed candidate is REPORTED, never accepted by default) ─────────────

/**
 * Validate a CALLER's finding INPUT. PURE. Distinct codes so "the caller forgot a field" can never
 * collapse into "the record was fine but the write failed" (硬规则 3b).
 * @returns {{ok:boolean, reasons:string[]}}
 */
export function validateFindingInput(rec) {
  if (!isObj(rec)) return { ok: false, reasons: ["RECORD_NOT_OBJECT"] };
  const reasons = [];
  for (const f of REQUIRED_INPUT_FIELDS) if (!supplied(rec, f)) reasons.push(`SCHEMA_MISSING:${f}`);
  if (reasons.length) return { ok: false, reasons };

  if (!isStr(rec.finding_id, 1)) reasons.push("FIELD_INVALID:finding_id");
  if (!ORIGINS.includes(rec.origin)) reasons.push(`ORIGIN_NOT_IN_VOCAB:${String(rec.origin)}`);
  if (!isStr(rec.origin_ref, 1)) reasons.push("FIELD_INVALID:origin_ref");
  if (!EVIDENCE_LEVELS.includes(rec.evidence_level)) {
    reasons.push(`EVIDENCE_LEVEL_NOT_IN_VOCAB:${String(rec.evidence_level)}`);
  }
  if (!isStr(rec.claim, 8)) reasons.push("FIELD_INVALID:claim");
  if (!OUTCOMES.includes(rec.outcome)) reasons.push(`OUTCOME_NOT_IN_VOCAB:${String(rec.outcome)}`);
  if (rec.method_ref !== null && !isStr(rec.method_ref, 1)) reasons.push("FIELD_INVALID:method_ref");
  if (rec.fix_task !== null && !isStr(rec.fix_task, 1)) reasons.push("FIELD_INVALID:fix_task");
  // ⛔ The domain is STATED, never inferred (Plan 2): a value outside the six the user named is refused
  // (a seventh bucket nothing reads), and a stated domain must carry its reason — a bare label is an
  // assertion, while a label with a reason is a judgment a reader can re-examine (硬规则 4).
  if (rec.domain !== null && !DOMAINS.includes(rec.domain)) reasons.push(`DOMAIN_NOT_IN_VOCAB:${String(rec.domain)}`);
  if (rec.domain !== null && !isStr(rec.domain_reason, 1)) {
    reasons.push("DOMAIN_REASON_REQUIRED:a-stated-domain-must-carry-the-reason-it-was-classed-that-way");
  }
  if (rec.domain === null && rec.domain_reason !== null) {
    reasons.push("DOMAIN_REASON_WITHOUT_DOMAIN:a-reason-for-not-classifying-is-not-a-classification");
  }
  if (rec.components !== undefined && !strArr(rec.components)) {
    reasons.push("FIELD_INVALID:components-needs-[non-empty-string]");
  }
  if (rec.usage !== undefined && rec.usage !== null && !isObj(rec.usage)) reasons.push("FIELD_INVALID:usage");
  // ⛔ A rating is NOT a property of the finding record. Letting ingest carry one would make a
  // worker-authored "human rating" indistinguishable from a real one on read-back — the exact defect the
  // Experience ledger's `authored_by` axis was added for. Ratings have their own line and their own gate.
  if (rec.human_rating !== null) {
    reasons.push("RATING_AT_INGEST_NOT_ALLOWED:human_rating-is-written-only-through-rateFinding");
  }
  return { ok: reasons.length === 0, reasons };
}

/**
 * Validate a COMPLETE stored record. PURE. Used on read-back and on the fully-derived candidate, so a
 * record that reaches the carrier can never be one this module would refuse to read.
 * @returns {{ok:boolean, reasons:string[]}}
 */
export function validateFindingRecord(rec) {
  if (!isObj(rec)) return { ok: false, reasons: ["RECORD_NOT_OBJECT"] };
  const reasons = [];
  for (const f of REQUIRED_RECORD_FIELDS) if (!supplied(rec, f)) reasons.push(`SCHEMA_MISSING:${f}`);
  if (reasons.length) return { ok: false, reasons };
  reasons.push(...validateFindingInput(rec).reasons.filter((r) => !r.startsWith("SCHEMA_MISSING:")));

  if (!strArr(rec.components)) reasons.push("FIELD_INVALID:components-needs-[non-empty-string]");
  if (!isStr(rec.origin_carrier, 1)) reasons.push("FIELD_INVALID:origin_carrier");
  if (rec.fix_landed_commit !== null && !isStr(rec.fix_landed_commit, 1)) reasons.push("FIELD_INVALID:fix_landed_commit");
  if (rec.fix_landed_reason !== null && !isStr(rec.fix_landed_reason, 1)) reasons.push("FIELD_INVALID:fix_landed_reason");
  if (rec.recurred !== null && !isBool(rec.recurred)) reasons.push("FIELD_INVALID:recurred");
  if (rec.recurred_reason !== null && !isStr(rec.recurred_reason, 1)) reasons.push("FIELD_INVALID:recurred_reason");
  if (rec.duplicate_of !== null && !isStr(rec.duplicate_of, 1)) reasons.push("FIELD_INVALID:duplicate_of");
  if (!isStr(rec.ts, 4)) reasons.push("FIELD_INVALID:ts");
  if (rec.cost !== null) {
    if (!isObj(rec.cost)) reasons.push("FIELD_INVALID:cost");
    else {
      for (const k of ["model_calls", "input_tokens", "output_tokens"]) {
        if (!Number.isFinite(rec.cost[k])) reasons.push(`FIELD_INVALID:cost.${k}`);
      }
      if (!Number.isFinite(rec.cost.usd_gateway)) reasons.push("FIELD_INVALID:cost.usd_gateway");
    }
    // A cost ALWAYS explains itself: `cost:null` with a reason is a reading; a computed number with no
    // basis is an assertion. The two travel together.
    if (!isStr(rec.cost_reason, 1)) reasons.push("FIELD_INVALID:cost_reason");
  }
  return { ok: reasons.length === 0, reasons };
}

// ── derivation 1: the fix's landing, read from git ──────────────────────────────────────────────

/** `git -C <root> log <branch> --format=… -- <path>` → parsed commits. Never throws: a repo that cannot
 *  be read is reported, because "no done commit" and "could not look" are different answers. */
function gitLogCommits(root, branch, relPath) {
  const r = spawnSync("git", ["-C", root, "log", branch, "--format=%H%x1f%ct%x1f%s", "--", relPath], { encoding: "utf8" });
  if (r.error) return { ok: false, reason: `GIT_NOT_RUNNABLE:${r.error.code ?? r.error.message}` };
  if (r.status !== 0) return { ok: false, reason: `GIT_LOG_FAILED:exit-${r.status}` };
  const commits = String(r.stdout ?? "").split("\n").filter(Boolean).map((l) => {
    const [sha, ct, subject] = l.split("\x1f");
    return { sha, committed_at: Number(ct), subject };
  });
  return { ok: true, commits };
}

/**
 * The LAST `<branch>` commit on `tasks/<fix_task>.md` whose subject marks the task done.
 * @returns {{ok:true, commit:string|null, committed_at:number|null, subject:string|null, reason:string}
 *          |{ok:false, reason:string}}
 *   `ok:true, commit:null` means "looked, no done commit" (its own value); `ok:false` means "could not
 *   look" — the caller turns that into a null commit WITH the git reason, never into "not landed".
 */
export function deriveFixLandedCommit(root, fix_task, { branch = DEFAULT_LANDING_BRANCH } = {}) {
  if (!isStr(fix_task, 1)) return { ok: true, commit: null, committed_at: null, subject: null, reason: "NO_FIX_TASK" };
  const rel = `tasks/${fix_task}.md`;
  const log = gitLogCommits(root, branch, rel);
  if (!log.ok) return log;
  const hit = log.commits.find((c) => DONE_SUBJECT_RE.test(c.subject ?? ""));
  if (!hit) return { ok: true, commit: null, committed_at: null, subject: null, reason: `NO_DONE_COMMIT_ON_${branch}_FOR_${rel}` };
  return { ok: true, commit: hit.sha, committed_at: hit.committed_at, subject: hit.subject, reason: `DONE_SUBJECT_ON_${branch}:${rel}` };
}

// ── derivation 2: recurrence, read from the evidence store ──────────────────────────────────────

/**
 * Did the SAME component set come back in a LATER evidence-store outcome?
 *
 * `null` is its own value: an unreadable store, or a finding whose component set is unknown, means the
 * question could not be asked — which must never be shaped like "asked, and nothing recurred" (硬规则 3b).
 *
 * @param {string} root @param {object} args `{components, since}` — `since` is an ISO timestamp; the
 *   recurrence must be strictly later than it (the caller composes it: the fix's landing time when the
 *   fix landed, else the origin record's own time).
 * @returns {{recurred:boolean|null, reason:string, evidence_outcome_ids:string[]}}
 */
export function deriveRecurred(root, { components = [], since = null } = {}) {
  const comps = normalizeComponents(components);
  if (comps.length === 0) return { recurred: null, reason: "NO_COMPONENT_SET", evidence_outcome_ids: [] };
  if (!isStr(since, 4)) return { recurred: null, reason: "NO_SINCE_TIMESTAMP", evidence_outcome_ids: [] };
  const rr = resolveCarrierRoot(root);
  if (!rr.ok) return { recurred: null, reason: `EVIDENCE_STORE_UNRESOLVED:${rr.reason}`, evidence_outcome_ids: [] };
  const file = path.join(rr.root, EVIDENCE_STORE_REL);
  if (!fs.existsSync(file)) return { recurred: null, reason: "EVIDENCE_STORE_ABSENT", evidence_outcome_ids: [] };
  const { records, malformed_lines } = readRecords(file);
  if (malformed_lines > 0) {
    return { recurred: null, reason: `EVIDENCE_STORE_PARTIAL:${malformed_lines}-unparseable-line(s)`, evidence_outcome_ids: [] };
  }
  const sinceMs = Date.parse(since);
  if (!Number.isFinite(sinceMs)) return { recurred: null, reason: "NO_SINCE_TIMESTAMP", evidence_outcome_ids: [] };
  const set = new Set(comps);
  const hits = records.filter((r) => isObj(r) && r.kind === "outcome" && r.verdict === "supported" &&
    Number.isFinite(Date.parse(r.ts)) && Date.parse(r.ts) > sinceMs &&
    normalizeComponents(r.subject_files).some((c) => set.has(c)));
  return {
    recurred: hits.length > 0,
    reason: hits.length > 0 ? `LATER_SUPPORTED_OUTCOME_ON_SAME_COMPONENTS:${hits.length}` : "NO_LATER_OUTCOME_ON_SAME_COMPONENTS",
    evidence_outcome_ids: hits.map((h) => h.id).filter((x) => isStr(x, 1)),
  };
}

// ── derivation 3: cost, from recorded usage × the gateway's published rates ─────────────────────

/** Read the API key out of the shell snippet. Fail-closed: an absent/unreadable file, or one with no
 *  token, is reported — never an empty key that would be sent and 400 (硬规则 3b). */
export function readGatewayKey(keyFile = DEFAULT_GATEWAY_KEY_FILE) {
  const file = String(keyFile).startsWith("~") ? path.join(os.homedir(), String(keyFile).slice(1)) : String(keyFile);
  try {
    const m = API_KEY_RE.exec(fs.readFileSync(file, "utf8"));
    if (!m) return { ok: false, reason: `GATEWAY_KEY_NOT_FOUND:${file}` };
    return { ok: true, key: m[1], file };
  } catch (e) {
    return { ok: false, reason: `GATEWAY_KEY_UNREADABLE:${file}:${e?.code ?? e?.message ?? "unknown"}` };
  }
}

/**
 * Pull one model group's rates out of the gateway's own `/model_group/info` response. PURE.
 * @returns {{ok:true, rates:{model_group:string,input_cost_per_token:number,output_cost_per_token:number}}
 *          |{ok:false, reason:string}}
 */
export function gatewayRatesFromResponse(json, modelGroup) {
  const rows = Array.isArray(json?.data) ? json.data : null;
  if (!rows) return { ok: false, reason: "GATEWAY_RESPONSE_NOT_LIST" };
  const row = rows.find((r) => isObj(r) && r.model_group === modelGroup);
  if (!row) return { ok: false, reason: `MODEL_GROUP_NOT_IN_GATEWAY_RESPONSE:${String(modelGroup)}` };
  if (!Number.isFinite(row.input_cost_per_token) || !Number.isFinite(row.output_cost_per_token)) {
    return { ok: false, reason: `MODEL_GROUP_RATES_MISSING:${String(modelGroup)}` };
  }
  return {
    ok: true,
    rates: {
      model_group: modelGroup,
      input_cost_per_token: row.input_cost_per_token,
      output_cost_per_token: row.output_cost_per_token,
    },
  };
}

const ratesCache = new Map();

/**
 * Fetch the rates for `modelGroup` from the gateway. Memoized per (url, modelGroup) for the process —
 * a 13-row backfill must not make 13 HTTP calls for four distinct rate rows.
 * ⛔ `modelGroup` is REQUIRED: the gateway publishes a different rate per group, so a default here would
 * be a host-shaped literal masquerading as the rate (硬规则 4 推论二). Absent ⇒ its own refusal.
 */
export function loadGatewayRates({ url = GATEWAY_INFO_URL, keyFile = DEFAULT_GATEWAY_KEY_FILE, modelGroup, timeoutMs = 8000 } = {}) {
  if (!isStr(modelGroup, 1)) return { ok: false, reason: "MODEL_GROUP_NOT_SPECIFIED" };
  const ck = `${url}|${modelGroup}`;
  if (ratesCache.has(ck)) return ratesCache.get(ck);
  const key = readGatewayKey(keyFile);
  const out = !key.ok ? key : (() => {
    const r = spawnSync("curl", ["-s", "-m", String(Math.ceil(timeoutMs / 1000)),
      "-H", `Authorization: Bearer ${key.key}`, url], { encoding: "utf8", maxBuffer: 8 * 1024 * 1024 });
    if (r.error) return { ok: false, reason: `GATEWAY_UNREACHABLE:${r.error.code ?? r.error.message}` };
    if (r.status !== 0) return { ok: false, reason: `GATEWAY_CURL_EXITED:${r.status}` };
    let json;
    try { json = JSON.parse(String(r.stdout ?? "")); } catch { return { ok: false, reason: "GATEWAY_RESPONSE_NOT_JSON" }; }
    return gatewayRatesFromResponse(json, modelGroup);
  })();
  ratesCache.set(ck, out);
  return out;
}

/**
 * Compute the gateway-billed USD for one recorded usage block. PURE.
 *
 * `usd = billed_input × input_cost_per_token + output_tokens × output_cost_per_token`, where
 * `billed_input = input_tokens + cache_read_tokens + cache_creation_tokens` — the cache tokens are
 * BILLED as input, so excluding them understates the cost by ~8x on cache-heavy runs (measured in
 * `discovery-method-regression-report.md`). The formula is shared with that report on purpose.
 *
 * @returns {{ok:true, cost:{model_calls:number,input_tokens:number,output_tokens:number,usd_gateway:number,
 *            model_group:string,billed_input_tokens:number}}
 *          |{ok:false, reason:string}}
 */
export function deriveCost(usage, rates) {
  if (!isObj(usage)) return { ok: false, reason: "USAGE_NOT_RECORDED" };
  if (!isObj(rates)) return { ok: false, reason: "GATEWAY_RATES_UNAVAILABLE" };
  if (!isStr(usage.model_group, 1)) return { ok: false, reason: "USAGE_MODEL_GROUP_MISSING" };
  if (usage.model_group !== rates.model_group) {
    return { ok: false, reason: `USAGE_MODEL_GROUP_MISMATCH:${usage.model_group}-vs-rates-${rates.model_group}` };
  }
  for (const k of ["model_calls", "input_tokens", "output_tokens"]) {
    if (!Number.isFinite(usage[k]) || usage[k] < 0) return { ok: false, reason: `USAGE_INVALID:${k}` };
  }
  const cacheRead = Number.isFinite(usage.cache_read_tokens) ? usage.cache_read_tokens : 0;
  const cacheCreate = Number.isFinite(usage.cache_creation_tokens) ? usage.cache_creation_tokens : 0;
  const billed = usage.input_tokens + cacheRead + cacheCreate;
  return {
    ok: true,
    cost: {
      model_calls: usage.model_calls,
      input_tokens: cacheRead || cacheCreate ? billed : usage.input_tokens,
      output_tokens: usage.output_tokens,
      usd_gateway: round6(billed * rates.input_cost_per_token + usage.output_tokens * rates.output_cost_per_token),
      model_group: usage.model_group,
      billed_input_tokens: billed,
    },
  };
}

// ── origin_ref resolution (Plan 5: "Every row must resolve its origin_ref in a real carrier or task,
//    else it is refused") ────────────────────────────────────────────────────────────────────────

/** Read a JSONL carrier at the SHARED checkout, reporting unreadable/absent/partial distinctly. */
function readSharedJsonl(root, rel) {
  const rr = resolveCarrierRoot(root);
  if (!rr.ok) return { ok: false, reason: `SHARED_ROOT_UNRESOLVED:${rr.reason}` };
  const file = path.join(rr.root, rel);
  if (!fs.existsSync(file)) return { ok: false, reason: `CARRIER_ABSENT:${rel}` };
  const { records, malformed_lines } = readRecords(file);
  if (malformed_lines > 0) return { ok: false, reason: `CARRIER_PARTIAL:${rel}:${malformed_lines}-unparseable` };
  return { ok: true, records, file };
}

const ROUTINE_FINDINGS_REL = ".quay/routine-findings.jsonl";
const EXPERIENCE_LEDGER_REL = ".quay/discovery-experience-ledger.jsonl";
const CATALOG_DECLARATIONS_REL = "plugin/scripts/capability-catalog-declarations.json";
const REPO_ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..", "..");

/**
 * The open-ended semantic discovery routine's carrier, and the PREFIX its `record_id`s carry.
 *
 * ⛔ The prefix is not decoration: an `autonomous-routine` ref is otherwise resolved against
 * `.quay/routine-findings.jsonl` alone, and a bare `<ts>#<n>` would be tried there first and could in
 * principle collide. A ref that names its own carrier is decidable without a search order.
 *
 * ⛔ THE TWO LITERALS ARE OWNED ELSEWHERE — `plugin/scripts/open-semantic-discovery-routine.ts` mints
 * every `record_id` with this prefix, and `docs/carrier-registry.json` declares the carrier. They are
 * repeated here because this module must not import the routine (the routine already imports THIS one at
 * runtime, so the reverse edge would be a cycle). The agreement is not left to a comment: the routine's
 * own test asserts that `resolveOriginRef` resolves the exact `record_id` the routine writes.
 */
const OPEN_DISCOVERY_CARRIER_REL = ".quay/open-semantic-discovery-findings.jsonl";
const OPEN_DISCOVERY_REF_PREFIX = "open-semantic-discovery@";
const OPEN_DISCOVERY_CLUSTER_KIND = "cluster";

/**
 * The cross-project dogfood routine's carrier and ref prefix — the SECOND `autonomous-routine` origin
 * that is not `.quay/routine-findings.jsonl`.
 *
 * Same rule as above, one carrier over: a ref that names its own carrier is decidable without a search
 * order. ⛔ Measured 2026-10-13: without this arm, EVERY confirmed cross-project finding was refused at
 * ingestion with `ORIGIN_REF_UNRESOLVED:…-names-no-record-in-.quay/routine-findings.jsonl` — a routine
 * whose whole product is a Portfolio row could not write one, and the failure named the WRONG carrier,
 * so it read like a data problem rather than a missing branch here.
 *
 * ⛔ The two literals are OWNED by `plugin/scripts/cross-project-dogfood-routine.ts` (it mints every
 * `record_id`, and `docs/carrier-registry.json` declares the carrier). They are repeated here because
 * this module must not import the routine — the routine imports THIS one at runtime, so the reverse edge
 * would be a cycle. The agreement is not left to a comment: the routine's own test asserts that
 * `resolveOriginRef` resolves the exact `record_id` the routine writes.
 */
const CROSS_PROJECT_CARRIER_REL = ".quay/cross-project-dogfood-findings.jsonl";
const CROSS_PROJECT_REF_PREFIX = "cross-project-dogfood@";
const CROSS_PROJECT_CLUSTER_KIND = "dogfood-cluster";

/**
 * Does `tasks/<id>.md` exist on `branch`? A task id resolves an operator/user finding the same way the
 * landing is read — from git, not from the working tree (a worktree may be mid-edit).
 */
export function taskExistsOnBranch(root, task_id, { branch = DEFAULT_LANDING_BRANCH } = {}) {
  if (!isStr(task_id, 1)) return false;
  const r = spawnSync("git", ["-C", root, "cat-file", "-e", `${branch}:tasks/${task_id}.md`], { encoding: "utf8" });
  return r.status === 0;
}

/**
 * Resolve a finding's `origin_ref` in a REAL carrier, per origin. Returns the carrier's own components
 * when it has them (so the duplicate set is read off the carrier rather than asserted).
 *
 * ⛔ Each arm says WHICH carrier resolved and refuses with the reason it did not — an unresolvable ref is
 * never silently accepted as "no origin" (硬规则 5/3b).
 * @returns {{ok:true, carrier:string, ref:string, ts:string|null, components:string[]}
 *          |{ok:false, reason:string}}
 */
export function resolveOriginRef(root, { origin, origin_ref }) {
  const ref = String(origin_ref ?? "");
  if (!isStr(ref, 1)) return { ok: false, reason: "ORIGIN_REF_EMPTY" };

  if (origin === "autonomous-routine") {
    // The open-ended semantic discovery routine's own carrier, selected by the ref's own prefix so the
    // resolution does not depend on a search order (see the constants' note). Its cluster records are
    // addressed by their `record_id`, which IS this ref.
    if (ref.startsWith(OPEN_DISCOVERY_REF_PREFIX)) {
      const c = readSharedJsonl(root, OPEN_DISCOVERY_CARRIER_REL);
      if (!c.ok) return { ok: false, reason: c.reason };
      const hit = c.records.find((r) => isObj(r) && r.kind === OPEN_DISCOVERY_CLUSTER_KIND && r.record_id === ref);
      if (!hit) return { ok: false, reason: `ORIGIN_REF_UNRESOLVED:${ref}-names-no-record-in-${OPEN_DISCOVERY_CARRIER_REL}` };
      return { ok: true, carrier: OPEN_DISCOVERY_CARRIER_REL, ref, ts: isStr(hit.ts, 4) ? hit.ts : null, components: normalizeComponents(hit.components) };
    }
    // The cross-project dogfood routine's own carrier, selected the same way (by the ref's own prefix).
    if (ref.startsWith(CROSS_PROJECT_REF_PREFIX)) {
      const c = readSharedJsonl(root, CROSS_PROJECT_CARRIER_REL);
      if (!c.ok) return { ok: false, reason: c.reason };
      const hit = c.records.find((r) => isObj(r) && r.kind === CROSS_PROJECT_CLUSTER_KIND && r.record_id === ref);
      if (!hit) return { ok: false, reason: `ORIGIN_REF_UNRESOLVED:${ref}-names-no-record-in-${CROSS_PROJECT_CARRIER_REL}` };
      return { ok: true, carrier: CROSS_PROJECT_CARRIER_REL, ref, ts: isStr(hit.ts, 4) ? hit.ts : null, components: normalizeComponents(hit.components) };
    }
    const c = readSharedJsonl(root, ROUTINE_FINDINGS_REL);
    if (!c.ok) return { ok: false, reason: c.reason };
    const [runId, findingId] = ref.includes("#") ? ref.split("#") : [ref, null];
    const hit = findingId
      ? c.records.find((r) => r.runId === runId && r.findingId === findingId)
      : c.records.find((r) => r.runId === runId && r.kind === "scan-round");
    if (!hit) return { ok: false, reason: `ORIGIN_REF_UNRESOLVED:${ref}-names-no-record-in-${ROUTINE_FINDINGS_REL}` };
    return { ok: true, carrier: ROUTINE_FINDINGS_REL, ref, ts: isStr(hit.ts, 4) ? hit.ts : null, components: normalizeComponents(hit.files) };
  }

  if (origin === "autonomous-experiment") {
    const c = readSharedJsonl(root, EXPERIENCE_LEDGER_REL);
    if (!c.ok) return { ok: false, reason: c.reason };
    const hit = c.records.find((r) => isObj(r) && r.kind === "experience" &&
      (r.case_id === ref || (typeof r.summary === "string" && r.summary.includes(ref))));
    if (!hit) return { ok: false, reason: `ORIGIN_REF_UNRESOLVED:${ref}-names-no-Experience-in-${EXPERIENCE_LEDGER_REL}` };
    return { ok: true, carrier: EXPERIENCE_LEDGER_REL, ref, ts: isStr(hit.ts, 4) ? hit.ts : null, components: normalizeComponents(hit.components) };
  }

  if (origin === "mechanical-instrument") {
    // A tool name is real exactly when the capability catalog declares it (the same single source the
    // method registry validates its `operation.tools` against).
    let parsed;
    try { parsed = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, CATALOG_DECLARATIONS_REL), "utf8")); }
    catch (e) { return { ok: false, reason: `CATALOG_UNREADABLE:${e?.code ?? e?.message ?? "unknown"}` }; }
    const names = Object.keys(isObj(parsed?.QUESTION) ? parsed.QUESTION : {});
    if (names.length === 0) return { ok: false, reason: "CATALOG_EMPTY" };
    if (!names.includes(ref)) return { ok: false, reason: `ORIGIN_REF_UNRESOLVED:${ref}-is-not-a-${CATALOG_DECLARATIONS_REL}-entry` };
    return { ok: true, carrier: CATALOG_DECLARATIONS_REL, ref, ts: null, components: [] };
  }

  // operator | user — an evidence-store record the system later recorded, an Experience that recorded
  // the report, or a task id on `develop`. A user's own words live in a conversation, not in a carrier;
  // what IS resolvable is the record where the system later wrote that report down, and that record's
  // `components` are the finding's subject — so the ref names the record, not the conversation.
  if (origin === "operator" || origin === "user") {
    if (/^(outcome|evidence|experiment|hypothesis|counterexample|repair_attempt)-/.test(ref)) {
      const c = readSharedJsonl(root, EVIDENCE_STORE_REL);
      if (!c.ok) return { ok: false, reason: c.reason };
      const hit = c.records.find((r) => isObj(r) && r.id === ref);
      if (!hit) return { ok: false, reason: `ORIGIN_REF_UNRESOLVED:${ref}-names-no-record-in-${EVIDENCE_STORE_REL}` };
      return { ok: true, carrier: EVIDENCE_STORE_REL, ref, ts: isStr(hit.ts, 4) ? hit.ts : null, components: normalizeComponents(hit.subject_files) };
    }
    if (/^EXP-/.test(ref)) {
      const c = readSharedJsonl(root, EXPERIENCE_LEDGER_REL);
      if (!c.ok) return { ok: false, reason: c.reason };
      const hit = c.records.find((r) => isObj(r) && r.kind === "experience" && r.case_id === ref);
      if (!hit) return { ok: false, reason: `ORIGIN_REF_UNRESOLVED:${ref}-names-no-Experience-in-${EXPERIENCE_LEDGER_REL}` };
      return { ok: true, carrier: EXPERIENCE_LEDGER_REL, ref, ts: isStr(hit.ts, 4) ? hit.ts : null, components: normalizeComponents(hit.components) };
    }
    if (taskExistsOnBranch(root, ref)) {
      return { ok: true, carrier: `tasks/${ref}.md`, ref, ts: null, components: taskTouchesOnBranch(root, ref) };
    }
    return { ok: false, reason: `ORIGIN_REF_UNRESOLVED:${ref}-names-no-${EVIDENCE_STORE_REL}-record-no-${EXPERIENCE_LEDGER_REL}-Experience-and-no-task-on-${DEFAULT_LANDING_BRANCH}` };
  }

  return { ok: false, reason: `ORIGIN_NOT_IN_VOCAB:${String(origin)}` };
}

/** The `## Touches` file list of a task, read from `branch` (the carrier's own view of its components).
 *  Parsed LINE-WISE: a lazy `[\s\S]*?` lookahead terminates on the first empty-ish position and returns
 *  an empty section, which reads exactly like a task that declares no Touches — 硬规则 3b, a parser that
 *  cannot read its input must not look like one that read it and found nothing. */
export function taskTouchesOnBranch(root, task_id, { branch = DEFAULT_LANDING_BRANCH } = {}) {
  const r = spawnSync("git", ["-C", root, "show", `${branch}:tasks/${task_id}.md`], { encoding: "utf8", maxBuffer: 8 * 1024 * 1024 });
  if (r.status !== 0) return [];
  const lines = String(r.stdout ?? "").split("\n");
  const start = lines.findIndex((l) => /^##\s+Touches\s*$/.test(l));
  if (start < 0) return [];
  const out = [];
  for (let i = start + 1; i < lines.length; i++) {
    if (/^##\s/.test(lines[i])) break;
    const t = lines[i].replace(/^\s*[-*]\s*/, "").trim();
    if (t) out.push(t);
  }
  return normalizeComponents(out);
}

// ── ingest ──────────────────────────────────────────────────────────────────────────────────────

/** The finding whose component set AND claim match this one, if any earlier record does. */
export function findDuplicate(earlier, { components, claim }) {
  return (Array.isArray(earlier) ? earlier : []).find((r) =>
    isObj(r) && r.duplicate_of === null && sameComponentSet(r.components, components) &&
    normalizeClaim(r.claim) === normalizeClaim(claim)) ?? null;
}

/**
 * Derive every value-relevant field of ONE finding and append it. NOTHING derived is taken from the
 * caller: a supplied `fix_landed_commit` / `cost` / `recurred` that disagrees with the derivation is a
 * REFUSAL (`DERIVED_DISAGREES`), and on ANY refusal nothing is written and no field is defaulted.
 *
 * @param {string} root @param {object} input @param {object} [opts]
 * @param {string} [opts.branch]         the branch the fix landing is read from
 * @param {object} [opts.rates]          pre-fetched gateway rates `{model_group, input_..., output_...}`
 * @param {string} [opts.keyFile] @param {string} [opts.gatewayUrl]
 * @returns {{ok:true, id, file, record, appended:true} | {ok:false, reasons:string[], appended:false}}
 */
export function ingestFinding(root, input, opts = {}) {
  const v = validateFindingInput(input);
  if (!v.ok) return { ok: false, kind: PORTFOLIO_KIND, appended: false, reasons: v.reasons };

  const read = readPortfolio(root);
  if (read.file === null) return { ok: false, kind: PORTFOLIO_KIND, appended: false, reasons: [read.reason] };
  if (!read.ok) {
    return {
      ok: false, kind: PORTFOLIO_KIND, appended: false,
      reasons: [`PORTFOLIO_UNREADABLE:${read.malformed_lines}-unparseable-line(s)-in-${PORTFOLIO_REL}`],
    };
  }

  const reasons = [];
  const resolved = resolveOriginRef(root, input);
  if (!resolved.ok) reasons.push(resolved.reason);
  if (reasons.length) return { ok: false, kind: PORTFOLIO_KIND, appended: false, reasons };

  const components = input.components !== undefined ? normalizeComponents(input.components) : resolved.components;

  // (1) the landing, from git
  const landed = deriveFixLandedCommit(root, input.fix_task, { branch: opts.branch ?? DEFAULT_LANDING_BRANCH });
  if (!landed.ok) reasons.push(landed.reason);
  const fixLandedCommit = landed.ok ? landed.commit : null;
  const fixLandedReason = landed.ok ? landed.reason : String(landed.reason);
  if (supplied(input, "fix_landed_commit") && input.fix_landed_commit !== fixLandedCommit) {
    reasons.push(`DERIVED_DISAGREES:fix_landed_commit:caller=${String(input.fix_landed_commit)}-git=${String(fixLandedCommit)}`);
  }
  if (reasons.length) return { ok: false, kind: PORTFOLIO_KIND, appended: false, reasons };

  // (2) recurrence, from the evidence store — measured from the LATER of "the fix landed" and "the
  // finding's origin was recorded", because "did it come back" only means something after both.
  const sinceCandidates = [landed.committed_at ? new Date(landed.committed_at * 1000).toISOString() : null, resolved.ts]
    .filter((x) => isStr(x, 4)).sort();
  const since = sinceCandidates.length ? sinceCandidates[0] : null;
  const rec = deriveRecurred(root, { components, since });
  if (supplied(input, "recurred") && input.recurred !== rec.recurred) {
    reasons.push(`DERIVED_DISAGREES:recurred:caller=${String(input.recurred)}-derived=${String(rec.recurred)}`);
  }

  // (3) cost, from recorded usage × the gateway's published rates
  let cost = null, costReason = "NO_USAGE_RECORDED";
  if (isObj(input.usage)) {
    let rates = opts.rates;
    if (rates === undefined) {
      const g = loadGatewayRates({ url: opts.gatewayUrl, keyFile: opts.keyFile, modelGroup: input.usage.model_group });
      rates = g.ok ? g.rates : null;
      if (!g.ok) costReason = g.reason;
    }
    const d = deriveCost(input.usage, rates);
    if (d.ok) { cost = d.cost; costReason = `GATEWAY_RATES:${d.cost.model_group}`; }
    else if (d.reason !== "GATEWAY_RATES_UNAVAILABLE") costReason = d.reason;
  }
  if (supplied(input, "cost")) {
    const same = isObj(input.cost) && isObj(cost) && input.cost.usd_gateway === cost.usd_gateway;
    if (!same || (input.cost === null) !== (cost === null)) {
      reasons.push(`DERIVED_DISAGREES:cost:caller=${JSON.stringify(input.cost ?? null)}-derived=${JSON.stringify(cost)}`);
    }
  }
  if (reasons.length) return { ok: false, kind: PORTFOLIO_KIND, appended: false, reasons };

  // (4) the duplicate rule, over the records already in the carrier
  let duplicateOf = null;
  if (supplied(input, "duplicate_of") && input.duplicate_of !== null) {
    const known = read.records.some((r) => r.finding_id === input.duplicate_of) ||
      taskExistsOnBranch(root, input.duplicate_of, { branch: opts.branch ?? DEFAULT_LANDING_BRANCH });
    if (!known) reasons.push(`DUPLICATE_OF_UNRESOLVED:${input.duplicate_of}`);
    duplicateOf = input.duplicate_of;
  } else {
    duplicateOf = findDuplicate(read.records, { components, claim: input.claim })?.finding_id ?? null;
  }
  if (reasons.length) return { ok: false, kind: PORTFOLIO_KIND, appended: false, reasons };

  const record = {
    finding_id: input.finding_id,
    origin: input.origin,
    origin_ref: input.origin_ref,
    origin_carrier: resolved.carrier,
    evidence_level: input.evidence_level,
    method_ref: input.method_ref ?? null,
    claim: input.claim,
    components,
    outcome: input.outcome,
    fix_task: input.fix_task ?? null,
    domain: input.domain ?? null,
    domain_reason: input.domain_reason ?? null,
    fix_landed_commit: fixLandedCommit,
    fix_landed_reason: fixLandedReason,
    recurred: rec.recurred,
    recurred_reason: rec.reason,
    human_rating: null,
    cost,
    cost_reason: costReason,
    duplicate_of: duplicateOf,
    ts: opts.ts ?? new Date().toISOString(),
  };
  const full = validateFindingRecord(record);
  if (!full.ok) return { ok: false, kind: PORTFOLIO_KIND, appended: false, reasons: full.reasons };
  const withId = { id: input.id ?? findingRecordId(record), ...record };
  return appendCarrierLine(root, PORTFOLIO_REL, withId, { kind: PORTFOLIO_KIND });
}

// ── human ratings (Plan 6) ──────────────────────────────────────────────────────────────────────

/**
 * Write a HUMAN rating for one finding. The finding's own line is never rewritten: the rating is a
 * separate append-only line, applied on read (last write wins), so the ledger keeps every rating ever
 * made and "when was this rated, and by whom" is answerable.
 *
 * ⛔ `actor` — the PROCESS writing, not a claim in free text — must be `operator-session`. A task worker
 * calling this is refused with `RATING_BY_NON_HUMAN`, and an absent actor is refused with
 * `RATING_ACTOR_MISSING` (never defaulted to the human value — that default IS the defect).
 * @returns {{ok:true, id, file, record} | {ok:false, reasons:string[], appended:false}}
 */
export function rateFinding(root, { finding_id, value, by, actor, ts } = {}) {
  const reasons = [];
  if (!isStr(actor, 1)) {
    reasons.push("RATING_ACTOR_MISSING:the-process-writing-a-rating-must-identify-itself-and-only-operator-session-may-write-one");
  } else if (!RATING_ACTORS.includes(actor)) {
    reasons.push(`RATING_BY_NON_HUMAN:${actor}-cannot-speak-for-a-human`);
  }
  if (!isStr(finding_id, 1)) reasons.push("FIELD_INVALID:finding_id");
  if (!RATING_VALUES.includes(value)) reasons.push(`RATING_VALUE_NOT_IN_VOCAB:${String(value)}`);
  if (!isStr(by, 1)) reasons.push("FIELD_INVALID:by-needs-the-naming-human-session");
  if (reasons.length) return { ok: false, kind: PORTFOLIO_RATING_KIND, appended: false, reasons };

  const read = readPortfolio(root);
  if (read.file === null) return { ok: false, kind: PORTFOLIO_RATING_KIND, appended: false, reasons: [read.reason] };
  if (!read.ok) {
    return {
      ok: false, kind: PORTFOLIO_RATING_KIND, appended: false,
      reasons: [`PORTFOLIO_UNREADABLE:${read.malformed_lines}-unparseable-line(s)-in-${PORTFOLIO_REL}`],
    };
  }
  if (!read.records.some((r) => r.finding_id === finding_id)) {
    return { ok: false, kind: PORTFOLIO_RATING_KIND, appended: false, reasons: [`RATING_TARGET_NOT_FOUND:${finding_id}`] };
  }
  const record = { finding_id, value, by, actor, ts: ts ?? new Date().toISOString() };
  const withId = recordId(PORTFOLIO_RATING_KIND, record);
  return appendCarrierLine(root, PORTFOLIO_REL, { id: withId, ...record }, { kind: PORTFOLIO_RATING_KIND });
}

// ── domain assignments (the append-only overlay for findings ingested before `domain` existed) ─────

/**
 * Assign a domain to a finding that carries NONE, as its own append-only line.
 *
 * ⛔ WHY THIS EXISTS AT ALL (not a convenience): the carrier is append-only and a finding's id is keyed
 * on `finding_id`, so re-ingesting a row to add a field is a `DUPLICATE_ID` no-op by construction. The 13
 * real rows were ingested before `domain` existed; without this overlay their domains could only be
 * "recovered" by DELETING and regenerating the production carrier, or by guessing at read time. Both are
 * worse. The ratings solve the identical problem the identical way.
 *
 * ⛔ It REFUSES a finding that already states a domain in its own record (`DOMAIN_ALREADY_STATED`) rather
 * than appending a line the read path would shadow — a dead line in an append-only carrier is a
 * permanent, invisible inconsistency. The id is keyed on `finding_id` ALONE, so a re-run appends nothing
 * (`DUPLICATE_ID`) instead of stacking a second classification of the same finding.
 * @returns {{ok:true, id, file, record} | {ok:false, reasons:string[], appended:false}}
 */
export function assignFindingDomain(root, { finding_id, domain, reason, by, ts } = {}) {
  const reasons = [];
  if (!isStr(finding_id, 1)) reasons.push("FIELD_INVALID:finding_id");
  if (!DOMAINS.includes(domain)) reasons.push(`DOMAIN_NOT_IN_VOCAB:${String(domain)}`);
  if (!isStr(reason, 1)) reasons.push("FIELD_INVALID:reason-a-domain-assignment-states-why");
  if (!isStr(by, 1)) reasons.push("FIELD_INVALID:by-needs-the-namer");
  if (reasons.length) return { ok: false, kind: PORTFOLIO_DOMAIN_KIND, appended: false, reasons };

  const read = readPortfolio(root);
  if (read.file === null) return { ok: false, kind: PORTFOLIO_DOMAIN_KIND, appended: false, reasons: [read.reason] };
  if (!read.ok) {
    return {
      ok: false, kind: PORTFOLIO_DOMAIN_KIND, appended: false,
      reasons: [`PORTFOLIO_UNREADABLE:${read.malformed_lines}-unparseable-line(s)-in-${PORTFOLIO_REL}`],
    };
  }
  const target = read.records.find((r) => r.finding_id === finding_id);
  if (!target) {
    return { ok: false, kind: PORTFOLIO_DOMAIN_KIND, appended: false, reasons: [`DOMAIN_TARGET_NOT_FOUND:${finding_id}`] };
  }
  if (target.domain_source === "record") {
    return {
      ok: false, kind: PORTFOLIO_DOMAIN_KIND, appended: false,
      reasons: [`DOMAIN_ALREADY_STATED:${finding_id}-carries-domain=${target.domain}-in-its-own-record-so-an-assignment-line-would-never-be-read`],
    };
  }
  const record = { finding_id, domain, reason, by, ts: ts ?? new Date().toISOString() };
  const withId = { id: recordId(PORTFOLIO_DOMAIN_KIND, { finding_id }), ...record };
  return appendCarrierLine(root, PORTFOLIO_REL, withId, { kind: PORTFOLIO_DOMAIN_KIND });
}

// ── corrections (the append-only overlay for the fields a later check overturns) ─────────────────

/**
 * Walk a finding's `duplicate_of` chain, starting AT `start_id`. PURE.
 * @returns {{chain:string[], reached:string|null, cycle:string|null}}
 *   `chain` is the ids visited in order; `cycle` names the id that closed a loop; `reached` is the id
 *   that ended the walk (a finding with `duplicate_of === null`, or an id naming no record).
 */
export function duplicateChain(records, start_id) {
  const byId = new Map((Array.isArray(records) ? records : [])
    .filter((r) => isObj(r) && isStr(r.finding_id, 1)).map((r) => [r.finding_id, r]));
  const chain = [];
  const seen = new Set();
  let cur = isStr(start_id, 1) ? start_id : null;
  while (cur !== null) {
    if (seen.has(cur)) return { chain, reached: null, cycle: cur };
    seen.add(cur);
    chain.push(cur);
    const rec = byId.get(cur);
    cur = rec && isStr(rec.duplicate_of, 1) ? rec.duplicate_of : null;
  }
  return { chain, reached: chain.length ? chain[chain.length - 1] : null, cycle: null };
}

/** The index of a finding in LINE ORDER — the position the "an original precedes its duplicate" rule is
 *  stated over. `-1` when absent (its own value, never 0, which would silently read as "the first"). */
const lineIndexOf = (records, finding_id) => records.findIndex((r) => isObj(r) && r.finding_id === finding_id);

/**
 * Record a CORRECTION to a finding already in the carrier. ⛔ It never edits the line it corrects — a
 * separate `kind:"portfolio_correction"` line is APPENDED and `readPortfolio` folds it on read (see the
 * header). The original row stays byte-identical, and read-back reports both values.
 *
 * FAIL-CLOSED on every argument, each with its OWN reason code:
 *   • the finding must resolve (`CORRECTION_TARGET_NOT_FOUND`);
 *   • the patch must name ≥1 field from `CORRECTABLE_FIELDS`; a DERIVED field is its own refusal
 *     (`CORRECTION_DERIVED_FIELD_SUPPLIED`) because supplying one asserts a value this module reads;
 *   • `duplicate_of` must resolve to an EARLIER, non-duplicate finding, and must not close a loop
 *     (self / later / chained / cycle — four separate codes, because "you pointed at yourself" and "you
 *     pointed at a later row" need different fixes);
 *   • `fix_task` must exist on the landing branch (`CORRECTION_FIX_TASK_NOT_ON_BRANCH`). The landing
 *     ITSELF is never supplied — it is re-derived from `fix_task` on read;
 *   • `reason`, `evidence` and the writer's identity (`by` + `actor`) are all required.
 *
 * @param {string} root
 * @param {object} args `{finding_id, patch, reason, evidence, by, actor, ts}`
 * @param {object} [opts] `{branch}` — the branch `fix_task` is resolved on (default `develop`)
 * @returns {{ok:true, id, file, record, appended:true}|{ok:false, reasons:string[], appended:false,
 *            duplicate?:true}}
 */
export function correctFinding(root, { finding_id, patch, reason, evidence, by, actor, ts } = {}, opts = {}) {
  const reasons = [];
  if (!isStr(finding_id, 1)) reasons.push("FIELD_INVALID:finding_id");
  if (!isObj(patch) || Object.keys(patch).length === 0) {
    reasons.push("CORRECTION_PATCH_MISSING:patch-must-name-at-least-one-field-from-CORRECTABLE_FIELDS");
  } else {
    for (const f of Object.keys(patch)) {
      if (DERIVED_RECORD_FIELDS.includes(f)) {
        reasons.push(`CORRECTION_DERIVED_FIELD_SUPPLIED:${f}-is-read-from-its-source-and-may-not-be-supplied`);
      } else if (!CORRECTABLE_FIELDS.includes(f)) {
        reasons.push(`CORRECTION_FIELD_NOT_CORRECTABLE:${f}-may-not-be-rewritten-by-a-correction`);
      }
    }
  }
  const p = isObj(patch) ? patch : {};
  if (supplied(p, "outcome") && !OUTCOMES.includes(p.outcome)) {
    reasons.push(`CORRECTION_OUTCOME_NOT_IN_VOCAB:${String(p.outcome)}`);
  }
  if (supplied(p, "fix_task") && p.fix_task !== null && !isStr(p.fix_task, 1)) reasons.push("FIELD_INVALID:fix_task");
  if (supplied(p, "duplicate_of") && p.duplicate_of !== null && !isStr(p.duplicate_of, 1)) reasons.push("FIELD_INVALID:duplicate_of");
  if (!isStr(reason, 1) || nonWs(reason) < MIN_CORRECTION_REASON_CHARS) {
    reasons.push(`CORRECTION_REASON_INSUBSTANTIAL:needs->=${MIN_CORRECTION_REASON_CHARS}-non-whitespace-chars-explaining-why`);
  }
  if (!strArr(evidence) || evidence.length === 0) {
    reasons.push("CORRECTION_EVIDENCE_REQUIRED:needs-a-non-empty-list-of-refs-showing-why-the-correction-is-right");
  }
  if (!isStr(actor, 1)) {
    reasons.push("CORRECTION_ACTOR_MISSING:the-process-writing-a-correction-must-identify-itself");
  } else if (!CORRECTION_ACTORS.includes(actor)) {
    reasons.push(`CORRECTION_ACTOR_NOT_IN_VOCAB:${actor}`);
  }
  if (!isStr(by, 1)) reasons.push("FIELD_INVALID:by-needs-the-namer");
  if (reasons.length) return { ok: false, kind: PORTFOLIO_CORRECTION_KIND, appended: false, reasons };

  const read = readPortfolio(root);
  if (read.file === null) return { ok: false, kind: PORTFOLIO_CORRECTION_KIND, appended: false, reasons: [read.reason] };
  if (!read.ok) {
    return {
      ok: false, kind: PORTFOLIO_CORRECTION_KIND, appended: false,
      reasons: [`PORTFOLIO_UNREADABLE:${read.malformed_lines}-unparseable-line(s)-in-${PORTFOLIO_REL}`],
    };
  }
  if (!read.records.some((r) => r.finding_id === finding_id)) {
    return {
      ok: false, kind: PORTFOLIO_CORRECTION_KIND, appended: false,
      reasons: [`CORRECTION_TARGET_NOT_FOUND:${finding_id}-is-not-a-finding-in-${PORTFOLIO_REL}`],
    };
  }

  // ── the duplicate relation. The four refusals are separate codes on purpose: they need different
  //    fixes, and collapsing them would leave "pointed at yourself" indistinguishable from "pointed at a
  //    later row" in the record of what went wrong.
  if (supplied(p, "duplicate_of") && p.duplicate_of !== null) {
    const target = p.duplicate_of;
    if (!read.records.some((r) => r.finding_id === target)) {
      reasons.push(`CORRECTION_DUPLICATE_OF_UNRESOLVED:${target}-is-not-a-finding-in-${PORTFOLIO_REL}`);
    } else if (target === finding_id) {
      reasons.push(`CORRECTION_DUPLICATE_OF_SELF:${finding_id}-cannot-be-a-duplicate-of-itself`);
    } else {
      // A loop that comes back to the finding being corrected leaves a pair where NEITHER row is the
      // original. Only a hand-edited carrier can already hold such a link (both the ingest path and this
      // one refuse a forward link), and the fold must not close it.
      const walk = duplicateChain(read.records, target);
      if (walk.cycle !== null || walk.chain.includes(finding_id)) {
        const loop = walk.cycle !== null ? walk.chain.slice(walk.chain.indexOf(walk.cycle)).concat(walk.cycle).join("→") : `${finding_id}→${walk.chain.join("→")}→${finding_id}`;
        reasons.push(`CORRECTION_DUPLICATE_OF_CYCLE:${loop}-closes-a-loop-so-neither-row-would-be-the-original`);
      } else if (lineIndexOf(read.records, target) > lineIndexOf(read.records, finding_id)) {
        reasons.push(`CORRECTION_DUPLICATE_OF_NOT_EARLIER:${target}-follows-${finding_id}-in-${PORTFOLIO_REL}-and-a-duplicate-must-name-the-original-that-precedes-it`);
      } else {
        // `null` and absent are the SAME answer here ("this is not a duplicate") — unlike `valueMetrics`,
        // where an absent key would be a schema defect. A row written before this field existed is not a
        // duplicate, and refusing a correction because of it would be failing closed on the wrong thing.
        const targetDup = read.records.find((r) => r.finding_id === target)?.duplicate_of ?? null;
        if (targetDup !== null) {
          reasons.push(`CORRECTION_DUPLICATE_OF_CHAINED:${target}-is-itself-a-duplicate-of-${String(targetDup)}-so-it-is-not-an-original`);
        }
      }
    }
  }

  // ── the fix. Its LANDING is never supplied: `readPortfolio` re-derives it from this `fix_task` on
  //    every read, so a correction written before the fix landed starts counting when it lands.
  if (supplied(p, "fix_task") && p.fix_task !== null) {
    if (!taskExistsOnBranch(root, p.fix_task, { branch: opts.branch ?? DEFAULT_LANDING_BRANCH })) {
      reasons.push(`CORRECTION_FIX_TASK_NOT_ON_BRANCH:${p.fix_task}-is-not-a-task-on-${opts.branch ?? DEFAULT_LANDING_BRANCH}`);
    }
  }
  if (reasons.length) return { ok: false, kind: PORTFOLIO_CORRECTION_KIND, appended: false, reasons };

  const body = { finding_id, patch, reason, evidence, by };
  // Idempotent: the id is content-addressed over what the correction SAYS (finding, patch, reason, the
  // refs and the namer) and `ts` is deliberately EXCLUDED, so re-running a backfill appends nothing
  // (`DUPLICATE_ID`, carrier untouched) rather than stacking a second copy of one judgment.
  return appendCarrierLine(root, PORTFOLIO_REL, {
    id: recordId(PORTFOLIO_CORRECTION_KIND, body),
    ...body,
    actor,
    ts: ts ?? new Date().toISOString(),
  }, { kind: PORTFOLIO_CORRECTION_KIND });
}

/**
 * Apply the append-only CORRECTIONS to the carrier's raw records. PURE.
 *
 * Corrections merge in LINE ORDER and the last write wins **field by field** — the carrier's own order is
 * the precedence rule, and the only one, because a rule inferred from `ts` could disagree with the file
 * and there would be no way to tell which was authoritative.
 *
 * ⛔ The original finding is RETURNED PATCHED, never removed, and `corrected_from` carries the values it
 * carried before the patch. A "corrected" carrier that had simply been rewritten would be
 * indistinguishable from one that was always right — which is the whole reason a correction is a
 * separate record kind.
 * @returns {{findings:object[], corrections:object[], patches:Map<string,object>,
 *            correction_ids:Map<string,string[]>, corrected:string[], orphan_corrections:string[]}}
 *   `orphan_corrections` names corrections that correct nothing present in the carrier. They are
 *   REPORTED, never silently dropped (硬规则 5: "this correction corrected nothing" is not the same
 *   finding as "there were no corrections").
 */
export function applyPortfolioCorrections(records) {
  const findings = [], corrections = [];
  for (const r of Array.isArray(records) ? records : []) {
    if (!isObj(r)) continue;
    if (r.kind === PORTFOLIO_CORRECTION_KIND) corrections.push(r);
    else if (r.kind === PORTFOLIO_KIND) findings.push(r);
  }
  const known = new Set(findings.map((f) => f.finding_id));
  const patches = new Map();
  const correctionIds = new Map();
  const orphanCorrections = [];
  for (const c of corrections) {
    if (!isStr(c.finding_id, 1) || !isObj(c.patch)) { orphanCorrections.push(String(c.id ?? "(unnamed-correction)")); continue; }
    if (!known.has(c.finding_id)) { orphanCorrections.push(c.finding_id); continue; }
    patches.set(c.finding_id, { ...(patches.get(c.finding_id) ?? {}), ...c.patch });
    correctionIds.set(c.finding_id, [...(correctionIds.get(c.finding_id) ?? []), c.id]);
  }
  const corrected = [];
  const out = findings.map((f) => {
    const patch = patches.get(f.finding_id);
    const ids = (correctionIds.get(f.finding_id) ?? []).filter((x) => isStr(x, 1));
    if (!patch || Object.keys(patch).length === 0) {
      // No correction ever named this finding. `corrected_from: null` is its OWN value: there is no
      // original-versus-effective distinction to report, which is not the same as "the originals were
      // empty" (硬规则 3b).
      return { ...f, corrected: false, correction_ids: [], corrected_from: null };
    }
    corrected.push(f.finding_id);
    const from = {};
    for (const k of Object.keys(patch)) from[k] = supplied(f, k) ? f[k] : null;
    return { ...f, ...patch, corrected: true, correction_ids: ids, corrected_from: from };
  });
  return { findings: out, corrections, patches, correction_ids: correctionIds, corrected, orphan_corrections: orphanCorrections };
}

/** The CORRECTION lines themselves — the audit trail of what was changed, by whom, and why. */
export function readPortfolioCorrections(root) {
  const raw = readCarrier(root, PORTFOLIO_REL, null);
  const applied = applyPortfolioCorrections(raw.records);
  return { ...raw, corrections: applied.corrections, orphan_targets: applied.orphan_corrections };
}

// ── read (findings with their ratings, corrections and domain assignments applied) ───────────────

/**
 * Read the portfolio back, with the append-only RATING lines applied to the findings they name, the
 * append-only CORRECTION lines folded onto the fields they patch, and the append-only DOMAIN ASSIGNMENT
 * lines applied to findings that state none of their own.
 *
 * `domain_source` says WHICH arm supplied the domain — `"record"` (stated at ingest), `"assignment"`
 * (added later, because the record predates the field) or `null` (none, i.e. `unclassified`). The three
 * are different values on purpose: collapsing them would make "classified when it was found" and
 * "classified after the fact" indistinguishable.
 *
 * ⛔ A correction that patches `fix_task` re-runs `deriveFixLandedCommit` HERE, on every read, so a
 * corrected fix's landing is a git reading like every other landing (a correction written before the fix
 * landed starts counting when it lands). Corrections that do not touch `fix_task` leave the fields the
 * record already derived at ingest alone. The superseded values stay visible in `corrected_from`.
 * @returns {{ok:boolean, records:object[], ratings:object[], assignments:object[], corrections:object[],
 *            file:string|null, malformed_lines:number, orphan_corrections:string[]}}
 */
export function readPortfolio(root, { branch = DEFAULT_LANDING_BRANCH } = {}) {
  const raw = readCarrier(root, PORTFOLIO_REL, null);
  if (raw.file === null) {
    return { ...raw, records: [], ratings: [], assignments: [], corrections: [], orphan_corrections: [], reason: raw.reason };
  }
  const ratings = raw.records.filter((r) => isObj(r) && r.kind === PORTFOLIO_RATING_KIND);
  const byFinding = new Map();
  for (const r of ratings) byFinding.set(r.finding_id, r);   // line order is the precedence rule
  const assignments = raw.records.filter((r) => isObj(r) && r.kind === PORTFOLIO_DOMAIN_KIND);
  const domainOf = new Map();
  for (const a of assignments) domainOf.set(a.finding_id, a);   // line order is the precedence rule
  const folded = applyPortfolioCorrections(raw.records);
  const records = folded.findings.map((r) => {
    const derived = { ...r };
    // Only when the correction CHANGED the input to the derivation. Re-deriving an untouched `fix_task`
    // would be a second reading of a value the record already derived at ingest, with nothing to gain.
    if (r.corrected && supplied(folded.patches.get(r.finding_id) ?? {}, "fix_task")) {
      const landed = deriveFixLandedCommit(root, derived.fix_task, { branch });
      derived.fix_landed_commit = landed.ok ? landed.commit : null;
      derived.fix_landed_reason = landed.ok ? landed.reason : String(landed.reason);
      // …and the superseded landing stays readable, so "the fix started counting when it landed" is
      // auditable rather than an unexplained difference between the line and the folded record.
      derived.corrected_from = {
        ...derived.corrected_from,
        fix_landed_commit: supplied(r, "fix_landed_commit") ? r.fix_landed_commit : null,
        fix_landed_reason: supplied(r, "fix_landed_reason") ? r.fix_landed_reason : null,
      };
    }
    const rating = byFinding.get(r.finding_id);
    const stated = isStr(derived.domain, 1) ? derived.domain : null;
    const assigned = stated ? null : domainOf.get(r.finding_id);
    return {
      ...derived,
      domain: stated ?? (assigned && isStr(assigned.domain, 1) ? assigned.domain : null),
      domain_reason: stated ? (derived.domain_reason ?? null) : (assigned?.reason ?? null),
      domain_source: stated ? "record" : (assigned ? "assignment" : null),
      human_rating: rating ? { value: rating.value, by: rating.by, ts: rating.ts } : null,
    };
  });
  return { ...raw, records, ratings, assignments, corrections: folded.corrections, orphan_corrections: folded.orphan_corrections };
}

// ── the value metric (Plan 4) ───────────────────────────────────────────────────────────────────

/**
 * THE metric. PURE.
 *
 * `net_new_value.total` counts records that are `supported` ∧ fix LANDED ∧ `duplicate_of === null` ∧
 * `human_rating.value !== "noise"`. Finding count and supported count are returned ONLY under
 * `context` — they are the numbers this metric exists to stop being the headline. Every exclusion is
 * listed by finding id so a count can always be decomposed back into the records it came from.
 *
 * `human_rating` is `null` (unrated) for every record no human has rated; unrated is NOT noise, and is
 * NOT evidence of value either — it is counted in `unrated` so "11 valuable, 11 unrated" cannot be read
 * as "11 confirmed valuable".
 */
export function valueMetrics(records) {
  const list = (Array.isArray(records) ? records : []).filter(isObj);
  const ids = (rs) => rs.map((r) => r.finding_id).filter((x) => isStr(x, 1));

  const supported = list.filter((r) => r.outcome === "supported");
  const refuted = list.filter((r) => r.outcome === "refuted");
  const landed = (r) => isStr(r.fix_landed_commit, 1);
  const rating = (r) => (isObj(r.human_rating) ? r.human_rating.value : null);
  const auditable = (r) => r.duplicate_of === null && rating(r) !== "noise";

  // ⛔ THE ANTI-INFLATION LINE. `landed(r)` is what makes this "value" and not "activity": drop it and
  // the metric counts the SUPPORTED FINDINGS, which is the number a discovery loop can grow without
  // landing anything — the mutation control in the test flips exactly this clause and case (g) goes red.
  const valuable = (r) => r.outcome === "supported" && landed(r) && auditable(r);
  const valued = list.filter(valuable);

  const by_origin = {};
  for (const r of valued) by_origin[r.origin] = (by_origin[r.origin] ?? 0) + 1;

  const measured = list.filter((r) => isObj(r.cost));
  const unmeasured = list.filter((r) => !isObj(r.cost));
  const usd = measured.reduce((s, r) => s + (Number.isFinite(r.cost.usd_gateway) ? r.cost.usd_gateway : 0), 0);
  const perValueReason = valued.length === 0 ? "NO_VALUABLE_FINDINGS"
    : measured.length === 0 ? "NO_MEASURED_COST" : null;

  return {
    ok: true,
    evaluated: list.length,
    // CONTEXT ONLY — never the headline (Plan 4). A finding count is not value.
    context: { findings: list.length, supported: supported.length },
    net_new_value: { total: valued.length, by_origin, finding_ids: ids(valued) },
    // Explicit zero/negative value, listed so it can never be quietly dropped from a report.
    zero_or_negative: {
      refuted: ids(refuted),
      noise_rated: ids(list.filter((r) => rating(r) === "noise")),
      duplicates: ids(list.filter((r) => r.duplicate_of !== null)),
      supported_but_not_landed: ids(supported.filter((r) => !landed(r) && auditable(r))),
    },
    ratings: {
      rated: list.filter((r) => isObj(r.human_rating)).length,
      unrated: list.filter((r) => !isObj(r.human_rating)).length,
    },
    cost: {
      measured: measured.length,
      unmeasured: unmeasured.length,
      unmeasured_finding_ids: ids(unmeasured),
      usd_gateway_total: measured.length ? round6(usd) : null,
      cost_per_valuable_finding: perValueReason === null ? round6(usd / valued.length) : null,
      cost_per_valuable_finding_reason: perValueReason,
    },
  };
}

// ── the capability coverage map (Plan (B)) ──────────────────────────────────────────────────────

/**
 * Does a METHOD's `applicability` text claim `domain`? PURE. Returns the matched spelling or `null`.
 *
 * The rule is a literal NAME match over `domain_signals` + `preconditions` — the only non-guessing rule
 * available, because those fields are free prose. A method claims a domain by naming it; nothing is
 * inferred from the rest of the sentence.
 */
export function methodClaimsDomain(rec, domain) {
  const aliases = DOMAIN_NAME_ALIASES[domain] ?? [];
  const text = [rec?.applicability?.domain_signals, rec?.applicability?.preconditions]
    .flatMap((x) => (Array.isArray(x) ? x : [])).join("\n").toLowerCase();
  return aliases.find((a) => text.includes(a.toLowerCase())) ?? null;
}

/** The method statuses that contribute NO coverage. `retired` is the registry's own "stop applying
 *  this". Every OTHER declared status is a method the system may still apply (`active`) or is still
 *  validating (`draft`, and `trial` when the registry gains it) ⇒ it can lift a domain to `assisted`,
 *  never to `autonomous` (which needs a finding, not a method).
 *  ⛔ A status outside `METHOD_STATUSES` contributes NOTHING — `methodTrust` reports it as `null` with
 *  `STATUS_NOT_IN_VOCAB`, so a status this reader cannot classify is never silently counted as fine
 *  (硬规则 3b). */
export const NON_CONTRIBUTING_METHOD_STATUSES = Object.freeze(["retired"]);

/**
 * A method's TRUST state for coverage purposes. PURE. A method contributes coverage only while it is
 * neither `retired` nor on the contaminated-verdict ledger (Plan 4) — a retired method is one the
 * registry itself says to stop applying, and a contaminated one rests on a judgment made on a hold-out
 * that had already been used. `contaminated` is `false` only when a deny-list was SUPPLIED and the
 * method's promoting verdict was not on it; with no list (`null`/absent ids) that is its own value.
 */
export function methodTrust(rec, { contaminatedVerdictIds: ids = null } = {}) {
  const status = METHOD_STATUSES.includes(rec?.status) ? rec.status : null;
  const verdictRef = isStr(rec?.generalization_evidence?.verdict_ref, 1) ? rec.generalization_evidence.verdict_ref : null;
  const onContaminatedList = Array.isArray(ids) && verdictRef !== null && ids.includes(verdictRef);
  return {
    method_id: isStr(rec?.method_id, 1) ? rec.method_id : null,
    version: Number.isInteger(rec?.version) ? rec.version : null,
    status,
    verdict_ref: verdictRef,
    contaminated: onContaminatedList,
    contributes: status !== null && !NON_CONTRIBUTING_METHOD_STATUSES.includes(status) && !onContaminatedList,
    why: status === null ? "STATUS_NOT_IN_VOCAB"
      : onContaminatedList ? "CONTAMINATED_PROMOTION"
        : NON_CONTRIBUTING_METHOD_STATUSES.includes(status) ? "RETIRED"
          : `CONTRIBUTES:${status}`,
  };
}

/**
 * Does ONE finding count as AUTONOMOUS coverage of its domain? PURE.
 *
 * Two arms, reported apart so neither can be read as the other:
 *   • `landed-fix` — a supported autonomous finding whose fix landed: capability AND value;
 *   • `refutation` — an autonomous REFUTATION: capability WITHOUT value. It is counted here and in
 *     `valueMetrics.zero_or_negative.refuted` at the same time, on purpose: "the system autonomously
 *     killed a false claim" is a real capability, and it is not a landed fix. A domain whose point IS
 *     refutation (reuse refutation) would be structurally uncoverable if this arm did not exist.
 *
 * ⛔ A DUPLICATE is refused: it is not a new finding at all, it is the same finding recorded twice, so it
 * demonstrates nothing the original does not already demonstrate (and the original is counted where it
 * belongs). ⛔ A `noise` RATING is NOT refused, and that asymmetry is deliberate: "worthless" is a VALUE
 * judgment a human makes about a real finding, and value lives in `valueMetrics` — where a noise rating
 * does subtract. Refusing it here as well would silently turn a value axis into a capability axis and
 * lose the information that the system did, autonomously, find a real thing.
 * ⛔ THE ANTI-INFLATION CLAUSE: `teaching` and `transfer` are refused for this grade, so a case whose
 * answer was known before any tool ran can never make a domain look autonomously covered.
 * @returns {{autonomous:boolean, via:string|null, reason:string}}
 */
export function autonomousEvidenceFor(rec) {
  if (!isObj(rec)) return { autonomous: false, via: null, reason: "RECORD_NOT_OBJECT" };
  if (!AUTONOMOUS_ORIGINS.includes(rec.origin)) return { autonomous: false, via: null, reason: `ORIGIN_NOT_AUTONOMOUS:${String(rec.origin)}` };
  if (!AUTONOMOUS_EVIDENCE_LEVELS.includes(rec.evidence_level)) {
    return { autonomous: false, via: null, reason: `EVIDENCE_LEVEL_NOT_AUTONOMOUS:${String(rec.evidence_level)}` };
  }
  if (rec.duplicate_of !== null && rec.duplicate_of !== undefined) {
    return { autonomous: false, via: null, reason: `DUPLICATE_OF:${String(rec.duplicate_of)}` };
  }
  if (rec.outcome === "supported" && isStr(rec.fix_landed_commit, 1)) {
    return { autonomous: true, via: "landed-fix", reason: `SUPPORTED_AND_LANDED_ON_${String(rec.fix_landed_commit)}` };
  }
  if (rec.outcome === "refuted") return { autonomous: true, via: "refutation", reason: "AUTONOMOUS_CORRECT_REFUTATION" };
  if (rec.outcome === "supported") return { autonomous: false, via: null, reason: "SUPPORTED_WITHOUT_LANDED_FIX" };
  return { autonomous: false, via: null, reason: `OUTCOME_NOT_AUTONOMOUS:${String(rec.outcome)}` };
}

const countBy = (xs, key) => xs.reduce((acc, x) => {
  const k = isStr(x?.[key], 1) ? x[key] : "unknown";
  acc[k] = (acc[k] ?? 0) + 1;
  return acc;
}, {});

/** One domain's row. PURE. */
function coverageRowFor(domain, findings, methods, { methodsEvaluated }) {
  const evidence = findings.map((f) => ({ finding_id: f.finding_id, ...autonomousEvidenceFor(f) }));
  const autonomous = evidence.filter((e) => e.autonomous);
  // A DUPLICATE is not a new finding, so it is reported but grades nothing — including for `assisted`,
  // where counting it would let a re-stated finding cover a second domain.
  const duplicates = findings.filter((f) => f.duplicate_of !== null && f.duplicate_of !== undefined);
  const fresh = findings.filter((f) => f.duplicate_of === null || f.duplicate_of === undefined);
  const claiming = methods.filter((m) => m.claims.includes(domain));
  const contributing = claiming.filter((m) => m.contributes);
  // `autonomous` needs a qualifying FINDING. A method is reusable capability, not demonstrated coverage:
  // it can lift a row to `assisted`, never to `autonomous`.
  const grade = autonomous.length > 0 ? "autonomous"
    : fresh.length > 0 || contributing.length > 0 ? "assisted" : "none";
  const blockers = evidence.filter((e) => !e.autonomous).map((e) => `${e.finding_id}=${e.reason}`);
  return {
    domain,
    label: DOMAIN_LABELS[domain] ?? domain,
    grade,
    grade_reason: autonomous.length > 0
      ? autonomous.map((e) => `${e.finding_id}(${e.via})`).join(",")
      : [
        fresh.length === 0 ? "NO_NEW_FINDING_CLASSED_TO_THIS_DOMAIN" : `NO_AUTONOMOUS_FINDING:${blockers.filter((b) => !b.includes("=DUPLICATE_OF:")).join(";")}`,
        duplicates.length > 0 ? `${duplicates.length}-DUPLICATE(S)-ADD-NOTHING` : null,
        contributing.length > 0 ? `${contributing.length}-CONTRIBUTING-METHOD(S)-ONLY` : null,
        methodsEvaluated ? null : "METHOD_HALF_NOT_EVALUATED",
      ].filter(Boolean).join("+"),
    findings: {
      total: findings.length,
      by_origin: countBy(findings, "origin"),
      by_evidence_level: countBy(findings, "evidence_level"),
      ids: findings.map((f) => f.finding_id).filter((x) => isStr(x, 1)),
      autonomous_ids: autonomous.map((e) => e.finding_id),
      duplicates: duplicates.map((f) => f.finding_id).filter((x) => isStr(x, 1)),
      not_autonomous: evidence.filter((e) => !e.autonomous).map((e) => ({ finding_id: e.finding_id, reason: e.reason })),
    },
    // "the operations that produced them": the concretely named origin_ref (a runId#findingId, an
    // E-… cluster, a tool name, a task id) under the operation class its origin implies.
    operations: findings.map((f) => ({
      finding_id: f.finding_id,
      operation: ORIGIN_OPERATIONS[f.origin] ?? "unknown",
      origin: f.origin,
      origin_ref: f.origin_ref ?? null,
      origin_carrier: f.origin_carrier ?? null,
    })),
    methods: {
      claiming: claiming.map((m) => ({
        method_id: m.method_id, version: m.version, status: m.status,
        contaminated: m.contaminated, contributes: m.contributes, why: m.why,
      })),
      contributing_count: contributing.length,
    },
  };
}

/**
 * THE capability coverage map (Plan (B)). DERIVED on every call from `.quay/discovery-portfolio.jsonl`
 * and the method registry — nothing is stored, so no grade can be stale with respect to its records.
 *
 * ⛔ EVERY "could not look" IS ITS OWN VALUE (硬规则 3b, and the reason this function is not a one-liner):
 *   • an unresolvable shared checkout / a carrier with unparseable lines ⇒ `ok:false`, `evaluated:false`
 *     and NO domains. A grade computed from a partially-read ledger is a fabrication, not a partial
 *     answer.
 *   • an unreadable method registry or an unreadable contaminated-verdict deny-list ⇒ the FINDING half
 *     still stands (`ok:true`) but `methods.evaluated:false` and every row carries
 *     `METHOD_HALF_NOT_EVALUATED`. An unreadable deny-list must never read as "nothing is contaminated",
 *     and an unreadable registry must never read as "no method claims this domain".
 *   • a finding that states no domain ⇒ the `unclassified` bucket, with the domains it actually carried
 *     when it carried an unknown one. Never guessed, never folded into a domain, never `none`.
 *
 * @param {string} root
 * @param {object} [opts]
 * @param {object} [opts.registry]      a `readMethodRegistry(root)` value (read here by default)
 * @param {object} [opts.contaminated]  a `contaminatedVerdictIds(root)` value (read here by default)
 * @returns {{ok:boolean, evaluated:boolean, file:string|null, malformed_lines:number, reason:string|null,
 *            domains:object[], unclassified:object|null, gap:string[]|null, methods:object, context:object}}
 */
export function coverageMap(root, { registry = null, contaminated = null } = {}) {
  const empty = { domains: [], unclassified: null, gap: null };
  const read = readPortfolio(root);
  if (read.file === null) {
    return { ok: false, evaluated: false, file: null, malformed_lines: 0, reason: read.reason, ...empty };
  }
  if (!read.ok) {
    return {
      ok: false, evaluated: false, file: read.file, malformed_lines: read.malformed_lines,
      reason: `PORTFOLIO_UNREADABLE:${read.malformed_lines}-unparseable-line(s)-in-${PORTFOLIO_REL}`, ...empty,
    };
  }

  const reg = registry ?? readMethodRegistry(root);
  const cont = contaminated ?? contaminatedVerdictIds(root);
  const contaminatedIds = cont.ok ? cont.ids : null;
  const methodsEvaluated = reg.ok === true && cont.ok === true;
  const methodsReason = methodsEvaluated ? null
    : !reg.ok
      ? `METHOD_REGISTRY_UNREADABLE:${reg.malformed_lines ?? 0}-unparseable-line(s)-so-which-methods-are-retired-or-contaminated-cannot-be-determined`
      : cont.reason;
  const methods = (reg.ok ? reg.latest : []).map((m) => ({
    ...methodTrust(m, { contaminatedVerdictIds: contaminatedIds }),
    claims: DOMAINS.filter((d) => methodClaimsDomain(m, d) !== null),
  }));

  const domains = DOMAINS.map((d) =>
    coverageRowFor(d, read.records.filter((r) => r.domain === d), methods, { methodsEvaluated }));

  const unclassifiedRecords = read.records.filter((r) => !DOMAINS.includes(r.domain));
  const unclassified = {
    grade: UNCLASSIFIED,
    total: unclassifiedRecords.length,
    by_origin: countBy(unclassifiedRecords, "origin"),
    by_evidence_level: countBy(unclassifiedRecords, "evidence_level"),
    ids: unclassifiedRecords.map((r) => r.finding_id).filter((x) => isStr(x, 1)),
    // A row with NO domain and a row carrying a domain outside the vocabulary are different causes
    // (硬规则 3b: "never classified" must not absorb "carries something this reader cannot read").
    carried_domain: unclassifiedRecords.filter((r) => r.domain !== null).map((r) => ({ finding_id: r.finding_id, domain: r.domain })),
  };

  return {
    ok: true,
    evaluated: methodsEvaluated,
    file: read.file,
    malformed_lines: read.malformed_lines,
    reason: methodsReason,
    domains,
    unclassified,
    // The gap list is the NAMED domains that are not autonomously covered. `unclassified` is deliberately
    // not in it: it is a data-quality signal about the ledger, not a capability gap of the system.
    gap: domains.filter((r) => r.grade !== "autonomous").map((r) => r.domain),
    methods: {
      evaluated: methodsEvaluated,
      reason: methodsReason,
      evaluated_count: methods.length,
      contaminated_verdicts_evaluated: cont.ok ? contaminatedIds.length : null,
      ledger: CONTAMINATED_VERDICTS_REL,
    },
    context: {
      findings: read.records.length,
      classified: read.records.length - unclassifiedRecords.length,
      assignments: read.assignments.length,
    },
  };
}

// ── the 2026-10-12 backfill (Plan 5) ────────────────────────────────────────────────────────────
//
// The 13 REAL rows of the operator reconstruction at
// `/data/home/yale/work/quay-scratch/portfolio-demo/{REPORT.md,rows.tsv}` (read-only, no model calls),
// embedded here because that path is a scratch directory outside the repo: a baseline that only exists
// in someone's scratch is not a source (硬规则 5). Each row names a real `origin_ref` that resolves in a
// real carrier, and the two fields the reconstruction could not measure (`human_rating`, `cost`) are
// left at their honest values — `null` — rather than filled in.
//
// ORIGIN CLASSES (the reconstruction's finer labels → this module's five):
//   autonomous-routine (F01–F03, production `semantic-dedup-scan` run, no human prompt)
//     → `autonomous-routine`, evidence_level `production-open`.
//   autonomous blind experiment (F04, F05, F06, N01)
//     → `autonomous-experiment`, evidence_level `independent`.
//   operator-led / operator production reading (F07–F09, F11) → `operator`.
//   mechanical instrument (F10, pre-existing `KNOWN_DRIFT`) → `mechanical-instrument`.
//   user (F12) → `user`.
// EVIDENCE LEVELS: an operator investigation whose answer was known before it ran is `teaching`; a blind
// investigator's finding is `independent`; a routine/instrument reading of the open production surface
// is `production-open`. These are the reconstruction's classifications mapped to the enum — they are
// JUDGMENTS, and they are not used by `net_new_value`, so they cannot move the value number.
//
// DOMAINS: the reconstruction's own `dimension` column (REPORT.md), one per row, carried here with the
// reason it was classed that way. ⛔ The column is TRANSCRIBED, not re-derived: the operator made these
// judgments on 2026-10-12 and they are the only source for them. This column is what makes the coverage
// map possible at all — a finding whose domain is guessed from its claim is exactly what Plan 2 forbids.
// Each row's `domain_reason` cites the row's own evidence so a reader can re-examine the call.
export const REAL_BACKFILL_ROWS_2026_10_12 = Object.freeze([
  { finding_id: "F01", origin: "autonomous-routine", origin_ref: "semantic-dedup-scan-1791733865369#doc-check-cache-vs-scoped-gate-cache", evidence_level: "production-open", method_ref: null, claim: "duplicated cache read/write authority (doc-check-cache vs scoped-gate cache in worker-fan-in)", outcome: "supported", fix_task: "gap-routine-semantic-dedup-scan-doc-check-cache-vs-scoped-gate-cache", human_rating: null, domain: "writer-checker-contract", domain_reason: "baseline dimension 'writer/checker contract': the same cache has a writer (doc-check-cache) and a different checker (the scoped-gate cache), i.e. two de-facto owners of one contract" },
  { finding_id: "F02", origin: "autonomous-routine", origin_ref: "semantic-dedup-scan-1791733865369#isDirectInvocation-pair", evidence_level: "production-open", method_ref: null, claim: "byte-identical isDirectInvocation copies in config-wiring-check and drivable-workspace-check", outcome: "supported", fix_task: "gap-routine-semantic-dedup-scan-isdirectinvocation-pair", human_rating: null, domain: "shared-semantics", domain_reason: "baseline dimension 'shared semantics': one semantic (isDirectInvocation) declared twice byte-identically, with no single owner" },
  { finding_id: "F03", origin: "autonomous-routine", origin_ref: "semantic-dedup-scan-1791733865369#splitArgs-isNonNegInt-trio", evidence_level: "production-open", method_ref: null, claim: "splitArgs/isNonNegInt trio duplicated across three drivers", outcome: "supported", fix_task: "gap-routine-semantic-dedup-scan-splitargs-isnonnegint-trio", human_rating: null, domain: "shared-semantics", domain_reason: "baseline dimension 'shared semantics': the same two helpers declared in three drivers rather than shared" },
  { finding_id: "F04", origin: "autonomous-experiment", origin_ref: "E-DT-1-Hp cluster 11", evidence_level: "independent", method_ref: null, claim: "two lock-hold pairers with different keys and a double-acquire policy", outcome: "supported", fix_task: "gap-fan-in-lock-hold-pairing-two-divergent-keys", human_rating: null, domain: "shared-semantics", domain_reason: "baseline dimension 'shared semantics': two implementations of one pairing semantic whose keys disagree" },
  { finding_id: "F05", origin: "autonomous-experiment", origin_ref: "E-HYPGEN-AB-1-B cluster 8", evidence_level: "independent", method_ref: null, claim: "REQUIRED_FIELDS declared separately in the per-task suite-record writer and its checker", outcome: "supported", fix_task: "gap-per-task-suite-record-required-fields-declared-twice", human_rating: null, domain: "writer-checker-contract", domain_reason: "baseline dimension 'writer/checker contract': the writer and its checker each declare the record's required fields, so the two can drift" },
  { finding_id: "F06", origin: "autonomous-experiment", origin_ref: "E-HYPGEN-ACCEPT-1 cluster 5", evidence_level: "independent", method_ref: null, claim: "NOT-EVALUATED exit 2/3 split; a malformed ac69 record passes the static gate", outcome: "supported", fix_task: "gap-ac69-malformed-record-exits-3-and-passes-the-static-gate", human_rating: null, domain: "shared-semantics", domain_reason: "baseline dimension 'shared semantics': NOT-EVALUATED is spelled as exit 2 in one place and 3 in another, so a malformed record satisfies the static gate" },
  { finding_id: "F07", origin: "operator", origin_ref: "gap-routine-quota-window-ms-parsed-but-inert", evidence_level: "teaching", method_ref: null, claim: "routine_quota.window_ms is parsed but never consumed", outcome: "supported", fix_task: "gap-routine-quota-window-ms-parsed-but-inert", human_rating: null, domain: "config-to-behavior", domain_reason: "baseline dimension 'config→behavior': a config key is parsed and stored but nothing reads it, so the config does not change behaviour" },
  { finding_id: "F08", origin: "operator", origin_ref: "gap-errorsignature-merges-different-exit-codes", evidence_level: "teaching", method_ref: null, claim: "errorSignature merges exit codes 137/124/1 into one signature", outcome: "supported", fix_task: "gap-errorsignature-merges-different-exit-codes", human_rating: null, domain: "shared-semantics", domain_reason: "baseline dimension 'shared semantics': one signature function is the single shared meaning of three distinct exit codes" },
  { finding_id: "F09", origin: "operator", origin_ref: "EXP-99aa24ac34d53b6a", evidence_level: "teaching", method_ref: null, claim: "the meta-driver owner search caps before filtering by status, and admits null evidence", outcome: "supported", fix_task: "gap-meta-driver-admission-gates-pass-when-they-cannot-know", human_rating: null, domain: "state-transitions", domain_reason: "baseline dimension 'state/admission': the defect is in an admission gate that lets a record through when it cannot know the record's state, i.e. a state transition that should not have been allowed" },
  { finding_id: "F10", origin: "mechanical-instrument", origin_ref: "enum-surface-parity-check.ts", evidence_level: "production-open", method_ref: null, claim: "goal needs-human is missing from three goal surfaces (pre-existing KNOWN_DRIFT)", outcome: "supported", fix_task: "gap-goal-needs-human-missing-from-three-goal-surfaces", human_rating: null, domain: "shared-semantics", domain_reason: "baseline dimension 'shared semantics': one needs-human state is declared across three surfaces and one of them lacks it, so the surfaces disagree on what the state is",
    // The catalog entry resolves the INSTRUMENT, not the subject: a "which surfaces" finding carries no
    // subject files in the catalog, so the three surfaces the instrument flagged are named here — read
    // off the fix task's own `## Touches`, not invented.
    components: ["packages/quay/src/serve-goal.ts", "packages/quay/src/mcp-handlers.ts", "packages/quay-native/src/mcp-server.ts"] },
  { finding_id: "F11", origin: "operator", origin_ref: "gap-in-round-suite-rerun-never-executed-in-production", evidence_level: "production-open", method_ref: null, claim: "the in-round suite rerun command is never declared, so the mechanism never ran in production", outcome: "supported", fix_task: "gap-in-round-suite-rerun-never-executed-in-production", human_rating: null, domain: "config-to-behavior", domain_reason: "baseline dimension 'config→behavior': the mechanism depends on a declaration that no config supplies, so the declared behaviour was never produced" },
  { finding_id: "F12", origin: "user", origin_ref: "EXP-99aa24ac34d53b6a", evidence_level: "teaching", method_ref: null, claim: "probe-routine and the meta-driver duplicate identity, dedup and quota; missed by nine blind runs", outcome: "supported", fix_task: null, human_rating: null, domain: "shared-semantics", domain_reason: "baseline dimension 'shared semantics': identity, dedup and quota are implemented once in each of two routines instead of one shared implementation" },
  { finding_id: "N01", origin: "autonomous-experiment", origin_ref: "E-HYPGEN-ACCEPT-1 cluster 7", evidence_level: "independent", method_ref: null, claim: "claimed independent Touches parsers refuted: all of them import touches-parser.ts", outcome: "refuted", fix_task: null, human_rating: null, domain: "reuse-refutation", domain_reason: "baseline dimension 'reuse refutation': the finding IS the refutation of a claimed independent-reimplementation — the parsers all import the shared module, so the reuse claim was false" },
]);

/**
 * Ingest the frozen reconstruction, one row at a time, reporting every refusal instead of stopping at
 * the first — a partially-ingested baseline must be VISIBLE as one. The duplicate rule runs for real
 * (no bypass): the 13 rows must show up as 13 distinct findings, and that is a property of the data, not
 * of a flag passed here.
 *
 * ⛔ The DOMAIN is ensured separately from the ingest, and that separation is forced by the carrier:
 *   the 13 rows were ingested before `domain` existed, a finding's id is keyed on `finding_id`, so
 *   re-ingesting one to add the field is a `DUPLICATE_ID` no-op. The domain therefore arrives as its
 *   own append-only line (`assignFindingDomain`), which a re-run appends at most once per finding. A row
 *   that DOES state a domain in its own record needs no line — the native field wins.
 * @returns {{ok:boolean, ingested:string[], already_present:string[], refused:{finding_id,reasons:string[]}[],
 *            domains_assigned:string[], result:object}}
 */
export function backfill(root, rows = REAL_BACKFILL_ROWS_2026_10_12, opts = {}) {
  const ingested = [], already_present = [], refused = [], domains_assigned = [];
  for (const row of rows) {
    const r = ingestFinding(root, row, opts);
    // A `DUPLICATE_ID` refusal is the append-only carrier saying "this finding is already recorded":
    // re-running the backfill appends nothing and is not an error state (the ledger's own model). It is
    // reported SEPARATELY from a real refusal — "already there" and "would not go in" are different.
    if (r.ok) ingested.push(row.finding_id);
    else if (r.duplicate === true) already_present.push(row.finding_id);
    else refused.push({ finding_id: row.finding_id, reasons: r.reasons });
  }
  const stored = new Map(readPortfolio(root).records.map((r) => [r.finding_id, r]));
  for (const row of rows) {
    if (!DOMAINS.includes(row.domain)) continue;
    const rec = stored.get(row.finding_id);
    if (!rec || isStr(rec.domain, 1)) continue;   // absent (refused) or already classed
    const a = assignFindingDomain(root, {
      finding_id: row.finding_id, domain: row.domain, reason: row.domain_reason,
      by: opts.domainBy ?? "backfill:REAL_BACKFILL_ROWS_2026_10_12",
    });
    if (a.ok || a.duplicate === true) domains_assigned.push(row.finding_id);
    else refused.push({ finding_id: row.finding_id, reasons: a.reasons });
  }
  return {
    ok: refused.length === 0, ingested, already_present, domains_assigned, refused,
    result: valueMetrics(readPortfolio(root).records),
  };
}
