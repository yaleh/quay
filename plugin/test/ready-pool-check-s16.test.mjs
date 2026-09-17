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

// SPLIT from ready-pool-check.test.mjs by gap-suite-split-15-over-30s-test-files — shard 16/22 (8 tests). Shared fixtures: ./helpers/ready-pool-check-harness.mjs (single source).

import { test } from "node:test";
import { BLOCKING_WEIGHT, SUITE_BLOCKING_WEIGHT, assert, collectFailureFiles, computeRelevance, computeSuiteBlocking, consecutiveRedRounds, deriveDefaultLane, isDirectoryGlob, isExperimentRound } from "./helpers/ready-pool-check-harness.mjs";

test("computeSuiteBlocking: controlled-experiment round (laneCount ≠ default) excluded from consecutive-red (AC2/AC3 — gap-suite-blocking-experiment-rounds-count-toward-consecutive-red)", () => {
  // r268 was a one-off CONTROLLED EXPERIMENT (lane-8 comparison, --lane-count 8 vs the nproc-derived
  // default 4): its red is an experiment finding, not a regression — it must not push the consecutive-
  // red window. Mechanically identifiable: laneCount ≠ defaultLane. The `defaultLane` fixture default
  // (4) is hermetic — host-nproc independent; the experiment lane 8 is the r268 shape.
  const defaultLane = 4;
  const expLane = 8;
  const tasks = new Map([
    ["gap-wd", { status: "ready", body: "## Touches\n- code/wd.ts" }],
  ]);
  const expand = (globs) => new Set(globs);

  // isExperimentRound predicate: only an EXPLICIT non-default laneCount marks an experiment round.
  assert.equal(isExperimentRound({ state: "red", laneCount: expLane }, defaultLane), true, "laneCount ≠ default ⇒ experiment round");
  assert.equal(isExperimentRound({ state: "red", laneCount: defaultLane }, defaultLane), false, "laneCount === default ⇒ real round");
  assert.equal(isExperimentRound({ state: "red" }, defaultLane), false, "no laneCount (legacy row) ⇒ NOT an experiment round — keeps counting");

  // AC2: [experiment red, real red, real red] ⇒ consecutive_red = 2 (the experiment round does not
  // count) and the window (min 3) does NOT activate — the r268 lane-8 probe no longer pushes it to
  // activation (the r268+r269+r270 ⇒ 3-window self-lock case becomes r269+r270 ⇒ 2).
  const mixed = computeSuiteBlocking({
    rounds: [
      { round: 268, state: "red", reason: "failed", laneCount: expLane, failures: [{ file: "code/exp.ts" }] },
      { round: 269, state: "red", reason: "failed", laneCount: defaultLane, failures: [{ file: "code/wd.ts" }] },
      { round: 270, state: "red", reason: "failed", laneCount: defaultLane, failures: [{ file: "code/wd.ts" }] },
    ],
    stateFailures: [],
    tasks,
    expand,
    minRedWindow: 3,
    defaultLane,
  });
  assert.equal(mixed.consecutiveRed, 2, "[exp, real, real] ⇒ consecutive_red = 2 (experiment round excluded from the count)");
  assert.equal(mixed.windowActive, false, "2 < min 3 ⇒ window NOT active (the r268 case: self-lock released)");

  // AC3 negative-control shape: [real ×3] (all default lane) still counts 3 and activates the window.
  const real3 = computeSuiteBlocking({
    rounds: Array.from({ length: 3 }, (_, i) => ({ round: 271 + i, state: "red", reason: "failed", laneCount: defaultLane, failures: [{ file: "code/wd.ts" }] })),
    stateFailures: [],
    tasks,
    expand,
    minRedWindow: 3,
    defaultLane,
  });
  assert.equal(real3.consecutiveRed, 3, "[real ×3] ⇒ 3 (default-lane real reds still accumulate)");
  assert.equal(real3.windowActive, true);
  assert.ok(real3.ids.has("gap-wd"), "a real-red window still attributes the failure to the Touches-hitting task");

  // "skip" semantics pinned: an experiment round in the MIDDLE of real reds is transparent — it
  // neither counts nor breaks the window (the same rounds with a genuine green would reset to 0).
  const middle = computeSuiteBlocking({
    rounds: [
      { round: 275, state: "red", reason: "failed", laneCount: defaultLane, failures: [{ file: "code/wd.ts" }] },
      { round: 276, state: "red", reason: "failed", laneCount: expLane, failures: [{ file: "code/exp.ts" }] },
      { round: 277, state: "red", reason: "failed", laneCount: defaultLane, failures: [{ file: "code/wd.ts" }] },
    ],
    stateFailures: [],
    tasks,
    expand,
    minRedWindow: 3,
    defaultLane,
  });
  assert.equal(middle.consecutiveRed, 2, "experiment round in the middle is transparent (neither counts nor breaks)");
});


