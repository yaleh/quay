// worker-driver.ts — SPEC-worker-driven-inner-2026-08-16 §5 阶段 1：机械驱动进程 spawn 单个
// claude -p worker 跑完整任务（选择 → worktree → 开发 → suite → ff），退出码 + 结构化 outcome 落盘。
//
// WHY THIS EXISTS (SPEC §2 ①，硬规则 4b)：「在飞」现在是【驱动进程自己 fork 的子进程数】——直接量，
// 不是估的。旧的三个代理量（worktree 数 / 任务 subagent 数 / 遥测括号 implementing 段）双向偏差，
// 根因是「让被测对象自己数自己」。本驱动是 spawner ⇒ 它数的子进程数是真值（AC1：在飞 = 驱动子进程数，
// 与任何代理量比对不一致时以驱动为准）。
//
// 权责边界（SPEC §3.2，人裁定的硬线）：
//   驱动  ⛔ 不做任何 commit  ⛔ 不调用 LLM 做判断  ✅ 起 worker、数并发、记录 outcome
//   worker ✅ 自己的 worktree 内全权  ✅ 最后 ff merge 到 develop  ⛔ 除最后 merge 外不碰 develop
//
// 阶段 1 范围（AC115，⛔ 阶段 2/3 属 AC116/AC117）：
//   单 worker；退出码 + outcome 落盘；杀 worker ⇒ 察觉并记录（AC3 能取假）。
//   ⛔ 不含：并发 N / 超时 SIGTERM / checkout 前 stash（阶段 2）· MCP 控制面（阶段 3）。
//
// outcome 记录（SPEC §4③，人裁定「跨任务行为检查由 outer 执行 ⇒ outer 只能读记录」）：
//   每任务一条 JSONL，写入 <root>/.quay/worker-outcome.jsonl（gitignored 运行时日志，
//   dispatch-record.jsonl 同族）。字段 = SPEC §4③ {task, selector 理由, worker exit code, 墙钟,
//   终态, 失败原因} + 直量的在飞计数（AC1）与时间戳/pid/runId。
//
// 退役（AC115 ## Retires）：
//   --in-flight 参数传递（slot-refill）——slot-refill 的 --in-flight/--running/--closed-but-live
//     参数传递退役，其语义由【本驱动的子进程数】接管（slot-refill 新增 --in-flight-count 直接量）。
//   遥测括号的「在飞」用途——slot-refill 不再从 telemetry 括号（implementing 段）推在飞。
//   每条的「它防的那个缺陷现在由什么防」见本提交信息（manager-phase-goal AC110 ## Retires 要求）。
//
// Run:
//   node --experimental-strip-types plugin/scripts/worker-driver.ts \
//     --root <repo> --task <id> [--reason "<selector reason>"] \
//     [--worker-cmd "<argv>"] [--pid-file <path>] [--outcome <path>] [--run-id <id>] [--json]
//   --task <id>        要跑的任务 id（阶段 1 显式指定；无 --task ⇒ 阶段 1 暂不支持 selector，报错退出）
//   --reason <r>       selector 理由（一句话「为什么选它」）；缺省 = "explicit --task selection"
//   --worker-cmd <s>   覆盖 worker 命令（空格分隔 argv，⛔ 无 shell 元字符）。缺省 = `claude -p <prompt>`。
//                      AC3 取假 / 测试缝：`node -e process.exit(7)`、`sleep 100`。
//   --pid-file <path>  spawn 后立即把 worker pid 写到此文件（AC3 杀 worker 的抓手 + 外部可观测）。
//   --outcome <path>   outcome 文件，缺省 <root>/.quay/worker-outcome.jsonl
//   --run-id <id>      run id，缺省 = `fm-<task>-<unix-ms>`
//   --json             spawn 后立刻向 stdout 打一行 JSON 状态（in_flight_count / worker_pid / task）
// Exit: 0 = worker 退出码 0（completed）；非 0 = worker 非零退出 / 被杀 / spawn 失败。
//       ⛔ 任何终态都写 outcome 记录（AC3：杀 worker 不静默丢任务）。

