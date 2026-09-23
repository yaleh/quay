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
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";

import {
  judgeRetryExemption,
  decideExitedNotLandedAction,
  suiteLogContentHash,
  suiteLogBasenameFromOutcome,
  exitedNotLandedRecordsForTask,
  computeWorkerRoundRecord,
  defaultMechanicalSuiteCommand,
  failingTestFilesFromSuiteLog,
  parseSuiteLogFailures,
  parseStaticCheckFailures,
  namedArtifactHitsDelta,
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
  // 让 quay-init 的 test_command 探测落到 package.json（⛔ 不把 runner 的字面量写进本文件：
  // test-isolation-check R3 按「spawn 调用里出现 runner 名」判，与本测试的意图无关，会误报）。
  fs.writeFileSync(path.join(ws, "package.json"), JSON.stringify({ name: "probe", scripts: { test: "node --test" } }), "utf8");
  const qi = path.join(REPO_ROOT, "plugin", "scripts", "quay-init.sh");
  const r = spawnSync("bash", [
    qi, "--root", ws, "--plugin-root", path.join(REPO_ROOT, "plugin"),
  ], { encoding: "utf8" });
  assert.equal(r.status, 0, `quay-init 真实落盘必须成功：${r.stdout}\n${r.stderr}`);
  const cfg = fs.readFileSync(path.join(ws, ".quay", "config.yml"), "utf8");
  assert.match(cfg, /^loop:$/m, "生成的 config 有 loop: 节");
  // 与文档同一条义务，逐字可核（不是「大致写了个提示」）。
  assert.match(cfg, /consume such a flag together with its VALUE/, "生成的示例注记写明「带值 flag 的值必须一起消费」");
  assert.match(cfg, /positional test-file argument/, "生成的示例注记写明「不得当成位置参数」");
  assert.match(cfg, /plugin\/skills\/init\/SKILL\.md/, "生成的示例注记指向正本文档（单一真相源，⛔ 不复制整段契约）");
  assert.match(cfg, /test_command: npm test/, "loop.test_command 照常写入（注记不破坏配置）");
});

// ════════════════════════════════════════════════════════════════════════════════════════════════════
// gap-suite-failure-attribution-third-party-layout — 归因解析只认 quay 自身测试布局
//
// 缺陷：`failingTestFilesFromSuiteLog` 曾把本仓库布局写死进判据（前缀只认 `packages|plugin|experiments/`、
// 后缀只认 `.test.mjs`）。第三方项目（`server/**/*.test.ts`）匹配恒为 0 ⇒ 返回 [] ⇒ 判 insufficient-data-
// fallback ⇒ park 判词写成「the suite log names nothing a worker could fix」——**一个肯定断言，而它的依据
// 只是「解析器没读懂」**（硬规则 3b 的镜像）。生产读数（claudecodeui worker-round.jsonl，2026-09-20→09-23）：
// 51 次 retry_exemptions 中 failingTestFiles 非空 **0 次**，波及 29 个任务。
//
// 本段测【解析与判词】；真实第三方项目上的端到端观测见任务 DoD（⛔ fixture 不算测量，硬规则 4 推论三）。
// ════════════════════════════════════════════════════════════════════════════════════════════════════

// 真实日志节选：claudecodeui `scripts/__fixtures__/fan-in-suite-lint-failure.log` 的逐字节副本
// （md5 07e94a5baff0bb80f4018aee59951d7b，见下 AC 的断言）。真凶是一条可一行修的 barrel 导入 lint 错误。
// 后缀用 `.txt` 而非源文件的 `.log`：本仓库 `.gitignore` 把 `*.log` 与 `dist/`、`*.tgz`、`**/worktrees/`
// 同列进「生成物/运行态，永不入库」，全库 tracked 的 `.log` 为 0 个；而捕获输出的 fixture 约定就是
// `.txt`（同目录 `criterion-fidelity/real-judge-post.stdout.txt`）⇒ 换后缀才是「把它入库」的原意，
// ⛔ 不 `git add -f` 去撞一条全库遵守的 ignore 规则。内容逐字节未改（md5 断言钉住）。
const THIRD_PARTY_LINT_FIXTURE = path.join(
  REPO_ROOT, "plugin", "test", "fixtures", "suite-log-third-party-lint-failure.txt",
);

