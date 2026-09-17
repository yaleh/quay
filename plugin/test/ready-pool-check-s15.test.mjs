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

// SPLIT from ready-pool-check.test.mjs by gap-suite-split-15-over-30s-test-files — shard 15/22 (8 tests). Shared fixtures: ./helpers/ready-pool-check-harness.mjs (single source).

import { test } from "node:test";
import { SUITE_BLOCKING_WEIGHT, analyzeTasks, applyPromotions, assert, collectFailureFiles, computeRelevance, computeSuiteBlocking, consecutiveRedRounds, countUnattributedFailures, exemptFromSuiteBlocking, fourArtifactBody, fs, gapTask, isRedRound, isSuiteFixTask, makeWorkspace, parseTask, path, writeTask } from "./helpers/ready-pool-check-harness.mjs";

test("applyPromotions: a non-delivery-critical candidate is promoted WITHOUT the label (AC1 negative control)", (t) => {
  const root = makeWorkspace("apply-dc-neg");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  writeTask(root, "gap-r1", { status: "ready", labels: ["gap"], body: fourArtifactBody() });
  writeTask(root, "gap-r2", { status: "ready", labels: ["gap"], body: fourArtifactBody() });
  writeTask(root, "gap-plain", gapTask("gap-plain"));

  const opts = { tasksDir: path.join(root, "tasks"), root, cap: 3, floorMult: 1 }; // floor 3, pool 2
  const r = applyPromotions(opts);
  assert.equal(r.applied_promotions.length, 1);
  assert.equal(r.applied_promotions[0].deliveryCritical, false, "no determination for an unlabeled candidate");

  const task = parseTask(fs.readFileSync(path.join(root, "tasks", "gap-plain.md"), "utf8"));
  assert.match(task.frontmatterRaw, /^status:\s*ready$/m);
  assert.ok(!task.labels.includes("delivery-critical"), "no label invented — negative control");
});

// ── Suite-blocking signal (tasks/gap-ready-relevance-blind-to-suite-blocking-signal) ────────────────
// AC2: computeRelevance reads the consecutive-red window (verification-round.jsonl ≥ N consecutive
//   red rounds) + the failure detail (full-suite-state.json failures[] / per-round failures) mapped
//   onto a task's declared ## Touches ⇒ blocking dynamically true / blocking_suite true / value +
//   SUITE_BLOCKING_WEIGHT. AC3: a suite-blocking task ranks FIRST in ready_relevance (and slot-refill
//   recommended — asserted in slot-refill.test.mjs). AC4 negative control: no red window / no failure
//   hit ⇒ ordering byte-identical. AC5: the obligation shape is recorded in the obligation ledger in
//   mechanically-checkable JSONL form.

/** AC84 (gap-ac84-suite-source-starvation-reader-disposition AC2): analyzeTasks's suite-blocking now
 *  reads per-task-suite-records.jsonl — the ONLY ongoing suite source after AC84 (verification-round
 *  is NO LONGER a throttling input; full-suite-state.json has no writer). This helper writes the
 *  per-task-suite-record shape (taskId/runId/state/laneCount/failedFiles/fullSuiteRan), converting the
 *  round-shaped fixture rows ({round,state,reason,fail,failures}) into it. Every fixture row is a REAL
 *  full-suite result (fullSuiteRan:true) — a green row breaks the window, a red row counts. */


