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
// Task: gap-lanes-nproc-concurrent-suites-accounting (2026-08-13)
//   AC1/AC2/AC3 — every verification-round record carries the round's CONCURRENCY VARIABLES so a
//         cross-round comparison can attribute "this round is slower" to machine concurrency rather
//         than to the change being measured: `nproc` (host parallelism, os.availableParallelism() —
//         read-host, never a literal, hard-rule-4 推论二 family), `concurrentSuiteSlots` (the
//         configured QUAY_MAX_CONCURRENT_SUITES, the 2-slot knob ②), `concurrentSuitesRunning` (the
//         ACTUAL number of suites running at the same time as this round = 1 + the slots OTHER suites
//         held at round start, capped at the slot count). After the 2-slot lock, concurrent-suite
//         count is a NEW variable; not recording it makes cross-round comparison impossible.
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
//                                    # gap-verification-round-in-one-shot-worktree: when --root IS the main
//                                    #   repo (root === REPO_ROOT — the outer verification round and the
//                                    #   suite-state-trigger retrigger), the runner AUTO-PROVISIONS a one-shot
//                                    #   worktree (provision-verify-worktree.sh — its first production caller),
//                                    #   runs the suite in it with the state/log in <main>/.quay (config C
//                                    #   NODE_COMPILE_CACHE reuse), and tears it down after. Pass
//                                    #   --one-shot-worktree to force the same for a non-main root; a root
//                                    #   that is ALREADY a worktree (execute-suite-fix --root <wt>) is never
//                                    #   re-provisioned.
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
//                                    #   QUAY_SERIAL_CONCURRENCY (default: host parallelism —
//                                    #   os.availableParallelism(), gap-ac44-concurrent-phases-
//                                    #   read-host-parallelism; explicit flag always wins)
//     [--lowconc-concurrency <n>]    # lowconc-phase internal concurrency, passed as
//                                    #   QUAY_LOWCONC_CONCURRENCY (default: host parallelism — same
//                                    #   host-read source; explicit flag always wins)
//     [--runner <outer|inner>]       # gap-runner-field-hardcoded-outer-not-measurement: the layer
//                                    #   identity this round records (outer/inner). Default: derived
//                                    #   from the SAME source the state path uses (scope —
//                                    #   isGitWorktree(root)): a worktree-scoped run ⇒ "inner", a
//                                    #   main-scoped run ⇒ "outer". Explicit flag always wins
//                                    #   (aligned with pre-verified-round-record.ts --runner).
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

import { runOnce, isRunnerInFlight, type SuiteState as TriggerSuiteState } from "./suite-state-trigger.ts";
// gap-precommit-guard-blocks-commits-not-working-tree-edits — the assertion-surface resolution is the
// PRE-COMMIT GUARD's (the SAME judged-object registry the guard reads; AC51 doc-class files already
// excluded). The runner snapshots that surface to DETECT a mid-round edit to a file the running round
// reads — reuse the single source, never a hand-rolled copy (CLAUDE.md 硬规则 1).
import { resolveAssertionSurface } from "./precommit-guard.ts";
import { getLoad1 } from "./checker-cost.ts";
import { scanFamily, kindForFile } from "./known-load-sensitive.ts";
// gap-leak-residue-per-run-namespace-isolation — the runner-level unified cleanup REUSES the
// owner-liveness criterion (dirHasLiveOwner) already implemented in the session-liveness helpers
// (the 2026-08-08 two-layer-blind invariant: cleanup is PATH-OWNERSHIP + OWNER-LIVENESS based,
// never a name-based batch kill). `sweepRunNamespaces` = pre-suite orphan sweeper over ALL
// /tmp/quay-run-* dirs; `sweepRunNamespace(id)` = post-suite clean of THIS run's own subtree.
// These are RUNTIME fs-only sweepers — they live in plugin/scripts/session-liveness-sweep.mjs
// (a PRODUCTION module, shipped in the npm-pack bundle), NOT the test helper: package.sh excludes
// plugin/test/ from the bundle, so importing from there breaks build-plugin-dist (round 123/124).
import { sweepRunNamespaces, sweepRunNamespace, killRegisteredServers } from "./session-liveness-sweep.mjs";
// gap-single-file-test-duration-trend-unwatched AC1/AC2 (fan-in 9edf2cb9, hand-merged into the
// develop→integration convergence 2026-08-09): land the suite's per-file __PERFILE__ duration
// history + compare against the last round (the trend dimension — per-file durations WATCHED round
// over round; see integration's version of this file for the original placement).
import { landMeasureHistory, compareLastTwoRounds, parsePerFileLines } from "./measure-trend-check.ts";
import type { PerFileRecord } from "./measure-trend-check.ts";
// gap-suite-concurrency-ff-gate-and-slot-ssot — the CANONICAL suite-slot implementation (single
// definition point for "the suite lock slots": suiteLockSlotCount = 旋钮② QUAY_MAX_CONCURRENT_SUITES,
// suiteLockSlotPaths = base.0..S-1, suiteLockBase = env override → git-common-dir). suiteLockPaths /
// countHeldSuiteLocks read it so concurrentSuitesRunning follows S (S=3 ⇒ .0/.1/.2 probed, never a
// fixed two-slot destructure).
import { suiteLockSlotPaths, suiteLockBase } from "./suite-lock-slots.ts";

// ── gap-ac128-hub-split-harness-concerns — harness-critical families extracted to focused files ──
// The red/failure parsing, concurrency/lane, tested-tree state, and state-write families were each
// extracted (verbatim) into a focused HUB file so the two monoliths no longer carry their definitions.
// Imported here for the runner's internal use (run() etc.) and re-exported so the runner's public API
// surface — and every importer (full-suite-runner.test.mjs etc.) — is byte-for-byte unchanged. Each new
// file is a HUB (suite-bucket-hub-list.ts HUB_FILES), so a change to any of them still forces the full
// suite (harness-critical must be fully verified). `writeState` is imported but NOT re-exported (it
// stays module-private to this boundary, same as before the split).
import { gateScanCause, isFailureLine, buildStaticCheckFailures } from "./runner-red-parse.ts";
import { concurrentSuiteSlots, hostParallelism, spliceConcurrency } from "./runner-concurrency.ts";
import { readVerifiedCommit, readTreeState, contentHash, snapshotAssertionSurface } from "./runner-tree-state.ts";
import type { AssertionSurfaceSnapshot } from "./runner-tree-state.ts";
import { writeState, appendVerificationRound } from "./runner-state-write.ts";

export { gateScanCause, isFailureLine, buildStaticCheckFailures } from "./runner-red-parse.ts";
export { concurrentSuiteSlots, hostParallelism, spliceConcurrency, stripConcurrencyFlags } from "./runner-concurrency.ts";
export { readVerifiedCommit, readTreeState, contentHash, snapshotAssertionSurface } from "./runner-tree-state.ts";
export type { TreeState, AssertionSurfaceSnapshot } from "./runner-tree-state.ts";
export { readStateRunId, writeStateGuarded, appendVerificationRound } from "./runner-state-write.ts";


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
  /**
   * gap-streaming-red-cascade-amplifies-failures-array AC1 — "cascade" when this entry is a failure
   * of a KNOWN suite-state-asserting test file (full-suite-runner.test.mjs / laydown-set-check.test.mjs —
   * tests that read the shared `.quay/full-suite-state.json` and assert `state=running with finishedAt
   * null while the suite runs`). When the runner EARLY-REDS (AC2 — the shared state flips to red the
   * moment a load-sensitive test fails), these tests — running LATER in the same suite — read the red
   * state and fail: a CASCADE failure, NOT an independent code failure. Marked + segmented OUT of
   * failures[] (the triage / stop-dispatch / red-rate input) into the `derived` array so an early-red
   * can never amplify failures[] with its own consumers' assertions (round 130: ×3 full-suite-runner +
   * ×1 laydown-set-check amplified the checker-cost flake's failures[] 3×). Absent on real failures.
   */
  derived?: "cascade";
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
  /**
   * gap-static-check-red-failures-capture-only-task-contract-shape AC2 — the FAIL-CLOSED checkers
   * (which checker failed + its exit code), SEPARATED from the `details` VIOLATION lines (which
   * violation lines the stream carried). A checker that fail-closed (checker-cost-lib's
   * `STATIC_CHECK_FAILED: <name> exit=<rc>` — e.g. threshold-scope-check in round 84) has ZERO
   * VIOLATION detail lines to its name; before this field the round record only captured the
   * task-contract VIOLATION shapes and the real cause was invisible. `failures[]` carries BOTH
   * (each marked staticCheck:true); this field is the machine-readable separated 真因.
   */
  failedCheckers?: FailClosedChecker[];
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
  /**
   * gap-runner-field-hardcoded-outer-not-measurement — `runner` 记录本进程被调用时的【层身份】
   * （outer/inner）。修前恒写 "outer"（无 --runner 旗标）⇒ 结构上不可能取假（硬规则 4），不是测量；
   * 修后：显式 --runner 旗标优先，否则从 scope 的同一来源派生（isGitWorktree(root)——worktree 内
   * 跑 ⇒ inner，主检出跑 ⇒ outer），字段可取假。⚠️ 它仍是【层身份】标注，不是【执行形态】——
   * 执行形态取证面是 launch tool_use 的 transcript 文件类别（主会话/agent/workflow 三类），
   * 见 plugin/scripts/suite-execution-form-counter.ts，绝不驱动其 signal。
   */
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
   * gap-verification-round-in-one-shot-worktree — the round ran in a one-shot verify worktree (the
   * tested tree is physically the worktree, NOT the mutable main checkout). `scope` stays "main"
   * (it IS the main verification signal the inner waits for); this field names the ISOLATION the
   * round actually used so a reader can distinguish a main round that ran in an isolated worktree
   * from a deferrable worktree-scoped run. Absent on non-one-shot rounds.
   */
  oneShotWorktree?: boolean;
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
   * gap-verifiedcommit-dirty-tree-false-certificate AC5 — VOIDED-CERTIFICATE marker: true when this
   * round's tests PASSED but its tested tree was MUTATED MID-ROUND (treeMutatedMidRound=true ⇒
   * state=red reason=infra-error instead of green — a FALSE CERTIFICATE, round-121 class). Lets a
   * reader distinguish "voided green" from a real failure without re-deriving it. Absent on every
   * non-voided state.
   */
  void?: boolean;
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
   * gap-streaming-red-cascade-amplifies-failures-array AC1/AC2 — the SEGMENTED-OUT populations of a
   * red round, kept OUT of `failures[]` (the triage / stop-dispatch / red-rate input) so they can
   * never be amplified or mis-attributed:
   *   `derived`      — CASCADE failures (KNOWN suite-state-asserting test files that fail reading the
   *                    early-red shared state — marked `derived: "cascade"`; round-130 ×3+×1 shape).
   *   `unattributed` — failures with NO `file` (round-130 "×3 (no file)" — the population `--partition`
   *                    could only throw into not-in-family). Present only when non-empty (绿轮可无).
   * `failures[]` main set = real, file-attributable, non-cascade failures only — the round-130 three
   * counts (verification-round fail / outer early-read / state terminal) finally agree on it.
   */
  derived?: SuiteFailure[];
  unattributed?: SuiteFailure[];
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
  /**
   * gap-verifiedcommit-dirty-tree-false-certificate AC1/AC2 — the TESTED root's tree state at round
   * START: whether the working tree was DIRTY (git status --porcelain, which INCLUDES untracked `??`
   * entries — ./undefined 等 untracked 不能漏在外面) and the tested-content tree hash (tracked part —
   * `git stash create`'s tree = working-tree tracked content, staged+unstaged; HEAD tree when clean).
   * A dirty round's `verifiedCommit` is a FALSE CERTIFICATE (it declares the commit, but what was
   * tested is the working tree — the round-90/4a3fc0be shape: vc=1a5da8ee while 工作树 ≠ HEAD 树 ≠
   * index 树). The dirty flag is the disclaiming annotation: `treeDirty: true` ⇒ verifiedCommit does
   * NOT declare "已验证". Together `tree` makes "does this later commit reproduce the tested tree" a
   * comparison (`tree === <commit>^{tree}`), not an assumption. Present on git roots (like
   * verifiedCommit); absent on non-git hermetic roots.
   */
  treeDirty?: boolean;
  /**
   * gap-verifiedcommit-dirty-tree-false-certificate AC2 — the TESTED content's tree hash (tracked
   * part) at round start: `git stash create`'s tree (the working tree's tracked content) when the
   * tree is dirty, else `HEAD^{tree}`. Sibling of `treeDirty` (present together on git roots, absent
   * together on non-git hermetic roots). A green round whose `tree` ≠ `verifiedCommit^{tree}` tested
   * a tree that was never committed — its certificate is void.
   */
  tree?: string;
  /**
   * gap-concurrent-write-mutable-tree-false-positive-red — the TESTED CHECKOUT's HEAD at TERMINAL
   * time (same resolution as verifiedCommit — `git rev-parse HEAD` — read AFTER the suite child
   * closes, just before the verdict write). Together with `verifiedCommit` (the START head) it
   * expresses whether the tree was MUTATED MID-ROUND: when the two differ, concurrent writers
   * committed to the shared tree while the suite ran on it — a red in that round is a
   * CONCURRENT-WRITE FALSE-POSITIVE CANDIDATE (round-53 class: 4 writers committed mid-round, the
   * SAME quay-init-loop-core test passed green the next clean window). An ANNOTATION, never itself
   * a red/green criterion (AC1 — 非红判据). Absent on non-git hermetic roots (like verifiedCommit).
   */
  terminalCommit?: string;
  /**
   * gap-concurrent-write-mutable-tree-false-positive-red — true when the tree was MUTATED MID-ROUND
   * (verifiedCommit !== terminalCommit). Consumers attribute any red carrying this flag as a
   * concurrent-write FALSE-POSITIVE CANDIDATE (AC2), NOT a proven code failure on a pinned tree.
   * Present whenever verifiedCommit is (git roots); false on a pinned (unchanged) tree — the
   * explicit negative control (AC3). Absent on non-git hermetic roots.
   */
  treeMutatedMidRound?: boolean;
  /**
   * gap-precommit-guard-blocks-commits-not-working-tree-edits — assertion-surface files in the TESTED
   * tree EDITED MID-ROUND (round-start content snapshot vs round-end compare). The running round read
   * such a file at two different states ⇒ its verdict is a MIXED-STATE candidate: a red is a
   * FALSE-POSITIVE CANDIDATE, a green is a WEAKER GREEN (the same annotation semantics as
   * treeMutatedMidRound — AC1/AC2 of gap-concurrent-write-mutable-tree-false-positive-red: never a
   * green/red criterion). The round-84 shape (a MAIN-checkout uncommitted edit) is PREVENTED by the
   * one-shot worktree isolation — the tested tree is frozen — so this flag catches the residual case:
   * the suite (or anything) editing the TESTED tree's own assertion-surface files mid-round. Absent
   * when no assertion-surface file changed (绿轮可无, same absent-field contract as *_phase_ms); a
   * non-git hermetic root degrades to an empty snapshot ⇒ absent (no detection possible).
   */
  assertionSurfaceEditedMidRound?: string[];
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
  /^STATIC_CHECK_FAILED:/, // checker-cost-lib fail-closed (gap-static-check-red-failures-capture-only-task-contract-shape): a run_static_checks checker exited non-zero — the real cause line round-84's failures[] could not see (it only knew the task-contract VIOLATION shapes)
];
// DETAIL lines (appear on passing runs too — baselined violations are listed; only failure-relevant
// when a FAILURE marker above is present):
const STATIC_CHECK_VIOLATION_RE = /^VIOLATION:\s*(\S+)\s*[—\-]\s*([^:]+):\s*(.*)$/;
const STATIC_CHECK_SUMMARY_RE = /^violations:\s*(\d+)\s+unique across\s*(\d+)\s+task/;
const STATIC_CHECK_RATCHET_RE = /^ratchet ceiling:\s*(\d+);\s*new since baseline:\s*(\d+)/;
// checker-cost-lib fail-closed line (gap-static-check-red-failures-capture-only-task-contract-shape):
//   STATIC_CHECK_FAILED: <name> exit=<rc>  (one line per failing checker, on stderr)
const STATIC_CHECK_FAILED_RE = /^STATIC_CHECK_FAILED:\s*(\S+)\s+exit=(\d+)/;

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

/**
 * One fail-closed static-check checker (gap-static-check-red-failures-capture-only-task-contract-shape):
 * checker-cost-lib's run_checker_parallel_wait emits `STATIC_CHECK_FAILED: <name> exit=<rc>` (one line
 * per failing checker) when a run_static_checks checker exits non-zero. This is the ROUND-84 真因 shape —
 * a checker that fail-closed (e.g. threshold-scope-check) with ZERO VIOLATION detail lines to its name,
 * so the old failures[] capture (task-contract VIOLATION shapes only) recorded nothing about it. `name`
 * is the checker id, `exitCode` the checker's own exit code (the FIRST failing checker's code is what
 * run_checker_parallel_wait returns), `line` the raw stream line.
 */
export interface FailClosedChecker {
  name: string;
  exitCode: number;
  line: string;
}

