#!/usr/bin/env node
// suite-state-trigger.ts — 红窗规则的自动执行者（gap-red-window-has-no-automatic-executor）。
//
// 背景（管理者活实况 2026-08-05 ROUND 2）：套件转红且无人处置——`.quay/full-suite-state.json` 是
// state=red（早期 RED 生效，这是 (a) 块设计的行为），但红窗规则要求的 RED 处置一步都没执行，因为
// BOTH 分支（RED → stop-dispatch + 分诊；GREEN/RUNNING → 乐观派发）都只靠 `*/20` cron 或人驱动。
// 「机制写好了但没有执行者」= 存在 ≠ 生效。
//
// 本条 = (a) 块（gap-full-suite-belongs-to-outer-background-above-3-min）的执行者层：把状态变化
// （state=red / state=running）自动转成动作（通知外层 / 驱动 inner 派发）。
//
//   AC1 — RED 自动触发：state 变 red 时立即发 SUITE-RED 事件（外层 Monitor 推送，不等下一次 cron），
//         并确认 stop-dispatch 信号在位（state=red 即信号——见 (a) 块 AC4）。
//   AC3 — RUNNING 乐观派发执行者：state 变 running 时发 SUITE-RUNNING 事件，外层据此按文档驱动 inner
//         照常派发（池有可派即派，不待轮）。
//   AC2/AC4 — 触发者是既有处置逻辑的执行者，不是新决策者：本脚本只做「状态变化 → 事件」的翻译与通知，
//         不做任何分诊/派发决策；分诊 = 外层既有「红窗分诊」（orchestrator-loop-tick.md 步骤 1b），
//         派发 = 内层既有 §4 规则。不引入新调度源——本脚本是 Monitor 事件监测（同 session-liveness），
//         节奏仍唯一（外层 `*/20` cron）。
//
// 状态文件（输入，well-known 位置）：<root>/.quay/full-suite-state.json
//   {state: running|green|red, reason?: failed|aborted|infra-error|static-check|crashed, runner,
//    startedAt, finishedAt, durationMs, laneCount, pid?}
//   —— (a) 块的 full-suite-runner.ts 写它；本脚本只读（AC6 例外：见下）。`reason` 只在 red 时出现
//      （原因轴，AC5/AC1）：
//      failed（真实失败——stop-dispatch 信号）/ aborted（无正确性结论——不触发停派）/
//      infra-error（环境问题——同样不触发代码风险停派）/ static-check（静态检查违规——停派）/
//      crashed（runner 死在中途——无正确性结论，不触发停派）。
//   —— AC6 例外（gap-full-suite-state-red-no-failure-detail-static-check-invisible）：本脚本在
//      runOnce 轮询里增加 crash-watchdog——读到 state=running 且其 runner PID 已死（SIGKILL——
//      进程内 handler 抓不到的硬杀）时，把 state 写成终态 red reason=crashed（generation-guarded）。
//      这是「跑着」与「死了」在 state 文件上可区分的唯一机制（runner 自己被 kill 时无法自写）。
//      角色边界不变：这不是新决策，只是把「runner 死了却没写终态」翻译成 state 上的事实。
//
// 记忆文件（本脚本自己的上次观测）：<root>/.quay/suite-state-last.json  —— 跨重启保持「上一个状态」，
//   使「冷启动即红」（外层 /clear 后重启、套件仍红）也能被检测为一次转变并触发 SUITE-RED。
//
// 事件日志（append-only，measure 钩子）：<root>/.quay/suite-state-events.jsonl
//   {"event":"SUITE-RED"|"SUITE-GREEN"|"SUITE-RUNNING","at":"<ISO>","early":<bool>,"stopSignal":<bool>,
//    "state":{...}} —— Contract measure `red_to_triage_ms` 的起点（SUITE-RED.at → 分诊启动）。
//
// 使用（外层挂 Monitor，冷启动步骤 4b2；或 tick / 排障里跑 --once）：
//   node --no-warnings --experimental-strip-types plugin/scripts/suite-state-trigger.ts \
//     [--once]                      # 跑一轮：读状态、检测转变、记录并打印事件（测试接缝 + tick 排障）
//     [--monitor]                   # Monitor 模式（默认）：每 --interval 秒跑一轮，把事件打到 stdout
//                                   #   （外层 Monitor 事件流 → 立即推送，不等 cron）
//     [--interval <sec>]            # Monitor 轮询间隔（默认 5，目标秒级）
//     [--root <path>]               # 工作区根（测试接缝；默认仓库根）
//
// Exit: 0（正常）；只有不可解析的参数退出 1。状态是 red 不是错误——它就是要触发处置的信号。

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { matchGlob, parseTouches } from "./touches-orthogonality-check.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");