test("consecutiveRedRounds / isRedRound / collectFailureFiles window detection (AC2)", () => {
  // canonical red rounds (state:red, reason:failed) + an aborted round in the middle — the abort is
  // STILL red (the suite is not green), so it does not break the consecutive window.
  const rounds = [
    { round: 192, state: "red", reason: "failed", fail: 1, failures: [{ file: "code/wd.ts", line: "x" }] },
    { round: 193, state: "red", reason: "failed", fail: 1, failures: [{ file: "code/wd.ts", line: "x" }] },
    { round: 194, state: "red", reason: "aborted", fail: 0 },
    { round: 195, state: "red", reason: "failed", fail: 1, failures: [{ file: "code/wd.ts", line: "x" }] },
    { round: 196, state: "red", reason: "failed", fail: 1, failures: [{ file: "code/wd.ts", line: "x" }] },
  ];
  assert.equal(isRedRound(rounds[0]), true, "canonical red ⇒ red");
  assert.equal(isRedRound(rounds[2]), true, "aborted is still red (suite not green)");
  assert.equal(isRedRound({ state: "green", fail: 0 }), false, "green ⇒ not red");
  assert.equal(isRedRound({ state: "green", fail: 0, reason: "failed" }), false, "green with fail 0 stays green");
  assert.equal(isRedRound({ fail: 1 }), true, "legacy row (no state, fail>0) ⇒ red");
  assert.equal(isRedRound({ fail: 0 }), false, "legacy row (no state, fail=0) ⇒ not red");
  assert.equal(consecutiveRedRounds(rounds), 5, "aborted in the middle does not break the red window");
  assert.equal(consecutiveRedRounds([...rounds, { round: 197, state: "green", fail: 0 }]), 0, "green last round resets the window");
  assert.equal(consecutiveRedRounds([]), 0);
  assert.equal(consecutiveRedRounds([{ round: 1, state: "red", reason: "failed" }]), 1);
  assert.deepEqual(collectFailureFiles(rounds, []), ["code/wd.ts"], "per-round failures collected");
  assert.deepEqual(collectFailureFiles(rounds, [{ file: "code/other.ts" }]), ["code/wd.ts", "code/other.ts"], "state failures unioned in");
});


test("AC5 — collectFailureFiles slices to the CURRENT red window, not all history (gap-streaming-red-cascade-amplifies-failures-array: 239 → ~12 negative control)", () => {
  // The pre-fix defect: the Set only grew across ALL red rounds — a task touching ANY historical
  // failing file was blocked ("touched any history", not "touches the current red cause"), tightening
  // monotonically until the pool locked. windowSize = consecutiveRed slices to the current window.
  const rounds = [
    // 200 historical red rounds with an old failure file
    ...Array.from({ length: 200 }, (_, i) => ({ round: 100 + i, state: "red", reason: "failed", failures: [{ file: "code/old.ts" }] })),
    // the current 3-round red window with the CURRENT failure file
    { round: 300, state: "red", reason: "failed", failures: [{ file: "code/current.ts" }] },
    { round: 301, state: "red", reason: "failed", failures: [{ file: "code/current.ts" }] },
    { round: 302, state: "red", reason: "failed", failures: [{ file: "code/current.ts" }] },
  ];
  // no windowSize ⇒ all history (the pre-fix behavior)
  assert.deepEqual(collectFailureFiles(rounds, []), ["code/old.ts", "code/current.ts"], "no window ⇒ all history");
  // windowSize = 3 (the current consecutive-red count) ⇒ only the current window's file
  assert.deepEqual(collectFailureFiles(rounds, [], 3), ["code/current.ts"], "window-sliced ⇒ current red cause only (the 239→~12 negative control)");
  assert.deepEqual(collectFailureFiles(rounds, [], 1), ["code/current.ts"], "a 1-round window still resolves the latest file");
});


test("AC6 — countUnattributedFailures counts no-file entries that collectFailureFiles must drop (30% round-130 drop rate → explicit)", () => {
  // Round 130 shape: 10 failures = 3 real (file) + 4 cascade + 3 no-file. The no-file entries are
  // structurally un-attributable to a task's Touches — but they must be COUNTED, not silently dropped.
  const rounds = [
    { round: 400, state: "red", reason: "failed",
      failures: [
        { file: "plugin/test/checker-cost.test.mjs" },
        { line: "✖ AC2 — ready-pool-check run 3x ... (no file)" },
        { line: "✖ AC1 — while the suite runs ... (no file)" },
      ],
      unattributed: [{ line: "✖ AC1 — while the suite runs ... (no file, mirror)" }],
    },
    { round: 401, state: "red", reason: "failed", failures: [{ file: "plugin/test/checker-cost.test.mjs" }] },
    { round: 402, state: "red", reason: "failed", failures: [{ file: "plugin/test/checker-cost.test.mjs" }] },
  ];
  // no-file in failures[] + unattributed[] segments of the CURRENT 3-round window:
  // round 400 has 2 no-file in failures[] + 1 in unattributed[] = 3 (rounds 401/402 all have files).
  assert.equal(countUnattributedFailures(rounds, [], [], 3), 3, "no-file entries counted (failures[] + unattributed[]), current window only");
  // state-level failures[] + unattributed[] feed the count too. A derived cascade entry (which HAS a
  // file) is NOT a no-file entry and is NOT counted here — it is listed in the state's `derived` field
  // instead (AC1) and excluded from failureFiles by construction.
  assert.equal(countUnattributedFailures(rounds, [{ line: "state no-file" }], [{ line: "state unattributed" }], 3),
    5, "state failures + unattributed no-file entries counted (3 round + 2 state)");
  // no windowSize ⇒ all rounds (backward-compatible behavior).
  assert.equal(countUnattributedFailures(rounds, [], [], undefined), 3);
});


