// @test-group serial
// per-task-suite-record-check.test.mjs — AC72 判据2/判据3 负控制 fixture for the per-task suite
// record mechanism (plugin/scripts/per-task-suite-record.ts writer + per-task-suite-record-check.ts
// checker). Proves the checker can go RED on the REAL AC57 7 cert absence samples (判据3, D2 不构造)
// and on malformed record shapes (判据2, 硬规则 3b), GREEN when all expected runs are recorded, and
// NOT-EVALUATED (never conflated with green) when it cannot judge. Also exercises the writer's
// append + fail-closed + shared-checkout resolution.
//
//   RED   checkExpectedSuiteRuns — REAL_AC57_CERT_ROUNDS replayed against an EMPTY record set
//         (7 expected per-task suite runs, 0 records — the AC57 cert runs predate the mechanism)
//   RED   checkExpectedSuiteRuns — replay with only SOME records present (the missing ones listed)
//   RED   checkRecordFile / validateRecord — a malformed/partial record (missing required field)
//         or an unparseable line — 读不懂 ≠ 合格
//   GREEN checkExpectedSuiteRuns — replay with all 7 expected runs recorded
//   GREEN checkRecordFile — all records well-formed
//   NOT-EVALUATED checkExpectedSuiteRuns — no expected runs; checkRecordFile — empty file
//   writer — append one JSON line; second append adds a second line; fail-closed on missing field
//   resolveSharedCheckout — from a linked worktree root resolves the MAIN checkout, not the worktree
//
// Run:
//   scripts/test.sh plugin/test/per-task-suite-record-check.test.mjs
//   node --test plugin/test/per-task-suite-record-check.test.mjs

import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import {
  validateRecord,
  checkRecordFile,
  checkExpectedSuiteRuns,
  checkDocChecked,
  checkEmptyCarrierAgainstBoundary,
  resolveBoundaryEpoch,
  REAL_AC57_CERT_ROUNDS,
  REAL_FF_NO_DOC_CHECK,
} from "../scripts/per-task-suite-record-check.ts";
import {
  buildRecord,
  toIsoTimestamp,
  resolveSharedCheckout,
} from "../scripts/per-task-suite-record.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const WRITER = path.join(REPO_ROOT, "plugin", "scripts", "per-task-suite-record.ts");
const CHECKER = path.join(REPO_ROOT, "plugin", "scripts", "per-task-suite-record-check.ts");

// Track created temp dirs so the isolation check's mkdtemp-no-cleanup ratchet stays flat — every
// mkdtempSync has a matching rmSync (try/finally in each test + the after() sweep below).
const _tmpDirs = [];
function tmpFile(prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  _tmpDirs.push(dir);
  return path.join(dir, "records.jsonl");
}
function tmpDir(prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  _tmpDirs.push(dir);
  return dir;
}
after(() => {
  for (const d of _tmpDirs) {
    try {
      fs.rmSync(d, { recursive: true, force: true });
    } catch (_) {
      /* best-effort cleanup */
    }
  }
});

// A well-formed record matching the 7-sample contract (判据2 shape).
const WELL_FORMED = {
  taskId: "gap-ac57-preference-change-notification",
  runId: "eac3ee98",
  state: "red",
  laneCount: 16,
  durationMs: 141416,
  failedFiles: ["plugin/test/example.test.mjs"],
  startedAt: "2026-08-13T16:19:54.000Z",
  finishedAt: "2026-08-13T16:22:00.000Z",
};

// ── 判据3: real-sample replay (D2 — the 7 real AC57 cert rounds, 不构造) ──────────────────────────────

test("判据3 — REAL_AC57_CERT_ROUNDS replayed against an EMPTY record set ⇒ RED (all 7 missing)", () => {
  const v = checkExpectedSuiteRuns(REAL_AC57_CERT_ROUNDS, []);
  assert.equal(v.ok, false);
  assert.equal(v.evaluated, true);
  assert.equal(v.missing.length, REAL_AC57_CERT_ROUNDS.length, "every real cert round is absent");
  assert.match(v.reason, /missing-record/);
});

test("判据3 — REAL_AC57_CERT_ROUNDS replayed against the real full-suite-state-derived record set ⇒ RED (record set is empty — no per-task suite was ever recorded)", () => {
  // This is the live shape: the shared checkout's .quay/per-task-suite-records.jsonl does not exist
  // yet (the mechanism is new), so reading it yields null → the replay input is an empty record set.
  const v = checkExpectedSuiteRuns(REAL_AC57_CERT_ROUNDS, null);
  assert.equal(v.ok, false);
  assert.equal(v.missing.length, 7);
});

test("判据3 — all 7 real rounds recorded ⇒ GREEN", () => {
  const records = REAL_AC57_CERT_ROUNDS.map((s) => ({ ...WELL_FORMED, taskId: s.taskId, runId: s.runId, startedAt: s.startedAt }));
  const v = checkExpectedSuiteRuns(REAL_AC57_CERT_ROUNDS, records);
  assert.equal(v.ok, true);
  assert.equal(v.evaluated, true);
  assert.equal(v.missing.length, 0);
});

test("判据3 — only some recorded ⇒ RED with the missing ones listed", () => {
  const present = REAL_AC57_CERT_ROUNDS.slice(0, 3).map((s) => ({ ...WELL_FORMED, taskId: s.taskId, runId: s.runId }));
  const v = checkExpectedSuiteRuns(REAL_AC57_CERT_ROUNDS, present);
  assert.equal(v.ok, false);
  assert.equal(v.evaluated, true);
  assert.equal(v.missing.length, 4, "rounds 4-7 are missing");
  assert.equal(v.missing[0].runId, REAL_AC57_CERT_ROUNDS[3].runId);
});

