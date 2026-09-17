// @test-group engine
// promotion-driver.test.mjs — AC130 + AC131 + AC132 + AC134 (tasks/gap-ac130-promotion-driver-resident-loop,
// tasks/gap-ac131-promotion-mechanical-no-llm, tasks/gap-ac132-fix-worker-structured-input,
// tasks/gap-ac134-promotion-outcome-ledger): the resident
// promotion driver loops forever, calling ready-pool-check for the FULL-pool determination (never a
// single --targeted task) each round, does not exit after one round, and enters the next round after
// --interval. AC2 is the FALSIFIABLE half: stop the driver ⇒ a newly-eligible todo in the pool is NOT
// promoted — proving promotion is driven by the driver, not some outer tick.
// AC131 (falsifiable): a qualified todo (four artifacts complete + empty deps) is promoted to ready
// within one round via the mechanical A22 --apply path, with ZERO LLM — the round's outcome record
// carries promote_path_llm_invoked=false (derived from the spawned argv, not hardcoded).
// AC132 (falsifiable): an ineligible todo spawns a short-lived `claude -p` fix worker whose input is
// the task id + the gate's STRUCTURED missing list (A24 三可修/五不可修), never a prose directive.
// AC2: a DoD<40 todo ⇒ the fix worker's prompt carries the structured identifier (fourArtifacts=false
// missing=[dod]); a prompt with only the task id and no missing list would falsify it.
// AC134 (falsifiable): every determination/promotion/fix writes one structured outcome record to
// .quay/promotion-outcome.jsonl (gitignored) with task_id · gate(eligible + missing) · action
// (promote/fix/skip) · result · ts. AC2: the carrier holds REAL records from the real ready-pool-check
// against real task files (not fixture/injected output) — ≥ N records after the driver runs.
//
// The ready-pool-check command is injectable (--ready-pool-cmd) so the pure/loop tests never touch the
// real checker; the AC2 test drives the REAL ready-pool-check --apply against a temp workspace to prove
// the promotion lands on disk while the driver lives and does not after it is SIGTERM'd. The fix-worker
// command is injectable (--fix-worker-cmd) with the structured prompt appended as the last arg, so the
// AC132 AC2 test captures the prompt the worker actually received without spawning a real claude.
//
// Run: scripts/test.sh plugin/test/promotion-driver.test.mjs

// SPLIT from promotion-driver.test.mjs by gap-suite-split-15-over-30s-test-files — shard 5/8 (6 tests). Shared fixtures: ./helpers/promotion-driver-harness.mjs (single source).

import { test } from "node:test";
import { FIX_WORKER_TIMEOUT_ENV, FIX_WORKER_TIMEOUT_MS, ROUND_TIMEOUT_MS, assert, buildFixWorkerArgv, computeOutcomeRecords, computeRoundRecord, fs, makeRoot, path, readRoundLines, resolveFixWorkerTimeoutMs, runDriver, runFixPass, spawn, spawnFixWorker, writeTask } from "./helpers/promotion-driver-harness.mjs";

test("gap-fix-worker-spawn-timeout-persists-post-fix AC4 — failure record carries argv + durationMs + exitCode", (t) => {
  const root = makeRoot("ac4-diag");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  // 非零退出（失败）：argv 逐字、durationMs 有限、exitCode 落盘。
  // 超时用生产默认值（FIX_WORKER_TIMEOUT_MS，gap-fix-worker-timeout-budget-inherited-from-mechanical-round
  // 后为 600s），⛔ 不再传硬字面 5000：本断言要测的是「非零退出被记录」，而 5000ms 是「模块加载后
  // spawn 一个 node 必须 <5s」的墙钟余量——并发负载下本文件耗时 222s（隔离 70s，实测 2026-09-13）
  // ⇒ 子进程起不来、exitCode 变成 null，余量被负载击穿。默认值余量更大，与相邻 runFixPass 测试
  // （也断言 timedOut===false）一致。
  const argv = ["node", "-e", "process.stderr.write('boom');process.exit(3)"];
  const r = spawnFixWorker(argv, root, FIX_WORKER_TIMEOUT_MS);
  assert.equal(r.timedOut, false, `a fast exit must NOT be reported as a timeout (timeoutMs=${FIX_WORKER_TIMEOUT_MS})`);
  assert.equal(r.exitCode, 3, "exit code recorded");
  assert.deepEqual(r.argv, argv, "argv recorded verbatim");
  assert.ok(Number.isFinite(r.durationMs) && r.durationMs >= 0, `durationMs recorded: ${r.durationMs}`);
  // 超时（失败）：同样带 argv + durationMs（AC4 点名「失败时」——超时是失败的一种，此前只留 stderr 首行）。
  const rt = spawnFixWorker(["sleep", "5"], root, 200);
  assert.equal(rt.timedOut, true);
  assert.deepEqual(rt.argv, ["sleep", "5"], "timeout path also records argv");
  assert.ok(Number.isFinite(rt.durationMs) && rt.durationMs >= 0, `timeout path also records durationMs: ${rt.durationMs}`);
  // 失败记录序列化进 round 记录（promotion-round.jsonl 的 fixes[] 可 grep 到三项）。
  const rec = computeRoundRecord({
    round: 1, runId: "pm-1", pid: 1, at: "t", pool: 0, shouldApply: false, promotedIds: [], applied: [], error: null, promotePathLlmInvoked: false,
    fixes: [{ id: "gap-x", spawned: true, missing: ["selfTouchOk=false"], unfixable: [], exitCode: r.exitCode, stderr: r.stderr, timedOut: false, argv: r.argv, durationMs: r.durationMs }],
  });
  const j = JSON.stringify(rec);
  assert.ok(j.includes('"argv"'), "round record JSON carries argv key (grep-able)");
  assert.ok(j.includes('"durationMs"'), "round record JSON carries durationMs key (grep-able)");
  assert.ok(j.includes('"exitCode"'), "round record JSON carries exitCode key (grep-able)");
});


