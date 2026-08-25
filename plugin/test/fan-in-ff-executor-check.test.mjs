// @test-group engine
// fan-in-ff-executor-check.test.mjs — AC67 fan-in EXECUTOR checker (判据1/判据2/判据3/判据4 能取假),
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
  extractBashCommands,
  checkAgentId,
  judgeFanInCommand,
  classifyBashCommand,
  checkTranscriptLocation,
  isMainThreadAgentId,
  findRuledHistoricalTaskEntry,
  judgeA6MergeNotRebase,
  judgeCommandMergeNotRebase,
  judgeA6DeltaStep,
  classifyDeltaRerun,
  judgeDeltaDecision,
  resolveDeltaCodeSurface,
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

// ── Ruled-historical one-off 豁免 (tasks/gap-fan-in-ff-executor-check-ruled-historical-99f845d9) ───────
// manager 2026-08-23 裁定：99f845d9 的应急主线程 fan-in（未传 --agent-id 落地
// gap-direct-to-develop-ruled-historical-99f845d9）是 ruled one-off。入表 taskId 的记录分类为
// ruledHistorical（reason `ruled-historical-record`），非 main-thread-executor——豁免表有界，未入表仍红。

test("PURE findRuledHistoricalTaskEntry — the ruled taskId matches; a non-table taskId does not", () => {
  assert.equal(findRuledHistoricalTaskEntry("gap-direct-to-develop-ruled-historical-99f845d9")?.taskId, "gap-direct-to-develop-ruled-historical-99f845d9");
  assert.equal(findRuledHistoricalTaskEntry("gap-ac67-c"), undefined, "非入表任务不入豁免表");
  assert.equal(findRuledHistoricalTaskEntry(""), undefined);
  assert.equal(findRuledHistoricalTaskEntry(null), undefined);
});

test("PURE checkAgentId — the ruled task's agentId-null records ⇒ ruledHistorical (not main-thread-executor)", () => {
  const records = [
    { event: "acquire", taskId: "gap-direct-to-develop-ruled-historical-99f845d9", pid: 1, agentId: null },
    { event: "release", taskId: "gap-direct-to-develop-ruled-historical-99f845d9", pid: 1, agentId: null },
  ];
  const v = checkAgentId(records, "main-sess");
  assert.equal(v.ok, true, "ruled one-off must not be RED");
  assert.equal(v.evaluated, true);
  assert.equal(v.reason, "ruled-historical-record", "ruled classification is distinguishable (not subagent-executor-record)");
  assert.equal(v.violations.length, 0);
  assert.ok(v.ruledHistorical.length >= 1, "ruledHistorical entries are listed (auditable)");
  assert.match(v.ruledHistorical[0], /ruled one-off/);
});

test("PURE checkAgentId — a real main-thread record NOT in the ruled table still ⇒ RED (能取假)", () => {
  const records = [{ event: "acquire", taskId: "gap-ac67-z", pid: 2, agentId: null }];
  const v = checkAgentId(records, "main-sess");
  assert.equal(v.ok, false);
  assert.equal(v.evaluated, true);
  assert.equal(v.reason, "main-thread-executor-record");
  assert.ok(v.violations.length >= 1);
  assert.equal(v.ruledHistorical.length, 0);
});

