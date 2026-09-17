// @test-group engine
// fan-in-execute-paths.test.mjs — gap-fan-in-execute-three-unverified-paths: the three UNVERIFIED
// hot points of plugin/workflows/fan-in-execute.js, exercised through the REAL invocation path
// (判据3 — NOT fixture-only pure-function mocks; the AC78 lesson: "改 workflow 的唯一有效验证=实调").
//
//   REAL-INVOCATION harness: every test first vm-EXECUTES the actual workflow file
//   (fan-in-execute.js) with the workflow-runtime globals (args/phase/log/agent) mocked, so the
//   script's own code runs and PRODUCES the exact subagent prompt it would emit — a parser/runtime
//   break in the file (the AC78 `meta is not defined` class, or a template-literal backtick blowup)
//   fails every test, not just a source read. Then each hot point's bash block is extracted from
//   the REAL emitted prompt and EXECUTED against real git / real filesystem state:
//
//   ① code_delta 正则 (:61-65)  — run the REAL fork/merge-base/diff/code_delta pipeline in a real
//       temp git repo (doc/code/test deltas) and assert the AC75 rerun/skip classification.
//   ② --agent-id 自找 (承重点②) — run the REAL selfloc bash (candidates/count/ls -t) against a fake
//       ~/.claude tree replaying the DIR-127/DIR-128 concurrency (flat trap a017ce6b7fab53eb9),
//       assert it deterministically picks the workflow-run subagent, NOT the flat trap; zero
//       candidates ⇒ fail-closed exit 2.
//   ③ flip sed 失败路径 (承重点③) — run the REAL flip guard against real task files: normal flip,
//       line-shape mismatch (status:Ready) ⇒ exit 2 + FATAL (no silent green), body annotation
//       'status: ready——注解' preserved (anchored $, no corruption).
//   ④ flip AC 完成闸 (gap-fan-in-flip-no-ac-completion-check) — run the REAL flip block against real
//       task files: AC 未全勾（gap-ac72 形态真样本）⇒ exit 2 + FATAL + 不翻 done; AC/DoD 段缺失 ⇒
//       exit 2 NOT-EVALUATED + 不翻 done（无法评估 ≠ 合格）; 剩余未勾均为（待外部）⇒ 翻 done; ③ 行形
//       检查与 AC 闸并列（两检查都过才翻，AC 闸在行形检查之后、sed 之前）。
//   ⑤ anti-drift-touches 守卫 (gap-anti-drift-touches-zero-coverage-fast-mode) — run the REAL step-1
//       anti-drift block from the emitted prompt against a real temp git repo (task worktree after the
//       step-1 merge): a task whose ACTUAL diff touches a file OUTSIDE its declared ## Touches ⇒ the
//       block HARD-FAILs (exit 2 + FATAL + ANTI-DRIFT HARD FAIL — the AC2 负控制: 现真值=不会, 修复后应红);
//       a task whose actual diff is fully within its declared Touches ⇒ the block stays green (AC3).
//
// Run:
//   scripts/test.sh plugin/test/fan-in-execute-paths.test.mjs
//   scripts/test.sh --for-task gap-fan-in-execute-three-unverified-paths --allow-thin
//   node --test plugin/test/fan-in-execute-paths.test.mjs

// SPLIT from fan-in-execute-paths.test.mjs by gap-suite-split-15-over-30s-test-files — shard 10/10 (9 tests). Shared fixtures: ./helpers/fan-in-execute-paths-harness.mjs (single source).

import { test } from "node:test";
import { REPO_ROOT, assert, cleanup, extractBlock, extractBlockFromPrompts, fixScopeGateBlockFor, fs, makeFixScopeDir, path, promptContaining, runBash, runWorkflow, spawn, spawnSync } from "./helpers/fan-in-execute-paths-harness.mjs";

