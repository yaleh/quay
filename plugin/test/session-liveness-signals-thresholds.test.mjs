// @test-group lowconc
// @load-sensitive wall-clock
// session-liveness-signals-thresholds.test.mjs — 阈值行为 — 去抖轮数 / LOOP_MIN 噪声闸 / per-spell 沿 / warmup / 同阶去抖 / 权限提示阈值
//
// PART OF THE session-liveness test family. Split from session-liveness-signals.test.mjs by
// gap-split-session-liveness-signals-unblocks-lowconc (2026-08-11): that single file was the
// lowconc phase's CEILING (216s > 440095/3 = 146.7s ideal-split at cc=3, __GROUP__ capped=1).
// Splitting the 27-probe file into per-focus files (信号种类 / 阈值行为 / 集成断言) lets cc=3 run
// them in PARALLEL and returns the phase to the floor. This file covers 阈值行为 — 去抖轮数 / LOOP_MIN 噪声闸 / per-spell 沿 / warmup / 同阶去抖 / 权限提示阈值.
//
// SPLIT CONCURRENCY SAFETY: this file runs as its OWN node process at cc=3. It owns the
// /tmp prefix "session-liveness-sig-t-" — the hermetic probe constructors create dirs under it (via
// setProbeTmpPrefix) and the after() below sweeps ONLY it (+ the file-specific extras), so this
// file can never delete a sibling file's active probe dir. The test BODIES are byte-identical to
// the original; only their file placement changed.
//
// KNOWN-LOAD-SENSITIVE (see plugin/loop/fast-mode-loop-tick.md "已知负载敏感族") — this family uses
// real processes + tmux timing; it passes isolated under low load but may fail under concurrent-suite
// load (gap-load-sensitive-session-family-confounds-step-three, 2026-08-04). GROUP NOTE
// (gap-lowconc-group-concurrency-3-for-hermetic-load-sensitive): routed to the `lowconc` group — the
// hermetic-but-load-sensitive phase at concurrency 3.
//
// Run: node --test session-liveness-signals-thresholds.test.mjs   /   scripts/test.sh --group lowconc

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
setProbeTmpPrefix("session-liveness-sig-t-");

// KNOWN-LOAD-SENSITIVE: under suite load a hermetic-probe test can be cancelled mid-run,
// skipping its finally → this file's /tmp dirs leak (server + socket stay alive) and trip the
// suite-tail tmux-leak-scan. reapLiveOwners() FIRST kills this process's OWN still-alive probe
// servers (a cancelled test's residue — sweepTmp cannot: it skips live-owner dirs by design), then
// sweepTmp removes owner-dead residue. Sweep ONLY this file's own prefixes (see SPLIT CONCURRENCY
// SAFETY above — never a sibling's).
after(() => {
  reapLiveOwners();
  sweepTmp("session-liveness-sig-t-");
});