import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { isDirectEntry } from "./gate-script-base.ts";

// ── 常量 ───────────────────────────────────────────────────────────────────────────────────────────

/** outcome 文件的仓库相对路径（gitignored 运行时日志，dispatch-record.jsonl 同族）。 */
export const WORKER_OUTCOME_REL = ".quay/worker-outcome.jsonl";

/** 终态枚举：completed（退出码 0）/ failed（非零退出）/ killed（被信号杀）/ spawn-failed（起不来）。 */
export const FINAL_STATES = ["completed", "failed", "killed", "spawn-failed"] as const;

/** 阶段 1 的并发上限：单 worker。直接量 = 驱动 fork 的子进程数，⛔ 不设代理。
 *  concurrency-default-fallback: 阶段 1 显式单 worker（AC115 scope，非宿主规格相关），阶段 2/3
 *  （AC116/AC117）的并发 N 才读 QUAY_MAX_* 定义点 / 宿主并行度。 */
export const PHASE1_CONCURRENCY = 1;

// ── 纯函数（可单测） ───────────────────────────────────────────────────────────────────────────────

/**
 * 一条结构化 outcome 记录（SPEC §4③ 字段齐全 + 直接量）。
 * @returns {object} { ts, task, selector_reason, exit_code, signal, wall_clock_ms, final_state,
 *   failure_reason, started_at, ended_at, worker_pid, run_id, in_flight_count }
 */
export function computeOutcome({
  task,
  selectorReason,
  exitCode,
  signal,
  startedAtMs,
  endedAtMs,
  workerPid,
  runId,
  spawnError = null,
  inFlightCount = PHASE1_CONCURRENCY,
}: {
  task: string;
  selectorReason: string;
  exitCode: number | null;
  signal: string | null;
  startedAtMs: number;
  endedAtMs: number;
  workerPid: number | null;
  runId: string;
  spawnError?: string | null;
  inFlightCount?: number;
}) {
  // AC3（能取假）：被信号杀 ⇒ final_state=killed + signal 落盘，⛔ 静默丢任务。
  let finalState = "completed";
  let failureReason = null;
  let exit = exitCode;
  if (spawnError) {
    finalState = "spawn-failed";
    failureReason = spawnError;
    exit = null;
  } else if (signal) {
    finalState = "killed";
    failureReason = `worker killed by ${signal}`;
    exit = null;
  } else if (exitCode !== 0) {
    finalState = "failed";
    failureReason = `worker exited with code ${exitCode}`;
  }
  return {
    ts: new Date(endedAtMs).toISOString(),
    task,
    selector_reason: selectorReason,
    exit_code: exit,
    signal: signal ?? null,
    wall_clock_ms: endedAtMs - startedAtMs,
    final_state: finalState,
    failure_reason: failureReason,
    started_at: new Date(startedAtMs).toISOString(),
    ended_at: new Date(endedAtMs).toISOString(),
    worker_pid: workerPid,
    run_id: runId,
    in_flight_count: inFlightCount,
  };
}

/** 把一条 outcome 追加写入指定文件（mkdir -p + appendFileSync，一行一 JSON）。 */
export function appendOutcomeToFile(file: string, outcome: ReturnType<typeof computeOutcome>): string {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, JSON.stringify(outcome) + "\n", "utf8");
  return file;
}

/** 把一条 outcome 追加写入 <root>/.quay/worker-outcome.jsonl（gitignored 运行时日志）。 */
export function appendOutcome(root: string, outcome: ReturnType<typeof computeOutcome>): string {
  return appendOutcomeToFile(path.join(root, WORKER_OUTCOME_REL), outcome);
}

/** 空格分隔 argv 切分（⛔ 无 shell 元字符 / 引号；用于 --worker-cmd 与默认 claude -p）。 */
export function splitArgs(cmd: string): string[] {
  return cmd.trim().split(/\s+/).filter(Boolean);
}

