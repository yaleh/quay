// async-spawn.mjs — promisify child_process.spawn to the spawnSync RESULT contract.
//
// gap-suite-parallel-independent-installs: spawnSync BLOCKS the event loop, so two back-to-back
// `runInit(ws1); runInit(ws2)` in one test are serial no matter what the test runner does —
// node:test's file/describe/test concurrency only applies to async test BODIES awaiting a promise,
// and a spawnSync body never yields. The ONLY place intra-test concurrency can actually take effect
// is two async spawns resolved together (Promise.all). This helper is that seam: spawnAsync resolves
// to the SAME `{status, stdout, stderr}` shape spawnSync returns, so callers keep their assertions
// unchanged. It also records per-spawn wall-clock timings so a test can assert its two installs
// really STARTED in parallel (AC1) rather than silently falling back to serial under a regression.
//
// A helper in plugin/test/helpers/ (the tmp-workspace.mjs cross-package precedent): imported by
// packages/quay/test, no dependency-direction gate.

import { spawn } from "node:child_process";
import assert from "node:assert/strict";

// Per-spawn { startedAt, finishedAt } wall-clock (ms epoch), pushed in COMPLETION order (a faster
// install may finish before a slower sibling that started earlier — order is irrelevant to the
// assertions below, which only compare start gaps and per-install durations).
export const spawnTimings = [];

export function spawnAsync(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    const child = spawn(cmd, args, opts);
    // Force string chunks regardless of whether spawn honors `opts.encoding` — setEncoding is the
    // deterministic path, and it runs synchronously before the first (async) data event.
    if (opts.encoding) {
      if (child.stdout) child.stdout.setEncoding(opts.encoding);
      if (child.stderr) child.stderr.setEncoding(opts.encoding);
    }
    let stdout = "";
    let stderr = "";
    if (child.stdout) child.stdout.on("data", (chunk) => { stdout += chunk; });
    if (child.stderr) child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", (err) => {
      spawnTimings.push({ startedAt, finishedAt: Date.now() });
      reject(err);
    });
    child.on("close", (code) => {
      spawnTimings.push({ startedAt, finishedAt: Date.now() });
      resolve({ status: code, stdout, stderr });
    });
  });
}

// assertParallelLaunches(t0, label) — AC1 of gap-suite-parallel-independent-installs: the spawns
// recorded since index t0 (exactly two, for the ws1/ws2 pair) must have STARTED in parallel — their
// start gap must be strictly less than a single install's duration (the min of the two). A serial
// regression would have gap ≈ one install's duration (the second starts only after the first ends),
// so the same assertion is red under a silent fallback to serial.
export function assertParallelLaunches(t0, label) {
  const timings = spawnTimings.slice(t0);
  assert.equal(timings.length, 2,
    `${label}: exactly two async installs must have been launched (got ${timings.length})`);
  const startGap = Math.abs(timings[1].startedAt - timings[0].startedAt);
  const singleInstall = Math.min(
    timings[0].finishedAt - timings[0].startedAt,
    timings[1].finishedAt - timings[1].startedAt,
  );
  assert.ok(startGap < singleInstall,
    `${label}: the two installs must START in parallel — start gap ${startGap}ms must be < single-install duration ${singleInstall}ms (a serial run has gap ≈ single-install)`);
}