test("AC1 — deriveDefaultLane: the reference default is the runner's ACTUAL normal lane (mode of recorded laneCounts), not the checker's env (gap-ac84-suite-source-starvation-reader-disposition)", () => {
  // The defect: the checker's env derived defaultLaneCount()=8 while the runner ACTUALLY recorded
  // laneCount=16 (QUAY_MAX_OVERSUBSCRIPTION=2 at runner time vs 1 at checker time) ⇒ every normal
  // round looked like an experiment ⇒ consecutiveRed 恒 0. The fix derives the reference from the
  // records themselves — the MODE laneCount is what the runner used for its typical rounds.
  assert.equal(deriveDefaultLane([], 8), 8, "no records ⇒ fallback (the env-derived default)");
  assert.equal(deriveDefaultLane([{ state: "red", laneCount: 16 }, { state: "red", laneCount: 16 }, { state: "red", laneCount: 8 }], 8), 16,
    "mode of recorded laneCounts (16 appears twice) ⇒ 16 — the runner's actual normal lane");
  assert.equal(deriveDefaultLane([{ state: "red", laneCount: 8 }], 8), 8, "single lane ⇒ itself");
  // A doc-only SKIP (fullSuiteRan === false, laneCount ~1) is NOT a lane observation — no full suite ran.
  assert.equal(deriveDefaultLane([{ state: "green", laneCount: 16 }, { state: "green", laneCount: 16 }, { state: "green", laneCount: 1, fullSuiteRan: false }], 8), 16,
    "skip records do not pollute the mode");
  assert.equal(deriveDefaultLane([{ state: "green", fullSuiteRan: false }, { state: "green", fullSuiteRan: false }], 8), 8,
    "only skips ⇒ fallback");
  // A record with NO laneCount (legacy verification-round row) contributes nothing.
  assert.equal(deriveDefaultLane([{ state: "red" }, { state: "red", laneCount: 16 }], 8), 16, "legacy no-laneCount row contributes nothing");
});


test("AC1 — computeSuiteBlocking without explicit defaultLane derives the runner's actual lane (16): consecutiveRed is NON-ZERO and the window CAN activate; forced env default (8) keeps it 恒 0 (gap-ac84-suite-source-starvation-reader-disposition)", () => {
  // The real-repo shape: the runner records laneCount=16 for its normal rounds; the phantom tail is
  // 5 consecutive red rounds (rounds 208-212). With the checker's env-derived default (8) every normal
  // round was an experiment ⇒ consecutiveRed 0 / window_active false (structural failure since round
  // 24). After the fix (no explicit defaultLane ⇒ derive mode=16) the red tail counts.
  const tasks = new Map([
    ["gap-wd", { status: "ready", body: "## Touches\n- code/wd.ts" }],
  ]);
  const expand = (globs) => new Set(globs);
  const rounds = Array.from({ length: 5 }, (_, i) => ({ round: 208 + i, state: "red", reason: "failed", laneCount: 16, failures: [{ file: "code/wd.ts" }] }));

  // FIXED: no explicit defaultLane ⇒ derive the runner's actual normal lane (16) from the records.
  const fixed = computeSuiteBlocking({ rounds, stateFailures: [], tasks, expand, minRedWindow: 3 });
  assert.equal(fixed.consecutiveRed, 5, "AC1: default aligned to the runner's actual lane ⇒ consecutiveRed non-zero (the red tail counts)");
  assert.equal(fixed.windowActive, true, "AC1: window_active CAN become true");
  assert.deepEqual(fixed.ids.has("gap-wd") ? [...fixed.ids] : [], ["gap-wd"], "the red window attributes the failure to the Touches-hitting task");

  // DEFECT CONTROL: the OLD behavior — the checker's env default (8) forced explicitly — still
  // misclassifies every lane-16 round as an experiment ⇒ consecutiveRed 恒 0 / window inactive.
  const defect = computeSuiteBlocking({ rounds, stateFailures: [], tasks, expand, minRedWindow: 3, defaultLane: 8 });
  assert.equal(defect.consecutiveRed, 0, "control: forced env default (8) ⇒ consecutiveRed 0 — the pre-fix 恒 0 shape");
  assert.equal(defect.windowActive, false, "control: window stays inactive under the wrong default");
});


