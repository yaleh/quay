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

// SPLIT from ready-pool-check.test.mjs by gap-suite-split-15-over-30s-test-files — shard 7/22 (8 tests). Shared fixtures: ./helpers/ready-pool-check-harness.mjs (single source).

import { test } from "node:test";
import { BLOCKING_WEIGHT, STRATEGIC_REF_RE, STRATEGIC_WEIGHT, __dirname, analyzeTasks, assert, computeRelevance, dirTask, execFileSync, fourArtifactBody, fs, gapTask, makeWorkspace, path, readChildren, strategicTraceable, touchesScale, writeTask } from "./helpers/ready-pool-check-harness.mjs";

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


test("value-prioritization does not alter the gap>DIR promotion order (AC4 regression)", (t) => {
  const root = makeWorkspace("rel-regress");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  writeTask(root, "gap-r1", { status: "ready", labels: ["gap"], body: fourArtifactBody() });
  writeTask(root, "gap-r2", { status: "ready", labels: ["gap"], body: fourArtifactBody() });
  writeTask(root, "DIR-new-cap", dirTask("DIR-new-cap"));
  writeTask(root, "gap-defect", gapTask("gap-defect"));

  const plain = analyzeTasks({ tasksDir: path.join(root, "tasks"), root, cap: 3, floorMult: 1 });
  const withTop = analyzeTasks({ tasksDir: path.join(root, "tasks"), root, cap: 3, floorMult: 1, topN: 5 });
  assert.deepEqual(
    plain.candidates.map((c) => c.id),
    withTop.candidates.map((c) => c.id),
    "candidate set/order identical with and without --top",
  );
  assert.deepEqual(plain.promotions.map((p) => p.id), withTop.promotions.map((p) => p.id));
  assert.deepEqual(withTop.candidates.map((c) => c.id), ["gap-defect", "DIR-new-cap"], "gap>DIR order preserved");
});

// ── VALUE-DEGRADATION REGRESSION (gap-value-priority-signal-degraded-to-1-over-cost) ────────────────
// AC1: the value signal must not be a pure `1/touches` — the three substantive axes
// (strategic/blocking/suite-blocking) must be ABLE to take Y. AC2: a large-touches strategic task (the
// pilot's shape) must NOT structurally bottom out. AC3: the composite metric is discriminative (non
// degenerate). These pin the two取数 fixes: (a) the strategic regex now word-boundary matches the
// strategic-doc reference form `SPEC §11` (the pilot references the SPEC doc by section, not by
// hyphenated filename — the old `/SPEC-/` missed it); (b) the blocking axis now reads the `depends_on`
// reverse edge (a task others depend on IS blocking).
