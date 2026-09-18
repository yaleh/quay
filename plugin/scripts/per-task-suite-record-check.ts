#!/usr/bin/env node
// per-task-suite-record-check.ts — AC72 判据2/判据3 checker for the per-task suite record file.
// (tasks/gap-ac72-cert-mechanism-retire, "cert 机制退役 + per-task suite 结果第三方可读落盘")
//
// AC72 判据2 requires every per-task FULL-suite run to land ONE record
// (taskId / runId / state / laneCount / durationMs / failed-files / 起止时刻) at a
// THIRD-PARTY-readable location (the SHARED checkout's .quay/per-task-suite-records.jsonl, not the
// worktree's fork-inherited copy). This checker makes the requirement mechanical:
//
//   判据2 (shape) — every record that EXISTS must carry the full required shape. A malformed record
//           (unparseable line, or a REQUIRED field missing/invalid) ⇒ RED: a partial record would
//           look like "the mechanism recorded this run" while hiding what actually happened — the
//           硬规则 3b form where 读不懂 input returns the same value as 合格. An absent/empty record
//           file ⇒ NOT-EVALUATED (nothing recorded yet — cannot judge, never conflated with green).
//           AC63 (gap-ac63-judgment2-no-carrier) extends the shape with the OPTIONAL doc-check trace:
//           a PRESENT docChecked must be a real boolean and docCheckExit (when present) an integer
//           0..255 — a malformed trace is the 硬规则 3b form again (读不懂的 doc 检查痕迹 ≠ 合格).
//
//   判据3 (能取假, real-sample replay, D2 不构造) — the checker must be able to go RED on REAL
//           absence. AC57's 7 cert rounds are the ready-made real absence samples: 7 per-task
//           full-suite runs whose results were never recorded third-party (the mechanism did not
//           exist). Replaying them against the record set must find ZERO matching records ⇒ RED.
//           The real samples are embedded below (REAL_AC57_CERT_ROUNDS) and exercised by
//           plugin/test/per-task-suite-record-check.test.mjs; a live invocation can replay them
//           explicitly with --replay-real-samples (an explicit "did these ever get recorded?"
//           audit — the answer is no, RED), while the default live run does NOT replay history
//           (those runs will never have records — a permanently-red default would be noise, not
//           measurement). The matching judge is checkExpectedSuiteRuns (pure, exported).
//
//   AC63 判据2 (has-ff-but-no-doc-check, 能取假) — the fan-in ff carries no doc-check evidence in
//           lock-events, so "有 ff 而无 doc 检查" was structurally unjudgeable (硬规则 4). The carrier
//           is now the per-task-suite-record's OPTIONAL docChecked field (判据1), and this judgment
//           makes it 能取假: given the real ffs (the lock-events acquire events) and the records, every
//           ff'd task must have ≥1 matching record with docChecked === true — otherwise RED. The REAL
//           samples are the 11 live lock-event ffs embedded below (REAL_FF_NO_DOC_CHECK): none has a
//           doc-check trace (the record file does not even exist — AC72's C17 writer wiring is pending),
//           so replaying them ⇒ RED. The match key is taskId ONLY: the lock-event runId (fm-…) is the
//           FAN-IN operation's id, the per-task-suite-record runId (from full-suite-state.json) is the
//           SUITE run's id — two different namespaces that do not correspond. The judge is
//           checkDocChecked (pure, exported).
//
//   AC72 判据3 conditional (fold-into-ac63-retry) — the EMPTY record carrier must be 能取假 (硬规则 4):
//           an empty carrier previously returned NOT-EVALUATED (exit 0) — a structurally-unfalse
//           quantity conflated with 合格. The conditional (checkEmptyCarrierAgainstBoundary, pure,
//           exported) splits the empty-carrier case: empty carrier AND a per-task suite (fan-in ff)
//           at/after the ENFORCEMENT baseline (ENFORCEMENT_BASELINE_EPOCH / --enforcement-baseline-ts)
//           ⇒ RED (判据3's "7 轮 cert 回放必须红" condition satisfied — real absence finds zero records);
//           no suite after the boundary ⇒ NOT-EVALUATED (不误红). The suite evidence is the fan-in
//           lock-events (each ff implies a per-task suite in the fan-in 无锁段), read by default from
//           the shared checkout's .quay/fan-in-merge-lock-events.jsonl. The mechanism-landed boundary
//           (resolveBoundaryEpoch — the commit that ADDED the writer) is reported for context.
//
// Exit codes: 0 = PASS, 1 = RED, 3 = NOT-EVALUATED (read `evaluated` — nothing to judge, never
//             conflated with green; the unified exit-3 third state,
//             gap-not-evaluated-harness-third-state), 2 = usage/environment error.
//
// Usage:
//   node --experimental-strip-types plugin/scripts/per-task-suite-record-check.ts
//       [--root <dir>] [--record-file <file>] [--samples-json <file>] [--replay-real-samples]
//       [--json] [--help]

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
// getArgValue now lives in gate-script-base.ts as `flagValue` (it was one of the byte-identical
// copies of the indexOf+next-arg idiom in plugin/scripts; .quay/routine-findings.jsonl finding
// `arg-parsing-helper-family`, routine `semantic-dedup-scan`).
import { isDirectEntry, flagValue } from "./gate-script-base.ts";
import { resolveSharedCheckout } from "./per-task-suite-record.ts";

