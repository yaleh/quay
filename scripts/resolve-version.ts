#!/usr/bin/env node --experimental-strip-types
/**
 * resolve-version — derive a version string from the SINGLE tracked source (`VERSION` at the repo root).
 *
 * (tasks/gap-version-single-source-root-file-and-resolver; human ruling 2026-09-20, verbatim:
 *  「版本号应有唯一来源，由 git 跟踪。可以在 build 过程中，监测分支并加后缀，如 -dev。」
 *  「a. 仍提交字面量，但写死为基础版本加 -dev，由生成器在改 VERSION 时一并更新。」
 *  「tag 提交不再自描述。」)
 *
 * THE DEFECT THIS CLOSES: the version lived as a literal in 15 places (11 entries in
 * `version-consistency-check.ts`'s VERSION_ENTRIES + 4 workspace entries in `package-lock.json`), and a
 * release needed two hand-edits (drop `-dev` on the release branch, bump to `X.(Y+1).Z-dev` after the
 * merge back). `version-consistency-check` only ever answered "do the carriers agree with EACH OTHER",
 * never "do they equal the one source" — so a version that was uniformly WRONG was, and still is,
 * indistinguishable from a correct one by that checker alone.
 *
 * ── THE SINGLE SOURCE ────────────────────────────────────────────────────────────────────────────
 * `VERSION` (git-tracked, repo root) holds a BARE semver `X.Y.Z` — one line, no suffix. It is the
 * source. Every other version-bearing artifact is a DERIVED carrier of it, never a second source.
 *
 * ── THE TWO MODES ────────────────────────────────────────────────────────────────────────────────
 * `tracked` — the form committed into git. Per the human ruling (a) it is `X.Y.Z-dev`, ALWAYS, on
 *   every branch. The tracked carriers are deliberately NOT branch-dependent: a `release/*` branch
 *   still commits `X.Y.Z-dev` (the tag commit no longer self-describes; the released version is a
 *   property of the BUILD, not of the commit).
 * `build` — the form a build/release artifact carries: `X.Y.Z` (no suffix) iff HEAD is exactly at tag
 *   `vX.Y.Z`, OR the current branch is `release/*`; otherwise `X.Y.Z-dev`.
 *
 * ── THREE-VALUED, NEVER BOOLEAN (hard rule 3b) ───────────────────────────────────────────────────
 * `build` cannot always be judged: a detached HEAD carrying no version tag is neither "a release
 * build" nor "a development build", and silently answering `-dev` there would be exactly the
 * "could not read ⇒ looks like a pass" shape this repo has been burned by three times. So the result
 * is `{evaluated:false, version:'', ...}` — an INDEPENDENT value, distinguishable from both `X.Y.Z`
 * and `X.Y.Z-dev`. A caller that cannot tell the two apart is a caller that will stamp a wrong
 * version onto a release artifact.
 *
 * ── FAIL-CLOSED ON A MISMATCHED TAG ──────────────────────────────────────────────────────────────
 * `resolveVersion` THROWS (never returns) when HEAD carries version-shaped tag(s) `v<semver>` and none
 * is `v`+VERSION. A tag in the tree that disagrees with the single source is a real incoherence
 * (somebody tagged a commit whose VERSION says otherwise); resolving it to "the released version"
 * would launder the incoherence into a shipped artifact.
 *
 *   ⚠️ Deliberately OUT of the fail-closed set: tags that are NOT version-shaped (this repo carries
 *   many, e.g. observation/evidence tags). A non-version tag at HEAD is not evidence about the
 *   version at all, and treating it as one would redden a legitimate build. Only `vX.Y.Z` tags are
 *   version carriers — same "judge the carrier, not every nearby string" discipline as
 *   `version-consistency-check.ts`'s enumerated carrier set.
 *   ⚠️ Also deliberately NOT checked: whether a `release/*` branch name embeds a version matching
 *   VERSION (the repo's own release branches have been spelled both `release/vX.Y.Z` and
 *   `release/X.Y.Z`). The tag check above is the fail-closed point that actually protects a release
 *   commit; pinning the branch-name convention is a separate judgment with its own evidence.
 *
 * CLI:
 *   node --experimental-strip-types scripts/resolve-version.ts [--mode tracked|build] [--root <dir>] [--json]
 *     --mode   tracked (default) | build
 *     --root   the tree holding `VERSION` and the git checkout (default: the process's CWD — the same
 *              convention as `version-consistency-check.ts`, which this CLI is always run alongside;
 *              both are repo-root commands).
 *              ⚠️ `build` reads `git symbolic-ref`/`git tag` FROM HERE, so for a staged/dist tree that
 *              is not a checkout, pass the REPO root — not the staging dir.
 *     --json   emit {version, mode, evaluated, reason, base} on stdout.
 *
 * Exit codes:
 *   0 = resolved (stdout: the version string, one line; diagnostics on stderr)
 *   1 = ERROR — VERSION missing/unparseable, or a mismatched version tag at HEAD (fail-closed)
 *   2 = usage error (bad --mode / unknown flag)
 *   3 = NOT-EVALUATED — `evaluated:false` (detached HEAD with no version tag, or unreadable git state).
 *       ⚠️ Deliberately non-zero EVEN UNDER --json, deviating from this repo's `--json` ⇒ exit 0
 *       convention: this output is a BUILD INPUT, not a report. A build script that does
 *       `V=$(… --json | jq -r .version)` and ignores the payload would otherwise read the empty string
 *       as a version and silently stamp an artifact with it (hard rule 3b). The payload still carries
 *       `evaluated`, so a caller that DOES read it loses nothing.
 */

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
export const repoRoot = resolve(__dirname, '..');