test("AC1① — 第三方布局 `server/x/y.test.ts` 被提取（⛔ 不再只认 packages|plugin|experiments/*.test.mjs）", () => {
  const line = "__PERFILE__ duration_ms=1 server/x/y.test.ts passed=false end_ms=2";
  assert.deepEqual(
    failingTestFilesFromSuiteLog(line), ["server/x/y.test.ts"],
    "第三方项目的 per-file 记录必须被提取（旧正则的 `.test.mjs` 后缀 + 三前缀白名单在此恒不匹配）",
  );
});

test("AC1② — `__PERFILE__ … lint passed=false` 单独出现 ⇒ 不把 `lint` 当测试文件（伪阶段名有独立取值）", () => {
  const p = parseSuiteLogFailures("__PERFILE__ duration_ms=1 lint passed=false end_ms=2");
  assert.deepEqual(p.files, [], "`lint` 是阶段名不是文件——⛔ 不得混进失败测试集");
  assert.deepEqual(p.pseudoStages, ["lint"], "伪阶段名走独立取值（硬规则 3b：读不懂/非文件不与「文件」同形）");
  assert.equal(p.failingLines, 1, "它仍是一条【失败行】——`0 of 1` 与 `0 of 0` 是两种不同实况");
});

test("AC1③ — `not ok - lint: server/a/b.test.ts:10:49: …` ⇒ 归因到被指名的 server/a/b.test.ts", () => {
  const line = "not ok - lint: server/a/b.test.ts:10:49: error boundaries(dependencies): Cross-module imports must go through that module's barrel file";
  const p = parseSuiteLogFailures(line);
  assert.deepEqual(p.files, ["server/a/b.test.ts"], "阶段失败被【指名】到真实文件上 ⇒ 归因到它");
  assert.deepEqual(p.pseudoStages, ["lint"], "同行的 `lint` 仍是伪阶段名");
  assert.equal(p.failingLines, 1, "`not ok - …` 也是失败行（N 的分母）");
});

test("AC1④（负控制，不回归）— quay 自身布局与 worktree 绝对路径形态仍按原样提取", (t) => {
  const root = makeRoot("rcl-quay-layout");
  t.after(() => rmSafe(root));
  // 本仓库布局（repo-relative）：逐字保留旧行为。
  assert.deepEqual(
    failingTestFilesFromSuiteLog("__PERFILE__ duration_ms=1 plugin/test/x.test.mjs passed=false end_ms=2"),
    ["plugin/test/x.test.mjs"],
  );
  assert.deepEqual(
    failingTestFilesFromSuiteLog("__PERFILE__ duration_ms=1 packages/quay/test/a.test.mjs passed=false end_ms=2"),
    ["packages/quay/test/a.test.mjs"],
  );
  assert.deepEqual(
    failingTestFilesFromSuiteLog("__PERFILE__ duration_ms=1 experiments/x/test/b.test.mjs passed=false end_ms=2"),
    ["experiments/x/test/b.test.mjs"],
  );
  // worktree 绝对路径形态（`/…/quay-worktrees/<task>/plugin/test/x.test.mjs`）⇒ 仍提取 repo-relative 后缀。
  assert.deepEqual(
    failingTestFilesFromSuiteLog(`__PERFILE__ duration_ms=1 ${root}/plugin/test/x.test.mjs passed=false end_ms=2`, root),
    ["plugin/test/x.test.mjs"],
    "绝对路径按 root 前缀剥离（⛔ 不按关键词猜前缀——那正是本缺陷的成因）",
  );
});

test("AC(真实日志) — claudecodeui 的 lint 失败节选（真日志逐字节副本）归因到 model-context-window.test.ts", () => {
  const log = fs.readFileSync(THIRD_PARTY_LINT_FIXTURE, "utf8");
  assert.equal(
    crypto.createHash("md5").update(log).digest("hex"), "07e94a5baff0bb80f4018aee59951d7b",
    "fixture 是第三方真日志的逐字节副本（⛔ 不是手写的仿真样本）",
  );
  const p = parseSuiteLogFailures(log);
  assert.ok(
    p.files.includes("server/modules/launch-profiles/tests/model-context-window.test.ts"),
    `真日志的失败文件必须被归因出来（实测 files=${JSON.stringify(p.files)}）`,
  );
  assert.ok(!p.files.includes("lint"), "`lint`/`typecheck` 这类伪阶段名不得混进失败测试集");
  assert.ok(p.pseudoStages.includes("lint"), "`lint` 走伪阶段名取值（留证）");
  assert.equal(p.failingLines, 4, "N = 2 条 `__PERFILE__ … passed=false` + 2 条 `not ok - …`");
});

