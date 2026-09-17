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

// SPLIT from promotion-driver.test.mjs by gap-suite-split-15-over-30s-test-files — shard 7/8 (6 tests). Shared fixtures: ./helpers/promotion-driver-harness.mjs (single source).

import { test } from "node:test";
import { MAX_FIX_RETRIES_DEFAULT, advanceRetryCap, assert, computeReverifyOutcome, fixWorkerNoopCounter, fs, makeRoot, markNeedsHuman, path, readOutcomeLines, readRoundLines, readStatus, realReadyPoolCmd, runDriver, spawn, writeDodShortTask, writeTask } from "./helpers/promotion-driver-harness.mjs";

test("AC133 MAX_FIX_RETRIES_DEFAULT — 与 fan-in 侧 attempt>=3 同值，非新设阈值", () => {
  assert.equal(MAX_FIX_RETRIES_DEFAULT, 3, "default retry cap = 3 (gap-fan-in-relaunch-retry-cap 同值)");
});


test("computeReverifyOutcome — 闸的新判定归类：nowEligible / stillIneligible / notEvaluated / neither（纯函数）", () => {
  // gate now says eligible (promotions contains the id) ⇒ fix took
  const eligible = { ok: true, error: null, pool: 1, shouldApply: true, promotedIds: ["gap-a"], applied: [], promotePathLlmInvoked: false, fixDecisions: [] };
  const r1 = computeReverifyOutcome(["gap-a", "gap-b"], eligible);
  assert.deepEqual(r1.nowEligibleIds, ["gap-a"], "闸判合格 ⇒ nowEligible");
  assert.deepEqual(r1.stillIneligibleIds, []);
  assert.deepEqual(r1.notEvaluatedIds, [], "ok=true ⇒ 无 not-evaluated");

  // gate still says ineligible (fixDecisions contains eligible=false) ⇒ fix did NOT take
  const stillBad = {
    ok: true, error: null, pool: 1, shouldApply: false, promotedIds: [], applied: [], promotePathLlmInvoked: false,
    fixDecisions: [
      { id: "gap-a", fixable: true, missing: ["fourArtifacts=false missing=[dod]"], unfixable: [], prompt: "p" },
    ],
  };
  const r2 = computeReverifyOutcome(["gap-a"], stillBad);
  assert.deepEqual(r2.nowEligibleIds, [], "闸仍判不合格 ⇒ ⛔ 不得晋升");
  assert.deepEqual(r2.stillIneligibleIds, ["gap-a"], "闸仍判不合格 ⇒ stillIneligible（⛔ 不信 worker 自述「已修好」）");
  assert.deepEqual(r2.notEvaluatedIds, [], "ok=true ⇒ 无 not-evaluated");

  // neither (task left the todo pool) ⇒ not counted either way
  const gone = { ok: true, error: null, pool: 0, shouldApply: false, promotedIds: [], applied: [], promotePathLlmInvoked: false, fixDecisions: [] };
  const r3 = computeReverifyOutcome(["gap-z"], gone);
  assert.deepEqual(r3, { nowEligibleIds: [], stillIneligibleIds: [], notEvaluatedIds: [] }, "task vanished from the pool ⇒ neither");

  // ⛔ AC153：读不到输入（重跑闸 ok=false）⇒ 全部 notEvaluatedIds（不是 neither 静默丢弃，也不是
  // stillIneligible 误计入失败上限）。
  const unreadable = { ok: false, error: "ready-pool-check spawn failed", pool: null, shouldApply: false, promotedIds: [], applied: [], promotePathLlmInvoked: false, fixDecisions: [] };
  const r4 = computeReverifyOutcome(["gap-a", "gap-b"], unreadable);
  assert.deepEqual(r4.notEvaluatedIds, ["gap-a", "gap-b"], "重跑闸读不到 ⇒ notEvaluatedIds（⛔ 不是 neither/不是 stillIneligible）");
  assert.deepEqual(r4.nowEligibleIds, [], "读不到 ⇒ ⛔ 不晋升");
  assert.deepEqual(r4.stillIneligibleIds, [], "读不到 ⇒ ⛔ 不计失败上限");
});


test("advanceRetryCap — 连续失败达 N 次 ⇒ newlyNeedsHuman；去重不重复返回（纯函数）", () => {
  const state = { counts: new Map(), needsHuman: new Set() };
  assert.deepEqual(advanceRetryCap(state, ["gap-a"], 2), [], "1st failure < N ⇒ not yet needs-human");
  assert.deepEqual(advanceRetryCap(state, ["gap-a"], 2), ["gap-a"], "2nd failure ≥ N ⇒ needs-human");
  assert.deepEqual(advanceRetryCap(state, ["gap-a"], 2), [], "already marked ⇒ no duplicate");
  assert.equal(state.counts.get("gap-a"), 3, "count keeps accumulating (3 attempts)");
  assert.ok(state.needsHuman.has("gap-a"), "needsHuman set records the id");
});


