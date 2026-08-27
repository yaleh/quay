// @test-group governance
// full-suite-runner.test.mjs — tasks/gap-full-suite-belongs-to-outer-background-above-3-min.
//
// The (a) suite block of the three blocks that together eliminate "batch": the full suite
// (5-8 min magnitude, measured 11-12 min) belongs to the OUTER as background async — NOT
// blocking inner tasks. The runner (plugin/scripts/full-suite-runner.ts) spawns the suite,
// writes `.quay/full-suite-state.json`, and marks RED the moment a failure is detected.
//
// Coverage map (task ACs):
//   AC1 — result writes `.quay/full-suite-state.json` with the exact shape
//         {state: running|green|red, runner: outer|inner, startedAt, finishedAt, durationMs,
//          laneCount}; while running, finishedAt/durationMs are null.
//   AC2 — RED is marked on FIRST failure detection, not after the full run (marker-file
//         proof: red appears before the suite's post-failure step completes).
//   AC3 — the inner loop doc (fast-mode-loop-tick.md) reads the outer suite-state, and
//         carries ZERO `scripts/test.sh` literal (no full-suite self-run — the DoD grep).
//   AC4 — the red-window ruling is explicit: RED => inner stops dispatch AND holds fan-in.
//   AC5 — the >=3min/<3min threshold rule + durationMs measurement hook are in both loop docs.
//   AC7 — the three batch-eliminating blocks (a/b/c) are cross-annotated in the closure-sync
//         task file and the loop docs reference the (c) closure-decomposition task id.
//   AC8 — this file uses node:test and declares // @test-group governance.
//
// Task: gap-full-suite-runner-red-pattern-matches-bare-x-vitest-false-red
//   AC1 — FAILURE_PATTERNS no longer matches the bare ✖ glyph; a vitest-style suite whose
//         PASSING test logs `✖ ...` console output stays GREEN (unit negative control +
//         e2e fake-suite proof). Structured vitest shapes (`❯ <file> (N tests | M failed)`,
//         `Test Files <N> failed`) DO flag.
//   AC2 — node:test/TAP true failures still flip red (`not ok` / `# fail` / `# cancelled`),
//         and a vitest structured failure line flips red EARLY (before the run completes).
//
// Run:
//   scripts/test.sh plugin/test/full-suite-runner.test.mjs

import { test, after } from "node:test";
import assert from "node:assert/strict";
import { spawn, execSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** Hermetic lock dirs created by runRunner (gap-suite-slot-ssot-i5-false-positive) — cleaned after the
 *  whole file so they never leak into /tmp NOR into a git-repo `root` (an untracked file in `root`
 *  would flip the treeDirty round-START annotation, breaking the CLEAN-tree test). */
const _runnerLockDirs = [];
after(() => {
  for (const d of _runnerLockDirs) { try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* best-effort */ } }
});

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
} from "../scripts/full-suite-runner.ts";
import { runOnce, classifyFailure, routeRed, shouldStopDispatch, shouldDispatchOnRed } from "../scripts/suite-state-trigger.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../..");
const RUNNER = path.join(REPO_ROOT, "plugin/scripts/full-suite-runner.ts");
const OUTER_TICK = path.join(REPO_ROOT, "plugin/loop/orchestrator-loop-tick.md");
const INNER_TICK = path.join(REPO_ROOT, "plugin/loop/fast-mode-loop-tick.md");

// Hermetic seam (QUAY_TEST_SKIP_PRE_SUITE_REAPER=1): this file's fake-suite runner runs must NOT
// trigger full-suite-runner.ts's pre-suite GLOBAL orphan-probe sweep. That sweep kills ANY
// claude-probe with a deleted cwd on the machine — including a CONCURRENT test's live orphan probe
// (2026-08-17, fan-in scoped gate: running full-suite-runner.test.mjs in parallel with
// worktree-process-reaper.test.mjs killed the reaper test's probe mid-assertion → found:0 flake).
// These hermetic tests measure no claude-process-count, so the sweep is pure cross-test hazard here;
// the production path (no env) is unchanged. Same pattern as QUAY_TEST_SKIP_RESOURCE_GATE.
process.env.QUAY_TEST_SKIP_PRE_SUITE_REAPER = "1";
const CLOSURE_TASK = path.join(
  REPO_ROOT,
  "tasks/gap-closure-sync-is-the-true-batch-boundary-move-bookkeeping-to-outer-async.md",
);
const CLOSURE_DECOMP_TASK_ID = "gap-closure-could-not-run-in-task-grant-self-touches-for-ac-and-invoke-evidence";

function read(file) {
  return fs.readFileSync(file, "utf8");
}

function statePath(root) {
  return path.join(root, ".quay", "full-suite-state.json");
}

function readState(root) {
  const p = statePath(root);
  return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, "utf8")) : null;
}

/** gap-streaming-red-cascade-amplifies-failures-array AC1/AC2 — the FULL failure payload of a red
 *  state: `failures[]` (main set) + `unattributed[]` (no-file real failures, segmented OUT of
 *  failures[]). A red verdict carries a non-empty payload in at least one of the two — the
 *  gap-suite-red-verdict-carries-empty-failures-payload invariant holds over the SUM. */
function redPayload(s) {
  return (s && (s.failures || [])).concat(s && s.unattributed ? s.unattributed : []);
}

/** Read the LAST verification-round.jsonl record (null when the ledger is absent/empty). */
function lastRoundRecord(root) {
  const f = path.join(root, ".quay", "verification-round.jsonl");
  if (!fs.existsSync(f)) return null;
  const lines = fs.readFileSync(f, "utf8").trim().split("\n").filter(Boolean);
  return lines.length ? JSON.parse(lines[lines.length - 1]) : null;
}

/** Write a fake "test suite" bash script; returns { dir, f }. */
function fakeSuite(scriptBody) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fsr-fake-"));
  const f = path.join(dir, "fake-suite.sh");
  fs.writeFileSync(f, "#!/usr/bin/env bash\n" + scriptBody + "\n", { mode: 0o755 });
  return { dir, f };
}

/** Spawn the runner against a temp root with a fake command. */
function runRunner({ root, command, laneCount, stateDir, runner, env = {}, serialConcurrency, lowconcConcurrency }) {
  const args = ["--no-warnings", "--experimental-strip-types", RUNNER, "--root", root];
  if (stateDir) args.push("--state-dir", stateDir);
  if (command) args.push("--command", command);
  if (laneCount !== undefined && laneCount !== null) args.push("--lane-count", String(laneCount));
  if (runner !== undefined && runner !== null) args.push("--runner", String(runner));
  if (serialConcurrency !== undefined) args.push("--serial-concurrency", String(serialConcurrency));
  if (lowconcConcurrency !== undefined) args.push("--lowconc-concurrency", String(lowconcConcurrency));
  const mergedEnv = { ...process.env, ...env };
  // AC3 seam — hermetic tests skip the REAL resource gate by default; the AC3 tests override it
  // (QUAY_TEST_SKIP_RESOURCE_GATE != "1") and force GO/WAIT via the gate's RESOURCE_GATE_TEST_* seams.
  if (!("QUAY_TEST_SKIP_RESOURCE_GATE" in mergedEnv)) mergedEnv.QUAY_TEST_SKIP_RESOURCE_GATE = "1";
  // gap-systemd-run-limits-for-suite-and-heavy-ops seam — hermetic tests skip the REAL systemd-run
  // cgroup-scope wrapper by default (a temp-root fake suite needs no user systemd session); the
  // AC1-AC6 tests below opt in via QUAY_TEST_SYSTEMD_RUN_AVAILABLE=1 / QUAY_TEST_SKIP_SYSTEMD_RUN=0.
  if (!("QUAY_TEST_SKIP_SYSTEMD_RUN" in mergedEnv)) mergedEnv.QUAY_TEST_SKIP_SYSTEMD_RUN = "1";
  // HERMETICITY: the parent suite launch sets QUAY_TEST_SYSTEMD_RUN_LIMITS (e.g. CPUQuota=400% per
  // the human ruling). Without clearing it, that override leaks into every child runner via
  // `...process.env`, so the AC1 "default limits" test would observe 400% instead of the default
  // 200% the runner uses when the override is absent. Unless a test explicitly provides its own
  // limits, drop the inherited override so the child uses the runner's DEFAULT_SYSTEMD_RUN_LIMITS.
  if (!("QUAY_TEST_SYSTEMD_RUN_LIMITS" in env)) delete mergedEnv.QUAY_TEST_SYSTEMD_RUN_LIMITS;
  // gap-verification-round-observability-holes AC3 — hermetic tests pin the independent
  // concurrentSuitesRunning read to a lone round (QUAY_TEST_RUNNER_PROCS=1) by default. Two reasons:
  // (a) the unseamed pgrep path would count the PRODUCTION full-suite-runner.ts that launches this
  // test file (and any other concurrent runner), making a round-record assertion non-deterministic;
  // (b) the pgrep is a SYNCHRONOUS subprocess at round start — under full-suite load it can delay the
  // suite spawn past a QUAY_TEST_CRASH_AFTER_RUNNING=500ms timer and break the crash test's
  // "phase records already accumulated" timing. Tests that assert a specific count override the seam
  // (the AC1/AC2/AC3 concurrent-suite tests); the unseamed production path is exercised separately by
  // the dedicated "production read counts a real marker process" unit test.
  if (!("QUAY_TEST_RUNNER_PROCS" in mergedEnv)) mergedEnv.QUAY_TEST_RUNNER_PROCS = "1";
  // HERMETIC lock base (gap-suite-slot-ssot-i5-false-positive): the runner's suiteLockSlotCount() /
  // suiteLockPaths() resolve from process.cwd() (this test file's worktree, since runRunner does not
  // set a child cwd) and would read the PRODUCTION <suiteLockBase>.concurrency scalar (a live-suite
  // S=1 file), which SHADOWS the env knob a test drives ⇒ round records read S=1 instead of the
  // configured S. Pin the runner's lock base to a temp dir OUTSIDE `root` (an untracked file inside a
  // git-repo `root` would flip the round-START treeDirty annotation, breaking the CLEAN-tree test)
  // carrying the configured slot count (default 1) in its `.concurrency` file — every runRunner-based
  // test is then hermetic against production lock state (the runner probes/locks the pinned base,
  // never the real git-common-dir).
  // ⚠️ Guard on the per-call `env` (NOT mergedEnv): the REAL suite launch (scripts/test.sh:1181) sets
  // FULL_SUITE_LOCK_FILE in the parent env, so `in mergedEnv` is TRUE there and the pinning would be
  // SKIPPED — the child then reads the PRODUCTION `.concurrency` file (a live-suite S=1 scalar) which
  // shadows the test-driven knob (gap-suite-slot-ssot-i5-false-positive full-suite RED: 6 assertions
  // read S=1). Only a test EXPLICITLY passing its own FULL_SUITE_LOCK_FILE via the per-call `env`
  // opts out of the hermetic pin; ambient suite-launch env never does.
  if (!("FULL_SUITE_LOCK_FILE" in env)) {
    const lockDir = fs.mkdtempSync(path.join(os.tmpdir(), "fsr-lock-"));
    _runnerLockDirs.push(lockDir);
    const lockBase = path.join(lockDir, "full-suite.lock");
    fs.writeFileSync(`${lockBase}.concurrency`, mergedEnv.QUAY_MAX_CONCURRENT_SUITES ?? "1", "utf8");
    mergedEnv.FULL_SUITE_LOCK_FILE = lockBase;
  }
  const child = spawn(process.execPath, args, { stdio: ["ignore", "pipe", "pipe"], env: mergedEnv });
  // Drain pipes so a chatty fake suite cannot block the child.
  child.stdout.on("data", () => {});
  child.stderr.on("data", () => {});
  return child;
}

/**
 * A fake `<root>/scripts/test.sh` that records its args to `argsLog` and prints a green TAP summary.
 * Used to observe the runner's spliced --test-concurrency (the real test.sh's static checks / dist
 * build are irrelevant to the runner's splice).
 */
function fakeTestShRecordingArgs(root) {
  const argsLog = path.join(root, "args.txt");
  fs.mkdirSync(path.join(root, "scripts"), { recursive: true });
  fs.writeFileSync(
    path.join(root, "scripts", "test.sh"),
    `#!/usr/bin/env bash\necho "$*" > '${argsLog}'\necho "# tests 1"\necho "# pass 1"\necho "# fail 0"\necho "# cancelled 0"\nexit 0\n`,
    { mode: 0o755 },
  );
  return { argsLog };
}

/**
 * Resolve with `{ code, signal }` when `child` exits. Defensive against two hang modes:
 *
 * 1. LATE LISTENER (the load race, gap-full-suite-runner-test-waitExit-load-race): if the child
 *    exits BEFORE this listener is mounted (e.g. it finished during an earlier `await` gap — under
 *    load 15-25 the child can exit between spawn and the `waitExit` call), Node child_process does
 *    NOT replay the 'exit' event to a listener attached after the fact — the promise would hang
 *    forever. Guard: `child.exitCode`/`child.signalCode` are populated at exit regardless of
 *    listeners (verified empirically), so if either is already set we resolve immediately from the
 *    cached values instead of waiting for an event that will never fire.
 *
 * 2. CHILD NEVER EXITS: a `timeoutMs` fallback rejects with a diagnostic (pid / exit code / signal
 *    / killed) so a genuinely-stuck child fails the test (fail-fast) instead of hanging the suite.
 *
 * The default parameter covers all 114 existing `await waitExit(child)` call sites unchanged.
 */
function waitExit(child, { timeoutMs = 60_000 } = {}) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (v) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(v);
    };
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      const state = {
        pid: child.pid,
        exitCode: child.exitCode,
        signalCode: child.signalCode,
        killed: child.killed,
      };
      console.error(`[waitExit] TIMEOUT after ${timeoutMs}ms — child never exited. state=${JSON.stringify(state)}`);
      reject(new Error(`waitExit: child ${child.pid} did not exit within ${timeoutMs}ms (exitCode=${child.exitCode}, signal=${child.signalCode})`));
    }, timeoutMs);
    // Mount the listener FIRST, then check the cached exit properties — no gap between the two.
    child.once("exit", (code, signal) => finish({ code, signal }));
    if (child.exitCode !== null || child.signalCode !== null) {
      finish({ code: child.exitCode, signal: child.signalCode });
    }
  });
}

test("negative control — waitExit resolves bounded when the child ALREADY exited before the listener is mounted (exit event is NOT replayed)", async () => {
  // The load race (gap-full-suite-runner-test-waitExit-load-race): under load 15-25 a spawned child
  // can exit during an `await` gap BEFORE waitExit mounts its 'exit' listener. Node child_process
  // does not replay the 'exit' event to a late listener ⇒ the promise would hang forever. This
  // negative control reproduces exactly that ordering: the child exits AND its exit event fires
  // (exitCode is populated) before waitExit is called; waitExit must return bounded, not hang.
  const child = spawn(process.execPath, ["-e", "process.exit(0)"], { stdio: "ignore" });
  await poll(() => child.exitCode !== null || child.signalCode !== null, { timeoutMs: 5000 });
  const start = Date.now();
  const { code, signal } = await waitExit(child);
  const elapsed = Date.now() - start;
  assert.equal(code, 0, "resolves with the cached exit code even though the event already fired");
  assert.equal(signal, null);
  assert.ok(elapsed < 5000, `bounded return, not a hang (took ${elapsed}ms)`);
});

function poll(fn, { timeoutMs = 5000, intervalMs = 30 } = {}) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const tick = () => {
      try {
        const v = fn();
        if (v) return resolve(v);
      } catch {
        // file may be mid-write; retry
      }
      if (Date.now() - start > timeoutMs) {
        return reject(new Error(`poll timeout after ${timeoutMs}ms`));
      }
      setTimeout(tick, intervalMs);
    };
    tick();
  });
}

const GREEN_SUITE = 'echo "# tests 5"\necho "# pass 5"\necho "# fail 0"\necho "# cancelled 0"\nexit 0';

