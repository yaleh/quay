#!/usr/bin/env node --experimental-strip-types
/**
 * delivery-manifest-check — asserts the delivery-manifest is well-formed and
 * that release.yml produces the artifacts it declares. Fail-closed: any
 * discrepancy → non-zero exit.
 *
 * THE ARTIFACT SET IS NOW THE PLUGIN CHANNEL ONLY. The npm-pack (.tgz) and Node-SEA lines were
 * cancelled by the human ruling of 2026-09-16 (orchestration/SPEC-release-and-hotfix-branching-
 * 2026-09-15.md §11 — 「取消 sea 和 npm release」), and release.yml's six artifact jobs were removed
 * with them. `npm-tarballs` / `sea-binaries` are therefore OPTIONAL manifest sections, and an empty
 * one is a READING, not a defect: it is exactly what "the artifact line is cancelled" looks like.
 * ⛔ The alignment rule itself is unchanged and still runs in BOTH directions — an artifact
 * release.yml produces but the manifest does not declare (or vice versa) is still RED — so the
 * sections cannot silently reappear on one side only.
 *
 * ⛔ THE `--ci` MODE IS GONE, and that is not a weakening: it cross-checked the manifest's declared
 * artifacts against the assets a real GitHub Release had published, and the `delivery-manifest-verify`
 * job that ran it was removed by the same ruling. With no published assets there is nothing left for
 * it to judge — a mode that fetched a release and compared zero declarations against it would pass
 * always, which is the shape 硬规则 3b warns about (a check that cannot take the value false reads
 * as "everything is fine"). Its subject is gone, so the mode goes rather than turn vacuous.
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
  'bundled-with'?: string;
  note?: string;
}

export interface ManifestPlugin {
  id: string;
  'bundle-type': string;
  note?: string;
}

export interface DeliveryManifest {
  $schema: string;
  description: string;
  version: string;
  artifacts: {
    /** OPTIONAL since the 2026-09-16 ruling cancelled the npm-pack line (see the header): absent or
     *  empty means "this project no longer publishes npm tarballs", which is the current truth. */
    'npm-tarballs'?: ManifestArtifact[];
    /** OPTIONAL for the same reason (the Node-SEA line was cancelled alongside npm). */
    'sea-binaries'?: ManifestArtifact[];
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

  // Validate manifest structure. npm-tarballs / sea-binaries are OPTIONAL sections (see the
  // header): an ABSENT section is the readable statement "this project no longer produces that
  // artifact", so it is not a malformed manifest. A section that is present must still be an array.
  const npmDeclared = manifest.artifacts?.['npm-tarballs'];
  const seaDeclared = manifest.artifacts?.['sea-binaries'];
  const manifestValid =
    manifest.$schema === 'delivery-manifest-v1' &&
    typeof manifest.version === 'string' &&
    manifest.version.length > 0 &&
    (npmDeclared === undefined || Array.isArray(npmDeclared)) &&
    (seaDeclared === undefined || Array.isArray(seaDeclared)) &&
    manifest.artifacts?.plugin != null;

  if (!manifestValid) {
    issues.push('manifest structure invalid — missing required fields ($schema, version, artifacts.plugin)');
  }

  const npmTarballs = manifest.artifacts?.['npm-tarballs'] ?? [];
  const seaBinaries = manifest.artifacts?.['sea-binaries'] ?? [];
  const plugin = manifest.artifacts?.plugin;

  // ⛔ NO "the section must be non-empty" rule. That rule was correct while the npm/SEA lines
  // existed (an empty section meant entries had been lost); it is now backwards — it would redden
  // the manifest for correctly recording that the line is cancelled. What still has to be present
  // is the plugin entry below, so a manifest stripped of ALL its content is still caught.
  for (const t of npmTarballs) {
    if (!t.package || !t.artifactPattern) {
      issues.push(`npm tarball entry missing required fields: ${JSON.stringify(t)}`);
    }
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
  const structureOk = manifestValid && !!plugin?.id;
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
  const jsonMode = process.argv.includes('--json');
  const result = check(process.cwd());

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
