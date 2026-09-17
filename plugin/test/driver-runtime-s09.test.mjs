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

// SPLIT from driver-runtime.test.mjs by gap-suite-split-15-over-30s-test-files — shard 9/10 (4 tests). Shared fixtures: ./helpers/driver-runtime-harness.mjs (single source).

import { test } from "node:test";
import { anchorHosts, assert, fs, kernelLayoutFixture, killProcs, migrationFixture, os, path, pidAlive, promotion, resolveKernelSibling, restartKind, rmRoots, spawnIdleProc, spawnSync, spawnTermIgnoringProc, statePaths, stopKind, stopLegacyPair, teardownLiveDriver, waitFor, withKernelRoot, worker, writePidFile } from "./helpers/driver-runtime-harness.mjs";

test("resolveKernelSibling() NEGATIVE CONTROL — the SAME fixture + the source-checkout marker ⇒ raw .ts wins", () => {
  const fx = kernelLayoutFixture(true);
  try {
    const r = withKernelRoot(fx.pluginRoot, () => resolveKernelSibling("promotion-driver.ts"));
    assert.ok(r, "must resolve");
    assert.equal(r.stripTypes, true, "source checkout ⇒ raw .ts (edit-visible, source-respawn still works)");
    assert.ok(r.path.endsWith(path.join("scripts", "promotion-driver.ts")), `raw path: ${r.path}`);
  } finally {
    fs.rmSync(fx.dir, { recursive: true, force: true });
  }
});

// ══════════════════════════════════════════════════════════════════════════════════════════════════
// gap-driver-restart-unreliable-legacy-to-anchor-migration
//
// 缺陷（生产实测 2026-09-15，`/home/yale/work/quay`，六 kind 逐个 legacy→anchor 迁移）：
// `quay driver restart --kind <k>` 在多 kind 上「返回了，而旧的 supervisor+driver 还活着」，且命令
// 自己的输出/退出码读起来像一次重启。三处同源缺陷，都在 stop 侧：
//
//  ① `anchorOwns` 的回落规则用**工作区全局事实**（`.quay/anchor-desired.json` 存在 = 任意一个 kind
//     已经迁移过）＋「没有活 supervisor 载体」推出「anchor 拥有这个 kind」。它**没有问盘上还有没有
//     活着的旧 driver**。迁移期恰好常是这个形状（旧 supervisor 先退、它的 driver 还活着；或那两张
//     载体已被上一次拆除删掉）⇒ `stop --kind X` 走 anchor 路径。
//  ② anchor 路径**一个信号都不发给遗留 pid**，只把那两张载体 `rmSync` 掉 ⇒ 活着的旧 loop 变成盘上
//     不可见的孤儿，与新 anchor 的 loop 同时派发（生产：四组 pair 在 restart 返回 60s 后仍活，
//     `goal` 的旧进程 8 分钟以上仍在写同一个 `goal-round.jsonl`）。
//  ③ `restartKind` **丢弃 stopKind 的返回值**、无条件 start ⇒ stop 明明报了「旧进程树还在」，命令
//     照样把该 kind 加进 anchor 期望态 = 第二份 loop。加上 legacy 分支「快照一次 pid、杀完不验证、
//     恒返回 0」，命令的退出码完全不可信。
//
// ⇒ 修法四条：stop 侧逐轮重读载体 + SIGKILL 后回读确认 + 「停不掉」不报 stopped；anchor 路径**先真的
//   停掉遗留 pair**；`anchorOwns` 把「盘上有活着的旧 driver」当 legacy；`restart` 在 stop 非 0 时中止。
//
// ⛔ 贯穿全部用例的负向不变式（AC5）：信号**只**发给本 kind 两张 pid 载体里的进程——不扫 `/proc`、
//   不按名字匹配、**从不读 `*-inflight.pid`** ⇒ worker 的在飞子进程（独立 OS 进程）在任何分支下都不
//   受影响。下面每个用例都带一条 in-flight 在飞子进程存活断言。
// ══════════════════════════════════════════════════════════════════════════════════════════════════

