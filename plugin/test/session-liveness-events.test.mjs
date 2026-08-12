// @test-group lowconc
// @load-sensitive wall-clock
// session-liveness-events.test.mjs — SESSION-GONE/BACK, REPO-STALL, SESSION-OVERDUE, .halt gating, real-probe idle/resumed + productization/laydown
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
// /tmp prefix "session-liveness-ev-" — the hermetic probe constructors create dirs under it (via
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
// Run: scripts/test.sh session-liveness-events.test.mjs   /   node --test session-liveness-events.test.mjs   /   scripts/test.sh --group lowconc

import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";
import {
  SCRIPT, PROBE_TARGET, tmuxAvailable, realProbeAvailable,
  setProbeTmpPrefix, sweepTmp, reapLiveOwners, md5, tmux, isolateTmuxEnv, isClaudePid,
  paneHasClaudeChild, waitForAlive, makeHermeticProbe, makePlainPane,
  makeClaudePaneProcess, makeTwoWindowSession, paneSelfIsClaude, waitForSelfClaude,
  spawnMonitor, waitForOutput, waitForRounds, makeBackdatedGitRepo,
  makePaneBusy, makePaneIdle,
  makeTmp, cleanup, diskWorktreeRoot, runInit, HANG_GUARD_MS,
} from "./session-liveness-helpers.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// OWN the /tmp probe prefix for this split file (see SPLIT CONCURRENCY SAFETY):
setProbeTmpPrefix("session-liveness-ev-");

// KNOWN-LOAD-SENSITIVE: under suite load a hermetic-probe test can be cancelled mid-run,
// skipping its finally → this file's /tmp dirs leak (server + socket stay alive) and trip the
// suite-tail tmux-leak-scan. reapLiveOwners() FIRST kills this process's OWN still-alive probe
// servers (a cancelled test's residue — sweepTmp cannot: it skips live-owner dirs by design), then
// sweepTmp removes owner-dead residue. Sweep ONLY this file's own prefixes (see SPLIT CONCURRENCY
// SAFETY above — never a sibling's).
after(() => {
  reapLiveOwners();
  sweepTmp("session-liveness-ev-", "ol-prod-");
});

