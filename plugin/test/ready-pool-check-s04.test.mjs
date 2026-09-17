// @test-group engine
// ready-pool-check.test.mjs — the ready-pool maintenance mechanism
// (tasks/gap-promotion-cadence-is-role-volition-not-product-mechanism). Promotion cadence used to
// live in an outer's VOLUNTARY AC-queue (role volition, lost on session/model change); this test
// pins the PRODUCT mechanism: computing the REAL ready pool (excluding not-yet-flipped / fixture /
// PARKED), reporting dispatchable_disjoint (the largest mutually-disjoint pool subset via
// checkTouchesPair) as the CRITERION, and recommending todo→ready promotions in a DEFINED order
// (touch-disjointness FIRST vs the pool + in-flight, then gap-* > DIR-*, then touches-resolve
// first) when pool < floor (= cap × 4, default 20 — dispatch single source).
//
// AC1 floor = cap × 4 (20 at cap 5, configurable) · AC2 dispatchable_disjoint via checkTouchesPair
// AC3 pool-big-but-all-colliding self-report + no-false-report-on-criterion-met · AC4 disjointness
//   ranks before kind, incl. in-flight · AC5 touchesResolve guard kept · AC6 cost asymmetry doc
// AC7 real use · AC8 node:test + @test-group engine
//
// Run: scripts/test.sh plugin/test/ready-pool-check.test.mjs

// SPLIT from ready-pool-check.test.mjs by gap-suite-split-15-over-30s-test-files — shard 4/13 (14 tests). Shared fixtures: ./helpers/ready-pool-check-harness.mjs (single source).

import { test } from "node:test";
import { BLOCKING_WEIGHT, STRATEGIC_REF_RE, STRATEGIC_WEIGHT, __dirname, analyzeTasks, assert, computeRelevance, dirTask, execFileSync, fourArtifactBody, fs, gapTask, makeWorkspace, parseTask, path, priorityLevel, readChildren, strategicTraceable, touchesScale, writeTask } from "./helpers/ready-pool-check-harness.mjs";

test("candidate order: touches-resolvable sorts before non-resolvable within a kind", (t) => {
  const root = makeWorkspace("order-resolve");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, "code", "exists.ts"), "export const real = 1;\n");
  writeTask(root, "gap-r1", { status: "ready", labels: ["gap"], body: fourArtifactBody() });
  writeTask(root, "gap-r2", { status: "ready", labels: ["gap"], body: fourArtifactBody() });
  writeTask(root, "gap-resolvable", gapTask("gap-resolvable", {
    body: fourArtifactBody({ touches: ["- code/exists.ts"] }),
  }));
  // AC1 (gap-ac46-pool-criteria-in-gate): gapTask injects the C8 self-touch, and the self-touch file
  // EXISTS (writeTask wrote it) — so a single missing real touch is no longer the majority. Two
  // missing real touches keep the candidate majority-missing even with the (existing) self-touch.
  writeTask(root, "gap-unresolvable", gapTask("gap-unresolvable", {
    body: fourArtifactBody({ touches: ["- code/missing.ts", "- code/also-missing.ts"] }),
  }));

  const r = analyzeTasks({ tasksDir: path.join(root, "tasks"), root, cap: 3, floorMult: 1 });
  const byId = Object.fromEntries(r.candidates.map((c) => [c.id, c]));
  assert.equal(byId["gap-resolvable"].touchesResolve, true);
  assert.equal(byId["gap-unresolvable"].touchesResolve, false);
  const idxResolvable = r.candidates.findIndex((c) => c.id === "gap-resolvable");
  const idxUnresolvable = r.candidates.findIndex((c) => c.id === "gap-unresolvable");
  assert.ok(idxResolvable < idxUnresolvable, "resolvable candidate must sort before non-resolvable");
});