/** 一个「活的」进程（idle）——夹具扮演遗留 supervisor / driver / anchor / 在飞子进程。
 *  ⛔ 调用方负责全部收掉（`killProcs`）；本仓库实测过夹具进程泄漏的代价（见上面 teardownLiveDriver）。 */

/** 一个**不是本进程子进程**的活进程（由短命中转进程起出来、随即被 init 收养）。
 *  生产里「旧 supervisor 已死、driver 还活着」的孤儿正是这个形状；夹具也必须这样造，⛔ 不能用
 *  `spawnIdleProc()`——那是本进程的直接子进程，而 `spawnSync` 会**阻塞事件循环** ⇒ libuv 收不到
 *  SIGCHLD ⇒ 它死后成为**僵尸**：`kill -0` 仍为真而 SIGKILL 无效（实测本用例曾因此假红，
 *  报 `remaining pid=[…]` 且进程其实早已退出）。僵尸恰是「验证而不是假设」这条修复的正当场景，
 *  ⛔ 但它不是本用例要造的那一格。 */

/** 一个「收到 SIGTERM 也不退出」的进程（模拟旧 supervisor 卡在收尾 + 在信号之后重拉 driver）：
 *  收到 SIGTERM 时把 `pidToWrite` 写进 `carrierFile`，自己不退出（⇒ 只可能被 SIGKILL 收掉）。
 *  ⛔ 必须先 `waitFor` 它写出的 `readyFile` 再对它发信号：Node 子进程要几十毫秒才装得上 handler，
 *  在那之前 SIGTERM 走**缺省动作**（进程直接死）⇒ 夹具会静默退化成「一个普通的 idle 进程」，
 *  而**用例要测的正是那个 handler**。实测：不等 ready 时 `signalled` 只有 2 条、重拉出的新 pid 永不被看见。 */


/** 轮询到条件为真；超时**抛**（⛔ 不返回 falsy——本仓库实测过「裸 await 一个超时返回 falsy 的等待 = 恒真空转」）。 */


/** 迁移期形状的夹具：kind=`worker`，盘上有两张**旧形态** pid 载体、一个活着的 anchor（回读面点名
 *  `anchorHostsKind` 说的那个 kind，缺省不是 worker）、以及 `.quay/anchor-desired.json`（「任意一个
 *  kind 迁移过」这个全局事实——正是 `anchorOwns` 回落规则读的那一个）。 */