test("defer anti-livelock REAL — same non-load-sensitive other-task red 3 rounds ⇒ round-3 verdict deferLivelock=true (deterministic flake escalates)", async (t) => {
  const task = "gap-test-defer-ll-real";
  const dir = makeFixScopeDir("fan-in-defer-ll-", task, [
    "---",
    `id: ${task}`,
    "status: ready",
    "---",
    "## Touches",
    `- tasks/${task}.md`,
    "- pkg/a/**",
  ].join("\n") + "\n");
  t.after(() => cleanup(dir));
  const log = `/tmp/fan-in-suite-${task}.log`;
  const defer = `/tmp/fan-in-scope-defer-${task}.json`;
  // 确定性 flake（PHASE_OVERLAP 类）：非 load-sensitive、非本任务 Touches —— 每轮都红，无根因可修。
  fs.writeFileSync(log, [
    `__PERFILE__ duration_ms=1.2 ${dir}/pkg/OTHER/stray.test.mjs passed=false`,
  ].join("\n") + "\n", "utf8");
  t.after(() => { try { fs.rmSync(log, { force: true }); } catch (_) { /* best-effort */ } });
  t.after(() => { try { fs.rmSync(defer, { force: true }); } catch (_) { /* best-effort */ } });

  const block = await fixScopeGateBlockFor(task, dir);
  const gate = (round) => {
    const r = runBash(block + '\necho "GATE_OUT=[$fix_scope_out]"', { cwd: dir });
    assert.equal(r.status, 0, `round ${round} gate failed: ${r.stderr}`);
    const m = r.stdout.match(/GATE_OUT=\[(.*)\]/s);
    assert.ok(m, `round ${round} gate JSON echo missing:\n${r.stdout}`);
    return JSON.parse(m[1]);
  };
  const v1 = gate(1);
  const v2 = gate(2);
  const v3 = gate(3);
  assert.equal(v1.deferRounds, 1, "round 1: deferRounds=1");
  assert.equal(v1.deferLivelock, false, "round 1: deferRounds=1 < 3 ⇒ no defer livelock");
  assert.equal(v2.deferRounds, 2, "round 2: deferRounds=2");
  assert.equal(v2.deferLivelock, false, "round 2: deferRounds=2 < 3 ⇒ no defer livelock");
  assert.equal(v3.deferRounds, 3, "round 3: deferRounds=3");
  assert.equal(v3.deferLivelock, true, "round 3: deferRounds=3 ≥ 3 ⇒ deferLivelock=true (escalate, AC2)");
});


test("defer anti-livelock reset — an in-scope fix (or load-sensitive release) resets the defer counter (progress ⇒ not a livelock)", async (t) => {
  const task = "gap-test-defer-ll-reset";
  const dir = makeFixScopeDir("fan-in-defer-ll-r-", task, [
    "---",
    `id: ${task}`,
    "status: ready",
    "---",
    "## Touches",
    `- tasks/${task}.md`,
    "- pkg/a/**",
  ].join("\n") + "\n");
  t.after(() => cleanup(dir));
  const log = `/tmp/fan-in-suite-${task}.log`;
  const defer = `/tmp/fan-in-scope-defer-${task}.json`;
  // round 1 / round 3: 纯 defer（out-of-Touches 确定性红）；round 2: in-scope 回归（有进展）。
  const deferLog = `__PERFILE__ duration_ms=1.2 ${dir}/pkg/OTHER/stray.test.mjs passed=false\n`;
  const fixLog = `__PERFILE__ duration_ms=1.2 ${dir}/pkg/a/x.test.mjs passed=false\n`;
  t.after(() => { try { fs.rmSync(log, { force: true }); } catch (_) { /* best-effort */ } });
  t.after(() => { try { fs.rmSync(defer, { force: true }); } catch (_) { /* best-effort */ } });

  const block = await fixScopeGateBlockFor(task, dir);
  const gate = () => {
    const r = runBash(block + '\necho "GATE_OUT=[$fix_scope_out]"', { cwd: dir });
    assert.equal(r.status, 0, `gate failed: ${r.stderr}`);
    const m = r.stdout.match(/GATE_OUT=\[(.*)\]/s);
    assert.ok(m, `gate JSON echo missing:\n${r.stdout}`);
    return JSON.parse(m[1]);
  };
  fs.writeFileSync(log, deferLog, "utf8");
  const v1 = gate();
  assert.equal(v1.deferRounds, 1, "round 1 (pure defer): deferRounds=1");
  fs.writeFileSync(log, fixLog, "utf8");
  const v2 = gate();
  assert.equal(v2.deferRounds, 0, "round 2 (in-scope fix): deferRounds reset to 0");
  assert.equal(v2.deferLivelock, false, "round 2 (in-scope fix): no defer livelock");
  fs.writeFileSync(log, deferLog, "utf8");
  const v3 = gate();
  assert.equal(v3.deferRounds, 1, "round 3 (pure defer again): deferRounds=1 (not 2 — reset by progress)");
});


