// @test-group governance
// cap-counts-subagents-check.test.mjs — AC76 in-flight = CONCURRENT SUBAGENTS checker tests
// (tasks/gap-ac76-cap-counts-subagents-not-worktrees, 人 2026-08-14 07:3xZ/09:1xZ 裁定).
// plugin/scripts/cap-counts-subagents-check.ts.
//
// Pins:
//   判据1 — slot-refill.ts 正本点名 被计量对象=并发 subagent + 禁 worktree 代理 (the REAL committed
//           canonical comment must be GREEN; a comment that only mentions worktree with no measured-
//           object naming is RED).
//   判据2 — 第三方读法 = <session>/subagents/agent-*.jsonl 近 N 分钟写入数 (AC67 判据2 已证可用);
//           temp session dir with agent-*.jsonl files → count only the recently-written ones.
//   判据3 — 能取假, 真样本 D2: the two REAL samples (07:2xZ worktree 4 · subagent 2 ⇒ 高估 2;
//           07:4xZ worktree 1 · subagent 2 ⇒ 低估 1) MUST each replay RED; an equal pair is GREEN.
//   判据4 — 报数带计法: a worktree count presented as THE in-flight count WITHOUT a subagent label
//           ⇒ RED; a line carrying the subagent label (even with a worktree count) ⇒ GREEN; the real
//           07:2xZ line (carries both labels) ⇒ GREEN.
//   判据5 — 09:1xZ 推广: EVERY C24 in-flight derivation (C24-1..7) has a landing — C24-1/2/3 carry the
//           RETIRED (AC76 C24-N …) explicit annotation (the REAL committed files must be GREEN; a
//           stripped copy ⇒ RED); C24-4/5/7 have explicit 已并入 dispositions; C24-6 外层独占 —
//           judgeC24Coverage replays the PRE-FIX table (only 1/2/3) RED (能取假, 缺落点) and the real
//           table GREEN (判据3 coverage).
//   判据6 — /live 真样本: AC66/AC72/AC73 three DONE tasks claimed running by telemetry must replay
//           RED (done 与 ready 在遥测里不可区分); live claims matching non-done statuses ⇒ GREEN.
//   判据7 — NOT-EVALUATED (硬规则 3b) is reported distinctly, never folded into green: an absent
//           input yields evaluated:false, NOT ok:true-as-green.
//
// Run:
//   scripts/test.sh plugin/test/cap-counts-subagents-check.test.mjs
//   node --test plugin/test/cap-counts-subagents-check.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import {
  judgeSlotRefillCanonical,
  countActiveSubagentTranscripts,
  judgeWorktreeVsSubagent,
  judgeReportLine,
  judgeC24Retirement,
  judgeC24Coverage,
  judgeLiveVsTaskStatus,
  C24_RETIREMENT,
  C24_EXPECTED,
  LIVE_MISREPORT_FIXTURE,
} from "../scripts/cap-counts-subagents-check.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const CHECKER = path.join(REPO_ROOT, "plugin", "scripts", "cap-counts-subagents-check.ts");

// ── the REAL samples (2026-08-14, D2 不构造 — from the task body + live task store) ────────────────

const REAL_SAMPLE_07_2XZ = { worktree: 4, subagent: 2 }; // 高估 2
const REAL_SAMPLE_07_4XZ = { worktree: 1, subagent: 2 }; // 低估 1
const REAL_REPORT_LINE_07_2XZ = "07:2xZ worktree 4 · 活跃 subagent 回合 2";

// ── 判据1: canonical slot-refill.ts comment ─────────────────────────────────────────────────────────

test("判据1: the real committed slot-refill.ts canonical comment is GREEN (names 并发 subagent + forbids worktree proxy)", () => {
  const src = fs.readFileSync(path.join(REPO_ROOT, "plugin", "scripts", "slot-refill.ts"), "utf8");
  const v = judgeSlotRefillCanonical(src);
  assert.equal(v.evaluated, true, "must be evaluated against the real file");
  assert.equal(v.ok, true, `canonical comment must pass: ${v.reason}`);
  assert.equal(v.namesMeasured, true, "must name the measured object (并发 subagent)");
  assert.equal(v.forbidsWorktree, true, "must forbid the worktree proxy");
});

