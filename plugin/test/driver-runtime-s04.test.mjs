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

// SPLIT from driver-runtime.test.mjs by gap-suite-split-15-over-30s-test-files — shard 4/4 (11 tests). Shared fixtures: ./helpers/driver-runtime-harness.mjs (single source).

import { test } from "node:test";
import { DRIVER_KINDS, KERNEL, REPO_ROOT_DR, anchorHosts, assert, fakeKindDriverSource, fs, kernelLayoutFixture, kernelRun, kernelSiblingArgv, killProcessGroupOf, killProcs, lastSupervisorDriverPid, launchArgv, makeRoot, mcpFixture, migrationFixture, os, path, pidAlive, preferredAnchorKernel, promotion, readDesired, readPid, resolveKernelSibling, restartKind, rmRoots, run, spawn, spawnIdleProc, spawnOrphanProc, spawnSync, spawnTermIgnoringProc, statePaths, stopKind, stopLegacyPair, teardownLiveDriver, waitFor, withKernelRoot, worker, writePidFile } from "./helpers/driver-runtime-harness.mjs";

test("AC5 precondition — the emitted plugin entry points at a REAL on-disk command (not a dead path)", (t) => {
  const fx = mcpFixture(t);
  const argv = launchArgv("task-worker", "P", REPO_ROOT_DR, { mcpRoots: fx.roots });
  const table = JSON.parse(argv[argv.indexOf("--mcp-config") + 1]).mcpServers;
  const spec = table["plugin_quay_quay"];
  assert.ok(spec, "precondition: quay entry present");
  const cmdPath = spec.args[0];
  assert.ok(!cmdPath.includes("${CLAUDE_PLUGIN_ROOT}"), "placeholder expanded");
  assert.ok(fs.existsSync(cmdPath), `the emitted MCP command must exist on disk: ${cmdPath}`);
});


test("AC3 caller — an unresolvable MCP configuration ⇒ ZERO mcp flags (dispatch is never blocked)", (t) => {
  const argv = launchArgv("task-worker", "P", REPO_ROOT_DR, { mcpRoots: null });
  assert.ok(!argv.includes("--strict-mcp-config"), "no flag when the config cannot be evaluated");
  assert.ok(!argv.includes("--mcp-config"));
  assert.equal(argv.at(-1), "P");
  // 负控制（对照必须能把结论翻过来）：同一个调用给了可解析的根 ⇒ flag 立刻出现。
  const fx = mcpFixture(t);
  assert.ok(launchArgv("task-worker", "P", REPO_ROOT_DR, { mcpRoots: fx.roots }).includes("--strict-mcp-config"));
});

// ── resolveKernelSibling: raw .ts vs the shipped dist bundle ─────────────────────────────────────────
// gap-dist-plugin-missing-node-modules-task-schema-yaml (kernel half — mirror of Core
// `plugin-root.ts::isPluginSourceCheckout`). `runSupervisor` resolves EVERY kind's driver through
// `resolveKernelSibling(spec.driver)`, and the driver scripts' import closure needs `yaml` /
// `@modelcontextprotocol/sdk/*` / `zod`, none of which an installed plugin tree carries — so a raw
// pick there means all six kinds die at spawn with ERR_MODULE_NOT_FOUND, exactly as measured on the
// real plugin cache. The dist bundle is self-contained and runs without --experimental-strip-types.

/** `<dir>/plugin/scripts/<name>.ts` (+ `dist/<name>.js`) and — when `withCoreSrc` — the
 *  `<dir>/packages/quay/src` marker that makes `<dir>/plugin` a SOURCE checkout. */



test("resolveKernelSibling() — shipped install (raw .ts + dist coexist): the BUNDLE wins, stripTypes false", () => {
  const fx = kernelLayoutFixture(false);
  try {
    const r = withKernelRoot(fx.pluginRoot, () => resolveKernelSibling("promotion-driver.ts"));
    assert.ok(r, "must resolve");
    assert.equal(r.stripTypes, false, "no --experimental-strip-types in a shipped install");
    assert.ok(r.path.endsWith(path.join("scripts", "dist", "promotion-driver.js")), `bundle path: ${r.path}`);
    // The kernel spawns via this argv, so assert the ARGV too (the flag is what would be wrong).
    process.env.QUAY_PLUGIN_ROOT = fx.pluginRoot;
    const argv = kernelSiblingArgv("promotion-driver.ts", ["--root", "/tmp/x"]);
    delete process.env.QUAY_PLUGIN_ROOT;
    assert.deepEqual(argv.slice(0, 3), ["node", "--no-warnings", r.path], `argv: ${JSON.stringify(argv)}`);
  } finally {
    delete process.env.QUAY_PLUGIN_ROOT;
    fs.rmSync(fx.dir, { recursive: true, force: true });
  }
});


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


