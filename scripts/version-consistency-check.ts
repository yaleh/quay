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
 * Usage:
 *   node --experimental-strip-types scripts/version-consistency-check.ts [--json] [--root <dir>]
 *     --json  emit a JSON summary to stdout (always exit 0 for json; drift is in the JSON)
 *   node --experimental-strip-types scripts/version-consistency-check.ts --bundle-tree <dir> [--json]
 *     judge the BUNDLE-EMBEDDED axis of a build tree (see that section). Exit 0 green / 1 drift /
 *     3 NOT-EVALUATED — deliberately non-zero under --json too, because this output is a BUILD INPUT
 *     (a caller that ignores the payload must not read a failure as a pass; same deviation as
 *     resolve-version.ts's --json).
 *   node --experimental-strip-types scripts/version-consistency-check.ts --stamp-bundle-tree <dir>
 *     re-derive the inlined bundle version(s) from the tree's own plugin.json (the (b) half of
 *     gap-release-bundle-embeds-dev-version-after-stamp). Exit 0 written / 1 error / 3 NOT-EVALUATED.
 */

import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
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

// ── BUILD-TREE BUNDLE AXIS (gap-release-bundle-embeds-dev-version-after-stamp) ───────────────────
/**
 * A build tree (`plugin/` in the repo, the assembled orphan `dist-plugin` tree, the npm-pack
 * snapshot) carries an esbuild bundle at `vendor/quay/dist/quay.js` whose version is INLINED at
 * build time from `packages/quay/package.json` — and that file is committed `X.Y.Z-dev` on EVERY
 * branch. So a release build (branch `release/*`, or HEAD at tag `vX.Y.Z`), where `stamp-version`
 * writes the tree's CARRIERS as bare `X.Y.Z`, ships a bundle that still says `X.Y.Z-dev`: `quay
 * --version`, the MCP "Version: …" description and the `_version` field all report the dev form —
 * and nothing before this axis could see it. `stamp-version` writes carriers, never the bundle;
 * `quay-init.sh`'s `grep -oE '[0-9]+\.[0-9]+\.[0-9]+'` swallows the suffix, so its reading took the
 * same shape as "fine" (hard rule 3b).
 *
 * The bundle's only version-bearing token is the esbuild-inlined `package_default` object literal:
 *
 *     package_default = {
 *       name: "quay",
 *       version: "0.14.0-dev",   ← judged here; re-derived by `stampBundleTree`
 *       ...
 *     };
 *
 * ── WHY `stampBundleTree` RE-DERIVES TEXTUALLY RATHER THAN REBUILDING ─────────────────────────────
 * A full esbuild rebuild would have to be handed `packages/quay/package.json` carrying the release
 * form, which is committed `-dev` by design (human ruling 2026-09-20: the tag commit no longer
 * self-describes). Re-deriving the ONE anchored literal in the already-built bundle is the same
 * textual-locate technique `version-carriers.ts` uses for every JSON carrier, and it is safe
 * precisely because `checkBundleTree` judges the result: a re-derivation that misses a bundle cannot
 * hide, because the judge reddens on it.
 */

/** The build tree's own manifest — the expected version every bundle must match. */
export const BUNDLE_TREE_MANIFEST = '.claude-plugin/plugin.json';
/** The Core bundle's path within a build tree. Required: it ALWAYS carries a version. */
export const BUNDLE_TREE_CORE_BUNDLE = 'vendor/quay/dist/quay.js';
/** Bundled plugin script entrypoints; only the ones that embed a version are judged. */
export const BUNDLE_TREE_SCRIPTS_DIST = 'scripts/dist';

/** The esbuild variable that holds the inlined `packages/quay/package.json` object literal. */
export const EMBEDDED_ANCHOR = 'package_default';
/**
 * The inlined `version` field. Anchored to the `package_default` object so it cannot pick up a
 * `version:` from any OTHER object the bundle happens to inline (the real bundle carries ~10
 * unrelated `version: "…"` tokens from vendored libs — measured; an unanchored match is wrong).
 * Bounded to 400 chars after the `{` so a bundle that lost the field fails fast rather than scanning
 * the whole file for a far-away match.
 */
const EMBEDDED_VERSION_RE =
  /package_default\s*=\s*\{[\s\S]{0,400}?(?:version|"version")\s*:\s*"([^"]*)"/d;

export interface EmbeddedVersionSpan {
  value: string;
  start: number;
  end: number;
}

