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
    //
    // The capture group spans the WHOLE version token, INCLUDING an optional prerelease suffix.
    // This is not cosmetic: the previous form `/^quay plugin v(\d+\.\d+\.\d+)\b/m` *looks* like it
    // matches a version, but `\b` holds between `0` and `-`, so on `quay plugin v0.7.0-dev` the
    // group closes at `0.7.0` and the suffixed token reads as a BARE `0.7.0` — exactly the
    // self-description AC-272 exists to eliminate (hard rule 4c: a quantity that does not survive
    // the intermediate layer is not the quantity being judged; this one was measured, not assumed).
    // Widening the COMPARISON to prefix-equality is NOT the fix — that would let `0.7.0-dev` and
    // `0.7.0` judge each other consistent, which is the ambiguity itself.
    label: 'plugin/README.md',
    path: 'plugin/README.md',
    extract: (raw: string) => {
      const m = raw.match(/^quay plugin v(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)\b/m);
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
    // CONFIRMED (AC4, 2026-09-15) to survive the `-dev` suffix: it RETURNS THE WHOLE TRIMMED LINE
    // (`return v`), and `/^\d+\.\d+\.\d+/` is only a fail-closed GUARD, not a capture — so
    // `plugin/VERSION` holding `0.7.0-dev` reads back verbatim as `0.7.0-dev`. Contrast the README
    // entry above, whose extractor DID capture a truncated prefix.
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
  {
    // Added by gap-release-cut-via-workflow-dispatch (2026-09-15). `delivery-manifest.json` was the
    // ONE version-bearing file outside this set, and it drifted exactly the way this checker exists to
    // prevent: bumped through `08e8ec55f` (0.4.0 -> 0.5.0) and then left at `0.5.0` across the 0.6.x/0.7.x
    // bumps. The drift was invisible here but fatal on the release path — `delivery-manifest-check.ts`
    // then built the expected asset name as `quay-sea-${manifest.version}-${platform}` and EXACT-matched
    // it against the assets a run really published, so against release `v0.7.0` (assets
    // `quay-sea-0.7.0-*`) it matched nothing. Measured two-way in the task worktree with the real GitHub
    // Release: manifest 0.5.0 => 4 failures (2 SEA + 2 npm/plugin); manifest 0.7.0 => only the 2
    // npm/plugin failures that were there because that run's `release` job had failed and never uploaded
    // `quay-0.7.0.tgz`. Same shape as the plugin/README.md and plugin/VERSION additions above (hard rule
    // 5b: fixing the one instance that was reported does not mean it was the only one — the sweep over
    // the other version-bearing files returned this single remaining point).
    // ⚠️ 2026-09-16: that asset-name cross-check no longer exists — the npm-pack and Node-SEA release
    // lines were cancelled by the human ruling recorded in
    // orchestration/SPEC-release-and-hotfix-branching-2026-09-15.md §11, and `delivery-manifest-check`'s
    // `--ci` asset-verification mode was removed with them. `delivery-manifest.json` STAYS in this union
    // regardless: it is still a version-bearing release artifact (its `version` field tracks the release
    // the manifest describes, and `delivery-manifest-check.test.ts` asserts it equals
    // packages/quay/package.json's), and the original drift — the reason it was added — is a property of
    // the file, not of the checker that happened to catch it.
    // The extractor THROWS when the field is absent: an unparseable manifest must land in mode:'error',
    // never be shaped like a version that agrees (hard rule 3b).
    label: 'delivery-manifest.json',
    path: 'delivery-manifest.json',
    extract: (raw: string) => {
      const v = JSON.parse(raw).version;
      if (typeof v !== 'string' || !/^\d+\.\d+\.\d+/.test(v)) {
        throw new Error(
          'no semver in delivery-manifest.json .version (cannot evaluate — not a pass)',
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

/**
 * SPEC §4.3 option ii (human ruling 2, 2026-09-15): develop carries `X.Y.Z-dev`, the release branch
 * drops the suffix, the tag is cut on the de-suffixed commit. The union must therefore be
 * ALL-OR-NONE — either every carrier advertises a prerelease, or none does. A half-applied bump
 * (`0.7.0-dev` here, `0.7.0` there) makes "is this a released version?" depend on WHICH carrier you
 * read, which is the ambiguity AC-272 exists to remove.
 *
 * Honest scope (hard rule 4 — do not dress a redundant quantity up as a measurement): given the
 * exact-string comparison above, `mixed` already implies `drift`, so this predicate does not add a
 * second independent gate TODAY. What it adds is (a) a named diagnosis that enumerates BOTH forms
 * instead of reporting "N different versions", and (b) a guard that survives a future relaxation of
 * the comparison — if anyone ever "fixes" this checker to compare version PREFIXES (to be
 * suffix-tolerant), exact equality stops reddening the half-bump and this predicate becomes the
 * only thing that still does. Structure, not string equality, is what it reads.
 */
export function isPrereleaseVersion(v: string): boolean {
  return /-[0-9A-Za-z.-]+$/.test(v);
}

export type SuffixPolicy = 'all-suffixed' | 'all-bare' | 'mixed' | 'not-evaluated';

export function suffixPolicyOf(versions: string[]): SuffixPolicy {
  if (versions.length === 0) return 'not-evaluated';
  const suffixed = versions.filter(isPrereleaseVersion).length;
  if (suffixed === versions.length) return 'all-suffixed';
  if (suffixed === 0) return 'all-bare';
  return 'mixed';
}

export interface CheckResult {
  ok: boolean;
  entries: { label: string; path: string; version: string; error?: string }[];
  uniqueVersions: string[];
  mode: 'all-equal' | 'drift' | 'error';
  suffixPolicy: SuffixPolicy;
}

export function check(root: string): CheckResult {
  const entries = readVersions(root);
  const errors = entries.filter((e) => e.error);
  if (errors.length > 0) {
    // An unreadable member is NOT-EVALUATED, never 'all-bare' (hard rule 3b: "could not read" must
    // not wear the same value as "read and it was fine").
    return { ok: false, entries, uniqueVersions: [], mode: 'error', suffixPolicy: 'not-evaluated' };
  }
  const versions = entries.map((e) => e.version);
  const unique = [...new Set(versions)];
  const suffixPolicy = suffixPolicyOf(versions);
  const allEqual = unique.length === 1;
  const ok = allEqual && suffixPolicy !== 'mixed';
  return { ok, entries, uniqueVersions: unique, mode: ok ? 'all-equal' : 'drift', suffixPolicy };
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
    if (result.suffixPolicy === 'mixed') {
      // Name the failure mode: a half-applied `-dev` bump is not "N versions drifted", it is the
      // union disagreeing with itself about whether this tree is a released version.
      console.error('\nSUFFIX POLICY: MIXED — the union carries BOTH forms:');
      console.error(`  prerelease (X.Y.Z-…): ${JSON.stringify(result.uniqueVersions.filter(isPrereleaseVersion))}`);
      console.error(`  bare       (X.Y.Z) : ${JSON.stringify(result.uniqueVersions.filter((v) => !isPrereleaseVersion(v)))}`);
      console.error('SPEC §4.3 option ii (ruling 2, 2026-09-15): all-or-none — every carrier carries -dev, or none does.');
    }
    process.exit(1);
  }

  console.error('VERSION-CONSISTENCY: OK');
  for (const e of result.entries) {
    console.error(`  ${e.label.padEnd(55)} ${e.version}`);
  }
  console.error(`\nAll ${result.entries.length} files carry version ${result.uniqueVersions[0]}`);
  process.exit(0);
}