test("AC2 — per-task-suite-record red window: failedFiles attribute, green full-suite breaks, doc-only skip is NEUTRAL (gap-ac84-suite-source-starvation-reader-disposition)", () => {
  const tasks = new Map([
    ["gap-wd", { status: "ready", body: "## Touches\n- code/wd.ts" }],
  ]);
  const expand = (globs) => new Set(globs);
  // A per-task red record carries failedFiles (array of file strings), NOT the verification-round
  // `failures` ({file}) shape — collectFailureFiles must normalize BOTH.
  const red = computeSuiteBlocking({
    rounds: [
      { taskId: "t1", runId: "r1", state: "red", laneCount: 16, failedFiles: ["code/wd.ts"], fullSuiteRan: true },
      { taskId: "t2", runId: "r2", state: "red", laneCount: 16, failedFiles: ["code/wd.ts"], fullSuiteRan: true },
      { taskId: "t3", runId: "r3", state: "red", laneCount: 16, failedFiles: ["code/wd.ts"], fullSuiteRan: true },
    ],
    stateFailures: [],
    tasks,
    expand,
    minRedWindow: 3,
  });
  assert.equal(red.consecutiveRed, 3, "per-task red records count (failedFiles normalized)");
  assert.equal(red.windowActive, true);
  assert.deepEqual(red.failureFiles, ["code/wd.ts"], "failedFiles feed the failure-file set");
  assert.deepEqual(red.ids.has("gap-wd") ? [...red.ids] : [], ["gap-wd"], "per-task red window attributes via failedFiles");

  // A doc-only SKIP (fullSuiteRan === false — no full suite ran) is NEUTRAL: it must NOT break a red
  // window (a green skip says nothing about the suite), and must NOT add a red.
  const skip = computeSuiteBlocking({
    rounds: [
      { taskId: "t1", runId: "r1", state: "red", laneCount: 16, failedFiles: ["code/wd.ts"], fullSuiteRan: true },
      { taskId: "t2", runId: "r2", state: "red", laneCount: 16, failedFiles: ["code/wd.ts"], fullSuiteRan: true },
      { taskId: "t3", runId: "r3", state: "green", laneCount: 1, failedFiles: [], fullSuiteRan: false, skipReason: "doc-only-delta" },
    ],
    stateFailures: [],
    tasks,
    expand,
    minRedWindow: 3,
  });
  assert.equal(skip.consecutiveRed, 2, "a trailing doc-only skip neither counts nor breaks the red window (still 2 red)");
  assert.equal(skip.windowActive, false, "2 < min 3 ⇒ window stays inactive");

  // A GREEN full-suite record (fullSuiteRan:true) DOES break the window.
  const green = computeSuiteBlocking({
    rounds: [
      { taskId: "t1", runId: "r1", state: "red", laneCount: 16, failedFiles: ["code/wd.ts"], fullSuiteRan: true },
      { taskId: "t2", runId: "r2", state: "green", laneCount: 16, failedFiles: [], fullSuiteRan: true },
    ],
    stateFailures: [],
    tasks,
    expand,
    minRedWindow: 3,
  });
  assert.equal(green.consecutiveRed, 0, "a green full-suite record breaks the window");
  assert.equal(green.windowActive, false);
});


