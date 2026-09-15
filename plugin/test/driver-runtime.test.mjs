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
} from "../scripts/driver-runtime.ts";
import { isDue } from "../scripts/routine-scheduler.ts";
import * as worker from "../scripts/worker-driver.ts";
import * as promotion from "../scripts/promotion-driver.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
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

// ── AC1（两级分层落地）：Layer 0 拥有共享机件 ─────────────────────────────────────────────────────

test("AC1 — Layer 0 (driver-runtime) exposes the shared runtime machinery (supervisor/loop/stopCondition/heartbeat/controlPlane/notify/profile/ResultVocab)", () => {
  assert.equal(typeof DRIVER_KINDS, "object", "registry table");
  assert.equal(typeof pidAlive, "function", "supervisor · pid 记账");
  assert.equal(typeof carrierStats, "function", "supervisor · 载体观测");
  assert.equal(typeof runAsync, "function", "loop · 异步 spawn 原语");
  assert.equal(typeof makeStopCondition, "function", "stopCondition · halt ∧ resourceGate");
  assert.equal(typeof appendHeartbeatLine, "function", "heartbeat · 无条件 round 落盘");
  assert.equal(typeof notifyManager, "function", "notify · send-to-session");
  assert.equal(typeof launchArgv, "function", "profile · LLM 配置解析");
  assert.equal(typeof verifyIndependently, "function", "ResultVocab · 三态含 not-evaluated");
  // controlPlane（driver-runtime re-export driver-shared 单一实现，worker 再 re-export 同一函数身份）。
  assert.equal(worker.resourceGateCheck, resourceGateCheck, "controlPlane/resourceGate 单一实现（identity）");
  assert.equal(typeof worker.serveControlPlane, "function", "controlPlane · MCP serveControlPlane");
});

test("AC1 — Layer 1a (task-processing) owns source/select/filters/verify as ONE shared list/single impl", () => {
  assert.equal(typeof defaultReadyPoolArgv, "function", "source");
  assert.equal(typeof readyPoolCheck, "function", "source");
  assert.equal(typeof shuffle, "function", "select");
  assert.equal(typeof parseSelectorOutput, "function", "select");
  assert.equal(typeof runSelectorWorker, "function", "select");
  assert.equal(typeof defaultSelectorArgv, "function", "select");
  // filters：可组合谓词【列表】单一实现（AC152）。
  assert.deepEqual(
    TASK_FILTERS.map((f) => f.name),
    ["notInFlight", "depsSatisfied", "touchesDisjoint", "retryCapNotExhausted", "notNeedsHuman"],
    "五个谓词是一个列表里的元素",
  );
  assert.equal(typeof applyTaskFilters, "function", "filters · applyTaskFilters");
  assert.equal(typeof verifyIndependently, "function", "verify · 独立复核单一实现");
});

test("AC1 — promotion/worker inherit the SAME Layer 0/1a functions (identity, ⛔ 非平行副本)", () => {
  assert.equal(worker.launchArgv, launchArgv, "worker profile === Layer 0 launchArgv");
  assert.equal(promotion.launchArgv, launchArgv, "promotion profile === Layer 0 launchArgv");
  assert.equal(worker.runLivenessCheck, runLivenessCheck, "worker liveness === Layer 0");
  assert.equal(promotion.runLivenessCheck, runLivenessCheck, "promotion liveness === Layer 0");
  assert.equal(worker.verifyIndependently, verifyIndependently, "worker ResultVocab === Layer 0");
  assert.equal(promotion.verifyIndependently, verifyIndependently, "promotion ResultVocab === Layer 0");
  assert.equal(worker.shuffle, shuffle, "worker select === Layer 1a");
  assert.equal(worker.readyPoolCheck, readyPoolCheck, "worker source === Layer 1a");
});

test("AC1 — Layer 1b (routine) reuses L0 schedule/heartbeat/notify; ⛔ 不重实现 loop/heartbeat/stopCondition", async () => {
  // schedule 复用 routine-scheduler 判定函数（同一函数身份），⛔ 不新造定时器。
  assert.equal(scheduleIsDue, isDue, "1b schedule === routine-scheduler isDue (identity)");
  // report 经 Layer 0 notify（reportFacts → notifyManager），非私有通知通道。
  assert.equal(typeof reportFacts, "function", "1b report exists (via Layer 0 notify)");
  assert.equal(typeof collectFacts, "function", "1b collect exists");
  // 1b 的产出是【读数】（Fact 含 not-evaluated 态），⛔ 不是【任务候选池/选择/verify】——那三段属 1a。
  const facts = [
    { name: "load", value: null, state: "not-evaluated", reason: "unreadable" },
    { name: "pool", value: 3, state: "verified", reason: null },
  ];
  const collected = await collectFacts([{ name: "r", schedule: { kind: "interval", minutes: 1 }, run: () => facts }]);
  assert.deepEqual(collected, facts, "collectFacts 汇集例程 Facts（⛔ 候选池，产出=读数）");
});

// ── AC2（supervisor 港进 TS）：registry 单一数据表 + 可单测纯函数 ─────────────────────────────────