test("AC1 — a green run writes the exact suite-state shape to .quay/full-suite-state.json", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fsr-root-"));
  const { f, dir } = fakeSuite(GREEN_SUITE);
  try {
    const child = runRunner({ root, command: `bash ${f}`, laneCount: 8 });
    const { code } = await waitExit(child);
    assert.equal(code, 0, `runner exits 0 on green, got ${code}`);

    const s = readState(root);
    assert.ok(s, "state file written");
    assert.deepEqual(
      Object.keys(s).sort(),
      [
        "durationMs",
        "finishedAt",
        "laneCount",
        "pid",
        "runId",
        "runner",
        "scope",
        "startedAt",
        "state",
      ],
      "exact suite-state shape (AC1 + gap-worktree-scoped-runs-consume-resources-but-produce-no-signal AC1 scope + gap-full-suite-state-race-last-write-wins-no-generation-guard runId + gap-full-suite-state-red-no-failure-detail-static-check-invisible AC6 pid)",
    );
    assert.equal(s.state, "green");
    assert.equal(s.runner, "outer");
    assert.equal(s.laneCount, 8);
    assert.ok(s.runId && typeof s.runId === "string", "every state write carries a runId generation token");
    assert.ok(!Number.isNaN(Date.parse(s.startedAt)), "startedAt is ISO");
    // gap-batch-merge-gate-reads-stale-green: finishedAt is EPOCH SECONDS (the batch-merge freshness
    // gate's Contract measure `int(time.time() - finishedAt)` needs epoch, not ISO).
    assert.equal(typeof s.finishedAt, "number", "finishedAt is epoch seconds (suite_freshness measure)");
    assert.ok(s.finishedAt > 0, "finishedAt epoch seconds is positive");
    assert.equal(typeof s.durationMs, "number", "durationMs is the AC5 measurement hook");
    assert.ok(s.durationMs >= 0);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("AC1 — an explicit --runner inner is recorded in BOTH the state and the verification-round (gap-runner-field-hardcoded-outer-not-measurement)", async () => {
  // The pre-fix code had NO --runner flag ⇒ `runner` was structurally pinned to "outer" (硬规则 4:
  // a field that can only ever take one value is not a measurement). Now an explicit --runner is
  // honored everywhere `base.runner` flows (state write + verification-round write share the value).
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fsr-runner-"));
  const { f, dir } = fakeSuite(GREEN_SUITE);
  try {
    const child = runRunner({ root, command: `bash ${f}`, laneCount: 8, runner: "inner" });
    const { code } = await waitExit(child);
    assert.equal(code, 0, `runner exits 0 on green, got ${code}`);

    const s = readState(root);
    assert.ok(s, "state file written");
    assert.equal(s.runner, "inner", "the state write records the explicit --runner inner");
    // The verification-round row carries the SAME runner (both reads of base.runner).
    const vr = lastRoundRecord(root);
    assert.ok(vr, "a verification-round row was appended");
    assert.equal(vr.runner, "inner", "the verification-round row records the same runner");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("AC1 — an invalid --runner value fails closed (nothing written), not a silent fallback (gap-runner-field-hardcoded-outer-not-measurement)", async () => {
  // 硬规则 3b: an unreadable/unparseable input must NOT return a value identical to a valid one —
  // a garbage --runner must exit non-zero before any state write, never silently record "outer".
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fsr-runner-bad-"));
  const { f, dir } = fakeSuite(GREEN_SUITE);
  try {
    const child = runRunner({ root, command: `bash ${f}`, runner: "not-a-layer" });
    const { code } = await waitExit(child);
    assert.equal(code, 1, "invalid --runner exits 1 (usage error)");
    assert.equal(readState(root), null, "no state file is written on a --runner usage error");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

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
    'echo "selected 30 files (groups=product,engine,governance,serial,lowconc)"',
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
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

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
  // The fake suite: after a short delay (the suite is "running"), a CONCURRENT WRITER commits to the
  // shared tree (round-53 class) — then the suite itself PASSES. The tree was MUTATED under the run,
  // so the would-be green is a FALSE CERTIFICATE: gap-verifiedcommit-dirty-tree-false-certificate
  // AC5 demotes it to state=red reason=infra-error void:true (the tests passed; the certificate is
  // void — SUITE-GREEN / SUITE-MERGE-PENDING must not fire for a tree that was never pinned).
  const { f, dir } = fakeSuite(
    'sleep 1\n' +
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
    'sleep 1\n' +
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
  // The fake suite: after a short delay (the suite is "running"), it REWRITES an assertion-surface
  // file mid-round — the round-84 SAVE-time pollution shape (uncommitted, in the tested tree) — then passes.
  const { f, dir } = fakeSuite(
    'sleep 1\n' +
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
    'sleep 1\n' +
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

// ── gap-full-suite-runner-concurrency-default-and-gate: AC1/AC2/AC3/AC4 ─────────────────────────────

test("AC1 — default laneCount is NPROC-derived (max(1, floor(nproc × oversub / S)); nproc=4, oversub=1 → 4/2/1 by slot count); spawned command carries ONE --test-concurrency", async () => {
  // gap-suite-budget-oversubscribe (human 14:4xZ 修正方向) — the MAIN lane budget is
  // max(1, floor(nproc × oversub / S)): PURE computation over host nproc + 旋钮③ oversub + 旋钮② S.
  // defaultLaneCount() reads QUAY_MAX_CONCURRENT_SUITES (via concurrentSuiteSlots) and
  // QUAY_MAX_OVERSUBSCRIPTION. RESOURCE_GATE_NPROC is the deterministic host seam (env on the
  // spawned runner); QUAY_MAX_CONCURRENT_SUITES is pinned to prove the divisor is live: 4 cores →
  // lane 4 at 1 slot, 2 at 2 slots, 1 at 3 slots.
  for (const [slots, expected] of [["1", 4], ["2", 2], ["3", 1]]) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "fsr-ac1-"));
    const { argsLog } = fakeTestShRecordingArgs(root);
    try {
      // NO --lane-count, NO --command → default path; RESOURCE_GATE_NPROC=4 forces the derivation.
      // oversub not set → QUAY_MAX_OVERSUBSCRIPTION default 1.
      const child = runRunner({ root, env: { RESOURCE_GATE_NPROC: "4", QUAY_MAX_CONCURRENT_SUITES: slots } });
      const { code } = await waitExit(child);
      assert.equal(code, 0, `runner exits 0 on green (slots=${slots}), got ${code}`);
      const s = readState(root);
      assert.equal(s.laneCount, expected, `derived default laneCount = max(1, floor(4×1/${slots})) = ${expected} (slots=${slots}), got ${s.laneCount}`);
      await poll(() => fs.existsSync(argsLog));
      const args = fs.readFileSync(argsLog, "utf8").trim();
      assert.equal(args, `--test-concurrency=${expected}`, `exactly ONE --test-concurrency=<derived> spliced (slots=${slots}), got: ${args}`);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
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

test("AC2 — the splice is REPLACE: an existing --test-concurrency=8 (= and space spellings) is stripped and replaced by the derived value", async () => {
  for (const existing of ["--test-concurrency=8", "--test-concurrency 8"]) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "fsr-ac2-"));
    const { argsLog } = fakeTestShRecordingArgs(root);
    try {
      // slots=1 pins the derived default to nproc (4) so the REPLACE assertion targets the splice
      // (single flag), not the ÷ slots derivation (covered by the AC1 test above).
      const child = runRunner({
        root,
        command: `bash scripts/test.sh ${existing}`,
        env: { RESOURCE_GATE_NPROC: "4", QUAY_MAX_CONCURRENT_SUITES: "1" },
      });
      const { code } = await waitExit(child);
      assert.equal(code, 0, `runner exits 0 on green (existing '${existing}'), got ${code}`);
      await poll(() => fs.existsSync(argsLog));
      const args = fs.readFileSync(argsLog, "utf8").trim();
      assert.equal(
        args,
        "--test-concurrency=4",
        `existing '${existing}' must be REPLACED by the derived value (single flag), got: ${args}`,
      );
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  }
});

test("AC3 — resource gate WAIT ⇒ the runner does NOT start and leaves the state file untouched", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fsr-ac3-"));
  const { argsLog } = fakeTestShRecordingArgs(root);
  // A prior GREEN suite verdict that MUST survive a WAIT byte-untouched (AC3: state stays running/green).
  const prior = {
    state: "green",
    runner: "outer",
    startedAt: "2026-08-05T06:00:00.000Z",
    finishedAt: "2026-08-05T06:05:00.000Z",
    durationMs: 300000,
    laneCount: 1,
  };
  fs.mkdirSync(path.join(root, ".quay"), { recursive: true });
  fs.writeFileSync(statePath(root), JSON.stringify(prior, null, 2) + "\n", "utf8");
  try {
    const child = runRunner({
      root,
      env: {
        QUAY_TEST_SKIP_RESOURCE_GATE: "0", // force the REAL gate path, with seams
        RESOURCE_GATE_TEST_CPU_AVG10: "84.77", // WAIT (cpu stalled)
        RESOURCE_GATE_TEST_MEM_AVAIL_MB: "4000",
        // Determinism for the OVERLOAD-WINDOW load seam (same convention as resource-gate.test.mjs
        // runGate): the real /proc/loadavg on a busy host under the full suite's own 4-lane load
        // would nondeterministically flip the new load_wait verdict and make this WAIT test
        // attributable to load instead of CPU. Pin the load LOW so the WAIT verdict is exactly the
        // CPU stall the test title names. gap-r274-flake-ac3-go-load-seam-unpinned.
        RESOURCE_GATE_TEST_LOAD_OVERRIDE: "1",
      },
    });
    const { code } = await waitExit(child);
    assert.notEqual(code, 0, "WAIT ⇒ the runner exits non-zero (did not run)");
    const s = readState(root);
    assert.equal(s.state, "green", "state stays green (untouched) on WAIT");
    assert.equal(s.durationMs, 300000, "the prior state object is byte-untouched");
    assert.ok(!fs.existsSync(argsLog), "the suite was NEVER spawned on WAIT");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("AC3 — resource gate GO ⇒ the runner starts (state=running then green)", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fsr-ac3go-"));
  const { argsLog } = fakeTestShRecordingArgs(root);
  try {
    const child = runRunner({
      root,
      env: {
        QUAY_TEST_SKIP_RESOURCE_GATE: "0",
        RESOURCE_GATE_TEST_CPU_AVG10: "10", // GO (cpu calm)
        RESOURCE_GATE_TEST_MEM_AVAIL_MB: "4000",
        // Determinism for the OVERLOAD-WINDOW load seam (same convention as resource-gate.test.mjs
        // runGate): the real /proc/loadavg on a busy host under the full suite's own 4-lane load
        // would nondeterministically flip the new load_wait verdict and make this GO test WAIT
        // (round r274 flake: the suite's own load pushed loadavg >= nproc×2, the gate returned WAIT,
        // the runner exited 1, assert.equal(code, 0) failed). Pin the load LOW so GO is a real GO.
        RESOURCE_GATE_TEST_LOAD_OVERRIDE: "1",
      },
    });
    const { code } = await waitExit(child);
    assert.equal(code, 0, "GO ⇒ the runner runs and exits 0 on green");
    assert.equal(readState(root).state, "green");
    assert.ok(fs.existsSync(argsLog), "the suite WAS spawned on GO");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("AC1 — runner REFUSES to start when another runner is in flight (state=running + live pid) — round 131/132 storm fix", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fsr-inflight-"));
  // A live pid: this test process itself (process.kill(pid,0) succeeds for our own pid).
  const statePathFile = path.join(root, ".quay", "full-suite-state.json");
  fs.mkdirSync(path.dirname(statePathFile), { recursive: true });
  fs.writeFileSync(statePathFile, JSON.stringify({ state: "running", pid: process.pid, finishedAt: null, runId: "existing-run" }, null, 2));
  try {
    const res = await runCli(RUNNER, ["--root", root, "--state-dir", path.join(root, ".quay")]);
    assert.notEqual(res.code, 0, "runner must refuse to start when a live runner is in flight");
    assert.match(res.err, /another runner is already in flight/, `refusal message must name the in-flight runner:\n${res.err}`);
    assert.ok(!fs.existsSync(path.join(root, ".quay", "fake-test.log")), "must NOT spawn the suite");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("AC1 — runner STARTS when state is terminal (green) even with a pid — no in-flight false positive", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fsr-inflight-terminal-"));
  const { argsLog } = fakeTestShRecordingArgs(root);
  const statePathFile = path.join(root, ".quay", "full-suite-state.json");
  fs.mkdirSync(path.dirname(statePathFile), { recursive: true });
  // terminal green: finishedAt set. The pid is stale/dead — but finishedAt != null means the round
  // is OVER regardless of pid, so isRunnerInFlight returns false.
  fs.writeFileSync(statePathFile, JSON.stringify({ state: "green", pid: 999999999, finishedAt: Date.now(), runId: "old-run" }, null, 2));
  try {
    const child = runRunner({ root });
    const { code } = await waitExit(child);
    assert.equal(code, 0, "terminal state ⇒ the runner starts normally");
    assert.ok(fs.existsSync(argsLog), "the suite WAS spawned on a terminal state");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("AC2 — lightweight controls (--fail-fast-check) skip the in-flight check", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fsr-inflight-skip-"));
  const statePathFile = path.join(root, ".quay", "full-suite-state.json");
  fs.mkdirSync(path.dirname(statePathFile), { recursive: true });
  fs.writeFileSync(statePathFile, JSON.stringify({ state: "running", pid: process.pid, finishedAt: null, runId: "existing-run" }, null, 2));
  try {
    const { code } = await runCli(RUNNER, ["--fail-fast-check", "--root", root, "--state-dir", path.join(root, ".quay")]);
    // --fail-fast-check runs its own hermetic sub-suite and exits 0 when the chain works — it must
    // NOT be blocked by the in-flight check.
    assert.equal(code, 0, "--fail-fast-check must skip the in-flight check");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("AC4 — negative control: explicit --lane-count 8 + command already has =8 ⇒ exactly ONE =8 (replace, not two)", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fsr-ac4-"));
  const { argsLog } = fakeTestShRecordingArgs(root);
  try {
    const child = runRunner({ root, command: "bash scripts/test.sh --test-concurrency=8", laneCount: 8 });
    const { code } = await waitExit(child);
    assert.equal(code, 0, `runner exits 0 on green, got ${code}`);
    await poll(() => fs.existsSync(argsLog));
    const args = fs.readFileSync(argsLog, "utf8").trim();
    assert.equal(
      args,
      "--test-concurrency=8",
      `existing =8 stripped + explicit 8 spliced ⇒ ONE =8 total (ABORT #5 was two 8s), got: ${args}`,
    );
    assert.equal(readState(root).laneCount, 8, "explicit --lane-count 8 wins and is recorded");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("AC5 — a signal-killed run writes state=red reason=aborted, which must NOT trigger stop-dispatch", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fsr-ac5-"));
  // Flake fix (fan-in reland 2026-08-05): the external `child.kill("SIGTERM")` was delivered to the
  // runner only intermittently in the node --test harness (state stayed "running" after exit ~30-70%
  // of runs). Instead, the fake suite SIGNALS THE RUNNER ITSELF — after sleep 1, it walks its own
  // ancestor chain up to the nearest node process (the runner, which spawned the suite AFTER
  // registering its SIGTERM handler, so the handler is guaranteed registered) and SIGTERMs it.
  // Deterministic: the signal comes from inside the runner's own process tree, no external delivery.
  const { f, dir } = fakeSuite(
    'sleep 1\n' +
    'runner_pid=$PPID\n' +
    'while [ -n "$runner_pid" ] && [ "$runner_pid" != "1" ]; do\n' +
    '  # detect the node runner via /proc/<pid>/exe, not `ps -o comm` — node\n' +
    '  # processes report comm=`MainThread` on this machine, so a `node*` match\n' +
    '  # silently misses the runner and the self-signal is never delivered.\n' +
    '  exe=$(readlink "/proc/$runner_pid/exe" 2>/dev/null || true)\n' +
    '  case "$exe" in */node|*/nodejs) kill -TERM "$runner_pid"; break ;; esac\n' +
    '  runner_pid=$(ps -o ppid= -p "$runner_pid" 2>/dev/null | tr -d " ")\n' +
    'done\n' +
    'sleep 5\n' +
    'echo "# fail 0"\nexit 0',
  );
  try {
    const child = runRunner({ root, command: `bash ${f}` });
    // gap-suite-load-sampler-orphan-process load-hardening: the 10s "running" poll flaked RED under
    // 16-way contention (runner node bootstrap > 10s ⇒ `poll timeout after 10000ms`), the same
    // bootstrap-race shape the AC1/AC2 early-red fixes below widen. Widen both polls so
    // in-flight/aborted are judged on the state file (wall-clock), not on a runner-bootstrap race.
    await poll(() => {
      const s = readState(root);
      return s && s.state === "running" ? s : null;
    }, { timeoutMs: 20000 });
    // The fake suite signals the runner at ~t+1s; the runner exits when the handler runs.
    await waitExit(child);
    // The runner's signal handler writes red+aborted (no correctness conclusion).
    const s = await poll(() => {
      const cur = readState(root);
      return cur && cur.state === "red" && cur.reason === "aborted" ? cur : null;
    }, { timeoutMs: 20000 });
    assert.equal(s.reason, "aborted", "a kill produces reason=aborted, not failed");
    // And the stop-dispatch consumer (runOnce) reports NO stop signal for aborted-red (AC5).
    const res = runOnce(root);
    assert.equal(res.stopSignal, false, "aborted-red must NOT trigger stop-dispatch");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("AC6 — this task cross-annotates the shared stop-dispatch family (gap-red-window-dispatch-stop-should-be-shared-gate-conditional)", () => {
  const task = read(path.join(REPO_ROOT, "tasks/gap-full-suite-runner-concurrency-default-and-gate.md"));
  assert.match(
    task,
    /gap-red-window-dispatch-stop-should-be-shared-gate-conditional/,
    "this task must cross-annotate the shared-gate stop-dispatch task (AC6)",
  );
  const shared = read(path.join(REPO_ROOT, "tasks/gap-red-window-dispatch-stop-should-be-shared-gate-conditional.md"));
  assert.match(
    shared,
    /gap-full-suite-runner-concurrency-default-and-gate/,
    "the shared-gate task must cross-annotate THIS task (AC6)",
  );
});

test("AC1 — while the suite runs, state=running (or early-red) with finishedAt/durationMs null", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fsr-root-"));
  // gap-suite-load-sampler-orphan-process load-hardening: the 5s poll / 2s running window flaked
  // RED under 16-way contention (runner node bootstrap > 5s ⇒ `poll timeout after 5000ms`). Widen
  // the running window + poll timeout so "in-flight" is judged on the state file (wall-clock), not
  // on a runner-bootstrap race. Same shape as the AC2 early-red fixes below.
  const { f, dir } = fakeSuite('echo "started"\nsleep 10\necho "# fail 0"\nexit 0');
  try {
    const child = runRunner({ root, command: `bash ${f}` });
    // gap-streaming-red-cascade-amplifies-failures-array AC1 — the assertion is "the round is IN
    // FLIGHT" (state ∈ {running, red}, finishedAt null), NOT "the round is still green" (state ===
    // running). When the runner EARLY-REDS (AC2 — a load-sensitive failure flips the shared state red
    // mid-run), a `state === "running"`-only assertion reads red and fails — the round-130 cascade
    // that amplified failures[] 3×. Both running and red are non-terminal in-flight states with
    // finishedAt null; the round's actual verdict is pinned by the terminal write below.
    const inFlight = await poll(() => {
      const s = readState(root);
      return s && (s.state === "running" || s.state === "red") ? s : null;
    }, { timeoutMs: 20000 });
    assert.equal(inFlight.runner, "outer");
    assert.equal(inFlight.finishedAt, null, "finishedAt null while the round is in flight");
    assert.equal(inFlight.durationMs, null, "durationMs null while the round is in flight");
    const { code } = await waitExit(child);
    assert.equal(code, 0);
    assert.equal(readState(root).state, "green");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("AC2 — RED is marked on first failure detection, before the run completes (marker-file proof)", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fsr-root-"));
  const marker = path.join(root, "post-failure-marker");
  const { f, dir } = fakeSuite(`echo "not ok 1 - boom"\nsleep 10\necho done > "${marker}"\nexit 1`);
  try {
    const child = runRunner({ root, command: `bash ${f}` });
    // The failure line is printed immediately; the suite's post-failure step (writing the
    // marker) happens only after `sleep 10`. If state=red is observed BEFORE the marker
    // exists, red was written on detection, not after the run completed (AC2).
    // gap-suite-load-sampler-orphan-process load-hardening: the 5s poll / 2s marker window
    // flaked RED under 16-way contention (runner node bootstrap > 5s ⇒ `poll timeout after
    // 5000ms`). Widen the marker window + poll timeout so "early-red" is judged on the
    // marker (wall-clock), not on a runner-bootstrap race.
    const redObserved = await poll(() => {
      const s = readState(root);
      return s && s.state === "red" ? s : null;
    }, { timeoutMs: 20000 });
    assert.equal(redObserved.finishedAt, null, "red written while the run is still in progress");
    assert.equal(redObserved.state, "red");
    assert.ok(!fs.existsSync(marker), "red appeared before the suite's post-failure step completed");

    const { code } = await waitExit(child);
    assert.equal(code, 1, "runner exits 1 on red");
    assert.ok(fs.existsSync(marker), "suite finished its post-failure step after red was marked");

    const final = readState(root);
    assert.equal(final.state, "red");
    assert.ok(final.finishedAt, "final red has finishedAt");
    assert.equal(typeof final.durationMs, "number", "durationMs recorded even on red");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("AC2 unit — the failure markers match STRUCTURED failure lines, never bare glyphs or passing lines", () => {
  for (const line of [
    "not ok 1 - something failed",
    "# fail 2",
    "# cancelled 1",
    "FULL-SUITE-EXIT=1",
    // vitest structured failures (gap-full-suite-runner-red-pattern-matches-bare-x-vitest-false-red AC1)
    " ❯ test/foo.test.ts (3 tests | 1 failed) 12ms",
    " ❯ test/foo.test.ts (3 tests | 1 failed | 2 skipped) 12ms",
    "Test Files  1 failed | 10 passed (11)",
  ]) {
    assert.equal(isFailureLine(line), true, `should flag: ${line}`);
  }
  for (const line of [
    "# tests 2239",
    "# pass 2239",
    "# fail 0",
    "# cancelled 0",
    "FULL-SUITE-EXIT=0",
    "ok 1 - passing test",
    // bare ✖ console noise must NOT flag (AC1 negative control: a passing vitest negative-control
    // test logs `✖ Diagram test failed` — the old /✖/ pattern produced a FALSE early-red)
    "✖ Diagram test failed",
    // vitest passing lines must NOT flag (structured shapes only, not bare glyphs)
    " ✓ test/foo.test.ts (3 tests) 12ms",
    " ❯ test/foo.test.ts (3 tests) 12ms",
    "Test Files  10 passed (11)",
    "   × some individual test name",
  ]) {
    assert.equal(isFailureLine(line), false, `should not flag: ${line}`);
  }
});

// ── gap-runner-failure-patterns-miss-info-glyph-and-perfile-failed: AC2 (reporter glyph forms) ──────
// The round-149 real failure emitted `ℹ fail 1` (info-glyph summary), `✖ <testname> (Nms)`
// (spec-reporter per-test failure) and `__PERFILE__ ... passed=false` (measure-suite-reporter
// per-file failure) — NONE of which the old FAILURE_PATTERNS recognized (it only knew `not ok` /
// `# fail` / `# cancelled` / vitest `❯`), so redDetected stayed false and the red carried
// failures=[] / redAt=null. These pin the fix (AC2): the reporter forms flag; the passing forms
// and the bare-✖ negative control (TASK-67) still do NOT.

test("AC2 unit — FAILURE_PATTERNS recognize the reporter info-glyph + per-file + leak-scan failure forms", () => {
  for (const line of [
    "ℹ fail 1", // measure-suite-reporter / spec-reporter info-glyph summary
    "ℹ cancelled 1", // info-glyph cancelled summary
    "✖ AC1/AC2 — the real bundle inventory matches the outline §6 snapshot (--inventory exits 0) (3.411515ms)", // spec-reporter per-test failure
    "✖ some test name (12ms)", // short spec-reporter failure line
    "✖ failing tests:", // spec-reporter failure-block header (only emitted when tests failed)
    "__PERFILE__ duration_ms=3580.991183 /home/yale/work/quay/packages/quay/test/verify-delivery-surface.test.mjs passed=false", // per-file failure
    "__PERFILE__ duration_ms=100 packages/quay/test/foo.test.mjs passed=false", // per-file failure, relative path
    "tmux-leak-scan: FAIL — NEW residual test tmux servers/dirs after the run (delta vs the before-run snapshot)", // candidate C leak-scan residual
  ]) {
    assert.equal(isFailureLine(line), true, `should flag: ${line}`);
  }
  // negative controls — a PASSING run never emits these, and the bare-✖ console-noise guard holds:
  for (const line of [
    "✖ Diagram test failed", // TASK-67 negative control: passing vitest test logging a bare ✖ line
    "ℹ pass 5",
    "ℹ fail 0",
    "ℹ cancelled 0",
    "__PERFILE__ duration_ms=100 /home/yale/work/quay/packages/quay/test/foo.test.mjs passed=true", // passed=true is NOT a failure
    // gap-runner-perfile-pattern-unnchored-self-match-phantom-red AC3: the round-163 phantom-red —
    // a PASSING test whose NAME quotes the `__PERFILE__ ... passed=false` shape (the runner's own
    // e2e name) is `✔`-prefixed, so the ^-anchored + full-shape pattern must NOT flag it:
    "✔ AC2/AC3 e2e — a `__PERFILE__ duration_ms=336 /home/yale/work/quay/plugin/test/foo.test.mjs passed=false` per-file line flips red and carries the failed file in failures[] (336.35913ms)",
    // gap-tmux-leak-scan-pattern-unnchored-self-match-phantom-red AC3: the round-167 phantom-red —
    // the same family, `✔`-prefixed passing test NAME quoting the `tmux-leak-scan: FAIL` shape —
    // must NOT flag with the ^-anchored pattern:
    "✔ AC5 e2e — a `tmux-leak-scan: FAIL` residual line (candidate C) flips red with failures non-empty (leak is a real residual) (396.686255ms)",
    // ... and the OTHER newly-^ anchored shapes must equally resist a `✔`-prefixed passing NAME
    // quoting them (family #4/#5 prevention — the full-table audit, gap-tmux-leak-scan ... AC4):
    "✔ AC1 e2e — a `❯ test/foo.test.ts (3 tests | 1 failed)` vitest line flips red early (12ms)",
    "✔ AC2 e2e — a `Test Files 1 failed | 10 passed` summary line flips red (3.4ms)",
    "✔ AC3 e2e — a `FULL-SUITE-EXIT=1` marker flips red (2.1ms)",
    "# fail 0",
    "# cancelled 0",
  ]) {
    assert.equal(isFailureLine(line), false, `should not flag: ${line}`);
  }
});

// ── gap-suite-state-has-no-reason-axis-failed-aborted-infra: AC1/AC2/AC3 (reason axis) ─────────────

test("AC5 unit — isAbortLine matches the early-EXIT gate-WAIT shape, never a failure line", () => {
  for (const line of [
    "scripts/test.sh: resource gate says WAIT — not running the full suite (numbers above). Re-run when the gate reports GO.",
    "resource gate says WAIT",
    "not running the full suite",
    // gap-runner-no-kill-on-red-and-no-max-runtime-hang-leak AC4: a PRIOR run's single-flight flock
    // blocked this test.sh → 0 test output → NO correctness conclusion → must be aborted, not failed.
    "another full suite holds .git/full-suite.lock — not starting (single-flight lock; waited 600s). Re-run when it finishes.",
    "single-flight lock; waited 600s",
  ]) {
    assert.equal(isAbortLine(line), true, `should flag as abort: ${line}`);
  }
  for (const line of [
    "not ok 1 - boom",
    "# fail 2",
    "# cancelled 1",
    "FULL-SUITE-EXIT=1",
    " ❯ test/foo.test.ts (3 tests | 1 failed) 12ms",
  ]) {
    assert.equal(isAbortLine(line), false, `a real failure line is NOT an abort line: ${line}`);
  }
});

// ── gap-full-suite-state-red-no-failure-detail-static-check-invisible: AC1-AC5 ─────────────────────
// When run_static_checks fails (task-contract-check ratchet growth / test-framework-policy /
// test-isolation violations / a ceiling breach), test.sh aborts under `set -e` BEFORE the node --test
// phase: the stream shows the checker's violation output and a non-zero exit, but NONE of the
// FAILURE_PATTERNS. The pre-fix runner labelled this reason=failed with failures=[] empty — the
// 20:48Z readability gap (state=red + reason=failed + failures=[] looks like an interrupted run, the
// real cause only in the log). These tests pin the fix: reason="static-check" + machine-readable
// counts + violations fill failures[].

test("AC2 unit — isStaticCheckFailureLine matches static-check failure markers, never a passing summary or a test-failure line", () => {
  // FAILURE markers (a PASSING run never emits them):
  for (const line of [
    "ratchet ceiling: 6; new since baseline: 6 (tasks/a.md: V1, tasks/b.md: V2)", // the 20:48Z 真因 — K>0 = growth
    "ratchet ceiling: 6; new since baseline: 1",
    "task-contract-check: current violations (11) exceed the ratchet ceiling (6) — the list can only get SHORTER",
    "task-contract-check: DOD-SUITE-LINE BASELINE CEILING BREACH — grandfather list can only get SHORTER",
    "test-framework-policy-check: FAIL: 2 violation(s):",
    "test-isolation-check: FAIL: 3 ratchet violation(s):",
  ]) {
    assert.equal(isStaticCheckFailureLine(line), true, `should flag static-check failure: ${line}`);
  }
  // Passing-run / test-failure lines must NOT flag:
  for (const line of [
    "violations: 0 unique across 0 task(s); info findings ...", // passing summary (N=0)
    "violations: 11 unique across 9 task(s); info findings ...", // violations listed but K=0 below — passing
    "ratchet ceiling: 6; new since baseline: 0; resolved: 0", // K=0 — no growth, passing
    "VIOLATION: tasks/baselined.md — V1: what", // baselined violation on a passing run
    "not ok 1 - boom", // test failure
    "# fail 2",
    "FULL-SUITE-EXIT=1",
    " ❯ test/foo.test.ts (3 tests | 1 failed) 12ms",
    "FAIL: some legacy assertion message", // legacy harness console noise
  ]) {
    assert.equal(isStaticCheckFailureLine(line), false, `should NOT flag: ${line}`);
  }
});

test("AC2 unit — extractStaticCheckDetail parses the VIOLATION/summary/ratchet lines into machine-readable fields", () => {
  const v = extractStaticCheckDetail(
    "VIOLATION: tasks/gap-foo.md — V1: Contract block missing invariant line",
  );
  assert.deepEqual(v, {
    violation: {
      file: "tasks/gap-foo.md",
      code: "V1",
      what: "Contract block missing invariant line",
      line: "VIOLATION: tasks/gap-foo.md — V1: Contract block missing invariant line",
    },
  });
  const s = extractStaticCheckDetail("violations: 11 unique across 9 task(s); info findings ...");
  assert.equal(s.violations, 11);
  assert.equal(s.taskCount, 9);
  const r = extractStaticCheckDetail("ratchet ceiling: 6; new since baseline: 6 (tasks/a.md: V1)");
  assert.equal(r.ceiling, 6);
  assert.equal(r.newSinceBaseline, 6);
  assert.equal(extractStaticCheckDetail("not ok 1 - boom"), null);
  assert.equal(extractStaticCheckDetail("# tests 2239"), null);
});

test("AC2/AC3/AC4 — a static-check-red run writes reason=static-check + machine-readable counts; violations fill failures[]", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fsr-scre-"));
  // The 2026-08-08 20:48Z shape: task-contract-check ratchet violations — the suite aborts
  // (set -e) before tests, so the stream shows VIOLATION/summary/ratchet lines + exit 1, no TAP.
  const { f, dir } = fakeSuite(
    'echo "VIOLATION: tasks/gap-foo.md — V1: Contract block missing invariant line"\n' +
      'echo "VIOLATION: tasks/gap-bar.md — V2: band value out of range"\n' +
      'echo "violations: 11 unique across 9 task(s); info findings (non-ratchet, pre-opt-in baseline): 0 — see --json for details"\n' +
      'echo "ratchet ceiling: 6; new since baseline: 6 (tasks/gap-foo.md: V1, tasks/gap-bar.md: V2); resolved: 0"\n' +
      "exit 1",
  );
  try {
    const child = runRunner({ root, command: `bash ${f}` });
    const { code } = await waitExit(child);
    assert.equal(code, 1, "runner exits 1 on a static-check red");
    const s = readState(root);
    assert.equal(s.state, "red");
    assert.equal(s.reason, "static-check", "static-check red is reason=static-check, NOT failed (AC3)");
    assert.ok(s.staticCheck, "machine-readable staticCheck field present (AC2)");
    assert.equal(s.staticCheck.violations, 11, "violation count (AC2)");
    assert.equal(s.staticCheck.taskCount, 9, "task count");
    assert.equal(s.staticCheck.ceiling, 6, "ratchet ceiling (AC2)");
    assert.equal(s.staticCheck.newSinceBaseline, 6, "new-since-baseline (AC2)");
    assert.ok(
      Array.isArray(s.staticCheck.details) && s.staticCheck.details.length === 2,
      "both VIOLATION details captured",
    );
    assert.equal(s.staticCheck.details[0].file, "tasks/gap-foo.md", "detail carries the violated task file");
    assert.ok(s.failures && s.failures.length === 2, "failures[] carries the static-check violation details (AC4 candidate B)");
    assert.equal(s.failures[0].staticCheck, true, "failures entries are marked static-check");
    assert.equal(s.failures[0].file, "tasks/gap-foo.md", "failure file = the violated task file");
    // Consumers can distinguish + route correctly (AC3):
    assert.equal(shouldStopDispatch(s), true, "static-check red stops dispatch (shared-gate failure)");
    assert.equal(routeRed(s), "red-window-triage", "routeRed routes static-check red to red-window-triage (a real failure)");
    const loc = classifyFailure(s.failures[0]);
    assert.equal(loc.kind, "shared-gate", "classifyFailure classifies the static-check failure as shared-gate");
    const res = runOnce(root);
    assert.equal(res.stopSignal, true, "runOnce reports stopSignal for static-check red");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("AC2 unit — extractFailClosedChecker parses checker-cost-lib's fail-closed machine line; isStaticCheckFailureLine flags it", () => {
  // gap-static-check-red-failures-capture-only-task-contract-shape: the round-84 真因 line
  // (threshold-scope-check fail-closed) did NOT match the old task-contract-shape patterns — this
  // pins that it now flags + parses.
  const fc = extractFailClosedChecker("STATIC_CHECK_FAILED: threshold-scope-check exit=1");
  assert.deepEqual(fc, { name: "threshold-scope-check", exitCode: 1, line: "STATIC_CHECK_FAILED: threshold-scope-check exit=1" });
  assert.equal(isStaticCheckFailureLine("STATIC_CHECK_FAILED: threshold-scope-check exit=1"), true, "the fail-closed machine line IS a static-check failure marker");
  assert.equal(extractFailClosedChecker("checker-cost-lib: run_checker_parallel_wait — static checks FAILED (fail-closed): threshold-scope-check(exit=1)"), null, "the human summary line is NOT machine-parsed (only the STATIC_CHECK_FAILED: line is)");
  assert.equal(extractFailClosedChecker("not ok 1 - boom"), null);
  assert.equal(extractFailClosedChecker("STATIC_CHECK_FAILED: no-exit-code"), null, "missing exit=<rc> is not a parseable fail-closed checker");
});

test("AC1/AC2 — buildStaticCheckFailures carries BOTH the VIOLATION details AND the fail-closed checkers, all staticCheck:true; the fail-closed checker (real gate, exit≠0) sorts FIRST so failures[0] is the gate's identity (gap-static-check-red-failures0-misattributed, round181/182)", () => {
  const suite = buildStaticCheckFailures(
    [{ file: "tasks/gap-foo.md", code: "V1", what: "x", line: "VIOLATION: tasks/gap-foo.md — V1: x" }],
    [{ name: "threshold-scope-check", exitCode: 1, line: "STATIC_CHECK_FAILED: threshold-scope-check exit=1" }],
  );
  assert.equal(suite.length, 2, "both the violation detail and the fail-closed checker are recorded");
  // gap-static-check-red-failures0-misattributed — the REAL GATE (exit≠0) must be failures[0], NOT
  // the first VIOLATION line from a non-blocking checker (round181/182 both misled diagnosticians).
  assert.equal(suite[0].line.includes("threshold-scope-check"), true, "the fail-closed checker (real gate) sorts first → failures[0] is the gate's identity");
  assert.equal(suite[0].staticCheck, true, "failures[0] (the real gate) is marked staticCheck:true");
  assert.equal(suite[1].file, "tasks/gap-foo.md", "the VIOLATION entry still carries the violated file, after the real gate");
  assert.ok(suite.every((f) => f.staticCheck === true), "every static-check entry is marked staticCheck:true (shared-gate routing)");
});

test("AC2 能取假·真样本 — round181/182 replay: reason=static-check with a --no-block task-contract VIOLATION line BEFORE the real gate's STATIC_CHECK_FAILED line ⇒ failures[0] = the real gate (direct-to-develop-bypass-check), NOT the contract-line VIOLATION", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fsr-r181-"));
  // The round181/182 shape (gap-static-check-red-failures0-misattributed): task-contract-check runs
  // with --no-block (exit 0 — prints VIOLATION/summary lines, does NOT gate the round) while
  // direct-to-develop-bypass-check is the REAL gate (exit 1, emits checker-cost-lib's
  // STATIC_CHECK_FAILED: <name> exit=<rc> machine line on stderr). The VIOLATION lines appear FIRST
  // in the stream — before the fail-closed line — so the old ordering made failures[0] the
  // non-blocking contract-line and the real gate drowned in failures[] (round181/182 both misled).
  const { f, dir } = fakeSuite(
    'echo "VIOLATION: tasks/gap-ac37.md — contract-line: Contract block missing invariant line"\n' +
      'echo "violations: 11 unique across 9 task(s)"\n' +
      'echo "recorded (non-blocking, grow-only ledger): 1 new task-file violation(s)"\n' +
      'echo "STATIC_CHECK_FAILED: direct-to-develop-bypass-check exit=1" >&2\n' +
      'echo "checker-cost-lib: run_checker_parallel_wait — static checks FAILED (fail-closed): direct-to-develop-bypass-check(exit=1)" >&2\n' +
      "exit 1",
  );
  try {
    const child = runRunner({ root, command: `bash ${f}` });
    const { code } = await waitExit(child);
    assert.equal(code, 1, "runner exits 1 on the round181/182 static-check red");
    const s = readState(root);
    assert.equal(s.state, "red");
    assert.equal(s.reason, "static-check", "reason=static-check (the pre-test static-check gate aborted the round)");
    assert.ok(Array.isArray(s.failures) && s.failures.length >= 2, `failures[] carries both the real gate and the violation: ${JSON.stringify(s.failures)}`);
    // AC1/AC2 — failures[0] MUST be the checker that actually exited ≠0 (the real gate), NOT the
    // first VIOLATION-style line from the non-blocking checker. This is the manager's criterion:
    // a diagnostician reading failures[0] must be sent at the real cause first.
    assert.equal(s.failures[0].line, "STATIC_CHECK_FAILED: direct-to-develop-bypass-check exit=1", "failures[0] = the real gate's identity (direct-to-develop-bypass-check), not a contract-line VIOLATION");
    assert.equal(s.failures[0].staticCheck, true, "failures[0] (the real gate) is marked staticCheck:true (shared-gate routing)");
    assert.equal(s.failures[0].file, undefined, "the real gate entry carries the checker identity in its line, no file (it is a fail-closed checker, not a violated task file)");
    // The machine-readable separation is intact (AC2 of the capture task): failedCheckers names the
    // real gate; details carries the VIOLATION lines.
    assert.equal(s.staticCheck.failedCheckers[0].name, "direct-to-develop-bypass-check", "staticCheck.failedCheckers names the real gate");
    assert.equal(s.staticCheck.details[0].file, "tasks/gap-ac37.md", "staticCheck.details still carries the contract-line VIOLATION (separate from the gate)");
    // Consumers route failures[0] (the real gate) to the shared gate — dispatch stops.
    assert.equal(classifyFailure(s.failures[0]).kind, "shared-gate", "failures[0] (the real gate) classifies shared-gate");
    assert.equal(shouldStopDispatch(s), true, "static-check red stops dispatch (shared-gate failure)");
    // The verification-round record carries the SAME ordering — failures[0] is the real gate there too.
    const round = lastRoundRecord(root);
    assert.ok(round, "verification-round record present");
    assert.equal(round.failures[0].line, "STATIC_CHECK_FAILED: direct-to-develop-bypass-check exit=1", "round-record failures[0] = the real gate (round181/182 replay, AC2)");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("gap-static-check-red-failures-capture-only-task-contract-shape — a FAIL-CLOSED checker (round-84 真因) is captured in failures[] + staticCheck.failedCheckers, separated from the violation details", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fsr-fc-"));
  // The round-84 shape: threshold-scope-check fail-closed (checker-cost-lib's machine line on stderr)
  // while task-contract --no-block emits VIOLATION lines + "recorded (non-blocking)" (exit-0 noise).
  // BEFORE this task, failures[] captured ONLY the 25 task-contract VIOLATION entries and the real
  // cause (threshold-scope-check) had ZERO entries — the defect this task fixes.
  const { f, dir } = fakeSuite(
    'echo "VIOLATION: tasks/gap-foo.md — contract-line-unknown: Contract block missing invariant line"\n' +
      'echo "recorded (non-blocking, grow-only ledger): 1 new task-file violation(s)"\n' +
      'echo "STATIC_CHECK_FAILED: threshold-scope-check exit=1" >&2\n' +
      'echo "checker-cost-lib: run_checker_parallel_wait — static checks FAILED (fail-closed): threshold-scope-check(exit=1)" >&2\n' +
      "exit 1",
  );
  try {
    const child = runRunner({ root, command: `bash ${f}` });
    const { code } = await waitExit(child);
    assert.equal(code, 1, "runner exits 1 on the fail-closed static-check red");
    const s = readState(root);
    assert.equal(s.state, "red");
    assert.equal(s.reason, "static-check", "a checker-cost-lib fail-closed red is reason=static-check, NOT failed");
    assert.ok(s.staticCheck, "machine-readable staticCheck field present");
    // AC1 — the fail-closed checker (真因) is in failures[], not just the task-contract VIOLATION shape.
    const fcEntry = Array.isArray(s.failures) ? s.failures.find((x) => x.line.includes("threshold-scope-check")) : undefined;
    assert.ok(fcEntry, `failures[] records the fail-closed checker 真因: ${JSON.stringify(s.failures)}`);
    assert.equal(fcEntry.staticCheck, true, "the fail-closed entry is marked static-check (shared-gate routing)");
    // AC2 — the two facts are separated: failedCheckers (which checker failed) vs details (violation lines).
    assert.ok(
      Array.isArray(s.staticCheck.failedCheckers) && s.staticCheck.failedCheckers.length === 1,
      `staticCheck.failedCheckers carries the fail-closed checker: ${JSON.stringify(s.staticCheck.failedCheckers)}`,
    );
    assert.equal(s.staticCheck.failedCheckers[0].name, "threshold-scope-check", "checker name");
    assert.equal(s.staticCheck.failedCheckers[0].exitCode, 1, "checker exit code");
    assert.ok(
      Array.isArray(s.staticCheck.details) && s.staticCheck.details.length === 1,
      "staticCheck.details still carries the VIOLATION lines (separate from failedCheckers)",
    );
    assert.equal(s.staticCheck.details[0].file, "tasks/gap-foo.md", "the violation detail carries the task file");
    // The fail-closed entry routes to the shared gate (dispatch stops on a static-check red).
    const loc = classifyFailure(fcEntry);
    assert.equal(loc.kind, "shared-gate", "the fail-closed checker entry routes to the shared gate");
    assert.equal(shouldStopDispatch(s), true, "static-check red stops dispatch (shared-gate failure)");
    // AC3 — the verification-round record (the authoritative red round) carries the SAME failures[]
    // with the fail-closed 真因 (round-84 形态: threshold-scope fail-closed appears in the record).
    const round = lastRoundRecord(root);
    assert.ok(
      round && Array.isArray(round.failures) && round.failures.some((x) => x.line.includes("threshold-scope-check")),
      "verification-round failures[] carries the fail-closed checker 真因: " + JSON.stringify(round),
    );
    assert.equal(round.reason, "gate-failed", "round record reason=gate-failed (fail=0 static-check red)");
    assert.equal(round.gate, "static-check", "round record names gate=static-check");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("gap-task-file-static-syntax: a --no-block task-file checker round (violations recorded, exit 0) is GREEN, not static-check red", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fsr-noblock-"));
  // The post-fix shape (option ①): task-contract-check runs with --no-block — it prints VIOLATION
  // lines + "recorded (non-blocking)" (the "new since baseline: N" marker is deliberately avoided),
  // exits 0, and the suite proceeds to a green test phase. The round must be GREEN — task-file
  // Contract/AC syntax must not consume a verification opportunity.
  const { f, dir } = fakeSuite(
    'echo "VIOLATION: tasks/gap-foo.md — V1: Contract block missing invariant line"\n' +
      'echo "recorded (non-blocking, grow-only ledger): 6 new task-file violation(s) — task-file syntax does NOT block the verification round"\n' +
      'echo "ratchet ceiling: 6; recorded (non-blocking): 6 (tasks/gap-foo.md: V1); resolved: 0"\n' +
      'echo "selected 1 files (groups=product,engine)"\n' +
      'echo "# tests 1"\necho "# pass 1"\necho "# fail 0"\necho "# cancelled 0"\n' +
      "exit 0",
  );
  try {
    const child = runRunner({ root, command: `bash ${f}` });
    const { code } = await waitExit(child);
    assert.equal(code, 0, "runner exits 0 — the round is green; task-file syntax did not block");
    const s = readState(root);
    assert.equal(s.state, "green", `expected green (recorded-not-blocking), got: ${JSON.stringify(s)}`);
    assert.notEqual(s.reason, "static-check", "a recorded-not-blocking round is NOT a static-check red");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("AC2b — the static-check phase gate: test-phase output (selected N files) stops static-check patterns firing on test fixtures (round-6 2026-08-09 false-red)", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fsr-pgate-"));
  // The round-6 false-red shape: a passing test (candidate-contracts.test.mjs) prints
  // "ANTI-DRIFT HARD FAIL: N violation(s)" fixture lines DURING its run — after test.sh's
  // "selected N files (groups=…)" test-phase marker, before any "# tests" summary. The static-check
  // patterns must NOT fire on those (the suite is genuinely green), but MUST still fire BEFORE the
  // test phase begins (covered by the AC2/AC3/AC4 test above, whose fake suite has no "selected").
  const { f, dir } = fakeSuite(
    'echo "selected 252 files (groups=product,engine)"\n' +
      'echo "ANTI-DRIFT HARD FAIL: 1 violation(s)"\n' +
      'echo "  cross-build-overlap: builds A & B both touched shared/s.js"\n' +
      'echo "# tests 42"\n' +
      'echo "# pass 42"\n' +
      'echo "# fail 0"\n' +
      "exit 0",
  );
  try {
    const child = runRunner({ root, command: `bash ${f}` });
    const { code } = await waitExit(child);
    assert.equal(code, 0, "runner exits 0 (the suite is genuinely green — the ANTI-DRIFT lines are test fixtures)");
    const s = readState(root);
    assert.equal(s.state, "green", "no false static-check red once the test phase has started");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("AC2 — both testsSeen summary forms (`# tests N` AND the reporter's `ℹ tests N`) arm the static-check phase gate on their own (round-6 regex root cause)", async () => {
  // Round-6 root cause (gap-static-check-false-positive-testsseen-regex-does-not-match-reporter-format):
  // the testsSeen parser only accepted the TAP `# tests N` form, but measure-suite-reporter emits the
  // info-glyph `ℹ tests N` — so testsSeen stayed 0 and the `testsSeen === 0` static-check guard was
  // INERT, letting STATIC_CHECK_FAILURE_PATTERNS fire on test-fixture output (candidate-contracts'
  // "ANTI-DRIFT HARD FAIL" lines). 42aad5fe accepts both prefixes; the Contract measure is
  // `tests_seen_after_test_phase > 0`. This test proves EACH summary form ALONE (no "selected N files"
  // marker) increments testsSeen ⇒ testPhaseStarted, so an ANTI-DRIFT fixture line printed after the
  // summary no longer false-triggers static-check red and the suite stays green.
  for (const summary of ['echo "# tests 5"', 'echo "ℹ tests 5"']) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "fsr-glyph-"));
    const { f, dir } = fakeSuite(
      summary +
        '\necho "ANTI-DRIFT HARD FAIL: 1 violation(s)"\n' +
        'echo "  cross-build-overlap: builds A & B both touched shared/s.js"\n' +
        'echo "# pass 5"\n' +
        'echo "# fail 0"\n' +
        "exit 0",
    );
    try {
      const child = runRunner({ root, command: `bash ${f}` });
      const { code } = await waitExit(child);
      assert.equal(code, 0, `runner exits 0 (genuinely green) for summary form: ${summary.trim()}`);
      const s = readState(root);
      assert.equal(
        s.state,
        "green",
        `summary form ${summary.trim()} ⇒ testsSeen>0 ⇒ phase gate armed ⇒ ANTI-DRIFT fixture line does NOT false-red (AC2/AC3/AC4)`,
      );
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
});

test("AC5 — a real test failure dominates a static-check marker: reason stays failed, failures[] carries the test failure", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fsr-sc-dom-"));
  const { f, dir } = fakeSuite(
    'echo "VIOLATION: tasks/gap-foo.md — V1: something"\n' +
      'echo "ratchet ceiling: 6; new since baseline: 6"\n' +
      'echo "not ok 1 - boom"\nexit 1',
  );
  try {
    const child = runRunner({ root, command: `bash ${f}` });
    const { code } = await waitExit(child);
    assert.equal(code, 1);
    const s = readState(root);
    assert.equal(s.state, "red");
    assert.equal(s.reason, "failed", "a real test failure is reason=failed, never downgraded to static-check (AC5)");
    assert.ok(redPayload(s).length >= 1, "the red payload carries failures");
    assert.equal(redPayload(s)[0].staticCheck, undefined, "the payload carries the REAL test failure (not a static-check entry)");
    assert.ok(s.staticCheck, "the staticCheck field is still recorded alongside (both facts present)");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("AC3 — routeRed/shouldStopDispatch distinguish static-check red (stops) from aborted/infra-error red (does not stop)", () => {
  assert.equal(routeRed({ state: "red", reason: "static-check" }), "red-window-triage", "static-check red → red-window-triage");
  assert.equal(shouldStopDispatch({ state: "red", reason: "static-check" }), true, "static-check red stops dispatch");
  assert.equal(shouldStopDispatch({ state: "red", reason: "failed" }), true, "test-failure red stops dispatch (unchanged, AC5)");
  assert.equal(shouldStopDispatch({ state: "red", reason: "aborted" }), false, "aborted red does NOT stop (unchanged)");
  assert.equal(shouldStopDispatch({ state: "red", reason: "infra-error" }), false, "infra-error red does NOT stop (unchanged)");
});

test("AC1/AC3 — an early-EXIT red (test.sh internal resource-gate WAIT fail-closed) is reason=aborted, NOT failed", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fsr-abort-"));
  // The concrete shape from today's FALSE-RED incidents: test.sh's INTERNAL resource-gate fail-closed
  // prints `resource gate says WAIT — not running the full suite ...` to stderr and exits 1 in ~6s
  // WITHOUT running a single test. The runner must classify this as reason=aborted (NO correctness
  // conclusion), never reason=failed — a failed label would stop dispatch on code risk with zero
  // evidence (the coincidence gap the task exists to close).
  const { f, dir } = fakeSuite(
    'echo "scripts/test.sh: resource gate says WAIT — not running the full suite (numbers above). Re-run when the gate reports GO." >&2\nexit 1',
  );
  try {
    const child = runRunner({ root, command: `bash ${f}` });
    const { code } = await waitExit(child);
    assert.equal(code, 1, "runner exits 1 on red");
    const s = readState(root);
    assert.equal(s.state, "red", "gate-WAIT early-exit is red (not green)");
    assert.equal(s.reason, "aborted", "early gate-WAIT exit is reason=aborted, NOT failed (AC1/AC3)");
    assert.ok(s.finishedAt, "final aborted-red has finishedAt");
    assert.equal(typeof s.durationMs, "number", "durationMs recorded even on the aborted run");
    // The stop-dispatch consumer must NOT stop on this aborted-red (AC2: aborted routes to the
    // resource-gate, NOT to code-risk stop).
    const res = runOnce(root);
    assert.equal(res.stopSignal, false, "aborted-red must NOT trigger stop-dispatch");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("AC5 — a REAL failure after an abort marker is NOT downgraded: reason stays failed (failure conclusion stands)", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fsr-dom-"));
  // Defensive: even if an abort marker appears first, a later real failure line is the stronger
  // conclusion — redDetected must dominate abortDetected (AC5: the failure conclusion stands).
  const { f, dir } = fakeSuite('echo "resource gate says WAIT" >&2\necho "not ok 1 - boom"\nexit 1');
  try {
    const child = runRunner({ root, command: `bash ${f}` });
    const { code } = await waitExit(child);
    assert.equal(code, 1);
    const s = readState(root);
    assert.equal(s.state, "red");
    assert.equal(s.reason, "failed", "a real failure after an abort marker stays failed, never downgraded");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("AC5 — a child killed by a signal (SIGKILL) writes reason=infra-error (environment), NOT failed", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fsr-sigkill-"));
  // A SIGKILL'd suite exits with code=null + signal=SIGKILL: the DIRECT test.sh child was torn down
  // mid-run ⇒ an environment problem (reason=infra-error, no correctness conclusion), NOT a code
  // failure. Previously this was labelled aborted; gap-infra-error-false-positive-from-test-internal-
  // kill AC2 re-classifies a signal-killed DIRECT child as infra-error (the EXIT STATUS is the only
  // reliable kill signal — a stream `Killed`/`__ENVFAIL__` marker from a test's internal subprocess
  // is NOT).
  const { f, dir } = fakeSuite('echo "about to die"\nkill -9 $$\necho "unreachable"');
  try {
    const child = runRunner({ root, command: `bash ${f}` });
    const { code } = await waitExit(child);
    assert.equal(code, 1, "runner exits 1 on a killed suite");
    const s = await poll(() => {
      const cur = readState(root);
      return cur && cur.state === "red" && cur.reason === "infra-error" ? cur : null;
    }, { timeoutMs: 5000 });
    assert.ok(s, "signal-killed child is final state=red reason=infra-error");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("AC5 — a SIGKILL'd node --test reported by bash as exit 137 is reason=infra-error, NOT failed (the 07:08→07:21 shape)", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fsr-137-"));
  // gap-suite-cutoff-what-tears-test-process-at-session-topology (confirmed 2026-08-07): in the real
  // full-suite path test.sh runs `node --test` as a CHILD and bash reports a SIGKILL'd child as its
  // OWN exit code 128+N (137 for SIGKILL). The runner's child is `bash -c <test.sh>`, so it sees
  // exit.code=137, exit.signal=null — the pre-fix childKilledBySignal (`exitCode === null`) missed
  // this and mislabelled it reason=failed (a stop-dispatch signal). Reproduce the bash shape:
  //   bash runs a child, the child is SIGKILL'd externally, bash `wait`s it (→137) and exits 137.
  // gap-infra-error-false-positive-from-test-internal-kill AC2: the DIRECT child exiting 128+N
  // (a signal-killed descendant) is an environment problem ⇒ reason=infra-error (the runner's own
  // test.sh child was torn down mid-run), NOT aborted.
  const { f, dir } = fakeSuite(
    'echo "simulating a SIGKILL\'d node --test child"\n' +
      "sleep 30 &\n" +
      "child=$!\n" +
      "kill -9 \"$child\"\n" +
      "wait \"$child\" 2>/dev/null\n" +
      "code=$?\n" +
      'echo "bash observed child killed, exiting $code"\n' +
      "exit \"$code\"",
  );
  try {
    const child = runRunner({ root, command: `bash ${f}` });
    const { code } = await waitExit(child);
    assert.equal(code, 1, "runner exits 1 on an infra-error suite");
    const s = await poll(() => {
      const cur = readState(root);
      return cur && cur.state === "red" && cur.reason === "infra-error" ? cur : null;
    }, { timeoutMs: 5000 });
    assert.ok(s, `bash-exits-137 signal-kill is final state=red reason=infra-error (got ${JSON.stringify(readState(root))})`);
    // And the stop-dispatch consumer (runOnce) reports NO stop signal for infra-error-red (AC5 —
    // infra-error, like aborted, does NOT stop dispatch).
    const res = runOnce(root);
    assert.equal(res.stopSignal, false, "bash-137 infra-error-red must NOT trigger stop-dispatch");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("AC5 — a generic non-zero exit with NO failure/abort marker stays reason=failed (fail-closed catch-all)", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fsr-catch-"));
  // The reason-axis boundary: an unmatched non-zero exit could be a real failure no structured line
  // matched. Failing CLOSED (reason=failed) preserves the stop-dispatch signal for that class; only a
  // recognised NO-conclusion shape (abort marker / signal kill / spawn error) is relaxed to aborted.
  const { f, dir } = fakeSuite('echo "something went wrong"\nexit 3');
  try {
    const child = runRunner({ root, command: `bash ${f}` });
    const { code } = await waitExit(child);
    assert.equal(code, 1, "runner exits 1 on red");
    const s = readState(root);
    assert.equal(s.state, "red");
    assert.equal(s.reason, "failed", "an unmatched non-zero exit stays fail-closed failed");
    // gap-suite-red-verdict-carries-empty-failures-payload AC1 — a red verdict must NEVER carry an
    // EMPTY failure payload: the fail-closed catch-all used to write failures=[] (the SUITE-RED
    // event's dispatch rule has no input). Now the runner synthesizes one best-effort entry from the
    // last stream line so the red-window dispatch rule has a failure to classify. The synthesized
    // entry carries no file (the line `something went wrong` has no path), so it rides
    // `unattributed[]` — the payload lives in failures[] OR unattributed[] (AC1/AC2 segmentation).
    assert.ok(redPayload(s).length >= 1, `a red verdict carries a non-empty failure payload (failures[] or unattributed[]); got ${JSON.stringify(s)}`);
    assert.ok(redPayload(s)[0].line, "the synthesized failure carries a line (the last stream output)");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("AC3 — a red suite's full-suite.log ends with a `# fail` summary line (gap-suite-red-verdict-carries-empty-failures-payload)", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fsr-logsump-"));
  // The observed defect: full-suite.log ran 9251 lines with ZERO `# fail`/`# pass` summary lines,
  // ending mid-assertion. The runner now appends its OWN TAP-form summary after the verdict so the
  // log is always mechanically queryable for a fail count — even when the child was killed mid-assert.
  const { f, dir } = fakeSuite('echo "not ok 1 - boom"\nexit 1');
  try {
    const child = runRunner({ root, command: `bash ${f}` });
    const { code } = await waitExit(child);
    assert.equal(code, 1, "runner exits 1 on red");
    const log = fs.readFileSync(path.join(root, ".quay", "full-suite.log"), "utf8");
    // The runner's own summary line carries the red verdict as a fail count (TAP form so
    // `grep -cE '^# (tests|pass|fail|cancelled)'` finds it).
    assert.match(log, /^# fail [1-9]\d*$/m, `log has a '# fail N' summary line; got:\n${log}`);
    assert.match(log, /^# suite red failed$/m, "log summary names the red verdict");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("AC1/AC3 e2e — a GREEN suite's full-suite.log ends with a `# fail 0` summary (summary is verdict-accurate)", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fsr-logsumpgreen-"));
  const { f, dir } = fakeSuite(GREEN_SUITE);
  try {
    const child = runRunner({ root, command: `bash ${f}` });
    const { code } = await waitExit(child);
    assert.equal(code, 0, "runner exits 0 on green");
    const log = fs.readFileSync(path.join(root, ".quay", "full-suite.log"), "utf8");
    assert.match(log, /^# fail 0$/m, `a green run logs '# fail 0'; got:\n${log}`);
    assert.match(log, /^# suite green$/m, "green summary names the green verdict");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("AC1 — a passing vitest-style suite logging a bare-X console line stays GREEN (no false early-red)", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fsr-ac1x-"));
  // archguard TASK-67 shape: a PASSING negative-control test logs `✖ Diagram test failed` to
  // console.error; the vitest summary is 0 failed / exit 0. The old bare-✖ FAILURE_PATTERN turned
  // this GREEN suite red. With structured matching it must stay green (AC1).
  const { f, dir } = fakeSuite(
    'echo "✖ Diagram test failed" >&2\n' +
      'echo "# tests 5"\necho "# pass 5"\necho "# fail 0"\necho "# cancelled 0"\nexit 0',
  );
  try {
    const child = runRunner({ root, command: `bash ${f}` });
    const { code } = await waitExit(child);
    assert.equal(code, 0, `runner exits 0 on green, got ${code}`);
    const s = readState(root);
    assert.equal(s.state, "green", "bare ✖ console noise must NOT flip state to red (AC1)");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("AC2 — a vitest structured failure line flips red EARLY, before the run completes", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fsr-vit-"));
  const marker = path.join(root, "post-failure-marker");
  // A real failing vitest run prints the structured per-file line (`❯ <file> (N tests | M failed)`)
  // BEFORE its summary and exit. Red must be marked on that line, not at exit — the same early-red
  // property node:test/TAP gets from `not ok` (AC2 preserved for vitest projects).
  const { f, dir } = fakeSuite(
    'echo " ❯ test/foo.test.ts (3 tests | 1 failed) 12ms"\nsleep 10\necho done > "' +
      marker +
      '"\nexit 1',
  );
  try {
    const child = runRunner({ root, command: `bash ${f}` });
    // gap-suite-load-sampler-orphan-process load-hardening: 5s poll / 2s marker window flaked
    // RED under 16-way contention (runner node bootstrap > 5s ⇒ `poll timeout after 5000ms`).
    // Widen the marker window + poll timeout so early-red is judged on the marker (wall-clock),
    // not on a runner-bootstrap race.
    const redObserved = await poll(() => {
      const s = readState(root);
      return s && s.state === "red" ? s : null;
    }, { timeoutMs: 20000 });
    assert.equal(redObserved.state, "red");
    assert.equal(redObserved.reason, "failed", "a structured vitest failure is a REAL failure (stop-dispatch signal)");
    assert.equal(redObserved.finishedAt, null, "red written while the run is still in progress (AC2 early-red)");
    assert.ok(!fs.existsSync(marker), "red appeared before the suite's post-failure step completed");
    const { code } = await waitExit(child);
    assert.equal(code, 1, "runner exits 1 on red");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ── gap-runner-failure-patterns-miss-info-glyph-and-perfile-failed: AC2/AC3/AC5 e2e ────────────────
// The round-149 defect (state=red reason=failed but failures=[] / redAt=null): the runner's
// FAILURE_PATTERNS missed the reporter's info-glyph / per-file failure forms. Each e2e below
// constructs the real reporter shape and asserts red + a non-empty failures[] (the AC3 "red with
// detail" property) — the measure `failures_nonempty_on_info_red >= 1` band.

test("AC2/AC3 e2e — an `ℹ fail 1` (info-glyph summary) suite flips red with a non-empty failures[] and a non-null redAt", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fsr-infofail-"));
  const { f, dir } = fakeSuite('echo "ℹ tests 1"\necho "ℹ pass 0"\necho "ℹ fail 1"\necho "ℹ cancelled 0"\nexit 1');
  try {
    const child = runRunner({ root, command: `bash ${f}` });
    const { code } = await waitExit(child);
    assert.equal(code, 1, "runner exits 1 on red");
    const s = readState(root);
    assert.equal(s.state, "red", "ℹ fail 1 flips state to red (AC2 — the reporter glyph form is recognized)");
    assert.equal(s.reason, "failed", "ℹ fail 1 is a REAL test failure (stop-dispatch signal)");
    assert.ok(redPayload(s).length >= 1, `the red payload must be non-empty (measure failures_nonempty_on_info_red >= 1); got ${JSON.stringify(s)}`);
    // redAt is carried on the verification-round record (the early-RED detection-latency axis) —
    // the round-149 record had redAt=null; a recognized failure line must timestamp it.
    const roundFile = path.join(root, ".quay", "verification-round.jsonl");
    const rounds = fs.existsSync(roundFile)
      ? fs.readFileSync(roundFile, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l))
      : [];
    assert.ok(rounds.length >= 1, "a verification-round record is appended");
    assert.ok(rounds[rounds.length - 1].redAt, `redAt must have a value (round-149 had null); got ${rounds[rounds.length - 1].redAt}`);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
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

// ── gap-runner-no-kill-on-red-and-no-max-runtime-hang-leak AC2/AC3 ─────────────────────────────────
// The runner previously waited for a HUNG suite child forever (round-164 leaked 20+ min holding the
// single-flight flock). The max-runtime / silence / red-grace guards kill the child TREE and produce
// reason=timeout / reason=hung / a prompt red exit. Tests use the env seams to make the guards fire fast.

test("AC3 e2e — a HANGING suite is killed at the max-runtime seam (reason=timeout, no indefinite leak)", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fsr-timeout-"));
  const { f, dir } = fakeSuite('sleep 30'); // hangs far beyond the 800ms seam
  try {
    const child = runRunner({ root, command: `bash ${f}`, env: { QUAY_TEST_SUITE_MAX_RUNTIME_MS: "800" } });
    const { code } = await waitExit(child);
    const s = readState(root);
    assert.equal(s.state, "red", "a max-runtime kill is a red (no correctness conclusion)");
    assert.equal(s.reason, "timeout", `max-runtime kill must be reason=timeout, got ${s.reason}`);
    assert.ok(code !== 0, "runner exits non-zero on a timeout kill");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("AC3 e2e — a SILENT suite is killed at the silence seam (reason=hung)", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fsr-hung-"));
  const { f, dir } = fakeSuite('echo "start"; sleep 30'); // one line, then silence far beyond the seam
  try {
    const child = runRunner({ root, command: `bash ${f}`, env: { QUAY_TEST_SUITE_SILENCE_MS: "800" } });
    const { code } = await waitExit(child);
    const s = readState(root);
    assert.equal(s.state, "red", "a silence kill is a red (no correctness conclusion)");
    assert.equal(s.reason, "hung", `silence kill must be reason=hung, got ${s.reason}`);
    assert.ok(code !== 0, "runner exits non-zero on a hung kill");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("AC2 e2e — a RED suite whose test.sh hangs is killed after the red-grace seam (prompt exit, red conclusion stands)", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fsr-killonred-"));
  const { f, dir } = fakeSuite('echo "not ok 1 - boom"; sleep 30'); // red detected, then hangs
  try {
    const child = runRunner({ root, command: `bash ${f}`, env: { QUAY_TEST_RED_GRACE_MS: "800", QUAY_TEST_KILL_ON_RED: "1" } });
    const { code } = await waitExit(child);
    const s = readState(root);
    assert.equal(s.state, "red", "the red conclusion stands");
    assert.equal(s.reason, "failed", `a REAL failure (not ok) is never downgraded to timeout/hung: got ${s.reason}`);
    assert.ok(redPayload(s).length >= 1, `the not-ok failure must be recorded; got ${JSON.stringify(s)}`);
    assert.ok(code !== 0, "runner exits non-zero on the red");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("AC2 e2e — a RED suite STILL PRODUCING OUTPUT is NOT killed on red-grace; it runs to completion (report-all-failures, manager 2026-08-10 15:1x)", async () => {
  // round-95 AC3 principle: phases run EVEN IF a later phase fails. The runner's kill-on-red must
  // only kill a HUNG child (silent for RED_GRACE_MS), not one still emitting results — otherwise a
  // serial/lowconc red (which runs FIRST per test.sh phase order) kills the whole tree before the
  // main phase (281 files, 89%) ever runs. This fake suite reds early, then keeps producing output
  // (simulating main still running) and exits on its own — the runner must NOT escalate the kill.
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fsr-stillprod-"));
  const { f, dir } = fakeSuite(
    'echo "not ok 1 - boom"; for i in $(seq 1 30); do echo "line $i - still running"; sleep 0.1; done; exit 1',
  );
  try {
    const child = runRunner({ root, command: `bash ${f}`, env: { QUAY_TEST_RED_GRACE_MS: "800", QUAY_TEST_KILL_ON_RED: "1" } });
    const { code } = await waitExit(child);
    const s = readState(root);
    assert.equal(s.state, "red", "the red conclusion stands");
    assert.equal(s.reason, "failed", `a real failure is never downgraded to timeout/hung: got ${s.reason}`);
    assert.ok(redPayload(s).length >= 1, `the not-ok failure must be recorded; got ${JSON.stringify(s)}`);
    // The suite ran its full body (all 30 'still running' lines) and exited itself — the runner did
    // NOT kill it at the red-grace seam (a kill would cut the output short).
    assert.ok(code !== 0, "runner exits non-zero on the red");
    // Assert the suite body completed: the last 'still running' line reached the log (not killed mid-way).
    const log = fs.readFileSync(path.join(root, ".quay", "full-suite.log"), "utf8");
    assert.match(log, /line 30 - still running/, "the suite's final line must appear — NOT killed at red-grace");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("AC1 e2e — a stream __ENVFAIL__ marker (runCli helper's environment-failure throw) from a TEST's INTERNAL kill does NOT flip the suite — exit 0 ⇒ green (gap-infra-error-false-positive-from-test-internal-kill)", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fsr-envfail-"));
  // The fake suite's stderr carries the runCli helper's ENV_FAIL_MARKER throw (killed by SIGKILL) —
  // the exact round-18 false-positive shape: resource-gate.test.mjs kills an INTERNAL child to test
  // the resource gate and prints `__ENVFAIL__ killed by SIGKILL`, while ALL its tests pass (exit 0).
  // The kill classification must come from the DIRECT test.sh child's EXIT STATUS (childKilledBySignal),
  // NOT from stream content — a stream marker a test's internal subprocess printed is not evidence the
  // suite was torn down. exit 0 + no failure line ⇒ state=green (NOT infra-error).
  const { f, dir } = fakeSuite('echo "__ENVFAIL__ killed by SIGKILL: ./bin/quay.js x" >&2; exit 0');
  try {
    const child = runRunner({ root, command: `bash ${f}` });
    const { code } = await waitExit(child);
    const s = readState(root);
    assert.equal(s.state, "green", `a passing suite whose only oddity is a test-internal __ENVFAIL__ stream marker must be GREEN, got ${JSON.stringify(s)}`);
    assert.ok(!s.reason, `green state carries no reason, got ${JSON.stringify(s)}`);
    assert.equal(code, 0, "runner exits 0 on the green suite");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("AC1 e2e — a `Killed node --test` bash job-status line + green TAP tally + exit 0 ⇒ GREEN, NOT infra-error (the round-18 `suite log shows 1 SIGKILL/Killed marker(s)` shape)", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fsr-killedline-"));
  // round 18 (2026-08-12): tests=3977 pass=3977 fail=0 cancelled=0 but the round was mislabelled
  // infra-error because the log carried a SIGKILL/Killed marker. The marker is a TEST's internal
  // subprocess being killed (resource-gate.test.mjs kills a child to test the resource gate) — the
  // DIRECT test.sh child exited 0 with all tests passing. Reproduce the exact shapes: a bash
  // job-status `Killed node --test` line AND a green TAP summary, then exit 0. The runner must mark
  // GREEN (kill detection is the DIRECT child's exit status, never a stream marker).
  const { f, dir } = fakeSuite(
    'echo "scripts/test.sh: line 576: 720326 Killed node --test"\n' +
      'echo "__ENVFAIL__ killed by SIGKILL: ./bin/quay.js x" >&2\n' +
      'echo "# tests 3977"\necho "# pass 3977"\necho "# fail 0"\necho "# cancelled 0"\n' +
      "exit 0",
  );
  try {
    const child = runRunner({ root, command: `bash ${f}` });
    const { code } = await waitExit(child);
    const s = readState(root);
    assert.equal(s.state, "green", `all-pass suite with only Killed/__ENVFAIL__ stream markers must be GREEN, got ${JSON.stringify(s)}`);
    assert.ok(!s.reason, `green state carries no reason, got ${JSON.stringify(s)}`);
    assert.equal(code, 0, "runner exits 0 on the green suite");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("AC1/manager-semantic e2e — a FULLY-GREEN test result (pass>0 fail=0 cancelled=0 failures=[]) + a signal-killed DIRECT child (exit 137) ⇒ GREEN, NOT infra-error red (fully-green test result wins over infra-error)", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fsr-greenwins-"));
  // Manager semantic (2026-08-12, round-18 shape): when the TEST RESULT is fully green — pass>0,
  // fail=0, cancelled=0, failures=[] — every test that ran passed. An infra-error teardown signal
  // (here the DIRECT child exits 137: a descendant was SIGKILL'd) must NOT turn that into a
  // state=red that blocks the batch-merge freshness gate. The fully-green test result is evidence
  // the TESTS ALL PASSED ⇒ state=green (the reason axis never sees it as red).
  const { f, dir } = fakeSuite(
    'echo "scripts/test.sh: line 576: 720326 Killed node --test"\n' +
      'echo "# tests 3977"\necho "# pass 3977"\necho "# fail 0"\necho "# cancelled 0"\n' +
      "sleep 30 &\n" +
      "child=$!\n" +
      "kill -9 \"$child\"\n" +
      "wait \"$child\" 2>/dev/null\n" +
      "exit $?",
  );
  try {
    const child = runRunner({ root, command: `bash ${f}` });
    const { code } = await waitExit(child);
    const s = readState(root);
    assert.equal(s.state, "green", `a fully-green test result must win over the infra-error teardown signal, got ${JSON.stringify(s)}`);
    assert.ok(!s.reason, `green state carries no reason, got ${JSON.stringify(s)}`);
    assert.equal(code, 0, "runner exits 0 on the green suite (fully-green test result)");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("AC2 e2e — a REAL signal-killed DIRECT test.sh child torn down MID-RUN (no full green TAP summary) is infra-error red, NOT green (AC2 non-regression)", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fsr-realkill-"));
  // AC2 (gap-infra-error-false-positive-from-test-internal-kill): a REAL environment failure — the
  // runner's DIRECT test.sh child killed by a signal (bash exits 128+N) BEFORE producing a full green
  // result — must STILL be infra-error. This fake suite prints a `Killed node --test` line and exits
  // 137 but emits NO full green TAP summary (torn down mid-run): the test result is NOT fully green
  // (tapPass=0), so infra-error is a red, not green. Distinguishes the two directions: a fully-green
  // test result wins (previous test); a mid-run teardown with no green evidence stays infra-error red.
  const { f, dir } = fakeSuite(
    'echo "scripts/test.sh: line 576: 720326 Killed node --test"\n' +
      'echo "partial output before teardown"\n' +
      "sleep 30 &\n" +
      "child=$!\n" +
      "kill -9 \"$child\"\n" +
      "wait \"$child\" 2>/dev/null\n" +
      "exit $?",
  );
  try {
    const child = runRunner({ root, command: `bash ${f}` });
    const { code } = await waitExit(child);
    assert.equal(code, 1, "runner exits 1 on the infra-error");
    const s = await poll(() => {
      const cur = readState(root);
      return cur && cur.state === "red" && cur.reason === "infra-error" ? cur : null;
    }, { timeoutMs: 5000 });
    assert.ok(s, `signal-killed DIRECT child torn down mid-run is final state=red reason=infra-error (got ${JSON.stringify(readState(root))})`);
    const res = runOnce(root);
    assert.equal(res.stopSignal, false, "infra-error-red must NOT trigger stop-dispatch");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("AC2 e2e — MULTIPLE failure lines each push into failures[] (manager 2026-08-10 15:2x: structurally capped at 1 before; now every failure records)", async () => {
  // r240 TAP reported fail=7 but failures[] held only the FIRST failure's name — the push sat inside
  // the !redDetected guard that flips true on line 1. This fake suite emits THREE not-ok lines; all
  // three must be recorded (capped at MAX_RECORDED_FAILURES only for pathological rounds).
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fsr-multifail-"));
  const { f, dir } = fakeSuite(
    'echo "not ok 1 - alpha"; echo "not ok 2 - beta"; echo "not ok 3 - gamma"; exit 1',
  );
  try {
    const child = runRunner({ root, command: `bash ${f}` });
    const { code } = await waitExit(child);
    const s = readState(root);
    assert.equal(s.state, "red");
    assert.equal(s.reason, "failed");
    assert.ok(redPayload(s).length >= 3, `all 3 failure lines must be recorded; got ${JSON.stringify(s)}`);
    const names = redPayload(s).map((x) => x.line).join(" ");
    assert.match(names, /alpha/, "first failure recorded");
    assert.match(names, /beta/, "second failure recorded (was dropped by the !redDetected cap)");
    assert.match(names, /gamma/, "third failure recorded");
    assert.ok(code !== 0, "runner exits non-zero on the red");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("AC2 e2e negative control — a SHARED-GATE red and a SPECIFIC-TEST red produce distinguishable failures[] payloads (the dispatch rule can decide)", async () => {
  // gap-suite-red-verdict-carries-empty-failures-payload AC2 — the SUITE-RED failures payload must
  // carry enough WHERE for the inner dispatch rule to distinguish a SHARED-GATE failure (run_static_checks
  // — every scoped run pays it ⇒ stop dispatch) from a SPECIFIC-TEST failure unrelated to a candidate's
  // touch-set (⇒ dispatch continues). Construct BOTH through the real runner and assert the two
  // failures[] payloads classify differently (shared-gate vs specific-test) — the empty-payload defect
  // would make this impossible (failures=[] has no location to classify).
  const runBoth = async (scriptBody) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "fsr-ac2neg-"));
    const { f, dir } = fakeSuite(scriptBody);
    try {
      const child = runRunner({ root, command: `bash ${f}` });
      const { code } = await waitExit(child);
      assert.notEqual(code, 0, "the red suite exits non-zero");
      const s = readState(root);
      assert.equal(s.state, "red");
      assert.ok(s.failures && s.failures.length >= 1, `failures[] must be non-empty (payload not empty); got ${JSON.stringify(s.failures)}`);
      return { s, root };
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  };

  // shared-gate red: a static-check checker fails (task-contract ratchet growth) — the shared gate
  const shared = await runBoth(
    'echo "VIOLATION: tasks/gap-foo.md — V1: Contract block missing invariant line"\n' +
      'echo "violations: 11 unique across 9 task(s); info findings (non-ratchet, pre-opt-in baseline): 0 — see --json for details"\n' +
      'echo "ratchet ceiling: 6; new since baseline: 6 (tasks/gap-foo.md: V1); resolved: 0"\n' +
      "exit 1",
  );
  // specific-test red: a real test file failure (TAP not ok with a file in the detail block) — the
  // file is repo-relative (absolute paths OUTSIDE the temp root would normalize away, see
  // normalizeFailureFile); the runner captures it from the detail block's `location:` line. The
  // detail line must be ECHOED (a bare `location: ...` line would be treated as a bash command).
  const specific = await runBoth("echo \"not ok 1 - something failed\"\necho \"  location: 'plugin/test/foo.test.mjs:3:1'\"\nexit 1");

  try {
    const sharedLoc = classifyFailure(shared.s.failures[0]);
    const specificLoc = classifyFailure(specific.s.failures[0]);
    assert.equal(sharedLoc.kind, "shared-gate", `the static-check failure classifies shared-gate; got ${JSON.stringify(sharedLoc)}`);
    assert.equal(specificLoc.kind, "specific-test", `the test-file failure classifies specific-test; got ${JSON.stringify(specificLoc)}`);
    // The dispatch rule reads the payloads differently: a shared-gate red blocks an unrelated
    // candidate; a specific-test red unrelated to the candidate's touches does NOT.
    assert.equal(
      shouldDispatchOnRed(shared.s, "## Touches\n- plugin/test/other.test.mjs\n"),
      true,
      "shared-gate red stops dispatch even for an unrelated candidate (every scoped run pays it)",
    );
    assert.equal(
      shouldDispatchOnRed(specific.s, "## Touches\n- plugin/test/other.test.mjs\n"),
      false,
      "a specific-test red unrelated to the candidate's touch-set does NOT stop dispatch (dispatch continues)",
    );
  } finally {
    fs.rmSync(shared.root, { recursive: true, force: true });
    fs.rmSync(specific.root, { recursive: true, force: true });
  }
});

test("AC2/AC3 e2e — a `__PERFILE__ ... passed=false` per-file line flips red and carries the failed file in failures[]", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fsr-pf-"));
  const { f, dir } = fakeSuite(
    'echo "__PERFILE__ duration_ms=3580.991183 packages/quay/test/verify-delivery-surface.test.mjs passed=false"\nexit 1',
  );
  try {
    const child = runRunner({ root, command: `bash ${f}` });
    const { code } = await waitExit(child);
    assert.equal(code, 1, "runner exits 1 on red");
    const s = readState(root);
    assert.equal(s.state, "red", "__PERFILE__ passed=false flips state to red (AC2)");
    assert.equal(s.reason, "failed");
    assert.ok(s.failures && s.failures.length >= 1, `failures[] carries the per-file failure (AC3); got ${JSON.stringify(s.failures)}`);
    assert.equal(
      s.failures[0].file,
      "packages/quay/test/verify-delivery-surface.test.mjs",
      "the per-file line's path is the failure's file (AC3 — red with detail, no more failures=[])",
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("AC2 e2e — a GREEN round archives stderr __OVERHEAD__ phase lines (stderr is teed, not dropped)", async () => {
  // test.sh's _oh_emit writes the fixed-overhead decomposition to STDERR (>&2). The runner must
  // archive those lines into .quay/full-suite.log — the outer's verification round greps that log
  // for `__OVERHEAD__`. This fake suite emits one line to stdout and one to STDERR on a green run;
  // both must land in the archived log (gap-red-round-loses-overhead-phase-decomposition AC2).
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fsr-oh-green-"));
  const { f, dir } = fakeSuite(
    'echo "__OVERHEAD__ lock_overhead_ms=42"\n' +
      'echo "__OVERHEAD__ main_phase_ms=650104" >&2\n' +
      'echo "# tests 1"\necho "# pass 1"\necho "# fail 0"\necho "# cancelled 0"\nexit 0',
  );
  try {
    const child = runRunner({ root, command: `bash ${f}` });
    const { code } = await waitExit(child);
    assert.equal(code, 0, `green suite exits 0, got ${code}`);
    assert.equal(readState(root).state, "green");
    const log = read(path.join(root, ".quay", "full-suite.log"));
    assert.match(log, /__OVERHEAD__ lock_overhead_ms=42/, "stdout __OVERHEAD__ line reached the archived log");
    assert.match(
      log,
      /__OVERHEAD__ main_phase_ms=650104/,
      "STDERR __OVERHEAD__ line reached the archived log (stderr is teed, not dropped)",
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("AC2/AC3 e2e — a RED/killed round's archived log still carries stderr __OVERHEAD__ phase lines (red round OVERHEAD non-zero)", async () => {
  // gap-red-round-loses-overhead-phase-decomposition: kill-on-red truncates the main phase BEFORE
  // test.sh's full 9-segment emit, so a red round historically archived ZERO __OVERHEAD__ lines.
  // With the partial fallback, test.sh emits the COMPLETED segments (serial/lowconc) with partial=1
  // to stderr BEFORE the kill; the runner must archive those lines even though the round is red and
  // the child is killed. This fake suite writes the partial-phase lines to stderr, reds early, then
  // goes silent so the runner's red-grace kill fires — the __OVERHEAD__ count must be non-zero.
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fsr-oh-red-"));
  const { f, dir } = fakeSuite(
    'echo "__OVERHEAD__ lock_overhead_ms=42 partial=1"\n' +
      'echo "__OVERHEAD__ serial_phase_ms=639986 partial=1" >&2\n' +
      'echo "__OVERHEAD__ lowconc_phase_ms=271616 partial=1" >&2\n' +
      'echo "not ok 1 - boom"\n' +
      "sleep 5\n",
  );
  try {
    const child = runRunner({ root, command: `bash ${f}`, env: { QUAY_TEST_RED_GRACE_MS: "300", QUAY_TEST_KILL_ON_RED: "1" } });
    const { code } = await waitExit(child);
    assert.notEqual(code, 0, "runner exits non-zero on the red");
    const s = readState(root);
    assert.equal(s.state, "red", "the failure flipped red");
    const log = read(path.join(root, ".quay", "full-suite.log"));
    // The red round's phase decomposition is present DESPITE the kill — the whole point of AC2/AC3.
    assert.match(log, /__OVERHEAD__ lock_overhead_ms=42 partial=1/, "stderr partial line reached the archived log");
    assert.match(log, /__OVERHEAD__ serial_phase_ms=639986 partial=1/, "completed serial phase present on the red round");
    assert.match(log, /__OVERHEAD__ lowconc_phase_ms=271616 partial=1/, "completed lowconc phase present on the red round");
    assert.ok((log.match(/__OVERHEAD__/g) || []).length >= 3, "the red round's __OVERHEAD__ count is non-zero");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("AC5 e2e — a `tmux-leak-scan: FAIL` residual line (candidate C) flips red with failures non-empty (leak is a real residual)", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fsr-leak-"));
  // Candidate C merge semantics: the suite-tail leak scan reports a residual to the stream
  // (unconditional, no `&&` short-circuit in test.sh); the runner must recognize that FAIL line
  // as a REAL failure (not swallow it into the failures=[] catch-all).
  const { f, dir } = fakeSuite(
    'echo "tmux-leak-scan: FAIL — NEW residual test tmux servers/dirs after the run (delta vs the before-run snapshot; prefixes: skv-|session-liveness-|ol-tok-|enter-repro-):" >&2\nexit 1',
  );
  try {
    const child = runRunner({ root, command: `bash ${f}` });
    const { code } = await waitExit(child);
    assert.equal(code, 1, "runner exits 1 on red");
    const s = readState(root);
    assert.equal(s.state, "red", "tmux-leak-scan FAIL flips state to red (candidate C — leak is a real residual)");
    assert.equal(s.reason, "failed");
    assert.ok(redPayload(s).length >= 1, `the red payload carries the leak-scan residual (AC5); got ${JSON.stringify(s)}`);
    assert.match(redPayload(s)[0].line, /tmux-leak-scan: FAIL/, "the leak-scan FAIL line is the recorded failure");
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

test("AC3 — the inner stop-condition reads the outer suite-state; the inner doc has ZERO scripts/test.sh self-run literal", () => {
  const inner = read(INNER_TICK);
  // Inner reads the suite-state file and its `state` field (running/green => proceed, red => stop).
  assert.ok(inner.includes(".quay/full-suite-state.json"), "inner doc reads .quay/full-suite-state.json");
  assert.ok(inner.includes("`state`"), "inner doc reads the `state` field");
  assert.ok(inner.includes("running"), "inner doc handles running");
  assert.ok(inner.includes("green"), "inner doc handles green");
  assert.ok(inner.includes("red"), "inner doc handles red");
  // DoD grep: inner side has NO full-suite self-run literal.
  assert.ok(
    !inner.includes("scripts/test.sh"),
    "inner doc has NO scripts/test.sh literal (inner 零全量套件自跑 — DoD grep proof)",
  );
});

test("AC4 — the red-window ruling is explicit in the loop docs: RED => stop dispatch + hold fan-in", () => {
  const outer = read(OUTER_TICK);
  const inner = read(INNER_TICK);
  // The red state IS the stop-dispatch signal (outer writes it via the runner; inner reads it).
  assert.ok(outer.includes("stop-dispatch 信号"), "outer doc names the stop-dispatch signal (AC4)");
  assert.ok(outer.includes("红窗分诊"), "outer doc has the red-window triage section (AC4)");
  // GREEN/RUNNING => optimistic merge/dispatch (the point of eliminating the sync point).
  assert.ok(inner.includes("RUNNING 不等套件"), "inner doc proceeds on RUNNING (optimistic, AC4)");
  // RED => stop new dispatch AND hold completed-agent fan-in.
  assert.ok(
    inner.includes("暂缓已完成 agent 的 fan-in"),
    "inner doc holds fan-in on red (AC4) — only stopping dispatch lets a red tree keep accumulating",
  );
});

test("AC5 — the >=3min/<3min threshold rule + durationMs measurement hook are in both loop docs", () => {
  for (const [name, doc] of [
    ["outer", read(OUTER_TICK)],
    ["inner", read(INNER_TICK)],
  ]) {
    assert.ok(doc.includes("3 分钟"), `${name} doc has the 3-minute threshold`);
    assert.ok(doc.includes("durationMs"), `${name} doc names durationMs as the measurement hook`);
  }
});

test("AC7 — the three batch-eliminating blocks (a/b/c) are cross-annotated in the closure-sync task and loop docs", () => {
  const closure = read(CLOSURE_TASK);
  assert.ok(
    closure.includes("gap-full-suite-belongs-to-outer-background-above-3-min"),
    "closure-sync task names the (a) suite block (cross-annotation)",
  );
  assert.ok(
    closure.includes(CLOSURE_DECOMP_TASK_ID),
    "closure-sync task names the (c) AC/evidence block",
  );
  for (const [name, doc] of [
    ["outer", read(OUTER_TICK)],
    ["inner", read(INNER_TICK)],
  ]) {
    assert.ok(
      doc.includes(CLOSURE_DECOMP_TASK_ID),
      `${name} loop doc references the (c) closure-decomposition task id (AC7)`,
    );
  }
});

// ── Contract invoke (gap-full-suite-runner-marks-test-sh-gate-wait-as-failed) ──────────
// --wait-check is the ABORT-side twin of --fail-fast-check: it proves the gate-WAIT ⇒ aborted ⇒
// NO-stop-dispatch chain end-to-end via a runnable CLI control (the Contract's `measure` surface).

function runCli(script, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--no-warnings", "--experimental-strip-types", script, ...args], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "";
    let err = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.once("error", reject);
    child.once("exit", (code) => resolve({ code, out, err }));
  });
}

test("AC1 Contract invoke — `full-suite-runner.ts --wait-check` proves: test.sh gate-WAIT => red reason=aborted => NO stopSignal", async () => {
  const { code, out, err } = await runCli(RUNNER, ["--wait-check"]);
  assert.equal(code, 0, `--wait-check exits 0 when the ABORT chain works; got ${code}\n${out}\n${err}`);
  assert.match(out, /wait-check OK/, "verification line present");
  assert.match(out, /reason=aborted/, "gate-WAIT is reason=aborted (no correctness conclusion)");
  assert.match(out, /stopSignal=false/, "aborted-red must NOT stop dispatch (AC1)");
  assert.match(out, /SUITE-RED/, "SUITE-RED event still recorded (red noticed, routed by reason)");
});

// ── gap-full-suite-state-red-no-failure-detail-static-check-invisible Contract invoke ───────────────
// --static-check-check is the STATIC-CHECK-side twin of --fail-fast-check (test-failure chain) and
// --wait-check (abort chain): it proves the 20:48Z shape (task-contract-check ratchet violations ⇒
// the suite aborts before tests with violations=N / ceiling=C / newSinceBaseline=K in the log) now
// lands in the state file as machine-readable fields consumers read WITHOUT hand-digging the log.

test("AC2 Contract invoke — `full-suite-runner.ts --static-check-check` proves: static-check violations => red reason=static-check => machine-readable counts + failures[] => stopSignal", async () => {
  const { code, out, err } = await runCli(RUNNER, ["--static-check-check"]);
  assert.equal(code, 0, `--static-check-check exits 0 when the static-check chain works; got ${code}\n${out}\n${err}`);
  assert.match(out, /static-check-check OK/, "verification line present");
  assert.match(out, /reason=static-check/, "reason is static-check (AC3, distinguishable from failed)");
  assert.match(out, /violations=11/, "violation count recorded (AC2)");
  assert.match(out, /ceiling=6/, "ceiling recorded (AC2)");
  assert.match(out, /newSinceBaseline=6/, "new-since-baseline recorded (AC2)");
  assert.match(out, /failures=2/, "failures[] carries the two violation details (AC4 candidate B)");
  assert.match(out, /stopSignal=true/, "static-check red stops dispatch (shared-gate failure)");
});

// ── gap-worktree-scoped-runs-consume-resources-but-produce-no-signal: AC1 scope + AC2 priority ──────

test("AC1 unit — isGitWorktree distinguishes the main repo (false) from a linked worktree (true)", () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), "fsr-wtrepo-u-"));
  const worktree = path.join(os.tmpdir(), `fsr-wt-u-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  try {
    execSync("git init -b main", { cwd: repo, stdio: "ignore" });
    execSync("git config user.email t@example.com", { cwd: repo, stdio: "ignore" });
    execSync("git config user.name t", { cwd: repo, stdio: "ignore" });
    fs.writeFileSync(path.join(repo, "a.txt"), "x");
    execSync("git add a.txt && git commit -m init", { cwd: repo, stdio: "ignore" });
    assert.equal(isGitWorktree(repo), false, "the primary checkout is NOT a worktree");
    assert.equal(isGitWorktree(path.join(repo, "does-not-exist")), false, "a non-git dir is NOT a worktree");
    execSync(`git worktree add -b feature ${worktree}`, { cwd: repo, stdio: "ignore" });
    assert.equal(isGitWorktree(worktree), true, "a linked worktree IS a worktree");
  } finally {
    try {
      execSync(`git worktree remove --force ${worktree}`, { cwd: repo, stdio: "ignore" });
    } catch {
      // worktree may not exist if the test failed early
    }
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test("AC1 — a real git-worktree run writes scope=worktree to its OWN .quay/full-suite-state.json (the observable signal)", async () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), "fsr-wtrepo-"));
  const worktree = path.join(os.tmpdir(), `fsr-wt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  const { f, dir } = fakeSuite(GREEN_SUITE);
  try {
    execSync("git init -b main", { cwd: repo, stdio: "ignore" });
    execSync("git config user.email t@example.com", { cwd: repo, stdio: "ignore" });
    execSync("git config user.name t", { cwd: repo, stdio: "ignore" });
    fs.writeFileSync(path.join(repo, "a.txt"), "x");
    execSync("git add a.txt && git commit -m init", { cwd: repo, stdio: "ignore" });
    execSync(`git worktree add -b feature ${worktree}`, { cwd: repo, stdio: "ignore" });

    const child = runRunner({ root: worktree, command: `bash ${f}`, laneCount: 8 });
    const { code } = await waitExit(child);
    assert.equal(code, 0, `runner exits 0 on green in a worktree, got ${code}`);
    const s = readState(worktree);
    assert.ok(s, "the worktree's own state file is written (AC1 signal — waiters can read it)");
    assert.equal(s.scope, "worktree", "scope tags the worktree-origin suite (deferrable, not the main signal)");
    assert.equal(s.state, "green");
  } finally {
    try {
      execSync(`git worktree remove --force ${worktree}`, { cwd: repo, stdio: "ignore" });
    } catch {
      // worktree may not exist if the test failed early
    }
    fs.rmSync(repo, { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("AC2 — for a MAIN-scope root the runner passes --main-repo-priority: the gate lets the main-repo suite proceed over worktree load (cpu=70 would normally WAIT)", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fsr-ac2p-"));
  const { argsLog } = fakeTestShRecordingArgs(root);
  try {
    // cpu=70 is above the base limit (60) ⇒ WAIT normally. caller_scope=main + worktree_node_tests=6
    // ⇒ the AC2 priority override fires ONLY IF the runner passed --main-repo-priority (it does for a
    // non-worktree root). If the flag were absent the gate would WAIT and the suite would never spawn.
    const child = runRunner({
      root,
      env: {
        QUAY_TEST_SKIP_RESOURCE_GATE: "0",
        RESOURCE_GATE_TEST_CPU_AVG10: "70",
        RESOURCE_GATE_TEST_MEM_AVAIL_MB: "4000",
        RESOURCE_GATE_TEST_CALLER_SCOPE: "main",
        RESOURCE_GATE_TEST_WORKTREE_NODE_TESTS: "6",
      },
    });
    const { code } = await waitExit(child);
    assert.equal(code, 0, `AC2 priority: main-repo suite proceeds over worktree load; got ${code}`);
    assert.equal(readState(root).state, "green");
    assert.ok(fs.existsSync(argsLog), "the suite WAS spawned (priority override let it through)");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("AC2 negative control — a WORKTREE-scope caller is NOT let through the WAIT even when the runner passes the flag (worktree full-suite is deferrable)", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fsr-ac2n-"));
  const { argsLog } = fakeTestShRecordingArgs(root);
  try {
    // Same seams but caller_scope=worktree ⇒ the override requires caller_scope=main ⇒ WAIT stands.
    const child = runRunner({
      root,
      env: {
        QUAY_TEST_SKIP_RESOURCE_GATE: "0",
        RESOURCE_GATE_TEST_CPU_AVG10: "70",
        RESOURCE_GATE_TEST_MEM_AVAIL_MB: "4000",
        RESOURCE_GATE_TEST_CALLER_SCOPE: "worktree",
        RESOURCE_GATE_TEST_WORKTREE_NODE_TESTS: "6",
      },
    });
    const { code } = await waitExit(child);
    assert.notEqual(code, 0, "worktree-scope caller stays WAIT (deferrable — no priority override)");
    assert.ok(!fs.existsSync(argsLog), "the suite was NOT spawned (worktree full-suite yields to the machine)");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// ── GENERATION GUARD (gap-full-suite-state-race-last-write-wins-no-generation-guard) ───────────────
// writeState() was last-write-wins with NO generation check: if two runners overlap briefly (even a
// superseded runner still finishing its cleanup), the older runner's red terminal state could land
// AFTER the newer runner's running write and silently clobber it — the 2026-08-06 06:27 v5 / 06:28 v6
// double-launch incident (stale red from the prior runner overwrote the current running state). The
// fix: every state write carries a per-run `runId`; the initial `running` write ESTABLISHES the
// generation, every later write is GUARDED and dropped if a different run now owns the file. These
// tests construct the race (AC1), prove the read side can distinguish the current round (AC2), and
// prove a single runner's normal writes are unaffected (AC4, negative control).

test("AC1 unit — the generation guard rejects a stale runner's write (stale runId ≠ current runId)", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fsr-guard-"));
  const file = path.join(dir, "full-suite-state.json");
  const iso = () => new Date().toISOString();
  const mk = (state, runId, extra = {}) => ({
    state,
    runId,
    runner: "outer",
    startedAt: iso(),
    finishedAt: null,
    durationMs: null,
    laneCount: 4,
    scope: "main",
    ...extra,
  });
  try {
    // Runner A establishes the generation (its running write).
    fs.writeFileSync(file, JSON.stringify(mk("running", "run-A"), null, 2) + "\n", "utf8");
    // Runner B takes over (its running write is the NEW generation).
    fs.writeFileSync(file, JSON.stringify(mk("running", "run-B"), null, 2) + "\n", "utf8");
    // A's stale terminal write is REFUSED — it must not clobber B's current state.
    writeStateGuarded(file, { ...mk("red", "run-A", { reason: "failed" }) });
    let cur = JSON.parse(fs.readFileSync(file, "utf8"));
    assert.equal(cur.state, "running", "stale red did NOT overwrite the current running state (AC1)");
    assert.equal(cur.runId, "run-B", "the state still belongs to B's generation");
    // B's own terminal write SUCCEEDS — its generation is still current.
    writeStateGuarded(file, { ...mk("green", "run-B", { finishedAt: iso(), durationMs: 1 }) });
    cur = JSON.parse(fs.readFileSync(file, "utf8"));
    assert.equal(cur.state, "green", "the current runner's write lands");
    assert.equal(cur.runId, "run-B");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("AC1 — real two-runner race: a stale runner finishing red does NOT overwrite the newer runner's green", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fsr-race-"));
  const staleStarted = path.join(root, "stale-started");
  // Runner A is the one that will be SUPERSEDED: it runs a slow suite that turns red at the end.
  const { f: staleF, dir: staleDir } = fakeSuite(
    `touch "${staleStarted}"; sleep 3; echo "not ok 1 - stale red (superseded runner)"; exit 1`,
  );
  // Runner B is the CURRENT runner: a fast green suite.
  const { f: freshF, dir: freshDir } = fakeSuite(GREEN_SUITE);
  try {
    // A starts first and establishes the generation.
    const childA = runRunner({ root, command: `bash ${staleF}`, laneCount: 4 });
    await poll(() => fs.existsSync(staleStarted), { timeoutMs: 8000 });
    await poll(() => readState(root)?.state === "running", { timeoutMs: 8000 });
    const runIdA = readState(root).runId;
    assert.ok(runIdA, "runner A's running state carries a runId");

    // B starts LATER and takes over (its running write is the new generation).
    const childB = runRunner({ root, command: `bash ${freshF}`, laneCount: 4 });
    const { code: codeB } = await waitExit(childB);
    assert.equal(codeB, 0, "the fresh runner exits 0 (green)");
    const afterB = readState(root);
    assert.equal(afterB.state, "green", "B's green is the current state");
    assert.ok(afterB.runId && afterB.runId !== runIdA, "B is a NEW generation (different runId)");
    const runIdB = afterB.runId;

    // A finishes RED — its stale red write must be dropped by the guard.
    const { code: codeA } = await waitExit(childA);
    assert.equal(codeA, 1, "the stale runner exits 1 (its suite was red)");

    const finalState = readState(root);
    assert.equal(finalState.state, "green", "the stale red did NOT overwrite the newer runner's green (AC1 two-runner race)");
    assert.equal(finalState.runId, runIdB, "the state still belongs to B's generation");
    assert.notEqual(finalState.runId, runIdA, "A's stale runId is gone from the state");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(staleDir, { recursive: true, force: true });
    fs.rmSync(freshDir, { recursive: true, force: true });
  }
});

test("AC2 — the read side can tell 'is this red/green the current round' by its runId", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fsr-ac2-"));
  const file = path.join(dir, "full-suite-state.json");
  const iso = () => new Date().toISOString();
  const mk = (state, runId, extra = {}) => ({
    state,
    runId,
    runner: "outer",
    startedAt: iso(),
    finishedAt: null,
    durationMs: null,
    laneCount: 4,
    scope: "main",
    ...extra,
  });
  try {
    // The CURRENT round is round-B (the newest runner established it).
    fs.writeFileSync(file, JSON.stringify(mk("running", "round-B"), null, 2) + "\n", "utf8");
    // A stale runner (round-A) attempts its red — the guard drops it.
    writeStateGuarded(file, { ...mk("red", "round-A", { reason: "failed" }) });
    // A reader can verify the state on disk is CURRENT: its runId == the round it is waiting on.
    const waitingOnRound = "round-B"; // what the dispatch site observed at round start
    assert.equal(
      readStateRunId(file),
      waitingOnRound,
      "the state on disk carries the CURRENT round's runId — a reader can distinguish current vs stale (AC2)",
    );
    assert.notEqual(readStateRunId(file), "round-A", "the stale round's write never landed");
    // The current round's own terminal write still lands and reads back as the current round.
    writeStateGuarded(file, { ...mk("green", "round-B", { finishedAt: iso(), durationMs: 1 }) });
    assert.equal(readStateRunId(file), "round-B");
    assert.equal(JSON.parse(fs.readFileSync(file, "utf8")).state, "green");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("AC4 — negative control: a single runner's normal writes are unaffected by the guard", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fsr-ac4-"));
  const { f, dir } = fakeSuite(GREEN_SUITE);
  try {
    const child = runRunner({ root, command: `bash ${f}`, laneCount: 8 });
    const { code } = await waitExit(child);
    assert.equal(code, 0, "single runner still exits 0 on green");
    const s = readState(root);
    assert.equal(s.state, "green", "single-runner terminal write lands normally (AC4)");
    const runId = s.runId;
    assert.ok(runId, "runId present on the single-runner state");
    // read-side consistency: the state's runId matches the current round (nothing was rejected)
    assert.equal(readStateRunId(statePath(root)), runId, "read-side sees the same single generation");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("AC4 — a write over a legacy state (no runId on disk) is NOT blocked (fail-open, no conflict)", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fsr-ac4l-"));
  const file = path.join(dir, "full-suite-state.json");
  const iso = () => new Date().toISOString();
  try {
    // legacy state written before the generation guard existed: no runId field.
    fs.writeFileSync(
      file,
      JSON.stringify(
        { state: "green", runner: "outer", startedAt: iso(), finishedAt: iso(), durationMs: 1, laneCount: 8, scope: "main" },
        null,
        2,
      ) + "\n",
      "utf8",
    );
    // A new run's terminal write is not blocked — a legacy file has no generation to protect.
    writeStateGuarded(file, {
      state: "red",
      reason: "failed",
      runId: "run-1",
      runner: "outer",
      startedAt: iso(),
      finishedAt: iso(),
      durationMs: 1,
      laneCount: 4,
      scope: "main",
    });
    const cur = JSON.parse(fs.readFileSync(file, "utf8"));
    assert.equal(cur.state, "red", "a run writing over a legacy state is not blocked (fail-open, AC4)");
    assert.equal(cur.runId, "run-1", "the new run's generation is established");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
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
    "MemoryMax=6G",
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
      assert.equal(s.systemdRun.memoryMax, "6G");
      assert.equal(s.systemdRun.cpuQuota, "");
      assert.equal(s.systemdRun.tasksMax, "");
      // AC1 observable — the applied cgroup attributes (systemctl --user show) land in the state dir
      const evidence = path.join(root, ".quay", "suite-cgroup-evidence.txt");
      await poll(() => fs.existsSync(evidence), { timeoutMs: 10_000 });
      const txt = fs.readFileSync(evidence, "utf8");
      assert.match(txt, /scope_unit=run-[a-z0-9]+\.scope/, "the transient scope unit name is recorded (systemd names it run-<id>.scope — cgroup-derived)");
      assert.match(txt, /MemoryMax=6442450944/, "MemoryMax=6G applied (bytes)");
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

// ── AC6: runner-died terminal state (gap-full-suite-state-red-no-failure-detail-static-check-invisible) ──

test("AC6 — every state write carries the runner PID (the crash-watchdog's liveness anchor)", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fsr-pid-"));
  const { f, dir } = fakeSuite(GREEN_SUITE);
  try {
    const child = runRunner({ root, command: `bash ${f}`, laneCount: 8 });
    const { code } = await waitExit(child);
    assert.equal(code, 0, "runner exits 0 on green");
    const s = readState(root);
    assert.equal(s.state, "green");
    assert.equal(typeof s.pid, "number", "the state carries the runner PID (AC6)");
    assert.ok(Number.isInteger(s.pid) && s.pid > 0, "pid is a positive integer");
    assert.equal(s.pid, child.pid, "pid is the RUNNER process's pid — the watchdog's liveness anchor");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("AC6 — a runner that dies mid-run from an uncaughtException writes state=red reason=crashed (never stuck at running)", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fsr-crash-"));
  // The fake suite BLOCKS (sleep 3) so the child CANNOT close before the crash seam fires — a fast
  // suite would let the runner reach its green verdict and remove the crash handlers first (the
  // flake: under load the child's close raced the 30ms seam and the runner exited 0/green).
  const { f, dir } = fakeSuite('echo "running"; sleep 3; exit 0');
  try {
    // QUAY_TEST_CRASH_AFTER_RUNNING is a hermetic test seam: it throws an uncaught exception ~30ms
    // after the `running` write, exercising the AC6 in-process crash-terminal path deterministically.
    const child = runRunner({
      root,
      command: `bash ${f}`,
      laneCount: 8,
      env: { QUAY_TEST_CRASH_AFTER_RUNNING: "1" },
    });
    const { code } = await waitExit(child);
    assert.equal(code, 1, "a crashed runner exits 1");
    const s = readState(root);
    assert.equal(s.state, "red", "the runner died -> the state is terminal red, NOT running (AC6)");
    assert.equal(s.reason, "crashed", "the terminal reason is crashed (AC6) — distinguishable from aborted/failed");
    assert.equal(typeof s.pid, "number", "the crashed state still carries the runner pid");
    assert.ok(s.finishedAt !== null && s.finishedAt !== undefined, "crashed state has a finishedAt (terminal, not early)");
    assert.equal(typeof s.durationMs, "number", "crashed state has a durationMs");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

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

test("AC1/AC3 — the default run passes HOST-READ phase concurrency (os.availableParallelism ÷ slots ÷ concurrent-phase-count) to the child test.sh", async () => {
  // gap-ac44-concurrent-phases-read-host-parallelism AC1/AC3 + gap-single-flight-lock-2-slot-concurrent-
  // suites AC2 + gap-lane-formula-ignores-phase-overlap-concurrency AC1/AC3: the phase-concurrency
  // defaults are host-read (os.availableParallelism()) DIVIDED by the concurrent-suite slot count S AND
  // by the concurrent-PHASE count P (2 when QUAY_PHASE_OVERLAP is on — serial+lowconc run in parallel —
  // 1 when off = sequential, the pre-overlap budget). RESOURCE_GATE_NPROC / QUAY_MAX_CONCURRENT_SUITES /
  // QUAY_PHASE_OVERLAP are the deterministic seams: nproc=7 ⇒ overlap ON floor(7/(S×2)), OFF floor(7/S).
  // AC3 negative control: overlap OFF keeps the old floor(7/S) values (7/3), only the ON path halves.
  for (const [overlap, slots, serial, lowconc] of [
    ["1", "1", "3", "3"], // overlap ON ⇒ P=2: floor(7/(1×2))=3
    ["1", "2", "1", "1"], // floor(7/(2×2))=1
    ["0", "1", "7", "7"], // overlap OFF ⇒ P=1: floor(7/1)=7 (unchanged)
    ["0", "2", "3", "3"], // floor(7/2)=3 (unchanged)
  ]) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "fsr-phaseenv-default-"));
    const { envLog } = fakeTestShRecordingPhaseEnv(root);
    try {
      const child = runRunner({ root, laneCount: 4, env: { RESOURCE_GATE_NPROC: "7", QUAY_MAX_CONCURRENT_SUITES: slots, QUAY_PHASE_OVERLAP: overlap } });
      const { code } = await waitExit(child);
      assert.equal(code, 0, `runner exits 0 on green (slots=${slots}, overlap=${overlap}), got ${code}`);
      await poll(() => fs.existsSync(envLog));
      const line = fs.readFileSync(envLog, "utf8").trim();
      assert.equal(line, `SERIAL=${serial} LOWCONC=${lowconc}`, `host-read defaults ÷ slots ÷ phases (nproc=7, slots=${slots}, overlap=${overlap} → ${serial}/${lowconc}), got: ${line}`);
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

test("gap-test-detail-load-timeseries — the runner spawns a load sampler that writes a per-run timeseries and stops when the suite ends", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fsr-load-"));
  const { f, dir } = fakeSuite(
    'sleep 1.5\n' +
      'echo "# tests 1"\n' +
      'echo "# pass 1"\n' +
      'echo "# fail 0"\n' +
      'echo "# cancelled 0"\n' +
      "exit 0",
  );
  const loadDir = path.join(root, ".quay");
  const loadFiles = () => {
    try {
      return fs.readdirSync(loadDir).filter((n) => n.startsWith("suite-load-") && n.endsWith(".jsonl"));
    } catch {
      return [];
    }
  };
  try {
    const child = runRunner({ root, command: `bash ${f}`, laneCount: 2, env: { QUAY_SUITE_LOAD_SAMPLER_INTERVAL: "0.2" } });

    // Wait (bounded) for the sampler to write its first sample while the run is in flight.
    let name = null;
    let lines = [];
    const deadline = Date.now() + 20_000;
    while (Date.now() < deadline) {
      const files = loadFiles();
      if (files.length > 0) {
        name = files[0];
        lines = fs.readFileSync(path.join(loadDir, name), "utf8").trim().split("\n").filter(Boolean);
        if (lines.length >= 1) break;
      }
      await new Promise((r) => setTimeout(r, 50));
    }
    assert.ok(name, "the sampler wrote .quay/suite-load-<runId>.jsonl during the run");
    assert.ok(lines.length >= 1, `the timeseries has >=1 sample (got ${lines.length})`);

    for (const line of lines) {
      const o = JSON.parse(line);
      assert.equal(typeof o.t, "number", "every sample carries a numeric timestamp");
      assert.ok("loadavg" in o, "every sample carries loadavg");
      assert.ok("cpu_stall" in o, "every sample carries cpu_stall");
      assert.ok("mem_avail" in o, "every sample carries mem_avail");
    }

    // The file is keyed by the runner's runId (read from the state the runner wrote).
    const s = readState(root);
    assert.ok(s && typeof s.runId === "string" && s.runId, "state carries the run's runId");
    assert.equal(name, `suite-load-${s.runId}.jsonl`, "timeseries file name = suite-load-<runId>.jsonl");

    // Suite ends → the runner writes a terminal state → the detached sampler stops (never resident).
    await waitExit(child);
    const pidFile = path.join(loadDir, `${name}.pid`);
    assert.ok(fs.existsSync(pidFile), "sampler wrote its pid sidecar");
    const samplerPid = Number(fs.readFileSync(pidFile, "utf8").trim());
    assert.ok(Number.isInteger(samplerPid) && samplerPid > 0, "pid sidecar holds a real pid");

    let gone = false;
    const stopDeadline = Date.now() + 10_000;
    while (Date.now() < stopDeadline) {
      try {
        process.kill(samplerPid, 0);
      } catch {
        gone = true;
        break;
      }
      await new Promise((r) => setTimeout(r, 50));
    }
    assert.ok(gone, "the sampler exited after the suite ended (never a resident idle process)");

    // The timeseries stops growing once sampling stops.
    const countAfter = fs.readFileSync(path.join(loadDir, name), "utf8").trim().split("\n").filter(Boolean).length;
    await new Promise((r) => setTimeout(r, 500));
    const countLater = fs.readFileSync(path.join(loadDir, name), "utf8").trim().split("\n").filter(Boolean).length;
    assert.equal(countLater, countAfter, "the timeseries stops growing once sampling stops");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("gap-suite-load-sampler-orphan-process AC2 — an UNCLEAN host exit (SIGKILL, no terminal state) reaps the sampler via host-death detection", async () => {
  // The state-driven stop only fires when SOMEONE writes a terminal state / removes the state file.
  // A host that dies UNCLEANLY (SIGKILL — uncatchable; worker mid-exit exception; fan-in wrapper
  // killed before its `rm -f`) leaves the state file stuck at "running" and the sampler must still
  // stop. This test drives that branch directly: the host backgrounds the sampler then never writes
  // a terminal state — the host is SIGKILLed, and the sampler must detect the host's death (its
  // ppid changes when the kernel reparents the orphan) and exit on its own.
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fsr-load-orphan-"));
  const stateFile = path.join(root, "sampler.state.json");
  const outFile = path.join(root, "suite-load-orphan.jsonl");
  const samplerPath = path.join(REPO_ROOT, "plugin", "scripts", "suite-load-sampler.ts");
  fs.writeFileSync(stateFile, JSON.stringify({ state: "running" }), "utf8");
  // Host = a bash wrapper that backgrounds the sampler then sleeps, modeling the suite host the
  // sampler must follow. It has NO terminal-state / rm -f step — the unclean-exit branch.
  const host = spawn(
    "bash",
    [
      "-c",
      `node --no-warnings --experimental-strip-types "${samplerPath}" --state-file "${stateFile}" --out-file "${outFile}" --run-id "orphan-test" --interval 0.2 & sleep 60`,
    ],
    { stdio: "ignore", detached: true },
  );
  host.unref();
  const pidFile = `${outFile}.pid`;
  try {
    // Wait (bounded) for the sampler to write its first sample + pid sidecar while the host is alive.
    let samplerPid = 0;
    let lines = [];
    const deadline = Date.now() + 20_000;
    while (Date.now() < deadline) {
      try { lines = fs.readFileSync(outFile, "utf8").trim().split("\n").filter(Boolean); } catch { lines = []; }
      try { samplerPid = Number(fs.readFileSync(pidFile, "utf8").trim()); } catch { samplerPid = 0; }
      if (lines.length >= 1 && samplerPid > 0) break;
      await new Promise((r) => setTimeout(r, 50));
    }
    assert.ok(lines.length >= 1, "the sampler wrote >=1 sample while its host was alive");
    assert.ok(samplerPid > 0, "the sampler wrote its pid sidecar");

    // Unclean host death: SIGKILL the host wrapper (no terminal state, no rm -f). The sampler must
    // detect the host's death (ppid change) and exit on its own — the AC2 orphan-reaping invariant.
    process.kill(host.pid, "SIGKILL");

    let gone = false;
    const stopDeadline = Date.now() + 10_000;
    while (Date.now() < stopDeadline) {
      try { process.kill(samplerPid, 0); } catch { gone = true; break; }
      await new Promise((r) => setTimeout(r, 50));
    }
    assert.ok(gone, "the sampler exited after its host was SIGKILLed (host-death reaping, never an orphan)");

    // The timeseries stops growing once the host is dead (no post-mortem pollution).
    const countAfter = fs.readFileSync(outFile, "utf8").trim().split("\n").filter(Boolean).length;
    await new Promise((r) => setTimeout(r, 500));
    const countLater = fs.readFileSync(outFile, "utf8").trim().split("\n").filter(Boolean).length;
    assert.equal(countLater, countAfter, "the timeseries stops growing once the host is dead");
  } finally {
    try { process.kill(host.pid, "SIGKILL"); } catch { /* already gone */ }
    fs.rmSync(root, { recursive: true, force: true });
  }
});
