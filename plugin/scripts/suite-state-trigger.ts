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
//   AC2/AC3 扩展（gap-red-window-dispatch-stop-should-be-shared-gate-conditional，2026-08-06）：SUITE-RED
//         事件携带失败位置（failure.scope + failure.files，从 early-RED 失败行/套件日志派生——判定信息
//         现成，不需新机制）→ 供 inner 派发决策按作用域条件化：失败落共享闸门（run_static_checks）才停
//         派发；失败落具体测试文件且与新任务触摸集无关 ⇒ 派发继续。fan-in 暂缓仍一律（AC1）。
//
// 状态文件（输入，well-known 位置）：<root>/.quay/full-suite-state.json
//   {state: running|green|red, reason?: failed|aborted|infra-error, runner, startedAt, finishedAt,
//    durationMs, laneCount}
//   —— (a) 块的 full-suite-runner.ts 写它；本脚本只读。`reason` 只在 red 时出现（原因轴，AC5/AC1）：
//      failed（真实失败——stop-dispatch 信号）/ aborted（无正确性结论——不触发停派）/
//      infra-error（环境问题——同样不触发代码风险停派）。
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

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");

export type SuiteStateValue = "running" | "green" | "red";
export type SuiteStateReason = "failed" | "aborted" | "infra-error";

export interface SuiteState {
  state: SuiteStateValue;
  runner?: string;
  startedAt?: string;
  finishedAt?: string | null;
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
}

/** The AC2 reason-axis route a red state takes (gap-suite-state-has-no-reason-axis-failed-aborted-infra). */
export type RedRoute = "red-window-triage" | "resource-gate" | "proceed";

/**
 * AC2 — route a suite state by its reason axis. The state=red stop-dispatch signal is the red-window
 * rule's CODE-RISK stop; it fires ONLY when the red carries a real failure conclusion:
 *   - red + reason=failed (or legacy red, missing reason — fail-closed) ⇒ "red-window-triage":
 *     STOP dispatch + red-window triage (定位肇事 merge).
 *   - red + reason=aborted (NO correctness conclusion — signal kill / spawn error / early gate-WAIT
 *     exit) ⇒ "resource-gate": do NOT stop on code risk; recovery is decided by resource-gate.sh's
 *     GO/WAIT (the "现在能不能压" criterion) — the coincidence where a lingering abort-red keeps
 *     dispatch stopped with NO evidence (gap-suite-state-has-no-reason-axis-failed-aborted-infra AC3)
 *     cannot happen.
 *   - red + reason=infra-error (environment problem — neither a code failure nor a deliberate abort)
 *     ⇒ "resource-gate" too: it carries no code-failure conclusion, so it must not stop dispatch on
 *     code risk either.
 *   - non-red / absent state file ⇒ "proceed".
 */
export function routeRed(state: SuiteState | null): RedRoute {
  if (!state || state.state !== "red") return "proceed";
  if (state.reason === "aborted" || state.reason === "infra-error") return "resource-gate";
  return "red-window-triage";
}

/**
 * AC5 — the RED-failure signal on a suite state (the reason axis). `state: red` + `reason: failed`
 * (or a missing reason, legacy/fail-closed) ⇒ TRUE — the blanket RED-failure signal that ALWAYS
 * holds fan-in (AC1, the real protection: red tree stays bisectable); `state: red` + `reason:
 * aborted|infra-error` (no correctness conclusion) ⇒ do NOT fire — the outer records the abort and
 * re-runs when the resource gate reports GO. Absent state file ⇒ do NOT block.
 *
 * NOTE (gap-red-window-dispatch-stop-should-be-shared-gate-conditional, 2026-08-06): in the
 * conditional model this is the AC1 FAN-IN-HOLD signal (blanket), NOT the per-task DISPATCH stop —
 * dispatch is further conditioned on the failure SCOPE via `shouldStopDispatchForFailure` (AC2).
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
  /**
   * AC2/AC3 (gap-red-window-dispatch-stop-should-be-shared-gate-conditional) — the FAILURE LOCATION
   * of a SUITE-RED event, derived from the early-RED failure line in the suite log (判定信息现成,
   * no new mechanism). Present only on SUITE-RED; null when there is no failure info (e.g. no log).
   * The inner dispatch decision conditions on it: dispatch stops ONLY when the failure lands in the
   * shared gate (run_static_checks — every scoped run pays it) OR in a specific test file that
   * intersects the new task's touch-set; a specific-test-file failure unrelated to the touches does
   * NOT stop dispatch (the new task's worktree runs its own scoped tests on an independent
   * master-branch copy).
   */
  failure?: FailureLocation | null;
  state: SuiteState | null;
}

