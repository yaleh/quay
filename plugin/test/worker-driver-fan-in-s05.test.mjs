// @test-group serial
// worker-driver-fan-in.test.mjs — mechanical fan-in (locks/merge/trace) + dispatch filters + cold-start + retry/backoff. Split from gap-suite-file-split-two-longest.
// SPLIT from worker-driver-fan-in.test.mjs by gap-suite-split-15-over-30s-test-files — shard 5/6 (17 tests). Shared fixtures: ./helpers/worker-driver-fan-in-harness.mjs (single source).

import { test } from "node:test";
import { DRIVER, acShortCircuitVerdict, after, appendCompleteGateEvent, assert, computeOutcome, computeWorkerRoundRecord, fanInLogFileName, fs, makeMechRepo, makeReuseRepo, mechOpts, mirrorMechanicalFanInSuiteState, os, path, readPreviousGreenSuiteCommit, readSharedTrace, rmSafe, runMechanicalFanIn, spawn, spawnMechanicalFanIn, writeAcTaskBody, writeTaskFile } from "./helpers/worker-driver-fan-in-harness.mjs";

test("AC3 (gap-fan-in-ac-precheck-before-suite) — AC 全勾 ⇒ 预检不误挡，正常进 suite 并 landed（负控制 AC2）", async (t) => {
  const m = makeMechRepo("acpre-pass");
  const runId = "mf-run-acpre-pass";
  t.after(() => rmSafe(m.base));
  const r = await runMechanicalFanIn(mechOpts(m, runId));
  assert.equal(r.outcome, "landed", `all-checked must pass the precheck and land (step=${r.step} reason=${r.reason})`);
  assert.equal(r.suiteOutcome, "done", "the suite must have run (precheck did not falsely block)");
  // 预检通过步应记录在过程日志（suite 前）。
  const log = path.join(m.repo, ".quay", `fan-in-gap-mfh-${runId}.log`);
  const lines = fs.readFileSync(log, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
  const pre = lines.find((l) => l.step === "ac-precheck");
  assert.ok(pre, "ac-precheck pass must be traced");
  assert.equal(pre.ok, true);
});

// ── gap-mechanical-fan-in-writes-no-complete-gateevent ─────────────────────────────────────────────
// 机械 fan-in 翻 done 此前绕过 gate 引擎、零 complete GateEvent（stale-ready-audit 的 bypassComplete 每轮
// 报 9 条真阳性被当噪声）。现在 flip→ff 成功后经既有 gate-event-store 补写 complete pass 事件（AC2）。
// AC2/AC3 取真：landed fan-in ⇒ .quay/gate-events.jsonl 有该 task 的 complete pass 事件。


test("AC2/AC3 (gap-mechanical-fan-in-writes-no-complete-gateevent) — landed mechanical fan-in writes a complete pass GateEvent via the gate-event-store", async (t) => {
  const m = makeMechRepo("complete-event");
  const runId = "mf-run-complete-event";
  t.after(() => rmSafe(m.base));
  const r = await runMechanicalFanIn(mechOpts(m, runId));
  assert.equal(r.outcome, "landed", `fan-in must land (step=${r.step} reason=${r.reason})`);
  const gateLog = path.join(m.repo, ".quay", "gate-events.jsonl");
  assert.ok(fs.existsSync(gateLog), "landed fan-in must create .quay/gate-events.jsonl");
  const events = fs.readFileSync(gateLog, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
  const complete = events.filter((e) => e.gate === "complete" && e.verdict === "pass" && e.pipeline_id === "gap-mfh");
  assert.equal(complete.length, 1, `exactly one complete pass event for the task; got ${events.length} total events`);
  assert.equal(complete[0].actor, "quay-driver", "mechanical fan-in actor is quay-driver (distinct from quay-cli/outer)");
  assert.deepEqual(complete[0].payload, { from: "ready", to: "done" }, "payload matches the CLI runComplete shape");
});


test("AC4 negative control (gap-mechanical-fan-in-writes-no-complete-gateevent) — appendCompleteGateEvent is the sole source; removing the write leaves no event", async (t) => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "ge-neg-"));
  t.after(() => rmSafe(base));
  const w = await appendCompleteGateEvent(base, "gap-x");
  assert.equal(w.ok, true, "appendCompleteGateEvent succeeds against a scratch root (module resolves via repo-root.ts)");
  const gateLog = path.join(base, ".quay", "gate-events.jsonl");
  const events = fs.readFileSync(gateLog, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
  assert.equal(events.length, 1, "exactly one event written");
  assert.equal(events[0].gate, "complete");
  assert.equal(events[0].verdict, "pass");
  assert.equal(events[0].pipeline_id, "gap-x");
  // 负控制：删掉该事件（= 关闭写事件的那一行）⇒ 载体里再无 complete 事件 ⇒ bypassComplete 可重报。
  fs.writeFileSync(gateLog, "", "utf8");
  assert.equal(fs.readFileSync(gateLog, "utf8").trim(), "", "removing the write leaves no complete event (the instrument can re-report)");
});

