// plugin/scripts/suite-driver.ts — per-task suite 生命周期收进一个常驻 driver kind。
// (tasks/gap-suite-lifecycle-driver-kind / SPEC-suite-lifecycle-and-failure-semantics-2026-08-26 §3)
//
// WHY THIS EXISTS（SPEC §3.1 实测）：per-task suite 必须 detach 于 subagent（Bash 单次 600s 硬顶 +
// `run_in_background` 被 harness 连带杀），但现有 detach 由 `setsid + & + disown` 起在独立 session
// （fan-in-execute.js SUITE_LAUNCH）——【没有任何进程在 wait 它】，挂死检测只有辅（外部定时扫）、
// 没有主（父进程 wait）。代价：ac143 挂死 33.7 分钟、lpt-lookback 挂死 199.5 分钟，全靠人工 kill。
// 常驻 driver 不是 subagent —— 它可以直接 spawn 并 wait，拿回进程级父子关系。
//
// 本 driver 是【唯一】spawn per-task suite 的地方：
//   主（进程级，自动）  driver 直接 spawn suite 并 wait ⇒ 子进程退出立即得知，三态可分：
//                      正常退出 / 非零退出 / 被信号杀
//   辅（定时，兜底）    同一 wait 循环顺带查「活着但无输出 ≥N 秒」⇒ 判静默挂死 ⇒ 杀 + 记可区分失败态
//   资源集成            spawn 前取单飞槽（经统一后的 full_suite_lock_acquire 同一套 slot 文件）、
//                       子进程终结后释放槽 ⇒ 取/放同一执行点 ⇒「让槽不让 lane」结构上不可能再发生
//   carriers            suite-round.jsonl（每轮一条，outcome 三态可分：done / red / hung）
//
// 分层（AC151 两级抽象）：继承 Layer 0（driver-runtime：isHalted / appendHeartbeatLine / ts / sleep /
// DRIVER_KINDS registry / supervisor respawn / 五运维动词）。⛔ 不继承 Layer 1a（无候选池 / 无选择 /
// 无 verify）也⛔ 不继承 Layer 1b（单元不是例程）——本 driver 的单元是【suite 运行请求】，产出是
// 【三态 outcome】。slot 槽路径读 TS 侧单一真相源 suite-lock-slots.ts（与 bash suite-slot-lib.sh 同一
// 语义，suite-slot-ssot-check 校验两边一致）。
//
// 硬规则 3b（AC2 判据）：`hung` 是与 `done`、与 `red` 可区分的独立取值——挂死被杀后绝不记成「红」或
// 「没跑完」（三种成因压成一个值正是 SPEC §1.1 泄漏② 要修的病）。

import fs from "node:fs";
import path from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import { isDirectEntry } from "./gate-script-base.ts";
// Layer 0（driver-runtime 单一实现）：registry（controlFile/carriers 单源）、isHalted（控制面 halt）、
// ts / sleep / appendHeartbeatLine（心跳/载体）。⛔ 不从 worker/promotion/quality 中转。
import { DRIVER_KINDS, isHalted, ts, sleep, appendHeartbeatLine } from "./driver-runtime.ts";
// suite 槽路径单一真相源（TS 侧；与 bash suite-slot-lib.sh 同语义）。
import { suiteLockBase } from "./suite-lock-slots.ts";

// ── 常量（由 DRIVER_KINDS registry 派生，⛔ 不另写一份路径字面量）──────────────────────────
const SUITE_SPEC = DRIVER_KINDS.suite;
/** 主载体（.quay/suite-round.jsonl，gitignored 运行时日志——每轮一条三态 outcome）。 */
export const ROUND_LOG_REL = SUITE_SPEC.carriers[0];
/** 控制态文件（.quay/suite-control.json，halt 单一真相源，与其它 kind 同族）。 */
export const SUITE_CONTROL_STATE_REL = path.posix.join(".quay", SUITE_SPEC.controlFile);
/** 请求/结果目录（相对 <root>/.quay/；fan-in 写请求、读结果，driver 写结果）。 */
export const SUITE_REQUESTS_DIR_REL = path.posix.join(".quay", "suite-requests");
export const SUITE_RESULTS_DIR_REL = path.posix.join(".quay", "suite-results");

