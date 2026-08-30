// @test-group lowconc
// @load-sensitive wall-clock
// KNOWN-LOAD-SENSITIVE (session-liveness SCD family — wall-clock tmux probe + session-liveness.sh
// per-round waits; the adaptive HANG_GUARD_MS floor absorbs load).
// session-liveness-scd-busy.test.mjs — split out of session-liveness.test.mjs
// (gap-suite-split-long-multi-test-files): the 新④ 合取项 (busy-time MUST be false) falsifiability —
// a live process in the linked worktree ⇒ no emit; the process dies (genuinely disabled) ⇒ emit.
// Test body byte-identical to the original.
// SPLIT CONCURRENCY SAFETY: this file owns the /tmp prefix "session-liveness-scd-g-" and its
// after() sweeps ONLY it (+ ol-prod-), so it can never delete a sibling file's active probe dir.

import { test, after } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { spawn } from "node:child_process";
import {
  setProbeTmpPrefix, sessionLivenessAfter, makeHermeticProbe, waitForAlive, spawnMonitor,
  waitForOutput, waitForRounds, HANG_GUARD_MS, tmuxAvailable,
  makeRepoWithDevelop, addWorktree, removeWorktrees, saturatedTranscript,
} from "./session-liveness-helpers.mjs";

setProbeTmpPrefix("session-liveness-scd-g-");

after(() => {
  sessionLivenessAfter("session-liveness-scd-g-", "ol-prod-");
});

test("新④ 能取假 — 忙时 worktree 有活进程 ⇒ 不报 DISABLED；活进程消失（真失能）⇒ 报 (conjunct can take false)", { skip: tmuxAvailable ? false : "tmux not installed" }, async () => {
  const p = makeHermeticProbe("ol-scd-g");
  const repo = path.join(p.tmp, "repo");
  const wt = path.join(p.tmp, "wt1");
  try {
    makeRepoWithDevelop(repo, { backdateMin: 60 });   // develop silent
    addWorktree(repo, wt, "wt-1");                     // stable in-flight linked worktree
    const satX = saturatedTranscript(p, "sat");
    assert.ok(await waitForAlive(p.env, p.session), "probe must be alive");
    const mon = spawnMonitor(p.env, `scd-g ${repo} ${p.session}`, { transcripts: `scd-g ${satX}` });
    const live = spawn("sleep", ["10000"], { cwd: wt, stdio: "ignore" });
    try {
      // busy phase: a live process with cwd inside the linked worktree → ④ takes false → hold.
      // Round 1 has no worktree baseline (③=0); by round 2 ③=1 && ① && ② all hold — WITHOUT ④ the
      // old composite would already emit, so "no emit" is attributable to ④ being false (busy).
      assert.ok(await waitForRounds(mon, 3, HANG_GUARD_MS),
        `monitor must complete busy-phase rounds:\n${mon.output()}`);
      assert.ok(!/SESSION-DISABLED scd-g/.test(mon.output()),
        `busy (live process in linked worktree) MUST NOT emit SESSION-DISABLED — ④ is false:\n${mon.output()}`);
      // true-disabled phase: the worktree process dies → ④ flips true → the composite emits.
      live.kill("SIGKILL");
      assert.ok(await waitForOutput(mon, /SESSION-DISABLED scd-g/, 10000),
        `after the worktree process dies (no longer busy) the disabled composite MUST emit — ④ can take true:\n${mon.output()}`);
    } finally {
      live.kill("SIGKILL");
      mon.child.kill("SIGKILL"); mon.cleanup();
      removeWorktrees(repo, [wt]);
    }
  } finally {
    p.cleanup();
  }
});