test("AC142 AC1 — spawnFixWorker captures stderr; outcome result.detail carries it (spawn 失败不再零诊断)", (t) => {
  const root = makeRoot("ac142-ac1");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  // 一个写 stderr + exit 1 的 fix worker（模拟认证失败/报错——之前 10 条 spawned exit=1 零 stderr 不可诊断）。
  const r = spawnFixWorker(["node", "-e", "process.stderr.write('AUTH-ERROR: no credentials');process.exit(1)"], root);
  assert.equal(r.exitCode, 1, "spawn exit 1 is still captured");
  assert.equal(r.timedOut, false);
  assert.ok(r.stderr && r.stderr.includes("AUTH-ERROR"), `stderr captured (⛔ 不再 ignore): ${JSON.stringify(r.stderr)}`);

  // 诊断面落进可查载体（promotion-outcome.jsonl 的 result.detail）：spawn 失败时带 stderr 截断。
  const recs = computeOutcomeRecords({
    at: "t",
    applied: [],
    fixes: [{ id: "gap-x", spawned: true, missing: ["fourArtifacts=false missing=[dod]"], unfixable: [], exitCode: 1, stderr: r.stderr, timedOut: false }],
  });
  const fix = recs.find((o) => o.action === "fix");
  assert.equal(fix.result.ok, false);
  assert.ok(fix.result.detail.includes("stderr=AUTH-ERROR"), `detail carries stderr: ${fix.result.detail}`);
});


test("AC142 AC1 — spawnFixWorker timeout ⇒ timedOut=true + error (ETIMEDOUT), exitCode null", (t) => {
  const root = makeRoot("ac142-timeout");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const r = spawnFixWorker(["sleep", "5"], root, 300);
  assert.equal(r.timedOut, true, "timeout fired ⇒ timedOut=true");
  assert.ok(r.error, "timeout produces an error");
  assert.equal(r.exitCode, null, "no exit code on timeout");
});

// ── gap-fix-worker-timeout-budget-inherited-from-mechanical-round ──────────────────────────────────
// AC1: the fix worker's budget is DECOUPLED from the mechanical round's and is OVERRIDABLE. The two
// halves are separately falsifiable: (a) the constants differ AND the resolver's three states are
// distinguishable; (b) a REAL spawn honours a passed override near that value (not near the default).

test("gap-fix-worker-timeout-budget AC1 — budget decoupled from ROUND_TIMEOUT_MS and resolvable (CLI > env > default)", () => {
  // (a) Decoupling: the two constants constrain objects with different cost structures — a zero-LLM
  // mechanical script vs. a `claude -p` agent call. Equal values were the inherited-budget defect.
  assert.notEqual(
    FIX_WORKER_TIMEOUT_MS, ROUND_TIMEOUT_MS,
    "FIX_WORKER_TIMEOUT_MS must NOT equal ROUND_TIMEOUT_MS (the inherited-budget defect)",
  );
  assert.ok(
    FIX_WORKER_TIMEOUT_MS > ROUND_TIMEOUT_MS,
    `the agent budget must exceed the mechanical script's (got ${FIX_WORKER_TIMEOUT_MS} vs ${ROUND_TIMEOUT_MS})`,
  );

  // (b) Three resolvable states, each distinguishable (⛔ a single number would collapse them).
  const none = resolveFixWorkerTimeoutMs(undefined, {});
  assert.equal(none.ok, true);
  assert.equal(none.source, "default", "no override ⇒ default");
  assert.equal(none.value, FIX_WORKER_TIMEOUT_MS);

  const viaEnv = resolveFixWorkerTimeoutMs(undefined, { [FIX_WORKER_TIMEOUT_ENV]: "5000" });
  assert.equal(viaEnv.ok, true);
  assert.equal(viaEnv.source, "env", "env override is a distinct state");
  assert.equal(viaEnv.value, 5000);

  // CLI wins over env (two different override paths ⇒ precedence is observable, not assumed).
  const viaCli = resolveFixWorkerTimeoutMs("7000", { [FIX_WORKER_TIMEOUT_ENV]: "5000" });
  assert.equal(viaCli.ok, true);
  assert.equal(viaCli.source, "cli");
  assert.equal(viaCli.value, 7000);

  // Fail-closed: an unparseable / non-positive override is REJECTED (hard rule 3b — "misconfigured"
  // must not be indistinguishable from "not configured", which is the state that takes the default).
  // (An empty string means "not set" — the same convention mergeEnv uses — so it takes the default;
  // only a NON-empty unparseable value is a misconfiguration and is rejected.)
  assert.equal(resolveFixWorkerTimeoutMs("", {}).source, "default", "empty ⇒ not set ⇒ default");
  for (const bad of ["0", "-1", "abc", "1.5"]) {
    const r = resolveFixWorkerTimeoutMs(bad, {});
    assert.equal(r.ok, false, `invalid override ${JSON.stringify(bad)} must be rejected, got ${JSON.stringify(r)}`);
  }
  const badEnv = resolveFixWorkerTimeoutMs(undefined, { [FIX_WORKER_TIMEOUT_ENV]: "not-a-number" });
  assert.equal(badEnv.ok, false, "an unparseable env override must be rejected, not silently defaulted");
});

