// @test-group serial
// @load-sensitive heavy
// @load-sensitive-entry 2026-08-09 real-install e2e (package.sh + npm pack); install family flake rotation
// KNOWN-LOAD-SENSITIVE (see plugin/loop/fast-mode-loop-tick.md "已知负载敏感族") — real-install e2e:
// each test runs a real package.sh (build-dist + npm pack) + tarball install. The install/quay-init
// family rotated flakes across groups under full-suite load, so the whole family is consolidated into
// the concurrency-1 serial phase (gap-install-family-tests-rotate-flakes-under-full-suite).
// npm-pack-e2e.test.mjs — M120 Stage 2.2 (DIR-060).
//
// End-to-end: run the REAL package.sh (build-dist.sh -> npm pack), install the
// produced tarball into a scratch prefix, and run the installed `quay` binary.
// Proves the distributed artifact — the thing a real `npm install -g` gets —
// actually executes from its `dist/quay.js` bin, including a real provider
// round-trip (`task list`).
//
// HONEST SCOPE: this run is on THIS host (Node 25). It CANNOT prove Node-20
// compatibility — that requires an actual Node-20 runtime (Phase 4's
// floor-verification job, exercised for real only by Phase 5's release run).
// What it DOES prove: the bin field resolves to the bundled dist, the tarball
// ships dist/quay.js, and the installed CLI runs end-to-end.
//
// package.sh is a SHELL script (no bash coverage tool in this repo — confirmed:
// no kcov/bashcov). Its logic path is exercised here via RED/GREEN exit-code +
// runnable-artifact assertions (the repo's documented shell strategy); Node's
// --experimental-test-coverage cannot reach a spawned shell script or a forked
// binary, and excludes the test file being run — so no fabricated line-coverage
// % is asserted for this stage.
//
// Run: node --test packages/quay/test/npm-pack-e2e.test.mjs

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { QUAY_NATIVE_CLI } from "./helpers/cli-entry.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pkgDir = path.resolve(__dirname, "..");
const repoRoot = path.resolve(pkgDir, "..", "..");
const nativeBin = QUAY_NATIVE_CLI;
const nativeProviderDir = path.join(__dirname, "..", "..", "quay-native", "bin");
const pkgVersion = JSON.parse(fs.readFileSync(path.join(pkgDir, "package.json"), "utf8")).version;

// Copy the package tree into a FRESH temp dir so package.sh's build-dist step
// (esbuild -> dist/quay.js) and `npm pack` both run inside the temp copy, never
// rewriting the shared packages/quay/dist/quay.js that M136's sync-vendor
// --check reads concurrently in the same full-suite run
// (gap-sync-vendor-drift-mislabelled-as-task-schema, round 3: eliminate the
// interference source, don't mask the check). The repo's node_modules is
// symlinked into the copy so build-dist.mjs's `import * as esbuild` resolves.
//
// The temp copy MIRRORS THE REAL REPO LAYOUT: <base>/packages/quay + <base>/plugin.
// package.sh (gap-release-excludes-plugin-bundle-agent-surface, AC16) stages the
// plugin bundle into packages/quay/plugin/ before `npm pack`, resolving its source
// as <package-dir>/../../plugin. That only resolves to the repo-root plugin/ if the
// package dir is exactly two levels below the root the plugin lives under — a flat
// <tmp>/quay-m120-e2e-pkg-XXX would make ../../ resolve to the filesystem root.
function makeTempPackageCopy() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "quay-m120-e2e-"));
  const root = path.join(base, "packages", "quay");
  fs.mkdirSync(root, { recursive: true });
  for (const rel of ["package.json", "bin", "src", "scripts", "README.md", "CHANGELOG.md", "LICENSE.md"]) {
    fs.cpSync(path.join(pkgDir, rel), path.join(root, rel), { recursive: true });
  }
  // The copied plugin carries its vendored self-contained runtime
  // (plugin/vendor/*/dist, built by the root `npm install` postinstall →
  // sync-vendor.sh), so package.sh's fail-closed guard does not fire.
  fs.cpSync(path.join(repoRoot, "plugin"), path.join(base, "plugin"), { recursive: true });
  fs.symlinkSync(path.join(repoRoot, "node_modules"), path.join(root, "node_modules"), "dir");
  return base; // the mkdtemp result itself — caller captures it into tempBase, cleaned in after()
}

