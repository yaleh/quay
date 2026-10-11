#!/usr/bin/env node
// ARCHITECTURE EVIDENCE STORE — the minimal structured carrier the ownership-active investigation loop
// never had: it recorded exactly ONE terminal object (a proposal envelope) and nothing that distinguishes
// "evidence" from "hypothesis" from "experiment" from "outcome".
//
// This module is the SCHEMA + APPEND half (pure policy + one file sink); the metrics half lives in
// `architecture-metrics.mjs` and is passed IN, so neither module imports the other.
//
// ⛔ STRUCTURAL SANDBOX (same spirit as `ownership-active-*.mjs`): this module does not import
// fileProposals / driveItems / fileDecisions, creates no task/goal/AC, writes no status. Its ONLY
// persistence is append-only lines to `.quay/architecture-evidence-store.jsonl` (gitignored, the same
// convention as `.quay/ownership-shadow-proposals.jsonl`).
//
// FAIL-CLOSED (硬规则 3b): a record missing a required field is REFUSED with a distinct reason code and
// nothing is appended. There is no default-filling and no silent success — "I could not write a valid
// record" must never be shaped like "I wrote one".

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const sha = (s) => crypto.createHash("sha256").update(s).digest("hex");
export const sha256 = (s) => sha(s);

/** The one fixed sink (relative to the investigated root), same convention as the proposal carrier. */
export const EVIDENCE_STORE_REL = ".quay/architecture-evidence-store.jsonl";

export const RECORD_KINDS = Object.freeze(["evidence", "hypothesis", "experiment", "outcome"]);

/** Outcome verdict vocabulary. `exempted` is a TERMINAL outcome produced by the decision memory
 *  (`architecture-decision-memory.mjs`): the item was already judged and must not be re-proposed. */
export const OUTCOME_VERDICTS = Object.freeze(["proposed", "abstained", "investigated", "not-evaluated", "exempted"]);

const isStr = (x, n = 1) => typeof x === "string" && x.trim().length >= n;
const isObj = (x) => x !== null && typeof x === "object" && !Array.isArray(x);
const isNum = (x) => typeof x === "number" && Number.isFinite(x);

const CONF_LEVELS = ["low", "medium", "high"];
export const confidence = (level, basis) => ({ level, basis });

/** Per-kind required fields — declared as DATA so the refusal reasons are enumerable and testable. */
export const REQUIRED_FIELDS = Object.freeze({
  evidence: Object.freeze(["tool", "ref", "ts", "sha256", "confidence"]),
  hypothesis: Object.freeze(["statement", "source_evidence", "ts"]),
  experiment: Object.freeze(["hypothesis_ref", "method", "budget", "ts"]),
  outcome: Object.freeze(["experiment_ref", "verdict", "ts"]),
});

/**
 * Validate ONE record of `kind`. PURE. Returns `{ok, reasons[]}` — reasons are DISTINCT codes so "the
 * caller forgot a field" can never collapse into "the record was fine but the write failed" (硬规则 3b).
 * @param {string} kind one of RECORD_KINDS
 * @param {object} rec  candidate (unknown on purpose — a malformed one must be REPORTED, not accepted)
 */
export function validateRecord(kind, rec) {
  if (!RECORD_KINDS.includes(kind)) return { ok: false, reasons: [`KIND_NOT_IN_VOCAB:${String(kind)}`] };
  if (!isObj(rec)) return { ok: false, reasons: ["RECORD_NOT_OBJECT"] };
  const reasons = [];
  // `{ref: undefined}` IS a missing field (the JS idiom for "I did not supply it") — presence alone is not enough.
  const supplied = (o, k) => Object.prototype.hasOwnProperty.call(o, k) && o[k] !== undefined;
  for (const f of REQUIRED_FIELDS[kind]) if (!supplied(rec, f)) reasons.push(`SCHEMA_MISSING:${f}`);
  if (reasons.length) return { ok: false, reasons };   // field-typed checks below assume presence

  if (!isStr(rec.ts, 4)) reasons.push("FIELD_INVALID:ts");

  if (kind === "evidence") {
    if (!isObj(rec.confidence) || !CONF_LEVELS.includes(rec.confidence.level) || !isStr(rec.confidence.basis, 4)) reasons.push("FIELD_INVALID:confidence");
    if (!isStr(rec.tool, 1)) reasons.push("FIELD_INVALID:tool");
    // `ref` is the commit sha the reading was taken AT — an unpinned reading is not evidence.
    if (!isStr(rec.ref, 6)) reasons.push("FIELD_INVALID:ref");
    if (!/^[0-9a-f]{64}$/.test(String(rec.sha256))) reasons.push("FIELD_INVALID:sha256");
    // A reading is located EITHER by a file+range OR by a tool scope+flags. Neither is optional.
    const byFile = isStr(rec.path, 1) && Array.isArray(rec.range) && rec.range.length === 2 && rec.range.every(isNum);
    const byScope = isStr(rec.scope, 1) && Array.isArray(rec.flags);
    if (!byFile && !byScope) reasons.push("EVIDENCE_LOCATION_MISSING:needs-(path+range)-or-(scope+flags)");
  } else if (kind === "hypothesis") {
    if (!isStr(rec.statement, 10)) reasons.push("FIELD_INVALID:statement");
    if (!Array.isArray(rec.source_evidence) || rec.source_evidence.length === 0 || !rec.source_evidence.every((x) => isStr(x, 1))) {
      reasons.push("HYPOTHESIS_UNGROUNDED:source_evidence-must-cite-at-least-one-reading");
    }
  } else if (kind === "experiment") {
    if (!isStr(rec.hypothesis_ref, 1)) reasons.push("FIELD_INVALID:hypothesis_ref");
    if (!isStr(rec.method, 3)) reasons.push("FIELD_INVALID:method");
    if (!isObj(rec.budget) || !Object.keys(rec.budget).length) reasons.push("FIELD_INVALID:budget");
  } else if (kind === "outcome") {
    if (!isStr(rec.experiment_ref, 1)) reasons.push("FIELD_INVALID:experiment_ref");
    if (!OUTCOME_VERDICTS.includes(rec.verdict)) reasons.push(`VERDICT_NOT_IN_VOCAB:${String(rec.verdict)}`);
  }
  return { ok: reasons.length === 0, reasons };
}

