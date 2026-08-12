// @test-group serial
// @load-sensitive real-install
// @load-sensitive-entry 2026-08-09 real-install e2e; install family rotated flakes under full-suite load (rounds 160-162)
// KNOWN-LOAD-SENSITIVE (see plugin/loop/fast-mode-loop-tick.md "已知负载敏感族") — real-install e2e:
// each test spawns a real quay-init.sh --loop subprocess tree. The install/quay-init family rotated
// flakes across groups under full-suite load (round-160/161/162 — different files each round), so the
// whole family is consolidated into the concurrency-1 serial phase
// (gap-install-family-tests-rotate-flakes-under-full-suite).
// install-config-driven-e2e-upgrade.test.mjs — the UPGRADE/CONFIG-PRESERVATION half of the
// install-config-driven e2e family (gap-no-e2e-proves-install-is-configuration-driven).
//
// SPLIT BY gap-split-three-phase-floor-files (2026-08-12): the pre-split
// install-config-driven-e2e.test.mjs was the serial phase's floor (~107s, 19 real installs). This
// file carries the upgrade half: A3 (old-install workspace upgrades to all-new product files, loop
// state stays readable) + AC6/AC1 (config-preserving --loop upgrade keeps the ENTIRE loop section)
// + AC2 (config backup + rollback on a failed upgrade). Test BODIES are byte-identical to the
// pre-split file; only their file placement changed. Serial-group isolation is preserved: each real
// install gets a unique disk-backed worktree root + per-workspace tmux session, and the after()
// sweep below destroys every workspace created here.

import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import YAML from "yaml";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
const PLUGIN_ROOT = path.resolve(REPO_ROOT, "plugin");

// Config-class files: per-project state/config that legitimately differs across
// workspaces. The PRODUCT files are what must be byte-identical (see the sibling
// byte-identity file); this file only needs the set to EXCLUDE config files from
// the artifact-identity comparisons it runs.
const CONFIG_CLASS = new Set([
  ".quay/config.yml",
  ".quay/quay-init-state.json",
  "orchestration/session-liveness.env",
  ".gitignore",
]);

// ── workspace lifecycle (AC8: destroyed after the file runs, no shared-checkout residue) ─────────────
const _tmp = [];
const _wtRoots = [];
after(() => {
  for (const ws of _tmp) fs.rmSync(ws, { recursive: true, force: true });
  for (const wt of _wtRoots) fs.rmSync(wt, { recursive: true, force: true });
});

function diskWorktreeRoot() {
  let dir = null;
  for (const base of ["/var/tmp", os.tmpdir()]) {
    try {
      const t = spawnSync("stat", ["-f", "-c", "%T", base], { encoding: "utf8" });
      if (t.status === 0 && t.stdout.trim() !== "tmpfs") { dir = fs.mkdtempSync(path.join(base, "install-e2e-wt-")); break; }
    } catch { /* try next base */ }
  }
  if (!dir) dir = fs.mkdtempSync(path.join(os.tmpdir(), "install-e2e-wt-"));
  _wtRoots.push(dir);
  return dir;
}

function makeWorkspace(prefix = "install-e2e-") {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  _tmp.push(ws);
  return ws;
}

// ── quay-init invocation ──────────────────────────────────────────────────────────────────────────────
function runInit(ws, { pluginRoot = PLUGIN_ROOT, repoRoot = "/srv/target", project = "proj", tmux, testCommand, worktreeRoot, addArgs = [] } = {}) {
  const session = tmux ?? `p-${path.basename(ws).slice(-12)}-0:0.0`;
  const args = ["--loop", "--root", ws, "--project", project, "--tmux-session", session, "--repo-root", repoRoot];
  if (worktreeRoot !== null) args.push("--worktree-root", worktreeRoot ?? diskWorktreeRoot());
  if (testCommand) args.push("--test-command", testCommand);
  args.push(...addArgs);
  return spawnSync("bash", [path.join(pluginRoot, "scripts", "quay-init.sh"), ...args], {
    cwd: ws,
    encoding: "utf8",
    env: { ...process.env, CLAUDE_PLUGIN_ROOT: pluginRoot },
  });
}

// ── filesystem helpers ─────────────────────────────────────────────────────────────────────────────────
function listFiles(dir) {
  const out = [];
  const walk = (d, rel) => {
    let entries;
    try {
      entries = fs.readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const full = path.join(d, e.name);
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) walk(full, r);
      else out.push(r);
    }
  };
  walk(dir, "");
  return out.sort();
}

