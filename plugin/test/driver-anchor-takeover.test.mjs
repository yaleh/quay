// @test-group engine

// driver-anchor-takeover.test.mjs — the **TAKEOVER** half of the anchor's source self-refresh (D2 + D3 of
// gap-driver-anchor-self-refresh-leaves-no-anchor-alive)。
//
// WHY A THIRD FILE (function boundary, same reason the other two were split for AC-281): `node --test`
// parallelises only ACROSS files, and both sibling files already sit at ~17-19 s of the ~20 s band.
// 第三块边界自带一个调度槽，⛔ 不是把既有文件顶出band。两个兄弟文件覆盖的是「稳态收敛 / stop --kind /
// 崩溃边界」（driver-anchor.test.mjs）与「停机那一半」（driver-anchor-stop.test.mjs）；本文件只覆盖
// **交接**：源码自刷新时旧 anchor 把班交给替换进程的那一段（`runAnchor` 的 `if (opts.takeoverPid)`）。
//
// 现场（2026-09-18，`.quay/anchor.log` 直读）：stop 请求 15:33:25 → 旧 anchor 15:37:18 才退出（233s），
// 而接管者的预算是 `shutdownGraceMs + 60_000` = 180s ⇒ 15:36:20 `REFUSING to start` → 替换进程退出 →
// 旧 anchor 随后退出 ⇒ **零 anchor 27 分钟**（`.quay/promotion-driver.pid` 缺席、promotion-round.jsonl
// 停在 15:37:18，直到人手工重启）。本文件的判据（逐条可取假）：
//   AC3(D2) 预算必须**严格超过**旧 anchor 的真实最坏退出（旧式 grace+60_000 在 grace ≥ 60s 时只是
//           **等于**它）；且一个「drain 到宽限边界才退」的旧 anchor 仍能被正常接管（⛔ 无 REFUSING）。
//   AC3(D3) 负控制：旧 pid **始终不退** ⇒ 替换进程仍然拒绝起循环（双派发硬闸未被削弱），且留下
//           `takeover-abandoned-gave-up` 这条机器可读记录。
//   AC4(D3) 放弃「正常交接」之后旧 pid 才死 ⇒ **必须有一个 anchor 活下来**（⛔ 不留零 anchor），
//           直接量 = `.quay/anchor.pid` 指向替换进程且它活着（⛔ 不是日志里的一句话）。
//
// ⚠️ 夹具的 fake driver 必须 import **本 worktree 那一份** driver-runtime：本文件 spawn 的是
//    `ANCHOR_SCRIPT`（worktree 那份 driver-anchor.ts），它的 `requestKindStop` 读的是**它自己**那份
//    runtime 的模块级登记表。兄弟文件用的是 `preferredAnchorKernel()`（**优先主检出**）——那条路对本
//    文件是错的（两张登记表 ⇒ 停机信号发到一份、循环听的是另一份）。这也是本文件能验到 worktree 里
//    `driver-anchor.ts` 改动的原因（兄弟文件头注释标注的「结构上无法自测」对**本**文件不成立，因为它
//    起的 anchor 就是 worktree 那份，⛔ 不经 `quay driver start` 的内核优选）。

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  KNOWN_KINDS,
  DRIVER_KINDS,
  kindStopProbe,
  readKindStops,
  requestKindStop,
  updateDesired,
} from "../scripts/driver-runtime.ts";
import {
  oldAnchorWorstExitMs,
  readTakeoverRecord,
  takeoverAbandonWatchMs,
  takeoverBudgetMs,
} from "../scripts/driver-anchor.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const ANCHOR_SCRIPT = path.join(REPO_ROOT, "plugin", "scripts", "driver-anchor.ts");
// ⛔ 本 worktree 那份 runtime（见文件头）：与 `ANCHOR_SCRIPT` 同一个模块实例 ⇒ 停机登记表不分裂。
const DRIVER_RUNTIME_ABS = path.join(REPO_ROOT, "plugin", "scripts", "driver-runtime.ts");

const KINDS = ["outer"];
const HEARTBEAT_KIND = "outer";

/** fake driver：导出的 `main(argv)` 是 anchor 经**既有入口**在进程内调用的那一个（与真 kind 同一条码路）。
 *  自写 `--pid-file`（pidSelf 语义：写者是驱动自己）并按 interval 追写 round 心跳，直到 anchor 请求停机。
 *  `FAKE_IGNORE_STOP=1` ⇒ 不响应停机（模拟「在飞 worker 无超时」那种无界收尾）⇒ 旧 anchor 会**drain 到
 *  有界宽限的边界**才退出——这正是 AC3 要的那个旧 anchor 形态。
 *  `kind` 可覆盖（缺省 = 本文件既有用例用的 HEARTBEAT_KIND）：本任务的接管用例需要**两个** kind 才能
 *  造出「旧 anchor 托管两个、期望态只剩一个」的收窄形态。
 *  `FAKE_STOP_LINGER_MS=n` ⇒ **响应**停机但收尾要 n ms（= 「循环会收尾，只是慢一点」那个正常路径形态，
 *  见 AC2 的对照组：⛔ 与 FAKE_IGNORE_STOP 是**两个不同的**夹具形态，别混用）。 */
