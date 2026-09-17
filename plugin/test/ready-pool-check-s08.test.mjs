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

// SPLIT from ready-pool-check.test.mjs by gap-suite-split-15-over-30s-test-files — shard 8/13 (14 tests). Shared fixtures: ./helpers/ready-pool-check-harness.mjs (single source).

import { test } from "node:test";
import { __dirname, analyzeTasks, applyPromotions, assert, buildTargetedPromotion, ensureDeliveryCriticalLabel, execFileSync, fourArtifactBody, fs, gapTask, makeWorkspace, os, parseTask, path, setTaskStatus, writeTask } from "./helpers/ready-pool-check-harness.mjs";

test("setTaskStatus judges todo from develop — a dirty ready leftover re-commits, develop converges (AC1 能取假)", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `ready-pool-poison-${Date.now()}-`));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, "tasks"), { recursive: true });
  fs.mkdirSync(path.join(root, "code"), { recursive: true });
  const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  git("init", "-q", "-b", "develop", ".");
  git("config", "user.email", "test@example.com");
  git("config", "user.name", "Test");
  writeTask(root, "gap-candidate", gapTask("gap-candidate"));
  git("add", ".");
  git("commit", "-q", "-m", "init todo");
  git("checkout", "-q", "-b", "author");
  // The poison: the flip landed on disk (ready) but the commit failed — develop/HEAD stay todo.
  writeTask(root, "gap-candidate", { ...gapTask("gap-candidate"), status: "ready" });
  assert.match(git("show", "develop:tasks/gap-candidate.md"), /^status:\s*todo$/m,
    "precondition: develop still todo (the poison)");
  assert.match(git("status", "--porcelain"), /M tasks\/gap-candidate\.md/,
    "precondition: worktree dirty — ready uncommitted");

  const opts = { tasksDir: path.join(root, "tasks"), root, cap: 3, floorMult: 1, taskReadRef: "develop" };
  const r = applyPromotions(opts);
  assert.equal(r.should_apply, true);
  assert.equal(r.applied_promotions.length, 1);
  assert.equal(r.applied_promotions[0].id, "gap-candidate");
  assert.equal(r.applied_promotions[0].ok, true, "AC1: develop-todo ⇒ re-flip, ⛔ not a not-todo skip");
  assert.equal(r.applied_promotions[0].committed, true, "AC1: the leftover ready is re-committed");
  assert.match(git("show", "develop:tasks/gap-candidate.md"), /^status:\s*ready$/m,
    "AC1: develop converges to ready");
});


test("setTaskStatus still no-ops when develop is already ready — no duplicate flip (AC2 负控制)", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `ready-pool-poison-neg-${Date.now()}-`));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, "tasks"), { recursive: true });
  const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  git("init", "-q", "-b", "develop", ".");
  git("config", "user.email", "test@example.com");
  git("config", "user.name", "Test");
  writeTask(root, "gap-ready", { status: "ready", labels: ["gap"], body: fourArtifactBody() });
  git("add", ".");
  git("commit", "-q", "-m", "init ready");
  git("checkout", "-q", "-b", "author");

  const out = setTaskStatus(root, "gap-ready", "ready");
  assert.equal(out.ok, false, "AC2: develop already ready ⇒ no duplicate flip");
  assert.equal(out.reason, "not-todo");
  assert.equal(git("status", "--porcelain"), "", "AC2: no write, tree stays clean");
});


test("default analyzeTasks never writes tasks/ (pure detector preserved — no --apply = byte-unchanged)", (t) => {
  const root = makeWorkspace("pure");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  writeTask(root, "gap-r1", { status: "ready", labels: ["gap"], body: fourArtifactBody() });
  writeTask(root, "gap-candidate", gapTask("gap-candidate"));

  const opts = { tasksDir: path.join(root, "tasks"), root, cap: 3, floorMult: 1 };
  const before = fs.readFileSync(path.join(root, "tasks", "gap-candidate.md"), "utf8");
  const r = analyzeTasks(opts);
  assert.equal(r.promotions.length, 1, "read mode still recommends the candidate");
  const after = fs.readFileSync(path.join(root, "tasks", "gap-candidate.md"), "utf8");
  assert.equal(after, before, "no writes without --apply");
  assert.equal(Object.hasOwn(r, "should_apply"), false, "read mode has no apply fields");
  assert.equal(Object.hasOwn(r, "applied_promotions"), false);
});


