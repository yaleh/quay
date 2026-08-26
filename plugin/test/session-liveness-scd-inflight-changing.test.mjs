// @test-group engine
// @load-sensitive wall-clock
// KNOWN-LOAD-SENSITIVE (session-liveness SCD family — wall-clock tmux probe + session-liveness.sh
// per-round waits; the adaptive HANG_GUARD_MS floor absorbs load).
// session-liveness-scd-inflight-changing.test.mjs — split out of session-liveness.test.mjs
// (gap-suite-split-long-multi-test-files): the AC3 NEGATIVE control — saturated + silent but the
// in-flight worktree set changes every round ⇒ MUST NOT emit. Test body byte-identical.
// SPLIT CONCURRENCY SAFETY: this file owns the /tmp prefix "session-liveness-scd-c-" and its
// after() sweeps ONLY it (+ ol-prod-), so it can never delete a sibling file's active probe dir.

import { test, after } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import {
  setProbeTmpPrefix, sessionLivenessAfter, makeHermeticProbe, waitForAlive, spawnMonitor,
  waitForRounds, HANG_GUARD_MS, tmuxAvailable,
  makeRepoWithDevelop, addWorktree, removeWorktrees, saturatedTranscript,
} from "./session-liveness-helpers.mjs";

setProbeTmpPrefix("session-liveness-scd-c-");

after(() => {
  sessionLivenessAfter("session-liveness-scd-c-", "ol-prod-");
});

test("AC3 负控制 — 饱和且静默但在飞变 ⇒ 不发 (in-flight worktree set changes every round)", { skip: tmuxAvailable ? false : "tmux not installed" }, async () => {
  const p = makeHermeticProbe("ol-scd-c");
  const repo = path.join(p.tmp, "repo");
  const wt1 = path.join(p.tmp, "wt1");
  const wt2 = path.join(p.tmp, "wt2");
  const wt3 = path.join(p.tmp, "wt3");
  const wt4 = path.join(p.tmp, "wt4");
  try {
    makeRepoWithDevelop(repo, { backdateMin: 60 });   // develop silent
    addWorktree(repo, wt1, "wt-1");                    // in-flight set is non-empty at mount
    const satX = saturatedTranscript(p, "sat");
    assert.ok(await waitForAlive(p.env, p.session), "probe must be alive");
    // INTERVAL=2 so each waitForRounds leaves a ≥2s window to add the next worktree before the
    // next round reads the set — the set CHANGES every round, so sub-condition ③ must stay false.
    const mon = spawnMonitor(p.env, `scd-c ${repo} ${p.session}`,
      { transcripts: `scd-c ${satX}`, interval: 2 });
    try {
      assert.ok(await waitForRounds(mon, 1, HANG_GUARD_MS), `round 1 must complete:\n${mon.output()}`);
      addWorktree(repo, wt2, "wt-2");
      assert.ok(await waitForRounds(mon, 2, HANG_GUARD_MS), `round 2 must complete:\n${mon.output()}`);
      addWorktree(repo, wt3, "wt-3");
      assert.ok(await waitForRounds(mon, 3, HANG_GUARD_MS), `round 3 must complete:\n${mon.output()}`);
      addWorktree(repo, wt4, "wt-4");
      assert.ok(await waitForRounds(mon, 4, HANG_GUARD_MS), `round 4 must complete:\n${mon.output()}`);
      assert.ok(!/SESSION-DISABLED scd-c/.test(mon.output()),
        `saturated+silent but in-flight set changing MUST NOT emit SESSION-DISABLED:\n${mon.output()}`);
    } finally {
      mon.child.kill("SIGKILL"); mon.cleanup();
      removeWorktrees(repo, [wt1, wt2, wt3, wt4]);
    }
  } finally {
    p.cleanup();
  }
});
