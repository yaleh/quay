#!/usr/bin/env node --experimental-strip-types
/**
 * version-consistency-check — fail-closed gate: exits 0 iff every version-bearing artifact equals the
 * SINGLE SOURCE. Non-zero on ANY drift, on a missing/malformed source, or on an unreadable carrier.
 *
 * ── THE JUDGMENT (tasks/gap-version-single-source-root-file-and-resolver, 2026-09-20) ────────────
 * BEFORE: `every carrier carries the identical version string` — an INTERNAL-consistency question.
 *   It could not tell a uniformly-CORRECT tree from a uniformly-WRONG one: 15 artifacts all left at a
 *   stale `0.5.0` were "consistent" and the gate was green. It also could not answer "is there a
 *   carrier OUTSIDE this list" (a list is not a source).
 * AFTER: `every carrier == resolveVersion(VERSION, 'tracked')` — an EXTERNAL, single-source question.
 *   `VERSION` (repo root, git-tracked, bare `X.Y.Z`) is the source; `resolveVersion` derives the form
 *   the committed carriers must carry (`X.Y.Z-dev`, per the human ruling of 2026-09-20), and each of
 *   the enumerated carriers must equal it. A missing or malformed `VERSION` is mode:'error' — the
 *   checker has no source to judge against, so it must not report a verdict at all (hard rule 3b).
 *   The all-or-none suffix assertion is RETAINED as a second, structural reading (see `suffixPolicyOf`).
 *
 * The enumerated list below remains the canonical set of version-bearing files. Each entry is
 * { path, extractor } where extractor returns the version string from parsed content.
 *
 * Usage: node --experimental-strip-types scripts/version-consistency-check.ts [--json]
 *   --json  emit a JSON summary to stdout (always exit 0 for json; drift is in the JSON)
 */

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveVersion, readBaseVersion, type ResolveMode } from './resolve-version.ts';

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
  /** The bare semver read from `VERSION`. '' when the source could not be read (see `sourceError`). */
  sourceBase: string;
  /** `resolveVersion(sourceBase, 'tracked')` — what every carrier must equal. '' when unevaluable. */
  expectedVersion: string;
  /** Present iff the single source itself could not be read/parsed — no verdict is possible. */
  sourceError?: string;
}

/** The mode the committed carriers are judged against (see resolve-version.ts's header). */
export const CARRIER_MODE: ResolveMode = 'tracked';

/**
 * The comparison a carrier line prints and the judgment is made by. Spelled ONCE so the printed
 * contract and the enforced contract cannot drift apart (hard rule 5b: one home, not two).
 */
export const JUDGMENT_LABEL = "resolveVersion(VERSION,'tracked')";

export function check(root: string): CheckResult {
  const entries = readVersions(root);

  // The single source is read FIRST: without it there is no judgment to make at all, and reporting a
  // per-carrier verdict would be reporting agreement with a source that does not exist.
  const src = readBaseVersion(root);
  if (src.error) {
    return {
      ok: false,
      entries,
      uniqueVersions: [],
      mode: 'error',
      suffixPolicy: 'not-evaluated',
      sourceBase: '',
      expectedVersion: '',
      sourceError: src.error,
    };
  }
  const expectedVersion = resolveVersion(src.base, { mode: CARRIER_MODE }).version;

  const errors = entries.filter((e) => e.error);
  if (errors.length > 0) {
    // An unreadable member is NOT-EVALUATED, never 'all-bare' (hard rule 3b: "could not read" must
    // not wear the same value as "read and it was fine").
    return {
      ok: false,
      entries,
      uniqueVersions: [],
      mode: 'error',
      suffixPolicy: 'not-evaluated',
      sourceBase: src.base,
      expectedVersion,
    };
  }

  const versions = entries.map((e) => e.version);
  const unique = [...new Set(versions)];
  const suffixPolicy = suffixPolicyOf(versions);

  // THE JUDGMENT: every carrier equals the derived single-source form. `unique[0] !== expectedVersion`
  // is the half the OLD all-equal judgment could not see — a uniformly stale tree. The `mixed`
  // predicate below is retained as the structural second reading (a carrier set that agrees with
  // NEITHER form cleanly is a named diagnosis, not just "N versions drifted").
  const allEqual = unique.length === 1;
  const sourceAgrees = allEqual && unique[0] === expectedVersion;
  const ok = sourceAgrees && suffixPolicy !== 'mixed';

  return {
    ok,
    entries,
    uniqueVersions: unique,
    mode: ok ? 'all-equal' : 'drift',
    suffixPolicy,
    sourceBase: src.base,
    expectedVersion,
  };
}

