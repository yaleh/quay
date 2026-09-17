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

// SPLIT from ready-pool-check.test.mjs by gap-suite-split-15-over-30s-test-files — shard 13/22 (8 tests). Shared fixtures: ./helpers/ready-pool-check-harness.mjs (single source).

import { test } from "node:test";
import { __dirname, analyzeTasks, assert, ensureDeliveryCriticalLabel, execFileSync, fourArtifactBody, fs, gapTask, makeWorkspace, os, parseTask, path, setTaskStatus, writeTask } from "./helpers/ready-pool-check-harness.mjs";

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
