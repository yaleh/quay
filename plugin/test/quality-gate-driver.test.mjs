// @test-group engine
// quality-gate-driver.test.mjs — AC144 (tasks/gap-ac144-quality-gate-shape-separated-driver):
// 质量把关按【形状】分开驱动化——B15（pool-quality-judge）与 B17（judgment-consumer-check）落
// 例程型 driver（quality-gate-driver.ts，继承 Layer 0 + 1b），B16-C/B18 归 AC145 语义面（⛔ 不在本
// driver，无 god-object）。
//
// Coverage map (task ACs):
//   AC1 — the four quality-gate shapes are NOT merged into one driver kind: qualityGateRoutines()
//         returns EXACTLY two routines (pool-quality-judge / judgment-consumer-check); the driver
//         source carries no run-branch for B16-C/B18 (only the header comment names them as AC145).
//   AC2 — B16-C/B18 are not claimed "driverized" without LLM: the driver's ONLY LLM participation is
//         the B15 judge spawn (launchArgv role=pool-judge); the two routines are exactly B15/B17.
//   AC3 — B15/B17 are truly driverized: the driver's argv builders reference pool-quality-judge.ts and
//         judgment-consumer-check.ts (grep-able 调用), and runJudgmentConsumerCheck / runPoolQualityJudge
//         produce a verified Fact from the real/fake script output with the three-state vocab
//         (verified / failed / not-evaluated — 硬规则 3b: 读不懂 ≠ 合格).
//
// Run:
//   scripts/test.sh plugin/test/quality-gate-driver.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import {
  ROUND_LOG_REL,
  QUALITY_CONTROL_STATE_REL,
  defaultJudgmentConsumerArgv,
  defaultPoolQualityPlanArgv,
  parseJudgmentConsumerReport,
  parsePoolQualityPlan,
  runJudgmentConsumerCheck,
  runPoolQualityJudge,
  runArchitectureReview,
  buildArchGapWorkerPrompt,
  buildPackagingGapWorkerPrompt,
  qualityGateRoutines,
  computeRoundRecord,
  runResidentQualityGateLoop,
} from "../scripts/quality-gate-driver.ts";
import { qualityRoundPath } from "../scripts/pool-quality-judge.ts";
import { archReviewRoundPath, submissionLedgerPath } from "../scripts/architecture-review-cluster.ts";
// gap-drain-on-routine-driver-empties-round-and-respawn-loops AC2 判据以 goal 为对象：goal 的例程
// 与控制面（goalDriverRoutines / GOAL_CONTROL_STATE_REL / GOAL_ROUND_REL）——机械环跑 criterion 是
// 零 LLM 的观测，halt 只挡缺口立案 spawn（runGapSpawnPass 的 halted 闸）。
import { goalDriverRoutines, GOAL_CONTROL_STATE_REL, GOAL_ROUND_REL } from "../scripts/goal-driver.ts";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, "..", "..");

// ── fixtures（fake 命令脚本——把 spawn 缝注入成确定性输出，不真跑 LLM / 全池审计）──────────────

function writeFixture(tmp, name, body) {
  const p = path.join(tmp, name);
  fs.writeFileSync(p, body, "utf8");
  return p;
}

function fakePlanScript(tmp, fired) {
  return writeFixture(
    tmp,
    "fake-plan.js",
    `process.stdout.write(JSON.stringify({triggers:{fired:${fired},reasons:${fired ? '["pool>25"]' : "[]"},poolCount:2,oldestUnreviewedAgeMs:1000,roundsSinceLastJudge:${fired ? 11 : 2}},pool:${fired ? '["gap-demo-ready","gap-demo-should-remove"]' : "[]"},tasks:${fired ? '[{id:"gap-demo-ready",acChecked:1,acTotal:1},{id:"gap-demo-should-remove",acChecked:0,acTotal:2}]' : "[]"},lastJudgeState:{status:"ok"}}));`,
  );
}

function fakeJudgeScript(tmp) {
  return writeFixture(
    tmp,
    "fake-judge.js",
    `process.stdout.write(JSON.stringify([{id:"gap-demo-ready",verdict:"ready",acCompleteness:"all-checked",premiseSound:true,evidence:"done",recommendation:"dispatch"},{id:"gap-demo-should-remove",verdict:"should-remove",acCompleteness:"partial",premiseSound:false,evidence:"premise falsified",recommendation:"rescope"}]));`,
  );
}

function fakeJudgmentScript(tmp, drift) {
  return writeFixture(
    tmp,
    "fake-judgment.js",
    `process.stdout.write(JSON.stringify({mode:"judgment-consumer-audit",judgments_total:6,wired:${drift ? 5 : 6},unfinished:${drift ? '["deficit"]' : "[]"},drift:${drift}})); process.exit(${drift ? 1 : 0});`,
  );
}

function fakeGateGoScript(tmp) {
  return writeFixture(tmp, "fake-gate-go.js", `process.stdout.write(JSON.stringify({verdict:"GO",reason:"fake"}));`);
}

// 架构复核例程的 fake 命令（把三检测器 + judge 缝注入成确定性输出，不真跑 detector / LLM）────────

function fakeIdentityScript(tmp, withEntity) {
  return writeFixture(
    tmp,
    "fake-identity.js",
    withEntity
      // ⚠️ 该行的 `hardcoded`/`accessor` 必须**真的越过检测器的阈值谓词**
      // (`isFlagged` = `hardcoded >= 5 && hardcoded > accessor`)，否则本簇不会被产出：
      // 上一版是 `code:5, hardcoded:4` —— 它在旧的裸 `hardcoded > 0` 判据下成簇，
      // 而那个裸判据正是 gap-arch-review-cluster-ignores-detector-flag-predicate 修掉的缺陷。
      // 现取真实读数形态（对照生产里 `P2-identity-quay-init.sh` 实测 59 hardcoded / 3 accessor）。
      ? `process.stdout.write(JSON.stringify({table:[{entity:"session-liveness.sh",code:62,hardcoded:59,accessor:3,codeFiles:["plugin/scripts/a.ts","packages/quay/src/observation.ts"]}],judgmentRewrites:[{file:"plugin/scripts/worker-driver.ts"}],pathConstants:[],byteIdentical:{count:0,pairs:[]}}));`
      : `process.stdout.write(JSON.stringify({table:[],judgmentRewrites:[],pathConstants:[],byteIdentical:{count:0,pairs:[]}}));`,
  );
}

function fakeLineageScript(tmp, withSuspicious) {
  return writeFixture(
    tmp,
    "fake-lineage.js",
    `process.stdout.write(JSON.stringify({suspicious:${withSuspicious ? '[{basename:"guard-a.ts",dir:"plugin/scripts"}]' : "[]"},declared:[]}));`,
  );
}

function fakeDeletionScript(tmp) {
  return writeFixture(
    tmp,
    "fake-deletion.js",
    `process.stdout.write(JSON.stringify({components:["session-liveness.sh"],dc:["plugin/scripts/a.ts","tasks/x.md"],counts:{dcTotal:2,callGraphTotal:1,ratio:2}}));`,
  );
}

