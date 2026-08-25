// @test-group engine
// manager-install-vector.test.mjs — gap-manager-layer-no-verified-install-vector (AC2/AC3/AC4).
//
// Pins the manager layer's BARE-METAL install vector — the delivery gap the task fixes:
// the manager artifacts shipped in the npm pack, but `quay manager start` had never been
// walked from an installed pack (no dev tree), and the two pack-root breakages were:
//   (a) quay-launch.sh looked for `.claude/launch.settings.json` at the package root, but an
//       npm install ships it under `plugin/.claude/launch.settings.json` ⇒ the launched session
//       died with "launch settings file not found";
//   (b) manager-arm-loop.sh's armed loop pointer named `orchestration/manager-loop-tick.md`,
//       which does NOT exist in a bare npm pack (only the shipped `plugin/loop/...` template
//       does) ⇒ void armor (VALIDATE-FAIL on ad-arm1).
//
// Contract (task):
//   invariant manager_artifacts_landed = 1 — installed pack carries manager
//       SKILL/start/adopt/arm-loop/loop tick docs
//   invariant no_void_armor           = 1 — manager-arm-loop pointer resolves to a file in the pack
//   band      manager_bare_metal_ok   = 0 — `quay manager start` exits 0 from a pack-shaped root
//
// How the "bare metal" is simulated: stage a pack-shaped root (the npm pack's layout — a root
// with `plugin/` + `bin/` + `src/` + `package.json`, and NO dev-tree-only dirs: no
// `orchestration/`, no package-root `.claude/`, no `packages/`, no `docs/`). The repo's
// plugin/ IS the pack's plugin/ snapshot (package.sh stages it byte-for-byte); a real
// `npm i -g <quay.tgz>` provides node_modules (hoisted into the prefix), which we simulate
// with a node_modules symlink for the CLI-dispatch test. Evidence notes this is a local
// pack simulation (no real third-party bare machine available in this execution context).
//
// Run:
//   scripts/test.sh plugin/test/manager-install-vector.test.mjs
//   node --test plugin/test/manager-install-vector.test.mjs

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
const repoRoot = path.resolve(pluginDir, "..");
const PKG_DIR = path.join(repoRoot, "packages", "quay");

// `npm i -g` provides the CLI's deps (yaml, @modelcontextprotocol/sdk). This worktree may have
// no node_modules of its own (fresh branch); fall back to the main checkout's install — the
// staged pack's node_modules is a simulation of the installed prefix either way.
function resolveNodeModulesSource() {
  if (fs.existsSync(path.join(repoRoot, "node_modules", "yaml"))) return path.join(repoRoot, "node_modules");
  const main = "/home/yale/work/quay/node_modules";
  if (fs.existsSync(path.join(main, "yaml"))) return main;
  return null;
}

/** The six manager deliverables the npm pack must carry (task Contract invariant). */
const MANAGER_ARTIFACTS = [
  "plugin/skills/manager/SKILL.md",
  "plugin/scripts/manager-start.sh",
  "plugin/scripts/manager-adopt.sh",
  "plugin/scripts/manager-arm-loop.sh",
  "plugin/loop/manager-loop-tick.md",
  "plugin/loop/manager-tick-core.md",
];

const tmuxAvailable = (() => {
  try { return spawnSync("tmux", ["-V"], { encoding: "utf8" }).status === 0; } catch { return false; }
})();

/**
 * Stage a pack-shaped root simulating `npm i -g <quay.tgz>`.
 * The npm pack's plugin/ snapshot IS the repo plugin/ (package.sh stages it byte-for-byte),
 * so the staged `plugin/` is a faithful copy of what a bare machine receives. A real
 * `npm i -g` provides the package's dependencies; we simulate that with a node_modules
 * symlink into the dev repo's install for the CLI-dispatch test only.
 */