test("AC2 — 8 张 bash registry 表 → DRIVER_KINDS 单一 TS 数据表", () => {
  // 2026-09-06 +meta（机制演进复核例程型 kind）+goal（G6 goal 机械环例程型 kind）。基线断言
  // 【有意更新】——它的作用是让新增 kind 必须显式过一次这条断言，而不是悄悄混进来；故保持逐字
  // 列举，⛔ 不改成 length 或 includes。
  assert.deepEqual(KNOWN_KINDS, ["promotion", "worker", "outer", "quality", "meta", "goal"], "六个 kind（suite 已按人 2026-09-07 裁定退役），registry 数据表承载差异");
  assert.equal(DRIVER_KINDS.promotion.driver, "promotion-driver.ts");
  assert.equal(DRIVER_KINDS.promotion.capFlag, "--cap", "promotion capFlag = --cap");
  assert.equal(DRIVER_KINDS.promotion.hasInterval, true);
  assert.equal(DRIVER_KINDS.promotion.pidSelf, true);
  assert.equal(DRIVER_KINDS.promotion.runPrefix, "pm-prod");
  assert.deepEqual(DRIVER_KINDS.promotion.carriers, ["promotion-outcome.jsonl", "promotion-round.jsonl"]);
  assert.equal(DRIVER_KINDS.worker.capFlag, "--concurrency", "worker capFlag = --concurrency");
  assert.equal(DRIVER_KINDS.worker.hasInterval, false);
  assert.equal(DRIVER_KINDS.worker.hasReconcile, true);
  assert.equal(DRIVER_KINDS.worker.pidSelf, false);
  assert.equal(DRIVER_KINDS.worker.controlFile, "worker-control.json");
  assert.equal(DRIVER_KINDS.promotion.controlFile, "promotion-control.json");
  // AC143：outer 例程型 kind（Layer 0 + 1b），registry 加一行接入（AC3）。
  assert.equal(DRIVER_KINDS.outer.driver, "outer-driver.ts");
  assert.equal(DRIVER_KINDS.outer.hasInterval, true);
  assert.equal(DRIVER_KINDS.outer.hasReconcile, false);
  assert.equal(DRIVER_KINDS.outer.pidSelf, true);
  assert.deepEqual(DRIVER_KINDS.outer.carriers, ["outer-round.jsonl"]);
  assert.equal(DRIVER_KINDS.outer.controlFile, "outer-control.json");
  // AC144：quality kind 是例程型（1b）——无 cap、按 interval 驱动、自写 pid、载体 = round 心跳。
  assert.equal(DRIVER_KINDS.quality.driver, "quality-gate-driver.ts");
  assert.equal(DRIVER_KINDS.quality.capFlag, "", "quality 无任务池 ⇒ 无 cap");
  assert.equal(DRIVER_KINDS.quality.hasInterval, true);
  assert.equal(DRIVER_KINDS.quality.hasReconcile, false);
  assert.equal(DRIVER_KINDS.quality.pidSelf, true);
  assert.deepEqual(DRIVER_KINDS.quality.carriers, ["quality-round.jsonl"]);
  assert.equal(DRIVER_KINDS.quality.controlFile, "quality-control.json");
  // G6：goal 机械环例程型 kind（Layer 0 + 1b），registry 加一行接入（同 quality/meta）。
  assert.equal(DRIVER_KINDS.goal.driver, "goal-driver.ts");
  assert.equal(DRIVER_KINDS.goal.capFlag, "", "goal 无任务池 ⇒ 无 cap");
  assert.equal(DRIVER_KINDS.goal.hasInterval, true);
  assert.equal(DRIVER_KINDS.goal.hasReconcile, false);
  assert.equal(DRIVER_KINDS.goal.pidSelf, true);
  assert.deepEqual(DRIVER_KINDS.goal.carriers, ["goal-round.jsonl"]);
  assert.equal(DRIVER_KINDS.goal.controlFile, "goal-control.json");
});

test("AC2 — driverArgvForKind maps --cap → per-kind cap flag (worker --concurrency)", () => {
  const promo = driverArgvForKind("/r", "promotion", { cap: "2", pidFile: "/r/.quay/p.pid", runId: "x" });
  assert.ok(promo.includes("--cap") && promo.includes("2"), "promotion --cap 2");
  const wk = driverArgvForKind("/r", "worker", { cap: "2", pidFile: "/r/.quay/w.pid", runId: "x" });
  assert.ok(wk.includes("--concurrency") && wk.includes("2"), "worker --concurrency 2");
  assert.ok(!wk.includes("--cap"), "worker argv carries --concurrency, ⛔ not --cap");
});

test("AC2 — carrierStats reads ALL carriers; last_record_ts = max across outcome + round", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "dr-carrier-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, ".quay"), { recursive: true });
  fs.writeFileSync(
    path.join(root, ".quay", "worker-outcome.jsonl"),
    '{"ts":"2026-08-23T10:00:00Z","task":"a","final_state":"completed"}\n', "utf8",
  );
  fs.writeFileSync(
    path.join(root, ".quay", "worker-round.jsonl"),
    '{"ts":"2026-08-23T10:00:00Z","round":1}\n{"ts":"2026-08-23T11:30:00Z","round":2}\n', "utf8",
  );
  const st = carrierStats(root, "worker");
  assert.equal(st.records, 3, "both carriers summed (1 outcome + 2 round)");
  assert.equal(st.lastTs, "2026-08-23T11:30:00Z", "max across BOTH carriers — round wins");
  assert.match(st.primaryPath, /worker-outcome\.jsonl$/, "primary carrier is outcome");
});

