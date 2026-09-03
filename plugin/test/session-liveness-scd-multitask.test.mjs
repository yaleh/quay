// @test-group serial
// @load-sensitive wall-clock
// @load-sensitive-entry 2026-09-03 wall-clock (real tmux server + claude-probe probes flaky in lowconc — probe establish unstable / starved, reds unrelated fan-in suites); GROUP=serial deliberately
// KNOWN-LOAD-SENSITIVE (session-liveness SCD family — wall-clock tmux probe + session-liveness.sh
// per-round waits; the adaptive HANG_GUARD_MS floor absorbs load).
// session-liveness-scd-multitask.test.mjs — split out of session-liveness.test.mjs
// (gap-suite-split-long-multi-test-files): the AC3 NEGATIVE control — multi-task implementation in
// progress (5 stable worktrees + busy live process, manager 12:16Z replay) ⇒ MUST NOT emit.
// Test body byte-identical to the original.
// SPLIT CONCURRENCY SAFETY: this file owns the /tmp prefix "session-liveness-scd-f-" and its
// after() sweeps ONLY it (+ ol-prod-), so it can never delete a sibling file's active probe dir.

import { test, after } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { spawn } from "node:child_process";
import {
  setProbeTmpPrefix, sessionLivenessAfter, makeHermeticProbe, waitForAlive, spawnMonitor,
  waitForRounds, HANG_GUARD_MS, tmuxAvailable,
  makeRepoWithDevelop, addWorktree, removeWorktrees, saturatedTranscript,
} from "./session-liveness-helpers.mjs";

setProbeTmpPrefix("session-liveness-scd-f-");

after(() => {
  sessionLivenessAfter("session-liveness-scd-f-", "ol-prod-");
});

test("AC3 负控制 — 多任务实现中不报 (manager 12:16Z: 5 worktrees 在飞 + 忙活进程，replay)", { skip: tmuxAvailable ? false : "tmux not installed" }, async () => {
  const p = makeHermeticProbe("ol-scd-f");
  const repo = path.join(p.tmp, "repo");
  const wts = [1, 2, 3, 4, 5].map((i) => path.join(p.tmp, `wt${i}`));
  try {
    makeRepoWithDevelop(repo, { backdateMin: 60 });   // develop silent
    for (const [i, wt] of wts.entries()) addWorktree(repo, wt, `wt-${i + 1}`);  // 5 in-flight, STABLE
    const satX = saturatedTranscript(p, "sat");
    assert.ok(await waitForAlive(p.env, p.session), "probe must be alive");
    const mon = spawnMonitor(p.env, `scd-f ${repo} ${p.session}`, { transcripts: `scd-f ${satX}` });
    const live = spawn("sleep", ["10000"], { cwd: wts[0], stdio: "ignore" });
    try {
      // Round 1 has no baseline (③=0); by round 2 ① && ② && ③ all hold — the OLD composite would
      // emit here; only ④ (busy, live process in wt1) holds it. Run ≥4 rounds to be load-robust.
      assert.ok(await waitForRounds(mon, 4, HANG_GUARD_MS),
        `monitor must run ≥4 rounds for the no-emit check:\n${mon.output()}`);
      assert.ok(!/SESSION-DISABLED scd-f/.test(mon.output()),
        `multi-task implementation in progress (5 stable worktrees + live process) MUST NOT emit SESSION-DISABLED:\n${mon.output()}`);
    } finally {
      live.kill("SIGKILL");
      mon.child.kill("SIGKILL"); mon.cleanup();
      removeWorktrees(repo, wts);
    }
  } finally {
    p.cleanup();
  }
});
