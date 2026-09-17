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

// SPLIT from ready-pool-check.test.mjs by gap-suite-split-15-over-30s-test-files — shard 10/22 (8 tests). Shared fixtures: ./helpers/ready-pool-check-harness.mjs (single source).

import { test } from "node:test";
import { LANDING_BEHIND_THRESHOLD_DEFAULT, LANDING_STALENESS_MS_DEFAULT, __dirname, analyzeTasks, assert, computeLandingBlocked, detectLandingBlocked, execFileSync, fourArtifactBody, fs, gapTask, makeWorkspace, notYetFlipped, path, writeTask } from "./helpers/ready-pool-check-harness.mjs";

test("AC3 — clean candidates still promote; only the retired-mechanism candidate is intercepted (negative control)", (t) => {
  const root = makeWorkspace("retired-clean");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  writeTask(root, "gap-r1", { status: "ready", labels: ["gap"], body: fourArtifactBody() });
  // A clean candidate (one of the incident's 7 clean candidates — productize-manager) must still promote.
  writeTask(root, "productize-manager", gapTask("productize-manager"));
  // The retired-mechanism candidate.
  writeTask(root, "gap-prepare-milestone-no-size-aware-routing", gapTask("gap-prepare-milestone-no-size-aware-routing", {
    body: fourArtifactBody({ extra: "\nTarget mechanism: prepare-milestone.js (live).\n" }),
  }));

  const r = analyzeTasks({ tasksDir: path.join(root, "tasks"), root, cap: 3, floorMult: 1 });
  assert.ok(
    r.promotions.some((p) => p.id === "productize-manager"),
    "clean candidate still promoted (AC3 negative control)",
  );
  assert.ok(
    !r.promotions.some((p) => p.id === "gap-prepare-milestone-no-size-aware-routing"),
    "retired candidate is NOT promoted",
  );
  assert.ok(
    r.intercepted.some((x) => x.id === "gap-prepare-milestone-no-size-aware-routing"),
    "retired candidate is intercepted (recorded)",
  );
});


test("--targeted: a retired-mechanism target is not promotable (retired-mechanism reason)", (t) => {
  const root = makeWorkspace("retired-targeted");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  writeTask(root, "gap-prepare-milestone-no-size-aware-routing", gapTask("gap-prepare-milestone-no-size-aware-routing", {
    body: fourArtifactBody({ extra: "\nTarget mechanism: prepare-milestone.js (live).\n" }),
  }));

  const r = analyzeTasks({
    tasksDir: path.join(root, "tasks"),
    root,
    targetedId: "gap-prepare-milestone-no-size-aware-routing",
  });
  assert.equal(r.targeted_promotion.eligible, false, "retired-mechanism target is not promotable");
  assert.match(r.targeted_promotion.reason, /retired-mechanism/);
  assert.equal(r.targeted_promotion.checks.retiredMechanism, true, "the check records retiredMechanism: true");
  assert.ok(
    r.targeted_promotion.checks.retiredRefs.some((ref) => ref.hit === "prepare-milestone.js"),
    "the recorded ref names the deleted script",
  );
});


test("--targeted: a clean target stays promotable (retiredMechanism false in checks)", (t) => {
  const root = makeWorkspace("retired-targeted-clean");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  writeTask(root, "gap-clean-target", gapTask("gap-clean-target"));
  const r = analyzeTasks({ tasksDir: path.join(root, "tasks"), root, targetedId: "gap-clean-target" });
  assert.equal(r.targeted_promotion.eligible, true, "clean target is promotable");
  assert.equal(r.targeted_promotion.checks.retiredMechanism, false, "clean target reports retiredMechanism: false");
  assert.equal(r.targeted_promotion.checks.superseded, false, "clean target reports superseded: false");
});


test("--targeted: a SUPERSEDED target is not promotable (superseded reason)", (t) => {
  // gap-judgepoolcandidate-keyword-vs-position companion: the targeted path now reads the
  // **SUPERSEDED** marker (bulk already did). Without it, a task whose premise a human ruling
  // deleted (e.g. gap-split-decision-finality-not-enforced, superseded 2026-08-12) becomes
  // targeted-promotable once its backticked retired-script mentions are correctly read as quotes.
  const root = makeWorkspace("retired-targeted-superseded");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  writeTask(root, "gap-split-decision-finality-not-enforced", gapTask("gap-split-decision-finality-not-enforced", {
    body: fourArtifactBody({ extra: "\n> **SUPERSEDED / 作废** premise deleted by a human ruling.\n" }),
  }));
  const r = analyzeTasks({ tasksDir: path.join(root, "tasks"), root, targetedId: "gap-split-decision-finality-not-enforced" });
  assert.equal(r.targeted_promotion.eligible, false, "SUPERSEDED target is not promotable");
  assert.match(r.targeted_promotion.reason, /superseded/);
  assert.equal(r.targeted_promotion.checks.superseded, true, "the check records superseded: true");
});


