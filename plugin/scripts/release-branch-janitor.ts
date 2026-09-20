#!/usr/bin/env node
// release-branch-janitor.ts — the SELF-ACTING carrier for the release protocol's LAST step.
//
// THE DEFECT THIS CLOSES (tasks/gap-ac271-finish-step-needs-self-acting-carrier, 2026-09-20):
// AC-271 accepts exactly two compliant terminal forms for a release branch —
//     (a) the branch does not exist; or
//     (b) `git tag --points-at <branch>` is non-empty (its tip sits verbatim on a tag).
// SPEC §12.2 (human ruling 2026-09-20) puts the version tag on the MERGE POINT back into develop,
// which is a CHILD of the branch tip. Therefore form (b) is STRUCTURALLY UNREACHABLE for any release
// cut performed by the SPEC's own procedure: `--points-at` is always empty. The ONLY reachable
// compliant form is (a) DELETE — so the whole long-term guarantee rests on the delete step, and that
// step was, until now, performed only by whoever remembered to do it.
//
// Measured three times, and the third time by the repo's OWN release cut:
//   2026-09-19  release/v0.10.0 vanished with zero trace
//   2026-09-20  release/ac4-reading created and destroyed, both with zero trace (04:51:07Z→04:53:26Z)
//   2026-09-20  release/v0.11.0 — 3 gate failures (15:24:57Z / 15:29:00.488Z / 15:30:59.641Z), then a
//               ZERO-TRACE disappearance; `.quay/release-branch-finish.jsonl` gained no line and
//               `.git/logs/refs/heads/release/` does not exist (`git branch -D` drops the reflog).
// The carrier existed and was correct the whole time — `release-branch-finish.sh` — but NOTHING
// REQUIRED ANYONE TO GO THROUGH IT. Being skippable is the defect; another command would not fix it.
//
// ── WHAT THIS SCRIPT IS ─────────────────────────────────────────────────────────────────────────
// A JANITOR, not a judge. It runs the SAME enumeration AC-271 runs
// (`refs/heads/release-*` + `refs/heads/release/*`), and for each branch it dispatches to exactly one
// of THREE mutually-distinguishable outcomes:
//
//   parked-compliant     `tag --points-at <b>` non-empty ⇒ already compliant. ⛔ TOUCHED NOTHING.
//   finished-via-carrier red, and a licence to delete holds ⇒ ENDED THROUGH
//                        `release-branch-finish.sh` (the SAME compliance definition and the SAME
//                        trace carrier — ⛔ this file does NOT re-implement the delete and ⛔ never
//                        calls `git branch -D` itself).
//   left-alone-no-license red, and NEITHER licence holds ⇒ LEFT IN PLACE. This is precisely the
//                        "deleting would lose work" shape AC-271 must keep catching; a janitor that
//                        "cleaned" it would turn a real defect into a green light.
//
// ⛔ IT IS NOT WIRED INTO THE JUDGMENT PATH. It is deliberately NOT reachable from the goal gate /
// goal-driver: a judge that repairs the state it judges becomes self-certifying (hard rule 4). The
// janitor and the criterion are wired SEPARATELY — the janitor acts, the criterion still gets to fail.
//
// ── WHY "SELF-ACTING" MEANS A DRIVER STEP (hard rule 9: visibility ⊂ execution) ──────────────────
// A command nobody is obliged to run is the same defect one level up. So the janitor ALSO rides the
// worker-driver's per-round housekeeping (plugin/scripts/worker-driver.ts, next to
// `superseded_reclaim`): "the cut forgot to delete its branch" is settled within ONE TICK, with no
// human and no other agent needing to remember anything. Every round records the janitor's reading,
// so "ran and found nothing" is distinguishable from "never ran" (hard rule 4 推论三, the
// production-carrier half).
//
// ── INSTRUMENT FAILURE HAS ITS OWN OUTPUT (hard rule 3b) ────────────────────────────────────────
// "the enumeration / tag scan could not be performed" is NEVER printed as "there were no branches".
// It has its own exit code (2) and its own `CAUSE=`. Same for the record file: ABSENT (exit 4) and
// UNREADABLE (exit 5) never share an output with "ran, no branches to handle".
//
// ── VOCABULARY (hard rule 8: a name is never reused) ────────────────────────────────────────────
// This record's keys are {ts, scope, branch, sha, disposition, license, carrier_exit, exit}. Its
// branch-line disposition values are {parked-compliant, finished-via-carrier, finish-failed,
// left-alone-no-license}; its ONE pass-summary line uses a disjoint `pass-`-prefixed set
// {pass-clean, pass-finished, pass-left-alone-no-license, pass-finish-failed}. Licence values are
// {tag:<name>, merged-into:<base>, no-license, not-applicable}. It deliberately does NOT reuse
// `form=` (owned by .quay/release-branch-finish.jsonl: none / merged / tagged / cut) nor `shape=`
// (owned by .quay/release-reading-sandbox.jsonl: release-branch / non-release-branch) — not even as
// a VALUE (`no-license` rather than `none`, which `form=` already owns). A shared word would make two
// unrelated decisions read as one vocabulary. `plugin/test/release-branch-janitor.test.mjs` guards
// this mechanically against the single source (see `--vocabulary-json`), so a future edit cannot
// quietly collapse them.
//
// ⚠️ WHY THERE IS ALWAYS A PASS-SUMMARY LINE: without it, a pass that ran against a repo with an
// empty release namespace would write NOTHING, and the trace file's absence would then mean both
// "never ran" and "ran, nothing to do" — the exact hard-rule-3b conflation this carrier exists to
// avoid. `--log` on such a pass returns 0 with a `pass-clean` line; a missing file returns 4.
//
// CLI:
//   node --experimental-strip-types plugin/scripts/release-branch-janitor.ts [--root <repo>]
//        [--base <ref>] [--trace <file>] [--json] [--dry-run]
//   node --experimental-strip-types plugin/scripts/release-branch-janitor.ts --log
//        [--trace <file>] [--root <repo>]
//   node --experimental-strip-types plugin/scripts/release-branch-janitor.ts --vocabulary-json
//     --root       the repository to sweep (default: the repo this script lives in)
//     --base       the ref a branch must be merged into for the "merged" licence (default: develop,
//                  else origin/develop)
//     --trace      the janitor's own record file (default: <root>/.quay/release-branch-janitor.jsonl)
//     --json       emit the whole pass as one JSON object on stdout
//     --dry-run    decide and print, mutate nothing, record nothing
//     --log        READ the record back (one line per branch decision) + the record count
//     --vocabulary-json  print this carrier's declared record vocabulary (keys / dispositions /
//                  pass dispositions / licence kinds) so a test can compare it against the
//                  neighbouring carriers' WITHOUT a hand-copied second list
//
// Exit codes (RUN-level):
//   0  clean — every release branch was either already compliant or finished through the carrier;
//      also 0 for `--log` on a readable trace
//   1  at least one branch was delegated to the carrier and the carrier FAILED (it is still there)
//   2  INSTRUMENT failure — the enumeration or a tag scan could not be performed, so the branch set
//      this pass judges does not exist. ⛔ Never reads as "no branches"
//   3  at least one branch is red AND has no licence to delete ⇒ LEFT IN PLACE. This is a judgment,
//      not a janitor failure: AC-271 must still fail on it. ⛔ Never folded into 0
//   4  `--log` on a MISSING record file: the janitor has never recorded a pass here. Its own code —
//      ⛔ not shared with "ran, and there was nothing to do" (hard rule 3b/9)
//   5  `--log` on an UNREADABLE record file: "could not look" is not "nothing there"
//
// Per-branch outcome codes (the `exit` field of a trace line; a DISJOINT tens band so the two code
// spaces can never be confused):
//   0  parked-compliant       10 finished-via-carrier
//   11 finish-failed          13 left-alone-no-license