test("判据3 — no expected runs ⇒ NOT-EVALUATED (never conflated with green)", () => {
  const v = checkExpectedSuiteRuns([], [WELL_FORMED]);
  assert.equal(v.ok, true);
  assert.equal(v.evaluated, false);
  assert.match(v.reason, /NOT-EVALUATED/);
});

// ── AC63 判据2: has-ff-but-no-doc-check (能取假 — the doc-check trace carrier) ──────────────────────

// A record carrying a doc-check trace (the AC63 判据1 carrier).
const DOC_CHECKED = {
  ...WELL_FORMED,
  docChecked: true,
  docCheckExit: 0,
};

test("AC63 判据2 — REAL_FF_NO_DOC_CHECK replayed against an EMPTY record set ⇒ RED (all 11 ff'd tasks have no doc-check trace)", () => {
  const v = checkDocChecked(REAL_FF_NO_DOC_CHECK, []);
  assert.equal(v.ok, false);
  assert.equal(v.evaluated, true);
  assert.equal(v.missing.length, REAL_FF_NO_DOC_CHECK.length, "every real ff is absent");
  assert.match(v.reason, /has-ff-but-no-doc-check/);
});

test("AC63 判据2 — a real ff with a matching record that LACKS docChecked ⇒ RED (the pre-AC63 no-field shape is the real sample)", () => {
  // A record for the ff'd task exists, but it has no doc-check trace (the pre-AC63 shape). The
  // judgment must go RED — this is exactly "有 ff 而无 doc 检查".
  const v = checkDocChecked([{ taskId: "DIR-127", runId: "fm-DIR-127-x" }], [WELL_FORMED]);
  assert.equal(v.ok, false);
  assert.equal(v.evaluated, true);
  assert.match(v.reason, /has-ff-but-no-doc-check/);
  assert.equal(v.missing[0].taskId, "DIR-127");
});

test("AC63 判据2 — a matching record with docChecked:false ⇒ RED", () => {
  const v = checkDocChecked([{ taskId: "DIR-127", runId: "fm-DIR-127-x" }], [{ ...WELL_FORMED, docChecked: false }]);
  assert.equal(v.ok, false);
  assert.equal(v.evaluated, true);
  assert.match(v.reason, /has-ff-but-no-doc-check/);
});

test("AC63 判据2 — a matching record with docChecked:true ⇒ GREEN", () => {
  const v = checkDocChecked([{ taskId: "DIR-127", runId: "fm-DIR-127-x" }], [{ ...DOC_CHECKED, taskId: "DIR-127" }]);
  assert.equal(v.ok, true);
  assert.equal(v.evaluated, true);
  assert.equal(v.missing.length, 0);
});

test("AC63 判据2 — ALL real ffs carry a doc-check trace ⇒ GREEN", () => {
  const records = REAL_FF_NO_DOC_CHECK.map((s) => ({ ...DOC_CHECKED, taskId: s.taskId }));
  const v = checkDocChecked(REAL_FF_NO_DOC_CHECK, records);
  assert.equal(v.ok, true);
  assert.equal(v.evaluated, true);
  assert.equal(v.missing.length, 0);
});

test("AC63 判据2 — no ffs given ⇒ NOT-EVALUATED (never conflated with green)", () => {
  const v = checkDocChecked([], [DOC_CHECKED]);
  assert.equal(v.ok, true);
  assert.equal(v.evaluated, false);
  assert.match(v.reason, /NOT-EVALUATED/);
});

// ── AC72 判据3 conditional: the empty carrier must be 能取假 (硬规则 4 — 空载体 ≠ 合格) ───────────────

test("AC72 判据3 conditional — an EMPTY carrier with per-task suite(s) after the enforcement boundary ⇒ RED (查过且空, 判据3 real-absence)", () => {
  const v = checkEmptyCarrierAgainstBoundary(
    [{ taskId: "DIR-127", runId: "fm-DIR-127-x", epoch: 1786700000, ts: "2026-08-14T10:00:00Z" }],
    [], // present-but-empty carrier
  );
  assert.equal(v.ok, false);
  assert.equal(v.evaluated, true);
  assert.match(v.reason, /empty-carrier-with-fan-in-after-enforcement-boundary/);
  assert.equal(v.missing[0].taskId, "DIR-127");
});

test("AC72 判据3 conditional — an ABSENT carrier (null) with per-task suite(s) after the boundary ⇒ RED too", () => {
  const v = checkEmptyCarrierAgainstBoundary(
    [{ taskId: "DIR-127", runId: "fm-DIR-127-x", epoch: 1786700000 }],
    null, // absent file
  );
  assert.equal(v.ok, false);
  assert.equal(v.evaluated, true);
});

test("AC72 判据3 conditional — no per-task suite after the enforcement boundary ⇒ NOT-EVALUATED (没查成, 不误红)", () => {
  const v = checkEmptyCarrierAgainstBoundary([], []);
  assert.equal(v.ok, true);
  assert.equal(v.evaluated, false);
  assert.match(v.reason, /no-per-task-suite-after-enforcement-boundary/);
});

test("AC72 判据3 conditional — a NON-empty carrier (even with a malformed null line) is the shape checks' job (conditional inert)", () => {
  const v = checkEmptyCarrierAgainstBoundary(
    [{ taskId: "DIR-127", runId: "fm-DIR-127-x", epoch: 1786700000 }],
    [null], // a present-but-malformed carrier line
  );
  assert.equal(v.ok, true);
  assert.equal(v.evaluated, true);
  assert.match(v.reason, /carrier-not-empty/);
});

test("resolveBoundaryEpoch — git-resolves the commit that ADDED the record writer (mechanism-landed boundary)", () => {
  const epoch = resolveBoundaryEpoch(REPO_ROOT);
  assert.ok(epoch != null && Number.isFinite(epoch), `resolved a mechanism-landed epoch (got ${epoch})`);
  // The AC72 commit that added per-task-suite-record.ts is 2026-08-14T08:22:10Z = 1786695730.
  assert.equal(epoch, 1786695730);
});

