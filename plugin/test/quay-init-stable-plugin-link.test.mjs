// @test-group serial
// @load-sensitive real-install
// @load-sensitive-entry 2026-10-05 stable project plugin link (quay-init --loop install); install family
// quay-init-stable-plugin-link.test.mjs — gap-config-provider-path-frozen-to-versioned-cache-dir
//
// WHAT THIS PINS. `/quay:init` used to write the provider binding as
// `<installPath>/vendor/quay-native`, where `installPath` is the plugin MARKETPLACE cache dir — a path
// that CARRIES the installed version (`…/cache/quay/quay/0.14.0/`). An upgrade left the config
// untouched, so Core kept launching the OLD provider bundle forever, and the drift was invisible
// (`driver status` reported `config-provider-path-behind` but nothing fixed it).
//
// The fix is a project-INTERNAL symlink `<ws>/.quay/plugin -> <this project's scope installPath>`,
// refreshed on every `/quay:init`, with the config's `path`/`mcp_entry` naming
// `<ws>/.quay/plugin/vendor/quay-native` — a path with NO version segment, stable across upgrades.
//
// WHY IT SPAWNS THE REAL SCRIPT (not a unit of the selection function): the claims are about what
// `quay-init.sh` produces on disk (a symlink and a config file). A unit test of the selector alone
// would pass while the step sat uncalled — the "implemented but never wired" failure hard rule 4
// 推论三 names. So the assertions read the link and the file the install actually wrote.
//
// HERMETIC: the plugin registry is a fixture `installed_plugins.json` under a fixture `$HOME`, and
// every installPath is a fixture directory. ⛔ The real `~/.claude/plugins/installed_plugins.json`
// is never read (its versions drift with each release ⇒ the criteria would red/green with the host).
//
// Run: scripts/test.sh plugin/test/quay-init-stable-plugin-link.test.mjs
//      node --experimental-strip-types --test plugin/test/quay-init-stable-plugin-link.test.mjs

import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import YAML from "yaml";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pluginDir = path.resolve(__dirname, "..");

const _tmp = [];
function makeTmp(prefix) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  _tmp.push(d);
  return d;
}
/** A worktree root on a REAL disk fs (/tmp is tmpfs and quay-init fail-closes on it). ONE per
 *  workspace, REUSED across that workspace's runs — a fresh root per run would change
 *  `loop.worktree_root` and make `ensure_loop_config` legitimately rewrite the file, turning the
 *  byte-identical-across-upgrade assertion below into a measurement of the test's own churn. */
const _wtRoots = new Map();
function stableWorktreeRoot(ws) {
  if (!_wtRoots.has(ws)) {
    const d = fs.mkdtempSync(path.join("/var/tmp", "qinit-link-wt-"));
    _tmp.push(d);
    _wtRoots.set(ws, d);
  }
  return _wtRoots.get(ws);
}
after(() => {
  for (const d of _tmp) {
    try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* best-effort */ }
  }
});

/** A fixture plugin "install" directory: `<root>/cache/quay/quay/<version>/` + the provider subtree the
 *  project link is expected to expose. Returns the version dir (the symlink target). */
function makeInstallDir(version) {
  const cacheRoot = makeTmp("qinit-link-cache-");
  const dir = path.join(cacheRoot, "cache", "quay", "quay", version);
  fs.mkdirSync(path.join(dir, "vendor", "quay-native", "dist"), { recursive: true });
  fs.writeFileSync(path.join(dir, "VERSION"), `${version}\n`, "utf8");
  return dir;
}

function writeRegistry(home, entries) {
  fs.mkdirSync(path.join(home, ".claude", "plugins"), { recursive: true });
  fs.writeFileSync(
    path.join(home, ".claude", "plugins", "installed_plugins.json"),
    JSON.stringify({ version: 2, plugins: { "quay@quay": entries } }, null, 2),
    "utf8",
  );
}

/** Run the REAL quay-init.sh against `ws`, with the fixture HOME driving plugin selection. */
function runInit(ws, home, extraArgs = []) {
  const res = spawnSync(
    "bash",
    [
      path.join(pluginDir, "scripts", "quay-init.sh"),
      "--root", ws,
      "--test-command", "node --test",
      "--worktree-root", stableWorktreeRoot(ws),
      ...extraArgs,
    ],
    { cwd: ws, encoding: "utf8", env: { ...process.env, CLAUDE_PLUGIN_ROOT: pluginDir, HOME: home } },
  );
  return { status: res.status, stdout: res.stdout ?? "", stderr: res.stderr ?? "" };
}

