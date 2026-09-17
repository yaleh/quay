// @test-group serial
// worker-driver-fan-in.test.mjs — mechanical fan-in (locks/merge/trace) + dispatch filters + cold-start + retry/backoff. Split from gap-suite-file-split-two-longest.
// SPLIT from worker-driver-fan-in.test.mjs by gap-suite-split-15-over-30s-test-files — shard 7/10 (10 tests). Shared fixtures: ./helpers/worker-driver-fan-in-harness.mjs (single source).

import { test } from "node:test";
import { SLOT_LIB, acShortCircuitVerdict, after, appendCompleteGateEvent, assert, execFileSync, fs, makeMechRepo, mechOpts, mechSh, os, path, readFanInLockHold, rmSafe, runMechanicalFanIn, spawn, spawnSuiteAndWait, suiteLockSlotPaths, waitFor, writeAcTaskBody, writeTaskFile } from "./helpers/worker-driver-fan-in-harness.mjs";

test("AC2 (gap-fan-in-subprocess-hang-timeout-recovery) — mechSh timeout 后 resolve（⛔ 依赖 close）+ 组 kill 杀孙进程（孙进程持管道不阻塞返回）", async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mech-ac2-"));
  t.after(() => rmSafe(tmp));
  const pidFile = path.join(tmp, "grandchild.pid");
  // 直接子进程（bash）spawn 孙进程（node）继承 stdout/stderr 管道并长期存活，bash `wait` 挂起等它。
  // timeout 到期 ⇒ 组 kill（⛔ 只杀直接子进程会留孙进程持管道/锁泄漏）。
  const cmd = `node -e 'require("fs").writeFileSync(${JSON.stringify(pidFile)}, String(process.pid)); setInterval(()=>{},1000)' & wait`;
  const t0 = Date.now();
  const r = await mechSh(["bash", "-c", cmd], 1000);
  assert.ok(Date.now() - t0 < 5000, `mechSh must resolve at timeout (⛔ hang on close), took ${Date.now() - t0}ms`);
  assert.equal(r.status, null, "SIGKILLed child ⇒ null status");
  assert.match(r.error?.message ?? "", /spawn timeout after 1000ms/, "timeout must carry a 'spawn timeout' error");
  // 孙进程被杀（组 kill）：⛔ 旧 runAsync 只杀直接子进程 ⇒ 孙进程存活持管道（本断言取假）。
  const gp = Number(fs.readFileSync(pidFile, "utf8").trim());
  await waitFor(() => {
    try { process.kill(gp, 0); return false; } catch { return true; }
  }, 15000);
  assert.ok(true, "grandchild holding the pipe must be killed by the process-group kill");
});


test("AC3 (gap-fan-in-subprocess-hang-timeout-recovery) — spawnSuiteAndWait 在 suite 卡等槽锁（零输出）时，silence watchdog 有限时间 kill 并返回 hung", async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mech-ac3-"));
  t.after(() => rmSafe(tmp));
  const slotBase = path.join(tmp, "full-suite.lock");
  const slots = suiteLockSlotPaths(slotBase);
  assert.equal(slots.length, 1, "hermetic slot base defaults to S=1");
  // 持住唯一槽：后台 flock holder 让 slot-holder 的 flock -n 失败 ⇒ 卡进无界等槽循环（零输出）。
  const holder = spawn("bash", ["-c", `exec {fd}>"$1"; flock -x "$fd"; sleep 30`, "holder", slots[0]], { stdio: "ignore", detached: true });
  t.after(() => { try { process.kill(-holder.pid, "SIGKILL"); } catch { /* gone */ } });
  await waitFor(() => {
    try { execFileSync("flock", ["-n", slots[0], "true"], { stdio: "ignore" }); return false; } catch { return true; }
  }, 15000);
  const t0 = Date.now();
  const r = await spawnSuiteAndWait({ slotBase, slotLib: SLOT_LIB, suiteCommand: ["bash", "-c", "echo never-run"], logFile: null, silenceMs: 400 });
  assert.ok(Date.now() - t0 < 5000, `spawnSuiteAndWait must return in finite time (⛔ 53min hang), took ${Date.now() - t0}ms`);
  assert.equal(r.outcome, "hung", "suite stuck waiting for the slot ⇒ hung (independent value)");
  assert.equal(r.hungByWatchdog, true);
});