test("CLI smoke: --root emits the intercepted array (empty when no retired candidate)", (t) => {
  const root = makeWorkspace("cli-retired");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  writeTask(root, "gap-r1", { status: "ready", labels: ["gap"], body: fourArtifactBody() });
  const script = path.resolve(__dirname, "..", "scripts", "ready-pool-check.ts");
  const out = execFileSync(process.execPath, ["--experimental-strip-types", script, "--root", root], { encoding: "utf8" });
  const parsed = JSON.parse(out);
  assert.ok(Array.isArray(parsed.intercepted), "intercepted is an array in the CLI output");
  assert.deepEqual(parsed.intercepted, [], "no retired candidate ⇒ empty intercepted array");
});

// ── LANDING-BLOCKED signal (gap-landing-blocked-invisible-to-dispatch-criteria) ─────────────────────
// criterion_met answers "are there ≥cap mutually-disjoint candidates" (touches-conflict graph only —
// grep-verified: ready-pool-check reads NO merge/landing state). slot-refill only measures slot
// release. So criterion_met=True stays True when landing is STRUCTURALLY blocked (AC17 catch-up:
// develop/integration frozen at a stale commit while master has un-migrated commits) — "dispatchable
// visible, landable invisible" (the heartbeat-vs-consciousness instance: the criterion has no basis
// yet still answers). This axis adds landing VISIBILITY: develop behind master ≥ threshold AND the
// merge target (integration) frozen ⇒ reported explicitly, never "has candidates = healthy". AC1
// beyond criterion_met · AC2 the AC17 catch-up scenario observable · AC3 complements
// gap-ready-pool-check-counts-merged (whose notYetFlipped is the "merged-but-not-flipped" heartbeat) ·
// AC4 negative control (normal landing never false-reports). Pure decision (computeLandingBlocked) +
// git-backed (detectLandingBlocked, fail-safe on missing refs).


test("computeLandingBlocked: develop behind master + frozen integration ⇒ landing-blocked (AC2)", () => {
  const stalenessMs = LANDING_STALENESS_MS_DEFAULT;
  const r = computeLandingBlocked({
    developBehindMaster: 62, // the AC17 scenario's un-migrated master commits
    integrationStalenessMs: stalenessMs + 5_000, // frozen beyond the window
    now: 1_000_000,
    stalenessMs,
    behindThreshold: LANDING_BEHIND_THRESHOLD_DEFAULT,
  });
  assert.equal(r.landing_blocked, true, "AC2: catch-up incomplete ⇒ landing-blocked reported");
  assert.match(r.reason, /landing-blocked/);
  assert.match(r.reason, /62 commit/);
  assert.match(r.reason, /catch-up incomplete/);
});


test("computeLandingBlocked: AC4 negative controls — normal landing never false-reports", () => {
  const stalenessMs = LANDING_STALENESS_MS_DEFAULT;
  // develop NOT behind master (master's release role is empty / up-to-date) + stale integration ⇒ NOT blocked.
  assert.equal(
    computeLandingBlocked({ developBehindMaster: 0, integrationStalenessMs: stalenessMs + 1, now: 1_000_000, stalenessMs }).landing_blocked,
    false,
    "develop not behind master ⇒ not blocked",
  );
  // Behind master but integration FRESH (tasks landing on the merge target) ⇒ NOT blocked — landing is
  // not structurally blocked even though catch-up is pending.
  assert.equal(
    computeLandingBlocked({ developBehindMaster: 62, integrationStalenessMs: 60_000, now: 1_000_000, stalenessMs }).landing_blocked,
    false,
    "integration fresh (within window) ⇒ not blocked",
  );
  // Behind below the threshold ⇒ NOT blocked (a single stray master commit is not a catch-up backlog).
  assert.equal(
    computeLandingBlocked({ developBehindMaster: 0, integrationStalenessMs: stalenessMs + 1, now: 1_000_000, stalenessMs, behindThreshold: 1 }).landing_blocked,
    false,
    "below threshold ⇒ not blocked",
  );
  // integrationStalenessMs null (no integration ref — single-line downstream) ⇒ NOT blocked (fail-safe).
  assert.equal(
    computeLandingBlocked({ developBehindMaster: 62, integrationStalenessMs: null, now: 1_000_000, stalenessMs }).landing_blocked,
    false,
    "null staleness (no integration ref) ⇒ not blocked (fail-safe)",
  );
});


test("detectLandingBlocked is fail-safe on a non-git root (no false report, no throw)", (t) => {
  const root = makeWorkspace("lb-nongit");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const r = detectLandingBlocked(root);
  assert.deepEqual(r, { landing_blocked: false, reason: null });
});

// Real-git AC17 catch-up scenario: master advances with un-migrated commits while develop/integration
// stay frozen at the base ⇒ analyzeTasks reports landing_blocked even while criterion_met is True (the
// "dispatchable visible, landable invisible" shape the task is about).
