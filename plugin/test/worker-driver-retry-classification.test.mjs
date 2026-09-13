// @test-group engine
// worker-driver-retry-classification.test.mjs — gap-fan-in-suite-red-with-no-attributable-test-still-
// redispatches-worker：suite 红但【归因不出任何失败测试文件】时，driver 的【后续动作】必须跟读数分叉。
//
// 缺陷：`insufficient-data-fallback`（判不出归因）与「已归因的实现缺陷」走【同一条】重派路径 ⇒
// 每轮烧一个完整 claude 会话，而那份 suite 日志里【没有 worker 能修的东西】（真因是 suite 调用契约/
// 基建）。实测（本仓库 worker-round.jsonl 全量 291 条判定）：insufficient-data-fallback 占 127 条（44%）。
// 硬规则 3b 的变体：一个【读不懂】的状态不得触发与「已读懂且判为缺陷」相同的动作。
//
// 本文件只测【判定与接线】；真实第三方项目上的端到端观测见任务 DoD 的验证记录（⛔ fixture 不算测量，
// 硬规则 4 推论三）。
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

import {
  judgeRetryExemption,
  decideExitedNotLandedAction,
  suiteLogContentHash,
  suiteLogBasenameFromOutcome,
  exitedNotLandedRecordsForTask,
  computeWorkerRoundRecord,
  defaultMechanicalSuiteCommand,
  RETRY_EXEMPTION_WINDOW_MS_DEFAULT,
  readTaskStatus,
  WORKER_OUTCOME_REL,
} from "../scripts/worker-driver.ts";
import {
  makeRoot,
  makeGitRoot,
  spawnResident,
  waitFor,
  readOutcomeLines,
  readRoundLines,
  writeTaskFile,
  rmSafe,
  REPO_ROOT,
} from "./helpers/worker-driver-harness.mjs";

// ── 夹具：真实的「归因不出」suite 日志（形状逐字取自第三方项目 quay-fleet 的两轮 fan-in 日志）──
// 关键性质：没有任何 `__PERFILE__ … passed=false` 行 ⇒ failingTestFilesFromSuiteLog = [] ⇒
// judgeRetryExemption 回退 insufficient-data-fallback（「日志里没有任何它能修的东西」）。
const UNATTRIBUTABLE_LOG = [
  "== quay-fleet test: 1 file(s) ==",
  "Could not find 'fleet-agent-sessions-transcript-endpoint'",
  "# tests 0",
  "# pass 0",
  "# fail 1",
  "# cancelled 0",
  "# suite red failed",
  "",
].join("\n");

// 另一份【同样归因不出，但内容不同】的日志（双向控制用：哈希判据必须能取假）。
const UNATTRIBUTABLE_LOG_B = UNATTRIBUTABLE_LOG.replace(
  "Could not find 'fleet-agent-sessions-transcript-endpoint'",
  "Could not find 'fleet-agent-sessions-screen-endpoint'",
);

// 可归因的 suite 日志（含 __PERFILE__ passed=false + 断言签名）——用来证「本改动不掐死正常重试」。
const ATTRIBUTABLE_LOG = [
  "__PERFILE__ duration_ms=10 plugin/test/some.test.mjs passed=false end_ms=1",
  "  AssertionError [ERR_ASSERTION]: probe must be alive",
  "",
].join("\n");

function writeSuiteLog(root, basename, text) {
  fs.mkdirSync(path.join(root, ".quay"), { recursive: true });
  fs.writeFileSync(path.join(root, ".quay", basename), text, "utf8");
  return basename;
}

/** 追加一条 suite-red exited-not-landed outcome（生产载体 worker-outcome.jsonl，driver 的历史来源）。 */
function appendSuiteRedOutcome(root, taskId, ts, suiteLogBasename) {
  fs.mkdirSync(path.join(root, ".quay"), { recursive: true });
  fs.appendFileSync(
    path.join(root, WORKER_OUTCOME_REL),
    JSON.stringify({
      ts, task: taskId, final_state: "exited-not-landed", run_id: `r-${ts}`, session_id: "s",
      mechanical_fan_in: { outcome: "red", step: "suite", suiteLog: suiteLogBasename },
    }) + "\n",
    "utf8",
  );
}

/** 一条 exited-not-landed outcome（step=suite，suiteLog 指向已写好的日志）。 */
function suiteRedOutcome(ts, suiteLogBasename) {
  return { ts, final_state: "exited-not-landed", mechanical_fan_in: { outcome: "red", step: "suite", suiteLog: suiteLogBasename } };
}

