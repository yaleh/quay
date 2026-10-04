#!/usr/bin/env node
// release-reading-sandbox.ts — take a `build`-mode version READING on a release-shaped branch
// WITHOUT creating that branch in the shared repository.
//
// THE DEFECT THIS CLOSES (tasks/gap-ac271-build-reading-creates-shared-release-ref, 2026-09-20):
// `resolve-version.ts` decides `build` mode BY BRANCH NAME (`RELEASE_BRANCH_RE = /^release\//`,
// scripts/resolve-version.ts:98): the un-suffixed `X.Y.Z` is produced iff HEAD carries tag `vX.Y.Z`
// OR the current branch is `release/*`. So every REAL verification of build mode must put HEAD on a
// REAL `release/*` branch in a REAL git repo. AC-271 forbids exactly that state:
//
//     CAUSE=release-branch-not-parked-on-a-tag — 1 of 1 release branches have a tip that is not
//     any tag: release/ac4-reading
//
// Both mechanisms are individually correct and they CONFLICT: a task whose AC legitimately reads
// "take a real build-mode reading on a temporary release/* branch" turns a `long-term: true`
// guarantee red for as long as the reading is being taken — and, measured 2026-09-20T04:51:07Z →
// 04:53:26Z, BOTH the creation and the cleanup left ZERO repository trace (`git branch -D` also
// drops the reflog; `.quay/release-branch-finish.jsonl` has no line for it). The guarantee was
// broken by a legal action and nothing in the repo could say who did it.
//
// THE FIX IS SEPARATION OF NAMESPACES, NOT A LOOSER CRITERION. The criterion stays exactly as
// strict as it is (negative control ① in the task re-runs it against a real offending branch and
// requires `verdict=fail`). What moves is the READING: it happens in a scratch git directory of its
// own (`git init` + `git fetch <rev>` + a branch created THERE), so the source repo's
// `refs/heads/release-*` / `refs/heads/release/*` namespace is never touched. The judgment is still
// the real one — this script shells out to the SAME `scripts/resolve-version.ts --mode build`; ⛔ it
// does NOT re-implement the branch/tag rule and ⛔ it adds no "inject a branch name" knob (hard rule
// 4 推论三: a reading only an injected seam can produce is an echo, not a measurement).
//
// ⛔ It is NOT a way to create a release branch in the source repo. It writes no ref to the source
// repo at all; the only git commands it runs against the source are READS.
//
// ── WHY A TRACE FILE (hard rule 9) ───────────────────────────────────────────────────────────────
// "A reading was taken" and "no reading was ever taken" must be distinguishable IN THE RECORD, not
// only from stdout. Every taken reading appends one JSONL line to `<root>/.quay/release-reading-sandbox.jsonl`
// (branch / time / sha / shape / version / result), read back with `--log`. An ABSENT trace file is
// NOT-EVALUATED with its OWN exit code (4) and its OWN `CAUSE=`; an UNREADABLE one has a third (5).
// They never share an output shape with "ran and recorded" (hard rule 3b).
//
// ── VOCABULARY (hard rule 8: names are never reused) ─────────────────────────────────────────────
// This record carries `shape=` ∈ {`release-branch`, `non-release-branch`} and `result=` ∈
// {`taken`, `not-evaluated`, `reading-error`}. It deliberately does NOT reuse `form=` — that word is
// owned by `.quay/release-branch-finish.jsonl` (values: none / merged / tagged / cut / …), a
// different carrier answering a different question ("was a finished branch deleted, and under which
// licence"), and a shared word would make two unrelated decisions read as one vocabulary.
//
// ── THE PAIRED NEGATIVE CONTROL IS THE POINT (hard rule 4 推论三) ─────────────────────────────────
// The same command must give `X.Y.Z` on a `release/*` branch and `X.Y.Z-dev` on any other branch.
// A caller that only ever reads the release shape cannot tell a real judgment from an implementation
// that always returns `X.Y.Z` — which is precisely the "echo" this repo has been burned by.
// `--branch <name>` is how the caller takes both readings; the task's AC5 evidence is that pair.
//
// CLI:
//   node --experimental-strip-types plugin/scripts/release-reading-sandbox.ts [--root <repo>]
//        [--rev <rev>] [--branch <name>] [--trace <file>] [--json] [--keep]
//   node --experimental-strip-types plugin/scripts/release-reading-sandbox.ts --log
//        [--trace <file>] [--root <repo>]
//     --root    the SOURCE repository the reading is about (default: the process's CWD). Only read.
//     --rev     the commit to read (default: HEAD of --root). Resolved there, then fetched
//               by sha into the sandbox, so an unreachable commit works as well as a branch tip.
//     --branch  the branch name the reading is taken ON, inside the sandbox (default:
//               release/reading-<UTC stamp>). `release-*` / `release/*` ⇒ release shape; anything
//               else ⇒ the paired non-release reading.
//     --trace   the record file (default: <root>/.quay/release-reading-sandbox.jsonl)
//     --json    emit the whole reading as one JSON object on stdout
//     --keep    leave the sandbox on disk and print its path (⛔ for debugging only; a kept sandbox
//               is a leaked temp dir — the normal path removes it)
//     --log     READ the record back (one line per reading: time, branch, shape, version, result)
//
// Output (human form): the SOURCE repo's release-ref enumeration BEFORE and AFTER the reading, the
// resolved branch/sha/shape, and the version resolve-version actually returned — so "the shared
// namespace stayed empty" and "the reading really produced the un-suffixed form" are certified by
// the SAME run (the task's DoD asks for exactly that).
//
// Exit codes:
//   0  a reading was taken and recorded (evaluated:true) — `version` is meaningful
//   1  the reading FAILED (resolve-version refused: unreadable VERSION, or a version tag at HEAD
//      disagreeing with the single source). Nothing is laundered into a version string.
//   2  usage error, or an INSTRUMENT failure: the source repo / rev could not be read, the sandbox
//      could not be built, or the record could not be written. ⛔ Never reads as "no release branch".
//   3  NOT-EVALUATED reading — resolve-version deliberately answers neither `X.Y.Z` nor `X.Y.Z-dev`
//      (its own value, never folded into 0 or 1; hard rule 3b)
//   4  `--log` on a MISSING record file: no reading was ever recorded here. Its own code — ⛔ not
//      shared with "recorded, but the line is empty" (hard rule 3b/9)
//   5  `--log` on an UNREADABLE record file: "could not look" is not "nothing there"