test("gap-meta-carrierstats — quality carrier timestamp key is judgedAt (⛔ not ts)", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "dr-carrier-q-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, ".quay"), { recursive: true });
  // quality 判词载体记录的时间戳键是 judgedAt（pool-quality-judge.ts buildQualityRoundRecord），
  // ⛔ 不是 ts。键不匹配会把 15 条真实记录读成 lastTs=null ⇒ 停摆与健康同形。
  fs.writeFileSync(
    path.join(root, ".quay", "quality-round.jsonl"),
    '{"round":1,"judgedAt":"2026-09-05T15:41:19.134Z","state":"failed"}\n' +
      '{"round":2,"judgedAt":"2026-09-05T15:44:02.000Z","state":"judged","distribution":{},"shouldRemoveIds":[],"verdicts":[]}\n',
    "utf8",
  );
  const st = carrierStats(root, "quality");
  assert.equal(st.records, 2, "both quality records counted");
  assert.equal(st.lastTs, "2026-09-05T15:44:02.000Z", "lastTs = max judgedAt, ⛔ null");
});

test("gap-meta-round-log-rel — quality carrier reads BOTH ts (heartbeat) and judgedAt, freshest wins", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "dr-carrier-qmix-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, ".quay"), { recursive: true });
  // quality-round.jsonl 混两种键：心跳（ts，每 30s 一条 liveness 直接量）+ 判词（judgedAt，间歇量）。
  // 修复前只读 judgedAt ⇒ 心跳不可见 ⇒ 池不触发就假报 stall；修复后两者较新者作 lastTs。
  fs.writeFileSync(
    path.join(root, ".quay", "quality-round.jsonl"),
    '{"round":1,"judgedAt":"2026-09-06T10:00:00.000Z","state":"failed"}\n' +
      '{"round":2,"run_id":"qg-x","pid":1,"ts":"2026-09-06T10:00:30.000Z","halted":false,"facts":[]}\n',
    "utf8",
  );
  const st = carrierStats(root, "quality");
  assert.equal(st.records, 2, "both heartbeat + judgment counted");
  assert.equal(st.lastTs, "2026-09-06T10:00:30.000Z", "lastTs = fresher heartbeat ts (⛔ judgedAt-only ⇒ stale)");
});

test("AC2 — pidAlive / readPidFile / aliveness (death direct-quantity, ⛔ not carrier-stall)", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "dr-alive-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  assert.equal(pidAlive(deadPid()), false, "dead pid ⇒ not alive");
  assert.equal(pidAlive(process.pid), true, "self pid ⇒ alive");
  assert.equal(readPidFile(path.join(root, ".quay", "missing.pid")), "", "missing ⇒ empty");
  writePidFile(path.join(root, ".quay", "promotion-driver-supervisor.pid"), Number(deadPid()));
  const a = aliveness(root, "promotion");
  assert.equal(a.supervisorAlive, false);
  assert.deepEqual(a.deaths, ["supervisor_dead"], "stale supervisor pid ⇒ supervisor_dead");
});

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

test("gap-driver-status-misreports — anchor-hosted kind with NO per-kind pid carrier ⇒ host=anchor & alive=1（⛔ 不报假死）", (t) => {
  const root = writeAnchorHostedRoot("nofile", ["worker", "outer", "promotion"]);
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  // ⚠️ 夹具的关键：**故意不写** `.quay/<kind>-driver.pid`（旧判据正是读它 ⇒ 旧代码在这里必然报假死）。
  assert.equal(fs.existsSync(path.join(root, ".quay", "worker-driver.pid")), false, "夹具：逐 kind pid 载体确实不存在");

  for (const kind of ["worker", "outer", "promotion"]) {
    assert.equal(readAnchorState(root)?.kinds.includes(kind), true, `${kind}: 回读面点名了它`);
    assert.equal(anchorHosts(root, kind).hosted, true, `${kind}: anchorHosts ⇒ hosted`);
    const a = aliveness(root, kind);
    assert.equal(a.host, "anchor", `${kind}: host=anchor`);
    assert.equal(a.anchorPid, process.pid, `${kind}: anchor_pid`);
    assert.equal(a.driverPid, process.pid, `${kind}: 承载进程 = anchor（⛔ 不是「pid 载体里碰巧写了谁」）`);
    assert.equal(a.driverAlive, true, `${kind}: driver_alive=1`);
    assert.equal(a.running, true, `${kind}: running=1`);
    assert.equal(a.supervisorAlive, false, `${kind}: 阶段 C 无 supervisor`);
    assert.deepEqual(a.deaths, [], `${kind}: ⛔ 不得报任何死因`);
  }
});

test("gap-driver-status-misreports — 逐 kind pid 载体【陈旧/指向死 pid】而 anchor 托管它 ⇒ 仍报 alive=1", (t) => {
  const root = writeAnchorHostedRoot("stale", ["outer"]);
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  // AC5 点名的另一半夹具形态：文件在，但内容是**一个死 pid**（旧判据下 `driverPid === anchorPid` 为假
  // ⇒ 同样报假死）。
  writePidFile(path.join(root, ".quay", "outer-driver.pid"), Number(deadPid()));
  const a = aliveness(root, "outer");
  assert.equal(a.host, "anchor");
  assert.equal(a.running, true, "承载进程是活着的 anchor ⇒ 在跑");
  assert.deepEqual(a.deaths, [], "⛔ 不因那张陈旧文件报 driver_dead");
});