test("SESSION-RESUMED then SESSION-IDLE fire when the real probe session goes busy then idle", {
  skip: realProbeAvailable
    ? false
    : `real probe session ${PROBE_TARGET} is not present/alive — run this on the manager box (orchestration/TOOLS-SESSION-HANDOFF.md)`,
  timeout: 180000,
}, async () => {
  const env = process.env;
  const captureText = () => tmux(["capture-pane", "-p", "-t", PROBE_TARGET], env).stdout;
  // 3 consecutive identical captures = idle (3× beats the 1s-timer alignment hazard of 2×).
  const waitStableHash = async (timeoutMs) => {
    const deadline = Date.now() + timeoutMs;
    const last3 = [];
    while (Date.now() < deadline) {
      const h = md5(captureText());
      last3.push(h);
      if (last3.length > 3) last3.shift();
      if (last3.length === 3 && last3.every((x) => x === last3[0])) return h;
      await sleep(1000);
    }
    return null;
  };

  // 0. the probe must be idle before we drive it (it may be mid-answer from a prior run).
  const baseline = await waitStableHash(HANG_GUARD_MS);
  assert.ok(baseline !== null, `probe must reach a stable idle baseline before driving (never settled within the hang-guard)`);

  // tickLogs pins the tick path to a nonexistent file so tmin="?" under the noise gate
  // (SESSION-IDLE reports when tmin is unknown) — otherwise tmin reads the REAL quay tick-log mtime
  // and the IDLE event could be gated silent if the manager's loop happened to tick recently.
  const mon = spawnMonitor(env, `probe /tmp ${PROBE_TARGET}`, { tickLogs: `probe /nonexistent` });
  try {
    // 1. let the monitor establish its own idle baseline (≥2 rounds: PREV_HASH + PREV_IDLE=1).
    //    Load-robust (hermetic): wait on the deterministic `# ROUND` marker, never a fixed wall-clock
    //    sleep — a fixed sleep can complete only ONE round (or none) when monitor rounds stretch under
    //    concurrent-suite load, leaving PREV_IDLE un-armed so the RESUMED edge can never fire (the
    //    exact r303 root-cause class, gap-session-liveness-family-hermetic-vs-ambient-load).
    assert.ok(await waitForRounds(mon, 2, HANG_GUARD_MS),
      `monitor must establish an idle baseline of ≥2 rounds before driving the probe:\n${mon.output()}`);

    // 2. drive the probe busy with a task that runs tens of seconds (flash answers a light
    //    question in ~5s — at INTERVAL=1 a short window could be missed entirely).
    tmux(["send-keys", "-t", PROBE_TARGET, "C-u"], env);
    tmux(["send-keys", "-t", PROBE_TARGET, "运行 sleep 20 这条命令，等它结束后说 done"], env);
    tmux(["send-keys", "-t", PROBE_TARGET, "Enter"], env);

    // 3. the idle→busy transition must surface as SESSION-RESUMED within a few rounds.
    const resumed = await waitForOutput(mon, /SESSION-RESUMED probe/, 20000);
    assert.ok(resumed, `SESSION-RESUMED must fire when the probe goes busy:\n${mon.output()}`);

    // 4. wait for the probe to come back idle (busy task done, answer rendered, prompt stable).
    const settled = await waitStableHash(HANG_GUARD_MS);
    assert.ok(settled !== null, `probe must return to a stable idle state after the busy task`);

    // 5. the busy→idle transition must surface as SESSION-IDLE within a few rounds of settling.
    const idle = await waitForOutput(mon, /SESSION-IDLE probe/, 15000);
    assert.ok(idle, `SESSION-IDLE must fire when the probe returns idle:\n${mon.output()}`);

    // 6. ordering: the busy transition precedes the TRANSITION idle. D5 fix 2026-08-08
    //    (gap-session-liveness-busy-mask-idle-with-subagents): with /nonexistent heartbeat +
    //    idle-at-mount, a MOUNT-TIME SESSION-IDLE now fires (correct for an unknown-heartbeat
    //    stall — the SEEN_BUSY gate no longer suppresses it), so the FIRST SESSION-IDLE may precede
    //    the RESUMED. The assertion must target the FRESH idle of the post-busy spell: the LAST
    //    SESSION-IDLE must postdate the RESUMED (per-spell edge re-arms IDLE on the busy spell).
    const out = mon.output();
    const rIdx = out.indexOf("SESSION-RESUMED");
    const iIdx = out.lastIndexOf("SESSION-IDLE");
    assert.ok(rIdx !== -1 && iIdx !== -1 && rIdx < iIdx, `SESSION-RESUMED must precede the post-busy SESSION-IDLE:\n${out}`);
  } finally {
    mon.child.kill("SIGKILL");
    mon.cleanup();
    tmux(["send-keys", "-t", PROBE_TARGET, "C-u"], env); // leave the probe at a clean prompt
    await sleep(500);
  }
});

test("SESSION-GONE then SESSION-BACK fire when the probe's claude process vanishes and returns", { skip: tmuxAvailable ? false : "tmux not installed" }, async () => {
  const p = makeHermeticProbe("ol-gone");
  try {
    assert.ok(await waitForAlive(p.env, p.session), "probe claude child must be alive before the monitor starts");
    const mon = spawnMonitor(p.env, `gone ${p.tmp} ${p.session}`, {});
    try {
      // ≥2 rounds: PREV_ALIVE=1 baseline. Load-robust (hermetic): the `# ROUND` marker is the
      // deterministic time source — a fixed wall-clock sleep can complete only one slow round under
      // load, and GONE is a PREV_ALIVE transition (an un-armed baseline would swallow the edge).
      assert.ok(await waitForRounds(mon, 2, HANG_GUARD_MS),
        `monitor must establish ≥2 rounds (PREV_ALIVE=1) before the probe is killed:\n${mon.output()}`);
      tmux(["send-keys", "-t", p.session, "kill %1"], p.env); // make it disappear
      tmux(["send-keys", "-t", p.session, "Enter"], p.env);
      assert.ok(await waitForOutput(mon, /SESSION-GONE gone/, 6000), `SESSION-GONE must fire:\n${mon.output()}`);
      tmux(["send-keys", "-t", p.session, "exec -a claude-probe sleep 10000 &"], p.env); // bring it back
      tmux(["send-keys", "-t", p.session, "Enter"], p.env);
      assert.ok(await waitForOutput(mon, /SESSION-BACK gone/, 6000), `SESSION-BACK must fire:\n${mon.output()}`);
    } finally {
      mon.child.kill("SIGKILL");
    mon.cleanup();
    }
  } finally {
    p.cleanup();
  }
});

