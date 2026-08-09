// @test-group lowconc
// GROUP NOTE (gap-suite-concurrency-8-green-serial-group-for-non-concurrent-tests): routed to the
// `serial` group (B-class real wall-clock wait — real tmux panes + delivery timing) so it runs in
// the concurrency-1 serial phase, never competing with the concurrency-8 main body.
// send-keys-verified.test.mjs — positive controls for the cross-project send-keys helper
// (plugin/scripts/send-keys-verified.sh). The manager was doing the delivery confirmation BY HAND
// every time it drove another session; this pins the mechanical version (orchestration/
// TOOLS-SESSION-HANDOFF.md todo #3 → cheap PREVENTION, deliberately NOT a detector for an
// irreproducible un-sent-input phenomenon: the one observed instance cleared itself and could
// never be distinguished from a gray ghost suggestion).
//
// Handoff rule 2 ("干跑没有输出不是证据") applies: every criterion has a known-triggering setup
// that must demonstrably fire, not silently return 0. The helper has three observable criteria:
//   - usage: missing args → exit 2, never a partial send.
//   - nonexistent target → tmux list-panes fails → exit 1 with a failure message (the manager's
//     named positive control: "造一个确定送不达的情形…确认助手真的报失败，而不是静默返回 0").
//   - input swallowed (stty -echo pane: keys go in, nothing redraws) → pane hash unchanged →
//     exit 1. Deterministic via a pane running `stty -echo; sleep 60`.
//   - delivery to a normal pane → exit 0 AND the text demonstrably lands (the sent command echoes
//     and runs: the pane later contains the sent marker).
//
// All panes live on an ISOLATED tmux socket (TMUX_TMPDIR) so the real quay-0/archguard-2/meta-cc-4
// sessions are untouchable; every mkdtemp tmpdir is removed in a finally (test-isolation R6).
//
// Teardown hygiene (gap-tests-leak-tmux-servers-main-resource-pressure-and-crash-cause, 2026-08-05):
// newHermetic().cleanup() kills each session it started with `tmux kill-session -t <name>` (NEVER
// kill-server — that command's blast radius is decided by the environment, which can silently
// vanish, see the task's 管理者撤回声明) BEFORE rmSync. The explicit -S socket argv (AC2c) makes the
// kill immune to a lost socket-selection env var; the AC2 negative control at the bottom proves it.
//
// Run:
//   scripts/test.sh plugin/test/send-keys-verified.test.mjs
//   node --test plugin/test/send-keys-verified.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";

// STAGE 1/3 (gap-tmux-isolated-guard-has-zero-consumers-fifth-machine-wipe): the hermetic tmux
// helpers already stripped $TMUX + carried an explicit -S; route them through the tmux-session
// library so BOTH conditions are structural (a call form, not a caller's memory).
import { tmux as isolatedTmux } from "../scripts/tmux-session.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HELPER = path.resolve(__dirname, "..", "scripts", "send-keys-verified.sh");

const tmuxAvailable = (() => {
  try { return spawnSync("tmux", ["-V"], { encoding: "utf8" }).status === 0; } catch { return false; }
})();

// ── helpers ────────────────────────────────────────────────────────────────────────────────────────

function isolateTmuxEnv(sockDir) {
  const env = { ...process.env, TMUX_TMPDIR: sockDir };
  delete env.TMUX;
  return env;
}

function tmux(args, env) {
  // Bare helper used for env-only resolution (e.g. -V availability checks / helper-script targets):
  // routes through the library, which strips $TMUX and forces an explicit -S (default private
  // socket when no sockDir is in play).
  return isolatedTmux(args, { env });
}

