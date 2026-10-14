#!/usr/bin/env node
// DISCOVERY EXPERIENCE LEDGER — ONE ledger of "Experience", fed by TWO sources.
//
// Phase 1 of the self-bootstrapping Discovery Method loop. Method Learning must NEVER be triggered
// only by a human pointing something out: every Finding the SYSTEM itself produces (supported,
// refuted, fixed, undetermined-then-confirmed, recurred-after-fix) must feed the SAME reflection
// entry point a human-flagged miss feeds. So user feedback and self-discovery are two SOURCES of
// one thing — "Experience" — not two flows:
//
//   • the MANUAL source   (`ingestFeedback`,        `reported_by:"user"`)   — a human flagged a miss;
//   • the AUTOMATIC source (`ingestFromEvidenceStoreOutcome`, `reported_by:"system"`) — the load-
//     bearing half: it converts an EXISTING `architecture-evidence-store.jsonl` outcome record into
//     an Experience entry with no hand-narration, so a future, never-yet-seen self-discovery becomes
//     learnable material without a human curation step.
//
// ⛔ WHY THIS IS NOT THE EVIDENCE STORE (scope check, so this does not duplicate it):
//   `architecture-evidence-store.mjs` records ONE discovery's evidence trail (evidence / hypothesis /
//   experiment / outcome / counterexample) keyed by `subjectKey`. It cannot express "this class of
//   miss happened to us, and here is what it should teach" — an outcome record says what a run
//   CONCLUDED, not what the organisation should LEARN from it. This module adds exactly ONE thing: an
//   Experience record + an append-only ledger + the anti-leak deny-list derived from it. It carries no
//   detection logic, no reflection trigger, no classifier of verdict→role (that belongs to the next
//   task), and no CLI verb.
//
// ⛔ STRUCTURAL SANDBOX (same spirit as `architecture-evidence-store.mjs` / `discovery-method-
// registry.mjs`): no filing machinery, no task/goal/AC, no status write, no detection, no routine
// wiring. Its ONLY persistence is append-only lines to `.quay/discovery-experience-ledger.jsonl`
// (gitignored family, same convention as the evidence store).
//
// FAIL-CLOSED (硬规则 3b): a record missing a required field is REFUSED with a distinct reason code
// and NOTHING is appended. There is no default-filling and no silent success — "I could not write a
// valid record" must never be shaped like "I wrote one". Dually, `ingestFromEvidenceStoreOutcome`
// REFUSES when the named outcome record does not exist: ingestion never FABRICATES the record it is
// supposed to be a projection of.
//
// 硬规则 5 (来源完备性): the automatic adapter's source is the evidence store — a miss there is
// reported as its OWN value (`EVIDENCE_OUTCOME_NOT_FOUND`), never as an empty success.
//
// ── THE JOIN: an outcome → the records that state WHY it came out that way ────────────────────────
// (task gap-discovery-method-generalization-failures-diagnosis-and-retest)
//
// An OUTCOME record carries no domain claim: it says `E-DT-1-Hp cluster 8: verifier verdict
// "supported" on subject hypgen:ownership|plugin/scripts/…`. The claim lives in the `hypothesis` and
// `counterexample` records the store filed under the SAME `subject_key`. MEASURED on the shipped store:
// a derived summary carried 0.000 of those records' content tokens, a JOINED one carries 1.000, and the
// methods that round induced carried 0.034-0.111 — the reflection step was shown the pipeline's own
// bookkeeping and induced methods about the bookkeeping. So every derived entry now carries
// `domain_claim` / `claim_refs` / `claim_citations`, and `join_status` — a THREE-VALUED reading
// (`linked` / `no-linked-claim-record` / `claim-index-unavailable`) so an absent claim and an absent
// index never share a shape.
//
// ── THE AUTOMATIC BATCH INGESTER (task gap-discovery-experience-auto-ingest-from-evidence-store) ──
//
// `ingestExperience(root, {source})` is the ONE entry BOTH sources go through: `ingestFeedback`
// (`source:"user"`) and the evidence-store adapters (`source:"system"`) are thin callers of it — one
// validator, one dedup, one carrier. That is the requirement, stated as code rather than as intent:
// "every system-produced Finding enters through the SAME controlled entry as user feedback".
//
// `ingestNewOutcomes(root, {maxPerRun, enabled})` is the load-bearing half. The read-only audit found
// that NOTHING was ever ingested automatically: `ingestFromEvidenceStoreOutcome` had no caller outside
// its test, and in the only real run a worker hand-picked the 5 system entries and HAND-WROTE their
// role/components/summary — summaries that stated the answer ("paired with two divergent keys"), which
// then went verbatim into the reflection prompt. So the batch ingester DERIVES every field from the
// record: no human picks the record and no human describes it.
//
//   • role       ← the record's own `verdict`: supported→`found-unresolved`,
//                  refuted→`confirmed-negative`, undetermined→`undetermined`; elevated to
//                  `found-and-fixed` / `recurred-after-fix` only when the record names a task id whose
//                  DEVELOP status is `done`.
//   • components ← the record's `subject_key` (the part after the `|` separator, split on `,`).
//   • summary    ← a PROJECTION of the record's own text (`experiment_ref`, the verdict, the subject),
//                  truncated. Never an interpretation: a summary that states the answer is exactly the
//                  defect this task exists to remove (硬规则 2 — judged by position/structure).
//   • evaluation_pin ← the record's `prereg` file's `pin` when that resolves; otherwise `null`, which
//                  is its OWN value — `validateGeneralization` refuses to use an unpinned Experience
//                  as a held-out, so "I could not pin it" never reads as "it is pinned".
//
// ⛔ ZERO reads and zero writes when `enabled:false`: the kill switch is answered BEFORE the store, the
// watermark or the ledger is touched, not in the middle of a scan.
//
// ⛔ FAIL-CLOSED watermark: `{line, line_sha256}` under the SHARED checkout, written atomically
// (tmp + rename). When the line it names no longer exists or no longer hashes to the recorded digest,
// the store was rewritten or truncated and the run REFUSES with `WATERMARK_MISMATCH` and writes
// NOTHING — it never silently restarts from line 0 (硬规则 3b: "I cannot tell what I have already read"
// must never be shaped like "I have read nothing"). A malformed line is COUNTED and the watermark does
// not advance past it, so an unparseable record can never be silently skipped over forever.
//
// 硬规则 4 (a量 that cannot take a false value is not a measurement): the deny-list emits a pattern
// ONLY where a pattern can actually fire. `components` (a path token that appears in an investigator
// inventory) and `case_id` (a short stable label) become patterns; the free-text `summary` does NOT —
// a whole-sentence regex is structurally incapable of matching an inventory line, so emitting it would
// add a pattern that can never be true while looking exactly like one that can. The summaries are
// still returned as data for a consumer that wants them.
//
// ── PROVENANCE & THE PER-RECORD SKIP LEDGER (task gap-discovery-experience-ledger-provenance-and-skip-audit) ─
//
// A production acceptance check of this module's OWN carriers (2026-10-12) found three defects in what
// it had written. All three are the same shape — a claim that was never checked, and a gap that was
// counted but never named — so all three are closed by making the claim structural.
//
//   ⛔ FALSE PROVENANCE. Two entries were stored as `reported_by:"user"` although a task WORKER wrote
//      them, about a defect the worker itself had found; the one genuinely user-reported case was
//      absent from the production ledger entirely. `reported_by` was a free-text claim, so "a human
//      flagged this" and "a machine decided to say a human flagged this" were the same bytes. THREE
//      rules now close it, and NONE of them can be defaulted:
//        • `authored_by {actor, ref}` is REQUIRED on every entry — `ingester` (the batch ingester: a
//          machine, no narration), `task-worker`, or `operator-session`. Absent ⇒ refused.
//        • `reported_by:"user"` additionally requires `user_provenance {kind, ref, quote}`, where
//          `quote` is the human's OWN words (>= MIN_USER_QUOTE_CHARS non-whitespace chars). A claim of
//          human provenance that cannot quote the human is refused (`USER_PROVENANCE_MISSING`).
//        • `reported_by:"user"` with `authored_by.actor:"task-worker"` is ALWAYS refused
//          (`USER_SOURCE_FROM_WORKER`) — the exact defect, refused by construction: a worker cannot
//          label its own finding a human report, however it fills the remaining fields.
//      ⛔ No adapter here DEFAULTS an author. A default would re-create the defect invisibly: a worker
//      calling the manual adapter would be relabelled `operator-session`, and the result would be
//      indistinguishable from a real operator report — which is precisely the failure being fixed.
//      The caller declares the author or the record is refused (硬规则 3b).
//
//   ⛔ UNAUDITABLE GAP. `ingestNewOutcomes` counted non-ingested outcomes in ONE integer
//      (`skipped_not_ingestible`), so an outcome that never became an Experience left no per-record
//      trace: not which store line, not which reason, and no way to re-examine it later.
//      `.quay/discovery-ingest-skips.jsonl` now holds ONE line per outcome not ingested —
//      `{store_line, outcome_id, verdict, reason_code, mapping_version, ts}` — under the four reason
//      codes `VERDICT_NOT_INGESTIBLE:<verdict>` / `DUPLICATE_SOURCE_REF` / `READ_FAILED` / `MALFORMED`,
//      deduped on `(outcome_id, reason_code, mapping_version)`.
//
//      `mapping_version` is DERIVED from `VERDICT_ROLE` itself (a digest of the map), never a literal
//      someone must remember to bump — so "re-evaluate the skips when the mapping changes" is a
//      property of the DATA rather than of anyone's memory. `READ_FAILED` is the transient code: its
//      record is retried on the next round and the watermark never advances past its line.
//
//   ⛔ CORRECTIONS ARE APPEND-ONLY. The two false-provenance entries are corrected by APPENDING a
//      `kind:"experience-correction"` line that names the entry it corrects; readers apply the patch.
//      The original line is never rewritten or deleted — a ledger whose history can be edited cannot be
//      audited, and "corrected" would be indistinguishable from "was always right". A correction may
//      patch ONLY `CORRECTABLE_FIELDS` (`reported_by`, `authored_by`): one that could rewrite
//      `summary`/`evidence` would be a back door to rewriting the finding itself.

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

// Reuse the evidence store's primitives directly (content addressing, the carrier-read that counts
// unparseable lines, and the ONE definition of where the evidence store lives) — re-implementing any
// of them would be a second definition.
import { sha256, recordId, readRecords, subjectKey, EVIDENCE_STORE_REL } from "./architecture-evidence-store.mjs";

// ── WHERE a Discovery Method carrier lives: the SHARED checkout, never the caller's worktree ──────
//
// ⛔ THE DEFECT THIS CLOSES (task gap-discovery-carriers-ephemeral-in-worktree, from the 2026-10-12
//   read-only audit): every Discovery carrier used to resolve relative to the CALLER's root, and
//   every real run so far happened inside a task worktree. On teardown the whole Discovery Method
//   runtime state vanished — `ls <main>/.quay/discovery-*` was empty, Phase 2 had to rebuild the
//   registry because the Phase 0/1 carriers were already gone, and the only `active` method ever
//   recorded existed nowhere. The absence was ACCIDENTAL, not a decision.
//
// The carriers therefore resolve to the SHARED checkout (the main worktree) — the same mechanism
// `plugin/scripts/per-task-suite-record.ts` uses for its own record: `git rev-parse --git-common-dir`
// returns `<main-checkout>/.git` from ANY linked worktree, and `dirname` of that IS the main checkout.
//
// ⛔ WHY THE RESOLUTION IS SPELLED HERE RATHER THAN IMPORTED FROM `per-task-suite-record.ts`: these
//   `docs/analysis/*.mjs` modules are loaded by PLAIN `node` (the reproduction commands in the
//   sibling headers run `node --input-type=module -e 'import … from "<repo>/docs/analysis/…mjs"'`),
//   and a `.ts` specifier needs type-stripping that plain `node` on this repo's declared floor does
//   not do. The duplication is therefore ONE `spawnSync("git", …)` call, and it is PINNED against
//   the canonical resolver by a test that imports BOTH and asserts they agree on the same fixture
//   (`discovery-experience-ledger.test.mjs`, AC2(a)) — an executable invariant, not a promise.
//
// ⛔ An unresolvable shared checkout is REFUSED (`SHARED_CHECKOUT_UNRESOLVED`), never silently
//   downgraded to the caller's root: a fallback would re-create exactly the vanishing carrier this
//   task exists to remove, and it would do so invisibly (硬规则 3b).

/** Refusal code: no shared checkout could be named for the caller's root. */
export const SHARED_CHECKOUT_UNRESOLVED = "SHARED_CHECKOUT_UNRESOLVED";
/** Refusal code: another appender holds the carrier's exclusive lock past the declared wait. */
export const CARRIER_LOCKED = "CARRIER_LOCKED";
/** Refusal code: a record with this `id` is already in the carrier — nothing was appended. */
export const DUPLICATE_ID = "DUPLICATE_ID";
/** Refusal code: the carrier is not a torn FINAL line, so truncating would delete whole records. */
export const CARRIER_NOT_TORN = "CARRIER_NOT_TORN";
/** Refusal code: removing the torn final line would still leave unparseable lines behind. */
export const CARRIER_STILL_MALFORMED = "CARRIER_STILL_MALFORMED";
/** Refusal code: there is no such carrier file (its OWN value — never "clean"). */
export const CARRIER_MISSING = "CARRIER_MISSING";
/** Refusal code: the given name is neither a declared carrier nor a carrier-shaped path. */
export const UNKNOWN_CARRIER = "UNKNOWN_CARRIER";
/** Refusal code: the carrier exists but could not be read at all. */
export const CARRIER_UNREADABLE = "CARRIER_UNREADABLE";
/** Refusal code: the watermark names a line that is gone or no longer hashes to the recorded digest. */
export const WATERMARK_MISMATCH = "WATERMARK_MISMATCH";
/** Refusal code: the evidence store exists but could not be read at all (its OWN value, never "empty"). */
export const EVIDENCE_STORE_UNREADABLE = "EVIDENCE_STORE_UNREADABLE";
/** Refusal code: `source` is neither `"user"` nor `"system"`. */
export const SOURCE_NOT_IN_VOCAB = "SOURCE_NOT_IN_VOCAB";
/** Refusal code: `source:"system"` was handed a field that must be DERIVED from the record. */
export const SYSTEM_FIELD_NOT_CALLER_WRITABLE = "SYSTEM_FIELD_NOT_CALLER_WRITABLE";
/** Refusal code: the watermark file exists but is not a readable `{line, line_sha256}` record. */
export const WATERMARK_UNREADABLE = "WATERMARK_UNREADABLE";
/** Refusal code: `reported_by:"user"` with no `user_provenance` naming the human's own words. */
export const USER_PROVENANCE_MISSING = "USER_PROVENANCE_MISSING";
/** Refusal code: `reported_by:"user"` authored by a task worker — the defect this task exists for. */
export const USER_SOURCE_FROM_WORKER = "USER_SOURCE_FROM_WORKER";
/** Refusal code: a correction names an entry id that is not in the ledger (never a silent no-op). */
export const CORRECTION_TARGET_NOT_FOUND = "CORRECTION_TARGET_NOT_FOUND";
/** Refusal code: a correction patches a field outside `CORRECTABLE_FIELDS`. */
export const CORRECTION_FIELD_NOT_CORRECTABLE = "CORRECTION_FIELD_NOT_CORRECTABLE";
/** Refusal code: a `teaching`/`transfer` record reuses a known case without naming it (Plan item 4). */
export const SOURCE_CASE_REQUIRED = "SOURCE_CASE_REQUIRED";
/** Refusal code: a record claims `independent` while naming a source case it reused — a contradiction:
 *  an independently-generalized case shares no case with the fitting material. */
export const SOURCE_CASE_NOT_APPLICABLE_FOR_INDEPENDENT = "SOURCE_CASE_NOT_APPLICABLE_FOR_INDEPENDENT";

/**
 * The ONE table of Discovery Method carriers: name → `{rel, kind}`. The rel paths of ALL of them are
 * declared HERE, in one place, so `repairCarrier` can address any of them by name and no sibling
 * module has to keep a second copy of its own path. A consumer exports its own `*_REL` FROM this
 * table (see `METHOD_REGISTRY_REL` / `REFLECTION_ATTEMPTS_REL` in the sibling modules).
 *
 * ⛔ This is a declaration only — it adds no writer, no scheduler and no `.gitignore` entry. Whether
 * these carriers are in fact gitignored in quay's own checkout is a MEASURED question, not a premise:
 * `git check-ignore .quay/discovery-experience-ledger.jsonl …` exits 1 for all four (quay's
 * `.gitignore` uses per-file lines, i.e. it carries no single wildcard rule covering all of `.quay`),
 * so the task's Plan claim "carriers stay gitignored" does NOT hold today. `.gitignore` is outside
 * this task's declared ## Touches, so the lines are reported, not added here.
 */
export const DISCOVERY_CARRIERS = Object.freeze({
  "discovery-experience-ledger": Object.freeze({ rel: ".quay/discovery-experience-ledger.jsonl", kind: "experience" }),
  "discovery-method-registry": Object.freeze({ rel: ".quay/discovery-method-registry.jsonl", kind: "method" }),
  "discovery-reflection-attempts": Object.freeze({ rel: ".quay/discovery-reflection-attempts.jsonl", kind: "reflection_attempt" }),
  "discovery-generalization-verdicts": Object.freeze({ rel: ".quay/discovery-generalization-verdicts.jsonl", kind: "generalization_verdict" }),
});

/** The one fixed sink (relative to the SHARED checkout) — same convention as the evidence store's. */
export const EXPERIENCE_LEDGER_REL = DISCOVERY_CARRIERS["discovery-experience-ledger"].rel;

/** The carrier of RECORDED `validateGeneralization` verdicts. Declared here (in the one table) so the
 *  method registry can resolve a promotion's `generalization_evidence` ref WITHOUT importing the
 *  reflection module — the registry must not depend on its own consumer. */
export const GENERALIZATION_VERDICTS_REL = DISCOVERY_CARRIERS["discovery-generalization-verdicts"].rel;
export const GENERALIZATION_VERDICT_KIND = DISCOVERY_CARRIERS["discovery-generalization-verdicts"].kind;

/** The ONE record kind this carrier holds, so a line is self-describing on read-back. */
export const EXPERIENCE_KIND = "experience";

