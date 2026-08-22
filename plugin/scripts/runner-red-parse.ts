// runner-red-parse.ts — the red/failure PARSING family, extracted from full-suite-runner.ts
// (gap-ac128-hub-split-harness-concerns).
//
// WHY A SEPARATE FILE: full-suite-runner.ts is a HUB file (any change forces the full suite). The
// red/failure parsing family (FAILURE_PATTERNS / GATE_SCAN_FAILURE_LINES / gateScanCause /
// isFailureLine / buildStaticCheckFailures) is HARNESS-CRITICAL — it decides whether the suite went
// red — so this file is ALSO a hub (listed in suite-bucket-hub-list.ts HUB_FILES). Extracting it out
// of the monolith shrinks that monolith WITHOUT weakening the hub rule (a change here still forces
// the full suite, which is correct: red parsing must be fully verified).
//
// Moved verbatim from full-suite-runner.ts: FAILURE_PATTERNS (the AC2 failure markers),
// GATE_SCAN_FAILURE_LINES + gateScanCause (the gate/scan failure identity),
// buildStaticCheckFailures (the static-check SuiteFailure[] shape), isFailureLine (the AC2 matcher).
// Re-exported from full-suite-runner.ts so its public API surface is unchanged.

import { TMUX_LEAK_FAIL_RE } from "./tmux-leak-fail-re.ts";
import type { SuiteFailure, StaticCheckViolation, FailClosedChecker } from "./full-suite-runner.ts";

