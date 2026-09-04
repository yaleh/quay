// @test-group engine
// outer-session-check.test.mjs — gap-manager-adopt-outer-role-check-broken.
//
// Pins the manager-adopt three-state self-check of the OUTER session (single-window topology):
// the mechanical state machine (plugin/scripts/outer-session-check.sh) — healthy / empty-shell /
// missing on hermetic tmux + a planted claude child + a transcript fixture, with role="outer"
// (NOT "inner" — the hardcoded-role defect this task fixes: the pre-fix checker always looked for
// an "inner" window that no longer exists after topology convergence, so healthy/empty-shell were
// structurally unreachable).
//
//   healthy       window "outer" + claude child + transcript WITH a real user message
//   empty-shell   window "outer" + claude child + transcript WITHOUT a user message
//   missing       no "outer" window OR no claude child
//   degraded      transcript resolved via DISCOVERY heuristic (fail-closed, never silent healthy)
//   fail-closed   no session config ⇒ exit 1 (never guess a session name)
//
// All tmux work is on a HERMETIC server on a private socket (TMUX_TMPDIR), never the machine's
// real sessions. Cleanup kills each session it started (kill-session, never kill-server).
//
// Run:
//   scripts/test.sh plugin/test/outer-session-check.test.mjs
//   node --test plugin/test/outer-session-check.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

import { tmux as isolatedTmux } from "../scripts/tmux-session.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pluginDir = path.resolve(__dirname, "..");

const SELF_CHECK = path.join(pluginDir, "scripts", "outer-session-check.sh");

const tmuxAvailable = (() => {
  try { return spawnSync("tmux", ["-V"], { encoding: "utf8" }).status === 0; } catch { return false; }
})();

// ── hermetic tmux (private socket; kill-session per created session, never kill-server) ─────────────
function isolateTmuxEnv(sockDir) {
  const env = { ...process.env, TMUX_TMPDIR: sockDir };
  delete env.TMUX;
  env.HISTFILE = "/dev/null";
  return env;
}
function tmuxAt(sockPath, args, env) {
  if (sockPath) {
    return isolatedTmux(args, { socket: sockPath, env: env ?? process.env });
  }
  const r = spawnSync("tmux", args, { encoding: "utf8", env: env ?? process.env });
  return { status: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}
function newHermetic(prefix = "quay-osc-") {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  const sockDir = path.join(tmp, "sock");
  const socketBase = path.join(sockDir, `tmux-${process.getuid()}`);
  fs.mkdirSync(socketBase, { recursive: true, mode: 0o700 });
  const sockPath = path.join(socketBase, "default");
  const env = isolateTmuxEnv(sockDir);
  const started = new Set();
  return {
    tmp, sockDir, sockPath, env, started,
    newSession(name, cmd) {
      const r = tmuxAt(sockPath, ["new-session", "-d", "-s", name, cmd], env);
      if (r.status === 0) started.add(name);
      return r;
    },
    newWindow(sess, name, cmd) {
      return tmuxAt(sockPath, ["new-window", "-t", sess, "-n", name, cmd], env);
    },
    send(sess, text) {
      return tmuxAt(sockPath, ["send-keys", "-t", sess, text, "Enter"], env);
    },
    cleanup() {
      const ls = tmuxAt(sockPath, ["list-sessions", "-F", "#{session_name}"], env);
      if (ls.status === 0 && ls.stdout.trim()) {
        for (const name of ls.stdout.trim().split("\n").filter(Boolean)) {
          tmuxAt(sockPath, ["kill-session", "-t", name], env);
        }
      }
      for (const name of started) {
        tmuxAt(sockPath, ["kill-session", "-t", name], env);
      }
      for (const fname of ["topo-factory", "topo-idem", "topo-race", "osc-factory"]) {
        tmuxAt(null, ["kill-session", "-t", fname], process.env);
      }
      try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* best-effort */ }
    },
  };
}

