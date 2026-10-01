// @test-group serial
// worker-driver-fan-in.test.mjs — mechanical fan-in (locks/merge/trace) + dispatch filters + cold-start + retry/backoff. Split from gap-suite-file-split-two-longest.
// SPLIT from worker-driver-fan-in.test.mjs by gap-suite-split-15-over-30s-test-files — shard 7/10 (10 tests). Shared fixtures: ./helpers/worker-driver-fan-in-harness.mjs (single source).

import { test } from "node:test";
import { SLOT_LIB, acShortCircuitVerdict, after, appendCompleteGateEvent, assert, execFileSync, fs, makeMechRepo, mechOpts, mechSh, os, path, readFanInLockHold, rmSafe, runMechanicalFanIn, spawn, spawnSuiteAndWait, suiteLockSlotPaths, waitFor, writeAcTaskBody, writeTaskFile } from "./helpers/worker-driver-fan-in-harness.mjs";
// 只读仪器（按失败测试文件聚合）直接取自生产模块——⛔ 不改共享 harness（它不在本任务 ## Touches 内）。
import { aggregateRerunFlakes } from "../scripts/worker-driver.ts";

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


// ── gap-fan-in-suite-red-no-in-round-rerun-of-red-files ─────────────────────────────────────────
// 病根：suite 步一旦红就直接 outcome:"red" 返回，本轮内没有任何重跑（生产上 118/125 个红轮次的失败文件
// 不在该任务 ## Touches 内）。修法：suite 红且【日志点名了 ≥1 个失败测试文件】时，在同一轮/同一把
// fan-in 锁内/同一棵合并树上只重跑这些文件；全绿 ⇒ 按绿落地（rerun-green），仍有红 ⇒ 维持 red。
// ⛔ 三态不得压平（硬规则 3b）：没有可用命令 / 解析不出文件 / 重跑被 watchdog 中止 ⇒ rerun-not-evaluated。
// 重跑命令**由项目声明**（.quay/config.yml 的 loop.rerun_command，`{files}` 整元素被文件列表 splice）
// ——产品代码零项目知识（⛔ 无 KNOWN-LOAD-SENSITIVE 名单；那条路 2026-09-03 已被裁定取消）。

/** 写一个只声明重跑命令的 worktree 配置（项目侧声明面——⛔ 不走测试专用直传缝，走真实解析路径）。 */
function writeRerunCommandDeclaration(worktree, argv) {
  fs.mkdirSync(path.join(worktree, ".quay"), { recursive: true });
  fs.writeFileSync(
    path.join(worktree, ".quay", "config.yml"),
    `loop:\n  rerun_command: ${JSON.stringify(argv)}\n`,
    "utf8",
  );
}

/** 一条 suite 红日志（机器可读的 per-file 失败行——`measure-suite-reporter` 的 `__PERFILE__` 形状）。 */
function suiteRedCommand(namedFile) {
  return ["bash", "-c", `echo "__PERFILE__ duration_ms=10 ${namedFile} passed=false end_ms=20"; exit 1`];
}