/** The role vocabulary. `recurred-after-fix` (a fix that landed and was later observed to regress)
 *  has no real case yet — the validator ACCEPTS it so a future recurrence is not blocked by an
 *  unknown-value refusal (硬规则 12: do not require a mechanism before it has happened).
 *
 *  ⛔ `found-unresolved` and `undetermined` were ADDED by the automatic batch ingester (they are what a
 *  bare `verdict` can actually say): a supported outcome with no fix recorded is a finding we have NOT
 *  resolved, and an undetermined outcome is precisely an undetermined finding. Before them, a supported
 *  outcome had no honest role to derive — it would have had to claim `found-and-fixed`, i.e. assert a
 *  fix that the record does not name.
 *
 *  ⛔ `duplicate` was ADDED by the open-ended semantic discovery routine's ingestion step
 *  (gap-open-discovery-findings-into-portfolio-experience): a CONFIRMED cluster whose semantic novelty
 *  check decided it restates knowledge the repository already records. It is a SUPPORTED claim (the
 *  evidence held) that is not NEW — so neither `found-unresolved` (which is about unresolvedness) nor
 *  `confirmed-negative` (which says the claim was refuted) can carry it without lying about which of the
 *  two facts is true. */
export const EXPERIENCE_ROLES = Object.freeze([
  "missed-by-tooling",
  "found-and-fixed",
  "found-undetermined-then-confirmed",
  "confirmed-negative",
  "recurred-after-fix",
  "found-unresolved",
  "undetermined",
  "duplicate",
]);

/** Who reported it. A tool-self-reported case is NEVER `"user"` (same discipline as the original
 *  draft's `user` | `operator` split, folded into the two-source model). */
export const REPORTED_BY_VOCAB = Object.freeze(["user", "system"]);

/**
 * WHO WROTE the record — the field that makes `reported_by` checkable instead of merely claimed.
 *
 * ⛔ `reported_by:"user"` alone is a CLAIM any process can make (that is the 2026-10-12 defect: a task
 * worker's own finding stored as a human report). `authored_by.actor` is a DIFFERENT axis — the
 * process that wrote the line — and the only value that can legitimately pair with `"user"` is
 * `operator-session`; `task-worker` is refused outright (`USER_SOURCE_FROM_WORKER`).
 *
 *   • `ingester`          — the batch ingester (`ingestNewOutcomes`): a machine deriving fields from an
 *                           outcome record. It narrates nothing, so it can never claim `"user"`.
 *   • `task-worker`       — a task worker process. Its own findings are `"system"`; it can never
 *                           relabel them `"user"`.
 *   • `operator-session`  — a human-driven session, the only actor that may speak for a human.
 */
export const AUTHORED_BY_ACTORS = Object.freeze(["ingester", "task-worker", "operator-session"]);

/** Where the human's own words came from, when `reported_by:"user"` (Plan item 2). */
export const USER_PROVENANCE_KINDS = Object.freeze(["conversation", "task-body"]);

// ── THE EVIDENCE LEVEL (task gap-discovery-evidence-level-teaching-vs-independent, Plan item 1) ────
//
// ⛔ THE DEFECT THIS CLOSES (user strategy change, 2026-10-12, point 4). The Experience ledger, the
//   generalization verdicts and the method registry carried no evidence level, so a verdict read off a
//   TEACHING case (an answer the experimenter already knew) and a verdict read off a SEALED,
//   never-before-used case were the SAME SHAPE to the promotion guard. That is how the two methods
//   retired as v7 `method-f22f31cfe3029259` / v3 `method-c93d704b1a124ed2` were promoted: not by a
//   falsified prediction, but by a judgment whose evidence level was never stated.
//
// The level is DECLARED, never inferred from a role or a component set: only the experimenter knows
// whether the answer was known in advance. `unlabelled` is what a record that predates this field — or
// a caller that declares nothing — reads as, and it is never `independent` (硬规则 6: a missing label
// is not a weak positive, it is an absent claim).

/** The four DECLARED evidence levels, strongest last. Only `independent` licenses `status:"active"`. */
export const EVIDENCE_LEVELS = Object.freeze(["teaching", "transfer", "independent", "production-open"]);

/** The level a record reads as when it declares none. ⛔ Its OWN value, deliberately OUTSIDE
 *  `EVIDENCE_LEVELS`: "no claim was made" must never be written as, or read as, a weak positive. */
export const UNLABELLED_EVIDENCE_LEVEL = "unlabelled";

/** The writable vocabulary: the four declared levels plus the explicit "no claim" value. */
export const EVIDENCE_LEVEL_VALUES = Object.freeze([...EVIDENCE_LEVELS, UNLABELLED_EVIDENCE_LEVEL]);

/** The ONLY level that licenses a `status:"active"` promotion (Plan item 2). */
export const INDEPENDENT_EVIDENCE_LEVEL = "independent";

/** The levels whose cases may reuse a known case (Plan item 4) — at the price of naming the source
 *  case and of being excluded from every independent metric. */
export const CASE_REUSE_EVIDENCE_LEVELS = Object.freeze(["teaching", "transfer"]);

/**
 * The evidence level of a record (or of a raw level value). PURE. Anything that is not one of the
 * writable values — an absent field, `null`, a typo, a number — reads as `unlabelled`, which is the
 * FAIL-CLOSED direction: an unreadable label can never be mistaken for `independent` (硬规则 3b).
 * @param {object|string|null|undefined} x  a record carrying `evidence_level`, or the level itself
 * @returns {string} one of `EVIDENCE_LEVEL_VALUES`
 */
export function evidenceLevelOf(x) {
  const level = isStr(x, 1) ? String(x) : (isObj(x) ? x.evidence_level : null);
  return EVIDENCE_LEVEL_VALUES.includes(level) ? level : UNLABELLED_EVIDENCE_LEVEL;
}

/** `true` only for a record that DECLARES `independent`. An unlabelled record is never independent. */
export const isIndependentEvidenceLevel = (x) => evidenceLevelOf(x) === INDEPENDENT_EVIDENCE_LEVEL;

/** `true` for the levels allowed to reuse a known case (`teaching` / `transfer`). */
export const allowsCaseReuse = (x) => CASE_REUSE_EVIDENCE_LEVELS.includes(evidenceLevelOf(x));

/**
 * The number of shared component basenames at which two case descriptions are the SAME defect.
 *
 * ⛔ IT LIVES HERE, in the base module, because TWO readers that never see each other must agree on it:
 *   the reflection module's lineage/case-identity arms and the method registry's quarantine arm. The
 *   registry cannot import the reflection module (the reflection module imports the registry — a cycle),
 *   so a copy in either one would be a second definition with nothing keeping the two in step, and a
 *   disagreement between them is exactly the failure mode ("the same defect judged differently by two
 *   guards") that this constant exists to prevent (硬规则 5b).
 */
export const MIN_SHARED_CASE_COMPONENTS = 2;

/** A summary with fewer than this many non-whitespace chars says nothing — the ONLY numeric gate
 *  here, and it is on a MEASURED quantity (硬规则 4: no made-up thresholds on unmeasured things). */
export const MIN_SUMMARY_CHARS = 40;

/** The floor on `user_provenance.quote`, in NON-WHITESPACE chars — the same measure `MIN_SUMMARY_CHARS`
 *  uses, so "a quote" cannot be cleared by padding, and it is on a quantity a human can check by
 *  looking at the string (硬规则 4: not an invented threshold on an unmeasured thing). */
export const MIN_USER_QUOTE_CHARS = 20;

/** The floor on a correction's `reason` — why this correction exists, in the same spirit as the
 *  dispatch-record reason floor: a correction with no reason is an edit with no audit trail. */
export const MIN_CORRECTION_REASON_CHARS = 8;

/** Per-record required fields — declared as DATA so the refusal reasons are enumerable and testable.
 *  ⛔ `evidence_level` joined this list with gap-discovery-evidence-level-teaching-vs-independent: a
 *  NEW record must say what its evidence is worth. Records already on disk are NOT rewritten — they
 *  read back as `unlabelled` through `evidenceLevelOf`, which is why the READ path never refuses for
 *  the field's absence while the WRITE path does. */
export const REQUIRED_EXPERIENCE_FIELDS = Object.freeze([
  "case_id", "ts", "role", "reported_by", "authored_by", "source_ref", "evidence", "components", "summary",
  "evidence_level",
]);

/**
 * role ↔ stored outcome verdict compatibility, as DATA so the refusal is enumerable.
 * Ingestion does NOT re-derive "found-and-fixed" vs "confirmed-negative" from a verdict (that
 * classification belongs to the next task, the reflection trigger). It DOES refuse a caller whose
 * claimed role contradicts the record it points at — otherwise the ledger would carry a role the
 * evidence cannot support, which is indistinguishable from a correctly-labelled entry on read-back.
 */
export const ROLE_VERDICT_COMPAT = Object.freeze({
  // A miss the tooling never surfaced; its later system confirmation is a SUPPORTED finding.
  "missed-by-tooling": Object.freeze(["supported"]),
  // The tool found it and it was fixed — a supported finding.
  "found-and-fixed": Object.freeze(["supported"]),
  // First surfaced as an UNDETERMINED verifier cluster (e.g. TURN_LIMIT), later confirmed by hand.
  "found-undetermined-then-confirmed": Object.freeze(["undetermined"]),
  // A claim the tooling REFUTED — the "negative" is the finding.
  "confirmed-negative": Object.freeze(["refuted"]),
  // A recurrence is an observed (supported) return of a defect that had been fixed.
  "recurred-after-fix": Object.freeze(["supported"]),
  // A supported finding for which NO fix is recorded — the claim held and nothing names a fix.
  "found-unresolved": Object.freeze(["supported"]),
  // The verifier could not tell. Its OWN role, so an `undetermined` outcome is not forced to claim
  // either a finding or a refutation it does not have.
  "undetermined": Object.freeze(["undetermined"]),
  // A SUPPORTED claim that the novelty check found to be already known. Compatible with `supported`
  // because the evidence DID hold — what is denied is newness, not truth.
  "duplicate": Object.freeze(["supported"]),
});

/**
 * The verdict→role map the BATCH ingester derives from — declared as DATA so the derivation is
 * enumerable and testable, exactly like `ROLE_VERDICT_COMPAT` above.
 *
 * ⛔ A verdict absent from this map (`proposed`, `abstained`, `investigated`, `not-evaluated`,
 * `exempted`) is NOT a discovery finding: those are the ownership-active loop's outcome vocabulary.
 * They are SKIPPED with their own reported count (`VERDICT_NOT_INGESTIBLE`) rather than coerced into a
 * finding role — coercing `abstained` into `found-unresolved` would put a finding in the ledger that
 * the record does not contain, and it would be indistinguishable from a real one on read-back.
 */
export const VERDICT_ROLE = Object.freeze({
  supported: "found-unresolved",
  refuted: "confirmed-negative",
  undetermined: "undetermined",
});

/**
 * The identity of a verdict→role map — `mapping_version` in every skip record.
 *
 * ⛔ DERIVED from the map, never a literal someone must remember to bump. Plan item 4 says a
 * `VERDICT_NOT_INGESTIBLE` skip must be re-evaluated "when the verdict→role mapping version changes";
 * a hand-maintained version string turns that into a memory obligation whose failure mode is silent
 * (the map changes, the version does not, and five findings stay invisible forever while every check
 * reports green). Deriving it makes the re-evaluation a property of the DATA (硬规则 4: a quantity
 * nobody can forget to update). Key order cannot leak into it — the entries are sorted first — so the
 * version moves only when the MAPPING moves.
 */
export function verdictRoleMappingVersion(verdictRole = VERDICT_ROLE) {
  const canonical = Object.keys(verdictRole).sort().map((k) => [k, verdictRole[k]]);
  return `vr-${sha256(JSON.stringify(canonical)).slice(0, 12)}`;
}

/** The version of the SHIPPED `VERDICT_ROLE` — what a run files its skips under by default. */
export const VERDICT_ROLE_MAPPING_VERSION = verdictRoleMappingVersion();

/** The four reason codes a skip record may carry. `VERDICT_NOT_INGESTIBLE` is the only one that takes
 *  a suffix (the verdict that had no role), so "which verdict" is in the record rather than implied. */
export const SKIP_VERDICT_NOT_INGESTIBLE = "VERDICT_NOT_INGESTIBLE";
export const SKIP_DUPLICATE_SOURCE_REF = "DUPLICATE_SOURCE_REF";
export const SKIP_READ_FAILED = "READ_FAILED";
export const SKIP_MALFORMED = "MALFORMED";

/** Where the per-record skip ledger lives, relative to the SHARED checkout. Same convention as the
 *  watermark (a carrier of its own, addressed by its own constant). */
export const INGEST_SKIPS_REL = ".quay/discovery-ingest-skips.jsonl";

/** The ONE record kind the skip carrier holds, so a line is self-describing on read-back. */
export const INGEST_SKIP_KIND = "experience-ingest-skip";

/** The ONE record kind a CORRECTION carries — a line in the SAME ledger, never a rewrite of one. */
export const EXPERIENCE_CORRECTION_KIND = "experience-correction";

/**
 * The ONLY fields a correction may patch. ⛔ Restricting the set is the point, not a convenience: a
 * correction able to patch `summary`/`evidence`/`role` would be a supported way to rewrite what the
 * ledger says was found, which is exactly what "append-only, never rewrite the original line" forbids.
 * These two are the provenance fields — the ones the 2026-10-12 check found to be wrong.
 */
export const CORRECTABLE_FIELDS = Object.freeze(["reported_by", "authored_by"]);

/** Where the batch ingester's watermark lives, relative to the SHARED checkout.
 *  ⛔ NOT declared in `DISCOVERY_CARRIERS`: that table is the append-only LINE carriers
 *  (`repairCarrier`'s "truncate a torn FINAL line" model addresses `.jsonl` appends), and this is a
 *  single-object state file rewritten atomically — a name that `repairCarrier` could be handed while
 *  its line-truncation model silently does not apply. The path still has exactly ONE definition. */
export const INGEST_WATERMARK_REL = ".quay/discovery-ingest-watermark.json";

/** The truncation bound for a DERIVED summary — the same 400 the evidence store uses for a projected
 *  hypothesis statement, so the two projections of the same text do not disagree. */
export const MAX_SUMMARY_CHARS = 400;

const isStr = (x, n = 1) => typeof x === "string" && x.trim().length >= n;
const isObj = (x) => x !== null && typeof x === "object" && !Array.isArray(x);
const nonWs = (s) => String(s ?? "").replace(/\s+/g, "").length;
const supplied = (o, k) => Object.prototype.hasOwnProperty.call(o, k) && o[k] !== undefined;
const HEX64 = /^[0-9a-f]{64}$/;

// ── the SHARED checkout resolver (see the header block above) ────────────────────────────────────

/**
 * Name the SHARED checkout this caller's carriers belong to. PURE-ish (one `git` call).
 *
 * @param {string} root  the caller's root — a worktree, or the main checkout itself
 * @returns {{ok:true, root:string} | {ok:false, reason:string}}
 */
export function resolveCarrierRoot(root) {
  if (!isStr(root, 1)) return { ok: false, reason: `${SHARED_CHECKOUT_UNRESOLVED}:no-root-was-given` };
  const r = spawnSync("git", ["-C", root, "rev-parse", "--git-common-dir"], { encoding: "utf8" });
  if (r.error) {
    return { ok: false, reason: `${SHARED_CHECKOUT_UNRESOLVED}:git-could-not-be-run-for-${root}:${r.error.code ?? r.error.message}` };
  }
  if (r.status !== 0) {
    return { ok: false, reason: `${SHARED_CHECKOUT_UNRESOLVED}:git-rev-parse---git-common-dir-exited-${r.status}-in-${root}-so-no-shared-checkout-can-be-named` };
  }
  let common = String(r.stdout ?? "").trim();
  if (!common) return { ok: false, reason: `${SHARED_CHECKOUT_UNRESOLVED}:empty-git-common-dir-for-${root}` };
  if (!path.isAbsolute(common)) common = path.join(root, common);
  const shared = path.dirname(common);
  if (!fs.existsSync(shared)) {
    return { ok: false, reason: `${SHARED_CHECKOUT_UNRESOLVED}:${shared}-named-by-git-common-dir-${common}-does-not-exist` };
  }
  return { ok: true, root: shared };
}

/**
 * Absolute path of a carrier under the SHARED checkout — `null` when no shared checkout can be named.
 * The `null` is its OWN value (硬规则 3b): "I cannot say where this carrier lives" must never be
 * shaped like a path that merely happens to be the caller's worktree.
 * @param {string} root @param {string} rel
 * @returns {string|null}
 */
export function carrierFile(root, rel) {
  const rr = resolveCarrierRoot(root);
  return rr.ok ? path.join(rr.root, String(rel)) : null;
}

/**
 * Resolve a carrier NAME (or a carrier-shaped path) to its `{rel}`. A name absent from
 * `DISCOVERY_CARRIERS` is accepted only when it is explicitly a path (`…/x.jsonl` or a bare
 * `x.jsonl`) — anything else is `UNKNOWN_CARRIER`, never a guess.
 * @returns {{rel:string}|null}
 */
export function carrierEntry(name) {
  if (!isStr(name, 1)) return null;
  const n = String(name);
  if (Object.prototype.hasOwnProperty.call(DISCOVERY_CARRIERS, n)) return DISCOVERY_CARRIERS[n];
  if (n.includes("/") || n.endsWith(".jsonl")) return { rel: n };
  return null;
}

/** Absolute path of the Experience ledger under the SHARED checkout (null when unresolvable). */
export const ledgerFile = (root) => carrierFile(root, EXPERIENCE_LEDGER_REL);

/** Deterministic content-addressed id, reusing the evidence store's own primitive. */
export const experienceRecordId = (rec) => recordId(EXPERIENCE_KIND, rec);

// ── validation ──────────────────────────────────────────────────────────────────────────────────

/**
 * Validate ONE Experience record. PURE. Returns `{ok, reasons[]}` — reasons are DISTINCT codes so
 * "the caller forgot a field" can never collapse into "the record was fine but the write failed"
 * (硬规则 3b). A malformed candidate is REPORTED, never accepted by default.
 */