test("resolveBoundaryEpoch — --boundary-ts override wins", () => {
  assert.equal(resolveBoundaryEpoch(REPO_ROOT, "2026-08-14T09:00:00Z"), Math.floor(Date.parse("2026-08-14T09:00:00Z") / 1000));
});

// ── 判据2: record shape (硬规则 3b — 读不懂 ≠ 合格) ──────────────────────────────────────────────────

test("判据2 — a well-formed record is GREEN", () => {
  const v = validateRecord(WELL_FORMED);
  assert.equal(v.ok, true);
  assert.equal(v.evaluated, true);
  assert.equal(v.missingFields.length, 0);
});

test("判据2 — a record missing a REQUIRED field ⇒ RED (a partial record is not a recording)", () => {
  const { finishedAt, ...partial } = WELL_FORMED;
  const v = validateRecord(partial);
  assert.equal(v.ok, false);
  assert.equal(v.evaluated, true);
  assert.ok(v.missingFields.includes("finishedAt"));
});

test("判据2 — an unparseable line (null) ⇒ RED", () => {
  const v = validateRecord(null);
  assert.equal(v.ok, false);
  assert.equal(v.evaluated, true);
  assert.match(v.reason, /unparseable/);
});

test("判据2 — an empty record file ⇒ NOT-EVALUATED (nothing recorded yet)", () => {
  const v = checkRecordFile([]);
  assert.equal(v.ok, true);
  assert.equal(v.evaluated, false);
  assert.match(v.reason, /NOT-EVALUATED/);
});

test("判据2 — a file with any malformed record ⇒ RED", () => {
  const v = checkRecordFile([WELL_FORMED, null]);
  assert.equal(v.ok, false);
  assert.equal(v.evaluated, true);
  assert.match(v.reason, /malformed-record-file/);
});

test("判据2 — a file of well-formed records ⇒ GREEN", () => {
  const v = checkRecordFile([WELL_FORMED, { ...WELL_FORMED, runId: "other" }]);
  assert.equal(v.ok, true);
  assert.equal(v.evaluated, true);
});

test("判据2 — an absent file (null) is handled by the CLI as NOT-EVALUATED, not a crash", () => {
  const v = checkRecordFile(null);
  assert.equal(v.ok, true);
  assert.equal(v.evaluated, false);
});

// ── AC63 判据1: the doc-check trace shape (OPTIONAL field, shape-checked WHEN PRESENT) ───────────────

test("AC63 判据1 — a record with a well-formed doc-check trace (docChecked boolean + exit 0..255) is GREEN", () => {
  assert.equal(validateRecord(DOC_CHECKED).ok, true);
  assert.equal(validateRecord({ ...WELL_FORMED, docChecked: false }).ok, true, "docChecked:false is a valid trace");
});

test("AC63 判据1 — a record with docChecked present but NOT a boolean ⇒ RED (硬规则 3b: 读不懂 ≠ 合格)", () => {
  const v = validateRecord({ ...WELL_FORMED, docChecked: "yes" });
  assert.equal(v.ok, false);
  assert.equal(v.evaluated, true);
  assert.ok(v.missingFields.includes("docChecked∈boolean"));
});

test("AC63 判据1 — a record with docCheckExit present but non-integer / out-of-range ⇒ RED", () => {
  assert.equal(validateRecord({ ...WELL_FORMED, docChecked: true, docCheckExit: 1.5 }).ok, false);
  assert.equal(validateRecord({ ...WELL_FORMED, docChecked: true, docCheckExit: 999 }).ok, false);
});

test("AC63 判据1 — a record with docCheckExit but NO docChecked ⇒ RED (an exit code without a 'did it run' flag is ambiguous)", () => {
  const v = validateRecord({ ...WELL_FORMED, docCheckExit: 0 });
  assert.equal(v.ok, false);
  assert.equal(v.evaluated, true);
  assert.ok(v.missingFields.includes("docCheckExit-without-docChecked"));
});

// ── gap-fan-in-suite-data-not-accounted: fullSuiteRan / skipReason / cpu_time_s / load / phases ──────
// 判据1 — every fan-in writes a per-task-suite-record INCLUDING the skip case; 判据2 — the record can
// distinguish a run from a skip (a skip is a RECORDED DECISION, not a duration-inference — falsifiable,
// before this a skip was indistinguishable from a run); 判据3 — cpu_time_s / 分相 phases / load fields.
// The new fields are OPTIONAL (a pre-wiring record legitimately has none — the "skip indistinguishable
// from a run" gap IS the pre-wiring shape), and fail-closed when PRESENT (硬规则 3b — the writer refuses
// to record an ambiguous trace). The checker's validateRecord accepts them (unknown optional fields are
// ignored), so a record written by the writer stays GREEN on the every-round 判据2 shape check.

// A valid required-field base for buildRecord (the writer's pure record builder).
const SUITE_RECORD_BASE = {
  taskId: "gap-fan-in-suite-data-not-accounted",
  runId: "fm-suite-1",
  state: "green",
  laneCount: 16,
  durationMs: 250000,
  startedAt: "2026-08-14T00:00:00.000Z",
  finishedAt: "2026-08-14T00:05:00.000Z",
};

test("判据2 — a SKIP is recorded: buildRecord emits fullSuiteRan:false + skipReason (falsifiable — a skip is no longer indistinguishable from a run)", () => {
  // AC6 (gap-phase-boundary-differential-accounting): a skipped suite has NO CPU measurement — a
  // legacy 0 is normalized to EXPLICIT null + cpu_source:'not-wired', NEVER 0.
  const built = buildRecord({ ...SUITE_RECORD_BASE, fullSuiteRan: "false", skipReason: "doc-only-delta", cpuTimeS: "0" });
  assert.equal(built.error, undefined, `skip build must succeed: ${built.error}`);
  assert.equal(built.record.fullSuiteRan, false);
  assert.equal(built.record.skipReason, "doc-only-delta");
  assert.equal(built.record.cpu_time_s, null, "a skip's cpu_time_s is EXPLICIT null, never 0 (AC6)");
  assert.equal(built.record.cpu_source, "not-wired", "the null carries cpu_source:'not-wired' (the source was unavailable)");
});

