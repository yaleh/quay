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

// SPLIT from ready-pool-check.test.mjs by gap-suite-split-15-over-30s-test-files — shard 5/13 (13 tests). Shared fixtures: ./helpers/ready-pool-check-harness.mjs (single source).

import { test } from "node:test";
import { BLOCKING_WEIGHT, CONSOLIDATION_WEIGHT, STRATEGIC_REF_RE, STRATEGIC_WEIGHT, __dirname, analyzeTasks, assert, computeDependedOnCount, computeRelevance, dirTask, execFileSync, fourArtifactBody, fs, gapTask, makeWorkspace, parseTask, path, readConsolidates, touchesScale, writeTask } from "./helpers/ready-pool-check-harness.mjs";

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


test("value-degradation AC1: strategic axis取数 bug — `SPEC §11`-style reference (pilot's form) reads strategic Y", () => {
  // The pilot references "SPEC §11 阶段 2" — a reference to the strategic SPEC doc by section number,
  // not the hyphenated filename `SPEC-per-task-suite-verification-2026-08-13.md`. The old
  // /FINDING-|SYNTHESIS-|SPEC-|REVIEW-cadence/ required a literal hyphen after SPEC, so the pilot —
  // the stage's single strategic priority — read strategic N. Word-boundary matching catches BOTH.
  assert.equal(STRATEGIC_REF_RE.test("SPEC §11 阶段 2 (per-task 全量试点)"), true, "SPEC §N (space+section) must match");
  assert.equal(STRATEGIC_REF_RE.test("SPEC-per-task-suite-verification-2026-08-13.md"), true, "hyphenated doc name still matches");
  assert.equal(STRATEGIC_REF_RE.test("FINDING-roadmap-predates-ADR-022-retirement"), true);
  assert.equal(STRATEGIC_REF_RE.test("SYNTHESIS-four-gaps-2026-08-05.md"), true);
  assert.equal(STRATEGIC_REF_RE.test("REVIEW-cadence mechanism"), true);
  // negative control: case-sensitivity preserved (a lowercase `spec` in prose is NOT a strategic ref).
  assert.equal(STRATEGIC_REF_RE.test("lowercase spec- reference"), false, "case-sensitive prefix match");
  assert.equal(STRATEGIC_REF_RE.test("just a normal task"), false);

  // end-to-end: a todo whose body references the pilot's actual strategic-doc form gets strategic Y
  // and a value well above its 1/cost — NOT structurally bottomed out.
  const strategic = computeRelevance("gap-spec-11-pilot", {
    body: "references SPEC §11 阶段 2 per-task 全量试点\n## Touches\n- code/a.ts\n- code/b.ts\n- code/c.ts",
  });
  assert.equal(strategic.strategic, true, "SPEC §11 reference ⇒ strategic traceable");
  assert.equal(strategic.value, Number((STRATEGIC_WEIGHT + 1 / 3).toFixed(3)), "value = strategic(4) + costBenefit(1/3), NOT 1/3");
  assert.match(strategic.reason, /strategic Y/);
});


test("value-degradation AC1: blocking axis取数 gap — a task others `depends_on` is blocking", () => {
  const childrenByTask = new Map();
  const parentRefCount = new Map();
  // two tasks list `gap-prereq` in their depends_on — its landing unblocks both (same semantic as
  // being named parent, but the edge family is `depends_on`, which the blocking axis never read).
  const dependedOnCount = new Map([["gap-prereq", 2]]);
  const r = computeRelevance(
    "gap-prereq",
    { body: "plain\n## Touches\n- code/a.ts" },
    childrenByTask,
    parentRefCount,
    null,
    dependedOnCount,
  );
  assert.equal(r.blocking, true, "a task others depends_on is blocking");
  assert.equal(r.value, BLOCKING_WEIGHT + 1, "value = blocking(2) + costBenefit(1)");
  assert.match(r.reason, /depends-on 2/);
  // negative: a task NO ONE depends_on stays non-blocking on this axis.
  const isolated = computeRelevance("gap-isolated", { body: "plain\n## Touches\n- code/a.ts" }, childrenByTask, parentRefCount, null, dependedOnCount);
  assert.equal(isolated.blocking, false);
});