// AC4(b) 的 driver 边界缝（gap-arch-review-p1-seed-ignores-detector-flag-predicate）──────────────
// 纯函数单测不够——driver 才是 deletion-closure-check 的真实消费面。本缝把 driver **实际传给**
// deletion 脚本的构件清单落盘，于是「哪些行被当成 P1 构件送进删除闭包扫描」变成一个可断言的读数。

/** identity 表：leak.ts 20/23 是 below-threshold（**裸判据下排第一**），其余三行真越过 `isFlagged`。 */
function fakeIdentityBoundaryScript(tmp) {
  return writeFixture(
    tmp,
    "fake-identity-boundary.js",
    `process.stdout.write(JSON.stringify({table:[`
      + `{entity:"leak.ts",code:20,hardcoded:20,accessor:23,codeFiles:["plugin/scripts/leak.ts"]},`
      + `{entity:"real.ts",code:9,hardcoded:9,accessor:2,codeFiles:["plugin/scripts/real.ts"]},`
      + `{entity:"real2.ts",code:8,hardcoded:8,accessor:3,codeFiles:["plugin/scripts/real2.ts"]},`
      + `{entity:"real3.ts",code:7,hardcoded:7,accessor:4,codeFiles:["plugin/scripts/real3.ts"]}],`
      + `judgmentRewrites:[],pathConstants:[],byteIdentical:{count:0,pairs:[]}}));`,
  );
}

/** deletion 缝：在 `root` 下装一个假的 `plugin/scripts/deletion-closure-check.ts`，让它把收到的构件
 *  清单 append 到 logPath 再回一个合法报告（⛔ 不真跑检测器）。
 *
 *  ⚠️ **为什么不用 `deletionCmd` 注入缝**：`deletionCmd` 是**整条 argv 的替代**（driver 里
 *  `deletionCmd ?? defaultDeletionClosureArgv(root, components)`），注入它就把 driver 推导出的构件
 *  **一并绕掉**了——缝里永远看到空参数，断言恒真（硬规则 4）。装在 root 下则走 **`defaultDeletionClosureArgv`
 * 这条生产路径**：driver 推导构件 → 拼进缺省 argv → spawn，构件在缝里真实可见。 */
function fakeDeletionStubUnderRoot(tmp, logPath) {
  const dir = path.join(tmp, "plugin", "scripts");
  fs.mkdirSync(dir, { recursive: true });
  return writeFixture(
    dir,
    "deletion-closure-check.ts",
    `const fs=require("node:fs");
const argv=process.argv.slice(2);
const i=argv.indexOf("--root");
const components=i<0?argv:argv.slice(0,i);
fs.appendFileSync(${JSON.stringify(logPath)}, JSON.stringify(components)+"\\n");
process.stdout.write(JSON.stringify({components,dc:["plugin/scripts/a.ts"],counts:{dcTotal:1,callGraphTotal:1,ratio:1}}));`,
  );
}

/** 读 driver 边界缝的日志：每条 = 一次 deletion spawn 收到的构件数组。 */
function readDeletionComponentLog(logPath) {
  if (!fs.existsSync(logPath)) return [];
  return fs.readFileSync(logPath, "utf8").split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l));
}

function fakeArchJudgeScript(tmp) {
  return writeFixture(
    tmp,
    "fake-arch-judge.js",
    `process.stdout.write(JSON.stringify([{clusterId:"P2-identity-session-liveness.sh",verdict:"abstract",reasoning:"dup naming",suggestedAction:"consolidate",actionable:true},{clusterId:"P1-deletion-closure",verdict:"coincidental",reasoning:"narrative refs",suggestedAction:"keep",actionable:false},{clusterId:"P2-judgment-rewrites",verdict:"abstract",reasoning:"same fingerprint 2x",suggestedAction:"merge",actionable:true},{clusterId:"P4-suspicious-guards",verdict:"uncertain",reasoning:"preventive?",suggestedAction:"human",actionable:false}]));`,
  );
}

/** 任意逐簇判词数组 → fake judge 脚本（AC2/AC4 的两态输入构造面）。 */
function fakeArchJudgeWith(tmp, name, verdicts) {
  return writeFixture(tmp, name, `process.stdout.write(JSON.stringify(${JSON.stringify(verdicts)}));`);
}

/** gap-filing agent 测试缝：把每次 spawn 的 argv（prompt 是末参数）逐行 append 到 logPath。
 *  ⛔ 不真立案、不真跑 LLM——测的是【接线】（driver 把哪些结论交出去、交了几次）。 */
function fakeArchGapWorkerScript(tmp, logPath) {
  return writeFixture(
    tmp,
    "fake-arch-gap-worker.js",
    `const fs = require("node:fs"); fs.appendFileSync(${JSON.stringify(logPath)}, JSON.stringify(process.argv.slice(2)) + "\\n");`,
  );
}

/** 读 gap-filing 缝的调用日志：每条 = 一次 spawn 的 argv 数组，其【末元素】= 真实 prompt。 */
function readGapLog(logPath) {
  if (!fs.existsSync(logPath)) return [];
  return fs.readFileSync(logPath, "utf8").split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l));
}

// ── AC3 · B17：parse + argv + runJudgmentConsumerCheck ──────────────────────────────────────────

test("AC3 — defaultJudgmentConsumerArgv references judgment-consumer-check.ts (grep-able 调用)", () => {
  const argv = defaultJudgmentConsumerArgv("/repo");
  assert.ok(argv.join(" ").includes("judgment-consumer-check.ts"), "argv must call judgment-consumer-check.ts");
  assert.ok(argv.includes("--root") && argv.includes("/repo") && argv.includes("--json"), "argv carries --root/--json");
});

test("AC3 — parseJudgmentConsumerReport parses the audit envelope / null on garbage", () => {
  const good = parseJudgmentConsumerReport(JSON.stringify({
    mode: "judgment-consumer-audit", judgments_total: 6, wired: 6, unfinished: [], drift: false,
  }));
  assert.deepEqual(good, { mode: "judgment-consumer-audit", judgmentsTotal: 6, wired: 6, unfinished: [], drift: false });
  assert.equal(parseJudgmentConsumerReport("not json"), null);
  assert.equal(parseJudgmentConsumerReport(JSON.stringify({ mode: "other" })), null);
});

test("AC3 — runJudgmentConsumerCheck three-state vocab (verified / failed / not-evaluated)", async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "qg-b17-"));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const clean = await runJudgmentConsumerCheck("/repo", ["node", fakeJudgmentScript(tmp, false)]);
  assert.equal(clean.name, "judgment-consumer-check");
  assert.equal(clean.state, "verified", "no drift ⇒ verified");
  assert.equal(clean.value.drift, false);
  const drift = await runJudgmentConsumerCheck("/repo", ["node", fakeJudgmentScript(tmp, true)]);
  assert.equal(drift.state, "failed", "drift ⇒ failed (⛔ not verified)");
  assert.equal(drift.value.drift, true);
  const unreadable = await runJudgmentConsumerCheck("/repo", ["node", path.join(tmp, "does-not-exist.js")]);
  assert.equal(unreadable.state, "not-evaluated", "spawn 失败 ⇒ not-evaluated (⛔ not verified)");
});

// ── AC3 · B15：argv + parse + runPoolQualityJudge ────────────────────────────────────────────────