test("promotion ranks touch-disjointness first (vs pool + in-flight), kind as secondary tiebreak (AC4)", (t) => {
  const root = makeWorkspace("rank");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const f of ["code/pool.ts", "code/other.ts", "code/other2.ts", "code/inflight.ts"]) {
    fs.writeFileSync(path.join(root, f), "export const x = 1;\n");
  }
  // Pool: 1 ready task touching code/pool.ts.
  writeTask(root, "gap-pool", { status: "ready", labels: ["gap"], body: fourArtifactBody({ touches: ["- code/pool.ts"] }) });
  // Candidates (all eligible; disjointScore vs pool(1) + in-flight(1)):
  writeTask(root, "gap-colliding", gapTask("gap-colliding", { body: fourArtifactBody({ touches: ["- code/pool.ts"] }) })); // collides pool → 1
  writeTask(root, "DIR-disjoint", dirTask("DIR-disjoint", { body: fourArtifactBody({ touches: ["- code/other.ts"] }) })); // disjoint both → 2
  writeTask(root, "gap-inf-disjoint", gapTask("gap-inf-disjoint", { body: fourArtifactBody({ touches: ["- code/other2.ts"] }) })); // disjoint both → 2
  writeTask(root, "ARCH-colliding-inf", { status: "todo", labels: [], body: fourArtifactBody({ touches: ["- code/inflight.ts"] }) }); // collides in-flight → 1

  const inFlight = [{ id: "gap-inflight", body: fourArtifactBody({ touches: ["- code/inflight.ts"] }) }];
  const r = analyzeTasks({ tasksDir: path.join(root, "tasks"), root, cap: 3, floorMult: 1, inFlight });
  assert.deepEqual(
    r.candidates.map((c) => c.id),
    ["gap-inf-disjoint", "DIR-disjoint", "gap-colliding", "ARCH-colliding-inf"],
    "disjointness score first (gap before dir within a score), then kind",
  );
  assert.equal(r.promotions[0].id, "gap-inf-disjoint", "most-disjoint candidate promoted first");
  // Disjointness beats kind: a disjoint DIR* ranks before a colliding gap*.
  const idxDir = r.candidates.findIndex((c) => c.id === "DIR-disjoint");
  const idxGap = r.candidates.findIndex((c) => c.id === "gap-colliding");
  assert.ok(idxDir < idxGap, "disjoint DIR candidate ranks before colliding gap candidate");
  // In-flight dimension: disjoint-from-in-flight ranks before colliding-with-in-flight.
  const idxInfD = r.candidates.findIndex((c) => c.id === "gap-inf-disjoint");
  const idxInfC = r.candidates.findIndex((c) => c.id === "ARCH-colliding-inf");
  assert.ok(idxInfD < idxInfC, "disjoint-from-in-flight ranks before colliding-with-in-flight");
});

// ── PRIORITY TIEBREAKER (gap-priority-has-no-mechanism-reader, AC1/AC3): the explicit `priority:*`
//    label (p1 > p2 > none) is read from the SAME frontmatter-labels source the dispatch sort reads
//    (parseTask/parseCandidate), and re-orders promotion candidates WITHIN an equal-disjointness
//    bucket — the "priority has a MECHANISM reader" fix (C17 closure). AC3: it NEVER overrides the
//    disjointness safety axis (a higher-disjoint no-priority candidate still ranks first).


test("priorityLevel maps p1/p2/none to ascending sort ranks (p1=1, p2=2, none=Infinity; unknown level fail-open)", () => {
  assert.equal(priorityLevel(["gap", "priority:p1"]), 1);
  assert.equal(priorityLevel(["gap", "priority:p2"]), 2);
  assert.equal(priorityLevel(["gap"]), Infinity, "no priority label ⇒ none (last)");
  assert.equal(priorityLevel(["gap", "priority:urgent"]), Infinity, "an unregistered level is fail-open (no rank)");
  assert.equal(priorityLevel([]), Infinity);
});


