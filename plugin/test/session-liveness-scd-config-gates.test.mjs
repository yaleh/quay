// @test-group lowconc
// @load-sensitive wall-clock
// KNOWN-LOAD-SENSITIVE (session-liveness SCD family — wall-clock tmux probe + session-liveness.sh
// per-round waits; the adaptive HANG_GUARD_MS floor absorbs load).
// session-liveness-scd-config-gates.test.mjs — split out of session-liveness.test.mjs
// (gap-suite-split-long-multi-test-files): AC2 — SATURATION_SILENCE_MIN is env-configurable (default
// not the forbidden literal 30) and actually gates the composite. Test body byte-identical.
// SPLIT CONCURRENCY SAFETY: this file owns the /tmp prefix "session-liveness-scd-e-" and its
// after() sweeps ONLY it (+ ol-prod-), so it can never delete a sibling file's active probe dir.

import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  SCRIPT, setProbeTmpPrefix, sessionLivenessAfter, makeHermeticProbe, waitForAlive, spawnMonitor,
  waitForOutput, waitForRounds, HANG_GUARD_MS, tmuxAvailable,
  makeRepoWithDevelop, saturatedTranscript,
} from "./session-liveness-helpers.mjs";

setProbeTmpPrefix("session-liveness-scd-e-");

after(() => {
  sessionLivenessAfter("session-liveness-scd-e-", "ol-prod-");
});

test("AC2 — SATURATION_SILENCE_MIN is env-configurable (default not the forbidden literal 30) and actually gates the composite", { skip: tmuxAvailable ? false : "tmux not installed" }, async () => {
  // static: the script reads the env var with a default (same form as SATURATION_TOKENS), and the
  // default is NOT the forbidden literal 30.
  const src = fs.readFileSync(SCRIPT, "utf8");
  assert.match(src, /SATURATION_SILENCE_MIN=\$\{SATURATION_SILENCE_MIN:-[0-9]+\}/,
    "SATURATION_SILENCE_MIN must be env-configurable with a numeric default (same form as SATURATION_TOKENS)");
  assert.ok(!/SATURATION_SILENCE_MIN=\$\{SATURATION_SILENCE_MIN:-30\}/.test(src),
    "the default must NOT be the forbidden literal 30");

  // runtime: a develop commit 2 min old is SILENT under T=1 (emits) but ACTIVE under T=100 (does not).
  const p = makeHermeticProbe("ol-scd-e");
  const repo = path.join(p.tmp, "repo");
  try {
    makeRepoWithDevelop(repo, { backdateMin: 2 });    // develop 2 min old
    const satX = saturatedTranscript(p, "sat");
    assert.ok(await waitForAlive(p.env, p.session), "probe must be alive");
    // (a) T=1: 2min ≥ 1 ⇒ silent ⇒ all three hold ⇒ emit.
    const mon1 = spawnMonitor({ ...p.env, SATURATION_SILENCE_MIN: "1" },
      `scd-e1 ${repo} ${p.session}`, { transcripts: `scd-e1 ${satX}` });
    try {
      assert.ok(await waitForOutput(mon1, /SESSION-DISABLED scd-e1/, 10000),
        `T=1 with a 2min-old develop MUST emit:\n${mon1.output()}`);
    } finally {
      mon1.child.kill("SIGKILL"); mon1.cleanup();
    }
    // (b) T=100: 2min < 100 ⇒ active ⇒ hold (the config value actually gates, not a literal).
    const mon2 = spawnMonitor({ ...p.env, SATURATION_SILENCE_MIN: "100" },
      `scd-e2 ${repo} ${p.session}`, { transcripts: `scd-e2 ${satX}` });
    try {
      assert.ok(await waitForRounds(mon2, 4, HANG_GUARD_MS),
        `monitor must run ≥4 rounds for the no-emit check:\n${mon2.output()}`);
      assert.ok(!/SESSION-DISABLED scd-e2/.test(mon2.output()),
        `T=100 with a 2min-old develop MUST NOT emit (config gates the composite):\n${mon2.output()}`);
    } finally {
      mon2.child.kill("SIGKILL"); mon2.cleanup();
    }
  } finally {
    p.cleanup();
  }
});