test("B2 — session_pid detects claude when it IS the pane foreground process (pane_pid self-check), not only as a child", { skip: tmuxAvailable ? false : "tmux not installed" }, async () => {
  const p = makeClaudePaneProcess("ol-self");
  try {
    assert.ok(await waitForSelfClaude(p.env, p.session), "the pane's own foreground process must be the claude stand-in");
    const panePid = tmux(["list-panes", "-t", p.session, "-F", "#{pane_pid}"], p.env).stdout.trim();
    assert.ok(panePid && /^\d+$/.test(panePid), `pane_pid must be numeric, got ${panePid}`);
    const once = spawnSync("bash", [SCRIPT, "--once"], {
      encoding: "utf8",
      env: { ...p.env, SESSION_TARGETS: `self ${p.tmp} ${p.session}` },
    });
    assert.equal(once.status, 0, `--once must exit 0:\n${once.stderr}`);
    assert.match(once.stdout, /SESSION-STATUS self alive=1/,
      `claude-as-pane-process must report alive=1 (old code only grepped children → alive=0):\n${once.stdout}`);
    assert.ok(once.stdout.includes(`pid=${panePid}`),
      `must report the pane_pid itself as the claude pid (expected ${panePid}):\n${once.stdout}`);
  } finally {
    p.cleanup();
  }
});

test("B3 — a child whose cmdline contains a .claude path substring but whose process name is NOT claude is NOT falsely reported (alive=0)", { skip: tmuxAvailable ? false : "tmux not installed" }, async () => {
  const p = makePlainPane("ol-dot");
  try {
    // give the pane a child whose FULL cmdline contains ".claude" (the shell-snapshot path shape of
    // the full-suite-runner's bash wrapper) but whose process name is bash. `; true` keeps bash from
    // exec-replacing itself with sleep (a single-command `bash -c 'sleep 10000'` would exec and lose
    // the $0 path from argv, so the child cmdline would NOT carry ".claude").
    tmux(["send-keys", "-t", p.session, "bash -c 'sleep 10000; true' /home/yale/.claude/shell-snapshots/abc/bash &"], p.env);
    tmux(["send-keys", "-t", p.session, "Enter"], p.env);
    const panePid = tmux(["list-panes", "-t", p.session, "-F", "#{pane_pid}"], p.env).stdout.trim();
    const childCmdlines = () => {
      const kids = spawnSync("pgrep", ["-P", panePid], { encoding: "utf8" });
      return (kids.stdout ?? "").trim().split("\n").filter(Boolean).map((k) => {
        try { return fs.readFileSync(`/proc/${k}/cmdline`, "utf8").replace(/\0/g, " "); } catch { return ""; }
      });
    };
    const hasDotChild = () => childCmdlines().some((c) => c.includes(".claude"));
    const deadline = Date.now() + HANG_GUARD_MS;
    while (Date.now() < deadline && !hasDotChild()) await sleep(100);
    assert.ok(hasDotChild(), `the .claude-path child must be present for the control to be real`);
    // the CONTROL must be real: a child's full cmdline contains "claude" — the OLD grep matched it.
    assert.ok(childCmdlines().some((c) => c.includes("claude")),
      `control: a child cmdline must contain the claude substring (old code matched it):\n${childCmdlines().join("\n")}`);
    // the new code matches by process NAME → the bash wrapper is NOT claude → alive=0.
    const once = spawnSync("bash", [SCRIPT, "--once"], {
      encoding: "utf8",
      env: { ...p.env, SESSION_TARGETS: `dot ${p.tmp} ${p.session}` },
    });
    assert.equal(once.status, 0, `--once must exit 0:\n${once.stderr}`);
    assert.match(once.stdout, /SESSION-STATUS dot alive=0/,
      `a .claude-path child must NOT be reported as a claude session (process name is bash):\n${once.stdout}`);
  } finally {
    p.cleanup();
  }
});