/** 轮间隔缺省（毫秒）。占位节奏——生产部署由启动命令传 --interval 覆盖；测试传小值。 */
export const INTERVAL_MS_DEFAULT = 1000;

/** 静默挂死阈值缺省（毫秒）：活着但无输出 ≥N 秒 ⇒ 判挂死。与 full-suite-runner 的 SUITE_SILENCE_MS
 *  同族（15 分钟）；测试经 --silence-timeout-ms 或 env QUAY_TEST_SUITE_DRIVER_SILENCE_MS 传小值。 */
export const SILENCE_MS_DEFAULT = Number(process.env.QUAY_TEST_SUITE_DRIVER_SILENCE_MS ?? 15 * 60_000);

/** 静默检测粒度（毫秒）：wait 循环里每隔这么长看一眼日志 mtime / 子进程存活。 */
export const SILENCE_POLL_MS = 1000;

// ── 三态 outcome（AC2：hung 是可区分独立取值，⛔ 与 done/red 同形）──────────────────────────
export type SuiteOutcome = "done" | "red" | "hung";

/** 一轮 suite 运行的可分结果（进程级父子 wait 立即得知的三态 + 退出方式）。 */
export interface SuiteRunResult {
  outcome: SuiteOutcome;
  /** 退出码（正常退出时有值；被信号杀时为 null）。 */
  exitCode: number | null;
  /** 信号名（被信号杀时有值，如 "SIGKILL"/"SIGTERM"；正常退出为 null）。 */
  signalCode: string | null;
  /** true = 静默看门狗判挂死并杀了它（⛔ 与「红」区分的关键位）。 */
  hungByWatchdog: boolean;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  error: string | null;
  /** suite 子进程 pid（spawn 后即有值；spawn 失败为 null）。gap-fan-in-driver-mechanical-
   *  orchestration AC3 判据输入：suite 是 driver 的子进程（ppid 指向 driver）⛔ 非 setsid+&+disown
   *  孤儿（ppid=1）——调用方据 pid 读 /proc/<pid>/stat 的 ppid 验证。 */
  pid: number | null;
}

// ── slot-holder wrapper（bash）：取槽 → exec，持锁跨 exec、随子进程终结自然释放 ────────────────
// 复用 bash 侧 suite-slot-lib.sh 的 suite_slot_paths（同一 S 单一真相源），FD 动态分配、非阻塞试每槽、
// 全忙则无界排队（flock -w 1 逐槽重试）——与 scripts/test.sh 的 full_suite_lock_acquire 同一语义。exec
// 后 FD 继承给 suite 进程，suite 退出 ⇒ FD 关闭 ⇒ flock 自动释放（crash-autorelease 保留：挂死被杀也
// 不会泄漏槽）。取/放都在这一个执行点（suite_slot_holder 函数）⇒ 释放原子（AC4）。
const SLOT_HOLDER_FN = `
suite_slot_holder() {
  local base="\$1"; shift
  local lib="\$1"; shift
  source "\$lib"
  local slots=() fds=() fd="" held="" idx=0
  while IFS= read -r s; do slots+=("\$s"); done < <(suite_slot_paths "\$base")
  for s in "\${slots[@]}"; do
    exec {fd}>"\$s" 2>/dev/null && fds+=("\$fd")
  done
  for fd in "\${fds[@]}"; do
    if flock -n "\$fd" 2>/dev/null; then held="\$idx"; break; fi
    idx=\$((idx+1))
  done
  if [ -z "\$held" ]; then
    while [ -z "\$held" ]; do
      idx=0
      for fd in "\${fds[@]}"; do
        if flock -w 1 "\$fd" 2>/dev/null; then held="\$idx"; break; fi
        idx=\$((idx+1))
      done
    done
  fi
  exec "\$@"
}
`;

/** 组装「取槽 + 跑 suite」的子进程 argv：bash 包一层（source suite-slot-lib.sh 需要 bash），
 *  slot-holder 取槽后 exec 掉 suite 命令。detached=true 让 driver 的 child 成为进程组组长，
 *  静默挂死时 SIGKILL 整组（test.sh + node --test 子进程都收掉）。 */
