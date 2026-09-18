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
  DRIVER_KINDS,
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
 *  有界宽限的边界**才退出——这正是 AC3 要的那个旧 anchor 形态。 */
function fakeDriverSource() {
  const spec = DRIVER_KINDS[HEARTBEAT_KIND];
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
  const ctl = registerKindStop(${JSON.stringify(HEARTBEAT_KIND)});
  const file = path.join(root, ".quay", ${JSON.stringify(carrier)});
  const ignoreStop = process.env.FAKE_IGNORE_STOP === "1";
  let round = 0;
  while (ignoreStop || !ctl.requested()) {
    round += 1;
    try { fs.appendFileSync(file, JSON.stringify({ round, ts: new Date().toISOString().slice(0, 19) + "Z", pid: process.pid }) + "\\n"); } catch {}
    await new Promise((r) => setTimeout(r, interval));
  }
  return 0;
}
`;
}

function makeFixture(tag) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `anchor-takeover-${tag}-`));
  const scripts = path.join(root, "plugin", "scripts");
  fs.mkdirSync(scripts, { recursive: true });
  fs.mkdirSync(path.join(root, ".quay"), { recursive: true });
  for (const kind of KINDS) fs.writeFileSync(path.join(scripts, DRIVER_KINDS[kind].driver), fakeDriverSource(), "utf8");
  return root;
}

/** 起一个**真** anchor 进程（worktree 那份 driver-anchor.ts，⛔ 不经 `quay driver start` 的内核优选）。 */
function spawnAnchor(root, extraArgs = [], extraEnv = {}) {
  const child = spawn(
    process.execPath,
    ["--no-warnings", "--experimental-strip-types", ANCHOR_SCRIPT, "__anchor", "--root", root,
      "--kinds", KINDS.join(","), "--reconcile-ms", "100", ...extraArgs],
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

async function waitFor(fn, ms, what) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (await fn()) return true;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(`timed out waiting for ${what}`);
}

/** 收掉夹具：SIGKILL 一切仍然活着的进程（anchor 与冒充旧 anchor 的 sleep）+ 删根。 */
function killAll(root, extraPids = []) {
  for (const pid of [anchorPid(root), ...extraPids]) {
    if (Number.isInteger(pid) && pid > 0) { try { process.kill(pid, "SIGKILL"); } catch { /* gone */ } }
  }
}

// ── AC3 (D2)：预算的**派生**（快、且是这条修复的直接判据） ─────────────────────────────────────────

test("AC3 (D2 派生) — 接管预算必须**严格超过**旧 anchor 的真实最坏退出；旧式 `grace + 60_000` 在 grace ≥ 60s 时只是**等于**它", () => {
  for (const grace of [1_000, 3_000, 60_000, 120_000]) {
    const worst = oldAnchorWorstExitMs(grace);
    assert.equal(worst, grace + Math.min(60_000, grace), `最坏退出 = 宽限 + min(60s, 宽限)（grace=${grace}）`);
    assert.equal(takeoverBudgetMs(grace, 100), worst + 100 + 20_000, `预算 = 最坏退出 + 察觉延迟 + 余量（grace=${grace}）`);
  }
  // ⛔ **反例臂**（本条能取假的地方）：把 `takeoverBudgetMs` 改回修复前的字面量 `grace + 60_000`，
  //    下面这条在 grace = 120_000（**生产值**）上立刻红——180000 > 180000 为假。
  //    这正是实测那条：预算 180000ms，而旧 anchor 233s 才退出（宽限 + min(60s,宽限) + 察觉 + 清理 + 抖动）。
  const grace = 120_000;
  assert.ok(
    takeoverBudgetMs(grace, 100) > oldAnchorWorstExitMs(grace),
    `生产宽限下预算必须严格超过最坏退出（预算是接管与否的**分类**阈值，⛔ 不是一个恰好相等的数）`,
  );
  assert.ok(!(grace + 60_000 > oldAnchorWorstExitMs(grace)), `旧式 grace+60_000 在生产宽限下**不是**上界（${grace + 60_000} ≤ ${oldAnchorWorstExitMs(grace)}）`);
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

  // 旧 anchor 的循环**只**在宽限边界退出（FAKE_IGNORE_STOP=1）⇒ 它的真实退出时间落在「宽限 + 收尾等待」
  // 这条最坏路径上——正是修复前会撞破预算的那个形态。
  const t0 = Date.now();
  a.kill("SIGTERM");
  const b = spawnAnchor(root, ["--takeover", String(a.pid)], env);
  t.after(() => killAll(root, [b.pid]));

  await waitFor(() => anchorPid(root) === b.pid && alive(b.pid), 40_000, `the replacement to take over (stderr: ${b.stderrText})`);
  const waited = Date.now() - t0;
  const log = logOf(root);
  assert.ok(!log.includes("REFUSING to start"), `⛔ 不得出现 REFUSING（预算必须覆盖真实最坏退出）:\n${log.slice(-2000)}`);
  assert.ok(!log.includes("STILL ALIVE after"), "⛔ 也不该退化成「超预算但继续等」那条降级路（旧 anchor 是**正确但慢**，预算该容得下它）");
  assert.match(log, /takeover \d+ exited — taking over/, "走的是**正常**交接那条路");
  assert.match(log, new RegExp(`kind=${HEARTBEAT_KIND} loop started \\(pid=${b.pid}\\)`), "替换进程真的起了循环");
  assert.ok(waited > 1_000, `旧 anchor 确实 drain 了一段时间才退（实测 ${waited}ms——⛔ 不是「它早就没了」的空过）`);
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
  const log = logOf(root);
  assert.match(log, /exited at last \(after \d+ms, \d+ms past the budget\) — taking over/, "走的是「晚到但接管」那条路");
  assert.ok(!log.includes("REFUSING to start"), "⛔ 不该走到放弃那条路");
  assert.equal(readTakeoverRecord(root)?.state, "taken-over-after-abandon", "异常已收敛：记录取**另一个**值（⛔ 不是留在 abandoned）");
  assert.match(log, new RegExp(`kind=${HEARTBEAT_KIND} loop started \\(pid=${b.pid}\\)`), "替换进程真的起了 kind 循环");

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
