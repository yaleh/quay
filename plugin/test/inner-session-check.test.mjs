// @test-group engine
// inner-session-check.test.mjs — gap-outer-self-checks-and-creates-inner-session, AC1–AC6.
//
// Pins the outer cold-start step 3 self-check: the three-state determination of the inner
// session (healthy / empty-shell / missing) and the document that drives it.
//
//   AC1 — the tick doc (plugin/loop/orchestrator-loop-tick.md) step 3 self-checks inner
//         (window + claude process + transcript user message) and names the three states.
//   AC2 — the tick doc's permission boundary: healthy ⇒ do nothing (no rebuild/restart/params),
//         proceed to the drive flow.
//   AC3 — the tick doc drives (not rebuilds) the empty-shell (window+process, no user message).
//   AC4 — the tick doc calls quay-topology.sh (the two-window factory) when inner is missing,
//         and the factory builds outer+inner only (no manager window).
//   AC5 — after creating, the drive is verified INNER-DRIVEN (transcript shows a user message,
//         never assumed) — send-keys-reliable is the delivery mechanism.
//   plus — the mechanical three-state machine (plugin/scripts/inner-session-check.sh):
//         healthy / empty-shell / missing on hermetic tmux + a planted claude child + a
//         transcript fixture; fail-closed with no session config.
//
// All tmux work is on a HERMETIC server on a private socket (TMUX_TMPDIR), never the machine's
// real sessions. Cleanup kills each session it started (kill-session, never kill-server —
// gap-tests-leak-tmux-servers-main-resource-pressure-and-crash-cause).
//
// Run:
//   scripts/test.sh plugin/test/inner-session-check.test.mjs
//   node --test plugin/test/inner-session-check.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

// STAGE 1/3 (gap-tmux-isolated-guard-has-zero-consumers-fifth-machine-wipe): route the hermetic
// tmux path through the tmux-session library so BOTH isolation conditions are structural. The
// sockPath === null form (default-socket kill of factory-created sessions) deliberately stays a
// bare spawn — a scoped kill-session on the default socket, never kill-server/new-session.
import { tmux as isolatedTmux } from "../scripts/tmux-session.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pluginDir = path.resolve(__dirname, "..");

const TICK_DOC = path.join(pluginDir, "loop", "orchestrator-loop-tick.md");
const SELF_CHECK = path.join(pluginDir, "scripts", "inner-session-check.sh");
const FACTORY = path.join(pluginDir, "scripts", "quay-topology.sh");
const CHECK = path.join(pluginDir, "scripts", "topology-check.sh");

const tickSrc = fs.readFileSync(TICK_DOC, "utf8");

const tmuxAvailable = (() => {
  try { return spawnSync("tmux", ["-V"], { encoding: "utf8" }).status === 0; } catch { return false; }
})();

