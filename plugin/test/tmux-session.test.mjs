// @test-group governance
// tmux-session.test.mjs — the three-layer tmux-session library
// (tasks/gap-tmux-isolated-guard-has-zero-consumers-fifth-machine-wipe, STAGE 3 / AC5-AC7).
//
// L1 decision core  — PURE function tests (resolvePrivateSocket / buildTmuxArgv / tmuxEnv): zero
//                     tmux, zero spawn. Covers the socket shape, the fail-closed -S/-L refusal, and
//                     the $TMUX-strip.
// L2 side-effect edge — INJECTABLE exec: a fake exec captures the argv/env the library would hand
//                     to spawnSync, so argv correctness (explicit -S first) and env correctness
//                     ($TMUX stripped) are asserted WITHOUT starting a real server (AC6's injectable
//                     seam — this is why the library is .ts, not .sh).
// L3 real semantic verification — a HANDLE of real tmux integration tests on a PRIVATE socket
//                     (AC7 — not all fake): the AC2 承重条 ($TMUX overrides TMUX_TMPDIR; only -S
//                     beats $TMUX) is reproduced hermetically, and the library's own tmux() lands on
//                     a private socket even while inheriting $TMUX. Single digits by design.
//
// Every real tmux invocation in THIS file goes through the library (never a bare `tmux`), and every
// real server lives on a per-test mkdtemp'd private socket, killed with kill-server on that socket
// only (never the default server). Run: scripts/test.sh plugin/test/tmux-session.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

import {
  buildTmuxArgv,
  defaultExec,
  resolvePrivateSocket,
  tmux,
  tmuxEnv,
} from "../scripts/tmux-session.ts";

