/**
 * resolve-version.test — TDD tests for scripts/resolve-version.ts
 *
 * Run: node --experimental-strip-types --test scripts/resolve-version.test.ts
 *
 * TWO LAYERS, deliberately:
 *   • PURE — `resolveVersion(base, ctx)`. Every piece of git state arrives through `ctx`, so each
 *     branch of the judgment is reachable without a checkout. These are the AC2 cases as written.
 *   • REAL GIT — a throwaway repository under os.tmpdir() with a real commit, a real tag and a real
 *     `release/*` branch, driven through the CLI (`--mode build`). This is the DoD's requirement:
 *     "在临时 git 仓库里真实打 tag v0.0.1 / 建 release/v0.0.1 分支，实测 --mode build 返回无后缀"
 *     — fixture injection would prove the fixture, not the resolution (hard rule 4 推论三).
 *     Without this layer, "readGitContext really reads git" is asserted by nothing.
 *
 * TEMP DIRS ARE OUTSIDE THE CHECKED-IN TREE: fixtures live under os.tmpdir() (mkdtemp, process-private)
 * because `checked-in-write-check.ts` interposes on the fs write verbs and judges the resolved target
 * path — the repository tree is simultaneously another test's input.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import {
  resolveVersion,
  parseBaseVersion,
  readBaseVersion,
  readGitContext,
  BASE_VERSION_RE,
  DEV_SUFFIX,
} from './resolve-version.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');
const scriptPath = resolve(__dirname, 'resolve-version.ts');

// ── real-git fixture helpers ─────────────────────────────────────────────────────────────────
// Identity goes into the CHILD ENV, never `git config` in the fixture repo (a fixture must not write
// a repo-local config: it is state that outlives the command and would be inherited by later
// assertions). Also pins the global/system config away so a developer's own git config cannot change
// what these fixtures see.
function gitEnv(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    GIT_AUTHOR_NAME: 'resolve-version-test',
    GIT_AUTHOR_EMAIL: 'resolve-version-test@example.invalid',
    GIT_COMMITTER_NAME: 'resolve-version-test',
    GIT_COMMITTER_EMAIL: 'resolve-version-test@example.invalid',
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_CONFIG_SYSTEM: '/dev/null',
    GIT_CONFIG_NOSYSTEM: '1',
  };
}

function git(dir: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd: dir, encoding: 'utf-8', env: gitEnv() }).trim();
}

/** A throwaway repo with `VERSION` committed on branch `develop`. Returns its path. */
function makeRepo(base = '0.0.1'): string {
  const dir = mkdtempSync(join(tmpdir(), 'resolve-version-'));
  git(dir, 'init', '-q');
  // `symbolic-ref` rather than `git init -b`: works on every git version and states the intent
  // (an unborn HEAD pointing at develop) directly.
  git(dir, 'symbolic-ref', 'HEAD', 'refs/heads/develop');
  writeFileSync(join(dir, 'VERSION'), `${base}\n`);
  git(dir, 'add', 'VERSION');
  git(dir, 'commit', '-q', '-m', 'fixture: VERSION');
  return dir;
}