function productSource(rel) {
  if (rel.startsWith("plugin/scripts/")) {
    return path.join(PLUGIN_ROOT, "scripts", path.basename(rel));
  }
  if (rel === "orchestration/orchestrator-loop-tick.md") {
    return path.join(PLUGIN_ROOT, "loop", "orchestrator-loop-tick.md");
  }
  if (rel === "docs/analysis/fast-mode-loop-tick.md") {
    return path.join(PLUGIN_ROOT, "loop", "fast-mode-loop-tick.md");
  }
  if (rel === ".quay/runtime/bin/quay.js") {
    const src = path.join(PLUGIN_ROOT, "vendor", "quay", "dist", "quay.js");
    return fs.existsSync(src) ? src : null;
  }
  if (rel === ".quay/runtime/bin/quay-native.js") {
    const src = path.join(PLUGIN_ROOT, "vendor", "quay-native", "dist", "quay-native.js");
    return fs.existsSync(src) ? src : null;
  }
  if (rel === ".quay/runtime/provider.yml") {
    const src = path.join(PLUGIN_ROOT, "vendor", "quay-native", "provider.yml");
    return fs.existsSync(src) ? src : null;
  }
  return null;
}

function isProductFile(rel) {
  return productSource(rel) !== null && !CONFIG_CLASS.has(rel);
}

function laidDownProductFiles(ws) {
  return listFiles(ws).filter((rel) => isProductFile(rel));
}

// A2/A3: laid-down product files that differ from the plugin source artifact.
function artifactDiffs(ws) {
  const diffs = [];
  for (const rel of laidDownProductFiles(ws)) {
    const src = productSource(rel);
    if (!fs.existsSync(src)) continue;
    if (!fs.readFileSync(path.join(ws, rel)).equals(fs.readFileSync(src))) {
      diffs.push(rel);
    }
  }
  return diffs;
}

