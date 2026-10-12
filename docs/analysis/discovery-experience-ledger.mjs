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
// 硬规则 4 (a量 that cannot take a false value is not a measurement): the deny-list emits a pattern
// ONLY where a pattern can actually fire. `components` (a path token that appears in an investigator
// inventory) and `case_id` (a short stable label) become patterns; the free-text `summary` does NOT —
// a whole-sentence regex is structurally incapable of matching an inventory line, so emitting it would
// add a pattern that can never be true while looking exactly like one that can. The summaries are
// still returned as data for a consumer that wants them.

import fs from "node:fs";
import path from "node:path";

// Reuse the evidence store's primitives directly (content addressing, the carrier-read that counts
// unparseable lines, and the ONE definition of where the evidence store lives) — re-implementing any
// of them would be a second definition.
import { sha256, recordId, readRecords, storeFile, EVIDENCE_STORE_REL } from "./architecture-evidence-store.mjs";

/** The one fixed sink (relative to the analysed root) — same convention as the evidence store's. */
export const EXPERIENCE_LEDGER_REL = ".quay/discovery-experience-ledger.jsonl";

/** The ONE record kind this carrier holds, so a line is self-describing on read-back. */
export const EXPERIENCE_KIND = "experience";

/** The role vocabulary. `recurred-after-fix` (a fix that landed and was later observed to regress)
 *  has no real case yet — the validator ACCEPTS it so a future recurrence is not blocked by an
 *  unknown-value refusal (硬规则 12: do not require a mechanism before it has happened). */
export const EXPERIENCE_ROLES = Object.freeze([
  "missed-by-tooling",
  "found-and-fixed",
  "found-undetermined-then-confirmed",
  "confirmed-negative",
  "recurred-after-fix",
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
});

const isStr = (x, n = 1) => typeof x === "string" && x.trim().length >= n;
const isObj = (x) => x !== null && typeof x === "object" && !Array.isArray(x);
const nonWs = (s) => String(s ?? "").replace(/\s+/g, "").length;
const supplied = (o, k) => Object.prototype.hasOwnProperty.call(o, k) && o[k] !== undefined;
const HEX64 = /^[0-9a-f]{64}$/;

/** Absolute path of the one fixed sink for a given root. */
export const ledgerFile = (root) => path.join(root, EXPERIENCE_LEDGER_REL);

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

// ── append / read ───────────────────────────────────────────────────────────────────────────────

/**
 * Append ONE validated Experience record. Returns `{ok:true, id, file, record}` or
 * `{ok:false, reasons, appended:false}`. ⛔ On refusal NOTHING is written and no field is defaulted.
 */
export function appendExperienceRecord(root, rec) {
  const v = validateExperienceRecord(rec);
  if (!v.ok) return { ok: false, kind: EXPERIENCE_KIND, reasons: v.reasons, appended: false };
  const withId = { id: rec.id ?? experienceRecordId(rec), ...rec };
  const file = ledgerFile(root);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, JSON.stringify({ kind: EXPERIENCE_KIND, ...withId }) + "\n", "utf8");
  return { ok: true, kind: EXPERIENCE_KIND, id: withId.id, file, record: withId };
}

/**
 * Read the ledger back. Unparseable lines are DROPPED and COUNTED (never silently); `ok` is false
 * when any exist, because a partially-readable ledger must not be read as a complete one.
 * @returns {{ok:boolean, records:object[], malformed_lines:number, file:string}}
 */
export function readExperienceLedger(root) {
  const file = ledgerFile(root);
  const { records, malformed_lines } = readRecords(file);   // the evidence store's carrier reader
  const experiences = records.filter((r) => isObj(r) && r.kind === EXPERIENCE_KIND);
  return { ok: malformed_lines === 0, records: experiences, malformed_lines, file };
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
  });
}

// ── SOURCE 2: the automatic path (reported_by:"system") — the load-bearing new piece ────────────

/**
 * Convert an EXISTING `architecture-evidence-store.jsonl` OUTCOME record into an Experience entry,
 * with no hand-narration. The record is located by `experiment` + a match on `experiment_ref`
 * (exact, or the ref as a substring of the record's own — e.g. `"cluster 11"` matches
 * `"E-DT-1-Hp cluster 11"`). The caller supplies `role`/`caseId`/`components`/`summary`; ingestion
 * REFUSES when the named record does not exist (never fabricates one), when the match is AMBIGUOUS
 * (枚举, not boolean — an ambiguous ref is reported with the candidates, never resolved arbitrarily),
 * and when the claimed `role` contradicts the record's stored `verdict`.
 *
 * Derivation (⛔ never hand-written): `source_ref` = the matched record's `id`; `evidence` =
 * `[{ref: <id>, sha256: sha256(<the record's raw carrier line>)}]`; `ts` = the matched record's own
 * `ts` unless the caller overrides it.
 *
 * @returns the `appendExperienceRecord` result, or `{ok:false, appended:false, reasons[]}`.
 */