test("candidate order: priority tiebreaker p1 > p2 > none within equal disjointness (AC1)", (t) => {
  const root = makeWorkspace("order-priority");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const f of ["code/pool.ts", "code/other.ts", "code/other2.ts", "code/other3.ts"]) {
    fs.writeFileSync(path.join(root, f), "export const x = 1;\n");
  }
  // Pool: 1 ready task touching code/pool.ts; no in-flight ⇒ every disjoint candidate scores 1.
  writeTask(root, "gap-pool", { status: "ready", labels: ["gap"], body: fourArtifactBody({ touches: ["- code/pool.ts"] }) });
  writeTask(root, "gap-plain", gapTask("gap-plain", { body: fourArtifactBody({ touches: ["- code/other.ts"] }) }));
  writeTask(root, "gap-p2", gapTask("gap-p2", { labels: ["gap", "priority:p2"], body: fourArtifactBody({ touches: ["- code/other2.ts"] }) }));
  writeTask(root, "gap-p1", gapTask("gap-p1", { labels: ["gap", "priority:p1"], body: fourArtifactBody({ touches: ["- code/other3.ts"] }) }));

  const r = analyzeTasks({ tasksDir: path.join(root, "tasks"), root, cap: 3, floorMult: 1 });
  assert.deepEqual(r.candidates.map((c) => c.id), ["gap-p1", "gap-p2", "gap-plain"], "p1 before p2 before none at equal disjointness");
  const byId = Object.fromEntries(r.candidates.map((c) => [c.id, c]));
  assert.equal(byId["gap-p1"].priority, 1);
  assert.equal(byId["gap-p2"].priority, 2);
  assert.equal(byId["gap-plain"].priority, Infinity);
  // The pick loop follows the sort: the p1 candidate is promoted first, and the record exposes the rank.
  assert.equal(r.promotions[0].id, "gap-p1", "p1 candidate promoted first");
  assert.equal(r.promotions[0].priority, 1, "promotion record exposes the priority rank");
});


test("candidate order: priority never overrides the disjointness safety axis (AC3)", (t) => {
  const root = makeWorkspace("order-priority-safety");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const f of ["code/pool.ts", "code/inflight.ts", "code/other.ts"]) {
    fs.writeFileSync(path.join(root, f), "export const x = 1;\n");
  }
  // Pool: 1 ready task touching code/pool.ts; in-flight: 1 touching code/inflight.ts.
  // code/other.ts is disjoint from BOTH ⇒ disjointScore 2 (max). code/pool.ts collides the pool ⇒ 1.
  writeTask(root, "gap-pool", { status: "ready", labels: ["gap"], body: fourArtifactBody({ touches: ["- code/pool.ts"] }) });
  writeTask(root, "gap-no-priority-disjoint", gapTask("gap-no-priority-disjoint", { body: fourArtifactBody({ touches: ["- code/other.ts"] }) }));
  writeTask(root, "gap-p1-colliding", gapTask("gap-p1-colliding", { labels: ["gap", "priority:p1"], body: fourArtifactBody({ touches: ["- code/pool.ts"] }) }));

  const inFlight = [{ id: "gap-inflight", body: fourArtifactBody({ touches: ["- code/inflight.ts"] }) }];
  const r = analyzeTasks({ tasksDir: path.join(root, "tasks"), root, cap: 3, floorMult: 1, inFlight });
  assert.deepEqual(
    r.candidates.map((c) => c.id),
    ["gap-no-priority-disjoint", "gap-p1-colliding"],
    "disjointness ranks before priority — a p1 colliding candidate cannot jump a disjoint no-priority one",
  );
  assert.equal(r.promotions[0].id, "gap-no-priority-disjoint", "AC3: safety first — the disjoint no-priority candidate is promoted first");
});


test("candidate order: priority beats the gap>DIR kind tiebreak within equal disjointness (AC1)", (t) => {
  const root = makeWorkspace("order-priority-kind");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const f of ["code/pool.ts", "code/other.ts"]) {
    fs.writeFileSync(path.join(root, f), "export const x = 1;\n");
  }
  // Pool: 1 ready task touching code/pool.ts. Both candidates are disjoint from the pool (score 1);
  // the kind tiebreak (gap before DIR) is outranked by the explicit priority label.
  writeTask(root, "gap-pool", { status: "ready", labels: ["gap"], body: fourArtifactBody({ touches: ["- code/pool.ts"] }) });
  writeTask(root, "gap-plain", gapTask("gap-plain", { body: fourArtifactBody({ touches: ["- code/other.ts"] }) }));
  writeTask(root, "DIR-p1", dirTask("DIR-p1", { labels: ["milestone-candidate", "priority:p1"], body: fourArtifactBody({ touches: ["- code/other.ts"] }) }));

  const r = analyzeTasks({ tasksDir: path.join(root, "tasks"), root, cap: 3, floorMult: 1 });
  assert.deepEqual(r.candidates.map((c) => c.id), ["DIR-p1", "gap-plain"], "within equal disjointness, priority:p1 beats the gap>DIR kind tiebreak");
});

// ── REVERSE DIRECTION (gap-closed-bracket-leaves-live-agent-consuming-slots): closed-but-live agents
//    rank in the in-flight disjointness set — a new dispatch must not collide with their touches even
//    though their telemetry bracket already closed (bracket-close ≠ agent-exit) ─────────────────────


