// @test-group engine
// quay-init-loop-helpers.mjs — shared helpers for the quay-init-loop test family.
//
// Split out of quay-init-loop.test.mjs (2026-08-07, inner red-window fix): the original 1286-line /
// 54-test file exhausted the node:test worker event loop under heavy blocking spawnSync (each of
// 37 --loop tests spawns a real quay-init.sh, which spawns python3 children), self-failing at
// ~167s with 'Promise resolution is still pending but the event loop has already resolved'.
// Splitting into smaller files (each ~18 tests, well under the exhaustion threshold) keeps each
// file green; the shared helpers live here so all split files resolve the SAME quay-init surface.
//
// gap-quay-init-laydown-dominant-red-suite-blocker (root-cause verdict 2026-08-07 06:3x):
//   the 44-failure cluster was (1) laydown/referenced-not-landed gaps — already fixed — and
//   (2) this worker event-loop exhaustion from an oversized single test file.

import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const pluginDir = path.resolve(__dirname, "..");

export function makeTmp(prefix = "quay-init-") {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  _tmpDirs.push(dir);
  return dir;
}
export function cleanup(dir) {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* best-effort */ }
}

// A worktree root the validation will ACCEPT: a real disk path, not tmpfs. /tmp is tmpfs on dev
// boxes (and the whole point of gap-the-shipped-tick-doc-... is that worktrees must NOT live
// there), so the sibling-of-repo default would resolve to /tmp for a /tmp-backed test workspace
// and quay-init would correctly fail closed. /var/tmp is the disk-backed tmp on Linux; prefer it.
// The dirs land in a carrier array cleaned by an after() hook (the doc-store/adr-store pattern),
// so R6 does not read the helper-return as an uncovered mkdtemp leak.
const _worktreeTestRoots = [];
// Every makeTmp() dir created by this helper (incl. every laydownWorkspace copy) is removed once at
// the end of the importing test file — the shared fixture (/var/tmp, content-addressed) is the one
// deliberate exception, and it never goes through makeTmp. Without this, each `laydownWorkspace`
// copy leaked a `rtv-*` / `laydown-*` dir per run (measured: 120 `rtv-*` dirs / run family).
const _tmpDirs = [];
after(() => {
  for (const d of _worktreeTestRoots) {
    try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* best-effort */ }
  }
  for (const d of _tmpDirs) {
    try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* best-effort */ }
  }
  _tmpDirs.length = 0;
});
export function diskWorktreeRoot() {
  let dir = null;
  for (const base of ["/var/tmp", os.tmpdir()]) {
    try {
      const t = spawnSync("stat", ["-f", "-c", "%T", base], { encoding: "utf8" });
      if (t.status === 0 && t.stdout.trim() !== "tmpfs") { dir = fs.mkdtempSync(path.join(base, "quay-wt-test-")); break; }
    } catch { /* try next base */ }
  }
  if (!dir) dir = fs.mkdtempSync(path.join(os.tmpdir(), "quay-wt-test-"));
  _worktreeTestRoots.push(dir);
  return dir;
}

export function runInit(workspace, args = [], pluginRoot = pluginDir) {
  // --loop tests now need an explicit disk worktree root (the default sibling-of-repo of a /tmp
  // test workspace is tmpfs and is correctly rejected). Inject one BEFORE the caller's args so an
  // explicit --worktree-root in args wins (last flag wins in the parser).
  const loop = args.includes("--loop");
  const extra = loop && !args.some((a) => a === "--worktree-root") ? ["--worktree-root", diskWorktreeRoot()] : [];
  return spawnSync("bash", [path.join(pluginRoot, "scripts", "quay-init.sh"), ...extra, ...args],
    {
      cwd: workspace,
      encoding: "utf8",
      env: { ...process.env, CLAUDE_PLUGIN_ROOT: pluginRoot },
    });
}

