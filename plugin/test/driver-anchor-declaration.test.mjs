// @test-group engine

// driver-anchor-declaration.test.mjs — GOAL-017/AC-255 的【能力半边】：一个 kind 相对**期望态**的
// 声明状态，以及「静默脱离期望态」这一态如何被**可区分地**报出。
//
// ── 为什么需要这一条读数（缺陷现场，2026-09-23 实测）──────────────────────────────────────────────
//
// SC 的收敛半边早已落地（六个 kind 收进一个 anchor，pid 文件去重存活数 = 1），但**能力**半边没有：
// `quality` / `meta` 的末条 round 记录停在 `2026-09-23T09:36:10.270Z`（264min 前），而
// `.quay/anchor.json` 的 `kinds` 只有四个。**六个 kind 的 `running` 全是 1** —— `running` 回答的是
// 「有没有一个活着的**承载进程**」，收敛形态下六个 kind 共用同一个 anchor，所以它对这个缺陷**结构性
// 不可见**。全仓没有任何一条读数能区分：
//    ① 操作员有意 `stop --kind X`                 （X 不在期望态里，**有**停机记录）
//    ② X 某次被静默移出期望态、无人加回          （X 不在期望态里，**没有**停机记录）
// ⇒ 与硬规则 3b 同形：「读不懂 / 没在转」与「一切正常」共用一个输出。
//
// ── 本文件验的四条读数（对应任务 Plan 第 5 步，四条都要能取假）────────────────────────────────────
//
//   ① 静默移出一个 kind（**不留**停机记录）⇒ `not-declared` 出现；
//   ② 补回 ⇒ 它消失；
//   ③ `stop --kind X` ⇒ X **保持停止**、读数显示 `stopped-explicitly`、**不**被 reconcile 自动拉起；
//   ④ `start --kind X` ⇒ 恢复（记录清除）。
//
// ── 与 `driver-anchor.test.mjs` / `driver-anchor-stop.test.mjs` 的关系（⛔ 三份合起来才是完整覆盖）──
//
// 那两份验的是**收敛 / criterion / stop 的进程边界**，都经 `kernel()` 起 anchor —— 而 `kernel()` 起的
// anchor 经 `preferredAnchorKernel()` **优先主检出**那份内核 ⇒ **worktree 里对 anchor 内核本身的改动物理
// 上不会被它们执行到**（`driver-anchor.test.mjs` 第 93-95 行已明记该形态「结构上无法自测」）。
// 本文件的 anchor **不经** `preferredAnchorKernel()`，而是直接 spawn `REPO_ROOT/plugin/scripts/
// driver-anchor.ts` + `QUAY_PLUGIN_ROOT=<fixture>/plugin` ⇒ 跑的就是**本 worktree 这一份**
// `driver-anchor.ts` + `driver-runtime.ts`。这正是本任务新增读数唯一可被验到的形态。
//
// ⚠️ 配套：本文件里的 fake driver import 的 runtime 必须与 anchor 加载的那份**同源**（同上那份注释的
// 镜像半边）—— 否则 `registerKindStop` / `requestKindStop` 分裂成两张登记表，`stop --kind X` 永远等不到
// 收尾（等满 60s 后 exit 1，与「该 kind 的循环真的挂了」同形，但真因是夹具自造的）。
//
// Run:
//   node --test plugin/test/driver-anchor-declaration.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  ANCHOR_KIND_STOPS_REL,
  DRIVER_KINDS,
  KNOWN_KINDS,
  kindDeclaration,
  readKindStops,
  updateDesired,
  writeDesired,
} from "../scripts/driver-runtime.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const KERNEL = path.join(REPO_ROOT, "plugin", "scripts", "driver-runtime.ts");
// ⛔ 直指本 worktree 那一份（见头注释：`preferredAnchorKernel()` 会换到主检出，本文件刻意绕开它）。
const ANCHOR_SCRIPT = path.join(REPO_ROOT, "plugin", "scripts", "driver-anchor.ts");
const WORKTREE_RUNTIME = path.join(REPO_ROOT, "plugin", "scripts", "driver-runtime.ts");

