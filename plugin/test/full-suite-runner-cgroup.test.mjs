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
function spawnCmd(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(args[0], args.slice(1), { stdio: ["ignore", "pipe", "pipe"] });
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
  assert.deepEqual(argv, [
    "systemd-run",
    "--user",
    "--scope",
    "--quiet",
    "-p",
    "MemoryMax=16G",
    "bash",
    "-c",
    "bash scripts/test.sh",
  ]);
  assert.ok(!argv.includes("CPUQuota="), "default argv carries NO CPUQuota — the cgroup has no CPU limit");
  assert.ok(!argv.includes("TasksMax="), "default argv carries NO TasksMax — the cgroup has no task limit (人 2026-08-12 裁定③)");
  // a custom limit set flows through (explicit cpuQuota IS passed)
  const custom = buildSystemdRunArgv("true", { memoryMax: "64M", cpuQuota: "100%", tasksMax: "20" });
  assert.ok(custom.includes("-p") && custom.includes("MemoryMax=64M"));
  assert.ok(custom.includes("CPUQuota=100%") && custom.includes("TasksMax=20"));
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
      assert.equal(s.systemdRun.memoryMax, "16G");
      assert.equal(s.systemdRun.cpuQuota, "");
      assert.equal(s.systemdRun.tasksMax, "");
      // AC1 observable — the applied cgroup attributes (systemctl --user show) land in the state dir
      const evidence = path.join(root, ".quay", "suite-cgroup-evidence.txt");
      await poll(() => fs.existsSync(evidence), { timeoutMs: 10_000 });
      const txt = fs.readFileSync(evidence, "utf8");
      assert.match(txt, /scope_unit=run-[a-z0-9]+\.scope/, "the transient scope unit name is recorded (systemd names it run-<id>.scope — cgroup-derived)");
      assert.match(txt, /MemoryMax=17179869184/, "MemoryMax=16G applied (bytes)");
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

