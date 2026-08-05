// @test-group governance
// KNOWN-LOAD-SENSITIVE (see plugin/loop/fast-mode-loop-tick.md "已知负载敏感族") — this file uses
// real processes + tmux timing; it passes isolated under low load but may fail under concurrent-suite
// load (gap-load-sensitive-session-family-confounds-step-three, 2026-08-04). A full-suite failure here
// is NOT a real regression by default: re-run this file alone (low load) before concluding anything.
// session-liveness.test.mjs — automated positive controls for the cross-project session-liveness
// monitor (plugin/scripts/session-liveness.sh; generalized + renamed from outer-liveness.sh per
// SPEC-outer-liveness-productization.md AC10-13 — the process/pane/heartbeat logic holds for ANY
// Claude Code session, not just the outer). The manager built and verified the original manually;
// this file turns those manual controls into tests, per rule 2 of orchestration/TOOLS-SESSION-
// HANDOFF.md: "干跑没有输出不是证据" — every criterion needs a known-triggering setup that
// demonstrably fires, because "no output" is indistinguishable from "it never reports".
//
// Wait-window discipline (AC4/AC5, gap-a-widened-wait-window-...): a widened wait window must be
// justified by measured arrival latency AND accompanied by a "missing-payload-still-red" negative
// control — otherwise "widened until it passes" is indistinguishable from "fixed". 2026-08-03:
// RESUMED waits were raised 8s→25s (cfbc7459) because under the full suite's ~4× oversubscription
// the monitor's per-round tmux capture-pane + transcript reads stretch several-fold (>11s with no
// event observed in suite7/suite12); 25s ≈ 2-3× the slowest observed (isolation ~5.2s, sibling
// under load ~7.7s). Two negative controls pin that the widening does NOT mask a broken payload:
// (1) AC7 NC — empty transcript ⇒ last-input 取不到 ⇒ the AC7 assertion rejects it;
// (2) AC6 NC — script mutation forces an empty cause ⇒ the strengthened AC6 (`成因：[^；）]`)
// rejects it. The old AC6 `! /成因：\)/` was a no-op (ASCII paren never appears in the full-width
// output, so an empty cause passed); the strengthened form requires a real cause.
//
// The monitor reports five event families (SESSION-* since AC10):
//   SESSION-GONE/SESSION-BACK   the session process vanished / returned
//   REPO-STALL                  alive but ≥STALL_MIN min with no new commit (not halted) — a REPO
//                             signal, not a session signal (AC8: renamed from SESSION-STALL)
//   SESSION-OVERDUE             heartbeat mtime ≥OVERDUE_MIN (not halted) — session may be dead
//   SESSION-IDLE/SESSION-RESUMED  adjacent rounds' pane hash equal = idle; reported within one
//                             polling interval of the transition
//
// How each criterion gets a POSITIVE control, and why that shape:
//   A. SESSION-IDLE/SESSION-RESUMED — the busy criterion is REDRAW-based: a busy Claude Code TUI
//      repaints a second-level elapsed timer, so the pane hash changes between rounds; an idle
//      pane is byte-stable. A fake probe whose cmdline merely contains "claude" passes
//      session_pid's cmdline check but CANNOT redraw, so it can never produce the changing hash
//      that IS the busy signal. The manager's first positive control fell for exactly this (a
//      /tmp/claude-probe bash script); the fix is to drive a REAL Claude Code session —
//      quay-0:probe (deepseek-v4-flash, cwd /tmp, dedicated to this test, see TOOLS-SESSION-
//      HANDOFF.md). Test A drives it: idle baseline → a task that runs tens of seconds (`sleep 20`
//      — flash answers light questions in ~5s, so a short window would be missed by sparse
//      sampling) → SESSION-RESUMED → back to idle → SESSION-IDLE. Skips when the probe session is
//      absent (CI / other machines).
//   B. SESSION-GONE/SESSION-BACK — pure process detection (session_pid: first child of the pane
//      shell whose /proc/<pid>/cmdline contains "claude"). NOT redraw-dependent, so it runs
//      hermetically on an ISOLATED tmux socket with a real `sleep` whose argv[0] is "claude-probe"
//      as the claude-cmdline stand-in — no fake TUI involved, and it never touches the real
//      projects.
//   C. REPO-STALL — alive + a git repo whose HEAD committer date is ≥STALL_MIN minutes old, not
//      halted. Hermetic: isolated-socket stand-in + a temp repo with a backdated commit.
//   F. transcript heartbeat (AC1/AC16) — a per-target transcript (via SESSION_TRANSCRIPTS, session-id
//      OR absolute path) is the inner heartbeat source: while the transcript keeps advancing (tool
//      calls), OVERDUE stays silent even past OVERDUE_MIN; when it freezes (session died) OVERDUE
//      fires. Subagents dir mtime counts too.
//   G. un-halt baseline (coordinator 2026-08-03) — removing .halt must reset the staleness baseline,
//      so a long-parked session does NOT OVERDUE in the same round it RESUMEs; OVERDUE only fires
//      OVERDUE_MIN after un-halt. The RESUMED+OVERDUE-same-round non-co-fire is asserted here.
//   D. SESSION-OVERDUE — alive + heartbeat mtime ≥OVERDUE_MIN, not halted. Hermetic: isolated
//      stand-in + a temp heartbeat file with an old mtime, via the SESSION_HEARTBEATS override
//      (heartbeats are per-name paths; without it the default is the project tick log). AC11 adds
//      a directory heartbeat (inner-style .workflow-events/) proving the same script parameterizes
//      for both outer and inner.
//   E. halt-gating — STALL/OVERDUE are suppressed when <root>/.halt exists (a halted project not
//      advancing is expected); GONE is NOT suppressed. Hermetic.
//
// Process hygiene (handoff rules 2b/3): no pipelines feeding `$?`; no `pgrep -f` anywhere — the
// probe is found via /proc/<pid>/cmdline argv position exactly as session_pid() does it. Every
// mkdtemp tmpdir is removed in a finally (test-isolation R6). Every hermetic tmux server lives on
// its own socket (TMUX_TMPDIR) so the real quay-0/archguard-2/meta-cc-4 sessions are untouchable.
//
// Run:
//   scripts/test.sh plugin/test/session-liveness.test.mjs
//   node --test plugin/test/session-liveness.test.mjs
//   scripts/test.sh --group governance plugin/test/session-liveness.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.resolve(__dirname, "..", "scripts", "session-liveness.sh");
const PROBE_TARGET = "quay-0:probe"; // the manager's real, dedicated probe session

// ── helpers ────────────────────────────────────────────────────────────────────────────────────────

function md5(s) {
  return createHash("md5").update(s).digest("hex").slice(0, 16);
}