export function slotHolderArgv(args: {
  slotBase: string;
  slotLib: string;
  suiteCommand: string[];
}): string[] {
  const inner = args.suiteCommand.map((a) => JSON.stringify(a)).join(" ");
  const script = `${SLOT_HOLDER_FN}\nsuite_slot_holder ${JSON.stringify(args.slotBase)} ${JSON.stringify(args.slotLib)} ${inner}`;
  return ["bash", "-c", script];
}

// ── 静默看门狗 + 进程级 wait（AC2/AC3 核心）─────────────────────────────────────────────────
/** 日志文件的最新 mtime（毫秒 epoch；读失败/不存在 ⇒ null——「无输出」的真值载体）。 */
export function logMtimeMs(logFile: string | null | undefined): number | null {
  if (!logFile) return null;
  try {
    return Math.floor(fs.statSync(logFile).mtimeMs);
  } catch {
    return null;
  }
}

/** kill 整个进程组（detached=true 的 child 是组长；失败回退单 pid kill）。 */
function killTree(child: ChildProcess, signal: NodeJS.Signals): void {
  try {
    if (child.pid) process.kill(-child.pid, signal);
  } catch {
    try { child.kill(signal); } catch { /* gone */ }
  }
}

/**
 * 直接 spawn suite 并 wait（进程级父子）＋ 定时兜底静默检测。取槽（slot-holder）→ 跑 suite →
 * 释放（exec 后随子进程终结自然释放，同一执行点）。静默 = 日志 mtime 停止前进 ≥ silenceMs ⇒
 * SIGKILL 整组 + outcome=hung（可区分独立取值）。永不 throw；返回三态结果。
 */
export async function spawnSuiteAndWait(args: {
  slotBase: string;
  slotLib: string;
  suiteCommand: string[];
  logFile: string | null;
  silenceMs?: number;
  env?: Record<string, string>;
}): Promise<SuiteRunResult> {
  const { slotBase, slotLib, suiteCommand, logFile, env } = args;
  const silenceMs = args.silenceMs ?? SILENCE_MS_DEFAULT;
  const startedAt = new Date().toISOString();
  const startedMs = Date.now();

  return new Promise((resolve) => {
    let child: ChildProcess;
    try {
      const holder = slotHolderArgv({ slotBase, slotLib, suiteCommand });
      child = spawn(holder[0], holder.slice(1), {
        detached: true,
        stdio: ["ignore", "pipe", "pipe"],
        // 「driver 持槽」是 spawnSuiteAndWait 的结构不变式（slot-holder 在 exec 前【总是】取单飞槽），
        // 不是 caller 的选择 ⇒ 强制注入，放在 `...(env ?? {})` 之后（⛔ 不被 caller 的 env 覆盖）。
        // gap-mech-fan-in-suite-silence-watchdog-fired：机械 fan-in 路径漏传本 env ⇒ scripts/test.sh
        // --buckets 的 full_suite_lock_acquire 不跳过再取槽，用自己的新 FD 对【同一把槽】再 flock，
        // 被 slot-holder 继承下来的 FD 拒绝（flock 按 open-file-description，同进程不同 FD 也互斥）⇒
        // 卡进无界 while 等槽循环 ⇒ 零输出 ≥15min ⇒ 静默看门狗误当挂死 SIGKILL。
        env: {
          ...process.env,
          ...(env ?? {}),
          QUAY_TEST_SUITE_DRIVER_HOLDS_SLOT: "1",
        },
      });
    } catch (e) {
      resolve({
        outcome: "red", exitCode: null, signalCode: null, hungByWatchdog: false,
        startedAt, finishedAt: new Date().toISOString(), durationMs: Date.now() - startedMs,
        error: `spawn failed: ${(e as Error).message}`, pid: null,
      });
      return;
    }
    const childPid: number | null = child?.pid ?? null;

    let settled = false;
    let hungByWatchdog = false;
    // 「输出还在推进吗」的真值载体：suite 的 stdout/stderr（fake suite 直写 stdout）＋ 日志文件 mtime
    // （生产路径 suite 输出 tee 到 log、stdout 空）。任一推进都刷新 lastActivityMs。
    let lastActivityMs = Date.now();
    let lastLogMtime = logMtimeMs(logFile);
    child.stdout?.on("data", () => { lastActivityMs = Date.now(); });
    child.stderr?.on("data", () => { lastActivityMs = Date.now(); });

    const finish = (r: SuiteRunResult): void => {
      if (settled) return;
      settled = true;
      clearInterval(watchdog);
      resolve(r);
    };

    // 静默看门狗（定时兜底）：每 SILENCE_POLL_MS 看一眼「输出还在推进吗」。stdout/stderr 与日志 mtime
    // 都停止前进 ≥ silenceMs 且子进程仍活着 ⇒ 判静默挂死 ⇒ SIGKILL 整组 + hung（可区分独立取值）。
    const watchdog = setInterval(() => {
      if (settled) { clearInterval(watchdog); return; }
      const mtime = logMtimeMs(logFile);
      if (mtime !== null && mtime !== lastLogMtime) {
        lastLogMtime = mtime;
        lastActivityMs = Date.now();
      }
      if (Date.now() - lastActivityMs >= silenceMs) {
        hungByWatchdog = true;
        killTree(child, "SIGKILL");
      }
    }, SILENCE_POLL_MS);

    child.on("error", (e) => {
      finish({ outcome: "red", exitCode: null, signalCode: null, hungByWatchdog, startedAt, finishedAt: new Date().toISOString(), durationMs: Date.now() - startedMs, error: `spawn error: ${e.message}`, pid: childPid });
    });
    child.on("close", (code, signal) => {
      const finishedAt = new Date().toISOString();
      const durationMs = Date.now() - startedMs;
      // 三态可分（AC2）：被静默看门狗杀 ⇒ hung（独立取值）；正常退出 0 ⇒ done；非零/信号 ⇒ red。
      const outcome: SuiteOutcome = hungByWatchdog ? "hung" : code === 0 ? "done" : "red";
      finish({
        outcome,
        exitCode: code,
        signalCode: signal ?? null,
        hungByWatchdog,
        startedAt, finishedAt, durationMs,
        error: hungByWatchdog ? "silence watchdog killed the suite (no output ≥ silence timeout)" : null,
        pid: childPid,
      });
    });
  });
}