// AC2 — failure markers that flip state to red the MOMENT they appear on the suite's
// stdout/stderr stream, never waiting for the run to finish. These are STRUCTURED
// failure shapes, NOT bare glyphs (gap-full-suite-runner-red-pattern-matches-bare-x-
// vitest-false-red, AC1): a bare `✖` in a vitest suite can be the test's OWN console
// output — archguard TASK-67 proved a PASSING negative-control test logging `✖ Diagram
// test failed` triggered a FALSE early-red while vitest reported 0 failed / exit 0. Under
// a pipe node:test emits TAP, so `not ok` / `# fail 1+` / `# cancelled 1+` cover node:test
// failures (AC2, no regression); vitest failures are covered by their structured lines:
// `❯ <file> (N tests | M failed)` (per-file) and `Test Files <N> failed` (summary).
// FULL-SUITE-EXIT is the repo's own marker. A generic non-zero exit code is the catch-all
// for failures no line matched (applied at exit).
// gap-runner-failure-patterns-miss-info-glyph-and-perfile-failed — this repo's measure-suite
// reporter / node:test SPEC-reporter emit the INFO-GLYPH and per-file forms, NOT the TAP `#`
// forms (round-149 red: state=red reason=failed but failures=[] / redAt=null — the third path of
// the same family 42aad5fe fixed for testsSeen): `ℹ fail N` / `ℹ cancelled N` (same [ #ℹ] dual
// prefix the tallies already accept), `✖ <testname> (Nms)` (spec-reporter per-test failure —
// the trailing (Nms) distinguishes it from bare `✖ ...` console noise, the TASK-67 negative
// control), `__PERFILE__ ... passed=false` (measure-suite-reporter per-file failure — the file
// path rides ON the line so failures[] carries it), and `tmux-leak-scan: FAIL` (the suite-tail
// leak scan's residual report — candidate C: a leak is a REAL residual, independent of test
// failures, and must not be swallowed by a `&&` short-circuit).
const FAILURE_PATTERNS: RegExp[] = [
  /^not ok\b/, // node:test / TAP per-test failure
  /^[#ℹ]\s*fail\s+[1-9]/, // TAP + spec-reporter summary: # fail 1+ / ℹ fail 1+
  /^[#ℹ]\s*cancelled\s+[1-9]/, // TAP + spec-reporter summary: # cancelled 1+ / ℹ cancelled 1+ (cancelled is a failure even when fail 0)
  /^ ?❯\s+\S+\s+\(\d+\s+tests?\s*\|\s*[1-9]\d*\s+failed(?:[^)]*)\)/, // vitest per-file: ❯ <file> (N tests | M failed [| K skipped]) — ^ ? anchored: a REAL spec-reporter line is ` ❯ <file> ...` (one optional leading space, fixture-pinned); a PASSING test whose NAME quotes the `❯ <file> (N tests | M failed)` shape is `✔`-prefixed and must not match — same self-match family as the ^✖ fix (c83ce4be)
  /^Test Files\s+[1-9]\d*\s+failed/, // vitest summary: Test Files <N> failed — ^ anchored: a REAL summary line starts column-0; a PASSING test whose NAME quotes the `Test Files <N> failed` shape is `✔`-prefixed and must not match — same family
  /^FULL-SUITE-EXIT=[^0]/, // the repo's own full-suite exit marker, non-zero — ^ anchored: the REAL marker starts column-0 (test.sh appends it); a PASSING test whose NAME quotes `FULL-SUITE-EXIT=1` is `✔`-prefixed and must not match — same family
  /^✖\s+\S.*\(\d+(?:\.\d+)?ms\)/, // node:test spec-reporter per-test failure: ✖ <testname> (Nms) — ^ anchored: a REAL reporter failure starts the line; a PASSING test whose NAME quotes the `✖ <name> (Nms)` shape (runner-failure-patterns' own e2e names) is `✔`-prefixed and must not match
  /^✖\s+failing tests?/, // node:test spec-reporter failure-block header: `✖ failing tests:` (only emitted when tests failed) — ^ anchored, same reasoning
  /^__PERFILE__\s+duration_ms=.*\s+passed=false\b/, // measure-suite-reporter per-file failure: __PERFILE__ duration_ms=<d> <path> passed=false — ^ anchored + FULL reporter shape (candidate B, gap-runner-perfile-pattern-unnchored-self-match-phantom-red): a REAL reporter line starts column-0 with `__PERFILE__ duration_ms=...`; a PASSING test whose NAME quotes the shape (the runner's own e2e test names) is `✔`-prefixed and must not match — same family as the ^✖ fix (c83ce4be)
  TMUX_LEAK_FAIL_RE, // suite-tail leak scan's residual report (candidate C) — single definition, ^-anchored (rationale in tmux-leak-fail-re.ts)
];
// gap-verification-round-reason-self-contradiction — GATE/SCAN failure lines that flip red while the
// TAP test counters stay fail=0 (they are per-file / residual reports, NOT node:test tallies): a
// measure-suite per-file timeout (`__PERFILE__ ... passed=false`) and the suite-tail leak-scan residual
// (`tmux-leak-scan: FAIL`). These are SUBSET patterns of FAILURE_PATTERNS above — a line matching one
// of these ALSO flips redDetected via isFailureLine (a leak/per-file-timeout IS a real red). The gate
// identity lets the round record name WHICH gate/scan failed (reason='gate-failed' + `gate`) so a red
// round with fail=0 (all tests passed) is never mislabelled reason='failed'.
const GATE_SCAN_FAILURE_LINES: { gate: string; re: RegExp }[] = [
  { gate: "perfile-timeout", re: /^__PERFILE__\s+duration_ms=.*\s+passed=false\b/ },
  { gate: "tmux-leak-scan", re: TMUX_LEAK_FAIL_RE },
];

/** The gate/scan identity of a failure line, or null when the line is not a gate/scan failure. */
export function gateScanCause(line: string): string | null {
  for (const { gate, re } of GATE_SCAN_FAILURE_LINES) if (re.test(line)) return gate;
  return null;
}
/**
 * The SuiteFailure[] for a static-check red (gap-static-check-red-failures-capture-only-task-contract-shape
 * AC1): the VIOLATION detail lines (each carrying the violated file) AND the fail-closed checkers (each
 * carrying the checker name in its raw `line`), all marked `staticCheck: true` so suite-state-trigger's
 * classifyFailure routes them to the shared gate. The TWO facts — which checker failed vs which violation
 * lines appeared — are SEPARATE in the record (AC2): the machine-readable separation lives in
 * staticCheck.failedCheckers (fail-closed) vs staticCheck.details (violation lines); failures[] carries
 * both for the shared-gate dispatch decision.
 *
 * ORDERING (gap-static-check-red-failures0-misattributed, round181/182): the FAIL-CLOSED checkers (the
 * real gate — each exited ≠0) MUST come BEFORE the VIOLATION detail lines. A static-check red usually
 * pairs a NON-blocking checker (e.g. task-contract-check --no-block, exit 0 — prints VIOLATION lines but
 * does NOT gate the round) with the true gate (e.g. direct-to-develop-bypass-check, exit 1). With the
 * VIOLATION lines first, `failures[0]` pointed at the non-blocking checker's line and every diagnostician
 * (manager/outer/inner) triaged the wrong thing (round181/182 both misled on gap-ac37). Putting the
 * fail-closed checkers first makes `failures[0]` the real gate's identity — the checker that actually
 * exited non-zero — so red-window triage reads the blocking cause first.
 */
export function buildStaticCheckFailures(
  details: StaticCheckViolation[],
  failClosed: FailClosedChecker[],
): SuiteFailure[] {
  return [
    ...failClosed.map((c) => ({ line: c.line, staticCheck: true })),
    ...details.map((d) => ({ line: d.line, file: d.file, staticCheck: true })),
  ];
}
/** Does a stream line match any AC2 failure marker? */
export function isFailureLine(line: string): boolean {
  return FAILURE_PATTERNS.some((re) => re.test(line));
}