test("B4 — window-suffixed SESSION_TMUX_SESSION targets the named window (quay-0:inner); bare session and numeric pane suffix resolve to :outer", { skip: tmuxAvailable ? false : "tmux not installed" }, async () => {
  const p = makeTwoWindowSession("ol-role");
  try {
    // claude only in the INNER window (as the pane foreground process).
    tmux(["send-keys", "-t", "ol-role:inner", "exec -a claude-probe sleep 10000"], p.env);
    tmux(["send-keys", "-t", "ol-role:inner", "Enter"], p.env);
    const innerPid = tmux(["list-panes", "-t", "ol-role:inner", "-F", "#{pane_pid}"], p.env).stdout.trim();
    const outerPid = tmux(["list-panes", "-t", "ol-role:outer", "-F", "#{pane_pid}"], p.env).stdout.trim();
    assert.ok(innerPid && outerPid && innerPid !== outerPid, "inner and outer must be distinct panes");
    assert.ok(await waitForSelfClaude(p.env, "ol-role:inner"), "the inner pane must be the claude stand-in");
    const runOnce = (sessVal) => spawnSync("bash", [SCRIPT, "--once"], {
      encoding: "utf8",
      env: { ...p.env, SESSION_ROOT: p.tmp, SESSION_TMUX_SESSION: sessVal },
    });
    // (1) named-window suffix → THAT window: alive=1 with the INNER pid.
    let once = runOnce("ol-role:inner");
    assert.equal(once.status, 0, `--once must exit 0:\n${once.stderr}`);
    assert.match(once.stdout, /alive=1/,
      `window-suffixed SESSION_TMUX_SESSION must target the named window:\n${once.stdout}`);
    assert.ok(once.stdout.includes(`pid=${innerPid}`),
      `must report the INNER window's pid (${innerPid}), not the outer's (${outerPid}):\n${once.stdout}`);
    // (2) bare session → the :outer default window (outer has no claude → alive=0).
    once = runOnce("ol-role");
    assert.match(once.stdout, /alive=0/,
      `bare session must target <base>:outer (no claude there):\n${once.stdout}`);
    // (3) numeric pane suffix (quay-init's --tmux-session ol-cold:0.0 shape) → strip to :outer.
    once = runOnce("ol-role:0.0");
    assert.match(once.stdout, /alive=0/,
      `numeric pane suffix must strip to <base>:outer (no claude there):\n${once.stdout}`);
  } finally {
    p.cleanup();
  }
});

test("REPO-STALL fires when alive but the repo HEAD commit is ≥STALL_MIN old (not halted); the old SESSION-STALL name never appears", { skip: tmuxAvailable ? false : "tmux not installed" }, async () => {
  const p = makeHermeticProbe("ol-stall");
  const gitRoot = path.join(p.tmp, "repo");
  try {
    fs.mkdirSync(gitRoot, { recursive: true });
    makeBackdatedGitRepo(gitRoot);
    assert.ok(await waitForAlive(p.env, p.session), "probe must be alive first");
    const mon = spawnMonitor(p.env, `stall ${gitRoot} ${p.session}`, { stallMin: 1 });
    try {
      assert.ok(await waitForOutput(mon, /REPO-STALL stall/, 6000), `REPO-STALL must fire:\n${mon.output()}`);
      assert.ok(!/SESSION-STALL/.test(mon.output()),
        `the old SESSION-STALL name must not appear after the AC8 rename:\n${mon.output()}`);
    } finally {
      mon.child.kill("SIGKILL");
    mon.cleanup();
    }
  } finally {
    p.cleanup();
  }
});

test("SESSION-OVERDUE fires when the tick-log mtime is ≥OVERDUE_MIN old (not halted)", { skip: tmuxAvailable ? false : "tmux not installed" }, async () => {
  const p = makeHermeticProbe("ol-overdue");
  const tick = path.join(p.tmp, "tick.md");
  try {
    fs.writeFileSync(tick, "# tick\n");
    const old = spawnSync("touch", ["-d", "3 hours ago", tick], { encoding: "utf8" });
    assert.equal(old.status, 0, `touch -d failed: ${old.stderr}`);
    assert.ok(await waitForAlive(p.env, p.session), "probe must be alive first");
    const mon = spawnMonitor(p.env, `overdue ${p.tmp} ${p.session}`, { tickLogs: `overdue ${tick}`, overdueMin: 1 });
    try {
      assert.ok(await waitForOutput(mon, /SESSION-OVERDUE overdue/, 6000), `SESSION-OVERDUE must fire:\n${mon.output()}`);
    } finally {
      mon.child.kill("SIGKILL");
    mon.cleanup();
    }
  } finally {
    p.cleanup();
  }
});