import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { appendFileSync, mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { enumerateReleaseRefs, git, revParseSha } from './git-runner.ts';

// ── git helpers (the runner + sha resolver + release-ref enumeration arrive from git-runner.ts —
//    the SINGLE implementation this script and release-branch-janitor.ts share; ⛔ do not re-copy) ──

/** A release-shaped branch NAME — the same prefix rule resolve-version judges by. */
const RELEASE_BRANCH_RE = /^release[\/-]/;

function shapeOf(branch: string): 'release-branch' | 'non-release-branch' {
  return RELEASE_BRANCH_RE.test(branch) ? 'release-branch' : 'non-release-branch';
}

function jsonEscape(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function utcStamp(d = new Date()): string {
  return d.toISOString().replace(/\.\d+Z$/, 'Z').replace(/[:]/g, '');
}

// ── the sandbox ──────────────────────────────────────────────────────────────────────────────────

interface Sandbox {
  dir: string;
  branch: string;
  sha: string;
  /** `null` = the branch could not be re-read after checkout (instrument failure, not a value). */
  headBranch: string | null;
}

/**
 * Build the sandbox: a FRESH git directory that shares no ref namespace with `root`.
 * Returns `{sandbox}` or `{error}` — never a half-built sandbox reported as a value.
 */
function buildSandbox(
  root: string,
  sha: string,
  branch: string,
): { sandbox?: Sandbox; error?: string } {
  const dir = mkdtempSync(join(tmpdir(), 'release-reading-sandbox-'));
  try {
    const init = git(dir, ['init', '-q']);
    if (init.status !== 0) {
      return { error: `git init failed in ${dir} (exit ${init.status}): ${init.stderr.trim()}` };
    }
    // Fetch BY SHA: this repo's own case (df538caa6, the 2026-09-20 offender) is reachable from no
    // surviving ref at all, so a clone-by-ref would silently cover only the easy half.
    const fetch = git(dir, ['fetch', '-q', '--no-tags', root, sha]);
    if (fetch.status !== 0) {
      return {
        error:
          `could not fetch ${sha} from ${root} into the sandbox (exit ${fetch.status}): ` +
          `${fetch.stderr.trim()} => the reading cannot be taken on a real object`,
      };
    }
    const fetched = revParseSha(dir, 'FETCH_HEAD^{commit}');
    if (fetched === null) {
      return { error: `the sandbox fetched ${sha} but FETCH_HEAD does not resolve to a commit` };
    }
    // The branch is created HERE, in the sandbox's own ref namespace. That is the whole point.
    const co = git(dir, ['checkout', '-q', '-b', branch, fetched]);
    if (co.status !== 0) {
      return {
        error:
          `could not create branch ${JSON.stringify(branch)} at ${fetched.slice(0, 12)} in the ` +
          `sandbox (exit ${co.status}): ${co.stderr.trim()}`,
      };
    }
    const sym = git(dir, ['symbolic-ref', '--short', 'HEAD']);
    const headBranch = sym.status === 0 && sym.stdout.trim().length > 0 ? sym.stdout.trim() : null;
    if (headBranch !== branch) {
      return {
        error:
          `the sandbox was created at ${dir} but its HEAD is ${JSON.stringify(headBranch)}, not ` +
          `${JSON.stringify(branch)} — the reading would be about a branch that is not the one asked for`,
      };
    }
    return { sandbox: { dir, branch, sha: fetched, headBranch } };
  } catch (e: any) {
    return { error: `building the sandbox failed: ${e?.message ?? String(e)}` };
  }
}

// ── the reading ──────────────────────────────────────────────────────────────────────────────────

interface Reading {
  exit: number;
  version: string;
  base: string;
  evaluated: boolean;
  reason: string;
  /** `null` when the payload could not be parsed — distinct from any of its values (hard rule 3b). */
  parsed: any | null;
}

/**
 * Run the REAL resolve-version judgment against the sandbox. The resolver lives in the SOURCE repo
 * (it is a repo-root script, not a plugin one), so it is invoked from `root` — the same command line
 * a human would type, no re-implementation, no injected branch-name seam.
 */
function takeReading(root: string, sandboxDir: string): Reading {
  const resolver = join(root, 'scripts', 'resolve-version.ts');
  const r = spawnSync(
    process.execPath,
    ['--no-warnings', '--experimental-strip-types', resolver, '--mode', 'build', '--root', sandboxDir, '--json'],
    { encoding: 'utf8' },
  );
  const exit = r.status ?? -1;
  const stdout = (r.stdout ?? '').trim();
  let parsed: any | null = null;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    parsed = null;
  }
  return {
    exit,
    version: typeof parsed?.version === 'string' ? parsed.version : '',
    base: typeof parsed?.base === 'string' ? parsed.base : '',
    evaluated: parsed?.evaluated === true,
    reason: typeof parsed?.reason === 'string' ? parsed.reason : (r.stderr ?? '').trim(),
    parsed,
  };
}

// ── the record (hard rule 9) ─────────────────────────────────────────────────────────────────────

interface TraceLine {
  ts: string;
  branch: string;
  sha: string;
  shape: string;
  version: string;
  result: 'taken' | 'not-evaluated' | 'reading-error';
  exit: number;
}

function traceAppend(file: string, line: TraceLine): { ok: boolean; error?: string } {
  try {
    mkdirSync(dirname(file), { recursive: true });
  } catch (e: any) {
    return { ok: false, error: `could not create ${dirname(file)}: ${e?.message ?? String(e)}` };
  }
  const body =
    `{"ts":"${jsonEscape(line.ts)}","branch":"${jsonEscape(line.branch)}",` +
    `"sha":"${jsonEscape(line.sha)}","shape":"${jsonEscape(line.shape)}",` +
    `"version":"${jsonEscape(line.version)}","result":"${jsonEscape(line.result)}",` +
    `"exit":${line.exit}}`;
  try {
    appendFileSync(file, `${body}\n`, 'utf8');
  } catch (e: any) {
    return { ok: false, error: `could not append to ${file}: ${e?.message ?? String(e)}` };
  }
  return { ok: true };
}

/** `--log`: read the record back. Absent ⇒ exit 4; unreadable ⇒ exit 5; else prints + exit 0. */
function logMode(traceFile: string): number {
  if (!existsSync(traceFile)) {
    process.stderr.write(
      `CAUSE=release-reading-trace-missing — no reading record at '${traceFile}': no reading has ` +
        'ever been recorded here. This is "never happened" — ⛔ NOT the same as "happened and ' +
        'recorded nothing" (hard rule 3b/9)\n',
    );
    return 4;
  }
  let text: string;
  try {
    if (!statSync(traceFile).isFile()) throw new Error('not a regular file');
    text = readFileSync(traceFile, 'utf8');
  } catch (e: any) {
    process.stderr.write(
      `CAUSE=release-reading-trace-unreadable — '${traceFile}' exists but cannot be read ` +
        `(${e?.message ?? String(e)}); refusing to report "no reading recorded" for a record that ` +
        'could not be looked at (hard rule 3b)\n',
    );
    return 5;
  }
  const lines = text.split('\n').filter((l) => l.trim().length > 0);
  for (const raw of lines) {
    let rec: any = null;
    try {
      rec = JSON.parse(raw);
    } catch {
      process.stdout.write(`  <unparseable record line: ${raw.slice(0, 120)}>\n`);
      continue;
    }
    process.stdout.write(
      `${rec.ts ?? '-'}  ${rec.branch ?? '-'}  shape=${rec.shape ?? '-'}  ` +
        `version=${rec.version === '' ? '(none)' : (rec.version ?? '-')}  ` +
        `result=${rec.result ?? '-'}  sha=${String(rec.sha ?? '-').slice(0, 12)}  exit=${rec.exit ?? '-'}\n`,
    );
  }
  process.stdout.write(`trace: ${lines.length} record(s) in ${traceFile}\n`);
  return 0;
}

// ── CLI ──────────────────────────────────────────────────────────────────────────────────────────

const usage =
  'usage: node --experimental-strip-types plugin/scripts/release-reading-sandbox.ts ' +
  '[--root <repo>] [--rev <rev>] [--branch <name>] [--trace <file>] [--json] [--keep]\n' +
  '       node --experimental-strip-types plugin/scripts/release-reading-sandbox.ts --log ' +
  '[--trace <file>] [--root <repo>]';

function main(argv: string[]): number {
  let root = process.cwd();
  let rev = 'HEAD';
  let branch = '';
  let traceFile = '';
  let jsonMode = false;
  let keep = false;
  let log = false;

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--root') root = resolve(argv[++i] ?? '');
    else if (a === '--rev') rev = argv[++i] ?? '';
    else if (a === '--branch') branch = argv[++i] ?? '';
    else if (a === '--trace') traceFile = resolve(argv[++i] ?? '');
    else if (a === '--json') jsonMode = true;
    else if (a === '--keep') keep = true;
    else if (a === '--log') log = true;
    else if (a === '-h' || a === '--help') {
      process.stdout.write(`${usage}\n`);
      return 0;
    } else {
      process.stderr.write(`release-reading-sandbox: unknown arg: ${a}\n${usage}\n`);
      return 2;
    }
  }

  if (traceFile === '') traceFile = join(root, '.quay', 'release-reading-sandbox.jsonl');

  if (log) return logMode(traceFile);

  if (rev === '') {
    process.stderr.write(`release-reading-sandbox: --rev requires a revision\n${usage}\n`);
    return 2;
  }
  if (branch === '') branch = `release/reading-${utcStamp()}`;

  // The source namespace is read BEFORE anything is built, and again AFTER — the same run certifies
  // both halves (the DoD asks for them to be certified together, not in two separate runs).
  const before = enumerateReleaseRefs(root);
  if (before === null) {
    process.stderr.write(
      `CAUSE=release-reading-source-unreadable — could not enumerate refs/heads/release-* in ` +
        `'${root}' (not a git repo, or git unavailable); "could not look" is ⛔ not "none there"\n`,
    );
    return 2;
  }

  const sha = revParseSha(root, `${rev}^{commit}`);
  if (sha === null) {
    process.stderr.write(
      `CAUSE=release-reading-rev-unresolvable — '${rev}' does not resolve to a commit in '${root}'; ` +
        'there is nothing to take a reading of\n',
    );
    return 2;
  }

  const built = buildSandbox(root, sha, branch);
  if (!built.sandbox) {
    process.stderr.write(`CAUSE=release-reading-sandbox-failed — ${built.error}\n`);
    return 2;
  }
  const sb = built.sandbox;

  let reading: Reading;
  let removed = false;
  try {
    reading = takeReading(root, sb.dir);
  } finally {
    if (!keep) {
      try {
        rmSync(sb.dir, { recursive: true, force: true });
        removed = !existsSync(sb.dir);
      } catch {
        removed = false;
      }
    }
  }

  const after = enumerateReleaseRefs(root);
  const shape = shapeOf(branch);
  const result: TraceLine['result'] =
    reading.exit === 3 ? 'not-evaluated' : reading.exit === 0 ? 'taken' : 'reading-error';

  const recorded = traceAppend(traceFile, {
    ts: new Date().toISOString(),
    branch,
    sha: sb.sha,
    shape,
    version: reading.version,
    result,
    exit: reading.exit,
  });

  if (jsonMode) {
    process.stdout.write(
      `${JSON.stringify({
        evaluated: reading.evaluated,
        branch,
        sha: sb.sha,
        shape,
        version: reading.version,
        reading: reading.parsed,
        readingExit: reading.exit,
        sourceReleaseRefsBefore: before,
        sourceReleaseRefsAfter: after,
        sandbox: sb.dir,
        sandboxRemoved: removed,
        trace: traceFile,
        recorded: recorded.ok,
        traceError: recorded.ok ? null : (recorded.error ?? null),
      })}\n`,
    );
  } else {
    process.stdout.write(
      `release-reading-sandbox: source release refs BEFORE = ${before.length}` +
        `${before.length ? ` [${before.join(', ')}]` : ''}\n`,
    );
    process.stdout.write(
      `release-reading-sandbox: sandbox=${sb.dir} (isolated git dir; the source repo holds no ref of it)\n`,
    );
    process.stdout.write(
      `release-reading-sandbox: branch=${branch} sha=${sb.sha} shape=${shape}\n`,
    );
    if (reading.evaluated) {
      process.stdout.write(
        `release-reading-sandbox: version=${reading.version} mode=build base=${reading.base} ` +
          `(${reading.reason})\n`,
      );
    } else {
      process.stdout.write(
        `release-reading-sandbox: NOT-EVALUATED (resolve-version exit ${reading.exit}): ${reading.reason}\n`,
      );
    }
    process.stdout.write(
      `release-reading-sandbox: source release refs AFTER = ${after === null ? 'UNREADABLE' : after.length}` +
        `${after && after.length ? ` [${after.join(', ')}]` : ''}\n`,
    );
    process.stdout.write(
      `release-reading-sandbox: sandbox ${removed ? 'removed' : keep ? 'KEPT (--keep)' : 'NOT removed'}\n`,
    );
    process.stdout.write(
      `release-reading-sandbox: ${recorded.ok ? 'recorded' : `NOT recorded (${recorded.error})`} → ${traceFile}\n`,
    );
  }

  if (!recorded.ok) {
    process.stderr.write(
      `CAUSE=release-reading-trace-write-failed — the reading above was taken, but it left no ` +
        `record in '${traceFile}' (hard rule 9)\n`,
    );
    return 2;
  }

  if (reading.exit === 0) return 0;
  if (reading.exit === 3) return 3;
  return 1;
}

process.exit(main(process.argv.slice(2)));