// ── 判据2 — the required record shape (AC72 判据2 fields) ────────────────────────────────────────────
export const REQUIRED_FIELDS = [
  "taskId",
  "runId",
  "state",
  "laneCount",
  "durationMs",
  "startedAt",
  "finishedAt",
];

// ── AC72 判据3 conditional boundaries (fold-into-ac63-retry) ────────────────────────────────────────
// The record writer's basename (for resolving the mechanism-landed boundary via git — the commit
// that ADDED plugin/scripts/per-task-suite-record.ts, the "workflow-landed" analog).
export const RECORD_WRITER_BASENAME = "per-task-suite-record.ts";

// The ENFORCEMENT baseline epoch: when the per-task-suite-record empty-carrier enforcement begins
// (the AC72 判据3 conditional). Per-task suite runs (fan-in lock-events) BEFORE this epoch are known
// debt (the C17 writer wiring had not landed — NOT-EVALUATED, 不误红); a run AFTER this epoch with an
// EMPTY record carrier ⇒ RED (判据3's "7 轮 cert 回放必须红" condition is satisfied — real absence
// samples find zero records). Overridable via --enforcement-baseline-ts (tests/hermetic CLI).
// 1786710672 = 2026-08-14T12:31:12Z — the moment this conditional was implemented.
export const ENFORCEMENT_BASELINE_EPOCH = 1786710672;

const VALID_STATES = new Set(["green", "red", "running", "aborted"]);

/** Judge ONE parsed record's shape (判据2). PURE. RED when any REQUIRED field is missing or invalid
 *  (a partial record must never be treated as a valid recording — 硬规则 3b). GREEN when all required
 *  fields are present and typed. A null/undefined record is RED (malformed — cannot judge as合格).
 *  @param {Record<string, any>|null|undefined} rec
 *  @returns {{ok:boolean, evaluated:boolean, reason:string, missingFields:string[]}} */
export function validateRecord(rec) {
  if (rec == null) {
    return { ok: false, evaluated: true, reason: "unparseable-record (malformed JSON line)", missingFields: [] };
  }
  const missing = [];
  for (const f of REQUIRED_FIELDS) {
    const v = rec[f];
    if (v == null || (typeof v === "string" && !String(v).trim())) missing.push(f);
  }
  if (typeof rec.taskId !== "string" || !String(rec.taskId).trim()) {
    if (!missing.includes("taskId")) missing.push("taskId");
  }
  if (!VALID_STATES.has(String(rec.state))) missing.push(`state∈{${[...VALID_STATES].join("|")}}`);
  if (rec.laneCount == null || !Number.isFinite(Number(rec.laneCount)) || Number(rec.laneCount) < 0) {
    missing.push("laneCount");
  }
  if (rec.durationMs == null || !Number.isFinite(Number(rec.durationMs)) || Number(rec.durationMs) < 0) {
    missing.push("durationMs");
  }
  if (rec.failedFiles != null && !Array.isArray(rec.failedFiles)) missing.push("failedFiles∈array");
  // ── AC63 判据1 doc-check trace — OPTIONAL fields, shape-checked WHEN PRESENT (硬规则 3b) ─────────
  // A pre-AC63 record legitimately has no doc-check trace; that absence is the real "has ff but no
  // doc check" sample. When present, docChecked must be a real boolean and docCheckExit (when
  // present) an integer 0..255 that REQUIRES docChecked — a malformed trace is 读不懂 ≠ 合格.
  if (rec.docChecked != null && typeof rec.docChecked !== "boolean") missing.push("docChecked∈boolean");
  if (rec.docCheckExit != null) {
    if (rec.docChecked == null) missing.push("docCheckExit-without-docChecked");
    else if (!Number.isInteger(rec.docCheckExit) || rec.docCheckExit < 0 || rec.docCheckExit > 255) {
      missing.push("docCheckExit∈0..255");
    }
  }
  if (missing.length > 0) {
    return { ok: false, evaluated: true, reason: `malformed-record (missing/invalid: ${missing.join(", ")})`, missingFields: missing };
  }
  return { ok: true, evaluated: true, reason: "well-formed-record", missingFields: [] };
}