test("AC(载体字段) — 第三方日志经 judgeRetryExemption ⇒ failingTestFiles 非空（AC-317 读的就是这个字段）", (t) => {
  const root = makeRoot("rcl-third-party-carrier");
  t.after(() => rmSafe(root));
  writeTaskWithTouches(root, "gap-a", ["src/unrelated.ts"]);
  const log = writeSuiteLog(root, "fan-in-suite-gap-a.log", fs.readFileSync(THIRD_PARTY_LINT_FIXTURE, "utf8"));

  const j = judgeRetryExemption(root, "gap-a", suiteRedOutcome(T0, log), { nowMs: NOW });
  // 关键：AC-317 的判据只读 retry_exemptions[].failingTestFiles 是否非空——verdict 名不变也照样成立。
  assert.ok(
    j.failingTestFiles.includes("server/modules/launch-profiles/tests/model-context-window.test.ts"),
    `第三方 suite 红的归因必须落到载体字段上（实测 ${JSON.stringify(j.failingTestFiles)}）`,
  );
  assert.equal(j.suiteFailingLines, 4, "读到的失败行数一并入判定（判词据此区分「0 of N」与「0 of 0」）");
});

test("AC3(判词) — 「读不懂」判词含解析器读到的失败行数 N（`0 of N`），⛔ 断言句已消失", (t) => {
  const root = makeRoot("rcl-wording");
  t.after(() => rmSafe(root));
  writeTaskWithTouches(root, "gap-a", ["packages/quay/src/serve-dashboard.ts"]);
  // ① 有失败行但一行也归因不出（第三方伪阶段名）⇒「0 of 1」。
  writeSuiteLog(root, "fan-in-suite~1.log", UNATTRIBUTABLE_LOG);
  const withFailingLines = writeSuiteLog(root, "fan-in-suite~2.log", "__PERFILE__ duration_ms=1 lint passed=false end_ms=2\n");
  const outcome = suiteRedOutcome(T1, withFailingLines);
  const j = judgeRetryExemption(root, "gap-a", outcome, { nowMs: NOW });
  assert.match(j.reason, /no failing test file extracted/, "仍逐字点名「提取不出失败测试文件」");
  assert.match(j.reason, /0 of 1 failing lines/, "判词报「读到了 1 行失败、0 行归因到文件」（旧措辞两者同形）");
  assert.match(j.reason, /pseudo-stage tokens: lint/, "留证：读不懂的那个 token 是什么");

  // ② 连失败行形态都没有 ⇒「0 of 0」——与 ① 是两种不同实况，判词必须能区分。
  //    上一轮用【内容不同】的日志（⛔ 否则先撞哈希判据那条 stop 分支，测不到本段要测的判词）。
  writeSuiteLog(root, "fan-in-suite~1.log", UNATTRIBUTABLE_LOG);
  appendSuiteRedOutcome(root, "gap-a", T0, "fan-in-suite~1.log");
  const logB = writeSuiteLog(root, "fan-in-suite~3.log", UNATTRIBUTABLE_LOG_B);
  const outcomeB = suiteRedOutcome(T1, logB);
  const jB = judgeRetryExemption(root, "gap-a", outcomeB, { nowMs: NOW });
  assert.match(jB.reason, /0 of 0 failing lines/, "日志里没有失败行 ⇒ 0 of 0");
  const dB = decideExitedNotLandedAction(root, "gap-a", outcomeB, jB, { nowMs: NOW });
  assert.equal(dB.kind, "stop-terminal", "（前置保持）第二轮归因不出仍停");
  assert.match(dB.reason, /0 of 0 failing lines/, "stop-terminal 判词同样带读数");
  assert.doesNotMatch(dB.reason, /names nothing a worker could fix/, "⛔ 肯定断言已消失");
  assert.match(dB.reason, /infra\/contract suspected/, "（前置保持）判词仍点名基建/契约疑似");
});