/** Locate the inlined `package_default.version` token; `null` when the anchor is absent. */
export function locateEmbeddedVersion(raw: string): EmbeddedVersionSpan | null {
  const m = raw.match(EMBEDDED_VERSION_RE);
  if (!m) return null;
  const indices = (m as unknown as { indices?: [number, number][] }).indices;
  if (!indices || !indices[1]) return null;
  const [start, end] = indices[1];
  return { value: m[1], start, end };
}

export function extractEmbeddedVersion(raw: string): string | null {
  return locateEmbeddedVersion(raw)?.value ?? null;
}

/**
 * Three-valued: `present:false` with no `error` means "read fine, this file carries no inlined
 * version" (legitimate for most `scripts/dist/*.js`); `error` means "could not read" — never a
 * version-shaped value (hard rule 3b).
 */
export interface EmbeddedReading {
  version: string;
  present: boolean;
  error?: string;
}

export function readEmbeddedVersion(absPath: string): EmbeddedReading {
  let raw: string;
  try {
    raw = readFileSync(absPath, 'utf-8');
  } catch (e: any) {
    return { version: '', present: false, error: `unreadable: ${e?.message ?? String(e)}` };
  }
  const span = locateEmbeddedVersion(raw);
  if (span === null) return { version: '', present: false };
  return { version: span.value, present: true };
}

/** Rewrite the inlined token; `true` iff the file changed. THROWS when the anchor is absent. */
export function restampEmbeddedVersion(absPath: string, version: string): boolean {
  const raw = readFileSync(absPath, 'utf-8');
  const span = locateEmbeddedVersion(raw);
  if (span === null) {
    throw new Error(`${absPath}: no inlined ${EMBEDDED_ANCHOR}.version token to rewrite (cannot stamp)`);
  }
  if (span.value === version) return false;
  writeFileSync(absPath, raw.slice(0, span.start) + version + raw.slice(span.end));
  return true;
}

export interface TreeExpected {
  version: string;
  error?: string;
}

/** The tree's expected version, read from its own `plugin.json` ('' + error when unjudgeable). */
export function readTreeExpectedVersion(root: string): TreeExpected {
  const abs = resolve(root, BUNDLE_TREE_MANIFEST);
  let raw: string;
  try {
    raw = readFileSync(abs, 'utf-8');
  } catch (e: any) {
    return {
      version: '',
      error: `${BUNDLE_TREE_MANIFEST}: unreadable — ${e?.message ?? String(e)} (cannot evaluate — not a pass)`,
    };
  }
  try {
    const v = JSON.parse(raw)?.version;
    if (typeof v !== 'string' || v.length === 0) {
      return { version: '', error: `${BUNDLE_TREE_MANIFEST}: no string .version (cannot evaluate — not a pass)` };
    }
    return { version: v };
  } catch (e: any) {
    return { version: '', error: `${BUNDLE_TREE_MANIFEST}: ${e?.message ?? String(e)}` };
  }
}

export interface BundleEntry {
  /** tree-relative path (contains `dist/quay.js` for the Core bundle, so reports name it verbatim) */
  path: string;
  version: string;
  error?: string;
  required: boolean;
}

export interface BundleCheckResult {
  root: string;
  ok: boolean;
  mode: 'consistent' | 'drift' | 'not-evaluated';
  expected: string;
  expectedError?: string;
  entries: BundleEntry[];
  scriptsScanned: number;
  scriptsEmbedded: number;
}

/** Read the `scripts/dist/*.js` bundles; skip the ones that legitimately carry no inlined version. */
function readScriptBundleEntries(root: string): { entries: BundleEntry[]; scanned: number; embedded: number } {
  const entries: BundleEntry[] = [];
  let scanned = 0;
  let embedded = 0;
  let names: string[];
  try {
    names = readdirSync(resolve(root, BUNDLE_TREE_SCRIPTS_DIST)).filter((n) => n.endsWith('.js')).sort();
  } catch {
    return { entries, scanned, embedded }; // no scripts/dist — the Core bundle is the whole subject
  }
  for (const n of names) {
    scanned++;
    const rel = `${BUNDLE_TREE_SCRIPTS_DIST}/${n}`;
    const reading = readEmbeddedVersion(resolve(root, rel));
    if (reading.error) {
      entries.push({ path: rel, version: '', error: reading.error, required: false });
      continue;
    }
    if (!reading.present) continue; // a script bundle that ships no version is not a silent miss
    embedded++;
    entries.push({ path: rel, version: reading.version, required: false });
  }
  return { entries, scanned, embedded };
}

/**
 * Judge a build tree's bundle-embedded versions against the tree's own `plugin.json`. The Core
 * bundle is REQUIRED to carry an inlined version (its absence is NOT-EVALUATED, never a pass);
 * `scripts/dist/*.js` are judged only when they carry one.
 */
