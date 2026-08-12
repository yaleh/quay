#!/usr/bin/env node
// full-suite-runner.ts — run the FULL suite as OUTER background async, writing
// .quay/full-suite-state.json with the canonical suite-state shape.
//
// Task: gap-full-suite-belongs-to-outer-background-above-3-min
//   AC1 — result writes `.quay/full-suite-state.json` (well-known location):
//         {state: running|green|red, runner: outer|inner, startedAt, finishedAt,
//          durationMs, laneCount}
//   NOTE (gap-batch-merge-gate-reads-stale-green, 2026-08-08): `finishedAt` is written as EPOCH
//         SECONDS (integer), NOT ISO 8601 — the batch-merge freshness gate's Contract measure is
//         `python3 -c "... int(time.time()-d.get('finishedAt', 0))"`, which needs epoch. `startedAt`
//         stays ISO 8601 (human-readable run-start marker; the freshness gate parses BOTH forms).
//   AC2 — the runner marks state=red the MOMENT a failure line is detected on the
//         suite's stream — NOT after the full run finishes — shrinking the
//         "went red → discovered red" window.
//   AC5 — every run records durationMs (finishedAt - startedAt) = the measurement
//         hook for the threshold rule (suite_duration >= 3 min => outer centralized
//         background; < 3 min => delegate to inner per-task and eliminate "batch").
//   AC6(i) — outer background run while inner keeps dispatching/merging: this script
//         spawns the suite, writes state, and exits; it does not block the outer
//         tick and does not block the inner layer.
//   AC4 — state=red IS the stop-dispatch signal the inner layer reads
//         (fast-mode-loop-tick.md step 3): red => inner stops new dispatch AND holds
//         completed-agent fan-in until the outer re-greens.
//
// Task: gap-full-suite-runner-concurrency-default-and-gate (2026-08-05, ABORT #5)
//   AC1 — the default laneCount is NPROC-DERIVED (max(1, floor(nproc / AMPLIFICATION)),
//         AMPLIFICATION = 1.0 since the AC5 cost-side experiment ran
//         (gap-dod-two-green-runs-and-over90-budget-are-mathematically-incompatible, 2026-08-08:
//         zero cancelled at concurrency 4 AND 8 on the same selected set; nproc is the wall-clock
//         sweet spot) — the SAME derivation as test.sh's AC5, NOT the hardcoded 8. On this box
//         nproc=4 ⇒ 4.
//   AC2 — the --test-concurrency splice is a REPLACE, not an append: any existing
//         --test-concurrency=* (both `=` and space spellings) is stripped from the command
//         before the effective value is spliced, so the spawned process shows EXACTLY ONE
//         --test-concurrency=<effective>. ABORT #5 was `--test-concurrency=8 =8` (two 8s) —
//         the outer's explicit 8 and test.sh's own default 8 coexisted, and last-flag-wins
//         silently reverted to 8 with no criterion catching it.
//   AC3 — the shared resource gate (plugin/scripts/resource-gate.sh --for full-suite) is
//         consulted BEFORE the suite starts; on WAIT the runner does NOT start and leaves the
//         state file untouched (still running/green).
//   AC5 (reason axis) — red states carry a `reason` field: "failed" (a real failure was
//         detected — the stop-dispatch signal) or "aborted" (the run produced NO correctness
//         conclusion — spawn error / early gate-WAIT exit; MUST NOT stop dispatch) or
//         "infra-error" (the DIRECT test.sh child was signal-killed — an environment problem;
//         gap-infra-error-false-positive-from-test-internal-kill: only the child's EXIT STATUS
//         classifies this, never a `Killed`/`__ENVFAIL__` marker a test's internal kill prints).
//
// It also tees the suite's stdout+stderr to a log file (default .quay/full-suite.log)
// so the outer's verification gate can grep the 判绿 markers (cancelled 0 /
// FULL-SUITE-EXIT=0 / tests N = reference).
//
// Usage (from the workspace root; the outer starts this with a background subagent /
// run_in_background:true so the tick is not blocked):
//   node --no-warnings --experimental-strip-types plugin/scripts/full-suite-runner.ts \
//     [--command "<test command>"]   # default: bash scripts/test.sh (canonical full suite)
//     [--root <path>]                # the TESTED CHECKOUT (spawn cwd + git HEAD anchor; default repo root)
//     [--state-dir <path>]           # the .quay STATE/LOG directory (gate write location);
//                                    #   default: <root>/.quay (backward compatible single-location)
//                                    #   gap-suite-state-split-across-worktree-and-gate: when --root is
//                                    #   a WORKTREE, pass --state-dir <main-repo>/.quay so the gate
//                                    #   (inner stop conditions + suite-state-trigger, which read ONLY
//                                    #   the main repo's relative .quay/full-suite-state.json) sees the
//                                    #   SAME result — full-suite-state.json, full-suite.log and
//                                    #   verification-round.jsonl all land in <state-dir>.
//     [scope]                        # gap-worktree-scoped-runs-consume-resources-but-produce-no-signal:
//                                    #   every state carries `scope: main|worktree` (which checkout
//                                    #   produced it), and the resource gate is asked with
//                                    #   --main-repo-priority ONLY when --root is the MAIN repo — so the
//                                    #   main-repo full suite (the signal subagents wait for) is not
//                                    #   PERMANENTLY blocked by worktree scoped load (deferrable). A
//                                    #   worktree's own full-suite run gets NO priority (it is itself
//                                    #   deferrable).
//     [--state-file <path>]          # default: <state-dir>/full-suite-state.json
//     [--log-file <path>]            # default: <state-dir>/full-suite.log
//     [--lane-count <n>]             # default: max(1, floor(nproc/1.0)) = nproc (AC1, cost-side-verified)
//     [--serial-concurrency <n>]     # serial-phase internal concurrency, passed to test.sh as
//                                    #   QUAY_SERIAL_CONCURRENCY (default 1 = isolation invariant;
//                                    #   gap-load-sensitive-serial-phase-unbounded-growth-measure-first
//                                    #   AC2/AC3 — measure-first: bump only after an experiment proves
//                                    #   0-cancelled at a higher value)
//     [--lowconc-concurrency <n>]    # lowconc-phase internal concurrency, passed as
//                                    #   QUAY_LOWCONC_CONCURRENCY (default 3, AC4 of
//                                    #   gap-lowconc-group-concurrency-3-for-hermetic-load-sensitive)
//     [--sync]                       # wait for the suite to finish before exiting
//
// Concurrency knob FORK (gap-full-suite-runner-red-pattern-matches-bare-x-vitest-false-red AC3):
// the --lane-count splice only applies to node:test/test.sh projects (--test-concurrency=N).
// For a vitest project pass --command "npx vitest run --maxWorkers=<n>" — vitest's real
// file-level parallel flag is --maxWorkers (archguard ran the full suite with --maxWorkers=8,
// 4902 passed); the runner leaves non-test.sh commands untouched.
//
// Exit: 0 if the suite is green, 1 if red OR the resource gate said WAIT (not started).
// The durable signal the inner reads is the state file, not the exit code.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, execFileSync } from "node:child_process";
import readline from "node:readline";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";

import { runOnce } from "./suite-state-trigger.ts";
import { getLoad1 } from "./checker-cost.ts";
import { scanFamily, kindForFile } from "./known-load-sensitive.ts";
// gap-single-file-test-duration-trend-unwatched AC1/AC2 (fan-in 9edf2cb9, hand-merged into the
// develop→integration convergence 2026-08-09): land the suite's per-file __PERFILE__ duration
// history + compare against the last round (the trend dimension — per-file durations WATCHED round
// over round; see integration's version of this file for the original placement).
import { landMeasureHistory, compareLastTwoRounds } from "./measure-trend-check.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");

export type SuiteStateValue = "running" | "green" | "red";
// gap-full-suite-state-red-no-failure-detail-static-check-invisible AC3 — a FOURTH reason value:
// "static-check" (a run_static_checks checker failed — task-contract / test-framework-policy /
// test-isolation ratchet — NOT a test failure). Consumers (suite-state-trigger's routeRed /
// shouldDispatchOnRed, the inner stop-condition) can distinguish a static-check red from a
// test-failure red: both stop dispatch (static checks ARE the shared gate), but the triage differs
// (static-check red ⇒ fix the contract, not roll back code).
// gap-full-suite-state-red-no-failure-detail-static-check-invisible AC6 — "crashed" (the RUNNER died
// mid-run — SIGKILL / uncaught exception / unhandled rejection — and left NO correctness conclusion
// on disk). Same family as aborted/failed (a terminal red), but distinct: "aborted" = the runner saw
// a signal and deliberately wrote a terminal state; "crashed" = the runner died WITHOUT writing
// (SIGKILL is uncatchable in-process; the terminal state is written by suite-state-trigger's
// crash-watchdog on the next read, or by the runner's own uncaughtException handler for catchable
// crashes). Consumers route it like aborted (no correctness conclusion ⇒ no code-risk stop-dispatch),
// but the reason lets them distinguish "deliberately stopped" from "died silently" and re-launch.
export type SuiteStateReason = "failed" | "aborted" | "infra-error" | "static-check" | "timeout" | "hung" | "crashed";
// gap-verification-round-reason-self-contradiction — the verification-round RECORD's reason axis. The
// suite-STATE's reason (SuiteStateReason) drives routeRed/stop-dispatch and is UNCHANGED (it has no
// fail counter); the ROUND RECORD's reason is recomputed at the COUNTER level so a red round with
// fail=0 (all tests passed) is never labelled reason='failed' — that combination is self-contradictory
// (a reader must dig into failures[] to interpret). "gate-failed" = the red came from a GATE/SCAN
// failure (static-check / perfile-timeout / tmux-leak-scan), carried with a `gate` identity naming
// WHICH gate/scan failed. The lifecycle reasons (infra-error/aborted/timeout/hung/crashed) keep their
// existing values — they are already distinct from "failed" and never claim a test failure.
export type SuiteRoundReason = SuiteStateReason | "gate-failed";

/**
 * One detected suite failure — the FAILURE LOCATION for the red-window dispatch decision
 * (gap-red-window-dispatch-stop-should-be-shared-gate-conditional). `line` is the raw failure
 * line that flipped state to red (the 判定信息 — the runner already knew which test failed);
 * `file` is the best-effort test-file context (from the TAP detail block / vitest per-file line /
 * stack frame) used to classify "shared gate vs specific test" for dispatch.
 */
export interface SuiteFailure {
  line: string;
  file?: string;
  /**
   * The KNOWN-LOAD-SENSITIVE partition (gap-known-load-sensitive-rule-is-doc-only-no-mechanical-
   * triage AC3): true when the failing file is a family member (machine-readable manifest from
   * known-load-sensitive.ts). Written by the runner at red time so the red-window triage can
   * auto-partition WITHOUT re-deriving it — the state carries the partition, not the triaging
   * human/agent's memory.
   */
  in_family?: boolean;
  /** The family kind (wall-clock | nested-spawn | heavy | ...) — one root cause = one kind. */
  kind?: string;
  /**
   * True when this entry is a STATIC-CHECK violation (a run_static_checks checker failed), not a
   * test failure (gap-full-suite-state-red-no-failure-detail-static-check-invisible AC4 — candidate
   * B). suite-state-trigger's classifyFailure reads this marker to classify the failure as a SHARED-
   * GATE failure (static checks pollute every scoped run ⇒ stop dispatch). Absent/undefined on real
   * test failures.
   */
  staticCheck?: boolean;
}

/**
 * One static-check violation captured from the suite stream — the `VIOLATION: <file> — <code>: <what>`
 * lines task-contract-check prints (AC4 candidate B: task + type fill failures[]). `file` is the
 * violated object (repo-relative task file), `code` the violation code/type, `what` the description.
 * Best-effort: a line that does not parse into file/code/what still carries `line` (the raw stream
 * line) so nothing is lost.
 */
export interface StaticCheckViolation {
  file: string;
  code?: string;
  what?: string;
  line: string;
}

/**
 * Machine-readable static-check red detail (gap-full-suite-state-red-no-failure-detail-static-check-
 * invisible AC2): written when the suite went red because a run_static_checks checker failed, NOT a
 * test failure. `violations`/`taskCount` come from task-contract-check's summary line
 * (`violations: N unique across M task(s)`); `ceiling`/`newSinceBaseline` from the ratchet line
 * (`ratchet ceiling: C; new since baseline: K` — K>0 IS the ratchet-growth failure signal, the
 * 20:48Z 真因). `details` are the parsed `VIOLATION:` lines. Consumers read these fields to triage a
 * static-check red (fix the contract) WITHOUT hand-digging the log.
 */
export interface SuiteStateStaticCheck {
  violations: number | null;
  taskCount: number | null;
  ceiling: number | null;
  newSinceBaseline: number | null;
  details: StaticCheckViolation[];
}

export interface SuiteState {
  state: SuiteStateValue;
  /**
   * GENERATION GUARD (gap-full-suite-state-race-last-write-wins-no-generation-guard): a per-run
   * unique id carried by EVERY state write. The first `running` write of a run ESTABLISHES the
   * generation (unconditional); every later write (in-progress red, terminal green/red, signal
   * abort) is checked against the CURRENT on-disk runId — a stale runner whose runId no longer
   * matches is REFUSED, so an older runner's terminal state can never clobber a newer runner's
   * state (the 2026-08-06 06:27 v5 / 06:28 v6 double-launch stale-red-overwrote-running incident).
   * Absent on legacy states (pre-fix) ⇒ a newer run's `running` write overwrites them.
   */
  runId?: string;
  runner: "outer" | "inner";
  /**
   * gap-worktree-scoped-runs-consume-resources-but-produce-no-signal AC1: which checkout produced this
   * state — "main" (the primary repo; the signal subagents wait for) or "worktree" (a linked worktree;
   * deferrable). Waiters reading a worktree's own `.quay/full-suite-state.json` can tell a worktree-
   * origin run from the main-repo suite at a glance, and the resource gate's main-repo-vs-worktree
   * priority rule keys on the same distinction. Absent (legacy states) ⇒ treat as main (fail-open).
   */
  scope?: "main" | "worktree";
  /**
   * gap-systemd-run-limits-for-suite-and-heavy-ops: the suite ran inside a systemd-run --user --scope
   * cgroup scope with these limits (MemoryMax/CPUQuota/TasksMax). Absent on legacy states and on
   * hosts with no systemd user session (the runner falls back with a WARNING — a limit that only
   * works when someone remembers to call it is no limit at all, so the absence is visible). The
   * AC1 cgroup evidence (the `systemctl --user show` attribute dump) is written to
   * `<state-dir>/suite-cgroup-evidence.txt` by the same path.
   */
  systemdRun?: { applied: true; memoryMax: string; cpuQuota: string; tasksMax: string };
  startedAt: string; // ISO 8601
  // gap-batch-merge-gate-reads-stale-green: finishedAt is EPOCH SECONDS (integer) — the batch-merge
  // freshness gate's Contract measure (`int(time.time() - finishedAt)`) needs epoch. null while running.
  finishedAt: number | null; // epoch seconds; null while running
  durationMs: number | null; // finishedAt - startedAt; null while running
  laneCount: number;
  /**
   * Present only on red (AC5 reason axis — gap-full-suite-runner-concurrency-default-and-gate AC5;
   * gap-suite-state-has-no-reason-axis-failed-aborted-infra AC1). Reason enum:
   *   - "failed"     = a real failure was detected (the stop-dispatch signal).
   *   - "aborted"    = the run produced NO correctness conclusion (spawn error / early gate-WAIT
   *                    exit) and MUST NOT trigger stop-dispatch.
   *   - "infra-error" = an environment problem (neither a code failure nor a deliberate abort) —
   *                    ALSO not a code-failure conclusion, so it does NOT stop dispatch on code risk.
   *                    The DIRECT test.sh child being signal-killed maps here (childKilledBySignal);
   *                    a stream `Killed`/`__ENVFAIL__` marker from a test's internal subprocess does
   *                    NOT (gap-infra-error-false-positive-from-test-internal-kill).
   * Legacy red states without `reason` are treated as "failed" (fail-closed toward stopping).
   */
  reason?: SuiteStateReason;
  /**
   * Present on red+failed — the failure line(s) that flipped red, with best-effort file context.
   * This is what the SUITE-RED event carries (failureLocation) so the inner dispatch decision can
   * distinguish a SHARED-GATE failure (run_static_checks — every scoped run pays it ⇒ stop dispatch)
   * from a SPECIFIC-TEST failure unrelated to a candidate's touch-set (⇒ dispatch continues).
   * Absent (legacy red) ⇒ fail-closed toward stopping (the dispatch rule cannot confirm it is an
   * unrelated specific test).
   */
  failures?: SuiteFailure[];
  /**
   * Present on red+static-check (gap-full-suite-state-red-no-failure-detail-static-check-invisible
   * AC2): machine-readable violation counts when the red was caused by a run_static_checks checker
   * (not a test failure). Absent on test-failure red, aborted red, green. `failures[]` ALSO carries
   * the static-check violation details (AC4 candidate B), each marked `staticCheck: true`.
   */
  staticCheck?: SuiteStateStaticCheck;
  /**
   * gap-full-suite-state-red-no-failure-detail-static-check-invisible AC6 — the RUNNER's PID, written
   * on EVERY state (via the `base` object) so a consumer (suite-state-trigger's runOnce crash-watchdog)
   * can tell "the suite is genuinely running" (PID alive ⇒ `process.kill(pid, 0)` does not throw ESRCH)
   * from "the runner died mid-run" (PID dead — SIGKILL, which NO in-process handler can catch). Absent
   * on legacy states ⇒ the watchdog falls back to a stale-AGE threshold before declaring a crash.
   */
  pid?: number;
  /**
   * gap-merge-green-snapshot-verified-commit-livelock AC2 — the commit this run VERIFIED: the
   * integration tip (`git rev-parse HEAD`) in the tested checkout at suite START. The full suite
   * takes ~1847s (~31 min) while integration lands ~12 commits/round (median 147s) — a green that
   * only records `state == green` never catches integration HEAD (COVERAGE fail-closed forever =
   * structural livelock). The batch-merge helper (integration-batch-merge.sh) reads this field and
   * merges THE VERIFIED COMMIT instead of the moving integration HEAD, so COVERAGE is satisfied by
   * construction (the merged point WAS tested). Absent on non-git hermetic test roots and on legacy
   * states (the runner omits the field when it cannot resolve a HEAD).
   */
  verifiedCommit?: string;
}

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
  /^tmux-leak-scan: FAIL/, // suite-tail leak scan's residual report (candidate C) — ^ anchored: a REAL leak-scan residual starts column-0 with `tmux-leak-scan: FAIL`; a PASSING test whose NAME quotes the shape (the runner's own AC5 e2e name, gap-tmux-leak-scan-pattern-unnchored-self-match-phantom-red) is `✔`-prefixed and must not match — same self-match family as the ^✖ fix (c83ce4be) and ^__PERFILE__ (a1b78104)
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
  { gate: "tmux-leak-scan", re: /^tmux-leak-scan: FAIL/ },
];

