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
