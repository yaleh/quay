// @test-group engine
// suite-scheduler.test.mjs — the unified suite scheduler (gap-suite-dynamic-waterline-scheduler):
// waterline semantics, monotonicity, pass/fail-neutrality, and the min-lock control.
//
// Two layers are tested:
//   1. The PURE scheduling core (mainCapacity / nextDispatch / simulateSchedule / simulateMinLock) —
//      the waterline semantic (main uses REMAINING capacity, NOT a global min lock), the monotonic
//      waterline rise, and pass/fail-neutrality (every file dispatched exactly once) are all proven
//      WITHOUT spawning a process.
//   2. The execution entry (runScheduler) — spawns real `node --test` per file; a two-probe run
//      (one passing, one failing) proves the exit-code aggregate = failed-file count (never drops a
//      test, never green-washes a red file).
//
// AC2's control (min-lock vs waterline) is reproduced by simulateMinLock vs simulateSchedule on a
// workload where serial∥lowconc overlap parallelism matters: min-lock caps the whole suite at
// min(S,L,M) and discards the parallel low-group window, so its makespan EXCEEDS the waterline's
// (the proposal's 706s min-lock vs 515s waterline direction).
//
// Run:
//   scripts/test.sh plugin/test/suite-scheduler.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  mainCapacity,
  nextDispatch,
  simulateSchedule,
  simulateMinLock,
  runScheduler,
} from "../scripts/suite-scheduler.ts";

const empty = () => ({ serial: 0, lowconc: 0, main: 0 });

test("mainCapacity — the waterline: main = main_budget − active serial − active lowconc, clamped ≥ 0", () => {
  const b = { serial: 8, lowconc: 8, main: 16 };
  assert.equal(mainCapacity(b, { serial: 0, lowconc: 0, main: 0 }), 16);
  assert.equal(mainCapacity(b, { serial: 8, lowconc: 0, main: 0 }), 8);
  assert.equal(mainCapacity(b, { serial: 0, lowconc: 8, main: 0 }), 8);
  assert.equal(mainCapacity(b, { serial: 8, lowconc: 8, main: 0 }), 0);
  // Clamp: low-group budgets exceeding the main budget must block main, never go negative.
  assert.equal(mainCapacity({ serial: 8, lowconc: 8, main: 4 }, { serial: 8, lowconc: 8, main: 0 }), 0);
  // main's OWN active count never reduces its capacity (only the LOW groups borrow from main).
  assert.equal(mainCapacity(b, { serial: 0, lowconc: 0, main: 12 }), 16);
});

test("nextDispatch — group budgets are INDEPENDENT (serial≤S AND lowconc≤L in parallel, main fills the remainder)", () => {
  const budgets = { serial: 2, lowconc: 3, main: 8 };
  const queues = {
    serial: ["s1", "s2", "s3"],
    lowconc: ["l1", "l2", "l3", "l4"],
    main: ["m1", "m2", "m3", "m4", "m5", "m6", "m7", "m8"],
  };
  const active = empty();
  const started = nextDispatch(budgets, queues, active);
  // serial takes 2, lowconc takes 3 (both INDEPENDENTLY — parallel, overlap not degraded), main fills
  // main_budget − (2+3) = 3.
  const byGroup = { serial: started.filter((s) => s.group === "serial"), lowconc: started.filter((s) => s.group === "lowconc"), main: started.filter((s) => s.group === "main") };
  assert.equal(byGroup.serial.length, 2, "serial ≤ S");
  assert.equal(byGroup.lowconc.length, 3, "lowconc ≤ L (independent of serial)");
  assert.equal(byGroup.main.length, 3, "main fills remaining = M − S − L");
  assert.equal(active.serial, 2);
  assert.equal(active.lowconc, 3);
  assert.equal(active.main, 3);
});

test("nextDispatch — main is BLOCKED while serial+lowconc saturate the low-group budget (waterline starts at 0)", () => {
  const budgets = { serial: 8, lowconc: 8, main: 16 };
  const queues = { serial: Array.from({ length: 8 }, (_, i) => `s${i}`), lowconc: Array.from({ length: 8 }, (_, i) => `l${i}`), main: ["m1", "m2"] };
  const active = empty();
  const started = nextDispatch(budgets, queues, active);
  assert.equal(started.filter((s) => s.group === "main").length, 0, "main capacity 0 while serial+lowconc = 16 = main budget");
  // But after the low groups DRAIN, main gets the capacity back (monotonic rise toward the budget).
  const active2 = { serial: 0, lowconc: 0, main: 0 };
  const started2 = nextDispatch(budgets, queues, active2);
  assert.equal(started2.filter((s) => s.group === "main").length, 2, "drained low groups ⇒ main gets the full budget");
});

