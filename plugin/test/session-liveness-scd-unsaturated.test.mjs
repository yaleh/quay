// @test-group engine
// @load-sensitive wall-clock
// KNOWN-LOAD-SENSITIVE (session-liveness SCD family — wall-clock tmux probe + session-liveness.sh
// per-round waits; the adaptive HANG_GUARD_MS floor absorbs load).
// session-liveness-scd-unsaturated.test.mjs — split out of session-liveness.test.mjs
// (gap-suite-split-long-multi-test-files): the AC1 NEGATIVE control — unsaturated (low cache_read)
// even with silent develop + stable worktrees ⇒ MUST NOT emit. Test body byte-identical.
// SPLIT CONCURRENCY SAFETY: this file owns the /tmp prefix "session-liveness-scd-d-" and its
// after() sweeps ONLY it (+ ol-prod-), so it can never delete a sibling file's active probe dir.

import { test, after } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import {
  setProbeTmpPrefix, sessionLivenessAfter, makeHermeticProbe, waitForAlive, spawnMonitor,
  waitForRounds, HANG_GUARD_MS, tmuxAvailable, writeTranscript,
  assistantUsageRecord, userInputRecord, isoAgo, makeRepoWithDevelop,
} from "./session-liveness-helpers.mjs";

setProbeTmpPrefix("session-liveness-scd-d-");

after(() => {
  sessionLivenessAfter("session-liveness-scd-d-", "ol-prod-");
});

test("AC1 负控制 — 不饱和 ⇒ 不发 (unsaturated, even with silent develop + stable worktrees)", { skip: tmuxAvailable ? false : "tmux not installed" }, async () => {
  const p = makeHermeticProbe("ol-scd-d");
  const repo = path.join(p.tmp, "repo");
  const unsatX = path.join(p.tmp, "unsat.jsonl");
  try {
    makeRepoWithDevelop(repo, { backdateMin: 60 });   // develop silent
    writeTranscript(unsatX, [assistantUsageRecord(isoAgo(0.1), 1000), userInputRecord(isoAgo(0.05))], 1); // low cache → unsaturated
    assert.ok(await waitForAlive(p.env, p.session), "probe must be alive");
    const mon = spawnMonitor(p.env, `scd-d ${repo} ${p.session}`, { transcripts: `scd-d ${unsatX}` });
    try {
      assert.ok(await waitForRounds(mon, 4, HANG_GUARD_MS),
        `monitor must run ≥4 rounds for the no-emit check:\n${mon.output()}`);
      assert.ok(!/SESSION-DISABLED scd-d/.test(mon.output()),
        `unsaturated MUST NOT emit SESSION-DISABLED:\n${mon.output()}`);
    } finally {
      mon.child.kill("SIGKILL"); mon.cleanup();
    }
  } finally {
    p.cleanup();
  }
});
