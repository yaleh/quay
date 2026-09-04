// @test-group engine
// archguard-structural-gate-fan-in.test.mjs — gap-fan-in-remove-archguard-gate
// （前身 gap-archguard-structural-gate-in-fan-in-driver）：archguard 结构闸【已从 fan-in gate 链移除】，
// 降级为【按需命令】。原任务（人 2026-08-27 裁定）把 archguard 依赖环闸从 scripts/test.sh 迁入
// fan-in driver 机械步骤（runMechanicalFanIn 第 5.5 步）；本任务实测该闸零发火、零指引、27s/次串行
// 关键路径（周 1.33h），将其从 fan-in 移除——archguard-runner.ts 保留为按需入口（AC3），结构检查
// 落点为文档化按需命令（AC4）。
//
// 本文件是「单真相源负控制」+ 结构不变量断言（纯文件读，⛔ 不跑真 archguard CLI）：
//   ① scripts/test.sh 无 archguard-runner.ts 调用（suite 路径不触发——旧接线已退役）；
//   ② worker-driver.ts 无 archguard 步（fan-in gate 链不再含 archguard-structure step，AC1）；
//   ③ archguard-runner.ts 仍可直接调用（sccCount=0 判据 + metrics-history 载体 + fail-closed + usage）。
//
// Run:
//   scripts/test.sh plugin/test/archguard-structural-gate-fan-in.test.mjs
//   node --test plugin/test/archguard-structural-gate-fan-in.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");

const testSh = () => fs.readFileSync(path.join(REPO_ROOT, "scripts", "test.sh"), "utf8");
const driverSrc = () => fs.readFileSync(path.join(REPO_ROOT, "plugin", "scripts", "worker-driver.ts"), "utf8");
const runnerSrc = () => fs.readFileSync(path.join(REPO_ROOT, "plugin", "scripts", "archguard-runner.ts"), "utf8");

// ── AC1（能取假，单真相源负控制）：scripts/test.sh 不再调用 archguard-runner.ts ─────────────────

test("AC1（能取假）— scripts/test.sh 不再调用 archguard-runner.ts（旧接线退役，⛔ 两个真相源）", () => {
  const src = testSh();
  // 按位置判定，不是按「提到」：test.sh 内不得再出现 archguard-runner.ts 的脚本名（调用形态），
  // 也不得再出现 run_checker "archguard-structure-check" 接线。
  assert.doesNotMatch(src, /archguard-runner\.ts/, "test.sh must no longer name archguard-runner.ts");
  assert.doesNotMatch(src, /archguard-structure-check/, "test.sh must no longer wire the archguard run_checker");
});

// ── AC1（能取假）：fan-in gate 链不再含 archguard 步（⛔ worker-driver.ts 无该 step）──────────────

test("AC1（gap-fan-in-remove-archguard-gate）— worker-driver.ts 的机械 fan-in 不再含 archguard 步（无 step=archguard-structure、无 archguardCommand 测试缝、无 archguard-runner.ts 接点）", () => {
  const src = driverSrc();
  // 按位置判定（⛔ 不按「提到」——散文注释可合法提及被移除的 step 名，只有真调用才会带这些形态）：
  // ① 无 `step("archguard-structure"`（step 调用是执行语义，移除后不得再有）；
  // ② 无 `archguardCommand` 测试缝（interface 字段已删）；
  // ③ 无 `fail("archguard-structure"`（依赖环 red 的接点已随 step 一起删）。
  assert.doesNotMatch(src, /step\("archguard-structure"/, "runMechanicalFanIn must no longer run an archguard-structure step");
  assert.doesNotMatch(src, /archguardCommand/, "the archguardCommand test seam must be removed from MechanicalFanInOptions");
  assert.doesNotMatch(src, /fail\("archguard-structure"/, "no dependency-cycle red may return step=archguard-structure (the gate is gone)");
  // 负控制（AC3/AC4）：按需命令仍文档化在 worker-driver.ts 的移除说明里（降级落点，⛔ 不是静默消失）。
  assert.match(src, /archguard-runner\.ts --root/, "the on-demand archguard command must be documented where the step was removed (AC4)");
});

// ── AC3：archguard-runner.ts 仍可直接调用并产出 metrics（按需保留）───────────────────────────────

test("AC3 — archguard-runner.ts 仍可直接调用：sccCount=0 判据 + metrics-history 载体 + fail-closed + usage 文档", () => {
  const src = runnerSrc();
  // 依赖环判据（无阈值布尔不变量）、fail-closed 语义、metrics 载体随降级保留，⛔ 不在移除 fan-in 步时削弱。
  assert.match(src, /sccCount/, "the dependency-cycle criterion (sccCount===0) must survive the removal");
  assert.match(src, /metrics-history\.jsonl/, "the metrics-history carrier append must survive the removal");
  assert.match(src, /fail-closed|exit 1/, "the fail-closed semantic must survive the removal (read-unreadable ⇒ red)");
  // 按需调用文档（AC4）：runner 自己头注释带 usage（可直接跑、不依赖 fan-in gate 链）。
  assert.match(src, /node --experimental-strip-types plugin\/scripts\/archguard-runner\.ts --root/, "the runner's own header must document the on-demand usage");
});