test("AC2 — consecutiveRedRounds on CONTROLLED per-task-suite records (fixture, not real ledger): all-green ⇒ 0; doc-only neutral; green breaks (gap-ready-pool-canary-test-isolation)", () => {
  // gap-ready-pool-canary-test-isolation: the previous version read the REAL shared ledger
  // (.quay/per-task-suite-records.jsonl) and hard-asserted consecutiveRed === 0 — a production-state
  // canary that breaks whenever the ledger contains INTERMEDIATE red records (a fan-in's first attempt
  // red, later green landing). The real ledger legitimately accumulates those, so the assertion was
  // stale (test-isolation defect — a test reading shared mutable production state). This fixture-based
  // version verifies the LOGIC with controlled inputs; the logic (AC84 design) keeps doc-only skips
  // NEUTRAL — an intermediate red stays red until a full-suite green breaks the window.
  const rec = (o) => ({ fullSuiteRan: true, laneCount: 16, state: "green", failedFiles: [], ...o });
  // All-green full-suite records ⇒ consecutiveRed 0.
  assert.equal(
    consecutiveRedRounds([rec({}), rec({}), rec({})]),
    0,
    "all-green full-suite records ⇒ no red window",
  );
  // A trailing red full-suite record counts.
  assert.equal(
    consecutiveRedRounds([rec({}), rec({ state: "red", failedFiles: ["x.ts"] })]),
    1,
    "trailing red full-suite ⇒ consecutiveRed 1",
  );
  // doc-only skip (fullSuiteRan:false) is NEUTRAL — neither counts nor breaks (AC84).
  assert.equal(
    consecutiveRedRounds([
      { taskId: "t1", fullSuiteRan: true, state: "red", failedFiles: ["x.ts"] },
      { taskId: "t2", fullSuiteRan: false, state: "green", failedFiles: [] }, // doc-only green — neutral
    ]),
    1,
    "doc-only green does NOT break the red window (AC84 neutral)",
  );
  // A full-suite GREEN DOES break the window.
  assert.equal(
    consecutiveRedRounds([
      rec({ state: "red", failedFiles: ["x.ts"] }),
      rec({}),
    ]),
    0,
    "full-suite green breaks the red window",
  );
  // Empty records ⇒ 0.
  assert.equal(consecutiveRedRounds([]), 0, "empty records ⇒ 0");
});


test("isDirectoryGlob: bare dir / dir/** / no-slash dir are directory globs; concrete files + file wildcards are not (AC2 — gap-suite-blocking-directory-glob-overbroad)", () => {
  // The crystallization Touches entry `plugin/test/（各 AC 测试）` is a bare trailing-slash directory.
  assert.equal(isDirectoryGlob("plugin/test/"), true, "trailing-slash bare directory");
  assert.equal(isDirectoryGlob("plugin/test/**"), true, "explicit dir/** form (what parseTouches turns plugin/test/ into)");
  assert.equal(isDirectoryGlob("plugin/test"), true, "no-slash bare directory token");
  assert.equal(isDirectoryGlob("plugin/**"), true, "whole-directory glob");
  assert.equal(isDirectoryGlob("**"), true, "all-files wildcard is directory-like (non-attributable)");
  assert.equal(isDirectoryGlob("code/wd.ts"), false, "concrete file");
  assert.equal(isDirectoryGlob("plugin/test/checker-cost.test.mjs"), false, "concrete file under a directory");
  assert.equal(isDirectoryGlob("plugin/test/*.test.mjs"), false, "file-scoped wildcard");
  assert.equal(isDirectoryGlob("send-keys-verified.sh"), false, "bare basename file");
});