test("gap-driver-status-misreports — 负控制：未被 anchor 点名的 kind / 无活 anchor / 回读面读不到", (t) => {
  // ① 活 anchor 托管 [worker,outer]，但**没有**点名 goal ⇒ goal 走旧形态（⛔ 「down」必须仍可报出）。
  const rootA = writeAnchorHostedRoot("neg-unnamed", ["worker", "outer"]);
  t.after(() => fs.rmSync(rootA, { recursive: true, force: true }));
  const g = aliveness(rootA, "goal");
  assert.equal(g.host, "supervisor", "未被点名 ⇒ host=supervisor（legacy 形态）");
  assert.equal(g.running, false, "未被点名 ⇒ 不报在跑");
  assert.equal(anchorHosts(rootA, "goal").hosted, false);

  // ② anchor.pid 指向一个**死进程**：回读面照样点名了，⛔ 但不得据此报「在跑」（自报不足以制造托管）。
  const rootB = writeAnchorHostedRoot("neg-deadanchor", ["worker"], { anchorPid: Number(deadPid()) });
  t.after(() => fs.rmSync(rootB, { recursive: true, force: true }));
  const w = aliveness(rootB, "worker");
  assert.equal(w.host, "supervisor", "anchor 死 ⇒ 回落 legacy 形态，⛔ 不报 anchor");
  assert.equal(w.anchorPid, null);
  assert.equal(w.running, false, "anchor 死 ⇒ 不报在跑");

  // ③ 回读面缺失（旧 anchor / 换代窗口）⇒ 兼容回退到逐 kind pid 载体那条旧判据（⛔ 读不懂 ⇒ 不报死亡）。
  const rootC = writeAnchorHostedRoot("neg-nostate", ["promotion"], { state: false });
  t.after(() => fs.rmSync(rootC, { recursive: true, force: true }));
  assert.equal(readAnchorState(rootC), null, "回读面缺失 ⇒ null（三态，⛔ 不是 kinds:[]）");
  writePidFile(path.join(rootC, ".quay", "promotion-driver.pid"), process.pid);
  assert.equal(anchorHosts(rootC, "promotion").hosted, true, "回退判据：载体写着活 anchor 的 pid");
  // ④ 回读面**换代**（其 pid 与 anchor.pid 对不上）⇒ 不采信它的 kinds（那是上一代 anchor 的名单）。
  fs.writeFileSync(
    path.join(rootC, ".quay", "anchor.json"),
    JSON.stringify({ pid: 999999, kinds: ["worker"], host: "anchor" }) + "\n",
    "utf8",
  );
  assert.equal(anchorHosts(rootC, "worker").hosted, false, "换代的回读面不采信");
});

test("gap-driver-status-misreports — AC2 交叉核对：`status --json` 同时给出 host/alive 与独立的载体新鲜度直接量", (t) => {
  const root = makeRoot("anchorhosted");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const q = path.join(root, ".quay");
  fs.mkdirSync(q, { recursive: true });
  fs.writeFileSync(path.join(q, "anchor.pid"), `${process.pid}\n`, "utf8");
  fs.writeFileSync(
    path.join(q, "anchor.json"),
    JSON.stringify({ pid: process.pid, kinds: ["promotion"], host: "anchor" }) + "\n",
    "utf8",
  );
  // 载体新鲜度 = **独立于 anchor 自报**的直接量（AC2 要求以它交叉核对 host/alive，⛔ 不是只信内部状态）。
  fs.writeFileSync(
    path.join(q, "promotion-round.jsonl"),
    JSON.stringify({ ts: new Date().toISOString(), runId: "dr-anchorhosted" }) + "\n",
    "utf8",
  );
  // ⛔ 夹具不写 .quay/promotion-driver.pid —— 逐 kind 载体缺失正是本缺陷的触发形态。
  const r = run(["status", "--root", root, "--kind", "promotion", "--json"]);
  assert.equal(r.status, 0, `status exit 0: ${r.stdout}\n${r.stderr}`);
  const j = JSON.parse(r.stdout.split("\n").find((l) => l.trim().startsWith("{")));
  assert.equal(j.host, "anchor", "JSON 契约：host=anchor");
  assert.equal(j.anchor_pid, process.pid);
  assert.equal(j.alive, 1, "JSON 契约：alive=1");
  assert.equal(j.running, 1, "JSON 契约：running=1");
  // ⚠️ server.ts 用 `driver_alive !== 1` 判「这个 kind 的循环没在转」⇒ 这个字段必须同修，否则只是把假死
  // 从一个字段搬到另一个（packages/quay/src/cli/server.ts 的 driverServiceReport）。
  assert.equal(j.driver_alive, 1, "JSON 契约：driver_alive=1（server status 的消费点）");
  assert.ok(Math.abs(Date.now() - Date.parse(j.last_record_ts)) < 60_000, "载体新鲜度直接量可读（交叉核对面）");
});