test("AC1 — a pane whose ONLY change is the /clear to save token counter stays idle (zero events); masked chrome must not read as work", { skip: tmuxAvailable ? false : "tmux not installed" }, async () => {
  const p = makeHermeticProbe("ol-tok");
  try {
    assert.ok(await waitForAlive(p.env, p.session), "probe must be alive");
    // Start the chrome loop BEFORE the monitor and let it settle: it overwrites one line in place
    // (\r), so nothing scrolls — the only thing that changes between rounds is the token number,
    // which lives in a /clear to save line that mask_pane strips. The baseline is therefore
    // established with the chrome already on screen (no one-time transition when the job starts).
    tmux(["send-keys", "-t", p.session, "for i in $(seq 1 40); do printf \"/clear to save %s.%sk tokens\\r\" $i $i; sleep 0.4; done &"], p.env);
    tmux(["send-keys", "-t", p.session, "Enter"], p.env);
    await sleep(2500); // let the job notice land and the loop start
    // A FRESH tick keeps hmin≈0 (not "?"): the D5 fix (2026-08-08) makes a mount-time idle WITH an
    // unknown heartbeat report SESSION-IDLE (SEEN_BUSY gate removed) — that mount-time idle is
    // correct behavior for a stall, but it is UNRELATED to chrome. A fresh tick pins hmin≈0 so the
    // mount-time idle is suppressed by the LOOP_MIN noise gate and this test asserts what it is
    // actually about: chrome must not read as work (zero RESUMED / zero IDLE PAIR).
    const tick = path.join(p.tmp, "tick.md");
    fs.writeFileSync(tick, "# tick\n");
    const mon = spawnMonitor(p.env, `tok ${p.tmp} ${p.session}`, { tickLogs: `tok ${tick}` });
    try {
      await sleep(5000); // several rounds while the token number keeps changing
      const out = mon.output();
      assert.ok(!/SESSION-RESUMED tok/.test(out), `token-counter-only change must NOT read as busy:\n${out}`);
      assert.ok(!/SESSION-IDLE tok/.test(out), `token-counter-only change must NOT produce an IDLE pair:\n${out}`);
    } finally {
      mon.child.kill("SIGKILL");
    mon.cleanup();
    }
  } finally {
    p.cleanup();
  }
});

test("AC4 — observers don't know each other: the same target watched by two observers with DIFFERENT LOOP_MIN thresholds (LOOP_MIN=0 reports the healthy idle, LOOP_MIN=999 suppresses it), who-starts-first irrelevant", { skip: tmuxAvailable ? false : "tmux not installed" }, async () => {
  const p = makeHermeticProbe("ol-par4");
  const tick = path.join(p.tmp, "tick.md");
  try {
    fs.writeFileSync(tick, "# tick\n"); // hmin ≈ 0 — a healthy idle, under every LOOP_MIN
    assert.ok(await waitForAlive(p.env, p.session), "probe must be alive first");
    // Start observer A FIRST (LOOP_MIN=999 — suppress healthy idles), THEN observer B (LOOP_MIN=0 —
    // report everything). Who-starts-first must be irrelevant: A's threshold cannot decide what B sees.
    // Each observer needs ≥2 IDLE baseline rounds (round 1 sets PREV_STATE, round 2 sets PREV_IDLE)
    // before a busy transition can fire SESSION-RESUMED — see the RESUMED guard on PREV_IDLE.
    const monA = spawnMonitor(p.env, `pa ${p.tmp} ${p.session}`, { tickLogs: `pa ${tick}`, interval: 1, loopMin: 999 });
    assert.ok(await waitForRounds(monA, 2, 10000), `observer A (started first) must run ≥2 idle rounds:\n${monA.output()}`);
    const monB = spawnMonitor(p.env, `pa ${p.tmp} ${p.session}`, { tickLogs: `pa ${tick}`, interval: 1, loopMin: 0 });
    try {
      assert.ok(await waitForRounds(monB, 2, 10000), `observer B must run ≥2 idle rounds despite A being already mounted:\n${monB.output()}`);
      // both track the pane: busy → RESUMED fires in BOTH observers (neither is a no-op).
      makePaneBusy(p.env, p.session);
      assert.ok(await waitForOutput(monA, /SESSION-RESUMED pa/, 60000), `observer A must fire RESUMED:\n${monA.output()}`);
      assert.ok(await waitForOutput(monB, /SESSION-RESUMED pa/, 60000), `observer B must fire RESUMED:\n${monB.output()}`);
      makePaneIdle(p.env, p.session);
      // B (LOOP_MIN=0) reports the healthy idle; A (LOOP_MIN=999) stays silent — each observer's
      // threshold serves ONLY its own stream (the AC21 "holder threshold decides everyone's blindness"
      // defect cannot exist with per-observer streams).
      assert.ok(await waitForOutput(monB, /SESSION-IDLE pa/, 10000), `observer B (LOOP_MIN=0) must report the healthy idle:\n${monB.output()}`);
      await sleep(3500);
      assert.ok(!/SESSION-IDLE pa/.test(monA.output()),
        `observer A (LOOP_MIN=999) must suppress the healthy idle on ITS OWN stream — per-observer threshold:\n${monA.output()}`);
    } finally {
      monA.child.kill("SIGKILL");
      monB.child.kill("SIGKILL");
      monA.cleanup();
      monB.cleanup();
    }
  } finally {
    p.cleanup();
  }
});