// tmuxAt — tmux with an EXPLICIT `-S <socket>` argv (AC2c, gap-tests-leak-tmux-servers-main-...):
// the socket selection rides in the CLI arg, NOT the environment. An env var can be silently
// dropped (the 09:2xZ fourth-wipe shape); a lost -S argument ERRORS instead of falling back to
// the default socket. sockPath === null/undefined ⇒ bare `tmux` (default-socket resolution) —
// used only for a scoped kill-session on the default server, never a server-creating/killing
// command. The hermetic path (sockPath provided) goes through the tmux-session library.
function tmuxAt(sockPath, args, env) {
  if (sockPath) return isolatedTmux(args, { socket: sockPath, env });
  const r = spawnSync("tmux", args, { encoding: "utf8", env });
  return { status: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

// newHermetic — an isolated tmux server whose socket is selected by BOTH mechanisms that agree:
//   - env TMUX_TMPDIR=sockDir (the helper script's socket contract), and
//   - the explicit -S path tmux materializes for that env: <sockDir>/tmux-<uid>/default.
// Every DIRECT tmux call in this file goes through -S (AC2c); the helper script uses env and
// resolves to the SAME socket file. cleanup() kills each session it started via kill-session —
// NEVER kill-server (AC2, rewritten 2026-08-05 after the 4th total machine wipe) — BEFORE
// rmSync: removing the tmpdir alone leaves the server alive as an orphan (删目录 ≠ 杀进程).
function newHermetic() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "skv-"));
  const sockDir = path.join(tmp, "sock");
  const socketBase = path.join(sockDir, `tmux-${process.getuid()}`);
  fs.mkdirSync(socketBase, { recursive: true, mode: 0o700 }); // tmux refuses a world-accessible socket dir
  const sockPath = path.join(socketBase, "default");
  const env = isolateTmuxEnv(sockDir);
  const started = new Set();
  return {
    tmp,
    sockDir,
    sockPath,
    env,
    started,
    newSession(name, cmd) {
      const r = tmuxAt(sockPath, ["new-session", "-d", "-s", name, cmd], env);
      if (r.status === 0) started.add(name); // only kill what actually started
      return r;
    },
    cleanup() {
      for (const name of started) {
        tmuxAt(sockPath, ["kill-session", "-t", name], env);
      }
      try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* best-effort */ }
    },
  };
}