export type SuiteStateValue = "running" | "green" | "red";
// gap-full-suite-state-red-no-failure-detail-static-check-invisible AC3 — a FOURTH reason value:
// "static-check" (a run_static_checks checker failed — task-contract / test-framework-policy /
// test-isolation ratchet — NOT a test failure). Consumers can distinguish a static-check red from a
// test-failure red: both stop dispatch (static checks ARE the shared gate), but the triage differs
// (static-check red ⇒ fix the contract, not roll back code).
// gap-full-suite-state-red-no-failure-detail-static-check-invisible AC6 — "crashed" (the RUNNER died
// mid-run without writing a terminal state — SIGKILL / uncaught exception — leaving state=running on
// disk). Same family as aborted/failed (a terminal red), but distinct: it is written by THIS module's
// crash-watchdog (runOnce detects a running state whose runner PID is dead) or by the runner's own
// uncaughtException handler. Reroutes like aborted (no correctness conclusion ⇒ no code-risk stop),
// but tells the consumer the suite died silently and must be re-launched, not triaged.
export type SuiteStateReason = "failed" | "aborted" | "infra-error" | "static-check" | "crashed";

/**
 * One detected suite failure — the FAILURE LOCATION for the red-window dispatch decision
 * (gap-red-window-dispatch-stop-should-be-shared-gate-conditional). `line` is the raw failure
 * line that flipped state to red (the 判定信息); `file` is the best-effort test-file context.
 */
export interface SuiteFailure {
  line: string;
  file?: string;
  /**
   * True when this entry is a STATIC-CHECK violation (a run_static_checks checker failed), not a
   * test failure (gap-full-suite-state-red-no-failure-detail-static-check-invisible AC4 candidate B).
   * classifyFailure reads this marker to classify the failure as a SHARED-GATE failure (static
   * checks pollute every scoped run ⇒ stop dispatch). Absent/undefined on real test failures.
   */
  staticCheck?: boolean;
}

/** Machine-readable static-check red detail (AC2) — mirrors full-suite-runner.ts's shape. */
export interface SuiteStateStaticCheck {
  violations?: number | null;
  taskCount?: number | null;
  ceiling?: number | null;
  newSinceBaseline?: number | null;
  details?: unknown[];
}

/** Where a suite failure landed, for the shared-gate-vs-specific-test dispatch conditional. */
export interface FailureLocation {
  kind: "shared-gate" | "specific-test" | "unknown";
  file?: string; // specific-test: the failing test file (repo-relative, best-effort)
  line: string;
}

