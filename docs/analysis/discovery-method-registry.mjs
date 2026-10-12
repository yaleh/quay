#!/usr/bin/env node
// DISCOVERY METHOD REGISTRY — the versioned, append-only carrier for a reusable METHOD: a named,
// versioned "how to look for this class of problem" that applies across many unrelated findings.
//
// WHY IT IS NOT THE EVIDENCE STORE (scope check, so this does not duplicate it):
//   • `architecture-evidence-store.mjs` records ONE discovery's evidence trail (evidence / hypothesis /
//     experiment / outcome / counterexample), keyed by `subjectKey`. It has no concept of a reusable
//     METHOD — nothing in it could name "how one looks for this class of problem" and apply that name
//     to a second, unrelated finding.
//   • `architecture-decision-memory.mjs` is a static seed of exempted findings with no write path: it
//     records "this specific item was already judged", not "this general method works / does not".
// So this module adds exactly ONE thing: a versioned `DiscoveryMethod` contract + an append-only
// registry. It carries no detection logic and no scheduler of its own (Phase 0 of the self-
// bootstrapping Discovery Method loop; detection is Phase 2, and its consumers are the FIXED
// instruments — `arch-discovery-routine.ts`, `docs/analysis/arch-discovery-{space,time}.mjs` — not
// this file).
//
// ⛔ STRUCTURAL SANDBOX (same spirit as `architecture-evidence-store.mjs`): no filing machinery, no
// task/goal/AC, no status write, no detection, no CLI verb, no routine wiring. Its ONLY persistence is
// append-only lines to `.quay/discovery-method-registry.jsonl`.
//
// CARRIER DECLARATION — measured, not assumed (task gap-discovery-method-registry-and-versioned-
// contract §Plan 7, which says to match whatever `architecture-evidence-store.mjs` answers):
//   • `docs/carrier-registry.json` does NOT carry the evidence store's carrier, and it CANNOT carry
//     this one: its completeness/staleness contract is enforced by
//     `plugin/test/carrier-registry-completeness.test.mjs`, whose corpus is `packages/*/src/**/*.ts`
//     + `plugin/scripts/**/*.ts` ONLY. Adding `.quay/discovery-method-registry.jsonl` there was tried
//     and reds the staleness arm ("declared but no longer present in code"). A `docs/analysis/` carrier
//     is outside that contract — matching the evidence store, no entry is added.
//   • `plugin/scripts/quay-runtime-artifacts.txt` is also not the place: its inclusion criterion is
//     runtime state OUTSIDE `<workspace>/.quay/`, and a consumer's `.gitignore` gets the covering
//     `.quay/*` rule from quay-init. quay's OWN `.gitignore` uses per-file lines (there is no
//     `**/.quay/*` wildcard).
//   ⇒ MEASURED RESULT (task gap-discovery-carriers-ephemeral-in-worktree §Plan 5, which asked for the
//     check to be run rather than assumed): the registry is NOT the place (corpus above), and the
//     `.gitignore` arm is now LIVE — this task's carriers resolve to the SHARED checkout, so they are
//     written into a real checkout. `git check-ignore .quay/discovery-method-registry.jsonl` exits 1
//     (NOT ignored): the Plan's premise "carriers stay gitignored" does not hold. `.gitignore` is
//     outside this task's declared ## Touches, so the entry is REPORTED and not silently added —
//     adding it is the one-step follow-up named in the task's Evidence section.
//
// APPEND-ONLY / SHRINK-ONLY (same discipline as the evidence store): editing a method APPENDS a new
// version — it never rewrites history, and a version number is never reused. A record whose `version`
// is not `(highest recorded version for this method_id) + 1` is REFUSED, so "I re-ran it and it got
// cheaper" cannot silently overwrite what the previous version claimed.
//
// FAIL-CLOSED (硬规则 3b): a record missing a required field is REFUSED with a distinct reason code and
// NOTHING is appended. There is no default-filling and no silent success — "I could not write a valid
// record" must never be shaped like "I wrote one". Dually, a validator that cannot READ its tool
// catalog reports `TOOL_CATALOG_UNAVAILABLE` (its own value), never a pass: the tool check is part of
// the contract, so "the listing was unreadable" must not collapse into "every tool is fine".
//
// ⛔ TOOL ≠ SUBJECT (found by a read-only audit of the landed Phase 2, 2026-10-12): a name being a real
// capability-catalog entry is NOT the same claim as "this is an instrument you run to INSPECT code".
// A method's recorded seed can name its own subject files — real catalog entries, one hop from the
// finding — and a listing can never carry that distinction. The distinction lives in the record's
// PROVENANCE, so it is read from there: `provenance_evidence` is resolved to the Experience records it
// cites, their `components` are the SEED SET, and (a) a tool equal by basename to a seed component is
// refused `TOOL_IS_SUBJECT`, (b) free text naming a seed component basename or case_id is refused
// `METHOD_TEXT_NAMES_SEED`. A caller that cannot supply the seed set gets `PROVENANCE_SEEDS_UNAVAILABLE`
// — the same own-value discipline as the catalog, for the same reason.
//
// 硬规则 4c (the量 must survive every intermediate layer): `readMethodRegistry` returns the LATEST
// version per `method_id`, so a consumer can never read a superseded version as if it were current;
// the full history is returned only when explicitly REQUESTED (`history: true`) — `null` (not
// requested) is a distinct value from `[]` (requested and empty).
//
// REPRODUCTION COMMAND (a real registration against the real evidence store — see the task
// `gap-discovery-method-registry-and-versioned-contract` AC2 for the pasted output):
//
//   node --input-type=module -e '
//     import { appendMethodRecord, readMethodRegistry, dedupMethods, defaultToolNames } from
//       "<repo>/docs/analysis/discovery-method-registry.mjs";
//     const rec = { method_id: "shared-contract-divergence-v1", version: 1, ts: new Date().toISOString(),
//       provenance_evidence: ["outcome-bb12a6858838e74b"], … };
//     console.log(JSON.stringify(appendMethodRecord(process.argv[1], rec), null, 2));'
//
// The `tools` vocabulary is NOT asserted: `operation.tools` must name entries that EXIST in the
// capability catalog (the single source is `plugin/scripts/capability-catalog-declarations.json`, the
// data file the `bash plugin/scripts/capability-catalog.sh` entry RENDERS — the same 373 names appear
// in its `--json` output) or an exported primitive of the evidence store.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Reuse the evidence store's primitives directly (the sha256-based content addressing and the
// carrier-read that counts unparseable lines) — re-implementing either would be a second definition.
import { sha256, recordId, readRecords } from "./architecture-evidence-store.mjs";
import * as evidenceStore from "./architecture-evidence-store.mjs";