// ── 集成（spawn kernel CLI，与旧 promotion-driver-launch.sh 同形的端到端）────────────────────────

test("AC1 (稳定承载) — start from a worktree ⇒ supervisor/driver carried from MAIN checkout, ⛔ worktree", (t) => {
  const { main, wt } = makeGitWorktree();
  t.after(() => {
    run(["stop", "--root", main], { timeout: 15000 });
    fs.rmSync(main, { recursive: true, force: true });
    fs.rmSync(wt, { recursive: true, force: true });
  });

  const start = run(["start", "--root", wt, "--restart-delay", "1", "--run-id", "dr-ac1"], { pluginRoot: path.join(main, "plugin") });
  assert.equal(start.status, 0, `start failed: ${start.stdout}\n${start.stderr}`);
  assert.match(start.stderr, /relocating/, `relocation announced on stderr: ${start.stderr}`);

  // supervisor pid file landed in the MAIN checkout's .quay, ⛔ not the worktree's.
  assert.ok(fs.existsSync(path.join(main, ".quay", "promotion-driver-supervisor.pid")),
    "supervisor pid file lives in the MAIN checkout");
  assert.ok(!fs.existsSync(path.join(wt, ".quay", "promotion-driver-supervisor.pid")),
    "no supervisor pid file in the worktree");

  // supervisor cmdline = the kernel path (⛔ contains NO worktree path).
  const spid = fs.readFileSync(path.join(main, ".quay", "promotion-driver-supervisor.pid"), "utf8").trim();
  const cmdline = fs.readFileSync(`/proc/${spid}/cmdline`, "utf8").replace(/\0/g, " ");
  assert.ok(cmdline.includes("driver-runtime.ts"), `supervisor cmdline = TS kernel:\n${cmdline}`);
  assert.ok(cmdline.includes("__supervise"), `supervisor mode in cmdline:\n${cmdline}`);
  assert.ok(!cmdline.includes(wt), `cmdline carries NO worktree path (falsifiable):\n${cmdline}`);
});

test("AC2 (死亡告警) — stale supervisor pid ⇒ liveness DEATH + exit 1 + durable log", (t) => {
  const root = makeRoot("ac2");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, ".quay"), { recursive: true });
  fs.writeFileSync(path.join(root, ".quay", "promotion-driver-supervisor.pid"), String(deadPid()), "utf8");

  const r = run(["liveness", "--root", root, "--json"]);
  assert.equal(r.status, 1, `dead supervisor ⇒ exit 1, got ${r.status}`);
  const json = JSON.parse(r.stdout.trim());
  assert.equal(json.running, 0);
  assert.match(json.deaths, /supervisor_dead/, `deaths names supervisor_dead: ${json.deaths}`);
  assert.equal(json.supervisor_alive, 0);

  const log = fs.readFileSync(path.join(root, ".quay", "promotion-driver-liveness.log"), "utf8");
  assert.match(log, /DEATH deaths=supervisor_dead/, `durable DEATH line written:\n${log}`);
});

test("AC2 positive — live supervisor+driver ⇒ liveness exit 0 + deaths=none", (t) => {
  const root = makeRoot("ac2-pos");
  t.after(() => {
    run(["stop", "--root", root], { timeout: 15000 });
    fs.rmSync(root, { recursive: true, force: true });
  });
  const start = run(["start", "--root", root, "--restart-delay", "1", "--run-id", "dr-ac2pos"], { pluginRoot: path.join(root, "plugin") });
  assert.equal(start.status, 0, `start failed: ${start.stdout}\n${start.stderr}`);
  assert.ok(readPid(root, "promotion-driver-supervisor.pid"), "supervisor pid written");
  assert.ok(readPid(root, "promotion-driver.pid"), "driver pid written");

  const r = run(["liveness", "--root", root, "--json"]);
  assert.equal(r.status, 0, `healthy ⇒ exit 0, got ${r.status}: ${r.stdout}`);
  const json = JSON.parse(r.stdout.trim());
  assert.equal(json.running, 1);
  assert.equal(json.deaths, "none");
});

test("AC3 (supervisor 死) — kill -9 supervisor ⇒ supervisor_dead + orphan driver not 'running'", async (t) => {
  const root = makeRoot("ac3");
  const spid = () => readPid(root, "promotion-driver-supervisor.pid");
  const dpid = () => readPid(root, "promotion-driver.pid");
  t.after(() => {
    killIfAlive(dpid());
    killIfAlive(spid());
    fs.rmSync(root, { recursive: true, force: true });
  });

  const start = run(["start", "--root", root, "--restart-delay", "1", "--run-id", "dr-ac3"], { pluginRoot: path.join(root, "plugin") });
  assert.equal(start.status, 0, `start failed: ${start.stdout}\n${start.stderr}`);
  const supervisorPid = spid();
  assert.ok(supervisorPid, "supervisor pid recorded");

  const before = JSON.parse(run(["liveness", "--root", root, "--json"]).stdout.trim());
  assert.equal(before.running, 1, "running=1 before the kill");

  process.kill(Number(supervisorPid), "SIGKILL");

  let deaths = "";
  let running = -1;
  for (let i = 0; i < 50; i++) {
    const json = JSON.parse(run(["liveness", "--root", root, "--json"]).stdout.trim());
    deaths = json.deaths;
    running = json.running;
    if (/supervisor_dead/.test(deaths) && running === 0) break;
    await new Promise((r) => setTimeout(r, 100));
  }

  assert.match(deaths, /supervisor_dead/, `(a) supervisor_dead reported: ${deaths}`);
  assert.equal(running, 0, "(b) running=0 after supervisor death — orphan driver not 'in service'");
  assert.match(deaths, /driver_orphaned/, `orphan driver explicitly named: ${deaths}`);
});