// ── 夹具 ───────────────────────────────────────────────────────────────────────────────────────────

/** 一个 fake driver：导出 `main(argv)`（anchor 经**既有入口**在进程内调用它，与真实 kind 同一条码路），
 *  自写 `--pid-file`，并按 interval 追写 round 心跳，直到 anchor 经 `requestKindStop` 请求它停机。
 *  ⛔ 它 import 的是**本 worktree**那份 runtime —— 与下面起的那份 anchor 同源（见头注释的镜像半边）。 */
function fakeDriverSource(kind) {
  const spec = DRIVER_KINDS[kind];
  const carrier = spec.carriers.find((c) => c.endsWith("-round.jsonl")) ?? spec.carriers[0];
  return `import fs from "node:fs";
import path from "node:path";
import { registerKindStop } from ${JSON.stringify(WORKTREE_RUNTIME)};

export async function main(argv) {
  const args = argv.slice(2);
  const get = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };
  const root = get("--root");
  const pidFile = get("--pid-file");
  const interval = Number(get("--interval") ?? 120);
  if (pidFile) fs.writeFileSync(pidFile, String(process.pid) + "\\n", "utf8");
  const ctl = registerKindStop(${JSON.stringify(kind)});
  const file = path.join(root, ".quay", ${JSON.stringify(carrier)});
  let round = 0;
  while (!ctl.requested()) {
    round += 1;
    try { fs.appendFileSync(file, JSON.stringify({ round, ts: new Date().toISOString().slice(0, 19) + "Z", pid: process.pid }) + "\\n"); } catch {}
    await new Promise((r) => setTimeout(r, interval));
  }
  return 0;
}
`;
}

/** 一个合法 workspace（`quay server status` 只认带 `.quay/config.yml` 的 root —— 裸 tasks 目录不算）。 */
function makeWorkspace(tag) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `decl-${tag}-`));
  fs.mkdirSync(path.join(root, ".quay"), { recursive: true });
  fs.writeFileSync(
    path.join(root, ".quay", "config.yml"),
    [
      "providers:",
      "  native:",
      "    enabled: true",
      '    path: "./packages/quay-native"',
      '    tasks_dir: "./tasks"',
      '    mcp_entry: ["node", "./bin/quay-native.ts", "mcp"]',
      "",
    ].join("\n"),
    "utf8",
  );
  return root;
}

function makeFixture(tag) {
  const root = makeWorkspace(tag);
  const scripts = path.join(root, "plugin", "scripts");
  fs.mkdirSync(scripts, { recursive: true });
  for (const kind of KNOWN_KINDS) fs.writeFileSync(path.join(scripts, DRIVER_KINDS[kind].driver), fakeDriverSource(kind), "utf8");
  return root;
}

/** 直接起**本 worktree 那一份** anchor（⛔ 不经 `preferredAnchorKernel()`，见头注释）。 */
function startAnchor(root) {
  const logFd = fs.openSync(path.join(root, ".quay", "anchor.log"), "a");
  const child = spawn(
    process.execPath,
    ["--no-warnings", "--experimental-strip-types", ANCHOR_SCRIPT, "__anchor", "--root", root, "--reconcile-ms", "100"],
    {
      detached: true,
      stdio: ["ignore", logFd, logFd],
      // fixture 的 fake drivers 住在 <root>/plugin/scripts ⇒ 让 anchor 的 sibling 解析指向它们。
      env: { ...process.env, QUAY_PLUGIN_ROOT: path.join(root, "plugin") },
    },
  );
  child.unref();
  return child;
}

/** 跑 `quay driver <verb>`（内核就是真正实现入口，`cli/driver.ts` 是薄壳）。 */
function kernel(args, root, extraEnv = {}) {
  return spawnSync(process.execPath, ["--no-warnings", "--experimental-strip-types", KERNEL, ...args], {
    encoding: "utf8",
    env: { ...process.env, QUAY_PLUGIN_ROOT: path.join(root, "plugin"), ...extraEnv },
    timeout: 60_000,
  });
}