// The Experience ledger's OWN deny-list (its whole-token basename matcher) — reused, never re-derived.
// The seed set is "the components of the Experiences this method cites", and the ledger module already
// owns exactly that vocabulary; a second tokenizer here would be a second definition to keep in sync.
import {
  readExperienceLedger, experienceDenyList, scanExperienceLeak, EXPERIENCE_LEDGER_REL,
  DISCOVERY_CARRIERS, GENERALIZATION_VERDICTS_REL, GENERALIZATION_VERDICT_KIND,
  carrierFile, readCarrier, appendCarrierLine, resolveCarrierRoot,
} from "./discovery-experience-ledger.mjs";

/**
 * The one fixed sink, declared in the ledger module's `DISCOVERY_CARRIERS` table — the ONE place the
 * Discovery carriers' locations live. ⛔ It resolves to the SHARED checkout (the main worktree), not
 * the caller's root, so the registry survives a task worktree being torn down
 * (task gap-discovery-carriers-ephemeral-in-worktree).
 */
export const METHOD_REGISTRY_REL = DISCOVERY_CARRIERS["discovery-method-registry"].rel;

/** The ONE record kind this carrier holds, so a line is self-describing on read-back. */
export const METHOD_KIND = "method";

export const METHOD_STATUSES = Object.freeze(["draft", "active", "retired"]);

// ── the PROMOTION EVIDENCE rule (draft → active is the ONLY gate that mints reusable knowledge) ───
//
// ⛔ THE DEFECT THIS CLOSES (task gap-discovery-carriers-ephemeral-in-worktree, 2026-10-12 audit): the
//   only `active` method ever recorded (`method-afe5ac899aa54241`, `shared-contract-divergence` v2) was
//   promoted on INVALID evidence — a lineage leak (its held-out case was the v1 seed) plus a temporal
//   mismatch (post-fix code graded against a pre-fix label). Nothing in the registry could tell that
//   promotion apart from a sound one, because a `status:"active"` record needed no evidence at all.
//   ⇒ A promotion must now CITE a recorded `validateGeneralization` verdict, and THAT verdict must have
//   passed the lineage and temporal gates. The verifier can then be re-read; a bare `status:"active"`
//   cannot be minted.

/** The umbrella refusal code for a promotion that cites no valid generalization verdict. */
export const PROMOTION_WITHOUT_VALID_GENERALIZATION = "PROMOTION_WITHOUT_VALID_GENERALIZATION";

/** The enumerated sub-causes (硬规则 3: a refusal says WHICH way it failed, never one opaque string). */
export const PROMOTION_REFUSAL_CAUSES = Object.freeze([
  "EVIDENCE_MISSING",      // status=active but no `generalization_evidence.verdict_ref`
  "VERDICTS_UNAVAILABLE",  // the recorded verdicts could not be read ⇒ cannot be checked (own value)
  "VERDICT_NOT_RECORDED",  // the ref names no recorded verdict
  "VERDICT_OTHER_METHOD",  // the recorded verdict is about a different method_id
  "VERDICT_NOT_PASSED",    // recorded, but the lineage/temporal gates did not pass
]);

/**
 * The promotion-evidence refusals a record draws, given the RECORDED verdicts. PURE. A record that is
 * not `active` draws none — the rule is about the draft→active transition, not about every record.
 * @param {object} rec
 * @param {object[]|undefined} verdicts the recorded verdicts, or `undefined` when they could not be
 *   read (its OWN value, exactly like `toolCatalog`/`provenanceSeeds` — 硬规则 3b).
 * @returns {string[]} zero or more `PROMOTION_WITHOUT_VALID_GENERALIZATION:<cause>:<detail>` reasons
 */
