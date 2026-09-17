// Shared harness for the driver-runtime shards (split of driver-runtime.test.mjs by
// gap-suite-split-15-over-30s-test-files). ONE copy of every depth-0 helper — the shards import the
// names they use; ⛔ no shard re-declares a fixture.
//
// SRC_URL re-establishes the ORIGINAL directory so the moved code's own
// __dirname / import.meta.url-relative paths keep resolving from helpers/.
const SRC_URL = new URL("../driver-runtime.test.mjs", import.meta.url).href;

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

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import {
  DRIVER_KINDS,
  KNOWN_KINDS,
  pidAlive,
  readPidFile,
  writePidFile,
  resolveMainRoot,
  carrierStats,
  driverArgvForKind,
  makeStopCondition,
  appendHeartbeatLine,
  notifyManager,
  launchArgv,
  splitArgs,
  runAsync,
  runLivenessCheck,
  shuffle,
  defaultReadyPoolArgv,
  readyPoolCheck,
  defaultSelectorArgv,
  parseSelectorOutput,
  runSelectorWorker,
  verifyIndependently,
  TASK_FILTERS,
  applyTaskFilters,
  makeFilterContext,
  resourceGateCheck,
  scheduleIsDue,
  collectFacts,
  reportFacts,
  aliveness,
  anchorHosts,
  readAnchorState,
  statePaths,
  preferredAnchorKernel,
  kernelSelfPath,
  resolveKernelSibling,
  kernelSiblingArgv,
  watchedSourceFiles,
  sourceFilesMaxMtimeMs,
  sourceChangedSince,
  supervisorStaleness,
  procStartTimeMs,
  driverPidIsReadinessMarker,
  legacyCarrierPids,
  stopLegacyPair,
  stopKind,
  restartKind,
  readDesired,
  updateDesired,
} from "../../scripts/driver-runtime.ts";
import { isDue } from "../../scripts/routine-scheduler.ts";
import * as worker from "../../scripts/worker-driver.ts";
import * as promotion from "../../scripts/promotion-driver.ts";













// ── AC1（两级分层落地）：Layer 0 拥有共享机件 ─────────────────────────────────────────────────────

const __dirname = path.dirname(fileURLToPath(SRC_URL));

// The shard that holds the `AC3 (gap-ac203)` fixture (resolved, not hardcoded — see runAc3FixtureOnce).
const DRIVER_RUNTIME_SHARD = fs
  .readdirSync(__dirname)
  .filter((f) => /^driver-runtime-s\d+\.test\.mjs$/.test(f))
  .sort()
  .find((f) => fs.readFileSync(path.join(__dirname, f), "utf8").includes("AC3 (gap-ac203)"));
assert.ok(DRIVER_RUNTIME_SHARD, "the driver-runtime shard carrying the AC3 (gap-ac203) fixture must exist");

const KERNEL = path.resolve(__dirname, "..", "scripts", "driver-runtime.ts");

// A fake promotion-driver.ts (idles forever + self-writes its pid to --pid-file, mirroring the real
// driver's --pid-file self-write that cmd_start waits for).
const FAKE_DRIVER = [
  "const fs = require(\"node:fs\");",
  "const argv = process.argv.slice(2);",
  "const i = argv.indexOf(\"--pid-file\");",
  "if (i >= 0 && argv[i + 1]) fs.writeFileSync(argv[i + 1], String(process.pid));",
  "setInterval(() => {}, 1000);",
].join("\n");

// A fake worker-driver.ts: dumps its argv + QUAY_MAX_TASK_SUBAGENTS env to a file, then idles.
const FAKE_WORKER_DRIVER = [
  "const fs = require('node:fs');",
  "const path = require('node:path');",
  "const argv = process.argv.slice(2);",
  "const i = argv.indexOf('--root');",
  "const root = i >= 0 && argv[i + 1] ? argv[i + 1] : '.';",
  "const dump = { argv: argv, capEnv: process.env.QUAY_MAX_TASK_SUBAGENTS || null };",
  "fs.mkdirSync(path.join(root, '.quay'), { recursive: true });",
  "fs.writeFileSync(path.join(root, '.quay', 'worker-argv-dump.json'), JSON.stringify(dump));",
  "setInterval(() => {}, 1000);",
].join("\n");