test("computeDependedOnCount — the depends_on reverse-edge index, single source shared with the ff-starvation relief (gap-ff-starvation-no-dynamic-cap-relief)", () => {
  const fm = (extra) => parseTask(`---\nid: gap-x\nstatus: ready\n${extra}---\nbody\n`);
  const a = fm("");
  const b = fm("depends_on:\n  - gap-a\n");
  const c = fm("depends_on:\n  - gap-a\n  - gap-b\n");
  const allTasks = new Map([["gap-a", a], ["gap-b", b], ["gap-c", c]]);
  const m = computeDependedOnCount(allTasks);
  assert.equal(m.get("gap-a"), 2, "two tasks list gap-a in depends_on");
  assert.equal(m.get("gap-b"), 1);
  assert.equal(m.get("gap-c"), undefined, "no one depends_on gap-c ⇒ absent (never a fabricated 0)");
});


test("value-degradation AC2/AC3: a large-touches strategic task floats above a small plain task; composite not 1/cost (--top ordering)", (t) => {
  const root = makeWorkspace("val-nondeg");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  // The pilot shape: a LARGE touches task (many files) that is strategic — under the old pure-1/cost
  // signal it bottomed out (value = 1/8 for 8 touches); with the strategic axis restored it outranks a
  // tiny plain task.
  writeTask(root, "gap-pilot", gapTask("gap-pilot", {
    body: fourArtifactBody({
      touches: Array.from({ length: 8 }, (_, i) => `- code/file${i}.ts`),
      extra: "\nproposal references SPEC §11 阶段 2 (per-task 全量试点)",
    }),
  }));
  writeTask(root, "gap-plain", gapTask("gap-plain", {
    body: fourArtifactBody({ touches: ["- code/one.ts"] }),
  }));
  // a blocking-via-depends_on todo also ranks above the plain one.
  writeTask(root, "gap-dep", gapTask("gap-dep", {
    body: fourArtifactBody({ touches: ["- code/dep.ts"] }),
  }));
  writeTask(root, "gap-dependent", gapTask("gap-dependent", {
    body: fourArtifactBody({ touches: ["- code/other.ts"] }),
  }));

  // inject a depends_on edge gap-dependent → gap-dep by appending to the frontmatter.
  const depFile = path.join(root, "tasks", "gap-dependent.md");
  const depRaw = fs.readFileSync(depFile, "utf8");
  fs.writeFileSync(depFile, depRaw.replace(/^(extra:)/m, "depends_on:\n  - gap-dep\nextra:"));

  const r = analyzeTasks({ tasksDir: path.join(root, "tasks"), root, cap: 3, floorMult: 1, topN: 4 });
  assert.equal(r.top_relevance[0].id, "gap-pilot", "large-touches strategic task must rank FIRST (not bottom out)");
  assert.equal(r.top_relevance[0].strategic, true);
  // AC1 (gap-ac46-pool-criteria-in-gate): gapTask now injects the C8 self-touch (`- tasks/<id>.md`),
  // which touchesScale counts as a declared touch — gap-pilot's 8 real touches become 9 (8 + self-touch)
  // ⇒ cost = 1/9, value = STRATEGIC_WEIGHT + 1/9.
  assert.equal(r.top_relevance[0].value, Number((STRATEGIC_WEIGHT + 1 / 9).toFixed(3)));
  // the blocking-via-depends_on task ranks above the plain ones (blocking 2 + costBenefit 1 = 3 > 1).
  assert.equal(r.top_relevance[1].id, "gap-dep", "depends_on-blocking task ranks above plain");
  assert.equal(r.top_relevance[1].blocking, true);
  // both plain 1-touch tasks (gap-dependent, gap-plain) tie at value 1; the alphabetical tie-break
  // puts gap-dependent before gap-plain — the plain pair ranks LAST, after pilot and gap-dep.
  const plainIdx = r.top_relevance.map((e) => e.id).filter((id) => id === "gap-dependent" || id === "gap-plain");
  assert.deepEqual(plainIdx, ["gap-dependent", "gap-plain"], "plain pair last of the four");
  // AC3: the value sequence is NOT a monotone 1/cost curve — the strategic large task (4.125) tops
  // the plain tiny task (1), inverting the pure-cost ordering.
  assert.ok(r.top_relevance[0].value > r.top_relevance[2].value, "strategic large task outranks plain small");
  const vals = r.top_relevance.map((e) => e.value);
  assert.deepEqual(vals, [...vals].sort((a, b) => b - a), "top_relevance sorted by value desc");
});