const anchorStateFile = (root) => path.join(root, ".quay", "anchor.json");
const anchorPidFile = (root) => path.join(root, ".quay", "anchor.pid");
const anchorLogFile = (root) => path.join(root, ".quay", "anchor.log");

/** 读 `.quay/anchor.json`（anchor 每趟 reconcile 重写的回读面）。⛔ 三态各自独立（硬规则 3b）：
 *  · `{ok:true, value}`  文件在且可解析
 *  · `{ok:false, reason:"missing"}`  还没有这个文件（还没写过 / 刚被清理）
 *  · `{ok:false, reason:"torn"}`     文件在但**读不懂**（半写 / 0 字节 / 人为损坏）
 *  ⛔ 后两者**不得同形**：`torn` 是**别人正在写的坏文件**（非原子写 ⇒ 并发读者看到半写文件，
 *  gap-anchor-state-nonatomic-and-declaration-outruns-log 的 M2），把它冒充成「还没有回读面」
 *  会让一次**正在发生的**损坏读成「一切正常，只是还早」——本文件此前正是在这里抛
 *  `TypeError: Cannot read properties of null (reading 'kinds')`，与「该 kind 没在跑」同形。 */
function readAnchorJson(root) {
  let raw;
  try {
    raw = fs.readFileSync(anchorStateFile(root), "utf8");
  } catch (e) {
    return { ok: false, reason: e?.code === "ENOENT" ? "missing" : "torn" };
  }
  try {
    return { ok: true, value: JSON.parse(raw) };
  } catch {
    return { ok: false, reason: "torn" };
  }
}

/** 直接断言用的读法：读不懂 ⇒ 报一条**说清是哪种**的断言失败（⛔ 不是 `TypeError`——那与「字段缺失」
 *  同形，看不出是载体坏了还是该 kind 没在跑）。 */
function requireAnchorJson(root) {
  const r = readAnchorJson(root);
  assert.ok(r.ok, `\`.quay/anchor.json\` must be readable (got: ${r.ok ? "-" : r.reason})`);
  return r.value;
}

function roundCarrier(root, kind) {
  const spec = DRIVER_KINDS[kind];
  const carrier = spec.carriers.find((c) => c.endsWith("-round.jsonl")) ?? spec.carriers[0];
  return path.join(root, ".quay", carrier);
}

async function waitFor(fn, ms, what) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (await fn()) return true;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`timed out waiting for ${what}`);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function cleanup(root) {
  try {
    const pid = Number(fs.readFileSync(anchorPidFile(root), "utf8").trim());
    if (Number.isInteger(pid)) process.kill(pid, "SIGKILL");
  } catch { /* gone */ }
  fs.rmSync(root, { recursive: true, force: true });
}

// ── AC4：静默脱离期望态有**独立取值**，且双向可取假 ────────────────────────────────────────────────

