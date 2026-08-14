// @test-group engine
// fan-in-ff-executor-check.test.mjs — AC67 fan-in EXECUTOR checker (判据1/判据2/判据3 能取假),
// plugin/scripts/fan-in-ff-executor-check.ts. The negative-control fixtures prove the checker can
// go RED on the three main-thread-executor forms AC67 requires (判据), plus NOT-EVALUATED
// (never conflated with green, 硬规则 3b) when it cannot judge.
//
//   RED  judgeA6Line — the REAL current A6 subject "Fan-in 已返回任务" (captured verbatim from
//                      orchestration/fast-mode-tick-core.md:25 pre-AC67) and the REAL ① step
//                      "git -C <wt> merge $MERGE_TARGET" — the main-thread-executor signatures
//   RED  judgeFanInCommand — a REAL main-thread fan-in merge command from the inner session
//                      transcripts (the "近 6 小时 4 次" samples, SPEC §8) — 判据3 replay must red
//   RED  checkAgentId — a record with agentId null (fan-in-ff-merge.sh called WITHOUT --agent-id,
//                      the pre-AC67 main-thread caller) OR agentId == the main-session id
//   GREEN judgeA6Line — the NEW subagent-executor A6 form (subject changed, no `git -C <wt>`)
//   GREEN checkAgentId — records carrying a subagent id different from the main session
//   NOT-EVALUATED judgeA6Line — missing/empty line; checkAgentId — no records
//
// Run:
//   scripts/test.sh plugin/test/fan-in-ff-executor-check.test.mjs
//   node --test plugin/test/fan-in-ff-executor-check.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import {
  judgeA6Line,
  extractA6Line,
  checkAgentId,
  judgeFanInCommand,
  isMainThreadAgentId,
} from "../scripts/fan-in-ff-executor-check.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const CHECKER = path.join(REPO_ROOT, "plugin", "scripts", "fan-in-ff-executor-check.ts");

// ── REAL samples (D2 不构造 — captured verbatim, not fabricated) ──────────────────────────────────────
// The current (pre-AC67) A6 row in BOTH fast-mode-tick-core.md copies. The SUBJECT cell and the ①
// step are quoted verbatim from orchestration/fast-mode-tick-core.md:25.
const REAL_OLD_A6_SUBJECT =
  "Fan-in 已返回任务(**无锁段 + 持锁段,人 2026-08-14 裁定,SPEC-fan-in-ff-merge-lock**——取代旧「串行整段 + `git merge --no-ff`」(src:510,526);旧 rebase 冲突处理已随 ff-only 简化一个量级,ff 失败唯一原因=develop 前进了、处置唯一=回第 1 步 (src:515,523,534))";
const REAL_OLD_A6_STEP1 =
  "① `git -C <wt> merge $MERGE_TARGET`(冲突【只可能在这】出现,自由解,不占任何人;取代旧 rebase)";
// A REAL main-thread fan-in merge command from the inner session transcripts (2026-08-12 16:01Z,
// the pre-ff-only main-thread fan-in era — one of the "近 6 小时 4 次 merge" samples).
const REAL_MAIN_THREAD_MERGE_CMD =
  "git merge --no-ff task/gap-inner-blocked-signal-comment-refs-retired-inner-state-sh -m \"merge: fan-in gap-inner-blocked-signal-comment-refs-retired-inner-state-sh (A6) — comment 指向退役 inner-state.sh 的修法, scoped 37/0 绿\"";
// A REAL main-thread `git -C <worktree>` fan-in-adjacent command (2026-08-12 18:35Z — the main
// thread reached into a task worktree from OUTSIDE).
const REAL_GIT_CT_WT_CMD =
  "git -C /home/yale/work/quay-worktrees/gap-execute-suite-fix-green-previous-round-branch merge --no-ff task/gap-execute-suite-fix-green-previous-round-branch -m \"merge: fan-in gap-execute-suite-fix-green-previous-round-branch (A6) — Fix prompt 加「上一轮为绿」分支\"";

