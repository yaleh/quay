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

// SPLIT from ready-pool-check.test.mjs by gap-suite-split-15-over-30s-test-files — shard 5/22 (8 tests). Shared fixtures: ./helpers/ready-pool-check-harness.mjs (single source).

import { test } from "node:test";
import { analyzeTasks, assert, execFileSync, fourArtifactBody, fs, gapTask, isCompoundTask, makeWorkspace, os, parseTask, path, readTaskStatusAtRef, writeTask } from "./helpers/ready-pool-check-harness.mjs";

test("pool < floor but dispatchable_disjoint ≥ cap ⇒ criterion met, NO false report (AC3 negative)", (t) => {
  const root = makeWorkspace("criterion-met");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  writeTask(root, "gap-a", { status: "ready", labels: ["gap"], body: fourArtifactBody({ touches: ["- code/a.ts"] }) });
  writeTask(root, "gap-b", { status: "ready", labels: ["gap"], body: fourArtifactBody({ touches: ["- code/b.ts"] }) });
  // cap 2, floorMult 6 ⇒ floor 12; pool 2 < 12 but 2 mutually-disjoint ≥ cap 2.
  const r = analyzeTasks({ tasksDir: path.join(root, "tasks"), root, cap: 2, floorMult: 6 });
  assert.equal(r.floor, 12);
  assert.equal(r.pool, 2);
  assert.ok(r.pool < r.floor, "pool below floor");
  assert.equal(r.dispatchable_disjoint, 2);
  assert.equal(r.criterion_met, true, "2 ≥ cap 2 ⇒ criterion satisfied");
  assert.equal(r.pool_big_all_colliding, false, "must NOT report pool-big-all-colliding");
  assert.doesNotMatch(r.report, /POOL BIG BUT ALL COLLIDING/);
});

// ── AC4 + AC48: the pool<floor gate is RETIRED — pool ≥ floor with a qualified candidate NOW
//    recommends it (合格即晋, 不看 pool 大小). The only negative control left is "no qualified
//    candidate ⇒ no promotions" (covered below). ──────────────────────────────────────────────────


test("pool >= floor with qualified candidate ⇒ promotes it (AC48 合格即晋 — pool<floor gate retired)", (t) => {
  const root = makeWorkspace("pos-pool-full");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const id of ["gap-r1", "gap-r2", "gap-r3"]) {
    writeTask(root, id, { status: "ready", labels: ["gap"], body: fourArtifactBody() });
  }
  // A fully-qualified todo candidate exists AND the pool is at/above floor — pre-AC48 this was the
  // "no busy-work" case (promotions []); post-AC48 the pool<floor gate is cancelled so it promotes.
  writeTask(root, "gap-candidate", gapTask("gap-candidate"));

  const r = analyzeTasks({ tasksDir: path.join(root, "tasks"), root, cap: 3, floorMult: 1 }); // floor 3
  assert.equal(r.pool, 3);
  assert.equal(r.floor, 3);
  assert.equal(r.deficit, 0);
  assert.deepEqual(r.promotions.map((p) => p.id), ["gap-candidate"], "qualified candidate promotes regardless of pool size (AC48)");
});

// ── AC4: pool < floor + qualified candidate ⇒ recommend ───────────────────────────────────────────


test("pool < floor with a qualified todo candidate ⇒ recommend it with a reason", (t) => {
  const root = makeWorkspace("pos-rec");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  writeTask(root, "gap-r1", { status: "ready", labels: ["gap"], body: fourArtifactBody() });
  writeTask(root, "gap-r2", { status: "ready", labels: ["gap"], body: fourArtifactBody() });
  writeTask(root, "gap-candidate", gapTask("gap-candidate")); // no Touches → resolves trivially, no parent → deps ready

  const r = analyzeTasks({ tasksDir: path.join(root, "tasks"), root, cap: 3, floorMult: 1 }); // floor 3
  assert.equal(r.pool, 2);
  assert.equal(r.deficit, 1);
  assert.equal(r.promotions.length, 1);
  assert.equal(r.promotions[0].id, "gap-candidate");
  assert.match(r.promotions[0].reason, /touches resolve/);
  assert.match(r.promotions[0].reason, /four-artifacts complete/);
});

// ── AC4: pool < floor + NO qualified candidate ⇒ no recommendation ───────────────────────────────


