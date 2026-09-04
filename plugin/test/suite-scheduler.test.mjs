// @test-group engine
// suite-scheduler.test.mjs — the unified suite scheduler: the RELIABILITY-CAP semantics
// (gap-suite-scheduler-reliability-cap-not-speed, redefining the waterline established by
// gap-suite-dynamic-waterline-scheduler), plus pass/fail-neutrality and the classification/LPT layer.
//
// Two layers are tested:
//   1. The PURE scheduling core (currentCap / nextDispatch / simulateSchedule) — the reliability
//      invariant (total concurrency ≤ min budget of the currently-active groups, at every event), the
//      low-tier-drain → main-recovers-full-budget regression (AC3), and pass/fail-neutrality (every
//      file dispatched exactly once) are all proven WITHOUT spawning a process.
//   2. The execution entry (runScheduler) — spawns real `node --test` per file; a two-probe run
//      (one passing, one failing) proves the exit-code aggregate = failed-file count (never drops a
//      test, never green-washes a red file).
//
// The OLD "waterline makespan < min-lock makespan" control is REMOVED — that assertion encoded the
// superseded speed target ("min lock is +8% slower"). The replacement AC2 asserts the opposite
// direction: the reliability invariant (total ≤ min active budget) holds at every event.
//
// Run:
//   scripts/test.sh plugin/test/suite-scheduler.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  currentCap,
  nextDispatch,
  simulateSchedule,
  classifyAndOrder,
  toSuiteGroup,
  groupsArgToSuiteGroups,
} from "../scripts/suite-scheduler.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCHEDULER_CLI = path.join(__dirname, "..", "scripts", "suite-scheduler.ts");

const empty = () => ({ serial: 0, lowconc: 0, main: 0 });

test("currentCap — the reliability cap: min budget among the groups with ≥1 file running (none ⇒ +∞)", () => {
  const b = { serial: 8, lowconc: 4, main: 28 };
  // No group active ⇒ no total limit (+∞) — the per-group budgets decide who starts first.
  assert.equal(currentCap(b, { serial: 0, lowconc: 0, main: 0 }), Infinity);
  // Only serial active ⇒ cap = serial budget.
  assert.equal(currentCap(b, { serial: 3, lowconc: 0, main: 0 }), 8);
  // serial + lowconc active ⇒ cap = min(8, 4) = 4 (the lowconc tier dominates).
  assert.equal(currentCap(b, { serial: 3, lowconc: 1, main: 0 }), 4);
  // All three active ⇒ cap = min(8, 4, 28) = 4.
  assert.equal(currentCap(b, { serial: 3, lowconc: 1, main: 5 }), 4);
  // Only main active ⇒ cap = main budget (main recovers its full budget once the low tiers drain).
  assert.equal(currentCap(b, { serial: 0, lowconc: 0, main: 12 }), 28);
});

test("nextDispatch — total ≤ cap: serial fills to its budget first, lowconc/main blocked while it holds the cap", () => {
  const budgets = { serial: 8, lowconc: 4, main: 28 };
  const queues = {
    serial: Array.from({ length: 8 }, (_, i) => `s${i}`),
    lowconc: Array.from({ length: 4 }, (_, i) => `l${i}`),
    main: Array.from({ length: 28 }, (_, i) => `m${i}`),
  };
  const active = empty();
  const started = nextDispatch(budgets, queues, active);
  // Nothing active ⇒ no cap ⇒ serial fills to its OWN budget (8) first.
  assert.equal(active.serial, 8, "serial fills to its budget first (nothing active ⇒ no cap)");
  assert.equal(active.lowconc, 0, "lowconc cannot start while serial holds 8 = the cap (min(8)=8)");
  assert.equal(active.main, 0, "main cannot start while serial holds 8 = the cap");
  assert.equal(started.length, 8);
});