export type ResolveMode = 'tracked' | 'build';

/** A base version is a BARE semver: `X.Y.Z`, exactly — no prerelease/build metadata. */
export const BASE_VERSION_RE = /^\d+\.\d+\.\d+$/;

/** The suffix the tracked carriers carry on every branch (SPEC §4.3 option ii, human ruling (a)). */
export const DEV_SUFFIX = '-dev';

/**
 * A VERSION TAG is `v` + a bare semver. Only these are version carriers; any other tag at HEAD is
 * ignored by the judgment (see the header's "deliberately OUT" note).
 */
const VERSION_TAG_RE = /^v\d+\.\d+\.\d+$/;

/** A release branch name. Matched by prefix only — see the header's second "deliberately NOT". */
const RELEASE_BRANCH_RE = /^release\//;

export interface ResolveContext {
  /** default: 'tracked' */
  mode?: ResolveMode;
  /** current branch short name. `null` = not determinable (detached HEAD / not a repo). */
  branch?: string | null;
  /** tag names pointing exactly at HEAD. `null` = not determinable (git unreadable). */
  tagsAtHead?: string[] | null;
}

export interface ResolveResult {
  /** false ⇒ `version` is '' and carries NO meaning: NOT-EVALUATED, not a version (hard rule 3b). */
  evaluated: boolean;
  version: string;
  mode: ResolveMode;
  reason: string;
}

/** Parse+validate a base version. THROWS on anything that is not a bare `X.Y.Z`. */
export function parseBaseVersion(raw: string): string {
  const v = raw.trim();
  if (!BASE_VERSION_RE.test(v)) {
    throw new Error(
      `not a bare semver (X.Y.Z, no suffix): ${JSON.stringify(raw)}`,
    );
  }
  return v;
}

export interface BaseVersionRead {
  base: string;
  error?: string;
}

/**
 * Read `VERSION` from `root`. A read failure OR a malformed body is reported via `error` and an empty
 * `base` — never as a base that "happens to be" whatever the file contained (hard rule 3b).
 */
export function readBaseVersion(root: string): BaseVersionRead {
  const path = resolve(root, 'VERSION');
  let raw: string;
  try {
    raw = readFileSync(path, 'utf-8');
  } catch (e: any) {
    return { base: '', error: `VERSION unreadable at ${path}: ${e?.message ?? String(e)}` };
  }
  try {
    return { base: parseBaseVersion(raw) };
  } catch (e: any) {
    return { base: '', error: `${path}: ${e?.message ?? String(e)}` };
  }
}

/**
 * The judgment. Pure: every piece of git state arrives through `ctx`, so the two modes are testable
 * without a checkout (and the real-git path is exercised separately by `readGitContext`).
 */
export function resolveVersion(base: string, ctx: ResolveContext = {}): ResolveResult {
  const mode: ResolveMode = ctx.mode ?? 'tracked';
  const parsed = parseBaseVersion(base); // throws — an unparseable base never yields a pass-shaped value

  if (mode === 'tracked') {
    return {
      evaluated: true,
      version: `${parsed}${DEV_SUFFIX}`,
      mode,
      reason: `tracked carriers are the committed literal form: always ${parsed}${DEV_SUFFIX}`,
    };
  }
  if (mode !== 'build') {
    throw new Error(`unknown mode: ${JSON.stringify(String(mode))} (expected 'tracked' or 'build')`);
  }

  const tags = ctx.tagsAtHead ?? null;
  const branch = ctx.branch ?? null;

  if (tags === null) {
    return {
      evaluated: false,
      version: '',
      mode,
      reason: 'tags at HEAD could not be read — cannot judge whether this is a tag/release build',
    };
  }

  const versionTags = tags.filter((t) => VERSION_TAG_RE.test(t));
  if (versionTags.length > 0) {
    const expected = `v${parsed}`;
    const unexpected = versionTags.filter((t) => t !== expected);
    if (unexpected.length > 0 || !versionTags.includes(expected)) {
      throw new Error(
        `HEAD carries version tag(s) ${versionTags.map((t) => JSON.stringify(t)).join(', ')} ` +
          `but VERSION says ${parsed} — expected the tag ${JSON.stringify(expected)}. ` +
          'Refusing to resolve (fail-closed: a tag that disagrees with the single source must not ' +
          'resolve to a released version).',
      );
    }
    return {
      evaluated: true,
      version: parsed,
      mode,
      reason: `HEAD is at tag ${expected}`,
    };
  }

  if (branch === null) {
    return {
      evaluated: false,
      version: '',
      mode,
      reason:
        'HEAD is detached and carries no version tag — cannot tell whether this is a release build ' +
        '(NOT-EVALUATED, deliberately not answered as a -dev)',
    };
  }

  if (RELEASE_BRANCH_RE.test(branch)) {
    return {
      evaluated: true,
      version: parsed,
      mode,
      reason: `branch ${branch} is a release branch`,
    };
  }

  return {
    evaluated: true,
    version: `${parsed}${DEV_SUFFIX}`,
    mode,
    reason: `branch ${branch} is not a release branch and HEAD carries no version tag`,
  };
}

