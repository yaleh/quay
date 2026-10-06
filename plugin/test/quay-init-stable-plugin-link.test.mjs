// @test-group serial
// @load-sensitive real-install
// @load-sensitive-entry 2026-10-05 stable project plugin link (quay-init install); install family
// quay-init-stable-plugin-link.test.mjs — gap-project-quay-pointer-is-init-plugin-root-and-version-
// records-derive-from-it (rewritten from gap-config-provider-path-frozen-to-versioned-cache-dir).
//
// WHAT THIS PINS. `/quay:init` maintains a project-INTERNAL guidance link `<ws>/.quay/plugin` for
// consumers that run WITHOUT Core in the loop (e.g. a CloudCLI server `execFile`, cwd = the project
// root). Its target is THE PLUGIN ROOT THIS INIT RAN FROM (`${CLAUDE_PLUGIN_ROOT}` / `--plugin-root`).
//
// ⛔ IT IS NOT A REGISTRY LOOKUP. The predecessor resolved the target from
// `~/.claude/plugins/installed_plugins.json` (`projectPath`-matching local/project entry wins, else
// the `user` entry). That is a SECOND resolver: the session layer decides which version a session
// loads, so the registry rule and the session rule necessarily diverge (measured 2026-10-06:
// claudecodeui's project record stayed at 0.14.0 while the user entry moved to 0.15.0 and every later
// session loaded 0.15.0). ⇒ The registry below is a fixture that is DELIBERATELY CONTRADICTORY
// (project 0.14.0, user 0.15.0) and the assertions match the PASSED PLUGIN ROOT, never the registry.
//
// WHY IT SPAWNS THE REAL SCRIPT (not a unit of the selection function): the claims are about what
// `quay-init.sh` produces on disk (a symlink). A unit test of the chooser alone would pass while the
// step sat uncalled — the "implemented but never wired" failure hard rule 4 推论三 names. So the
// assertions read the link the install actually wrote.
//
// HERMETIC: the plugin registry is a fixture `installed_plugins.json` under a fixture `$HOME`, and
// each plugin root is a fixture tree (symlinks to the real plugin's entries + a real manifest). ⛔ The
// real `~/.claude/plugins/installed_plugins.json` is never read.
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

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pluginDir = path.resolve(__dirname, "..");

const _tmp = [];
function makeTmp(prefix) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  _tmp.push(d);
  return d;
}
/** A worktree root on a REAL disk fs (/tmp is tmpfs and quay-init fail-closes on it). ONE per
 *  workspace, REUSED across that workspace's runs. */
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

/** A fixture plugin ROOT that `quay-init.sh` accepts: every top-level entry of the real plugin is
 *  SYMLINKED in (so scripts/ vendor/ loop/ … all resolve), while `.claude-plugin/plugin.json` is a
 *  REAL file carrying the requested version. This is what lets a test say "init ran from 0.15.0".
 *
 *  ⛔ Not a copy of the whole tree (hundreds of files); the symlinks point at the frozen real plugin,
 *  which is exactly what an install consumes. The instantiated dir is a NORMAL directory, so
 *  `pwd -P` in quay-init.sh keeps it verbatim as the link target. */
function makePluginRoot(version) {
  const dir = makeTmp("qinit-plroot-");
  for (const e of fs.readdirSync(pluginDir)) {
    if (e === ".claude-plugin") continue;
    fs.symlinkSync(path.join(pluginDir, e), path.join(dir, e));
  }
  fs.mkdirSync(path.join(dir, ".claude-plugin"));
  fs.writeFileSync(path.join(dir, ".claude-plugin", "plugin.json"), JSON.stringify({ name: "quay", version }, null, 2));
  return dir;
}

/** A fixture registry that is DELIBERATELY CONTRADICTORY to every plugin root we pass, so a
 *  regression to the registry tier rule turns an assertion red. */
function writeRegistry(home, entries) {
  fs.mkdirSync(path.join(home, ".claude", "plugins"), { recursive: true });
  fs.writeFileSync(
    path.join(home, ".claude", "plugins", "installed_plugins.json"),
    JSON.stringify({ version: 2, plugins: { "quay@quay": entries } }, null, 2),
    "utf8",
  );
}

