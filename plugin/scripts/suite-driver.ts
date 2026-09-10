// plugin/scripts/suite-driver.ts — per-task suite 的共享 spawn+wait 函数库（⛔ 不再是常驻 driver kind）。
// (tasks/gap-suite-lifecycle-driver-kind / SPEC-suite-lifecycle-and-failure-semantics-2026-08-26 §3；
//  gap-retire-resident-suite-driver-kind —— 人 2026-09-07 A 裁定退役常驻 suite kind)
//
// WHY THIS EXISTS（SPEC §3.1 实测）：per-task suite 必须 detach 于 subagent（Bash 单次 600s 硬顶 +
// `run_in_background` 被 harness 连带杀），但可以由 worker-driver 在机械 fan-in 中【进程内】直接 spawn
// 并 wait（进程级父子），拿回「父进程 wait」这一挂死检测主通道——原 `setsid + & + disown` detach 没有
// 任何进程在 wait，挂死检测只有辅（外部定时扫），ac143 挂死 33.7 分钟 / lpt-lookback 挂死 199.5 分钟
// 全靠人工 kill。
//
// 常驻 suite driver kind 已按人 2026-09-07 A 裁定退役：它从未在生产启动（start-drivers.ts 的
// DRIVER_KINDS 不含 suite；.quay/suite-requests|suite-results 目录无 writer 无 reader），而与它矛盾的
// 这条【进程内 spawn+wait】路径才是生产每轮都在跑的。本文件因此保留为【共享函数库】，由 worker-driver
// 消费（worker-driver.ts:202 import spawnSuiteAndWait）。⛔ 不再注册进 DRIVER_KINDS、⛔ 无常驻循环、
// ⛔ 无 request/result 协议。
//
// 保留的共享函数：
//   spawnSuiteAndWait  spawn suite 并 wait（进程级父子）+ 定时兜底静默看门狗 + 三态 outcome
//                      （正常退出 / 非零退出 / 被信号杀；挂死 ⇒ hung，可区分独立取值）
//   slotHolderArgv     取槽 + exec 同一执行点（acquire 与 exec 同函数，exec 持锁跨 suite、随子进程终结
//                      自然释放 ⇒「让槽不让 lane」结构上不可能再发生）
//   logMtimeMs / killTree / appendSuiteRound / computeSuiteRound —— spawn+wait 与 round 载体的支撑函数。
// slot 槽路径读 TS 侧单一真相源 suite-lock-slots.ts（与 bash suite-slot-lib.sh 同一语义，
// suite-slot-ssot-check 校验两边一致）。
//
// 硬规则 3b（AC2 判据）：`hung` 是与 `done`、与 `red` 可区分的独立取值——挂死被杀后绝不记成「红」或
// 「没跑完」（三种成因压成一个值正是 SPEC §1.1 泄漏② 要修的病）。

import fs from "node:fs";
import path from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import { isDirectEntry } from "./gate-script-base.ts";
// Layer 0（driver-runtime 单一实现）：ts（round 记录时间戳）、appendHeartbeatLine（心跳/载体落点）。
// ⛔ 不再 import DRIVER_KINDS / isHalted / sleep（常驻 driver kind 面已按人 2026-09-07 裁定退役）。
import { ts, appendHeartbeatLine } from "./driver-runtime.ts";
// suite 槽路径单一真相源（TS 侧；与 bash suite-slot-lib.sh 同语义）。
import { suiteLockBase } from "./suite-lock-slots.ts";