test("AC4 reverse — closedButLive agents rank in the in-flight disjointness set", (t) => {
  const root = makeWorkspace("cbl-rank");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const f of ["code/pool.ts", "code/other.ts", "code/ghost.ts"]) {
    fs.writeFileSync(path.join(root, f), "export const x = 1;\n");
  }
  // Pool: 1 ready task touching code/pool.ts.
  writeTask(root, "gap-pool", { status: "ready", labels: ["gap"], body: fourArtifactBody({ touches: ["- code/pool.ts"] }) });
  // Candidates (all eligible; disjointScore vs pool(1) + closed-but-live(1)):
  writeTask(root, "gap-ghost-colliding", gapTask("gap-ghost-colliding", { body: fourArtifactBody({ touches: ["- code/ghost.ts"] }) })); // collides closed-but-live → 1
  writeTask(root, "gap-free", gapTask("gap-free", { body: fourArtifactBody({ touches: ["- code/other.ts"] }) })); // disjoint both → 2

  const closedButLive = [{ id: "gap-ghost", body: fourArtifactBody({ touches: ["- code/ghost.ts"] }) }];
  const r = analyzeTasks({ tasksDir: path.join(root, "tasks"), root, cap: 3, floorMult: 1, closedButLive });
  assert.equal(r.closed_but_live[0], "gap-ghost", "the closed-but-live set is surfaced in the output");
  assert.ok(r.candidates.find((c) => c.id === "gap-free"), "gap-free candidate present");
  assert.ok(r.candidates.find((c) => c.id === "gap-ghost-colliding"), "ghost-colliding candidate present");
  const idxFree = r.candidates.findIndex((c) => c.id === "gap-free");
  const idxGhost = r.candidates.findIndex((c) => c.id === "gap-ghost-colliding");
  assert.ok(idxFree < idxGhost, "disjoint-from-closed-but-live ranks before colliding-with-closed-but-live");
  // The closed-but-live id is excluded from ready_relevance (it is NOT dispatchable room).
  const readyRel = r.ready_relevance.map((x) => x.id);
  assert.ok(!readyRel.includes("gap-ghost"), "closed-but-live id excluded from ready relevance");
});

// ── AC4/AC5: hard-cap floor constant is what the ticks use ────────────────────────────────────────


test("analyzeTasks derives floor from cap × floorMult (configurable, single source)", (t) => {
  const root = makeWorkspace("floor-derive");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  writeTask(root, "gap-r1", { status: "ready", labels: ["gap"], body: fourArtifactBody() });
  // cap 5 × floorMult 2 ⇒ floor 10; pool 1 ⇒ deficit 9.
  const r = analyzeTasks({ tasksDir: path.join(root, "tasks"), root, cap: 5, floorMult: 2 });
  assert.equal(r.cap, 5);
  assert.equal(r.floorMult, 2);
  assert.equal(r.floor, 10);
  assert.equal(r.deficit, 9);
});

// ── gap-value-prioritization-has-no-mechanism: relevance signal + priority query (AC1/AC2/AC3/AC6) ──
// The manager layer's prioritization function: each candidate carries a MECHANICAL relevance signal
// (strategicTrace = body grep for FINDING-*/RESEARCH-*/GOAL-*/REVIEW-cadence; unblocks = non-done
// tasks with this candidate as their `parent`; costTouches = declared `## Touches` parsed scale) and
// `--top N` emits `top_relevance` — the N highest-value current todos with a reason each. AC4: the
// existing promotion sort (disjointness first, gap>DIR) is untouched.


test("CLI smoke: --root produces JSON with pool/dispatchable_disjoint/floor (exit 0)", (t) => {
  const root = makeWorkspace("cli");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  writeTask(root, "gap-a", { status: "ready", labels: ["gap"], body: fourArtifactBody() });
  const script = path.resolve(__dirname, "..", "scripts", "ready-pool-check.ts");
  const out = execFileSync(
    process.execPath,
    ["--experimental-strip-types", script, "--root", root],
    { encoding: "utf8" },
  );
  const parsed = JSON.parse(out);
  assert.equal(typeof parsed.pool, "number");
  assert.equal(parsed.pool, 1);
  assert.equal(parsed.floor, 20, "default floor = cap×4 = 20 (dispatch single source)");
  assert.equal(typeof parsed.dispatchable_disjoint, "number");
  assert.equal(typeof parsed.criterion_met, "boolean");
  assert.equal(typeof parsed.scanned, "number");
});