export function generalizationEvidenceReasons(rec, verdicts) {
  if (rec?.status !== "active") return [];
  const kill = (cause, detail) => `${PROMOTION_WITHOUT_VALID_GENERALIZATION}:${cause}:${detail}`;
  const ge = rec.generalization_evidence;
  if (!isObj(ge) || !isStr(ge.verdict_ref, 1)) {
    return [kill("EVIDENCE_MISSING", "status=active-must-carry-generalization_evidence.verdict_ref-naming-a-recorded-validateGeneralization-verdict")];
  }
  if (!Array.isArray(verdicts)) {
    return [kill("VERDICTS_UNAVAILABLE", `${ge.verdict_ref}-cannot-be-resolved-because-${GENERALIZATION_VERDICTS_REL}-could-not-be-read`)];
  }
  const v = verdicts.find((x) => isObj(x) && x.id === ge.verdict_ref);
  if (!v) return [kill("VERDICT_NOT_RECORDED", `${ge.verdict_ref}-names-no-recorded-verdict`)];
  if (isStr(v.method_id, 1) && isStr(rec.method_id, 1) && v.method_id !== rec.method_id) {
    return [kill("VERDICT_OTHER_METHOD", `${ge.verdict_ref}-was-recorded-for-${v.method_id}-not-${rec.method_id}`)];
  }
  // "Passed" is spelled from the RECORD's own fields, never from the promotion's claim: an evaluated
  // verdict that was correct, with no refusal and neither the lineage nor the temporal gate failed.
  const passed = v.outcome === "evaluated" && v.correct === true && v.refusal_code === null &&
    v.lineage_ok !== false && v.temporal_ok !== false;
  if (!passed) {
    return [kill("VERDICT_NOT_PASSED",
      `${ge.verdict_ref}-recorded-outcome=${String(v.outcome)}-correct=${String(v.correct)}-refusal_code=${String(v.refusal_code)}-lineage_ok=${String(v.lineage_ok)}-temporal_ok=${String(v.temporal_ok)}`)];
  }
  return [];
}

/** `applicability` is free text, but it must have SUBSTANCE — a method whose applicability is
 *  `{applies: true}` says nothing. The check is on the joined non-whitespace length (硬规则 4: the
 *  threshold is on a measured quantity, and it is deliberately the ONLY numeric gate here). */
export const MIN_APPLICABILITY_CHARS = 20;

/** `dedupMethods` reports the threshold it used (it is never hidden): a pair is flagged when it
 *  shares at least this many `domain_signals` AND this many `tools`. */
export const DEDUP_THRESHOLD = Object.freeze({ minSharedDomainSignals: 1, minSharedTools: 1 });

/** Every exported FUNCTION of the evidence store is a valid `operation.tools` entry (the Plan's
 *  "evidence-store primitives"). Derived MECHANICALLY from the module namespace — a hand-kept list
 *  would drift the moment the store gains a function. */
export const EVIDENCE_STORE_PRIMITIVES = Object.freeze(
  Object.entries(evidenceStore).filter(([, v]) => typeof v === "function").map(([k]) => k).sort(),
);

/** The capability-catalog declarations DATA file — the single source the `.sh` entry renders. */
export const CATALOG_DECLARATIONS_REL = "plugin/scripts/capability-catalog-declarations.json";

/** This module's repo root (docs/analysis/ → repo). The catalog is a property of the CODEBASE, not of
 *  the analysed workspace, so the default catalog is resolved against THIS root. */
export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

/** Per-record required fields — declared as DATA so the refusal reasons are enumerable and testable. */
export const REQUIRED_METHOD_FIELDS = Object.freeze([
  "method_id", "version", "ts", "provenance_evidence", "applicability", "operation",
  "expected_invariant", "falsification", "cost_budget", "status", "retirement_reason", "supersedes",
]);

const isStr = (x, n = 1) => typeof x === "string" && x.trim().length >= n;
const isObj = (x) => x !== null && typeof x === "object" && !Array.isArray(x);
const isInt = (x) => Number.isInteger(x);
const nonWs = (s) => String(s ?? "").replace(/\s+/g, "").length;
const supplied = (o, k) => Object.prototype.hasOwnProperty.call(o, k) && o[k] !== undefined;
const strArr = (x, min = 0) => Array.isArray(x) && x.length >= min && x.every((s) => isStr(s, 1));

/** Absolute path of the one fixed sink under the SHARED checkout (null when unresolvable). */
export const registryFile = (root) => carrierFile(root, METHOD_REGISTRY_REL);

// ── the tool catalog (a LISTING, never an assertion) ────────────────────────────────────────────

/**
 * Read the capability catalog's declared names. Fail-closed: an absent / unreadable / empty
 * declarations file returns `{ok:false, reason}` — NEVER an empty list that would read as
 * "no tool is known, so refuse everything" or, worse, "there is nothing to check against" (硬规则 3b).
 * @returns {{ok:true, names:string[], file:string} | {ok:false, reason:string, names:[]}}
 */