// ── 请求 / 结果协议（fan-in 写请求、读结果；driver 读请求、写结果）────────────────────────
export interface SuiteRequest {
  task: string;
  worktree: string;
  runId: string;
  /** driver 实际 spawn 的命令（会被 slot-holder 包一层）。缺省 = test.sh --buckets <task>。 */
  suiteCommand: string[];
  /** 静默看门狗盯的日志文件（suite 输出 tee 到这里）。 */
  logFile: string | null;
  requestedAt: string;
}

/** 解析一个请求 JSON。读不懂/结构不完整 ⇒ null（fail-closed 跳过该请求，⛔ 不伪装已处理）。 */
export function parseSuiteRequest(text: string): SuiteRequest | null {
  try {
    const j = JSON.parse(text);
    if (!j || typeof j.task !== "string" || !j.task) return null;
    const suiteCommand = Array.isArray(j.suiteCommand) && j.suiteCommand.every((x: unknown) => typeof x === "string")
      ? (j.suiteCommand as string[])
      : [];
    if (suiteCommand.length === 0) return null;
    return {
      task: j.task,
      worktree: typeof j.worktree === "string" ? j.worktree : "",
      runId: typeof j.runId === "string" ? j.runId : "",
      suiteCommand,
      logFile: typeof j.logFile === "string" ? j.logFile : null,
      requestedAt: typeof j.requestedAt === "string" ? j.requestedAt : "",
    };
  } catch {
    return null;
  }
}