// ⚠️ 本文件测的是**多进程 supervisor 机制**（respawn / --restart-delay / kill -9 supervisor /
// 源码自刷新杀 child / supervisor 陈旧判定 / spawn 预写 pid 的代理量语义）。GOAL-017/AC-255（SPEC §7
// 阶段 C）把生产默认路径换成了**单进程 anchor**（六个 kind 的循环住在一个进程的事件循环里，supervisor
// 退役）——但该路径**被显式保留为可回退形态**（`QUAY_DRIVER_LEGACY_SUPERVISOR=1`，SPEC §7「每阶段独立
// 可回退」）。本文件的夹具（fake driver 是**独立进程**、只会 `require`+idle，不导出 main）结构上只能跑
// supervisor 路径，故这里显式钉住回退开关：**它测的是被保留的那条路径**，⛔ 不是生产默认。
//
// anchor（生产默认）路径的等价覆盖在新文件 plugin/test/driver-anchor.test.mjs 里（收敛 + 六心跳 +
// 单 kind 停机 + §6.10 活性负控制）。⛔ 两个文件合起来才是完整覆盖——只看本文件会把一条已退役的路径
// 误读成「生产在跑的东西」。
function run(args, opts = {}) {
  const env = { QUAY_DRIVER_LEGACY_SUPERVISOR: "1", ...process.env, ...(opts.env || {}) };
  // AC-203：kernel 从自身安装位置（或 QUAY_PLUGIN_ROOT）解析 driver/脚本——测试的 fake driver 住在
  // <tmp>/plugin/scripts/，故经 QUAY_PLUGIN_ROOT 指向 fake plugin root（同 Core plugin-root.ts 手法）。
  if (opts.pluginRoot) env.QUAY_PLUGIN_ROOT = opts.pluginRoot;
  return spawnSync(process.execPath, ["--experimental-strip-types", KERNEL, ...args], {
    encoding: "utf8",
    env,
    timeout: opts.timeout || 30000,
  });
}

function makeRoot(tag) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `dr-${tag}-`));
  const scripts = path.join(root, "plugin", "scripts");
  fs.mkdirSync(scripts, { recursive: true });
  fs.writeFileSync(path.join(scripts, "promotion-driver.ts"), FAKE_DRIVER, "utf8");
  return root;
}

function makeWorkerRoot(tag) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `dr-w-${tag}-`));
  const scripts = path.join(root, "plugin", "scripts");
  fs.mkdirSync(scripts, { recursive: true });
  fs.writeFileSync(path.join(scripts, "worker-driver.ts"), FAKE_WORKER_DRIVER, "utf8");
  return root;
}

function readPid(root, name) {
  const p = path.join(root, ".quay", name);
  return fs.existsSync(p) ? fs.readFileSync(p, "utf8").trim() : "";
}

// Poll a JSON file that a (possibly non-atomic) writer creates-then-writes. Treats "file exists but
// content not yet fully written" (JSON.parse throws) as "not yet complete — keep polling", ⛔ not a
// fatal parse error (gap-driver-test-fixture-json-read-before-write-complete-race). Returns the
// parsed object, or null on timeout.
async function pollJsonFile(p, timeoutMs = 5000, stepMs = 50) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (fs.existsSync(p)) {
      try {
        return JSON.parse(fs.readFileSync(p, "utf8"));
      } catch {
        // created but not fully written — keep polling
      }
    }
    await new Promise((r) => setTimeout(r, stepMs));
  }
  return null;
}