function stagePack({ withNodeModules = true } = {}) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "quay-mgr-vec-"));
  const pkg = path.join(tmp, "pkg");
  fs.mkdirSync(path.join(pkg, "plugin"), { recursive: true });
  for (const rel of ["scripts", "loop", ".claude", ".quay"]) {
    fs.cpSync(path.join(pluginDir, rel), path.join(pkg, "plugin", rel), { recursive: true });
  }
  fs.mkdirSync(path.join(pkg, "plugin", "skills"), { recursive: true });
  fs.cpSync(
    path.join(pluginDir, "skills", "manager"),
    path.join(pkg, "plugin", "skills", "manager"),
    { recursive: true }
  );
  fs.cpSync(path.join(PKG_DIR, "bin"), path.join(pkg, "bin"), { recursive: true });
  fs.cpSync(path.join(PKG_DIR, "src"), path.join(pkg, "src"), { recursive: true });
  fs.copyFileSync(path.join(PKG_DIR, "package.json"), path.join(pkg, "package.json"));
  if (withNodeModules) {
    // `npm i -g` installs deps (hoisted into the prefix); simulate with a symlink.
    const src = resolveNodeModulesSource();
    if (src) fs.symlinkSync(src, path.join(pkg, "node_modules"), "dir");
  }
  return { tmp, pkg };
}

function cleanup(tmp) {
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* best-effort */ }
}

// ── AC3 / invariant manager_artifacts_landed: the pack carries the six manager artifacts ─────────────
test("AC3 invariant manager_artifacts_landed — the bare pack ships all six manager artifacts (SKILL/start/adopt/arm-loop/loop tick docs)", () => {
  const { tmp, pkg } = stagePack();
  try {
    for (const rel of MANAGER_ARTIFACTS) {
      assert.ok(fs.existsSync(path.join(pkg, rel)), `installed pack must carry ${rel} (manager_artifacts_landed)`);
    }
    // A bare machine has none of the dev-tree-only dirs — the pack shape must prove it.
    assert.ok(!fs.existsSync(path.join(pkg, "orchestration")), "bare pack must NOT carry orchestration/");
    assert.ok(!fs.existsSync(path.join(pkg, ".claude")), "bare pack must NOT carry package-root .claude/ (ships under plugin/.claude/)");
    assert.ok(!fs.existsSync(path.join(pkg, "packages")), "bare pack must NOT carry the dev-tree packages/ source");
  } finally { cleanup(tmp); }
});

// ── AC2: `quay manager start --dry-run` works from the pack root (the CLI finds the pack's scripts) ──
// Requires a node_modules source (the CLI .ts imports yaml/@modelcontextprotocol/sdk — a real
// `npm i -g` provides them). Skip gracefully when none is reachable (e.g. a fresh worktree with
// no install), rather than fail on an environment precondition the pack shape does not own.
const NODE_MODULES_AVAILABLE = resolveNodeModulesSource() !== null;
test("AC2 band manager_bare_metal_ok — `quay manager start --dry-run` from the pack root exits 0 and plans home+session+arm", { skip: NODE_MODULES_AVAILABLE ? false : "no node_modules source (npm i -g simulation unavailable)" }, () => {
  const { tmp, pkg } = stagePack();
  try {
    const env = { ...process.env, HOME: path.join(tmp, "home") };
    const r = spawnSync(
      "node",
      ["--no-warnings", "--experimental-strip-types", path.join(pkg, "bin", "quay.ts"), "manager", "start", "--dry-run"],
      { encoding: "utf8", env }
    );
    assert.equal(r.status, 0, `quay manager start --dry-run from pack must exit 0:\n${r.stdout}\n${r.stderr}`);
    assert.match(r.stdout, /would-create-home/, "must plan the manager home (C2: $QUAY_GLOBAL_DIR/manager)");
    assert.match(r.stdout, /would-launch-session/, "must plan the independent manager tmux session");
    assert.match(r.stdout, /would-arm-loop/, "must plan arming the loop anchor (AC5)");
  } finally { cleanup(tmp); }
});

// ── AC2: the launched session's settings resolve INSIDE the pack (plugin/.claude fallback) ────────────
test("AC2 — quay-launch.sh resolves the SHIPPED plugin settings in a bare pack (the (a) breakage: package-root .claude is absent)", () => {
  const { tmp, pkg } = stagePack();
  try {
    const r = spawnSync(
      "bash",
      [path.join(pkg, "plugin", "scripts", "quay-launch.sh"), "manager", "--dry-run"],
      { encoding: "utf8", cwd: pkg }
    );
    assert.equal(r.status, 0, `quay-launch.sh manager --dry-run from pack must exit 0:\n${r.stdout}\n${r.stderr}`);
    assert.match(
      r.stdout,
      /plugin\/\.claude\/launch\.settings\.json/,
      "must fall back to the SHIPPED plugin/.claude/launch.settings.json (bare-metal vector)"
    );
    assert.match(r.stdout, /-n quay-manager/, "the manager session name must resolve from the SHIPPED plugin/.quay/profiles.yml (AC154 profile carrier fallback)");
  } finally { cleanup(tmp); }
});