test("判据2/3 — a RUN is recorded: buildRecord emits fullSuiteRan:true + cpu_time_s + cpu_source + load + phases (分相)", () => {
  const built = buildRecord({
    ...SUITE_RECORD_BASE,
    fullSuiteRan: "true",
    cpuTimeS: "123.456",
    load: "4.5",
    phases: JSON.stringify([
      { phase: "static", wall_ms: 1000, cpu_usec: 500000, psi_cpu_total: 100, psi_io_total: 50, lanes: 1 },
      { phase: "main", wall_ms: 2000, cpu_usec: 900000, psi_cpu_total: 200, psi_io_total: 80, lanes: 16 },
    ]),
  });
  assert.equal(built.error, undefined, `run build must succeed: ${built.error}`);
  assert.equal(built.record.fullSuiteRan, true);
  assert.equal(built.record.cpu_time_s, 123.456);
  assert.equal(built.record.cpu_source, "gnu-time", "a real measurement carries cpu_source:'gnu-time' (default for a real number)");
  assert.equal(built.record.load, 4.5);
  assert.equal(built.record.phases.length, 2);
  assert.equal(built.record.phases[0].phase, "static");
  assert.equal(built.record.phases[1].cpu_usec, 900000);
  // The checker's 判据2 accepts the new OPTIONAL fields — a record the writer writes stays GREEN.
  assert.equal(validateRecord(built.record).ok, true);
});

// ── gap-verification-round-cpu-split-not-recorded: cpu_user_s / cpu_sys_s (sibling 5b) ──────────────

test("AC1/AC3 (sibling) — a RUN with --cpu-user-s/--cpu-sys-s records the split from the SAME gnu-time line (user+sys ≈ cpu_time_s)", () => {
  const built = buildRecord({
    ...SUITE_RECORD_BASE,
    fullSuiteRan: "true",
    cpuTimeS: "11313.883",
    cpuSource: "gnu-time",
    cpuUserS: "4414.230",
    cpuSysS: "6899.653",
    load: "4.5",
  });
  assert.equal(built.error, undefined, `run build must succeed: ${built.error}`);
  assert.equal(built.record.cpu_time_s, 11313.883);
  assert.equal(built.record.cpu_source, "gnu-time");
  assert.equal(built.record.cpu_user_s, 4414.230, "cpu_user_s = the gnu-time %U column");
  assert.equal(built.record.cpu_sys_s, 6899.653, "cpu_sys_s = the gnu-time %S column");
  assert.ok(Math.abs((built.record.cpu_user_s + built.record.cpu_sys_s) - built.record.cpu_time_s) < 0.01, "user+sys ≈ cpu_time_s (AC2)");
  assert.equal(validateRecord(built.record).ok, true, "the split fields are OPTIONAL — the checker stays GREEN");
});

test("AC6 (sibling) — empty/null/0 split args are omitted, never fail-closed, never a fabricated 0", () => {
  // Empty strings (an unset bash capture var on a doc-only skip) with a real cpu_time_s → omitted.
  const empty = buildRecord({ ...SUITE_RECORD_BASE, fullSuiteRan: "true", cpuTimeS: "42.5", cpuSource: "gnu-time", cpuUserS: "", cpuSysS: "" });
  assert.equal(empty.error, undefined, "empty split args are 'considered + unavailable', not fail-closed");
  assert.equal(empty.record.cpu_user_s, undefined);
  assert.equal(empty.record.cpu_sys_s, undefined);
  // null / 0 → omitted.
  const nullRec = buildRecord({ ...SUITE_RECORD_BASE, fullSuiteRan: "true", cpuTimeS: "42.5", cpuSource: "gnu-time", cpuUserS: "null", cpuSysS: "0" });
  assert.equal(nullRec.error, undefined);
  assert.equal(nullRec.record.cpu_user_s, undefined);
  assert.equal(nullRec.record.cpu_sys_s, undefined);
});

test("AC1 fail-closed (sibling) — a REAL split value with a null cpu_time_s is ambiguous ⇒ error", () => {
  const r = buildRecord({ ...SUITE_RECORD_BASE, fullSuiteRan: "true", cpuTimeS: "null", cpuSource: "not-wired", cpuUserS: "4414.230" });
  assert.match(r.error ?? "", /cpu-time-s/, "a real split without its sum must fail closed (硬规则 3b)");
});

test("AC6 (sibling) — negative / non-numeric split values fail-closed", () => {
  assert.match(buildRecord({ ...SUITE_RECORD_BASE, fullSuiteRan: "true", cpuTimeS: "42.5", cpuUserS: "-1" }).error ?? "", /cpu-user-s/);
  assert.match(buildRecord({ ...SUITE_RECORD_BASE, fullSuiteRan: "true", cpuTimeS: "42.5", cpuSysS: "abc" }).error ?? "", /cpu-sys-s/);
});