function writeTaskWithTouches(root, taskId, touches) {
  fs.mkdirSync(path.join(root, "tasks"), { recursive: true });
  fs.writeFileSync(
    path.join(root, "tasks", `${taskId}.md`),
    `---\nid: ${taskId}\nstatus: ready\n---\n\n## Proposal\n\nprose\n\n## Touches\n\n${touches.map((t) => `- ${t}`).join("\n")}\n`,
    "utf8",
  );
}

const NOW = Date.parse("2026-09-13T12:00:00.000Z");
const T0 = "2026-09-13T09:59:12.597Z"; // 真实 quay-fleet 第一轮
const T1 = "2026-09-13T10:05:41.985Z"; // 真实 quay-fleet 第二轮（日志与第一轮逐字节相同）

// ── AC1：归因不出的 suite 红 ⇒ 不重派，落 needs-human 终态；verdict 本身【仍然】如实记 ──────────

test("AC1 — 归因不出的 suite 红仍是 insufficient-data-fallback（读数如实，⛔ 不改判定名）", (t) => {
  const root = makeRoot("rcl-ac1-verdict");
  t.after(() => rmSafe(root));
  writeTaskWithTouches(root, "gap-a", ["packages/quay/src/serve-dashboard.ts"]);
  const log = writeSuiteLog(root, "fan-in-suite-gap-a.log", UNATTRIBUTABLE_LOG);

  const j = judgeRetryExemption(root, "gap-a", suiteRedOutcome(T0, log), { nowMs: NOW });
  assert.equal(j.verdict, "insufficient-data-fallback", "归因不出的判定名不变（读数诚实：driver 一直知道自己判不出）");
  assert.deepEqual(j.failingTestFiles, [], "从日志提取不出任何失败测试文件");
  assert.match(j.reason, /no failing test file extracted/, "理由逐字点名「提取不出失败测试文件」");
});

test("AC1（首次）— 归因不出且无历史 ⇒ 允许至多一次重试（⛔ 不是无条件停：瞬时时仍可重试）", (t) => {
  const root = makeRoot("rcl-ac1-first");
  t.after(() => rmSafe(root));
  writeTaskWithTouches(root, "gap-a", ["packages/quay/src/serve-dashboard.ts"]);
  const log = writeSuiteLog(root, "fan-in-suite-gap-a.log", UNATTRIBUTABLE_LOG);

  const outcome = suiteRedOutcome(T0, log);
  const j = judgeRetryExemption(root, "gap-a", outcome, { nowMs: NOW });
  const d = decideExitedNotLandedAction(root, "gap-a", outcome, j, { nowMs: NOW });
  assert.equal(d.kind, "count-and-retry", "首次归因不出 ⇒ 照常计数重派（至多一次重试）");
  assert.match(d.reason, /one bounded retry/, "理由点名「有界的一次重试」");
});

test("AC1（负控制，本任务要害）— 上一轮同为归因不出 ⇒ stop-terminal：不重派 + 记录判定与理由", (t) => {
  const root = makeRoot("rcl-ac1-stop");
  t.after(() => rmSafe(root));
  writeTaskWithTouches(root, "gap-a", ["packages/quay/src/serve-dashboard.ts"]);
  const logA = writeSuiteLog(root, "fan-in-suite-gap-a-1.log", UNATTRIBUTABLE_LOG);
  writeSuiteLog(root, "fan-in-suite-gap-a-2.log", UNATTRIBUTABLE_LOG_B); // 内容不同 ⇒ 停因是「有界重试用尽」而非哈希
  appendSuiteRedOutcome(root, "gap-a", T0, logA); // 上一轮（真实载体）

  const outcome = suiteRedOutcome(T1, "fan-in-suite-gap-a-2.log");
  const j = judgeRetryExemption(root, "gap-a", outcome, { nowMs: NOW });
  const d = decideExitedNotLandedAction(root, "gap-a", outcome, j, { nowMs: NOW });
  // 改前：advanceRetryCap 记 1 (< 3) ⇒ 照常重派 ⇒ 第 3、4 轮继续烧会话（实测连续两轮日志逐字节相同）。
  assert.equal(d.kind, "stop-terminal", "已有一次归因不出的重试 ⇒ 停（⛔ 不再拿新会话撞同一堵墙）");
  assert.match(d.reason, /could not be attributed/, "理由说清「归因不出」");
  assert.match(d.reason, /infra\/contract suspected/, "理由点名基建/契约疑似（人能看懂的终态）");
  assert.notEqual(d.kind, "count-and-retry", "与「已归因的实现缺陷」不共用同一动作");
  assert.equal(d.suiteLogHash, suiteLogContentHash(root, "fan-in-suite-gap-a-2.log"), "载体带日志内容哈希（可核）");
});

