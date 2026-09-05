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
  qualityGateRoutines,
  computeRoundRecord,
} from "../scripts/quality-gate-driver.ts";
import { qualityRoundPath } from "../scripts/pool-quality-judge.ts";
import { archReviewRoundPath } from "../scripts/architecture-review-cluster.ts";

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
      ? `process.stdout.write(JSON.stringify({table:[{entity:"session-liveness.sh",code:5,hardcoded:4,codeFiles:["plugin/scripts/a.ts","packages/quay/src/observation.ts"]}],judgmentRewrites:[{file:"plugin/scripts/worker-driver.ts"}],pathConstants:[],byteIdentical:{count:0,pairs:[]}}));`
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

function fakeArchJudgeScript(tmp) {
  return writeFixture(
    tmp,
    "fake-arch-judge.js",
    `process.stdout.write(JSON.stringify([{clusterId:"P2-identity-session-liveness.sh",verdict:"abstract",reasoning:"dup naming",suggestedAction:"consolidate"},{clusterId:"P1-deletion-closure",verdict:"coincidental",reasoning:"narrative refs",suggestedAction:"keep"},{clusterId:"P2-judgment-rewrites",verdict:"abstract",reasoning:"same fingerprint 2x",suggestedAction:"merge"},{clusterId:"P4-suspicious-guards",verdict:"uncertain",reasoning:"preventive?",suggestedAction:"human"}]));`,
  );
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

test("AC3 — runJudgmentConsumerCheck three-state vocab (verified / failed / not-evaluated)", (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "qg-b17-"));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const clean = runJudgmentConsumerCheck("/repo", ["node", fakeJudgmentScript(tmp, false)]);
  assert.equal(clean.name, "judgment-consumer-check");
  assert.equal(clean.state, "verified", "no drift ⇒ verified");
  assert.equal(clean.value.drift, false);
  const drift = runJudgmentConsumerCheck("/repo", ["node", fakeJudgmentScript(tmp, true)]);
  assert.equal(drift.state, "failed", "drift ⇒ failed (⛔ not verified)");
  assert.equal(drift.value.drift, true);
  const unreadable = runJudgmentConsumerCheck("/repo", ["node", path.join(tmp, "does-not-exist.js")]);
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

test("AC1 — qualityGateRoutines returns EXACTLY the three driverized routines (B15 + B17 + 架构复核)", () => {
  const routines = qualityGateRoutines("/repo", {
    planCmd: null, judgeArgv: null, judgmentCmd: null, resourceGateArgv: null,
    identityCmd: null, lineageCmd: null, deletionCmd: null, archJudgeArgv: null,
    poolJudgeIntervalMinutes: 10, judgmentIntervalMinutes: 30, archReviewIntervalMinutes: 60,
  });
  assert.deepEqual(routines.map((r) => r.name), ["pool-quality-judge", "judgment-consumer-check", "architecture-review"]);
  assert.equal(routines.length, 3, "⛔ 不是 god-object——只此三条，B16-C/B18 归 AC145");
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
  const planCmd = path.join(tmp, "fake-plan.js");
  const judgmentCmd = path.join(tmp, "fake-judgment.js");
  const identityCmd = fakeIdentityScript(tmp, false);
  const lineageCmd = fakeLineageScript(tmp, false);
  fs.writeFileSync(planCmd, `process.stdout.write(JSON.stringify({triggers:{fired:false,reasons:[],poolCount:0,oldestUnreviewedAgeMs:0,roundsSinceLastJudge:0},pool:[],tasks:[],lastJudgeState:{status:"ok"}}));`, "utf8");
  fs.writeFileSync(judgmentCmd, `process.stdout.write(JSON.stringify({mode:"judgment-consumer-audit",judgments_total:1,wired:1,unfinished:[],drift:false}));`, "utf8");
  const roundLog = path.join(tmp, "quality-round.jsonl");
  const r = spawnSync(
    process.execPath,
    ["--experimental-strip-types", path.join(REPO_ROOT, "plugin", "scripts", "quality-gate-driver.ts"),
     "--root", REPO_ROOT, "--once", "--round-log", roundLog,
     "--plan-cmd", `node ${planCmd}`, "--judgment-cmd", `node ${judgmentCmd}`,
     "--identity-cmd", `node ${identityCmd}`, "--lineage-cmd", `node ${lineageCmd}`],
    { encoding: "utf8", timeout: 120_000 },
  );
  assert.equal(r.status, 0, `driver --once should exit 0 (stderr: ${r.stderr})`);
  const lines = fs.readFileSync(roundLog, "utf8").split("\n").filter((l) => l.trim());
  assert.equal(lines.length, 1, "one round ⇒ one heartbeat line");
  const rec = JSON.parse(lines[0]);
  assert.equal(rec.halted, false);
  assert.equal(rec.facts.length, 3, "first round ⇒ all three routines due (never-ran ⇒ interval due)");
  const names = rec.facts.map((f) => f.name).sort();
  assert.deepEqual(names, ["architecture-review", "judgment-consumer-check", "pool-quality-judge"]);
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
  };
}

test("AC2/AC3 — runArchitectureReview fired ⇒ LLM judge ⇒ judged record + distribution", async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "qg-arch-"));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const { identityCmd, lineageCmd, deletionCmd, judgeArgv, gateArgv } = archReviewCmd(tmp);
  const fact = await runArchitectureReview(tmp, identityCmd, lineageCmd, deletionCmd, judgeArgv, gateArgv);
  assert.equal(fact.name, "architecture-review");
  assert.equal(fact.state, "verified");
  assert.equal(fact.value.fired, true);
  assert.equal(fact.value.judgedCount, 4);
  assert.deepEqual(fact.value.distribution, { abstract: 2, coincidental: 1, uncertain: 1 });

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
  const { identityCmd, lineageCmd, deletionCmd, judgeArgv, gateArgv } = archReviewCmd(tmp);
  const carrier = archReviewRoundPath(tmp);
  const count = () => (fs.existsSync(carrier) ? fs.readFileSync(carrier, "utf8").split("\n").filter((l) => l.trim()).length : 0);
  const on = await runArchitectureReview(tmp, identityCmd, lineageCmd, deletionCmd, judgeArgv, gateArgv, true);
  assert.equal(on.state, "verified");
  assert.equal(count(), 1, "write on ⇒ carrier grows to 1");
  const off = await runArchitectureReview(tmp, identityCmd, lineageCmd, deletionCmd, judgeArgv, gateArgv, false);
  assert.equal(off.state, "verified");
  assert.equal(count(), 1, "write off ⇒ carrier does NOT grow");
  const on2 = await runArchitectureReview(tmp, identityCmd, lineageCmd, deletionCmd, judgeArgv, gateArgv, true);
  assert.equal(on2.state, "verified");
  assert.equal(count(), 2, "write restored ⇒ carrier grows to 2");
});
