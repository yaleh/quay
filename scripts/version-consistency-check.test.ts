/**
 * version-consistency-check.test — TDD tests for version-consistency-check.ts
 *
 * Run: node --experimental-strip-types --test scripts/version-consistency-check.test.ts
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import { check, readVersions } from './version-consistency-check.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');
const scriptPath = resolve(__dirname, 'version-consistency-check.ts');

function makeFixture(name: string, versions: Record<string, string>): string {
  const tmp = resolve(repoRoot, `test/fixtures/version-consistency-${name}`);
  rmSync(tmp, { recursive: true, force: true });
  const dirs = new Set<string>();
  for (const p of Object.keys(versions)) {
    dirs.add(resolve(tmp, dirname(p)));
  }
  for (const d of dirs) mkdirSync(d, { recursive: true });
  for (const [p, v] of Object.entries(versions)) {
    const full = resolve(tmp, p);
    if (p === 'plugin/README.md') {
      // Prose carrier — the fixture MUST carry a parseable `quay plugin v<semver>` sentence, or the
      // README entry lands in mode:'error' and every GREEN assertion below becomes a false red.
      writeFileSync(full, `# quay plugin\n\nquay plugin v${v} — test fixture.\n`);
    } else if (p === 'plugin/VERSION') {
      // Plain-text stamp — same trap as the README: a fixture that does not write it leaves the entry
      // in mode:'error', turning every GREEN assertion below into a false red (hard rule 3b).
      writeFileSync(full, `${v}\n`);
    } else if (p.includes('marketplace.json')) {
      writeFileSync(full, JSON.stringify([{ name: 'quay', version: v }], null, 2));
    } else if (p === 'plugin/.claude-plugin/plugin.json') {
      writeFileSync(full, JSON.stringify({ version: v }, null, 2));
    } else {
      // package.json
      const name = p.split('/').slice(-2, -1)[0] || 'unknown';
      writeFileSync(full, JSON.stringify({ name, version: v }, null, 2));
    }
  }
  return tmp;
}

const ALL_PATHS = [
  'packages/quay/package.json',
  'packages/quay-native/package.json',
  'packages/quay-github/package.json',
  'packages/quay-backlog/package.json',
  'plugin/.claude-plugin/plugin.json',
  'plugin/README.md',
  'plugin/.claude-plugin/marketplace.json',
  '.claude-plugin/marketplace.json',
  'plugin/vendor/quay/package.json',
  'plugin/VERSION',
];

// ── Unit tests ──────────────────────────────────────────────────────────

test('readVersions returns 10 entries for the real tree', () => {
  const entries = readVersions(repoRoot);
  assert.equal(entries.length, 10);
  for (const e of entries) {
    assert.ok(e.label.length > 0, `entry for ${e.path} has no label`);
  }
});

test('readVersions returns errors for missing files', () => {
  const entries = readVersions('/nonexistent/path/xyz');
  for (const e of entries) {
    assert.ok(e.error, `entry ${e.label} should have an error for nonexistent path`);
  }
});

test('check returns all-equal on the real tree post-unification (GREEN)', () => {
  const result = check(repoRoot);
  assert.equal(result.mode, 'all-equal');
  assert.equal(result.ok, true);
  assert.equal(result.uniqueVersions.length, 1, `expected 1 unique version, got ${result.uniqueVersions.length}: ${result.uniqueVersions.join(', ')}`);
});

test('check returns all-equal for a unified fixture (GREEN)', () => {
  const ver = '9.9.9';
  const versions: Record<string, string> = {};
  for (const p of ALL_PATHS) versions[p] = ver;
  const tmp = makeFixture('unified', versions);
  try {
    const result = check(tmp);
    assert.equal(result.mode, 'all-equal');
    assert.equal(result.ok, true);
    assert.deepEqual(result.uniqueVersions, [ver]);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('check detects single-entry drift (RED after one drift)', () => {
  const ver = '9.9.9';
  const versions: Record<string, string> = {};
  for (const p of ALL_PATHS) versions[p] = ver;
  versions['plugin/vendor/quay/package.json'] = '0.0.1'; // drift this one
  const tmp = makeFixture('drifted', versions);
  try {
    const result = check(tmp);
    assert.equal(result.mode, 'drift');
    assert.equal(result.ok, false);
    assert.equal(result.uniqueVersions.length, 2);
    const drifted = result.entries.find((e: any) => e.path === 'plugin/vendor/quay/package.json');
    assert.ok(drifted);
    assert.equal(drifted.version, '0.0.1');
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

// ── README-only paths (gap-ac169-readme-version-not-in-version-consistency-set) ─────────────
// The pre-existing cases above only mutate a JSON machine field. Without these two, "the README
// entry was added" and "the README entry actually judges" are indistinguishable (hard rule 4:
// a criterion that cannot take the false value is not a measurement).

test('check detects drift when ONLY plugin/README.md moves (RED)', () => {
  const ver = '9.9.9';
  const versions: Record<string, string> = {};
  for (const p of ALL_PATHS) versions[p] = ver;
  versions['plugin/README.md'] = '9.9.8'; // drift ONLY the prose carrier
  const tmp = makeFixture('readme-drift', versions);
  try {
    const result = check(tmp);
    assert.equal(result.mode, 'drift');
    assert.equal(result.ok, false);
    const drifted = result.entries.find((e: any) => e.path === 'plugin/README.md');
    assert.ok(drifted, 'README entry must be in the checked set');
    assert.equal(drifted.version, '9.9.8');
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('check returns mode=error (NOT all-equal) when README has no parseable version line', () => {
  const ver = '9.9.9';
  const versions: Record<string, string> = {};
  for (const p of ALL_PATHS) versions[p] = ver;
  const tmp = makeFixture('readme-unparseable', versions);
  try {
    // A README that CANNOT be read must not be shaped like a README that agrees.
    writeFileSync(resolve(tmp, 'plugin/README.md'), '# quay plugin\n\nNo version sentence here.\n');
    const result = check(tmp);
    assert.equal(result.mode, 'error');
    assert.equal(result.ok, false);
    const e = result.entries.find((x: any) => x.path === 'plugin/README.md');
    assert.ok(e?.error, 'the unparseable README must carry an error');
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

// ── plugin/VERSION-only paths (gap-ac259-version-union-lockstep-and-host-install-readings) ──
// Same discipline as the README pair above, for the other non-JSON member of the union. Without these
// two, "plugin/VERSION was added to VERSION_ENTRIES" and "plugin/VERSION actually participates in the
// judgment" are indistinguishable (hard rule 4) — and the file's absence from this set is precisely
// how 6bf000622 shipped a green checker with plugin/VERSION left at 0.5.0.

test('check detects drift when ONLY plugin/VERSION moves (RED)', () => {
  const ver = '9.9.9';
  const versions: Record<string, string> = {};
  for (const p of ALL_PATHS) versions[p] = ver;
  versions['plugin/VERSION'] = '9.9.8'; // drift ONLY the plain-text stamp
  const tmp = makeFixture('version-stamp-drift', versions);
  try {
    const result = check(tmp);
    assert.equal(result.mode, 'drift');
    assert.equal(result.ok, false);
    const drifted = result.entries.find((e: any) => e.path === 'plugin/VERSION');
    assert.ok(drifted, 'plugin/VERSION entry must be in the checked set');
    assert.equal(drifted.version, '9.9.8');
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('check returns mode=error (NOT all-equal) when plugin/VERSION holds no semver', () => {
  const ver = '9.9.9';
  const versions: Record<string, string> = {};
  for (const p of ALL_PATHS) versions[p] = ver;
  const tmp = makeFixture('version-stamp-unparseable', versions);
  try {
    // A stamp that CANNOT be read must not be shaped like a stamp that agrees.
    writeFileSync(resolve(tmp, 'plugin/VERSION'), 'not-a-version\n');
    const result = check(tmp);
    assert.equal(result.mode, 'error');
    assert.equal(result.ok, false);
    const e = result.entries.find((x: any) => x.path === 'plugin/VERSION');
    assert.ok(e?.error, 'the unparseable stamp must carry an error');
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('check handles marketplace.json with { plugins: [...] } wrapper', () => {
  const ver = '1.0.0';
  const tmp = makeFixture('plugins-wrapper', Object.fromEntries(ALL_PATHS.map((p) => [p, ver])));
  try {
    // Rewrite marketplace files with wrapper format
    const m1 = JSON.stringify({ plugins: [{ name: 'quay', version: ver }] }, null, 2);
    writeFileSync(resolve(tmp, 'plugin/.claude-plugin/marketplace.json'), m1);
    writeFileSync(resolve(tmp, '.claude-plugin/marketplace.json'), m1);
    const result = check(tmp);
    assert.equal(result.mode, 'all-equal');
    assert.equal(result.ok, true);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

// ── CLI integration tests ───────────────────────────────────────────────

test('CLI --json exits 0 with JSON output even on drift', () => {
  const out = execSync(`node --experimental-strip-types ${scriptPath} --json`, {
    encoding: 'utf-8',
    cwd: repoRoot,
  });
  const parsed = JSON.parse(out);
  assert.equal(typeof parsed.ok, 'boolean');
  assert.ok(Array.isArray(parsed.entries));
  assert.equal(parsed.entries.length, 10);
  assert.ok(Array.isArray(parsed.uniqueVersions));
});

test('CLI exits 0 on the real tree (post-unification GREEN)', () => {
  const out = execSync(`node --experimental-strip-types ${scriptPath} 2>&1`, {
    encoding: 'utf-8',
    cwd: repoRoot,
    stdio: 'pipe',
  });
  assert.ok(out.includes('VERSION-CONSISTENCY: OK'), `expected OK in output, got: ${out.slice(0, 200)}`);
});

test('CLI exits 0 on a unified fixture', () => {
  const ver = '1.2.3';
  const versions: Record<string, string> = {};
  for (const p of ALL_PATHS) versions[p] = ver;
  const tmp = makeFixture('cli-green', versions);
  try {
    // Redirect stderr to stdout since the script writes to stderr
    const out = execSync(`node --experimental-strip-types ${scriptPath} 2>&1`, {
      encoding: 'utf-8',
      cwd: tmp,
      stdio: 'pipe',
    });
    assert.ok(out.includes('VERSION-CONSISTENCY: OK'), `expected OK in output, got: ${out.slice(0, 200)}`);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});
