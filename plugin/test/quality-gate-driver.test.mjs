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
  ARCH_REVIEW_MIN_INTERVAL_MINUTES,
  defaultJudgmentConsumerArgv,
  defaultPoolQualityPlanArgv,
  defaultIdentityReplicationArgv,
  defaultGuardLineageArgv,
  defaultDeletionClosureArgv,
  readArchitectureReviewConfig,
  parseArchitectureReviewSection,
  archReviewGateFact,
  formatArchitectureReviewAssembly,
  parseJudgmentConsumerReport,
  parsePoolQualityPlan,
  runJudgmentConsumerCheck,
  runPoolQualityJudge,
  runArchitectureReview,
  archReviewJudgePrompt,
  buildArchGapWorkerPrompt,
  buildPackagingGapWorkerPrompt,
  qualityGateRoutines,
  computeRoundRecord,
  runResidentQualityGateLoop,
  diagnosticExcerpt,
  ARCH_REVIEW_CALL_CAPTURE_DIR_REL,
  ARCH_COVERAGE_ROUTINE_NAME,
  ARCH_COVERAGE_INTERVAL_MIN_DEFAULT,
  ARCH_COVERAGE_MIN_INTERVAL_MINUTES,
  parseArchCoverageSection,
  readArchCoverageConfig,
  buildArchCoverageRoutine,
  archCoverageRoutineFromConfig,
  runArchCoverageRound,
  formatArchCoverageAssembly,
  ARCH_CYCLE_ROUTINE_NAME,
  ARCH_CYCLE_INTERVAL_MIN_DEFAULT,
  ARCH_CYCLE_MIN_INTERVAL_MINUTES,
  ARCH_CYCLE_HISTORY_REL,
  parseArchCycleSection,
  readArchCycleConfig,
  archCycleRoutineFromConfig,
  runArchCycleRound,
  formatArchCycleAssembly,
  DESIGN_EVOLUTION_ROUTINE_NAME,
  DESIGN_EVOLUTION_INTERVAL_MIN_DEFAULT,
  DESIGN_EVOLUTION_HISTORY_REL,
  designEvolutionRoutineFromConfig,
  runDesignEvolutionRound,
  formatDesignEvolutionAssembly,
  ADR_ENFORCEMENT_ROUTINE_NAME,
  ADR_ENFORCEMENT_INTERVAL_MIN_DEFAULT,
  ADR_ENFORCEMENT_MIN_INTERVAL_MINUTES,
  ADR_SELFCHECK_NOT_EVALUATED_EXIT,
  parseAdrEnforcementSection,
  readAdrEnforcementConfig,
  adrEnforcementRoutineFromConfig,
  runAdrEnforcementRound,
  adrEnforcementExitCode,
  formatAdrEnforcementAssembly,
  INSTRUMENT_DECAY_ROUTINE_NAME,
  INSTRUMENT_DECAY_INTERVAL_MIN_DEFAULT,
  INSTRUMENT_DECAY_MIN_INTERVAL_MINUTES,
  parseInstrumentDecaySection,
  readInstrumentDecayConfig,
  instrumentDecayRoutineFromConfig,
  buildInstrumentDecayRoutine,
  runInstrumentDecayRound,
  buildInstrumentDecayGapWorkerPrompt,
  readPriorInstrumentDecayFilings,
  formatInstrumentDecayAssembly,
} from "../scripts/quality-gate-driver.ts";
// 同一个读数函数的两个面：例行程把它写进 Fact，AC1 的「可从 .archguard/query/ 独立复现」直接对
// **读函数**做（⛔ 不另写一份解析，否则只是证明夹具自洽）。
import { readGraphSummaryReading, TOP_OUT_DEGREE_LIMIT_DEFAULT } from "../scripts/archguard-runner.ts";
// judge 调用的失败归因/重试是【从 OSD 复用】的（硬规则 5b）——测试直接断言那**同一个**清单与分类器，
// ⛔ 不是断言本文件里另写的一份。
import {
  RETRYABLE_CALL_FAILURES, callFailureClass, spawnModelCall,
  runOpenSemanticDiscovery, readOpenSemanticDiscoveryConfig,
} from "../scripts/open-semantic-discovery-routine.ts";
// AC3 的台账判据读的是**真**预留台账（`openModelBudget`：真锁 + 真 ledger 文件 + 真 reserve/outcome 两行），
// ⛔ 不是记账替身 —— 替身只会证明替身自洽。
import {
  reservingModel, openModelBudget, BUDGET_LEDGER_REL, BUDGET_LOCK_REL,
  runDiscoveryMethod, latestResidentRoundTs, INVOKED_BY_RESIDENT,
} from "../scripts/discovery-method-routine.ts";
import { ROUTINE_LAST_RUN_REL } from "../scripts/probe-routine.ts";
import { StoppedMidRoundError } from "../scripts/driver-runtime.ts";
// ⛔ 盘上停机记录的**单一路径**从 kernel 来（`ANCHOR_KIND_STOPS_REL`）：夹具自己拼一个路径字符串就会
// 与生产读的那份漂移，而「夹具读的是生产写的那个文件」正是这条判据的全部意义。
import { ANCHOR_KIND_STOPS_REL } from "../scripts/driver-runtime.ts";
// 同族读函数的**形态对照**（Gap1 的判据：本轨的读函数与兄弟逐键同形）。
import { readDiscoveryMethodConfig } from "../scripts/discovery-method-routine.ts";
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
      ? `process.stdout.write(JSON.stringify({table:[{entity:"session-liveness.sh",code:62,hardcoded:59,accessor:3,codeFiles:["plugin/scripts/a.ts","packages/quay/src/observation.ts"]}],judgmentRewrites:[{file:"plugin/scripts/worker-driver.ts"}],pathConstants:[],byteIdentical:{count:0,pairs:[]},rootSurface:{kind:"full",note:null}}));`
      : `process.stdout.write(JSON.stringify({table:[],judgmentRewrites:[],pathConstants:[],byteIdentical:{count:0,pairs:[]},rootSurface:{kind:"full",note:null}}));`,
  );
}

function fakeLineageScript(tmp, withSuspicious) {
  return writeFixture(
    tmp,
    "fake-lineage.js",
    `process.stdout.write(JSON.stringify({suspicious:${withSuspicious ? '[{basename:"guard-a.ts",dir:"plugin/scripts"}]' : "[]"},declared:[],rootSurface:{kind:"full",note:null}}));`,
  );
}

function fakeDeletionScript(tmp) {
  return writeFixture(
    tmp,
    "fake-deletion.js",
    `process.stdout.write(JSON.stringify({components:["session-liveness.sh"],dc:["plugin/scripts/a.ts","tasks/x.md"],counts:{dcTotal:2,callGraphTotal:1,ratio:2},rootSurface:{kind:"full",note:null}}));`,
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
      + `judgmentRewrites:[],pathConstants:[],byteIdentical:{count:0,pairs:[]},rootSurface:{kind:"full",note:null}}));`,
  );
}

/** deletion 缝：装一个假的 `deletion-closure-check.ts`，让它把收到的构件清单 append 到 logPath 再回
 *  一个合法报告（⛔ 不真跑检测器），并**只在 fn() 期间**把它所在目录设成 kernel 解析基准。
 *
 *  ⚠️ **为什么不用 `deletionCmd` 注入缝**：`deletionCmd` 是**整条 argv 的替代**（driver 里
 *  `deletionCmd ?? defaultDeletionClosureArgv(root, components)`），注入它就把 driver 推导出的构件
 *  **一并绕掉**了——缝里永远看到空参数，断言恒真（硬规则 4）。让缺省 builder 自己解析到 stub，才走
 *  **`defaultDeletionClosureArgv` 这条生产路径**：driver 推导构件 → 拼进缺省 argv → spawn。
 *
 *  ⚠️ **为什么缝从 `<root>/plugin/scripts/` 挪到了 `QUAY_PLUGIN_ROOT`**（本任务 Gap 2）：缺省 builder
 *  现在经 `resolveKernelScriptsDir()` 解析到**本 kernel 自己**的 scripts 目录，⛔ 不再是目标 root 下的
 *  `plugin/scripts/`。把 stub 继续装在 root 下已经接不住它（那只会让**真**检测器去扫 root，而 root 是
 *  这个 tmp ⇒ 本用例会静默变成「真跑了一次检测器」）。`QUAY_PLUGIN_ROOT` 正是
 *  `resolveKernelScriptsDir()` 认的 hermetic 缝（driver-runtime 的注释；同 conformance-target-fixture
 *  等既有测试的手法）。 */
function withFakeDeletionStubUnderKernel(tmp, logPath, fn) {
  const kernelRoot = path.join(tmp, "fake-kernel");
  const dir = path.join(kernelRoot, "scripts");
  fs.mkdirSync(dir, { recursive: true });
  writeFixture(
    dir,
    "deletion-closure-check.ts",
    `const fs=require("node:fs");
const argv=process.argv.slice(2);
const i=argv.indexOf("--root");
const components=i<0?argv:argv.slice(0,i);
fs.appendFileSync(${JSON.stringify(logPath)}, JSON.stringify(components)+"\\n");
process.stdout.write(JSON.stringify({components,dc:["plugin/scripts/a.ts"],counts:{dcTotal:1,callGraphTotal:1,ratio:1},rootSurface:{kind:"full",note:null}}));`,
  );
  const prev = process.env.QUAY_PLUGIN_ROOT;
  process.env.QUAY_PLUGIN_ROOT = kernelRoot;
  return Promise.resolve()
    .then(() => fn())
    .finally(() => {
      if (prev === undefined) delete process.env.QUAY_PLUGIN_ROOT;
      else process.env.QUAY_PLUGIN_ROOT = prev;
    });
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
  // ⚠️ root 是**空工作区**（不是 REPO_ROOT）：driver 把 `.quay/config.yml` `loop.routines:` 里
  // 声明的 probe 例程装进例程表（gap-productize-deep-semantic-dedup-scan-routine），若 root=主检出，
  // 这条 `--once` 用例的 facts 集合就会随该工作区 gitignored 的 config 内容漂移，且会真的 spawn 一个
  // 探针 agent。空 root（= 本用例自己的 tmp，由 t.after 清理）⇒ 无声明。
  // 例程表 = 四条内建 + **默认装配**的 architecture-analysis（gap-architecture-analysis-probe-not-
  // wired-into-driver-routine-or-init）：后者在空 root 上因**本机无 archguard 仪器**记一条
  // `not-evaluated`（仪器前置，零 spawn）——这正是 AC2 的 no-archguard 形态。
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
    // 负控制缝：本机 PATH 上有没有真的 archguard 不该决定这条用例的结论。
    // `ARCHGUARD_RUNNER_CLI` 指向不存在的路径 ⇒ resolveArchguardCli() 返回 null（它不会回落到 PATH）。
    { encoding: "utf8", timeout: 120_000, env: { ...process.env, ARCHGUARD_RUNNER_CLI: path.join(tmp, "no-such-archguard") } },
  );
  assert.equal(r.status, 0, `driver --once should exit 0 (stderr: ${r.stderr})`);
  const lines = fs.readFileSync(roundLog, "utf8").split("\n").filter((l) => l.trim());
  assert.equal(lines.length, 1, "one round ⇒ one heartbeat line");
  const rec = JSON.parse(lines[0]);
  assert.equal(rec.halted, false);
  assert.equal(rec.facts.length, 6, "first round ⇒ all six routines due (never-ran ⇒ interval due; four built-in + the default architecture-analysis + the DEFAULT-ON adr-enforcement-report)");
  const names = rec.facts.map((f) => f.name).sort();
  assert.deepEqual(names, ["adr-enforcement-report", "architecture-analysis", "architecture-review", "judgment-consumer-check", "packaging-hygiene", "pool-quality-judge"]);
  // 空 root 没有任何 `gates.adr` 声明 ⇒ 新例程记「无可执行的 ADR」（NOT-EVALUATED），⛔ 不是静默绿。
  const adrFact = rec.facts.find((f) => f.name === ADR_ENFORCEMENT_ROUTINE_NAME);
  assert.equal(adrFact.state, "not-evaluated");
  assert.match(adrFact.reason, /no-enforcing-adr/);
  // 空 root 无 archguard ⇒ 默认例程是**可读的** not-evaluated（不是 spawn 错误、也不是「跑了没发现」）。
  const arch = rec.facts.find((f) => f.name === "architecture-analysis");
  assert.equal(arch.state, "not-evaluated");
  assert.match(arch.reason, /instrument 'archguard' unavailable on this host/);
  assert.match(arch.reason, /fallback declared: 'git-lens'/);
  assert.equal(arch.value.fired, false, "zero spawn");
});

// ── gap-architecture-analysis-probe-not-wired-into-driver-routine-or-init ──────────────────────────
// AC1（装配判定）：`architecture-analysis` probe 被一条 standing routine **默认装配**——dev 工作区的
// 形态是「声明了、但 trigger 是退役的 every(10) ⇒ probe 轨道跳过它」，默认装配必须补上这个洞，
// 且装配行（stderr）点名它。AC2 的 no-archguard 半边：本机没有 archguard 时记**可读的**
// not-evaluated（零 spawn），⛔ 不是 spawn 错误、⛔ 不是「跑了没发现问题」。
// 两个方向都给控制：正控制把 archguard 可用性缝打开 ⇒ 同一条例程真的跑到 spawn 并产出 Fact，
// 否则「not-evaluated」可能只是「这条例程恒不工作」的另一种形状（硬规则 3b/4）。
test("AC1/AC2 — architecture-analysis is default-assembled; missing archguard ⇒ legible not-evaluated (zero spawn)", (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "qg-archprobe-"));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  spawnSync("git", ["-C", tmp, "init", "-q"], { encoding: "utf8" });
  // 本仓库 dev 工作区 `.quay/config.yml` 的真实形态：声明了，但 trigger 属于退役的迭代计数文法 ⇒
  // probe 轨道把它跳过（stderr 可见），例程表里本来没有它。
  writeConfig(tmp, "loop:\n  routines:\n    - name: architecture-analysis\n      trigger: every(10)\n      probe: architecture-analysis\n");
  const planCmd = writeFixture(tmp, "p.js", `process.stdout.write(JSON.stringify({triggers:{fired:false,reasons:[],poolCount:0,oldestUnreviewedAgeMs:0,roundsSinceLastJudge:0},pool:[],tasks:[],lastJudgeState:{status:"ok"}}));`);
  const judgmentCmd = writeFixture(tmp, "j.js", `process.stdout.write(JSON.stringify({mode:"judgment-consumer-audit",judgments_total:1,wired:1,unfinished:[],drift:false}));`);
  const packagingCmd = writeFixture(tmp, "k.js", `process.stdout.write(JSON.stringify({mode:"packaging-hygiene-audit",configKeys:{keysTotal:0,noConsumerToWire:[],state:"verified"},shippedEntries:{state:"verified",violations:[],reason:null},drift:[]}));`);
  const probeLog = path.join(tmp, "probe-spawns.log");
  const probeRunner = writeFixture(tmp, "probe.js",
    `require("node:fs").appendFileSync(${JSON.stringify(probeLog)},"spawned\\n");`
    + `process.stdout.write(JSON.stringify({findings:[],shards:1,inventory:{files:0},notes:"fixture"}));`);

  const runDriver = (label, archguardPath) => {
    const roundLog = path.join(tmp, `round-${label}.jsonl`);
    const r = spawnSync(process.execPath, ["--experimental-strip-types",
      path.join(REPO_ROOT, "plugin", "scripts", "quality-gate-driver.ts"),
      "--root", tmp, "--once", "--round-log", roundLog,
      "--plan-cmd", `node ${planCmd}`, "--judgment-cmd", `node ${judgmentCmd}`,
      "--packaging-check-cmd", `node ${packagingCmd}`,
      "--identity-cmd", `node ${fakeIdentityScript(tmp, false)}`,
      "--lineage-cmd", `node ${fakeLineageScript(tmp, false)}`,
      "--probe-runner-cmd", `node ${probeRunner}`],
      { encoding: "utf8", timeout: 120_000, env: { ...process.env, ARCHGUARD_RUNNER_CLI: archguardPath } });
    assert.equal(r.status, 0, `driver --once exit 0 (stderr: ${r.stderr})`);
    const rec = JSON.parse(fs.readFileSync(roundLog, "utf8").split("\n").filter((l) => l.trim())[0]);
    return { fact: rec.facts.find((f) => f.name === "architecture-analysis"), stderr: r.stderr };
  };

  // (a) 本机没有 archguard（缝指向不存在的路径）⇒ 装配行点名 + legible not-evaluated + 零 spawn。
  const missing = runDriver("missing", path.join(tmp, "no-such-archguard"));
  assert.match(missing.stderr, /routine "architecture-analysis" \(every\(10\)\) 未被 probe 轨道驱动/,
    "the legacy declaration is still reported as skipped (⛔ not silently absorbed)");
  assert.match(missing.stderr, /probe 轨道已装配 1 条例程（architecture-analysis；.*默认装配: architecture-analysis \(interval:1440m\)/,
    `AC1: the assembly line must name the default-assembled routine; got:\n${missing.stderr}`);
  assert.equal(missing.fact.state, "not-evaluated");
  assert.match(missing.fact.reason, /instrument 'archguard' unavailable on this host/);
  assert.match(missing.fact.reason, /fallback declared: 'git-lens'/, "the reason names the declared fallback");
  assert.equal(missing.fact.value.fired, false);
  assert.ok(!fs.existsSync(probeLog), "instrument unavailable ⇒ ZERO spawn (not a spawn error)");

  // (b) 正控制：同一条例程 + 可用性缝打开（ARCHGUARD_RUNNER_CLI 指向一个存在的文件）⇒ 真的 spawn。
  //     清掉持久 last-run 窗口，否则第二跑会因「窗口内不重触发」而 not-evaluated（那是另一条判据）。
  fs.rmSync(path.join(tmp, ".quay", "routine-last-run.json"), { force: true });
  const present = runDriver("present", probeRunner);
  assert.equal(present.fact.state, "verified", `with the instrument present the probe must actually run; got ${present.fact.state}: ${present.fact.reason}`);
  assert.equal(present.fact.value.fired, true);
  assert.equal(present.fact.value.probe, "architecture-analysis");
  assert.equal(fs.readFileSync(probeLog, "utf8").trim().split("\n").length, 1, "exactly one probe spawn");
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
  // AC3 — judged 记录同样带 per-detector 状态（每条记录都必须带，不是只有 not-triggered 带）。
  assert.ok(Array.isArray(rec.detectors), "judged record carries a detectors array");
  assert.equal(rec.detectors.length, 3);
  assert.ok(rec.detectors.every((d) => d.evaluated === true), `all detectors evaluated on the fired path: ${JSON.stringify(rec.detectors)}`);
});

test("AC3 — runArchitectureReview not-triggered ⇒ verified fired=false + not-triggered record (all detectors evaluated)", async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "qg-arch-nt-"));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const { identityCmd, lineageCmd } = archReviewCmd(tmp, { withEntity: false, withSuspicious: false });
  const fact = await runArchitectureReview(tmp, identityCmd, lineageCmd, null, null);
  assert.equal(fact.state, "verified");
  assert.equal(fact.value.fired, false);
  assert.equal(fact.value.clusterCount, 0);
  const rec = JSON.parse(fs.readFileSync(archReviewRoundPath(tmp), "utf8").split("\n").filter((l) => l.trim()).pop());
  assert.equal(rec.state, "not-triggered");
  // AC3（gap-architecture-review-not-triggered-lacks-per-detector-state）：载体带 per-detector 状态，
  // 且 not-triggered 的真条件（每个检测器都评估过 ∧ 无簇）在**写出来的记录**上成立。
  assert.ok(Array.isArray(rec.detectors), "record carries a detectors array");
  assert.equal(rec.detectors.length, 3);
  for (const d of rec.detectors) {
    for (const k of ["id", "evaluated", "reason", "clusters"]) assert.ok(k in d, `detector ${d.id} carries ${k}`);
  }
  assert.ok(rec.detectors.every((d) => d.evaluated && d.clusters.length === 0),
    `AC2: not-triggered ⇒ every detector evaluated && clusters empty (got ${JSON.stringify(rec.detectors)})`);
});

// gap-architecture-review-not-triggered-lacks-per-detector-state AC1（driver 边界）：
// 检测器输出里**没有 rootSurface**（或 rootSurface 报不在）⇒ 本轮必须是 not-evaluated，
// 记录带该 detector 的 reason，⛔ 绝不写 not-triggered。负控制：同一组命令只把 rootSurface
// 补成 full ⇒ 状态翻成 not-triggered（证明判据是 rootSurface 造成的，不是「这个 root 恒不评估」）。
test("AC1 — 检测器没有候选宇宙 ⇒ not-evaluated（记录带 reason），补上 rootSurface 后翻成 not-triggered", async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "qg-arch-ne-"));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const bareIdentity = writeFixture(tmp, "bare-identity.js",
    `process.stdout.write(JSON.stringify({table:[],judgmentRewrites:[],pathConstants:[],byteIdentical:{count:0,pairs:[]}}));`);
  const bareLineage = writeFixture(tmp, "bare-lineage.js",
    `process.stdout.write(JSON.stringify({suspicious:[],declared:[]}));`);

  const fact = await runArchitectureReview(tmp, ["node", bareIdentity], ["node", bareLineage], null, null);
  assert.equal(fact.state, "not-evaluated", "缺 rootSurface ⇒ ⛔ 不得读成「三个检测器都评估且干净」");
  assert.match(fact.reason, /not-evaluated/, `reason=${fact.reason}`);
  const rec = JSON.parse(fs.readFileSync(archReviewRoundPath(tmp), "utf8").split("\n").filter((l) => l.trim()).pop());
  assert.equal(rec.state, "not-evaluated", "⛔ 不得写 not-triggered");
  assert.ok(rec.detectors.some((d) => !d.evaluated && /no rootSurface/.test(d.reason)),
    "记录必须带未评估 detector 的 reason");

  // 负控制：同一 root 上只把 rootSurface 补成 full ⇒ 状态必须翻转（判据能取假）。
  const fullIdentity = writeFixture(tmp, "full-identity.js",
    `process.stdout.write(JSON.stringify({table:[],judgmentRewrites:[],pathConstants:[],byteIdentical:{count:0,pairs:[]},rootSurface:{kind:"full",note:null}}));`);
  const fullLineage = writeFixture(tmp, "full-lineage.js",
    `process.stdout.write(JSON.stringify({suspicious:[],declared:[],rootSurface:{kind:"full",note:null}}));`);
  const ok = await runArchitectureReview(tmp, ["node", fullIdentity], ["node", fullLineage], null, null);
  assert.equal(ok.state, "verified", `补上 rootSurface 后应翻成 not-triggered（reason=${ok.reason}）`);
  const rec2 = JSON.parse(fs.readFileSync(archReviewRoundPath(tmp), "utf8").split("\n").filter((l) => l.trim()).pop());
  assert.equal(rec2.state, "not-triggered");
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
  // deletionCmd=null ⇒ 走 defaultDeletionClosureArgv(root, components)（生产路径）；它现在解析到
  // **kernel** 的 scripts 目录 ⇒ stub 经 QUAY_PLUGIN_ROOT 接住它。judgeArgv=null 且 halted=true ⇒
  // 步骤 5 提前返回：⛔ 不 spawn 真 claude -p，也不落判词载体；但步骤 1-3（identity spawn → 推导构件
  // → deletion spawn）已全部跑完——那正是本条的观测面。
  await withFakeDeletionStubUnderKernel(tmp, logPath, () =>
    runArchitectureReview(tmp, identityCmd, lineageCmd, null, null, null, false, Infinity, true));

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
  assert.ok(Array.isArray(rec.detectors), "failed record also carries per-detector states (AC3)");
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

