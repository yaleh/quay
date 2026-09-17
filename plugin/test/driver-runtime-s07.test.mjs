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

import { test } from "node:test";
import { KNOWN_KINDS, NEVER_RESIDENT_DRIVER, READY_AFTER_DRIVER, SLOW_START_DRIVER, assert, assertNoResidue, driverPidIsReadinessMarker, fs, launchArgv, makeRootWithDriver, os, path, promotion, readPid, run, runAc3FixtureOnce, spawn, worker } from "./helpers/driver-runtime-harness.mjs";

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





test("AC1/AC2 (gap-driver-start-false-confirms) — 未进入常驻循环的驱动不得被确认；就绪的必须确认", (t) => {
  const mk = (tag, src) => {
    const r = makeRootWithDriver(tag, src);
    const pr = path.join(r, "plugin");
    t.after(() => {
      run(["stop", "--kind", "promotion", "--root", r], { pluginRoot: pr, timeout: 20000 });
      fs.rmSync(r, { recursive: true, force: true });
    });
    return { root: r, pluginRoot: pr };
  };

  // AC1：唯一变量 = 驱动存活时长。两个夹具都**不写 --pid-file** ⇒ 都从未进入常驻循环 ⇒ 都不得被确认。
  const byBusy = {};
  for (const busy of [50, 600]) {
    const { root, pluginRoot } = mk(`gds-nr${busy}`, NEVER_RESIDENT_DRIVER(busy));
    // restart-delay=1（⛔ 不用 30）：t.after 的 stop 要等 supervisor 退出，而 supervisor 在
    // 「child=null 的重拉间隙」收到 SIGTERM 时不会立刻退出 ⇒ 大 restart-delay 会把 stop 拖到兜底
    // SIGKILL（每条 ~10s）。夹具的驱动从不就绪 ⇒ 重拉与否不影响本测的判定。
    byBusy[busy] = run(
      ["start", "--kind", "promotion", "--root", root, "--restart-delay", "1", "--run-id", `dr-gds-nr${busy}`, "--confirm-timeout", "1"],
      { pluginRoot, timeout: 40000 },
    );
    console.log(`[GDS 未就绪 busy=${busy}ms] exit=${byBusy[busy].status}\n  stdout: ${byBusy[busy].stdout.trim()}\n  stderr: ${byBusy[busy].stderr.trim()}`);
  }
  for (const busy of [50, 600]) {
    const r = byBusy[busy];
    assert.notEqual(r.status, 0, `busy=${busy}ms 的驱动从未进入常驻循环 ⇒ 非零退出：${r.stdout}\n${r.stderr}`);
    assert.match(r.stderr, /start-pending/, `busy=${busy}ms 必须是 start-pending（⛔ 非 start-failed）：${r.stderr}`);
    assert.ok(!/^started:/m.test(r.stdout), `⛔ 未就绪时不得打印 started:（busy=${busy}ms）：${r.stdout}`);
  }
  // 这条等式就是本缺陷的判据：退出码不得随「驱动能活多久」变（改前 600ms ⇒ 0，50ms ⇒ 1）。
  assert.equal(byBusy[50].status, byBusy[600].status, "唯一变量=存活时长 ⇒ 退出码不得随它变（改前 1 vs 0 正是本缺陷）");

  // AC2 正控制：真的做出「就绪」（自写 --pid-file 后常驻）⇒ 必须确认成功，⛔ 不是「改成永不确认」。
  const { root: readyRoot, pluginRoot: readyPr } = mk("gds-ready", READY_AFTER_DRIVER(600));
  const ready = run(
    ["start", "--kind", "promotion", "--root", readyRoot, "--restart-delay", "30", "--run-id", "dr-gds-ready", "--confirm-timeout", "30"],
    { pluginRoot: readyPr, timeout: 60000 },
  );
  console.log(`[GDS 就绪 boot=600ms] exit=${ready.status}\n  stdout: ${ready.stdout.trim()}\n  stderr: ${ready.stderr.trim()}`);
  assert.equal(ready.status, 0, `就绪驱动必须确认成功：${ready.stdout}\n${ready.stderr}`);
  assert.match(ready.stdout, /^started: /m, `就绪驱动打印 started:：${ready.stdout}`);
  const m = ready.stdout.match(/confirmed_ms=(\d+)/);
  assert.ok(m && Number(m[1]) >= 600, `确认耗时 ≥ boot：就绪标记由驱动自己在 boot 之后写，⛔ 非 supervisor 预写：${ready.stdout}`);
  assert.ok(readPid(readyRoot, "promotion-driver.pid"), "driver pid 文件由【驱动自己】写（⛔ 非 supervisor 预写）");

  // AC4（硬规则 5b：修一处 ≠ 只此一处）——就绪标记的**写者**按 kind 枚举成一条可核的读数，
  // ⛔ 不散落在注释里。pidSelf=true 的五个 kind 就绪标记由驱动自写（直接量）；worker 仍是
  // supervisor 写（代理量，残留见 driverPidIsReadinessMarker 的注释）。
  assert.deepEqual(
    KNOWN_KINDS.filter((k) => driverPidIsReadinessMarker(k)),
    ["promotion", "outer", "quality", "meta", "goal"],
    "就绪标记由【驱动自己】写的 kind 清单（= registry 的 pidSelf=true）；worker 是登记在案的残留",
  );
  assert.equal(driverPidIsReadinessMarker("worker"), false, "worker 的 driver pid 文件仍由 supervisor 写（代理量）");
});

// ── MCP 黑名单接线（gap-worker-mcp-blacklist-strict-config AC1/AC3/AC6）────────────────────────
// launchArgv 是【唯一 argv 构造点】。AC1 的负控制在这里是「argv 不依赖 MCP 配置」这条可取的假：
// 若哪天黑名单被误挂到共享 profile 上（outer 连坐），或那个 `length > 0` 的守卫被去掉，
// 下面第一条就会红——而不是等 outer 真的起不来浏览器才被发现。


/** 三源 MCP fixture（家目录 + 一个项目目录），⛔ 不读真实 ~/.claude*（AC7 同款缝）。 */