test("simulateSchedule — monotonic waterline: capacity rises monotonically toward the main budget as the low groups drain", () => {
  // serial/lowconc counts ≤ their budgets ⇒ the low groups are fully dispatched at t=0 and never
  // re-dispatch, so active serial/lowconc only DEcrease ⇒ main capacity only rises — the exact
  // "低并发组完成后容量单调升向 main 预算" consequence. (A low group with MORE files than its budget
  // refills its slot as one drains, keeping the capacity FLAT rather than rising — the rise is over
  // the DRAIN of the finite low queue, not over every individual completion.)
  const budgets = { serial: 2, lowconc: 2, main: 6 };
  const groups = {
    serial: ["s1", "s2"],
    lowconc: ["l1", "l2"],
    main: ["m1", "m2", "m3", "m4", "m5", "m6", "m7", "m8", "m9"],
  };
  const durations = new Map([
    ["s1", 50], ["s2", 20],
    ["l1", 40], ["l2", 15],
    ["m1", 8], ["m2", 8], ["m3", 8], ["m4", 8], ["m5", 8], ["m6", 8], ["m7", 8], ["m8", 8], ["m9", 8],
  ]);
  const r = simulateSchedule(budgets, groups, durations);
  assert.ok(r.mainCapacityTrace.length > 0, "the simulation must produce a capacity trace");
  for (let i = 1; i < r.mainCapacityTrace.length; i++) {
    assert.ok(
      r.mainCapacityTrace[i] >= r.mainCapacityTrace[i - 1],
      `main capacity must rise monotonically (trace[${i - 1}]=${r.mainCapacityTrace[i - 1]} → trace[${i}]=${r.mainCapacityTrace[i]})`,
    );
  }
  // And it must RISE ALL THE WAY to the main budget once the low groups are fully drained.
  assert.equal(r.mainCapacityTrace[r.mainCapacityTrace.length - 1], budgets.main, "the waterline tops out at the main budget");
});

test("simulateSchedule — pass/fail-neutral: every file is dispatched EXACTLY once (membership unchanged)", () => {
  const budgets = { serial: 2, lowconc: 2, main: 4 };
  const groups = { serial: ["s1", "s2"], lowconc: ["l1"], main: ["m1", "m2", "m3"] };
  const durations = new Map([["s1", 5], ["s2", 5], ["l1", 3], ["m1", 2], ["m2", 2], ["m3", 2]]);
  const r = simulateSchedule(budgets, groups, durations);
  const seen = r.events.map((e) => e.file).sort();
  const all = [...groups.serial, ...groups.lowconc, ...groups.main].sort();
  assert.deepEqual(seen, all, "the scheduler reorders at most — it can never drop or duplicate a file");
});

test("AC2 control — waterline makespan < min-lock makespan (serial∥lowconc overlap parallelism preserved)", () => {
  // The rejected "global min lock" caps EVERYTHING at min(S,L,M)=8; the waterline lets serial and
  // lowconc each run at their OWN 8-lane budget in parallel (16 lanes total) while main fills the
  // remainder. On this workload the min lock serializes the two long low-group waves into one 8-lane
  // pool, so it is SLOWER (the proposal's 706s min-lock vs 515s waterline direction).
  const budgets = { serial: 8, lowconc: 8, main: 16 };
  const groups = {
    serial: Array.from({ length: 8 }, (_, i) => `s${i}`),
    lowconc: Array.from({ length: 8 }, (_, i) => `l${i}`),
    main: Array.from({ length: 8 }, (_, i) => `m${i}`),
  };
  const durations = new Map();
  for (const f of groups.serial) durations.set(f, 100);
  for (const f of groups.lowconc) durations.set(f, 100);
  for (const f of groups.main) durations.set(f, 10);

  const waterline = simulateSchedule(budgets, groups, durations).makespan;
  const minLock = simulateMinLock(budgets, groups, durations);
  assert.equal(waterline, 110, "waterline: serial(8×100s)∥lowconc(8×100s) in parallel, then main(8×10s)");
  assert.equal(minLock, 210, "min-lock: 3 waves of 8 through one pool (100+100+10)");
  assert.ok(waterline < minLock, `waterline ${waterline} must beat min-lock ${minLock}`);
});

test("runScheduler — pass/fail-neutral execution: exit aggregate = failed-file count (one red, one green)", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sched-probe-"));
  const okFile = path.join(dir, "ok.test.mjs");
  const badFile = path.join(dir, "bad.test.mjs");
  fs.writeFileSync(okFile, 'import { test } from "node:test";\ntest("passes", () => {});\n');
  fs.writeFileSync(badFile, 'import { test } from "node:test";\ntest("fails", () => { throw new Error("boom"); });\n');

  const result = await runScheduler({
    budgets: { serial: 1, lowconc: 1, main: 2 },
    groups: { serial: [], lowconc: [], main: [okFile, badFile] },
    nodeArgs: [],
  });

  assert.equal(result.failed, 1, "exactly one file fails");
  assert.ok(result.failedFiles.includes(badFile), "the failing file is the red one");
  assert.ok(!result.failedFiles.includes(okFile), "the passing file is not flagged");
});