test("markNeedsHuman — status todo→needs-human + ## Needs-Human 审计记录；非 todo 拒写（fail-closed）", (t) => {
  const root = makeRoot("mark-nh");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  writeTask(root, "gap-nh", "todo");

  const ok = markNeedsHuman(root, "gap-nh", "test reason");
  assert.equal(ok.ok, true, "todo task marked needs-human");
  assert.equal(readStatus(root, "gap-nh"), "needs-human", "status flipped todo → needs-human");
  const body = fs.readFileSync(path.join(root, "tasks", "gap-nh.md"), "utf8");
  assert.ok(body.includes("## Needs-Human"), "grep-able ## Needs-Human audit record written");
  assert.ok(body.includes("test reason"), "the reason is recorded in the body");

  // fail-closed on a non-todo task (needs-human is not todo) ⇒ no double-mark
  const again = markNeedsHuman(root, "gap-nh", "again");
  assert.equal(again.ok, false, "needs-human task is not todo ⇒ refused");
  assert.equal(again.reason, "not-todo");
  assert.equal(readStatus(root, "gap-nh"), "needs-human", "status unchanged on refusal");

  // fail-closed on a missing task
  const missing = markNeedsHuman(root, "gap-ghost", "x");
  assert.equal(missing.ok, false);
  assert.equal(missing.reason, "missing");
});


test("AC133 AC2 — worker 声称修好（exit 0）但实际未改 ⇒ 驱动仍判不合格、⛔ 不得晋升（能取假）", (t) => {
  const root = makeRoot("ac133-ac2");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  writeDodShortTask(root, "gap-ac133-dodshort");

  // fix worker = `node -e process.exit(0)` — exits 0 (claims success) but changes NOTHING.
  runDriver(root, [
    "--ready-pool-cmd", realReadyPoolCmd(root),
    "--fix-worker-cmd", "node -e process.exit(0)",
    "--resource-gate-cmd", "node -e process.exit(0)",
    "--cap", "5", "--once",
  ]);

  const records = readRoundLines(root);
  assert.equal(records.length, 1, "exactly one round record");
  const rec = records[0];

  // AC1: the driver RE-RAN the gate after the worker exited (reverify is present, not null).
  assert.ok(rec.reverify, "AC1: driver re-ran the gate after fix worker exit (reverify present)");
  assert.deepEqual(rec.reverify.stillIneligibleIds, ["gap-ac133-dodshort"],
    `AC2: the gate still judges it ineligible — worker's "success" was NOT trusted (reverify=${JSON.stringify(rec.reverify)})`);
  assert.deepEqual(rec.reverify.nowEligibleIds, [], "nothing promoted on the worker's empty claim");

  // AC2 falsifiable: the task is NOT promoted (status stays todo).
  assert.equal(readStatus(root, "gap-ac133-dodshort"), "todo", "AC2: worker claimed fixed but didn't ⇒ NOT promoted");

  // The fix outcome recorded a spawned worker (exit 0) but no promote outcome for this id.
  const outcomes = readOutcomeLines(root);
  assert.ok(outcomes.some((o) => o.task_id === "gap-ac133-dodshort" && o.action === "fix"), "a fix outcome was written");
  assert.ok(!outcomes.some((o) => o.task_id === "gap-ac133-dodshort" && o.action === "promote"), "⛔ no promote outcome for the unfixed task");
});


test("AC133 AC3 — 连续修 N 次仍不合格 ⇒ 标 needs-human 并停止修复循环（能取假）", (t) => {
  const root = makeRoot("ac133-ac3");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  writeDodShortTask(root, "gap-ac133-capped");

  const counter = path.join(root, "fix.cnt");
  // max-fix-retries 2: round 1 spawn(1) → round 2 spawn(2) ≥ N ⇒ needs-human → rounds 3-4 no spawn.
  runDriver(root, [
    "--ready-pool-cmd", realReadyPoolCmd(root),
    "--fix-worker-cmd", fixWorkerNoopCounter(counter),
    "--resource-gate-cmd", "node -e process.exit(0)",
    "--cap", "5", "--max-fix-retries", "2", "--max-rounds", "4", "--interval", "5",
  ]);

  // AC3 falsifiable: the driver stopped after N (2) fix attempts, not 4.
  assert.equal(Number(fs.readFileSync(counter, "utf8")), 2,
    "AC3: fix worker spawned exactly N=2 times, then the loop stopped spawning (⛔ 无限重修)");

  // The task was marked needs-human on disk (status flip + audit record).
  assert.equal(readStatus(root, "gap-ac133-capped"), "needs-human", "AC3: task marked needs-human after N failed fixes");
  const body = fs.readFileSync(path.join(root, "tasks", "gap-ac133-capped.md"), "utf8");
  assert.ok(body.includes("## Needs-Human"), "AC3: ## Needs-Human audit record written");

  // The round that hit the cap recorded the needs-human decision.
  const records = readRoundLines(root);
  const capRound = records.find((r) => r.needs_human && r.needs_human.includes("gap-ac133-capped"));
  assert.ok(capRound, "the needs-human decision is recorded in the round ledger");

  // An outcome record with action=needs-human is written (outer-consumable).
  const outcomes = readOutcomeLines(root);
  assert.ok(outcomes.some((o) => o.task_id === "gap-ac133-capped" && o.action === "needs-human"),
    "a needs-human outcome record is written for the capped task");
});