import { appendFileSync, existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDirectEntry } from './gate-script-base.ts';

// ── the declared vocabulary (single source; `--vocabulary-json` and the test read THIS) ──────────
export const JANITOR_RECORD_KEYS = [
  'ts',
  'scope',
  'branch',
  'sha',
  'disposition',
  'license',
  'carrier_exit',
  'exit',
];
/** Per-branch dispositions (`scope=branch`). */
export const JANITOR_DISPOSITIONS = [
  'parked-compliant',
  'finished-via-carrier',
  'finish-failed',
  'left-alone-no-license',
];
/** Per-PASS dispositions (`scope=pass`) — a distinct set so a pass that ran with an EMPTY enumeration
 *  still leaves a readable line: "ran and there was nothing to handle" must not be indistinguishable
 *  from "never ran" (hard rule 3b/9). The `pass-` prefix keeps the two value sets disjoint. */
export const JANITOR_PASS_DISPOSITIONS = [
  'pass-clean',
  'pass-finished',
  'pass-left-alone-no-license',
  'pass-finish-failed',
];
/** Licence kinds: `tag:<name>` / `merged-into:<base>` / `no-license` (branch lines);
 *  `not-applicable` (pass lines). ⛔ Deliberately NOT the neighbouring carriers' `form=none`. */