test("pool < floor but no qualified candidate ⇒ no promotions", (t) => {
  const root = makeWorkspace("neg-no-qual");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  writeTask(root, "gap-r1", { status: "ready", labels: ["gap"], body: fourArtifactBody() });
  writeTask(root, "gap-r2", { status: "ready", labels: ["gap"], body: fourArtifactBody() });

  // Candidate fails four-artifacts (no DoD).
  writeTask(root, "gap-no-dod", gapTask("gap-no-dod", { body: fourArtifactBody().replace("## Definition of Done", "## Resolution") }));
  // Candidate fails deps (parent file missing → fail-closed, parent cannot be confirmed done).
  writeTask(root, "gap-child", { ...gapTask("gap-child"), parent: "gap-ghost-parent" });

  const r = analyzeTasks({ tasksDir: path.join(root, "tasks"), root, cap: 3, floorMult: 1 }); // floor 3
  assert.equal(r.deficit, 1);
  assert.deepEqual(r.promotions, [], "no qualified candidate ⇒ nothing to recommend");
  const byId = Object.fromEntries(r.candidates.map((c) => [c.id, c]));
  assert.equal(byId["gap-no-dod"].eligible, false);
  assert.equal(byId["gap-no-dod"].missingArtifacts.includes("dod"), true);
  assert.equal(byId["gap-child"].eligible, false);
  assert.equal(byId["gap-child"].depsReady, false);
});

// ── DEPENDS_ON READS DEVELOP REF (gap-ready-pool-depends-on-status-stale-read) ─────────────────────
// The depends_on/parent statusOf in depsReadyFor used to read the `allTasks` Map — built from the
// manager working branch's DISK (a stale agent-proxy, 硬规则 4b) — so a dependency already `done` on
// develop still reported blocking. The fix reads the canonical develop ref via readTaskStatusAtRef.
// AC1/AC3: dep done on develop + stale disk ⇒ deps-ready (not blocking). AC2: dep genuinely not done
// on develop ⇒ still blocking (fail-closed unchanged). Needs a REAL git repo (the ref read is
// `git cat-file --batch`), created inline like the git-history tests above.


test("depends_on statusOf reads develop ref, not the stale disk allTasks (gap-ready-pool-depends-on-status-stale-read AC1/AC2/AC3)", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `ready-pool-depref-${Date.now()}-`));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, "tasks"), { recursive: true });
  fs.mkdirSync(path.join(root, "code"), { recursive: true });
  const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  git("init", "-b", "master", "-q", ".");
  git("config", "user.email", "test@example.com");
  git("config", "user.name", "Test");

  // Deps as they exist ON DEVELOP: gap-dep-done is done; gap-dep-todo is genuinely todo.
  writeTask(root, "gap-dep-done", { status: "done", labels: ["gap"], body: fourArtifactBody() });
  writeTask(root, "gap-dep-todo", { status: "todo", labels: ["gap"], body: fourArtifactBody() });
  fs.writeFileSync(path.join(root, ".gitkeep"), "base\n");
  git("add", ".");
  git("commit", "-q", "-m", "deps as committed on develop");
  git("branch", "-q", "develop"); // develop ← the snapshot where gap-dep-done is done

  // The manager working branch's DISK goes STALE: gap-dep-done flips back to todo on disk, while
  // develop still has it done. (gap-dep-todo stays todo on both — the AC2 negative control.)
  writeTask(root, "gap-dep-done", { status: "todo", labels: ["gap"], body: fourArtifactBody() });

  // Two todo candidates, each depending on one dep (patched in after writeTask — writeTask has no
  // dependsOn param).
  for (const [id, dep] of [["gap-cand-done", "gap-dep-done"], ["gap-cand-todo", "gap-dep-todo"]]) {
    writeTask(root, id, {
      status: "todo", labels: ["gap"], parent: null, children: [],
      body: fourArtifactBody({ touches: [`- code/${id}.ts (new)`] }),
    });
    const f = path.join(root, "tasks", `${id}.md`);
    fs.writeFileSync(f, fs.readFileSync(f, "utf8").replace("parent: null", `depends_on:\n  - ${dep}\nparent: null`));
  }

  const r = analyzeTasks({ tasksDir: path.join(root, "tasks"), root, cap: 3, floorMult: 1 });
  const byId = Object.fromEntries(r.candidates.map((c) => [c.id, c]));
  assert.equal(byId["gap-cand-done"].depsReady, true,
    "dep done on develop ⇒ deps-ready even though the disk allTasks view is stale (todo)");
  assert.equal(byId["gap-cand-todo"].depsReady, false,
    "dep genuinely not done on develop ⇒ still blocking (fail-closed unchanged)");
});

// ── COMPOUND AGGREGATION (gap-compound-depsreadyfor-structural-deadlock AC2/AC3) ─────────────────────
// The structural deadlock: a compound parent (`role: compound`, status ready NOT done) is only done
// once ALL its children are done (parent-done-iff-children, DIR-026), so a child waiting on its
// compound parent is 双向互等 (child waits on parent, parent waits on children) ⇒ the whole subtree is
// permanently un-dispatchable. The fix: `depsReadyFor` treats a compound parent as an AGGREGATION
// edge (the parent IS the children's sum, not a predecessor) and EXCLUDES it from a child's deps —
// children dispatch on their own depends_on edges alone. A non-compound (primitive) parent not done
// STILL blocks its child (predecessor semantics intact — negative control).


