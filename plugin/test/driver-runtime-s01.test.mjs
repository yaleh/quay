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

// SPLIT from driver-runtime.test.mjs by gap-suite-split-15-over-30s-test-files — shard 1/4 (11 tests). Shared fixtures: ./helpers/driver-runtime-harness.mjs (single source).

import { test } from "node:test";
import { DRIVER_KINDS, KNOWN_KINDS, TASK_FILTERS, aliveness, anchorHosts, appendHeartbeatLine, applyTaskFilters, assert, carrierStats, collectFacts, deadPid, defaultReadyPoolArgv, defaultSelectorArgv, driverArgvForKind, fs, isDue, launchArgv, makeStopCondition, notifyManager, os, parseSelectorOutput, path, pidAlive, promotion, readAnchorState, readPidFile, readyPoolCheck, reportFacts, resourceGateCheck, run, runAsync, runLivenessCheck, runSelectorWorker, scheduleIsDue, shuffle, spawn, verifyIndependently, worker, writeAnchorHostedRoot, writePidFile } from "./helpers/driver-runtime-harness.mjs";

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
