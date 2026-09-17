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

// SPLIT from driver-runtime.test.mjs by gap-suite-split-15-over-30s-test-files — shard 6/10 (5 tests). Shared fixtures: ./helpers/driver-runtime-harness.mjs (single source).

import { test } from "node:test";
import { FAKE_DRIVER, SLOW_START_DRIVER, aliveness, assert, deadPid, fs, makeBareRoot, makeRoot, os, path, procStartTimeMs, promotion, readPid, resolveKernelSibling, run, sourceChangedSince, sourceFilesMaxMtimeMs, spawn, stopKind, supervisorStaleness, teardownLiveDriver, watchedSourceFiles } from "./helpers/driver-runtime-harness.mjs";

test("source-refresh — watchedSourceFiles / sourceFilesMaxMtimeMs / sourceChangedSince 纯函数可单测且取假", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "dr-src-fn-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const scripts = path.join(root, "plugin", "scripts");
  fs.mkdirSync(scripts, { recursive: true });
  const filtersFile = path.join(scripts, "driver-filters.ts");
  fs.writeFileSync(filtersFile, "v1", "utf8");
  // AC-203：sourceFilesMaxMtimeMs 锚在 kernel 自身安装位置（或 QUAY_PLUGIN_ROOT），⛔ 非 root 参数。
  const savedPluginRoot = process.env.QUAY_PLUGIN_ROOT;
  process.env.QUAY_PLUGIN_ROOT = path.join(root, "plugin");
  t.after(() => { if (savedPluginRoot === undefined) delete process.env.QUAY_PLUGIN_ROOT; else process.env.QUAY_PLUGIN_ROOT = savedPluginRoot; });

  // watched 集 = driver 自身入口 + 共享 Layer 0/1a 模块（含 driver-filters.ts——AC-184 的根）。
  const watched = watchedSourceFiles("promotion");
  assert.ok(watched.includes("promotion-driver.ts"), "driver 自身入口在监视集");
  assert.ok(watched.includes("driver-filters.ts"), "driver-filters.ts 在监视集");

  const m0 = sourceFilesMaxMtimeMs(root, "promotion");
  assert.ok(m0 > 0, "mtime 读自被写文件（⛔ 非恒真 0）");

  // 取假：since 取「未来」⇒ 不变更；since 取 0（过去）⇒ 变更。对照真读 mtime，⛔ 恒真/恒假。
  assert.equal(sourceChangedSince(root, "promotion", m0 + 1000), false, "源码不晚于 since ⇒ 不变更");
  assert.equal(sourceChangedSince(root, "promotion", 0), true, "源码晚于 epoch 0 ⇒ 变更");

  // 推进 mtime ⇒ max 增大（可观测非静默——⛔ 不是结构上恒真的量）。
  const later = new Date(m0 + 5000);
  fs.utimesSync(filtersFile, later, later);
  assert.ok(sourceFilesMaxMtimeMs(root, "promotion") > m0, "推进 mtime ⇒ max 增大");
});