function snapshotProductFiles(ws) {
  const snap = new Map();
  for (const rel of laidDownProductFiles(ws)) {
    snap.set(rel, fs.readFileSync(path.join(ws, rel)));
  }
  return snap;
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// A3 — upgrade: all files become the new product, existing loop state stays readable
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
test("A3 — an old-install workspace upgrades to all-new product files, and existing loop state stays readable & semantically unchanged", () => {
  // Simulate an OLD plugin: a copy whose tick docs carry a legacy version marker.
  const oldPlugin = makeWorkspace("install-e2e-oldplugin-");
  fs.cpSync(PLUGIN_ROOT, oldPlugin, { recursive: true });
  const legacy = "\n<!-- legacy-1.0.0: old methodology, replaced by the config-driven install -->\n";
  fs.appendFileSync(path.join(oldPlugin, "loop", "orchestrator-loop-tick.md"), legacy);
  fs.appendFileSync(path.join(oldPlugin, "loop", "fast-mode-loop-tick.md"), legacy);

  const ws = makeWorkspace();
  fs.writeFileSync(path.join(ws, "package.json"), JSON.stringify({ name: "proj", scripts: { test: "vitest run" } }, null, 2));

  // Existing loop state that must survive the upgrade: workflow events, tick log, gate events.
  const eventLine = JSON.stringify({ ts: 1, kind: "fixture", note: "pre-upgrade" });
  const workflowDir = path.join(ws, ".workflow-events");
  fs.mkdirSync(workflowDir, { recursive: true });
  fs.writeFileSync(path.join(workflowDir, "fm-e2e-fixture.jsonl"), `${eventLine}\n`);
  fs.writeFileSync(path.join(ws, "tick-log.md"), "# Tick log\n\n- 2026-08-04: e2e fixture tick\n");
  fs.mkdirSync(path.join(ws, ".quay"), { recursive: true });
  fs.writeFileSync(path.join(ws, ".quay", "gate-events.jsonl"), `${eventLine}\n`);

  // OLD install (old plugin version lays the legacy tick docs).
  const rOld = runInit(ws, { pluginRoot: oldPlugin });
  assert.equal(rOld.status, 0, `old install failed:\n${rOld.stderr}`);
  assert.ok(
    fs.readFileSync(path.join(ws, "orchestration", "orchestrator-loop-tick.md"), "utf8").includes("legacy-1.0.0"),
    "precondition: the old install must have laid the legacy tick docs"
  );

  // UPGRADE with the real (new) plugin.
  const rNew = runInit(ws);
  assert.equal(rNew.status, 0, `upgrade failed:\n${rNew.stderr}`);

  // Part 1: every laid-down file now equals the NEW product artifact.
  const diffs = artifactDiffs(ws);
  assert.deepEqual(diffs, [],
    `A3: after upgrade every laid-down file must equal the new product; still differing=${JSON.stringify(diffs)}`);

  // Part 2: existing loop state readable AND semantically unchanged (byte-identical).
  assert.equal(
    fs.readFileSync(path.join(workflowDir, "fm-e2e-fixture.jsonl"), "utf8"),
    `${eventLine}\n`,
    "A3: .workflow-events must survive the upgrade readable and unchanged"
  );
  assert.equal(
    fs.readFileSync(path.join(ws, "tick-log.md"), "utf8"),
    "# Tick log\n\n- 2026-08-04: e2e fixture tick\n",
    "A3: tick-log.md must survive the upgrade readable and unchanged"
  );
  assert.equal(
    fs.readFileSync(path.join(ws, ".quay", "gate-events.jsonl"), "utf8"),
    `${eventLine}\n`,
    "A3: gate events must survive the upgrade readable and unchanged"
  );
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// AC6 / AC1 — config-divergence fixture (gap-quay-init-config-preserving-incremental-upgrade):
// an ORGANICALLY EVOLVED consumer. The pre-fix A3 only used a self-made clean old-install
// ("config == template" — a synthetic sample); the real downstream (archguard) has custom
// loop values ≠ the template, and the pre-fix upgrade either stopped at config-conflict or
// --force-clobbered them. This fixture creates the organic shape (custom board/gates/stop/policy/
// concurrency_bands/fork_baseline/merge_target + the four fast-mode values) and asserts the
// config-preserving upgrade keeps the ENTIRE loop section unchanged while laying down the mechanism.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
function writeEvolvedConsumerConfig(ws) {
  fs.mkdirSync(path.join(ws, ".quay"), { recursive: true });
  fs.writeFileSync(path.join(ws, ".quay", "config.yml"), [
    "providers:",
    "  native:",
    "    enabled: true",
    "    path: /srv/proj/.quay/runtime",
    "    tasks_dir: /srv/proj/tasks",
    '    mcp_entry: ["node", "/srv/proj/.quay/runtime/bin/quay-native.js", "mcp"]',
    "loop:",
    "  board: native",
    "  gates: [acceptance]",
    "  stop: until(.halt)",
    "  policy: value-typed-ledger",
    "  concurrency_bands:",
    "    go: 5",
    "    wait: 2",
    "  fork_baseline: develop",
    "  merge_target: integration",
    "  repo_root: /srv/proj",
    "  test_command: custom-test-cmd",
    "  tmux_session: proj-session",
    "  worktree_root: /srv/proj-worktrees",
    "",
  ].join("\n"));
}

test("AC6/AC1 — an organically evolved consumer keeps the ENTIRE loop section after a config-preserving --loop upgrade (no --force), and the mechanism files are laid down", () => {
  const ws = makeWorkspace();
  fs.writeFileSync(path.join(ws, "package.json"), JSON.stringify({ name: "proj", scripts: { test: "vitest run" } }, null, 2));
  writeEvolvedConsumerConfig(ws);
  const cfgPath = path.join(ws, ".quay", "config.yml");
  const loopBefore = YAML.parse(fs.readFileSync(cfgPath, "utf8")).loop;

  // Config-preserving upgrade WITHOUT --force (AC1). The test command is deliberately NOT passed:
  // the prefer-existing path must keep the consumer's recorded loop.test_command (a real
  // downstream run of `quay init --loop` has no fresh detection clobbering it). worktreeRoot: null
  // keeps the consumer's recorded loop.worktree_root too — this is the upgrade path that must
  // preserve the ENTIRE loop section (task gap-serial-phase-install-test-residue-dependency: the
  // default unique-root injection must NOT clobber an organic consumer's recorded root).
  const r = runInit(ws, { repoRoot: "/srv/proj", tmux: "proj-session", worktreeRoot: null });
  assert.equal(r.status, 0, `config-preserving upgrade must succeed:\n${r.stderr}`);

  // AC1 first half: mechanism files ARE laid down.
  assert.ok(fs.existsSync(path.join(ws, "plugin", "scripts", "session-liveness.sh")),
    "AC1: mechanism files must be laid down on the existing consumer");
  const laid = laidDownProductFiles(ws);
  assert.ok(laid.length >= 20, `AC1: laid-down product count must be >= 20; got ${laid.length}`);

  // AC1 second half: config PRESERVED — the ENTIRE loop section (custom keys + the four
  // fast-mode values) is unchanged. The pre-fix `data["loop"] = {...}` replacement dropped
  // board/gates/stop/policy/concurrency_bands/fork_baseline/merge_target here.
  const loopAfter = YAML.parse(fs.readFileSync(cfgPath, "utf8")).loop;
  assert.deepEqual(loopAfter, loopBefore,
    `AC1: the config-preserving upgrade must keep every loop key (loop values unchanged); got ${JSON.stringify(loopAfter)}`);

  // The prefer-existing message is emitted (transparency that the consumer's value won over detection).
  assert.match(r.stdout, /using existing config loop\.test_command: custom-test-cmd/,
    "the upgrade must report it kept the consumer's existing loop.test_command");
});

test("AC2 — config backup before upgrade + rollback restores the config unchanged on a failed upgrade", () => {
  const ws = makeWorkspace();
  fs.writeFileSync(path.join(ws, "package.json"), JSON.stringify({ name: "proj", scripts: { test: "vitest run" } }, null, 2));
  writeEvolvedConsumerConfig(ws);
  const cfgPath = path.join(ws, ".quay", "config.yml");
  // The pre-upgrade config captured BEFORE the baseline install — a backup taken by an upgrade
  // must capture exactly this (the config as it was on disk before that upgrade wrote it).
  const originalConfig = fs.readFileSync(cfgPath, "utf8");

  // Baseline install (mechanism present, config written by quay-init).
  const r0 = runInit(ws, { repoRoot: "/srv/proj", tmux: "proj-session", testCommand: "original-test-cmd" });
  assert.equal(r0.status, 0, `baseline install must succeed:\n${r0.stderr}`);
  const beforeUpgrade = fs.readFileSync(cfgPath, "utf8");

  // AC2 first half: a config backup must exist after an upgrade (backup before upgrade), and it
  // must capture the PRE-upgrade config (what was on disk before that run modified it).
  const backups = listFiles(path.join(ws, ".quay", "quay-init-backups")).filter((rel) => rel.endsWith("config.yml"));
  assert.ok(backups.length >= 1, `AC2: a config backup must be created before the upgrade; got ${JSON.stringify(backups)}`);
  const backupContent = fs.readFileSync(path.join(ws, ".quay", "quay-init-backups", backups[0]), "utf8");
  assert.equal(backupContent, originalConfig,
    "AC2: the first backup must capture the pre-upgrade config exactly (backup before upgrade)");

  // Force a FAILED upgrade AFTER the config write: a corrupted NON-loop installed script
  // (quay-init.sh is NEVER_LAYDOWN — the lay-down does not replace it, so
  // verify-installed-executables fails closed; send-keys-verified.sh was the prior fixture but is
  // now DELETED per gap-retired-script-still-callable, leaving quay-init.sh as the lone
  // NEVER_LAYDOWN script). The upgrade passes a DIFFERENT test_command, which
  // ensure_loop_config writes into the config — proving the rollback must undo it.
  fs.mkdirSync(path.join(ws, "plugin", "scripts"), { recursive: true });
  fs.writeFileSync(path.join(ws, "plugin", "scripts", "quay-init.sh"),
    "#!/usr/bin/env bash\n# corrupted non-loop residue — never replaced by the lay-down\n");
  const rUp = runInit(ws, { repoRoot: "/srv/proj", tmux: "proj-session", testCommand: "SHOULD-NOT-STICK-cmd" });
  assert.notEqual(rUp.status, 0,
    "precondition: a corrupted non-loop installed script must fail the upgrade (verify-installed-executables fail-closed)");
  assert.match(rUp.stdout + rUp.stderr, /rolled back .*config.*unchanged/,
    "AC2: the failed upgrade must report the config rollback");

  // AC2 second half: the failed upgrade restored the config byte-for-byte (rollback unchanged).
  const afterFailed = fs.readFileSync(cfgPath, "utf8");
  assert.equal(afterFailed, beforeUpgrade,
    "AC2: a failed upgrade must restore the config unchanged (rollback); the SHOULD-NOT-STICK-cmd write must be undone");
});
