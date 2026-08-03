// @test-group governance
// session-liveness.test.mjs — automated positive controls for the cross-project session-liveness
// monitor (plugin/scripts/session-liveness.sh; generalized + renamed from outer-liveness.sh per
// SPEC-outer-liveness-productization.md AC10-13 — the process/pane/heartbeat logic holds for ANY
// Claude Code session, not just the outer). The manager built and verified the original manually;
// this file turns those manual controls into tests, per rule 2 of orchestration/TOOLS-SESSION-
// HANDOFF.md: "干跑没有输出不是证据" — every criterion needs a known-triggering setup that
// demonstrably fires, because "no output" is indistinguishable from "it never reports".
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
function spawnMonitor(env, targets, { tickLogs, transcripts, stallMin = 1, overdueMin = 1, interval = 1, loopMin } = {}) {
  const monEnv = {
    ...env,
    SESSION_TARGETS: targets,
    INTERVAL: String(interval),
    STALL_MIN: String(stallMin),
    OVERDUE_MIN: String(overdueMin),
  };
  if (tickLogs) monEnv.SESSION_HEARTBEATS = tickLogs;
  if (transcripts) monEnv.SESSION_TRANSCRIPTS = transcripts;
  if (loopMin !== undefined) monEnv.LOOP_MIN = String(loopMin);
  const child = spawn("bash", [SCRIPT], { env: monEnv });
  let out = "";
  child.stdout.on("data", (d) => { out += d; });
  child.stderr.on("data", (d) => { out += d; });
  return { child, output: () => out };
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
      const resumed = await waitForOutput(mon, /SESSION-RESUMED gate/, 8000);
      assert.ok(resumed, `RESUMED must fire on the busy transition:\n${mon.output()}`);
      // baseline reset ⇒ stale = now - max(hb, unhalt_ts) ≈ 0, so OVERDUE cannot fire for OVERDUE_MIN after un-halt.
      assert.ok(!/SESSION-OVERDUE/.test(mon.output()),
        `OVERDUE must NOT co-fire with RESUMED in the un-halt round (baseline reset):\n${mon.output()}`);
      assert.ok(!/REPO-STALL/.test(mon.output()),
        `REPO-STALL must NOT fire right after un-halt (repo-age baseline reset):\n${mon.output()}`);
    } finally {
      stopBusyLoop(p.env, p.session);
      mon.child.kill("SIGKILL");
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
      "--test-command", "node --test", "--tmux-session", "ol-cold:0.0"]);
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
    }
  } finally {
    p.cleanup();
  }
});

// ── AC9: manager config lives in orchestration/session-liveness.env, sourced at startup ───────────────

test("AC9 — manager's 3-project config lives in orchestration/session-liveness.env, not the script; it is sourced when SESSION_TARGETS is unset", async () => {
  const realEnv = fs.readFileSync(path.resolve(__dirname, "..", "..", "orchestration", "session-liveness.env"), "utf8");
  assert.ok(realEnv.includes("SESSION_TARGETS="), "orchestration/session-liveness.env must carry SESSION_TARGETS");
  assert.ok(realEnv.includes("quay-0:outer") && realEnv.includes("archguard-2:outer") && realEnv.includes("meta-cc-4:outer"),
    "the env file must carry the three-project topology");
  assert.ok(!fs.readFileSync(SCRIPT, "utf8").includes("quay-0:"), "the script must NOT carry the topology (moved out to orchestration/)");

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
      assert.ok(await waitForOutput(mon, /SESSION-RESUMED gate/, 8000), `RESUMED must fire on busy:\n${mon.output()}`);
      stopBusyLoop(p.env, p.session);
      const stable = await waitForPaneStable(p.env, p.session, 15000);
      assert.ok(stable !== null, "pane must return to a stable idle state");
      assert.ok(await waitForOutput(mon, /SESSION-IDLE gate/, 10000),
        `IDLE must fire when the tick is stale (idle but no tick):\n${mon.output()}`);
    } finally {
      mon.child.kill("SIGKILL");
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
      assert.ok(await waitForOutput(mon, /SESSION-RESUMED gate/, 8000), `RESUMED must fire on busy (monitor is tracking):\n${mon.output()}`);
      stopBusyLoop(p.env, p.session);
      const stable = await waitForPaneStable(p.env, p.session, 15000);
      assert.ok(stable !== null, "pane must return to a stable idle state");
      await sleep(3500); // ≥3 rounds after stability — IDLE would have fired by now if not gated
      assert.ok(!/SESSION-IDLE/.test(mon.output()),
        `IDLE must be SILENT when the tick is fresh (healthy cycle end, noise gate):\n${mon.output()}`);
    } finally {
      mon.child.kill("SIGKILL");
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
    }
  } finally {
    p.cleanup();
  }
});

// ── AC12/AC13: both shipped tick docs state what to mount ──────────────────────────────────────────

test("AC12/AC13 — both shipped tick docs state what to mount; the outer doc names the two monitors and what each answers", () => {
  const outer = fs.readFileSync(path.resolve(__dirname, "..", "loop", "orchestrator-loop-tick.md"), "utf8");
  const inner = fs.readFileSync(path.resolve(__dirname, "..", "loop", "fast-mode-loop-tick.md"), "utf8");
  // AC12: the outer mounts TWO monitors (work-state + session-state), not merged.
  assert.ok(outer.includes("inner-state.sh") && outer.includes("session-liveness.sh"),
    "the outer tick doc must name both monitors (AC12: they are not merged — one failure mode must not mask another)");
  assert.ok(/它还在不在/.test(outer) && /它在做什么/.test(outer),
    "the outer tick doc must state what each monitor answers (AC12)");
  // AC13: the inner tick doc also states that the inner mounts session-liveness.sh.
  assert.ok(inner.includes("session-liveness.sh"),
    "the inner tick doc must state that the inner mounts session-liveness.sh (AC13)");
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
