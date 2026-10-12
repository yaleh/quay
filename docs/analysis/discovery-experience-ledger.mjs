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

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

// Reuse the evidence store's primitives directly (content addressing, the carrier-read that counts
// unparseable lines, and the ONE definition of where the evidence store lives) — re-implementing any
// of them would be a second definition.
import { sha256, recordId, readRecords, EVIDENCE_STORE_REL } from "./architecture-evidence-store.mjs";

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
 *  fix that the record does not name. */
export const EXPERIENCE_ROLES = Object.freeze([
  "missed-by-tooling",
  "found-and-fixed",
  "found-undetermined-then-confirmed",
  "confirmed-negative",
  "recurred-after-fix",
  "found-unresolved",
  "undetermined",
]);

/** Who reported it. A tool-self-reported case is NEVER `"user"` (same discipline as the original
 *  draft's `user` | `operator` split, folded into the two-source model). */
export const REPORTED_BY_VOCAB = Object.freeze(["user", "system"]);

/** A summary with fewer than this many non-whitespace chars says nothing — the ONLY numeric gate
 *  here, and it is on a MEASURED quantity (硬规则 4: no made-up thresholds on unmeasured things). */
export const MIN_SUMMARY_CHARS = 40;

/** Per-record required fields — declared as DATA so the refusal reasons are enumerable and testable. */
export const REQUIRED_EXPERIENCE_FIELDS = Object.freeze([
  "case_id", "ts", "role", "reported_by", "source_ref", "evidence", "components", "summary",
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
 * Read the ledger back. Unparseable lines are DROPPED and COUNTED (never silently); `ok` is false
 * when any exist, because a partially-readable ledger must not be read as a complete one.
 * @returns {{ok:boolean, records:object[], malformed_lines:number, file:string|null}}
 */
export const readExperienceLedger = (root) => readCarrier(root, EXPERIENCE_LEDGER_REL, EXPERIENCE_KIND);

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

/**
 * A PROJECTION of the record's own text — never an interpretation of it.
 *
 * ⛔ The audit's defect was a HAND-WRITTEN summary that stated the answer ("paired with two divergent
 * keys"), which then went verbatim into the reflection prompt. A derived summary therefore composes
 * only what the record already says: its `experiment_ref` (or, failing that, its own id), its stored
 * `verdict`, its `subject_key`, and its `verdict_reason` when one is recorded.
 */
export function deriveExperienceSummary(rec) {
  const base = isStr(rec?.experiment_ref, 1) ? String(rec.experiment_ref)
    : isStr(rec?.experiment, 1) ? String(rec.experiment)
    : String(rec?.id ?? "outcome");
  const subject = isStr(rec?.subject_key, 1) ? String(rec.subject_key) : "(no subject_key recorded)";
  let s = `${base}: verifier verdict "${String(rec?.verdict)}" on subject ${subject}`;
  if (isStr(rec?.verdict_reason, 1)) s += ` [reason: ${rec.verdict_reason}]`;
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
 * Derive EVERY Experience field of an outcome record. PURE: the two facts a record cannot carry about
 * its own surroundings are INJECTED — `taskStatus(taskId)` (what develop says) and
 * `laterOutcomeWithSubjectKey(subjectKey, line)` (does a later outcome exist on the same subject).
 * Injecting them is what keeps this function a measurement of the record rather than a second scanner.
 *
 * @returns {{ok:true, fields:{role,components,summary,evaluation_pin}}|{ok:false, reasons:string[]}}
 */
export function deriveExperienceFields(rec, { line = null, taskStatus = () => null, laterOutcomeWithSubjectKey = () => false } = {}) {
  if (!isObj(rec)) return { ok: false, reasons: ["RECORD_NOT_OBJECT"] };
  let role = VERDICT_ROLE[rec.verdict] ?? null;
  if (role === null) {
    return { ok: false, reasons: [`VERDICT_NOT_INGESTIBLE:${String(rec.verdict)}-is-not-a-discovery-finding-verdict`] };
  }
  // The elevation is only reachable from a SUPPORTED finding: `found-and-fixed` and
  // `recurred-after-fix` both require a `supported` verdict in ROLE_VERDICT_COMPAT, so elevating a
  // refuted/undetermined outcome would manufacture a role the evidence cannot support.
  if (role === "found-unresolved" && isStr(rec.task_id, 1) && taskStatus(rec.task_id) === "done") {
    role = laterOutcomeWithSubjectKey(rec.subject_key, line) ? "recurred-after-fix" : "found-and-fixed";
  }
  return {
    ok: true,
    fields: {
      role,
      components: componentsFromSubjectKey(rec.subject_key),
      summary: deriveExperienceSummary(rec),
      evaluation_pin: evaluationPinOf(rec).pin,
    },
  };
}

// ── the ONE unified entry: BOTH sources go through it ────────────────────────────────────────────

/**
 * Ingest ONE Experience. The single entry point for both sources (Plan item 1):
 *   • `source:"user"`   — a human-flagged miss; the caller narrates it (`ingestFeedback`).
 *   • `source:"system"` — an evidence-store outcome; the fields are DERIVED unless the caller
 *                          explicitly opts into pinned narration (see below).
 *
 * @param {string} root
 * @param {object} args
 * @param {"user"|"system"} args.source  — anything else is `SOURCE_NOT_IN_VOCAB`, never a default
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
  return { ok: false, appended: false, kind: EXPERIENCE_KIND, reasons: [`${SOURCE_NOT_IN_VOCAB}:${String(source)}-must-be-user-or-system`] };
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
 */
export function ingestFeedback(root, { caseId, role, reportedBy = "user", evidenceRefs, components = [], summary, ts } = {}) {
  return ingestExperience(root, { source: "user", caseId, role, reportedBy, evidenceRefs, components, summary, ts });
}

function ingestUserSource(root, { caseId, role, reportedBy = "user", evidenceRefs, components = [], summary, ts } = {}) {
  const evidence = (Array.isArray(evidenceRefs) ? evidenceRefs : []).map((e) =>
    isObj(e) ? { ref: e.ref, sha256: e.sha256 } : { ref: e, sha256: sha256(String(e)) });
  return appendExperienceRecord(root, {
    case_id: caseId,
    ts: ts ?? new Date().toISOString(),
    role,
    reported_by: reportedBy,
    source_ref: null,             // forced — the manual path has no single source record
    evidence,
    components,
    summary,
    evaluation_pin: null,         // a human report has no pre-registration to be pinned to
  });
}

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
export function ingestFromEvidenceStoreOutcome(root, { experiment, experimentRef, role, components = [], summary, caseId, ts } = {}) {
  return ingestExperience(root, {
    source: "system",
    experiment,
    experimentRef,
    narration: { role, caseId, components, summary, ts },
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
function systemRecord(rec, raw, fields, { caseId, ts }) {
  return {
    case_id: caseId,
    ts: ts ?? (isStr(rec.ts, 4) ? rec.ts : new Date().toISOString()),
    role: fields.role,
    reported_by: "system",
    source_ref: rec.id,
    evidence: [{ ref: rec.id, sha256: sha256(raw) }],
    components: fields.components,
    summary: fields.summary,
    evaluation_pin: fields.evaluation_pin ?? null,
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
    const forbidden = ["role", "components", "summary", "caseId", "case_id"].filter((f) => supplied(args, f));
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
    });
    if (!d.ok) return { ok: false, appended: false, kind: EXPERIENCE_KIND, reasons: d.reasons };
    fields = d.fields;
    caseId = derivedCaseId(rec);
  }

  const out = appendExperienceRecord(root, systemRecord(rec, raw, fields, { caseId, ts: args.ts }));
  // Surface WHERE it came from on acceptance — the derivation is the point of this adapter, and a
  // caller that cannot see the matched line cannot check that it matched the right one.
  return out.ok
    ? { ...out, derived: narration === null, derived_from: { id: rec.id, line, verdict: rec.verdict, experiment_ref: rec.experiment_ref } }
    : out;
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
 * @returns {{ok, enabled, store, watermark_file, scanned, ingested, duplicates,
 *            skipped_not_ingestible, skipped_blank_lines, malformed_lines,
 *            stopped_at_malformed_line, remainder, advanced_to, watermark, entries, ids, reasons?}}
 */
export function ingestNewOutcomes(root, { maxPerRun = Infinity, enabled = true } = {}) {
  const base = {
    ok: true, enabled, store: null, watermark_file: null,
    scanned: 0, ingested: 0, duplicates: 0, skipped_not_ingestible: 0, skipped_blank_lines: 0,
    malformed_lines: 0, stopped_at_malformed_line: null,
    remainder: 0, advanced_to: null, watermark: null, entries: [], ids: [],
  };
  // ⛔ THE KILL SWITCH IS ANSWERED FIRST. Nothing below this line runs when it is off — not the store
  // read, not the watermark read, not the ledger read — so "zero reads and zero writes" is a property
  // of the control flow rather than a promise about what the later code happens to do.
  if (enabled === false) return base;

  const rr = resolveCarrierRoot(root);
  if (!rr.ok) return { ...base, ok: false, reasons: [rr.reason] };
  const store = path.join(rr.root, EVIDENCE_STORE_REL);

  const wm = readIngestWatermark(root);
  if (!wm.ok) return { ...base, ok: false, store, watermark_file: wm.file, reasons: [wm.reason] };

  if (!fs.existsSync(store)) {
    return { ...base, ok: false, store, watermark_file: wm.file, reasons: [`EVIDENCE_STORE_MISSING:${EVIDENCE_STORE_REL}-not-present-under-${rr.root}`] };
  }
  let text;
  try { text = fs.readFileSync(store, "utf8"); }
  catch (e) {
    return { ...base, ok: false, store, watermark_file: wm.file, reasons: [`${EVIDENCE_STORE_UNREADABLE}:${EVIDENCE_STORE_REL}:${e?.code ?? e?.message}`] };
  }
  const lines = splitStoreLines(text);

  // FAIL-CLOSED: the watermark names a line and a digest; BOTH must still hold. A rewritten or
  // truncated store is refused with its own code and NOTHING is written — never a silent restart at 0.
  const from = wm.value ? wm.value.line : 0;
  if (wm.value) {
    const mismatch = watermarkMismatch(wm.value, lines);
    if (mismatch) {
      return { ...base, ok: false, store, watermark_file: wm.file, watermark: wm.value, advanced_to: from, reasons: [`${WATERMARK_MISMATCH}:${mismatch}`] };
    }
  }

  // The `source_ref` dedup set. A partially readable LEDGER refuses the run: an incomplete set would
  // silently re-append an outcome that is already present, and it would look exactly like a new find.
  const ledger = readExperienceLedger(root);
  if (!ledger.ok) {
    return { ...base, ok: false, store, watermark_file: wm.file, reasons: [`${CARRIER_UNREADABLE}:${EXPERIENCE_LEDGER_REL}-has-${ledger.malformed_lines}-unparseable-line(s)-so-the-source_ref-dedup-set-cannot-be-read-as-complete`] };
  }
  const have = new Set();
  for (const r of ledger.records) if (isStr(r.source_ref, 1)) have.add(r.source_ref);

  // Every outcome line, parsed ONCE: this is what lets a record be judged against a LATER outcome on
  // the same subject (the recurrence half of the role derivation) without a second pass over the store.
  const outcomes = [];
  lines.forEach((line, i) => {
    if (!line.trim()) return;
    let rec; try { rec = JSON.parse(line); } catch { return; }
    if (isObj(rec) && rec.kind === "outcome") outcomes.push({ rec, line: i + 1, raw: line });
  });
  const laterOutcomeWithSubjectKey = (subjectKey, line) =>
    isStr(subjectKey, 1) && isInt(line) && outcomes.some((o) => o.line > line && o.rec.subject_key === subjectKey);
  const context = { taskStatus: (id) => taskStatusOnDevelop(root, id), laterOutcomeWithSubjectKey };

  const entries = [];
  const ids = [];
  let advancedTo = from;
  let attempted = 0;
  let scanned = 0, ingested = 0, duplicates = 0, skipped = 0, blank = 0, malformed = 0;
  let stoppedAtMalformed = null;

  for (let i = from; i < lines.length; i++) {
    const lineNo = i + 1;
    const line = lines[i];
    if (!line.trim()) { blank++; advancedTo = lineNo; continue; }
    let rec;
    try { rec = JSON.parse(line); }
    catch {
      // COUNTED, and the watermark does NOT advance past it: an unparseable line might have been an
      // outcome, so stepping over it would lose the finding forever while claiming it was read.
      malformed++; stoppedAtMalformed = lineNo;
      break;
    }
    if (!isObj(rec) || rec.kind !== "outcome") { advancedTo = lineNo; continue; }   // readable, and definitively not an outcome
    if (attempted >= maxPerRun) break;                                              // quota: stop BEFORE this one
    attempted++; scanned++;
    const d = deriveExperienceFields(rec, { line: lineNo, ...context });
    if (!d.ok) { skipped++; advancedTo = lineNo; continue; }                        // e.g. an ownership-loop verdict
    if (have.has(rec.id)) { duplicates++; advancedTo = lineNo; continue; }           // dedup by source_ref
    const r = ingestExperience(root, { source: "system", outcome: { rec, raw: line, line: lineNo }, context });
    if (r.ok) {
      ingested++; ids.push(r.id); have.add(rec.id); advancedTo = lineNo;
      entries.push({
        case_id: r.record.case_id, source_ref: r.record.source_ref, role: r.record.role,
        components: r.record.components, summary: r.record.summary,
        evaluation_pin: r.record.evaluation_pin, line: lineNo,
        experiment_ref: rec.experiment_ref, verdict: rec.verdict,
      });
      continue;
    }
    if (r.duplicate) { duplicates++; advancedTo = lineNo; continue; }
    // A REFUSAL is neither skipped nor advanced past: the record could not become an Experience, and
    // reporting it is the only behaviour that keeps the watermark honest about what was read.
    return { ...base, ok: false, store, watermark_file: wm.file, scanned, ingested, duplicates, skipped_not_ingestible: skipped, skipped_blank_lines: blank, malformed_lines: malformed, stopped_at_malformed_line: stoppedAtMalformed, advanced_to: advancedTo, watermark: watermarkValue(lines, advancedTo), ids, entries, reasons: r.reasons };
  }

  const watermark = watermarkValue(lines, advancedTo);
  if (advancedTo > from && watermark) writeIngestWatermark(wm.file, watermark);
  // The remainder is COUNTED off the text already read, not inferred: an ingestible outcome on a line
  // past where this run stopped. `stopped_at_malformed_line` says separately when a run was cut short.
  const remainder = outcomes.filter((o) => o.line > advancedTo && VERDICT_ROLE[o.rec.verdict] !== undefined).length;

  return {
    ...base, ok: true, store, watermark_file: wm.file,
    scanned, ingested, duplicates, skipped_not_ingestible: skipped, skipped_blank_lines: blank,
    malformed_lines: malformed, stopped_at_malformed_line: stoppedAtMalformed,
    remainder, advanced_to: advancedTo, watermark, entries, ids,
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
