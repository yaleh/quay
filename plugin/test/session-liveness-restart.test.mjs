// @test-group engine
// @load-sensitive wall-clock
// session-liveness-restart.test.mjs — observer-blind-fix: a session RESTART in the same tmux window
// must make the observer pick up the NEW transcript on its next poll (self-heal, no re-mount), while
// ambiguous dynamic resolution falls back to the configured SESSION_TRANSCRIPTS (config contract kept).
//
// DEFECT (source-level proven): the observer binds each target's transcript path at STARTUP via
// SESSION_TRANSCRIPTS (the "会话 id 是【配置，不去推断】" contract). When a session RESTARTS (new session
// id = new transcript path, e.g. ~/.claude/projects/<slug>/<new-id>.jsonl), the observer keeps
// watching the OLD transcript path: perpetual false SESSION-OVERDUE (the old transcript never moves
// again) and blindness to a real death (already crying wolf). The tmux WINDOW name does NOT change
// across a restart, so the window name is the stable key; the session id / transcript path is the
// changing value.
//
// FIX (implemented in session-liveness.sh, exercised here):
//   * Each poll the transcript is resolved FRESH from the target window's CURRENT process:
//     pane_pid → the claude process → (PRIMARY) $HOME/.claude/sessions/<pid>.json (CC-maintained
//     pid→sessionId, authoritative and correct right after a restart) OR (SECONDARY)
//     CLAUDE_CODE_SESSION_ID in /proc/<pid>/environ (plus a CLAUDE_PROJECT_DIR cross-check)
//     → $HOME/.claude/projects/<slug>/<id>.jsonl.
//   * Only a CONFIDENT dynamic resolution (sessions/<pid>.json sessionId, or env session id +
//     project match) overrides the configured SESSION_TRANSCRIPTS; low/none (no process, no
//     sessions file / malformed, no env id, project mismatch, multiple candidate transcripts,
//     heuristic) falls back to the config — preserving the "don't infer" contract for the
//     known-unreliable /clear and --resume cases (source comments at :166-167 document why
//     pid→transcript can be unreliable there).
//   * TEST-CONDITION FIX (2026-08-12): the sessions/<pid>.json path exists because in PRODUCTION the
//     claude process does NOT export CLAUDE_CODE_SESSION_ID / CLAUDE_PROJECT_DIR into /proc/<pid>/environ
//     — the env path returns none and the observer falls back to the stale pre-restart transcript
//     (perpetual false SESSION-OVERDUE). The tests MUST assert resolution works with NO CLAUDE_* env
//     vars (R5/R6 use makeNoEnvProbe + assertNoClaudeEnvVars), not just with them present.
//
// SPLIT CONCURRENCY SAFETY: this file runs as its OWN node process at cc=3. It owns the /tmp prefix
// "session-liveness-restart-" — the hermetic probe constructors create dirs under it (via
// setProbeTmpPrefix) and the after() sweeps ONLY it, so it can never delete a sibling file's probe.
//
// KNOWN-LOAD-SENSITIVE (see plugin/loop/fast-mode-loop-tick.md "已知负载敏感族") — real processes +
// tmux timing; passes isolated under low load. Routed to the `lowconc` group.
//
// Run: node --test plugin/test/session-liveness-restart.test.mjs

import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  SCRIPT, tmuxAvailable,
  setProbeTmpPrefix, sessionLivenessAfter, tmux, isolateTmuxEnv, isClaudePid,
  waitForAlive, spawnMonitor, waitForOutput, waitForRounds, countRounds,
  __registerProbeTmp, teardownProbe,
} from "./session-liveness-helpers.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// OWN the /tmp probe prefix for this split file (see SPLIT CONCURRENCY SAFETY above).
setProbeTmpPrefix("session-liveness-restart-");

after(() => {
  sessionLivenessAfter("session-liveness-restart-");
});