function fakeDriverSource(kind = HEARTBEAT_KIND) {
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
  const interval = Number(get("--interval") ?? 150);
  if (pidFile) fs.writeFileSync(pidFile, String(process.pid) + "\\n", "utf8");
  const ctl = registerKindStop(${JSON.stringify(kind)});
  const file = path.join(root, ".quay", ${JSON.stringify(carrier)});
  const ignoreStop = process.env.FAKE_IGNORE_STOP === "1";
  const lingerMs = Number(process.env.FAKE_STOP_LINGER_MS ?? "0");
  let round = 0;
  while (ignoreStop || !ctl.requested()) {
    round += 1;
    try { fs.appendFileSync(file, JSON.stringify({ round, ts: new Date().toISOString().slice(0, 19) + "Z", pid: process.pid }) + "\\n"); } catch {}
    await new Promise((r) => setTimeout(r, interval));
  }
  if (lingerMs > 0) await new Promise((r) => setTimeout(r, lingerMs));
  return 0;
}
`;
}

function makeFixture(tag, kinds = KINDS) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `anchor-takeover-${tag}-`));
  const scripts = path.join(root, "plugin", "scripts");
  fs.mkdirSync(scripts, { recursive: true });
  fs.mkdirSync(path.join(root, ".quay"), { recursive: true });
  for (const kind of kinds) fs.writeFileSync(path.join(scripts, DRIVER_KINDS[kind].driver), fakeDriverSource(kind), "utf8");
  return root;
}

/** 起一个**真** anchor 进程（worktree 那份 driver-anchor.ts，⛔ 不经 `quay driver start` 的内核优选）。
 *  `kindsArg` 传空串 ⇒ **不生成 `--kinds`**：接管路径的缺陷只在「落到盘上期望态」时才存在（见本文件末尾
 *  的那组用例），故那条路必须真的不传 `--kinds`。 */
function spawnAnchor(root, extraArgs = [], extraEnv = {}, kindsArg = KINDS.join(",")) {
  const kindArgs = kindsArg ? ["--kinds", kindsArg] : [];
  const child = spawn(
    process.execPath,
    ["--no-warnings", "--experimental-strip-types", ANCHOR_SCRIPT, "__anchor", "--root", root,
      ...kindArgs, "--reconcile-ms", "100", ...extraArgs],
    {
      stdio: ["ignore", "ignore", "pipe"],
      env: {
        ...process.env,
        QUAY_PLUGIN_ROOT: path.join(root, "plugin"),
        // 有界停机宽限调小：本组测的是**交接**，⛔ 不是「宽限多久」（那是兄弟文件的判据）。
        QUAY_ANCHOR_SHUTDOWN_GRACE_MS: "1000",
        ...extraEnv,
      },
    },
  );
  let stderr = "";
  child.stderr.on("data", (d) => { stderr += String(d); });
  // 活取值（⛔ 不是 spawn 时刻的快照——那时它还是空串，断言会静默失去诊断信息）。
  Object.defineProperty(child, "stderrText", { get: () => stderr, configurable: true });
  return child;
}

const anchorPid = (root) => {
  const p = path.join(root, ".quay", "anchor.pid");
  return fs.existsSync(p) ? Number(fs.readFileSync(p, "utf8").trim()) : null;
};
const anchorJson = (root) => {
  const p = path.join(root, ".quay", "anchor.json");
  try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return null; }
};
const logOf = (root) => {
  const p = path.join(root, ".quay", "anchor.log");
  return fs.existsSync(p) ? fs.readFileSync(p, "utf8") : "";
};
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };

/** 等某个 anchor 的 kind 循环**真的在跑**。⛔ 不等 `.quay/anchor.pid` 就发信号：那个文件在
 *  `process.on("SIGTERM", requestAnchorStop)` **之前**就被写（runAnchor：写 pid → 记 host 行 → 起 kind
 *  → 才注册处理器）⇒ pid 一到就 SIGTERM，撞上的是 **Node 缺省处理**（进程直接死、不 drain），
 *  形态与「旧 anchor drain 完就退」**同形**（实测：scoped 门并行负载下 AC3① 因此假绿/假红过一次）。
 *  本夹具用的直接量是**循环自己写的** round 心跳载体（只有进入循环体才会出现）。 */
async function waitForLoopRunning(root, kind, ms = 30_000) {
  const spec = DRIVER_KINDS[kind];
  const carrier = spec.carriers.find((c) => c.endsWith("-round.jsonl")) ?? spec.carriers[0];
  const hb = path.join(root, ".quay", carrier);
  await waitFor(() => fs.existsSync(hb), ms, `kind=${kind}'s loop to actually run (round carrier ${carrier})`);
  // 载体出现 ⇒ 循环体已执行过一次 ⇒ 处理器一定已注册（注册在起 kind 的**同一个同步块**末尾）。
  assert.ok(alive(anchorPid(root)), "载体出现时 anchor 仍活着");
}

async function waitFor(fn, ms, what) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (await fn()) return true;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(`timed out waiting for ${what}`);
}

/** 轮询 `anchor.log` 直到 `re` 命中，返回**命中那一刻的墙钟**（ms）。
 *  ⚠️ 20ms 粒度 ⇒ 读数带 ≤ ~20ms（重载下更大）的观测误差，故它只用于**量级**判据（本文件用它区分
 *  「几百毫秒」与「一个宽限窗口」）；精确的顺序判据一律从**日志行序**取，⛔ 不靠两个观测时刻相减。
 *  ⛔ `re` 不带 `g`：带 `g` 的正则 `.test()` 有 lastIndex 状态，第二次调用会从上次位置起找。 */
async function waitForLogLine(root, re, ms, what) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (re.test(logOf(root))) return Date.now();
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error(`timed out waiting for ${what}:\n${logOf(root).slice(-2000)}`);
}

/** 收掉夹具：SIGKILL 一切仍然活着的进程（anchor 与冒充旧 anchor 的 sleep）+ 删根。 */
function killAll(root, extraPids = []) {
  for (const pid of [anchorPid(root), ...extraPids]) {
    if (Number.isInteger(pid) && pid > 0) { try { process.kill(pid, "SIGKILL"); } catch { /* gone */ } }
  }
}

// ── AC3 (D2)：预算的**派生**（快、且是这条修复的直接判据） ─────────────────────────────────────────

