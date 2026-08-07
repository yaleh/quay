// @test-group lowconc
// KNOWN-LOAD-SENSITIVE (see plugin/loop/fast-mode-loop-tick.md "已知负载敏感族") — this file uses
// real processes + tmux timing; it passes isolated under low load but may fail under concurrent-suite
// load (gap-load-sensitive-session-family-confounds-step-three, 2026-08-04). A full-suite failure here
// is NOT a real regression by default: re-run this file alone (low load) before concluding anything.
// GROUP NOTE (gap-suite-concurrency-8-green-serial-group-for-non-concurrent-tests): routed to the
// `serial` group (B-class real wall-clock wait) so it runs in the concurrency-1 serial phase — its
// sleep()/tmux waits get the real clock they need instead of a CPU-starved window.
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
//   B. SESSION-GONE/SESSION-BACK — pure process detection (session_pid: the pane's OWN foreground
//      process OR any child of it whose NAME is claude — comm / argv[0] basename, NOT a whole-cmdline
//      grep; gap-session-liveness-session-pid-blind-to-claude-as-pane-process). NOT redraw-dependent,
//      so it runs hermetically on an ISOLATED tmux socket with a real `sleep` whose argv[0] is
//      "claude-probe" as the claude-cmdline stand-in — no fake TUI involved, and it never touches the
//      real projects.
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
// probe is found via /proc/<pid>/comm + cmdline argv[0] exactly as session_pid() does it. Every
// mkdtemp tmpdir is removed in a finally (test-isolation R6). Every hermetic tmux server lives on
// its own socket (TMUX_TMPDIR) so the real quay-0/archguard-2/meta-cc-4 sessions are untouchable.
//
// Run:
//   scripts/test.sh plugin/test/session-liveness.test.mjs
//   node --test plugin/test/session-liveness.test.mjs
//   scripts/test.sh --group governance plugin/test/session-liveness.test.mjs

import { test, after } from "node:test";
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

// KNOWN-LOAD-SENSITIVE: under suite load a hermetic-probe test can be cancelled mid-run,
// skipping its finally → /tmp/session-liveness-* (and sl-*) dirs leak and trip the suite-tail
// tmux-leak-scan. Sweep leftovers after all tests (test-side cleanup safety net).
after(() => {
  for (const prefix of ["session-liveness-", "sl-global-", "sl-mount-", "sl-lmt-"]) {
    let entries = [];
    try { entries = fs.readdirSync(os.tmpdir()); } catch { continue; }
    for (const name of entries) {
      if (!name.startsWith(prefix)) continue;
      try { fs.rmSync(path.join(os.tmpdir(), name), { recursive: true, force: true }); } catch { /* best-effort */ }
    }
  }
});

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

// isClaudePid — replicate session_pid()'s claude test: a process IS claude by its NAME, not by a
// whole-cmdline grep (which would match a ".claude" path substring in a non-claude child's args —
// gap-session-liveness-session-pid-blind-to-claude-as-pane-process false-positive dimension).
// Two name sources, matching the script's _is_claude_pid():
//   1. /proc/<pid>/comm (process name) starts with "claude";
//   2. argv[0] (first NUL field of cmdline)'s basename contains "claude" (covers `exec -a
//      claude-probe sleep …` probes whose comm is "sleep"). Never greps the whole cmdline.
function isClaudePid(pid) {
  try {
    const comm = fs.readFileSync(`/proc/${pid}/comm`, "utf8").trim();
    if (comm.startsWith("claude")) return true;
    const argv0 = (fs.readFileSync(`/proc/${pid}/cmdline`, "utf8").split("\0")[0] || "").trim();
    const base = argv0.split("/").pop() || "";
    if (base.includes("claude")) return true;
  } catch {
    /* /proc unreadable — not claude */
  }
  return false;
}

// paneHasClaudeChild — replicate session_pid(): the pane's OWN foreground process (pane_pid, the
// claude-as-pane-process case) OR any direct child of it is a claude process. NOT `pgrep -f`
// (handoff rule 3: it would match this very command).
function paneHasClaudeChild(env, session) {
  const p = tmux(["list-panes", "-t", session, "-F", "#{pane_pid}"], env);
  if (p.status !== 0 || !p.stdout.trim()) return false;
  const panePid = p.stdout.trim();
  if (isClaudePid(panePid)) return true; // pane foreground process IS claude
  const kids = spawnSync("pgrep", ["-P", panePid], { encoding: "utf8" });
  for (const k of (kids.stdout ?? "").trim().split("\n").filter(Boolean)) {
    if (isClaudePid(k)) return true;
  }
  return false;
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

// makePlainPane(session) — a private tmux server + a bare bash pane with NO claude process at all.
// Used by the false-positive control (B3): a pane whose only child carries a ".claude" path in its
// cmdline must NOT be reported as a claude session.
function makePlainPane(session) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "session-liveness-"));
  const sockDir = path.join(tmp, "sock");
  fs.mkdirSync(sockDir, { recursive: true });
  const env = isolateTmuxEnv(sockDir);
  const newS = tmux(["new-session", "-d", "-s", session, "bash"], env);
  assert.equal(newS.status, 0, `tmux new-session failed: ${newS.stderr}`);
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