test("CLI smoke: --top 5 emits top_relevance value-sorted array with reasons (AC2/Contract measure)", (t) => {
  const root = makeWorkspace("cli-top");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  writeTask(root, "gap-r1", { status: "ready", labels: ["gap"], body: fourArtifactBody() });
  writeTask(root, "gap-strategic", gapTask("gap-strategic", {
    body: fourArtifactBody({ extra: "\nproposal references SYNTHESIS-four-gaps-2026-08-05.md" }),
  }));
  writeTask(root, "gap-small", gapTask("gap-small", { body: fourArtifactBody({ touches: ["- code/a.ts"] }) }));
  const script = path.resolve(__dirname, "..", "scripts", "ready-pool-check.ts");
  const out = execFileSync(
    process.execPath,
    ["--experimental-strip-types", script, "--root", root, "--top", "5"],
    { encoding: "utf8" },
  );
  const parsed = JSON.parse(out);
  assert.ok(Array.isArray(parsed.top_relevance), "band: top_n_relevance is an array");
  assert.ok(parsed.top_relevance.length >= 1, "band: at least one relevance-sorted entry");
  assert.equal(parsed.top_relevance[0].strategic, true, "control: strategic candidate ranks front");
  assert.ok(parsed.top_relevance.every((e) => typeof e.value === "number" && typeof e.reason === "string"));
});

// ── CONSOLIDATION AXIS (gap-dispatch-value-has-no-consolidation-axis) ──────────────────────────────
// The three original merit axes (strategic / blocking / suite-blocking) had NO axis for
// SUBTRACTION/CONSOLIDATION merit — a task that deletes 119 duplicate implementations was billed
// only by its Touches width (costBenefit 1/120 ≈ 0.008), 40× below a 3-touch guard (1/3), so wide
// consolidation tasks were structurally starved in the dispatch queue. The fix adds a fourth axis
// whose value comes from a MECHANICAL frontmatter declaration `extra.consolidates: N` (NOT body
// prose — the negative control that keeps it from becoming a second STRATEGIC_REF_RE keyword match).


test("readConsolidates: mechanical extra.consolidates declaration; prose-only / absent / non-numeric read 0 (AC2/AC3)", () => {
  // parseTask's `extra` projection (the single YAML parser readDependsOn uses) carries the number.
  const declared = parseTask("---\nid: x\nextra:\n  schema: v1\n  consolidates: 119\n---\nbody");
  assert.equal(readConsolidates(declared), 119, "extra.consolidates: 119 ⇒ 119");
  assert.equal(readConsolidates({ extra: { consolidates: "12" } }), 12, "string N coerces to number");
  assert.equal(readConsolidates({ extra: { consolidates: 0 } }), 0, "0 ⇒ not consolidating");
  assert.equal(readConsolidates({ extra: { consolidates: -3 } }), 0, "negative ⇒ not consolidating");
  assert.equal(readConsolidates({ extra: {} }), 0, "absent ⇒ not consolidating");
  assert.equal(readConsolidates({ extra: { consolidates: "not-a-number" } }), 0, "non-numeric ⇒ 0 (fail-open)");
  // negative control (AC3): a task that only SAYS it consolidates in prose, with NO declaration, reads 0.
  assert.equal(readConsolidates({ body: "we consolidate 119 duplicate checker implementations into one template" }), 0,
    "prose-only consolidation claim ⇒ no declaration ⇒ 0");
});