test(".halt suppresses REPO-STALL and SESSION-OVERDUE, but NOT SESSION-GONE", { skip: tmuxAvailable ? false : "tmux not installed" }, async () => {
  const p = makeHermeticProbe("ol-halt");
  const gitRoot = path.join(p.tmp, "repo");
  const tick = path.join(p.tmp, "tick.md");
  try {
    fs.mkdirSync(gitRoot, { recursive: true });
    makeBackdatedGitRepo(gitRoot);
    fs.writeFileSync(path.join(gitRoot, ".halt"), ""); // halted: not advancing is expected
    fs.writeFileSync(tick, "# tick\n");
    spawnSync("touch", ["-d", "3 hours ago", tick], { encoding: "utf8" });
    assert.ok(await waitForAlive(p.env, p.session), "probe must be alive first");

    const mon = spawnMonitor(p.env, `halted ${gitRoot} ${p.session}`, { tickLogs: `halted ${tick}`, stallMin: 1, overdueMin: 1 });
    try {
      // ≥3 rounds — STALL/OVERDUE would have fired by now if not gated. Load-robust (hermetic):
      // wait on the `# ROUND` marker, never a fixed wall-clock sleep — under concurrent-suite load a
      // fixed sleep can complete fewer than the 3 rounds needed to make the suppression check
      // meaningful (the negative assertions would then pass vacuously rather than truly).
      assert.ok(await waitForRounds(mon, 3, HANG_GUARD_MS),
        `monitor must run ≥3 halted rounds for the suppression checks to be meaningful:\n${mon.output()}`);
      const out = mon.output();
      assert.ok(!/REPO-STALL/.test(out), `REPO-STALL must be suppressed for a halted project:\n${out}`);
      assert.ok(!/SESSION-OVERDUE/.test(out), `OVERDUE must be suppressed for a halted project:\n${out}`);
      // the monitor is not globally silent: GONE still fires despite the halt.
      tmux(["send-keys", "-t", p.session, "kill %1"], p.env);
      tmux(["send-keys", "-t", p.session, "Enter"], p.env);
      assert.ok(await waitForOutput(mon, /SESSION-GONE halted/, 6000), `GONE must still fire when halted:\n${mon.output()}`);
    } finally {
      mon.child.kill("SIGKILL");
    mon.cleanup();
    }
  } finally {
    p.cleanup();
  }
});

test("Contract invoke — session-liveness.sh --selfcheck 验证多源心跳判据（红窗处置保持新鲜 / 零产出报 OVERDUE），退出 0", () => {
  const r = spawnSync("bash", [SCRIPT, "--selfcheck"], { encoding: "utf8" });
  assert.equal(r.status, 0, `--selfcheck must exit 0:\n${r.stdout}\n${r.stderr}`);
  assert.match(r.stdout, /selfcheck: PASS/);
  assert.match(r.stdout, /red-window-heartbeat_min=\d+\s+zero-output-heartbeat_min=\d+/);
});

test("G — removing .halt resets the staleness baseline: no OVERDUE/REPO-STALL in the un-halt round; RESUMED and OVERDUE never co-fire", { skip: tmuxAvailable ? false : "tmux not installed" }, async () => {
  const p = makeHermeticProbe("ol-unhalt");
  const gitRoot = path.join(p.tmp, "repo");
  const tick = path.join(p.tmp, "tick.md");
  try {
    fs.mkdirSync(gitRoot, { recursive: true });
    makeBackdatedGitRepo(gitRoot);
    fs.writeFileSync(path.join(gitRoot, ".halt"), ""); // parked
    fs.writeFileSync(tick, "# tick\n");
    spawnSync("touch", ["-d", "3 hours ago", tick], { encoding: "utf8" }); // heartbeat stale from parking
    assert.ok(await waitForAlive(p.env, p.session), "probe must be alive first");
    const mon = spawnMonitor(p.env, `gate ${gitRoot} ${p.session}`, { tickLogs: `gate ${tick}`, stallMin: 1, overdueMin: 1 });
    try {
      // ≥3 rounds parked: both suppressed, AND the idle baseline establishes PREV_IDLE=1 so the
      // busy edge below (makePaneBusy + un-halt → SESSION-RESUMED) can fire — waitForRounds is the
      // load-robust form (a fixed 4s sleep can be as few as one slow round under full-suite load).
      assert.ok(await waitForRounds(mon, 3, 20000), `monitor must run ≥3 parked rounds:\n${mon.output()}`);
      assert.ok(!/REPO-STALL/.test(mon.output()) && !/SESSION-OVERDUE/.test(mon.output()),
        `parked project must not STALL or OVERDUE:\n${mon.output()}`);
      // reproduce the coordinator's incident: the pane goes to the BUSY SHAPE (classifyPaneState)
      // at the same moment .halt is removed → RESUMED. (Shape-based since ruling D: the whole-pane
      // hash is gone, so a busy pane must show the busy shape, not just redrawn content.)
      makePaneBusy(p.env, p.session);
      fs.rmSync(path.join(gitRoot, ".halt")); // un-halt
      const resumed = await waitForOutput(mon, /SESSION-RESUMED gate/, 25000);
      assert.ok(resumed, `RESUMED must fire on the busy transition:\n${mon.output()}`);
      // baseline reset ⇒ stale = now - max(hb, unhalt_ts) ≈ 0, so OVERDUE cannot fire for OVERDUE_MIN after un-halt.
      assert.ok(!/SESSION-OVERDUE/.test(mon.output()),
        `OVERDUE must NOT co-fire with RESUMED in the un-halt round (baseline reset):\n${mon.output()}`);
      assert.ok(!/REPO-STALL/.test(mon.output()),
        `REPO-STALL must NOT fire right after un-halt (repo-age baseline reset):\n${mon.output()}`);
    } finally {
      makePaneIdle(p.env, p.session);
      mon.child.kill("SIGKILL");
    mon.cleanup();
    }
  } finally {
    p.cleanup();
  }
});

