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

// SPLIT from driver-runtime.test.mjs by gap-suite-split-15-over-30s-test-files — shard 10/10 (4 tests). Shared fixtures: ./helpers/driver-runtime-harness.mjs (single source).

import { test } from "node:test";
import { DRIVER_KINDS, DRIVER_RUNTIME_ABS, KERNEL, aliveness, anchorHosts, assert, fakeKindDriverSource, fs, kernelRun, killProcessGroupOf, killProcs, lastSupervisorDriverPid, makeRoot, migrationFixture, os, path, pidAlive, preferredAnchorKernel, promotion, readAnchorState, readDesired, readPid, restartKind, rmRoots, run, spawn, spawnIdleProc, spawnOrphanProc, statePaths, stopKind, stopLegacyPair, teardownLiveDriver, worker } from "./helpers/driver-runtime-harness.mjs";
// 新判据（循环代次）直接从 runtime 取——harness 的导出面不在本任务 ## Touches 里 ⇒ ⛔ 不为取两个符号
// 去改共享夹具（那会让「一处改动」变成两个文件的漂移面）。同一模块实例，⛔ 不是第二份实现。
import { anchorLoopStoppedSince, readAnchorLoopDelta, readAnchorLoopLifecycle } from "../scripts/driver-runtime.ts";

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
  // ⛔ 最关键的一条：start 必须**没有**跑过。直接量 = start 那条路自己打的行（`started:` /
  // `already-running:` / `start-pending:`）在 out 里一条都没有（它们是 start 路径的**产物**，⛔ 不是
  // 「它没跑」的另一种说法）。
  // ⚠️ 这里原本用「kind 是否被加进 anchor 期望态」当代理量。gap-per-kind-stop-is-in-memory-and-never-
  // crosses-dist-bundles 之后它对 `restart` **不再成立**：中止路径刻意把 kind 放回期望态（`restart`
  // 的意图是「X 应该在跑」，中止 ⇒ 旧循环**仍在跑** ⇒ 期望态与事实一致；见 `stopKindViaAnchor` 的
  // `stillRunning` 支）。代理量死在「期望态不再只由 start 写」这一点上，判据换回直接量（硬规则 4b）。
  assert.equal(out.some((l) => /^(started|already-running|start-pending)\b/.test(l)), false, `⛔ start 不得跑过：${out.join("|")}`);
  assert.equal(readDesired(f.root).kinds.includes("worker"), true, "restart 中止 ⇒ worker 放回期望态（旧循环仍在跑，期望态须与事实一致）");
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

// ── gap-driver-stop-kind-worker-message-does-not-name-drain-or-takeover-handoff ────────────────────
//
// 现场（2026-10-13，本机，逐字见任务体）：`stop --kind worker` / `restart --kind worker` 两次各等满
// 60s 才拒绝，`anchor-desired.json` 已排除 worker 之后循环仍续跑 90+ 分钟。成因不是超时太短：worker 的
// `invoke()` 自己就是常驻派发环，只要有 ready 活就**不会**返回给 anchor 的停机检查点（promotion/outer/
// goal 的 `invoke()` 是短机械周期、所以 ~1s 内生效）。⇒ 对 worker 而言「核对 pid 后重跑」是一个
// **结构上永不成立**的建议；这条判据守的就是消息必须点名真实成因 + 可执行的 `drain` 替代。

/** 负控制（AC1）：**改前**那条 `stop-failed` 消息的原文（逐字抄自
 *  `git show develop:plugin/scripts/driver-runtime.ts` 第 4053 行的字面量；kind/anchor pid 取本用例的
 *  实际取值）。⛔ 不含 `drain`、⛔ 不含 `常驻` —— 缺口就是它。断言「新消息含这些词 ∧ 旧原文不含」，
 *  两半都在 ⇒ 断言不是空转（硬规则 4：一个结构上不可能取假的量不是测量）。 */
const PRE_FIX_WORKER_STOP_FAILED =
  "stop-failed: kind=worker — 该 kind 的循环在 60000ms 内未收尾（anchor pid=none）。" +
  "⛔ 本条**不报成 not-running**：循环仍在 ⇒ 接着 start 会得到两份 loop（双派发）。锚日志尾:";

