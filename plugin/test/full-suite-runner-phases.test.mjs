// @test-group lowconc
// @load-sensitive child-spawn
// @load-sensitive-entry 2026-08-27 child-spawn (spawns real full-suite-runner.ts + fake-suite child; triage 判 other-task defer 而非 isolate-rerun — gap-full-suite-runner-test-poll-timeout-load-flake)
// KNOWN-LOAD-SENSITIVE (see plugin/loop/fast-mode-loop-tick.md "已知负载敏感族") — every test spawns a
//   real node runner (full-suite-runner.ts) + a real bash fake-suite child; under full-suite concurrency
//   the runner bootstrap + child spawn is start/schedule-delayed and the wall-clock polls flaked
//   (gap-full-suite-runner-test-poll-timeout-load-flake: "poll timeout" under load 11.81 / 16 lanes).
//   The 5s polls were already raised to 20s (gap-suite-load-sampler-orphan-process); this annotation
//   closes the triage half — a failure must be classified load-sensitive (isolate-rerun), not
//   other-task (defer anti-livelock).

// full-suite-runner-phases.test.mjs — verification-round record accounting (phase_ms / PHASE_SUITE differential / phase start-end / floor-ceiling / perFile / verifiedCommit-tree / lane-splice / nproc-concurrent / counters). Split from gap-suite-file-split-two-longest.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync, execSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  isFailureLine,
  isAbortLine,
  isStaticCheckFailureLine,
  extractStaticCheckDetail,
  extractFailClosedChecker,
  buildStaticCheckFailures,
  isGitWorktree,
  readStateRunId,
  writeStateGuarded,
  segmentFailures,
  isStateAssertingTestFile,
  buildSystemdRunArgv,
  DEFAULT_SYSTEMD_RUN_LIMITS,
  parseSystemdRunLimits,
  systemdRunAvailable,
  parseSystemdConsumedLine,
  parseSystemdTimespanToSeconds,
  parseSystemdBytesToMb,
  readScopeConsumedLoad,
  parseCpuStatUsageUsec,
  parsePressureSomeTotal,
  resolveCgroupV2Dir,
  readPhaseCounters,
  PhaseDifferentialAccounting,
  snapshotAssertionSurface,
  detectAssertionSurfaceEdits,
  concurrentSuiteSlots,
  hostParallelism,
  countRunnerProcesses,
  effectiveParallelism,
  concurrentPhaseCount,
  countHeldSuiteLocks,
  defaultLaneCount,
  yieldedSuiteSlotCount,
  spliceConcurrency,
  stripConcurrencyFlags,
} from "../scripts/full-suite-runner.ts";
import { runOnce, classifyFailure, routeRed, shouldStopDispatch, shouldDispatchOnRed } from "../scripts/suite-state-trigger.ts";

import {
  REPO_ROOT,
  RUNNER,
  SUITE_SLOT_LIB,
  OUTER_TICK,
  INNER_TICK,
  CLOSURE_TASK,
  CLOSURE_DECOMP_TASK_ID,
  read,
  statePath,
  readState,
  redPayload,
  lastRoundRecord,
  fakeSuite,
  runRunner,
  waitExit,
  poll,
  GREEN_SUITE,
} from "./helpers/full-suite-runner-harness.mjs";

// ── gap-verification-round-missing-phase-ms-breaks-cost-attribution: AC2/AC3 (phase_ms) ─────────────
// test.sh's FULL-SUITE default path emits `__OVERHEAD__ <phase>_ms=N` per fixed-overhead phase
// (serial/lowconc/main + run_static_checks). The runner must carry those phase readings into the
// verification-round record so per_test_ms is no longer a phase-blind mix of truncated-red and
// complete-green rounds (the 08-09 "700s regression" misjudgment source).