test("AC3 — a pure-text round with no new tool calls (stale transcript) reports SESSION-IDLE after the 2-round debounce (true idle detected, not a gap misjudged)", { skip: tmuxAvailable ? false : "tmux not installed" }, async () => {
  const p = makeHermeticProbe("ol-trueidle");
  const x = path.join(p.tmp, "session.jsonl");
  writeTranscript(x, [assistantToolUseRecord(isoAgo(0.1))], 1); // busy phase first (was working)
  try {
    assert.ok(await waitForAlive(p.env, p.session), "probe must be alive");
    const mon = spawnMonitor(p.env, `ac3 ${p.tmp} ${p.session}`,
      { transcripts: `ac3 ${x}`, overdueMin: 999, loopMin: 1, interval: 1 });
    try {
      // busy phase: ≥2 rounds establish the "was working" baseline (D5 note 2026-08-08: SEEN_BUSY
      // is no longer REQUIRED to report IDLE — a session stalled from mount reports too; the busy
      // phase here models the measured "worked, then froze" scenario, not a report precondition).
      assert.ok(await waitForRounds(mon, 2, 15000), `monitor must run ≥2 busy rounds:\n${mon.output()}`);
      // true idle: pure-text round, 8 minutes no new tool calls (the manager's measured scenario).
      writeTranscript(x, [assistantTextRecord(isoAgo(0.1))], 8);
      const idle = await waitForOutput(mon, /SESSION-IDLE ac3/, 20000);
      assert.ok(idle, `AC3: a true idle (pure-text round + 8.5min no tool calls + no pane busy flag) MUST report SESSION-IDLE:\n${mon.output()}`);
      assert.ok(/心跳 \d+ 分钟前更新/.test(mon.output()),
        `AC3: the IDLE must carry the heartbeat staleness (true idle, not a gap):\n${mon.output()}`);
    } finally {
      mon.child.kill("SIGKILL");
      mon.cleanup();
    }
  } finally {
    p.cleanup();
  }
});

test("AC4 — a pure-text blip lasting exactly ONE monitor round between two tool_use rounds does NOT report SESSION-IDLE (debounce holds); a persistent pure-text then DOES", { skip: tmuxAvailable ? false : "tmux not installed" }, async () => {
  const p = makeHermeticProbe("ol-gap4");
  const x = path.join(p.tmp, "session.jsonl");
  writeTranscript(x, [assistantToolUseRecord(isoAgo(0.1))], 1); // busy: pending-tool-use, stale
  try {
    assert.ok(await waitForAlive(p.env, p.session), "probe must be alive");
    const mon = spawnMonitor(p.env, `gap4 ${p.tmp} ${p.session}`,
      { transcripts: `gap4 ${x}`, overdueMin: 999, loopMin: 1, interval: 1 });
    try {
      // phase 1: ≥2 busy rounds establish the "was working" baseline (D5 note 2026-08-08: SEEN_BUSY
      // no longer gates IDLE reporting; the busy phase models the measured "worked, then froze" shape).
      assert.ok(await waitForRounds(mon, 2, 15000), `monitor must run ≥2 rounds:\n${mon.output()}`);
      // phase 2: the GAP — exactly one round of pure-text, then back to busy before the 2nd idle round.
      writeTranscript(x, [assistantTextRecord(isoAgo(0.1))], 1); // the gap: transcript pure-text, pane static
      assert.ok(await waitForRounds(mon, 3, 15000), `one idle round must elapse:\n${mon.output()}`);
      writeTranscript(x, [assistantToolUseRecord(isoAgo(0.1))], 1); // back to busy before the 2nd idle round
      // phase 3: several busy rounds — a wrongly-held debounce would have fired by now.
      assert.ok(await waitForRounds(mon, 6, 20000), `several busy rounds must elapse:\n${mon.output()}`);
      assert.ok(!/SESSION-IDLE gap4/.test(mon.output()),
        `AC4: a single-round pure-text gap between tool calls must NOT report SESSION-IDLE (debounce):\n${mon.output()}`);
      // positive control: a PERSISTENT pure-text (true idle) DOES fire after the 2-round debounce.
      writeTranscript(x, [assistantTextRecord(isoAgo(0.1))], 8); // hmin≈8 ≥ loopMin=1 → stdout report
      assert.ok(await waitForOutput(mon, /SESSION-IDLE gap4/, 15000),
        `AC4 control: a persistent true-idle MUST fire SESSION-IDLE (proves the gap suppression is the debounce, not a broken detector):\n${mon.output()}`);
    } finally {
      mon.child.kill("SIGKILL");
      mon.cleanup();
    }
  } finally {
    p.cleanup();
  }
});

