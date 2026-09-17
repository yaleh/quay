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

// SPLIT from driver-runtime-s07.test.mjs by gap-suite-split-15-over-30s-test-files — shard 1 of 2 for
// driver-runtime-s07 (carries the AC4 (gap-ac203) slow-start test). Shared fixtures:
// ./helpers/driver-runtime-harness.mjs (single source; ⛔ no fixture code copied into this shard).

import { test } from "node:test";
import { SLOW_START_DRIVER, assert, fs, os, path, run } from "./helpers/driver-runtime-harness.mjs";

test("AC4 (gap-ac203) — 慢启动（3s > 窗口）⇒ start-pending（⛔ 非死亡）；给足窗口 ⇒ 确认成功", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "dr-ac4-"));
  const scripts = path.join(root, "plugin", "scripts");
  fs.mkdirSync(scripts, { recursive: true });
  fs.writeFileSync(path.join(scripts, "promotion-driver.ts"), SLOW_START_DRIVER, "utf8");
  const pluginRoot = path.join(root, "plugin");
  t.after(() => {
    run(["stop", "--kind", "promotion", "--root", root], { pluginRoot, timeout: 20000 });
    fs.rmSync(root, { recursive: true, force: true });
  });

  // ① 窗口 1s，driver 要 3s 才就绪 ⇒ 窗口用尽 ⇒ start-pending，⛔ 不得报 start-failed。
  const t0 = Date.now();
  const short = run(["start", "--kind", "promotion", "--root", root, "--restart-delay", "1", "--run-id", "dr-ac4-short", "--confirm-timeout", "1"], { pluginRoot, timeout: 30000 });
  const shortWall = Date.now() - t0;
  console.log(`[AC4 窗口=1s] exit=${short.status} wall_ms=${shortWall}\n  stdout: ${short.stdout.trim()}\n  stderr: ${short.stderr.trim()}`);
  assert.notEqual(short.status, 0, `未确认存活 ⇒ 非零退出：${short.stdout}\n${short.stderr}`);
  assert.match(short.stderr, /start-pending/, `必须是 start-pending 这一独立取值：${short.stderr}`);
  assert.ok(!/start-failed/.test(short.stderr), `⛔ 慢启动不得被判为死亡：${short.stderr}`);
  assert.ok(!/^started:/m.test(short.stdout), `⛔ 未确认存活时不得打印 started:：${short.stdout}`);

  // ② 同一夹具、给足窗口 ⇒ 确认成功（证明①里那个进程确实只是慢，不是死）。① 留下的 supervisor 还活着
  // ⇒ 走 already-running 路径，那条路径【同样】要确认 driver 真活才 exit 0（supervisor 在而 driver
  // 死在重拉间隙里，是同一种「报成功但实际死亡」）。
  //
  // ⛔ 本条【不断言墙钟】：旧版在此处的 `confirmed_ms >= 1000` 断言的是**测试自己的墙钟**——①② 共用
  // 一个 3s stamp，② 何时开始取决于 ① 的墙钟耗时（= 宿主负载）。套件并发下 ② 可能在 stamp 满 3s 之后
  // 才开始 ⇒ driver 那时已经就绪 ⇒ confirmed_ms≈250 ⇒ 断言红，而**生产行为完全正确**
  // （实测 2026-09-13T06:13Z `confirmed_ms=530`，与 delta 无关）。相对化的那条读数移到 ③。
  const long = run(["start", "--kind", "promotion", "--root", root, "--restart-delay", "1", "--run-id", "dr-ac4-long", "--confirm-timeout", "30"], { pluginRoot, timeout: 60000 });
  console.log(`[AC4 窗口=30s · already-running] exit=${long.status}\n  stdout: ${long.stdout.trim()}\n  stderr: ${long.stderr.trim()}`);
  assert.equal(long.status, 0, `给足窗口后必须确认成功：${long.stdout}\n${long.stderr}`);
  assert.match(long.stdout, /^started: |^already-running: confirmed /m, `确认成功的两种形态之一：${long.stdout}`);
  assert.match(long.stdout, /confirmed_ms=\d+/, `confirmed_ms 必须在：${long.stdout}`);

  // ③ 同一夹具、**fresh root**、给足窗口 ⇒ 确认成功，且「慢启动 ⇒ 确认耗时 > 1s」这条读数**相对化**：
  // stamp 由【第一个 driver 化身】在确认窗起算之后不久创建 ⇒ 就绪时刻 = 窗起算 + ~3s，与宿主负载无关
  // （⛔ 不再测宿主墙钟）。走 spawn 路径（⛔ 非 already-running），与 ② 覆盖不同的分支。
  const root3 = fs.mkdtempSync(path.join(os.tmpdir(), "dr-ac4-fresh-"));
  const s3 = path.join(root3, "plugin", "scripts");
  fs.mkdirSync(s3, { recursive: true });
  fs.writeFileSync(path.join(s3, "promotion-driver.ts"), SLOW_START_DRIVER, "utf8");
  const pluginRoot3 = path.join(root3, "plugin");
  t.after(() => {
    run(["stop", "--kind", "promotion", "--root", root3], { pluginRoot: pluginRoot3, timeout: 20000 });
    fs.rmSync(root3, { recursive: true, force: true });
  });
  const fresh = run(["start", "--kind", "promotion", "--root", root3, "--restart-delay", "1", "--run-id", "dr-ac4-fresh", "--confirm-timeout", "30"], { pluginRoot: pluginRoot3, timeout: 60000 });
  console.log(`[AC4 窗口=30s · fresh root] exit=${fresh.status}\n  stdout: ${fresh.stdout.trim()}\n  stderr: ${fresh.stderr.trim()}`);
  assert.equal(fresh.status, 0, `fresh root 给足窗口后必须确认成功：${fresh.stdout}\n${fresh.stderr}`);
  assert.match(fresh.stdout, /^started: /m, `fresh root 走 spawn 路径 ⇒ started:：${fresh.stdout}`);
  const mf = fresh.stdout.match(/confirmed_ms=(\d+)/);
  assert.ok(mf, `confirmed_ms 必须在：${fresh.stdout}`);
  assert.ok(Number(mf[1]) >= 1000, `驱动需 3s 才就绪 ⇒ 确认耗时 > 1s（stamp 与窗口同时起算，⛔ 不测宿主）：confirmed_ms=${mf[1]}`);
});