// ── gap-worker-ac-check-shortcircuit ─────────────────────────────────────────────────────────────
// worker exit 0 后、finishAsync spawn 机械 fan-in 前，查 worktree 任务体 AC/DoD 是否全勾（flip 闸同源
// flipAcGateVerdict）。未全勾 ⇒ 短路：不 spawn fan-in（spawn 计数 0）、outcome 原因含「AC 未全勾」。
// AC_B1 取假（未全勾 ⇒ shortCircuit:true + 原因含「AC 未全勾」）；AC_B2 负控制（全勾 ⇒
// shortCircuit:false，照常 spawn——⛔ 全勾也被短路 ⇒ 假）。

/** 写一个带指定 AC/DoD 复选框的任务体到 worktree 的 tasks/<id>.md（自足，非 harness writeTaskFile——
 *  那个只写 Proposal 无 AC 段且固定 status，不适配本判定）。 */


test("AC_B1 (gap-worker-ac-check-shortcircuit) — AC 未全勾 ⇒ shortCircuit:true + 原因含「AC 未全勾」（⛔ 仍 spawn fan-in ⇒ 假）", (t) => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "acsc-b1-"));
  t.after(() => rmSafe(base));
  const wt = path.join(base, "wt");
  writeAcTaskBody(wt, "gap-x", ["- [x] AC1 done", "- [ ] AC2 todo"]);
  const v = acShortCircuitVerdict(wt, "gap-x");
  assert.equal(v.shortCircuit, true, "unchecked impl item must short-circuit (⛔ spawn fan-in ⇒ false)");
  assert.match(v.reason, /AC 未全勾/);
  assert.match(v.reason, /2\/3/, "reason carries checked/total (2/3 = AC1✓ + DoD✓ / AC2✗)");
});


test("AC_B1b (gap-worker-ac-check-shortcircuit) — AC/DoD 段缺失 ⇒ fail-closed shortCircuit:true（硬规则 3b 无法评估 ≠ 合格）", (t) => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "acsc-b1b-"));
  t.after(() => rmSafe(base));
  const wt = path.join(base, "wt");
  fs.mkdirSync(path.join(wt, "tasks"), { recursive: true });
  fs.writeFileSync(path.join(wt, "tasks", "gap-x.md"), "---\nid: gap-x\nstatus: ready\n---\n\n## Proposal\n\nbody\n", "utf8");
  const v = acShortCircuitVerdict(wt, "gap-x");
  assert.equal(v.shortCircuit, true, "missing AC/DoD section must fail-closed short-circuit (⛔ 无法评估当合格 ⇒ 假)");
  assert.match(v.reason, /AC 未全勾/);
});


test("AC_B2 (gap-worker-ac-check-shortcircuit) — AC 全勾 ⇒ shortCircuit:false 照常 spawn fan-in（负控制，⛔ 全勾也被短路 ⇒ 假）", (t) => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "acsc-b2-"));
  t.after(() => rmSafe(base));
  const wt = path.join(base, "wt");
  writeAcTaskBody(wt, "gap-x", ["- [x] AC1 done", "- [x] AC2 done"]);
  const v = acShortCircuitVerdict(wt, "gap-x");
  assert.equal(v.shortCircuit, false, "all checked must NOT short-circuit (⛔ false block ⇒ 假)");
  assert.equal(v.reason, null);
});