function paneHasClaude(env, session) {
  const p = spawnSync("tmux", ["list-panes", "-t", session, "-F", "#{pane_pid}"], { encoding: "utf8", env });
  if (p.status !== 0 || !p.stdout.trim()) return false;
  const ppid = p.stdout.trim().split("\n")[0];
  const kids = spawnSync("pgrep", ["-P", ppid], { encoding: "utf8" });
  for (const pid of (kids.stdout ?? "").trim().split("\n").filter(Boolean)) {
    try {
      const cmd = fs.readFileSync(`/proc/${pid}/cmdline`, "utf8").replace(/\0/g, " ");
      if (cmd.includes("claude")) return true;
    } catch { /* best-effort */ }
  }
  return false;
}
// Under concurrent suite load (16-core parallel), tmux send-keys + a spawned claude-probe child
// can take longer than the original 5s window to become visible (A-class timing-sensitive flaky).
// The happy path resolves in well under a second; this bound only caps how long a genuinely-dead
// child is allowed to keep failing before waitForClaude reports false — it never reports a dead
// child as alive (see the negative-control test below).
const CLAUDE_START_TIMEOUT_MS = 30000;

async function waitForClaude(env, session, timeoutMs = CLAUDE_START_TIMEOUT_MS) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (paneHasClaude(env, session)) return true;
    await new Promise((r) => setTimeout(r, 100));
  }
  return paneHasClaude(env, session);
}

function runCheck(env, args = []) {
  return spawnSync("bash", [SELF_CHECK, ...args], { encoding: "utf8", env });
}

// Fixture transcripts — the exact JSONL shape transcript-delivery-check.ts recognizes.
const USER_MSG = '{"type":"user","message":{"role":"user","content":"执行 fast-mode-loop-tick.md 中的 tick 指令"}}\n';
const SYSTEM_ONLY = '{"type":"system","message":{"role":"system","content":"boot"}}\n';

// ── the script exists ──────────────────────────────────────────────────────────────────────────────
test("the outer-session-check.sh self-check script exists", () => {
  assert.ok(fs.existsSync(SELF_CHECK), "plugin/scripts/outer-session-check.sh must exist");
});

// ── the mechanical three-state machine (role="outer") ──────────────────────────────────────────────
test("state machine — healthy: outer window + claude child + transcript WITH a user message ⇒ healthy", { skip: tmuxAvailable ? false : "tmux not installed" }, async () => {
  const h = newHermetic();
  try {
    h.newSession("osc-h", "bash");
    h.newWindow("osc-h", "outer", "bash");
    h.send("osc-h:outer", "exec -a claude-probe sleep 10000 &");
    assert.ok(await waitForClaude(h.env, "osc-h:outer", CLAUDE_START_TIMEOUT_MS), "outer claude child must be alive");
    const tr = path.join(h.tmp, "outer.jsonl");
    fs.writeFileSync(tr, USER_MSG, "utf8");
    const r = runCheck(h.env, ["--session", "osc-h", "--json", "--transcript", tr]);
    assert.equal(r.status, 0, `must exit 0:\n${r.stdout}\n${r.stderr}`);
    const j = JSON.parse(r.stdout);
    assert.equal(j.window, true);
    assert.equal(j.process, true);
    assert.equal(j.transcriptFresh, false);
    assert.equal(j.state, "healthy");
    assert.equal(j.transcriptSource, "arg");
    assert.doesNotMatch(r.stderr, /discovery|degraded|WARNING/i,
      "healthy normal path must have zero alarm");
  } finally { h.cleanup(); }
});

test("state machine — empty-shell: outer window + claude child, transcript WITHOUT a user message ⇒ empty-shell", { skip: tmuxAvailable ? false : "tmux not installed" }, async () => {
  const h = newHermetic();
  try {
    h.newSession("osc-es", "bash");
    h.newWindow("osc-es", "outer", "bash");
    h.send("osc-es:outer", "exec -a claude-probe sleep 10000 &");
    assert.ok(await waitForClaude(h.env, "osc-es:outer", CLAUDE_START_TIMEOUT_MS), "outer claude child must be alive");
    // (a) transcript exists but holds no real user message (system-only).
    const trSys = path.join(h.tmp, "outer-sys.jsonl");
    fs.writeFileSync(trSys, SYSTEM_ONLY, "utf8");
    let r = runCheck(h.env, ["--session", "osc-es", "--json", "--transcript", trSys]);
    assert.equal(r.status, 0, `must exit 0:\n${r.stdout}\n${r.stderr}`);
    let j = JSON.parse(r.stdout);
    assert.equal(j.window, true);
    assert.equal(j.process, true);
    assert.equal(j.transcriptFresh, true);
    assert.equal(j.state, "empty-shell");
    // (b) transcript file absent entirely.
    const trAbsent = path.join(h.tmp, "no-such-transcript.jsonl");
    r = runCheck(h.env, ["--session", "osc-es", "--json", "--transcript", trAbsent]);
    assert.equal(r.status, 0, `absent-transcript must exit 0:\n${r.stdout}\n${r.stderr}`);
    j = JSON.parse(r.stdout);
    assert.equal(j.transcriptFresh, true);
    assert.equal(j.state, "empty-shell");
  } finally { h.cleanup(); }
});