test("AC2(c) restart — stop 未确认旧进程树退出 ⇒ **中止**（⛔ 不起新循环、⛔ 不把 kind 加进 anchor 期望态）", async (t) => {
  const f = migrationFixture("abort", { supervisorCarrier: true, anchorNamesWorker: true });
  t.after(() => { killProcs([f.supPid, f.drvPid, f.anchorPid, f.inFlightPid]); rmRoots([f.root]); });

  const out = [], err = [];
  // anchor 点名了 worker（⇒ anchor 路径），而夹具的「anchor」是个不跑循环的 idle 进程 ⇒ 该 kind 的
  // 循环永远不会收尾 ⇒ stop 必须报失败。这正是生产里 `restart` 之后日志出现
  // `did not stop within 60s` + `start-pending:` 的那个形状。
  const rc = await restartKind(
    f.root,
    "worker",
    { restartDelaySecs: 1, confirmTimeoutSecs: 1, legacyGraceMs: 1500, legacyKillWaitMs: 400, stopTimeoutMs: 1200, anchorExitMs: 300 },
    (s) => out.push(s.trim()),
    (s) => err.push(s.trim()),
  );
  assert.equal(rc, 1, `stop 未确认干净 ⇒ restart 必须非 0：${out.join("|")}`);
  assert.ok(err.some((l) => l.startsWith("restart-aborted:")), `必须显式说明「重启没发生」：${err.join("|")}`);
  assert.ok(out.some((l) => l.startsWith("stopped-legacy:")), `遗留 pair 仍然要真的被停掉：${out.join("|")}`);
  assert.equal(pidAlive(f.supPid), false, "判别：遗留 supervisor 真的死了（stop 那一半仍然有效）");
  assert.equal(pidAlive(f.drvPid), false, "判别：遗留 driver 真的死了");
  // ⛔ 最关键的一条：start 必须**没有**跑过。它跑过的直接量 = 该 kind 被加进 anchor 期望态
  // （`startKindViaAnchor` 第 ① 步），那就是第二份 loop。
  assert.equal(readDesired(f.root).kinds.includes("worker"), false, "⛔ start 不得跑过：kind 一旦进期望态，anchor 就会起第二份 loop");
  assert.equal(pidAlive(f.anchorPid), true, "对照：本次没起新 anchor、也没杀旧 anchor");
  assert.equal(pidAlive(f.inFlightPid), true, "AC5：在飞子进程活过整条 restart 路径");
});


