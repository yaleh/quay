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

// full-suite-runner-cgroup.test.mjs — cgroup/systemd accounting (cgroup counter parsers / REAL /sys/fs/cgroup / systemd-run limits / load-fields). Split from gap-suite-file-split-two-longest.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync, execSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
// The test-side lifecycle helper (AC1 of
// gap-test-spawned-resident-drivers-outlive-their-suite-no-process-group-reaping): spawns a resident
// kernel process in its own process group and reaps the whole group on every terminal path.
import { pidAlive, processGroupAlive, spawnKernelProcess } from "./helpers/spawn-kernel-process.mjs";

// The shared-host envelope's ONE implementation lives in driver-runtime.ts (see the long comment
// there: `probe → runner-concurrency → driver-runtime` is an existing value-import chain, so adding
// `driver-runtime → probe` would close a NEW cycle against a `valueSccs: 0` ratchet baseline).
import { sharedHostCeilingBytes, listSharedHostScopes, SHARED_HOST_MIN_CEILING_BYTES, SHARED_HOST_OBSERVED_PEAK_BYTES } from "../scripts/driver-runtime.ts";
// The ONE lane-scaled derivation lives in Core's systemd-scope.ts leaf (imported by both the plugin
// side and the serve host) — the AC3 host-shape tests drive THAT function, ⛔ not a copy of it here.
import { laneScaledScopeMemoryMax, SCOPE_ENVELOPE_LANE_HEADROOM, SCOPE_ENVELOPE_HOST_FRACTION } from "../../packages/quay/src/systemd-scope.ts";

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
  suiteMemoryMax,
  defaultSuiteMemoryMax,
  resolveSuiteMemoryMax,
  declaredSuiteMemoryMax,
  readSuiteMemoryMeasurements,
  actualConcurrencyFromRows,
  SUITE_MEMORY_MAX_DEFAULT,
  readEffectiveTotalMemBytes,
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

test("unit — the cgroup counter parsers handle the REAL cgroup v2 shapes", () => {
  assert.equal(parseCpuStatUsageUsec("usage_usec 963001371675\nuser_usec 419965954062\nsystem_usec 305143213852\n"), 963001371675);
  assert.equal(parseCpuStatUsageUsec(""), null, "absent usage_usec ⇒ null (缺键), never 0");
  assert.equal(
    parsePressureSomeTotal("some avg10=0.00 avg60=0.00 avg300=0.06 total=10975837195\nfull avg10=0.00 avg60=0.00 avg300=0.00 total=0\n"),
    10975837195,
  );
  assert.equal(parsePressureSomeTotal("full avg10=0.00 avg60=0.00 avg300=0.00 total=0\n"), null, "no `some` line ⇒ null");
});

