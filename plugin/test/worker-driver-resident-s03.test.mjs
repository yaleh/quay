// @test-group lowconc
// worker-driver-resident.test.mjs — resident driver loop (selector/heartbeat/liveness/wrapper) + continue/fan-in-merge mechanics. Split from gap-suite-file-split-two-longest.
// SPLIT from worker-driver-resident.test.mjs by gap-suite-split-15-over-30s-test-files — shard 3/8 (6 tests). Shared fixtures: ./helpers/worker-driver-resident-harness.mjs (single source).

import { test } from "node:test";
import { WAIT_BASE_MS, after, assert, computeWorkerRoundRecord, counterNodeE, defaultLivenessCheckArgv, fs, makeGitRoot, makeRoot, path, readOutcomeLines, readRoundLines, rmSafe, runLivenessCheck, spawn, spawnResident, waitFor, writeTaskFile } from "./helpers/worker-driver-resident-harness.mjs";

test("AC138-3 pure — computeWorkerRoundRecord: ts is the first field (supervisor _carrier_stats greps \"ts\")", () => {
  const rec = computeWorkerRoundRecord({
    round: 1, runId: "wk-prod-x", pid: 42, at: "2026-08-23T12:00:00.000Z",
    action: "stop", inFlight: 0, pool: 0, stopReason: "pool-empty (no dispatchable candidate in the ready pool)",
    coldStartInflight: ["gap-cs-a"],
  });
  assert.equal(rec.ts, "2026-08-23T12:00:00.000Z");
  assert.equal(rec.round, 1);
  assert.equal(rec.run_id, "wk-prod-x");
  assert.equal(rec.action, "stop");
  assert.equal(rec.in_flight, 0);
  assert.equal(rec.pool, 0);
  assert.match(rec.stop_reason, /pool-empty/);
  assert.deepEqual(rec.cold_start_inflight, ["gap-cs-a"], "cold-start observation lands in the round record (production-visible carrier)");
  // ts 首字段：JSON.stringify 后 `"ts":"…"` 是记录的第一个键（supervisor 的 grep 依赖该形状）。
  const json = JSON.stringify(rec);
  assert.ok(json.startsWith('{"ts":"'), `ts is the first JSON field: ${json.slice(0, 20)}…`);
});


test("AC138-3 — pool-empty round still writes a round heartbeat (⛔ outcome stays absent; round is the liveness carrier)", async (t) => {
  const root = makeRoot("ac138-round");
  // ready-pool returns empty ⇒ resident loop records a stop round then polls (no worker spawned; it no
  // longer exits on pool-empty — pool-empty is transient, promotion-driver keeps filling it).
  const drv = spawnResident(root, [
    "--ready-pool-cmd", "node -e console.log(JSON.stringify({ready:[],pool:0}))",
    "--selector-cmd", "node -e console.log('gap-a\\x20pick')",
    "--resource-gate-cmd", "node -e process.exit(0)",
    "--worker-cmd-exact", "node -e process.exit(0)",
    "--interval", "20",
  ]);
  t.after(() => drv.stop());
  t.after(() => rmSafe(root));
  await waitFor(() => readRoundLines(root).length >= 1);
  const rounds = readRoundLines(root);
  assert.ok(rounds.length >= 1, "at least one round record written even when the pool is empty");
  const last = rounds[rounds.length - 1];
  assert.equal(last.action, "stop", "pool-empty round is recorded as stop (not dispatch)");
  assert.match(last.stop_reason, /pool-empty/);
  assert.equal(last.in_flight, 0);
  assert.ok(last.ts, "round record carries a ts field (the supervisor's last_record_ts reads it)");
  // ⛔ 取假对照组：outcome 在池空轮【不写】——正是 round 存在的理由（outcome 停更 ≠ 死亡）。
  assert.equal(readOutcomeLines(root).length, 0, "no outcome on a pool-empty round; round is the unconditional carrier");
});

// ── liveness 接线（gap-resident-driver-stable-carrier-liveness Finding：liveness 子命令零调用者）──
// AC2 承诺「driver/supervisor 死时有机件在窗口内检测并报告」，但此前没有任何东西调 liveness 子命令
// （log 13h 无更新）。修法 = driver 自身 round 循环每轮顺手调一次。本组验证：①defaultLivenessCheckArgv
// 复用 launch 脚本 liveness 子命令（⛔ 不重写存活判定）、②runLivenessCheck 的 checked/deaths 语义
// （checked=false = 未查成，⛔ 不是健康）、③resident loop 每轮真调它（counter 缝）。


