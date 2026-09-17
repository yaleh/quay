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

// SPLIT from driver-runtime.test.mjs by gap-suite-split-15-over-30s-test-files — shard 2/10 (4 tests). Shared fixtures: ./helpers/driver-runtime-harness.mjs (single source).

import { test } from "node:test";
import { assert, carrierStats, driverArgvForKind, fs, os, path, promotion, worker } from "./helpers/driver-runtime-harness.mjs";

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