// ── 上一轮 findings 逐条复核（gap-arch-review-judge-consumes-prior-round-findings）────────────────
// AC1：judge 输入带上上一轮 arch-review-round 的逐簇判词，输出逐条 survived/resolved/denied 三态，
//      与 clusters **同一载体**（round jsonl）。
// AC2：resolved/denied 的依据必须是 current-source 核对（file:line / grep 命中）——「任务库里有 done
//      任务」在**机械侧**被降级为 not-evaluated（prompt 措辞不是执行点）。

const FOUR_CLUSTER_VERDICTS = [
  { clusterId: "P2-identity-session-liveness.sh", verdict: "abstract", reasoning: "dup naming", suggestedAction: "consolidate", actionable: true },
  { clusterId: "P1-deletion-closure", verdict: "coincidental", reasoning: "narrative refs", suggestedAction: "keep", actionable: false },
  { clusterId: "P2-judgment-rewrites", verdict: "abstract", reasoning: "same fingerprint 2x", suggestedAction: "merge", actionable: true },
  { clusterId: "P4-suspicious-guards", verdict: "uncertain", reasoning: "preventive?", suggestedAction: "human", actionable: false },
];

test("AC1/AC2 — prompt 含上一轮 findings 清单 + current-source 要求（不是任务库引用）", () => {
  const clusters = [{ clusterId: "P2-identity-x", primitive: "P2", files: ["plugin/scripts/a.ts"], rawCount: 6, label: "dup" }];
  const prior = [{
    clusterId: "P4-suspicious-guards", primitive: "P4", label: "guard never fired", files: ["plugin/scripts/g.ts"],
    priorVerdict: "coincidental", priorReasoning: "preventive?", priorSuggestedAction: "keep", priorRound: 9, priorJudgedAt: "2026-10-20T00:00:00.000Z",
  }];
  const withPrior = archReviewJudgePrompt(clusters, "/repo", prior);
  assert.match(withPrior, /Prior-round findings \(round 9/, "prompt 点名上一轮");
  assert.ok(withPrior.includes("P4-suspicious-guards"), "prompt 带每条 prior finding 的 clusterId");
  assert.ok(withPrior.includes("priorVerdict=coincidental"), "被否认的（coincidental）也在清单里");
  for (const token of ["survived", "resolved", "denied", "not-evaluated"]) {
    assert.ok(withPrior.includes(token), `prompt 必须给出 ${token} 这个词（判词词表）`);
  }
  assert.match(withPrior, /CURRENT source/i, "判定依据必须点名 current source");
  assert.match(withPrior, /Do NOT cite the task store/, "prompt 明确禁止任务库引用");
  assert.ok(withPrior.includes('"priorFindings"'), "prompt 规定输出形态含 priorFindings");
  // 首轮：没有上一轮 findings ⇒ 明说为空，⛔ 不是含糊省略。
  assert.match(archReviewJudgePrompt(clusters, "/repo"), /No prior-round findings/);
});

test("AC1/AC2 — 第二轮载体带逐条三态；task-store 依据的 denied 被降级为 not-evaluated", async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "qg-arch-prior-"));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const { identityCmd, lineageCmd, deletionCmd, gateArgv, gapWorkerCmd } = archReviewCmd(tmp);
  const recs = () => fs.readFileSync(archReviewRoundPath(tmp), "utf8").split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l));

  // 第一轮：judge 输出裸数组（旧形态也在支持范围内），没有上一轮 ⇒ 「none」而不是「checked」。
  const r1 = await runArchitectureReview(tmp, identityCmd, lineageCmd, deletionCmd,
    ["node", fakeArchJudgeWith(tmp, "judge-prior-r1.js", FOUR_CLUSTER_VERDICTS)], gateArgv, true, Infinity, false, gapWorkerCmd);
  assert.equal(r1.state, "verified");
  const rec1 = recs()[0];
  assert.equal(rec1.priorRound.state, "none", "首轮没有上一轮 judged 记录");
  assert.equal(rec1.priorFindingsState, "none");
  assert.deepEqual(rec1.priorFindings, []);

  // 第二轮：judge 输出 {clusters, priorFindings}。四条 prior finding：resolved(源码核对) /
  // survived(源码核对) / denied(只引用 done 任务 ⇒ 必须降级) / 缺判词(⇒ 未评估)。
  const judge2 = {
    clusters: FOUR_CLUSTER_VERDICTS,
    priorFindings: [
      { clusterId: "P2-identity-session-liveness.sh", state: "resolved", evidence: "grep -rn 'session-liveness.sh' plugin/scripts → 0 hits" },
      { clusterId: "P1-deletion-closure", state: "survived", evidence: "plugin/scripts/identity-replication-check.ts:120 still emits the inflated closure" },
      { clusterId: "P2-judgment-rewrites", state: "denied", evidence: "tasks/gap-already-done.md is done" },
      // P4-suspicious-guards 没给判词
    ],
  };
  const r2 = await runArchitectureReview(tmp, identityCmd, lineageCmd, deletionCmd,
    ["node", fakeArchJudgeWith(tmp, "judge-prior-r2.js", judge2)], gateArgv, true, Infinity, false, gapWorkerCmd);
  assert.equal(r2.state, "verified");
  assert.equal(r2.value.priorFindingCount, 4, "四条 prior finding 全部进读数");
  assert.equal(r2.value.priorFindingsState, "partial", "部分拿到三态 ⇒ partial（⛔ 不写成 checked）");
  assert.equal(r2.value.priorResolved, 1);
  assert.equal(r2.value.priorSurvived, 1);
  assert.equal(r2.value.priorDenied, 0, "task-store 依据不足以判 denied");
  assert.equal(r2.value.priorNotEvaluated, 2);
  assert.match(r2.reason, /prior-findings partial/);

  const rec2 = recs()[1];
  assert.equal(rec2.state, "judged");
  assert.equal(rec2.priorFindingsState, "partial", "三态写进**同一载体**（跟 clusters 同一条记录）");
  assert.equal(rec2.priorRound.state, "read");
  assert.equal(rec2.priorRound.findingCount, 4);
  const byId = Object.fromEntries(rec2.priorFindings.map((r) => [r.clusterId, r]));
  assert.equal(byId["P2-identity-session-liveness.sh"].state, "resolved");
  assert.equal(byId["P2-identity-session-liveness.sh"].evidenceSource, "current-source");
  assert.equal(byId["P1-deletion-closure"].state, "survived");
  assert.equal(byId["P1-deletion-closure"].evidenceSource, "current-source");
  assert.equal(byId["P2-judgment-rewrites"].state, "not-evaluated", "只引用 done 任务的 denied ⇒ 降级");
  assert.equal(byId["P2-judgment-rewrites"].evidenceSource, "task-store");
  assert.match(byId["P2-judgment-rewrites"].reason, /current-source/);
  assert.equal(byId["P4-suspicious-guards"].state, "not-evaluated", "缺判词 ⇒ 未评估（⛔ 不折叠成 denied）");
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

// ── gap-arch-gap-filing-dedup-any-status-blocks-refile：done 的 claim ≠ 缺陷不存在（硬规则 5b）──
// 旧的单一「ANY status ⇒ do NOT file a duplicate」把 done 任务当成「修好了」的证据；而 done 只能
// 说明【当时】有人认领过，缺陷仍可能留在当前源码里 ⇒ 缺口被静默吞掉、无人再认领。修法：open 与
// done 两条规则拆开，done 分支先做 current-source 复核（file:line / grep 命中），仍可见则重立并带
// 旧任务 id 作 traceability。

test("AC — gap-filing dedup 区分 OPEN 与 DONE claim；done 分支需 current-source 复核（done ≠ absent）", () => {
  const prompts = [
    ["architecture-review", buildArchGapWorkerPrompt("/repo", [])],
    ["packaging", buildPackagingGapWorkerPrompt("/repo", ["drift-x"])],
  ];
  for (const [name, p] of prompts) {
    assert.ok(!p.includes("(ANY status)"), `${name}: ⛔ 不再有覆盖 done 的「ANY status ⇒ 不重立」`);
    assert.ok(p.includes("OPEN claim"), `${name}: 明列 open 分支`);
    assert.ok(p.includes("DONE/superseded claim"), `${name}: 明列 done 分支（可与 open 区分）`);
    const doneRule = p.split("\n").find((l) => l.includes("DONE/superseded claim"));
    assert.ok(doneRule && /CURRENT SOURCE/.test(doneRule), `${name}: done claim 必须先 current-source 复核`);
    assert.ok(doneRule && /STILL visible/.test(doneRule) && /FILE the task/.test(doneRule),
      `${name}: 缺陷仍可见 ⇒ 重立（⛔ 不无条件不立）`);
    assert.ok(doneRule && /prior-claim: <id>/.test(doneRule), `${name}: 重立时带旧任务 id 作 traceability`);
  }
});

// ── gap-cross-project-dogfood-quay-self-usage-c1-a7wnts：失败面必须携带原始仪器输出 ───────────────
// 轮的 claim：judge 打印非 JSON stdout 时，round 记 state=failed / 零判词，却只写一条【固定】reason，
// 原始 stdout 被丢弃 ⇒ 失败不可诊断。修法：失败 reason 并入【单行、有界】的原始输出
// （diagnosticExcerpt；与同函数 judge-exit 分支已把 stderr slice(0,200) 并入 reason 同形）。
// ⛔ 三态语义不变（failed 仍 failed / not-evaluated 仍 not-evaluated）——只让失败【可诊断】。

test("AC1 — diagnosticExcerpt：单行化 / 空输出显式标注 / 超长截断带计数", () => {
  assert.equal(diagnosticExcerpt(""), "(empty output)", "空输出显式标注（空 ≠ 有内容）");
  assert.equal(diagnosticExcerpt("   \n\t "), "(empty output)", "纯空白 = 空输出");
  assert.equal(diagnosticExcerpt("a\nb\tc  d"), "a b c d", "多行/制表压成单行（⛔ 不撕开载体行）");
  const long = "x".repeat(600);
  const cut = diagnosticExcerpt(long);
  assert.ok(cut.startsWith("x".repeat(500)), "截到缺省 max（500）");
  assert.match(cut, /\+100 chars, truncated\)$/, "截断带剩余计数（输出其实很大不被误读成很小）");
  assert.equal(diagnosticExcerpt(long, 0), "…(+600 chars, truncated)", "max 可注入（测试缝，判据能取假）");
});

test("AC1 — pool-quality-judge：judge 非 JSON stdout ⇒ failed/零判词 + 载体保留原始输出", async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "qg-repro-pool-"));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const planCmd = ["node", fakePlanScript(tmp, true)];
  const gateArgv = ["node", fakeGateGoScript(tmp)];
  const MARKER = "I cannot produce a JSON array for this request.";
  const badJudge = writeFixture(tmp, "fake-bad-judge.js", `process.stdout.write(${JSON.stringify(MARKER)});`);
  const fact = await runPoolQualityJudge(tmp, planCmd, ["node", badJudge], gateArgv);
  // claim 的形状部分仍成立（本任务不改三态）：state=failed、零判词。
  assert.equal(fact.state, "failed", "读不懂 judge 输出 ⇒ failed（⛔ 非 verified）");
  const rec = JSON.parse(fs.readFileSync(qualityRoundPath(tmp), "utf8").split("\n").filter((l) => l.trim()).pop());
  assert.equal(rec.state, "failed");
  assert.equal(rec.verdicts.length, 0, "零判词（与 claim 一致）");
  // 缺陷已修：原始 stdout 随失败记录一起落盘（此前只有固定串，故本条在修复前必红）。
  assert.match(rec.reason, /not a JSON array/, "保留既有前缀（下游 grep 不回归）");
  assert.ok(rec.reason.includes(MARKER), "载体 reason 携带 judge 原始 stdout");
  assert.ok(fact.reason.includes(MARKER), "返回的 Fact.reason 同形携带原始输出");
});

test("AC2 — architecture-review：judge 非 JSON stdout ⇒ failed + 载体保留原始输出", async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "qg-repro-arch-"));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const { identityCmd, lineageCmd, deletionCmd, gateArgv, gapWorkerCmd } = archReviewCmd(tmp);
  const MARKER = "<html>502 Bad Gateway</html>";
  const badJudge = writeFixture(tmp, "fake-bad-arch-judge.js", `process.stdout.write(${JSON.stringify(MARKER)});`);
  const fact = await runArchitectureReview(tmp, identityCmd, lineageCmd, deletionCmd, ["node", badJudge], gateArgv, true, Infinity, false, gapWorkerCmd);
  assert.equal(fact.state, "failed");
  const rec = JSON.parse(fs.readFileSync(archReviewRoundPath(tmp), "utf8").split("\n").filter((l) => l.trim()).pop());
  assert.equal(rec.state, "failed");
  assert.equal(rec.clusters.length, 0, "零判词（与 claim 一致）");
  assert.match(rec.reason, /not a JSON array/);
  assert.ok(rec.reason.includes(MARKER), "载体 reason 携带 judge 原始 stdout（修复前必红）");
});

test("AC2 — 同族失败面（硬规则 5b）：--plan 非 JSON stdout ⇒ not-evaluated 且携带原始输出", async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "qg-repro-plan-"));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const MARKER = "plan: internal error, no JSON emitted";
  const badPlan = writeFixture(tmp, "fake-bad-plan.js", `process.stdout.write(${JSON.stringify(MARKER)});`);
  const fact = await runPoolQualityJudge(tmp, ["node", badPlan], null, null);
  assert.equal(fact.state, "not-evaluated", "读不懂 --plan ⇒ not-evaluated（⛔ 非 verified）");
  assert.match(fact.reason, /unparseable --plan output/);
  assert.ok(fact.reason.includes(MARKER), "同一载体里的兄弟失败点也携带原始输出");
});

// ══ gap-architecture-review-wrong-root-detector-argv-and-no-config-driven-host-entry ═════════════
// 两个结构性不可部署缺陷的判定面：
//   Gap 1 —— architecture-review 此前**只能**由 CLI flag 驱动（`loop.architecture_review:` 键无人认领）；
//   Gap 2 —— 三个检测器的 spawn 路径锚在【被分析的目标 root】而不是本 kernel 的 scripts 目录。

function writeConfig(tmp, body) {
  const dir = path.join(tmp, ".quay");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "config.yml"), body, "utf8");
}

test("Gap1 — readArchitectureReviewConfig：缺席/启用/关停/写坏四态（fail-closed，硬规则 3b）", (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "qg-arcfg-"));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));

  // 缺席（无 config.yml / 有 config 但无 loop / 有 loop 但无本段）⇒ present:false，⛔ 不是「关停」
  assert.deepEqual(readArchitectureReviewConfig(tmp), { present: false, config: null, error: null });
  writeConfig(tmp, "loop: {}\n");
  assert.equal(readArchitectureReviewConfig(tmp).present, false, "无本段 ⇒ present:false（老行为 = 默认开）");

  // 启用 + 合法 interval
  writeConfig(tmp, 'loop:\n  architecture_review:\n    enabled: true\n    interval: "interval:120m"\n');
  assert.deepEqual(readArchitectureReviewConfig(tmp), {
    present: true, config: { enabled: true, intervalMinutes: 120 }, error: null,
  });

  // 关停（kill switch）：enabled:false 立即返回，⛔ 不要求 interval
  writeConfig(tmp, "loop:\n  architecture_review:\n    enabled: false\n");
  assert.deepEqual(readArchitectureReviewConfig(tmp), {
    present: true, config: { enabled: false, intervalMinutes: null }, error: null,
  });

  // 写坏：enabled 缺失 / 非法 interval / 低于下限 —— 一律 error 置位（⛔ 不得被读成 present+config）
  for (const [body, re] of [
    ['loop:\n  architecture_review:\n    interval: "interval:60m"\n', /needs a boolean 'enabled'/],
    ['loop:\n  architecture_review:\n    enabled: true\n', /needs an 'interval' string/],
    ['loop:\n  architecture_review:\n    enabled: true\n    interval: "every(3)"\n', /must be interval:<N>m/],
    ['loop:\n  architecture_review:\n    enabled: true\n    interval: "interval:5m"\n', /below the 60m floor/],
  ]) {
    writeConfig(tmp, body);
    const read = readArchitectureReviewConfig(tmp);
    assert.equal(read.present, true);
    assert.equal(read.config, null, `${JSON.stringify(body)} ⇒ config 必须是 null`);
    assert.match(read.error, re);
  }
  assert.equal(ARCH_REVIEW_MIN_INTERVAL_MINUTES, 60, "下限与同族（arch_discovery/cross_project_dogfood）一致");
});

test("Gap1 — 返回形态与同族 read<Name>Config 逐键相同（{present,config,error}）", (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "qg-arcfg-shape-"));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  writeConfig(tmp, 'loop:\n  architecture_review:\n    enabled: true\n    interval: "interval:60m"\n  discovery_method:\n    enabled: false\n');
  const ours = readArchitectureReviewConfig(tmp);
  const sibling = readDiscoveryMethodConfig(tmp);
  assert.deepEqual(
    Object.keys(ours).sort(),
    Object.keys(sibling).sort(),
    "同族读函数返回同一组键（装配点可以一视同仁地消费两者）",
  );
  assert.equal(ours.present, true);
});

test("Gap1 — 门态 ≠ enabled ⇒ 例程只回一条 Fact 且【零 spawn】（正负对照）", async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "qg-argate-"));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const spawnLog = path.join(tmp, "spawns.log");
  // 会被 spawn 才能写下的痕迹：identity 命令 append 一行。装在**命令缝**上，于是「有没有 spawn」
  // 是一个可断言的文件事实，⛔ 不是从 Fact 形态倒推出来的。
  const markerCmd = ["node", writeFixture(tmp, "marker.js",
    `const fs=require("node:fs");fs.appendFileSync(${JSON.stringify(spawnLog)},"spawned\\n");process.stdout.write(JSON.stringify({table:[],judgmentRewrites:[],pathConstants:[],byteIdentical:{count:0,pairs:[]}}));`)];
  const lineageCmd = ["node", fakeLineageScript(tmp, false)];
  const baseOpts = {
    planCmd: null, judgeArgv: null, judgmentCmd: null, resourceGateArgv: null,
    identityCmd: markerCmd, lineageCmd, deletionCmd: null, archJudgeArgv: null,
    poolJudgeIntervalMinutes: 10, judgmentIntervalMinutes: 30, archReviewIntervalMinutes: 60,
    packagingCheckCmd: null, packagingGapWorkerCmd: null, packagingGapWorkerTimeoutMs: 900_000,
    packagingHygieneIntervalMinutes: 60, archGapWorkerCmd: null, archGapWorkerTimeoutMs: 900_000,
  };
  const arch = (gate) => qualityGateRoutines(tmp, gate ? { ...baseOpts, archReviewGate: gate } : baseOpts)
    .find((r) => r.name === "architecture-review");

  // 正控制：门态 enabled ⇒ 检测器真的被 spawn（否则下面的「零 spawn」断言恒真）
  const ok = await arch({ state: "enabled" }).run({ halted: true });
  assert.equal(ok.length, 1);
  assert.equal(ok[0].value.fired, false);
  assert.equal(fs.readFileSync(spawnLog, "utf8").trim(), "spawned", "enabled ⇒ spawn 恰一次");

  // 负控制 1：config 关停 ⇒ not-evaluated + 零 spawn
  fs.rmSync(spawnLog);
  const off = await arch({ state: "not-evaluated", reason: "not-evaluated:disabled — kill switch" }).run({ halted: false });
  assert.equal(off.length, 1);
  assert.equal(off[0].state, "not-evaluated");
  assert.match(off[0].reason, /disabled/);
  assert.equal(fs.existsSync(spawnLog), false, "关停 ⇒ 连机械检测器都不 spawn（kill switch 必须是整条关掉）");

  // 负控制 2：段写坏 ⇒ failed（⛔ 与 disabled 不同形，硬规则 3）
  const bad = await arch({ state: "failed", reason: "loop.architecture_review needs a boolean 'enabled'" }).run({ halted: false });
  assert.equal(bad[0].state, "failed");
  assert.equal(fs.existsSync(spawnLog), false, "写坏 ⇒ 零 spawn（⛔ 不回退到缺省节奏照跑）");
});