// ── AC2：日志内容哈希相同 ⇒ 第 3 轮不得发生（比启发式硬）；双向控制：不同 ⇒ 不停于该判据 ────────

test("AC2（能取假）— 连续两轮 suite 日志内容哈希相同 ⇒ 该判据发火（第 3 轮不发生）", (t) => {
  const root = makeRoot("rcl-ac2-hash");
  t.after(() => rmSafe(root));
  writeTaskWithTouches(root, "gap-a", ["packages/quay/src/serve-dashboard.ts"]);
  // 两份【不同文件名、内容逐字节相同】的日志——正是 quay-fleet 两轮 fan-in（152 字节，diff 为空）。
  const first = writeSuiteLog(root, "fan-in-suite~1.log", UNATTRIBUTABLE_LOG);
  const second = writeSuiteLog(root, "fan-in-suite~2.log", UNATTRIBUTABLE_LOG);
  assert.equal(
    suiteLogContentHash(root, first), suiteLogContentHash(root, second),
    "同内容 ⇒ 同哈希（判据的前置）",
  );
  appendSuiteRedOutcome(root, "gap-a", T0, first);

  const outcome = suiteRedOutcome(T1, second);
  assert.equal(suiteLogBasenameFromOutcome(outcome), second, "suite 日志 basename 从 outcome 投影（哈希判据的输入可核）");
  const j = judgeRetryExemption(root, "gap-a", outcome, { nowMs: NOW });
  const d = decideExitedNotLandedAction(root, "gap-a", outcome, j, { nowMs: NOW });
  assert.equal(d.kind, "stop-terminal", "内容逐字节相同 ⇒ 重试不可能改变结果 ⇒ 停");
  assert.match(d.reason, /byte-identical/, "理由点名「与上一轮逐字节相同」+ 摘要哈希");
  assert.match(d.reason, /sha256 [0-9a-f]{12}/, "摘要哈希可核（⛔ 不是一句无据的断言）");
});

test("AC2（双向控制）— 日志内容【不同】⇒ 哈希判据不发火（⛔ 不停在这条判据上；正常重试不被掐死）", (t) => {
  const root = makeRoot("rcl-ac2-falsify");
  t.after(() => rmSafe(root));
  writeTaskWithTouches(root, "gap-a", ["packages/quay/src/serve-dashboard.ts"]);
  const first = writeSuiteLog(root, "fan-in-suite~1.log", UNATTRIBUTABLE_LOG);
  writeSuiteLog(root, "fan-in-suite~2.log", UNATTRIBUTABLE_LOG_B); // 【不同】内容
  appendSuiteRedOutcome(root, "gap-a", T0, first);

  const outcome = suiteRedOutcome(T1, "fan-in-suite~2.log");
  const j = judgeRetryExemption(root, "gap-a", outcome, { nowMs: NOW });
  const d = decideExitedNotLandedAction(root, "gap-a", outcome, j, { nowMs: NOW });
  // 仍停在【有界重试】这条判据上（第二次归因不出），但【不】停在这条哈希判据上——哈希判据能取假。
  assert.doesNotMatch(d.reason, /byte-identical/, "内容不同 ⇒ 哈希判据必须不发火（否则它是恒真量，硬规则 4）");
  assert.match(d.reason, /bounded to at most one retry/, "停因是「有界重试用尽」，不是「内容相同」");
});

test("AC2（负控制）— 已归因的实现缺陷即使日志逐字节相同 ⇒ 仍走既有计数重派路径（⛔ 不误掐）", (t) => {
  const root = makeRoot("rcl-ac2-own");
  t.after(() => rmSafe(root));
  // 失败测试文件落在本任务 Touches ⇒ own-defect-counted。
  writeTaskWithTouches(root, "gap-a", ["plugin/test/some.test.mjs"]);
  const first = writeSuiteLog(root, "fan-in-suite~1.log", ATTRIBUTABLE_LOG);
  writeSuiteLog(root, "fan-in-suite~2.log", ATTRIBUTABLE_LOG);
  appendSuiteRedOutcome(root, "gap-a", T0, first);

  const outcome = suiteRedOutcome(T1, "fan-in-suite~2.log");
  const j = judgeRetryExemption(root, "gap-a", outcome, { nowMs: NOW });
  assert.equal(j.verdict, "own-defect-counted", "失败测试落在自身 Touches ⇒ 自身缺陷");
  const d = decideExitedNotLandedAction(root, "gap-a", outcome, j, { nowMs: NOW });
  assert.equal(d.kind, "count-and-retry", "自身缺陷照常计数重派（⛔ 本改动不改变这条路径）");
});