test("AC3 — defaultPoolQualityPlanArgv references pool-quality-judge.ts --plan (grep-able 调用)", () => {
  const argv = defaultPoolQualityPlanArgv("/repo");
  assert.ok(argv.join(" ").includes("pool-quality-judge.ts"), "argv must call pool-quality-judge.ts");
  assert.ok(argv.includes("--plan"), "mechanical trigger via --plan");
});

test("AC3 — parsePoolQualityPlan parses triggers/pool / null on malformed", () => {
  const plan = parsePoolQualityPlan(JSON.stringify({
    triggers: { fired: true, reasons: ["pool>25"], poolCount: 2, oldestUnreviewedAgeMs: 1, roundsSinceLastJudge: 11 },
    pool: ["a", "b"], tasks: [], lastJudgeState: { status: "ok" },
  }));
  assert.equal(plan.triggers.fired, true);
  assert.deepEqual(plan.pool, ["a", "b"]);
  assert.equal(parsePoolQualityPlan("garbage"), null);
  assert.equal(parsePoolQualityPlan(JSON.stringify({ triggers: {} })), null, "missing pool key ⇒ null");
});

test("AC3 — runPoolQualityJudge not-triggered ⇒ verified (fired=false 是真实测量)", async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "qg-b15-nt-"));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const planCmd = ["node", fakePlanScript(tmp, false)];
  const fact = await runPoolQualityJudge("/repo", planCmd, null);
  assert.equal(fact.name, "pool-quality-judge");
  assert.equal(fact.state, "verified");
  assert.equal(fact.value.fired, false);
  assert.equal(fact.value.distribution, null, "not triggered ⇒ no judge ⇒ no distribution");
});

test("AC3 — runPoolQualityJudge fired ⇒ LLM judge + JS aggregate (should-remove → remove-or-rescope)", async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "qg-b15-fire-"));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const planCmd = ["node", fakePlanScript(tmp, true)];
  const judgeArgv = ["node", fakeJudgeScript(tmp)];
  const gateArgv = ["node", fakeGateGoScript(tmp)];
  const fact = await runPoolQualityJudge("/repo", planCmd, judgeArgv, gateArgv);
  assert.equal(fact.state, "verified");
  assert.equal(fact.value.fired, true);
  assert.deepEqual(fact.value.distribution, { ready: 1, "needs-work": 0, "should-remove": 1, uncertain: 0 });
  assert.deepEqual(fact.value.shouldRemoveIds, ["gap-demo-should-remove"], "should-remove routed to remove-or-rescope");
});

test("AC3 — runPoolQualityJudge unreadable plan ⇒ not-evaluated (硬规则 3b)", async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "qg-b15-np-"));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const fact = await runPoolQualityJudge("/repo", ["node", path.join(tmp, "nope.js")], null);
  assert.equal(fact.state, "not-evaluated");
});

test("AC3 — runPoolQualityJudge judge exit non-zero ⇒ failed", async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "qg-b15-jf-"));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const planCmd = ["node", fakePlanScript(tmp, true)];
  const failingJudge = writeFixture(tmp, "fake-judge-fail.js", `process.stdout.write(""); process.exit(1);`);
  const gateArgv = ["node", fakeGateGoScript(tmp)];
  const fact = await runPoolQualityJudge("/repo", planCmd, ["node", failingJudge], gateArgv);
  assert.equal(fact.state, "failed");
  assert.equal(fact.value.fired, true);
});

// ── AC1 · 四形状不并同一 kind：两条例程，无 B16-C/B18 运行分支 ───────────────────────────────────

test("AC1 — qualityGateRoutines returns EXACTLY the four driverized routines (B15 + B17 + 架构复核 + packaging-hygiene)", () => {
  const routines = qualityGateRoutines("/repo", {
    planCmd: null, judgeArgv: null, judgmentCmd: null, resourceGateArgv: null,
    identityCmd: null, lineageCmd: null, deletionCmd: null, archJudgeArgv: null,
    poolJudgeIntervalMinutes: 10, judgmentIntervalMinutes: 30, archReviewIntervalMinutes: 60,
    packagingCheckCmd: null, packagingGapWorkerCmd: null, packagingGapWorkerTimeoutMs: 900_000,
    packagingHygieneIntervalMinutes: 60,
    archGapWorkerCmd: null, archGapWorkerTimeoutMs: 900_000,
  });
  assert.deepEqual(routines.map((r) => r.name), ["pool-quality-judge", "judgment-consumer-check", "architecture-review", "packaging-hygiene"]);
  assert.equal(routines.length, 4, "⛔ 不是 god-object——只此四条，B16-C/B18 归 AC145");
  for (const r of routines) assert.equal(r.schedule.kind, "interval", "例程调度 = interval (1b)");
});

test("AC1/AC2 — driver source carries the three 调用 and no B16-C/B18 execution branch", () => {
  const src = fs.readFileSync(path.join(REPO_ROOT, "plugin", "scripts", "quality-gate-driver.ts"), "utf8");
  assert.ok(src.includes("pool-quality-judge.ts"), "driver 调用 pool-quality-judge.ts");
  assert.ok(src.includes("judgment-consumer-check.ts"), "driver 调用 judgment-consumer-check.ts");
  // 架构复核：spawn 三个检测器（grep-able 调用）+ launchArgv LLM judge + 聚类纯函数（schema 定义）。
  assert.ok(src.includes("identity-replication-check.ts"), "driver 调用 identity-replication-check.ts");
  assert.ok(src.includes("guard-lineage-check.ts"), "driver 调用 guard-lineage-check.ts");
  assert.ok(src.includes("deletion-closure-check.ts"), "driver 调用 deletion-closure-check.ts");
  assert.ok(src.includes("launchArgv"), "B15 与架构复核的 judge 是 LLM 参与（launchArgv）——非伪装机械");
  assert.ok(src.includes("architecture-review-cluster.ts"), "driver 复用 architecture-review-cluster.ts 聚类");
  // 仅头部注释点名 B16-C/B18 归 AC145；运行代码（routines 表）只有三条。B16/B18 不出现在
  // run* 函数体内——以 routines 表精确断言（上面的 exactly-three 已覆盖结构），此处再证无独立运行分支。
  assert.equal(src.includes("runB16") || src.includes("runB18"), false, "无 B16-C/B18 运行分支");
});

// ── 常驻循环 · round 心跳 ──────────────────────────────────────────────────────────────────────

test("computeRoundRecord — 心跳信封含 round/run_id/facts（carrier 一行）", () => {
  const rec = computeRoundRecord({ round: 3, runId: "qg-x", pid: 42, at: "2026-08-26T00:00:00Z", facts: [] });
  assert.equal(rec.round, 3);
  assert.equal(rec.run_id, "qg-x");
  assert.equal(rec.ts, "2026-08-26T00:00:00Z");
  assert.deepEqual(rec.facts, []);
  assert.equal(rec.halted, false);
});

test("ROUND_LOG_REL / QUALITY_CONTROL_STATE_REL — 载体与控制态路径（gitignored 运行时态）", () => {
  assert.equal(ROUND_LOG_REL, "quality-round.jsonl");
  assert.equal(QUALITY_CONTROL_STATE_REL, ".quay/quality-control.json");
});