export function validateExperienceRecord(rec) {
  if (!isObj(rec)) return { ok: false, reasons: ["RECORD_NOT_OBJECT"] };
  const reasons = [];
  for (const f of REQUIRED_EXPERIENCE_FIELDS) if (!supplied(rec, f)) reasons.push(`SCHEMA_MISSING:${f}`);
  if (reasons.length) return { ok: false, reasons };   // field-typed checks below assume presence

  if (!isStr(rec.case_id, 1)) reasons.push("FIELD_INVALID:case_id");
  if (!isStr(rec.ts, 4)) reasons.push("FIELD_INVALID:ts");

  // ── THE EVIDENCE LEVEL (Plan item 1) ────────────────────────────────────────────────────────────
  // The field is `SCHEMA_MISSING` above when absent, so this block judges only the VALUE: a level
  // outside the vocabulary is its OWN code, never silently downgraded to `unlabelled` on the WRITE
  // path (a typo must not become a weaker-but-legal claim). Reading is the other half: `evidenceLevelOf`
  // maps an absent/unknown value to `unlabelled`, the fail-closed direction, and never to `independent`.
  if (!EVIDENCE_LEVEL_VALUES.includes(rec.evidence_level)) {
    reasons.push(`EVIDENCE_LEVEL_NOT_IN_VOCAB:${String(rec.evidence_level)}`);
  } else if (CASE_REUSE_EVIDENCE_LEVELS.includes(rec.evidence_level) && !isStr(rec.source_case_id, 1)) {
    // Plan item 4: a `teaching`/`transfer` record MAY reuse a known case, and it MUST name it — a
    // reused case whose source is unnamed is indistinguishable on read-back from a fresh one, which is
    // exactly the "repeated training case presented as an independent proof" the strategy forbids.
    reasons.push(`${SOURCE_CASE_REQUIRED}:evidence_level=${rec.evidence_level}-must-name-the-known-case-it-reuses-in-source_case_id`);
  } else if (rec.evidence_level === INDEPENDENT_EVIDENCE_LEVEL && supplied(rec, "source_case_id") && rec.source_case_id !== null) {
    // The mirror of the rule above: naming a reused case while claiming `independent` is a claim the
    // level itself contradicts. It is refused on its own terms rather than ignored, because ignoring it
    // would let a record read back as independent while carrying the very reuse the level denies.
    reasons.push(`${SOURCE_CASE_NOT_APPLICABLE_FOR_INDEPENDENT}:evidence_level=independent-was-not-derived-from-a-previously-used-case`);
  }

  if (!EXPERIENCE_ROLES.includes(rec.role)) reasons.push(`ROLE_NOT_IN_VOCAB:${String(rec.role)}`);
  if (!REPORTED_BY_VOCAB.includes(rec.reported_by)) reasons.push(`REPORTED_BY_NOT_IN_VOCAB:${String(rec.reported_by)}`);

  // A case with ZERO evidence is an opinion, not an Experience entry (same grounding discipline as
  // the evidence store's `hypothesis.source_evidence`). Present-but-empty is its OWN code — distinct
  // from the absent-field `SCHEMA_MISSING:evidence` above.
  if (!Array.isArray(rec.evidence) || rec.evidence.length === 0) {
    reasons.push("EVIDENCE_UNGROUNDED:evidence-must-cite-at-least-one-ref");
  } else {
    rec.evidence.forEach((e, i) => {
      if (!isObj(e) || !isStr(e.ref, 1)) reasons.push(`FIELD_INVALID:evidence[${i}].ref`);
      if (!isObj(e) || !HEX64.test(String(e.sha256))) reasons.push(`FIELD_INVALID:evidence[${i}].sha256`);
    });
  }

  // `components` may legitimately be EMPTY (a case that names no file) — the gate is on the array
  // being an array of non-empty strings, not on a made-up positive floor.
  if (!Array.isArray(rec.components) || !rec.components.every((c) => isStr(c, 1))) {
    reasons.push("FIELD_INVALID:components-needs-[non-empty-string]");
  }

  if (!isStr(rec.summary, 1)) {
    reasons.push("FIELD_INVALID:summary");
  } else if (nonWs(rec.summary) < MIN_SUMMARY_CHARS) {
    reasons.push(`SUMMARY_INSUBSTANTIAL:needs->=${MIN_SUMMARY_CHARS}-non-whitespace-chars-got-${nonWs(rec.summary)}`);
  }

  // `evaluation_pin` is OPTIONAL (the manual path has none, and an outcome whose pre-registration does
  // not resolve to a pin has none). Supplied-but-not-null-and-not-a-string is its OWN code: a `null` is
  // the honest "no pin", while `""`/`0`/`undefined`-adjacent values would read as pinned on a loose
  // check. It is NOT in REQUIRED_EXPERIENCE_FIELDS — requiring it would refuse every manual case.
  if (supplied(rec, "evaluation_pin") && rec.evaluation_pin !== null && !isStr(rec.evaluation_pin, 1)) {
    reasons.push("FIELD_INVALID:evaluation_pin-needs-a-non-empty-string-or-null");
  }

  // `source_ref` is a STRUCTURAL invariant, not a convention: a system-sourced entry without a
  // back-pointer cannot be re-checked against the outcome it claims to project, and a user-sourced
  // entry carrying one would name a record it was not derived from. Both are their OWN code.
  if (rec.reported_by === "system" && !isStr(rec.source_ref, 1)) {
    reasons.push("SOURCE_REF_REQUIRED_FOR_SYSTEM:reported_by=system-must-name-the-evidence-store-record-it-was-derived-from");
  }
  if (rec.reported_by === "user" && rec.source_ref !== null) {
    reasons.push("SOURCE_REF_MUST_BE_NULL_FOR_USER:reported_by=user-was-not-derived-from-any-record");
  }

  // ── PROVENANCE (Plan items 1–2): WHO wrote it, and — for a human report — the human's own words ──
  // `authored_by` is in REQUIRED_EXPERIENCE_FIELDS, so an entry lacking it never reaches this block
  // (it is refused above with `SCHEMA_MISSING:authored_by`). What is checked HERE is its shape: an
  // actor from the vocabulary, and a ref naming WHICH ingester/worker/session wrote the line.
  if (!isObj(rec.authored_by)) {
    reasons.push("FIELD_INVALID:authored_by-needs-{actor,ref}");
  } else {
    if (!AUTHORED_BY_ACTORS.includes(rec.authored_by.actor)) {
      reasons.push(`AUTHORED_BY_ACTOR_NOT_IN_VOCAB:${String(rec.authored_by.actor)}`);
    }
    if (!isStr(rec.authored_by.ref, 1)) reasons.push("FIELD_INVALID:authored_by.ref");
  }

  if (rec.reported_by === "user") {
    // ⛔ THE DEFECT, refused by construction. A task worker's own finding is a SYSTEM finding; letting
    // it wear `reported_by:"user"` is the 2026-10-12 production defect, so the combination is refused
    // on its own terms — no amount of well-filled prose elsewhere makes this shape acceptable.
    if (isObj(rec.authored_by) && rec.authored_by.actor === "task-worker") {
      reasons.push(`${USER_SOURCE_FROM_WORKER}:authored_by.actor=task-worker-cannot-store-its-own-finding-as-reported_by=user`);
    }
    // A human report must quote the human. "No provenance supplied" and "the quote is too thin to be
    // evidence" are DIFFERENT failures and get different codes (硬规则 3b), so a caller can tell which
    // one it hit without reading prose.
    if (!isObj(rec.user_provenance)) {
      reasons.push(`${USER_PROVENANCE_MISSING}:reported_by=user-needs-user_provenance-{kind,ref,quote}`);
    } else {
      if (!USER_PROVENANCE_KINDS.includes(rec.user_provenance.kind)) {
        reasons.push(`USER_PROVENANCE_KIND_NOT_IN_VOCAB:${String(rec.user_provenance.kind)}`);
      }
      if (!isStr(rec.user_provenance.ref, 1)) reasons.push("FIELD_INVALID:user_provenance.ref");
      if (!isStr(rec.user_provenance.quote, 1)) {
        reasons.push("FIELD_INVALID:user_provenance.quote");
      } else if (nonWs(rec.user_provenance.quote) < MIN_USER_QUOTE_CHARS) {
        reasons.push(`USER_PROVENANCE_QUOTE_INSUBSTANTIAL:needs->=${MIN_USER_QUOTE_CHARS}-non-whitespace-chars-got-${nonWs(rec.user_provenance.quote)}`);
      }
    }
  } else if (supplied(rec, "user_provenance") && rec.user_provenance !== null) {
    // The mirror of `SOURCE_REF_MUST_BE_NULL_FOR_USER`: a derived entry carrying a human quote would
    // claim provenance it never had, and would read back as a human report.
    reasons.push("USER_PROVENANCE_NOT_APPLICABLE_FOR_SYSTEM:reported_by=system-was-not-derived-from-a-human-message");
  }

  return { ok: reasons.length === 0, reasons };
}

// ── append / read (the ONE append path every Discovery carrier goes through) ─────────────────────
//
// A carrier append is: (1) resolve the SHARED checkout, (2) take the carrier's exclusive lock file,
// (3) skip when the record's `id` is already present, (4) ONE `O_APPEND` write of the whole line
// followed by an `fsync`, (5) release. Steps 2/4 are what make two concurrent appenders produce two
// WHOLE lines rather than one interleaved line: `O_APPEND` makes the offset+write atomic, and the
// lock makes the read-check-write sequence atomic against a second process.

/** A synchronous sleep — the lock retry loop is synchronous, so it cannot await. */
function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, Math.max(0, ms));
}

/**
 * Take `lock` exclusively (`O_CREAT|O_EXCL`). A lock older than the declared wait is treated as
 * ABANDONED and reclaimed (the reclamation is REPORTED, never silent) — the threshold is the caller's
 * own declared wait, not an invented constant, and a real append holds the lock for well under 1 ms.
 * @returns {{ok:true, release:()=>void, reclaimed:boolean} | {ok:false, reason:string}}
 */
function acquireCarrierLock(lock, timeoutMs, retryMs) {
  const started = Date.now();
  let reclaimed = false;
  for (;;) {
    try {
      fs.closeSync(fs.openSync(lock, "wx"));
      return { ok: true, reclaimed, release() { try { fs.unlinkSync(lock); } catch { /* already gone */ } } };
    } catch (e) {
      if (e?.code !== "EEXIST") return { ok: false, reason: `${CARRIER_LOCKED}:cannot-create-${path.basename(lock)}:${e?.code ?? e?.message}` };
    }
    try {
      if (Date.now() - fs.statSync(lock).mtimeMs > timeoutMs) { fs.unlinkSync(lock); reclaimed = true; continue; }
    } catch { /* the holder released between the open and the stat — just retry */ }
    if (Date.now() - started > timeoutMs) {
      return { ok: false, reason: `${CARRIER_LOCKED}:${path.basename(lock)}-was-still-held-after-${timeoutMs}ms` };
    }
    sleepSync(retryMs);
  }
}

/**
 * Append ONE record to a Discovery carrier, atomically and idempotently.
 *
 * @param {string} root  the caller's root (a worktree or the main checkout) — the carrier lands in the
 *   SHARED checkout regardless
 * @param {string} rel   the carrier's path relative to the shared checkout
 * @param {object} record  the record; its `id` is the idempotency key
 * @param {object} [opts] `{kind, lockTimeoutMs=5000, retryMs=5}`
 * @returns {{ok:true, kind, id, file, record, appended:true, line_bytes:number}
 *          |{ok:false, kind, reasons:string[], appended:false, file?:string, duplicate?:true}}
 *   ⛔ On ANY refusal nothing is written and no field is defaulted. A `DUPLICATE_ID` refusal carries
 *   `duplicate:true` and leaves the file byte-identical — a re-append is a no-op, not an error state.
 */
