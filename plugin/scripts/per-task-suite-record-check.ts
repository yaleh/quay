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
// Exit codes: 0 = PASS (or NOT-EVALUATED — read `evaluated`), 1 = RED, 2 = usage/environment error.
//
// Usage:
//   node --experimental-strip-types plugin/scripts/per-task-suite-record-check.ts
//       [--root <dir>] [--record-file <file>] [--samples-json <file>] [--replay-real-samples]
//       [--json] [--help]

import fs from "node:fs";
import path from "node:path";
import { isDirectEntry } from "./gate-script-base.ts";
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
      if (!seen.has(key)) seen.set(key, { taskId, runId, ts: e.ts ?? "" });
    } catch {
      /* skip unparseable lines */
    }
  }
  return [...seen.values()];
}

// ── CLI ───────────────────────────────────────────────────────────────────────────────────────────────
function getArgValue(args, name) {
  const idx = args.indexOf(name);
  return idx === -1 ? undefined : args[idx + 1];
}

const usage = `per-task-suite-record-check.ts — AC72 判据2/判据3 + AC63 判据2 checker for the per-task
  suite record file (.quay/per-task-suite-records.jsonl in the SHARED checkout).
    判据2 shape — every existing record must carry taskId/runId/state/laneCount/durationMs/startedAt/
      finishedAt; a malformed or partial record ⇒ RED (硬规则 3b: 读不懂 ≠ 合格). AC63: a PRESENT
      doc-check trace (docChecked/docCheckExit) must also be well-formed.
    判据3 replay — given a set of expected per-task suite runs (taskId+runId), every one must have a
      record; a missing record ⇒ RED. The AC57 7 real cert rounds are the real absence samples.
    AC63 判据2 has-ff-but-no-doc-check — given the real fan-in ffs (lock-events acquire events), every
      ff'd task must have ≥1 per-task-suite record with docChecked === true; otherwise RED. The 11
      real lock-event ffs are the real absence samples (no doc-check trace exists).

Usage:
  node --experimental-strip-types plugin/scripts/per-task-suite-record-check.ts
      [--root <dir>] [--record-file <file>] [--samples-json <file>]
      [--lock-events <file>] [--replay-real-samples] [--json] [--help]

  --root               repo root (default: cwd) — resolves the shared checkout via git common-dir
  --record-file        override the record path (default <shared>/.quay/per-task-suite-records.jsonl)
  --samples-json       a JSON file: array of {taskId, runId, startedAt?} — replay them (判据3)
  --lock-events        a fan-in-merge-lock-events.jsonl — its acquire events are the real ffs (AC63
                       判据2: every ff'd task must have a doc-checked record ⇒ RED on the live ffs)
  --replay-real-samples  replay the embedded REAL_AC57_CERT_ROUNDS (判据3) AND REAL_FF_NO_DOC_CHECK
                       (AC63 判据2) — the real absence samples; the answer is no ⇒ RED
  --json               machine-readable output {ok, evaluated, reason, checks}
  --help               this help

Exit codes:
  0  PASS or NOT-EVALUATED (read \`evaluated\` — false = could not judge, never conflated with green)
  1  RED — a malformed record / an expected per-task suite run with no record / an ff with no
     doc-check trace (判据2 / 判据3 / AC63 判据2)
  2  usage / environment error`;

export function main(argv) {
  const args = argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) {
    process.stdout.write(usage + "\n");
    return 0;
  }
  const root = path.resolve(getArgValue(args, "--root") ?? process.cwd());
  const recordFileOverride = getArgValue(args, "--record-file");
  const samplesJson = getArgValue(args, "--samples-json");
  const lockEventsFile = getArgValue(args, "--lock-events");
  const replayReal = args.includes("--replay-real-samples");
  const asJson = args.includes("--json");

  let recordFile = recordFileOverride;
  if (!recordFile) {
    const shared = resolveSharedCheckout(root);
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
  return ok ? 0 : 1;
}

if (isDirectEntry(import.meta, undefined, "per-task-suite-record-check")) {
  process.exitCode = main(process.argv);
}