function killIfAlive(pid) {
  if (!pid) return;
  try { process.kill(Number(pid), "SIGKILL"); } catch { /* already gone */ }
}

function deadPid() {
  return spawnSync("true", { encoding: "utf8" }).pid;
}

function git(cwd, args) {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t",
      GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t",
    },
  });
}

function makeGitWorktree() {
  const main = fs.mkdtempSync(path.join(os.tmpdir(), "dr-main-"));
  const wt = path.join(os.tmpdir(), `dr-wt-${path.basename(main)}`);
  const scripts = path.join(main, "plugin", "scripts");
  fs.mkdirSync(scripts, { recursive: true });
  fs.writeFileSync(path.join(scripts, "promotion-driver.ts"), FAKE_DRIVER, "utf8");
  git(main, ["init", "-q"]);
  git(main, ["add", "-A"]);
  git(main, ["commit", "-qm", "init"]);
  git(main, ["worktree", "add", "-q", wt, "HEAD"]);
  return { main, wt };
}

// ── gap-driver-status-misreports-anchor-hosted-kind-as-down ────────────────────────────────────────
// 生产实测（2026-09-15，`/home/yale/work/quay`，6 个 kind 全由一个 anchor 托管）：`quay driver status
// --kind <k> --json` 对其中 5 个报 `host=supervisor, driver_pid=null, alive=0, running=0`，而**同刻**这
// 5 个 kind 的 round 载体都在**秒级**刷新。根因：`anchorHosts()` 要求「逐 kind pid 载体
// `.quay/<prefix>.pid` 里恰好写着 anchor 的 pid」——而那张文件是**循环的产物**（进循环体时写一次、
// 循环收尾时被删、活着期间**没有任何东西重写**），⛔ 不是托管关系的产物。⇒ 任意时刻「哪些 kind 有它」
// 是一个随循环代次漂移的**任意子集**。本测试钉住新判据：**anchor 进程活着 ∧ 回读面 `.quay/anchor.json`
// 点名了本 kind**，且夹具里**故意不写**那张逐 kind pid 载体（旧判据在它上面必挂）。
function writeAnchorHostedRoot(tag, kinds, opts = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `dr-anchor-${tag}-`));
  const q = path.join(root, ".quay");
  fs.mkdirSync(q, { recursive: true });
  const anchorPid = opts.anchorPid ?? process.pid;
  fs.writeFileSync(path.join(q, "anchor.pid"), `${anchorPid}\n`, "utf8");
  if (opts.state !== false) {
    fs.writeFileSync(
      path.join(q, "anchor.json"),
      JSON.stringify({ pid: opts.statePid ?? anchorPid, startedAt: "2026-09-15T02:15:14.983Z", kinds, host: "anchor" }) + "\n",
      "utf8",
    );
  }
  return root;
}

const SLOW_START_DRIVER = [
  "const fs = require('node:fs');",
  "const argv = process.argv.slice(2);",
  "const i = argv.indexOf('--pid-file');",
  "const pf = i >= 0 ? argv[i + 1] : null;",
  "const stamp = pf ? pf + '.first-start' : null;",
  "let first = Date.now();",
  "try { const v = Number(fs.readFileSync(stamp, 'utf8')); if (v > 0) first = v; } catch { try { fs.writeFileSync(stamp, String(first)); } catch {} }",
  "if (Date.now() - first < 3000) process.exit(1);",
  "if (pf) fs.writeFileSync(pf, String(process.pid));",
  "setInterval(() => {}, 1000);",
].join("\n");

function makeBareRoot(tag) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `dr-${tag}-`));
  return root;
}

function processesMentioning(needle) {
  const ps = spawnSync("ps", ["-eo", "pid=,args="], { encoding: "utf8" });
  if (ps.status !== 0 || typeof ps.stdout !== "string") return null;
  return ps.stdout.split("\n").map((l) => l.trim()).filter((l) => l && l.includes(needle));
}