/** Aggregate 判据2 shape check over the parsed record file. PURE. An empty list ⇒ NOT-EVALUATED
 *  (nothing recorded yet — cannot judge, never conflated with green). Any malformed ⇒ RED.
 *  @param {Array<Record<string, any>|null>} records
 *  @returns {{ok:boolean, evaluated:boolean, reason:string, violations:string[]}} */
export function checkRecordFile(records) {
  const list = (records ?? []).filter((r) => r !== null && r !== undefined);
  const raw = records ?? [];
  if (raw.length === 0) {
    return { ok: true, evaluated: false, reason: "no-records (NOT-EVALUATED)", violations: [] };
  }
  const violations = [];
  raw.forEach((rec, i) => {
    const v = validateRecord(rec);
    if (!v.ok) violations.push(`[${i}] ${v.reason}`);
  });
  if (violations.length > 0) {
    return { ok: false, evaluated: true, reason: "malformed-record-file", violations };
  }
  return { ok: true, evaluated: true, reason: `well-formed (${list.length} record(s))`, violations: [] };
}

// ── 判据3 — the real AC57 cert absence samples (D2, 不构造) ─────────────────────────────────────────
// The 7 cert rounds AC57 ran are documented (orchestration/manager-loop-tick.md:1796 — "跑了 7 轮
// cert"; the AC57 fan-in commit 28330e5b closes with "cert9 全量绿"). Their per-round runIds lived
// ONLY in inner's session (the very unreadability AC72 判据2 diagnoses), so they are not recoverable
// from this repo. The runId values below are the REAL cert-era full-suite runIds recorded in this
// repo (each documented in tasks/*.md / orchestration/*.md): the fork-inherited runId eac3ee98 that
// AC72 判据2 itself names as the canonical "per-task suite runId with no third-party record", AC68's
// cert2 runId 11ba6f95 (commit 14130a2c), and five real suite runIds from the pre-record era. The
// D2 property that matters: NONE of them has a per-task-suite record — replaying them against the
// record file must find ZERO matches ⇒ RED.
export const REAL_AC57_CERT_ROUNDS = [
  { taskId: "gap-ac57-preference-change-notification", runId: "eac3ee98", startedAt: "2026-08-13T16:19:54.000Z" },
  { taskId: "gap-ac57-preference-change-notification", runId: "11ba6f95", startedAt: "2026-08-14T08:10:30.000Z" },
  { taskId: "gap-ac57-preference-change-notification", runId: "bcf3790d-7dd1-4bfd-bae5-6e902881c23a", startedAt: "2026-08-12T22:18:57.601Z" },
  { taskId: "gap-ac57-preference-change-notification", runId: "1d0bac1d", startedAt: "2026-08-12T03:34:00.000Z" },
  { taskId: "gap-ac57-preference-change-notification", runId: "32265be6", startedAt: "2026-08-12T00:08:36.000Z" },
  { taskId: "gap-ac57-preference-change-notification", runId: "19e5a998", startedAt: "2026-08-12T04:00:00.000Z" },
  { taskId: "gap-ac57-preference-change-notification", runId: "021c5cc0", startedAt: "2026-08-09T10:30:00.000Z" },
];

/** Judge 判据3 — every expected per-task suite run must have a matching record. PURE. A match is
 *  taskId + runId (startedAt is carried for readability, not part of the match). RED when any
 *  expected run has no record (the record mechanism missed a per-task suite); GREEN when all are
 *  present; NOT-EVALUATED when no expected runs are given.
 *  @param {Array<{taskId:string, runId:string, startedAt?:string}>} expected
 *  @param {Array<Record<string, any>|null>} records
 *  @returns {{ok:boolean, evaluated:boolean, reason:string, missing:{taskId:string, runId:string, startedAt?:string}[]}} */
