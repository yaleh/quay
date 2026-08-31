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
  return spawnSync(process.execPath, ["--experimental-strip-types", KERNEL, ...args], {
    encoding: "utf8",
    env: opts.env || { ...process.env },
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
  assert.deepEqual(KNOWN_KINDS, ["promotion", "worker", "outer", "quality", "suite"], "五个 kind，registry 数据表承载差异");
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

  const start = run(["start", "--root", wt, "--restart-delay", "1", "--run-id", "dr-ac1"]);
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
  const start = run(["start", "--root", root, "--restart-delay", "1", "--run-id", "dr-ac2pos"]);
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

  const start = run(["start", "--root", root, "--restart-delay", "1", "--run-id", "dr-ac3"]);
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
  const r = run(["restart", "--kind", "worker", "--cap", "2", "--root", root, "--restart-delay", "1", "--run-id", "dr-wac1"]);
  assert.equal(r.status, 0, `restart failed: ${r.stdout}\n${r.stderr}`);
  assert.ok(!/unknown argument: --concurrency/.test(r.stderr), `supervisor self-restart must accept --cap: ${r.stderr}`);
  const dump = await (async () => {
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      const p = path.join(root, ".quay", "worker-argv-dump.json");
      if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, "utf8"));
      await new Promise((r) => setTimeout(r, 50));
    }
    return null;
  })();
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
  const r = run(["start", "--kind", "worker", "--root", root, "--restart-delay", "1", "--run-id", "dr-wac2"], { env });
  assert.equal(r.status, 0, `start failed: ${r.stdout}\n${r.stderr}`);
  const dump = await (async () => {
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      const p = path.join(root, ".quay", "worker-argv-dump.json");
      if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, "utf8"));
      await new Promise((r) => setTimeout(r, 50));
    }
    return null;
  })();
  assert.ok(dump, "worker driver dumped its argv/env");
  assert.equal(dump.capEnv, null, `supervisor must NOT inject QUAY_MAX_TASK_SUBAGENTS (driver resolves cap from drivers.yml itself): ${JSON.stringify(dump)}`);
  assert.ok(!dump.argv.includes("--concurrency"), `default resolved by driver from drivers.yml, not an explicit flag: ${JSON.stringify(dump.argv)}`);
});