export function loadToolCatalog(root = REPO_ROOT) {
  const file = path.join(root, CATALOG_DECLARATIONS_REL);
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
    const names = Object.keys(isObj(parsed.QUESTION) ? parsed.QUESTION : {});
    if (names.length === 0) return { ok: false, reason: `CATALOG_EMPTY_DECLARATIONS:${file}`, names: [] };
    return { ok: true, names, file };
  } catch (e) {
    return { ok: false, reason: `CATALOG_UNREADABLE:${file}:${e?.code ?? e?.message ?? "unknown"}`, names: [] };
  }
}

/** The allowed `operation.tools` vocabulary = the catalog's names ∪ the evidence store's primitives. */
export function defaultToolNames(root = REPO_ROOT) {
  const cat = loadToolCatalog(root);
  if (!cat.ok) return { ok: false, reason: cat.reason, names: [] };
  return { ok: true, names: [...new Set([...cat.names, ...EVIDENCE_STORE_PRIMITIVES])].sort(), file: cat.file };
}

// ── the SEED set: what the method was ABOUT, read off its own provenance ─────────────────────────
//
// ⛔ The tool check above can only answer "is this name a real instrument?" — a LISTING cannot answer
// "is this name the thing that was INSPECTED?", because both are catalog entries. That second question
// is answered here, from the record's own `provenance_evidence` (see the header). Nothing in this
// section is a hand-kept list of forbidden names: the seed set is DERIVED per record.

export const TOOL_IS_SUBJECT = "TOOL_IS_SUBJECT";
export const METHOD_TEXT_NAMES_SEED = "METHOD_TEXT_NAMES_SEED";
export const PROVENANCE_SEEDS_UNAVAILABLE = "PROVENANCE_SEEDS_UNAVAILABLE";

/** The free-text fields a seed name must not appear in (Plan 2). Declared as DATA, in ONE place, so
 *  the resolver that SCANS and the validator that REPORTS can never disagree about what was scanned. */
export const SEED_SCANNED_TEXT_FIELDS = Object.freeze([
  "operation.steps", "expected_invariant", "falsification", "applicability",
]);

/** `plugin/scripts/x.ts` and `x.ts` are the SAME file — the tool↔subject comparison is by basename
 *  (the plan's rule), and it is the same normalization the ledger's deny-list patterns already use. */
export const basenameOf = (s) => String(s ?? "").replace(/\\/g, "/").split("/").pop();

/**
 * Every `{field, text}` pair the seed scan reads, in a FIXED order. Pure. A field the record does not
 * carry is simply absent — "nothing to scan" is not "scanned and clean".
 * @returns {{field:string, text:string}[]}
 */
export function seedScannedTexts(rec) {
  const out = [];
  const steps = rec?.operation?.steps;
  if (Array.isArray(steps)) {
    const text = steps.filter((s) => isStr(s, 1)).join("\n");
    if (text) out.push({ field: "operation.steps", text });
  }
  if (isStr(rec?.expected_invariant, 1)) out.push({ field: "expected_invariant", text: rec.expected_invariant });
  if (isStr(rec?.falsification, 1)) out.push({ field: "falsification", text: rec.falsification });
  const ap = rec?.applicability;
  if (isObj(ap)) {
    const parts = [
      ...(Array.isArray(ap.domain_signals) ? ap.domain_signals : []),
      ...(Array.isArray(ap.preconditions) ? ap.preconditions : []),
    ].filter((s) => isStr(s, 1));
    if (parts.length) out.push({ field: "applicability", text: parts.join("\n") });
  }
  return out;
}

/**
 * The Experiences a record's `provenance_evidence` cites. A ref resolves on the ledger record's `id`
 * OR its `case_id`: `assembleCandidate` records the content-addressed `id`, while the evidence a
 * reviewer reads back prints the `case_id` — both name the same Experience, so both must resolve.
 * An unresolvable ref is NOT an error here (a method may legitimately cite an evidence-store outcome
 * id, which is not an Experience at all) — it simply contributes no components.
 */
export function provenanceExperiences(rec, experiences = []) {
  const refs = new Set((Array.isArray(rec?.provenance_evidence) ? rec.provenance_evidence : []).filter((r) => isStr(r, 1)));
  if (refs.size === 0) return [];
  return (Array.isArray(experiences) ? experiences : []).filter((e) =>
    isObj(e) && ((isStr(e.id, 1) && refs.has(e.id)) || (isStr(e.case_id, 1) && refs.has(e.case_id))));
}

/**
 * The SEED set of one record over a given ledger read: the components (full path AND basename) and the
 * case_ids of the Experiences its provenance cites. Pure.
 * @returns {{components:string[], component_basenames:string[], case_ids:string[], experiences:string[]}}
 */
export function seedSetForRecord(rec, experiences = []) {
  const seeds = provenanceExperiences(rec, experiences);
  const components = [...new Set(seeds.flatMap((e) => (Array.isArray(e.components) ? e.components : []))
    .filter((c) => isStr(c, 1)))].sort();
  return {
    components,
    component_basenames: [...new Set(components.map(basenameOf))].sort(),
    case_ids: [...new Set(seeds.map((e) => e.case_id).filter((c) => isStr(c, 1)))].sort(),
    experiences: seeds.map((e) => e.id ?? e.case_id).filter((x) => isStr(x, 1)),
  };
}