test("Gap2/AC1 — 三个缺省检测器经 kernelSiblingArgv 解析到【本 kernel】的安装位置；都缺席 ⇒ null（⛔ 不回退 target root）", (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "qg-arkernel-"));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const kernelRoot = path.join(tmp, "kernel");
  fs.mkdirSync(path.join(kernelRoot, "scripts"), { recursive: true });
  const TARGET = "/some/other/project";  // 一个**没有** plugin/scripts 的宿主项目 root
  const DETECTORS = ["identity-replication-check", "guard-lineage-check", "deletion-closure-check"];
  const prev = process.env.QUAY_PLUGIN_ROOT;
  process.env.QUAY_PLUGIN_ROOT = kernelRoot;
  try {
    // (a) kernel 侧两种形态都缺席 ⇒ **null**（调用方记 not-evaluated:detector-script-unresolved:<name>）。
    //     修复前的形态是拼一条 `path.join(kernelScriptsDir, "<name>.ts")`——一个必然 ENOENT 的路径，
    //     其 spawn 结果（exit 1 + 空 stdout）与「跑过了、没数据」同形 (硬规则 3b)。
    assert.equal(defaultIdentityReplicationArgv(TARGET), null);
    assert.equal(defaultGuardLineageArgv(TARGET), null);
    assert.equal(defaultDeletionClosureArgv(TARGET, ["a.sh"]), null);

    // (b) 只有 dist bundle（出厂安装形态：raw .ts 被 publish 的 strip 步删掉）⇒ 解析到 scripts/dist/*.js，
    //     ⛔ 不带 --experimental-strip-types。这正是真实宿主上 164 次失败的成因 1。
    fs.mkdirSync(path.join(kernelRoot, "scripts", "dist"), { recursive: true });
    for (const n of DETECTORS) fs.writeFileSync(path.join(kernelRoot, "scripts", "dist", `${n}.js`), "");
    const cases = [
      ["identity-replication-check", defaultIdentityReplicationArgv(TARGET)],
      ["guard-lineage-check", defaultGuardLineageArgv(TARGET)],
      ["deletion-closure-check", defaultDeletionClosureArgv(TARGET, ["a.sh"])],
    ];
    for (const [name, argv] of cases) {
      assert.notEqual(argv, null, `${name} 在 dist-only 安装形态下必须解析得到`);
      assert.equal(argv[2], path.join(kernelRoot, "scripts", "dist", `${name}.js`), `${name} 解析到 dist bundle`);
      assert.equal(argv.includes("--experimental-strip-types"), false, `${name}: dist bundle 不带 strip-types flag`);
      assert.equal(argv.includes(path.join(TARGET, "plugin", "scripts", `${name}.ts`)), false,
        `${name} ⛔ 不得锚在目标 root（这正是修复前的缺陷形）`);
      assert.equal(argv[argv.indexOf("--root") + 1], TARGET,
        `${name} 的 --root 仍是被分析的 TARGET（解析基准与 --root 是两件事）`);
      assert.equal(argv.includes("--json"), true);
    }
    // 构件顺序：deletion 的构件必须夹在脚本与 --root 之间（修复前的位置不变）
    assert.deepEqual(defaultDeletionClosureArgv(TARGET, ["a.sh", "b.ts"]).slice(2, 5),
      [path.join(kernelRoot, "scripts", "dist", "deletion-closure-check.js"), "a.sh", "b.ts"]);

    // (c) **源检出**形态（raw .ts 在场 + 同级的 packages/quay/src 在）⇒ raw 胜出（编辑即生效）。
    fs.rmSync(path.join(kernelRoot, "scripts", "dist"), { recursive: true, force: true });
    fs.mkdirSync(path.join(tmp, "packages", "quay", "src"), { recursive: true });
    for (const n of DETECTORS) fs.writeFileSync(path.join(kernelRoot, "scripts", `${n}.ts`), "");
    const srcArgv = defaultIdentityReplicationArgv(TARGET);
    assert.equal(srcArgv[3], path.join(kernelRoot, "scripts", "identity-replication-check.ts"), "源检出 ⇒ raw .ts 胜出");
    assert.equal(srcArgv.includes("--experimental-strip-types"), true);
  } finally {
    if (prev === undefined) delete process.env.QUAY_PLUGIN_ROOT;
    else process.env.QUAY_PLUGIN_ROOT = prev;
  }
});

test("Gap3/AC1 — 检测器脚本体解析不出 ⇒ architecture-review 记 not-evaluated:detector-script-unresolved:<name>（⛔ 不 spawn 不存在的路径）", async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "qg-arunresolved-"));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  // QUAY_PLUGIN_ROOT 指向一个**空**的 kernel（raw .ts 与 dist/*.js 都不在）
  const emptyKernel = path.join(tmp, "kernel");
  fs.mkdirSync(path.join(emptyKernel, "scripts"), { recursive: true });
  const target = path.join(tmp, "target");
  fs.mkdirSync(target, { recursive: true });
  const prev = process.env.QUAY_PLUGIN_ROOT;
  process.env.QUAY_PLUGIN_ROOT = emptyKernel;
  try {
    const fact = await runArchitectureReview(target, null, null, null, null, null, false);
    assert.equal(fact.state, "not-evaluated");
    assert.match(fact.reason, /detector-script-unresolved:identity-replication-check\.ts/);
    assert.equal(fact.value, null);
    // 负控制：同一 root 上把三个 bundle 放进 kernel ⇒ 不再报 unresolved（证明上面那条是解析面造成的，
    // 不是「这个 root 让例程恒不评估」）。
    fs.mkdirSync(path.join(emptyKernel, "scripts", "dist"), { recursive: true });
    for (const n of ["identity-replication-check", "guard-lineage-check", "deletion-closure-check"]) {
      fs.writeFileSync(path.join(emptyKernel, "scripts", "dist", `${n}.js`),
        "process.stdout.write(JSON.stringify({rootSurface:{kind:\"full\",note:null}}));\n");
    }
    const ok = await runArchitectureReview(target, null, null, null, null, null, false);
    assert.notEqual(ok.state, "not-evaluated", `不该再是 unresolved（reason=${ok.reason}）`);
    assert.doesNotMatch(ok.reason, /detector-script-unresolved/);
  } finally {
    if (prev === undefined) delete process.env.QUAY_PLUGIN_ROOT;
    else process.env.QUAY_PLUGIN_ROOT = prev;
  }
});

test("Gap1 — main()：config 段决定节奏与开关，显式 CLI flag 覆盖 config（装配行点名来源）", (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "qg-armain-"));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const planCmd = writeFixture(tmp, "p.js", `process.stdout.write(JSON.stringify({triggers:{fired:false,reasons:[],poolCount:0,oldestUnreviewedAgeMs:0,roundsSinceLastJudge:0},pool:[],tasks:[],lastJudgeState:{status:"ok"}}));`);
  const judgmentCmd = writeFixture(tmp, "j.js", `process.stdout.write(JSON.stringify({mode:"judgment-consumer-audit",judgments_total:1,wired:1,unfinished:[],drift:false}));`);
  const packagingCmd = writeFixture(tmp, "k.js", `process.stdout.write(JSON.stringify({mode:"packaging-hygiene-audit",configKeys:{keysTotal:0,noConsumerToWire:[],state:"verified"},shippedEntries:{state:"verified",violations:[],reason:null},drift:[]}));`);
  const runDriver = (label, extraArgs) => {
    const roundLog = path.join(tmp, `round-${label}.jsonl`);
    const r = spawnSync(process.execPath, ["--experimental-strip-types",
      path.join(REPO_ROOT, "plugin", "scripts", "quality-gate-driver.ts"),
      "--root", tmp, "--once", "--round-log", roundLog,
      "--plan-cmd", `node ${planCmd}`, "--judgment-cmd", `node ${judgmentCmd}`,
      "--packaging-check-cmd", `node ${packagingCmd}`,
      "--identity-cmd", `node ${fakeIdentityScript(tmp, false)}`,
      "--lineage-cmd", `node ${fakeLineageScript(tmp, false)}`,
      ...extraArgs], { encoding: "utf8", timeout: 120_000 });
    assert.equal(r.status, 0, `driver --once exit 0 (stderr: ${r.stderr})`);
    const rec = JSON.parse(fs.readFileSync(roundLog, "utf8").split("\n").filter((l) => l.trim())[0]);
    return { fact: rec.facts.find((f) => f.name === "architecture-review"), stderr: r.stderr };
  };

  // (a) 段缺席 ⇒ 老行为：缺省节奏 + 例程照跑（本内建例程默认开，⛔ 不是同族 declarative 的 off-by-default）
  writeConfig(tmp, "loop: {}\n");
  const a = runDriver("absent", []);
  assert.equal(a.fact.state, "verified");
  assert.match(a.stderr, /architecture-review 例程已装配（enabled, interval=60m \[来源: default\]/);

  // (b) 段 enabled:true + interval:120m ⇒ 节奏取自 config，且**零 spawn 也照跑**（这里用假检测器缝）
  writeConfig(tmp, 'loop:\n  architecture_review:\n    enabled: true\n    interval: "interval:120m"\n');
  const b = runDriver("cfg", []);
  assert.equal(b.fact.state, "verified");
  assert.match(b.stderr, /architecture-review 例程已装配（enabled, interval=120m \[来源: config\]/);

  // (c) 显式 CLI flag 覆盖 config（同一份 config，flag 传 90）
  const c = runDriver("cli", ["--arch-review-interval", "90"]);
  assert.equal(c.fact.state, "verified");
  assert.match(c.stderr, /architecture-review 例程已装配（enabled, interval=90m \[来源: cli\]/);

  // (d) 段 enabled:false ⇒ 零 spawn 的关停读数（kill switch 在**启动行与 Fact 上**都可见）
  writeConfig(tmp, "loop:\n  architecture_review:\n    enabled: false\n");
  const d = runDriver("off", []);
  assert.equal(d.fact.state, "not-evaluated");
  assert.match(d.fact.reason, /disabled/);
  assert.match(d.stderr, /architecture-review 例程已装配（enabled:false/);
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// gap-architecture-review-judge-call-shares-no-diagnostics-or-retry-with-osd
// judge 调用的失败归因 + 有界重试 = 【复用 OSD 的机件】（硬规则 5b：修好一个实例 ≠ 修好一类）。
// 判定面：a) 失败形状由 callFailureClass/streamDiagnostics 分类（不是第二份读法）；b) 可重试类恰一次
// 重试、重试再失败仍落 failed（⛔ 不洗成 judged）、捕获文件在盘上；c) 不可重试类零重试；d) 三个机械
// 检测器的 spawn 面**逐字未动**（仍然 terminal-on-error、零重试）。
// ═══════════════════════════════════════════════════════════════════════════════════════════════════

/** 一个会【记 spawn 次数】的 judge stub：每次被 spawn 先追加一行日志，再产出给定字节/退出码。 */
function judgeStub(tmp, name, { stdout = "", stderr = "", exit = 0, hang = false } = {}) {
  const log = path.join(tmp, `${name}-spawns.log`);
  const body = [
    `const fs=require("node:fs");fs.appendFileSync(${JSON.stringify(log)},"spawned\\n");`,
    hang
      ? `setTimeout(()=>process.exit(0),60000);`
      : `process.stdout.write(${JSON.stringify(stdout)});process.stderr.write(${JSON.stringify(stderr)});process.exit(${exit});`,
  ].join("\n");
  return { argv: ["node", writeFixture(tmp, `judge-${name}.js`, body)], log };
}

/** 一个会【记 spawn 次数】的检测器命令：先追加日志、再 require 原 fixture（原样产出）。 */
function loggingCmd(tmp, name, originalPath, logPath) {
  return ["node", writeFixture(tmp, name, `require("node:fs").appendFileSync(${JSON.stringify(logPath)},"hit\\n");require(${JSON.stringify(originalPath)});`)];
}

const spawnCount = (log) => (fs.existsSync(log) ? fs.readFileSync(log, "utf8").split("\n").filter((l) => l.trim()).length : 0);
const archCaptureDir = (tmp) => path.join(tmp, ARCH_REVIEW_CALL_CAPTURE_DIR_REL);
const captureCount = (tmp) => (fs.existsSync(archCaptureDir(tmp)) ? fs.readdirSync(archCaptureDir(tmp)).length : 0);
const lastArchRecord = (tmp) => JSON.parse(fs.readFileSync(archReviewRoundPath(tmp), "utf8").split("\n").filter((l) => l.trim()).pop());

/** 修复前 judge 分支的失败串——【逐字取自本任务前的那两行】（`judge exited …` / `judge output not a
 *  JSON array: …`）。它没有分类、没有捕获、没有重试：这就是负控制要证明「确实变了」的那个旧读数。 */
function preFixReason(status, stderr, errorMsg = null) {
  return `judge exited ${status ?? "null"}: ${errorMsg ?? String(stderr ?? "").slice(0, 200)}`;
}

/** OSD 已知的失败形状（字节面）。`expect`/`retry` 是**复用的**分类器与**复用的**清单应当给出的读数。 */
const ARCH_JUDGE_SHAPES = [
  { name: "no-stdout", stdout: "", stderr: "", exit: 1, expect: "no-stdout", retry: true, hasResult: false },
  { name: "stream-without-result", exit: 1, retry: true, hasResult: false, expect: "stream-without-result",
    stdout: '{"type":"system","subtype":"init"}\n{"type":"assistant","message":{"content":[]}}\n', stderr: "" },
  { name: "api-error-event", exit: 1, retry: true, hasResult: true, expect: "api-error-event",
    stdout: '{"type":"system","subtype":"init"}\n{"type":"result","subtype":"error_during_execution","is_error":true}\n', stderr: "" },
  { name: "truncated-json", exit: 1, retry: false, hasResult: false, expect: "truncated-json",
    stdout: '{"type":"system","subtype":"init"', stderr: "" },
  { name: "unclassified-plain-text", exit: 1, retry: false, hasResult: false, expect: "unclassified",
    stdout: "Error: unable to resolve project root '/nope'", stderr: "Error: unable to resolve project root '/nope'" },
];

test("AC1 — 每个 judge 失败形状由【复用的】callFailureClass/streamDiagnostics 分类（负控制：修复前全塌成一个串）", async (t) => {
  assert.deepEqual(
    [...RETRYABLE_CALL_FAILURES],
    ["no-stdout", "stream-without-result", "api-error-event"],
    "可重试清单就是 OSD 的那一份（⛔ 不是第二个谓词）",
  );

  const fixedClasses = [];
  for (const s of ARCH_JUDGE_SHAPES) {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), `qg-archi-${s.name}-`));
    t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
    const { identityCmd, lineageCmd, deletionCmd, gateArgv } = archReviewCmd(tmp);
    const judge = judgeStub(tmp, s.name, s);
    const fact = await runArchitectureReview(tmp, identityCmd, lineageCmd, deletionCmd, judge.argv, gateArgv,
      true, Infinity, false, null, 900_000, 0);
    assert.equal(fact.state, "failed", `${s.name} ⇒ failed（⛔ 非 verified）`);
    const rec = lastArchRecord(tmp);
    assert.equal(rec.state, "failed");
    assert.equal(rec.call_failure, s.expect, `${s.name} 的类由复用的 callFailureClass 读出`);
    assert.equal(rec.has_result, s.hasResult, `${s.name} 的 has_result 与流读取器一致`);
    assert.equal(rec.stdout_bytes, Buffer.byteLength(s.stdout, "utf8"), `${s.name} 记下 stdout 字节数`);
    // 重试边界由【复用的清单】决定，⛔ 不由本文件再写一条谓词。
    const wantedRetry = RETRYABLE_CALL_FAILURES.includes(s.expect);
    assert.equal(rec.retry_attempted === true, wantedRetry, `${s.name}: 重试与否 = RETRYABLE_CALL_FAILURES 的判定`);
    assert.equal(spawnCount(judge.log), wantedRetry ? 2 : 1, `${s.name}: spawn 次数 = ${wantedRetry ? 2 : 1}`);
    assert.equal(captureCount(tmp), spawnCount(judge.log), `${s.name}: 每个未产出判词的调用都留下捕获文件`);
    fixedClasses.push(rec.call_failure);
  }
  assert.equal(new Set(fixedClasses).size, ARCH_JUDGE_SHAPES.length, "修复后：每个形状一个不同的类");

  // ── 负控制（能取假）：把同样的形状喂给【修复前的两行】⇒ 区分力塌掉、零分类、零重试面 ──
  const preFixExit1 = ARCH_JUDGE_SHAPES.map((s) => preFixReason(s.exit, s.stderr));
  const retryableShapes = ARCH_JUDGE_SHAPES.filter((s) => s.retry).map((s) => preFixReason(s.exit, s.stderr));
  assert.equal(new Set(retryableShapes).size, 1, "修复前：三个**字节截然不同**的可重试形状塌成同一个串（零区分力）");
  assert.equal(retryableShapes[0], "judge exited 1: ", "且就是生产载体里那条不含任何归因的串");
  assert.equal(new Set(preFixExit1).size, 2, "修复前全部 5 个形状只解出 2 个值（stderr 空 / 非空），修复后是 5");
  assert.equal(new Set(fixedClasses).size, 5, "修复后：每个形状各自一个类");
  assert.ok(!preFixExit1.some((r) => fixedClasses.some((c) => r.includes(c))), "修复前的串里没有任何 call_failure 类");
});

test("AC1(b) — 超时是【自己的】收尾：killed-by-timeout 且零重试（优先级由复用的分类器给）", async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "qg-archi-timeout-"));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const { identityCmd, lineageCmd, deletionCmd, gateArgv } = archReviewCmd(tmp);
  const judge = judgeStub(tmp, "hang", { hang: true });
  const fact = await runArchitectureReview(tmp, identityCmd, lineageCmd, deletionCmd, judge.argv, gateArgv,
    true, 150, false, null, 900_000, 0);
  assert.equal(fact.state, "failed");
  const rec = lastArchRecord(tmp);
  assert.equal(rec.call_failure, "killed-by-timeout");
  assert.equal(rec.retry_attempted === true, false, "killed-by-timeout ⛔ 不在可重试清单里");
  assert.equal(spawnCount(judge.log), 1, "超时形状零重试");
});

test("AC2 — 可重试类恰一次重试；重试再失败仍落 failed（⛔ 不洗成 judged）+ 捕获文件在盘上", async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "qg-archi-retry-"));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const { identityCmd, lineageCmd, deletionCmd, gateArgv } = archReviewCmd(tmp);
  const s = ARCH_JUDGE_SHAPES.find((x) => x.name === "stream-without-result");
  const judge = judgeStub(tmp, "retry", s);
  const fact = await runArchitectureReview(tmp, identityCmd, lineageCmd, deletionCmd, judge.argv, gateArgv,
    true, Infinity, false, null, 900_000, 0);

  assert.equal(fact.state, "failed", "重试也失败 ⇒ failed（⛔ 不是 verified/judged）");
  assert.equal(spawnCount(judge.log), 2, "恰一次重试（第一次调用 + 一次重发），⛔ 不是两次");
  const rec = lastArchRecord(tmp);
  assert.equal(rec.state, "failed");
  assert.equal(rec.retry_attempted, true);
  assert.equal(rec.retry_refused, null);
  assert.equal(rec.call_failure, "stream-without-result", "重试后记录的仍是同一可重试类（⛔ 不洗成干净）");
  assert.match(rec.reason, /stream-without-result/, "reason 携带分类读数");
  assert.match(rec.reason, /retried once \(first=stream-without-result\)/, "reason 记下「重试过一次」");

  // 捕获文件：两次调用各留一份（「无字节可看」与「没有捕获文件」不同形，硬规则 3b）。
  const capDir = archCaptureDir(tmp);
  assert.ok(fs.existsSync(capDir), "捕获目录存在");
  const caps = fs.readdirSync(capDir);
  assert.equal(caps.length, 2, "两次未产出判词的调用 ⇒ 两份捕获");
  for (const f of caps) {
    const body = fs.readFileSync(path.join(capDir, f), "utf8");
    assert.match(body, /# stdout head/, "捕获内容是有界 head/tail 描述");
    assert.match(body, /# stderr tail/, "捕获内容含 stderr 尾部");
  }
  // 载体里只有这一条 failed 记录（⛔ 不写第二条 judged）
  const lines = fs.readFileSync(archReviewRoundPath(tmp), "utf8").split("\n").filter((l) => l.trim());
  assert.equal(lines.length, 1, "只有一条失败记录");
  assert.equal(JSON.parse(lines[0]).state, "failed");
  assert.equal(rec.stdout_capture.path !== null, true, "捕获路径写在记录上（可被 operator 打开）");
  assert.equal(fs.existsSync(path.join(tmp, rec.stdout_capture.path)), true, "记录里的路径真的指向盘上的文件");
});

test("AC2(b) — 预算/资源门拒绝时【不重试】（本 routine 的支出闸 = resourceGateCheck，⛔ 无第二条台账）", async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "qg-archi-gate-"));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const { identityCmd, lineageCmd, deletionCmd } = archReviewCmd(tmp);
  // 有状态的资源门：第 1 次（judge 前）GO，第 2 次（重试前）WAIT ⇒ 重试被拒。
  const hitLog = path.join(tmp, "gate-hits.log");
  const statefulGate = ["node", writeFixture(tmp, "gate-stateful.js", [
    `const fs=require("node:fs");`,
    `const n=fs.existsSync(${JSON.stringify(hitLog)})?fs.readFileSync(${JSON.stringify(hitLog)},"utf8").split("\\n").filter(Boolean).length:0;`,
    `fs.appendFileSync(${JSON.stringify(hitLog)},"hit\\n");`,
    `process.stdout.write(JSON.stringify(n<1?{verdict:"GO",reason:"first"}:{verdict:"WAIT",reason:"busy-on-retry"}));`,
  ].join("\n"))];
  const s = ARCH_JUDGE_SHAPES.find((x) => x.name === "no-stdout");
  const judge = judgeStub(tmp, "gate-refused", s);
  const fact = await runArchitectureReview(tmp, identityCmd, lineageCmd, deletionCmd, judge.argv, statefulGate,
    true, Infinity, false, null, 900_000, 0);

  assert.equal(fact.state, "failed", "闸拒绝重试 ⇒ 保留第一次失败的读数");
  assert.equal(spawnCount(judge.log), 1, "重试被拒 ⇒ 没有第二次 subprocess");
  assert.equal(spawnCount(hitLog), 2, "资源门被读了两次（judge 前 + 重试前）");
  const rec = lastArchRecord(tmp);
  assert.equal(rec.retry_attempted, false);
  assert.match(String(rec.retry_refused), /busy-on-retry/, "拒绝原因落进记录");
  assert.match(rec.reason, /retry refused by resource gate/, "reason 说明重试为何没发生");
});

test("AC3 — 不可重试类零重试（clean exit-1 + 真 stderr / 非 JSON stdout / truncated-json）", async (t) => {
  for (const name of ["truncated-json", "unclassified-plain-text"]) {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), `qg-archi-norety-${name}-`));
    t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
    const { identityCmd, lineageCmd, deletionCmd, gateArgv } = archReviewCmd(tmp);
    const s = ARCH_JUDGE_SHAPES.find((x) => x.name === name);
    const judge = judgeStub(tmp, name, s);
    const fact = await runArchitectureReview(tmp, identityCmd, lineageCmd, deletionCmd, judge.argv, gateArgv,
      true, Infinity, false, null, 900_000, 0);
    assert.equal(fact.state, "failed");
    assert.equal(spawnCount(judge.log), 1, `${name}: 恰好一次 spawn（⛔ 无重试）`);
    const rec = lastArchRecord(tmp);
    assert.equal(rec.retry_attempted, false, `${name}: 无重试记录`);
    assert.equal(rec.retry_refused, null, `${name}: 也不是被闸拒绝——是根本没到重试那一步`);
    assert.equal(RETRYABLE_CALL_FAILURES.includes(rec.call_failure), false, `${name} 的类不在可重试清单里`);
    assert.equal(captureCount(tmp), 1, `${name}: 那次失败调用仍留捕获`);
  }
});

