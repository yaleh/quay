// @test-group engine
// manager-start.test.mjs — gap-manager-cold-start-no-falsifiable-checklist (AC2/AC4/AC5).
//
// Pins the manager-start.sh cold-start falsifiable checklist:
//   AC2  — manager-start.sh writes <home>/cold-start-checklist.md (7 observable-consequence keys,
//          aligned with outer's 7) + <home>/idle-watch.env (the manager's own idle-watch observation
//          config — defect-1 fix: the deterministic anchor the first tick mounts via
//          session-liveness-mount.sh + Monitor, never a non-existent standalone script).
//   AC5  — existing behavior unregressed: dry-run plans home/identity/session/arm plus the two new
//          checklist writes; a real start still creates identity + loop-registry + the checklist.
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

/** The 7 observable-consequence keys the cold-start checklist must carry (aligned with outer's 7). */
const SEVEN_KEYS = [
  "SESSION-CREATED",
  "HOME-CREATED",
  "LOOP-ARMED",
  "CRON-EVIDENCED",
  "IDLE-WATCH-MOUNTED",
  "MONITORS-DELIVERING",
  "CHECKLIST-REPORTED",
];

// ── AC2 — dry-run plans the two new falsifiable artifacts (no tmux needed) ──────────────────────────

test("AC2 — manager-start --dry-run plans the cold-start checklist + idle-watch config", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "quay-mgr-start-"));
  try {
    const r = spawnSync("bash", [MANAGER_START, "--dry-run", "--home", path.join(tmp, "home")], { encoding: "utf8" });
    assert.equal(r.status, 0, `dry-run must exit 0:\n${r.stdout}\n${r.stderr}`);
    assert.match(r.stdout, /would-write-checklist/, "must plan writing <home>/cold-start-checklist.md");
    assert.match(r.stdout, /would-write-idlewatch-config/, "must plan writing <home>/idle-watch.env");
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});

// ── AC2/AC5 — a real start writes the checklist (7 keys) + idle-watch config, unregressed ──────────

test("AC2/AC5 — a real manager-start writes cold-start-checklist.md (7 keys) + idle-watch.env and still creates identity + loop-registry",
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

    // AC2 — the cold-start checklist carries all 7 falsifiable keys.
    const checklist = path.join(home, "cold-start-checklist.md");
    assert.ok(fs.existsSync(checklist), "must write <home>/cold-start-checklist.md");
    const content = fs.readFileSync(checklist, "utf8");
    for (const key of SEVEN_KEYS) {
      assert.match(content, new RegExp(key), `checklist must carry key ${key}`);
    }
    // The idle-watch config names the REAL mechanism (session-liveness-mount.sh + threshold).
    const iwPath = path.join(home, "idle-watch.env");
    assert.ok(fs.existsSync(iwPath), "must write <home>/idle-watch.env");
    const iw = fs.readFileSync(iwPath, "utf8");
    assert.match(iw, /session-liveness-mount\.sh/, "idle-watch config must name the real mount mechanism");
    assert.match(iw, /IDLE_WATCH_THRESHOLD_MIN=6/, "idle-watch config must carry the 6-minute threshold");

    // AC5 — existing behavior unregressed.
    assert.ok(fs.existsSync(path.join(home, "identity")), "must still create identity");
    assert.ok(fs.existsSync(path.join(home, "loop-registry.txt")), "must still arm the loop registry");

    // Cleanup the hermetic session (kill-session, never kill-server).
    const identity = fs.readFileSync(path.join(home, "identity"), "utf8");
    const sess = (identity.match(/session=(\S+)/) || [])[1] || "quay-manager";
    isolatedTmux(["kill-session", "-t", sess], { socket: path.join(socketBase, "default"), env });
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});
