// @test-group lowconc
// @load-sensitive wall-clock
// session-liveness-heartbeat.test.mjs — transcript + multi-source heartbeat, OVERDUE drivers, idle noise-gating, LOOP_MIN
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
// /tmp prefix "session-liveness-hb-" — the hermetic probe constructors create dirs under it (via
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
// Run: scripts/test.sh session-liveness-heartbeat.test.mjs   /   node --test session-liveness-heartbeat.test.mjs   /   scripts/test.sh --group lowconc

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
  makeBackdatedGitRepo, makeFreshGitRepo, initGitRepo,
  makePaneBusy, makePaneIdle, startTouchLoop,
} from "./session-liveness-helpers.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// OWN the /tmp probe prefix for this split file (see SPLIT CONCURRENCY SAFETY):
setProbeTmpPrefix("session-liveness-hb-");

// KNOWN-LOAD-SENSITIVE: under suite load a hermetic-probe test can be cancelled mid-run,
// skipping its finally → this file's /tmp dirs leak (server + socket stay alive) and trip the
// suite-tail tmux-leak-scan. reapLiveOwners() FIRST kills this process's OWN still-alive probe
// servers (a cancelled test's residue — sweepTmp cannot: it skips live-owner dirs by design), then
// sweepTmp removes owner-dead residue. Sweep ONLY this file's own prefixes (see SPLIT CONCURRENCY
// SAFETY above — never a sibling's).
after(() => {
  reapLiveOwners();
  sweepTmp("session-liveness-hb-");
});

test("F — a transcript heartbeat that keeps advancing suppresses SESSION-OVERDUE; freezing it fires OVERDUE (the death mechanism)", { skip: tmuxAvailable ? false : "tmux not installed" }, async () => {
  const p = makeHermeticProbe("ol-xscript");
  const xscript = path.join(p.tmp, "session.jsonl");
  let toucher = null;
  try {
    fs.writeFileSync(xscript, "{}\n"); // the transcript file exists
    assert.ok(await waitForAlive(p.env, p.session), "probe must be alive first");
    const mon = spawnMonitor(p.env, `inner ${p.tmp} ${p.session}`, { transcripts: `inner ${xscript}`, overdueMin: 1 });
    try {
      // phase 1: a live session writes to its transcript continuously → staleness stays ~0 → no OVERDUE.
      toucher = startTouchLoop(xscript);
      await sleep(4500); // ≥4 rounds with an ADVANCING transcript
      assert.ok(!/SESSION-OVERDUE/.test(mon.output()),
        `OVERDUE must stay silent while the transcript advances (AC2 direction 1):\n${mon.output()}`);
      toucher.kill("SIGKILL"); toucher = null;
      // phase 2: the session died → its transcript stops advancing. Backdating simulates OVERDUE_MIN elapsed.
      spawnSync("touch", ["-d", "3 hours ago", xscript], { encoding: "utf8" });
      assert.ok(await waitForOutput(mon, /SESSION-OVERDUE inner/, 6000),
        `OVERDUE must fire once the transcript freezes (AC3 direction 2 — the whole point):\n${mon.output()}`);
    } finally {
      mon.child.kill("SIGKILL");
    mon.cleanup();
    }
  } finally {
    if (toucher) toucher.kill("SIGKILL");
    p.cleanup();
  }
});

test("F2 — a transcript heartbeat includes its subagents dir: stale main + fresh subagent = not overdue (inner busy delegating)", { skip: tmuxAvailable ? false : "tmux not installed" }, async () => {
  const p = makeHermeticProbe("ol-xsub");
  const xscript = path.join(p.tmp, "session.jsonl");
  const agent = path.join(p.tmp, "session", "subagents", "agent-1.jsonl");
  try {
    fs.mkdirSync(path.dirname(agent), { recursive: true });
    fs.writeFileSync(xscript, "{}\n");
    fs.writeFileSync(agent, "{}\n");
    spawnSync("touch", ["-d", "3 hours ago", xscript], { encoding: "utf8" }); // main transcript stale
    assert.ok(await waitForAlive(p.env, p.session), "probe must be alive first");
    const mon = spawnMonitor(p.env, `inner ${p.tmp} ${p.session}`, { transcripts: `inner ${xscript}`, overdueMin: 1 });
    try {
      const toucher = startTouchLoop(agent); // the subagent keeps writing while the main is quiet
      try {
        await sleep(3500);
        assert.ok(!/SESSION-OVERDUE/.test(mon.output()),
          `fresh subagent activity must keep the transcript heartbeat alive:\n${mon.output()}`);
      } finally { toucher.kill("SIGKILL"); }
      spawnSync("touch", ["-d", "3 hours ago", agent], { encoding: "utf8" }); // subagent stops too
      assert.ok(await waitForOutput(mon, /SESSION-OVERDUE inner/, 6000),
        `OVERDUE must fire once BOTH main and subagent transcripts freeze:\n${mon.output()}`);
    } finally {
      mon.child.kill("SIGKILL");
    mon.cleanup();
    }
  } finally {
    p.cleanup();
  }
});