/**
 * Read the git state resolveVersion needs, from a real checkout.
 * `null` on either field means NOT DETERMINABLE (detached HEAD for branch, unreadable git for tags) —
 * never an empty-string / empty-array stand-in that would read as a determinate answer.
 */
export function readGitContext(root: string): { branch: string | null; tagsAtHead: string[] | null } {
  let branch: string | null = null;
  try {
    const out = execFileSync('git', ['symbolic-ref', '--short', 'HEAD'], {
      cwd: root,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    branch = out.length > 0 ? out : null;
  } catch {
    // `git symbolic-ref` exits non-zero on a detached HEAD and outside a repo — both mean
    // "no branch is determinable", which is exactly what null means here.
    branch = null;
  }

  let tagsAtHead: string[] | null = null;
  try {
    const out = execFileSync('git', ['tag', '--points-at', 'HEAD'], {
      cwd: root,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    tagsAtHead = out.split('\n').map((s) => s.trim()).filter((s) => s.length > 0);
  } catch {
    tagsAtHead = null;
  }

  return { branch, tagsAtHead };
}

// ── CLI ────────────────────────────────────────────────────────────────
// Only run CLI when this is the entry point (not when imported by tests / by the checker).
const isMain =
  process.argv[1] &&
  (process.argv[1].endsWith('resolve-version.ts') || process.argv[1].endsWith('resolve-version'));

if (isMain) {
  const usage =
    'usage: node --experimental-strip-types scripts/resolve-version.ts [--mode tracked|build] ' +
    '[--root <dir>] [--json]';
  const argv = process.argv.slice(2);
  let mode: ResolveMode = 'tracked';
  let root = process.cwd();
  let jsonMode = false;

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--mode') {
      const v = argv[++i];
      if (v !== 'tracked' && v !== 'build') {
        console.error(`resolve-version: --mode must be tracked|build (got ${JSON.stringify(v)})`);
        process.exit(2);
      }
      mode = v;
    } else if (a === '--root') {
      const v = argv[++i];
      if (!v) {
        console.error('resolve-version: --root requires a directory');
        process.exit(2);
      }
      root = resolve(v);
    } else if (a === '--json') {
      jsonMode = true;
    } else if (a === '-h' || a === '--help') {
      console.log(usage);
      process.exit(0);
    } else {
      console.error(`resolve-version: unknown arg: ${a}\n${usage}`);
      process.exit(2);
    }
  }

  const src = readBaseVersion(root);
  if (src.error) {
    if (jsonMode) {
      console.log(
        JSON.stringify({ evaluated: false, version: '', mode, base: '', reason: src.error, error: true }),
      );
    } else {
      console.error(`RESOLVE-VERSION: ERROR — ${src.error}`);
    }
    process.exit(1);
  }

  const ctx: ResolveContext = mode === 'build' ? { mode, ...readGitContext(root) } : { mode };

  let res: ResolveResult;
  try {
    res = resolveVersion(src.base, ctx);
  } catch (e: any) {
    const reason = e?.message ?? String(e);
    if (jsonMode) {
      console.log(
        JSON.stringify({ evaluated: false, version: '', mode, base: src.base, reason, error: true }),
      );
    } else {
      console.error(`RESOLVE-VERSION: ERROR — ${reason}`);
    }
    process.exit(1);
  }

  if (jsonMode) {
    console.log(
      JSON.stringify({
        version: res.version,
        mode: res.mode,
        evaluated: res.evaluated,
        reason: res.reason,
        base: src.base,
      }),
    );
    process.exit(res.evaluated ? 0 : 3);
  }

  if (!res.evaluated) {
    // Named on BOTH streams: stdout is machine-consumed (the token is unambiguous), stderr is read by
    // a human. Neither channel shows a bare version string.
    console.error(`RESOLVE-VERSION: NOT-EVALUATED — ${res.reason}`);
    process.stdout.write('NOT-EVALUATED\n');
    process.exit(3);
  }

  console.error(`RESOLVE-VERSION: ${res.version} (base ${src.base}; ${res.reason})`);
  process.stdout.write(`${res.version}\n`);
  process.exit(0);
}
