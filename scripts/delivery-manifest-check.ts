#!/usr/bin/env node --experimental-strip-types
/**
 * delivery-manifest-check — asserts the delivery-manifest is well-formed and
 * that release.yml produces the artifacts it declares. Fail-closed: any
 * discrepancy → non-zero exit.
 *
 * Usage: node --experimental-strip-types scripts/delivery-manifest-check.ts [--json] [--ci]
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

export interface CiCheckResult extends ManifestCheckResult {
  ciMode: boolean;
  releaseTag: string | null;
  publishedAssetCount: number;
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

// ── CI mode: verify manifest entries against actual published GitHub Release assets ──

interface GitHubReleaseAsset {
  name: string;
  content_type: string;
  size: number;
}

interface GitHubReleaseResponse {
  tag_name: string;
  assets: GitHubReleaseAsset[];
}

/**
 * Build a set of published asset names from a GitHub Release API response.
 * Lowercased for case-insensitive matching.
 */
function extractPublishedAssetNames(assets: GitHubReleaseAsset[]): Set<string> {
  return new Set(assets.map(a => a.name.toLowerCase()));
}

/**
 * Check whether a manifest entry's npm-tarball artifactPattern matches any
 * published asset name.  The pattern is a template like "quay-{version}.tgz";
 * we convert it to a regex by escaping literal chars and replacing {version}
 * with [^-]+ (anything between hyphens).
 */
function npmPatternMatchesAsset(pattern: string, assetName: string): boolean {
  const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp('^' + escaped.replace(/\\\{version\\\}/g, '[^-]+') + '$', 'i');
  return re.test(assetName);
}

/**
 * Check whether a manifest SEA binary entry is covered by published assets.
 * If the entry has `bundled-with`, it is satisfied iff the bundled package's
 * SEA asset exists. Otherwise, each platform must have a matching asset.
 */
function seaEntryHasPublishedAsset(
  entry: ManifestArtifact,
  version: string,
  publishedAssets: Set<string>,
  seaPublished: Set<string> // package names that have published SEA assets
): boolean {
  if (entry['bundled-with']) {
    return seaPublished.has(entry['bundled-with']);
  }
  // Direct SEA entry: expect quay-sea-{version}-{platform}.{ext} for each platform
  for (const plat of entry.platforms ?? []) {
    const base = `quay-sea-${version}-${plat}`.toLowerCase();
    const hasZip = publishedAssets.has(`${base}.zip`);
    const hasTgz = publishedAssets.has(`${base}.tar.gz`);
    if (!hasZip && !hasTgz) return false;
  }
  return true;
}

/**
 * Check whether the plugin entry is covered by published assets.
 * The plugin is bundled inside the npm-pack tarball per the manifest note.
 */
function pluginEntryHasPublishedAsset(
  _plugin: ManifestPlugin,
  _version: string,
  publishedAssets: Set<string>,
  npmTarballPublished: boolean
): boolean {
  // Plugin is inside the npm tarball — satisfied iff npm tarball is published
  return npmTarballPublished;
}

/**
 * checkCi — verify manifest entries against actual published GitHub Release
 * assets. Fetches release metadata via the GitHub REST API using `GITHUB_TOKEN`.
 * Fail-closed: any API error produces non-zero exit.
 */