test("AC4 — 三个机械检测器的 spawn 面【逐字未动】：失败仍 terminal、且 judge 重试不重跑检测器", async (t) => {
  // (a) 检测器 spawn 失败 ⇒ 立即 not-evaluated，judge 从未被 spawn（⛔ 不落入新的归因/重试面）
  {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "qg-archi-detfail-"));
    t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
    const { lineageCmd, deletionCmd, gateArgv } = archReviewCmd(tmp);
    const judge = judgeStub(tmp, "never", { stdout: "[]", exit: 0 });
    // 一个【spawn 不出来】的命令（不是「能跑但输出读不懂」）⇒ 命中既有 spawn-error 分支。
    const fact = await runArchitectureReview(tmp, [path.join(tmp, "no-such-detector-binary")], lineageCmd, deletionCmd,
      judge.argv, gateArgv, true, Infinity, false, null, 900_000, 0);
    assert.equal(fact.state, "not-evaluated");
    assert.match(fact.reason, /identity-replication spawn error/);
    assert.equal(spawnCount(judge.log), 0, "检测器失败 ⇒ judge 零 spawn");
    assert.equal(captureCount(tmp), 0, "零 spawn ⇒ 零捕获");
  }
  // (b) judge 重试发生在检测器【之后】：identity 检测器恰被 spawn 一次（⛔ 重试不重跑机械聚类）
  {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "qg-archi-detonce-"));
    t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
    const detLog = path.join(tmp, "identity-hits.log");
    const identityCmd = loggingCmd(tmp, "log-identity.js", fakeIdentityScript(tmp, true), detLog);
    const { lineageCmd, deletionCmd, gateArgv } = archReviewCmd(tmp);
    const s = ARCH_JUDGE_SHAPES.find((x) => x.name === "no-stdout");
    const judge = judgeStub(tmp, "detonce", s);
    const fact = await runArchitectureReview(tmp, identityCmd, lineageCmd, deletionCmd, judge.argv, gateArgv,
      true, Infinity, false, null, 900_000, 0);
    assert.equal(fact.state, "failed");
    assert.equal(spawnCount(detLog), 1, "identity 检测器恰一次（judge 重试不重跑机械聚类）");
    assert.equal(spawnCount(judge.log), 2, "judge 侧仍恰一次重试");
  }
});

// ══════════════════════════════════════════════════════════════════════════════════════════════════════
// gap-quality-restart-waits-out-whole-round-so-osd-in-flight-exceeds-stop-window
//
// 停机过去只在**轮边界**被看见（`while (!stopCtl.isStopRequested())`），轮内的 `for (routine)` 与
// `runRoutineWithWatchdog` 都不看停机 ⇒ 一次停机请求要等**整轮**跑完。实测（2026-10-14）：OSD 轮
// 6/6 与 22/23 的 wall 都 > 60s、最长 1172s，而 `stopKindViaAnchor` 只等 60000ms ⇒ 在飞长例程期间的
// `restart --kind quality` **必然** `stop-failed` / `restart-aborted`。
//
// 三条通道把延迟压到有界（Plan 步 1-2）：① 例程**之间**查停机；② 在飞例程收到 `AbortSignal`，
// 在下一个可中断边界早退并交 `not-evaluated: stopped-mid-round`；③ 例程不响应时由调用方在
// `stopGraceMs` 后**放弃等待**并记一条 `observed:false` 的 Fact（⇒ 上界不依赖例程行为）。
// 判据逐条可取假：把 `runRoutineWithWatchdog` 的 stop 支去掉，下面每一条都会退化成「等满例程」。
// ══════════════════════════════════════════════════════════════════════════════════════════════════════

/** 把 `quality` 移进盘上停机记录 —— 生产上 `quay driver stop --kind quality` 写的**同一个**文件，
 *  经 `quay driver start --kind quality` 清除（`updateDesired` 同一次调用里做两件事）。
 *  ⛔ 这是**跨 bundle** 的停机通道（shipped 产物上进程内登记表恒失效），故轮内停机必须走它。 */
function writeDiskKindStop(root, kind) {
  fs.writeFileSync(
    path.join(root, ANCHOR_KIND_STOPS_REL),
    JSON.stringify({ [kind]: { at: new Date().toISOString(), by: "quay-driver-stop" } }),
    "utf8",
  );
}

function readRounds(roundLog) {
  return fs.readFileSync(roundLog, "utf8").split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l));
}

test("stop AC1（Plan 步 1）— 停机请求到达后【例程之间】不再启动任何 due 例程，名字进 skipped_routines", async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "qg-stop-between-"));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  fs.mkdirSync(path.join(tmp, ".quay"), { recursive: true });
  const ran = [];
  const routines = ["a", "b", "c"].map((n) => ({
    name: `r-${n}`,
    schedule: { kind: "interval", minutes: 0 },
    // 第一条例程自己触发停机（盘上通道，生产同源）——此后 b/c 都是 due，却**一个都不该启动**。
    run: () => {
      ran.push(n);
      if (n === "a") writeDiskKindStop(tmp, "quality");
      return [{ name: `r-${n}`, value: { seen: n }, state: "verified", reason: null }];
    },
  }));
  const roundLog = path.join(tmp, "quality-round.jsonl");
  const code = await runResidentQualityGateLoop({
    root: tmp, intervalMs: 1, once: false, maxRounds: 1, roundLogFile: roundLog,
    runId: "stop-between", json: false, routines, stopPollMs: 10,
  });
  assert.equal(code, 0);
  assert.deepEqual(ran, ["a"], "⛔ 停机之后不再启动任何 due 例程（修复前 b/c 照跑）");
  const rec = readRounds(roundLog)[0];
  assert.deepEqual(rec.skipped_routines, ["r-b", "r-c"], "被跳过的 due 例程**具名**落进轮记录（硬规则 3b：没跑与跑过不同形）");
  assert.equal(rec.facts.length, 1);
});

test("stop AC2/AC3（Plan 步 2）— 在飞例程收到 signal，交出自己的 not-evaluated: stopped-mid-round，⛔ 不记 verified", async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "qg-stop-midround-"));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  fs.mkdirSync(path.join(tmp, ".quay"), { recursive: true });
  let abortedAt = null;
  const routine = {
    name: "long-model-calling",
    schedule: { kind: "interval", minutes: 0 },
    // 一条「模型调用型」例程：在**可中断边界**（每个 50ms 的调用块之间）观察 signal，读到就早退并交出
    // 它自己的 not-evaluated Fact（它知道自己持久化了什么，调用方不知道）。
    run: async (ctx) => {
      for (let i = 0; i < 200; i++) {
        if (ctx?.signal?.aborted) {
          abortedAt = Date.now();
          return [{ name: "long-model-calling", value: { observed: true, blocks_done: i }, state: "not-evaluated", reason: "stopped-mid-round: the routine observed the signal at its next call boundary and returned what it had persisted" }];
        }
        await new Promise((r) => setTimeout(r, 50));
      }
      return [{ name: "long-model-calling", value: { observed: false }, state: "verified", reason: null }];
    },
  };
  const roundLog = path.join(tmp, "quality-round.jsonl");
  setTimeout(() => writeDiskKindStop(tmp, "quality"), 120);
  const t0 = Date.now();
  const code = await runResidentQualityGateLoop({
    root: tmp, intervalMs: 1, once: false, maxRounds: 1, roundLogFile: roundLog,
    runId: "stop-midround", json: false, routines: [routine], stopPollMs: 20, stopGraceMs: 5_000,
  });
  const elapsed = Date.now() - t0;
  assert.equal(code, 0);
  assert.ok(abortedAt !== null, "例程必须在它的下一个可中断边界看到取消信号");
  assert.ok(elapsed < 5_000, `循环必须在有界时间内退出（实测 ${elapsed}ms；⛔ 修复前要等满 10s 的例程）`);
  const rec = readRounds(roundLog)[0];
  assert.equal(rec.stopped_mid_round, true, "轮记录把这一轮标成「没跑完」");
  assert.equal(rec.facts.length, 1);
  assert.equal(rec.facts[0].state, "not-evaluated", "⛔ 半轮**绝不**记 verified（硬规则 3b）");
  assert.ok(rec.facts[0].reason.startsWith("stopped-mid-round"), "取词来自单一真相源 STOPPED_MID_ROUND");
  assert.equal(rec.facts[0].value.observed, true, "交出的是**例程自己的**读数，不是调用方代笔的");
});

test("stop AC2（Plan 步 3 的反面）— 不响应取消的例程由调用方在 stopGraceMs 后放弃，且读数与协作那一支【不同形】", async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "qg-stop-abandon-"));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  fs.mkdirSync(path.join(tmp, ".quay"), { recursive: true });
  const routine = {
    name: "never-observes-the-signal",
    schedule: { kind: "interval", minutes: 0 },
    // ⛔ 完全无视 ctx.signal，而且要跑很久——正是 `stopKindViaAnchor` 那个 60000ms 窗口装不下的形状。
    // `unref` 只是让**本测试进程**不必等它（这一支要验的是循环的**决策**延迟，不是例程的下场）。
    run: async () => {
      await new Promise((r) => { const t = setTimeout(r, 60_000); t.unref(); });
      return [{ name: "never-observes-the-signal", value: null, state: "verified", reason: null }];
    },
  };
  const roundLog = path.join(tmp, "quality-round.jsonl");
  setTimeout(() => writeDiskKindStop(tmp, "quality"), 100);
  const t0 = Date.now();
  const code = await runResidentQualityGateLoop({
    root: tmp, intervalMs: 1, once: false, maxRounds: 1, roundLogFile: roundLog,
    runId: "stop-abandon", json: false, routines: [routine], stopPollMs: 20, stopGraceMs: 400,
  });
  const elapsed = Date.now() - t0;
  assert.equal(code, 0);
  assert.ok(elapsed < 5_000, `放弃等待把上界压到 poll+grace（实测 ${elapsed}ms；⛔ 修复前 = 例程的 60000ms）`);
  const rec = readRounds(roundLog)[0];
  assert.equal(rec.facts[0].state, "not-evaluated");
  assert.equal(rec.facts[0].value.observed, false, "⛔ 放弃那一支与协作那一支**不同形**（observed 是判别式）");
  assert.equal(rec.facts[0].value.grace_ms, 400, "放弃 Fact 说出它等的是多久");
  assert.match(rec.facts[0].reason, /abandoned by the caller-side stop grace/);
  // ⛔ 半轮**绝不**记 verified —— 被放弃的例程哪怕以后自己返回了，它的 Facts 也不进这一轮。
  assert.ok(rec.facts.every((f) => f.state !== "verified"));
});

test("stop AC3 — 无停机请求时循环行为【逐字不变】：四条例程全跑完、stopped_mid_round:false、skipped_routines 为空（负控制）", async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "qg-stop-none-"));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  fs.mkdirSync(path.join(tmp, ".quay"), { recursive: true });
  const routines = ["a", "b", "c", "d"].map((n) => ({
    name: `r-${n}`,
    schedule: { kind: "interval", minutes: 0 },
    run: () => [{ name: `r-${n}`, value: { seen: n }, state: "verified", reason: null }],
  }));
  const roundLog = path.join(tmp, "quality-round.jsonl");
  await runResidentQualityGateLoop({
    root: tmp, intervalMs: 1, once: false, maxRounds: 1, roundLogFile: roundLog,
    runId: "stop-none", json: false, routines, stopPollMs: 10,
  });
  const rec = readRounds(roundLog)[0];
  assert.equal(rec.facts.length, 4, "⛔ 没有停机 ⇒ 一条例程都不许被跳过");
  assert.deepEqual(rec.skipped_routines, []);
  assert.equal(rec.stopped_mid_round, false);
  assert.ok(rec.facts.every((f) => f.state === "verified"));
});

// ── AC3（模型调用例程）：停机在【下一个模型调用边界】生效，且台账自洽 ───────────────────────────────
// 两条例程的每一次模型子进程都过同一个 choke point（`reservingModel` / `reservingStep` 的
// `budget.reserve` 之前）。判据取假的方式：把那个 `signal?.aborted` 检查挪到 `reserve` **之后**，
// 下面的 reserve 计数就会多一条（「停机之后一笔预留都不取」立刻变成假）。

/** 一条**真**的 24h 预留台账（`openModelBudget` + 真锁 + 真 ledger 文件），⛔ 不是记账替身。 */
function realBudget(root, cap = 50) {
  return openModelBudget({
    root, cap,
    ledgerPath: path.join(root, BUDGET_LEDGER_REL),
    lockPath: path.join(root, BUDGET_LOCK_REL),
    carrierPath: path.join(root, "carrier.jsonl"),
  });
}
const ledgerOf = (root) => (fs.existsSync(path.join(root, BUDGET_LEDGER_REL))
  ? fs.readFileSync(path.join(root, BUDGET_LEDGER_REL), "utf8").split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l))
  : []);
const reservesOf = (root) => ledgerOf(root).filter((l) => l.kind === "reserve");
const outcomesOf = (root) => ledgerOf(root).filter((l) => l.kind === "outcome");

test("AC3 — reservingModel：停机之后【零预留】、在飞那一笔**保持已支出**、且抛出的是具名的 stopped-mid-round", async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "qg-reserving-stop-"));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  fs.mkdirSync(path.join(tmp, ".quay"), { recursive: true });
  const budget = realBudget(tmp);
  const ac = new AbortController();
  let innerCalls = 0;
  const inner = async () => { innerCalls++; return { stdout: "{}" }; };

  // ① 停机**之前**的一次调用：取预留、记 outcome —— 这是「已支出的预留」基线。
  const seam = reservingModel(inner, budget, { step: "reflection", tools: "", max_turns: 1 }, undefined, ac.signal);
  await seam("first");
  assert.equal(reservesOf(tmp).length, 1);
  assert.equal(outcomesOf(tmp).length, 1, "已完成的调用记了 outcome（这一笔预留**已支出**）");

  // ② 停机到达。之后**任何**一步都不得再取预留（AC3 的可核读数）。
  ac.abort();
  let threw = null;
  try { await seam("second"); } catch (e) { threw = e; }
  assert.ok(threw instanceof StoppedMidRoundError, `停机之后必须抛 StoppedMidRoundError，实得 ${threw}`);
  assert.equal(threw.step, "reflection");
  assert.equal(threw.afterStop, true, "停机**先到**、这一步是停机之后才被走到的");
  assert.match(threw.message, /^stopped-mid-round: /, "取词来自单一真相源 STOPPED_MID_ROUND");
  assert.equal(innerCalls, 1, "⛔ 停机之后连模型子进程都不该起（检查在 reserve 之前 ⇒ 也在 spawn 之前）");
  assert.equal(reservesOf(tmp).length, 1, "⛔ 停机之后 reserve 计数**不动** —— 这一条把检查挪到 reserve 之后立刻变假");
  assert.equal(outcomesOf(tmp).length, 1);
  assert.equal(budget.grantedCount, 1);
});

test("AC3 — reservingModel：停机在**飞**时那一笔保持已支出（afterStop:false 与 true 不同形）", async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "qg-reserving-inflight-"));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  fs.mkdirSync(path.join(tmp, ".quay"), { recursive: true });
  const budget = realBudget(tmp);
  const ac = new AbortController();
  // 模型调用**在飞**时停机到达：inner 自己把 signal 置停，模拟「调用期间收到停机」。
  const inner = async () => { ac.abort(); return { stdout: "{}" }; };
  const seam = reservingModel(inner, budget, { step: "verification", tools: "", max_turns: 1 }, undefined, ac.signal);
  let threw = null;
  try { await seam("in-flight"); } catch (e) { threw = e; }
  assert.ok(threw instanceof StoppedMidRoundError);
  assert.equal(threw.afterStop, false, "停机到达时这一步**正在飞** —— ⛔ 与「停机之后才走到」不同形（硬规则 3b）");
  assert.equal(reservesOf(tmp).length, 1, "这一笔预留**已经取过**");
  assert.equal(outcomesOf(tmp).length, 1, "…而它的 outcome 也记了 ⇒ 台账自洽：花掉的算花掉");
  assert.equal(budget.grantedCount, 1, "⛔ 不因停机回滚：一笔花掉的预留就是花掉了");
});

test("AC3 — spawnModelCall：停机 SIGKILL 在飞的模型子进程并交出 stopped-mid-round（⛔ 不是等它跑完）", async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "qg-spawn-abort-"));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const ac = new AbortController();
  const t0 = Date.now();
  // 一个「模型调用」：睡 60s。停机必须把它**杀掉**，而不是等满 timeoutMs。
  const p = spawnModelCall([process.execPath, "-e", "setTimeout(()=>{}, 60000)"], { cwd: tmp, timeoutMs: 60_000 }, ac.signal);
  setTimeout(() => ac.abort(), 150);
  const res = await p;
  const elapsed = Date.now() - t0;
  assert.ok(elapsed < 5_000, `停机必须立刻收掉子进程（实测 ${elapsed}ms；⛔ 修复前 = timeoutMs 的 60000ms）`);
  assert.equal(res.signal, "SIGKILL");
  assert.match(String(res.error?.message ?? ""), /^stopped-mid-round: /, "死因**具名**为停机，⛔ 不与「超时」同形");
  // 负控制：已停机的信号 ⇒ ⛔ 根本不 spawn（子进程建了也立刻收掉），promise 立刻 settle。
  const t1 = Date.now();
  const res2 = await spawnModelCall([process.execPath, "-e", "setTimeout(()=>{}, 60000)"], { cwd: tmp, timeoutMs: 60_000 }, ac.signal);
  assert.ok(Date.now() - t1 < 2_000);
  assert.equal(res2.signal, "SIGKILL");
});

// ── AC3（轮级）：一条**模型调用例程**被停机打断时，轮本身交出 not-evaluated: stopped-mid-round，
//    ⛔ 不记 verified；已做过的事持久化成 partial 行；last-run 不推进 ─────────────────────────────────
// 走的是**真的** `runDiscoveryMethod`（真的 config 读、真的载体、真的台账、真的 last-run 映射），
// 只注入两个缝：ingest（让本轮有事可做 ⇒ 反射步真的会被走到）与 reflect（抛出真 `reservingModel`
// 会抛的**同一个** `StoppedMidRoundError`）。
function dmWorkspace() {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), "qg-dm-stop-"));
  fs.mkdirSync(path.join(ws, ".quay"), { recursive: true });
  fs.writeFileSync(path.join(ws, ".quay", "config.yml"),
    // ⛔ `max_model_calls_per_24h` 必须**声明**：声明了它 `runDiscoveryMethod` 才会建真预留台账
    //    （`budget`），也才走 `reservingModel` —— 缺了它这一轮根本没有台账可判，本条 AC 就落空。
    "loop:\n  discovery_method:\n    enabled: true\n    interval: interval:360m\n    max_experiences: 8\n    max_model_calls: 6\n    max_model_calls_per_24h: 120\n    max_wall_ms: 900000\n", "utf8");
  return ws;
}
const DM_CARRIER = ".quay/discovery-method-findings.jsonl";
const DM_LEDGER = ".quay/discovery-method-model-budget.jsonl";
const ledgerOf2 = (ws) => (fs.existsSync(path.join(ws, DM_LEDGER))
  ? fs.readFileSync(path.join(ws, DM_LEDGER), "utf8").split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l))
  : []);
const dmRounds = (ws) => (fs.existsSync(path.join(ws, DM_CARRIER))
  ? fs.readFileSync(path.join(ws, DM_CARRIER), "utf8").split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l))
  : []);

test("AC3（轮级）— 模型调用例程被停机打断 ⇒ not-evaluated: stopped-mid-round + partial 行 + last-run 不推进", async (t) => {
  const ws = dmWorkspace();
  t.after(() => fs.rmSync(ws, { recursive: true, force: true }));
  const model = async () => ({ stdout: JSON.stringify({ decision: "no-method" }) });
  const fact = await runDiscoveryMethod(ws, {
    config: readDiscoveryMethodConfig(ws).config,
    configPresent: true, configError: null, halted: false, invokedBy: INVOKED_BY_RESIDENT,
    model,
    ingestFn: () => ({ ok: true, ingested: 1 }),
    // 反射缝**先真的走一次模型调用**（经 `reservingModel` ⇒ 真取一笔预留、记一条 outcome），
    // 再抛出真 `reservingModel` 会抛的**同一个** `StoppedMidRoundError`。
    reflectFn: async (_root, o) => {
      await o.model("a reflection prompt");
      throw new StoppedMidRoundError("reflection", false, "the reflection call was interrupted mid-flight by the stop signal (reservation stays SPENT, its outcome is on the ledger)");
    },
  });
  assert.equal(fact.state, "not-evaluated", "⛔ 半轮**绝不**记 verified（硬规则 3b）");
  assert.match(fact.reason, /^stopped-mid-round: /);
  assert.match(fact.reason, /1 reservation\(s\) already granted by this round stay SPENT/, "原因里说清那一笔预留的下场");
  assert.equal(ledgerOf2(ws).filter((l) => l.kind === "reserve").length, 1, "这一轮真的取过一笔预留（⛔ 不是替身记的账）");
  assert.match(fact.reason, /last-run was NOT advanced/);
  const lines = dmRounds(ws);
  assert.equal(lines.length, 1, "已做过的事持久化了一行");
  assert.equal(lines[0].partial, true);
  assert.equal(lines[0].partial_reason, "stopped-mid-round:reflection");
  assert.equal(lines[0].stopped_mid_round.step, "reflection");
  assert.equal(lines[0].stopped_mid_round.after_stop, false, "停机到达时那一步**正在飞**");
  // ⛔ `partial:true` 让「没推进 last-run」**结构上**为真：due 基准跳过 partial 行。
  assert.equal(fs.existsSync(path.join(ws, ROUTINE_LAST_RUN_REL)), false, "last-run 映射根本没被写");
  assert.equal(latestResidentRoundTs(lines), null, "⛔ partial 行不是生产的时钟 —— 否则「停机不消费窗口」是名义上的");
});

test("AC3（轮级负控制）— 同一条码路上的**普通**异常仍记 failed（⛔ stopped 那一支不是什么都接）", async (t) => {
  const ws = dmWorkspace();
  t.after(() => fs.rmSync(ws, { recursive: true, force: true }));
  const fact = await runDiscoveryMethod(ws, {
    config: readDiscoveryMethodConfig(ws).config,
    configPresent: true, configError: null, halted: false, invokedBy: INVOKED_BY_RESIDENT,
    model: async () => ({ stdout: JSON.stringify({ decision: "no-method" }) }),
    ingestFn: () => ({ ok: true, ingested: 1 }),
    reflectFn: async () => { throw new Error("an ordinary engine death"); },
  });
  assert.equal(fact.state, "failed", "⛔ 普通异常**不得**被洗成 stopped-mid-round");
  assert.match(fact.reason, /^reflection threw/);
  assert.equal(dmRounds(ws).length, 0, "failed 支不写载体");
});