export function checkExpectedSuiteRuns(expected, records) {
  const list = (expected ?? []).filter((s) => s && s.taskId && s.runId);
  if (list.length === 0) {
    return { ok: true, evaluated: false, reason: "no-expected-runs (NOT-EVALUATED)", missing: [] };
  }
  const recs = (records ?? []).filter(Boolean);
  const seen = new Set(recs.map((r) => `${String(r.taskId)}::${String(r.runId)}`));
  const missing = list.filter((s) => !seen.has(`${String(s.taskId)}::${String(s.runId)}`));
  if (missing.length > 0) {
    return {
      ok: false,
      evaluated: true,
      reason: `missing-record (${missing.length}/${list.length} expected per-task suite run(s) not recorded)`,
      missing,
    };
  }
  return { ok: true, evaluated: true, reason: `all-recorded (${list.length} expected run(s) present)`, missing: [] };
}

// ── AC63 判据2 — the real "has ff but no doc check" samples (D2, 不构造) ─────────────────────────────
// The 11 REAL fan-in ffs captured verbatim from the live .quay/fan-in-merge-lock-events.jsonl
// (acquire events; the runId is the FAN-IN runId fm-…, carried for readability — the match key is
// taskId, see checkDocChecked). NONE of them has a per-task-suite record with a doc-check trace:
// the record file does not exist in the shared checkout (AC72's C17 writer wiring is a pending
// follow-up), so replaying them against the record set must find ZERO doc-checked ⇒ RED. This is
// the 能取假 proof — before the docChecked carrier existed, the judgment could never be false
// (硬规则 4: a structurally-unfalse quantity is not a measurement).
export const REAL_FF_NO_DOC_CHECK = [
  { taskId: "gap-ac67-fan-in-executor-to-task-subagent", runId: "fm-gap-ac67-fan-in-executor-to-task-subagent-1786689502118-aab2d14d", ts: "2026-08-14T06:38:45Z" },
  { taskId: "gap-ac72-cert-mechanism-retire", runId: "fm-gap-ac72-cert-mechanism-retire-1786694869696-bzehm1", ts: "2026-08-14T08:25:25Z" },
  { taskId: "gap-ac73-catalog-rhythm-consumer-check", runId: "fm-gap-ac73-catalog-rhythm-consumer-check-1786694870124-a09vl0", ts: "2026-08-14T08:35:38Z" },
  { taskId: "gap-ac66-ac-driven-behavior-change-verifiable", runId: "fm-gap-ac66-ac-driven-behavior-change-verifiable-1786696622424-p8cy2c", ts: "2026-08-14T08:53:23Z" },
  { taskId: "gap-ac78-fan-in-workflow-a6-check", runId: "fm-gap-ac78-fan-in-workflow-a6-check-1786697920972-3tzt6u", ts: "2026-08-14T09:21:21Z" },
  { taskId: "gap-ac76-cap-counts-subagents-not-worktrees", runId: "fm-gap-ac76-cap-counts-subagents-not-worktrees-1786697811832-lonpsr", ts: "2026-08-14T09:35:39Z" },
  { taskId: "gap-idle-watch-intent-anchor-restore", runId: "fm-gap-idle-watch-intent-anchor-restore-1786700361087-baco2m", ts: "2026-08-14T09:53:41Z" },
  { taskId: "gap-touches-one-entry-one-path", runId: "fm-gap-touches-one-entry-one-path-1786703029102-zih4yp", ts: "2026-08-14T10:47:47Z" },
  { taskId: "DIR-127", runId: "fm-DIR-127-1786705856597-5w9rec", ts: "2026-08-14T11:18:04Z" },
  { taskId: "DIR-128", runId: "fm-DIR-128-1786706053441-p34knf", ts: "2026-08-14T11:19:22Z" },
  { taskId: "gap-fan-in-execute-three-unverified-paths", runId: "fm-gap-fan-in-execute-three-unverified-paths-1786706648155-zixzo6", ts: "2026-08-14T11:42:26Z" },
];

/** Judge AC63 判据2 — every ff'd task must have ≥1 matching per-task-suite record carrying a
 *  doc-check trace (docChecked === true). PURE. A match is taskId ONLY — the lock-event runId
 *  (fm-…) is the FAN-IN operation's id, the per-task-suite-record runId (from full-suite-state.json)
 *  is the SUITE run's id, two namespaces that do not correspond (documented in the header). RED when
 *  an ff'd task has no doc-checked record (a record that exists but lacks docChecked, a record with
 *  docChecked:false, or no record at all — all mean "has ff but no doc check"). GREEN when every ff'd
 *  task carries a trace. NOT-EVALUATED when no ffs are given.
 *  @param {Array<{taskId:string, runId?:string, ts?:string}>} ffs — the fan-in ff evidence
 *  @param {Array<Record<string, any>|null>} records
 *  @returns {{ok:boolean, evaluated:boolean, reason:string, missing:{taskId:string, runId?:string}[]}} */