test("PURE checkAgentId — mixed ruled + non-ruled main-thread records ⇒ still RED (豁免有界)", () => {
  const records = [
    { event: "acquire", taskId: "gap-direct-to-develop-ruled-historical-99f845d9", pid: 1, agentId: null },
    { event: "acquire", taskId: "gap-ac67-z", pid: 2, agentId: null },
  ];
  const v = checkAgentId(records, "main-sess");
  assert.equal(v.ok, false, "a non-ruled main-thread record must still red");
  assert.equal(v.reason, "main-thread-executor-record");
  assert.equal(v.ruledHistorical.length, 1, "the ruled record is still classified ruledHistorical");
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

// ── PURE 判据4: executor transcript location (人 2026-08-14 追加裁定) ─────────────────────────────────

// REAL main-thread samples (D2 不构造 — captured verbatim from the inner session transcripts):
// the main full-suite test.sh WITHOUT --for-task (bc1a438b 2026-08-13T19:29:39Z), a real flip commit
// (tasks: 翻 <id> done), and a real main-thread merge (bc1a438b 16:01Z).
const REAL_MAIN_FULL_SUITE =
  "cd /home/yale/work/quay-worktrees/gap-worktree-node-modules-inconsistent-self-verify && scripts/test.sh > /tmp/wtmod-final-fullsuite.log 2>&1; echo \"FULL_SUITE_EXIT=$?\" >> /tmp/wtmod-final-fullsuite.log; echo \"DONE\"";
const REAL_MAIN_FLIP_COMMIT =
  "git add tasks/gap-ac63-fan-in-ff-merge-lock-protocol.md && git commit -m \"tasks: 翻 gap-ac63 done（AC46 判据3 per-task 全量绿 + a2——worktree 内翻，merge 带 status）\"";
const REAL_MAIN_MERGE =
  "git merge --no-ff task/gap-inner-blocked-signal-comment-refs-retired-inner-state-sh -m \"merge: fan-in gap-inner-blocked-signal-comment-refs-retired-inner-state-sh (A6) — comment 指向退役 inner-state.sh 的修法\"";
// A REAL subagent scoped gate call (902b4528 subagents/agent-*.jsonl) — test.sh WITH --for-task.
const REAL_SUBAGENT_SCOPED =
  "cd /home/yale/work/quay-worktrees/gap-superseded-modeled-as-task-lifecycle-terminal && scripts/test.sh --for-task gap-superseded-modeled-as-task-lifecycle-terminal --allow-thin 2>&1 | tail -60";

test("PURE classifyBashCommand — the REAL main full-suite (test.sh w/o --for-task) ⇒ full-suite-test-sh", () => {
  assert.deepEqual(classifyBashCommand(REAL_MAIN_FULL_SUITE), ["full-suite-test-sh"]);
});

test("PURE classifyBashCommand — the REAL flip commit ⇒ status-flip-commit", () => {
  assert.deepEqual(classifyBashCommand(REAL_MAIN_FLIP_COMMIT), ["status-flip-commit"]);
});

test("PURE classifyBashCommand — the REAL main-thread merge ⇒ develop-merge", () => {
  assert.deepEqual(classifyBashCommand(REAL_MAIN_MERGE), ["develop-merge"]);
});

test("PURE classifyBashCommand — the REAL subagent scoped gate is NOT a main-thread action", () => {
  assert.deepEqual(classifyBashCommand(REAL_SUBAGENT_SCOPED), [], "test.sh --for-task must not flag");
});

test("PURE classifyBashCommand — read-only git merge-base / merge-tree are NOT develop-merges", () => {
  assert.equal(classifyBashCommand("git merge-base HEAD integration").includes("develop-merge"), false);
  assert.equal(classifyBashCommand("git merge-tree $(git merge-base integration HEAD) integration HEAD").includes("develop-merge"), false);
  assert.equal(classifyBashCommand("git merge develop").includes("develop-merge"), true);
});

test("PURE checkTranscriptLocation — the REAL main session carrying full-suite+flip+merge ⇒ RED", () => {
  const v = checkTranscriptLocation([REAL_MAIN_FULL_SUITE, REAL_MAIN_FLIP_COMMIT, REAL_MAIN_MERGE], [REAL_SUBAGENT_SCOPED]);
  assert.equal(v.ok, false);
  assert.equal(v.evaluated, true);
  assert.equal(v.reason, "main-session-executor");
  assert.ok(v.mainViolations.length >= 3);
});

test("PURE checkTranscriptLocation — the same actions ONLY in the subagent transcripts ⇒ GREEN", () => {
  const v = checkTranscriptLocation([], [REAL_MAIN_FULL_SUITE, REAL_MAIN_FLIP_COMMIT, REAL_MAIN_MERGE, REAL_SUBAGENT_SCOPED]);
  assert.equal(v.ok, true);
  assert.equal(v.evaluated, true);
  assert.ok(v.reason.startsWith("subagent-executor ("), v.reason);
  for (const c of ["full-suite-test-sh", "status-flip-commit", "develop-merge"]) {
    assert.ok(v.reason.includes(c), `reason lists ${c}: ${v.reason}`);
  }
});

test("PURE checkTranscriptLocation — no classified activity on either side ⇒ NOT-EVALUATED", () => {
  const v = checkTranscriptLocation([], []);
  assert.equal(v.ok, true);
  assert.equal(v.evaluated, false);
  assert.equal(v.reason, "no-fan-in-activity (NOT-EVALUATED)");
});

// ── AC75 判据5: A6 step ① rebase→merge + command rebase 检出 ────────────────────────────────────────

// A REAL rebase-form A6 step ① — the inner implementation's "11 次 rebase" signature captured from
// the pre-AC75 era (SPEC §1b: 实现用 rebase 11 次). The ① step command form is `git rebase $MERGE_TARGET`.
const REAL_OLD_A6_REBASE_STEP1 = "① `git rebase $MERGE_TARGET`(冲突【只可能在这】出现,自由解,不占任何人)";
// A REAL rebase fan-in command (the old executor form — SPEC §1b's "11 次 rebase").
const REAL_REBASE_FAN_IN_CMD = "git rebase develop && git merge task/gap-x";

test("AC75 judgeA6MergeNotRebase — a REAL rebase step ① ⇒ RED (must be merge)", () => {
  const line = `| A6 | Fan-in 已返回任务 | **无锁段** ${REAL_OLD_A6_REBASE_STEP1} → … |`;
  const v = judgeA6MergeNotRebase(line);
  assert.equal(v.ok, false);
  assert.equal(v.evaluated, true);
  assert.equal(v.rebase, true);
  assert.match(v.reason, /rebase/);
});

test("AC75 judgeA6MergeNotRebase — the LANDED plugin/loop A6 (git merge, AC67/AC75) ⇒ GREEN", () => {
  const file = path.join(REPO_ROOT, "plugin", "loop", "fast-mode-tick-core.md");
  const line = extractA6Line(file);
  const v = judgeA6MergeNotRebase(line);
  assert.equal(v.ok, true, `landed A6 must be merge-not-rebase: ${v.reason}`);
  assert.equal(v.evaluated, true);
  assert.equal(v.rebase, false);
});

test("AC75 judgeA6MergeNotRebase — missing/empty line ⇒ NOT-EVALUATED", () => {
  assert.equal(judgeA6MergeNotRebase(null).evaluated, false);
  assert.equal(judgeA6MergeNotRebase("   ").evaluated, false);
});

test("AC75 judgeCommandMergeNotRebase — a REAL rebase fan-in command ⇒ RED", () => {
  const v = judgeCommandMergeNotRebase(REAL_REBASE_FAN_IN_CMD);
  assert.equal(v.ok, false);
  assert.equal(v.evaluated, true);
  assert.match(v.reason, /rebase/);
});

test("AC75 judgeCommandMergeNotRebase — a merge fan-in command ⇒ GREEN", () => {
  assert.equal(judgeCommandMergeNotRebase("git merge develop").ok, true);
  assert.equal(judgeCommandMergeNotRebase(null).evaluated, false);
});

// ── AC75 判据6: A6 无锁段第 2 步 delta 断言面判定 (fail-closed) ───────────────────────────────────────

test("AC75 judgeA6DeltaStep — an A6 WITHOUT the delta step (pre-AC75) ⇒ RED", () => {
  const line = "| A6 | Fan-in 回到任务 subagent | **无锁段** ① `git merge $MERGE_TARGET` → ③ 全量 suite + doc 检查 |";
  const v = judgeA6DeltaStep(line);
  assert.equal(v.ok, false);
  assert.equal(v.evaluated, true);
  assert.equal(v.hasStep, false);
});

test("AC75 judgeA6DeltaStep — an A6 WITH the delta step but NOT fail-closed ⇒ RED", () => {
  const line = "| A6 | Fan-in 回到任务 subagent | ① `git merge $MERGE_TARGET` → ② delta 断言面判定（doc ⇒ 不重跑;代码 ⇒ 重跑） → … |";
  const v = judgeA6DeltaStep(line);
  assert.equal(v.ok, false);
  assert.equal(v.evaluated, true);
  assert.equal(v.hasStep, true);
  assert.equal(v.failClosed, false);
});

test("AC75 judgeA6DeltaStep — the LANDED plugin/loop A6 (delta step + fail-closed) ⇒ GREEN", () => {
  const file = path.join(REPO_ROOT, "plugin", "loop", "fast-mode-tick-core.md");
  const line = extractA6Line(file);
  const v = judgeA6DeltaStep(line);
  assert.equal(v.ok, true, `landed A6 must carry the fail-closed delta step: ${v.reason}`);
  assert.equal(v.evaluated, true);
  assert.equal(v.hasStep, true);
  assert.equal(v.failClosed, true);
});

test("AC75 judgeA6DeltaStep — missing/empty line ⇒ NOT-EVALUATED", () => {
  assert.equal(judgeA6DeltaStep(null).evaluated, false);
  assert.equal(judgeA6DeltaStep("").evaluated, false);
});

// ── AC75 判据7: delta 断言面判定 能取假 (real-sample replay, D2 不构造) ───────────────────────────────

// REAL develop deltas captured verbatim from `git show --name-only` on develop commits:
//   pureDoc = 00cd6408 (tasks/gap-ac72 + tasks/gap-ac73 — task bodies ONLY, the SPEC §1c doc/任务体 face)
//   code    = 6b0802e7 (plugin/loop + plugin/scripts/.ts + plugin/test/.test.mjs + tasks — touches code)
const REAL_DELTA_PURE_DOC = [
  "tasks/gap-ac72-cert-mechanism-retire.md",
  "tasks/gap-ac73-catalog-rhythm-consumer-check.md",
];
const REAL_DELTA_CODE = [
  "plugin/loop/fast-mode-tick-core.md",
  "plugin/scripts/fan-in-ff-executor-check.ts",
  "plugin/test/fan-in-ff-executor-check.test.mjs",
  "tasks/gap-ac67-fan-in-executor-to-task-subagent.md",
];

test("AC75 classifyDeltaRerun — the REAL pure-doc develop delta ⇒ no rerun (doc/任务体 face)", () => {
  const surface = new Set(resolveDeltaCodeSurface(REPO_ROOT));
  const c = classifyDeltaRerun(REAL_DELTA_PURE_DOC, surface);
  assert.equal(c.rerun, false);
  assert.equal(c.evaluated, true);
  assert.deepEqual(c.codeHits, []);
});

test("AC75 classifyDeltaRerun — the REAL code develop delta ⇒ rerun (touches code)", () => {
  const surface = new Set(resolveDeltaCodeSurface(REPO_ROOT));
  const c = classifyDeltaRerun(REAL_DELTA_CODE, surface);
  assert.equal(c.rerun, true);
  assert.equal(c.evaluated, true);
  assert.ok(c.codeHits.length >= 2, `codeHits: ${c.codeHits.join(", ")}`);
});

test("AC75 judgeDeltaDecision — pure-doc delta but RERAN the full suite ⇒ RED (纯 doc 却重跑, 判据3 D2)", () => {
  const surface = new Set(resolveDeltaCodeSurface(REPO_ROOT));
  const v = judgeDeltaDecision(REAL_DELTA_PURE_DOC, surface, "reran-full-suite");
  assert.equal(v.ok, false);
  assert.equal(v.evaluated, true);
  assert.match(v.reason, /pure-doc-but-reran/);
});

test("AC75 judgeDeltaDecision — code delta but SKIPPED the full suite ⇒ RED (含代码却跳过, 判据3 D2)", () => {
  const surface = new Set(resolveDeltaCodeSurface(REPO_ROOT));
  const v = judgeDeltaDecision(REAL_DELTA_CODE, surface, "skipped-full-suite");
  assert.equal(v.ok, false);
  assert.equal(v.evaluated, true);
  assert.match(v.reason, /code-delta-but-skipped/);
});

test("AC75 judgeDeltaDecision — pure-doc delta and skipped ⇒ GREEN", () => {
  const surface = new Set(resolveDeltaCodeSurface(REPO_ROOT));
  const v = judgeDeltaDecision(REAL_DELTA_PURE_DOC, surface, "skipped-full-suite");
  assert.equal(v.ok, true);
  assert.equal(v.evaluated, true);
});

test("AC75 judgeDeltaDecision — code delta and reran ⇒ GREEN", () => {
  const surface = new Set(resolveDeltaCodeSurface(REPO_ROOT));
  const v = judgeDeltaDecision(REAL_DELTA_CODE, surface, "reran-full-suite");
  assert.equal(v.ok, true);
  assert.equal(v.evaluated, true);
});

test("AC75 judgeDeltaDecision — cannot judge (empty delta) but skipped ⇒ RED (fail-closed, 硬规则 3b)", () => {
  const surface = new Set(resolveDeltaCodeSurface(REPO_ROOT));
  const v = judgeDeltaDecision([], surface, "skipped-full-suite");
  assert.equal(v.ok, false);
  assert.equal(v.evaluated, true);
  assert.equal(v.canJudge, false);
  assert.match(v.reason, /fail-closed|cannot-judge/);
});

test("AC75 judgeDeltaDecision — no decision given ⇒ NOT-EVALUATED", () => {
  const surface = new Set(resolveDeltaCodeSurface(REPO_ROOT));
  const v = judgeDeltaDecision(REAL_DELTA_PURE_DOC, surface, null);
  assert.equal(v.ok, true);
  assert.equal(v.evaluated, false);
});

// ── integration: the checker CLI over the real samples ────────────────────────────────────────────────

function runChecker(args) {
  // Robust spawn: a generous timeout + a fail-fast diagnostic when stdout is empty. Spawning a
  // `node --experimental-strip-types` process is LOAD-SENSITIVE under the full suite's concurrent
  // lanes — an empty stdout must surface the stderr (or the timeout) instead of a bare
  // `JSON.parse(r.stdout)` SyntaxError (gap-ac67: suite-environment fragility, not a criterion bug).
  const r = spawnSync("node", ["--no-warnings", "--experimental-strip-types", CHECKER, "--json", ...args], {
    encoding: "utf8", timeout: 30_000,
  });
  if (r.error) {
    throw new Error(`checker spawn failed: ${r.error.message}${r.stderr ? `\nstderr: ${r.stderr.slice(0, 800)}` : ""}`);
  }
  if (!r.stdout || !r.stdout.trim()) {
    throw new Error(
      `checker produced NO stdout (exit ${r.status}, signal ${r.signal ?? "none"}, timeout ${r.error?.code ?? "none"})\n` +
      `stderr: ${(r.stderr ?? "(none)").slice(0, 800)}`,
    );
  }
  return r;
}

test("integration — a temp fast-mode-tick-core.md carrying the REAL old A6 ⇒ RED via extractA6Line+judgeA6Line (no CLI spawn)", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ac67-"));
  try {
    const file = path.join(dir, "fast-mode-tick-core.md");
    fs.writeFileSync(file, `# inner tick\n\n| A6 | ${REAL_OLD_A6_SUBJECT} | ${REAL_OLD_A6_STEP1} |\n`, "utf8");
    const v = judgeA6Line(extractA6Line(file));
    assert.equal(v.ok, false);
    assert.equal(v.evaluated, true);
    assert.equal(v.oldSubject, true);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("integration — a temp fast-mode-tick-core.md carrying the NEW subagent A6 ⇒ GREEN via extractA6Line+judgeA6Line (no CLI spawn)", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ac67new-"));
  try {
    const file = path.join(dir, "fast-mode-tick-core.md");
    const newLine = `| A6 | Fan-in 回到任务 subagent | ① \`git merge $MERGE_TARGET\` → … |`;
    fs.writeFileSync(file, `# inner tick\n\n${newLine}\n`, "utf8");
    const v = judgeA6Line(extractA6Line(file));
    assert.equal(v.ok, true);
    assert.equal(v.evaluated, true);
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

test("integration — the ruled task's agentId-null lock-events ⇒ PASS (exit 0, ruled-historical-record)", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ac67ruled-"));
  try {
    const events = path.join(dir, "fan-in-merge-lock-events.jsonl");
    fs.writeFileSync(events, [
      JSON.stringify({ event: "acquire", epoch: 100, taskId: "gap-direct-to-develop-ruled-historical-99f845d9", pid: 1, agentId: null }),
      JSON.stringify({ event: "release", epoch: 101, taskId: "gap-direct-to-develop-ruled-historical-99f845d9", pid: 1, agentId: null }),
    ].join("\n") + "\n", "utf8");
    const r = runChecker(["--lock-events", events, "--main-agent-id", "main-sess"]);
    assert.equal(r.status, 0, `ruled lock-events must PASS: ${r.stdout}${r.stderr}`);
    const out = JSON.parse(r.stdout);
    const lock = out.checks.find((c) => c.check === "agent-id-lock-events");
    assert.equal(lock.ok, true);
    assert.equal(lock.evaluated, true);
    assert.equal(lock.reason, "ruled-historical-record");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("integration — a NON-ruled agentId-null lock-events ⇒ still RED (exit 1, 能取假)", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ac67ruledneg-"));
  try {
    const events = path.join(dir, "fan-in-merge-lock-events.jsonl");
    fs.writeFileSync(events, [
      JSON.stringify({ event: "acquire", epoch: 100, taskId: "gap-ac67-w", pid: 1, agentId: null }),
      JSON.stringify({ event: "release", epoch: 101, taskId: "gap-ac67-w", pid: 1, agentId: null }),
    ].join("\n") + "\n", "utf8");
    const r = runChecker(["--lock-events", events, "--main-agent-id", "main-sess"]);
    assert.equal(r.status, 1, `non-ruled null agentId must be RED: ${r.stdout}${r.stderr}`);
    const out = JSON.parse(r.stdout);
    const lock = out.checks.find((c) => c.check === "agent-id-lock-events");
    assert.equal(lock.ok, false);
    assert.equal(lock.reason, "main-thread-executor-record");
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

function writeTranscript(file, commands) {
  // A minimal Claude-Code jsonl shape: each line has message.content with a Bash tool_use block.
  const lines = commands.map((cmd) => JSON.stringify({
    message: { content: [{ type: "tool_use", name: "Bash", input: { command: cmd } }] },
  }));
  fs.writeFileSync(file, lines.join("\n") + "\n", "utf8");
}

test("integration — extractBashCommands parses the real main-session jsonl, then checkTranscriptLocation ⇒ RED (no CLI spawn)", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ac67tl-"));
  try {
    const main = path.join(dir, "session.jsonl");
    const sub = path.join(dir, "sub.jsonl");
    writeTranscript(main, [REAL_MAIN_FULL_SUITE, REAL_MAIN_MERGE]);
    writeTranscript(sub, [REAL_SUBAGENT_SCOPED]);
    const v = checkTranscriptLocation(extractBashCommands(main), extractBashCommands(sub));
    assert.equal(v.ok, false);
    assert.equal(v.evaluated, true);
    assert.equal(v.reason, "main-session-executor");
    assert.ok(v.mainViolations.length >= 2);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("integration — the actions ONLY in subagent transcripts ⇒ GREEN (no CLI spawn)", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ac67tlok-"));
  try {
    const main = path.join(dir, "session.jsonl");
    const sub = path.join(dir, "sub.jsonl");
    writeTranscript(main, []); // main has NO fan-in actions
    writeTranscript(sub, [REAL_MAIN_FULL_SUITE, REAL_MAIN_FLIP_COMMIT, REAL_MAIN_MERGE, REAL_SUBAGENT_SCOPED]);
    const v = checkTranscriptLocation(extractBashCommands(main), extractBashCommands(sub));
    assert.equal(v.ok, true);
    assert.equal(v.evaluated, true);
    assert.ok(v.reason.startsWith("subagent-executor ("), v.reason);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("--help exits 0 with usage on stdout", () => {
  const r = runChecker(["--help"]);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /fan-in-ff-executor-check/);
});

test("AC75 integration — CLI --delta-files (REAL pure-doc) --delta-decision reran-full-suite ⇒ RED (exit 1)", () => {
  const r = runChecker(["--root", REPO_ROOT, "--delta-files", REAL_DELTA_PURE_DOC.join(","), "--delta-decision", "reran-full-suite"]);
  assert.equal(r.status, 1, `pure-doc-but-reran must be RED: ${r.stdout}${r.stderr}`);
  const out = JSON.parse(r.stdout);
  assert.equal(out.ok, false);
  const delta = out.checks.find((c) => c.check === "delta-assertion-decision");
  assert.ok(delta, "delta-assertion-decision check present");
  assert.equal(delta.ok, false);
  assert.match(delta.reason, /pure-doc-but-reran/);
});

test("AC75 integration — CLI --delta-files (REAL code) --delta-decision skipped-full-suite ⇒ RED (exit 1)", () => {
  const r = runChecker(["--root", REPO_ROOT, "--delta-files", REAL_DELTA_CODE.join(","), "--delta-decision", "skipped-full-suite"]);
  assert.equal(r.status, 1, `code-but-skipped must be RED: ${r.stdout}${r.stderr}`);
  const out = JSON.parse(r.stdout);
  assert.equal(out.ok, false);
  const delta = out.checks.find((c) => c.check === "delta-assertion-decision");
  assert.equal(delta.ok, false);
  assert.match(delta.reason, /code-delta-but-skipped/);
});

test("AC75 integration — CLI --a6-file plugin/loop ⇒ the landed A6 passes merge-not-rebase + delta-step", () => {
  const file = path.join(REPO_ROOT, "plugin", "loop", "fast-mode-tick-core.md");
  const r = runChecker(["--a6-file", file]);
  assert.equal(r.status, 0, `landed plugin/loop A6 must PASS: ${r.stdout}${r.stderr}`);
  const out = JSON.parse(r.stdout);
  const merge = out.checks.find((c) => c.check === "a6-step1-merge-not-rebase");
  assert.ok(merge, "a6-step1-merge-not-rebase check present");
  assert.equal(merge.ok, true);
  const delta = out.checks.find((c) => c.check === "a6-delta-assertion-step");
  assert.ok(delta, "a6-delta-assertion-step check present");
  assert.equal(delta.ok, true);
});

test("AC75 integration — CLI --a6-line with a REBASE step ① ⇒ RED (exit 1)", () => {
  const line = `| A6 | Fan-in 已返回任务 | **无锁段** ${REAL_OLD_A6_REBASE_STEP1} → … |`;
  const r = runChecker(["--a6-line", line]);
  assert.equal(r.status, 1, `rebase step ① must be RED: ${r.stdout}${r.stderr}`);
  const out = JSON.parse(r.stdout);
  const merge = out.checks.find((c) => c.check === "a6-step1-merge-not-rebase");
  assert.equal(merge.ok, false);
  assert.match(merge.reason, /rebase/);
});

// ═════════════════════════════════════════════════════════════════════════════════════════════════════
// gap-fan-in-ff-retry-reruns-suite-on-inert-increment — fan-in-ff-merge.sh 持锁段 ff-retry 惰性增量跳过
//   AC1 惰性跳过: ff 失败且 develop 增量惰性（tasks/*.md）⇒ 锁内 merge develop + 立即重试 ff ⇒ exit 0
//       （不回阶段 1 重跑全量、不写 retry record）。
//   AC2 代码重跑: ff 失败且 develop 增量含代码 ⇒ 照旧 exit 1（retry record、ref 不动）。
//   AC3 闸拒绝:  suite_head 是 tip 祖先但 delta(suite_head, tip) 含 @static-object 覆盖路径 ⇒ exit 2
//       （可取假 — 证明闸真的在判、不是恒过）。
//   惰性判定全走 --classify-delta（select-static-checks-for-touches.ts，读 scripts/test.sh 的
//   @static-object 声明），无手写路径表（AC4）。
// ═════════════════════════════════════════════════════════════════════════════════════════════════════

const FF_MERGE_SCRIPT = path.join(REPO_ROOT, "plugin", "scripts", "fan-in-ff-merge.sh");

function ffGit(cwd, ...args) {
  return spawnSync("git", ["-C", cwd, ...args], { encoding: "utf8" });
}

function ffInitRepo(dir) {
  ffGit(dir, "init", "-q");
  ffGit(dir, "config", "user.name", "ffretry-test");
  ffGit(dir, "config", "user.email", "ffretry@example.com");
  ffGit(dir, "branch", "-M", "master");
  fs.writeFileSync(path.join(dir, ".gitignore"), ".quay/\n", "utf8");
  ffGit(dir, "add", "-A");
  ffGit(dir, "commit", "-q", "-m", "base");
  fs.writeFileSync(path.join(dir, "base.txt"), "base\n", "utf8");
  ffGit(dir, "add", "-A");
  ffGit(dir, "commit", "-q", "-m", "base-file");
}

/** Create `task/<id>` with a work commit on top of master, then return to master. Returns the tip. */
function ffMakeTaskBranch(dir, taskId) {
  ffGit(dir, "checkout", "-q", "-b", `task/${taskId}`);
  fs.writeFileSync(path.join(dir, "work.txt"), "work\n", "utf8");
  ffGit(dir, "add", "-A");
  ffGit(dir, "commit", "-q", "-m", "task work");
  const tip = ffGit(dir, "rev-parse", "HEAD").stdout.trim();
  ffGit(dir, "checkout", "-q", "master");
  return tip;
}

function ffStateDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "ffretry-state-"));
}

/** Write the task's suite capture (suite_exit=0, suite_head=<tip>) — the ff gate's certificate. */
function ffCapture(st, taskId, tip) {
  const capture = path.join(st, `capture-${taskId}.env`);
  const lines = ["full_suite_ran=true", "skip_reason=", `suite_head=${tip}`, "suite_exit=0"];
  fs.writeFileSync(capture, lines.join("\n") + "\n", "utf8");
  return ["--suite-capture", capture];
}

/** Add a worktree checked out on `task/<id>` (the ff in-lock merge target). Returns the worktree path. */
function ffAddWorktree(dir, taskId) {
  const wt = fs.mkdtempSync(path.join(os.tmpdir(), "ffretry-wt-"));
  fs.rmSync(wt, { recursive: true, force: true }); // git worktree add requires the path to not exist
  const r = ffGit(dir, "worktree", "add", "-q", wt, `task/${taskId}`);
  if (r.status !== 0) throw new Error(`git worktree add failed: ${r.stderr}`);
  return wt;
}

test("AC1 inert increment — ff failure with a tasks/*.md develop delta ⇒ in-lock merge + re-ff ⇒ exit 0 (no retry record)", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ffretry-inert-"));
  const st = ffStateDir();
  let wt = null;
  try {
    ffInitRepo(dir);
    const tip = ffMakeTaskBranch(dir, "inert-a");
    wt = ffAddWorktree(dir, "inert-a");
    // develop advances with an INERT (doc-only) commit AFTER the suite ran on `tip`.
    fs.mkdirSync(path.join(dir, "tasks"), { recursive: true });
    fs.writeFileSync(path.join(dir, "tasks", "other-task.md"), "doc\n", "utf8");
    ffGit(dir, "add", "-A");
    ffGit(dir, "commit", "-q", "-m", "tasks: inert develop advance");
    const events = path.join(st, "events.jsonl");
    const retries = path.join(st, "retries.jsonl");
    const r = spawnSync("bash", [FF_MERGE_SCRIPT, "--task", "inert-a", "--root", dir, "--worktree", wt, ...ffCapture(st, "inert-a", tip), "--lock-events", events, "--retry-record", retries], { encoding: "utf8" });
    assert.equal(r.status, 0, `inert increment must be absorbed in-lock (exit 0):\nstdout=${r.stdout}\nstderr=${r.stderr}`);
    assert.match(r.stdout, /measure ff_only_locked=true/);
    assert.ok(!fs.existsSync(retries), "no retry record — the inert increment was merged in-lock, not a phase-1 retry");
    // master advanced to a commit that now contains the inert tasks/other-task.md (the in-lock merge
    // brought it in) AND the task work — i.e. the ff actually landed.
    const masterFiles = ffGit(dir, "ls-tree", "-r", "--name-only", "HEAD").stdout;
    assert.match(masterFiles, /tasks\/other-task\.md/, "master tree must now contain the inert develop file");
    assert.match(masterFiles, /work\.txt/, "master tree must contain the task work (ff landed)");
  } finally {
    if (wt) { try { ffGit(dir, "worktree", "remove", "--force", wt); } catch { /* best-effort */ } }
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(st, { recursive: true, force: true });
    if (wt) fs.rmSync(wt, { recursive: true, force: true });
  }
});

test("AC2 code increment — ff failure with a code develop delta ⇒ exit 1 (照旧重跑, retry record, ref unchanged)", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ffretry-code-"));
  const st = ffStateDir();
  let wt = null;
  try {
    ffInitRepo(dir);
    const tip = ffMakeTaskBranch(dir, "code-a");
    wt = ffAddWorktree(dir, "code-a");
    // develop advances with a CODE commit (a @static-object-covered plugin/scripts path).
    fs.mkdirSync(path.join(dir, "plugin", "scripts"), { recursive: true });
    fs.writeFileSync(path.join(dir, "plugin", "scripts", "foo.ts"), "code\n", "utf8");
    ffGit(dir, "add", "-A");
    ffGit(dir, "commit", "-q", "-m", "code develop advance");
    const head = ffGit(dir, "rev-parse", "master").stdout.trim();
    const events = path.join(st, "events.jsonl");
    const retries = path.join(st, "retries.jsonl");
    const r = spawnSync("bash", [FF_MERGE_SCRIPT, "--task", "code-a", "--root", dir, "--worktree", wt, ...ffCapture(st, "code-a", tip), "--lock-events", events, "--retry-record", retries], { encoding: "utf8" });
    assert.equal(r.status, 1, `code increment must exit 1 (照旧重跑):\nstdout=${r.stdout}\nstderr=${r.stderr}`);
    assert.match(r.stderr, /FF FAILED/);
    assert.equal(ffGit(dir, "rev-parse", "master").stdout.trim(), head, "ref unchanged on a code increment (no in-lock absorb)");
    const rec = JSON.parse(fs.readFileSync(retries, "utf8").trim());
    assert.equal(rec.taskId, "code-a");
    assert.equal(rec.attempt, 1, "code increment writes the plain retry record");
  } finally {
    if (wt) { try { ffGit(dir, "worktree", "remove", "--force", wt); } catch { /* best-effort */ } }
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(st, { recursive: true, force: true });
    if (wt) fs.rmSync(wt, { recursive: true, force: true });
  }
});

test("AC3 @static-object reject — suite_head ancestor of tip but delta touches a @static-object path ⇒ exit 2 (gate falsifiable)", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ffretry-gate-"));
  const st = ffStateDir();
  try {
    ffInitRepo(dir);
    // task branch: suite commit (suite_head) + a code commit on top touching a @static-object path.
    ffGit(dir, "checkout", "-q", "-b", "task/gate-a");
    fs.writeFileSync(path.join(dir, "work.txt"), "work\n", "utf8");
    ffGit(dir, "add", "-A");
    ffGit(dir, "commit", "-q", "-m", "work (suite ran here)");
    const suiteHead = ffGit(dir, "rev-parse", "HEAD").stdout.trim();
    fs.mkdirSync(path.join(dir, "orchestration"), { recursive: true });
    fs.writeFileSync(path.join(dir, "orchestration", "manager-tick-core.md"), "code\n", "utf8");
    ffGit(dir, "add", "-A");
    ffGit(dir, "commit", "-q", "-m", "code touch orchestration (post-suite)");
    ffGit(dir, "checkout", "-q", "master");
    const events = path.join(st, "events.jsonl");
    const retries = path.join(st, "retries.jsonl");
    const r = spawnSync("bash", [FF_MERGE_SCRIPT, "--task", "gate-a", "--root", dir, ...ffCapture(st, "gate-a", suiteHead), "--lock-events", events, "--retry-record", retries], { encoding: "utf8" });
    assert.equal(r.status, 2, `a @static-object-covered delta must be refused by the gate (exit 2):\nstdout=${r.stdout}\nstderr=${r.stderr}`);
    assert.match(r.stderr, /suite 证书未满足/, "the refusal names the suite certificate");
    assert.ok(!fs.existsSync(events), "no lock events — the gate refused before acquiring the lock");
    assert.ok(!fs.existsSync(retries), "no retry record — this is a gate refusal, not an ff failure");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(st, { recursive: true, force: true });
  }
});