let scratch; // install prefix
let installedBin; // node_modules/quay/dist/quay.js
let tgz;
let tempBase; // isolated temp copy of the repo layout package.sh ran in
let tempPkg; // the package dir (tempBase/packages/quay)

before(() => {
  // Real package.sh run, in a temp COPY of the package tree: builds dist/, then
  // npm pack -> quay-<version>.tgz, all inside the isolated copy.
  tempBase = makeTempPackageCopy();
  tempPkg = path.join(tempBase, "packages", "quay");
  execFileSync("bash", [path.join(tempPkg, "scripts", "package.sh")], {
    encoding: "utf8",
    cwd: tempPkg,
    stdio: "pipe",
  });
  tgz = path.join(tempPkg, `quay-${pkgVersion}.tgz`);
  assert.ok(fs.existsSync(tgz), `package.sh must produce ${tgz}`);

  // Install the tarball into a scratch prefix (isolated from the repo).
  scratch = fs.mkdtempSync(path.join(os.tmpdir(), "quay-m120-e2e-install-"));
  execFileSync(
    "npm",
    ["install", "--prefix", scratch, tgz, "--no-save", "--no-audit", "--no-fund"],
    { encoding: "utf8", stdio: "pipe" }
  );
  installedBin = path.join(scratch, "node_modules", "quay", "dist", "quay.js");
});

after(() => {
  if (scratch) fs.rmSync(scratch, { recursive: true, force: true });
  if (tempBase) fs.rmSync(tempBase, { recursive: true, force: true });
});

test("the installed tarball's bin resolves to dist/quay.js and it exists", () => {
  assert.ok(fs.existsSync(installedBin), `installed bin must exist at ${installedBin}`);
  const installedPkg = JSON.parse(
    fs.readFileSync(path.join(scratch, "node_modules", "quay", "package.json"), "utf8")
  );
  assert.equal(installedPkg.bin.quay, "./dist/quay.js", "installed package's bin must point at dist/quay.js");
});

test("installed `quay --help` runs and prints usage (Node 25 host — NOT a Node-20 proof)", () => {
  const help = execFileSync("node", [installedBin, "--help"], { encoding: "utf8" });
  assert.match(help, /Usage/);
});

test("installed `quay --version` prints the package version", () => {
  const version = execFileSync("node", [installedBin, "--version"], { encoding: "utf8" }).trim();
  assert.equal(version, pkgVersion);
});

test("installed `quay task list` does a real provider round-trip against a native workspace", () => {
  const tasksDir = fs.mkdtempSync(path.join(os.tmpdir(), "quay-m120-e2e-tasks-"));
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "quay-m120-e2e-ws-"));
  fs.mkdirSync(path.join(workspaceRoot, ".quay"), { recursive: true });
  fs.writeFileSync(
    path.join(workspaceRoot, ".quay", "config.yml"),
    [
      "providers:",
      "  native:",
      "    enabled: true",
      `    path: "${nativeProviderDir.replaceAll("\\", "\\\\")}"`,
      `    tasks_dir: "${tasksDir.replaceAll("\\", "\\\\")}"`,
      `    mcp_entry: ["node", "${nativeBin.replaceAll("\\", "\\\\")}", "mcp"]`,
      "    env:",
      `      QUAY_NATIVE_TASKS_DIR: "${tasksDir.replaceAll("\\", "\\\\")}"`,
      "",
    ].join("\n")
  );
  // Seed one task via the native provider, then list it through the INSTALLED bin.
  execFileSync("node", [nativeBin, "task", "create", "E2E1", "--title", "e2e fixture", "--status", "todo"], {
    encoding: "utf8",
    env: { ...process.env, QUAY_NATIVE_TASKS_DIR: tasksDir },
  });
  const list = execFileSync("node", [installedBin, "task", "list"], { encoding: "utf8", cwd: workspaceRoot });
  assert.match(list, /E2E1/, "installed bin's `task list` must show the seeded task");
  fs.rmSync(tasksDir, { recursive: true, force: true });
  fs.rmSync(workspaceRoot, { recursive: true, force: true });
});