export interface SuiteState {
  state: SuiteStateValue;
  runner?: string;
  startedAt?: string;
  // gap-batch-merge-gate-reads-stale-green: finishedAt is written as EPOCH SECONDS by the runner
  // (the freshness gate's Contract measure needs epoch); ISO legacy states are still read (number|string).
  finishedAt?: number | string | null;
  durationMs?: number | null;
  laneCount?: number;
  /**
   * Present only on red (AC5 reason axis, gap-full-suite-runner-concurrency-default-and-gate;
   * three-value enum per gap-suite-state-has-no-reason-axis-failed-aborted-infra AC1):
   *   - "failed"     = a real failure was detected (the stop-dispatch signal);
   *   - "aborted"    = the run produced NO correctness conclusion (spawn error / signal kill /
   *                    outer abort / early gate-WAIT exit) and MUST NOT stop dispatch;
   *   - "infra-error" = an environment problem (neither a code failure nor a deliberate abort) —
   *                    not a code-failure conclusion, so it does NOT stop dispatch on code risk.
   * A missing reason (legacy red) is treated as "failed" — fail-closed toward stopping.
   */
  reason?: SuiteStateReason;
  /**
   * Present on red+failed — the failure line(s) + best-effort file context written by
   * full-suite-runner. The SUITE-RED event carries this (failureLocation) so the inner dispatch
   * decision can distinguish a SHARED-GATE failure (run_static_checks — every scoped run pays it
   * ⇒ stop dispatch) from a SPECIFIC-TEST failure unrelated to a candidate's touch-set (⇒ dispatch
   * continues). Absent (legacy red) ⇒ fail-closed toward stopping.
   */
  failures?: SuiteFailure[];
  /**
   * Present on red+static-check (gap-full-suite-state-red-no-failure-detail-static-check-invisible
   * AC2): machine-readable violation counts when the red was caused by a run_static_checks checker
   * (not a test failure). Consumers read reason === "static-check" + this field to triage a static-
   * check red (fix the contract) without hand-digging the log.
   */
  staticCheck?: SuiteStateStaticCheck;
  /**
   * gap-full-suite-state-red-no-failure-detail-static-check-invisible AC6 — the full-suite-runner's
   * PID, written on every state (via its `base` object). This module's runOnce crash-watchdog reads
   * it to tell "the suite is genuinely running" (PID alive) from "the runner died mid-run" (PID dead
   * — SIGKILL, which no in-process handler can catch) and writes a terminal reason=crashed state so
   * `running` never persists after the runner is dead. Absent on legacy states ⇒ the watchdog falls
   * back to a stale-AGE threshold before declaring a crash.
   */
  pid?: number;
}

/** The AC2 reason-axis route a red state takes (gap-suite-state-has-no-reason-axis-failed-aborted-infra). */
export type RedRoute = "red-window-triage" | "resource-gate" | "proceed";

/**
 * AC2 — route a suite state by its reason axis. The state=red stop-dispatch signal is the red-window
 * rule's CODE-RISK stop; it fires ONLY when the red carries a real failure conclusion:
 *   - red + reason=failed (or legacy red, missing reason — fail-closed) ⇒ "red-window-triage":
 *     STOP dispatch + red-window triage (定位肇事 merge).
 *   - red + reason=static-check (a run_static_checks checker failed — gap-full-suite-state-red-no-
 *     failure-detail-static-check-invisible AC3) ⇒ "red-window-triage" too: static checks ARE the
 *     shared gate every scoped run pays, so a static-check red STOPS dispatch. The reason value
 *     still lets the triage distinguish "fix the contract" from "roll back code".
 *   - red + reason=aborted (NO correctness conclusion — signal kill / spawn error / early gate-WAIT
 *     exit) ⇒ "resource-gate": do NOT stop on code risk; recovery is decided by resource-gate.sh's
 *     GO/WAIT (the "现在能不能压" criterion) — the coincidence where a lingering abort-red keeps
 *     dispatch stopped with NO evidence (gap-suite-state-has-no-reason-axis-failed-aborted-infra AC3)
 *     cannot happen.
 *   - red + reason=infra-error (environment problem — neither a code failure nor a deliberate abort)
 *     ⇒ "resource-gate" too: it carries no code-failure conclusion, so it must not stop dispatch on
 *     code risk either.
 *   - red + reason=crashed (gap-full-suite-state-red-no-failure-detail-static-check-invisible AC6 —
 *     the runner died mid-run without writing a correctness conclusion; the terminal state was
 *     written by this module's crash-watchdog or the runner's uncaughtException handler) ⇒
 *     "resource-gate" too: NO correctness conclusion, so it must not stop dispatch on code risk.
 *     The distinct reason value still lets the consumer distinguish "deliberately aborted" from
 *     "died silently" (⇒ re-launch the suite).
 *   - non-red / absent state file ⇒ "proceed".
 */
