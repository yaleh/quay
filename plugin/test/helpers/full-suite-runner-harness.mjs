// full-suite-runner-harness.mjs — shared test harness for the split full-suite-runner test files
// (gap-suite-file-split-two-longest). Single source (⛔ 多份拆分文件各复制一份) for the runner-spawn
// helpers that every full-suite-runner*.test.mjs file depends on: the hermetic temp-root fake suite +
// the real full-suite-runner.ts spawn + bounded waitExit/poll + suite-state readers + the GREEN_SUITE
// fixture. Each split file imports this module instead of re-declaring the harness.
//
// The REPO_ROOT below is derived from THIS file's location (plugin/test/helpers/ → ../../.. = repo
// root), NOT from the importing test file — so the constants resolve correctly regardless of which
// test file imports them.

import { after } from "node:test";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(__dirname, "../../..");
export const RUNNER = path.join(REPO_ROOT, "plugin/scripts/full-suite-runner.ts");
export const SUITE_SLOT_LIB = path.join(REPO_ROOT, "plugin/scripts/suite-slot-lib.sh");
export const OUTER_TICK = path.join(REPO_ROOT, "plugin/loop/orchestrator-loop-tick.md");
export const INNER_TICK = path.join(REPO_ROOT, "plugin/loop/fast-mode-loop-tick.md");

// Hermetic seam (QUAY_TEST_SKIP_PRE_SUITE_REAPER=1): this family's fake-suite runner runs must NOT
// trigger full-suite-runner.ts's pre-suite GLOBAL orphan-probe sweep. That sweep kills ANY
// claude-probe with a deleted cwd on the machine — including a CONCURRENT test's live orphan probe.
// These hermetic tests measure no claude-process-count, so the sweep is pure cross-test hazard here;
// the production path (no env) is unchanged. Same pattern as QUAY_TEST_SKIP_RESOURCE_GATE.
process.env.QUAY_TEST_SKIP_PRE_SUITE_REAPER = "1";

export const CLOSURE_TASK = path.join(
  REPO_ROOT,
  "tasks/gap-closure-sync-is-the-true-batch-boundary-move-bookkeeping-to-outer-async.md",
);
export const CLOSURE_DECOMP_TASK_ID = "gap-closure-could-not-run-in-task-grant-self-touches-for-ac-and-invoke-evidence";

/** Hermetic lock dirs created by runRunner (gap-suite-slot-ssot-i5-false-positive) — cleaned after the
 *  whole file so they never leak into /tmp NOR into a git-repo `root` (an untracked file in `root`
 *  would flip the treeDirty round-START annotation, breaking the CLEAN-tree test). */
const _runnerLockDirs = [];
after(() => {
  for (const d of _runnerLockDirs) { try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* best-effort */ } }
});

export function read(file) {
  return fs.readFileSync(file, "utf8");
}

export function statePath(root) {
  return path.join(root, ".quay", "full-suite-state.json");
}

export function readState(root) {
  const p = statePath(root);
  return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, "utf8")) : null;
}

/** gap-streaming-red-cascade-amplifies-failures-array AC1/AC2 — the FULL failure payload of a red
 *  state: `failures[]` (main set) + `unattributed[]` (no-file real failures, segmented OUT of
 *  failures[]). A red verdict carries a non-empty payload in at least one of the two — the
 *  gap-suite-red-verdict-carries-empty-failures-payload invariant holds over the SUM. */
export function redPayload(s) {
  return (s && (s.failures || [])).concat(s && s.unattributed ? s.unattributed : []);
}

/** Read the LAST verification-round.jsonl record (null when the ledger is absent/empty). */
export function lastRoundRecord(root) {
  const f = path.join(root, ".quay", "verification-round.jsonl");
  if (!fs.existsSync(f)) return null;
  const lines = fs.readFileSync(f, "utf8").trim().split("\n").filter(Boolean);
  return lines.length ? JSON.parse(lines[lines.length - 1]) : null;
}