/** 缺省 worker 命令：claude -p <full-chain prompt>（argv 形，child 即 worker，AC3 杀得准）。 */
export function defaultWorkerArgv(task: string, root: string): string[] {
  const prompt = [
    `You are a per-task worker in the quay repo (SPEC-worker-driven-inner §5 阶段 1).`,
    `Task: ${task}. Repo root: ${root}.`,
    `Run the full task chain: (1) create an isolated git worktree for ${task},`,
    `(2) implement the task per its Proposal/Plan/AC/DoD, (3) run the suite,`,
    `(4) ff-merge to develop via the fan-in-execute workflow (scriptPath, args={task,worktree,root,runId,mergeTarget}).`,
    `You own your worktree fully; apart from the final merge do not touch develop.`,
  ].join(" ");
  return ["claude", "-p", prompt];
}

/** 纯函数：解析主流程输入 → { taskId, selectorReason, run, workerArgv } 或 { error }。 */
export function resolveRun({
  task,
  reason,
  workerCmd,
  root,
  runId,
  nowMs,
}: {
  task: string | undefined;
  reason: string | undefined;
  workerCmd: string | undefined;
  root: string;
  runId: string | undefined;
  nowMs: number;
}) {
  if (!task || !task.trim()) {
    return { error: "no --task given (phase 1 does not yet run the selector worker; pass --task <id>)" };
  }
  const taskId = task.trim();
  const selectorReason = (reason && reason.trim()) || "explicit --task selection";
  const run = runId || `fm-${taskId}-${nowMs}`;
  const workerArgv = workerCmd ? splitArgs(workerCmd) : defaultWorkerArgv(taskId, root);
  if (workerArgv.length === 0) return { error: "empty worker command" };
  return { taskId, selectorReason, run, workerArgv };
}

/** 常见信号的 shell 惯例退出码（128+signum）；未知信号给 0（被杀本身已是非零）。 */
export function signalExitCode(signal: string): number {
  const map: Record<string, number> = { SIGHUP: 1, SIGINT: 2, SIGQUIT: 3, SIGKILL: 9, SIGTERM: 15 };
  return map[signal] ?? 0;
}

// ── CLI 主流程 ─────────────────────────────────────────────────────────────────────────────────────