const slugOf = (dir) => dir.replace(/[\\/]+/g, "-");
const transcriptFor = (home, root, sid) => path.join(home, ".claude", "projects", slugOf(root), `${sid}.jsonl`);

// makeEnvProbe(session, claudeProjectDir, sid) — a private tmux server + a pane whose shell owns a
// claude-cmdline child carrying explicit CLAUDE_CODE_SESSION_ID / CLAUDE_PROJECT_DIR (the env a real
// claude session has). The child is `exec -a claude-probe sleep 10000 &`. Pass sid=null to make a
// probe with those vars EMPTIED (deterministic "no env session id" — independent of the runner's env).
function makeEnvProbe(session, claudeProjectDir, sid) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "session-liveness-restart-"));
  __registerProbeTmp(tmp);
  const sockDir = path.join(tmp, "sock");
  fs.mkdirSync(sockDir, { recursive: true });
  const env = isolateTmuxEnv(sockDir);
  const newS = tmux(["new-session", "-d", "-x", "200", "-y", "50", "-s", session, "bash"], env);
  assert.equal(newS.status, 0, `tmux new-session failed: ${newS.stderr}`);
  const envPrefix = sid === null
    ? `CLAUDE_CODE_SESSION_ID= CLAUDE_PROJECT_DIR=`
    : `CLAUDE_CODE_SESSION_ID=${sid} CLAUDE_PROJECT_DIR=${claudeProjectDir}`;
  tmux(["send-keys", "-t", session, `${envPrefix} exec -a claude-probe sleep 10000 &`], env);
  tmux(["send-keys", "-t", session, "Enter"], env);
  return {
    tmp, env, session,
    cleanup() {
      // 判据1/AC1: kill the SERVER (kill-server, private socket) FIRST — kill-session alone races
      // server teardown under load and can leave a live server that is already-unregistered ⇒
      // unreachable by after()'s reapLiveOwners (leak-with-no-exit, 2026-08-14 full-suite red).
      // teardownProbe RETRIES kill-server until the owner dies BEFORE unregistering, so the probe
      // stays registered until the server is dead and after() can retry if interrupted.
      teardownProbe(tmp);
      // teardownProbe already rmSync's `tmp` inside the shared helper; the explicit best-effort
      // rmSync below keeps the mkdtemp STATICALLY paired with a cleanup in THIS file — tmp-leak-
      // pairing-check / test-isolation R6 are file-scoped and cannot follow teardownProbe into
      // session-liveness-helpers.mjs. Idempotent (the dir is already gone after teardownProbe).
      try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* best-effort */ }
    },
  };
}

// makeNoEnvProbe(session) — a private tmux server + a pane whose shell owns a claude-cmdline child
// whose environ carries NO CLAUDE_CODE_SESSION_ID / CLAUDE_PROJECT_DIR AT ALL (the PRODUCTION
// condition — 实测 2026-08-12: claude does not export these into /proc/<pid>/environ). `unset` runs
// in the pane shell before the backgrounded exec, so the sleep's environ is stripped of both vars
// regardless of what the runner's own env exports. Used by the sessions/<pid>.json resolution tests.
function makeNoEnvProbe(session) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "session-liveness-restart-"));
  __registerProbeTmp(tmp);
  const sockDir = path.join(tmp, "sock");
  fs.mkdirSync(sockDir, { recursive: true });
  const env = isolateTmuxEnv(sockDir);
  const newS = tmux(["new-session", "-d", "-x", "200", "-y", "50", "-s", session, "bash"], env);
  assert.equal(newS.status, 0, `tmux new-session failed: ${newS.stderr}`);
  tmux(["send-keys", "-t", session, "unset CLAUDE_CODE_SESSION_ID CLAUDE_PROJECT_DIR; exec -a claude-probe sleep 10000 &"], env);
  tmux(["send-keys", "-t", session, "Enter"], env);
  return {
    tmp, env, session,
    cleanup() {
      // 判据1/AC1: kill the SERVER (kill-server, private socket) FIRST — kill-session alone races
      // server teardown under load and can leave a live server that is already-unregistered ⇒
      // unreachable by after()'s reapLiveOwners (leak-with-no-exit, 2026-08-14 full-suite red).
      // teardownProbe RETRIES kill-server until the owner dies BEFORE unregistering, so the probe
      // stays registered until the server is dead and after() can retry if interrupted.
      teardownProbe(tmp);
      // teardownProbe already rmSync's `tmp` inside the shared helper; the explicit best-effort
      // rmSync below keeps the mkdtemp STATICALLY paired with a cleanup in THIS file — tmp-leak-
      // pairing-check / test-isolation R6 are file-scoped and cannot follow teardownProbe into
      // session-liveness-helpers.mjs. Idempotent (the dir is already gone after teardownProbe).
      try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* best-effort */ }
    },
  };
}