// ── 常驻循环端到端（--once + 假命令，spawn 真进程一轮退出）─────────────────────────────────────

test("resident loop --once writes a round record with facts (spawn real process)", (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "qg-loop-"));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  // ⚠️ root 是**空工作区**（不是 REPO_ROOT）：driver 现在把 `.quay/config.yml` `loop.routines:` 里
  // 声明的 probe 例程装进例程表（gap-productize-deep-semantic-dedup-scan-routine），若 root=主检出，
  // 这条 `--once` 用例的 facts 集合就会随该工作区 gitignored 的 config 内容漂移，且会真的 spawn 一个
  // 探针 agent。空 root（= 本用例自己的 tmp，由 t.after 清理）⇒ 无声明 ⇒ 例程表恰为四条。
  const planCmd = path.join(tmp, "fake-plan.js");
  const judgmentCmd = path.join(tmp, "fake-judgment.js");
  const packagingCmd = path.join(tmp, "fake-packaging.js");
  const identityCmd = fakeIdentityScript(tmp, false);
  const lineageCmd = fakeLineageScript(tmp, false);
  fs.writeFileSync(planCmd, `process.stdout.write(JSON.stringify({triggers:{fired:false,reasons:[],poolCount:0,oldestUnreviewedAgeMs:0,roundsSinceLastJudge:0},pool:[],tasks:[],lastJudgeState:{status:"ok"}}));`, "utf8");
  fs.writeFileSync(judgmentCmd, `process.stdout.write(JSON.stringify({mode:"judgment-consumer-audit",judgments_total:1,wired:1,unfinished:[],drift:false}));`, "utf8");
  fs.writeFileSync(packagingCmd, `process.stdout.write(JSON.stringify({mode:"packaging-hygiene-audit",configKeys:{keysTotal:0,noConsumerToWire:[],state:"verified"},shippedEntries:{state:"verified",violations:[],reason:null},drift:[]}));`, "utf8");
  const roundLog = path.join(tmp, "quality-round.jsonl");
  const r = spawnSync(
    process.execPath,
    ["--experimental-strip-types", path.join(REPO_ROOT, "plugin", "scripts", "quality-gate-driver.ts"),
     "--root", tmp, "--once", "--round-log", roundLog,
     "--plan-cmd", `node ${planCmd}`, "--judgment-cmd", `node ${judgmentCmd}`,
     "--packaging-check-cmd", `node ${packagingCmd}`,
     "--identity-cmd", `node ${identityCmd}`, "--lineage-cmd", `node ${lineageCmd}`],
    { encoding: "utf8", timeout: 120_000 },
  );
  assert.equal(r.status, 0, `driver --once should exit 0 (stderr: ${r.stderr})`);
  const lines = fs.readFileSync(roundLog, "utf8").split("\n").filter((l) => l.trim());
  assert.equal(lines.length, 1, "one round ⇒ one heartbeat line");
  const rec = JSON.parse(lines[0]);
  assert.equal(rec.halted, false);
  assert.equal(rec.facts.length, 4, "first round ⇒ all four routines due (never-ran ⇒ interval due)");
  const names = rec.facts.map((f) => f.name).sort();
  assert.deepEqual(names, ["architecture-review", "judgment-consumer-check", "packaging-hygiene", "pool-quality-judge"]);
});

test("gap-meta-round-log-rel — default round log path = .quay/quality-round.jsonl (⛔ repo-root)", (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "qg-default-path-"));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const planCmd = path.join(tmp, "fake-plan.js");
  const judgmentCmd = path.join(tmp, "fake-judgment.js");
  const packagingCmd = path.join(tmp, "fake-packaging.js");
  const identityCmd = fakeIdentityScript(tmp, false);
  const lineageCmd = fakeLineageScript(tmp, false);
  fs.writeFileSync(planCmd, `process.stdout.write(JSON.stringify({triggers:{fired:false,reasons:[],poolCount:0,oldestUnreviewedAgeMs:0,roundsSinceLastJudge:0},pool:[],tasks:[],lastJudgeState:{status:"ok"}}));`, "utf8");
  fs.writeFileSync(judgmentCmd, `process.stdout.write(JSON.stringify({mode:"judgment-consumer-audit",judgments_total:1,wired:1,unfinished:[],drift:false}));`, "utf8");
  fs.writeFileSync(packagingCmd, `process.stdout.write(JSON.stringify({mode:"packaging-hygiene-audit",configKeys:{keysTotal:0,noConsumerToWire:[],state:"verified"},shippedEntries:{state:"verified",violations:[],reason:null},drift:[]}));`, "utf8");
  // ⛔ 不传 --round-log：测缺省落点。修复前 = repo-root quality-round.jsonl（与 carrierStats 读 .quay/ 分叉）。
  const r = spawnSync(
    process.execPath,
    ["--experimental-strip-types", path.join(REPO_ROOT, "plugin", "scripts", "quality-gate-driver.ts"),
     "--root", tmp, "--once",
     "--plan-cmd", `node ${planCmd}`, "--judgment-cmd", `node ${judgmentCmd}`,
     "--packaging-check-cmd", `node ${packagingCmd}`,
     "--identity-cmd", `node ${identityCmd}`, "--lineage-cmd", `node ${lineageCmd}`],
    { encoding: "utf8", timeout: 120_000 },
  );
  assert.equal(r.status, 0, `driver --once should exit 0 (stderr: ${r.stderr})`);
  const carrier = path.join(tmp, ".quay", "quality-round.jsonl");
  assert.ok(fs.existsSync(carrier), "heartbeat lands in .quay/quality-round.jsonl");
  const lines = fs.readFileSync(carrier, "utf8").split("\n").filter((l) => l.trim());
  assert.equal(lines.length, 1, "one round ⇒ one heartbeat line");
  assert.ok(!fs.existsSync(path.join(tmp, "quality-round.jsonl")), "⛔ no repo-root quality-round.jsonl");
});

// ── gap-drain-on-routine-driver-empties-round-and-respawn-loops：halt 是轮内闸（⛔ 非进程终止条件）──
// AC1（halt 不再终止进程）与 AC2（受闸的只是动作，观测继续）的判定面。旧实现 break ⇒ 进程 return 0 ⇒
// supervisor 每 5s 重生一次、轮记录恒 round=1 且 facts: []。修法：halt 轮照跑机械读数、只挡 spawn。

