// @test-group lowconc
// @load-sensitive wall-clock
// session-liveness-signals-thresholds-edge.test.mjs — 阈值行为 · 沿/warmup — per-spell 沿 / mount 停滞 / 首轮 warmup
//
// PART OF THE session-liveness test family (split from session-liveness-signals.test.mjs by
// gap-split-session-liveness-signals-unblocks-lowconc, and FURTHER split by
// gap-split-three-phase-floor-files 2026-08-12). This file covers the threshold EDGE behavior:
// AC6/D5 (mount-stalled session reports IDLE after debounce), the per-spell IDLE edge (fires ONCE
// per idle spell, re-arms on a busy spell), and the first-launch-round warmup (nothing reported
// before round 2). The test BODIES are byte-identical to the pre-split file; only their file
// placement changed.
//
// SPLIT CONCURRENCY SAFETY: this file runs as its OWN node process at cc=3. It owns the
// /tmp prefix "session-liveness-sig-e-" — the hermetic probe constructors create dirs under it (via
// setProbeTmpPrefix) and the after() below sweeps ONLY it, so this file can never delete a sibling
// file's active probe dir (each split file owns a DISTINCT prefix — sibling files sweep
// session-liveness-sig-t- / session-liveness-sig-o- only).
//
// KNOWN-LOAD-SENSITIVE (see plugin/loop/fast-mode-loop-tick.md "已知负载敏感族") — this family uses
// real processes + tmux timing; it passes isolated under low load but may fail under concurrent-suite
// load (gap-load-sensitive-session-family-confounds-step-three, 2026-08-04). GROUP NOTE
// (gap-lowconc-group-concurrency-3-for-hermetic-load-sensitive): routed to the `lowconc` group — the
// hermetic-but-load-sensitive phase at concurrency 3.
//
// Run: node --test session-liveness-signals-thresholds-edge.test.mjs   /   scripts/test.sh --group lowconc

import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";
import {
  SCRIPT, tmuxAvailable,
  setProbeTmpPrefix, sweepTmp, reapLiveOwners, tmux, isolateTmuxEnv, isClaudePid,
  paneHasClaudeChild, waitForAlive, makeHermeticProbe,
  spawnMonitor, waitForOutput, waitForRounds, countRounds,
  makePaneBusy, makePaneIdle, makePanePermissionPrompt, startTouchLoop, cleanup,
  userRecord, assistantRecord, apiErrorRecord, isoAgo,
  assistantToolUseRecord, assistantTextRecord, userInputRecord, writeTranscript,
  assistantUsageRecord,
} from "./session-liveness-helpers.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// OWN the /tmp probe prefix for this split file (see SPLIT CONCURRENCY SAFETY):
setProbeTmpPrefix("session-liveness-sig-e-");

// KNOWN-LOAD-SENSITIVE: under suite load a hermetic-probe test can be cancelled mid-run,
// skipping its finally → this file's /tmp dirs leak (server + socket stay alive) and trip the
// suite-tail tmux-leak-scan. reapLiveOwners() FIRST kills this process's OWN still-alive probe
// servers, then sweepTmp removes owner-dead residue. Sweep ONLY this file's own prefixes.
after(() => {
  reapLiveOwners();
  sweepTmp("session-liveness-sig-e-");
});

test("AC6/D5 — a session stalled FROM MOUNT (never observed busy, stale pure-text transcript) reports SESSION-IDLE after the debounce; the SEEN_BUSY gate must not permanently destroy the stall's report right", { skip: tmuxAvailable ? false : "tmux not installed" }, async () => {
  // Reproduction of gap-session-liveness-busy-mask-idle-with-subagents: inner 16 windows were
  // 100% missed because the old report gate `-eq N && SEEN_BUSY==1` gave each stall ONE trigger
  // opportunity — the IDLE_CONSEC==2 round — and when SEEN_BUSY was 0 there (mount-in-progress
  // stall / a prior alive=0 branch cleared it), the trigger was consumed and NEVER re-armed
  // (counter passed 2, `-eq 2` never matched again). The busy flag had NOTHING to do with it:
  // the stall was waiting-input the whole way. The D5 fix: `-ge` + per-spell IDLE_REPORTED edge
  // + ROUNDS first-round warmup replaces the SEEN_BUSY requirement.
  const p = makeHermeticProbe("ol-d5mount");
  const x = path.join(p.tmp, "session.jsonl");
  // Stalled from mount: last message pure-text (candidate idle), file mtime 8 min back (hmin≈8 ≥
  // loopMin=1 → noise gate open). Never a busy round → SEEN_BUSY=0 the whole way.
  writeTranscript(x, [assistantTextRecord(isoAgo(0.1))], 8);
  try {
    assert.ok(await waitForAlive(p.env, p.session), "probe must be alive");
    const mon = spawnMonitor(p.env, `d5 ${p.tmp} ${p.session}`,
      { transcripts: `d5 ${x}`, overdueMin: 999, loopMin: 1, interval: 1 });
    try {
      const idle = await waitForOutput(mon, /SESSION-IDLE d5/, 20000);
      assert.ok(idle, `AC6/D5: a session stalled from mount (never busy) MUST report SESSION-IDLE after the debounce:\n${mon.output()}`);
      assert.ok(/心跳 \d+ 分钟前更新/.test(mon.output()),
        `AC6/D5: the IDLE must carry the heartbeat staleness (true stall, not a gap):\n${mon.output()}`);
    } finally {
      mon.child.kill("SIGKILL");
      mon.cleanup();
    }
  } finally {
    p.cleanup();
  }
});