/** The gate/scan identity of a failure line, or null when the line is not a gate/scan failure. */
export function gateScanCause(line: string): string | null {
  for (const { gate, re } of GATE_SCAN_FAILURE_LINES) if (re.test(line)) return gate;
  return null;
}

// AC5 reason axis (gap-suite-state-has-no-reason-axis-failed-aborted-infra AC1/AC3) — ABORT markers
// that flip state to red + reason=aborted: the suite emitted NO correctness conclusion. The concrete
// shape today is test.sh's INTERNAL resource-gate fail-closed: when the gate says WAIT, test.sh
// prints `resource gate says WAIT — not running the full suite ...` and exits 1 in ~6s WITHOUT
// running a single test. A real failure line (FAILURE_PATTERNS) still wins over an abort marker
// (a failure conclusion is never downgraded); an abort marker is only applied when no failure line
// has been seen. A generic non-zero exit with NEITHER marker stays failed (fail-closed catch-all).
// NOTE — stream-content kill markers (`__ENVFAIL__` / `Killed` / `SIGKILL`) are deliberately NOT in
// this list: a test can kill an INTERNAL subprocess (e.g. resource-gate.test.mjs kills a child to
// test the resource gate) and print `__ENVFAIL__ killed by SIGKILL` while STILL passing — a stream
// marker is not evidence the RUNNER's direct test.sh child was torn down (gap-infra-error-false-
// positive-from-test-internal-kill). Only the direct child's EXIT STATUS (childKilledBySignal,
// below) classifies a signal-kill ⇒ reason=infra-error.
const ABORT_PATTERNS: RegExp[] = [
  /resource gate says WAIT/, // test.sh internal gate fail-closed — the suite never ran tests
  /not running the full suite/, // same gate-WAIT message (both halves of the canonical line)
  /another full suite holds/, // single-flight lock-WAIT (gap-runner-no-kill-on-red-and-no-max-runtime-hang-leak AC4): a PRIOR run's flock blocked this test.sh → 0 test output → NO correctness conclusion → aborted, not failed
  /single-flight lock; waited/, // same lock-WAIT message (both halves of the canonical line)
];

// ── suite child liveness guards (gap-runner-no-kill-on-red-and-no-max-runtime-hang-leak AC2/AC3) ────
// The runner previously waited for test.sh's `close` forever: a hung node --test subprocess (round-164)
// leaked the runner + test.sh 20+ min, holding the single-flight flock (which then lock-blocked the
// next round → misjudged failed instead of aborted). Three bounded guards:
//   - SUITE_MAX_RUNTIME_MS: hard ceiling on the suite child's wall-clock (the real suite is ~15-21 min;
//     45 min is 2-3x — a legitimately-slow suite must never false-trigger). On fire → kill tree + reason=timeout.
//   - SUITE_SILENCE_MS: no stdout/stderr line for this long ⇒ the suite is hung, not working. On fire →
//     kill tree + reason=hung.
//   - RED_GRACE_MS: once redDetected, let the suite collect the failing-tests summary for this long,
//     then kill the tree if it still hasn't exited (a red suite whose test.sh hangs must not leak the flock).
// Env seams keep the runner tests hermetic (QUAY_TEST_SUITE_MAX_RUNTIME_MS / _SILENCE_MS / _RED_GRACE_MS).
export const SUITE_MAX_RUNTIME_MS = Number(process.env.QUAY_TEST_SUITE_MAX_RUNTIME_MS ?? 45 * 60_000);
export const SUITE_SILENCE_MS = Number(process.env.QUAY_TEST_SUITE_SILENCE_MS ?? 15 * 60_000);
export const RED_GRACE_MS = Number(process.env.QUAY_TEST_RED_GRACE_MS ?? 30_000);
// 人 2026-08-12 裁定①（早杀默认关闭）：kill-on-red 让红后 30s 在飞的所有文件记成 `passed=false` 并进
// failures[] —— 失败集被「杀死时刻的在飞集合」污染（外部 SIGTERM/cgroup OOM 同效），造成「每轮浮出
// 不同名单」的假象。缺省跑完完整套件、让所有文件自然结束，才能拿到未被截断的失败集合；早杀仅作
// hung-child 兜底，显式 `QUAY_TEST_KILL_ON_RED=1` 才启用。
export const KILL_ON_RED = process.env.QUAY_TEST_KILL_ON_RED === "1";
// manager 2026-08-10 15:2x — failures[] was structurally capped at 1 (push inside the !redDetected
// guard); now EVERY failure line pushes. Cap the list so a pathological round cannot grow it unbounded.
export const MAX_RECORDED_FAILURES = 200;

// ── static-check red detection (gap-full-suite-state-red-no-failure-detail-static-check-invisible) ──
// When run_static_checks fails (task-contract-check ratchet growth / test-framework-policy /
// test-isolation violations / a ceiling breach), test.sh aborts under `set -e` BEFORE the node --test
// phase, so the suite stream shows the checker's violation output and a non-zero exit — but NONE of
// the FAILURE_PATTERNS (no `not ok`, no `# fail`, no FULL-SUITE-EXIT marker). The runner previously
// classified this as the fail-closed catch-all reason="failed" with failures=[] empty — the 20:48Z
// readability gap (state=red + reason=failed + failures=[] looks like an interrupted run, the real
// cause only in the log). The patterns below separate "the red came from a STATIC CHECK" from
// "the red came from a TEST FAILURE".
//
// FAILURE markers (a PASSING run never emits these — they are the exit-1 signals):
const STATIC_CHECK_FAILURE_PATTERNS: RegExp[] = [
  /new since baseline:\s*[1-9]\d*/, // task-contract ratchet GROWTH (K>0) — the 20:48Z 真因
  /(?:over|exceed(?:s|ed)?) the ratchet ceiling/, // any shrink-only ratchet ceiling breach (test-framework-policy / test-isolation say "over"; task-contract says "exceed")
  /ceiling was RAISED/, // shrink-only ceiling raised (task-framework-policy / test-isolation / task-contract)
  /CEILING BREACH/, // dod-suite-line grandfather-list ceiling breach
  /\bFAIL:\s*\d+\s+(?:ratchet\s+)?violation/, // test-framework-policy (`FAIL: N violation(s):`) / test-isolation (`FAIL: N ratchet violation(s):`)
];
// DETAIL lines (appear on passing runs too — baselined violations are listed; only failure-relevant
// when a FAILURE marker above is present):
const STATIC_CHECK_VIOLATION_RE = /^VIOLATION:\s*(\S+)\s*[—\-]\s*([^:]+):\s*(.*)$/;
const STATIC_CHECK_SUMMARY_RE = /^violations:\s*(\d+)\s+unique across\s*(\d+)\s+task/;
const STATIC_CHECK_RATCHET_RE = /^ratchet ceiling:\s*(\d+);\s*new since baseline:\s*(\d+)/;

/** Does a stream line carry a STATIC-CHECK FAILURE signal (a passing run never emits it)? */
export function isStaticCheckFailureLine(line: string): boolean {
  return STATIC_CHECK_FAILURE_PATTERNS.some((re) => re.test(line));
}

/**
 * Parse ONE static-check detail line (best-effort; returns null when the line is not a static-check
 * detail). The three shapes are task-contract-check's `VIOLATION:` / summary / ratchet lines; each
 * carries a different subset of the machine-readable fields the state needs.
 */
export function extractStaticCheckDetail(line: string): {
  violation?: StaticCheckViolation;
  violations?: number;
  taskCount?: number;
  ceiling?: number;
  newSinceBaseline?: number;
} | null {
  const violationM = STATIC_CHECK_VIOLATION_RE.exec(line);
  if (violationM) {
    return {
      violation: {
        file: violationM[1],
        code: violationM[2].trim(),
        what: violationM[3].trim(),
        line,
      },
    };
  }
  const summaryM = STATIC_CHECK_SUMMARY_RE.exec(line);
  if (summaryM) return { violations: Number(summaryM[1]), taskCount: Number(summaryM[2]) };
  const ratchetM = STATIC_CHECK_RATCHET_RE.exec(line);
  if (ratchetM) return { ceiling: Number(ratchetM[1]), newSinceBaseline: Number(ratchetM[2]) };
  return null;
}

function parseArg(argv: string[], name: string): string | undefined {
  const idx = argv.indexOf(name);
  return idx !== -1 && argv[idx + 1] ? argv[idx + 1] : undefined;
}

// gap-batch-merge-gate-reads-stale-green: normalize an ISO 8601 timestamp to EPOCH SECONDS for the
// batch-merge freshness gate's Contract measure (`suite_freshness = int(time.time() - finishedAt)`).
function toEpochSeconds(iso: string): number {
  return Math.floor(Date.parse(iso) / 1000);
}

/**
 * Read the runId (generation token) currently on disk at `file`, or undefined when absent /
 * unparseable (legacy state, missing file, or a concurrent mid-write). A legacy/missing file has
 * no generation to protect, so the caller treats undefined as "no guard active" (fail-open).
 */
export function readStateRunId(file: string): string | undefined {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
    return typeof parsed?.runId === "string" && parsed.runId ? parsed.runId : undefined;
  } catch {
    return undefined;
  }
}

/**
 * GENERATION GUARD — write `state` to `file`, but when `opts.guard` is set the write is REFUSED
 * (silently dropped) if a DIFFERENT run currently owns the file. Without the guard every write was
 * last-write-wins: if two runners overlap briefly (even a superseded runner still finishing its
 * cleanup), the older runner's red terminal state could land AFTER the newer runner's `running`
 * write and silently clobber it — no mechanism could distinguish "is this red from the current
 * round" (gap-full-suite-state-race-last-write-wins-no-generation-guard). Guard semantics:
 *   - the run's INITIAL `running` write is UNGUARDED (opts.establish in run()) — it establishes
 *     the generation; a newer run taking over MUST be able to overwrite an older run's state.
 *   - every later write (in-progress red, terminal green/red, signal abort) is GUARDED — it only
 *     succeeds while the writer is still the current generation.
 *   - a state without runId, or an unreadable/legacy on-disk file, never blocks a write (fail-open).
 */
export function writeStateGuarded(file: string, state: SuiteState): void {
  writeState(file, state, { guard: true });
}

function writeState(file: string, state: SuiteState, opts?: { guard?: boolean }): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (opts?.guard && state.runId) {
    const current = readStateRunId(file);
    if (current !== undefined && current !== state.runId) {
      // A NEWER run owns the file — this writer is stale; its write would clobber the current
      // round's state. Drop it (the current runner's state stays authoritative).
      return;
    }
  }
  fs.writeFileSync(file, JSON.stringify(state, null, 2) + "\n", "utf8");
}

// ── AC6: append-only suite-duration sequence (gap-no-criterion-records-its-own-cost) ──────────────────
// `.quay/full-suite-state.json` is a SINGLE-STATE file overwritten every round — the previous
// round's durationMs is destroyed. The fix (same shape as the checker-cost ledger): append one line
// {round, startedAt, durationMs, laneCount, pass, fail, load} to `.quay/verification-round.jsonl`
// per run, NEVER overwriting the single-state file. After dozens of rounds the queryable sequence
// survives, so "what did the suite cost last hour" is answerable without hand-digging panes/commits.
//
// load = /proc/loadavg 1min field — the attribution-correction dimension (a same-n round that cost
// more is distinguishable as machine-busy rather than n-growth). Best-effort: a ledger write must
// never fail the run (mirrors checker-cost.sh's fail-open).

/** /proc/loadavg 1min load, or 0 if unreadable (best-effort). */
export function readLoadAvg(): number {
  try {
    const v = Number(String(fs.readFileSync("/proc/loadavg", "utf8")).trim().split(/\s+/)[0]);
    return Number.isFinite(v) ? v : 0;
  } catch {
    return 0;
  }
}