function killProcessGroupOf(pidRaw) {
  const pid = Number(pidRaw);
  if (!pid) return;
  const r = spawnSync("ps", ["-o", "pgid=", "-p", String(pid)], { encoding: "utf8" });
  if (r.status !== 0 || Number((r.stdout || "").trim()) !== pid) return;
  try { process.kill(-pid, "SIGKILL"); } catch { /* already gone */ }
}

function teardownLiveDriver(root, pluginRoot) {
  try {
    run(["stop", "--kind", "promotion", "--root", root], { pluginRoot, timeout: 20000 });
  } catch { /* ① 抛错也必须走到 ②③——清理不能因为机制路径失败而跳过 */ }
  try {
    killProcessGroupOf(readPid(root, "promotion-driver-supervisor"));
    killProcessGroupOf(readPid(root, "promotion-driver"));
  } finally {
    fs.rmSync(root, { recursive: true, force: true }); // ③ 必须最后：root 一没，②的 pid 文件也就读不到了
  }
}

function runAc3FixtureOnce(injectFail) {
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  if (injectFail) env.QUAY_AC3_LIVE_INJECT_FAIL = "1";
  else delete env.QUAY_AC3_LIVE_INJECT_FAIL;
  const r = spawnSync(
    process.execPath,
    ["--experimental-strip-types", "--test", "--test-name-pattern=AC3 \\(gap-ac203\\)", path.join(__dirname, DRIVER_RUNTIME_SHARD)],
    { encoding: "utf8", env, timeout: 180000 },
  );
  const m = /^\[AC3 fixture\] root=(\S+) run_id=(\S+)$/m.exec(r.stdout || "");
  return { status: r.status, stdout: r.stdout || "", stderr: r.stderr || "", root: m ? m[1] : null };
}

function assertNoResidue(child, label) {
  assert.ok(child.root, `${label}：夹具必须回传 root 锚点才谈得上读数：\n${child.stdout}\n${child.stderr}`);
  const residue = processesMentioning(child.root);
  assert.ok(residue !== null, `${label}：ps 读数必须可得（⛔ 读不到 ≠ 干净，硬规则 3b）`);
  assert.deepEqual(
    residue, [],
    `${label}：不得残留任何引用本次 root 的进程（按本次 root 精确匹配；⛔ 不通配 dr-ac3-live——那会把\n别的任务 worktree 的历史残留算进来）：\n${residue.join("\n")}`,
  );
  assert.ok(!fs.existsSync(child.root), `${label}：/tmp root 必须已删：${child.root}`);
}

// ── gap-driver-start-false-confirms-unsettled-driver：就绪标记必须由【驱动自己】写 ──────────────────
//
// 缺陷（现场 3/3 轮红，跨 2 个互不相关的任务分支）：`runSupervisor` 在 spawn 时**替驱动预写**了 driver
// pid 文件，而 `awaitDriverConfirmation` 唯一的稳定守卫是一个【定值】`CONFIRM_POLL_MS = 250`ms。
// ⇒ 「pid 文件在 ∧ 该进程存在 ≥250ms」被读成「已就绪」——一个「活 600ms 后 exit(1)」的驱动必然跨过
// ≥2 个 250ms 轮询点 ⇒ 误报 `started:`。守卫要区分的量（spawn→就绪的延迟）随宿主负载变化，而守卫是
// 字面量（硬规则 4 推论二）。实测本机 spawn→就绪基线 ≈1.7s ⇒ 250ms 这个数在本机就早已失效。
//
// 修法（唯一变量 = **就绪标记的写者**）：pidSelf 类 kind 的 driver pid 文件由**驱动自己在进入常驻循环
// 后**写 ⇒ 「文件在」= 「走到了自己的循环」，与宿主负载无关；supervisor 不再替它预写
// （见 runSupervisor / driverPidIsReadinessMarker 的注释）。
//
// AC1（能取假·双向对照，唯一变量 = 驱动存活时长，两个夹具都【从未进入常驻循环】）：
//   50ms ⇒ `start-pending` + 非 0（改前改后同）；600ms ⇒ 改前 `started:` + 0（**误报**），改后
//   `start-pending` + 非 0。⇒ 「两种条件退出码不同」在改前成立、改后消失 —— 下面直接断言这个等式。
// AC2（正控制·防「改成永不确认」）：把「就绪」真的做出来（boot 后自写 --pid-file 并常驻）⇒ 必须确认
//   成功。只有 AC1 那一侧不足以证明修好（一个恒不确认的实现也能让它绿）。
const NEVER_RESIDENT_DRIVER = (busyMs) => [
  `const until = Date.now() + ${busyMs};`,
  "while (Date.now() < until) { }",
  "process.exit(1);",
].join("\n");

