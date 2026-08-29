// @test-group engine
// archguard-structural-gate-fan-in.test.mjs — gap-archguard-structural-gate-in-fan-in-driver
// (SPEC-fan-in-driver-mechanical-orchestration-2026-08-27 §2/§5/§6): archguard 依赖环闸迁入
// fan-in driver 机械步骤（runMechanicalFanIn 第 5.5 步，typecheck 后 scoped门 前），并退役
// scripts/test.sh 的旧接线（gap-archguard-zero-production-calls 的落点——suite 路径）。人 2026-08-27
// 逐字裁定「archguard 应接在 fan-in 过程里（机械 driver 驱动的 fan-in），而不是 suite test」。
//
// Coverage map (task ACs):
//   AC1（能取假，单真相源）— scripts/test.sh 不再调用 archguard-runner.ts（旧接线退役）；
//         ⛔ 仍调用 ⇒ 假（两个真相源——suite 路径与 fan-in 路径各跑一次，或 suite 路径残留）。
//   AC2（能取假，生产能产出）— 生产测量（⛔ 非 hermetic 可测）：driver 落地后一次 post-landing
//         fan-in 在 .archguard/metrics-history.jsonl 产生新记录。hermetic 半边 = 机械 fan-in 的
//         镜像步骤（mirrorArchguardMetrics）由 fan-in-driver-mechanical-orchestration.test.mjs 覆盖。
//
// 本文件是「单真相源负控制」+ 结构不变量断言（纯文件读，⛔ 不跑真 archguard CLI）：
//   ① test.sh 无 archguard-runner.ts 调用（AC1 负控制——按位置，不是按「提到」）；
//   ② worker-driver.ts 有 archguard-runner.ts 调用（单真相源的正半边——只有一个接点）；
//   ③ archguard-runner.ts 的闸不变量仍在（sccCount=0 判据 + metrics-history 载体 + fail-closed）。
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

// ── 单真相源的正半边：worker-driver.ts 是唯一接点 ──────────────────────────────────────────────

test("单真相源（正半边）— worker-driver.ts 是 archguard-runner.ts 的唯一生产接点", () => {
  const src = driverSrc();
  // 迁入 fan-in driver：默认命令引用 archguard-runner.ts（按位置——默认 archguardCommand 是 argv 字面量）。
  assert.match(src, /archguard-runner\.ts/, "worker-driver.ts must name archguard-runner.ts (the new single call site)");
  assert.match(src, /archguardCommand/, "runMechanicalFanIn must expose the archguardCommand test seam");
  assert.match(src, /fail\("archguard-structure"/, "dependency-cycle red must return step=archguard-structure");
});

// ── archguard-runner.ts 闸不变量仍在（迁入不改判据）───────────────────────────────────────────

test("archguard-runner.ts 闸不变量仍在 — sccCount=0 判据 + metrics-history 载体 + fail-closed", () => {
  const src = runnerSrc();
  // 依赖环判据（无阈值布尔不变量）与 fail-closed 语义随迁入保留，⛔ 不在迁入过程中削弱。
  assert.match(src, /sccCount/, "the dependency-cycle criterion (sccCount===0) must survive the move");
  assert.match(src, /metrics-history\.jsonl/, "the metrics-history carrier append must survive the move");
  assert.match(src, /fail-closed|exit 1/, "the fail-closed semantic must survive the move (read-unreadable ⇒ red)");
});