test("unit — readPhaseCounters reads the three cumulative counters from a cgroup dir (explicit seam dir)", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fsr-cg-"));
  try {
    fs.writeFileSync(path.join(dir, "cpu.stat"), "usage_usec 123\nuser_usec 1\n");
    fs.writeFileSync(path.join(dir, "cpu.pressure"), "some avg10=0 avg60=0 avg300=0 total=456\n");
    fs.writeFileSync(path.join(dir, "io.pressure"), "some avg10=0 avg60=0 avg300=0 total=789\n");
    const r = readPhaseCounters(dir);
    assert.deepEqual(r.counters, { cpu_usec: 123, psi_cpu_total: 456, psi_io_total: 789 });
    assert.equal(r.read_error, null);
    // A missing file fails open with a reason — never a fabricated 0.
    fs.rmSync(path.join(dir, "io.pressure"));
    const r2 = readPhaseCounters(dir);
    assert.equal(r2.counters, null);
    assert.ok(r2.read_error && r2.read_error.includes("io.pressure"), "read error names the missing file");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("unit — PhaseDifferentialAccounting computes exact differentials from the phase-script seam", () => {
  const before = process.env.QUAY_TEST_CGROUP_SCRIPT;
  process.env.QUAY_TEST_CGROUP_SCRIPT = JSON.stringify({
    static: { cpu_usec: 1000, psi_cpu_total: 500, psi_io_total: 10 },
    serial: { cpu_usec: 5000, psi_cpu_total: 2000, psi_io_total: 30 },
    main: { cpu_usec: 5500, psi_cpu_total: 2300, psi_io_total: 33 },
    round_end: { cpu_usec: 6000, psi_cpu_total: 2500, psi_io_total: 40 },
  });
  try {
    const acc = new PhaseDifferentialAccounting(999999, (p) => (p === "serial" ? 2 : 1));
    acc.init("static");
    acc.boundary("serial");
    acc.boundary("main"); // closes serial
    acc.finalize(); // closes main, reads round_end
    const phases = acc.records.map((r) => ({ phase: r.phase, cpu_usec: r.cpu_usec, psi_cpu_total: r.psi_cpu_total, lanes: r.lanes }));
    assert.deepEqual(phases, [
      { phase: "static", cpu_usec: 5000 - 1000, psi_cpu_total: 2000 - 500, lanes: 1 },
      { phase: "serial", cpu_usec: 5500 - 5000, psi_cpu_total: 2300 - 2000, lanes: 2 },
      { phase: "main", cpu_usec: 6000 - 5500, psi_cpu_total: 2500 - 2300, lanes: 1 },
    ]);
    assert.equal(acc.read_error, null);
  } finally {
    if (before === undefined) delete process.env.QUAY_TEST_CGROUP_SCRIPT;
    else process.env.QUAY_TEST_CGROUP_SCRIPT = before;
  }
});

// ── gap-phase-boundary-differential-accounting: REAL /sys/fs/cgroup path (硬规则4 推论三) ───────────
// The hermetic seam (QUAY_TEST_CGROUP_SCRIPT) above proves the DIFFERENTIAL LOGIC; these tests prove
// the REAL production source — reading the actual monotonic cumulative counters from /sys/fs/cgroup
// (NO seam, NO injected values). A criterion satisfiable only by fixtures is not a measurement
// (推论三): a round that runs WITHOUT the seam and carries REAL non-zero cpu_usec/psi is the evidence
// that the phase-boundary accounting reads the live kernel counters, not a fabricated map.

// A fake suite that burns REAL CPU between phase markers (bash busy-loop) so the differentials are
// reliably non-zero on the real cgroup path.
const REAL_BURN_SUITE = [
  'echo "selected 3 files (groups=serial)"',
  "for i in $(seq 1 60000); do :; done",
  'echo "__GROUP__ concurrency=2 files=3 sum_ms=100 floor_ms=60 capped=0"',
  'echo "selected 5 files (groups=lowconc)"',
  "for i in $(seq 1 60000); do :; done",
  'echo "__GROUP__ concurrency=3 files=5 sum_ms=200 floor_ms=90 capped=1"',
  'echo "# tests 8"',
  'echo "# pass 8"',
  'echo "# fail 0"',
  'echo "# cancelled 0"',
  "exit 0",
].join("\n");

test("REAL /sys/fs/cgroup — a round WITHOUT the seam records REAL non-zero cpu_usec/psi on the completed phases (硬规则4 推论三)", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fsr-realcg-"));
  const { f, dir } = fakeSuite(REAL_BURN_SUITE);
  try {
    // NO QUAY_TEST_CGROUP_SCRIPT / QUAY_TEST_CGROUP_DIR — the real cgroup read path only. The
    // plain-bash spawn (QUAY_TEST_SKIP_SYSTEMD_RUN=1, the runRunner default) keeps the suite child
    // in the runner's STABLE cgroup, so every boundary read (incl. finalize) succeeds.
    const child = runRunner({ root, command: `bash ${f}`, laneCount: 8, serialConcurrency: 2, lowconcConcurrency: 3 });
    const { code } = await waitExit(child);
    assert.equal(code, 0, `runner exits 0 on green, got ${code}`);
    const rec = lastRoundRecord(root);
    assert.ok(rec, "round record written");
    const phases = rec.phases || [];
    assert.ok(phases.length >= 3, `phase records present (got ${phases.length})`);
    const names = phases.map((p) => p.phase);
    assert.ok(names.includes("serial") && names.includes("lowconc"), `serial+lowconc present (got ${names.join(",")})`);
    // The completed phases carry REAL values from /sys/fs/cgroup — non-zero (the suite burned CPU),
    // and NOT the seam's injected numbers.
    const serial = phases.find((p) => p.phase === "serial");
    const lowconc = phases.find((p) => p.phase === "lowconc");
    assert.ok(serial.cpu_usec != null && serial.cpu_usec > 0, `serial cpu_usec is REAL and > 0 (got ${serial.cpu_usec})`);
    assert.ok(lowconc.cpu_usec != null && lowconc.cpu_usec > 0, `lowconc cpu_usec is REAL and > 0 (got ${lowconc.cpu_usec})`);
    assert.equal(typeof rec.phase_counter_error, "undefined", "no counter error — the real cgroup path read successfully");
    assert.equal(typeof rec.phase_final_read_error, "undefined", "plain-bash path keeps the final phase readable too");
    assert.ok(rec.nproc > 0, "round carries nproc for the derived quantities");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("REAL abort negative control — a fake suite that kills itself mid-run (REAL cgroup path) keeps the completed phase records with REAL cpu", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fsr-realcg-abort-"));
  const suite = [
    'echo "selected 3 files (groups=serial)"',
    "for i in $(seq 1 60000); do :; done",
    'echo "__GROUP__ concurrency=2 files=3 sum_ms=100 floor_ms=60 capped=0"',
    'echo "selected 5 files (groups=lowconc)"',
    "for i in $(seq 1 60000); do :; done",
    "kill -TERM $$",
  ].join("\n");
  const { f, dir } = fakeSuite(suite);
  try {
    const child = runRunner({ root, command: `bash ${f}`, laneCount: 8 });
    const { code } = await waitExit(child);
    assert.notEqual(code, 0, "aborted round exits non-zero");
    const rec = lastRoundRecord(root);
    assert.ok(rec, "round record written on the abort path");
    const phases = rec.phases || [];
    assert.ok(phases.length >= 3, `the phases that ran are recorded (got ${phases.length})`);
    const names = phases.map((p) => p.phase);
    assert.ok(names.includes("static") && names.includes("serial"), `static+serial recorded on abort (got ${names.join(",")})`);
    const serial = phases.find((p) => p.phase === "serial");
    assert.ok(serial.cpu_usec != null && serial.cpu_usec > 0, `abort-path serial cpu_usec is REAL and > 0 (got ${serial.cpu_usec})`);
    assert.equal(typeof rec.phase_counter_error, "undefined", "real cgroup path read successfully before the abort");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("unit — backfillFinalCpu derives the exit-spanning phase's cpu from the total MINUS the completed phases (reconstructed marker)", () => {
  const before = process.env.QUAY_TEST_CGROUP_SCRIPT;
  // The seam has static/serial/main snapshots but NO round_end — the finalize read FAILS (the scope
  // is destroyed in production), so the final phase is recorded null. readFor snapshots the seam at
  // construction, so this one script drives the whole sequence.
  process.env.QUAY_TEST_CGROUP_SCRIPT = JSON.stringify({
    static: { cpu_usec: 1000, psi_cpu_total: 100, psi_io_total: 10 },
    serial: { cpu_usec: 5000, psi_cpu_total: 200, psi_io_total: 20 },
    main: { cpu_usec: 7000, psi_cpu_total: 300, psi_io_total: 30 },
    // no round_end key → finalize read returns null + read_error
  });
  try {
    const acc = new PhaseDifferentialAccounting(999999, (p) => 1);
    acc.init("static");
    acc.boundary("serial");
    acc.boundary("main");
    acc.finalize();
    const last = acc.records[acc.records.length - 1];
    assert.equal(last.cpu_usec, null, "final phase is null when the finalize read failed (fail-open, never a fabricated 0)");
    assert.equal(acc.finalReadError, "phase script has no snapshot for 'round_end'", "the EXPECTED finalize failure rides finalReadError, NOT read_error");
    assert.equal(acc.read_error, null, "read_error stays null — the baseline/boundary reads succeeded");
    // Now the Consumed total becomes available: total = completed(static 4k + serial 2k) + final(unknown).
    // completed sum = 4000 + 2000 = 6000; total 8000 → final = 2000.
    acc.backfillFinalCpu(8000);
    assert.equal(last.cpu_usec, 2000, "backfillFinalCpu derives final cpu = total − completed sum");
    assert.equal(last.reconstructed, true, "the backfilled phase is marked reconstructed (provenance, not fabricated silently)");
    assert.equal(last.psi_cpu_total, null, "PSI has no journal counterpart — stays null");
  } finally {
    if (before === undefined) delete process.env.QUAY_TEST_CGROUP_SCRIPT;
    else process.env.QUAY_TEST_CGROUP_SCRIPT = before;
  }
});

test("unit — backfillFinalCpu is a NO-OP when the final phase already has a real reading, the total is absent, or nothing was finalized", () => {
  const before = process.env.QUAY_TEST_CGROUP_SCRIPT;
  process.env.QUAY_TEST_CGROUP_SCRIPT = JSON.stringify({
    static: { cpu_usec: 1000, psi_cpu_total: 100, psi_io_total: 10 },
    serial: { cpu_usec: 5000, psi_cpu_total: 200, psi_io_total: 20 },
    round_end: { cpu_usec: 6000, psi_cpu_total: 250, psi_io_total: 25 },
  });
  try {
    // Case 1 — the finalize read SUCCEEDED (real reading): backfill must not overwrite it.
    const acc = new PhaseDifferentialAccounting(999999, (p) => 1);
    acc.init("static");
    acc.boundary("serial");
    acc.finalize();
    const last = acc.records[acc.records.length - 1];
    assert.equal(last.cpu_usec, 1000, "final phase has a real reading (6000−5000)");
    acc.backfillFinalCpu(1_000_000);
    assert.equal(last.cpu_usec, 1000, "backfill is a NO-OP when the final phase already has a real reading");
    assert.equal(last.reconstructed, undefined, "no reconstructed marker on a real reading");
    // Case 2 — no total: stays null. The seam is set to a no-round_end script BEFORE constructing
    // the accumulator (readFor snapshots the seam at construction).
    process.env.QUAY_TEST_CGROUP_SCRIPT = JSON.stringify({
      static: { cpu_usec: 1000, psi_cpu_total: 100, psi_io_total: 10 },
      serial: { cpu_usec: 5000, psi_cpu_total: 200, psi_io_total: 20 },
      // no round_end → finalize read fails
    });
    const acc2 = new PhaseDifferentialAccounting(999999, (p) => 1);
    acc2.init("static");
    acc2.boundary("serial");
    acc2.finalize();
    acc2.backfillFinalCpu(null);
    assert.equal(acc2.records[acc2.records.length - 1].cpu_usec, null, "no total ⇒ final phase stays null (fail-open)");
  } finally {
    if (before === undefined) delete process.env.QUAY_TEST_CGROUP_SCRIPT;
    else process.env.QUAY_TEST_CGROUP_SCRIPT = before;
  }
});


// ── gap-systemd-run-limits-for-suite-and-heavy-ops: AC1-AC6 ────────────────────────────────────────
// The suite + heavy ops run WITHOUT cgroup limits today: a PID explosion (tmux leak, 217 procs) or a
// memory blowout (ugrep 8.8GB regex catastrophe) can take down the WHOLE MACHINE. The resource gate
// was bypassed (ABORT #5) because "a limit that only works when someone remembers to call it is no
// limit at all" (SPEC-isolation-and-resource-governance-2026-08-05.md §2). This task wraps the suite
// in a systemd-run --user --scope cgroup scope (MemoryMax/CPUQuota/TasksMax) — kernel-enforced,
// impossible to "forget to call", and bounded to ONE process group (the negative controls AC2/AC3
// prove the rest of the machine is untouched).

/** Spawn an arbitrary command, collect stdout/stderr, resolve on exit. */
function spawnCmd(args, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(args[0], args.slice(1), { stdio: ["ignore", "pipe", "pipe"], env });
    let out = "";
    let err = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.once("error", reject);
    child.once("exit", (code, signal) => resolve({ code, signal, out, err }));
  });
}

/** Machine-wide process count (the "other processes unaffected" baseline). */
function machineProcCount() {
  return Number(execSync("ps -e --no-headers | wc -l", { encoding: "utf8" }).trim());
}

/** Machine available memory in MB (the "no whole-machine swap" baseline). */
function memAvailMb() {
  return Number(execSync("free -m | awk 'NR==2{print $7}'", { encoding: "utf8" }).trim());
}

test("AC1 unit — buildSystemdRunArgv wraps a command in systemd-run --user --scope with the exact limit properties", () => {
  const argv = buildSystemdRunArgv("bash scripts/test.sh", DEFAULT_SYSTEMD_RUN_LIMITS);
  // DEFAULT has cpuQuota:"" ⇒ NO -p CPUQuota= (人裁定: 不设 CPU 上限; a literal only equals
  // "unlimited" on the machine it was written for — CLAUDE.md 推论二)
  // gap-full-suite-scope-oom-policy-stops-whole-suite-unattributable: the ALWAYS-present properties
  // (MemoryAccounting=yes + OOMPolicy=continue, shared with the availability probe) precede the
  // conditional limits.
  // gap-suite-memorymax-literal-16g-cap-pinned-every-round-while-lanes-scale-with-nproc (re-scoped
  // 2026-10-14): the MemoryMax is NO LONGER a code literal — it is the DECLARED value (`suite:
  // memory_max:` / `QUAY_SUITE_MEMORY_MAX` / the declared default), clamped by the host guard. The
  // assertion is on the value the constant HOLDS, never on a literal.
  assert.deepEqual(argv, [
    "systemd-run",
    "--user",
    "--scope",
    "--quiet",
    "-p",
    "MemoryAccounting=yes",
    "-p",
    "OOMPolicy=continue",
    "-p",
    `MemoryMax=${DEFAULT_SYSTEMD_RUN_LIMITS.memoryMax}`,
    "bash",
    "-c",
    "bash scripts/test.sh",
  ]);
  assert.ok(!argv.includes("MemoryMax=16G"), "the ceiling is no longer spelled as a code literal — it is the declared size in BYTES");
  assert.equal(
    DEFAULT_SYSTEMD_RUN_LIMITS.memoryMax,
    String(Math.min(16 * 1024 ** 3, sharedHostCeilingBytes(readEffectiveTotalMemBytes(), listSharedHostScopes().count))),
    "the declared 16 GiB baseline, clamped by the host guard (⛔ not 24/26 GiB)",
  );
  assert.ok(argv.includes("OOMPolicy=continue"), "the scope sets OOMPolicy=continue (one OOM-killed process must not TERM the whole suite)");
  assert.ok(!argv.includes("CPUQuota="), "default argv carries NO CPUQuota — the cgroup has no CPU limit");
  assert.ok(!argv.includes("TasksMax="), "default argv carries NO TasksMax — the cgroup has no task limit (人 2026-08-12 裁定③)");
  assert.ok(!argv.includes("MemorySwapMax="), "default argv carries NO MemorySwapMax — ⛔ no new default property (byte-for-byte except the OOM/accounting pair)");
  // a custom limit set flows through (explicit cpuQuota IS passed)
  const custom = buildSystemdRunArgv("true", { memoryMax: "64M", cpuQuota: "100%", tasksMax: "20" });
  assert.ok(custom.includes("-p") && custom.includes("MemoryMax=64M"));
  assert.ok(custom.includes("CPUQuota=100%") && custom.includes("TasksMax=20"));
  // gap-full-suite-scope-oom-policy-stops-whole-suite-unattributable: MemorySwapMax flows through when set
  // (the deterministic OOM negative control sets it to 0).
  const swapless = buildSystemdRunArgv("true", { memoryMax: "300M", cpuQuota: "", tasksMax: "", memorySwapMax: "0" });
  assert.ok(swapless.includes("MemorySwapMax=0"), "an explicit MemorySwapMax is passed (⛔ never a default)");
});

test("AC1 unit — parseSystemdRunLimits merges a seam override over the defaults; unknown keys fall back", () => {
  const l = parseSystemdRunLimits("MemoryMax=64M TasksMax=20");
  assert.equal(l.memoryMax, "64M");
  assert.equal(l.tasksMax, "20");
  assert.equal(l.cpuQuota, "", "an unchanged key keeps the default (no CPU quota — 人裁定)");
  assert.deepEqual(parseSystemdRunLimits(undefined), DEFAULT_SYSTEMD_RUN_LIMITS);
  // an unknown key is ignored (fail-safe — never produce an unparseable scope property)
  assert.deepEqual(parseSystemdRunLimits("MemoryMax=64M Bogus=1"), { ...DEFAULT_SYSTEMD_RUN_LIMITS, memoryMax: "64M" });
});

test(
  "AC1 — the runner wraps the suite in a systemd-run cgroup scope; the applied limits are visible as durable evidence (real systemd)",
  { skip: systemdRunAvailable() ? false : "systemd-run --user --scope not available on this host" },
  async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "fsr-sd1-"));
    // The suite must outlive the evidence capture (the scope is queryable only while it runs).
    const { f, dir } = fakeSuite(
      'echo "# tests 3"\nsleep 3\necho "# pass 3"\necho "# fail 0"\necho "# cancelled 0"\nexit 0',
    );
    try {
      const child = runRunner({
        root,
        command: `bash ${f}`,
        laneCount: 2,
        env: { QUAY_TEST_SYSTEMD_RUN_AVAILABLE: "1", QUAY_TEST_SKIP_SYSTEMD_RUN: "0" },
      });
      const { code } = await waitExit(child);
      assert.equal(code, 0, `runner exits 0 on green inside the cgroup scope, got ${code}`);
      const s = readState(root);
      assert.equal(s.state, "green");
      assert.ok(s.systemdRun, "the state carries the systemdRun limits (suite ran inside a cgroup scope)");
      // gap-suite-memorymax-literal-16g-cap-pinned-every-round-while-lanes-scale-with-nproc — this root
      // has no round history, so the MEASUREMENTS are absent (`null`, never 0). The ceiling is the
      // DECLARED value, still clamped by the host guard. Asserted by RE-RESOLVING it here rather than
      // by a literal — and the round's own evidence records the whole policy.
      const policy = resolveSuiteMemoryMax(root);
      assert.equal(s.systemdRun.memoryMax, policy.memoryMax);
      assert.equal(policy.declared, "16G");
      assert.equal(policy.declaredSource, "default");
      assert.equal(policy.actualConcurrency, null, "缺值 ≠ 0 — no usable history ⇒ null, never a fabricated 0");
      assert.equal(policy.perFileHighWaterBytes, null);
      assert.equal(policy.laneScaledEstimateBytes, null);
      assert.equal(s.systemdRun.cpuQuota, "");
      assert.equal(s.systemdRun.tasksMax, "");
      // …and the POLICY rides the durable per-run evidence (runId-keyed, never overwritten), so a reader
      // can see the declaration, its source, the guard and the measurements instead of inferring them.
      const memEvidence = JSON.parse(fs.readFileSync(path.join(root, ".quay", `suite-memory-evidence-${s.runId}.json`), "utf8"));
      assert.equal(memEvidence.memoryMaxBytes, Number(policy.memoryMax), "the sampled ceiling is the declared one");
      assert.equal(memEvidence.memoryMaxPolicy.declared, "16G");
      assert.equal(memEvidence.memoryMaxPolicy.declaredSource, "default");
      assert.equal(memEvidence.memoryMaxPolicy.bound, "declared");
      assert.equal(memEvidence.memoryMaxPolicy.actualConcurrency, null, "the measurement rides the evidence as an explicit null");
      assert.ok(memEvidence.memoryMaxPolicy.hostGuardBytes > 0, "the host guardrail that bounded it is recorded");
      assert.equal(memEvidence.memoryMaxPolicy.laneScaledExceedsHostGuard, null, "un-computable ⇒ null, ⛔ not false");
      // AC1 observable — the applied cgroup attributes (systemctl --user show) land in the state dir
      const evidence = path.join(root, ".quay", "suite-cgroup-evidence.txt");
      await poll(() => fs.existsSync(evidence), { timeoutMs: 10_000 });
      const txt = fs.readFileSync(evidence, "utf8");
      assert.match(txt, /scope_unit=run-[a-z0-9]+\.scope/, "the transient scope unit name is recorded (systemd names it run-<id>.scope — cgroup-derived)");
      assert.match(
        txt,
        new RegExp(`MemoryMax=${policy.memoryMax}`),
        `the applied cgroup ceiling is exactly the declared one (${policy.memoryMax}), read back from systemd`,
      );
      assert.doesNotMatch(txt, /TasksMax=200/, "no TasksMax=200 passed (人 2026-08-12 裁定③: task limit canceled)");
      assert.match(txt, /CPUQuotaPerSecUSec=(max|infinity)/, "no CPUQuota passed ⇒ cgroup CPU unlimited (max/infinity per systemd)");
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
      fs.rmSync(dir, { recursive: true, force: true });
    }
  },
);

test(
  "AC2 — negative control: TasksMax blocks a PID blowout (simulated tmux leak) inside the scope; the rest of the machine is untouched",
  { skip: systemdRunAvailable() ? false : "systemd-run --user --scope not available on this host" },
  async () => {
    const before = machineProcCount();
    // Simulate the tmux leak: fork long-lived children until the cgroup's TasksMax blocks us.
    // Python's os.fork() surfaces EAGAIN directly (bash retries and obscures the count).
    const py = `
import os, time, sys
children = []
count = 0
for i in range(200):
    try:
        pid = os.fork()
        if pid == 0:
            time.sleep(60)
            os._exit(0)
        children.append(pid)
        count += 1
    except OSError as e:
        sys.stderr.write('fork blocked at i=%d: %s\\n' % (i, e))
        break
sys.stdout.write('successful_forks=%d\\n' % count)
sys.stdout.flush()
for pid in children:
    try: os.kill(pid, 9)
    except OSError: pass
`;
    const { code, out, err } = await spawnCmd([
      "systemd-run", "--user", "--scope", "--quiet", "-p", "TasksMax=20", "python3", "-c", py,
    ]);
    const m = /successful_forks=(\d+)/.exec(out);
    assert.ok(m, `the scope reported its fork count (got stdout: ${out} stderr: ${err})`);
    const spawned = Number(m[1]);
    assert.ok(spawned < 200, `the PID blowout was blocked — not all 200 forked (got ${spawned})`);
    assert.ok(spawned <= 20, `TasksMax=20 bounded the concurrent process count (got ${spawned})`);
    assert.match(err, /fork blocked at i=/, "the cgroup TasksMax produced a fork EAGAIN (Resource temporarily unavailable)");
    const after = machineProcCount();
    assert.ok(after - before < 100, `other processes unaffected: machine proc count before=${before} after=${after} (blowout did NOT add ~200)`);
    // the negative control's other half: a fresh fork OUTSIDE the scope still works
    const { code: ctl } = await spawnCmd(["python3", "-c", "import os; p=os.fork(); (os._exit(0) if p==0 else os.waitpid(p,0)); print('outside-fork-ok')"]);
    assert.equal(ctl, 0, "a process outside the scope still forks normally");
    assert.equal(code, 0, "the scoped script itself exits 0 (it cleaned up; the BLOCK happened inside the cgroup)");
  },
);

test(
  "AC3 — negative control: MemoryMax OOM-kills a single memory hog (simulated ugrep catastrophe); no whole-machine swap",
  { skip: systemdRunAvailable() ? false : "systemd-run --user --scope not available on this host" },
  async () => {
    const freeBefore = memAvailMb();
    // Simulate the ugrep 8.8GB regex-backtracking blowout: allocate committed memory until the
    // cgroup's MemoryMax kills the process. MemorySwapMax=0 prevents the scope from escaping into
    // swap (the whole-machine swap collapse is exactly what AC3 must prove does NOT happen).
    const py = `
bufs = []
for i in range(4000):
    bufs.append(bytearray(1024 * 1024))
print('SURVIVED all allocations', flush=True)
`;
    const { code, out, err } = await spawnCmd([
      "systemd-run", "--user", "--scope", "--quiet",
      "-p", "MemoryMax=64M", "-p", "MemorySwapMax=0", "python3", "-c", py,
    ]);
    const freeAfter = memAvailMb();
    assert.ok(!out.includes("SURVIVED"), `the memory hog was killed before completing (got: ${out}${err})`);
    assert.notEqual(code, 0, `the scoped hog exited non-zero (killed by the cgroup), got ${code}`);
    assert.ok(
      freeAfter >= freeBefore - 2048,
      `no whole-machine swap collapse — machine available memory before=${freeBefore}MB after=${freeAfter}MB`,
    );
  },
);

test(
  "AC4 — the cgroup scope is a process boundary, not a comm-channel change: the suite's stdout/stderr still stream to the same log (file delivery unchanged)",
  { skip: systemdRunAvailable() ? false : "systemd-run --user --scope not available on this host" },
  async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "fsr-sd4-"));
    const { f, dir } = fakeSuite('echo "comm-channel-marker"\necho "# tests 1"\necho "# pass 1"\necho "# fail 0"\necho "# cancelled 0"\nexit 0');
    try {
      const child = runRunner({
        root,
        command: `bash ${f}`,
        env: { QUAY_TEST_SYSTEMD_RUN_AVAILABLE: "1", QUAY_TEST_SKIP_SYSTEMD_RUN: "0" },
      });
      const { code } = await waitExit(child);
      assert.equal(code, 0, `suite exits 0 under the cgroup scope, got ${code}`);
      // the suite's output reached the SAME full-suite.log the un-limited path writes — the
      // observation/file-delivery channel is unchanged (only the child's cgroup boundary moved).
      const log = read(path.join(root, ".quay", "full-suite.log"));
      assert.match(log, /comm-channel-marker/, "the suite's stdout still reaches the shared log under the cgroup scope");
      assert.equal(readState(root).state, "green");
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
      fs.rmSync(dir, { recursive: true, force: true });
    }
  },
);