test("AC1 — kind=worker 的 stop-failed / restart-aborted 必须点名真实成因（常驻循环，重试结构上无效）与 `drain` 替代（负控制：改前消息两个词都没有）", async (t) => {
  // 夹具 anchor 声称托管 worker，而该 kind 的「循环」是一个不跑循环的常驻 idle 进程 ⇒ 永远不收尾。
  // 这正是「resident loop 总有 ready 活」的形状（循环不把控制权交回），也是生产里那条 60s 拒绝的形态。
  const f = migrationFixture("worker-stop-msg", { supervisorCarrier: false, anchorNamesWorker: true });
  const f2 = migrationFixture("worker-restart-msg", { supervisorCarrier: false, anchorNamesWorker: true });
  t.after(() => {
    killProcs([f.supPid, f.drvPid, f.anchorPid, f.inFlightPid, f2.supPid, f2.drvPid, f2.anchorPid, f2.inFlightPid]);
    rmRoots([f.root, f2.root]);
  });

  // 负控制的前半：改前的原文确实两个词都没有（否则下面的断言可能是空转）。
  assert.equal(PRE_FIX_WORKER_STOP_FAILED.includes("drain"), false, "负控制：改前消息不含 `drain`");
  assert.equal(PRE_FIX_WORKER_STOP_FAILED.includes("常驻"), false, "负控制：改前消息不含 `常驻`（成因也没被点名）");

  // ① `stop --kind worker`：超时窗口压到 800ms（测试缝，⛔ 不改生产节奏），判别的是**消息**。
  //    ⚠️ `stopKindViaAnchor` 把 `stop-failed` 直接写 `process.stderr`（⛔ 不走 out 回调）⇒ 必须就地
  //    捕获 stderr；这正是本用例要判的那条输出，⛔ 不能用「命令自己的报告」替代。
  const out = [], err = [];
  const origErrWrite = process.stderr.write;
  process.stderr.write = (c) => { err.push(String(c)); return true; };
  let rc;
  try {
    rc = await stopKind(f.root, "worker", (s) => out.push(s.trim()), { stopTimeoutMs: 800, anchorExitMs: 300 });
  } finally {
    process.stderr.write = origErrWrite;
  }
  assert.equal(rc, 1, `循环不收尾 ⇒ stop 必须报失败（⛔ 不得报成 stopped）：${out.join("|")} ${err.join("|")}`);
  const stopMsg = err.join("\n");
  assert.ok(stopMsg.includes("stop-failed: kind=worker"), `stop-failed 行本身必须还在（⛔ 不是换掉旧判据）：${stopMsg}`);
  assert.ok(stopMsg.includes("常驻循环"), `AC1：必须点名真实成因（worker 是常驻循环，不是超时太短）：${stopMsg}`);
  assert.ok(stopMsg.includes("结构上不可能"), `AC1：必须说明重试对 worker 结构上无效：${stopMsg}`);
  assert.ok(stopMsg.includes("quay driver drain --kind worker"), `AC1：必须点名可执行的替代 \`drain\`：${stopMsg}`);
  assert.ok(stopMsg.includes("takeoverPid"), `AC2 联动：不停机换内核的配方入口也必须在这里可见：${stopMsg}`);

  // ② `restart --kind worker`：同样的成因 + 替代（共用同一份 note，⛔ 不各写一份）。
  const rOut = [], rErr = [];
  const rrc = await restartKind(
    f2.root,
    "worker",
    { restartDelaySecs: 1, confirmTimeoutSecs: 1, legacyGraceMs: 500, legacyKillWaitMs: 200, stopTimeoutMs: 800, anchorExitMs: 300 },
    (s) => rOut.push(s.trim()),
    (s) => rErr.push(s.trim()),
  );
  assert.equal(rrc, 1, `stop 未确认干净 ⇒ restart 必须中止（⛔ 不起第二份 loop）：${rOut.join("|")} ${rErr.join("|")}`);
  const restartMsg = rErr.join("\n");
  assert.ok(restartMsg.includes("restart-aborted: kind=worker"), `restart-aborted 行本身必须还在：${restartMsg}`);
  assert.ok(restartMsg.includes("常驻循环") && restartMsg.includes("quay driver drain --kind worker"), `AC1：restart 路径也必须点名成因 + \`drain\`：${restartMsg}`);
  // 对照：⛔ 没有起第二份 loop。直接量与上面同一条（start 路径自己的输出），v2：旧的「不在期望态」
  // 代理量已被 restart 中止路径的期望态恢复取代，见上面 AC2(c) 的注释。
  assert.equal(rOut.some((l) => /^(started|already-running|start-pending)\b/.test(l)), false, `对照：restart 中止 ⇒ ⛔ 没有起新循环：${rOut.join("|")}`);

  // 反向对照（证明上面的失败不是空转）：在飞子进程活过整条路径。
  assert.equal(pidAlive(f.inFlightPid), true, "AC5 对照：在飞子进程未被信号");
  assert.equal(pidAlive(f2.inFlightPid), true, "AC5 对照：在飞子进程未被信号");
});

