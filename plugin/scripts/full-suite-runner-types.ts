// full-suite-runner-types.ts — the SUITE STATE/RECORD type family, extracted VERBATIM from
// full-suite-runner.ts (tasks/gap-arch-import-cycles-zero, GOAL-025 AC-308).
//
// WHY A SEPARATE FILE: runner-red-parse.ts and runner-state-write.ts each need types that
// full-suite-runner.ts DEFINES, while full-suite-runner.ts VALUE-imports both — that was a
// type-level import cycle (import-graph-check.ts `typeSccs`), which made the two modules
// untestable and unmovable in isolation. The cycle-breaking edge is "move the shared type
// definitions to a third module that imports nothing back"; full-suite-runner.ts re-exports every
// name below (`import type` + `export type`), so its public API surface stays byte-for-byte
// unchanged — the same extraction idiom already used for suite-accounting.ts and
// runner-tree-state.ts.
//
// ⛔ PURE REFACTOR: every declaration below is moved VERBATIM (no body/logic edits). ⛔ This module
// must never import full-suite-runner.ts (that would recreate the cycle it exists to break), and
// must not import gate/factories or anything that does.
//
// ⛔ NOT the suite-state-trigger.ts family: that module has its OWN SuiteState/SuiteStateValue/
// SuiteStateReason/SuiteFailure/SuiteStateStaticCheck (they drive routeRed / stop-dispatch) — a
// DIFFERENT type family with different fields. Never merge the two.

import type { PerFileRecord } from "./measure-trend-check.ts";
import type { PhaseDiffRecord } from "./suite-accounting.ts";

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
// failure (static-check / perfile-failure / tmux-leak-scan), carried with a `gate` identity naming
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
   * gap-not-evaluated-checkers-never-persisted — the checkers that could NOT be evaluated this round
   * (checker-cost-lib's `STATIC_CHECK_NOT_EVALUATED: <name>` machine line, exit 3 = a THIRD state, NOT
   * a red and NOT a pass). A checker that "reads unclassifiable input" exits 0 and the suite passes
   * GREEN, so its inertness is invisible on the `failedCheckers` axis — the round-xx `direct-to-develop-
   * bypass-check` shape (unclassifiable-commits-in-range, exit 0, the six meta-driver commits it was
   * supposed to catch sailed straight through). This field is ALWAYS present on a terminal state (empty
   * array = "no checker was not-evaluated this round" — DISTINGUISHABLE from an absent field = "this
   * dimension was never recorded", hard rule 3b). Written top-level (NOT inside `staticCheck`, which is
   * absent on green) so a GREEN round still carries the inert-guard signal.
   */
  notEvaluatedCheckers?: NotEvaluatedChecker[];
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
 * One NOT-EVALUATED static-check checker (gap-not-evaluated-checkers-never-persisted): checker-cost-lib
 * emits `STATIC_CHECK_NOT_EVALUATED: <name>` (one line per inert checker, on stderr) when a
 * run_static_checks checker exits 3 (a THIRD state — the checker could not evaluate its input, so it
 * neither fail-closed (red) nor passed). The whole point of this task: the line was HONESTLY produced
 * then thrown away at the stderr boundary — never parsed, never persisted, so an inert guard is a
 * structurally-undetectable failure class. `name` is the checker id; `line` the raw stream line (no
 * exit code — there is none worth recording: exit 3 is the constant NOT-EVALUATED code, not a
 * per-checker value).
 */
export interface NotEvaluatedChecker {
  name: string;
  line: string;
}