/**
 * Resolve the seed set for ONE record against the Experience ledger at `root`, INCLUDING the ledger's
 * own deny-list scan of the record's free text. The MATCHER is the ledger module's
 * (`experienceDenyList` → `scanExperienceLeak`), reused by import; only the DECISION is scoped here,
 * by keeping the matches whose `value` is one of THIS record's own seeds. Re-deriving the tokenization
 * would be a second definition of "what a component name looks like".
 *
 * Returns plain DATA (no functions), so `validateMethodRecord` stays pure and testable from a literal.
 * An unreadable ledger is its OWN value (硬规则 3b): a scan that could not run must never look like a
 * scan that ran and found nothing.
 *
 * @returns {{ok:true, components:string[], component_basenames:string[], case_ids:string[],
 *            text_matches:{field:string,kind:string,value:string}[]}
 *          | {ok:false, reason:string}}
 */
export function provenanceSeeds(root, rec) {
  const led = readExperienceLedger(root);
  if (!led.ok) {
    return {
      ok: false,
      reason: `${PROVENANCE_SEEDS_UNAVAILABLE}:${led.malformed_lines}-unparseable-line(s)-in-${EXPERIENCE_LEDGER_REL}-so-the-seed-set-cannot-be-read`,
    };
  }
  const seeds = seedSetForRecord(rec, led.records);
  const seedValues = new Set([...seeds.components, ...seeds.case_ids]);
  const text_matches = [];
  if (seedValues.size > 0) {
    const denyList = experienceDenyList(root);   // the ledger's own patterns (basename + case_id)
    for (const { field, text } of seedScannedTexts(rec)) {
      for (const m of scanExperienceLeak(denyList, text).matches) {
        if (seedValues.has(m.value)) text_matches.push({ field, kind: m.kind, value: m.value });
      }
    }
  }
  return { ok: true, ...seeds, text_matches, malformed_lines: led.malformed_lines };
}

/**
 * The SEED-code refusals a record draws under a given seed set — the TWO codes this rule introduces,
 * and nothing else. `validateMethodRecord` appends them last; `readMethodRegistry` uses the same
 * function to flag records written BEFORE the rule existed (a record is "legacy_unvalidated" exactly
 * when it draws one of these, not when it draws any other contract fault).
 */
export function seedReasons(rec, seeds) {
  if (!isObj(seeds)) {
    // ⛔ Not supplied ⇒ its OWN value, never a skipped check (硬规则 3b): a validator that cannot see
    // the seed set cannot tell "a tool" from "the file being inspected".
    return [`${PROVENANCE_SEEDS_UNAVAILABLE}:provenance-seeds-not-supplied-so-a-subject-file-cannot-be-told-from-a-tool`];
  }
  if (seeds.ok === false) return [String(seeds.reason ?? `${PROVENANCE_SEEDS_UNAVAILABLE}:seed-set-unreadable`)];
  const reasons = [];
  const subjects = new Set(Array.isArray(seeds.component_basenames) ? seeds.component_basenames : []);
  for (const t of Array.isArray(rec?.operation?.tools) ? rec.operation.tools : []) {
    if (isStr(t, 1) && subjects.has(basenameOf(t))) reasons.push(`${TOOL_IS_SUBJECT}:${t}`);
  }
  for (const m of Array.isArray(seeds.text_matches) ? seeds.text_matches : []) {
    reasons.push(`${METHOD_TEXT_NAMES_SEED}:${m?.field ?? "?"}:${m?.value ?? "?"}`);
  }
  return reasons;
}

// ── validation ──────────────────────────────────────────────────────────────────────────────────

/**
 * Validate ONE method record. PURE. Returns `{ok, reasons[]}` — reasons are DISTINCT codes so "the
 * caller forgot a field" can never collapse into "the record was fine but the write failed".
 *
 * @param {object} rec            candidate (unknown on purpose — a malformed one must be REPORTED)
 * @param {object} [opts]
 * @param {string[]} [opts.toolCatalog]  the allowed `operation.tools` vocabulary. ⛔ Absent ⇒ a
 *   distinct `TOOL_CATALOG_UNAVAILABLE` refusal, never a skipped check (硬规则 3b).
 * @param {object[]} [opts.existing]     the records already in the registry (for version
 *   monotonicity). Default `[]` = "no prior version is known"; the write path always passes what it
 *   READ, and an unreadable registry is refused before this function is reached.
 * @param {object} [opts.provenanceSeeds] the SEED set of this record (the shape `provenanceSeeds(root,
 *   rec)` returns). ⛔ Absent ⇒ a distinct `PROVENANCE_SEEDS_UNAVAILABLE` refusal, never a skipped
 *   check — the same own-value discipline as `toolCatalog`, for the same reason (硬规则 3b).
 * @param {object[]} [opts.verdicts] the RECORDED generalization verdicts (the carrier read back).
 *   ⛔ Absent ⇒ `VERDICTS_UNAVAILABLE` for a `status:"active"` record, never a skipped check — the
 *   same own-value discipline again. A non-active record never reads it.
 */