export async function checkCi(
  root: string,
  githubToken: string,
  fetchImpl: typeof fetch = fetch,
): Promise<CiCheckResult> {
  const issues: string[] = [];
  const manifest = readManifest(root);

  if (!manifest) {
    return {
      ok: false, manifestFound: false, manifestValid: false, manifestVersion: '',
      releaseYmlFound: false, npmTarballsDeclared: 0, seaPackagesDeclared: 0,
      ciMode: true, releaseTag: null, publishedAssetCount: 0,
      issues: ['delivery-manifest.json not found'],
    };
  }

  const repo = process.env.GITHUB_REPOSITORY;
  const tag = process.env.GITHUB_REF_NAME;

  if (!repo || !tag) {
    return {
      ok: false, manifestFound: true, manifestValid: true, manifestVersion: manifest.version,
      releaseYmlFound: false, npmTarballsDeclared: manifest.artifacts['npm-tarballs']?.length ?? 0,
      seaPackagesDeclared: manifest.artifacts['sea-binaries']?.length ?? 0,
      ciMode: true, releaseTag: tag ?? null, publishedAssetCount: 0,
      issues: ['CI mode requires GITHUB_REPOSITORY and GITHUB_REF_NAME environment variables (are we running in a GitHub Actions release workflow?)'],
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

  let publishedAssetCount = 0;
  let publishedAssets: Set<string> = new Set();
  let releaseTag: string | null = null;

  // Fetch release assets from GitHub API
  try {
    const [owner, repoName] = repo.split('/');
    const url = `https://api.github.com/repos/${owner}/${repoName}/releases/tags/${encodeURIComponent(tag)}`;
    const resp = await fetchImpl(url, {
      headers: {
        Authorization: `Bearer ${githubToken}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    });

    if (!resp.ok) {
      issues.push(`GitHub API returned ${resp.status} for release tag '${tag}': ${resp.statusText}`);
      return {
        ok: false, manifestFound: true, manifestValid, manifestVersion: manifest.version,
        releaseYmlFound: false,
        npmTarballsDeclared: npmTarballs.length, seaPackagesDeclared: seaBinaries.length,
        ciMode: true, releaseTag: tag, publishedAssetCount: 0,
        issues,
      };
    }

    const release: GitHubReleaseResponse = await resp.json();
    releaseTag = release.tag_name;
    publishedAssets = extractPublishedAssetNames(release.assets);
    publishedAssetCount = release.assets.length;
  } catch (err: any) {
    issues.push(`Failed to fetch release assets: ${err.message ?? String(err)}`);
    return {
      ok: false, manifestFound: true, manifestValid, manifestVersion: manifest.version,
      releaseYmlFound: false,
      npmTarballsDeclared: npmTarballs.length, seaPackagesDeclared: seaBinaries.length,
      ciMode: true, releaseTag: tag, publishedAssetCount: 0,
      issues,
    };
  }

  // ── Determine which packages have published SEA assets ──────────
  const seaPublished = new Set<string>();
  for (const s of seaBinaries) {
    if (!s['bundled-with'] && seaEntryHasPublishedAsset(s, manifest.version, publishedAssets, seaPublished)) {
      seaPublished.add(s.package);
    } else if (s['bundled-with'] && seaPublished.has(s['bundled-with'])) {
      seaPublished.add(s.package);
    }
  }

  // ── Check npm tarballs against published assets ──────────────────
  let npmTarballPublished = false;
  for (const t of npmTarballs) {
    let found = false;
    for (const assetName of publishedAssets) {
      if (npmPatternMatchesAsset(t.artifactPattern ?? '', assetName)) {
        found = true;
        npmTarballPublished = true;
        break;
      }
    }
    if (!found) {
      issues.push(`manifest declares npm tarball '${t.package}' (pattern: ${t.artifactPattern}) but no matching published asset found in GitHub Release '${tag}'`);
    }
  }

  // ── Check SEA binaries against published assets ──────────────────
  for (const s of seaBinaries) {
    if (s['bundled-with']) {
      // Bundled: check that the bundled-with package has published assets
      const bundledPkg = seaBinaries.find(sb => sb.package === s['bundled-with']);
      if (!bundledPkg) {
        issues.push(`manifest SEA entry '${s.package}' declares bundled-with '${s['bundled-with']}' but that package is not declared in the manifest`);
        continue;
      }
      if (!seaEntryHasPublishedAsset(bundledPkg, manifest.version, publishedAssets, seaPublished)) {
        issues.push(`manifest SEA entry '${s.package}' is bundled with '${s['bundled-with']}' but '${s['bundled-with']}' has no published SEA assets in GitHub Release '${tag}'`);
      }
    } else if (!s['bundled-with']) {
      if (!seaEntryHasPublishedAsset(s, manifest.version, publishedAssets, seaPublished)) {
        issues.push(`manifest declares SEA binary '${s.package}' for platforms [${(s.platforms ?? []).join(', ')}] but no matching published assets found in GitHub Release '${tag}'`);
      }
    }
  }

  // ── Check plugin against published assets ────────────────────────
  if (plugin?.id) {
    if (!pluginEntryHasPublishedAsset(plugin, manifest.version, publishedAssets, npmTarballPublished)) {
      issues.push(`manifest declares plugin '${plugin.id}' but the npm tarball (which bundles it) is not published in GitHub Release '${tag}'`);
    }
  }

  // ── Result ────────────────────────────────────────────────────────
  return {
    ok: manifestValid && issues.length === 0,
    manifestFound: true,
    manifestValid,
    manifestVersion: manifest.version,
    releaseYmlFound: existsSync(resolve(root, RELEASE_YML)),
    npmTarballsDeclared: npmTarballs.length,
    seaPackagesDeclared: seaBinaries.length,
    ciMode: true,
    releaseTag,
    publishedAssetCount,
    issues,
  };
}

// ── CLI ────────────────────────────────────────────────────────────────
const isMain = process.argv[1]?.endsWith('delivery-manifest-check.ts');
if (isMain) {
  const ciMode = process.argv.includes('--ci');
  const jsonMode = process.argv.includes('--json');

  if (ciMode) {
    const token = process.env.GITHUB_TOKEN;
    if (!token) {
      console.error('DELIVERY-MANIFEST-CHECK: FAIL');
      console.error('  - GITHUB_TOKEN not set — --ci mode requires a GitHub token');
      process.exit(1);
    }

    checkCi(process.cwd(), token).then(result => {
      if (jsonMode) {
        console.log(JSON.stringify(result, null, 2));
        process.exit(0);
      }

      if (!result.ok) {
        console.error('DELIVERY-MANIFEST-CHECK (--ci): FAIL');
        for (const i of result.issues) console.error(`  - ${i}`);
        process.exit(1);
      }

      console.error('DELIVERY-MANIFEST-CHECK (--ci): OK');
      console.error(`  manifest: ${MANIFEST_PATH} (v${result.manifestVersion})`);
      console.error(`  release: ${result.releaseTag}`);
      console.error(`  published assets: ${result.publishedAssetCount}`);
      console.error(`  npm tarballs declared: ${result.npmTarballsDeclared}`);
      console.error(`  SEA packages declared: ${result.seaPackagesDeclared}`);
      process.exit(0);
    });
  } else {
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
}
