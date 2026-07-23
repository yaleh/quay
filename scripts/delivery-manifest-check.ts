#!/usr/bin/env node --experimental-strip-types
/**
 * delivery-manifest-check — asserts the delivery-manifest is well-formed and
 * that release.yml produces the artifacts it declares. Fail-closed: any
 * discrepancy → non-zero exit.
 *
 * Usage: node --experimental-strip-types scripts/delivery-manifest-check.ts [--json]
 */

import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');

const MANIFEST_PATH = 'delivery-manifest.json';
const RELEASE_YML = '.github/workflows/release.yml';

export interface ManifestArtifact {
  package: string;
  path?: string;
  artifactPattern?: string;
  platforms?: string[];
}

export interface ManifestPlugin {
  id: string;
  'bundle-type': string;
}

export interface DeliveryManifest {
  $schema: string;
  description: string;
  version: string;
  artifacts: {
    'npm-tarballs': ManifestArtifact[];
    'sea-binaries': ManifestArtifact[];
    plugin: ManifestPlugin;
  };
}

export interface ManifestCheckResult {
  ok: boolean;
  manifestFound: boolean;
  manifestValid: boolean;
  manifestVersion: string;
  releaseYmlFound: boolean;
  npmTarballsDeclared: number;
  seaPackagesDeclared: number;
  issues: string[];
}

export function readManifest(root: string): DeliveryManifest | null {
  const p = resolve(root, MANIFEST_PATH);
  if (!existsSync(p)) return null;
  return JSON.parse(readFileSync(p, 'utf-8'));
}

/** Parse release.yml to extract the set of artifact-producing npm pack packages */
export function parseReleaseYmlNpmTarballs(yml: string): Set<string> {
  const pkgs = new Set<string>();
  // Match `bash packages/<name>/scripts/package.sh` (the wrapper that calls npm pack)
  const re = /bash\s+packages\/([\w-]+)\/scripts\/package\.sh/g;
  let m;
  while ((m = re.exec(yml)) !== null) {
    pkgs.add(m[1]);
  }
  return pkgs;
}

/** Parse release.yml to extract SEA build packages */
export function parseReleaseYmlSeaBinaries(yml: string): Set<string> {
  const pkgs = new Set<string>();
  // Match `bash packages/<name>/scripts/build-sea.sh`
  const re = /bash\s+packages\/([\w-]+)\/scripts\/build-sea\.sh/g;
  let m;
  while ((m = re.exec(yml)) !== null) {
    pkgs.add(m[1]);
  }
  return pkgs;
}