// ── AC3（OSD 轮级）：任务标题点名的**那个**例程 —— 在飞 OSD 轮是实测超窗的形态（6/6 与 22/23 > 60s）。
//    走真的 `runOpenSemanticDiscovery`：真的 config 读、真的台账、真的载体。三条断言各取一个假面：
//    ① 停机**之后**零预留（把检查挪到 reserve 之后即变假）；② 轮**不**记 verified；③ 已取得的那一笔
//    预留**保持已支出**（不因停机回滚）。
const OSD_CARRIER = ".quay/open-semantic-discovery-findings.jsonl";
const OSD_LEDGER = ".quay/open-semantic-discovery-model-budget.jsonl";
const osdRounds = (ws) => (fs.existsSync(path.join(ws, OSD_CARRIER))
  ? fs.readFileSync(path.join(ws, OSD_CARRIER), "utf8").split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l))
  : []);
const osdLedger = (ws) => (fs.existsSync(path.join(ws, OSD_LEDGER))
  ? fs.readFileSync(path.join(ws, OSD_LEDGER), "utf8").split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l))
  : []);

function osdWorkspace() {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), "qg-osd-stop-"));
  fs.mkdirSync(path.join(ws, ".quay"), { recursive: true });
  fs.mkdirSync(path.join(ws, "plugin", "scripts"), { recursive: true });
  fs.writeFileSync(path.join(ws, "plugin", "scripts", "capability-catalog.sh"), "#!/bin/bash\nexit 0\n", "utf8");
  fs.writeFileSync(path.join(ws, ".quay", "config.yml"),
    "loop:\n  open_semantic_discovery:\n    enabled: true\n    interval: interval:60m\n    interval_until: 2026-10-20T00:00:00Z\n    investigator_runs: 1\n    max_clusters_verified: 3\n    verifier_max_turns: 8\n    refutation_max_turns: 6\n    max_wall_ms: 1200000\n    max_model_calls_per_24h: 120\n    max_usd_per_24h: 30\n", "utf8");
  return ws;
}

test("AC3（OSD 轮级）— 停机到达 ⇒ 不再取预留、轮记 not-evaluated: stopped-mid-round（⛔ 非 verified）、已花的那笔保持已支出", async (t) => {
  const ws = osdWorkspace();
  t.after(() => fs.rmSync(ws, { recursive: true, force: true }));
  const ac = new AbortController();
  const spawned = [];
  const verifierPromptFile = path.join(ws, "verifier-prompt.txt");
  fs.writeFileSync(verifierPromptFile, "verify {{HYP}} on the pin\n", "utf8");
  const investigatorPromptFile = path.join(ws, "investigator-prompt.txt");
  fs.writeFileSync(investigatorPromptFile, "explore the pin\n", "utf8");
  // 一条「调查员」：真走一次 `reservingStep`（真预留 + 真子进程 + 真 outcome），**然后**停机到达。
  // 第二次模型调用会在 choke point 上读到 aborted ⇒ 轮在**下一个模型调用边界**收尾（Plan 步 2）。
  let n = 0;
  const spawnFn = async (argv) => {
    spawned.push(argv);
    n += 1;
    if (n === 1) ac.abort();
    return { status: 0, signal: null, stdout: JSON.stringify({ type: "result", result: "{}" }), stderr: "", error: null };
  };
  const hyp = {
    PIN_FORBIDDEN_DIRS: [], HARD_MAX_CLUSTERS: 8, DEFAULT_EVIDENCE_MAX_LINES: 40,
    hardenedArgv: (_launch, _prompt, _root, o) => ["claude", "--tools", String(o.tools), "--max-turns", String(o.maxTurns)],
    verifyCwdRefusal: () => ({ ok: true }),
    buildInventory: () => ({ entries: [], text: "", sha256: null }),
    parseVerifierStream: () => ({ ok: true, num_turns: 1, usage: null, model: null, turns: [], finalText: "" }),
    streamDiagnostics: () => ({ bytes: 0, lines: 0, json_lines: 0, truncated_json: false, api_error_event: false, has_result: true, events_by_type: {}, unparsed_json_lines: 0 }),
    toolUseSummary: () => ({}),
    callText: (s) => String(s),
    parseJsonObject: (s) => { try { return JSON.parse(String(s)); } catch { return null; } },
    // `defaultVerifierPrompt()` 返回的是一个**提示词模板文件路径**（生产同形），故夹具先落一个真文件。
    defaultVerifierPrompt: () => verifierPromptFile,
    defaultInvestigatorPrompt: () => investigatorPromptFile, preregRefusal: () => null, TOOL: "Read",
    // 两次 run：第 1 次真的取预留并 spawn（停机在它返回后到达）；第 2 次在 `budget.reserve` **之前**
    // 就读到 aborted ⇒ 抛出。这正是 Plan 步 2 的「下一个模型调用边界」。
    runInvestigator: async (o) => {
      const recs = [];
      for (let i = 0; i < o.runs; i++) {
        const r = await o.runModel(o.prompt, i);
        recs.push({ run: i + 1, hyps: [], stdout: r?.stdout ?? "", exit: r?.status ?? null });
      }
      return { ok: true, records: recs, parsed: 0, total: o.runs };
    },
    runVerifier: async () => ({ ok: true, clusters_total: 0, verified: 0, beyond_cap: 0, results: [] }),
  };
  const fact = await runOpenSemanticDiscovery(ws, {
    config: readOpenSemanticDiscoveryConfig(ws).config,
    configPresent: true, configError: null, halted: false, invokedBy: INVOKED_BY_RESIDENT,
    signal: ac.signal,
    // ⛔ 只替**读者**，不替判定：方法选取要的是「读不懂 ⇒ baseline」那三态，故这里给的是
    // `file === null`（注册表未解析）——被选取的模块中**没有任何一条**抑制语义轮（其自身的契约）。
    modules: {
      hyp,
      portfolio: {},
      ledger: { experienceDenyList: () => ({ ok: false, ids: [] }) },
      registry: {
        readMethodRegistry: () => ({ file: null, reason: "REGISTRY_UNRESOLVABLE:fixture-has-no-registry", ok: false, latest: [], history: [], malformed_lines: 0 }),
        activeMethods: () => ({ ok: false, active_ids: [], contaminated_verdicts_evaluated: null }),
        contaminatedVerdictIds: () => ({ ok: false, ids: [] }),
      },
    },
    launchArgvFn: () => ["claude"],
    spawnFn,
    revFn: () => "deadbeefdeadbeef",
    pinFn: ({ dir }) => { fs.mkdirSync(dir, { recursive: true }); return { ok: true, dir }; },
  });
  assert.equal(fact.state, "not-evaluated", `⛔ 半轮**绝不**记 verified（硬规则 3b）— reason: ${fact.reason}`);
  assert.match(fact.reason, /^stopped-mid-round: /);
  assert.match(fact.reason, /stay RESERVED/);
  assert.match(fact.reason, /the production last-run was NOT advanced/);
  const reserves = osdLedger(ws).filter((l) => l.kind === "reserve");
  const outcomes = osdLedger(ws).filter((l) => l.kind === "outcome");
  assert.equal(spawned.length, 1, "⛔ 停机之后不再起第二个模型子进程（检查在 reserve 之前 ⇒ 也在 spawn 之前）");
  assert.equal(reserves.length, 1, "⛔ 停机之后 reserve 计数**不动**（这一条把检查挪到 reserve 之后立刻变假）");
  assert.equal(outcomes.length, 1, "已取的那一笔预留记了 outcome ⇒ 台账自洽：花掉的算花掉，⛔ 不回滚");
  const lines = osdRounds(ws);
  assert.equal(lines.length, 1, "已做过的事持久化了一行（硬规则 3b：半轮留痕，且**不**冒充完整轮）");
  assert.equal(lines[0].partial, true);
  assert.equal(lines[0].partial_reason, "stopped-mid-round:investigator");
  // 停机**在飞**到达：这一笔预留已取、已 spawn，轮在**这次调用自己的边界**上收尾（⛔ 不继续走到验证步 ——
  // 那一步会再取预留）。`after_stop:false` 与「停机之后才走到」的 `true` **不同形**（硬规则 3b）。
  assert.equal(lines[0].stopped_mid_round.after_stop, false);
  assert.equal(lines[0].stopped_mid_round.calls_made, 1);
  assert.ok(!fs.existsSync(path.join(ws, ".quay", "routine-last-run.json")), "last-run 未被推进");
});

// ── arch-coverage-report 例程（gap-arch-coverage-report-report-only-not-run-in-production）─────────
//
// This routine answers "which languages/directories does NO analyzer reach?" in PRODUCTION. The
// properties pinned here, in the order they can silently regress:
//   ① an UNDECLARED workspace's routine set is unchanged (AC144's exactly-four test keeps its meaning);
//   ② the routine WRITES a baseline line every due round (AC2: per-language + NOT-EVALUATED counts);
//   ③ NOT-EVALUATED is CONTENT, never `failed` — and `failed` is still reachable for REAL failures
//      (bad config / unwritable carrier), so ③ is a distinction, not a blanket "never fail" (AC3).

/** A REAL git worktree with one file per language. `listTrackedFiles` uses `git ls-files`, so a
 *  plain temp dir would only ever exercise the `evaluated:false` path — that is asserted separately. */
function makeCoverageGitRepo(tmp) {
  const repo = path.join(tmp, "coverage-repo");
  for (const f of ["src/a.ts", "src/b.mjs", "src/c.js", "src/d.sh", "src/e.py"]) {
    const p = path.join(repo, f);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, "// fixture\n");
  }
  const env = {
    ...process.env,
    GIT_AUTHOR_NAME: "coverage fixture", GIT_AUTHOR_EMAIL: "coverage@example.invalid",
    GIT_COMMITTER_NAME: "coverage fixture", GIT_COMMITTER_EMAIL: "coverage@example.invalid",
  };
  for (const args of [["init", "-q"], ["add", "-A"], ["commit", "-q", "-m", "fixture"]]) {
    const r = spawnSync("git", ["-C", repo, ...args], { env, encoding: "utf8" });
    assert.equal(r.status, 0, `git ${args.join(" ")} failed: ${r.stderr}`);
  }
  return repo;
}

function coverageBaseOpts() {
  return {
    planCmd: null, judgeArgv: null, judgmentCmd: null, resourceGateArgv: null,
    identityCmd: null, lineageCmd: null, deletionCmd: null, archJudgeArgv: null,
    poolJudgeIntervalMinutes: 10, judgmentIntervalMinutes: 30, archReviewIntervalMinutes: 60,
    packagingCheckCmd: null, packagingGapWorkerCmd: null, packagingGapWorkerTimeoutMs: 900_000,
    packagingHygieneIntervalMinutes: 60,
    archGapWorkerCmd: null, archGapWorkerTimeoutMs: 900_000,
  };
}

test("arch-coverage config — absent ⇒ present:false; malformed / below-floor fail closed; disabled is its own state", (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "qg-coverage-cfg-"));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  // Off by default: no `.quay/config.yml` at all ⇒ the host routine set is unchanged.
  assert.deepEqual(readArchCoverageConfig(tmp), { present: false, config: null, error: null });

  assert.notEqual(parseArchCoverageSection(null).error, null);
  const missingEnabled = parseArchCoverageSection({ interval: "interval:360m" });
  assert.equal(missingEnabled.config, null);
  assert.match(missingEnabled.error, /boolean 'enabled'/);

  const belowFloor = parseArchCoverageSection({ enabled: true, interval: `interval:${ARCH_COVERAGE_MIN_INTERVAL_MINUTES - 1}m` });
  assert.equal(belowFloor.config, null);
  assert.match(belowFloor.error, new RegExp(`${ARCH_COVERAGE_MIN_INTERVAL_MINUTES}m floor`));

  const badGrammar = parseArchCoverageSection({ enabled: true, interval: "every(5)" });
  assert.equal(badGrammar.config, null);

  assert.deepEqual(parseArchCoverageSection({ enabled: false }), { config: { enabled: false, intervalMinutes: null }, error: null });
  assert.deepEqual(parseArchCoverageSection({ enabled: true, interval: "interval:360m" }), {
    config: { enabled: true, intervalMinutes: 360 }, error: null,
  });
});

test("archCoverageRoutineFromConfig — an UNDECLARED workspace keeps EXACTLY the four built-in routines", (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "qg-coverage-absent-"));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const read = archCoverageRoutineFromConfig(tmp);
  assert.equal(read.routine, null, "no section ⇒ the routine is not even ADDED to the table");
  assert.equal(read.present, false);
  assert.equal(read.error, null);

  const without = qualityGateRoutines(tmp, coverageBaseOpts()).map((r) => r.name);
  assert.deepEqual(without, ["pool-quality-judge", "judgment-consumer-check", "architecture-review", "packaging-hygiene"]);
  const injected = { name: ARCH_COVERAGE_ROUTINE_NAME, schedule: { kind: "interval", minutes: ARCH_COVERAGE_INTERVAL_MIN_DEFAULT }, run: () => [] };
  const withIt = qualityGateRoutines(tmp, { ...coverageBaseOpts(), archCoverageRoutine: injected }).map((r) => r.name);
  assert.deepEqual(withIt, [...without, ARCH_COVERAGE_ROUTINE_NAME], "the injection appends; it never displaces a built-in");
});

test("archCoverageRoutineFromConfig — a DECLARED section is assembled and carries its declared interval", (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "qg-coverage-declared-"));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  fs.mkdirSync(path.join(tmp, ".quay"), { recursive: true });
  fs.writeFileSync(path.join(tmp, ".quay", "config.yml"), "loop:\n  arch_coverage_report:\n    enabled: true\n    interval: interval:120m\n", "utf8");
  const read = archCoverageRoutineFromConfig(tmp);
  assert.equal(read.present, true);
  assert.equal(read.enabled, true);
  assert.equal(read.error, null);
  assert.equal(read.routine.name, ARCH_COVERAGE_ROUTINE_NAME);
  assert.deepEqual(read.routine.schedule, { kind: "interval", minutes: 120 });
});

test("runArchCoverageRound — enabled ⇒ VERIFIED while NOT-EVALUATED is non-zero, and one baseline line is appended (AC2/AC3)", (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "qg-coverage-round-"));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const repo = makeCoverageGitRepo(tmp);
  const history = path.join(tmp, "history.jsonl");
  const opts = { config: { enabled: true, intervalMinutes: 360 }, configPresent: true, configError: null, historyPath: history };

  const fact = runArchCoverageRound(repo, { ...opts, now: "T0" });
  assert.equal(fact.name, ARCH_COVERAGE_ROUTINE_NAME);
  assert.ok(fact.value.notEvaluatedLanguageCount > 0, "the fixture must actually be unevaluated or AC3 is vacuous");
  assert.deepEqual([...fact.value.noAnalyzerLanguages].sort(), ["js", "mjs", "py", "sh"]);
  assert.equal(fact.value.noAnalyzerLanguageCount, 4);
  // AC3, the load-bearing assertion: a non-zero NOT-EVALUATED count does NOT become `failed`.
  assert.equal(fact.state, "verified", `NOT-EVALUATED 非零不得使例程轮 failed（AC3）; got ${fact.state}: ${fact.reason}`);
  assert.equal(fact.value.reportOnly, true);
  assert.equal(fact.value.historyAppended, true);

  const lines = fs.readFileSync(history, "utf8").split("\n").filter((l) => l !== "");
  assert.equal(lines.length, 1, "one due round ⇒ exactly one baseline line");
  const rec = JSON.parse(lines[0]);
  assert.equal(rec.ts, "T0");
  assert.equal(rec.noAnalyzerLanguageCount, 4);
  assert.equal(rec.languages.length, 5);

  // Append-only: a second due round adds a second line, never rewrites the first.
  runArchCoverageRound(repo, { ...opts, now: "T1" });
  const after = fs.readFileSync(history, "utf8").split("\n").filter((l) => l !== "");
  assert.equal(after.length, 2);
  assert.equal(JSON.parse(after[0]).ts, "T0");
  assert.equal(JSON.parse(after[1]).ts, "T1");
});

test("runArchCoverageRound — kill switch ⇒ not-evaluated:disabled and ZERO writes", (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "qg-coverage-disabled-"));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const history = path.join(tmp, "history.jsonl");
  const fact = runArchCoverageRound(tmp, {
    config: { enabled: false, intervalMinutes: null }, configPresent: true, configError: null, historyPath: history,
  });
  assert.equal(fact.state, "not-evaluated");
  assert.equal(fact.value, null);
  assert.match(fact.reason, /disabled/);
  assert.equal(fs.existsSync(history), false, "the kill switch must produce zero writes");
});

test("runArchCoverageRound — bad config and an unwritable carrier ARE failed (the negative control for AC3)", (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "qg-coverage-failed-"));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const badConfig = runArchCoverageRound(tmp, {
    config: null, configPresent: true, configError: "loop.arch_coverage_report needs a boolean 'enabled'",
  });
  assert.equal(badConfig.state, "failed");
  assert.match(badConfig.reason, /boolean 'enabled'/);

  const repo = makeCoverageGitRepo(tmp);
  const blocker = path.join(tmp, "blocker");
  fs.writeFileSync(blocker, "not a directory");
  const unwritable = runArchCoverageRound(repo, {
    config: { enabled: true, intervalMinutes: 360 }, configPresent: true, configError: null,
    historyPath: path.join(blocker, "history.jsonl"),
  });
  assert.equal(unwritable.state, "failed", "a report that could not persist its baseline is not a verified round");
  assert.match(unwritable.reason, /history carrier not writable/);

  // The three outcomes are three DIFFERENT shapes — "not evaluated" never dresses as "failed".
  assert.notEqual(unwritable.state, "not-evaluated");
});

test("runArchCoverageRound — an unreadable input ⇒ not-evaluated (not failed) and STILL leaves a line marked evaluated:false", (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "qg-coverage-nongit-"));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const history = path.join(tmp, "history.jsonl");
  const fact = runArchCoverageRound(tmp, {
    config: { enabled: true, intervalMinutes: 360 }, configPresent: true, configError: null, historyPath: history, now: "T",
  });
  assert.equal(fact.state, "not-evaluated");
  assert.equal(fact.value.evaluated, false);
  const rec = JSON.parse(fs.readFileSync(history, "utf8").trim());
  assert.equal(rec.evaluated, false);
  assert.equal(rec.reason, "not-a-git-worktree", "the carrier records the inability, not silence");
});

test("formatArchCoverageAssembly — enabled / disabled / malformed are three DIFFERENT startup lines (硬规则 3b/9)", () => {
  const enabled = formatArchCoverageAssembly({ present: true, error: null, enabled: true, intervalMinutes: 360 });
  const disabled = formatArchCoverageAssembly({ present: true, error: null, enabled: false, intervalMinutes: 360 });
  const malformed = formatArchCoverageAssembly({ present: true, error: "loop.arch_coverage_report needs a boolean 'enabled'", enabled: false, intervalMinutes: 360 });
  assert.notEqual(enabled, disabled);
  assert.notEqual(disabled, malformed);
  assert.match(enabled, /interval=360m/);
  assert.match(enabled, /report-only/);
  assert.match(disabled, /not-evaluated:disabled/);
  assert.match(malformed, /failed/);
});

// ── arch-cycle-report 例程（gap-arch-cycle-report-only-routine）────────────────────────────────
// AC2 / AC3 / AC4。AC1（生产载体真出现记录）在落地后的真实例程轮，由任务体标为「待外部」。
//
// 夹具读的是 archguard-runner 的**同一套** query 产物布局（`<workDir>/query/manifest.json` +
// `<workDir>/query/<key>/arch.json` 的 `extensions.tsAnalysis.moduleGraph.cycles`），⛔ 不是为测试
// 另造一个形状——否则「读到了」只证明夹具自洽。

/** The six sources archguard-runner analyzes (kept in sync by reading the failure mode: a missing
 *  scope must be REPORTED, so the fixture must know the same set). */
const ARCH_CYCLE_SOURCES = [
  "packages/quay/src",
  "plugin/scripts",
  "packages/quay-native/src",
  "packages/quay-github/src",
  "packages/quay-backlog/src",
  "experiments/quay-perpetual-stream/scripts",
];

/** Materialize the query artifacts the LAST analyze would have persisted under `<root>/.archguard`.
 *
 *  `opts.timestampBySource` sets each scope's arch.json `timestamp` (the freshness source the routine
 *  records); `opts.omitArchTimestamp` writes arch.json WITHOUT one so the manifest `generatedAt`
 *  fallback can be exercised.
 *
 *  The GLOBAL scope (`manifest.globalScopeKey`) is written too: it is where archguard_summary's
 *  `topByOutDegree` / `relationCountByType` come from, and the arch-cycle routine now reads it in the
 *  same round (gap-quality-round-facts-surface-top-outdegree-god-functions). `opts.global` supplies its
 *  `entities`/`relations`; the default is a genuinely EMPTY graph (evaluated:true, `{}`/`[]`) — which
 *  keeps the cycle-only tests meaningful and is a different value from "could not read". */
function makeArchQueryFixture(root, cyclesBySource, opts = {}) {
  const queryDir = path.join(root, ".archguard", "query");
  fs.mkdirSync(queryDir, { recursive: true });
  const defaultTimestamp = opts.generatedAt ?? "2026-10-18T00:00:00Z";
  const scopes = [];
  ARCH_CYCLE_SOURCES.forEach((source, i) => {
    const key = `scope-${i}`;
    scopes.push({ key, sources: [path.resolve(root, source)], generatedAt: defaultTimestamp });
    fs.mkdirSync(path.join(queryDir, key), { recursive: true });
    const cycles = (cyclesBySource?.[source] ?? []).map((modules) => ({ modules }));
    const artifact = { language: "typescript", extensions: { tsAnalysis: { moduleGraph: { cycles } } } };
    if (!opts.omitArchTimestamp) artifact.timestamp = opts.timestampBySource?.[source] ?? defaultTimestamp;
    fs.writeFileSync(path.join(queryDir, key, "arch.json"), JSON.stringify(artifact), "utf8");
  });
  if (opts.omitGlobalScope !== true) {
    const globalKey = "global-scope";
    scopes.push({ key: globalKey, label: "quay (typescript)", sources: [path.resolve(root)], generatedAt: defaultTimestamp });
    fs.mkdirSync(path.join(queryDir, globalKey), { recursive: true });
    const globalArtifact = {
      language: "typescript",
      timestamp: opts.global?.timestamp ?? defaultTimestamp,
      entities: opts.global?.entities ?? [],
      relations: opts.global?.relations ?? [],
    };
    fs.writeFileSync(path.join(queryDir, globalKey, "arch.json"), JSON.stringify(globalArtifact), "utf8");
  }
  const manifest = { scopes };
  if (opts.omitGlobalScope !== true) manifest.globalScopeKey = "global-scope";
  fs.writeFileSync(path.join(queryDir, "manifest.json"), JSON.stringify(manifest), "utf8");
}

