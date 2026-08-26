// @test-group engine
// @load-sensitive wall-clock
// KNOWN-LOAD-SENSITIVE (session-liveness SCD family — wall-clock tmux probe + session-liveness.sh
// per-round waits; the adaptive HANG_GUARD_MS floor absorbs load).
// session-liveness-scd-develop-active.test.mjs — split out of session-liveness.test.mjs
// (gap-suite-split-long-multi-test-files): the AC3 NEGATIVE control — saturated but develop has a
// fresh commit < T ⇒ MUST NOT emit SESSION-DISABLED. Test body byte-identical to the original.
// SPLIT CONCURRENCY SAFETY: this file owns the /tmp prefix "session-liveness-scd-b-" and its
// after() sweeps ONLY it (+ ol-prod-), so it can never delete a sibling file's active probe dir.

import { test, after } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import {
  setProbeTmpPrefix, sessionLivenessAfter, makeHermeticProbe, waitForAlive, spawnMonitor,
  waitForRounds, HANG_GUARD_MS, tmuxAvailable,
  makeRepoWithDevelop, saturatedTranscript,
} from "./session-liveness-helpers.mjs";

setProbeTmpPrefix("session-liveness-scd-b-");

after(() => {
  sessionLivenessAfter("session-liveness-scd-b-", "ol-prod-");
});

test("AC3 负控制 — 饱和但 develop 活跃 ⇒ 不发 (saturated but develop has a fresh commit < T)", { skip: tmuxAvailable ? false : "tmux not installed" }, async () => {
  const p = makeHermeticProbe("ol-scd-b");
  const repo = path.join(p.tmp, "repo");
  try {
    makeRepoWithDevelop(repo, { backdateMin: 0 });    // develop commit NOW → active (age < T)
    const satX = saturatedTranscript(p, "sat");
    assert.ok(await waitForAlive(p.env, p.session), "probe must be alive");
    const mon = spawnMonitor(p.env, `scd-b ${repo} ${p.session}`, { transcripts: `scd-b ${satX}` });
    try {
      // ≥4 rounds: were the silence sub-condition wrongly passing, the edge would fire by round 2.
      assert.ok(await waitForRounds(mon, 4, HANG_GUARD_MS),
        `monitor must run ≥4 rounds for the no-emit check:\n${mon.output()}`);
      assert.ok(!/SESSION-DISABLED scd-b/.test(mon.output()),
        `saturated-but-develop-active MUST NOT emit SESSION-DISABLED:\n${mon.output()}`);
    } finally {
      mon.child.kill("SIGKILL"); mon.cleanup();
    }
  } finally {
    p.cleanup();
  }
});