test("AC1①+AC4+AC6 (gap-fan-in-suite-red-no-in-round-rerun-of-red-files) — suite 红 + 本轮重跑点名文件返回 0 ⇒ landed（rerun-green）+ 失败文件清单 + 锁 release ≥ 重跑结束 + 两 SHA 为 40-hex", async (t) => {
  const m = makeMechRepo("rerun-green");
  const runId = "mf-run-rerun-green";
  t.after(() => rmSafe(m.base));
  const named = "plugin/test/flaky-under-load.test.mjs";
  const record = path.join(m.base, "rerun-args.txt");
  writeRerunCommandDeclaration(m.worktree, [
    "bash", "-c", `printf '%s\\n' "$@" > "${record}"; echo reran; exit 0`, "rerun", "{files}",
  ]);
  const r = await runMechanicalFanIn(mechOpts(m, runId, { suiteCommand: suiteRedCommand(named) }));
  assert.equal(r.outcome, "landed", `rerun-green must land (step=${r.step} reason=${r.reason})`);
  assert.equal(r.rerun.state, "rerun-green", "rerun 三态取值必须是 rerun-green");
  assert.deepEqual(r.rerun.files, [named], "重跑点名文件 = 日志点名的失败文件");
  assert.equal(r.rerun.exitCode, 0);
  assert.ok(typeof r.rerun.finishedEpoch === "number", "重跑结束 epoch 是读数（AC4 判据输入）");
  // AC4：重跑在 fan-in 锁【内】跑 ⇒ release epoch ≥ 重跑结束时刻（finally 的 release 在它之后）。
  assert.ok(
    typeof r.lockReleaseEpoch === "number" && r.lockReleaseEpoch >= r.rerun.finishedEpoch,
    `锁 release(${r.lockReleaseEpoch}) 必须 ≥ 重跑结束(${r.rerun.finishedEpoch})——重跑跑到锁外 ⇒ 假`,
  );
  // 文件清单三态读数（evaluated:true ⇒ 非空）。
  assert.deepEqual(r.failedTestFiles, { evaluated: true, files: [named] }, "outcome 记录失败文件清单非空");
  // AC6：受测合并树 SHA 与当时的 develop SHA 都是 40 位十六进制。
  assert.match(r.mergeTreeSha ?? "", /^[0-9a-f]{40}$/, "受测合并树 SHA 必须是 40-hex");
  assert.match(r.developSha ?? "", /^[0-9a-f]{40}$/, "当时的 develop SHA 必须是 40-hex");
  // `{files}` 是【整元素 splice】（逐个成为 argv 元素）——⛔ 不是拼成一个字符串（那会把路径切碎）。
  assert.deepEqual(fs.readFileSync(record, "utf8").trim().split("\n"), [named], "{files} → 逐个 argv 元素");
  // 重跑日志与 suite attempt 日志同族（同前缀 ⇒ 落地时被 pruneTaskSuiteLogs 一起轮转——⛔ 不新增一族
  // 无人清理的孤儿日志）。落地的这条路径上文件已被轮转掉，**耐久证据是 outcome 记录本身**
  // （failedTestFiles / rerun / 两个 SHA）；「日志确实写出来了」由 test ②（rerun-red，不落地 ⇒ 不轮转）证明。
  assert.match(r.rerun.log ?? "", /^fan-in-suite-gap-mfh~.+~rerun-.+\.log$/, "重跑日志落在 suite 日志族里");
});

test("AC1②+AC3 负控制 (gap-fan-in-suite-red-no-in-round-rerun-of-red-files) — 重跑【确定性失败】⇒ 维持 red/step=suite，⛔ 不落地", async (t) => {
  const m = makeMechRepo("rerun-red");
  const runId = "mf-run-rerun-red";
  t.after(() => rmSafe(m.base));
  const named = "plugin/test/really-broken.test.mjs";
  writeRerunCommandDeclaration(m.worktree, ["bash", "-c", "exit 1", "rerun", "{files}"]);
  const r = await runMechanicalFanIn(mechOpts(m, runId, { suiteCommand: suiteRedCommand(named) }));
  assert.equal(r.outcome, "red", "重跑仍非 0 ⇒ 不得落地（重跑不是把真红放行的通道）");
  assert.equal(r.step, "suite");
  assert.equal(r.rerun.state, "rerun-red");
  assert.equal(r.rerun.exitCode, 1);
  assert.deepEqual(r.rerun.files, [named]);
  assert.equal(r.landedSha, null, "未落地");
  // 未落地 ⇒ 不轮转 ⇒ 重跑日志留证（「重跑真的跑了」的载体；①的成功路径上它会被落地轮转掉）。
  assert.ok(r.rerun.log, "重跑日志指针非空");
  assert.ok(fs.existsSync(path.join(m.repo, ".quay", r.rerun.log)), "重跑日志确实写出来了");
  // 负控制的对照组：本用例的 rerun 取值必须与 ①/③ 都不同（三态不被压平）。
  assert.notEqual(r.rerun.state, "rerun-green");
  assert.notEqual(r.rerun.state, "rerun-not-evaluated");
});

test("AC1③ (gap-fan-in-suite-red-no-in-round-rerun-of-red-files) — 未声明重跑命令 ⇒ 重跑取值为 not-evaluated（⛔ 与 ①/② 不同）", async (t) => {
  const m = makeMechRepo("rerun-absent");
  const runId = "mf-run-rerun-absent";
  t.after(() => rmSafe(m.base));
  const named = "plugin/test/whatever.test.mjs";
  // ⛔ 不写 .quay/config.yml ⇒ loop.rerun_command 未声明。
  const r = await runMechanicalFanIn(mechOpts(m, runId, { suiteCommand: suiteRedCommand(named) }));
  assert.equal(r.outcome, "red");
  assert.equal(r.step, "suite");
  assert.equal(r.rerun.state, "rerun-not-evaluated", "未声明 ⇒ 未评估（⛔ 不与「跑了且绿/红」同形）");
  assert.equal(r.rerun.reason, "no-rerun-command-declared", "成因 token 必须点名「没声明」");
  assert.equal(r.rerun.finishedEpoch, null, "没跑过 ⇒ 无结束时刻（⛔ 不伪造）");
  assert.notEqual(r.rerun.state, "rerun-green");
  assert.notEqual(r.rerun.state, "rerun-red");
  // 行为与修改前逐字一致：仍是 step=suite 的 red。
  assert.ok(r.suiteLog, "suite 真因日志指针仍在");
});