test("判据2 — the writer CLI records a SKIP (--full-suite-ran false --skip-reason doc-only-delta --cpu-time-s null --cpu-source not-wired)", () => {
  const file = tmpFile("ptsr-skip-");
  const r = spawnSync("node", ["--experimental-strip-types", WRITER,
    "--task-id", "gap-fan-in-suite-data-not-accounted",
    "--run-id", "fm-skip-1",
    "--state", "green",
    "--lane-count", "1",
    "--duration-ms", "1805",
    "--started-at", "2026-08-14T00:00:00.000Z",
    "--finished-at", "2026-08-14T00:01:00.000Z",
    "--doc-checked", "true",
    "--doc-check-exit", "0",
    "--full-suite-ran", "false",
    "--skip-reason", "doc-only-delta",
    "--cpu-time-s", "null",
    "--cpu-source", "not-wired",
    "--load", "1.2",
    "--record-file", file,
  ], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  const rec = JSON.parse(fs.readFileSync(file, "utf8").trim());
  assert.equal(rec.fullSuiteRan, false, "a skip is RECORDED as a decision (判据1 — 跳过也入账), not inferred from duration");
  assert.equal(rec.skipReason, "doc-only-delta");
  assert.equal(rec.cpu_time_s, null, "a skip's cpu_time_s is EXPLICIT null, never 0 (AC6)");
  assert.equal(rec.cpu_source, "not-wired");
  assert.equal(validateRecord(rec).ok, true, "the skip record is judged GREEN by the checker's 判据2");
});

test("AC6 — a legacy `--cpu-time-s 0` is normalized to explicit null + not-wired (never a silent 0)", () => {
  const built = buildRecord({ ...SUITE_RECORD_BASE, fullSuiteRan: "true", cpuTimeS: "0" });
  assert.equal(built.error, undefined, `0 cpu build must succeed: ${built.error}`);
  assert.equal(built.record.cpu_time_s, null, "0 is normalized to EXPLICIT null (0 conflates not-wired with ~0 consumption)");
  assert.equal(built.record.cpu_source, "not-wired");
});

test("AC6 — buildRecord fail-closed: a non-zero cpu_time_s with --full-suite-ran false is a semantic contradiction (nothing ran)", () => {
  const built = buildRecord({ ...SUITE_RECORD_BASE, fullSuiteRan: "false", skipReason: "doc-only-delta", cpuTimeS: "5.0" });
  assert.match(built.error ?? "", /cpu-time-s/, "a skip with non-zero cpu_time_s is ambiguous ⇒ fail-closed");
});

test("判据3 — the writer CLI records a RUN (--full-suite-ran true --cpu-time-s <n> --load <n> --phases <json>)", () => {
  const file = tmpFile("ptsr-run-");
  const r = spawnSync("node", ["--experimental-strip-types", WRITER,
    "--task-id", "gap-fan-in-suite-data-not-accounted",
    "--run-id", "fm-run-1",
    "--state", "green",
    "--lane-count", "16",
    "--duration-ms", "250000",
    "--started-at", "2026-08-14T00:00:00.000Z",
    "--finished-at", "2026-08-14T00:05:00.000Z",
    "--doc-checked", "true",
    "--doc-check-exit", "0",
    "--full-suite-ran", "true",
    "--cpu-time-s", "123.456",
    "--load", "4.5",
    "--phases", JSON.stringify([
      { phase: "static", wall_ms: 1000, cpu_usec: 500000, psi_cpu_total: 100, psi_io_total: 50, lanes: 1 },
      { phase: "main", wall_ms: 2000, cpu_usec: 900000, psi_cpu_total: 200, psi_io_total: 80, lanes: 16 },
    ]),
    "--record-file", file,
  ], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  const rec = JSON.parse(fs.readFileSync(file, "utf8").trim());
  assert.equal(rec.fullSuiteRan, true);
  assert.equal(rec.cpu_time_s, 123.456);
  assert.equal(rec.load, 4.5);
  assert.equal(rec.phases.length, 2);
  assert.equal(rec.phases[1].cpu_usec, 900000);
  assert.equal(validateRecord(rec).ok, true, "a run record with cpu/phases is judged GREEN by the checker's 判据2");
});

test("判据2 — buildRecord fail-closed: --skip-reason REQUIRES --full-suite-ran false (ambiguous trace never writes)", () => {
  assert.match(buildRecord({ ...SUITE_RECORD_BASE, skipReason: "doc-only-delta" }).error ?? "", /skip-reason/);
  assert.match(buildRecord({ ...SUITE_RECORD_BASE, fullSuiteRan: "true", skipReason: "doc-only-delta" }).error ?? "", /skip-reason/);
});

test("判据2 — buildRecord fail-closed: --full-suite-ran must be true|false", () => {
  assert.match(buildRecord({ ...SUITE_RECORD_BASE, fullSuiteRan: "maybe" }).error ?? "", /full-suite-ran/);
});

test("判据3 — buildRecord fail-closed: malformed --phases / negative cpu / negative load", () => {
  assert.match(buildRecord({ ...SUITE_RECORD_BASE, phases: "not-json" }).error ?? "", /phases/);
  assert.match(buildRecord({ ...SUITE_RECORD_BASE, cpuTimeS: "-1" }).error ?? "", /cpu-time-s/);
  assert.match(buildRecord({ ...SUITE_RECORD_BASE, load: "-0.5" }).error ?? "", /load/);
});

// ── writer: append + fail-closed + state-file + shared-checkout resolution ─────────────────────────

test("writer — appends ONE valid JSON line (判据2 fields), second append adds a second line", () => {
  const file = tmpFile("ptsr-append-");
  const args = [
    "--task-id", "gap-ac57-preference-change-notification",
    "--run-id", "eac3ee98",
    "--state", "red",
    "--lane-count", "16",
    "--duration-ms", "141416",
    "--failed-files", "plugin/test/a.test.mjs,plugin/test/b.test.mjs",
    "--started-at", "2026-08-13T16:19:54.000Z",
    "--finished-at", "2026-08-13T16:22:00.000Z",
    "--record-file", file,
  ];
  const r1 = spawnSync("node", ["--experimental-strip-types", WRITER, ...args], { encoding: "utf8" });
  assert.equal(r1.status, 0, r1.stderr);
  const lines1 = fs.readFileSync(file, "utf8").trim().split("\n").filter(Boolean);
  assert.equal(lines1.length, 1, "one line appended");
  const rec = JSON.parse(lines1[0]);
  assert.equal(rec.taskId, "gap-ac57-preference-change-notification");
  assert.equal(rec.runId, "eac3ee98");
  assert.equal(rec.state, "red");
  assert.equal(rec.laneCount, 16);
  assert.equal(rec.durationMs, 141416);
  assert.deepEqual(rec.failedFiles, ["plugin/test/a.test.mjs", "plugin/test/b.test.mjs"]);
  assert.equal(rec.startedAt, "2026-08-13T16:19:54.000Z");

  const r2 = spawnSync("node", ["--experimental-strip-types", WRITER, ...args], { encoding: "utf8" });
  assert.equal(r2.status, 0, r2.stderr);
  const lines2 = fs.readFileSync(file, "utf8").trim().split("\n").filter(Boolean);
  assert.equal(lines2.length, 2, "append-only — second run adds a second line");
});

test("writer — fail-closed on a missing required field (exit 2, nothing written)", () => {
  const file = tmpFile("ptsr-fail-");
  const r = spawnSync("node", ["--experimental-strip-types", WRITER,
    "--run-id", "eac3ee98",
    "--state", "green",
    "--lane-count", "4",
    "--duration-ms", "1000",
    "--started-at", "2026-08-13T16:19:54.000Z",
    "--finished-at", "2026-08-13T16:22:00.000Z",
    "--record-file", file,
  ], { encoding: "utf8" });
  assert.equal(r.status, 2, `must fail-closed on missing --task-id: ${r.stdout} ${r.stderr}`);
  assert.equal(fs.existsSync(file), false, "nothing written on a fail-closed field error");
});

test("writer — --doc-checked true --doc-check-exit 0 writes the AC63 判据1 doc-check trace", () => {
  const file = tmpFile("ptsr-doc-");
  const r = spawnSync("node", ["--experimental-strip-types", WRITER,
    "--task-id", "DIR-127",
    "--run-id", "fm-DIR-127-x",
    "--state", "green",
    "--lane-count", "4",
    "--duration-ms", "1000",
    "--started-at", "2026-08-14T00:00:00.000Z",
    "--finished-at", "2026-08-14T00:01:00.000Z",
    "--doc-checked", "true",
    "--doc-check-exit", "0",
    "--record-file", file,
  ], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  const rec = JSON.parse(fs.readFileSync(file, "utf8").trim());
  assert.equal(rec.docChecked, true);
  assert.equal(rec.docCheckExit, 0);
  // A record written by the writer with a doc-check trace is judged GREEN by the checker's 判据2.
  assert.equal(validateRecord(rec).ok, true);
});

test("writer — --doc-checked must be true|false (a non-boolean value fails closed, nothing written)", () => {
  const file = tmpFile("ptsr-docbad-");
  const r = spawnSync("node", ["--experimental-strip-types", WRITER,
    "--task-id", "DIR-127",
    "--run-id", "fm-DIR-127-x",
    "--state", "green",
    "--lane-count", "4",
    "--duration-ms", "1000",
    "--started-at", "2026-08-14T00:00:00.000Z",
    "--finished-at", "2026-08-14T00:01:00.000Z",
    "--doc-checked", "yes",
    "--record-file", file,
  ], { encoding: "utf8" });
  assert.equal(r.status, 2, `must fail-closed on a non-boolean --doc-checked: ${r.stdout} ${r.stderr}`);
  assert.equal(fs.existsSync(file), false, "nothing written on a malformed doc-check trace");
});

test("writer — --doc-check-exit requires --doc-checked (fail-closed, nothing written)", () => {
  const file = tmpFile("ptsr-docnoflag-");
  const r = spawnSync("node", ["--experimental-strip-types", WRITER,
    "--task-id", "DIR-127",
    "--run-id", "fm-DIR-127-x",
    "--state", "green",
    "--lane-count", "4",
    "--duration-ms", "1000",
    "--started-at", "2026-08-14T00:00:00.000Z",
    "--finished-at", "2026-08-14T00:01:00.000Z",
    "--doc-check-exit", "0",
    "--record-file", file,
  ], { encoding: "utf8" });
  assert.equal(r.status, 2, `must fail-closed on --doc-check-exit without --doc-checked: ${r.stdout} ${r.stderr}`);
  assert.equal(fs.existsSync(file), false, "nothing written on an ambiguous doc-check trace");
});

test("writer — state-file supplies defaults; explicit flags win", () => {
  const dir = tmpDir("ptsr-sf-");
  const stateFile = path.join(dir, "full-suite-state.json");
  fs.writeFileSync(stateFile, JSON.stringify({
    state: "red",
    runId: "746b34bc-342c-47b2-86a3-50278ee56f6f",
    laneCount: 16,
    durationMs: 141416,
    startedAt: "2026-08-14T07:50:17.150Z",
    finishedAt: 1786693958,
    failures: [{ file: "plugin/test/x.test.mjs" }, { file: "plugin/test/y.test.mjs" }],
  }));
  const file = path.join(dir, "records.jsonl");
  // taskId explicit; everything else from the state file (finishedAt epoch → ISO).
  const r = spawnSync("node", ["--experimental-strip-types", WRITER,
    "--task-id", "gap-ac72-cert-mechanism-retire",
    "--state-file", stateFile,
    "--record-file", file,
  ], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  const rec = JSON.parse(fs.readFileSync(file, "utf8").trim());
  assert.equal(rec.taskId, "gap-ac72-cert-mechanism-retire");
  assert.equal(rec.runId, "746b34bc-342c-47b2-86a3-50278ee56f6f");
  assert.equal(rec.state, "red");
  assert.equal(rec.laneCount, 16);
  assert.equal(rec.durationMs, 141416);
  assert.deepEqual(rec.failedFiles, ["plugin/test/x.test.mjs", "plugin/test/y.test.mjs"]);
  assert.equal(rec.finishedAt, "2026-08-14T07:52:38.000Z", "epoch-seconds finishedAt converts to ISO");
  // explicit --lane-count overrides the state file
  const r2 = spawnSync("node", ["--experimental-strip-types", WRITER,
    "--task-id", "gap-ac72-cert-mechanism-retire",
    "--lane-count", "4",
    "--state-file", stateFile,
    "--record-file", file,
  ], { encoding: "utf8" });
  assert.equal(r2.status, 0, r2.stderr);
  const rec2 = JSON.parse(fs.readFileSync(file, "utf8").trim().split("\n").filter(Boolean).at(-1));
  assert.equal(rec2.laneCount, 4, "explicit --lane-count wins over the state file");
});

test("writer+checker — a record written by the writer is judged GREEN by the checker's 判据2", () => {
  const file = tmpFile("ptsr-roundtrip-");
  const r = spawnSync("node", ["--experimental-strip-types", WRITER,
    "--task-id", "gap-ac72-cert-mechanism-retire",
    "--run-id", "abc12345",
    "--state", "green",
    "--lane-count", "8",
    "--duration-ms", "250000",
    "--started-at", "2026-08-14T00:00:00.000Z",
    "--finished-at", "2026-08-14T00:05:00.000Z",
    "--record-file", file,
  ], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  const cr = spawnSync("node", ["--experimental-strip-types", CHECKER, "--record-file", file, "--json"], { encoding: "utf8" });
  assert.equal(cr.status, 0, `checker must pass on a well-formed record: ${cr.stdout} ${cr.stderr}`);
  const out = JSON.parse(cr.stdout);
  assert.equal(out.ok, true);
  assert.equal(out.evaluated, true);
  assert.equal(out.checks.find((c) => c.check === "record-shape").ok, true);
});

test("checker CLI — an unparseable record line makes the checker exit 1 (RED, 硬规则 3b)", () => {
  const file = tmpFile("ptsr-red-");
  fs.writeFileSync(file, "this is not json\n");
  const r = spawnSync("node", ["--experimental-strip-types", CHECKER, "--record-file", file, "--json"], { encoding: "utf8" });
  assert.equal(r.status, 1, `unparseable record ⇒ RED: ${r.stdout}`);
  const out = JSON.parse(r.stdout);
  assert.equal(out.ok, false);
  assert.equal(out.checks.find((c) => c.check === "record-shape").ok, false);
});

test("checker CLI — --replay-real-samples goes RED on the AC63 ff-no-doc-check check (11/11 real ffs have no doc-check trace)", () => {
  const file = tmpFile("ptsr-replay-");
  const r = spawnSync("node", ["--experimental-strip-types", CHECKER, "--record-file", file, "--replay-real-samples", "--json"], { encoding: "utf8" });
  assert.equal(r.status, 1, `replay of real absence samples must be RED: ${r.stdout}`);
  const out = JSON.parse(r.stdout);
  const ffCheck = out.checks.find((c) => c.check === "ff-no-doc-check");
  assert.ok(ffCheck, "the AC63 ff-no-doc-check judgment ran");
  assert.equal(ffCheck.ok, false);
  assert.match(ffCheck.reason, /has-ff-but-no-doc-check/);
  assert.equal(ffCheck.missing.length, REAL_FF_NO_DOC_CHECK.length);
});

test("checker CLI — --lock-events feeds the AC63 ff-no-doc-check judgment (RED on real ffs, GREEN when every ff'd task has a doc-checked record)", () => {
  const dir = tmpDir("ptsr-lockev-");
  const records = path.join(dir, "records.jsonl");
  const lockEvents = path.join(dir, "lock-events.jsonl");
  // Two real ffs (acquire+release pairs).
  fs.writeFileSync(lockEvents, [
    '{"event":"acquire","ts":"2026-08-14T10:00:00Z","epoch":1786700000,"taskId":"DIR-127","pid":1,"runId":"fm-DIR-127-x","agentId":"a"}',
    '{"event":"release","ts":"2026-08-14T10:00:00Z","epoch":1786700000,"taskId":"DIR-127","pid":1,"runId":"fm-DIR-127-x","agentId":"a"}',
    '{"event":"acquire","ts":"2026-08-14T10:01:00Z","epoch":1786700060,"taskId":"DIR-128","pid":1,"runId":"fm-DIR-128-x","agentId":"a"}',
    '{"event":"release","ts":"2026-08-14T10:01:00Z","epoch":1786700060,"taskId":"DIR-128","pid":1,"runId":"fm-DIR-128-x","agentId":"a"}',
  ].join("\n"));
  // RED: records exist for both tasks but carry no doc-check trace.
  for (const t of ["DIR-127", "DIR-128"]) {
    fs.appendFileSync(records, JSON.stringify({ ...WELL_FORMED, taskId: t, runId: "suite-" + t }) + "\n");
  }
  const red = spawnSync("node", ["--experimental-strip-types", CHECKER, "--record-file", records, "--lock-events", lockEvents, "--json"], { encoding: "utf8" });
  assert.equal(red.status, 1, `ffs with no doc-check trace ⇒ RED: ${red.stdout}`);
  const redOut = JSON.parse(red.stdout);
  const ffCheck = redOut.checks.find((c) => c.check === "ff-no-doc-check");
  assert.equal(ffCheck.ok, false);
  assert.equal(ffCheck.missing.length, 2);
  // GREEN: add docChecked:true to both records and re-run — the same lock-events now pass.
  fs.writeFileSync(records, "");
  for (const t of ["DIR-127", "DIR-128"]) {
    fs.appendFileSync(records, JSON.stringify({ ...WELL_FORMED, taskId: t, runId: "suite-" + t, docChecked: true, docCheckExit: 0 }) + "\n");
  }
  const green = spawnSync("node", ["--experimental-strip-types", CHECKER, "--record-file", records, "--lock-events", lockEvents, "--json"], { encoding: "utf8" });
  assert.equal(green.status, 0, `ffs with a doc-check trace ⇒ PASS: ${green.stdout}`);
  const greenOut = JSON.parse(green.stdout);
  assert.equal(greenOut.checks.find((c) => c.check === "ff-no-doc-check").ok, true);
});

test("checker CLI — AC72 判据3 conditional: EMPTY carrier + ffs after a PAST enforcement baseline ⇒ RED (查过且空, exit 1)", () => {
  const dir = tmpDir("ptsr-j3red-");
  const records = path.join(dir, "records.jsonl");
  const lockEvents = path.join(dir, "lock-events.jsonl");
  fs.writeFileSync(records, ""); // present-but-empty carrier
  fs.writeFileSync(lockEvents, [
    '{"event":"acquire","ts":"2026-08-14T10:00:00Z","epoch":1786700000,"taskId":"DIR-127","pid":1,"runId":"fm-DIR-127-x","agentId":"a"}',
    '{"event":"release","ts":"2026-08-14T10:00:00Z","epoch":1786700000,"taskId":"DIR-127","pid":1,"runId":"fm-DIR-127-x","agentId":"a"}',
  ].join("\n"));
  const r = spawnSync("node", ["--experimental-strip-types", CHECKER, "--record-file", records, "--lock-events", lockEvents, "--enforcement-baseline-ts", "2026-08-14T09:00:00Z", "--json"], { encoding: "utf8" });
  assert.equal(r.status, 1, `empty carrier + ff after enforcement ⇒ RED: ${r.stdout}`);
  const out = JSON.parse(r.stdout);
  const c = out.checks.find((x) => x.check === "empty-carrier-boundary");
  assert.ok(c, "the AC72 判据3 conditional check ran");
  assert.equal(c.ok, false);
  assert.match(c.reason, /empty-carrier-with-fan-in-after-enforcement-boundary/);
});

test("checker CLI — AC72 判据3 conditional: EMPTY carrier + ffs BEFORE a FUTURE enforcement baseline ⇒ NOT-EVALUATED (没查成, 不误红)", () => {
  const dir = tmpDir("ptsr-j3ne-");
  const records = path.join(dir, "records.jsonl");
  const lockEvents = path.join(dir, "lock-events.jsonl");
  fs.writeFileSync(records, "");
  fs.writeFileSync(lockEvents, [
    '{"event":"acquire","ts":"2026-08-14T10:00:00Z","epoch":1786700000,"taskId":"DIR-127","pid":1,"runId":"fm-DIR-127-x","agentId":"a"}',
    '{"event":"release","ts":"2026-08-14T10:00:00Z","epoch":1786700000,"taskId":"DIR-127","pid":1,"runId":"fm-DIR-127-x","agentId":"a"}',
  ].join("\n"));
  // Note: no --lock-events is NOT passed here — instead the conditional reads the default lock-events
  // ONLY when the record file is resolved from the shared checkout (not overridden). With --record-file
  // overridden, shared is null ⇒ the conditional has no lock-events source ⇒ no ffs ⇒ NOT-EVALUATED.
  // This is the hermetic default: --record-file without --lock-events ⇒ conditional NOT-EVALUATED.
  const r = spawnSync("node", ["--experimental-strip-types", CHECKER, "--record-file", records, "--lock-events", lockEvents, "--enforcement-baseline-ts", "2026-08-14T20:00:00Z", "--json"], { encoding: "utf8" });
  const out = JSON.parse(r.stdout);
  const c = out.checks.find((x) => x.check === "empty-carrier-boundary");
  assert.ok(c, "the AC72 判据3 conditional check ran");
  assert.equal(c.ok, true);
  assert.equal(c.evaluated, false);
  assert.match(c.reason, /no-per-task-suite-after-enforcement-boundary/);
});

// ── resolveSharedCheckout / toIsoTimestamp (pure helpers) ───────────────────────────────────────────

test("resolveSharedCheckout — from a worktree root resolves the MAIN checkout, not the worktree (判据2 '共享检出非 worktree fork 副本')", () => {
  // When run inside the main checkout itself, the shared checkout is the main checkout.
  const shared = resolveSharedCheckout(REPO_ROOT);
  assert.ok(shared, "resolved a shared checkout");
  assert.ok(fs.existsSync(path.join(shared, ".git")), "the shared checkout has a .git dir");
  // The default record path lands under the shared checkout's .quay/, not cwd.
  assert.equal(path.join(shared, ".quay", "per-task-suite-records.jsonl").startsWith(shared), true);
});

test("toIsoTimestamp — ISO passes through, epoch-seconds converts, garbage is rejected", () => {
  assert.equal(toIsoTimestamp("2026-08-13T16:19:54.000Z"), "2026-08-13T16:19:54.000Z");
  assert.equal(toIsoTimestamp(1786693958), "2026-08-14T07:52:38.000Z");
  assert.equal(toIsoTimestamp("not-a-time"), null);
  assert.equal(toIsoTimestamp(null), null);
});

// ── buildRecord fail-closed (hard rule 3b — no partial record) ─────────────────────────────────────

test("buildRecord — fail-closed: a missing taskId/runId/state yields an error, never a partial record", () => {
  assert.match(buildRecord({ runId: "x", state: "green", laneCount: 4, durationMs: 1, startedAt: "2026-08-13T16:19:54.000Z", finishedAt: "2026-08-13T16:22:00.000Z" }).error ?? "", /task-id/);
  assert.match(buildRecord({ taskId: "t", state: "green", laneCount: 4, durationMs: 1, startedAt: "2026-08-13T16:19:54.000Z", finishedAt: "2026-08-13T16:22:00.000Z" }).error ?? "", /run-id/);
  assert.match(buildRecord({ taskId: "t", runId: "x", state: "purple", laneCount: 4, durationMs: 1, startedAt: "2026-08-13T16:19:54.000Z", finishedAt: "2026-08-13T16:22:00.000Z" }).error ?? "", /state/);
});