test("CLI --apply smoke: --root/--cap/--floor-mult/--apply lands promotions + emits JSON (exit 0)", (t) => {
  const root = makeWorkspace("apply-cli");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  writeTask(root, "gap-r1", { status: "ready", labels: ["gap"], body: fourArtifactBody() });
  writeTask(root, "gap-r2", { status: "ready", labels: ["gap"], body: fourArtifactBody() });
  writeTask(root, "gap-candidate", gapTask("gap-candidate"));

  const script = path.resolve(__dirname, "..", "scripts", "ready-pool-check.ts");
  const out = execFileSync(
    process.execPath,
    ["--experimental-strip-types", script, "--root", root, "--cap", "3", "--floor-mult", "1", "--apply"],
    { encoding: "utf8" },
  );
  const parsed = JSON.parse(out);
  assert.equal(parsed.should_apply, true);
  assert.equal(parsed.applied_promotions.length, 1);
  const task = parseTask(fs.readFileSync(path.join(root, "tasks", "gap-candidate.md"), "utf8"));
  assert.match(task.frontmatterRaw, /^status:\s*ready$/m, "CLI --apply lands the promotion on disk");
});

// ── DELIVERY-CRITICAL AT PROMOTE (tasks/gap-delivery-critical-label-at-promote-not-after-dispatch) ─
// The delivery-critical label's effect point is the dispatch-time sort key; it was being applied
// AFTER dispatch (the guard task dispatched 21:21:10, labeled 21:26:17 — 5min7s late), so the task
// entered the ready pool unlabeled and self-excluded from the ranking once in flight. AC1 fix: the
// promote gate DETERMINES delivery-critical at promote (todo→ready) and writes the label together
// with the ready status ("标签与 ready 同现") — so the sort key is in place for the NEXT selection.


test("ensureDeliveryCriticalLabel — adds delivery-critical to a block-list labels field (AC1)", () => {
  const fm = "id: gap-x\ntitle: x\nstatus: todo\nlabels:\n  - gap\n  - defect\nparent: null\n";
  const r = ensureDeliveryCriticalLabel(fm);
  assert.equal(r.deliveryCritical, true);
  assert.equal(r.added, true);
  assert.match(r.fm, /labels:\n  - gap\n  - defect\n  - delivery-critical/);
  assert.match(r.fm, /^parent: null$/m, "next top-level key preserved");
});


test("ensureDeliveryCriticalLabel — adds delivery-critical to a flow-list labels field (AC1)", () => {
  const fm = "id: gap-x\ntitle: x\nstatus: todo\nlabels: [gap, defect]\nparent: null\n";
  const r = ensureDeliveryCriticalLabel(fm);
  assert.equal(r.deliveryCritical, true);
  assert.equal(r.added, true);
  assert.match(r.fm, /labels: \[gap, defect, delivery-critical\]/);
});


test("ensureDeliveryCriticalLabel — appends a labels block when the frontmatter has none (AC1)", () => {
  const fm = "id: gap-x\ntitle: x\nstatus: todo\nparent: null\n";
  const r = ensureDeliveryCriticalLabel(fm);
  assert.equal(r.deliveryCritical, true);
  assert.equal(r.added, true);
  assert.match(r.fm, /labels:\n  - delivery-critical/);
  assert.match(r.fm, /^parent: null$/m, "existing frontmatter preserved");
});