// claudeChildPid(env, session) — the pane's direct claude child pid (the claude-probe stand-in).
function claudeChildPid(env, session) {
  const panePid = tmux(["list-panes", "-t", session, "-F", "#{pane_pid}"], env).stdout.trim();
  const kids = spawnSync("pgrep", ["-P", panePid], { encoding: "utf8" });
  for (const k of (kids.stdout ?? "").trim().split("\n").filter(Boolean)) {
    if (isClaudePid(k)) return k;
  }
  return "";
}

// writeSessionFile(home, pid, { sessionId, cwd }) — write a CC-maintained ~/.claude/sessions/<pid>.json
// mapping (the authoritative pid→sessionId source the fix reads; same shape as the real files on disk).
function writeSessionFile(home, pid, { sessionId, cwd }) {
  const dir = path.join(home, ".claude", "sessions");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${pid}.json`),
    `${JSON.stringify({ pid: Number(pid), sessionId, cwd })}\n`);
}

// assertNoClaudeEnvVars(pid) — the TEST-CONDITION FIX: assert the fixture actually reproduces the
// production condition (NO CLAUDE_CODE_SESSION_ID / CLAUDE_PROJECT_DIR in /proc/<pid>/environ). A
// fix that only works when those env vars are exported must FAIL this assertion, not pass.
function assertNoClaudeEnvVars(pid) {
  const environ = fs.readFileSync(`/proc/${pid}/environ`, "utf8");
  const lines = environ.split("\0");
  const claudeVars = lines.filter((kv) => kv.startsWith("CLAUDE_"));
  assert.ok(!lines.some((kv) => kv.startsWith("CLAUDE_CODE_SESSION_ID=")),
    `probe pid ${pid} must NOT carry CLAUDE_CODE_SESSION_ID (production condition). Found in: ${claudeVars.join(" | ")}`);
  assert.ok(!lines.some((kv) => kv.startsWith("CLAUDE_PROJECT_DIR=")),
    `probe pid ${pid} must NOT carry CLAUDE_PROJECT_DIR (production condition). Found in: ${claudeVars.join(" | ")}`);
}

test("R1 — a session restart in the same window makes the observer resolve the NEW transcript on the next poll (self-heal, no re-mount)", { skip: tmuxAvailable ? false : "tmux not installed" }, async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "session-liveness-restart-"));
  const oldSid = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
  const newSid = "11111111-aaaa-4bbb-8ccc-000000000001";
  const p = makeEnvProbe("restart-sh", root, oldSid);
  const home = path.join(root, "home");
  const oldTranscript = transcriptFor(home, root, oldSid);
  const newTranscript = transcriptFor(home, root, newSid);
  try {
    fs.mkdirSync(path.dirname(oldTranscript), { recursive: true });
    fs.writeFileSync(oldTranscript, "{}\n"); // the OLD session's transcript is FRESH at mount
    assert.ok(await waitForAlive(p.env, p.session), "probe must be alive first");
    const mon = spawnMonitor({ ...p.env, HOME: home, SESSION_ROOT: root },
      `inner ${root} ${p.session}`,
      { transcripts: `inner ${oldSid}`, overdueMin: 1, interval: 1 });
    try {
      // baseline: fresh old transcript + old session → no OVERDUE (config wiring works)
      const before = countRounds(mon);
      assert.ok(await waitForRounds(mon, before + 2, 20000), `baseline rounds must pass:\n${mon.output()}`);
      assert.ok(!/SESSION-OVERDUE/.test(mon.output()),
        `baseline (fresh old transcript) must have no OVERDUE:\n${mon.output()}`);

      // RESTART in the same window: kill the old claude, spawn a NEW one with a NEW session id.
      // The window name (tmux session) is unchanged — the pane is respawned in place.
      const newCmd = `CLAUDE_CODE_SESSION_ID=${newSid} CLAUDE_PROJECT_DIR=${root} exec -a claude-probe sleep 10000 &`;
      tmux(["send-keys", "-t", p.session, `kill %1; ${newCmd}`], p.env);
      tmux(["send-keys", "-t", p.session, "Enter"], p.env);
      fs.writeFileSync(newTranscript, "{}\n"); // the NEW session's transcript is FRESH
      assert.ok(await waitForAlive(p.env, p.session), "the new claude child must come up");
      // the dead session's transcript stops moving — if the observer is still bound to it, OVERDUE fires
      spawnSync("touch", ["-d", "3 hours ago", oldTranscript], { encoding: "utf8" });

      // let the observer poll a few rounds: it MUST pick up the new fresh transcript (self-heal).
      const before2 = countRounds(mon);
      assert.ok(await waitForRounds(mon, before2 + 3, 20000), `post-restart rounds must pass:\n${mon.output()}`);
      assert.ok(!/SESSION-OVERDUE/.test(mon.output()),
        `after a restart the observer must self-heal to the NEW fresh transcript (no OVERDUE). If it were still watching the OLD frozen transcript, OVERDUE would fire:\n${mon.output()}`);

      // positive control: the observer IS watching the NEW transcript — freeze it → OVERDUE fires.
      spawnSync("touch", ["-d", "3 hours ago", newTranscript], { encoding: "utf8" });
      assert.ok(await waitForOutput(mon, /SESSION-OVERDUE inner/, 8000),
        `positive control: freezing the NEW transcript must fire OVERDUE (proves the observer switched to it):\n${mon.output()}`);
    } finally {
      mon.child.kill("SIGKILL");
      mon.cleanup();
    }
  } finally {
    p.cleanup();
    try { fs.rmSync(root, { recursive: true, force: true }); } catch { /* best-effort */ }
  }
});

test("R2 — ambiguous dynamic resolution (no env session id + multiple fresh candidates) falls back to the configured SESSION_TRANSCRIPTS (config contract preserved)", { skip: tmuxAvailable ? false : "tmux not installed" }, async () => {
  const cfgSid = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
  const p = makeNoEnvProbe("restart-ambig"); // NO CLAUDE_* env vars AND no sessions/<pid>.json (deterministic)
  const home = path.join(p.tmp, "home");
  const cfgTranscript = transcriptFor(home, p.tmp, cfgSid);
  // two OTHER fresh transcripts in the same project dir → the newest-.jsonl heuristic is AMBIGUOUS
  const other1 = transcriptFor(home, p.tmp, "11111111-aaaa-4bbb-8ccc-000000000001");
  const other2 = transcriptFor(home, p.tmp, "22222222-aaaa-4bbb-8ccc-000000000002");
  try {
    fs.mkdirSync(path.dirname(cfgTranscript), { recursive: true });
    fs.writeFileSync(cfgTranscript, "{}\n");
    spawnSync("touch", ["-d", "3 hours ago", cfgTranscript], { encoding: "utf8" }); // configured transcript STALE
    fs.writeFileSync(other1, "{}\n");
    fs.writeFileSync(other2, "{}\n"); // fresh candidates (mtime now)
    assert.ok(await waitForAlive(p.env, p.session), "probe must be alive first");
    const mon = spawnMonitor({ ...p.env, HOME: home, SESSION_ROOT: p.tmp },
      `inner ${p.tmp} ${p.session}`,
      { transcripts: `inner ${cfgSid}`, overdueMin: 1, interval: 1 });
    try {
      // dynamic is ambiguous (no env session id; TWO fresh candidates) → config wins → the observer
      // watches the STALE configured transcript → OVERDUE fires. If dynamic had wrongly picked a
      // fresh candidate, OVERDUE would be silent (the config contract would be broken).
      assert.ok(await waitForOutput(mon, /SESSION-OVERDUE inner/, 8000),
        `ambiguous dynamic resolution must fall back to the configured transcript (stale → OVERDUE). If dynamic had wrongly picked a fresh candidate, no OVERDUE:\n${mon.output()}`);
    } finally {
      mon.child.kill("SIGKILL");
      mon.cleanup();
    }
  } finally {
    p.cleanup();
  }
});

test("R3 — seam: a confident dynamic resolution (env session id + project match) overrides the configured SESSION_TRANSCRIPTS (restart self-heal path)", { skip: tmuxAvailable ? false : "tmux not installed" }, async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "session-liveness-restart-"));
  const home = path.join(root, "home");
  const sid = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
  const otherSid = "11111111-aaaa-4bbb-8ccc-000000000001";
  const p = makeEnvProbe("restart-seam", root, sid);
  try {
    assert.ok(await waitForAlive(p.env, p.session), "probe must be alive first");
    fs.mkdirSync(path.dirname(transcriptFor(home, root, sid)), { recursive: true });
    fs.writeFileSync(transcriptFor(home, root, sid), "{}\n"); // the process's OWN (new) transcript
    const pid = claudeChildPid(p.env, p.session);
    assert.ok(pid, "the probe must have a claude child");
    const r = spawnSync("bash", [SCRIPT, "--resolve-transcript", "inner", root, pid], {
      encoding: "utf8",
      env: {
        ...p.env, HOME: home, SESSION_ROOT: root,
        SESSION_TARGETS: `inner ${root} ${p.session}`,
        SESSION_TRANSCRIPTS: `inner ${otherSid}`, // config points at a DIFFERENT (old) session id
      },
    });
    assert.equal(r.status, 0, `--resolve-transcript must exit 0:\n${r.stderr}`);
    assert.equal(r.stdout.trim(), transcriptFor(home, root, sid),
      `confident dynamic must win over the config (restart self-heal). Got: ${r.stdout.trim()}`);
    // the raw dynamic resolution reports confident + the candidate path
    const d = spawnSync("bash", [SCRIPT, "--dynamic-transcript", "inner", root, pid], {
      encoding: "utf8",
      env: { ...p.env, HOME: home, SESSION_ROOT: root, SESSION_TARGETS: `inner ${root} ${p.session}` },
    });
    assert.equal(d.status, 0, `--dynamic-transcript must exit 0:\n${d.stderr}`);
    assert.match(d.stdout, /^confident\n/,
      `dynamic resolution must be confident for an env-carrying claude process:\n${d.stdout}`);
  } finally {
    p.cleanup();
    try { fs.rmSync(root, { recursive: true, force: true }); } catch { /* best-effort */ }
  }
});

test("R4 — seam: a claude process for a DIFFERENT project (CLAUDE_PROJECT_DIR mismatch) is NOT trusted — the configured SESSION_TRANSCRIPTS wins", { skip: tmuxAvailable ? false : "tmux not installed" }, async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "session-liveness-restart-"));
  const otherRoot = fs.mkdtempSync(path.join(os.tmpdir(), "session-liveness-restart-other-"));
  const home = path.join(root, "home");
  const cfgSid = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
  const p = makeEnvProbe("restart-xproj", otherRoot, cfgSid);
  try {
    assert.ok(await waitForAlive(p.env, p.session), "probe must be alive first");
    fs.mkdirSync(path.dirname(transcriptFor(home, root, cfgSid)), { recursive: true });
    fs.writeFileSync(transcriptFor(home, root, cfgSid), "{}\n");
    const pid = claudeChildPid(p.env, p.session);
    assert.ok(pid, "the probe must have a claude child");
    const r = spawnSync("bash", [SCRIPT, "--resolve-transcript", "inner", root, pid], {
      encoding: "utf8",
      env: {
        ...p.env, HOME: home, SESSION_ROOT: root,
        SESSION_TARGETS: `inner ${root} ${p.session}`,
        SESSION_TRANSCRIPTS: `inner ${cfgSid}`,
      },
    });
    assert.equal(r.status, 0, `--resolve-transcript must exit 0:\n${r.stderr}`);
    assert.equal(r.stdout.trim(), transcriptFor(home, root, cfgSid),
      `a project-mismatched process must NOT override the config (else a wrong-project transcript path could suppress OVERDUE = a new blindness). Got: ${r.stdout.trim()}`);
    const d = spawnSync("bash", [SCRIPT, "--dynamic-transcript", "inner", root, pid], {
      encoding: "utf8",
      env: { ...p.env, HOME: home, SESSION_ROOT: root, SESSION_TARGETS: `inner ${root} ${p.session}` },
    });
    assert.equal(d.status, 0, `--dynamic-transcript must exit 0:\n${d.stderr}`);
    assert.match(d.stdout, /^none\n/,
      `a project-mismatched claude process must resolve to none (not confident):\n${d.stdout}`);
  } finally {
    p.cleanup();
    try { fs.rmSync(root, { recursive: true, force: true }); } catch { /* best-effort */ }
    try { fs.rmSync(otherRoot, { recursive: true, force: true }); } catch { /* best-effort */ }
  }
});

test("R5 — seam: a claude process with NO CLAUDE_* env vars but a ~/.claude/sessions/<pid>.json mapping resolves confident to its transcript (the production self-heal path)", { skip: tmuxAvailable ? false : "tmux not installed" }, async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "session-liveness-restart-"));
  const home = path.join(root, "home");
  const sid = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
  const otherSid = "11111111-aaaa-4bbb-8ccc-000000000001";
  const p = makeNoEnvProbe("restart-sessions-seam");
  try {
    assert.ok(await waitForAlive(p.env, p.session), "probe must be alive first");
    const pid = claudeChildPid(p.env, p.session);
    assert.ok(pid, "the probe must have a claude child");
    // THE TEST-CONDITION FIX: the fixture must reproduce the production condition — the claude
    // process's environ carries NO CLAUDE_CODE_SESSION_ID / CLAUDE_PROJECT_DIR. A fix that only
    // works with those env vars exported FAILS here.
    assertNoClaudeEnvVars(pid);

    // the CC-maintained authoritative mapping: pid → sessionId (correct right after a restart)
    writeSessionFile(home, pid, { sessionId: sid, cwd: root });
    fs.mkdirSync(path.dirname(transcriptFor(home, root, sid)), { recursive: true });
    fs.writeFileSync(transcriptFor(home, root, sid), "{}\n"); // the process's OWN (new) transcript

    const r = spawnSync("bash", [SCRIPT, "--resolve-transcript", "inner", root, pid], {
      encoding: "utf8",
      env: {
        ...p.env, HOME: home, SESSION_ROOT: root,
        SESSION_TARGETS: `inner ${root} ${p.session}`,
        SESSION_TRANSCRIPTS: `inner ${otherSid}`, // config points at a DIFFERENT (old) session id
      },
    });
    assert.equal(r.status, 0, `--resolve-transcript must exit 0:\n${r.stderr}`);
    assert.equal(r.stdout.trim(), transcriptFor(home, root, sid),
      `the sessions/<pid>.json path must resolve the NEW session's transcript WITHOUT env vars (restart self-heal). Got: ${r.stdout.trim()}`);

    const d = spawnSync("bash", [SCRIPT, "--dynamic-transcript", "inner", root, pid], {
      encoding: "utf8",
      env: { ...p.env, HOME: home, SESSION_ROOT: root, SESSION_TARGETS: `inner ${root} ${p.session}` },
    });
    assert.equal(d.status, 0, `--dynamic-transcript must exit 0:\n${d.stderr}`);
    assert.match(d.stdout, /^confident\n/,
      `sessions/<pid>.json must be confident for a no-env-var claude process (production condition):\n${d.stdout}`);
  } finally {
    p.cleanup();
    try { fs.rmSync(root, { recursive: true, force: true }); } catch { /* best-effort */ }
  }
});

