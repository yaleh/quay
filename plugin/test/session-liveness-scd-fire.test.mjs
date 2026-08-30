// @test-group lowconc
// @load-sensitive wall-clock
// KNOWN-LOAD-SENSITIVE (session-liveness SCD family — wall-clock tmux probe + session-liveness.sh
// per-round waits; the adaptive HANG_GUARD_MS floor absorbs load).
// session-liveness-scd-fire.test.mjs — split out of session-liveness.test.mjs
// (gap-suite-split-long-multi-test-files): the AC1/AC4 POSITIVE control — SESSION-DISABLED fires
// when 饱和 && develop 静默 ≥T && 在飞 worktree 集合无变化 && 无活进程 all hold, exactly once per
// disabled spell (edge-trigger). The test body is byte-identical to the original; only its file
// placement changed so node:test's file-level concurrency can parallelize the sequential scenarios.
// SPLIT CONCURRENCY SAFETY: this file owns the /tmp prefix "session-liveness-scd-a-" and its
// after() sweeps ONLY it (+ ol-prod-), so it can never delete a sibling file's active probe dir.

import { test, after } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import {
  setProbeTmpPrefix, sessionLivenessAfter, makeHermeticProbe, waitForAlive, spawnMonitor,
  waitForOutput, waitForRounds, HANG_GUARD_MS, tmuxAvailable,
  makeRepoWithDevelop, saturatedTranscript,
} from "./session-liveness-helpers.mjs";

setProbeTmpPrefix("session-liveness-scd-a-");

after(() => {
  sessionLivenessAfter("session-liveness-scd-a-", "ol-prod-");
});

test("AC1/AC4 — SESSION-DISABLED fires when 饱和 && develop 静默 ≥T && 在飞 worktree 集合无变化 && 无活进程 (all four hold); exactly one emission per spell (edge-trigger)", { skip: tmuxAvailable ? false : "tmux not installed" }, async () => {
  const p = makeHermeticProbe("ol-scd-a");
  const repo = path.join(p.tmp, "repo");
  try {
    makeRepoWithDevelop(repo, { backdateMin: 60 });   // develop silent ≥ default T=10
    const satX = saturatedTranscript(p, "sat");
    assert.ok(await waitForAlive(p.env, p.session), "probe must be alive");
    const mon = spawnMonitor(p.env, `scd-a ${repo} ${p.session}`, { transcripts: `scd-a ${satX}` });
    try {
      // Round 1 has no worktree baseline → hold; round 2 (stable empty change) → emit.
      assert.ok(await waitForOutput(mon, /SESSION-DISABLED scd-a/, 10000),
        `AC1: all-three composite MUST fire SESSION-DISABLED:\n${mon.output()}`);
      // AC3: the event states the disabled assertion (失能), not merely 饱和.
      assert.ok(/失能|disabled/.test(mon.output()),
        `SESSION-DISABLED must state the disabled assertion:\n${mon.output()}`);
      // AC4 edge: exactly one emission; keep running ≥3 more rounds and confirm no re-emit.
      assert.ok(await waitForRounds(mon, 3, HANG_GUARD_MS),
        `monitor must keep running ≥3 rounds for the no-re-emit check:\n${mon.output()}`);
      const emits = (mon.output().match(/SESSION-DISABLED scd-a/g) || []).length;
      assert.equal(emits, 1,
        `AC4: exactly one SESSION-DISABLED per disabled spell, got ${emits}:\n${mon.output()}`);
    } finally {
      mon.child.kill("SIGKILL"); mon.cleanup();
    }
  } finally {
    p.cleanup();
  }
});