// ── CLI ────────────────────────────────────────────────────────────────
// Only run CLI when this is the entry point (not when imported by tests).
const isMain = process.argv[1] && (process.argv[1].endsWith('version-consistency-check.ts') || process.argv[1].endsWith('version-consistency-check'));
if (isMain) {
  const argv = process.argv.slice(2);
  let root = process.cwd();
  let jsonMode = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--root') {
      const v = argv[++i];
      if (!v) {
        console.error('version-consistency-check: --root requires a directory');
        process.exit(2);
      }
      root = resolve(v);
    } else if (a === '--json') {
      jsonMode = true;
    } else if (a === '-h' || a === '--help') {
      console.log('usage: node --experimental-strip-types scripts/version-consistency-check.ts [--root <dir>] [--json]');
      process.exit(0);
    } else {
      console.error(`version-consistency-check: unknown arg: ${a}`);
      process.exit(2);
    }
  }

  const result = check(root);

  if (jsonMode) {
    // Unchanged contract: --json always exits 0; the verdict is in the payload. (The CLI's non-json
    // path is the gate; this is the report path.)
    console.log(JSON.stringify(result, null, 2));
    process.exit(0);
  }

  // The comparison the judgment is made by is printed VERBATIM on every carrier line, so the output
  // states WHAT was compared, not merely how many agreed (AC3) — a reader can re-derive the verdict.
  // Plain stdout, not stderr: a gate's verdict is its output, and a caller grepping the command's
  // stdout must see it (a `2>&1` capture sees the same bytes either way).
  const carrierLine = (label: string, version: string, matches: boolean, expected: string) =>
    `  ${label.padEnd(55)} ${version} ${matches ? '==' : '!='} ${JUDGMENT_LABEL}` +
    (matches ? '' : ` (expected ${expected})`);

  if (result.mode === 'error') {
    console.log('VERSION-CONSISTENCY: ERROR');
    if (result.sourceError) {
      // The source itself is unreadable: there is no judgment to report, only the reason there is none.
      console.log(`  source: ${result.sourceError}`);
    } else {
      console.log(`  source: VERSION = ${result.sourceBase}`);
      console.log(`  expected: every carrier == ${JUDGMENT_LABEL} == ${result.expectedVersion}`);
      for (const e of result.entries) {
        if (e.error) console.log(`  ${e.label} (${e.path}): ERROR — ${e.error}`);
      }
    }
    process.exit(1);
  }

  const expected = result.expectedVersion;
  if (!result.ok) {
    console.log('VERSION-CONSISTENCY: DRIFT DETECTED');
    console.log(`  source: VERSION = ${result.sourceBase}`);
    console.log(`  expected: every carrier == ${JUDGMENT_LABEL} == ${expected}`);
    const offenders: string[] = [];
    for (const e of result.entries) {
      const matches = e.version === expected;
      if (!matches) offenders.push(`${e.label} (${e.version})`);
      console.log(carrierLine(e.label, e.version, matches, expected));
    }
    console.log(
      `\n${offenders.length} of ${result.entries.length} carriers != ${JUDGMENT_LABEL} == ${expected}:`,
    );
    for (const o of offenders) console.log(`  ${o}`);
    if (result.suffixPolicy === 'mixed') {
      // Name the failure mode: a half-applied `-dev` bump is not "N versions drifted", it is the
      // union disagreeing with itself about whether this tree is a released version.
      console.log('\nSUFFIX POLICY: MIXED — the union carries BOTH forms:');
      console.log(`  prerelease (X.Y.Z-…): ${JSON.stringify(result.uniqueVersions.filter(isPrereleaseVersion))}`);
      console.log(`  bare       (X.Y.Z) : ${JSON.stringify(result.uniqueVersions.filter((v) => !isPrereleaseVersion(v)))}`);
      console.log('SPEC §4.3 option ii (ruling 2, 2026-09-15): all-or-none — every carrier carries -dev, or none does.');
    }
    process.exit(1);
  }

  console.log('VERSION-CONSISTENCY: OK');
  console.log(`  source: VERSION = ${result.sourceBase}`);
  console.log(`  expected: every carrier == ${JUDGMENT_LABEL} == ${expected}`);
  for (const e of result.entries) {
    console.log(carrierLine(e.label, e.version, e.version === expected, expected));
  }
  console.log(
    `\nAll ${result.entries.length} carriers == ${JUDGMENT_LABEL} == ${expected} (suffix policy: ${result.suffixPolicy})`,
  );
  process.exit(0);
}