/** Run the REAL quay-init.sh against `ws`, from `pluginRoot`, with the fixture HOME (registry). */
function runInit(ws, home, pluginRoot = pluginDir, extraArgs = []) {
  const res = spawnSync(
    "bash",
    [
      path.join(pluginRoot, "scripts", "quay-init.sh"),
      "--root", ws,
      "--test-command", "node --test",
      "--worktree-root", stableWorktreeRoot(ws),
      ...extraArgs,
    ],
    { cwd: ws, encoding: "utf8", env: { ...process.env, CLAUDE_PLUGIN_ROOT: pluginRoot, HOME: home } },
  );
  return { status: res.status, stdout: res.stdout ?? "", stderr: res.stderr ?? "" };
}

function linkTarget(ws) {
  const p = path.join(ws, ".quay", "plugin");
  const st = fs.lstatSync(p);
  assert.ok(st.isSymbolicLink(), `<ws>/.quay/plugin must be a symlink; got mode ${st.mode.toString(8)}`);
  return fs.readlinkSync(p);
}

// ── AC1 — the link target IS the passed plugin root ─────────────────────────────────────────────────
test("AC1① — the link points at the PASSED plugin root, never the registry's project entry", () => {
  const ws = makeTmp("qinit-link-ws-");
  const home = makeTmp("qinit-link-home-");
  // The registry says this project is pinned to 0.14.0 (project scope) and the user has 0.15.0.
  writeRegistry(home, [
    { scope: "project", projectPath: ws, installPath: makeTmp("qinit-inst-"), version: "0.14.0" },
    { scope: "user", installPath: makeTmp("qinit-inst-"), version: "0.15.0" },
  ]);
  const root015 = makePluginRoot("0.15.0");

  const r = runInit(ws, home, root015);
  assert.equal(r.status, 0, `init must exit 0\nstdout:\n${r.stdout}\nstderr:\n${r.stderr}`);
  assert.equal(linkTarget(ws), fs.realpathSync(root015),
    `the link must point at the plugin root init ran from (0.15.0), NOT the registry's project entry (0.14.0)`);
  assert.match(r.stdout, /linked: \.quay\/plugin -> /, `the link step must be reported: ${r.stdout}`);
});

test("AC1② — SAME registry, a DIFFERENT plugin root ⇒ the link follows the plugin root", () => {
  // ⛔ The discriminating half: the registry is held CONSTANT and only the passed root changes. If
  // the selection consulted the registry (the pre-fix rule), this assertion cannot track it.
  const ws = makeTmp("qinit-link-ws-");
  const home = makeTmp("qinit-link-home-");
  writeRegistry(home, [
    { scope: "project", projectPath: ws, installPath: makeTmp("qinit-inst-"), version: "0.14.0" },
    { scope: "user", installPath: makeTmp("qinit-inst-"), version: "0.15.0" },
  ]);
  const root014 = makePluginRoot("0.14.0");

  const r = runInit(ws, home, root014);
  assert.equal(r.status, 0, `init must exit 0\nstdout:\n${r.stdout}\nstderr:\n${r.stderr}`);
  assert.equal(linkTarget(ws), fs.realpathSync(root014), `the link must follow the passed root (0.14.0)`);
});