// ── 常量（⛔ suite kind 已从 DRIVER_KINDS registry 退役——载体路径改为字面量，不再由 registry 派生）──
/** 主载体（.quay/suite-round.jsonl，gitignored 运行时日志——一轮一条三态 outcome）。 */
export const ROUND_LOG_REL = "suite-round.jsonl";

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
    // 统一输出机件（gap 诊断）：suite 的 stdout 持久化到 logFile——⛔ 之前只捕获做看门狗活性检测、
    // 不落盘 ⇒ 机械 fan-in 的 suite 失败无法从日志诊断（workflow 路径靠 shell 重定向才有日志）。
    // append 追加（同 workflow 路径的 `>> log` 语义，跨 relaunch 复用同一文件不轮转）。
    const suiteLogStream = logFile ? fs.createWriteStream(logFile, { flags: "a" }) : null;
    child.stdout?.on("data", (chunk: Buffer) => { lastActivityMs = Date.now(); suiteLogStream?.write(chunk); });
    child.stderr?.on("data", () => { lastActivityMs = Date.now(); });

    const finish = (r: SuiteRunResult): void => {
      if (settled) return;
      settled = true;
      clearInterval(watchdog);
      // ⛔ 不等到流 flush 就 resolve ⇒ caller（runMechanicalFanIn 读 suiteLogFile）会 readFileSync 到空/
      // 半截文件 ⇒ suite red reason 回退「suite red」（gap-fan-in-suite-red-reason-carries-split-or-commit-
      // title 的 flaky：AC1 能取假 在满载套件下读到空文件）。等 'finish'（数据已 flush 到 OS）再 resolve。
      if (suiteLogStream) {
        suiteLogStream.end(() => resolve(r));
      } else {
        resolve(r);
      }
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
        // 显式 resolve（⛔ 不依赖 close 事件）：孙进程持 stdout/stderr 管道 ⇒ close 永不触发 ⇒ 挂死。
        // kill 后立即 finish(hung)，即使 close 被管道持有的孙进程拖住，也在有限时间返回
        // （gap-fan-in-subprocess-hang-timeout-recovery AC3：suite 未起/等槽锁零输出也覆盖）。
        finish({
          outcome: "hung",
          exitCode: null,
          signalCode: "SIGKILL",
          hungByWatchdog: true,
          startedAt,
          finishedAt: new Date().toISOString(),
          durationMs: Date.now() - startedMs,
          error: "silence watchdog killed the suite (no output ≥ silence timeout)",
          pid: childPid,
        });
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

// ── CLI（⛔ 常驻模式已按人 2026-09-07 裁定退役；保留 --run 单发作为手动/测试缝）────────────────

const HELP = [
  "suite-driver — per-task suite 共享 spawn+wait 函数库（⛔ 常驻 driver kind 已按人 2026-09-07 裁定退役）。",
  "一次性模式（--run）：spawn 单个 suite + wait + 静默看门狗 + 三态 outcome，写 suite-round 后退出（手动/测试单发）。",
  "  --root <repo>              仓库根（缺省 cwd）",
  "  --run                      一次性模式：跑 --suite-command 一个 suite 后退出",
  "  --task <id>                一次性模式的任务 id（写 round 载体用）",
  "  --worktree <path>          一次性模式的 worktree（缺省 = --root）",
  "  --run-id <id>              run id（缺省 st-prod-<epoch>）",
  "  --suite-command <argv>     覆盖 suite 命令（空格分隔；缺省 bash <worktree>/scripts/test.sh --buckets <task>）",
  "  --suite-command-file <p>   从文件读 suite 命令脚本（bash <file>）",
  "  --log-file <path>          静默看门狗盯的日志文件（suite 输出 tee 到这里）",
  "  --silence-timeout-ms <n>   静默挂死阈值（缺省 15min；测试传小值）",
  "  --slot-base <path>         覆盖 suite 单飞槽 base（测试缝——hermetic 临时锁文件）",
  "  --slot-lib <path>          suite-slot-lib.sh 路径（测试缝）",
  "  --json                     结果向 stdout 打一条 JSON 事件行",
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
  let json = false;

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--root") root = args[++i];
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
    else if (a === "--json") json = true;
    else { console.error(`suite-driver: unknown argument: ${a}`); return 2; }
  }

  if (!run) {
    console.error("suite-driver: 常驻模式已按人 2026-09-07 裁定退役——本文件保留为共享 spawn+wait 函数库；单发请用 --run");
    return 2;
  }

  const rootDir = root ? path.resolve(root) : path.resolve(process.cwd());
  const resolvedRunId = runId || `st-prod-${Math.floor(Date.now() / 1000)}`;
  const silenceMs = silenceRaw !== undefined && isNonNegInt(silenceRaw) ? Number(silenceRaw) : SILENCE_MS_DEFAULT;
  const resolvedSlotLib = slotLib ? path.resolve(slotLib) : path.join(rootDir, "plugin", "scripts", "suite-slot-lib.sh");  // kernel-sibling-dev-tree-only: dev-tree-only — repo-local plugin/scripts use, not third-party sibling resolution.
  const resolvedSlotBase = slotBase ?? suiteLockBase(rootDir);

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
  appendSuiteRound(rootDir, computeSuiteRound({ runId: resolvedRunId, task, result, slotBase: resolvedSlotBase }));
  if (json) process.stdout.write(`${JSON.stringify({ event: "suite", task, outcome: result.outcome, exit_code: result.exitCode, signal_code: result.signalCode, hung_by_watchdog: result.hungByWatchdog })}\n`);
  // 一次性模式的退出码承载三态 outcome（0=done / 1=red / 2=hung）——调用方不必读结果文件就能区分
  // 绿/红/挂死（⛔ hung 不得与 red 同形，硬规则 3b）。
  return result.outcome === "done" ? 0 : result.outcome === "red" ? 1 : 2;
}

// Direct entry guard (gate-script-base convention)：仅当本文件是入口时跑 main()。
if (isDirectEntry(import.meta, undefined, "suite-driver")) {
  main(process.argv).then((code) => { process.exitCode = code; });
}