test("AC1 — halt 不再终止进程：halted 下 maxRounds=3 ⇒ 3 条轮记录 round 1/2/3", async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "qg-halt-loop-"));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  fs.mkdirSync(path.join(tmp, ".quay"), { recursive: true });
  fs.writeFileSync(path.join(tmp, QUALITY_CONTROL_STATE_REL), JSON.stringify({ schemaVersion: 1, halted: true }), "utf8");
  const roundLog = path.join(tmp, "quality-round.jsonl");
  const routines = [{
    name: "fake-observe",
    schedule: { kind: "interval", minutes: 0 },
    run: () => [{ name: "fake-observe", value: { seen: 1 }, state: "verified", reason: null }],
  }];
  const code = await runResidentQualityGateLoop({
    root: tmp, intervalMs: 1, once: false, maxRounds: 3, roundLogFile: roundLog,
    runId: "halt-loop", json: false, routines, controlStateRel: QUALITY_CONTROL_STATE_REL,
  });
  assert.equal(code, 0);
  const lines = fs.readFileSync(roundLog, "utf8").split("\n").filter((l) => l.trim());
  assert.equal(lines.length, 3, "halted 下仍写满 3 轮（⛔ 旧代码只写 1 条就 break）");
  assert.deepEqual(lines.map((l) => JSON.parse(l).round), [1, 2, 3], "round 单调递增 1/2/3（⛔ 恒为 1 ⇒ 假）");
  for (const l of lines) {
    const rec = JSON.parse(l);
    assert.equal(rec.halted, true, "每轮带 halted: true");
    assert.ok(rec.facts.length > 0, "halted 轮仍产生机械读数（facts 非空）");
  }
});

test("AC2 — 受闸的只是动作：goal halted 轮 criterionCount>0 且 spawned===0", async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "qg-goal-halt-"));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  fs.mkdirSync(path.join(tmp, "goals"), { recursive: true });
  fs.mkdirSync(path.join(tmp, "tasks"), { recursive: true }); // 空 tasks/ ⇒ readTaskFacts 返 []（⛔ 非 null）⇒ AC 判 gap
  // 一个 active GOAL + 一条 active AC（criterion 恒真）——机械环必跑 criterion（零 LLM 观测）。
  const writeGoal = (rec) => {
    const lines = ["---", `id: ${rec.id}`, "title: t", `status: ${rec.status}`, `kind: ${rec.kind}`];
    if (rec.goal) lines.push(`goal: ${rec.goal}`);
    if (rec.criterion !== undefined) lines.push("criterion: |", `  ${rec.criterion}`);
    lines.push("origin: test fixture", "---", "", "## body", "x", "");
    fs.writeFileSync(path.join(tmp, "goals", `${rec.id}-t.md`), lines.join("\n"), "utf8");
  };
  writeGoal({ id: "GOAL-001", status: "active", kind: "goal" });
  writeGoal({ id: "AC-001", status: "active", kind: "criterion", goal: "GOAL-001", criterion: "true" });
  // halted 控制态（goal 自己的 .quay/goal-control.json）。
  fs.mkdirSync(path.join(tmp, ".quay"), { recursive: true });
  fs.writeFileSync(path.join(tmp, GOAL_CONTROL_STATE_REL), JSON.stringify({ schemaVersion: 1, halted: true }), "utf8");
  const roundLog = path.join(tmp, GOAL_ROUND_REL);
  const code = await runResidentQualityGateLoop({
    root: tmp, intervalMs: 1, once: true, maxRounds: null, roundLogFile: roundLog,
    runId: "goal-halt", json: false, controlStateRel: GOAL_CONTROL_STATE_REL,
    routines: goalDriverRoutines(tmp, { scriptRoot: REPO_ROOT }),
  });
  assert.equal(code, 0);
  const lines = fs.readFileSync(roundLog, "utf8").split("\n").filter((l) => l.trim());
  assert.equal(lines.length, 1, "once ⇒ 一条轮记录");
  const rec = JSON.parse(lines[0]);
  assert.equal(rec.halted, true, "轮记录带 halted: true");
  const goalFact = rec.facts.find((f) => f.name === "goal-ring");
  assert.ok(goalFact, "round record 含 goal-ring fact（⛔ 旧代码 facts: [] ⇒ 假）");
  assert.ok(goalFact.value.criterionCount > 0, "halted 轮仍跑 criterion（机械读数非空，⛔ facts: [] ⇒ 假）");
  assert.equal(goalFact.value.spawned, 0, "halted 只挡 spawn（spawned===0）");
});

// ── 判词载体写端（gap-pool-quality-verdicts-never-persisted：AC1 driver 路径 + AC6 负控制）───────

test("AC1 — runPoolQualityJudge fired writes a judged record to .quay/quality-round.jsonl", async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "qg-qr-"));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const planCmd = ["node", fakePlanScript(tmp, true)];
  const judgeArgv = ["node", fakeJudgeScript(tmp)];
  const gateArgv = ["node", fakeGateGoScript(tmp)];
  const fact = await runPoolQualityJudge(tmp, planCmd, judgeArgv, gateArgv);
  assert.equal(fact.state, "verified");
  const carrier = qualityRoundPath(tmp);
  assert.ok(fs.existsSync(carrier), "carrier must exist after a fired judge");
  const lines = fs.readFileSync(carrier, "utf8").split("\n").filter((l) => l.trim());
  assert.equal(lines.length, 1, "one judged record");
  const rec = JSON.parse(lines[0]);
  assert.equal(rec.state, "judged");
  assert.equal(rec.verdicts.length, 2);
  assert.deepEqual(rec.shouldRemoveIds, ["gap-demo-should-remove"]);
  for (const v of rec.verdicts) {
    for (const k of ["taskId", "verdict", "action", "evidence", "judgedAt", "round"]) {
      assert.ok(k in v, `verdict entry must carry ${k} (AC1 五键以上)`);
    }
  }
});

test("AC6 — recordVerdicts=false ⇒ carrier does not grow; restore ⇒ grows (负控制, 能取假)", async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "qg-nc-"));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const planCmd = ["node", fakePlanScript(tmp, true)];
  const judgeArgv = ["node", fakeJudgeScript(tmp)];
  const gateArgv = ["node", fakeGateGoScript(tmp)];
  const carrier = qualityRoundPath(tmp);
  const count = () => (fs.existsSync(carrier) ? fs.readFileSync(carrier, "utf8").split("\n").filter((l) => l.trim()).length : 0);
  // 写入开启 ⇒ 1 条。
  const on = await runPoolQualityJudge(tmp, planCmd, judgeArgv, gateArgv, true);
  assert.equal(on.state, "verified");
  const afterOn = count();
  assert.equal(afterOn, 1, "write on ⇒ carrier grows to 1");
  // 关掉写入 ⇒ 不增长（仍 1 条）。
  const off = await runPoolQualityJudge(tmp, planCmd, judgeArgv, gateArgv, false);
  assert.equal(off.state, "verified");
  assert.equal(count(), afterOn, "write off ⇒ carrier does NOT grow");
  // 恢复写入 ⇒ 增长到 2 条。
  const on2 = await runPoolQualityJudge(tmp, planCmd, judgeArgv, gateArgv, true);
  assert.equal(on2.state, "verified");
  assert.equal(count(), 2, "write restored ⇒ carrier grows to 2");
});

// ── gap-quality-gate-driver-pool-judge-spawn-timeout：AC1 非阻塞 spawn + AC5 负控制 ─────────────
// B15 的 judge（真实 claude -p）曾用 spawnSync + 180_000 固定字面量上限，在真实并发负载下 3/3
// 超时、0 成功（结构性地跑不完）。修法：judge spawn 改 runAsync（非阻塞）+ 缺省 unbounded
// （无固定上限，judge 完成是唯一唤醒源）。AC1 测「非阻塞」、AC5 测「明显不够的 timeout 仍复现
// timeout 失败」（负控制，证明瓶颈真实），AC2 三态不回归由上面既有 AC3/AC6 用例覆盖。