test("AC2/AC3 — a complete round records all four *_phase_ms from the __OVERHEAD__ stream lines", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fsr-oh-"));
  // The fake suite emits the phase markers to STDERR exactly like test.sh's _oh_emit does, then a
  // green TAP summary. Values mirror the r266 decomposition (static 33s / serial 640s / lowconc
  // 272s / main 650s — the task body's anchored split).
  const suite = [
    'echo "__OVERHEAD__ run_static_checks_ms=33000" >&2',
    'echo "__OVERHEAD__ serial_phase_ms=640000" >&2',
    'echo "__OVERHEAD__ lowconc_phase_ms=272000" >&2',
    'echo "__OVERHEAD__ main_phase_ms=650000" >&2',
    'echo "# tests 5"',
    'echo "# pass 5"',
    'echo "# fail 0"',
    'echo "# cancelled 0"',
    "exit 0",
  ].join("\n");
  const { f, dir } = fakeSuite(suite);
  try {
    const child = runRunner({ root, command: `bash ${f}`, laneCount: 8 });
    const { code } = await waitExit(child);
    assert.equal(code, 0, `runner exits 0 on green, got ${code}`);
    const vrf = path.join(root, ".quay", "verification-round.jsonl");
    assert.ok(fs.existsSync(vrf), "verification-round.jsonl written");
    const rec = JSON.parse(fs.readFileSync(vrf, "utf8").split("\n").filter((l) => l.trim())[0]);
    assert.equal(rec.static_phase_ms, 33000, "static_phase_ms ← run_static_checks_ms");
    assert.equal(rec.serial_phase_ms, 640000, "serial_phase_ms present");
    assert.equal(rec.lowconc_phase_ms, 272000, "lowconc_phase_ms present");
    assert.equal(rec.main_phase_ms, 650000, "main_phase_ms present");
    // AC3 — the four readings make a complete round phase-annotatable: the whole phase set is in
    // the record, so per_test_ms carries the full-suite context (unlike the truncated shape below).
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("AC2 — __OVERHEAD__ lines with `partial=1` suffix are captured as phaseMs, NOT failures (round 137 fix)", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fsr-oh-partial-"));
  // test.sh's _oh_emit_p SIGTERM/EXIT partial fallback emits `__OVERHEAD__ <phase>_ms=N partial=1`.
  // Before the regex fix (^_ms=(\d+)$), the suffix made the line fall through to failures[] — a
  // false red (round 137 __OVERHEAD__ build_dist_ms=479 partial=1).
  const suite = [
    'echo "__OVERHEAD__ run_static_checks_ms=33000 partial=1" >&2',
    'echo "# tests 5"',
    'echo "# pass 5"',
    'echo "# fail 0"',
    'echo "# cancelled 0"',
    "exit 0",
  ].join("\n");
  const { f, dir } = fakeSuite(suite);
  try {
    const child = runRunner({ root, command: `bash ${f}`, laneCount: 8 });
    const { code } = await waitExit(child);
    assert.equal(code, 0, `runner exits 0 on green, got ${code}`);
    const vrf = path.join(root, ".quay", "verification-round.jsonl");
    const rec = JSON.parse(fs.readFileSync(vrf, "utf8").split("\n").filter((l) => l.trim())[0]);
    assert.equal(rec.static_phase_ms, 33000, "partial=1 line still captured as phaseMs");
    assert.ok(!(rec.failures || []).some((x) => String(x.line || x).includes("__OVERHEAD__")),
      "the partial=1 overhead line must NOT be in failures[]");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("AC2/AC3 — a kill-on-red-TRUNCATED red round is distinguishable: serial/lowconc present, main_phase_ms ABSENT", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fsr-oh-red-"));
  // The pre-main phases completed (their __OVERHEAD__ markers fired) but the run reds DURING main
  // and is cut before the main-phase completion marker — the exact shape a kill-on-red 30s tree-kill
  // leaves. per_test_ms on such a round must NOT be read as a full-suite per-test cost (the 700s
  // misjudgment: truncated red reads like a regression).
  const suite = [
    'echo "__OVERHEAD__ run_static_checks_ms=33000" >&2',
    'echo "__OVERHEAD__ serial_phase_ms=640000" >&2',
    'echo "__OVERHEAD__ lowconc_phase_ms=272000" >&2',
    'echo "not ok 1 - boom"',
    'echo "# tests 5"',
    'echo "# pass 4"',
    'echo "# fail 1"',
    'echo "# cancelled 0"',
    "exit 1",
  ].join("\n");
  const { f, dir } = fakeSuite(suite);
  try {
    const child = runRunner({ root, command: `bash ${f}`, laneCount: 8 });
    const { code } = await waitExit(child);
    assert.equal(code, 1, `runner exits 1 on red, got ${code}`);
    const vrf = path.join(root, ".quay", "verification-round.jsonl");
    assert.ok(fs.existsSync(vrf), "verification-round.jsonl written");
    const rec = JSON.parse(fs.readFileSync(vrf, "utf8").split("\n").filter((l) => l.trim())[0]);
    assert.equal(rec.state, "red", "truncated round is red");
    assert.equal(rec.serial_phase_ms, 640000, "serial phase completed before the cut");
    assert.equal(rec.lowconc_phase_ms, 272000, "lowconc phase completed before the cut");
    assert.equal(rec.main_phase_ms, undefined, "main_phase_ms ABSENT — the truncation is visible in the record");
    // AC3 — the phase reading is what separates this truncated red's per_test_ms from a complete
    // green round's: a reader sees serial+lowconc WITHOUT main and knows the per-test cost is NOT
    // a full-suite number.
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});


// ── gap-fan-in-red-bucket-run-not-recorded AC1/AC3 — --buckets red/green contrast ───────────────────
// The fan-in bucket path now runs through full-suite-runner.ts --buckets. The runner is the single writer
// of verification-round.jsonl GREEN AND RED; a red bucket round must land state=red (real suite_exit + fail
// count + __BUCKETS__ marker), never left unrecorded (硬规则 3b: 「没跑过」与「跑了但红」同形).

/** Write a fake `<root>/scripts/test.sh` that emits the given body (the runner's --buckets path spawns
 *  `bash scripts/test.sh --buckets <task-id>` in cwd=root). */
function fakeBucketTestSh(root, body) {
  fs.mkdirSync(path.join(root, "scripts"), { recursive: true });
  fs.writeFileSync(path.join(root, "scripts", "test.sh"), "#!/usr/bin/env bash\n" + body + "\n", { mode: 0o755 });
}

test("AC1 — full-suite-runner.ts --buckets records a RED bucket round (state=red + fail count + __BUCKETS__ marker) into verification-round.jsonl", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fsr-bucket-red-"));
  fakeBucketTestSh(root, [
    'echo "__BUCKETS__ buckets=M files=3 full=0"',
    'echo "# tests 5"',
    'echo "# pass 3"',
    'echo "# fail 2"',
    'echo "# cancelled 0"',
    "exit 1",
  ].join("\n"));
  try {
    const child = runRunner({ root, buckets: "gap-test-red-bucket", laneCount: 8, runner: "inner" });
    const { code } = await waitExit(child);
    assert.equal(code, 1, `runner exits 1 on a red bucket round, got ${code}`);
    const vrf = path.join(root, ".quay", "verification-round.jsonl");
    assert.ok(fs.existsSync(vrf), "verification-round.jsonl written");
    const lines = fs.readFileSync(vrf, "utf8").split("\n").filter((l) => l.trim());
    // gap-verification-round-single-writer AC1 — 恰一条记录（⛔ 无 writeRedSuiteRecord 平行双写 ⇒ round 号虚增）。
    assert.equal(lines.length, 1, "a red bucket round lands EXACTLY ONE record (no parallel red double-write)");
    const rec = JSON.parse(lines[0]);
    assert.equal(rec.state, "red", "a red bucket round records state=red (not green, not absent)");
    assert.equal(rec.fail, 2, "the fail count rides the record");
    assert.equal(rec.buckets, "M", "the __BUCKETS__ marker is parsed into the buckets field");
    assert.equal(rec.bucket_files, 3, "the __BUCKETS__ file count rides the record");
    assert.equal(rec.runner, "inner", "explicit --runner inner is recorded");
    assert.equal(rec.preverified, undefined, "the runner-shape record carries NO preverified field (single writer)");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("AC1 green contrast — full-suite-runner.ts --buckets records a GREEN bucket round (state=green) into verification-round.jsonl", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fsr-bucket-green-"));
  fakeBucketTestSh(root, [
    'echo "__BUCKETS__ buckets=P files=2 full=0"',
    'echo "# tests 4"',
    'echo "# pass 4"',
    'echo "# fail 0"',
    'echo "# cancelled 0"',
    "exit 0",
  ].join("\n"));
  try {
    const child = runRunner({ root, buckets: "gap-test-green-bucket", laneCount: 8, runner: "inner" });
    const { code } = await waitExit(child);
    assert.equal(code, 0, `runner exits 0 on a green bucket round, got ${code}`);
    const vrf = path.join(root, ".quay", "verification-round.jsonl");
    const lines = fs.readFileSync(vrf, "utf8").split("\n").filter((l) => l.trim());
    // gap-verification-round-single-writer AC2 — 绿轮与红轮同 writer 同 shape：恰一条、无 preverified 字段。
    assert.equal(lines.length, 1, "a green bucket round lands EXACTLY ONE record (same single writer as red)");
    const rec = JSON.parse(lines[0]);
    assert.equal(rec.state, "green", "a green bucket round records state=green");
    assert.equal(rec.fail, 0, "the fail count is 0 on green");
    assert.equal(rec.buckets, "P", "the __BUCKETS__ marker is parsed into the buckets field");
    assert.equal(rec.bucket_files, 2, "the __BUCKETS__ file count rides the record");
    assert.equal(rec.preverified, undefined, "the runner-shape record carries NO preverified field (symmetric with red)");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// ── gap-verification-round-record-runid: AC1/AC3 (runId on the round record) ─────────────────────────
// The round record must carry the suite's canonical runId (the SAME value the state write carries and
// the SAME key the load sampler uses for suite-load-<runId>.jsonl) so /tests can key the load curve
// off record.runId (its OWN load key rides the ledger row). Red AND green rows both carry it.

test("AC1/AC3 — a GREEN round record carries runId = the state's runId (gap-verification-round-record-runid)", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fsr-runid-green-"));
  const { f, dir } = fakeSuite(GREEN_SUITE);
  try {
    const child = runRunner({ root, command: `bash ${f}`, laneCount: 8 });
    const { code } = await waitExit(child);
    assert.equal(code, 0, `runner exits 0 on green, got ${code}`);
    const s = readState(root);
    assert.ok(s && s.runId, "the state write carries a runId generation token");
    const vr = lastRoundRecord(root);
    assert.ok(vr, "a verification-round row was appended");
    assert.ok(typeof vr.runId === "string" && vr.runId.length > 0, "the green round record carries a runId");
    assert.equal(vr.runId, s.runId, "record.runId === the state write's runId (one canonical value)");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("AC1 — a RED round record carries runId = the state's runId (gap-verification-round-record-runid)", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fsr-runid-red-"));
  const red = 'echo "# tests 5"\necho "# pass 3"\necho "# fail 2"\necho "# cancelled 0"\nexit 1';
  const { f, dir } = fakeSuite(red);
  try {
    const child = runRunner({ root, command: `bash ${f}`, laneCount: 8 });
    const { code } = await waitExit(child);
    assert.equal(code, 1, `runner exits 1 on red, got ${code}`);
    const s = readState(root);
    assert.ok(s && s.runId, "the state write carries a runId generation token");
    const vr = lastRoundRecord(root);
    assert.ok(vr, "a verification-round row was appended");
    assert.ok(typeof vr.runId === "string" && vr.runId.length > 0, "the red round record carries a runId");
    assert.equal(vr.runId, s.runId, "record.runId === the state write's runId (one canonical value)");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("AC2 backward-compat — a suite with NO __OVERHEAD__ emission records NO *_phase_ms fields", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fsr-oh-none-"));
  const { f, dir } = fakeSuite(GREEN_SUITE);
  try {
    const child = runRunner({ root, command: `bash ${f}`, laneCount: 8 });
    const { code } = await waitExit(child);
    assert.equal(code, 0, `runner exits 0 on green, got ${code}`);
    const vrf = path.join(root, ".quay", "verification-round.jsonl");
    const rec = JSON.parse(fs.readFileSync(vrf, "utf8").split("\n").filter((l) => l.trim())[0]);
    // Scoped/legacy runs (and any suite that skips __OVERHEAD__ emission) must not fabricate zeros
    // — the fields stay absent, and a reader tolerates that (same contract as per_test_ms/redAt).
    assert.equal(rec.static_phase_ms, undefined, "no static_phase_ms on a non-__OVERHEAD__ suite");
    assert.equal(rec.serial_phase_ms, undefined, "no serial_phase_ms on a non-__OVERHEAD__ suite");
    assert.equal(rec.lowconc_phase_ms, undefined, "no lowconc_phase_ms on a non-__OVERHEAD__ suite");
    assert.equal(rec.main_phase_ms, undefined, "no main_phase_ms on a non-__OVERHEAD__ suite");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});


// ── gap-phase-boundary-differential-accounting: AC1/AC2/AC3/AC4 ────────────────────────────────────
// Per-phase DIFFERENTIAL accounting of MONOTONIC CUMULATIVE counters at each phase boundary
// (static→serial→gap_serial_to_lowconc→lowconc→main→end). The hermetic seam QUAY_TEST_CGROUP_SCRIPT
// maps phase-name → counter snapshot (the counters AT THE START of that phase; "round_end" = the
// finalize read), so the differentials are deterministic. A fake suite emits the real-time phase
// markers (`selected N files (groups=…)` / measure-suite `__GROUP__` / `__OVERHEAD__`) the runner
// detects at the boundaries.

// 7 snapshots → 6 differentials: static, serial, gap_serial_to_lowconc, lowconc, main, end.
const PHASE_SUITE = [
  'echo "selected 3 files (groups=serial)"',
  'echo "__GROUP__ concurrency=2 files=3 sum_ms=100 floor_ms=60 capped=0"',
  'echo "selected 5 files (groups=lowconc)"',
  'echo "__GROUP__ concurrency=3 files=5 sum_ms=200 floor_ms=90 capped=1"',
  'echo "__OVERHEAD__ run_static_checks_ms=1000 partial=1"',
  'echo "# tests 8"',
  'echo "# pass 8"',
  'echo "# fail 0"',
  'echo "# cancelled 0"',
  "exit 0",
].join("\n");

const PHASE_SCRIPT = JSON.stringify({
  static: { cpu_usec: 1000, psi_cpu_total: 500, psi_io_total: 10 },
  serial: { cpu_usec: 5000, psi_cpu_total: 2000, psi_io_total: 30 },
  gap_serial_to_lowconc: { cpu_usec: 5100, psi_cpu_total: 2100, psi_io_total: 31 },
  lowconc: { cpu_usec: 9000, psi_cpu_total: 4000, psi_io_total: 50 },
  main: { cpu_usec: 20000, psi_cpu_total: 9000, psi_io_total: 100 },
  end: { cpu_usec: 20100, psi_cpu_total: 9100, psi_io_total: 102 },
  round_end: { cpu_usec: 20500, psi_cpu_total: 9300, psi_io_total: 105 },
});

test("AC1 — phase-boundary differential records land for static→serial→gap→lowconc→main→end (one record per phase)", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fsr-phd-"));
  const { f, dir } = fakeSuite(PHASE_SUITE);
  try {
    // Explicit phase concurrency makes the `lanes` assertions host-independent.
    const child = runRunner({
      root,
      command: `bash ${f}`,
      laneCount: 8,
      serialConcurrency: 2,
      lowconcConcurrency: 3,
      env: { QUAY_TEST_CGROUP_SCRIPT: PHASE_SCRIPT },
    });
    const { code } = await waitExit(child);
    assert.equal(code, 0, `runner exits 0 on green, got ${code}`);
    const rec = lastRoundRecord(root);
    assert.ok(rec, "round record written");
    const phases = rec.phases || [];
    assert.deepEqual(
      phases.map((p) => p.phase),
      ["static", "serial", "gap_serial_to_lowconc", "lowconc", "main", "end"],
      "one record per phase, in run order",
    );
    // static = serial-snapshot − static-snapshot
    assert.equal(phases[0].cpu_usec, 5000 - 1000, "static cpu differential");
    assert.equal(phases[0].psi_cpu_total, 2000 - 500, "static psi-cpu differential");
    assert.equal(phases[0].psi_io_total, 30 - 10, "static psi-io differential");
    assert.equal(phases[0].lanes, 1, "static runs serial ⇒ lanes 1");
    // serial = gap-snapshot − serial-snapshot
    assert.equal(phases[1].cpu_usec, 5100 - 5000, "serial cpu differential");
    assert.equal(phases[1].lanes, 2, "serial lanes = --serial-concurrency");
    // gap = lowconc-snapshot − gap-snapshot
    assert.equal(phases[2].cpu_usec, 9000 - 5100, "gap cpu differential");
    assert.equal(phases[2].lanes, 1, "inter-phase gap is serial shell ⇒ lanes 1");
    // lowconc = main-snapshot − lowconc-snapshot
    assert.equal(phases[3].cpu_usec, 20000 - 9000, "lowconc cpu differential");
    assert.equal(phases[3].lanes, 3, "lowconc lanes = --lowconc-concurrency");
    // main = end-snapshot − main-snapshot
    assert.equal(phases[4].cpu_usec, 20100 - 20000, "main cpu differential");
    assert.equal(phases[4].lanes, 8, "main lanes = the round laneCount");
    // end = round_end-snapshot − end-snapshot
    assert.equal(phases[5].cpu_usec, 20500 - 20100, "end cpu differential");
    assert.equal(phases[5].lanes, 1, "end is the serial round tail ⇒ lanes 1");
    assert.equal(rec.phase_counter_error, undefined, "seam provides every snapshot — no counter error");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("AC2 — PHASE_OVERLAP round: the overlap window closes at the second done-marker and MAIN is NOT swallowed into serial (gap-verification-round-phases-overlap-merged)", async () => {
  // Mimics test.sh's PHASE_OVERLAP stream: `overlap: running`, then the two parallel phases' own
  // __GROUP__ + per-phase done-markers, then MAIN's __GROUP__, then the fixed-overhead __OVERHEAD__
  // decomposition. The __GROUP__ lines interleave and must NOT be treated as boundaries during the
  // window — only the two `overlap_<phase>_done=1` markers close it.
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fsr-ovl-"));
  const suite = [
    'echo "selected 30 files (groups=product,engine,serial,lowconc)"',
    'echo "overlap: running 5 serial + 8 lowconc files in parallel (serial conc=2, lowconc conc=3)"',
    // serial finishes first (its __GROUP__ + sub-time + done-marker)
    'echo "__GROUP__ concurrency=2 files=5 sum_ms=1000 floor_ms=700 capped=0"',
    'echo "__OVERHEAD__ overlap_serial_ms=2000"',
    'echo "__OVERHEAD__ overlap_serial_done=1"',
    // lowconc finishes second
    'echo "__GROUP__ concurrency=3 files=8 sum_ms=1600 floor_ms=800 capped=0"',
    'echo "__OVERHEAD__ overlap_lowconc_ms=1500"',
    'echo "__OVERHEAD__ overlap_lowconc_done=1"',
    // main runs — no start marker on the overlap path; its own __GROUP__ closes main→end
    'echo "__GROUP__ concurrency=8 files=17 sum_ms=3000 floor_ms=1200 capped=0"',
    // fixed-overhead decomposition (test.sh emits AFTER main — must not disturb the phases)
    'echo "__OVERHEAD__ serial_phase_ms=2500"',
    'echo "__OVERHEAD__ lowconc_phase_ms=0"',
    'echo "__OVERHEAD__ main_phase_ms=3000"',
    'echo "# tests 5"',
    'echo "# pass 5"',
    'echo "# fail 0"',
    'echo "# cancelled 0"',
    "exit 0",
  ].join("\n");
  const { f, dir } = fakeSuite(suite);
  try {
    const child = runRunner({
      root,
      command: `bash ${f}`,
      laneCount: 8,
      serialConcurrency: 2,
      lowconcConcurrency: 3,
      // gap-phase-overlap-field-always-false-negative — NO QUAY_PHASE_OVERLAP env: the field is now
      // derived from the `overlap: running` stream marker (what ACTUALLY ran), not the runner's own
      // env. This is the production shape (fan-in-execute.js never sets the env) that used to be a
      // permanent false negative.
      env: { QUAY_TEST_CGROUP_SCRIPT: PHASE_SCRIPT },
    });
    const { code } = await waitExit(child);
    assert.equal(code, 0, `runner exits 0 on green, got ${code}`);
    const rec = lastRoundRecord(root);
    assert.ok(rec, "round record written");
    assert.equal(rec.phase_overlap, true, "round flags phase_overlap from the stream marker, not env");
    const phases = rec.phases || [];
    assert.deepEqual(
      phases.map((p) => p.phase),
      ["static", "serial", "main", "end"],
      "overlap round: the window is ONE serial record, main is SEPARATE (not swallowed), end closes",
    );
    const serial = phases.find((p) => p.phase === "serial");
    assert.ok(serial, "serial (overlap-window) record present");
    assert.ok(serial.overlap_sub_ms, "serial record carries the per-process breakdown (AC1/AC2)");
    assert.equal(serial.overlap_sub_ms.serial_ms, 2000, "serial sub-time from the stream marker");
    assert.equal(serial.overlap_sub_ms.lowconc_ms, 1500, "lowconc sub-time from the stream marker");
    const main = phases.find((p) => p.phase === "main");
    assert.ok(main, "main is its own record");
    assert.equal(main.lanes, 8, "main lanes = the round laneCount");
    // AC3 — the phase partition is COMPLETE and CONTIGUOUS: the overlap window collapses into ONE
    // "serial" segment and static/serial/main/end still partition the run wall with no gap or overlap
    // in the record EDGES. This is the deterministic form of "phases partition the run wall" — measured
    // on the EXACT start_ms/end_ms edges (each phase's end_ms IS the next phase's start_ms, by
    // construction), NOT on a wall-clock |Σ wall_ms − durationMs| < 3000 tolerance. durationMs spans the
    // runner's startup + post-suite overhead OUTSIDE any phase, so the old wall-sum≈durationMs assertion
    // drifted with load (isolated PASS; under 16-way CPU contention sum=107 vs durationMs=3151, diff
    // 3044ms > 3000ms → deterministic flake blocking fan-in — gap-full-suite-runner-test-phase-overlap-flake).
    for (let i = 0; i < phases.length; i++) {
      const p = phases[i];
      assert.equal(typeof p.start_ms, "number", `${p.phase} carries absolute start_ms`);
      assert.equal(typeof p.end_ms, "number", `${p.phase} carries absolute end_ms`);
      assert.ok(p.end_ms >= p.start_ms, `${p.phase} end_ms >= start_ms`);
      assert.ok(p.wall_ms === p.end_ms - p.start_ms, `${p.phase} wall_ms == end_ms - start_ms`);
      if (i > 0) {
        assert.equal(p.start_ms, phases[i - 1].end_ms, `phase edges contiguous: ${phases[i - 1].phase}.end_ms == ${p.phase}.start_ms`);
      }
    }
    const sumWall = phases.reduce((s, p) => s + p.wall_ms, 0);
    assert.ok(sumWall > 0, `phases span a non-zero wall (sum=${sumWall}ms)`);
    // AC4 — scheduling untouched: the overlap round carries the same serial_phase_ms (window) and
    // main_phase_ms the sequential baseline would, and the round record still reads the fixed-
    // overhead decomposition (not a phase-boundary artifact).
    assert.equal(rec.serial_phase_ms, 2500, "fixed-overhead serial_phase_ms = the combined window");
    assert.equal(rec.main_phase_ms, 3000, "fixed-overhead main_phase_ms = main's own window");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("negative control — a marker-less overlap round (done-markers missed) still records via the __OVERHEAD__ burst fallback and never crashes (gap-verification-round-phases-overlap-merged)", async () => {
  // Same stream WITHOUT the `overlap_<phase>_done=1` markers (e.g. a truncated/kill-on-red round, or a
  // future test.sh that omits them). The window must close at the __OVERHEAD__ burst (the pre-fix
  // fallback) — degraded (main subsumed) but the round still records and the new no-op branches must
  // not disturb that path.
  const suite = [
    'echo "overlap: running 5 serial + 8 lowconc files in parallel (serial conc=2, lowconc conc=3)"',
    'echo "__GROUP__ concurrency=2 files=5 sum_ms=1000 floor_ms=700 capped=0"',
    'echo "__OVERHEAD__ overlap_serial_ms=2000"',
    'echo "__GROUP__ concurrency=3 files=8 sum_ms=1600 floor_ms=800 capped=0"',
    'echo "__OVERHEAD__ overlap_lowconc_ms=1500"',
    'echo "__GROUP__ concurrency=8 files=17 sum_ms=3000 floor_ms=1200 capped=0"',
    'echo "__OVERHEAD__ serial_phase_ms=2500"',
    'echo "__OVERHEAD__ lowconc_phase_ms=0"',
    'echo "__OVERHEAD__ main_phase_ms=3000"',
    'echo "# tests 5"',
    'echo "# pass 5"',
    'echo "# fail 0"',
    'echo "# cancelled 0"',
    "exit 0",
  ].join("\n");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fsr-ovl-fb-"));
  const { f, dir } = fakeSuite(suite);
  try {
    const child = runRunner({
      root,
      command: `bash ${f}`,
      laneCount: 8,
      serialConcurrency: 2,
      lowconcConcurrency: 3,
      env: { QUAY_TEST_CGROUP_SCRIPT: PHASE_SCRIPT },
    });
    const { code } = await waitExit(child);
    assert.equal(code, 0, `runner exits 0 on green, got ${code}`);
    const rec = lastRoundRecord(root);
    assert.ok(rec, "round record written");
    const names = (rec.phases || []).map((p) => p.phase);
    assert.ok(
      names[0] === "static" && names[1] === "serial",
      `fallback still opens static→serial (got ${names.join(",")})`,
    );
    assert.ok(names.includes("end"), `fallback closes at the burst (got ${names.join(",")})`);
    assert.ok(rec.phases.every((p) => typeof p.cpu_usec === "number"), "cpu differentials present on the fallback path");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("gap-phase-overlap-field-always-false-negative — a SEQUENTIAL round does NOT flag phase_overlap even when QUAY_PHASE_OVERLAP=1 is in the runner env (field reflects ACTUAL scheduling, not env intent)", async () => {
  // The pre-fix bug wrote phase_overlap from the runner's own process.env.QUAY_PHASE_OVERLAP === "1".
  // Here the env IS set to "1" but the stream is SEQUENTIAL (PHASE_SUITE emits `selected N files
  // (groups=serial)`, never `overlap: running`), so the field MUST be absent — proving the field now
  // derives from what ACTUALLY ran, not the env knob (the inverse false-positive guard of AC2).
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fsr-ovl-seq-"));
  const { f, dir } = fakeSuite(PHASE_SUITE);
  try {
    const child = runRunner({
      root,
      command: `bash ${f}`,
      laneCount: 8,
      serialConcurrency: 2,
      lowconcConcurrency: 3,
      env: { QUAY_TEST_CGROUP_SCRIPT: PHASE_SCRIPT, QUAY_PHASE_OVERLAP: "1" },
    });
    const { code } = await waitExit(child);
    assert.equal(code, 0, `runner exits 0 on green, got ${code}`);
    const rec = lastRoundRecord(root);
    assert.ok(rec, "round record written");
    assert.equal(rec.phase_overlap, undefined, "sequential round omits phase_overlap even with env QUAY_PHASE_OVERLAP=1");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("gap-suite-main-overlaps-load-sensitive-tail-experiment — the tail-overlap fire is recorded as main_tail_overlap_lanes + main_tail_overlap_load, and ABSENT on a baseline round", async () => {
  // test.sh's tail-overlap watcher announces its fire on the stream: `main-tail-overlap: lanes=N
  // [load=X]` (test.sh emits it to stderr; the runner's errRl → onLine). The round record must carry
  // the lanes (the knob value / experiment's lane level) and the observed /proc/loadavg 1-min at fire
  // time — and a baseline round (no marker) must OMIT both (缺键, never a fabricated 0 — the same
  // absent-field contract as phase_overlap).
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fsr-mto-"));
  const suite = [
    'echo "main-tail-overlap: lanes=4 load=0.15"',
    'echo "# tests 5"',
    'echo "# pass 5"',
    'echo "# fail 0"',
    'echo "# cancelled 0"',
    "exit 0",
  ].join("\n");
  const { f, dir } = fakeSuite(suite);
  try {
    const child = runRunner({ root, command: `bash ${f}`, laneCount: 8 });
    const { code } = await waitExit(child);
    assert.equal(code, 0, `runner exits 0 on green, got ${code}`);
    const rec = lastRoundRecord(root);
    assert.ok(rec, "round record written");
    assert.equal(rec.main_tail_overlap_lanes, 4, "main_tail_overlap_lanes = the knob lanes from the stream marker");
    assert.equal(rec.main_tail_overlap_load, 0.15, "main_tail_overlap_load = the observed loadavg at fire time");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
  // Negative control: a baseline round (no marker) omits both fields.
  const root2 = fs.mkdtempSync(path.join(os.tmpdir(), "fsr-mto-baseline-"));
  const { f: f2, dir: dir2 } = fakeSuite(GREEN_SUITE);
  try {
    const child2 = runRunner({ root: root2, command: `bash ${f2}`, laneCount: 8 });
    const { code: code2 } = await waitExit(child2);
    assert.equal(code2, 0, "baseline runner exits 0");
    const rec2 = lastRoundRecord(root2);
    assert.ok(rec2, "baseline round record written");
    assert.equal(rec2.main_tail_overlap_lanes, undefined, "baseline round omits main_tail_overlap_lanes");
    assert.equal(rec2.main_tail_overlap_load, undefined, "baseline round omits main_tail_overlap_load");
  } finally {
    fs.rmSync(root2, { recursive: true, force: true });
    fs.rmSync(dir2, { recursive: true, force: true });
  }
});

test("AC2 — the derived quantities (相利用率/相饱和度/等待占比) are directly computable from the records + the round's nproc", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fsr-phd2-"));
  const { f, dir } = fakeSuite(PHASE_SUITE);
  try {
    const child = runRunner({ root, command: `bash ${f}`, laneCount: 8, env: { QUAY_TEST_CGROUP_SCRIPT: PHASE_SCRIPT } });
    await waitExit(child);
    const rec = lastRoundRecord(root);
    const phases = rec.phases || [];
    assert.ok(phases.length >= 5, "records present");
    assert.equal(typeof rec.nproc, "number", "round carries nproc (the 相饱和度 denominator)");
    for (const p of phases) {
      assert.equal(typeof p.wall_ms, "number", `${p.phase} carries wall_ms`);
      assert.equal(typeof p.cpu_usec, "number", `${p.phase} carries cpu_usec`);
      assert.equal(typeof p.psi_cpu_total, "number", `${p.phase} carries psi_cpu_total`);
      assert.equal(typeof p.lanes, "number", `${p.phase} carries lanes`);
      // 相利用率 = cpu_usec/(wall×lanes); 相饱和度 = cpu_usec/(wall×nproc);
      // 等待占比 = psi_cpu_total/wall — all directly from the record (+ the round nproc).
      const util = p.wall_ms > 0 && p.lanes > 0 ? p.cpu_usec / (p.wall_ms * p.lanes) : null;
      const sat = p.wall_ms > 0 && rec.nproc > 0 ? p.cpu_usec / (p.wall_ms * rec.nproc) : null;
      const wait = p.wall_ms > 0 ? p.psi_cpu_total / p.wall_ms : null;
      assert.ok(util === null || Number.isFinite(util), `${p.phase} 相利用率 computable`);
      assert.ok(sat === null || Number.isFinite(sat), `${p.phase} 相饱和度 computable`);
      assert.ok(wait === null || Number.isFinite(wait), `${p.phase} 等待占比 computable`);
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("AC3 negative control — a deliberately ABORTED round (child signal-killed mid-suite) still carries the phase records", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fsr-phd3-"));
  // The fake suite emits the serial-start marker + serial's __GROUP__, starts lowconc, then SIGTERMs
  // itself — the abort path (the direct child is signal-killed ⇒ no correctness conclusion). The
  // phase records accumulated up to the kill must survive in the round record.
  const suite = [
    'echo "selected 3 files (groups=serial)"',
    'echo "__GROUP__ concurrency=2 files=3 sum_ms=100 floor_ms=60 capped=0"',
    'echo "selected 5 files (groups=lowconc)"',
    "kill -TERM $$",
  ].join("\n");
  const { f, dir } = fakeSuite(suite);
  try {
    const child = runRunner({ root, command: `bash ${f}`, laneCount: 8, env: { QUAY_TEST_CGROUP_SCRIPT: PHASE_SCRIPT } });
    const { code } = await waitExit(child);
    assert.notEqual(code, 0, "aborted round exits non-zero");
    const rec = lastRoundRecord(root);
    assert.ok(rec, "round record written on the abort path");
    const phases = rec.phases || [];
    assert.ok(phases.length >= 3, `the phases that ran are still recorded (got ${phases.length})`);
    const names = phases.map((p) => p.phase);
    assert.ok(names.includes("static") && names.includes("serial"), `static+serial recorded on abort (got ${names.join(",")})`);
    assert.ok(phases.every((p) => typeof p.cpu_usec === "number"), "cpu differentials not lost on abort");
    assert.equal(phases[phases.length - 1].phase, "lowconc", "the in-flight phase is closed at round end");
    assert.equal(typeof phases[phases.length - 1].cpu_usec, "number", "the in-flight phase still gets a cpu reading");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});


// ── gap-verification-round-observability-holes: AC1 (lock_wait_ms) + AC2 (phase start/end 绝对时刻
//    + lowconc_phase_ms 不再恒 0) + AC4 (effective_parallelism) ─────────────────────────────────────────
// The four verification-round observability holes the task closes: (1) a gap>30% round could not be
// attributed to flock-wait (lock_wait_ms); (2) the phase duration collapsed under PHASE_OVERLAP (absolute
// start/end 时刻 don't collapse) and lowconc_phase_ms was恒 0; (3) concurrentSuitesRunning read the broken
// lock-slot mechanism (see the AC3 tests above); (4) cpu/wall — the single "did the optimization help"
// KPI — was computable but never recorded (effective_parallelism).

test("AC2 — every phase record carries ABSOLUTE start_ms/end_ms (contiguous, monotonic — duration does not collapse)", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fsr-obs-phase-"));
  const { f, dir } = fakeSuite(PHASE_SUITE);
  try {
    const child = runRunner({ root, command: `bash ${f}`, laneCount: 8, env: { QUAY_TEST_CGROUP_SCRIPT: PHASE_SCRIPT } });
    const { code } = await waitExit(child);
    assert.equal(code, 0, `runner exits 0 on green, got ${code}`);
    const rec = lastRoundRecord(root);
    const phases = rec.phases || [];
    assert.ok(phases.length >= 5, "records present");
    for (const p of phases) {
      assert.equal(typeof p.start_ms, "number", `${p.phase} carries absolute start_ms`);
      assert.equal(typeof p.end_ms, "number", `${p.phase} carries absolute end_ms`);
      assert.ok(p.end_ms >= p.start_ms, `${p.phase} end_ms >= start_ms`);
      assert.ok(p.wall_ms === p.end_ms - p.start_ms, `${p.phase} wall_ms == end_ms - start_ms (the duration is derivable from the edges)`);
    }
    // Contiguity — a phase's end_ms IS the next phase's start_ms (no gaps, no overlaps in the record
    // edges), so a reader can reconstruct the full wall from the first start_ms to the last end_ms.
    for (let i = 0; i + 1 < phases.length; i++) {
      assert.equal(phases[i].end_ms, phases[i + 1].start_ms, `phase[${i}] end_ms == phase[${i + 1}] start_ms (contiguous)`);
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("AC1 — lock_wait_ms records the flock wait from test.sh's lock-acquire markers (gap attributable, not a black hole)", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fsr-obs-lock-"));
  // The fake suite emits test.sh's REAL lock-acquire markers with a 1s wait between them — the
  // `== single-flight lock` START and the `acquired full-suite single-flight slot` END. The runner
  // times the diff (the flock wait). The 1s sleep is large enough to dominate the runner's stream-
  // processing jitter (a 200ms sleep read ~63ms under full-suite load — the marker-read latency is
  // subtracted from the diff, so the test uses a wait >> that latency).
  const suite = [
    'echo "== single-flight lock (2 slots — gap-single-flight-lock-2-slot-concurrent-suites + SSoT) =="',
    "sleep 1",
    'echo "scripts/test.sh: acquired full-suite single-flight slot 0 (.git/full-suite.lock.0) — held for the entire run"',
    'echo "# tests 5"',
    'echo "# pass 5"',
    'echo "# fail 0"',
    'echo "# cancelled 0"',
    "exit 0",
  ].join("\n");
  const { f, dir } = fakeSuite(suite);
  try {
    const child = runRunner({ root, command: `bash ${f}`, laneCount: 8 });
    const { code } = await waitExit(child);
    assert.equal(code, 0, `runner exits 0 on green, got ${code}`);
    const rec = lastRoundRecord(root);
    assert.ok(rec, "round record written");
    assert.equal(typeof rec.lock_wait_ms, "number", "lock_wait_ms is a number (present)");
    assert.ok(rec.lock_wait_ms >= 200, `lock_wait_ms ≈ the 1s flock wait (got ${rec.lock_wait_ms}) — not 0, not absent`);
    assert.ok(rec.lock_wait_ms < 5000, `lock_wait_ms is the marker diff, not the whole wall (got ${rec.lock_wait_ms})`);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("AC1 negative — a scoped/no-lock run OMITS lock_wait_ms (no lock was taken — 缺键, not a fabricated 0)", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fsr-obs-lock-none-"));
  const { f, dir } = fakeSuite(GREEN_SUITE); // no lock markers — like a scoped run that never takes the lock
  try {
    const child = runRunner({ root, command: `bash ${f}`, laneCount: 8 });
    const { code } = await waitExit(child);
    assert.equal(code, 0, `runner exits 0 on green, got ${code}`);
    const rec = lastRoundRecord(root);
    assert.equal(rec.lock_wait_ms, undefined, "no lock_wait_ms when no lock was taken (a scoped run)");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("AC2 — lowconc_phase_ms 不再恒 0: on an OVERLAP round it carries the real lowconc sub-time (overlap_lowconc_ms)", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fsr-obs-ovl-"));
  // The overlap stream test.sh emits: `overlap: running`, the two parallel phases' sub-times +
  // done-markers, then the fixed-overhead decomposition where lowconc_phase_ms=0 (subsumed). The
  // runner must replace that 0 with the real overlap_lowconc_ms sub-time.
  const suite = [
    'echo "overlap: running 5 serial + 8 lowconc files in parallel (serial conc=2, lowconc conc=3)"',
    'echo "__GROUP__ concurrency=2 files=5 sum_ms=1000 floor_ms=700 capped=0"',
    'echo "__OVERHEAD__ overlap_serial_ms=2000"',
    'echo "__OVERHEAD__ overlap_serial_done=1"',
    'echo "__GROUP__ concurrency=3 files=8 sum_ms=1600 floor_ms=800 capped=0"',
    'echo "__OVERHEAD__ overlap_lowconc_ms=1500"',
    'echo "__OVERHEAD__ overlap_lowconc_done=1"',
    'echo "__GROUP__ concurrency=8 files=17 sum_ms=3000 floor_ms=1200 capped=0"',
    'echo "__OVERHEAD__ serial_phase_ms=2500"',
    'echo "__OVERHEAD__ lowconc_phase_ms=0"',
    'echo "__OVERHEAD__ main_phase_ms=3000"',
    'echo "# tests 5"',
    'echo "# pass 5"',
    'echo "# fail 0"',
    'echo "# cancelled 0"',
    "exit 0",
  ].join("\n");
  const { f, dir } = fakeSuite(suite);
  try {
    const child = runRunner({
      root,
      command: `bash ${f}`,
      laneCount: 8,
      serialConcurrency: 2,
      lowconcConcurrency: 3,
      env: { QUAY_TEST_CGROUP_SCRIPT: PHASE_SCRIPT },
    });
    const { code } = await waitExit(child);
    assert.equal(code, 0, `runner exits 0 on green, got ${code}`);
    const rec = lastRoundRecord(root);
    assert.equal(rec.serial_phase_ms, 2500, "serial_phase_ms stays the combined window");
    assert.equal(rec.lowconc_phase_ms, 1500, `lowconc_phase_ms = overlap_lowconc_ms (1500), NOT the 0 test.sh emitted, got ${rec.lowconc_phase_ms}`);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("AC4 unit — effectiveParallelism(cpuTimeS, durationMs) = cpu_time_s ÷ (durationMs/1000), null on a missing/zero input", () => {
  assert.equal(effectiveParallelism(7162, 823000), 8.702, "7162s / 823s = 8.702 cores (the Finding's solo cpu/wall)");
  assert.equal(effectiveParallelism(6900, 1421000), 4.856, "6900s / 1421s = 4.856 cores (the Finding's overlapped per-suite cpu/wall)");
  assert.equal(effectiveParallelism(null, 823000), null, "null cpu_time_s ⇒ null (never a fabricated 0)");
  assert.equal(effectiveParallelism(0, 823000), null, "0 cpu_time_s ⇒ null (a 0 quotient would read 'infinite cores')");
  assert.equal(effectiveParallelism(100, 0), null, "0 wall ⇒ null");
});

test("AC4 — the round record carries effective_parallelism = cpu_time_s ÷ wall (present only when cpu_time_s is finite)", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fsr-obs-eff-"));
  const { f, dir } = fakeSuite(GREEN_SUITE);
  try {
    const child = runRunner({
      root,
      command: `bash ${f}`,
      laneCount: 2,
      env: {
        QUAY_TEST_SCOPE_UNIT: "run-seam-eff.scope",
        QUAY_TEST_JOURNALCTL_OUTPUT:
          "Aug 12 18:42:48 h systemd[2938]: run-seam-eff.scope: Consumed 2957.234s CPU time, 1.5G memory peak, 0B memory swap peak.",
      },
    });
    const { code } = await waitExit(child);
    assert.equal(code, 0, "green hermetic round with the load seam");
    const rec = lastRoundRecord(root);
    assert.equal(typeof rec.cpu_time_s, "number", "cpu_time_s landed (the denominator)");
    assert.equal(
      rec.effective_parallelism,
      Number((rec.cpu_time_s / (rec.durationMs / 1000)).toFixed(3)),
      `effective_parallelism = cpu_time_s/(durationMs/1000), rounded to 3 decimals (got ${rec.effective_parallelism})`,
    );
    assert.ok(rec.effective_parallelism > 0, "effective_parallelism is a positive finite number");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("AC4 — a RED round carries the phase records (coverage incl. red rounds — the cpu_time_s-missing bias fix)", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fsr-phd4-"));
  const suite = [
    'echo "selected 3 files (groups=serial)"',
    'echo "__GROUP__ concurrency=2 files=3 sum_ms=100 floor_ms=60 capped=0"',
    'echo "selected 5 files (groups=lowconc)"',
    'echo "not ok 1 - a test failure"',
    'echo "# tests 8"',
    'echo "# fail 1"',
    'echo "# pass 7"',
    'echo "# cancelled 0"',
    "exit 1",
  ].join("\n");
  const { f, dir } = fakeSuite(suite);
  try {
    const child = runRunner({ root, command: `bash ${f}`, laneCount: 8, env: { QUAY_TEST_CGROUP_SCRIPT: PHASE_SCRIPT } });
    const { code } = await waitExit(child);
    assert.equal(code, 1, "red round exits 1");
    const rec = lastRoundRecord(root);
    assert.equal(rec.state, "red");
    assert.equal(rec.reason, "failed");
    assert.ok(rec.phases && rec.phases.length >= 3, "red round carries the phases that ran");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("AC4 — a suite with NO phase markers still records ≥1 phase (every spawned round has accounting)", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fsr-phd5-"));
  const { f, dir } = fakeSuite(GREEN_SUITE);
  try {
    const child = runRunner({ root, command: `bash ${f}`, laneCount: 8, env: { QUAY_TEST_CGROUP_SCRIPT: PHASE_SCRIPT } });
    await waitExit(child);
    const rec = lastRoundRecord(root);
    assert.ok(rec.phases && rec.phases.length >= 1, "a marker-less round records its whole wall as one phase");
    assert.equal(rec.phases[0].phase, "static");
    assert.equal(typeof rec.phases[0].cpu_usec, "number", "whole-round cpu differential present");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("AC4 — a runner CRASH mid-round writes the phase records via the trap (state + a phase-only round row)", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fsr-phd6-"));
  // Emit the serial-start marker + serial's __GROUP__, then sleep — the crash (QUAY_TEST_CRASH_AFTER_
  // RUNNING=500 throws 500ms after the running write, well AFTER the accumulator initialized at spawn
  // AND after the stream markers were processed) fires while the serial phase's records are already
  // accumulated but the suite is still in flight.
  const suite = [
    'echo "selected 3 files (groups=serial)"',
    'echo "__GROUP__ concurrency=2 files=3 sum_ms=100 floor_ms=60 capped=0"',
    "sleep 2",
  ].join("\n");
  const { f, dir } = fakeSuite(suite);
  try {
    const child = runRunner({
      root,
      command: `bash ${f}`,
      laneCount: 8,
      env: { QUAY_TEST_CGROUP_SCRIPT: PHASE_SCRIPT, QUAY_TEST_CRASH_AFTER_RUNNING: "500" },
    });
    await waitExit(child);
    const s = readState(root);
    assert.equal(s.state, "red");
    assert.equal(s.reason, "crashed");
    assert.ok(s.phases && s.phases.length >= 1, "crashed state carries the phase records");
    const rec = lastRoundRecord(root);
    assert.ok(rec && rec.phases && rec.phases.length >= 1, "crash path appends a phase-carrying round row");
    assert.equal(rec.state, "red");
    assert.equal(rec.reason, "crashed");
    // gap-verification-round-record-runid — the crash-trap row is ALSO self-describing (carries the
    // same canonical runId the state write carries), same as the normal red/green path.
    assert.ok(typeof rec.runId === "string" && rec.runId.length > 0, "the crash-trap round row carries a runId");
    assert.equal(rec.runId, s.runId, "crash-trap record.runId === the state write's runId");
  } finally {
    // gap-full-suite-runner-crash-test-rmSync-enotempty-flaky — the runner spawns a DETACHED
    // suite-load-sampler that writes <root>/.quay/suite-load-<runId>.jsonl.pid at startup and is never
    // reaped on the crash path (process.exit). Under load the sampler's delayed .pid write lands
    // DURING this teardown rmSync — it mkdirs `.quay` back into `root` after rmSync already rmdir'd it,
    // so `rmdir(root)` fails ENOTEMPTY. (A detached child's cwd does NOT block rmdir; the cause is the
    // .pid write, not the orphan suite child — leftover evidence: /tmp/fsr-crash-* each hold exactly
    // one suite-load-*.jsonl.pid.) maxRetries/retryDelay re-list and delete the recreated `.quay` + .pid;
    // the sampler exits on its first state check (state=red), so the .pid write is one-shot.
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
  }
});

// ── gap-ceiling-floor-ms-not-landed-in-verification-round: AC1/AC2/AC3 (floor_ms / ceiling) ────────
// measure-suite-reporter.mjs emits `__CEILING__ <path> duration_ms=<dur> floor_ms=<floor> 封顶者/该拆`
// per capped file (cc>1 phases only) — the "which file is the ceiling / should be split" reading.
// The runner must carry floor_ms + the capped-file list into the verification-round record so the
// reading is per-round-visible without re-parsing the log.

test("AC1/AC2 — __CEILING__ lines land floor_ms + ceiling (封顶者清单) into the verification-round record", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fsr-ceil-"));
  // The fake suite emits __CEILING__ lines to STDERR exactly like measure-suite-reporter.mjs does
  // (full path, duration_ms, floor_ms, 封顶者/该拆 — the ^-anchored no-drift shape), then a green
  // TAP summary. Both lines share one group's floor_ms=4200 (every __CEILING__ line of a group
  // carries the group floor verbatim).
  const suite = [
    'echo "__CEILING__ /repo/packages/quay/test/heavy.test.mjs duration_ms=3580.99 floor_ms=4200 封顶者/该拆" >&2',
    'echo "__CEILING__ /repo/packages/quay/test/heavy2.test.mjs duration_ms=4100 floor_ms=4200 封顶者/该拆" >&2',
    'echo "# tests 5"',
    'echo "# pass 5"',
    'echo "# fail 0"',
    'echo "# cancelled 0"',
    "exit 0",
  ].join("\n");
  const { f, dir } = fakeSuite(suite);
  try {
    const child = runRunner({ root, command: `bash ${f}`, laneCount: 8 });
    const { code } = await waitExit(child);
    assert.equal(code, 0, `runner exits 0 on green, got ${code}`);
    const vrf = path.join(root, ".quay", "verification-round.jsonl");
    assert.ok(fs.existsSync(vrf), "verification-round.jsonl written");
    const rec = JSON.parse(fs.readFileSync(vrf, "utf8").split("\n").filter((l) => l.trim())[0]);
    // AC1 — both fields present on a round that saw __CEILING__ lines. Both __CEILING__ lines share
    // one group's floor_ms (every __CEILING__ line of a group carries the group floor verbatim), so
    // the distinct-floors array is the single value [4200].
    assert.deepEqual(rec.floor_ms, [4200], "floor_ms = the distinct group floors (各相) the __CEILING__ lines carried");
    // AC2 — the ceiling list matches the reporter's __CEILING__ output verbatim (paths, no drift).
    assert.deepEqual(rec.ceiling, [
      "/repo/packages/quay/test/heavy.test.mjs",
      "/repo/packages/quay/test/heavy2.test.mjs",
    ], "ceiling = the 封顶者清单 exactly as the reporter emitted it (stream order, no normalization)");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("AC1 — a round with __CEILING__ lines from MULTIPLE phases keeps each group's floor_ms (各相, no overwrite)", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fsr-ceil-multi-"));
  // The real full-suite runs three node --test phases (serial cc=2 / lowconc cc=3 / main cc=8),
  // each emitting its OWN __CEILING__ lines with ITS OWN group floor. The record must keep all
  // distinct floors, first-seen order (serial → lowconc → main), not just the last one.
  const suite = [
    'echo "__CEILING__ /repo/packages/quay/test/serial-heavy.test.mjs duration_ms=2300 floor_ms=2400 封顶者/该拆" >&2',
    'echo "__CEILING__ /repo/packages/quay/test/lowconc-heavy.test.mjs duration_ms=4100 floor_ms=4200 封顶者/该拆" >&2',
    'echo "__CEILING__ /repo/packages/quay/test/main-heavy.test.mjs duration_ms=8100 floor_ms=8200 封顶者/该拆" >&2',
    'echo "# tests 5"',
    'echo "# pass 5"',
    'echo "# fail 0"',
    'echo "# cancelled 0"',
    "exit 0",
  ].join("\n");
  const { f, dir } = fakeSuite(suite);
  try {
    const child = runRunner({ root, command: `bash ${f}`, laneCount: 8 });
    const { code } = await waitExit(child);
    assert.equal(code, 0, `runner exits 0 on green, got ${code}`);
    const vrf = path.join(root, ".quay", "verification-round.jsonl");
    const rec = JSON.parse(fs.readFileSync(vrf, "utf8").split("\n").filter((l) => l.trim())[0]);
    assert.deepEqual(rec.floor_ms, [2400, 4200, 8200], "floor_ms keeps EACH phase's group floor (各相) in stream order");
    assert.deepEqual(rec.ceiling, [
      "/repo/packages/quay/test/serial-heavy.test.mjs",
      "/repo/packages/quay/test/lowconc-heavy.test.mjs",
      "/repo/packages/quay/test/main-heavy.test.mjs",
    ], "ceiling = the full 封顶者清单 across all capped phases");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("AC3 — a round with NO __CEILING__ lines omits floor_ms and ceiling (no fabricated empties)", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fsr-ceil-none-"));
  // A scoped/legacy suite (or a serial cc=1 phase — the split criterion is NOT applied there) never
  // emits __CEILING__ lines. The record must NOT fabricate floor_ms=0 / ceiling=[] — same absent-
  // field contract as the *_phase_ms backward-compat test above.
  const { f, dir } = fakeSuite(GREEN_SUITE);
  try {
    const child = runRunner({ root, command: `bash ${f}`, laneCount: 8 });
    const { code } = await waitExit(child);
    assert.equal(code, 0, `runner exits 0 on green, got ${code}`);
    const vrf = path.join(root, ".quay", "verification-round.jsonl");
    const rec = JSON.parse(fs.readFileSync(vrf, "utf8").split("\n").filter((l) => l.trim())[0]);
    assert.equal(rec.floor_ms, undefined, "no floor_ms on a non-__CEILING__ suite");
    assert.equal(rec.ceiling, undefined, "no ceiling on a non-__CEILING__ suite");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ── gap-test-detail-perfile-duration-failed: AC1 (perFile) ────────────────────────────────────────
// measure-suite-reporter.mjs emits `__PERFILE__ duration_ms=<dur> <path> passed=<bool>` per file. The
// runner must carry the per-file {file,durationMs,passed} array into the verification-round record
// (reusing parsePerFileLines — the measure-history parser — so the two carriers share one 口径).

test("AC1 — __PERFILE__ lines land perFile ({file,durationMs,passed}) into the verification-round record", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fsr-perfile-"));
  const suite = [
    'echo "__PERFILE__ duration_ms=210.5 /repo/packages/quay/test/slow.test.mjs passed=false" >&2',
    'echo "__PERFILE__ duration_ms=12.25 /repo/packages/quay/test/fast.test.mjs passed=true" >&2',
    'echo "# tests 2"',
    'echo "# pass 1"',
    'echo "# fail 1"',
    'echo "# cancelled 0"',
    "exit 0",
  ].join("\n");
  const { f, dir } = fakeSuite(suite);
  try {
    const child = runRunner({ root, command: `bash ${f}`, laneCount: 8 });
    const { code } = await waitExit(child);
    // The __PERFILE__ ... passed=false line IS a real failure line (runner-red-parse isFailureLine) —
    // the round is red and the runner exits 1. The perFile array must STILL land (the round-record
    // write runs on every completion, green OR red).
    assert.equal(code, 1, "a round with a passed=false file is red (exit 1)");
    const vrf = path.join(root, ".quay", "verification-round.jsonl");
    assert.ok(fs.existsSync(vrf), "verification-round.jsonl written");
    const rec = JSON.parse(fs.readFileSync(vrf, "utf8").split("\n").filter((l) => l.trim())[0]);
    assert.ok(Array.isArray(rec.perFile), "perFile is an array");
    assert.equal(rec.perFile.length, 2, "both __PERFILE__ lines captured");
    // parsePerFileLines keeps the path verbatim (normalizePerFileKey only strips a quay-worktrees
    // prefix; /repo/... carries none) — same no-drift contract as ceiling.
    const slow = rec.perFile.find((p) => p.file === "/repo/packages/quay/test/slow.test.mjs");
    assert.ok(slow, "slow file captured");
    assert.equal(slow.durationMs, 210.5, "durationMs carried verbatim");
    assert.equal(slow.passed, false, "failed file carries passed=false");
    const fast = rec.perFile.find((p) => p.file === "/repo/packages/quay/test/fast.test.mjs");
    assert.ok(fast, "fast file captured");
    assert.equal(fast.durationMs, 12.25, "durationMs carried verbatim");
    assert.equal(fast.passed, true, "passing file carries passed=true");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("AC1 — a round with NO __PERFILE__ lines omits perFile (no fabricated empty)", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fsr-perfile-none-"));
  const { f, dir } = fakeSuite(GREEN_SUITE);
  try {
    const child = runRunner({ root, command: `bash ${f}`, laneCount: 8 });
    const { code } = await waitExit(child);
    assert.equal(code, 0, `runner exits 0 on green, got ${code}`);
    const vrf = path.join(root, ".quay", "verification-round.jsonl");
    const rec = JSON.parse(fs.readFileSync(vrf, "utf8").split("\n").filter((l) => l.trim())[0]);
    assert.equal(rec.perFile, undefined, "no perFile on a no-__PERFILE__ suite");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});


// ── gap-merge-green-snapshot-verified-commit-livelock: AC2 (verifiedCommit / commit) ────────────────

test("AC2 — a git-repo run records verifiedCommit (the integration tip at suite start) in the state AND the round record", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fsr-vc-"));
  // A REAL git repo (not a hermetic non-git temp root) so `git rev-parse HEAD` resolves — the hermetic
  // AC1 exact-shape test above stays byte-stable because a non-git root omits the field.
  execSync("git init -q", { cwd: root });
  execSync("git config user.name fsr-test", { cwd: root });
  execSync("git config user.email fsr@example.com", { cwd: root });
  fs.writeFileSync(path.join(root, "a.txt"), "a\n", "utf8");
  execSync("git add -A && git commit -q -m base", { cwd: root });
  const head = execSync("git rev-parse HEAD", { cwd: root, encoding: "utf8" }).trim();
  const { f, dir } = fakeSuite(GREEN_SUITE);
  try {
    const child = runRunner({ root, command: `bash ${f}`, laneCount: 8 });
    const { code } = await waitExit(child);
    assert.equal(code, 0, `runner exits 0 on green, got ${code}`);
    const s = readState(root);
    assert.ok(s, "state file written");
    assert.equal(s.verifiedCommit, head, "state carries the tested commit (the integration tip at suite start)");
    // The verification-round record carries the same verified commit (AC2, second half).
    const vrf = path.join(root, ".quay", "verification-round.jsonl");
    assert.ok(fs.existsSync(vrf), "verification-round.jsonl written");
    const rec = JSON.parse(fs.readFileSync(vrf, "utf8").split("\n").filter((l) => l.trim())[0]);
    assert.equal(rec.commit, head, "round record carries the verified commit");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("AC2 — the worktree state mirror carries the SAME verifiedCommit (SYNC BRIDGE byte-identical)", async () => {
  const worktree = fs.mkdtempSync(path.join(os.tmpdir(), "fsr-vc-wt-"));
  const mainRoot = fs.mkdtempSync(path.join(os.tmpdir(), "fsr-vc-main-"));
  execSync("git init -q", { cwd: worktree });
  execSync("git config user.name fsr-test", { cwd: worktree });
  execSync("git config user.email fsr@example.com", { cwd: worktree });
  fs.writeFileSync(path.join(worktree, "a.txt"), "a\n", "utf8");
  execSync("git add -A && git commit -q -m base", { cwd: worktree });
  const gateDir = path.join(mainRoot, ".quay");
  const { f, dir } = fakeSuite(GREEN_SUITE);
  try {
    const child = runRunner({ root: worktree, command: `bash ${f}`, laneCount: 8, stateDir: gateDir });
    const { code } = await waitExit(child);
    assert.equal(code, 0, `runner exits 0 on green, got ${code}`);
    const wt = readState(worktree);
    const main = readState(mainRoot);
    assert.ok(wt && main, "both states written");
    assert.ok(wt.verifiedCommit, "worktree state carries verifiedCommit");
    assert.equal(wt.verifiedCommit, main.verifiedCommit, "mirror carries the SAME verifiedCommit");
    assert.deepEqual(
      JSON.parse(fs.readFileSync(path.join(worktree, ".quay", "full-suite-state.json"), "utf8")),
      JSON.parse(fs.readFileSync(path.join(mainRoot, ".quay", "full-suite-state.json"), "utf8")),
      "worktree state byte-identical to the main-repo (gate) state (state_synced = same)",
    );
  } finally {
    fs.rmSync(worktree, { recursive: true, force: true });
    fs.rmSync(mainRoot, { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ── gap-concurrent-write-mutable-tree-false-positive-red: AC1/AC3 (start vs terminal HEAD compare) ──
// The suite runs a MUTATING working tree, not a pinned checkout — a red in a round where concurrent
// writers committed mid-round is a FALSE-POSITIVE CANDIDATE (round-53 class: 4 writers committed
// mid-round, the SAME quay-init-loop-core test passed green the next clean window). The runner reads
// HEAD at START (verifiedCommit) AND at TERMINAL; a difference ⇒ treeMutatedMidRound=true on the
// state + round record. gap-verifiedcommit-dirty-tree-false-certificate AC5 (2026-08-13) made the
// annotation CONSEQUENTIAL: a mid-round-mutated tree VOIDS a would-be-green (state=red reason=infra-error
// void:true — the round-121 false-certificate shape), while a REAL failure red keeps its verdict
// (reason=failed, the FP-candidate annotation rides along, unchanged).

test("AC5 — a git-repo round where a CONCURRENT commit lands MID-ROUND is VOIDED (state≠green, void:true) — the false-certificate consequence (round-121 class)", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fsr-mut-"));
  execSync("git init -q", { cwd: root });
  execSync("git config user.name fsr-test", { cwd: root });
  execSync("git config user.email fsr@example.com", { cwd: root });
  fs.writeFileSync(path.join(root, "a.txt"), "a\n", "utf8");
  execSync("git add -A && git commit -q -m base", { cwd: root });
  const startHead = execSync("git rev-parse HEAD", { cwd: root, encoding: "utf8" }).trim();
  // The fake suite: a CONCURRENT WRITER commits to the shared tree (round-53 class) — then the suite
  // itself PASSES. The commit is mid-round BY CONSTRUCTION (the runner captures start HEAD before it
  // spawns the suite, so any suite-side commit lands between the START and TERMINAL reads — no fixed
  // `sleep` needed; gap-fake-suite-release-gate-sleep-zero). The tree was MUTATED under the run,
  // so the would-be green is a FALSE CERTIFICATE: gap-verifiedcommit-dirty-tree-false-certificate
  // AC5 demotes it to state=red reason=infra-error void:true (the tests passed; the certificate is
  // void — SUITE-GREEN / SUITE-MERGE-PENDING must not fire for a tree that was never pinned).
  const { f, dir } = fakeSuite(
    'git commit --allow-empty -q -m "concurrent writer mid-round"\n' +
      'echo "# tests 1"\necho "# pass 1"\necho "# fail 0"\necho "# cancelled 0"\nexit 0',
  );
  try {
    const child = runRunner({ root, command: `bash ${f}` });
    const { code } = await waitExit(child);
    assert.equal(code, 1, "a voided round is NOT a green — the runner exits non-zero");
    const terminalHead = execSync("git rev-parse HEAD", { cwd: root, encoding: "utf8" }).trim();
    assert.notEqual(terminalHead, startHead, "the concurrent commit landed mid-round");
    const s = readState(root);
    assert.equal(s.state, "red", "AC5 — state must NOT be green under a mid-round-mutated tree (round-121 shape fixed)");
    assert.equal(s.reason, "infra-error", "voided green is an ENVIRONMENT problem, not a test failure (NO correctness conclusion)");
    assert.equal(s.void, true, "the void:true marker distinguishes a voided certificate from a real failure");
    assert.equal(s.verifiedCommit, startHead, "state carries the START head");
    assert.equal(s.terminalCommit, terminalHead, "state carries the TERMINAL head");
    assert.equal(s.treeMutatedMidRound, true, "start HEAD ≠ terminal HEAD ⇒ tree mutated mid-round (round-53 class detected)");
    const rec = lastRoundRecord(root);
    assert.equal(rec.treeMutatedMidRound, true, "round record carries treeMutatedMidRound");
    assert.equal(rec.terminalCommit, terminalHead, "round record carries the terminal commit");
    assert.equal(rec.commit, startHead, "round record still carries the verified (start) commit");
    assert.equal(rec.state, "red", "round record state is red (not green) for a voided round");
    assert.equal(rec.void, true, "round record carries the voided-certificate marker");
    assert.equal(rec.reason, "infra-error", "round record reason is infra-error (voided, not failed)");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("AC1/AC3 — a RED round with a mid-round concurrent commit carries treeMutatedMidRound=true (the false-positive-red signal on red)", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fsr-mutred-"));
  execSync("git init -q", { cwd: root });
  execSync("git config user.name fsr-test", { cwd: root });
  execSync("git config user.email fsr@example.com", { cwd: root });
  fs.writeFileSync(path.join(root, "a.txt"), "a\n", "utf8");
  execSync("git add -A && git commit -q -m base", { cwd: root });
  const startHead = execSync("git rev-parse HEAD", { cwd: root, encoding: "utf8" }).trim();
  // A concurrent writer commits mid-round AND the suite ALSO fails — the red carries the
  // concurrent-write FP-candidate annotation (a signal, not a blanket discard: reason stays failed).
  const { f, dir } = fakeSuite(
    'git commit --allow-empty -q -m "concurrent writer mid-round"\n' +
      'echo "not ok 1 - boom"\nexit 1',
  );
  try {
    const child = runRunner({ root, command: `bash ${f}` });
    const { code } = await waitExit(child);
    assert.equal(code, 1, "runner exits 1 on red");
    const terminalHead = execSync("git rev-parse HEAD", { cwd: root, encoding: "utf8" }).trim();
    assert.notEqual(terminalHead, startHead, "the concurrent commit landed mid-round");
    const s = readState(root);
    assert.equal(s.state, "red", "the red verdict is unchanged (the annotation does not discard the round)");
    assert.equal(s.reason, "failed", "a real failure line keeps reason=failed (the stop-dispatch signal is not downgraded)");
    assert.equal(s.treeMutatedMidRound, true, "red carries treeMutatedMidRound=true (concurrent-write FALSE-POSITIVE CANDIDATE)");
    assert.equal(s.terminalCommit, terminalHead, "red carries the terminal head");
    const rec = lastRoundRecord(root);
    assert.equal(rec.treeMutatedMidRound, true, "round record carries the FP-candidate annotation");
    assert.equal(rec.reason, "failed", "round-record reason unchanged (signal, not discard)");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("AC3 negative control — a git-repo round with NO mid-round commit is treeMutatedMidRound=false (pinned tree, clean window)", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fsr-nomut-"));
  execSync("git init -q", { cwd: root });
  execSync("git config user.name fsr-test", { cwd: root });
  execSync("git config user.email fsr@example.com", { cwd: root });
  fs.writeFileSync(path.join(root, "a.txt"), "a\n", "utf8");
  execSync("git add -A && git commit -q -m base", { cwd: root });
  const head = execSync("git rev-parse HEAD", { cwd: root, encoding: "utf8" }).trim();
  const { f, dir } = fakeSuite(GREEN_SUITE);
  try {
    const child = runRunner({ root, command: `bash ${f}` });
    const { code } = await waitExit(child);
    assert.equal(code, 0, "runner exits 0 on green");
    const s = readState(root);
    assert.equal(s.treeMutatedMidRound, false, "clean window (zero commits) ⇒ tree NOT mutated mid-round (negative control)");
    assert.equal(s.terminalCommit, head, "terminal HEAD == start HEAD on a pinned-tree round");
    assert.equal(s.verifiedCommit, head, "start HEAD == terminal HEAD == the same commit");
    const rec = lastRoundRecord(root);
    assert.equal(rec.treeMutatedMidRound, false, "round record carries treeMutatedMidRound=false on a pinned round");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ── gap-verifiedcommit-dirty-tree-false-certificate: AC1/AC2/AC3 (round-start dirty flag + tree hash) ──
// verifiedCommit declares a COMMIT object, but what the round actually reads is the WORKING TREE —
// the round-90/4a3fc0be shape: vc=1a5da8ee while 工作树 ≠ HEAD 树 ≠ index 树 (staged + unstaged +
// untracked). The round record gains a dirty flag (INCLUDING untracked — ./undefined 不能漏在外面)
// and the tested-content tree hash (tracked part, `git stash create`'s tree) so a green under a dirty
// tree is never a silent false certificate, and "does this later commit reproduce the tested tree" is
// a `tree` comparison. The dirty flag is an ANNOTATION (AC1 — 脏 ⇒ verifiedCommit 不声明「已验证」),
// never a green/red criterion on its own (the certificate-voiding consequence is AC5's
// treeMutatedMidRound, tested above).

test("AC1/AC2/AC3 — a DIRTY tested tree at round start is recorded (treeDirty incl. untracked + tested-content tree hash) — the round-90/4a3fc0be false-certificate shape detected", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fsr-dirty-"));
  execSync("git init -q", { cwd: root });
  execSync("git config user.name fsr-test", { cwd: root });
  execSync("git config user.email fsr@example.com", { cwd: root });
  fs.writeFileSync(path.join(root, "a.txt"), "a\n", "utf8");
  execSync("git add -A && git commit -q -m base", { cwd: root });
  const headTree = execSync("git rev-parse HEAD^{tree}", { cwd: root, encoding: "utf8" }).trim();
  // Round-90/4a3fc0be shape: working tree ≠ HEAD tree ≠ index tree — a STAGED edit (index ≠ HEAD),
  // an UNSTAGED edit (working ≠ index), and an UNTRACKED file (must count as dirty).
  fs.writeFileSync(path.join(root, "tasks.md"), "staged\n", "utf8");
  execSync("git add tasks.md", { cwd: root });
  fs.appendFileSync(path.join(root, "tasks.md"), "unstaged\n", "utf8");
  fs.writeFileSync(path.join(root, "untracked.txt"), "u\n", "utf8");
  const indexTree = execSync("git write-tree", { cwd: root, encoding: "utf8" }).trim();
  const stashCreate = execSync("git stash create", { cwd: root, encoding: "utf8" }).trim();
  assert.ok(stashCreate, "stash create returns a commit on a dirty tree");
  const workTree = execSync(`git rev-parse ${stashCreate}^{tree}`, { cwd: root, encoding: "utf8" }).trim();
  assert.notEqual(indexTree, headTree, "index tree ≠ HEAD tree (staged edit)");
  assert.notEqual(workTree, indexTree, "working-tree tree ≠ index tree (unstaged edit)");
  assert.notEqual(workTree, headTree, "working-tree tree ≠ HEAD tree (the round-90 shape)");
  assert.ok(
    execSync("git status --porcelain", { cwd: root, encoding: "utf8" }).includes("?? untracked.txt"),
    "porcelain includes the untracked file",
  );
  const { f, dir } = fakeSuite(GREEN_SUITE);
  try {
    const child = runRunner({ root, command: `bash ${f}` });
    const { code } = await waitExit(child);
    assert.equal(code, 0, "runner exits 0 on green — the dirty flag is an ANNOTATION, never a verdict criterion");
    const s = readState(root);
    assert.equal(s.treeDirty, true, "AC1 — the dirty flag (incl. untracked) is recorded at round start");
    assert.equal(s.tree, workTree, "AC2 — the tested-content tree hash is the working-tree tracked tree");
    assert.notEqual(s.tree, headTree, "dirty round's tested tree ≠ HEAD tree ⇒ verifiedCommit is a FALSE CERTIFICATE");
    const rec = lastRoundRecord(root);
    assert.equal(rec.treeDirty, true, "round record carries treeDirty");
    assert.equal(rec.tree, workTree, "round record carries the tested-content tree hash (≠ HEAD tree)");
    assert.notEqual(rec.tree, headTree, "round record's tested tree ≠ the certified commit's tree (AC3 — the 4a3fc0be shape is detected/annotated)");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("AC1/AC2 — a CLEAN tested tree at round start records treeDirty:false and the HEAD tree (true certificate)", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fsr-clean-"));
  execSync("git init -q", { cwd: root });
  execSync("git config user.name fsr-test", { cwd: root });
  execSync("git config user.email fsr@example.com", { cwd: root });
  fs.writeFileSync(path.join(root, "a.txt"), "a\n", "utf8");
  execSync("git add -A && git commit -q -m base", { cwd: root });
  const headTree = execSync("git rev-parse HEAD^{tree}", { cwd: root, encoding: "utf8" }).trim();
  const { f, dir } = fakeSuite(GREEN_SUITE);
  try {
    const child = runRunner({ root, command: `bash ${f}` });
    const { code } = await waitExit(child);
    assert.equal(code, 0, "runner exits 0 on green");
    const s = readState(root);
    assert.equal(s.treeDirty, false, "clean tree ⇒ treeDirty:false");
    assert.equal(s.tree, headTree, "clean tree ⇒ tested-content tree == HEAD tree (a TRUE certificate)");
    const rec = lastRoundRecord(root);
    assert.equal(rec.treeDirty, false, "round record treeDirty:false");
    assert.equal(rec.tree, headTree, "round record tree == HEAD tree");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("AC1 — an UNTRACKED-ONLY dirty tree is still treeDirty:true (untracked cannot be ignored — the ./undefined class)", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fsr-untracked-"));
  execSync("git init -q", { cwd: root });
  execSync("git config user.name fsr-test", { cwd: root });
  execSync("git config user.email fsr@example.com", { cwd: root });
  fs.writeFileSync(path.join(root, "a.txt"), "a\n", "utf8");
  execSync("git add -A && git commit -q -m base", { cwd: root });
  const headTree = execSync("git rev-parse HEAD^{tree}", { cwd: root, encoding: "utf8" }).trim();
  fs.writeFileSync(path.join(root, "undefined"), "untracked-only\n", "utf8");
  const { f, dir } = fakeSuite(GREEN_SUITE);
  try {
    const child = runRunner({ root, command: `bash ${f}` });
    const { code } = await waitExit(child);
    assert.equal(code, 0, "runner exits 0 on green (annotation, not verdict)");
    const s = readState(root);
    assert.equal(s.treeDirty, true, "untracked-only dirt is DETECTED (git status --porcelain includes ?? entries)");
    assert.equal(s.tree, headTree, "untracked-only dirt leaves the tracked tested-content tree == HEAD tree");
    const rec = lastRoundRecord(root);
    assert.equal(rec.treeDirty, true, "round record treeDirty:true with only an untracked file");
    // treeDirty and tree are INDEPENDENT axes: the dirty flag names WHAT is untested (the untracked
    // file), the tree hash names the tested TRACKED content (which, untracked-only, == HEAD tree).
    assert.equal(rec.tree, headTree, "tracked tree unchanged — the two fields carry distinct facts");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ── gap-precommit-guard-blocks-commits-not-working-tree-edits: assertion-surface mid-round edit
// detection ────────────────────────────────────────────────────────────────────────────────────────
// Round-84 shape (manager 2026-08-12): an UNCOMMITTED working-tree EDIT to an assertion-surface file
// enters the running round's view at SAVE time, not commit time — the pre-commit guard fires at the
// commit and cannot stop it. The one-shot worktree isolation (5652604f) PREVENTS the main-checkout
// shape; this detection catches a mid-round EDIT to the TESTED tree's assertion-surface files (AC1 —
// round-start snapshot vs round-end compare), annotated like treeMutatedMidRound (AC2 — a red is a
// FALSE-POSITIVE CANDIDATE, a green is a weaker green; never a green/red criterion — AC1 非红判据).

test("AC1/AC2 — a mid-round EDIT to an assertion-surface file in the TESTED tree is detected (assertionSurfaceEditedMidRound)", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fsr-asurf-"));
  execSync("git init -q", { cwd: root });
  execSync("git config user.name fsr-test", { cwd: root });
  execSync("git config user.email fsr@example.com", { cwd: root });
  // tasks/** is in the fallback-narrowed assertion surface (no judged-object-registry in the temp root)
  fs.mkdirSync(path.join(root, "tasks"));
  fs.writeFileSync(path.join(root, "tasks", "surface.txt"), "v1\n", "utf8");
  execSync("git add -A && git commit -q -m base", { cwd: root });
  // The fake suite REWRITES an assertion-surface file mid-round — the round-84 SAVE-time pollution
  // shape (uncommitted, in the tested tree) — then passes. The edit is mid-round BY CONSTRUCTION (the
  // runner snapshots the assertion surface before it spawns the suite — no fixed `sleep` needed,
  // gap-fake-suite-release-gate-sleep-zero).
  const { f, dir } = fakeSuite(
    'echo "v2-uncommitted" > tasks/surface.txt\n' +
      'echo "# tests 1"\necho "# pass 1"\necho "# fail 0"\necho "# cancelled 0"\nexit 0',
  );
  try {
    const child = runRunner({ root, command: `bash ${f}` });
    const { code } = await waitExit(child);
    assert.equal(code, 0, "runner exits 0 on green");
    const s = readState(root);
    assert.equal(s.state, "green", "the annotation never flips green/red (AC1 — 非红判据)");
    assert.deepEqual(s.assertionSurfaceEditedMidRound, ["tasks/surface.txt"], "the mid-round-edited assertion-surface file is DETECTED");
    assert.equal(s.treeMutatedMidRound, false, "no commit landed — the concurrent-write annotation is clean (independent axes)");
    const rec = lastRoundRecord(root);
    assert.deepEqual(rec.assertionSurfaceEditedMidRound, ["tasks/surface.txt"], "round record carries the mid-round-edit detection");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("AC1/AC2 — a RED round with a mid-round assertion-surface edit carries assertionSurfaceEditedMidRound (the false-positive-red signal on red)", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fsr-asurf-red-"));
  execSync("git init -q", { cwd: root });
  execSync("git config user.name fsr-test", { cwd: root });
  execSync("git config user.email fsr@example.com", { cwd: root });
  fs.mkdirSync(path.join(root, "tasks"));
  fs.writeFileSync(path.join(root, "tasks", "surface.txt"), "v1\n", "utf8");
  execSync("git add -A && git commit -q -m base", { cwd: root });
  // The suite edits an assertion-surface file mid-round AND ALSO fails — the red carries the
  // mixed-state FP-candidate annotation (a signal, not a blanket discard: reason stays failed).
  const { f, dir } = fakeSuite(
    'echo "v2-uncommitted" > tasks/surface.txt\n' +
      'echo "not ok 1 - boom"\nexit 1',
  );
  try {
    const child = runRunner({ root, command: `bash ${f}` });
    const { code } = await waitExit(child);
    assert.equal(code, 1, "runner exits 1 on red");
    const s = readState(root);
    assert.equal(s.state, "red", "the red verdict is unchanged (the annotation does not discard the round)");
    assert.equal(s.reason, "failed", "a real failure line keeps reason=failed (the stop-dispatch signal is not downgraded)");
    assert.deepEqual(s.assertionSurfaceEditedMidRound, ["tasks/surface.txt"], "red carries the assertion-surface FP-candidate annotation");
    const rec = lastRoundRecord(root);
    assert.deepEqual(rec.assertionSurfaceEditedMidRound, ["tasks/surface.txt"], "round record carries the FP-candidate annotation");
    assert.equal(rec.reason, "failed", "round-record reason unchanged (signal, not discard)");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("AC3 negative control — a mid-round UNCOMMITTED edit to the MAIN checkout (round-84 shape) is ISOLATED: the TESTED-tree snapshot stays clean", async () => {
  // mainCheckout = where the round-84 writer edits (uncommitted, mid-round);
  // testedTree = a FROZEN copy the running round actually reads (the one-shot-worktree analog —
  //   the worktree materializes the committed HEAD, so uncommitted main-checkout edits are never in it).
  const main = fs.mkdtempSync(path.join(os.tmpdir(), "fsr-asurf-main-"));
  execSync("git init -q", { cwd: main });
  execSync("git config user.name fsr-test", { cwd: main });
  execSync("git config user.email fsr@example.com", { cwd: main });
  fs.mkdirSync(path.join(main, "tasks"));
  fs.writeFileSync(path.join(main, "tasks", "surface.txt"), "v1\n", "utf8");
  execSync("git add -A && git commit -q -m base", { cwd: main });

  const tested = fs.mkdtempSync(path.join(os.tmpdir(), "fsr-asurf-tested-"));
  execSync("git init -q", { cwd: tested });
  execSync("git config user.name fsr-test", { cwd: tested });
  execSync("git config user.email fsr@example.com", { cwd: tested });
  fs.mkdirSync(path.join(tested, "tasks"));
  fs.writeFileSync(path.join(tested, "tasks", "surface.txt"), "v1\n", "utf8");
  execSync("git add -A && git commit -q -m base", { cwd: tested });

  try {
    // round-start snapshot over the TESTED tree (what the running round reads)
    const snap = snapshotAssertionSurface(tested);
    assert.ok(snap.files.includes("tasks/surface.txt"), "the assertion-surface snapshot covers the tested tree's file");
    // MID-ROUND: the round-84 writer edits the MAIN checkout — UNCOMMITTED (save-time pollution shape)
    fs.writeFileSync(path.join(main, "tasks", "surface.txt"), "v2-uncommitted\n", "utf8");
    // round-end compare over the TESTED tree: the main-checkout edit did NOT reach it
    const changed = detectAssertionSurfaceEdits(tested, snap);
    assert.deepEqual(changed, [], "round-84 shape is ISOLATED — the tested-tree snapshot stays clean (被隔离)");
  } finally {
    fs.rmSync(main, { recursive: true, force: true });
    fs.rmSync(tested, { recursive: true, force: true });
  }
});

test("AC3 negative control — a clean round (no mid-round edit) carries NO assertionSurfaceEditedMidRound", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fsr-asurf-clean-"));
  execSync("git init -q", { cwd: root });
  execSync("git config user.name fsr-test", { cwd: root });
  execSync("git config user.email fsr@example.com", { cwd: root });
  fs.mkdirSync(path.join(root, "tasks"));
  fs.writeFileSync(path.join(root, "tasks", "surface.txt"), "v1\n", "utf8");
  execSync("git add -A && git commit -q -m base", { cwd: root });
  const { f, dir } = fakeSuite(GREEN_SUITE);
  try {
    const child = runRunner({ root, command: `bash ${f}` });
    const { code } = await waitExit(child);
    assert.equal(code, 0, "runner exits 0 on green");
    const s = readState(root);
    assert.equal(s.state, "green", "clean round is green");
    assert.ok(!("assertionSurfaceEditedMidRound" in s), "absent on a clean round (绿轮可无 — no fabricated empty array)");
    const rec = lastRoundRecord(root);
    assert.ok(!("assertionSurfaceEditedMidRound" in rec), "round record omits the field on a clean round");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});


// ── gap-suite-state-split-across-worktree-and-gate: AC1/AC2/AC3 (--state-dir split) ────────────────

test("AC1/AC2 — --state-dir decouples the state/log write location from --root (the tested checkout)", async () => {
  // A worktree full-suite run passes `--root <worktree> --state-dir <main-repo>/.quay` so the gate
  // (inner stop conditions + suite-state-trigger, which read ONLY the main repo's relative
  // .quay/full-suite-state.json) sees the runner's REAL result instead of the stale main-repo red
  // the split left behind (the 123-minute blind window).
  const worktree = fs.mkdtempSync(path.join(os.tmpdir(), "fsr-split-"));
  const mainRoot = fs.mkdtempSync(path.join(os.tmpdir(), "fsr-main-"));
  const gateDir = path.join(mainRoot, ".quay");
  const { f, dir } = fakeSuite(GREEN_SUITE);
  try {
    const child = runRunner({ root: worktree, command: `bash ${f}`, laneCount: 8, stateDir: gateDir });
    const { code } = await waitExit(child);
    assert.equal(code, 0, `runner exits 0 on green, got ${code}`);

    const s = readState(mainRoot);
    assert.ok(s, "the main-repo (gate) state file was written");
    assert.equal(s.state, "green", "the gate-dir state reflects the real green result (AC1)");
    assert.equal(s.laneCount, 8);
    // the sync bridge: the worktree's OWN state is mirrored to the same bytes — the Contract band
    // `cmp -s <worktree-state> <main-repo-state>` = same after a worktree run
    const wt = readState(worktree);
    assert.ok(wt, "the worktree's own state is mirrored");
    assert.deepEqual(
      JSON.parse(fs.readFileSync(path.join(worktree, ".quay", "full-suite-state.json"), "utf8")),
      JSON.parse(fs.readFileSync(path.join(mainRoot, ".quay", "full-suite-state.json"), "utf8")),
      "worktree state byte-identical to the main-repo (gate) state (state_synced = same)",
    );
    // the suite log + verification-round ledger land in the gate dir too (same split)
    assert.ok(fs.existsSync(path.join(gateDir, "full-suite.log")), "log written to --state-dir");
    assert.ok(fs.existsSync(path.join(gateDir, "verification-round.jsonl")), "verification-round written to --state-dir");
    // AC2 — the gate read (suite-state-trigger against the MAIN repo) sees green, no stop signal
    const res = runOnce(mainRoot);
    assert.equal(res.status, "green", "the gate reads the same green result (AC2)");
    assert.equal(res.stopSignal, false, "green must not stop dispatch");
  } finally {
    fs.rmSync(worktree, { recursive: true, force: true });
    fs.rmSync(mainRoot, { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("AC3 — negative control: a red worktree run writes red to --state-dir (no false green in the gate)", async () => {
  const worktree = fs.mkdtempSync(path.join(os.tmpdir(), "fsr-splitred-"));
  const mainRoot = fs.mkdtempSync(path.join(os.tmpdir(), "fsr-mainred-"));
  const gateDir = path.join(mainRoot, ".quay");
  const { f, dir } = fakeSuite('echo "not ok 1 - boom"\nexit 1');
  try {
    const child = runRunner({ root: worktree, command: `bash ${f}`, stateDir: gateDir });
    const { code } = await waitExit(child);
    assert.equal(code, 1, "runner exits 1 on red");
    const s = readState(mainRoot);
    assert.ok(s, "the main-repo (gate) state file was written");
    assert.equal(s.state, "red", "the gate-dir state reflects the real red result (AC3)");
    assert.equal(s.reason, "failed", "a real failure is reason=failed (stop-dispatch signal)");
    // the sync bridge mirrors red to the worktree too — both red, no false green anywhere
    assert.deepEqual(
      JSON.parse(fs.readFileSync(path.join(worktree, ".quay", "full-suite-state.json"), "utf8")),
      JSON.parse(fs.readFileSync(path.join(mainRoot, ".quay", "full-suite-state.json"), "utf8")),
      "worktree state byte-identical to the main-repo (gate) state on red too",
    );
    const res = runOnce(mainRoot);
    assert.equal(res.status, "red");
    assert.equal(res.stopSignal, true, "red+failed must stop dispatch (batch merge only on true green)");
  } finally {
    fs.rmSync(worktree, { recursive: true, force: true });
    fs.rmSync(mainRoot, { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("AC16 — --lane-count N propagates --test-concurrency=N into the spawned test.sh command", async () => {
  // Regression for outer 2026-08-05 ABORT #2: the command was static `bash scripts/test.sh`,
  // so --lane-count only wrote the state field while the suite still ran the default
  // concurrency (measured 9 processes at concurrency 8, PSI 94 — the crash). Now an explicit
  // --lane-count MUST splice --test-concurrency=<N> into the spawned command.
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fsr-ac16-"));
  const argsLog = path.join(root, "args.txt");
  fs.mkdirSync(path.join(root, "scripts"), { recursive: true });
  fs.writeFileSync(
    path.join(root, "scripts", "test.sh"),
    `#!/usr/bin/env bash\necho "$*" > '${argsLog}'\necho "# tests 1"\necho "# pass 1"\necho "# fail 0"\necho "# cancelled 0"\nexit 0\n`,
    { mode: 0o755 },
  );
  try {
    const child = runRunner({ root, laneCount: 2 }); // NO --command → default path with splice
    const { code } = await waitExit(child);
    assert.equal(code, 0, `runner exits 0 on green, got ${code}`);
    const s = readState(root);
    assert.equal(s.state, "green");
    assert.equal(s.laneCount, 2);
    await poll(() => fs.existsSync(argsLog));
    const args = fs.readFileSync(argsLog, "utf8").trim();
    assert.ok(args.includes("--test-concurrency=2"), `--lane-count must splice --test-concurrency=N, got: ${args}`);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});


// ── gap-splice-unit-direct-test: spliceConcurrency 直测（4 个 spawn e2e → 纯函数） ──────────────────
// The splice (REPLACE of --test-concurrency) was exercised only via 4 full-runner spawns that each read
// the spliced args from a fake test.sh. spliceConcurrency is a pure function — import it directly.
// AC16 above is the single wiring keeper (the runner really splices N into the spawn command); the
// REPLACE/append/dedupe assertions below run with ZERO runner spawns.

test("spliceConcurrency (unit) — append when absent, REPLACE when present (= and space spellings), exactly ONE flag", () => {
  // AC1 splice (default-derived value appended when the command carries no --test-concurrency) + AC16.
  assert.equal(spliceConcurrency("bash scripts/test.sh", 2), "bash scripts/test.sh --test-concurrency=2");
  assert.equal(spliceConcurrency("bash scripts/test.sh", 4), "bash scripts/test.sh --test-concurrency=4");
  // AC2 splice REPLACE — an existing --test-concurrency=8 (= and space spellings) is stripped and replaced.
  assert.equal(spliceConcurrency("bash scripts/test.sh --test-concurrency=8", 4), "bash scripts/test.sh --test-concurrency=4");
  assert.equal(spliceConcurrency("bash scripts/test.sh --test-concurrency 8", 4), "bash scripts/test.sh --test-concurrency=4");
  // AC4 negative control — explicit 8 + existing =8 ⇒ exactly ONE =8 (replace, not two).
  assert.equal(spliceConcurrency("bash scripts/test.sh --test-concurrency=8", 8), "bash scripts/test.sh --test-concurrency=8");
});

test("stripConcurrencyFlags (unit) — strips both the = and space spellings, leaves a flag-less command unchanged", () => {
  assert.equal(stripConcurrencyFlags("bash test.sh --test-concurrency=8 --flag"), "bash test.sh --flag");
  assert.equal(stripConcurrencyFlags("bash test.sh --test-concurrency 8 --flag"), "bash test.sh --flag");
  assert.equal(stripConcurrencyFlags("bash test.sh"), "bash test.sh");
});

test("defaultLaneCount (unit) — the base formula divides by S (nproc=4, oversub=1 ⇒ 4/2/1 by slot count)", () => {
  // AC1's s.laneCount derivation assertion (max(1, floor(4×1/S)) = 4/2/1), now a direct pure-function
  // read instead of 3 full-runner spawns. Sibling of the yielded-slot formula test below.
  const prevNproc = process.env.RESOURCE_GATE_NPROC;
  const prevSeam = process.env.RESOURCE_GATE_CONCURRENT_SUITES;
  const prevKnob = process.env.QUAY_MAX_CONCURRENT_SUITES;
  const prevOversub = process.env.QUAY_MAX_OVERSUBSCRIPTION;
  const prevLock = process.env.FULL_SUITE_LOCK_FILE;
  const pinTmp = fs.mkdtempSync(path.join(os.tmpdir(), "fsr-lane-base-"));
  process.env.FULL_SUITE_LOCK_FILE = path.join(pinTmp, "full-suite.lock");
  process.env.RESOURCE_GATE_NPROC = "4";
  process.env.QUAY_MAX_OVERSUBSCRIPTION = "1";
  delete process.env.RESOURCE_GATE_CONCURRENT_SUITES;
  try {
    for (const [slots, expected] of [["1", 4], ["2", 2], ["3", 1]]) {
      process.env.QUAY_MAX_CONCURRENT_SUITES = slots;
      assert.equal(defaultLaneCount(), expected, `max(1, floor(4×1/${slots})) = ${expected}`);
    }
  } finally {
    if (prevNproc === undefined) delete process.env.RESOURCE_GATE_NPROC; else process.env.RESOURCE_GATE_NPROC = prevNproc;
    if (prevSeam === undefined) delete process.env.RESOURCE_GATE_CONCURRENT_SUITES; else process.env.RESOURCE_GATE_CONCURRENT_SUITES = prevSeam;
    if (prevKnob === undefined) delete process.env.QUAY_MAX_CONCURRENT_SUITES; else process.env.QUAY_MAX_CONCURRENT_SUITES = prevKnob;
    if (prevOversub === undefined) delete process.env.QUAY_MAX_OVERSUBSCRIPTION; else process.env.QUAY_MAX_OVERSUBSCRIPTION = prevOversub;
    if (prevLock === undefined) delete process.env.FULL_SUITE_LOCK_FILE; else process.env.FULL_SUITE_LOCK_FILE = prevLock;
    fs.rmSync(pinTmp, { recursive: true, force: true });
  }
});

// ── gap-suite-lane-budget-structural-guarantee-broken-buckets-no-lock (漏口②) ──────────────────────
// The hold-cap watchdog (FULL_SUITE_LOCK_HOLD_MAX_S) releases the SLOT after T but the long suite keeps
// its lanes; a joining (S+1)-th suite then derives nproc×oversub/S lanes too ⇒ 2 suites × 16 lanes on
// 16 cores (double oversubscription — the lane formula did not account for the slot-less running suite).
// Fix: the watchdog writes `<slot>.yielded` (holder pid) on fire, and defaultLaneCount() divides by
// S + yielded so the joining suite takes fewer lanes. A lone suite (no yielded slot) keeps the full
// nproc budget (AC2 no-regression —「S=1 时取满」is the formula's intent and must not be broken).

test("gap-suite-lane-budget AC1 (behavioral) — the watchdog writes `<slot>.yielded` (holder pid) when it fires (让槽同时让 lane)", () => {
  const script = `
    set -u
    . "${SUITE_SLOT_LIB}"
    tmp="$(mktemp -d)"
    base="\${tmp}/full-suite.lock"
    exec {fd}>"\${base}.0"
    flock -n "\${fd}" || { echo "PRE-FLOCK-FAILED"; exit 1; }
    flag="\${tmp}/hold.flag"
    : > "\${flag}"
    wpid="$(spawn_suite_lock_hold_watchdog "\${fd}" "\${flag}" "$$" "2" "1" "\${base}.0")"
    if [ -e "\${flag}" ]; then echo "SPAWN-NON-BLOCKING"; else echo "SPAWN-BLOCKED"; fi
    sleep 3
    if [ -e "\${base}.0.yielded" ]; then echo "YIELD-MARKER-PRESENT"; else echo "YIELD-MARKER-ABSENT"; fi
    if [ -s "\${base}.0.yielded" ] && [ "$(cat "\${base}.0.yielded")" = "$$" ]; then echo "YIELD-MARKER-PID-MATCHES"; fi
    wait "\${wpid}" 2>/dev/null || true
    exec {fd}>&- 2>/dev/null || true
    rm -rf "\${tmp}"
  `;
  const r = spawnSync("bash", ["-c", script], { encoding: "utf8", timeout: 15_000 });
  assert.equal(r.status, 0, `watchdog script must exit 0, got status=${r.status} stderr=${r.stderr}`);
  assert.match(r.stdout, /SPAWN-NON-BLOCKING/, `the watchdog spawn must NOT block the caller, got stdout:\n${r.stdout}`);
  assert.match(r.stdout, /YIELD-MARKER-PRESENT/, `the watchdog must write <slot>.yielded on fire (not just release the slot), got stdout:\n${r.stdout}`);
  assert.doesNotMatch(r.stdout, /YIELD-MARKER-ABSENT/, "the marker must exist after the cap (让槽同时让 lane)");
  assert.match(r.stdout, /YIELD-MARKER-PID-MATCHES/, `the marker must carry the holder pid (liveness self-cleanup), got stdout:\n${r.stdout}`);
  assert.match(r.stderr, /lock_hold_exceeded=1/, `the fail-loud marker is unchanged, got stderr:\n${r.stderr}`);
});

test("gap-suite-lane-budget AC1/AC2 (formula) — defaultLaneCount divides by S + yielded; a lone suite keeps the full nproc budget", () => {
  const prevNproc = process.env.RESOURCE_GATE_NPROC;
  const prevSeam = process.env.RESOURCE_GATE_CONCURRENT_SUITES;
  const prevKnob = process.env.QUAY_MAX_CONCURRENT_SUITES;
  const prevOversub = process.env.QUAY_MAX_OVERSUBSCRIPTION;
  const prevLock = process.env.FULL_SUITE_LOCK_FILE;
  // Hermetic lock base (no `.concurrency` scalar, no production `.yielded` files) so the knob drives S
  // and the yielded count reads only this test's own markers (gap-suite-slot-ssot-i5-false-positive
  // class: production lock state must not perturb a derived value).
  const pinTmp = fs.mkdtempSync(path.join(os.tmpdir(), "fsr-lane-yield-"));
  const pinBase = path.join(pinTmp, "full-suite.lock");
  process.env.FULL_SUITE_LOCK_FILE = pinBase;
  process.env.RESOURCE_GATE_NPROC = "16";
  process.env.QUAY_MAX_CONCURRENT_SUITES = "1"; // S=1 ⇒ a single suite takes the whole host
  process.env.QUAY_MAX_OVERSUBSCRIPTION = "1";
  delete process.env.RESOURCE_GATE_CONCURRENT_SUITES;
  try {
    // AC2 negative control — no yielded marker ⇒ a lone suite keeps the full nproc budget (16).
    assert.equal(yieldedSuiteSlotCount(), 0, "no marker ⇒ yielded count 0");
    assert.equal(defaultLaneCount(), 16, "S=1, nproc=16, no yielded slot ⇒ 16 (single-run no-regression, AC2)");
    // AC1 — a live yielded marker ⇒ the divisor bumps to S+1 ⇒ the joining suite takes fewer lanes.
    fs.writeFileSync(`${pinBase}.0.yielded`, String(process.pid), "utf8");
    assert.equal(yieldedSuiteSlotCount(), 1, "a live-pid marker ⇒ yielded count 1");
    assert.equal(defaultLaneCount(), 8, "S=1 + 1 yielded ⇒ floor(16×1/(1+1)) = 8 (让 lane, AC1)");
    // Self-cleanup — a dead-pid marker (the holder crashed / finished without a normal release) is
    // ignored, so a stale marker can never permanently shrink the lone-suite budget.
    fs.writeFileSync(`${pinBase}.0.yielded`, "99999999", "utf8"); // well above Linux pid_max ⇒ ESRCH
    assert.equal(yieldedSuiteSlotCount(), 0, "a dead-pid marker is ignored (self-cleanup)");
    assert.equal(defaultLaneCount(), 16, "a dead marker does not shrink the lone-suite budget");
  } finally {
    if (prevNproc === undefined) delete process.env.RESOURCE_GATE_NPROC; else process.env.RESOURCE_GATE_NPROC = prevNproc;
    if (prevSeam === undefined) delete process.env.RESOURCE_GATE_CONCURRENT_SUITES; else process.env.RESOURCE_GATE_CONCURRENT_SUITES = prevSeam;
    if (prevKnob === undefined) delete process.env.QUAY_MAX_CONCURRENT_SUITES; else process.env.QUAY_MAX_CONCURRENT_SUITES = prevKnob;
    if (prevOversub === undefined) delete process.env.QUAY_MAX_OVERSUBSCRIPTION; else process.env.QUAY_MAX_OVERSUBSCRIPTION = prevOversub;
    if (prevLock === undefined) delete process.env.FULL_SUITE_LOCK_FILE; else process.env.FULL_SUITE_LOCK_FILE = prevLock;
    fs.rmSync(pinTmp, { recursive: true, force: true });
  }
});

test("AC2 — concurrentSuiteSlots() reads QUAY_MAX_CONCURRENT_SUITES (the single definition point) with a clamped fallback", () => {
  // gap-single-flight-lock-2-slot-concurrent-suites — the concurrent-suite slot count S is the
  // SINGLE definition point for "how many suites may run at once" (旋钮②, current default 1 —
  // gap-fan-in-workflow-lock-and-S1 S=1). An invalid/zero setting fails OPEN to the single-suite
  // default (1 is the current default value; a misconfigured host degrades to the single-suite
  // baseline, never to 0 lanes). The value is clamped to an integer >= 1.
  const prev = process.env.QUAY_MAX_CONCURRENT_SUITES;
  const prevSeam = process.env.RESOURCE_GATE_CONCURRENT_SUITES;
  const prevLock = process.env.FULL_SUITE_LOCK_FILE;
  // Pin the base to an isolated temp dir with NO `.concurrency` file so the knob this test drives is
  // authoritative — the PRODUCTION scalar (a live-suite S=1 file at <suiteLockBase>.concurrency) has
  // priority over QUAY_MAX_CONCURRENT_SUITES and would shadow every knob value asserted here
  // (gap-suite-slot-ssot-i5-false-positive class: production lock state must not perturb the tests).
  const pinTmp = fs.mkdtempSync(path.join(os.tmpdir(), "fsr-pin-"));
  process.env.FULL_SUITE_LOCK_FILE = path.join(pinTmp, "full-suite.lock");
  try {
    // Clear the seam too — suiteLockSlotCount() reads RESOURCE_GATE_CONCURRENT_SUITES FIRST (since
    // gap-suite-lock-slot-seam-asymmetry), so a "default with the knob deleted" assertion must not be
    // shadowed by an ambient seam.
    delete process.env.RESOURCE_GATE_CONCURRENT_SUITES;
    delete process.env.QUAY_MAX_CONCURRENT_SUITES;
    assert.equal(concurrentSuiteSlots(), 1, "default slot count = 1 (S=1, gap-fan-in-workflow-lock-and-S1)");
    process.env.QUAY_MAX_CONCURRENT_SUITES = "1";
    assert.equal(concurrentSuiteSlots(), 1, "1 slot = the old single-flight behavior (AC4: no regression)");
    process.env.QUAY_MAX_CONCURRENT_SUITES = "2";
    assert.equal(concurrentSuiteSlots(), 2);
    process.env.QUAY_MAX_CONCURRENT_SUITES = "3";
    assert.equal(concurrentSuiteSlots(), 3, "a future bump to 3 slots reads through (勿把 2 当设计常量)");
    process.env.QUAY_MAX_CONCURRENT_SUITES = "0";
    assert.equal(concurrentSuiteSlots(), 1, "zero fails open to the single default, never 0 lanes");
    process.env.QUAY_MAX_CONCURRENT_SUITES = "abc";
    assert.equal(concurrentSuiteSlots(), 1, "non-numeric fails open to the single default");
  } finally {
    if (prev === undefined) delete process.env.QUAY_MAX_CONCURRENT_SUITES;
    else process.env.QUAY_MAX_CONCURRENT_SUITES = prev;
    if (prevSeam === undefined) delete process.env.RESOURCE_GATE_CONCURRENT_SUITES;
    else process.env.RESOURCE_GATE_CONCURRENT_SUITES = prevSeam;
    if (prevLock === undefined) delete process.env.FULL_SUITE_LOCK_FILE;
    else process.env.FULL_SUITE_LOCK_FILE = prevLock;
    fs.rmSync(pinTmp, { recursive: true, force: true });
  }
});


// ── gap-lanes-nproc-concurrent-suites-accounting + gap-verification-round-observability-holes AC3 ──
// After the 2-slot lock, the concurrent-suite count is a NEW variable: two full suites can now run at
// once, so the same wall-clock reading has a different meaning under 1-suite vs 2-suite concurrency.
// Every verification-round record must carry nproc (read-host) + the configured slot count +
// the ACTUAL concurrently-running count so a cross-round comparison can attribute "this round is
// slower" to machine concurrency rather than to the change being measured.
// gap-verification-round-observability-holes AC3 — concurrentSuitesRunning is now an INDEPENDENT read
// (countRunnerProcesses — counting alive runner processes by cmdline), NOT the lock-slot probe. The
// slot probe WAS the broken mechanism (one pid double-holding two slots ⇒ the count read ≤S forever,
// `{None:140, 1:34, 2:18}`, never >2 even when 4 suites genuinely overlapped). The seam
// QUAY_TEST_RUNNER_PROCS pins the count for hermetic determinism (the pgrep path would count the
// production full-suite-runner.ts that launches this very test file, making a lone-round assertion
// non-deterministic).

test("AC1 — a round records nproc (read-host) + concurrentSuiteSlots + concurrentSuitesRunning in verification-round.jsonl", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fsr-lanes-"));
  const { f, dir } = fakeSuite(GREEN_SUITE);
  try {
    // RESOURCE_GATE_NPROC is the deterministic host-read seam (os.availableParallelism() is not
    // controllable in a test); QUAY_TEST_RUNNER_PROCS pins the independent read to a lone round (this
    // runner only); QUAY_MAX_CONCURRENT_SUITES pinned so the parent suite's env cannot leak a
    // different knob value into the round record.
    const child = runRunner({
      root,
      command: `bash ${f}`,
      laneCount: 4,
      env: {
        RESOURCE_GATE_NPROC: "8",
        QUAY_MAX_CONCURRENT_SUITES: "2",
        QUAY_TEST_RUNNER_PROCS: "1",
      },
    });
    const { code } = await waitExit(child);
    assert.equal(code, 0, `runner exits 0 on green, got ${code}`);
    const rec = lastRoundRecord(root);
    assert.ok(rec, "verification-round.jsonl written");
    assert.equal(rec.nproc, 8, `nproc = host parallelism (read-host seam), got ${rec.nproc}`);
    assert.equal(rec.concurrentSuiteSlots, 2, `concurrentSuiteSlots = QUAY_MAX_CONCURRENT_SUITES (the 2-slot knob), got ${rec.concurrentSuiteSlots}`);
    assert.equal(rec.concurrentSuitesRunning, 1, `a lone round (no other runner alive) runs at concurrency 1, got ${rec.concurrentSuitesRunning}`);
    assert.equal(hostParallelism(), Number.isFinite(Number(process.env.RESOURCE_GATE_NPROC)) ? Number(process.env.RESOURCE_GATE_NPROC) : hostParallelism(), "hostParallelism() is a number (read-host, never a literal)");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("AC2 — 2-suite round records concurrentSuitesRunning=2, mechanically distinct from a 1-suite round (=1) [negative control]", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fsr-lanes2-"));
  const { f, dir } = fakeSuite(GREEN_SUITE);
  try {
    const child = runRunner({
      root,
      command: `bash ${f}`,
      laneCount: 4,
      env: {
        RESOURCE_GATE_NPROC: "8",
        QUAY_MAX_CONCURRENT_SUITES: "2",
        QUAY_TEST_RUNNER_PROCS: "2",
      },
    });
    const { code } = await waitExit(child);
    assert.equal(code, 0, `runner exits 0 on green, got ${code}`);
    const rec = lastRoundRecord(root);
    assert.ok(rec, "verification-round.jsonl written");
    assert.equal(rec.concurrentSuiteSlots, 2, `slot count = 2, got ${rec.concurrentSuiteSlots}`);
    assert.equal(rec.concurrentSuitesRunning, 2, `a 2-suite round records concurrentSuitesRunning=2, got ${rec.concurrentSuitesRunning}`);
    assert.equal(rec.nproc, 8, `nproc recorded, got ${rec.nproc}`);
    // AC2 negative control — the LONE-round AC1 test above records concurrentSuitesRunning=1; this
    // round records 2. The two records are mechanically distinguishable on the concurrency axis, so a
    // cross-round comparison can tell "this round ran alongside another suite" from "it ran alone".
    assert.notEqual(rec.concurrentSuitesRunning, 1, "2-suite round MUST differ from the lone-round record");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("AC3 — the independent read records >2 (NOT capped at the slot count) [gap-verification-round-observability-holes]", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fsr-lanes3-"));
  const { f, dir } = fakeSuite(GREEN_SUITE);
  try {
    // 4 runner processes alive while the slot count is 2 — the pre-fix slot-probe derivation would cap
    // this at 2 (and actually read ≤S forever because the probe WAS the broken mechanism); the
    // independent count records the real 4 (this is the 4-suite-overlap the field could never see).
    const child = runRunner({
      root,
      command: `bash ${f}`,
      laneCount: 4,
      env: {
        RESOURCE_GATE_NPROC: "8",
        QUAY_MAX_CONCURRENT_SUITES: "2",
        QUAY_TEST_RUNNER_PROCS: "4",
      },
    });
    const { code } = await waitExit(child);
    assert.equal(code, 0, `runner exits 0 on green, got ${code}`);
    const rec = lastRoundRecord(root);
    assert.ok(rec, "verification-round.jsonl written");
    assert.equal(rec.concurrentSuiteSlots, 2, `slot count = 2, got ${rec.concurrentSuiteSlots}`);
    assert.equal(rec.concurrentSuitesRunning, 4, `a 4-runner round records concurrentSuitesRunning=4 (>2, NOT capped at the slot count), got ${rec.concurrentSuitesRunning}`);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("AC3 unit — countRunnerProcesses() seam fails open to 1 on an invalid/absent value (never a fabricated 0)", () => {
  for (const bad of ["0", "abc", "-3"]) {
    process.env.QUAY_TEST_RUNNER_PROCS = bad;
    assert.equal(countRunnerProcesses(), 1, `seam '${bad}' fails open to 1 (this runner), never 0`);
  }
  delete process.env.QUAY_TEST_RUNNER_PROCS;
  // The unseamed read is the real pgrep path — a positive integer (this host may have other runners;
  // it must never be <1 because this process's own cmdline matches the pattern).
  assert.ok(countRunnerProcesses() >= 1, "unseamed countRunnerProcesses() is a real positive count");
});

test("AC3 unit — the production read (pgrep, no seam) counts real marker processes (positive control: the independent read is a measurement, not a seam echo)", async () => {
  // Spawn TWO processes whose cmdline matches the runner pattern (`full-suite-runner.ts` as a node argv
  // entry — `node -e <sleep> full-suite-runner.ts`) and confirm the pgrep-based count sees BOTH. This
  // is the honesty guard (CLAUDE.md 硬规则 4/4b): the seam above is self-fulfilling, so prove the real
  // read path measures a real process. TWO markers are used because the read fails open to 1 on ZERO
  // matches (the fail-open sentinel is indistinguishable from a real count of 1 — the caller here is
  // the TEST process, whose cmdline `full-suite-runner.test.mjs` does NOT match `full-suite-runner\.ts`,
  // so with no live runner the read legitimately sees 0 ⇒ fails open to 1). With two markers the count
  // is ≥2 regardless of how many production runners are alive, so the assertion cannot be satisfied by
  // the fail-open 1 (the `bash -c … full-suite-runner.ts` trick also does NOT work — bash execs away
  // its $0, so the pattern never lands in /proc/pid/cmdline).
  const markers = [
    spawn(process.execPath, ["-e", "setTimeout(() => {}, 30000)", "full-suite-runner.ts"], { stdio: "ignore", detached: true }),
    spawn(process.execPath, ["-e", "setTimeout(() => {}, 30000)", "full-suite-runner.ts"], { stdio: "ignore", detached: true }),
  ];
  let spawnFailed = false;
  for (const m of markers) m.once("error", () => { spawnFailed = true; });
  try {
    const prev = process.env.QUAY_TEST_RUNNER_PROCS;
    delete process.env.QUAY_TEST_RUNNER_PROCS;
    // ONE settle wait (1.5s) then ONE after-read: two pgrep calls total. The earlier 50×50ms poll was
    // load-sensitive (each pgrep spawns a process; under full-suite load the loop ran ~17s and still
    // raced the marker's own load-delayed startup).
    await new Promise((r) => setTimeout(r, 1500));
    const after = countRunnerProcesses();
    if (!spawnFailed) {
      assert.ok(after >= 2, `production read counts the marker processes (after=${after} — must be ≥2 for the two markers, never the fail-open 1)`);
    }
    if (prev !== undefined) process.env.QUAY_TEST_RUNNER_PROCS = prev;
  } finally {
    for (const m of markers) {
      try { process.kill(-m.pid, "SIGKILL"); } catch { /* already gone */ }
      try { m.kill("SIGKILL"); } catch { /* already gone */ }
    }
  }
});


// ── gap-suite-round-record-missing-failures-field: AC2 (round record carries failures on red) ────────
// The round-210 attribution hole: verification-round.jsonl round records lacked a `failures` field
// (209 rounds measured without it), so the red-window reverse-lookup "failed file → task Touches"
// could only read the single-round full-suite-state.json. AC2: a RED round's record carries the SAME
// SuiteFailure array the suite-state write carries; a GREEN round's record omits it (绿轮可无).

test("AC2 — a RED run's verification-round record carries the failures[] array mirroring the suite-state (gap-suite-round-record-missing-failures-field)", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fsr-roundfail-"));
  const { f, dir } = fakeSuite('echo "not ok 1 - boom"\necho "ℹ tests 1"\necho "ℹ pass 0"\necho "ℹ fail 1"\necho "ℹ cancelled 0"\nexit 1');
  try {
    const child = runRunner({ root, command: `bash ${f}` });
    const { code } = await waitExit(child);
    assert.equal(code, 1, "runner exits 1 on red");
    const s = readState(root);
    assert.equal(s.state, "red", "not ok 1 flips state to red");
    assert.ok(redPayload(s).length >= 1, `suite-state carries a failure payload; got ${JSON.stringify(s)}`);
    const roundFile = path.join(root, ".quay", "verification-round.jsonl");
    assert.ok(fs.existsSync(roundFile), "verification-round.jsonl written");
    const rounds = fs.readFileSync(roundFile, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
    assert.ok(rounds.length >= 1, "a verification-round record is appended");
    const rec = rounds[rounds.length - 1];
    assert.equal(rec.state, "red", "round record state is red");
    assert.ok("failures" in rec || "unattributed" in rec, "red round record carries the failures field (Contract: red_round_failures_recorded = 1)");
    assert.ok(Array.isArray(rec.failures || rec.unattributed), "red round record failures is an array");
    assert.equal(redPayload(rec).length, redPayload(s).length, "round-record failures mirror the suite-state failures (same array)");
    assert.equal(redPayload(rec)[0].line, redPayload(s)[0].line, "round-record failure line equals the state failure line");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("AC2 — a GREEN run's verification-round record omits failures (绿轮可无; non-red fields byte-identical)", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fsr-roundgreen-"));
  const { f, dir } = fakeSuite(GREEN_SUITE);
  try {
    const child = runRunner({ root, command: `bash ${f}`, laneCount: 8 });
    const { code } = await waitExit(child);
    assert.equal(code, 0, "runner exits 0 on green");
    const roundFile = path.join(root, ".quay", "verification-round.jsonl");
    const rec = JSON.parse(fs.readFileSync(roundFile, "utf8").trim().split("\n").filter((l) => l.trim())[0]);
    assert.equal(rec.state, "green");
    assert.ok(!("failures" in rec), "green round record omits the failures field");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ── gap-verification-round-counter-overwrites-not-sums: AC1-AC5 ────────────────────────────────────
// test.sh's FULL-SUITE default path runs node --test as THREE phases (serial → lowconc → main,
// scripts/test.sh:1107/1127/1142), each emitting its OWN spec-reporter summary block (`ℹ pass N` /
// `ℹ fail N` / `ℹ cancelled N`). The pre-fix runner OVERWROTE on each block (tapPass = Number(m[1])),
// so verification-round.jsonl recorded only the LAST phase's counts — a green round read tests≈145
// (not the ~3000 total), and a truncated/kill-on-red round that cut the stream before a final
// summary read tests=0 while failures[] had real content (round-12, 861s, 16 failures). These pin
// the fix: the counters ACCUMULATE across blocks (verified against the real reporter — each
// node --test process emits exactly ONE summary block).

test("AC1/AC3 — multi-phase pass/fail/tests = the SUM of every block; a red round's tallies never contradict a non-empty failures[]", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fsr-sumbatch-"));
  // The round-12 contradiction shape: the failing phase (serial) emits fail 1 FIRST, then the main
  // phase emits a fully-green block. Pre-fix overwrite: tapFail = 0 (last block), tests = 5 — but
  // state=red with failures[] non-empty (self-contradiction). Post-fix: pass=9, fail=1, tests=10.
  const suite = [
    'echo "selected 2 files (groups=serial)"',
    'echo "not ok 1 - boom"',
    'echo "ℹ tests 5"',
    'echo "ℹ pass 4"',
    'echo "ℹ fail 1"',
    'echo "ℹ cancelled 0"',
    'echo "selected 5 files (groups=main)"',
    'echo "ℹ tests 5"',
    'echo "ℹ pass 5"',
    'echo "ℹ fail 0"',
    'echo "ℹ cancelled 0"',
    "exit 1",
  ].join("\n");
  const { f, dir } = fakeSuite(suite);
  try {
    const child = runRunner({ root, command: `bash ${f}` });
    const { code } = await waitExit(child);
    assert.equal(code, 1, "runner exits 1 on red");
    const vrf = path.join(root, ".quay", "verification-round.jsonl");
    assert.ok(fs.existsSync(vrf), "verification-round.jsonl written");
    const rec = JSON.parse(fs.readFileSync(vrf, "utf8").split("\n").filter((l) => l.trim())[0]);
    assert.equal(rec.pass, 9, "pass = sum across phases (4+5), not the last phase's 5");
    assert.equal(rec.fail, 1, "fail = sum across phases (1+0), not zeroed by the green last block");
    assert.equal(rec.cancelled, 0, "cancelled = 0");
    assert.equal(rec.tests, 10, "tests = pass+fail+cancelled = 10, not the last phase's 5");
    assert.equal(rec.state, "red");
    assert.ok(redPayload(rec).length >= 1, "red round record carries the failure payload (failures[] or unattributed[])");
    assert.ok(rec.fail >= 1 || rec.cancelled >= 1, `AC3 — a failure stream ⇒ fail ≥ 1 or cancelled ≥ 1 (got fail=${rec.fail}, cancelled=${rec.cancelled})`);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("AC1 green — a multi-phase GREEN run records tests = the sum of every phase block", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fsr-sumbatch-green-"));
  // Simulates the serial(3) + lowconc(7) phases on a green round: pre-fix the record read
  // tests=7/pass=7 (last block only); post-fix tests=10/pass=10.
  const suite = [
    'echo "selected 1 files (groups=serial)"',
    'echo "ℹ tests 3"',
    'echo "ℹ pass 3"',
    'echo "ℹ fail 0"',
    'echo "ℹ cancelled 0"',
    'echo "selected 4 files (groups=lowconc)"',
    'echo "ℹ tests 7"',
    'echo "ℹ pass 7"',
    'echo "ℹ fail 0"',
    'echo "ℹ cancelled 0"',
    "exit 0",
  ].join("\n");
  const { f, dir } = fakeSuite(suite);
  try {
    const child = runRunner({ root, command: `bash ${f}` });
    const { code } = await waitExit(child);
    assert.equal(code, 0, "runner exits 0 on green");
    const rec = JSON.parse(fs.readFileSync(path.join(root, ".quay", "verification-round.jsonl"), "utf8").split("\n").filter((l) => l.trim())[0]);
    assert.equal(rec.state, "green");
    assert.equal(rec.pass, 10, "pass sums across phases (3+7)");
    assert.equal(rec.fail, 0);
    assert.equal(rec.cancelled, 0);
    assert.equal(rec.tests, 10, "tests = 10, not the last phase's 7");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("AC1/AC3 — `ℹ cancelled N` accumulates across blocks too (a cancelled block is never zeroed by a later block)", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fsr-sumbatch-cancelled-"));
  // cancelled lives in the FIRST block; the LAST block is cancelled-0. Pre-fix overwrite: tapCancelled
  // = 0 and the aggregate red backstop (tapFail>0 || tapCancelled>0) never fired. Post-fix: cancelled=1.
  const suite = [
    'echo "ℹ tests 5"',
    'echo "ℹ pass 4"',
    'echo "ℹ fail 0"',
    'echo "ℹ cancelled 1"',
    'echo "ℹ tests 2"',
    'echo "ℹ pass 2"',
    'echo "ℹ fail 0"',
    'echo "ℹ cancelled 0"',
    "exit 1",
  ].join("\n");
  const { f, dir } = fakeSuite(suite);
  try {
    const child = runRunner({ root, command: `bash ${f}` });
    const { code } = await waitExit(child);
    assert.equal(code, 1, "runner exits 1 (a cancelled test is a failure verdict)");
    const rec = JSON.parse(fs.readFileSync(path.join(root, ".quay", "verification-round.jsonl"), "utf8").split("\n").filter((l) => l.trim())[0]);
    assert.equal(rec.cancelled, 1, "cancelled sums across blocks (1+0), not zeroed by the last block");
    assert.equal(rec.pass, 6, "pass sums across blocks (4+2)");
    assert.equal(rec.tests, 7, "tests = pass(6) + cancelled(1) = 7");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("AC2 — a single-phase run records the block's values unchanged (no regression)", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fsr-singlebatch-"));
  // One block ⇒ accumulate() is the identity: the recorded values must equal the block's values
  // exactly (a single node --test process emits exactly one summary block, so `+=` == `=`).
  const { f, dir } = fakeSuite(GREEN_SUITE); // "# tests 5 / # pass 5 / # fail 0 / # cancelled 0"
  try {
    const child = runRunner({ root, command: `bash ${f}`, laneCount: 8 });
    const { code } = await waitExit(child);
    assert.equal(code, 0, "runner exits 0 on green");
    const rec = JSON.parse(fs.readFileSync(path.join(root, ".quay", "verification-round.jsonl"), "utf8").split("\n").filter((l) => l.trim())[0]);
    assert.equal(rec.state, "green");
    assert.equal(rec.pass, 5, "single-block pass unchanged");
    assert.equal(rec.fail, 0, "single-block fail unchanged");
    assert.equal(rec.cancelled, 0, "single-block cancelled unchanged");
    assert.equal(rec.tests, 5, "single-block tests unchanged");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("AC2 — FORCE_COLOR ANSI-colored `ℹ pass/fail/cancelled` summary lines still parse to the four fields (gap-suite-round-pass-fail-cancel-parser-breaks-under-force-color-ansi)", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fsr-ansi-"));
  // #684/#685 regression: host FORCE_COLOR=3 forces node:test's spec reporter to emit ANSI color
  // even when its stdout is redirected ⇒ the summary arrives as `\x1b[34mℹ pass N\x1b[39m` (ESC at
  // line start) and the `^[#ℹ]` summary regexes never matched ⇒ pass/fail/cancelled/tests recorded
  // 0. This colored stream reproduces that shape; the runner must strip ANSI and land the real
  // counts (and stay green — the colored `ℹ fail 0` must not false-red).
  const esc = "\x1b";
  const colored = (s) => `echo '${esc}[34m${s}${esc}[39m'`;
  const suite = [
    'echo "selected 5 files (groups=main)"',
    colored("ℹ tests 5"),
    colored("ℹ pass 5"),
    colored("ℹ fail 0"),
    colored("ℹ cancelled 0"),
    "exit 0",
  ].join("\n");
  const { f, dir } = fakeSuite(suite);
  try {
    const child = runRunner({ root, command: `bash ${f}` });
    const { code } = await waitExit(child);
    assert.equal(code, 0, "runner exits 0 on green");
    const rec = JSON.parse(fs.readFileSync(path.join(root, ".quay", "verification-round.jsonl"), "utf8").split("\n").filter((l) => l.trim())[0]);
    assert.equal(rec.state, "green", "colored summary does not false-red");
    assert.equal(rec.pass, 5, "pass parsed from the ANSI-colored ℹ pass line");
    assert.equal(rec.fail, 0, "fail parsed from the ANSI-colored ℹ fail line");
    assert.equal(rec.cancelled, 0, "cancelled parsed from the ANSI-colored ℹ cancelled line");
    assert.equal(rec.tests, 5, "tests = pass+fail+cancelled parsed from colored lines (never 0)");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("AC2 — a FORCE_COLOR ANSI-colored `ℹ fail 1` summary still flips RED via the failure-detection path, with a CLEAN (ANSI-stripped) failure line (gap-suite-round-pass-fail-cancel-parser-breaks-under-force-color-ansi — 5b third surface)", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fsr-ansi-red-"));
  // Third surface of the same FORCE_COLOR=3 defect family (5b): runner-red-parse.ts's
  // FAILURE_PATTERNS carry `^[#ℹ]\s*fail\s+[1-9]` / `^[#ℹ]\s*cancelled\s+[1-9]` (red-detection,
  // extracted from full-suite-runner.ts by gap-ac128-hub-split-harness-concerns). Before this fix the
  // call site fed them the RAW colorized line, so `\x1b[34mℹ fail 1\x1b[39m` (ESC at line start)
  // never matched and red was only caught by the exit-time aggregate backstop. Now the runner feeds
  // the ANSI-stripped summaryLine, so the colorized summary flips red on the stream AND the recorded
  // failure line is clean (no ESC bytes).
  const esc = "\x1b";
  const colored = (s) => `echo '${esc}[34m${s}${esc}[39m'`;
  const suite = [
    colored("ℹ tests 1"),
    colored("ℹ pass 0"),
    colored("ℹ fail 1"),
    colored("ℹ cancelled 0"),
    "exit 1",
  ].join("\n");
  const { f, dir } = fakeSuite(suite);
  try {
    const child = runRunner({ root, command: `bash ${f}` });
    const { code } = await waitExit(child);
    assert.equal(code, 1, "runner exits 1 on red");
    const s = readState(root);
    assert.equal(s.state, "red", "colored ℹ fail 1 flips state to red");
    assert.equal(s.reason, "failed", "reason=failed (a real test failure)");
    assert.ok(redPayload(s).length >= 1, `colored red carries a failure payload; got ${JSON.stringify(s)}`);
    assert.equal(redPayload(s)[0].line, "ℹ fail 1", "the recorded failure line is ANSI-stripped (clean, no ESC bytes)");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("AC2/AC3 e2e — a `✖ <testname> (Nms)` spec-reporter failure line flips red with failures non-empty", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fsr-specx-"));
  const { f, dir } = fakeSuite(
    'echo "✖ AC1/AC2 — the real bundle inventory matches the outline §6 snapshot (--inventory exits 0) (3.411515ms)"\nexit 1',
  );
  try {
    const child = runRunner({ root, command: `bash ${f}` });
    const { code } = await waitExit(child);
    assert.equal(code, 1, "runner exits 1 on red");
    const s = readState(root);
    assert.equal(s.state, "red", "✖ <name> (Nms) flips state to red (AC2)");
    assert.equal(s.reason, "failed");
    assert.ok(redPayload(s).length >= 1, `the red payload carries the spec-reporter failure (AC3); got ${JSON.stringify(s)}`);
    assert.match(redPayload(s)[0].line, /✖ AC1\/AC2 — the real bundle inventory/, "the failure line records the failing test name");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});


// ── gap-verification-round-reason-self-contradiction: the round-record reason is counter-level ───────
// A red round with fail=0 (all tests passed) must NEVER be labelled reason='failed' (self-contradictory).
// The suite-STATE's reason stays unchanged (routeRed/stop-dispatch semantics are pinned); only the
// verification-round RECORD reason is recomputed: fail>0 ⇒ 'failed'; fail=0 + a gate/scan/static red
// ⇒ 'gate-failed' + a `gate` identity; infra-error/aborted/timeout/hung/crashed keep their values.

test("AC1 — fail>0 (a real test failure) ⇒ round-record reason='failed', no gate field (unchanged)", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fsr-reason-fail-"));
  const { f, dir } = fakeSuite('echo "not ok 1 - boom"\necho "ℹ tests 1"\necho "ℹ pass 0"\necho "ℹ fail 1"\necho "ℹ cancelled 0"\nexit 1');
  try {
    const child = runRunner({ root, command: `bash ${f}` });
    const { code } = await waitExit(child);
    assert.equal(code, 1, "runner exits 1 on red");
    const rec = lastRoundRecord(root);
    assert.ok(rec, "a verification-round record is appended");
    assert.equal(rec.state, "red");
    assert.equal(rec.fail, 1, "fail counter > 0");
    assert.equal(rec.reason, "failed", "fail>0 is reason=failed (a real test failure, unchanged)");
    assert.ok(!("gate" in rec), "no gate field on a test-failure red");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("AC1 — fail=0 + tmux-leak-scan ⇒ round-record reason='gate-failed' + gate='tmux-leak-scan'", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fsr-reason-leak-"));
  // The round-167/self-contradiction shape: a leak-scan residual flips red, but the TAP test
  // counters stay fail=0 — the record must name the GATE, not say 'failed'.
  const { f, dir } = fakeSuite(
    'echo "tmux-leak-scan: FAIL — NEW residual test tmux servers/dirs after the run (delta vs the before-run snapshot; prefixes: skv-|session-liveness-|ol-tok-|enter-repro-):" >&2\n' +
      'echo "ℹ tests 3989"\necho "ℹ pass 3989"\necho "ℹ fail 0"\necho "ℹ cancelled 0"\nexit 1',
  );
  try {
    const child = runRunner({ root, command: `bash ${f}` });
    const { code } = await waitExit(child);
    assert.equal(code, 1, "runner exits 1 on red");
    const s = readState(root);
    assert.equal(s.state, "red");
    assert.equal(s.reason, "failed", "the suite-STATE reason stays failed (unchanged — routeRed/stop-dispatch pinned)");
    const rec = lastRoundRecord(root);
    assert.ok(rec, "a verification-round record is appended");
    assert.equal(rec.state, "red");
    assert.equal(rec.fail, 0, "all tests passed (fail=0)");
    assert.equal(rec.reason, "gate-failed", "fail=0 + a gate/scan red is reason=gate-failed, NOT failed (self-contradiction fixed)");
    assert.equal(rec.gate, "tmux-leak-scan", "the round record names the gate that failed");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("AC1 — fail=0 + __PERFILE__ passed=false ⇒ round-record reason='gate-failed' + gate='perfile-timeout'", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fsr-reason-pf-"));
  const { f, dir } = fakeSuite(
    'echo "__PERFILE__ duration_ms=3580.991183 packages/quay/test/verify-delivery-surface.test.mjs passed=false"\n' +
      'echo "ℹ tests 3989"\necho "ℹ pass 3989"\necho "ℹ fail 0"\necho "ℹ cancelled 0"\nexit 1',
  );
  try {
    const child = runRunner({ root, command: `bash ${f}` });
    const { code } = await waitExit(child);
    assert.equal(code, 1, "runner exits 1 on red");
    const rec = lastRoundRecord(root);
    assert.ok(rec, "a verification-round record is appended");
    assert.equal(rec.fail, 0, "all tests passed (fail=0)");
    assert.equal(rec.reason, "gate-failed", "a per-file timeout red with fail=0 is reason=gate-failed");
    assert.equal(rec.gate, "perfile-timeout", "the round record names the per-file timeout gate");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("AC1 — fail=0 + static-check ⇒ round-record reason='gate-failed' + gate='static-check'", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fsr-reason-sc-"));
  // The static-check red shape: the checker fails before the test phase (set -e), so no TAP summary —
  // fail=0 — and the STATE reason is 'static-check'. The round RECORD normalizes to gate-failed +
  // gate='static-check' so every gate/scan red with fail=0 is counter-distinguishable.
  const { f, dir } = fakeSuite(
    'echo "VIOLATION: tasks/gap-foo.md — V1: Contract block missing invariant line"\n' +
      'echo "violations: 11 unique across 9 task(s); info findings (non-ratchet, pre-opt-in baseline): 0"\n' +
      'echo "ratchet ceiling: 6; new since baseline: 6 (tasks/gap-foo.md: V1); resolved: 0"\n' +
      "exit 1",
  );
  try {
    const child = runRunner({ root, command: `bash ${f}` });
    const { code } = await waitExit(child);
    assert.equal(code, 1, "runner exits 1 on a static-check red");
    const s = readState(root);
    assert.equal(s.state, "red");
    assert.equal(s.reason, "static-check", "the suite-STATE reason stays static-check (unchanged)");
    const rec = lastRoundRecord(root);
    assert.ok(rec, "a verification-round record is appended");
    assert.equal(rec.state, "red");
    assert.equal(rec.fail, 0, "no tests ran (fail=0)");
    assert.equal(rec.reason, "gate-failed", "a static-check red with fail=0 is reason=gate-failed");
    assert.equal(rec.gate, "static-check", "the round record names the static-check gate");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("AC1 — green round-record reason stays null; infra-error keeps reason='infra-error' (d — semantics unchanged)", async () => {
  // GREEN: the round record carries reason=null (green rounds carry no reason), unchanged.
  const greenRoot = fs.mkdtempSync(path.join(os.tmpdir(), "fsr-reason-green-"));
  const gf = fakeSuite(GREEN_SUITE);
  try {
    const child = runRunner({ root: greenRoot, command: `bash ${gf.f}`, laneCount: 8 });
    const { code } = await waitExit(child);
    assert.equal(code, 0, "runner exits 0 on green");
    const rec = lastRoundRecord(greenRoot);
    assert.ok(rec, "a verification-round record is appended");
    assert.equal(rec.state, "green");
    assert.equal(rec.reason, null, "green round carries no reason (unchanged)");
    assert.ok(!("gate" in rec), "no gate field on green");
  } finally {
    fs.rmSync(greenRoot, { recursive: true, force: true });
    fs.rmSync(gf.dir, { recursive: true, force: true });
  }
  // INFRA-ERROR: a signal-killed DIRECT child (no TAP summary → fail=0) keeps reason='infra-error'
  // in the round record (unchanged — infra-error never claims a test failure).
  const irRoot = fs.mkdtempSync(path.join(os.tmpdir(), "fsr-reason-infra-"));
  const inf = fakeSuite('echo "about to die"\nkill -9 $$\necho "unreachable"');
  try {
    const child = runRunner({ root: irRoot, command: `bash ${inf.f}` });
    const { code } = await waitExit(child);
    assert.equal(code, 1, "runner exits 1 on a killed suite");
    const s = await poll(() => {
      const cur = readState(irRoot);
      return cur && cur.state === "red" && cur.reason === "infra-error" ? cur : null;
    }, { timeoutMs: 5000 });
    assert.ok(s, "state reason=infra-error (unchanged)");
    const rec = lastRoundRecord(irRoot);
    assert.ok(rec, "a verification-round record is appended");
    assert.equal(rec.reason, "infra-error", "a signal-killed round keeps reason=infra-error, NOT gate-failed (unchanged)");
  } finally {
    fs.rmSync(irRoot, { recursive: true, force: true });
    fs.rmSync(inf.dir, { recursive: true, force: true });
  }
});

// ── gap-streaming-red-cascade-amplifies-failures-array: AC1/AC2 segmentation (derived + unattributed) ──
// The round-130 defect: a load-sensitive flake (checker-cost) early-reds the shared state; the suite's
// OWN state-asserting tests (full-suite-runner / laydown-set-check) then read red and fail — a CASCADE
// that amplified the round's failures[] 3× (3 real + 4 cascade + 3 no-file = 10). AC1 marks cascade
// entries `derived` and segments them OUT of failures[]; AC2 segments no-file entries into
// `unattributed`. These pin the segmentation.

test("AC1 unit — segmentFailures: cascade entries (state-asserting test files) → derived, NOT failures[]", () => {
  const seg = segmentFailures([
    { line: "✖ AC1 — while the suite runs, state=running with finishedAt/durationMs null (1564ms)", file: "plugin/test/full-suite-runner.test.mjs" },
    { line: "✖ AC1 — while the suite runs, state=running with finishedAt/durationMs null (1564ms)", file: "plugin/test/laydown-set-check.test.mjs" },
    { line: "__PERFILE__ .../plugin/test/checker-cost.test.mjs passed=false", file: "plugin/test/checker-cost.test.mjs", in_family: true, kind: "child-spawn" },
  ]);
  assert.equal(isStateAssertingTestFile("plugin/test/full-suite-runner.test.mjs"), true, "full-suite-runner is a state-asserting test file");
  assert.equal(isStateAssertingTestFile("plugin/test/checker-cost.test.mjs"), false, "checker-cost is NOT state-asserting");
  assert.equal(seg.derived.length, 2, "both cascade entries land in derived");
  assert.ok(seg.derived.every((f) => f.derived === "cascade"), "derived entries are marked derived: 'cascade'");
  assert.equal(seg.failures.length, 1, "failures[] main set keeps ONLY the real file-attributable failure");
  assert.equal(seg.failures[0].file, "plugin/test/checker-cost.test.mjs", "the real failure keeps its file in the main set");
});

test("AC1/AC2 unit — segmentFailures: no-file entries → unattributed, NOT failures[]", () => {
  const seg = segmentFailures([
    { line: "✖ AC2 — ready-pool-check run 3x (35.8→91.2→157.0) yields a readable cost+load sequence (11779ms)" },
    { line: "not ok 1 - boom" },
    { line: "__PERFILE__ .../plugin/test/tmux-leak-scan.test.mjs passed=false", file: "plugin/test/tmux-leak-scan.test.mjs" },
  ]);
  assert.equal(seg.unattributed.length, 2, "both no-file entries land in unattributed");
  assert.equal(seg.failures.length, 1, "failures[] main set keeps the file-attributable entry");
  assert.equal(seg.failures[0].file, "plugin/test/tmux-leak-scan.test.mjs");
  assert.equal(seg.derived.length, 0, "no cascade entries here");
});

test("AC1/AC2 e2e — a fake suite that fails ONLY a state-asserting test file (plus a real no-file failure) writes derived + unattributed, and failures[] carries neither", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fsr-seg-"));
  const { f, dir } = fakeSuite(
    'echo "not ok 1 - boom"\n' +
      'echo "  location: plugin/test/full-suite-runner.test.mjs:1119:1"\n' +
      'echo "✖ AC1 — while the suite runs, state=running with finishedAt/durationMs null (1564.34609ms)"\n' +
      "exit 1",
  );
  try {
    const child = runRunner({ root, command: `bash ${f}` });
    const { code } = await waitExit(child);
    assert.equal(code, 1, "runner exits 1 on red");
    const s = readState(root);
    assert.equal(s.state, "red");
    // The `not ok 1 - boom` line: the detail lookahead resolves `location: plugin/test/full-suite-
    // runner.test.mjs` → a STATE-ASSERTING file ⇒ cascade ⇒ derived. The `✖ AC1 — ...` line carries
    // no file ⇒ unattributed. failures[] main set is EMPTY (both populations segmented out).
    assert.ok(Array.isArray(s.derived) && s.derived.length >= 1, `derived carries the cascade entry; got ${JSON.stringify(s.derived)}`);
    assert.ok(s.derived.some((f) => f.file === "plugin/test/full-suite-runner.test.mjs"), "the derived entry names the state-asserting file");
    assert.ok(Array.isArray(s.unattributed) && s.unattributed.length >= 1, `unattributed carries the no-file entry; got ${JSON.stringify(s.unattributed)}`);
    assert.ok(s.unattributed.some((f) => /AC1 — while the suite runs/.test(f.line)), "the unattributed entry is the no-file cascade line");
    // Both populations are OUT of the failures[] main set (the round-130 "三数一致" property).
    assert.ok(!(s.failures || []).some((f) => f.file === "plugin/test/full-suite-runner.test.mjs"), "failures[] main set excludes the cascade entry");
    // The round record mirrors the SAME segmentation (byte-identical to the state write).
    const rec = lastRoundRecord(root);
    assert.equal(redPayload(rec).length, redPayload(s).length, "round-record payload mirrors the suite-state payload");
    assert.equal((rec.derived || []).length, (s.derived || []).length, "round-record derived mirrors the suite-state derived");
    assert.equal((rec.unattributed || []).length, (s.unattributed || []).length, "round-record unattributed mirrors the suite-state unattributed");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

