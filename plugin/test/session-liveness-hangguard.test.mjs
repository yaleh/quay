// @test-group engine
// @load-sensitive wall-clock
// KNOWN-LOAD-SENSITIVE (session-liveness family — this test DELIBERATELY saturates all cores to
// prove the monitor survives it; the adaptive HANG_GUARD_MS floor reads availableParallelism()).
// session-liveness-hangguard.test.mjs — split out of session-liveness.test.mjs
// (gap-suite-split-long-multi-test-files): the AC2 NEGATIVE control for the hangguard fix — under
// availableParallelism()-way CPU saturation the monitor still reaches 4 rounds within the adaptive
// HANG_GUARD_MS (no false hang). Test body byte-identical to the original.
// SPLIT CONCURRENCY SAFETY: this file owns the /tmp prefix "session-liveness-hang-a-" and its
// after() sweeps ONLY it (+ ol-prod-), so it can never delete a sibling file's active probe dir.

import { test, after } from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import { spawn } from "node:child_process";
import {
  setProbeTmpPrefix, sessionLivenessAfter, makeHermeticProbe, waitForAlive, spawnMonitor,
  waitForRounds, HANG_GUARD_MS, tmuxAvailable,
} from "./session-liveness-helpers.mjs";

setProbeTmpPrefix("session-liveness-hang-a-");

after(() => {
  sessionLivenessAfter("session-liveness-hang-a-", "ol-prod-");
});

/** 每个核心一个忙等进程（bounded deadline 自灭），返回句柄数组供 finally 强杀。 */
function spawnCpuBurners(n, ms = 180_000) {
  const burners = [];
  for (let i = 0; i < n; i++) {
    burners.push(spawn(process.execPath, ["-e", `const e=Date.now()+${ms};while(Date.now()<e){}`], { stdio: "ignore" }));
  }
  return burners;
}
function killCpuBurners(burners) {
  for (const b of burners) { try { b.kill("SIGKILL"); } catch { /* already dead */ } }
}

test("AC2 负控制 — availableParallelism() 并发 CPU 饱和时监视器在自适应 HANG_GUARD_MS 内跑完 4 轮（不误判 hang，真实输出）", { skip: tmuxAvailable ? false : "tmux not installed" }, async () => {
  const p = makeHermeticProbe("ol-hang-a");
  const burners = spawnCpuBurners(os.availableParallelism());
  try {
    assert.ok(await waitForAlive(p.env, p.session), "probe must be alive");
    const mon = spawnMonitor(p.env, `hang-a /tmp ${p.session}`, { interval: 1 });
    try {
      assert.ok(await waitForRounds(mon, 4, HANG_GUARD_MS),
        `under ${burners.length}-way CPU saturation the monitor MUST reach 4 rounds within the adaptive HANG_GUARD_MS (${HANG_GUARD_MS}ms) — no false hang:\n${mon.output()}`);
    } finally {
      mon.child.kill("SIGKILL"); mon.cleanup();
    }
  } finally {
    killCpuBurners(burners);
    p.cleanup();
  }
});
