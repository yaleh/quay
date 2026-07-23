/**
 * delivery-manifest-check.test — tests for delivery-manifest-check.ts
 *
 * Run: node --experimental-strip-types --test scripts/delivery-manifest-check.test.ts
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import { check, readManifest } from './delivery-manifest-check.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');
const scriptPath = resolve(__dirname, 'delivery-manifest-check.ts');

test('readManifest returns manifest from real repo', () => {
  const m = readManifest(repoRoot);
  assert.ok(m, 'manifest should exist');
  assert.equal(m.$schema, 'delivery-manifest-v1');
  assert.ok(m.version.length > 0);
});

test('readManifest returns null for missing manifest', () => {
  const m = readManifest('/nonexistent/path');
  assert.equal(m, null);
});

test('check passes on real repo (GREEN)', () => {
  const result = check(repoRoot);
  assert.equal(result.manifestFound, true);
  assert.equal(result.manifestValid, true);
  assert.equal(result.ok, true, `issues: ${result.issues.join('; ')}`);
  assert.equal(result.npmTarballsDeclared, 4);
  assert.equal(result.seaPackagesDeclared, 2);
});

test('check fails when manifest is missing (RED)', () => {
  const tmp = resolve(repoRoot, 'test/fixtures/delivery-manifest-missing');
  mkdirSync(tmp, { recursive: true });
  try {
    // Create release.yml so only manifest is missing
    mkdirSync(resolve(tmp, '.github/workflows'), { recursive: true });
    writeFileSync(resolve(tmp, '.github/workflows/release.yml'), 'name: Release\n');
    const result = check(tmp);
    assert.equal(result.manifestFound, false);
    assert.equal(result.ok, false);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('manifest has required artifact types', () => {
  const m: any = readManifest(repoRoot);
  assert.ok(Array.isArray(m.artifacts['npm-tarballs']));
  assert.ok(Array.isArray(m.artifacts['sea-binaries']));
  assert.ok(m.artifacts.plugin != null);
  assert.equal(m.artifacts.plugin.id, 'quay');
  // All 4 packages declared
  const pkgNames = m.artifacts['npm-tarballs'].map((t: any) => t.package);
  assert.deepEqual(pkgNames.sort(), ['quay', 'quay-backlog', 'quay-github', 'quay-native'].sort());
});

test('manifest version matches quay package version', () => {
  const quayPkg = JSON.parse(readFileSync(resolve(repoRoot, 'packages/quay/package.json'), 'utf-8'));
  const m: any = readManifest(repoRoot);
  assert.equal(m.version, quayPkg.version);
});

// ── CLI tests ──────────────────────────────────────────────────────────

test('CLI exits 0 on real repo (GREEN)', () => {
  const out = execSync(`node --experimental-strip-types ${scriptPath} 2>&1`, {
    encoding: 'utf-8', cwd: repoRoot, stdio: 'pipe',
  });
  assert.ok(out.includes('DELIVERY-MANIFEST-CHECK: OK'), `got: ${out.slice(0, 200)}`);
});

test('CLI --json returns valid JSON', () => {
  const out = execSync(`node --experimental-strip-types ${scriptPath} --json`, {
    encoding: 'utf-8', cwd: repoRoot, stdio: 'pipe',
  });
  const parsed = JSON.parse(out);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.npmTarballsDeclared, 4);
});