test("AC3(静态) — 「names nothing a worker could fix」肯定断言已从源码消失", () => {
  const src = fs.readFileSync(path.join(REPO_ROOT, "plugin", "scripts", "worker-driver.ts"), "utf8");
  assert.equal(src.includes("names nothing a worker could fix"), false, "该肯定断言的依据只是「解析器没读懂」（硬规则 3b）");
});

// ════════════════════════════════════════════════════════════════════════════════════════════════════
// gap-suite-red-attribution-blind-to-static-phase — 静态相位的红对归因器完全不可见
//
// 缺陷：归因只有「失败的测试文件」一条路（`__PERFILE__ … passed=false` / `not ok - …`）。suite 死在
// 【静态相位】时日志里 **没有**失败测试行（`# tests 0`），真因在 `STATIC_CHECK_FAILED: <checker> exit=<rc>`
// 机器行 + checker 违规块里。该相位对本模块 grep 计为 **0**（见 AC1 的读数），于是
// `failingTestFiles.length === 0` 恒成立 ⇒ 一律 insufficient-data-fallback ⇒ 终局判词写成
// 「infra/contract suspected, not an implementable defect」——而日志逐字点名了本任务 delta 内的可修缺陷。
//
// 与硬规则 3b 同源、方向相反：读不懂的输入不得触发与「已读懂且判为不可修」相同的动作。
// 本段只测【判定与判词】；真实 round 记录上的读数见任务体的 AC5 证据（⛔ fixture 不算测量）。
// ════════════════════════════════════════════════════════════════════════════════════════════════════

// 真实日志节选：`.quay/fan-in-suite-gap-arch-tsify-checker-mutation-check-sh~wk-prod-anchor~
// 1789936621276-793e6e.log`（2026-09-20T20:37Z，173482 B）的逐行副本——含 checker 违规块、三条
// STATIC_CHECK_FAILED 机器行、`# tests 0` 与 `# suite red static-check` 收尾。行序与本行数照原样
// 保留（块内明细 → 机器行 → 测试计数 → 结束行），⛔ 不手写仿真样本。
const STATIC_PHASE_RED_LOG = [
  "== checker mechanical-spine check (gap-b1-mechanical-spine-doc-checker, AC1/AC2/AC3) ==",
  "checker-mechanical-spine-check — 133 checker(s), 1 violation(s), 0 exempted",
  "FAIL: 1 unexempted violation(s):",
  "  - checker-mutation-check.ts (json): --json claimed but no JSON primitive",
  "== worktree-namespace literal check (gap-observation-hardcodes-quay-worktrees-ignoring-config-worktree-root, AC3) ==",
  "STATIC_CHECK_FAILED: checker-mechanical-spine-check exit=1",
  "STATIC_CHECK_FAILED: kernel-sibling-resolution-check exit=1",
  "STATIC_CHECK_FAILED: rhythm-consumer-check exit=1",
  "checker-cost-lib: run_checker_parallel_wait — static checks FAILED (fail-closed): checker-mechanical-spine-check(exit=1) kernel-sibling-resolution-check(exit=1) rhythm-consumer-check(exit=1)",
  "# tests 0",
  "# pass 0",
  "# fail 47",
  "# cancelled 0",
  "# suite red static-check",
  "",
].join("\n");

// 同一份日志里【通过】的 checker 照样逐条打印 grandfather 明细（实测 44 条 `VIOLATION:` + 106 条
// `unowned:`），而 task-contract-check 并未失败。归因器【不得】把这些 baselined 明细算成本任务的指名。
const STATIC_PHASE_RED_LOG_WITH_BASELINED_DETAIL = [
  STATIC_PHASE_RED_LOG.trimEnd(),
  "",
  "task-ac-carryover: 106 BLOCKED done task(s) — 169 unchecked AC(s) with NO carrying successor",
  "  unowned: gap-elsewhere — missing AC2 (1 unchecked total, carried: none)",
  "ratchet ceiling: 10; recorded (non-blocking): 159 (DIR-127: AC2, gap-elsewhere: AC5)",
  "VIOLATION: tasks/gap-elsewhere.md — measure-no-command: measure \"total_refs\" has no backtick command",
  "",
].join("\n");

