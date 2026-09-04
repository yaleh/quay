// @test-group engine
// manager-productization.test.mjs — gap-manager-productization-five-constraints (C1-C5).
//
// Pins the productization mechanics:
//
//   AC1/AC2 — `quay manager start` (no project args; independent session + $QUAY_GLOBAL_DIR/
//             manager/ home). `quay manager adopt <root>` was retired with the outer tmux session
//             (gap-retire-outer-tmux-window-logic) — its three-state outer check no longer exists.
//   AC5/AC5c   — the manager loop anchor arm is sentinel-idempotent: arm twice without knowing any
//                 cron ID ⇒ exactly ONE `[manager-tick]` entry (criteria ①); the negative control
//                 (two duplicates pre-seeded ⇒ converge to one) is criteria ②. The arm validates
//                 that the tick doc carries the sentinel + pointer-only contract (AC5c rule 1/2).
//   AC5b       — manager tick-log persistence: each tick writes a row; manager-tick-log-check.sh
//                 reports "上一轮 tick 没落行" (skip a round ⇒ red).
//   AC6        — covered in session-topology.test.mjs (single-flight lock dual-creator).
//   AC9        — product-side manager behavior (AC10/AC11/boundary) lives in plugin/loop/
//                 manager-loop-tick.md; the tick doc also carries the §6.1/6.2 product behavior.
//
// All tmux work is on a HERMETIC server on a private socket (TMUX_TMPDIR), never the machine's
// real sessions. Cleanup kills each session it started (kill-session, never kill-server).
//
// Run:
//   scripts/test.sh plugin/test/manager-productization.test.mjs
//   node --test plugin/test/manager-productization.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

// STAGE 1/3 (gap-tmux-isolated-guard-has-zero-consumers-fifth-machine-wipe): the hermetic session
// cleanup routes through the tmux-session library so BOTH isolation conditions are structural
// (explicit -S + $TMUX-stripped env).
import { tmux as isolatedTmux } from "../scripts/tmux-session.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pluginDir = path.resolve(__dirname, "..");
const repoRoot = path.resolve(pluginDir, "..");

const MANAGER_START = path.join(pluginDir, "scripts", "manager-start.sh");
const MANAGER_ARM = path.join(pluginDir, "scripts", "manager-arm-loop.sh");
const TICK_LOG_CHECK = path.join(pluginDir, "scripts", "manager-tick-log-check.sh");
const TICK_DOC = path.join(pluginDir, "loop", "manager-loop-tick.md");
const QUAY_CLI = path.join(repoRoot, "packages", "quay", "bin", "quay.ts");

const tmuxAvailable = (() => {
  try { return spawnSync("tmux", ["-V"], { encoding: "utf8" }).status === 0; } catch { return false; }
})();

function makeTmp(prefix = "quay-mgr-") {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}
function cleanup(dir) {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* best-effort */ }
}

// ── AC5/AC5c — sentinel arm idempotence (criteria ① and ②) ─────────────────────────────────────────

test("AC5/AC5c — arm twice without knowing any cron ID ⇒ exactly ONE [manager-tick] entry (criterion ①)", () => {
  const tmp = makeTmp();
  try {
    const store = path.join(tmp, "loop-registry.txt");
    const run = () => spawnSync("bash", [MANAGER_ARM, "--store", store, "--json"], { encoding: "utf8" });
    const a = run();
    assert.equal(a.status, 0, `first arm must exit 0:\n${a.stderr}`);
    const b = run();
    assert.equal(b.status, 0, `second arm must exit 0:\n${b.stderr}`);
    const count = (fs.readFileSync(store, "utf8").match(/\[manager-tick\]/g) || []).length;
    assert.equal(count, 1, `arm twice must leave exactly ONE manager loop (got ${count})`);
  } finally { cleanup(tmp); }
});

test("AC5/AC5c — negative control: two duplicate [manager-tick] entries converge to exactly ONE (criterion ②)", () => {
  const tmp = makeTmp();
  try {
    const store = path.join(tmp, "loop-registry.txt");
    fs.writeFileSync(store, "[manager-tick] dup1\n[manager-tick] dup2\n", "utf8");
    const r = spawnSync("bash", [MANAGER_ARM, "--store", store, "--json"], { encoding: "utf8" });
    assert.equal(r.status, 0, `arm must exit 0 even with duplicates:\n${r.stderr}`);
    const count = (fs.readFileSync(store, "utf8").match(/\[manager-tick\]/g) || []).length;
    assert.equal(count, 1, `arm must converge duplicates to exactly ONE (got ${count})`);
  } finally { cleanup(tmp); }
});

test("AC5c — the arm validates that the manager tick doc carries the sentinel + pointer-only contract", () => {
  const r = spawnSync("bash", [MANAGER_ARM, "--validate"], { encoding: "utf8" });
  assert.equal(r.status, 0, `--validate must pass:\n${r.stdout}\n${r.stderr}`);
  assert.match(r.stdout, /VALIDATE-OK/);
});

// ── AC5b — per-tick state persistence check ───────────────────────────────────────────────────────