test("AC138-3 — status --kind worker reads ALL carriers; last_record_ts = max", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "dr-ac138-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const scripts = path.join(root, "plugin", "scripts");
  fs.mkdirSync(scripts, { recursive: true });
  fs.mkdirSync(path.join(root, ".quay"), { recursive: true });
  fs.writeFileSync(path.join(scripts, "worker-driver.ts"), "", "utf8");
  fs.writeFileSync(path.join(root, ".quay", "worker-outcome.jsonl"), '{"ts":"2026-08-23T10:00:00Z","task":"a","final_state":"completed"}\n', "utf8");
  fs.writeFileSync(path.join(root, ".quay", "worker-round.jsonl"), '{"ts":"2026-08-23T10:00:00Z","round":1}\n{"ts":"2026-08-23T11:30:00Z","round":2}\n', "utf8");

  const st = JSON.parse(run(["status", "--kind", "worker", "--root", root, "--json"]).stdout.trim());
  assert.equal(st.carrier_records, 3, `both carriers summed: ${JSON.stringify(st)}`);
  assert.equal(st.last_record_ts, "2026-08-23T11:30:00Z", `max across BOTH carriers: ${JSON.stringify(st)}`);
  assert.match(st.carrier_path, /worker-outcome\.jsonl$/, "primary carrier is outcome");
});

test("AC1 (worker cap) — start --kind worker --cap 2 ⇒ driver argv carries --concurrency 2", async (t) => {
  const root = makeWorkerRoot("cap2");
  t.after(() => {
    run(["stop", "--kind", "worker", "--root", root], { timeout: 15000 });
    fs.rmSync(root, { recursive: true, force: true });
  });
  const r = run(["restart", "--kind", "worker", "--cap", "2", "--root", root, "--restart-delay", "1", "--run-id", "dr-wac1"], { pluginRoot: path.join(root, "plugin") });
  assert.equal(r.status, 0, `restart failed: ${r.stdout}\n${r.stderr}`);
  assert.ok(!/unknown argument: --concurrency/.test(r.stderr), `supervisor self-restart must accept --cap: ${r.stderr}`);
  const dump = await pollJsonFile(path.join(root, ".quay", "worker-argv-dump.json"));
  assert.ok(dump, "worker driver dumped its argv");
  assert.ok(dump.argv.includes("--concurrency") && dump.argv.includes("2"), `driver argv carries --concurrency 2: ${JSON.stringify(dump.argv)}`);
});

test("AC2 (worker 并发缺省) — start --kind worker with NO --cap ⇒ supervisor 不注入 env、不传 --concurrency（driver 自读 drivers.yml）", async (t) => {
  const root = makeWorkerRoot("capdef");
  t.after(() => {
    run(["stop", "--kind", "worker", "--root", root], { timeout: 15000 });
    fs.rmSync(root, { recursive: true, force: true });
  });
  // AC155：supervisor 不再注入 QUAY_MAX_TASK_SUBAGENTS="5"（旧第三份并发真相源）——缺省并发由 driver
  // 自己经 driver-config 读 drivers.yml（resolveConcurrency → driverCap 单一真相源）。剥掉环境里已有的
  // QUAY_MAX_TASK_SUBAGENTS 使本测对「supervisor 是否注入」敏感（旧行为注入 "5" ⇒ 本测 FAIL，⛔ 防假绿）。
  const env = { ...process.env };
  delete env.QUAY_MAX_TASK_SUBAGENTS;
  const r = run(["start", "--kind", "worker", "--root", root, "--restart-delay", "1", "--run-id", "dr-wac2"], { env, pluginRoot: path.join(root, "plugin") });
  assert.equal(r.status, 0, `start failed: ${r.stdout}\n${r.stderr}`);
  const dump = await pollJsonFile(path.join(root, ".quay", "worker-argv-dump.json"));
  assert.ok(dump, "worker driver dumped its argv/env");
  assert.equal(dump.capEnv, null, `supervisor must NOT inject QUAY_MAX_TASK_SUBAGENTS (driver resolves cap from drivers.yml itself): ${JSON.stringify(dump)}`);
  assert.ok(!dump.argv.includes("--concurrency"), `default resolved by driver from drivers.yml, not an explicit flag: ${JSON.stringify(dump.argv)}`);
});

// ── negative control（gap-driver-test-fixture-json-read-before-write-complete-race AC3）────────────
// 故意制造 "文件存在但内容未写完" 的中间态：旧的 existsSync-then-JSON.parse 读法会报错，新的
// pollJsonFile 会把它当 "还没写完" 继续轮询，最终读到完整内容。

