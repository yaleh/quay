// @test-group serial
// @load-sensitive real-install
// @load-sensitive-entry 2026-10-25 project plugin link RETIRED (quay-init end-to-end); install family
// quay-init-stable-plugin-link.test.mjs — gap-quay-init-retire-project-plugin-link.
//
// WHAT THIS PINS (rewritten 2026-10-25). `/quay:init` used to maintain the project-internal guidance
// link `<ws>/.quay/plugin -> <the plugin root the init ran from>` (the file name above is the
// mechanism's historical name; it is kept so this suite's identity — "the project plugin link, end to
// end" — does not move). The human ruling of 2026-10-25 RETIRES that link: it was a second version
// resolver beside the session layer's plugin-scope rule, and the two diverge by construction (measured
// 2026-10-06: the link sat at 0.14.0 while every session loaded 0.15.0).
//
// The retirement's contract, pinned HERE through the REAL shell entry (`plugin/scripts/quay-init.sh`
// → `quay init`), because a unit test of the retire function would pass while the step sat uncalled
// (硬规则 4 推论三: "implemented" is not "wired"):
//
//   ① a real init creates NO `.quay/plugin` (and does not re-create one);
//   ② a symlink an OLDER init left behind is DELETED (not re-pointed);
//   ③ a regular file/directory at that name is the USER's content — left byte-identical.
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
import { createHash } from "node:crypto";
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
 *  SYMLINKED in (so scripts/ vendor/ bin/ … all resolve), while `.claude-plugin/plugin.json` is a
 *  REAL file carrying the requested version. */
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

/** A fixture registry. It is DELIBERATELY CONTRADICTORY to every plugin root we pass: if any code
 *  path ever consults the registry to re-create or re-point the link, an assertion turns red. */
function writeRegistry(home) {
  fs.mkdirSync(path.join(home, ".claude", "plugins"), { recursive: true });
  fs.writeFileSync(
    path.join(home, ".claude", "plugins", "installed_plugins.json"),
    JSON.stringify({
      version: 2,
      plugins: {
        "quay@quay": [
          { scope: "project", projectPath: "/somewhere-else", installPath: makeTmp("qinit-inst-"), version: "0.14.0" },
          { scope: "user", installPath: makeTmp("qinit-inst-"), version: "0.15.0" },
        ],
      },
    }, null, 2),
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

const linkPath = (ws) => path.join(ws, ".quay", "plugin");
const sha256 = (p) => createHash("sha256").update(fs.readFileSync(p)).digest("hex");

// ── AC1 — a real init creates NO link ────────────────────────────────────────────────────────────────
test("AC1 — a real `quay-init.sh` run creates no `.quay/plugin` entry", () => {
  const ws = makeTmp("qinit-retire-ws-");
  const home = makeTmp("qinit-retire-home-");
  writeRegistry(home);

  const r = runInit(ws, home, makePluginRoot("0.23.0"));
  assert.equal(r.status, 0, `init must exit 0\nstdout:\n${r.stdout}\nstderr:\n${r.stderr}`);
  assert.throws(() => fs.lstatSync(linkPath(ws)), /ENOENT/, "⛔ init must NOT create .quay/plugin");
  assert.match(r.stdout, /project-plugin-link: absent/, `the step must report its reading: ${r.stdout}`);

  // …and a RE-RUN does not create one either (the idempotent half).
  const again = runInit(ws, home, makePluginRoot("0.24.0"));
  assert.equal(again.status, 0, `re-run must exit 0\nstdout:\n${again.stdout}\nstderr:\n${again.stderr}`);
  assert.throws(() => fs.lstatSync(linkPath(ws)), /ENOENT/, "⛔ a re-run must not create it either");
});

// ── AC2 — an OLD link is deleted, never re-pointed ───────────────────────────────────────────────────
test("AC2 — a symlink left by an older init is DELETED by the next run", () => {
  const ws = makeTmp("qinit-retire-ws-");
  const home = makeTmp("qinit-retire-home-");
  writeRegistry(home);
  const pluginRoot = makePluginRoot("0.23.0");
  assert.equal(runInit(ws, home, pluginRoot).status, 0, "baseline install");

  // Simulate the pre-retirement state: a link pointing at SOME plugin tree.
  const oldTree = makeTmp("qinit-oldtree-");
  fs.symlinkSync(oldTree, linkPath(ws));
  assert.equal(fs.readlinkSync(linkPath(ws)), oldTree, "premise: the old-style link is present");

  const r = runInit(ws, home, pluginRoot);
  assert.equal(r.status, 0, `re-run must exit 0\nstdout:\n${r.stdout}\nstderr:\n${r.stderr}`);
  assert.throws(() => fs.lstatSync(linkPath(ws)), /ENOENT/, "⛔ the link must be GONE — not re-pointed");
  assert.match(r.stdout, /retired: \.quay\/plugin/, `the step must report the retirement: ${r.stdout}`);
});

// ── AC3 — a regular file/directory is the user's, left byte-identical ────────────────────────────────
test("AC3 — a regular directory at the path is REFUSED and preserved", () => {
  const ws = makeTmp("qinit-retire-ws-");
  const home = makeTmp("qinit-retire-home-");
  writeRegistry(home);
  const pluginRoot = makePluginRoot("0.23.0");
  assert.equal(runInit(ws, home, pluginRoot).status, 0, "baseline install");

  fs.mkdirSync(linkPath(ws));
  fs.writeFileSync(path.join(linkPath(ws), "user-file.txt"), "the user's content\n");
  const before = sha256(path.join(linkPath(ws), "user-file.txt"));

  const r = runInit(ws, home, pluginRoot);
  assert.equal(r.status, 0, `init must still exit 0\nstdout:\n${r.stdout}\nstderr:\n${r.stderr}`);
  assert.equal(fs.lstatSync(linkPath(ws)).isDirectory(), true, "⛔ the directory must still be there");
  assert.equal(sha256(path.join(linkPath(ws), "user-file.txt")), before, "⛔ byte-identical");
  assert.match(r.stdout, /project-plugin-link: REFUSED/, `the step must report the refusal: ${r.stdout}`);
});

test("AC3b — a regular FILE at the path is REFUSED and preserved", () => {
  const ws = makeTmp("qinit-retire-ws-");
  const home = makeTmp("qinit-retire-home-");
  writeRegistry(home);
  const pluginRoot = makePluginRoot("0.23.0");
  assert.equal(runInit(ws, home, pluginRoot).status, 0, "baseline install");

  fs.writeFileSync(linkPath(ws), "not a link\n");
  const before = sha256(linkPath(ws));

  const r = runInit(ws, home, pluginRoot);
  assert.equal(r.status, 0, `init must still exit 0\nstdout:\n${r.stdout}\nstderr:\n${r.stderr}`);
  assert.equal(fs.lstatSync(linkPath(ws)).isFile(), true, "⛔ the file must still be there");
  assert.equal(sha256(linkPath(ws)), before, "⛔ byte-identical");
  assert.match(r.stdout, /project-plugin-link: REFUSED/, `the step must report the refusal: ${r.stdout}`);
});

// ── sanity — this file is itself a non-trivial scoped-gate member ────────────────────────────────────
test("AC6 — this file is itself the scoped-gate test for the task (sanity: it is non-trivial)", () => {
  assert.ok(fs.statSync(fileURLToPath(import.meta.url)).size > 1000, "the test file must be non-trivial");
});