test("COMPOUND: a todo child whose parent is `role: compound` IS deps-ready (aggregation, not predecessor)", (t) => {
  const root = makeWorkspace("compound-deps");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  // The compound parent is status `ready` (NOT done) — the exact shape that deadlocks pre-fix: a
  // child waiting on it can never see it done while any child is open.
  writeTask(root, "gap-compound-parent", {
    status: "ready", labels: ["gap"], role: "compound", children: ["gap-compound-child"],
    body: fourArtifactBody({ touches: ["- code/parent.ts (new)"] }),
  });
  // The todo child names the compound parent — pre-fix depsReady=false (parent not done); post-fix
  // the compound-parent edge is EXCLUDED ⇒ depsReady=true.
  writeTask(root, "gap-compound-child", {
    status: "todo", labels: ["gap"], parent: "gap-compound-parent",
    body: fourArtifactBody({ touches: ["- code/child.ts (new)"] }),
  });
  // Negative control: a NON-compound (primitive) parent not done still blocks its child.
  writeTask(root, "gap-plain-parent", {
    status: "ready", labels: ["gap"],
    body: fourArtifactBody({ touches: ["- code/plain.ts (new)"] }),
  });
  writeTask(root, "gap-plain-child", {
    status: "todo", labels: ["gap"], parent: "gap-plain-parent",
    body: fourArtifactBody({ touches: ["- code/plain-child.ts (new)"] }),
  });

  const r = analyzeTasks({ tasksDir: path.join(root, "tasks"), root, cap: 3, floorMult: 1 });
  const byId = Object.fromEntries(r.candidates.map((c) => [c.id, c]));
  assert.equal(byId["gap-compound-child"].depsReady, true,
    "compound parent (aggregation) must NOT block the child — the structural deadlock is broken");
  assert.equal(byId["gap-plain-child"].depsReady, false,
    "a non-compound (primitive) parent not done STILL blocks the child (predecessor semantics intact)");
});


test("COMPOUND: isCompoundTask reads the frontmatter role (unit, incl. negative + missing-task)", (t) => {
  const root = makeWorkspace("compound-unit");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  writeTask(root, "gap-compound-parent", {
    status: "ready", labels: ["gap"], role: "compound",
    body: fourArtifactBody({ touches: ["- code/parent.ts (new)"] }),
  });
  writeTask(root, "gap-plain-parent", {
    status: "ready", labels: ["gap"],
    body: fourArtifactBody({ touches: ["- code/plain.ts (new)"] }),
  });
  const all = new Map();
  for (const f of fs.readdirSync(path.join(root, "tasks")).filter((f) => f.endsWith(".md"))) {
    const id = f.replace(/\.md$/, "");
    const task = parseTask(fs.readFileSync(path.join(root, "tasks", f), "utf8"));
    task.id = id;
    task.parent = null;
    all.set(id, task);
  }
  assert.equal(isCompoundTask(all.get("gap-compound-parent")), true, "role: compound ⇒ compound");
  assert.equal(isCompoundTask(all.get("gap-plain-parent")), false, "no role ⇒ not compound");
  assert.equal(isCompoundTask(all.get("gap-ghost-missing")), false, "missing task ⇒ not compound (fail closed)");
  assert.equal(isCompoundTask({ body: "no frontmatter" }), false, "task without frontmatterRaw ⇒ not compound");
});

// ── AC5: candidate with majority-missing Touches is not recommended (guard KEPT) ──────────────────


test("candidate with majority-missing Touches is not recommended (AC5)", (t) => {
  const root = makeWorkspace("neg-touches");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  writeTask(root, "gap-r1", { status: "ready", labels: ["gap"], body: fourArtifactBody() });
  writeTask(root, "gap-r2", { status: "ready", labels: ["gap"], body: fourArtifactBody() });
  // Candidate declares touches on files that do not exist (no `(new)` tag).
  writeTask(root, "gap-missing-touch", gapTask("gap-missing-touch", {
    body: fourArtifactBody({ touches: ["- code/does-not-exist.ts", "- plugin/scripts/also-missing.ts"] }),
  }));

  const r = analyzeTasks({ tasksDir: path.join(root, "tasks"), root, cap: 3, floorMult: 1 }); // floor 3
  assert.equal(r.deficit, 1);
  assert.deepEqual(r.promotions, []);
  const c = r.candidates.find((x) => x.id === "gap-missing-touch");
  assert.equal(c.touchesResolve, false);
  assert.equal(c.eligible, false);
});

// ── AC4: ordering — touch-disjointness ranks FIRST (pool + in-flight), gap-*>DIR-* as tiebreak ────
