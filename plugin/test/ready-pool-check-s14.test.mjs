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

// SPLIT from ready-pool-check.test.mjs by gap-suite-split-15-over-30s-test-files — shard 14/22 (8 tests). Shared fixtures: ./helpers/ready-pool-check-harness.mjs (single source).

import { test } from "node:test";
import { analyzeTasks, applyPromotions, assert, buildTargetedPromotion, fourArtifactBody, fs, gapTask, makeWorkspace, parseTask, path, runGoalSourceCheck, setTaskStatus, writeTask } from "./helpers/ready-pool-check-harness.mjs";

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



test("eligible-no-goal-source-check: real repo GREEN (exit 0) ∧ injected goal-source fixture RED (exit 1)", () => {
  const pass = runGoalSourceCheck([]);
  assert.equal(pass.code, 0, `the anti-regression invariant must hold on this repo — got: ${pass.out}`);
  assert.match(pass.out, /^PASS:/m, "a green run says PASS");

  const injected = runGoalSourceCheck(["--inject-goal-source-fixture"]);
  assert.notEqual(injected.code, 0, "the injected fixture MUST be judged non-zero — the checker has to be able to take the value false");
  assert.equal(injected.code, 1, "the injected fixture is a FAIL (exit 1), not a usage/NOT-EVALUATED code");
  assert.match(injected.out, /^FAIL:/m, "the injected fixture says FAIL");
  assert.match(injected.out, /goalAcMissing|goal/i, "the fired control names the goal-source token it detected");
});


test("eligible-no-goal-source-check: 读不懂输入 gets an INDEPENDENT value — NOT-EVALUATED / exit 3, never PASS", (t) => {
  const root = makeWorkspace("egs-not-evaluated");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  // (a) unreadable source
  const missing = runGoalSourceCheck(["--source", path.join(root, "does-not-exist.ts")]);
  assert.equal(missing.code, 3, "an unreadable judged source is NOT-EVALUATED, distinct from PASS");
  assert.match(missing.out, /^NOT-EVALUATED:/m);

  // (b) readable but with NO `eligible` membership expression — the extractor found nothing, so it
  // must NOT report "compliant" (the comment-only mention below is deliberately NOT a site: 位置判定).
  const noSite = path.join(root, "no-membership-site.ts");
  fs.writeFileSync(noSite, "const promoted = four && deps;\n// eligible: not here any more\n");
  const empty = runGoalSourceCheck(["--source", noSite]);
  assert.equal(empty.code, 3, "no membership expression ⇒ NOT-EVALUATED, never PASS");
  assert.match(empty.out, /^NOT-EVALUATED:/m);
});


test("eligible-no-goal-source-check: 位置判定 — a goal token only in a COMMENT or STRING is not a hit", (t) => {
  const root = makeWorkspace("egs-positional");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const commented = path.join(root, "commented.ts");
  fs.writeFileSync(
    commented,
    [
      "// eligible: deps && goalAcMissing  (this comment must NOT count)",
      "const eligible = deps && !superseded;",
      'const reason = "eligible: goal_ac missing";',
      "",
    ].join("\n"),
  );
  const r = runGoalSourceCheck(["--source", commented]);
  assert.equal(r.code, 0, `a mention in a comment/string must not be a hit — got: ${r.out}`);
  assert.match(r.out, /^PASS:/m);

  // …and the SAME file, with the token moved into the live expression, is red.
  const live = path.join(root, "live.ts");
  fs.writeFileSync(live, "const eligible = deps && !goalAcMissing;\n");
  const bad = runGoalSourceCheck(["--source", live]);
  assert.equal(bad.code, 1, "the same token on the LIVE surface is a hit");
});