// ══════════════════════════════════════════════════════════════════════════════════════════════════
// gap-anchor-hosted-restart-false-negative-stop-confirm-lag-restore-respawns
//
// 现场（2026-10-20 第三方项目实测，完整材料在任务体 Proposal）：`quay driver restart --kind quality`
// 输出 `stop-failed` + `restart-aborted`（exit 1），而**同一份** `.quay/anchor.log` 记录
// `kind=quality loop stopped`（06:27:52Z）→ `loop started`（06:28:08Z），随后 quality-round.jsonl
// round 1..4 持续；同刻 `quay driver start --kind quality` 报 `already-running`。
// 机制：收敛形态下 `aliveness(root,kind).running` 读的是**承载进程（anchor）**的活性（六个 kind 共享
// 一个进程）⇒ 该 kind 的循环收尾/重起在它上面不可见；而 restart 中止路径的 restore-desired 又把 kind
// 放回期望态 ⇒ anchor 在旧循环收尾后立刻拉起新一代。CLI 报告与真实结局相反。
//
// 判据分层（逐条可取假）：
//   AC1 同一载体上**旧判据 vs 新判据**：事故形状的盘上载体里，`aliveness().running` 仍为 true，
//       而 `anchorLoopStoppedSince` 报 stopped、代次 1→2（旧判据看不见 = 假阴性的成因）。
//   AC2 真 anchor + 真 kind 循环：stop 窗口用尽、旧循环随后收尾、restore 拉起新一代 ⇒ CLI 必须报
//       `restarted-loop` + `generation 1 -> 2` + `process unchanged`，退出 0（⛔ 不得报 restart-aborted）。
//   AC3 位置判定 + 负控制：改后源码里旧判据的 wait 调用点清零、新判据在位；同一谓词对**改前原文**
//       命中（证明谓词可判，⛔ 不是恒零）。
//   AC4 输出词表（枚举，非布尔）：`restarted-loop`（process unchanged，带 before/after generation）
//       与 `restart-aborted` 两态可区分；对「已知为真」的样本干跑非零。
//   AC5 双向负控制：循环**不响应**停机（真的没重起）⇒ 仍如实报 restart-aborted，代次不变。

const RESTART_REPO_ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..", "..");

/** 事故的盘上形状（AC1）：anchor 承载 quality，日志里出现「旧代 stopped → 新代 started」。
 *  `pre` 是在旧代**还在跑**时取的那一份快照（只含第一行 `loop started`）。 */
function anchorHostedQualityRoot(tag) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `dr-incident-${tag}-`));
  fs.mkdirSync(path.join(root, ".quay"), { recursive: true });
  const anchorPid = spawnIdleProc();
  const st = statePaths(root, "quality");
  fs.writeFileSync(st.driverPidFile, `${anchorPid}\n`, "utf8");
  fs.writeFileSync(path.join(root, ".quay", "anchor.pid"), `${anchorPid}\n`, "utf8");
  fs.writeFileSync(path.join(root, ".quay", "anchor.json"), JSON.stringify({ pid: anchorPid, startedAt: new Date().toISOString(), kinds: ["quality"], host: "anchor" }), "utf8");
  fs.writeFileSync(path.join(root, ".quay", "anchor-desired.json"), JSON.stringify({ kinds: ["quality"], opts: {}, updatedBy: "quay-driver-start", updatedAt: new Date().toISOString() }), "utf8");
  const log = path.join(root, ".quay", "anchor.log");
  fs.writeFileSync(log, `2026-10-20T06:20:00Z anchor: kind=quality loop started (pid=${anchorPid})\n`, "utf8");
  return { root, anchorPid, log };
}

