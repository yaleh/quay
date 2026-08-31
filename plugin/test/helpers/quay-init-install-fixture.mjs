// quay-init-install-fixture.mjs — the shared content-addressed install fixture + workspace laydown
// helpers for the quay-init --loop test family.
//
// SPLIT out of plugin/test/quay-init-loop-helpers.mjs (gap-suite-extend-shared-install-cache,
// 2026-08-30): the install-fixture machinery (sharedFixture / laydownTemplate / laydownWorkspace /
// makeTmp / cleanup / diskWorktreeRoot / runInit / _hashOfRoots / _fixtureHash / pluginDir) moved
// here so packages/quay/test can import it — the tmp-workspace.mjs cross-package precedent (a
// plugin/test/helpers file imported by packages/quay/test, no dependency-direction gate). The
// quay-init-loop family keeps importing through quay-init-loop-helpers.mjs, which now re-exports
// this surface, so the family's tests do not regress.
//
// The file-level after() hook is registered per importing test file (node --test runs each file in
// its own process), so the tracked-dirs list never crosses file boundaries — the same pattern as
// tmp-workspace.mjs.

import { after } from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const pluginDir = path.resolve(__dirname, "..", "..");

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

// _pluginSurfaceHash(pluginRoot): content-addressed sha1 over the installed-plugin surface the
// fixture addresses — scripts + loop + every shipped skill's SKILL.md + shipped workflows + the
// vendored dist bundles + package.json. Parameterized by pluginRoot so the PARAMETERIZED fixture
// (sharedFixtureVariant) can hash an OLD-plugin copy (A3's legacy-marked source) the same way the
// base fixture hashes the live plugin. Adding a root here means a change to any file under it
// yields a FRESH fixture (never a stale reuse). Exported (not just a private helper) so the
// skill-coverage test can hash a TEMP plugin-shaped root directly.
export function _pluginSurfaceHash(pluginRoot) {
  const roots = [
    path.join(pluginRoot, "scripts"),
    path.join(pluginRoot, "loop"),
    // Shipped workflows (plugin/workflows/* → <workspace>/.claude/workflows/ on install) AND the
    // live repo-root copy (.claude/workflows/* — the dual-copy source of the shipped bundle,
    // gap-fixture-hash-omits-workflows-dirs). A fan-in-execute.js edit changes BOTH; either alone
    // must invalidate the fixture. Without these roots a workflow-only change reused a stale
    // fixture and real-target-verify reported a false would-conflict (occurrence 2/日 2026-08-17).
    // For a pluginRoot that is NOT the live plugin (an old-plugin copy in /tmp), the repo-root copy
    // does not exist beside it — _hashOfRoots skips it, which is correct (the copy lays its OWN
    // plugin/workflows, fully captured above).
    path.join(pluginRoot, "workflows"),
    path.join(pluginRoot, "..", ".claude", "workflows"),
  ];
  // Shipped skill declaration files — every skills/*/SKILL.md, NOT just init. The install reads the
  // full glob skills/*/SKILL.md (script-laydown derivation + the referenced ⊆ landed check), so a
  // declaration/reference change in ANY shipped skill must invalidate the fixture
  // (gap-fixture-hash-omits-skill-md: init was hashed alone before, its 12 sibling skills were not —
  // a manager-SKILL.md SPEC-index change reused a stale fixture). Each SKILL.md is a FILE root, not
  // the whole skills/ dir: the reference/ and prompts/ subdirs are not read by the install, so they
  // are deliberately out of scope (the same precision as the workflow roots above).
  let skillDirs = [];
  try { skillDirs = fs.readdirSync(path.join(pluginRoot, "skills"), { withFileTypes: true }); } catch { /* no skills dir */ }
  for (const d of skillDirs) {
    if (!d.isDirectory()) continue;
    const skill = path.join(pluginRoot, "skills", d.name, "SKILL.md");
    if (fs.existsSync(skill)) roots.push(skill);
  }
  // The vendored dist bundles are gitignored generated artifacts the install lays verbatim into the
  // target's .quay/runtime/ — include them when present so a rebuilt bundle yields a fresh fixture.
  for (const b of ["vendor/quay/dist/quay.js", "vendor/quay-native/dist/quay-native.js"]) {
    const p = path.join(pluginRoot, b);
    if (fs.existsSync(p)) roots.push(p);
  }
  const pkg = path.join(pluginRoot, "package.json");
  if (fs.existsSync(pkg)) roots.push(pkg);
  return _hashOfRoots(roots, pluginRoot);
}