test("AC4 — 某个 kind 既不在期望态、又无停机记录 ⇒ `not-declared`（⛔ 不与 `declared`/`stopped-explicitly` 同形）；补回 ⇒ 消失", async (t) => {
  const root = makeFixture("silent");
  t.after(() => cleanup(root));
  writeDesired(root, [...KNOWN_KINDS], "test:ac4-baseline");
  startAnchor(root);

  await waitFor(() => {
    const r = readAnchorJson(root);
    return r.ok && Array.isArray(r.value.kinds) && r.value.kinds.length === KNOWN_KINDS.length;
  }, 20_000, "the anchor to carry all six kinds");

  // 基线：六个 kind 全 `declared`，没有任何 `not-declared`/`stopped-explicitly`。
  const base = requireAnchorJson(root).declaration;
  assert.ok(base && typeof base === "object", "`.quay/anchor.json` carries a `declaration` map");
  for (const kind of KNOWN_KINDS) assert.equal(base[kind], "declared", `baseline: ${kind} is declared`);

  // ① 静默移出 quality + meta —— 直接改写期望态，**不留**任何停机记录（这正是生产上发生的那件事的形态）。
  writeDesired(root, ["promotion", "worker", "outer", "goal"], "test:simulate-silent-loss");
  await waitFor(() => {
    const r = readAnchorJson(root);
    return r.ok && r.value.declaration?.quality === "not-declared" && r.value.declaration?.meta === "not-declared";
  }, 20_000, "`not-declared` to appear for the two silently-dropped kinds");

  const dropped = requireAnchorJson(root);
  assert.equal(dropped.declaration.quality, "not-declared", "quality: 静默脱离期望态有独立取值");
  assert.equal(dropped.declaration.meta, "not-declared", "meta: 静默脱离期望态有独立取值");
  // ⛔ 关键的反向半边：**其余四个**不得被报成静默 —— 否则这个取值对「谁出了问题」零信息。
  for (const kind of ["promotion", "worker", "outer", "goal"]) {
    assert.equal(dropped.declaration[kind], "declared", `${kind} stays declared (the reading localizes the loss)`);
  }
  // 停机记录载体上**确实没有**这两个 kind 的记录 ⇒ 进来的正是「无记录」那一支。
  assert.deepEqual(readKindStops(root), {}, "no stop record exists for the dropped kinds");
  // 直接读函数与回读面同值（⛔ 不是只给 fixture 看的那一份）。
  assert.equal(kindDeclaration(root, "quality"), "not-declared");
  // ⛔ 且这条读数**不静默**：anchor 日志里有一行点名（不刷屏，集合变化时一行）。
  // ⚠️ 这条断言在修前是**相位敏感**的：`wanted` / `silent` / 发布面派生自三次**独立**读盘，期望态落在
  //    它们之间时那一趟会「发布 `not-declared` 却打不出这行」（诊断行落到下一趟）⇒ 全量 suite 负载下
  //    这里随机红。修后三处派生自**同一份快照**（`driver-anchor` 的 `snap`），故「发布面报到
  //    `not-declared`」与「那一行已在日志里」在**同一趟内**同时成立 —— 上面 `waitFor` 一看到发布面，
  //    这行必然已经写下了（同趟的日志追加排在 `writeState` 之前）。⛔ 断言本身一行未放宽。
  assert.match(
    fs.readFileSync(anchorLogFile(root), "utf8"),
    /absent from the desired set with NO explicit stop record: \[quality,meta\]/,
    "the anchor logs the silent departure (⛔ not silent)",
  );

  // ② 补回 ⇒ 该取值消失。
  writeDesired(root, [...KNOWN_KINDS], "test:ac4-restore");
  await waitFor(() => {
    const r = readAnchorJson(root);
    return r.ok && r.value.declaration?.quality === "declared" && r.value.declaration?.meta === "declared";
  }, 20_000, "`not-declared` to disappear once the kinds are declared again");
  assert.equal(kindDeclaration(root, "quality"), "declared", "restored ⇒ back to declared");
});

// ── AC5：显式停机仍可表达（AC4 的反向控制） ──────────────────────────────────────────────────────