test("AC3 负控制 — ① 从未起过的 kind：零信号、not-running（⛔ 不与 stopped 同形）；② anchor 已托管且盘上无任何遗留进程：anchor 自己的 pid ⛔ 不得被当成遗留进程", async (t) => {
  // ① 从未起过。
  const never = fs.mkdtempSync(path.join(os.tmpdir(), "dr-neg-never-"));
  fs.mkdirSync(path.join(never, ".quay"), { recursive: true });
  t.after(() => rmRoots([never]));
  const nOut = [];
  const nRc = await stopKind(never, "worker", (s) => nOut.push(s.trim()));
  assert.equal(nRc, 0, "从未起过 ⇒ 成功且无事发生（⛔ 不得有伪 stop-failed）");
  assert.deepEqual(nOut, ["not-running"], `⛔「本来就没跑」与「刚停掉」必须不同形：${nOut.join("|")}`);
  assert.equal(fs.existsSync(statePaths(never, "worker").stopSentinel), false, "收尾不留 stop 哨兵（否则下一次 start 读到假状态）");

  // ② anchor 已托管、盘上**没有**任何遗留进程：driver 载体写的就是 anchor 自己的 pid（收敛形态的真实
  //    写法——worker 是 pidSelf=false ⇒ 由 anchor 写），supervisor 载体不存在。
  const hosted = fs.mkdtempSync(path.join(os.tmpdir(), "dr-neg-hosted-"));
  fs.mkdirSync(path.join(hosted, ".quay"), { recursive: true });
  const st = statePaths(hosted, "worker");
  const anchorPid = spawnIdleProc();
  const inFlight = spawnIdleProc();
  fs.writeFileSync(st.driverPidFile, `${anchorPid}\n`, "utf8");
  fs.writeFileSync(st.inflightPidFile, `${inFlight}\n`, "utf8");
  fs.writeFileSync(path.join(hosted, ".quay", "anchor.pid"), `${anchorPid}\n`, "utf8");
  fs.writeFileSync(path.join(hosted, ".quay", "anchor.json"), JSON.stringify({ pid: anchorPid, startedAt: new Date().toISOString(), kinds: ["worker"], host: "anchor" }), "utf8");
  fs.writeFileSync(path.join(hosted, ".quay", "anchor-desired.json"), JSON.stringify({ kinds: ["worker"], opts: {}, updatedBy: "quay-driver-start", updatedAt: new Date().toISOString() }), "utf8");
  t.after(() => { killProcs([anchorPid, inFlight]); rmRoots([hosted]); });

  // 直接量：遗留拆除那一半必须是「什么都没发现」——这正是 anchor 承载的**稳态**，⛔ 不得有任何伪动作。
  const pair = await stopLegacyPair(hosted, "worker", { graceMs: 200, killWaitMs: 100, excludePid: anchorPid });
  assert.equal(pair.state, "not-running", `anchor 承载的稳态里没有遗留 pair（⛔ 不得报 stopped/still-running）：${JSON.stringify(pair)}`);
  assert.deepEqual(pair.signalled, [], "⛔ anchor 自己的 pid 不得被信号（那会一次带走全部六个 kind）");
  assert.deepEqual(pair.remaining, [], "无遗留");
  assert.equal(pidAlive(anchorPid), true, "对照：anchor 未被信号");
  assert.equal(pidAlive(inFlight), true, "AC5：在飞子进程未被信号");
  assert.ok(fs.existsSync(st.driverPidFile), "排查完成时载体按原样保留（那是 anchor 托管的就绪标记，⛔ 不由本路径删）");

  // 整条 stop 也不得打印 `stopped-legacy:`（= 没有把 anchor 自己的 pid 当成遗留进程拆掉）。
  // ⚠️ 这里**不**断言 anchor 活到最后：kind 一个都不剩时，`stopKindViaAnchor` 的既有语义就是
  // 「anchor 自身也可以停了」（会 SIGTERM/SIGKILL 它）——那是**设计**，⛔ 不是本任务的缺陷面。
  const out = [];
  await stopKind(hosted, "worker", (s) => out.push(s.trim()), { stopTimeoutMs: 1200, anchorExitMs: 300 });
  assert.equal(out.some((l) => l.startsWith("stopped-legacy:")), false, `⛔ anchor 承载稳态不得出现伪遗留拆除：${out.join("|")}`);
  assert.equal(pidAlive(inFlight), true, "AC5：整条 stop 之后在飞子进程依然未被信号");
});

// ── AC4 + AC5：真进程、真 anchor 的端到端（⛔ 不是「CLI 自己的报告」）────────────────────────────────
/** 夹具的 fake kind driver：**两个角色都能当**——anchor 经 `import` 调它的 `main(argv)`（同真实 kind
 *  一条码路），legacy supervisor 则以子进程形态 spawn 同一个文件（直接入口跑 main）。
 *  ⛔ 与 plugin/test/driver-anchor.test.mjs 的同名夹具同源；本文件不能 import 该文件（任务 ## Touches
 *  只含 driver-runtime.ts / 本文件 / 任务体），故此处镜像一份最小实现，⛔ 不引入第二种驱动语义。
 *
 *  ⚠️ 它 import 的**必须**是 anchor 进程实际加载的那一份 runtime（`preferredAnchorKernel()` 解析出的
 *  兄弟文件，通常 = **主检出**那份），⛔ 不是本文件的 `KERNEL`：`registerKindStop` / `requestKindStop`
 *  的停机登记表是**模块级**的，import 另一份 = 两张登记表 ⇒ `requestKindStop(kind)` 置的不是本夹具
 *  读的那个标志 ⇒ 该 kind 永远收不了尾（等满 stop 窗口）。实测对照见 driver-anchor.test.mjs 的头注释
 *  （同一棵树只改这一行 import：60543ms/exit 1 ↔ 1099ms/exit 0）。 */


/** 直跑内核（`quay driver` 的真正实现入口；cli/driver.ts 是薄壳）。与上面的 `run()` 的唯一差别是
 *  **不**钉 `QUAY_DRIVER_LEGACY_SUPERVISOR=1` —— 本组的判别正是「默认（anchor）路径」。 */

/** 从旧 supervisor 自己的日志里取它 spawn 的 driver pid（⛔ 不用 `.quay/<k>.pid`：本夹具里 anchor
 *  托管的同一个 kind 也在写那张文件 ⇒ 它是两个写者的竞争产物，读它无法归属）。 */


