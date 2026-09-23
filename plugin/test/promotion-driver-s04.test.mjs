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

// SPLIT from promotion-driver.test.mjs by gap-suite-split-15-over-30s-test-files — shard 4/8 (6 tests). Shared fixtures: ./helpers/promotion-driver-harness.mjs (single source).

import { test } from "node:test";
import { REPO_ROOT, advanceRetryCap, assert, buildFixWorkerArgv, buildFixWorkerPrompt, computeReverifyOutcome, fs, makeRoot, runFixPass, spawn } from "./helpers/promotion-driver-harness.mjs";

test("runFixPass — a not-evaluated decision does NOT spawn (the takeable-false control on the spawn itself)", () => {
  // The override command keeps the negative control hermetic: `node -e 0` exits 0 without an LLM.
  const INERT = "node -e 0";
  const notEval = runFixPass(
    [{ id: "gap-a", fixable: false, missing: [], notEvaluated: true, unfixable: ["bodyNotEvaluated=true freshness=stale-suspected"], prompt: null }],
    REPO_ROOT, INERT,
  )[0];
  assert.equal(notEval.spawned, false, "⛔ no worker spawned");
  assert.equal(notEval.notEvaluated, true, "…and the outcome record says WHICH kind of no-spawn this is");
  assert.equal(notEval.argv, null);
  // Negative control: the same id with a fixable decision DOES spawn (so the assertion above is about
  // this decision, not about runFixPass being inert).
  const fixable = runFixPass(
    [{ id: "gap-a", fixable: true, missing: ["touchesResolve=false"], unfixable: [], prompt: "p" }],
    REPO_ROOT, INERT,
  )[0];
  assert.equal(fixable.spawned, true, "control: a fixable decision still spawns");
  assert.equal(!!fixable.notEvaluated, false, "control: a spawn is never marked not-evaluated");
});


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
  // AC1 结构保证：SDK 只在 --model 命中 ANTHROPIC_DEFAULT_*_MODEL 时才认自定义 model id（否则
  // unrecognized_model sdk、回退到 wrapper 的默认值）。这三条才是本 AC 真正要的「对齐」性质，且能取假。
  assert.equal(settings.env.ANTHROPIC_DEFAULT_HAIKU_MODEL, model, "HAIKU default must match --model (else unrecognized_model)");
  assert.equal(settings.env.ANTHROPIC_DEFAULT_SONNET_MODEL, model, "SONNET default must match --model (else unrecognized_model)");
  assert.equal(settings.env.ANTHROPIC_DEFAULT_OPUS_MODEL, model, "OPUS default must match --model (else unrecognized_model)");
  // ⛔ 不断言模型名字面量、也不断言 `-anthropic` 后缀形态：模型名是【运行环境取值】（随网关导出集合
  //   漂移），而 `-anthropic` 是【旧网关 fjbigmodel.fjdac.cn 的命名约定】，对现在的 127.0.0.1:26510
  //   不适用（见 ~/.local/bin/claude-fjdac 的 2026-09-20 更正）。钉住它只会让判据在换模型时烂掉。
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