test("defer anti-livelock — fix agent escalation (escalate='defer-livelock') ⇒ workflow returns needs-human (retreat, no infinite relaunch)", async (t) => {
  const { prompts, result } = await runWorkflow({
    args: { task: "gap-test-defer-ll-wf", worktree: "/tmp/wt", root: REPO_ROOT, runId: "fm-defer-ll-wf", mergeTarget: "develop", maxSuitePolls: 5, maxFixRounds: 4, maxDeferRelaunches: 3 },
    agentResults: [
      { outcome: "suite-started", suitePid: 111, codeDelta: "code", worktreeHead: "h1", note: "" },
      { outcome: "suite-red", suiteExit: 1, ffOk: false },
      { relaunched: false, rerunMode: null, escalate: "defer-livelock", worktreeHead: "h2", failuresFixed: [], note: "other-task defer anti-livelock（deferRounds≥3）：停止无界 relaunch，escalate → needs-human / 交 outer" },
    ],
  });
  const fixPrompts = prompts.filter((p) => p.includes("suite-fix 阶段"));
  assert.equal(fixPrompts.length, 1, "defer escalation emits ONE fix prompt, then stops (no round-2 relaunch)");
  assert.equal(result.outcome, "needs-human", "defer anti-livelock must retreat to needs-human (not another relaunch, not red)");
  assert.ok(result.message.includes("defer anti-livelock"), `the workflow message names the defer anti-livelock, got: ${result.message}`);
  assert.ok(result.message.includes("hand to outer"), "the defer escalation message must hand off to outer");
  assert.equal(result.ffOk, false, "no ff on defer escalation");
});

// ── ⑨ impl-complete event (gap-inflight-states-missing-impl-complete-event) ─────────────────────────
// fan-in writes the THIRD lifecycle event (`--impl-complete`) after impl completes (suite green) and
// BEFORE land (step 4.4, between step 4's suite and step 5's flip+ff). The block is runId-guarded
// (no --task-start bracket ⇒ no event). AC5 负控制: the write lives in phase 2, fires only when
// runId is set, and idempotency is handled by fast-mode-telemetry's hasImplCompleteEvent guard.