// makeClaudePaneProcess(session) — a pane whose FOREGROUND process (pane_pid) IS a claude process:
// `exec -a claude-probe sleep 10000` REPLACES the pane's shell (no `&`, no child) — the exact
// claude-as-pane-process shape of the 3-window topology (pane cmdline IS claude; its only children
// would be MCP servers). The old session_pid grepped CHILDREN for "claude" and missed this shape →
// alive=0 always (gap-session-liveness-session-pid-blind-to-claude-as-pane-process).
function makeClaudePaneProcess(session) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "session-liveness-"));
  const sockDir = path.join(tmp, "sock");
  fs.mkdirSync(sockDir, { recursive: true });
  const env = isolateTmuxEnv(sockDir);
  const newS = tmux(["new-session", "-d", "-s", session, "bash"], env);
  assert.equal(newS.status, 0, `tmux new-session failed: ${newS.stderr}`);
  tmux(["send-keys", "-t", session, "exec -a claude-probe sleep 10000"], env);
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

// makeTwoWindowSession(session) — a private tmux server with named windows "outer" and "inner"
// (the 3-window topology's role windows). Used by B4 to prove per-role target resolution: a
// window-suffixed SESSION_TMUX_SESSION (quay-0:inner) must target THAT window, not the default
// :outer window.
function makeTwoWindowSession(session) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "session-liveness-"));
  const sockDir = path.join(tmp, "sock");
  fs.mkdirSync(sockDir, { recursive: true });
  const env = isolateTmuxEnv(sockDir);
  const newS = tmux(["new-session", "-d", "-s", session, "-n", "outer", "bash"], env);
  assert.equal(newS.status, 0, `tmux new-session failed: ${newS.stderr}`);
  const newW = tmux(["new-window", "-t", session, "-n", "inner", "bash"], env);
  assert.equal(newW.status, 0, `tmux new-window failed: ${newW.stderr}`);
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

// paneSelfIsClaude — the pane's OWN foreground process (pane_pid) is a claude process.
function paneSelfIsClaude(env, session) {
  const p = tmux(["list-panes", "-t", session, "-F", "#{pane_pid}"], env);
  if (p.status !== 0 || !p.stdout.trim()) return false;
  return isClaudePid(p.stdout.trim());
}

async function waitForSelfClaude(env, session, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (paneSelfIsClaude(env, session)) return true;
    await sleep(100);
  }
  return paneSelfIsClaude(env, session);
}

// spawnMonitor — run the REAL session-liveness.sh with a fast test interval and overridable targets.
// 2026-08-06 (gap-session-liveness-remove-shared-events-and-lock): the shared events file + the
// mount lock are gone — each observer owns its own stdout stream, so there is NO global state to
// isolate and a spawned monitor can never collide with another mount. SL_ROUND_MARKER=1 (default in
// tests) prints one `# ROUND` per loop iteration as a deterministic round cadence (the old shared-file
// HEARTBEAT was the previous cadence carrier). cleanup() is a no-op keep-alive for the old call sites.
function spawnMonitor(env, targets, { script = SCRIPT, tickLogs, transcripts, stallMin = 1, overdueMin = 1, interval = 1, loopMin, roundMarker = true } = {}) {
  const monEnv = {
    ...env,
    SESSION_TARGETS: targets,
    INTERVAL: String(interval),
    STALL_MIN: String(stallMin),
    OVERDUE_MIN: String(overdueMin),
    // The busy judgment consumes classifyPaneState (ADR-016 Amendment / ruling D). Pin the
    // classifier path so a COPY of the script (the AC6 mutation test) still resolves the real
    // classifier — BASH_SOURCE-relative lookup would point at the temp copy's directory.
    SL_CLASSIFY: path.resolve(__dirname, "..", "scripts", "pane-state-classify.ts"),
  };
  if (roundMarker) monEnv.SL_ROUND_MARKER = "1";
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
    cleanup() { /* per-observer streams are process-local — nothing global to remove */ },
  };
}

