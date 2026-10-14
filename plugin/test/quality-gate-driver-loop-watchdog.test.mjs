// @test-group engine
// quality-gate-driver-loop-watchdog.test.mjs — gap-meta-quality-gate-driver:
// quality-gate-driver 常驻循环 spawns LLM judge via runAsync(timeoutMs=Infinity) 且无 caller 侧看门狗，
// 挂死的 claude 子进程会冻结常驻循环（.quay/quality-round.jsonl 冻结、进程仍活 ⇒ supervisor 永不重生）。
// 修法：runResidentQualityGateLoop 每条例程一个 caller 侧看门狗（runRoutineWithWatchdog，Promise.race）——
// 例程 wall-clock 超界 ⇒ 记 failed Fact（routine timed out）并继续写心跳，⛔ 不 await 已挂的 routine promise。
//
// AC（判据，本文件实跑通过）: never-resolving routine 不再冻结循环心跳（per-routine watchdog bounds
// each routine）。
//   ① 直接 import：注入 run: () => new Promise(() => {}) 的例程 + 小看门狗 ⇒ 循环仍写心跳、
//      fact.state=failed、reason 含 timed out。
//   ② 负控制（DoD 能取假）：看门狗传 Infinity（= 坏实现）⇒ 同一 never-resolving routine 冻结循环 ⇒
//      有限时间内不写心跳、不退出——证本判据测的是看门狗，不是回声。

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  runResidentQualityGateLoop,
  runJudgmentConsumerCheck,
  ROUTINE_WATCHDOG_MS_DEFAULT,
  QUALITY_CONTROL_STATE_REL,
} from "../scripts/quality-gate-driver.ts";

// 一个永不 settle 的例程——模拟挂死的 judge spawn（runAsync(Infinity) 的 promise 永不 settle）。
const neverResolvingRoutine = {
  name: "never-resolving",
  schedule: { kind: "interval", minutes: 0 }, // minutes:0 ⇒ isDue 恒 true（round 1 必跑）
  run: () => new Promise(() => {}),
};

test("AC — never-resolving routine 不再冻结循环心跳（per-routine watchdog bounds each routine）", async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "qg-watchdog-"));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const roundLog = path.join(tmp, "quality-round.jsonl");
  const watchdogMs = 100; // 小看门狗：测试不必等生产缺省 30min

  const code = await runResidentQualityGateLoop({
    root: tmp, intervalMs: 1, once: true, maxRounds: null, roundLogFile: roundLog,
    runId: "watchdog", json: false, routines: [neverResolvingRoutine],
    controlStateRel: QUALITY_CONTROL_STATE_REL, routineWatchdogMs: watchdogMs,
  });

  assert.equal(code, 0, "看门狗兜底后循环应退出 0（⛔ 冻结 ⇒ 永不返回）");
  const lines = fs.readFileSync(roundLog, "utf8").split("\n").filter((l) => l.trim());
  assert.equal(lines.length, 1, "once ⇒ 一条心跳（⛔ 冻结 ⇒ 0 条 ⇒ liveness 假死）");
  const rec = JSON.parse(lines[0]);
  assert.equal(rec.round, 1, "心跳 round=1");
  const fact = rec.facts.find((f) => f.name === "never-resolving");
  assert.ok(fact, "心跳含该例程的 fact（⛔ 缺 ⇒ 例程被静默丢弃）");
  assert.equal(fact.state, "failed", "超界 ⇒ failed（⛔ 与 verified/not-evaluated 同形，硬规则 3b）");
  assert.match(fact.reason, /timed out/i, "reason 载明 timeout（可区分，⛔ 静默）");
});

test("负控制 — 看门狗关闭（Infinity）⇒ 同一 never-resolving routine 冻结心跳（判据能取假）", async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "qg-watchdog-neg-"));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const roundLog = path.join(tmp, "quality-round.jsonl");

  const loopP = runResidentQualityGateLoop({
    root: tmp, intervalMs: 1, once: true, maxRounds: null, roundLogFile: roundLog,
    runId: "watchdog-neg", json: false, routines: [neverResolvingRoutine],
    controlStateRel: QUALITY_CONTROL_STATE_REL, routineWatchdogMs: Infinity, // ⛔ 显式关闭看门狗 = 坏实现
  });

  // 与一个有限定时器 race：无看门狗 ⇒ 循环冻结在 await ⇒ 有限时间内既不写心跳也不退出。
  const winner = await Promise.race([
    loopP.then(() => "loop-exited"),
    new Promise((resolve) => setTimeout(() => resolve("timeout"), 300)),
  ]);

  assert.equal(winner, "timeout", "无看门狗 ⇒ 循环冻结（300ms 内未退出）——证判据测的是看门狗");
  assert.ok(!fs.existsSync(roundLog), "无看门狗 ⇒ 心跳未写（⛔ 写了 = 判据恒真，与合格同形）");
});