// ── PURE 判据1: A6 subject/form ───────────────────────────────────────────────────────────────────────

test("PURE judgeA6Line — the REAL current A6 subject (Fan-in 已返回任务) ⇒ RED", () => {
  const line = `| A6 | ${REAL_OLD_A6_SUBJECT} | … |`;
  const v = judgeA6Line(line);
  assert.equal(v.ok, false);
  assert.equal(v.evaluated, true);
  assert.equal(v.oldSubject, true);
  assert.match(v.reason, /old-subject/);
});

test("PURE judgeA6Line — the REAL current A6 ① step (`git -C <wt> merge`) ⇒ RED", () => {
  const line = `| A6 | Fan-in 已返回任务 | **无锁段(全在任务 worktree 内)** ${REAL_OLD_A6_STEP1} → … |`;
  const v = judgeA6Line(line);
  assert.equal(v.ok, false);
  assert.equal(v.evaluated, true);
  assert.equal(v.gitCT, true);
  assert.match(v.reason, /git-C-wt/);
});

test("PURE judgeA6Line — a NEW subagent-executor A6 form ⇒ GREEN (subject changed, no `git -C <wt>`)", () => {
  const newLine = `| A6 | Fan-in 回到任务 subagent(**无锁段 + 持锁段全在 subagent 自回合内, ff 成功后才返回, 人 2026-08-14 裁定,SPEC-fan-in-ff-merge-lock**) | **无锁段(全在任务 worktree 内)** ① \`git merge $MERGE_TARGET\`(subagent 已在自身 worktree 内,cwd=worktree,冲突【只可能在这】出现) → … |`;
  const v = judgeA6Line(newLine);
  assert.equal(v.ok, true);
  assert.equal(v.evaluated, true);
  assert.equal(v.oldSubject, false);
  assert.equal(v.gitCT, false);
});

test("PURE judgeA6Line — missing/empty line ⇒ NOT-EVALUATED (never conflated with green)", () => {
  assert.equal(judgeA6Line(null).evaluated, false);
  assert.equal(judgeA6Line(undefined).evaluated, false);
  assert.equal(judgeA6Line("   ").evaluated, false);
  assert.equal(judgeA6Line("").ok, true);
});

// ── PURE 判据2: agent identity ────────────────────────────────────────────────────────────────────────

test("PURE isMainThreadAgentId — null/empty OR the main-session id is the main-thread form", () => {
  assert.equal(isMainThreadAgentId(null, null), true);
  assert.equal(isMainThreadAgentId("", "main-sess"), true);
  assert.equal(isMainThreadAgentId(undefined, null), true);
  assert.equal(isMainThreadAgentId("main-sess", "main-sess"), true);
  assert.equal(isMainThreadAgentId("subagent-xyz", "main-sess"), false);
});

test("PURE checkAgentId — a record with agentId null (script called WITHOUT --agent-id) ⇒ RED", () => {
  const records = [
    { event: "acquire", taskId: "gap-ac62-a", pid: 1, agentId: null },
    { event: "release", taskId: "gap-ac62-a", pid: 1, agentId: null },
  ];
  const v = checkAgentId(records, "main-sess");
  assert.equal(v.ok, false);
  assert.equal(v.evaluated, true);
  assert.equal(v.reason, "main-thread-executor-record");
  assert.ok(v.violations.length >= 1);
});

test("PURE checkAgentId — a record with agentId == the main-session id ⇒ RED", () => {
  const records = [{ event: "acquire", taskId: "gap-ac62-b", pid: 2, agentId: "main-sess" }];
  const v = checkAgentId(records, "main-sess");
  assert.equal(v.ok, false);
  assert.equal(v.evaluated, true);
  assert.match(v.violations[0], /== main/);
});