test("AC5 — `stop --kind X` ⇒ X 保持停止、读数显示 `stopped-explicitly`、**不**被 reconcile 自动拉起；`start --kind X` ⇒ 恢复", async (t) => {
  const root = makeFixture("explicit");
  t.after(() => cleanup(root));
  writeDesired(root, ["quality", "outer", "goal"], "test:ac5-baseline");
  startAnchor(root);

  await waitFor(() => {
    const r = readAnchorJson(root);
    return r.ok && Array.isArray(r.value.kinds) && r.value.kinds.length === 3;
  }, 20_000, "the anchor to carry the three declared kinds");
  assert.equal(kindDeclaration(root, "quality"), "declared", "baseline: quality is declared");

  // ③ 显式停机。
  const stopped = kernel(["stop", "--kind", "quality", "--root", root], root);
  assert.equal(stopped.status, 0, `stop --kind quality exits 0 (stderr: ${stopped.stderr})`);
  // 停机**落成了可区分的记录**（⛔ 不只是「从集合里消失」）。
  assert.equal(readKindStops(root).quality?.by, "quay-driver-stop", "the stop landed a distinguishable record");
  assert.equal(kindDeclaration(root, "quality"), "stopped-explicitly", "the reading names the explicit stop");

  await waitFor(() => {
    const r = readAnchorJson(root);
    return r.ok && r.value.declaration?.quality === "stopped-explicitly";
  }, 20_000, "the anchor's read-back面 to report the explicit stop");

  // ⛔ **不被 reconcile 自动拉起**：这条是 AC4 的反向控制（缺它 ⇒ 修法退化成「永远拉满六个 kind」）。
  //    直接量 = anchor.json 的 `kinds`（此刻实际在跑的集合）在**多趟** reconcile 后仍不含 quality；
  //    且它的 round 载体不再推进。
  const carrier = roundCarrier(root, "quality");
  const beats = () => (fs.existsSync(carrier) ? fs.readFileSync(carrier, "utf8").split("\n").filter((l) => l.trim() !== "").length : 0);
  const beatsAtStop = beats();
  for (let i = 0; i < 12; i += 1) {
    await sleep(120); // 12 × 120ms = 1.44s ≈ 14 趟 reconcile（每 100ms 一趟）
    assert.ok(!requireAnchorJson(root).kinds.includes("quality"), `reconcile pass ${i + 1}: quality must NOT be auto-started (SPEC §6.9 inv.1)`);
  }
  assert.equal(beats(), beatsAtStop, "quality's round carrier stopped advancing (its loop really is down)");
  assert.equal(kindDeclaration(root, "quality"), "stopped-explicitly", "still explicitly stopped after many reconcile passes");

  // ④ 恢复。
  const restarted = kernel(["start", "--kind", "quality", "--root", root, "--confirm-timeout", "20"], root);
  assert.equal(restarted.status, 0, `start --kind quality exits 0 (stderr: ${restarted.stderr})`);
  assert.deepEqual(readKindStops(root), {}, "the stop record is cleared on start");
  assert.equal(kindDeclaration(root, "quality"), "declared", "started ⇒ declared again");
  await waitFor(() => {
    const r = readAnchorJson(root);
    return r.ok && r.value.kinds?.includes("quality");
  }, 20_000, "quality's loop to be back in the running set");
  await waitFor(() => beats() > beatsAtStop, 20_000, "quality's round carrier to advance again");
});

// ── 读数面：kernel `status --json` 与 `quay server status --json` 两处都报得出，且四态各自独立 ──────