export function validateMethodRecord(rec, { toolCatalog, existing = [], provenanceSeeds: seeds, verdicts } = {}) {
  if (!isObj(rec)) return { ok: false, reasons: ["RECORD_NOT_OBJECT"] };
  const reasons = [];
  for (const f of REQUIRED_METHOD_FIELDS) if (!supplied(rec, f)) reasons.push(`SCHEMA_MISSING:${f}`);
  if (reasons.length) return { ok: false, reasons };   // field-typed checks below assume presence

  if (!isStr(rec.method_id, 1)) reasons.push("FIELD_INVALID:method_id");
  if (!isInt(rec.version) || rec.version < 1) reasons.push("FIELD_INVALID:version");
  if (!isStr(rec.ts, 4)) reasons.push("FIELD_INVALID:ts");

  // A method with ZERO provenance is an opinion, not a method (same grounding discipline as
  // `hypothesis.source_evidence`). Present-but-empty and absent are different causes upstream
  // (SCHEMA_MISSING) — this is the empty/wrong-typed case.
  if (!strArr(rec.provenance_evidence, 1)) {
    reasons.push("PROVENANCE_EMPTY:provenance_evidence-must-cite-at-least-one-evidence-store-record-or-teaching-case");
  }

  if (!isObj(rec.applicability) || !strArr(rec.applicability.domain_signals) || !strArr(rec.applicability.preconditions)) {
    reasons.push("APPLICABILITY_INVALID:needs-{domain_signals:[string],preconditions:[string]}");
  } else {
    const joined = [...rec.applicability.domain_signals, ...rec.applicability.preconditions].join(" ");
    if (nonWs(joined) < MIN_APPLICABILITY_CHARS) {
      reasons.push(`APPLICABILITY_INSUBSTANTIAL:needs->=${MIN_APPLICABILITY_CHARS}-non-whitespace-chars-got-${nonWs(joined)}`);
    }
  }

  if (!isObj(rec.operation) || !strArr(rec.operation.steps, 1) || !strArr(rec.operation.tools, 1)) {
    reasons.push("OPERATION_INVALID:needs-{steps:[string],tools:[string]}");
  } else if (!Array.isArray(toolCatalog)) {
    // The catalog was not supplied (or was unreadable upstream) ⇒ its OWN value, never a pass.
    reasons.push("TOOL_CATALOG_UNAVAILABLE:operation.tools-cannot-be-checked-without-a-capability-catalog-listing");
  } else {
    const known = new Set(toolCatalog);
    for (const t of rec.operation.tools) if (!known.has(t)) reasons.push(`TOOL_NOT_IN_CATALOG:${t}`);
  }

  if (!isStr(rec.expected_invariant, 10)) reasons.push("FIELD_INVALID:expected_invariant");
  // The refutation condition is what makes a method falsifiable — same discipline as the evidence
  // store's `hypothesis.counterexample_requirement`. Present-but-empty has its own code.
  if (!isStr(rec.falsification, 1)) reasons.push("FALSIFICATION_EMPTY:falsification-must-name-what-would-refute-a-candidate");

  const cb = rec.cost_budget;
  if (!isObj(cb) || !isInt(cb.max_candidates) || cb.max_candidates < 0 ||
      !isInt(cb.max_model_calls) || cb.max_model_calls < 0 ||
      !isInt(cb.max_wall_ms) || cb.max_wall_ms < 0) {
    // `max_model_calls: 0` is legitimate (a purely mechanical method) — the gate is integrality and
    // non-negativity, not a made-up positive floor.
    reasons.push("COST_BUDGET_INVALID:needs-{max_candidates,max_model_calls,max_wall_ms}-integers->=0");
  }

  if (!METHOD_STATUSES.includes(rec.status)) {
    reasons.push(`STATUS_NOT_IN_VOCAB:${String(rec.status)}`);
  } else if (rec.status === "retired" && !isStr(rec.retirement_reason, 1)) {
    // A retired method with no reason is indistinguishable from a method that vanished.
    reasons.push("RETIREMENT_REASON_REQUIRED:status=retired-needs-a-non-empty-retirement_reason");
  }
  if (rec.retirement_reason !== null && !isStr(rec.retirement_reason, 1)) reasons.push("FIELD_INVALID:retirement_reason");
  // A `generalization_evidence` of the wrong TYPE is its own field fault regardless of status (a
  // promotion is not the only record that can carry one); its CONTENT is judged only for `active`.
  if (supplied(rec, "generalization_evidence") && rec.generalization_evidence !== null && !isObj(rec.generalization_evidence)) {
    reasons.push("FIELD_INVALID:generalization_evidence");
  }
  if (rec.supersedes !== null && !isStr(rec.supersedes, 1)) reasons.push("FIELD_INVALID:supersedes");
  if (isStr(rec.supersedes, 1) && rec.supersedes === rec.method_id) {
    reasons.push("FIELD_INVALID:supersedes-cannot-be-the-method_id-itself");
  }

  // Version monotonicity: a version is never reused and never skipped (append-only / shrink-only).
  if (isStr(rec.method_id, 1) && isInt(rec.version) && rec.version >= 1) {
    const prior = (Array.isArray(existing) ? existing : [])
      .filter((r) => isObj(r) && r.method_id === rec.method_id && isInt(r.version))
      .map((r) => r.version);
    const highest = prior.length ? Math.max(...prior) : 0;
    if (rec.version !== highest + 1) {
      reasons.push(`VERSION_NOT_MONOTONIC:${rec.method_id}-expects-${highest + 1}-got-${rec.version}`);
    }
  }

  // ── the SEED checks, LAST so every field-level refusal above keeps its existing order and code ───
  // `seedReasons` is the ONE definition of these two codes (the same one `readMethodRegistry` uses to
  // flag records written before the rule existed).
  reasons.push(...seedReasons(rec, seeds));

  // ── the PROMOTION-EVIDENCE check, after the seed checks for the same "existing order" reason ─────
  reasons.push(...generalizationEvidenceReasons(rec, verdicts));

  return { ok: reasons.length === 0, reasons };
}