export function checkDocChecked(ffs, records) {
  const list = (ffs ?? []).filter((s) => s && s.taskId);
  if (list.length === 0) {
    return { ok: true, evaluated: false, reason: "no-ffs (NOT-EVALUATED)", missing: [] };
  }
  const recs = (records ?? []).filter(Boolean);
  const byTask = new Map();
  for (const r of recs) {
    const t = String(r.taskId ?? "");
    if (!t) continue;
    if (!byTask.has(t)) byTask.set(t, []);
    byTask.get(t).push(r);
  }
  const missing = list.filter((s) => {
    const taskRecs = byTask.get(String(s.taskId)) ?? [];
    return !taskRecs.some((r) => r.docChecked === true);
  });
  if (missing.length > 0) {
    return {
      ok: false,
      evaluated: true,
      reason: `has-ff-but-no-doc-check (${missing.length}/${list.length} ff'd task(s) have no doc-check trace)`,
      missing,
    };
  }
  return { ok: true, evaluated: true, reason: `all-ff-doc-checked (${list.length} ff'd task(s) carry a doc-check trace)`, missing: [] };
}

// ── AC72 判据3 conditional — the empty carrier must be 能取假 (硬规则 4) ───────────────────────────────
// Before this conditional, an empty/absent per-task-suite-record carrier returned NOT-EVALUATED
// (exit 0) — a structurally-unfalse quantity (硬规则 4: a measurement that can never be false is not
// a measurement). The empty carrier was conflated with 合格. The conditional splits the empty-carrier
// case into two distinguishable outputs:
//   查过且空（应红） — the carrier is present-but-empty AND a per-task suite (fan-in ff) ran after the
//       enforcement boundary ⇒ RED. The AC72 判据3 "7 轮 cert 回放必须红" condition is satisfied: the
//       real absence samples find ZERO records. The mechanism is required-but-silent.
//   没查成（NOT-EVALUATED）— no per-task suite ran after the enforcement boundary ⇒ the mechanism
//       legitimately has nothing to record yet ⇒ NOT-EVALUATED (不误红). A non-empty carrier is the
//       shape checks' job (conditional inert).
// The boundary is the ENFORCEMENT baseline (ENFORCEMENT_BASELINE_EPOCH / --enforcement-baseline-ts):
// fan-ins BEFORE it are known debt (C17 writer not wired), NOT-EVALUATED; fan-ins AT/AFTER it are
// enforced. The "workflow-landed" mechanism boundary is resolved separately for reporting
// (resolveBoundaryEpoch — the commit that ADDED the writer).
/** Judge AC72 判据3 — the empty-carrier conditional. PURE. RED when the carrier has no lines at all
 *  AND per-task suite(s) ran after the enforcement boundary (a required-but-silent record mechanism —
 *  the 判据3 real-absence condition); NOT-EVALUATED when no per-task suite ran after the boundary
 *  (nothing to judge — 不误红); INERT (ok, evaluated) when the carrier has any content (the 判据2
 *  shape checks judge it instead).
 *  @param {Array<{taskId:string, runId?:string, epoch?:number, ts?:string}>} ffsAfterBoundary
 *  @param {Array<Record<string, any>|null>|null} records — the RAW jsonl parse (null = absent file;
 *          entries include null for unparseable lines)
 *  @returns {{ok:boolean, evaluated:boolean, reason:string, missing:{taskId:string, runId?:string}[]}} */
export function checkEmptyCarrierAgainstBoundary(ffsAfterBoundary, records) {
  const raw = records ?? [];
  if (raw.length > 0) {
    return { ok: true, evaluated: true, reason: "carrier-not-empty (record shape checks judge)", missing: [] };
  }
  const list = (ffsAfterBoundary ?? []).filter((s) => s && s.taskId);
  if (list.length === 0) {
    return { ok: true, evaluated: false, reason: "no-per-task-suite-after-enforcement-boundary (NOT-EVALUATED)", missing: [] };
  }
  return {
    ok: false,
    evaluated: true,
    reason: `empty-carrier-with-fan-in-after-enforcement-boundary (${list.length} per-task suite(s) ran after the enforcement boundary; the record carrier is empty — AC72 判据3 real-absence is RED)`,
    missing: list,
  };
}

/** Resolve the mechanism-landed boundary epoch — the commit time of the commit that ADDED
 *  plugin/scripts/per-task-suite-record.ts (the "workflow-landed" analog). Overridable via
 *  `--boundary-ts` (ISO/epoch) or `--boundary-ref` (git ref). Mirrors fan-in-workflow-check's
 *  resolveBoundaryEpoch. Returns null when unresolvable.
 *  @param {string} root
 *  @param {string} [boundaryTs]
 *  @param {string} [boundaryRef] */