test("F3 — SESSION_TRANSCRIPTS accepts a session id and resolves it under $HOME/.claude/projects/<root-slug>/", { skip: tmuxAvailable ? false : "tmux not installed" }, async () => {
  const p = makeHermeticProbe("ol-xid");
  const home = path.join(p.tmp, "home");
  const slug = p.tmp.replace(/[\\/]+/g, "-"); // /tmp/session-liveness-XXX → -tmp-session-liveness-XXX
  const sid = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
  const transcript = path.join(home, ".claude", "projects", slug, `${sid}.jsonl`);
  try {
    fs.mkdirSync(path.dirname(transcript), { recursive: true });
    fs.writeFileSync(transcript, "{}\n");
    spawnSync("touch", ["-d", "3 hours ago", transcript], { encoding: "utf8" });
    assert.ok(await waitForAlive(p.env, p.session), "probe must be alive first");
    const mon = spawnMonitor({ ...p.env, HOME: home }, `inner ${p.tmp} ${p.session}`,
      { transcripts: `inner ${sid}`, overdueMin: 1 });
    try {
      assert.ok(await waitForOutput(mon, /SESSION-OVERDUE inner/, 6000),
        `a session-id selector must resolve to $HOME/.claude/projects/<slug>/<id>.jsonl:\n${mon.output()}`);
    } finally {
      mon.child.kill("SIGKILL");
    mon.cleanup();
    }
  } finally {
    p.cleanup();
  }
});

test("AC2 — 多源外层心跳：红窗处置（最近提交 + 新 queue-state + 旧 tick-log）⇒ 不报 SESSION-OVERDUE（反向失效消除）", { skip: tmuxAvailable ? false : "tmux not installed" }, async () => {
  const p = makeHermeticProbe("ol-multi-ok");
  const ws = path.join(p.tmp, "ws");
  try {
    initGitRepo(ws, {}); // 最近提交（红窗处置的产出）
    fs.mkdirSync(path.join(ws, "docs", "analysis"), { recursive: true });
    fs.writeFileSync(path.join(ws, "docs", "analysis", "batch2-queue-state.md"), "# queue-state\n");
    fs.mkdirSync(path.join(ws, "orchestration"), { recursive: true });
    fs.writeFileSync(path.join(ws, "orchestration", "tick-log.md"), "# tick\n");
    spawnSync("touch", ["-d", "3 hours ago", path.join(ws, "orchestration", "tick-log.md")], { encoding: "utf8" });
    assert.ok(await waitForAlive(p.env, p.session), "probe must be alive first");
    const mon = spawnMonitor(p.env, `outer ${ws} ${p.session}`, { overdueMin: 1 });
    try {
      await sleep(4000);
      assert.ok(!/SESSION-OVERDUE/.test(mon.output()),
        `红窗处置（写 queue-state + 提交、不写 tick-log）必须不报 OVERDUE（反向失效消除）:\n${mon.output()}`);
    } finally {
      mon.child.kill("SIGKILL");
      mon.cleanup();
    }
  } finally {
    p.cleanup();
  }
});

test("AC3 — 多源外层心跳：30 分钟零产出（全源旧）⇒ 仍报 SESSION-OVERDUE（真阳性保留）", { skip: tmuxAvailable ? false : "tmux not installed" }, async () => {
  const p = makeHermeticProbe("ol-multi-stale");
  const ws = path.join(p.tmp, "ws");
  try {
    initGitRepo(ws, { authorDate: "2000-01-01T00:00:00Z" }); // 旧提交（无产出）
    fs.mkdirSync(path.join(ws, "orchestration"), { recursive: true });
    fs.writeFileSync(path.join(ws, "orchestration", "tick-log.md"), "# tick\n");
    spawnSync("touch", ["-d", "3 hours ago", path.join(ws, "orchestration", "tick-log.md")], { encoding: "utf8" });
    assert.ok(await waitForAlive(p.env, p.session), "probe must be alive first");
    const mon = spawnMonitor(p.env, `outer ${ws} ${p.session}`, { overdueMin: 1 });
    try {
      assert.ok(await waitForOutput(mon, /SESSION-OVERDUE outer/, 6000),
        `全源（提交/tick-log/queue-state）都旧 ⇒ 必须报 OVERDUE（真阳性保留）:\n${mon.output()}`);
    } finally {
      mon.child.kill("SIGKILL");
      mon.cleanup();
    }
  } finally {
    p.cleanup();
  }
});

