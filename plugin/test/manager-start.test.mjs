// @test-group engine
// manager-start.test.mjs — gap-manager-cold-start-no-falsifiable-checklist (AC2/AC4/AC5)
//                          + gap-manager-start-tmux-session-name-not-path-derived (AC1/AC2).
//
// Pins the manager-start.sh cold-start falsifiable checklist:
//   AC2  — manager-start.sh writes <home>/cold-start-checklist.md (5 observable-consequence keys).
//          The idle-watch observation seam was retired 2026-09-03 with the session-liveness
//          mechanism (7 keys → 5 keys; IDLE-WATCH-MOUNTED / MONITORS-DELIVERING dropped).
//   AC5  — existing behavior unregressed: dry-run plans home/identity/session/arm plus the checklist
//          write; a real start still creates identity + loop-registry + the checklist.
//
// Pins the session-name derivation + ownership check (third block below):
//   AC1  — the DEFAULT session name is derived from the repo ROOT PATH: two different roots (both
//          basenamed "quay" — the collision case) get two different names; the same root is stable.
//   AC2  — an existing session at that name is reused ONLY when its recorded owner (@quay_manager_root)
//          is this root; a foreign owner, or an unrecorded owner under a DERIVED name, is refused
//          fail-closed with the --session escape hatch named in the message.
//
// Hermetic tmux only where a real start is exercised (TMUX_TMPDIR, never the machine's sessions);
// the dry-run test needs no tmux.
//
// Run:
//   node --test plugin/test/manager-start.test.mjs

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
const MANAGER_START = path.join(pluginDir, "scripts", "manager-start.sh");

const tmuxAvailable = (() => {
  try { return spawnSync("tmux", ["-V"], { encoding: "utf8" }).status === 0; } catch { return false; }
})();

/** The 5 observable-consequence keys the cold-start checklist must carry. */
const FIVE_KEYS = [
  "SESSION-CREATED",
  "HOME-CREATED",
  "LOOP-ARMED",
  "CRON-EVIDENCED",
  "CHECKLIST-REPORTED",
];

// ── AC2 — dry-run plans the falsifiable checklist artifact (no tmux needed) ────────────────────────

test("AC2 — manager-start --dry-run plans the cold-start checklist", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "quay-mgr-start-"));
  try {
    const r = spawnSync("bash", [MANAGER_START, "--dry-run", "--home", path.join(tmp, "home")], { encoding: "utf8" });
    assert.equal(r.status, 0, `dry-run must exit 0:\n${r.stdout}\n${r.stderr}`);
    assert.match(r.stdout, /would-write-checklist/, "must plan writing <home>/cold-start-checklist.md");
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});

// ── AC2/AC5 — a real start writes the checklist (5 keys), unregressed ─────────────────────────────

test("AC2/AC5 — a real manager-start writes cold-start-checklist.md (5 keys) and still creates identity + loop-registry",
  { skip: tmuxAvailable ? false : "tmux not installed" }, () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "quay-mgr-start-"));
  try {
    const sockDir = path.join(tmp, "sock");
    const socketBase = path.join(sockDir, `tmux-${process.getuid()}`);
    fs.mkdirSync(socketBase, { recursive: true, mode: 0o700 });
    const env = { ...process.env, TMUX_TMPDIR: sockDir };
    delete env.TMUX;
    const home = path.join(tmp, "manager-home");
    const r = spawnSync("bash", [MANAGER_START, "--home", home], {
      encoding: "utf8",
      env: { ...env, MANAGER_LAUNCH_CMD: "bash -c 'exec -a claude-probe sleep 10000 & wait'" },
    });
    assert.equal(r.status, 0, `manager start must exit 0:\n${r.stdout}\n${r.stderr}`);

    // AC2 — the cold-start checklist carries all 5 falsifiable keys.
    const checklist = path.join(home, "cold-start-checklist.md");
    assert.ok(fs.existsSync(checklist), "must write <home>/cold-start-checklist.md");
    const content = fs.readFileSync(checklist, "utf8");
    for (const key of FIVE_KEYS) {
      assert.match(content, new RegExp(key), `checklist must carry key ${key}`);
    }
    // AC5 — the retired idle-watch seam is gone: no idle-watch.env, no idle-watch-mount.txt.
    assert.ok(!fs.existsSync(path.join(home, "idle-watch.env")), "must NOT write idle-watch.env (retired)");
    assert.ok(!fs.existsSync(path.join(home, "idle-watch-mount.txt")), "must NOT write idle-watch-mount.txt (retired)");

    // AC5 — existing behavior unregressed.
    assert.ok(fs.existsSync(path.join(home, "identity")), "must still create identity");
    assert.ok(fs.existsSync(path.join(home, "loop-registry.txt")), "must still arm the loop registry");

    // Cleanup the hermetic session (kill-session, never kill-server).
    const identity = fs.readFileSync(path.join(home, "identity"), "utf8");
    const sess = (identity.match(/session=(\S+)/) || [])[1] || "quay-manager";
    isolatedTmux(["kill-session", "-t", sess], { socket: path.join(socketBase, "default"), env });
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});