/** Deterministic content-addressed id, reusing the evidence store's own primitive. */
export const methodRecordId = (rec) => recordId(METHOD_KIND, rec);

// ── read ────────────────────────────────────────────────────────────────────────────────────────

/**
 * Read the registry back. Returns the LATEST version per `method_id` in `latest` (never a superseded
 * version presented as current) and the full record list in `history` — but ONLY when
 * `history:true` was asked for; otherwise `history` is `null`, deliberately distinct from `[]`.
 * Unparseable lines are DROPPED and COUNTED; `ok` is false when any exist, because the next version
 * cannot be safely determined from a partially-readable carrier.
 *
 * Every record in `latest` carries `legacy_unvalidated` / `legacy_reasons`: a record written before the
 * tool≠subject rule existed is NOT rewritten on disk, it is flagged here when it would now be refused.
 * @returns {{ok:boolean, latest:object[], history:object[]|null, malformed_lines:number, file:string}}
 */
export function readMethodRegistry(root, { history = false } = {}) {
  const file = registryFile(root);
  if (file === null) {
    // An unresolvable shared checkout is its OWN value — never "an empty registry" (硬规则 3b).
    const rr = resolveCarrierRoot(root);
    return { ok: false, latest: [], history: history ? [] : null, malformed_lines: 0, file: null, reason: rr.reason };
  }
  const { records, malformed_lines } = readRecords(file);   // the evidence store's carrier reader
  const byId = new Map();
  for (const r of records) {
    if (!isObj(r) || typeof r.method_id !== "string") continue;
    const cur = byId.get(r.method_id);
    if (!cur || (isInt(r.version) && r.version > (isInt(cur.version) ? cur.version : -1))) byId.set(r.method_id, r);
  }
  // Records written BEFORE the tool≠subject rule existed were never checked against it. They are left
  // exactly as they are on disk (append-only, and rewriting history is not this function's job) and
  // FLAGGED on read-back instead: `legacy_unvalidated` is a boolean on every returned record, so
  // "re-checked and clean" is a different value from "never checked under this rule" (硬规则 6).
  const led = readExperienceLedger(root);
  const flagged = [...byId.values()].map((r) => {
    const seeds = led.ok
      ? provenanceSeeds(root, r)
      : { ok: false, reason: `${PROVENANCE_SEEDS_UNAVAILABLE}:${led.malformed_lines}-unparseable-line(s)-in-${EXPERIENCE_LEDGER_REL}-so-the-seed-set-cannot-be-read` };
    const legacy_reasons = seedReasons(r, seeds);
    return { ...r, legacy_unvalidated: legacy_reasons.length > 0, legacy_reasons };
  });
  const latest = flagged.sort((a, b) => (a.method_id < b.method_id ? -1 : a.method_id > b.method_id ? 1 : 0));
  return { ok: malformed_lines === 0, latest, history: history ? records : null, malformed_lines, file };
}

/**
 * The methods whose LATEST recorded version is `active` — the only methods a consumer may apply.
 *
 * Reads through `readMethodRegistry`, so "latest" is the same judgment everywhere (a superseded v1
 * can never be returned as current), and a retired latest version is absent. `ok:false` is inherited
 * from the read (a partially-readable registry, or an unresolvable shared checkout, is never reported
 * as "no active methods"): `evaluated` is returned alongside so the caller can tell "checked N
 * methods, none active" from "could not check".
 * @returns {{ok:boolean, methods:object[], evaluated:number, malformed_lines:number, file:string|null,
 *            reason?:string}}
 */
export function activeMethods(root) {
  const read = readMethodRegistry(root);
  return {
    ok: read.ok,
    methods: read.latest.filter((m) => isObj(m) && m.status === "active"),
    evaluated: read.latest.length,
    malformed_lines: read.malformed_lines,
    file: read.file,
    ...(isStr(read.reason, 1) ? { reason: read.reason } : {}),
  };
}

// ── append ──────────────────────────────────────────────────────────────────────────────────────