test("PURE checkAgentId — records carrying a subagent id ≠ the main session ⇒ GREEN", () => {
  const records = [
    { event: "acquire", taskId: "gap-ac67-c", pid: 3, agentId: "subagent-uuid-111" },
    { event: "release", taskId: "gap-ac67-c", pid: 3, agentId: "subagent-uuid-111" },
  ];
  const v = checkAgentId(records, "main-sess");
  assert.equal(v.ok, true);
  assert.equal(v.evaluated, true);
});

test("PURE checkAgentId — no records ⇒ NOT-EVALUATED (nothing to validate, not green)", () => {
  const v = checkAgentId([], "main-sess");
  assert.equal(v.ok, true);
  assert.equal(v.evaluated, false);
  assert.equal(v.reason, "no-fan-in-records (NOT-EVALUATED)");
});

// ── PURE 判据3: real main-thread fan-in command replay ────────────────────────────────────────────────

test("PURE judgeFanInCommand — the REAL `git merge --no-ff task/<id>` fan-in ⇒ RED (判据3 replay)", () => {
  const v = judgeFanInCommand(REAL_MAIN_THREAD_MERGE_CMD);
  assert.equal(v.ok, false);
  assert.equal(v.evaluated, true);
  assert.equal(v.reason, "main-thread-non-ff-fan-in-merge");
});

test("PURE judgeFanInCommand — the REAL `git -C <worktree> … merge` ⇒ RED (判据3 replay)", () => {
  const v = judgeFanInCommand(REAL_GIT_CT_WT_CMD);
  assert.equal(v.ok, false);
  assert.equal(v.evaluated, true);
  assert.equal(v.reason, "main-thread-git-C-merge-into-worktree");
});

test("PURE judgeFanInCommand — a subagent's in-worktree `git merge develop` (no -C) ⇒ GREEN", () => {
  const v = judgeFanInCommand("git merge develop");
  assert.equal(v.ok, true);
  assert.equal(v.evaluated, true);
});

test("PURE judgeFanInCommand — empty command ⇒ NOT-EVALUATED", () => {
  assert.equal(judgeFanInCommand(null).evaluated, false);
});

// ── integration: the checker CLI over the real samples ────────────────────────────────────────────────

function runChecker(args) {
  return spawnSync("node", ["--no-warnings", "--experimental-strip-types", CHECKER, "--json", ...args], { encoding: "utf8" });
}