test("AC3 (D2 派生) — 预算从**真实最坏退出**派生；最坏退出 = 宽限本身（`+ min(60s, 宽限)` 那项随第二段等待一起下线）", () => {
  for (const grace of [1_000, 3_000, 60_000, 120_000]) {
    const worst = oldAnchorWorstExitMs(grace);
    assert.equal(worst, grace, `最坏退出 = 宽限本身（宽限超时那条路⛔ 不再白等第二段 min(60s,宽限)；grace=${grace}）`);
    assert.equal(takeoverBudgetMs(grace, 100), worst + 100 + 20_000, `预算 = 最坏退出 + 察觉延迟 + 余量（grace=${grace}）`);
  }
  // ⛔ **反例臂**（本条能取假的地方）：把 `+ Math.min(60_000, grace)` 那一项**加回** `oldAnchorWorstExitMs`
  //    （= 把那段白等也一并加回代码），下面第 2/3 条立刻红（生产宽限下 180000 ≠ 120000）。
  //    ⚠️ 本块与 `AC2`（进程级）是**同一个事实的两处写法**（硬规则 5b），各自可取假、谁都不能单独覆盖：
  //      只把**等待**加回、不动预算 ⇒ `AC2` 的滞后红（预算这块看不出来）；
  //      只把**预算**改回旧式、不加回等待 ⇒ 本块红（滞后那块看不出来）。
  const grace = 120_000;
  assert.equal(oldAnchorWorstExitMs(grace), grace, "生产宽限下最坏退出 = 宽限（⛔ 不含第二段等待）");
  assert.notEqual(
    oldAnchorWorstExitMs(grace), grace + Math.min(60_000, grace),
    "旧式 `宽限 + min(60s, 宽限)` 已**不是**本函数的取值：那一段等待已经下线，预算⛔ 不得替它留位置",
  );
  assert.equal(
    grace + Math.min(60_000, grace) - oldAnchorWorstExitMs(grace), 60_000,
    "被去掉的那一项正是 min(60s, 宽限) = 60s（生产宽限 ≥ 60s ⇒ 取 cap；这就是实测那次交接里白等的量）",
  );
  assert.ok(
    takeoverBudgetMs(grace, 100) > oldAnchorWorstExitMs(grace),
    `生产宽限下预算必须严格超过最坏退出（预算是接管与否的**分类**阈值，⛔ 不是一个恰好相等的数）`,
  );
  assert.equal(takeoverBudgetMs(grace, 100), grace + 100 + 20_000, "生产宽限下预算 = 宽限 + 察觉 tick + 余量（⛔ 不是 200500ms）");
  // 观察窗的上限是**独立**读数（⛔ 不与预算共用一个值）：预算过点后仍要继续等，等的上限是另一个量。
  assert.ok(takeoverAbandonWatchMs() > 0, "放弃观察窗有正值缺省");
});

// ── AC3 ①：drain 到宽限边界的旧 anchor ⇒ 替换进程正常接管（⛔ 无 REFUSING） ─────────────────────────

test("AC3① — 旧 anchor 的循环 drain 到**宽限边界**才退 ⇒ 替换进程接管（`taking over`，⛔ 无 `REFUSING to start`）", async (t) => {
  const root = makeFixture("grace");
  const env = { FAKE_IGNORE_STOP: "1" };
  const a = spawnAnchor(root, [], env);
  t.after(() => { killAll(root, [a.pid]); fs.rmSync(root, { recursive: true, force: true }); });
  await waitFor(() => anchorPid(root) === a.pid && alive(a.pid), 20_000, `the old anchor to own anchor.pid (stderr: ${a.stderrText})`);
  // ⛔ 必须等它的循环**真的在跑**再发信号（见 waitForLoopRunning 的注释：只等 anchor.pid 会撞上缺省处理器）。
  await waitForLoopRunning(root, HEARTBEAT_KIND);

  // 旧 anchor 的循环**只**在宽限边界退出（FAKE_IGNORE_STOP=1）⇒ 它的真实退出时间落在**最坏**那条路上
  // （宽限 + 察觉 tick），正是修复前会撞破预算的那个形态。
  // ⚠️ 修复（gap-anchor-grace-exceeded-exit-waits-another-60s-…）之后这条最坏路径**短了一个宽限窗口**：
  //    旧 anchor 在宽限到点时直接退出，⛔ 不再为这些循环白等 `min(60s, 宽限)`（见下面 AC2 的进程级判据）。
  const t0 = Date.now();
  a.kill("SIGTERM");
  const b = spawnAnchor(root, ["--takeover", String(a.pid)], env);
  t.after(() => killAll(root, [b.pid]));

  await waitFor(() => anchorPid(root) === b.pid && alive(b.pid), 40_000, `the replacement to take over (stderr: ${b.stderrText})`);
  // ⚠️ anchor.pid 是**先于**循环被写的（runAnchor：写 pid 文件 → 记 host 行 → 起各 kind）⇒ 断言日志前
  //    必须**等**那行出现，⛔ 不能在 anchor.pid 一到就断言（scoped 门并行负载下实测踩过一次）。
  await waitFor(
    () => logOf(root).includes(`kind=${HEARTBEAT_KIND} loop started (pid=${b.pid})`),
    20_000,
    "the replacement's kind loop to start",
  );
  const waited = Date.now() - t0;
  const log = logOf(root);
  assert.ok(!log.includes("REFUSING to start"), `⛔ 不得出现 REFUSING（预算必须覆盖真实最坏退出）:\n${log.slice(-2000)}`);
  assert.ok(!log.includes("STILL ALIVE after"), "⛔ 也不该退化成「超预算但继续等」那条降级路（旧 anchor 是**正确但慢**，预算该容得下它）");
  assert.match(log, /takeover \d+ exited — taking over/, "走的是**正常**交接那条路");
  assert.ok(waited > 1_000, `旧 anchor 确实 drain 了一段时间才退（实测 ${waited}ms——⛔ 不是「它早就没了」的空过）`);
});

// ── 宽限超时那条路⛔ 不再白等第二段（gap-anchor-grace-exceeded-exit-waits-another-60s-widening-…）──
//
// 现场（2026-10-14，两台宿主的 `.quay/anchor.log` 逐条读出）：旧 anchor 打完
// `shutdown grace …ms exceeded … — exiting anyway` 之后，**又**在收尾段等了 `min(60s, 宽限)`
// ——实测 ClaudeCodeUI 7/7 次接管都落在 60–61s、quay 最近 12 次里 10 次 60–61s。那 ~60s 里
// **没有任何 worker 循环在派发/收养**，而下一个收尾的 worker 恰好落进这个窗口变成孤儿。
// 判据（逐条可取假）：
//   AC2①  循环无视停机（宽限必然超时）⇒ 退出**不得**在宽限之外再等一个窗口：判据取
//         `(SIGTERM→exit) - 宽限`（两个端点都是精确时刻）< 宽限/2。修复前该路径恒 ≥ min(60s, 宽限)。
//         ⚠️ ⛔ 不用「`exiting anyway` 行 → 退出」的**观测**差做判据：该行是轮询 20ms 观测到的，而
//         修复后这个量比观测粒度还小（实测过一次 -4ms）；它只进诊断。
//   AC2②  **对照**：循环响应停机、收尾略慢 ⇒ anchor 仍**等它收尾**再退（日志行序 + SIGTERM→exit ≥ 收尾耗时）
//         ——本修复⛔ 不得顺手把正常停机路径也变成「立刻丢下循环就退」。

