// @test-group engine
// @load-sensitive wall-clock
// session-liveness-signals-integration.test.mjs — 集成断言 — 脚本接缝（--mask/--last-message-type/--saturation/--pane-state/--check/--selfcheck）、头注释、主循环接线
//
// PART OF THE session-liveness test family. Split from session-liveness-signals.test.mjs by
// gap-split-session-liveness-signals-unblocks-lowconc (2026-08-11): that single file was the
// lowconc phase's CEILING (216s > 440095/3 = 146.7s ideal-split at cc=3, __GROUP__ capped=1).
// Splitting the 27-probe file into per-focus files (信号种类 / 阈值行为 / 集成断言) lets cc=3 run
// them in PARALLEL and returns the phase to the floor. This file covers 集成断言 — 脚本接缝（--mask/--last-message-type/--saturation/--pane-state/--check/--selfcheck）、头注释、主循环接线.
//
// SPLIT CONCURRENCY SAFETY: this file runs as its OWN node process at cc=3. It owns the
// /tmp prefix "session-liveness-sig-i-" — the hermetic probe constructors create dirs under it (via
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
// Run: node --test session-liveness-signals-integration.test.mjs   /   scripts/test.sh --group lowconc

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
  spawnMonitor, waitForOutput, waitForRounds, waitForMoreRounds, countRounds,
  makePaneBusy, makePaneIdle, makePanePermissionPrompt, startTouchLoop, cleanup,
  userRecord, assistantRecord, apiErrorRecord, isoAgo,
  assistantToolUseRecord, assistantTextRecord, userInputRecord, writeTranscript,
  assistantUsageRecord, HANG_GUARD_MS,
} from "./session-liveness-helpers.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// OWN the /tmp probe prefix for this split file (see SPLIT CONCURRENCY SAFETY):
setProbeTmpPrefix("session-liveness-sig-i-");

