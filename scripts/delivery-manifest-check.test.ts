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
import { check, checkCi, readManifest, parseReleaseYmlNpmTarballs, parseReleaseYmlSeaBinaries } from './delivery-manifest-check.ts';

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

// ── CI mode tests (Stage 2: GitHub Release asset verification) ────────────

/** Build a mock fetch that returns a given status and JSON body. */
function mockFetch(status: number, body: object): typeof fetch {
  return (async (_url: string | URL | Request, _init?: RequestInit) => {
    return {
      ok: status >= 200 && status < 300,
      status,
      statusText: status === 200 ? 'OK' : status === 401 ? 'Unauthorized' : 'Error',
      json: async () => body,
    } as Response;
  }) as typeof fetch;
}

const CI_FIXTURE_MANIFEST = {
  '$schema': 'delivery-manifest-v1',
  version: '0.3.13',
  description: 'test',
  artifacts: {
    'npm-tarballs': [
      { package: 'quay', path: 'packages/quay', artifactPattern: 'quay-{version}.tgz' },
    ],
    'sea-binaries': [
      { package: 'quay', platforms: ['linux-x64', 'macos-arm64', 'windows-x64'] },
      { package: 'quay-native', platforms: ['linux-x64', 'macos-arm64', 'windows-x64'], 'bundled-with': 'quay', note: 'bundled inside quay SEA archive' },
    ],
    plugin: { id: 'quay', 'bundle-type': 'marketplace', note: 'Included in the npm-pack tarball' },
  },
};

function writeCiFixture(dir: string, overrides?: object) {
  const manifest = overrides ? { ...CI_FIXTURE_MANIFEST, ...overrides } : CI_FIXTURE_MANIFEST;
  writeFileSync(resolve(dir, 'delivery-manifest.json'), JSON.stringify(manifest, null, 2));
}

test('checkCi GREEN — all manifest entries match published assets', async () => {
  const tmp = resolve(repoRoot, 'test/fixtures/delivery-manifest-ci-green');
  mkdirSync(tmp, { recursive: true });
  const origEnv = { ...process.env };
  try {
    writeCiFixture(tmp);
    process.env.GITHUB_REPOSITORY = 'yaleh/quay';
    process.env.GITHUB_REF_NAME = 'v0.3.13';

    const mockResponse = {
      tag_name: 'v0.3.13',
      assets: [
        { name: 'quay-0.3.13.tgz', content_type: 'application/gzip', size: 1024 },
        { name: 'quay-sea-0.3.13-linux-x64.tar.gz', content_type: 'application/gzip', size: 2048 },
        { name: 'quay-sea-0.3.13-macos-arm64.tar.gz', content_type: 'application/gzip', size: 2048 },
        { name: 'quay-sea-0.3.13-windows-x64.zip', content_type: 'application/zip', size: 2048 },
      ],
    };

    const result = await checkCi(tmp, 'fake-token', mockFetch(200, mockResponse));
    assert.equal(result.ok, true, `issues: ${result.issues.join('; ')}`);
    assert.equal(result.ciMode, true);
    assert.equal(result.releaseTag, 'v0.3.13');
    assert.equal(result.publishedAssetCount, 4);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
    process.env = origEnv;
  }
});

test('checkCi RED — published assets missing a declared npm tarball', async () => {
  const tmp = resolve(repoRoot, 'test/fixtures/delivery-manifest-ci-red-npm');
  mkdirSync(tmp, { recursive: true });
  const origEnv = { ...process.env };
  try {
    writeCiFixture(tmp);
    process.env.GITHUB_REPOSITORY = 'yaleh/quay';
    process.env.GITHUB_REF_NAME = 'v0.3.13';

    // Published assets have NO matching npm tarball
    const mockResponse = {
      tag_name: 'v0.3.13',
      assets: [
        { name: 'quay-sea-0.3.13-linux-x64.tar.gz', content_type: 'application/gzip', size: 2048 },
        { name: 'quay-sea-0.3.13-macos-arm64.tar.gz', content_type: 'application/gzip', size: 2048 },
        { name: 'quay-sea-0.3.13-windows-x64.zip', content_type: 'application/zip', size: 2048 },
      ],
    };

    const result = await checkCi(tmp, 'fake-token', mockFetch(200, mockResponse));
    assert.equal(result.ok, false, 'should fail when npm tarball is missing');
    assert.ok(result.issues.some(i => i.includes('npm tarball')), `expected npm tarball issue, got: ${result.issues.join('; ')}`);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
    process.env = origEnv;
  }
});