test("LOOP_MIN split — OVERDUE prints the fixed EXPECTED_CYCLE_MIN, never the runtime LOOP_MIN (0 would print 预期周期 0 分钟)", { skip: tmuxAvailable ? false : "tmux not installed" }, async () => {
  const p = makeHermeticProbe("ol-loopmin");
  const tick = path.join(p.tmp, "tick.md");
  try {
    fs.writeFileSync(tick, "# tick\n");
    spawnSync("touch", ["-d", "3 hours ago", tick], { encoding: "utf8" });
    assert.ok(await waitForAlive(p.env, p.session), "probe must be alive first");
    const mon = spawnMonitor(p.env, `lm ${p.tmp} ${p.session}`, { tickLogs: `lm ${tick}`, overdueMin: 1, loopMin: 0 });
    try {
      assert.ok(await waitForOutput(mon, /SESSION-OVERDUE lm/, 6000), `OVERDUE must fire:\n${mon.output()}`);
      assert.ok(!/预期周期 0 分钟/.test(mon.output()),
        `OVERDUE must not print the runtime LOOP_MIN (0) as the expected cycle:\n${mon.output()}`);
      assert.ok(/预期周期 20 分钟/.test(mon.output()),
        `OVERDUE must print the fixed EXPECTED_CYCLE_MIN (20):\n${mon.output()}`);
    } finally {
      mon.child.kill("SIGKILL");
    mon.cleanup();
    }
  } finally {
    p.cleanup();
  }
});

test("AC1 — plugin/scripts/session-liveness.sh has no absolute paths, specific session names, or install placeholder", () => {
  const src = fs.readFileSync(SCRIPT, "utf8");
  assert.ok(!/(\/home\/yale|quay-0:|archguard-2:|meta-cc-4:)/.test(src),
    "source must not reference /home/yale or the three projects' specific tmux sessions");
  assert.ok(!src.includes("__QUAY_TMUX_SESSION__"),
    "source must not carry the install-time placeholder (AC1 — the session is resolved from env/config/default)");
});

test("AC2 — quay-init --loop lays down session-liveness.sh VERBATIM; the session value lives in orchestration/session-liveness.env", () => {
  const ws = makeTmp();
  try {
    const r = runInit(ws, ["--loop", "--root", ws, "--project", "myproj",
      "--test-command", "npm test", "--tmux-session", "myproj-0:0.0", "--repo-root", "/srv/target"]);
    assert.equal(r.status, 0, `init must exit 0:\n${r.stderr}`);
    const src = fs.readFileSync(SCRIPT, "utf8");
    const laid = fs.readFileSync(path.join(ws, "plugin", "scripts", "session-liveness.sh"), "utf8");
    assert.equal(laid, src, "installed session-liveness.sh must be byte-identical to its source (cp, not render)");
    assert.ok(!laid.includes("__QUAY_TMUX_SESSION__"), "no placeholder may remain in the source (AC1)");
    // The session is config, not a script rewrite: quay-init writes it to the per-project env file.
    const envFile = fs.readFileSync(path.join(ws, "orchestration", "session-liveness.env"), "utf8");
    assert.match(envFile, /SESSION_TMUX_SESSION=myproj-0:0\.0/, "the --tmux-session value must be written to the generated config");
    assert.ok(!laid.includes("myproj-0"), "the script itself must NOT carry the target session (config, not code)");
    assert.ok(!laid.includes("/home/yale/work/quay"), "no quay dev-root leak");
    assert.ok(!laid.includes("scripts/test.sh"), "no quay test-command leak");
  } finally { cleanup(ws); }
});