// ── Governance self-skip (AC5 @test-group governance; ADR-019 decision #1 precedent) ───────────
if (process.env.QUAY_TEST_GROUPS && !process.env.QUAY_TEST_GROUPS.split(",").includes("governance")) {
  test("governance group skipped", { skip: "set QUAY_TEST_GROUPS=governance to run" }, () => {});
} else {

const tmuxAvailable = (() => {
  try { return spawnSync("tmux", ["-V"], { encoding: "utf8" }).status === 0; } catch { return false; }
})();

const uid = typeof process.getuid === "function" ? process.getuid() : 1000;

function makeTmpDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

// ── L1 decision core — pure (zero tmux, zero spawn) ────────────────────────────────────────────

test("L1 pure: resolvePrivateSocket is under base and contains the uid (guard shape)", () => {
  const base = makeTmpDir("tmuxsess-sock-");
  const sock = resolvePrivateSocket({ base });
  assert.ok(sock.startsWith(base + path.sep), `'${sock}' not under base '${base}'`);
  assert.ok(sock.includes(String(uid)), `socket '${sock}' lacks uid ${uid}`);
  assert.ok(sock.endsWith(`tmux-${uid}.sock`), `unexpected socket filename: ${sock}`);
});

test("L1 pure: buildTmuxArgv prepends -S <socket>; no args → just [-S, sock]", () => {
  const sock = "/tmp/priv.sock";
  assert.deepEqual(buildTmuxArgv(["ls"], { socket: sock }), ["-S", sock, "ls"]);
  assert.deepEqual(buildTmuxArgv([], { socket: sock }), ["-S", sock]);
});

test("L1 pure: buildTmuxArgv REFUSES a caller-supplied -S/-L (fail-closed, AC1)", () => {
  const sock = "/tmp/priv.sock";
  for (const bad of ["-S", "-S/tmp/evil.sock", "-L", "-Levil"]) {
    assert.throws(() => buildTmuxArgv([bad, "ls"], { socket: sock }), /REFUSE/, `flag ${bad} must be refused`);
  }
});

test("L1 pure: tmuxEnv strips $TMUX and merges extras", () => {
  const env = tmuxEnv({ TMUX_TMPDIR: "/tmp/x" });
  // The property is present but undefined — node:child_process drops undefined values, so the child
  // sees no $TMUX (verified against a real spawn in the L2/L3 tests below).
  assert.equal("TMUX" in env, true);
  assert.equal(env.TMUX, undefined);
  assert.equal(env.TMUX_TMPDIR, "/tmp/x");
  assert.ok(env.PATH, "caller env (PATH) is preserved");
});

// ── L2 side-effect edge — injectable exec (no real server) ─────────────────────────────────────

test("L2 injectable exec: tmux() hands the fake exec the isolated argv (explicit -S first) + $TMUX-stripped env", () => {
  let captured = null;
  const fakeExec = (cmd, argv, opts) => {
    captured = { cmd, argv, env: opts.env };
    return { status: 0, stdout: "captured", stderr: "" };
  };
  const sock = "/tmp/l2.sock";
  const r = tmux(["new-session", "-d", "-s", "probe"], { socket: sock, exec: fakeExec });
  assert.equal(r.stdout, "captured");
  assert.equal(captured.cmd, "tmux");
  assert.deepEqual(captured.argv, ["-S", sock, "new-session", "-d", "-s", "probe"], "explicit -S must be argv[0]");
  assert.equal(captured.env.TMUX, undefined, "child env must strip $TMUX");
  // opts passes through encoding + the caller's env extras.
  assert.equal(captured.env.TMUX_TMPDIR, undefined);
});

test("L2 injectable exec: the REAL spawnSync path lands on a private socket while inheriting $TMUX (no server leak)", { skip: tmuxAvailable ? false : "tmux not installed" }, () => {
  const base = makeTmpDir("tmuxsess-l2-");
  const sock = resolvePrivateSocket({ base });
  // NOTE: this test DOES spawn a real tmux server, but ONLY on the private socket `sock` (the
  // library's explicit -S). It inherits the live $TMUX yet must never touch the default server.
  // The session command stays ALIVE (sleep) so the server does not exit before the list-sessions
  // assertion (a `true` that exits instantly can race the server shutdown under suite load).
  const r = tmux(["new-session", "-d", "-s", "l2-probe", "sleep", "10000"], { socket: sock });
  try {
    assert.equal(r.status, 0, `library tmux new-session failed: ${r.stderr}`);
    const ls = tmux(["list-sessions", "-F", "#{session_name}"], { socket: sock });
    assert.equal(ls.status, 0, ls.stderr);
    assert.match(ls.stdout, /l2-probe/, `session must appear on the PRIVATE socket:\n${ls.stdout}`);
  } finally {
    tmux(["kill-server"], { socket: sock });
  }
});

// ── L3 real semantic verification — the AC2 承重条 (hermetic, never the real default) ───────────

/**
 * Reproduce the crash-path mechanism hermetically with THREE sockets under one temp root:
 *   defSock — the stand-in "default" server ($TMUX points here), NEVER the machine's real one;
 *   tmptmp  — a TMUX_TMPDIR whose materialized socket is where a naive caller HOPES to land;
 *   privSock — the library's private socket (explicit -S).
 * The assertions prove: (1) bare `tmux new-session` with only TMUX_TMPDIR set, while inheriting
 * $TMUX, lands on the DEFAULT socket (the crash path); (2) the same scenario through the library
 * (explicit -S + $TMUX stripped) lands on the PRIVATE socket. This is AC2's 承重条 — if the header's
 * mechanism claim were wrong, these tests would fail and the task direction would need correction.
 */
function ac2Fixture() {
  const tmp = makeTmpDir("tmuxsess-ac2-");
  const defSock = path.join(tmp, "def.sock");
  const tmptmp = path.join(tmp, "tmptmp");
  const privSock = path.join(tmp, "priv.sock");
  fs.mkdirSync(tmptmp, { recursive: true, mode: 0o700 });
  return { tmp, defSock, tmptmp, privSock };
}

test("AC2 承重条 (1): inherited $TMUX + only TMUX_TMPDIR → bare tmux lands on the DEFAULT socket (the crash path)", { skip: tmuxAvailable ? false : "tmux not installed" }, () => {
  const { tmp, defSock, tmptmp } = ac2Fixture();
  const inheritedTmux = `${defSock},0,0`;
  try {
    // Stand-in "default" server on defSock. Session commands must stay ALIVE (sleep), or the session
    // exits on command completion and the server may shut down before the list-sessions assertion.
    const up = tmux(["new-session", "-d", "-s", "defbase", "sleep", "10000"], { socket: defSock });
    assert.equal(up.status, 0, `stand-in default failed: ${up.stderr}`);

    // The crash shape: $TMUX inherited, only TMUX_TMPDIR set, BARE `tmux new-session` (no -S).
    const env = { ...process.env, TMUX_TMPDIR: tmptmp };
    const leaked = defaultExec("tmux", ["new-session", "-d", "-s", "leaky", "sleep", "10000"], {
      env: { ...env, TMUX: inheritedTmux }, encoding: "utf8",
    });
    assert.equal(leaked.status, 0, `bare new-session failed: ${leaked.stderr}`);

    // It MUST land on the DEFAULT socket (defSock) — $TMUX overrides TMUX_TMPDIR.
    const onDefault = tmux(["list-sessions", "-F", "#{session_name}"], { socket: defSock });
    assert.match(onDefault.stdout, /leaky/, `$TMUX overrides TMUX_TMPDIR — 'leaky' must be on the default socket:\n${onDefault.stdout}`);
    // It must NOT be on the TMUX_TMPDIR-materialized socket.
    const tmptmpSock = path.join(tmptmp, `tmux-${uid}`, "default");
    const onTmp = tmux(["list-sessions", "-F", "#{session_name}"], { socket: tmptmpSock });
    assert.notEqual(onTmp.status, 0, `TMUX_TMPDIR socket must have NO server (the default socket won): ${onTmp.stderr}`);
    assert.doesNotMatch(onTmp.stdout ?? "", /leaky/);
  } finally {
    tmux(["kill-server"], { socket: defSock });
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* best-effort */ }
  }
});