// ── 回归：e18ec4b04 的挂死 ────────────────────────────────────────────────────────────────────────
// 上面那条负控制**故意**让 race 永不 settle（例程永不 settle + 看门狗 Infinity）⇒ 挂在事件循环上的
// 停机探针定时器永远轮不到 `finally` 里的 `clearTimeout`。若探针没 `unref()`，它就成了进程的**存活
// 锚点**：断言全绿、测试体跑完，而 node 进程**永不退出** ⇒ `node --test` 永不结束这个文件 ⇒ 全量套件
// 静默停摆（实测：4/4 全量套件命中，挂起的子进程 0% CPU）。修复前本用例的形态正是这个。
//
// ⛔ 判据必须读**外部观测**（子进程是否退出），不能读进程内自报的状态——「这个进程为什么还活着」由
// 事件循环回答，不由被测对象自己回答（硬规则 4b：观测器不得自证被测对象仍活着）。所以本用例把负控制
// 的形状放进一个**真的子进程**，并要求它在测试体跑完之后**自己退出**。
test("回归 — 停机探针不得成为进程存活锚点（e18ec4b04：断言全绿而 node 永不退出）", async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "qg-watchdog-exit-"));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const probe = path.join(tmp, "exit-probe.mjs");
  const driverUrl = pathToFileURL(
    path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "scripts", "quality-gate-driver.ts"),
  ).href;
  // 子进程逐字复现负控制的形状：例程永不 settle + 看门狗 Infinity ⇒ race 永不 settle。
  fs.writeFileSync(probe, `
import { runResidentQualityGateLoop, QUALITY_CONTROL_STATE_REL } from ${JSON.stringify(driverUrl)};
const tmp = process.argv[2];
const loopP = runResidentQualityGateLoop({
  root: tmp, intervalMs: 1, once: true, maxRounds: null,
  roundLogFile: tmp + "/quality-round.jsonl", runId: "exit-probe", json: false,
  routines: [{ name: "never-resolving", schedule: { kind: "interval", minutes: 0 }, run: () => new Promise(() => {}) }],
  controlStateRel: QUALITY_CONTROL_STATE_REL, routineWatchdogMs: Infinity,
});
await Promise.race([loopP.then(() => "loop-exited"), new Promise((r) => setTimeout(() => r("timeout"), 300))]);
process.stdout.write("probe-body-done\\n");
// ⛔ 到这里子进程手上不该再有任何 handle——事件循环净空时它必须自己退出。
`, "utf8");

  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT; // ⛔ 子进程否则会讲父 runner 的协议，静默什么都不跑（空转判据）
  const child = spawn(process.execPath, ["--experimental-strip-types", probe, tmp], {
    stdio: ["ignore", "pipe", "pipe"], env,
  });
  let out = "";
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (d) => { out += d; });
  const exited = await new Promise((resolve) => {
    const kill = setTimeout(() => {
      child.kill("SIGKILL"); // ⛔ 不留给套件一个仍在跑的子进程（本文件正是「不回收 = 套件停摆」的受害者）
      resolve(false);
    }, 15_000);
    child.on("exit", () => { clearTimeout(kill); resolve(true); });
  });

  assert.match(out, /probe-body-done/, "子进程必须真的跑到测试体结束（⛔ 没跑成 = 判据空转）");
  assert.ok(
    exited,
    "测试体跑完后 node 必须自己退出——⛔ 不退 = 停机探针 ref 住了事件循环（e18ec4b04 的挂死）",
  );
});

test("ROUTINE_WATCHDOG_MS_DEFAULT — 生产缺省是有限正数（liveness 安全界，非 Infinity）", () => {
  assert.ok(Number.isFinite(ROUTINE_WATCHDOG_MS_DEFAULT), "缺省必须是有限值（⛔ Infinity ⇒ 看门狗失效）");
  assert.ok(ROUTINE_WATCHDOG_MS_DEFAULT > 0, "缺省必须是正数");
});

test("AC — judgment-consumer-check 例程 async（runAsync）：挂死的审计子进程由看门狗兜底，⛔ 不同步阻塞", async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "qg-judgment-hang-"));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const hangScript = path.join(tmp, "hang.js");
  fs.writeFileSync(hangScript, "setTimeout(() => {}, 1000);", "utf8");
  const roundLog = path.join(tmp, "quality-round.jsonl");
  const routines = [{
    name: "judgment-consumer-check",
    schedule: { kind: "interval", minutes: 0 },
    run: async () => [await runJudgmentConsumerCheck(tmp, ["node", hangScript])],
  }];
  const code = await runResidentQualityGateLoop({
    root: tmp, intervalMs: 1, once: true, maxRounds: null, roundLogFile: roundLog,
    runId: "judgment-hang", json: false, routines, controlStateRel: QUALITY_CONTROL_STATE_REL,
    routineWatchdogMs: 100,
  });
  assert.equal(code, 0, "看门狗兜底后循环应退出 0");
  const lines = fs.readFileSync(roundLog, "utf8").split("\n").filter((l) => l.trim());
  assert.equal(lines.length, 1, "once ⇒ 一条心跳（⛔ spawnSync 同步阻塞 ⇒ 看门狗无法 fire ⇒ 心跳延迟）");
  const rec = JSON.parse(lines[0]);
  const fact = rec.facts.find((f) => f.name === "judgment-consumer-check");
  assert.ok(fact, "心跳含 judgment-consumer-check fact");
  assert.equal(fact.state, "failed", "挂死 ⇒ 看门狗 failed（⛔ spawnSync 会产 not-evaluated，与 failed 不同形）");
  assert.match(fact.reason, /timed out/i, "reason 载明 timeout（可区分）");
});