test("判据1: a comment that only discusses worktree with NO measured-object naming is RED", () => {
  const fake = "// worktree count is a useful proxy for activity. git worktree list | grep -c tells us how many are busy.";
  const v = judgeSlotRefillCanonical(fake);
  assert.equal(v.evaluated, true);
  assert.equal(v.ok, false, `must be RED when the measured object is not named: ${v.reason}`);
  assert.equal(v.namesMeasured, false);
});

test("判据1: absent source is NOT-EVALUATED, never green", () => {
  const v = judgeSlotRefillCanonical(null);
  assert.equal(v.evaluated, false, "no source ⇒ cannot judge");
  assert.equal(v.ok, true, "NOT-EVALUATED is reported as ok (exit 0) but evaluated:false — 硬规则 3b");
});

// ── 判据2: third-party subagent-transcript read ──────────────────────────────────────────────────────

test("判据2: counts <session>/subagents/agent-*.jsonl written in the last N minutes only", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cap-counts-session-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const sub = path.join(dir, "subagents");
  fs.mkdirSync(sub, { recursive: true });
  // a recently-written transcript (now) and a stale one (2h ago)
  fs.writeFileSync(path.join(sub, "agent-fresh.jsonl"), "{}");
  const stale = path.join(sub, "agent-stale.jsonl");
  fs.writeFileSync(stale, "{}");
  const staleTime = new Date(Date.now() - 2 * 60 * 60 * 1000);
  fs.utimesSync(stale, staleTime, staleTime);
  // a non-transcript file that must be excluded
  fs.writeFileSync(path.join(sub, "agent-fresh.meta.json"), "{}");

  const v = countActiveSubagentTranscripts(dir, 5);
  assert.equal(v.dirPresent, true);
  assert.equal(v.count, 1, `only the fresh agent-*.jsonl counts: ${JSON.stringify(v.files)}`);
  assert.deepEqual(v.files, ["agent-fresh.jsonl"]);
});

test("判据2: absent subagents dir is dirPresent:false (NOT a count of 0)", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cap-counts-nosub-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const v = countActiveSubagentTranscripts(dir, 5);
  assert.equal(v.dirPresent, false);
  assert.equal(v.count, 0);
});

// ── 判据3: worktree vs subagent mismatch (real-sample replay) ───────────────────────────────────────

test("判据3: REAL sample 07:2xZ (worktree 4 · subagent 2, 高估 2) replays RED", () => {
  const v = judgeWorktreeVsSubagent(REAL_SAMPLE_07_2XZ.worktree, REAL_SAMPLE_07_2XZ.subagent);
  assert.equal(v.evaluated, true);
  assert.equal(v.ok, false, `must replay RED: ${v.reason}`);
  assert.match(v.reason, /worktree-proxy-mismatch/);
});

test("判据3: REAL sample 07:4xZ (worktree 1 · subagent 2, 低估 1) replays RED", () => {
  const v = judgeWorktreeVsSubagent(REAL_SAMPLE_07_4XZ.worktree, REAL_SAMPLE_07_4XZ.subagent);
  assert.equal(v.evaluated, true);
  assert.equal(v.ok, false, `must replay RED: ${v.reason}`);
  assert.match(v.reason, /worktree-proxy-mismatch/);
});

test("判据3: an equal pair is GREEN (no mismatch this sample)", () => {
  const v = judgeWorktreeVsSubagent(2, 2);
  assert.equal(v.evaluated, true);
  assert.equal(v.ok, true, v.reason);
});

test("判据3: missing counts is NOT-EVALUATED", () => {
  const v = judgeWorktreeVsSubagent(null, undefined);
  assert.equal(v.evaluated, false);
});

// ── 判据4: report-with-method line judge ─────────────────────────────────────────────────────────────

test("判据4: REAL 07:2xZ line (carries BOTH labels) is GREEN — the labels are present, the USAGE is 判据3's job", () => {
  const v = judgeReportLine(REAL_REPORT_LINE_07_2XZ);
  assert.equal(v.evaluated, true);
  assert.equal(v.ok, true, `must carry the subagent label: ${v.reason}`);
  assert.equal(v.hasSubagentLabel, true);
});