// ── AC3：两种 verdict 在【后续动作】上可区分（⛔ 不共用同一条重派分支）────────────────────────────

test("AC3（同一历史、两种 verdict ⇒ 两种动作）— insufficient-data-fallback ⇒ stop-terminal，own-defect ⇒ count-and-retry", (t) => {
  const root = makeRoot("rcl-ac3");
  t.after(() => rmSafe(root));
  writeTaskWithTouches(root, "gap-a", ["packages/quay/src/serve-dashboard.ts"]);
  const first = writeSuiteLog(root, "fan-in-suite~1.log", UNATTRIBUTABLE_LOG);
  const second = writeSuiteLog(root, "fan-in-suite~2.log", UNATTRIBUTABLE_LOG);
  appendSuiteRedOutcome(root, "gap-a", T0, first);
  const outcome = suiteRedOutcome(T1, second);

  // 同一份历史（同一条 outcome + 同一份日志），只换 verdict 的【来源】：归因得出 vs 归因不出。
  const unattributable = judgeRetryExemption(root, "gap-a", outcome, { nowMs: NOW });
  const attributed = { ...unattributable, verdict: "own-defect-counted", reason: "failing test x is in this task's Touches/diff" };
  const dA = decideExitedNotLandedAction(root, "gap-a", outcome, unattributable, { nowMs: NOW });
  const dB = decideExitedNotLandedAction(root, "gap-a", outcome, attributed, { nowMs: NOW });

  assert.notEqual(dA.kind, dB.kind, "AC3：两 verdict 的后续动作取值不同（⛔ 不共用重派分支）");
  assert.equal(dA.kind, "stop-terminal", "判不出 ⇒ 停");
  assert.equal(dB.kind, "count-and-retry", "已归因 ⇒ 既有计数重派");

  // 静态半边：调用点必须按 kind 分叉（⛔ 不是把 stop 塞进 advanceRetryCap 的同一分支）。
  const src = fs.readFileSync(path.join(REPO_ROOT, "plugin", "scripts", "worker-driver.ts"), "utf8");
  assert.match(src, /if \(decision\.kind === "stop-terminal"\)/, "调用点按 kind 分叉（stop-terminal 独立分支）");
  assert.match(src, /\} else if \(exemption\.verdict !== "unrelated-flaky-exempt"\) \{/, "既有计数路径保留在 else 侧（两 verdict 不共用分支）");
});

// ── 载体：round 记录带判定三键（kind/verdict/reason）＋ 哈希，⛔ 不只在 json 事件里 ─────────────

test("载体 — round 记录带 exited_not_landed_stops（kind 可区分），⛔ 不只在 json 事件里", () => {
  const rec = computeWorkerRoundRecord({
    round: 1, runId: "r", pid: 1, at: "t", action: "idle", inFlight: 0, pool: 0, stopReason: null,
    coldStartInflight: [],
    exitedNotLandedStops: [
      { task: "gap-a", kind: "stop-terminal", verdict: "insufficient-data-fallback", reason: "why", suiteLogHash: "abc" },
      { task: "gap-b", kind: "count-and-retry", verdict: "own-defect-counted", reason: "why2", suiteLogHash: null },
    ],
  });
  assert.equal(rec.exited_not_landed_stops.length, 2, "本轮判定全部入载体（生产可观测）");
  assert.equal(rec.exited_not_landed_stops[0].kind, "stop-terminal", "kind 在 round 记录里可区分");
  assert.notEqual(rec.exited_not_landed_stops[0].kind, rec.exited_not_landed_stops[1].kind, "两取值互异（硬规则 3b）");
  assert.equal(rec.exited_not_landed_stops[0].suiteLogHash, "abc", "哈希入载体（可复核「内容相同」的判定）");
});