test("arch-cycle config — absent ⇒ present:false; bad/interval-below-floor fail closed; interval defaults to 360m (AC4)", (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "qg-cycle-cfg-"));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  assert.deepEqual(readArchCycleConfig(tmp), { present: false, config: null, error: null });

  assert.notEqual(parseArchCycleSection(null).error, null);
  const missingEnabled = parseArchCycleSection({ interval: "interval:360m" });
  assert.equal(missingEnabled.config, null);
  assert.match(missingEnabled.error, /boolean 'enabled'/);

  // An enabled section WITHOUT `interval` uses the documented default (this is the Plan's「缺省 360m」).
  assert.deepEqual(parseArchCycleSection({ enabled: true }), {
    config: { enabled: true, intervalMinutes: ARCH_CYCLE_INTERVAL_MIN_DEFAULT }, error: null,
  });
  // A DECLARED-but-malformed interval is refused — never silently rounded back to the default.
  const belowFloor = parseArchCycleSection({ enabled: true, interval: `interval:${ARCH_CYCLE_MIN_INTERVAL_MINUTES - 1}m` });
  assert.equal(belowFloor.config, null);
  assert.match(belowFloor.error, new RegExp(`${ARCH_CYCLE_MIN_INTERVAL_MINUTES}m floor`));
  assert.equal(parseArchCycleSection({ enabled: true, interval: "every(5)" }).config, null);

  assert.deepEqual(parseArchCycleSection({ enabled: false }), { config: { enabled: false, intervalMinutes: null }, error: null });
  assert.deepEqual(parseArchCycleSection({ enabled: true, interval: "interval:120m" }), {
    config: { enabled: true, intervalMinutes: 120 }, error: null,
  });
});

test("archCycleRoutineFromConfig — an UNDECLARED workspace keeps EXACTLY the four built-in routines (AC4)", (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "qg-cycle-absent-"));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const read = archCycleRoutineFromConfig(tmp);
  assert.equal(read.routine, null, "no section ⇒ the routine is not even ADDED to the table");
  assert.equal(read.present, false);
  assert.equal(read.error, null);

  const without = qualityGateRoutines(tmp, coverageBaseOpts()).map((r) => r.name);
  assert.deepEqual(without, ["pool-quality-judge", "judgment-consumer-check", "architecture-review", "packaging-hygiene"]);
  const injected = { name: ARCH_CYCLE_ROUTINE_NAME, schedule: { kind: "interval", minutes: ARCH_CYCLE_INTERVAL_MIN_DEFAULT }, run: () => [] };
  const withIt = qualityGateRoutines(tmp, { ...coverageBaseOpts(), archCycleRoutine: injected }).map((r) => r.name);
  assert.deepEqual(withIt, [...without, ARCH_CYCLE_ROUTINE_NAME], "the injection appends; it never displaces a built-in");
});

test("archCycleRoutineFromConfig — a DECLARED section is assembled with its declared interval", (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "qg-cycle-declared-"));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  fs.mkdirSync(path.join(tmp, ".quay"), { recursive: true });
  fs.writeFileSync(path.join(tmp, ".quay", "config.yml"), "loop:\n  arch_cycle_report:\n    enabled: true\n    interval: interval:120m\n", "utf8");
  const read = archCycleRoutineFromConfig(tmp);
  assert.equal(read.present, true);
  assert.equal(read.enabled, true);
  assert.equal(read.error, null);
  assert.equal(read.routine.name, ARCH_CYCLE_ROUTINE_NAME);
  assert.deepEqual(read.routine.schedule, { kind: "interval", minutes: 120 });

  // Declaration without an explicit interval ⇒ the documented 360m default, not an unset schedule.
  fs.writeFileSync(path.join(tmp, ".quay", "config.yml"), "loop:\n  arch_cycle_report:\n    enabled: true\n", "utf8");
  assert.deepEqual(archCycleRoutineFromConfig(tmp).routine.schedule, { kind: "interval", minutes: 360 });
});

test("runArchCycleRound — a NON-EMPTY cycle reading is VERIFIED (report-only, AC2) and the line names the members", (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "qg-cycle-round-"));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  makeArchQueryFixture(tmp, {
    "packages/quay/src": [["src/a", "src/b"]],
    "plugin/scripts": [["scripts/x", "scripts/y", "scripts/z"]],
  });
  const history = path.join(tmp, "history.jsonl");
  const opts = { config: { enabled: true, intervalMinutes: 360 }, configPresent: true, configError: null, historyPath: history, now: "T0" };

  const fact = runArchCycleRound(tmp, opts);
  assert.equal(fact.name, ARCH_CYCLE_ROUTINE_NAME);
  // AC2, the load-bearing assertion: two directory cycles do NOT become `failed` (this is a REPORT).
  assert.equal(fact.state, "verified", `环非空不得使例程轮 failed（AC2）; got ${fact.state}: ${fact.reason}`);
  assert.equal(fact.value.reportOnly, true);
  assert.equal(fact.value.evaluated, true);
  assert.equal(fact.value.totalCycleCount, 2);
  assert.equal(fact.value.historyAppended, true);

  const lines = fs.readFileSync(history, "utf8").split("\n").filter((l) => l !== "");
  assert.equal(lines.length, 1, "one due round ⇒ exactly one history line");
  const rec = JSON.parse(lines[0]);
  assert.equal(rec.ts, "T0");
  assert.equal(rec.evaluated, true);
  assert.equal(rec.totalCycleCount, 2);
  assert.equal(rec.reportOnly, true);
  // AC2's second half: the record carries the cycle MEMBERS, not just a count.
  const withCycles = rec.scopes.filter((s) => s.cycleCount > 0);
  assert.equal(withCycles.length, 2);
  const srcScope = rec.scopes.find((s) => s.scope === "src");
  assert.deepEqual(srcScope.cycles, [{ size: 2, modules: ["src/a", "src/b"] }]);
  const scriptScope = rec.scopes.find((s) => s.scope === "scripts");
  assert.deepEqual(scriptScope.cycles, [{ size: 3, modules: ["scripts/x", "scripts/y", "scripts/z"] }]);

  // Append-only: a second due round adds a second line, never rewrites the first.
  runArchCycleRound(tmp, { ...opts, now: "T1" });
  const after = fs.readFileSync(history, "utf8").split("\n").filter((l) => l !== "");
  assert.deepEqual(after.map((l) => JSON.parse(l).ts), ["T0", "T1"]);
});

test("runArchCycleRound — the record says HOW OLD the artifact is: artifactTimestamp + three-valued stale (AC1/AC2)", (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "qg-cycle-freshness-"));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const ARTIFACT_TS = "2026-10-18T00:00:00Z";
  // One scope carries an OLDER artifact: the aggregate must report the OLDEST, not a fresher sibling.
  const OLDER_TS = "2026-10-11T00:00:00Z";
  makeArchQueryFixture(
    tmp,
    { "packages/quay/src": [["src/a", "src/b"]] },
    { timestampBySource: { "plugin/scripts": OLDER_TS } },
  );
  const history = path.join(tmp, "history.jsonl");
  const base = { config: { enabled: true, intervalMinutes: 360 }, configPresent: true, configError: null, historyPath: history };

  const readArtifactTs = (source) => {
    const manifest = JSON.parse(fs.readFileSync(path.join(tmp, ".archguard", "query", "manifest.json"), "utf8"));
    const entry = manifest.scopes.find((s) => s.sources.includes(path.resolve(tmp, source)));
    return JSON.parse(fs.readFileSync(path.join(tmp, ".archguard", "query", entry.key, "arch.json"), "utf8")).timestamp;
  };

  // AC1: the recorded timestamp IS the timestamp of the arch.json actually read.
  assert.equal(readArtifactTs("packages/quay/src"), ARTIFACT_TS);
  assert.equal(readArtifactTs("plugin/scripts"), OLDER_TS);

  // AC2 (stale): 2 days old with a 360m interval ⇒ stale:true, and the age is the oldest scope's.
  const staleFact = runArchCycleRound(tmp, { ...base, now: "2026-10-20T00:00:00Z" });
  assert.equal(staleFact.state, "verified");
  assert.equal(staleFact.value.artifactTimestamp, OLDER_TS, "aggregate freshness = OLDEST artifact read, not the newest");
  assert.equal(staleFact.value.stale, true);
  assert.equal(staleFact.value.staleIntervalMs, 360 * 60_000);
  assert.equal(staleFact.value.artifactAgeMs, Date.parse("2026-10-20T00:00:00Z") - Date.parse(OLDER_TS));
  const staleRec = JSON.parse(fs.readFileSync(history, "utf8").trim().split("\n").pop());
  assert.equal(staleRec.artifactTimestamp, OLDER_TS);
  assert.equal(staleRec.stale, true);
  assert.equal(staleRec.staleIntervalMs, 360 * 60_000);
  // Per-scope freshness is carried too (AC1 applies to the line, and per-scope lets a reader see WHICH
  // scope is stale rather than only that the aggregate is).
  assert.deepEqual(
    [...new Set(staleRec.scopes.filter((s) => s.artifactTimestamp != null).map((s) => s.artifactTimestamp))].sort(),
    [OLDER_TS, ARTIFACT_TS].sort(),
  );

  // Negative control: a round whose report time is INSIDE one interval of the artifact is NOT stale.
  // Without this, `stale:true` above could be a constant.
  const freshFact = runArchCycleRound(tmp, { ...base, now: "2026-10-11T01:00:00Z" });
  assert.equal(freshFact.value.artifactTimestamp, OLDER_TS);
  assert.equal(freshFact.value.stale, false);
});

test("runArchCycleRound — NO readable artifact ⇒ artifactTimestamp/stale are null, NEVER 'fresh' (AC1/AC2, 硬规则 3b)", (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "qg-cycle-noartifact-"));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const history = path.join(tmp, "history.jsonl");
  const fact = runArchCycleRound(tmp, {
    config: { enabled: true, intervalMinutes: 360 }, configPresent: true, configError: null,
    historyPath: history, now: "2026-10-20T00:00:00Z",
  });
  assert.equal(fact.value.artifactTimestamp, null);
  assert.equal(fact.value.artifactAgeMs, null);
  assert.equal(fact.value.stale, null, "⛔ null (not-evaluable), never false — 'could not tell' must not read as 'fresh'");
  const rec = JSON.parse(fs.readFileSync(history, "utf8").trim());
  assert.ok(Object.prototype.hasOwnProperty.call(rec, "artifactTimestamp"), "the field is PRESENT even when null (AC1)");
  assert.equal(rec.stale, null);
});

test("runArchCycleRound — arch.json without `timestamp` falls back to the manifest scope's generatedAt (AC1)", (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "qg-cycle-tsfallback-"));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  makeArchQueryFixture(tmp, { "packages/quay/src": [["src/a", "src/b"]] }, { omitArchTimestamp: true, generatedAt: "2026-10-19T12:00:00Z" });
  const fact = runArchCycleRound(tmp, {
    config: { enabled: true, intervalMinutes: 360 }, configPresent: true, configError: null,
    historyPath: path.join(tmp, "history.jsonl"), now: "2026-10-19T13:00:00Z",
  });
  assert.equal(fact.value.artifactTimestamp, "2026-10-19T12:00:00Z");
  assert.equal(fact.value.artifactAgeMs, 60 * 60_000);
  assert.equal(fact.value.stale, false);
});

test("runArchCycleRound — an UNREADABLE module graph is `not-evaluated` + evaluated:false, NEVER the same value as 0 cycles (AC3)", (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "qg-cycle-none-"));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const history = path.join(tmp, "history.jsonl");
  const opts = { config: { enabled: true, intervalMinutes: 360 }, configPresent: true, configError: null, historyPath: history, now: "T" };

  // No `.archguard/query` at all: nothing to read (the `gap-fan-in-remove-archguard-gate` steady state).
  const fact = runArchCycleRound(tmp, opts);
  assert.equal(fact.state, "not-evaluated", "读不到 moduleGraph 不是 verified，也不是 failed");
  assert.equal(fact.value.evaluated, false);
  assert.equal(fact.value.totalCycleCount, null, "⛔ null, never 0 — 读不到不得与「0 环」同值（AC3）");
  assert.equal(fact.value.notEvaluatedScopes.length, ARCH_CYCLE_SOURCES.length);
  assert.match(fact.reason, /not-evaluated:module-graph/);

  // The inability is still PERSISTED (else "never read" and "read clean" look identical in history).
  const rec = JSON.parse(fs.readFileSync(history, "utf8").trim());
  assert.equal(rec.evaluated, false);
  assert.equal(rec.totalCycleCount, null);
  assert.ok(rec.reason && rec.reason.length > 0, "the record must carry WHY it could not be evaluated");

  // The negative control: a CLEAN fixture is the OTHER shape (evaluated:true, total 0). If these two
  // ever compare equal, the three-valued state has collapsed into "no cycles".
  const clean = fs.mkdtempSync(path.join(os.tmpdir(), "qg-cycle-clean-"));
  t.after(() => fs.rmSync(clean, { recursive: true, force: true }));
  makeArchQueryFixture(clean, {});
  const cleanFact = runArchCycleRound(clean, { ...opts, historyPath: path.join(clean, "history.jsonl") });
  assert.equal(cleanFact.state, "verified");
  assert.equal(cleanFact.value.evaluated, true);
  assert.equal(cleanFact.value.totalCycleCount, 0);
  assert.notEqual(fact.value.evaluated, cleanFact.value.evaluated);
  assert.notEqual(fact.value.totalCycleCount, cleanFact.value.totalCycleCount);
});

test("runArchCycleRound — kill switch ⇒ not-evaluated:disabled and ZERO writes; bad config ⇒ failed (AC4)", (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "qg-cycle-disabled-"));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const history = path.join(tmp, "history.jsonl");
  const disabled = runArchCycleRound(tmp, {
    config: { enabled: false, intervalMinutes: null }, configPresent: true, configError: null, historyPath: history,
  });
  assert.equal(disabled.state, "not-evaluated");
  assert.equal(disabled.value, null);
  assert.match(disabled.reason, /disabled/);
  assert.equal(fs.existsSync(history), false, "the kill switch must produce zero writes");

  const badConfig = runArchCycleRound(tmp, {
    config: null, configPresent: true, configError: "loop.arch_cycle_report needs a boolean 'enabled'", historyPath: history,
  });
  assert.equal(badConfig.state, "failed");
  assert.match(badConfig.reason, /boolean 'enabled'/);
  assert.equal(fs.existsSync(history), false, "a malformed section also writes nothing");

  // The carrier's own failure is `failed` — never a silently verified round.
  const blocker = path.join(tmp, "blocker");
  fs.writeFileSync(blocker, "not a directory");
  makeArchQueryFixture(tmp, {});
  const unwritable = runArchCycleRound(tmp, {
    config: { enabled: true, intervalMinutes: 360 }, configPresent: true, configError: null,
    historyPath: path.join(blocker, "history.jsonl"),
  });
  assert.equal(unwritable.state, "failed");
  assert.match(unwritable.reason, /history carrier not writable/);
});

test("formatArchCycleAssembly — enabled / disabled / malformed are three DIFFERENT startup lines (硬规则 3b/9)", () => {
  const enabled = formatArchCycleAssembly({ present: true, error: null, enabled: true, intervalMinutes: 360 });
  const disabled = formatArchCycleAssembly({ present: true, error: null, enabled: false, intervalMinutes: 360 });
  const malformed = formatArchCycleAssembly({ present: true, error: "loop.arch_cycle_report needs a boolean 'enabled'", enabled: false, intervalMinutes: 360 });
  assert.notEqual(enabled, disabled);
  assert.notEqual(disabled, malformed);
  assert.match(enabled, /interval=360m/);
  assert.match(enabled, /report-only/);
  assert.match(disabled, /not-evaluated:disabled/);
  assert.match(malformed, /failed/);
});

// ── graph summary: topByOutDegree + relationCountByType ────────────────────────────────────────
// gap-quality-round-facts-surface-top-outdegree-god-functions. The readings come from the SAME
// `.archguard/query/<globalScopeKey>/arch.json` the cycle reading already reads — same fixture layout,
// no second analyzer, no spawn.

/** A global-scope graph with a KNOWN out-degree ranking, INCLUDING a tie (the M118 audit's finding was
 *  a silently dropped tied entry — the ranking must be deterministic and disclose truncation). */
const GRAPH_ENTITIES = [
  { id: "a.ts.run", name: "run", type: "function", sourceLocation: { file: "plugin/scripts/a.ts", startLine: 40 } },
  { id: "b.ts.handleAllRoutes", name: "handleAllRoutes", type: "function", sourceLocation: { file: "packages/quay/src/b.ts", startLine: 55 } },
  { id: "c.ts.runResidentLoop", name: "runResidentLoop", type: "function", sourceLocation: { file: "plugin/scripts/c.ts", startLine: 70 } },
  { id: "d.ts.runAnchor", name: "runAnchor", type: "function", sourceLocation: { file: "plugin/scripts/d.ts", startLine: 90 } },
];
const GRAPH_RELATIONS = [
  // run: 3 outgoing (2 dependency + 1 call)
  { id: "r1", type: "dependency", source: "a.ts.run", target: "x.ts.t1" },
  { id: "r2", type: "dependency", source: "a.ts.run", target: "x.ts.t2" },
  { id: "r3", type: "call", source: "a.ts.run", target: "x.ts.t3" },
  // handleAllRoutes: 2 outgoing (1 dependency + 1 inheritance)
  { id: "r4", type: "dependency", source: "b.ts.handleAllRoutes", target: "x.ts.t4" },
  { id: "r5", type: "inheritance", source: "b.ts.handleAllRoutes", target: "x.ts.t5" },
  // runResidentLoop and runAnchor TIE at 1 outgoing — tie-break is entityId ASC, so c… before d…
  { id: "r6", type: "dependency", source: "c.ts.runResidentLoop", target: "x.ts.t6" },
  { id: "r7", type: "dependency", source: "d.ts.runAnchor", target: "x.ts.t7" },
];

test("readGraphSummaryReading — topByOutDegree (with positional evidence) + relationCountByType from the GLOBAL scope (AC1)", (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "qg-graph-read-"));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  makeArchQueryFixture(tmp, {}, {
    global: { entities: GRAPH_ENTITIES, relations: GRAPH_RELATIONS, timestamp: "2026-10-20T22:29:35.342Z" },
  });

  const read = readGraphSummaryReading(tmp);
  assert.equal(read.evaluated, true, read.reason ?? "");
  assert.equal(read.scopeKey, "global-scope");
  assert.equal(read.artifactTimestamp, "2026-10-20T22:29:35.342Z");
  assert.equal(read.entityCount, 4);
  assert.equal(read.relationCount, 7);
  // The FULL type distribution — absent types are information (call=2 next to dependency=6490 was the
  // reading that motivated the task), so no subset filter is applied here.
  assert.deepEqual(read.relationCountByType, { dependency: 5, call: 1, inheritance: 1 });
  assert.equal(read.entitiesWithOutgoingRelations, 4);
  assert.equal(read.topByOutDegreeLimit, TOP_OUT_DEGREE_LIMIT_DEFAULT);
  assert.equal(read.topByOutDegreeTruncated, false);
  // Ranking: outDegree DESC, then entityId ASC for the tie (deterministic, not insertion order).
  assert.deepEqual(read.topByOutDegree.map((e) => [e.name, e.outDegree]), [
    ["run", 3], ["handleAllRoutes", 2], ["runResidentLoop", 1], ["runAnchor", 1],
  ]);
  // AC1's "位置证据": every entry carries the artifact's file/line, so a reader can reproduce it
  // without re-running archguard.
  assert.deepEqual(
    { file: read.topByOutDegree[0].file, startLine: read.topByOutDegree[0].startLine, kind: read.topByOutDegree[0].kind },
    { file: "plugin/scripts/a.ts", startLine: 40, kind: "function" },
  );
  assert.equal(read.topByOutDegree[1].file, "packages/quay/src/b.ts");

  // Truncation is DISCLOSED, never silent: a limit of 2 keeps the top 2 and says it was cut.
  const cut = readGraphSummaryReading(tmp, undefined, { limit: 2 });
  assert.equal(cut.topByOutDegree.length, 2);
  assert.equal(cut.topByOutDegreeTruncated, true);
  assert.equal(cut.entitiesWithOutgoingRelations, 4);
  // Determinism: the same artifact read twice yields the same ranking (no Map-order dependence).
  assert.deepEqual(readGraphSummaryReading(tmp).topByOutDegree, read.topByOutDegree);
});

test("runArchCycleRound — the SAME round carries graphSummary, and the Fact names topByOutDegree/relationCountByType at TOP LEVEL (AC1)", (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "qg-graph-round-"));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  makeArchQueryFixture(tmp, { "packages/quay/src": [["src/a", "src/b"]] }, {
    global: { entities: GRAPH_ENTITIES, relations: GRAPH_RELATIONS },
  });
  const history = path.join(tmp, "history.jsonl");
  const fact = runArchCycleRound(tmp, {
    config: { enabled: true, intervalMinutes: 360 }, configPresent: true, configError: null,
    historyPath: history, now: "T0",
  });
  assert.equal(fact.state, "verified", fact.reason ?? "");
  // ⛔ A non-zero out-degree / a large relation count is the reading's CONTENT, never a red (report-only).
  assert.deepEqual(fact.value.relationCountByType, { dependency: 5, call: 1, inheritance: 1 });
  assert.deepEqual(fact.value.topByOutDegree.map((e) => e.outDegree), [3, 2, 1, 1]);
  // One reading, two access paths — the flattened fields ARE the graphSummary's values.
  assert.deepEqual(fact.value.topByOutDegree, fact.value.graphSummary.topByOutDegree);
  assert.deepEqual(fact.value.relationCountByType, fact.value.graphSummary.relationCountByType);

  const rec = JSON.parse(fs.readFileSync(history, "utf8").trim());
  assert.equal(rec.graphSummary.evaluated, true);
  assert.deepEqual(rec.graphSummary.topByOutDegree, fact.value.topByOutDegree);
  assert.deepEqual(rec.graphSummary.relationCountByType, fact.value.relationCountByType);
});

