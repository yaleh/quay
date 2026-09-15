#!/usr/bin/env node --experimental-strip-types
/**
 * version-consistency-check — fail-closed gate: exits 0 iff every version-bearing artifact
 * carries the identical version string. Non-zero on ANY drift.
 *
 * Single-source: the enumerated list below IS the canonical set of version-bearing files.
 * Each entry is { path, extractor } where extractor returns the version string from parsed content.
 *
 * Usage: node --experimental-strip-types scripts/version-consistency-check.ts [--json]
 *   --json  emit a JSON summary to stdout (always exit 0 for json; drift is in the JSON)
 */

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');

type VersionEntry = {
  label: string;
  path: string;
  extract(raw: string): string;
};

const VERSION_ENTRIES: VersionEntry[] = [
  {
    label: 'packages/quay',
    path: 'packages/quay/package.json',
    extract: (raw) => JSON.parse(raw).version,
  },
  {
    label: 'packages/quay-native',
    path: 'packages/quay-native/package.json',
    extract: (raw) => JSON.parse(raw).version,
  },
  {
    label: 'packages/quay-github',
    path: 'packages/quay-github/package.json',
    extract: (raw) => JSON.parse(raw).version,
  },
  {
    label: 'packages/quay-backlog',
    path: 'packages/quay-backlog/package.json',
    extract: (raw) => JSON.parse(raw).version,
  },
  {
    label: 'plugin/.claude-plugin/plugin.json',
    path: 'plugin/.claude-plugin/plugin.json',
    extract: (raw) => JSON.parse(raw).version,
  },
  {
    // Prose carrier, not a machine field: its version lives inside the sentence
    // `quay plugin v<semver> — …`. The extractor is ANCHORED to that sentence and THROWS when it
    // cannot find it — a reworded README must redden the gate (mode:'error'), never silently
    // return '' and read as "consistent" (hard rule 3b: an input it cannot parse must not
    // produce a value shaped like "pass"). Added by
    // gap-ac169-readme-version-not-in-version-consistency-set: README had drifted to v0.6.1 while
    // plugin.json was 0.6.3 across two bumps, precisely because it was NOT in this set.
    label: 'plugin/README.md',
    path: 'plugin/README.md',
    extract: (raw: string) => {
      const m = raw.match(/^quay plugin v(\d+\.\d+\.\d+)\b/m);
      if (!m) {
        throw new Error(
          'no "quay plugin v<semver>" version line found in plugin/README.md (cannot evaluate — not a pass)',
        );
      }
      return m[1];
    },
  },
  {
    label: 'plugin/.claude-plugin/marketplace.json (quay entry)',
    path: 'plugin/.claude-plugin/marketplace.json',
    extract: (raw) => {
      const data = JSON.parse(raw);
      const plugins = Array.isArray(data) ? data : (data.plugins ?? []);
      const q = plugins.find((p: any) => p.name === 'quay');
      if (!q) throw new Error('quay entry not found in plugin marketplace.json');
      return q.version;
    },
  },
  {
    label: '.claude-plugin/marketplace.json (quay entry)',
    path: '.claude-plugin/marketplace.json',
    extract: (raw) => {
      const data = JSON.parse(raw);
      const plugins = Array.isArray(data) ? data : (data.plugins ?? []);
      const q = plugins.find((p: any) => p.name === 'quay');
      if (!q) throw new Error('quay entry not found in root marketplace.json');
      return q.version;
    },
  },
  {
    label: 'plugin/vendor/quay/package.json',
    path: 'plugin/vendor/quay/package.json',
    extract: (raw) => JSON.parse(raw).version,
  },
  {
    // Plain-text version stamp (`plugin/VERSION` holds a bare semver and nothing else) — deliberately
    // NOT JSON.parse'd. Added by gap-ac259-version-union-lockstep-and-host-install-readings: this file
    // was the ONE member of the version-bearing union that no single judge covered. AC-259's criterion
    // enumerated it while this list did not (and vice versa for plugin/vendor/quay/package.json), so a
    // `plugin/VERSION`-only drift reddened AC-259 while this checker stayed green. Precedent on the real
    // release path: `6bf000622` claimed to bump "all 8 version-bearing files" and left plugin/VERSION at
    // 0.5.0 — requiring a second commit `bd466ce2a` to repair, with this checker green in between.
    // The extractor THROWS when the file does not hold a semver token: an unreadable stamp must land in
    // mode:'error', never be shaped like a stamp that agrees (hard rule 3b).
    label: 'plugin/VERSION',
    path: 'plugin/VERSION',
    extract: (raw: string) => {
      const v = raw.trim();
      if (!/^\d+\.\d+\.\d+/.test(v)) {
        throw new Error(
          'no bare semver in plugin/VERSION (cannot evaluate — not a pass)',
        );
      }
      return v;
    },
  },
];