test("source-refresh — supervisor respawns driver when driver-filters.ts advances past the running driver", async (t) => {
  const root = makeRoot("src-respawn");
  // driver-filters.ts 先于 driver 启动写入（mtime < driver 启动时刻），确保初始不触发 respawn。
  const filtersFile = path.join(root, "plugin", "scripts", "driver-filters.ts");
  fs.writeFileSync(filtersFile, "v1", "utf8");
  t.after(() => {
    run(["stop", "--root", root], { timeout: 15000 });
    fs.rmSync(root, { recursive: true, force: true });
  });

  const start = run(["start", "--root", root, "--restart-delay", "1", "--run-id", "dr-src-respawn"], { pluginRoot: path.join(root, "plugin") });
  assert.equal(start.status, 0, `start failed: ${start.stdout}\n${start.stderr}`);
  const p1 = readPid(root, "promotion-driver.pid");
  assert.ok(p1, "driver pid recorded");

  // 确保 driver 已运行 ≥150ms，使「重写 driver-filters.ts 的 mtime」严格晚于 driver 启动时刻；
  // 且 mtime 落在「现在」（⛔ 未来）——respawn 后的新 driver 启动时刻更晚，故不进入 respawn 死循环。
  await new Promise((r) => setTimeout(r, 150));
  fs.writeFileSync(filtersFile, "v2", "utf8");

  let p2 = p1;
  for (let i = 0; i < 80; i++) {
    p2 = readPid(root, "promotion-driver.pid");
    if (p2 && p2 !== p1) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  assert.notEqual(p2, p1, `driver pid changed (respawned) after driver-filters.ts advanced: ${p1} → ${p2}`);
});

// ── supervisor 陈旧判定（gap-supervisor-never-self-refreshes-no-detector）─────────────────────────
// sourceCheck（AC-184）杀的是 driver（child），从不包括 supervisor 自己：supervisor 常驻、内存 kernel 是
// 启动那一刻的版本。新增直接量 = supervisor 启动时刻 vs 被监视源码最新 mtime。判据取假（DoD）：
// 删掉 aliveness() 里 supervisorStaleness 的判定分支 ⇒ supervisorStale 恒 undefined ⇒ 下面的集成测试红。
// 三态：读不到启动时刻 ⇒ not-evaluated（⛔ 与「新鲜」同形，硬规则 3b）。


test("supervisor-stale — supervisorStaleness 三态：死 pid / 无 pid ⇒ not-evaluated；活 pid + 源码早于启动 ⇒ fresh", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "dr-supst-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  // 死 pid / 无 pid ⇒ not-evaluated（⛔ 不与 fresh 同形）。
  assert.equal(supervisorStaleness(root, "promotion", Number(deadPid())).state, "not-evaluated");
  assert.equal(supervisorStaleness(root, "promotion", null).state, "not-evaluated");

  // 活 pid（自己）+ 空 root（无被监视源码 ⇒ mtime 0）⇒ fresh（源码不晚于启动时刻）。
  const fresh = supervisorStaleness(root, "promotion", process.pid);
  assert.equal(fresh.state, "fresh");
  assert.equal(typeof fresh.supervisorStartedAt, "number", "supervisorStartedAt 读得（epoch ms）");
  assert.ok(fresh.supervisorStartedAt > 0, "启动时刻非恒 0");

  // procStartTimeMs(自己) == 本测试进程【实际的】启动时刻（epoch ms）。
  // ⛔ 不写成 `start > Date.now() - 60_000`：那是一个「模块加载 → 走到这一行必须 <60s」的墙钟
  // 余量，并发负载下本文件耗时 139s（隔离 36s，实测 2026-09-13）⇒ 余量被负载击穿、与任何缺陷
  // 无关。基准改为 process.uptime()（同一进程的真实存活时长）⇒ 断言与文件跑多久完全解耦。
  const start = procStartTimeMs(process.pid);
  const expectedStart = Date.now() - process.uptime() * 1000;
  assert.ok(start != null && start <= Date.now(), `procStartTimeMs 合理（不晚于现在）: ${start}`);
  assert.ok(
    Math.abs(start - expectedStart) <= 10_000,
    `procStartTimeMs 等于本进程实际启动时刻: start=${start} expected≈${Math.round(expectedStart)}`,
  );
});


test("supervisor-stale — aliveness 报 supervisorStale=true 当被监视源码推进到 supervisor 启动时刻之后；重启后回 fresh（双向取假）", async (t) => {
  const root = makeRoot("sup-stale");
  // AC-203：aliveness 直接调用（同进程）经 sourceFilesMaxMtimeMs 读 kernel 自身安装位置（或
  // QUAY_PLUGIN_ROOT），⛔ 非 root 参数——本测直接 import 调用，故须在进程 env 上设 QUAY_PLUGIN_ROOT。
  const savedPluginRoot = process.env.QUAY_PLUGIN_ROOT;
  process.env.QUAY_PLUGIN_ROOT = path.join(root, "plugin");
  t.after(() => {
    run(["stop", "--root", root], { timeout: 15000 });
    fs.rmSync(root, { recursive: true, force: true });
    if (savedPluginRoot === undefined) delete process.env.QUAY_PLUGIN_ROOT; else process.env.QUAY_PLUGIN_ROOT = savedPluginRoot;
  });
  const start = run(["start", "--root", root, "--restart-delay", "1", "--run-id", "dr-sup-stale"], { pluginRoot: path.join(root, "plugin") });
  assert.equal(start.status, 0, `start failed: ${start.stdout}\n${start.stderr}`);
  assert.ok(readPid(root, "promotion-driver-supervisor.pid"), "supervisor pid recorded");

  // 初始：supervisor 晚于被监视源码（FAKE_DRIVER 在 start 前写入）⇒ fresh。
  const before = aliveness(root, "promotion");
  assert.equal(before.supervisorStale, false, `fresh before source advances: ${JSON.stringify(before)}`);
  assert.equal(typeof before.supervisorStartedAt, "number", "supervisorStartedAt 进 aliveness 读数");

  // 推进被监视源码 mtime 到 supervisor 启动时刻之后 ⇒ stale（判据取真）。
  const srcFile = path.join(root, "plugin", "scripts", "promotion-driver.ts");
  await new Promise((r) => setTimeout(r, 150));
  fs.writeFileSync(srcFile, FAKE_DRIVER + "\n// touched\n", "utf8");

  const after = aliveness(root, "promotion");
  assert.equal(after.supervisorStale, true, `stale after source advances: ${JSON.stringify(after)}`);

  // 反向：重启该 kind（新 supervisor 启动晚于源码）⇒ 同一读数不再报陈旧（⛔ 恒报陈旧不算通过）。
  const restart = run(["restart", "--root", root, "--restart-delay", "1", "--run-id", "dr-sup-stale-r"], { pluginRoot: path.join(root, "plugin") });
  assert.equal(restart.status, 0, `restart failed: ${restart.stdout}\n${restart.stderr}`);
  const afterRestart = aliveness(root, "promotion");
  assert.equal(afterRestart.supervisorStale, false, `fresh again after restart: ${JSON.stringify(afterRestart)}`);
});