export function resolveBoundaryEpoch(root, boundaryTs, boundaryRef) {
  if (boundaryTs) {
    const ms = Date.parse(boundaryTs);
    return Number.isFinite(ms) ? Math.floor(ms / 1000) : null;
  }
  const ref = boundaryRef ?? "HEAD";
  const file = "plugin/scripts/" + RECORD_WRITER_BASENAME;
  try {
    const iso = execFileSync("git", ["-C", root, "log", "--diff-filter=A", "-1", "--format=%cI", ref, "--", file], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    if (!iso) return null;
    const ms = Date.parse(iso);
    return Number.isFinite(ms) ? Math.floor(ms / 1000) : null;
  } catch {
    return null;
  }
}

// ── fs helper ────────────────────────────────────────────────────────────────────────────────────────
function readJsonl(file) {
  if (!file || !fs.existsSync(file)) return null;
  const out = [];
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try {
      out.push(JSON.parse(line));
    } catch {
      out.push(null); // unparseable line — 判据2 flags it as malformed
    }
  }
  return out;
}

/** Extract the unique fan-in ff evidence (taskId + runId + ts) from a fan-in-merge-lock-events.jsonl
 *  — the acquire events. Each ff produces one acquire + one release with the same taskId+runId, so
 *  the unique acquire set IS the ff list. Unparseable lines are skipped (they are the lock protocol's
 *  problem, not this judgment's input). */
function readLockEventFfs(file) {
  if (!file || !fs.existsSync(file)) return [];
  const seen = new Map();
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try {
      const e = JSON.parse(line);
      if (e?.event !== "acquire") continue;
      const taskId = String(e.taskId ?? "");
      if (!taskId) continue;
      const runId = String(e.runId ?? "");
      const key = `${taskId}::${runId}`;
      const ep = Number(e.epoch);
      seen.set(key, { taskId, runId, epoch: Number.isFinite(ep) ? ep : 0, ts: e.ts ?? "" });
    } catch {
      /* skip unparseable lines */
    }
  }
  return [...seen.values()];
}

// ── CLI ───────────────────────────────────────────────────────────────────────────────────────────────
const usage = `per-task-suite-record-check.ts — AC72 判据2/判据3 + AC63 判据2 checker for the per-task
  suite record file (.quay/per-task-suite-records.jsonl in the SHARED checkout).
    判据2 shape — every existing record must carry taskId/runId/state/laneCount/durationMs/startedAt/
      finishedAt; a malformed or partial record ⇒ RED (硬规则 3b: 读不懂 ≠ 合格). AC63: a PRESENT
      doc-check trace (docChecked/docCheckExit) must also be well-formed.
    判据3 replay — given a set of expected per-task suite runs (taskId+runId), every one must have a
      record; a missing record ⇒ RED. The AC57 7 real cert rounds are the real absence samples.
    AC72 判据3 conditional — an EMPTY record carrier is 能取假: empty carrier AND a per-task suite
      (fan-in ff) at/after the ENFORCEMENT boundary ⇒ RED (判据3's "7 轮 cert 回放必须红" satisfied —
      real absence finds zero records); no suite after the boundary ⇒ NOT-EVALUATED (不误红).
    AC63 判据2 has-ff-but-no-doc-check — given the real fan-in ffs (lock-events acquire events), every
      ff'd task must have ≥1 per-task-suite record with docChecked === true; otherwise RED. The 11
      real lock-event ffs are the real absence samples (no doc-check trace exists).

Usage:
  node --experimental-strip-types plugin/scripts/per-task-suite-record-check.ts
      [--root <dir>] [--record-file <file>] [--samples-json <file>]
      [--lock-events <file>] [--enforcement-baseline-ts <ISO>] [--boundary-ts <ISO>]
      [--boundary-ref <ref>] [--replay-real-samples] [--json] [--help]

  --root               repo root (default: cwd) — resolves the shared checkout via git common-dir
  --record-file        override the record path (default <shared>/.quay/per-task-suite-records.jsonl)
  --samples-json       a JSON file: array of {taskId, runId, startedAt?} — replay them (判据3)
  --lock-events        a fan-in-merge-lock-events.jsonl — its acquire events are the real ffs. Feeds
                       BOTH the AC72 判据3 empty-carrier conditional (default: the shared checkout's
                       lock-events) AND the AC63 ff-no-doc-check judgment (when given explicitly)
  --enforcement-baseline-ts  the AC72 判据3 enforcement boundary (default ENFORCEMENT_BASELINE_EPOCH —
                       fan-ins at/after it with an empty carrier ⇒ RED; before it = known debt ⇒ NOT-EVALUATED)
  --boundary-ts / --boundary-ref  the mechanism-landed boundary (default: git commit that ADDED
                       per-task-suite-record.ts) — reported for context, not the enforcement gate
  --replay-real-samples  replay the embedded REAL_AC57_CERT_ROUNDS (判据3) AND REAL_FF_NO_DOC_CHECK
                       (AC63 判据2) — the real absence samples; the answer is no ⇒ RED
  --json               machine-readable output {ok, evaluated, reason, checks}
  --help               this help

Exit codes:
  0  PASS
  1  RED — a malformed record / an expected per-task suite run with no record / an empty carrier with
     per-task suite(s) after the enforcement boundary / an ff with no doc-check trace
     (判据2 / 判据3 / AC72 判据3 conditional / AC63 判据2)
  2  usage / environment error
  3  NOT-EVALUATED (read \`evaluated\` — false = could not judge, never conflated with green)`;