test("AC2 — collectFailureFiles BOUNDS the state union to the current window (gap-full-suite-state-stale-no-writer: a stale state's failures are NOT injected forever)", () => {
  // The state file is a SINGLE-STATE file. When its writer is absent (the detached fan-in suite never
  // went through full-suite-runner.ts) it FREEZES at an old red's failures[] — the pre-fix unbounded
  // union injected those into every later suite-blocking computation with no expiry ("touched a
  // HISTORICAL failing file", not "touches the current red cause"). The fix: merge the state's
  // failures only when the state's own round falls INSIDE the current window (startedAt ≥ the window's
  // oldest round's startedAt).
  const rounds = [
    // the CURRENT 3-round red window (t200..t202) with the CURRENT failure file
    { round: 200, state: "red", reason: "failed", startedAt: "2026-08-18T00:00:00.000Z", failures: [{ file: "code/current.ts" }] },
    { round: 201, state: "red", reason: "failed", startedAt: "2026-08-18T00:05:00.000Z", failures: [{ file: "code/current.ts" }] },
    { round: 202, state: "red", reason: "failed", startedAt: "2026-08-18T00:10:00.000Z", failures: [{ file: "code/current.ts" }] },
  ];
  const staleFailures = [{ file: "code/stale.ts" }];

  // negative control: a STALE state (startedAt older than the whole window) is NOT unioned.
  assert.deepEqual(
    collectFailureFiles(rounds, staleFailures, 3, "2026-08-17T23:00:00.000Z"),
    ["code/current.ts"],
    "stale state (older than the window) is EXCLUDED — its failures are not injected",
  );
  // positive control: a state whose round is INSIDE the window (≥ the oldest round) IS unioned.
  assert.deepEqual(
    collectFailureFiles(rounds, staleFailures, 3, "2026-08-18T00:00:00.000Z"),
    ["code/current.ts", "code/stale.ts"],
    "in-window state (≥ the window's oldest round) IS unioned",
  );
  // backward compat: no stateStartedAt ⇒ unconditional union (the pre-fix behavior for unknown state).
  assert.deepEqual(
    collectFailureFiles(rounds, staleFailures, 3),
    ["code/current.ts", "code/stale.ts"],
    "no state timestamp ⇒ backward-compat unconditional union",
  );
  // no window ⇒ all-history (backward-compat), regardless of stateStartedAt.
  assert.deepEqual(
    collectFailureFiles(rounds, staleFailures, undefined, "2026-08-17T23:00:00.000Z"),
    ["code/current.ts", "code/stale.ts"],
    "no window ⇒ all-history union (stateStartedAt ignored)",
  );
  // the SAME bound on the no-file count (countUnattributedFailures).
  assert.equal(
    countUnattributedFailures(rounds, [{ line: "state no-file" }], [], 3, "2026-08-17T23:00:00.000Z"),
    0,
    "stale state no-file entries are NOT counted either (same defect class, same bound)",
  );
  assert.equal(
    countUnattributedFailures(rounds, [{ line: "state no-file" }], [], 3, "2026-08-18T00:00:00.000Z"),
    1,
    "in-window state no-file entries ARE counted",
  );
});