test("AC2① — 宽限超时 ⇒ anchor **立刻**退出（⛔ 不再为刚被判定不会收尾的循环白等 min(60s,宽限)）", async (t) => {
  const graceMs = 2_000; // ≪ 生产 120s：这里测的是**结构**（有没有第二段等待），⛔ 不是「宽限该多长」
  const root = makeFixture("no-second-wait");
  const a = spawnAnchor(root, [], { FAKE_IGNORE_STOP: "1", QUAY_ANCHOR_SHUTDOWN_GRACE_MS: String(graceMs) });
  t.after(() => { killAll(root, [a.pid]); fs.rmSync(root, { recursive: true, force: true }); });
  await waitFor(() => anchorPid(root) === a.pid && alive(a.pid), 20_000, `the anchor to own anchor.pid (stderr: ${a.stderrText})`);
  await waitForLoopRunning(root, HEARTBEAT_KIND);

  const exited = new Promise((res) => a.on("exit", () => res(Date.now())));
  const t0 = Date.now();
  a.kill("SIGTERM");
  // 该行的**出现**是判据的一半（宽限那条路真的被走到了）；它的**时刻**只进诊断 —— ⛔ 不用它做判据：
  // 它是本测试轮询 20ms 观测到的，而修复后这个量（几毫秒）比观测粒度还小（实测过一次 -4ms 的负值）。
  const tExceeded = await waitForLogLine(root, /shutdown grace \d+ms exceeded/, 30_000, "the grace-exceeded line");
  const tExit = await exited;
  const overGraceMs = (tExit - t0) - graceMs; // 宽限**之外**还多等了多久（两个端点的时刻都是精确的）
  const log = logOf(root);
  t.diagnostic(
    `AC2① reading: grace=${graceMs}ms ⇒ SIGTERM→exit = ${tExit - t0}ms（宽限之外只多 ${overGraceMs}ms）；` +
    `「exiting anyway」行出现于 +${tExceeded - t0}ms（观测粒度 20ms，⛔ 不作判据）。` +
    `修复前同一夹具、同一宽限实测：宽限之外多 2048ms（= min(60s, 宽限) 那一整段）；` +
    `生产宽限 120s ⇒ 那一段是 60s，正是 .quay/anchor.log 里 60–61s 的那批接管`,
  );
  // 忠实性两半（⛔ 不是判据，是「这条路径没被换成别的路径」的对照）：收尾语义未变，且退出时**如实**
  // 记下还有循环在 drain（⛔ 不假装已收尾）。
  assert.match(log, /exiting anyway \(their in-flight children are independent OS processes and are NOT killed/, "收尾语义逐字未变（在飞子进程不被杀，SPEC §6.9 inv.3）");
  assert.match(log, /anchor: exited \(remaining loops=1\)/, "退出行如实记下「仍有 1 个循环在 drain」");
  assert.ok(
    overGraceMs < graceMs / 2,
    `⛔ 宽限之外不得再等第二个窗口：实测多等了 ${overGraceMs}ms，阈值 grace/2=${graceMs / 2}ms` +
    `（修复前该路径**恒** ≥ min(60s, 宽限) = ${graceMs}ms，因为那段收尾等待的 deadline 就是它）:\n${log.slice(-1500)}`,
  );
  assert.ok(!alive(a.pid), "此刻进程真的已经退了（⛔ 不是「日志写了但还活着」）");
});

test("AC2② (对照) — 正常停机路径不受影响：循环响应停机、收尾略慢 ⇒ anchor **等它收尾**再退出", async (t) => {
  const graceMs = 5_000; // ≫ 收尾耗时 ⇒ 宽限那条路根本不该被走到（否则本对照测的不是正常路径）
  const lingerMs = 600;  // 循环收到停机后仍要 600ms 才返回（= 「会收尾，只是慢一点」）
  const root = makeFixture("normal-stop");
  const a = spawnAnchor(root, [], { FAKE_STOP_LINGER_MS: String(lingerMs), QUAY_ANCHOR_SHUTDOWN_GRACE_MS: String(graceMs) });
  t.after(() => { killAll(root, [a.pid]); fs.rmSync(root, { recursive: true, force: true }); });
  await waitFor(() => anchorPid(root) === a.pid && alive(a.pid), 20_000, `the anchor to own anchor.pid (stderr: ${a.stderrText})`);
  await waitForLoopRunning(root, HEARTBEAT_KIND);

  const exited = new Promise((res) => a.on("exit", () => res(Date.now())));
  const t0 = Date.now();
  a.kill("SIGTERM");
  const tExit = await exited;
  const log = logOf(root);
  assert.ok(!/shutdown grace \d+ms exceeded/.test(log), `宽限⛔ 不该被走到（收尾 ${lingerMs}ms ≪ 宽限 ${graceMs}ms）——否则本对照测的不是正常路径:\n${log.slice(-1500)}`);
  // 顺序判据取自**日志行序**（⛔ 不是两个观测时刻相减：观测带的 20ms 粒度在重载下会超过这里要判的间隔）。
  const idxStopped = log.indexOf(`anchor: kind=${HEARTBEAT_KIND} loop stopped`);
  const idxExited = log.indexOf("anchor: exited");
  assert.ok(idxStopped >= 0, `循环自己走完了收尾（打了 \`loop stopped\`）:\n${log.slice(-1500)}`);
  assert.ok(idxExited > idxStopped, "日志行序：循环的收尾行在 anchor 的退出行**之前**（⛔ 不是 anchor 先把循环丢下就退）");
  assert.match(log, /anchor: exited \(remaining loops=0\)/, "退出时**没有**循环被丢下（对照 AC2① 的 `remaining loops=1`）");
  // 直接量：anchor 确实**等满**了循环的收尾（SIGTERM→exit ≥ 收尾耗时；structurally 还要多一个 reconcile tick）。
  const total = tExit - t0;
  t.diagnostic(`AC2② reading: 收尾 linger=${lingerMs}ms, SIGTERM→exit = ${total}ms（≥ 收尾耗时，< 宽限 ${graceMs}ms）`);
  assert.ok(total >= lingerMs, `anchor 等满了循环的收尾（SIGTERM→exit = ${total}ms ≥ 收尾 ${lingerMs}ms）`);
  assert.ok(total < graceMs, `而且没有等满一个宽限窗口（${total}ms < ${graceMs}ms）——正常路径是「等循环收尾」，不是「等宽限」`);
});

// ── AC3 ②：负控制 —— 旧 pid 始终不退 ⇒ 仍然拒绝起循环（双派发硬闸未被 D3 削弱） ──────────────────────

test("AC3② (D3 负控制) — 旧 pid **始终不退** ⇒ 替换进程仍拒绝起循环、不抢 anchor.pid，并留下 `takeover-abandoned-gave-up` 记录", async (t) => {
  const root = makeFixture("refuse");
  // 一个**真**的、不会退出的旧 pid（⛔ 不是「假装」——双派发闸防的正是真进程）。
  const old = spawn("sleep", ["300"], { stdio: "ignore" });
  const b = spawnAnchor(root, ["--takeover", String(old.pid)], {
    QUAY_ANCHOR_TAKEOVER_BUDGET_MS: "1200",
    QUAY_ANCHOR_TAKEOVER_ABANDON_WATCH_MS: "1500",
  });
  t.after(() => { try { old.kill("SIGKILL"); } catch { /* gone */ } killAll(root, [b.pid]); fs.rmSync(root, { recursive: true, force: true }); });

  // ① 超预算**不是**终态：先进入「已放弃正常交接、仍在等」这一态（机器可读，且此刻还⛔ 没起循环）。
  await waitFor(() => readTakeoverRecord(root)?.state === "takeover-abandoned", 20_000, "the abandoned-but-watching record");
  assert.equal(anchorPid(root), null, "⛔ 旧 pid 还活着时不得抢占 anchor.pid");
  assert.ok(!logOf(root).includes("loop started"), "⛔ 旧 pid 还活着时不得起任何 kind 循环（双派发硬闸）");

  // ② 观察窗也走完、旧 pid 依然活着 ⇒ 放弃启动并退出（退出码 1，与「另一个 anchor 在跑」同一条码路）。
  const code = await new Promise((res) => b.on("exit", (c) => res(c)));
  assert.equal(code, 1, `替换进程必须以 1 退出（实得 ${code}；stderr: ${b.stderrText}）`);
  const log = logOf(root);
  assert.match(log, /REFUSING to start/, "放弃那条路径留痕");
  assert.ok(!log.includes("loop started"), "全程⛔ 没有起过任何 kind 循环");
  assert.equal(anchorPid(root), null, "⛔ 全程没有抢占 anchor.pid");
  const rec = readTakeoverRecord(root);
  assert.equal(rec?.state, "takeover-abandoned-gave-up", `放弃必须留下**独立取值**的机器可读记录（实得 ${JSON.stringify(rec)}）`);
  assert.ok(rec.waitedMs >= 2_000, `记录里的等待时长覆盖了预算 + 观察窗（实得 ${rec.waitedMs}ms）`);
  assert.equal(rec.waitingOn, old.pid, "记录点名它在等谁");
});

// ── AC4 (D3)：放弃之后旧 pid 才死 ⇒ **必须有一个 anchor 活下来** ───────────────────────────────────

test("AC4 (D3) — 接管被放弃之后旧 pid 才退出 ⇒ 替换进程**接管成功**（直接量：anchor.pid = 它且它活着）", async (t) => {
  const root = makeFixture("late");
  const old = spawn("sleep", ["300"], { stdio: "ignore" });
  const b = spawnAnchor(root, ["--takeover", String(old.pid)], {
    QUAY_ANCHOR_TAKEOVER_BUDGET_MS: "1200",
    QUAY_ANCHOR_TAKEOVER_ABANDON_WATCH_MS: "60000",
  });
  t.after(() => { try { old.kill("SIGKILL"); } catch { /* gone */ } killAll(root, [b.pid]); fs.rmSync(root, { recursive: true, force: true }); });

  // ① 先走到「放弃正常交接、继续等」这一态。
  await waitFor(() => readTakeoverRecord(root)?.state === "takeover-abandoned", 20_000, "the abandoned-but-watching state");
  assert.equal(anchorPid(root), null, "旧 pid 还活着 ⇒ ⛔ 不接管（D3 没有削弱双派发硬闸）");
  assert.ok(!logOf(root).includes("loop started"), "旧 pid 还活着 ⇒ ⛔ 不起循环");

  // ② 旧 pid 现在死 —— 这一刻起双派发在**结构上**不可能（旧进程已不在）。修复前：替换进程已经退出，
  //    **零 anchor**（实测 27 分钟）；修复后：它必须接管。
  old.kill("SIGKILL");
  await waitFor(() => anchorPid(root) === b.pid && alive(b.pid), 30_000, `the replacement to take over once the old pid is gone (stderr: ${b.stderrText})`);
  // anchor.pid 先于循环被写（同上）⇒ 等那行，⛔ 不在 pid 一到就断言日志。
  await waitFor(
    () => logOf(root).includes(`kind=${HEARTBEAT_KIND} loop started (pid=${b.pid})`),
    20_000,
    "the replacement's kind loop to start",
  );
  const log = logOf(root);
  assert.match(log, /exited at last \(after \d+ms, \d+ms past the budget\) — taking over/, "走的是「晚到但接管」那条路");
  assert.ok(!log.includes("REFUSING to start"), "⛔ 不该走到放弃那条路");
  assert.equal(readTakeoverRecord(root)?.state, "taken-over-after-abandon", "异常已收敛：记录取**另一个**值（⛔ 不是留在 abandoned）");

  // ③ 回读面：同一个记录也出现在 manager/外层已经在读的 `.quay/anchor.json` 上（⛔ 不是只给本文件看的载体）。
  await waitFor(() => anchorJson(root)?.takeover?.state === "taken-over-after-abandon", 20_000, "the takeover reading to reach anchor.json");
  assert.equal(anchorJson(root)?.pid, b.pid, "anchor.json 的 pid 就是替换进程");

  // ④ 直接量：循环真的在跑（心跳在推进），⛔ 不是「进程活着但不干活」。
  const carrier = DRIVER_KINDS[HEARTBEAT_KIND].carriers.find((c) => c.endsWith("-round.jsonl")) ?? DRIVER_KINDS[HEARTBEAT_KIND].carriers[0];
  const hb = path.join(root, ".quay", carrier);
  await waitFor(() => fs.existsSync(hb), 20_000, "the taken-over anchor's heartbeat carrier");
  const m1 = fs.statSync(hb).mtimeMs;
  await waitFor(() => fs.statSync(hb).mtimeMs > m1, 20_000, "the taken-over anchor's loop to keep beating");
});

// ── 接管时「启动集合**静默窄于**旧 anchor 实际托管的集合」的交叉核对 ─────────────────────────────────
//      gap-anchor-takeover-silently-narrows-hosted-kinds-against-stale-desired-state
//
// 现场（2026-10-13，本 coordinator 自己的生产动作）：`--takeover <pid>` 是**唯一**一条 anchor 存活时换
// 内核的路径，它不传 `--kinds` ⇒ 落到 `.quay/anchor-desired.json`——一个**可变**文件，93 分钟前被一次
// 未完成的诊断 `stop --kind worker` 写过。接管那一刻旧 anchor 正在托管全部四个 kind；新 anchor 的启动行
// 是 `kinds=[promotion,outer,goal]`：**worker 静默缺席、零告警**，直到操作者自己看见那行。
//
// 判据（逐条可取假）：
//   AC1/AC2  两侧不同 ⇒ `anchor.log` 上一条具名 WARNING（点名被丢的 kind + 两侧集合），且 **warn-only**
//            ——被丢的 kind **真的没有被拉起**（直接量：它的 round 载体不存在；回读面 `kinds` 也不含它）。
//            ⚠️ 改前这条路上**一行都不打**（那正是事故）⇒ 本用例是 RED→GREEN 的承重测试。
//   AC3      两侧一致 ⇒ ⛔ 无 WARNING、⛔ 也无「未核对」行；两个 kind 都照常起（对照：收窄用例只起一个）。
//   AC3(3b)  「没能交叉核对」是一个**独立取值**：快照缺失 / pid 对不上 ⇒ 打的是「未核对」那行，
//            ⛔ 不与「核对过、一致」同形（后者**不打任何行**）。直接 import 单测，⛔ 不起进程。

/** 旧 anchor 的**发布面**夹具：一份 `.quay/anchor.json`（旧 anchor 每趟 reconcile 重写过无数次之后的
 *  最后一份，`pid` = 旧 anchor）+ 一份陈旧的 `.quay/anchor-desired.json` + 那份陈旧期望态**为什么**少了
 *  一个 kind 的停机记录。⛔ 这不是「再造一个 anchor」：本任务要的那条读数就是**旧进程自己的发布面**，
 *  与接管者无关（硬规则 4b 的直接量）。
 *
 *  ⚠️ `stoppedKinds` 是**忠实性**的一半，⛔ 不是装饰：真实事故里那次 `stop --kind worker` **落了**一条
 *  显式停机记录，于是既有的「脱离期望态且**没有**停机记录」那条日志对它**保持沉默** ⇒ 整场交接**一行
 *  报警都没有**（这正是本任务要补的那个缺口）。夹具若省掉这条记录，改前的 anchor 会打那行『silently
 *  dropped』日志 ⇒ AC1 的「改前静默」就变成了「改前有别的提示」，判据会失真。 */
function seedHandoff(root, { desiredKinds, hostedKinds, oldPid, stoppedKinds = [], desiredAgeMin = 93 }) {
  const at = new Date(Date.now() - desiredAgeMin * 60_000).toISOString();
  fs.writeFileSync(
    path.join(root, ".quay", "anchor-desired.json"),
    JSON.stringify({ kinds: desiredKinds, opts: {}, updatedBy: "quay-driver-stop", updatedAt: at }, null, 2) + "\n",
    "utf8",
  );
  fs.writeFileSync(
    path.join(root, ".quay", "anchor.json"),
    JSON.stringify({
      pid: oldPid, startedAt: at, kinds: hostedKinds, host: "anchor",
      bundle: null, takeover: null, declaration: {},
    }) + "\n",
    "utf8",
  );
  if (stoppedKinds.length > 0) {
    const stops = {};
    for (const k of stoppedKinds) stops[k] = { at, by: "quay-driver-stop" };
    fs.writeFileSync(path.join(root, ".quay", "anchor-kind-stops.json"), JSON.stringify(stops, null, 2) + "\n", "utf8");
  }
}

const roundCarrier = (kind) => {
  const spec = DRIVER_KINDS[kind];
  return spec.carriers.find((c) => c.endsWith("-round.jsonl")) ?? spec.carriers[0];
};

test("AC1/AC2 — 接管时启动集合**窄于**旧 anchor 实际托管的集合 ⇒ 具名 WARNING，且被丢的 kind 不被拉起（warn-only）", async (t) => {
  const DROPPED = "worker";
  const root = makeFixture("narrow", KNOWN_KINDS);
  // 一个**真**进程充当「旧 anchor 的 pid」：新 anchor 要等它退出才起循环（双派发硬闸，⛔ 不绕过）。
  const old = spawn("sleep", ["1"], { stdio: "ignore" });
  // 事故形状（见 seedHandoff 的注释）：旧 anchor 实际托管**全部六个**；而 93 分钟前那次
  // `stop --kind worker` 留下的期望态少了 worker，并**落了**一条停机记录 ⇒ 既有那条「脱离期望态且
  // 没有停机记录」的通用日志对它保持沉默 —— 整场交接**一行报警都没有**。
  const desired = KNOWN_KINDS.filter((k) => k !== DROPPED);
  seedHandoff(root, { desiredKinds: desired, hostedKinds: KNOWN_KINDS, oldPid: old.pid, stoppedKinds: [DROPPED] });
  // ⛔ 不传 `--kinds`：缺陷只在「落到盘上期望态」时存在，故这条用例必须真的走那条路。
  const b = spawnAnchor(root, ["--takeover", String(old.pid)], {}, "");
  t.after(() => { try { old.kill("SIGKILL"); } catch { /* gone */ } killAll(root, [b.pid]); fs.rmSync(root, { recursive: true, force: true }); });

  await waitForLoopRunning(root, "outer");
  await waitFor(() => /WARNING takeover kind set differs/.test(logOf(root)), 20_000, "the narrowing warning to be logged");

  const log = logOf(root);
  assert.match(log, new RegExp(`${DROPPED} NOT started`), `AC2：必须点名被**静默丢掉**的 kind（stderr: ${b.stderrText}）:\n${log.slice(-2000)}`);
  assert.match(log, /hosted=\[promotion,worker,outer,quality,meta,goal\]/, "并给出旧 anchor **实际**托管的集合（那正是直接量）");
  assert.match(log, new RegExp(`starting=\\[${desired.join(",")}\\]`), "以及本次将要启动的集合（两侧都在 ⇒ 差异可判，⛔ 不是一个笼统的「不一样」）");
  assert.match(log, /warn-only/, "并说明**没有**自动补拉及其理由（有意停机是一个正确状态）");
  // 忠实性控制：既有那条通用日志对 worker 必须**沉默**（它有显式停机记录）⇒ 修复前这里是零报警。
  // ⛔ 断言它缺席，正是为了证明本用例的红不是「原来就有别的提示」造成的（硬规则 4：可取的假）。
  assert.ok(!/absent from the desired set/.test(log), `既有那条通用日志对 worker 必须沉默（它有停机记录）:\n${log.slice(-2000)}`);

  // warn-only 的**直接量**（⛔ 不是「日志说没起」）：被丢的 kind 的 round 载体从未出现，回读面也不含它。
  assert.equal(fs.existsSync(path.join(root, ".quay", roundCarrier(DROPPED))), false, "被丢的 kind ⛔ 不得被自动补拉");
  await waitFor(() => Array.isArray(anchorJson(root)?.kinds), 20_000, "the replacement's anchor.json");
  assert.deepEqual(anchorJson(root).kinds, desired, "回读面 `kinds` 与日志一致（⛔ 不是两处各说一套）");
});

test("AC3 — 接管时启动集合与旧 anchor 实际托管的一致 ⇒ ⛔ 无 WARNING、⛔ 无「未核对」行，六个 kind 都起（对照）", async (t) => {
  const root = makeFixture("agree", KNOWN_KINDS);
  const old = spawn("sleep", ["1"], { stdio: "ignore" });
  seedHandoff(root, { desiredKinds: KNOWN_KINDS, hostedKinds: KNOWN_KINDS, oldPid: old.pid });
  const b = spawnAnchor(root, ["--takeover", String(old.pid)], {}, "");
  t.after(() => { try { old.kill("SIGKILL"); } catch { /* gone */ } killAll(root, [b.pid]); fs.rmSync(root, { recursive: true, force: true }); });

  await waitForLoopRunning(root, "outer");
  await waitForLoopRunning(root, "worker");
  const log = logOf(root);
  assert.ok(!/WARNING takeover/.test(log), `AC3：一致 ⇒ ⛔ 不得告警（假阳性）:\n${log.slice(-2000)}`);
  assert.ok(!/NOT cross-checked/.test(log), "AC3：快照可读且 pid 对得上 ⇒ ⛔ 也不得走「未核对」那条独立取值（二者不同形）");
  // 对照：收窄用例丢了一个 kind，这里六个都起 ⇒ 「告警的有无」确实随集合差异变，⛔ 不是恒不打/恒打的空转。
  assert.equal(fs.existsSync(path.join(root, ".quay", roundCarrier("worker"))), true, "一致路径上 worker 照常被拉起");
});

test("AC3(3b) — 「没能交叉核对」是**独立取值**：快照缺失 / pid 对不上 / 读不懂，⛔ 不与「核对过、一致」共用输出", async (t) => {
  // ⚠️ 动态 import：本文件在**改前**必须仍可加载（否则整文件 import 失败会把 RED 混进其它用例，RED 就
  //    不再可归因于「静默丢弃」这件事），故新符号只在运行时取。
  const { readTakeoverHostedSnapshot, takeoverKindDivergence, takeoverKindsWarning } = await import("../scripts/driver-anchor.ts");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "anchor-takeover-xcheck-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, ".quay"), { recursive: true });

  // ① 没有快照 ⇒ not-evaluated/missing（⛔ 不是「read + 空集合」——那会与「旧 anchor 什么都没托管」同形）。
  assert.deepEqual(readTakeoverHostedSnapshot(root, 1234), { state: "not-evaluated", reason: "missing" });
  // ② 快照在、但 pid 对不上 ⇒ not-evaluated/pid-mismatch（⛔ 拿别人的陈旧回读面比对会**捏造**一条告警）。
  fs.writeFileSync(path.join(root, ".quay", "anchor.json"), JSON.stringify({ pid: 999, kinds: ["outer", "goal"] }), "utf8");
  assert.deepEqual(readTakeoverHostedSnapshot(root, 1234), { state: "not-evaluated", reason: "pid-mismatch" });
  // ③ 快照在且 pid 对得上 ⇒ read，且拿到的就是旧 anchor 的集合。
  assert.deepEqual(readTakeoverHostedSnapshot(root, 999), { state: "read", kinds: ["outer", "goal"] });
  // ④ 不可解析 ⇒ malformed（⛔ 不与 missing 同形）。
  fs.writeFileSync(path.join(root, ".quay", "anchor.json"), "{not json", "utf8");
  assert.deepEqual(readTakeoverHostedSnapshot(root, 999), { state: "not-evaluated", reason: "malformed" });

  // ⑤ 差集的两半 + 顺序按 KNOWN_KINDS（promotion,worker,outer,quality,meta,goal；⛔ 不按字典序）+ 一致 ⇒ null。
  assert.deepEqual(
    takeoverKindDivergence(["goal", "outer"], ["promotion"]),
    { dropped: ["outer", "goal"], added: ["promotion"] },
    "两侧都有差：dropped 按 KNOWN_KINDS 顺序（outer 在 goal 之前），added 是被新起的那个",
  );
  assert.deepEqual(takeoverKindDivergence(["outer"], ["outer", "goal"]), { dropped: [], added: ["goal"] });
  assert.deepEqual(takeoverKindDivergence(["outer", "goal"], ["outer", "goal"]), { dropped: [], added: [] });
  assert.equal(takeoverKindsWarning(["outer", "goal"], ["outer", "goal"], 42), null, "一致 ⇒ null（⛔ 不加噪）");
  assert.match(takeoverKindsWarning(["outer", "goal"], ["outer"], 42) ?? "", /goal NOT started/, "差异 ⇒ 点名被丢的 kind");
});

// ── 跨 bundle 的 per-kind 停机通道（gap-per-kind-stop-is-in-memory-and-never-crosses-dist-bundles）──
//
// 现场（2026-10-14，ClaudeCodeUI 的 shipped dist 内核 `official-dist-020-dev-r4-ccui-fix`）：
// `quay driver stop|restart --kind quality` 5 次全等满 60s 后 `stop-failed` / `restart-aborted`，
// 而**同一条命令**在 quay 自己仓库（anchor 跑 `.ts` dev 树）3510ms 成功。根因用反例核过：per-kind
// 停机走 `driver-runtime.ts` 的 `KIND_STOP` **进程内存**登记表，而 shipped 产物里 `driver-anchor.js`
// 与每个 `<kind>-driver.js` 是**各自独立的 esbuild bundle**、各自内联一份 driver-runtime ⇒ anchor 的
// `requestKindStop` 查的是自己那张**空表**、恒 `false`，而返回值被丢弃 ⇒ 停机请求从未到达循环。
//
// 本用例把那个布局**机械地**造出来（⛔ 不是读配置猜、⛔ 不是断言源码文本）：用 esbuild 把
// `quality-gate-driver.ts` **单独**打成一个 bundle（= 一个独立的模块实例，与 shipped 形态同构），
// 然后逐条取假：
//   ① 负控制 **A**（布局为真）：本进程从 `.ts` 那份 driver-runtime 调 `requestKindStop("quality")`
//      必须返回 **false** —— 证明这两份**确实是两个模块实例**。若它返回 true，本用例测的就不是
//      那个布局，下面 ③ 的绿也是假的。
//   ② 负控制 **B**（判据有代价）：**不写**停机记录时，那个 bundle 的常驻环在同一个窗口内**不退出**
//      —— 否则 ③ 的「退出了」可能来自别的路径（崩溃 / 到点自停），与停机记录无关。
//   ③ 判据：写停机记录（= `quay driver stop --kind X` 经 `updateDesired(present=false, …)` 写的那个）
//      ⇒ 那个 bundle 的常驻环**退出**，且从写入到退出 ≤ 一个 reconcile tick 量级。
//   ⛔ 直接量取自**子进程真的退出了**（`exit` 事件 + 墙钟毫秒），⛔ 不是日志里的一句话。

/** quality 例程的 stub（同 `driver-config.test.mjs` 的手法）：让 due 例程零 LLM、快速返回，
 *  本用例测的是**停机通道**，⛔ 不是例程。 */
const QUALITY_STUBS = [
  "--resource-gate-cmd", "false",
  "--judge-cmd", "true", "--arch-judge-cmd", "true", "--judgment-cmd", "true",
  "--identity-cmd", "true", "--lineage-cmd", "true", "--deletion-cmd", "true",
  "--packaging-check-cmd", "true", "--packaging-gap-worker-cmd", "true", "--plan-cmd", "true",
];

test("跨 bundle per-kind 停机 — 判据不靠模块同一性：盘上停机记录让**独立 bundle** 的常驻环退出（含两条负控制）", async (t) => {
  const distDir = fs.mkdtempSync(path.join(os.tmpdir(), "pkstop-dist-"));
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pkstop-root-"));
  fs.mkdirSync(path.join(root, ".quay"), { recursive: true });
  let child = null;
  t.after(() => {
    if (child && child.exitCode === null) { try { child.kill("SIGKILL"); } catch { /* gone */ } }
    fs.rmSync(distDir, { recursive: true, force: true });
    fs.rmSync(root, { recursive: true, force: true });
  });

  // ── 造出 shipped 的布局：quality-gate-driver **单独**打成一份 bundle（自己的 driver-runtime 副本）──
  // esbuild 由 build-plugin-dist.mjs 同一份依赖提供（本仓库 devDependency；`build-plugin-dist.test.mjs`
  // 与 `fan-in-execute-plugin-root-arg.test.mjs` 已经这么用）。
  const { build } = await import("esbuild");
  const outfile = path.join(distDir, "quality-gate-driver.js");
  await build({
    entryPoints: [path.join(REPO_ROOT, "plugin", "scripts", "quality-gate-driver.ts")],
    bundle: true, format: "esm", platform: "node", target: "node20", outfile,
    // yaml（CJS）的 interop shim：与 `build-plugin-dist.mjs` 的 banner 逐字同源（否则 bundle 起不来）。
    banner: { js: "import { createRequire as __cr } from \"module\"; const require = __cr(import.meta.url);" },
    logLevel: "silent",
  });
  assert.ok(fs.existsSync(outfile), "the standalone quality bundle was produced");

  const pidFile = path.join(root, ".quay", "quality.pid");
  child = spawn(
    process.execPath,
    [outfile, "--root", root, "--interval", "1000", "--pid-file", pidFile, ...QUALITY_STUBS],
    { stdio: ["ignore", "ignore", "ignore"] },
  );
  let exitCode = null;
  let exitedAt = 0;
  child.on("exit", (c) => { exitCode = c; exitedAt = Date.now(); });

  // 直接量：常驻环**真的起来了**（`--pid-file` 由 `runResidentQualityGateLoop` 进入循环前写一次）。
  await waitFor(() => fs.existsSync(pidFile), 20_000, "the standalone quality bundle's resident loop to start");

  // ① 负控制 A：两个模块实例确实是分开的（否则本用例测的不是那个布局）。
  assert.equal(
    requestKindStop("quality"), false,
    "the in-process KIND_STOP registry must NOT be shared with the standalone bundle " +
    "(if it were, this case would not be exercising the shipped layout at all)",
  );

  // ② 负控制 B：**没有**停机记录时它不退出（同一个窗口、同一个进程）。
  await new Promise((r) => setTimeout(r, 1_500));
  assert.equal(exitCode, null, "⛔ 没有停机记录时那个 bundle 的常驻环不得退出（否则 ③ 的退出与记录无关）");

  // ③ 判据：写停机记录 —— 逐字就是 `quay driver stop --kind X` 的写侧。
  const before = Date.now();
  updateDesired(root, "quality", false, "test:stop-kind");
  assert.ok(readKindStops(root)?.quality, "the stop record landed in .quay/anchor-kind-stops.json");
  assert.equal(kindStopProbe(root, "quality").read(), "stopped", "and the probe reads it back as `stopped`");
  await waitFor(() => exitCode !== null, 10_000, "the standalone bundle's resident loop to stop on the on-disk record");
  const stopMs = exitedAt - before;
  assert.equal(exitCode, 0, `the loop returns 0 (clean stop), got ${exitCode}`);
  assert.ok(
    stopMs < 4_000,
    `⛔ 停机延迟必须是一个 reconcile tick 量级，⛔ 不是一个 interval（interval=1000ms；实测 ${stopMs}ms）`,
  );
});