test("negative control — pollJsonFile waits through a torn (exists-but-partial) JSON file instead of a fatal parse error", async (t) => {
  const root = makeWorkerRoot("nc-torn");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const p = path.join(root, ".quay", "worker-argv-dump.json");
  fs.mkdirSync(path.dirname(p), { recursive: true });

  // (a) 旧逻辑（existsSync → JSON.parse）在中间态报错——先证负控制非空（旧读法确实会撞竞态）。
  fs.writeFileSync(p, '{"argv":["--concurrency"', "utf8");
  assert.throws(() => JSON.parse(fs.readFileSync(p, "utf8")), "old existsSync-then-JSON.parse read throws on a torn file");

  // (b) 新逻辑在中间态继续轮询，等写入方补完内容后读到完整 JSON。
  const complete = { argv: ["--concurrency", "2"], capEnv: null };
  const finish = new Promise((resolve) => setTimeout(() => {
    fs.writeFileSync(p, JSON.stringify(complete), "utf8");
    resolve();
  }, 60));
  const dump = await pollJsonFile(p, 2000, 10);
  await finish;
  assert.deepEqual(dump, complete, "poller waited through the torn state and read the completed file");
});

// ── source-refresh（AC-184 陈旧写者收尾）：supervisor 在源码推进到 driver 启动时刻之后重拉 driver ──
// 判据（AC）：`node --experimental-strip-types --test plugin/test/driver-runtime.test.mjs` 里，下面的
// 集成测试证明 supervisor 在 driver-filters.ts 推进到运行中 driver 之后 respawn 该 driver——常驻 driver
// 因此自刷新，AC-184 不再每提交一次就陈旧写者复发。判据取假（DoD）：删掉 runSupervisor 里的 sourceCheck
// 对照 ⇒ 源码推进后 pid 永不变 ⇒ 集成测试红。

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
function processesMentioning(needle) {
  const ps = spawnSync("ps", ["-eo", "pid=,args="], { encoding: "utf8" });
  if (ps.status !== 0 || typeof ps.stdout !== "string") return null;
  return ps.stdout.split("\n").map((l) => l.trim()).filter((l) => l && l.includes(needle));
}

/** 只在 pid 【确实是它自己进程组的组长】时才 `kill(-pid)`——否则 `kill(-pgid)` 会打到【别人的】进程组
 *  （本机同一时刻就有别的任务 worktree 的同类残留，误杀的代价是别人的套件）。`startKind` 以
 *  `detached: true` 起 supervisor（setsid ⇒ pgid == pid），但这里仍【实测一次 pgid】，⛔ 不假设它成立
 *  （硬规则 4：「应该成立」的量不是测量）。pid 已死 / 读不到 ⇒ 静默返回。 */
function killProcessGroupOf(pidRaw) {
  const pid = Number(pidRaw);
  if (!pid) return;
  const r = spawnSync("ps", ["-o", "pgid=", "-p", String(pid)], { encoding: "utf8" });
  if (r.status !== 0 || Number((r.stdout || "").trim()) !== pid) return;
  try { process.kill(-pid, "SIGKILL"); } catch { /* already gone */ }
}

/** 真实被监督 driver 的夹具清理（唯一定义处；⛔ 别在别处再抄一份顺序）。三段顺序固定，整段在
 *  try/finally 里：① 走机制路径 stop；② 进程组兜底 kill（supervisor 是它自己进程组的组长 ⇒ 一次覆盖
 *  supervisor 与它 fork 出的全部 driver 化身——只 kill 直接子进程不够，这正是同仓库
 *  `detached-test-child-leak-hangs-suite` 的同类模式）；③ 最后才删 root。 */
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
function runAc3FixtureOnce(injectFail) {
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  if (injectFail) env.QUAY_AC3_LIVE_INJECT_FAIL = "1";
  else delete env.QUAY_AC3_LIVE_INJECT_FAIL;
  const r = spawnSync(
    process.execPath,
    ["--experimental-strip-types", "--test", "--test-name-pattern=AC3 \\(gap-ac203\\)", path.join(__dirname, "driver-runtime.test.mjs")],
    { encoding: "utf8", env, timeout: 180000 },
  );
  const m = /^\[AC3 fixture\] root=(\S+) run_id=(\S+)$/m.exec(r.stdout || "");
  return { status: r.status, stdout: r.stdout || "", stderr: r.stderr || "", root: m ? m[1] : null };
}

/** 一次对照的读数与断言：零残留进程 + root 已删。 */
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

const REPO_ROOT_DR = path.resolve(__dirname, "..", "..");

/** 三源 MCP fixture（家目录 + 一个项目目录），⛔ 不读真实 ~/.claude*（AC7 同款缝）。 */
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

test("AC1/AC6 — an EMPTY blacklist adds no mcp flag and the argv does not depend on MCP config at all", (t) => {
  const fx = mcpFixture(t);
  for (const role of ["outer", "manager", "pool-judge", "meta-driver"]) {
    const plain = launchArgv(role, "P", REPO_ROOT_DR);
    const withRoots = launchArgv(role, "P", REPO_ROOT_DR, { mcpRoots: fx.roots });
    assert.deepEqual(plain, withRoots, `${role}: argv must be INDEPENDENT of the MCP configuration`);
    assert.ok(!plain.includes("--strict-mcp-config"), `${role}: no --strict-mcp-config`);
    assert.ok(!plain.includes("--mcp-config"), `${role}: no --mcp-config`);
    assert.equal(plain.at(-2), "-p", `${role}: the -n <name> -p <prompt> tail is intact`);
    assert.equal(plain[plain.indexOf("-n") + 1], `quay-${role}`, `${role}: name resolved from the role`);
    assert.equal(plain.at(-1), "P", `${role}: prompt stays the last payload`);
  }
});