test("nextDispatch — a low tier becoming active lowers the cap below the pre-start total (no overshoot)", () => {
  const budgets = { serial: 8, lowconc: 4, main: 28 };
  // serial is at 7 (just below its budget). lowconc (budget 4) may NOT start: its post-start cap
  // would be min(8, 4) = 4 < 7 + 1 = 8. main (budget 28) MAY fill to total 8 (cap = min(8, 28) = 8).
  const active = { serial: 7, lowconc: 0, main: 0 };
  const queues = { serial: [], lowconc: ["l1"], main: ["m1"] };
  const started = nextDispatch(budgets, queues, active);
  assert.deepEqual(started.map((s) => s.group), ["main"], "main fills the headroom, lowconc is blocked by its own lower cap");
  assert.equal(active.main, 1);
  assert.equal(active.lowconc, 0, "lowconc blocked: post-start total 8 > its cap 4");
  // Once serial drains to 3, lowconc may start ONE (total 4 = cap 4), and no more.
  const active2 = { serial: 3, lowconc: 0, main: 0 };
  const queues2 = { serial: [], lowconc: ["l1", "l2"], main: [] };
  const started2 = nextDispatch(budgets, queues2, active2);
  assert.deepEqual(started2.map((s) => s.group), ["lowconc"], "lowconc starts once serial ≤ 3");
  assert.equal(active2.lowconc, 1, "exactly one lowconc starts (total 4 = cap 4)");
  assert.equal(active2.serial, 3);
});

