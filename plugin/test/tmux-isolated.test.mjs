// @test-group engine
// tmux-isolated.test.mjs — the L0 defense
// (tasks/gap-tmux-isolation-cannot-depend-on-caller-remembering-to-unset-TMUX).
//
// AC1  helper exists + executable; call form is `env -u TMUX tmux -S "<private-socket>" "$@"`;
//      the socket path contains the uid and lives under TMPDIR/${XDG_RUNTIME_DIR:-/tmp};
//      fail-closed (a caller-supplied -S/-L is refused, never silently forwarded).
// AC2  negative control (ONE-WAY kill): `tmux-isolated.sh kill-server` on the helper's own private
//      socket must leave ANOTHER tmux server intact, and must leave the helper's socket dead.
//      Proved hermetically with TWO isolated sockets under a per-test TMPDIR (the stand-in plays
//      the role of the real default server). The real default server (quay-0) is never touched
//      here — the live proof against it is recorded in the task body.
// AC5  node:test + @test-group engine; the test NEVER bare-calls `tmux kill-server` — every
//      tmux invocation goes through the helper (tmux-isolated.sh) or the explicit isolated form
//      `env -u TMUX tmux -S <socket>`. No literal `tmux kill-server` string appears in this file.
//
// Run: scripts/test.sh plugin/test/tmux-isolated.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

import { makeTmpDir } from "./helpers/tmp-workspace.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const HELPER = path.join(REPO_ROOT, "plugin", "scripts", "tmux-isolated.sh");


const tmuxAvailable = (() => {
  try { return spawnSync("tmux", ["-V"], { encoding: "utf8" }).status === 0; } catch { return false; }
})();

// envFor(base): point the helper's socket resolution (TMPDIR) at a per-test directory so tests
// never collide with the shared per-user isolated socket or the real default server. TMUX_TMPDIR
// is set for parity with the rest of the suite's hermetic tmux pattern (the helper ignores it).
function envFor(base) {
  return { ...process.env, TMPDIR: base, TMUX_TMPDIR: base };
}

// helper(args, env): run the real tmux-isolated.sh. Every tmux touch in this file goes through the
// helper or tmuxExplicit — never a bare `tmux`.
function helper(args, env) {
  return spawnSync("bash", [HELPER, ...args], { encoding: "utf8", env: env ?? process.env });
}

// tmuxExplicit(sock, args, env): the explicit-socket form for the STAND-IN (non-helper) socket in
// the AC2 two-socket negative control — `env -u TMUX tmux -S <sock> ...`. Never the default server.
function tmuxExplicit(sock, args, env) {
  return spawnSync("env", ["-u", "TMUX", "tmux", "-S", sock, ...args], { encoding: "utf8", env: env ?? process.env });
}

// ── AC1: existence + executable ────────────────────────────────────────────────────────────────

test("AC1 helper exists and is executable", () => {
  assert.ok(fs.existsSync(HELPER), `helper missing: ${HELPER}`);
  const st = fs.statSync(HELPER);
  assert.ok(st.isFile());
  assert.ok((st.mode & 0o111) !== 0, "helper must be executable");
});

// ── AC1: invariant helper_uses_explicit_S = 1 (Contract) ───────────────────────────────────────

test("AC1 invariant helper_uses_explicit_S: the call form is `env -u TMUX tmux -S <socket> \"$@\"`", () => {
  const src = fs.readFileSync(HELPER, "utf8");
  assert.match(src, /env -u TMUX tmux -S/, "must strip \$TMUX and pass an explicit -S");
  assert.match(src, /-S "\$SOCK"/, "the -S must name the private socket variable");
  assert.match(src, /exec env -u TMUX/, "the call must exec the stripped-env tmux");
});

// ── AC1: socket path shape (uid + under TMPDIR/XDG_RUNTIME_DIR/tmp) ────────────────────────────