test("computeSuiteBlocking: red window + Touches hit ⇒ task flagged; negative controls (AC2/AC4)", () => {
  const tasks = new Map([
    ["gap-watchdog", { status: "ready", body: "## Touches\n- code/wd.ts" }],
    ["gap-plain", { status: "ready", body: "## Touches\n- code/plain.ts" }],
    ["gap-done-wd", { status: "done", body: "## Touches\n- code/wd.ts" }], // landed work — never re-prioritized
  ]);
  const expand = (globs) => new Set(globs); // concrete declared paths resolve to themselves

  const redRounds = Array.from({ length: 3 }, (_, i) => ({ round: 200 + i, state: "red", reason: "failed", failures: [{ file: "code/wd.ts" }] }));
  const r = computeSuiteBlocking({ rounds: redRounds, stateFailures: [], tasks, expand });
  assert.equal(r.consecutiveRed, 3);
  assert.equal(r.windowActive, true);
  assert.ok(r.ids.has("gap-watchdog"), "failure file hits the watchdog task's Touches ⇒ flagged");
  assert.ok(!r.ids.has("gap-plain"), "unrelated task not flagged");
  assert.ok(!r.ids.has("gap-done-wd"), "a done task (work already landed) is never suite-blocking");

  // negative: only 2 consecutive red rounds (below the default min 3) ⇒ nothing flagged.
  const short = computeSuiteBlocking({ rounds: redRounds.slice(0, 2), stateFailures: [], tasks, expand });
  assert.equal(short.windowActive, false);
  assert.equal(short.ids.size, 0, "below-min window ⇒ no suite-blocking");

  // negative: 3 red rounds but the failure points at an untouched file ⇒ nothing flagged.
  const unrelated = computeSuiteBlocking({
    rounds: Array.from({ length: 3 }, () => ({ state: "red", reason: "failed", failures: [{ file: "code/unrelated.ts" }] })),
    stateFailures: [],
    tasks,
    expand,
  });
  assert.equal(unrelated.windowActive, true);
  assert.equal(unrelated.ids.size, 0, "failure file hits nobody's Touches ⇒ nothing flagged");

  // negative: 3 red rounds but NO failure detail anywhere ⇒ window active, no attribution.
  const noFail = computeSuiteBlocking({ rounds: Array.from({ length: 3 }, () => ({ state: "red", reason: "failed" })), stateFailures: [], tasks, expand });
  assert.equal(noFail.windowActive, true);
  assert.equal(noFail.ids.size, 0);

  // negative: last round green resets the window ⇒ nothing flagged.
  const green = computeSuiteBlocking({ rounds: [...redRounds, { round: 203, state: "green" }], stateFailures: [], tasks, expand });
  assert.equal(green.windowActive, false);
  assert.equal(green.ids.size, 0);
});


test("computeSuiteBlocking: round-record failures attribute cross-round + bare-basename shape normalized (AC3 — gap-suite-round-record-missing-failures-field)", () => {
  const tasks = new Map([
    ["gap-script", { status: "ready", body: "## Touches\n- plugin/scripts/send-keys-verified.sh" }],
    ["gap-other", { status: "ready", body: "## Touches\n- plugin/scripts/unrelated.ts" }],
  ]);
  const expand = (globs) => new Set(globs); // concrete declared paths resolve to themselves

  // round-210 carries a BARE BASENAME (`send-keys-verified.sh`), round-212 a REPO-RELATIVE path —
  // the exact shape inconsistency the task notes. BOTH must attribute the same full-path touch.
  const mixedRounds = [
    { round: 210, state: "red", reason: "failed", failures: [{ file: "send-keys-verified.sh" }] },
    { round: 211, state: "red", reason: "failed", failures: [{ file: "send-keys-verified.sh" }] },
    { round: 212, state: "red", reason: "failed", failures: [{ file: "plugin/scripts/send-keys-verified.sh" }] },
  ];
  const r = computeSuiteBlocking({ rounds: mixedRounds, stateFailures: [], tasks, expand });
  assert.equal(r.consecutiveRed, 3);
  assert.equal(r.windowActive, true);
  assert.ok(r.ids.has("gap-script"), "bare-basename failure file attributes to the full-path touch (round-210 form normalized)");
  assert.ok(!r.ids.has("gap-other"), "unrelated task not flagged");

  // Two FULL repo-relative paths sharing only a basename must NOT over-attribute (a/foo.ts vs b/foo.ts).
  const dirTasks = new Map([
    ["gap-a", { status: "ready", body: "## Touches\n- a/foo.ts" }],
    ["gap-b", { status: "ready", body: "## Touches\n- b/foo.ts" }],
  ]);
  const fullPathRounds = Array.from({ length: 3 }, () => ({ state: "red", reason: "failed", failures: [{ file: "a/foo.ts" }] }));
  const r2 = computeSuiteBlocking({ rounds: fullPathRounds, stateFailures: [], tasks: dirTasks, expand });
  assert.ok(r2.ids.has("gap-a"), "exact full-path match attributes");
  assert.ok(!r2.ids.has("gap-b"), "same basename in a different directory does NOT over-attribute a full-path failure");

  // Cross-round attribution: the failure detail lives ONLY in an OLD round (round-208); the two
  // LATER rounds carry no failures. The red window must still attribute via the old round's record
  // (the task's whole point — historical rounds attributable, not just the current state file).
  const crossRound = [
    { round: 208, state: "red", reason: "failed", failures: [{ file: "plugin/scripts/send-keys-verified.sh" }] },
    { round: 209, state: "red", reason: "failed" },
    { round: 210, state: "red", reason: "failed" },
  ];
  const r3 = computeSuiteBlocking({ rounds: crossRound, stateFailures: [], tasks, expand });
  assert.equal(r3.consecutiveRed, 3);
  assert.ok(r3.ids.has("gap-script"), "an old round's recorded failure attributes across the red window (round-record reverse-lookup)");
});