// ── gap-ac203-record-schema-has-no-kind-dimension AC3/AC4: `start` 的存活确认 ─────────────────────
//
// 缺陷：startKind 之前【无条件】打印 `started: …` 并返回 0（statusForKind 恒 0），而 driver 根本没活
// 时同样如此 —— 「报成功但实际死亡」与「真的起来了」共用一种输出（硬规则 3b）。实测：2026-09-13 在
// 第三方项目上起 goal/quality/meta 三个 kind，三次都打印 started + exit 0，而三个载体全部不存在，
// 真实死因只写在目标项目内部日志里。
//
// AC3（能取假）：注入一个【必死】的启动 ⇒ `start` 必须非零退出并贴出死因；移除注入 ⇒ 正常启动成功。
//   注入形态 = supervisor 找不到 driver 脚本（`resolveKernelSibling` 返回 null ⇒ supervisor 打印
//   `driver-runtime: driver not found at …` 并退出 2）——这正是 GOAL-009 记载的那条死亡形态
//   （driver-runtime.ts:986 把路径锚在 opts.root），且它【确定性地】杀掉 supervisor（⛔ 不是「等一会
//   看看」的不确定判据）。两态输出逐字打印（本测试的 stdout 即留档）。
// AC4（慢启动不误判）：造一个启动明显长于确认窗口的 driver ⇒ 窗口用尽只产出 `start-pending`
//   （第三种取值，⛔ 不是死亡判定）；同一夹具给足窗口 ⇒ 确认成功。两态都要取到。
//
// 夹具：SLOW_START_DRIVER 前 3 秒「起来即退」（用一个 stamp 文件跨 respawn 记住首次启动时刻——每个
// respawn 是新进程，内存里记不住），3 秒后转入常驻。它对本次确认的意义 = 「driver 需要 3 秒才就绪」。