// AC1 取假 (the half that matters): a REAL spawn must time out NEAR the passed value. The control is
// the sibling `--fix-worker-cmd` round-trip test above, where the same shape of command exits fast
// under the default — so a pass here is not "everything times out".

test("gap-fix-worker-timeout-budget AC1 — a real fix-worker spawn honours a passed override (times out near 1500ms, not at the 600s default)", (t) => {
  const root = makeRoot("timeout-budget");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const decided = [{ id: "gap-budget", fixable: true, missing: ["fourArtifacts=false missing=[dod]"], unfixable: [], prompt: "p" }];

  // NOTE the command shape: runFixPass appends the structured prompt as the LAST argv element
  // (buildFixWorkerArgv), so the command must tolerate a trailing argument — `sleep 30 <prompt>`
  // makes sleep reject two operands and exit instantly. A space-free `node -e` that just waits does.
  const started = Date.now();
  const outs = runFixPass(decided, root, "node -e setTimeout(()=>{},30000)", 1500);
  const elapsed = Date.now() - started;

  assert.equal(outs[0].spawned, true);
  assert.equal(outs[0].timedOut, true, "a command outliving the budget must be reported as a timeout");
  assert.equal(outs[0].exitCode, null);
  assert.ok(
    Number.isFinite(outs[0].durationMs) && outs[0].durationMs >= 1400 && outs[0].durationMs < 10000,
    `durationMs must sit near the 1500ms override, got ${outs[0].durationMs}`,
  );
  assert.ok(elapsed < 15000, `the spawn must end near the override, not at the default budget: ${elapsed}ms`);
  // Negative control, read from the constant rather than by waiting it out: the default is far above
  // both the override and the budget it was inherited from (180_000) — so the timeout above cannot be
  // the default firing. (Actually spawning to the default would take 10 minutes; the reading is the
  // honest, cheap control here.)
  assert.ok(FIX_WORKER_TIMEOUT_MS > 180_000, `the default must be looser than the inherited 180_000, got ${FIX_WORKER_TIMEOUT_MS}`);
  assert.ok(elapsed < FIX_WORKER_TIMEOUT_MS / 10, `elapsed ${elapsed}ms is nowhere near the default ${FIX_WORKER_TIMEOUT_MS}ms`);
});


test("gap-fix-worker-timeout-budget — --fix-worker-timeout-ms reaches the round record (end-to-end through the real CLI)", (t) => {
  const root = makeRoot("timeout-cli");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  writeTask(root, "gap-budget-cli");

  // A misconfigured value is rejected at the CLI boundary (exit 2, fail-closed — never a silent default).
  assert.throws(
    () => runDriver(root, ["--once", "--fix-worker-timeout-ms", "nope"]),
    (e) => e.status === 2,
    "an unparseable --fix-worker-timeout-ms must exit 2",
  );

  // The effective budget is recorded per round, so a reading is attributable to the budget that
  // produced it (⛔ otherwise pre-/post-widening records are indistinguishable in the carrier).
  runDriver(root, [
    "--ready-pool-cmd", "node -e console.log(JSON.stringify({ok:true}))",
    "--resource-gate-cmd", "node -e process.exit(0)",
    "--fix-worker-timeout-ms", "5000",
    "--once",
  ]);
  const lines = readRoundLines(root);
  assert.equal(lines.length, 1, `one round record expected, got ${lines.length}`);
  assert.equal(lines[0].fix_worker_timeout_ms, 5000, "the CLI override must reach the round record verbatim");

  // Control: a run with no override records the module default — i.e. the field is a real reading
  // of the effective budget, not a constant echo of whatever the test passed.
  const root2 = makeRoot("timeout-cli-default");
  t.after(() => fs.rmSync(root2, { recursive: true, force: true }));
  writeTask(root2, "gap-budget-cli-2");
  runDriver(root2, [
    "--ready-pool-cmd", "node -e console.log(JSON.stringify({ok:true}))",
    "--resource-gate-cmd", "node -e process.exit(0)",
    "--once",
  ]);
  assert.equal(readRoundLines(root2)[0].fix_worker_timeout_ms, FIX_WORKER_TIMEOUT_MS);
});