// ── Value-prioritization relevance signal (gap-value-prioritization-has-no-mechanism) ──────────────
// AC1: per-candidate relevance signal (strategic traceability grep + parent/children blocking +
// touches-scale cost) output to JSON. AC3: all sources mechanical (no human scoring). AC2/AC6: the
// --top query emits the highest-value N todos with reasons, and ready_relevance ranks the ready pool
// by the same signal (the "who to dispatch next" answer). AC4: the existing promotion order is
// untouched (regression assertion).


test("computeRelevance: strategic grep, blocking, cost scale, composite value (AC1/AC3)", () => {
  const childrenByTask = new Map([["gap-parent", ["gap-child-a", "gap-child-b"]]]);
  const parentRefCount = new Map([["gap-blocked-by", 1]]);

  // strategic (3) + cost 1 benefit (1) = 4 — outranks everything.
  const strategic = computeRelevance(
    "gap-strategic",
    { body: "references SYNTHESIS-four-gaps-2026-08-05.md\n## Touches\n- code/a.ts" },
    childrenByTask,
    parentRefCount,
  );
  assert.equal(strategic.strategic, true, "SYNTHESIS- reference ⇒ strategic traceable");
  assert.equal(strategic.blocking, false);
  assert.equal(strategic.cost, 1);
  assert.equal(strategic.value, STRATEGIC_WEIGHT + 1);
  assert.match(strategic.reason, /strategic Y/);

  // blocking via children (2) + cost 1 benefit (1) = 3.
  const blocker = computeRelevance("gap-parent", { body: "plain\n## Touches\n- code/a.ts" }, childrenByTask, parentRefCount);
  assert.equal(blocker.strategic, false);
  assert.equal(blocker.blocking, true);
  assert.equal(blocker.value, BLOCKING_WEIGHT + 1);
  assert.match(blocker.reason, /blocking Y\(2 children\)/);

  // blocking via being named as parent by another task.
  const blockedBy = computeRelevance("gap-blocked-by", { body: "plain\n## Touches\n- code/a.ts" }, childrenByTask, parentRefCount);
  assert.equal(blockedBy.blocking, true, "referenced as parent by another task ⇒ blocking");

  // low value: no strategic, no blocking, 4 touches → cost benefit 0.25.
  const costly = computeRelevance(
    "gap-costly",
    { body: "plain\n## Touches\n- code/a.ts\n- code/b.ts\n- code/c.ts\n- code/d.ts" },
    childrenByTask,
    parentRefCount,
  );
  assert.equal(costly.value, 0.25);
  assert.match(costly.reason, /cost 4 touches/);

  // Composite ordering: strategic > blocking > cheap-plain > costly.
  assert.ok(strategic.value > blocker.value, "strategic outranks blocking");
  assert.ok(blocker.value > costly.value, "blocking outranks plain-costly");
});


test("readChildren / strategicTraceable / touchesScale mechanical sources (AC3)", () => {
  assert.deepEqual(readChildren("---\nchildren:\n  - a\n  - b\n---\nbody"), ["a", "b"]);
  assert.deepEqual(readChildren("---\nchildren: [x, y]\n---\nbody"), ["x", "y"]);
  assert.deepEqual(readChildren("---\nchildren: []\n---\nbody"), []);
  assert.deepEqual(readChildren("---\nno children here\n---\nbody"), []);

  assert.equal(strategicTraceable("proposal cites FINDING-roadmap-2026"), true);
  assert.equal(strategicTraceable("proposal cites SPEC-state-crystallization"), true);
  assert.equal(strategicTraceable("proposal cites REVIEW-cadence mechanism"), true);
  assert.equal(strategicTraceable("just a normal task"), false);
  assert.equal(STRATEGIC_REF_RE.test("lowercase spec- reference"), false, "case-sensitive prefix match");

  assert.deepEqual(touchesScale("## Touches\n- code/a.ts\n- code/b.ts"), { hasSection: true, count: 2 });
  assert.equal(touchesScale("no touches section").count, 0, "missing Touches = unknown scope (high cost)");
});