export function routeRed(state: SuiteState | null): RedRoute {
  if (!state || state.state !== "red") return "proceed";
  if (state.reason === "aborted" || state.reason === "infra-error" || state.reason === "crashed") return "resource-gate";
  return "red-window-triage";
}

/**
 * AC5 — the stop-dispatch decision on a suite state. state=red is the stop signal ONLY when the
 * red carries a real failure: `state: red` + `reason: failed` (or a missing reason, legacy/fail-
 * closed) ⇒ STOP dispatch; `state: red` + `reason: aborted|infra-error` (no correctness conclusion)
 * ⇒ do NOT stop — the outer records the abort and re-runs when the resource gate reports GO. Absent
 * state file ⇒ do NOT block (documented: the outer hasn't run its first round yet).
 */
export function shouldStopDispatch(state: SuiteState | null): boolean {
  return routeRed(state) === "red-window-triage";
}

export type SuiteEventKind = "SUITE-RED" | "SUITE-GREEN" | "SUITE-RUNNING";

export interface SuiteStateEvent {
  event: SuiteEventKind;
  at: string; // ISO 8601 — measure hook for red_to_triage_ms
  early: boolean; // red with finishedAt null = 早期 RED（(a) 块 AC2）
  stopSignal: boolean; // state=red IS the stop-dispatch signal（(a) 块 AC4）— 事件自带确认
  state: SuiteState | null;
  /**
   * SUITE-RED only — the classified failure location(s), the input to the shared-gate-vs-
   * specific-test dispatch conditional (gap-red-window-dispatch-stop-should-be-shared-gate-
   * conditional). A factual projection of state.failures (translation, not a dispatch decision —
   * the decision is made at the inner dispatch site per the tick-doc rule, whose executable form
   * is `shouldDispatchOnRed`).
   */
  failureLocation?: FailureLocation[];
}

// ── failure-location classification + shared-gate dispatch conditional ─────────────────────────────
// (gap-red-window-dispatch-stop-should-be-shared-gate-conditional — the red-window rule refinement)
//
// The red-window dispatch-stop is a SHARED, gate-conditional rule (not two divergent copies):
//   RED ⇒ ALWAYS hold fan-in (the real protection — the red tree must not accumulate mixed failures);
//   RED ⇒ dispatch stops ONLY when the failure lands in the SHARED GATE (run_static_checks — the
//   static-check checkers every scoped run pays); RED ⇒ dispatch CONTINUES when the failure lands in
//   a SPECIFIC TEST file unrelated to the new task's touch-set (the new task's worktree is an
//   independent master-branch copy running its own scoped tests).
// The judgment info is already available: the early-RED failure line tells which test failed → shared
// gate vs specific test → intersects the candidate's touches. No new mechanism is needed — the runner
// records state.failures (the failure line + file), this module classifies it, and the existing
// touches machinery (matchGlob / parseTouches) does the intersection.

/** The shared gate = run_static_checks' static-check CHECKERS (plugin/scripts/*-check.*). */
const SHARED_GATE_CHECKER_RE = /(?:^|[/\\])[a-z0-9_.-]+-check\.(?:ts|sh|mjs)$/i;
const SHARED_GATE_NAME_RE =
  /split-or-commit|test-framework-policy|test-isolation|task-contract|task-ac-carryover|adr016|strategic-doc-staleness|drive-contract|checker-mutation|run_static_checks|run_scoped_static_checks|select-static-checks-for-touches/i;
const TEST_FILE_RE = /[\w./@-]+\.(?:test|spec)\.(?:mjs|ts|js|tsx|jsx)\b/i;

function classifyFile(file: string): FailureLocation["kind"] {
  if (SHARED_GATE_CHECKER_RE.test(file)) return "shared-gate";
  if (TEST_FILE_RE.test(file)) return "specific-test";
  return "unknown";
}