test("AC5 — cross-annotation: the SPEC + no-resource-awareness task reference THIS task, and this task references both", () => {
  const spec = read(path.join(REPO_ROOT, "orchestration/SPEC-isolation-and-resource-governance-2026-08-05.md"));
  assert.match(
    spec,
    /gap-systemd-run-limits-for-suite-and-heavy-ops/,
    "the SPEC must name this task as the concrete systemd-run limits integration (AC5)",
  );
  const noRes = read(path.join(REPO_ROOT, "tasks/gap-no-resource-awareness-heavy-ops-run-blind.md"));
  assert.match(
    noRes,
    /gap-systemd-run-limits-for-suite-and-heavy-ops/,
    "gap-no-resource-awareness-heavy-ops-run-blind must cross-annotate this task (AC5)",
  );
  const self = read(path.join(REPO_ROOT, "tasks/gap-systemd-run-limits-for-suite-and-heavy-ops.md"));
  assert.match(self, /gap-no-resource-awareness-heavy-ops-run-blind/, "this task cross-annotates the no-resource-awareness task");
  assert.match(self, /SPEC-isolation-and-resource-governance-2026-08-05/, "this task cross-annotates the SPEC");
});

test(
  "AC6 — cross-project isolation: a suite inside its own cgroup scope completes while another scope burns CPU (the machine-wide gate would WAIT)",
  { skip: systemdRunAvailable() ? false : "systemd-run --user --scope not available on this host" },
  async () => {
    // Scope A = "another project" (e.g. archguard) burning a core inside its OWN cgroup quota.
    // Scope B = the quay suite inside its own cgroup quota. The machine-wide resource gate reads
    // /proc/pressure/cpu without project boundaries — under A's load it would say WAIT — but B does
    // not need the whole machine: it runs inside its own scope. This is the SPEC §4 cross-project
    // isolation claim, exercised for real with two concurrent scopes.
    const burner = spawnCmd([
      "systemd-run", "--user", "--scope", "--quiet", "-p", "CPUQuota=100%",
      "timeout", "3", "bash", "-c", "while :; do :; done",
    ]);
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "fsr-sd6-"));
    const { f, dir } = fakeSuite('echo "# tests 3"\necho "# pass 3"\necho "# fail 0"\necho "# cancelled 0"\nexit 0');
    try {
      const child = runRunner({
        root,
        command: `bash ${f}`,
        env: { QUAY_TEST_SYSTEMD_RUN_AVAILABLE: "1", QUAY_TEST_SKIP_SYSTEMD_RUN: "0" },
      });
      const { code } = await waitExit(child);
      assert.equal(code, 0, `the suite completes inside its own cgroup scope despite the other-scope CPU burner, got ${code}`);
      const s = readState(root);
      assert.equal(s.state, "green");
      assert.ok(s.systemdRun, "the suite ran in its own cgroup scope (isolation), not the burner's");
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
      fs.rmSync(dir, { recursive: true, force: true });
      await burner; // let the CPU burner finish its 3s budget
    }
  },
);


// ── gap-load-sensitive-serial-phase-unbounded-growth-measure-first AC2/AC3: phase-concurrency env ──

/**
 * A fake `<root>/scripts/test.sh` that records the load-sensitive phase-concurrency env vars the
 * runner passes down (QUAY_SERIAL_CONCURRENCY / QUAY_LOWCONC_CONCURRENCY) and prints a green TAP
 * summary — observes the AC2/AC3 knob plumbing without running the real suite.
 */
function fakeTestShRecordingPhaseEnv(root) {
  const envLog = path.join(root, "phase-env.txt");
  fs.mkdirSync(path.join(root, "scripts"), { recursive: true });
  fs.writeFileSync(
    path.join(root, "scripts", "test.sh"),
    `#!/usr/bin/env bash\necho "SERIAL=$QUAY_SERIAL_CONCURRENCY LOWCONC=$QUAY_LOWCONC_CONCURRENCY" > '${envLog}'\necho "# tests 1"\necho "# pass 1"\necho "# fail 0"\necho "# cancelled 0"\nexit 0\n`,
    { mode: 0o755 },
  );
  return { envLog };
}

test("AC1/AC3 — the default run passes HOST-READ SERIAL + HOST-READ LOWCONC phase concurrency to the child test.sh", async () => {
  // gap-ac44-concurrent-phases-read-host-parallelism AC1/AC3 + gap-single-flight-lock-2-slot-concurrent-
  // suites AC2 + gap-lane-formula-ignores-phase-overlap-concurrency AC1/AC3: the SERIAL phase default is
  // host-read (os.availableParallelism()) DIVIDED by the concurrent-suite slot count S AND by the
  // concurrent-PHASE count P (2 when QUAY_PHASE_OVERLAP is on — serial+lowconc run in parallel — 1 when
  // off = sequential, the pre-overlap budget); the LOWCONC default is the SAME host-derived value
  // (gap-lowconc-concurrency-restore-host-derived: lowconc = serial, NOT a fixed 3).
  // RESOURCE_GATE_NPROC / QUAY_MAX_CONCURRENT_SUITES / QUAY_PHASE_OVERLAP are the deterministic seams:
  // nproc=7 ⇒ SERIAL/LOWCONC overlap ON floor(7/(S×2)), OFF floor(7/S); LOWCONC == SERIAL in every row.
  for (const [overlap, slots, serial, lowconc] of [
    ["1", "1", "3", "3"], // overlap ON ⇒ P=2: floor(7/(1×2))=3; LOWCONC = serial = 3
    ["1", "2", "1", "1"], // floor(7/(2×2))=1; LOWCONC = serial = 1
    ["0", "1", "7", "7"], // overlap OFF ⇒ P=1: floor(7/1)=7; LOWCONC = serial = 7
    ["0", "2", "3", "3"], // floor(7/2)=3; LOWCONC = serial = 3
  ]) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "fsr-phaseenv-default-"));
    const { envLog } = fakeTestShRecordingPhaseEnv(root);
    try {
      const child = runRunner({ root, laneCount: 4, env: { RESOURCE_GATE_NPROC: "7", QUAY_MAX_CONCURRENT_SUITES: slots, QUAY_PHASE_OVERLAP: overlap } });
      const { code } = await waitExit(child);
      assert.equal(code, 0, `runner exits 0 on green (slots=${slots}, overlap=${overlap}), got ${code}`);
      await poll(() => fs.existsSync(envLog));
      const line = fs.readFileSync(envLog, "utf8").trim();
      assert.equal(line, `SERIAL=${serial} LOWCONC=${lowconc}`, `serial and lowconc both host-read ÷ slots ÷ phases (nproc=7, slots=${slots}, overlap=${overlap} → ${serial}/${lowconc}), got: ${line}`);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  }
});

test("gap-lane-formula-ignores-phase-overlap-concurrency — concurrentPhaseCount() reads QUAY_PHASE_OVERLAP: default (unset) = 2 phases, \"0\" = 1 phase", () => {
  // The knob defaults to overlap ON (P=2) exactly like test.sh's `PHASE_OVERLAP="${QUAY_PHASE_OVERLAP:-1}"`;
  // only an explicit "0" selects the sequential single-phase budget. A stray "1"/garbage reads as ON —
  // the same default-on semantics test.sh uses (QUAY_PHASE_OVERLAP=0 is the documented ONE-KEY ROLLBACK).
  const prev = process.env.QUAY_PHASE_OVERLAP;
  try {
    delete process.env.QUAY_PHASE_OVERLAP;
    assert.equal(concurrentPhaseCount(), 2, "unset QUAY_PHASE_OVERLAP ⇒ 2 concurrent phases (overlap ON default)");
    process.env.QUAY_PHASE_OVERLAP = "0";
    assert.equal(concurrentPhaseCount(), 1, "QUAY_PHASE_OVERLAP=0 ⇒ 1 phase (sequential, AC3 negative control)");
    process.env.QUAY_PHASE_OVERLAP = "1";
    assert.equal(concurrentPhaseCount(), 2, "QUAY_PHASE_OVERLAP=1 ⇒ 2 phases (overlap ON)");
  } finally {
    if (prev === undefined) delete process.env.QUAY_PHASE_OVERLAP;
    else process.env.QUAY_PHASE_OVERLAP = prev;
  }
});