/** Write a fake "test suite" bash script; returns { dir, f }. */
export function fakeSuite(scriptBody) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fsr-fake-"));
  const f = path.join(dir, "fake-suite.sh");
  fs.writeFileSync(f, "#!/usr/bin/env bash\n" + scriptBody + "\n", { mode: 0o755 });
  return { dir, f };
}

/** gap-fake-suite-release-gate-sleep-zero — a RELEASE GATE replaces a fake suite's fixed `sleep N`
 *  in-flight window: `wait` is a bash snippet that blocks (polling) until the file `release` exists,
 *  and the test touches `release` the moment it has observed the intermediate state — so the runner
 *  never waits out a fixed N seconds. Returns { release, wait }; embed `wait` in the suite script where
 *  `sleep N` used to be, and `fs.writeFileSync(release, "go")` to let the suite proceed. The loop is
 *  bounded (~30s) so a suite leaked by a failed/killed runner exits instead of blocking forever.
 *  (`base` is a temp dir the test already owns/cleans — e.g. `root` — same pattern as the existing
 *  post-failure `marker` file.) */
export function releaseGate(base, tag) {
  const release = path.join(base, `release-${tag}`);
  const wait = `for _i in $(seq 1 600); do [ -e '${release}' ] && break; sleep 0.05; done`;
  return { release, wait };
}

/** Spawn the runner against a temp root with a fake command. */
export function runRunner({ root, command, laneCount, stateDir, runner, buckets, env = {}, serialConcurrency, lowconcConcurrency, runId }) {
  const args = ["--no-warnings", "--experimental-strip-types", RUNNER, "--root", root];
  if (stateDir) args.push("--state-dir", stateDir);
  if (command) args.push("--command", command);
  if (laneCount !== undefined && laneCount !== null) args.push("--lane-count", String(laneCount));
  if (runner !== undefined && runner !== null) args.push("--runner", String(runner));
  if (buckets !== undefined && buckets !== null) args.push("--buckets", String(buckets));
  if (serialConcurrency !== undefined) args.push("--serial-concurrency", String(serialConcurrency));
  if (lowconcConcurrency !== undefined) args.push("--lowconc-concurrency", String(lowconcConcurrency));
  // gap-mechanical-fan-in-per-suite-runid-unified — pass an explicit --run-id (the mechanical fan-in
  // driver's per-suite id) so tests can assert the runner honors it as its canonical runId.
  if (runId !== undefined && runId !== null) args.push("--run-id", String(runId));
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
  // gap-suite-knobs-config-file-priority: hermetic phase-concurrency knobs. The real suite launch
  // (full-suite-runner → test.sh) passes QUAY_SERIAL_CONCURRENCY / QUAY_LOWCONC_CONCURRENCY into the
  // test-file process env; those leak into the nested runner child via `...process.env` and mask the
  // HOST-READ default the AC1/AC3 "default run" test asserts (the runner now reads these env vars
  // directly — config < env < CLI — where the old import-time consts ignored env). Unless a test
  // explicitly provides its own, drop the inherited values so the default-path test stays hermetic.
  if (!("QUAY_SERIAL_CONCURRENCY" in env)) delete mergedEnv.QUAY_SERIAL_CONCURRENCY;
  if (!("QUAY_LOWCONC_CONCURRENCY" in env)) delete mergedEnv.QUAY_LOWCONC_CONCURRENCY;
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
 * The default parameter covers all existing `await waitExit(child)` call sites unchanged.
 */
export function waitExit(child, { timeoutMs = 60_000 } = {}) {
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

export function poll(fn, { timeoutMs = 5000, intervalMs = 30 } = {}) {
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

export const GREEN_SUITE = 'echo "# tests 5"\necho "# pass 5"\necho "# fail 0"\necho "# cancelled 0"\nexit 0';