test("ensureDeliveryCriticalLabel — idempotent when delivery-critical is already present (AC1)", () => {
  const fm = "id: gap-x\ntitle: x\nstatus: todo\nlabels:\n  - gap\n  - delivery-critical\nparent: null\n";
  const r = ensureDeliveryCriticalLabel(fm);
  assert.equal(r.deliveryCritical, true);
  assert.equal(r.added, false, "no duplicate item added");
  assert.equal(r.fm, fm, "frontmatter byte-unchanged when the label is already present");
});


test("setTaskStatus with ensureDeliveryCritical writes status AND the delivery-critical label at promote (AC1 — 标签与 ready 同现)", (t) => {
  const root = makeWorkspace("sts-dc");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const body = "**type:** execution\n\n## Proposal\nA real proposal paragraph long enough to be counted.\n\n## Plan\nA real plan paragraph long enough to be counted.\n";
  writeTask(root, "gap-crit", { status: "todo", labels: ["gap"], body });

  const out = setTaskStatus(root, "gap-crit", "ready", { ensureDeliveryCritical: true });
  assert.equal(out.ok, true);
  assert.equal(out.to, "ready");
  assert.equal(out.deliveryCritical, true, "the promote record exposes the determination");

  const raw = fs.readFileSync(path.join(root, "tasks", "gap-crit.md"), "utf8");
  assert.match(raw, /^status:\s*ready$/m, "status flipped to ready");
  assert.match(raw, /^\s+- delivery-critical$/m, "delivery-critical label co-occurs with ready");
  assert.match(raw, /^\s+- gap$/m, "existing label preserved");
});


test("setTaskStatus WITHOUT ensureDeliveryCritical does NOT add the label (AC1 negative control)", (t) => {
  const root = makeWorkspace("sts-dc-neg");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const body = "**type:** execution\n\n## Proposal\nA real proposal paragraph long enough to be counted.\n\n## Plan\nA real plan paragraph long enough to be counted.\n";
  writeTask(root, "gap-plain", { status: "todo", labels: ["gap"], body });

  const out = setTaskStatus(root, "gap-plain", "ready");
  assert.equal(out.ok, true);
  assert.equal(out.deliveryCritical, false, "a non-determined promotion exposes deliveryCritical:false");

  const raw = fs.readFileSync(path.join(root, "tasks", "gap-plain.md"), "utf8");
  assert.match(raw, /^status:\s*ready$/m, "status flipped to ready");
  assert.doesNotMatch(raw, /delivery-critical/, "no label was invented for a non-delivery-critical task");
});


test("applyPromotions: a delivery-critical todo enters ready WITH its label (AC1 — label co-occurs with ready)", (t) => {
  const root = makeWorkspace("apply-dc");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  writeTask(root, "gap-r1", { status: "ready", labels: ["gap"], body: fourArtifactBody() });
  writeTask(root, "gap-r2", { status: "ready", labels: ["gap"], body: fourArtifactBody() });
  writeTask(root, "gap-crit", gapTask("gap-crit", { labels: ["gap", "delivery-critical"], goal_ac: "AC-190" }));

  const opts = { tasksDir: path.join(root, "tasks"), root, cap: 3, floorMult: 1 }; // floor 3, pool 2
  const r = applyPromotions(opts);
  assert.equal(r.should_apply, true);
  assert.equal(r.applied_promotions.length, 1);
  assert.equal(r.applied_promotions[0].id, "gap-crit");
  assert.equal(r.applied_promotions[0].deliveryCritical, true, "the applied record exposes the delivery-critical determination");

  const task = parseTask(fs.readFileSync(path.join(root, "tasks", "gap-crit.md"), "utf8"));
  assert.match(task.frontmatterRaw, /^status:\s*ready$/m, "status landed on disk");
  assert.ok(task.labels.includes("delivery-critical"), "the label is in the frontmatter at ready-entry (标签与 ready 同现)");
});