/** Invoke the CLI in `dir`; returns {status, stdout, stderr}. Never throws on a non-zero exit. */
function runCli(dir: string, ...args: string[]): { status: number; stdout: string; stderr: string } {
  try {
    const stdout = execFileSync('node', ['--no-warnings', '--experimental-strip-types', scriptPath, ...args], {
      cwd: dir,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { status: 0, stdout, stderr: '' };
  } catch (e: any) {
    return { status: e.status ?? -1, stdout: e.stdout ?? '', stderr: e.stderr ?? '' };
  }
}

function withRepo<T>(base: string, fn: (dir: string) => T): T {
  const dir = makeRepo(base);
  try {
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// ── pure: the source itself ──────────────────────────────────────────────────────────────────

test('parseBaseVersion accepts a bare X.Y.Z and rejects every suffix/shape', () => {
  assert.equal(parseBaseVersion('0.10.0'), '0.10.0');
  assert.equal(parseBaseVersion('  1.2.3\n'), '1.2.3');

  // A `<base>-dev` in VERSION is the exact confusion this task removes: the SOURCE must be bare.
  assert.throws(() => parseBaseVersion('0.10.0-dev'), /not a bare semver/);
  assert.throws(() => parseBaseVersion('1.2'), /not a bare semver/);
  assert.throws(() => parseBaseVersion('v1.2.3'), /not a bare semver/);
  assert.throws(() => parseBaseVersion('1.2.3\n4.5.6'), /not a bare semver/);
  assert.throws(() => parseBaseVersion(''), /not a bare semver/);
});

test('readBaseVersion reports a missing/unparseable source as an error, never as a base', () => {
  withRepo('0.0.1', (dir) => {
    assert.equal(readBaseVersion(dir).base, '0.0.1');
    assert.equal(readBaseVersion(dir).error, undefined);

    const noSource = mkdtempSync(join(tmpdir(), 'resolve-version-nosource-'));
    try {
      const missing = readBaseVersion(noSource);
      assert.equal(missing.base, '', 'a missing VERSION must not yield a base');
      assert.ok(missing.error, 'a missing VERSION must carry an error');
    } finally {
      rmSync(noSource, { recursive: true, force: true });
    }

    writeFileSync(join(dir, 'VERSION'), '0.0.1-dev\n');
    const malformed = readBaseVersion(dir);
    assert.equal(malformed.base, '', 'a suffixed VERSION must not yield a base');
    assert.ok(malformed.error, 'a suffixed VERSION must carry an error');
  });
});

// ── pure: tracked mode (AC2 case 1) ──────────────────────────────────────────────────────────

test('tracked mode is ALWAYS <base>-dev, on every branch and at every tag', () => {
  // The human ruling: the committed carriers do NOT self-describe a release — a tag commit still
  // commits `X.Y.Z-dev`. So no ctx the caller can pass may change the tracked answer.
  assert.equal(resolveVersion('9.9.9', { mode: 'tracked' }).version, `9.9.9${DEV_SUFFIX}`);
  assert.equal(resolveVersion('9.9.9', {}).version, `9.9.9${DEV_SUFFIX}`, 'tracked is the default mode');
  assert.equal(
    resolveVersion('9.9.9', { mode: 'tracked', branch: 'release/v9.9.9', tagsAtHead: ['v9.9.9'] }).version,
    `9.9.9${DEV_SUFFIX}`,
    'a release branch / tag at HEAD must NOT strip the suffix in TRACKED mode',
  );
});

// ── pure: build mode (AC2 cases 2-4) ─────────────────────────────────────────────────────────

test('build mode: HEAD at tag vX.Y.Z strips the suffix', () => {
  const r = resolveVersion('9.9.9', { mode: 'build', branch: 'develop', tagsAtHead: ['v9.9.9'] });
  assert.equal(r.evaluated, true);
  assert.equal(r.version, '9.9.9');
  // Falsifiable: the same ctx WITHOUT the tag is -dev. Without this pair, "the tag was read" and
  // "build always returns bare" are indistinguishable.
  assert.equal(resolveVersion('9.9.9', { mode: 'build', branch: 'develop', tagsAtHead: [] }).version, '9.9.9-dev');
});

test('build mode: a release/* branch strips the suffix', () => {
  const r = resolveVersion('9.9.9', { mode: 'build', branch: 'release/v9.9.9', tagsAtHead: [] });
  assert.equal(r.evaluated, true);
  assert.equal(r.version, '9.9.9');
  // Prefix match only: the repo's own release branches have been spelled with and without the `v`.
  assert.equal(resolveVersion('9.9.9', { mode: 'build', branch: 'release/9.9.9', tagsAtHead: [] }).version, '9.9.9');
});

test('build mode: develop/author/other branches keep -dev', () => {
  for (const branch of ['develop', 'author', 'task/gap-version-single-source-root-file-and-resolver', 'a_release_like_name']) {
    const r = resolveVersion('9.9.9', { mode: 'build', branch, tagsAtHead: [] });
    assert.equal(r.evaluated, true, `${branch} must be evaluable`);
    assert.equal(r.version, '9.9.9-dev', `${branch} must keep the suffix`);
  }
});

test('build mode: a version tag that disagrees with VERSION THROWS (fail-closed)', () => {
  assert.throws(
    () => resolveVersion('9.9.9', { mode: 'build', branch: 'develop', tagsAtHead: ['v9.9.8'] }),
    /HEAD carries version tag/,
  );
  // Also on an otherwise-release branch: the disagreement must not be laundered by the branch name.
  assert.throws(
    () => resolveVersion('9.9.9', { mode: 'build', branch: 'release/v9.9.9', tagsAtHead: ['v9.9.8'] }),
    /HEAD carries version tag/,
  );
  // A version tag ALONGSIDE the right one is still incoherent — not "close enough".
  assert.throws(
    () => resolveVersion('9.9.9', { mode: 'build', branch: 'develop', tagsAtHead: ['v9.9.9', 'v9.9.8'] }),
    /HEAD carries version tag/,
  );
});

test('build mode: a NON-version tag at HEAD is not version evidence (no throw, stays -dev)', () => {
  // Documented scope boundary: this repo carries many non-version tags (evidence/observation tags).
  // Treating any tag as a version carrier would redden a legitimate build; only `vX.Y.Z` is a carrier.
  const r = resolveVersion('9.9.9', { mode: 'build', branch: 'develop', tagsAtHead: ['ac214-baseline', 'vprobe'] });
  assert.equal(r.evaluated, true);
  assert.equal(r.version, '9.9.9-dev');
});

// ── pure: NOT-EVALUATED is a third value (AC2 case 6) ────────────────────────────────────────

test('build mode: detached HEAD with no version tag is NOT-EVALUATED, not -dev', () => {
  const r = resolveVersion('9.9.9', { mode: 'build', branch: null, tagsAtHead: [] });
  assert.equal(r.evaluated, false, 'a detached HEAD with no tag cannot be judged');
  assert.equal(r.version, '', 'no version may be reported');
  // THE POINT OF THE THIRD VALUE: it is distinguishable from the `-dev` answer AND from the bare one.
  assert.notEqual(r.version, '9.9.9-dev');
  assert.notEqual(r.version, '9.9.9');
  assert.ok(r.reason.length > 0, 'the not-evaluated state must state why');

  // Unreadable TAGS are the same shape (git unreadable) — never silently answered as -dev.
  assert.equal(resolveVersion('9.9.9', { mode: 'build', branch: 'develop', tagsAtHead: null }).evaluated, false);
  assert.equal(resolveVersion('9.9.9', { mode: 'build' }).evaluated, false, 'unprovided git state is unreadable, not empty');

  // Falsifiable both ways: the SAME ctx dressed as a real branch IS evaluable.
  assert.equal(resolveVersion('9.9.9', { mode: 'build', branch: 'develop', tagsAtHead: [] }).evaluated, true);
});

test('a detached HEAD that IS at a version tag resolves (not-evaluated is not a blanket refusal)', () => {
  const r = resolveVersion('9.9.9', { mode: 'build', branch: null, tagsAtHead: ['v9.9.9'] });
  assert.equal(r.evaluated, true);
  assert.equal(r.version, '9.9.9');
});

test('an unparseable base THROWS in both modes — never a pass-shaped value', () => {
  assert.throws(() => resolveVersion('9.9.9-dev', { mode: 'tracked' }), /not a bare semver/);
  assert.throws(() => resolveVersion('9.9.9-dev', { mode: 'build', branch: 'develop', tagsAtHead: [] }), /not a bare semver/);
  assert.equal(BASE_VERSION_RE.test('9.9.9-dev'), false);
});

// ── REAL GIT: the resolution actually reads a checkout (DoD) ─────────────────────────────────

test('readGitContext reads a real branch and a real tag at HEAD', () => {
  withRepo('0.0.1', (dir) => {
    assert.equal(readGitContext(dir).branch, 'develop');
    assert.deepEqual(readGitContext(dir).tagsAtHead, []);

    git(dir, 'tag', 'v0.0.1');
    assert.deepEqual(readGitContext(dir).tagsAtHead, ['v0.0.1']);

    git(dir, 'checkout', '-q', '--detach', 'HEAD');
    assert.equal(readGitContext(dir).branch, null, 'a detached HEAD has no determinable branch');

    // ⛔ A non-repo dir must report null/null — "could not read", NOT "read and it was empty".
    const notARepo = mkdtempSync(join(tmpdir(), 'resolve-version-notrepo-'));
    try {
      assert.deepEqual(readGitContext(notARepo), { branch: null, tagsAtHead: null });
    } finally {
      rmSync(notARepo, { recursive: true, force: true });
    }
  });
});

test('REAL git: tag v0.0.1 / release-2 branch ⇒ --mode build has no suffix; a plain branch keeps -dev', () => {
  withRepo('0.0.1', (dir) => {
    // (a) plain branch, no tag ⇒ -dev
    const plain = runCli(dir, '--mode', 'build');
    assert.equal(plain.status, 0, plain.stderr);
    assert.equal(plain.stdout.trim(), '0.0.1-dev');

    // (b) a real `release/*` branch ⇒ bare
    git(dir, 'checkout', '-q', '-b', 'release/v0.0.1');
    const rel = runCli(dir, '--mode', 'build');
    assert.equal(rel.status, 0, rel.stderr);
    assert.equal(rel.stdout.trim(), '0.0.1', 'a release branch must build without the -dev suffix');

    // (c) a real tag v0.0.1 at HEAD on a plain branch ⇒ bare
    git(dir, 'checkout', '-q', 'develop');
    git(dir, 'tag', 'v0.0.1');
    const tagged = runCli(dir, '--mode', 'build');
    assert.equal(tagged.status, 0, tagged.stderr);
    assert.equal(tagged.stdout.trim(), '0.0.1', 'the tag commit must build without the -dev suffix');

    // (d) tracked mode is branch/tag-blind: the SAME tagged tree still reads -dev
    const tracked = runCli(dir, '--mode', 'tracked');
    assert.equal(tracked.status, 0, tracked.stderr);
    assert.equal(tracked.stdout.trim(), '0.0.1-dev', 'tracked carriers stay -dev even at the release tag');

    // (e) a detached HEAD with NO tag ⇒ NOT-EVALUATED (exit 3), and stdout names the state rather
    //     than a version. This is the case that would otherwise stamp a release artifact with -dev.
    git(dir, 'checkout', '-q', '-b', 'untagged-work');
    writeFileSync(join(dir, 'note.txt'), 'second commit\n');
    git(dir, 'add', 'note.txt');
    git(dir, 'commit', '-q', '-m', 'fixture: untagged commit');
    git(dir, 'checkout', '-q', '--detach', 'HEAD');
    const detached = runCli(dir, '--mode', 'build');
    assert.equal(detached.status, 3, `expected NOT-EVALUATED (exit 3), got ${detached.status}: ${detached.stdout}`);
    assert.match(detached.stdout, /NOT-EVALUATED/);
    assert.doesNotMatch(detached.stdout, /0\.0\.1/, 'a not-evaluated build must not emit a version');

    // (f) a version tag that disagrees with VERSION ⇒ ERROR (exit 1, fail-closed)
    git(dir, 'checkout', '-q', 'develop');
    git(dir, 'tag', 'v0.0.2');
    const mismatch = runCli(dir, '--mode', 'build');
    assert.equal(mismatch.status, 1, `expected the mismatched tag to fail closed, got ${mismatch.status}`);
    assert.match(mismatch.stderr, /HEAD carries version tag/);
  });
});

test('REAL git: --json carries the not-evaluated state AND a non-zero exit (it is a build input)', () => {
  withRepo('0.0.1', (dir) => {
    const ok = runCli(dir, '--mode', 'build', '--json');
    assert.equal(ok.status, 0, ok.stderr);
    const parsed = JSON.parse(ok.stdout);
    assert.deepEqual(
      { version: parsed.version, evaluated: parsed.evaluated, base: parsed.base, mode: parsed.mode },
      { version: '0.0.1-dev', evaluated: true, base: '0.0.1', mode: 'build' },
    );

    git(dir, 'checkout', '-q', '--detach', 'HEAD');
    const notEval = runCli(dir, '--mode', 'build', '--json');
    assert.equal(notEval.status, 3, 'a build INPUT that cannot be evaluated must not exit 0');
    const parsedNotEval = JSON.parse(notEval.stdout);
    assert.equal(parsedNotEval.evaluated, false);
    assert.equal(parsedNotEval.version, '');
  });
});

test('REAL repo: tracked mode on this checkout == VERSION + -dev (branch-independent)', () => {
  // Branch-independent by construction (the tracked form never reads git), so this cannot flake when
  // the test runs on a release branch or a detached CI checkout.
  const base = readBaseVersion(repoRoot);
  assert.ok(base.base, `this repo must carry a readable root VERSION: ${base.error ?? ''}`);
  const r = runCli(repoRoot, '--mode', 'tracked');
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout.trim(), `${base.base}${DEV_SUFFIX}`);
});