// ── 窗口：48h 外的一次归因不出不算「已有一次重试」（⛔ 陈旧历史不得静默停掉今天的新失败）──────

test("窗口 — 48h 外的归因不出不触发停止（窗口外历史不进判定）", (t) => {
  const root = makeRoot("rcl-window");
  t.after(() => rmSafe(root));
  writeTaskWithTouches(root, "gap-a", ["packages/quay/src/serve-dashboard.ts"]);
  const old = writeSuiteLog(root, "fan-in-suite-old.log", UNATTRIBUTABLE_LOG);
  const now = writeSuiteLog(root, "fan-in-suite-now.log", UNATTRIBUTABLE_LOG);
  // 5 天前的一次归因不出（窗口 = 48h）。
  const oldTs = new Date(NOW - 5 * 24 * 3600 * 1000).toISOString();
  appendSuiteRedOutcome(root, "gap-a", oldTs, old);

  const windowMs = RETRY_EXEMPTION_WINDOW_MS_DEFAULT;
  const priors = exitedNotLandedRecordsForTask(root, "gap-a", windowMs, NOW);
  assert.equal(priors.length, 0, "窗口外的历史不进候选（48h 前的失败不该让今天的新失败直接停）");

  const outcome = suiteRedOutcome(T1, now);
  const j = judgeRetryExemption(root, "gap-a", outcome, { nowMs: NOW });
  const d = decideExitedNotLandedAction(root, "gap-a", outcome, j, { nowMs: NOW });
  assert.equal(d.kind, "count-and-retry", "窗口外历史 ⇒ 仍按首次处理（有界的一次重试）");
});

// ── AC1/AC2 集成：真实 driver 常驻环上「归因不出 ⇒ 重派停在 2（不是撞 3 次上限）」───────────────
// 负控制（改前红）：改动前同一夹具派发 3 次（max-retries 缺省 3）；改动后停在 2。
// 夹具形态：worker exit 0 但不落地（status 仍 ready）⇒ 无 worktree ⇒ 机械 fan-in 不 spawn ⇒
// outcome 无 mechanical_fan_in ⇒ judgeRetryExemption 落 insufficient-data-fallback（与实测同形）。