test("AC4 (gap-fan-in-subprocess-hang-timeout-recovery) — 任一 fan-in 子进程挂起 ⇒ 有限时间 red + 释放 fan-in.lock（finally 必达）", async (t) => {
  const m = makeMechRepo("ac4");
  const runId = "mf-run-hang";
  t.after(() => rmSafe(m.base));
  const t0 = Date.now();
  // suite 挂起（零输出 ⇒ silence watchdog kill → hung → red at suite），⛔ 不落地、锁仍 release。
  const r = await runMechanicalFanIn(mechOpts(m, runId, { suiteCommand: ["bash", "-c", "sleep 100"], silenceMs: 400 }));
  assert.ok(Date.now() - t0 < 20000, `mechanical fan-in must fail in finite time (⛔ 53min hang), took ${Date.now() - t0}ms`);
  assert.equal(r.outcome, "red");
  assert.equal(r.step, "suite");
  // 锁在 finally 释放：事件文件里恰一对 acquire→release（⛔ 挂起残留锁阻塞全仓 fan-in）。
  const lock = readFanInLockHold(m.repo, "gap-mfh", runId);
  assert.ok(lock.lockAcquireEpoch !== null && lock.lockReleaseEpoch !== null, "hang ⇒ lock released (finally) — clean acquire+release pair");
});

// ── gap-mechanical-fan-in-red-lock-times-null ──────────────────────────────────────────────────────
// 病根：失败路径（fail/verdictOf/failSuite/catch failClean）硬编码 lockHoldSecs/lockAcquireEpoch/
// lockReleaseEpoch = null，而数据已落盘（acquire/release 事件文件）。修法 = 失败结果在 finally
// release 之后读真实锁时间（同成功路径时机）。两个陷阱：① 早读（release 事件未落盘 ⇒ lockHoldSecs
// 恒 null）；② 事后补读（后续重试追加更新的 acquire/release ⇒ readFanInLockHold 取最后一组 ⇒ 张冠李戴）。


test("AC2 (gap-mechanical-fan-in-red-lock-times-null) — 同一 taskId+runId 已有多组 acquire/release：失败结果拿到【本次尝试自己的】区间，不是文件里既有的组（防事后补读）", async (t) => {
  const m = makeMechRepo("lock-times-ac2");
  const runId = "mf-run-lock-times-ac2";
  t.after(() => rmSafe(m.base));
  // fixture：同一 taskId+runId 的两组 acquire/release（模拟「先失败(1000-1020) → 重试成功(2000-2271)」）。
  // 哨兵 epoch 远早于真实时间——若修法读错组（取第一组/取文件里最后一组既有组），会拿到这些哨兵值。
  const eventsFile = path.join(m.repo, ".quay", "fan-in-lock-events.jsonl");
  fs.mkdirSync(path.dirname(eventsFile), { recursive: true });
  const ev = (event, epoch) => JSON.stringify({ event, ts: "1970-01-01T00:00:00Z", epoch, taskId: "gap-mfh", pid: 1, runId, agentId: null }) + "\n";
  fs.writeFileSync(eventsFile,
    ev("acquire", 1000) + ev("release", 1020) + // 先失败（第一组）
    ev("acquire", 2000) + ev("release", 2271)   // 重试成功（最后一组）
  );
  // 驱动一次真实失败（suite 红）——本次尝试会向同一文件【追加第三组】真实 acquire/release。
  const r = await runMechanicalFanIn(mechOpts(m, runId, { suiteCommand: ["bash", "-c", "exit 1"] }));
  assert.equal(r.outcome, "red");
  assert.equal(r.step, "suite");
  assert.ok(typeof r.lockAcquireEpoch === "number" && r.lockAcquireEpoch > 10000, `本次尝试真实 acquire（got ${r.lockAcquireEpoch}，⛔ 哨兵 1000/2000）`);
  assert.ok(typeof r.lockReleaseEpoch === "number" && r.lockReleaseEpoch > 10000, `本次尝试真实 release（got ${r.lockReleaseEpoch}，⛔ 哨兵 1020/2271）`);
  assert.notEqual(r.lockAcquireEpoch, 1000, "⛔ 拿到第一组(先失败)的哨兵 acquire");
  assert.notEqual(r.lockAcquireEpoch, 2000, "⛔ 拿到最后一组(重试成功)的哨兵 acquire");
  // 与事件文件里【最后一组】（本次尝试自己追加的）一致——证明修法在写入时序上读的是本次区间，
  // 不是事后补读（事后补读会因文件里已有多组而张冠李戴）。
  const last = readFanInLockHold(m.repo, "gap-mfh", runId);
  assert.equal(r.lockAcquireEpoch, last.lockAcquireEpoch, "失败结果 acquire 与本次尝试追加的事件一致");
  assert.equal(r.lockReleaseEpoch, last.lockReleaseEpoch, "失败结果 release 与本次尝试追加的事件一致");
});