const READY_AFTER_DRIVER = (bootMs) => [
  "const fs = require('node:fs');",
  "const argv = process.argv.slice(2);",
  "const i = argv.indexOf('--pid-file');",
  "const pf = i >= 0 ? argv[i + 1] : null;",
  `const until = Date.now() + ${bootMs};`,
  "while (Date.now() < until) { }",
  "if (pf) fs.writeFileSync(pf, String(process.pid));",
  "setInterval(() => {}, 1000);",
].join("\n");

function makeRootWithDriver(tag, driverSrc) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `dr-${tag}-`));
  const scripts = path.join(root, "plugin", "scripts");
  fs.mkdirSync(scripts, { recursive: true });
  fs.writeFileSync(path.join(scripts, "promotion-driver.ts"), driverSrc, "utf8");
  return root;
}

const REPO_ROOT_DR = path.resolve(__dirname, "..", "..");

function mcpFixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dr-mcp-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const homeDir = path.join(dir, "home");
  const projectDir = path.join(dir, "project");
  const w = (p, v) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, JSON.stringify(v)); };
  w(path.join(homeDir, ".claude.json"), {
    mcpServers: {
      "chrome-devtools": { command: "npx", args: ["chrome-devtools-mcp@latest"] },
      playwright: { command: "npx", args: ["@playwright/mcp@latest"] },
      "user-extra": { command: "node", args: ["user-extra.js"] },
    },
  });
  w(path.join(homeDir, ".claude", "settings.json"), { enabledPlugins: { "quay@quay": true, "archguard@archguard": true } });
  w(path.join(projectDir, ".mcp.json"), { mcpServers: { "proj-server": { command: "node", args: ["proj.js"] } } });
  return {
    roots: { homeDir, projectDirs: [projectDir], kernelPluginRoot: path.join(REPO_ROOT_DR, "plugin") },
  };
}

function kernelLayoutFixture(withCoreSrc) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "quay-kernel-layout-"));
  const pluginRoot = path.join(dir, "plugin");
  fs.mkdirSync(path.join(pluginRoot, "scripts", "dist"), { recursive: true });
  fs.writeFileSync(path.join(pluginRoot, "scripts", "promotion-driver.ts"), 'import { parse } from "yaml";\n');
  fs.writeFileSync(path.join(pluginRoot, "scripts", "dist", "promotion-driver.js"), "// bundled\n");
  if (withCoreSrc) fs.mkdirSync(path.join(dir, "packages", "quay", "src"), { recursive: true });
  return { dir, pluginRoot };
}

function withKernelRoot(root, fn) {
  const prev = process.env.QUAY_PLUGIN_ROOT;
  process.env.QUAY_PLUGIN_ROOT = root;
  try {
    return fn();
  } finally {
    if (prev === undefined) delete process.env.QUAY_PLUGIN_ROOT; else process.env.QUAY_PLUGIN_ROOT = prev;
  }
}

function spawnIdleProc() {
  const c = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000);"], { stdio: "ignore" });
  c.unref();
  return c.pid;
}