test("AC3/AC7 — the laid-down script, run --once, identifies THIS project's own outer (real run, not file-exists)", async () => {
  const ws = makeTmp();
  const sockDir = path.join(ws, "sock"); fs.mkdirSync(sockDir, { recursive: true });
  const env = { ...process.env, TMUX_TMPDIR: sockDir }; delete env.TMUX;
  try {
    const r = runInit(ws, ["--loop", "--root", ws, "--project", "proj",
      "--test-command", "node --test", "--tmux-session", "ol-cold:0.0", "--worktree-root", diskWorktreeRoot()]);
    assert.equal(r.status, 0, `init must exit 0:\n${r.stderr}`);
    // this project's own outer = <session>:outer window (the default-target convention).
    const ns = tmux(["new-session", "-d", "-s", "ol-cold", "-n", "outer", "bash"], env);
    assert.equal(ns.status, 0, `new-session failed: ${ns.stderr}`);
    tmux(["send-keys", "-t", "ol-cold:outer", "exec -a claude-probe sleep 10000 &"], env);
    tmux(["send-keys", "-t", "ol-cold:outer", "Enter"], env);
    assert.ok(await waitForAlive(env, "ol-cold", 5000), "this project's outer must be alive before the cold-start run");
    const once = spawnSync("bash", [path.join(ws, "plugin", "scripts", "session-liveness.sh"), "--once"], {
      encoding: "utf8", env: { ...env, SESSION_ROOT: ws },
    });
    assert.equal(once.status, 0, `--once must exit 0:\n${once.stderr}`);
    assert.ok(once.stdout.includes("SESSION-STATUS") && once.stdout.includes("alive=1"),
      `must identify this project's own outer as alive:\n${once.stdout}`);
  } finally {
    tmux(["kill-session", "-t", "ol-cold"], env);
    cleanup(ws);
  }
});

test("AC6 — no tick log: SESSION-OVERDUE stays silent, other events work, no crash", async () => {
  const p = makeHermeticProbe("ol-notick");
  try {
    const mon = spawnMonitor(p.env, `notick ${p.tmp} ${p.session}`,
      { tickLogs: `notick ${path.join(p.tmp, "nope.md")}`, overdueMin: 1 });
    try {
      // Load-robust (hermetic): ≥3 rounds via the `# ROUND` marker — a fixed wall-clock sleep can
      // complete fewer rounds under load, making the OVERDUE-silence negative check vacuous.
      assert.ok(await waitForRounds(mon, 3, HANG_GUARD_MS),
        `monitor must run ≥3 rounds for the OVERDUE-silence check to be meaningful:\n${mon.output()}`);
      assert.ok(!/SESSION-OVERDUE/.test(mon.output()), `OVERDUE must be silent without a tick log:\n${mon.output()}`);
      tmux(["send-keys", "-t", p.session, "kill %1"], p.env);
      tmux(["send-keys", "-t", p.session, "Enter"], p.env);
      assert.ok(await waitForOutput(mon, /SESSION-GONE notick/, 6000), `GONE must still fire:\n${mon.output()}`);
    } finally {
      mon.child.kill("SIGKILL");
    mon.cleanup();
    }
  } finally {
    p.cleanup();
  }
});

test("AC9 — orchestration/session-liveness.env is the OUTER's OWN config (manager's 3-project config moved out 2026-08-04 c1489b6a); it may carry a SINGLE SESSION_TARGETS aimed at the inner role window, but never the manager topology nor the :outer self-watch default; an env file IS sourced when SESSION_TARGETS is unset", async () => {
  const realEnv = fs.readFileSync(path.resolve(__dirname, "..", "..", "orchestration", "session-liveness.env"), "utf8");
  // The manager's THREE-project config was moved out to ~/.quay-global/manager-session-liveness.env
  // (c1489b6a: it was being read by a session it was not meant for). The env file may legitimately
  // carry the OUTER's own single-target SESSION_TARGETS (gap-session-liveness-monitor-watches-self-
  // not-inner aims the monitor at the inner role window), but must NEVER carry the manager topology
  // or target the :outer default that left the monitor watching ITSELF. Only ACTIVE config lines
  // matter here — the file's COMMENT block may mention the old manager topology as history.
  assert.ok(!/^SESSION_TARGETS=[^\n]*(archguard|meta-cc)/m.test(realEnv),
    "no ACTIVE SESSION_TARGETS line may carry the manager's 3-project topology (archguard/meta-cc — moved out 2026-08-04 c1489b6a)");
  assert.ok(!/^SESSION_TARGETS=[^\n]*quay-0:outer/m.test(realEnv),
    "the env file's SESSION_TARGETS must NOT target the :outer window (the self-watch defect — it must name a role window like quay-0:inner)");
  assert.ok(!fs.readFileSync(SCRIPT, "utf8").includes("quay-0:"), "the script must NOT carry the topology (moved out)");

  const ws = makeTmp();
  const sockDir = path.join(ws, "sock"); fs.mkdirSync(sockDir, { recursive: true });
  const env = { ...process.env, TMUX_TMPDIR: sockDir }; delete env.TMUX;
  try {
    fs.mkdirSync(path.join(ws, "orchestration"), { recursive: true });
    const ns = tmux(["new-session", "-d", "-s", "ol-env", "-n", "outer", "bash"], env);
    assert.equal(ns.status, 0, `new-session failed: ${ns.stderr}`);
    tmux(["send-keys", "-t", "ol-env:outer", "exec -a claude-probe sleep 10000 &"], env);
    tmux(["send-keys", "-t", "ol-env:outer", "Enter"], env);
    assert.ok(await waitForAlive(env, "ol-env", 5000), "the env-file target outer must be alive before the run");
    fs.writeFileSync(path.join(ws, "orchestration", "session-liveness.env"),
      `SESSION_TARGETS="envproj ${ws} ol-env:outer"\n`, "utf8");
    const once = spawnSync("bash", [SCRIPT, "--once"], { encoding: "utf8", env: { ...env, SESSION_ROOT: ws } });
    assert.equal(once.status, 0, `--once must exit 0:\n${once.stderr}`);
    assert.match(once.stdout, /SESSION-STATUS envproj alive=1/, `must source the env-file targets:\n${once.stdout}`);
  } finally {
    tmux(["kill-session", "-t", "ol-env"], env);
    cleanup(ws);
  }
});