// countRounds / waitForRounds — the stdout round cadence (`# ROUND` under SL_ROUND_MARKER). The old
// waitForHeartbeats read the shared events file; with the file gone, tests count rounds from stdout.
function countRounds(mon) {
  return (mon.output().match(/# ROUND/g) || []).length;
}
async function waitForRounds(mon, n, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (countRounds(mon) >= n) return true;
    await sleep(100);
  }
  return countRounds(mon) >= n;
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

// makeFreshGitRepo — a temp git repo whose HEAD committer date is NOW (the incident-handling scenario:
// the outer produced commits during the red window). The multi-source heartbeat must count a fresh
// HEAD commit as liveness even when the tick-log is stale.
function makeFreshGitRepo(dir) {
  const git = (args, cwd) => spawnSync("git", args, { encoding: "utf8", cwd });
  const init = git(["-c", "user.name=t", "-c", "user.email=t@t", "init", "-q", "-b", "master", dir]);
  assert.equal(init.status, 0, `git init failed: ${init.stderr}`);
  fs.writeFileSync(path.join(dir, "a.txt"), "x\n");
  const add = git(["-c", "user.name=t", "-c", "user.email=t@t", "add", "."], dir);
  assert.equal(add.status, 0, `git add failed: ${add.stderr}`);
  const commit = git(["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "-m", "fresh"], dir);
  assert.equal(commit.status, 0, `git commit failed: ${commit.stderr}`);
  const ct = git(["log", "-1", "--format=%ct"], dir);
  const now = Math.floor(Date.now() / 1000);
  assert.ok(ct.status === 0 && Number(ct.stdout.trim()) > now - 600,
    `commit must be fresh (within 10min), got ${ct.stdout}`);
}

// initGitRepo — a git repo at `dir` with one commit. `authorDate` (ISO-8601) controls the
// committer/author date; omit for a fresh (now) commit. The multi-source outer-heartbeat criterion
// (gap-outer-heartbeat-source-inverts-under-incident-handling) reads HEAD commit time as one source.
function initGitRepo(dir, { authorDate } = {}) {
  const env = { ...process.env };
  if (authorDate) { env.GIT_AUTHOR_DATE = authorDate; env.GIT_COMMITTER_DATE = authorDate; }
  const git = (args, cwd) => spawnSync("git", args, { encoding: "utf8", cwd, env });
  const init = git(["-c", "user.name=t", "-c", "user.email=t@t", "init", "-q", "-b", "master", dir]);
  assert.equal(init.status, 0, `git init failed: ${init.stderr}`);
  fs.writeFileSync(path.join(dir, "a.txt"), "x\n");
  const add = git(["-c", "user.name=t", "-c", "user.email=t@t", "add", "."], dir);
  assert.equal(add.status, 0, `git add failed: ${add.stderr}`);
  const commit = git(["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "-m", "fresh"], dir);
  assert.equal(commit.status, 0, `git commit failed: ${commit.stderr}`);
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

// ── Test B2: claude-as-pane-process (the pane foreground process IS claude) ──────────────────────────
// gap-session-liveness-session-pid-blind-to-claude-as-pane-process AC1/AC3: in the 3-window topology
// pane_pid IS the claude process. Old session_pid only grepped pane_pid's CHILDREN for "claude" →
// alive=0 always (SESSION-GONE never fires, the resident monitor is permanently silent).

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

// ── Test B3: false-positive control — a ".claude" cmdline substring in a NON-claude child ────────────
// gap-session-liveness-session-pid-blind-to-claude-as-pane-process false-positive dimension: the old
// whole-cmdline grep matched ".claude" in e.g. the full-suite-runner's bash wrapper cmdline
// (/home/yale/.claude/shell-snapshots/...) and falsely reported SESSION-BACK. The fix matches by
// process NAME (comm / argv[0] basename), so a bash wrapper is NOT claude.

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
    const deadline = Date.now() + 5000;
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

// ── Test B4: per-role target resolution (AC2/AC3/AC4) ──────────────────────────────────────────────
// A window-suffixed SESSION_TMUX_SESSION (quay-0:inner) must target that NAMED window, not the
// default :outer window. A bare session (quay-0) and a numeric pane suffix (quay-init's :0.0)
// both resolve to <base>:outer (the zero-config default = this project's own outer).

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

// ── 多源外层心跳（gap-outer-heartbeat-source-inverts-under-incident-handling，2026-08-06）──────
// SESSION-OVERDUE 的默认外层心跳源从【tick-log 单源】改为【多源 max mtime】：
//   max(HEAD 提交时间, queue-state mtime, tick-log mtime, docs/analysis/*.md, .quay/verification-round.jsonl)
// 红窗处置写 queue-state+提交、不写 tick-log ⇒ 心跳仍新鲜（反向失效消除，AC2）；全源旧 ⇒ 仍报 OVERDUE
// （真阳性保留，AC3）；OVERDUE 消息自带多源说明（信号可区分，AC4）。

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

test("Contract invoke — session-liveness.sh --selfcheck 验证多源心跳判据（红窗处置保持新鲜 / 零产出报 OVERDUE），退出 0", () => {
  const r = spawnSync("bash", [SCRIPT, "--selfcheck"], { encoding: "utf8" });
  assert.equal(r.status, 0, `--selfcheck must exit 0:\n${r.stdout}\n${r.stderr}`);
  assert.match(r.stdout, /selfcheck: PASS/);
  assert.match(r.stdout, /red-window-heartbeat_min=\d+\s+zero-output-heartbeat_min=\d+/);
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

// busy controls for a hermetic probe — SHAPE-based (ADR-016 Amendment / ruling D): the busy/idle
// judgment is classifyPaneState's bottom-region shape, so the probe is driven to the busy shape by
// TYPING "esc to interrupt" into its input line (no Enter — it stays in the status area, which is
// exactly the shape the classifier's BUSY_RE reads). The old content-hash busy loop (dates scrolling
// the pane) can no longer flip the verdict: with the whole-pane hash gone, a shape-stable pane is
// idle by definition. The claude child is job %1; nothing here touches it.
function makePaneBusy(env, session) {
  tmux(["send-keys", "-t", session, "C-u"], env);   // clear any prior typed input
  tmux(["send-keys", "-t", session, "esc to interrupt"], env);  // typed, no Enter → status-area busy
}
function makePaneIdle(env, session) {
  tmux(["send-keys", "-t", session, "C-u"], env);   // clear the input line → shape back to idle
}

// startTouchLoop — simulate a live session writing to its transcript: touch <file> every 0.5s.
function startTouchLoop(file) {
  return spawn("bash", ["-c", 'while true; do touch "$1"; sleep 0.5; done', "touch-loop", file],
    { stdio: "ignore" });
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
      await sleep(2500); // idle baseline: PREV_IDLE=1
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

// ── AC21（gap-a-log-already-filtered-by-one-consumers-threshold-cannot-serve-a-second）──────────────
// 根因已随 2026-08-06 人裁定移除（gap-session-liveness-remove-shared-events-and-lock）：共享 events.jsonl
// 与互斥锁被删，观察是树（manager→N 个 outer、outer_i→inner_i），每条边是独立的 (观察者,目标) 对，
// 每个观察者的阈值（LOOP_MIN/STALL_MIN/OVERDUE_MIN）只作用于它自己的 stdout、只服务它自己的消费者。
// 「已被一个消费者的阈值筛过的日志服务不了第二个消费者」的前提是「一条流被多个消费者读」——现在每条
// 流只有一个消费者，缺陷形态不存在。AC21 的「共享文件记全量供订阅方自判」补丁可退役（AC5 交叉标注）。
// 每个观察者阈值独立、谁先启动无关的正控制由上面的 AC4 并行观测测试承担（LOOP_MIN=0 报 / LOOP_MIN=999
// 抑，同一目标、同轮，各自流互不影响）。

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
// 并行观测（AC2/AC4，gap-session-liveness-remove-shared-events-and-lock，2026-08-06 人裁定）
// ═════════════════════════════════════════════════════════════════════════════
//
// 人裁定：观测是树（manager→N 个 outer、outer_i→inner_i），每条边是独立的 (观察者,目标) 对，
// 只读、无交集。共享 events.jsonl（把 N 条独立流合并成一条再让每个消费者过滤回自己要的）与互斥锁
// （保护共享文件的唯一存在理由）都被彻底移除。AC20 的单飞挂载判据（第一个持有、第二个空操作、
// 接管）随之作废——旧 M1-M7 测试删于 2026-08-06。替代测试验证新语义：
//   AC2 — 多观察者并行挂载同一目标（无锁）：两个观察者都跑、都独立产生事件（无空操作、无冲突）。
//   AC4 — 观察者互不知情：同一目标被两个 LOOP_MIN 不同的观察者盯，各自阈值只作用于各自 stdout，
//        谁先启动无关（先起者不决定后起者能看到什么——AC21 根因消失）。

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

// waitForHeartbeats/countHeartbeats REMOVED 2026-08-06: they read the shared events.jsonl, which no
// longer exists. Round cadence is now counted from stdout (`# ROUND` under SL_ROUND_MARKER) via the
// waitForRounds/countRounds helpers defined next to spawnMonitor at the top of this file.

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

// ═════════════════════════════════════════════════════════════════════════════
// 多源心跳（gap-outer-heartbeat-source-inverts-under-incident-handling，2026-08-05）
// ═════════════════════════════════════════════════════════════════════════════
// 缺陷：SESSION-OVERDUE 的默认外层心跳源是 tick-log 单源 mtime。红窗处置期间外层写 queue-state +
// 提交 + 分诊记录，但不写 tick-log ⇒ 越认真处理事故，心跳看起来越旧（实测 71min 陈旧而 5 个提交
// 已产出；同一信号一真阳一假阳、不可分）。
// 修法：默认外层心跳 = 多源 max mtime = max(HEAD commit 时间, queue-state mtime, tick-log mtime,
// docs/analysis 最新记录 mtime, verification-round.jsonl mtime)。任一在阈值内 ⇒ alive。
// 显式覆盖（SESSION_HEARTBEATS / SESSION_TRANSCRIPTS）保持单源语义——调用方已选定特定源。
//   AC2  反向失效消除（fixture）：红窗处置（写 queue-state + 提交、tick-log 不动）⇒ 不报 OVERDUE。
//   AC3  真阳性保留（fixture）：30 分钟零产出（全部源陈旧）⇒ OVERDUE 仍报。
//   AC4  信号可区分：同一目标先有产出（不报）→ 全部源陈旧（报）——从信号本身可判，不需查提交历史。
// 注意：这些 fixture 用默认心跳（不传 SESSION_HEARTBEATS / SESSION_TRANSCRIPTS），并设
// SESSION_ROOT=<fixture root> 使默认心跳源落在 fixture 下而不是真实仓库的 tick-log。

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

// Contract invoke：`bash plugin/scripts/session-liveness.sh --selfcheck`。断言多源逻辑本身——
// 红窗处置 ⇒ 心跳新鲜（AC2，red-window-heartbeat_min < OVERDUE_MIN）、零产出 ⇒ 心跳陈旧
// （AC3，zero-output-heartbeat_min ≥ OVERDUE_MIN）、selfcheck: PASS（band）。
// NOTE 2026-08-06: this assertion was realigned to the CURRENT selfcheck output format
// (red-window-heartbeat_min / zero-output-heartbeat_min) — the old format
// (heartbeat_source_count / "selfcheck: ALL PASS") was replaced when the multi-source heartbeat
// landed and this test had gone stale.
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

// ═════════════════════════════════════════════════════════════════════════════
// 姊妹任务（gap-session-liveness-hashes-the-token-counter-as-if-it-were-work）：
// 忙闲判据从「mask 后整屏 md5」改为 classifyPaneState 的底部区域【形状分类】
//（ADR-016 Amendment 2026-08-04 / 裁定 D）。AC1/AC4/AC5/AC7/AC9 的正控制。
// ═════════════════════════════════════════════════════════════════════════════

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
    const mon = spawnMonitor(p.env, `ac4 ${p.tmp} ${p.session}`, { tickLogs: `ac4 /nonexistent` });
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
    const mon = spawnMonitor(p.env, `ac9 ${p.tmp} ${p.session}`, { tickLogs: `ac9 /nonexistent` });
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

// ═════════════════════════════════════════════════════════════════════════════
// 阶段四（gap-session-liveness-cannot-see-context-saturation-alive-but-cannot-take-input，2026-08-07）：
// 上下文饱和度——「活着但收不进新指令」的判据。AC1-AC6。
// 结构化源 = transcript 的 usage.cache_read_input_tokens（缓存前缀=上下文用量），非屏幕百分比（AC3）。
// 复合判据 = 高上下文（≥SATURATION_TOKENS）+ 最后一条未应答 user 输入（饱和≠故障，auto-compact 正常，
// 只有「饱和且随后指令未被响应」才报，AC4）。事件 SESSION-SATURATED 区别于普通「忙」（AC2 承重条）。
// ═════════════════════════════════════════════════════════════════════════════

// assistantUsageRecord —— assistant 消息带 usage.cache_read_input_tokens（真实 Claude Code JSONL 顶层的
// usage 结构字段，阶段四实测：内层 31.9 万、外层 62.5 万）。
function assistantUsageRecord(ts, cacheRead) {
  return JSON.stringify({ type: "assistant",
    message: { role: "assistant", content: [{ type: "text", text: "ok" }] },
    usage: { input_tokens: 89, cache_creation_input_tokens: 0, cache_read_input_tokens: cacheRead, output_tokens: 111 },
    timestamp: ts });
}

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
