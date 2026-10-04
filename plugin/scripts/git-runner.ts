// git-runner.ts — the shared git-invocation primitives for plugin/scripts.
//
// Why this module exists: a semantic-dedup-scan pass (.quay/routine-findings.jsonl, finding
// `ident-c4a3817c65503261`, routine `semantic-dedup-scan`, runId
// `semantic-dedup-scan-1791142275270`) found the two release-* scripts carrying byte-identical
// copies of one git runner:
//   git(cwd, args) -> {status, stdout, stderr}   release-branch-janitor.ts / release-reading-sandbox.ts
// — the body identical down to the `?? -1` / `?? ''` fallbacks — plus a copy each of the Ran
// interface it returns, the trim-and-drop line splitter, the `rev-parse --verify --quiet` sha
// resolver, and the release-ref enumeration. All of those now exist here once.
//
// ⛔ What this module deliberately does NOT do: fold "could not look" into a value. Every helper
// whose outcome can be NOT-DETERMINABLE returns `null` — never an empty string / empty array
// standing in for "none there" (hard rule 3b). Callers keep that null distinct from a real value.
// It also keeps the runner's non-throwing shape: a non-zero exit is a RESULT here, not an
// exception, because some callers read it as a value (tags absent, refs empty) and only the caller
// knows which.

import { spawnSync } from 'node:child_process';

/** The outcome of one git invocation: exit status (`-1` when the process never ran) + raw streams. */
export interface Ran {
  status: number;
  stdout: string;
  stderr: string;
}

/** Run `git -C <cwd> <args...>` and capture the outcome without throwing — the caller decides what a
 *  non-zero status MEANS (a value, or an instrument failure). */
export function git(cwd: string, args: string[]): Ran {
  const r = spawnSync('git', ['-C', cwd, ...args], { encoding: 'utf8' });
  return { status: r.status ?? -1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

/** Split captured output into non-empty, whitespace-trimmed lines — the "read a git listing as a
 *  set of names" split. ⛔ NOT the fail-closed `dev-stats-collect.ts` variant (which strips only a
 *  trailing CR and keeps blank lines): that one is a deliberate different semantics, not a copy. */
export function nonEmptyLines(s: string): string[] {
  return s
    .split('\n')
    .map((x) => x.trim())
    .filter((x) => x.length > 0);
}

/** Resolve a full revision expression in `root` and return its sha. `null` = NOT DETERMINABLE
 *  (never an empty stand-in for a value — hard rule 3b). The caller passes the WHOLE expression
 *  (`refs/heads/<b>`, `<rev>^{commit}`, `FETCH_HEAD^{commit}`, …) so the peeling rule stays the
 *  caller's own, exactly as before the extraction. */
export function revParseSha(root: string, revision: string): string | null {
  const r = git(root, ['rev-parse', '--verify', '--quiet', revision]);
  if (r.status !== 0) return null;
  const sha = r.stdout.trim();
  return sha.length > 0 ? sha : null;
}

/**
 * The release-shaped branch namespace — the SAME enumeration AC-271's criterion makes
 * (`for-each-ref refs/heads/release-* refs/heads/release/*`), read by BOTH release-* scripts.
 * `null` = the enumeration could not be PERFORMED (hard rule 3b: "could not look" must not be
 * printed as "none"). Sorted so the two callers agree on order.
 */
export function enumerateReleaseRefs(root: string): string[] | null {
  const r = git(root, [
    'for-each-ref',
    '--format=%(refname:short)',
    'refs/heads/release-*',
    'refs/heads/release/*',
  ]);
  if (r.status !== 0) return null;
  return nonEmptyLines(r.stdout).sort();
}
