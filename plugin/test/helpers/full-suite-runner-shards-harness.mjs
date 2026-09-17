// Shared harness for the full-suite-runner shards (split of full-suite-runner.test.mjs by
// gap-suite-split-15-over-30s-test-files). ONE copy of every depth-0 helper — the shards import the
// names they use; ⛔ no shard re-declares a fixture.
//
// SRC_URL re-establishes the ORIGINAL directory so the moved code's own
// __dirname / import.meta.url-relative paths keep resolving from helpers/.
const SRC_URL = new URL("../full-suite-runner.test.mjs", import.meta.url).href;

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

// full-suite-runner.test.mjs — runner verdict / state machine / red detection / reason axis / kill-hang / control. Split from gap-suite-file-split-two-longest; harness shared via ./helpers/full-suite-runner-harness.mjs.
import { test, after } from "node:test";
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
  extractNotEvaluatedChecker,
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
  SUITE_LOG_NOT_RUN_PREFIX,
  SUITE_LOG_RUN_START_PREFIX,
} from "../../scripts/full-suite-runner.ts";
import { runOnce, classifyFailure, routeRed, shouldStopDispatch, shouldDispatchOnRed } from "../../scripts/suite-state-trigger.ts";

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
  releaseGate,
  runRunner,
  waitExit,
  poll,
  GREEN_SUITE,
} from ".././helpers/full-suite-runner-harness.mjs";

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

// ── gap-shape-assert-share-round: shared GREEN shape round (Tier-2 wall-clock) ────────────────
// Four GREEN-suite tests below each used to pay a FULL runner spawn to assert a SINGLE field of the
// same terminal green round (the exact suite-state shape / the green full-suite.log summary / the
// generation-guard read-back / the runner PID). They now share ONE runner round: a lazily-cached
// promise runs the runner once and exposes the state + log + child to every consumer. The
// assertions are unchanged (AC2: no test is deleted for time) — only the spawn is shared
// (AC1: 4 runRunner spawns → 1).
let _sharedGreenShapePromise = null;

async function sharedGreenShape() {
  if (!_sharedGreenShapePromise) {
    _sharedGreenShapePromise = (async () => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), "fsr-shared-green-"));
      const { f, dir } = fakeSuite(GREEN_SUITE);
      const child = runRunner({ root, command: `bash ${f}`, laneCount: 8 });
      const { code } = await waitExit(child);
      assert.equal(code, 0, "shared green run exits 0");
      return {
        root,
        dir,
        child,
        s: readState(root),
        log: fs.readFileSync(path.join(root, ".quay", "full-suite.log"), "utf8"),
      };
    })();
  }
  return _sharedGreenShapePromise;
}

// Clean up the shared round's temp root + fake-suite dir once, after all tests (the shared round
// may never have run if a `--test-name-pattern` filtered out every consumer — guard on the promise).
after(async () => {
  if (_sharedGreenShapePromise) {
    try {
      const g = await _sharedGreenShapePromise;
      fs.rmSync(g.root, { recursive: true, force: true });
      fs.rmSync(g.dir, { recursive: true, force: true });
    } catch {
      // the shared run failed; its temp dirs are best-effort
    }
  }
});

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

// 前缀 import 自 writer 模块（⛔ 测试里不另写一份字面量 = 第二个真相源，硬规则 5b）：reader
// （worker-driver.ts）import 的是【同一个】常量，因此「writer 写什么 / reader 认什么」由构造保证一致。
const SUITE_NOT_RUN = SUITE_LOG_NOT_RUN_PREFIX;

const SUITE_RUN_START = SUITE_LOG_RUN_START_PREFIX;

export { CLOSURE_DECOMP_TASK_ID, CLOSURE_TASK, DEFAULT_SYSTEMD_RUN_LIMITS, GREEN_SUITE, INNER_TICK, OUTER_TICK, PhaseDifferentialAccounting, REPO_ROOT, RUNNER, SUITE_LOG_NOT_RUN_PREFIX, SUITE_LOG_RUN_START_PREFIX, SUITE_NOT_RUN, SUITE_RUN_START, SUITE_SLOT_LIB, _sharedGreenShapePromise, after, assert, buildStaticCheckFailures, buildSystemdRunArgv, classifyFailure, concurrentPhaseCount, concurrentSuiteSlots, countHeldSuiteLocks, countRunnerProcesses, defaultLaneCount, detectAssertionSurfaceEdits, effectiveParallelism, execSync, extractFailClosedChecker, extractNotEvaluatedChecker, extractStaticCheckDetail, fakeSuite, fakeTestShRecordingArgs, fs, hostParallelism, isAbortLine, isFailureLine, isGitWorktree, isStateAssertingTestFile, isStaticCheckFailureLine, lastRoundRecord, os, parseCpuStatUsageUsec, parsePressureSomeTotal, parseSystemdBytesToMb, parseSystemdConsumedLine, parseSystemdRunLimits, parseSystemdTimespanToSeconds, path, poll, read, readPhaseCounters, readScopeConsumedLoad, readState, readStateRunId, redPayload, releaseGate, resolveCgroupV2Dir, routeRed, runCli, runOnce, runRunner, segmentFailures, sharedGreenShape, shouldDispatchOnRed, shouldStopDispatch, snapshotAssertionSurface, spawn, spawnSync, spliceConcurrency, statePath, stripConcurrencyFlags, systemdRunAvailable, test, waitExit, writeStateGuarded, yieldedSuiteSlotCount };
