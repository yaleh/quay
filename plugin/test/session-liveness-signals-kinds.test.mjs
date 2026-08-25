// @test-group engine
// @load-sensitive wall-clock
// session-liveness-signals-kinds.test.mjs — 信号种类 — 事件识别与载荷（RESUMED/IDLE/MARKER-STALE/CANT-SEND/GONE/SATURATED/INTERVENTION，payload cause+last-input）
//
// PART OF THE session-liveness test family. Split from session-liveness-signals.test.mjs by
// gap-split-session-liveness-signals-unblocks-lowconc (2026-08-11): that single file was the
// lowconc phase's CEILING (216s > 440095/3 = 146.7s ideal-split at cc=3, __GROUP__ capped=1).
// Splitting the 27-probe file into per-focus files (信号种类 / 阈值行为 / 集成断言) lets cc=3 run
// them in PARALLEL and returns the phase to the floor. This file covers 信号种类 — 事件识别与载荷（RESUMED/IDLE/MARKER-STALE/CANT-SEND/GONE/SATURATED/INTERVENTION，payload cause+last-input）.
//
// SPLIT CONCURRENCY SAFETY: this file runs as its OWN node process at cc=3. It owns the
// /tmp prefix "session-liveness-sig-k-" — the hermetic probe constructors create dirs under it (via
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
// Run: node --test session-liveness-signals-kinds.test.mjs   /   scripts/test.sh --group lowconc

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
  assistantUsageRecord, HANG_GUARD_MS,
} from "./session-liveness-helpers.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// OWN the /tmp probe prefix for this split file (see SPLIT CONCURRENCY SAFETY):
setProbeTmpPrefix("session-liveness-sig-k-");

