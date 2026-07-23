// plugin/test/plugin-packaging.test.mjs — pins the DIR-040 (+ DIR-042-B) plugin-packaging invariants:
//   1. the marketplace + plugin manifests are valid JSON with the shape Claude Code expects
//   2. plugin.json's commands[] actually lists the 4 bundled skills
//   3. the bundled author/execute skills are byte-identical to their ONE canonical source
//      (packages/quay-native/skills/{author,execute}/SKILL.md) — single-source, ADR-004
//   4. none of the shipped/foreign-workspace-facing files leak this repo's own internal
//      experiment-layout path (experiments/quay-perpetual-stream/**) or "exp5" attribution
//   5. the loop-driver skill (DIR-042-B) carries no research-layer references (VT/value-ledger/
//      checkpoints/experiments/**)
//
// Run: node --test plugin/test/plugin-packaging.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pluginDir = path.resolve(__dirname, '..');
const repoRoot = path.resolve(pluginDir, '..');

function readJson(p) {
  return JSON.parse(readFileSync(p, 'utf8'));
}

test('marketplace.json is valid JSON and lists the quay plugin pointing at ./plugin', () => {
  const mp = readJson(path.join(repoRoot, '.claude-plugin', 'marketplace.json'));
  assert.equal(mp.name, 'quay');
  assert.ok(Array.isArray(mp.plugins) && mp.plugins.length >= 1);
  const entry = mp.plugins.find((p) => p.name === 'quay');
  assert.ok(entry, 'marketplace.json must list a plugin named "quay"');
  assert.equal(entry.source, './plugin');
});

test('plugin.json is valid JSON and declares the 4 bundled skills', () => {
  const manifest = readJson(path.join(pluginDir, '.claude-plugin', 'plugin.json'));
  assert.equal(manifest.name, 'quay');
  assert.ok(Array.isArray(manifest.commands));
  const wanted = [
    './skills/author/SKILL.md',
    './skills/execute/SKILL.md',
    './skills/quay-directive/SKILL.md',
    './skills/loop-driver/SKILL.md',
  ];
  for (const w of wanted) {
    assert.ok(manifest.commands.includes(w), `plugin.json commands[] must include ${w}`);
  }
});

test('.mcp.json declares the quay MCP server via ${CLAUDE_PLUGIN_ROOT}-relative args', () => {
  const mcp = readJson(path.join(pluginDir, '.mcp.json'));
  assert.ok(mcp.quay, '.mcp.json must declare a "quay" server entry');
  assert.equal(mcp.quay.command, 'node');
  assert.ok(Array.isArray(mcp.quay.args) && mcp.quay.args.length >= 1);
  assert.ok(
    mcp.quay.args[0].includes('${CLAUDE_PLUGIN_ROOT}'),
    'the server entry path must be plugin-root-relative, never an absolute/outside-plugin path'
  );
  assert.ok(mcp.quay.args.includes('mcp'), 'must invoke the mcp subcommand');
});

test('author/execute skills are single-sourced: byte-identical to packages/quay-native\'s own shipped copies', () => {
  for (const name of ['author', 'execute']) {
    const canonical = path.join(repoRoot, 'packages', 'quay-native', 'skills', name, 'SKILL.md');
    const bundled = path.join(pluginDir, 'skills', name, 'SKILL.md');
    assert.ok(existsSync(canonical), `canonical source missing: ${canonical}`);
    assert.ok(existsSync(bundled), `bundled copy missing: ${bundled}`);
    assert.equal(
      readFileSync(bundled, 'utf8'),
      readFileSync(canonical, 'utf8'),
      `${name} skill must be byte-identical to its single canonical source (no drifting copy)`
    );
  }
});