test("AC1/AC2（集成，负控制）— 归因不出的重派停在 2：任务进 needs-human 终态，理由是可读的「基建/契约疑似」", async (t) => {
  const root = makeGitRoot("rcl-integration");
  writeTaskFile(root, "gap-stop", "ready");
  const drv = spawnResident(root, [
    "--ready-pool-cmd", "node -e console.log(JSON.stringify({ready:['gap-stop'],pool:1}))",
    "--selector-cmd", "node -e console.log('gap-stop\\x20unattributable-red')",
    "--resource-gate-cmd", "node -e process.exit(0)",
    "--worker-cmd-exact", "node -e process.exit(0)",
    "--interval", "20",
  ]);
  t.after(() => drv.stop());
  t.after(() => rmSafe(root));

  await waitFor(() => readTaskStatus(root, "gap-stop") === "needs-human", 30000);
  // 终态可读：status 翻转 + ## Needs-Human 注记点名「基建/契约疑似」（⛔ 不是让 worker 再试一次）。
  assert.equal(readTaskStatus(root, "gap-stop"), "needs-human", "归因不出 ⇒ 任务进 needs-human 终态");
  const body = fs.readFileSync(path.join(root, "tasks", "gap-stop.md"), "utf8");
  assert.match(body, /## Needs-Human/, "可 grep 的终态注记");
  assert.match(body, /基建\/契约疑似/, "理由点名基建/契约疑似（人能看懂，⛔ 不是「重试上限」那句）");
  assert.match(body, /停止重派/, "理由明说是停止重派");

  // 重派计数停在 2（改前：撞 max-retries=3 派满 3 次，且第 2/3 次日志逐字节相同）。
  await waitFor(() => drv.events().filter((e) => e.event === "selector-picked").length >= 2, 30000);
  await new Promise((r) => setTimeout(r, 400));
  const picks = drv.events().filter((e) => e.event === "selector-picked");
  assert.equal(picks.length, 2, "AC2：重派计数停在 2（第 3 轮不发生）");
  assert.equal(readOutcomeLines(root).length, 2, "恰两条 outcome 记录（无第 3 次尝试）");

  // 生产载体：round 记录带判定（kind 可区分），且第二次的判定是 stop-terminal。
  const rounds = readRoundLines(root);
  const stops = rounds.flatMap((r) => r.exited_not_landed_stops ?? []);
  assert.ok(stops.length >= 2, `round 记录携带判定（生产载体）：${JSON.stringify(stops)}`);
  assert.equal(stops[0].kind, "count-and-retry", "第 1 次归因不出 ⇒ 允许一次重试（判定入载体）");
  assert.equal(stops[1].kind, "stop-terminal", "第 2 次归因不出 ⇒ 停（判定入载体）");
});

// ── AC4：loop.test_command 契约落在 adopter 可见文档上，且由一条静态判据钉住不漂移 ──────────────

test("AC4 — adopter 可见文档逐字列出 quay 附加的内部 flag 集合（与 worker-driver.ts suite 步一致，静态钉住）", () => {
  const docPath = path.join(REPO_ROOT, "plugin", "skills", "init", "SKILL.md");
  const doc = fs.readFileSync(docPath, "utf8");
  assert.match(doc, /^## `loop\.test_command` contract/m, "adopter 可见文档（quay-init skill）里存在契约段");

  // 判据两边都由机械量派生，⛔ 不写「已知的 flag 清单」第二份副本：
  //   左边 = worker-driver.ts suite 步真实 argv 里、传给 full-suite-runner 的 flag（真值来源）。
  const argv = defaultMechanicalSuiteCommand({
    task: "gap-x",
    worktree: REPO_ROOT, // 本仓库有 scripts/test.sh ⇒ suite 步走 full-suite-runner（第三方退化的另一半见 worker-driver.test.mjs）
    root: REPO_ROOT,
    suiteLogFile: "/tmp/suite.log",
    runId: "mf-run-1",
  });
  const runnerIdx = argv.findIndex((a) => String(a).includes("full-suite-runner.ts"));
  assert.ok(runnerIdx > 0, `本仓库（有 scripts/test.sh）⇒ suite 步走 full-suite-runner：${argv.join(" ")}`);
  const runnerFlags = argv.slice(runnerIdx + 1).filter((a) => String(a).startsWith("--"));
  assert.ok(runnerFlags.length >= 6, `suite 步至少传 6 个内部 flag：${runnerFlags.join(" ")}`);

  for (const flag of runnerFlags) {
    assert.ok(
      doc.includes(`\`${flag}\``),
      `AC4：文档必须逐字列出 quay 附加的内部 flag ${flag}（否则 doc 与 code 双副本漂移）`,
    );
  }
  // adopter 的容忍义务必须写出来（正是 quay-fleet 那三轮空烧的根因：只 shift 掉 flag、值留给下一轮）。
  assert.match(doc, /value-taking flag together with its value/, "文档写明「带值 flag 的【值】必须一起消费」这条容忍义务");
  assert.match(doc, /positional test-file argument/, "文档写明「不得把 flag 的值当成位置参数/测试文件」");
  assert.match(doc, /not a skip/, "文档写明「位置参数不存在是错误而不是跳过」（否则绿灯不可取假）");
});

test("AC4（模板半边）— quay-init 真实落盘生成的 .quay/config.yml 带该防御注记（⛔ 不是只在散文里）", (t) => {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), "qi-contract-"));
  t.after(() => rmSafe(ws));
  const qi = path.join(REPO_ROOT, "plugin", "scripts", "quay-init.sh");
  const r = spawnSync("bash", [
    qi, "--root", ws, "--plugin-root", path.join(REPO_ROOT, "plugin"),
    "--test-command", "scripts/test.sh",
  ], { encoding: "utf8" });
  assert.equal(r.status, 0, `quay-init 真实落盘必须成功：${r.stdout}\n${r.stderr}`);
  const cfg = fs.readFileSync(path.join(ws, ".quay", "config.yml"), "utf8");
  assert.match(cfg, /^loop:$/m, "生成的 config 有 loop: 节");
  // 与文档同一条义务，逐字可核（不是「大致写了个提示」）。
  assert.match(cfg, /consume such a flag together with its VALUE/, "生成的示例注记写明「带值 flag 的值必须一起消费」");
  assert.match(cfg, /positional test-file argument/, "生成的示例注记写明「不得当成位置参数」");
  assert.match(cfg, /plugin\/skills\/init\/SKILL\.md/, "生成的示例注记指向正本文档（单一真相源，⛔ 不复制整段契约）");
  assert.match(cfg, /test_command: scripts\/test\.sh/, "loop.test_command 照常写入（注记不破坏配置）");
});