function tmux(args, env) {
  const r = spawnSync("tmux", args, { encoding: "utf8", env: env ?? process.env });
  return { status: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

// isolateTmuxEnv: point bare `tmux` at a PRIVATE server socket, so the monitor and the probe
// setup can never resolve to the real quay-0 / archguard-2 / meta-cc-4 sessions.
function isolateTmuxEnv(sockDir) {
  const env = { ...process.env, TMUX_TMPDIR: sockDir };
  delete env.TMUX;
  return env;
}

// paneHasClaudeChild — replicate session_pid(): the first child of the pane shell whose
// /proc/<pid>/cmdline contains "claude". NOT `pgrep -f` (handoff rule 3: it would match this
// very command).
function paneHasClaudeChild(env, session) {
  const p = tmux(["list-panes", "-t", session, "-F", "#{pane_pid}"], env);
  if (p.status !== 0 || !p.stdout.trim()) return false;
  const kids = spawnSync("pgrep", ["-P", p.stdout.trim()], { encoding: "utf8" });
  const first = (kids.stdout ?? "").trim().split("\n").filter(Boolean)[0];
  if (!first) return false;
  try {
    // read /proc/<pid>/cmdline directly and collapse the NUL argv separators to spaces — never
    // pass a NUL through spawnSync argv (execve rejects it).
    const cmd = fs.readFileSync(`/proc/${first}/cmdline`, "utf8").replace(/\0/g, " ");
    return cmd.includes("claude");
  } catch {
    return false;
  }
}

async function waitForAlive(env, session, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (paneHasClaudeChild(env, session)) return true;
    await sleep(100);
  }
  return paneHasClaudeChild(env, session);
}

// makeHermeticProbe(session) — a private tmux server + a pane whose shell owns a claude-cmdline
// child: a real `sleep` process with argv[0]="claude-probe", i.e. /proc cmdline = "claude-probe
// 10000". This is a process-detection stand-in, NOT a fake TUI: GONE/BACK/STALL/OVERDUE do not
// depend on TUI redraw, so a real TUI is not needed for them (only the busy criterion in test A is
// redraw-based and uses the real session).
function makeHermeticProbe(session) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "session-liveness-"));
  const sockDir = path.join(tmp, "sock");
  fs.mkdirSync(sockDir, { recursive: true });
  const env = isolateTmuxEnv(sockDir);
  const newS = tmux(["new-session", "-d", "-s", session, "bash"], env);
  assert.equal(newS.status, 0, `tmux new-session failed: ${newS.stderr}`);
  tmux(["send-keys", "-t", session, "exec -a claude-probe sleep 10000 &"], env);
  tmux(["send-keys", "-t", session, "Enter"], env);
  return {
    tmp,
    env,
    session,
    cleanup() {
      tmux(["kill-session", "-t", session], env);
      try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* best-effort */ }
    },
  };
}

// spawnMonitor — run the REAL session-liveness.sh with a fast test interval and overridable targets.
// Isolation (single-flight mount, 2026-08-03): the monitor now acquires the mount lock + writes
// heartbeat/events to its global dir, so EVERY spawned monitor gets its OWN SESSION_LIVENESS_GLOBAL_DIR
// temp dir — otherwise a test monitor would collide with a real production mount (or with a SIGKILLed
// sibling's stale lock in a shared test dir) and exit 0 as a no-op. cleanup() removes the temp dir.
function spawnMonitor(env, targets, { script = SCRIPT, tickLogs, transcripts, stallMin = 1, overdueMin = 1, interval = 1, loopMin, globalDir } = {}) {
  const gd = globalDir ?? fs.mkdtempSync(path.join(os.tmpdir(), "sl-global-"));
  const monEnv = {
    ...env,
    SESSION_LIVENESS_GLOBAL_DIR: gd,
    SESSION_TARGETS: targets,
    INTERVAL: String(interval),
    STALL_MIN: String(stallMin),
    OVERDUE_MIN: String(overdueMin),
  };
  if (tickLogs) monEnv.SESSION_HEARTBEATS = tickLogs;
  if (transcripts) monEnv.SESSION_TRANSCRIPTS = transcripts;
  if (loopMin !== undefined) monEnv.LOOP_MIN = String(loopMin);
  const child = spawn("bash", [script], { env: monEnv });
  let out = "";
  child.stdout.on("data", (d) => { out += d; });
  child.stderr.on("data", (d) => { out += d; });
  return {
    child,
    output: () => out,
    globalDir: gd,
    cleanup() { try { fs.rmSync(gd, { recursive: true, force: true }); } catch { /* best-effort */ } },
  };
}

async function waitForOutput(mon, pattern, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (pattern.test(mon.output())) return true;
    await sleep(200);
  }
  return pattern.test(mon.output());
}

// makeBackdatedGitRepo — a temp git repo whose HEAD committer date is 2000, so
// `git -C <root> log -1 --format=%ct` is huge and the ≥STALL_MIN-minute criterion trips.
function makeBackdatedGitRepo(dir) {
  const env = { ...process.env, GIT_AUTHOR_DATE: "2000-01-01T00:00:00Z", GIT_COMMITTER_DATE: "2000-01-01T00:00:00Z" };
  const git = (args, cwd) => spawnSync("git", args, { encoding: "utf8", cwd, env });
  const init = git(["-c", "user.name=t", "-c", "user.email=t@t", "init", "-q", "-b", "master", dir]);
  assert.equal(init.status, 0, `git init failed: ${init.stderr}`);
  fs.writeFileSync(path.join(dir, "a.txt"), "x\n");
  const add = git(["-c", "user.name=t", "-c", "user.email=t@t", "add", "."], dir);
  assert.equal(add.status, 0, `git add failed: ${add.stderr}`);
  const commit = git(["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "-m", "old"], dir);
  assert.equal(commit.status, 0, `git commit failed: ${commit.stderr}`);
  const ct = git(["log", "-1", "--format=%ct"], dir);
  assert.ok(ct.status === 0 && Number(ct.stdout.trim()) < 1000000000, `commit must be backdated, got ${ct.stdout}`);
}

// ── availability guards ───────────────────────────────────────────────────────────────────────────

const tmuxAvailable = (() => {
  try { return spawnSync("tmux", ["-V"], { encoding: "utf8" }).status === 0; } catch { return false; }
})();

// ── Test A: SESSION-IDLE / SESSION-RESUMED on the REAL probe session ──────────────────────────────────

const realProbeAvailable = (() => {
  if (!tmuxAvailable) return false;
  return paneHasClaudeChild(process.env, PROBE_TARGET);
})();

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
  const baseline = await waitStableHash(30000);
  assert.ok(baseline !== null, `probe must reach a stable idle baseline before driving (never settled in 30s)`);

  // tickLogs pins the tick path to a nonexistent file so tmin="?" under the noise gate
  // (SESSION-IDLE reports when tmin is unknown) — otherwise tmin reads the REAL quay tick-log mtime
  // and the IDLE event could be gated silent if the manager's loop happened to tick recently.
  const mon = spawnMonitor(env, `probe /tmp ${PROBE_TARGET}`, { tickLogs: `probe /nonexistent` });
  try {
    // 1. let the monitor establish its own idle baseline (≥2 rounds: PREV_HASH + PREV_IDLE=1).
    await sleep(3500);

    // 2. drive the probe busy with a task that runs tens of seconds (flash answers a light
    //    question in ~5s — at INTERVAL=1 a short window could be missed entirely).
    tmux(["send-keys", "-t", PROBE_TARGET, "C-u"], env);
    tmux(["send-keys", "-t", PROBE_TARGET, "运行 sleep 20 这条命令，等它结束后说 done"], env);
    tmux(["send-keys", "-t", PROBE_TARGET, "Enter"], env);

    // 3. the idle→busy transition must surface as SESSION-RESUMED within a few rounds.
    const resumed = await waitForOutput(mon, /SESSION-RESUMED probe/, 20000);
    assert.ok(resumed, `SESSION-RESUMED must fire when the probe goes busy:\n${mon.output()}`);

    // 4. wait for the probe to come back idle (busy task done, answer rendered, prompt stable).
    const settled = await waitStableHash(50000);
    assert.ok(settled !== null, `probe must return to a stable idle state after the busy task`);

    // 5. the busy→idle transition must surface as SESSION-IDLE within a few rounds of settling.
    const idle = await waitForOutput(mon, /SESSION-IDLE probe/, 15000);
    assert.ok(idle, `SESSION-IDLE must fire when the probe returns idle:\n${mon.output()}`);

    // 6. ordering: the busy transition precedes the idle transition.
    const out = mon.output();
    const rIdx = out.indexOf("SESSION-RESUMED");
    const iIdx = out.indexOf("SESSION-IDLE");
    assert.ok(rIdx !== -1 && iIdx !== -1 && rIdx < iIdx, `SESSION-RESUMED must precede SESSION-IDLE:\n${out}`);
  } finally {
    mon.child.kill("SIGKILL");
    mon.cleanup();
    tmux(["send-keys", "-t", PROBE_TARGET, "C-u"], env); // leave the probe at a clean prompt
    await sleep(500);
  }
});