test("AC1 --show-socket: path contains uid and lives under TMPDIR", () => {
  const base = makeTmpDir("tmuxisol-sock-");
  const r = helper(["--show-socket"], envFor(base));
  assert.equal(r.status, 0, r.stderr);
  const sock = r.stdout.trim();
  const uid = String(process.getuid());
  assert.ok(sock.includes(uid), `socket path '${sock}' lacks uid ${uid}`);
  assert.ok(sock.startsWith(base + path.sep), `socket '${sock}' not under base '${base}'`);
  assert.ok(sock.endsWith(`tmux-${uid}.sock`), `unexpected socket filename: ${sock}`);
});

// ── AC1: fail-closed on a caller-supplied -S/-L ────────────────────────────────────────────────

test("AC1 fail-closed: a caller-supplied -S/-L is refused (exit 3), never silently forwarded", () => {
  const base = makeTmpDir("tmuxisol-reject-");
  const env = envFor(base);
  for (const bad of ["-S", "-S/tmp/evil.sock", "-L", "-Levil"]) {
    const r = helper([bad, "ls"], env);
    assert.notEqual(r.status, 0, `flag ${bad} must be refused, got exit ${r.status}`);
    assert.match(r.stderr, /REFUSE/, `flag ${bad} must produce a REFUSE message`);
  }
  // The refusal must NOT have created a server anywhere (the real default is untouched by
  // construction — assert the helper socket has no server: tmux exits non-zero with a
  // "no server running" OR "error connecting ... (No such file or directory)" message,
  // depending on whether a socket file was ever created. Exit code is the real signal.
  const r2 = helper(["ls"], env);
  assert.notEqual(r2.status, 0, "helper socket must be dead after refusals");
  assert.ok(r2.stderr.length > 0, "dead socket must produce a tmux error message");
});

// ── AC2: negative control — ONE-WAY kill (the heart of L0) ─────────────────────────────────────

test("AC2 negative control: helper kill-server kills ONLY its own socket; another server survives", { skip: tmuxAvailable ? false : "tmux not installed" }, () => {
  const base = makeTmpDir("tmuxisol-ac2-");
  const env = envFor(base);
  const helperSock = helper(["--show-socket"], env).stdout.trim();
  const standinSock = path.join(base, `tmux-standin-${process.getuid()}.sock`);

  // Stand-in "default" server: a SECOND isolated socket (never the real default server).
  let r = tmuxExplicit(standinSock, ["new-session", "-d", "-s", "standin"], env);
  assert.equal(r.status, 0, `stand-in new-session failed: ${r.stderr}`);
  try {
    // A server on the helper's OWN private socket.
    r = helper(["new-session", "-d", "-s", "iso"], env);
    assert.equal(r.status, 0, `helper new-session failed: ${r.stderr}`);

    // Both sockets alive before the kill.
    r = helper(["ls"], env);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /iso/, "helper socket should list its own session");
    r = tmuxExplicit(standinSock, ["ls"], env);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /standin/, "stand-in socket should list its session");

    // THE kill: through the helper, on the private socket only.
    r = helper(["kill-server"], env);
    assert.equal(r.status, 0, `isolated kill-server failed: ${r.stderr}`);

    // AC2 second direction: the helper's own socket is dead (no server).
    r = helper(["ls"], env);
    assert.notEqual(r.status, 0, "helper socket must report no server after kill-server");
    assert.match(r.stderr, /no server running/, "helper socket must report no server running");

    // AC2 first direction: the stand-in "default" server SURVIVES.
    r = tmuxExplicit(standinSock, ["ls"], env);
    assert.equal(r.status, 0, `stand-in default server must survive isolated kill-server: ${r.stderr}`);
    assert.match(r.stdout, /standin/, "stand-in default server must still list its session");
  } finally {
    // Cleanup on ITS OWN socket only (the helper socket, if a leftover server somehow survives a
    // mid-test failure, is killed through the helper itself — still only that private socket).
    tmuxExplicit(standinSock, ["kill-server"], env);
    helper(["kill-server"], env);
  }
});