test("AC1/AC3 (gap-gitignored-carriers-absent-in-verify-worktree) — the runner feeds the suite child QUAY_MAIN_CHECKOUT=<mainRoot> so test.sh can point carrier-dependent discipline checkers at the MAIN checkout", async () => {
  // In a one-shot verify worktree the .quay/ gitignored runtime carriers (fan-in-merge-lock-events.jsonl
  // etc.) are structurally ABSENT, so the fan-in-family checkers were constant-green NOT-EVALUATED every
  // round while their input did not exist. The runner passes mainRoot (= root before one-shot reassignment)
  // as QUAY_MAIN_CHECKOUT; test.sh's main_root=${QUAY_MAIN_CHECKOUT:-$repo_root} then feeds the checkers the
  // MAIN path ⇒ the worktree round reads the SAME data as a main run ⇒ verdicts identical (AC3). On a main
  // run mainRoot == root, so the env equals repo_root and behavior is unchanged (AC2).
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fsr-mainco-"));
  const envLog = path.join(root, "main-checkout.txt");
  fs.mkdirSync(path.join(root, "scripts"), { recursive: true });
  fs.writeFileSync(
    path.join(root, "scripts", "test.sh"),
    `#!/usr/bin/env bash\necho "MAIN=$QUAY_MAIN_CHECKOUT" > '${envLog}'\necho "# tests 1"\necho "# pass 1"\necho "# fail 0"\necho "# cancelled 0"\nexit 0\n`,
    { mode: 0o755 },
  );
  try {
    const child = runRunner({ root });
    const { code } = await waitExit(child);
    assert.equal(code, 0, `runner exits 0 on green, got ${code}`);
    await poll(() => fs.existsSync(envLog));
    const line = fs.readFileSync(envLog, "utf8").trim();
    assert.equal(line, `MAIN=${path.resolve(root)}`, `QUAY_MAIN_CHECKOUT == mainRoot (${path.resolve(root)}), got: ${line}`);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("AC2 — --serial-concurrency 2 / --lowconc-concurrency 5 WIN over the host-read default (controlled experiment)", async () => {
  // The AC2 controlled experiment: run the serial phase at concurrency 2, measure wall-clock +
  // cancelled, and only bump the default if 0-cancelled holds (measure-first, not blind tuning).
  // RESOURCE_GATE_NPROC=12 pins a host default of 12/12 — the explicit 2/5 must still win (AC2:
  // the override channel is preserved over the host-read default, gap-ac44-concurrent-phases-read-
  // host-parallelism).
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fsr-phaseenv-s2-"));
  const { envLog } = fakeTestShRecordingPhaseEnv(root);
  try {
    const args = [
      "--no-warnings", "--experimental-strip-types", RUNNER, "--root", root,
      "--lane-count", "4", "--serial-concurrency", "2", "--lowconc-concurrency", "5",
    ];
    const mergedEnv = {
      ...process.env,
      QUAY_TEST_SKIP_RESOURCE_GATE: "1",
      QUAY_TEST_SKIP_SYSTEMD_RUN: "1",
      RESOURCE_GATE_NPROC: "12",
    };
    const child = spawn(process.execPath, args, { stdio: ["ignore", "pipe", "pipe"], env: mergedEnv });
    child.stdout.on("data", () => {});
    child.stderr.on("data", () => {});
    const { code } = await waitExit(child);
    assert.equal(code, 0, `runner exits 0 on green with serial-concurrency 2, got ${code}`);
    await poll(() => fs.existsSync(envLog));
    const line = fs.readFileSync(envLog, "utf8").trim();
    assert.equal(line, "SERIAL=2 LOWCONC=5", `--serial-concurrency/--lowconc-concurrency must propagate over the host default, got: ${line}`);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("AC2/AC3 — invalid --serial-concurrency / --lowconc-concurrency (0, non-numeric) fails closed", async () => {
  for (const bad of ["0", "abc", "-1"]) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "fsr-phaseenv-bad-"));
    fakeTestShRecordingPhaseEnv(root);
    try {
      const args = [
        "--no-warnings", "--experimental-strip-types", RUNNER, "--root", root,
        "--lane-count", "4", "--serial-concurrency", bad,
      ];
      const mergedEnv = { ...process.env, QUAY_TEST_SKIP_RESOURCE_GATE: "1", QUAY_TEST_SKIP_SYSTEMD_RUN: "1" };
      const child = spawn(process.execPath, args, { stdio: ["ignore", "pipe", "pipe"], env: mergedEnv });
      child.stdout.on("data", () => {});
      child.stderr.on("data", () => {});
      const { code } = await waitExit(child);
      assert.equal(code, 1, `invalid --serial-concurrency '${bad}' must fail closed`);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  }
});

test("AC6 — routeRed/shouldStopDispatch treat crashed like aborted (no code-risk stop) but keep the reason distinguishable", () => {
  // crashed = the runner died mid-run without a correctness conclusion — same no-stop family as
  // aborted/infra-error, but the reason value stays distinct so a consumer can tell "deliberately
  // stopped" from "died silently (re-launch the suite)".
  assert.equal(routeRed({ state: "red", reason: "crashed" }), "resource-gate", "crashed red → resource-gate (NOT a code-failure conclusion)");
  assert.equal(shouldStopDispatch({ state: "red", reason: "crashed" }), false, "crashed red does NOT stop dispatch (no correctness conclusion)");
  assert.notEqual("crashed", "aborted", "crashed is a DISTINCT reason value from aborted (consumer can distinguish)");
  assert.equal(shouldStopDispatch({ state: "red", reason: "failed" }), true, "test-failure red still stops (unchanged, AC5)");
  assert.equal(shouldStopDispatch({ state: "red", reason: "static-check" }), true, "static-check red still stops (unchanged, AC3)");
});


// ── gap-verification-round-load-fields-from-systemd ────────────────────────────────────────────────
// The runner must carry three systemd-scope load fields (cpu_time_s / mem_peak_mb / swap_peak_mb)
// into each verification-round record, parsed from the scope's `Consumed` journal line. Traps
// (manager 2026-08-12): (1) scope_unit is captured at round START into the round's OWN record, never
// re-read from the shared single-slot suite-cgroup-evidence.txt at teardown; (2) the Consumed line
// appears ~2s AFTER the scope ends, so the read is a BOUNDED poll, not an immediate read; (3) a read
// failure is explicit null + reason, never 0.

test("load-fields unit — parseSystemdTimespanToSeconds handles s / min+s / h+min+s forms", () => {
  assert.ok(Math.abs(parseSystemdTimespanToSeconds("3.005s") - 3.005) < 1e-6, "decimal seconds");
  assert.ok(Math.abs(parseSystemdTimespanToSeconds("48min 3.887s") - (48 * 60 + 3.887)) < 1e-6, "min+s");
  assert.ok(Math.abs(parseSystemdTimespanToSeconds("1h 2min 3.456s") - 3723.456) < 1e-6, "h+min+s");
  assert.equal(parseSystemdTimespanToSeconds("not a timespan"), null, "garbage -> null");
  assert.equal(parseSystemdTimespanToSeconds(""), null, "empty -> null");
});

test("load-fields unit — parseSystemdBytesToMb converts IEC binary units (never misreads B as zero-absence)", () => {
  assert.ok(Math.abs(parseSystemdBytesToMb("1.4G") - 1.4 * 1024) < 0.01, "1.4G (IEC) -> 1433.6 MB");
  assert.equal(parseSystemdBytesToMb("0B"), 0, "0B -> 0 MB (a REAL zero, distinct from null absence)");
  assert.equal(parseSystemdBytesToMb("512M"), 512, "512M -> 512 MB");
  assert.equal(parseSystemdBytesToMb("1024K"), 1, "1024K -> 1 MB");
  assert.equal(parseSystemdBytesToMb("1.5GiB"), 1.5 * 1024, "1.5GiB (explicit iB suffix)");
  assert.equal(parseSystemdBytesToMb("abc"), null, "garbage -> null");
});

test("load-fields unit — parseSystemdConsumedLine parses the REAL full-suite Consumed line (48min + IEC memory)", () => {
  const p = parseSystemdConsumedLine(
    "Aug 12 18:42:48 ser702195427338 systemd[2938]: run-r8f2917794c3948958290f71b58ccbdae.scope: Consumed 48min 3.887s CPU time, 1.4G memory peak, 0B memory swap peak.",
  );
  assert.ok(p, "the real observed full-suite Consumed line parses");
  assert.ok(Math.abs(p.cpu_time_s - (48 * 60 + 3.887)) < 1e-6, "48min 3.887s CPU -> seconds");
  assert.ok(Math.abs(p.mem_peak_mb - 1.4 * 1024) < 0.01, "1.4G memory peak -> 1433.6 MB");
  assert.equal(p.swap_peak_mb, 0, "0B memory swap peak -> 0 MB (real zero)");
});

test("load-fields unit — parseSystemdConsumedLine CPU-time-only line → mem/swap null (memory accounting off), never 0", () => {
  const p = parseSystemdConsumedLine(
    "Aug 12 18:47:13 ser702195427338 systemd[2938]: run-r8736381d406c478b9c514ff138f59979.scope: Consumed 3.071s CPU time.",
  );
  assert.ok(p, "a CPU-time-only Consumed line parses");
  assert.ok(Math.abs(p.cpu_time_s - 3.071) < 1e-6, "3.071s CPU");
  assert.equal(p.mem_peak_mb, null, "memory peak ABSENT in the line -> null, never 0 (trap 3)");
  assert.equal(p.swap_peak_mb, null, "swap peak ABSENT in the line -> null, never 0");
});

test("load-fields unit — parseSystemdConsumedLine handles 1h form and rejects non-Consumed lines", () => {
  const p = parseSystemdConsumedLine(
    "run-x.scope: Consumed 1h 2min 3.456s CPU time, 512M memory peak, 10M memory swap peak.",
  );
  assert.ok(p, "1h 2min 3.456s form parses");
  assert.ok(Math.abs(p.cpu_time_s - 3723.456) < 1e-6);
  assert.equal(p.mem_peak_mb, 512, "512M -> 512 MB");
  assert.equal(p.swap_peak_mb, 10, "10M -> 10 MB");
  assert.equal(parseSystemdConsumedLine("Aug 12 18:42:48 h systemd[1]: Started run-x.scope."), null, "Started line is not a Consumed line");
  assert.equal(parseSystemdConsumedLine("no consumed shape here"), null, "unrelated line -> null");
});

test("load-fields unit — readScopeConsumedLoad seam: a Consumed line yields the three fields + null error", async () => {
  process.env.QUAY_TEST_JOURNALCTL_OUTPUT =
    "Aug 12 18:42:48 h systemd[2938]: run-seam.scope: Consumed 2957.234s CPU time, 1.5G memory peak, 0B memory swap peak.";
  try {
    const r = await readScopeConsumedLoad("run-seam.scope", "2026-08-12T00:00:00.000Z");
    assert.equal(r.load_read_error, null, "a full read has no error");
    assert.ok(Math.abs(r.cpu_time_s - 2957.234) < 1e-6, "cpu_time_s parsed (the ≈2957s/round stable denominator)");
    assert.ok(Math.abs(r.mem_peak_mb - 1.5 * 1024) < 0.01, "mem_peak_mb parsed (1.5G)");
    assert.equal(r.swap_peak_mb, 0, "swap_peak_mb 0B");
  } finally {
    delete process.env.QUAY_TEST_JOURNALCTL_OUTPUT;
  }
});

test("load-fields unit — readScopeConsumedLoad seam: no Consumed line → explicit null + reason (trap 3), NEVER 0", async () => {
  process.env.QUAY_TEST_JOURNALCTL_OUTPUT = "Aug 12 18:42:48 h systemd[2938]: Started run-seam.scope.";
  try {
    const r = await readScopeConsumedLoad("run-seam.scope", "2026-08-12T00:00:00.000Z");
    assert.equal(r.cpu_time_s, null, "cpu_time_s null, never 0");
    assert.equal(r.mem_peak_mb, null, "mem_peak_mb null, never 0");
    assert.equal(r.swap_peak_mb, null, "swap_peak_mb null, never 0");
    assert.match(r.load_read_error, /no Consumed line/, "the reason names the failure");
  } finally {
    delete process.env.QUAY_TEST_JOURNALCTL_OUTPUT;
  }
});

test("load-fields — a round record carries scope_unit + the three load fields (seam), load_read_error null", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fsr-load-ok-"));
  const { f, dir } = fakeSuite(GREEN_SUITE);
  try {
    const child = runRunner({
      root,
      command: `bash ${f}`,
      laneCount: 2,
      env: {
        QUAY_TEST_SCOPE_UNIT: "run-seam-ok.scope",
        QUAY_TEST_JOURNALCTL_OUTPUT:
          "Aug 12 18:42:48 h systemd[2938]: run-seam-ok.scope: Consumed 2957.234s CPU time, 1.5G memory peak, 0B memory swap peak.",
      },
    });
    const { code } = await waitExit(child);
    assert.equal(code, 0, "a green hermetic round stays green with the load seam set");
    const rec = lastRoundRecord(root);
    assert.equal(rec.scope_unit, "run-seam-ok.scope", "the record carries THIS round's captured scope_unit (trap 1 — round-captured, not shared-file)");
    assert.ok(Math.abs(rec.cpu_time_s - 2957.234) < 1e-6, "cpu_time_s landed in the record");
    assert.ok(Math.abs(rec.mem_peak_mb - 1.5 * 1024) < 0.01, "mem_peak_mb landed in the record");
    assert.equal(rec.swap_peak_mb, 0, "swap_peak_mb landed in the record");
    assert.equal(rec.load_read_error, null, "a full read has load_read_error null");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("load-fields trap-1 反证 — TWO rounds carry DIFFERENT scope_unit (round-captured, not a shared-file re-read)", async () => {
  // Two hermetic rounds with DIFFERENT seam units. If the record re-read the shared single-slot
  // suite-cgroup-evidence.txt at teardown, both records would name the SAME last-written unit — the
  // shadow-copy-drift shape. Distinct values prove each record carries ITS round's captured unit.
  const units = ["run-seam-a.scope", "run-seam-b.scope"];
  for (const unit of units) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "fsr-load-trap1-"));
    const { f, dir } = fakeSuite(GREEN_SUITE);
    try {
      const child = runRunner({
        root,
        command: `bash ${f}`,
        laneCount: 2,
        env: {
          QUAY_TEST_SCOPE_UNIT: unit,
          QUAY_TEST_JOURNALCTL_OUTPUT: `Aug 12 h systemd[1]: ${unit}: Consumed 3.000s CPU time, 128M memory peak, 0B memory swap peak.`,
        },
      });
      await waitExit(child);
      const rec = lastRoundRecord(root);
      assert.equal(rec.scope_unit, unit, `round record names ITS round's unit ${unit}`);
      // Hermetic mode never writes the shared evidence file — if the record re-read it, scope_unit
      // would be ABSENT; the seam-captured value proves the record reads the memory variable.
      assert.ok(!fs.existsSync(path.join(root, ".quay", "suite-cgroup-evidence.txt")), "no shared evidence file written (hermetic)");
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
});

test("load-fields trap-3 — a failed journal read lands EXPLICIT null + load_read_error (never 0)", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fsr-load-fail-"));
  const { f, dir } = fakeSuite(GREEN_SUITE);
  try {
    const child = runRunner({
      root,
      command: `bash ${f}`,
      laneCount: 2,
      env: {
        QUAY_TEST_SCOPE_UNIT: "run-seam-fail.scope",
        QUAY_TEST_JOURNALCTL_OUTPUT: "Started run-seam-fail.scope (no Consumed line yet).",
      },
    });
    const { code } = await waitExit(child);
    assert.equal(code, 0, "a load-read failure never fails the suite verdict (best-effort)");
    const rec = lastRoundRecord(root);
    assert.equal(rec.scope_unit, "run-seam-fail.scope", "scope_unit still captured (trap 1)");
    assert.equal(rec.cpu_time_s, null, "cpu_time_s explicit null, never 0 (trap 3)");
    assert.equal(rec.mem_peak_mb, null, "mem_peak_mb explicit null, never 0 (trap 3)");
    assert.equal(rec.swap_peak_mb, null, "swap_peak_mb explicit null, never 0 (trap 3)");
    assert.match(rec.load_read_error, /no Consumed line/, "the reason names the failure (trap 3)");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("load-fields — a NON-systemd round (no scope unit) OMITS all four load fields (缺键 contract, reader tolerates absence)", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fsr-load-absent-"));
  const { f, dir } = fakeSuite(GREEN_SUITE);
  try {
    const child = runRunner({ root, command: `bash ${f}`, laneCount: 2 }); // no QUAY_TEST_SCOPE_UNIT seam
    const { code } = await waitExit(child);
    assert.equal(code, 0);
    const rec = lastRoundRecord(root);
    assert.equal(rec.scope_unit, undefined, "no scope_unit on a non-systemd round");
    assert.equal(rec.cpu_time_s, undefined, "no cpu_time_s on a non-systemd round");
    assert.equal(rec.mem_peak_mb, undefined, "no mem_peak_mb on a non-systemd round");
    assert.equal(rec.swap_peak_mb, undefined, "no swap_peak_mb on a non-systemd round");
    assert.equal(rec.load_read_error, undefined, "no load_read_error on a non-systemd round");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});



// ── gap-suite-memorymax-literal-16g-cap-pinned-every-round-while-lanes-scale-with-nproc ────────────
// The suite cgroup's ceiling was a WRITTEN-DOWN `"16G"` constant in full-suite-runner.ts. Re-scoped
// 2026-10-14 (human-directed): **16 GiB stays the default** — a deliberate pressure constraint that
// drives test optimization — but it stops being a code literal: it becomes a project-declared
// (`.quay/config.yml` `suite: memory_max:`) and host-overridable (`QUAY_SUITE_MEMORY_MAX`) setting,
// with the host-relative fraction kept as the UPPER bound.
//
// The same re-scope overturned the task's original premise with read-only measurements, and these
// tests encode the corrected reading:
//   · `peak == memoryMax` is NORMAL (a cgroup's peak includes reclaimable page cache): 10-11 (14/42
//     runs) and 10-12 (12/53) sat at the cap with ZERO `oom_kill`.
//   · OOM kills are RECENT: 10-10 0/8, 10-11 0/42, 10-12 0/53, 10-13 3/25, 10-14 5/8.
//   · The concurrency that actually holds is 64, NOT the requested lane count 128: the scheduler's
//     reliability cap keeps total concurrency at the lowest ACTIVE group's budget, and the
//     serial/lowconc budget is floor(nproc/(S×P)) = 64.
// ⇒ the lane/per-file estimator stays (pure, host-shape-tested) but is a DIAGNOSTIC: it is fed the
// MEASURED concurrency and it may never raise the effective ceiling.
const GIB = 1024 ** 3;
const MIB = 1024 ** 2;
/** The production carrier (main checkout). Absent on a fresh clone ⇒ the tests that need it SKIP. */
const PROD_STATE_DIR = path.join(REPO_ROOT, ".quay");
const HAS_PROD_ROUNDS = fs.existsSync(path.join(PROD_STATE_DIR, "verification-round.jsonl"));

test("AC2 — the effective MemoryMax comes from the DECLARED value, and the declaration is what moves it", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fsr-decl-"));
  try {
    const resolved = resolveSuiteMemoryMax(dir);
    assert.equal(resolved.declared, "16G", "the human-ruled baseline is the declared default");
    assert.equal(resolved.declaredSource, "default", "…and it is the DEFAULT, not an env/config value");
    assert.equal(resolved.bound, "declared", "the declared value is what applied (⛔ not raised to the host fraction)");
    assert.equal(resolved.memoryMax, String(16 * GIB), "16 GiB, in bytes");
    // The declared value is clamped only by the host bound (this host's is far above 16 GiB).
    assert.ok(Number(resolved.memoryMax) <= resolved.hostGuardBytes, "never above the host guardrail");
    assert.equal(Number(resolved.memoryMax), Math.min(16 * GIB, resolved.hostGuardBytes));
    // The module-load template agrees (it resolves the same declaration, no state dir).
    assert.equal(defaultSuiteMemoryMax(), String(Math.min(16 * GIB, sharedHostCeilingBytes(readEffectiveTotalMemBytes(), listSharedHostScopes().count))));
    assert.equal(DEFAULT_SYSTEMD_RUN_LIMITS.memoryMax, defaultSuiteMemoryMax());
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("AC2 — an override CHANGES the effective ceiling (config/env is the mechanism, not the code)", () => {
  // A fixed host guard keeps this deterministic on any host: 64 GiB.
  const guard = 64 * GIB;
  const withDeclared = (v) => suiteMemoryMax({ effectiveTotalMemBytes: 246 * GIB, declared: { value: v, source: "env" }, hostGuardBytes: guard });
  assert.equal(withDeclared("2G").memoryMax, String(2 * GIB), "a 2G declaration is applied verbatim");
  assert.equal(Number(withDeclared("20G").memoryMax), 20 * GIB, "the ceiling FOLLOWS the declaration (⛔ not pinned to 16G in code)");
  assert.equal(withDeclared("20G").bound, "declared");
  assert.notEqual(withDeclared("2G").memoryMax, withDeclared("20G").memoryMax, "two declarations ⇒ two ceilings");

  // The env knob is the declared-source path the runner reads (config promotes into the same env).
  assert.deepEqual(declaredSuiteMemoryMax("8G"), { value: "8G", source: "env" });
  assert.deepEqual(declaredSuiteMemoryMax(" 16G "), { value: "16G", source: "env" }, "whitespace tolerated");
  assert.deepEqual(declaredSuiteMemoryMax(""), { value: SUITE_MEMORY_MAX_DEFAULT, source: "default" }, "empty ⇒ the default");
  assert.deepEqual(declaredSuiteMemoryMax(undefined), { value: SUITE_MEMORY_MAX_DEFAULT, source: "default" });
  assert.deepEqual(declaredSuiteMemoryMax("banana"), { value: SUITE_MEMORY_MAX_DEFAULT, source: "default" }, "an unparseable value must NOT reach systemd-run (it would refuse the scope)");
  // The runner's env is the knob the config promotes into (the SAME name, so config < env holds).
  assert.equal(process.env.QUAY_SUITE_MEMORY_MAX === undefined || typeof process.env.QUAY_SUITE_MEMORY_MAX === "string", true);
});

test("AC2 — a declared value ABOVE the host fraction is CLAMPED, and a small fixture host never exceeds its bound", () => {
  // An 8 GiB effective host with the 0.25 fraction ⇒ a 2 GiB bound.
  const clamped = suiteMemoryMax({ effectiveTotalMemBytes: 8 * GIB, declared: { value: "16G", source: "env" }, hostGuardBytes: 2 * GIB });
  assert.equal(clamped.bound, "host-guard", "an above-host declaration is the host-guard case");
  assert.equal(clamped.memoryMax, String(2 * GIB), "…and the host bound is what applies");
  assert.ok(Number(clamped.memoryMax) <= 2 * GIB, "⛔ never above the host bound");
  assert.match(clamped.reason, /exceeds the host-relative guardrail/);

  // The FIXTURE SMALL HOST (8 GB) end to end, via the real derivation (no injected guard): the declared
  // 16 GiB cannot leak onto a host that has 8 GiB.
  const smallHost = suiteMemoryMax({ effectiveTotalMemBytes: 8 * GIB, declared: declaredSuiteMemoryMax("16G") });
  assert.equal(smallHost.memoryMax, String(2 * GIB), "8 GB host ⇒ 2 GiB, from the host fraction");
  assert.ok(Number(smallHost.memoryMax) <= 8 * GIB, "never above the whole host, let alone 16 GiB");
  assert.equal(suiteMemoryMax({ effectiveTotalMemBytes: 4 * GIB, declared: { value: "16G", source: "default" } }).memoryMax, String(GIB), "4 GB host ⇒ 1 GiB");
  // …and a declaration UNDER the small host's bound still wins there (the clamp is an upper bound, not a rewrite).
  assert.equal(suiteMemoryMax({ effectiveTotalMemBytes: 8 * GIB, declared: { value: "512M", source: "env" } }).memoryMax, String(512 * MIB));
  // A malformed declaration degrades to the host guard (fail-safe: never forward garbage to systemd-run).
  const bad = suiteMemoryMax({ effectiveTotalMemBytes: 4 * GIB, declared: { value: "sixteen gigs", source: "env" } });
  assert.equal(bad.bound, "host-guard");
  assert.equal(bad.memoryMax, String(GIB));
  assert.match(bad.reason, /not a parseable size/);
});

test("AC3 — the concurrency input is the MEASURED overlap of per-file intervals, not the requested lane count", () => {
  // Pure: three overlapping intervals + one disjoint ⇒ max overlap 3; the disjoint file does not count.
  const rows = [
    {
      perFile: [
        { startedAtMs: 0, endedAtMs: 100 },
        { startedAtMs: 10, endedAtMs: 110 },
        { startedAtMs: 20, endedAtMs: 30 },
        { startedAtMs: 200, endedAtMs: 300 },
      ],
    },
  ];
  assert.equal(actualConcurrencyFromRows(rows), 3, "the max number of intervals overlapping at one instant");
  // A file ENDING at t and another STARTING at t are not concurrent (the interval boundary is half-open).
  assert.equal(actualConcurrencyFromRows([{ perFile: [{ startedAtMs: 0, endedAtMs: 10 }, { startedAtMs: 10, endedAtMs: 20 }] }]), 1);
  // 缺值 ≠ 0: no usable timestamps ⇒ null, never a fabricated 0.
  assert.equal(actualConcurrencyFromRows([{ perFile: [{ startedAtMs: 0 }] }]), null);
  assert.equal(actualConcurrencyFromRows([]), null);
  assert.equal(actualConcurrencyFromRows([{}]), null);
});

test(
  "AC3 — a REAL round's measured concurrency equals an independent overlap computation, and the diagnostic is below 16 GiB",
  { skip: HAS_PROD_ROUNDS ? false : "no .quay/verification-round.jsonl in this checkout (fresh clone) — nothing to measure" },
  async () => {
    const real = resolveSuiteMemoryMax(PROD_STATE_DIR);
    assert.ok(real.actualConcurrency !== null && real.actualConcurrency > 0, `a real measured concurrency (${real.actualConcurrency})`);
    assert.ok(real.actualConcurrency < 128, "…BELOW the requested lane count 128 — the scheduler's reliability cap is why");
    assert.ok(real.perFileHighWaterBytes !== null && real.perFileHighWaterBytes > 0, "the per-file high-water is measured too");
    assert.ok(real.laneScaledEstimateBytes !== null && real.laneScaledEstimateBytes > 0);
    assert.ok(real.laneScaledEstimateBytes < 16 * GIB, `the diagnostic is below the declared 16 GiB (${(real.laneScaledEstimateBytes / GIB).toFixed(2)} GiB)`);
    assert.equal(real.laneScaledExceedsHostGuard, false);
    assert.equal(real.memoryMax, String(16 * GIB), "the effective ceiling is still the declared 16 GiB");

    // INDEPENDENT overlap computation on the same carrier (a different algorithm: for every start
    // timestamp, count the intervals containing it) — the reader and the carrier must agree numerically.
    const text = fs.readFileSync(path.join(PROD_STATE_DIR, "verification-round.jsonl"), "utf8").trim().split("\n");
    const rows = [];
    for (let i = text.length - 1; i >= 0 && rows.length < 5; i--) {
      try {
        rows.push(JSON.parse(text[i]));
      } catch {
        /* torn line */
      }
    }
    const iv = rows.flatMap((r) => (r.perFile || []).filter((f) => Number.isFinite(f.startedAtMs) && Number.isFinite(f.endedAtMs)).map((f) => [f.startedAtMs, f.endedAtMs]));
    let bruteMax = 0;
    for (const [s] of iv) {
      let n = 0;
      for (const [a, b] of iv) if (a <= s && s < b) n++;
      if (n > bruteMax) bruteMax = n;
    }
    assert.equal(real.actualConcurrency, bruteMax, `the reader's ${real.actualConcurrency} equals the independent count ${bruteMax}`);
  },
);

test("AC3/DoD — the diagnostic can NEVER raise the effective MemoryMax above the declared value", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fsr-noraise-"));
  try {
    // A deliberately alarming measurement: ~1 TB of "measured" per-file demand, 200-way concurrency.
    fs.writeFileSync(
      path.join(dir, "verification-round.jsonl"),
      `${JSON.stringify({
        round: 1,
        perFile: Array.from({ length: 200 }, (_, i) => ({ startedAtMs: 0, endedAtMs: 1000, memPeakKb: 5_000_000 + i })),
      })}\n`,
    );
    const wild = resolveSuiteMemoryMax(dir);
    assert.equal(wild.laneScaledEstimateBytes > 16 * GIB, true, `the diagnostic DOES react to the measurement (${(wild.laneScaledEstimateBytes / GIB).toFixed(1)} GiB)`);
    assert.equal(wild.memoryMax, String(16 * GIB), "⛔ but the effective MemoryMax is STILL the declared 16 GiB");
    assert.equal(wild.bound, "declared");

    // A wide measured concurrency alone must not move it either.
    fs.writeFileSync(
      path.join(dir, "verification-round.jsonl"),
      `${JSON.stringify({ round: 1, perFile: Array.from({ length: 128 }, (_, i) => ({ startedAtMs: 0, endedAtMs: 1000, memPeakKb: 900_000 + i })) })}\n`,
    );
    const wide = resolveSuiteMemoryMax(dir);
    assert.equal(wide.actualConcurrency, 128, "the reader reports the wide concurrency it measured");
    assert.equal(wide.memoryMax, String(16 * GIB), "…and the ceiling is untouched by it");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("DoD — no commit may raise the effective default above 16 GiB: the resolved default is PINNED here", () => {
  // The human ruled 16 GiB a deliberate pressure baseline (2026-10-14). This is the mechanical half of
  // "no commit on this branch raises the effective default": change SUITE_MEMORY_MAX_DEFAULT, or make
  // the runner derive a bigger default, and THIS goes red.
  assert.equal(SUITE_MEMORY_MAX_DEFAULT, "16G", "the declared default is 16G");
  assert.equal(parseSystemdBytesToMb(SUITE_MEMORY_MAX_DEFAULT) * 1024 * 1024, 16 * GIB);
  assert.ok(Number(defaultSuiteMemoryMax()) <= 16 * GIB, `the resolved default never exceeds 16 GiB (${defaultSuiteMemoryMax()})`);
  assert.ok(Number(DEFAULT_SYSTEMD_RUN_LIMITS.memoryMax) <= 16 * GIB);
  // On a host whose guardrail is at or above 16 GiB (this one), the default is EXACTLY 16 GiB.
  if (sharedHostCeilingBytes(readEffectiveTotalMemBytes(), listSharedHostScopes().count) >= 16 * GIB) {
    assert.equal(defaultSuiteMemoryMax(), String(16 * GIB), "16 GiB exactly — ⛔ not 24/26 GiB");
  }
});

test("unit — readSuiteMemoryMeasurements reads the round record's own perFile (rows absent ⇒ both null)", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fsr-meas-"));
  try {
    assert.deepEqual(readSuiteMemoryMeasurements(dir), { actualConcurrency: null, perFileHighWaterBytes: null }, "no carrier ⇒ nulls, never zeros");
    // Distinct ABSOLUTE timestamps per round (real rounds do not share a time base): one file per
    // round ⇒ the pooled overlap is 1, not one-per-row.
    const rows = [];
    for (let r = 1; r <= 8; r++) rows.push(JSON.stringify({ round: r, perFile: [{ startedAtMs: r * 1000, endedAtMs: r * 1000 + 10, memPeakKb: r * 1000 }] }));
    fs.writeFileSync(path.join(dir, "verification-round.jsonl"), rows.join("\n") + "\n");
    const m = readSuiteMemoryMeasurements(dir, { rounds: 3, percentile: 1 });
    assert.equal(m.perFileHighWaterBytes, 8000 * 1024, "only the newest N rounds are pooled");
    assert.equal(m.actualConcurrency, 1, "one file per round ⇒ overlap 1");
    // A torn trailing line (the runner's own append observed mid-write) is skipped, never fabricated.
    fs.appendFileSync(path.join(dir, "verification-round.jsonl"), '{"round": 9, "perFile": [{"memPeakKb"');
    assert.equal(readSuiteMemoryMeasurements(dir, { rounds: 1, percentile: 1 }).perFileHighWaterBytes, 8000 * 1024);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("unit — a bounded tail window starts mid-record: the truncated first line is dropped, newer rounds still read", () => {
  const small = fs.mkdtempSync(path.join(os.tmpdir(), "fsr-tail-"));
  try {
    const body = [111, 222, 333, 444, 555].map((kb, i) => JSON.stringify({ round: i + 1, perFile: [{ memPeakKb: kb }] }));
    assert.ok(body.every((l) => l.length === 41), "fixture rows are all 41 bytes so the window arithmetic holds");
    fs.writeFileSync(path.join(small, "verification-round.jsonl"), body.join("\n") + "\n");
    assert.equal(readSuiteMemoryMeasurements(small, { rounds: 5, percentile: 1, maxTailBytes: 60 }).perFileHighWaterBytes, 555 * 1024);
    assert.equal(readSuiteMemoryMeasurements(small, { rounds: 5, percentile: 1 }).perFileHighWaterBytes, 555 * 1024, "the unbounded read agrees");
  } finally {
    fs.rmSync(small, { recursive: true, force: true });
  }
});

test("unit — readEffectiveTotalMemBytes is fail-open (never throws, never 0, never above the host total)", () => {
  const eff = readEffectiveTotalMemBytes();
  assert.ok(Number.isInteger(eff) && eff > 0, `effective total mem is a positive byte count (got ${eff})`);
  assert.ok(eff <= os.totalmem(), "effective can never EXCEED the host total");
});

test(
  "REAL cgroup — on a real MemoryMax=4G external scope the DEFAULT is clamped to the host bound, not 16 GiB",
  { skip: systemdRunAvailable() ? false : "not-evaluated: systemd-run --user --scope unavailable on this host" },
  async () => {
    // A REAL cgroup construction (systemd-run --scope), ⛔ not a mock. The unit name deliberately does
    // NOT match quay's own envelope prefixes ⇒ it stands in for an EXTERNAL cap (container / VM / slice).
    const unit = `quay-suite-memtest-${Date.now()}-${process.pid}.scope`;
    const probe = `import(${JSON.stringify(RUNNER)}).then(m=>console.log(JSON.stringify({effective:m.readEffectiveTotalMemBytes(),memoryMax:m.DEFAULT_SYSTEMD_RUN_LIMITS.memoryMax,totalmem:require("os").totalmem()}))).catch(e=>{console.error(e);process.exit(1)})`;
    const { code, out, err } = await spawnCmd([
      "systemd-run", "--user", "--scope", "--quiet", "--unit", unit,
      "-p", "MemoryMax=4G", "-p", "MemorySwapMax=0",
      process.execPath, "--experimental-strip-types", "-e", probe,
    ]);
    assert.equal(code, 0, `the scoped probe exits 0; stderr=${err}`);
    const line = (out ?? "").trim().split("\n").filter((l) => l.startsWith("{")).pop();
    assert.ok(line, `no reading from the scoped probe — stdout=${JSON.stringify(out)} stderr=${JSON.stringify(err)}`);
    const reading = JSON.parse(line);
    assert.equal(reading.effective, 4 * GIB, "the effective total is the cgroup cap (4G), read from the real cgroup");
    // The declared 16 GiB must NOT leak onto a 4 GiB host: the host fraction is the upper bound.
    assert.equal(reading.memoryMax, String(GIB), "4 GiB effective ⇒ the declared 16 GiB is clamped to floor(4G × 0.25) = 1 GiB");
    assert.notEqual(reading.memoryMax, String(16 * GIB), "⛔ the declared default must never exceed the host bound");
    assert.ok(reading.totalmem > reading.effective, "os.totalmem() is the big host total ⇒ the SMALL value came from the cgroup cap, not from a small host");
  },
);

test(
  "REAL cgroup negative control — quay's OWN envelope scope name does NOT shrink the declared ceiling (⛔ not external capacity)",
  { skip: systemdRunAvailable() ? false : "not-evaluated: systemd-run --user --scope unavailable on this host" },
  async () => {
    // The exclusion is still load-bearing after the re-scope: if the reading consumed quay's own
    // `quay-anchor-*` guardrail, a declared 16 GiB would be clamped to ≈0.25 × that (≈6.5 GiB) — the
    // 2026-08-era bug in a new dress. A scope named `quay-anchor-*` with a 1G cap must be IGNORED.
    const unit = `quay-anchor-fsr-probe-${Date.now()}-${process.pid}.scope`;
    const probe = `import(${JSON.stringify(RUNNER)}).then(m=>console.log(JSON.stringify({effective:m.readEffectiveTotalMemBytes(),memoryMax:m.DEFAULT_SYSTEMD_RUN_LIMITS.memoryMax,totalmem:require("os").totalmem()}))).catch(e=>{console.error(e);process.exit(1)})`;
    const { code, out, err } = await spawnCmd([
      "systemd-run", "--user", "--scope", "--quiet", "--unit", unit,
      "-p", "MemoryMax=1G", "-p", "MemorySwapMax=0",
      process.execPath, "--experimental-strip-types", "-e", probe,
    ]);
    assert.equal(code, 0, `the scoped probe exits 0; stderr=${err}`);
    const line = (out ?? "").trim().split("\n").filter((l) => l.startsWith("{")).pop();
    assert.ok(line, `no reading from the scoped probe — stdout=${JSON.stringify(out)} stderr=${JSON.stringify(err)}`);
    const reading = JSON.parse(line);
    // effective-capacity-probe.ts's output contract is MB precision, so the host total is truncated to
    // whole MB (measured delta < 1 MiB on this host). The assertion pins that documented shape: it
    // fails loudly if quay's own 1G anchor cap is consumed (effective would collapse to 1G).
    assert.ok(
      reading.effective <= reading.totalmem && reading.effective > reading.totalmem - 2 * 1024 * 1024,
      `a quay-anchor-* scope is our own guardrail ⇒ the reading falls through to the host total (MB-truncated), NOT the 1G we set; effective=${reading.effective} totalmem=${reading.totalmem}`,
    );
    assert.notEqual(reading.effective, 1024 * GIB, `effective (${reading.effective}) is the host total, ⛔ not the 1G we set on our own anchor-named scope`);
    assert.equal(reading.memoryMax, defaultSuiteMemoryMax(), "the scoped reading and the in-process constant agree");
  },
);

test(
  "REAL cgroup NESTED — a quay-anchor-* ANCESTOR scope is skipped while a NON-quay child cgroup one level down IS consumed (gap-full-suite-runner-dedupe-memory-envelope-to-probe)",
  { skip: systemdRunAvailable() ? false : "not-evaluated: systemd-run --user --scope unavailable on this host" },
  async () => {
    // Built on a REAL cgroup chain (⛔ not a mock): the outer scope is a quay-OWN `quay-anchor-*`
    // envelope (1G), and INSIDE it a real CHILD cgroup is created through the scope's delegation with
    // `memory.max=4G`. ⚠️ The two layers are chosen so the test DISCRIMINATES: the layer that must be
    // EXCLUDED (the anchor, 1G) is TIGHTER than the layer that must be CONSUMED (the child, 4G).
    const unit = `quay-anchor-fsr-nested-${Date.now()}-${process.pid}.scope`;
    const probe = `import(${JSON.stringify(RUNNER)}).then(m=>console.log(JSON.stringify({effective:m.readEffectiveTotalMemBytes(),memoryMax:m.DEFAULT_SYSTEMD_RUN_LIMITS.memoryMax,totalmem:require("os").totalmem()}))).catch(e=>{console.error(e);process.exit(1)})`;
    const inner = [
      "set -e",
      'P=/sys/fs/cgroup$(cut -d: -f3 /proc/self/cgroup)',
      'mkdir -p "$P/inner"',
      'echo $$ > "$P/inner/cgroup.procs"',
      'echo +memory > "$P/cgroup.subtree_control"',
      'echo 4294967296 > "$P/inner/memory.max"',
      'echo "NESTED_SELF=$(cat /proc/self/cgroup)"',
      'echo "NESTED_ANCHOR_MAX=$(cat "$P/memory.max")"',
      'echo "NESTED_CHILD_MAX=$(cat "$P/inner/memory.max")"',
      'exec "$QUAY_NESTED_NODE" --experimental-strip-types -e "$QUAY_NESTED_PROBE"',
    ].join("\n");
    const { code, out, err } = await spawnCmd(
      ["systemd-run", "--user", "--scope", "--quiet", "--unit", unit, "-p", "MemoryMax=1G", "-p", "MemorySwapMax=0", "-p", "Delegate=yes", "bash", "-c", inner],
      { ...process.env, QUAY_NESTED_NODE: process.execPath, QUAY_NESTED_PROBE: probe },
    );
    assert.equal(code, 0, `the nested probe exits 0; stdout=${JSON.stringify(out)} stderr=${JSON.stringify(err)}`);
    assert.match(out, /NESTED_SELF=\S*quay-anchor-fsr-nested-[^\s/]*\.scope\/inner/, `the probe ran inside the nested child cgroup; stdout=${JSON.stringify(out)}`);
    assert.match(out, /NESTED_ANCHOR_MAX=1073741824/, `the ancestor scope's kernel memory.max really is 1G; stdout=${JSON.stringify(out)}`);
    assert.match(out, /NESTED_CHILD_MAX=4294967296/, `the child cgroup's kernel memory.max really is 4G; stdout=${JSON.stringify(out)}`);
    const line = (out ?? "").trim().split("\n").filter((l) => l.startsWith("{")).pop();
    assert.ok(line, `no reading from the nested probe — stdout=${JSON.stringify(out)} stderr=${JSON.stringify(err)}`);
    const reading = JSON.parse(line);
    assert.equal(reading.effective, 4 * GIB, `the NON-quay child layer (4G) is CONSUMED and the TIGHTER quay-anchor ancestor (1G) is SKIPPED — effective=${reading.effective}`);
    assert.notEqual(reading.effective, GIB, "⛔ the quay-own ancestor's 1G was NOT consumed (that would be the feedback loop the exclusion exists to prevent)");
    assert.equal(reading.memoryMax, String(GIB), "the declared 16 GiB is clamped to the consumed 4G layer: floor(4G × 0.25) = 1G");
    assert.ok(reading.totalmem > reading.effective, "os.totalmem() is the big host total ⇒ the 4G came from the cgroup chain, not from a small host");
  },
);

// ── gap-independent-anchor-memory-envelope-oversubscribes-shared-host (suite half) ───────────────
// The SUITE is a second long-lived consumer of the same host-derived fraction: it and the anchor
// groups are alive at the same time, so the suite's share adds to the same sum. It is wired through
// the SAME `sharedHostCeilingBytes` (⛔ one implementation, 硬规则 5b — this file owns no second copy
// of the formula), which is the UPPER bound on the declared ceiling for the PROJECT-BLIND DEFAULT —
// so a default is never above what the shared host can afford, while the 16 GiB baseline here is
// honoured unchanged.
// ⚠️ WHICH rule produces the upper bound is selected by the DECLARATION'S PROVENANCE
// (gap-suite-declared-memory-max-swallowed-by-shared-host-split, 人 2026-10-15 裁定): an explicitly
// DECLARED ceiling (`.quay/config.yml` `suite: memory_max:` / `QUAY_SUITE_MEMORY_MAX`) is bounded by
// the PROJECT-BLIND `0.25 × effective host total` instead, so the shared-host split can no longer
// silently swallow an operator's declaration. The selection's ONE home is `suiteHostGuard` in
// plugin/scripts/full-suite-runner.ts (⛔ not restated here), and its ACs live in
// full-suite-runner-declared-memory-guard.test.mjs. The loop below injects a guard explicitly, so it
// holds for BOTH rules — it pins `suiteMemoryMax`'s own contract, not the selection.

test("unit — the shared-host step is the UPPER bound: it never RAISES the declared ceiling", () => {
  const effective = readEffectiveTotalMemBytes();
  const reading = listSharedHostScopes();
  const blind = Math.floor((effective * SCOPE_ENVELOPE_HOST_FRACTION) / 4096) * 4096;
  for (const n of [0, 1, 2, 8, 10 ** 6]) {
    const guard = sharedHostCeilingBytes(effective, n);
    const applied = Number(suiteMemoryMax({ effectiveTotalMemBytes: effective, declared: declaredSuiteMemoryMax(), hostGuardBytes: guard }).memoryMax);
    assert.ok(applied > 0, `sibling count ${n}: a real positive ceiling`);
    assert.ok(applied <= Math.min(16 * GIB, guard), `sibling count ${n}: the shared step must never RAISE the ceiling (${applied})`);
    assert.ok(guard <= blind, `sibling count ${n}: the shared ceiling is never above the project-blind fraction`);
  }
  assert.equal(sharedHostCeilingBytes(1024 * GIB, 10 ** 6), SHARED_HOST_MIN_CEILING_BYTES);
  assert.equal(SHARED_HOST_MIN_CEILING_BYTES, 2 * SHARED_HOST_OBSERVED_PEAK_BYTES);
  assert.equal(reading.count === null || reading.count >= 0, true, "the count is either a real reading or the explicit not-evaluated value");
});

test("unit — suiteMemoryMax honours an explicitly supplied host guardrail and an explicit declaration (the wiring is not decorative)", () => {
  const base = { effectiveTotalMemBytes: 1024 * GIB, declared: declaredSuiteMemoryMax() };
  assert.equal(suiteMemoryMax({ ...base, hostGuardBytes: 12345 }).memoryMax, "12345", "a supplied guardrail is returned as-is when it is the binding one");
  assert.equal(suiteMemoryMax({ ...base, hostGuardBytes: 1024 * GIB }).memoryMax, String(16 * GIB), "…and the declared 16 GiB applies under a huge guard");
  assert.equal(suiteMemoryMax({ ...base, hostGuardBytes: GIB }).bound, "host-guard");
  // Two different declarations ⇒ two different ceilings (⛔ not a constant in disguise).
  assert.notEqual(
    suiteMemoryMax({ ...base, declared: { value: "2G", source: "env" } }).memoryMax,
    suiteMemoryMax({ ...base, declared: { value: "8G", source: "env" } }).memoryMax,
  );
  // …and a genuinely small EFFECTIVE memory (a container) bounds it — which is why the REAL-cgroup 4G
  // test above keeps its `floor(4G × 0.25) = 1G` expectation.
  const small = suiteMemoryMax({ effectiveTotalMemBytes: 4 * GIB, declared: { value: "16G", source: "default" } });
  assert.equal(Number(small.memoryMax), GIB);
  assert.equal(sharedHostCeilingBytes(4 * GIB, 10 ** 6), Number(small.memoryMax));
});

test("AC3 — the lane-scaled ESTIMATOR is pure and follows the host/concurrency shape (⛔ it is a diagnostic, not the ceiling)", () => {
  // A big host at the REQUESTED 128 lanes: the estimate exceeds 16 GiB — exactly why it must not be the
  // ceiling (it would raise the human-ruled baseline). It is reported as evidence instead.
  const wide = laneScaledScopeMemoryMax({ effectiveTotalMemBytes: 246 * GIB, laneCount: 128, perFileHighWaterBytes: 160 * MIB });
  assert.equal(wide.bound, "lane-scaled");
  assert.equal(Number(wide.memoryMax), Math.floor(Math.ceil(128 * 160 * MIB * SCOPE_ENVELOPE_LANE_HEADROOM) / 4096) * 4096);
  assert.ok(Number(wide.memoryMax) > 16 * GIB, "the 128-lane estimate is ABOVE 16 GiB");
  // …at the MEASURED concurrency of 64 it is BELOW 16 GiB, i.e. the baseline covers the real shape.
  const real = laneScaledScopeMemoryMax({ effectiveTotalMemBytes: 246 * GIB, laneCount: 64, perFileHighWaterBytes: 160 * MIB });
  assert.equal(Number(real.memoryMax), Math.floor(Math.ceil(64 * 160 * MIB * SCOPE_ENVELOPE_LANE_HEADROOM) / 4096) * 4096);
  assert.ok(Number(real.memoryMax) < 16 * GIB, "64 × 160 MiB × 1.25 = 12.5 GiB < 16 GiB");
  assert.ok(Number(real.memoryMax) < Number(wide.memoryMax), "the estimator follows the concurrency input (⛔ not a constant)");
  // A small host: the host guard binds (and both halves scale with the host, never as a literal).
  const small = laneScaledScopeMemoryMax({ effectiveTotalMemBytes: 8 * GIB, laneCount: 4, perFileHighWaterBytes: 160 * MIB });
  assert.equal(small.hostGuardBytes, 2 * GIB);
  assert.ok(Number(small.memoryMax) < 16 * GIB, "an 8 GiB host must never get a 16 GiB ceiling");
  // No measurement ⇒ its own value, not a zero.
  const none = laneScaledScopeMemoryMax({ effectiveTotalMemBytes: 246 * GIB, laneCount: 64, perFileHighWaterBytes: null });
  assert.equal(none.bound, "host-guard");
  assert.equal(none.laneScaledBytes, null);
  assert.match(none.reason, /no per-member memory measurement/);
});

// ── gap-test-spawned-resident-drivers-outlive-their-suite-no-process-group-reaping (AC2) ────────────
// The suite-end backstop: after the planned files finish, any process still alive in the suite's OWN
// process group is enumerated (pid / start time / cmdline / cwd), killed by group, and recorded — and
// the round becomes `not-evaluated: leaked-processes (n)` rather than green.
//
// The fixture deliberately reproduces the measured incident shape at suite scale: a background child
// INHERITS the suite's stdio, so it holds the runner's stdout pipe open after the direct child exits.
// Pre-fix that defers `close` FOREVER (the runner never got past the await and never wrote a verdict —
// the 18h round); post-fix the round is gated on `exit` + a bounded sweep.

test("AC2 — suite-end backstop: a leaked resident child yields not-evaluated: leaked-processes (1), reaped", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fsr-leak-"));
  const leakedPidFile = path.join(root, "leaked.pid");
  const MARKER = "quay-leaked-fixture-marker-2f6d1a";
  // A resident child that inherits the suite's stdout (⇒ it holds the runner's stdio pipe open) and
  // outlives the shell that started it. The shell still reports a fully-green TAP tally, so the ONLY
  // thing that can stop the round from certifying green is the backstop.
  const { f, dir } = fakeSuite(
    `node -e "setInterval(() => {}, 1000)" ${MARKER} &\n` +
      `echo $! > ${leakedPidFile}\n` +
      `echo "# tests 1"\necho "# pass 1"\necho "# fail 0"\necho "# cancelled 0"\nexit 0`,
  );
  try {
    const child = runRunner({ root, command: `bash ${f}`, laneCount: 2 });
    const { code } = await waitExit(child);
    const leakedPid = Number(fs.readFileSync(leakedPidFile, "utf8").trim());
    assert.ok(Number.isInteger(leakedPid), "the fixture recorded the resident child's pid");

    // The verdict is NOT green: the tests all passed, but the round did not earn a certificate.
    const state = readState(root);
    assert.equal(state.state, "red", "a round that leaked a process must not certify green");
    assert.equal(state.notEvaluated, "leaked-processes (1)", "the round is not-evaluated, naming the leak");
    assert.equal(state.leakedProcesses.length, 1, "one leaked process enumerated");
    const leaked = state.leakedProcesses[0];
    assert.equal(leaked.pid, leakedPid, "the enumerated pid is the fixture's leaked child");
    assert.ok(leaked.cmdline.includes(MARKER), `the cmdline is recorded: ${leaked.cmdline}`);
    assert.ok(leaked.cwd !== null, `the cwd is recorded (null only when unreadable): ${leaked.cwd}`);
    assert.ok(typeof leaked.pgid === "number", "the process group is recorded");
    assert.equal(code, 1, "a non-green round exits 1 (it cannot be mistaken for a pass)");

    // …and the child was actually REAPED, not merely reported.
    assert.equal(await waitGone(leakedPid), true, "the leaked child was killed by group");

    // The round ledger carries the same reading (the state file is overwritten each round).
    const rec = lastRoundRecord(root);
    assert.equal(rec.state, "red");
    assert.equal(rec.notEvaluated, "leaked-processes (1)", "the round ledger row carries the not-evaluated value");
    assert.equal(rec.reason, "aborted", "a leak is NOT a code failure verdict — no correctness conclusion");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("AC2 negative control — a clean round adds NO leak key and stays green", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fsr-noleak-"));
  const { f, dir } = fakeSuite(GREEN_SUITE);
  try {
    const child = runRunner({ root, command: `bash ${f}`, laneCount: 2 });
    const { code } = await waitExit(child);
    assert.equal(code, 0, "a clean round is still green — the backstop adds no false positive");
    const state = readState(root);
    assert.equal(state.state, "green");
    // The leak reading is absent-unless-applicable (the same contract this shape already uses for
    // `void` / `staticCheck`): a clean round adds NO key, so the green state's shape is unchanged
    // (full-suite-runner-s01.test.mjs pins that exact key set). The sweep's own "it ran" evidence for
    // a clean round is the runner's `leak sweep — 0 survivor(s)` stderr line.
    assert.equal(state.leakedProcesses, undefined, "a clean round adds no leakedProcesses key");
    assert.equal(state.notEvaluated, undefined, "no not-evaluated value on a clean round");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

/** Poll for the pid to disappear (a signal's effect is asynchronous to the signalling process). */
async function waitGone(pid, { timeoutMs = 5000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      process.kill(pid, 0);
    } catch {
      return true;
    }
    if (Date.now() >= deadline) return false;
    await new Promise((r) => setTimeout(r, 25));
  }
}

// ── gap-test-spawned-resident-drivers-outlive-their-suite-no-process-group-reaping (AC1) ─────────────
// The TEST-SIDE half of the fix (the AC2 tests above are the runner-side half): the shared lifecycle
// helper must reap a test-spawned resident driver on SUCCESS, FAILURE, TIMEOUT and CANCELLATION alike,
// and a bare `spawn` must still leak (the pre-fix negative control).
//
// The fixture is a SMALL node:test file written into a temp dir at run time and executed by a real
// `node --test` child — the same topology as the 18h incident (`node --test` → test file → resident
// driver). Each fixture spawns the REAL resident driver (plugin/scripts/promotion-driver.ts with an
// injectable no-op --ready-pool-cmd and --interval 1000 — the incident's leaked fixture shape at a
// lower poll rate), records its pid, then takes one of four paths: pass / throw / hang past a node:test
// timeout / keep running until the runner SIGINTs the file. Every fixture ALSO writes `<pidfile>.alive`
// after a short settle — the POSITIVE CONTROL that the driver really was resident, so the post-condition
// ("the group is gone") is never vacuous.

const HELPER_PATH = path.join(REPO_ROOT, "plugin", "test", "helpers", "spawn-kernel-process.mjs");
const DRIVER_PATH = path.join(REPO_ROOT, "plugin", "scripts", "promotion-driver.ts");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function pollFor(fn, { timeoutMs = 20_000, intervalMs = 25 } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      if (fn()) return true;
    } catch { /* not ready yet */ }
    await sleep(intervalMs);
  }
  return false;
}

/**
 * The fixture must be a REAL `node --test` run. Node marks a test-file child with NODE_TEST_CONTEXT /
 * NODE_TEST_WORKER_ID, and `node --test` invoked with those set refuses to run ("node:test run() is
 * being called recursively within a test file. skipping running files" — measured: exit 0 with zero
 * tests, a SILENT no-op that would make every assertion below vacuous). Drop both for the child.
 */
function fixtureEnv() {
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  delete env.NODE_TEST_WORKER_ID;
  return env;
}

/** The driver argv the fixture spawns — a resident loop (no `--once`), the incident's exact shape. */
function driverArgv(root) {
  return [
    "--no-warnings", "--experimental-strip-types", DRIVER_PATH,
    "--root", root,
    "--ready-pool-cmd",
    "node -e console.log(JSON.stringify({pool:0,should_apply:false,promotions:[],applied_promotions:[]}))",
    "--interval", "1000", "--cap", "5", "--json",
  ];
}

/**
 * Write the fixture test file. `withHelper` = true ⇒ spawn through the shared helper (post-fix
 * behaviour); false ⇒ a BARE `spawn` with no group and no cleanup (the pre-fix negative control).
 */
function writeFixture({ mode, withHelper }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `skp-fixture-${mode}-`));
  const root = path.join(dir, "ws");
  fs.mkdirSync(path.join(root, ".quay"), { recursive: true });
  const pidFile = path.join(dir, "driver.pid");
  const spawnLine = withHelper
    ? `const { pid } = spawnKernelProcess(t, process.execPath, ${JSON.stringify(driverArgv(root))}, { stdio: ["ignore", "ignore", "ignore"] });`
    : `const { spawn: bareSpawn } = await import("node:child_process"); const child = bareSpawn(process.execPath, ${JSON.stringify(driverArgv(root))}, { stdio: ["ignore", "ignore", "ignore"] }); const pid = child.pid; child.unref(); // the leaking test must still be able to FINISH, so the survivor is measured as a leak, not as a hang`;
  const body = `import { test } from "node:test";
import fs from "node:fs";
${withHelper ? `import { spawnKernelProcess } from ${JSON.stringify(HELPER_PATH)};` : ""}

const PIDFILE = ${JSON.stringify(pidFile)};
const MODE = ${JSON.stringify(mode)};

test("resident driver", { timeout: MODE === "timeout" ? 400 : 60000 }, async (t) => {
  ${spawnLine}
  fs.writeFileSync(PIDFILE, String(pid));
  // Settle, then publish the POSITIVE CONTROL: the driver really is resident at this point.
  await new Promise((r) => setTimeout(r, 300));
  let alive = false;
  try { process.kill(pid, 0); alive = true; } catch { alive = false; }
  fs.writeFileSync(PIDFILE + ".alive", String(alive));
  if (MODE === "fail") throw new Error("fixture: deliberate failure after spawning a resident driver");
  if (MODE === "timeout") await new Promise(() => {}); // never resolves — node:test times it out
  if (MODE === "cancel") await new Promise((r) => setTimeout(r, 60000)); // until the runner SIGINTs us
});
`;
  const file = path.join(dir, "resident.test.mjs");
  fs.writeFileSync(file, body, "utf8");
  return { dir, file, pidFile, root, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

/** Run the fixture to completion with a real `node --test`, returning { code, pid, alive }. */
async function runFixtureToCompletion(t, fixture) {
  const { child } = spawnKernelProcess(t, process.execPath, ["--test", fixture.file], {
    stdio: ["ignore", "pipe", "pipe"],
    env: fixtureEnv(),
  });
  child.stdout.on("data", () => {});
  child.stderr.on("data", () => {});
  const code = await new Promise((resolve) => child.once("close", (c) => resolve(c)));
  return readFixtureResult(fixture, code);
}

function readFixtureResult(fixture, code) {
  const pid = fs.existsSync(fixture.pidFile) ? Number(fs.readFileSync(fixture.pidFile, "utf8")) : null;
  const aliveFile = `${fixture.pidFile}.alive`;
  const wasAlive = fs.existsSync(aliveFile) && fs.readFileSync(aliveFile, "utf8").trim() === "true";
  return { code, pid, wasAlive };
}

/**
 * Settle for `pid` and the process group it leads (pgid === pid — the helper spawns `detached`, so
 * every descendant inherits that group). A signal's effect is asynchronous to the signalling process:
 * measured, a SIGKILLed driver is still readable as running for a few ms after the file child that
 * killed it has already exited, so the post-condition is read with a BOUNDED settle (≤5s) rather than
 * at one instant. Returns true iff both the pid and the group are gone within the bound.
 */
async function waitReaped(pid, { timeoutMs = 5000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (!pidAlive(pid) && !processGroupAlive(pid)) return true;
    if (Date.now() >= deadline) return false;
    await sleep(25);
  }
}

/**
 * The post-condition, asserted identically for every terminal path: the driver pid is gone AND the
 * whole process group it led is gone.
 */
async function assertReaped({ pid, wasAlive }, label) {
  assert.equal(wasAlive, true, `${label}: positive control — the driver was resident while the test ran`);
  assert.ok(pid, `${label}: the fixture recorded the driver pid`);
  assert.equal(await waitReaped(pid), true, `${label}: the driver pid AND its whole process group are gone after the test`);
}

// ── post-fix: the helper reaps the group on every terminal path ──────────────────────────────────────

test("AC1 post-fix — SUCCESS path: the resident driver's group is gone after the test", async (t) => {
  const fixture = writeFixture({ mode: "ok", withHelper: true });
  t.after(() => fixture.cleanup());
  const res = await runFixtureToCompletion(t, fixture);
  assert.equal(res.code, 0, "the fixture test passed (this is the success path)");
  await assertReaped(res, "success");
});

test("AC1 post-fix — FAILURE path: a failing test still reaps the resident driver's group", async (t) => {
  const fixture = writeFixture({ mode: "fail", withHelper: true });
  t.after(() => fixture.cleanup());
  const res = await runFixtureToCompletion(t, fixture);
  assert.notEqual(res.code, 0, "the fixture test failed (the failure path is real)");
  await assertReaped(res, "failure");
});

test("AC1 post-fix — TIMEOUT path: a timed-out test still reaps the resident driver's group", async (t) => {
  const fixture = writeFixture({ mode: "timeout", withHelper: true });
  t.after(() => fixture.cleanup());
  const res = await runFixtureToCompletion(t, fixture);
  assert.notEqual(res.code, 0, "the fixture test timed out (the timeout path is real)");
  await assertReaped(res, "timeout");
});

test("AC1 post-fix — CANCELLATION path: SIGINT to the run still reaps the resident driver's group", async (t) => {
  const fixture = writeFixture({ mode: "cancel", withHelper: true });
  t.after(() => fixture.cleanup());
  const { child } = spawnKernelProcess(t, process.execPath, ["--test", fixture.file], {
    stdio: ["ignore", "pipe", "pipe"],
    env: fixtureEnv(),
  });
  child.stdout.on("data", () => {});
  child.stderr.on("data", () => {});
  // Wait until the driver is up AND the in-test positive control has been published, then cancel.
  const up = await pollFor(() => fs.existsSync(`${fixture.pidFile}.alive`));
  assert.equal(up, true, "the fixture reached the point where its resident driver was up");
  child.kill("SIGINT");
  const code = await new Promise((resolve) => child.once("close", (c) => resolve(c)));
  const res = readFixtureResult(fixture, code);
  await assertReaped(res, "cancellation");
});

// ── pre-fix negative control: a bare spawn leaks (proves the helper is what reaps) ──────────────────

test("AC1 negative control — a BARE spawn (no helper) leaks: the driver SURVIVES the test", async (t) => {
  const fixture = writeFixture({ mode: "fail", withHelper: false });
  t.after(() => fixture.cleanup());
  const res = await runFixtureToCompletion(t, fixture);
  assert.notEqual(res.code, 0, "the fixture test failed");
  assert.equal(res.wasAlive, true, "positive control — the bare-spawned driver was resident");
  assert.ok(res.pid, "the fixture recorded the bare-spawned driver pid");
  // THE PRE-FIX READING: nothing reaps a bare spawn, so the driver outlives the test that made it —
  // the measured 18h-leak shape. (If this ever turns green, the negative control has gone vacuous.)
  assert.equal(pidAlive(res.pid), true, "pre-fix: the bare-spawned driver survives the test (the leak class)");
  // Clean up the negative control's own leak — the test owns it and must not leak either.
  t.after(() => {
    try { process.kill(res.pid, "SIGTERM"); } catch { /* already gone */ }
    try { process.kill(res.pid, "SIGKILL"); } catch { /* already gone */ }
  });
  await sleep(50);
});