test("analyzeTasks --top: top_relevance = highest-value N todos with reasons; strategic ranks front (AC2/control)", (t) => {
  const root = makeWorkspace("top-rel");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  writeTask(root, "gap-r1", { status: "ready", labels: ["gap"], body: fourArtifactBody() });
  writeTask(root, "gap-r2", { status: "ready", labels: ["gap"], body: fourArtifactBody() });
  // todos: strategic, blocking (children), plain small — all gap-* so the gap>DIR tiebreak cannot
  // separate them; only the relevance signal can.
  writeTask(root, "gap-strategic", gapTask("gap-strategic", {
    body: fourArtifactBody({ extra: "\nproposal references SYNTHESIS-four-gaps-2026-08-05.md" }),
  }));
  writeTask(root, "gap-blocker", { ...gapTask("gap-blocker"), children: ["gap-child"] });
  writeTask(root, "gap-small", gapTask("gap-small", { body: fourArtifactBody({ touches: ["- code/a.ts"] }) }));

  const r = analyzeTasks({ tasksDir: path.join(root, "tasks"), root, cap: 3, floorMult: 1, topN: 3 });
  assert.ok(Array.isArray(r.top_relevance));
  assert.equal(r.top_relevance.length, 3);
  // control: strategic traceability candidate ranks front (AC6 instance).
  assert.equal(r.top_relevance[0].id, "gap-strategic", "strategic candidate must rank first");
  assert.equal(r.top_relevance[0].strategic, true);
  // every entry carries the mechanical signal fields (AC1 output to JSON).
  for (const e of r.top_relevance) {
    assert.equal(typeof e.strategic, "boolean");
    assert.equal(typeof e.blocking, "boolean");
    assert.equal(typeof e.cost, "number");
    assert.equal(typeof e.value, "number");
    assert.equal(typeof e.reason, "string");
  }
  // value-sorted desc.
  const vals = r.top_relevance.map((e) => e.value);
  assert.deepEqual(vals, [...vals].sort((a, b) => b - a), "top_relevance sorted by value desc");
});


test("analyzeTasks --top: ready_relevance ranks the ready pool by the same signal (AC6)", (t) => {
  const root = makeWorkspace("ready-rel");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  // Ready pool of two gap-* tasks — the gap>DIR tiebreak cannot pick between them; relevance can.
  writeTask(root, "gap-plain-ready", { status: "ready", labels: ["gap"], body: fourArtifactBody({ touches: ["- code/plain.ts"] }) });
  writeTask(root, "gap-strategic-ready", {
    status: "ready",
    labels: ["gap"],
    body: fourArtifactBody({ touches: ["- code/s.ts"], extra: "\nproposal references SYNTHESIS-four-gaps-2026-08-05.md" }),
  });

  const r = analyzeTasks({ tasksDir: path.join(root, "tasks"), root, cap: 3, floorMult: 1 });
  assert.ok(Array.isArray(r.ready_relevance), "ready_relevance always emitted");
  assert.equal(r.ready_relevance.length, 2);
  const vals = r.ready_relevance.map((e) => e.value);
  assert.deepEqual(vals, [...vals].sort((a, b) => b - a), "ready_relevance sorted by value desc");
  assert.equal(r.ready_relevance[0].id, "gap-strategic-ready", "strategic ready task ranks first in the ready pool");
});


test("analyzeTasks --top: ready_relevance excludes in-flight ids (AC6 dispatchable set)", (t) => {
  const root = makeWorkspace("ready-rel-inf");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  writeTask(root, "gap-strategic-ready", {
    status: "ready",
    labels: ["gap"],
    body: fourArtifactBody({ touches: ["- code/s.ts"], extra: "\nproposal references SYNTHESIS-four-gaps-2026-08-05.md" }),
  });
  writeTask(root, "gap-plain-ready", { status: "ready", labels: ["gap"], body: fourArtifactBody({ touches: ["- code/plain.ts"] }) });

  const r = analyzeTasks({
    tasksDir: path.join(root, "tasks"),
    root,
    cap: 3,
    floorMult: 1,
    inFlight: [{ id: "gap-strategic-ready", body: "in flight" }],
  });
  assert.deepEqual(
    r.ready_relevance.map((e) => e.id),
    ["gap-plain-ready"],
    "in-flight ready task excluded from the dispatchable relevance ranking",
  );
});