test("AC1 — judge spawn 非阻塞（judge 运行期间事件循环不被冻住）", async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "qg-async-"));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const planCmd = ["node", fakePlanScript(tmp, true)];
  const slowJudge = writeFixture(
    tmp,
    "fake-judge-slow.js",
    `setTimeout(() => process.stdout.write(JSON.stringify([{id:"gap-demo-ready",verdict:"ready",acCompleteness:"all-checked",premiseSound:true,evidence:"done",recommendation:"dispatch"}])), 700);`,
  );
  const gateArgv = ["node", fakeGateGoScript(tmp)];
  const t0 = Date.now();
  const p = runPoolQualityJudge("/repo", planCmd, ["node", slowJudge], gateArgv, false);
  // 不 await judge，先等一个 50ms 定时器：若 judge 仍 spawnSync 阻塞，这个定时器要等到 700ms 后才会触发。
  await new Promise((r) => setTimeout(r, 50));
  const elapsed = Date.now() - t0;
  assert.ok(elapsed < 350, `50ms 定时器应快速触发（实测 ${elapsed}ms）——judge spawn 未阻塞事件循环`);
  const fact = await p;
  assert.equal(fact.state, "verified", "slow judge 最终完成 ⇒ verified");
});

test("AC5 — 负控制：明显不够的 judgeTimeoutMs 仍复现 timeout 失败；缺省 unbounded 能跑完", async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "qg-nc5-"));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const planCmd = ["node", fakePlanScript(tmp, true)];
  const slowJudge = writeFixture(
    tmp,
    "fake-judge-slow2.js",
    `setTimeout(() => process.stdout.write(JSON.stringify([{id:"gap-demo-ready",verdict:"ready",acCompleteness:"all-checked",premiseSound:true,evidence:"done",recommendation:"dispatch"}])), 1500);`,
  );
  const gateArgv = ["node", fakeGateGoScript(tmp)];
  // 明显不够的值（100ms < 1500ms judge）⇒ 复现 timeout 失败（⛔ 不静默 verified）。
  const fail = await runPoolQualityJudge(tmp, planCmd, ["node", slowJudge], gateArgv, false, 100);
  assert.equal(fail.state, "failed", "明显不够的 timeout ⇒ failed");
  assert.match(fail.reason, /timeout/i, "失败原因为 timeout（复现真实瓶颈）");
  // 正对照：同一 slow judge 用缺省 unbounded ⇒ 能跑完 ⇒ 修法（去掉固定字面量上限）有效。
  const ok = await runPoolQualityJudge(tmp, planCmd, ["node", slowJudge], gateArgv, false);
  assert.equal(ok.state, "verified", "缺省 unbounded ⇒ 同一 slow judge 能跑完 ⇒ verified");
});

// ── 架构复核例程（gap-quality-driver-architecture-review-routine：机械聚类 → LLM judge → JS 合并 → 载体）──

function archReviewCmd(tmp, { withEntity = true, withSuspicious = true } = {}) {
  return {
    identityCmd: ["node", fakeIdentityScript(tmp, withEntity)],
    lineageCmd: ["node", fakeLineageScript(tmp, withSuspicious)],
    deletionCmd: ["node", fakeDeletionScript(tmp)],
    judgeArgv: ["node", fakeArchJudgeScript(tmp)],
    gateArgv: ["node", fakeGateGoScript(tmp)],
    // gap-filing 缝：⛔ 不传就会走 launchArgv ⇒ 真 spawn claude -p（生产行为，单测里不可接受）。
    gapWorkerCmd: `node ${fakeArchGapWorkerScript(tmp, path.join(tmp, "arch-gap-log.jsonl"))}`,
  };
}

test("AC2/AC3 — runArchitectureReview fired ⇒ LLM judge ⇒ judged record + distribution", async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "qg-arch-"));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const { identityCmd, lineageCmd, deletionCmd, judgeArgv, gateArgv, gapWorkerCmd } = archReviewCmd(tmp);
  const fact = await runArchitectureReview(tmp, identityCmd, lineageCmd, deletionCmd, judgeArgv, gateArgv, true, Infinity, false, gapWorkerCmd);
  assert.equal(fact.name, "architecture-review");
  assert.equal(fact.state, "verified");
  assert.equal(fact.value.fired, true);
  assert.equal(fact.value.judgedCount, 4);
  assert.deepEqual(fact.value.distribution, { abstract: 2, coincidental: 1, uncertain: 1 });
  // 语义结论 → 立案（本任务 AC2）：2 个 abstract 标了 actionable ⇒ 2 个结论提交，1 次 spawn。
  assert.equal(fact.value.actionableCount, 2, "actionable=true 的簇 = 2");
  assert.deepEqual(fact.value.submittedKeys, ["P2-identity-session-liveness.sh|abstract", "P2-judgment-rewrites|abstract"]);
  assert.equal(fact.value.actionabilityNotEvaluated, 0);
  assert.equal(fact.value.gapFiled, true);

  const carrier = archReviewRoundPath(tmp);
  assert.ok(fs.existsSync(carrier), "carrier must exist after a fired judge");
  const lines = fs.readFileSync(carrier, "utf8").split("\n").filter((l) => l.trim());
  assert.equal(lines.length, 1, "one judged record");
  const rec = JSON.parse(lines[0]);
  assert.equal(rec.state, "judged");
  assert.equal(rec.clusters.length, 4);
  for (const v of rec.clusters) {
    for (const k of ["clusterId", "primitive", "files", "verdict", "reasoning", "judgedAt", "round"]) {
      assert.ok(k in v, `cluster verdict must carry ${k}`);
    }
    assert.ok("suggestedAction" in v, "cluster verdict carries suggestedAction");
    assert.ok("actionable" in v, "cluster verdict carries actionable (三态)");
  }
});

test("AC3 — runArchitectureReview not-triggered ⇒ verified fired=false + not-triggered record", async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "qg-arch-nt-"));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const { identityCmd, lineageCmd } = archReviewCmd(tmp, { withEntity: false, withSuspicious: false });
  const fact = await runArchitectureReview(tmp, identityCmd, lineageCmd, null, null);
  assert.equal(fact.state, "verified");
  assert.equal(fact.value.fired, false);
  assert.equal(fact.value.clusterCount, 0);
  const rec = JSON.parse(fs.readFileSync(archReviewRoundPath(tmp), "utf8").split("\n").filter((l) => l.trim()).pop());
  assert.equal(rec.state, "not-triggered");
});

