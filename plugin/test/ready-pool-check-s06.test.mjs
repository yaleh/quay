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

// SPLIT from ready-pool-check.test.mjs by gap-suite-split-15-over-30s-test-files — shard 6/13 (14 tests). Shared fixtures: ./helpers/ready-pool-check-harness.mjs (single source).

import { test } from "node:test";
import { LANDING_BEHIND_THRESHOLD_DEFAULT, LANDING_STALENESS_MS_DEFAULT, __dirname, analyzeTasks, assert, computeLandingBlocked, detectLandingBlocked, execFileSync, fourArtifactBody, fs, gapTask, makeWorkspace, notYetFlipped, os, path, writeTask } from "./helpers/ready-pool-check-harness.mjs";

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


test("analyzeTasks: AC17 catch-up — criterion_met True AND landing_blocked True reported explicitly (AC1/AC2)", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `ready-pool-lb-${Date.now()}-`));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, "tasks"), { recursive: true });
  fs.mkdirSync(path.join(root, "code"), { recursive: true });
  const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  git("init", "-b", "master", "-q", ".");
  git("config", "user.email", "test@example.com");
  git("config", "user.name", "Test");
  fs.writeFileSync(path.join(root, ".gitkeep"), "base\n");
  git("add", ".");
  git("commit", "-q", "-m", "base");
  const baseEpochSec = Number(git("log", "-1", "--format=%ct"));
  git("checkout", "-q", "-b", "develop");
  git("checkout", "-q", "-b", "integration");
  git("checkout", "-q", "master");
  // master advances with un-migrated commits (the AC17 catch-up backlog) — develop/integration frozen.
  for (let i = 0; i < 3; i++) {
    fs.writeFileSync(path.join(root, `m${i}.txt`), `m${i}\n`);
    git("add", ".");
    git("commit", "-q", "-m", `master commit ${i}`);
  }
  // Three pairwise-disjoint ready tasks ⇒ dispatchable_disjoint ≥ cap ⇒ criterion_met True (the
  // "dispatchable visible" half) — yet landing is structurally blocked.
  writeTask(root, "gap-r1", { status: "ready", labels: ["gap"], body: fourArtifactBody({ touches: ["- code/a.ts"] }) });
  writeTask(root, "gap-r2", { status: "ready", labels: ["gap"], body: fourArtifactBody({ touches: ["- code/b.ts"] }) });
  writeTask(root, "gap-r3", { status: "ready", labels: ["gap"], body: fourArtifactBody({ touches: ["- code/c.ts"] }) });

  const r = analyzeTasks({
    tasksDir: path.join(root, "tasks"),
    root,
    cap: 3,
    floorMult: 1, // floor 3 — pool 3 ≥ floor, no promotion noise
    now: baseEpochSec * 1000 + 3 * 60 * 60 * 1000, // 3h after base — integration frozen past the 2h window
    landingStalenessMs: LANDING_STALENESS_MS_DEFAULT, // 2h
    landingBehindThreshold: LANDING_BEHIND_THRESHOLD_DEFAULT,
  });
  assert.equal(r.criterion_met, true, "dispatchable candidates exist (the old visibility)");
  assert.equal(r.landing_blocked, true, "AC2: catch-up incomplete ⇒ landing-blocked reported");
  assert.match(r.report, /landing-blocked/);
  assert.match(r.landing_blocked_reason, /3 commit/);
});


test("analyzeTasks: AC4 negative — normal landing (integration advancing) ⇒ no landing-blocked false report", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `ready-pool-lbn-${Date.now()}-`));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, "tasks"), { recursive: true });
  fs.mkdirSync(path.join(root, "code"), { recursive: true });
  const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  git("init", "-b", "master", "-q", ".");
  git("config", "user.email", "test@example.com");
  git("config", "user.name", "Test");
  fs.writeFileSync(path.join(root, ".gitkeep"), "base\n");
  git("add", ".");
  git("commit", "-q", "-m", "base");
  const baseEpochSec = Number(git("log", "-1", "--format=%ct"));
  git("checkout", "-q", "-b", "develop");
  git("checkout", "-q", "-b", "integration");
  git("checkout", "-q", "master");
  for (let i = 0; i < 3; i++) {
    fs.writeFileSync(path.join(root, `m${i}.txt`), `m${i}\n`);
    git("add", ".");
    git("commit", "-q", "-m", `master commit ${i}`);
  }
  // integration keeps advancing — a task lands on it (normal landing, NOT structurally blocked).
  git("checkout", "-q", "integration");
  fs.writeFileSync(path.join(root, "task.txt"), "task\n");
  git("add", ".");
  git("commit", "-q", "-m", "Merge branch 'task/gap-r1'");
  const intEpochSec = Number(git("log", "-1", "--format=%ct"));
  writeTask(root, "gap-r1", { status: "ready", labels: ["gap"], body: fourArtifactBody({ touches: ["- code/a.ts"] }) });
  writeTask(root, "gap-r2", { status: "ready", labels: ["gap"], body: fourArtifactBody({ touches: ["- code/b.ts"] }) });
  writeTask(root, "gap-r3", { status: "ready", labels: ["gap"], body: fourArtifactBody({ touches: ["- code/c.ts"] }) });

  const r = analyzeTasks({
    tasksDir: path.join(root, "tasks"),
    root,
    cap: 3,
    floorMult: 1,
    now: intEpochSec * 1000 + 30 * 60 * 1000, // 30 min after the last integration commit — NOT frozen
    landingStalenessMs: LANDING_STALENESS_MS_DEFAULT, // 2h window
    landingBehindThreshold: LANDING_BEHIND_THRESHOLD_DEFAULT,
  });
  assert.equal(r.criterion_met, true, "dispatch still healthy");
  assert.equal(r.landing_blocked, false, "AC4: normal landing (integration fresh) ⇒ no false report");
  assert.doesNotMatch(r.report, /landing-blocked/);
});