function readConfig(ws) {
  return fs.readFileSync(path.join(ws, ".quay", "config.yml"), "utf8");
}
function linkTarget(ws) {
  const p = path.join(ws, ".quay", "plugin");
  const st = fs.lstatSync(p);
  assert.ok(st.isSymbolicLink(), `<ws>/.quay/plugin must be a symlink; got mode ${st.mode.toString(8)}`);
  return fs.readlinkSync(p);
}

const CACHE_VERSION_SEGMENT = /\/cache\/quay\/quay\/\d+\.\d+\.\d+(?:-[0-9A-Za-z.]+)?\//;

// ── AC1 ───────────────────────────────────────────────────────────────────────────────────────────
test("AC1 — fresh init: .quay/plugin symlink → scope installPath; config carries NO version segment", () => {
  const ws = makeTmp("qinit-link-ws-");
  const home = makeTmp("qinit-link-home-");
  const install = makeInstallDir("0.10.0");
  writeRegistry(home, [{ scope: "local", projectPath: ws, installPath: install, version: "0.10.0" }]);

  const r = runInit(ws, home);
  assert.equal(r.status, 0, `init must exit 0\nstdout:\n${r.stdout}\nstderr:\n${r.stderr}`);

  // ① the link exists and points at THIS project's scope installPath.
  assert.equal(linkTarget(ws), install, `<ws>/.quay/plugin must point at the scope installPath`);

  // ② the config's provider binding names the link, never the versioned cache dir.
  const cfg = readConfig(ws);
  const doc = YAML.parse(cfg);
  const providerPath = doc.providers.native.path;
  const mcpEntry = doc.providers.native.mcp_entry;
  assert.equal(
    providerPath,
    path.join(ws, ".quay", "plugin", "vendor", "quay-native"),
    `providers.native.path must be the stable project link:\n${cfg}`,
  );
  assert.ok(
    !CACHE_VERSION_SEGMENT.test(providerPath),
    `providers.native.path must not carry a /cache/quay/quay/<version>/ segment: ${providerPath}`,
  );
  const runtimeRef = mcpEntry.find((a) => typeof a === "string" && a.endsWith("quay-native.js"));
  assert.ok(runtimeRef, `mcp_entry must carry the native runtime bundle: ${JSON.stringify(mcpEntry)}`);
  assert.ok(
    !CACHE_VERSION_SEGMENT.test(runtimeRef),
    `mcp_entry runtime must not carry a /cache/quay/quay/<version>/ segment: ${runtimeRef}`,
  );
  // Enumerate the whole file too (the two reads above only cover the two keys we know about).
  assert.ok(!CACHE_VERSION_SEGMENT.test(cfg), `no /cache/quay/quay/<version>/ segment anywhere in the config:\n${cfg}`);
});

test("AC1③ — a plugin UPGRADE re-run re-points the LINK and leaves the config byte-identical", () => {
  const ws = makeTmp("qinit-link-ws-");
  const home = makeTmp("qinit-link-home-");
  const installA = makeInstallDir("0.10.0");
  writeRegistry(home, [{ scope: "project", projectPath: ws, installPath: installA, version: "0.10.0" }]);

  assert.equal(runInit(ws, home).status, 0, "baseline install");
  const before = readConfig(ws);
  assert.equal(linkTarget(ws), installA, "baseline link");

  // Simulate a plugin UPGRADE: the registry now points at a NEWER version dir. Nothing else changes.
  const installB = makeInstallDir("0.11.0");
  writeRegistry(home, [{ scope: "project", projectPath: ws, installPath: installB, version: "0.11.0" }]);
  const r = runInit(ws, home);
  assert.equal(r.status, 0, `upgrade re-run must exit 0\nstdout:\n${r.stdout}\nstderr:\n${r.stderr}`);

  assert.equal(linkTarget(ws), installB, `the link must follow the upgrade`);
  assert.equal(readConfig(ws), before, `the config must be byte-identical across the upgrade (only the link moves)`);
  assert.match(r.stdout, /linked: \.quay\/plugin -> /, `the re-point must be reported: ${r.stdout}`);
});

