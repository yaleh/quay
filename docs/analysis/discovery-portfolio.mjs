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

/** The one fixed sink, relative to the SHARED checkout. */
export const PORTFOLIO_REL = ".quay/discovery-portfolio.jsonl";
/** The record kind a Finding carries. */
export const PORTFOLIO_KIND = "portfolio_finding";
/** The record kind a human RATING carries — a separate append-only line, applied on read. */
export const PORTFOLIO_RATING_KIND = "portfolio_rating";

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

/** Human rating vocabulary. `noise` is the value that SUBTRACTS from value — it is why a rating can
 *  never be inferred: only a human can say "this was real, but worthless". */
export const RATING_VALUES = Object.freeze(["high", "medium", "low", "noise"]);

/** The ONLY actor that may write a human rating. `task-worker` is refused (see the header). */
export const RATING_ACTORS = Object.freeze(["operator-session"]);

/** Per-input required fields. `method_ref` / `fix_task` / `human_rating` are required to be PRESENT but
 *  may be `null` — "no method", "no fix filed" and "unrated" are values, not missing keys (硬规则 6). */
export const REQUIRED_INPUT_FIELDS = Object.freeze([
  "finding_id", "origin", "origin_ref", "evidence_level", "method_ref", "claim", "outcome",
  "fix_task", "human_rating",
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

// ── read (findings with their ratings applied) ──────────────────────────────────────────────────

/**
 * Read the portfolio back, with the append-only RATING lines applied to the findings they name.
 * @returns {{ok:boolean, records:object[], ratings:object[], file:string|null, malformed_lines:number}}
 */
export function readPortfolio(root) {
  const raw = readCarrier(root, PORTFOLIO_REL, null);
  if (raw.file === null) return { ...raw, records: [], ratings: [], reason: raw.reason };
  const ratings = raw.records.filter((r) => isObj(r) && r.kind === PORTFOLIO_RATING_KIND);
  const byFinding = new Map();
  for (const r of ratings) byFinding.set(r.finding_id, r);   // line order is the precedence rule
  const records = raw.records.filter((r) => isObj(r) && r.kind === PORTFOLIO_KIND).map((r) => {
    const rating = byFinding.get(r.finding_id);
    return {
      ...r,
      human_rating: rating ? { value: rating.value, by: rating.by, ts: rating.ts } : null,
    };
  });
  return { ...raw, records, ratings };
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
export const REAL_BACKFILL_ROWS_2026_10_12 = Object.freeze([
  { finding_id: "F01", origin: "autonomous-routine", origin_ref: "semantic-dedup-scan-1791733865369#doc-check-cache-vs-scoped-gate-cache", evidence_level: "production-open", method_ref: null, claim: "duplicated cache read/write authority (doc-check-cache vs scoped-gate cache in worker-fan-in)", outcome: "supported", fix_task: "gap-routine-semantic-dedup-scan-doc-check-cache-vs-scoped-gate-cache", human_rating: null },
  { finding_id: "F02", origin: "autonomous-routine", origin_ref: "semantic-dedup-scan-1791733865369#isDirectInvocation-pair", evidence_level: "production-open", method_ref: null, claim: "byte-identical isDirectInvocation copies in config-wiring-check and drivable-workspace-check", outcome: "supported", fix_task: "gap-routine-semantic-dedup-scan-isdirectinvocation-pair", human_rating: null },
  { finding_id: "F03", origin: "autonomous-routine", origin_ref: "semantic-dedup-scan-1791733865369#splitArgs-isNonNegInt-trio", evidence_level: "production-open", method_ref: null, claim: "splitArgs/isNonNegInt trio duplicated across three drivers", outcome: "supported", fix_task: "gap-routine-semantic-dedup-scan-splitargs-isnonnegint-trio", human_rating: null },
  { finding_id: "F04", origin: "autonomous-experiment", origin_ref: "E-DT-1-Hp cluster 11", evidence_level: "independent", method_ref: null, claim: "two lock-hold pairers with different keys and a double-acquire policy", outcome: "supported", fix_task: "gap-fan-in-lock-hold-pairing-two-divergent-keys", human_rating: null },
  { finding_id: "F05", origin: "autonomous-experiment", origin_ref: "E-HYPGEN-AB-1-B cluster 8", evidence_level: "independent", method_ref: null, claim: "REQUIRED_FIELDS declared separately in the per-task suite-record writer and its checker", outcome: "supported", fix_task: "gap-per-task-suite-record-required-fields-declared-twice", human_rating: null },
  { finding_id: "F06", origin: "autonomous-experiment", origin_ref: "E-HYPGEN-ACCEPT-1 cluster 5", evidence_level: "independent", method_ref: null, claim: "NOT-EVALUATED exit 2/3 split; a malformed ac69 record passes the static gate", outcome: "supported", fix_task: "gap-ac69-malformed-record-exits-3-and-passes-the-static-gate", human_rating: null },
  { finding_id: "F07", origin: "operator", origin_ref: "gap-routine-quota-window-ms-parsed-but-inert", evidence_level: "teaching", method_ref: null, claim: "routine_quota.window_ms is parsed but never consumed", outcome: "supported", fix_task: "gap-routine-quota-window-ms-parsed-but-inert", human_rating: null },
  { finding_id: "F08", origin: "operator", origin_ref: "gap-errorsignature-merges-different-exit-codes", evidence_level: "teaching", method_ref: null, claim: "errorSignature merges exit codes 137/124/1 into one signature", outcome: "supported", fix_task: "gap-errorsignature-merges-different-exit-codes", human_rating: null },
  { finding_id: "F09", origin: "operator", origin_ref: "EXP-99aa24ac34d53b6a", evidence_level: "teaching", method_ref: null, claim: "the meta-driver owner search caps before filtering by status, and admits null evidence", outcome: "supported", fix_task: "gap-meta-driver-admission-gates-pass-when-they-cannot-know", human_rating: null },
  { finding_id: "F10", origin: "mechanical-instrument", origin_ref: "enum-surface-parity-check.ts", evidence_level: "production-open", method_ref: null, claim: "goal needs-human is missing from three goal surfaces (pre-existing KNOWN_DRIFT)", outcome: "supported", fix_task: "gap-goal-needs-human-missing-from-three-goal-surfaces", human_rating: null,
    // The catalog entry resolves the INSTRUMENT, not the subject: a "which surfaces" finding carries no
    // subject files in the catalog, so the three surfaces the instrument flagged are named here — read
    // off the fix task's own `## Touches`, not invented.
    components: ["packages/quay/src/serve-goal.ts", "packages/quay/src/mcp-handlers.ts", "packages/quay-native/src/mcp-server.ts"] },
  { finding_id: "F11", origin: "operator", origin_ref: "gap-in-round-suite-rerun-never-executed-in-production", evidence_level: "production-open", method_ref: null, claim: "the in-round suite rerun command is never declared, so the mechanism never ran in production", outcome: "supported", fix_task: "gap-in-round-suite-rerun-never-executed-in-production", human_rating: null },
  { finding_id: "F12", origin: "user", origin_ref: "EXP-99aa24ac34d53b6a", evidence_level: "teaching", method_ref: null, claim: "probe-routine and the meta-driver duplicate identity, dedup and quota; missed by nine blind runs", outcome: "supported", fix_task: null, human_rating: null },
  { finding_id: "N01", origin: "autonomous-experiment", origin_ref: "E-HYPGEN-ACCEPT-1 cluster 7", evidence_level: "independent", method_ref: null, claim: "claimed independent Touches parsers refuted: all of them import touches-parser.ts", outcome: "refuted", fix_task: null, human_rating: null },
]);

/**
 * Ingest the frozen reconstruction, one row at a time, reporting every refusal instead of stopping at
 * the first — a partially-ingested baseline must be VISIBLE as one. The duplicate rule runs for real
 * (no bypass): the 13 rows must show up as 13 distinct findings, and that is a property of the data, not
 * of a flag passed here.
 * @returns {{ok:boolean, ingested:string[], already_present:string[],
 *            refused:{finding_id:string, reasons:string[]}[], result:object}}
 */
export function backfill(root, rows = REAL_BACKFILL_ROWS_2026_10_12, opts = {}) {
  const ingested = [], already_present = [], refused = [];
  for (const row of rows) {
    const r = ingestFinding(root, row, opts);
    // A `DUPLICATE_ID` refusal is the append-only carrier saying "this finding is already recorded":
    // re-running the backfill appends nothing and is not an error state (the ledger's own model). It is
    // reported SEPARATELY from a real refusal — "already there" and "would not go in" are different.
    if (r.ok) ingested.push(row.finding_id);
    else if (r.duplicate === true) already_present.push(row.finding_id);
    else refused.push({ finding_id: row.finding_id, reasons: r.reasons });
  }
  return { ok: refused.length === 0, ingested, already_present, refused, result: valueMetrics(readPortfolio(root).records) };
}