test("R6 — a no-env-var claude process (sessions/<pid>.json maps it to a NEW session) makes the observer resolve the NEW transcript on every poll (production restart self-heal, no re-mount)", { skip: tmuxAvailable ? false : "tmux not installed" }, async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "session-liveness-restart-"));
  const home = path.join(root, "home");
  const newSid = "11111111-aaaa-4bbb-8ccc-000000000001";
  const oldSid = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
  const p = makeNoEnvProbe("restart-sessions-full");
  try {
    assert.ok(await waitForAlive(p.env, p.session), "probe must be alive first");
    const pid = claudeChildPid(p.env, p.session);
    assert.ok(pid, "the probe must have a claude child");
    assertNoClaudeEnvVars(pid); // production condition: no CLAUDE_* env vars

    // the CC-maintained mapping (what exists right after a restart): pid → NEW session id
    writeSessionFile(home, pid, { sessionId: newSid, cwd: root });
    const newTranscript = transcriptFor(home, root, newSid);
    fs.mkdirSync(path.dirname(newTranscript), { recursive: true });
    fs.writeFileSync(newTranscript, "{}\n"); // the NEW session's transcript is FRESH

    // config points at a DIFFERENT (old, pre-restart) session id whose transcript is FROZEN — if the
    // observer were still bound to config (the pre-fix defect), OVERDUE would fire immediately.
    const oldTranscript = transcriptFor(home, root, oldSid);
    fs.writeFileSync(oldTranscript, "{}\n");
    spawnSync("touch", ["-d", "3 hours ago", oldTranscript], { encoding: "utf8" });

    const mon = spawnMonitor({ ...p.env, HOME: home, SESSION_ROOT: root },
      `inner ${root} ${p.session}`,
      { transcripts: `inner ${oldSid}`, overdueMin: 1, interval: 1 });
    try {
      // baseline: the observer must resolve the NEW fresh transcript via sessions/<pid>.json (no OVERDUE)
      const before = countRounds(mon);
      assert.ok(await waitForRounds(mon, before + 2, 20000), `baseline rounds must pass:\n${mon.output()}`);
      assert.ok(!/SESSION-OVERDUE/.test(mon.output()),
        `the observer must self-heal to the sessions-file-resolved NEW transcript (no OVERDUE). If it were watching the FROZEN configured old transcript, OVERDUE would fire:\n${mon.output()}`);

      // positive control: the observer IS watching the NEW transcript — freeze it → OVERDUE fires.
      spawnSync("touch", ["-d", "3 hours ago", newTranscript], { encoding: "utf8" });
      assert.ok(await waitForOutput(mon, /SESSION-OVERDUE inner/, 8000),
        `positive control: freezing the NEW transcript must fire OVERDUE (proves the observer resolved it via sessions/<pid>.json):\n${mon.output()}`);
    } finally {
      mon.child.kill("SIGKILL");
      mon.cleanup();
    }
  } finally {
    p.cleanup();
    try { fs.rmSync(root, { recursive: true, force: true }); } catch { /* best-effort */ }
  }
});

