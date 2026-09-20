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
 * ── WHERE THE CARRIER LIST LIVES (single home) ───────────────────────────────────────────────────
 * The set of version-bearing files is NOT declared here — it is `version-carriers.ts`'s
 * `VERSION_CARRIERS`, which `stamp-version.ts` (the GENERATOR) imports too. Two hand-maintained copies
 * of "which files carry a version" is the exact drift this repo's single-source discipline forbids: the
 * judge would keep passing while the generator silently missed a carrier. `version-carriers.ts` also
 * cross-checks, on every read, that the token it would rewrite is the field this judge reads.
 * tasks/gap-version-stamp-generator-and-build-wiring.
 *
 * Usage: node --experimental-strip-types scripts/version-consistency-check.ts [--json] [--root <dir>]
 *   --json  emit a JSON summary to stdout (always exit 0 for json; drift is in the JSON)
 */

import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveVersion, readBaseVersion, type ResolveMode } from './resolve-version.ts';
import {
  VERSION_CARRIERS,
  carrierPaths,
  readCarrierVersion,
  type VersionCarrier,
} from './version-carriers.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');

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

/**
 * Read every carrier of the shared table from `root`. `extract`-and-`locate` disagreement, a missing
 * file, or an unparseable body all land as `error` on that entry — never as a version that "happens to
 * be" whatever the file contained (hard rule 3b).
 */
export function readVersions(root: string): { label: string; path: string; version: string; error?: string }[] {
  // The read is the SHARED one (`readCarrierVersion`), not a local re-implementation: it is the very
  // call whose span/field cross-check the generator relies on, so "the judge reads field A" and "the
  // generator writes field B" cannot come apart (hard rule 4).
  return VERSION_CARRIERS.filter((entry: VersionCarrier) => !isArchivedPath(entry.path)).map((entry) => {
    const reading = readCarrierVersion(root, entry);
    return { label: reading.label, path: reading.path, version: reading.version, error: reading.error };
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
    `\nAll ${result.entries.length} carriers == ${JUDGMENT_LABEL} == ${expected} ` +
      `(over ${carrierPaths().length} files; suffix policy: ${result.suffixPolicy})`,
  );
  process.exit(0);
}