/**
 * Classify ONE failure into its dispatch relevance (a FACT about where the red landed, not the
 * dispatch decision). Precedence: shared-gate wins over specific-test (a failure naming a checker
 * is a gate failure even if it also names a test file).
 */
export function classifyFailure(input: SuiteFailure | string): FailureLocation {
  const line = typeof input === "string" ? input : input.line;
  const file = typeof input === "string" ? undefined : input.file;
  const haystack = [file, line].filter(Boolean).join("\n");

  // 0. a STATIC-CHECK violation marker (gap-full-suite-state-red-no-failure-detail-static-check-
  //    invisible AC4 candidate B — full-suite-runner fills failures[] with staticCheck:true entries
  //    when run_static_checks failed) ⇒ SHARED GATE: static checks are run_static_checks — every
  //    scoped run pays them, so a static-check red ALWAYS stops dispatch (the shared-gate rule).
  if (typeof input !== "string" && input.staticCheck) return { kind: "shared-gate", line };

  // 1. a static-check checker is named (checker path / checker name / run_static_checks) ⇒ shared gate
  const checkerPath = file && SHARED_GATE_CHECKER_RE.test(file);
  if (checkerPath) return { kind: "shared-gate", line };
  if (SHARED_GATE_NAME_RE.test(haystack)) return { kind: "shared-gate", line };

  // 2. a specific test file is named (vitest `❯ <file>` / TAP location / stack frame) ⇒ specific test
  if (file) {
    const kind = classifyFile(file);
    if (kind === "specific-test") return { kind: "specific-test", file, line };
    if (kind === "shared-gate") return { kind: "shared-gate", file, line };
  }
  const testFile = haystack.match(TEST_FILE_RE)?.[0];
  if (testFile) return { kind: "specific-test", file: testFile, line };

  // 3. cannot determine the location — fail-closed toward stopping (cannot confirm it is an
  //    unrelated specific-test failure).
  return { kind: "unknown", line };
}

/**
 * The red-window dispatch conditional (this task's refinement) — executable form of the shared,
 * gate-conditional rule the two tick docs state in prose:
 *
 *   shouldDispatchOnRed(state, touches) === true ⇒ BLOCK this candidate's dispatch
 *   shouldDispatchOnRed(state, touches) === false ⇒ allow dispatch
 *
 * - absent / running / green ⇒ allow;
 * - red + reason:aborted (no correctness conclusion) ⇒ allow;
 * - red + failed (or missing reason):
 *   - no failure location (legacy red) ⇒ BLOCK (fail-closed — cannot confirm it is an unrelated
 *     specific-test failure);
 *   - ANY failure lands in the SHARED GATE (run_static_checks) ⇒ BLOCK (every scoped run pays it —
 *     every new task is polluted by the same red);
 *   - a SPECIFIC-TEST failure whose file intersects the candidate's touch-set ⇒ BLOCK (the new task
 *     would run that red);
 *   - a SPECIFIC-TEST failure unrelated to the candidate's touch-set ⇒ allow (the new task's
 *     worktree runs its own scoped tests — the red elsewhere is irrelevant);
 *   - an UNKNOWN location ⇒ BLOCK (fail-closed).
 *
 * `touches` is the candidate task's `## Touches` section text (parsed with the existing
 * parseTouches/matchGlob — no new mechanism), or an array of touch glob strings.
 */
export function shouldDispatchOnRed(state: SuiteState | null, touches: string | string[]): boolean {
  if (!state) return false;
  if (state.state !== "red") return false;
  if (state.reason === "aborted") return false;
  const failures = state.failures ?? [];
  if (failures.length === 0) return true; // legacy red — fail-closed toward stopping
  const globs = Array.isArray(touches) ? touches : parseTouches(touches).globs;

  let sawUnknown = false;
  for (const f of failures) {
    const loc = classifyFailure(f);
    if (loc.kind === "shared-gate") return true; // shared gate pollutes every scoped run
    if (loc.kind === "unknown") {
      sawUnknown = true;
      continue;
    }
    if (loc.file && globs.some((g) => matchGlob(g, loc.file))) return true; // candidate would run this red
  }
  return sawUnknown; // any unclassifiable failure ⇒ fail-closed block
}