export function appendCarrierLine(root, rel, record, { kind = null, lockTimeoutMs = 5000, retryMs = 5 } = {}) {
  const rr = resolveCarrierRoot(root);
  if (!rr.ok) return { ok: false, kind, reasons: [rr.reason], appended: false };
  const file = path.join(rr.root, String(rel));
  fs.mkdirSync(path.dirname(file), { recursive: true });

  const lock = `${file}.lock`;
  const held = acquireCarrierLock(lock, lockTimeoutMs, retryMs);
  if (!held.ok) return { ok: false, kind, reasons: [held.reason], appended: false, file };
  try {
    const { records } = readRecords(file);
    const id = record?.id;
    if (isStr(id, 1) && records.some((r) => isObj(r) && r.id === id)) {
      return {
        ok: false, kind, id, file, appended: false, duplicate: true, lock_reclaimed: held.reclaimed,
        reasons: [`${DUPLICATE_ID}:${id}-is-already-in-${rel}-so-nothing-was-appended-and-the-carrier-is-unchanged`],
      };
    }
    const line = JSON.stringify({ kind, ...record }) + "\n";
    const fd = fs.openSync(file, "a");   // O_APPEND: the offset+write is one atomic step
    try { fs.writeSync(fd, line); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    return { ok: true, kind, id: id ?? null, file, record: { kind, ...record }, appended: true, line_bytes: Buffer.byteLength(line), lock_reclaimed: held.reclaimed };
  } finally {
    held.release();
  }
}

/**
 * Read a Discovery carrier from the SHARED checkout. Unparseable lines are DROPPED and COUNTED (never
 * silently); `ok` is false when any exist, because a partially-readable carrier must not be read as a
 * complete one. An UNRESOLVABLE root is its own value: `ok:false` + `file:null` + `reason`.
 * @returns {{ok:boolean, records:object[], malformed_lines:number, file:string|null, reason?:string}}
 */
export function readCarrier(root, rel, kind = null) {
  const file = carrierFile(root, rel);
  if (file === null) {
    const rr = resolveCarrierRoot(root);
    return { ok: false, records: [], malformed_lines: 0, file: null, reason: rr.reason };
  }
  const { records, malformed_lines } = readRecords(file);   // the evidence store's carrier reader
  const kept = kind === null ? records : records.filter((r) => isObj(r) && r.kind === kind);
  return { ok: malformed_lines === 0, records: kept, malformed_lines, file };
}

/**
 * Append ONE validated Experience record. Returns `{ok:true, id, file, record}` or
 * `{ok:false, reasons, appended:false}`. ⛔ On refusal NOTHING is written and no field is defaulted.
 */
export function appendExperienceRecord(root, rec) {
  const v = validateExperienceRecord(rec);
  if (!v.ok) return { ok: false, kind: EXPERIENCE_KIND, reasons: v.reasons, appended: false };
  const withId = { id: rec.id ?? experienceRecordId(rec), ...rec };
  return appendCarrierLine(root, EXPERIENCE_LEDGER_REL, withId, { kind: EXPERIENCE_KIND });
}

/**
 * Read the ledger back, WITH the append-only corrections applied.
 *
 * ⛔ The carrier holds TWO kinds now (entries and corrections), so this reads every kind and filters
 * afterwards — reading `kind:"experience"` alone would make the corrections invisible and the ledger
 * would report the very provenance the 2026-10-12 check found to be false.
 *
 * Unparseable lines are DROPPED and COUNTED (never silently); `ok` is false when any exist, because a
 * partially-readable ledger must not be read as a complete one.
 * @returns {{ok:boolean, records:object[], corrections:Map<string,object>, corrected_ids:string[],
 *            malformed_lines:number, file:string|null}}
 */
export function readExperienceLedger(root) {
  const raw = readCarrier(root, EXPERIENCE_LEDGER_REL, null);
  const applied = applyExperienceCorrections(raw.records);
  return {
    ...raw,
    records: applied.entries.filter((r) => isObj(r) && r.kind === EXPERIENCE_KIND),
    corrections: applied.patches,
    corrected_ids: applied.corrected,
  };
}

/** The CORRECTION lines themselves — the audit trail of what was changed, by whom, and why. */
export function readExperienceCorrections(root) {
  const raw = readCarrier(root, EXPERIENCE_LEDGER_REL, EXPERIENCE_CORRECTION_KIND);
  const applied = applyExperienceCorrections(readCarrier(root, EXPERIENCE_LEDGER_REL, null).records);
  return { ...raw, orphan_targets: applied.orphan_corrections };
}

/**
 * Apply the append-only CORRECTIONS to a carrier's records. PURE.
 *
 * A correction line names the entry it corrects (`corrects`) and carries a `patch` drawn from
 * `CORRECTABLE_FIELDS`. Corrections merge in LINE ORDER and the last write wins **field by field** —
 * the ledger's own order is the precedence rule, and the only one, because a rule inferred from `ts`
 * could disagree with the file and there would be no way to tell which was authoritative.
 *
 * ⛔ The original entry is RETURNED PATCHED, never removed: a reader sees the corrected view while the
 * carrier still holds every line ever written. That is what makes the correction auditable — a
 * "corrected" ledger that had simply been rewritten would be indistinguishable from one that was
 * always right, which is the whole reason this is a separate record kind.
 *
 * @returns {{entries:object[], patches:Map<string,object>, corrected:string[], orphan_corrections:string[]}}
 *   `orphan_corrections` names corrections that correct nothing present in the carrier. They are
 *   REPORTED, never silently dropped (硬规则 5: "this correction corrected nothing" is not the same
 *   finding as "there were no corrections").
 */
export function applyExperienceCorrections(records) {
  const patches = new Map();
  const orphanCorrections = [];
  const entries = [];
  const ids = new Set(records.filter((r) => isObj(r) && isStr(r.id, 1)).map((r) => r.id));
  for (const r of records) {
    if (!isObj(r)) continue;
    if (r.kind !== EXPERIENCE_CORRECTION_KIND) { entries.push(r); continue; }
    if (!isStr(r.corrects, 1) || !isObj(r.patch)) {
      orphanCorrections.push(isStr(r.corrects, 1) ? r.corrects : String(r.id ?? "(unnamed-correction)"));
      continue;
    }
    if (!ids.has(r.corrects)) { orphanCorrections.push(r.corrects); continue; }
    patches.set(r.corrects, { ...(patches.get(r.corrects) ?? {}), ...r.patch });
  }
  const corrected = [];
  const out = entries.map((e) => {
    const patch = patches.get(e.id);
    if (!patch) return e;
    corrected.push(e.id);
    return { ...e, ...patch };
  });
  return { entries: out, patches, corrected, orphan_corrections: orphanCorrections };
}

/**
 * Append ONE correction. ⛔ It never edits the line it corrects — see the header.
 *
 * FAIL-CLOSED on every argument: a correction that names no entry, patches nothing (or patches a field
 * outside `CORRECTABLE_FIELDS`), or gives no reason is REFUSED and appends nothing. In particular the
 * target must ALREADY BE in the ledger: a correction pointing at an absent id would sit in the carrier
 * looking exactly like one that corrected something (硬规则 3b).
 *
 * @returns {{ok:true, id, file, record, appended:true}|{ok:false, reasons:string[], appended:false}}
 */
export function appendExperienceCorrection(root, { corrects, patch, reason, authoredBy, ts } = {}) {
  const reasons = [];
  if (!isStr(corrects, 1)) reasons.push("INGEST_ARG_MISSING:corrects");
  if (!isObj(patch) || Object.keys(patch).length === 0) {
    reasons.push("INGEST_ARG_MISSING:patch");
  } else {
    for (const f of Object.keys(patch)) {
      if (!CORRECTABLE_FIELDS.includes(f)) {
        reasons.push(`${CORRECTION_FIELD_NOT_CORRECTABLE}:${f}-may-not-be-rewritten-by-a-correction`);
      }
    }
  }
  if (!isStr(reason, 1) || nonWs(reason) < MIN_CORRECTION_REASON_CHARS) {
    reasons.push(`CORRECTION_REASON_INSUBSTANTIAL:needs->=${MIN_CORRECTION_REASON_CHARS}-non-whitespace-chars-explaining-why`);
  }
  if (!isObj(authoredBy) || !AUTHORED_BY_ACTORS.includes(authoredBy.actor) || !isStr(authoredBy.ref, 1)) {
    reasons.push("INGEST_ARG_MISSING:authoredBy-{actor,ref}");
  }
  if (reasons.length) return { ok: false, appended: false, kind: EXPERIENCE_CORRECTION_KIND, reasons };

  const read = readExperienceLedger(root);
  if (!read.records.some((r) => r.id === corrects)) {
    return {
      ok: false, appended: false, kind: EXPERIENCE_CORRECTION_KIND,
      reasons: [`${CORRECTION_TARGET_NOT_FOUND}:${corrects}-is-not-an-entry-in-${EXPERIENCE_LEDGER_REL}`],
    };
  }
  // Idempotent: the id is content-addressed over `(corrects, patch, reason)` and `ts` is deliberately
  // EXCLUDED, so re-running a backfill corrects nothing twice (`DUPLICATE_ID`, carrier untouched).
  const body = { corrects, patch, reason };
  return appendCarrierLine(root, EXPERIENCE_LEDGER_REL, {
    id: recordId(EXPERIENCE_CORRECTION_KIND, body),
    ...body,
    ts: ts ?? new Date().toISOString(),
    authored_by: authoredBy,
  }, { kind: EXPERIENCE_CORRECTION_KIND });
}

// ── the per-record SKIP ledger (Plan item 4) ─────────────────────────────────────────────────────

/** Absolute path of the skip ledger under the SHARED checkout (null when unresolvable). */
export const ingestSkipsFile = (root) => carrierFile(root, INGEST_SKIPS_REL);

/** Read the per-record skip ledger. Same fail-closed shape as every other carrier read: a partially
 *  readable carrier must never be read as a complete dedup set. */
export const readIngestSkips = (root) => readCarrier(root, INGEST_SKIPS_REL, INGEST_SKIP_KIND);

/**
 * The dedup key of a skip record — `(outcome_id, reason_code, mapping_version)`, exactly as the Plan
 * states it. A malformed line has no `outcome_id` (it never parsed), so it keys on its store LINE
 * instead; the two can never collide because an id is never shaped like `line-<n>`.
 */
export const skipDedupKey = (s) =>
  `${isStr(s?.outcome_id, 1) ? s.outcome_id : `line-${s?.store_line}`}|${s?.reason_code}|${s?.mapping_version}`;

/** The skip record's id: the content address of the DEDUP KEY only. `ts` and `verdict` are deliberately
 *  outside it, so a re-run of the same skip collapses onto the existing line (`DUPLICATE_ID`) instead of
 *  growing the carrier — while a NEW mapping version mints a new id, which is what makes a
 *  re-evaluation visible rather than an overwrite. */
export const ingestSkipId = (s) => `ingest-skip-${sha256(skipDedupKey(s)).slice(0, 16)}`;

/**
 * Record ONE skip. Idempotent by id — see `ingestSkipId`.
 * @returns the `appendCarrierLine` result (`duplicate:true` when the same skip is already recorded)
 */
export function appendIngestSkip(root, { store_line = null, outcome_id = null, verdict = null, reason_code, mapping_version = VERDICT_ROLE_MAPPING_VERSION, ts } = {}) {
  const rec = { store_line, outcome_id, verdict, reason_code, mapping_version };
  return appendCarrierLine(root, INGEST_SKIPS_REL, {
    id: ingestSkipId(rec), ...rec, ts: ts ?? new Date().toISOString(),
  }, { kind: INGEST_SKIP_KIND });
}

// ── recovery: repair a carrier whose FINAL appended line was torn by a crash ──────────────────────

/**
 * Repair a carrier whose LAST line was torn by an interrupted append.
 *
 * ⛔ It truncates ONLY a torn FINAL line — bytes after the last `\n`. A carrier with an unparseable
 * line in the MIDDLE is REFUSED (`CARRIER_NOT_TORN`) and left untouched: truncation is only safe
 * where the tail is provably a partial write, and "remove everything after the last good line" would
 * otherwise silently delete whole records.
 *
 * The original file is copied to `<file>.bak-<utc-stamp>` BEFORE anything is written, and everything
 * removed is reported (`removed_bytes`, `removed_lines`, `removed_sample`).
 *
 * @param {string} root  the caller's root
 * @param {string} name  a `DISCOVERY_CARRIERS` key, or a carrier-shaped path (e.g. `x.jsonl`)
 * @param {object} [opts] `{now = Date.now()}`
 * @returns {{ok:true, repaired:boolean, file:string, backup:string|null, removed_bytes:number,
 *            removed_lines:number, malformed_before:number, malformed_after:number}
 *          |{ok:false, reasons:string[], repaired:false, file:string|null}}
 */
export function repairCarrier(root, name, { now = Date.now() } = {}) {
  const entry = carrierEntry(name);
  if (!entry) {
    return { ok: false, reasons: [`${UNKNOWN_CARRIER}:${String(name)}-is-neither-a-declared-carrier-name-nor-a-carrier-path`], repaired: false, file: null };
  }
  const file = carrierFile(root, entry.rel);
  if (file === null) {
    const rr = resolveCarrierRoot(root);
    return { ok: false, reasons: [rr.reason], repaired: false, file: null };
  }
  if (!fs.existsSync(file)) {
    // Its OWN value: "there is no such carrier" is not "the carrier was clean".
    return { ok: false, reasons: [`${CARRIER_MISSING}:${entry.rel}-does-not-exist-under-the-shared-checkout`], repaired: false, file };
  }
  let text;
  try { text = fs.readFileSync(file, "utf8"); }
  catch (e) { return { ok: false, reasons: [`${CARRIER_UNREADABLE}:${entry.rel}:${e?.code ?? e?.message}`], repaired: false, file }; }

  const countMalformed = (s) => s.split("\n").filter(Boolean).reduce((n, l) => { try { JSON.parse(l); return n; } catch { return n + 1; } }, 0);
  const malformedBefore = countMalformed(text);
  const torn = text.length > 0 && !text.endsWith("\n");

  if (!torn) {
    if (malformedBefore === 0) {
      return { ok: true, repaired: false, file, backup: null, removed_bytes: 0, removed_lines: 0, malformed_before: 0, malformed_after: 0 };
    }
    return {
      ok: false, repaired: false, file,
      reasons: [`${CARRIER_NOT_TORN}:${malformedBefore}-unparseable-line(s)-but-${entry.rel}-ends-with-a-newline-so-no-torn-FINAL-line-can-be-removed-(truncating-would-delete-whole-records)`],
    };
  }

  const cut = text.lastIndexOf("\n") + 1;
  const removed = text.slice(cut);
  const kept = text.slice(0, cut);
  const malformedAfter = countMalformed(kept);
  if (malformedAfter > 0) {
    return {
      ok: false, repaired: false, file,
      reasons: [`${CARRIER_STILL_MALFORMED}:removing-the-torn-final-line-would-still-leave-${malformedAfter}-unparseable-line(s)-so-nothing-was-removed`],
    };
  }

  const stamp = new Date(now).toISOString().replace(/[:.]/g, "-");
  const backup = `${file}.bak-${stamp}`;
  fs.copyFileSync(file, backup);
  fs.writeFileSync(file, kept, "utf8");
  return {
    ok: true, repaired: true, file, backup,
    removed_bytes: Buffer.byteLength(removed), removed_lines: 1,
    removed_sample: removed.slice(0, 200),
    malformed_before: malformedBefore, malformed_after: malformedAfter,
  };
}

// ── WHERE the evidence store lives: the SHARED checkout, like every other Discovery carrier ──────
//
// The evidence store is read through the SAME shared-checkout resolution as the ledger and the
// watermark. A batch ingester that read the CALLER's store would ingest nothing whenever it ran from a
// task worktree (where `.quay/architecture-evidence-store.jsonl` does not exist) and would silently
// look like "no new outcomes" — the exact 硬规则 3b shape this task's dependency removed for the
// carriers. When the caller IS the main checkout the two are the same path, so nothing changes there.

/** Absolute path of the evidence store under the SHARED checkout — `null` when unresolvable. */
export function sharedStoreFile(root) {
  const rr = resolveCarrierRoot(root);
  return rr.ok ? path.join(rr.root, EVIDENCE_STORE_REL) : null;
}

/**
 * Ensure the shared checkout's evidence store EXISTS, creating it EMPTY when it is genuinely ABSENT.
 *
 * ⛔ WHAT THIS REPLACES, AND WHY THE REPAIR IS THE SEMANTICS RATHER THAN A NEW PRODUCER. The batch
 *   ingester used to refuse an absent store with `EVIDENCE_STORE_MISSING`, and NOTHING RESIDENT EVER
 *   WRITES THE STORE: the only writers are `arch-hypothesis-generation.mjs`'s manual `--write-store`
 *   subcommands and the manual `ownership-active-loop.mjs` run. So on any host whose store was never
 *   seeded by hand, `discovery_method`'s ingest step refused EVERY round, forever, on a prerequisite
 *   its own pipeline is structurally unable to produce — a gate whose only exit was a human typing a
 *   research command. "missing ⇒ refuse" becomes "missing ⇒ create an EMPTY carrier, then proceed and
 *   honestly report 0 records to ingest".
 *
 * ⛔ WHY AN EMPTY FILE IS HONEST AND IS NOT A FABRICATION. A zero-line JSONL carrier IS a valid carrier
 *   holding zero records — every line vacuously satisfies the schema, and `readRecords` reads it back
 *   as `{records: [], malformed_lines: 0}`. It asserts "no evidence has been recorded here", which is
 *   TRUE of a host where none has. The alternative — synthesizing a plausible-looking `evidence` or
 *   `outcome` record to "seed" the file — would assert a reading nobody ever took. This function
 *   cannot do that: the only bytes it is able to write are none.
 *
 * ⛔ NARROW ON PURPOSE — ONLY A GENUINELY ABSENT STORE BOOTSTRAPS (硬规则 3b). "Not there" and "there
 *   but broken" are two different findings and they stay distinguishable: a store that EXISTS and
 *   cannot be read (a directory in its place, EACCES, a vanished mount) still fails closed with its own
 *   `EVIDENCE_STORE_UNREADABLE`, never collapsed into the absent case. The `wx` flag extends the same
 *   discipline to the create itself: a store that appeared between the check and the write is ADOPTED
 *   (its bytes are not ours to touch), never truncated — and a create that fails for any other reason
 *   reports the same "not usable" code rather than pretending the store is now there.
 *
 * @param {string} root
 * @returns {{ok:true, store:string, bootstrapped:boolean}|{ok:false, store:string|null, bootstrapped:false, reasons:string[]}}
 *   `bootstrapped:true` means THIS call created the file (its own reading — an already-present but
 *   empty store is `bootstrapped:false`, so "we made it exist" and "it was always empty" never merge).
 */
export function ensureEvidenceStore(root) {
  const rr = resolveCarrierRoot(root);
  if (!rr.ok) return { ok: false, store: null, bootstrapped: false, reasons: [rr.reason] };
  const store = path.join(rr.root, EVIDENCE_STORE_REL);
  if (fs.existsSync(store)) return { ok: true, store, bootstrapped: false };
  try {
    fs.mkdirSync(path.dirname(store), { recursive: true });
    fs.writeFileSync(store, "", { encoding: "utf8", flag: "wx" });
  } catch (e) {
    // `EEXIST` = a concurrent round created it first. That IS the state we wanted; adopt it untouched.
    if (e?.code === "EEXIST") return { ok: true, store, bootstrapped: false };
    return { ok: false, store, bootstrapped: false, reasons: [`${EVIDENCE_STORE_UNREADABLE}:${EVIDENCE_STORE_REL}:${e?.code ?? e?.message}`] };
  }
  return { ok: true, store, bootstrapped: true };
}

// ── derivation: outcome record → Experience fields (PURE — no fs, no git, no model) ─────────────

const isInt = (x) => Number.isInteger(x);

/**
 * The component tokens of a record's `subject_key`. The key's own shape is
 * `<concern-kind>|<comma-separated tokens>`; a key without the separator is treated as one token list.
 * Empty tokens are dropped (a trailing comma is not a component named "") and an absent key yields
 * `[]` — the validator accepts an empty list (a case that names no file is legitimate).
 * @returns {string[]}
 */
export function componentsFromSubjectKey(subjectKey) {
  if (!isStr(subjectKey, 1)) return [];
  const key = String(subjectKey);
  const bar = key.indexOf("|");
  const body = bar === -1 ? key : key.slice(bar + 1);
  return body.split(",").map((t) => t.trim()).filter((t) => t.length > 0);
}

// ── the JOIN: an outcome record to the records that state WHY it came out that way ────────────────
//
// ⛔ THE DEFECT THIS CLOSES (gap-discovery-method-generalization-failures-diagnosis-and-retest,
//   2026-10-12). The summary below is a projection of the OUTCOME record's own fields, and an outcome
//   record carries NO domain claim: it says, in full,
//   `E-DT-1-Hp cluster 8: verifier verdict "supported" on subject hypgen:ownership|plugin/scripts/…`.
//   The claim lives in the records the evidence store filed under the SAME `subject_key` — the
//   `hypothesis` and the `counterexample`. MEASURED over the shipped store: the derived summary
//   carries 0.000 of the linked claim records' content tokens (after subtracting the subject's own
//   file tokens), a JOINED representation carries 1.000, and the methods that round induced carry
//   0.034-0.111. The reflection step was shown the pipeline's own bookkeeping, so it induced methods
//   about the bookkeeping.
//   ⇒ `subject_key` is the join key because it is the ONE key the store puts on EVERY claim-bearing
//   kind, and it is already the identity the anti-cheat isolation uses.

/** The record kinds that STATE a domain claim about a subject. `evidence` records LOCATE a reading but
 *  assert nothing, so they are carried as citations, never as a claim. */
export const CLAIM_BEARING_KINDS = Object.freeze(["hypothesis", "counterexample"]);

/**
 * The join outcome, THREE-VALUED (硬规则 3b): "here is the claim", "I looked and the store files no
 * claim for this subject", and "I could not look at all" are three different facts, and collapsing any
 * two of them would make an absent index read exactly like an absent claim.
 */
export const JOIN_LINKED = "linked";
export const JOIN_NO_CLAIM_RECORD = "no-linked-claim-record";
export const JOIN_INDEX_UNAVAILABLE = "claim-index-unavailable";

/**
 * Index evidence-store records by `subject_key`. PURE. Records without a `subject_key` are indexed
 * under nothing (an absent key is not the empty key). Returns a `Map`, so a caller can hand the SAME
 * index to every record in a batch instead of re-scanning the store per record.
 * @param {object[]} records
 * @returns {Map<string,{claims:object[], evidence:object[]}>}
 */
export function claimIndex(records) {
  const idx = new Map();
  for (const r of Array.isArray(records) ? records : []) {
    if (!isObj(r) || !isStr(r.subject_key, 1)) continue;
    const k = String(r.subject_key);
    if (!idx.has(k)) idx.set(k, { claims: [], evidence: [] });
    const bucket = idx.get(k);
    if (CLAIM_BEARING_KINDS.includes(r.kind)) bucket.claims.push(r);
    else if (r.kind === "evidence") bucket.evidence.push(r);
  }
  return idx;
}

/**
 * Join ONE outcome record to its claim records. PURE.
 *
 * `domain_claim` is the text the reflection step needs and the outcome cannot supply: each linked
 * claim's own `statement`, prefixed by the hypothesis a `counterexample` names (that field holds the
 * hypothesis verbatim, so a run that persisted only its counterexamples still hands over the claim).
 * `citations` are the file:line references both kinds carry — the evidence a reviewer can re-read.
 *
 * @param {object} outcome
 * @param {Map|null} index  from `claimIndex`; `null` means the index could not be built at all
 * @returns {{status:string, domain_claim:string|null, claims:object[], citations:string[],
 *            hypothesis_refs:string[], counterexample_refs:string[]}}
 */
export function joinOutcomeToClaims(outcome, index) {
  const none = { status: JOIN_INDEX_UNAVAILABLE, domain_claim: null, claims: [], citations: [], hypothesis_refs: [], counterexample_refs: [] };
  if (index === null || index === undefined) return none;
  if (!isObj(outcome) || !isStr(outcome.subject_key, 1)) {
    return { ...none, status: JOIN_NO_CLAIM_RECORD };
  }
  const bucket = index.get(String(outcome.subject_key));
  const claims = Array.isArray(bucket?.claims) ? bucket.claims : [];
  const evidence = Array.isArray(bucket?.evidence) ? bucket.evidence : [];
  if (claims.length === 0) return { ...none, status: JOIN_NO_CLAIM_RECORD };
  const parts = [];
  for (const c of claims) {
    if (c.kind === "counterexample") {
      const of = isStr(c.counterexample_of, 1) ? `${String(c.counterexample_of)} ` : "";
      parts.push(`${of}${String(c.statement ?? "")}`.trim());
    } else {
      parts.push(String(c.statement ?? ""));
    }
  }
  const claimText = parts.filter((p) => p.length > 0).join(" ");
  const citations = [...new Set([
    ...claims.flatMap((c) => (Array.isArray(c.source_evidence) ? c.source_evidence : [])),
    ...evidence.map((e) => e.ref),
  ].filter((x) => isStr(x, 1)))];
  return {
    status: JOIN_LINKED,
    domain_claim: claimText.length > 0 ? claimText : null,
    claims: claims.map((c) => ({ id: c.id ?? null, kind: c.kind, statement: c.statement ?? null, counterexample_of: c.counterexample_of ?? null })),
    citations,
    hypothesis_refs: claims.filter((c) => c.kind === "hypothesis").map((c) => c.id).filter((x) => isStr(x, 1)),
    counterexample_refs: claims.filter((c) => c.kind === "counterexample").map((c) => c.id).filter((x) => isStr(x, 1)),
  };
}

/**
 * A PROJECTION of the record's own text — never an interpretation of it.
 *
 * ⛔ The audit's defect was a HAND-WRITTEN summary that stated the answer ("paired with two divergent
 * keys"), which then went verbatim into the reflection prompt. A derived summary therefore composes
 * only what the record already says: its `experiment_ref` (or, failing that, its own id), its stored
 * `verdict`, its `subject_key`, and its `verdict_reason` when one is recorded.
 *
 * ⛔ …AND, when the caller supplies a JOIN (`join`), the linked claim records' own text — see
 * `joinOutcomeToClaims`. The claim is APPENDED, never paraphrased, and the outcome-derived prefix is
 * kept so a reader can still see which record this summary came from.
 *
 * @param {object} rec @param {object} [o] `{join}` — the `joinOutcomeToClaims` result, or `null`
 * @returns {string} at most `MAX_SUMMARY_CHARS` characters
 */
export function deriveExperienceSummary(rec, { join = null } = {}) {
  const base = isStr(rec?.experiment_ref, 1) ? String(rec.experiment_ref)
    : isStr(rec?.experiment, 1) ? String(rec.experiment)
    : String(rec?.id ?? "outcome");
  const subject = isStr(rec?.subject_key, 1) ? String(rec.subject_key) : "(no subject_key recorded)";
  let s = `${base}: verifier verdict "${String(rec?.verdict)}" on subject ${subject}`;
  if (isStr(rec?.verdict_reason, 1)) s += ` [reason: ${rec.verdict_reason}]`;
  if (isStr(join?.domain_claim, 1)) s += ` — ${join.domain_claim}`;
  return s.slice(0, MAX_SUMMARY_CHARS);
}

/**
 * The pre-registration pin of a record: `rec.prereg` names a JSON file whose `pin` is the commit the
 * expectation was registered against. `null` is its OWN value (硬规则 3b) — "there is no pin I could
 * resolve" must never be shaped like a pin, because a pin is what makes an Experience usable as a
 * held-out case (`validateGeneralization` refuses `NO_EVALUATION_PIN` without one).
 *
 * A missing path, an unreadable file, malformed JSON, or a missing/non-string `pin` all yield `null`;
 * the reasons are returned for a caller that wants to report WHY (the batch ingester records them).
 * @param {object} rec @param {object} [deps] `{readFile}` — injected so this stays testable without fs
 * @returns {{pin:string|null, prereg:string|null, reason:string|null}}
 */
export function evaluationPinOf(rec, { readFile = (p) => fs.readFileSync(p, "utf8") } = {}) {
  const prereg = isStr(rec?.prereg, 1) ? String(rec.prereg) : null;
  if (prereg === null) return { pin: null, prereg: null, reason: "NO_PREREG_RECORDED" };
  let text;
  try { text = readFile(prereg); }
  catch (e) { return { pin: null, prereg, reason: `PREREG_UNREADABLE:${e?.code ?? e?.message}` }; }
  let doc;
  try { doc = JSON.parse(String(text)); }
  catch { return { pin: null, prereg, reason: "PREREG_UNPARSEABLE" }; }
  if (!isObj(doc) || !isStr(doc.pin, 1)) return { pin: null, prereg, reason: "PREREG_HAS_NO_PIN" };
  return { pin: String(doc.pin), prereg, reason: null };
}

/** A task id is a bare path SEGMENT — anything else is refused before it can reach a git invocation. */
const TASK_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/**
 * `tasks/<id>.md`'s `status:` on the DEVELOP branch of the shared checkout — `null` when it cannot be
 * read (no such task, no develop branch, no git). ⛔ `null` never means "not done": an UNREADABLE
 * status must not be reported as a status, or "I could not check" would silently become "yes, fixed"
 * (硬规则 3b — and that is the direction that puts a false `found-and-fixed` in the ledger).
 */
export function taskStatusOnDevelop(root, taskId) {
  if (!isStr(taskId, 1) || !TASK_ID_RE.test(String(taskId))) return null;
  const rr = resolveCarrierRoot(root);
  if (!rr.ok) return null;
  const r = spawnSync("git", ["-C", rr.root, "show", `develop:tasks/${taskId}.md`], { encoding: "utf8" });
  if (r.error || r.status !== 0 || typeof r.stdout !== "string") return null;
  const m = /^status:[ \t]*(\S+)[ \t]*$/m.exec(r.stdout);
  return m ? m[1].replace(/^["']|["']$/g, "") : null;
}

/**
 * Derive EVERY Experience field of an outcome record. PURE: the facts a record cannot carry about its
 * own surroundings are INJECTED — `taskStatus(taskId)` (what develop says),
 * `laterOutcomeWithSubjectKey(subjectKey, line)` (does a later outcome exist on the same subject), and
 * `claimIndex` (which records the store filed under the same `subject_key`). Injecting them is what
 * keeps this function a measurement of the record rather than a second scanner.
 *
 * @param {object} [deps]
 * @param {Map|null} [deps.claimIndex] from `claimIndex`; `null` = the index could not be built, which
 *   is its OWN value on the record (`join_status: "claim-index-unavailable"`), never the same shape as
 *   "the store files no claim for this subject".
 * @returns {{ok:true, fields:{role,components,summary,evaluation_pin,domain_claim,join_status,claim_refs,claim_citations}}|{ok:false, reasons:string[]}}
 */
export function deriveExperienceFields(rec, { line = null, taskStatus = () => null, laterOutcomeWithSubjectKey = () => false, verdictRole = VERDICT_ROLE, claimIndex: claimIdx = null } = {}) {
  if (!isObj(rec)) return { ok: false, reasons: ["RECORD_NOT_OBJECT"] };
  let role = verdictRole[rec.verdict] ?? null;
  if (role === null) {
    return { ok: false, reasons: [`VERDICT_NOT_INGESTIBLE:${String(rec.verdict)}-is-not-a-discovery-finding-verdict`] };
  }
  // The elevation is only reachable from a SUPPORTED finding: `found-and-fixed` and
  // `recurred-after-fix` both require a `supported` verdict in ROLE_VERDICT_COMPAT, so elevating a
  // refuted/undetermined outcome would manufacture a role the evidence cannot support.
  if (role === "found-unresolved" && isStr(rec.task_id, 1) && taskStatus(rec.task_id) === "done") {
    role = laterOutcomeWithSubjectKey(rec.subject_key, line) ? "recurred-after-fix" : "found-and-fixed";
  }
  const join = joinOutcomeToClaims(rec, claimIdx);
  return {
    ok: true,
    fields: {
      role,
      components: componentsFromSubjectKey(rec.subject_key),
      summary: deriveExperienceSummary(rec, { join }),
      evaluation_pin: evaluationPinOf(rec).pin,
      // The claim the outcome cannot state, plus its provenance. Kept as SEPARATE fields rather than
      // only folded into the 400-char `summary`: a long claim must not be truncated away by a bound
      // that exists for a different projection.
      domain_claim: join.domain_claim,
      join_status: join.status,
      claim_refs: [...join.hypothesis_refs, ...join.counterexample_refs],
      claim_citations: join.citations,
    },
  };
}

// ── the ONE unified entry: EVERY source goes through it ──────────────────────────────────────────

/**
 * Ingest ONE Experience. The single entry point for every source (Plan item 1):
 *   • `source:"user"`   — a human-flagged miss; the caller narrates it (`ingestFeedback`).
 *   • `source:"system"` — an evidence-store outcome; the fields are DERIVED unless the caller
 *                          explicitly opts into pinned narration (see below).
 *   • `source:"discovery-carrier"` — a ROUTINE's own carrier record (`{rec, raw, line}`); the caller
 *                          narrates the role/summary and the role is CHECKED against the record.
 *
 * @param {string} root
 * @param {object} args
 * @param {"user"|"system"|"discovery-carrier"} args.source  — anything else is `SOURCE_NOT_IN_VOCAB`,
 *   never a default
 * @param {object} [args.outcome]   `{rec, raw, line}` — a record already resolved by a scanner. When
 *   absent, `source:"system"` resolves it from the store via `experiment` + `experimentRef`.
 * @param {object} [args.context]   `{taskStatus, laterOutcomeWithSubjectKey}` — the two facts a record
 *   cannot carry about its surroundings (see `deriveExperienceFields`).
 * @param {object} [args.narration] `{role, caseId, components, summary, ts}` — the PINNED form. Its
 *   presence means the caller is asserting the narration, which is then CHECKED against the record's
 *   verdict; without it, `role`/`components`/`summary`/`caseId` supplied at the top level are REFUSED
 *   (`SYSTEM_FIELD_NOT_CALLER_WRITABLE`) because the whole point of the automatic source is that no
 *   human picks the record or describes it.
 * @returns the `appendExperienceRecord` result, or `{ok:false, appended:false, reasons[]}`.
 */
export function ingestExperience(root, args = {}) {
  const source = args?.source;
  if (source === "user") return ingestUserSource(root, args);
  if (source === "system") return ingestSystemSource(root, args);
  if (source === "discovery-carrier") return ingestCarrierSource(root, args);
  return { ok: false, appended: false, kind: EXPERIENCE_KIND, reasons: [`${SOURCE_NOT_IN_VOCAB}:${String(source)}-must-be-user-or-system-or-discovery-carrier`] };
}

// ── SOURCE 1: the manual path (reported_by:"user") ──────────────────────────────────────────────

/**
 * Turn a human-flagged miss into an Experience entry. The MANUAL adapter, and the ONLY one whose
 * `source_ref` is `null` — a human report is not derived from any single carrier record.
 *
 * @param {string} root
 * @param {object} args
 * @param {string} args.caseId       stable, human-assignable id (e.g. "TEACH-probe-meta-coupling")
 * @param {string} args.role         one of EXPERIENCE_ROLES
 * @param {string} [args.reportedBy] `"user"` (default) — the manual path's only sensible source
 * @param {Array<string|{ref:string,sha256:string}>} args.evidenceRefs
 *   Each entry is either an object `{ref, sha256}` with a real 64-hex digest, or a plain STRING ref
 *   (a task id / experiment id). A string has no carrier line to hash, so its digest is
 *   `sha256(ref)` — the content address of the CITATION itself, which keeps the citation immutable
 *   and tamper-evident rather than decorative.
 * @param {string[]} [args.components] repo-relative files (used ONLY by the anti-leak deny-list)
 * @param {string} args.summary        >= MIN_SUMMARY_CHARS non-whitespace chars
 * @param {string} [args.ts]           ISO-8601; defaults to now
 * @param {{actor:string, ref:string}} args.authoredBy  WHO wrote this entry. ⛔ REQUIRED, and NOT
 *   defaulted: a default would relabel a worker's own finding as an operator report, which is the
 *   exact defect this field exists to make impossible (see the header).
 * @param {{kind:string, ref:string, quote:string}} [args.userProvenance]  the human's own words.
 *   Required whenever `reportedBy` is `"user"`, and refused on a derived (`"system"`) entry.
 */
export function ingestFeedback(root, { caseId, role, reportedBy = "user", evidenceRefs, components = [], summary, ts, authoredBy, userProvenance, evidenceLevel, sourceCaseId } = {}) {
  return ingestExperience(root, { source: "user", caseId, role, reportedBy, evidenceRefs, components, summary, ts, authoredBy, userProvenance, evidenceLevel, sourceCaseId });
}

function ingestUserSource(root, { caseId, role, reportedBy = "user", evidenceRefs, components = [], summary, ts, authoredBy, userProvenance, evidenceLevel, sourceCaseId } = {}) {
  const evidence = (Array.isArray(evidenceRefs) ? evidenceRefs : []).map((e) =>
    isObj(e) ? { ref: e.ref, sha256: e.sha256 } : { ref: e, sha256: sha256(String(e)) });
  return appendExperienceRecord(root, {
    case_id: caseId,
    ts: ts ?? new Date().toISOString(),
    role,
    reported_by: reportedBy,
    // ⛔ Both of these are PASSED THROUGH and never defaulted — see `ingestFeedback`. An absent
    // `authoredBy` reaches the validator as `SCHEMA_MISSING:authored_by` and the record is refused, so
    // the honest answer to "who wrote this?" is never replaced by a plausible-looking guess.
    authored_by: authoredBy,
    source_ref: null,             // forced — the manual path has no single source record
    evidence,
    components,
    summary,
    evaluation_pin: null,         // a human report has no pre-registration to be pinned to
    user_provenance: userProvenance,
    // ⛔ The level is DECLARED or it is `unlabelled` — never inferred from the role, the components or
    // the reporter. A caller that does not say what its evidence is worth gets `unlabelled`, which can
    // never license a promotion; defaulting to a LEVEL would be inventing the one fact only the
    // experimenter knows (硬规则 3b/6).
    evidence_level: evidenceLevelOf({ evidence_level: evidenceLevel }),
    // `null` is the honest "no case was reused" — and for a `teaching`/`transfer` entry the validator
    // REFUSES it, so the requirement bites at the one place that can still tell the two apart.
    source_case_id: sourceCaseId ?? null,
  });
}

/** The author a DERIVED (narrated-by-nobody) system entry carries. A constant, not a parameter: the
 *  whole point of the derived form is that no caller picks anything, including who wrote it. */
export const DERIVED_INGEST_AUTHOR = Object.freeze({ actor: "ingester", ref: "ingestNewOutcomes" });

// ── SOURCE 2: the automatic path (reported_by:"system") — the load-bearing new piece ────────────

/**
 * Convert an EXISTING `architecture-evidence-store.jsonl` OUTCOME record into an Experience entry.
 *
 * ⛔ TWO FORMS, and the difference is the whole task. Called with NO narration (`args.narration`
 * absent) the fields are DERIVED from the record — that is the form `ingestNewOutcomes` uses, and the
 * form in which a caller-supplied `role`/`components`/`summary`/`caseId` is REFUSED. Called WITH
 * `narration`, the caller asserts those fields and they are CHECKED against the record's stored
 * verdict (this is the pre-existing, pinned adapter's contract — a caller that has a specific case in
 * mind but must not be able to claim a role the evidence contradicts).
 *
 * The record is located either by an already-resolved `outcome:{rec, raw, line}` (a scanner's result)
 * or by `experiment` + a match on `experiment_ref` (exact, or the ref as a substring of the record's
 * own — e.g. `"cluster 11"` matches `"E-DT-1-Hp cluster 11"`). Ingestion REFUSES when the named record
 * does not exist (never fabricates one) and when the match is AMBIGUOUS (枚举, not boolean — an
 * ambiguous ref is reported with the candidates, never resolved arbitrarily).
 *
 * Derivation (⛔ never hand-written): `source_ref` = the record's `id`; `evidence` =
 * `[{ref: <id>, sha256: sha256(<the record's raw carrier line>)}]`; `ts` = the record's own `ts`;
 * `evaluation_pin` = the record's pre-registration `pin`, or `null`.
 */
export function ingestFromEvidenceStoreOutcome(root, { experiment, experimentRef, role, components = [], summary, caseId, ts, authoredBy, evidenceLevel, sourceCaseId } = {}) {
  return ingestExperience(root, {
    source: "system",
    experiment,
    experimentRef,
    narration: { role, caseId, components, summary, ts },
    authoredBy,
    evidenceLevel,
    sourceCaseId,
  });
}

/** Resolve the outcome record an ingestion projects — from a scanner's envelope, or from the store. */
function resolveOutcomeForIngest(root, args) {
  const o = args?.outcome;
  if (isObj(o) && isObj(o.rec)) {
    if (o.rec.kind !== "outcome") return { ok: false, reasons: [`OUTCOME_RECORD_KIND_MISMATCH:${String(o.rec.kind)}-is-not-an-outcome`] };
    if (!isStr(o.rec.id, 1)) return { ok: false, reasons: ["INGEST_ARG_MISSING:outcome.id"] };
    if (typeof o.raw !== "string") return { ok: false, reasons: ["INGEST_ARG_MISSING:outcome.raw"] };
    if (!isInt(o.line) || o.line < 1) return { ok: false, reasons: ["INGEST_ARG_MISSING:outcome.line"] };
    return { ok: true, rec: o.rec, raw: o.raw, line: o.line };
  }

  const file = sharedStoreFile(root);
  if (file === null) {
    const rr = resolveCarrierRoot(root);
    return { ok: false, reasons: [rr.reason] };
  }
  // ⛔ THIS LOOKUP KEEPS `EVIDENCE_STORE_MISSING` — deliberately, and it is not the defect the batch
  //    ingester had (see `ensureEvidenceStore`). The two callers differ in what "absent" MEANS to them:
  //    the batch ingester's job is "ingest whatever is there", so "nothing is there" is a legitimate
  //    zero-work ANSWER and bootstrapping converges it; this one was handed the NAME of a specific
  //    outcome record, and an absent store cannot be repaired into containing it — creating an empty
  //    carrier would only downgrade a precise finding ("there is no store at all") into a vaguer one
  //    ("no record matched"), on a read path that would then have a write side effect. Absent is the
  //    honest, more informative reading here, and no resident routine reaches this function (its only
  //    callers are tests), so it is not a gate anything is stuck behind.
  if (!fs.existsSync(file)) {
    return { ok: false, reasons: [`EVIDENCE_STORE_MISSING:${EVIDENCE_STORE_REL}-not-present-under-${path.dirname(path.dirname(file))}`] };
  }
  let text;
  try { text = fs.readFileSync(file, "utf8"); }
  catch (e) { return { ok: false, reasons: [`${EVIDENCE_STORE_UNREADABLE}:${EVIDENCE_STORE_REL}:${e?.code ?? e?.message}`] }; }

  // Read the carrier RAW so each candidate keeps its 1-based line number and its exact line text —
  // the sha256 the evidence entry carries is the hash OF THAT LINE, so it must be the same bytes.
  const candidates = [];
  splitStoreLines(text).forEach((line, i) => {
    let rec; try { rec = JSON.parse(line); } catch { return; }
    if (!isObj(rec) || rec.kind !== "outcome") return;
    if (rec.experiment !== args.experiment) return;
    if (!(typeof rec.experiment_ref === "string" && rec.experiment_ref.includes(args.experimentRef))) return;
    candidates.push({ rec, lineNo: i + 1, raw: line });
  });

  if (candidates.length === 0) {
    return { ok: false, reasons: [`EVIDENCE_OUTCOME_NOT_FOUND:${args.experiment}#${args.experimentRef}`] };
  }
  if (candidates.length > 1) {
    return {
      ok: false,
      reasons: [`EVIDENCE_OUTCOME_AMBIGUOUS:${args.experiment}#${args.experimentRef}-matches-${candidates.length}-records`],
      matches: candidates.map((c) => ({ id: c.rec.id, experiment_ref: c.rec.experiment_ref, line: c.lineNo })),
    };
  }
  const m = candidates[0];
  return { ok: true, rec: m.rec, raw: m.raw, line: m.lineNo };
}

/** The record an ingestion appends, from the resolved outcome + the fields (derived or narrated). */
function systemRecord(rec, raw, fields, { caseId, ts, authoredBy, evidenceLevel, sourceCaseId }) {
  return {
    case_id: caseId,
    ts: ts ?? (isStr(rec.ts, 4) ? rec.ts : new Date().toISOString()),
    role: fields.role,
    reported_by: "system",
    authored_by: authoredBy,
    source_ref: rec.id,
    evidence: [{ ref: rec.id, sha256: sha256(raw) }],
    components: fields.components,
    summary: fields.summary,
    evaluation_pin: fields.evaluation_pin ?? null,
    // The JOIN (see `joinOutcomeToClaims`): the domain claim the outcome record cannot state, the
    // records it came from, and the READING of whether a claim was found at all. All three are written
    // even when the claim is absent — `join_status` is what keeps "no claim filed" from reading like
    // "a claim exists but is empty". The pinned-narration path leaves them `null`/absent: a caller who
    // narrated the entry supplied its text directly and there is no outcome to join.
    domain_claim: fields.domain_claim ?? null,
    join_status: fields.join_status ?? null,
    claim_refs: Array.isArray(fields.claim_refs) ? fields.claim_refs : [],
    claim_citations: Array.isArray(fields.claim_citations) ? fields.claim_citations : [],
    // The DERIVED form's evidence level is ALWAYS `unlabelled`: an outcome record projected out of the
    // evidence store carries no statement about whether its case was known in advance, and the ingester
    // narrates nothing (that is its whole contract). The PINNED form passes the caller's declaration
    // through, because there the caller is asserting the case's provenance by hand.
    evidence_level: evidenceLevelOf({ evidence_level: evidenceLevel }),
    source_case_id: sourceCaseId ?? null,
  };
}

/** The `case_id` of a DERIVED entry: deterministic, unique per source record, chosen by nobody. */
const derivedCaseId = (rec) => `EXP-${String(rec.id).replace(/^outcome-/, "")}`;

function ingestSystemSource(root, args) {
  const narration = isObj(args?.narration) ? args.narration : null;

  if (narration === null) {
    // The deriving form. Any field that must be derived is REFUSED rather than ignored: silently
    // dropping a caller's summary would make "I wrote what I saw" indistinguishable from "it was
    // derived" (硬规则 3b) — and the audit's defect was exactly a hand-written summary.
    // `authoredBy` is on that list for the same reason and one more: the derived form has NO caller
    // narrating, so it has no caller to be the author. Accepting one would let a worker stamp
    // `operator-session` on an entry it did not narrate.
    const forbidden = ["role", "components", "summary", "caseId", "case_id", "authoredBy"].filter((f) => supplied(args, f));
    if (forbidden.length) {
      return {
        ok: false, appended: false, kind: EXPERIENCE_KIND,
        reasons: forbidden.map((f) => `${SYSTEM_FIELD_NOT_CALLER_WRITABLE}:${f}-is-derived-from-the-record-when-source=system`),
      };
    }
  } else {
    // The pinned form. The arg guards live HERE (one definition, one order) so the pinned adapter is a
    // pure forwarder and cannot drift from the codes its callers were written against.
    if (!isStr(args.experiment, 1)) return { ok: false, appended: false, kind: EXPERIENCE_KIND, reasons: ["INGEST_ARG_MISSING:experiment"] };
    if (!isStr(args.experimentRef, 1)) return { ok: false, appended: false, kind: EXPERIENCE_KIND, reasons: ["INGEST_ARG_MISSING:experimentRef"] };
    // `caseId` is the entry's identity and is the CALLER's to choose in the PINNED form — a default
    // derived from the matched record would silently mint an id the caller never picked (and one that
    // changes if the record's id scheme ever does), so its absence is its own refusal, never a
    // derivation. (The DERIVED form does mint one — `derivedCaseId` — because nobody is there to pick.)
    if (!isStr(narration.caseId, 1)) return { ok: false, appended: false, kind: EXPERIENCE_KIND, reasons: ["INGEST_ARG_MISSING:caseId"] };
    if (!EXPERIENCE_ROLES.includes(narration.role)) return { ok: false, appended: false, kind: EXPERIENCE_KIND, reasons: [`ROLE_NOT_IN_VOCAB:${String(narration.role)}`] };
    // …and so is the AUTHOR, for exactly the same reason: the pinned caller narrates this entry, so the
    // pinned caller is the one that has to say who it is. No default.
    if (!isObj(args.authoredBy) || !AUTHORED_BY_ACTORS.includes(args.authoredBy.actor) || !isStr(args.authoredBy.ref, 1)) {
      return { ok: false, appended: false, kind: EXPERIENCE_KIND, reasons: ["INGEST_ARG_MISSING:authoredBy-{actor,ref}"] };
    }
  }

  const res = resolveOutcomeForIngest(root, args);
  if (!res.ok) {
    return { ok: false, appended: false, kind: EXPERIENCE_KIND, reasons: res.reasons, ...(res.matches ? { matches: res.matches } : {}) };
  }
  const { rec, raw, line } = res;

  let fields;
  let caseId;
  if (narration !== null) {
    const allowed = ROLE_VERDICT_COMPAT[narration.role] ?? [];
    if (!allowed.includes(rec.verdict)) {
      return {
        ok: false, appended: false, kind: EXPERIENCE_KIND,
        reasons: [`ROLE_VERDICT_INCONSISTENT:role=${narration.role}-requires-verdict-in-(${allowed.join("|")})-but-${rec.id}-stored-${String(rec.verdict)}`],
      };
    }
    fields = {
      role: narration.role,
      components: Array.isArray(narration.components) ? narration.components : [],
      summary: narration.summary,
      evaluation_pin: evaluationPinOf(rec).pin,
    };
    caseId = narration.caseId;
  } else {
    const ctx = isObj(args.context) ? args.context : {};
    const d = deriveExperienceFields(rec, {
      line,
      taskStatus: typeof ctx.taskStatus === "function" ? ctx.taskStatus : (id) => taskStatusOnDevelop(root, id),
      laterOutcomeWithSubjectKey: typeof ctx.laterOutcomeWithSubjectKey === "function" ? ctx.laterOutcomeWithSubjectKey : () => false,
      verdictRole: isObj(ctx.verdictRole) ? ctx.verdictRole : VERDICT_ROLE,
      // `undefined` (no context supplied) becomes `null`, which is the join's own "could not look"
      // value — an ABSENT index must never be silently shaped like "the store files no claim".
      claimIndex: ctx.claimIndex === undefined ? null : ctx.claimIndex,
    });
    if (!d.ok) return { ok: false, appended: false, kind: EXPERIENCE_KIND, reasons: d.reasons };
    fields = d.fields;
    caseId = derivedCaseId(rec);
  }

  // The author is fixed on the derived form and caller-declared on the pinned form (see the guards
  // above); neither is defaulted here, so this line cannot reintroduce the defect the guards close.
  const authoredBy = narration === null ? DERIVED_INGEST_AUTHOR : args.authoredBy;
  const out = appendExperienceRecord(root, systemRecord(rec, raw, fields, {
    caseId, ts: args.ts, authoredBy, evidenceLevel: args.evidenceLevel, sourceCaseId: args.sourceCaseId,
  }));
  // Surface WHERE it came from on acceptance — the derivation is the point of this adapter, and a
  // caller that cannot see the matched line cannot check that it matched the right one.
  return out.ok
    ? { ...out, derived: narration === null, derived_from: { id: rec.id, line, verdict: rec.verdict, experiment_ref: rec.experiment_ref } }
    : out;
}

// ── SOURCE 3: a ROUTINE CARRIER record (reported_by:"system") ───────────────────────────────────
//
// The third source, added by gap-open-discovery-findings-into-portfolio-experience. Sources 1 and 2 both
// project the EVIDENCE STORE's outcome records; this one projects a record from a ROUTINE's own carrier,
// which is a different shape with a different verdict vocabulary and therefore needs its own arm rather
// than a coercion into `ingestSystemSource` (a coercion would have to invent a `verdict` field the
// routine never writes — the exact "the record does not contain it" defect `VERDICT_ROLE` refuses).

/** The ONE record kind this source projects. Named, so a carrier that gains a second kind cannot be read
 *  as if every line were a finding. */
export const CARRIER_CLUSTER_KIND = "cluster";

/**
 * The EFFECTIVE verdict of a routine cluster record — what the carrier's own fields jointly say.
 *
 * ⛔ DERIVED here, never taken from the caller, and never from a hand-written `verdict` key: the routine
 * writes `confirmed` (survived an independent refutation), `verifier_verdict` and `refutation_verdict`,
 * and THIS function is the one place those three become the word the role check compares against. A
 * caller that could state the verdict could claim a `confirmed-negative` for a cluster that survived.
 *
 * Fail-closed in both directions: only `confirmed === true` yields `supported` (an unrun, undetermined or
 * refuted refutation is NOT a confirmation), and a record whose fields do not settle it is `undetermined`
 * — never `supported`.
 * @returns {"supported"|"refuted"|"undetermined"|null} `null` when the argument is not a record.
 */
export function clusterVerdict(rec) {
  if (!isObj(rec)) return null;
  if (rec.confirmed === true) return "supported";
  if (rec.refutation_verdict === "refuted" || rec.verifier_verdict === "refuted") return "refuted";
  return "undetermined";
}

/** The `case_id` convention for a carrier-sourced Experience: the carrier record's own id, prefixed. */
export const clusterCaseId = (recordId) => `EXP-${String(recordId)}`;

/**
 * Project a ROUTINE CARRIER record (a `kind:"cluster"` line) into an Experience entry.
 *
 * ⛔ `source:"discovery-carrier"` — the record is supplied ALREADY RESOLVED as `{rec, raw, line}` (the
 * scanner's envelope, the same one `ingestFromEvidenceStoreOutcome` accepts), so the `raw` bytes are the
 * exact line the evidence hash is taken over. A record with no `record_id` is REFUSED rather than given a
 * derived one: the id is what makes the carrier record re-findable, and minting one here would produce a
 * back-pointer that resolves to nothing (硬规则 3b).
 *
 * The caller NARRATES `role`, `summary`, `components`, `caseId` and `authoredBy` — it is the ingesting
 * process and it is the one that read the record — and its `role` is CHECKED against the record's derived
 * `clusterVerdict`, so a role the evidence contradicts is refused here exactly as it is on source 2's
 * pinned form.
 *
 * @param {string} root
 * @param {object} args
 * @param {{rec:object, raw:string, line:number}} args.record
 * @param {string} args.carrier   the carrier the record came from, recorded so the projection is auditable
 * @param {string} args.role      one of EXPERIENCE_ROLES
 * @param {string} args.caseId    the entry's id (see `clusterCaseId`)
 * @param {string} args.summary   >= MIN_SUMMARY_CHARS non-whitespace chars
 * @param {string[]} [args.components]  defaults to the record's own `components` — never invented
 * @param {{actor:string, ref:string}} args.authoredBy
 * @param {string} [args.evidenceLevel]
 * @returns the `appendExperienceRecord` result, or `{ok:false, appended:false, reasons[]}`.
 */
function ingestCarrierSource(root, args) {
  const env = isObj(args?.record) ? args.record : null;
  const rec = isObj(env?.rec) ? env.rec : null;
  if (rec === null) return { ok: false, appended: false, kind: EXPERIENCE_KIND, reasons: ["INGEST_ARG_MISSING:record-{rec,raw,line}"] };
  if (rec.kind !== CARRIER_CLUSTER_KIND) {
    return { ok: false, appended: false, kind: EXPERIENCE_KIND, reasons: [`CARRIER_RECORD_KIND_MISMATCH:${String(rec.kind)}-is-not-a-${CARRIER_CLUSTER_KIND}`] };
  }
  if (!isStr(rec.record_id, 1)) {
    return { ok: false, appended: false, kind: EXPERIENCE_KIND, reasons: ["CARRIER_RECORD_ID_MISSING:the-record-carries-no-id-so-no-experience-can-point-back-at-it"] };
  }
  if (typeof env.raw !== "string") return { ok: false, appended: false, kind: EXPERIENCE_KIND, reasons: ["INGEST_ARG_MISSING:record.raw"] };
  if (!isInt(env.line) || env.line < 1) return { ok: false, appended: false, kind: EXPERIENCE_KIND, reasons: ["INGEST_ARG_MISSING:record.line"] };
  if (!isStr(args.carrier, 1)) return { ok: false, appended: false, kind: EXPERIENCE_KIND, reasons: ["INGEST_ARG_MISSING:carrier"] };

  // The narration guards live HERE, in one place, exactly as source 2's do — and every one of them is a
  // REFUSAL rather than a default, for the same reason: a defaulted role/summary/author would be
  // indistinguishable on read-back from one the ingesting process actually wrote.
  if (!EXPERIENCE_ROLES.includes(args.role)) return { ok: false, appended: false, kind: EXPERIENCE_KIND, reasons: [`ROLE_NOT_IN_VOCAB:${String(args.role)}`] };
  if (!isStr(args.caseId, 1)) return { ok: false, appended: false, kind: EXPERIENCE_KIND, reasons: ["INGEST_ARG_MISSING:caseId"] };
  if (!isObj(args.authoredBy) || !AUTHORED_BY_ACTORS.includes(args.authoredBy.actor) || !isStr(args.authoredBy.ref, 1)) {
    return { ok: false, appended: false, kind: EXPERIENCE_KIND, reasons: ["INGEST_ARG_MISSING:authoredBy-{actor,ref}"] };
  }

  const verdict = clusterVerdict(rec);
  const allowed = ROLE_VERDICT_COMPAT[args.role] ?? [];
  if (!allowed.includes(verdict)) {
    return {
      ok: false, appended: false, kind: EXPERIENCE_KIND,
      reasons: [`ROLE_VERDICT_INCONSISTENT:role=${args.role}-requires-verdict-in-(${allowed.join("|")})-but-${rec.record_id}-derives-${String(verdict)}`],
    };
  }

  const evidenceLevel = evidenceLevelOf({ evidence_level: args.evidenceLevel });
  const out = appendExperienceRecord(root, {
    case_id: args.caseId,
    ts: isStr(rec.ts, 4) ? rec.ts : new Date().toISOString(),
    role: args.role,
    reported_by: "system",
    authored_by: args.authoredBy,
    // The back-pointer AND the content address: `record_id` names the carrier line, and the digest is of
    // THAT line's bytes, so the projection can be re-checked against the record it claims to be.
    source_ref: rec.record_id,
    evidence: [{ ref: rec.record_id, sha256: sha256(env.raw) }],
    components: Array.isArray(args.components) ? args.components : (Array.isArray(rec.components) ? rec.components : []),
    summary: args.summary,
    evaluation_pin: null,
    evidence_level: evidenceLevel,
    source_case_id: args.sourceCaseId ?? null,
  });
  return out.ok
    ? { ...out, derived: true, derived_from: { record_id: rec.record_id, line: env.line, carrier: args.carrier, verdict } }
    : out;
}

// ── SOURCE 3, THE WRITE SIDE: a routine's own carrier cluster → the EVIDENCE STORE ────────────────
//
// ⛔ THE DEFECT THIS CLOSES (gap-evidence-store-has-no-resident-producer-so-discovery-method-ingests-
//    nothing-forever). `ingestNewOutcomes` — the batch ingester `discovery_method` runs every round —
//    reads the EVIDENCE STORE. Nothing resident ever WROTE that store: the only writers were manual
//    `--write-store` CLI runs, so on a host where no human had ever run one, discovery_method reported
//    `ingested 0` forever. After the bootstrap fix (gap-discovery-method-evidence-store-never-
//    autonomously-populated) that perpetual zero stopped reading as `failed` and started reading as
//    «nothing new this round» — the SAME shape a healthy empty round has, so a capability that could
//    never ingest anything was indistinguishable from one that had simply nothing to do (硬规则 4).
//
// ⛔ WHAT THIS IS NOT. It is NOT a second finding path and it is NOT a summary of one. `ingestRoundClusters`
//    (source 3's read side, in the OSD routine) files the SAME clusters into the Experience ledger
//    directly; this projects the SAME carrier record into the store's own RECORD SHAPES so the store —
//    the ONE carrier the batch ingester reads — stops being a permanently empty file. The verdict is
//    `clusterVerdict` (the ONE derivation, reused), the claim is the cluster's own `claim`, the citations
//    are the cluster's own `evidence_lines`: nothing here is written that the record does not already say.

/** The `experiment` every store record this module projects is filed under — the routine's own name. */
export const CLUSTER_OUTCOME_EXPERIMENT = "open-semantic-discovery";

/**
 * Project ONE round's carrier cluster records into evidence-store records (`{kind, rec}` for `emit`).
 *
 * For each verdict-bearing cluster:
 *   • a `hypothesis` record carrying the cluster's OWN `claim` as `statement`, grounded in the cluster's
 *     own `evidence_lines`. It is emitted because the store's `outcome` record cannot state a domain
 *     claim, and the join (`joinOutcomeToClaims`) is what keeps a projected Experience from being the
 *     pipeline's own bookkeeping — see the JOIN note above. A cluster whose claim or citations are
 *     missing simply has no hypothesis record: nothing is invented to fill one.
 *   • an `outcome` record carrying `clusterVerdict(rec)` — the SAME three-valued derivation the
 *     Experience ingestion uses, never a second reading of the same three fields.
 *
 * ⛔ SHADOW AND BASELINE ARMS ARE EXCLUDED STRUCTURALLY, not by a flag a caller passes: a `shadow:true`
 *    record is a draft method's measurement and a `paired_arm` baseline is an instrument reading, and
 *    neither may reach the store (they reach neither the Portfolio nor the Experience ledger either).
 *    A record with no `record_id` is skipped — the id is what the outcome's `experiment_ref` names, and
 *    minting one here would produce a back-pointer that resolves to nothing (硬规则 3b).
 *
 * @param {readonly object[]} clusterRecords
 * @param {{experiment?: string, runId?: string|null}} [opts]
 * @returns {{kind: string, rec: object}[]}
 */
export function clusterStoreRecords(clusterRecords, { experiment = CLUSTER_OUTCOME_EXPERIMENT, runId = null } = {}) {
  const out = [];
  for (const rec of Array.isArray(clusterRecords) ? clusterRecords : []) {
    if (!isObj(rec) || rec.kind !== CARRIER_CLUSTER_KIND) continue;
    if (rec.shadow === true) continue;
    if (!isStr(rec.record_id, 1)) continue;
    const recordId = String(rec.record_id);
    const verdict = clusterVerdict(rec);
    if (verdict === null) continue;
    const components = (Array.isArray(rec.components) ? rec.components : []).filter((c) => isStr(c, 1)).map(String);
    // The concern-kind half of the key is the cluster's OWN `concept_kind` when the round recorded one,
    // and the routine name otherwise — `componentsFromSubjectKey` reads only the half after the bar, so
    // this never affects which files the projected Experience names.
    const subject = subjectKey(isStr(rec.concept_kind, 1) ? String(rec.concept_kind) : experiment, components);
    const ts = isStr(rec.ts, 4) ? String(rec.ts) : new Date().toISOString();
    const claim = isStr(rec.claim, 10) ? String(rec.claim) : null;
    const cited = (Array.isArray(rec.evidence_lines) ? rec.evidence_lines : []).filter((x) => isStr(x, 1)).map(String);
    if (claim !== null && cited.length > 0) {
      out.push({ kind: "hypothesis", rec: {
        statement: claim, source_evidence: cited, subject_key: subject, ts,
        hypothesis_id: recordId, case_id: recordId, experiment, run: runId,
      } });
    }
    const att = isObj(rec.attribution) ? rec.attribution : null;
    const reason = att !== null && isStr(att.blocking_step, 1) ? `${String(att.blocking_step)}${isStr(att.blocking_cause, 1) ? `:${String(att.blocking_cause)}` : ""}` : null;
    out.push({ kind: "outcome", rec: {
      experiment, experiment_ref: recordId, verdict, subject_key: subject, case_id: recordId, run: runId, ts,
      ...(reason === null ? {} : { verdict_reason: reason }),
      confirmed: rec.confirmed === true,
    } });
  }
  return out;
}

// ── the AUTOMATIC BATCH INGESTER (Plan items 2–5): outcome records → Experiences, no human in the loop ─

/** Split a store's text into lines, dropping ONLY the empty piece a trailing newline creates. */
function splitStoreLines(text) {
  const raw = String(text).split("\n");
  if (raw.length > 0 && raw[raw.length - 1] === "") raw.pop();
  return raw;
}

/** The watermark's value for "the last line processed": `{line, line_sha256}` or `null` for none. */
function watermarkValue(lines, advancedTo) {
  if (!isInt(advancedTo) || advancedTo < 1) return null;
  const line = lines[advancedTo - 1];
  if (typeof line !== "string") return null;
  return { line: advancedTo, line_sha256: sha256(line) };
}

// ── WHAT THIS RUN'S ZERO MEANS (硬规则 3b / 4): four states, never one number ─────────────────────
//
// ⛔ THE DEFECT THIS CLOSES. `ingested 0` was ONE reading covering two states that are not the same
//    fact: «this store has never held a single record — no producer is writing it» and «this store
//    holds records and none of them is new since the watermark». The first is a WIRING defect that
//    stays true forever until someone wires a producer; the second is the ordinary, healthy result of
//    running twice. Reported identically, the first was invisible: a capability structurally unable to
//    ingest anything looked exactly like one with nothing to do — a reading that cannot be non-zero,
//    carrying no information (硬规则 4).
//
// ⛔ WHY AN ENUMERATION AND NOT A BOOLEAN. The three questions are independent — did the carrier hold
//    anything at all, did this run look at anything past the watermark, did anything become an
//    Experience — and a boolean over any two of them would collapse a pair that a reader needs to tell
//    apart. `null` is its OWN value (a disabled round, an unresolvable shared checkout, a refusal that
//    happened first): the state was never established, which is a different thing from any of the four.

/** The store held NOTHING to read — no record line at all. The state that names a missing producer. */
export const STORE_STATE_EMPTY = "empty";
/** The store holds records; none of them is past the watermark. The ordinary second-run reading. */
export const STORE_STATE_NO_NEW = "no-new-since-watermark";
/** Records past the watermark were read and NONE became an Experience (all duplicates / not ingestible). */
export const STORE_STATE_SCANNED_NONE = "scanned-none-ingested";
/** At least one Experience was ingested this run. */
export const STORE_STATE_INGESTED = "ingested";

/**
 * Name this run's relationship to the store, from three readings it already holds. PURE.
 * @param {{store_records: number, scanned: number, ingested: number}} r
 * @returns {string|null} one of `STORE_STATE_*`, or `null` when the store was never read.
 */
export function storeStateOf({ store_records: storeRecords, scanned, ingested } = {}) {
  if (!isInt(storeRecords) || storeRecords < 0) return null;
  if (storeRecords === 0) return STORE_STATE_EMPTY;
  if (ingested > 0) return STORE_STATE_INGESTED;
  if (scanned > 0) return STORE_STATE_SCANNED_NONE;
  return STORE_STATE_NO_NEW;
}

/**
 * Read the batch ingester's watermark. A genuinely ABSENT watermark is `{ok:true, value:null}` — the
 * first run has nothing to be consistent with. Anything else that cannot be read as `{line, line_sha256}`
 * is REFUSED: a corrupt watermark must never be treated as "no watermark", because that would restart
 * the whole store from line 0 and re-derive every finding as if it were new (硬规则 3b).
 */
export function readIngestWatermark(root) {
  const file = carrierFile(root, INGEST_WATERMARK_REL);
  if (file === null) {
    const rr = resolveCarrierRoot(root);
    return { ok: false, file: null, value: null, reason: rr.reason };
  }
  if (!fs.existsSync(file)) return { ok: true, file, value: null, reason: null };
  let text;
  try { text = fs.readFileSync(file, "utf8"); }
  catch (e) { return { ok: false, file, value: null, reason: `${WATERMARK_UNREADABLE}:${INGEST_WATERMARK_REL}:${e?.code ?? e?.message}` }; }
  let doc;
  try { doc = JSON.parse(text); }
  catch { return { ok: false, file, value: null, reason: `${WATERMARK_UNREADABLE}:${INGEST_WATERMARK_REL}-is-not-json` }; }
  if (!isObj(doc) || !isInt(doc.line) || doc.line < 1 || !HEX64.test(String(doc.line_sha256))) {
    return { ok: false, file, value: null, reason: `${WATERMARK_UNREADABLE}:${INGEST_WATERMARK_REL}-needs-{line:integer>=1,line_sha256:64-hex}` };
  }
  return { ok: true, file, value: { line: doc.line, line_sha256: doc.line_sha256 }, reason: null };
}

/** Write the watermark atomically: a tmp file fsynced, then renamed over the target. */
function writeIngestWatermark(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}`;
  const fd = fs.openSync(tmp, "w");
  try { fs.writeSync(fd, JSON.stringify(value) + "\n"); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  fs.renameSync(tmp, file);   // atomic: a reader sees the old file or the new one, never a partial write
}

/** `null` when the watermark's line is still there and still hashes to what was recorded. */
function watermarkMismatch(wm, lines) {
  if (wm.line > lines.length) {
    return `${INGEST_WATERMARK_REL}-names-line-${wm.line}-but-the-store-now-has-only-${lines.length}-line(s)-so-it-was-truncated`;
  }
  const actual = sha256(lines[wm.line - 1]);
  if (actual !== wm.line_sha256) {
    return `line-${wm.line}-now-hashes-to-${actual}-but-the-watermark-recorded-${wm.line_sha256}`;
  }
  return null;
}

/**
 * Ingest every evidence-store `kind:"outcome"` record past the persisted watermark, deriving all
 * fields from each record. No model call of any kind.
 *
 * @param {string} root
 * @param {object} [opts]
 * @param {number} [opts.maxPerRun=Infinity]  quota on outcome records PROCESSED this run. No cap is
 *   expressed by not applying one (Infinity), never by a large literal that would silently become the
 *   real limit on some other host (硬规则 4 推论二).
 * @param {boolean} [opts.enabled=true]  `false` ⇒ ZERO reads and ZERO writes, checked first.
 * @param {object} [opts.verdictRole=VERDICT_ROLE]  the verdict→role map this run derives from. Changing
 *   it changes `mappingVersion` with it, which is what re-opens the earlier `VERDICT_NOT_INGESTIBLE`
 *   skips for re-examination — so "the mapping changed" and "the skips are revisited" cannot drift.
 * @param {string} [opts.mappingVersion]  the version to FILE this run's skips under. Defaults to the
 *   digest of `verdictRole`; overridable so a caller that re-ships the same map can still force a
 *   re-examination (and so the re-evaluation itself is testable without editing the map).
 * @param {(lineNo:number)=>({ok:true}|{ok:false,reason:string})} [opts.readLine]  the TRANSIENT-READ
 *   seam. ⛔ Documented plainly: on the production path the store has already been read whole, so the
 *   line is in memory and this cannot fail — the seam exists so the `READ_FAILED` RETRY PATH is
 *   exercisable at all. The AC that requires it says "simulated" in as many words, and the production
 *   readings this task owes are AC2/AC3 (the real carriers), not this. It is NOT claimed as a
 *   measurement of production.
 * @returns {{ok, enabled, store, watermark_file, skips_file, mapping_version, scanned, ingested,
 *            duplicates, skipped_not_ingestible, skipped_blank_lines, malformed_lines, read_failed,
 *            stopped_at_malformed_line, stopped_at_read_failed_line, remainder, advanced_to, watermark,
 *            entries, ids, skips_recorded, skips_already_present, skipped_records,
 *            rewound_for_mapping, store_bootstrapped, store_records, store_state, reasons?}}
 *   `store_bootstrapped` is `true` only on the run that CREATED an absent store, `false` when the store
 *   was already present, and `null` when its existence was never established (disabled, an unresolvable
 *   shared checkout, a refusal that happened first). An absent store is NOT a refusal any more.
 *   `store_records` is how many record-holding lines the store was read as having, and `store_state` is
 *   the NAME of what this run's zero (or non-zero) means with them — `empty` (the store has never held a
 *   record: no producer is writing it), `no-new-since-watermark` (the ordinary second run),
 *   `scanned-none-ingested`, `ingested`; `null` when the store was never read. See `storeStateOf`.
 */
export function ingestNewOutcomes(root, {
  maxPerRun = Infinity, enabled = true, verdictRole = VERDICT_ROLE,
  mappingVersion = verdictRoleMappingVersion(verdictRole), readLine = null,
} = {}) {
  const base = {
    ok: true, enabled, store: null, watermark_file: null, skips_file: null, mapping_version: mappingVersion,
    scanned: 0, ingested: 0, duplicates: 0, skipped_not_ingestible: 0, skipped_blank_lines: 0,
    malformed_lines: 0, read_failed: 0, stopped_at_malformed_line: null, stopped_at_read_failed_line: null,
    remainder: 0, advanced_to: null, watermark: null, entries: [], ids: [],
    skips_recorded: 0, skips_already_present: 0, skipped_records: [], rewound_for_mapping: 0,
    // ⛔ THREE VALUES, not a boolean (硬规则 3b): `null` = the store's existence was never established
    // (a disabled round, an unresolvable shared checkout, a refusal that happened first), `true` = THIS
    // run created the empty carrier, `false` = the store was already there. A reader must be able to
    // tell "we made it exist" from "it was already empty"; collapsing those into one boolean would make
    // the bootstrap invisible on exactly the round that performed it.
    store_bootstrapped: null,
    // ⛔ …and the run's own `ingested 0`, NAMED (see `storeStateOf`): `null` until the store has been
    // read, then one of `STORE_STATE_*`. `store_records` is the raw reading it is derived from, carried
    // beside it so a reader can check the name against the count rather than trusting the name.
    store_records: null,
    store_state: null,
  };
  // ⛔ THE KILL SWITCH IS ANSWERED FIRST. Nothing below this line runs when it is off — not the store
  // read, not the watermark read, not the ledger read — so "zero reads and zero writes" is a property
  // of the control flow rather than a promise about what the later code happens to do.
  if (enabled === false) return base;

  const rr = resolveCarrierRoot(root);
  if (!rr.ok) return { ...base, ok: false, reasons: [rr.reason] };
  const store = path.join(rr.root, EVIDENCE_STORE_REL);
  const skipsFile = carrierFile(root, INGEST_SKIPS_REL);

  const wm = readIngestWatermark(root);
  if (!wm.ok) return { ...base, ok: false, store, skips_file: skipsFile, watermark_file: wm.file, reasons: [wm.reason] };

  // ⑤(a-0) THE BOOTSTRAP. A store that is genuinely ABSENT is created empty and the round proceeds with
  //    zero records to ingest — it is NOT the round's failure. See `ensureEvidenceStore` for why that is
  //    the honest repair and not a fabrication, and for why ONLY absence takes this path: a store that is
  //    present but unreadable still falls through to the read below and fails closed with its own code.
  const ensured = ensureEvidenceStore(root);
  if (!ensured.ok) {
    return { ...base, ok: false, store, skips_file: skipsFile, watermark_file: wm.file, reasons: ensured.reasons };
  }
  let text;
  try { text = fs.readFileSync(store, "utf8"); }
  catch (e) {
    return { ...base, ok: false, store: ensured.store, skips_file: skipsFile, watermark_file: wm.file, reasons: [`${EVIDENCE_STORE_UNREADABLE}:${EVIDENCE_STORE_REL}:${e?.code ?? e?.message}`] };
  }
  // Set only AFTER the read succeeded, so a store that could not be read never reports a bootstrap
  // reading it did not reach (`ensureEvidenceStore` may have created it and the read still failed —
  // e.g. a dangling symlink appeared in between).
  const storeBootstrapped = ensured.bootstrapped;
  const lines = splitStoreLines(text);
  // ⛔ A DIRECT READING OF THE CARRIER, taken before anything else looks at it: how many lines could
  // hold a record. It is the ONE fact that separates «this store has never held a record» from «this
  // store holds records and none of them is new» (see `storeStateOf`).
  const storeLineCount = lines.filter((l) => l.trim().length > 0).length;

  // FAIL-CLOSED: the watermark names a line and a digest; BOTH must still hold. A rewritten or
  // truncated store is refused with its own code and NOTHING is written — never a silent restart at 0.
  const from0 = wm.value ? wm.value.line : 0;
  if (wm.value) {
    const mismatch = watermarkMismatch(wm.value, lines);
    if (mismatch) {
      return { ...base, ok: false, store, skips_file: skipsFile, watermark_file: wm.file, watermark: wm.value, advanced_to: from0, reasons: [`${WATERMARK_MISMATCH}:${mismatch}`] };
    }
  }

  // The `source_ref` dedup set. A partially readable LEDGER refuses the run: an incomplete set would
  // silently re-append an outcome that is already present, and it would look exactly like a new find.
  const ledger = readExperienceLedger(root);
  if (!ledger.ok) {
    return { ...base, ok: false, store, skips_file: skipsFile, watermark_file: wm.file, reasons: [`${CARRIER_UNREADABLE}:${EXPERIENCE_LEDGER_REL}-has-${ledger.malformed_lines}-unparseable-line(s)-so-the-source_ref-dedup-set-cannot-be-read-as-complete`] };
  }
  const have = new Set();
  for (const r of ledger.records) if (isStr(r.source_ref, 1)) have.add(r.source_ref);

  // The SKIP ledger — same fail-closed shape as the entry ledger, and for the same reason: an
  // incomplete dedup set would re-append a skip that is already recorded, so the carrier would grow a
  // duplicate that reads exactly like a second finding of the same thing.
  const skips = readIngestSkips(root);
  if (!skips.ok) {
    return { ...base, ok: false, store, skips_file: skipsFile, watermark_file: wm.file, reasons: [`${CARRIER_UNREADABLE}:${INGEST_SKIPS_REL}-has-${skips.malformed_lines}-unparseable-line(s)-so-the-skip-dedup-set-cannot-be-read-as-complete`] };
  }
  const haveSkip = new Set(skips.records.filter((r) => isObj(r)).map(skipDedupKey));

  // ⛔ THE REWIND (Plan item 4's third recording rule). A skip filed under a DIFFERENT mapping version
  // is re-examined; so is any `READ_FAILED` line. Without this the version would be decorative: the
  // watermark sits past those lines, so they would never be looked at again and "re-evaluated" would
  // mean nothing. A `READ_FAILED` line is included even though the loop already refuses to advance past
  // it — the two mechanisms then agree by construction rather than by coincidence.
  const rewindTo = [];
  for (const s of skips.records) {
    if (!isObj(s) || !isInt(s.store_line)) continue;
    if (String(s.reason_code ?? "").startsWith(SKIP_VERDICT_NOT_INGESTIBLE) && s.mapping_version !== mappingVersion) rewindTo.push(s.store_line);
    else if (s.reason_code === SKIP_READ_FAILED) rewindTo.push(s.store_line);
  }
  const from = rewindTo.length ? Math.min(from0, Math.min(...rewindTo) - 1) : from0;
  const rewoundForMapping = from < from0 ? from0 - from : 0;

  // Every outcome line, parsed ONCE: this is what lets a record be judged against a LATER outcome on
  // the same subject (the recurrence half of the role derivation) without a second pass over the store.
  // …and every CLAIM-BEARING line, indexed ONCE by `subject_key`, so each derived Experience can be
  // joined to the records that state why its outcome came out that way (the `claimIndex` below).
  const outcomes = [];
  const storeRecords = [];
  lines.forEach((line, i) => {
    if (!line.trim()) return;
    let rec; try { rec = JSON.parse(line); } catch { return; }
    storeRecords.push(rec);
    if (isObj(rec) && rec.kind === "outcome") outcomes.push({ rec, line: i + 1, raw: line });
  });
  const laterOutcomeWithSubjectKey = (subjectKey, line) =>
    isStr(subjectKey, 1) && isInt(line) && outcomes.some((o) => o.line > line && o.rec.subject_key === subjectKey);
  const context = { taskStatus: (id) => taskStatusOnDevelop(root, id), laterOutcomeWithSubjectKey, verdictRole, claimIndex: claimIndex(storeRecords) };

  const entries = [];
  const ids = [];
  let advancedTo = from;
  let attempted = 0;
  let scanned = 0, ingested = 0, duplicates = 0, skipped = 0, blank = 0, malformed = 0, readFailed = 0;
  let stoppedAtMalformed = null;
  let stoppedAtReadFailed = null;
  // The JOIN READING. Counted per INGESTED entry, so the run reports how much of what it wrote carries
  // a domain claim — a number no test fixture can satisfy, because it is taken from the real store.
  let joinedClaims = 0;
  let noLinkedClaim = 0;

  // Skips are COLLECTED and flushed on EVERY exit path (including a mid-loop refusal): a skip already
  // earned by a line this run really did examine stays true whether or not a LATER line aborted it.
  const pending = [];
  let skipsAlready = 0;
  const recordSkip = (storeLine, outcomeId, verdict, reasonCode) => {
    const rec = { store_line: storeLine, outcome_id: outcomeId, verdict, reason_code: reasonCode, mapping_version: mappingVersion };
    const key = skipDedupKey(rec);
    if (haveSkip.has(key)) { skipsAlready++; return false; }
    haveSkip.add(key);
    pending.push(rec);
    return true;
  };
  const flushSkips = () => {
    const written = [];
    for (const rec of pending) {
      const w = appendIngestSkip(root, rec);
      if (w.ok) written.push({ ...rec, id: w.id });
      else if (w.duplicate) written.push({ ...rec, id: w.id, already_recorded: true });
    }
    return written;
  };

  for (let i = from; i < lines.length; i++) {
    const lineNo = i + 1;
    const line = lines[i];
    if (!line.trim()) { blank++; advancedTo = lineNo; continue; }
    // The transient-read seam — see `readLine` in the JSDoc. Answered BEFORE the parse, because "the
    // read failed" and "the bytes are not JSON" are different findings with different codes.
    const rd = readLine ? readLine(lineNo) : { ok: true };
    if (!isObj(rd) || rd.ok !== true) {
      // ⛔ TRANSIENT: recorded, and the scan STOPS here so the watermark cannot advance past the line —
      // a later round retries it from the same place. Advancing would turn "I could not read it this
      // time" into "there was nothing there", permanently (硬规则 3b).
      readFailed++; stoppedAtReadFailed = lineNo;
      recordSkip(lineNo, null, null, SKIP_READ_FAILED);
      break;
    }
    let rec;
    try { rec = JSON.parse(line); }
    catch {
      // COUNTED, and the watermark does NOT advance past it: an unparseable line might have been an
      // outcome, so stepping over it would lose the finding forever while claiming it was read.
      malformed++; stoppedAtMalformed = lineNo;
      recordSkip(lineNo, null, null, SKIP_MALFORMED);
      break;
    }
    if (!isObj(rec) || rec.kind !== "outcome") { advancedTo = lineNo; continue; }   // readable, and definitively not an outcome
    if (attempted >= maxPerRun) break;                                              // quota: stop BEFORE this one
    attempted++; scanned++;
    const d = deriveExperienceFields(rec, { line: lineNo, ...context });
    if (!d.ok) {
      // e.g. an ownership-loop verdict. The per-record trace the audit found MISSING: which line, which
      // outcome, which verdict, under which mapping — instead of one integer that named none of them.
      // The code is rebuilt from the VERDICT rather than sliced out of the refusal sentence, so the
      // recorded value is a value and not a substring of an explanation.
      const notIngestible = d.reasons.some((x) => x.startsWith(`${SKIP_VERDICT_NOT_INGESTIBLE}:`));
      if (!notIngestible) {
        // Any OTHER derivation failure is not a skip and must not be filed as one (硬规则 3b): a shape
        // the deriver cannot handle is a defect to report, not an outcome we declined.
        const recorded = flushSkips();
        return { ...base, ok: false, store, skips_file: skipsFile, watermark_file: wm.file, scanned, ingested, duplicates, skipped_not_ingestible: skipped, skipped_blank_lines: blank, malformed_lines: malformed, read_failed: readFailed, stopped_at_malformed_line: stoppedAtMalformed, stopped_at_read_failed_line: stoppedAtReadFailed, advanced_to: advancedTo, watermark: watermarkValue(lines, advancedTo), ids, entries, skips_recorded: recorded.length, skips_already_present: skipsAlready, skipped_records: recorded, rewound_for_mapping: rewoundForMapping, store_bootstrapped: storeBootstrapped, reasons: d.reasons };
      }
      skipped++; advancedTo = lineNo;
      recordSkip(lineNo, isStr(rec.id, 1) ? rec.id : null, rec.verdict ?? null, `${SKIP_VERDICT_NOT_INGESTIBLE}:${String(rec.verdict)}`);
      continue;
    }
    if (have.has(rec.id)) {
      duplicates++; advancedTo = lineNo;
      // ⛔ Recorded ONLY above the watermark this run started from. Below it, this run is there because
      // of a rewind, the ledger already accounts for those lines, and re-reporting them would bury the
      // real skips under noise — a duplicate is an outcome that WAS ingested, so it is not a gap.
      if (lineNo > from0) recordSkip(lineNo, rec.id, rec.verdict ?? null, SKIP_DUPLICATE_SOURCE_REF);
      continue;
    }
    const r = ingestExperience(root, { source: "system", outcome: { rec, raw: line, line: lineNo }, context });
    if (r.ok) {
      ingested++; ids.push(r.id); have.add(rec.id); advancedTo = lineNo;
      if (r.record.join_status === JOIN_LINKED) joinedClaims++; else noLinkedClaim++;
      entries.push({
        case_id: r.record.case_id, source_ref: r.record.source_ref, role: r.record.role,
        components: r.record.components, summary: r.record.summary,
        evaluation_pin: r.record.evaluation_pin, line: lineNo,
        experiment_ref: rec.experiment_ref, verdict: rec.verdict,
        join_status: r.record.join_status ?? null, claim_refs: r.record.claim_refs ?? [],
      });
      continue;
    }
    if (r.duplicate) {
      duplicates++; advancedTo = lineNo;
      if (lineNo > from0) recordSkip(lineNo, rec.id, rec.verdict ?? null, SKIP_DUPLICATE_SOURCE_REF);
      continue;
    }
    // A REFUSAL is neither skipped nor advanced past: the record could not become an Experience, and
    // reporting it is the only behaviour that keeps the watermark honest about what was read.
    const recorded = flushSkips();
    return { ...base, ok: false, store, skips_file: skipsFile, watermark_file: wm.file, scanned, ingested, duplicates, skipped_not_ingestible: skipped, skipped_blank_lines: blank, malformed_lines: malformed, read_failed: readFailed, stopped_at_malformed_line: stoppedAtMalformed, stopped_at_read_failed_line: stoppedAtReadFailed, advanced_to: advancedTo, watermark: watermarkValue(lines, advancedTo), ids, entries, skips_recorded: recorded.length, skips_already_present: skipsAlready, skipped_records: recorded, rewound_for_mapping: rewoundForMapping, store_bootstrapped: storeBootstrapped, reasons: r.reasons };
  }

  const watermark = watermarkValue(lines, advancedTo);
  if (advancedTo > from && watermark) writeIngestWatermark(wm.file, watermark);
  // The remainder is COUNTED off the text already read, not inferred: an ingestible outcome on a line
  // past where this run stopped. `stopped_at_malformed_line` says separately when a run was cut short.
  const remainder = outcomes.filter((o) => o.line > advancedTo && verdictRole[o.rec.verdict] !== undefined).length;
  const recorded = flushSkips();

  return {
    ...base, ok: true, store, skips_file: skipsFile, watermark_file: wm.file,
    scanned, ingested, duplicates, skipped_not_ingestible: skipped, skipped_blank_lines: blank,
    malformed_lines: malformed, read_failed: readFailed,
    stopped_at_malformed_line: stoppedAtMalformed, stopped_at_read_failed_line: stoppedAtReadFailed,
    remainder, advanced_to: advancedTo, watermark, entries, ids,
    skips_recorded: recorded.length, skips_already_present: skipsAlready, skipped_records: recorded,
    rewound_for_mapping: rewoundForMapping,
    store_bootstrapped: storeBootstrapped,
    store_records: storeLineCount,
    store_state: storeStateOf({ store_records: storeLineCount, scanned, ingested }),
    claim_join: { linked: joinedClaims, no_linked_claim: noLinkedClaim, claim_records_indexed: storeRecords.filter((r) => isObj(r) && CLAIM_BEARING_KINDS.includes(r.kind)).length },
  };
}

/**
 * The ONE-TIME RECONCILIATION (Plan item 5) — record a skip for every outcome that is NOT an entry.
 *
 * ⛔ This is deliberately NOT a variant of `ingestNewOutcomes`: that one is watermarked and ingests,
 * this one re-reads the WHOLE store, ingests nothing, and answers the single question the audit could
 * not — "for each outcome, is it an entry, a named skip, or UNACCOUNTED?" The third answer is the
 * point. An ingestible outcome that is neither in the ledger nor skipped is a finding that was LOST,
 * and it is REPORTED as `unexplained` rather than filed as a skip: filing it would shape "we lost this"
 * exactly like "we chose not to take it", which is the failure 硬规则 3b names.
 *
 * So `ingested + skipped + unexplained == outcomes scanned` holds BY CONSTRUCTION, and every term in
 * it is a list of named records rather than a number.
 *
 * @returns {{ok, store, skips_file, mapping_version, scanned, ingested, skipped, unexplained,
 *            skips_recorded, skips_already_present, skipped_records}}
 */
export function backfillIngestSkips(root, { verdictRole = VERDICT_ROLE, mappingVersion = verdictRoleMappingVersion(verdictRole) } = {}) {
  const base = { ok: true, store: null, skips_file: null, mapping_version: mappingVersion, scanned: 0, ingested: 0, skipped: 0, unexplained: [], skips_recorded: 0, skips_already_present: 0, skipped_records: [] };
  const rr = resolveCarrierRoot(root);
  if (!rr.ok) return { ...base, ok: false, reasons: [rr.reason] };
  const store = path.join(rr.root, EVIDENCE_STORE_REL);
  // ⛔ SAME READING AS THE NAMED-RECORD LOOKUP ABOVE, and for the same reason — this one is a
  //    RECONCILIATION of records that are already there ("is each outcome an entry, a named skip, or
  //    UNACCOUNTED?"), so an absent store means there is nothing to reconcile and NO caller is stuck:
  //    it has no production caller at all (tests only). The bootstrap belongs to the batch ingester,
  //    which is the one a resident routine actually runs every round.
  if (!fs.existsSync(store)) return { ...base, ok: false, store, reasons: [`EVIDENCE_STORE_MISSING:${EVIDENCE_STORE_REL}-not-present-under-${rr.root}`] };

  const ledger = readExperienceLedger(root);
  if (!ledger.ok) return { ...base, ok: false, store, reasons: [`${CARRIER_UNREADABLE}:${EXPERIENCE_LEDGER_REL}-has-${ledger.malformed_lines}-unparseable-line(s)-so-the-ingested-set-cannot-be-read-as-complete`] };
  const have = new Set();
  for (const r of ledger.records) if (isStr(r.source_ref, 1)) have.add(r.source_ref);

  const skips = readIngestSkips(root);
  if (!skips.ok) return { ...base, ok: false, store, reasons: [`${CARRIER_UNREADABLE}:${INGEST_SKIPS_REL}-has-${skips.malformed_lines}-unparseable-line(s)-so-the-skip-dedup-set-cannot-be-read-as-complete`] };
  const haveSkip = new Set(skips.records.filter((r) => isObj(r)).map(skipDedupKey));

  const lines = splitStoreLines(fs.readFileSync(store, "utf8"));
  const pending = [];
  const ingestedIds = new Set();
  const skippedIds = new Set();          // an id with a skip record — pre-existing OR recorded now
  const unexplained = [];
  let scanned = 0, skippedAlready = 0;

  lines.forEach((line, i) => {
    if (!line.trim()) return;
    let rec; try { rec = JSON.parse(line); } catch { return; }
    if (!isObj(rec) || rec.kind !== "outcome") return;
    const lineNo = i + 1;
    scanned++;
    const key = isStr(rec.id, 1) ? rec.id : `line-${lineNo}`;
    const first = !ingestedIds.has(key) && !skippedIds.has(key);
    if (have.has(rec.id) && first) { ingestedIds.add(key); return; }   // an entry exists for this outcome
    const reason = have.has(rec.id) ? SKIP_DUPLICATE_SOURCE_REF
      : verdictRole[rec.verdict] === undefined ? `${SKIP_VERDICT_NOT_INGESTIBLE}:${String(rec.verdict)}`
      : null;
    // ⛔ `reason === null` is the third answer, and it is NOT filed as a skip: an ingestible outcome with
    // no entry is a finding that was LOST. Filing it would shape "we lost this" exactly like "we chose
    // not to take it" (硬规则 3b) — so it is collected here and reported as `unexplained`.
    if (reason === null) { unexplained.push({ store_line: lineNo, outcome_id: rec.id ?? null, verdict: rec.verdict ?? null }); return; }
    const r = { store_line: lineNo, outcome_id: isStr(rec.id, 1) ? rec.id : null, verdict: rec.verdict ?? null, reason_code: reason, mapping_version: mappingVersion };
    skippedIds.add(key);
    if (haveSkip.has(skipDedupKey(r))) { skippedAlready++; return; }
    haveSkip.add(skipDedupKey(r));
    pending.push(r);
  });

  const written = [];
  for (const rec of pending) {
    const w = appendIngestSkip(root, rec);
    if (w.ok) written.push({ ...rec, id: w.id });
    else if (w.duplicate) written.push({ ...rec, id: w.id, already_recorded: true });
  }

  return {
    ...base, ok: true, store, skips_file: carrierFile(root, INGEST_SKIPS_REL),
    scanned, ingested: ingestedIds.size, skipped: skippedIds.size, unexplained,
    skips_recorded: written.filter((w) => !w.already_recorded).length,
    skips_already_present: skippedAlready, skipped_records: written,
  };
}

// ── the anti-leak deny-list ─────────────────────────────────────────────────────────────────────

/** Characters that bound a path/identifier TOKEN in investigator-visible text. */
const TOKEN_CLASS = "\\s/`\"'()\\[\\]{},;:<>|=";
const escapeRe = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** A whole-TOKEN matcher: the name must be bounded by a delimiter (or the string edge), so
 *  `probe-routine.ts` matches `plugin/scripts/probe-routine.ts` but never `x-probe-routine.ts`. */
const tokenPattern = (token) => new RegExp(`(?:^|[${TOKEN_CLASS}])${escapeRe(token)}(?:$|[${TOKEN_CLASS}])`);

/**
 * The UNION deny-list over every registered Experience case: one pattern per `components` entry
 * (matched on its BASENAME, so an inventory naming either the full path or the bare file is caught)
 * plus one per `case_id`. In the SAME shape `ownership-active-contract.mjs`'s `DENY_PATH_PATTERNS`
 * and `arch-hypothesis-generation.mjs`'s `--contamination-pairs` consume (a list of RegExp).
 *
 * A future blind-investigator inventory/prompt built for a round must run its contamination scan
 * against this list and REFUSE (not warn) on a match in investigator-visible text. Wiring that scan
 * into `arch-hypothesis-generation.mjs` is a LATER task's job — this module only PRODUCES the list.
 * (⛔ `summary` text is returned as data but never turned into a pattern — see the header.)
 *
 * @param {string} root
 * @param {object} [opts]
 * @param {string} [opts.scanText] when given, ALSO scan this text and report `flagged`/`matches`
 *   (so "does the deny-list flag this line?" is answered by the mechanism, not re-implemented by
 *   each caller against the returned patterns).
 * @returns {{ok:boolean, evaluated:number, components:string[], case_ids:string[], summaries:string[],
 *            patterns:RegExp[], malformed_lines:number, file:string,
 *            flagged?:boolean, matches?:object[]}}
 */
export function experienceDenyList(root, { scanText } = {}) {
  const read = readExperienceLedger(root);
  const components = new Set();
  const caseIds = new Set();
  const summaries = [];
  for (const r of read.records) {
    for (const c of Array.isArray(r.components) ? r.components : []) if (isStr(c, 1)) components.add(c);
    if (isStr(r.case_id, 1)) caseIds.add(r.case_id);
    if (isStr(r.summary, 1)) summaries.push(r.summary);
  }
  const componentList = [...components].sort();
  const caseIdList = [...caseIds].sort();
  const patterns = [
    ...componentList.map((c) => ({ kind: "component", value: c, re: tokenPattern(String(c).split("/").pop()) })),
    ...caseIdList.map((c) => ({ kind: "case_id", value: c, re: tokenPattern(c) })),
  ];
  const out = {
    // A partially-readable ledger cannot be read as a complete deny-list (硬规则 3b) — but it is
    // still RETURNED, with its own `malformed_lines`, rather than throwing.
    ok: read.ok,
    evaluated: read.records.length,
    components: componentList,
    case_ids: caseIdList,
    summaries,
    patterns: patterns.map((p) => p.re),
    malformed_lines: read.malformed_lines,
    file: read.file,
  };
  if (typeof scanText === "string") {
    out.flagged = false;
    out.matches = [];
    for (const p of patterns) {
      if (p.re.test(scanText)) { out.flagged = true; out.matches.push({ kind: p.kind, value: p.value, pattern: String(p.re) }); }
    }
  }
  return out;
}

/**
 * Scan investigator-visible `text` against a produced deny-list value. Returns
 * `{flagged, matches}` — `matches` names WHICH registered component/case_id fired, so a refusal can
 * say what leaked instead of a bare "contaminated".
 */
export function scanExperienceLeak(denyList, text) {
  const patterns = Array.isArray(denyList?.patterns) ? denyList.patterns : [];
  const values = [
    ...(denyList?.components ?? []).map((value) => ({ kind: "component", value })),
    ...(denyList?.case_ids ?? []).map((value) => ({ kind: "case_id", value })),
  ];
  const matches = [];
  patterns.forEach((re, i) => {
    if (re.test(String(text ?? ""))) matches.push({ kind: values[i]?.kind ?? "unknown", value: values[i]?.value ?? null, pattern: String(re) });
  });
  return { flagged: matches.length > 0, matches };
}