/** Deterministic content-addressed id: two byte-identical records collapse to one id, differing records do not. */
export function recordId(kind, rec) {
  const canonical = JSON.stringify(rec, Object.keys(rec).sort());
  return `${kind}-${sha(canonical).slice(0, 16)}`;
}

/** Absolute path of the one fixed sink for a given root. */
export const storeFile = (root) => path.join(root, EVIDENCE_STORE_REL);

/**
 * Append ONE validated record. Returns `{ok:true, id, file, record}` or `{ok:false, reasons, appended:false}`.
 * ⛔ On refusal NOTHING is written and no field is defaulted.
 */
export function appendRecord(root, kind, rec) {
  const v = validateRecord(kind, rec);
  if (!v.ok) return { ok: false, kind, reasons: v.reasons, appended: false };
  const withId = { id: rec.id ?? recordId(kind, rec), ...rec };
  const file = storeFile(root);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, JSON.stringify({ kind, ...withId }) + "\n", "utf8");
  return { ok: true, kind, id: withId.id, file, record: withId };
}

export const appendEvidenceRecord = (root, rec) => appendRecord(root, "evidence", rec);
export const appendHypothesisRecord = (root, rec) => appendRecord(root, "hypothesis", rec);
export const appendExperimentRecord = (root, rec) => appendRecord(root, "experiment", rec);
export const appendOutcomeRecord = (root, rec) => appendRecord(root, "outcome", rec);

/** Read the carrier back. Unparseable lines are DROPPED and COUNTED (never silently). */
export function readRecords(file) {
  if (!fs.existsSync(file)) return { records: [], malformed_lines: 0 };
  let malformed = 0;
  const records = fs.readFileSync(file, "utf8").split("\n").filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { malformed++; return null; } }).filter(Boolean);
  return { records, malformed_lines: malformed };
}

// ── run → records (the four-object projection of ONE investigation) ────────────────────────────
/** A reading becomes an `evidence` record: located by file+range or by tool scope+flags, commit-pinned, hashed. */
export function evidenceRecordFromReading(ev) {
  const p = ev.provenance || {};
  const hash = [p.content_sha256, ev.text_sha256].find((h) => typeof h === "string" && /^[0-9a-f]{64}$/.test(h)) ?? null;
  const rec = {
    tool: p.tool ?? ev.request?.kind ?? "unknown",
    ref: p.ref_commit ?? null,
    ts: p.ts ?? null,
    sha256: hash,
    confidence: ev.status === "ok" ? confidence("high", "tool reading, commit-pinned, content-hashed") : confidence("low", `reading status=${ev.status}; it is NOT a usable ground for a proposal`),
  };
  if (isStr(p.path, 1) && Array.isArray(p.range)) { rec.path = p.path; rec.range = p.range; }
  else {
    rec.scope = p.snapshot_scope ?? p.analysed_tree ?? "repo";
    rec.flags = p.flags ?? (p.command ? [p.command] : (ev.request ? [JSON.stringify(ev.request)] : []));
  }
  return rec;
}

/**
 * Project one run record (the value `runActiveInvestigation` returns) onto the four record kinds.
 * Pure. The caller (the loop's production path, or a replay runner) decides whether to persist them.
 * @param {object} run   a run record
 * @param {object} [metrics]  the value of `computeRunMetrics(run, gt?)` — spread onto the outcome record
 * @param {string} runId  caller-scoped identity (namespaces Holdout A / Holdout B / production)
 */