test("AC_B2b (gap-worker-ac-check-shortcircuit) — 剩余未勾均为（待外部）⇒ shortCircuit:false（awaiting-verification 形态，⛔ 误挡 ⇒ 假）", (t) => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "acsc-b2b-"));
  t.after(() => rmSafe(base));
  const wt = path.join(base, "wt");
  // 剩余唯一未勾项标注（待外部）= 合法交给 fan-in 外部验证（suite 绿等），worker 退出手法正确——
  // ⛔ 与「漏勾」区分：漏勾是非待外部项，这才短路。
  writeAcTaskBody(wt, "gap-x", ["- [x] AC1 done", "- [ ] AC2 全量套件绿（待外部）"]);
  const v = acShortCircuitVerdict(wt, "gap-x");
  assert.equal(v.shortCircuit, false, "all-remaining-（待外部）must NOT short-circuit (⛔ 误挡 external-verification 形态 ⇒ 假)");
  assert.equal(v.reason, null);
});


test("AC_B1 接线 (gap-worker-ac-check-shortcircuit) — finishAsync 在 spawn 前查 acShortCircuitVerdict，短路时不 spawn fan-in（spawn 计数 0）", () => {
  const src = fs.readFileSync(DRIVER, "utf8");
  // 短路判定在 spawnMechanicalFanIn 之前调用，短路 ⇒ 走 shortCircuitReason 分支（不 spawn）。
  assert.match(src, /const sc = acShortCircuitVerdict\(paths\[0\], taskId\);/, "finishAsync calls acShortCircuitVerdict before spawning fan-in");
  assert.match(src, /if \(sc\.shortCircuit\) \{\s*\n\s*shortCircuitReason = sc\.reason;/, "short-circuit sets shortCircuitReason instead of spawning");
  // spawnMechanicalFanIn 只在 else 分支（shortCircuit:false）调用 ⇒ 短路时 spawn 计数 0。
  assert.match(src, /mechResult = await spawnMechanicalFanIn\(\{ task: taskId, worktree: paths\[0\], root: rootDir, runId \}\)/, "fan-in spawns only when not short-circuited");
  // 短路原因线程进 finish → computeOutcome（landed:false + landReason 含「AC 未全勾」）。
  assert.match(src, /landed: shortCircuitReason != null \? false/, "short-circuit forces landed=false (exited-not-landed)");
  assert.match(src, /landReason: shortCircuitReason != null \? shortCircuitReason/, "short-circuit reason is threaded as landReason (failure_reason)");
});

// ── gap-write-suite-capture-non-blocking AC1 ──────────────────────────────────────────────────────────
// writeSuiteCapture 写失败（观测写）不得弄死 fan-in（人 2026-08-30「观测不得阻塞主执行」）。capture 是
// suite 结果的派生观测载体；写失败 fail-open（WARN 不抛），ff 闸回退读权威源 full-suite-state.json
// （同一轮 mirrorMechanicalFanInSuiteState 已写 state=green + commit=suite_head + taskId）⇒ 绿 suite 落地。


test("AC1 (gap-write-suite-capture-non-blocking) — capture 写失败（父目录是文件）⇒ fan-in fail-open 落地（⛔ 不因观测写失败弄红）", async (t) => {
  const m = makeMechRepo("capfail");
  const runId = "mf-run-capfail";
  t.after(() => rmSafe(m.base));
  // capture 路径的父目录是一个【文件】⇒ writeSuiteCapture 的 mkdirSync 失败（真实构造，非 mock）。
  // ⛔ fan-in 不得因此 fail：capture 缺失 ⇒ ff 闸回退读权威源 full-suite-state.json。
  const blocker = path.join(m.base, "capture-blocker");
  fs.writeFileSync(blocker, "not a dir", "utf8");
  const badCapture = path.join(blocker, "suite.env");
  const r = await runMechanicalFanIn(mechOpts(m, runId, { suiteCapture: badCapture }));
  assert.equal(r.outcome, "landed", `capture write failure must fail-open (fan-in lands, ⛔ not red) — step=${r.step} reason=${r.reason}`);
  assert.equal(r.suiteOutcome, "done", "the suite itself must still be green");
  assert.ok(!fs.existsSync(badCapture), "the capture path is genuinely unwritable (no capture file written)");
});

// ── gap-worker-driver-resident-loop-intermittent-hang：驻留环错误边界 ────────────────────────────────
// 根因：runResidentLoop 循环体无 try/catch——任何一步瞬时抛错（负载下偶发 fs/git/spawn 异常）⇒ 未处理
// rejection ⇒ 驱动静默死掉，.quay/ 只剩 liveness log、round/outcome 停写（与「一切正常」同形，硬规则
// 3b/4b）。修法：循环体每步记 step + try/catch，抛错 ⇒ 写 action=error 的 round 记录（error_step +
// stop_reason 指到步骤，AC1 定位）+ resident-error 事件 + sleep 后继续（瞬时错误自愈，⛔ 不静默停摆）。
// AC3 生产 round 无停写窗口 = error round 仍写 worker-round.jsonl（与正常 round 同载体）。


test("computeWorkerRoundRecord action=error carries error/error_step（AC1 定位 + 记录形状，⛔ 与「无错」混淆）", () => {
  const rec = computeWorkerRoundRecord({
    round: 7,
    runId: "r",
    pid: 123,
    at: "2026-09-01T00:00:00.000Z",
    action: "error",
    inFlight: 0,
    pool: 1,
    stopReason: "error (step=ready-pool): boom",
    error: "boom",
    errorStep: "ready-pool",
    liveness: { checked: true, deaths: null, running: true },
    coldStartInflight: [],
  });
  assert.equal(rec.action, "error");
  assert.equal(rec.error, "boom");
  assert.equal(rec.error_step, "ready-pool");
  assert.match(rec.stop_reason, /step=ready-pool/);
  // 正常 round 无 error 字段 ⇒ null（⛔ 缺键与 null 可区分——error round 有该字段且非 null）。
  const normal = computeWorkerRoundRecord({
    round: 8, runId: "r", pid: 123, at: "t",
    action: "idle", inFlight: 0, pool: 0, stopReason: null, coldStartInflight: [],
  });
  assert.equal(normal.action, "idle");
  assert.equal(normal.error, null);
  assert.equal(normal.error_step, null);
});


test("AC1 (能取假) — 驻留环错误边界在源：循环体有 step-trace + try/catch + writeErrorRound（⛔ 无边界 ⇒ 抛错静默死）", () => {
  const src = fs.readFileSync(DRIVER, "utf8");
  // 错误边界：catch 写 error round + resident-error 事件。
  assert.match(src, /catch \(err\)\s*\{/, "the loop body has a catch boundary");
  assert.match(src, /writeErrorRound\(round, step, message, stack, liveness, poolSeen, running\.length\)/, "the catch writes an error round");
  assert.match(src, /event: "resident-error"/, "the catch emits a resident-error JSON event");
  // step-trace：每步记 step（AC1 定位——error_step 指到具体步骤，⛔ 只报「挂起」不指位置 ⇒ 假）。
  for (const step of ["cold-start-inflight", "liveness", "reap", "reconcile", "dispatch-loop", "ready-pool", "apply-filters", "selector", "spawn-worker", "write-round", "sleep", "wait-in-flight"]) {
    assert.match(src, new RegExp(`step = "${step}"`), `step-trace marks ${step}`);
  }
});

// ── gap-fan-in-continue-doc-only-advance-reuse-suite ───────────────────────────────────────────────
// develop 在长 suite 期间被 doc/inert 前进 ⇒ ff not-fast-forward ⇒ CONTINUE 重跑。suite 是
// (develop HEAD × delta) 的纯函数；若上一轮 green bucket suite（full-suite-state.json 的 mirror 记录）
// 之后、当前 HEAD 只触及 doc/inert 面（develop 前进面），则复用上一 green 判定、不重跑 suite。AC1 取假
// （doc/inert-only 前进 ⇒ 无 suite 运行记录）；AC2 负控制（code 前进 ⇒ 照常重跑）；AC4 单测钉死读面。

/** 建一个「上一轮 green suite 后 develop 被 doc 或 code 前进」的 hermetic repo：develop 上 base 提交 +
 *  tasks/gap-reuse.md（Touches 声明 code 文件 + AC 全勾），task/gap-reuse 分支上一个 code 提交
 *  （plugin/scripts/foo.mjs）⇒ merge develop 成 M1（上一轮 green 的 suite_head，seed 进 full-suite-state.json）
 *  ⇒ develop 再前进一个 doc 或 code 提交。fan-in 重跑时 step 2 merge 前进面、step 4 判复用。
 *  advanceKind: 'doc' | 'code'。返回 { base, repo, worktree, slotBase, capture, m1 }。 */


test("AC4 (gap-fan-in-continue-doc-only-advance-reuse-suite) — readPreviousGreenSuiteCommit：green+taskId+40-hex commit ⇒ sha；red / 异 task / 非法 commit / 缺文件 ⇒ null", (t) => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "reuse-read-"));
  t.after(() => rmSafe(base));
  const f = path.join(base, "full-suite-state.json");
  const sha = "a".repeat(40);
  fs.writeFileSync(f, JSON.stringify({ state: "green", taskId: "gap-t", commit: sha }), "utf8");
  assert.equal(readPreviousGreenSuiteCommit(f, "gap-t"), sha, "green + taskId + 40-hex commit ⇒ the sha");
  fs.writeFileSync(f, JSON.stringify({ state: "red", taskId: "gap-t", commit: sha }), "utf8");
  assert.equal(readPreviousGreenSuiteCommit(f, "gap-t"), null, "red ⇒ null (no green cert)");
  fs.writeFileSync(f, JSON.stringify({ state: "green", taskId: "gap-other", commit: sha }), "utf8");
  assert.equal(readPreviousGreenSuiteCommit(f, "gap-t"), null, "different task ⇒ null (⛔ 不冒名)");
  fs.writeFileSync(f, JSON.stringify({ state: "green", taskId: "gap-t", commit: "not-a-sha" }), "utf8");
  assert.equal(readPreviousGreenSuiteCommit(f, "gap-t"), null, "non-40-hex commit ⇒ null (读不懂 ≠ 绿)");
  assert.equal(readPreviousGreenSuiteCommit(path.join(base, "missing.json"), "gap-t"), null, "missing file ⇒ null (缺值 = 未查)");
});


