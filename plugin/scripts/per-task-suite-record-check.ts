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

// ── CLI ───────────────────────────────────────────────────────────────────────────────────────────────
function getArgValue(args, name) {
  const idx = args.indexOf(name);
  return idx === -1 ? undefined : args[idx + 1];
}

const usage = `per-task-suite-record-check.ts — AC72 判据2/判据3 checker for the per-task suite record
  file (.quay/per-task-suite-records.jsonl in the SHARED checkout).
    判据2 shape — every existing record must carry taskId/runId/state/laneCount/durationMs/startedAt/
      finishedAt; a malformed or partial record ⇒ RED (硬规则 3b: 读不懂 ≠ 合格).
    判据3 replay — given a set of expected per-task suite runs (taskId+runId), every one must have a
      record; a missing record ⇒ RED. The AC57 7 real cert rounds are the real absence samples.

Usage:
  node --experimental-strip-types plugin/scripts/per-task-suite-record-check.ts
      [--root <dir>] [--record-file <file>] [--samples-json <file>] [--replay-real-samples]
      [--json] [--help]

  --root               repo root (default: cwd) — resolves the shared checkout via git common-dir
  --record-file        override the record path (default <shared>/.quay/per-task-suite-records.jsonl)
  --samples-json       a JSON file: array of {taskId, runId, startedAt?} — replay them (判据3)
  --replay-real-samples  replay the embedded REAL_AC57_CERT_ROUNDS (the 7 real cert absence samples —
                       an explicit "did these ever get recorded?" audit; the answer is no ⇒ RED)
  --json               machine-readable output {ok, evaluated, reason, checks}
  --help               this help

Exit codes:
  0  PASS or NOT-EVALUATED (read \`evaluated\` — false = could not judge, never conflated with green)
  1  RED — a malformed record OR an expected per-task suite run with no record (判据2/判据3)
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
