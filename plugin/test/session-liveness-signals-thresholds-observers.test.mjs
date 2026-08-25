// @test-group engine
// @load-sensitive wall-clock
// session-liveness-signals-thresholds-observers.test.mjs — 阈值行为 · observers/边界 — token chrome / 双 observer 独立阈值 / 权限提示阈值 / pane-only 默认心跳边界
//
// PART OF THE session-liveness test family (split from session-liveness-signals.test.mjs by
// gap-split-session-liveness-signals-unblocks-lowconc, and FURTHER split by
// gap-split-three-phase-floor-files 2026-08-12). This file covers the observer/boundary threshold
// tests: AC1 (a /clear-to-save token counter change stays idle — masked chrome), AC4 (two observers
// with DIFFERENT LOOP_MIN thresholds are independent — who-starts-first irrelevant), the pure
// permission-prompt verdict (AC4 candidate B), and the AC-boundary (pane-only + default heartbeat is
// refreshed by upper-layer ticks so LOOP_MIN silently swallows SESSION-IDLE; LOOP_MIN=0 breaks the
// silence). The test BODIES are byte-identical to the pre-split file; only their file placement
// changed.
//
// SPLIT CONCURRENCY SAFETY: this file runs as its OWN node process at cc=3. It owns the
// /tmp prefix "session-liveness-sig-o-" — the hermetic probe constructors create dirs under it (via
// setProbeTmpPrefix) and the after() below sweeps ONLY it, so this file can never delete a sibling
// file's active probe dir (each split file owns a DISTINCT prefix — siblings sweep
// session-liveness-sig-t- / session-liveness-sig-e- only).
//
// KNOWN-LOAD-SENSITIVE (see plugin/loop/fast-mode-loop-tick.md "已知负载敏感族") — this family uses
// real processes + tmux timing; it passes isolated under low load but may fail under concurrent-suite
// load (gap-load-sensitive-session-family-confounds-step-three, 2026-08-04). GROUP NOTE
// (gap-lowconc-group-concurrency-3-for-hermetic-load-sensitive): routed to the `lowconc` group — the
// hermetic-but-load-sensitive phase at concurrency 3.
//
// Run: node --test session-liveness-signals-thresholds-observers.test.mjs   /   scripts/test.sh --group lowconc

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
  setProbeTmpPrefix, sessionLivenessAfter, tmux, isolateTmuxEnv, isClaudePid,
  paneHasClaudeChild, waitForAlive, makeHermeticProbe,
  spawnMonitor, waitForOutput, waitForRounds, countRounds,
  makePaneBusy, makePaneIdle, makePanePermissionPrompt, startTouchLoop, cleanup,
  userRecord, assistantRecord, apiErrorRecord, isoAgo,
  assistantToolUseRecord, assistantTextRecord, userInputRecord, writeTranscript,
  assistantUsageRecord,
} from "./session-liveness-helpers.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// OWN the /tmp probe prefix for this split file (see SPLIT CONCURRENCY SAFETY):
setProbeTmpPrefix("session-liveness-sig-o-");

// KNOWN-LOAD-SENSITIVE: under suite load a hermetic-probe test can be cancelled mid-run,
// skipping its finally → this file's /tmp dirs leak (server + socket stay alive) and trip the
// suite-tail tmux-leak-scan. reapLiveOwners() FIRST kills this process's OWN still-alive probe
// servers, then sweepTmp removes owner-dead residue. Sweep ONLY this file's own prefixes.
after(() => {
  sessionLivenessAfter("session-liveness-sig-o-");
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