test("AC4 — OVERDUE 信号可区分：真阳性消息自带「多源心跳」说明（无需手工查提交历史）；假阳性（有产出）从信号本身不报", { skip: tmuxAvailable ? false : "tmux not installed" }, async () => {
  const p = makeHermeticProbe("ol-multi-sig");
  const ws = path.join(p.tmp, "ws");
  try {
    // 假阳性场景：有产出（最近提交 + 新 queue-state）但 tick-log 旧 ⇒ 从信号本身不报 OVERDUE
    initGitRepo(ws, {});
    fs.mkdirSync(path.join(ws, "docs", "analysis"), { recursive: true });
    fs.writeFileSync(path.join(ws, "docs", "analysis", "batch2-queue-state.md"), "# queue-state\n");
    fs.mkdirSync(path.join(ws, "orchestration"), { recursive: true });
    fs.writeFileSync(path.join(ws, "orchestration", "tick-log.md"), "# tick\n");
    spawnSync("touch", ["-d", "3 hours ago", path.join(ws, "orchestration", "tick-log.md")], { encoding: "utf8" });
    assert.ok(await waitForAlive(p.env, p.session), "probe must be alive first");
    const mon = spawnMonitor(p.env, `outer ${ws} ${p.session}`, { overdueMin: 1 });
    try {
      await sleep(4000);
      assert.ok(!/SESSION-OVERDUE/.test(mon.output()),
        `假阳性（有产出但 tick-log 旧）必须从信号本身不报 OVERDUE:\n${mon.output()}`);
    } finally {
      mon.child.kill("SIGKILL");
      mon.cleanup();
    }
    // 真阳性场景：全源旧 ⇒ 报 OVERDUE，且消息自带「多源心跳」自说明（区分判据写在信号里）
    const ws2 = path.join(p.tmp, "ws2");
    initGitRepo(ws2, { authorDate: "2000-01-01T00:00:00Z" });
    fs.mkdirSync(path.join(ws2, "orchestration"), { recursive: true });
    fs.writeFileSync(path.join(ws2, "orchestration", "tick-log.md"), "# tick\n");
    spawnSync("touch", ["-d", "3 hours ago", path.join(ws2, "orchestration", "tick-log.md")], { encoding: "utf8" });
    const mon2 = spawnMonitor(p.env, `outer ${ws2} ${p.session}`, { overdueMin: 1 });
    try {
      assert.ok(await waitForOutput(mon2, /SESSION-OVERDUE outer/, 6000),
        `真阳性（全源旧）必须报 OVERDUE:\n${mon2.output()}`);
      assert.ok(/多源心跳/.test(mon2.output()),
        `OVERDUE 消息必须自带「多源心跳」说明（AC4：不需手工查提交历史即可区分）:\n${mon2.output()}`);
    } finally {
      mon2.child.kill("SIGKILL");
      mon2.cleanup();
    }
  } finally {
    p.cleanup();
  }
});

test("noise gate — an idle transition with an OLD tick log IS reported (idle but no tick = anomaly)", async () => {
  const p = makeHermeticProbe("ol-gate-old");
  const tick = path.join(p.tmp, "tick.md");
  try {
    fs.writeFileSync(tick, "# tick\n");
    spawnSync("touch", ["-d", "3 hours ago", tick], { encoding: "utf8" });
    assert.ok(await waitForAlive(p.env, p.session), "probe must be alive first");
    const mon = spawnMonitor(p.env, `gate ${p.tmp} ${p.session}`, { tickLogs: `gate ${tick}`, interval: 1, loopMin: 5 });
    try {
      // Idle baseline MUST establish ≥2 rounds so PREV_IDLE=1 is armed BEFORE the busy transition —
      // the SESSION-RESUMED edge (idle→busy) requires a prior idle round; a fixed 2.5s sleep can be
      // as few as one slow round (classifier subprocess latency) under full-suite load and the edge
      // would never arm (same root cause as the AC4 negative control at signals-integration:368).
      assert.ok(await waitForRounds(mon, 2, 20000),
        `idle baseline must establish 2 rounds so PREV_IDLE=1 is armed before the busy edge:\n${mon.output()}`);
      makePaneBusy(p.env, p.session); // shape-busy (ruling D): busy shape, not content redraw
      assert.ok(await waitForOutput(mon, /SESSION-RESUMED gate/, 25000), `RESUMED must fire on busy:\n${mon.output()}`);
      makePaneIdle(p.env, p.session); // back to the idle shape
      assert.ok(await waitForOutput(mon, /SESSION-IDLE gate/, 10000),
        `IDLE must fire when the tick is stale (idle but no tick):\n${mon.output()}`);
    } finally {
      mon.child.kill("SIGKILL");
    mon.cleanup();
    }
  } finally {
    p.cleanup();
  }
});