test("readGraphSummaryReading — an unreadable/fake work-dir is NOT-EVALUATED with nulls, never {} / 0 / [] (AC2 硬规则 3b)", (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "qg-graph-fake-"));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const fakeWorkDir = path.join(tmp, "no-such-work-dir");

  const read = readGraphSummaryReading(tmp, fakeWorkDir);
  assert.equal(read.evaluated, false);
  assert.match(read.reason, /cannot read query manifest/);
  assert.equal(read.topByOutDegree, null, "⛔ null, never [] — 'could not read' must not look like 'no god functions'");
  assert.equal(read.relationCountByType, null, "⛔ null, never {}");
  assert.equal(read.relationCount, null, "⛔ null, never 0");
  assert.equal(read.entityCount, null);
  assert.equal(read.entitiesWithOutgoingRelations, null);
  assert.equal(read.topByOutDegreeTruncated, null);

  // A genuinely EMPTY but READABLE graph is the OTHER shape: evaluated:true with {}/[] — if these two
  // ever compare equal, the three-valued reading has collapsed.
  const clean = fs.mkdtempSync(path.join(os.tmpdir(), "qg-graph-clean-"));
  t.after(() => fs.rmSync(clean, { recursive: true, force: true }));
  makeArchQueryFixture(clean, {});
  const cleanRead = readGraphSummaryReading(clean);
  assert.equal(cleanRead.evaluated, true);
  assert.deepEqual(cleanRead.relationCountByType, {});
  assert.deepEqual(cleanRead.topByOutDegree, []);
  assert.notEqual(read.evaluated, cleanRead.evaluated);
  assert.notEqual(read.relationCount, cleanRead.relationCount);
});

test("runArchCycleRound — cycles readable but graph summary unreadable ⇒ not-evaluated:graph-summary (the two readings are independent)", (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "qg-graph-noglobal-"));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  // omitGlobalScope: every per-source scope HAS a moduleGraph (cycles are readable), but the manifest
  // carries no globalScopeKey — the exact fixture that isolates the graph reading's failure.
  makeArchQueryFixture(tmp, { "packages/quay/src": [["src/a", "src/b"]] }, { omitGlobalScope: true });
  const history = path.join(tmp, "history.jsonl");
  const fact = runArchCycleRound(tmp, {
    config: { enabled: true, intervalMinutes: 360 }, configPresent: true, configError: null,
    historyPath: history, now: "T0",
  });
  assert.equal(fact.state, "not-evaluated", "⛔ a half-readable round is NOT a verified report");
  assert.match(fact.reason, /not-evaluated:graph-summary/);
  // The cycle half WAS read (the one fixture cycle) — so the failure is clearly the OTHER half.
  assert.equal(fact.value.evaluated, true);
  assert.equal(fact.value.totalCycleCount, 1);
  assert.equal(fact.value.graphSummary.evaluated, false);
  assert.equal(fact.value.topByOutDegree, null);
  assert.equal(fact.value.relationCountByType, null);
  // The inability is persisted, not silent.
  const rec = JSON.parse(fs.readFileSync(history, "utf8").trim());
  assert.equal(rec.graphSummary.evaluated, false);
  assert.ok(rec.graphSummary.reason && rec.graphSummary.reason.length > 0);
});

test("runArchCycleRound — the graph reading spawns NOTHING (no archguard analyze; AC2)", (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "qg-graph-nospawn-"));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  makeArchQueryFixture(tmp, {}, { global: { entities: GRAPH_ENTITIES, relations: GRAPH_RELATIONS } });

  // A fake archguard that would leave a marker if ANY code path invoked it. Both the CLI-resolution
  // seam and PATH point at it, so an analyze call through either route is observable.
  const marker = path.join(tmp, "spawned.marker");
  const fakeCli = path.join(tmp, "fake-archguard");
  fs.writeFileSync(fakeCli, `#!/bin/sh\necho spawned > ${JSON.stringify(marker)}\nexit 0\n`, { mode: 0o755 });
  const prevCli = process.env.ARCHGUARD_RUNNER_CLI;
  const prevPath = process.env.PATH;
  process.env.ARCHGUARD_RUNNER_CLI = fakeCli;
  process.env.PATH = `${tmp}${path.delimiter}${prevPath ?? ""}`;
  t.after(() => {
    if (prevCli === undefined) delete process.env.ARCHGUARD_RUNNER_CLI;
    else process.env.ARCHGUARD_RUNNER_CLI = prevCli;
    process.env.PATH = prevPath;
  });

  const fact = runArchCycleRound(tmp, {
    config: { enabled: true, intervalMinutes: 360 }, configPresent: true, configError: null,
    historyPath: path.join(tmp, "history.jsonl"), now: "T0",
  });
  assert.equal(fact.state, "verified", fact.reason ?? "");
  assert.equal(fs.existsSync(marker), false, "the routine must stay a pure READ — ⛔ no analyze spawn");
});

test("ARCH_CYCLE_HISTORY_REL — the carrier path is the single declared one (and it is gitignored)", () => {
  assert.equal(ARCH_CYCLE_HISTORY_REL, ".quay/arch-cycle-history.jsonl");
  const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
  const ignored = fs.readFileSync(path.join(REPO_ROOT, ".gitignore"), "utf8");
  assert.match(ignored, /^\*\*\/\.quay\/arch-cycle-history\.jsonl$/m, "a runtime carrier must not be git-tracked");
});

// ── design-evolution-readings 例程（gap-design-evolution-readings-report-only-routine）─────────────
// 这一族要钉的三件事，按「静默退化」的难易排序：
//   ① 段缺席 ⇒ 例程表逐条不变（AC144 的「恰好四条」仍成立）；enabled:false ⇒ 记
//      `not-evaluated:disabled` 且**零写入**（AC1 的一半）；
//   ② 一条读数成立时，载体上真的多一行，且那一行同时含 RM1 / RM2 / 「窗口内最大中心文件变动提交」
//      （AC5 的形状）；读数**读不出来**时，行**照写**（evaluated:false）——否则「没读过」与
//      「读过且干净」在历史上同形（硬规则 3b）；
//   ③ 读数本身（占比高、争用多）⛔ 不是 failed —— report-only，fail只留给真故障（坏配置 / 写不进）。

test("designEvolutionRoutineFromConfig — an UNDECLARED workspace keeps EXACTLY the four built-in routines (AC1)", (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "qg-de-absent-"));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const read = designEvolutionRoutineFromConfig(tmp);
  assert.equal(read.routine, null, "no section ⇒ the routine is not even ADDED to the table");
  assert.equal(read.present, false);
  assert.equal(read.error, null);

  const without = qualityGateRoutines(tmp, coverageBaseOpts()).map((r) => r.name);
  assert.deepEqual(without, ["pool-quality-judge", "judgment-consumer-check", "architecture-review", "packaging-hygiene"]);
  const injected = { name: DESIGN_EVOLUTION_ROUTINE_NAME, schedule: { kind: "interval", minutes: DESIGN_EVOLUTION_INTERVAL_MIN_DEFAULT }, run: () => [] };
  const withIt = qualityGateRoutines(tmp, { ...coverageBaseOpts(), designEvolutionRoutine: injected }).map((r) => r.name);
  assert.deepEqual(withIt, [...without, DESIGN_EVOLUTION_ROUTINE_NAME], "the injection appends; it never displaces a built-in");
});

test("designEvolutionRoutineFromConfig — a DECLARED section is assembled with its declared interval", (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "qg-de-declared-"));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  fs.mkdirSync(path.join(tmp, ".quay"), { recursive: true });
  fs.writeFileSync(path.join(tmp, ".quay", "config.yml"), "loop:\n  design_evolution_readings:\n    enabled: true\n    interval: interval:120m\n", "utf8");
  const read = designEvolutionRoutineFromConfig(tmp);
  assert.equal(read.present, true);
  assert.equal(read.enabled, true);
  assert.equal(read.error, null);
  assert.equal(read.routine.name, DESIGN_EVOLUTION_ROUTINE_NAME);
  assert.deepEqual(read.routine.schedule, { kind: "interval", minutes: 120 });

  // Declaration without an explicit interval ⇒ the documented 360m default, not an unset schedule.
  fs.writeFileSync(path.join(tmp, ".quay", "config.yml"), "loop:\n  design_evolution_readings:\n    enabled: true\n", "utf8");
  assert.deepEqual(designEvolutionRoutineFromConfig(tmp).routine.schedule, { kind: "interval", minutes: 360 });
  assert.equal(DESIGN_EVOLUTION_INTERVAL_MIN_DEFAULT, 360);
});

test("runDesignEvolutionRound — AC1: enabled:false records not-evaluated:disabled and writes NOTHING", (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "qg-de-disabled-"));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const history = path.join(tmp, "history.jsonl");
  const fact = runDesignEvolutionRound(tmp, {
    config: { enabled: false, intervalMinutes: null, subsystems: [], topN: 10 },
    configPresent: true, configError: null, historyPath: history, now: "T0",
  });
  assert.equal(fact.name, DESIGN_EVOLUTION_ROUTINE_NAME);
  assert.equal(fact.state, "not-evaluated");
  assert.match(fact.reason, /not-evaluated:disabled/);
  assert.equal(fact.value, null, "the kill switch must not even produce a reading-shaped value");
  assert.equal(fs.existsSync(history), false, "AC1: disabled ⇒ ZERO writes (not a blank line, not a header)");
});

test("runDesignEvolutionRound — a DECLARED-but-malformed section is `failed` and writes NOTHING (硬规则 3b)", (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "qg-de-badcfg-"));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const history = path.join(tmp, "history.jsonl");
  const fact = runDesignEvolutionRound(tmp, { config: null, configPresent: true, configError: "loop.design_evolution_readings needs a boolean 'enabled'", historyPath: history });
  assert.equal(fact.state, "failed");
  assert.equal(fact.value, null);
  assert.equal(fs.existsSync(history), false);
});

test("runDesignEvolutionRound — AC5: ONE record carries RM1 + RM2 + the largest central change, and appends one line", (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "qg-de-round-"));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const repo = path.join(tmp, "repo");
  fs.mkdirSync(path.join(repo, "mod"), { recursive: true });
  fs.mkdirSync(path.join(repo, ".quay"), { recursive: true });
  const env = { ...process.env, GIT_AUTHOR_NAME: "de fixture", GIT_AUTHOR_EMAIL: "de@example.invalid", GIT_COMMITTER_NAME: "de fixture", GIT_COMMITTER_EMAIL: "de@example.invalid" };
  const go = (...args) => {
    const r = spawnSync("git", ["-C", repo, ...args], { env, encoding: "utf8" });
    assert.equal(r.status, 0, `git ${args.join(" ")} failed: ${r.stderr}`);
  };
  const write = (rel, n) => fs.writeFileSync(path.join(repo, rel), Array.from({ length: n }, (_, i) => `l${i}`).join("\n") + "\n");
  write("mod/central.ts", 100);
  write("mod/other.ts", 100);
  go("init", "-q");
  go("add", "-A");
  go("commit", "-q", "-m", "baseline");
  const baseline = spawnSync("git", ["-C", repo, "rev-parse", "HEAD"], { encoding: "utf8" }).stdout.trim();
  write("mod/central.ts", 110);
  write("mod/other.ts", 190);
  go("add", "-A");
  go("commit", "-q", "-m", "grow");
  // RM2 is zero-config but NOT zero-input: an absent ledger is `evaluated:false` (asserted below by
  // the sibling test). Here the ledger exists, so both readings are taken in ONE round.
  fs.writeFileSync(
    path.join(repo, ".quay", "worker-outcome.jsonl"),
    JSON.stringify({ task: "x", ts: "T-x", selector_reason: "避开 mod/central.ts 的争用" }) + "\n",
  );

  const history = path.join(tmp, "history.jsonl");
  const fact = runDesignEvolutionRound(repo, {
    config: {
      enabled: true, intervalMinutes: 360, topN: 10,
      subsystems: [{ name: "m", baseline, central: [{ atBaseline: "mod/central.ts", atHead: "mod/central.ts" }], modules: ["mod/*.ts"] }],
    },
    configPresent: true, configError: null, historyPath: history, now: "T0",
  });
  assert.equal(fact.state, "verified", fact.reason ?? "");
  assert.equal(fact.value.reportOnly, true);
  assert.equal(fact.value.rm1.subsystems[0].sharePercentRounded, 10); // 10 / (10 + 90)
  assert.equal(fact.value.rm1.subsystems[0].maxCentralChangeCommit.centralDelta, 10);
  assert.equal(fact.value.rm2.evaluated, true);
  // The RM2 key is the REPO-RELATIVE path (gap-design-evolution-readings-path-identity-and-split-move):
  // a basename is display only, so two same-named files in different directories cannot merge.
  assert.equal(fact.value.rm2.files[0].file, "mod/central.ts");
  const lines = fs.readFileSync(history, "utf8").split("\n").filter((l) => l !== "");
  assert.equal(lines.length, 1, "one due round ⇒ exactly one history line");
  const rec = JSON.parse(lines[0]);
  assert.equal(rec.ts, "T0");
  assert.equal(rec.mode, "design-evolution-readings-round");
  assert.equal(rec.reportOnly, true);
  assert.equal(rec.evaluated, true, "both readings were taken ⇒ the record is evaluated:true");
  assert.equal(rec.rm1.subsystems[0].share, 0.1);
  assert.ok(rec.rm1.subsystems[0].maxCentralChangeCommit, "AC5: the largest central-change commit must be on the line");
  assert.equal(rec.rm2.carrierRecords, 1);
});

test("runDesignEvolutionRound — the Fact carries the ADR-008 phase staleness WITHOUT changing its state", (t) => {
  // gap-adr008-phase-declaration-staleness-reading: the reading rides along in the EXISTING Fact.
  // The load-bearing assertion is the negative one — an unreadable/late declaration must not turn the
  // routine red, because the reading is content, not a verdict (Plan §3/§4).
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "qg-de-phase-"));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const repo = path.join(tmp, "repo");
  fs.mkdirSync(path.join(repo, "mod"), { recursive: true });
  fs.mkdirSync(path.join(repo, ".quay"), { recursive: true });
  const env = { ...process.env, GIT_AUTHOR_NAME: "de fixture", GIT_AUTHOR_EMAIL: "de@example.invalid", GIT_COMMITTER_NAME: "de fixture", GIT_COMMITTER_EMAIL: "de@example.invalid" };
  const go = (...args) => {
    const r = spawnSync("git", ["-C", repo, ...args], { env, encoding: "utf8" });
    assert.equal(r.status, 0, `git ${args.join(" ")} failed: ${r.stderr}`);
  };
  const write = (rel, n) => fs.writeFileSync(path.join(repo, rel), Array.from({ length: n }, (_, i) => `l${i}`).join("\n") + "\n");
  write("mod/central.ts", 100);
  go("init", "-q");
  go("add", "-A");
  go("commit", "-q", "-m", "baseline");
  const baseline = spawnSync("git", ["-C", repo, "rev-parse", "HEAD"], { encoding: "utf8" }).stdout.trim();
  write("mod/central.ts", 110);
  go("add", "-A");
  go("commit", "-q", "-m", "grow");
  fs.writeFileSync(path.join(repo, ".quay", "worker-outcome.jsonl"), "");
  fs.writeFileSync(
    path.join(repo, ".quay", "two-phase-state.json"),
    JSON.stringify({
      phase: "convergence",
      declaredAt: "2026-01-01T00:00:00.000Z",
      reason: "fixture",
      history: [{ phase: "convergence", declaredAt: "2026-01-01T00:00:00.000Z", reason: "fixture" }],
    }),
  );
  const opts = {
    config: {
      enabled: true, intervalMinutes: 360, topN: 10,
      subsystems: [{ name: "m", baseline, central: [{ atBaseline: "mod/central.ts", atHead: "mod/central.ts" }], modules: ["mod/*.ts"] }],
    },
    configPresent: true, configError: null, historyPath: path.join(tmp, "history.jsonl"), now: "T0",
  };

  const fact = runDesignEvolutionRound(repo, opts);
  assert.equal(fact.state, "verified", fact.reason ?? "");
  assert.equal(fact.value.phaseStaleness.evaluated, true);
  assert.equal(fact.value.phaseStaleness.phase, "convergence");
  assert.equal(fact.value.phaseStaleness.declarations, 1);
  // ONE reading, ONE shape: the carrier line and the Fact carry the identical embedded object.
  const line = JSON.parse(fs.readFileSync(opts.historyPath, "utf8").split("\n").filter((l) => l !== "")[0]);
  assert.deepEqual(line.phaseStaleness, fact.value.phaseStaleness);

  // Negative control: with NO phase carrier the attached reading is NOT-EVALUATED, and the round is
  // STILL `verified` — the field can never become a hidden gate.
  fs.rmSync(path.join(repo, ".quay", "two-phase-state.json"));
  const fact2 = runDesignEvolutionRound(repo, opts);
  assert.equal(fact2.state, "verified", "a missing phase carrier must not red the design-evolution round");
  assert.equal(fact2.value.phaseStaleness.evaluated, false);
  assert.equal(fact2.value.phaseStaleness.commitsSince, null);
  assert.match(fact2.value.phaseStaleness.reason, /carrier-missing/);
});

test("runDesignEvolutionRound — a reading that CANNOT be taken still appends a line (not-evaluated, not silence)", (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "qg-de-noteval-"));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const repo = path.join(tmp, "repo");
  fs.mkdirSync(path.join(repo, ".quay"), { recursive: true });
  const env = { ...process.env, GIT_AUTHOR_NAME: "de", GIT_AUTHOR_EMAIL: "de@example.invalid", GIT_COMMITTER_NAME: "de", GIT_COMMITTER_EMAIL: "de@example.invalid" };
  for (const args of [["init", "-q"], ["commit", "-q", "--allow-empty", "-m", "empty"]]) {
    const r = spawnSync("git", ["-C", repo, ...args], { env, encoding: "utf8" });
    assert.equal(r.status, 0, r.stderr);
  }
  fs.writeFileSync(path.join(repo, ".quay", "worker-outcome.jsonl"), "");
  const history = path.join(tmp, "history.jsonl");
  const fact = runDesignEvolutionRound(repo, {
    config: {
      enabled: true, intervalMinutes: 360, topN: 10,
      subsystems: [{ name: "bad", baseline: "no-such-ref", central: [{ atBaseline: "a.ts", atHead: "a.ts" }], modules: ["*.ts"] }],
    },
    configPresent: true, configError: null, historyPath: history, now: "T0",
  });
  assert.equal(fact.state, "not-evaluated");
  assert.match(fact.reason, /baseline-unresolvable/);
  const lines = fs.readFileSync(history, "utf8").split("\n").filter((l) => l !== "");
  assert.equal(lines.length, 1, "the inability itself is the record — ⛔ never silence");
  assert.equal(JSON.parse(lines[0]).evaluated, false);
});

test("DESIGN_EVOLUTION_HISTORY_REL — the declared carrier is registered and gitignored (single source)", () => {
  assert.equal(DESIGN_EVOLUTION_HISTORY_REL, ".quay/design-evolution-history.jsonl");
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
  assert.match(fs.readFileSync(path.join(root, ".gitignore"), "utf8"), /^\*\*\/\.quay\/design-evolution-history\.jsonl$/m);
  const registry = JSON.parse(fs.readFileSync(path.join(root, "docs", "carrier-registry.json"), "utf8"));
  const entry = registry.carriers.find((c) => c.name === "design-evolution-history.jsonl");
  assert.ok(entry, "the carrier must be declared in docs/carrier-registry.json");
  assert.equal(entry.owner, "plugin/scripts/design-evolution-readings.ts");
});

test("formatDesignEvolutionAssembly — malformed / disabled / running never look the same in the startup log", () => {
  const running = formatDesignEvolutionAssembly({ present: true, error: null, enabled: true, intervalMinutes: 360 });
  const disabled = formatDesignEvolutionAssembly({ present: true, error: null, enabled: false, intervalMinutes: 360 });
  const broken = formatDesignEvolutionAssembly({ present: true, error: "loop.design_evolution_readings needs a boolean 'enabled'", enabled: false, intervalMinutes: 360 });
  assert.notEqual(running, disabled);
  assert.notEqual(disabled, broken);
  assert.match(running, /report-only/);
  assert.match(disabled, /not-evaluated:disabled/);
  assert.match(broken, /每轮记 failed/);
});

// ── adr-enforcement-report ───────────────────────────────────────────────────────────────────────
// (tasks/gap-adr007-half1-selfcheck-probes-archived-and-gate-never-invoked)
//
// THE DEFECT: a `gates.adr`-declared gate could only be fetched BY NAME; nothing standing invoked it
// ⇒ `.quay/gate-events.jsonl` held 0 `adr-007` events for ~94 days. These tests pin the three things
// that make the new routine a real caller rather than a second implementation:
//   ① it runs the gate through the ENGINE (the event is written by runGate, actor = the routine),
//   ② it keeps only ACCEPTED ADRs carrying an `enforcement:` (otherwise "accepted ADR without a
//      command" would manufacture a permanent red), recording the rest as `skipped`,
//   ③ the selfcheck's exit 2 is recorded as NOT-EVALUATED, never as a pass and never as a plain red.

/** A temp workspace with a `gates.adr` declaration + real ADR files (enough for the REAL kernel:
 *  loader → makeAdrGate → runAcceptance). ⛔ No stub engine here — a stub would only prove the stub. */
function makeAdrEnforcementWorkspace(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "qg-adr-enforce-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, ".quay"), { recursive: true });
  fs.mkdirSync(path.join(root, "adr"), { recursive: true });
  fs.writeFileSync(
    path.join(root, ".quay", "config.yml"),
    ["gates:", "  adr:", '    - "ADR-900"', '    - "ADR-901"', '    - "ADR-902"', '    - "ADR-903"', ""].join("\n"),
    "utf8",
  );
  // 900: accepted + enforcement (the one that must run) — exit 2 = the selfcheck's NOT-EVALUATED.
  writeAdr(root, "ADR-900", { status: "accepted", enforcement: "node -e \"process.exit(2)\"" });
  // 901: accepted, no enforcement → skipped, never run.
  writeAdr(root, "ADR-901", { status: "accepted", enforcement: "" });
  // 902: proposed → skipped (the gate itself would fail closed, but a never-accepted ADR must not
  // produce a red stream; it is not an enforcement).
  writeAdr(root, "ADR-902", { status: "proposed", enforcement: "node -e \"process.exit(0)\"" });
  // 903 is DECLARED in gates.adr but has no file at all → skipped with a reason.
  return root;
}

function writeAdr(root, id, { status, enforcement }) {
  fs.writeFileSync(
    path.join(root, "adr", `${id}.md`),
    [
      "---",
      `id: ${id}`,
      `title: fixture ${id}`,
      `status: ${status}`,
      `enforcement: ${JSON.stringify(enforcement)}`,
      "---",
      `fixture body for ${id}`,
      "",
    ].join("\n"),
    "utf8",
  );
}

