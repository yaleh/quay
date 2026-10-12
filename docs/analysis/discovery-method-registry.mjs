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
//     `**/.quay/*` wildcard), so wiring this carrier to write into a live checkout needs a
//     `**/.quay/discovery-method-registry.jsonl` line there. THIS task wires no writer (plan item 8),
//     so it adds none — and `.gitignore` is outside its declared ## Touches.
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

/** The one fixed sink (relative to the analysed root) — same convention as the evidence store's. */
export const METHOD_REGISTRY_REL = ".quay/discovery-method-registry.jsonl";

/** The ONE record kind this carrier holds, so a line is self-describing on read-back. */
export const METHOD_KIND = "method";

export const METHOD_STATUSES = Object.freeze(["draft", "active", "retired"]);

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

/** Absolute path of the one fixed sink for a given root. */
export const registryFile = (root) => path.join(root, METHOD_REGISTRY_REL);

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
 */
export function validateMethodRecord(rec, { toolCatalog, existing = [] } = {}) {
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
 * @returns {{ok:boolean, latest:object[], history:object[]|null, malformed_lines:number, file:string}}
 */
export function readMethodRegistry(root, { history = false } = {}) {
  const file = registryFile(root);
  const { records, malformed_lines } = readRecords(file);   // the evidence store's carrier reader
  const byId = new Map();
  for (const r of records) {
    if (!isObj(r) || typeof r.method_id !== "string") continue;
    const cur = byId.get(r.method_id);
    if (!cur || (isInt(r.version) && r.version > (isInt(cur.version) ? cur.version : -1))) byId.set(r.method_id, r);
  }
  const latest = [...byId.values()].sort((a, b) => (a.method_id < b.method_id ? -1 : a.method_id > b.method_id ? 1 : 0));
  return { ok: malformed_lines === 0, latest, history: history ? records : null, malformed_lines, file };
}

// ── append ──────────────────────────────────────────────────────────────────────────────────────

/**
 * Append ONE validated method record. Returns `{ok:true, id, file, record}` or
 * `{ok:false, reasons, appended:false}`. ⛔ On refusal NOTHING is written and no field is defaulted.
 *
 * The registry is READ first so the version check sees the real prior versions; an unreadable
 * registry is refused with its OWN reason rather than being silently treated as empty (硬规则 3b).
 */
export function appendMethodRecord(root, rec, { toolCatalog, toolCatalogRoot } = {}) {
  const read = readMethodRegistry(root, { history: true });
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
  const v = validateMethodRecord(rec, { toolCatalog: Array.isArray(catalog) ? catalog : undefined, existing: read.history });
  if (!v.ok) return { ok: false, kind: METHOD_KIND, reasons: v.reasons, appended: false };
  const withId = { id: rec.id ?? methodRecordId(rec), ...rec };
  const file = registryFile(root);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, JSON.stringify({ kind: METHOD_KIND, ...withId }) + "\n", "utf8");
  return { ok: true, kind: METHOD_KIND, id: withId.id, file, record: withId };
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