function runHelper(env, args) {
  const r = spawnSync("bash", [HELPER, ...args], { encoding: "utf8", env });
  return { status: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

// ── usage ───────────────────────────────────────────────────────────────────────────────────────────

test("missing arguments exit 2 with a usage message (never a partial send)", () => {
  const h = newHermetic();
  try {
    const r = runHelper(h.env, []);
    assert.equal(r.status, 2, `expected usage exit, got ${r.status}\n${r.stdout}\n${r.stderr}`);
    assert.match(r.stderr, /用法/, `usage message expected:\n${r.stderr}`);
    const r2 = runHelper(h.env, ["some-target"]); // target but no text
    assert.equal(r2.status, 2, `expected usage exit for missing text, got ${r2.status}\n${r2.stderr}`);
  } finally {
    h.cleanup();
  }
});

// ── failure positive control: nonexistent target ───────────────────────────────────────────────────

test("a nonexistent target reports failure (exit 1), never a silent 0", { skip: tmuxAvailable ? false : "tmux not installed" }, () => {
  const h = newHermetic(); // fresh socket, no sessions → every target is nonexistent
  try {
    const r = runHelper(h.env, ["skv-no-such-session", "echo hi"]);
    assert.equal(r.status, 1, `must report failure, got ${r.status}\n${r.stdout}\n${r.stderr}`);
    assert.match(r.stderr, /不存在|无法送达/, `must name the failure:\n${r.stderr}`);
  } finally {
    h.cleanup();
  }
});

// ── failure positive control: input swallowed (hash unchanged) ─────────────────────────────────────

test("an input-swallowing pane (stty -echo) reports failure (exit 1)", { skip: tmuxAvailable ? false : "tmux not installed" }, async () => {
  const h = newHermetic();
  const S = "skv-noecho";
  try {
    const n = h.newSession(S, 'bash -c "stty -echo; sleep 60"');
    assert.equal(n.status, 0, `new-session failed: ${n.stderr}`);
    await sleep(300);
    const r = runHelper(h.env, [S, "echo swallowed-123"]);
    assert.equal(r.status, 1, `must report undelivered, got ${r.status}\n${r.stdout}\n${r.stderr}`);
    assert.match(r.stderr, /哈希未变|未送达/, `must name the failure:\n${r.stderr}`);
  } finally {
    h.cleanup();
  }
});

// ── success positive control: delivery lands ───────────────────────────────────────────────────────

test("delivery to a normal pane exits 0 and the text demonstrably lands", { skip: tmuxAvailable ? false : "tmux not installed" }, async () => {
  const h = newHermetic();
  const S = "skv-ok";
  try {
    const n = h.newSession(S, "bash");
    assert.equal(n.status, 0, `new-session failed: ${n.stderr}`);
    await sleep(300);
    const before = tmuxAt(h.sockPath, ["capture-pane", "-p", "-t", S], h.env).stdout;
    const marker = `echo skv-marker-${Date.now()}`;
    const r = runHelper(h.env, [S, marker]);
    assert.equal(r.status, 0, `must deliver, got ${r.status}\n${r.stdout}\n${r.stderr}`);
    assert.match(r.stdout, /已送达/, `success line expected:\n${r.stdout}`);
    await sleep(300);
    const after = tmuxAt(h.sockPath, ["capture-pane", "-p", "-t", S], h.env).stdout;
    assert.ok(after !== before, "pane content must have changed after the send");
    assert.match(after, /skv-marker/, "the sent command must have actually landed (echoed + ran)");
  } finally {
    h.cleanup();
  }
});

// ── AC2 negative control: a lost socket-selection env is harmless (the 09:2xZ wipe shape) ───────────

test("AC2 negative control — cleanup with a LOST socket-selection env is harmless: kill-session can only error (no-such-session), never wipe the default socket's real sessions", { skip: tmuxAvailable ? false : "tmux not installed" }, async () => {
  const h = newHermetic();
  const S = "skv-nc";
  try {
    const n = h.newSession(S, "bash");
    assert.equal(n.status, 0, `new-session failed: ${n.stderr}`);
    await sleep(200);
    // The 09:2xZ failure shape: the socket-selection environment silently disappears (shell state
    // does not persist across Bash invocations). Simulate it exactly as it happened.
    const stripped = { ...process.env };
    delete stripped.TMUX;
    delete stripped.TMUX_TMPDIR;
    // WORST case — even the -S argv is gone: kill-session falls to the default socket. It can only
    // report "no such session" (skv-nc lives on the isolated socket) — it can NEVER kill the server
    // hosting the machine's real sessions (kill-server is the only command with that blast radius).
    const before = spawnSync("tmux", ["list-sessions"], { encoding: "utf8" });
    const beforeOk = before.status === 0;
    const beforeSessions = beforeOk && before.stdout.trim() !== "" ? before.stdout.trim().split("\n").length : 0;
    const worst = tmuxAt(null, ["kill-session", "-t", S], stripped);
    assert.notEqual(worst.status, 0,
      `kill-session with a lost socket must error (or be harmless), got status ${worst.status}\n${worst.stderr}`);
    assert.match(worst.stderr, /can't find session|no such session|not found|no server running/i,
      `the failure must be a per-session no-op, never a server kill:\n${worst.stderr}`);
    if (beforeOk) {
      const after = spawnSync("tmux", ["list-sessions"], { encoding: "utf8" });
      assert.equal(after.status, 0, `list-sessions must still work after the negative control:\n${after.stderr}`);
      const afterSessions = after.stdout.trim() !== "" ? after.stdout.trim().split("\n").length : 0;
      assert.equal(afterSessions, beforeSessions,
        `real default-socket sessions must be UNAFFECTED by the lost-env kill-session (before=${beforeSessions}, after=${afterSessions})`);
      assert.ok(!/skv-nc/.test(after.stdout), "the isolated test session must not leak onto the default socket");
    }
    // The real cleanup (stored -S socket, AC2c) still reclaims the isolated session with a stripped env.
    h.cleanup();
    const iso = tmuxAt(h.sockPath, ["list-sessions"], stripped);
    assert.notEqual(iso.status, 0, "the isolated socket must have no server after cleanup");
  } finally {
    h.cleanup(); // idempotent — a second cleanup is also harmless (no-such-session)
  }
});
