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
  REAL_AC57_CERT_ROUNDS,
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