test("⑨ impl-complete — phase-2 prompt writes the event after suite green, before land; runId-guarded", async () => {
  const { prompts } = await runWorkflow({
    args: { task: "gap-test-implc", worktree: "/tmp/wt", root: REPO_ROOT, runId: "fm-implc-1", mergeTarget: "develop" },
  });
  const p2 = promptContaining(prompts, "# impl-complete-block-start");
  // The block lives in phase 2 (the prompt that also carries the suite-record + flip blocks), i.e.
  // AFTER the suite is green and BEFORE land (step 5 flip+ff).
  assert.ok(p2.includes("# suite-record-block-start"), "impl-complete sits with the phase-2 mechanical steps");
  assert.ok(p2.includes("# flip-block-start"), "impl-complete precedes the flip block (land) in phase 2");
  // The write is the real telemetry CLI, worktree-rooted, carrying task + runId + root.
  assert.ok(p2.includes("fast-mode-telemetry.ts --impl-complete"), "phase-2 must write the impl-complete event");
  assert.ok(p2.includes("--taskId gap-test-implc") && p2.includes("--runId fm-implc-1"), "the event carries taskId + runId");
  assert.ok(p2.includes(`--root ${REPO_ROOT}`), "the event writes to the main checkout's event store");
  assert.ok(p2.includes(`/tmp/wt/plugin/scripts/`), "the CLI resolves from the worktree (orchestration-bootstrap)");
  // The block is runId-guarded: no bracket ⇒ no event (AC5 负控制 for a runId-less fan-in). The
  // `${runId}` is INTERPOLATED by the workflow's template literal at build time.
  assert.ok(p2.includes('if [ -n "fm-implc-1" ]; then'), `the impl-complete write is guarded by the runId presence, got guard: ${p2.split("\n").find((l) => l.includes("if [ -n"))}`);
});


test("⑨ impl-complete — runId-less fan-in skips the write (AC5 负控制)", async () => {
  const { prompts } = await runWorkflow({
    args: { task: "gap-test-implc-norid", worktree: "/tmp/wt", root: REPO_ROOT, runId: null, mergeTarget: "develop" },
  });
  const p2 = promptContaining(prompts, "# impl-complete-block-start");
  // With runId null the block still emits (the CLI call is inside the guard), but the guard branch
  // is falsy (the interpolated runId is the empty string) — the event write must NOT fire.
  assert.ok(p2.includes('if [ -n "" ]; then'), `the runId guard is present even when runId is empty, got guard: ${p2.split("\n").find((l) => l.includes("if [ -n"))}`);
  // The step-4.4 block's own comment names the skip condition for a runId-less write.
  assert.ok(p2.includes("runId 为空") || p2.includes("未走 --task-start 留痕"), "the block documents the runId-less skip");
});

// ── ⑪ 跨 relaunch 锁持有者卡死/失联检测（gap-suite-lock-holder-stuck-detection）──────────────────────
// THE DEFECT: hub-strip 无限 relaunch 期间，suite 锁被上一轮 hung 的 detached suite 持续持有——fan-in 的
// detached 直跑（setsid bash scripts/test.sh）不经 full-suite-runner.ts ⇒ SUITE_MAX_RUNTIME_MS(45min)/
// SUITE_SILENCE_MS(15min) 管不到它，且每次 relaunch 新起进程、单次超时重置 ⇒ 跨 relaunch 无限持有。
// FIX: SUITE_LAUNCH/ISOLATE_LAUNCH 在 relaunch 前读上一轮 pidfile（`pid started_ms`）；上一轮【应已死亡】，
// 仍存活 = 卡死 ⇒ 存活且持有 ≥ stuckHolderGraceSecs ⇒ SIGKILL 整进程组释放槽 + 告警（谁/多久/动作）；
// 未超阈值 ⇒ 告警不杀；已死 ⇒ 陈旧 pidfile 静默清理（正常路径，非持有）。