function spawnOrphanProc() {
  const out = execFileSync(
    process.execPath,
    ["-e", [
      "const { spawn } = require('node:child_process');",
      "const c = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000);'], { detached: true, stdio: 'ignore' });",
      "c.unref();",
      "process.stdout.write(String(c.pid));",
    ].join("\n")],
    { encoding: "utf8", timeout: 10_000 },
  );
  return Number(out.trim());
}

function spawnTermIgnoringProc(carrierFile, pidToWrite, readyFile) {
  const src = [
    "const fs = require('node:fs');",
    `fs.writeFileSync(${JSON.stringify(readyFile)}, "1");`,
    `process.on('SIGTERM', () => { fs.writeFileSync(${JSON.stringify(carrierFile)}, String(${pidToWrite}) + '\\n'); });`,
    "setInterval(() => {}, 1000);",
  ].join("\n");
  const c = spawn(process.execPath, ["-e", src], { stdio: "ignore" });
  c.unref();
  return c.pid;
}

function killProcs(pids) {
  for (const p of pids) {
    if (!p) continue;
    try { process.kill(Number(p), "SIGKILL"); } catch { /* already gone */ }
  }
}

async function waitFor(fn, ms, what) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (fn()) return true;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`timed out waiting for ${what}`);
}

function rmRoots(roots) {
  for (const r of roots) { try { fs.rmSync(r, { recursive: true, force: true }); } catch { /* ignore */ } }
}

function migrationFixture(tag, { supervisorCarrier, anchorNamesWorker }) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `dr-mig-${tag}-`));
  fs.mkdirSync(path.join(root, ".quay"), { recursive: true });
  const st = statePaths(root, "worker");
  const supPid = supervisorCarrier ? spawnIdleProc() : null;
  const drvPid = spawnIdleProc();
  const anchorPid = spawnIdleProc();
  const inFlightPid = spawnIdleProc();
  if (supPid !== null) fs.writeFileSync(st.supervisorPidFile, `${supPid}\n`, "utf8");
  fs.writeFileSync(st.driverPidFile, `${drvPid}\n`, "utf8");
  fs.writeFileSync(st.inflightPidFile, `${inFlightPid}\n`, "utf8");
  fs.writeFileSync(path.join(root, ".quay", "anchor.pid"), `${anchorPid}\n`, "utf8");
  fs.writeFileSync(
    path.join(root, ".quay", "anchor.json"),
    JSON.stringify({ pid: anchorPid, startedAt: new Date().toISOString(), kinds: anchorNamesWorker ? ["worker"] : ["promotion"], host: "anchor" }),
    "utf8",
  );
  fs.writeFileSync(
    path.join(root, ".quay", "anchor-desired.json"),
    JSON.stringify({ kinds: ["promotion"], opts: {}, updatedBy: "quay-driver-start", updatedAt: new Date().toISOString() }),
    "utf8",
  );
  return { root, supPid, drvPid, anchorPid, inFlightPid, st };
}

const _anchorKernel = preferredAnchorKernel();

const DRIVER_RUNTIME_ABS = _anchorKernel
  ? path.join(path.dirname(_anchorKernel.path), _anchorKernel.stripTypes ? "driver-runtime.ts" : "driver-runtime.js")
  : KERNEL;