test("integration — a temp fast-mode-tick-core.md carrying the REAL old A6 ⇒ RED (exit 1)", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ac67-"));
  try {
    const file = path.join(dir, "fast-mode-tick-core.md");
    fs.writeFileSync(file, `# inner tick\n\n| A6 | ${REAL_OLD_A6_SUBJECT} | ${REAL_OLD_A6_STEP1} |\n`, "utf8");
    const r = runChecker(["--a6-file", file]);
    assert.equal(r.status, 1, `real old A6 must be RED: ${r.stdout}${r.stderr}`);
    const out = JSON.parse(r.stdout);
    assert.equal(out.ok, false);
    const a6 = out.checks.find((c) => c.check === "a6-executor-position");
    assert.equal(a6.ok, false);
    assert.equal(a6.evaluated, true);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("integration — a temp fast-mode-tick-core.md carrying the NEW subagent A6 ⇒ PASS (exit 0)", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ac67new-"));
  try {
    const file = path.join(dir, "fast-mode-tick-core.md");
    const newLine = `| A6 | Fan-in 回到任务 subagent | ① \`git merge $MERGE_TARGET\` → … |`;
    fs.writeFileSync(file, `# inner tick\n\n${newLine}\n`, "utf8");
    const r = runChecker(["--a6-file", file]);
    assert.equal(r.status, 0, `new A6 must pass: ${r.stdout}${r.stderr}`);
    const out = JSON.parse(r.stdout);
    assert.equal(out.ok, true);
    const a6 = out.checks.find((c) => c.check === "a6-executor-position");
    assert.equal(a6.ok, true);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("integration — the LANDED plugin/loop/fast-mode-tick-core.md (edited to the subagent form by AC67) ⇒ PASS", () => {
  // The plugin/loop copy is the one AC67 edits directly (the orchestration/ copy is outer-exclusive —
  // outer lands the identical A6 line per the AC73 双副本 ruling). This asserts the landed state is
  // judged GREEN, so a future revert to the old subject / `git -C <wt>` form turns the checker RED.
  const file = path.join(REPO_ROOT, "plugin", "loop", "fast-mode-tick-core.md");
  const line = extractA6Line(file);
  assert.ok(line, "plugin/loop fast-mode-tick-core.md must have an | A6 | row");
  const v = judgeA6Line(line);
  assert.equal(v.ok, true, `landed plugin/loop A6 must be the subagent form: ${v.reason}`);
  assert.equal(v.evaluated, true);
  assert.equal(v.oldSubject, false);
  assert.equal(v.gitCT, false);
});

test("integration — agentId null in a lock-events file ⇒ RED (exit 1)", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ac67ag-"));
  try {
    const events = path.join(dir, "fan-in-merge-lock-events.jsonl");
    fs.writeFileSync(events, [
      JSON.stringify({ event: "acquire", epoch: 100, taskId: "gap-ac67-x", pid: 1, agentId: null }),
      JSON.stringify({ event: "release", epoch: 101, taskId: "gap-ac67-x", pid: 1, agentId: null }),
    ].join("\n") + "\n", "utf8");
    const r = runChecker(["--lock-events", events, "--main-agent-id", "main-sess"]);
    assert.equal(r.status, 1, `null agentId must be RED: ${r.stdout}${r.stderr}`);
    const out = JSON.parse(r.stdout);
    const lock = out.checks.find((c) => c.check === "agent-id-lock-events");
    assert.equal(lock.ok, false);
    assert.equal(lock.evaluated, true);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("integration — a subagent agentId in the retry record ⇒ PASS (exit 0)", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ac67agok-"));
  try {
    const retries = path.join(dir, "fan-in-retries.jsonl");
    fs.writeFileSync(retries, JSON.stringify({
      taskId: "gap-ac67-y", attempt: 1, developHead: "b".repeat(40), ts: "2026-08-14T03:00:00Z",
      agentId: "subagent-uuid-222",
    }) + "\n", "utf8");
    const r = runChecker(["--retry-record", retries, "--main-agent-id", "main-sess"]);
    assert.equal(r.status, 0, `subagent agentId must pass: ${r.stdout}${r.stderr}`);
    const out = JSON.parse(r.stdout);
    const retry = out.checks.find((c) => c.check === "agent-id-retry-record");
    assert.equal(retry.ok, true);
    assert.equal(retry.evaluated, true);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("integration — the REAL main-thread merge command replay ⇒ RED (exit 1)", () => {
  const r = runChecker(["--command", REAL_MAIN_THREAD_MERGE_CMD]);
  assert.equal(r.status, 1, `real main-thread merge command must be RED: ${r.stdout}${r.stderr}`);
  const out = JSON.parse(r.stdout);
  assert.equal(out.ok, false);
});

test("extractA6Line — finds the | A6 | row in a fast-mode-tick-core.md file", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ac67ex-"));
  try {
    const file = path.join(dir, "tick.md");
    fs.writeFileSync(file, "| A5 | foo |\n| A6 | bar | baz |\n| A7 | qux |\n", "utf8");
    const line = extractA6Line(file);
    assert.ok(line.startsWith("| A6 |"));
    assert.match(line, /bar/);
    // Missing file ⇒ null
    assert.equal(extractA6Line(path.join(dir, "nope.md")), null);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("--help exits 0 with usage on stdout", () => {
  const r = runChecker(["--help"]);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /fan-in-ff-executor-check/);
});