test("state machine — missing: outer window absent OR no claude child ⇒ missing", { skip: tmuxAvailable ? false : "tmux not installed" }, () => {
  const h = newHermetic();
  try {
    // (a) session exists but has no outer window.
    h.newSession("osc-m", "bash");
    let r = runCheck(h.env, ["--session", "osc-m", "--json"]);
    assert.equal(r.status, 0, `must exit 0:\n${r.stdout}\n${r.stderr}`);
    let j = JSON.parse(r.stdout);
    assert.equal(j.window, false);
    assert.equal(j.state, "missing");
    // (b) outer window present but bare bash (no claude child).
    h.newWindow("osc-m", "outer", "bash");
    r = runCheck(h.env, ["--session", "osc-m", "--json"]);
    assert.equal(r.status, 0, `must exit 0:\n${r.stdout}\n${r.stderr}`);
    j = JSON.parse(r.stdout);
    assert.equal(j.window, true);
    assert.equal(j.process, false);
    assert.equal(j.state, "missing");
  } finally { h.cleanup(); }
});

test("negative control — a truly dead claude child is NOT masked by the longer wait", { skip: tmuxAvailable ? false : "tmux not installed" }, async () => {
  const h = newHermetic();
  try {
    h.newSession("osc-nc", "bash");
    h.newWindow("osc-nc", "outer", "bash");
    // No claude-probe child is ever planted. waitForClaude's verdict is paneHasClaude(...) —
    // the timeout only bounds how long it polls, it never flips a dead child into "alive".
    // A short window here is enough to exercise the poll loop and pin the false return.
    const alive = await waitForClaude(h.env, "osc-nc:outer", 1500);
    assert.equal(alive, false, "bare bash window (no claude child) must not be reported alive");
  } finally { h.cleanup(); }
});

test("state machine — fail-closed: no session config ⇒ exit 1 (never guess a session name)", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "quay-osc-failclosed-"));
  try {
    const fakeScripts = path.join(tmp, "plugin", "scripts");
    fs.mkdirSync(fakeScripts, { recursive: true });
    fs.copyFileSync(SELF_CHECK, path.join(fakeScripts, "outer-session-check.sh"));
    fs.copyFileSync(path.join(pluginDir, "scripts", "transcript-delivery-check.ts"),
      path.join(fakeScripts, "transcript-delivery-check.ts"));
    const env = { ...process.env };
    delete env.SESSION_TMUX_SESSION;
    delete env.TMUX;
    const r = spawnSync("bash", [path.join(fakeScripts, "outer-session-check.sh"), "--json"],
      { encoding: "utf8", env });
    assert.notEqual(r.status, 0, "missing session config must fail-closed (not guess)");
    assert.match(r.stderr, /never guesses|不猜|no tmux session/, "the failure must state it never guesses a session");
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});