/**
 * Parse ONE checker-cost-lib fail-closed line into a FailClosedChecker (best-effort; null when the
 * line is not a `STATIC_CHECK_FAILED:` shape or carries an unparseable exit code).
 */
export function extractFailClosedChecker(line: string): FailClosedChecker | null {
  const m = STATIC_CHECK_FAILED_RE.exec(line);
  if (!m) return null;
  const exitCode = Number(m[2]);
  if (!Number.isInteger(exitCode) || exitCode < 0) return null;
  return { name: m[1], exitCode, line };
}


// gap-streaming-red-cascade-amplifies-failures-array AC1 — the KNOWN suite-state-asserting TEST FILES:
// tests that read the shared `.quay/full-suite-state.json` and assert `state=running with finishedAt
// null while the suite runs` (full-suite-runner.test.mjs AC1 / laydown-set-check.test.mjs AC1). When
// the runner EARLY-REDS (AC2 — the shared state flips to red the moment a load-sensitive test fails),
// these tests — running LATER in the same suite — read the red state and fail: a CASCADE failure, NOT
// an independent code failure (round 130: ×3 full-suite-runner + ×1 laydown-set-check — the
// checker-cost flake's early-red amplified the round's failures[] 3×). This is the assertion-surface
// manifest: it must be extended whenever a NEW test file starts reading the shared suite-state and
// asserting on its in-flight shape.
const STATE_ASSERTING_TEST_FILES = new Set([
  "plugin/test/full-suite-runner.test.mjs",
  "plugin/test/laydown-set-check.test.mjs",
]);

/** True when a failure's file is a KNOWN suite-state-asserting test file (a cascade candidate). */
export function isStateAssertingTestFile(file: string | undefined): boolean {
  return typeof file === "string" && STATE_ASSERTING_TEST_FILES.has(file);
}

/**
 * gap-streaming-red-cascade-amplifies-failures-array AC1/AC2 — SEGMENT a round's failure entries so
 * `failures[]` (the triage / stop-dispatch / red-rate input) never carries the two populations that
 * distort it:
 *   - CASCADE entries (`derived: "cascade"`) — failures of KNOWN suite-state-asserting test files
 *     that fail reading the early-red shared state, NOT because the code under test broke. They get
 *     their own `derived` array (round 130: ×3 full-suite-runner + ×1 laydown-set-check).
 *   - UNATTRIBUTED entries (no `file`) — the round-130 "×3 (no file)" population that `--partition`
 *     could only throw into not-in-family. They get their own `unattributed` array (AC2/AC6 — listed,
 *     never silently dropped).
 * `failures[]` main set = real, file-attributable, non-cascade failures only. The round-130 three
 * counts (verification-round fail / outer early-read / state terminal) finally agree on this set.
 */
export function segmentFailures(failures: SuiteFailure[]): {
  failures: SuiteFailure[];
  derived: SuiteFailure[];
  unattributed: SuiteFailure[];
} {
  const main: SuiteFailure[] = [];
  const derived: SuiteFailure[] = [];
  const unattributed: SuiteFailure[] = [];
  for (const f of failures ?? []) {
    if (isStateAssertingTestFile(f.file)) derived.push({ ...f, derived: "cascade" });
    else if (!f.file) unattributed.push(f);
    else main.push(f);
  }
  return { failures: main, derived, unattributed };
}

/**
 * gap-streaming-red-cascade-amplifies-failures-array AC1/AC2 — the segmented failure fields for a
 * state/round write. `failures` is OMITTED when the main set is empty (the gap-suite-red-verdict-
 * carries-empty-failures-payload invariant: a red verdict never writes `failures: []` — the derived /
 * unattributed fields carry the payload instead); `derived` / `unattributed` are present only when
 * non-empty.
 */