test("判据4: negative control — a worktree count presented as THE in-flight count WITHOUT a subagent label is RED", () => {
  const v = judgeReportLine("在飞=worktree 4");
  assert.equal(v.evaluated, true);
  assert.equal(v.ok, false, `must be RED: ${v.reason}`);
  assert.equal(v.hasSubagentLabel, false);
});

test("判据4: a line with no in-flight count report is NOT-EVALUATED", () => {
  const v = judgeReportLine("本 tick 无事发生");
  assert.equal(v.evaluated, false);
});

// ── 判据5: C24 in-flight derivations retired to explicit annotation ─────────────────────────────────

test("判据5: the REAL committed C24 annotation files carry the RETIRED (AC76 C24-N) annotations", () => {
  const files = C24_RETIREMENT.filter((c) => c.disposition === "annotation").map((c) => ({
    key: c.key,
    file: c.file,
    text: fs.readFileSync(path.join(REPO_ROOT, c.file), "utf8"),
  }));
  const v = judgeC24Retirement(files);
  assert.equal(v.evaluated, true);
  assert.equal(v.ok, true, `all C24 annotation files must be annotated: ${v.reason}`);
  assert.deepEqual(v.violations, []);
});

test("判据5: a C24 annotation file stripped of its RETIRED annotation is RED", () => {
  const files = C24_RETIREMENT.filter((c) => c.disposition === "annotation").map((c) => ({
    key: c.key,
    file: c.file,
    text: c.key === "slot-refill"
      ? fs.readFileSync(path.join(REPO_ROOT, c.file), "utf8").replace(/RETIRED \(AC76 C24-2[^\n]*/g, "RETIRED-REMOVED")
      : fs.readFileSync(path.join(REPO_ROOT, c.file), "utf8"),
  }));
  const v = judgeC24Retirement(files);
  assert.equal(v.evaluated, true);
  assert.equal(v.ok, false, `must be RED when an annotation is missing: ${v.reason}`);
});

test("判据5: no C24 annotation file present is NOT-EVALUATED", () => {
  const v = judgeC24Retirement([{ key: "slot-refill", file: "x", text: null }]);
  assert.equal(v.evaluated, false);
});

// ── 判据5 coverage: EVERY C24 item has a landing (判据2 能取假 / 判据3) ──────────────────────────────

test("判据5: judgeC24Coverage — the PRE-FIX table (only C24-1/2/3, no 4/5/7) replays RED (能取假)", () => {
  const preFix = C24_RETIREMENT.filter((c) => c.disposition === "annotation"); // the AC76 落盘态
  const v = judgeC24Coverage(preFix);
  assert.equal(v.evaluated, true);
  assert.equal(v.ok, false, `must be RED when C24-4/5/7 landings are missing: ${v.reason}`);
  assert.match(v.reason, /C24-4/);
  assert.match(v.reason, /C24-5/);
  assert.match(v.reason, /C24-7/);
});

test("判据5: judgeC24Coverage — the REAL fixed table covers C24-1..7 with explicit landings (GREEN)", () => {
  const v = judgeC24Coverage(C24_RETIREMENT);
  assert.equal(v.evaluated, true);
  assert.equal(v.ok, true, `every C24 number must have a landing: ${v.reason}`);
  assert.deepEqual(v.missing, []);
  const ns = new Set(C24_RETIREMENT.map((c) => Number(c.n)));
  assert.deepEqual([...C24_EXPECTED].filter((n) => !ns.has(n)), [], "table must cover every expected C24 number");
});

test("判据5: judgeC24Coverage — a merged entry with an empty mergedInto is RED", () => {
  const broken = C24_RETIREMENT.map((c) => ({ ...c }));
  broken[broken.findIndex((c) => c.n === 4)].mergedInto = "";
  const v = judgeC24Coverage(broken);
  assert.equal(v.evaluated, true);
  assert.equal(v.ok, false, `must be RED when a merged landing is empty: ${v.reason}`);
  assert.match(v.reason, /C24-4/);
});

test("判据5: judgeC24Coverage — an unknown disposition is RED", () => {
  const broken = C24_RETIREMENT.map((c) => ({ ...c }));
  broken[broken.findIndex((c) => c.n === 7)].disposition = "bogus";
  const v = judgeC24Coverage(broken);
  assert.equal(v.evaluated, true);
  assert.equal(v.ok, false, `must be RED on an unknown disposition: ${v.reason}`);
  assert.match(v.reason, /unknown disposition/);
});

// ── 判据6: /live done-misreported-as-running replay ─────────────────────────────────────────────────

test("判据6: the REAL /live fixture — AC66/AC72/AC73 DONE claimed running — replays RED", () => {
  const statuses = {};
  for (const id of LIVE_MISREPORT_FIXTURE) statuses[id] = "done";
  const v = judgeLiveVsTaskStatus(LIVE_MISREPORT_FIXTURE, statuses);
  assert.equal(v.evaluated, true);
  assert.equal(v.ok, false, `must replay RED: ${v.reason}`);
  assert.deepEqual(v.misreported, LIVE_MISREPORT_FIXTURE);
});

test("判据6: live claims matching non-done statuses are GREEN", () => {
  const v = judgeLiveVsTaskStatus(["gap-ac76-cap-counts-subagents-not-worktrees"], {
    "gap-ac76-cap-counts-subagents-not-worktrees": "ready",
  });
  assert.equal(v.evaluated, true);
  assert.equal(v.ok, true, v.reason);
});

test("判据6: no live claims is NOT-EVALUATED", () => {
  const v = judgeLiveVsTaskStatus([], {});
  assert.equal(v.evaluated, false);
});

// ── CLI integration: exit codes ───────────────────────────────────────────────────────────────────────

function runChecker(args) {
  const res = spawnSync(process.execPath, ["--no-warnings", "--experimental-strip-types", CHECKER, ...args], {
    encoding: "utf8",
  });
  return res;
}

test("CLI: a clean run exits 0", () => {
  const res = runChecker(["--root", REPO_ROOT]);
  assert.equal(res.status, 0, `clean run must exit 0:\n${res.stdout}\n${res.stderr}`);
});

test("CLI: the REAL 07:2xZ replay (worktree 4 ≠ subagent 2) exits 1 (RED)", () => {
  const res = runChecker(["--root", REPO_ROOT, "--worktree-count", "4", "--subagent-count", "2"]);
  assert.equal(res.status, 1, `must exit 1 on the real mismatch:\n${res.stdout}`);
  assert.match(res.stdout, /worktree-proxy-mismatch/);
});

test("CLI: the REAL /live fixture (three done claimed running) exits 1 (RED)", () => {
  const res = runChecker(["--root", REPO_ROOT, "--live-running", LIVE_MISREPORT_FIXTURE.join(",")]);
  assert.equal(res.status, 1, `must exit 1 on the real /live misreport:\n${res.stdout}`);
  assert.match(res.stdout, /live-misreports-done-as-running/);
});

test("CLI: judge4 negative control (worktree-as-in-flight, no subagent label) exits 1 (RED)", () => {
  const res = runChecker(["--root", REPO_ROOT, "--report-line", "在飞=worktree 4"]);
  assert.equal(res.status, 1, `must exit 1 on the unlabeled worktree proxy:\n${res.stdout}`);
  assert.match(res.stdout, /worktree-presented-as-in-flight-without-subagent-label/);
});

test("CLI: --json output carries the 判据4 labeled method + 判据5/判据1 verdicts", () => {
  const res = runChecker(["--root", REPO_ROOT, "--json"]);
  assert.equal(res.status, 0);
  const out = JSON.parse(res.stdout);
  assert.equal(out.evaluated, true);
  const checks = new Map(out.checks.map((c) => [c.check, c]));
  assert.equal(checks.get("judge1-slot-refill-canonical").ok, true);
  assert.equal(checks.get("judge5-c24-retirement").ok, true);
  assert.equal(checks.get("judge5-c24-landing-coverage").ok, true);
});