export function resolveRepoRoot(callerDir?: string): string {
  return callerDir ? resolve(callerDir, '..') : repoRoot;
}

/**
 * archive/** exclusion (§12c, SPEC-plugin-lifecycle-single-bundle-2026-09-02): a version-bearing
 * file that was archived (archive/<date>/<original-path>) is a stale version source — an old
 * package.json under archive/ must not participate in the lockstep check. True iff the path lives
 * under the repo-root archive/ directory.
 */
export function isArchivedPath(relPath: string): boolean {
  return relPath === "archive" || relPath.startsWith("archive/") || relPath.includes("/archive/");
}

export function readVersions(root: string): { label: string; path: string; version: string; error?: string }[] {
  return VERSION_ENTRIES
    .filter((entry) => !isArchivedPath(entry.path))
    .map((entry) => {
      try {
        const raw = readFileSync(resolve(root, entry.path), 'utf-8');
        return { label: entry.label, path: entry.path, version: entry.extract(raw) };
      } catch (e: any) {
        return { label: entry.label, path: entry.path, version: '', error: e.message };
      }
    });
}

export interface CheckResult {
  ok: boolean;
  entries: { label: string; path: string; version: string; error?: string }[];
  uniqueVersions: string[];
  mode: 'all-equal' | 'drift' | 'error';
}

export function check(root: string): CheckResult {
  const entries = readVersions(root);
  const errors = entries.filter((e) => e.error);
  if (errors.length > 0) {
    return { ok: false, entries, uniqueVersions: [], mode: 'error' };
  }
  const versions = entries.map((e) => e.version);
  const unique = [...new Set(versions)];
  const allEqual = unique.length === 1;
  return { ok: allEqual, entries, uniqueVersions: unique, mode: allEqual ? 'all-equal' : 'drift' };
}

// ── CLI ────────────────────────────────────────────────────────────────
// Only run CLI when this is the entry point (not when imported by tests).
const isMain = process.argv[1] && (process.argv[1].endsWith('version-consistency-check.ts') || process.argv[1].endsWith('version-consistency-check'));
if (isMain) {
  const rootIdx = process.argv.indexOf('--root');
  const root = rootIdx >= 0 ? resolve(process.argv[rootIdx + 1]) : process.cwd();
  const args = process.argv.slice(2).filter((_a, i, arr) => arr[i] !== '--root' && arr[i - 1] !== '--root');
  const jsonMode = args.includes('--json');
  const result = check(root);

  if (jsonMode) {
    console.log(JSON.stringify(result, null, 2));
    process.exit(0);
  }

  if (!result.ok) {
    if (result.mode === 'error') {
      console.error('VERSION-CONSISTENCY: ERROR');
      for (const e of result.entries) {
        if (e.error) console.error(`  ${e.label} (${e.path}): ERROR — ${e.error}`);
      }
      process.exit(1);
    }
    console.error('VERSION-CONSISTENCY: DRIFT DETECTED');
    for (const e of result.entries) {
      console.error(`  ${e.label.padEnd(55)} ${e.version}`);
    }
    console.error(`\n${result.uniqueVersions.length} different versions across ${result.entries.length} files`);
    process.exit(1);
  }

  console.error('VERSION-CONSISTENCY: OK');
  for (const e of result.entries) {
    console.error(`  ${e.label.padEnd(55)} ${e.version}`);
  }
  console.error(`\nAll ${result.entries.length} files carry version ${result.uniqueVersions[0]}`);
  process.exit(0);
}
