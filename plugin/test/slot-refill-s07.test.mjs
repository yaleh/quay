// @test-group engine
// slot-refill.test.mjs — the event-driven dispatch ("slot-refill") decision helper
// (tasks/gap-dispatch-evaluated-only-at-inner-tick-boundary-not-slot-release). Dispatch was
// evaluated ONLY at the inner loop's tick boundary; a completed subagent's freed slot was not
// backfilled until the next tick (measured 39/30/18/33/50-min gaps with a healthy pool). This test
// pins the PRODUCT mechanism for the event-driven path: computing "is a slot free + is there a
// dispatchable candidate" at a COMPLETION event.
//
// AC1 slots_free = max(0, cap − in_flight) — the caller passes the running set explicitly (AC6:
//   telemetry brackets ≠ subagents, never read from telemetry) · AC2 should_refill is the
//   event-driven go/no-go, based on the recommended set (step-4 checks applied) · AC3 recommended is
//   capped at slots_free and production-disjoint (assembleBatch) · AC4 negative control: no
//   dispatchable candidate ⇒ should_refill=false; the helper never writes/dispatches (pure) ·
//   AC5 cap semantics: in-flight ≥ cap ⇒ should_refill=false; cap is an input, never hardcoded ·
//   AC7 idempotent: same inputs ⇒ identical output · AC8 node:test + @test-group lowconc
// B9 FORCE-DISPATCH (tasks/gap-outer-tick-core-b9-coverage-blind-spot): the outer tick-core B9 branch
//   consumes should_refill + recommended as the two independently-readable preconditions of
//   "空槽强制派发" — should_refill=true AND recommended non-empty ⇒ the tick MUST dispatch 1-2, even when
//   the dispatch QUEUE is non-empty (the old "queue empty ⇒ refill" trigger was the blind spot). The
//   tests below pin the PROBE side: the exact blind-spot shape (non-empty queue + in_flight=0 + a
//   dispatchable recommendation) must be reported as should_refill=true with a non-empty `recommended`
//   the tick can take 1-2 from; a non-empty queue whose candidates ALL fail step-4 ⇒ recommended empty
//   ⇒ should_refill=false (无此场景不误报).
//
// Run: scripts/test.sh plugin/test/slot-refill.test.mjs

// SPLIT from slot-refill.test.mjs by gap-suite-split-15-over-30s-test-files — shard 7/20 (5 tests). Shared fixtures: ./helpers/slot-refill-harness.mjs (single source).

import { test } from "node:test";
import { __dirname, analyzeSlotRefill, assert, dispatchableBody, execFileSync, fs, inFlightTask, makeWorkspace, path, resolveInFlightId, writeTask } from "./helpers/slot-refill-harness.mjs";

test("CLI smoke: --root/--cap/--in-flight-count produces JSON with the refill fields (exit 0)", (t) => {
  const root = makeWorkspace("cli");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  writeTask(root, "gap-a", { status: "ready", labels: ["gap"], body: dispatchableBody(["- code/a.ts (new)"]) });
  writeTask(root, "gap-b", { status: "ready", labels: ["gap"], body: dispatchableBody(["- code/b.ts (new)"]) });
  const script = path.resolve(__dirname, "..", "scripts", "slot-refill.ts");
  // AC115: the CLI in-flight is now the worker driver's DIRECT child-process count (--in-flight-count),
  // not a telemetry-measured view. --in-flight-count 0 ⇒ driver-count provenance + slots_free = cap.
  const out = execFileSync(
    process.execPath,
    ["--experimental-strip-types", script, "--root", root, "--cap", "3", "--in-flight-count", "0"],
    { encoding: "utf8" },
  );
  const parsed = JSON.parse(out);
  assert.equal(typeof parsed.slots_free, "number");
  assert.equal(typeof parsed.should_refill, "boolean");
  assert.equal(typeof parsed.dispatchable_disjoint, "number");
  assert.equal(parsed.measurement_source, "driver-count", "the in-flight count is the driver's direct child count");
  assert.equal(parsed.slots_free, 3);
  assert.equal(parsed.should_refill, true);
  assert.ok(Array.isArray(parsed.recommended));
  assert.equal(parsed.recommended.length, 2);
});

// ── RESOLVE-BY-TASK-ID (tasks/gap-in-flight-resolve-by-task-id-not-worktree-name) ──────────────────
// AC1 判据1: the resolver matches BY TASK ID — worktree dir name / branch name / task id all normalize
// to the TRUE task id, so a truncated worktree slug (the `<slug>` convention's agent-chosen abbreviation)
// still resolves. (AC115: the `--in-flight` CLI flag is retired — this is now a PURE library helper the
// AC53 gate's analyzeSlotRefill consumer uses; the three forms MUST agree on the resolved id.)
// AC2 判据2 (real sample, 能取假): gap-workflows-dual-copy-drift (truncated dir — true id
// `…-unchecked`) previously under-counted the in-flight set (readTasks silently skipped the missing
// `tasks/<slug>.md`); after the fix the truncated name resolves to the true id and the count is not
// biased. AC3 判据3: the AC53 gate is NOT changed — only the quantity fed to it (the in-flight set).