// ── AC4 / invariant no_void_armor: the armed pointer resolves INSIDE the pack ─────────────────────────
test("AC4 invariant no_void_armor — the arm validates against a shipped doc AND the armed pointer resolves in the pack (the (b) breakage)", () => {
  const { tmp, pkg } = stagePack();
  try {
    const arm = path.join(pkg, "plugin", "scripts", "manager-arm-loop.sh");
    // --validate must read a SHIPPED tick doc (not a dev-tree orchestration/ path).
    const v = spawnSync("bash", [arm, "--validate"], { encoding: "utf8", cwd: pkg });
    assert.equal(v.status, 0, `--validate from pack must pass:\n${v.stdout}\n${v.stderr}`);
    assert.match(v.stdout, /VALIDATE-OK/, "the shipped tick doc must carry the sentinel+pointer contract");

    // A real arm writes the loop registry; the pointer it records must exist in the pack.
    const home = path.join(tmp, "mgr-home");
    const a = spawnSync("bash", [arm, "--home", home], { encoding: "utf8", cwd: pkg });
    assert.equal(a.status, 0, `arm from pack must exit 0:\n${a.stdout}\n${a.stderr}`);
    const store = path.join(home, "loop-registry.txt");
    assert.ok(fs.existsSync(store), "arm must write the loop registry");
    const content = fs.readFileSync(store, "utf8");
    const m = content.match(/<repo>\/(\S+)/);
    assert.ok(m, `the armed prompt must be a <repo>/path pointer, got: ${content}`);
    const pointerRel = m[1];
    assert.ok(
      fs.existsSync(path.join(pkg, pointerRel)),
      `armed pointer ${pointerRel} must resolve to a file INSIDE the pack (AC4 no void armor)`
    );
  } finally { cleanup(tmp); }
});

// ── AC2: a REAL `quay manager start` from the pack root (hermetic tmux, harmless launch override) ─────
test("AC2 — real `quay manager start` from the pack root creates home + session and arms the loop (hermetic tmux)", { skip: tmuxAvailable ? false : "tmux not installed" }, () => {
  const { tmp, pkg } = stagePack();
  try {
    const sockDir = path.join(tmp, "sock");
    const socketBase = path.join(sockDir, `tmux-${process.getuid()}`);
    fs.mkdirSync(socketBase, { recursive: true, mode: 0o700 });
    const env = { ...process.env, TMUX_TMPDIR: sockDir, HOME: path.join(tmp, "home") };
    delete env.TMUX;
    const home = path.join(tmp, "mgr-home");
    const r = spawnSync(
      "bash",
      [path.join(pkg, "plugin", "scripts", "manager-start.sh"), "--home", home],
      {
        encoding: "utf8",
        env: { ...env, MANAGER_LAUNCH_CMD: "bash -c 'exec -a claude-probe sleep 10000 & wait'" },
      }
    );
    assert.equal(r.status, 0, `manager start from pack must exit 0:\n${r.stdout}\n${r.stderr}`);
    assert.ok(fs.existsSync(path.join(home, "identity")), "must create the manager identity file in $QUAY_GLOBAL_DIR/manager/");
    const identity = fs.readFileSync(path.join(home, "identity"), "utf8");
    assert.match(identity, /role=manager/, "identity must declare role=manager");
    // The loop anchor was armed and its pointer resolves inside the pack.
    const store = path.join(home, "loop-registry.txt");
    assert.ok(fs.existsSync(store), "real start must arm the loop anchor");
    const content = fs.readFileSync(store, "utf8");
    const m = content.match(/<repo>\/(\S+)/);
    assert.ok(m, `the armed prompt must be a pointer, got: ${content}`);
    assert.ok(fs.existsSync(path.join(pkg, m[1])), `armed pointer ${m[1]} must resolve in the pack`);

    // Cleanup the hermetic session (kill-session, never kill-server).
    const sess = (identity.match(/session=(\S+)/) || [])[1] || "quay-manager";
    isolatedTmux(["kill-session", "-t", sess], { socket: path.join(socketBase, "default"), env });
  } finally { cleanup(tmp); }
});