test("computeRelevance: consolidation axis adds weight from the declaration; prose-only gets nothing (AC2/AC3)", () => {
  // A WIDE consolidation task (120 touches → costBenefit 1/120) with the mechanical declaration.
  const wide = computeRelevance("gap-consolidate-checkers", {
    body: "plain\n## Touches\n" + Array.from({ length: 120 }, (_, i) => `- code/checker${i}.ts`).join("\n"),
    extra: { consolidates: 119 },
  });
  assert.equal(wide.consolidating, true);
  assert.equal(wide.consolidates, 119);
  assert.equal(wide.value, Number((CONSOLIDATION_WEIGHT + 1 / 120).toFixed(3)),
    "value = consolidation(1) + costBenefit(1/120), NOT 1/120");
  assert.match(wide.reason, /consolidating Y\(119\)/);

  // negative control: prose-only consolidation claim (no extra.consolidates) gets NO weight.
  const proseOnly = computeRelevance("gap-prose-consolidation", {
    body: "we consolidate 119 duplicate checker implementations into one template\n## Touches\n- code/a.ts",
  });
  assert.equal(proseOnly.consolidating, false);
  assert.equal(proseOnly.value, 1, "prose-only ⇒ pure costBenefit (1 touch) = 1");

  // the starvation fix: the wide consolidation task outranks a narrow non-consolidation guard.
  const narrowGuard = computeRelevance("gap-narrow-guard", {
    body: "plain\n## Touches\n- code/a.ts\n- code/b.ts\n- code/c.ts",
  });
  assert.equal(narrowGuard.value, Number((1 / 3).toFixed(3)));
  assert.ok(wide.value > narrowGuard.value, "wide consolidation task outranks a narrow guard (AC4)");
});


test("analyzeTasks --top: wide consolidation todo ranks above a narrow guard (AC4 end-to-end)", (t) => {
  const root = makeWorkspace("consolidate-top");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  writeTask(root, "gap-narrow-guard", gapTask("gap-narrow-guard", {
    body: fourArtifactBody({ touches: ["- code/a.ts", "- code/b.ts", "- code/c.ts"] }),
  }));
  writeTask(root, "gap-consolidate-checkers", gapTask("gap-consolidate-checkers", {
    body: fourArtifactBody({ touches: Array.from({ length: 120 }, (_, i) => `- code/checker${i}.ts`) }),
  }));
  // Inject the mechanical declaration into the consolidation task's frontmatter `extra` block.
  const f = path.join(root, "tasks", "gap-consolidate-checkers.md");
  fs.writeFileSync(f, fs.readFileSync(f, "utf8").replace("  schema: v1\n", "  schema: v1\n  consolidates: 119\n"));

  const r = analyzeTasks({ tasksDir: path.join(root, "tasks"), root, cap: 3, floorMult: 1, topN: 2 });
  assert.equal(r.top_relevance.length, 2, "exactly the two todos");
  assert.equal(r.top_relevance[0].id, "gap-consolidate-checkers", "consolidation todo ranks first (AC4)");
  assert.equal(r.top_relevance[0].consolidating, true, "the mechanical declaration flips consolidating");
  assert.equal(r.top_relevance[0].consolidates, 119);
  assert.equal(r.top_relevance[1].id, "gap-narrow-guard", "narrow guard ranks second");
  assert.equal(r.top_relevance[1].consolidating, false, "narrow guard has no declaration ⇒ not consolidating");
  assert.ok(r.top_relevance[0].value > r.top_relevance[1].value,
    "consolidation value strictly above the narrow guard (AC4)");
});

// ── Cross-machine merge regression (AC17 catch-up): computeRelevance arity — blocking must work ──
// The merge left a 3-arg call to the 4-param computeRelevance; the default empty Map silently
// zeroed blocking (allTasks landed in childrenByTask, .get() → task object, .length undefined).
// Fix: buildCandidate threads childrenByTask/parentRefCount; a parent with a child must report
// blocking=true (the manager's counterexample: Y has child X → 4-arg blocking=true, 3-arg false).

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
