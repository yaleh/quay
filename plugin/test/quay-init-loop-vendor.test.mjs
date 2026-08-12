// @test-group lowconc
// @load-sensitive real-install
// @load-sensitive-entry 2026-08-09 real-install e2e (quay-init → python3 children); install family flake rotation; re-split lowconc 2026-08-12 (fixture-amortized — gap-suite-tiering-kind-heavy-not-a-mechanism)
// KNOWN-LOAD-SENSITIVE (see plugin/loop/fast-mode-loop-tick.md "已知负载敏感族") — real-install e2e:
// each --loop test spawns a real quay-init.sh → python3 children. The install/quay-init family
// rotated flakes across groups under full-suite load, so the whole family is consolidated into the
// concurrency-1 serial phase (gap-install-family-tests-rotate-flakes-under-full-suite).
// GROUP NOTE (gap-serial-group-recompose-nested-runner-criterion → gap-install-family-tests-rotate-
// flakes-under-full-suite): routed to `serial`, not `lowconc`. The old criterion routed
// load-sensitive-but-not-nested files to lowconc; the family then rotated flakes across groups under
// full-suite load, so the serial criterion was extended to admit the install/quay-init family's
// real-install e2e and the family was consolidated into the concurrency-1 serial phase. The laydown
// template (one real install per file process) keeps each file's serial cost bounded.
// quay-init-loop-vendor.test.mjs — split out of quay-init-loop.test.mjs (2026-08-07 inner red-window
// fix). The original 54-test single file exhausted the node:test worker event loop under heavy
// blocking spawnSync (each --loop test spawns a real quay-init.sh → python3 children), self-failing
// at ~167s with 'Promise resolution is still pending'. Each split file keeps < ~19 tests, under the
// exhaustion threshold. Shared helpers live in quay-init-loop-helpers.mjs.
// gap-quay-init-laydown-dominant-red-suite-blocker root-cause verdict 2026-08-07.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { makeTmp, cleanup, diskWorktreeRoot, runInit, extractRefs, declaredSet, pluginDir } from "./quay-init-loop-helpers.mjs";

// ── gap-upgrade-channel-cant-sync-build-artifacts-dist-stale (AC1/AC2/AC4) ─────────────────────────
// The upgrade channel syncs SOURCE but not build artifacts: a git pull gets new packages/quay/src but
// the gitignored plugin/vendor/*/dist bundle does not follow (B machine: dist built 13:34, fix merged
// 15:10, ENOENT persists). AC1: ensure_vendor_runtime detects STALE (src mtime > dist mtime) and
// auto-rebuilds or fails closed — the negative control is that it previously only rebuilt on MISSING,
// never on STALE. AC2: the referenced-runtime verify now checks FRESHNESS (byte-identical to the
// plugin's current vendored bundle), not just existence. AC4: the user-scope install cache (no
// packages/ source tree) gets a VERSION-CONSISTENCY freshness check (embedded dist version vs the
// vendored package.json version) that PROMPTS instead of fail-closing.
const OLD_MTIME = 1000000000;  // 2001-09-09 (bundle built first)
const NEW_MTIME = 2000000000;  // 2033-05-18 (source updated after — the git-pull state)