// ── Shared laydown template (gap-serial-segment-77-percent-cost-reduction-runner-grouping-listfiles AC2) ──
// Serial-segment analysis (2026-08-07): install/laydown is ~50% of the serial phase — every
// install-family test ran a REAL `quay-init --loop` (~6s in-suite, ~34s cold) into a fresh temp
// workspace. AC2: ONE real install per FILE process → a READ-ONLY template → each test `cp -a`
// the template and does its own delta. Two hard requirements:
//   ① `cp -a` preserves symlinks + permissions (so byte-identical assertions don't distort);
//   ② the template is READ-ONLY (write bits stripped from the whole tree) so one test's pollution
//      can never corrupt the shared template for every other test.
// The template's captured install result is returned too: every family test uses the SAME standard
// args (--project proj --test-command 'node --test' --tmux-session proj-0:0.0), so output-asserting
// tests keep asserting against the template's stdout/stderr (with the template's absolute path
// rewritten to the copy's) without a second real install.
const STANDARD_INIT_ARGS = (ws) => [
  "--loop", "--root", ws, "--project", "proj",
  "--test-command", "node --test", "--tmux-session", "proj-0:0.0",
];
const _laydownTemplate = { ws: null, install: null, wtRoot: null };

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// Shared prebuilt-install fixture (gap-serial-install-family-shared-prebuilt-fixture AC3)
// ═══════════════════════════════════════════════════════════════════════════════════════════════
// The serial phase's real-install family (12 files) each ran a full `quay-init --loop` install
// (r266: family sum=865s; measured setup ratio 82.6% in drift-report — AC2). AC3: ONE real install
// per SERIAL PHASE (not per file), shared across the whole family. Every family file's
// laydownTemplate() copies from THIS fixture (cp -a, safe: preserves symlinks+permissions; each copy
// is an independent writable root). The fixture itself is read-only (write bits stripped) so one
// copy's pollution can never corrupt it — the same AC2-② invariant the per-file template enforced.
//
// cp -al hard links are deliberately NOT used: hard-linked copies share inodes, so a copy's
// `chmod -R u+w` (laydownWorkspace's delta pattern) would strip the read-only guard from the shared
// fixture itself — breaking isolation for every other file. cp -a costs ~50-150ms per copy (measured
// in gap-serial-segment-77-... AC2) vs ~6-10s per install — the install is the cost, not the copy.
//
// Content-addressed: the fixture path hashes the installed plugin surface (plugin/scripts + loop/ +
// skills/init + the vendored dist bundles + package.json), so a plugin change yields a FRESH fixture
// (never a stale reuse) and an unchanged plugin reuses the previous run's fixture (a cache across
// serial phases — each copy rewrites the fixture's absolute path, so cross-run reuse is safe). Old
// fixtures (different hash) are simply orphaned in /var/tmp (disk-backed, cleaned on reboot; each is
// a few MB) — never cleaned by an individual file, which cannot know when the last consumer is done.
//
// Cross-file coordination: the serial phase runs family files at concurrency 2, so two files can
// build the fixture concurrently. The build is guarded by an atomic mkdir lock; a concurrent file
// polls for the ready marker instead of building twice. A stale lock (>120s, a crashed builder) is
// stolen and the build retried. FAILS LOUD: a fixture install that does not exit 0 is a real product
// defect, not something to paper over.
const FIXTURE_BASE = "/var/tmp"; // disk-backed (worktrees must not live in /tmp tmpfs — same convention as diskWorktreeRoot)
const FIXTURE_PREFIX = "quay-install-fixture-";

function _sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

// _hashOfRoots(roots, base): content-addressed sha1 over a sorted list of root dirs/files — the
// same walk the install fixture hash uses. Exported separately from _fixtureHash() so the
// workflow-dir coverage is directly testable with temp fixture inputs (gap-fixture-hash-omits-
// workflows-dirs, AC1/AC2). `base` is the anchor for the hashed relative paths (defaults to the
// plugin root, so the REAL fixture hash is stable across machine locations of the plugin).
export function _hashOfRoots(roots, base = pluginDir) {
  const h = createHash("sha1");
  const files = [];
  const walk = (d) => {
    let ents;
    try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else files.push(p);
    }
  };
  for (const r of roots) {
    const p = path.resolve(r);
    let st;
    try { st = fs.statSync(p); } catch { continue; }
    if (st.isDirectory()) walk(p);
    else files.push(p);
  }
  files.sort();
  for (const f of files) {
    h.update(path.relative(base, f));
    h.update(fs.readFileSync(f));
  }
  return h.digest("hex").slice(0, 16);
}