// ── AC2 — scope selection ─────────────────────────────────────────────────────────────────────────
test("AC2① — a projectPath-matching local entry WINS over a newer user entry", () => {
  const ws = makeTmp("qinit-link-ws-");
  const home = makeTmp("qinit-link-home-");
  const local = makeInstallDir("0.10.0");
  const user = makeInstallDir("0.14.0");
  writeRegistry(home, [
    { scope: "local", projectPath: ws, installPath: local, version: "0.10.0" },
    { scope: "user", installPath: user, version: "0.14.0" },
  ]);

  assert.equal(runInit(ws, home).status, 0);
  assert.equal(linkTarget(ws), local, `the project-scope entry pins this project even when a newer user install exists`);
});

test("AC2② — with no local/project entry, the user entry is used", () => {
  const ws = makeTmp("qinit-link-ws-");
  const home = makeTmp("qinit-link-home-");
  const user = makeInstallDir("0.14.0");
  writeRegistry(home, [{ scope: "user", installPath: user, version: "0.14.0" }]);

  assert.equal(runInit(ws, home).status, 0);
  assert.equal(linkTarget(ws), user, `falls back to the user-scope install`);
});

test("AC2③ — only a project-scope entry MISSING projectPath ⇒ NOT-EVALUATED and the link is unchanged", () => {
  const ws = makeTmp("qinit-link-ws-");
  const home = makeTmp("qinit-link-home-");
  const good = makeInstallDir("0.10.0");
  writeRegistry(home, [{ scope: "project", projectPath: ws, installPath: good, version: "0.10.0" }]);
  assert.equal(runInit(ws, home).status, 0, "baseline install");
  assert.equal(linkTarget(ws), good, "baseline link");

  // The registry now carries ONLY an undecidable entry (project scope, no projectPath).
  writeRegistry(home, [{ scope: "project", installPath: makeInstallDir("0.99.0"), version: "0.99.0" }]);
  const r = runInit(ws, home);
  assert.equal(r.status, 0, `init must still exit 0\nstdout:\n${r.stdout}\nstderr:\n${r.stderr}`);
  assert.match(r.stdout, /NOT-EVALUATED/, `the undecidable registry must be reported: ${r.stdout}`);
  assert.equal(linkTarget(ws), good, `the existing link must be LEFT UNCHANGED (not silently re-pointed or removed)`);
});

test("AC2③b — an unreadable/absent registry also prints NOT-EVALUATED and leaves the link untouched", () => {
  const ws = makeTmp("qinit-link-ws-");
  const home = makeTmp("qinit-link-home-");
  const good = makeInstallDir("0.10.0");
  writeRegistry(home, [{ scope: "user", installPath: good, version: "0.10.0" }]);
  assert.equal(runInit(ws, home).status, 0);
  assert.equal(linkTarget(ws), good);

  fs.rmSync(path.join(home, ".claude", "plugins", "installed_plugins.json"));
  const r = runInit(ws, home);
  assert.equal(r.status, 0, `init must still exit 0 when the registry is gone\nstderr:\n${r.stderr}`);
  assert.match(r.stdout, /NOT-EVALUATED/, `an unreadable registry is "cannot decide", not an error: ${r.stdout}`);
  assert.equal(linkTarget(ws), good, `the link must survive an unreadable registry`);
});

// ── AC3 — `-dev` exclusion ────────────────────────────────────────────────────────────────────────
test("AC3 — a `-dev` user entry is excluded; the highest NON-dev user entry wins", () => {
  const ws = makeTmp("qinit-link-ws-");
  const home = makeTmp("qinit-link-home-");
  const dev = makeInstallDir("0.12.0-dev");
  const release = makeInstallDir("0.11.0");
  writeRegistry(home, [
    { scope: "user", installPath: dev, version: "0.12.0-dev" },
    { scope: "user", installPath: release, version: "0.11.0" },
  ]);

  const r = runInit(ws, home);
  assert.equal(r.status, 0, `init must exit 0\nstdout:\n${r.stdout}\nstderr:\n${r.stderr}`);
  assert.equal(linkTarget(ws), release, `a -dev build is not an install: the link must point at 0.11.0, not 0.12.0-dev`);
  assert.notEqual(linkTarget(ws), dev, `⛔ the -dev dir must never be linked`);
});

// ── AC6 — the scoped gate itself ran something (guards against a silently-empty selection) ────────
test("AC6 — this file is itself the scoped-gate test for the task (sanity: it is not empty)", () => {
  assert.ok(fs.statSync(fileURLToPath(import.meta.url)).size > 1000, "the test file must be non-trivial");
});
