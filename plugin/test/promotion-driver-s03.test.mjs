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

// SPLIT from promotion-driver.test.mjs by gap-suite-split-15-over-30s-test-files — shard 3/5 (10 tests). Shared fixtures: ./helpers/promotion-driver-harness.mjs (single source).

import { test } from "node:test";
import { FIX_WORKER_TIMEOUT_ENV, FIX_WORKER_TIMEOUT_MS, REPO_ROOT, ROUND_TIMEOUT_MS, advanceRetryCap, assert, buildFixWorkerArgv, buildFixWorkerPrompt, computeOutcomeRecords, computeReverifyOutcome, computeRoundRecord, fs, makeRoot, path, resolveFixWorkerTimeoutMs, runFixPass, spawn, spawnFixWorker } from "./helpers/promotion-driver-harness.mjs";

test("computeReverifyOutcome — a re-run that judges the body NOT EVALUATED lands in notEvaluatedIds, ⛔ not stillIneligible (so it never advances the retry cap)", () => {
  const re = {
    ok: true, error: null, pool: 1, shouldApply: false, promotedIds: [], applied: [], promotePathLlmInvoked: false,
    fixDecisions: [
      { id: "gap-stale", fixable: false, missing: [], notEvaluated: true, unfixable: ["bodyNotEvaluated=true freshness=stale-suspected"], prompt: null },
      { id: "gap-real", fixable: true, missing: ["touchesResolve=false"], unfixable: [], prompt: "p" },
    ],
  };
  const r = computeReverifyOutcome(["gap-stale", "gap-real"], re);
  assert.deepEqual(r.notEvaluatedIds, ["gap-stale"], "the unvouched-for body ⇒ third bucket");
  assert.deepEqual(r.stillIneligibleIds, ["gap-real"], "a genuine still-ineligible stays counted (⛔ the third state did not swallow it)");
  assert.deepEqual(r.nowEligibleIds, []);
  // The consequence that matters: only the genuine failure advances the cap.
  const state = { counts: new Map(), needsHuman: new Set() };
  assert.deepEqual(advanceRetryCap(state, r.stillIneligibleIds, 1), ["gap-real"], "the real failure counts");
  assert.equal(state.counts.has("gap-stale"), false, "⛔ the unvouched-for body never advances the retry cap — this is the needs-human flip's root");
});


test("buildFixWorkerPrompt — task id + structured missing list, ⛔ not a prose directive", () => {
  const p = buildFixWorkerPrompt("gap-a", ["fourArtifacts=false missing=[dod]"]);
  assert.ok(p.includes("task_id=gap-a"), "the prompt carries the task id");
  assert.ok(p.includes("fourArtifacts=false missing=[dod]"), "the structured missing identifier is in the prompt");
  assert.ok(p.includes("structured_missing:"), "the prompt names the structured list (not 'go look what's wrong')");
});


test("buildFixWorkerArgv — default policy-resolved fix-worker; override prefix appends the prompt as the last arg", () => {
  const def = buildFixWorkerArgv("gap-a", ["fourArtifacts=false missing=[dod]"], REPO_ROOT);
  assert.equal(def[0], "claude-fjdac",
    "AC140-1/L3: fix worker resolves via policy to the profile launcher (⛔ bash quay-launch.sh)");
  assert.equal(def[def.indexOf("-n") + 1], "quay-fix-worker");
  assert.ok(def[def.length - 1].includes("fourArtifacts=false missing=[dod]"), "the prompt is the argv payload");

  const over = buildFixWorkerArgv("gap-a", ["fourArtifacts=false missing=[dod]"], REPO_ROOT, "node -e capture");
  assert.deepEqual(over.slice(0, 3), ["node", "-e", "capture"]);
  assert.ok(over[over.length - 1].includes("fourArtifacts=false missing=[dod]"), "override keeps the prompt as the last arg");
});


test("gap-fix-worker-spawn-inherits-unrecognized-model — fix-worker argv aligns ANTHROPIC_DEFAULT_*_MODEL with --model (AC1 结构保证)", () => {
  const def = buildFixWorkerArgv("gap-a", ["fourArtifacts=false missing=[dod]"], REPO_ROOT);
  const si = def.indexOf("--settings");
  assert.notEqual(si, -1, "fix-worker argv must carry --settings");
  const settingsRaw = def[si + 1];
  assert.ok(settingsRaw.startsWith("{"), `worker-default profile env must make --settings JSON (carries aligned env), got: ${String(settingsRaw).slice(0, 48)}`);
  const settings = JSON.parse(settingsRaw);
  const mi = def.indexOf("--model");
  const model = def[mi + 1];
  // AC1/AC4 结构保证：SDK 只在 --model 命中 ANTHROPIC_DEFAULT_*_MODEL 时才认自定义 model id（否则
  // unrecognized_model sdk、回退到 wrapper 的无后缀值）；且 -anthropic 后缀必须保留到 litellm（fallback
  // group，AC4 不回归）。
  assert.equal(settings.env.ANTHROPIC_DEFAULT_HAIKU_MODEL, model, "HAIKU default must match --model (else unrecognized_model)");
  assert.equal(settings.env.ANTHROPIC_DEFAULT_SONNET_MODEL, model, "SONNET default must match --model (else unrecognized_model)");
  assert.equal(settings.env.ANTHROPIC_DEFAULT_OPUS_MODEL, model, "OPUS default must match --model (else unrecognized_model)");
  assert.equal(model, "deepseek-v4-pro-anthropic", "the model must keep the -anthropic suffix (litellm fallback group)");
});


test("runFixPass — fixable spawns (exit 0), unfixable records reason without spawning", (t) => {
  const root = makeRoot("fixpass");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const decisions = [
    { id: "gap-fix", fixable: true, missing: ["fourArtifacts=false missing=[dod]"], unfixable: [], prompt: "p" },
    { id: "gap-nofix", fixable: false, missing: [], unfixable: ["depsReady=false"], prompt: null },
  ];
  const outcomes = runFixPass(decisions, root, "node -e process.exit(0)");
  assert.equal(outcomes[0].id, "gap-fix");
  assert.equal(outcomes[0].spawned, true);
  assert.deepEqual(outcomes[0].missing, ["fourArtifacts=false missing=[dod]"]);
  assert.equal(outcomes[0].exitCode, 0);
  assert.equal(outcomes[0].stderr, null);
  assert.equal(outcomes[0].timedOut, false);
  // gap-fix-worker-spawn-timeout-persists-post-fix AC4：spawn 的 argv + durationMs 落进 outcome。
  assert.deepEqual(outcomes[0].argv.slice(0, 3), ["node", "-e", "process.exit(0)"], "AC4: argv prefix recorded verbatim");
  assert.ok(outcomes[0].argv.length > 3 && outcomes[0].argv[3].includes("structured_missing"), "AC4: argv carries the appended fix prompt (last arg)");
  assert.ok(Number.isFinite(outcomes[0].durationMs) && outcomes[0].durationMs >= 0, `AC4: durationMs recorded: ${outcomes[0].durationMs}`);
  assert.deepEqual(outcomes[1], { id: "gap-nofix", spawned: false, missing: [], unfixable: ["depsReady=false"], exitCode: null, stderr: null, timedOut: false, argv: null, durationMs: null });
});


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