test("⑪ stuck-holder wiring — launch blocks carry the cross-relaunch reap (kill + alert + pid started_ms record)", async () => {
  const { prompts } = await runWorkflow({
    args: { task: "gap-test-stuck-wiring", worktree: "/tmp/wt", root: REPO_ROOT, runId: "fm-stuck-wiring", mergeTarget: "develop" },
    agentResults: [
      { outcome: "suite-started", suitePid: 111, codeDelta: "code", worktreeHead: "h1", note: "" }, // phase 1 (carries SUITE_LAUNCH)
      { outcome: "suite-red", suiteExit: 1, ffOk: false },                                           // stage 2 red
      { relaunched: true, worktreeHead: "h2", failuresFixed: [], note: "" },                          // Fix agent (carries ISOLATE_LAUNCH)
    ],
  });
  const launch = extractBlockFromPrompts(prompts, "# suite-launch-block-start", "# suite-launch-block-end");
  assert.ok(launch.includes("# suite-stale-holder-reap-block-start"), "suite-launch must carry the cross-relaunch stale-holder reap");
  assert.ok(launch.includes("__FANIN_STUCK_LOCK_HOLDER__"), "the reap must emit the loud alert marker (非静默)");
  assert.ok(launch.includes('kill -9 -"$_holder_pid"'), "the reap must SIGKILL the whole process group (release the single-flight slot)");
  assert.ok(launch.includes("action=SIGKILL-released"), "the reap must record the release action");
  assert.ok(launch.includes("held_s="), "the reap must record the held duration (多久)");
  assert.ok(launch.includes("pid="), "the reap must record the holder pid (谁)");
  assert.ok(launch.includes("suite_stuck_file="), "the reap must persist the alert to a ledger file (非静默)");
  const isolate = extractBlockFromPrompts(prompts, "# isolate-launch-block-start", "# isolate-launch-block-end");
  assert.ok(isolate.includes("# suite-stale-holder-reap-block-start"), "isolate-rerun launch must also carry the reap");
});


test("⑪ REAL stuck holder — alive holder with stale start ⇒ SIGKILL + __FANIN_STUCK_LOCK_HOLDER__ action=SIGKILL-released (AC1)", async (t) => {
  const task = "gap-test-stuck-real";
  const pidfile = `/tmp/fan-in-suite-${task}.pid`;
  const ledger = `/tmp/fan-in-stuck-holder-${task}.log`;
  fs.rmSync(ledger, { force: true });
  // 真实存活 holder（detached ⇒ 自身为 session leader/pgid，与生产 setsid detached suite 同形）。
  const holder = spawn("sleep", ["30"], { detached: true, stdio: "ignore" });
  t.after(() => { try { process.kill(-holder.pid, "SIGKILL"); } catch (_) { try { holder.kill("SIGKILL"); } catch (_) {} } });
  // 10s 前的 start ⇒ held_s ≈ 10 ≥ 阈值(2) ⇒ 杀 + 告警。
  fs.writeFileSync(pidfile, `${holder.pid} ${Date.now() - 10_000}\n`);
  t.after(() => { for (const f of [pidfile, ledger]) { try { fs.rmSync(f, { force: true }); } catch (_) {} } });

  const { prompts } = await runWorkflow({
    args: { task, worktree: "/tmp/wt", root: REPO_ROOT, runId: "fm-stuck-real", mergeTarget: "develop", stuckHolderGraceSecs: 2 },
  });
  const launch = extractBlockFromPrompts(prompts, "# suite-launch-block-start", "# suite-launch-block-end");
  const reap = extractBlock(launch, "# suite-stale-holder-reap-block-start", "# suite-stale-holder-reap-block-end");
  const r = runBash(`suite_pid_file="${pidfile}"; ${reap}`, { cwd: "/tmp", timeout: 10_000 });
  assert.match(r.stdout, /__FANIN_STUCK_LOCK_HOLDER__ .*action=SIGKILL-released/, `must alert + release, got: ${r.stdout}`);
  // SIGKILL 后进程先转 zombie、再被本测试进程（holder 的父进程）reap——kill -0 对 zombie 仍返回 0 ⇒
  // 轮询等待被 reap（每次 await 让事件循环跑起来 reap 子进程），而不是单点 kill -0（zombie 误判为存活）。
  let alive = "0";
  const deadline = Date.now() + 3000;
  while (Date.now() < deadline) {
    alive = spawnSync("bash", ["-c", `kill -0 ${holder.pid} 2>/dev/null; echo $?`], { encoding: "utf8" }).stdout.trim();
    if (alive === "1") break;
    await new Promise((res) => setTimeout(res, 50));
  }
  assert.equal(alive, "1", `the stuck holder must be SIGKILLed (kill -0 exit 1 after reap), got alive=${alive}`);
  const ledgerText = fs.readFileSync(ledger, "utf8");
  assert.match(ledgerText, /action=SIGKILL-released/, "the alert must persist to the ledger (非静默)");
});