export function checkBundleTree(root: string): BundleCheckResult {
  const expected = readTreeExpectedVersion(root);
  const entries: BundleEntry[] = [];

  const core = readEmbeddedVersion(resolve(root, BUNDLE_TREE_CORE_BUNDLE));
  entries.push({
    path: BUNDLE_TREE_CORE_BUNDLE,
    version: core.version,
    error:
      core.error ??
      (core.present ? undefined : `no inlined ${EMBEDDED_ANCHOR}.version token (cannot evaluate — not a pass)`),
    required: true,
  });

  const scripts = readScriptBundleEntries(root);
  entries.push(...scripts.entries);

  const errors = entries.filter((e) => e.error);
  let mode: BundleCheckResult['mode'];
  let ok: boolean;
  if (expected.error || errors.length > 0) {
    mode = 'not-evaluated';
    ok = false;
  } else {
    ok = entries.every((e) => e.version === expected.version);
    mode = ok ? 'consistent' : 'drift';
  }
  return {
    root,
    ok,
    mode,
    expected: expected.version,
    expectedError: expected.error,
    entries,
    scriptsScanned: scripts.scanned,
    scriptsEmbedded: scripts.embedded,
  };
}

export interface BundleStampResult {
  root: string;
  expected: string;
  expectedError?: string;
  written: string[];
  errors: { path: string; error: string }[];
}

/** Re-derive every version-carrying bundle in `root` from the tree's own `plugin.json` version. */
export function stampBundleTree(root: string): BundleStampResult {
  const expected = readTreeExpectedVersion(root);
  const result: BundleStampResult = {
    root,
    expected: expected.version,
    expectedError: expected.error,
    written: [],
    errors: [],
  };
  if (expected.error) return result;

  const targets: string[] = [BUNDLE_TREE_CORE_BUNDLE];
  try {
    for (const n of readdirSync(resolve(root, BUNDLE_TREE_SCRIPTS_DIST)).filter((x) => x.endsWith('.js')).sort()) {
      const rel = `${BUNDLE_TREE_SCRIPTS_DIST}/${n}`;
      // Only rewrite bundles that ALREADY carry an inlined version: a bundle without the anchor
      // legitimately ships no version, and `restampEmbeddedVersion` would THROW on it.
      if (readEmbeddedVersion(resolve(root, rel)).present) targets.push(rel);
    }
  } catch {
    /* no scripts/dist — the Core bundle is the whole target set */
  }

  for (const rel of targets) {
    try {
      if (restampEmbeddedVersion(resolve(root, rel), expected.version)) result.written.push(rel);
    } catch (e: any) {
      result.errors.push({ path: rel, error: e?.message ?? String(e) });
    }
  }
  return result;
}

/** Print a bundle check and return its exit code. */
function printBundleCheck(r: BundleCheckResult): number {
  const line = (e: BundleEntry) =>
    `  ${e.path}  ${e.error ? `ERROR — ${e.error}` : `${e.version} ${e.version === r.expected ? '==' : '!='} ${r.expected}`}`;
  if (r.mode === 'not-evaluated') {
    console.log('BUNDLE-EMBEDDED: NOT-EVALUATED');
    if (r.expectedError) console.log(`  ${r.expectedError}`);
    for (const e of r.entries) if (e.error) console.log(line(e));
    console.log('  (the bundle axis could not be judged — NOT a pass; hard rule 3b)');
    return 3;
  }
  if (r.mode === 'drift') {
    console.log('BUNDLE-EMBEDDED: DRIFT DETECTED');
    console.log(`  expected (from ${BUNDLE_TREE_MANIFEST}): ${r.expected}`);
    for (const e of r.entries) console.log(line(e));
    const offenders = r.entries.filter((e) => e.version !== r.expected);
    console.log(`\n${offenders.length} of ${r.entries.length} bundles != the tree's ${BUNDLE_TREE_MANIFEST} version:`);
    for (const o of offenders) console.log(`  ${o.path} (${o.version})`);
    return 1;
  }
  console.log('BUNDLE-EMBEDDED: OK');
  console.log(`  expected (from ${BUNDLE_TREE_MANIFEST}): ${r.expected}`);
  for (const e of r.entries) console.log(line(e));
  console.log(
    `\nAll ${r.entries.length} version-carrying bundle(s) == ${r.expected} ` +
      `(scripts/dist: ${r.scriptsEmbedded}/${r.scriptsScanned} carry a version)`,
  );
  return 0;
}