test("runAdrEnforcementRound — runs accepted+enforcing ADRs through the ENGINE, skips the rest (AC5 unit)", async (t) => {
  const root = makeAdrEnforcementWorkspace(t);
  const fact = await runAdrEnforcementRound(root);

  assert.equal(fact.name, ADR_ENFORCEMENT_ROUTINE_NAME);
  assert.equal(fact.value.reportOnly, true);
  assert.deepEqual(fact.value.gates.map((g) => g.adr), ["ADR-900"], "only the accepted, enforcing ADR is run");
  assert.deepEqual(fact.value.skipped.map((s) => s.adr).sort(), ["ADR-901", "ADR-902", "ADR-903"]);
  assert.match(fact.value.skipped.find((s) => s.adr === "ADR-902").why, /not accepted/);
  assert.match(fact.value.skipped.find((s) => s.adr === "ADR-901").why, /no `enforcement:`/);
  assert.match(fact.value.skipped.find((s) => s.adr === "ADR-903").why, /no such ADR/);

  const g = fact.value.gates[0];
  assert.equal(g.ok, false);
  assert.equal(g.exitCode, ADR_SELFCHECK_NOT_EVALUATED_EXIT);
  // ③ exit 2 is NOT-EVALUATED for the ROUTINE (the engine's own verdict stays binary: non-pass).
  assert.equal(fact.state, "not-evaluated", fact.reason);
  assert.match(fact.reason, /selfcheck-exit-2/);

  // ① the event is the ENGINE's: one line, gate adr-900, actor = the routine name.
  const events = fs.readFileSync(path.join(root, ".quay", "gate-events.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
  assert.equal(events.length, 1);
  assert.equal(events[0].gate, "adr-900");
  assert.equal(events[0].actor, ADR_ENFORCEMENT_ROUTINE_NAME);
  assert.equal(events[0].verdict, "fail", "engine records non-pass; the three-valued reading lives on the Fact");
  assert.match(String(events[0].payload.reason), /exit 2/);
});

test("runAdrEnforcementRound — a passing gate is `verified`; a plain red is `failed` (three values, not two)", async (t) => {
  const passRoot = fs.mkdtempSync(path.join(os.tmpdir(), "qg-adr-pass-"));
  t.after(() => fs.rmSync(passRoot, { recursive: true, force: true }));
  fs.mkdirSync(path.join(passRoot, ".quay"), { recursive: true });
  fs.mkdirSync(path.join(passRoot, "adr"), { recursive: true });
  fs.writeFileSync(path.join(passRoot, ".quay", "config.yml"), 'gates:\n  adr:\n    - "ADR-800"\n', "utf8");
  writeAdr(passRoot, "ADR-800", { status: "accepted", enforcement: "node -e \"process.exit(0)\"" });
  const pass = await runAdrEnforcementRound(passRoot);
  assert.equal(pass.state, "verified", pass.reason);
  assert.equal(pass.value.gates[0].ok, true);

  fs.writeFileSync(path.join(passRoot, ".quay", "config.yml"), 'gates:\n  adr:\n    - "ADR-801"\n', "utf8");
  writeAdr(passRoot, "ADR-801", { status: "accepted", enforcement: "node -e \"process.exit(1)\"" });
  const red = await runAdrEnforcementRound(passRoot);
  assert.equal(red.state, "failed", red.reason);
  assert.equal(red.value.gates[0].exitCode, 1);
});

test("runAdrEnforcementRound — enabled:false is an observable kill switch: zero gate calls, zero writes", async (t) => {
  const root = makeAdrEnforcementWorkspace(t);
  const fact = await runAdrEnforcementRound(root, { config: { enabled: false, intervalMinutes: null }, configPresent: true });
  assert.equal(fact.state, "not-evaluated");
  assert.match(fact.reason, /not-evaluated:disabled/);
  assert.equal(fact.value, null);
  assert.equal(fs.existsSync(path.join(root, ".quay", "gate-events.jsonl")), false, "a kill switch must write NOTHING");
});

test("runAdrEnforcementRound — no accepted+enforcing ADR is NOT-EVALUATED, never a silent green", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "qg-adr-none-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, ".quay"), { recursive: true });
  fs.mkdirSync(path.join(root, "adr"), { recursive: true });
  const fact = await runAdrEnforcementRound(root);
  assert.equal(fact.state, "not-evaluated");
  assert.match(fact.reason, /no-enforcing-adr/);
  assert.deepEqual(fact.value.gates, []);
});

test("adrEnforcementExitCode reads the acceptance runner's own prefix; no reading is null, never 0", () => {
  assert.equal(adrEnforcementExitCode("acceptance failed (exit 2) — boom"), 2);
  assert.equal(adrEnforcementExitCode("acceptance failed (exit 1, signal SIGKILL) — x"), 1);
  assert.equal(adrEnforcementExitCode("acceptance passed (exit 0)"), null);
  assert.equal(adrEnforcementExitCode("no such gate"), null);
});

test("adr-enforcement config — DEFAULT-ON when absent, tunable when declared, below-floor refused", (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "qg-adr-cfg-"));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  // Absent ⇒ assembled with the default cadence (unlike its arch_cycle_report siblings).
  assert.deepEqual(readAdrEnforcementConfig(tmp), { present: false, config: null, error: null });
  const absent = adrEnforcementRoutineFromConfig(tmp);
  assert.equal(absent.routine.name, ADR_ENFORCEMENT_ROUTINE_NAME);
  assert.deepEqual(absent.routine.schedule, { kind: "interval", minutes: ADR_ENFORCEMENT_INTERVAL_MIN_DEFAULT });
  assert.equal(absent.enabled, true);

  fs.mkdirSync(path.join(tmp, ".quay"), { recursive: true });
  fs.writeFileSync(path.join(tmp, ".quay", "config.yml"), "loop:\n  adr_enforcement_report:\n    enabled: true\n    interval: interval:120m\n", "utf8");
  assert.deepEqual(adrEnforcementRoutineFromConfig(tmp).routine.schedule, { kind: "interval", minutes: 120 });

  fs.writeFileSync(path.join(tmp, ".quay", "config.yml"), "loop:\n  adr_enforcement_report:\n    enabled: false\n", "utf8");
  const off = adrEnforcementRoutineFromConfig(tmp);
  assert.equal(off.enabled, false);
  assert.equal(off.routine.name, ADR_ENFORCEMENT_ROUTINE_NAME, "a kill switch is still ASSEMBLED — 'not running' must be observable");

  assert.notEqual(parseAdrEnforcementSection({ interval: "interval:120m" }).error, null, "enabled is required");
  assert.match(
    parseAdrEnforcementSection({ enabled: true, interval: `interval:${ADR_ENFORCEMENT_MIN_INTERVAL_MINUTES - 1}m` }).error,
    new RegExp(`${ADR_ENFORCEMENT_MIN_INTERVAL_MINUTES}m floor`),
  );
  assert.equal(formatAdrEnforcementAssembly({ present: false, error: null, enabled: true, intervalMinutes: 1440 }).includes("未声明"), true);
  assert.equal(formatAdrEnforcementAssembly({ present: true, error: null, enabled: false, intervalMinutes: 1440 }).includes("enabled:false"), true);
});

test("qualityGateRoutines injects adr-enforcement-report WITHOUT displacing a built-in", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "qg-adr-routines-"));
  fs.rmSync(tmp, { recursive: true, force: true });
  const base = qualityGateRoutines(tmp, coverageBaseOpts()).map((r) => r.name);
  const injected = { name: ADR_ENFORCEMENT_ROUTINE_NAME, schedule: { kind: "interval", minutes: 1440 }, run: () => [] };
  const withIt = qualityGateRoutines(tmp, { ...coverageBaseOpts(), adrEnforcementRoutine: injected }).map((r) => r.name);
  assert.deepEqual(withIt, [...base, ADR_ENFORCEMENT_ROUTINE_NAME]);
});

// ════════════════════════════════════════════════════════════════════════════════════════════════════
// gap-instrument-decay-check-unwired-and-blind-to-content-dark
// 例程接线：config 段（loop.instrument_decay:）、读数 Fact 的独立状态 `instrument-dark`、
// 以及「下一轮不重复立案」（上一轮 Fact 里的已立案 pair 是本轮的唯一去重输入）。
// ════════════════════════════════════════════════════════════════════════════════════════════════════

function writeJsonl(dir, rel, rows) {
  const p = path.join(dir, ".quay", rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, rows.map((r) => JSON.stringify(r)).join("\n") + "\n", "utf8");
  return p;
}

function instDecayOpts(extra = {}) {
  return {
    config: { enabled: true, intervalMinutes: INSTRUMENT_DECAY_INTERVAL_MIN_DEFAULT },
    configPresent: true,
    configError: null,
    ...extra,
  };
}

/** A stand-in gap-filing agent: appends every invocation's argv to a marker file and prints a summary. */
function makeGapWorker(dir) {
  const marker = path.join(dir, "gap-worker-calls.jsonl");
  const script = path.join(dir, "gap-worker.mjs");
  fs.writeFileSync(script,
    `import fs from "node:fs";\n` +
    `fs.appendFileSync(${JSON.stringify(marker)}, JSON.stringify(process.argv.slice(2)) + "\\n");\n` +
    `console.log("filed gap: fixture (one task per carrier+shape)");\n`,
    "utf8");
  return { cmd: `node ${script}`, marker, calls: () => (fs.existsSync(marker) ? fs.readFileSync(marker, "utf8").split("\n").filter(Boolean) : []) };
}

test("instrument_decay config — absent / malformed / below-floor / disabled are four distinct readings", (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "qg-decay-cfg-"));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  assert.deepEqual(readInstrumentDecayConfig(tmp), { present: false, config: null, error: null });

  assert.notEqual(parseInstrumentDecaySection(null).error, null);
  assert.match(parseInstrumentDecaySection({ interval: "interval:360m" }).error, /boolean 'enabled'/);
  assert.equal(parseInstrumentDecaySection({ enabled: true }).config.intervalMinutes, INSTRUMENT_DECAY_INTERVAL_MIN_DEFAULT);
  const below = parseInstrumentDecaySection({ enabled: true, interval: `interval:${INSTRUMENT_DECAY_MIN_INTERVAL_MINUTES - 1}m` });
  assert.equal(below.config, null);
  assert.match(below.error, new RegExp(`${INSTRUMENT_DECAY_MIN_INTERVAL_MINUTES}m floor`));
  assert.deepEqual(parseInstrumentDecaySection({ enabled: false }), { config: { enabled: false, intervalMinutes: null }, error: null });

  fs.mkdirSync(path.join(tmp, ".quay"), { recursive: true });
  fs.writeFileSync(path.join(tmp, ".quay", "config.yml"), "loop:\n  instrument_decay:\n    enabled: true\n    interval: interval:120m\n", "utf8");
  const read = readInstrumentDecayConfig(tmp);
  assert.equal(read.present, true);
  assert.equal(read.config.enabled, true);
  assert.equal(read.error, null);
  assert.equal(read.config.intervalMinutes, 120);
});

test("instrumentDecayRoutineFromConfig — UNDECLARED keeps EXACTLY the four built-ins; DECLARED appends (AC144)", (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "qg-decay-assemble-"));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const absent = instrumentDecayRoutineFromConfig(tmp);
  assert.equal(absent.routine, null, "no section ⇒ the routine is not even ADDED to the table");
  assert.equal(absent.present, false);

  const without = qualityGateRoutines(tmp, coverageBaseOpts()).map((r) => r.name);
  assert.deepEqual(without, ["pool-quality-judge", "judgment-consumer-check", "architecture-review", "packaging-hygiene"]);
  const injected = { name: INSTRUMENT_DECAY_ROUTINE_NAME, schedule: { kind: "interval", minutes: 360 }, run: () => [] };
  const withIt = qualityGateRoutines(tmp, { ...coverageBaseOpts(), instrumentDecayRoutine: injected }).map((r) => r.name);
  assert.deepEqual(withIt, [...without, INSTRUMENT_DECAY_ROUTINE_NAME], "the injection appends; it never displaces a built-in");

  fs.mkdirSync(path.join(tmp, ".quay"), { recursive: true });
  fs.writeFileSync(path.join(tmp, ".quay", "config.yml"), "loop:\n  instrument_decay:\n    enabled: true\n    interval: interval:120m\n", "utf8");
  const declared = instrumentDecayRoutineFromConfig(tmp);
  assert.equal(declared.present, true);
  assert.equal(declared.routine.name, INSTRUMENT_DECAY_ROUTINE_NAME);
  assert.deepEqual(declared.routine.schedule, { kind: "interval", minutes: 120 });
  assert.equal(typeof declared.routine.run, "function");
});

test("runInstrumentDecayRound — content-dark ⇒ state `instrument-dark` (⛔ not verified / not-evaluated) + one filing per (carrier,shape)", async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "qg-decay-dark-"));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  writeJsonl(tmp, "arch-cycle-history.jsonl", [
    { ts: "2026-10-18T10:25:51.593Z", mode: "arch-cycle-report-round", evaluated: false, scopes: [] },
    { ts: "2026-10-21T23:14:05.363Z", mode: "arch-cycle-report-round", evaluated: false, scopes: [] },
  ]);
  const worker = makeGapWorker(tmp);
  const fact = await runInstrumentDecayRound(tmp, instDecayOpts({
    gapWorkerCmd: worker.cmd,
    priorFilings: [],
    roundLogPath: path.join(tmp, "quality-round.jsonl"),
  }));

  assert.equal(fact.name, INSTRUMENT_DECAY_ROUTINE_NAME);
  assert.equal(fact.state, "instrument-dark", `a dark reading must be its OWN state: ${fact.reason}`);
  assert.notEqual(fact.state, "verified");
  assert.notEqual(fact.state, "not-evaluated");
  assert.match(fact.reason, /instrument-dark/);
  assert.match(fact.reason, /arch-cycle-history\.jsonl: content-dark/, "the reason names carrier + shape");
  assert.equal(fact.value.decayedCount, 1);
  assert.equal(fact.value.carriers.find((c) => c.file === "arch-cycle-history.jsonl").contentDark.state, "dark");
  assert.equal(fact.value.filings.length, 1);
  assert.equal(fact.value.filings[0].key, "arch-cycle-history.jsonl|content-dark");
  assert.equal(fact.value.filings[0].filing, "filed");
  assert.equal(fact.value.filings[0].exitCode, 0);
  assert.equal(worker.calls().length, 1, "exactly one gap-filing spawn");
  // The prompt carries the mechanism-based dedup rules (open claim vs done claim).
  const prompt = JSON.parse(worker.calls()[0]).at(-1);
  assert.match(prompt, /carrier=arch-cycle-history\.jsonl shape=content-dark/);
  assert.match(prompt, /OPEN claim/);
  assert.match(prompt, /DONE\/superseded claim/);
});

test("runInstrumentDecayRound — 紧接的第二轮不重复立案（上一轮 Fact 是唯一去重输入）", async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "qg-decay-second-"));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  writeJsonl(tmp, "arch-cycle-history.jsonl", [
    { ts: "2026-10-18T10:25:51.593Z", mode: "arch-cycle-report-round", evaluated: false, scopes: [] },
    { ts: "2026-10-21T23:14:05.363Z", mode: "arch-cycle-report-round", evaluated: false, scopes: [] },
  ]);
  const worker = makeGapWorker(tmp);
  const roundLog = path.join(tmp, "quality-round.jsonl");

  // Round 1: files.
  const first = await runInstrumentDecayRound(tmp, instDecayOpts({ gapWorkerCmd: worker.cmd, priorFilings: [], roundLogPath: roundLog }));
  assert.equal(first.value.filings[0].filing, "filed");
  assert.equal(worker.calls().length, 1);

  // The driver writes EVERY round's facts to the round carrier — reproduce that write here so round 2
  // reads the PREVIOUS round's Fact from the real carrier path (⛔ no second ledger).
  fs.writeFileSync(roundLog, JSON.stringify({ round: 1, run_id: "qg-fixture", ts: new Date().toISOString(), facts: [first] }) + "\n", "utf8");

  // Round 2: same findings ⇒ already-filed, ZERO new spawns.
  const second = await runInstrumentDecayRound(tmp, instDecayOpts({ gapWorkerCmd: worker.cmd, roundLogPath: roundLog }));
  assert.equal(second.state, "instrument-dark", "the reading is still dark — only the filing is deduped");
  assert.equal(second.value.filings[0].filing, "already-filed");
  assert.equal(second.value.filings[0].exitCode, null);
  assert.equal(worker.calls().length, 1, "the immediately following round must NOT refile");
  assert.match(second.reason, /already-filed=1/);
});

test("readPriorInstrumentDecayFilings — reads the round carrier tail; absent carrier ⇒ no prior filings", (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "qg-decay-prior-"));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  assert.deepEqual([...readPriorInstrumentDecayFilings(tmp)], [], "no round log ⇒ nothing was filed yet");
  const log = path.join(tmp, "round.jsonl");
  fs.writeFileSync(log, [
    JSON.stringify({ round: 1, facts: [{ name: "pool-quality-judge", value: {} }] }),
    JSON.stringify({ round: 2, facts: [{ name: INSTRUMENT_DECAY_ROUTINE_NAME, value: { filings: [
      { key: "a.jsonl|content-dark", filing: "filed" },
      { key: "b.jsonl|stale-evaluated", filing: "deferred" },
    ] } }] }),
  ].join("\n") + "\n", "utf8");
  const keys = readPriorInstrumentDecayFilings(tmp, log);
  assert.ok(keys.has("a.jsonl|content-dark"));
  assert.equal(keys.has("b.jsonl|stale-evaluated"), false, "a deferred pair is NOT filed — it retries");
});

test("runInstrumentDecayRound — enabled:false ⇒ not-evaluated:disabled, zero reads zero spawns", async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "qg-decay-off-"));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  writeJsonl(tmp, "arch-cycle-history.jsonl", [
    { ts: "2026-10-20T00:00:00Z", evaluated: false }, { ts: "2026-10-21T00:00:00Z", evaluated: false },
  ]);
  const worker = makeGapWorker(tmp);
  const fact = await runInstrumentDecayRound(tmp, {
    config: { enabled: false, intervalMinutes: null }, configPresent: true, configError: null,
    gapWorkerCmd: worker.cmd, priorFilings: [],
  });
  assert.equal(fact.state, "not-evaluated");
  assert.match(fact.reason, /disabled/);
  assert.equal(fact.value, null, "the kill switch writes NOTHING (not even a reading)");
  assert.equal(worker.calls().length, 0);
});

test("runInstrumentDecayRound — no registered carrier present ⇒ not-evaluated (⛔ not `verified`)", async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "qg-decay-nocarrier-"));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const fact = await runInstrumentDecayRound(tmp, instDecayOpts({ priorFilings: [] }));
  assert.equal(fact.state, "not-evaluated");
  assert.match(fact.reason, /no-carrier/);
});

test("runInstrumentDecayRound — clean carrier ⇒ verified, but uncovered carriers are NOT silently healthy", async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "qg-decay-clean-"));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  writeJsonl(tmp, "arch-coverage-history.jsonl", [
    { ts: "2026-10-20T07:02:50.500Z", runner: "arch-coverage-report.ts", evaluated: true, languages: [] },
    { ts: "2026-10-21T07:02:50.500Z", runner: "arch-coverage-report.ts", evaluated: true, languages: [] },
  ]);
  const fact = await runInstrumentDecayRound(tmp, instDecayOpts({ priorFilings: [] }));
  assert.equal(fact.state, "verified");
  assert.equal(fact.value.decayedCount, 0);
  assert.equal(fact.value.healthyCount, 1);
  // measure-history is declared-uncovered: it must appear, and the reason must say it is not healthy.
  assert.ok(fact.value.uncovered.some((u) => u.file === "measure-history.jsonl"));
  assert.match(fact.reason ?? "", /uncovered carrier\(s\) NOT counted healthy/);
});

test("runInstrumentDecayRound — halted ⇒ reading still runs, gap-filing is deferred (observation is not gated)", async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "qg-decay-halted-"));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  writeJsonl(tmp, "arch-cycle-history.jsonl", [
    { ts: "2026-10-20T00:00:00Z", evaluated: false }, { ts: "2026-10-21T00:00:00Z", evaluated: false },
  ]);
  const worker = makeGapWorker(tmp);
  const fact = await runInstrumentDecayRound(tmp, instDecayOpts({ gapWorkerCmd: worker.cmd, priorFilings: [], halted: true }));
  assert.equal(fact.state, "instrument-dark", "halt gates spawn, not readings");
  assert.equal(fact.value.filings[0].filing, "deferred");
  assert.equal(fact.value.filings[0].error, "halted");
  assert.equal(worker.calls().length, 0);
});

test("buildInstrumentDecayGapWorkerPrompt — names EVERY carrier+shape and carries the open/done dedup rules", () => {
  const prompt = buildInstrumentDecayGapWorkerPrompt("/repo", [
    { file: "fan-in-step-trace.jsonl", kind: "rate-stopped", findings: [
      { group: "catch-up-develop", kind: "rate-stopped", count: 96, lastWriteMs: 1, detail: null },
    ] },
    { file: "arch-cycle-history.jsonl", kind: "stale-evaluated", findings: [
      { group: "src", kind: "stale-evaluated", count: 1, lastWriteMs: 2, detail: "artifact < commit" },
    ] },
  ]);
  assert.match(prompt, /carrier=fan-in-step-trace\.jsonl shape=rate-stopped/);
  assert.match(prompt, /carrier=arch-cycle-history\.jsonl shape=stale-evaluated/);
  assert.match(prompt, /catch-up-develop/);
  assert.match(prompt, /artifact < commit/);
  assert.match(prompt, /OPEN claim/);
  assert.match(prompt, /done ≠ absent/);
});

test("formatInstrumentDecayAssembly — malformed / disabled / running never look the same", () => {
  const running = formatInstrumentDecayAssembly({ present: true, error: null, enabled: true, intervalMinutes: 360 });
  const disabled = formatInstrumentDecayAssembly({ present: true, error: null, enabled: false, intervalMinutes: 360 });
  const broken = formatInstrumentDecayAssembly({ present: true, error: "loop.instrument_decay needs a boolean 'enabled'", enabled: false, intervalMinutes: 360 });
  assert.notEqual(running, disabled);
  assert.notEqual(disabled, broken);
  assert.match(running, /instrument-dark/);
  assert.match(disabled, /not-evaluated:disabled/);
  assert.match(broken, /每轮记 failed/);
});
