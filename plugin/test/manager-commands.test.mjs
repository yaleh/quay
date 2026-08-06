// @test-group product
// manager-commands.test.mjs — gap-manager-productization-five-constraints, AC1/AC2/AC3/AC5/AC6/AC7.
//
// Pins the manager productization mechanisms per SPEC-manager-productization-2026-08-05:
//
//   AC1 (C4/C5) — `quay manager start` (independent cold start, NO project args) + `quay manager
//                 adopt <root>` whose three-state verdict REUSES inner-session-check.sh (no second
//                 copy). C4: a positional arg to `manager start` is a hard usage error.
//   AC2 (C2)    — the manager's home/identity is OUTSIDE any project: $QUAY_GLOBAL_DIR/manager/
//                 (MANAGER_HOME), an independent tmux session name (quay-manager), and its OWN
//                 systemd unit (quay-manager-watchdog.{timer,service}) separate from the project
//                 os-anchor watchdog (quay-os-anchor-watchdog).
//   AC3 (C1)    — the manager implementation ships under plugin/scripts/ (the plugin is the
//                 distribution; publish-dist-branch.sh publishes the whole plugin subtree).
//   AC5 (§2.1)  — the manager's OWN systemd unit is installed by `manager start` (separate from
//                 the project watchdog) — the persistent-anchor mechanism (live kill not tested
//                 here; the pure decision seam manager-watchdog.sh --decide is).
//   AC6 (①)     — quay-topology.sh single-flight creation lock: acquire/release semantics and the
//                 atomic wx-create (concurrent double-create tested in session-topology.test.mjs /
//                 the lock seam here).
//   AC7 (C5)    — after `manager adopt`, the manager's action count for that project is 0
//                 (operational definition: the actions log holds exactly one adopt-register event,
//                 zero other events).
//
// All tmux/systemd work is hermetic: MANAGER_SKIP_TMUX=1 / MANAGER_SKIP_SYSTEMCTL=1 + temp
// MANAGER_HOME / MANAGER_INSTALL_DIR / MANAGER_SYSTEMD_USER_DIR / TOPOLOGY_LOCK_DIR. No live
// session is created or killed.
//
// Run:
//   scripts/test.sh plugin/test/manager-commands.test.mjs
//   node --test plugin/test/manager-commands.test.mjs

import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync, spawn } from "node:child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pluginDir = path.resolve(__dirname, "..");

const START = path.join(pluginDir, "scripts", "manager-start.sh");
const ADOPT = path.join(pluginDir, "scripts", "manager-adopt.sh");
const WATCHDOG = path.join(pluginDir, "scripts", "manager-watchdog.sh");
const TOPOLOGY = path.join(pluginDir, "scripts", "quay-topology.sh");
const INNER_CHECK = path.join(pluginDir, "scripts", "inner-session-check.sh");

// R6 carrier-array cleanup (document-store pattern): every mkdtemp'd dir is pushed into
// _tmpDirs and removed by the after() hook — no tmpdir leak (test-isolation R6 ratchet).
const _tmpDirs = [];
after(() => {
  for (const d of _tmpDirs) fs.rmSync(d, { recursive: true, force: true });
});

function run(args, opts = {}) {
  const r = spawnSync("bash", [args[0], ...args.slice(1)], {
    encoding: "utf8",
    cwd: pluginDir,
    env: { ...process.env, ...opts.env },
  });
  return r;
}

function makeTmp(prefix = "quay-mgr-") {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  _tmpDirs.push(d);
  return d;
}

// A fake quay-init'd project root for adopt tests (must have plugin/scripts + a session env).
function fakeProjectRoot() {
  const root = path.join(makeTmp("quay-adopt-proj-"), "meta-cc");
  fs.mkdirSync(path.join(root, "plugin", "scripts"), { recursive: true });
  fs.mkdirSync(path.join(root, "orchestration"), { recursive: true });
  fs.writeFileSync(path.join(root, "orchestration", "session-liveness.env"), "SESSION_TMUX_SESSION=meta-cc-4\n");
  return root;
}

// ── AC1/C4: `manager start` rejects project args ───────────────────────────────────────────────────
test("AC1/C4 — manager start accepts NO project arguments (hard usage error, SPEC C4/C5)", () => {
  const r = run([START, "/home/yale/work/quay"]);
  assert.equal(r.status, 2, `manager start with a project arg must exit 2, got ${r.status}: ${r.stderr}`);
  assert.match(r.stderr, /NO project arguments/, `stderr must name the C4/C5 violation, got: ${r.stderr}`);
});