// ── gap-ac3-live-test-fixture-leaks-supervised-driver-processes：真实被监督 driver 的夹具清理 ──────
//
// ⚠️ 下面这一段里的【顺序】就是修法本身，不是代码风格。
//
// 实测根因（2026-09-14，本文件 AC3 测试）：泄漏【不是】失败路径特有的——**绿灯路径照样泄漏**。三个
// 环节缺一不可：
//   ① `startKind` 以 `detached: true` + `unref()` 起 supervisor（生产需要——`quay driver start` 退出
//      之后驱动必须活着）⇒ supervisor 与它 fork 出的 driver 【不随测试进程退出而消失】，只能显式杀。
//   ② `stopKind` 唯一的杀法是从 `<root>/.quay/` 读 pid 文件发信号 ⇒ **root 一旦不在，它一个信号都发
//      不出去**。实测两种形态（**都静默**）：root 被整个删掉 ⇒ `driver-runtime: invalid --root: …` +
//      exit 2；root 还在但 pid 文件没了 ⇒ 打印 `not-running` + exit 0。后者是硬规则 3b 的教科书形态
//      （读不懂输入 ⇒ 与「干净」同形）——**泄漏能长期隐形正是因为 stop 报了「没在跑」**。而残留
//      supervisor 自己的 `appendLog` 会 `mkdir -p` 把删掉的 `.quay/` 重建出来 ⇒ 同一夹具两种形态都
//      可能命中。
//   ③ 本测试原先注册【两个独立的 `t.after`】（先 `fs.rmSync(root)`、后 `run(["stop", …])`），而
//      node:test 的 `after` 钩子按【注册顺序】FIFO 执行（本机实测：先注册的 A 先跑，后注册的 B 后跑）
//      ⇒ rmSync 先把 root 删掉 ⇒ ② 空转 ⇒ 泄漏。**实测：跑一次 AC3 测试（绿）即残留 supervisor +
//      driver 各一个，而 root 目录已不存在**。
//
// 发现现场读数（本条立案证据）：同一时刻 4 个不同任务 worktree 下共 7 个存活进程（峰值一次 46 个），
// 年龄 2.1–6.15 小时（`ps -o etimes=`：7677s / 22138s 等）；`/tmp/dr-ac3-live-*` 目录 141 个——残留
// supervisor 的 `appendLog` 会 `mkdir -p` 把已删掉的 `.quay/` 重新建出来 ⇒ 「目录还在」不等于
// 「stop 跑过」，这个读数本身也取不了假。
//
// ⇒ 修法 = 【单个】teardown，三段固定顺序 + try/finally（任一段失败都不跳过后面的段）：
//     ① stop（机制路径）→ ② 按【进程组】兜底 kill → ③ 删 root。
//   ⛔ 拆成两个 `t.after`、或把 ③ 提到 ①② 之前 ⇒ 当场复现泄漏。这条由 AC2（失败路径）/ AC3（通过
//   路径）两个【独立跑通的】对照实测守住，⛔ 不靠「读代码相信 finally 会跑」——那是解释不是检验
//   （硬规则 4 推论四）。

/** 精确残留读数：cmdline 里含 `needle` 的进程行。⛔ 不按 `dr-ac3-live` 通配匹配——套件并发时别的
 *  任务 worktree 的历史残留会命中，那是与本条无关的**假阳性**；按【本次 root】这条唯一路径匹配，读数
 *  才是可取假的。⛔ `ps` 读不到时返回 `null`（⛔ 不返回 `[]` 冒充「干净」——硬规则 3b）。 */

/** 只在 pid 【确实是它自己进程组的组长】时才 `kill(-pid)`——否则 `kill(-pgid)` 会打到【别人的】进程组
 *  （本机同一时刻就有别的任务 worktree 的同类残留，误杀的代价是别人的套件）。`startKind` 以
 *  `detached: true` 起 supervisor（setsid ⇒ pgid == pid），但这里仍【实测一次 pgid】，⛔ 不假设它成立
 *  （硬规则 4：「应该成立」的量不是测量）。pid 已死 / 读不到 ⇒ 静默返回。 */

/** 真实被监督 driver 的夹具清理（唯一定义处；⛔ 别在别处再抄一份顺序）。三段顺序固定，整段在
 *  try/finally 里：① 走机制路径 stop；② 进程组兜底 kill（supervisor 是它自己进程组的组长 ⇒ 一次覆盖
 *  supervisor 与它 fork 出的全部 driver 化身——只 kill 直接子进程不够，这正是同仓库
 *  `detached-test-child-leak-hangs-suite` 的同类模式）；③ 最后才删 root。 */