export interface RunOnceResult {
  status: SuiteStateValue | "absent";
  events: SuiteStateEvent[];
  stopSignal: boolean;
}

/** AC1/AC3 纯转变检测器：上一个状态 → 下一个状态，产出一条套件状态事件（无转变 = null）。 */
export function detectSuiteEvent(
  prev: SuiteStateValue | null,
  next: SuiteStateValue,
): SuiteEventKind | null {
  if (prev === next) return null;
  if (next === "red") return "SUITE-RED";
  if (next === "running") return "SUITE-RUNNING";
  if (next === "green") return "SUITE-GREEN";
  return null;
}

function statePath(root: string): string {
  return path.join(root, ".quay", "full-suite-state.json");
}
function eventsPath(root: string): string {
  return path.join(root, ".quay", "suite-state-events.jsonl");
}
function memoPath(root: string): string {
  return path.join(root, ".quay", "suite-state-last.json");
}

function readJson<T>(p: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(p, "utf8")) as T;
  } catch {
    return null;
  }
}

/** 读套件状态文件；缺文件（外层还没跑第一轮）= null，不是错误。 */
export function readSuiteState(root: string): SuiteState | null {
  return readJson<SuiteState>(statePath(root));
}

// ── AC6 crash-watchdog (gap-full-suite-state-red-no-failure-detail-static-check-invisible) ──────────
// A `running` state whose RUNNER is no longer alive must not stay `running` forever — consumers
// cannot distinguish "suite running" from "runner died mid-run" (the proposal-convergence deadlock:
// state stuck at running mtime=23:16, never a terminal state, consumers kept thinking it was in
// flight). SIGKILL is uncatchable in-process, so the dying runner CANNOT write the terminal state
// itself — this watchdog (driven by the always-on runOnce poll) is the only mechanism that can.
//   - the runner writes `pid` on every state (post-fix); a running state whose PID is dead ⇒ crashed.
//   - legacy running states (no pid, written before the fix) fall back to a stale-AGE threshold.
// The threshold is generous (60 min): the runner's own max-runtime guard kills the child tree and
// writes a terminal state at 45 min, so a LIVE runner can never exceed it — a pid-absent running
// state older than it is almost certainly a dead-runner leftover.
export const RUNNING_STALE_MS = 60 * 60_000;

/** Is a process with this PID currently alive? (ESRCH = no such process = dead; EPERM = exists but not ours = alive.) */
export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}

/**
 * AC6 — given a `running` state, return the terminal `crashed` state when the RUNNER is dead
 * (SIGKILL / uncaught crash left `running` on disk), else null (genuinely running). A running state
 * with a LIVE PID is always treated as in-progress regardless of age; a pid-absent legacy running
 * state is crashed only once it is older than RUNNING_STALE_MS (see the block comment above).
 */
export function detectCrashedRunner(state: SuiteState | null, now = Date.now()): SuiteState | null {
  if (!state || state.state !== "running") return null;
  const startedAtMs = typeof state.startedAt === "string" ? Date.parse(state.startedAt) : NaN;
  if (typeof state.pid === "number" && Number.isFinite(state.pid) && state.pid > 0) {
    if (isProcessAlive(state.pid)) return null; // the runner is genuinely alive — still running
  } else if (!Number.isFinite(startedAtMs) || now - startedAtMs < RUNNING_STALE_MS) {
    return null; // legacy running state (no pid) too fresh to call dead — fail-open toward "running"
  }
  const atIso = new Date(now).toISOString();
  return {
    ...state,
    state: "red",
    reason: "crashed",
    finishedAt: Math.floor(now / 1000), // epoch seconds — same unit the runner's terminal writes use
    durationMs: Number.isFinite(startedAtMs) ? now - startedAtMs : null,
  };
}