// ── degraded: TR_SOURCE=discovery (fail-closed) is NOT silent ───────────────────────────────────────
test("TR_SOURCE=discovery alarms on stderr and marks state=degraded (never silent healthy/empty-shell)", { skip: tmuxAvailable ? false : "tmux not installed" }, async () => {
  const h = newHermetic("quay-osc-d1-");
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "quay-osc-d1root-"));
  let homeTmp;
  try {
    h.newSession("osc-d1", "bash");
    h.newWindow("osc-d1", "outer", "bash");
    h.send("osc-d1:outer", "exec -a claude-probe sleep 10000 &");
    assert.ok(await waitForClaude(h.env, "osc-d1:outer", CLAUDE_START_TIMEOUT_MS), "outer claude child must be alive");

    const fakeScripts = path.join(tmp, "plugin", "scripts");
    fs.mkdirSync(fakeScripts, { recursive: true });
    fs.copyFileSync(SELF_CHECK, path.join(fakeScripts, "outer-session-check.sh"));
    fs.copyFileSync(path.join(pluginDir, "scripts", "transcript-delivery-check.ts"),
      path.join(fakeScripts, "transcript-delivery-check.ts"));

    homeTmp = fs.mkdtempSync(path.join(os.tmpdir(), "quay-osc-d1home-"));
    const slug = tmp.replace(/\//g, "-");
    const discoveryDir = path.join(homeTmp, ".claude", "projects", slug);
    fs.mkdirSync(discoveryDir, { recursive: true });
    fs.writeFileSync(path.join(discoveryDir, "not-my-session.jsonl"), SYSTEM_ONLY, "utf8");

    const env = { ...h.env, HOME: homeTmp, CLAUDE_CODE_SESSION_ID: "my-session" };
    const r = spawnSync("bash", [path.join(fakeScripts, "outer-session-check.sh"), "--session", "osc-d1", "--json"],
      { encoding: "utf8", env });
    assert.equal(r.status, 0, `degraded is a completed determination, must exit 0:\n${r.stdout}\n${r.stderr}`);
    const j = JSON.parse(r.stdout);
    assert.equal(j.window, true);
    assert.equal(j.process, true);
    assert.equal(j.transcriptSource, "discovery");
    assert.equal(j.state, "degraded", "discovery-sourced transcript must NOT report healthy/empty-shell");
    assert.match(r.stderr, /discovery|degraded|WARNING/, "the degraded path must alarm on stderr (not silent)");
  } finally {
    if (homeTmp) fs.rmSync(homeTmp, { recursive: true, force: true });
    h.cleanup();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("a discovery-sourced USER_MSG transcript (would-be-healthy shape) yields degraded + alarm, never healthy", { skip: tmuxAvailable ? false : "tmux not installed" }, async () => {
  const h = newHermetic("quay-osc-d2-");
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "quay-osc-d2root-"));
  let homeTmp;
  try {
    h.newSession("osc-d2", "bash");
    h.newWindow("osc-d2", "outer", "bash");
    h.send("osc-d2:outer", "exec -a claude-probe sleep 10000 &");
    assert.ok(await waitForClaude(h.env, "osc-d2:outer", CLAUDE_START_TIMEOUT_MS), "outer claude child must be alive");

    const fakeScripts = path.join(tmp, "plugin", "scripts");
    fs.mkdirSync(fakeScripts, { recursive: true });
    fs.copyFileSync(SELF_CHECK, path.join(fakeScripts, "outer-session-check.sh"));
    fs.copyFileSync(path.join(pluginDir, "scripts", "transcript-delivery-check.ts"),
      path.join(fakeScripts, "transcript-delivery-check.ts"));

    homeTmp = fs.mkdtempSync(path.join(os.tmpdir(), "quay-osc-d2home-"));
    const slug = tmp.replace(/\//g, "-");
    const discoveryDir = path.join(homeTmp, ".claude", "projects", slug);
    fs.mkdirSync(discoveryDir, { recursive: true });
    fs.writeFileSync(path.join(discoveryDir, "not-my-session.jsonl"), USER_MSG, "utf8");

    const env = { ...h.env, HOME: homeTmp, CLAUDE_CODE_SESSION_ID: "my-session" };
    const r = spawnSync("bash", [path.join(fakeScripts, "outer-session-check.sh"), "--session", "osc-d2", "--json"],
      { encoding: "utf8", env });
    assert.equal(r.status, 0, `must exit 0:\n${r.stdout}\n${r.stderr}`);
    const j = JSON.parse(r.stdout);
    assert.equal(j.window, true);
    assert.equal(j.process, true);
    assert.equal(j.transcriptSource, "discovery");
    assert.equal(j.state, "degraded", "would-be-healthy discovery transcript must NOT report healthy");
    assert.notEqual(j.state, "healthy");
    assert.match(r.stderr, /discovery|degraded|WARNING/);
  } finally {
    if (homeTmp) fs.rmSync(homeTmp, { recursive: true, force: true });
    h.cleanup();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