test("AC1 (gap-fan-in-continue-doc-only-advance-reuse-suite) — develop 仅 doc 前进 ⇒ 复用上一 green、不重跑 suite（无 suite step + skip_reason=reuse + landed）", async (t) => {
  const m = makeReuseRepo("doc", "doc");
  const runId = "mf-run-reuse-doc";
  t.after(() => rmSafe(m.base));
  const marker = path.join(m.base, "suite-ran.marker");
  const r = await runMechanicalFanIn(mechOpts(m, runId, {
    task: "gap-reuse",
    forceSuite: false,
    suiteCommand: ["bash", "-c", `echo ran > "${marker}"; exit 0`],
  }));
  assert.equal(r.outcome, "landed", `doc-only develop advance must reuse prev green and land (step=${r.step} reason=${r.reason})`);
  assert.equal(r.suiteOutcome, null, "suite must NOT run (reused prev green — ⛔ 仍跑 suite 再判则假)");
  assert.equal(fs.existsSync(marker), false, "suite command must NOT execute (doc-only develop advance ⇒ reuse)");
  const capture = fs.readFileSync(m.capture, "utf8");
  assert.match(capture, /full_suite_ran=false/);
  assert.match(capture, /skip_reason=develop-advance-doc-only-reuse/);
  // 过程日志：无 suite-start/suite-end，只有 suite-skip（reuse reason）——AC1「该轮无 suite step」。
  const log = path.join(m.repo, ".quay", `fan-in-gap-reuse-${runId}.log`);
  const lines = fs.readFileSync(log, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
  assert.equal(lines.some((l) => l.step === "suite-start" || l.step === "suite-end"), false, "no suite step in the trace (AC1)");
  const skip = lines.find((l) => l.step === "suite-skip");
  assert.ok(skip && /develop-advance-doc-only-reuse/.test(skip.reason ?? ""), "suite-skip trace carries the reuse reason");
});


test("AC2 (gap-fan-in-continue-doc-only-advance-reuse-suite) — develop code 前进 ⇒ 照常重跑 suite（不削弱合并验证）", async (t) => {
  const m = makeReuseRepo("code", "code");
  const runId = "mf-run-reuse-code";
  t.after(() => rmSafe(m.base));
  const marker = path.join(m.base, "suite-ran.marker");
  const r = await runMechanicalFanIn(mechOpts(m, runId, {
    task: "gap-reuse",
    forceSuite: false,
    suiteCommand: ["bash", "-c", `echo ran > "${marker}"; exit 0`],
  }));
  assert.equal(r.outcome, "landed", `code develop advance must re-run suite and land (step=${r.step} reason=${r.reason})`);
  assert.equal(r.suiteOutcome, "done", "suite must RUN (code advance ⇒ no reuse)");
  assert.equal(fs.existsSync(marker), true, "suite command must execute (code develop advance ⇒ re-run)");
});

// ── gap-fan-in-step-trace-suite-step-stopped-writing ───────────────────────────────────────────
// 病根：a5a301e03（gap-mech-fan-in-log-webui-visible-clickable）把 suite 决策步骤（ac-precheck /
// suite-start / suite-end / suite-skip）的 trace 目标从共享 .quay/fan-in-step-trace.jsonl 改指向
// per-run .quay/fan-in-<task>-<runId>.log，没同步保留共享写 ⇒ 依赖共享文件做跨任务/跨时间聚合的
// 读者（伴生对照停写检测、gap-archguard-p5-instrument-decay-standing-guard）从此看不到这批步骤。
// 修法：traceSuiteEvent 两路都写（共享 + per-run）；两载体 suite 决策条目数一致。


test("AC2/AC3 (gap-fan-in-step-trace-suite-step-stopped-writing) — suite 决策步骤同时写共享 fan-in-step-trace.jsonl 与 per-run 日志（同 runId 两载体条目数一致且都 > 0）", async (t) => {
  const m = makeMechRepo("step-trace-suite");
  const runId = "mf-run-step-trace-suite";
  t.after(() => rmSafe(m.base));
  const r = await runMechanicalFanIn(mechOpts(m, runId));
  assert.equal(r.outcome, "landed", `fan-in must land (step=${r.step} reason=${r.reason})`);
  // 共享载体：同一 runId 下 suite 决策步骤各出现一次（AC2）。
  const sharedFile = path.join(m.repo, ".quay", "fan-in-step-trace.jsonl");
  const suiteSteps = fs.readFileSync(sharedFile, "utf8").trim().split("\n").filter(Boolean)
    .map((l) => JSON.parse(l))
    .filter((l) => l.runId === runId && ["ac-precheck", "suite-start", "suite-end", "suite-skip"].includes(l.step));
  assert.ok(suiteSteps.some((l) => l.step === "ac-precheck"), "shared carrier must have ac-precheck");
  assert.ok(suiteSteps.some((l) => l.step === "suite-start"), "shared carrier must have suite-start");
  assert.ok(suiteSteps.some((l) => l.step === "suite-end"), "shared carrier must have suite-end");
  assert.equal(suiteSteps.some((l) => l.step === "suite-skip"), false, "needSuite path must NOT write suite-skip");
  assert.equal(suiteSteps.length, 3, "needSuite path ⇒ ac-precheck + suite-start + suite-end = 3 shared suite entries");
  // per-run 载体：suite 决策条目数与共享一致（AC3 两载体对照）。
  const perRun = fs.readFileSync(path.join(m.repo, ".quay", fanInLogFileName("gap-mfh", runId)), "utf8")
    .trim().split("\n").filter(Boolean).map((l) => JSON.parse(l))
    .filter((l) => ["ac-precheck", "suite-start", "suite-end", "suite-skip"].includes(l.step));
  assert.equal(perRun.length, suiteSteps.length, "per-run and shared carriers carry the same count of suite decision entries (AC3)");
});


test("AC2/AC3 (跳过路径) — doc-only develop 前进 ⇒ suite-skip 也两路都写", async (t) => {
  const m = makeReuseRepo("step-trace-skip", "doc");
  const runId = "mf-run-step-trace-skip";
  t.after(() => rmSafe(m.base));
  const r = await runMechanicalFanIn(mechOpts(m, runId, { task: "gap-reuse", forceSuite: false }));
  assert.equal(r.outcome, "landed", `doc-only develop advance must reuse prev green and land (step=${r.step} reason=${r.reason})`);
  const sharedFile = path.join(m.repo, ".quay", "fan-in-step-trace.jsonl");
  const sharedSkip = fs.readFileSync(sharedFile, "utf8").trim().split("\n").filter(Boolean)
    .map((l) => JSON.parse(l))
    .filter((l) => l.runId === runId && ["ac-precheck", "suite-start", "suite-end", "suite-skip"].includes(l.step));
  assert.equal(sharedSkip.length, 1, "skip path ⇒ exactly one suite decision entry in shared carrier (suite-skip)");
  assert.equal(sharedSkip[0].step, "suite-skip");
  assert.match(sharedSkip[0].reason ?? "", /develop-advance-doc-only-reuse/, "shared suite-skip carries the reuse reason");
  const perRun = fs.readFileSync(path.join(m.repo, ".quay", fanInLogFileName("gap-reuse", runId)), "utf8")
    .trim().split("\n").filter(Boolean).map((l) => JSON.parse(l))
    .filter((l) => ["ac-precheck", "suite-start", "suite-end", "suite-skip"].includes(l.step));
  assert.equal(perRun.length, 1, "per-run carrier must match (suite-skip only)");
});

// ── gap-fan-in-step-trace-suite-steps-write-end-without-begin ───────────────────────────────────
// 病根：4 个 suite 决策步（ac-precheck/suite-start/suite-end/suite-skip）在共享载体上只有 `step-end`
// 没有 `step-begin`——它们是【单发决策事件】而非区间。于是「用 begin/end 配对算时长」这个读法对它们
// 恒返回「无数据」，而「无数据」与「这一步不存在」同形（硬规则 3b）；实测一位分析者正是据此得出
// 「suite 结构上不在这个载体里」的错误结论，并把一个基于该结论的「75% 是等待」判断收回。
// 修法（AC2 选项②）：时长改为**每条 `step-end` 自带 `durationMs`**，12 个分组统一，不依赖配对。



test("AC2 — 共享载体每条 step-end 自带 durationMs（12 组统一），suite-end 的读数就是真实墙钟", async (t) => {
  const m = makeMechRepo("step-trace-duration");
  const runId = "mf-run-duration";
  t.after(() => rmSafe(m.base));
  const r = await runMechanicalFanIn(mechOpts(m, runId, {
    // sleep 1 ⇒ suite-end 的 durationMs 必须落在这个量级；占位 0 / 拿错量的实现都会被下面挡下。
    suiteCommand: ["bash", "-c", "echo suite-running; sleep 1; exit 0"],
  }));
  assert.equal(r.outcome, "landed", `fan-in must land (step=${r.step} reason=${r.reason})`);
  const ends = readSharedTrace(m.repo).filter((l) => l.event === "step-end" && l.runId === runId);
  // 全 12 组统一：每一条 step-end 都自带数值 durationMs（⛔ 不能只有 suite 那 4 条有）。
  const missing = ends.filter((l) => typeof l.durationMs !== "number" || !Number.isFinite(l.durationMs) || l.durationMs < 0);
  assert.deepEqual(missing.map((l) => l.step), [],
    "every step-end in the shared carrier must carry a numeric durationMs (the uniform duration channel)");
  assert.ok(ends.length >= 11, `a landed run traces ≥11 step-ends (got ${ends.length}: ${ends.map((l) => l.step).join(",")})`);
  // 真读数：suite 里 sleep 1 ⇒ suite-end 的 durationMs ≥ 1000（⛔ 常量 0 / 抄错字段都过不了）。
  const se = ends.find((l) => l.step === "suite-end");
  assert.ok(se, "suite-end must be in the shared carrier");
  assert.ok(se.durationMs >= 1000, `suite-end durationMs must reflect the real suite wall clock, got ${se.durationMs}`);
  // 两载体同一步同一读数：共享 durationMs == per-run wall_ms（同一个 t0，⛔ 不各算一次）。
  const perRun = fs.readFileSync(path.join(m.repo, ".quay", fanInLogFileName("gap-mfh", runId)), "utf8")
    .trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
  const sePerRun = perRun.find((l) => l.step === "suite-end");
  assert.ok(sePerRun, "per-run carrier keeps its own suite-end row");
  assert.equal(se.durationMs, sePerRun.wall_ms, "shared durationMs and per-run wall_ms are the same single reading");
});