test("noise gate — an idle transition with a FRESH tick log is SILENT (healthy cycle end)", async () => {
  const p = makeHermeticProbe("ol-gate-fresh");
  const tick = path.join(p.tmp, "tick.md");
  try {
    fs.writeFileSync(tick, "# tick\n"); // mtime = now → tmin ≈ 0, well under LOOP_MIN=5
    assert.ok(await waitForAlive(p.env, p.session), "probe must be alive first");
    const mon = spawnMonitor(p.env, `gate ${p.tmp} ${p.session}`, { tickLogs: `gate ${tick}`, interval: 1, loopMin: 5 });
    try {
      // Idle baseline MUST establish ≥2 rounds so PREV_IDLE=1 is armed BEFORE the busy transition —
      // the SESSION-RESUMED edge (idle→busy) requires a prior idle round; a fixed 2.5s sleep can be
      // as few as one slow round (classifier subprocess latency) under full-suite load and the edge
      // would never arm (same root cause as the AC4 negative control at signals-integration:368).
      assert.ok(await waitForRounds(mon, 2, 20000),
        `idle baseline must establish 2 rounds so PREV_IDLE=1 is armed before the busy edge:\n${mon.output()}`);
      makePaneBusy(p.env, p.session); // shape-busy (ruling D)
      assert.ok(await waitForOutput(mon, /SESSION-RESUMED gate/, 25000), `RESUMED must fire on busy (monitor is tracking):\n${mon.output()}`);
      makePaneIdle(p.env, p.session); // back to the idle shape
      await sleep(3500); // ≥3 rounds after idle — IDLE would have fired by now if not gated
      assert.ok(!/SESSION-IDLE/.test(mon.output()),
        `IDLE must be SILENT when the tick is fresh (healthy cycle end, noise gate):\n${mon.output()}`);
    } finally {
      mon.child.kill("SIGKILL");
    mon.cleanup();
    }
  } finally {
    p.cleanup();
  }
});

test("AC11 — a DIRECTORY heartbeat (inner-style .workflow-events/) triggers the same overdue criterion — the same script parameterizes for outer and inner", async () => {
  const p = makeHermeticProbe("ol-hbdir");
  const hbDir = path.join(p.tmp, "workflow-events");
  try {
    fs.mkdirSync(hbDir, { recursive: true });
    fs.writeFileSync(path.join(hbDir, "seed.jsonl"), "# seed\n");
    const old = spawnSync("touch", ["-d", "3 hours ago", hbDir], { encoding: "utf8" }); // dir mtime backdated
    assert.equal(old.status, 0, `touch -d failed: ${old.stderr}`);
    assert.ok(await waitForAlive(p.env, p.session), "probe must be alive first");
    const mon = spawnMonitor(p.env, `inner ${p.tmp} ${p.session}`, { tickLogs: `inner ${hbDir}`, overdueMin: 1 });
    try {
      assert.ok(await waitForOutput(mon, /SESSION-OVERDUE inner/, 6000),
        `a directory heartbeat (inner work-output) must trigger the same overdue criterion:\n${mon.output()}`);
    } finally {
      mon.child.kill("SIGKILL");
    mon.cleanup();
    }
  } finally {
    p.cleanup();
  }
});