test("exemptFromSuiteBlocking / isSuiteFixTask: suite-fix marker + failure-hit AND-gate (AC2/AC3 reverse control)", () => {
  const suiteFixTask = {
    id: "gap-install-family-tests",
    frontmatterRaw: "id: gap-install-family-tests\ntitle: install family flake rotate under full-suite\nstatus: ready",
    body: "## Proposal\nfix the install-family suite flake — this task IS the suite fix.\n## Touches\n- plugin/test/install-family.test.mjs",
  };
  const serialInstall = {
    id: "gap-serial-phase-install-test-residue",
    frontmatterRaw: "id: gap-serial-phase-install-test-residue\ntitle: serial phase install test residue dependency\nstatus: ready",
    body: "## Proposal\nserial phase install residue — fix the ordering dependency.\n## Touches\n- plugin/test/serial-install.test.mjs",
  };
  // unrelated: no marker anywhere (id/title/Proposal) — a "fixture" title must NOT read as fix-intent,
  // and a Proposal that merely MENTIONS the suite (no fix-intent co-occurrence) must NOT exempt either
  // (the AC3 over-exemption case the end-to-end demo caught).
  const unrelated = {
    id: "gap-watchdog",
    frontmatterRaw: "id: gap-watchdog\ntitle: fixture gap-watchdog\nstatus: ready",
    body: "## Proposal\nwatch the dispatch pool and report health — nothing to do with the suite.\n## Touches\n- plugin/scripts/ready-pool-check.ts",
  };

  // AC2: the suite-fix family self-identifies (id + title carry install/suite).
  assert.equal(isSuiteFixTask(suiteFixTask, "gap-install-family-tests"), true, "gap-install-family id/title marker ⇒ suite-fix task");
  assert.equal(isSuiteFixTask(serialInstall, "gap-serial-phase-install-test-residue"), true, "gap-serial-phase-install id marker ⇒ suite-fix task");
  // AC3 reverse control: the unrelated task (no marker — "fixture" is NOT fix-intent) is NOT suite-fix.
  assert.equal(isSuiteFixTask(unrelated, "gap-watchdog"), false, "unrelated task carries no marker (fixture ≠ fix)");

  // The exemption is a TWO-condition AND: marker AND failure-hit. Both must hold.
  assert.equal(exemptFromSuiteBlocking(suiteFixTask, "gap-install-family-tests", true), true, "suite-fix task + real failure-hit ⇒ exempt (dispatchable)");
  assert.equal(exemptFromSuiteBlocking(serialInstall, "gap-serial-phase-install-test-residue", true), true, "serial-phase-install + failure-hit ⇒ exempt");
  assert.equal(exemptFromSuiteBlocking(unrelated, "gap-watchdog", true), false, "unrelated task + failure-hit ⇒ NOT exempt (stays blocked)");
  assert.equal(exemptFromSuiteBlocking(suiteFixTask, "gap-install-family-tests", false), false, "marker alone (no failure-hit) never exempts — not the one fixing THIS red");
});
