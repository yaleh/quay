#!/usr/bin/env node
// tmux-session.ts — the crystallized tmux-session library
// (tasks/gap-tmux-isolated-guard-has-zero-consumers-fifth-machine-wipe, STAGE 3).
//
// The L0 defense in .sh form (plugin/scripts/tmux-isolated.sh) had ZERO consumers outside its own
// test — 8 of 9 tmux-using test files bypassed it and hand-rolled isolation, and 4 of those 8 were
// missing the isolation mechanisms the guard's own header declares MANDATORY. On 2026-08-06 the
// machine's entire tmux server died a fifth time (sudo dmesg: no kernel OOM — a userspace tmux
// kill), because bare tmux commands landed on the DEFAULT socket that hosts the live quay sessions.
//
// The two isolation conditions (AC1 of tasks/gap-tmux-isolation-cannot-depend-on-caller-remembering-
// to-unset-TMUX):
//     $TMUX   overrides TMUX_TMPDIR   — setting only TMUX_TMPDIR does not isolate a process that
//                                       inherited $TMUX
//     -S/-L   overrides $TMUX         — an explicit -S/-L always isolates
// BOTH are required. THIS MODULE makes them STRUCTURAL (a call form, not a caller's memory):
// every tmux invocation is forced onto an explicit private socket and runs with $TMUX stripped.
//
// THREE-LAYER SPLIT (AC5 — 决策核 / 副作用边 / 真实语义验证):
//   L1  decision core  — PURE functions (no spawn, no io): resolvePrivateSocket / buildTmuxArgv /
//                        tmuxEnv. Zero tmux, pure unit tests (plugin/test/tmux-session.test.mjs).
//   L2  side-effect edge — tmux() spawns with an INJECTABLE `exec` (default node:child_process
//                        spawnSync). Tests inject a fake exec to assert argv/env correctness
//                        without starting a real server.
//   L3  real semantic verification — plugin/test/tmux-session.test.mjs integration tests on a
//                        PRIVATE socket (single digits), covering AC2's real semantics
//                        ($TMUX overrides TMUX_TMPDIR; only -S beats $TMUX).
//
// Consumers are the repo's .mjs test files, which `import { tmux, resolvePrivateSocket } from
// "../scripts/tmux-session.ts"` directly (AC6 — a bash → node spawn would defeat the injectable-
// exec seam). The `.sh` guard is retained as a thin wrapper for bash-call-site consumers only.
//
// Fail-closed (mirror of the .sh guard's AC1): a caller may not smuggle their own `-S`/`-L` in the
// args — they would override the private socket and silently defeat the isolation. buildTmuxArgv
// refuses them (throws).

import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";

// ── L1 decision core — PURE (no spawn) ────────────────────────────────────────────────────────────────

/** The base directory under which the private socket lives. Defaults to TMPDIR / XDG_RUNTIME_DIR / tmp,
 * matching the .sh guard's resolution. A caller may override `base` (tests use a per-test mkdtemp). */
export function resolveBase(opts = {}) {
  return opts.base ?? process.env.TMPDIR ?? process.env.XDG_RUNTIME_DIR ?? "/tmp";
}

/** The private socket path for a given base (or the default base). Shape matches the .sh guard:
 * `<base>/tmux-<uid>.sock` — per-user, under TMPDIR/XDG_RUNTIME_DIR/tmp. Pure. */
export function resolvePrivateSocket(opts = {}) {
  const base = resolveBase(opts);
  const uid = typeof process.getuid === "function" ? process.getuid() : os.userInfo().uid ?? 1000;
  return path.join(base, `tmux-${uid}.sock`);
}

/** The full tmux argv for a private-socket invocation: `["-S", sock, ...args]`. PURE.
 *
 * Fail-closed (AC1): a caller-supplied `-S`/`-L` is REFUSED (throws) — it would override the private
 * socket and could reach the default server. This mirrors tmux-isolated.sh's exit-3 self-check.
 */
export function buildTmuxArgv(args, opts = {}) {
  if (!Array.isArray(args)) throw new TypeError("buildTmuxArgv: args must be an array");
  const sock = opts.socket ?? resolvePrivateSocket(opts);
  // Fail-closed, anchored to the tmux flag grammar: `-S`/`-L` are GLOBAL options and only a socket
  // override when they appear BEFORE the subcommand. After the subcommand they are SUBCOMMAND options
  // (e.g. `-t`/`-p`/`-d`) or part of a command string — a `-L` inside a fixture path is NOT a socket
  // override and must not be refused (the first gate run false-positived on a `-L6mUZe` path segment).
  for (const a of args) {
    if (typeof a !== "string" || !a.startsWith("-")) break; // reached the subcommand (first non-flag token)
    if (/^-(?:S|L)/.test(a)) {
      throw new Error(`tmux-session: REFUSE caller-supplied socket flag '${a}' — the private socket is fixed`);
    }
  }
  return ["-S", sock, ...args];
}

/** The child env for an isolated tmux invocation: caller env (default process.env) merged over
 * extras, with $TMUX STRIPPED (setting it to undefined removes it in node:child_process — verified).
 * Pure given the caller env. `$TMUX overrides TMUX_TMPDIR`, so stripping it is one of the two
 * mandatory conditions. */
export function tmuxEnv(extra = {}) {
  return { ...process.env, ...extra, TMUX: undefined };
}

// ── L2 side-effect edge — INJECTABLE exec ─────────────────────────────────────────────────────────────

/** The default exec seam: node:child_process spawnSync, normalized to the same return shape every
 * test already reads ({ status, stdout, stderr }). */
export function defaultExec(command, argv, opts) {
  const r = spawnSync(command, argv, opts);
  return { status: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "", error: r.error };
}

/**
 * tmux(args, opts) — the ONE way to run tmux from a .mjs test. Structurally isolates:
 *   - explicit `-S <private-socket>` (only -S overrides $TMUX), and
 *   - env with $TMUX stripped (set to undefined).
 *
 * opts:
 *   socket  — the private socket path (default resolvePrivateSocket({ base: opts.base })).
 *   base    — base dir for the default socket resolution (tests: a per-test mkdtemp).
 *   env     — extra env to merge over process.env (e.g. TMUX_TMPDIR to align a helper script's
 *             bare `tmux` with this socket: <base>/tmux-<uid>/default).
 *   exec    — INJECTABLE exec seam (default defaultExec). A test may pass a fake
 *             (cmd, argv, opts) => ({ status, stdout, stderr }) to assert argv/env without a server.
 *
 * Returns the normalized exec result ({ status, stdout, stderr }). Callers read .status/.stdout/.stderr
 * exactly as they did with spawnSync.
 */
export function tmux(args, opts = {}) {
  const { socket, base, env, exec = defaultExec, ...rest } = opts;
  const argv = buildTmuxArgv(args, { socket, base });
  const childEnv = tmuxEnv(env);
  return exec("tmux", argv, { ...rest, encoding: "utf8", env: childEnv });
}

/** A thin convenience: run tmux and assert the exit status is `expected` (default 0), returning the
 * normalized result. Fail-loud — throws with stderr on mismatch. */
export function tmuxOrThrow(args, opts = {}) {
  const expected = opts.expected ?? 0;
  const r = tmux(args, opts);
  if (r.status !== expected) {
    throw new Error(`tmux ${JSON.stringify(args)} exited ${r.status} (expected ${expected}):\n${r.stderr}`);
  }
  return r;
}
