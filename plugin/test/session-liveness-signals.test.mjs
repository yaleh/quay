// @test-group lowconc
// @load-sensitive wall-clock
// session-liveness-signals.test.mjs — screen semantic signals, payload, saturation, debounce, parallel observation (stage 2/3/4)
//
// PART OF THE session-liveness test family (gap-session-liveness-tail-capped-split, 2026-08-07).
// Split out of session-liveness.test.mjs: that single file was the lowconc phase's TAIL CAP
// (396.0s wall-clock > 832.7s÷3 = 277.6s even-split floor at cc=3 in the exclusive-window
// measurement; 211.4s vs 196.6s under the full-suite round), so the lowconc phase could never
// drop below the cap regardless of concurrency. Splitting into per-family files (events /
// heartbeat / signals) lets cc=3 run them in PARALLEL and returns the phase to the floor.
// Shared helpers live in session-liveness-helpers.mjs (same pattern as the quay-init-loop split).
//
// SPLIT CONCURRENCY SAFETY: this file runs as its OWN node process at cc=3. It owns the
// /tmp prefix "session-liveness-sig-" — the hermetic probe constructors create dirs under it (via
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
// Run: scripts/test.sh session-liveness-signals.test.mjs   /   node --test session-liveness-signals.test.mjs   /   scripts/test.sh --group lowconc

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
  setProbeTmpPrefix, sweepTmp, tmux, isolateTmuxEnv, isClaudePid,
  paneHasClaudeChild, waitForAlive, makeHermeticProbe,
  spawnMonitor, waitForOutput, waitForRounds, countRounds,
  makePaneBusy, makePaneIdle, startTouchLoop, cleanup,
  userRecord, assistantRecord, apiErrorRecord, isoAgo,
  assistantToolUseRecord, assistantTextRecord, userInputRecord, writeTranscript,
  assistantUsageRecord,
} from "./session-liveness-helpers.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// OWN the /tmp probe prefix for this split file (see SPLIT CONCURRENCY SAFETY):
setProbeTmpPrefix("session-liveness-sig-");

// KNOWN-LOAD-SENSITIVE: under suite load a hermetic-probe test can be cancelled mid-run,
// skipping its finally → this file's /tmp dirs leak and trip the suite-tail tmux-leak-scan. Sweep
// ONLY this file's own prefixes (see SPLIT CONCURRENCY SAFETY above — never a sibling's).
after(() => {
  sweepTmp("session-liveness-sig-", "sl-lmt-, sl-sat-");
});

test("AC1 mask — --mask strips /clear to save chrome, spinner timing, and ✻ residue, but KEEPS the agent task line (tokens ≠ chrome)", () => {
  const raw = [
    "new task? /clear to save 151.2k tokens",
    "✽ …（41s · ↓1.2k tokens）",
    "✻ Baked for 8m54s",
    "◯ general-purpose Reading session-liveness.test.mjs 1m 35s · ↓ 57.3k tokens",
    "a real content line",
  ].join("\n");
  const r = spawnSync("bash", [SCRIPT, "--mask"], { input: raw, encoding: "utf8" });
  assert.equal(r.status, 0, `--mask must exit 0:\n${r.stderr}`);
  assert.ok(!r.stdout.includes("/clear to save"), "token counter chrome must be stripped");
  assert.ok(!r.stdout.includes("✽"), "spinner timing line must be stripped");
  assert.ok(!r.stdout.includes("✻"), "baked residue must be stripped");
  assert.ok(r.stdout.includes("◯ general-purpose Reading"),
    "agent task line is REAL content and must be kept — mask must be precise to the chrome lines, not a blanket `tokens` filter (滤掉它=把假阳性换成假阴性)");
  assert.ok(r.stdout.includes("a real content line"), "plain content must be kept");
});