// R7/R8 — HISTFILE isolation (gap-test-fixture-pollutes-bash-history): the fixture's probe pane is a
// real interactive bash inheriting the runner's $HOME, so every send-keys'd `exec -a claude-probe …`
// command got appended to the real ~/.bash_history when the pane exited (1679/2000 lines of the
// user's history were claude-probe noise). isolateTmuxEnv must redirect the pane's history to
// /dev/null so the fixture never writes the user's real history. (The shared helper covers its ~8
// import consumers; the 3 local copies + events' 2 inline copies are fixed in-place by the same task.)

test("R7 — isolateTmuxEnv isolates HISTFILE (env unit: the fixture bash must never write ~/.bash_history)", () => {
  const sockDir = "/tmp/session-liveness-restart-env-sock";
  const env = isolateTmuxEnv(sockDir);
  assert.equal(env.TMUX_TMPDIR, sockDir, "TMUX_TMPDIR must point at the private socket dir");
  assert.ok(!("TMUX" in env), "TMUX must be stripped (library env)");
  assert.equal(env.HISTFILE, "/dev/null",
    `HISTFILE must be /dev/null (redirect the pane's history away from ~/.bash_history). Got: ${env.HISTFILE}`);
});

test("R8 — the probe pane inherits HISTFILE=/dev/null and does NOT write $HOME/.bash_history (integration)", { skip: tmuxAvailable ? false : "tmux not installed" }, async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "session-liveness-restart-"));
  __registerProbeTmp(tmp);
  const home = path.join(tmp, "home");
  fs.mkdirSync(home, { recursive: true });
  const sockDir = path.join(tmp, "sock");
  fs.mkdirSync(sockDir, { recursive: true });
  // Override HOME to a THROWAWAY dir so the test observes pollution hermetically: if HISTFILE were
  // NOT isolated, the pane bash would write this throwaway $HOME/.bash_history (the real-bug shape);
  // with HISTFILE=/dev/null it writes to /dev/null and never touches $HOME/.bash_history.
  const env = { ...isolateTmuxEnv(sockDir), HOME: home };
  const session = "restart-hist";
  const newS = tmux(["new-session", "-d", "-x", "200", "-y", "50", "-s", session, "bash"], env);
  assert.equal(newS.status, 0, `tmux new-session failed: ${newS.stderr}`);
  try {
    // the exact fixture command that polluted ~/.bash_history (1679 claude-probe lines)
    tmux(["send-keys", "-t", session, "exec -a claude-probe sleep 10000 &"], env);
    tmux(["send-keys", "-t", session, "Enter"], env);
    assert.ok(await waitForAlive(env, session), "probe must be alive first");

    // direct propagation proof: the pane's ACTUAL environ carries HISTFILE=/dev/null (not just the
    // client env) — the intermediate tmux layer must not strip it (hard-rule-4c: the quantity must
    // survive every intermediate layer to the point of effect).
    const panePid = tmux(["list-panes", "-t", session, "-F", "#{pane_pid}"], env).stdout.trim();
    assert.ok(panePid, "probe must have a pane pid");
    const environ = fs.readFileSync(`/proc/${panePid}/environ`, "utf8").split("\0");
    const histfile = environ.find((kv) => kv.startsWith("HISTFILE="));
    assert.equal(histfile, "HISTFILE=/dev/null",
      `the pane bash must inherit HISTFILE=/dev/null (tmux must not strip it). Pane environ HISTFILE: ${histfile}`);
  } finally {
    // teardownProbe kill-servers the pane → the pane bash exits → would save its history to
    // $HOME/.bash_history here if HISTFILE were unisolated.
    teardownProbe(tmp);
  }
  assert.ok(!fs.existsSync(path.join(home, ".bash_history")),
    `the fixture must not write $HOME/.bash_history (HISTFILE=/dev/null should have redirected it). Found: ${path.join(home, ".bash_history")}`);
});