test("resolveInFlightId — exact id / branch form / truncated dir all resolve to the true task id (判据1)", (t) => {
  const root = makeWorkspace("resolve");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const tasksDir = path.join(root, "tasks");
  // The real 2026-08-14 sample pair: the worktree slug is a TRUNCATED prefix of the true task id.
  writeTask(root, "gap-workflows-dual-copy-drift-unchecked", {
    status: "ready", labels: ["gap"], body: dispatchableBody(["- code/wcd.ts (new)"]),
  });
  // A prefix-collision guard: an id whose prefix is ALSO a distinct exact task — the exact task must
  // win (never re-resolve an exact id to a longer prefix-match sibling).
  writeTask(root, "gap-prefix", { status: "ready", labels: ["gap"], body: dispatchableBody(["- code/p.ts (new)"]) });
  writeTask(root, "gap-prefix-extended", { status: "ready", labels: ["gap"], body: dispatchableBody(["- code/pe.ts (new)"]) });

  // 1. exact task id → exact, unchanged.
  assert.deepEqual(resolveInFlightId(tasksDir, "gap-workflows-dual-copy-drift-unchecked"),
    { id: "gap-workflows-dual-copy-drift-unchecked", method: "exact" });
  // 2. branch form `task/<id>` → strip the prefix, exact.
  assert.deepEqual(resolveInFlightId(tasksDir, "task/gap-workflows-dual-copy-drift-unchecked"),
    { id: "gap-workflows-dual-copy-drift-unchecked", method: "exact" });
  // 3. TRUNCATED worktree dir name → truncated-prefix resolves to the TRUE id (the real sample).
  assert.deepEqual(resolveInFlightId(tasksDir, "gap-workflows-dual-copy-drift"),
    { id: "gap-workflows-dual-copy-drift-unchecked", method: "truncated-prefix" });
  // 4. TRUNCATED branch name → strip `task/`, then truncated-prefix.
  assert.deepEqual(resolveInFlightId(tasksDir, "task/gap-workflows-dual-copy-drift"),
    { id: "gap-workflows-dual-copy-drift-unchecked", method: "truncated-prefix" });
  // 5. an exact id whose longer sibling also shares the prefix → exact wins, NEVER re-resolved.
  assert.deepEqual(resolveInFlightId(tasksDir, "gap-prefix"), { id: "gap-prefix", method: "exact" });
  // 6. unresolved (no task matches) → input unchanged, method "unresolved".
  assert.deepEqual(resolveInFlightId(tasksDir, "gap-no-such-task"), { id: "gap-no-such-task", method: "unresolved" });
});


test("resolveInFlightId — ambiguous prefix (2+ tasks extend it) ⇒ unresolved, never guesses", (t) => {
  const root = makeWorkspace("resolve-amb");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const tasksDir = path.join(root, "tasks");
  writeTask(root, "gap-amb-one", { status: "ready", labels: ["gap"], body: dispatchableBody(["- code/1.ts (new)"]) });
  writeTask(root, "gap-amb-two", { status: "ready", labels: ["gap"], body: dispatchableBody(["- code/2.ts (new)"]) });
  // `gap-amb` is a strict prefix of BOTH — ambiguous ⇒ unresolved (a wrong id would poison the
  // touches-disjointness set worse than a missing id).
  assert.deepEqual(resolveInFlightId(tasksDir, "gap-amb"), { id: "gap-amb", method: "unresolved" });
});

// (AC115 retirement: the `--in-flight` CLI flag is retired — in-flight is now the worker driver's
// DIRECT child-process count (--in-flight-count). The pure resolveInFlightId resolver above stays as a
// library helper for the AC53 gate's consumer, which passes the in-flight set via analyzeSlotRefill.)

// ── AC5 DUAL-CONSUMER SPLIT (tasks/gap-in-flight-resolve-by-task-id-not-worktree-name, 人 12:5xZ) ──
// 消费者 A · 触碰面不相交（dispatchable_disjoint / checkTouchesPair）⇒ 宽集 = 所有未落地任务（含
//   awaiting retry——worktree 还在，新任务碰同文件会撞）。
// 消费者 B · 槽位计数（slots_free / should_refill）⇒ 窄集 = 当前在跑的任务 subagent 数（cap=5 保护
//   subagent；awaiting retry 无 subagent ⇒ 不占 cap）。
// ⊢ 判据: 同一时刻两分母【允许不等】；若实现仍取同一集合 ⇒ 未落地。