function incidentShapeFixture(tag) {
  const f = anchorHostedQualityRoot(tag);
  const pre = readAnchorLoopLifecycle(f.root, "quality");
  fs.appendFileSync(f.log, [
    `2026-10-20T06:27:52Z anchor: kind=quality loop returned code=0 after 498224423ms`,
    `2026-10-20T06:27:52Z anchor: kind=quality loop stopped`,
    `2026-10-20T06:28:08Z anchor: kind=quality loop started (pid=${f.anchorPid})`,
    ``,
  ].join("\n"), "utf8");
  return { ...f, pre };
}

test("AC1 — 事故形状的同一份盘上载体：旧判据 aliveness().running 仍为 true，新判据（循环代次）报 stopped（假阴性的直接成因）", (t) => {
  const f = incidentShapeFixture("contrast");
  t.after(() => { killProcs([f.anchorPid]); rmRoots([f.root]); });

  // 旧判据：收敛形态下它读的是**anchor 进程**（还活着）⇒ 「在跑」——即便该 kind 的循环已经换了一代。
  assert.equal(aliveness(f.root, "quality").running, true,
    "前提：旧判据在此形状下为 true（这正是 CLI 当年报 stop-failed / restart-aborted 的原因）");
  // 新判据：同一份日志的增量里出现 stopped / 新一代 started ⇒ 旧代次已收尾。
  assert.equal(anchorLoopStoppedSince(f.root, "quality", f.pre), "stopped",
    "新判据必须看得见旧代次已收尾（否则它只是旧判据的别名）");
  const post = readAnchorLoopLifecycle(f.root, "quality");
  assert.equal(post.evaluated, true);
  assert.equal(f.pre.generation, 1, "停机前代次");
  assert.equal(post.generation, 2, "新一代出现后代次 +1（AC4 的 before/after 读数）");
  // 枚举而不是布尔：最后一件是 `started` ⇒ `restarted`（旧代次已收尾 ∧ 新一代在跑），
  // ⛔ 不与 `stopped`（此刻没有循环）同形——`stop` 与 `restart` 对这一态的解释不同（见 driver-runtime）。
  assert.equal(readAnchorLoopDelta(f.root, "quality", f.pre).state, "restarted",
    "增量读数必须区分「已收尾且新一代在跑」与「此刻没有循环」");

  // 双向负控制：同一谓词对「增量里只有 returned、没有 stopped/新代」必须报 running（⛔ 不是恒 stopped）。
  const running = anchorHostedQualityRoot("returned-only");
  t.after(() => { killProcs([running.anchorPid]); rmRoots([running.root]); });
  const runningPre = readAnchorLoopLifecycle(running.root, "quality");
  fs.appendFileSync(running.log, `2026-10-20T06:30:00Z anchor: kind=quality loop returned code=0 after 1000ms\n`, "utf8");
  assert.equal(anchorLoopStoppedSince(running.root, "quality", runningPre), "running",
    "负控制：只有 returned（anchor 可 respawn）⛔ 不等于已停止");
});

// ── AC2 / AC5：真 anchor、真 kind 循环（⛔ 不是「CLI 自己的报告」）────────────────────────────────

/** fake driver = driver-anchor.test.mjs 的同源最小实现 + 一个**可控的收尾延迟**：
 *  · `FAKE_STOP_DELAY_MS`：收到停机请求后还要多久才把控制权交回 anchor（模拟在飞长轮）；
 *  · `FAKE_IGNORE_STOP=1`：永不收尾（AC5 的真实负控制）。
 *  ⚠️ import 的必须是 anchor 进程实际加载的那份 runtime（`DRIVER_RUNTIME_ABS`，通常 = 主检出那份）：
 *     停机登记表是模块级的，import 另一份 ⇒ 两张表 ⇒ `requestKindStop` 永远到不了这个循环。 */
