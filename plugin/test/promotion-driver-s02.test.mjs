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

// SPLIT from promotion-driver.test.mjs by gap-suite-split-15-over-30s-test-files — shard 2/8 (6 tests). Shared fixtures: ./helpers/promotion-driver-harness.mjs (single source).

import { test } from "node:test";
import { ROUND_LOG_REL, appendRoundRecord, assert, computeRoundRecord, counterNodeE, fs, makeRoot, path, prosePrereqGapReading, readRoundLines, runDriver } from "./helpers/promotion-driver-harness.mjs";

test("Plan 4 — prose_prereq_gap is a NAMED round-level reading, not only a nested fixes[].unfixable string", () => {
  const base = { round: 1, runId: "pm-1", pid: 42, at: "2026-09-11T00:00:00.000Z", pool: 1, shouldApply: true, applied: [], promotePathLlmInvoked: false };
  // A round whose one ineligible candidate is prose-prereq-blocked: the task id + the refs must be
  // readable from the round record directly (pre-Plan-4 they existed only inside
  // fixes[].unfixable as the string "prosePrereqGap=[…]").
  const fixes = [
    { id: "gap-stuck", spawned: false, missing: [], unfixable: ["prosePrereqGap=[gap-a,gap-b]"], exitCode: null },
    { id: "gap-other", spawned: false, missing: [], unfixable: ["depsReady=false"], exitCode: null },
  ];
  const rec = computeRoundRecord({ ...base, promotedIds: [], error: null, fixes });
  assert.deepEqual(rec.prose_prereq_gap, [{ id: "gap-stuck", refs: ["gap-a", "gap-b"] }], "names the task AND the refs");
  assert.deepEqual(computeRoundRecord({ ...base, promotedIds: [], error: null, fixes: [] }).prose_prereq_gap, [], "no prose-prereq block ⇒ empty, never absent");
  // Unit: the two miss-forms must not invent an entry.
  assert.deepEqual(prosePrereqGapReading([{ id: "gap-ok", unfixable: [] }]), [], "an unfixable-free candidate contributes nothing");
  assert.deepEqual(prosePrereqGapReading([{ id: "gap-no-unfixable" }]), [], "a missing unfixable field contributes nothing (缺值 = 未查, never a fabricated ref)");
});


test("appendRoundRecord — pure append, never truncates (two lines survive)", (t) => {
  const root = makeRoot("append");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const file = path.join(root, ROUND_LOG_REL);
  const rec = (r) => computeRoundRecord({ round: r, runId: "pm-1", pid: 1, at: "t", pool: 0, shouldApply: false, promotedIds: [], applied: [], error: null, promotePathLlmInvoked: false, fixes: [] });
  appendRoundRecord(file, rec(1));
  appendRoundRecord(file, rec(2));
  assert.equal(readRoundLines(root).length, 2, "two appended lines");
});

// ── AC1: resident loop (does not exit after one round; enters next round after interval) ────────────


test("AC1 — resident loop runs N rounds without exiting (--max-rounds bounds it; interval between rounds)", (t) => {
  const root = makeRoot("ac1");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const counter = path.join(root, "rpc.cnt");
  const out = runDriver(root, [
    "--ready-pool-cmd", counterNodeE(counter, "JSON.stringify({pool:1,should_apply:false,promotions:[],applied_promotions:[]})"),
    "--interval", "5",
    "--max-rounds", "3",
    "--json",
  ]);
  const events = out.trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
  const rounds = events.filter((e) => e.event === "round");
  assert.equal(rounds.length, 3, "AC1: three rounds emitted — the loop kept going after the first, never exited");
  assert.deepEqual(rounds.map((r) => r.round), [1, 2, 3]);
  assert.equal(Number(fs.readFileSync(counter, "utf8")), 3, "ready-pool-check invoked exactly 3 times (one full-pool call per round)");
  const records = readRoundLines(root);
  assert.equal(records.length, 3, "one round record per round");
  assert.deepEqual(records.map((r) => r.action), ["none", "none", "none"]);
});


test("AC1 — --once runs exactly one round then exits (single-shot seam)", (t) => {
  const root = makeRoot("once");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const out = runDriver(root, [
    "--ready-pool-cmd", "node -e console.log(JSON.stringify({pool:0,should_apply:false,promotions:[],applied_promotions:[]}))",
    "--once", "--json",
  ]);
  const events = out.trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
  assert.equal(events.filter((e) => e.event === "round").length, 1, "--once runs one round");
});

// ── liveness 接线（gap-resident-driver-stable-carrier-liveness Finding：liveness 子命令零调用者）──
// AC2 承诺「driver/supervisor 死时有机件在窗口内检测并报告」，但此前没有任何东西调 liveness 子命令
// （log 13h 无更新）。修法 = driver 自身 round 循环每轮顺手调一次（promotion 侧接线）。本组验证：
// ①resident loop 每轮真调 liveness（counter 缝）、②检出的死亡进 round record（⛔ 不静默丢）。


test("liveness wiring — resident loop calls the liveness checker each round + round record carries it", (t) => {
  const root = makeRoot("liveness-wire");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const livenessCnt = path.join(root, "liveness.cnt");
  runDriver(root, [
    "--ready-pool-cmd", counterNodeE(path.join(root, "rpc.cnt"), "JSON.stringify({pool:0,should_apply:false,promotions:[],applied_promotions:[]})"),
    "--liveness-cmd", counterNodeE(livenessCnt, "JSON.stringify({kind:'promotion',deaths:'none',running:true})"),
    "--interval", "5",
    "--max-rounds", "3",
    "--json",
  ]);
  assert.equal(Number(fs.readFileSync(livenessCnt, "utf8")), 3, "liveness checked once per round (3 rounds)");
  const records = readRoundLines(root);
  assert.equal(records.length, 3, "three round records");
  for (const rec of records) {
    assert.equal(rec.liveness.checked, true, `round carries liveness.checked=true: ${JSON.stringify(rec.liveness)}`);
    assert.equal(rec.liveness.deaths, null, "healthy check ⇒ deaths=null");
    assert.equal(rec.liveness.running, true);
  }
});


test("liveness death surfacing — a death reported by the checker is carried into the round record (⛔ not dropped)", (t) => {
  const root = makeRoot("liveness-death");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  runDriver(root, [
    "--ready-pool-cmd", "node -e console.log(JSON.stringify({pool:0,should_apply:false,promotions:[],applied_promotions:[]}))",
    "--liveness-cmd", "node -e console.log(JSON.stringify({kind:'promotion',deaths:'supervisor_dead,driver_orphaned',running:false}))",
    "--once", "--json",
  ]);
  const records = readRoundLines(root);
  assert.equal(records.length, 1, "one round");
  const liveness = records[0].liveness;
  assert.equal(liveness.checked, true);
  assert.match(liveness.deaths, /supervisor_dead/, `supervisor_dead surfaced: ${liveness.deaths}`);
  assert.match(liveness.deaths, /driver_orphaned/, "orphan driver explicitly named");
  assert.equal(liveness.running, false, "running=false — the orphan driver is NOT misjudged as in-service");
});

// ── AC2 (falsifiable): stop the driver ⇒ a newly-eligible todo is NOT promoted ─────────────────────