// ══ gap-manager-start-tmux-session-name-not-path-derived — AC1 / AC2 ═══════════════════════════════
//
// The old default was the literal `quay-manager`: two checkouts BOTH named "quay" fighting over ONE
// shared tmux server would collide, and the later starter silently attached to the earlier one's
// session. The name is now derived from the repo ROOT PATH and the session carries an ownership
// record (@quay_manager_root) that is checked before any reuse.

/** A hermetic tmux server (private socket under TMUX_TMPDIR; never the machine's sessions). */
function hermeticTmux(tmp) {
  const sockDir = path.join(tmp, "sock");
  const socketBase = path.join(sockDir, `tmux-${process.getuid()}`);
  fs.mkdirSync(socketBase, { recursive: true, mode: 0o700 }); // tmux refuses an unsafe-perms dir
  const socket = path.join(socketBase, "default");
  const env = { ...process.env, TMUX_TMPDIR: sockDir };
  delete env.TMUX; // $TMUX overrides TMUX_TMPDIR — isolation needs BOTH (tmux-session.ts)
  return { env, socket };
}

/** The arm step is `bash <ARM_CMD> --home <dir>`; a no-op keeps these tests off cron/registry state. */
function noopArmScript(tmp) {
  const p = path.join(tmp, "noop-arm.sh");
  fs.writeFileSync(p, "exit 0\n");
  return p;
}

/** Run manager-start.sh as if it lived in `root` (MANAGER_START_REPO_ROOT test seam). */
function runManagerStart(root, tmp, env, args) {
  return spawnSync("bash", [MANAGER_START, ...args], {
    encoding: "utf8",
    env: {
      ...env,
      MANAGER_START_REPO_ROOT: root,
      MANAGER_ARM_CMD: noopArmScript(tmp),
      MANAGER_LAUNCH_CMD: "sleep 300", // a real start must leave a live pane to kill/settle
    },
  });
}

/** The session name manager-start.sh would use for `root` (dry-run prints it; needs no tmux). */
function derivedSessionName(root, tmp, env) {
  const r = runManagerStart(root, tmp, env, ["--dry-run"]);
  assert.equal(r.status, 0, `--dry-run must exit 0:\n${r.stdout}\n${r.stderr}`);
  const m = r.stdout.match(/would-launch-session: tmux new-session -d -s (\S+)/);
  assert.ok(m, `dry-run must print the session name, got:\n${r.stdout}`);
  return m[1];
}

function sessionOwner(socket, sess, env) {
  return isolatedTmux(["show-options", "-t", sess, "-v", "@quay_manager_root"], { socket, env }).stdout.trim();
}

// ── AC1 — the default name is derived from the ROOT PATH, not the project name ─────────────────────

test("AC1 — default session name is derived from the repo root path (two roots basenamed 'quay' ⇒ two names)", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "quay-mgr-name-"));
  try {
    // Both roots are literally named "quay" — the collision the old literal constant caused.
    const rootA = path.join(tmp, "clone-a", "quay");
    const rootB = path.join(tmp, "clone-b", "quay");
    fs.mkdirSync(rootA, { recursive: true });
    fs.mkdirSync(rootB, { recursive: true });
    const env = { ...process.env };

    const a1 = derivedSessionName(rootA, tmp, env);
    const a2 = derivedSessionName(rootA, tmp, env);
    const b = derivedSessionName(rootB, tmp, env);

    assert.equal(a1, a2, "the same root must derive the SAME name (otherwise has-session can never address it)");
    assert.notEqual(a1, b, "two different roots must derive two different names");
    assert.notEqual(a1, "quay-manager", "must not be the old literal constant (that is the defect)");
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});

// ── AC2 — an existing same-named session is reused only when it is provably THIS root's ────────────