/**
 * AC6 — write the crash-watchdog's terminal state to disk, guarded: the file is only overwritten if
 * it STILL holds the SAME run's `running` state (a newer runner may have established a new generation
 * since our read — the watchdog must never clobber it). Fail-open: a write failure never crashes the
 * trigger loop (a later poll retries).
 */
function writeCrashState(root: string, crashed: SuiteState): void {
  try {
    const p = statePath(root);
    const onDisk = readJson<SuiteState>(p);
    if (!onDisk || onDisk.state !== "running") return; // already terminal / absent — nothing to do
    if (crashed.runId && onDisk.runId !== crashed.runId) return; // newer generation owns the file
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, JSON.stringify(crashed, null, 2) + "\n", "utf8");
  } catch {
    // best-effort — the watchdog is a notifier, never a gate
  }
}

/**
 * 记录一条转变事件到 append-only 日志（measure 钩子）。无转变 = 不写，返回 null。
 * 写日志不是「决策」——它是状态变化的事实记录，处置决策由外层既有逻辑做（AC2/AC4）。
 * 写失败只回落到「事件仍返回给调用方（可打印）但不落盘」，绝不 crash——触发者是通知者，
 * 不是闸（同 session-liveness `sl_emit_shared` 的 fail-open 原则：调度角色不是安全检查）。
 */
export function recordTransition(
  root: string,
  prev: SuiteStateValue | null,
  nextState: SuiteState | null,
): SuiteStateEvent | null {
  if (!nextState) return null;
  const kind = detectSuiteEvent(prev, nextState.state);
  if (!kind) return null;
  const ev: SuiteStateEvent = {
    event: kind,
    at: new Date().toISOString(),
    early: nextState.state === "red" && nextState.finishedAt === null,
    stopSignal: shouldStopDispatch(nextState),
    state: nextState,
    // SUITE-RED carries the failure location — the input to the shared-gate-vs-specific-test
    // dispatch conditional (gap-red-window-dispatch-stop-should-be-shared-gate-conditional).
    // A factual projection of state.failures (translation, not a dispatch decision).
    ...(kind === "SUITE-RED" && nextState.failures
      ? { failureLocation: nextState.failures.map((f) => classifyFailure(f)) }
      : {}),
  };
  try {
    fs.mkdirSync(path.dirname(eventsPath(root)), { recursive: true });
    fs.appendFileSync(eventsPath(root), JSON.stringify(ev) + "\n", "utf8");
  } catch {
    // 日志写失败不阻断触发（事件仍由 stdout 通知）；绝不 crash 调用方（runner/Monitor）。
  }
  return ev;
}

/**
 * 跑一轮：读状态 → 与记忆比较 → 记录转变事件 → 更新记忆。
 * 冷启动即红/即 running（无记忆文件，prev=null）：也记一条——外层 /clear 后重启时套件仍红，
 * 正是 ROUND 2「红着无人处置」要消灭的形态，必须一挂上就触发，而不是等下一次 cron。
 * （第一眼是 green 不记事件——那是平静基线，无转变。）
 */