// Export (not just the private name) so quay-init-loop-fixture-hash.test.mjs can assert the real
// production hash covers the workflow roots directly.
export function _fixtureHash() {
  return _pluginSurfaceHash(pluginDir);
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

// _withFixtureLock(ws, ready, cached, build): the shared single-flight build protocol — a ready
// check, an atomic mkdir lock with stale-lock stealing (a crashed builder), and build-with-finally-
// release. `ready` is the boolean predicate for "a valid fixture exists"; `cached` builds the
// ready-cache-hit return; `build` builds the fixture while holding the lock. Shared by
// sharedFixture() (the single-form fixture) and sharedFixtureVariant() (the parameterized fixture).
function _withFixtureLock(ws, ready, cached, build) {
  if (ready()) return cached();
  const lock = `${ws}.lock`;
  let held = false;
  try { fs.mkdirSync(lock); held = true; } catch { /* another file holds the lock — wait below */ }
  if (!held) {
    const deadline = Date.now() + 180000;
    while (Date.now() < deadline) {
      if (ready()) return cached();
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
    return build();
  } finally {
    fs.rmSync(lock, { recursive: true, force: true });
  }
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
  const cached = () => ({ ws, install: _readFixtureInstall(ws), wtRoot: null });
  return _withFixtureLock(ws, ready, cached, () => _buildSharedFixture(ws));
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

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// Parameterized shared fixture (gap-upgrade-channel-install-cache)
// ═══════════════════════════════════════════════════════════════════════════════════════════════
// The single-form sharedFixture installs ONE fixed workspace shape (STANDARD_INIT_ARGS → a Node
// empty ws). The upgrade/config-preservation tests need a DIFFERENT install per test, and each has
// a cacheable baseline/old-install half + a real-install upgrade half (the upgrade half stays real —
// it IS the assertion object):
//   A3      — install FROM an old-plugin copy (legacy tick docs laid); key = the old source content.
//   AC6/AC1 — install ONTO a pre-existing evolved consumer .quay/config.yml, NO --worktree-root
//             (config-preserving upgrade keeps the consumer's recorded loop.worktree_root).
//   AC2     — same pre-config but an explicit testCommand + a fresh worktree root.
// The variant key folds in the parameterized plugin surface + the pre-install files + the init args,
// so each parameterization is a DISTINCT content-addressed fixture, reusable across rounds for its
// baseline/old-install half.

function _variantFixtureHash({ pluginRoot, preFiles, repoRoot, project, tmux, testCommand, worktreeRoot }) {
  const h = createHash("sha1");
  h.update(_pluginSurfaceHash(pluginRoot));
  h.update(" ");
  // The worktree-root MODE is part of the key (null = keep the consumer's recorded root vs a fresh
  // root), but a fresh root's actual value is not (it is a per-build mkdtemp — nondeterministic).
  h.update(JSON.stringify({
    repoRoot: repoRoot ?? null,
    project: project ?? "proj",
    tmux: tmux ?? null,
    testCommand: testCommand ?? null,
    worktreeRoot: worktreeRoot === null ? null : (typeof worktreeRoot === "string" ? worktreeRoot : "UNIQUE"),
  }));
  for (const f of preFiles) {
    h.update(" ");
    h.update(f.rel);
    h.update(" ");
    h.update(String(f.content));
  }
  return h.digest("hex").slice(0, 16);
}

function _variantFixturePath(spec) {
  return path.join(FIXTURE_BASE, `${FIXTURE_PREFIX}${_variantFixtureHash(spec)}`);
}

// _buildVariantFixture(ws, spec): write the pre-install files, run ONE real parameterized install
// into a clean fixture dir, then make it read-only and record the ready marker + captured install
// result — the same protocol as _buildSharedFixture, but parameterized. FAILS LOUD on a non-zero
// install (a real product defect, not something to paper over).
function _buildVariantFixture(ws, spec) {
  const { pluginRoot, preFiles, repoRoot, project, tmux, testCommand, worktreeRoot } = spec;
  if (fs.existsSync(ws)) fs.rmSync(ws, { recursive: true, force: true });
  fs.mkdirSync(ws, { recursive: true });
  for (const f of preFiles) {
    const p = path.join(ws, f.rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, f.content);
  }
  const session = tmux ?? "proj-0:0.0";
  const args = ["--loop", "--root", ws, "--project", project, "--tmux-session", session];
  if (repoRoot !== undefined) args.push("--repo-root", repoRoot);
  if (worktreeRoot !== null) args.push("--worktree-root", worktreeRoot ?? diskWorktreeRoot());
  if (testCommand) args.push("--test-command", testCommand);
  const install = spawnSync("bash", [path.join(pluginRoot, "scripts", "quay-init.sh"), ...args], {
    cwd: ws,
    encoding: "utf8",
    env: { ...process.env, CLAUDE_PLUGIN_ROOT: pluginRoot },
  });
  if (install.status !== 0) {
    fs.rmSync(ws, { recursive: true, force: true });
    throw new Error(`parameterized install fixture build failed:\n${install.stderr}`);
  }
  fs.writeFileSync(path.join(ws, ".install.json"),
    JSON.stringify({ status: install.status, stdout: install.stdout, stderr: install.stderr }));
  _makeReadOnly(ws);
  fs.writeFileSync(path.join(ws, ".fixture-ready"), `${pluginRoot}\n`);
  return { ws, install, wtRoot: null };
}

// sharedFixtureVariant(spec) — the parameterized fixture's ONE real install, same lazy/single-flight
// content-addressed protocol as sharedFixture. Returns { ws, install, wtRoot }: ws is the read-only
// fixture root; install is the captured install result (from .install.json on a cache hit).
export function sharedFixtureVariant(spec = {}) {
  const resolved = {
    pluginRoot: spec.pluginRoot ?? pluginDir,
    preFiles: spec.preFiles ?? [],
    repoRoot: spec.repoRoot,
    project: spec.project ?? "proj",
    tmux: spec.tmux,
    testCommand: spec.testCommand,
    worktreeRoot: spec.worktreeRoot,
  };
  const ws = _variantFixturePath(resolved);
  const readyMarker = path.join(ws, ".fixture-ready");
  const ready = () => fs.existsSync(readyMarker) && _readFixtureInstall(ws) !== null;
  const cached = () => ({ ws, install: _readFixtureInstall(ws), wtRoot: null });
  return _withFixtureLock(ws, ready, cached, () => _buildVariantFixture(ws, resolved));
}

// laydownVariantWorkspace(spec, opts) — a fresh WRITABLE copy of the parameterized fixture, like
// laydownWorkspace but for a variant. `rewriteWorktreeRoot` (default true) rewrites the copy's
// loop.worktree_root to a fresh disk root; the config-preserving upgrade (AC6/AC1) passes false so
// the consumer's recorded worktree_root is preserved byte-for-byte (the "entire loop section
// unchanged" assertion). Returns { ws, install } with the template's captured install paths
// rewritten to the copy.
export function laydownVariantWorkspace(spec = {}, { prefix = "laydown-", rewriteWorktreeRoot = true } = {}) {
  const t = sharedFixtureVariant(spec);
  const ws = makeTmp(prefix);
  const cp = spawnSync("cp", ["-a", `${t.ws}/.`, ws], { encoding: "utf8" });
  if (cp.status !== 0) {
    cleanup(ws);
    throw new Error(`laydown variant cp -a failed:\n${cp.stderr}`);
  }
  spawnSync("chmod", ["-R", "u+w", ws]);
  const cfg = path.join(ws, ".quay", "config.yml");
  if (fs.existsSync(cfg)) {
    let text = fs.readFileSync(cfg, "utf8").split(t.ws).join(ws);
    if (rewriteWorktreeRoot) {
      const freshWt = diskWorktreeRoot();
      text = text.split("\n").map((line) =>
        line.startsWith("  worktree_root:") ? `  worktree_root: ${freshWt}` : line).join("\n");
    }
    fs.writeFileSync(cfg, text);
  }
  const install = {
    status: t.install.status,
    stdout: t.install.stdout.split(t.ws).join(ws),
    stderr: t.install.stderr.split(t.ws).join(ws),
  };
  return { ws, install };
}