test("AC5b — tick-log check: fresh row PASS; skipped round (stale mtime) FAIL; no row FAIL", () => {
  const tmp = makeTmp();
  try {
    const log = path.join(tmp, "manager-tick-log.md");
    fs.writeFileSync(log, "| 时刻 | 动作 |\n|---|---|\n", "utf8");
    // No tick row → FAIL.
    const noRow = spawnSync("bash", [TICK_LOG_CHECK, "--log", log, "--stale-hours", "1"], { encoding: "utf8" });
    assert.equal(noRow.status, 1, `no tick row must FAIL:\n${noRow.stdout}\n${noRow.stderr}`);
    // A fresh tick row (mtime now) → PASS.
    fs.appendFileSync(log, "| 2026-08-07 04:0xZ | no-action |\n", "utf8");
    const fresh = spawnSync("bash", [TICK_LOG_CHECK, "--log", log, "--stale-hours", "1"], { encoding: "utf8" });
    assert.equal(fresh.status, 0, `fresh tick row must PASS:\n${fresh.stdout}\n${fresh.stderr}`);
    // Skip a round: make the log stale → FAIL (negative control).
    const old = new Date(Date.now() - 2 * 24 * 3600 * 1000);
    fs.utimesSync(log, old, old);
    const stale = spawnSync("bash", [TICK_LOG_CHECK, "--log", log, "--stale-hours", "1"], { encoding: "utf8" });
    assert.equal(stale.status, 1, `skipped round must FAIL:\n${stale.stdout}\n${stale.stderr}`);
    assert.match(stale.stdout, /skipped|stale|round was skipped/);
  } finally { cleanup(tmp); }
});

// ── AC9 — product-side manager behavior: shipped driver is a pointer; behavior preserved ───────────
// (gap-plugin-loop-manager-drifted-copies-pointerize, manager 22:1xZ 裁定: plugin/loop/manager-*.md
// are POINTERS — "该路径无内容可维护". The §6 product-behavior section the copy carried is deleted
// from the shipped doc; the AC10/AC11 content is preserved in the phase-goal archive (the moved-out
// historical record) and the boundary discipline in the shipped skill.)

test("AC9 — the shipped manager driver is a pointer to the live 正本; product-side behavior is preserved", () => {
  assert.ok(fs.existsSync(TICK_DOC), "plugin/loop/manager-loop-tick.md must exist (the shipped manager driver)");
  const src = fs.readFileSync(TICK_DOC, "utf8");
  // The shipped manager driver is a POINTER to the live 正本 — no content lives here anymore.
  assert.match(src, /orchestration\/manager-loop-tick\.md/, "the shipped driver must point at the live orchestration 正本");
  // AC10 axis-open (开轴 pre-friction criterion) — preserved in the phase-goal archive.
  const archive = fs.readFileSync(path.join(repoRoot, "orchestration", "manager-phase-goal-archive.md"), "utf8");
  assert.match(archive, /AC10|开轴/, "the AC10 axis-open product behavior must be preserved");
  assert.match(archive, /pre-friction|没被硌到|轴/, "the AC10 criterion must be present");
  // AC11 verification-first (验证先被验证) — preserved in the phase-goal archive.
  assert.match(archive, /AC11|验证先被验证|verification-first/, "the AC11 verification-first product behavior must be preserved");
  // role-boundary discipline (manager must not write .sh/.ts implementations) — in the shipped skill.
  const skill = fs.readFileSync(path.join(pluginDir, "skills", "manager", "SKILL.md"), "utf8");
  assert.match(skill, /越界/, "the boundary-discipline rule must be in the shipped manager skill");
});

// ── AC1/AC2/AC7 — manager start (no project args) + adopt (three-state) ────────────────────────────

test("AC1/C5 — `quay manager start --dry-run` accepts NO project args and plans an independent session + home", () => {
  const r = spawnSync("node", ["--experimental-strip-types", QUAY_CLI, "manager", "start", "--dry-run"], { encoding: "utf8" });
  assert.equal(r.status, 0, `quay manager start --dry-run must exit 0:\n${r.stderr}`);
  assert.match(r.stdout, /would-launch-session/, "must plan launching the manager session");
  assert.match(r.stdout, /would-create-home/, "must plan creating the manager home");
});

test("AC1/C5 — `quay manager start --dry-run` refuses a project arg (start ≠ adopt, two commands separated)", () => {
  const r = spawnSync("node", ["--experimental-strip-types", QUAY_CLI, "manager", "start", "--dry-run", "/some/project"], { encoding: "utf8" });
  assert.equal(r.status, 1, `manager start must refuse project args:\n${r.stdout}\n${r.stderr}`);
  assert.match(r.stderr, /NO project args|manager start|Unknown argument/, "must refuse with a C5-separation message");
});

test("AC2/C2 — manager home/identity is $QUAY_GLOBAL_DIR/manager (out of any project)", { skip: tmuxAvailable ? false : "tmux not installed" }, () => {
  // manager-start.sh with a hermetic home + a harmless launch override (no real claude, no real
  // tmux session on the machine's default server — hermetic TMUX_TMPDIR).
  const tmp = makeTmp();
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
    assert.ok(fs.existsSync(path.join(home, "identity")), "must create the manager identity file in $QUAY_GLOBAL_DIR/manager/");
    const identity = fs.readFileSync(path.join(home, "identity"), "utf8");
    assert.match(identity, /role=manager/, "identity must declare role=manager");
    // Cleanup the hermetic session.
    const sess = (identity.match(/session=(\S+)/) || [])[1] || "quay-manager";
    isolatedTmux(["kill-session", "-t", sess], { socket: path.join(socketBase, "default"), env });
  } finally { cleanup(tmp); }
});