test("AC4/AC5 — 真进程端到端（legacy→anchor）：一个真的 standalone supervisor+driver pair，其 supervisor 载体已被上一次 anchor 路径的 stop 删掉（生产残形）⇒ restart 把它俩都停掉（kill -0 直接量）并交回 anchor", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "dr-mig-e2e-"));
  const scripts = path.join(root, "plugin", "scripts");
  fs.mkdirSync(scripts, { recursive: true });
  fs.mkdirSync(path.join(root, ".quay"), { recursive: true });
  for (const k of ["worker", "goal"]) fs.writeFileSync(path.join(scripts, DRIVER_KINDS[k].driver), fakeKindDriverSource(k), "utf8");

  const inFlight = spawnIdleProc(); // 扮演 worker 的在飞子进程（独立 OS 进程，⛔ 任何分支都不该被信号）
  fs.writeFileSync(statePaths(root, "worker").inflightPidFile, `${inFlight}\n`, "utf8");
  let anchorPid = null, legacySup = null, legacyDriver = null;
  t.after(() => {
    killProcs([legacySup, legacyDriver, anchorPid, inFlight]);
    // 兜底：进程组（supervisor 是 detached ⇒ 自己是组长；`killProcessGroupOf` 会先实测 pgid）。
    killProcessGroupOf(readPid(root, "goal-driver-supervisor"));
    killProcessGroupOf(readPid(root, "anchor"));
    rmRoots([root]);
  });

  // ① **真的** legacy supervisor+driver pair（`QUAY_DRIVER_LEGACY_SUPERVISOR=1` 是阶段 C 的显式回退
  //    开关 ⇒ 这条命令真的起出旧形态的两个进程；`goal` 与生产复现同 kind，pidSelf=true）。
  const l1 = kernelRun(["start", "--kind", "goal", "--root", root, "--restart-delay", "1", "--run-id", "mig-legacy"], root, { QUAY_DRIVER_LEGACY_SUPERVISOR: "1" });
  assert.equal(l1.status, 0, `legacy start goal: ${l1.stdout}\n${l1.stderr}`);
  legacySup = Number(readPid(root, "goal-driver-supervisor.pid"));
  legacyDriver = lastSupervisorDriverPid(root, "goal");
  assert.equal(pidAlive(legacySup), true, "旧 supervisor 活着（OS 直接量）");
  assert.ok(legacyDriver !== null && pidAlive(legacyDriver), `旧 driver 活着（取自 supervisor 自己的日志）：${legacyDriver}`);

  // ② 真 anchor 起 worker 的常驻循环（⇒ `.quay/anchor-desired.json` 存在 = 「已有 kind 迁移过」这个
  //    让 `anchorOwns` 回落规则生效的全局事实；worker 同时用来证明停一个 kind 不波及其余）。
  const a1 = kernelRun(["start", "--kind", "worker", "--root", root, "--confirm-timeout", "20"], root);
  assert.equal(a1.status, 0, `anchor start worker: ${a1.stdout}\n${a1.stderr}`);
  anchorPid = Number(readPid(root, "anchor.pid"));
  assert.equal(pidAlive(anchorPid), true, "真 anchor 活着（OS 直接量）");

  // ③ 做出生产残形：`.quay/goal-driver-supervisor.pid` **不存在**，而旧 supervisor+driver 都活着。
  //    这正是修复前 `stopKindViaAnchor` 会留下的形状（它只 rm 两张载体、不发信号），也正是生产里
  //    `goal` 的旧进程 8 分钟以上无人可杀的直接原因 —— 盘上只剩 driver 一张载体能指认它们。
  fs.rmSync(path.join(root, ".quay", "goal-driver-supervisor.pid"), { force: true });
  assert.equal(fs.existsSync(path.join(root, ".quay", "goal-driver-supervisor.pid")), false, "前提：supervisor 载体已不在");
  assert.equal(pidAlive(legacySup), true, "前提：旧 supervisor 仍然活着（载体没了，进程还在）");
  assert.equal(anchorHosts(root, "goal").hosted, false, "前提：anchor 尚未托管 goal ⇒ 本案例走 legacy 路径（修复前会误判成 anchor 所有）");

  // ④ legacy→anchor 的 **restart**：修复前 `anchorOwns` 读「有期望态文件 ∧ 没有活 supervisor 载体」
  //    ⇒ 判为 anchor 所有 ⇒ 走 anchor 路径 ⇒ 只删载体 ⇒ 旧 pair 活下来且从此盘上不可见。
  const out = [], err = [];
  const rc = await restartKind(
    root,
    "goal",
    { restartDelaySecs: 1, confirmTimeoutSecs: 20, legacyGraceMs: 2500, legacyKillWaitMs: 500, stopTimeoutMs: 20_000 },
    (s) => out.push(s.trim()),
    (s) => err.push(s.trim()),
  );

  // ⑤ 直接量：OS 级 pid 检查（⛔ 不是读命令自己的报告）。
  assert.equal(pidAlive(legacyDriver), false, `旧 driver 必须真的退出（kill -0 直接量）。stdout=${out.join("|")} stderr=${err.join("|")}`);
  assert.equal(pidAlive(legacySup), false, "旧 supervisor 必须真的退出 —— 它的载体已被删（只能靠 stop sentinel + child 退出这条机制收掉）");
  assert.equal(rc, 0, `旧 pair 停干净且该 kind 已交回 anchor ⇒ restart 成功：${out.join("|")} ${err.join("|")}`);
  assert.ok(out.some((l) => l.startsWith("started:")), `新循环必须被确认就绪：${out.join("|")}`);
  assert.equal(anchorHosts(root, "goal").hosted, true, "收敛直接量：goal 现在由 anchor 承载（legacy→anchor 真的完成了）");
  // 反向对照（证明上面的「已死」不是空转）：anchor 与在飞子进程都还活着。
  assert.equal(pidAlive(anchorPid), true, "对照：anchor 未被信号（⛔ 不是「把该杀的一起杀了」）");
  assert.equal(pidAlive(inFlight), true, "AC5 判别：worker 的在飞子进程活过 legacy→anchor 的整条 restart 路径");
  assert.equal(anchorHosts(root, "worker").hosted, true, "AC6 对照：其余 kind（worker）的循环不受影响（§6.9 不变式 2）");
});