test("defaultLivenessCheckArgv — reuse the TS kernel liveness subcommand; kind from file identity", () => {
  // AC151：supervisor 港进 TS 后，liveness 子命令 = `node … driver-runtime.ts liveness --kind … --root …`。
  const argv = defaultLivenessCheckArgv("/r", "worker");
  assert.equal(argv[0], process.execPath, "spawn the node binary (⛔ not bash — kernel is TS)");
  assert.equal(argv[1], "--experimental-strip-types");
  assert.ok(argv[2].endsWith("driver-runtime.ts"), `kernel path = driver-runtime.ts, got ${argv[2]}`);
  assert.equal(argv[3], "liveness");
  assert.deepEqual(argv.slice(argv.indexOf("--kind"), argv.indexOf("--kind") + 2), ["--kind", "worker"]);
  assert.deepEqual(argv.slice(argv.indexOf("--root"), argv.indexOf("--root") + 2), ["--root", "/r"]);
  assert.ok(argv.includes("--json"), "machine-readable verdict (the driver parses deaths/running)");
  // 同一函数传不同 kind（promotion-driver.ts 传 promotion）。
  const promo = defaultLivenessCheckArgv("/r", "promotion");
  assert.deepEqual(promo.slice(promo.indexOf("--kind"), promo.indexOf("--kind") + 2), ["--kind", "promotion"]);
});


test("runLivenessCheck — checked/deaths/running semantics (checked=false = NOT evaluated, ⛔ not healthy)", () => {
  // 健康：deaths=none ⇒ deaths 归一为 null + checked=true。
  assert.deepEqual(
    runLivenessCheck("/r", "worker", ["node", "-e", "console.log(JSON.stringify({deaths:'none',running:true}))"]),
    { checked: true, deaths: null, running: true },
  );
  // 检出死亡：deaths 非空 ⇒ 原样带上（supervisor_dead 是 AC3 的真实告警）。
  assert.deepEqual(
    runLivenessCheck("/r", "worker", ["node", "-e", "console.log(JSON.stringify({deaths:'supervisor_dead,driver_orphaned',running:false}))"]),
    { checked: true, deaths: "supervisor_dead,driver_orphaned", running: false },
  );
  // 退出 1（liveness 子命令检出死亡的退出码）仍算「查过」——stdout 有 deaths JSON。
  const exit1 = runLivenessCheck("/r", "worker", ["node", "-e", "console.log(JSON.stringify({deaths:'driver_dead',running:false}));process.exit(1)"]);
  assert.deepEqual(exit1, { checked: true, deaths: "driver_dead", running: false });
  // 脚本缺失 ⇒ checked=false（未查成），⛔ 不是「健康」（硬规则 3b：无法评估 ≠ 合格）。
  assert.deepEqual(
    runLivenessCheck("/r", "worker", ["bash", "/nonexistent/promotion-driver-launch.sh", "liveness"]),
    { checked: false, deaths: null, running: false },
  );
});