/**
 * Append ONE validated method record. Returns `{ok:true, id, file, record}` or
 * `{ok:false, reasons, appended:false}`. ⛔ On refusal NOTHING is written and no field is defaulted.
 *
 * The registry is READ first so the version check sees the real prior versions; an unreadable
 * registry is refused with its OWN reason rather than being silently treated as empty (硬规则 3b).
 */
export function appendMethodRecord(root, rec, { toolCatalog, toolCatalogRoot, provenanceSeeds: seeds, generalizationVerdicts } = {}) {
  const read = readMethodRegistry(root, { history: true });
  if (read.file === null) {
    // No shared checkout ⇒ nothing can be read OR written: the resolver's own refusal, not a
    // "the registry is empty" that would let the write land in the caller's worktree.
    return { ok: false, kind: METHOD_KIND, appended: false, reasons: [read.reason] };
  }
  if (!read.ok) {
    return {
      ok: false, kind: METHOD_KIND, appended: false,
      reasons: [`REGISTRY_UNREADABLE:${read.malformed_lines}-unparseable-line(s)-in-${METHOD_REGISTRY_REL}-so-the-next-version-cannot-be-determined`],
    };
  }
  // The REAL catalog by default, so a caller that passes nothing still gets the tool check; an
  // unreadable catalog becomes the validator's own TOOL_CATALOG_UNAVAILABLE refusal, not a skip.
  let catalog = toolCatalog;
  if (catalog === undefined) {
    const def = defaultToolNames(toolCatalogRoot ?? REPO_ROOT);
    catalog = def.ok ? def.names : null;   // an unreadable default catalog ⇒ null ⇒ TOOL_CATALOG_UNAVAILABLE
  }
  // The REAL seed set by default, resolved from the record's OWN provenance against the ledger at
  // `root`. An unreadable ledger becomes PROVENANCE_SEEDS_UNAVAILABLE, never a skipped check.
  const resolvedSeeds = seeds === undefined ? provenanceSeeds(root, rec) : seeds;
  // The RECORDED generalization verdicts, read back so a `status:"active"` promotion can be checked
  // against the verdict it cites. An unreadable verdict carrier becomes the validator's own
  // VERDICTS_UNAVAILABLE refusal — never a skipped check.
  let resolvedVerdicts = generalizationVerdicts;
  if (resolvedVerdicts === undefined) {
    const vc = readCarrier(root, GENERALIZATION_VERDICTS_REL, GENERALIZATION_VERDICT_KIND);
    resolvedVerdicts = vc.ok ? vc.records : undefined;
  }
  const v = validateMethodRecord(rec, {
    toolCatalog: Array.isArray(catalog) ? catalog : undefined,
    existing: read.history,
    provenanceSeeds: resolvedSeeds,
    verdicts: Array.isArray(resolvedVerdicts) ? resolvedVerdicts : undefined,
  });
  if (!v.ok) return { ok: false, kind: METHOD_KIND, reasons: v.reasons, appended: false };
  const withId = { id: rec.id ?? methodRecordId(rec), ...rec };
  return appendCarrierLine(root, METHOD_REGISTRY_REL, withId, { kind: METHOD_KIND });
}

// ── dedup (a REPORT, never an auto-merge) ───────────────────────────────────────────────────────

const intersect = (a, b) => {
  const bs = new Set(Array.isArray(b) ? b : []);
  return (Array.isArray(a) ? a : []).filter((x) => bs.has(x));
};

/**
 * Flag method PAIRS whose applicability signals and whose tools overlap at or above the reported
 * threshold. This is a REPORT: the caller decides whether the pair should be merged, and nothing is
 * mutated here. `threshold` is returned alongside the pairs so the flag is never a hidden judgment.
 *
 * Two VERSIONS of the same `method_id` are never a duplicate pair — a v2 that supersedes v1 shares
 * everything with it by construction.
 *
 * @param {object|object[]} registry  the value of `readMethodRegistry(root)` (uses `.latest`), or a
 *   plain array of records.
 */
export function dedupMethods(registry, { minSharedDomainSignals, minSharedTools } = {}) {
  const minS = isInt(minSharedDomainSignals) ? minSharedDomainSignals : DEDUP_THRESHOLD.minSharedDomainSignals;
  const minT = isInt(minSharedTools) ? minSharedTools : DEDUP_THRESHOLD.minSharedTools;
  const list = (Array.isArray(registry) ? registry : (registry?.latest ?? [])).filter(isObj);
  const pairs = [];
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      const a = list[i], b = list[j];
      if (!isStr(a.method_id, 1) || !isStr(b.method_id, 1) || a.method_id === b.method_id) continue;
      const shared_domain_signals = intersect(a.applicability?.domain_signals, b.applicability?.domain_signals);
      const shared_tools = intersect(a.operation?.tools, b.operation?.tools);
      if (shared_domain_signals.length >= minS && shared_tools.length >= minT) {
        pairs.push({
          pair_id: `dup-${sha256(`${a.method_id}|${b.method_id}`).slice(0, 12)}`,
          a: a.method_id, b: b.method_id,
          shared_domain_signals, shared_tools,
        });
      }
    }
  }
  return { ok: true, evaluated: list.length, threshold: { minSharedDomainSignals: minS, minSharedTools: minT }, pairs };
}