test("AC2 — a same-named session owned by another root is refused fail-closed (never silently adopted)",
  { skip: tmuxAvailable ? false : "tmux not installed" }, () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "quay-mgr-own-"));
  try {
    const { env, socket } = hermeticTmux(tmp);
    const rootA = path.join(tmp, "clone-a", "quay");
    const rootB = path.join(tmp, "clone-b", "quay");
    fs.mkdirSync(rootA, { recursive: true });
    fs.mkdirSync(rootB, { recursive: true });
    const home = path.join(tmp, "manager-home");
    const name = derivedSessionName(rootA, tmp, env);

    // A session sits at rootA's derived name but is owned by rootB (the other checkout).
    isolatedTmux(["new-session", "-d", "-s", name, "-c", rootA, "sleep 300"], { socket, env });
    isolatedTmux(["set-option", "-t", name, "@quay_manager_root", rootB], { socket, env });
    try {
      const foreign = runManagerStart(rootA, tmp, env, ["--home", home, "--json"]);
      assert.notEqual(foreign.status, 0, `a foreign session must NOT be adopted:\n${foreign.stdout}`);
      assert.match(foreign.stderr, /NOT owned by this repo root/, "must report the ownership mismatch");
      assert.match(foreign.stderr, /--session/, "must name the explicit --session escape hatch (AC2)");
      assert.match(foreign.stderr, /clone-b/, "must show the actual owner (rootB) for triage");

      // Ownership record REMOVED: under a DERIVED name an unrecorded session is NOT evidence of
      // ownership — "could not read the owner" must not share an output with "the owner is me".
      isolatedTmux(["set-option", "-u", "-t", name, "@quay_manager_root"], { socket, env });
      const unrecorded = runManagerStart(rootA, tmp, env, ["--home", home, "--json"]);
      assert.notEqual(unrecorded.status, 0, `an unrecorded session at a derived name must be refused:\n${unrecorded.stdout}`);
      assert.match(unrecorded.stderr, /no @quay_manager_root record/, "must say the owner is unrecorded, not that it matched");

      // Recorded as THIS root ⇒ reuse (idempotent), never a rebuild.
      isolatedTmux(["set-option", "-t", name, "@quay_manager_root", rootA], { socket, env });
      const mine = runManagerStart(rootA, tmp, env, ["--home", home, "--json"]);
      assert.equal(mine.status, 0, `this root's own session must be reused:\n${mine.stdout}\n${mine.stderr}`);
      assert.match(mine.stdout, /"sessionState":"in-place"/, "must reuse, not recreate");
      assert.match(mine.stdout, /"created":false/, "must not report a new session");

      // Explicit --session keeps the historical semantics (an explicitly named target is the caller's
      // choice) — this is the escape hatch the fail-closed message points at.
      isolatedTmux(["set-option", "-u", "-t", name, "@quay_manager_root"], { socket, env });
      const explicit = runManagerStart(rootA, tmp, env, ["--session", name, "--home", home, "--json"]);
      assert.equal(explicit.status, 0, `explicit --session must still adopt:\n${explicit.stdout}\n${explicit.stderr}`);
      assert.match(explicit.stdout, /"sessionState":"in-place"/);
    } finally {
      isolatedTmux(["kill-session", "-t", name], { socket, env });
    }
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});

// ── AC1/AC2/DoD — two roots' REAL cold starts on ONE shared server stay distinct ───────────────────

test("AC1/AC2/DoD — two roots doing a real cold start on ONE tmux server get two distinct sessions",
  { skip: tmuxAvailable ? false : "tmux not installed" }, () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "quay-mgr-dod-"));
  try {
    const { env, socket } = hermeticTmux(tmp);
    const rootA = path.join(tmp, "clone-a", "quay");
    const rootB = path.join(tmp, "clone-b", "quay");
    fs.mkdirSync(rootA, { recursive: true });
    fs.mkdirSync(rootB, { recursive: true });
    const homeA = path.join(tmp, "home-a");
    const homeB = path.join(tmp, "home-b");

    const a = runManagerStart(rootA, tmp, env, ["--home", homeA, "--json"]);
    assert.equal(a.status, 0, `root A cold start must succeed:\n${a.stdout}\n${a.stderr}`);
    assert.match(a.stdout, /"created":true/);
    const b = runManagerStart(rootB, tmp, env, ["--home", homeB, "--json"]);
    assert.equal(b.status, 0, `root B cold start must succeed:\n${b.stdout}\n${b.stderr}`);
    assert.match(b.stdout, /"created":true/, "root B must CREATE (never silently adopt root A's session)");

    const sessA = JSON.parse(a.stdout).session;
    const sessB = JSON.parse(b.stdout).session;
    try {
      assert.notEqual(sessA, sessB, "two roots on one server must not share a session name");
      assert.equal(sessionOwner(socket, sessA, env), rootA, "each session must record its OWN root");
      assert.equal(sessionOwner(socket, sessB, env), rootB, "each session must record its OWN root");
    } finally {
      isolatedTmux(["kill-session", "-t", sessA], { socket, env });
      isolatedTmux(["kill-session", "-t", sessB], { socket, env });
    }
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});