// Export (not just the private name) so quay-init-loop-fixture-hash.test.mjs can assert the real
// production hash covers the workflow roots directly.
export function _fixtureHash() {
  // Every installed-plugin surface the fixture content-addresses. Adding a root here means a change
  // to any file under it yields a FRESH fixture (never a stale reuse) — and the fixture is what
  // real-target-verify compares against, so a workflow-only change must be visible.
  const roots = [
    path.join(pluginDir, "scripts"),
    path.join(pluginDir, "loop"),
    path.join(pluginDir, "skills", "init"),
    // Shipped workflows (plugin/workflows/* → <workspace>/.claude/workflows/ on install) AND the
    // live repo-root copy (.claude/workflows/* — the dual-copy source of the shipped bundle,
    // gap-fixture-hash-omits-workflows-dirs). A fan-in-execute.js edit changes BOTH; either alone
    // must invalidate the fixture. Without these roots a workflow-only change reused a stale
    // fixture and real-target-verify reported a false would-conflict (occurrence 2/日 2026-08-17).
    path.join(pluginDir, "workflows"),
    path.join(pluginDir, "..", ".claude", "workflows"),
  ];
  // The vendored dist bundles are gitignored generated artifacts the install lays verbatim into the
  // target's .quay/runtime/ — include them when present so a rebuilt bundle yields a fresh fixture.
  for (const b of ["vendor/quay/dist/quay.js", "vendor/quay-native/dist/quay-native.js"]) {
    const p = path.join(pluginDir, b);
    if (fs.existsSync(p)) roots.push(p);
  }
  const pkg = path.join(pluginDir, "package.json");
  if (fs.existsSync(pkg)) roots.push(pkg);
  return _hashOfRoots(roots, pluginDir);
}

function _fixturePath() {
  return path.join(FIXTURE_BASE, `${FIXTURE_PREFIX}${_fixtureHash()}`);
}

function _makeReadOnly(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isSymbolicLink()) continue;
    const mode = fs.statSync(p).mode;
    if (e.isDirectory()) { fs.chmodSync(p, mode & ~0o222); _makeReadOnly(p); }
    else { fs.chmodSync(p, mode & ~0o222); }
  }
}

function _readFixtureInstall(ws) {
  try {
    const j = JSON.parse(fs.readFileSync(path.join(ws, ".install.json"), "utf8"));
    return { status: j.status, stdout: j.stdout, stderr: j.stderr };
  } catch {
    return null;
  }
}

// _buildSharedFixture(ws) — one real install into a clean fixture dir, then make it read-only and
// record the ready marker + the captured install result (so a cache-hit in another file/run can
// return the same install output that a fresh install would produce). Holds the lock.
function _buildSharedFixture(ws) {
  if (fs.existsSync(ws)) fs.rmSync(ws, { recursive: true, force: true });
  fs.mkdirSync(ws, { recursive: true });
  const wtRoot = diskWorktreeRoot();
  const install = runInit(ws, [...STANDARD_INIT_ARGS(ws), "--worktree-root", wtRoot]);
  if (install.status !== 0) {
    fs.rmSync(ws, { recursive: true, force: true });
    throw new Error(`shared install fixture build failed:\n${install.stderr}`);
  }
  fs.writeFileSync(path.join(ws, ".install.json"),
    JSON.stringify({ status: install.status, stdout: install.stdout, stderr: install.stderr }));
  _makeReadOnly(ws);
  fs.writeFileSync(path.join(ws, ".fixture-ready"), `${pluginDir}\n`);
  return { ws, install, wtRoot };
}

// sharedFixture() — the family's ONE real install per serial phase. Lazy, single-flight (atomic
// mkdir lock), cached across files AND runs (content-addressed). Returns { ws, install, wtRoot }:
// ws is the read-only fixture root; install is the captured install result (from .install.json on a
// cache hit), used by laydownWorkspace to return install output with paths rewritten to the copy.
export function sharedFixture() {
  const ws = _fixturePath();
  const readyMarker = path.join(ws, ".fixture-ready");
  // A fixture is reusable only when BOTH the ready marker AND a valid captured install result exist
  // (a marker without .install.json is a partial/corrupt build — rebuild, don't reuse).
  const ready = () => fs.existsSync(readyMarker) && _readFixtureInstall(ws) !== null;
  if (ready()) {
    return { ws, install: _readFixtureInstall(ws), wtRoot: null };
  }
  const lock = `${ws}.lock`;
  let held = false;
  try { fs.mkdirSync(lock); held = true; } catch { /* another file holds the lock — wait below */ }
  if (!held) {
    const deadline = Date.now() + 180000;
    while (Date.now() < deadline) {
      if (ready()) return { ws, install: _readFixtureInstall(ws), wtRoot: null };
      // Steal a stale lock (a crashed builder) — the lock dir's mtime is the acquisition time.
      try {
        const st = fs.statSync(lock);
        if (Date.now() - st.mtimeMs > 120000) {
          fs.rmSync(lock, { recursive: true, force: true });
          try { fs.mkdirSync(lock); held = true; break; } catch { /* raced — keep waiting */ }
        }
      } catch {
        // Lock vanished (released between check and stat) — retry acquiring it.
        try { fs.mkdirSync(lock); held = true; break; } catch { /* raced */ }
      }
      _sleepSync(250);
    }
    if (!held) {
      throw new Error(`shared install fixture build timed out (lock ${lock} held by another serial-phase file)`);
    }
  }
  try {
    return _buildSharedFixture(ws);
  } finally {
    fs.rmSync(lock, { recursive: true, force: true });
  }
}