test("AC5 — a pending tool_use in the transcript (round in progress) NEVER reports idle, even with a static pane; pure-text then DOES (control)", { skip: tmuxAvailable ? false : "tmux not installed" }, async () => {
  const p = makeHermeticProbe("ol-busy5");
  const x = path.join(p.tmp, "session.jsonl");
  writeTranscript(x, [assistantToolUseRecord(isoAgo(0.1))], 1); // pending-tool-use, stale, pane static
  try {
    assert.ok(await waitForAlive(p.env, p.session), "probe must be alive");
    const mon = spawnMonitor(p.env, `ac5 ${p.tmp} ${p.session}`,
      { transcripts: `ac5 ${x}`, overdueMin: 999, loopMin: 1, interval: 1 });
    try {
      await sleep(6000); // ≥6 rounds with a pending tool_use + static pane
      assert.ok(!/SESSION-IDLE ac5/.test(mon.output()),
        `AC5: pending tool_use ⇒ NEVER report idle, even with the pane exactly unchanged (AC5 hard cap):\n${mon.output()}`);
      // control: the idle path is NOT globally broken — pure-text fires it.
      writeTranscript(x, [assistantTextRecord(isoAgo(0.1))], 8);
      assert.ok(await waitForOutput(mon, /SESSION-IDLE ac5/, 15000),
        `AC5 control: after the pending tool_use clears, a persistent pure-text idle MUST fire (proves the busy suppression is the pending tool_use):\n${mon.output()}`);
    } finally {
      mon.child.kill("SIGKILL");
      mon.cleanup();
    }
  } finally {
    p.cleanup();
  }
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

test("AC4 (candidate B) — the pure verdict: a permission-prompt persisting ≥N rounds with a stale/no-transcript read is 'warn'; fresh transcript or sub-threshold rounds is 'ok' (no-infinite-silence fallback)", () => {
  const verdict = (rounds, txAge, env = {}) => spawnSync("bash", [SCRIPT, "--perm-warn-verdict", String(rounds), String(txAge)], {
    encoding: "utf8", env: { ...process.env, ...env },
  }).stdout.trim();
  // stale transcript (120s > 60s window) at the threshold ⇒ warn.
  assert.equal(verdict(3, 120), "warn");
  // fresh transcript (10s ≤ 60s window) ⇒ ok — the session is genuinely active (cross positive control).
  assert.equal(verdict(3, 10), "ok");
  // below the consecutive-rounds threshold ⇒ ok.
  assert.equal(verdict(2, 120), "ok");
  // no transcript configured (-1) ⇒ ok — the "no transcript write" cross-check cannot be confirmed
  // (pane-only observers already get the D5 pane-only audit WARN; AC4 does not invent a WARN).
  assert.equal(verdict(3, -1), "ok");
  // the threshold is a knob: PERM_PROMPT_WARN_ROUNDS=2 makes the same 2-round stale read warn.
  assert.equal(verdict(2, 120, { PERM_PROMPT_WARN_ROUNDS: "2" }), "warn");
});

test("AC-boundary (true root cause, outer 2c1d0c7c) — pane-only + default heartbeat (tick-log) is refreshed by upper-layer ticks, so the LOOP_MIN gate silently swallows SESSION-IDLE; LOOP_MIN=0 (or an explicit heartbeat source) breaks the silence", { skip: tmuxAvailable ? false : "tmux not installed" }, async () => {
  // Confirmed mechanism (2026-08-08, outer 2c1d0c7c): a pane-only target (no SESSION_HEARTBEATS /
  // SESSION_TRANSCRIPTS) falls back to the DEFAULT heartbeat <root>/orchestration/tick-log.md.
  // tick-log is appended by every outer/inner tick → its mtime is perpetually fresh → hmin≈0-2min
  // < LOOP_MIN → the IDLE noise gate silently suppresses SESSION-IDLE even for a genuinely idle
  // pane. Measured: pane-only + LOOP_MIN=1 → IDLE_CONSEC monotonic but SESSION-IDLE silent;
  // LOOP_MIN=0 → SESSION-IDLE emitted. This test locks the boundary + the startup WARN:
  //   * the pane-only + default-heartbeat + LOOP_MIN>0 target emits the WARN (fail-loud startup,
  //     not silent run-time blindness) and keeps SESSION-IDLE silent while the pane is idle;
  //   * the SAME pane-only target with LOOP_MIN=0 emits SESSION-IDLE (the closure criterion).
  const p = makeHermeticProbe("ol-bnd2");
  const root = p.tmp;
  // Fresh default heartbeat: simulate the upper layer's tick-log being written (perpetually fresh
  // mtime) — the exact shape that makes hmin < LOOP_MIN on every round.
  fs.mkdirSync(path.join(root, "orchestration"), { recursive: true });
  fs.writeFileSync(path.join(root, "orchestration", "tick-log.md"), "# tick\n");
  try {
    assert.ok(await waitForAlive(p.env, p.session), "probe must be alive");
    // Pane-only target (no explicit heartbeat/transcript), LOOP_MIN=1 (the gate is ON).
    const monGated = spawnMonitor(p.env, `gb ${p.tmp} ${p.session}`, { interval: 1, loopMin: 1 });
    try {
      // The pane is idle from round 1 (bash prompt → unknown → busy=0). The default heartbeat is
      // fresh, so hmin≈0 < LOOP_MIN=1 → the noise gate holds SESSION-IDLE silent across rounds.
      assert.ok(await waitForRounds(monGated, 5, 15000), `gated monitor must run rounds:\n${monGated.output()}`);
      await sleep(300); // grace for a spurious IDLE to land
      assert.ok(/session-liveness: WARN 目标「gb」是 pane-only/.test(monGated.output()),
        `the pane-only + default-heartbeat + LOOP_MIN>0 target must WARN at startup (fail-loud, not silent blindness):\n${monGated.output()}`);
      assert.ok(!/SESSION-IDLE gb/.test(monGated.output()),
        `AC-boundary: pane-only + default heartbeat (fresh tick-log) + LOOP_MIN>0 must keep SESSION-IDLE silent (the confirmed masking):\n${monGated.output()}`);
    } finally {
      monGated.child.kill("SIGKILL");
      monGated.cleanup();
    }
    // LOOP_MIN=0: the SAME pane-only target now reports SESSION-IDLE (the closure criterion —
    // IDLE fires under the correct config).
    const monOpen = spawnMonitor(p.env, `gb ${p.tmp} ${p.session}`, { interval: 1, loopMin: 0 });
    try {
      assert.ok(await waitForOutput(monOpen, /SESSION-IDLE gb/, 15000),
        `AC-boundary control: pane-only + LOOP_MIN=0 MUST report SESSION-IDLE (the closure criterion):\n${monOpen.output()}`);
      assert.ok(/心跳 \d+ 分钟前更新/.test(monOpen.output()),
        `the IDLE must carry the heartbeat staleness:\n${monOpen.output()}`);
      assert.ok(!/session-liveness: WARN/.test(monOpen.output()),
        `LOOP_MIN=0 must not WARN (the gate is off):\n${monOpen.output()}`);
    } finally {
      monOpen.child.kill("SIGKILL");
      monOpen.cleanup();
    }
  } finally {
    p.cleanup();
  }
});

test("AC2/D3 — 同阶去抖（RESUMED 与 IDLE 同深度）：一个 1 轮的忙 blip 不报 SESSION-RESUMED（镜像 AC4 的 1 轮闲 blip 不报 IDLE）；持续忙才报", { skip: tmuxAvailable ? false : "tmux not installed" }, async () => {
  // D3 不对称（2026-08-08 硬事实）：RESUMED 单轮沿即报 / IDLE 要连续 2 轮。AC2 修复：两者用
  // 同一去抖深度。本测试镜像 AC4（1 轮闲 blip 不报 IDLE）的反向：1 轮忙 blip 也不报 RESUMED。
  const p = makeHermeticProbe("ol-d3sym");
  const x = path.join(p.tmp, "session.jsonl");
  writeTranscript(x, [assistantTextRecord(isoAgo(0.1))], 1); // idle baseline: pure-text, stale
  try {
    assert.ok(await waitForAlive(p.env, p.session), "probe must be alive");
    const mon = spawnMonitor(p.env, `d3 ${p.tmp} ${p.session}`,
      { transcripts: `d3 ${x}`, overdueMin: 999, loopMin: 1, interval: 1 });
    try {
      // phase 1: ≥2 idle rounds establish the idle baseline.
      assert.ok(await waitForRounds(mon, 2, 15000), `monitor must run ≥2 idle rounds:\n${mon.output()}`);
      // phase 2: the BUSY BLIP — exactly one round of pending-tool-use, then back to idle
      // before the 2nd busy round. Same-order debounce must NOT report RESUMED.
      writeTranscript(x, [assistantToolUseRecord(isoAgo(0.1))], 1); // the blip: pending-tool-use
      assert.ok(await waitForRounds(mon, 3, 15000), `one busy blip round must elapse:\n${mon.output()}`);
      writeTranscript(x, [assistantTextRecord(isoAgo(0.1))], 1); // back to idle
      // phase 3: several idle rounds — a wrongly-held busy path would have fired by now.
      assert.ok(await waitForRounds(mon, 6, 20000), `several idle rounds must elapse:\n${mon.output()}`);
      assert.ok(!/SESSION-RESUMED d3/.test(mon.output()),
        `AC2/D3: a single-round busy blip between idle spells must NOT report SESSION-RESUMED (same-order debounce):\n${mon.output()}`);
      // positive control: a PERSISTENT busy (≥IDLE_DEBOUNCE_ROUNDS rounds) DOES report RESUMED.
      writeTranscript(x, [assistantToolUseRecord(isoAgo(0.1))], 1); // persistent busy
      assert.ok(await waitForOutput(mon, /SESSION-RESUMED d3/, 15000),
        `AC2/D3 control: a persistent busy MUST report SESSION-RESUMED (proves the suppression is the same-order debounce):\n${mon.output()}`);
    } finally {
      mon.child.kill("SIGKILL");
      mon.cleanup();
    }
  } finally {
    p.cleanup();
  }
});