function restartFixtureDriverSource(kind, opts = {}) {
  const spec = DRIVER_KINDS[kind];
  const carrier = spec.carriers.find((c) => c.endsWith("-round.jsonl")) ?? spec.carriers[0];
  return `import fs from "node:fs";
import path from "node:path";
import { registerKindStop } from ${JSON.stringify(DRIVER_RUNTIME_ABS)};
export async function main(argv) {
  const args = argv.slice(2);
  const get = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };
  const root = get("--root");
  const pidFile = get("--pid-file");
  const interval = Number(get("--interval") ?? 120);
  if (pidFile) fs.writeFileSync(pidFile, String(process.pid) + "\\n", "utf8");
  const ctl = ${opts.neverStop ? "null" : `registerKindStop(${JSON.stringify(kind)})`};
  const file = path.join(root, ".quay", ${JSON.stringify(carrier)});
  const ignoreStop = process.env.FAKE_IGNORE_STOP === "1";
  const delayMs = Number(process.env.FAKE_STOP_DELAY_MS ?? 0);
  let round = 0;
  while (ignoreStop || (ctl !== null && !ctl.requested())) {
    round += 1;
    try { fs.appendFileSync(file, JSON.stringify({ round, ts: new Date().toISOString(), pid: process.pid }) + "\\n"); } catch {}
    await new Promise((r) => setTimeout(r, interval));
  }
  // 停机请求已送达，但循环还要 delayMs 才真正收尾（在飞长轮的形状）。
  if (delayMs > 0) await new Promise((r) => setTimeout(r, delayMs));
  return 0;
}
`;
}

/** 真 anchor + quality（可延迟收尾）+ promotion（常驻，用来让 anchor 在停掉 quality 之后**不退出**：
 *  事故里 anchor 进程全程不变——只有单 kind 时 stopKindViaAnchor 会把空期望态的 anchor 也停掉，
 *  那是另一条路径，测不到本条）。 */
function makeAnchorRestartFixture(tag, { honorDelayMs, ignoreStop }) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `dr-anchor-restart-${tag}-`));
  const scripts = path.join(root, "plugin", "scripts");
  fs.mkdirSync(scripts, { recursive: true });
  fs.mkdirSync(path.join(root, ".quay"), { recursive: true });
  fs.writeFileSync(path.join(scripts, DRIVER_KINDS.quality.driver), restartFixtureDriverSource("quality"), "utf8");
  fs.writeFileSync(path.join(scripts, DRIVER_KINDS.promotion.driver), restartFixtureDriverSource("promotion", { neverStop: true }), "utf8");
  const env = { FAKE_STOP_DELAY_MS: String(honorDelayMs), ...(ignoreStop ? { FAKE_IGNORE_STOP: "1" } : {}) };
  const started = [];
  for (const kind of ["quality", "promotion"]) {
    const r = kernelRun(["start", "--kind", kind, "--root", root, "--confirm-timeout", "20"], root, env);
    started.push(r);
  }
  return { root, env, started };
}

function anchorPidOfHost(root) {
  const raw = readPid(root, "anchor.pid");
  return /^\d+$/.test(raw) ? Number(raw) : null;
}