export interface SuiteRoundRecord {
  round: number;
  // gap-verification-round-record-runid — the suite's canonical runId (the SAME value the state write
  // carries and the SAME key the load sampler uses for suite-load-<runId>.jsonl / measure-history). The
  // round record carrying it makes the row self-describing (its OWN load key rides the ledger row).
  // Absent on legacy rows (红绿 pre-fix records had no runId) — a reader must tolerate its absence
  // (same absent-field contract as commit/scope).
  runId?: string;
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
  /**
   * gap-verification-round-static-fail-no-record AC3 — which task this round verified (present ONLY on
   * a bucket-mode run `--buckets <task-id>`, where the runner knows the task identity; a main-checkout
   * full suite / one-shot verify round omits it — absent-field contract, same as scope_unit). Lets the
   * red/failed round be attributed to the task whose bucket it verified, without hand-digging the log.
   */
  taskId?: string;
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
   * test-framework-policy / test-isolation ratchet), 'perfile-failure' (a __PERFILE__ ... passed=false
   * measure-suite per-file failure — a real test failure, NOT a timeout), or 'tmux-leak-scan' (the
   * suite-tail leak-scan residual). Absent
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
   * gap-perfile-cpu-cost-collection — each record ALSO carries `cpuMs` (the file's OWN
   * process.cpuUsage() in ms, route a 子进程自报) when the reporter's `__PERFILE__` line carried
   * `cpu_ms=`; absent on legacy lines (缺键 ≠ 0, the same absent-field contract as endedAtMs). This
   * writer forms perFile from the shared parser, so cpuMs rides the record automatically — 禁止只改一边.
   * gap-perfile-memory-cost-collection-missing — the same holds for `memPeakKb` (the file's OWN
   * process peak RSS in KB from the `mem_peak_kb=` field; ⛔ this process only, its SPAWNED
   * subprocesses are NOT covered). BOTH round-record writers (this one +
   * pre-verified-round-record.ts's parsePerFile) read the shared parser, so both carry it —
   * 禁止只改一边.
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

/**
 * gap-full-suite-scope-oom-policy-stops-whole-suite-unattributable — the per-run cgroup OOM/memory
 * evidence written to `<state-dir>/suite-memory-evidence-<runId>.json` while the suite scope runs.
 *
 * WHY a per-RUN file (⛔ not the single-slot `suite-cgroup-evidence.txt`): that file records only the
 * APPLIED LIMITS and is overwritten every round — a round's peak / OOM counters were unrecoverable
 * (the transient `systemd-run --scope` unit is destroyed at suite exit ⇒ `Result=oom-kill` and
 * `memory.events` cannot be read back afterwards). The runner therefore samples the scope cgroup
 * DURING the run and lands one file per runId, so two consecutive rounds never overwrite each other
 * and the worker-driver can attribute an OOM red to THIS round.
 *
 * Fields the red-attribution path needs: `oomKill` (the classification trigger), `peakBytes` /
 * `memoryMaxBytes` (the读数 the stop note must name), `phase` (the phase the OOM happened in),
 * `runId` (the identity that ties the file to one round).
 */
export interface SuiteMemoryEvidence {
  /** The per-suite runId (the same value the runner writes the state / round record under). */
  runId: string;
  /** Peak cgroup memory (bytes) observed during the run — `memory.peak` (cgroup v2 high-water mark),
   *  falling back to the max of `memory.current`. `null` = never observed (缺值 ≠ 0, 硬规则 6). */
  peakBytes: number | null;
  /** The scope's MemoryMax in BYTES (`null` when the scope passed no memory ceiling). */
  memoryMaxBytes: number | null;
  /** `memory.events` `oom` counter at the last sample (0 = never observed). */
  oom: number;
  /** `memory.events` `oom_kill` counter at the last sample — the red-attribution trigger. */
  oomKill: number;
  /** The suite phase NAME at the moment `oomKill` first became positive (else the last phase seen). */
  phase: string;
  /** The transient scope unit name when captured (`null` otherwise). */
  scopeUnit: string | null;
  /** How many cgroup samples were taken (0 ⇒ the cgroup was never readable — evidence is inert). */
  samples: number;
  /** ISO-8601 capture time (the last sample / the teardown read). */
  capturedAt: string;
}