test("AC1 (gap-driver-restart-unreliable…) — 判别对照：anchor 未点名该 kind ∧ 旧 driver 还活着(载体在) ⇒ legacy 路径真的停掉；anchor 点名该 kind ⇒ anchor 路径也必须真的停掉遗留 pair（旧实现只删载体）", async (t) => {
  const procs = [];
  t.after(() => killProcs(procs));

  // ── A：anchor 不点名 worker，旧 supervisor+driver 双活、载体齐全 ⇒ 旧实现也走 legacy 路径。 ──
  const a = migrationFixture("a", { supervisorCarrier: true, anchorNamesWorker: false });
  // ── B：同一形状，只把 anchor 的回读面改成点名 worker（**一个变量**）⇒ 路由翻到 anchor 路径。 ──
  const b = migrationFixture("b", { supervisorCarrier: true, anchorNamesWorker: true });
  // ── C：B 的形状 + supervisor 载体**不存在**（进程仍活着）——生产里这正是上一次拆除留下的残形，
  //        也是修复前最贵的那一格：旧实现只看 supervisor 载体 ⇒ 读成「anchor 所有」⇒ 只删载体。 ──
  const c = migrationFixture("c", { supervisorCarrier: false, anchorNamesWorker: false });
  procs.push(a.supPid, a.drvPid, a.anchorPid, a.inFlightPid, b.supPid, b.drvPid, b.anchorPid, b.inFlightPid,
    c.supPid, c.drvPid, c.anchorPid, c.inFlightPid);
  t.after(() => rmRoots([a.root, b.root, c.root]));

  // 前提读数（⛔ 不用断言代替测量）：三边的旧 driver 都活着，且 anchor 回读面按预期点名。
  assert.equal(pidAlive(a.drvPid), true, "A 前提：旧 driver 活着");
  assert.equal(anchorHosts(b.root, "worker").hosted, true, "B 前提：anchor 点名 worker ⇒ 走 anchor 路径");
  assert.equal(anchorHosts(c.root, "worker").hosted, false, "C 前提：anchor 不点名 worker");

  const opts = { legacyGraceMs: 1500, legacyKillWaitMs: 400 };
  const aOut = [], bOut = [], cOut = [];
  const aRc = await stopKind(a.root, "worker", (s) => aOut.push(s.trim()), opts);
  const bRc = await stopKind(b.root, "worker", (s) => bOut.push(s.trim()), { ...opts, stopTimeoutMs: 2000 });
  const cRc = await stopKind(c.root, "worker", (s) => cOut.push(s.trim()), opts);

  // A：legacy 路径 —— 旧实现与修复后都该通过（对照组，证明修复没有把「该杀的」杀掉之外的东西）。
  assert.equal(aRc, 0, `A rc: ${aOut.join("|")}`);
  assert.deepEqual(aOut, ["stopped"], "A 走 legacy 路径 ⇒ 确实是「停掉了东西」");
  assert.equal(pidAlive(a.supPid), false, "A：旧 supervisor 被杀");
  assert.equal(pidAlive(a.drvPid), false, "A：旧 driver 被杀");

  // B：anchor 路径 —— **判别项**。修复前 `stopKindViaAnchor` 只 rm 两张载体、一个信号都不发。
  assert.ok(bOut.some((l) => l.startsWith("stopped-legacy:")), `B: anchor 路径必须真的停掉遗留 pair（⛔ 不是只删载体）：${bOut.join("|")}`);
  assert.equal(pidAlive(b.supPid), false, "B(判别)：anchor 声称托管该 kind **不得**让旧 supervisor 活下来");
  assert.equal(pidAlive(b.drvPid), false, "B(判别)：旧 driver 同样必须死");
  assert.equal(pidAlive(b.anchorPid), true, "B 对照：anchor 自己不是遗留进程 ⇒ ⛔ 不得被信号");

  // C：唯一的差别是 supervisor 载体不在 ⇒ 修复前 `anchorOwns` 判 true（走 anchor 路径且只删载体），
  //    于是**两个进程都活着**而命令报 not-running/exit 0。修复后按「盘上还有活 driver」走 legacy 路径。
  assert.equal(cRc, 0, `C rc: ${cOut.join("|")}`);
  assert.deepEqual(cOut, ["stopped"], `C：真的停掉了东西 ⇒ ⛔ 不得报 not-running（硬规则 3b）：${cOut.join("|")}`);
  assert.equal(pidAlive(c.drvPid), false, "C(判别)：活着的孤儿 driver 必须被停掉");

  // AC5：三个夹具的在飞子进程一个都没被碰（stop 只读 supervisor/driver 两张载体）。
  for (const f of [a, b, c]) assert.equal(pidAlive(f.inFlightPid), true, "在飞子进程必须活过 stop（SPEC §6.9 不变式 3）");
});