// KNOWN-LOAD-SENSITIVE: under suite load a hermetic-probe test can be cancelled mid-run,
// skipping its finally → this file's /tmp dirs leak (server + socket stay alive) and trip the
// suite-tail tmux-leak-scan. reapLiveOwners() FIRST kills this process's OWN still-alive probe
// servers (a cancelled test's residue — sweepTmp cannot: it skips live-owner dirs by design), then
// sweepTmp removes owner-dead residue. Sweep ONLY this file's own prefixes (see SPLIT CONCURRENCY
// SAFETY above — never a sibling's).
after(() => {
  sessionLivenessAfter("session-liveness-sig-i-", "sl-lmt-", "sl-sat-");
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

test("AC4 — the script header documents the screen-vs-transcript tradeoff, each signal's blind spot, and which wins when both are used", () => {
  const src = fs.readFileSync(SCRIPT, "utf8");
  assert.ok(src.includes("两种信号"), "header must carry the AC4 两种信号 section");
  assert.ok(src.includes("同时用时以谁为准"), "header must state which signal wins when both are used");
  assert.ok(src.includes("盲区"), "header must name each signal's blind spot");
  assert.ok(src.includes("SESSION-MARKER-STALE"), "header must name the cross positive control event (AC2)");
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
      // Idle baseline MUST establish ≥2 rounds so PREV_IDLE=1 is armed BEFORE the busy transition —
      // the SESSION-RESUMED edge (idle→busy) requires a prior idle round; a fixed 2.5s sleep can be
      // as few as one slow round under full-suite load (same root cause as the AC4 negative control
      // at line 368 below — that test's waitForRounds is the load-robust form).
      assert.ok(await waitForRounds(mon, 2, 20000),
        `idle baseline must establish 2 rounds so PREV_IDLE=1 is armed before the busy edge:\n${mon.output()}`);
      // real work in a Claude Code pane: the agent task line is visible (printed) AND the busy
      // shape (esc typed) is present. Idle → busy must surface as SESSION-RESUMED within a few
      // polling cycles (AC7: no debounce was added to the busy path).
      tmux(["send-keys", "-t", p.session, "printf '◯ general-purpose Reading session-liveness.test.mjs 1m 35s · ↓ 57.3k tokens\\n'"], p.env);
      tmux(["send-keys", "-t", p.session, "Enter"], p.env);
      makePaneBusy(p.env, p.session);
      const t0 = Date.now();
      assert.ok(await waitForOutput(mon, /SESSION-RESUMED ac4/, 30000),
        `AC4: RESUMED must fire promptly when real work starts:\n${mon.output()}`);
      const latencyMs = Date.now() - t0;
      assert.ok(latencyMs < HANG_GUARD_MS,
        `AC7: busy_latency must stay within the hang-guard (no multi-minute debounce on the busy path): ${latencyMs}ms`);
      assert.ok(/成因：esc to interrupt 标志出现/.test(mon.output()),
        `AC4: the RESUMED cause must name the busy shape:\n${mon.output()}`);
      // while busy, only the agent task line advances (↓ 57.3k → 61.2k) — the busy shape persists,
      // so no false IDLE (the AC4 negative-control direction: real content must not read as idle).
      tmux(["send-keys", "-t", p.session, "printf '◯ general-purpose Reading session-liveness.test.mjs 1m 41s · ↓ 61.2k tokens\\n'"], p.env);
      tmux(["send-keys", "-t", p.session, "Enter"], p.env);
      makePaneBusy(p.env, p.session); // re-affirm the busy shape in the status area
      // ≥3 MORE busy rounds — load-robust (hermetic): the `# ROUND` marker is the deterministic time
      // source; a fixed wall-clock sleep can complete fewer rounds under load, weakening the
      // no-false-IDLE check (waitForMoreRounds, not waitForRounds — the monitor has already run).
      assert.ok(await waitForMoreRounds(mon, 3, HANG_GUARD_MS),
        `monitor must run ≥3 MORE busy rounds for the no-false-IDLE check:\n${mon.output()}`);
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
      // Idle baseline MUST establish ≥2 rounds so PREV_IDLE=1 is armed BEFORE the busy transition
      // (RESUMED is an idle→busy edge — a fixed sleep can be one slow round under full-suite load).
      assert.ok(await waitForRounds(mon, 2, 20000),
        `idle baseline must establish 2 rounds so PREV_IDLE=1 is armed before the busy edge:\n${mon.output()}`);
      // continuous work = the busy shape (esc typed) held across several rounds. With the busy
      // shape present the pane is NEVER judged idle, so RESUMED fires at most once (the real work
      // of the inner session no longer flip-flops idle→busy the way the old masked-hash did).
      makePaneBusy(p.env, p.session);
      assert.ok(await waitForOutput(mon, /SESSION-RESUMED ac9/, 30000),
        `AC9: RESUMED must fire once on the busy transition:\n${mon.output()}`);
      // ≥4 MORE rounds of continuous busy shape (esc stays in the input line). Load-robust
      // (hermetic): the `# ROUND` marker is the deterministic time source — a fixed wall-clock sleep
      // can complete fewer rounds under load, making the "at most once / no IDLE" check vacuous
      // (waitForMoreRounds, not waitForRounds — the monitor has already run).
      assert.ok(await waitForMoreRounds(mon, 4, HANG_GUARD_MS),
        `monitor must run ≥4 MORE continuous busy rounds:\n${mon.output()}`);
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

test("AC3 — a permission-prompt pane emits SESSION-INTERVENTION-REQUIRED immediately (edge-triggered once per spell); leaving permission-prompt re-arms the edge", { skip: tmuxAvailable ? false : "tmux not installed" }, async () => {
  const p = makeHermeticProbe("ol-intv");
  try {
    assert.ok(await waitForAlive(p.env, p.session), "probe must be alive");
    const mon = spawnMonitor(p.env, `intv ${p.tmp} ${p.session}`, { interval: 1 });
    try {
      // idle baseline (bash prompt → unknown → busy=0). Load-robust (hermetic): the `# ROUND`
      // marker is the deterministic time source — a fixed wall-clock sleep can complete ZERO rounds
      // under load, so the first permission-prompt round would observe PREV_INTERVENTION unset and
      // the edge semantics of the test would be ill-founded.
      assert.ok(await waitForRounds(mon, 2, HANG_GUARD_MS),
        `idle baseline must establish 2 rounds before the permission-prompt edge:\n${mon.output()}`);
      makePanePermissionPrompt(p.env, p.session);
      // Fires IMMEDIATELY (not waiting for PERM_PROMPT_WARN_ROUNDS busy rounds or transcript
      // staleness) — the AC3 requirement: permission-prompt 出现即触发 escalate/报告.
      assert.ok(await waitForOutput(mon, /SESSION-INTERVENTION-REQUIRED intv/, 30000),
        `permission-prompt must fire SESSION-INTERVENTION-REQUIRED immediately:\n${mon.output()}`);
      // hold the permission-prompt a few MORE rounds → the edge must NOT re-fire every round.
      assert.ok(await waitForMoreRounds(mon, 2, HANG_GUARD_MS),
        `monitor must hold the permission-prompt ≥2 MORE rounds for the edge-trigger check:\n${mon.output()}`);
      let c = (mon.output().match(/SESSION-INTERVENTION-REQUIRED intv/g) || []).length;
      assert.equal(c, 1, `the intervention event must be edge-triggered (once per spell), got ${c}:\n${mon.output()}`);
      // leaving permission-prompt (back to idle) re-arms the edge → a new permission-prompt fires again.
      makePaneIdle(p.env, p.session);
      // ≥1 MORE non-permission-prompt round resets PERM_CONSEC + PREV_INTERVENTION so the edge
      // re-arms — wait on the marker (a fixed sleep can complete no round under load, keeping the
      // edge armed; waitForMoreRounds because the monitor has already run many rounds).
      assert.ok(await waitForMoreRounds(mon, 1, HANG_GUARD_MS),
        `monitor must observe ≥1 MORE idle round to re-arm the intervention edge:\n${mon.output()}`);
      makePanePermissionPrompt(p.env, p.session);
      const deadline = Date.now() + HANG_GUARD_MS;
      while (Date.now() < deadline && (mon.output().match(/SESSION-INTERVENTION-REQUIRED intv/g) || []).length < 2) await sleep(200);
      c = (mon.output().match(/SESSION-INTERVENTION-REQUIRED intv/g) || []).length;
      assert.equal(c, 2, `a new permission-prompt spell must re-fire SESSION-INTERVENTION-REQUIRED (edge re-armed), got ${c}:\n${mon.output()}`);
    } finally {
      mon.child.kill("SIGKILL");
      mon.cleanup();
    }
  } finally {
    p.cleanup();
  }
});

test("AC4 — normal busy (esc to interrupt) does NOT fire SESSION-INTERVENTION-REQUIRED (negative control)", { skip: tmuxAvailable ? false : "tmux not installed" }, async () => {
  const p = makeHermeticProbe("ol-intvbusy");
  try {
    assert.ok(await waitForAlive(p.env, p.session), "probe must be alive");
    const mon = spawnMonitor(p.env, `intvb ${p.tmp} ${p.session}`, { interval: 1 });
    try {
      // Idle baseline MUST establish ≥2 rounds so PREV_IDLE=1 is armed BEFORE the busy transition —
      // the SESSION-RESUMED edge (idle→busy) requires a prior idle round; a 2s sleep can be as few
      // as one slow round (classifier subprocess latency) and the edge would never arm.
      assert.ok(await waitForRounds(mon, 2, 15000), `idle baseline must establish 2 rounds:\n${mon.output()}`);
      makePaneBusy(p.env, p.session); // real work shape: esc to interrupt
      // busy semantics preserved: the busy transition still fires SESSION-RESUMED.
      assert.ok(await waitForOutput(mon, /SESSION-RESUMED intvb/, 15000),
        `busy must still fire SESSION-RESUMED (busy semantics preserved):\n${mon.output()}`);
      // several MORE busy rounds — load-robust (hermetic): wait on the `# ROUND` marker so the
      // negative control observes a real span of busy rounds (a fixed wall-clock sleep can complete
      // fewer rounds under load, weakening the no-INTERVENTION check; waitForMoreRounds because the
      // monitor has already run).
      assert.ok(await waitForMoreRounds(mon, 3, HANG_GUARD_MS),
        `monitor must run ≥3 MORE busy rounds for the AC4 negative control:\n${mon.output()}`);
      assert.ok(!/SESSION-INTERVENTION-REQUIRED intvb/.test(mon.output()),
        `normal busy must NOT fire SESSION-INTERVENTION-REQUIRED (AC4 negative control):\n${mon.output()}`);
    } finally {
      mon.child.kill("SIGKILL");
      mon.cleanup();
    }
  } finally {
    p.cleanup();
  }
});