test("AC1/C4 — manager start --dry-run produces 'quay-manager' + 'started' output (Contract measure surface)", () => {
  const r = run([START, "--dry-run"], { env: { MANAGER_HOME: makeTmp() } });
  assert.equal(r.status, 0, `--dry-run must exit 0, got ${r.status}: ${r.stderr}`);
  const out = r.stdout + r.stderr;
  assert.match(out, /quay-manager/, `output must mention the manager session, got: ${out}`);
  assert.match(out, /started/, `output must mention started, got: ${out}`);
  assert.match(r.stdout, /would-create-home/, `--dry-run must print the home plan`);
});

// ── AC2/C2: the manager home/identity is OUTSIDE any project ───────────────────────────────────────
test("AC2/C2 — manager start creates $QUAY_GLOBAL_DIR/manager/ home (outside the project) + observer + action log", () => {
  const home = path.join(makeTmp(), "manager");
  const r = run([START], {
    env: {
      MANAGER_HOME: home,
      MANAGER_SKIP_TMUX: "1",
      MANAGER_SKIP_SYSTEMCTL: "1",
      MANAGER_INSTALL_DIR: makeTmp(),
      MANAGER_SYSTEMD_USER_DIR: makeTmp(),
    },
  });
  assert.equal(r.status, 0, `manager start (hermetic) must exit 0, got ${r.status}: ${r.stderr}`);
  assert.ok(fs.existsSync(path.join(home, "observer.conf")), "observer.conf must be mounted by the start flow");
  assert.ok(fs.existsSync(path.join(home, "actions.jsonl")), "actions.jsonl must be initialized");
  const obs = fs.readFileSync(path.join(home, "observer.conf"), "utf8");
  assert.match(obs, /quay-manager/, "observer config must carry the independent session name (C2 identity)");
  assert.match(obs, /systemd-timer/, "the heartbeat must be a non-session-scoped systemd timer (SPEC §2.1)");
});

test("AC2/AC5 — manager start installs its OWN systemd unit, SEPARATE from the project os-anchor watchdog", () => {
  const sysDir = path.join(makeTmp(), "systemd-user");
  const r = run([START], {
    env: {
      MANAGER_HOME: path.join(makeTmp(), "manager"),
      MANAGER_SKIP_TMUX: "1",
      MANAGER_SKIP_SYSTEMCTL: "1",
      MANAGER_INSTALL_DIR: path.join(makeTmp(), "install"),
      MANAGER_SYSTEMD_USER_DIR: sysDir,
    },
  });
  assert.equal(r.status, 0, `manager start (hermetic) must exit 0, got ${r.status}: ${r.stderr}`);
  assert.ok(fs.existsSync(path.join(sysDir, "quay-manager-watchdog.service")), "manager's OWN service unit must be written");
  assert.ok(fs.existsSync(path.join(sysDir, "quay-manager-watchdog.timer")), "manager's OWN timer unit must be written");
  const svc = fs.readFileSync(path.join(sysDir, "quay-manager-watchdog.service"), "utf8");
  assert.match(svc, /manager-watchdog\.sh/, "the manager unit must fire the manager watchdog (re-spawn path)");
  // Separation from the project watchdog: the project's unit name is quay-os-anchor-watchdog;
  // the manager writes ONLY its own unit.
  assert.ok(!fs.existsSync(path.join(sysDir, "quay-os-anchor-watchdog.service")),
    "manager start must NOT touch the project os-anchor unit (separate unit per AC5/SPEC §6)");
});

test("AC2 — manager start --status reports home/session/unit without mutating", () => {
  const r = run([START, "--status"], { env: { MANAGER_HOME: makeTmp(), MANAGER_SKIP_TMUX: "1", MANAGER_SKIP_SYSTEMCTL: "1" } });
  assert.equal(r.status, 0, `--status must exit 0, got ${r.status}: ${r.stderr}`);
  assert.match(r.stdout, /home:/, "--status must report the home");
});

// ── AC3/C1: the manager ships under plugin/scripts/ ────────────────────────────────────────────────
test("AC3/C1 — the manager implementation ships under plugin/scripts/ (the plugin distribution)", () => {
  for (const f of ["manager-start.sh", "manager-adopt.sh", "manager-watchdog.sh"]) {
    assert.ok(fs.existsSync(path.join(pluginDir, "scripts", f)), `plugin/scripts/${f} must exist (C1 — ships with the plugin)`);
    const src = fs.readFileSync(path.join(pluginDir, "scripts", f), "utf8");
    assert.ok(src.trim().length > 500, `plugin/scripts/${f} must be a real implementation, not a stub`);
  }
});

