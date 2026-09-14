// @test-group engine
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
import { execFileSync, spawnSync } from "node:child_process";
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
  statePaths,
  kernelSelfPath,
  watchedSourceFiles,
  sourceFilesMaxMtimeMs,
  sourceChangedSince,
  supervisorStaleness,
  procStartTimeMs,
  driverPidIsReadinessMarker,
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

function run(args, opts = {}) {
  const env = { ...process.env, ...(opts.env || {}) };
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