// laydownTemplate() — the read-only template THIS file's tests copy from. Now served by the SHARED
// prebuilt-install fixture (AC3): one real install per serial phase, reused by the whole family.
// The template lives at a content-addressed /var/tmp path (never a shared-checkout path, so the
// test-isolation R3/R8 ratchets stay green). FAILS LOUD: a fixture install that does not exit 0 is
// a real product defect, not something to paper over.
export function laydownTemplate() {
  if (_laydownTemplate.ws) return _laydownTemplate;
  const fixture = sharedFixture();
  _laydownTemplate.ws = fixture.ws;
  _laydownTemplate.install = fixture.install;
  _laydownTemplate.wtRoot = fixture.wtRoot;
  return _laydownTemplate;
}

// laydownWorkspace([prefix]) — a fresh WRITABLE copy of the read-only laydown template, with the
// template's absolute workspace path rewritten to the copy's path in the config files that embed
// it, and the loop.worktree_root pointed at a FRESH disk root (so two copies never share a
// worktree root). Returns { ws, install } — install is the TEMPLATE's captured install result
// (paths rewritten to the copy), so output-asserting tests keep their assertions without a second
// real install.
export function laydownWorkspace(prefix = "laydown-") {
  const t = laydownTemplate();
  const ws = makeTmp(prefix);
  // cp -a preserves symlinks + permissions (AC2 ①). The source template is read-only, so the copy
  // inherits read-only perms; restore write bits on the COPY so the test can do its own delta.
  const cp = spawnSync("cp", ["-a", `${t.ws}/.`, ws], { encoding: "utf8" });
  if (cp.status !== 0) {
    cleanup(ws);
    throw new Error(`laydown template cp -a failed:\n${cp.stderr}`);
  }
  spawnSync("chmod", ["-R", "u+w", ws]);
  // Rewrite the template's absolute path → the copy's path where the installed tree embeds it
  // (.quay/config.yml carries the provider path / tasks_dir / mcp_entry / repo_root), and give the
  // copy a FRESH loop.worktree_root (never the template's, so copies never collide on worktrees).
  const cfg = path.join(ws, ".quay", "config.yml");
  if (fs.existsSync(cfg)) {
    const freshWt = diskWorktreeRoot();
    const rewritten = fs.readFileSync(cfg, "utf8")
      .split(t.ws).join(ws)
      .split("\n").map((line) =>
        line.startsWith("  worktree_root:") ? `  worktree_root: ${freshWt}` : line)
      .join("\n");
    fs.writeFileSync(cfg, rewritten);
  }
  const install = {
    status: t.install.status,
    stdout: t.install.stdout.split(t.ws).join(ws),
    stderr: t.install.stderr.split(t.ws).join(ws),
  };
  return { ws, install };
}

// extractRefs(pluginRoot, prefix): every `<prefix>/<file>` reference in the shipped skills + tick
// docs — the SAME extraction quay-init.sh's verify_referenced_landed uses, so the test's landing
// assertion and the installer's own check cannot disagree about what the referenced set is.
export function extractRefs(pluginRoot, prefix) {
  const files = [];
  for (const d of fs.readdirSync(path.join(pluginRoot, "skills"), { withFileTypes: true })) {
    if (!d.isDirectory()) continue;
    const f = path.join(pluginRoot, "skills", d.name, "SKILL.md");
    if (fs.existsSync(f)) files.push(f);
  }
  const loopDir = path.join(pluginRoot, "loop");
  for (const f of fs.readdirSync(loopDir)) {
    if (f.endsWith(".md")) files.push(path.join(loopDir, f));
  }
  const re = new RegExp(`(?:${prefix})/[a-zA-Z0-9._-]+`, "g");
  const refs = new Set();
  for (const f of files) {
    const text = fs.readFileSync(f, "utf8");
    let m;
    while ((m = re.exec(text)) !== null) refs.add(m[0]);
  }
  return [...refs].sort();
}