// KNOWN-LOAD-SENSITIVE: under suite load a hermetic-probe test can be cancelled mid-run,
// skipping its finally → this file's /tmp dirs leak (server + socket stay alive) and trip the
// suite-tail tmux-leak-scan. reapLiveOwners() FIRST kills this process's OWN still-alive probe
// servers (a cancelled test's residue — sweepTmp cannot: it skips live-owner dirs by design), then
// sweepTmp removes owner-dead residue. Sweep ONLY this file's own prefixes (see SPLIT CONCURRENCY
// SAFETY above — never a sibling's).
after(() => {
  sessionLivenessAfter("session-liveness-sig-k-");
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
      // Idle baseline MUST establish ≥2 rounds so PREV_IDLE=1 is armed BEFORE the busy transition
      // (RESUMED is an idle→busy edge; a fixed sleep can be one slow round under full-suite load).
      assert.ok(await waitForRounds(mon, 2, 20000),
        `idle baseline must establish 2 rounds so PREV_IDLE=1 is armed before the busy edge:\n${mon.output()}`);
      makePaneBusy(p.env, p.session); // type "esc to interrupt" into the input line → busy SHAPE
      const resumed = await waitForOutput(mon, /SESSION-RESUMED esc/, 60000);
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
      // ≥3 rounds with a STALE transcript: no marker-stale. Load-robust (hermetic): wait on the
      // `# ROUND` marker — a fixed wall-clock sleep can complete fewer rounds under load, making the
      // silence negative check vacuous rather than truly asserted.
      assert.ok(await waitForRounds(mon, 3, HANG_GUARD_MS),
        `monitor must run ≥3 stale-transcript rounds for the silence check:\n${mon.output()}`);
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
      // Load-robust (hermetic): ≥3 rounds via the `# ROUND` marker so the no-marker-stale negative
      // check observes a real span of rounds (a fixed wall-clock sleep can complete fewer under load).
      assert.ok(await waitForRounds(mon, 3, HANG_GUARD_MS),
        `monitor must run ≥3 fresh-tick rounds for the silence check:\n${mon.output()}`);
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
      // several rounds of steady idle — load-robust (hermetic): wait on the `# ROUND` marker so the
      // no-CANT-SEND negative check observes a real span (a fixed wall-clock sleep can complete fewer
      // rounds under load, making the silence check vacuous).
      assert.ok(await waitForRounds(monH, 3, HANG_GUARD_MS),
        `monitor must run ≥3 steady-idle rounds for the no-CANT-SEND check:\n${monH.output()}`);
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
      // Idle baseline MUST establish ≥2 rounds so PREV_IDLE=1 is armed BEFORE the busy transition
      // (RESUMED is an idle→busy edge; a fixed sleep can be one slow round under full-suite load).
      assert.ok(await waitForRounds(mon, 2, 20000),
        `idle baseline must establish 2 rounds so PREV_IDLE=1 is armed before the busy edge:\n${mon.output()}`);
      makePaneBusy(p.env, p.session); // shape-busy (ruling D): typed esc → busy shape
      // Window is generous (60000ms, widened from 25000 by
      // gap-load-sensitive-serial-phase-unbounded-growth-measure-first AC5 — the round-206 AC6
      // negative control timed out at 29.5s under lowconc contention with a 25s window): under the
      // full suite's ~4× oversubscription the monitor's per-round tmux capture-pane + transcript
      // reads stretch several-fold (observed >11s with no event in suite7/suite12), and the
      // mechanism is correct — it fires at ~5s in isolation and ~7.7s under load for the sibling
      // test. The 8s window was contention-marginal.
      assert.ok(await waitForOutput(mon, /SESSION-RESUMED pl/, 60000), `RESUMED must fire:\n${mon.output()}`);
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

test("AC7 negative control — an EMPTY transcript yields last-input 取不到, which the AC7 assertion still rejects (the wait window is not the check)", { skip: tmuxAvailable ? false : "tmux not installed" }, async () => {
  // Mutation (checker-mutation method): the AC6/AC7 test asserts last-input "N 分钟前" when a
  // user record exists. Here we REMOVE the user record (empty transcript) → last_user_input_epoch
  // returns nothing → lastin="取不到". If the original AC7 assertion (`li && li[1] !== "取不到"`)
  // still rejects this corrupted payload, the wait window only delays the RESUMED wait — it does not
  // mask a broken payload. If it did NOT reject it, the window bump would be diluting the assertion.
  const p = makeHermeticProbe("ol-nc");
  const x = path.join(p.tmp, "session.jsonl");
  fs.writeFileSync(x, "", "utf8");
  try {
    assert.ok(await waitForAlive(p.env, p.session), "probe must be alive");
    const mon = spawnMonitor(p.env, `pl ${p.tmp} ${p.session}`, { transcripts: `pl ${x}` });
    try {
      // Idle baseline MUST establish ≥2 rounds so PREV_IDLE=1 is armed BEFORE the busy transition
      // (RESUMED is an idle→busy edge; a fixed sleep can be one slow round under full-suite load).
      assert.ok(await waitForRounds(mon, 2, 20000),
        `idle baseline must establish 2 rounds so PREV_IDLE=1 is armed before the busy edge:\n${mon.output()}`);
      makePaneBusy(p.env, p.session); // shape-busy (ruling D): typed esc → busy shape
      assert.ok(await waitForOutput(mon, /SESSION-RESUMED pl/, 60000), `RESUMED must fire:\n${mon.output()}`);
      const out = mon.output();
      const li = out.match(/上次收到输入：([^）]*)/);
      assert.ok(li && li[1] === "取不到",
        `negative control: empty transcript must yield last-input 取不到 (the corruption is real, so AC7 is what rejects it):\n${out}`);
      const ac7Satisfied = Boolean(li && li[1] !== "取不到");
      assert.equal(ac7Satisfied, false,
        `AC7 must reject the corrupted payload (last-input 取不到); the wait window is not the check:\n${out}`);
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
      // Idle baseline MUST establish ≥2 rounds so PREV_IDLE=1 is armed BEFORE the busy transition
      // (RESUMED is an idle→busy edge; a fixed sleep can be one slow round under full-suite load).
      assert.ok(await waitForRounds(mon, 2, 20000),
        `idle baseline must establish 2 rounds so PREV_IDLE=1 is armed before the busy edge:\n${mon.output()}`);
      makePaneBusy(p.env, p.session); // shape-busy (ruling D): typed esc → busy shape
      assert.ok(await waitForOutput(mon, /SESSION-RESUMED pl/, 60000), `RESUMED must fire:\n${mon.output()}`);
      const out = mon.output();
      assert.ok(/成因：；/.test(out),
        `negative control: the mutation must yield an empty cause (成因：；), so the strengthened AC6 is what rejects it:\n${out}`);
      const ac6Satisfied = /成因：[^；）]/.test(out);
      assert.equal(ac6Satisfied, false,
        `AC6 must reject the empty-cause mutation (the wait window is not the check):\n${out}`);
    } finally {
      mon.child.kill("SIGKILL");
    mon.cleanup();
    }
  } finally {
    p.cleanup();
  }
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

test("阶段四 AC2（承重条）— 饱和会话与普通忙会话产出不同事件：饱和 fixture 触发 SESSION-DISABLED，普通忙 fixture 不触发（且不误报 IDLE）", { skip: tmuxAvailable ? false : "tmux not installed" }, async () => {
  const p = makeHermeticProbe("ol-sat2");
  const satX = path.join(p.tmp, "saturated.jsonl");
  const busyX = path.join(p.tmp, "busy.jsonl");
  try {
    // 饱和 fixture：高上下文 + 最后一条未应答 user 输入。回拨 ≥SATURATION_SILENCE_MIN 分钟 mtime
    // 使 SESSION-DISABLED 复合判据的 ⑤ 推进量合取项（会话心跳 ≥T 未动，gap-idle-watch-session-disabled-
    // false-positive-long-tasks）为真——本 fixture 模拟「已停摆」的饱和会话；同时 FRESH_SECS 的
    // MARKER-STALE 交叉正控制不触发（那是一个既有事件，与本测试无关）。分类器读记录内容不读文件 mtime。
    writeTranscript(satX, [assistantUsageRecord(isoAgo(0.1), 600000), userInputRecord(isoAgo(0.05))], 20);
    // 普通忙 fixture：低上下文 + 挂起 tool_use（回合进行中=忙），与饱和会话在「忙」维度同形。
    writeTranscript(busyX, [assistantToolUseRecord(isoAgo(0.1))], 1);
    assert.ok(await waitForAlive(p.env, p.session), "probe must be alive");
    const monSat = spawnMonitor(p.env, `sat ${p.tmp} ${p.session}`, { transcripts: `sat ${satX}` });
    const monBusy = spawnMonitor(p.env, `busy ${p.tmp} ${p.session}`, { transcripts: `busy ${busyX}` });
    try {
      assert.ok(await waitForOutput(monSat, /SESSION-DISABLED sat/, 8000),
        `AC2: saturated fixture MUST fire SESSION-DISABLED:\n${monSat.output()}`);
      // ≥3 more rounds for both observers — load-robust (hermetic): wait on the `# ROUND` markers so
      // the "ordinary busy is NOT saturated" / "saturated is NOT idle" negative checks observe a real
      // span (a fixed wall-clock sleep can complete fewer rounds under load, making them vacuous).
      assert.ok(await waitForRounds(monBusy, 3, HANG_GUARD_MS),
        `monBusy must run ≥3 rounds for the not-saturated check:\n${monBusy.output()}`);
      assert.ok(await waitForRounds(monSat, 3, HANG_GUARD_MS),
        `monSat must run ≥3 rounds for the not-idle check:\n${monSat.output()}`);
      assert.ok(!/SESSION-DISABLED busy/.test(monBusy.output()),
        `AC2: an ordinary busy fixture must NOT fire SESSION-DISABLED (different event):\n${monBusy.output()}`);
      // 饱和 fixture 在「忙」维度也是 busy（最后一条 user → transcript_busy=1），但不得报 IDLE——
      // 它报的是 SESSION-DISABLED，与普通忙可区分（AC2：同事件 = 维度仍未测量）。
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
  // writeTranscript backdates the FILE mtime to match the last record's content timestamp
  // (blocked ≈0.5m ago, recovered = 1m ago). A freshly-written file would read as "transcript 刚写过"
  // and fire MARKER-STALE noise — a real session's file is as old as its last write, not now.
  writeTranscript(blocked, [userRecord(isoAgo(10)), assistantRecord(isoAgo(5)),
    apiErrorRecord(isoAgo(1)), apiErrorRecord(isoAgo(0.5))], 1);
  writeTranscript(recovered, [userRecord(isoAgo(10)), apiErrorRecord(isoAgo(5)),
    assistantRecord(isoAgo(1))], 1);
  try {
    assert.ok(await waitForAlive(p.env, p.session), "probe must be alive");
    // 尾随错误正控制：错误在最末（0.5m/1m 前）⇒ CANT-SEND 报。
    const monB = spawnMonitor(p.env, `b ${p.tmp} ${p.session}`, { transcripts: `b ${blocked}`, loopMin: 0, interval: 1 });
    try {
      assert.ok(await waitForOutput(monB, /SESSION-IDLE-CANT-SEND b/, 30000),
        `AC7 positive control: trailing errors MUST report CANT-SEND:\n${monB.output()}`);
    } finally {
      monB.child.kill("SIGKILL");
      monB.cleanup();
    }
    // D4 修复：陈旧错误（5m 前）被后续成功应答（1m 前，最后一条 assistant 文本）覆盖 ⇒ 不报 CANT-SEND。
    const monR = spawnMonitor(p.env, `r ${p.tmp} ${p.session}`, { transcripts: `r ${recovered}`, loopMin: 0, interval: 1 });
    try {
      // WAIT for the positive instead of a fixed 4.5s sleep: the debounced SESSION-IDLE fires at
      // round ≥2, and under concurrent-suite load a monitor round can take >2s — the old fixed
      // window could end before the debounced IDLE fired (r298 wall-clock flake of this test). The
      // negative (no CANT-SEND) is then still valid: CANT-SEND and SESSION-IDLE are mutually
      // exclusive at the emit, so a wrongly-blocked recovered session would fire CANT-SEND at
      // round 1-2 and SESSION-IDLE r would NEVER appear.
      assert.ok(await waitForOutput(monR, /SESSION-IDLE r/, 30000),
        `AC7/D4: the recovered session must still report a REGULAR SESSION-IDLE (the freshness gate, not a blind mute):\n${monR.output()}`);
      assert.ok(!/SESSION-IDLE-CANT-SEND/.test(monR.output()),
        `AC7/D4: a stale error superseded by a successful response MUST NOT report CANT-SEND:\n${monR.output()}`);
    } finally {
      monR.child.kill("SIGKILL");
      monR.cleanup();
    }
  } finally {
    p.cleanup();
  }
});

test("AC1/AC2 — a permission-prompt pane is NOT busy: --pane-state reads state=permission-prompt busy=0 intervention=1 (pre-fix it read busy=1 — 卡权限框与在干活同形)", () => {
  const perm = "Quick safety check: Is this a project you created or one you trust?\n❯ 1. Yes, I trust this folder ✔\n  2. No, exit\nEnter to confirm · Esc to cancel";
  const r = spawnSync("bash", [SCRIPT, "--pane-state"], { input: perm, encoding: "utf8" });
  assert.equal(r.status, 0, `--pane-state must exit 0:\n${r.stderr}`);
  assert.match(r.stdout, /state=permission-prompt busy=0 intervention=1/,
    `permission-prompt must be non-busy and intervention-flagged (the pre-fix reading was busy=1):\n${r.stdout}`);
});

test("AC4 — normal busy is NOT intervention-flagged (negative control): --pane-state on a busy pane reads busy=1 intervention=0; waiting-input reads busy=0 intervention=0", () => {
  const busy = "───────────────────────────────\n❯ \n───────────────────────────────\n  ⏵⏵ bypass permissions on · 1 monitor · esc to interrupt · ← 1 agent · ↓ to manage";
  const rb = spawnSync("bash", [SCRIPT, "--pane-state"], { input: busy, encoding: "utf8" });
  assert.equal(rb.status, 0, `--pane-state must exit 0:\n${rb.stderr}`);
  assert.match(rb.stdout, /state=busy busy=1 intervention=0/,
    `true busy must stay busy with NO intervention (正常忙碌不误报):\n${rb.stdout}`);
  const idle = "───────────────────────────────\n❯ \n───────────────────────────────\n  ⏵⏵ bypass permissions on · 1 monitor · ← 1 agent · ↓ to manage";
  const ri = spawnSync("bash", [SCRIPT, "--pane-state"], { input: idle, encoding: "utf8" });
  assert.match(ri.stdout, /state=waiting-input busy=0 intervention=0/,
    `waiting-input must stay idle with NO intervention:\n${ri.stdout}`);
});

test("## Contract — --check exits 0 and reports permission_prompt_class=intervention-required + busy_true_work_not_flagged=1 + intervention_triggered=1 (the three contract bands)", () => {
  const r = spawnSync("bash", [SCRIPT, "--check"], { encoding: "utf8" });
  assert.equal(r.status, 0, `--check must exit 0 (all contract bands hold):\n${r.stdout}\n${r.stderr}`);
  assert.match(r.stdout, /permission_prompt_class=intervention-required/,
    `--check must report the new non-busy state (measure permission_prompt_class band=非 busy):\n${r.stdout}`);
  assert.match(r.stdout, /busy_true_work_not_flagged=1/,
    `--check must report busy-not-flagged (invariant busy_true_work_not_flagged=1, AC4 negative control):\n${r.stdout}`);
  assert.match(r.stdout, /intervention_triggered=1/,
    `--check must report intervention triggered (invariant intervention_triggered=1, AC3):\n${r.stdout}`);
});