// ── Test B: SESSION-GONE / SESSION-BACK (hermetic) ─────────────────────────────────────────────────────

test("SESSION-GONE then SESSION-BACK fire when the probe's claude process vanishes and returns", { skip: tmuxAvailable ? false : "tmux not installed" }, async () => {
  const p = makeHermeticProbe("ol-gone");
  try {
    assert.ok(await waitForAlive(p.env, p.session), "probe claude child must be alive before the monitor starts");
    const mon = spawnMonitor(p.env, `gone ${p.tmp} ${p.session}`, {});
    try {
      await sleep(2500); // ≥2 rounds: PREV_ALIVE=1 baseline
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

// ── Test C: REPO-STALL (hermetic) ─────────────────────────────────────────────────────────────────

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

// ── Test D: SESSION-OVERDUE (hermetic) ──────────────────────────────────────────────────────────

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

// ── Test E: .halt gating (hermetic) ────────────────────────────────────────────────────────────────

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
      await sleep(4000); // ≥3 rounds — STALL/OVERDUE would have fired by now if not gated
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

// ── Test F: transcript heartbeat (AC1/AC16) ──────────────────────────────────────────────────────────

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

// ── Test G: un-halt baseline reset (coordinator 2026-08-03 sample) ──────────────────────────────────

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
      await sleep(4000); // ≥3 rounds parked: both suppressed
      assert.ok(!/REPO-STALL/.test(mon.output()) && !/SESSION-OVERDUE/.test(mon.output()),
        `parked project must not STALL or OVERDUE:\n${mon.output()}`);
      // reproduce the coordinator's incident: the pane redraws (→ RESUMED) at the same moment .halt is removed.
      startBusyLoop(p.env, p.session);
      fs.rmSync(path.join(gitRoot, ".halt")); // un-halt
      const resumed = await waitForOutput(mon, /SESSION-RESUMED gate/, 25000);
      assert.ok(resumed, `RESUMED must fire on the busy transition:\n${mon.output()}`);
      // baseline reset ⇒ stale = now - max(hb, unhalt_ts) ≈ 0, so OVERDUE cannot fire for OVERDUE_MIN after un-halt.
      assert.ok(!/SESSION-OVERDUE/.test(mon.output()),
        `OVERDUE must NOT co-fire with RESUMED in the un-halt round (baseline reset):\n${mon.output()}`);
      assert.ok(!/REPO-STALL/.test(mon.output()),
        `REPO-STALL must NOT fire right after un-halt (repo-age baseline reset):\n${mon.output()}`);
    } finally {
      stopBusyLoop(p.env, p.session);
      mon.child.kill("SIGKILL");
    mon.cleanup();
    }
  } finally {
    p.cleanup();
  }
});

// ── LOOP_MIN split (coordinator 2026-08-03): OVERDUE's "预期周期" is a constant, not LOOP_MIN ─────

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

// ═════════════════════════════════════════════════════════════════════════════════════════════════
// 产品化（SPEC-outer-liveness-productization.md，AC1-AC9）与噪声标定（管理者 3 周期数据）
// ═════════════════════════════════════════════════════════════════════════════════════════════════
//
// AC1  plugin 源副本无绝对路径/具体会话名（grep /home/yale|quay-0:|archguard-2:|meta-cc-4: 无命中）。
// AC2  quay-init --loop 用已有参数（--tmux-session）把会话占位符替换进铺出的副本；全文无 quay 字面。
// AC3  零配置可用：铺出的脚本不带参数直接跑，识别本项目自己的外层。
// AC5  四个阈值写进随包外层 tick 文档（不只活在脚本注释里）。
// AC6  目标项目没有 tick 日志时不崩（新项目第一次跑必然没有）——OVERDUE 静默、其余事件正常。
// AC7  冷启动 e2e 是实跑断言（--once 接缝），不只断言文件存在。
// AC9  管理者的三项目配置在 orchestration/session-liveness.env，不进 plugin；脚本启动时 source 它。
// 噪声  SESSION-IDLE 在 tick 时距 < LOOP_MIN（刚记完 tick 的正常收尾）时静默；≥ LOOP_MIN 或未知才报。
//       SESSION-RESUMED 保留不静默（唯一正向信号）。两个正控制：旧 tick→报、新 tick→静默。

function makeTmp(prefix = "ol-prod-") {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}
function cleanup(dir) {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* best-effort */ }
}

// A worktree root quay-init's validation ACCEPTS: a real disk path, not tmpfs. /tmp is tmpfs on
// dev boxes and the sibling-of-repo default for a /tmp workspace would be rejected fail-closed
// (gap-the-shipped-tick-doc-... AC3). /var/tmp is the disk-backed tmp on Linux; prefer it.
function diskWorktreeRoot() {
  for (const base of ["/var/tmp", os.tmpdir()]) {
    try {
      const t = spawnSync("stat", ["-f", "-c", "%T", base], { encoding: "utf8" });
      if (t.status === 0 && t.stdout.trim() !== "tmpfs") {
        return path.join(base, `quay-wt-${process.pid}-${Math.random().toString(36).slice(2)}`);
      }
    } catch { /* try next base */ }
  }
  return path.join(os.tmpdir(), `quay-wt-${process.pid}-${Math.random().toString(36).slice(2)}`);
}

function runInit(workspace, args, pluginRoot = path.resolve(__dirname, "..")) {
  return spawnSync("bash", [path.join(pluginRoot, "scripts", "quay-init.sh"), ...args], {
    cwd: workspace,
    encoding: "utf8",
    env: { ...process.env, CLAUDE_PLUGIN_ROOT: pluginRoot },
  });
}

// busy-loop controls for a hermetic probe (claude child is job %1; the busy loop is job %2).
function startBusyLoop(env, session) {
  tmux(["send-keys", "-t", session, "while true; do date +%s.%N; sleep 0.2; done &"], env);
  tmux(["send-keys", "-t", session, "Enter"], env);
}
function stopBusyLoop(env, session) {
  tmux(["send-keys", "-t", session, "kill %2"], env);
  tmux(["send-keys", "-t", session, "Enter"], env);
}

// startTouchLoop — simulate a live session writing to its transcript: touch <file> every 0.5s.
function startTouchLoop(file) {
  return spawn("bash", ["-c", 'while true; do touch "$1"; sleep 0.5; done', "touch-loop", file],
    { stdio: "ignore" });
}

async function waitForPaneStable(env, session, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  const last3 = [];
  while (Date.now() < deadline) {
    const h = md5(tmux(["capture-pane", "-p", "-t", session], env).stdout);
    last3.push(h);
    if (last3.length > 3) last3.shift();
    if (last3.length === 3 && last3.every((x) => x === last3[0])) return h;
    await sleep(1000);
  }
  return null;
}

// ── AC1: plugin source is clean ────────────────────────────────────────────────────────────────────

test("AC1 — plugin/scripts/session-liveness.sh has no absolute paths, specific session names, or install placeholder", () => {
  const src = fs.readFileSync(SCRIPT, "utf8");
  assert.ok(!/(\/home\/yale|quay-0:|archguard-2:|meta-cc-4:)/.test(src),
    "source must not reference /home/yale or the three projects' specific tmux sessions");
  assert.ok(!src.includes("__QUAY_TMUX_SESSION__"),
    "source must not carry the install-time placeholder (AC1 — the session is resolved from env/config/default)");
});

// ── AC2: quay-init lays it down VERBATIM; the session is generated config ───────────────────────────
// gap-quay-init-rewrites-an-executable-instead-of-generating-config: 可执行文件一律原样复制，只生成配置。
// quay-init no longer rewrites session-liveness.sh (no __QUAY_TMUX_SESSION__ placeholder); the
// installed copy is byte-identical to the source. The per-project --tmux-session value is CONFIG,
// written to orchestration/session-liveness.env, which the (unmodified) script sources at startup.

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

// ── AC3/AC7: cold-start real run via the --once seam ───────────────────────────────────────────────

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