test("the tarball carries the ENTIRE plugin bundle (bundle_in_pack > 0 — AC16)", () => {
  // gap-release-excludes-plugin-bundle-agent-surface (AC16): the release tarball must
  // contain the plugin bundle — the agent surface that IS the self-evolving loop. This
  // is the task's Contract measure (bundle_in_pack = `npm pack --dry-run 2>&1 | grep -c
  // 'plugin/'` > 0), asserted against the REAL packed tarball package.sh produced.
  const tar = execFileSync("tar", ["-tzf", tgz], { encoding: "utf8" });
  const pluginEntries = tar.split("\n").filter((l) => l.includes("/plugin/")).length;
  assert.ok(pluginEntries > 0, `tarball must contain plugin/ entries (bundle_in_pack = ${pluginEntries})`);
  // The task's AC1 subdirs must ALL be present (scripts/gate-scripts/skills/probes/loop/vendor/agents).
  for (const sub of ["plugin/scripts", "plugin/gate-scripts", "plugin/skills", "plugin/probes", "plugin/loop", "plugin/vendor/quay/dist/quay.js", "plugin/vendor/quay-native/dist/quay-native.js", "plugin/agents"]) {
    assert.ok(tar.includes(`package/${sub}`), `tarball must include ${sub}`);
  }
  // The installed copy (from the tarball, not a git clone) must also carry the bundle.
  const installedPlugin = path.join(scratch, "node_modules", "quay", "plugin");
  assert.ok(fs.existsSync(installedPlugin), `installed copy must carry the plugin bundle at ${installedPlugin}`);
  assert.ok(
    fs.existsSync(path.join(installedPlugin, "scripts", "quay-init.sh")),
    "installed plugin must carry scripts/quay-init.sh (the quay-init --loop mechanism)"
  );
  assert.ok(
    fs.existsSync(path.join(installedPlugin, "loop", "orchestrator-loop-tick.md")),
    "installed plugin must carry the outer-loop tick doc"
  );
  assert.ok(
    fs.existsSync(path.join(installedPlugin, "vendor", "quay", "dist", "quay.js")),
    "installed plugin must carry the vendored self-contained Core runtime"
  );
});

test("the tarball ships the postinstall register script + the plugin's .claude-plugin manifests", () => {
  // gap-npm-install-does-not-register-the-plugin-with-claude-code: the INSTALLED artifact
  // must be a legal Claude Code directory marketplace and carry the hook that registers it.
  // Without the script in the tarball the postinstall would ENOENT after `npm install -g`.
  const tar = execFileSync("tar", ["-tzf", tgz], { encoding: "utf8" });
  assert.ok(
    tar.includes("package/scripts/register-plugin.mjs"),
    "tarball must ship scripts/register-plugin.mjs (the postinstall registration hook)"
  );
  for (const rel of ["package/plugin/.claude-plugin/marketplace.json", "package/plugin/.claude-plugin/plugin.json"]) {
    assert.ok(tar.includes(rel), `tarball must carry ${rel}`);
  }
});