// ── GOAL LAYER IS NOT AN ADMISSION INPUT (人 2026-09-11 裁定) ──────────────────────────────────────
// The removed `goalAcMissing` conjunct made a delivery-critical todo WITHOUT `goal_ac` structurally
// unpromotable (a zombie). The admission set is decided ONLY by the task's own self-sufficient
// properties; the goal-layer half of the same rule lives in
// long-term-guarantee-goal-backed-check.ts (per-round re-evaluation, WITH an activation line that
// grandfathers the pre-cutoff stock — the admission gate had no such line, which is why the
// half-patched simulation produced the zombie). Invariant is mechanically guarded by
// plugin/scripts/eligible-no-goal-source-check.ts.

test("applyPromotions: a delivery-critical todo WITHOUT goal_ac IS promoted (goal layer is not an admission input)", (t) => {
  const root = makeWorkspace("apply-dc-no-goal-ac");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  writeTask(root, "gap-r1", { status: "ready", labels: ["gap"], body: fourArtifactBody() });
  writeTask(root, "gap-r2", { status: "ready", labels: ["gap"], body: fourArtifactBody() });
  writeTask(root, "gap-crit", gapTask("gap-crit", { labels: ["gap", "delivery-critical"] }));

  const opts = { tasksDir: path.join(root, "tasks"), root, cap: 3, floorMult: 1 };
  const r = applyPromotions(opts);
  assert.equal(r.should_apply, true, "a self-sufficient candidate is eligible regardless of goal_ac");
  assert.equal(r.applied_promotions.length, 1);
  assert.equal(r.applied_promotions[0].id, "gap-crit");
  assert.equal(
    r.applied_promotions[0].deliveryCritical,
    true,
    "the label is still a TASK-layer fact (co-occurs with ready) — it just is not an admission term",
  );

  const task = parseTask(fs.readFileSync(path.join(root, "tasks", "gap-crit.md"), "utf8"));
  assert.match(task.frontmatterRaw, /^status:\s*ready$/m, "status flipped todo→ready — no goal-layer admission term");
  assert.ok(task.labels.includes("delivery-critical"), "the label is in the frontmatter at ready-entry");
});


test("buildTargetedPromotion: a delivery-critical todo WITHOUT goal_ac is targeted-promotable (both paths agree)", (t) => {
  const root = makeWorkspace("targeted-dc-no-goal-ac");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, "code", "crit.ts"), "export const crit = 1;\n");
  const body = fourArtifactBody({ touches: ["- code/crit.ts", "- tasks/gap-crit.md"] });
  writeTask(root, "gap-crit", { status: "todo", labels: ["gap", "delivery-critical"], body });
  const raw = fs.readFileSync(path.join(root, "tasks", "gap-crit.md"), "utf8");
  // parseTask carries the body/frontmatter; `id` and `status` are supplied by the caller (the
  // analyzeTasks map does the same — same fixture shape as the AC1 bulk-gate test above).
  const task = { ...parseTask(raw), id: "gap-crit", status: "todo" };

  const r = buildTargetedPromotion("gap-crit", task, root, new Map([["gap-crit", task]]), "develop");
  assert.equal(r.eligible, true, "the targeted path must not carry a goal-layer admission term either");
  assert.equal(r.checks.goalAcMissing, undefined, "the removed check field is not re-introduced");
});


test("READY-POOL candidate: no goal-source field on the candidate (the removed goalAcMissing is gone, not renamed)", (t) => {
  const root = makeWorkspace("no-goal-field");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  writeTask(root, "gap-crit", gapTask("gap-crit", { labels: ["gap", "delivery-critical"] }));
  const r = analyzeTasks({ tasksDir: path.join(root, "tasks"), root, cap: 3, floorMult: 1 });
  const c = r.candidates.find((x) => x.id === "gap-crit");
  assert.ok(c, "the candidate is in the pool report");
  assert.equal(c.eligible, true, "delivery-critical + no goal_ac is promotion-eligible");
  const goalish = Object.keys(c).filter((k) => /goal/i.test(k));
  assert.deepEqual(goalish, [], `no goal-source field may appear on the candidate (found: ${goalish.join(",")})`);
});
