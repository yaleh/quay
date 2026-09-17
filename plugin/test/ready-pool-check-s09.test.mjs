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

// SPLIT from ready-pool-check.test.mjs by gap-suite-split-15-over-30s-test-files — shard 9/22 (8 tests). Shared fixtures: ./helpers/ready-pool-check-harness.mjs (single source).

import { test } from "node:test";
import { __dirname, analyzeTasks, assert, execFileSync, fourArtifactBody, fs, gapTask, makeWorkspace, path, writeTask } from "./helpers/ready-pool-check-harness.mjs";

test("relevance blocking works end-to-end — a parent task with a child reports blocking=true (arity regression)", (t) => {
  const root = makeWorkspace("rel-block");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  writeTask(root, "PARENT-1", { status: "todo", labels: ["gap"], children: ["CHILD-1"], body: fourArtifactBody({ touches: ["- code/a.ts"] }) });
  writeTask(root, "CHILD-1", { status: "todo", labels: ["gap"], parent: "PARENT-1", body: fourArtifactBody({ touches: ["- code/b.ts"] }) });
  const script = path.resolve(__dirname, "..", "scripts", "ready-pool-check.ts");
  const out = execFileSync(process.execPath, ["--experimental-strip-types", script, "--root", root, "--top", "5"], { encoding: "utf8" });
  const parsed = JSON.parse(out);
  const parent = parsed.top_relevance.find((e) => e.id === "PARENT-1");
  assert.ok(parent, "parent candidate present in top_relevance");
  assert.equal(parent.blocking, true, "parent with child must report blocking=true (childrenByTask threaded)");
  assert.match(parent.reason, /blocking Y/, "reason states blocking Y");
  // Negative: the child (no children of its own) is not blocking on the children axis.
  const child = parsed.top_relevance.find((e) => e.id === "CHILD-1");
  assert.equal(child.blocking, false, "child without children reports blocking=false");
});

// ── TARGETED PROMOTION (gap-targeted-promotion-operation-does-not-exist) ───────────────────────────
// The pool<floor refill is the BULK path (inner mechanical, AC3). A stage-goal task the bulk path
// used to leave in todo (the pool<floor gate blocked refill when pool ≥ floor) needed a SECOND,
// floor-INDEPENDENT operation: the OUTER picks the target per stage goal and
// `ready-pool-check --targeted <id>` MECHANICALLY validates it + emits the promote command.
// AC48 (2026-08-13) RETIRED the pool<floor bulk gate — the bulk path now ALSO promotes the eligible
// target at pool ≥ floor (合格即晋), so targeted and bulk agree on the same eligible set; targeted
// remains the outer's stage-goal pick (selection = outer). AC1 mechanical carrier · AC2 floor-
// independent (pool ≥ floor still eligible) · the target's identity is the outer's stage-goal choice.


test("--targeted: pool ≥ floor still promotes a mechanically-eligible todo (AC2 floor-independent)", (t) => {
  const root = makeWorkspace("targeted-floor");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  // Pool ≥ floor: cap 2, floorMult 1 ⇒ floor 2; two ready tasks ⇒ pool 2, deficit 0.
  writeTask(root, "gap-r1", { status: "ready", labels: ["gap"], body: fourArtifactBody() });
  writeTask(root, "gap-r2", { status: "ready", labels: ["gap"], body: fourArtifactBody() });
  // The stage-goal target sits in todo — pre-AC48 the bulk refill (deficit 0) would never recommend it.
  writeTask(root, "gap-target", gapTask("gap-target"));

  const r = analyzeTasks({ tasksDir: path.join(root, "tasks"), root, cap: 2, floorMult: 1, targetedId: "gap-target" });
  assert.equal(r.pool, 2);
  assert.equal(r.floor, 2);
  assert.ok(r.pool >= r.floor, "pool is at/above the floor");
  assert.equal(r.deficit, 0);
  assert.deepEqual(r.promotions.map((p) => p.id), ["gap-target"], "AC48: bulk refill now ALSO recommends the eligible target at pool ≥ floor (合格即晋)");
  assert.equal(r.targeted_promotion.eligible, true, "targeted promotion still eligible at pool ≥ floor (AC2)");
  assert.equal(r.targeted_promotion.floor_independent, true, "targeted path is marked floor-independent");
  assert.equal(r.targeted_promotion.promote_cmd, "quay promote gap-target", "the mechanical promote command (AC1)");
  assert.equal(r.targeted_promotion.found, true);
  assert.equal(r.targeted_promotion.checks.fourArtifacts, true);
  assert.equal(r.targeted_promotion.checks.depsReady, true);
});