test("AC5 — OVERDUE_MIN default is 30 (non-self-healing, prefer false-positive: earlier than 45); the shipped outer tick doc carries the value", () => {
  const src = fs.readFileSync(SCRIPT, "utf8");
  assert.match(src, /OVERDUE_MIN=\$\{OVERDUE_MIN:-30\}/,
    "OVERDUE_MIN default must be 30 after the AC5 reverse-tuning (45 → 30)");
  const doc = fs.readFileSync(path.resolve(__dirname, "..", "loop", "orchestrator-loop-tick.md"), "utf8");
  const row = doc.match(/\| `OVERDUE_MIN` \| `(\d+)` \|/);
  assert.ok(row && row[1] === "30", `the outer tick doc must document OVERDUE_MIN=30, got ${row && row[1]}:\n${doc.slice(0, 2000)}`);
});

test("AC2 — 红窗处置（写 queue-state + 提交、tick-log 不动）⇒ 心跳保持新鲜、不报 SESSION-OVERDUE（反向失效消除）", { skip: tmuxAvailable ? false : "tmux not installed" }, async () => {
  const p = makeHermeticProbe("ol-multi-ac2");
  const root = path.join(p.tmp, "incident");
  try {
    fs.mkdirSync(path.join(root, "docs", "analysis"), { recursive: true });
    fs.mkdirSync(path.join(root, "orchestration"), { recursive: true });
    makeFreshGitRepo(root); // 红窗处置产出的提交（新鲜）
    fs.writeFileSync(path.join(root, "docs", "analysis", "batch2-queue-state.md"), "queue\n"); // 新鲜 queue-state
    fs.writeFileSync(path.join(root, "orchestration", "tick-log.md"), "# tick\n"); // tick-log 存在但陈旧
    spawnSync("touch", ["-d", "3 hours ago", path.join(root, "orchestration", "tick-log.md")], { encoding: "utf8" });
    assert.ok(await waitForAlive(p.env, p.session), "probe must be alive first");
    // 无显式心跳覆盖 → 默认外层心跳 = 多源 max mtime；SESSION_ROOT=root 使默认心跳源落在 root 下。
    const mon = spawnMonitor({ ...p.env, SESSION_ROOT: root }, `incident ${root} ${p.session}`, { overdueMin: 1 });
    try {
      await sleep(4500); // ≥4 轮——单源 tick-log（3h 旧）会在第 1-2 轮就报 OVERDUE；多源必须不报
      assert.ok(!/SESSION-OVERDUE incident/.test(mon.output()),
        `AC2: 红窗处置（写 queue-state + 提交、不写 tick-log）必须不报 OVERDUE（反向失效消除）:\n${mon.output()}`);
      // 正控制：监视器没死——GONE 仍报
      tmux(["send-keys", "-t", p.session, "kill %1"], p.env);
      tmux(["send-keys", "-t", p.session, "Enter"], p.env);
      assert.ok(await waitForOutput(mon, /SESSION-GONE incident/, 6000),
        `AC2 正控制: 监视器必须仍活着（GONE 仍报）:\n${mon.output()}`);
    } finally {
      mon.child.kill("SIGKILL");
      mon.cleanup();
    }
  } finally {
    p.cleanup();
  }
});

test("AC3 — 30 分钟无任何产出 ⇒ SESSION-OVERDUE 仍报（真阳性保留；多源下所有源都陈旧）", { skip: tmuxAvailable ? false : "tmux not installed" }, async () => {
  const p = makeHermeticProbe("ol-multi-ac3");
  const root = path.join(p.tmp, "stale");
  try {
    fs.mkdirSync(path.join(root, "docs", "analysis"), { recursive: true });
    fs.mkdirSync(path.join(root, "orchestration"), { recursive: true });
    makeBackdatedGitRepo(root); // HEAD commit 2000（陈旧）
    fs.writeFileSync(path.join(root, "docs", "analysis", "batch2-queue-state.md"), "queue\n");
    fs.writeFileSync(path.join(root, "orchestration", "tick-log.md"), "# tick\n");
    spawnSync("touch", ["-d", "3 hours ago", path.join(root, "docs", "analysis", "batch2-queue-state.md")], { encoding: "utf8" });
    spawnSync("touch", ["-d", "3 hours ago", path.join(root, "orchestration", "tick-log.md")], { encoding: "utf8" });
    assert.ok(await waitForAlive(p.env, p.session), "probe must be alive first");
    const mon = spawnMonitor({ ...p.env, SESSION_ROOT: root }, `stale ${root} ${p.session}`, { overdueMin: 1 });
    try {
      assert.ok(await waitForOutput(mon, /SESSION-OVERDUE stale/, 8000),
        `AC3: 30 分钟无任何产出 ⇒ OVERDUE 必须仍报（真阳性保留，红着没人碰必须被抓）:\n${mon.output()}`);
    } finally {
      mon.child.kill("SIGKILL");
      mon.cleanup();
    }
  } finally {
    p.cleanup();
  }
});

