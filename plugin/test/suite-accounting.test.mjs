// @test-group engine
// @load-sensitive child-spawn
// @load-sensitive-entry 2026-09-06 child-spawn (spawns real full-suite-runner.ts + fake-suite child; triage 判 other-task defer 而非 isolate-rerun)
// KNOWN-LOAD-SENSITIVE (see plugin/loop/fast-mode-loop-tick.md "已知负载敏感族") — the runner-spawn
//   tests below spawn a real node runner (full-suite-runner.ts) + a real bash fake-suite child; under
//   full-suite concurrency the runner bootstrap + child spawn is start/schedule-delayed and wall-clock
//   polls can flake (same family as full-suite-runner-phases.test.mjs).

// suite-accounting.test.mjs — the per-phase differential accounting family's dedicated test file
// (gap-mechanical-fan-in-loses-per-phase-accounting). full-suite-runner-cgroup.test.mjs covers the
// cgroup counter PARSERS + the REAL /sys/fs/cgroup path; this file covers the UNIFIED-SCHEDULER phase
// mapping (static→main→end) that restores per-phase PSI on the mechanical fan-in --buckets path, the
// fail-open negative control (cgroup unreadable ⇒ null + read_error, never a fabricated 0), and the
// single-phase-degradation marker.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { PhaseDifferentialAccounting } from "../scripts/full-suite-runner.ts";
import {
  fakeSuite,
  runRunner,
  waitExit,
  lastRoundRecord,
  GREEN_SUITE,
} from "./helpers/full-suite-runner-harness.mjs";

// The unified scheduler (gap-suite-dynamic-waterline-scheduler) runs serial/lowconc/main CONCURRENTLY
// via the waterline and emits NO `selected N files (groups=serial|lowconc)` serial-phase markers — only
// test.sh's `scheduler: unified group-budget scheduler …` (test-window START) and the scheduler's own
// `__OVERHEAD__ <group>_phase_ms` group-close burst (test-window END). The whole concurrent window is
// ONE "main" phase at laneCount. This fixture mirrors that stream exactly.
const SCHEDULER_SUITE = [
  'echo "scheduler: unified group-budget scheduler (bucket path: serial≤2 lowconc≤3 main≤8)"',
  'echo "__GROUP__ concurrency=2 files=5 sum_ms=100 floor_ms=60 capped=0"',
  'echo "__OVERHEAD__ serial_phase_ms=1000"',
  'echo "__GROUP__ concurrency=3 files=8 sum_ms=200 floor_ms=90 capped=0"',
  'echo "__OVERHEAD__ lowconc_phase_ms=2000"',
  'echo "__GROUP__ concurrency=8 files=17 sum_ms=3000 floor_ms=1200 capped=0"',
  'echo "__OVERHEAD__ main_phase_ms=3000"',
  'echo "__OVERHEAD__ scheduler_ms=3100"',
  'echo "# tests 8"',
  'echo "# pass 8"',
  'echo "# fail 0"',
  'echo "# cancelled 0"',
  "exit 0",
].join("\n");

// Phase-script seam: the counters AT THE START of each phase. The scheduler sequence reads exactly
// static (init) → main (scheduler start) → end (main close) → round_end (finalize).
const SCHEDULER_SCRIPT = JSON.stringify({
  static: { cpu_usec: 1000, psi_cpu_total: 500, psi_io_total: 10 },
  main: { cpu_usec: 20000, psi_cpu_total: 9000, psi_io_total: 100 },
  end: { cpu_usec: 20100, psi_cpu_total: 9100, psi_io_total: 102 },
  round_end: { cpu_usec: 20500, psi_cpu_total: 9300, psi_io_total: 105 },
});

test("unit — the scheduler phase sequence static→main→end produces exact differentials (lanes/psi per phase)", () => {
  const before = process.env.QUAY_TEST_CGROUP_SCRIPT;
  process.env.QUAY_TEST_CGROUP_SCRIPT = SCHEDULER_SCRIPT;
  try {
    // lanesFor mirrors full-suite-runner.ts's phaseLanes: serial/lowconc their own concurrency,
    // main = the round laneCount, everything else serial ⇒ 1.
    const acc = new PhaseDifferentialAccounting(999999, (p) => (p === "main" ? 8 : 1));
    acc.init("static");
    acc.boundary("main"); // scheduler start
    acc.boundary("end"); // main group close
    acc.finalize(); // suite exit, reads round_end
    const phases = acc.records.map((r) => ({
      phase: r.phase,
      cpu_usec: r.cpu_usec,
      psi_cpu_total: r.psi_cpu_total,
      lanes: r.lanes,
    }));
    assert.deepEqual(phases, [
      { phase: "static", cpu_usec: 20000 - 1000, psi_cpu_total: 9000 - 500, lanes: 1 },
      { phase: "main", cpu_usec: 20100 - 20000, psi_cpu_total: 9100 - 9000, lanes: 8 },
      { phase: "end", cpu_usec: 20500 - 20100, psi_cpu_total: 9300 - 9100, lanes: 1 },
    ]);
    assert.equal(acc.read_error, null);
  } finally {
    if (before === undefined) delete process.env.QUAY_TEST_CGROUP_SCRIPT;
    else process.env.QUAY_TEST_CGROUP_SCRIPT = before;
  }
});