export async function main(argv: string[]): Promise<number> {
  const args = argv.slice(2);
  let root: string | undefined;
  let task: string | undefined;
  let reason: string | undefined;
  let workerCmd: string | undefined;
  let pidFile: string | undefined;
  let outcomePath: string | undefined;
  let runId: string | undefined;
  let json = false;

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--root") root = args[++i];
    else if (a === "--task") task = args[++i];
    else if (a === "--reason") reason = args[++i];
    else if (a === "--worker-cmd") workerCmd = args[++i];
    else if (a === "--pid-file") pidFile = args[++i];
    else if (a === "--outcome") outcomePath = args[++i];
    else if (a === "--run-id") runId = args[++i];
    else if (a === "--json") json = true;
    else if (a === "--help" || a === "-h") {
      console.log(
        "worker-driver — SPEC §5 阶段 1：spawn 单 claude -p worker 跑完整任务，退出码 + outcome 落盘\n" +
          "  --task <id> --reason \"<一句为什么选它>\" [--root <repo>] [--worker-cmd \"<argv>\"] [--pid-file <p>] [--outcome <p>] [--run-id <id>] [--json]",
      );
      return 0;
    } else {
      console.error(`worker-driver: unknown argument: ${a}`);
      return 2;
    }
  }

  const rootDir = root ? path.resolve(root) : path.resolve(process.cwd());
  const outcomeFile = outcomePath ? path.resolve(outcomePath) : path.join(rootDir, WORKER_OUTCOME_REL);
  const resolved = resolveRun({ task, reason, workerCmd, root: rootDir, runId, nowMs: Date.now() });
  if (resolved.error) {
    console.error(`worker-driver: ${resolved.error}`);
    return 2;
  }

  const { taskId, selectorReason, run, workerArgv } = resolved;
  const [cmd, ...cmdArgs] = workerArgv;
  const startedAtMs = Date.now();

  // 在飞 = 驱动 fork 的子进程数（直接量，AC1）。阶段 1 = spawn 成功即 1，⛔ 不读任何代理量。
  // ⛔ 驱动不做任何 commit、不调用 LLM 做判断（SPEC §3.2）——这里只 spawn + 记账 + 记录。
  let child;
  let spawnError = null;
  try {
    child = spawn(cmd, cmdArgs, { cwd: rootDir, stdio: "inherit", detached: false });
  } catch (e) {
    spawnError = e && typeof e === "object" && "message" in e ? String(e.message) : String(e);
  }

  // ENOENT 等 spawn 失败：child 对象返回但 child.pid === undefined ⇒ 直接量在飞 = 0。
  const workerPid = child && child.pid ? child.pid : null;
  const inFlightCount = child && child.pid ? 1 : 0;

  // 直接量对外可观测（AC1 比对点 + AC3 抓手）：--json 打一行，--pid-file 落 worker pid。
  if (json) {
    process.stdout.write(
      `${JSON.stringify({ event: "worker-spawned", task: taskId, worker_pid: workerPid, in_flight_count: inFlightCount, run_id: run })}\n`,
    );
  }
  if (pidFile && workerPid) {
    try {
      fs.mkdirSync(path.dirname(path.resolve(pidFile)), { recursive: true });
      fs.writeFileSync(path.resolve(pidFile), `${workerPid}\n`, "utf8");
    } catch {
      /* pid-file 是观测抓手，写失败不改变主流程 */
    }
  }

  // AC3（能取假）：worker 被杀 ⇒ 'close' 事件带 (code=null, signal='SIGKILL') ⇒ 记录，不静默丢任务。
  if (!child) {
    const endedAtMs = Date.now();
    const outcome = computeOutcome({
      task: taskId, selectorReason, exitCode: null, signal: null,
      startedAtMs, endedAtMs, workerPid: null, runId: run,
      spawnError: spawnError || "spawn failed", inFlightCount: 0,
    });
    const file = appendOutcomeToFile(outcomeFile, outcome);
    if (json) process.stdout.write(`${JSON.stringify({ event: "worker-done", file, ...outcome })}\n`);
    return 2;
  }

  return new Promise<number>((resolvePromise) => {
    let code: number | null = null;
    let signal: string | null = null;
    child.on("error", (err) => {
      // spawn 已成功但随后出错（罕见）：按 spawn-failed 记。
      spawnError = String(err && err.message ? err.message : err);
    });
    child.on("close", (c, s) => {
      code = c;
      signal = s ?? null;
      const endedAtMs = Date.now();
      const outcome = computeOutcome({
        task: taskId, selectorReason, exitCode: code, signal,
        startedAtMs, endedAtMs, workerPid, runId: run,
        spawnError: spawnError, inFlightCount,
      });
      const file = appendOutcomeToFile(outcomeFile, outcome);
      if (json) process.stdout.write(`${JSON.stringify({ event: "worker-done", file, ...outcome })}\n`);
      // 退出码：completed=0；failed=worker 非零退出码；killed=128+signal；spawn-failed=2。
      // ⛔ spawn ENOENT 时 'close' 会带 code=-2（负 errno），若原样透传 exitCode 会变成 254——显式给 2。
      if (outcome.final_state === "completed") resolvePromise(0);
      else if (outcome.final_state === "killed") resolvePromise(128 + (signal ? signalExitCode(signal) : 0));
      else if (outcome.final_state === "spawn-failed") resolvePromise(2);
      else resolvePromise(code ?? 2);
    });
  });
}

// Direct entry guard (gate-script-base convention)：仅当本文件是入口时跑 main()。
if (isDirectEntry(import.meta, undefined, "worker-driver")) {
  main(process.argv).then((code) => {
    process.exitCode = code;
  });
}