export function check(root: string): ManifestCheckResult {
  const issues: string[] = [];
  const manifest = readManifest(root);
  const releaseYmlPath = resolve(root, RELEASE_YML);
  const releaseYmlFound = existsSync(releaseYmlPath);

  if (!manifest) {
    return {
      ok: false, manifestFound: false, manifestValid: false, manifestVersion: '',
      releaseYmlFound,
      npmTarballsDeclared: 0, seaPackagesDeclared: 0, issues: ['delivery-manifest.json not found'],
    };
  }

  // Validate manifest structure
  const manifestValid =
    manifest.$schema === 'delivery-manifest-v1' &&
    typeof manifest.version === 'string' &&
    manifest.version.length > 0 &&
    Array.isArray(manifest.artifacts?.['npm-tarballs']) &&
    Array.isArray(manifest.artifacts?.['sea-binaries']) &&
    manifest.artifacts?.plugin != null;

  if (!manifestValid) {
    issues.push('manifest structure invalid — missing required fields ($schema, version, artifacts.*)');
  }

  const npmTarballs = manifest.artifacts?.['npm-tarballs'] ?? [];
  const seaBinaries = manifest.artifacts?.['sea-binaries'] ?? [];
  const plugin = manifest.artifacts?.plugin;

  // Check npm tarballs
  if (npmTarballs.length === 0) {
    issues.push('no npm tarballs declared in manifest');
  }
  for (const t of npmTarballs) {
    if (!t.package || !t.artifactPattern) {
      issues.push(`npm tarball entry missing required fields: ${JSON.stringify(t)}`);
    }
  }

  // Check SEA binaries
  if (seaBinaries.length === 0) {
    issues.push('no SEA binaries declared in manifest');
  }
  for (const s of seaBinaries) {
    if (!s.package || !Array.isArray(s.platforms) || s.platforms.length === 0) {
      issues.push(`SEA binary entry missing required fields: ${JSON.stringify(s)}`);
    }
  }

  // Check plugin
  if (!plugin?.id) {
    issues.push('plugin entry missing in manifest');
  }

  // ── release.yml artifact-set comparison ──────────────────────────
  let releaseNpmTarballs: Set<string> = new Set();
  let releaseSeaBinaries: Set<string> = new Set();

  if (!releaseYmlFound) {
    issues.push(`${RELEASE_YML} not found`);
  } else {
    const yml = readFileSync(releaseYmlPath, 'utf-8');
    releaseNpmTarballs = parseReleaseYmlNpmTarballs(yml);
    releaseSeaBinaries = parseReleaseYmlSeaBinaries(yml);

    // Compare npm tarballs: manifest-declared vs release.yml-produced
    const manifestNpmSet = new Set(npmTarballs.map((t: any) => t.package));
    for (const pkg of manifestNpmSet) {
      if (!releaseNpmTarballs.has(pkg)) {
        issues.push(`manifest declares npm tarball '${pkg}' but release.yml does NOT produce it (missing npm pack packages/${pkg})`);
      }
    }
    for (const pkg of releaseNpmTarballs) {
      if (!manifestNpmSet.has(pkg)) {
        issues.push(`release.yml produces npm tarball '${pkg}' but manifest does NOT declare it`);
      }
    }

    // Compare SEA binaries: manifest-declared vs release.yml-produced
    const manifestSeaSet = new Set(seaBinaries.map((s: any) => s.package));
    for (const pkg of manifestSeaSet) {
      if (!releaseSeaBinaries.has(pkg)) {
        issues.push(`manifest declares SEA binary '${pkg}' but release.yml does NOT produce it (missing bash packages/${pkg}/scripts/build-sea.sh)`);
      }
    }
    for (const pkg of releaseSeaBinaries) {
      if (!manifestSeaSet.has(pkg)) {
        issues.push(`release.yml produces SEA binary '${pkg}' but manifest does NOT declare it`);
      }
    }
  }

  // ── Result ────────────────────────────────────────────────────────
  const structureOk = manifestValid && npmTarballs.length > 0 && seaBinaries.length > 0 && !!plugin?.id;
  const alignmentOk = issues.length === 0;

  return {
    ok: structureOk && alignmentOk,
    manifestFound: true,
    manifestValid,
    manifestVersion: manifest.version,
    releaseYmlFound,
    npmTarballsDeclared: npmTarballs.length,
    seaPackagesDeclared: seaBinaries.length,
    issues,
  };
}

// ── CLI ────────────────────────────────────────────────────────────────
const isMain = process.argv[1]?.endsWith('delivery-manifest-check.ts');
if (isMain) {
  const result = check(process.cwd());
  const jsonMode = process.argv.includes('--json');

  if (jsonMode) {
    console.log(JSON.stringify(result, null, 2));
    process.exit(0);
  }

  if (!result.ok) {
    console.error('DELIVERY-MANIFEST-CHECK: FAIL');
    for (const i of result.issues) console.error(`  - ${i}`);
    process.exit(1);
  }

  console.error('DELIVERY-MANIFEST-CHECK: OK');
  console.error(`  manifest: ${MANIFEST_PATH} (v${result.manifestVersion})`);
  console.error(`  npm tarballs declared: ${result.npmTarballsDeclared}`);
  console.error(`  SEA packages declared: ${result.seaPackagesDeclared}`);
  console.error(`  release.yml: ${result.releaseYmlFound ? 'found' : 'NOT FOUND'}`);
  process.exit(0);
}