// declaredSet(pluginRoot, kind): the machine-readable `<!-- <kind>: <path> -->` declarations in
// plugin/skills/init/SKILL.md — `self-create` (local-state files the first run creates, AC8) and
// `reference-doc` (quay-specific template prose, not a loop-mechanism deliverable).
export function declaredSet(pluginRoot, kind) {
  const skill = fs.readFileSync(path.join(pluginRoot, "skills", "init", "SKILL.md"), "utf8");
  const re = new RegExp(`<!-- ${kind}: ([a-zA-Z0-9._/-]+) -->`, "g");
  const set = new Set();
  let m;
  while ((m = re.exec(skill)) !== null) set.add(m[1]);
  return set;
}

// ── upgrade-channel dist-stale fixtures ────────────────────────────────────────────────────────────
// Moved here from quay-init-loop-vendor.test.mjs when it was split into per-scenario files
// (gap-suite-split-long-multi-test-files): every split file resolves the SAME fake-bundle + plugin-
// copy + source-tree fixtures, so the shared definitions live here (the quay-init-loop-helpers split
// pattern). The test BODIES are byte-identical to the original — only their file placement changed.

export const OLD_MTIME = 1000000000;  // 2001-09-09 (bundle built first)
export const NEW_MTIME = 2000000000;  // 2033-05-18 (source updated after — the git-pull state)

export function writeFakeBundles(src, coreContent, nativeContent) {
  const fakeDist = path.join(src, 'vendor', 'quay', 'dist', 'quay.js');
  fs.mkdirSync(path.dirname(fakeDist), { recursive: true });
  fs.writeFileSync(fakeDist, coreContent, 'utf8');
  const fakeNativeDist = path.join(src, 'vendor', 'quay-native', 'dist', 'quay-native.js');
  fs.mkdirSync(path.dirname(fakeNativeDist), { recursive: true });
  fs.writeFileSync(fakeNativeDist, nativeContent, 'utf8');
  fs.writeFileSync(path.join(src, 'vendor', 'quay-native', 'provider.yml'), 'id: native\nname: "quay-native"\n', 'utf8');
}

/** Read the version the vendored package.json declares (the AC4 version-freshness comparison
 * target). The test tracks the ACTUAL vendored version — it was hardcoded 0.3.13 when written,
 * and drifted when the vendored version advanced. */
export function readVendoredVersion(plugin) {
  const pkg = path.join(plugin, 'vendor', 'quay', 'package.json');
  const data = JSON.parse(fs.readFileSync(pkg, 'utf8'));
  assert.ok(typeof data.version === 'string' && /^\d+\.\d+\.\d+$/.test(data.version),
    `vendored package.json must declare a semver version (got ${JSON.stringify(data.version)})`);
  return data.version;
}

// makePluginCopy: a plugin copy at <parent>/plugin whose SIBLING packages tree (<parent>/packages)
// is PER-TEST unique — the AC1 stale check resolves $PLUGIN_ROOT/../packages relative to the
// plugin root, so a shared sibling (plain /tmp) would leak a source tree between tests.
export function makePluginCopy() {
  const parent = makeTmp('upg-src-');
  const plugin = path.join(parent, 'plugin');
  fs.cpSync(pluginDir, plugin, { recursive: true });
  return { parent, plugin };
}

// writeSrcTree(parent, coreMtime, nativeMtime): the dev source tree lives at <parent>/packages/*/src
// (PLUGIN_ROOT = <parent>/plugin, so $PLUGIN_ROOT/../packages = <parent>/packages).
export function writeSrcTree(parent, coreMtime, nativeMtime) {
  const coreSrc = path.join(parent, 'packages', 'quay', 'src');
  fs.mkdirSync(coreSrc, { recursive: true });
  const v = path.join(coreSrc, 'version.ts');
  fs.writeFileSync(v, '// version\n', 'utf8');
  fs.utimesSync(v, NEW_MTIME, coreMtime);
  const nativeSrc = path.join(parent, 'packages', 'quay-native', 'src');
  fs.mkdirSync(nativeSrc, { recursive: true });
  const m = path.join(nativeSrc, 'manifest.ts');
  fs.writeFileSync(m, '// manifest\n', 'utf8');
  fs.utimesSync(m, NEW_MTIME, nativeMtime);
}