test("AC2 — anchor 承载 kind 的 stop 窗口用尽后旧循环才收尾、restore 拉起新一代 ⇒ CLI 必须报 restarted-loop（generation before -> after），退出 0", async (t) => {
  const f = makeAnchorRestartFixture("late", { honorDelayMs: 2500, ignoreStop: false });
  const anchorPid = anchorPidOfHost(f.root);
  t.after(() => { killProcs([anchorPid]); rmRoots([f.root]); });
  assert.equal(f.started[0].status, 0, `quality start: ${f.started[0].stdout}\n${f.started[0].stderr}`);
  assert.equal(f.started[1].status, 0, `promotion start: ${f.started[1].stdout}\n${f.started[1].stderr}`);

  const pre = readAnchorLoopLifecycle(f.root, "quality");
  assert.equal(pre.evaluated, true, "anchor.log 必须可读（夹具前提）");
  assert.equal(pre.generation, 1, `前提：quality 已有一代循环：${JSON.stringify(pre)}`);

  const out = [], err = [];
  const rc = await restartKind(
    f.root,
    "quality",
    // stop 窗口 800ms < 收尾延迟 2500ms ⇒ 复现事故：窗口用尽时旧循环仍在跑。
    { restartDelaySecs: 1, confirmTimeoutSecs: 10, stopTimeoutMs: 800 },
    (s) => out.push(s.trim()),
    (s) => err.push(s.trim()),
  );
  assert.equal(rc, 0, `loop 实际已重起 ⇒ 退出码必须是 0（⛔ 不得重启没发生）：out=${out.join("|")} err=${err.join("|")}`);
  const outcome = out.find((l) => l.startsWith("restarted-loop:"));
  assert.ok(outcome, `必须报出 restarted-loop（真实结局）：${out.join("|")} ${err.join("|")}`);
  assert.match(outcome, /process unchanged/, `必须说明 anchor 进程未变：${outcome}`);
  assert.match(outcome, new RegExp(`loop generation ${pre.generation} -> ${pre.generation + 1}`), `必须带 before/after 代次：${outcome}`);
  assert.equal(err.some((l) => l.startsWith("restart-aborted:")), false, `⛔ 已重起不得报成 restart-aborted：${err.join("|")}`);

  // 直接量（⛔ 不是命令自己的报告）：同一个 anchor 进程里，日志写出了 stopped → 新一代 started。
  const post = readAnchorLoopLifecycle(f.root, "quality");
  assert.equal(post.evaluated, true);
  assert.equal(post.generation, pre.generation + 1, `代次必须恰好 +1（⛔ 不得双派发）：${JSON.stringify(post)}`);
  assert.equal(anchorPidOfHost(f.root), anchorPid, "process unchanged：anchor pid 前后一致");
  assert.equal(pidAlive(anchorPid), true, "对照：anchor 仍活着");
  const qualityLines = fs.readFileSync(path.join(f.root, ".quay", "anchor.log"), "utf8").split("\n").filter((l) => l.includes("kind=quality"));
  const stoppedIdx = qualityLines.findIndex((l) => l.includes("loop stopped"));
  const lastStartedIdx = qualityLines.map((l) => l.includes("loop started")).lastIndexOf(true);
  assert.ok(stoppedIdx >= 0 && lastStartedIdx > stoppedIdx, `旧代 stopped 必须早于新一代 started：${qualityLines.join("\n")}`);

  // 事故里的第三个读数：同刻 `quay driver start --kind quality` 报 already-running。
  const again = kernelRun(["start", "--kind", "quality", "--root", f.root, "--confirm-timeout", "10"], f.root, f.env);
  assert.equal(again.status, 0, `重起后 start 必须幂等成功：${again.stdout}\n${again.stderr}`);
  assert.match(again.stdout, /already-running/, `事故读数：start 应报 already-running：${again.stdout}`);
});

test("AC5 — 双向负控制：循环**不响应**停机（真的没重起）⇒ 仍如实报 restart-aborted，代次不变、⛔ 不得误报 restarted-loop", async (t) => {
  const f = makeAnchorRestartFixture("ignore", { honorDelayMs: 0, ignoreStop: true });
  const anchorPid = anchorPidOfHost(f.root);
  t.after(() => { killProcs([anchorPid]); rmRoots([f.root]); });
  assert.equal(f.started[0].status, 0, `quality start: ${f.started[0].stdout}\n${f.started[0].stderr}`);
  assert.equal(f.started[1].status, 0, `promotion start: ${f.started[1].stdout}\n${f.started[1].stderr}`);

  const pre = readAnchorLoopLifecycle(f.root, "quality");
  assert.equal(pre.generation, 1, `前提：quality 已有一代循环：${JSON.stringify(pre)}`);

  const out = [], err = [];
  const rc = await restartKind(
    f.root,
    "quality",
    { restartDelaySecs: 1, confirmTimeoutSecs: 2, stopTimeoutMs: 600 },
    (s) => out.push(s.trim()),
    (s) => err.push(s.trim()),
  );
  assert.equal(rc, 1, `循环不收尾 ⇒ restart 必须中止：out=${out.join("|")} err=${err.join("|")}`);
  assert.ok(err.some((l) => l.startsWith("restart-aborted:")), `必须如实报 restart-aborted：${err.join("|")}`);
  assert.equal(out.some((l) => l.startsWith("restarted-loop:")), false, `⛔ 没重起不得报 restarted-loop：${out.join("|")}`);
  const post = readAnchorLoopLifecycle(f.root, "quality");
  assert.equal(post.evaluated, true);
  assert.equal(post.generation, pre.generation, `代次必须不变（⛔ 不得把中止报成重起）：${JSON.stringify(post)}`);
  assert.equal(pidAlive(anchorPid), true, "对照：anchor 未被信号（只停那一个 kind 的尝试）");
});

// ── AC3 / AC4：位置判定 + 输出词表（源码级，⛔ 不是「读起来像」）──────────────────────────────────

/** **改前** stop 等待循环的原文（逐字抄自改动前的 develop：`stopKindViaAnchor` 内
 *  `(driver-runtime.ts:4576-4580)`）。AC3 的负控制靠它证明「谓词可判」——⛔ 不是恒零。 */