test('shipped schema-check modules are byte-identical to their exp5 canonical source, modulo attribution-only sanitization', () => {
  for (const name of ['task-schema.ts', 'task-schema-check.ts', 'task-schema-check.sh']) {
    const canonical = path.join(repoRoot, 'experiments', 'quay-perpetual-stream', 'scripts', name);
    const bundled = path.join(pluginDir, 'scripts', name);
    assert.ok(existsSync(canonical), `canonical source missing: ${canonical}`);
    assert.ok(existsSync(bundled), `bundled copy missing: ${bundled}`);
    const canonicalSrc = readFileSync(canonical, 'utf8');
    const bundledSrc = readFileSync(bundled, 'utf8');
    // The only allowed divergence is stripping the internal "exp5" attribution
    // fragment from header comments; the functional body must be unchanged.
    const stripAttribution = (s) =>
      s
        .replace(/\(exp5 \/\s*\n(\/\/|#) canonical-task-schema/g, '(canonical-task-schema')
        .replace(/exp5-M-CRYST-B1\/DIR-028/g, 'DIR-028')
        .replace(/\bexp5\b\s*\/\s*/g, '');
    assert.equal(
      stripAttribution(canonicalSrc),
      bundledSrc,
      `${name}: bundled copy must match the canonical source modulo attribution-only stripping`
    );
  }
});

test('no shipped/foreign-workspace-facing file leaks this repo\'s own experiments/quay-perpetual-stream path or "exp5" label', () => {
  const shippedFiles = [
    path.join(repoRoot, '.claude-plugin', 'marketplace.json'),
    path.join(pluginDir, '.claude-plugin', 'plugin.json'),
    path.join(pluginDir, '.mcp.json'),
    path.join(pluginDir, 'scripts', 'task-schema.ts'),
    path.join(pluginDir, 'scripts', 'task-schema-check.ts'),
    path.join(pluginDir, 'scripts', 'task-schema-check.sh'),
    path.join(pluginDir, 'skills', 'author', 'SKILL.md'),
    path.join(pluginDir, 'skills', 'execute', 'SKILL.md'),
    path.join(pluginDir, 'skills', 'quay-directive', 'SKILL.md'),
    path.join(pluginDir, 'skills', 'loop-driver', 'SKILL.md'),
  ];
  const leakPattern = /experiments\/quay-perpetual-stream|\bexp5\b/i;
  for (const f of shippedFiles) {
    const src = readFileSync(f, 'utf8');
    assert.ok(
      !leakPattern.test(src),
      `${f} leaks an internal experiment-layout reference (experiments/quay-perpetual-stream or "exp5") — must be workspace-portable`
    );
  }
});

test('read-probe-spec.ts is byte-identical to its exp5 canonical source', () => {
  const canonical = path.join(repoRoot, 'experiments', 'quay-perpetual-stream', 'scripts', 'read-probe-spec.ts');
  const bundled = path.join(pluginDir, 'scripts', 'read-probe-spec.ts');
  assert.ok(existsSync(canonical), `canonical source missing: ${canonical}`);
  assert.ok(existsSync(bundled), `bundled copy missing: ${bundled}`);
  assert.equal(
    readFileSync(bundled, 'utf8'),
    readFileSync(canonical, 'utf8'),
    'read-probe-spec.ts must be byte-identical to its single canonical source (no drifting copy)'
  );
});

test('loop-driver skill (DIR-042-B) has zero research-layer references (VT/value-ledger/checkpoints/experiments/**)', () => {
  const src = readFileSync(path.join(pluginDir, 'skills', 'loop-driver', 'SKILL.md'), 'utf8');
  const researchLeakPattern = /\bVT\b|value-ledger|checkpoints?|experiments\/|inherited-core|\bexp5\b/i;
  assert.ok(
    !researchLeakPattern.test(src),
    'loop-driver SKILL.md must contain zero VT/value-ledger/checkpoints/experiments/**/exp5 references'
  );
});

// ---------------------------------------------------------------------------
// M120 (DIR-060) — the vendored Core copy is a bundled ESM dist/quay.js that
// runs on the declared Node-20 floor, NOT the M116 .ts entrypoint (Node >=23).
// The vendor tree is git-trackable (the bare `dist/` .gitignore pattern is
// negated for this path), the raw bin/src copies and package-lock.json are
// gone, and package.json is slimmed (the bundle has no external runtime deps).
// ---------------------------------------------------------------------------

const vendorDir = path.join(pluginDir, 'vendor', 'quay');

test('M120: .mcp.json invokes the bundled vendor/quay/dist/quay.js, never a .ts entrypoint', () => {
  const mcp = readJson(path.join(pluginDir, '.mcp.json'));
  assert.equal(mcp.quay.args[0], '${CLAUDE_PLUGIN_ROOT}/vendor/quay/dist/quay.js');
  assert.doesNotMatch(mcp.quay.args[0], /\.ts$/, 'the vendor entrypoint must not be a native .ts file');
});

test('M120: the vendored dist bundle exists, is git-trackable, and carries the createRequire banner', () => {
  const distBundle = path.join(vendorDir, 'dist', 'quay.js');
  assert.ok(existsSync(distBundle), `vendored bundle missing: ${distBundle}`);
  // git-trackable: the bare `dist/` ignore pattern must be negated for this
  // path. `git check-ignore` exits 0 (prints the path) when IGNORED, exits 1
  // (throws here) when NOT ignored — the state we require after the fix.
  let ignored = '';
  try {
    ignored = execFileSync('git', ['check-ignore', distBundle], { cwd: repoRoot, encoding: 'utf8' }).trim();
  } catch {
    ignored = '';
  }
  assert.equal(ignored, '', 'vendor/quay/dist/quay.js must NOT be gitignored');
  const src = readFileSync(distBundle, 'utf8');
  assert.match(src, /createRequire/, 'the vendored bundle must be the ESM build (createRequire banner present)');
});

test('M120: the stale raw bin/ + src/ vendor copies are gone (replaced by the bundle)', () => {
  assert.ok(!existsSync(path.join(vendorDir, 'bin')), 'vendor/quay/bin must be removed');
  assert.ok(!existsSync(path.join(vendorDir, 'src')), 'vendor/quay/src must be removed');
});

test('M120: package-lock.json is gone and package.json is slimmed (no runtime dependencies)', () => {
  assert.ok(!existsSync(path.join(vendorDir, 'package-lock.json')), 'vendor package-lock.json must be removed');
  const vpkg = readJson(path.join(vendorDir, 'package.json'));
  assert.equal(vpkg.name, 'quay-plugin-vendor');
  assert.equal(vpkg.type, 'module');
  assert.ok(vpkg.version, 'vendor package.json must still carry a version (DIR-061)');
  assert.ok(!('dependencies' in vpkg), 'a fully-bundled vendor copy must declare no dependencies');
});