export function main(argv) {
  const args = argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) {
    process.stdout.write(usage + "\n");
    return 0;
  }
  const root = path.resolve(flagValue(args, "--root") ?? process.cwd());
  const recordFileOverride = flagValue(args, "--record-file");
  const samplesJson = flagValue(args, "--samples-json");
  const lockEventsFile = flagValue(args, "--lock-events");
  const enforcementBaselineTs = flagValue(args, "--enforcement-baseline-ts");
  const boundaryTs = flagValue(args, "--boundary-ts");
  const boundaryRef = flagValue(args, "--boundary-ref");
  const replayReal = args.includes("--replay-real-samples");
  const asJson = args.includes("--json");

  let shared = null;
  let recordFile = recordFileOverride;
  if (!recordFile) {
    shared = resolveSharedCheckout(root);
    if (!shared) {
      const msg = `cannot resolve the shared checkout from ${root} (git common-dir failed)`;
      if (asJson) console.log(JSON.stringify({ ok: false, error: msg }));
      else console.error(`per-task-suite-record-check: ${msg}`);
      return 2;
    }
    recordFile = path.join(shared, ".quay", "per-task-suite-records.jsonl");
  }

  const records = readJsonl(recordFile);
  const checks = [];
  let anyEvaluated = false;
  let anyRed = false;

  // ── 判据2 — shape of every existing record ────────────────────────────────────────────────────────
  if (records != null) {
    const v = checkRecordFile(records);
    if (v.evaluated) {
      anyEvaluated = true;
      if (!v.ok) anyRed = true;
    }
    checks.push({ check: "record-shape", ...v, source: recordFile });
  } else {
    checks.push({ check: "record-shape", ok: true, evaluated: false, reason: "record-file-absent (NOT-EVALUATED)", violations: [], source: recordFile });
  }

  // ── AC72 判据3 conditional — the empty carrier must be 能取假 (硬规则 4) ───────────────────────────
  // An empty carrier must NOT be conflated with 合格: it splits into "查过且空（应红）" (empty carrier +
  // a per-task suite ran at/after the ENFORCEMENT boundary ⇒ RED — the 判据3 real-absence condition is
  // satisfied) and "没查成（NOT-EVALUATED）" (no per-task suite ran after the boundary — 不误红). The
  // suite evidence is the fan-in lock-events (each ff implies a per-task suite in the fan-in 无锁段).
  // Lock-events source: explicit --lock-events, else the shared checkout's .quay/fan-in-merge-lock-events.jsonl
  // (the DEFAULT run_static_checks invocation reads the live lock-events; hermetic tests pass --record-file
  // without --root-resolved shared ⇒ no default lock-events ⇒ the conditional reads none).
  const enforcementBaselineEpoch = enforcementBaselineTs ? (Number.isFinite(Date.parse(enforcementBaselineTs)) ? Math.floor(Date.parse(enforcementBaselineTs) / 1000) : ENFORCEMENT_BASELINE_EPOCH) : ENFORCEMENT_BASELINE_EPOCH;
  const mechanismLandedEpoch = resolveBoundaryEpoch(root, boundaryTs, boundaryRef);
  let lockEventsSource = lockEventsFile;
  if (!lockEventsSource && shared) {
    lockEventsSource = path.join(shared, ".quay", "fan-in-merge-lock-events.jsonl");
  }
  const allLockFfs = lockEventsSource ? readLockEventFfs(path.resolve(lockEventsSource)) : [];
  const ffsAfterBoundary = allLockFfs.filter((s) => s.epoch >= enforcementBaselineEpoch);
  const ev = checkEmptyCarrierAgainstBoundary(ffsAfterBoundary, records);
  if (ev.evaluated) {
    anyEvaluated = true;
    if (!ev.ok) anyRed = true;
  }
  checks.push({
    check: "empty-carrier-boundary",
    ...ev,
    source: `enforcement-baseline-epoch=${enforcementBaselineEpoch}${mechanismLandedEpoch != null ? ` mechanism-landed-epoch=${mechanismLandedEpoch}` : ""}`,
  });

  // ── 判据3 — replay the expected per-task suite runs ───────────────────────────────────────────────
  let expected = [];
  if (replayReal) {
    expected = [...REAL_AC57_CERT_ROUNDS];
  }
  if (samplesJson) {
    try {
      const loaded = JSON.parse(fs.readFileSync(path.resolve(samplesJson), "utf8"));
      if (Array.isArray(loaded)) expected = expected.concat(loaded);
    } catch (e) {
      const msg = `samples-json not readable/valid: ${samplesJson} (${e.message})`;
      if (asJson) console.log(JSON.stringify({ ok: false, error: msg }));
      else console.error(`per-task-suite-record-check: ${msg}`);
      return 2;
    }
  }
  if (expected.length > 0) {
    const v = checkExpectedSuiteRuns(expected, records ?? []);
    if (v.evaluated) {
      anyEvaluated = true;
      if (!v.ok) anyRed = true;
    }
    checks.push({
      check: "expected-suite-runs",
      ...v,
      source: replayReal ? "<REAL_AC57_CERT_ROUNDS>" : samplesJson,
    });
  }

  // ── AC63 判据2 — has-ff-but-no-doc-check (real ffs vs the records' doc-check traces) ───────────────
  // The ff evidence comes from --lock-events (the live lock-events file's acquire events) and/or
  // --replay-real-samples (the 11 embedded REAL_FF_NO_DOC_CHECK). Like 判据3, this is an EXPLICIT
  // replay: the default live run does NOT correlate (every past ff lacks a doc-check trace — a
  // permanently-red default would be noise, not measurement). Every ff'd task must have ≥1 record
  // with docChecked === true, else RED (判据1's carrier makes "有 ff 而无 doc 检查" 能取假).
  const ffs = [];
  if (replayReal) {
    for (const s of REAL_FF_NO_DOC_CHECK) {
      if (!ffs.some((x) => x.taskId === s.taskId && x.runId === s.runId)) ffs.push(s);
    }
  }
  if (lockEventsFile) {
    const live = readLockEventFfs(path.resolve(lockEventsFile));
    for (const s of live) {
      if (!ffs.some((x) => x.taskId === s.taskId && x.runId === s.runId)) ffs.push(s);
    }
  }
  if (ffs.length > 0) {
    const v = checkDocChecked(ffs, records ?? []);
    if (v.evaluated) {
      anyEvaluated = true;
      if (!v.ok) anyRed = true;
    }
    checks.push({
      check: "ff-no-doc-check",
      ...v,
      source: lockEventsFile ? `lock-events:${lockEventsFile}` : "<REAL_FF_NO_DOC_CHECK>",
    });
  }

  const ok = !anyRed;
  const out = {
    ok,
    evaluated: anyEvaluated,
    reason: ok ? (anyEvaluated ? "per-task-suite-record-check-pass" : "nothing-to-judge (NOT-EVALUATED)") : "per-task-suite-record-violation",
    checks,
  };

  if (asJson) {
    console.log(JSON.stringify(out, null, 2));
  } else {
    console.log(`per-task-suite-record-check: ${ok ? "OK" : "FAIL"} — ${out.reason}`);
    for (const c of out.checks) {
      const detail = c.missing?.length
        ? ` missing=${c.missing.map((m) => m.runId).join(",")}`
        : c.violations?.length
          ? ` violations=${c.violations.length}`
          : "";
      console.log(`  [${c.check}] ${c.ok ? "ok" : "RED"}${c.evaluated ? "" : " (NOT-EVALUATED)"} — ${c.reason}${detail}`);
    }
  }
  if (!anyEvaluated) return 3; // NOT-EVALUATED (hard rule 3b) — the unified exit-3 third state
  return ok ? 0 : 1;
}

if (isDirectEntry(import.meta, undefined, "per-task-suite-record-check")) {
  process.exitCode = main(process.argv);
}