test("AC5 — the shipped outer tick doc documents the four thresholds", () => {
  const doc = fs.readFileSync(path.resolve(__dirname, "..", "loop", "orchestrator-loop-tick.md"), "utf8");
  for (const t of ["INTERVAL", "STALL_MIN", "LOOP_MIN", "OVERDUE_MIN"]) {
    assert.ok(doc.includes(t), `the outer tick doc must document ${t} (AC5: a parameter only its author can tune is not a parameter)`);
  }
});

test("AC12/AC13 — both shipped tick docs state the ONE monitor (session-liveness.sh); inner-state.sh is named only as retired, never as a mount", () => {
  const outer = fs.readFileSync(path.resolve(__dirname, "..", "loop", "orchestrator-loop-tick.md"), "utf8");
  const inner = fs.readFileSync(path.resolve(__dirname, "..", "loop", "fast-mode-loop-tick.md"), "utf8");
  // AC12 (rewritten): the outer tick doc mounts ONE monitor — session-liveness.sh.
  assert.ok(outer.includes("session-liveness.sh"),
    "the outer tick doc must name the ONE monitor session-liveness.sh (AC12 rewritten)");
  assert.ok(/还在不在/.test(outer),
    "the outer tick doc must state what the monitor answers — 会话还在不在 (AC12)");
  // The outer doc must NOT instruct mounting inner-state.sh as a live monitor: every inner-state.sh
  // mention must be the retirement note (retired / 退役 / 已退役), never a Monitor({command: ...}).
  assert.ok(!/Monitor\(\{command:.*inner-state\.sh/.test(outer),
    "the outer tick doc must NOT instruct mounting inner-state.sh (retired, gap-retire-inner-state-one-observer-targets-by-parameter AC2)");
  assert.match(outer, /inner-state\.sh.{0,80}(退役|已退役)/s,
    "the outer tick doc must name inner-state.sh only in the retirement note (AC2)");
  // AC13: the inner tick doc also states that the inner mounts session-liveness.sh.
  assert.ok(inner.includes("session-liveness.sh"),
    "the inner tick doc must state that the inner mounts session-liveness.sh (AC13)");
  assert.ok(!/Monitor\(\{command:.*inner-state\.sh/.test(inner),
    "the inner tick doc must NOT instruct mounting inner-state.sh (retired)");
});

test("startup stamp makes the running version visible (file + md5 to stderr, matching the on-disk file)", () => {
  const r = spawnSync("bash", [SCRIPT, "--once"], { encoding: "utf8", env: { ...process.env, SESSION_ROOT: "/tmp" } });
  assert.match(r.stderr, /session-liveness: starting pid=\d+ file=session-liveness\.sh md5=[0-9a-f]{16}/,
    `startup stamp must carry pid/file/md5 on stderr:\n${r.stderr}`);
  const diskMd5 = md5(fs.readFileSync(SCRIPT, "utf8"));
  assert.ok(r.stderr.includes(diskMd5),
    `stamp md5 must equal the loaded file's md5 (${diskMd5}), so a stale instance is detectable by comparison:\n${r.stderr}`);
});
