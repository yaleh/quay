// @test-group engine
// @load-sensitive wall-clock
// session-liveness-signals-thresholds.test.mjs — 阈值行为 — 去抖轮数 / LOOP_MIN 噪声闸 / per-spell 沿 / warmup / 同阶去抖 / 权限提示阈值
//
// PART OF THE session-liveness test family. Split from session-liveness-signals.test.mjs by
// gap-split-session-liveness-signals-unblocks-lowconc (2026-08-11): that single file was the
// lowconc phase's CEILING (216s > 440095/3 = 146.7s ideal-split at cc=3, __GROUP__ capped=1).
// Splitting the 27-probe file into per-focus files (信号种类 / 阈值行为 / 集成断言) lets cc=3 run
// them in PARALLEL and returns the phase to the floor. This file covers 阈值行为 — 去抖轮数 / LOOP_MIN 噪声闸 / per-spell 沿 / warmup / 同阶去抖 / 权限提示阈值.
//
// FURTHER SPLIT BY gap-split-three-phase-floor-files (2026-08-12): this file was again the lowconc
// phase's floor (~88s at cc=12). It is split into THREE per-focus files — debounce/blip threshold
// tests stay HERE, the per-spell edge + warmup + mount-stall tests move to
// session-liveness-signals-thresholds-edge.test.mjs, and the observers + boundary tests move to
// session-liveness-signals-thresholds-observers.test.mjs. The test BODIES are byte-identical to
// the pre-split file; only their file placement changed. Each split file owns a DISTINCT /tmp
// probe prefix (see SPLIT CONCURRENCY SAFETY), so a sibling's after() sweep can never delete this
// file's active probes.
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
setProbeTmpPrefix("session-liveness-sig-t-");

// KNOWN-LOAD-SENSITIVE: under suite load a hermetic-probe test can be cancelled mid-run,
// skipping its finally → this file's /tmp dirs leak (server + socket stay alive) and trip the
// suite-tail tmux-leak-scan. reapLiveOwners() FIRST kills this process's OWN still-alive probe
// servers (a cancelled test's residue — sweepTmp cannot: it skips live-owner dirs by design), then
// sweepTmp removes owner-dead residue. Sweep ONLY this file's own prefixes (see SPLIT CONCURRENCY
// SAFETY above — never a sibling's).
after(() => {
  sessionLivenessAfter("session-liveness-sig-t-");
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
