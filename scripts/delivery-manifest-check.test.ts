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
import { check, readManifest, parseReleaseYmlNpmTarballs, parseReleaseYmlSeaBinaries } from './delivery-manifest-check.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');
const scriptPath = resolve(__dirname, 'delivery-manifest-check.ts');

// ── Parser unit tests ─────────────────────────────────────────────────

test('parseReleaseYmlNpmTarballs extracts package.sh packages', () => {
  const yml = 'bash packages/quay/scripts/package.sh\nbash packages/quay-native/scripts/package.sh';
  const pkgs = parseReleaseYmlNpmTarballs(yml);
  assert.equal(pkgs.size, 2);
  assert.ok(pkgs.has('quay'));
  assert.ok(pkgs.has('quay-native'));
});

test('parseReleaseYmlNpmTarballs returns empty for no match', () => {
  const pkgs = parseReleaseYmlNpmTarballs('no npm pack here');
  assert.equal(pkgs.size, 0);
});

test('parseReleaseYmlSeaBinaries extracts build-sea packages', () => {
  const yml = 'bash packages/quay/scripts/build-sea.sh\nbash packages/quay-native/scripts/build-sea.sh';
  const pkgs = parseReleaseYmlSeaBinaries(yml);
  assert.equal(pkgs.size, 2);
  assert.ok(pkgs.has('quay'));
  assert.ok(pkgs.has('quay-native'));
});

// ── Manifest checks ───────────────────────────────────────────────────

test('readManifest returns manifest from real repo', () => {
  const m = readManifest(repoRoot);
  assert.ok(m, 'manifest should exist');
  assert.equal(m.$schema, 'delivery-manifest-v1');
});

test('check passes on real repo — GREEN (manifest matches release.yml)', () => {
  const result = check(repoRoot);
  assert.equal(result.manifestFound, true);
  assert.equal(result.manifestValid, true);
  assert.equal(result.ok, true, `issues: ${result.issues.join('; ')}`);
});

test('check detects manifest/release.yml divergence — RED', () => {
  const tmp = resolve(repoRoot, 'test/fixtures/delivery-manifest-diverged');
  mkdirSync(tmp, { recursive: true });
  try {
    // Copy release.yml
    mkdirSync(resolve(tmp, '.github/workflows'), { recursive: true });
    writeFileSync(resolve(tmp, '.github/workflows/release.yml'), 'bash packages/quay/scripts/package.sh');
    // Manifest declares quay-native too (not in release.yml)
    writeFileSync(resolve(tmp, 'delivery-manifest.json'), JSON.stringify({
      '$schema': 'delivery-manifest-v1',
      version: '0.3.11',
      description: 'test',
      artifacts: {
        'npm-tarballs': [
          { package: 'quay', path: 'packages/quay', artifactPattern: 'quay-{version}.tgz' },
          { package: 'quay-native', path: 'packages/quay-native', artifactPattern: 'quay-native-{version}.tgz' },
        ],
        'sea-binaries': [
          { package: 'quay', platforms: ['linux-x64'] },
        ],
        plugin: { id: 'quay', 'bundle-type': 'marketplace' },
      },
    }, null, 2));
    const result = check(tmp);
    assert.equal(result.ok, false, 'should detect divergence');
    assert.ok(result.issues.some((i: string) => i.includes('quay-native')), 'should report missing quay-native tarball');
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('manifest has required artifact types', () => {
  const m: any = readManifest(repoRoot);
  assert.ok(Array.isArray(m.artifacts['npm-tarballs']));
  assert.ok(Array.isArray(m.artifacts['sea-binaries']));
  assert.ok(m.artifacts.plugin != null);
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

test('CLI exits 1 on divergence (RED)', () => {
  const tmp = resolve(repoRoot, 'test/fixtures/delivery-manifest-cli-red');
  mkdirSync(tmp, { recursive: true });
  try {
    mkdirSync(resolve(tmp, '.github/workflows'), { recursive: true });
    writeFileSync(resolve(tmp, '.github/workflows/release.yml'), 'bash packages/quay/scripts/package.sh');
    writeFileSync(resolve(tmp, 'delivery-manifest.json'), JSON.stringify({
      '$schema': 'delivery-manifest-v1', version: '0.3.11', description: 'test',
      artifacts: {
        'npm-tarballs': [
          { package: 'quay', path: 'packages/quay', artifactPattern: 'quay-{version}.tgz' },
          { package: 'quay-github', path: 'packages/quay-github', artifactPattern: 'quay-github-{version}.tgz' },
        ],
        'sea-binaries': [{ package: 'quay', platforms: ['linux-x64'] }],
        plugin: { id: 'quay', 'bundle-type': 'marketplace' },
      },
    }, null, 2));
    try {
      execSync(`node --experimental-strip-types ${scriptPath} 2>&1`, {
        encoding: 'utf-8', cwd: tmp, stdio: 'pipe',
      });
      assert.fail('expected non-zero exit on divergence');
    } catch (e: any) {
      assert.equal(e.status, 1);
      assert.ok(e.stdout.includes('FAIL') || e.stdout.includes('quay-github'), 'should report the gap');
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('CLI --json returns valid JSON', () => {
  const out = execSync(`node --experimental-strip-types ${scriptPath} --json`, {
    encoding: 'utf-8', cwd: repoRoot, stdio: 'pipe',
  });
  const parsed = JSON.parse(out);
  assert.equal(typeof parsed.ok, 'boolean');
  assert.equal(typeof parsed.npmTarballsDeclared, 'number');
});