// ── 硬规则 5b：同一个缺陷类在同一载体里的**其它命中**（不是「修好被报出来的那一个」就完事）────────────
//
// 扫描动作与结果（本轮实测，命令：`grep -n "process.kill(\|rmSync(st\." plugin/scripts/driver-runtime.ts`）：
//   · 发信号的位点 7 处 ⇒ 与本缺陷同族（「杀完不验证 / 杀不掉就把记录删掉」）的 **3 处**：
//     ① `stopKind` legacy 分支（被报出来的那个，已重写为 `stopLegacyPair`）；
//     ② `startKind` legacy 分支的**孤儿清理**（下面这条用例）；
//     ③ `stopKindViaAnchor` 里 anchor 自身的 SIGTERM/SIGKILL 收尾（已把它的 `anchor.pid` 摘除改成
//        `rmCarrierUnlessForeignLive`，见那一行的注释）。
//   其余 4 处是纯读数（`pidAlive` 的 `kill(pid,0)`）或本修复自身。

test("5b 同族②（start 路径的孤儿清理）— 无活 supervisor 而旧 driver 还在：必须**验证**它真的退出（旧实现：一个 SIGTERM + 等 1s + ⛔ 不验证 + 无条件删三张载体）", (t) => {
  const root = makeRoot("orphan");
  const st = statePaths(root, "promotion");
  fs.mkdirSync(path.join(root, ".quay"), { recursive: true });
  const orphan = spawnOrphanProc();
  fs.writeFileSync(st.driverPidFile, `${orphan}\n`, "utf8");
  t.after(() => {
    // 顺序与 teardownLiveDriver 逐字相同（① 走机制路径 stop → ② 进程组兜底 → ③ 最后删 root）。
    try { run(["stop", "--root", root], { timeout: 20000 }); } catch { /* ① 抛错也要走到 ③ */ }
    try {
      killProcessGroupOf(readPid(root, "promotion-driver-supervisor.pid"));
      killProcessGroupOf(readPid(root, "promotion-driver.pid"));
      killProcs([orphan]);
    } finally { rmRoots([root]); }
  });

  const r = run(["start", "--root", root, "--restart-delay", "1", "--run-id", "dr-orphan"], { pluginRoot: path.join(root, "plugin") });
  assert.equal(r.status, 0, `start 必须成功：${r.stdout}\n${r.stderr}`);
  assert.match(r.stderr, /orphan legacy pair pid=\[/, `清掉的孤儿必须被如实报出：${r.stderr}`);
  assert.equal(pidAlive(orphan), false, "孤儿 driver 必须**真的**退出（⛔ 不是「发了信号就当它死了」——旧实现在这里只等 1s 就直接删载体）");
  assert.ok(readPid(root, "promotion-driver-supervisor.pid") !== "", "新 supervisor 起来了（对照：清理没有把正常启动也挡掉）");
});