test("⑪ REAL under-grace — alive holder with recent start ⇒ NOT killed + action=alive-under-grace-not-killed (AC1 负控制)", async (t) => {
  const task = "gap-test-stuck-grace";
  const pidfile = `/tmp/fan-in-suite-${task}.pid`;
  const ledger = `/tmp/fan-in-stuck-holder-${task}.log`;
  fs.rmSync(ledger, { force: true });
  const holder = spawn("sleep", ["30"], { detached: true, stdio: "ignore" });
  t.after(() => { try { process.kill(-holder.pid, "SIGKILL"); } catch (_) { try { holder.kill("SIGKILL"); } catch (_) {} } });
  fs.writeFileSync(pidfile, `${holder.pid} ${Date.now()}\n`);  // 刚启动 ⇒ held_s ≈ 0 < 阈值(2)
  t.after(() => { for (const f of [pidfile, ledger]) { try { fs.rmSync(f, { force: true }); } catch (_) {} } });

  const { prompts } = await runWorkflow({
    args: { task, worktree: "/tmp/wt", root: REPO_ROOT, runId: "fm-stuck-grace", mergeTarget: "develop", stuckHolderGraceSecs: 2 },
  });
  const launch = extractBlockFromPrompts(prompts, "# suite-launch-block-start", "# suite-launch-block-end");
  const reap = extractBlock(launch, "# suite-stale-holder-reap-block-start", "# suite-stale-holder-reap-block-end");
  const r = runBash(`suite_pid_file="${pidfile}"; ${reap}`, { cwd: "/tmp", timeout: 10_000 });
  assert.match(r.stdout, /action=alive-under-grace-not-killed/, `under-grace holder must alert but NOT kill, got: ${r.stdout}`);
  const alive = spawnSync("bash", ["-c", `kill -0 ${holder.pid} 2>/dev/null; echo $?`], { encoding: "utf8" }).stdout.trim();
  assert.equal(alive, "0", "an under-grace holder must NOT be killed (kill -0 exit 0)");
});


test("⑪ REAL dead holder — stale pidfile pointing at a dead pid ⇒ silent (no alert; normal completion path)", async (t) => {
  const task = "gap-test-stuck-dead";
  const pidfile = `/tmp/fan-in-suite-${task}.pid`;
  const ledger = `/tmp/fan-in-stuck-holder-${task}.log`;
  fs.rmSync(ledger, { force: true });
  const deadPid = Number(spawnSync("bash", ["-c", "echo $$; sleep 0.1"], { encoding: "utf8" }).stdout.trim());
  assert.ok(Number.isInteger(deadPid) && deadPid > 0, `dead pid precondition: got ${deadPid}`);
  fs.writeFileSync(pidfile, `${deadPid} ${Date.now() - 10_000}\n`);
  t.after(() => { for (const f of [pidfile, ledger]) { try { fs.rmSync(f, { force: true }); } catch (_) {} } });

  const { prompts } = await runWorkflow({
    args: { task, worktree: "/tmp/wt", root: REPO_ROOT, runId: "fm-stuck-dead", mergeTarget: "develop", stuckHolderGraceSecs: 2 },
  });
  const launch = extractBlockFromPrompts(prompts, "# suite-launch-block-start", "# suite-launch-block-end");
  const reap = extractBlock(launch, "# suite-stale-holder-reap-block-start", "# suite-stale-holder-reap-block-end");
  const r = runBash(`suite_pid_file="${pidfile}"; ${reap}`, { cwd: "/tmp", timeout: 10_000 });
  assert.ok(!r.stdout.includes("__FANIN_STUCK_LOCK_HOLDER__"), `a dead holder must NOT alert (normal completion path), got: ${r.stdout}`);
});