export interface SuiteRoundRecord {
  round: number;
  startedAt: string;
  durationMs: number;
  laneCount: number;
  pass: number;
  fail: number;
  cancelled: number;
  load: number;
  state: string;
  runner: string;
  // gap-worktree-scoped-runs-consume-resources-but-produce-no-signal AC1: main|worktree — which
  // checkout produced this round (the same `scope` the state file carries). Absent on legacy rows.
  scope?: "main" | "worktree";
  // trend-criteria extension (gap-quality-criteria-are-point-in-time-no-trend-criteria AC1/AC3b):
  //   tests       = pass + fail + cancelled (the suite's total test count, so per_test_ms is
  //                 comparable across rounds of different sizes)
  //   per_test_ms = durationMs / tests (the per-test cost — the AC2 trend axis; in milliseconds)
  //   redAt       = ISO time the run first flipped state=red on a REAL failure line (the
  //                 early-RED detection-latency axis, AC3b: redAt − startedAt is how far into
  //                 the run the first failure was reported; the mitigation shrinks the blast
  //                 radius, and a growing latency means the mitigation is degrading)
  // Optional for backward compatibility with earlier appended lines (a reader must tolerate
  // their absence — trend-check.ts derives tests from pass/fail/cancelled when tests is missing).
  tests?: number;
  per_test_ms?: number;
  redAt?: string | null;
  // reason axis (gap-suite-state-has-no-reason-axis-failed-aborted-infra) carried into the
  // sequence so the trend reader can tell a real-failure red from an abort without re-deriving it.
  // gap-verification-round-reason-self-contradiction — the round-record reason is recomputed at the
  // COUNTER level: fail>0 ⇒ 'failed'; fail=0 + a gate/scan/static red ⇒ 'gate-failed' (with a `gate`
  // identity below); the lifecycle reasons (infra-error/aborted/timeout/hung/crashed) keep their
  // existing values. This is NOT always the same value as the suite-state's reason (which has no
  // fail counter and drives routeRed/stop-dispatch — that axis is unchanged).
  reason?: SuiteRoundReason | null;
  /**
   * gap-verification-round-reason-self-contradiction — on a reason='gate-failed' round, WHICH
   * gate/scan failed: 'static-check' (a run_static_checks checker — task-contract /
   * test-framework-policy / test-isolation ratchet), 'perfile-timeout' (a __PERFILE__ ... passed=false
   * measure-suite per-file failure), or 'tmux-leak-scan' (the suite-tail leak-scan residual). Absent
   * on every other round. Carries the gate identity so a reader never has to dig into failures[] to
   * interpret a fail=0 red.
   */
  gate?: string;
  /**
   * gap-merge-green-snapshot-verified-commit-livelock AC2 — the verified commit this round tested
   * (same value as the suite-state's `verifiedCommit`: the integration tip at suite start). Absent
   * on non-git hermetic roots / legacy rows.
   */
  commit?: string;
  /**
   * gap-suite-round-record-missing-failures-field AC2 — the SuiteFailure array on RED rounds (the
   * SAME array the suite-state write carries), so the red-window attribution can reverse-look-up
   * "failed file → task Touches" from the round sequence across rounds — not only the latest
   * full-suite-state.json (single-round coverage). Present on every red round (reason=failed /
   * static-check; an aborted round carries the empty redFailures array — it produced no failure
   * conclusion); absent on green rounds (绿轮可无). Legacy rows lack the field — a reader must
   * tolerate its absence.
   */
  failures?: SuiteFailure[];
  /**
   * gap-verification-round-missing-phase-ms-breaks-cost-attribution AC2 — per-phase cost readings
   * from test.sh's `__OVERHEAD__ <phase>_ms=N` fixed-overhead instrumentation (emitted on the
   * FULL-SUITE default path; `static_phase_ms` ← `run_static_checks_ms`, plus `serial_phase_ms` /
   * `lowconc_phase_ms` / `main_phase_ms`). Only phases that RAN are present: a kill-on-red-
   * truncated round is missing `main_phase_ms` (the kill cut the main phase before its completion
   * marker), so truncated-vs-complete is distinguishable from the record alone — the per_test_ms
   * axis finally has phase context (the 08-09 "700s regression" misjudgment source). Absent on
   * legacy rows and on scoped runs (which skip __OVERHEAD__ emission) — a reader must tolerate
   * their absence.
   */
  static_phase_ms?: number;
  serial_phase_ms?: number;
  lowconc_phase_ms?: number;
  main_phase_ms?: number;
  /**
   * gap-ceiling-floor-ms-not-landed-in-verification-round AC1/AC2 — the group floor + capped-file
   * list from measure-suite-reporter's `__CEILING__ <path> duration_ms=<dur> floor_ms=<floor>
   * 封顶者/该拆` lines (emitted per capped file when the phase's concurrency > 1 — every real
   * phase runs cc>1: serial=2 / lowconc=3 / main=8, so any phase can cap). `floor_ms` is the
   * reporter's GROUP floor (max(sum/concurrency, longest file)) carried verbatim on every
   * __CEILING__ line of that group; the record keeps the DISTINCT floors across all capped groups,
   * first-seen order (serial → lowconc → main) — 各相, no phase's reading overwritten. `ceiling`
   * is the complete 封顶者清单 across all capped phases, in stream order, paths EXACTLY as the
   * reporter emitted them (no drift, no normalization). AC3 — a round with NO __CEILING__ lines
   * omits BOTH fields (never fabricates empty/null), same contract as the *_phase_ms fields above.
   */
  floor_ms?: number[];
  ceiling?: string[];
}

/**
 * Append one suite-round record to <stateDir>/verification-round.jsonl (round = prior lines + 1).
 * `stateDir` is the .quay STATE directory — the state/log/ledger write location, decoupled from the
 * TESTED CHECKOUT by --state-dir (gap-suite-state-split-across-worktree-and-gate). Pre-split callers
 * passed a workspace root; the equivalent stateDir is `<root>/.quay`.
 */
export function appendVerificationRound(stateDir: string, rec: SuiteRoundRecord): void {
  try {
    const file = path.join(stateDir, "verification-round.jsonl");
    fs.mkdirSync(path.dirname(file), { recursive: true });
    let prior = 0;
    if (fs.existsSync(file)) {
      const text = fs.readFileSync(file, "utf8");
      for (const l of text.split("\n")) if (l.trim()) prior++;
    }
    fs.appendFileSync(file, JSON.stringify({ ...rec, round: rec.round > 0 ? rec.round : prior + 1 }) + "\n", "utf8");
  } catch {
    // best-effort — never let the ledger fail the run
  }
}

/** Does a stream line match any AC2 failure marker? */
export function isFailureLine(line: string): boolean {
  return FAILURE_PATTERNS.some((re) => re.test(line));
}

// ── failure-location capture (gap-red-window-dispatch-stop-should-be-shared-gate-conditional) ──────
// The SUITE-RED event must carry WHERE the red landed (state.failures) so the inner dispatch rule can
// distinguish a SHARED-GATE failure (run_static_checks — every scoped run pays it ⇒ stop dispatch)
// from a SPECIFIC-TEST failure unrelated to a candidate's touch-set (⇒ dispatch continues). The
// failure LINE is what flipped red (AC2 already knew which test failed); the best-effort FILE context
// comes from the failure's detail block (node:test TAP `location:`/stack frames, vitest `❯ <file>`).