test("simulateSchedule — reliability invariant: total ≤ min active budget at every event (AC2)", () => {
  const budgets = { serial: 8, lowconc: 4, main: 28 };
  const groups = {
    serial: Array.from({ length: 8 }, (_, i) => `s${i}`),
    lowconc: Array.from({ length: 4 }, (_, i) => `l${i}`),
    main: Array.from({ length: 20 }, (_, i) => `m${i}`),
  };
  const durations = new Map();
  for (const f of groups.serial) durations.set(f, 100);
  for (const f of groups.lowconc) durations.set(f, 50);
  for (const f of groups.main) durations.set(f, 10);

  const r = simulateSchedule(budgets, groups, durations);
  assert.ok(r.trace.length > 0, "the simulation must produce a per-event trace");
  for (const snap of r.trace) {
    if (Number.isFinite(snap.cap)) {
      assert.ok(
        snap.total <= snap.cap,
        `total ${snap.total} must be ≤ cap ${snap.cap} at every event`,
      );
    }
  }
  // Meaningfulness guard (hard rule 4): the cap must actually BIND at the lowest active tier
  // (lowconc budget 4) during the run — the assertion is not "total ≤ +∞ everywhere".
  assert.ok(
    r.trace.some((s) => s.cap === budgets.lowconc),
    "the cap must actually bind at the lowest active tier (lowconc=4) during the run",
  );
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

test("AC3 regression — after serial/lowconc drain, main recovers its FULL budget (no permanent slow-down)", () => {
  // The reliability cap must not REMEMBER tiers that have already drained: once serial (budget 8)
  // and lowconc (budget 4) are gone, main (budget 28) runs at its own full budget.
  const budgets = { serial: 8, lowconc: 4, main: 28 };
  const active = empty();
  const queues = {
    serial: [],
    lowconc: [],
    main: Array.from({ length: 28 }, (_, i) => `m${i}`),
  };
  const started = nextDispatch(budgets, queues, active);
  assert.equal(active.main, 28, "main runs at its full budget once serial/lowconc are drained");
  assert.equal(started.length, 28);
  assert.equal(active.serial, 0);
  assert.equal(active.lowconc, 0);
});

// ── classification + LPT layer (gap-suite-classification-lpt-scheduler-ts-ization) ────────────────
// The scheduler's input contract is now the RAW deduped file list; classification (product+engine → main,
// serial → serial, lowconc → lowconc) and LPT ordering live inside classifyAndOrder. These tests prove
// the bucket mapping, the --groups filter, and that classification is byte-consistent with the metadata
// modes' single-pass classifier.

test("toSuiteGroup — product/engine collapse to main; serial/lowconc map 1:1", () => {
  assert.equal(toSuiteGroup("product"), "main");
  assert.equal(toSuiteGroup("engine"), "main");
  assert.equal(toSuiteGroup("serial"), "serial");
  assert.equal(toSuiteGroup("lowconc"), "lowconc");
});

test("groupsArgToSuiteGroups — product/engine → main, serial/lowconc 1:1, an unknown token matches nothing", () => {
  assert.deepEqual([...groupsArgToSuiteGroups("product,engine,serial,lowconc")].sort(), ["lowconc", "main", "serial"]);
  assert.deepEqual([...groupsArgToSuiteGroups("product,engine")], ["main"]);
  assert.deepEqual([...groupsArgToSuiteGroups("serial")], ["serial"]);
  assert.deepEqual([...groupsArgToSuiteGroups("bogus")], [], "a bogus --group selects no files (same as the old select_files over an unknown group)");
});

test("classifyAndOrder — raw files classify into buckets, --groups filters, LPT fails open on an absent carrier", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sched-classify-"));
  try {
    const serial = path.join(dir, "s.test.mjs");
    const low = path.join(dir, "l.test.mjs");
    const main1 = path.join(dir, "m1.test.mjs");
    fs.writeFileSync(serial, "// @test-group serial\nimport { test } from 'node:test';\ntest('s', () => {});\n");
    fs.writeFileSync(low, "// @test-group lowconc\nimport { test } from 'node:test';\ntest('l', () => {});\n");
    fs.writeFileSync(main1, "import { test } from 'node:test';\ntest('m', () => {});\n");
    const all = classifyAndOrder([serial, low, main1], { root: dir, rounds: 3, lptEnabled: true });
    assert.deepEqual(all.serial, [serial]);
    assert.deepEqual(all.lowconc, [low]);
    assert.deepEqual(all.main, [main1]);
    const mainOnly = classifyAndOrder([serial, low, main1], { root: dir, rounds: 3, lptEnabled: true, groups: "product,engine" });
    assert.deepEqual(mainOnly.serial, [], "--groups product,engine excludes serial");
    assert.deepEqual(mainOnly.lowconc, [], "--groups product,engine excludes lowconc");
    assert.deepEqual(mainOnly.main, [main1]);
    // lptEnabled=false keeps the classification but skips the carrier read (scheduling-only, unchanged).
    const noLpt = classifyAndOrder([serial, low, main1], { root: dir, rounds: 3, lptEnabled: false });
    assert.deepEqual(noLpt.main, [main1]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("runScheduler — pass/fail-neutral execution: exit aggregate = failed-file count (one red, one green)", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sched-probe-"));
  try {
    const okFile = path.join(dir, "ok.test.mjs");
    const badFile = path.join(dir, "bad.test.mjs");
    fs.writeFileSync(okFile, 'import { test } from "node:test";\ntest("passes", () => {});\n');
    fs.writeFileSync(badFile, 'import { test } from "node:test";\ntest("fails", () => { throw new Error("boom"); });\n');

    // The CLI runs as a SUBPROCESS, never in-process: runScheduler composes spec→stdout, and an
    // in-process call would leak the red probe's `✖ fails` + `Error: boom` into THIS file's stdout
    // (the outer full-suite grep would then count a phantom red — the exact leak that reddened the
    // prior fan-in run's `ℹ fail 1` on a `/tmp/sched-probe-*/bad.test.mjs`). A subprocess captures
    // that spec output in `r.stdout`/`r.stderr` where it cannot pollute the outer stream.
    // NODE_TEST_* is stripped so the CLI's run({isolation:"process"}) children are not mistaken for
    // nested test workers (which would skip their files and report a false green).
    const childEnv = { ...process.env };
    for (const k of Object.keys(childEnv)) {
      if (k.startsWith("NODE_TEST_")) delete childEnv[k];
    }
    // The scheduler now takes a RAW file list (one path per line) — classification + LPT live inside
    // (gap-suite-classification-lpt-scheduler-ts-ization). Both files are undeclared ⇒ engine ⇒ main.
    const manifest = `${okFile}\n${badFile}\n`;
    const r = spawnSync(
      process.execPath,
      ["--no-warnings", "--experimental-strip-types", SCHEDULER_CLI,
        "--root", dir, "--main-root", dir,
        "--serial-concurrency", "1", "--lowconc-concurrency", "1", "--main-concurrency", "2",
        "--groups", "product,engine"],
      { input: manifest, encoding: "utf8", env: childEnv },
    );
    assert.equal(r.status, 1, `one failing file ⇒ exit 1 (stderr: ${r.stderr})`);
    assert.match(r.stderr, new RegExp(`__PERFILE__ .* ${badFile} passed=false`), "the failing file is flagged passed=false");
    assert.match(r.stderr, new RegExp(`__PERFILE__ .* ${okFile} passed=true`), "the passing file is flagged passed=true");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