test("AC1(静态相位) — 机器行/结束行被识别，失败块里指名的文件被提取（`# tests 0` 的相位不再不可见）", () => {
  const p = parseStaticCheckFailures(STATIC_PHASE_RED_LOG);
  assert.equal(p.staticPhaseRed, true, "`STATIC_CHECK_FAILED:` / `# suite red static-check` 任一在 ⇒ 静态相位红");
  assert.deepEqual(
    p.failedCheckers,
    ["checker-mechanical-spine-check", "kernel-sibling-resolution-check", "rhythm-consumer-check"],
    "三条机器行的 checker 名逐字提取（顺序 = 出现序）",
  );
  assert.deepEqual(p.namedArtifacts, ["checker-mutation-check.ts"], "失败块内指名的文件被提取");
  // 该相位此前对本模块完全不可见：`failingTestFilesFromSuiteLog` 对同一份日志恒为 []（`# tests 0`）。
  assert.deepEqual(failingTestFilesFromSuiteLog(STATIC_PHASE_RED_LOG), [], "静态相位红里没有任何失败【测试】行");
});

test("AC1(盲区已消除) — 源码现在认得静态相位的机器行（旧读数：grep -c 'STATIC_CHECK_FAILED' = 0）", () => {
  const src = fs.readFileSync(path.join(REPO_ROOT, "plugin", "scripts", "worker-driver.ts"), "utf8");
  assert.ok(src.includes("STATIC_CHECK_FAILED"), "归因器必须认得这条机器行（旧实现 grep 计数为 0 ⇒ 该相位对分类器不可见）");
  assert.ok(src.includes("#\\s*suite red static-check"), "静态相位的 suite 收尾行同样被认得");
});