test("AC2(a) — 旧 supervisor 在宽限内重拉出来的**新** driver 也属于「旧进程树」：逐轮重读载体 ⇒ 一起停掉（旧实现只快照一次）", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "dr-mig-reread-"));
  fs.mkdirSync(path.join(root, ".quay"), { recursive: true });
  const st = statePaths(root, "worker");
  const firstDriver = spawnIdleProc();
  const successor = spawnIdleProc(); // 旧 supervisor「重拉」出来的新 driver
  // 扮演旧 supervisor：收到 SIGTERM 时把新 driver 的 pid 写进 driver 载体（生产里 supervisor 的
  // startDriver → writePidFile 就是这一步），并且**自己不退出**（模拟重拉发生在信号之后）。
  const ready = path.join(root, ".quay", "fake-supervisor.ready");
  const sup = spawnTermIgnoringProc(st.driverPidFile, successor, ready);
  fs.writeFileSync(st.supervisorPidFile, `${sup}\n`, "utf8");
  fs.writeFileSync(st.driverPidFile, `${firstDriver}\n`, "utf8");
  t.after(() => { killProcs([sup, firstDriver, successor]); rmRoots([root]); });
  await waitFor(() => fs.existsSync(ready), 10_000, "the fake supervisor to install its SIGTERM handler");
  assert.equal(pidAlive(firstDriver), true, "前提：原 driver 活着");

  const r = await stopLegacyPair(root, "worker", { graceMs: 1500, killWaitMs: 400 });
  assert.equal(r.state, "stopped", `state: ${JSON.stringify(r)}`);
  assert.ok(r.signalled.includes(successor), `重拉出的新 driver pid 必须进过信号集：${JSON.stringify(r.signalled)}`);
  assert.equal(pidAlive(successor), false, "重拉出的新 driver 必须死 —— 旧实现只快照一次载体 ⇒ 结构上看不见它，于是「命令返回了、新 driver 还活着」");
  assert.equal(pidAlive(firstDriver), false, "原 driver 同样死");
  assert.equal(pidAlive(sup), false, "拒绝 SIGTERM 的旧 supervisor 由确定性 SIGKILL 收掉");
});


test("AC2(b) — 「停不掉」与「停掉了」必须不同形：still-running 时保留载体（活进程的唯一记录）⇒ 下一次 stop 仍会看到它", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "dr-mig-still-"));
  fs.mkdirSync(path.join(root, ".quay"), { recursive: true });
  const st = statePaths(root, "worker");
  const survivor = spawnIdleProc();
  fs.writeFileSync(st.driverPidFile, `${survivor}\n`, "utf8");
  t.after(() => { killProcs([survivor]); rmRoots([root]); });

  // 「停不掉」在真实 OS 上**不可确定地制造**（SIGKILL 杀不掉一个普通进程）⇒ 用 `signalFn` 测试缝把
  // 信号层换成空操作：目标进程毫发无损 ⇒ 本函数必须报 `still-running` 而**不是** `stopped`。
  const r = await stopLegacyPair(root, "worker", { graceMs: 150, killWaitMs: 50, signalFn: () => {} });
  assert.equal(r.state, "still-running", `必须报 still-running（⛔ 不得与 stopped 同形）：${JSON.stringify(r)}`);
  assert.deepEqual(r.remaining, [survivor], "remaining 点名仍活的 pid");
  assert.deepEqual(r.signalled, [survivor], "信号的意图仍被记录（signalled 是「发过」，⛔ 不是「杀掉了」）");
  assert.ok(fs.existsSync(st.driverPidFile), "⛔ 载体必须保留：一个活进程在盘上唯一的记录，删了就成不可见孤儿");
  assert.equal(pidAlive(survivor), true, "对照：进程确实还活着（上面那条存在性断言不是空转）");

  // 反向对照：同一进程、同一夹具，信号层恢复成真的 `process.kill` ⇒ 必须被停掉（证明上一段的
  // still-running 是「信号没送到」造成的，⛔ 不是这个 pid 杀不动）。
  const r2 = await stopLegacyPair(root, "worker", { graceMs: 150, killWaitMs: 100 });
  assert.equal(r2.state, "stopped", `不排除 ⇒ 必须停掉：${JSON.stringify(r2)}`);
  assert.equal(pidAlive(survivor), false, "对照：同一个 pid 这次死了");
  assert.equal(fs.existsSync(st.driverPidFile), false, "确认不在 ⇒ 死 pid 载体被摘掉（「已经停了」与「在跑」不同形）");
});