test("AC4 — 信号可区分：同一目标先有产出（不报 OVERDUE）→ 全部源变陈旧（报 OVERDUE）——假阳/真阳从信号本身可判，不需查提交历史", { skip: tmuxAvailable ? false : "tmux not installed" }, async () => {
  const p = makeHermeticProbe("ol-multi-ac4");
  const root = path.join(p.tmp, "distinguish");
  try {
    fs.mkdirSync(path.join(root, "docs", "analysis"), { recursive: true });
    fs.mkdirSync(path.join(root, "orchestration"), { recursive: true });
    makeFreshGitRepo(root);
    fs.writeFileSync(path.join(root, "docs", "analysis", "batch2-queue-state.md"), "queue\n");
    fs.writeFileSync(path.join(root, "orchestration", "tick-log.md"), "# tick\n");
    spawnSync("touch", ["-d", "3 hours ago", path.join(root, "orchestration", "tick-log.md")], { encoding: "utf8" });
    assert.ok(await waitForAlive(p.env, p.session), "probe must be alive first");
    const mon = spawnMonitor({ ...p.env, SESSION_ROOT: root }, `dist ${root} ${p.session}`, { overdueMin: 1 });
    try {
      // phase 1: 有产出（queue-state + 提交新鲜、tick-log 旧）→ 假阳性必须不报 OVERDUE
      await sleep(4500);
      assert.ok(!/SESSION-OVERDUE dist/.test(mon.output()),
        `AC4 phase 1: 有产出但 tick-log 旧 ⇒ 假阳性必须不报（从信号本身可判）:\n${mon.output()}`);
      // phase 2: 30 分钟零产出——queue-state 与 HEAD 提交都变陈旧 → 真阳性必须报
      spawnSync("touch", ["-d", "3 hours ago", path.join(root, "docs", "analysis", "batch2-queue-state.md")], { encoding: "utf8" });
      const envB = { ...process.env, GIT_AUTHOR_DATE: "2000-01-01T00:00:00Z", GIT_COMMITTER_DATE: "2000-01-01T00:00:00Z" };
      fs.writeFileSync(path.join(root, "a.txt"), "y\n");
      spawnSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "add", "."], { encoding: "utf8", cwd: root });
      const bd = spawnSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "-m", "backdate"], { encoding: "utf8", cwd: root, env: envB });
      assert.equal(bd.status, 0, `backdate commit failed: ${bd.stderr}`);
      assert.ok(await waitForOutput(mon, /SESSION-OVERDUE dist/, 8000),
        `AC4 phase 2: 30 分钟零产出 ⇒ 真阳性必须报（红着没人碰必须被抓，从信号本身可判）:\n${mon.output()}`);
    } finally {
      mon.child.kill("SIGKILL");
      mon.cleanup();
    }
  } finally {
    p.cleanup();
  }
});

test("Contract — --selfcheck passes (exit 0): red-window heartbeat FRESH, zero-output heartbeat STALE, PASS", () => {
  const r = spawnSync("bash", [SCRIPT, "--selfcheck"], { encoding: "utf8" });
  assert.equal(r.status, 0, `selfcheck must exit 0:\n${r.stdout}\n${r.stderr}`);
  const fresh = r.stdout.match(/red-window-heartbeat_min=(\d+)/);
  assert.ok(fresh, `selfcheck must report red-window-heartbeat_min:\n${r.stdout}`);
  const stale = r.stdout.match(/zero-output-heartbeat_min=(\d+)/);
  assert.ok(stale, `selfcheck must report zero-output-heartbeat_min:\n${r.stdout}`);
  const overdue = r.stdout.match(/OVERDUE_MIN=(\d+)/);
  assert.ok(overdue, `selfcheck must report OVERDUE_MIN:\n${r.stdout}`);
  assert.ok(Number(fresh[1]) < Number(overdue[1]),
    `incident handling must keep the heartbeat FRESH (AC2 反向失效消除): red-window ${fresh[1]} < OVERDUE_MIN ${overdue[1]}:\n${r.stdout}`);
  assert.ok(Number(stale[1]) >= Number(overdue[1]),
    `zero output must go STALE (AC3 真阳性保留): zero-output ${stale[1]} >= OVERDUE_MIN ${overdue[1]}:\n${r.stdout}`);
  assert.match(r.stdout, /selfcheck: PASS/, `selfcheck must report PASS:\n${r.stdout}`);
});