function fakeKindDriverSource(kind) {
  const spec = DRIVER_KINDS[kind];
  const carrier = spec.carriers.find((c) => c.endsWith("-round.jsonl")) ?? spec.carriers[0];
  return [
    `import fs from "node:fs";`,
    `import path from "node:path";`,
    `import { registerKindStop } from ${JSON.stringify(DRIVER_RUNTIME_ABS)};`,
    `export async function main(argv) {`,
    `  const args = argv.slice(2);`,
    `  const get = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };`,
    `  const root = get("--root");`,
    `  const pidFile = get("--pid-file");`,
    `  const interval = Number(get("--interval") ?? 150);`,
    `  if (pidFile) fs.writeFileSync(pidFile, String(process.pid) + "\\n", "utf8");`,
    `  const ctl = registerKindStop(${JSON.stringify(kind)});`,
    `  const file = path.join(root, ".quay", ${JSON.stringify(carrier)});`,
    `  let round = 0;`,
    `  while (!ctl.requested()) {`,
    `    round += 1;`,
    `    try { fs.appendFileSync(file, JSON.stringify({ round, ts: new Date().toISOString() }) + "\\n"); } catch {}`,
    `    await new Promise((r) => setTimeout(r, interval));`,
    `  }`,
    `  return 0;`,
    `}`,
    `if (process.argv[1] && process.argv[1].endsWith(${JSON.stringify(spec.driver)})) {`,
    `  main(process.argv).then((c) => process.exit(c));`,
    `}`,
  ].join("\n");
}

function kernelRun(args, root, extraEnv = {}) {
  return spawnSync(process.execPath, ["--no-warnings", "--experimental-strip-types", KERNEL, ...args], {
    encoding: "utf8",
    env: { ...process.env, QUAY_PLUGIN_ROOT: path.join(root, "plugin"), ...extraEnv },
    timeout: 60_000,
  });
}

function lastSupervisorDriverPid(root, kind) {
  const log = path.join(root, ".quay", `${DRIVER_KINDS[kind].prefix}-supervisor.log`);
  if (!fs.existsSync(log)) return null;
  const lines = fs.readFileSync(log, "utf8").split("\n").filter((l) => l.includes("supervisor: started driver pid="));
  if (lines.length === 0) return null;
  const m = /started driver pid=(\d+)/.exec(lines[lines.length - 1]);
  return m ? Number(m[1]) : null;
}

export { DRIVER_KINDS, DRIVER_RUNTIME_ABS, FAKE_DRIVER, FAKE_WORKER_DRIVER, KERNEL, KNOWN_KINDS, NEVER_RESIDENT_DRIVER, READY_AFTER_DRIVER, REPO_ROOT_DR, SLOW_START_DRIVER, TASK_FILTERS, __dirname, _anchorKernel, aliveness, anchorHosts, appendHeartbeatLine, applyTaskFilters, assert, assertNoResidue, carrierStats, collectFacts, deadPid, defaultReadyPoolArgv, defaultSelectorArgv, driverArgvForKind, driverPidIsReadinessMarker, execFileSync, fakeKindDriverSource, fileURLToPath, fs, git, isDue, kernelLayoutFixture, kernelRun, kernelSelfPath, kernelSiblingArgv, killIfAlive, killProcessGroupOf, killProcs, lastSupervisorDriverPid, launchArgv, legacyCarrierPids, makeBareRoot, makeFilterContext, makeGitWorktree, makeRoot, makeRootWithDriver, makeStopCondition, makeWorkerRoot, mcpFixture, migrationFixture, notifyManager, os, parseSelectorOutput, path, pidAlive, pollJsonFile, preferredAnchorKernel, procStartTimeMs, processesMentioning, promotion, readAnchorState, readDesired, readPid, readPidFile, readyPoolCheck, reportFacts, resolveKernelSibling, resolveMainRoot, resourceGateCheck, restartKind, rmRoots, run, runAc3FixtureOnce, runAsync, runLivenessCheck, runSelectorWorker, scheduleIsDue, shuffle, sourceChangedSince, sourceFilesMaxMtimeMs, spawn, spawnIdleProc, spawnOrphanProc, spawnSync, spawnTermIgnoringProc, splitArgs, statePaths, stopKind, stopLegacyPair, supervisorStaleness, teardownLiveDriver, test, updateDesired, verifyIndependently, waitFor, watchedSourceFiles, withKernelRoot, worker, writeAnchorHostedRoot, writePidFile };