// ── hermetic tmux (private socket; kill-session per created session, never kill-server) ─────────────
function isolateTmuxEnv(sockDir) {
  const env = { ...process.env, TMUX_TMPDIR: sockDir };
  delete env.TMUX;
  env.HISTFILE = "/dev/null"; // gap-test-fixture-pollutes-bash-history: fixture bash must not write ~/.bash_history
  return env;
}
function tmuxAt(sockPath, args, env) {
  if (sockPath) {
    // Hermetic path: the library forces explicit -S + $TMUX-stripped env (both conditions).
    return isolatedTmux(args, { socket: sockPath, env: env ?? process.env });
  }
  // Default-socket path (sockPath === null/undefined): a scoped kill-session of a factory-created
  // session on the real default socket. Deliberate, never a server-creating/killing command.
  const r = spawnSync("tmux", args, { encoding: "utf8", env: env ?? process.env });
  return { status: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}
function newHermetic(prefix = "quay-isc-") {
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
      // Kill EVERY session on this hermetic socket — not just the `started` set. The factory
      // (quay-topology.sh --session isc-factory/…) invoked with the hermetic env creates sessions
      // DIRECTLY on this socket, invisible to `started`; leaving them orphaned leaks the server
      // (删目录 ≠ 杀进程 — gap-tests-leak-tmux-servers-main-resource-pressure-and-crash-cause).
      // The socket is private to this test (mkdtemp'd, isolated TMUX_TMPDIR + explicit -S), so
      // sweeping it cannot touch real sessions; per-session kill-session (never kill-server).
      const ls = tmuxAt(sockPath, ["list-sessions", "-F", "#{session_name}"], env);
      if (ls.status === 0 && ls.stdout.trim()) {
        for (const name of ls.stdout.trim().split("\n").filter(Boolean)) {
          tmuxAt(sockPath, ["kill-session", "-t", name], env);
        }
      }
      for (const name of started) {
        tmuxAt(sockPath, ["kill-session", "-t", name], env);
      }
      // TMUX_TMPDIR IS honored when $TMUX is stripped — `env -u TMUX TMUX_TMPDIR=<dir> tmux
      // new-session -d` lands on <dir>/tmux-<uid>/default; an INHERITED $TMUX overrides
      // TMUX_TMPDIR (gap-tmux-stale-not-honored-comment-private-socket-leak-scan AC1). The
      // factory scripts (quay-topology.sh --session topo-factory/topo-race/isc-factory) run
      // under this file's hermetic env ($TMUX stripped + TMUX_TMPDIR=sockDir), so they build on
      // THIS private socket and the sweep above reaches them. The default-socket kill loop below
      // is a harmless defensive net — scoped to the factory names this file creates, a
      // kill-session on the default socket can only error "no such session" and never touches a
      // real user session (per-session kill-session, never kill-server).
      for (const fname of ["topo-factory", "topo-idem", "topo-race", "isc-factory"]) {
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
async function waitForClaude(env, session, timeoutMs = 5000) {
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

// ── AC1 — the tick doc self-checks inner with the three states ─────────────────────────────────────
test("AC1 — the tick doc's cold-start step 3 self-checks inner and names the three states", () => {
  assert.match(tickSrc, /自检/, "step 3 must self-check inner (not just find it)");
  for (const st of ["healthy", "empty-shell", "missing"]) {
    assert.ok(tickSrc.includes(st), `step 3 must name the ${st} state`);
  }
  assert.match(tickSrc, /inner-session-check\.sh/, "step 3 must reference the self-check script (mechanical, not prose)");
  // the self-check script itself exists and is executable-shaped
  assert.ok(fs.existsSync(SELF_CHECK), "plugin/scripts/inner-session-check.sh must exist");
});

// ── AC2 — permission boundary: healthy ⇒ do nothing ─────────────────────────────────────────────────
test("AC2 — the tick doc treats a healthy inner as 'do nothing, proceed to drive' (permission boundary)", () => {
  // the doc must state that a healthy inner is NOT rebuilt / restarted / re-parameterized.
  assert.match(tickSrc, /权限边界|不重建|不动/, "step 3 must state the permission boundary (healthy inner untouched)");
  assert.match(tickSrc, /不重建|不重启|不改/, "healthy ⇒ no rebuild/restart/param change");
});

// ── AC3 — empty-shell ⇒ drive, not rebuild ──────────────────────────────────────────────────────────
test("AC3 — the tick doc drives (not rebuilds) the empty-shell inner", () => {
  assert.match(tickSrc, /空壳/, "step 3 must name the empty-shell state");
  assert.match(tickSrc, /驱动而非重建|驱动.*不重建|DRIVE|send-keys/, "empty-shell ⇒ drive, not rebuild");
});

// ── AC4 — missing ⇒ call the two-window factory (quay-topology.sh), no manager ─────────────────────
test("AC4 — the tick doc calls quay-topology.sh (two-window factory) when inner is missing, no manager", () => {
  assert.match(tickSrc, /quay-topology\.sh/, "missing ⇒ the tick doc must call the topology factory");
  assert.match(tickSrc, /两窗口/, "the created topology must be the two-window one");
  const factorySrc = fs.readFileSync(FACTORY, "utf8");
  assert.match(factorySrc, /ROLES="outer inner"/, "the factory must be two-window (outer+inner)");
  assert.ok(!/ROLES="[^"]*manager/.test(factorySrc), "the factory must NOT include a manager window");
  const checkSrc = fs.readFileSync(CHECK, "utf8");
  assert.match(checkSrc, /ROLES="outer inner"/, "the check must verify exactly the two-window topology");
});

// ── AC5 — after creating, the drive is verified INNER-DRIVEN (transcript user message) ──────────────
test("AC5 — the tick doc verifies the inner drive via the transcript (never assumed success)", () => {
  assert.match(tickSrc, /send-keys-reliable/, "the drive must go through the reliable-send mechanism (transcript delivery check)");
  assert.match(tickSrc, /transcript-delivery-check|user 消息|user message|INNER-DRIVEN/, "the delivery verdict must be the transcript user message, never assumed");
});

// ── this task's AC2 — the cold-start --json consumer reads transcriptSource and alarms on discovery ──
test("AC2 (fallback-silent) — the cold-start consumer reads transcriptSource and alarms on discovery (degraded)", () => {
  assert.ok(tickSrc.includes("degraded"), "step 3 must name the degraded state (discovery fallback is fail-closed)");
  assert.match(tickSrc, /transcriptSource/, "the cold-start --json consumer must read transcriptSource");
  assert.match(tickSrc, /==discovery/, "the consumer must key its alarm on transcriptSource == discovery");
  assert.match(tickSrc, /不得按 healthy 放行|按 degraded 处理/, "the consumer must reject/not-trust a discovery-sourced healthy");
});

// ── the mechanical three-state machine ──────────────────────────────────────────────────────────────
test("state machine — healthy: window + claude child + transcript WITH a user message ⇒ healthy", { skip: tmuxAvailable ? false : "tmux not installed" }, async () => {
  const h = newHermetic();
  try {
    h.newSession("isc-h", "bash");
    h.newWindow("isc-h", "inner", "bash");
    h.send("isc-h:inner", "exec -a claude-probe sleep 10000 &");
    assert.ok(await waitForClaude(h.env, "isc-h:inner", 5000), "inner claude child must be alive");
    const tr = path.join(h.tmp, "inner.jsonl");
    fs.writeFileSync(tr, USER_MSG, "utf8");
    const r = runCheck(h.env, ["--session", "isc-h", "--json", "--transcript", tr]);
    assert.equal(r.status, 0, `must exit 0:\n${r.stdout}\n${r.stderr}`);
    const j = JSON.parse(r.stdout);
    assert.equal(j.window, true);
    assert.equal(j.process, true);
    assert.equal(j.transcriptFresh, false);
    assert.equal(j.state, "healthy");
    assert.equal(j.transcriptSource, "arg", "explicit --transcript is the structural source, not discovery");
    assert.doesNotMatch(r.stderr, /discovery|degraded|WARNING/i,
      "Contract control: the healthy normal path must have zero alarm (no regression)");
  } finally { h.cleanup(); }
});

test("state machine — empty-shell: window + claude child, transcript WITHOUT a user message ⇒ empty-shell", { skip: tmuxAvailable ? false : "tmux not installed" }, async () => {
  const h = newHermetic();
  try {
    h.newSession("isc-es", "bash");
    h.newWindow("isc-es", "inner", "bash");
    h.send("isc-es:inner", "exec -a claude-probe sleep 10000 &");
    assert.ok(await waitForClaude(h.env, "isc-es:inner", 5000), "inner claude child must be alive");
    // (a) transcript exists but holds no real user message (system-only).
    const trSys = path.join(h.tmp, "inner-sys.jsonl");
    fs.writeFileSync(trSys, SYSTEM_ONLY, "utf8");
    let r = runCheck(h.env, ["--session", "isc-es", "--json", "--transcript", trSys]);
    assert.equal(r.status, 0, `must exit 0:\n${r.stdout}\n${r.stderr}`);
    let j = JSON.parse(r.stdout);
    assert.equal(j.window, true);
    assert.equal(j.process, true);
    assert.equal(j.transcriptFresh, true);
    assert.equal(j.state, "empty-shell");
    // (b) transcript file absent entirely (fresh claude writes jsonl only on first input).
    const trAbsent = path.join(h.tmp, "no-such-transcript.jsonl");
    r = runCheck(h.env, ["--session", "isc-es", "--json", "--transcript", trAbsent]);
    assert.equal(r.status, 0, `absent-transcript must exit 0:\n${r.stdout}\n${r.stderr}`);
    j = JSON.parse(r.stdout);
    assert.equal(j.transcriptFresh, true);
    assert.equal(j.state, "empty-shell");
  } finally { h.cleanup(); }
});

test("state machine — missing: inner window absent OR no claude child ⇒ missing", { skip: tmuxAvailable ? false : "tmux not installed" }, () => {
  const h = newHermetic();
  try {
    // (a) session exists but has no inner window (the meta-cc-3/archguard-4 single-bash shape).
    h.newSession("isc-m", "bash");
    let r = runCheck(h.env, ["--session", "isc-m", "--json"]);
    assert.equal(r.status, 0, `must exit 0:\n${r.stdout}\n${r.stderr}`);
    let j = JSON.parse(r.stdout);
    assert.equal(j.window, false);
    assert.equal(j.state, "missing");
    // (b) inner window present but bare bash (no claude child).
    h.newWindow("isc-m", "inner", "bash");
    r = runCheck(h.env, ["--session", "isc-m", "--json"]);
    assert.equal(r.status, 0, `must exit 0:\n${r.stdout}\n${r.stderr}`);
    j = JSON.parse(r.stdout);
    assert.equal(j.window, true);
    assert.equal(j.process, false);
    assert.equal(j.state, "missing");
  } finally { h.cleanup(); }
});

test("state machine — fail-closed: no session config ⇒ exit 1 (never guess a session name)", () => {
  // Run a COPY of the script from a temp repo root that has NO orchestration/session-liveness.env
  // and no SESSION_TMUX_SESSION — the real worktree's env file would otherwise resolve a session.
  // The script self-locates REPO_ROOT from BASH_SOURCE, so copying it (+ its checker dependency)
  // into <tmp>/plugin/scripts/ makes the temp dir the repo root.
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "quay-isc-failclosed-"));
  try {
    const fakeScripts = path.join(tmp, "plugin", "scripts");
    fs.mkdirSync(fakeScripts, { recursive: true });
    fs.copyFileSync(SELF_CHECK, path.join(fakeScripts, "inner-session-check.sh"));
    fs.copyFileSync(path.join(pluginDir, "scripts", "transcript-delivery-check.ts"),
      path.join(fakeScripts, "transcript-delivery-check.ts"));
    const env = { ...process.env };
    delete env.SESSION_TMUX_SESSION;
    delete env.TMUX;
    const r = spawnSync("bash", [path.join(fakeScripts, "inner-session-check.sh"), "--json"],
      { encoding: "utf8", env });
    // No session config reachable → fail-closed (not a guess).
    assert.notEqual(r.status, 0, "missing session config must fail-closed (not guess)");
    assert.match(r.stderr, /never guesses|不猜|no tmux session/, "the failure must state it never guesses a session");
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});

// ── AC1 — TR_SOURCE=discovery (degraded fallback) is NOT silent ─────────────────────────────────────
test("AC1 — TR_SOURCE=discovery alarms on stderr and marks state=degraded (never silent healthy/empty-shell)", { skip: tmuxAvailable ? false : "tmux not installed" }, async () => {
  // Hermetic degraded path: the inner claude child has no structurally-resolvable CLAUDE_CODE_SESSION_ID
  // (its environ carries no sid mapping to a planted transcript), so structural discovery (discovery-pid)
  // fails and the legacy heuristic fallback fires → TR_SOURCE=discovery. A copy of the script in a temp
  // repo root + a hermetic $HOME make the discovery dir (`$HOME/.claude/projects/<temp-slug>/`) fully
  // hermetic. SYSTEM_ONLY transcript = would-be empty-shell if the fallback were trusted — must be degraded.
  const h = newHermetic("quay-isc-ac1-");
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "quay-isc-ac1root-"));
  let homeTmp;
  try {
    h.newSession("isc-ac1", "bash");
    h.newWindow("isc-ac1", "inner", "bash");
    h.send("isc-ac1:inner", "exec -a claude-probe sleep 10000 &");
    assert.ok(await waitForClaude(h.env, "isc-ac1:inner", 5000), "inner claude child must be alive");

    const fakeScripts = path.join(tmp, "plugin", "scripts");
    fs.mkdirSync(fakeScripts, { recursive: true });
    fs.copyFileSync(SELF_CHECK, path.join(fakeScripts, "inner-session-check.sh"));
    fs.copyFileSync(path.join(pluginDir, "scripts", "transcript-delivery-check.ts"),
      path.join(fakeScripts, "transcript-delivery-check.ts"));

    homeTmp = fs.mkdtempSync(path.join(os.tmpdir(), "quay-isc-ac1home-"));
    const slug = tmp.replace(/\//g, "-");
    const discoveryDir = path.join(homeTmp, ".claude", "projects", slug);
    fs.mkdirSync(discoveryDir, { recursive: true });
    fs.writeFileSync(path.join(discoveryDir, "not-my-session.jsonl"), SYSTEM_ONLY, "utf8");

    const env = { ...h.env, HOME: homeTmp, CLAUDE_CODE_SESSION_ID: "my-session" };
    const r = spawnSync("bash", [path.join(fakeScripts, "inner-session-check.sh"), "--session", "isc-ac1", "--json"],
      { encoding: "utf8", env });
    assert.equal(r.status, 0, `degraded is a completed determination, must exit 0:\n${r.stdout}\n${r.stderr}`);
    const j = JSON.parse(r.stdout);
    assert.equal(j.window, true);
    assert.equal(j.process, true);
    assert.equal(j.transcriptSource, "discovery", "structural source unavailable ⇒ fallback source must be exposed as discovery");
    assert.equal(j.state, "degraded", "discovery-sourced transcript must NOT report healthy/empty-shell — fail-closed degraded");
    assert.match(r.stderr, /discovery|degraded|WARNING/, "the degraded path must alarm on stderr (not silent)");
  } finally {
    if (homeTmp) fs.rmSync(homeTmp, { recursive: true, force: true });
    h.cleanup();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// ── AC3 — non-Linux / no-structural-source fallback is loud, never a silent healthy ──────────────────
test("AC3 — a discovery-sourced USER_MSG transcript (would-be-healthy breeding shape) yields degraded + alarm, never healthy", { skip: tmuxAvailable ? false : "tmux not installed" }, async () => {
  // The exact breeding shape from the gap: a degraded cold-start self-check that would have reported
  // healthy on the misidentified transcript must now be loud + degraded (fail-closed). This is the state
  // a non-Linux host / unreadable /proc environ lands in: structural discovery cannot resolve, the heuristic
  // fallback fires — and it must NOT silently masquerade as healthy.
  const h = newHermetic("quay-isc-ac3-");
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "quay-isc-ac3root-"));
  let homeTmp;
  try {
    h.newSession("isc-ac3", "bash");
    h.newWindow("isc-ac3", "inner", "bash");
    h.send("isc-ac3:inner", "exec -a claude-probe sleep 10000 &");
    assert.ok(await waitForClaude(h.env, "isc-ac3:inner", 5000), "inner claude child must be alive");

    const fakeScripts = path.join(tmp, "plugin", "scripts");
    fs.mkdirSync(fakeScripts, { recursive: true });
    fs.copyFileSync(SELF_CHECK, path.join(fakeScripts, "inner-session-check.sh"));
    fs.copyFileSync(path.join(pluginDir, "scripts", "transcript-delivery-check.ts"),
      path.join(fakeScripts, "transcript-delivery-check.ts"));

    homeTmp = fs.mkdtempSync(path.join(os.tmpdir(), "quay-isc-ac3home-"));
    const slug = tmp.replace(/\//g, "-");
    const discoveryDir = path.join(homeTmp, ".claude", "projects", slug);
    fs.mkdirSync(discoveryDir, { recursive: true });
    fs.writeFileSync(path.join(discoveryDir, "not-my-session.jsonl"), USER_MSG, "utf8");

    const env = { ...h.env, HOME: homeTmp, CLAUDE_CODE_SESSION_ID: "my-session" };
    const r = spawnSync("bash", [path.join(fakeScripts, "inner-session-check.sh"), "--session", "isc-ac3", "--json"],
      { encoding: "utf8", env });
    assert.equal(r.status, 0, `must exit 0:\n${r.stdout}\n${r.stderr}`);
    const j = JSON.parse(r.stdout);
    assert.equal(j.window, true);
    assert.equal(j.process, true);
    assert.equal(j.transcriptSource, "discovery");
    assert.equal(j.state, "degraded", "would-be-healthy discovery transcript must NOT report healthy");
    assert.notEqual(j.state, "healthy", "the silent-fallback-to-healthy shape is the bug being killed");
    assert.match(r.stderr, /discovery|degraded|WARNING/, "the fallback must be loud on stderr");
  } finally {
    if (homeTmp) fs.rmSync(homeTmp, { recursive: true, force: true });
    h.cleanup();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("factory — quay-topology.sh builds the two-window topology that the self-check reports healthy", { skip: tmuxAvailable ? false : "tmux not installed" }, async () => {
  const h = newHermetic();
  try {
    const build = spawnSync("bash", [FACTORY, "--session", "isc-factory"], {
      encoding: "utf8",
      env: { ...h.env, TOPOLOGY_LAUNCH_CMD: "bash -c 'exec -a claude-probe sleep 10000 & wait'" },
    });
    assert.equal(build.status, 0, `factory build must exit 0:\n${build.stderr}`);
    const names = spawnSync("tmux", ["list-windows", "-t", "isc-factory", "-F", "#{window_name}"], { encoding: "utf8", env: h.env })
      .stdout.trim().split("\n").filter(Boolean);
    for (const role of ["outer", "inner"]) assert.ok(names.includes(role), `factory must create ${role}`);
    assert.ok(!names.includes("manager"), `factory must NOT create manager (got: ${names.join(", ")})`);
    // inner has a claude child; a fresh (no user message) transcript → empty-shell (the factory-built,
    // not-yet-driven shape). Use an explicit empty fixture so the verdict does not depend on the host's
    // real ~/.claude transcripts.
    assert.ok(await waitForClaude(h.env, "isc-factory:inner", 5000), "factory-built inner must have a claude child");
    const tr = path.join(h.tmp, "fresh-inner.jsonl");
    fs.writeFileSync(tr, SYSTEM_ONLY, "utf8");
    const r = runCheck(h.env, ["--session", "isc-factory", "--json", "--transcript", tr]);
    assert.equal(r.status, 0, `self-check must exit 0:\n${r.stdout}\n${r.stderr}`);
    const j = JSON.parse(r.stdout);
    assert.equal(j.state, "empty-shell", "a factory-built but never-driven inner is an empty shell — drive, don't rebuild");
  } finally { h.cleanup(); }
});
