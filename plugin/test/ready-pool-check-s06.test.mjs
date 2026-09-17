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

// SPLIT from ready-pool-check.test.mjs by gap-suite-split-15-over-30s-test-files — shard 6/22 (8 tests). Shared fixtures: ./helpers/ready-pool-check-harness.mjs (single source).

import { test } from "node:test";
import { analyzeTasks, assert, classifyKind, dirTask, fourArtifactBody, fs, gapTask, makeWorkspace, parseTask, path, priorityLevel, writeTask } from "./helpers/ready-pool-check-harness.mjs";

test("candidate order: gap-* defect sorts before DIR-* capability", (t) => {
  const root = makeWorkspace("order-kind");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  writeTask(root, "gap-r1", { status: "ready", labels: ["gap"], body: fourArtifactBody() });
  writeTask(root, "gap-r2", { status: "ready", labels: ["gap"], body: fourArtifactBody() });
  writeTask(root, "DIR-new-cap", dirTask("DIR-new-cap"));
  writeTask(root, "gap-defect", gapTask("gap-defect"));

  const r = analyzeTasks({ tasksDir: path.join(root, "tasks"), root, cap: 3, floorMult: 1 });
  const ids = r.candidates.map((c) => c.id);
  assert.deepEqual(ids, ["gap-defect", "DIR-new-cap"], "gap-* must sort before DIR-* (equal disjointness)");
  assert.equal(classifyKind("gap-defect"), "gap");
  assert.equal(classifyKind("DIR-new-cap"), "dir");
  assert.equal(classifyKind("ARCH-x"), "other");
});


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