// gap-arch-review-p1-seed-ignores-detector-flag-predicate AC4(b)：P1 候选构件选取的**真实消费面**。
// 断言的是 `runArchitectureReview` 实际交给 deletion 脚本的构件清单——把 `deletionClosureComponents`
// 的谓词换回裸 `(row.hardcoded ?? 0) > 0` 时本条**必须变红**（leak.ts 20/23 会顶掉 real3.ts）。
test("AC4(b) — driver 边界：below-threshold 行不作为 P1 构件传给 deletion 脚本", async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "qg-arch-p1-"));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const logPath = path.join(tmp, "deletion-components.jsonl");
  const identityCmd = ["node", fakeIdentityBoundaryScript(tmp)];
  const lineageCmd = ["node", fakeLineageScript(tmp, false)];
  fakeDeletionStubUnderRoot(tmp, logPath);
  // deletionCmd=null ⇒ 走 defaultDeletionClosureArgv(root, components)（生产路径），假 stub 装在
  // root/plugin/scripts/deletion-closure-check.ts 接住它。judgeArgv=null 且 halted=true ⇒ 步骤 5
  // 提前返回：⛔ 不 spawn 真 claude -p，也不落判词载体；但步骤 1-3（identity spawn → 推导构件 →
  // deletion spawn）已全部跑完——那正是本条的观测面。
  await runArchitectureReview(tmp, identityCmd, lineageCmd, null, null, null, false, Infinity, true);

  const calls = readDeletionComponentLog(logPath);
  assert.equal(calls.length, 1, "有候选构件 ⇒ deletion 脚本被 spawn 恰一次");
  const components = calls[0];
  assert.deepEqual(
    components,
    ["real.ts", "real2.ts", "real3.ts"],
    "只有 isFlagged=true 的行成为 P1 构件（top-3）",
  );
  assert.ok(!components.includes("leak.ts"), "below-threshold 的 leak.ts(20/23) 不得作为 P1 构件");
});

test("AC3 — runArchitectureReview judge exit non-zero ⇒ failed + failed record", async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "qg-arch-jf-"));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const { identityCmd, lineageCmd, deletionCmd, gateArgv } = archReviewCmd(tmp);
  const failingJudge = writeFixture(tmp, "fake-arch-judge-fail.js", `process.stdout.write(""); process.exit(1);`);
  const fact = await runArchitectureReview(tmp, identityCmd, lineageCmd, deletionCmd, ["node", failingJudge], gateArgv);
  assert.equal(fact.state, "failed");
  const rec = JSON.parse(fs.readFileSync(archReviewRoundPath(tmp), "utf8").split("\n").filter((l) => l.trim()).pop());
  assert.equal(rec.state, "failed");
});

test("AC3 — runArchitectureReview unreadable identity ⇒ not-evaluated (硬规则 3b)", async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "qg-arch-np-"));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const fact = await runArchitectureReview(tmp, ["node", path.join(tmp, "nope.js")], null, null, null);
  assert.equal(fact.state, "not-evaluated");
});

test("AC6 — recordVerdicts=false ⇒ carrier does not grow; restore ⇒ grows (负控制, 能取假)", async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "qg-arch-nc-"));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const { identityCmd, lineageCmd, deletionCmd, judgeArgv, gateArgv, gapWorkerCmd } = archReviewCmd(tmp);
  const carrier = archReviewRoundPath(tmp);
  const count = () => (fs.existsSync(carrier) ? fs.readFileSync(carrier, "utf8").split("\n").filter((l) => l.trim()).length : 0);
  const on = await runArchitectureReview(tmp, identityCmd, lineageCmd, deletionCmd, judgeArgv, gateArgv, true, Infinity, false, gapWorkerCmd);
  assert.equal(on.state, "verified");
  assert.equal(count(), 1, "write on ⇒ carrier grows to 1");
  const off = await runArchitectureReview(tmp, identityCmd, lineageCmd, deletionCmd, judgeArgv, gateArgv, false, Infinity, false, gapWorkerCmd);
  assert.equal(off.state, "verified");
  assert.equal(count(), 1, "write off ⇒ carrier does NOT grow");
  const on2 = await runArchitectureReview(tmp, identityCmd, lineageCmd, deletionCmd, judgeArgv, gateArgv, true, Infinity, false, gapWorkerCmd);
  assert.equal(on2.state, "verified");
  assert.equal(count(), 2, "write restored ⇒ carrier grows to 2");
});

// ── 语义结论 → 既有立案通道（gap-arch-review-judge-verdicts-never-reach-the-existing-gap-filing-
// channel）：AC2 接线可取假 / AC3 复用既有查重 / AC4 节流可取假 ─────────────────────────────────────
// 判定面：driver 把 judge 标了 actionable=true 的结论交给【既有】通道（quay-file-task 技能 + 其机制
// 查重），并靠结论键台账节流。测的是【接线】（谁被交出去、交了几次），⛔ 不真跑 LLM、不真立案。

/** 四个簇的固定判词构造面——只改 actionable / verdict，其余保持恒定（两态输入的对照）。 */
function archVerdicts({ p1Actionable = false, p1Verdict = "coincidental", p1Key = "P1-deletion-closure" } = {}) {
  return [
    { clusterId: p1Key, verdict: p1Verdict, reasoning: "closure inflated by generated dirs", suggestedAction: "exclude .archguard/output + .claude/worktrees", actionable: p1Actionable },
    { clusterId: "P2-identity-session-liveness.sh", verdict: "coincidental", reasoning: "keep", suggestedAction: "keep", actionable: false },
    { clusterId: "P2-judgment-rewrites", verdict: "coincidental", reasoning: "keep", suggestedAction: "keep", actionable: false },
    { clusterId: "P4-suspicious-guards", verdict: "coincidental", reasoning: "keep", suggestedAction: "keep", actionable: false },
  ];
}

async function runArchWith(tmp, verdicts, { gapWorkerCmd, dateTag = "" } = {}) {
  const { identityCmd, lineageCmd, deletionCmd, gateArgv } = archReviewCmd(tmp);
  const judgeArgv = ["node", fakeArchJudgeWith(tmp, `fake-judge-${dateTag || "x"}.js`, verdicts)];
  return runArchitectureReview(tmp, identityCmd, lineageCmd, deletionCmd, judgeArgv, gateArgv,
    true, Infinity, false, gapWorkerCmd ?? `node ${fakeArchGapWorkerScript(tmp, path.join(tmp, "arch-gap-log.jsonl"))}`);
}

test("AC2 — 两态①：judge 给出一个 actionable 结论 ⇒ 恰好一次提交（prompt 只含该结论）", async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "qg-arch-ac2a-"));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const log = path.join(tmp, "arch-gap-log.jsonl");
  const fact = await runArchWith(tmp, archVerdicts({ p1Actionable: true }));
  assert.equal(fact.state, "verified");
  assert.equal(fact.value.actionableCount, 1, "只有 P1 簇够格");
  assert.deepEqual(fact.value.submittedKeys, ["P1-deletion-closure|coincidental"], "结论键 = clusterId|verdict");
  assert.equal(fact.value.gapFiled, true);

  const calls = readGapLog(log);
  assert.equal(calls.length, 1, "恰好一次 spawn（⛔ 不是每个簇一次）");
  const prompt = calls[0][calls[0].length - 1];  // 每条日志 = 该次 spawn 的 argv；末元素 = 真实 prompt
  assert.ok(prompt.includes("P1-deletion-closure"), "prompt 含够格的结论");
  assert.ok(prompt.includes("exclude .archguard/output"), "prompt 带上 judge 的 suggestedAction（原文）");
  assert.ok(!prompt.includes("P2-judgment-rewrites"), "⛔ prompt 不含不够格的结论");
  assert.ok(!prompt.includes("P4-suspicious-guards"), "⛔ prompt 不含不够格的结论");
  // 台账逐条落键（供下一轮节流）。
  const led = fs.readFileSync(submissionLedgerPath(tmp), "utf8").split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l));
  assert.deepEqual(led.map((r) => r.key), ["P1-deletion-closure|coincidental"]);
});