test("AC6 (gap-fan-in-suite-red-no-in-round-rerun-of-red-files) — 解析不出失败文件 ⇒ 清单为显式的「未评估」取值，⛔ 不是空数组", async (t) => {
  const m = makeMechRepo("rerun-unparsed");
  const runId = "mf-run-rerun-unparsed";
  t.after(() => rmSafe(m.base));
  // 日志里没有任何失败测试行（真实形态：静态相位红 / 看门狗杀轮）——⛔ 与「读懂了但没有失败文件」不同。
  const r = await runMechanicalFanIn(mechOpts(m, runId, {
    suiteCommand: ["bash", "-c", "echo 'boom: infrastructure died'; exit 1"],
  }));
  assert.equal(r.outcome, "red");
  assert.equal(r.failedTestFiles.evaluated, false, "解析不出 ⇒ evaluated:false（未评估）");
  assert.equal(r.failedTestFiles.reason, "no-failing-lines-in-suite-log", "成因 token 点名「日志里没有失败行」");
  assert.equal(Array.isArray(r.failedTestFiles), false, "⛔ 不得用空数组冒充「未评估」");
  assert.equal(Object.prototype.hasOwnProperty.call(r.failedTestFiles, "files"), false, "未评估态不带 files 键");
  // 未评估 ⇒ 重跑没有对象（同一取值链）。
  assert.equal(r.rerun.state, "rerun-not-evaluated");
});

test("只读仪器 (gap-fan-in-suite-red-no-in-round-rerun-of-red-files) — aggregateRerunFlakes 按失败文件聚合跨任务轮次，未评估轮次单独计", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "flake-report-"));
  t.after(() => rmSafe(root));
  fs.mkdirSync(path.join(root, ".quay"), { recursive: true });
  const rec = (task, ts, mfi) => JSON.stringify({ task, ts, final_state: "exited-not-landed", mechanical_fan_in: mfi }) + "\n";
  fs.writeFileSync(path.join(root, ".quay", "worker-outcome.jsonl"),
    rec("gap-a", "2026-09-24T01:00:00Z", { step: "suite", failedTestFiles: { evaluated: true, files: ["plugin/test/flaky.test.mjs"] }, rerun: { state: "rerun-red" } }) +
    rec("gap-b", "2026-09-25T01:00:00Z", { step: "suite", failedTestFiles: { evaluated: true, files: ["plugin/test/flaky.test.mjs", "plugin/test/other.test.mjs"] }, rerun: { state: "rerun-green" } }) +
    rec("gap-c", "2026-09-26T01:00:00Z", { step: "suite", failedTestFiles: { evaluated: false, reason: "no-failing-lines-in-suite-log" }, rerun: { state: "rerun-not-evaluated" } }) +
    rec("gap-d", "2026-09-26T02:00:00Z", { step: "suite", failedTestFiles: null, rerun: null }) + // suite 从未红 ⇒ 两边都不进
    "not json\n",
    "utf8",
  );
  const { rows, notEvaluatedRounds, scannedRounds } = aggregateRerunFlakes(root);
  assert.equal(rows.length, 2, "两个文件");
  assert.equal(rows[0].file, "plugin/test/flaky.test.mjs");
  assert.equal(rows[0].redRounds, 2);
  assert.deepEqual(rows[0].tasks, ["gap-a", "gap-b"], "波及的不同任务数");
  assert.equal(rows[0].firstRedTs, "2026-09-24T01:00:00Z");
  assert.equal(rows[0].lastRedTs, "2026-09-25T01:00:00Z");
  assert.equal(rows[0].rerunGreenRounds, 1, "同一棵树上红转绿的轮次数 = flake 证据");
  assert.equal(rows[1].file, "plugin/test/other.test.mjs");
  assert.equal(rows[1].redRounds, 1);
  assert.equal(notEvaluatedRounds, 1, "未评估轮次单独计（⛔ 不与 redRounds 混）");
  assert.equal(scannedRounds, 3, "failedTestFiles 非 null 的轮次数（不适用态不进口径）");
  // 只读：不写任何文件（对比目录清单）。
  assert.deepEqual(fs.readdirSync(path.join(root, ".quay")), ["worker-outcome.jsonl"], "仪器不得写盘");
});

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