export function buildRunRecords(run, { runId, metrics = null } = {}) {
  // ev-0 is the INITIAL MECHANICAL FACTS, not a gathered reading — it is already the run's `facts`, so it is
  // not re-recorded as an evidence row. It remains CITABLE though: a run that abstained on the initial facts
  // alone rests on them, and saying otherwise would leave its hypothesis ungrounded.
  const gathered = (run.evidence || []).filter((e) => e.id !== "ev-0");
  const evidence = gathered.map(evidenceRecordFromReading);
  const citable = gathered.length ? gathered.map((e) => e.id) : (run.evidence?.[0] ? [run.evidence[0].id] : []);
  const hypothesis = {
    statement: String(run.facts?.head_subject ?? "investigation hypothesis").slice(0, 400),
    concern_kind: run.envelope?.concern_kind ?? null,
    source_evidence: citable,
    run_id: runId,
    ts: run.ts_iso,
  };
  // The hypothesis the judge actually ended on (its last stated one) is the one that was TESTED.
  const lastHypothesis = [...(run.steps || [])].reverse().find((s) => isStr(s.hypothesis, 10))?.hypothesis;
  if (isStr(lastHypothesis, 10)) hypothesis.statement = String(lastHypothesis).slice(0, 400);
  const experiment = {
    hypothesis_ref: hypothesis.statement,
    method: `bounded shadow investigation (${run.label}) — declarative evidence requests under hard budgets, no write surface`,
    budget: run.budget,
    run_id: runId,
    ts: run.ts_iso,
  };
  const subjectFiles = subjectFilesOf(run);
  const outcome = {
    experiment_ref: experiment.method,
    verdict: run.state === "not-evaluated" ? "not-evaluated"
      : run.decision_memory?.status === "exempted" ? "exempted"
      : run.terminal?.kind === "propose_slice" ? "proposed"
      : run.terminal?.kind === "abstain" ? "abstained" : "investigated",
    run_id: runId,
    label: run.label,
    commit: run.commit,
    subject_key: subjectKey(run.envelope?.concern_kind ?? "unknown", subjectFiles),
    subject_files: subjectFiles,
    concern_key: run.concern_key ?? null,
    gate_ok: run.gate_ok ?? null,
    ts: run.ts_iso,
  };
  if (metrics) outcome.metrics = metrics;
  return { evidence, hypothesis, experiment, outcome };
}

/** Repo-relative *file* paths a run actually names — a STRUCTURAL extraction: only tokens that are
 *  syntactically complete repo paths (a directory segment + a file extension) survive. A bare word in
 *  prose is never a location (硬规则 2: 按位置/结构判定, not by keyword). */
export const PATH_TOKEN_RE = /(?:^|[\s`"'(\[{])((?:packages|plugin|scripts|docs|tasks|goals|experiments)\/[A-Za-z0-9._@/-]+\.[A-Za-z0-9]+)/g;
export function extractPathTokens(text) {
  const out = new Set();
  for (const m of String(text || "").matchAll(PATH_TOKEN_RE)) out.add(m[1].replace(/^\.\//, ""));
  return [...out];
}
export function subjectFilesOf(run) {
  const out = new Set();
  const env = run.envelope || {};
  const add = (x) => { if (isStr(x, 3)) for (const p of extractPathTokens(x)) out.add(p); };
  if (Array.isArray(env.scope?.in_scope)) env.scope.in_scope.forEach(add);   // a declared in-scope entry that names a file IS a location
  for (const c of env.candidate_interventions || []) add(c?.title);
  add(env.concern);
  // NOTE: `slice_delta.delta` is the ARCHGUARD-COMPUTED result (before/after SCC members, removed edges) — it
  // carries no file list, and the files the cut moves are named by the proposal itself, i.e. in the envelope
  // above. Reading moves off the delta would be a dead branch pretending to be a source.
  return [...out].sort();
}

/** The identity that anti-cheat isolation is about: concern kind + the file set it names. */
export function subjectKey(concernKind, files) {
  return `${concernKind}|${[...files].sort().join(",")}`;
}

/**
 * Persist the four records of ONE run. Returns the four append RESULTS (never throws on refusal —
 * a refused record is reported with `ok:false` so the caller can surface it instead of losing it).
 */
export function persistRunRecords(root, run, opts = {}) {
  const built = buildRunRecords(run, opts);
  return {
    run_id: opts.runId ?? null,
    evidence: built.evidence.map((r) => appendEvidenceRecord(root, r)),
    hypothesis: appendHypothesisRecord(root, built.hypothesis),
    experiment: appendExperimentRecord(root, built.experiment),
    outcome: appendOutcomeRecord(root, built.outcome),
  };
}