test("AC1 wiring — the three code-writing roles carry --strict-mcp-config --mcp-config, blacklist subtracted", (t) => {
  const fx = mcpFixture(t);
  for (const role of ["task-worker", "selector", "fix-worker"]) {
    const argv = launchArgv(role, "P", REPO_ROOT_DR, { mcpRoots: fx.roots });
    const i = argv.indexOf("--strict-mcp-config");
    assert.ok(i >= 0, `${role}: must carry --strict-mcp-config`);
    assert.equal(argv[i + 1], "--mcp-config");
    const table = JSON.parse(argv[i + 2]).mcpServers;
    assert.equal(table["chrome-devtools"], undefined, `${role}: chrome-devtools dropped`);
    assert.equal(table["playwright"], undefined, `${role}: playwright dropped`);
    // ⛔ 负控制：黑名单不得连坐掉 worker 自己要用 quay 工具（AC4）。
    assert.ok(table["plugin_quay_quay"], `${role}: the quay MCP server must SURVIVE`);
    assert.ok(table["user-extra"] && table["proj-server"], `${role}: unrelated servers survive`);
    assert.equal(argv.at(-1), "P", `${role}: prompt stays the last payload`);
  }
});

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
function spawnIdleProc() {
  const c = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000);"], { stdio: "ignore" });
  c.unref();
  return c.pid;
}

/** 一个**不是本进程子进程**的活进程（由短命中转进程起出来、随即被 init 收养）。
 *  生产里「旧 supervisor 已死、driver 还活着」的孤儿正是这个形状；夹具也必须这样造，⛔ 不能用
 *  `spawnIdleProc()`——那是本进程的直接子进程，而 `spawnSync` 会**阻塞事件循环** ⇒ libuv 收不到
 *  SIGCHLD ⇒ 它死后成为**僵尸**：`kill -0` 仍为真而 SIGKILL 无效（实测本用例曾因此假红，
 *  报 `remaining pid=[…]` 且进程其实早已退出）。僵尸恰是「验证而不是假设」这条修复的正当场景，
 *  ⛔ 但它不是本用例要造的那一格。 */
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

/** 一个「收到 SIGTERM 也不退出」的进程（模拟旧 supervisor 卡在收尾 + 在信号之后重拉 driver）：
 *  收到 SIGTERM 时把 `pidToWrite` 写进 `carrierFile`，自己不退出（⇒ 只可能被 SIGKILL 收掉）。
 *  ⛔ 必须先 `waitFor` 它写出的 `readyFile` 再对它发信号：Node 子进程要几十毫秒才装得上 handler，
 *  在那之前 SIGTERM 走**缺省动作**（进程直接死）⇒ 夹具会静默退化成「一个普通的 idle 进程」，
 *  而**用例要测的正是那个 handler**。实测：不等 ready 时 `signalled` 只有 2 条、重拉出的新 pid 永不被看见。 */
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

/** 轮询到条件为真；超时**抛**（⛔ 不返回 falsy——本仓库实测过「裸 await 一个超时返回 falsy 的等待 = 恒真空转」）。 */
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

/** 迁移期形状的夹具：kind=`worker`，盘上有两张**旧形态** pid 载体、一个活着的 anchor（回读面点名
 *  `anchorHostsKind` 说的那个 kind，缺省不是 worker）、以及 `.quay/anchor-desired.json`（「任意一个
 *  kind 迁移过」这个全局事实——正是 `anchorOwns` 回落规则读的那一个）。 */
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

/** 直跑内核（`quay driver` 的真正实现入口；cli/driver.ts 是薄壳）。与上面的 `run()` 的唯一差别是
 *  **不**钉 `QUAY_DRIVER_LEGACY_SUPERVISOR=1` —— 本组的判别正是「默认（anchor）路径」。 */
function kernelRun(args, root, extraEnv = {}) {
  return spawnSync(process.execPath, ["--no-warnings", "--experimental-strip-types", KERNEL, ...args], {
    encoding: "utf8",
    env: { ...process.env, QUAY_PLUGIN_ROOT: path.join(root, "plugin"), ...extraEnv },
    timeout: 60_000,
  });
}

/** 从旧 supervisor 自己的日志里取它 spawn 的 driver pid（⛔ 不用 `.quay/<k>.pid`：本夹具里 anchor
 *  托管的同一个 kind 也在写那张文件 ⇒ 它是两个写者的竞争产物，读它无法归属）。 */
function lastSupervisorDriverPid(root, kind) {
  const log = path.join(root, ".quay", `${DRIVER_KINDS[kind].prefix}-supervisor.log`);
  if (!fs.existsSync(log)) return null;
  const lines = fs.readFileSync(log, "utf8").split("\n").filter((l) => l.includes("supervisor: started driver pid="));
  if (lines.length === 0) return null;
  const m = /started driver pid=(\d+)/.exec(lines[lines.length - 1]);
  return m ? Number(m[1]) : null;
}

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