/** 写一个结果文件（原子语义不需要——driver 单写者；mkdir -p）。返回落盘路径。 */
export function writeSuiteResult(root: string, task: string, result: SuiteRunResult & { runId: string }): string {
  const dir = path.join(root, ".quay", "suite-results");
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${task}.json`);
  fs.writeFileSync(file, JSON.stringify(result) + "\n", "utf8");
  return file;
}

/** 追加一条三态 outcome 到主载体 suite-round.jsonl（每轮一条；一行一 JSON）。 */
export function appendSuiteRound(root: string, record: Record<string, unknown>): string {
  return appendHeartbeatLine(path.join(root, ROUND_LOG_REL), record);
}

/** 组装一条 round 记录（carrier 的一行；outcome 三态 + 退出方式 + slot）。 */
export function computeSuiteRound(args: {
  runId: string;
  task: string;
  result: SuiteRunResult;
  slotBase: string;
}): Record<string, unknown> {
  const { runId, task, result, slotBase } = args;
  return {
    ts: ts(),
    run_id: runId,
    task,
    outcome: result.outcome,
    exit_code: result.exitCode,
    signal_code: result.signalCode,
    hung_by_watchdog: result.hungByWatchdog,
    started_at: result.startedAt,
    finished_at: result.finishedAt,
    duration_ms: result.durationMs,
    slot_base: slotBase,
  };
}

// ── 常驻循环（AC1：复用 Layer 0 控制面 + 心跳；单元是【请求】不是【任务】）────────────────
export interface SuiteLoopOptions {
  root: string;
  intervalMs: number;
  once: boolean;
  maxRounds: number | null;
  runId: string;
  json: boolean;
  pidFile?: string;
  silenceMs: number;
  slotLib: string;
}

/** 列出一个任务是否已有结果（processed）或仍在飞（in-flight set 有它）。 */
export function isSuiteRequestPending(root: string, task: string, inFlight: Set<string>): boolean {
  if (inFlight.has(task)) return false;
  const resultFile = path.join(root, ".quay", "suite-results", `${task}.json`);
  return !fs.existsSync(resultFile);
}

/** 读请求目录里待处理的请求（无结果文件且未在飞的）。缺目录/读失败 ⇒ 空列表（⛔ 不抛）。 */
export function listPendingSuiteRequests(root: string, inFlight: Set<string>): Array<{ task: string; request: SuiteRequest; file: string }> {
  const dir = path.join(root, ".quay", "suite-requests");
  const out: Array<{ task: string; request: SuiteRequest; file: string }> = [];
  let names: string[] = [];
  try {
    names = fs.readdirSync(dir).filter((n) => n.endsWith(".json"));
  } catch {
    return out;
  }
  for (const n of names) {
    const file = path.join(dir, n);
    let text: string;
    try {
      text = fs.readFileSync(file, "utf8");
    } catch {
      continue;
    }
    const request = parseSuiteRequest(text);
    if (!request) continue;
    if (!isSuiteRequestPending(root, request.task, inFlight)) continue;
    out.push({ task: request.task, request, file });
  }
  return out;
}

/**
 * 常驻循环：每轮读控制态（halt ⇒ 记 halted 轮退出）→ 扫描请求目录 → 对每个待处理请求
 * spawnSuiteAndWait（异步，不阻塞其它请求；并发受单飞槽 S 自然限制）→ 写结果 + suite-round。
 * SIGINT/SIGTERM / --once / --max-rounds 停。
 */
export async function runResidentSuiteLoop(opts: SuiteLoopOptions): Promise<number> {
  const { root, intervalMs, once, maxRounds, runId, json, pidFile, silenceMs, slotLib } = opts;
  if (pidFile) {
    try { fs.writeFileSync(pidFile, `${process.pid}\n`, "utf8"); } catch { /* pid-file 只供外部观测 */ }
  }
  const slotBase = suiteLockBase(root);
  let stopRequested = false;
  let wakeResolve: (() => void) | null = null;
  const requestStop = () => { stopRequested = true; if (wakeResolve) { const w = wakeResolve; wakeResolve = null; w(); } };
  process.on("SIGINT", requestStop);
  process.on("SIGTERM", requestStop);
  const sleepFn = (ms: number) => new Promise<void>((resolve) => {
    wakeResolve = resolve;
    setTimeout(() => { if (wakeResolve === resolve) wakeResolve = null; resolve(); }, ms);
  });

  const inFlight = new Set<string>();
  let round = 0;
  while (!stopRequested) {
    round += 1;
    if (isHalted(root, process.env, SUITE_CONTROL_STATE_REL)) {
      const rec = { round, run_id: runId, pid: process.pid, ts: ts(), halted: true };
      try { appendSuiteRound(root, rec); } catch { /* 记录写失败不致命 */ }
      if (json) process.stdout.write(`${JSON.stringify({ event: "halted", round })}\n`);
      break;
    }
    for (const { task, request } of listPendingSuiteRequests(root, inFlight)) {
      inFlight.add(task);
      // 异步 spawn+wait（⛔ 不用 spawnSync 阻塞循环——并发 suite 由单飞槽 S 限制）。
      spawnSuiteAndWait({
        slotBase,
        slotLib,
        suiteCommand: request.suiteCommand,
        logFile: request.logFile,
        silenceMs,
        // QUAY_TEST_SUITE_DRIVER_HOLDS_SLOT 由 spawnSuiteAndWait 强制注入（结构不变式），caller 不传。
      }).then((result) => {
        inFlight.delete(task);
        try { writeSuiteResult(root, task, { ...result, runId: request.runId }); } catch { /* 结果写失败不致命 */ }
        try { appendSuiteRound(root, computeSuiteRound({ runId: request.runId, task, result, slotBase })); } catch { /* 载体写失败不致命 */ }
        if (json) process.stdout.write(`${JSON.stringify({ event: "suite", task, outcome: result.outcome })}\n`);
      }).catch(() => { inFlight.delete(task); });
    }
    if (json) process.stdout.write(`${JSON.stringify({ event: "round", round, in_flight: inFlight.size })}\n`);
    if (once) break;
    if (maxRounds !== null && round >= maxRounds) break;
    await sleepFn(intervalMs);
  }
  if (json && stopRequested) {
    process.stdout.write(`${JSON.stringify({ event: "stop", reason: "signal", round })}\n`);
  }
  return 0;
}

// ── CLI ─────────────────────────────────────────────────────────────────────────────────────

const HELP = [
  "suite-driver — per-task suite 生命周期 driver kind（SPEC-suite-lifecycle §3，继承 Layer 0）。",
  "常驻模式：每轮扫描 .quay/suite-requests/ → 取槽 → spawn suite → wait → 静默看门狗 → 写三态 outcome。",
  "一次性模式（--run）：spawn 单个 suite + wait + 看门狗，写结果与 suite-round 后退出（测试/手动单发）。",
  "  --root <repo>              仓库根（缺省 cwd）",
  "  --interval <ms>            轮间隔（缺省 1000）",
  "  --once                     跑一轮即退出",
  "  --max-rounds <n>           跑满 N 轮退出（测试缝）",
  "  --run                      一次性模式：跑 --suite-command 一个 suite 后退出",
  "  --task <id>                一次性模式的任务 id（写结果/载体用）",
  "  --worktree <path>          一次性模式的 worktree（缺省 = --root）",
  "  --run-id <id>              run id（缺省 st-prod-<epoch>）",
  "  --suite-command <argv>     覆盖 suite 命令（空格分隔；测试缝——缺省 bash <worktree>/scripts/test.sh --buckets <task>）",
  "  --suite-command-file <p>   从文件读 suite 命令脚本（bash <file>）——fan-in 把 baked 的 inner block 落盘后交给 driver 跑",
  "  --log-file <path>          静默看门狗盯的日志文件（suite 输出 tee 到这里）",
  "  --silence-timeout-ms <n>   静默挂死阈值（缺省 15min；测试传小值）",
  "  --slot-base <path>         覆盖 suite 单飞槽 base（测试缝——hermetic 临时锁文件）",
  "  --slot-lib <path>          suite-slot-lib.sh 路径（测试缝）",
  "  --pid-file <path>          把驱动自身 pid 写到该文件",
  "  --json                     每轮向 stdout 打一条 JSON 事件行",
].join("\n");

/** 空格分隔 argv 切分（与 driver-runtime.splitArgs 同族；测试缝注入覆盖命令）。 */
export function splitArgs(cmd: string): string[] {
  return cmd.trim().split(/\s+/).filter(Boolean);
}

function isNonNegInt(s: string): boolean {
  return /^\d+$/.test(s);
}

export async function main(argv: string[]): Promise<number> {
  const args = argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) { console.log(HELP); return 0; }
  let root: string | undefined;
  let intervalRaw: string | undefined;
  let once = false;
  let maxRounds: number | null = null;
  let run = false;
  let task: string | undefined;
  let worktree: string | undefined;
  let runId: string | undefined;
  let suiteCommand: string | undefined;
  let suiteCommandFile: string | undefined;
  let logFile: string | undefined;
  let silenceRaw: string | undefined;
  let slotBase: string | undefined;
  let slotLib: string | undefined;
  let pidFile: string | undefined;
  let json = false;

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--root") root = args[++i];
    else if (a === "--interval") intervalRaw = args[++i];
    else if (a === "--once") once = true;
    else if (a === "--max-rounds") maxRounds = Number(args[++i]);
    else if (a === "--run") run = true;
    else if (a === "--task") task = args[++i];
    else if (a === "--worktree") worktree = args[++i];
    else if (a === "--run-id") runId = args[++i];
    else if (a === "--suite-command") suiteCommand = args[++i];
    else if (a === "--suite-command-file") suiteCommandFile = args[++i];
    else if (a === "--log-file") logFile = args[++i];
    else if (a === "--silence-timeout-ms") silenceRaw = args[++i];
    else if (a === "--slot-base") slotBase = args[++i];
    else if (a === "--slot-lib") slotLib = args[++i];
    else if (a === "--pid-file") pidFile = args[++i];
    else if (a === "--json") json = true;
    else { console.error(`suite-driver: unknown argument: ${a}`); return 2; }
  }

  const rootDir = root ? path.resolve(root) : path.resolve(process.cwd());
  const resolvedRunId = runId || `st-prod-${Math.floor(Date.now() / 1000)}`;
  const silenceMs = silenceRaw !== undefined && isNonNegInt(silenceRaw) ? Number(silenceRaw) : SILENCE_MS_DEFAULT;
  const resolvedSlotLib = slotLib ? path.resolve(slotLib) : path.join(rootDir, "plugin", "scripts", "suite-slot-lib.sh");
  const resolvedSlotBase = slotBase ?? suiteLockBase(rootDir);

  if (run) {
    if (!task) { console.error("suite-driver: --run requires --task"); return 2; }
    const wt = worktree ? path.resolve(worktree) : rootDir;
    const cmd = suiteCommandFile
      ? ["bash", path.resolve(suiteCommandFile)]
      : suiteCommand
        ? splitArgs(suiteCommand)
        : ["bash", path.join(wt, "scripts", "test.sh"), "--buckets", task];
    const result = await spawnSuiteAndWait({
      slotBase: resolvedSlotBase,
      slotLib: resolvedSlotLib,
      suiteCommand: cmd,
      logFile: logFile ?? null,
      silenceMs,
      // QUAY_TEST_SUITE_DRIVER_HOLDS_SLOT 由 spawnSuiteAndWait 强制注入（结构不变式），caller 不传。
    });
    writeSuiteResult(rootDir, task, { ...result, runId: resolvedRunId });
    appendSuiteRound(rootDir, computeSuiteRound({ runId: resolvedRunId, task, result, slotBase: resolvedSlotBase }));
    if (json) process.stdout.write(`${JSON.stringify({ event: "suite", task, outcome: result.outcome, exit_code: result.exitCode, signal_code: result.signalCode, hung_by_watchdog: result.hungByWatchdog })}\n`);
    // 一次性模式的退出码承载三态 outcome（0=done / 1=red / 2=hung）——调用方（如 fan-in 的 `rc=$?`）
    // 不必读结果文件就能区分绿/红/挂死（⛔ hung 不得与 red 同形，硬规则 3b）。
    return result.outcome === "done" ? 0 : result.outcome === "red" ? 1 : 2;
  }

  const interval = intervalRaw !== undefined && isNonNegInt(intervalRaw) ? Number(intervalRaw) : INTERVAL_MS_DEFAULT;
  if (maxRounds !== null && (!Number.isInteger(maxRounds) || maxRounds < 1)) {
    console.error("suite-driver: --max-rounds must be a positive integer");
    return 2;
  }
  return runResidentSuiteLoop({ root: rootDir, intervalMs: interval, once, maxRounds, runId: resolvedRunId, json, pidFile, silenceMs, slotLib: resolvedSlotLib });
}

// Direct entry guard (gate-script-base convention)：仅当本文件是入口时跑 main()。
if (isDirectEntry(import.meta, undefined, "suite-driver")) {
  main(process.argv).then((code) => { process.exitCode = code; });
}