test("AC2 承重条 (2): the same scenario THROUGH the library (explicit -S + $TMUX stripped) lands on the PRIVATE socket", { skip: tmuxAvailable ? false : "tmux not installed" }, () => {
  const { tmp, defSock, tmptmp, privSock } = ac2Fixture();
  const inheritedTmux = `${defSock},0,0`;
  try {
    const up = tmux(["new-session", "-d", "-s", "defbase", "sleep", "10000"], { socket: defSock });
    assert.equal(up.status, 0, `stand-in default failed: ${up.stderr}`);

    // The library path: explicit -S + $TMUX stripped (tmuxEnv sets TMUX: undefined). Even though the
    // caller env carries $TMUX, the library must land on the PRIVATE socket.
    const r = tmux(["new-session", "-d", "-s", "isolated", "sleep", "10000"], {
      socket: privSock, env: { TMUX: inheritedTmux },
    });
    assert.equal(r.status, 0, `library new-session failed: ${r.stderr}`);

    const onPriv = tmux(["list-sessions", "-F", "#{session_name}"], { socket: privSock });
    assert.match(onPriv.stdout, /isolated/, `'isolated' must be on the PRIVATE socket:\n${onPriv.stdout}`);
    const onDefault = tmux(["list-sessions", "-F", "#{session_name}"], { socket: defSock });
    assert.doesNotMatch(onDefault.stdout, /isolated/, `'isolated' must NOT reach the default socket:\n${onDefault.stdout}`);
  } finally {
    tmux(["kill-server"], { socket: privSock });
    tmux(["kill-server"], { socket: defSock });
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* best-effort */ }
  }
});

test("AC7: the library's tmux() spawns its own server on a private socket — a kill-server through it leaves an unrelated private server intact", { skip: tmuxAvailable ? false : "tmux not installed" }, () => {
  const { tmp, defSock } = ac2Fixture();
  const victimSock = path.join(tmp, "victim.sock");
  try {
    // A victim server on its own private socket. The session command must stay ALIVE (a `true`
    // that exits immediately would end the session and shut the server down — the one-way-kill
    // assertion needs a live server to survive).
    const v = tmux(["new-session", "-d", "-s", "victim", "sleep", "10000"], { socket: victimSock });
    assert.equal(v.status, 0, v.stderr);
    // The library server on another private socket.
    const s = tmux(["new-session", "-d", "-s", "libserv", "sleep", "10000"], { socket: defSock });
    assert.equal(s.status, 0, s.stderr);

    // ONE-WAY kill through the library on defSock only.
    const k = tmux(["kill-server"], { socket: defSock });
    assert.equal(k.status, 0, k.stderr);

    const victimLs = tmux(["list-sessions", "-F", "#{session_name}"], { socket: victimSock });
    assert.equal(victimLs.status, 0, `victim server must survive the isolated kill-server: ${victimLs.stderr}`);
    assert.match(victimLs.stdout, /victim/);
  } finally {
    tmux(["kill-server"], { socket: victimSock });
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* best-effort */ }
  }
});

} // end governance self-skip else