test('checkCi RED — bundled-with entry when bundled package has no published SEA assets', async () => {
  const tmp = resolve(repoRoot, 'test/fixtures/delivery-manifest-ci-red-bundle');
  mkdirSync(tmp, { recursive: true });
  const origEnv = { ...process.env };
  try {
    writeCiFixture(tmp);
    process.env.GITHUB_REPOSITORY = 'yaleh/quay';
    process.env.GITHUB_REF_NAME = 'v0.3.13';

    // Published assets include npm tarball but NO SEA archives at all
    const mockResponse = {
      tag_name: 'v0.3.13',
      assets: [
        { name: 'quay-0.3.13.tgz', content_type: 'application/gzip', size: 1024 },
      ],
    };

    const result = await checkCi(tmp, 'fake-token', mockFetch(200, mockResponse));
    assert.equal(result.ok, false, 'should fail when SEA assets are missing');
    // Should report both quay SEA entries as missing (quay-native is bundled with quay, which is also missing)
    assert.ok(result.issues.some(i => i.includes('quay-native')), `expected quay-native issue, got: ${result.issues.join('; ')}`);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
    process.env = origEnv;
  }
});

test('checkCi fail-closed — network error (fetch throws)', async () => {
  const tmp = resolve(repoRoot, 'test/fixtures/delivery-manifest-ci-network-error');
  mkdirSync(tmp, { recursive: true });
  const origEnv = { ...process.env };
  try {
    writeCiFixture(tmp);
    process.env.GITHUB_REPOSITORY = 'yaleh/quay';
    process.env.GITHUB_REF_NAME = 'v0.3.13';

    const throwingFetch = async () => { throw new Error('connect ECONNREFUSED'); };
    const result = await checkCi(tmp, 'fake-token', throwingFetch as any);
    assert.equal(result.ok, false, 'should fail on network error');
    assert.ok(result.issues.some(i => i.includes('Failed to fetch')), `expected fetch failure, got: ${result.issues.join('; ')}`);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
    process.env = origEnv;
  }
});

test('checkCi fail-closed — GitHub API returns 401', async () => {
  const tmp = resolve(repoRoot, 'test/fixtures/delivery-manifest-ci-401');
  mkdirSync(tmp, { recursive: true });
  const origEnv = { ...process.env };
  try {
    writeCiFixture(tmp);
    process.env.GITHUB_REPOSITORY = 'yaleh/quay';
    process.env.GITHUB_REF_NAME = 'v0.3.13';

    const result = await checkCi(tmp, 'fake-token', mockFetch(401, { message: 'Bad credentials' }));
    assert.equal(result.ok, false, 'should fail on 401');
    assert.ok(result.issues.some(i => i.includes('401')), `expected 401 issue, got: ${result.issues.join('; ')}`);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
    process.env = origEnv;
  }
});

test('checkCi RED — missing GITHUB_REPOSITORY env var', async () => {
  const tmp = resolve(repoRoot, 'test/fixtures/delivery-manifest-ci-no-repo');
  mkdirSync(tmp, { recursive: true });
  const origEnv = { ...process.env };
  try {
    writeCiFixture(tmp);
    delete process.env.GITHUB_REPOSITORY;
    process.env.GITHUB_REF_NAME = 'v0.3.13';

    const result = await checkCi(tmp, 'fake-token');
    assert.equal(result.ok, false, 'should fail without GITHUB_REPOSITORY');
    assert.ok(result.issues.some(i => i.includes('GITHUB_REPOSITORY')), `expected env issue, got: ${result.issues.join('; ')}`);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
    process.env = origEnv;
  }
});

test('CLI --ci without GITHUB_TOKEN exits non-zero', () => {
  const origEnv = { ...process.env };
  try {
    delete process.env.GITHUB_TOKEN;
    try {
      execSync(`node --experimental-strip-types ${scriptPath} --ci 2>&1`, {
        encoding: 'utf-8', cwd: repoRoot, stdio: 'pipe',
      });
      assert.fail('expected non-zero exit when GITHUB_TOKEN is missing');
    } catch (e: any) {
      assert.equal(e.status, 1);
      assert.ok(
        e.stdout.includes('FAIL') || e.stdout.includes('GITHUB_TOKEN'),
        'should report missing GITHUB_TOKEN',
      );
    }
  } finally {
    process.env = origEnv;
  }
});