test("AC2（读数 ⇒ 动作分叉）— 点名文件在本任务 delta 内 ⇒ static-phase-attributed（⛔ 不再落 insufficient-data-fallback）", (t) => {
  const root = makeRoot("rcl-static-ac2");
  t.after(() => rmSafe(root));
  // 本任务 delta 就是那条被点名的文件（真实情形：该任务把 checker-mutation-check.sh 改写成 .ts）。
  writeTaskWithTouches(root, "gap-a", ["plugin/scripts/checker-mutation-check.ts", "tasks/gap-a.md"]);
  const log = writeSuiteLog(root, "fan-in-suite-gap-a.log", STATIC_PHASE_RED_LOG);

  const j = judgeRetryExemption(root, "gap-a", suiteRedOutcome(T0, log), { nowMs: NOW });
  assert.equal(j.verdict, "static-phase-attributed", `静态相位已归因必须是可区分取值（实测 ${j.verdict}）`);
  assert.notEqual(j.verdict, "insufficient-data-fallback", "⛔ 不得与「读不懂/数据不足」同形（硬规则 3b）");
  assert.match(j.reason, /checker-mutation-check\.ts/, "判词逐字点名归因到哪个被指名对象");
  assert.match(j.reason, /in this task's Touches\/diff/, "判词说明它落在本任务 delta 内");
  assert.equal(j.staticPhaseRed, true, "载体字段记下这是静态相位红");
  assert.deepEqual(j.staticPhaseNamedFiles, ["checker-mutation-check.ts"], "点名的文件一并入判定");
  assert.deepEqual(j.staticPhaseCheckers?.length, 3, "点名的 checker 一并入判定");

  const d = decideExitedNotLandedAction(root, "gap-a", suiteRedOutcome(T0, log), j, { nowMs: NOW });
  assert.equal(d.kind, "count-and-retry", "已归因 ⇒ 走既有重试上限路径（⛔ 不是 stop-terminal）");
});

test("AC3①（负控制·方向一）— 点名的 checker 本身在本任务 delta 内 ⇒ 归因到本任务", (t) => {
  const root = makeRoot("rcl-static-ac3a");
  t.after(() => rmSafe(root));
  writeTaskWithTouches(root, "gap-a", ["plugin/scripts/checker-mechanical-spine-check.ts"]);
  const log = writeSuiteLog(root, "fan-in-suite-gap-a.log", STATIC_PHASE_RED_LOG);
  const j = judgeRetryExemption(root, "gap-a", suiteRedOutcome(T0, log), { nowMs: NOW });
  assert.equal(j.verdict, "static-phase-attributed", "`STATIC_CHECK_FAILED: checker-mechanical-spine-check` 的 stem 命中 delta");
  assert.match(j.reason, /checker-mechanical-spine-check/, "判词点名命中的是哪个被指名对象");
});

test("AC3②（负控制·方向二）— 点名的 checker 与本任务 delta 无关 ⇒ ⛔ 不得归因到本任务", (t) => {
  const root = makeRoot("rcl-static-ac3b");
  t.after(() => rmSafe(root));
  writeTaskWithTouches(root, "gap-a", ["packages/quay/src/serve-dashboard.ts"]);
  const log = writeSuiteLog(root, "fan-in-suite-gap-a.log", STATIC_PHASE_RED_LOG);
  const j = judgeRetryExemption(root, "gap-a", suiteRedOutcome(T0, log), { nowMs: NOW });
  assert.notEqual(j.verdict, "static-phase-attributed", "⛔ 无关不得归因到本任务（负控制）");
  assert.equal(j.verdict, "insufficient-data-fallback", "走既有不相关路径（AC3② 逐字）");
  // 判词仍须如实：点名的 checker/文件都要报出来（⛔ 不是「日志里什么都没有」）。
  assert.match(j.reason, /static phase red named 4 artifact\(s\)/, "报出被指名对象的条数（3 checker + 1 文件）");
  assert.match(j.reason, /none is in this task's Touches\/diff/, "并说明都不在本任务 delta 内");
  assert.match(j.reason, /checkers: checker-mechanical-spine-check/, "点名了哪些 checker 存证");
  assert.match(j.reason, /named files: checker-mutation-check\.ts/, "点名了哪些文件存证");
  assert.equal(j.staticPhaseRed, true, "静态相位读数仍在载体上可区分");
});

test("AC3②（负控制·不误收 baselined 明细）— 通过 checker 打印的 grandfather 明细不算指名", (t) => {
  const root = makeRoot("rcl-static-baselined");
  t.after(() => rmSafe(root));
  // delta 与那份 baselined 明细里点到的文件【正交】——若归因器把明细当指名，本用例会红。
  writeTaskWithTouches(root, "gap-a", ["tasks/gap-elsewhere.md"]);
  const log = writeSuiteLog(root, "fan-in-suite-gap-a.log", STATIC_PHASE_RED_LOG_WITH_BASELINED_DETAIL);
  const p = parseStaticCheckFailures(STATIC_PHASE_RED_LOG_WITH_BASELINED_DETAIL);
  assert.deepEqual(p.namedArtifacts, ["checker-mutation-check.ts"], "⛔ 无 FAIL 标记的 `VIOLATION:` / `unowned:` 明细不入指名集");
  const j = judgeRetryExemption(root, "gap-a", suiteRedOutcome(T0, log), { nowMs: NOW });
  assert.notEqual(j.verdict, "static-phase-attributed", "baselined 明细不得把无关 delta 变成「已归因」");
});

test("AC4（判词不得再说假话）— 已归因的静态相位红 ⇒ 判词点名归因对象，⛔ 不再说「日志里没有可修的」", (t) => {
  const root = makeRoot("rcl-static-ac4");
  t.after(() => rmSafe(root));
  writeTaskWithTouches(root, "gap-a", ["plugin/scripts/checker-mutation-check.ts"]);
  const log = writeSuiteLog(root, "fan-in-suite-gap-a.log", STATIC_PHASE_RED_LOG);
  const outcome = suiteRedOutcome(T0, log);
  const j = judgeRetryExemption(root, "gap-a", outcome, { nowMs: NOW });
  const d = decideExitedNotLandedAction(root, "gap-a", outcome, j, { nowMs: NOW });
  assert.equal(d.kind, "count-and-retry", "静态相位已归因 ⇒ 不落 stop-terminal 的基建疑似判词");
  assert.match(d.reason, /static-phase-attributed/, "判词带上 verdict");
  assert.match(d.reason, /checker-mutation-check\.ts \(failure-detail\)/, "判词带上【归因到什么】");
  assert.doesNotMatch(d.reason, /names nothing a worker could fix/, "⛔ 旧肯定断言不得回归");
  assert.doesNotMatch(d.reason, /infra\/contract suspected/, "⛔ 已归因时不得再报「基建/契约疑似」");
  assert.doesNotMatch(d.reason, /not an implementable defect/, "⛔ 已归因时不得再断言「非可修缺陷」（真因就在日志里）");
});