export const JANITOR_LICENSE_KINDS = ['tag', 'merged-into', 'no-license', 'not-applicable'];

export const JANITOR_TRACE_REL = '.quay/release-branch-janitor.jsonl';
export const JANITOR_CARRIER_REL = 'plugin/scripts/release-branch-finish.sh';

/** Per-branch outcome codes (see the header's DISJOINT tens band). */
const OUTCOME_PARKED_COMPLIANT = 0;
const OUTCOME_FINISHED = 10;
const OUTCOME_FINISH_FAILED = 11;
const OUTCOME_LEFT_ALONE = 13;

// ── git helpers ──────────────────────────────────────────────────────────────────────────────────

interface Ran {
  status: number;
  stdout: string;
  stderr: string;
}

function git(cwd: string, args: string[]): Ran {
  const r = spawnSync('git', ['-C', cwd, ...args], { encoding: 'utf8' });
  return { status: r.status ?? -1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

function lines(s: string): string[] {
  return s
    .split('\n')
    .map((x) => x.trim())
    .filter((x) => x.length > 0);
}

/**
 * The release-shaped branch namespace — the SAME enumeration AC-271's criterion makes (and the same
 * one `release-reading-sandbox.ts` reads). `null` = the enumeration could not be PERFORMED; it is
 * never an empty stand-in for "none there" (hard rule 3b).
 */
function enumerateReleaseBranches(root: string): string[] | null {
  const r = git(root, [
    'for-each-ref',
    '--format=%(refname:short)',
    'refs/heads/release-*',
    'refs/heads/release/*',
  ]);
  if (r.status !== 0) return null;
  return lines(r.stdout).sort();
}

function tipSha(root: string, branch: string): string | null {
  const r = git(root, ['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`]);
  if (r.status !== 0) return null;
  const sha = r.stdout.trim();
  return sha.length > 0 ? sha : null;
}

/** Tags whose object IS exactly the branch tip. `null` = the scan could not be performed. */
function tagsPointingAt(root: string, branch: string): string[] | null {
  const r = git(root, ['tag', '--points-at', `refs/heads/${branch}`]);
  if (r.status !== 0) return null;
  return lines(r.stdout);
}

/** Tags that CONTAIN the branch tip. `null` = the scan could not be performed. */
function tagsContaining(root: string, branch: string): string[] | null {
  const r = git(root, ['tag', '--contains', `refs/heads/${branch}`]);
  if (r.status !== 0) return null;
  return lines(r.stdout);
}

/** Commits in `base..branch`. `null` = the count could not be taken (never read as 0). */
function countAhead(root: string, base: string, branch: string): number | null {
  const r = git(root, ['rev-list', '--count', `${base}..refs/heads/${branch}`]);
  if (r.status !== 0) return null;
  const n = Number(r.stdout.trim());
  return Number.isFinite(n) ? n : null;
}

/** The ref a branch must be merged into for the "merged" licence. `null` = unresolvable. */
function resolveBase(root: string, explicit: string): string | null {
  const candidates = explicit !== '' ? [explicit] : ['develop', 'origin/develop'];
  for (const c of candidates) {
    const r = git(root, ['rev-parse', '--verify', '--quiet', `${c}^{commit}`]);
    if (r.status === 0 && r.stdout.trim().length > 0) return c;
  }
  return null;
}

// ── the pass ─────────────────────────────────────────────────────────────────────────────────────

export type JanitorDisposition =
  | 'parked-compliant'
  | 'finished-via-carrier'
  | 'finish-failed'
  | 'left-alone-no-license';

export interface JanitorBranchDecision {
  branch: string;
  sha: string;
  disposition: JanitorDisposition;
  /** `tag:<name>` | `merged-into:<base>` | `none` */
  license: string;
  /** the carrier's exit code when this branch was delegated; `null` when it was not */
  carrierExit: number | null;
  /** per-branch outcome code (the tens band in the header) */
  exit: number;
}

export interface JanitorResult {
  /** false ⇒ the enumeration/tag scan could not be performed; `branches` is then empty and MEANINGLESS */
  evaluated: boolean;
  verdict:
    | 'clean'
    | 'finished'
    | 'left-alone-no-license'
    | 'finish-failed'
    | 'instrument-failure';
  /** run-level exit code (see the header) */
  exit: number;
  /** the instrument `CAUSE=` text when `evaluated` is false */
  cause: string | null;
  branchCount: number;
  decisions: JanitorBranchDecision[];
  /** the red branches this pass acted on or refused to act on (attribution in the round record) */
  redBranches: string[];
  /** the carrier invocations, in order (command + exit) — the "went through the carrier" half */
  carrierCalls: Array<{ branch: string; exit: number; stdout: string; stderr: string }>;
}

export interface JanitorOptions {
  base?: string;
  dryRun?: boolean;
  /** test seam: override the carrier path */
  carrierPath?: string;
}

/**
 * One janitor pass. Pure with respect to its inputs except for (a) delegating deletions to the
 * carrier and (b) the caller's own trace append — this function itself writes no record, so the
 * driver can call it in-process and decide what to put in the round record.
 */
export function runReleaseBranchJanitor(root: string, opts: JanitorOptions = {}): JanitorResult {
  const dryRun = opts.dryRun === true;
  const empty = (verdict: JanitorResult['verdict'], exit: number, cause: string | null): JanitorResult => ({
    evaluated: cause === null,
    verdict,
    exit,
    cause,
    branchCount: 0,
    decisions: [],
    redBranches: [],
    carrierCalls: [],
  });

  const branches = enumerateReleaseBranches(root);
  if (branches === null) {
    return empty(
      'instrument-failure',
      2,
      `CAUSE=release-branch-janitor-enumeration-failed — could not enumerate refs/heads/release-* in '${root}' (not a git repo, or git unavailable) => the branch set this pass judges could not be enumerated; "could not look" is ⛔ not "none there" (hard rule 3b)`,
    );
  }

  const base = resolveBase(root, opts.base ?? '');
  if (base === null) {
    return empty(
      'instrument-failure',
      2,
      `CAUSE=release-branch-janitor-base-unresolvable — neither 'develop' nor 'origin/develop' resolves in '${root}', so the "merged back?" licence cannot be answered; refusing to classify anything (an unanswerable check must not read as "merged")`,
    );
  }

  const carrierPath = opts.carrierPath ?? join(root, JANITOR_CARRIER_REL);
  const decisions: JanitorBranchDecision[] = [];
  const carrierCalls: JanitorResult['carrierCalls'] = [];

  for (const branch of branches) {
    const sha = tipSha(root, branch) ?? '';

    const pointed = tagsPointingAt(root, branch);
    if (pointed === null) {
      return empty(
        'instrument-failure',
        2,
        `CAUSE=release-branch-janitor-tag-scan-failed — could not enumerate tags at '${branch}' in '${root}': 'could not look' must not be read as 'no tag holds it' (hard rule 3b)`,
      );
    }
    if (pointed.length > 0) {
      decisions.push({
        branch,
        sha,
        disposition: 'parked-compliant',
        license: `tag:${pointed[0]}`,
        carrierExit: null,
        exit: OUTCOME_PARKED_COMPLIANT,
      });
      continue;
    }

    // Red: `--points-at` is empty. Decide the licence — the SAME two forms the criterion and the
    // carrier accept (tag holds the tip; or the branch is fully merged back).
    const containing = tagsContaining(root, branch);
    if (containing === null) {
      return empty(
        'instrument-failure',
        2,
        `CAUSE=release-branch-janitor-tag-scan-failed — could not enumerate tags containing '${branch}' in '${root}': 'could not look' must not be read as 'no tag holds it' (hard rule 3b)`,
      );
    }
    let license = 'no-license';
    if (containing.length > 0) {
      license = `tag:${containing[0]}`;
    } else {
      const ahead = countAhead(root, base, branch);
      if (ahead === null) {
        return empty(
          'instrument-failure',
          2,
          `CAUSE=release-branch-janitor-merge-check-failed — could not count ${base}..${branch} in '${root}'; an unanswerable check must not read as 'merged' (hard rule 3b)`,
        );
      }
      if (ahead === 0) license = `merged-into:${base}`;
    }

    if (license === 'no-license') {
      // ⛔ LEFT IN PLACE. This is the shape AC-271 must keep failing on.
      decisions.push({
        branch,
        sha,
        disposition: 'left-alone-no-license',
        license: 'no-license',
        carrierExit: null,
        exit: OUTCOME_LEFT_ALONE,
      });
      continue;
    }

    if (dryRun) {
      decisions.push({
        branch,
        sha,
        disposition: 'finished-via-carrier',
        license,
        carrierExit: null,
        exit: OUTCOME_FINISHED,
      });
      continue;
    }

    // ⛔ Delegation, not re-implementation: the carrier owns the delete, the licence check and the
    // trace. `--no-remote` because this janitor's (and AC-271's) enumeration is the LOCAL
    // refs/heads namespace, and a per-round housekeeping step must not depend on network reachability.
    const r = spawnSync('bash', [carrierPath, branch, '--root', root, '--no-remote'], {
      encoding: 'utf8',
    });
    const carrierExit = r.status ?? -1;
    carrierCalls.push({
      branch,
      exit: carrierExit,
      stdout: (r.stdout ?? '').trim(),
      stderr: (r.stderr ?? '').trim(),
    });
    decisions.push({
      branch,
      sha,
      disposition: carrierExit === 0 ? 'finished-via-carrier' : 'finish-failed',
      license,
      carrierExit,
      exit: carrierExit === 0 ? OUTCOME_FINISHED : OUTCOME_FINISH_FAILED,
    });
  }

  const leftAlone = decisions.filter((d) => d.disposition === 'left-alone-no-license');
  const finishFailed = decisions.filter((d) => d.disposition === 'finish-failed');
  const finished = decisions.filter((d) => d.disposition === 'finished-via-carrier');

  let verdict: JanitorResult['verdict'] = 'clean';
  let exit = 0;
  if (finishFailed.length > 0) {
    verdict = 'finish-failed';
    exit = 1;
  } else if (leftAlone.length > 0) {
    verdict = 'left-alone-no-license';
    exit = 3;
  } else if (finished.length > 0) {
    verdict = 'finished';
    exit = 0;
  }

  return {
    evaluated: true,
    verdict,
    exit,
    cause: null,
    branchCount: branches.length,
    decisions,
    redBranches: decisions
      .filter((d) => d.disposition !== 'parked-compliant')
      .map((d) => d.branch),
    carrierCalls,
  };
}

// ── the record (hard rule 9) ─────────────────────────────────────────────────────────────────────

interface TraceLine {
  ts: string;
  /** `branch` = one branch decision; `pass` = the run-level summary line (always exactly one). */
  scope: 'branch' | 'pass';
  branch: string;
  sha: string;
  disposition: string;
  license: string;
  carrier_exit: number | null;
  exit: number;
}

function jsonEscape(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

export function traceAppend(file: string, line: TraceLine): { ok: boolean; error?: string } {
  try {
    mkdirSync(dirname(file), { recursive: true });
  } catch (e: any) {
    return { ok: false, error: `could not create ${dirname(file)}: ${e?.message ?? String(e)}` };
  }
  const body =
    `{"ts":"${jsonEscape(line.ts)}","scope":"${jsonEscape(line.scope)}",` +
    `"branch":"${jsonEscape(line.branch)}","sha":"${jsonEscape(line.sha)}",` +
    `"disposition":"${jsonEscape(line.disposition)}",` +
    `"license":"${jsonEscape(line.license)}",` +
    `"carrier_exit":${line.carrier_exit === null ? 'null' : line.carrier_exit},` +
    `"exit":${line.exit}}`;
  try {
    appendFileSync(file, `${body}\n`, 'utf8');
  } catch (e: any) {
    return { ok: false, error: `could not append to ${file}: ${e?.message ?? String(e)}` };
  }
  return { ok: true };
}

/** The pass-level disposition written as the run's summary line (see JANITOR_PASS_DISPOSITIONS). */
export function passDispositionOf(verdict: JanitorResult['verdict']): string {
  switch (verdict) {
    case 'clean':
      return 'pass-clean';
    case 'finished':
      return 'pass-finished';
    case 'left-alone-no-license':
      return 'pass-left-alone-no-license';
    case 'finish-failed':
      return 'pass-finish-failed';
    default:
      return 'pass-clean';
  }
}

/** `--log`: read the record back. Absent ⇒ exit 4; unreadable ⇒ exit 5; else prints + exit 0. */
function logMode(traceFile: string): number {
  if (!existsSync(traceFile)) {
    process.stderr.write(
      `CAUSE=release-branch-janitor-trace-missing — no janitor record at '${traceFile}': the janitor ` +
        'has never recorded a pass here. This is "never happened" — ⛔ NOT the same as "ran and there ' +
        'was nothing to handle" (hard rule 3b/9)\n',
    );
    return 4;
  }
  let text: string;
  try {
    if (!statSync(traceFile).isFile()) throw new Error('not a regular file');
    text = readFileSync(traceFile, 'utf8');
  } catch (e: any) {
    process.stderr.write(
      `CAUSE=release-branch-janitor-trace-unreadable — '${traceFile}' exists but cannot be read ` +
        `(${e?.message ?? String(e)}); refusing to report "nothing was handled" for a record that ` +
        'could not be looked at (hard rule 3b)\n',
    );
    return 5;
  }
  const rows = lines(text);
  for (const raw of rows) {
    let rec: any = null;
    try {
      rec = JSON.parse(raw);
    } catch {
      process.stdout.write(`  <unparseable record line: ${raw.slice(0, 120)}>\n`);
      continue;
    }
    process.stdout.write(
      `${rec.ts ?? '-'}  ${rec.branch || (rec.scope === 'pass' ? '(pass)' : '-')}  ` +
        `scope=${rec.scope ?? '-'}  disposition=${rec.disposition ?? '-'}  ` +
        `license=${rec.license ?? '-'}  sha=${String(rec.sha ?? '-').slice(0, 12)}  ` +
        `carrier_exit=${rec.carrier_exit ?? '-'}  exit=${rec.exit ?? '-'}\n`,
    );
  }
  process.stdout.write(`trace: ${rows.length} record(s) in ${traceFile}\n`);
  return 0;
}

// ── CLI ──────────────────────────────────────────────────────────────────────────────────────────

const usage =
  'usage: node --experimental-strip-types plugin/scripts/release-branch-janitor.ts ' +
  '[--root <repo>] [--base <ref>] [--trace <file>] [--json] [--dry-run]\n' +
  '       node --experimental-strip-types plugin/scripts/release-branch-janitor.ts --log ' +
  '[--trace <file>] [--root <repo>]';

function main(argv: string[]): number {
  const selfDir = dirname(fileURLToPath(import.meta.url));
  let root = join(selfDir, '..', '..');
  let base = '';
  let traceFile = '';
  let jsonMode = false;
  let dryRun = false;
  let log = false;

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--root') root = argv[++i] ?? '';
    else if (a === '--base') base = argv[++i] ?? '';
    else if (a === '--trace') traceFile = argv[++i] ?? '';
    else if (a === '--json') jsonMode = true;
    else if (a === '--dry-run') dryRun = true;
    else if (a === '--log') log = true;
    else if (a === '--vocabulary-json') {
      process.stdout.write(
        `${JSON.stringify({
          keys: JANITOR_RECORD_KEYS,
          dispositions: JANITOR_DISPOSITIONS,
          passDispositions: JANITOR_PASS_DISPOSITIONS,
          licenseKinds: JANITOR_LICENSE_KINDS,
        })}\n`,
      );
      return 0;
    } else if (a === '-h' || a === '--help') {
      process.stdout.write(`${usage}\n`);
      return 0;
    } else {
      process.stderr.write(`release-branch-janitor: unknown arg: ${a}\n${usage}\n`);
      return 2;
    }
  }

  if (traceFile === '') traceFile = join(root, JANITOR_TRACE_REL);

  if (log) return logMode(traceFile);

  const result = runReleaseBranchJanitor(root, { base, dryRun });

  let recorded = true;
  let recordError: string | null = null;
  // The pass summary line is written even when the enumeration is EMPTY, so "ran and there was
  // nothing to handle" leaves a readable record instead of being indistinguishable from "never ran"
  // (hard rule 3b/9). An instrument failure records nothing — there the `CAUSE=` on stderr IS the
  // output, and a line asserting a pass would be a lie.
  if (result.evaluated && !dryRun) {
    for (const d of result.decisions) {
      const r = traceAppend(traceFile, {
        ts: new Date().toISOString(),
        scope: 'branch',
        branch: d.branch,
        sha: d.sha,
        disposition: d.disposition,
        license: d.license,
        carrier_exit: d.carrierExit,
        exit: d.exit,
      });
      if (!r.ok) {
        recorded = false;
        recordError = r.error ?? 'unknown';
        break;
      }
    }
    if (recorded) {
      const r = traceAppend(traceFile, {
        ts: new Date().toISOString(),
        scope: 'pass',
        branch: '',
        sha: '',
        disposition: passDispositionOf(result.verdict),
        license: 'not-applicable',
        carrier_exit: null,
        exit: result.exit,
      });
      if (!r.ok) {
        recorded = false;
        recordError = r.error ?? 'unknown';
      }
    }
  }

  if (jsonMode) {
    process.stdout.write(
      `${JSON.stringify({
        evaluated: result.evaluated,
        verdict: result.verdict,
        exit: result.exit,
        cause: result.cause,
        dryRun,
        branchCount: result.branchCount,
        decisions: result.decisions,
        redBranches: result.redBranches,
        carrierCalls: result.carrierCalls,
        trace: traceFile,
        recorded,
        traceError: recordError,
      })}\n`,
    );
  } else if (result.evaluated) {
    // ⛔ GATED ON `evaluated`: an instrument failure must NEVER print the "nothing to handle" line —
    // that is the hard-rule-3b conflation this carrier exists to avoid ("could not look" read as
    // "none there"). On a failure the only output is the `CAUSE=` on stderr, below.
    process.stdout.write(
      `release-branch-janitor: enumerated ${result.branchCount} release branch(es) via the SAME ` +
        'enumeration AC-271 makes (refs/heads/release-* + refs/heads/release/*)\n',
    );
    for (const d of result.decisions) {
      process.stdout.write(
        `release-branch-janitor:   ${d.branch}  disposition=${d.disposition}  license=${d.license}  ` +
          `carrier_exit=${d.carrierExit ?? '-'}  exit=${d.exit}\n`,
      );
    }
    if (result.decisions.length === 0) {
      process.stdout.write('release-branch-janitor: nothing to handle (enumeration empty)\n');
    }
    process.stdout.write(
      `release-branch-janitor: verdict=${result.verdict} exit=${result.exit}` +
        `${dryRun ? ' (--dry-run: nothing was mutated or recorded)' : ` → ${traceFile}`}\n`,
    );
  }

  // The `CAUSE=` lines go to stderr in BOTH modes: they are the operator-facing signal, and a
  // caller parsing `--json` must not lose the reason a branch was left alone (⛔ not json-only).
  if (!result.evaluated) {
    process.stderr.write(`${result.cause}\n`);
  } else {
    for (const d of result.decisions) {
      if (d.disposition === 'left-alone-no-license') {
        process.stderr.write(
          `CAUSE=release-branch-janitor-left-alone-no-license — '${d.branch}' is red and holds NO ` +
            'licence to delete (its tip is in no tag, and it is not merged back): deleting it would ' +
            'lose work. LEFT IN PLACE — AC-271 must still fail on it\n',
        );
      } else if (d.disposition === 'finish-failed') {
        process.stderr.write(
          `CAUSE=release-branch-janitor-finish-failed — the carrier refused/failed for '${d.branch}' ` +
            `(exit ${d.carrierExit}); the branch is still present\n`,
        );
      }
    }
  }

  if (!recorded) {
    process.stderr.write(
      `CAUSE=release-branch-janitor-trace-write-failed — the pass above ran, but it left no record in ` +
        `'${traceFile}' (hard rule 9)\n`,
    );
    return 2;
  }

  return result.exit;
}

const isDirect = isDirectEntry(import.meta, process.argv[1], 'release-branch-janitor');

if (isDirect) process.exit(main(process.argv.slice(2)));