export function ingestFromEvidenceStoreOutcome(root, { experiment, experimentRef, role, components = [], summary, caseId, ts } = {}) {
  if (!isStr(experiment, 1)) return { ok: false, appended: false, kind: EXPERIENCE_KIND, reasons: ["INGEST_ARG_MISSING:experiment"] };
  if (!isStr(experimentRef, 1)) return { ok: false, appended: false, kind: EXPERIENCE_KIND, reasons: ["INGEST_ARG_MISSING:experimentRef"] };
  // `caseId` is the entry's identity and is the CALLER's to choose — a default derived from the
  // matched record would silently mint an id the caller never picked (and one that changes if the
  // record's id scheme ever does), so its absence is its own refusal, never a derivation.
  if (!isStr(caseId, 1)) return { ok: false, appended: false, kind: EXPERIENCE_KIND, reasons: ["INGEST_ARG_MISSING:caseId"] };
  if (!EXPERIENCE_ROLES.includes(role)) return { ok: false, appended: false, kind: EXPERIENCE_KIND, reasons: [`ROLE_NOT_IN_VOCAB:${String(role)}`] };

  const file = storeFile(root);
  if (!fs.existsSync(file)) {
    return { ok: false, appended: false, kind: EXPERIENCE_KIND, reasons: [`EVIDENCE_STORE_MISSING:${EVIDENCE_STORE_REL}-not-present-under-${root}`] };
  }

  // Read the carrier RAW so each candidate keeps its 1-based line number and its exact line text —
  // the sha256 the evidence entry carries is the hash OF THAT LINE, so it must be the same bytes.
  const candidates = [];
  fs.readFileSync(file, "utf8").split("\n").forEach((line, i) => {
    if (!line.trim()) return;
    let rec; try { rec = JSON.parse(line); } catch { return; }
    if (!isObj(rec) || rec.kind !== "outcome") return;
    if (rec.experiment !== experiment) return;
    if (!(typeof rec.experiment_ref === "string" && rec.experiment_ref.includes(experimentRef))) return;
    candidates.push({ rec, lineNo: i + 1, raw: line });
  });

  if (candidates.length === 0) {
    return { ok: false, appended: false, kind: EXPERIENCE_KIND, reasons: [`EVIDENCE_OUTCOME_NOT_FOUND:${experiment}#${experimentRef}`] };
  }
  if (candidates.length > 1) {
    return {
      ok: false, appended: false, kind: EXPERIENCE_KIND,
      reasons: [`EVIDENCE_OUTCOME_AMBIGUOUS:${experiment}#${experimentRef}-matches-${candidates.length}-records`],
      matches: candidates.map((c) => ({ id: c.rec.id, experiment_ref: c.rec.experiment_ref, line: c.lineNo })),
    };
  }

  const m = candidates[0];
  const allowed = ROLE_VERDICT_COMPAT[role] ?? [];
  if (!allowed.includes(m.rec.verdict)) {
    return {
      ok: false, appended: false, kind: EXPERIENCE_KIND,
      reasons: [`ROLE_VERDICT_INCONSISTENT:role=${role}-requires-verdict-in-(${allowed.join("|")})-but-${m.rec.id}-stored-${String(m.rec.verdict)}`],
    };
  }

  const record = {
    case_id: caseId,
    ts: ts ?? (isStr(m.rec.ts, 4) ? m.rec.ts : new Date().toISOString()),
    role,
    reported_by: "system",
    source_ref: m.rec.id,
    evidence: [{ ref: m.rec.id, sha256: sha256(m.raw) }],
    components,
    summary,
  };
  const res = appendExperienceRecord(root, record);
  // Surface WHERE it came from on acceptance — the derivation is the point of this adapter, and a
  // caller that cannot see the matched line cannot check that it matched the right one.
  return res.ok ? { ...res, derived_from: { id: m.rec.id, line: m.lineNo, verdict: m.rec.verdict, experiment_ref: m.rec.experiment_ref } } : res;
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