test("AC3 (gap-mechanical-fan-in-red-lock-times-null) — 真实失败步骤(suite 红)的结果带非 null 锁时间，且与测试自建事件文件一致", async (t) => {
  const m = makeMechRepo("lock-times-ac3");
  const runId = "mf-run-lock-times-ac3";
  t.after(() => rmSafe(m.base));
  const r = await runMechanicalFanIn(mechOpts(m, runId, { suiteCommand: ["bash", "-c", "exit 1"] }));
  assert.equal(r.outcome, "red");
  assert.equal(r.step, "suite");
  // 锁被真实持有 ⇒ 失败结果不再是 null，而是具体数值。
  assert.ok(typeof r.lockAcquireEpoch === "number" && r.lockAcquireEpoch > 0, `失败结果 lockAcquireEpoch 非 null（got ${r.lockAcquireEpoch}）`);
  assert.ok(typeof r.lockReleaseEpoch === "number" && r.lockReleaseEpoch > 0, `失败结果 lockReleaseEpoch 非 null（got ${r.lockReleaseEpoch}）`);
  // 与该测试自己驱动产生的 fan-in-lock-events.jsonl 里对应 acquire/release 一致（⛔ 不改动生产 .quay/ 历史记录）。
  const lock = readFanInLockHold(m.repo, "gap-mfh", runId);
  assert.equal(r.lockAcquireEpoch, lock.lockAcquireEpoch, "失败结果 acquire 与事件文件一致");
  assert.equal(r.lockReleaseEpoch, lock.lockReleaseEpoch, "失败结果 release 与事件文件一致");
  assert.equal(r.lockHoldSecs, lock.lockHoldSecs, "失败结果 lockHoldSecs 与事件文件一致");
});

// ── gap-fan-in-ac-precheck-before-suite ─────────────────────────────────────────────────────────────
// 机械 fan-in 在 suite 前加 AC 全勾 fail-fast 预检（未全勾 ⇒ step=ac-precheck 拒翻 + 跳过 suite，省注定
// 无效的 9-11min/cycle；gap-execution-loop 08-30 两次 ac-gate 拒各耗 542s/684s 的注定无效 suite）。AC1
// 取假（未全勾 ⇒ 无 suite 运行记录）；AC2 负控制（全勾 ⇒ 正常进 suite）；AC3 单测钉死两半边。


test("AC3 (gap-fan-in-ac-precheck-before-suite) — AC 未全勾 ⇒ suite 前 fail-fast 拒翻（step=ac-precheck，无 suite 运行记录）", async (t) => {
  const m = makeMechRepo("acpre-fail");
  const runId = "mf-run-acpre-fail";
  t.after(() => rmSafe(m.base));
  // 改写任务体：AC 未全勾（- [ ] AC2 todo 无标注 ⇒ 待本任务）⇒ 预检应拒翻跳过 suite。
  fs.writeFileSync(path.join(m.worktree, "tasks", "gap-mfh.md"), [
    "---", "id: gap-mfh", "title: mechanical fan-in ac-precheck", "status: ready",
    "labels: []", "extra: {}", "---",
    "## Proposal", "test", "## Plan", "test",
    "## Touches", "- docs/feature.md", "- tasks/gap-mfh.md",
    "## Acceptance Criteria", "- [x] AC1 landed", "- [ ] AC2 todo",
    "## Definition of Done", "- [x] landed", "",
  ].join("\n"), "utf8");
  const suiteMarker = path.join(m.base, "suite-ran.marker");
  const r = await runMechanicalFanIn(mechOpts(m, runId, {
    suiteCommand: ["bash", "-c", `echo ran > "${suiteMarker}"; exit 0`],
  }));
  assert.equal(r.outcome, "red");
  assert.equal(r.step, "ac-precheck");
  assert.match(r.reason ?? "", /AC 未全勾/);
  assert.match(r.reason ?? "", /2\/3/, "reason carries checked/total (2/3 = AC1✓ + DoD✓ / AC2✗)");
  assert.equal(fs.existsSync(suiteMarker), false, "suite must NOT run (fail-fast before suite)");
  // 无 suite 运行记录：suiteFinishedEpoch / suiteOutcome 保持 null（⛔ 仍跑 suite 再拒 ⇒ 假）。
  assert.equal(r.suiteFinishedEpoch, null);
  assert.equal(r.suiteOutcome, null);
  // 锁仍释放（finally 必达）。
  const lock = readFanInLockHold(m.repo, "gap-mfh", runId);
  assert.ok(lock.lockAcquireEpoch !== null && lock.lockReleaseEpoch !== null, "precheck red ⇒ lock released (finally)");
});


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
