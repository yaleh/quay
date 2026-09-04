// @test-group lowconc
// @load-sensitive real-install
// @load-sensitive-entry 2026-08-09 hermetic tmux server + real install; B-class real wall-clock wait; re-split lowconc 2026-08-12 (gap-suite-tiering-kind-heavy-not-a-mechanism)
// KNOWN-LOAD-SENSITIVE (see plugin/loop/fast-mode-loop-tick.md "已知负载敏感族") — real-install e2e:
// exercises a HERMETIC tmux server + real quay-init install. The install/quay-init family rotated
// flakes across groups under full-suite load, so the whole family is consolidated into the
// concurrency-1 serial phase (gap-install-family-tests-rotate-flakes-under-full-suite).
// GROUP NOTE (gap-suite-concurrency-8-green-serial-group-for-non-concurrent-tests + gap-install-
// family-tests-rotate-flakes-under-full-suite): routed to the `serial` group (B-class real wall-clock
// wait — exercises a HERMETIC tmux server and real tmux has-session round-trips) so it runs in the
// concurrency-1 serial phase, never competing with the concurrency-N main body. It left the product
// group (was AC7 product) because the install contract it guards is now covered by the serial phase
// of the full suite, not the concurrency-N body.
// quay-init-tmux-detection.test.mjs — gap-init-guesses-the-tmux-session.
//
// The installer once guessed "<project>-0:0.0" as the tmux session (no detection) and wrote the
// guess into orchestration/session-liveness.env (the monitor config). A monitor aimed at a
// nonexistent session reports a LIVE inner as GONE — the false-negative the monitor must never
// emit. The invariant: 检测不到真实会话时必须 fail-closed；绝不把猜测值写进监视器配置.
//
// AC1  — a UNIQUE `tmux list-sessions` match by project name is detected and written
// AC2  — ZERO matches ⇒ refuse to write, exit non-zero, error names --tmux-session (负控制;
//        "AC2 不过则 AC1 不算数" — 立案理由正是猜测值被写进了配置)
// AC3  — MULTIPLE matches ⇒ require explicit --tmux-session, never pick one
// AC4  — no --tmux-session ⇒ either the real session is written or the install clearly fails
// AC5  — the written value resolves: `tmux has-session -t <value>` exits 0
// (The retired observer itself used to fail closed when NO session was configured — the old
// "<basename>-0" fallback was the same guess shape — the monitor must never guess a session).
//
// Detection is exercised against a HERMETIC tmux server on a private socket (TMUX_TMPDIR), so
// the machine's real sessions (quay-0 / meta-cc-4 / ...) can never leak into the assertion and
// the test never touches them. Install is a user-visible contract → @test-group serial (was AC7
// product; the serial group runs the full suite's install contract in its concurrency-1 phase).
//
// Run:
//   scripts/test.sh plugin/test/quay-init-tmux-detection.test.mjs
//   node --test plugin/test/quay-init-tmux-detection.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

// STAGE 1/3 (gap-tmux-isolated-guard-has-zero-consumers-fifth-machine-wipe): the explicit-socket
// kill calls (tmuxAt) route through the tmux-session library so BOTH isolation conditions are
// structural. Session CREATION stays env-based (quay-init.sh's detection is an env contract — it
// must resolve the SAME socket the test set up via TMUX_TMPDIR, which the already-stripped $TMUX
// makes private).
import { tmux as isolatedTmux } from '../scripts/tmux-session.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pluginDir = path.resolve(__dirname, '..');

const tmuxAvailable = (() => {
  try { return spawnSync('tmux', ['-V'], { encoding: 'utf8' }).status === 0; } catch { return false; }
})();

function makeTmp(prefix = 'quay-init-tmux-') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}
function cleanup(dir) {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* best-effort */ }
}

// isolateTmuxEnv: point bare `tmux` at a PRIVATE server socket so detection and the probe setup
// can never resolve to the machine's real sessions.
function isolateTmuxEnv(sockDir) {
  const env = { ...process.env, TMUX_TMPDIR: sockDir };
  delete env.TMUX;
  env.HISTFILE = "/dev/null"; // gap-test-fixture-pollutes-bash-history: fixture bash must not write ~/.bash_history
  return env;
}