// ── AC6: no tick log must not crash, OVERDUE silent, other events fine ─────────────────────────────

test("AC6 — no tick log: SESSION-OVERDUE stays silent, other events work, no crash", async () => {
  const p = makeHermeticProbe("ol-notick");
  try {
    const mon = spawnMonitor(p.env, `notick ${p.tmp} ${p.session}`,
      { tickLogs: `notick ${path.join(p.tmp, "nope.md")}`, overdueMin: 1 });
    try {
      await sleep(4000);
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

// ── AC9: manager config lives in orchestration/session-liveness.env, sourced at startup ───────────────

test("AC9 — orchestration/session-liveness.env is the ZERO-CONFIG default (manager config moved out 2026-08-04 c1489b6a); an env file IS sourced when SESSION_TARGETS is unset", async () => {
  const realEnv = fs.readFileSync(path.resolve(__dirname, "..", "..", "orchestration", "session-liveness.env"), "utf8");
  assert.ok(!realEnv.includes("SESSION_TARGETS="),
    "orchestration/session-liveness.env must be the zero-config default — the manager's 3-project config was moved out to ~/.quay-global/manager-session-liveness.env (c1489b6a: it was being read by a session it was not meant for)");
  assert.ok(!realEnv.includes("quay-0:outer"),
    "the env file must NOT carry the three-project topology anymore");
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

// ── AC5: thresholds documented in the shipped outer tick doc ────────────────────────────────────────

test("AC5 — the shipped outer tick doc documents the four thresholds", () => {
  const doc = fs.readFileSync(path.resolve(__dirname, "..", "loop", "orchestrator-loop-tick.md"), "utf8");
  for (const t of ["INTERVAL", "STALL_MIN", "LOOP_MIN", "OVERDUE_MIN"]) {
    assert.ok(doc.includes(t), `the outer tick doc must document ${t} (AC5: a parameter only its author can tune is not a parameter)`);
  }
});

// ── 噪声标定（管理者 3 周期数据）：SESSION-IDLE 静默/报出的两个正控制 ─────────────────────────────────

test("noise gate — an idle transition with an OLD tick log IS reported (idle but no tick = anomaly)", async () => {
  const p = makeHermeticProbe("ol-gate-old");
  const tick = path.join(p.tmp, "tick.md");
  try {
    fs.writeFileSync(tick, "# tick\n");
    spawnSync("touch", ["-d", "3 hours ago", tick], { encoding: "utf8" });
    assert.ok(await waitForAlive(p.env, p.session), "probe must be alive first");
    const mon = spawnMonitor(p.env, `gate ${p.tmp} ${p.session}`, { tickLogs: `gate ${tick}`, interval: 1, loopMin: 5 });
    try {
      await sleep(2500); // idle baseline: PREV_IDLE=1
      startBusyLoop(p.env, p.session);
      assert.ok(await waitForOutput(mon, /SESSION-RESUMED gate/, 25000), `RESUMED must fire on busy:\n${mon.output()}`);
      stopBusyLoop(p.env, p.session);
      const stable = await waitForPaneStable(p.env, p.session, 15000);
      assert.ok(stable !== null, "pane must return to a stable idle state");
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
      await sleep(2500); // idle baseline: PREV_IDLE=1
      startBusyLoop(p.env, p.session);
      assert.ok(await waitForOutput(mon, /SESSION-RESUMED gate/, 25000), `RESUMED must fire on busy (monitor is tracking):\n${mon.output()}`);
      stopBusyLoop(p.env, p.session);
      const stable = await waitForPaneStable(p.env, p.session, 15000);
      assert.ok(stable !== null, "pane must return to a stable idle state");
      await sleep(3500); // ≥3 rounds after stability — IDLE would have fired by now if not gated
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

// ── AC21（gap-a-log-already-filtered-by-one-consumers-threshold-cannot-serve-a-second）──────────────
// 缺陷形状：单飞挂载 + 共享文件，而过滤发生在【发出端】⇒ 持有者的阈值被强加给所有订阅方。外层持有者
// LOOP_MIN=20 时，「空闲但心跳新鲜」（hmin < 20，健康循环收尾）在发出端被静默，根本没进共享文件，
// 管理者（订阅方）需要知道「外层空闲等输入 = 该派活了」，却看不到。
// AC21 机制：共享 events.jsonl 记全量（含 hmin 原始量），LOOP_MIN 只作用于持有者自己的 stdout。
// 两个方向一起验（最省事的"修法"是把抑制整个删掉——那会把噪声原样搬到持有者身上，必须同时守住）：
//   AC21c（负控制）：持有者 LOOP_MIN=20 时，共享 events.jsonl 里仍须出现 hmin < 20 的 IDLE 记录。
//   AC21d（外层加）：同一场景持有者自己的 stdout 里 SESSION-IDLE 通知数仍为 0。

function readEvents(globalDir) {
  const f = path.join(globalDir, "events.jsonl");
  if (!fs.existsSync(f)) return [];
  return fs.readFileSync(f, "utf8").trim().split("\n").filter(Boolean)
    .map((l) => { try { return JSON.parse(l); } catch { return null; } })
    .filter((e) => e && typeof e.event === "string");
}

test("AC21 — with LOOP_MIN=20 and a fresh heartbeat (hmin<20), the shared events.jsonl records the IDLE while the holder's stdout stays silent (record full, judge at read time)", { skip: tmuxAvailable ? false : "tmux not installed" }, async () => {
  const p = makeHermeticProbe("ol-ac21");
  const tick = path.join(p.tmp, "tick.md");
  try {
    fs.writeFileSync(tick, "# tick\n"); // mtime = now → hmin ≈ 0, well under LOOP_MIN=20
    assert.ok(await waitForAlive(p.env, p.session), "probe must be alive first");
    const mon = spawnMonitor(p.env, `ac21 ${p.tmp} ${p.session}`, { tickLogs: `ac21 ${tick}`, interval: 1, loopMin: 20 });
    try {
      await sleep(2500); // idle baseline: PREV_IDLE=1
      startBusyLoop(p.env, p.session);
      assert.ok(await waitForOutput(mon, /SESSION-RESUMED ac21/, 25000), `RESUMED must fire on busy (monitor is tracking):\n${mon.output()}`);
      stopBusyLoop(p.env, p.session);
      const stable = await waitForPaneStable(p.env, p.session, 15000);
      assert.ok(stable !== null, "pane must return to a stable idle state");
      await sleep(3500); // ≥3 rounds after stability — IDLE would have fired by now if not gated

      // AC21d: the holder's stdout must stay silent on a fresh-heartbeat idle (LOOP_MIN gate).
      assert.ok(!/SESSION-IDLE ac21/.test(mon.output()),
        `holder stdout must stay silent on a fresh-heartbeat idle (AC21d — the gate is on stdout only):\n${mon.output()}`);

      // AC21c: the shared events.jsonl MUST carry the IDLE record with the raw hmin (< 20).
      const events = readEvents(mon.globalDir);
      const idle = events.find((e) => e.event === "SESSION-IDLE" && e.name === "ac21");
      assert.ok(idle, `shared events.jsonl must record the IDLE transition (AC21c — record full, judge at read time):\n${JSON.stringify(events, null, 2)}`);
      const hminMatch = idle.msg.match(/心跳 (\d+) 分钟前更新/);
      assert.ok(hminMatch && Number(hminMatch[1]) < 20,
        `the shared IDLE record must carry hmin < 20 (the raw quantity, AC21b), got msg=${idle.msg}`);
    } finally {
      mon.child.kill("SIGKILL");
    mon.cleanup();
    }
  } finally {
    p.cleanup();
  }
});

// ── AC11: heartbeat parameterized for the INNER use case (a directory, not a file) ────────────────

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

// ── AC12/AC13: both shipped tick docs state what to mount ──────────────────────────────────────────
// AC12 was rewritten when inner-state.sh was retired (gap-retire-inner-state-one-observer-targets-by-
// parameter AC2): observation has ONE tool, session-liveness.sh. The outer tick doc must name
// session-liveness.sh as the ONE monitor (and reference inner-state.sh only as RETIRED, never as a
// mount criterion); the inner tick doc must state that the inner mounts session-liveness.sh.

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

// ── 版本可见性（管理者建议，2026-08-03）：启动指纹让「跑的是哪个版本」可从外部查 ─────────────────

test("startup stamp makes the running version visible (file + md5 to stderr, matching the on-disk file)", () => {
  const r = spawnSync("bash", [SCRIPT, "--once"], { encoding: "utf8", env: { ...process.env, SESSION_ROOT: "/tmp" } });
  assert.match(r.stderr, /session-liveness: starting pid=\d+ file=session-liveness\.sh md5=[0-9a-f]{16}/,
    `startup stamp must carry pid/file/md5 on stderr:\n${r.stderr}`);
  const diskMd5 = md5(fs.readFileSync(SCRIPT, "utf8"));
  assert.ok(r.stderr.includes(diskMd5),
    `stamp md5 must equal the loaded file's md5 (${diskMd5}), so a stale instance is detectable by comparison:\n${r.stderr}`);
});

// ═════════════════════════════════════════════════════════════════════════════
// 阶段二（gap-session-liveness-stage-2-screen-signal-and-payload，2026-08-03）：
// 屏幕语义标志 + 屏蔽易变区 + 交叉正控制 + payload + 每类阈值 + 发不出请求判别
//（AC1-AC9，承接前任务阶段二）。新增 AC 的正控制与防过滤断言都在这下面。
// ═════════════════════════════════════════════════════════════════════════════

// 合成 transcript 帮助函数（阶段二：AC6/AC7/AC9 需要可控的 JSONL 内容）。
function userRecord(ts, content = "hello") {
  return JSON.stringify({ type: "user", message: { role: "user", content }, timestamp: ts });
}
function assistantRecord(ts, text = "ok") {
  return JSON.stringify({ type: "assistant", message: { role: "assistant", content: [{ type: "text", text }] }, timestamp: ts });
}
function apiErrorRecord(ts) {
  return JSON.stringify({ type: "assistant", isApiErrorMessage: true, apiErrorStatus: 429,
    message: { role: "assistant", content: [{ type: "text", text: "API Error: Request rejected (429)" }] },
    timestamp: ts });
}
const isoAgo = (min) => new Date(Date.now() - min * 60000).toISOString();

// ── AC1：--mask 接缝——屏蔽 token 计数/转圈/✻ 残留，保留真内容行 ───────────────────────────

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

// ── AC1/AC3/AC6/AC7：语义标志驱动忙闲；RESUMED 带成因 + 上次收到输入 ─────────────────────────

test("AC1/AC3/AC6/AC7 — esc to interrupt PRESENCE drives busy/idle; RESUMED carries cause + last-input; IDLE fires when the flag disappears", { skip: tmuxAvailable ? false : "tmux not installed" }, async () => {
  const p = makeHermeticProbe("ol-esc");
  try {
    assert.ok(await waitForAlive(p.env, p.session), "probe must be alive");
    // tickLogs pins the heartbeat to /nonexistent so hmin="?" under the noise gate: the IDLE
    // transition is always reported, and the REAL worktree tick-log cannot gate it silent
    // (same isolation test A uses).
    const mon = spawnMonitor(p.env, `esc ${p.tmp} ${p.session}`, { tickLogs: `esc /nonexistent` });
    try {
      await sleep(3000); // idle baseline: bash prompt, no esc flag
      tmux(["send-keys", "-t", p.session, "echo 'esc to interrupt'; sleep 100 &"], p.env);
      tmux(["send-keys", "-t", p.session, "Enter"], p.env);
      const resumed = await waitForOutput(mon, /SESSION-RESUMED esc/, 25000);
      assert.ok(resumed, `RESUMED must fire when esc to interrupt appears:\n${mon.output()}`);
      const out = mon.output();
      assert.ok(/成因：esc to interrupt 标志出现/.test(out),
        `RESUMED must name the semantic flag as the cause (AC3/AC6 — 可解释、无需再采样):\n${out}`);
      assert.ok(/上次收到输入：取不到/.test(out),
        `RESUMED must say 取不到 when no transcript is configured (AC7 — 不得省略该字段):\n${out}`);
      tmux(["send-keys", "-t", p.session, "C-u"], p.env);
      tmux(["send-keys", "-t", p.session, "clear"], p.env);
      tmux(["send-keys", "-t", p.session, "Enter"], p.env);
      assert.ok(await waitForOutput(mon, /SESSION-IDLE esc/, 8000),
        `IDLE must fire once the semantic flag disappears:\n${mon.output()}`);
    } finally {
      mon.child.kill("SIGKILL");
    mon.cleanup();
    }
  } finally {
    p.cleanup();
  }
});

// ── AC1（吸收姊妹任务的修复面）：只有 token 计数 chrome 在变 ⇒ 判空闲、零事件 ─────────────────

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
    // tickLogs /nonexistent isolates the heartbeat so OVERDUE (from the real worktree tick-log)
    // can't fire and pollute the event stream; we assert zero RESUMED/IDLE.
    const mon = spawnMonitor(p.env, `tok ${p.tmp} ${p.session}`, { tickLogs: `tok /nonexistent` });
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

// ── AC2：交叉正控制——transcript 刚写过而屏幕判空闲 ⇒ 报标志可能失效 ─────────────────────────

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

// ── AC9（盲点13）：空闲 + isApiErrorMessage 结构字段 ⇒ 发不出请求；健康/陈旧 ⇒ 常规 ─────────────

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

// ── AC6/AC7：RESUMED 的成因 + 上次收到输入（有 transcript 时不取不到）──────────────────────────

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
      tmux(["send-keys", "-t", p.session, "echo 'esc to interrupt'; sleep 100 &"], p.env);
      tmux(["send-keys", "-t", p.session, "Enter"], p.env);
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
      tmux(["send-keys", "-t", p.session, "echo 'esc to interrupt'; sleep 100 &"], p.env);
      tmux(["send-keys", "-t", p.session, "Enter"], p.env);
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
  // Mutation (checker-mutation method): force cause="" right before the SESSION-RESUMED echo. The
  // strengthened AC6 assertion (`/成因：[^；）]/`) must reject the empty cause — proving the 25s
  // window is not the check and the cause path is actually asserted (the old `! /成因：\)/` was a
  // no-op: ASCII paren never appears in the full-width output, so an empty cause passed).
  const p = makeHermeticProbe("ol-nc-cause");
  const x = path.join(p.tmp, "session.jsonl");
  fs.writeFileSync(x, [userRecord(isoAgo(5)), assistantRecord(isoAgo(0.05))].join("\n") + "\n");
  const mutated = path.join(p.tmp, "session-liveness-mutated.sh");
  // The event emitter is sl_emit (writes stdout + shared file); the mutation must target THAT call.
  fs.writeFileSync(mutated, fs.readFileSync(SCRIPT, "utf8").replace(/sl_emit "SESSION-RESUMED/,
    'cause=""\n            sl_emit "SESSION-RESUMED'));
  try {
    assert.ok(await waitForAlive(p.env, p.session), "probe must be alive");
    const mon = spawnMonitor(p.env, `pl ${p.tmp} ${p.session}`, { script: mutated, transcripts: `pl ${x}` });
    try {
      await sleep(3000); // idle baseline
      tmux(["send-keys", "-t", p.session, "echo 'esc to interrupt'; sleep 100 &"], p.env);
      tmux(["send-keys", "-t", p.session, "Enter"], p.env);
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

// ── AC5：OVERDUE_MIN 默认 45→30（不可自愈类宁可误报）；文档同步 ───────────────────────────────

test("AC5 — OVERDUE_MIN default is 30 (non-self-healing, prefer false-positive: earlier than 45); the shipped outer tick doc carries the value", () => {
  const src = fs.readFileSync(SCRIPT, "utf8");
  assert.match(src, /OVERDUE_MIN=\$\{OVERDUE_MIN:-30\}/,
    "OVERDUE_MIN default must be 30 after the AC5 reverse-tuning (45 → 30)");
  const doc = fs.readFileSync(path.resolve(__dirname, "..", "loop", "orchestrator-loop-tick.md"), "utf8");
  const row = doc.match(/\| `OVERDUE_MIN` \| `(\d+)` \|/);
  assert.ok(row && row[1] === "30", `the outer tick doc must document OVERDUE_MIN=30, got ${row && row[1]}:\n${doc.slice(0, 2000)}`);
});

// ── AC4：两种信号的取舍写进文件头，并写明同时用时以谁为准 ─────────────────────────────────────

test("AC4 — the script header documents the screen-vs-transcript tradeoff, each signal's blind spot, and which wins when both are used", () => {
  const src = fs.readFileSync(SCRIPT, "utf8");
  assert.ok(src.includes("两种信号"), "header must carry the AC4 两种信号 section");
  assert.ok(src.includes("同时用时以谁为准"), "header must state which signal wins when both are used");
  assert.ok(src.includes("盲区"), "header must name each signal's blind spot");
  assert.ok(src.includes("SESSION-MARKER-STALE"), "header must name the cross positive control event (AC2)");
});

// ═════════════════════════════════════════════════════════════════════════════
// 单飞挂载（AC20a/b/d/AC5/AC6/AC7，gap-liveness-mounting-is-a-single-flight-role-with-no-owner）
// ═════════════════════════════════════════════════════════════════════════════
//
// 「谁需要谁自己起一个」对单飞资源是错的默认；正确的默认是「谁需要谁去订阅」，挂载是一个有主的、
// 可接管的角色。这些测试把 AC20a–d / AC5 / AC6 / AC7 变成机械断言：
//   M1  AC20a 第一个挂载取单飞锁（复用 heavy-op-token 的锁），锁记录的 pid 就是监视器进程自己。
//   M2  AC20b 有活持有者时再挂 ⇒ 退出 0、打印属主与 pid、不新增进程（空操作不是失败）。
//   M3  AC20d kill -9 持有者后下一次挂载必须接管，输出 takeover_ms。
//   M4  AC5   持有者活着时绝不接管、绝不 kill——锁字节不变、持有者进程不灭。
//   M5  AC6   三次挂载（一次持有 + 两次空操作）后 mount_count == 1。
//   M6  AC20c/AC7 事件 + HEARTBEAT 写进共享 events.jsonl；第二方不挂载即可读到同一批事件；
//                 持有者死后心跳停止增长（订阅方据此判定「看门的不在了」）。
//   M7  AC1   复用点：session-liveness.sh 调用 heavy-op-token.sh 的锁；mount 入口 exec 监视器。
//
// 隔离：每个测试用独立的 SESSION_LIVENESS_GLOBAL_DIR 临时目录，绝不触碰真实 $HOME/.quay-global；
// mount_count 按「/proc/<pid>/environ 带本测试全局目录 + cmdline 含 session-liveness.sh」统计，
// 与契约的 `ps -eo ppid,args | grep -c '[s]ession-liveness.sh'` 同构但限定在本测试的锁域内
// （真实生产监视器不会漏进来）。所有挂载测试都跳过 --once 诊断接缝（不取锁）。

const MOUNT = path.join(__dirname, "..", "scripts", "session-liveness-mount.sh");

function mountEnv(globalDir, { owner = "test-owner", staleS = 2, targets, env = process.env } = {}) {
  return {
    ...env,
    SESSION_LIVENESS_GLOBAL_DIR: globalDir,
    SESSION_LIVENESS_OWNER: owner,
    SESSION_LIVENESS_MOUNT_STALE_S: String(staleS),
    SESSION_TARGETS: targets ?? `mt ${globalDir} mt-nonexistent`,
    INTERVAL: "1",
    STALL_MIN: "999",
    OVERDUE_MIN: "999",
  };
}

// countMountProcesses — mount_count scoped to THIS test's lock domain: session-liveness.sh processes
// (NOT session-liveness-mount.sh) whose /proc/<pid>/environ carries our SESSION_LIVENESS_GLOBAL_DIR.
function countMountProcesses(globalDir) {
  let n = 0;
  for (const d of fs.readdirSync("/proc", { withFileTypes: true })) {
    if (!/^\d+$/.test(d.name)) continue;
    let env, cmd;
    try { env = fs.readFileSync(`/proc/${d.name}/environ`, "utf8"); } catch { continue; }
    try { cmd = fs.readFileSync(`/proc/${d.name}/cmdline`, "utf8"); } catch { continue; }
    if (env.includes(`SESSION_LIVENESS_GLOBAL_DIR=${globalDir}`) && cmd.includes("session-liveness.sh")) n++;
  }
  return n;
}

async function waitForToken(globalDir, timeoutMs = 8000) {
  const tokenPath = path.join(globalDir, "heavy-op", "token");
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline && !fs.existsSync(tokenPath)) await sleep(50);
  return fs.existsSync(tokenPath) ? fs.readFileSync(tokenPath, "utf8") : null;
}

test("M1 (AC20a) — the first mount acquires the single-flight lock; the recorded pid IS the monitor process", { skip: tmuxAvailable ? false : "tmux not installed" }, async () => {
  const globalDir = fs.mkdtempSync(path.join(os.tmpdir(), "sl-mount-"));
  let m;
  try {
    m = spawn("bash", [MOUNT], { env: mountEnv(globalDir) });
    const token = await waitForToken(globalDir);
    assert.ok(token, "the first mount must acquire the lock");
    assert.match(token, /holder=test-owner/, `lock must record the owner:\n${token}`);
    const pid = parseInt(token.match(/pid=(\d+)/)[1], 10);
    assert.equal(pid, m.pid, `the lock's recorded pid must be the monitor's own pid (got ${pid}, monitor ${m.pid})`);
    const cmd = fs.readFileSync(`/proc/${pid}/cmdline`, "utf8").replace(/\0/g, " ");
    assert.ok(cmd.includes("session-liveness.sh"), `recorded pid must be the running monitor:\n${cmd}`);
  } finally {
    if (m) m.kill("SIGKILL");
    fs.rmSync(globalDir, { recursive: true, force: true });
  }
});

test("M2 (AC20b) + M4 (AC5) — a second mount with a live holder is a NO-OP: exit 0, prints owner+pid, no new process, never steals", { skip: tmuxAvailable ? false : "tmux not installed" }, async () => {
  const globalDir = fs.mkdtempSync(path.join(os.tmpdir(), "sl-mount-"));
  const tokenPath = path.join(globalDir, "heavy-op", "token");
  let holder;
  try {
    holder = spawn("bash", [MOUNT], { env: mountEnv(globalDir) });
    assert.ok(await waitForToken(globalDir), "holder must have the lock");
    const before = countMountProcesses(globalDir);
    assert.equal(before, 1, `exactly one mount process before the second mount, got ${before}`);
    const tokenBefore = fs.readFileSync(tokenPath, "utf8");
    const holderPid = holder.pid;

    const t0 = Date.now();
    const second = spawnSync("bash", [MOUNT], { encoding: "utf8", env: mountEnv(globalDir, { owner: "test-owner2" }) });
    const elapsed = Date.now() - t0;

    assert.equal(second.status, 0, `second mount must exit 0 (no-op, not a failure):\n${second.stdout}\n${second.stderr}`);
    assert.ok(elapsed < 10000, `second mount must be quick (a no-op does not wait for the holder to die), took ${elapsed}ms`);
    assert.match(second.stdout, /已有活持有者/, `second mount must say a live holder exists:\n${second.stdout}`);
    assert.match(second.stdout, /test-owner/, `second mount must print the holder's owner:\n${second.stdout}`);
    assert.match(second.stdout, /pid \d+/, `second mount must print the holder's pid:\n${second.stdout}`);

    const after = countMountProcesses(globalDir);
    assert.equal(after, 1, `second mount must NOT add a process (mount_count stays 1), got ${after}`);
    assert.equal(fs.readFileSync(tokenPath, "utf8"), tokenBefore,
      "AC5: the lock must be byte-identical after a no-op — the second mount never steals/kills");
    assert.ok(fs.existsSync(`/proc/${holderPid}`), "AC5: the original holder must still be alive (never killed)");
  } finally {
    if (holder) holder.kill("SIGKILL");
    fs.rmSync(globalDir, { recursive: true, force: true });
  }
});

test("M3 (AC20d) — after kill -9 of the holder, the next mount TAKES OVER and reports takeover_ms", { skip: tmuxAvailable ? false : "tmux not installed" }, async () => {
  const globalDir = fs.mkdtempSync(path.join(os.tmpdir(), "sl-mount-"));
  const tokenPath = path.join(globalDir, "heavy-op", "token");
  let holder;
  try {
    holder = spawn("bash", [MOUNT], { env: mountEnv(globalDir, { staleS: 1 }) });
    assert.ok(await waitForToken(globalDir), "holder must have the lock");
    const holderPid = holder.pid;
    holder.kill("SIGKILL"); holder = null;
    await sleep(100);
    assert.ok(!fs.existsSync(`/proc/${holderPid}`), "holder must be dead after kill -9");

    const m3 = spawn("bash", [MOUNT], { env: mountEnv(globalDir, { staleS: 1 }) });
    let out3 = "";
    m3.stdout.on("data", (d) => { out3 += d; });
    m3.stderr.on("data", (d) => { out3 += d; });
    try {
      const dl2 = Date.now() + 15000;
      while (Date.now() < dl2 && !/接管成功 takeover_ms=\d+/.test(out3)) await sleep(100);
      assert.match(out3, /接管成功 takeover_ms=\d+/,
        `the next mount must take over and measure takeover_ms:\n${out3}`);
      const token2 = fs.readFileSync(tokenPath, "utf8");
      const newPid = parseInt(token2.match(/pid=(\d+)/)[1], 10);
      assert.equal(newPid, m3.pid, `after takeover the new holder must be the new mount:\n${token2}`);
      assert.ok(fs.existsSync(`/proc/${newPid}`), "the new holder must be running");
      // The holder's observer forks TRANSIENT subshells for its command substitutions (pid=$(...),
      // ttype=$(...), etc.) — same cmdline + env, parented by the observer, gone within a loop tick.
      // countMountProcesses cannot distinguish them from a real second holder at an arbitrary instant,
      // so a single-shot count races them (intermittent count=2 — reproduced pre-session-idle; the
      // transcript-fusion command substitutions raise the spawn rate). The AC's intent is "no PERMANENT
      // second monitor": poll until the count settles at exactly 1. A real takeover leak keeps 2+
      // persistently and fails the bounded wait.
      let settled = 0;
      const dlSettle = Date.now() + 5000;
      while (Date.now() < dlSettle) {
        const c = countMountProcesses(globalDir);
        if (c === 1) { settled = c; break; }
        await sleep(50);
      }
      assert.equal(settled, 1, `takeover must not leave a second monitor process (settled count was ${settled})`);
    } finally {
      m3.kill("SIGKILL");
    }
  } finally {
    if (holder) holder.kill("SIGKILL");
    fs.rmSync(globalDir, { recursive: true, force: true });
  }
});

test("M5 (AC6) — three mounts in one lock domain ⇒ exactly ONE surviving session-liveness.sh process (mount_count=1)", { skip: tmuxAvailable ? false : "tmux not installed" }, async () => {
  const globalDir = fs.mkdtempSync(path.join(os.tmpdir(), "sl-mount-"));
  let holder;
  try {
    holder = spawn("bash", [MOUNT], { env: mountEnv(globalDir) });
    assert.ok(await waitForToken(globalDir), "the first mount must hold the lock");
    for (let i = 0; i < 2; i++) {
      const r = spawnSync("bash", [MOUNT], { encoding: "utf8", env: mountEnv(globalDir) });
      assert.equal(r.status, 0, `mount ${i + 2} must exit 0 (no-op):\n${r.stdout}\n${r.stderr}`);
    }
    await sleep(200);
    assert.equal(countMountProcesses(globalDir), 1,
      `after three mounts, mount_count must be 1 (one holder, two no-ops), got ${countMountProcesses(globalDir)}`);
  } finally {
    if (holder) holder.kill("SIGKILL");
    fs.rmSync(globalDir, { recursive: true, force: true });
  }
});

test("M6 (AC20c/AC7) — a SESSION-* event + HEARTBEAT land in the shared events.jsonl; a second party reads them WITHOUT mounting; heartbeat stops after holder death", { skip: tmuxAvailable ? false : "tmux not installed" }, async () => {
  const p = makeHermeticProbe("ol-shared");
  const globalDir = path.join(p.tmp, "sl-global");
  const eventsFile = path.join(globalDir, "events.jsonl");
  let holder;
  try {
    assert.ok(await waitForAlive(p.env, p.session), "probe must be alive first");
    holder = spawn("bash", [MOUNT], { env: mountEnv(globalDir, { targets: `sh ${p.tmp} ${p.session}`, env: p.env }) });
    // wait for the first HEARTBEAT in the shared file
    const dl1 = Date.now() + 10000;
    while (Date.now() < dl1 && !(fs.existsSync(eventsFile) && /HEARTBEAT/.test(fs.readFileSync(eventsFile, "utf8")))) await sleep(100);
    let content = fs.readFileSync(eventsFile, "utf8");
    assert.match(content, /"event":"HEARTBEAT"/, `shared events file must carry HEARTBEAT lines:\n${content}`);
    assert.match(content, /"ts":\d+/, `events must carry timestamps (AC7):\n${content}`);

    // trigger a real SESSION-GONE (kill the probe's claude child) — it must land in the shared file
    tmux(["send-keys", "-t", p.session, "kill %1"], p.env);
    tmux(["send-keys", "-t", p.session, "Enter"], p.env);
    const dl2 = Date.now() + 10000;
    while (Date.now() < dl2 && !(fs.existsSync(eventsFile) && /SESSION-GONE sh/.test(fs.readFileSync(eventsFile, "utf8")))) await sleep(100);
    content = fs.readFileSync(eventsFile, "utf8");
    assert.match(content, /SESSION-GONE sh/, `SESSION-GONE must land in the shared file (AC20c: 第二方不挂载即可读到同一批事件):\n${content}`);
    assert.match(content, /"event":"SESSION-GONE"/, `the event must be JSON-structured:\n${content}`);
    assert.equal(countMountProcesses(globalDir), 1, "reading the shared file must not require a second mount");

    // kill the holder → the heartbeat stops growing → a subscriber sees staleness (AC7, no one re-mounts)
    const lastTsBefore = Number([...fs.readFileSync(eventsFile, "utf8").matchAll(/"ts":(\d+)/g)].at(-1)[1]);
    holder.kill("SIGKILL"); holder = null;
    await sleep(1500);
    const lastTsAfter = Number([...fs.readFileSync(eventsFile, "utf8").matchAll(/"ts":(\d+)/g)].at(-1)[1]);
    assert.equal(lastTsAfter, lastTsBefore,
      "after the holder dies, no new heartbeat events are appended — the subscriber can detect the holder is gone (AC7)");
  } finally {
    if (holder) holder.kill("SIGKILL");
    p.cleanup();
  }
});

test("M7 (AC1) — the reuse point: session-liveness.sh calls heavy-op-token.sh's lock; session-liveness-mount.sh execs the monitor", () => {
  const sl = fs.readFileSync(SCRIPT, "utf8");
  // AC1 复用点：不新写一套锁——直接调用 heavy-op-token.sh 的 --acquire（wx 原子创建 + mtime 陈旧 AND
  // pid 不存活才回收，那套锁已在真实死持有者上回收 17 次）。
  assert.ok(sl.includes("heavy-op-token.sh") && sl.includes("--acquire"),
    "session-liveness.sh must call heavy-op-token.sh --acquire (the reuse point, AC1)");
  assert.ok(sl.includes("mtime 陈旧") && sl.includes("pid 不存活"),
    "the header must cite the lock's stale-reclaim rule (mtime stale AND dead pid)");
  const mount = fs.readFileSync(MOUNT, "utf8");
  assert.match(mount, /exec bash .*session-liveness\.sh/, "the mount entry must exec session-liveness.sh (holder pid survives exec)");
});

// ═════════════════════════════════════════════════════════════════════════════
// 阶段三（gap-session-idle-true-idle-via-transcript-fusion-and-debounce，2026-08-05）：
// transcript 最后一条消息类型融合 + 候选闲去抖。AC1/AC2/AC3/AC4/AC5。
// 核心：pane 哈希只答「屏幕变没变」，分不清真空闲与工具间隙。transcript 最后一条【消息】的
// 类型是结构信号（已发生事实的日志，故障 5/6 结晶的结论）——assistant 带 tool_use = 回合进行中
// （确定忙，AC5 硬上限）；assistant 纯文本 = 候选闲；user = 模型即将应答（按忙）。忙闲判据 =
// pane_busy || transcript_busy；候选闲需连续 IDLE_DEBOUNCE_ROUNDS（=2）轮都闲才报 SESSION-IDLE
// （AC2）。pane 哈希降级为去抖的候选闲辅助，不再单判（AC7）。
// ═════════════════════════════════════════════════════════════════════════════

// 合成 transcript 记录（阶段三）：与真实 Claude Code JSONL 顶层格式一致（实测 2026-08-05）。
function assistantToolUseRecord(ts) {
  return JSON.stringify({ type: "assistant",
    message: { role: "assistant", content: [{ type: "tool_use", id: "toolu_1", name: "Bash", input: { command: "true" } }] },
    timestamp: ts });
}
function assistantTextRecord(ts, text = "ok") {
  return JSON.stringify({ type: "assistant",
    message: { role: "assistant", content: [{ type: "text", text }] },
    timestamp: ts });
}
function userInputRecord(ts, content = "hello") {
  return JSON.stringify({ type: "user", message: { role: "user", content }, timestamp: ts });
}

// writeTranscript —— 覆盖写 transcript 并可选回拨 mtime（回拨 = 陈旧：不发 marker-stale、hmin≥1）。
function writeTranscript(file, records, backdateMin = 0) {
  fs.writeFileSync(file, records.join("\n") + "\n");
  if (backdateMin > 0) spawnSync("touch", ["-d", `${backdateMin} minutes ago`, file], { encoding: "utf8" });
}

// waitForHeartbeats —— 等共享 events.jsonl 里出现 ≥n 条 HEARTBEAT（监视器每轮写一条，作为轮次刻度）。
function countHeartbeats(globalDir) {
  const f = path.join(globalDir, "events.jsonl");
  if (!fs.existsSync(f)) return 0;
  const content = fs.readFileSync(f, "utf8");
  if (!content.trim()) return 0;
  return content.split("\n").filter((l) => l.includes('"event":"HEARTBEAT"')).length;
}
async function waitForHeartbeats(globalDir, n, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (countHeartbeats(globalDir) >= n) return true;
    await sleep(100);
  }
  return countHeartbeats(globalDir) >= n;
}

// ── AC1 单元测试：--last-message-type 接缝（确定性，不依赖 tmux）──────────────────────────

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

// ── AC3（真·空闲被检出）：纯文本轮 + 无新工具调用 ⇒ 报 SESSION-IDLE ──────────────────────────
// 管理者实测场景：纯文本轮次完成后 8.5 分钟无新工具调用 + pane 无忙碌标志 = 真空闲。测试用
// transcript 控制：先挂起 tool_use（忙轮，SEEN_BUSY=1），再切成纯文本并回拨 8 分钟（真闲）。
// 去抖（2 轮）后必须报 SESSION-IDLE——真空闲被检出，不是间隙误判。

test("AC3 — a pure-text round with no new tool calls (stale transcript) reports SESSION-IDLE after the 2-round debounce (true idle detected, not a gap misjudged)", { skip: tmuxAvailable ? false : "tmux not installed" }, async () => {
  const p = makeHermeticProbe("ol-trueidle");
  const x = path.join(p.tmp, "session.jsonl");
  writeTranscript(x, [assistantToolUseRecord(isoAgo(0.1))], 1); // busy phase first (SEEN_BUSY=1)
  try {
    assert.ok(await waitForAlive(p.env, p.session), "probe must be alive");
    const mon = spawnMonitor(p.env, `ac3 ${p.tmp} ${p.session}`,
      { transcripts: `ac3 ${x}`, overdueMin: 999, loopMin: 1, interval: 1 });
    try {
      // busy phase: ≥2 rounds so SEEN_BUSY=1 (the debounce never fires on a never-busy session).
      assert.ok(await waitForHeartbeats(mon.globalDir, 2, 15000), `monitor must run ≥2 busy rounds:\n${mon.output()}`);
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

// ── AC4（间隙不被报）：两次工具调用间短到一次轮询的纯文本不得报 SESSION-IDLE ────────────────
// 用 HEARTBEAT 行作轮次刻度做确定性同步：忙轮（挂起 tool_use）→ 恰好一轮纯文本（间隙）→
// 忙轮。去抖（连续 2 轮才报）必须按住这一轮；随后持续纯文本（真闲）必须报——证明间隙抑制
// 是去抖的功劳，不是探测器坏了。

test("AC4 — a pure-text blip lasting exactly ONE monitor round between two tool_use rounds does NOT report SESSION-IDLE (debounce holds); a persistent pure-text then DOES", { skip: tmuxAvailable ? false : "tmux not installed" }, async () => {
  const p = makeHermeticProbe("ol-gap4");
  const x = path.join(p.tmp, "session.jsonl");
  writeTranscript(x, [assistantToolUseRecord(isoAgo(0.1))], 1); // busy: pending-tool-use, stale
  try {
    assert.ok(await waitForAlive(p.env, p.session), "probe must be alive");
    const mon = spawnMonitor(p.env, `gap4 ${p.tmp} ${p.session}`,
      { transcripts: `gap4 ${x}`, overdueMin: 999, loopMin: 1, interval: 1 });
    try {
      // phase 1: ≥2 busy rounds (SEEN_BUSY=1); HEARTBEAT lines give the round cadence.
      assert.ok(await waitForHeartbeats(mon.globalDir, 2, 15000), `monitor must run ≥2 rounds:\n${mon.output()}`);
      // phase 2: the GAP — exactly one round of pure-text, then back to busy before the 2nd idle round.
      writeTranscript(x, [assistantTextRecord(isoAgo(0.1))], 1); // the gap: transcript pure-text, pane static
      assert.ok(await waitForHeartbeats(mon.globalDir, 3, 15000), `one idle round must elapse:\n${mon.output()}`);
      writeTranscript(x, [assistantToolUseRecord(isoAgo(0.1))], 1); // back to busy before the 2nd idle round
      // phase 3: several busy rounds — a wrongly-held debounce would have fired by now.
      assert.ok(await waitForHeartbeats(mon.globalDir, 6, 20000), `several busy rounds must elapse:\n${mon.output()}`);
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

// ── AC5（忙判据零漏报）：transcript 有挂起 tool_use（回合进行中）⇒ 任何情况下不得报 idle ──
// 硬上限：pane 恰好不动（pane_idle=1）时，transcript 的 pending-tool-use 仍判忙——零漏报。
// 随后切成纯文本（挂起 tool_use 清除）⇒ 必须报 idle——证明忙抑制来自 pending-tool-use。

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