test("--targeted: status guards — done/ready tasks and missing ids are not promotable", (t) => {
  const root = makeWorkspace("targeted-status");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  writeTask(root, "gap-ready", { status: "ready", labels: ["gap"], body: fourArtifactBody() });
  writeTask(root, "gap-done", { status: "done", labels: ["gap"], body: fourArtifactBody() });

  const ready = analyzeTasks({ tasksDir: path.join(root, "tasks"), root, targetedId: "gap-ready" });
  assert.equal(ready.targeted_promotion.eligible, false);
  assert.equal(ready.targeted_promotion.reason, "status-ready");

  const done = analyzeTasks({ tasksDir: path.join(root, "tasks"), root, targetedId: "gap-done" });
  assert.equal(done.targeted_promotion.eligible, false);
  assert.equal(done.targeted_promotion.reason, "status-done");

  const missing = analyzeTasks({ tasksDir: path.join(root, "tasks"), root, targetedId: "gap-ghost" });
  assert.equal(missing.targeted_promotion.found, false);
  assert.equal(missing.targeted_promotion.eligible, false);
  assert.equal(missing.targeted_promotion.reason, "task-not-found");
});


test("--targeted: fixture and PARKED todo targets are not promotable", (t) => {
  const root = makeWorkspace("targeted-excl");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  writeTask(root, "QENG-DEMO", { status: "todo", labels: ["fixture"], body: fourArtifactBody() });
  writeTask(root, "gap-parked", {
    status: "todo",
    labels: ["gap"],
    body: "> **PARKED (outer ruling, 2026-08-04) — execution suspended.**\n\n" + fourArtifactBody(),
  });

  const fixture = analyzeTasks({ tasksDir: path.join(root, "tasks"), root, targetedId: "QENG-DEMO" });
  assert.equal(fixture.targeted_promotion.eligible, false);
  assert.equal(fixture.targeted_promotion.reason, "fixture");

  const parked = analyzeTasks({ tasksDir: path.join(root, "tasks"), root, targetedId: "gap-parked" });
  assert.equal(parked.targeted_promotion.eligible, false);
  assert.equal(parked.targeted_promotion.reason, "parked");
});


test("--targeted: ineligible target (missing four-artifacts) reports a concrete reason", (t) => {
  const root = makeWorkspace("targeted-ineligible");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  writeTask(root, "gap-target", gapTask("gap-target", {
    body: fourArtifactBody().replace("## Definition of Done", "## Resolution"),
  }));

  const r = analyzeTasks({ tasksDir: path.join(root, "tasks"), root, targetedId: "gap-target" });
  assert.equal(r.targeted_promotion.eligible, false);
  assert.match(r.targeted_promotion.reason, /four-artifacts/);
  assert.match(r.targeted_promotion.reason, /missing dod/);
  assert.equal(r.targeted_promotion.checks.fourArtifacts, false);
});


test("--targeted: bulk promotions/candidates output is unchanged by the targeted query (AC3)", (t) => {
  const root = makeWorkspace("targeted-bulk");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  writeTask(root, "gap-r1", { status: "ready", labels: ["gap"], body: fourArtifactBody() });
  writeTask(root, "gap-r2", { status: "ready", labels: ["gap"], body: fourArtifactBody() });
  writeTask(root, "gap-candidate", gapTask("gap-candidate"));

  const plain = analyzeTasks({ tasksDir: path.join(root, "tasks"), root, cap: 3, floorMult: 1 });
  const withTargeted = analyzeTasks({ tasksDir: path.join(root, "tasks"), root, cap: 3, floorMult: 1, targetedId: "gap-candidate" });
  assert.deepEqual(plain.promotions, withTargeted.promotions, "bulk promotions unchanged");
  assert.deepEqual(plain.candidates, withTargeted.candidates, "bulk candidates unchanged");
  assert.equal(plain.targeted_promotion, null, "no targeted query ⇒ targeted_promotion is null");
  assert.ok(withTargeted.targeted_promotion, "targeted query ⇒ targeted_promotion present");
});