const FILE_PATH_TOKEN_RE = /[^\s'`",()]+\.(?:(?:test|spec)\.)?(?:mjs|ts|js|tsx|jsx|cjs|mts|sh)\b/g;

/** Normalize a path token from a failure line into a repo-relative file (best-effort). */
export function normalizeFailureFile(raw: string, root: string): string | undefined {
  let p = String(raw).trim().replace(/^file:\/\//, "");
  // strip a trailing `:line:col` suffix (TAP location / stack frames)
  p = p.replace(/:\d+(?::\d+)?$/, "");
  // strip surrounding punctuation the regex may have dragged in
  p = p.replace(/['"`,()\]]+$/, "");
  if (!p) return undefined;
  if (path.isAbsolute(p)) {
    const rel = path.relative(root, p);
    if (!rel.startsWith("..") && !path.isAbsolute(rel)) return rel;
    return undefined; // outside the repo — won't match repo-relative touches, treat as unknown
  }
  return p;
}

/** First file-path token in a stream line, normalized repo-relative (best-effort). */
export function extractFailureFile(line: string, root: string): string | undefined {
  for (const m of line.matchAll(FILE_PATH_TOKEN_RE)) {
    const f = normalizeFailureFile(m[0], root);
    if (f) return f;
  }
  return undefined;
}

/** Does a stream line match an AC5 reason-axis ABORT marker (no correctness conclusion)? */
export function isAbortLine(line: string): boolean {
  return ABORT_PATTERNS.some((re) => re.test(line));
}

// ── AC1/AC2: nproc-derived default laneCount + REPLACE splice ───────────────────────────────────────

/**
 * AC1 — the DEFAULT laneCount is nproc-derived, using the SAME formula as test.sh's AC5
 * derivation: max(1, floor(nproc / AMPLIFICATION)), AMPLIFICATION = 1.0. The 2.1 value (measured
 * process amplification 17/8 ≈ 2.125) was an unproven-conservative guard against oversubscription:
 * the AC5 cost-side experiment (gap-dod-two-green-runs-and-over90-budget-are-mathematically-
 * incompatible, 2026-08-08) ran the same selected set at concurrency 1/4/8 — ZERO cancelled at
 * every level (the CANCELLED dimension that refuted "avoid cancel needs higher concurrency";
 * wall-clock is a SEPARATE axis — see scripts/test.sh header, split per
 * gap-claude-md-nproc-wallclock-claim-scope-correction, NOT "nproc = wall-clock sweet spot").
 * The outer's own full-suite verification rounds at laneCount 8 (13+ runs, all cancelled 0)
 * corroborate that the oversubscription cost side never materialized. RESOURCE_GATE_NPROC /
 * RESOURCE_GATE_AMPLIFICATION are the deterministic test seams (the same env test.sh's
 * default_concurrency_formula reads).
 */
export function defaultLaneCount(): number {
  const ncpuRaw = process.env.RESOURCE_GATE_NPROC ?? String(
    typeof os.availableParallelism === "function" ? os.availableParallelism() : os.cpus().length,
  );
  const ncpu = Number(ncpuRaw);
  const ampRaw = Number(process.env.RESOURCE_GATE_AMPLIFICATION ?? "1.0");
  const amp = Number.isFinite(ampRaw) && ampRaw > 0 ? ampRaw : 1.0;
  return Math.max(1, Math.floor((Number.isFinite(ncpu) && ncpu >= 1 ? ncpu : 1) / amp));
}

/**
 * gap-load-sensitive-serial-phase-unbounded-growth-measure-first AC2/AC3 (measure-first) —
 * the load-sensitive phase concurrency defaults. The serial phase (KNOWN-LOAD-SENSITIVE A/B-class +
 * real-install family) defaults to concurrency 2, RAISED from 1 by the AC2 controlled experiment
 * (2026-08-10: A/B-class serial subset cc=1 WALL_MS=455613 vs cc=2 WALL_MS=289579, both 0-cancelled —
 * c2 快 36%; real-install e2e 双文件 c2 实测 0-cancelled — see task body). The lowconc phase
 * (hermetic-but-load-sensitive session-observation family) defaults to 3 (gap-lowconc-group-
 * concurrency-3-for-hermetic-load-sensitive AC4). Both are overridable via --serial-concurrency /
 * --lowconc-concurrency, which the runner passes to test.sh as QUAY_SERIAL_CONCURRENCY /
 * QUAY_LOWCONC_CONCURRENCY so a FUTURE controlled experiment can re-measure before the next bump.
 */
export const DEFAULT_SERIAL_CONCURRENCY = 6;
export const DEFAULT_LOWCONC_CONCURRENCY = 6;

/** Parse a positive-integer arg (e.g. --serial-concurrency 2); NaN/<1 → null (caller errors). */
function parsePositiveIntArg(argv: string[], name: string): number | null {
  const raw = parseArg(argv, name);
  if (raw === undefined) return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1) return null;
  return n;
}

/**
 * AC2 — strip any existing `--test-concurrency=*` from a command string, both the `=` spelling
 * (`--test-concurrency=8`) and the SPACE spelling (`--test-concurrency 8`). The splice is a
 * REPLACE so the spawned process carries exactly ONE --test-concurrency (the effective value).
 */
export function stripConcurrencyFlags(cmd: string): string {
  let out = cmd.replace(/\s+--test-concurrency=\d+/g, "");
  out = out.replace(/\s+--test-concurrency\s+\d+/g, "");
  return out.trim();
}

/**
 * Whether a command is concurrency-relevant — the default full suite (`bash scripts/test.sh`),
 * or any command that references a test.sh / already carries a --test-concurrency flag. Arbitrary
 * commands (a fake suite in tests, the --fail-fast-check control) are NOT spliced — the runner
 * cannot control their concurrency, and appending a node flag would corrupt them.
 */
export function isConcurrencyRelevantCommand(cmd: string): boolean {
  return /\btest\.sh\b/.test(cmd) || cmd.includes("--test-concurrency");
}

/** Build the spawned command with the effective laneCount spliced as the ONLY --test-concurrency. */
export function spliceConcurrency(cmd: string, laneCount: number): string {
  const stripped = stripConcurrencyFlags(cmd);
  return `${stripped} --test-concurrency=${laneCount}`;
}

// ── AC3: resource-gate consultation before starting ──────────────────────────────────────────────────

/**
 * gap-merge-green-snapshot-verified-commit-livelock AC2 — the TESTED COMMIT: `git rev-parse HEAD` in
 * the tested checkout at suite start. In the main repo this IS the integration tip the green measures
 * (the batch-merge helper merges exactly this commit, not the moving integration HEAD). Not a git
 * checkout (a hermetic test root) ⇒ undefined ⇒ the field is omitted (graceful — the AC1 exact-shape
 * test on a non-git temp root stays byte-stable).
 */
export function readVerifiedCommit(root: string): string | undefined {
  try {
    const out = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
    return /^[0-9a-f]{40,}$/i.test(out) ? out : undefined;
  } catch {
    return undefined;
  }
}

/**
 * gap-worktree-scoped-runs-consume-resources-but-produce-no-signal AC1/AC2 — whether a checkout is a
 * LINKED git worktree (git-dir != git-common-dir). The main repo is NOT a worktree; a temp non-git
 * dir (a hermetic test root) is NOT a worktree. Used to (a) tag the suite state with `scope` so
 * waiters can tell a worktree-origin suite from the main-repo suite (AC1), and (b) pass
 * --main-repo-priority to the resource gate only when the tested checkout is the main repo (AC2).
 */
export function isGitWorktree(root: string): boolean {
  try {
    const gitDir = execFileSync("git", ["rev-parse", "--git-dir"], { cwd: root, encoding: "utf8" }).trim();
    const commonDir = execFileSync("git", ["rev-parse", "--git-common-dir"], { cwd: root, encoding: "utf8" }).trim();
    const abs = (p: string): string => (path.isAbsolute(p) ? p : path.resolve(root, p));
    return abs(gitDir) !== abs(commonDir);
  } catch {
    return false;
  }
}

/**
 * AC3 — consult the shared resource gate BEFORE starting the full suite. WAIT (non-zero exit) ⇒
 * the runner must NOT start; the state file is left untouched (still running/green), and the runner
 * exits non-zero so the caller re-ticks. The gate is the REAL plugin/scripts/resource-gate.sh (its
 * RESOURCE_GATE_TEST_* env seams flow through for deterministic tests). QUAY_TEST_SKIP_RESOURCE_GATE=1
 * is the test escape hatch (same env test.sh honors).
 *
 * AC2 (gap-worktree-scoped-runs-consume-resources-but-produce-no-signal): when the TESTED CHECKOUT is
 * the MAIN repo, pass --main-repo-priority so the gate lets the main-repo full suite proceed even over
 * worktree scoped load (deferrable — its completion updates nothing anyone waits on). When --root is a
 * linked worktree, NO priority flag: a worktree full-suite caller is itself deferrable and must yield
 * to the machine.
 */
export function checkResourceGate(root: string): { ok: boolean; output: string } {
  const gate = path.join(__dirname, "resource-gate.sh");
  const gateArgs = ["--for", "full-suite"];
  if (!isGitWorktree(root)) gateArgs.push("--main-repo-priority");
  try {
    const output = execFileSync("bash", [gate, ...gateArgs], {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { ok: true, output };
  } catch (e) {
    const err = e as { stdout?: string | Buffer; stderr?: string | Buffer; status?: number };
    return {
      ok: false,
      output: `${String(err.stdout ?? "")}${String(err.stderr ?? "")}`,
    };
  }
}

// ── gap-systemd-run-limits-for-suite-and-heavy-ops ──────────────────────────────────────────────────
// The suite + heavy ops run WITHOUT cgroup limits today: a PID explosion (tmux leak, 217 procs) or a
// memory blowout (ugrep 8.8GB regex catastrophe) can take down the WHOLE MACHINE, not just the suite.
// The resource gate (plugin/scripts/resource-gate.sh) is the design-correct, behavior-correct guard —
// and it was bypassed (ABORT #5: 0 calls in this runner; 8-way concurrency in WAIT state, load 31.7).
// "A limit that only works when someone remembers to call it is no limit at all." cgroup limits
// (systemd-run --user --scope) CANNOT be forgotten to call: they are enforced by the kernel for the
// lifetime of the scope, and they bound ONE process group — other projects on the machine are
// untouched (SPEC-isolation-and-resource-governance-2026-08-05.md §2/§4). The runner wraps the
// spawned suite in such a scope (MemoryMax/CPUQuota/TasksMax) when systemd-run is available, and
// records the cgroup attributes as durable evidence (suite-cgroup-evidence.txt) — the AC1 observable.

export interface SystemdRunLimits {
  memoryMax: string; // -p MemoryMax=<v> — "" = no memory limit
  cpuQuota: string; //  -p CPUQuota=<v> — "" = NO CPU limit (人 2026-08-11 裁定「取消 CPU 配额」; 400% 只是当时 4 核机上等价无限制的 measure-first 临时形态, 搬到多核机变成真限制 ⇒ 持久修法 = 不再传 -p CPUQuota=, 见 gap-systemd-run-cancel-cpuquota-keep-memory-guardrail + CLAUDE.md 推论二)
  tasksMax: string; //  -p TasksMax=<v> — "" = NO task limit (人 2026-08-12 裁定③取消 TasksMax=200; 写死的 200 与 CPUQuota 同族, fork: EAGAIN 实证)
}

/** The suite's default cgroup scope limits. cpuQuota/tasksMax 默认空 = 不设 CPU/任务上限（人裁定）; MemoryMax=6G（人 2026-08-12 裁定④给的数值, 04:45 真 cgroup OOM 实证 4G 不足, 宿主当时仍 13G 可用）。 */
export const DEFAULT_SYSTEMD_RUN_LIMITS: SystemdRunLimits = {
  memoryMax: "6G",
  cpuQuota: "",
  tasksMax: "",
};

/**
 * Parse a `MemoryMax=4G CPUQuota=400% TasksMax=200` override string (the QUAY_TEST_SYSTEMD_RUN_LIMITS
 * test seam) into a limits object. Unknown / malformed keys fall back to the defaults (fail-safe —
 * a bad seam value must never produce an unparseable scope property).
 */
export function parseSystemdRunLimits(raw?: string): SystemdRunLimits {
  const limits = { ...DEFAULT_SYSTEMD_RUN_LIMITS };
  if (!raw) return limits;
  for (const part of raw.trim().split(/\s+/)) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    const [key, value] = [part.slice(0, eq), part.slice(eq + 1)];
    if (key === "MemoryMax") limits.memoryMax = value;
    else if (key === "CPUQuota") limits.cpuQuota = value;
    else if (key === "TasksMax") limits.tasksMax = value;
  }
  return limits;
}

let _systemdRunAvailable: boolean | null = null;

/**
 * Whether `systemd-run --user --scope` works on this host (memoized). The probe runs a real no-op
 * scope (`true`) — a transient scope is the ONLY reliable test that the user manager accepts
 * `--scope` + properties (binaries present is not enough; there must be a user session / D-Bus).
 * Seams: QUAY_TEST_SYSTEMD_RUN_AVAILABLE=0|1 forces the answer for hermetic tests.
 */
export function systemdRunAvailable(): boolean {
  if (_systemdRunAvailable !== null) return _systemdRunAvailable;
  const forced = process.env.QUAY_TEST_SYSTEMD_RUN_AVAILABLE;
  if (forced === "0") return (_systemdRunAvailable = false);
  if (forced === "1") return (_systemdRunAvailable = true);
  try {
    execFileSync("systemd-run", ["--user", "--scope", "--quiet", "-p", "TasksMax=100", "true"], {
      stdio: "ignore",
      timeout: 10_000,
    });
    _systemdRunAvailable = true;
  } catch {
    _systemdRunAvailable = false;
  }
  return _systemdRunAvailable;
}

/**
 * Build the argv that wraps `command` in `systemd-run --user --scope` with the limit properties.
 * `--quiet` suppresses systemd's "Running as unit: …" stdout line (it would be teed into the suite
 * log and pollute the failure-pattern matcher). `bash -c <command>` keeps the exact same command
 * string the un-limited path spawns (the --test-concurrency splice etc. are untouched).
 */
export function buildSystemdRunArgv(command: string, limits: SystemdRunLimits = DEFAULT_SYSTEMD_RUN_LIMITS): string[] {
  const argv = [
    "systemd-run",
    "--user",
    "--scope",
    "--quiet",
  ];
  // memoryMax/cpuQuota/tasksMax 为空 ⇒ 不传对应 -p — cgroup 对该维不设限制（人裁定：不设限制就在机制上
  // 不传该参数，字面值只在写它的机器上等价于无限制，CLAUDE.md 推论二）。
  if (limits.memoryMax) argv.push("-p", `MemoryMax=${limits.memoryMax}`);
  if (limits.cpuQuota) argv.push("-p", `CPUQuota=${limits.cpuQuota}`);
  if (limits.tasksMax) argv.push("-p", `TasksMax=${limits.tasksMax}`);
  argv.push("bash", "-c", command);
  return argv;
}

/**
 * Find the transient scope unit a spawned `systemd-run --scope` registered. The unit name is
 * `run-p<pid>-<invocation>.scope` where <pid> is the spawned systemd-run process's pid (verified on
 * this host). Polls `systemctl --user list-units` (the scope appears a moment after spawn); returns
 * the unit name or null after `timeoutMs`.
 */
export async function findSuiteScopeUnit(pid: number, timeoutMs = 8_000): Promise<string | null> {
  const start = Date.now();
  // Preferred: the child's OWN cgroup names its scope directly. systemd transient-scope naming is
  // `run-<uuid>.scope` — the older `run-p<pid>-` form (the heuristic below) NEVER matches on this
  // systemd, so the AC1 evidence was silently never captured and the hermetic cgroup test polled
  // to timeout. /proc/<pid>/cgroup is authoritative regardless of systemd's naming scheme.
  const fromCgroup = (): string | null => {
    try {
      const cg = fs.readFileSync(`/proc/${pid}/cgroup`, "utf8");
      const m = cg.match(/\/(run-[^/\n]+\.scope)\s*$/m);
      if (m) return m[1];
    } catch {
      // transient — retry
    }
    return null;
  };
  const prefix = `run-p${pid}-`;
  while (Date.now() - start < timeoutMs) {
    const cgUnit = fromCgroup();
    if (cgUnit) return cgUnit;
    try {
      const out = execFileSync("systemctl", ["--user", "list-units", "--type=scope", "--no-legend"], {
        encoding: "utf8",
        timeout: 2_000,
        stdio: ["ignore", "pipe", "ignore"],
      });
      for (const line of out.split("\n")) {
        const unit = line.trim().split(/\s+/)[0] ?? "";
        if (unit.startsWith(prefix)) return unit;
      }
    } catch {
      // transient manager unreadiness — retry
    }
    await new Promise((r) => setTimeout(r, 50));
  }
  return null;
}

/**
 * Record the AC1 cgroup evidence for a running suite scope: the scope unit name + the limit
 * properties systemd actually applied (`systemctl --user show <unit>` → MemoryMax/CPUQuotaPerSecUSec/
 * TasksMax/Effective*), written to `<stateDir>/suite-cgroup-evidence.txt`. Best-effort — evidence
 * capture must never fail the run.
 */
export function recordSystemdRunEvidence(stateDir: string, scopeUnit: string, limits: SystemdRunLimits): void {
  try {
    const props = execFileSync("systemctl", ["--user", "show", scopeUnit], {
      encoding: "utf8",
      timeout: 5_000,
      stdio: ["ignore", "pipe", "ignore"],
    });
    const relevant = props
      .split("\n")
      .filter((l) =>
        /^(MemoryMax|EffectiveMemoryMax|CPUQuotaPerSecUSec|TasksMax|EffectiveTasksMax|ControlGroup)=/.test(l),
      )
      .join("\n");
    fs.mkdirSync(stateDir, { recursive: true });
    fs.writeFileSync(
      path.join(stateDir, "suite-cgroup-evidence.txt"),
      [
        `scope_unit=${scopeUnit}`,
        `limits_applied=1 memoryMax=${limits.memoryMax} cpuQuota=${limits.cpuQuota} tasksMax=${limits.tasksMax}`,
        `recorded_at=${new Date().toISOString()}`,
        relevant,
        "",
      ].join("\n"),
      "utf8",
    );
  } catch {
    // best-effort — never let evidence capture fail the run
  }
}

// ── run ─────────────────────────────────────────────────────────────────────────────────────────────

export async function run(argv: string[]): Promise<number> {
  const root = path.resolve(parseArg(argv, "--root") ?? REPO_ROOT);
  const explicitCommand = parseArg(argv, "--command");
  const laneCountArg = parseArg(argv, "--lane-count");
  // AC1 — effective laneCount = explicit --lane-count if given, else the nproc-derived default.
  const laneCount = laneCountArg !== undefined ? Number(laneCountArg) : defaultLaneCount();
  if (!Number.isFinite(laneCount) || laneCount < 1) {
    process.stderr.write(`full-suite-runner: invalid --lane-count '${laneCountArg}' (must be a positive integer)\n`);
    return 1;
  }

  // gap-load-sensitive-serial-phase-unbounded-growth-measure-first AC2/AC3 (measure-first): the
  // load-sensitive phase concurrency overrides. An explicit --serial-concurrency / --lowconc-
  // concurrency is passed to test.sh as QUAY_SERIAL_CONCURRENCY / QUAY_LOWCONC_CONCURRENCY so the
  // controlled experiment can run the serial phase at a higher concurrency and measure wall-clock +
  // cancelled BEFORE the default is bumped. Defaults are DEFAULT_SERIAL_CONCURRENCY=2 (raised from 1
  // by the AC2 experiment — 0-cancelled + 36% faster) /
  // DEFAULT_LOWCONC_CONCURRENCY=3 until an experiment proves 0-cancelled.
  const serialConcurrencyArg = parsePositiveIntArg(argv, "--serial-concurrency");
  const lowconcConcurrencyArg = parsePositiveIntArg(argv, "--lowconc-concurrency");
  if (serialConcurrencyArg === null && parseArg(argv, "--serial-concurrency") !== undefined) {
    process.stderr.write(`full-suite-runner: invalid --serial-concurrency (must be a positive integer)\n`);
    return 1;
  }
  if (lowconcConcurrencyArg === null && parseArg(argv, "--lowconc-concurrency") !== undefined) {
    process.stderr.write(`full-suite-runner: invalid --lowconc-concurrency (must be a positive integer)\n`);
    return 1;
  }
  const serialConcurrency = serialConcurrencyArg ?? DEFAULT_SERIAL_CONCURRENCY;
  const lowconcConcurrency = lowconcConcurrencyArg ?? DEFAULT_LOWCONC_CONCURRENCY;
  // The phase-concurrency env the child test.sh reads. Always set explicitly so the runner is the
  // single source of truth for both phase knobs (test.sh defaults match these values by construction).
  const phaseConcurrencyEnv = {
    QUAY_SERIAL_CONCURRENCY: String(serialConcurrency),
    QUAY_LOWCONC_CONCURRENCY: String(lowconcConcurrency),
  };

  const baseCommand = explicitCommand ?? "bash scripts/test.sh";
  // AC2 — REPLACE splice: strip any existing --test-concurrency (both spellings) and splice the
  // effective laneCount as the ONLY concurrency flag. Arbitrary non-concurrency commands (a fake
  // suite, --fail-fast-check) are left untouched — their concurrency is their own business.
  const command =
    explicitCommand === undefined || isConcurrencyRelevantCommand(baseCommand)
      ? spliceConcurrency(baseCommand, laneCount)
      : baseCommand;

  // gap-suite-state-split-across-worktree-and-gate: the STATE/LOG write location is decoupled from
  // --root (the TESTED CHECKOUT). --state-dir is the .quay state directory the gate reads; when a
  // worktree full-suite run passes `--root <worktree> --state-dir <main-repo>/.quay`, the runner
  // writes full-suite-state.json + full-suite.log + verification-round.jsonl into the MAIN repo, so
  // the inner stop conditions + suite-state-trigger (which read only the main repo's relative
  // .quay/full-suite-state.json) see the SAME result the runner produced. Default <root>/.quay is
  // the historical single-location behavior (fully backward compatible).
  const stateDir = path.resolve(parseArg(argv, "--state-dir") ?? path.join(root, ".quay"));
  const stateFile = path.resolve(parseArg(argv, "--state-file") ?? path.join(stateDir, "full-suite-state.json"));
  const logFile = path.resolve(parseArg(argv, "--log-file") ?? path.join(stateDir, "full-suite.log"));

  // AC3 — the resource gate MUST be consulted BEFORE the suite starts (state=running is written
  // AFTER the gate, so a WAIT leaves the previous state — running/green — untouched). --fail-fast-check
  // / --wait-check are lightweight hermetic controls, not heavy ops — they skip the gate.
  const skipGate =
    process.env.QUAY_TEST_SKIP_RESOURCE_GATE === "1" ||
    argv.includes("--fail-fast-check") ||
    argv.includes("--static-check-check") ||
    argv.includes("--wait-check");
  if (!skipGate) {
    const gate = checkResourceGate(root);
    if (!gate.ok) {
      process.stderr.write(
        `full-suite-runner: resource gate says WAIT — NOT starting (state untouched; re-tick when the gate reports GO)\n${gate.output}\n`
      );
      return 1;
    }
    process.stderr.write("full-suite-runner: resource gate says GO — starting\n");
  }

  const startedAt = new Date().toISOString();
  // gap-worktree-scoped-runs-consume-resources-but-produce-no-signal AC1: tag every state with the
  // producing checkout's scope so waiters can distinguish a worktree-origin suite (deferrable — its
  // completion updates nothing anyone waits on) from the main-repo suite (the signal being waited for).
  const scope = isGitWorktree(root) ? ("worktree" as const) : ("main" as const);
  // gap-merge-green-snapshot-verified-commit-livelock AC2 — record the TESTED COMMIT ONCE at run
  // start (the integration tip the green is about to verify). The batch-merge helper merges THIS
  // commit rather than the moving integration HEAD, so the green's COVERAGE is satisfied by
  // construction (the merged point WAS tested). Non-git hermetic test roots omit the field.
  const verifiedCommit = readVerifiedCommit(root);
  // GENERATION GUARD — this run's unique id, carried by EVERY state write. The initial `running`
  // write establishes it (the newest runner owns the file from then on); every later write must
  // still own the generation or it is dropped (gap-full-suite-state-race-last-write-wins-no-
  // generation-guard AC1/AC4).
  const runId = randomUUID();

  // gap-systemd-run-limits-for-suite-and-heavy-ops — wrap the spawned suite in a systemd-run --user
  // --scope cgroup scope. The limit is kernel-enforced for the scope's lifetime and bounds ONE
  // process group, so a PID/memory blowout inside the suite kills the SUITE's scope, never the
  // machine (SPEC-isolation-and-resource-governance-2026-08-05.md §2: "a limit that only works when
  // someone remembers to call it is no limit at all"). Env seams for hermetic tests:
  //   QUAY_TEST_SKIP_SYSTEMD_RUN=1               — force the un-limited path (hermetic default)
  //   QUAY_TEST_SYSTEMD_RUN_AVAILABLE=0|1        — force the availability probe
  //   QUAY_TEST_SYSTEMD_RUN_LIMITS="…"           — override the limit properties
  const skipSystemdRun =
    process.env.QUAY_TEST_SKIP_SYSTEMD_RUN === "1" ||
    argv.includes("--no-systemd-run") ||
    argv.includes("--fail-fast-check") ||
    argv.includes("--static-check-check") ||
    argv.includes("--wait-check");
  const systemdLimits = parseSystemdRunLimits(process.env.QUAY_TEST_SYSTEMD_RUN_LIMITS);
  const sdAvailable = systemdRunAvailable();
  const useSystemdRun = !skipSystemdRun && sdAvailable;
  if (!skipSystemdRun && !sdAvailable) {
    // Fail-OPEN fallback with a visible warning: no user systemd session ⇒ no cgroup scope is
    // possible; the absence is logged so the "limits can't be forgotten" property is checkable.
    process.stderr.write(
      "full-suite-runner: WARNING systemd-run --user --scope unavailable — running WITHOUT cgroup " +
        "limits (MemoryMax/CPUQuota/TasksMax). The suite is not machine-isolated on this host.\n",
    );
  }
  const base = {
    runner: "outer" as const,
    startedAt,
    laneCount,
    scope,
    runId,
    ...(verifiedCommit ? { verifiedCommit } : {}),
    // AC6 (gap-full-suite-state-red-no-failure-detail-static-check-invisible): every state write
    // carries the RUNNER's PID so suite-state-trigger's runOnce crash-watchdog can distinguish
    // "genuinely running" (PID alive) from "runner died mid-run" (PID dead — SIGKILL is uncatchable
    // in-process, so the terminal crashed state is written by the watchdog, not the dying process).
    pid: process.pid,
    ...(useSystemdRun
      ? { systemdRun: { applied: true as const, memoryMax: systemdLimits.memoryMax, cpuQuota: systemdLimits.cpuQuota, tasksMax: systemdLimits.tasksMax } }
      : {}),
  };

  // KNOWN-LOAD-SENSITIVE family manifest (gap-known-load-sensitive-rule-is-doc-only-no-mechanical-
  // triage AC3): scanned ONCE at run start against the repo root so red-time failures can carry the
  // in-family/kind partition into full-suite-state.json — the triage reads it, never re-derives it.
  const family = scanFamily(REPO_ROOT);
  /** Enrich a failure with its family partition (in_family + kind) — no-op when not a member. */
  const enrichFailure = (f: SuiteFailure): SuiteFailure => {
    if (!f.file) return f;
    const kind = kindForFile(family, f.file);
    if (kind === undefined) return f;
    return { ...f, in_family: true, kind };
  };

  // gap-suite-state-split-across-worktree-and-gate — SYNC BRIDGE: every state transition is written
  // to the gate location (--state-dir, the main repo) AND mirrored to the tested checkout's own
  // `<root>/.quay/full-suite-state.json`. The gate (inner + suite-state-trigger) reads the main repo;
  // the mirror keeps the worktree's own state byte-identical so the two never diverge (the Contract
  // band: cmp -s <worktree-state> <main-repo-state> = same). When --state-dir defaults to <root>/.quay
  // the two paths coincide and the mirror is a no-op (single write, backward compatible).
  const mirrorStateFile = path.resolve(root, ".quay", "full-suite-state.json");
  const writeSuiteState = (state: SuiteState, opts?: { establish?: boolean }): void => {
    // GENERATION GUARD: the initial `running` write is UNGUARDED (establishes the generation); every
    // later write is GUARDED (rejected once a newer run owns the file). Both the gate location and
    // the worktree mirror get the same guard so the two never diverge on staleness.
    const guard = opts?.establish ? undefined : { guard: true };
    writeState(stateFile, state, guard);
    if (mirrorStateFile !== stateFile) writeState(mirrorStateFile, state, guard);
  };

  // AC1 — write `running` the moment the runner starts (inner sees running => proceed).
  // establish: this running write is UNGUARDED — it (re)establishes the generation, so a newer
  // runner can always take over from a stale/legacy state.
  writeSuiteState({ state: "running", ...base, finishedAt: null, durationMs: null }, { establish: true });

  // AC6 (gap-full-suite-state-red-no-failure-detail-static-check-invisible) — in-process crash
  // terminal state: an uncaught exception / unhandled rejection must NOT leave state=running on disk
  // forever (consumers would keep thinking the suite is in flight while the runner is dead). These
  // handlers write a terminal state=red reason=crashed BEFORE exiting. SIGKILL cannot be caught
  // in-process — that path is covered by suite-state-trigger's runOnce crash-watchdog (PID-liveness
  // check, next read). The handlers are removed right after the normal terminal verdict write so a
  // late error in post-verdict teardown can never overwrite the correct green/red with a spurious
  // crashed.
  const writeCrashTerminal = (err: unknown) => {
    const at = new Date().toISOString();
    process.stderr.write(
      `full-suite-runner: uncaught ${err instanceof Error ? err.message : String(err)} -> state=red reason=crashed (runner died mid-run)\n`,
    );
    try {
      writeSuiteState({
        state: "red",
        reason: "crashed",
        ...base,
        finishedAt: toEpochSeconds(at),
        durationMs: Date.parse(at) - Date.parse(startedAt),
      });
    } catch {
      // best-effort — never mask the original crash with a write failure
    }
    process.exit(1);
  };
  process.once("uncaughtException", writeCrashTerminal);
  process.once("unhandledRejection", writeCrashTerminal);
  // Test seam (hermetic, never set in production): throw an uncaught exception shortly after the
  // `running` write so the AC6 in-process crash-terminal path is exercised deterministically (the
  // handler above must write state=red reason=crashed before the process dies).
  if (process.env.QUAY_TEST_CRASH_AFTER_RUNNING === "1") {
    setTimeout(() => {
      throw new Error("QUAY_TEST_CRASH_AFTER_RUNNING");
    }, 30);
  }

  // gap-resource-gate-no-single-flight-lock-two-suite-overlap: the SINGLE-FLIGHT mutual exclusion is
  // enforced inside scripts/test.sh's full-suite default path (`full_suite_lock_acquire` on a flock
  // over <git-common-dir>/full-suite.lock, held for the whole run) — a second concurrent full suite
  // WAITs/queues instead of both-GO. The runner does NOT take its own lock: it spawns test.sh, which
  // serializes the actual node --test workers. This runner's gate check (above) prevents "starting
  // into a busy machine"; the spawned test.sh's flock prevents "a second suite joining".
  // gap-systemd-run-limits-for-suite-and-heavy-ops — spawn the suite inside the cgroup scope when
  // available (otherwise the exact same bash -c <command> as before). systemd-run --scope runs the
  // command synchronously in the foreground and propagates its exit code, so the close-event /
  // signal / exit-code handling below is byte-for-behavior identical.
  let child: import("node:child_process").ChildProcess;
  if (useSystemdRun) {
    const sdArgv = buildSystemdRunArgv(command, systemdLimits);
    process.stderr.write(
      `full-suite-runner: wrapping suite in systemd-run scope (MemoryMax=${systemdLimits.memoryMax} CPUQuota=${systemdLimits.cpuQuota} TasksMax=${systemdLimits.tasksMax})\n`,
    );
    child = spawn(sdArgv[0], sdArgv.slice(1), {
      cwd: root,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, ...phaseConcurrencyEnv },
      // detached: the suite child becomes a process-group leader so killChildTree() can terminate
      // the WHOLE tree (test.sh + its node --test children) — a hung subprocess can't leak the flock.
      detached: true,
    });
    // AC1 evidence — fire-and-forget: find the scope unit and dump its applied cgroup properties to
    // <state-dir>/suite-cgroup-evidence.txt (best-effort; never fails the run).
    const evidenceStateDir = stateDir;
    const evidenceLimits = systemdLimits;
    void (async () => {
      const unit = await findSuiteScopeUnit(child.pid);
      if (unit) recordSystemdRunEvidence(evidenceStateDir, unit, evidenceLimits);
    })();
  } else {
    child = spawn("bash", ["-c", command], {
      cwd: root,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, ...phaseConcurrencyEnv },
      // detached: same as the systemd-run spawn — process-group leader for killChildTree().
      detached: true,
    });
  }

  // AC5 (reason axis) — a signal-kill ⇒ red + reason=aborted (NO correctness conclusion), so the
  // inner's stop-dispatch does NOT fire on an abort. A previously-detected real failure (redDetected)
  // is never downgraded — the failure conclusion stands. abortDetected is the reason-axis marker for
  // an early-EXIT red (gap-suite-state-has-no-reason-axis-failed-aborted-infra): the suite emitted
  // an abort marker (e.g. test.sh's internal resource-gate WAIT) and never reached a correctness
  // conclusion — red + reason=aborted, NOT failed.
  let redDetected = false;
  let abortDetected = false;
  // ── suite-child liveness guards (gap-runner-no-kill-on-red-and-no-max-runtime-hang-leak AC2/AC3) ──
  // timedOut / hung are set by the max-runtime / silence timers below; both force a process-tree kill
  // so a hung suite can never leak the runner + flock. The terminal verdict maps them to reason=timeout
  // / reason=hung (a NO-correctness-conclusion outcome, same class as aborted).
  let timedOut = false;
  let hung = false;
  let lastOutputAt = Date.now();
  let redGraceTimer: NodeJS.Timeout | null = null;
  let redGraceArmed = false;
  const killChildTree = (sig: NodeJS.Signals) => {
    try {
      // Negative pid = the whole process group (detached spawn makes the child a group leader).
      process.kill(-(child.pid), sig);
    } catch { /* group already gone — nothing to kill */ }
    try {
      child.kill(sig);
    } catch { /* child already gone */ }
  };
  const killChildTreeEscalating = () => {
    killChildTree("SIGTERM");
    // Give the tree a bounded chance to exit, then force-kill.
    setTimeout(() => killChildTree("SIGKILL"), 10_000);
  };
  // Max-runtime guard: the suite's wall-clock ceiling. On fire, if the child hasn't exited, kill + mark.
  const maxRuntimeTimer = setTimeout(() => {
    if (runDone) return;
    timedOut = true;
    process.stderr.write(`full-suite-runner: suite exceeded ${Math.round(SUITE_MAX_RUNTIME_MS / 1000)}s max runtime — killing child tree, state=red reason=timeout\n`);
    killChildTreeEscalating();
  }, SUITE_MAX_RUNTIME_MS);
  // Silence guard: no suite output for SUITE_SILENCE_MS ⇒ hung (not working). Reset lastOutputAt in onLine.
  const silenceTimer = setInterval(() => {
    if (runDone) return;
    if (Date.now() - lastOutputAt > SUITE_SILENCE_MS) {
      hung = true;
      process.stderr.write(`full-suite-runner: no suite output for ${Math.round(SUITE_SILENCE_MS / 1000)}s — hung, killing child tree, state=red reason=hung\n`);
      killChildTreeEscalating();
    }
    // Adaptive interval: production (15 min silence) checks every 30s; a test with a tiny seam
    // (e.g. 800ms) needs sub-second checking — never slower than 1s, never faster than 1/2 the threshold.
  }, Math.max(1_000, Math.min(30_000, Math.floor(SUITE_SILENCE_MS / 2))));
  // gap-full-suite-state-red-no-failure-detail-static-check-invisible AC2/AC4 — static-check red
  // accumulation: set when a STATIC_CHECK_FAILURE_PATTERN line appears (a run_static_checks checker
  // failed); the machine-readable counts + violation details are captured from the stream as they
  // come (VIOLATION/summary/ratchet lines). `staticCheckDetected` + `testsSeen === 0` at exit ⇒ the
  // red came from the PRE-TEST static-check phase (test.sh aborts under set -e before running tests),
  // NOT a test failure.
  let staticCheckDetected = false;
  const staticCheckDetails: StaticCheckViolation[] = [];
  let staticCheckViolations: number | null = null;
  let staticCheckTaskCount: number | null = null;
  let staticCheckCeiling: number | null = null;
  let staticCheckNewSinceBaseline: number | null = null;
  let runDone = false;
  // AC3b (gap-quality-criteria-are-point-in-time-no-trend-criteria): the ISO time the FIRST real
  // failure line flipped state to red — carried into the verification-round record so the early-RED
  // detection-latency trend (redAt − startedAt) is queryable without hand-digging logs. Null when
  // the run never went red on a real failure.
  let redAtIso: string | null = null;
  // failure-location capture: the FIRST failure line + its detail-block file context
  // (gap-red-window-dispatch-stop-should-be-shared-gate-conditional).
  const redFailures: SuiteFailure[] = [];
  let pendingFailure: SuiteFailure | null = null;
  let detailRemaining = 0;
  // AC1 (gap-quality-criteria-are-point-in-time-no-trend-criteria) — per-run metric recording.
  // Parsed from the suite's TAP summary (`# tests N`, `# cancelled N`) so the verification-round
  // record carries tests/cancelled/perTestMs — the input of the trend criterion (trend-check.ts).
  let testsSeen = 0;
  let cancelledSeen = 0;
  // testPhaseStarted — TRUE once the suite demonstrably left the pre-test static-check phase.
  // This is the phase gate the `testsSeen === 0` guard was always meant to be. It is set on
  // (a) test.sh's own "selected N files (groups=…)" test-phase-start marker, or (b) a TAP/ℹ
  // test-count summary (`testsSeen > 0`). Why a DEDICATED flag: testsSeen never incremented for
  // this repo's suite because the reporter emits `ℹ tests N` (info glyph) while the parser only
  // accepted `# tests N` — so the old `testsSeen === 0` guard was inert and STATIC_CHECK_FAILURE_
  // PATTERNS fired on TEST-FIXTURE output anywhere in the run (round-6 2026-08-09 false-red:
  // candidate-contracts.test.mjs's ANTI-DRIFT fixtures, static checks clean, 279 files passed).
  let testPhaseStarted = false;
  const onSignal = (sig: string) => {
    if (runDone || redDetected) return;
    const at = new Date().toISOString();
    writeSuiteState({
      state: "red",
      reason: "aborted",
      ...base,
      finishedAt: toEpochSeconds(at),
      durationMs: Date.parse(at) - Date.parse(startedAt),
    });
    process.stderr.write(
      `full-suite-runner: ${sig} received -> state=red reason=aborted (no correctness conclusion)\n`
    );
    process.exit(1);
  };
  process.once("SIGTERM", onSignal);
  process.once("SIGINT", onSignal);

  // Tee the suite output to the log (the outer's verification gate greps it for the
  // 判绿 markers), and flip red the instant a failure line appears (AC2).
  // manager 2026-08-10 15:1x (44% of reds zero-detail + log overwritten each round): archive the
  // PREVIOUS round's log before truncating, so a red's log survives for post-hoc diagnosis (the
  // failures[] list may be empty on the fail-closed path, but the archived log is still queryable).
  if (fs.existsSync(logFile)) {
    const archiveSuffix = new Date().toISOString().replace(/[:.]/g, "-");
    const archivePath = logFile.replace(/full-suite\.log$/, `full-suite-${archiveSuffix}.log`);
    try {
      fs.renameSync(logFile, archivePath);
      process.stderr.write(`full-suite-runner: archived previous round log -> ${archivePath}\n`);
    } catch (e) {
      process.stderr.write(`full-suite-runner: log archive failed (continuing): ${(e as Error).message}\n`);
    }
  }
  const logStream = fs.createWriteStream(logFile, { flags: "w" });

  // AC6 (gap-no-criterion-records-its-own-cost-checker-cost-jsonl) — per-run pass/fail/cancelled
  // tallies from the TAP summary lines (`# pass N` / `# fail N` / `# cancelled N`), carried into the
  // append-only verification-round record so the suite's duration sequence is queryable by pass/fail.
  // gap-verification-round-counter-overwrites-not-sums — these are ACCUMULATORS, not last-write-wins
  // scalars: test.sh's FULL-SUITE default path runs node --test as THREE separate phases (serial →
  // lowconc → main, scripts/test.sh:1107/1127/1142), each emitting its OWN spec/TAP summary block
  // (`ℹ pass N` / `ℹ fail N` / `ℹ cancelled N`). The pre-fix `tapPass = Number(m[1])` overwrote on
  // every block, so `tests` recorded only the LAST phase's counts (~145), never the suite total
  // (~3000) — and a kill-on-red truncation that cut the stream before the final summary left
  // tests=0 while failures[] had real content (round-12, 861s, 16 failures). ACCUMULATING across
  // blocks yields the phase-sum (verified against the real reporter: each node --test process emits
  // exactly one summary block).
  let tapPass = 0;
  let tapFail = 0;
  let tapCancelled = 0;
  // gap-verification-round-reason-self-contradiction — set when a GATE/SCAN failure line (a subset of
  // FAILURE_PATTERNS: __PERFILE__ passed=false / tmux-leak-scan: FAIL) flipped red. Distinct from
  // staticCheckDetected (which names the static-check gate); both feed the round-record reason axis
  // (fail=0 + a gate/scan cause ⇒ reason='gate-failed' + `gate`). null when no gate/scan line fired.
  let redGateCause: string | null = null;
  // gap-suite-red-verdict-carries-empty-failures-payload AC1 — the last stream line seen, kept for
  // the fail-closed catch-all synthesis (a generic non-zero exit with no structured failure line has
  // NO failure to extract from — the last output line is the best-effort file-context source so the
  // synthesized entry still carries a failure location for the red-window dispatch rule).
  let lastStreamLine = "";

  // gap-verification-round-missing-phase-ms-breaks-cost-attribution AC2 — accumulate the
  // `__OVERHEAD__ <phase>_ms=N` phase timings (test.sh's fixed-overhead instrumentation, emitted
  // on the FULL-SUITE default path) as the lines stream through. Keyed by the raw __OVERHEAD__
  // label (`serial_phase`, `lowconc_phase`, `main_phase`, `run_static_checks`); only labels that
  // were actually emitted are present (a truncated kill-on-red round has no main_phase line).
  const phaseMs: Record<string, number> = {};

  // gap-ceiling-floor-ms-not-landed-in-verification-round AC1/AC2/AC3 — accumulate the
  // measure-suite-reporter's `__CEILING__ <path> duration_ms=<dur> floor_ms=<floor> 封顶者/该拆`
  // lines (stream-accumulation family: the __OVERHEAD__ phaseMs above, NOT a post-hoc log re-read).
  // floorMsSeen keeps the DISTINCT group floors across capped groups (each group/phase shares one
  // floor on every __CEILING__ line — serial→lowconc→main run order ⇒ first-seen order = phase
  // order); ceilingFiles keeps every capped path in stream order. Both stay empty until a
  // __CEILING__ line actually fires — a scoped/legacy run with no reporter emits neither, and the
  // record must not fabricate them (AC3).
  const floorMsSeen: number[] = [];
  const ceilingFiles: string[] = [];

  const onLine = (line: string) => {
    logStream.write(line + "\n");
    // Keep the last non-empty stream line for the fail-closed catch-all synthesis (AC1).
    if (line.trim()) lastStreamLine = line;
    // NOTE (# vs ℹ): test.sh's dual-reporter config (scripts/test.sh:204-207) puts node:test's
    // built-in spec reporter on stdout, which emits the info-glyph forms `ℹ pass N` / `ℹ fail N` /
    // `ℹ cancelled N` — NOT the TAP `# pass N` forms — so the old `#`-only regexes never matched
    // and verification-round.jsonl recorded tests/pass/fail=0 for every round (green AND red). Same
    // family as the testsSeen `# tests` fix (42aad5fe); accept both prefixes.
    // gap-verification-round-counter-overwrites-not-sums — ACCUMULATE (+=) instead of overwrite (=):
    // one summary block per node --test phase, and the verification-round `tests` must be the SUM
    // across the phases that actually ran, never just the last phase's block (see the AC6 decl above).
    const passM = line.match(/^[#ℹ]\s*pass\s+(\d+)/);
    if (passM) tapPass += Number(passM[1]);
    const failM = line.match(/^[#ℹ]\s*fail\s+(\d+)/);
    if (failM) tapFail += Number(failM[1]);
    const cancelledM = line.match(/^[#ℹ]\s*cancelled\s+(\d+)/);
    if (cancelledM) tapCancelled += Number(cancelledM[1]);
    // gap-verification-round-missing-phase-ms-breaks-cost-attribution AC2 — the fixed-overhead
    // phase timings (`__OVERHEAD__ <phase>_ms=N`, test.sh:909-918). Same stream-accumulation family
    // as tapPass/tapFail above (NOT a post-hoc log re-read — the logStream buffer may not be
    // flushed at append time, and the stream already carries the identical lines the log gets).
    const overheadM = line.match(/^__OVERHEAD__\s+([A-Za-z0-9_]+)_ms=(\d+)$/);
    if (overheadM) phaseMs[overheadM[1]] = Number(overheadM[2]);
    // gap-ceiling-floor-ms-not-landed-in-verification-round AC1/AC2 — parse the reporter's
    // `__CEILING__ <path> duration_ms=<dur> floor_ms=<floor> 封顶者/该拆` line (^ anchored — the
    // ^__PERFILE__ self-match family: a PASSING test whose NAME quotes the shape is ✔-prefixed and
    // must not match). Non-greedy path capture up to ` duration_ms=` keeps the path verbatim as the
    // reporter emitted it (full path, no normalization — AC2 no-drift contract); floor_ms is the
    // group floor, identical on every __CEILING__ line of that group.
    const ceilingM = line.match(/^__CEILING__\s+(.+?)\s+duration_ms=(\d+(?:\.\d+)?)\s+floor_ms=(\d+(?:\.\d+)?)/);
    if (ceilingM) {
      ceilingFiles.push(ceilingM[1]);
      const floor = Number(ceilingM[3]); // group 2 is duration_ms; group 3 is floor_ms
      if (!floorMsSeen.includes(floor)) floorMsSeen.push(floor);
    }
    // gap-full-suite-state-red-no-failure-detail-static-check-invisible AC2/AC4 — accumulate
    // static-check detail lines on EVERY line (the `VIOLATION:` / summary / ratchet lines appear
    // even on passing runs; they only become failure-relevant when a STATIC_CHECK_FAILURE_PATTERN
    // line fires below). The machine-readable counts are captured here so the state write at red
    // time carries them without re-reading the log.
    const staticDetail = extractStaticCheckDetail(line);
    if (staticDetail) {
      if (staticDetail.violation) staticCheckDetails.push(staticDetail.violation);
      if (staticDetail.violations !== undefined) staticCheckViolations = staticDetail.violations;
      if (staticDetail.taskCount !== undefined) staticCheckTaskCount = staticDetail.taskCount;
      if (staticDetail.ceiling !== undefined) staticCheckCeiling = staticDetail.ceiling;
      if (staticDetail.newSinceBaseline !== undefined) staticCheckNewSinceBaseline = staticDetail.newSinceBaseline;
    }
    // Enrich a pending failure with its file context (TAP detail block / stack frames follow the
    // `not ok` line; the file is NOT on the failure line itself). Best-effort, bounded lookahead.
    if (pendingFailure && detailRemaining > 0) {
      detailRemaining--;
      if (!pendingFailure.file) {
        const f = extractFailureFile(line, root);
        if (f) {
          // Enrich with the KNOWN-LOAD-SENSITIVE partition once the file context resolves, and
          // update the failure in redFailures in place so the state carries it (AC3).
          const enriched = enrichFailure({ ...pendingFailure, file: f });
          pendingFailure.file = f;
          const idx = redFailures.indexOf(pendingFailure);
          if (idx !== -1) redFailures[idx] = enriched;
          // file found — re-write state so the SUITE-RED event carries it (idempotent).
          writeSuiteState({ state: "red", reason: "failed", ...base, finishedAt: null, durationMs: null, failures: redFailures });
        }
      }
      if (detailRemaining <= 0) pendingFailure = null;
    }
    // AC1 — TAP summary parsing: `# tests N` / `# cancelled N` (node:test emits these on the
    // stream regardless of pass/fail). Fires on every line; a later summary overwrites an earlier
    // one (TAP prints exactly one summary, but a failing worker may print its own before the root).
    const testsMatch = /^[#ℹ]\s*tests\s+(\d+)/.exec(line);
    if (testsMatch) testsSeen = Number(testsMatch[1]);
    // test.sh prints "selected N files (groups=…)" exactly when the node --test phase starts; a
    // test-count summary (testsSeen > 0) is the TAP-side proof. Either ⇒ past the static-check
    // phase ⇒ the static-check patterns below must not fire (test fixtures can legitimately print
    // "FAIL: N violation(s)" — candidate-contracts.test.mjs's ANTI-DRIFT hard-fail fixtures).
    if (/^selected \d+ files?\b/.test(line) || testsSeen > 0) testPhaseStarted = true;
    const cancelledMatch = /^[#ℹ]\s*cancelled\s+(\d+)/.exec(line);
    if (cancelledMatch) cancelledSeen = Number(cancelledMatch[1]);
    lastOutputAt = Date.now(); // silence guard: any suite output (even a failure line) proves liveness
    if (isFailureLine(line)) {
      // gap-verification-round-reason-self-contradiction — record the gate/scan identity (if this
      // line is a __PERFILE__ passed=false / tmux-leak-scan: FAIL subset pattern) so the round
      // record can name WHICH gate failed when fail=0. First-wins (a round that hits both keeps the
      // first cause — the round record names one gate).
      if (!redGateCause) redGateCause = gateScanCause(line);
      // manager 2026-08-10 15:2x (failures[] structurally capped at 1): redFailures.push used to sit
      // inside the !redDetected guard, so after the FIRST failure line flipped redDetected=true, every
      // subsequent failure line was skipped — a round's record named only 1 of its N failures (r240
      // TAP fail=7 but failures[] had 1). Red DETECTION still flips once (redDetected, redAtIso, the
      // grace timer, stop-dispatch semantics all unchanged); the push now runs for EVERY failure line,
      // capped to keep a pathological round from unbounded growth.
      if (!redDetected) {
        redDetected = true;
        // AC2 kill-on-red (人 2026-08-12 裁定①：默认 OFF — 早杀把「在飞于杀死时刻」的文件记成 passed=false，
        // 污染失败集；显式 QUAY_TEST_KILL_ON_RED=1 才启用 hung-child 兜底杀)。关闭时红仍即时翻 state=red
        // reason=failed + 记 failures，但套件继续跑到自然结束（未截断的失败集）。
        if (KILL_ON_RED && !redGraceArmed) {
          redGraceArmed = true;
          const rescheduleOrKill = () => {
            if (runDone) return;
            // manager 2026-08-10 15:1x (gap-phase-order-serial-lowconc-before-main × kill-on-red): the
            // red grace timer must only kill a HUNG child (no new output for RED_GRACE_MS), not one that
            // is still producing results. test.sh:956 runs phases EVEN IF a later phase fails ("report
            // all failures" — round-95 AC3); the runner's unconditional kill-on-red cancelled that when a
            // serial/lowconc file reds FIRST, so the main phase (281 files, 89% of the suite) never ran.
            // lastOutputAt is updated on EVERY line (the silence guard), so "still producing" = fresh.
            // If the subtree is still emitting output, reschedule the grace window instead of killing
            // (the run will finish main and land its real red at the terminal write). A truly hung child
            // (no output for RED_GRACE_MS) still escalates the kill — the round-164 flock-leak protection
            // is preserved.
            if (Date.now() - lastOutputAt < RED_GRACE_MS) {
              redGraceTimer = setTimeout(rescheduleOrKill, RED_GRACE_MS);
              return;
            }
            process.stderr.write(`full-suite-runner: red conclusion but suite child is silent for ${Math.round(RED_GRACE_MS / 1000)}s — killing child tree (kill-on-red, AC2)\n`);
            killChildTreeEscalating();
          };
          redGraceTimer = setTimeout(rescheduleOrKill, RED_GRACE_MS);
        }
        // AC3b — timestamp the red flip (the early-RED detection-latency observation point).
        redAtIso = new Date().toISOString();
      }
      // AC2 — mark RED immediately, while the run is still in progress. reason=failed (AC5: this
      // IS a real failure — the stop-dispatch signal). Record the failure LINE (the 判定信息 —
      // which test failed is already known) + open a short detail lookahead for the file context.
      // A file on the failure line itself (vitest `❯ <file>` / `test at <file>`) is captured now;
      // TAP detail-block files are captured by the lookahead.
      const failure: SuiteFailure = enrichFailure({ line, file: extractFailureFile(line, root) });
      if (redFailures.length < MAX_RECORDED_FAILURES) redFailures.push(failure);
      pendingFailure = failure;
      detailRemaining = 15;
      if (!redAtIso) redAtIso = new Date().toISOString();
      writeSuiteState({
        state: "red",
        reason: "failed",
        ...base,
        finishedAt: null,
        durationMs: null,
        failures: redFailures,
      });
      process.stderr.write(
        `full-suite-runner: FAILURE detected on stream -> state=red reason=failed (run still in progress)\n  ${line}\n`
      );
    } else if (!redDetected && !staticCheckDetected && !testPhaseStarted && isStaticCheckFailureLine(line)) {
      // gap-full-suite-state-red-no-failure-detail-static-check-invisible AC2/AC3/AC4 — a STATIC-
      // CHECK failure (run_static_checks aborted the suite before the test phase): write red +
      // reason=static-check EARLY (same early-red property test failures get), with the machine-
      // readable counts + ceiling + violation details already accumulated. A real test failure line
      // is never downgraded (the isFailureLine branch above wins); `testsSeen === 0` guards that
      // this is genuinely the pre-test static-check phase, not test output shaped like a checker.
      staticCheckDetected = true;
      const staticFailures: SuiteFailure[] = staticCheckDetails.map((d) => ({
        line: d.line,
        file: d.file,
        staticCheck: true,
      }));
      writeSuiteState({
        state: "red",
        reason: "static-check",
        ...base,
        finishedAt: null,
        durationMs: null,
        staticCheck: {
          violations: staticCheckViolations,
          taskCount: staticCheckTaskCount,
          ceiling: staticCheckCeiling,
          newSinceBaseline: staticCheckNewSinceBaseline,
          details: staticCheckDetails,
        },
        failures: staticFailures,
      });
      process.stderr.write(
        `full-suite-runner: STATIC-CHECK violation detected on stream -> state=red reason=static-check (run still in progress)\n  ${line}\n`
      );
    } else if (!redDetected && !abortDetected && isAbortLine(line)) {
      // AC5 reason axis (gap-suite-state-has-no-reason-axis-failed-aborted-infra AC1/AC3): an ABORT
      // marker on the stream (e.g. test.sh's internal resource-gate WAIT fail-closed — the suite
      // exited in seconds WITHOUT running tests) means NO correctness conclusion: red + reason=aborted,
      // NOT failed. A real failure line is never downgraded (the `!redDetected` guard). A later real
      // failure line still upgrades to failed (the first branch checks redDetected, not abortDetected).
      abortDetected = true;
      writeSuiteState({ state: "red", reason: "aborted", ...base, finishedAt: null, durationMs: null });
      process.stderr.write(
        `full-suite-runner: ABORT marker detected on stream -> state=red reason=aborted (no correctness conclusion)\n  ${line}\n`
      );
    }
  };

  const outRl = readline.createInterface({ input: child.stdout });
  const errRl = readline.createInterface({ input: child.stderr });
  outRl.on("line", onLine);
  errRl.on("line", onLine);

  let spawnError: Error | null = null;
  child.on("error", (err) => {
    spawnError = err;
    redDetected = true;
    // AC5 (reason axis) — a spawn error means the suite never ran: NO correctness conclusion.
    writeSuiteState({
      state: "red",
      reason: "aborted",
      ...base,
      finishedAt: null,
      durationMs: null,
    });
    process.stderr.write(`full-suite-runner: spawn error -> state=red reason=aborted\n  ${String(err)}\n`);
  });

  const exit: { code: number | null; signal: NodeJS.Signals | null } = await new Promise((resolve) => {
    child.once("close", (code, signal) => resolve({ code, signal }));
  });
  const exitCode = exit.code;

  runDone = true;
  // The suite child closed on its own — the liveness guards are no longer needed; clear them all so a
  // stale timer can't fire after a normal completion (AC2/AC3 — the guards are only for a HUNG child).
  clearTimeout(maxRuntimeTimer);
  clearInterval(silenceTimer);
  if (redGraceTimer) clearTimeout(redGraceTimer);
  // Fan-in race fix (2026-08-05): do NOT remove the signal listeners here. The `if (runDone ||
  // redDetected) return` guard in onSignal already makes a late signal a no-op, so keeping the
  // listeners registered is safe AND closes the unhandled-signal window: previously a SIGTERM
  // landing between this removal and the final state write hit the DEFAULT handler, killing the
  // runner with state=running still on disk (AC5 intermittent failure).

  // Flush the log stream before writing the final verdict.
  await new Promise<void>((resolve) => logStream.end(resolve));

  const finishedAtIso = new Date().toISOString();
  const durationMs = Date.parse(finishedAtIso) - Date.parse(startedAt);
  // gap-batch-merge-gate-reads-stale-green: finishedAt is written as EPOCH SECONDS (the batch-merge
  // freshness gate's Contract measure `int(time.time() - finishedAt)`); durationMs stays computed
  // from the ISO forms (finishedAt - startedAt).
  const finishedAt = toEpochSeconds(finishedAtIso);

  // AC1/判绿 — green ONLY if no failure/abort marker was detected, no spawn error, and the suite
  // exited 0. Red carries the reason axis (AC5, gap-suite-state-has-no-reason-axis-failed-aborted-
  // infra AC1/AC3), extended by gap-infra-error-false-positive-from-test-internal-kill:
  //   - redDetected (a real failure line)      ⇒ reason=failed   (stop-dispatch signal).
  //   - childKilledBySignal (the DIRECT test.sh child was killed by a signal) ⇒ reason=infra-error
  //     (environment problem — the suite was torn down mid-run; NO correctness conclusion, does NOT
  //     stop dispatch). Kill detection is EXIT-STATUS-only: a stream `__ENVFAIL__`/`Killed` marker
  //     from a TEST's internal subprocess kill (e.g. resource-gate.test.mjs kills a child to test
  //     the resource gate and prints `__ENVFAIL__ killed by SIGKILL` while STILL passing) is NOT
  //     evidence the direct test.sh child was torn down, and must not flip the suite (AC1).
  //   - abortDetected (test.sh gate-WAIT / lock-WAIT early exit) or spawnError ⇒ reason=aborted
  //     (NO correctness conclusion — early-EXIT red is an abort, not a failure).
  //   - a generic non-zero exit with NEITHER marker ⇒ reason=failed (fail-closed catch-all: a
  //     failure we could not match a structured line for is still a failure conclusion).
  // AC5 reason-axis (gap-suite-cutoff-what-tears-test-process-at-session-topology, confirmed
  // 2026-08-07): a signal-kill of the DIRECT child is an ENVIRONMENT failure (reason=infra-error),
  // never a code failure — but the runner's child is `bash -c <test.sh>`, and when test.sh's own
  // node --test CHILD is SIGKILL'd (07:08→07:21 suite: `scripts/test.sh: line 576: 720326 Killed
  // node --test`), bash reports it as ITS OWN exit code 128+N (137 for SIGKILL, 143 for SIGTERM),
  // so exit.code !== null AND exit.signal === null while still being a signal-kill. Detect all
  // three shapes:
  //   1. direct signal-kill: node reports code=null + signal=<sig>;           (pre-existing path)
  //   2. the close event carried a signal (exit.signal captured at :539, never classified before);
  //   3. shell 128+N convention (128+1..128+64, the signal range) — the bash-exits-137 case.
  const childKilledBySignal =
    (exitCode === null && spawnError === null) ||
    exit.signal !== null ||
    (exitCode !== null && exitCode > 128 && exitCode <= 192);
  // gap-full-suite-state-red-no-failure-detail-static-check-invisible AC3 — reason precedence at the
  // terminal verdict (extended by gap-infra-error-false-positive-from-test-internal-kill):
  //   0. a FULLY GREEN test result (fail=0, cancelled=0, failures=[]) WINS over infra-error: the
  //      round is state=green (the tests all passed; an infra-error teardown signal after a complete
  //      green result is NOT a red that blocks the batch-merge — manager 2026-08-12, round-18 shape);
  //   1. a REAL test failure (redDetected) ⇒ reason="failed"   (existing behavior, AC5 — never
  //      downgraded by a static-check marker);
  //   2. a STATIC-CHECK failure with NO test run (!testPhaseStarted — test.sh aborted under set -e
  //      before the node --test phase) ⇒ reason="static-check" (AC2/AC3 — distinguishable);
  //   3. the DIRECT test.sh child killed by a signal (childKilledBySignal) with a NON-green test
  //      result (torn down mid-run — no full green TAP summary) ⇒ reason="infra-error" (environment
  //      problem — gap-infra-error-false-positive-from-test-internal-kill AC2);
  //   4. no correctness conclusion (abort marker / spawn error) ⇒ reason="aborted";
  //   5. everything else ⇒ fail-closed "failed" (the pre-existing catch-all).
  // gap-runner-failure-patterns-miss-info-glyph-and-perfile-failed candidate B — AGGREGATE
  // backstop: if no STRUCTURED failure line matched but the [ #ℹ] summary tallies (the SAME
  // tallies AC6 already records, from `ℹ fail N` / `ℹ cancelled N`) recorded fail>0 or
  // cancelled>0, the summary IS the verdict — red + reason=failed + a non-empty failures[].
  // This closes the third family path: a reporter form the FAILURE_PATTERNS didn't catch must
  // still flip red (the tallies and the red verdict become single-source, not two pattern sets).
  if (!redDetected && !staticCheckDetected && (tapFail > 0 || tapCancelled > 0)) {
    redDetected = true;
    redAtIso = redAtIso ?? new Date().toISOString();
    redFailures.push(
      enrichFailure({
        line: `ℹ fail ${tapFail}${tapCancelled > 0 ? `; ℹ cancelled ${tapCancelled}` : ""}`,
        file: undefined,
      }),
    );
  }
  // gap-infra-error-false-positive-from-test-internal-kill (manager analysis 2026-08-12): a round
  // whose TEST RESULT is fully green (fail=0, cancelled=0, failures=[]) — every test that ran passed
  // and none were cancelled — is evidence the TESTS ALL PASSED. An infra-error classification
  // (childKilledBySignal: the direct test.sh child was signal-killed) must then NOT be a red that
  // blocks the batch-merge freshness gate (round-18: pass=3977 fail=0 cancelled=0 failures=[] but
  // state=red reason=infra-error blocked a fully-green round). When the test result IS fully green,
  // the round is GREEN regardless of the teardown signal; infra-error stays a RED only when the run
  // was torn down BEFORE producing a full green result (fail>0 / cancelled>0 / failures non-empty —
  // AC2). `(tapPass > 0 || testsSeen > 0)` guards that tests actually RAN: a suite killed before any
  // TAP summary is NOT "fully green" — it never produced a test result — so a genuine mid-run
  // teardown with no green evidence stays infra-error.
  const testsFullyGreen =
    (tapPass > 0 || testsSeen > 0) && tapFail === 0 && tapCancelled === 0 && redFailures.length === 0;
  const green =
    !redDetected && !staticCheckDetected && !abortDetected && spawnError === null &&
    (exitCode === 0 || (childKilledBySignal && testsFullyGreen));
  // No correctness conclusion (abort) iff: an abort marker was seen, OR the child was killed by a
  // signal (code null), OR it never spawned. A REAL failure conclusion (redDetected) — and now a
  // static-check conclusion (staticCheckDetected) — is never downgraded by an earlier abort marker:
  // both dominate (AC5: the failure conclusion stands). childKilledBySignal is NOT folded into this
  // "aborted" bucket — it gets its own reason=infra-error (the DIRECT child was torn down = an
  // environment problem), so a green suite with only a test-internal `__ENVFAIL__`/`Killed` stream
  // marker stays green (AC1, gap-infra-error-false-positive-from-test-internal-kill).
  const noCorrectnessConclusion =
    !redDetected && !staticCheckDetected && (abortDetected || childKilledBySignal || spawnError !== null);
  const reason: SuiteStateReason = redDetected
    ? "failed"
    : timedOut
      ? "timeout" // max-runtime fired (AC3) — NO correctness conclusion, killed the child tree
      : hung
        ? "hung" // silence guard fired (AC3) — the suite went silent, killed as hung
        : staticCheckDetected && !testPhaseStarted
          ? "static-check"
          : childKilledBySignal
            ? "infra-error" // the DIRECT test.sh child was signal-killed ⇒ environment problem (AC2, gap-infra-error-false-positive-from-test-internal-kill)
            : noCorrectnessConclusion
              ? "aborted"
              : "failed";
  // AC4 candidate B — on a static-check red, failures[] carries the violation details (task + type),
  // each marked staticCheck:true so suite-state-trigger's classifyFailure routes them to the shared
  // gate. On a test-failure red, failures[] carries the real test failures (unchanged, AC5).
  const staticCheckFailures: SuiteFailure[] = staticCheckDetails.map((d) => ({
    line: d.line,
    file: d.file,
    staticCheck: true,
  }));
  let finalFailures: SuiteFailure[] = redDetected ? redFailures : staticCheckDetected ? staticCheckFailures : redFailures;
  // gap-suite-red-verdict-carries-empty-failures-payload AC1 — a red verdict must NEVER carry an
  // EMPTY failures payload. The fail-closed catch-all (a generic non-zero exit with no structured
  // failure line, no TAP tally, no static-check marker — e.g. `exit 3` after some stray output) used
  // to write reason=failed + failures=[]: the SUITE-RED event carries state.failures so the inner
  // dispatch rule can distinguish a SHARED-GATE failure from a SPECIFIC-TEST failure; an empty array
  // gives it no input (fail-closed toward stopping, but the WHERE is lost). Synthesize ONE best-effort
  // entry from the last stream line (the closest thing to a failure location the catch-all saw) so the
  // payload is never empty on a red verdict. Consumers (classifyFailure) route it "unknown" ⇒
  // fail-closed toward stopping — the same dispatch outcome as the empty array, but now with a line
  // recorded for triage.
  if (!green && reason === "failed" && finalFailures.length === 0 && spawnError === null) {
    finalFailures = [
      enrichFailure({
        line: lastStreamLine ? lastStreamLine : `exit code ${exitCode} (no structured failure line)`,
        file: lastStreamLine ? extractFailureFile(lastStreamLine, root) : undefined,
      }),
    ];
  }
  const finalState: SuiteState = green
    ? { state: "green", ...base, finishedAt, durationMs }
    : {
        state: "red",
        reason,
        ...base,
        finishedAt,
        durationMs,
        // carry the failure location(s) — the SUITE-RED event's failureLocation source
        ...(spawnError === null ? { failures: finalFailures } : {}),
        ...(staticCheckDetected
          ? {
              staticCheck: {
                violations: staticCheckViolations,
                taskCount: staticCheckTaskCount,
                ceiling: staticCheckCeiling,
                newSinceBaseline: staticCheckNewSinceBaseline,
                details: staticCheckDetails,
              },
            }
          : {}),
      };
  writeSuiteState(finalState);
  // gap-suite-red-verdict-carries-empty-failures-payload AC3 — the suite log must ALWAYS end with a
  // `# fail N / # pass M` summary line. The observed defect (2026-08-06): full-suite.log ran 9251
  // lines / 792K with 410 fail-words but ZERO `# fail`/`# pass` summary lines, ending mid-assertion
  // (`diff: 'simple'`) — the summary node:test's TAP stream emits was lost when the run was killed /
  // truncated, so the log was not mechanically queryable for a fail count. The runner KNOWS the final
  // tally (tapPass/tapFail/tapCancelled + the verdict), so it appends its own TAP-form summary line(s)
  // to the log after the verdict. Appended directly (the logStream tee is already ended) as TAP
  // summary lines so existing `grep -cE '^# (tests|pass|fail|cancelled)'` consumers find them.
  try {
    const summaryFail = green ? 0 : tapFail > 0 ? tapFail : finalFailures.length;
    const summaryLines = [
      `# tests ${tapPass + tapFail + tapCancelled}`,
      `# pass ${tapPass}`,
      `# fail ${summaryFail}`,
      `# cancelled ${tapCancelled}`,
      `# suite ${green ? "green" : `red ${reason}`}`,
      "",
    ];
    fs.appendFileSync(logFile, summaryLines.join("\n"), "utf8");
  } catch {
    // best-effort — a log-summary append must never fail the run (same fail-open family as the ledger)
  }
  // AC6 (gap-full-suite-state-red-no-failure-detail-static-check-invisible) — the verdict is on disk;
  // a late error in the post-verdict teardown (measure-history, ledger append, final stderr) must not
  // overwrite the correct green/red with a spurious crashed. Remove the crash handlers so any error
  // here reverts to the default crash behavior — the state is already terminal.
  process.removeListener("uncaughtException", writeCrashTerminal);
  process.removeListener("unhandledRejection", writeCrashTerminal);
  // AC6 — append the run to the suite-duration SEQUENCE (never overwrite the single-state file).
  // The full-suite-state.json's durationMs is this run's point value; verification-round.jsonl keeps
  // the history so the sequence survives rounds (gap-no-criterion-records-its-own-cost AC6).
  // AC1 (gap-quality-criteria-are-point-in-time-no-trend-criteria) — extend the sequence record
  // with the suite's total test count and per-test cost so the AC2 trend axis (per_test_ms) is
  // comparable across rounds of different sizes. `tests` = pass+fail+cancelled; per_test_ms =
  // durationMs/tests (0 when no tests ran — a no-test run says nothing about per-test cost).
  const tapTests = tapPass + tapFail + tapCancelled;
  // gap-verification-round-reason-self-contradiction AC1/AC2 — the ROUND RECORD's reason is
  // recomputed at the COUNTER level (the suite-STATE's reason axis — finalState.reason, which drives
  // routeRed/stop-dispatch — is UNCHANGED; it has no fail counter). Precedence:
  //   green                                   ⇒ null (no reason)
  //   fail>0 OR cancelled>0 (a REAL test failure, incl. cancelled tests) ⇒ 'failed' (unchanged)
  //   fail=0 + staticCheckDetected            ⇒ 'gate-failed' + gate='static-check'
  //   fail=0 + redGateCause (perfile/tmux-leak) ⇒ 'gate-failed' + gate=<that gate>
  //   everything else (infra-error / aborted / timeout / hung / the fail-closed catch-all)
  //                                          ⇒ keep finalState.reason (unchanged — these never
  //                                             claim a test failure, so fail=0 is not contradictory)
  // A red round with fail=0 and reason='failed' is self-contradictory (all tests passed, reason says
  // failed) — a reader must dig into failures[] to interpret. fail=0 + gate-failed + a named gate
  // makes it mechanically distinguishable from a test-failure red.
  const roundReason: SuiteRoundReason | null = green
    ? null
    : tapFail > 0 || tapCancelled > 0
      ? "failed"
      : staticCheckDetected || redGateCause
        ? "gate-failed"
        : (finalState.reason ?? null);
  const roundGate: string | null =
    roundReason === "gate-failed" ? (staticCheckDetected ? "static-check" : redGateCause ?? "unknown") : null;
  appendVerificationRound(stateDir, {
    round: 0, // computed from prior line count inside appendVerificationRound
    startedAt,
    durationMs,
    laneCount,
    pass: tapPass,
    fail: tapFail,
    cancelled: tapCancelled,
    tests: tapTests,
    per_test_ms: tapTests > 0 ? Number((durationMs / tapTests).toFixed(3)) : 0,
    redAt: redAtIso,
    load: readLoadAvg(),
    state: finalState.state,
    reason: roundReason,
    ...(roundGate ? { gate: roundGate } : {}),
    runner: base.runner,
    scope,
    // gap-merge-green-snapshot-verified-commit-livelock AC2 — the verified commit this round tested
    // (same value the state carries). Absent on non-git hermetic roots.
    ...(verifiedCommit ? { commit: verifiedCommit } : {}),
    // gap-suite-round-record-missing-failures-field AC2 — a RED round carries the SAME SuiteFailure
    // array the suite-state write carries (finalFailures — the redFailures/staticCheckFailures the
    // state already recorded), so verification-round.jsonl becomes a multi-round-queryable sequence
    // for "failed file → task Touches" attribution. Green rounds omit it (绿轮可无) — all other
    // round-record fields stay byte-identical for non-red rounds.
    ...(finalState.state === "red" ? { failures: finalFailures } : {}),
    // gap-verification-round-missing-phase-ms-breaks-cost-attribution AC2/AC3 — carry the per-phase
    // cost readings (test.sh's `__OVERHEAD__ <phase>_ms` lines, already tee'd to the log). Only a
    // phase that RAN is present: a kill-on-red-truncated round is missing main_phase_ms (the kill
    // cut the main phase before its completion marker), so truncated-vs-complete is distinguishable
    // from the record alone — per_test_ms finally has phase context.
    ...(phaseMs.run_static_checks !== undefined ? { static_phase_ms: phaseMs.run_static_checks } : {}),
    ...(phaseMs.serial_phase !== undefined ? { serial_phase_ms: phaseMs.serial_phase } : {}),
    ...(phaseMs.lowconc_phase !== undefined ? { lowconc_phase_ms: phaseMs.lowconc_phase } : {}),
    ...(phaseMs.main_phase !== undefined ? { main_phase_ms: phaseMs.main_phase } : {}),
    // gap-ceiling-floor-ms-not-landed-in-verification-round AC1/AC3 — the reporter's per-group
    // floors (各相) + capped-file list. Both appear together (every __CEILING__ line carries a
    // floor_ms, so floorMsSeen non-empty ⟺ ceilingFiles non-empty), and BOTH are omitted on a
    // round with no __CEILING__ lines (AC3: no fabricated empty/null — the same absent-field
    // contract the *_phase_ms spreads above follow).
    ...(floorMsSeen.length > 0 ? { floor_ms: floorMsSeen } : {}),
    ...(ceilingFiles.length > 0 ? { ceiling: ceilingFiles } : {}),
  });
  // NOTE: appendVerificationRound above is the ONE suite-duration append per run (the
  // checker-cost.test.mjs AC6 contract: two runs ⇒ exactly two verification-round.jsonl lines).
  // The now-removed appendSuiteDurationRecord call wrote a SECOND record to the SAME file every
  // run — 2 runs produced 4 lines and AC6's "pure append, one per run" assertion failed. The
  // appendVerificationRound record is the canonical shape (state/pass/fail/round); the other
  // function is retained as an exported helper only (no live callers).
  // gap-single-file-test-duration-trend-unwatched AC1/AC2 — land the per-file duration history
  // (the suite's __PERFILE__ lines are already in the log; this only PARSES them — AC3 reuses
  // measure-suite-reporter, no new measurer) and report single-file growth against the last
  // round. Best-effort (same fail-open family as appendVerificationRound): a history/compare
  // failure must never fail the suite verdict. The growth report is a WATCH signal (surfaced to
  // the loop), never a gate — the suite-cost model measured ±17–63 s run-to-run wall noise, so a
  // single observation is informational; the trend becomes a signal over multiple rounds.
  try {
    const historyFile = path.join(stateDir, "measure-history.jsonl");
    const landed = landMeasureHistory({
      historyFile,
      logFile,
      laneCount,
      runAt: finishedAtIso,
      repoRoot: root,
    });
    if (landed.landed) {
      process.stderr.write(
        `full-suite-runner: landed per-file duration history round ${landed.round} (${landed.files} files) -> ${historyFile}\n`
      );
    }
    const growth = compareLastTwoRounds(historyFile);
    for (const g of growth) {
      process.stderr.write(
        `full-suite-runner: measure-trend growth ${g.file} ${g.prevMs} -> ${g.currMs} ms (+${g.growthMs} ms, ${g.ratio.toFixed(2)}x, ${g.reason})\n`
      );
    }
  } catch {
    // best-effort — a measure-history failure never fails the suite verdict
  }
  // gap-suite-leaks-live-claude-sessions — process reclaim does NOT live in the runner: it was
  // removed (2026-08-12, manager 116a770c ruling) because its gate compared `root` against this
  // runner's own REPO_ROOT (self), not against the live-loop checkouts, so a worktree runner with
  // `--root <main-repo>` passed the gate and killed the very sessions driving the loop. Fixture
  // teardown process reclaim is now owned by the limited-path callers: provision-verify-worktree.sh
  // --teardown and integration-batch-merge.sh (both scoped to an explicit worktree path). Never
  // re-add an automatic reclaim here — the negative control must not run in the live suite path.
  process.stderr.write(
    `full-suite-runner: FINAL state=${finalState.state}${finalState.reason ? ` reason=${finalState.reason}` : ""} durationMs=${durationMs} exit=${exitCode}\n`
  );
  return green ? 0 : 1;
}

/**
 * AC6 (gap-no-criterion-records-its-own-cost-checker-cost-jsonl) — append ONE suite-duration row
 * to .quay/verification-round.jsonl on EVERY suite completion (pure append; NEVER overwrites the
 * single-state full-suite-state.json). This closes the "sequence stopped at 05:03" defect: the
 * outer's closure pass could be blocked by a red window and skip its write, but the runner is a
 * separate process that ALWAYS finishes, so the duration history can no longer die mid-sequence.
 * Row shape: {round, startedAt, durationMs, laneCount, pass, fail, load, at, tests?, cancelled?,
 * perTestMs?} — round = last-round+1 (same rule the outer closure pass uses), load = /proc/loadavg
 * 1-min at finish. tests/cancelled/perTestMs are AC1 (gap-quality-criteria-are-point-in-time-no-trend-
 * criteria): the per-run metrics that feed the trend criterion (trend-check.ts).
 */
export function appendSuiteDurationRecord(
  root: string,
  opts: {
    startedAt: string;
    durationMs: number;
    laneCount: number;
    green: boolean;
    tests?: number;
    cancelled?: number;
  },
): void {
  const file = path.resolve(root, ".quay", "verification-round.jsonl");
  let round = 1;
  try {
    if (fs.existsSync(file)) {
      const lines = fs.readFileSync(file, "utf8").split("\n").filter(Boolean);
      for (let i = lines.length - 1; i >= 0; i--) {
        try {
          const r = JSON.parse(lines[i]);
          if (typeof r?.round === "number") {
            round = r.round + 1;
            break;
          }
        } catch {
          // malformed line — keep scanning backwards for the last valid round
        }
      }
    }
  } catch {
    // fail-open: never break the suite verdict on a round-record write
  }
  // AC1 (gap-quality-criteria-are-point-in-time-no-trend-criteria): extend the round record with
  // tests/cancelled/perTestMs — the per-run metrics that make the TREND criterion (trend-check.ts)
  // possible. perTestMs = durationMs / tests (ms per test); omitted when tests is absent/0 so a
  // legacy-format row without counts stays parseable. Optional fields are included only when
  // present — existing readers that assert exact fields (checker-cost.test.mjs AC6) keep passing.
  const perTestMs =
    opts.tests !== undefined && opts.tests > 0 && opts.durationMs > 0
      ? Math.round((opts.durationMs / opts.tests) * 1000) / 1000
      : undefined;
  const rec: Record<string, unknown> = {
    round,
    startedAt: opts.startedAt,
    durationMs: opts.durationMs,
    laneCount: opts.laneCount,
    pass: opts.green ? 1 : 0,
    fail: opts.green ? 0 : 1,
    load: getLoad1(),
    at: new Date().toISOString(),
  };
  if (opts.tests !== undefined) rec.tests = opts.tests;
  if (opts.cancelled !== undefined) rec.cancelled = opts.cancelled;
  if (perTestMs !== undefined) rec.perTestMs = perTestMs;
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.appendFileSync(file, `${JSON.stringify(rec)}\n`, "utf8");
  } catch {
    // fail-open
  }
}

/**
 * --fail-fast-check（gap-red-window-has-no-automatic-executor Contract invoke）：
 * 构造一次失败 suite ⇒ 验证 RED 自动触发链端到端：
 *   runner 写 state=red → suite-state-trigger 的 runOnce 检测到转变 →
 *   记 SUITE-RED 事件 → stopSignal 在位（state=red + reason=failed 即信号，AC1(b)/AC5）。
 * 用临时根（hermetic），不触碰真实 `.quay/full-suite-state.json`。退出 0 = 链验证通过；
 * 退出非 0 = 链某环断裂（触发者坏了，外层据此知道机制失效，而不是红着无人处置）。
 */
async function failFastCheck(): Promise<number> {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "fsr-ffc-"));
  try {
    const fakeCommand = 'echo "not ok 1 - fail-fast-check (RED auto-trigger control)"; exit 1';
    // --fail-fast-check is a lightweight hermetic control (NOT a heavy full-suite op) — it must skip
    // the resource gate (run() checks argv for the marker), so a loaded machine cannot make the
    // Contract self-check flake on a WAIT.
    const code = await run(["--root", tmp, "--command", fakeCommand, "--fail-fast-check"]);
    const { status, events, stopSignal } = runOnce(tmp);
    const redEv = events.find((e) => e.event === "SUITE-RED") ?? null;
    const failures = redEv?.state?.failures ?? redEv?.failureLocation ?? [];
    console.log(
      `fail-fast-check: suite exit=${code} state=${status} reason=${redEv?.state?.reason ?? "?"} stopSignal=${stopSignal} ` +
        `failures=${failures.length} suiteRedEvent=${redEv ? `recorded early=${redEv.early}` : "MISSING"} events=${events.length}`,
    );
    if (code !== 1) {
      console.error("fail-fast-check FAIL: expected the fake suite to exit 1 (red)");
      return 1;
    }
    if (status !== "red") {
      console.error(`fail-fast-check FAIL: expected state=red, got ${status}`);
      return 1;
    }
    if (!stopSignal) {
      console.error("fail-fast-check FAIL: expected stopSignal (state=red + reason=failed IS the stop-dispatch signal)");
      return 1;
    }
    if (!redEv) {
      console.error("fail-fast-check FAIL: expected a SUITE-RED event recorded by suite-state-trigger");
      return 1;
    }
    if (redEv.state?.reason !== "failed") {
      console.error(`fail-fast-check FAIL: expected reason=failed on the red state, got ${redEv.state?.reason}`);
      return 1;
    }
    if (failures.length === 0) {
      console.error(
        "fail-fast-check FAIL: expected the SUITE-RED event to carry the failure location (state.failures / failureLocation) — the red-window dispatch decision needs it",
      );
      return 1;
    }
    console.log("fail-fast-check OK: runner wrote state=red reason=failed → trigger recorded SUITE-RED → stopSignal in place + failureLocation carried");
    return 0;
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

/**
 * --wait-check（gap-full-suite-runner-marks-test-sh-gate-wait-as-failed Contract measure）：
 * 构造一次 test.sh INTERNAL gate-WAIT 场景（WAIT 标记 + exit 1，一行测试都没跑）⇒ 验证 ABORT 链
 * 端到端：
 *   runner 写 state=red reason=aborted → suite-state-trigger 的 runOnce 检测到转变 →
 *   记 SUITE-RED 事件 → stopSignal 缺位（aborted ≠ 代码风险信号，不设 stop-dispatch）。
 * 用临时根（hermetic），不触碰真实 `.quay/full-suite-state.json`。退出 0 = ABORT 链验证通过；
 * 退出非 0 = 链某环断裂（gate-WAIT 假红再现——reason-axis 的残余缺口）。这是 --fail-fast-check
 * （FAILED 链）的 ABORT 侧孪生控制。
 */
async function waitCheck(): Promise<number> {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "fsr-wc-"));
  try {
    // The concrete 17:46Z FALSE-RED shape: test.sh's INTERNAL resource-gate fail-closed prints the
    // WAIT marker to stderr and exits 1 in ~6s WITHOUT running a single test. The runner must classify
    // this as reason=aborted (NO correctness conclusion), never failed — a failed label would stop
    // dispatch on code risk with zero evidence.
    const fakeCommand =
      'echo "scripts/test.sh: resource gate says WAIT — not running the full suite (numbers above). Re-run when the gate reports GO." >&2; exit 1';
    // --wait-check is a lightweight hermetic control (NOT a heavy full-suite op) — it must skip the
    // resource gate (run() checks argv for the marker), so a loaded machine cannot make the Contract
    // self-check flake on a WAIT.
    const code = await run(["--root", tmp, "--command", fakeCommand, "--wait-check"]);
    const { status, events, stopSignal } = runOnce(tmp);
    const redEv = events.find((e) => e.event === "SUITE-RED") ?? null;
    console.log(
      `wait-check: suite exit=${code} state=${status} reason=${redEv?.state?.reason ?? "?"} stopSignal=${stopSignal} ` +
        `suiteRedEvent=${redEv ? `recorded early=${redEv.early}` : "MISSING"} events=${events.length}`,
    );
    if (code !== 1) {
      console.error("wait-check FAIL: expected the fake gate-WAIT suite to exit 1 (red)");
      return 1;
    }
    if (status !== "red") {
      console.error(`wait-check FAIL: expected state=red, got ${status}`);
      return 1;
    }
    if (!redEv) {
      console.error("wait-check FAIL: expected a SUITE-RED event recorded by suite-state-trigger (red still noticed, routed by reason)");
      return 1;
    }
    if (redEv.state?.reason !== "aborted") {
      console.error(
        `wait-check FAIL: expected reason=aborted on the red state (gate-WAIT = NO correctness conclusion), got ${redEv.state?.reason}`,
      );
      return 1;
    }
    if (stopSignal) {
      console.error("wait-check FAIL: expected NO stopSignal (aborted must NOT stop dispatch on code risk)");
      return 1;
    }
    console.log("wait-check OK: runner wrote state=red reason=aborted → trigger recorded SUITE-RED → stopSignal absent (no stop-dispatch)");
    return 0;
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

/**
 * --static-check-check（gap-full-suite-state-red-no-failure-detail-static-check-invisible Contract
 * invoke）：构造一次 STATIC-CHECK 违规 suite ⇒ 验证 STATIC-CHECK 链端到端：
 *   runner 写 state=red reason=static-check + 机器可读字段（violations/ceiling/newSinceBaseline）
 *   + failures[] 填充违规明细（候选 B）→ suite-state-trigger 的 runOnce 检测到转变 →
 *   记 SUITE-RED 事件 → stopSignal 在位（static-check 红是共享闸门失败 ⇒ 停派发）。
 * 用临时根（hermetic），不触碰真实 `.quay/full-suite-state.json`。退出 0 = 链验证通过；
 * 退出非 0 = 链某环断裂（静态检查红仍不可读——本任务要消灭的缺口）。
 */
async function staticCheckCheck(): Promise<number> {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "fsr-scc-"));
  try {
    // The 2026-08-08 20:48Z shape: task-contract-check ratchet violations — test.sh aborts (set -e)
    // BEFORE running tests, so the stream shows the VIOLATION/summary/ratchet lines and a non-zero
    // exit, NO TAP summary, NO FULL-SUITE-EXIT marker. The pre-fix runner labelled this reason=failed
    // with failures=[] empty — the readability gap this task closes.
    const fakeCommand =
      'echo "VIOLATION: tasks/gap-foo.md — V1: Contract block missing invariant line"\n' +
      'echo "VIOLATION: tasks/gap-bar.md — V2: band value out of range"\n' +
      'echo "violations: 11 unique across 9 task(s); info findings (non-ratchet, pre-opt-in baseline): 0 — see --json for details"\n' +
      'echo "ratchet ceiling: 6; new since baseline: 6 (tasks/gap-foo.md: V1, tasks/gap-bar.md: V2); resolved: 0"\n' +
      "exit 1";
    // --static-check-check is a lightweight hermetic control (NOT a heavy full-suite op) — it must
    // skip the resource gate (run() checks argv for the marker), like its fail-fast / wait siblings.
    const code = await run(["--root", tmp, "--command", fakeCommand, "--static-check-check"]);
    const { status, events, stopSignal } = runOnce(tmp);
    const redEv = events.find((e) => e.event === "SUITE-RED") ?? null;
    const s = redEv?.state ?? null;
    console.log(
      `static-check-check: suite exit=${code} state=${status} reason=${s?.reason ?? "?"} stopSignal=${stopSignal} ` +
        `violations=${s?.staticCheck?.violations ?? "?"} ceiling=${s?.staticCheck?.ceiling ?? "?"} ` +
        `newSinceBaseline=${s?.staticCheck?.newSinceBaseline ?? "?"} failures=${s?.failures?.length ?? 0} ` +
        `suiteRedEvent=${redEv ? `recorded early=${redEv.early}` : "MISSING"} events=${events.length}`,
    );
    if (code !== 1) {
      console.error("static-check-check FAIL: expected the fake static-check suite to exit 1 (red)");
      return 1;
    }
    if (status !== "red") {
      console.error(`static-check-check FAIL: expected state=red, got ${status}`);
      return 1;
    }
    if (s?.reason !== "static-check") {
      console.error(`static-check-check FAIL: expected reason=static-check (AC3 — distinguishable from test-failure failed), got ${s?.reason}`);
      return 1;
    }
    if (s?.staticCheck?.violations !== 11) {
      console.error(`static-check-check FAIL: expected staticCheck.violations=11 (AC2 machine-readable count), got ${s?.staticCheck?.violations}`);
      return 1;
    }
    if (s?.staticCheck?.ceiling !== 6) {
      console.error(`static-check-check FAIL: expected staticCheck.ceiling=6 (AC2), got ${s?.staticCheck?.ceiling}`);
      return 1;
    }
    if (s?.staticCheck?.newSinceBaseline !== 6) {
      console.error(`static-check-check FAIL: expected staticCheck.newSinceBaseline=6 (AC2), got ${s?.staticCheck?.newSinceBaseline}`);
      return 1;
    }
    if (!stopSignal) {
      console.error("static-check-check FAIL: expected stopSignal (static-check red IS a shared-gate failure ⇒ stop dispatch)");
      return 1;
    }
    if (!s?.failures || s.failures.length === 0) {
      console.error("static-check-check FAIL: expected failures[] to carry the static-check violation details (AC4 candidate B)");
      return 1;
    }
    if (!redEv) {
      console.error("static-check-check FAIL: expected a SUITE-RED event recorded by suite-state-trigger");
      return 1;
    }
    if (redEv.state?.reason !== "static-check") {
      console.error(`static-check-check FAIL: expected the SUITE-RED event state reason=static-check, got ${redEv.state?.reason}`);
      return 1;
    }
    console.log("static-check-check OK: runner wrote state=red reason=static-check + machine-readable counts → trigger recorded SUITE-RED → stopSignal in place + failures[] carry violation details");
    return 0;
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

const isDirect = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isDirect) {
  const argv = process.argv.slice(2);
  const exitCode = argv.includes("--fail-fast-check")
    ? await failFastCheck()
    : argv.includes("--static-check-check")
      ? await staticCheckCheck()
      : argv.includes("--wait-check")
        ? await waitCheck()
        : await run(argv);
  process.exit(exitCode);
}