// ── AC1: `manager adopt` reuses inner-session-check.sh (no second verdict copy) ────────────────────
test("AC1 — manager adopt REUSES inner-session-check.sh (no second copy of the three-state verdict)", () => {
  assert.ok(fs.existsSync(INNER_CHECK), "inner-session-check.sh must exist (the reused verdict source)");
  const adopt = fs.readFileSync(ADOPT, "utf8");
  assert.match(adopt, /inner-session-check\.sh/, "manager-adopt.sh must invoke inner-session-check.sh, not reimplement the verdict");
});

test("AC1/C5 — manager adopt requires exactly one <project-root>", () => {
  const noArg = run([ADOPT]);
  assert.equal(noArg.status, 2, "adopt with no args must exit 2 (usage)");
  assert.match(noArg.stderr, /requires exactly one/, `stderr must say exactly-one-root, got: ${noArg.stderr}`);
  const twoArg = run([ADOPT, "/a", "/b"]);
  assert.equal(twoArg.status, 2, "adopt with two roots must exit 2 (usage)");
  assert.match(twoArg.stderr, /exactly ONE/, `stderr must reject extra roots, got: ${twoArg.stderr}`);
});

test("AC1 — manager adopt (missing project, hermetic) plans to call quay-topology.sh + register", () => {
  const root = fakeProjectRoot();
  const r = run([ADOPT, root, "--dry-run"], { env: { MANAGER_HOME: path.join(makeTmp(), "manager"), MANAGER_SKIP_TMUX: "1", ADOPT_OVERRIDE_STATE: "missing" } });
  assert.equal(r.status, 0, `adopt --dry-run must exit 0, got ${r.status}: ${r.stderr}`);
  const out = r.stdout + r.stderr;
  assert.match(out, /quay-topology\.sh/, `missing ⇒ must plan the two-window factory call, got: ${out}`);
  assert.match(out, /would-register/, `adopt must plan a registry write, got: ${out}`);
});

test("AC1 — manager adopt three-state branches (override seam): healthy→noop / empty-shell→drive-not-rebuild / degraded→fail-closed", () => {
  const root = fakeProjectRoot();
  const env = { MANAGER_HOME: path.join(makeTmp(), "manager"), MANAGER_SKIP_TMUX: "1", MANAGER_SKIP_SYSTEMCTL: "1" };
  const healthy = run([ADOPT, root, "--dry-run"], { env: { ...env, ADOPT_OVERRIDE_STATE: "healthy" } });
  assert.equal(healthy.status, 0);
  assert.match(healthy.stdout + healthy.stderr, /noop/, "healthy ⇒ noop (may have been built by someone else)");
  const empty = run([ADOPT, root, "--dry-run"], { env: { ...env, ADOPT_OVERRIDE_STATE: "empty-shell" } });
  assert.equal(empty.status, 0);
  assert.match(empty.stdout + empty.stderr, /drive-not-rebuild/, "empty-shell ⇒ drive-not-rebuild (never rebuild)");
  const degraded = run([ADOPT, root], { env: { ...env, ADOPT_OVERRIDE_STATE: "degraded" } });
  assert.equal(degraded.status, 1, "degraded ⇒ fail-closed (never guess)");
  assert.match(degraded.stderr, /DEGRADED/, "degraded stderr must name the fail-closed state");
});

// ── AC7/C5: adopt-after manager actions on the project = 0 ─────────────────────────────────────────
test("AC7 — after `manager adopt`, the manager's action log for that project has exactly ONE adopt-register event and ZERO other events", () => {
  const root = fakeProjectRoot();
  const home = path.join(makeTmp(), "manager");
  const r = run([ADOPT, root], {
    env: { MANAGER_HOME: home, MANAGER_SKIP_TMUX: "1", MANAGER_SKIP_SYSTEMCTL: "1", ADOPT_OVERRIDE_STATE: "missing" },
  });
  assert.equal(r.status, 0, `adopt (hermetic) must exit 0, got ${r.status}: ${r.stderr}`);
  const logPath = path.join(home, "actions.jsonl");
  assert.ok(fs.existsSync(logPath), "actions.jsonl must exist after adopt");
  const lines = fs.readFileSync(logPath, "utf8").trim().split("\n").filter(Boolean);
  const projectName = path.basename(root);
  const projLines = lines.filter((l) => l.includes(`"project":"${projectName}"`));
  const adoptRegistrations = projLines.filter((l) => l.includes('"action":"adopt-register"'));
  const otherActions = projLines.filter((l) => !l.includes('"action":"adopt-register"'));
  assert.equal(adoptRegistrations.length, 1, `exactly one adopt-register event expected, got ${adoptRegistrations.length}`);
  assert.equal(otherActions.length, 0, `adopt-after manager actions on the project must be 0 (AC7), got: ${JSON.stringify(otherActions)}`);
});

