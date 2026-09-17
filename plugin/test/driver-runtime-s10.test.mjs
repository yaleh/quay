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
import { DRIVER_KINDS, KERNEL, anchorHosts, assert, fakeKindDriverSource, fs, kernelRun, killProcessGroupOf, killProcs, lastSupervisorDriverPid, makeRoot, migrationFixture, os, path, pidAlive, preferredAnchorKernel, promotion, readDesired, readPid, restartKind, rmRoots, run, spawn, spawnIdleProc, spawnOrphanProc, statePaths, stopKind, stopLegacyPair, teardownLiveDriver, worker } from "./helpers/driver-runtime-harness.mjs";

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