test("CLI smoke: --targeted <id> emits targeted_promotion with promote_cmd (AC1 mechanical carrier)", (t) => {
  const root = makeWorkspace("cli-targeted");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  writeTask(root, "gap-target", gapTask("gap-target"));
  const script = path.resolve(__dirname, "..", "scripts", "ready-pool-check.ts");
  const out = execFileSync(
    process.execPath,
    ["--experimental-strip-types", script, "--root", root, "--targeted", "gap-target"],
    { encoding: "utf8" },
  );
  const parsed = JSON.parse(out);
  assert.equal(parsed.targeted_promotion.eligible, true);
  assert.equal(parsed.targeted_promotion.promote_cmd, "quay promote gap-target");
  assert.equal(parsed.targeted_promotion.floor_independent, true);
  assert.equal(typeof parsed.targeted_promotion.checks, "object");
});

// ── RETIRED-MECHANISM INTERCEPT (gap-ready-pool-promotion-ignores-retired-mechanism-candidate-check) ──
// Promotion must not advance a todo that references an ADR-022-deleted classic-pipeline script
// (prepare-milestone.js / execute-milestone.js / milestone-worktree.ts) without annotation — such a
// candidate targets a RETIRED pipeline mechanism (premise-void; dispatching it wastes an agent round).
// AC1 promotion runs the same pool-candidate stale check the strategic-doc-staleness-check CLI exposes
// (--pool-candidate <id>, review-cadence AC8) before todo→ready · AC2 gap-prepare-milestone-no-size-
// aware-routing is intercepted · AC3 clean candidates (productize-manager etc.) still promote (negative
// control) · AC4 the intercept reason is mechanically recorded (never a silent skip).


test("AC1/AC2/AC4 — a candidate referencing an ADR-022-deleted script is NOT promoted and IS intercepted", (t) => {
  const root = makeWorkspace("retired");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  // Pool below floor (cap 3, floorMult 1 ⇒ floor 3; one ready task ⇒ deficit 2).
  writeTask(root, "gap-r1", { status: "ready", labels: ["gap"], body: fourArtifactBody() });
  // The retired-mechanism candidate: references prepare-milestone.js (ADR-022-deleted) unannotated.
  writeTask(root, "gap-prepare-milestone-no-size-aware-routing", gapTask("gap-prepare-milestone-no-size-aware-routing", {
    body: fourArtifactBody({ extra: "\nTarget mechanism: prepare-milestone.js (live).\n" }),
  }));

  const r = analyzeTasks({ tasksDir: path.join(root, "tasks"), root, cap: 3, floorMult: 1 });
  assert.ok(r.deficit > 0, "promotion pressure exists");
  assert.deepEqual(r.promotions, [], "the retired-mechanism candidate must NOT be promoted (AC1/AC2)");
  // AC4: the intercept is mechanically recorded, never silently skipped.
  assert.equal(r.intercepted.length, 1, "the intercept is recorded in the output");
  assert.equal(r.intercepted[0].id, "gap-prepare-milestone-no-size-aware-routing");
  assert.equal(r.intercepted[0].reason, "retired-mechanism");
  assert.ok(
    r.intercepted[0].refs.some((ref) => ref.hit === "prepare-milestone.js"),
    "the recorded ref names the deleted script",
  );
  const c = r.candidates.find((x) => x.id === "gap-prepare-milestone-no-size-aware-routing");
  assert.equal(c.retiredMechanism, true, "candidate carries the retiredMechanism flag");
  assert.equal(c.eligible, false, "retired-mechanism candidate is not eligible");
});