test("AC3 (gap-ac203) — 必死启动 ⇒ start 非零退出 + 死因；移除注入 ⇒ 正常启动成功（两态逐字留档）", (t) => {
  // 注入：plugin root 里有 scripts/ 但【没有】driver 脚本（⇒ supervisor 找不到 driver 而退出）。
  const deadRoot = makeBareRoot("ac3-dead");
  const deadPlugin = path.join(deadRoot, "plugin", "scripts");
  fs.mkdirSync(deadPlugin, { recursive: true });
  t.after(() => fs.rmSync(deadRoot, { recursive: true, force: true }));

  const dead = run(["start", "--kind", "promotion", "--root", deadRoot, "--restart-delay", "1", "--run-id", "dr-ac3-dead", "--confirm-timeout", "10"], { pluginRoot: path.join(deadRoot, "plugin") });
  console.log(`[AC3 注入态] exit=${dead.status}\n  stdout: ${dead.stdout.trim()}\n  stderr: ${dead.stderr.trim()}`);
  assert.notEqual(dead.status, 0, `必死启动必须非零退出（旧实现恒 0）：${dead.stdout}\n${dead.stderr}`);
  assert.match(dead.stderr, /start-failed/, `必须报出 start-failed：${dead.stderr}`);
  assert.ok(!/^started:/m.test(dead.stdout), `⛔ 未确认存活时不得打印 started:：${dead.stdout}`);
  assert.match(dead.stderr, /driver not found at/, `必须贴出死因（supervisor 日志尾）：${dead.stderr}`);

  // 移除注入：同一个 root 换成带 driver 脚本的 plugin root ⇒ 正常启动成功。
  const liveRoot = makeRoot("ac3-live");
  const livePlugin = path.join(liveRoot, "plugin");
  // ⚠️ 清理必须在 `start` 【之前】注册，且是【单个】钩子——见 teardownLiveDriver 头注释：拆成两个
  // t.after 就按注册顺序先删 root、后 stop ⇒ 泄漏。注册在 start 之前 ⇒ start 与注册之间抛错也有人管。
  t.after(() => teardownLiveDriver(liveRoot, livePlugin));
  const live = run(["start", "--kind", "promotion", "--root", liveRoot, "--restart-delay", "1", "--run-id", "dr-ac3-live", "--confirm-timeout", "15"], { pluginRoot: livePlugin });
  console.log(`[AC3 正常态] exit=${live.status}\n  stdout: ${live.stdout.trim()}\n  stderr: ${live.stderr.trim()}`);
  // 机器可读的本次锚点：AC2/AC3 两个对照（父测试）用它做【精确】残留读数。
  console.log(`[AC3 fixture] root=${liveRoot} run_id=dr-ac3-live`);
  // AC2 负控制接缝：注入一次「夹具内部的断言失败」，让清理走【失败路径】。默认不生效，只在 AC2 派生的
  // 子进程里由 env 打开。没有它，AC2 就只能是「读代码相信 finally 会跑」——那是解释不是检验。
  if (process.env.QUAY_AC3_LIVE_INJECT_FAIL === "1") {
    assert.fail("AC2 负控制：注入的夹具内部断言失败——清理必须仍然执行（零残留进程 + root 已删）");
  }
  assert.equal(live.status, 0, `正常启动必须成功：${live.stdout}\n${live.stderr}`);
  assert.match(live.stdout, /^started: /m, `正常态打印 started:：${live.stdout}`);
  assert.match(live.stdout, /confirmed_ms=\d+/, `started: 行带 confirmed_ms（可核的耗时读数）：${live.stdout}`);
  assert.ok(!/start-failed/.test(live.stderr), `正常态不得出现 start-failed：${live.stderr}`);
});

// ── gap-ac3-live-test-fixture-leaks-supervised-driver-processes AC2/AC3：两个【独立跑通的】对照 ──────
//
// 判据要取假，就必须分清「清理真的执行了」与「读数本来就是空的」。做法：把【真实的 AC3 夹具】放进一个
// 子 `node --test` 进程里跑，等它【整个进程退出】之后再在父进程读数。⛔ 为什么必须隔一层子进程：被测
// 对象是「夹具是否收掉了它 spawn 的 detached supervisor」——只有在子进程退出之后读数，才不依赖父进程
// 自己的生命周期与调度（同硬规则 4b：别用会与对象同生共死的代理量判活）。
//
// AC2 = 失败路径（夹具内部断言失败）；AC3 = 通过路径（夹具全绿）。两条【各自跑一次、各自读数】，
// ⛔ 不是「跑一次然后断言应该都清理了」（DoD 明写禁止这种形态）。

/** 在子 `node --test` 里跑真实的 AC3 夹具一次，返回退出码 + 夹具回传的 root 锚点。
 *  ⛔ 模式串只匹配 `AC3 (gap-ac203)` ⇒ 本文件新增的 AC2/AC3 对照不会被递归跑（结构上无环）。
 *
 *  ⚠️ 必须删掉子进程 env 里的 `NODE_TEST_CONTEXT`：node:test 用它识别「我正跑在一个测试文件里」并对
 *  嵌套 runner 直接**静默跳过**（实测：exit 0、stdout 为空、一行 `Warning: node:test run() is being
 *  called recursively within a test file. skipping running files.`）——⛔ 那是「读不懂输入 ⇒ 与成功
 *  同形」（硬规则 3b），本轮实测就踩到了：两条对照都因 root=null 才暴露，否则会被读成「绿」。绕过这个
 *  守卫在这里是【安全】的，因为它的目的是防自递归，而本函数的模式串把两条对照排除在外 ⇒ 环不存在。
 *  即便如此，AC2/AC3 仍各自断言子进程【真的跑了】（pass/fail 计数），⛔ 不依赖「它应该跑了」。 */

/** 一次对照的读数与断言：零残留进程 + root 已删。 */