function tmux(args, env) {
  const r = spawnSync('tmux', args, { encoding: 'utf8', env: env ?? process.env });
  return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

// socketPathFor / tmuxAt — explicit -S socket argv (AC2c of
// gap-tests-leak-tmux-servers-main-resource-pressure-and-crash-cause). The socket file tmux
// materializes for TMUX_TMPDIR=<dir> is <dir>/tmux-<uid>/default; carrying it as a -S argv makes
// the KILL calls immune to a silently lost socket-selection env var (the 09:2xZ wipe shape).
// Session CREATION stays env-based because quay-init.sh's detection is an env contract — it must
// resolve the SAME socket the test set up. AC2b: the four teardowns below use kill-session -t
// <name> (never the old `tmux ['kill-server']` — that command's blast radius is decided by the
// environment, which can silently vanish).
function socketPathFor(sockDir) {
  return path.join(sockDir, `tmux-${process.getuid()}`, 'default');
}
function tmuxAt(sockPath, args, env) {
  if (sockPath) {
    // Explicit -S + $TMUX-stripped env, both structural via the library.
    return isolatedTmux(args, { socket: sockPath, env: env ?? process.env });
  }
  const r = spawnSync('tmux', args, { encoding: 'utf8', env: env ?? process.env });
  return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

// A worktree root quay-init's validation ACCEPTS: a real disk path, not tmpfs. /tmp is tmpfs on
// dev boxes and the sibling-of-repo default for a /tmp test workspace would be rejected
// fail-closed (gap-the-shipped-tick-doc-... AC3). /var/tmp is the disk-backed tmp on Linux.
function diskWorktreeRoot() {
  for (const base of ['/var/tmp', os.tmpdir()]) {
    try {
      const t = spawnSync('stat', ['-f', '-c', '%T', base], { encoding: 'utf8' });
      if (t.status === 0 && t.stdout.trim() !== 'tmpfs') {
        return path.join(base, `quay-wt-${process.pid}-${Math.random().toString(36).slice(2)}`);
      }
    } catch { /* try next base */ }
  }
  return path.join(os.tmpdir(), `quay-wt-${process.pid}-${Math.random().toString(36).slice(2)}`);
}

function runInit(workspace, args = [], env = process.env) {
  // --loop tests need an explicit disk worktree root (the sibling default of a /tmp workspace is
  // tmpfs and is correctly rejected). Inject BEFORE the caller's args so an explicit one wins.
  const loop = args.includes('--loop');
  const extra = loop && !args.some((a) => a === '--worktree-root') ? ['--worktree-root', diskWorktreeRoot()] : [];
  return spawnSync('bash', [path.join(pluginDir, 'scripts', 'quay-init.sh'), ...extra, ...args],
    { cwd: workspace, encoding: 'utf8', env: { ...env, CLAUDE_PLUGIN_ROOT: pluginDir } });
}

// paneHasClaudeChild — the first child of the pane
// shell whose /proc/<pid>/cmdline contains "claude". The probe is `exec -a claude-probe sleep`.
function paneHasClaudeChild(env, session) {
  const p = tmux(['list-panes', '-t', session, '-F', '#{pane_pid}'], env);
  if (p.status !== 0 || !p.stdout.trim()) return false;
  const kids = spawnSync('pgrep', ['-P', p.stdout.trim()], { encoding: 'utf8' });
  const first = (kids.stdout ?? '').trim().split('\n').filter(Boolean)[0];
  if (!first) return false;
  try {
    const cmd = fs.readFileSync(`/proc/${first}/cmdline`, 'utf8').replace(/\0/g, ' ');
    return cmd.includes('claude');
  } catch {
    return false;
  }
}

async function waitForAlive(env, session, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (paneHasClaudeChild(env, session)) return true;
    await new Promise((r) => setTimeout(r, 100));
  }
  return paneHasClaudeChild(env, session);
}

// ── AC1: unique match is detected and written ──────────────────────────────────────────────────────
test('AC1 — a UNIQUE matching tmux session is detected and written (no --tmux-session needed)', { skip: tmuxAvailable ? false : 'tmux not installed' }, () => {
  const ws = makeTmp();
  const sockDir = path.join(ws, 'sock'); fs.mkdirSync(sockDir, { recursive: true });
  const env = isolateTmuxEnv(sockDir);
  try {
    const ns = tmux(['new-session', '-d', '-s', 'ac1proj-0', 'bash'], env);
    assert.equal(ns.status, 0, `new-session failed: ${ns.stderr}`);
    // a NON-matching session must be ignored.
    assert.equal(tmux(['new-session', '-d', '-s', 'other-2', 'bash'], env).status, 0);

    fs.mkdirSync(path.join(ws, 'scripts'), { recursive: true });
    fs.writeFileSync(path.join(ws, 'scripts', 'test.sh'), '#!/bin/bash\necho test\n');
    const r = runInit(ws, ['--loop', '--root', ws, '--project', 'ac1proj'], env);
    assert.equal(r.status, 0, `init must exit 0:\n${r.stderr}`);
    assert.match(r.stdout, /detected tmux session: ac1proj-0/,
      `must report the detected session for the human to confirm:\n${r.stdout}`);

    // The detected session — NOT a guess — is written to the monitor config and the loop config.
    const envFile = fs.readFileSync(path.join(ws, 'orchestration', 'session-liveness.env'), 'utf8');
    assert.match(envFile, /SESSION_TMUX_SESSION=ac1proj-0/,
      'the DETECTED session must be written to orchestration/session-liveness.env');
    const cfg = fs.readFileSync(path.join(ws, '.quay', 'config.yml'), 'utf8');
    assert.match(cfg, /tmux_session:\s*ac1proj-0/,
      'the detected session must be written to .quay/config.yml loop.tmux_session');

    // AC5: the written value must resolve.
    assert.equal(tmux(['has-session', '-t', 'ac1proj-0'], env).status, 0,
      'tmux has-session -t <written value> must exit 0');
  } finally {
    // AC2b: kill-session per created session (never kill-server — see socketPathFor comment).
    tmuxAt(socketPathFor(sockDir), ['kill-session', '-t', 'ac1proj-0'], env);
    tmuxAt(socketPathFor(sockDir), ['kill-session', '-t', 'other-2'], env);
    cleanup(ws);
  }
});

// ── AC2: zero matches ⇒ fail closed, never write a guess (the 立案 reason) ──────────────────────────
// NOT gated on tmux availability: fail-closed must hold even when tmux is entirely absent (the
// detector returns "no match" and the installer refuses to write — never a guess).
test('AC2 — NO matching tmux session: fail-closed (exit 2), refuses to write, names --tmux-session; the monitor config is never written', () => {
  const ws = makeTmp();
  const sockDir = path.join(ws, 'sock'); fs.mkdirSync(sockDir, { recursive: true });
  const env = isolateTmuxEnv(sockDir); // private socket — on a tmux box this is a server with NO sessions
  try {
    fs.mkdirSync(path.join(ws, 'scripts'), { recursive: true });
    fs.writeFileSync(path.join(ws, 'scripts', 'test.sh'), '#!/bin/bash\necho test\n');
    const r = runInit(ws, ['--loop', '--root', ws, '--project', 'ac2proj'], env);
    assert.equal(r.status, 2, 'no matching session must fail closed (exit 2)');
    assert.match(r.stderr, /none could be detected/, 'must state nothing was detected');
    assert.match(r.stderr, /--tmux-session/, 'must tell the human to pass --tmux-session explicitly');
    assert.match(r.stderr, /no universal default/, 'must state no default is guessed');
    // The negative control that defines the task: the guess must NOT be written.
    assert.ok(!fs.existsSync(path.join(ws, 'orchestration', 'session-liveness.env')),
      'AC2: must NOT write a guessed value into the monitor config');
    assert.ok(!fs.existsSync(path.join(ws, '.quay', 'config.yml')),
      'AC2: must NOT write the loop config with a guessed session');
  } finally {
    cleanup(ws);
  }
});

// ── AC3: multiple matches ⇒ require explicit --tmux-session, never pick one ─────────────────────────
test('AC3 — MULTIPLE matching sessions: require explicit --tmux-session (never pick the first); with it, the install proceeds', { skip: tmuxAvailable ? false : 'tmux not installed' }, () => {
  const ws = makeTmp();
  const sockDir = path.join(ws, 'sock'); fs.mkdirSync(sockDir, { recursive: true });
  const env = isolateTmuxEnv(sockDir);
  try {
    assert.equal(tmux(['new-session', '-d', '-s', 'ac3proj-0', 'bash'], env).status, 0);
    assert.equal(tmux(['new-session', '-d', '-s', 'ac3proj-1', 'bash'], env).status, 0);
    fs.mkdirSync(path.join(ws, 'scripts'), { recursive: true });
    fs.writeFileSync(path.join(ws, 'scripts', 'test.sh'), '#!/bin/bash\necho test\n');

    const r = runInit(ws, ['--loop', '--root', ws, '--project', 'ac3proj'], env);
    assert.equal(r.status, 2, 'multiple matches must fail closed (exit 2)');
    assert.match(r.stderr, /multiple tmux sessions match project 'ac3proj'/,
      'must say multiple sessions match');
    assert.match(r.stderr, /ac3proj-0/, 'must list the matching sessions');
    assert.match(r.stderr, /ac3proj-1/, 'must list the matching sessions');
    assert.match(r.stderr, /--tmux-session/, 'must tell the human to pass --tmux-session');
    assert.ok(!fs.existsSync(path.join(ws, 'orchestration', 'session-liveness.env')),
      'AC3: must NOT pick one and write it (no guess, no first-match)');

    // With an explicit --tmux-session the install proceeds and writes the explicit value.
    const r2 = runInit(ws, ['--loop', '--root', ws, '--project', 'ac3proj', '--tmux-session', 'ac3proj-1'], env);
    assert.equal(r2.status, 0, `explicit --tmux-session must succeed:\n${r2.stderr}`);
    assert.match(r2.stdout, /using explicit --tmux-session: ac3proj-1/, 'must report the explicit session');
    const envFile = fs.readFileSync(path.join(ws, 'orchestration', 'session-liveness.env'), 'utf8');
    assert.match(envFile, /SESSION_TMUX_SESSION=ac3proj-1/, 'the explicit value must be written');
    assert.equal(tmux(['has-session', '-t', 'ac3proj-1'], env).status, 0, 'AC5: the written value must resolve');
  } finally {
    // AC2b: kill-session per created session (never kill-server — see socketPathFor comment).
    tmuxAt(socketPathFor(sockDir), ['kill-session', '-t', 'ac3proj-0'], env);
    tmuxAt(socketPathFor(sockDir), ['kill-session', '-t', 'ac3proj-1'], env);
    cleanup(ws);
  }
});

// ── AC2b: an explicit --tmux-session always wins, even when detection would find something else ────
test('explicit --tmux-session takes priority over detection (the fallback the human controls)', { skip: tmuxAvailable ? false : 'tmux not installed' }, () => {
  const ws = makeTmp();
  const sockDir = path.join(ws, 'sock'); fs.mkdirSync(sockDir, { recursive: true });
  const env = isolateTmuxEnv(sockDir);
  try {
    // detection WOULD find ac2bproj-0 uniquely
    assert.equal(tmux(['new-session', '-d', '-s', 'ac2bproj-0', 'bash'], env).status, 0);
    fs.mkdirSync(path.join(ws, 'scripts'), { recursive: true });
    fs.writeFileSync(path.join(ws, 'scripts', 'test.sh'), '#!/bin/bash\necho test\n');
    const r = runInit(ws, ['--loop', '--root', ws, '--project', 'ac2bproj',
      '--tmux-session', 'myexplicit'], env);
    assert.equal(r.status, 0, `init must exit 0:\n${r.stderr}`);
    assert.match(r.stdout, /using explicit --tmux-session: myexplicit/,
      'the explicit value must be used, not the detected one');
    assert.ok(!/detected tmux session/.test(r.stdout),
      'an explicit --tmux-session must suppress detection');
    const envFile = fs.readFileSync(path.join(ws, 'orchestration', 'session-liveness.env'), 'utf8');
    assert.match(envFile, /SESSION_TMUX_SESSION=myexplicit/, 'the explicit value must be written');
  } finally {
    // AC2b: kill-session per created session (never kill-server — see socketPathFor comment).
    tmuxAt(socketPathFor(sockDir), ['kill-session', '-t', 'ac2bproj-0'], env);
    cleanup(ws);
  }
});