test("AC5 — runningSubagentCount splits Consumer B (slots) from Consumer A (touches): two denominators may differ (判据 ⊢)", (t) => {
  const root = makeWorkspace("ac5-split");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const tasksDir = path.join(root, "tasks");
  // 5 WIDE un-landed tasks (the real 2026-08-14 in-flight set).
  const wide = [
    "gap-ac63-judgment2-no-carrier",
    "gap-fan-in-flip-no-ac-completion-check",
    "gap-in-flight-resolve-by-task-id",
    "gap-test-isolation-backlog-44-violations-unmeasured",
    "gap-workflows-dual-copy-drift-unchecked",
  ];
  for (const id of wide) writeTask(root, id, { status: "ready", labels: ["gap"], body: dispatchableBody([`- code/${id}.ts (new)`]) });
  const inFlight = wide.map((id) => inFlightTask(id, [`- code/${id}.ts (new)`]));
  const base = { tasksDir, root, cap: 5 };

  // Consumer B narrow: only 3 of the 5 are ACTUALLY-RUNNING subagents (ac63 + in-flight-resolve impl
  // + workflows-dual-copy — the 2026-08-14 empirical split: 5 worktrees, 3 live subagents).
  const narrow = analyzeSlotRefill({ ...base, inFlight, runningSubagentCount: 3 });
  assert.equal(narrow.in_flight_count, 5, "Consumer A denominator stays WIDE (all un-landed tasks)");
  assert.equal(narrow.running_subagent_count, 3, "Consumer B denominator is the NARROW running-subagent count");
  assert.equal(narrow.slot_denominator_source, "running-subagents");
  assert.equal(narrow.slots_free, 2, "true slots_free = cap 5 − 3 running subagents = 2");

  // Backward compat: no runningSubagentCount ⇒ Consumer B falls back to the wide set.
  const fallback = analyzeSlotRefill({ ...base, inFlight });
  assert.equal(fallback.running_subagent_count, 5, "fallback Consumer B = wide set");
  assert.equal(fallback.slot_denominator_source, "in-flight-fallback");
  assert.equal(fallback.slots_free, 0, "fallback slots_free = cap 5 − 5 wide = 0 (the old shared-denominator shape)");

  // ⊢ 判据: the two denominators are allowed to differ — 5 (wide, Consumer A) vs 3 (narrow, Consumer B).
  assert.notEqual(narrow.in_flight_count, narrow.running_subagent_count,
    "判据: dispatchable_disjoint 分母 (5) 与 slots_free 分母 (3) 允许不等");
  assert.equal(narrow.dispatchable_disjoint, fallback.dispatchable_disjoint,
    "Consumer A (dispatchable_disjoint) is UNCHANGED by the Consumer-B split");
});


test("AC5/AC115 — CLI --in-flight-count: the driver's DIRECT child count feeds Consumer B (slots) via driver-count provenance", (t) => {
  const root = makeWorkspace("ac5-cli");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const ids = [
    "gap-ac63-judgment2-no-carrier",
    "gap-fan-in-flip-no-ac-completion-check",
    "gap-in-flight-resolve-by-task-id",
    "gap-test-isolation-backlog-44-violations-unmeasured",
    "gap-workflows-dual-copy-drift-unchecked",
  ];
  for (const id of ids) writeTask(root, id, { status: "ready", labels: ["gap"], body: dispatchableBody([`- code/${id}.ts (new)`]) });
  const script = path.resolve(__dirname, "..", "scripts", "slot-refill.ts");
  const run = (args) => JSON.parse(execFileSync(
    process.execPath,
    ["--no-warnings", "--experimental-strip-types", script, "--root", root, "--cap", "5", "--json", ...args],
    { encoding: "utf8" },
  ));

  // AC115: in-flight = 驱动子进程数（直接量）——the driver passes its own child count as a NUMBER.
  // 3 running workers ⇒ Consumer B = 3 ⇒ slots_free = 5 − 3 = 2.
  const withCount = run(["--in-flight-count", "3"]);
  assert.equal(withCount.measurement_source, "driver-count", "the in-flight count is the driver's direct child count");
  assert.equal(withCount.running_subagent_count, 3, "Consumer B denominator = the direct count");
  assert.equal(withCount.slots_free, 2, "true slots_free = 5 − 3 = 2");

  // Zero is a MEASURED zero (not "absent"): --in-flight-count 0 ⇒ 5 free slots.
  const zeroCount = run(["--in-flight-count", "0"]);
  assert.equal(zeroCount.slots_free, 5, "0 is a measured zero ⇒ all 5 slots free");
  assert.equal(zeroCount.measurement_source, "driver-count");
});