function writeFakeBundles(src, coreContent, nativeContent) {
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
function readVendoredVersion(plugin) {
  const pkg = path.join(plugin, 'vendor', 'quay', 'package.json');
  const data = JSON.parse(fs.readFileSync(pkg, 'utf8'));
  assert.ok(typeof data.version === 'string' && /^\d+\.\d+\.\d+$/.test(data.version),
    `vendored package.json must declare a semver version (got ${JSON.stringify(data.version)})`);
  return data.version;
}

// makePluginCopy: a plugin copy at <parent>/plugin whose SIBLING packages tree (<parent>/packages)
// is PER-TEST unique — the AC1 stale check resolves $PLUGIN_ROOT/../packages relative to the
// plugin root, so a shared sibling (plain /tmp) would leak a source tree between tests.
function makePluginCopy() {
  const parent = makeTmp('upg-src-');
  const plugin = path.join(parent, 'plugin');
  fs.cpSync(pluginDir, plugin, { recursive: true });
  return { parent, plugin };
}

// writeSrcTree(parent, coreMtime, nativeMtime): the dev source tree lives at <parent>/packages/*/src
// (PLUGIN_ROOT = <parent>/plugin, so $PLUGIN_ROOT/../packages = <parent>/packages).
function writeSrcTree(parent, coreMtime, nativeMtime) {
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

test('AC1 — when the vendored dist is STALE (source mtime > dist mtime) and auto-rebuild works, quay-init AUTO-REBUILDS and lays the fresh runtime (AC3 B-machine scenario)', () => {
  const { parent, plugin } = makePluginCopy();
  try {
    writeFakeBundles(plugin, '// stale core v1\n', '// stale native v1\n');
    // Dist bundles are OLD; source files are NEW → the exact state a git pull leaves (new src, gitignored dist not rebuilt).
    fs.utimesSync(path.join(plugin, 'vendor', 'quay', 'dist', 'quay.js'), NEW_MTIME, OLD_MTIME);
    fs.utimesSync(path.join(plugin, 'vendor', 'quay-native', 'dist', 'quay-native.js'), NEW_MTIME, OLD_MTIME);
    writeSrcTree(parent, NEW_MTIME, NEW_MTIME);
    const syncStub = path.join(plugin, 'scripts', 'sync-vendor.sh');
    fs.writeFileSync(syncStub, `#!/usr/bin/env bash
PLUGIN="$(cd "$(dirname "\${BASH_SOURCE[0]}")/.." && pwd)"
mkdir -p "$PLUGIN/vendor/quay/dist" "$PLUGIN/vendor/quay-native/dist"
printf '// rebuilt core\\n' > "$PLUGIN/vendor/quay/dist/quay.js"
printf '// rebuilt native\\n' > "$PLUGIN/vendor/quay-native/dist/quay-native.js"
echo "[stub sync-vendor] rebuilt"
`, 'utf8');
    fs.chmodSync(syncStub, 0o755);
    const ws = makeTmp();
    try {
      const r = runInit(ws, ['--loop', '--root', ws, '--project', 'proj', '--test-command', 'node --test',
        '--tmux-session', 'proj-0:0.0', '--plugin-root', plugin]);
      assert.equal(r.status, 0, `quay-init must succeed after the stale auto-rebuild:\n${r.stderr}`);
      assert.match(r.stderr, /vendor runtime STALE/, 'must report the STALE state (AC1 negative control: pre-fix code only rebuilt on missing, never on stale)');
      assert.match(r.stderr, /auto-rebuilt STALE vendor runtime via sync-vendor\.sh/, 'must report the stale auto-rebuild (AC1)');
      const laid = path.join(ws, '.quay', 'runtime', 'bin', 'quay.js');
      assert.ok(fs.existsSync(laid), 'the rebuilt Core runtime must be laid into the target');
      assert.equal(fs.readFileSync(laid, 'utf8'), '// rebuilt core\n', 'the laid Core runtime must be the REBUILT bundle, not the stale one');
    } finally { cleanup(ws); }
  } finally { cleanup(parent); }
});

test('AC1 — a FRESH dist (dist mtime > source mtime) is NOT rebuilt (passes through untouched)', () => {
  const { parent, plugin } = makePluginCopy();
  try {
    writeFakeBundles(plugin, '// fresh core\n', '// fresh native\n');
    fs.utimesSync(path.join(plugin, 'vendor', 'quay', 'dist', 'quay.js'), NEW_MTIME, NEW_MTIME);
    fs.utimesSync(path.join(plugin, 'vendor', 'quay-native', 'dist', 'quay-native.js'), NEW_MTIME, NEW_MTIME);
    writeSrcTree(parent, OLD_MTIME, OLD_MTIME);  // source OLDER than dist → fresh
    const syncStub = path.join(plugin, 'scripts', 'sync-vendor.sh');
    fs.writeFileSync(syncStub, '#!/usr/bin/env bash\necho "[stub sync-vendor] should NOT run"\nexit 1\n', 'utf8');
    fs.chmodSync(syncStub, 0o755);
    const ws = makeTmp();
    try {
      const r = runInit(ws, ['--loop', '--root', ws, '--project', 'proj', '--test-command', 'node --test',
        '--tmux-session', 'proj-0:0.0', '--plugin-root', plugin]);
      assert.equal(r.status, 0, `fresh dist must pass through without a rebuild:\n${r.stderr}`);
      assert.doesNotMatch(r.stderr, /STALE/, 'a fresh dist must NOT be reported stale');
      assert.doesNotMatch(r.stderr, /\[stub sync-vendor\] should NOT run/, 'sync-vendor.sh must NOT run for a fresh dist');
      const laid = path.join(ws, '.quay', 'runtime', 'bin', 'quay.js');
      assert.equal(fs.readFileSync(laid, 'utf8'), '// fresh core\n', 'the laid Core runtime must be the existing fresh bundle');
    } finally { cleanup(ws); }
  } finally { cleanup(parent); }
});

test('AC1 — a STALE vendored dist whose auto-rebuild cannot produce the bundles FAILS CLOSED (no complete)', () => {
  const { parent, plugin } = makePluginCopy();
  try {
    writeFakeBundles(plugin, '// stale core v1\n', '// stale native v1\n');
    fs.utimesSync(path.join(plugin, 'vendor', 'quay', 'dist', 'quay.js'), NEW_MTIME, OLD_MTIME);
    fs.utimesSync(path.join(plugin, 'vendor', 'quay-native', 'dist', 'quay-native.js'), NEW_MTIME, OLD_MTIME);
    writeSrcTree(parent, NEW_MTIME, NEW_MTIME);
    const syncStub = path.join(plugin, 'scripts', 'sync-vendor.sh');
    fs.writeFileSync(syncStub, `#!/usr/bin/env bash
PLUGIN="$(cd "$(dirname "\${BASH_SOURCE[0]}")/.." && pwd)"
rm -f "$PLUGIN/vendor/quay/dist/quay.js" "$PLUGIN/vendor/quay-native/dist/quay-native.js"
echo "[stub sync-vendor] rebuild failed" >&2
exit 1
`, 'utf8');
    fs.chmodSync(syncStub, 0o755);
    const ws = makeTmp();
    try {
      const r = runInit(ws, ['--loop', '--root', ws, '--project', 'proj', '--test-command', 'node --test',
        '--tmux-session', 'proj-0:0.0', '--plugin-root', plugin]);
      assert.notEqual(r.status, 0, 'quay-init must FAIL CLOSED when the stale auto-rebuild cannot produce the bundles');
      assert.match(r.stderr, /vendor runtime STALE/, 'must report the STALE state before the fail-closed');
      assert.doesNotMatch(r.stdout, /quay-init complete/, 'must NOT report complete with a stale/missing runtime');
      assert.match(r.stderr, /FAILS CLOSED/, 'must state the fail-closed resolution');
    } finally { cleanup(ws); }
  } finally { cleanup(parent); }
});

test('AC2 — the referenced-runtime verify checks FRESHNESS: a target runtime that differs from the plugin\'s current vendored bundle FAILS CLOSED (stale-runtime)', () => {
  const { parent, plugin } = makePluginCopy();
  try {
    writeFakeBundles(plugin, '// current core v2\n', '// current native v2\n');
    const ws = makeTmp();
    try {
      // Legacy-install config: the mcp_entry points at a NON-standard path the lay-down never
      // refreshes. The file EXISTS (so the existence check passes) but is a stale dist from an
      // older install — the freshness check must catch it.
      fs.mkdirSync(path.join(ws, '.quay'), { recursive: true });
      fs.mkdirSync(path.join(ws, 'bin'), { recursive: true });
      fs.writeFileSync(path.join(ws, 'bin', 'quay.js'), '// stale legacy core v1\n', 'utf8');
      fs.writeFileSync(path.join(ws, '.quay', 'config.yml'),
        `providers:\n  native:\n    enabled: true\n    path: "${ws}/vendor/quay-native"\n    tasks_dir: "${ws}/tasks"\n    mcp_entry: ["node", "${ws}/bin/quay.js", "mcp"]\n`, 'utf8');
      const r = runInit(ws, ['--loop', '--root', ws, '--project', 'proj', '--test-command', 'node --test',
        '--tmux-session', 'proj-0:0.0', '--plugin-root', plugin]);
      assert.notEqual(r.status, 0, 'quay-init must FAIL CLOSED when the referenced runtime is a stale dist (freshness, not just existence)');
      assert.match(r.stdout, /verify-provider-runtime-existence: OK/, 'the referenced file EXISTS — the existence check passes (AC2: existence alone was the pre-fix verify)');
      assert.match(r.stderr, /stale-runtime/, 'the freshness check must name the stale-runtime failure');
      assert.match(r.stderr, /bin\/quay\.js/, 'must name the stale referenced runtime');
    } finally { cleanup(ws); }
  } finally { cleanup(parent); }
});

test('AC2 — a target runtime that MATCHES the plugin\'s current vendored bundle passes the freshness verify', () => {
  const { parent, plugin } = makePluginCopy();
  try {
    writeFakeBundles(plugin, '// current core\n', '// current native\n');
    const ws = makeTmp();
    try {
      const r = runInit(ws, ['--loop', '--root', ws, '--project', 'proj', '--test-command', 'node --test',
        '--tmux-session', 'proj-0:0.0', '--plugin-root', plugin]);
      assert.equal(r.status, 0, `quay-init must succeed:\n${r.stderr}`);
      assert.match(r.stdout, /verify-provider-runtime-freshness: OK/, 'the freshness verify must report OK when the laid runtime matches the plugin bundle');
    } finally { cleanup(ws); }
  } finally { cleanup(parent); }
});

test('AC4 — a user-scope install cache (no packages/ source tree) whose dist embeds a DIFFERENT version than the vendored package.json is flagged STALE (prompt, not fail-closed)', () => {
  const { parent, plugin } = makePluginCopy();
  try {
    // The dist bundle is runnable and echoes an OLD core version; the vendored package.json
    // (tracked in git, copied verbatim) declares the real version → version mismatch = stale.
    // No packages/ source tree exists here → the AC1 mtime check cannot fire, so the AC4 version
    // check owns it. The declared version is read from the copied plugin's vendor/package.json so
    // the test tracks the actual vendored version (was hardcoded 0.3.13; now 0.4.0).
    const declared = readVendoredVersion(plugin);
    // Make the fake embedded version unambiguously OLDER than declared (0.4.0 → 0.3.0): lower the
    // MINOR segment by 1 (patch is 0 at a version boundary, so decrementing patch alone would leave
    // 0.4.0 unchanged and the test would not be stale). The version-freshness check compares the
    // whole semver string, so any lower version is STALE.
    const dec = (v) => { const [maj, min, patch] = v.split('.'); return `${maj}.${String(Math.max(0, Number(min) - 1))}.${patch}`; };
    const embeddedStale = dec(declared);
    writeFakeBundles(plugin, `console.log("${embeddedStale}")\n`, '// native bundle\n');
    const ws = makeTmp();
    try {
      const r = runInit(ws, ['--loop', '--root', ws, '--project', 'proj', '--test-command', 'node --test',
        '--tmux-session', 'proj-0:0.0', '--plugin-root', plugin]);
      assert.equal(r.status, 0, 'a stale user-scope runtime is a PROMPT, not a fail-closed (no source tree to rebuild from — AC4)');
      assert.match(r.stderr, /STALE \(user-scope vendor runtime\)/, 'must flag the user-scope stale dist (AC4 negative control: pre-fix treated the 06:01 dist as fresh)');
      assert.match(r.stderr, new RegExp(embeddedStale.replace(/\./g, '\\.')), 'must name the embedded stale version');
      assert.match(r.stderr, new RegExp(declared.replace(/\./g, '\\.')), 'must name the declared vendored version');
    } finally { cleanup(ws); }
  } finally { cleanup(parent); }
});

test('AC4 — a user-scope dist whose embedded version MATCHES the vendored package.json is NOT flagged stale', () => {
  const { parent, plugin } = makePluginCopy();
  try {
    const declared = readVendoredVersion(plugin);
    writeFakeBundles(plugin, `console.log("${declared}")\n`, '// native bundle\n');
    const ws = makeTmp();
    try {
      const r = runInit(ws, ['--loop', '--root', ws, '--project', 'proj', '--test-command', 'node --test',
        '--tmux-session', 'proj-0:0.0', '--plugin-root', plugin]);
      assert.equal(r.status, 0, `quay-init must succeed:\n${r.stderr}`);
      assert.doesNotMatch(r.stderr, /STALE \(user-scope vendor runtime\)/, 'a version-consistent user-scope dist must NOT be flagged stale');
    } finally { cleanup(ws); }
  } finally { cleanup(parent); }
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// gap-the-tick-doc-ships-three-contradictory-loop-drivers
// 外层 tick 文档只声明一个循环驱动（CronCreate）；另外两个（ScheduleWakeup / /loop Nm）被显式处置。
// 双触发/不触发用 loop-driver-check.sh 机械检出（AC4/AC5/AC6）。
// ═══════════════════════════════════════════════════════════════════════════════════════════════

const TICK_DOC = path.join(pluginDir, 'loop', 'orchestrator-loop-tick.md');
const DRIVER_TOKENS = ['CronCreate', 'ScheduleWakeup'];
const LOOP_NM_RE = /\/loop\s+[0-9]+m/;

function distinctDriverMechanisms(text) {
  const mechs = new Set(DRIVER_TOKENS.filter((t) => text.includes(t)));
  if (LOOP_NM_RE.test(text)) mechs.add('loop-interval');
  return mechs;
}