export function runOnce(root: string): RunOnceResult {
  const memo = readJson<{ state: SuiteStateValue | null }>(memoPath(root));
  const prev: SuiteStateValue | null = memo?.state ?? null;
  let cur = readSuiteState(root);

  // AC6 (gap-full-suite-state-red-no-failure-detail-static-check-invisible) — crash-watchdog: a
  // `running` state whose RUNNER is dead (SIGKILL / uncaught crash) must not stay `running` forever.
  // Detect it, write the terminal reason=crashed state, and let the normal transition machinery fire
  // SUITE-RED so every consumer (inner stop-condition / suite-state-trigger / outer tick) sees the
  // death on the STATE file itself, not only in its own in-memory read. stopSignal stays false
  // (routeRed routes crashed → resource-gate: no correctness conclusion), and the SUITE-RED event
  // carries the crashed state so the outer knows to re-launch the suite.
  if (cur && cur.state === "running") {
    const crashed = detectCrashedRunner(cur);
    if (crashed) {
      writeCrashState(root, crashed);
      // Re-read so the authoritative on-disk state drives the transition below (a guarded write that
      // a newer generation refused leaves the file untouched — `cur` stays the live running state).
      cur = readSuiteState(root) ?? crashed;
    }
  }
  const status: SuiteStateValue | "absent" = cur?.state ?? "absent";

  const events: SuiteStateEvent[] = [];
  if (cur) {
    if (prev !== null) {
      // 常规转变路径：上一个已知状态 → 当前状态
      const ev = recordTransition(root, prev, cur);
      if (ev) events.push(ev);
    } else if (cur.state !== "green") {
      // 第一眼（冷启动）即 red/running → 也要触发（红窗无人处置的形态；running 触发乐观执行者）
      const ev = recordTransition(root, null, cur);
      if (ev) events.push(ev);
    }
  }

  try {
    fs.mkdirSync(path.dirname(memoPath(root)), { recursive: true });
    fs.writeFileSync(
      memoPath(root),
      JSON.stringify({ state: status === "absent" ? null : status }, null, 2) + "\n",
      "utf8",
    );
  } catch {
    // 记忆写失败不阻断本轮检测（下次轮询会重新比较——至多多记一条，不会漏掉红）。
  }

  return { status, events, stopSignal: shouldStopDispatch(cur) };
}

function formatEventLine(ev: SuiteStateEvent): string {
  const loc = ev.failureLocation;
  const locSummary = loc
    ? ` failures=${loc.length} sharedGate=${loc.filter((l) => l.kind === "shared-gate").length}` +
      ` specificTest=${loc.filter((l) => l.kind === "specific-test").length}`
    : "";
  return (
    `${ev.event} state=${ev.state?.state ?? "?"} early=${ev.early} ` +
    `stopSignal=${ev.stopSignal} at=${ev.at}${locSummary}`
  );
}

async function runMonitor(root: string, intervalMs: number): Promise<number> {
  // 首轮先跑一次（建立基线/冷启动即红的立即触发），随后按间隔轮询。
  for (;;) {
    const { events } = runOnce(root);
    for (const ev of events) {
      // stdout 是外层 Monitor 的事件流 → 立即推送（不等 20 分钟 cron）
      console.log(formatEventLine(ev));
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

function parseArg(argv: string[], name: string): string | undefined {
  const idx = argv.indexOf(name);
  return idx !== -1 && argv[idx + 1] ? argv[idx + 1] : undefined;
}

export async function run(argv: string[]): Promise<number> {
  const root = path.resolve(parseArg(argv, "--root") ?? REPO_ROOT);
  const interval = Number(parseArg(argv, "--interval") ?? "5");

  if (argv.includes("--monitor") || !argv.includes("--once")) {
    const intervalMs = Number.isFinite(interval) && interval > 0 ? interval * 1000 : 5000;
    return runMonitor(root, intervalMs);
  }

  // --once：跑一轮（测试接缝 + tick/排障）
  const { status, events, stopSignal } = runOnce(root);
  console.log(`SUITE-STATUS ${status}`);
  for (const ev of events) {
    console.log(formatEventLine(ev));
  }
  console.log(`stopSignal=${stopSignal}`);
  return 0;
}

// 测试辅助：把状态文件写到临时根（fixture 构造用）。
export function writeSuiteState(root: string, state: SuiteState): void {
  fs.mkdirSync(path.dirname(statePath(root)), { recursive: true });
  fs.writeFileSync(statePath(root), JSON.stringify(state, null, 2) + "\n", "utf8");
}

// 测试辅助：读事件日志。
export function readSuiteEvents(root: string): SuiteStateEvent[] {
  try {
    return fs
      .readFileSync(eventsPath(root), "utf8")
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as SuiteStateEvent);
  } catch {
    return [];
  }
}

const isDirect = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isDirect) {
  const exitCode = await run(process.argv.slice(2));
  process.exit(exitCode);
}