test("computeSuiteBlocking: directory glob does NOT attribute; concrete failing filename still does (AC2/AC3 — gap-suite-blocking-directory-glob-overbroad)", () => {
  const tasks = new Map([
    // The crystallization shape: Touches carry concrete script files AND a `plugin/test/` directory
    // glob (各 AC 测试). A failure under plugin/test/ must NOT be attributed via the dir glob.
    ["gap-crystal-dir", { status: "ready", body: "## Touches\n- plugin/test/\n- plugin/scripts/capability-catalog.sh" }],
    // A task whose Touches name the CONCRETE failing file must still be attributed.
    ["gap-real-blocker", { status: "ready", body: "## Touches\n- plugin/test/checker-cost.test.mjs" }],
    // A task whose Touches name a FILE-SCOPED wildcard over the failing file must still be attributed.
    ["gap-wildcard", { status: "ready", body: "## Touches\n- plugin/test/*.test.mjs" }],
  ]);
  // A test expander mirroring the prod expandDeclaredTouches for the globs under test: concrete
  // paths resolve to themselves, file-scoped wildcards expand to the concrete file, and a dir glob
  // WOULD expand to the file — but computeSuiteBlocking must never let the dir glob reach expand.
  const expand = (globs) => {
    const set = new Set();
    for (const g of globs) {
      if (g === "plugin/test/*.test.mjs") set.add("plugin/test/checker-cost.test.mjs");
      else if (g === "plugin/test/**") set.add("plugin/test/checker-cost.test.mjs");
      else set.add(g);
    }
    return set;
  };

  const redRounds = Array.from({ length: 3 }, (_, i) => ({ round: 290 + i, state: "red", reason: "failed", failures: [{ file: "plugin/test/checker-cost.test.mjs" }] }));
  const r = computeSuiteBlocking({ rounds: redRounds, stateFailures: [], tasks, expand });
  assert.equal(r.windowActive, true);
  assert.ok(!r.ids.has("gap-crystal-dir"), "AC2: a directory glob (plugin/test/) does NOT attribute a failure under that directory");
  assert.ok(r.ids.has("gap-real-blocker"), "AC3: a task whose Touches name the concrete failing file is still a suite-blocker");
  assert.ok(r.ids.has("gap-wildcard"), "AC3: a file-scoped wildcard that covers the failing file still attributes");

  // The SAME task attributed when the failure hits one of its CONCRETE touches (only the dir glob is
  // inert — the concrete script touches still participate).
  const concreteHit = computeSuiteBlocking({
    rounds: Array.from({ length: 3 }, (_, i) => ({ round: 293 + i, state: "red", reason: "failed", failures: [{ file: "plugin/scripts/capability-catalog.sh" }] })),
    stateFailures: [],
    tasks,
    expand,
  });
  assert.ok(concreteHit.ids.has("gap-crystal-dir"), "a concrete touch of the same task still attributes when hit");
});


test("computeRelevance: suite-blocking flips blocking true + boosts value (AC2/AC3 unit)", () => {
  const empty = new Map();
  // without the signal: plain 1-touch task values at costBenefit 1, blocking false.
  const before = computeRelevance("gap-watchdog", { body: "plain\n## Touches\n- code/wd.ts" }, empty, empty);
  assert.equal(before.blocking, false);
  assert.equal(before.blocking_suite, false);
  assert.equal(before.value, 1);
  // with the signal: blocking flips, blocking_suite true, value = 2 (blocking) + 2 (suite) + 1 (cost) = 5.
  const after = computeRelevance("gap-watchdog", { body: "plain\n## Touches\n- code/wd.ts" }, empty, empty, new Set(["gap-watchdog"]));
  assert.equal(after.blocking, true, "suite-blocking flips the blocking axis true");
  assert.equal(after.blocking_suite, true);
  assert.equal(after.value, BLOCKING_WEIGHT + SUITE_BLOCKING_WEIGHT + 1);
  assert.match(after.reason, /suite-blocking Y/);
  // a different task in the set does not affect this one (id-scoped).
  const other = computeRelevance("gap-watchdog", { body: "plain\n## Touches\n- code/wd.ts" }, empty, empty, new Set(["gap-someone-else"]));
  assert.equal(other.blocking_suite, false);
  assert.equal(other.value, 1);
});