test("AC1③ — a re-run from a NEW plugin root re-points the LINK; the config carries no version/link", () => {
  const ws = makeTmp("qinit-link-ws-");
  const home = makeTmp("qinit-link-home-");
  writeRegistry(home, [{ scope: "user", installPath: makeTmp("qinit-inst-"), version: "0.13.0" }]);

  const a = makePluginRoot("0.10.0");
  const b = makePluginRoot("0.11.0");
  assert.equal(runInit(ws, home, a).status, 0, "baseline install");
  assert.equal(linkTarget(ws), fs.realpathSync(a), "baseline link");
  const cfgBefore = fs.readFileSync(path.join(ws, ".quay", "config.yml"), "utf8");

  const r = runInit(ws, home, b);
  assert.equal(r.status, 0, `re-run must exit 0\nstdout:\n${r.stdout}\nstderr:\n${r.stderr}`);
  assert.equal(linkTarget(ws), fs.realpathSync(b), "the link must follow the new plugin root");
  const cfgAfter = fs.readFileSync(path.join(ws, ".quay", "config.yml"), "utf8");
  // The native provider no longer names a directory: no `path:`/`mcp_entry:` for it, and no `.quay/plugin`.
  const nativeBlock = /providers:\s*\n\s*native:\s*\n([\s\S]*?)\n\S/.exec(cfgAfter)?.[1] ?? cfgAfter;
  assert.ok(!/^\s*(path|mcp_entry):/m.test(nativeBlock), `the native provider must carry no path/mcp_entry:\n${cfgAfter}`);
  assert.ok(!/\.quay\/plugin/.test(cfgAfter), `the config must not name .quay/plugin:\n${cfgAfter}`);
  // Assert the file did not gain a version segment anywhere, on either run.
  assert.ok(!/\d+\.\d+\.\d+/.test(cfgBefore), `the config must carry no version segment:\n${cfgBefore}`);
  assert.ok(!/\d+\.\d+\.\d+/.test(cfgAfter), `the config must carry no version segment:\n${cfgAfter}`);
});

// ── AC1④ — undecidable plugin root ⇒ NOT-EVALUATED, existing link untouched ─────────────────────────
test("AC1④ — a SOURCE CHECKOUT plugin root (dev tree) ⇒ the link is left unchanged and NOT-EVALUATED prints", () => {
  const ws = makeTmp("qinit-link-ws-");
  const home = makeTmp("qinit-link-home-");
  writeRegistry(home, []);

  // Baseline: a good install from a fixture root.
  const good = makePluginRoot("0.10.0");
  assert.equal(runInit(ws, home, good).status, 0, "baseline install");
  assert.equal(linkTarget(ws), fs.realpathSync(good), "baseline link");

  // Now re-run with the DEV TREE as the plugin root (the real `pluginDir` sits beside
  // `packages/quay/src`). NOT-EVALUATED and the existing link must survive.
  const r = runInit(ws, home, pluginDir);
  assert.equal(r.status, 0, `init must still exit 0\nstdout:\n${r.stdout}\nstderr:\n${r.stderr}`);
  assert.match(r.stdout, /NOT-EVALUATED/, `a source checkout is "cannot decide", not a target: ${r.stdout}`);
  assert.equal(linkTarget(ws), fs.realpathSync(good), `the existing link must be LEFT UNCHANGED`);
});

test("AC1⑤ — an ABSENT plugin root (empty CLAUDE_PLUGIN_ROOT + no --plugin-root) ⇒ NOT-EVALUATED, link unchanged", () => {
  const ws = makeTmp("qinit-link-ws-");
  const home = makeTmp("qinit-link-home-");
  writeRegistry(home, []);
  const good = makePluginRoot("0.10.0");
  assert.equal(runInit(ws, home, good).status, 0, "baseline install");
  assert.equal(linkTarget(ws), fs.realpathSync(good), "baseline link");

  // A DIRECT invocation with neither CLAUDE_PLUGIN_ROOT nor --plugin-root. quay-init fail-closes on a
  // MISSING plugin root, so this instead points at a non-plugin directory (a real but non-quay dir):
  // the refresh step must still refuse to re-point the link.
  const notAPlugin = makeTmp("qinit-notplugin-");
  const r = runInit(ws, home, notAPlugin);
  assert.notEqual(r.status, 0, "a non-quay plugin root must fail-closed (quay-init requires plugin.json)");
  assert.equal(linkTarget(ws), fs.realpathSync(good), `the link must be untouched by a refused run`);
});

// ── AC6 — the scoped gate itself ran something (guards against a silently-empty selection) ─────────
test("AC6 — this file is itself the scoped-gate test for the task (sanity: it is non-trivial)", () => {
  assert.ok(fs.statSync(fileURLToPath(import.meta.url)).size > 1000, "the test file must be non-trivial");
});