test("AC2 — 两态②：judge 不给 actionable 结论 ⇒ 零立案（零 spawn、无台账）", async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "qg-arch-ac2b-"));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const log = path.join(tmp, "arch-gap-log.jsonl");
  const fact = await runArchWith(tmp, archVerdicts({ p1Actionable: false }));
  assert.equal(fact.state, "verified", "judge 照常跑完 —— 判过且不立案 ≠ 未评估");
  assert.equal(fact.value.actionableCount, 0);
  assert.deepEqual(fact.value.submittedKeys, []);
  assert.equal(fact.value.gapFiled, false, "⛔ 零立案");
  assert.equal(readGapLog(log).length, 0, "⛔ 零 spawn");
  assert.ok(!fs.existsSync(submissionLedgerPath(tmp)), "⛔ 不写台账");
  assert.ok(!/gap-filing spawned/.test(fact.reason), `reason 不得声称立过案：${fact.reason}`);
});

test("AC4 — 节流：同一结论连续 N=4 轮只提交一次；verdict 变了才再提交（能取假）", async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "qg-arch-ac4-"));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const log = path.join(tmp, "arch-gap-log.jsonl");
  const gapWorkerCmd = `node ${fakeArchGapWorkerScript(tmp, log)}`;
  const same = archVerdicts({ p1Actionable: true });
  // N 轮同一结论（模拟生产：每小时一次、25+ 次同一 P1 结论）。
  const facts = [];
  for (let i = 0; i < 4; i++) facts.push(await runArchWith(tmp, same, { gapWorkerCmd, dateTag: "same" }));
  assert.equal(readGapLog(log).length, 1, "4 轮同一结论 ⇒ 恰好 1 次提交（⛔ 不是 4 次）");
  assert.deepEqual(facts.map((f) => f.value.submittedKeys.filter(Boolean).length), [1, 0, 0, 0], "只有第 1 轮提交");
  assert.deepEqual(facts.map((f) => f.value.gapFiled), [true, false, false, false], "后续轮 gapFiled=false");
  const keys = fs.readFileSync(submissionLedgerPath(tmp), "utf8").split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l).key);
  assert.deepEqual(keys, ["P1-deletion-closure|coincidental"], "台账恰好一条");
  // 负控制（能取假）：同一簇但判定变了 ⇒ 是【另一个结论】⇒ 必须再提交一次。
  const changed = archVerdicts({ p1Actionable: true, p1Verdict: "abstract" });
  const f5 = await runArchWith(tmp, changed, { gapWorkerCmd, dateTag: "changed" });
  assert.equal(readGapLog(log).length, 2, "verdict 变 ⇒ 结论键变 ⇒ 再提交（⛔ 节流不是按 clusterId 永久封死）");
  assert.deepEqual(f5.value.submittedKeys, ["P1-deletion-closure|abstract"]);
});

test("AC2/3b — judge 判词缺 actionable ⇒ 未评估（⛔ 与「判过且不立案」不同形）", async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "qg-arch-3b-"));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const log = path.join(tmp, "arch-gap-log.jsonl");
  const missing = archVerdicts({ p1Actionable: true }).map(({ actionable, ...rest }) => rest);
  const fact = await runArchWith(tmp, missing, { gapWorkerCmd: `node ${fakeArchGapWorkerScript(tmp, log)}` });
  assert.equal(fact.value.actionableCount, 0, "读不出 ⇒ 不算够格");
  assert.equal(fact.value.actionabilityNotEvaluated, 4, "⛔ 但必须**计为未评估**，不是 0 条「判过且不够格」");
  assert.equal(readGapLog(log).length, 0, "未评估 ⇒ 不立案（不猜）");
  assert.match(fact.reason, /actionability unreadable for 4 cluster\(s\)/, `reason 必须显式区分：${fact.reason}`);
  // 载体里三态可见：actionable 为 null（⛔ 不是 false）。
  const rec = JSON.parse(fs.readFileSync(archReviewRoundPath(tmp), "utf8").split("\n").filter((l) => l.trim()).pop());
  assert.deepEqual([...new Set(rec.clusters.map((c) => c.actionable))], [null], "载体记录 actionable=null（未评估）");
});

test("AC3 — 立案路径经 quay-file-task 的机制查重；节流不读任务库（⛔ 无第二套查重）", () => {
  const driver = fs.readFileSync(path.join(REPO_ROOT, "plugin", "scripts", "quality-gate-driver.ts"), "utf8");
  const cluster = fs.readFileSync(path.join(REPO_ROOT, "plugin", "scripts", "architecture-review-cluster.ts"), "utf8");
  // ① 立案路径委派给既有技能：两条 gap-filing prompt（packaging + 架构复核）都必须点名它。
  //    ⛔ 按【位置】判定：计数落在两个 prompt 构造函数的**函数体内**，不是全文件 grep（头注释也提到
  //    这个名字——裸计数会把注释算成「委派」，硬规则 2）。
  const hits = driver.split("\n").map((l, i) => [i + 1, l]).filter(([, l]) => l.includes("quay-file-task"));
  console.log(`AC3 grep — "quay-file-task" 全文件命中 ${hits.length} 行:`);
  for (const [n, l] of hits.slice(0, 3)) console.log(`  :${n} ${l.trim().slice(0, 140)}`);
  assert.ok(hits.length >= 2, "至少两条委派（packaging-hygiene + 架构复核）");
  const packagingPrompt = buildPackagingGapWorkerPrompt("/repo", ["drift-x"]);
  const archPrompt = buildArchGapWorkerPrompt("/repo", []);
  for (const [name, p] of [["packaging", packagingPrompt], ["architecture-review", archPrompt]]) {
    assert.ok(p.includes("quay-file-task"), `${name} 的 prompt 要求走该技能`);
    assert.ok(/MECHANISM-BASED dedup/.test(p), `${name} 声明该技能自带机制查重（复用，不重造）`);
  }
  // 架构复核 prompt 还须把「⛔ 不许顺手修」写死（本任务 DoD：缺陷由立出来的任务去做）。
  assert.ok(/Do NOT fix the defect here/.test(archPrompt), "⛔ prompt 禁止 agent 在本轮顺手修");
  // ② 节流侧结构上做不到查重：它从不读任务库（无 tasks/ 读取、无 task_list）——只读自己的提交台账。
  const dedupish = cluster.split("\n").map((l, i) => [i + 1, l])
    .filter(([, l]) => /task_list|taskList|tasks_dir|readdirSync\(.*tasks|readdirSync\(.*"tasks"/.test(l));
  console.log(`AC3 grep — 节流模块里的任务库读取命中 ${dedupish.length} 行（期望 0）`);
  assert.equal(dedupish.length, 0, "⛔ 节流模块不得读任务库 ⇒ 结构上不可能是第二套查重");
  assert.ok(cluster.includes("SUBMISSION_LEDGER_REL"), "节流状态只在自己的提交台账里");
});