test("register-plugin (global-install mode, temp HOME) writes settings.json pointing at the INSTALLED plugin dir", () => {
  // The task's Contract measure: plugin_registered = grep -c "$(npm root -g)/quay/plugin"
  // ~/.claude/settings.json must be >= 1. Run the SHIPPED hook exactly as the postinstall
  // would (npm_config_global=true) against the scratch-installed copy, into a temp HOME so
  // this test never touches the developer's real ~/.claude.
  const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "quay-reg-home-"));
  const register = path.join(scratch, "node_modules", "quay", "scripts", "register-plugin.mjs");
  try {
    // Pre-existing settings with an UNRELATED marketplace + a user field — must be preserved.
    const existing = path.join(tempHome, ".claude", "settings.json");
    fs.mkdirSync(path.dirname(existing), { recursive: true });
    fs.writeFileSync(existing, JSON.stringify({ model: "sonnet", extraKnownMarketplaces: { other: { source: { source: "directory", path: "/x/other" } } } }, null, 2));
    const out = execFileSync("node", [register], {
      encoding: "utf8",
      // QUAY_SKIP_PLUGIN_CLI=1 keeps this a pure settings.json assertion (the claude-CLI
      // materialization path is proven separately in the task's manual AC evidence and is
      // environment-heavy — no need to shell out to `claude` on every test run).
      env: { ...process.env, HOME: tempHome, npm_config_global: "true", QUAY_SKIP_PLUGIN_CLI: "1" },
    });
    const settings = JSON.parse(fs.readFileSync(existing, "utf8"));
    const installedPlugin = path.join(scratch, "node_modules", "quay", "plugin");
    assert.equal(settings.model, "sonnet", "unrelated settings keys must be preserved");
    assert.equal(settings.extraKnownMarketplaces.other.source.path, "/x/other", "other marketplaces must be preserved");
    assert.equal(settings.extraKnownMarketplaces.quay.source.source, "directory");
    assert.equal(settings.extraKnownMarketplaces.quay.source.path, installedPlugin, "marketplace must point at the INSTALLED plugin dir");
    assert.equal(settings.enabledPlugins["quay@quay"], true, "plugin must be enabled");
    assert.match(out, /Registered the installed quay plugin/, "hook must report success");
  } finally {
    fs.rmSync(tempHome, { recursive: true, force: true });
  }
});

test("register-plugin skips silently on a NON-global install (dev `npm install` must not touch ~/.claude)", () => {
  // npm runs every workspace's postinstall during a monorepo `npm install`. Writing the
  // user's ~/.claude/settings.json from there to a DEV-TREE path is exactly the historical
  // residue this gap measured (machine B pointed at a deleted /home/yale/work/quay/plugin).
  const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "quay-reg-home-"));
  const register = path.join(scratch, "node_modules", "quay", "scripts", "register-plugin.mjs");
  try {
    const out = execFileSync("node", [register], {
      encoding: "utf8",
      env: { ...process.env, HOME: tempHome, npm_config_global: "false" },
    });
    assert.ok(!fs.existsSync(path.join(tempHome, ".claude", "settings.json")), "non-global install must NOT write settings.json");
    assert.match(out, /not a global install/, "hook must explain why it skipped");
  } finally {
    fs.rmSync(tempHome, { recursive: true, force: true });
  }
});

test("register-plugin FAILS CLOSED when the installed plugin bundle is incomplete", () => {
  // If the tarball ever ships without .claude-plugin/marketplace.json + plugin.json, the
  // hook must refuse rather than register a broken marketplace (silent broken install).
  const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "quay-reg-home-"));
  const register = path.join(scratch, "node_modules", "quay", "scripts", "register-plugin.mjs");
  try {
    const pluginDir = path.join(scratch, "node_modules", "quay", "plugin");
    const backup = path.join(pluginDir, ".claude-plugin");
    const renamed = path.join(pluginDir, ".claude-plugin-hidden-test");
    fs.renameSync(backup, renamed);
    let threw = false;
    try {
      execFileSync("node", [register], {
        encoding: "utf8",
        env: { ...process.env, HOME: tempHome, npm_config_global: "true" },
      });
    } catch (err) {
      threw = true;
      assert.match(String(err.stderr), /incomplete/, "failure must cite the incomplete bundle");
    }
    fs.renameSync(renamed, backup);
    assert.ok(threw, "register-plugin must exit non-zero when the bundle is incomplete");
  } finally {
    fs.rmSync(tempHome, { recursive: true, force: true });
  }
});