/** Print a bundle stamp and return its exit code. */
function printBundleStamp(r: BundleStampResult): number {
  if (r.expectedError) {
    console.log('BUNDLE-EMBEDDED-STAMP: NOT-EVALUATED');
    console.log(`  ${r.expectedError}`);
    return 3;
  }
  if (r.errors.length > 0) {
    console.log('BUNDLE-EMBEDDED-STAMP: ERROR');
    for (const e of r.errors) console.log(`  ${e.path}: ${e.error}`);
    return 1;
  }
  console.log(`BUNDLE-EMBEDDED-STAMP: OK — re-derived ${r.written.length} bundle(s) to ${r.expected}`);
  for (const w of r.written) console.log(`  ${w}`);
  return 0;
}

// ── CLI ────────────────────────────────────────────────────────────────
export function usage(): string {
  return (
    'usage: node --experimental-strip-types scripts/version-consistency-check.ts [--root <dir>] [--json]\n' +
    '       node --experimental-strip-types scripts/version-consistency-check.ts --bundle-tree <dir> [--json]\n' +
    '       node --experimental-strip-types scripts/version-consistency-check.ts --stamp-bundle-tree <dir> [--json]'
  );
}

/**
 * The CLI, as a function of argv returning an exit code — NOT a top-level `process.exit` script.
 * `scripts/version-consistency-check.mjs` (the Node-20-safe entry, mirroring `stamp-version.mjs`)
 * bundles this file and CALLS `main`, because `plugin/scripts/sync-vendor.sh` reaches it from the
 * root `postinstall` on the declared Node floor (`engines: >=20`), where `--experimental-strip-types`
 * does not exist. A bundle whose only way in were an `argv[1]` main-guard would load, match nothing,
 * and exit 0 having checked nothing — a gate that reads as "green" for a run that judged nothing
 * (hard rule 3b). `env.repoRoot` exists for the same caller: a bundle lives in a temp dir, so a root
 * derived from `import.meta.url` would be `/tmp`, not this checkout.
 */
export function main(argv: string[], env: { repoRoot?: string } = {}): number {
  let root = env.repoRoot ?? process.cwd();
  let jsonMode = false;
  let bundleTree: string | null = null;
  let stampBundleTreeRoot: string | null = null;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--root') {
      const v = argv[++i];
      if (!v) {
        console.error('version-consistency-check: --root requires a directory');
        return 2;
      }
      root = resolve(v);
    } else if (a === '--bundle-tree') {
      const v = argv[++i];
      if (!v) {
        console.error('version-consistency-check: --bundle-tree requires a directory');
        return 2;
      }
      bundleTree = resolve(v);
    } else if (a === '--stamp-bundle-tree') {
      const v = argv[++i];
      if (!v) {
        console.error('version-consistency-check: --stamp-bundle-tree requires a directory');
        return 2;
      }
      stampBundleTreeRoot = resolve(v);
    } else if (a === '--json') {
      jsonMode = true;
    } else if (a === '-h' || a === '--help') {
      console.log(usage());
      return 0;
    } else {
      console.error(`version-consistency-check: unknown arg: ${a}\n${usage()}`);
      return 2;
    }
  }

  // The bundle modes are a SEPARATE axis from the tracked-carrier judgment below, and their exit
  // code is a build input — non-zero even under --json (a caller that ignores the payload must not
  // read a failure as a pass; same deviation as resolve-version.ts's --json).
  if (stampBundleTreeRoot !== null) {
    const r = stampBundleTree(stampBundleTreeRoot);
    if (jsonMode) console.log(JSON.stringify(r, null, 2));
    else printBundleStamp(r);
    return r.expectedError ? 3 : r.errors.length > 0 ? 1 : 0;
  }
  if (bundleTree !== null) {
    const r = checkBundleTree(bundleTree);
    if (jsonMode) console.log(JSON.stringify(r, null, 2));
    else printBundleCheck(r);
    return r.mode === 'not-evaluated' ? 3 : r.ok ? 0 : 1;
  }

  const result = check(root);

  if (jsonMode) {
    // Unchanged contract: --json always exits 0; the verdict is in the payload. (The CLI's non-json
    // path is the gate; this is the report path.)
    console.log(JSON.stringify(result, null, 2));
    return 0;
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
    return 1;
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
    return 1;
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
  return 0;
}

// ── direct-run guard ───────────────────────────────────────────────────
// Only when THIS file is the entry point (not when the `.mjs` runner bundles and calls `main`).
const isMain =
  process.argv[1] &&
  (process.argv[1].endsWith('version-consistency-check.ts') ||
    process.argv[1].endsWith('version-consistency-check'));
if (isMain) {
  process.exit(main(process.argv.slice(2)));
}