test("liveness wiring — resident loop calls the liveness checker each round (Finding AC2 no-caller fix)", async (t) => {
  // 用 git root + done 任务（镜像 AC1 resident-loop 测试），worker 落地 → 驱动继续轮询（池空不退出）。
  const root = makeGitRoot("liveness-wire");
  writeTaskFile(root, "gap-a", "done");
  writeTaskFile(root, "gap-b", "done");
  const rpcFile = path.join(root, "rpc.cnt");
  const selFile = path.join(root, "sel.cnt");
  const livenessCnt = path.join(root, "liveness.cnt");
  // ready-pool 返回 2 个候选 → 选择环起 2 个 worker → 每轮一个 liveness 检查。
  const drv = spawnResident(root, [
    "--ready-pool-cmd", counterNodeE(rpcFile, "JSON.stringify({ready:n<=1?['gap-a','gap-b']:[],pool:n<=1?2:0})"),
    "--selector-cmd", counterNodeE(selFile, "n===0?'gap-a\\x20first-pick':n===1?'gap-b\\x20second-pick':'gap-a\\x20again'"),
    "--resource-gate-cmd", "node -e process.exit(0)",
    "--worker-cmd-exact", "node -e process.exit(0)",
    "--concurrency", "2",
    "--liveness-cmd", counterNodeE(livenessCnt, "JSON.stringify({kind:'worker',deaths:'none',running:true})"),
    "--interval", "20",
  ]);
  t.after(() => drv.stop());
  t.after(() => rmSafe(root));
  // 这一步等的是 2 次 worker 落地（每次含一个真 liveness 子进程 spawn + 落地 git 读）——实测空载即
  // ~30s，故取 2×基网：上限 = WAIT_BASE_MS × 2 × 本机当下的抢占因子（⛔ 不再是裸 30000）。
  await waitFor(() => readRoundLines(root).length >= 1 && readOutcomeLines(root).length >= 2, WAIT_BASE_MS * 2);
  const rounds = readRoundLines(root);
  const livenessCount = fs.existsSync(livenessCnt) ? Number(fs.readFileSync(livenessCnt, "utf8")) : 0;
  // liveness 在每轮【开头】跑（writeRound 之前），结果写进每轮 round 记录。接线证明取两个直接量：
  // ① counter ≥ 1 ⇒ liveness 命令被真实 spawn 过（零调用者 Finding 的根已修）；② 每轮 round 都带
  // 非 null 的 liveness 结果（接线存在）。⛔ 不做 livenessCount ≥ rounds.length / 每轮 checked===true：
  // 满载 scoped suite 并行时 liveness spawn 偶发失败——counter 不增但 round 照写、checked=false 是合法
  // 「没查成」态（硬规则 3b，≠ 没接线）。把「没查成」当「没接线」= 该断言 flaky（3 轮机械 fan-in 全红）。
  assert.ok(livenessCount >= 1, "liveness was called (zero-caller fix): counter is non-zero");
  assert.ok(rounds.length >= 1, "at least one round ran");
  for (const rec of rounds) {
    assert.ok(rec.liveness !== null, `round carries a liveness result (wiring exists): ${JSON.stringify(rec.liveness)}`);
  }
});

// ── gap-superseded-task-residual-worktree-never-reclaimed：reconcile 步接线 + 端到端回收 ─────────────
// AC6（接线，非「函数存在」）：常驻循环 reconcile 步实际调用 reclaimSupersededWorktrees（⛔ 仅导出函数而
// reconcile 步不调 ⇒ round 记录无 superseded_reclaim 字段 ⇒ 该 AC 假）。AC7（读生产载体）：候选数为 0
// 也记 0（⛔ 不省略）——「跑过且无候选」与「压根没跑」在载体上可区分；关掉注入缝（spawnResident 不注入
// 任何 reclaim 缝，走真实 git//proc）后仍通过（否则它只是回声）。


test("AC6 (superseded-reclaim wiring) — reconcile step actually calls reclaimSupersededWorktrees (round carries superseded_reclaim, candidate 0 recorded)", async (t) => {
  const root = makeGitRoot("sup-wire");
  writeTaskFile(root, "gap-a", "done");
  // 池空 ⇒ 无派发，但 reconcile 步每轮照跑 ⇒ round 记录必须带 superseded_reclaim（候选 0 记 0，⛔ 省略）。
  const drv = spawnResident(root, [
    "--ready-pool-cmd", "node -e console.log(JSON.stringify({ready:[],pool:0}))",
    "--selector-cmd", "node -e console.log('gap-a\\x20pick')",
    "--resource-gate-cmd", "node -e process.exit(0)",
    "--worker-cmd-exact", "node -e process.exit(0)",
    "--interval", "20",
  ]);
  t.after(() => drv.stop());
  t.after(() => rmSafe(root));
  await waitFor(() => readRoundLines(root).length >= 1);
  const rounds = readRoundLines(root);
  assert.ok(rounds.length >= 1, "at least one round ran");
  for (const rec of rounds) {
    assert.ok(rec.superseded_reclaim !== null && rec.superseded_reclaim !== undefined,
      `round carries a superseded_reclaim result (reconcile wiring exists): ${JSON.stringify(rec.superseded_reclaim)}`);
    assert.equal(rec.superseded_reclaim.candidateCount, 0, "AC7: candidate 0 is recorded (⛔ not omitted)");
  }
});