test("AC6/D5 — the per-spell edge: SESSION-IDLE fires ONCE per idle spell (the -ge threshold must not spam); a busy spell re-arms the edge so the NEXT idle spell reports again", { skip: tmuxAvailable ? false : "tmux not installed" }, async () => {
  const p = makeHermeticProbe("ol-d5edge");
  const x = path.join(p.tmp, "session.jsonl");
  try {
    assert.ok(await waitForAlive(p.env, p.session), "probe must be alive");
    // Spells are driven by the TRANSCRIPT's last-message type (the pane stays a static bash
    // prompt): busy = pending-tool-use (tool_use block); idle = pure-text. Each spell is
    // backdated 8 min so hmin≥loopMin=1 → IDLE reports (noise gate open).
    const mon = spawnMonitor(p.env, `de ${p.tmp} ${p.session}`,
      { transcripts: `de ${x}`, overdueMin: 999, loopMin: 1, interval: 1 });
    try {
      // Spell 1: busy (was working) for ≥2 rounds.
      writeTranscript(x, [assistantToolUseRecord(isoAgo(0.1))], 8);
      assert.ok(await waitForRounds(mon, 2, 15000), `spell-1 busy rounds:\n${mon.output()}`);
      // Spell 1: idle → IDLE reports exactly once.
      writeTranscript(x, [assistantTextRecord(isoAgo(0.1))], 8);
      assert.ok(await waitForOutput(mon, /SESSION-IDLE de/, 20000), `spell-1 idle must report IDLE:\n${mon.output()}`);
      // Hold spell-1 idle several more rounds — the -ge threshold is long past, but the per-spell
      // edge (IDLE_REPORTED) must NOT re-report every round.
      assert.ok(await waitForRounds(mon, 5, 15000), `hold idle rounds:\n${mon.output()}`);
      await sleep(500);
      let c = (mon.output().match(/SESSION-IDLE de/g) || []).length;
      assert.equal(c, 1, `per-spell edge: one idle spell must report SESSION-IDLE exactly once (-ge must not spam), got ${c}:\n${mon.output()}`);
      // Spell 2: busy → the edge re-arms (and RESUMED fires on the transition).
      writeTranscript(x, [assistantToolUseRecord(isoAgo(0.1))], 8);
      assert.ok(await waitForOutput(mon, /SESSION-RESUMED de/, 20000), `spell-2 busy must fire RESUMED:\n${mon.output()}`);
      // Spell 2: idle → a SECOND IDLE fires (new spell, edge re-armed).
      writeTranscript(x, [assistantTextRecord(isoAgo(0.1))], 8);
      const deadline = Date.now() + 20000;
      while (Date.now() < deadline && (mon.output().match(/SESSION-IDLE de/g) || []).length < 2) await sleep(200);
      c = (mon.output().match(/SESSION-IDLE de/g) || []).length;
      assert.equal(c, 2, `per-spell edge: two idle spells must report IDLE exactly twice, got ${c}:\n${mon.output()}`);
    } finally {
      mon.child.kill("SIGKILL");
      mon.cleanup();
    }
  } finally {
    p.cleanup();
  }
});

test("AC6/D5 — the first launch round reports nothing (warmup): no SESSION-IDLE and no SESSION-RESUMED before the second round", { skip: tmuxAvailable ? false : "tmux not installed" }, async () => {
  const p = makeHermeticProbe("ol-d5warm");
  const x = path.join(p.tmp, "session.jsonl");
  try {
    assert.ok(await waitForAlive(p.env, p.session), "probe must be alive");
    // Stalled-from-mount transcript (pure-text, 8 min stale) — the exact shape that would fire
    // IDLE as soon as the debounce allows. The ROUNDS>1 warmup (which replaced the old SEEN_BUSY
    // "never report until busy seen" startup guard) must hold back round 1.
    writeTranscript(x, [assistantTextRecord(isoAgo(0.1))], 8);
    const mon = spawnMonitor(p.env, `wr ${p.tmp} ${p.session}`,
      { transcripts: `wr ${x}`, overdueMin: 999, loopMin: 1, interval: 1 });
    try {
      // After ONE complete round (the `# ROUND` marker prints after the per-target loop, so all
      // round-1 event output is already captured): nothing may be reported.
      assert.ok(await waitForRounds(mon, 1, 15000), `monitor must run round 1:\n${mon.output()}`);
      await sleep(300); // grace for a spurious round-1 report to land in the stream
      const out1 = mon.output();
      assert.ok(!/SESSION-IDLE wr/.test(out1), `first round must not report IDLE (warmup):\n${out1}`);
      assert.ok(!/SESSION-RESUMED wr/.test(out1), `first round must not report RESUMED (warmup):\n${out1}`);
      // From round 2 on, the stalled session reports IDLE after the 2-round debounce.
      assert.ok(await waitForOutput(mon, /SESSION-IDLE wr/, 20000),
        `after the warmup round the stall must report IDLE:\n${mon.output()}`);
    } finally {
      mon.child.kill("SIGKILL");
      mon.cleanup();
    }
  } finally {
    p.cleanup();
  }
});
