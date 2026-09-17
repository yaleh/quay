// @test-group serial
// driver-runtime.test.mjs — AC151 (tasks/gap-ac151-two-level-driver-layer-landing): the two-level
// layering (Layer 0 driver-runtime + Layer 1a task-processing / Layer 1b routine) + the supervisor
// ported from promotion-driver-launch.sh (bash) into TS.
//
//   AC1 (两级分层落地): Layer 0 (driver-runtime) owns supervisor/loop/stopCondition/heartbeat/
//     controlPlane/notify/profile/ResultVocab; Layer 1a owns source/filters/select/act/verify/outcome;
//     Layer 1b owns routines/schedule/collect/report. promotion/worker inherit 0+1a (identity,
//     ⛔ 非平行副本). Falsifiable: ① manager-kind (1b) 被骨架强制实现空的候选池/选择/verify 三段 ⇒ 假
//     （1b 的 RoutineSpec 不引用 1a 的 source/select/verify）；② 1b 重实现 Layer 0 循环/心跳/判停 ⇒ 假
//     （1b 的 schedule 复用 routine-scheduler isDue 同一函数身份，report 经 Layer 0 notify）。
//   AC2 (supervisor 港进 TS): 8 张 registry 表 → DRIVER_KINDS 单一数据表；run_supervisor → 可单测的
//     runSupervisor；status/liveness/start/stop/drain 变成可直接 import 的纯函数/IO 函数。Falsifiable:
//     supervisor 逻辑仍在 bash .sh 里 ⇒ 假。
//
// Run: scripts/test.sh plugin/test/driver-runtime.test.mjs

// SPLIT from driver-runtime.test.mjs by gap-suite-split-15-over-30s-test-files — shard 7/10 (4 tests). Shared fixtures: ./helpers/driver-runtime-harness.mjs (single source).
// FURTHER SPLIT by gap-suite-split-15-over-30s-test-files (shard 7 was still >30s) — this file keeps the two
// AC2/AC3 (gap-ac3-live…) controls; AC4 (gap-ac203) and AC1/AC2 (gap-driver-start-false-confirms) moved to
// driver-runtime-s11.test.mjs / driver-runtime-s12.test.mjs, same harness (./helpers/driver-runtime-harness.mjs).

import { test } from "node:test";
import { assert, assertNoResidue, runAc3FixtureOnce } from "./helpers/driver-runtime-harness.mjs";

test("AC2 (gap-ac3-live…) 负控制 — 夹具内部断言失败 ⇒ 清理仍然执行（零残留进程 + root 已删）", (t) => {
  const child = runAc3FixtureOnce(true);
  console.log(`[AC2 负控制] child exit=${child.status} root=${child.root}`);
  // ⛔ 先证明这条控制真的跑在失败路径上——否则它测的是 AC3 那条（两态混淆 = 判据恒真）。
  assert.notEqual(child.status, 0, `负控制必须真的失败：\n${child.stdout}\n${child.stderr}`);
  assert.match(`${child.stdout}${child.stderr}`, /fail 1/, `子进程必须真的跑过 AC3（⛔ 不是被静默跳过）：\n${child.stdout}\n${child.stderr}`);
  assert.ok(
    `${child.stdout}${child.stderr}`.includes("AC2 负控制：注入的夹具内部断言失败"),
    `失败必须来自注入的夹具内断言（而不是别的岔路）：\n${child.stdout}\n${child.stderr}`,
  );
  assertNoResidue(child, "AC2 失败路径");
});


test("AC3 (gap-ac3-live…) 正控制 — 通过路径同样零残留（对照 AC2，证明清理没变成「总是不清理」）", (t) => {
  const child = runAc3FixtureOnce(false);
  console.log(`[AC3 正控制] child exit=${child.status} root=${child.root}`);
  assert.equal(child.status, 0, `正控制必须真的绿：\n${child.stdout}\n${child.stderr}`);
  assert.match(child.stdout, /pass 1/, `子进程必须真的跑过 AC3（⛔ 不是被静默跳过）：\n${child.stdout}`);
  assertNoResidue(child, "AC3 通过路径");
});

// ── MCP 黑名单接线（gap-worker-mcp-blacklist-strict-config AC1/AC3/AC6）────────────────────────
// launchArgv 是【唯一 argv 构造点】。AC1 的负控制在这里是「argv 不依赖 MCP 配置」这条可取的假：
// 若哪天黑名单被误挂到共享 profile 上（outer 连坐），或那个 `length > 0` 的守卫被去掉，
// 下面第一条就会红——而不是等 outer 真的起不来浏览器才被发现。


/** 三源 MCP fixture（家目录 + 一个项目目录），⛔ 不读真实 ~/.claude*（AC7 同款缝）。 */