test("AC4/AC5 — 四态在 `quay driver status --json` 与 `quay server status --json` 两处回读面上都报得出（含 `not-evaluated` 不伪装）", async (t) => {
  const root = makeFixture("surfaces");
  t.after(() => cleanup(root));
  // 期望态里五个 kind；quality 被**显式停掉**（有记录），meta 从未被声明（无记录）⇒ 两种「不在集合里」。
  writeDesired(root, ["promotion", "worker", "outer", "goal"], "test:surfaces");
  updateDesired(root, "quality", false, "quay-driver-stop");

  const statusOf = (kind) => {
    const r = kernel(["status", "--kind", kind, "--root", root, "--json"], root);
    assert.equal(r.status, 0, `driver status --kind ${kind} exits 0 (stderr: ${r.stderr})`);
    const line = r.stdout.split("\n").find((l) => l.trim().startsWith("{"));
    assert.ok(line, `driver status --kind ${kind} produced a JSON frame`);
    return JSON.parse(line);
  };

  // 四个取值各自独立 —— ⛔ 同一份期望态下三种状态同时在场，是「它们不同形」的直接证据。
  assert.equal(statusOf("promotion").declaration, "declared");
  assert.equal(statusOf("quality").declaration, "stopped-explicitly");
  assert.equal(statusOf("meta").declaration, "not-declared");
  // `not-evaluated` 的独立取值：停机记录载体**读不懂**时，⛔ 不得冒充 `not-declared`（那会把「没查成」
  // 伪装成「查过、就是没有」——硬规则 3b）。
  fs.mkdirSync(path.dirname(path.join(root, ANCHOR_KIND_STOPS_REL)), { recursive: true });
  fs.writeFileSync(path.join(root, ANCHOR_KIND_STOPS_REL), "{ this is not json", "utf8");
  assert.equal(statusOf("meta").declaration, "not-evaluated", "an unreadable stop-record carrier must NOT be reported as `not-declared`");
  assert.equal(statusOf("quality").declaration, "not-evaluated", "…nor as `stopped-explicitly`");
  fs.rmSync(path.join(root, ANCHOR_KIND_STOPS_REL), { force: true });
  assert.equal(statusOf("meta").declaration, "not-declared", "restored carrier ⇒ back to the real reading");
  // ⚠️ 上一步删的是**整个载体** ⇒ 它同时带走了 quality 的停机记录（记录是整文件替换的）。补回，使
  //    「declared / stopped-explicitly / not-declared」三态在**同一份期望态下同时在场** —— 这正是
  //    「四态各自独立、⛔ 不共用输出」的直接证据（也顺带再验一次停机记录的写侧）。
  updateDesired(root, "quality", false, "quay-driver-stop");
  assert.equal(statusOf("quality").declaration, "stopped-explicitly", "the stop record is back ⇒ the explicit-stop reading returns");

  // §6.10 每服务读数：`quay server status --json` 的 `drivers[]` 逐行带上同一个取值（⛔ 不在这里重算一份）。
  const srv = spawnSync(
    process.execPath,
    ["--no-warnings", "--experimental-strip-types", path.join(REPO_ROOT, "packages", "quay", "bin", "quay.ts"), "server", "status", "--json", "--root", root],
    { encoding: "utf8", env: { ...process.env, QUAY_PLUGIN_ROOT: path.join(REPO_ROOT, "plugin") }, timeout: 60_000 },
  );
  // ⚠️ 本夹具里**没有**统一 server 的载体 ⇒ `status: "not-running"` ⇒ 退出码 1（`EXIT_NOT_RUNNING`）。
  //    那是**正确**读数，⛔ 不是本测试要修的东西：`drivers[]` 恰恰在 `not-running` 分支里也照样逐行报出
  //    （`server.ts` 的注释：那正是最需要看「哪个 kind 不转了」的时刻）。故断言退出码 ∈ {0,1} 并照读 JSON。
  assert.ok(srv.status === 0 || srv.status === 1, `quay server status --json exits 0/1 (got ${srv.status}; stderr: ${srv.stderr})`);
  assert.ok(srv.stdout.includes("{"), `server status emitted a JSON frame even on not-running (stdout: ${srv.stdout.slice(0, 200)})`);
  const payload = JSON.parse(srv.stdout.slice(srv.stdout.indexOf("{")));
  const byKind = new Map(payload.drivers.map((d) => [d.kind, d.declaration]));
  assert.equal(payload.drivers.length, KNOWN_KINDS.length, "server status reports every driver kind");
  assert.equal(byKind.get("promotion"), "declared");
  assert.equal(byKind.get("quality"), "stopped-explicitly");
  assert.equal(byKind.get("meta"), "not-declared");
  // ⛔ `liveness` 与 `declaration` 是两个问题：此处没有活着的承载进程 ⇒ liveness 是「不在转」，
  //    而 declaration 仍如实报「声明的状态」。两者⛔ 不同形、也不互相顶替。
  assert.notEqual(byKind.get("meta"), undefined, "declaration is threaded into the §6.10 per-service reading");
});
