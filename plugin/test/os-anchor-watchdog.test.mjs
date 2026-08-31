// @test-group engine
// os-anchor-watchdog.test.mjs — tasks/gap-loop-has-no-os-level-anchor-cannot-self-recover-after-crash, AC7.
//
// The watchdog (plugin/scripts/os-anchor-watchdog.sh) is the OS-level anchor that outlives any
// Claude session: a systemd user timer fires it, it checks each project's session liveness and
// re-spawns a dead session + drives the cold-start text. This file tests the pure decision seam
// (--decide) and the installer's idempotency seams — the trigger/re-spawn logic itself is
// exercised by the real-run AC2 verification (crash simulation in a throwaway tmux session).
//
// Coverage map (task ACs):
//   AC7 — node:test + // @test-group engine.
//   AC1 — install seam: OS_ANCHOR_SKIP_SYSTEMCTL=1 writes timer/service/config idempotently.
//   AC2/decide — the decision matrix that drives auto-recovery.

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../..");
const WATCHDOG = path.join(REPO_ROOT, "plugin/scripts/os-anchor-watchdog.sh");
const INSTALLER = path.join(REPO_ROOT, "plugin/scripts/os-anchor-install.sh");

function decide(alive, session, halted) {
  return execFileSync("bash", [WATCHDOG, "--decide", alive, String(session), String(halted)], {
    encoding: "utf8",
  }).trim();
}

test("AC2/decide — decision matrix drives auto-recovery (pure seam)", () => {
  // halted project (parked via .halt) — never fight it
  assert.equal(decide("1", 1, 1), "halted");
  assert.equal(decide("0", 0, 1), "halted");
  // alive → noop (healthy, nothing to do)
  assert.equal(decide("1", 1, 0), "noop");
  assert.equal(decide("1", 0, 0), "noop");
  // unverifiable measurement — NEVER double-spawn on a broken measurement
  assert.equal(decide("unknown", 1, 0), "skip-unverifiable");
  assert.equal(decide("unknown", 0, 0), "skip-unverifiable");
  // session up but outer claude dead → relaunch-outer
  assert.equal(decide("0", 1, 0), "relaunch-outer");
  // session itself gone → recreate-session
  assert.equal(decide("0", 0, 0), "recreate-session");
});

test("AC1/install — idempotent installer writes timer/service/config (hermetic seam)", () => {
  const installDir = fs.mkdtempSync(path.join(os.tmpdir(), "oaw-install-"));
  const systemdDir = fs.mkdtempSync(path.join(os.tmpdir(), "oaw-systemd-"));
  const env = {
    ...process.env,
    OS_ANCHOR_INSTALL_DIR: installDir,
    OS_ANCHOR_SYSTEMD_USER_DIR: systemdDir,
    OS_ANCHOR_SKIP_SYSTEMCTL: "1",
  };
  try {
    // install twice — idempotent (no duplicates)
    execFileSync("bash", [INSTALLER, "install"], { env, encoding: "utf8" });
    execFileSync("bash", [INSTALLER, "install"], { env, encoding: "utf8" });

    const timer = path.join(systemdDir, "quay-os-anchor-watchdog.timer");
    const service = path.join(systemdDir, "quay-os-anchor-watchdog.service");
    const config = path.join(installDir, "os-anchor-projects.conf");
    const watchdogCopy = path.join(installDir, "os-anchor-watchdog.sh");

    assert.ok(fs.existsSync(timer), "timer unit written");
    assert.ok(fs.existsSync(service), "service unit written");
    assert.ok(fs.existsSync(config), "projects config written");
    assert.ok(fs.existsSync(watchdogCopy), "watchdog copied to install dir");

    // config has the invoking repo (whatever its basename — a git worktree's root differs from
    // the main checkout, so the name must be derived, never hardcoded to the checkout's basename)
    // with a session + drive text
    const conf = fs.readFileSync(config, "utf8");
    const repoName = path.basename(REPO_ROOT);
    assert.match(conf, new RegExp(`${repoName}\\|`), `config includes the invoking project (${repoName})`);
    assert.match(conf, /\|outer\|/, "config carries the outer-window column");

    // no duplicate timer/service files from the second install
    const files = fs.readdirSync(systemdDir).filter((f) => f.includes("os-anchor"));
    assert.equal(files.length, 2, "exactly one timer + one service unit");
  } finally {
    fs.rmSync(installDir, { recursive: true, force: true });
    fs.rmSync(systemdDir, { recursive: true, force: true });
  }
});