export interface RunOnceResult {
  status: SuiteStateValue | "absent";
  events: SuiteStateEvent[];
  stopSignal: boolean;
  /** AC2 — the SUITE-RED failure location (null when not red / no failure info). */
  failure: FailureLocation | null;
}

// ── AC2/AC3 failure-location axis (gap-red-window-dispatch-stop-should-be-shared-gate-conditional) ──
//
// The red-window RED handling was a coarse blanket ("stop dispatch + hold fan-in") but the two
// actions have very different real risk:
//   - HOLD FAN-IN is the real protection (mixing failures on the red tree makes bisect hard) and
//     stays BLANKET on RED failed (AC1) — this is what `shouldStopDispatch` now names.
//   - STOP DISPATCH is mostly unnecessary (worktrees are independent master-branch copies running
//     their own scoped tests, unrelated to the red elsewhere). The ONLY dispatch-danger is when the
//     red lands in a SHARED GATE — run_static_checks, which EVERY scoped run pays — because then
//     every new task is polluted by the same red. That is DETERMINABLE from the early-RED failure
//     line (AC3), so dispatch is conditioned (AC2): `shouldStopDispatchForFailure(failure, touches)`.

export type FailureScope = "shared-gate" | "test-file" | "unknown";

export interface FailureLocation {
  scope: FailureScope;
  /** The failing test file(s) (relative paths) when scope = "test-file"; empty otherwise. */
  files?: string[];
}