test("unit — negative control: an unreadable cgroup keeps null cpu/psi + a read_error (never a fabricated 0)", () => {
  const before = process.env.QUAY_TEST_CGROUP_DIR;
  // Point the seam at a NON-EXISTENT dir: resolveCgroupV2Dir returns it verbatim, readPhaseCounters
  // ENOENTs on cpu.stat ⇒ fail-open (null counters + read_error), never a fabricated 0.
  process.env.QUAY_TEST_CGROUP_DIR = path.join(os.tmpdir(), "fsr-cg-nonexistent-" + Date.now());
  delete process.env.QUAY_TEST_CGROUP_SCRIPT;
  try {
    const acc = new PhaseDifferentialAccounting(999999, (p) => (p === "main" ? 8 : 1));
    acc.init("static");
    acc.boundary("main");
    acc.boundary("end");
    acc.finalize();
    assert.equal(acc.records.length, 3, "the scheduler boundaries still fire (3 phases) even with an unreadable cgroup");
    const main = acc.records.find((r) => r.phase === "main");
    assert.ok(main, "main phase record present");
    assert.equal(main.psi_cpu_total, null, "main psi stays null (fail-open — no fabricated 0)");
    assert.equal(main.cpu_usec, null, "main cpu stays null (fail-open)");
    assert.ok(acc.read_error && acc.read_error.length > 0, "the read failure rides read_error (hard rule 3b)");
  } finally {
    if (before === undefined) delete process.env.QUAY_TEST_CGROUP_DIR;
    else process.env.QUAY_TEST_CGROUP_DIR = before;
  }
});

test("AC1/AC2/AC3 — a scheduler-path round records static+main+end, main lanes = laneCount, main psi NON-null", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fsr-sched-"));
  const { f, dir } = fakeSuite(SCHEDULER_SUITE);
  try {
    const child = runRunner({
      root,
      command: `bash ${f}`,
      laneCount: 8,
      env: { QUAY_TEST_CGROUP_SCRIPT: SCHEDULER_SCRIPT },
    });
    const { code } = await waitExit(child);
    assert.equal(code, 0, `runner exits 0 on green, got ${code}`);
    const rec = lastRoundRecord(root);
    assert.ok(rec, "round record written");
    const phases = rec.phases || [];
    assert.deepEqual(
      phases.map((p) => p.phase),
      ["static", "main", "end"],
      "AC1 — the scheduler path records ≥3 phases (static + main + end), not one lanes=1 static",
    );
    const main = phases.find((p) => p.phase === "main");
    assert.ok(main, "main phase present");
    assert.equal(main.lanes, 8, "AC2 — main lanes = the round laneCount (8), not 1");
    assert.equal(main.psi_cpu_total, 100, "AC3 — main psi_cpu_total NON-null (the real window differential)");
    assert.equal(main.cpu_usec, 100, "main cpu differential = end − main");
    assert.equal(rec.phase_counter_error, undefined, "seam provides every snapshot — no counter error");
    assert.equal(rec.single_phase, undefined, "a multi-phase round carries NO single_phase marker");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("AC5 — a single-phase round (no boundary markers) carries single_phase:true + a reason, not a bare static", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fsr-single-"));
  const { f, dir } = fakeSuite(GREEN_SUITE); // no phase markers, no scheduler marker — but tests DO run
  try {
    const child = runRunner({ root, command: `bash ${f}`, laneCount: 8 });
    const { code } = await waitExit(child);
    assert.equal(code, 0, `runner exits 0 on green, got ${code}`);
    const rec = lastRoundRecord(root);
    assert.ok(rec, "round record written");
    assert.equal(rec.phases.length, 1, "the marker-less round records one phase");
    assert.equal(rec.single_phase, true, "the degradation is flagged, not silent");
    assert.equal(rec.single_phase_reason, "no-phase-boundary-markers", "the reason names WHY (suite ran, no boundary detected)");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("AC5 — a static-check ABORT round (never left the pre-test phase) carries single_phase_reason=static-check-abort", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fsr-single-abort-"));
  // The production single-phase shape: a static-check failure aborts the suite under set -e BEFORE
  // any test phase runs (testPhaseStarted stays false) — the whole round is one "static" phase.
  const suite = 'echo "STATIC_CHECK_FAILED: quay-init-closure-ratchet exit=1"\nexit 1';
  const { f, dir } = fakeSuite(suite);
  try {
    const child = runRunner({ root, command: `bash ${f}`, laneCount: 8, env: { QUAY_TEST_CGROUP_SCRIPT: SCHEDULER_SCRIPT } });
    const { code } = await waitExit(child);
    assert.equal(code, 1, "a static-check abort is red (exit 1)");
    const rec = lastRoundRecord(root);
    assert.ok(rec, "round record written");
    assert.equal(rec.phases.length, 1, "the abort round records one phase");
    assert.equal(rec.single_phase, true, "the degradation is flagged");
    assert.equal(rec.single_phase_reason, "static-check-abort", "the reason names the pre-test abort");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