// ── AC5: manager-watchdog.sh pure decision seam ────────────────────────────────────────────────────
test("AC5 — manager-watchdog.sh --decide: noop / relaunch / recreate / skip-unverifiable", () => {
  const cases = [
    { args: ["1", "1"], want: "noop" },
    { args: ["0", "1"], want: "relaunch" },
    { args: ["0", "0"], want: "recreate" },
    { args: ["unknown", "1"], want: "skip-unverifiable" },
  ];
  for (const c of cases) {
    const r = run([WATCHDOG, "--decide", ...c.args]);
    assert.equal(r.status, 0, `--decide ${c.args} must exit 0`);
    assert.equal(r.stdout.trim(), c.want, `--decide ${c.args} must print ${c.want}`);
  }
});

test("AC5 — manager-watchdog.sh is executable and shipped (the manager's own re-spawn anchor)", () => {
  const r = run([WATCHDOG, "--help"]);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /manager-watchdog/, "--help must name the manager watchdog");
});

// ── AC6: quay-topology.sh single-flight lock (atomic wx-create seam) ───────────────────────────────
test("AC6 — quay-topology.sh carries the single-flight lock (acquire/release, atomic wx-create)", () => {
  const topo = fs.readFileSync(TOPOLOGY, "utf8");
  assert.match(topo, /topology_lock_acquire/, "quay-topology.sh must define the single-flight lock acquire");
  assert.match(topo, /noclobber/, "the lock must use the atomic wx-create grant (noclobber redirect)");
  assert.match(topo, /topology_lock_release/, "quay-topology.sh must release the lock");
  assert.match(topo, /TOPOLOGY_LOCK_DIR/, "the lock dir must be overridable (test seam)");
});

const tmuxAvailable = (() => {
  try { return spawnSync("tmux", ["-V"], { encoding: "utf8" }).status === 0; } catch { return false; }
})();

function runAsync(cmd, args, opts) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, opts);
    let out = "";
    child.stdout.on("data", (d) => { out += d; });
    child.stderr.on("data", () => {});
    child.on("close", (code) => resolve({ code, out }));
  });
}

test("AC6 — concurrent quay-topology.sh creators create exactly ONE session + ONE inner window (single-flight lock, 原子创建实测)", { skip: tmuxAvailable ? false : "tmux not installed" }, async () => {
  const sockDir = makeTmp("quay-lock-sock-");
  const lockDir = makeTmp("quay-lock-dir-");
  const sockPath = path.join(sockDir, `tmux-${process.getuid()}`, "default");
  fs.mkdirSync(path.dirname(sockPath), { recursive: true, mode: 0o700 }); // tmux refuses a world-accessible socket dir
  const session = `topo-lockrace-${process.pid}-${Math.random().toString(36).slice(2)}`;
  const launch = "bash -c 'exec -a claude-probe sleep 100 & wait'";
  // Hermetic: TMUX_TMPDIR routes the factory's plain `tmux` calls to the private socket, and the
  // inherited $TMUX (the agent's own session) is DELETED so nothing touches the real server.
  const env = { ...process.env, TMUX_TMPDIR: sockDir, TOPOLOGY_LOCK_DIR: lockDir, TOPOLOGY_LAUNCH_CMD: launch };
  delete env.TMUX;
  try {
    // Two CONCURRENT creators — the dual-creator race (outer self-heal vs manager adopt).
    const [r1, r2] = await Promise.all([
      runAsync("bash", [TOPOLOGY, "--session", session], { env }),
      runAsync("bash", [TOPOLOGY, "--session", session], { env }),
    ]);
    assert.equal(r1.code, 0, `creator 1 must exit 0:\n${r1.out}`);
    assert.equal(r2.code, 0, `creator 2 must exit 0:\n${r2.out}`);
    const combined = r1.out + r2.out;
    const createSession = (combined.match(/create-session:/g) || []).length;
    const createWindow = (combined.match(/create-window:/g) || []).length;
    assert.equal(createSession, 1, `exactly ONE session creation across concurrent creators (double-create prevented), got ${createSession}:\n${combined}`);
    assert.equal(createWindow, 1, `exactly ONE inner window creation across concurrent creators (the session first-window is outer), got ${createWindow}:\n${combined}`);
    // The lock file is released (only left when a creator crashed mid-flight).
    const locks = fs.readdirSync(lockDir).filter((f) => f.endsWith(".lock"));
    assert.deepEqual(locks, [], `the single-flight lock must be released after the creators finish, got: ${JSON.stringify(locks)}`);
  } finally {
    try { spawnSync("tmux", ["-S", sockPath, "kill-session", "-t", session], { stdio: "ignore" }); } catch { /* best-effort */ }
  }
});