// Static-check phase marker: the run_static_checks headers are `== <name> check (<suffix>) ==` lines
// (e.g. "== task-contract-check (gap-dispatch-gate-has-no-checklist-and-no-trace, AC6) =="); under
// `set -e` a failed checker aborts the suite BEFORE the test phase, so a RED log that reaches this
// phase and has NO test-failure line is a shared-gate failure. `run_static_checks` / 静态检查 named
// explicitly for the docs' and fixtures' readability.
const STATIC_PHASE_MARKER = /run_static_checks|静态检查|static-check|^==\s+\S+.*==$/m;
const TEST_FAILURE_MARKER =
  /^[ \t]*not ok\b|❯\s+\S+\s+\(\d+\s*tests?\s*\|\s*[1-9]\d*\s+failed|Test Files\s+[1-9]\d*\s+failed|^[ \t]*#\s*cancelled\s+[1-9]/m;

/**
 * AC2/AC3 — classify a single suite-output line into a failure SCOPE. Shared gate = a
 * run_static_checks checker (every scoped run pays it); specific test = a test-file failure line
 * (vitest `❯ <file> (N tests | M failed)` names the file directly; node:test TAP `not ok` is a
 * per-test failure whose file `extractFailingFiles` resolves via the enclosing `# Subtest: <file>`).
 */
export function classifyFailureLine(line: string): FailureLocation {
  if (STATIC_PHASE_MARKER.test(line)) return { scope: "shared-gate" };
  const vitest = /❯\s+(\S+)\s+\(\d+\s*tests?\s*\|\s*[1-9]\d*\s+failed/i.exec(line);
  if (vitest) return { scope: "test-file", files: [vitest[1]] };
  if (/^[ \t]*not ok\b/i.test(line)) return { scope: "test-file" };
  if (/^[ \t]*#\s*cancelled\s+[1-9]/.test(line)) return { scope: "test-file" };
  return { scope: "unknown" };
}

/**
 * AC2/AC3 — extract the failing test FILE PATHS from a suite log. Handles node:test TAP
 * (`# Subtest: <file>` names the currently-running file; a `not ok` / cancelled line inside it is a
 * failure of that file) and vitest (`❯ <file> (N tests | M failed)` names the file directly).
 */
export function extractFailingFiles(log: string): string[] {
  const files: string[] = [];
  const seen = new Set<string>();
  let currentFile: string | null = null;
  const add = (f: string) => {
    if (f && !seen.has(f)) {
      seen.add(f);
      files.push(f);
    }
  };
  for (const line of log.split("\n")) {
    // FILE-level subtest is at column 0: `# Subtest: <file>`. Test-level `# Subtest:` lines are
    // INDENTED and must NOT overwrite the current file.
    const fileSub = /^#\s*Subtest:\s+(\S+)/.exec(line);
    if (fileSub) {
      currentFile = fileSub[1];
      continue;
    }
    // a `not ok` line (indented under the file subtest, or at column 0) is a failure of the file
    if (/^[ \t]*not ok\b/.test(line) && currentFile) add(currentFile);
    const vit = /❯\s+(\S+)\s+\(\d+\s*tests?\s*\|\s*[1-9]\d*\s+failed/i.exec(line);
    if (vit) add(vit[1]);
    if (/^[ \t]*#\s*cancelled\s+[1-9]/.test(line) && currentFile) add(currentFile);
  }
  return files;
}

/**
 * AC2/AC3 — derive the failure LOCATION of a red suite from its log. A specific test-file failure
 * (the test phase ran and a file/test failed) → scope "test-file" with the failing files; a
 * shared-gate failure (the static-check phase was reached and NO test failure line exists — under
 * `set -e` a failed checker aborts BEFORE the test phase) → scope "shared-gate"; neither → "unknown"
 * (fail-closed toward stopping). Absent log → null (fail-closed too).
 */
export function deriveFailureLocation(log: string | null | undefined): FailureLocation | null {
  if (!log) return null;
  if (TEST_FAILURE_MARKER.test(log)) {
    return { scope: "test-file", files: extractFailingFiles(log) };
  }
  if (STATIC_PHASE_MARKER.test(log)) return { scope: "shared-gate" };
  return { scope: "unknown" };
}

/** Path intersection: does a failing test file relate to a touch-set entry (equal, or under a dir)? */
export function failureIntersectsTouches(failedFile: string, touches: string[]): boolean {
  const norm = (p: string) => p.replace(/^\.\//, "");
  const f = norm(failedFile);
  return touches.some((raw) => {
    const t = norm(raw);
    if (t === f) return true;
    if (t.endsWith("/") && f.startsWith(t)) return true; // directory touch: "plugin/test/"
    if (f.startsWith(t + "/")) return true; // file under a directory touch
    return false;
  });
}

/**
 * AC2 — the CONDITIONAL dispatch decision on a red suite's failure location. Dispatch stops ONLY
 * when the failure lands in the shared gate (run_static_checks — every scoped run pays it) or in a
 * specific test file that intersects the new task's touch-set; a specific-test-file failure
 * UNRELATED to the touches does NOT stop dispatch (the worktree runs its own scoped tests).
 * Absent/unknown failure info fails CLOSED toward stopping (the conservative blanket default).
 */
export function shouldStopDispatchForFailure(
  failure: FailureLocation | null,
  touches: string[],
): boolean {
  if (!failure || failure.scope === "unknown") return true;
  if (failure.scope === "shared-gate") return true;
  return (failure.files ?? []).some((f) => failureIntersectsTouches(f, touches));
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
function suiteLogPath(root: string): string {
  return path.join(root, ".quay", "full-suite.log");
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

/**
 * 读套件日志（early-RED 失败行所在；full-suite-runner.ts 把完整输出 tee 到 .quay/full-suite.log）。
 * AC2/AC3 的判定信息从它派生（失败位置现成，不需新机制）。缺文件 = null（无失败信息，fail-closed）。
 */
export function readSuiteLog(root: string): string | null {
  try {
    return fs.readFileSync(suiteLogPath(root), "utf8");
  } catch {
    return null;
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
  // AC2/AC3 — SUITE-RED carries the FAILURE LOCATION (derived from the early-RED failure line in
  // the suite log) so the inner dispatch decision can be conditional on shared-gate vs specific test.
  const failure: FailureLocation | null =
    kind === "SUITE-RED" ? deriveFailureLocation(readSuiteLog(root)) : null;
  const ev: SuiteStateEvent = {
    event: kind,
    at: new Date().toISOString(),
    early: nextState.state === "red" && nextState.finishedAt === null,
    stopSignal: shouldStopDispatch(nextState),
    failure,
    state: nextState,
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
  const cur = readSuiteState(root);
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

  // AC2 — the SUITE-RED failure location (red-state view; null when not red / no failure info).
  const failure: FailureLocation | null =
    cur?.state === "red" ? deriveFailureLocation(readSuiteLog(root)) : null;

  return { status, events, stopSignal: shouldStopDispatch(cur), failure };
}

function formatEventLine(ev: SuiteStateEvent): string {
  const fail = ev.failure
    ? ` failure=${ev.failure.scope}${ev.failure.files?.length ? ":" + ev.failure.files.join(",") : ""}`
    : "";
  return (
    `${ev.event} state=${ev.state?.state ?? "?"} early=${ev.early} ` +
    `stopSignal=${ev.stopSignal}${fail} at=${ev.at}`
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