export function segmentedFailureFields(failures: SuiteFailure[]): {
  failures?: SuiteFailure[];
  derived?: SuiteFailure[];
  unattributed?: SuiteFailure[];
} {
  const seg = segmentFailures(failures);
  return {
    ...(seg.failures.length ? { failures: seg.failures } : {}),
    ...(seg.derived.length ? { derived: seg.derived } : {}),
    ...(seg.unattributed.length ? { unattributed: seg.unattributed } : {}),
  };
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

// ── gap-suite-hub-file-responsibility-strip — accounting family extracted to suite-accounting.ts ──
// The cgroup/systemd accounting family (per-phase cpu/psi differential reads + the systemd `Consumed`
// load fields) is PURE TELEMETRY — changing it never flips pass/fail — so it moved to suite-accounting.ts
// (a NON-hub file; an accounting-only change now takes the bucket path instead of the full suite).
// Imported here for the runner's internal use (PhaseDifferentialAccounting in run(); PhaseDiffRecord in
// SuiteRoundRecord; readScopeConsumedLoad + ScopeConsumedLoadRead at the round-end load capture) and
// re-exported so the runner's public API surface — and every importer (e.g. full-suite-runner.test.mjs)
// — is byte-for-byte unchanged.
import { PhaseDifferentialAccounting, readScopeConsumedLoad } from "./suite-accounting.ts";
import type { PhaseDiffRecord, ScopeConsumedLoadRead } from "./suite-accounting.ts";

export {
  resolveCgroupV2Dir,
  parseCpuStatUsageUsec,
  parsePressureSomeTotal,
  readPhaseCounters,
  PhaseDifferentialAccounting,
  parseSystemdTimespanToSeconds,
  parseSystemdBytesToMb,
  parseSystemdConsumedLine,
  parseConsumedFromJournalOutput,
  readScopeConsumedLoad,
} from "./suite-accounting.ts";
export type {
  PhaseCounters,
  PhaseCountersRead,
  PhaseDiffRecord,
  ParsedConsumedLine,
  ScopeConsumedLoadRead,
} from "./suite-accounting.ts";

/**
 * gap-verification-round-observability-holes AC4 — the round's effective parallelism: cpu_time_s ÷
 * (durationMs/1000) = consumed CPU time ÷ wall time = the average cores actually driven. Rounded to 3
 * decimals (comparable across rounds). null when either input is missing/non-finite/≤0 (a fabricated 0
 * quotient would read "infinite cores" — 硬规则⑥ 缺值=未查≠为假).
 */
export function effectiveParallelism(cpuTimeS: number | null | undefined, durationMs: number): number | null {
  if (cpuTimeS == null || !Number.isFinite(cpuTimeS) || cpuTimeS <= 0) return null;
  const wallS = durationMs / 1000;
  if (!Number.isFinite(wallS) || wallS <= 0) return null;
  return Number((cpuTimeS / wallS).toFixed(3));
}

export interface SuiteRoundRecord {
  round: number;
  startedAt: string;
  durationMs: number;
  laneCount: number;
  // gap-lanes-nproc-concurrent-suites-accounting AC1/AC3 — the CONCURRENCY VARIABLES of the round, so
  // a cross-round wall-clock comparison can attribute "this round is slower" to machine concurrency
  // rather than to the change being measured. nproc = host parallelism (os.availableParallelism(),
  // read-host NEVER a literal — the SAME expression as defaultLaneCount's derivation, hard-rule-4
  // 推论二 family); concurrentSuiteSlots = the configured QUAY_MAX_CONCURRENT_SUITES (the 2-slot knob
  // ②, the single definition point); concurrentSuitesRunning = the ACTUAL number of full suites running
  // at the same time as this round (gap-verification-round-observability-holes AC3: an INDEPENDENT read
  // — countRunnerProcesses(), counting alive runner processes by cmdline — NOT the lock-slot probe, and
  // NOT capped at the slot count, so a real 4-suite overlap records 4). Optional for backward
  // compatibility with earlier appended lines — a reader must tolerate their absence (the same
  // absent-field contract as *_phase_ms / scope_unit).
  nproc?: number;
  concurrentSuiteSlots?: number;
  concurrentSuitesRunning?: number;
  /**
   * gap-verification-round-observability-holes AC1 — the flock wait the suite paid before acquiring a
   * single-flight slot (test.sh's `== single-flight lock` → `acquired full-suite single-flight slot`
   * marker diff, in ms). ~0 on a free-slot round; the bounded `flock -w 1` wait when all S slots were
   * held. Absent on scoped runs (no lock) and on lock-timeout aborts (no acquired marker) — a reader
   * must tolerate absence (same contract as *_phase_ms). This is the value that makes a gap>30% round
   * attributable to lock-wait instead of reading as a slow suite.
   */
  lock_wait_ms?: number;
  /**
   * gap-suite-lock-starvation-long-validation-hold AC2 — the wall the suite HELD its single-flight slot
   * (test.sh's acquire→release marker diff, in ms). This is the field that makes a validation-type long
   * task distinguishable from a hung worker: high lock_wait_ms + low lock_hold_ms = starved in the queue;
   * high lock_hold_ms = actually held the slot (a genuine long-validation run, or a hung holder). Absent
   * on scoped/nested runs (no lock taken — 缺键, never a fabricated 0).
   */
  lock_hold_ms?: number;
  pass: number;
  fail: number;
  cancelled: number;
  load: number;
  state: string;
  runner: string;
  // gap-worktree-scoped-runs-consume-resources-but-produce-no-signal AC1: main|worktree — which
  // checkout produced this round (the same `scope` the state file carries). Absent on legacy rows.
  scope?: "main" | "worktree";
  // gap-verification-round-in-one-shot-worktree — true when this round ran in a one-shot verify
  // worktree (the same flag the suite-state carries). Absent on non-one-shot rows.
  oneShotWorktree?: boolean;
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
   * gap-verifiedcommit-dirty-tree-false-certificate AC5 — VOIDED-CERTIFICATE marker: true when this
   * round's tests PASSED but its tested tree was MUTATED MID-ROUND (treeMutatedMidRound=true ⇒
   * state=red reason=infra-error instead of green). Lets the round sequence distinguish a voided
   * green (false certificate) from a real failure. Absent on every non-voided round.
   */
  void?: boolean;
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
   * gap-verifiedcommit-dirty-tree-false-certificate AC1 — the round-start DIRTY flag for the tested
   * root (git status --porcelain incl. untracked). `true` ⇒ the round's `commit` is a FALSE
   * CERTIFICATE (the round-90/4a3fc0be shape). Same conditional as the state write (git roots only).
   */
  treeDirty?: boolean;
  /**
   * gap-verifiedcommit-dirty-tree-false-certificate AC2 — the tested content's tree hash (tracked
   * part) at round start (`git stash create`'s tree when dirty, else `HEAD^{tree}`). Makes
   * "was this round's green a certificate for its `commit`" a comparison (`tree === commit^{tree}`).
   * Same conditional as the state write (git roots only).
   */
  tree?: string;
  /**
   * gap-precommit-guard-blocks-commits-not-working-tree-edits — the same assertion-surface mid-round
   * EDIT annotation the suite-state carries, on the round record so the historical sequence is
   * queryable for "was this round's verdict mixed-state" without re-deriving it (the same conditional
   * as the state write — the edited file list, absent when nothing changed, 绿轮可无).
   */
  assertionSurfaceEditedMidRound?: string[];
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
   * gap-streaming-red-cascade-amplifies-failures-array AC1/AC2 — the round record carries the SAME
   * segmented populations the suite-state write carries (`derived` = cascade entries, `unattributed` =
   * no-file entries), so the historical red-round sequence is queryable for "was this round's red
   * cascade-amplified / unattributable" without re-deriving it — and collectFailureFiles never sees
   * them (they are not task-Touches-attributable). Present only when non-empty (绿轮可无); a reader
   * must tolerate their absence.
   */
  derived?: SuiteFailure[];
  unattributed?: SuiteFailure[];
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
  /**
   * gap-test-detail-perfile-duration-failed AC1 — the per-file wall-clock + pass/fail array
   * (`{file, durationMs, passed}[]`), reusing measure-suite-reporter's `__PERFILE__ duration_ms=<dur>
   * <path> passed=<bool>` stream (parsed by measure-trend-check's parsePerFileLines — the SAME parser
   * that lands measure-history.jsonl, so the two carriers share one 口径: repo-root-relative `file`
   * keys via normalizePerFileKey, duration>0 filter). Present only when the round actually emitted
   * __PERFILE__ lines (a scoped/legacy run with no reporter omits the field — never a fabricated []).
   */
  perFile?: PerFileRecord[];
  /**
   * gap-verification-round-load-fields-from-systemd — the suite cgroup scope's consumed CPU time /
   * memory peak / memory swap peak, parsed from systemd's `Consumed` journal line (kernel-accumulated
   * exact values — the phase-lane experiment's per-round 关注负载 axis, zero new instrumentation).
   * `scope_unit` is THIS round's own scope unit, captured at round START into the round record (trap
   * 1 — NEVER read back from the shared single-slot suite-cgroup-evidence.txt at teardown; that file
   * is overwritten every round). The three fields are numbers when the Consumed line reported them,
   * explicit null when the line omitted them (memory accounting off) or the read failed — NEVER 0
   * (trap 3: `mem_peak_mb: 0` reads as "this round used no memory"; `cpu_time_s: 0` makes the
   * parallelism quotient infinite). `load_read_error` names the failure reason (null on a full read).
   * All four are present only when the runner wrapped the suite in a systemd-run --scope (the real
   * full-suite path) or a hermetic seam injected a scope unit; ABSENT on non-systemd rounds (reader
   * tolerates absence, same contract as the *_phase_ms fields).
   */
  scope_unit?: string;
  cpu_time_s?: number | null;
  /**
   * gap-verification-round-cpu-split-not-recorded AC1/AC3 — the gnu-time USER/SYSTEM CPU split, present
   * ONLY when the round's cpu_time_s came from GNU time (the fan-in detached-suite path writes these
   * via pre-verified-round-record.ts). THIS runner's cpu_time_s comes from the systemd `Consumed`
   * journal line, which reports ONLY aggregate CPU time — no user/sys split — so a full-suite-runner
   * row NEVER carries these fields (缺键, same absent-field contract as cpu_time_s itself). A reader
   * must tolerate their absence (and must not infer "user/sys unknown ⇒ 0").
   */
  cpu_user_s?: number;
  cpu_sys_s?: number;
  mem_peak_mb?: number | null;
  swap_peak_mb?: number | null;
  load_read_error?: string | null;
  /**
   * gap-verification-round-observability-holes AC4 — the round's EFFECTIVE PARALLELISM:
   * cpu_time_s / (durationMs/1000) = consumed CPU time ÷ wall time = the average number of cores the
   * suite actually drove (the Finding's cpu/wall — 8.7 cores solo vs 4.9 per-suite overlapped). The
   * single "did the suite optimization help" KPI: a round that sped up by using MORE cores shows a
   * higher value; a round slowed by lock-wait / contention shows a LOWER one. Present only when
   * cpu_time_s was a finite number (systemd Consumed line or the QUAY_TEST_JOURNALCTL_OUTPUT seam);
   * absent on a null cpu_time_s (memory-accounting-off / read failure — a fabricated 0 would make the
   * quotient infinite) and on non-systemd rounds. A reader must tolerate absence (same contract as
   * cpu_time_s itself).
   */
  effective_parallelism?: number;
  /**
   * gap-leak-residue-per-run-namespace-isolation AC3 — the run's unified-cleanup count + WHICH
   * owner-dead residue dirs the runner's cleanup passes removed (pre-suite stale /tmp/quay-run-*
   * namespaces + post-suite own-namespace residue). `tmux_cleaned` = the count; `tmux_cleaned_dirs`
   * = the first 50 cleaned paths (cap). Present ONLY when something was cleaned (绿轮可无 — a run
   * with no residue omits both, same absent-field contract as *_phase_ms). The leak signal is
   * degraded from a gate to an observable metric: a genuinely leaked LIVE server still reds the
   * suite-tail leak-scan (the gate is intact); owner-dead residue is cleaned + counted here.
   */
  tmux_cleaned?: number;
  tmux_cleaned_dirs?: string[];
  /**
   * gap-phase-boundary-differential-accounting AC1/AC2 — the per-phase DIFFERENTIAL records
   * (static→serial→lowconc→main→end + inter-phase gaps): one entry per phase, each
   * {phase, wall_ms, cpu_usec, psi_cpu_total, psi_io_total, lanes} where cpu_usec / psi_* are the
   * DIFFERENTIAL of the monotonic cumulative cgroup counters across that phase's window (kernel-
   * accumulated exact totals, never a periodic sample). The derived quantities are directly
   * computable from the records + the round's nproc: 相利用率=cpu_usec/(wall×lanes),
   * 相饱和度=cpu_usec/(wall×nproc), 等待占比=psi_cpu_total/wall — answering 「这一相是算得多还是
   * 等得久」 without wall-clock + code-constant 推算. cpu/psi are explicit null when the counter
   * read failed (缺键, never 0). Present on EVERY round the suite child spawned (green, red, abort,
   * crash — the trap writes it too); absent only on early returns before the child spawned (no
   * phases ran). `phase_counter_error` names the failure reason when the counters were unreadable.
   */
  phases?: PhaseDiffRecord[];
  phase_counter_error?: string | null;
  /**
   * gap-ac124-suite-bucket-production-carrier-benefit — the bucket-execution fields, present ONLY on
   * a bucket-mode round (test.sh emitted a __BUCKETS__ marker; the default full suite never does).
   *   buckets             — which buckets ran: "P" | "M" | "P+M" | "full" (full = hub fallback or a
   *                         no-bucket-triggerable change, still a bucket-mode decision).
   *   bucket_files        — the selected test-file count (the FULL count on a "full" round).
   *   bucket_duration_ms  — the bucket run's wall duration (= durationMs: the round IS the bucket run).
   * Absent on every non-bucket round — a reader must tolerate their absence (same contract as the
   * *_phase_ms / cpu_time_s fields).
   */
  buckets?: string;
  bucket_files?: number;
  bucket_duration_ms?: number;
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
 * derivation: max(1, floor(nproc × oversub / S)). nproc = host parallelism
 * (os.availableParallelism() — read-host, never a literal, hard-rule-4 推论二 family); S = the
 * concurrent-suite slot count (旋钮② QUAY_MAX_CONCURRENT_SUITES, default 1 — the SAME
 * definition-point read as concurrentSuiteSlots()); oversub = 旋钮③ QUAY_MAX_OVERSUBSCRIPTION
 * (default 1, current value not a recommendation).
 *
 * gap-suite-budget-oversubscribe (human 14:4xZ 修正方向 — (b) 认领制/(c) 锁发配额 均被否，纯计算零新增
 * 运行时状态): the previous AC74 formula (nproc ÷ AMPLIFICATION on the runner, nproc − in_use on the
 * direct path) had NO structural bound tying the sum of all running suites' lanes to the host: two
 * concurrent suites derived nproc each (16+8=24 > 16, load 29.23 on 2026-08-14 14:39Z). The new
 * formula is PURE computation — S suites each derive nproc×oversub/S ⇒ Σ lane ≤ nproc×oversub
 * structurally, no claim-ledger / no lock-carried quota. A single suite gets nproc/S (8 on this host)
 * — the known cost of the pure-computation approach (判据4), not a defect; express "single suite uses
 * the whole host" via the oversub knob instead (⛔ never dynamic run-count amplification).
 * RESOURCE_GATE_NPROC / QUAY_MAX_CONCURRENT_SUITES / QUAY_MAX_OVERSUBSCRIPTION are the
 * deterministic test seams (RESOURCE_GATE_NPROC the same seam test.sh reads; the S/oversub knobs are
 * read via their production env so tests drive them directly).
 */
export function defaultLaneCount(): number {
  const ncpuRaw = process.env.RESOURCE_GATE_NPROC ?? String(
    typeof os.availableParallelism === "function" ? os.availableParallelism() : os.cpus().length,
  );
  const ncpu = Number(ncpuRaw);
  const slots = concurrentSuiteSlots();
  const oversubRaw = Number(process.env.QUAY_MAX_OVERSUBSCRIPTION ?? "1");
  const oversub = Number.isFinite(oversubRaw) && oversubRaw > 0 ? oversubRaw : 1;
  return Math.max(1, Math.floor((Number.isFinite(ncpu) && ncpu >= 1 ? ncpu : 1) * oversub / slots));
}


// ── gap-lanes-nproc-concurrent-suites-accounting: nproc + concurrent-suite accounting ────────────────

/**
 * Resolve the S single-flight lock files from the CANONICAL slot implementation
 * (plugin/scripts/suite-lock-slots.ts — the SINGLE definition point for "the suite lock slots",
 * gap-suite-concurrency-ff-gate-and-slot-ssot): `${FULL_SUITE_LOCK_FILE}` env override →
 * `git rev-parse --git-common-dir` (the SHARED lock dir ALL worktrees of this repo contend on — a
 * per-checkout lock would NOT serialize across worktrees, the 2026-08-07 two-worktree incident) →
 * fall back to `<root>/.git`. Returns the S slot paths [base.0 .. base.S-1] where S =
 * QUAY_MAX_CONCURRENT_SUITES. `root` is the tested checkout the probe runs against (git-common-dir is
 * resolved from it, matching test.sh's cwd — a relative git-common-dir is resolved against root,
 * absolute paths pass through).
 */
function suiteLockPaths(root: string): string[] {
  return suiteLockSlotPaths(suiteLockBase(root));
}

/** Non-blocking probe of ONE slot: false = FREE, true = HELD (another suite is mid-run). A missing
 *  parent dir (no suite has ever locked here — a non-git hermetic test root) reads as FREE: flock(1)
 *  cannot probe a nonexistent path (exits 66/ENOENT), and creating stray lock files must not fabricate
 *  a "held" slot. The probe holds the slot for the lifetime of `true` (µs) and releases — it is a
 *  READ, not an acquisition (the suite's own slot is acquired later, inside test.sh). */
function probeLockHeld(lockFile: string): boolean {
  if (!fs.existsSync(path.dirname(lockFile))) return false;
  try {
    execFileSync("flock", ["-n", lockFile, "true"], { stdio: "ignore" });
    return false;
  } catch {
    return true;
  }
}

/**
 * gap-lanes-nproc-concurrent-suites-accounting AC1 — the number of single-flight lock slots CURRENTLY
 * held by OTHER suites at probe time (0..S, S = concurrentSuiteSlots()). Best-effort: any resolution /
 * probe error degrades to 0 (fail-open — accounting never blocks or fails a run; a lone round records
 * concurrentSuitesRunning=1 regardless). The probe is a READ (see probeLockHeld) — it never contends
 * with the suite's own lock acquisition, which happens AFTER this probe in the spawned test.sh.
 */
export function countHeldSuiteLocks(root: string): number {
  try {
    return suiteLockPaths(root).reduce((held, slot) => held + (probeLockHeld(slot) ? 1 : 0), 0);
  } catch {
    return 0;
  }
}

/**
 * gap-verification-round-observability-holes AC3 — the ACTUAL number of full-suite runner processes
 * ALIVE right now (an INDEPENDENT read — counting running processes by cmdline, NOT the lock-slot
 * probe that `concurrentSuitesRunning` used to be derived from). The lock-slot probe WAS the broken
 * mechanism: one pid holding two slots (pid 606544 double-held full-suite.lock.0+.1) made the slot
 * count read ≤S forever, so the field was `{None:140, 1:34, 2:18}` and NEVER >2 even when 4 suites
 * genuinely overlapped — the proxy recorded the broken mechanism instead of the observed quantity
 * (CLAUDE.md 硬规则 4b: 代理量偏离实际). Counting the runner processes themselves is the DIRECT
 * quantity. Includes THIS runner (its own cmdline matches), so a lone round reads 1; NOT capped at
 * the slot count (可记录 >2). Best-effort: any read failure fails open to 1 (this runner) —
 * accounting never blocks or fails a run.
 */
export function countRunnerProcesses(): number {
  const seam = process.env.QUAY_TEST_RUNNER_PROCS;
  if (seam !== undefined) {
    const n = Number(seam);
    return Number.isFinite(n) && n >= 1 ? Math.floor(n) : 1;
  }
  try {
    // `pgrep -f` matches the FULL cmdline. The escaped-dot pattern `full-suite-runner\.ts` matches the
    // runner's own argv (node … plugin/scripts/full-suite-runner.ts) but NOT its test file
    // (full-suite-runner.test.mjs — `.ts` vs `.test.mjs`), so a hermetic test process is never
    // self-counted. `-c` prints the count and exits 0 (≥1 match) — this runner is ALWAYS a match.
    const out = execFileSync("pgrep", ["-c", "-f", "full-suite-runner\\.ts"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    const n = Number(String(out).trim());
    return Number.isFinite(n) && n >= 1 ? Math.floor(n) : 1;
  } catch {
    // pgrep exits non-zero only on ZERO matches — impossible here (this runner matches), so a
    // non-zero exit is a real read failure (pgrep missing / unreadable /proc). Fail open to 1.
    return 1;
  }
}

/**
 * gap-load-sensitive-serial-phase-unbounded-growth-measure-first AC2/AC3 (measure-first) —
 * the load-sensitive phase concurrency defaults. The serial phase (KNOWN-LOAD-SENSITIVE A/B-class +
 * real-install family) and the lowconc phase (hermetic-but-load-sensitive session-observation
 * family) default to the HOST parallelism (os.availableParallelism()), not a machine-spec-dependent
 * literal 6 — on nproc=16 the old 6/6 left 10 cores idle across 59.5% of wall-clock
 * (gap-ac44-concurrent-phases-read-host-parallelism). The measured experiment evidence for WHY these
 * phases benefit from concurrency > 1 still stands: serial cc=1 WALL_MS=455613 vs cc=2 WALL_MS=289579,
 * both 0-cancelled (2026-08-10, c2 快 36%; real-install e2e 双文件 c2 实测 0-cancelled). Both remain
 * overridable via --serial-concurrency / --lowconc-concurrency, which the runner passes to test.sh as
 * QUAY_SERIAL_CONCURRENCY / QUAY_LOWCONC_CONCURRENCY so a FUTURE controlled experiment can re-measure
 * before any further bump.
 * gap-ac74-serial-lowconc-literal-direct-path (human 06:4xZ AC68 /slots 回退) — the serial/lowconc
 * PHASE budgets divide by the concurrent-suite slot count (hostParallelism ÷ QUAY_MAX_CONCURRENT_SUITES;
 * 1 suite ⇒ 16, 2 suites ⇒ each 8 on a 16-core host) — the SAME expression test.sh's
 * serial_lowconc_host_default reads so the direct path matches (判据4). This is the AC44 rule; the
 * MAIN lane budget (defaultLaneCount) ALSO divides by S (max(1, floor(nproc × oversub / S)) —
 * gap-suite-budget-oversubscribe, human 14:4xZ 修正方向), so the sum over S suites cannot exceed
 * nproc × oversub.
 */
/**
 * gap-lane-formula-ignores-phase-overlap-concurrency — the number of load-sensitive phases that run
 * CONCURRENTLY in the overlap window. QUAY_PHASE_OVERLAP=1 (the default, matching test.sh's
 * `PHASE_OVERLAP="${QUAY_PHASE_OVERLAP:-1}"`) runs serial + lowconc in PARALLEL ⇒ 2 concurrent
 * phases, each at its own concurrency — the overlap window's Σ lane = SERIAL + LOWCONC, so the
 * per-phase budget must divide the host by S × P (P = the concurrent-phase count) to keep
 * Σ lane ≤ nproc × oversub structurally. QUAY_PHASE_OVERLAP=0 runs them sequentially ⇒ P = 1 (the
 * pre-overlap budget, unchanged — AC3 negative control). Reads the SAME knob default as test.sh so
 * the direct path and runner path cannot drift (判据4).
 */
export function concurrentPhaseCount(): number {
  return process.env.QUAY_PHASE_OVERLAP === "0" ? 1 : 2;
}

/**
 * gap-load-sensitive-serial-phase-unbounded-growth-measure-first AC2/AC3 (measure-first) —
 * the load-sensitive phase concurrency defaults. The serial phase (KNOWN-LOAD-SENSITIVE A/B-class +
 * real-install family) and the lowconc phase (hermetic-but-load-sensitive session-observation
 * family) default to the HOST parallelism (os.availableParallelism()), not a machine-spec-dependent
 * literal 6 — on nproc=16 the old 6/6 left 10 cores idle across 59.5% of wall-clock
 * (gap-ac44-concurrent-phases-read-host-parallelism). The measured experiment evidence for WHY these
 * phases benefit from concurrency > 1 still stands: serial cc=1 WALL_MS=455613 vs cc=2 WALL_MS=289579,
 * both 0-cancelled (2026-08-10, c2 快 36%; real-install e2e 双文件 c2 实测 0-cancelled). Both remain
 * overridable via --serial-concurrency / --lowconc-concurrency, which the runner passes to test.sh as
 * QUAY_SERIAL_CONCURRENCY / QUAY_LOWCONC_CONCURRENCY so a FUTURE controlled experiment can re-measure
 * before any further bump.
 * gap-ac74-serial-lowconc-literal-direct-path (human 06:4xZ AC68 /slots 回退) — the serial/lowconc
 * PHASE budgets divide by the concurrent-suite slot count (hostParallelism ÷ QUAY_MAX_CONCURRENT_SUITES;
 * 1 suite ⇒ 16, 2 suites ⇒ each 8 on a 16-core host) — the SAME expression test.sh's
 * serial_lowconc_host_default reads so the direct path matches (判据4). This is the AC44 rule; the
 * MAIN lane budget (defaultLaneCount) ALSO divides by S (max(1, floor(nproc × oversub / S)) —
 * gap-suite-budget-oversubscribe, human 14:4xZ 修正方向), so the sum over S suites cannot exceed
 * nproc × oversub.
 * gap-lane-formula-ignores-phase-overlap-concurrency — the phase budgets now ALSO divide by the
 * concurrent-phase count P (S × P = slots × concurrentPhaseCount()): with overlap ON the overlap
 * window runs serial+lowconc in parallel (Σ lane = SERIAL + LOWCONC), so each phase gets
 * hostParallelism ÷ (S × 2) — the same S×P denominator test.sh's serial_lowconc_host_default reads.
 */
export const DEFAULT_SERIAL_CONCURRENCY = Math.max(1, Math.floor(hostParallelism() / (concurrentSuiteSlots() * concurrentPhaseCount())));
export const DEFAULT_LOWCONC_CONCURRENCY = Math.max(1, Math.floor(hostParallelism() / (concurrentSuiteSlots() * concurrentPhaseCount())));

/** Parse a positive-integer arg (e.g. --serial-concurrency 2); NaN/<1 → null (caller errors). */
function parsePositiveIntArg(argv: string[], name: string): number | null {
  const raw = parseArg(argv, name);
  if (raw === undefined) return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1) return null;
  return n;
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


// ── AC3: resource-gate consultation before starting ──────────────────────────────────────────────────


/**
 * gap-concurrent-write-mutable-tree-false-positive-red — read the tested checkout's CURRENT HEAD and
 * compare with the round's START head (verifiedCommit): whether the tree has been MUTATED since the
 * round started (concurrent writers committed to the shared tree while the suite ran on it). Used BOTH
 * at EARLY-red time (provisional — the tree may keep moving; memoized per run) and at the TERMINAL
 * verdict (definitive — the full-window comparison, start HEAD vs terminal HEAD, AC1). Git roots only;
 * a non-git hermetic root yields `treeMutatedMidRound: false` (never fabricates a commit).
 */
export function readTreeMutation(
  root: string,
  startHead: string | undefined,
): { terminalCommit: string | undefined; treeMutatedMidRound: boolean } {
  const terminalCommit = readVerifiedCommit(root);
  const treeMutatedMidRound =
    startHead !== undefined && terminalCommit !== undefined && startHead !== terminalCommit;
  return { terminalCommit, treeMutatedMidRound };
}

// ── assertion-surface mid-round EDIT detection (gap-precommit-guard-blocks-commits-not-working-tree-edits) ──
// Round-84 shape (manager 2026-08-12): an UNCOMMITTED working-tree EDIT to an assertion-surface file
// enters the running round's view at SAVE time (the suite reads the tested checkout's working tree),
// NOT commit time — the pre-commit guard fires at the commit and cannot stop it. The one-shot worktree
// (5652604f) ISOLATES the main checkout: the main full-suite round runs in a FROZEN detached worktree
// at the start HEAD, so a main-checkout edit PHYSICALLY cannot reach the tested tree (the round-84
// pollution is prevented by construction — the negative control proves it). This block supplies the
// DETECTION half (AC1): snapshot the TESTED tree's assertion-surface files (the ones the round actually
// reads) at round start, compare at round end — a file changed mid-round is flagged. Semantics mirror
// `treeMutatedMidRound` (gap-concurrent-write-mutable-tree-false-positive-red AC1/AC2): an ANNOTATION,
// never a green/red criterion — a red in such a round is a false-positive candidate, a green is a
// weaker green. The assertion-surface RESOLUTION is reused from precommit-guard.ts (the SAME
// judged-object registry the guard reads; AC51 doc-class files already excluded).


/**
 * Compare the CURRENT content of the snapshot's assertion-surface files against the round-start
 * snapshot. Returns the repo-relative files whose content changed MID-ROUND (the running round read
 * them at two different states — a mixed-state verdict candidate). A file deleted mid-round (readable
 * at start, unreadable at end) IS a change; a file unreadable at BOTH times is NOT a change.
 */
export function detectAssertionSurfaceEdits(root: string, snapshot: AssertionSurfaceSnapshot): string[] {
  const changed: string[] = [];
  for (const f of snapshot.files) {
    let cur: string;
    try {
      cur = contentHash(fs.readFileSync(path.join(root, f), "utf8"));
    } catch {
      cur = "<unreadable>";
    }
    if (cur !== snapshot.hashes[f]) changed.push(f);
  }
  return changed;
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

// ── gap-verification-round-in-one-shot-worktree — one-shot verify worktree provisioning ─────────────
// The full suite on the MAIN checkout runs in a freshly-provisioned worktree (the tested tree is
// PHYSICALLY a different checkout than the mutable main repo), then tears it down. This makes the
// three structural defects IMPOSSIBLE (the task Proposal): 守卫覆盖缺口 / verifiedCommit 假证书 /
// 自造脏 — the main checkout is never the tested tree. The provisioning reuses the EXISTING
// provision-verify-worktree.sh — its FIRST production caller (built + tested, 0 non-test callers).

/** Default parent dir for one-shot verify worktrees (config convention: <main>/../<project>-worktrees).
 *  Redirect via QUAY_VERIFY_WORKTREES_ROOT for hermetic tests. */
export function verifyWorktreesRoot(mainRoot: string): string {
  return process.env.QUAY_VERIFY_WORKTREES_ROOT ?? path.resolve(mainRoot, "..", `${path.basename(mainRoot)}-worktrees`);
}

/**
 * Fork + provision a one-shot verify worktree off `mainRoot`'s current HEAD. Returns the worktree
 * path — a DETACHED checkout (no branch ref is created, so `git worktree remove` leaves no dangling
 * branch; the tested tree IS `mainRoot`'s HEAD, frozen). The suite runs inside it;
 * teardownOneShotWorktree() removes it after the round (normal + crash + signal paths).
 */
export function provisionOneShotWorktree(mainRoot: string): string {
  const wtRoot = verifyWorktreesRoot(mainRoot);
  fs.mkdirSync(wtRoot, { recursive: true });
  const slug = `verify-round-${Date.now()}-${randomUUID().slice(0, 6)}`;
  const wtPath = path.join(wtRoot, slug);
  execFileSync("git", ["worktree", "add", "--detach", wtPath, "HEAD"], {
    cwd: mainRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  // Provision the gitignored runtime files the fresh worktree lacks: config.yml + vendor dist
  // (worktree-include.sh) + node_modules symlink + Core CLI dist build (provision-verify-worktree.sh).
  const provisionScript = path.join(__dirname, "provision-verify-worktree.sh");
  execFileSync("bash", [provisionScript, "--worktree", wtPath, "--root", mainRoot], {
    cwd: mainRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  return wtPath;
}

/** Tear down a one-shot verify worktree COMPLETELY (stop sessions + git worktree remove + rm -rf,
 *  via provision-verify-worktree.sh --teardown). Best-effort — a teardown failure must never fail
 *  the suite verdict (the leak is reclaimable by worktree-branch-hygiene-check.sh). */
export function teardownOneShotWorktree(mainRoot: string, wtPath: string): void {
  try {
    const provisionScript = path.join(__dirname, "provision-verify-worktree.sh");
    execFileSync("bash", [provisionScript, "--worktree", wtPath, "--root", mainRoot, "--teardown"], {
      cwd: mainRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    process.stderr.write(`full-suite-runner: one-shot worktree torn down: ${wtPath}\n`);
  } catch (e) {
    process.stderr.write(`full-suite-runner: one-shot worktree teardown failed (continuing): ${e instanceof Error ? e.message : String(e)}\n`);
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
  // gap-verification-round-in-one-shot-worktree — the full suite on the MAIN checkout runs inside a
  // ONE-SHOT WORKTREE: provision a fresh detached worktree off the main HEAD, run the suite in it
  // with the tested checkout = the worktree and the state/log target = <main>/.quay (config C
  // NODE_COMPILE_CACHE reuse), then tear it down. This makes three structural defects IMPOSSIBLE
  // (the task Proposal): (a) 守卫覆盖缺口 — main-checkout edits are PHYSICALLY outside the tested
  // tree; (b) verifiedCommit 假证书 — the tested tree IS the commit and is FROZEN (no concurrent
  // writer can mutate it mid-round ⇒ treeMutatedMidRound stays false by construction); (c) 自造脏 —
  // package-lock/install rewrites hit the ephemeral worktree copy, never the main checkout.
  // Trigger: automatic when the tested checkout IS the main repo (root === REPO_ROOT — the outer
  // verification round and suite-state-trigger's retrigger spawn both resolve to it), or explicit
  // via --one-shot-worktree. A caller that already targets a worktree (execute-suite-fix's
  // --root <wt>) or a hermetic temp root is never re-provisioned (guarded by !isGitWorktree + the
  // root === REPO_ROOT condition).
  let root = path.resolve(parseArg(argv, "--root") ?? REPO_ROOT);
  const mainRoot = root; // the main repo: fork source + state/log write target when one-shot
  const oneShot = argv.includes("--one-shot-worktree") || path.resolve(root) === REPO_ROOT;
  let oneShotWorktreePath: string | null = null;
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
  // cancelled BEFORE the default is bumped. Defaults are host-read (DEFAULT_SERIAL_CONCURRENCY /
  // DEFAULT_LOWCONC_CONCURRENCY = os.availableParallelism() ÷ (slots × concurrentPhaseCount()),
  // gap-ac44-concurrent-phases-read-host-parallelism + gap-lane-formula-ignores-phase-overlap-
  // concurrency) — an explicit flag always wins over the host default (AC2).
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

  // gap-ac124-suite-bucket-production-carrier-benefit — bucket-level selection. `--buckets <task-id>`
  // runs the task's bucket subset (P-only ⇒ P, M-only ⇒ M, hub ⇒ full) via test.sh's own --buckets
  // flag, instead of the canonical full suite. The runner's ONLY job here is to hand the bucket task
  // to test.sh (which is the selection authority) and to carry the __BUCKETS__ marker into the round
  // record. An explicit --command wins over --buckets (the caller took over the command entirely).
  const bucketTaskId = parseArg(argv, "--buckets");
  const baseCommand =
    explicitCommand ??
    (bucketTaskId !== undefined ? `bash scripts/test.sh --buckets ${bucketTaskId}` : "bash scripts/test.sh");
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
  // gap-verification-round-in-one-shot-worktree AC1 — when the round runs in a one-shot worktree,
  // the state/log default is <main>/.quay (the GATE location — the worktree is torn down at the end,
  // so writing state into it would throw the signal away). An explicit --state-dir is honored verbatim.
  const stateDir = path.resolve(parseArg(argv, "--state-dir") ?? path.join(mainRoot, ".quay"));
  const stateFile = path.resolve(parseArg(argv, "--state-file") ?? path.join(stateDir, "full-suite-state.json"));
  const logFile = path.resolve(parseArg(argv, "--log-file") ?? path.join(stateDir, "full-suite.log"));

  // gap-runner-spawn-single-flight AC1 — SPAWN-LAYER single-flight: refuse to start when a runner is
  // already in flight (state=running + live pid). The resource gate below checks only LOAD (PSI/
  // loadavg) — it does not know "another suite is already running". Two concurrent runners both pass
  // the load gate, both write state=running (last-write-wins clobber), and both spawn — the round
  // 129/131/132 retrigger storm. This check MUST be before the gate AND before any worktree
  // provisioning: refusing here costs nothing (no fork, no worktree). Lightweight controls
  // (--fail-fast-check/--static-check-check/--wait-check) skip it, matching the gate's skip.
  const skipInFlight =
    process.env.QUAY_TEST_SKIP_RESOURCE_GATE === "1" ||
    argv.includes("--fail-fast-check") ||
    argv.includes("--static-check-check") ||
    argv.includes("--wait-check");
  if (!skipInFlight) {
    let cur: TriggerSuiteState | null = null;
    try { cur = JSON.parse(fs.readFileSync(stateFile, "utf8")) as TriggerSuiteState; } catch { cur = null; }
    if (cur && isRunnerInFlight(cur)) {
      process.stderr.write(
        `full-suite-runner: another runner is already in flight (state=${cur.state}, pid=${cur.pid}) — refusing to start (single-flight; round 131/132 storm). Re-run after it finishes.\n`
      );
      return 1;
    }
  }

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
  // gap-runner-field-hardcoded-outer-not-measurement — `runner` 真实反映层身份（不再恒写 "outer"，
  // 硬规则 4：恒取假的量不是测量）。显式 --runner 旗标优先（对齐 pre-verified-round-record.ts）；
  // 否则从 scope 的同一来源派生（不新造判定逻辑）：worktree 内跑 ⇒ inner（fan-in/内层），
  // 主检出跑 ⇒ outer（外层/人要求的一次性轮）。两个载体（state + verification-round）共用 base.runner，
  // 从此不再各说各话。
  const runnerArg = parseArg(argv, "--runner");
  let runner: "outer" | "inner";
  if (runnerArg !== undefined) {
    if (runnerArg !== "outer" && runnerArg !== "inner") {
      process.stderr.write(
        `full-suite-runner: invalid --runner '${runnerArg}' (must be 'outer' or 'inner')\n`,
      );
      return 1;
    }
    runner = runnerArg;
  } else {
    runner = scope === "worktree" ? "inner" : "outer";
  }
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
  // gap-leak-residue-per-run-namespace-isolation AC1 — the per-run NAMESPACE id delivered to the
  // child (and hence to every node --test probe via session-liveness-helpers.mjs's QUAY_RUN_ID):
  // a SHORT id (8 hex chars from the state-file UUID) so the tmux socket sun_path (~107 bytes —
  // the current probe socket path ≈52 chars, one short layer keeps it well under) never blows the
  // bound. Every producer inherits it from the child env, INCLUDING worktree runs (the same env
  // flow — a worktree full-suite run passes --root <worktree>, not a different spawn path).
  const shortRunId = runId.replace(/-/g, "").slice(0, 8);

  // gap-leak-residue-per-run-namespace-isolation AC2/AC3 — RUNNER-LEVEL UNIFIED CLEANUP runs
  // BEFORE the suite starts (and hence before the suite-tail leak-scan — the 次序 constraint):
  // remove every stale /tmp/quay-run-* namespace whose owner is DEAD (PATH-OWNERSHIP +
  // OWNER-LIVENESS via sweepRunNamespaces→dirHasLiveOwner, NEVER a name-based batch kill —
  // invariant no_pkill_by_name_on_live = 1). This is the orphan-accumulation guard (the
  // 4375-leftover-dirs class): the leak-scan later scans ONLY this run's fresh subtree, so
  // prior-run residue is neither misattributed (AC4 cross-run invisible) nor accumulated. The
  // count is carried into the verification-round record (AC3 — the leak is an observable metric,
  // never a silently-cleared signal). Best-effort — a cleanup failure must never fail the run.
  let preCleaned: { cleaned: number; dirs: string[] } = { cleaned: 0, dirs: [] };
  try {
    preCleaned = sweepRunNamespaces();
    if (preCleaned.cleaned > 0) {
      process.stderr.write(
        `full-suite-runner: pre-suite cleanup removed ${preCleaned.cleaned} stale /tmp/quay-run-* namespace(s) (owner-dead residue)\n`,
      );
    }
  } catch (e) {
    process.stderr.write(`full-suite-runner: pre-suite cleanup failed (continuing): ${e instanceof Error ? e.message : String(e)}\n`);
  }
  // TRUE-CATCH-ALL (gap-session-liveness-teardown-ol-scd-cf-leak): kill still-alive registered
  // servers whose OWNING TEST PROCESS is dead (a prior run's crashed-process residue — the durable
  // registry survives the crash, the in-memory Set did not). sweepRunNamespaces above skips live-owner
  // dirs by design, so THIS registry-driven kill (PID-targeted SIGKILL of servers the tests
  // self-built — invariant no_pkill_by_name_on_live = 1) is the step that actually reclaims them.
  // deadProcOnly protects a concurrent scoped run's ACTIVE servers (proc alive); the full-suite lock
  // serializes full suites, so no concurrent full suite is at risk. Best-effort.
  try {
    const killedResidue = killRegisteredServers({ deadProcOnly: true });
    if (killedResidue.length > 0) {
      process.stderr.write(
        `full-suite-runner: pre-suite registry kill removed ${killedResidue.length} crashed-process server residue(s)\n`,
      );
    }
  } catch (e) {
    process.stderr.write(`full-suite-runner: pre-suite registry kill failed (continuing): ${e instanceof Error ? e.message : String(e)}\n`);
  }
  // gap-worktree-remove-orphans-probes (option ② reaper): reap ALREADY-orphaned process residue —
  // claude-probe test fixtures whose cwd points at a DELETED worktree (a previous `git worktree
  // remove` ran before the test's own cleanup), and stale full-suite.lock holders (a detached suite
  // whose worktree was removed without stopping it). A cwd pointing at a DELETED directory is the
  // orphan signature — no owner — so this is NOT a name-based batch kill of live processes (the
  // no_pkill_by_name_on_live invariant holds: a live observer / legit running suite has a LIVE cwd).
  // The suite starts with a clean process slate (its own claude-process-count measurements aren't
  // polluted by residue). Best-effort — a reap failure must never fail the run.
  // Hermetic seam (QUAY_TEST_SKIP_PRE_SUITE_REAPER=1): skip the GLOBAL orphan-probe sweep under
  // hermetic tests (fake-suite runner tests, same pattern as QUAY_TEST_SKIP_RESOURCE_GATE /
  // QUAY_TEST_SKIP_SYSTEMD_RUN). The sweep is a system-wide side effect — it kills ANY claude-probe
  // with a deleted cwd — which races with a CONCURRENT test that relies on its own live orphan probe
  // (2026-08-17, fan-in scoped gate: full-suite-runner.test.mjs + worktree-process-reaper.test.mjs
  // run in parallel and the sweep killed the reaper test's probe mid-assertion → found:0 flake).
  // Fake-suite hermetic tests measure no claude-process-count, so the sweep is pure hazard there;
  // the production path (no env) is unchanged.
  if (process.env.QUAY_TEST_SKIP_PRE_SUITE_REAPER !== "1") {
    try {
      execFileSync("node", ["--no-warnings", "--experimental-strip-types", path.join(__dirname, "worktree-process-reaper.ts"), "--orphans", "--root", root, "--json"], { stdio: "ignore" });
    } catch (e) {
      process.stderr.write(`full-suite-runner: pre-suite orphan-probe reap failed (continuing): ${e instanceof Error ? e.message : String(e)}\n`);
    }
  }
  // Ensure this run's namespace exists so the suite-tail leak-scan's before-run snapshot has a
  // stable subtree to scan (empty at start; the session-liveness probes create under it).
  try {
    fs.mkdirSync(path.join(os.tmpdir(), `quay-run-${shortRunId}`), { recursive: true });
  } catch { /* best-effort */ }

  // ── gap-verification-round-in-one-shot-worktree: provision the one-shot verify worktree ──────────
  // The verification round must NOT run on the mutable main checkout (AC2). After the resource gate
  // passes (a gate-WAIT must not provision a worktree it never runs in), fork a fresh DETACHED
  // worktree at the main HEAD — the tested tree is physically the worktree, so main-checkout edits
  // and concurrent writers cannot touch it (守卫覆盖缺口 + verifiedCommit 假证书 both disappear), and
  // package-lock/install rewrites hit the ephemeral copy (自造脏 disappears). provisioning reuses
  // provision-verify-worktree.sh — its FIRST production caller (built + tested, 0 non-test callers).
  // The teardown (teardownOneShotWorktree → provision-verify-worktree.sh --teardown) runs on the
  // normal, catchable-crash, and signal paths; an uncatchable SIGKILL leaks the worktree for
  // worktree-branch-hygiene-check.sh to reclaim (the task's ④ 现成地基).
  if (oneShot && !isGitWorktree(root)) {
    process.stderr.write("full-suite-runner: provisioning one-shot verify worktree (config C NODE_COMPILE_CACHE)...\n");
    try {
      oneShotWorktreePath = provisionOneShotWorktree(root);
      root = oneShotWorktreePath;
    } catch (e) {
      // A provisioning failure is an ENVIRONMENT problem (NO correctness conclusion) — write
      // state=red reason=aborted and exit non-zero; NEVER fall back to running the suite on the main
      // checkout (that is exactly the shared-tree class this task removes).
      const at = new Date().toISOString();
      writeState(stateFile, {
        state: "red",
        reason: "aborted",
        runner,
        startedAt: at,
        laneCount,
        scope: "main",
        runId,
        finishedAt: toEpochSeconds(at),
        durationMs: 0,
      });
      process.stderr.write(
        `full-suite-runner: one-shot worktree provisioning FAILED -> state=red reason=aborted (environment problem)\n  ${e instanceof Error ? e.message : String(e)}\n`,
      );
      return 1;
    }
    process.stderr.write(`full-suite-runner: running suite in one-shot worktree ${oneShotWorktreePath}\n`);
  }
  // Teardown — closes the one-shot worktree (complete reclaim: sessions + git worktree remove +
  // rm -rf). No-op when no worktree was provisioned. Best-effort (never fails the verdict).
  const teardownOneShot = (): void => {
    if (oneShotWorktreePath) {
      teardownOneShotWorktree(mainRoot, oneShotWorktreePath);
      oneShotWorktreePath = null;
    }
  };

  // gap-precommit-guard-blocks-commits-not-working-tree-edits AC1 — ASSERTION-SURFACE SNAPSHOT at round
  // START, over the TESTED tree (the checkout the running round reads — AFTER one-shot provisioning, so
  // an isolated round snapshots the frozen worktree, and a non-isolated round snapshots the tree the
  // round actually reads). Compared at round end to DETECT a mid-round edit to a file the round read.
  // Best-effort: a resolution/read failure degrades to an empty snapshot (no detection possible, never
  // fails the round).
  const assertionSnapshot = snapshotAssertionSurface(root);

  // gap-verifiedcommit-dirty-tree-false-certificate AC1/AC2 — the TESTED tree's state at round START:
  // dirty flag (incl. untracked) + tested-content tree hash (tracked part). Computed AFTER one-shot
  // provisioning so an isolated round measures the FROZEN worktree (clean = HEAD tree ⇒ the round's
  // verifiedCommit is a TRUE certificate by construction) and a non-isolated round measures the tree
  // it actually reads (dirty ⇒ verifiedCommit is a FALSE CERTIFICATE — round-90/4a3fc0be shape).
  // Non-git hermetic roots omit both fields (like verifiedCommit). The dirty flag is an ANNOTATION
  // (AC1: 脏 ⇒ verifiedCommit 不声明「已验证」), never a green/red criterion on its own — the
  // certificate-voiding consequence is reserved for AC5's treeMutatedMidRound.
  const treeState = readTreeState(root);

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
    // gap-runner-field-hardcoded-outer-not-measurement — runner 现在取真值（--runner 旗标或 scope
    // 派生），state 与 verification-round 共用此值。⚠️ 它仍是层身份标注，不代表执行形态；
    // 执行形态取证面是 launch tool_use 的 transcript 文件类别（见 suite-execution-form-counter.ts）。
    runner,
    startedAt,
    laneCount,
    scope,
    runId,
    ...(verifiedCommit ? { verifiedCommit } : {}),
    // gap-verifiedcommit-dirty-tree-false-certificate AC1/AC2 — the tested tree's round-start state
    // (dirty flag incl. untracked + tested-content tree hash). Carried on EVERY state write (running
    // included) so suite-state-trigger's SUITE-RUNNING event and any state reader can see at a glance
    // whether the round's verifiedCommit is a false certificate. Git roots only (same conditional as
    // verifiedCommit).
    ...(treeState ? { treeDirty: treeState.treeDirty, tree: treeState.tree } : {}),
    // gap-verification-round-in-one-shot-worktree — the round ran in a one-shot worktree (the tested
    // tree physically != the mutable main checkout). scope stays "main" (it IS the main verification
    // signal the inner waits for); this field names the ISOLATION the round actually used so a reader
    // can distinguish "main round, physically isolated worktree" from a deferrable worktree-scoped run.
    ...(oneShotWorktreePath ? { oneShotWorktree: true } : {}),
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

  // ── gap-test-detail-load-timeseries — per-run system-load sampler (start/stop) ─────────────────────
  // The sampler records loadavg/cpu_stall/mem_avail every N seconds into <state-dir>/suite-load-
  // <runId>.jsonl while THIS round runs, then STOPS. Its stop is STATE-DRIVEN (it polls the state
  // file and exits when state leaves "running" or a newer run owns the generation), so it can never
  // outlive the suite on ANY terminal path — green/red/aborted/signal/crash all write a terminal
  // state. stopLoadSampler below is only the normal-path fast-stop (no up-to-N-second tail). The
  // lightweight hermetic controls (--fail-fast-check / --static-check-check / --wait-check) run no
  // real suite, so they spawn no sampler. Best-effort — a sampler failure must never fail the run.
  const isLightweightControl =
    argv.includes("--fail-fast-check") || argv.includes("--static-check-check") || argv.includes("--wait-check");
  let loadSampler: ReturnType<typeof spawn> | null = null;
  const startLoadSampler = (): void => {
    if (isLightweightControl) return;
    const intervalArg = Number(process.env.QUAY_SUITE_LOAD_SAMPLER_INTERVAL ?? "5");
    const interval = Number.isFinite(intervalArg) && intervalArg > 0 ? intervalArg : 5;
    const outFile = path.join(stateDir, `suite-load-${runId}.jsonl`);
    try {
      const child = spawn(
        process.execPath,
        [
          "--no-warnings",
          "--experimental-strip-types",
          path.join(__dirname, "suite-load-sampler.ts"),
          "--state-file",
          stateFile,
          "--out-file",
          outFile,
          "--run-id",
          runId,
          "--interval",
          String(interval),
        ],
        { stdio: "ignore", detached: true },
      );
      child.unref();
      loadSampler = child;
    } catch (e) {
      process.stderr.write(`full-suite-runner: load sampler spawn failed (continuing): ${e instanceof Error ? e.message : String(e)}\n`);
    }
  };
  const stopLoadSampler = (): void => {
    if (loadSampler && loadSampler.pid) {
      try {
        process.kill(loadSampler.pid, "SIGTERM");
      } catch {
        // already exited — the state-driven stop beat us here
      }
    }
    loadSampler = null;
  };
  startLoadSampler();

  // gap-phase-boundary-differential-accounting — the per-phase differential accumulator. Declared
  // HERE (before the crash trap below so the trap can write the phase records) and initialized right
  // after the child spawns. `lanes` per phase = the concurrency that phase actually ran at (serial
  // and lowconc have their OWN phase concurrency; the static/end/gap phases are serial ⇒ 1).
  let phaseAccount: PhaseDifferentialAccounting | null = null;
  const phaseLanes = (phase: string): number => {
    switch (phase) {
      case "serial":
        return serialConcurrency;
      case "lowconc":
        return lowconcConcurrency;
      case "main":
        return laneCount;
      default:
        return 1;
    }
  };

  // AC6 (gap-full-suite-state-red-no-failure-detail-static-check-invisible) — in-process crash
  // terminal state: an uncaught exception / unhandled rejection must NOT leave state=running on disk
  // forever (consumers would keep thinking the suite is in flight while the runner is dead). These
  // handlers write a terminal state=red reason=crashed BEFORE exiting. SIGKILL cannot be caught
  // in-process — that path is covered by suite-state-trigger's runOnce crash-watchdog (PID-liveness
  // check, next read). The handlers are removed right after the normal terminal verdict write so a
  // late error in post-verdict teardown can never overwrite the correct green/red with a spurious
  // crashed.
  // gap-phase-boundary-differential-accounting — the trap ALSO lands the phase accounting: a crash
  // mid-round must not lose the per-phase differential records accumulated so far (trap/finally
  // 写入 — abort/早退/红轮都有账). The crashed state carries the phases and a best-effort phase-only
  // verification-round row is appended (the normal appendVerificationRound never runs on this path).
  const writeCrashTerminal = (err: unknown) => {
    const at = new Date().toISOString();
    process.stderr.write(
      `full-suite-runner: uncaught ${err instanceof Error ? err.message : String(err)} -> state=red reason=crashed (runner died mid-run)\n`,
    );
    const crashedPhases = phaseAccount ? phaseAccount.records : [];
    try {
      writeSuiteState({
        state: "red",
        reason: "crashed",
        ...base,
        finishedAt: toEpochSeconds(at),
        durationMs: Date.parse(at) - Date.parse(startedAt),
        ...(crashedPhases.length > 0 ? { phases: crashedPhases } : {}),
      });
    } catch {
      // best-effort — never mask the original crash with a write failure
    }
    // The crash path bypasses appendVerificationRound (the normal round-record write) — append a
    // best-effort phase-carrying round row so an abort/crash round still has accounting in the
    // verification-round.jsonl sequence (fixes the inherited cpu_time_s-missing bias on red rounds).
    if (phaseAccount) {
      try {
        appendVerificationRound(stateDir, {
          round: 0, // computed from prior line count inside appendVerificationRound
          startedAt,
          durationMs: Date.parse(at) - Date.parse(startedAt),
          laneCount,
          pass: 0,
          fail: 0,
          cancelled: 0,
          tests: 0,
          load: readLoadAvg(),
          state: "red",
          reason: "crashed",
          runner: base.runner,
          scope,
          phases: phaseAccount.records,
          ...(phaseAccount.read_error ? { phase_counter_error: phaseAccount.read_error } : {}),
        });
      } catch {
        // best-effort — never mask the original crash with a ledger write failure
      }
    }
    // gap-verification-round-in-one-shot-worktree — close the one-shot worktree on a catchable crash
    // (an uncatchable SIGKILL leaks it for worktree-branch-hygiene-check.sh to reclaim).
    teardownOneShot();
    process.exit(1);
  };
  process.once("uncaughtException", writeCrashTerminal);
  process.once("unhandledRejection", writeCrashTerminal);
  // Test seam (hermetic, never set in production): throw an uncaught exception shortly after the
  // `running` write so the AC6 in-process crash-terminal path is exercised deterministically (the
  // handler above must write state=red reason=crashed before the process dies). The value is the
  // delay in ms (default 30); a longer delay lets a phase-boundary test crash AFTER the stream
  // markers have been processed, so the crash trap's `phases` write is exercised non-vacuously.
  if (process.env.QUAY_TEST_CRASH_AFTER_RUNNING !== undefined) {
    const delayMs = Number(process.env.QUAY_TEST_CRASH_AFTER_RUNNING);
    const crashDelay = Number.isFinite(delayMs) && delayMs > 0 ? delayMs : 30;
    setTimeout(() => {
      throw new Error("QUAY_TEST_CRASH_AFTER_RUNNING");
    }, crashDelay);
  }

  // gap-resource-gate-no-single-flight-lock-two-suite-overlap → gap-single-flight-lock-2-slot-concurrent-
  // suites: the SINGLE-FLIGHT mutual exclusion is enforced inside scripts/test.sh's full-suite default
  // path (`full_suite_lock_acquire` on a 2-slot flock over <git-common-dir>/full-suite.lock.0/.1, held
  // for the whole run) — up to QUAY_MAX_CONCURRENT_SUITES concurrent full suites run, a further one
  // WAITs/queues instead of over-running. The runner does NOT take its own lock: it spawns test.sh,
  // which serializes the actual node --test workers. This runner's gate check (above) prevents "starting
  // into a busy machine"; the spawned test.sh's 2-slot flock prevents "a third suite joining".
  // gap-systemd-run-limits-for-suite-and-heavy-ops — spawn the suite inside the cgroup scope when
  // available (otherwise the exact same bash -c <command> as before). systemd-run --scope runs the
  // command synchronously in the foreground and propagates its exit code, so the close-event /
  // signal / exit-code handling below is byte-for-behavior identical.
  // gap-lanes-nproc-concurrent-suites-accounting AC1 — capture the round's concurrency variables AT
  // ROUND START (the same point the state writes its verifiedCommit/tree snapshot), AFTER one-shot
  // worktree provisioning. nproc = host parallelism (read-host, never a literal);
  // concurrentSuiteSlots = the configured QUAY_MAX_CONCURRENT_SUITES; concurrentSuitesRunning = the
  // ACTUAL number of full-suite runner processes alive right now (gap-verification-round-observability-
  // holes AC3 — an INDEPENDENT read, countRunnerProcesses(), NOT the lock-slot probe: the slot probe
  // WAS the broken mechanism (one pid double-holding two slots ⇒ the count read ≤S forever and never
  // saw the real 4-suite overlap). NOT capped at the slot count — 可记录 >2.
  const roundNproc = hostParallelism();
  const roundConcurrentSuiteSlots = concurrentSuiteSlots();
  const roundConcurrentSuitesRunning = countRunnerProcesses();

  // gap-verification-round-load-fields-from-systemd — THIS round's cgroup scope unit, captured at
  // round START into the round's OWN record (trap 1 — NOT read back from the shared single-slot
  // suite-cgroup-evidence.txt at teardown; that file is overwritten every round, so re-reading it is
  // the shadow-copy-drift shape). Set by the fire-and-forget below on the real full-suite path, or by
  // the QUAY_TEST_SCOPE_UNIT hermetic seam when a test injects one.
  let roundScopeUnit: string | null = null;
  let child: import("node:child_process").ChildProcess;
  // gap-verification-round-in-one-shot-worktree config C — the one-shot worktree REUSES the main
  // repo's warm NODE_COMPILE_CACHE (test.sh honors a user-supplied NODE_COMPILE_CACHE verbatim —
  // scripts/test.sh:183). Without this the fresh worktree starts with an EMPTY cache every round
  // (~30-40% of compile cost — the task's measured compile-cache scaling). Only set on the one-shot
  // path: a main-checkout run already defaults to <repo_root>/.quay/node-compile-cache itself.
  const suiteEnv = {
    ...process.env,
    ...phaseConcurrencyEnv,
    ...(oneShotWorktreePath
      ? { NODE_COMPILE_CACHE: path.join(mainRoot, ".quay", "node-compile-cache") }
      : {}),
    // gap-leak-residue-per-run-namespace-isolation: per-run namespace — the suite's probe tmp root
    // becomes /tmp/quay-run-<runId>/ (delivered via env so WORKTREE runs also get it; attribution
    // across runs stays separated). Folded into suiteEnv so the one-shot-worktree env decoupling and
    // the per-run delivery compose rather than conflict.
    QUAY_RUN_ID: shortRunId,
    // gap-gitignored-carriers-absent-in-verify-worktree — the MAIN CHECKOUT path, fed to the suite so
    // test.sh can point the .quay/-carrier-dependent discipline checkers (fan-in-workflow-check,
    // fan-in-ff-protocol-check, direct-to-develop-bypass-check) at the MAIN repo's gitignored runtime
    // carriers (fan-in-merge-lock-events.jsonl etc.). In a one-shot verify worktree the carriers are
    // structurally ABSENT from the worktree (gitignored ⇒ not copied by git worktree add), so the
    // checkers were constant-green NOT-EVALUATED every round while their input did not exist. mainRoot
    // is the fork source (root before one-shot provisioning reassigns root to the worktree), so on a
    // main-checkout run QUAY_MAIN_CHECKOUT == repo_root and the checkers behave exactly as before
    // (no main regression, AC2); on a one-shot round it is the real main checkout and the worktree
    // round's checkers read the SAME data as a main run ⇒ verdicts are identical (AC3).
    QUAY_MAIN_CHECKOUT: mainRoot,
  };
  if (useSystemdRun) {
    const sdArgv = buildSystemdRunArgv(command, systemdLimits);
    process.stderr.write(
      `full-suite-runner: wrapping suite in systemd-run scope (MemoryMax=${systemdLimits.memoryMax} CPUQuota=${systemdLimits.cpuQuota} TasksMax=${systemdLimits.tasksMax})\n`,
    );
    child = spawn(sdArgv[0], sdArgv.slice(1), {
      cwd: root,
      stdio: ["ignore", "pipe", "pipe"],
      env: suiteEnv,
      // detached: the suite child becomes a process-group leader so killChildTree() can terminate
      // the WHOLE tree (test.sh + its node --test children) — a hung subprocess can't leak the flock.
      detached: true,
    });
    // AC1 evidence — fire-and-forget: find the scope unit, capture it into THIS round's record, and
    // dump its applied cgroup properties to <state-dir>/suite-cgroup-evidence.txt (best-effort; never
    // fails the run). `roundScopeUnit` is set as a side effect so the round-record write at the end
    // reads THIS round's unit from memory, never the shared file (trap 1).
    const evidenceStateDir = stateDir;
    const evidenceLimits = systemdLimits;
    void (async () => {
      const unit = await findSuiteScopeUnit(child.pid);
      roundScopeUnit = unit;
      if (unit) recordSystemdRunEvidence(evidenceStateDir, unit, evidenceLimits);
    })();
  } else {
    child = spawn("bash", ["-c", command], {
      cwd: root,
      stdio: ["ignore", "pipe", "pipe"],
      env: suiteEnv,
      // detached: same as the systemd-run spawn — process-group leader for killChildTree().
      detached: true,
    });
  }
  // Hermetic seam — QUAY_TEST_SCOPE_UNIT injects the round's scope unit WITHOUT a real systemd scope
  // (deterministic round-record tests for trap 1/2/3). Only applied when the real capture above has
  // NOT set one (a real systemd run never has this env set, and a seam test never enters the
  // useSystemdRun branch — the two are mutually exclusive).
  if (!roundScopeUnit) roundScopeUnit = process.env.QUAY_TEST_SCOPE_UNIT ?? null;

  // gap-phase-boundary-differential-accounting — initialize the per-phase differential accumulator
  // with the SUITE CHILD's pid (the counter source: the child's cgroup accumulates the phase CPU).
  // `static` is the first phase (baseline → first phase-start marker). This is the ONE accumulator
  // for the whole run — its records ride the verification-round row at the end AND the crash trap.
  phaseAccount = new PhaseDifferentialAccounting(child.pid, phaseLanes);
  phaseAccount.init("static");

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
  // gap-static-check-red-failures-capture-only-task-contract-shape — the FAIL-CLOSED checkers
  // (`STATIC_CHECK_FAILED: <name> exit=<rc>` lines) — the round-84 真因 a task-contract-shape-only
  // capture could not see. Accumulated on every line alongside staticCheckDetails; failures[] +
  // staticCheck.failedCheckers carry them on a static-check red (AC1/AC2).
  const failClosedCheckers: FailClosedChecker[] = [];
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
  // gap-concurrent-write-mutable-tree-false-positive-red — PROVISIONAL tree-mutation annotation at
  // EARLY-red time (memoized): the FIRST red write fires the SUITE-RED event, so it must carry the
  // concurrent-write FP-candidate annotation for the event to show it (the terminal write later
  // carries the definitive full-window comparison). Computed ONCE (a `git rev-parse` per failure
  // line would be wasteful — up to MAX_RECORDED_FAILURES writes); HEAD only advances within a round,
  // so the memo never goes stale. A non-git hermetic root yields {} (no annotation, byte-stable).
  let redMutation: { terminalCommit?: string; treeMutatedMidRound?: boolean } | null = null;
  const readRedMutation = (): { terminalCommit?: string; treeMutatedMidRound?: boolean } => {
    if (redMutation === null) {
      const m = readTreeMutation(root, verifiedCommit);
      redMutation = verifiedCommit !== undefined && m.terminalCommit !== undefined ? m : {};
    }
    return redMutation;
  };
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
    // gap-verification-round-in-one-shot-worktree — close the one-shot worktree before exiting so a
    // signal-aborted round does not strand it.
    teardownOneShot();
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
  // gap-suite-round-pass-fail-cancel-parser-breaks-under-force-color-ansi — host FORCE_COLOR=3
  // (also COLORTERM=truecolor) forces node:test's spec reporter to emit ANSI color EVEN when its
  // stdout is redirected to a file ⇒ the summary line arrives as `\x1b[34mℹ pass N\x1b[39m` (ESC at
  // line start) and the `^[#ℹ]` summary regexes below never match (pass/fail/cancelled/tests all
  // record 0 — the #684/#685 regression). Strip ANSI CSI before matching (the same ANSI_CSI_RE
  // pane-state-classify.ts uses) so colorized AND plain summary lines both parse. The stripped
  // `summaryLine` feeds EVERY `^[#ℹ]` summary regex in onLine — the pass/fail/cancelled tallies
  // below AND the testsSeen/cancelledSeen parses further down (same family, same file — 5b).
  const ANSI_CSI_RE = /\x1B\[[0-9;]*[A-Za-z]/g;
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
  // gap-test-detail-perfile-duration-failed AC1 — accumulate the reporter's raw
  // `__PERFILE__ duration_ms=<dur> <path> passed=<bool>` lines (stream-accumulation family, same as
  // ceilingFiles) so the round record can carry the perFile array. Raw lines are buffered and parsed
  // at finalize by parsePerFileLines (the measure-history parser) — NO regex re-implemented here
  // (drift-free: the two carriers share one parser + one normalizePerFileKey).
  const perFileLines: string[] = [];

  // gap-ac124-suite-bucket-production-carrier-benefit — the __BUCKETS__ marker test.sh emits on a
  // bucket-selected run (buckets=<P|M|P+M|full> files=<n> full=<0|1>). Only a bucket-mode run emits it
  // (the default full suite does not), so a round without the marker omits the bucket fields — the
  // same absent-field contract as the *_phase_ms fields (a reader must tolerate their absence).
  let bucketLabel: string | null = null;
  let bucketFiles: number | null = null;

  // gap-phase-boundary-differential-accounting — REAL-TIME phase-boundary detection (the runner
  // reads the monotonic cumulative counters at each boundary and records the phase that JUST
  // completed — one record per phase). The boundaries are detected from the stream markers test.sh
  // emits AT phase edges (no test.sh change needed — the reporter already emits them):
  //   - `selected N files (groups=serial)` / `overlap: running …` ⇒ static→serial boundary
  //   - `selected N files (groups=lowconc)`                       ⇒ (gap→)lowconc boundary
  //   - measure-suite-reporter `__GROUP__ …` (ONE per node --test run, AT ITS END) ⇒ that phase's
  //     node --test finished: serial→gap_serial_to_lowconc, lowconc→main, main→end
  //   - `__OVERHEAD__` burst (right after main) ⇒ main→end FALLBACK (a no-__GROUP__ reporter variant)
  //   - PHASE_OVERLAP (gap-verification-round-phases-overlap-merged): serial+lowconc run in
  //     PARALLEL, so their __GROUP__ lines interleave and cannot be attributed to one or the other.
  //     test.sh emits `__OVERHEAD__ overlap_<phase>_done=1` right after EACH `wait`; the combined
  //     window closes (→main) only when BOTH have fired, and `overlap_<phase>_ms=N` sub-times ride
  //     the window record as overlap_sub_ms. Sequence: static → serial(window) → main → end.
  // The record sequence is static → serial → gap_serial_to_lowconc → lowconc → main → end. A child
  // that never emits any marker stays "static" and finalize() records the WHOLE round as one static
  // phase ⇒ every spawned round gets ≥1 phase record (AC4 coverage 100%, incl. red/abort rounds).
  let phaseNodeActive = false; // a phase's node --test is the current stream producer (its __GROUP__ closes it)
  let overlapPhaseActive = false; // the QUAY_PHASE_OVERLAP combined serial+lowconc window is active
  // gap-phase-overlap-field-always-false-negative — LATCHED (never reset): the suite ACTUALLY ran
  // the overlap scheduling. Unlike overlapPhaseActive (a transient window state that resets to false
  // when the window closes), this latches true the moment test.sh emits `overlap: running` and stays
  // true through finalize() so the round record's phase_overlap field reflects what REALLY ran — not
  // the runner's own process.env.QUAY_PHASE_OVERLAP, which the production chain (fan-in-execute.js)
  // never sets (the env knob defaults to 1 only INSIDE test.sh, invisible to this parent process).
  let phaseOverlapRan = false;
  let mainClosed = false; // the main→end boundary already fired
  // gap-verification-round-phases-overlap-merged — on the overlap path test.sh emits
  // `__OVERHEAD__ overlap_<phase>_done=1` right after EACH parallel phase's `wait`. The window
  // closes only when BOTH have fired (then main starts); per-process sub-times (`overlap_<phase>_ms`)
  // ride the window record as overlap_sub_ms so serial/lowconc stay distinguishable.
  let overlapSerialDone = false;
  let overlapLowconcDone = false;
  const phaseMarkerSerialStart = /^selected \d+ files?\s+\(groups=serial\)/;
  const phaseMarkerLowconcStart = /^selected \d+ files?\s+\(groups=lowconc\)/;
  const phaseMarkerOverlap = /^overlap:\s+running/;
  const phaseGroupEnd = /^__GROUP__\s+/;
  const phaseOverheadBurst = /^__OVERHEAD__\s+/;
  const phaseOverlapSubMs = /^__OVERHEAD__\s+overlap_(?:serial|lowconc)_ms=\d+/;
  const phaseOverlapSerialDone = /^__OVERHEAD__\s+overlap_serial_done=1/;
  const phaseOverlapLowconcDone = /^__OVERHEAD__\s+overlap_lowconc_done=1/;
  const phaseOverlapDone = /^__OVERHEAD__\s+overlap_(?:serial|lowconc)_done=1/;

  // gap-verification-round-observability-holes AC1 — `lock_wait_ms` = the flock-wait the suite paid
  // before it acquired one of the S single-flight slots. The runner does NOT take the lock itself (it
  // spawns test.sh, which serializes the node --test workers); the two timestamps are test.sh's own
  // stream markers — `== single-flight lock …` (the acquire START, emitted BEFORE the `flock -n` try)
  // and `scripts/test.sh: acquired full-suite single-flight slot …` (the acquire END). The diff is the
  // flock wait: ~0 when a slot was free (the non-blocking try is µs), and the bounded `flock -w 1` wait
  // when all S slots were held. This is the value the pre-fix gap (r253 wall=1825s phases=952s
  // gap=873s=48% — a suite that WAITED on the lock looked like a slow suite) could not attribute.
  // Absent on scoped runs (no lock taken) and on lock-timeout aborts (no `acquired` marker — the round
  // is `reason=aborted`, and `waited <N>s` rides the abort line instead).
  let lockWaitStartMs: number | null = null;
  let lockWaitMs: number | null = null;
  const lockAcquireStartRe = /^== single-flight lock\b/;
  const lockAcquiredRe = /^scripts\/test\.sh: acquired full-suite single-flight slot\b/;

  const onLine = (line: string) => {
    logStream.write(line + "\n");
    // Keep the last non-empty stream line for the fail-closed catch-all synthesis (AC1).
    if (line.trim()) lastStreamLine = line;
    // gap-verification-round-observability-holes AC1 — time the flock wait from test.sh's own
    // lock-acquire markers. First marker wins; the acquired marker closes it. Independent of the
    // phase/verdict machinery below (pure addition — it cannot flip the verdict).
    if (lockWaitStartMs === null && lockAcquireStartRe.test(line)) {
      lockWaitStartMs = Date.now();
    } else if (lockWaitStartMs !== null && lockWaitMs === null && lockAcquiredRe.test(line)) {
      lockWaitMs = Math.max(0, Date.now() - lockWaitStartMs);
    }
    // gap-phase-boundary-differential-accounting — the phase-boundary state machine (reads the
    // cumulative counters at each boundary and records the completed phase). Pure addition: it
    // cannot flip the verdict, and a boundary-detection failure only affects the `phases` field.
    if (phaseAccount) {
      if (phaseMarkerSerialStart.test(line)) {
        // static→serial (sequential path). Closes whatever phase was open (static, or a gap if the
        // previous phase's __GROUP__ already fired) and opens serial.
        phaseAccount.boundary("serial");
        phaseNodeActive = true;
        overlapPhaseActive = false;
      } else if (phaseMarkerOverlap.test(line)) {
        // static→ the combined serial+lowconc window (QUAY_PHASE_OVERLAP). The window's per-process
        // __GROUP__ lines are NOT boundaries (the other process is still running); it closes when
        // BOTH of test.sh's `overlap_<phase>_done=1` markers have fired (gap-verification-round-
        // phases-overlap-merged), falling back to the __OVERHEAD__ burst on a marker-less truncation.
        // test.sh itself reports lowconc_phase_ms=0 on overlap (subsumed).
        phaseAccount.boundary("serial");
        phaseNodeActive = false;
        overlapPhaseActive = true;
        phaseOverlapRan = true;
      } else if (phaseMarkerLowconcStart.test(line)) {
        // (serial or gap_serial_to_lowconc)→lowconc.
        phaseAccount.boundary("lowconc");
        phaseNodeActive = true;
      } else if (phaseOverlapSubMs.test(line)) {
        // gap-verification-round-phases-overlap-merged — the overlap sub-time markers
        // (`__OVERHEAD__ overlap_serial_ms=N` / `overlap_lowconc_ms=N`, emitted by test.sh right
        // after each parallel phase's `wait`) arrive WHILE the window is still open. They are NOT
        // the end-of-round __OVERHEAD__ burst — consume them here so the burst branch below cannot
        // fire mid-window. They are accumulated into phaseMs by the overheadM parse and attached to
        // the window record when both done-markers fire.
      } else if (phaseOverlapDone.test(line)) {
        // gap-verification-round-phases-overlap-merged — test.sh's explicit per-phase completion
        // markers on the overlap path. serial+lowconc run in PARALLEL, so the stream's __GROUP__
        // lines cannot be attributed to one or the other (they interleave); test.sh therefore emits
        // `__OVERHEAD__ overlap_<phase>_done=1` right after EACH `wait`. The combined window closes
        // only when BOTH have fired — only then does main start (the window's own __GROUP__ lines
        // remain ignored: overlapPhaseActive is still true when they arrive).
        if (overlapPhaseActive) {
          if (phaseOverlapSerialDone.test(line)) overlapSerialDone = true;
          if (phaseOverlapLowconcDone.test(line)) overlapLowconcDone = true;
          if (overlapSerialDone && overlapLowconcDone) {
            // Both parallel phases finished — close the overlap window (recorded as "serial", the
            // test.sh serial_phase_ms semantics: lowconc subsumed into the window) and open main.
            // The per-process sub-times ride overlap_sub_ms on the window record so the serial and
            // lowconc contributions stay recoverable (AC1/AC2 — 不得再合成一桶; AC3 — the partition
            // still sums to ≈ durationMs because the window is ONE wall segment).
            phaseAccount.boundary("main");
            const windowRec = phaseAccount.records[phaseAccount.records.length - 1];
            if (windowRec && windowRec.phase === "serial") {
              // The overheadM parse strips the trailing `_ms` (the greedy label backtracks to let
              // `_ms=` match), so `overlap_serial_ms=N` lands in phaseMs as `overlap_serial`.
              const sMs = phaseMs.overlap_serial;
              const lMs = phaseMs.overlap_lowconc;
              if (typeof sMs === "number" || typeof lMs === "number") {
                windowRec.overlap_sub_ms = {
                  ...(typeof sMs === "number" ? { serial_ms: sMs } : {}),
                  ...(typeof lMs === "number" ? { lowconc_ms: lMs } : {}),
                };
              }
            }
            overlapPhaseActive = false;
            overlapSerialDone = false;
            overlapLowconcDone = false;
          }
        }
      } else if (phaseGroupEnd.test(line)) {
        if (overlapPhaseActive) {
          // serial+lowconc run in parallel — each emits its own __GROUP__; do NOT close the combined
          // window on the first one (the other is still running). It closes at the __OVERHEAD__ burst.
        } else if (phaseNodeActive) {
          // A phase's node --test just finished: serial→gap, lowconc→main.
          if (phaseAccount.phase === "serial") {
            phaseAccount.boundary("gap_serial_to_lowconc");
          } else if (phaseAccount.phase === "lowconc") {
            phaseAccount.boundary("main");
          }
          phaseNodeActive = false;
        } else if (phaseAccount.phase === "main") {
          // main's own __GROUP__ (phaseNodeActive is false during main) ⇒ main→end.
          phaseAccount.boundary("end");
          mainClosed = true;
        } else if (phaseAccount.phase === "lowconc") {
          // A __GROUP__ fired for lowconc but phaseNodeActive was already false (e.g. the start
          // marker was missed) — close lowconc→main.
          phaseAccount.boundary("main");
        } else if (phaseAccount.phase === "gap_serial_to_lowconc") {
          // LOWCONC IS EMPTY (its start marker never fired): this __GROUP__ is MAIN's. The gap
          // record opened at serial's __GROUP__ actually spans the MAIN interval — repair it to
          // "main" (its wall/cpu ARE main's) and close main→end.
          phaseAccount.replacePhase("main");
          phaseAccount.boundary("end");
          mainClosed = true;
        }
      } else if (phaseOverheadBurst.test(line) && !mainClosed) {
        // The __OVERHEAD__ burst fires right after main completes. On the sequential path this is
        // the main→end FALLBACK (a reporter variant that emitted no __GROUP__); on the overlap path
        // it closes the combined serial+lowconc window.
        if (overlapPhaseActive) {
          phaseAccount.boundary("end");
          overlapPhaseActive = false;
          mainClosed = true;
        } else if (phaseNodeActive && phaseAccount.phase === "lowconc") {
          // The lowconc __GROUP__ was missed — the burst is both the lowconc→main and main→end
          // boundary (approximate; the burst carries the exact wall timings for the reader).
          phaseAccount.boundary("main");
          phaseAccount.boundary("end");
          phaseNodeActive = false;
          mainClosed = true;
        } else if (phaseAccount.phase === "main") {
          phaseAccount.boundary("end");
          mainClosed = true;
        } else if (phaseAccount.phase === "lowconc") {
          phaseAccount.boundary("main");
          phaseAccount.boundary("end");
          mainClosed = true;
        } else if (phaseAccount.phase === "gap_serial_to_lowconc") {
          // LOWCONC IS EMPTY (its start marker never fired) — the gap record spans the MAIN
          // interval; repair it to "main" and close main→end.
          phaseAccount.replacePhase("main");
          phaseAccount.boundary("end");
          mainClosed = true;
        }
      }
    }
    // NOTE (# vs ℹ): test.sh's dual-reporter config (scripts/test.sh:204-207) puts node:test's
    // built-in spec reporter on stdout, which emits the info-glyph forms `ℹ pass N` / `ℹ fail N` /
    // `ℹ cancelled N` — NOT the TAP `# pass N` forms — so the old `#`-only regexes never matched
    // and verification-round.jsonl recorded tests/pass/fail=0 for every round (green AND red). Same
    // family as the testsSeen `# tests` fix (42aad5fe); accept both prefixes.
    // gap-verification-round-counter-overwrites-not-sums — ACCUMULATE (+=) instead of overwrite (=):
    // one summary block per node --test phase, and the verification-round `tests` must be the SUM
    // across the phases that actually ran, never just the last phase's block (see the AC6 decl above).
    const summaryLine = line.replace(ANSI_CSI_RE, "");
    const passM = summaryLine.match(/^[#ℹ]\s*pass\s+(\d+)/);
    if (passM) tapPass += Number(passM[1]);
    const failM = summaryLine.match(/^[#ℹ]\s*fail\s+(\d+)/);
    if (failM) tapFail += Number(failM[1]);
    const cancelledM = summaryLine.match(/^[#ℹ]\s*cancelled\s+(\d+)/);
    if (cancelledM) tapCancelled += Number(cancelledM[1]);
    // gap-verification-round-missing-phase-ms-breaks-cost-attribution AC2 — the fixed-overhead
    // phase timings (`__OVERHEAD__ <phase>_ms=N`, test.sh:909-918). Same stream-accumulation family
    // as tapPass/tapFail above (NOT a post-hoc log re-read — the logStream buffer may not be
    // flushed at append time, and the stream already carries the identical lines the log gets).
    // Allow the optional ` partial=1` suffix (test.sh's _oh_emit_p SIGTERM/EXIT partial fallback
    // emits `__OVERHEAD__ <segment>_ms=N partial=1` — the old `_ms=(\d+)$` anchor missed it and the
    // line fell through to failures[] as a false red, round 137 __OVERHEAD__ build_dist_ms=479).
    const overheadM = line.match(/^__OVERHEAD__\s+([A-Za-z0-9_]+)_ms=(\d+)(?:\s+partial=1)?$/);
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
    // gap-test-detail-perfile-duration-failed AC1 — buffer the reporter's per-file line (a REAL
    // reporter line starts column-0 with `__PERFILE__ duration_ms=…`; a PASSING test whose NAME
    // quotes the shape is ✔-prefixed and must NOT be buffered — the same ^-anchored self-match family
    // the ceiling parse above and runner-red-parse's isFailureLine both guard). The precise parse
    // (regex + normalizePerFileKey + duration>0) is parsePerFileLines' job at finalize.
    if (line.startsWith("__PERFILE__ ")) perFileLines.push(line);
    // gap-ac124-suite-bucket-production-carrier-benefit — parse test.sh's __BUCKETS__ marker
    // (bucket-selected runs only). buckets is the canonical label (P|M|P+M|full); files is the
    // selected file count. First marker wins (test.sh emits exactly one).
    if (bucketLabel === null) {
      const bucketM = line.match(/^__BUCKETS__\s+buckets=(\S+)\s+files=(\d+)\s+full=([01])/);
      if (bucketM) {
        bucketLabel = bucketM[1];
        bucketFiles = Number(bucketM[2]);
      }
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
    // gap-static-check-red-failures-capture-only-task-contract-shape — accumulate FAIL-CLOSED
    // checker lines (`STATIC_CHECK_FAILED: <name> exit=<rc>`, checker-cost-lib). A fail-closed
    // checker is the 真因 of a static-check red but emits NO VIOLATION detail line — the old
    // capture (task-contract shapes only) recorded ZERO entries for it. Accumulate on every line
    // (same as staticCheckDetails); only failure-relevant when the failure marker fires below.
    const failClosed = extractFailClosedChecker(line);
    if (failClosed) failClosedCheckers.push(failClosed);
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
          writeSuiteState({ state: "red", reason: "failed", ...base, finishedAt: null, durationMs: null, ...segmentedFailureFields(redFailures), ...readRedMutation() });
        }
      }
      if (detailRemaining <= 0) pendingFailure = null;
    }
    // AC1 — TAP summary parsing: `# tests N` / `# cancelled N` (node:test emits these on the
    // stream regardless of pass/fail). Fires on every line; a later summary overwrites an earlier
    // one (TAP prints exactly one summary, but a failing worker may print its own before the root).
    const testsMatch = /^[#ℹ]\s*tests\s+(\d+)/.exec(summaryLine);
    if (testsMatch) testsSeen = Number(testsMatch[1]);
    // test.sh prints "selected N files (groups=…)" exactly when the node --test phase starts; a
    // test-count summary (testsSeen > 0) is the TAP-side proof. Either ⇒ past the static-check
    // phase ⇒ the static-check patterns below must not fire (test fixtures can legitimately print
    // "FAIL: N violation(s)" — candidate-contracts.test.mjs's ANTI-DRIFT hard-fail fixtures).
    if (/^selected \d+ files?\b/.test(line) || testsSeen > 0) testPhaseStarted = true;
    const cancelledMatch = /^[#ℹ]\s*cancelled\s+(\d+)/.exec(summaryLine);
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
        ...segmentedFailureFields(redFailures),
        // gap-concurrent-write-mutable-tree-false-positive-red — provisional FP-candidate annotation
        // (memoized): if the tree was ALREADY mutated when the failure flipped red, the SUITE-RED
        // event carries concurrentWrite=true (the terminal write later has the definitive comparison).
        ...readRedMutation(),
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
      const staticFailures: SuiteFailure[] = buildStaticCheckFailures(staticCheckDetails, failClosedCheckers);
      writeSuiteState({
        state: "red",
        reason: "static-check",
        ...base,
        finishedAt: null,
        durationMs: null,
        // gap-concurrent-write-mutable-tree-false-positive-red — provisional FP-candidate annotation
        // (memoized), same as the test-failure early-red write.
        ...readRedMutation(),
        staticCheck: {
          violations: staticCheckViolations,
          taskCount: staticCheckTaskCount,
          ceiling: staticCheckCeiling,
          newSinceBaseline: staticCheckNewSinceBaseline,
          details: staticCheckDetails,
          // gap-static-check-red-failures-capture-only-task-contract-shape AC2 — the fail-closed
          // checkers (round-84 真因) separated from the violation `details`.
          failedCheckers: failClosedCheckers,
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

  // gap-concurrent-write-mutable-tree-false-positive-red — the DEFINITIVE start-vs-terminal HEAD
  // comparison (AC1): read the tested checkout's HEAD at TERMINAL time (the suite child has closed;
  // the verdict is about to be written) and compare with the START head (verifiedCommit). start HEAD
  // ≠ terminal HEAD ⇒ concurrent writers committed to the shared tree while the suite ran on it —
  // the round's tree was MUTATED MID-ROUND (round-53 class: 4 writers committed mid-round; the SAME
  // quay-init-loop-core test passed green the next clean window). Any red in such a round is a
  // CONCURRENT-WRITE FALSE-POSITIVE CANDIDATE (AC2), not a proven code failure on a pinned tree.
  // A non-git hermetic root omits both fields (the annotation never fabricates a commit).
  const { terminalCommit, treeMutatedMidRound } = readTreeMutation(root, verifiedCommit);
  // gap-precommit-guard-blocks-commits-not-working-tree-edits AC1 — the round-END assertion-surface
  // COMPARE: did an assertion-surface file in the TESTED tree change MID-ROUND (the running round read
  // it at two states ⇒ mixed-state verdict candidate)? The one-shot worktree isolation PREVENTS the
  // round-84 shape (a main-checkout edit physically cannot reach the frozen tested tree — the negative
  // control proves this flag stays clean under that shape); this annotation catches the residual case
  // (the suite / anything editing the TESTED tree's own assertion-surface files mid-round). Same
  // annotation semantics as treeMutatedMidRound: never a green/red criterion, red → FP-candidate,
  // green → weaker green. Empty when the snapshot is empty (non-git hermetic root / resolution failure)
  // or nothing changed.
  const assertionSurfaceEditedMidRound = detectAssertionSurfaceEdits(root, assertionSnapshot);

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
  const testsGreen =
    !redDetected && !staticCheckDetected && !abortDetected && spawnError === null &&
    (exitCode === 0 || (childKilledBySignal && testsFullyGreen));
  // gap-verifiedcommit-dirty-tree-false-certificate AC5 — a would-be-green verdict whose TESTED TREE
  // was MUTATED MID-ROUND (verifiedCommit !== terminalCommit — a concurrent writer committed to the
  // tested tree while the round ran) is a FALSE CERTIFICATE: the green measured a tree that was NOT
  // pinned to the certified commit (round-121 shape: state=green + treeMutatedMidRound=true let
  // SUITE-GREEN / SUITE-MERGE-PENDING fire for a tree that was never the certified commit's tree).
  // The annotation treeMutatedMidRound is now CONSEQUENTIAL — the state must NOT be written green.
  // Instead the round is VOIDED: state=red + reason=infra-error (an ENVIRONMENT problem — the tested
  // tree was not stable; NO correctness conclusion — this is not a test failure) + `void: true` so any
  // reader can distinguish a voided certificate from a real failure. The non-green terminal state
  // STRUCTURALLY prevents SUITE-GREEN / SUITE-MERGE-PENDING (suite-state-trigger fires them on a
  // green transition). Git roots only (treeMutatedMidRound is absent on non-git hermetic roots ⇒
  // never voided there); a REAL failure in the same round keeps its red (voiding only demotes the
  // would-be-green certificate, never the failed verdict).
  const treeMutated = treeMutatedMidRound === true;
  const voided = testsGreen && treeMutated;
  const green = testsGreen && !treeMutated;
  // No correctness conclusion (abort) iff: an abort marker was seen, OR the child was killed by a
  // signal (code null), OR it never spawned. A REAL failure conclusion (redDetected) — and now a
  // static-check conclusion (staticCheckDetected) — is never downgraded by an earlier abort marker:
  // both dominate (AC5: the failure conclusion stands). childKilledBySignal is NOT folded into this
  // "aborted" bucket — it gets its own reason=infra-error (the DIRECT child was torn down = an
  // environment problem), so a green suite with only a test-internal `__ENVFAIL__`/`Killed` stream
  // marker stays green (AC1, gap-infra-error-false-positive-from-test-internal-kill).
  const noCorrectnessConclusion =
    !redDetected && !staticCheckDetected && (abortDetected || childKilledBySignal || spawnError !== null);
  const reason: SuiteStateReason = voided
    ? "infra-error" // AC5 — a would-be-green certificate voided by a mid-round-mutated tested tree (environment problem, NO correctness conclusion)
    : redDetected
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
  // AC4 candidate B — on a static-check red, failures[] carries the violation details (task + type)
  // AND the fail-closed checkers (gap-static-check-red-failures-capture-only-task-contract-shape AC1:
  // the round-84 真因 — a checker that fail-closed has ZERO violation lines, so the old capture
  // recorded nothing about it). Each marked staticCheck:true so suite-state-trigger's classifyFailure
  // routes them to the shared gate. On a test-failure red, failures[] carries the real test failures
  // (unchanged, AC5).
  const staticCheckFailures: SuiteFailure[] = buildStaticCheckFailures(staticCheckDetails, failClosedCheckers);
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
  // gap-streaming-red-cascade-amplifies-failures-array AC1/AC2 — the failure fields for the terminal
  // write. Segmented ONLY on a TEST-failure red (redDetected): cascade entries (state-asserting test
  // files) go to `derived`, no-file entries to `unattributed` — the round-130 cascade amplification
  // (3×) is out of failures[] main. A STATIC-CHECK red (staticCheckDetected && !redDetected) keeps
  // ALL its entries in failures[] UNCHANGED: the fail-closed checker entries (round-84 真因) carry NO
  // file but are routed by their `staticCheck: true` marker to the shared gate — segmenting them out
  // would silently drop the shared-gate dispatch input (gap-static-check-red-failures-capture-only-
  // task-contract-shape's failures[] Contract).
  const failureFields = voided
    ? {} // AC5 — a voided round has NO failures (its tests passed; the certificate is void, not failed)
    : staticCheckDetected && !redDetected
      ? { failures: finalFailures }
      : segmentedFailureFields(finalFailures);
  const finalState: SuiteState = green
    ? {
        state: "green",
        ...base,
        finishedAt,
        durationMs,
        // gap-concurrent-write-mutable-tree-false-positive-red — carry the tree-mutation annotation
        // on green too: the explicit field keeps the negative control visible (treeMutatedMidRound:
        // false on a clean window). Since gap-verifiedcommit-dirty-tree-false-certificate AC5 a green
        // with treeMutatedMidRound=true is IMPOSSIBLE (a mutated-tree round is voided instead), so
        // this carry is the explicit negative control only. Git roots only (verifiedCommit defined).
        ...(verifiedCommit && terminalCommit ? { terminalCommit, treeMutatedMidRound } : {}),
        // gap-precommit-guard-blocks-commits-not-working-tree-edits — carry the assertion-surface
        // mid-round-EDIT annotation on green too: a green whose tested tree had an assertion-surface
        // file edited mid-round is a WEAKER green (the round read mixed state). Absent when clean.
        ...(assertionSurfaceEditedMidRound.length > 0 ? { assertionSurfaceEditedMidRound } : {}),
      }
    : {
        state: "red",
        reason,
        // gap-verifiedcommit-dirty-tree-false-certificate AC5 — a VOIDED certificate marker: the
        // round's tests PASSED but its tested tree was MUTATED MID-ROUND, so the state is red
        // (infra-error) instead of green. `void: true` lets any reader distinguish "this round's
        // green was voided (false certificate)" from a real test failure without re-deriving it.
        ...(voided ? { void: true } : {}),
        ...base,
        finishedAt,
        durationMs,
        // carry the failure location(s) — the SUITE-RED event's failureLocation source. Segmented
        // (gap-streaming-red-cascade-amplifies-failures-array AC1/AC2): failures[] main set carries
        // only real file-attributable non-cascade failures; cascade + no-file entries ride the
        // `derived` / `unattributed` fields instead. A static-check red keeps ALL entries in
        // failures[] (the fail-closed checkers are routed by their staticCheck marker, not a file).
        ...(spawnError === null ? failureFields : {}),
        // gap-concurrent-write-mutable-tree-false-positive-red — carry the tree-mutation annotation
        // on red: start HEAD ≠ terminal HEAD ⇒ this red is a CONCURRENT-WRITE FALSE-POSITIVE
        // CANDIDATE (round-53 class) — a signal, NOT a blanket round-discard (the failures are still
        // recorded; the attribution is annotated). Git roots only.
        ...(verifiedCommit && terminalCommit ? { terminalCommit, treeMutatedMidRound } : {}),
        // gap-precommit-guard-blocks-commits-not-working-tree-edits — carry the assertion-surface
        // mid-round-EDIT annotation on red: a red whose tested tree had an assertion-surface file
        // edited mid-round is a FALSE-POSITIVE CANDIDATE (the round read mixed state) — a signal,
        // not a blanket discard (the failures are still recorded; the attribution is annotated).
        ...(assertionSurfaceEditedMidRound.length > 0 ? { assertionSurfaceEditedMidRound } : {}),
        ...(staticCheckDetected
          ? {
              staticCheck: {
                violations: staticCheckViolations,
                taskCount: staticCheckTaskCount,
                ceiling: staticCheckCeiling,
                newSinceBaseline: staticCheckNewSinceBaseline,
                details: staticCheckDetails,
                // gap-static-check-red-failures-capture-only-task-contract-shape AC2 — the fail-closed
                // checkers (which checker failed + exit code) separated from the violation `details`.
                failedCheckers: failClosedCheckers,
              },
            }
          : {}),
      };
  writeSuiteState(finalState);
  // gap-test-detail-load-timeseries — normal-path fast-stop for the load sampler: the verdict is
  // terminal on disk, so stop sampling now rather than waiting out the sampler's next poll.
  stopLoadSampler();
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
  // gap-phase-boundary-differential-accounting — CLOSE the final phase at suite exit, BEFORE the
  // journal poll below (the poll adds a ≤5s tail that would otherwise inflate the final phase's
  // wall_ms). Runs on EVERY normal-exit path (green, red, abort, timeout, hung, static-check) so the
  // round record always carries the completed phase sequence. A child that never emitted a phase
  // marker still records its whole wall as one `static` phase — coverage is 100% for every spawned
  // round. The exit-spanning phase's cpu is backfilled from the Consumed total AFTER the poll.
  phaseAccount?.finalize();
  // gap-verification-round-load-fields-from-systemd — read THIS round's scope `Consumed` journal line
  // (bounded poll ≤5s / 200ms — the line appears ~2s AFTER the scope ends, trap 2; the runner lives
  // OUTSIDE the scope so it survives the child's exit and is eligible to poll). Best-effort: a read
  // failure yields explicit null + load_read_error (trap 3 — never 0), and never fails the verdict.
  // Runs only when roundScopeUnit was captured at round START (the real fire-and-forget or the
  // hermetic QUAY_TEST_SCOPE_UNIT seam); a non-systemd round omits the fields entirely (缺键 — same
  // contract as the *_phase_ms spreads).
  let scopeConsumedLoad: ScopeConsumedLoadRead | null = null;
  if (roundScopeUnit) {
    try {
      scopeConsumedLoad = await readScopeConsumedLoad(roundScopeUnit, startedAt);
    } catch (e) {
      scopeConsumedLoad = {
        cpu_time_s: null,
        mem_peak_mb: null,
        swap_peak_mb: null,
        load_read_error: `scope load read crashed: ${e instanceof Error ? e.message : String(e)}`,
      };
    }
  }
  // gap-phase-boundary-differential-accounting — the exit-spanning phase's cpu.usec backfill: the
  // transient scope is destroyed (finalize's read → ENOENT), so the final phase's CPU is DERIVED
  // from the authoritative Consumed total MINUS the CPU already attributed to the completed phases.
  // Only fires when the Consumed total was readable (systemd accounting on); otherwise the final
  // phase stays null (fail-open — never a fabricated 0).
  phaseAccount?.backfillFinalCpu(scopeConsumedLoad?.cpu_time_s != null ? scopeConsumedLoad.cpu_time_s * 1_000_000 : null);
  // gap-leak-residue-per-run-namespace-isolation AC2/AC3 — POST-SUITE cleanup of THIS run's own
  // namespace (/tmp/quay-run-<shortRunId>/): remove owner-dead residue under it so the NEXT run's
  // pre-suite sweeper never sees it (accumulation guard). The suite-tail leak-scan ALREADY scanned
  // this subtree inside test.sh — a genuine live-owner leak still red'd there (the gate is intact);
  // owner-dead residue (a cancelled-test leftover dir, a reaped-but-not-removed dir) is cleaned
  // here and COUNTED into the round record (AC3 — the leak is an observable metric, not a silently
  // cleared signal). Best-effort — a cleanup failure must never change the verdict.
  let postCleaned: { cleaned: number; dirs: string[] } = { cleaned: 0, dirs: [] };
  try {
    postCleaned = sweepRunNamespace(shortRunId);
    if (postCleaned.cleaned > 0) {
      process.stderr.write(
        `full-suite-runner: post-suite cleanup removed ${postCleaned.cleaned} owner-dead residue dir(s) from /tmp/quay-run-${shortRunId}\n`,
      );
    }
  } catch (e) {
    process.stderr.write(`full-suite-runner: post-suite cleanup failed (continuing): ${e instanceof Error ? e.message : String(e)}\n`);
  }
  // TRUE-CATCH-ALL (gap-session-liveness-teardown-ol-scd-cf-leak): kill THIS run's still-alive
  // registered servers (safety net after the suite-tail scan-kill — e.g. a process whose server
  // leaked after the scan, or a run where QUAY_RUN_ID never reached test.sh). Registry-driven
  // (PID-targeted SIGKILL of servers the tests self-built — invariant no_pkill_by_name_on_live = 1),
  // scoped to this runId so a concurrent scoped run's servers are never touched. Best-effort.
  try {
    const killedRun = killRegisteredServers({ runId: shortRunId });
    if (killedRun.length > 0) {
      process.stderr.write(
        `full-suite-runner: post-suite registry kill removed ${killedRun.length} still-alive registered server(s) from run ${shortRunId}\n`,
      );
    }
  } catch (e) {
    process.stderr.write(`full-suite-runner: post-suite registry kill failed (continuing): ${e instanceof Error ? e.message : String(e)}\n`);
  }
  // The combined cleanup count + WHICH dirs (pre-suite stale namespaces + post-suite own residue),
  // for the round record. Capped so a pathological round cannot grow the record unboundedly.
  const allCleanedDirs = [...preCleaned.dirs, ...postCleaned.dirs];
  const tmuxCleaned = allCleanedDirs.length;
  const tmuxCleanedDirs = allCleanedDirs.slice(0, 50);

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
  // gap-test-detail-perfile-duration-failed AC1 — parse the buffered __PERFILE__ lines through
  // parsePerFileLines (the measure-history parser), so verification-round.perFile and
  // measure-history.jsonl share ONE 口径 (repo-root-relative keys, duration>0 filter). Omitted
  // (never a fabricated []) when the round emitted no __PERFILE__ lines — same absent-field
  // contract as floor_ms/ceiling below.
  const perFile = perFileLines.length > 0 ? parsePerFileLines(perFileLines.join("\n")) : [];
  // gap-phase-boundary-differential-accounting — the final phase was CLOSED at suite exit (before
  // the journal poll) and its cpu backfilled from the Consumed total right after the poll (see the
  // `finalize()` / `backfillFinalCpu()` calls above). `phaseAccount.records` below is the finished
  // phase sequence — real differentials for the completed phases, the exit-spanning phase derived
  // from the authoritative total when available (or null fail-open).
  appendVerificationRound(stateDir, {
    round: 0, // computed from prior line count inside appendVerificationRound
    startedAt,
    durationMs,
    laneCount,
    // gap-lanes-nproc-concurrent-suites-accounting AC1/AC2/AC3 — the round's concurrency variables
    // (captured at round start; always present on new rows so a cross-round comparison can attribute
    // wall-clock differences to the concurrency axis — 2-slot lock made concurrent-suite count a NEW
    // variable that must be recorded for the "1 套件轮 vs 2 套件轮" negative control to be queryable).
    nproc: roundNproc,
    concurrentSuiteSlots: roundConcurrentSuiteSlots,
    concurrentSuitesRunning: roundConcurrentSuitesRunning,
    // gap-verification-round-observability-holes AC1 — the flock wait (test.sh's lock-acquire markers).
    // Present only when the suite actually took the lock (the acquire START + acquired markers both
    // fired); absent on scoped runs / lock-timeout aborts — a reader must tolerate absence.
    ...(lockWaitMs !== null ? { lock_wait_ms: lockWaitMs } : {}),
    // gap-suite-lock-starvation-long-validation-hold AC2 — lock_hold_ms rides test.sh's
    // `__OVERHEAD__ lock_hold_ms=N` marker (the acquire→release wall), accumulated into phaseMs by the
    // generic overheadM parse. Absent on scoped/nested runs (no lock taken) — a reader must tolerate
    // absence, same contract as lock_wait_ms.
    ...(phaseMs.lock_hold !== undefined ? { lock_hold_ms: phaseMs.lock_hold } : {}),
    pass: tapPass,
    fail: tapFail,
    cancelled: tapCancelled,
    tests: tapTests,
    per_test_ms: tapTests > 0 ? Number((durationMs / tapTests).toFixed(3)) : 0,
    redAt: redAtIso,
    load: readLoadAvg(),
    state: finalState.state,
    reason: roundReason,
    // gap-verifiedcommit-dirty-tree-false-certificate AC5 — the same `void: true` marker the state
    // carries: this round's tests PASSED but its tree was MUTATED MID-ROUND ⇒ a VOIDED certificate
    // (state=red, reason=infra-error). Lets the round sequence distinguish voided-green from failed.
    ...(voided ? { void: true } : {}),
    ...(roundGate ? { gate: roundGate } : {}),
    runner: base.runner,
    scope,
    // gap-verification-round-in-one-shot-worktree — carry the isolation the round actually used (the
    // same flag the suite-state base carries) so the verification-round sequence is queryable for
    // "was this round a one-shot-worktree round" without re-deriving it.
    ...(oneShotWorktreePath ? { oneShotWorktree: true } : {}),
    // gap-merge-green-snapshot-verified-commit-livelock AC2 — the verified commit this round tested
    // (same value the state carries). Absent on non-git hermetic roots.
    ...(verifiedCommit ? { commit: verifiedCommit } : {}),
    // gap-verifiedcommit-dirty-tree-false-certificate AC1/AC2 — the tested tree's round-start state
    // (dirty flag incl. untracked + tested-content tree hash) rides the round record so the historical
    // sequence is queryable for "was this round's verifiedCommit a FALSE CERTIFICATE (dirty tree)" /
    // "does a later commit reproduce the tested tree" WITHOUT re-deriving it — the same conditional
    // as the state write (git roots only; the record never fabricates a tree).
    ...(treeState ? { treeDirty: treeState.treeDirty, tree: treeState.tree } : {}),
    // gap-concurrent-write-mutable-tree-false-positive-red — the tree-mutation annotation (start
    // HEAD vs terminal HEAD) rides the round record so the historical round sequence is queryable
    // for "was this red a concurrent-write FALSE-POSITIVE candidate" (round-53 class) WITHOUT
    // re-deriving it — the same conditional as the state write (git roots only; the record never
    // fabricates a commit).
    ...(verifiedCommit && terminalCommit ? { treeMutatedMidRound, terminalCommit } : {}),
    // gap-precommit-guard-blocks-commits-not-working-tree-edits — the assertion-surface mid-round-EDIT
    // annotation rides the round record (the same conditional as the state write) so the historical
    // sequence is queryable for "was this round's verdict mixed-state" without re-deriving it.
    ...(assertionSurfaceEditedMidRound.length > 0 ? { assertionSurfaceEditedMidRound } : {}),
    // gap-suite-round-record-missing-failures-field AC2 — a RED round carries the SAME SuiteFailure
    // array the suite-state write carries (finalFailures — the redFailures/staticCheckFailures the
    // state already recorded), so verification-round.jsonl becomes a multi-round-queryable sequence
    // for "failed file → task Touches" attribution. Segmented (gap-streaming-red-cascade-amplifies-
    // failures-array AC1/AC2): the main `failures` set + the `derived`/`unattributed` populations —
    // byte-identical to the suite-state write. Green rounds omit them (绿轮可无) — all other
    // round-record fields stay byte-identical for non-red rounds.
    ...(finalState.state === "red" ? failureFields : {}),
    // gap-verification-round-missing-phase-ms-breaks-cost-attribution AC2/AC3 — carry the per-phase
    // cost readings (test.sh's `__OVERHEAD__ <phase>_ms` lines, already tee'd to the log). Only a
    // phase that RAN is present: a kill-on-red-truncated round is missing main_phase_ms (the kill
    // cut the main phase before its completion marker), so truncated-vs-complete is distinguishable
    // from the record alone — per_test_ms finally has phase context.
    ...(phaseMs.run_static_checks !== undefined ? { static_phase_ms: phaseMs.run_static_checks } : {}),
    ...(phaseMs.serial_phase !== undefined ? { serial_phase_ms: phaseMs.serial_phase } : {}),
    // gap-verification-round-observability-holes AC2 — `lowconc_phase_ms` 不再恒 0. Under PHASE_OVERLAP
    // test.sh subsumes lowconc into the serial window and emits `__OVERHEAD__ lowconc_phase_ms=0`, so the
    // record lost the "which parallel phase is the long pole" signal exactly when that optimization was
    // being measured. test.sh ALSO emits the per-process sub-times (`overlap_lowconc_ms`); on an overlap
    // round, lowconc_phase_ms carries THAT real lowconc duration instead of the 0. Falls back to the raw
    // 0 only when the sub-time marker was missed (a truncated round — honest, nothing recoverable).
    ...(phaseMs.lowconc_phase !== undefined
      ? {
          lowconc_phase_ms:
            phaseOverlapRan && typeof phaseMs.overlap_lowconc === "number"
              ? phaseMs.overlap_lowconc
              : phaseMs.lowconc_phase,
        }
      : {}),
    ...(phaseMs.main_phase !== undefined ? { main_phase_ms: phaseMs.main_phase } : {}),
    // gap-phase-overlap-two-phase-parallel-exploration AC1 — the round record carries whether the
    // suite ran the two-phase-overlap scheduling (serial+lowconc in PARALLEL). Absent on a sequential
    // round (the same absent-field contract as the *_phase_ms spreads): the before/after comparison
    // (task constraint 3: green-round serial_phase_ms + lowconc_phase_ms) can distinguish overlap
    // rounds from baseline rounds in verification-round.jsonl without relying on wall-clock timing.
    // gap-phase-overlap-field-always-false-negative — derived from the LATCHED stream state
    // (phaseOverlapRan), NOT process.env.QUAY_PHASE_OVERLAP: this runner is test.sh's PARENT, and the
    // production chain (fan-in-execute.js → runner) never sets that env (the default 1 lives only
    // inside test.sh, as a non-exported shell var), so the env read was a permanent false negative —
    // 241 records, phase_overlap:true only 3×, all manual exploration rounds. The `overlap: running`
    // stream marker is test.sh's ground-truth signal that the parallel branch ACTUALLY ran.
    ...(phaseOverlapRan ? { phase_overlap: true } : {}),
    // gap-ceiling-floor-ms-not-landed-in-verification-round AC1/AC3 — the reporter's per-group
    // floors (各相) + capped-file list. Both appear together (every __CEILING__ line carries a
    // floor_ms, so floorMsSeen non-empty ⟺ ceilingFiles non-empty), and BOTH are omitted on a
    // round with no __CEILING__ lines (AC3: no fabricated empty/null — the same absent-field
    // contract the *_phase_ms spreads above follow).
    ...(floorMsSeen.length > 0 ? { floor_ms: floorMsSeen } : {}),
    ...(ceilingFiles.length > 0 ? { ceiling: ceilingFiles } : {}),
    // gap-test-detail-perfile-duration-failed AC1 — the per-file {file,durationMs,passed} array.
    // Present only when parsePerFileLines yielded ≥1 record (a no-reporter/legacy run omits it).
    ...(perFile.length > 0 ? { perFile } : {}),
    // gap-verification-round-load-fields-from-systemd — THIS round's scope unit + the parsed
    // Consumed-load fields. Present only when roundScopeUnit was captured at round START (real
    // systemd-run or the QUAY_TEST_SCOPE_UNIT seam); a non-systemd round omits ALL FOUR (缺键 — a
    // reader must tolerate absence, same contract as the *_phase_ms fields). When scopeConsumedLoad
    // is set, the three fields are values or EXPLICIT null + load_read_error carries the reason
    // (trap 3 — never 0). `scope_unit` is the round-captured memory value, never a shared-file re-read
    // (trap 1).
    ...(roundScopeUnit ? { scope_unit: roundScopeUnit } : {}),
    ...(scopeConsumedLoad
      ? {
          cpu_time_s: scopeConsumedLoad.cpu_time_s,
          mem_peak_mb: scopeConsumedLoad.mem_peak_mb,
          swap_peak_mb: scopeConsumedLoad.swap_peak_mb,
          load_read_error: scopeConsumedLoad.load_read_error,
          // gap-verification-round-observability-holes AC4 — the round's effective parallelism
          // (cpu_time_s ÷ wall). Present only when cpu_time_s is a finite number (the quotient is
          // null — and the field absent — on a null cpu_time_s: a fabricated 0 would read "infinite
          // cores"). The single "did the suite optimization help" KPI, directly comparable per round.
          ...(effectiveParallelism(scopeConsumedLoad.cpu_time_s, durationMs) !== null
            ? { effective_parallelism: effectiveParallelism(scopeConsumedLoad.cpu_time_s, durationMs) }
            : {}),
        }
      : {}),
    // gap-leak-residue-per-run-namespace-isolation AC3 — the run's unified-cleanup count + WHICH
    // dirs (pre-suite stale namespaces + post-suite own-residue), so a leak is an OBSERVABLE
    // METRIC in the round record, never a silently-cleared signal. `tmux_cleaned` = number of
    // owner-dead residue dirs this run's cleanup passes removed; `tmux_cleaned_dirs` = the first
    // 50 cleaned paths (cap — a pathological round must not grow the record unboundedly). Both
    // omitted when nothing was cleaned (绿轮可无, same absent-field contract as *_phase_ms).
    ...(tmuxCleaned > 0 ? { tmux_cleaned: tmuxCleaned, tmux_cleaned_dirs: tmuxCleanedDirs } : {}),
    // gap-phase-boundary-differential-accounting AC1/AC2 — the per-phase differential records
    // (static→serial→gap_serial_to_lowconc→lowconc→main→end). Present on EVERY round the suite
    // child spawned (finalize above guarantees ≥1 record; the crash trap writes its own row). The
    // counter-read failure reason rides `phase_counter_error` (缺键, never a fabricated 0); the
    // EXPECTED exit-spanning finalize read failure (transient scope destroyed) rides the distinct
    // `phase_final_read_error` so it is not confused with "counters never readable".
    ...(phaseAccount ? { phases: phaseAccount.records } : {}),
    ...(phaseAccount?.read_error ? { phase_counter_error: phaseAccount.read_error } : {}),
    ...(phaseAccount?.finalReadError ? { phase_final_read_error: phaseAccount.finalReadError } : {}),
    // gap-ac124-suite-bucket-production-carrier-benefit — the bucket-execution fields. Present only on
    // a bucket-mode round (test.sh emitted __BUCKETS__); the default full suite omits them (a reader
    // must tolerate their absence). bucket_duration_ms is the round's own durationMs (the round IS the
    // bucket run — no separate clock), so the 40%-of-full comparison reads durationMs directly.
    ...(bucketLabel !== null ? { buckets: bucketLabel } : {}),
    ...(bucketFiles !== null ? { bucket_files: bucketFiles } : {}),
    ...(bucketLabel !== null ? { bucket_duration_ms: durationMs } : {}),
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
  // gap-verification-round-in-one-shot-worktree — close the one-shot worktree now that the verdict is
  // on disk (the round record + log live in the MAIN repo's stateDir, so tearing the worktree down
  // loses nothing). The crash/signal handlers above also teardown; this is the normal-completion path.
  teardownOneShot();
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
    const state = redEv?.state;
    // gap-streaming-red-cascade-amplifies-failures-array AC1/AC2 — the failure location may ride
    // `state.failures` (real file-attributable entries) OR `state.unattributed` (a no-file real
    // failure — the `not ok 1 - fail-fast-check` control line carries no file). Both are the
    // SUITE-RED event's failureLocation for the dispatch decision; count both.
    const failures = state?.failures ?? redEv?.failureLocation ?? [];
    const unattributed = state?.unattributed ?? [];
    const payloadCount = failures.length + unattributed.length;
    console.log(
      `fail-fast-check: suite exit=${code} state=${status} reason=${redEv?.state?.reason ?? "?"} stopSignal=${stopSignal} ` +
        `failures=${failures.length} unattributed=${unattributed.length} suiteRedEvent=${redEv ? `recorded early=${redEv.early}` : "MISSING"} events=${events.length}`,
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
    if (payloadCount === 0) {
      console.error(
        "fail-fast-check FAIL: expected the SUITE-RED event to carry the failure location (state.failures / state.unattributed / failureLocation) — the red-window dispatch decision needs it",
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

const isDirect = process.argv[1] && path.basename(process.argv[1]).replace(/\.(?:js|ts|mjs)$/, "") === "full-suite-runner";
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