test("AC1/AC3/AC6/AC7 — esc to interrupt PRESENCE drives busy/idle; RESUMED carries cause + last-input; IDLE fires when the flag disappears", { skip: tmuxAvailable ? false : "tmux not installed" }, async () => {
  const p = makeHermeticProbe("ol-esc");
  try {
    assert.ok(await waitForAlive(p.env, p.session), "probe must be alive");
    // tickLogs pins the heartbeat to /nonexistent so hmin="?" under the noise gate: the IDLE
    // transition is always reported, and the REAL worktree tick-log cannot gate it silent
    // (same isolation test A uses).
    const mon = spawnMonitor(p.env, `esc ${p.tmp} ${p.session}`, { tickLogs: `esc /nonexistent` });
    try {
      await sleep(3000); // idle baseline: bash prompt, no busy shape
      makePaneBusy(p.env, p.session); // type "esc to interrupt" into the input line → busy SHAPE
      const resumed = await waitForOutput(mon, /SESSION-RESUMED esc/, 25000);
      assert.ok(resumed, `RESUMED must fire when esc to interrupt appears:\n${mon.output()}`);
      const out = mon.output();
      assert.ok(/成因：esc to interrupt 标志出现/.test(out),
        `RESUMED must name the semantic flag as the cause (AC3/AC6 — 可解释、无需再采样):\n${out}`);
      assert.ok(/上次收到输入：取不到/.test(out),
        `RESUMED must say 取不到 when no transcript is configured (AC7 — 不得省略该字段):\n${out}`);
      makePaneIdle(p.env, p.session); // clear the input → back to the idle shape
      // D5 fix (2026-08-08): /nonexistent heartbeat + idle-at-mount now fires a MOUNT-TIME IDLE
      // (correct for an unknown-heartbeat stall — SEEN_BUSY gate removed). The assertion must be
      // the TRANSITION IDLE, not that mount-time one: a fresh IDLE must fire after the busy, i.e.
      // a SESSION-IDLE must POSTDATE the SESSION-RESUMED (per-spell edge: IDLE reports once per idle
      // spell, and the busy spell re-arms it). 2026-08-08 load-robustness (same family as
      // gap-load-sensitive-session-family-confounds-step-three): wait for the RESUMED→IDLE PAIR as a
      // single pattern over the GROWING output — waiting for a bare `/SESSION-IDLE esc/` would match
      // the mount-time idle INSTANTLY and truncate the wait window to ~0s, so under concurrent-suite
      // load (a sibling agent hammering the same family on a shared box) the fresh transition IDLE
      // never had time to fire. The pair pattern gives it the full 8s window.
      assert.ok(await waitForOutput(mon, /SESSION-RESUMED esc[\s\S]*SESSION-IDLE esc/, 8000),
        `a FRESH IDLE must fire after the busy transition (the mount-time idle is not the one under test):\n${mon.output()}`);
    } finally {
      mon.child.kill("SIGKILL");
    mon.cleanup();
    }
  } finally {
    p.cleanup();
  }
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

test("AC2 — transcript fresh + screen idle ⇒ SESSION-MARKER-STALE (cross positive control); a stale transcript stays silent", { skip: tmuxAvailable ? false : "tmux not installed" }, async () => {
  const p = makeHermeticProbe("ol-stale");
  const x = path.join(p.tmp, "session.jsonl");
  let toucher = null;
  try {
    fs.writeFileSync(x, "{}\n");
    spawnSync("touch", ["-d", "3 hours ago", x], { encoding: "utf8" }); // stale → no cross-control signal
    assert.ok(await waitForAlive(p.env, p.session), "probe must be alive");
    const mon = spawnMonitor(p.env, `ms ${p.tmp} ${p.session}`, { transcripts: `ms ${x}` });
    try {
      await sleep(4000); // ≥3 rounds with a STALE transcript: no marker-stale
      assert.ok(!/SESSION-MARKER-STALE/.test(mon.output()),
        `stale transcript must not fire marker-stale:\n${mon.output()}`);
      // now the transcript advances (session definitely writing) while the pane stays idle
      toucher = startTouchLoop(x);
      assert.ok(await waitForOutput(mon, /SESSION-MARKER-STALE ms/, 8000),
        `fresh transcript + idle pane must fire marker-stale (the cross positive control):\n${mon.output()}`);
      toucher.kill("SIGKILL"); toucher = null;
    } finally {
      mon.child.kill("SIGKILL");
    mon.cleanup();
    }
  } finally {
    if (toucher) toucher.kill("SIGKILL");
    p.cleanup();
  }
});

test("AC2 — a fresh TICK LOG (not a transcript) + idle pane does NOT fire marker-stale (tick log is not session-activity evidence)", { skip: tmuxAvailable ? false : "tmux not installed" }, async () => {
  const p = makeHermeticProbe("ol-tickstale");
  const tick = path.join(p.tmp, "tick.md");
  try {
    fs.writeFileSync(tick, "# tick\n"); // fresh mtime
    assert.ok(await waitForAlive(p.env, p.session), "probe must be alive");
    const mon = spawnMonitor(p.env, `ts ${p.tmp} ${p.session}`, { tickLogs: `ts ${tick}` });
    try {
      await sleep(4000);
      assert.ok(!/SESSION-MARKER-STALE/.test(mon.output()),
        `fresh tick log is NOT session evidence; must NOT fire marker-stale:\n${mon.output()}`);
    } finally {
      mon.child.kill("SIGKILL");
    mon.cleanup();
    }
  } finally {
    p.cleanup();
  }
});

test("AC9 — idle + transcript with isApiErrorMessage structural field ⇒ SESSION-IDLE-CANT-SEND; a healthy transcript stays regular (the three-state discriminator)", { skip: tmuxAvailable ? false : "tmux not installed" }, async () => {
  const p = makeHermeticProbe("ol-api");
  const healthy = path.join(p.tmp, "healthy.jsonl");
  const blocked = path.join(p.tmp, "blocked.jsonl");
  fs.writeFileSync(healthy, [userRecord(isoAgo(10)), assistantRecord(isoAgo(5))].join("\n") + "\n");
  spawnSync("touch", ["-d", "3 hours ago", healthy], { encoding: "utf8" }); // healthy idle session: transcript STALE
  fs.writeFileSync(blocked, [userRecord(isoAgo(10)), assistantRecord(isoAgo(5)),
    apiErrorRecord(isoAgo(1)), apiErrorRecord(isoAgo(0.5))].join("\n") + "\n");
  try {
    assert.ok(await waitForAlive(p.env, p.session), "probe must be alive");
    // healthy/stale target: idle + no API errors in the window → no CANT-SEND
    const monH = spawnMonitor(p.env, `h ${p.tmp} ${p.session}`, { transcripts: `h ${healthy}` });
    try {
      await sleep(4000); // several rounds of steady idle
      assert.ok(!/SESSION-IDLE-CANT-SEND/.test(monH.output()),
        `healthy/stale idle must NOT report CANT-SEND:\n${monH.output()}`);
    } finally {
      monH.child.kill("SIGKILL");
    monH.cleanup();
    }
    // blocked target: idle + API errors in the recent window → CANT-SEND fires (per-round edge, once)
    const monB = spawnMonitor(p.env, `b ${p.tmp} ${p.session}`, { transcripts: `b ${blocked}` });
    try {
      assert.ok(await waitForOutput(monB, /SESSION-IDLE-CANT-SEND b/, 8000),
        `blocked idle must report CANT-SEND:\n${monB.output()}`);
      assert.ok(/isApiErrorMessage 结构字段/.test(monB.output()),
        `CANT-SEND must cite the structural field (not the 429 文案 — 换端点即失效):\n${monB.output()}`);
      const once = (monB.output().match(/SESSION-IDLE-CANT-SEND/g) || []).length;
      assert.equal(once, 1, `CANT-SEND must be edge-triggered (once per blocking episode), got ${once}:\n${monB.output()}`);
    } finally {
      monB.child.kill("SIGKILL");
    monB.cleanup();
    }
  } finally {
    p.cleanup();
  }
});

test("AC6/AC7 — RESUMED carries the cause AND the last-input time from the transcript (not 取不到 when a transcript exists)", { skip: tmuxAvailable ? false : "tmux not installed" }, async () => {
  const p = makeHermeticProbe("ol-payload");
  const x = path.join(p.tmp, "session.jsonl");
  // last type=user record is 5 minutes ago; the last record is an assistant one (not a user input)
  fs.writeFileSync(x, [userRecord(isoAgo(5)), assistantRecord(isoAgo(0.05))].join("\n") + "\n");
  try {
    assert.ok(await waitForAlive(p.env, p.session), "probe must be alive");
    const mon = spawnMonitor(p.env, `pl ${p.tmp} ${p.session}`, { transcripts: `pl ${x}` });
    try {
      await sleep(3000); // idle baseline
      makePaneBusy(p.env, p.session); // shape-busy (ruling D): typed esc → busy shape
      // Window is generous (25000ms, not 8000ms): under the full suite's ~4× oversubscription the
      // monitor's per-round tmux capture-pane + transcript reads stretch several-fold (observed
      // >11s with no event in suite7/suite12), and the mechanism is correct — it fires at ~5s in
      // isolation and ~7.7s under load for the sibling test. The 8s window was contention-marginal.
      assert.ok(await waitForOutput(mon, /SESSION-RESUMED pl/, 25000), `RESUMED must fire:\n${mon.output()}`);
      const out = mon.output();
      // Strengthened AC6 (2026-08-03): the old `! /成因：\)/` used an ASCII paren that never appears
      // in the full-width output, so an EMPTY cause still passed — a no-op assertion. Require at
      // least one char between 成因： and the next ；or）(the real cause is always ≥ "状态变化").
      assert.ok(/成因：[^；）]/.test(out),
        `RESUMED must carry a non-empty cause (AC6):\n${out}`);
      const li = out.match(/上次收到输入：([^）]*)/);
      assert.ok(li && li[1] !== "取不到",
        `RESUMED must report last-input minutes (not 取不到) when a transcript exists (AC7):\n${out}`);
      assert.match(li[1], /^\d+ 分钟前$/, `last-input must read N 分钟前:\n${out}`);
    } finally {
      mon.child.kill("SIGKILL");
    mon.cleanup();
    }
  } finally {
    p.cleanup();
  }
});

test("AC7 negative control — an EMPTY transcript yields last-input 取不到, which the AC7 assertion still rejects (the 25s window is not the check)", { skip: tmuxAvailable ? false : "tmux not installed" }, async () => {
  // Mutation (checker-mutation method): the AC6/AC7 test asserts last-input "N 分钟前" when a
  // user record exists. Here we REMOVE the user record (empty transcript) → last_user_input_epoch
  // returns nothing → lastin="取不到". If the original AC7 assertion (`li && li[1] !== "取不到"`)
  // still rejects this corrupted payload, the 25s window only delays the RESUMED wait — it does not
  // mask a broken payload. If it did NOT reject it, the window bump would be diluting the assertion.
  const p = makeHermeticProbe("ol-nc");
  const x = path.join(p.tmp, "session.jsonl");
  fs.writeFileSync(x, "", "utf8");
  try {
    assert.ok(await waitForAlive(p.env, p.session), "probe must be alive");
    const mon = spawnMonitor(p.env, `pl ${p.tmp} ${p.session}`, { transcripts: `pl ${x}` });
    try {
      await sleep(3000); // idle baseline
      makePaneBusy(p.env, p.session); // shape-busy (ruling D): typed esc → busy shape
      assert.ok(await waitForOutput(mon, /SESSION-RESUMED pl/, 25000), `RESUMED must fire:\n${mon.output()}`);
      const out = mon.output();
      const li = out.match(/上次收到输入：([^）]*)/);
      assert.ok(li && li[1] === "取不到",
        `negative control: empty transcript must yield last-input 取不到 (the corruption is real, so AC7 is what rejects it):\n${out}`);
      const ac7Satisfied = Boolean(li && li[1] !== "取不到");
      assert.equal(ac7Satisfied, false,
        `AC7 must reject the corrupted payload (last-input 取不到); the 25s window is not the check:\n${out}`);
    } finally {
      mon.child.kill("SIGKILL");
    mon.cleanup();
    }
  } finally {
    p.cleanup();
  }
});

test("AC6 negative control — a script mutation that neutralizes the cause yields an empty cause, which the strengthened AC6 assertion rejects", { skip: tmuxAvailable ? false : "tmux not installed" }, async () => {
  // Mutation (checker-mutation method): force the cause empty right before the SESSION-RESUMED echo.
  // The strengthened AC6 assertion (`/成因：[^；）]/`) must reject the empty cause — proving the 25s
  // window is not the check and the cause path is actually asserted (the old `! /成因：\)/` was a
  // no-op: ASCII paren never appears in the full-width output, so an empty cause passed).
  // AC2/D3 同阶去抖 (2026-08-09) moved the cause into the RESUME_CAUSE array; the mutation now
  // targets that emit's cause interpolation so the emitted 成因 is empty (成因：；).
  const p = makeHermeticProbe("ol-nc-cause");
  const x = path.join(p.tmp, "session.jsonl");
  fs.writeFileSync(x, [userRecord(isoAgo(5)), assistantRecord(isoAgo(0.05))].join("\n") + "\n");
  const mutated = path.join(p.tmp, "session-liveness-mutated.sh");
  // The event emitter is sl_emit (writes stdout + shared file); the mutation must target THAT call.
  fs.writeFileSync(mutated, fs.readFileSync(SCRIPT, "utf8").replace(
    /成因：\$\{RESUME_CAUSE\[\$name\]:-状态变化\}/,
    "成因："));
  try {
    assert.ok(await waitForAlive(p.env, p.session), "probe must be alive");
    const mon = spawnMonitor(p.env, `pl ${p.tmp} ${p.session}`, { script: mutated, transcripts: `pl ${x}` });
    try {
      await sleep(3000); // idle baseline
      makePaneBusy(p.env, p.session); // shape-busy (ruling D): typed esc → busy shape
      assert.ok(await waitForOutput(mon, /SESSION-RESUMED pl/, 25000), `RESUMED must fire:\n${mon.output()}`);
      const out = mon.output();
      assert.ok(/成因：；/.test(out),
        `negative control: the mutation must yield an empty cause (成因：；), so the strengthened AC6 is what rejects it:\n${out}`);
      const ac6Satisfied = /成因：[^；）]/.test(out);
      assert.equal(ac6Satisfied, false,
        `AC6 must reject the empty-cause mutation (the 25s window is not the check):\n${out}`);
    } finally {
      mon.child.kill("SIGKILL");
    mon.cleanup();
    }
  } finally {
    p.cleanup();
  }
});

test("AC4 — the script header documents the screen-vs-transcript tradeoff, each signal's blind spot, and which wins when both are used", () => {
  const src = fs.readFileSync(SCRIPT, "utf8");
  assert.ok(src.includes("两种信号"), "header must carry the AC4 两种信号 section");
  assert.ok(src.includes("同时用时以谁为准"), "header must state which signal wins when both are used");
  assert.ok(src.includes("盲区"), "header must name each signal's blind spot");
  assert.ok(src.includes("SESSION-MARKER-STALE"), "header must name the cross positive control event (AC2)");
});

test("AC2 — multiple observers mount the SAME target in parallel (no lock, no shared file); both run and both fire SESSION-GONE independently", { skip: tmuxAvailable ? false : "tmux not installed" }, async () => {
  const p = makeHermeticProbe("ol-par2");
  try {
    assert.ok(await waitForAlive(p.env, p.session), "probe must be alive first");
    // Two observers, same target, same interval. Without the mount lock neither is a no-op: the
    // SECOND mount must RUN (the old AC20b "empty operation" is gone with the lock).
    const mon1 = spawnMonitor(p.env, `par ${p.tmp} ${p.session}`, {});
    const mon2 = spawnMonitor(p.env, `par ${p.tmp} ${p.session}`, {});
    try {
      // both must establish ≥2 rounds (PREV_ALIVE=1 baseline) before the probe is killed.
      assert.ok(await waitForRounds(mon1, 2, 10000), `observer 1 must run ≥2 rounds:\n${mon1.output()}`);
      assert.ok(await waitForRounds(mon2, 2, 10000), `observer 2 must run ≥2 rounds:\n${mon2.output()}`);
      // kill the probe's claude child → BOTH observers independently fire SESSION-GONE on their own stream.
      tmux(["send-keys", "-t", p.session, "kill %1"], p.env);
      tmux(["send-keys", "-t", p.session, "Enter"], p.env);
      assert.ok(await waitForOutput(mon1, /SESSION-GONE par/, 6000), `observer 1 must fire GONE:\n${mon1.output()}`);
      assert.ok(await waitForOutput(mon2, /SESSION-GONE par/, 6000), `observer 2 must fire GONE independently:\n${mon2.output()}`);
      // neither stream carries the other's events — the streams are independent, not merged.
      assert.ok(!/SECOND-OBSERVER/.test(mon1.output()), "observer 1's stream must not be polluted by observer 2");
    } finally {
      mon1.child.kill("SIGKILL");
      mon2.child.kill("SIGKILL");
      mon1.cleanup();
      mon2.cleanup();
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
      assert.ok(await waitForOutput(monA, /SESSION-RESUMED pa/, 25000), `observer A must fire RESUMED:\n${monA.output()}`);
      assert.ok(await waitForOutput(monB, /SESSION-RESUMED pa/, 25000), `observer B must fire RESUMED:\n${monB.output()}`);
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

test("AC1 seam — --last-message-type classifies pending-tool-use / pure-text / user-input / unknown (transcript is the structural signal, AC7)", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sl-lmt-"));
  try {
    const pend = path.join(tmp, "pend.jsonl");
    writeTranscript(pend, [assistantToolUseRecord(isoAgo(0.1))]);
    const pure = path.join(tmp, "pure.jsonl");
    writeTranscript(pure, [assistantTextRecord(isoAgo(0.1))]);
    const user = path.join(tmp, "user.jsonl");
    writeTranscript(user, [userInputRecord(isoAgo(0.1))]);
    // 最后一条消息是 assistant 纯文本，但文件尾有元数据（last-prompt）——必须跳过元数据找真消息
    const meta = path.join(tmp, "meta.jsonl");
    writeTranscript(meta, [assistantTextRecord(isoAgo(0.2)), JSON.stringify({ type: "last-prompt", lastPrompt: "x" })]);
    const empty = path.join(tmp, "empty.jsonl");
    writeTranscript(empty, []);
    const run = (f) => spawnSync("bash", [SCRIPT, "--last-message-type", f], { encoding: "utf8" }).stdout.trim();

    assert.equal(run(pend), "pending-tool-use", "assistant + tool_use block = pending-tool-use (AC1 确定忙)");
    assert.equal(run(pure), "pure-text", "assistant pure text = pure-text (AC1 候选闲)");
    assert.equal(run(user), "user-input", "user record = user-input (按忙处理, AC5 防漏报方向)");
    assert.equal(run(meta), "pure-text", "trailing metadata (last-prompt) must be skipped; the last MESSAGE is pure-text");
    assert.equal(run(empty), "unknown", "empty transcript = unknown (无消息记录 → 回落到 pane 信号)");
    assert.equal(run("/nonexistent"), "unknown", "missing transcript = unknown");
  } finally { cleanup(tmp); }
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

test("AC1 — the header documents the chrome line set (each with WHY it is not an activity signal) and the classifyPaneState integration (ruling D)", () => {
  const src = fs.readFileSync(SCRIPT, "utf8");
  // chrome 行集合逐条进文件头，每条附理由（AC1：用真实 pane 采样支持）
  assert.ok(src.includes("/clear to save") && src.includes("token 计数行"),
    "AC1: the token-counter chrome line must be documented in the header");
  assert.ok(src.includes("✽") && src.includes("转圈"),
    "AC1: the spinner chrome line must be documented in the header");
  assert.ok(src.includes("✻") && src.includes("残留"),
    "AC1: the ✻ residue chrome line must be documented in the header");
  assert.ok(src.includes("为什么它不是活动信号") || src.includes("为什么它不是活动"),
    "AC1: each chrome entry must carry its reason (为什么它不是活动信号)");
  // 机制：消费 classifyPaneState，不是整屏哈希（裁定 D / ADR-016 Amendment）
  assert.ok(src.includes("classifyPaneState"),
    "AC1: the busy judgment must consume classifyPaneState (ruling D)");
  assert.ok(!/(capture-pane[^#]*md5sum|md5sum[^#]*capture-pane)/.test(src),
    "ADR-016 Amendment: no capture-pane→md5sum whole-screen hash may remain in session-liveness.sh");
});

test("AC5 — an empty pane capture / empty region is NOT silently judged idle: --pane-state on empty input reports busy=1 (the anti-filter guard)", () => {
  // empty input → classifier tier-2 unknown with an EMPTY region → the AC5 guard must NOT silently
  // call it idle (a busy session whose pane reads empty would be reported idle forever — silent).
  const r = spawnSync("bash", [SCRIPT, "--pane-state"], { input: "", encoding: "utf8" });
  assert.equal(r.status, 0, `--pane-state must exit 0:\n${r.stderr}`);
  assert.match(r.stdout, /state=unknown busy=1/, `empty pane must be non-idle (AC5 anti-filter):\n${r.stdout}`);
  // blank-only input → bottom region is empty → same guard.
  const blank = spawnSync("bash", [SCRIPT, "--pane-state"], { input: "\n\n\n", encoding: "utf8" });
  assert.match(blank.stdout, /busy=1/, `blank-only pane must be non-idle (AC5):\n${blank.stdout}`);
  // control: a real idle shape (❯ present) is still idle — the guard does not block normal idle.
  const idle = spawnSync("bash", [SCRIPT, "--pane-state"], { input: "❯ \n---\n", encoding: "utf8" });
  assert.match(idle.stdout, /state=waiting-input busy=0/, `a real idle shape must stay idle:\n${idle.stdout}`);
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

test("AC4 (candidate B) — main-loop wiring: a permission-prompt pane persisting N rounds with a stale transcript emits the no-infinite-silence WARN to the observer's own stderr", { skip: tmuxAvailable ? false : "tmux not installed" }, async () => {
  const p = makeHermeticProbe("ol-permwarn");
  try {
    assert.ok(await waitForAlive(p.env, p.session), "probe must be alive");
    // Make the probe pane show a blocking permission-prompt SHAPE (typed, no Enter — the pane's last
    // content line carries the "Quick safety check"/"Enter to confirm" signature, so the classifier
    // reads permission-prompt and _sl_pane_verdict pins busy=1).
    tmux(["send-keys", "-t", p.session, "C-u"], p.env);
    tmux(["send-keys", "-t", p.session, "Quick safety check: Is this a project you created or one you trust? | Enter to confirm"], p.env);
    // A STALE transcript (backdated 10 min ⇒ > PERM_PROMPT_TX_WINDOW 60s): the cross-check confirms
    // "no transcript write" ⇒ the WARN must fire (candidate B). Without a transcript the WARN is
    // correctly suppressed, so this test pins a transcript to exercise the firing branch.
    const tx = path.join(p.tmp, "transcript.jsonl");
    writeTranscript(tx, [userRecord(isoAgo(10))], 10);
    const mon = spawnMonitor(p.env, `permwarn ${p.tmp} ${p.session}`, {
      transcripts: `permwarn ${tx}`,
      interval: 1,
    });
    try {
      assert.ok(await waitForOutput(mon, /WARN permwarn 的 pane 连续 [0-9]+ 轮 permission-prompt/, 20000),
        `candidate-B WARN must fire once the permission-prompt persists with a stale transcript:\n${mon.output()}`);
      // Sanity: the pane is STILL busy (the WARN never changes the busy verdict — a real prompt stays busy).
      assert.ok(await waitForOutput(mon, /permission-prompt/, 5000), `pane stays permission-prompt:\n${mon.output()}`);
    } finally {
      mon.child.kill("SIGKILL");
      mon.cleanup();
    }
  } finally {
    p.cleanup();
  }
});

test("AC4 — a pane whose ONLY real change is the agent task line (↓ NN.Nk tokens) while the busy shape persists stays BUSY (no false idle); the idle→busy transition RESUMEs within one polling cycle and the agent line is NOT filtered", { skip: tmuxAvailable ? false : "tmux not installed" }, async () => {
  const p = makeHermeticProbe("ol-ac4");
  try {
    assert.ok(await waitForAlive(p.env, p.session), "probe must be alive");
    // unit level: the agent task line is REAL content — classifyPaneState preserves it in the
    // region and the busy SHAPE (esc in the status area) drives the busy verdict. Two snapshots
    // that differ ONLY in the agent task line BOTH classify busy (real work = busy shape present).
    const snap1 = "◯ general-purpose Reading session-liveness.test.mjs 1m 35s · ↓ 57.3k tokens\n───────────────────────────────\n❯ \n───────────────────────────────\nesc to interrupt";
    const snap2 = "◯ general-purpose Reading session-liveness.test.mjs 1m 41s · ↓ 61.2k tokens\n───────────────────────────────\n❯ \n───────────────────────────────\nesc to interrupt";
    for (const [label, snap] of [["v1", snap1], ["v2", snap2]]) {
      const unit = spawnSync("bash", [SCRIPT, "--pane-state"], { input: snap, encoding: "utf8" });
      assert.match(unit.stdout, /state=busy busy=1/, `AC4: agent-line snapshot ${label} + busy shape must be busy:\n${unit.stdout}`);
      // the agent task line must be PRESERVED (real content, not filtered by chrome stripping)
      const cls = spawnSync("node", ["--no-warnings", "--experimental-strip-types",
        path.resolve(__dirname, "..", "scripts", "pane-state-classify.ts"), "--classify"], { input: snap, encoding: "utf8" });
      assert.ok(cls.stdout.includes("general-purpose") && cls.stdout.includes("tokens"),
        `AC4: the agent task line must be preserved in the classifier region:\n${cls.stdout}`);
    }
    // A FRESH tick (not /nonexistent) pins hmin≈0 so the D5-fix mount-time idle (a correct report
    // for an unknown-heartbeat stall, gap-session-liveness-busy-mask-idle-with-subagents) is
    // suppressed by the LOOP_MIN noise gate — this test is about the advancing agent line during
    // real work, not about the mount-time baseline.
    const tick = path.join(p.tmp, "tick.md");
    fs.writeFileSync(tick, "# tick\n");
    const mon = spawnMonitor(p.env, `ac4 ${p.tmp} ${p.session}`, { tickLogs: `ac4 ${tick}` });
    try {
      await sleep(2500); // idle baseline
      // real work in a Claude Code pane: the agent task line is visible (printed) AND the busy
      // shape (esc typed) is present. Idle → busy must surface as SESSION-RESUMED within a few
      // polling cycles (AC7: no debounce was added to the busy path).
      tmux(["send-keys", "-t", p.session, "printf '◯ general-purpose Reading session-liveness.test.mjs 1m 35s · ↓ 57.3k tokens\\n'"], p.env);
      tmux(["send-keys", "-t", p.session, "Enter"], p.env);
      makePaneBusy(p.env, p.session);
      const t0 = Date.now();
      assert.ok(await waitForOutput(mon, /SESSION-RESUMED ac4/, 8000),
        `AC4: RESUMED must fire promptly when real work starts:\n${mon.output()}`);
      const latencyMs = Date.now() - t0;
      assert.ok(latencyMs < 8000, `AC7: busy_latency must stay within polling-cycle range (no debounce on the busy path): ${latencyMs}ms`);
      assert.ok(/成因：esc to interrupt 标志出现/.test(mon.output()),
        `AC4: the RESUMED cause must name the busy shape:\n${mon.output()}`);
      // while busy, only the agent task line advances (↓ 57.3k → 61.2k) — the busy shape persists,
      // so no false IDLE (the AC4 negative-control direction: real content must not read as idle).
      tmux(["send-keys", "-t", p.session, "printf '◯ general-purpose Reading session-liveness.test.mjs 1m 41s · ↓ 61.2k tokens\\n'"], p.env);
      tmux(["send-keys", "-t", p.session, "Enter"], p.env);
      makePaneBusy(p.env, p.session); // re-affirm the busy shape in the status area
      await sleep(3500); // ≥3 rounds
      assert.ok(!/SESSION-IDLE ac4/.test(mon.output()),
        `AC4: the advancing agent task line must NOT read as idle (real work continues):\n${mon.output()}`);
    } finally {
      mon.child.kill("SIGKILL");
      mon.cleanup();
    }
  } finally {
    p.cleanup();
  }
});

test("AC9 — a known-continuous-work window reports SESSION-RESUMED at most ONCE (the 23-RESUMED noise is gone): the busy shape persists, so idle is never entered", { skip: tmuxAvailable ? false : "tmux not installed" }, async () => {
  const p = makeHermeticProbe("ol-ac9");
  try {
    assert.ok(await waitForAlive(p.env, p.session), "probe must be alive");
    // A FRESH tick pins hmin≈0 (D5-fix mount-time idle suppressed by LOOP_MIN) — see the AC4 test
    // for the same rationale; this test is about continuous busy work, not the mount baseline.
    const tick = path.join(p.tmp, "tick.md");
    fs.writeFileSync(tick, "# tick\n");
    const mon = spawnMonitor(p.env, `ac9 ${p.tmp} ${p.session}`, { tickLogs: `ac9 ${tick}` });
    try {
      await sleep(2500); // idle baseline
      // continuous work = the busy shape (esc typed) held across several rounds. With the busy
      // shape present the pane is NEVER judged idle, so RESUMED fires at most once (the real work
      // of the inner session no longer flip-flops idle→busy the way the old masked-hash did).
      makePaneBusy(p.env, p.session);
      assert.ok(await waitForOutput(mon, /SESSION-RESUMED ac9/, 8000),
        `AC9: RESUMED must fire once on the busy transition:\n${mon.output()}`);
      await sleep(5000); // ≥4 more rounds of continuous busy shape (esc stays in the input line)
      const resumedCount = (mon.output().match(/SESSION-RESUMED ac9/g) || []).length;
      assert.ok(resumedCount <= 1, `AC9: continuous busy work must report RESUMED at most once, got ${resumedCount}:\n${mon.output()}`);
      assert.ok(!/SESSION-IDLE ac9/.test(mon.output()),
        `AC9: continuous busy work must not report IDLE:\n${mon.output()}`);
    } finally {
      mon.child.kill("SIGKILL");
      mon.cleanup();
    }
  } finally {
    p.cleanup();
  }
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

test("阶段四 Contract — --states 含 saturated（恰好一次）；--selfcheck --json 输出含 saturated 恰好一次（两个 measure 带）", () => {
  const states = spawnSync("bash", [SCRIPT, "--states"], { encoding: "utf8" });
  assert.equal(states.status, 0, `--states must exit 0:\n${states.stderr}`);
  const statesCount = (states.stdout.match(/saturated/g) || []).length;
  assert.equal(statesCount, 1,
    `--states must mention saturated exactly once (Contract measure states_include_saturated band=1), got ${statesCount}:\n${states.stdout}`);

  const json = spawnSync("bash", [SCRIPT, "--selfcheck", "--json"], { encoding: "utf8" });
  assert.equal(json.status, 0, `--selfcheck --json must exit 0:\n${json.stdout}\n${json.stderr}`);
  assert.match(json.stdout, /"saturation":"saturated"/,
    `--selfcheck --json must carry saturation=saturated (measure saturation_observable):\n${json.stdout}`);
  const jsonCount = (json.stdout.match(/saturated/g) || []).length;
  assert.equal(jsonCount, 1,
    `--selfcheck --json must mention saturated exactly once (measure grep -c = 1), got ${jsonCount}:\n${json.stdout}`);
});

test("阶段四 selfcheck — 饱和复合判据三 fixture（饱和正控制 / 同上下文已应答负控制 / 健康负控制）在普通 --selfcheck 里 PASS", () => {
  const r = spawnSync("bash", [SCRIPT, "--selfcheck"], { encoding: "utf8" });
  assert.equal(r.status, 0, `--selfcheck must exit 0 (heartbeat AND saturation both pass):\n${r.stdout}\n${r.stderr}`);
  assert.match(r.stdout, /saturation composite PASS — saturated=saturated answering=unsaturated healthy=unsaturated/,
    `the plain selfcheck must validate the saturation composite criterion:\n${r.stdout}`);
});

test("阶段四 AC1 seam — --saturation 报出饱和/未饱和（高上下文+未应答=saturated；同上下文已应答=unsaturated；低上下文=unsaturated；缺失=unknown）", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sl-sat-"));
  try {
    const sat = path.join(tmp, "saturated.jsonl");
    writeTranscript(sat, [assistantUsageRecord(isoAgo(0.1), 600000), userInputRecord(isoAgo(0.05))]);
    const answering = path.join(tmp, "answering.jsonl");
    writeTranscript(answering, [userInputRecord(isoAgo(0.2)), assistantUsageRecord(isoAgo(0.05), 600000)]);
    const healthy = path.join(tmp, "healthy.jsonl");
    writeTranscript(healthy, [assistantUsageRecord(isoAgo(0.1), 50000), userInputRecord(isoAgo(0.05))]);
    const run = (f) => spawnSync("bash", [SCRIPT, "--saturation", f], { encoding: "utf8" }).stdout.trim();
    assert.match(run(sat), /^saturated /, "high context + unanswered input ⇒ saturated (AC1 正控制)");
    assert.match(run(answering), /^unsaturated /, "high context but still answering ⇒ unsaturated (auto-compact 是正常机制，AC4)");
    assert.match(run(healthy), /^unsaturated /, "low context + unanswered ⇒ unsaturated (AC4 负控制)");
    assert.match(run(path.join(tmp, "nope.jsonl")), /^unknown/, "missing transcript ⇒ unknown (静默不猜)");
  } finally { cleanup(tmp); }
});

test("阶段四 AC2（承重条）— 饱和会话与普通忙会话产出不同事件：饱和 fixture 触发 SESSION-SATURATED，普通忙 fixture 不触发（且不误报 IDLE）", { skip: tmuxAvailable ? false : "tmux not installed" }, async () => {
  const p = makeHermeticProbe("ol-sat2");
  const satX = path.join(p.tmp, "saturated.jsonl");
  const busyX = path.join(p.tmp, "busy.jsonl");
  try {
    // 饱和 fixture：高上下文 + 最后一条未应答 user 输入。回拨 1 分钟 mtime 使 FRESH_SECS 的
    // MARKER-STALE 交叉正控制不触发（那是一个既有事件，与本测试无关）。
    writeTranscript(satX, [assistantUsageRecord(isoAgo(0.1), 600000), userInputRecord(isoAgo(0.05))], 1);
    // 普通忙 fixture：低上下文 + 挂起 tool_use（回合进行中=忙），与饱和会话在「忙」维度同形。
    writeTranscript(busyX, [assistantToolUseRecord(isoAgo(0.1))], 1);
    assert.ok(await waitForAlive(p.env, p.session), "probe must be alive");
    const monSat = spawnMonitor(p.env, `sat ${p.tmp} ${p.session}`, { transcripts: `sat ${satX}` });
    const monBusy = spawnMonitor(p.env, `busy ${p.tmp} ${p.session}`, { transcripts: `busy ${busyX}` });
    try {
      assert.ok(await waitForOutput(monSat, /SESSION-SATURATED sat/, 8000),
        `AC2: saturated fixture MUST fire SESSION-SATURATED:\n${monSat.output()}`);
      await sleep(3500);
      assert.ok(!/SESSION-SATURATED busy/.test(monBusy.output()),
        `AC2: an ordinary busy fixture must NOT fire SESSION-SATURATED (different event):\n${monBusy.output()}`);
      // 饱和 fixture 在「忙」维度也是 busy（最后一条 user → transcript_busy=1），但不得报 IDLE——
      // 它报的是 SESSION-SATURATED，与普通忙可区分（AC2：同事件 = 维度仍未测量）。
      assert.ok(!/SESSION-IDLE sat/.test(monSat.output()),
        `AC2: the saturated target must not be misreported as idle (it is saturated, distinguishable):\n${monSat.output()}`);
    } finally {
      monSat.child.kill("SIGKILL"); monSat.cleanup();
      monBusy.child.kill("SIGKILL"); monBusy.cleanup();
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

test("AC3（人裁定）— 带 subagent 的 inner 停摆报 IDLE：主 transcript 陈旧 + subagent 活跃 ⇒ 仍报 SESSION-IDLE（忙标志跟主循环，不跟后台任务）", { skip: tmuxAvailable ? false : "tmux not installed" }, async () => {
  // 人裁定（2026-08-08）：「inner 停下时即使有若干 subagent 在跑，也必须报 IDLE 事件」。
  // 忙闲判据只读主 transcript 的最后消息类型（transcript_busy），subagent 只进心跳（OVERDUE）
  // 不进忙判据——所以主 transcript 停摆（纯文本陈旧）即使 subagent 在写，也必须 fused-idle。
  // LOOP_MIN=0（管理者对 pane-only 观测的既有做法）让 IDLE 不受心跳新鲜度噪声闸门压制。
  const p = makeHermeticProbe("ol-subagent");
  const main = path.join(p.tmp, "session.jsonl");
  const agent = path.join(p.tmp, "session", "subagents", "agent-1.jsonl");
  try {
    fs.mkdirSync(path.dirname(agent), { recursive: true });
    writeTranscript(main, [assistantTextRecord(isoAgo(0.1))], 8); // main transcript STALE pure-text (stalled)
    fs.writeFileSync(agent, "{}\n"); // subagent file exists, will be kept fresh
    assert.ok(await waitForAlive(p.env, p.session), "probe must be alive");
    const mon = spawnMonitor(p.env, `sub ${p.tmp} ${p.session}`,
      { transcripts: `sub ${main}`, overdueMin: 999, loopMin: 0, interval: 1 });
    const toucher = startTouchLoop(agent); // the subagent keeps writing while the main is quiet
    try {
      // With the subagent ACTIVE, the stall must STILL report SESSION-IDLE (the busy flag follows
      // the main loop, not background tasks — D2 withdrawal). F2 heartbeat already proves the
      // subagent keeps OVERDUE away; this is the IDLE side of the same human ruling.
      assert.ok(await waitForOutput(mon, /SESSION-IDLE sub/, 20000),
        `AC3: inner stall (stale main transcript) with an ACTIVE subagent MUST report SESSION-IDLE:\n${mon.output()}`);
      assert.ok(!/SESSION-RESUMED sub/.test(mon.output()),
        `AC3: the active subagent must NOT be read as busy (busy follows the main loop):\n${mon.output()}`);
    } finally {
      toucher.kill("SIGKILL");
      mon.child.kill("SIGKILL");
      mon.cleanup();
    }
  } finally {
    p.cleanup();
  }
});

test("AC7/D4 — CANT-SEND 时效：陈旧错误被后续成功应答覆盖 ⇒ 不再报 SESSION-IDLE-CANT-SEND（尾随计数）；尾随错误仍报", { skip: tmuxAvailable ? false : "tmux not installed" }, async () => {
  // D4 复现（manager 三次实测）：13:04:47 API Error 恢复后 13:08:47 正常应答，但记录仍在 200 条
  // 窗口内（12:43→13:09=26min），旧判据「最近 200 条含 ≥1 isApiErrorMessage」让 13:06/13:09/13:11
  // 连报三条 CANT-SEND。修复：只数【尾随】错误——遇到第一条非错误消息（成功应答）即停。本测试：
  //  * 尾随错误（blocked，错误在最末）⇒ CANT-SEND 仍报（正控制，同 AC9）；
  //  * 陈旧错误 + 后续成功应答（recovered，最后一条是 assistant 文本）⇒ 不报 CANT-SEND（D4 修复）。
  const p = makeHermeticProbe("ol-d4fresh");
  const blocked = path.join(p.tmp, "blocked.jsonl");
  const recovered = path.join(p.tmp, "recovered.jsonl");
  fs.writeFileSync(blocked, [userRecord(isoAgo(10)), assistantRecord(isoAgo(5)),
    apiErrorRecord(isoAgo(1)), apiErrorRecord(isoAgo(0.5))].join("\n") + "\n");
  fs.writeFileSync(recovered, [userRecord(isoAgo(10)), apiErrorRecord(isoAgo(5)),
    assistantRecord(isoAgo(1))].join("\n") + "\n");
  try {
    assert.ok(await waitForAlive(p.env, p.session), "probe must be alive");
    // 尾随错误正控制：错误在最末（0.5m/1m 前）⇒ CANT-SEND 报。
    const monB = spawnMonitor(p.env, `b ${p.tmp} ${p.session}`, { transcripts: `b ${blocked}`, loopMin: 0, interval: 1 });
    try {
      assert.ok(await waitForOutput(monB, /SESSION-IDLE-CANT-SEND b/, 8000),
        `AC7 positive control: trailing errors MUST report CANT-SEND:\n${monB.output()}`);
    } finally {
      monB.child.kill("SIGKILL");
      monB.cleanup();
    }
    // D4 修复：陈旧错误（5m 前）被后续成功应答（1m 前，最后一条 assistant 文本）覆盖 ⇒ 不报 CANT-SEND。
    const monR = spawnMonitor(p.env, `r ${p.tmp} ${p.session}`, { transcripts: `r ${recovered}`, loopMin: 0, interval: 1 });
    try {
      await sleep(4500); // several idle rounds — a stale-error CANT-SEND would have fired by now
      assert.ok(!/SESSION-IDLE-CANT-SEND/.test(monR.output()),
        `AC7/D4: a stale error superseded by a successful response MUST NOT report CANT-SEND:\n${monR.output()}`);
      assert.ok(/SESSION-IDLE r/.test(monR.output()),
        `AC7/D4: the recovered session must still report a REGULAR SESSION-IDLE (the freshness gate, not a blind mute):\n${monR.output()}`);
    } finally {
      monR.child.kill("SIGKILL");
      monR.cleanup();
    }
  } finally {
    p.cleanup();
  }
});

test("AC0（先观测）— SL_PANE_STATE_LOG=1 时每轮打 pane_state=<state> 观测行（抖动形状可观测；契约 measure pane_state_logged ≥1）", { skip: tmuxAvailable ? false : "tmux not installed" }, async () => {
  // 契约 measure pane_state_logged = 运行 session-liveness ≥15min 后日志出现每轮
  // `pane_state=<state>` 行（≥1）。SL_PANE_STATE_LOG=1 接缝（同 SL_ROUND_MARKER）让观察者可
  // 读每轮 pane_state，抖动形状可观测（AC0「先观测」）。本测试证明接缝确实逐轮输出。
  const p = makeHermeticProbe("ol-pstatelog");
  try {
    assert.ok(await waitForAlive(p.env, p.session), "probe must be alive");
    const mon = spawnMonitor({ ...p.env, SL_PANE_STATE_LOG: "1" }, `psl ${p.tmp} ${p.session}`,
      { interval: 1 });
    try {
      assert.ok(await waitForRounds(mon, 3, 15000), `monitor must run ≥3 rounds:\n${mon.output()}`);
      const paneStateLines = (mon.output().match(/pane_state=\S+/g) || []).length;
      assert.ok(paneStateLines >= 3,
        `AC0: SL_PANE_STATE_LOG must emit a pane_state=<state> line per round (≥3 for 3 rounds), got ${paneStateLines}:\n${mon.output()}`);
    } finally {
      mon.child.kill("SIGKILL");
      mon.cleanup();
    }
  } finally {
    p.cleanup();
  }
});