const PRE_FIX_STOP_WAIT = [
  "  const deadline = Date.now() + stopTimeoutMs;",
  "  while (Date.now() < deadline) {",
  "    if (!aliveness(root, kind).running) break;",
  "    await sleep(250);",
  "  }",
  "  const stillRunning = aliveness(root, kind).running;",
].join("\n");

test("AC3 — 位置判定：改后 anchor-hosted stop 的确认判据不再**只**依赖旧 aliveness（新判据在位 ∧ 旧调用点清零）；负控制：同一谓词对改前原文命中", () => {
  const src = fs.readFileSync(path.join(RESTART_REPO_ROOT, "plugin", "scripts", "driver-runtime.ts"), "utf8");
  // 谓词 = 「这个等待循环把旧 aliveness 当成**唯一**判据」。⛔ 不用关键词「aliveness」——它在文件里到处都有。
  const waitsOnlyOnOldAliveness = (s) => s.includes("if (!aliveness(root, kind).running) break;");
  assert.equal(waitsOnlyOnOldAliveness(PRE_FIX_STOP_WAIT), true,
    "负控制：谓词必须命中**改前原文**（证明它可判，⛔ 不是恒零）——否则「改后清零」是空转");
  assert.equal(waitsOnlyOnOldAliveness(src), false,
    "改后：旧判据的 wait 调用点必须清零（新判据接管，⛔ 不是把旧判据抄一遍）");
  assert.match(src, /readAnchorLoopDelta\(root, kind, lifecycleStart\)/,
    "改后：stop 的确认路径必须调用新判据 readAnchorLoopDelta（明写在位置判定的对象里）");
  assert.match(src, /export function anchorLoopStoppedSince\(/,
    "新判据的另一半（anchorLoopStoppedSince）必须仍在导出面里，⛔ 不是只在测试里存在");
  assert.match(src, /const loopStopped = \(\): boolean => \{[\s\S]*?readAnchorLoopDelta/,
    "新判据必须真的接在等待循环的判停函数上（⛔ 不是定义了没用）");
});

test("AC4 — 输出词表（枚举，非布尔）：restarted-loop（process unchanged + before/after generation）与 restart-aborted 两态可区分；已知为真样本干跑非零", () => {
  const src = fs.readFileSync(path.join(RESTART_REPO_ROOT, "plugin", "scripts", "driver-runtime.ts"), "utf8");
  assert.ok(src.includes("restarted-loop: kind="), "新词表 `restarted-loop` 必须在 CLI 输出面里");
  assert.ok(src.includes("restart-aborted: kind="), "旧词表 `restart-aborted` 必须保留（⛔ 不是换掉它）");
  assert.ok(src.includes("process unchanged"), "`restarted-loop` 必须携带「进程未变」这一半语义");
  assert.match(src, /loop generation \$\{pre\.generation\} -> \$\{/, "必须带 before/after 代次");

  // 「已知为真」样本干跑（硬规则 2 的零计数配套：谓词对真样本必须命中，⛔ 不是恒零）。
  const outcomeOf = (line) => {
    const m = /^(restarted-loop|restart-aborted): kind=(\S+)/.exec(line);
    return m === null ? null : { outcome: m[1], kind: m[2] };
  };
  assert.deepEqual(outcomeOf("restarted-loop: kind=quality — process unchanged (anchor pid=1); loop generation 1 -> 2"), { outcome: "restarted-loop", kind: "quality" });
  assert.deepEqual(outcomeOf("restart-aborted: kind=quality — stop 未确认旧进程树已退出（exit=1）"), { outcome: "restart-aborted", kind: "quality" });
  // 两态不同形（枚举的一半）：普通状态行不得被这个谓词读成结局。
  assert.equal(outcomeOf("stopped"), null, "⛔ 普通状态行不得与两种结局同形");
  assert.equal(outcomeOf("started: anchor pid=1 kind=quality"), null, "⛔ `started:` 不等于 `restarted-loop`");
  // 代次读数的取假半边：样本里必须是两个**不同**的数（⛔ 不是 `1 -> 1` 那种同形输出）。
  const gen = /loop generation (\d+) -> (\d+)/.exec("restarted-loop: kind=quality — process unchanged (anchor pid=1); loop generation 1 -> 2");
  assert.ok(gen !== null && Number(gen[1]) < Number(gen[2]), "before/after 必须真的前进");
});
