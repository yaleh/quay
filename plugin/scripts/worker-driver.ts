// worker-driver.ts — SPEC-worker-driven-inner-2026-08-16 §5 阶段 2：机械驱动进程 spawn 多个
// claude -p worker 跑完整任务（选择 → worktree → 开发 → suite → ff），并发由驱动数自己的子进程控制，
// 超时 SIGTERM（保留 worktree）、checkout 前 stash 主检出。退出码 + 结构化 outcome 落盘。
//
// WHY THIS EXISTS (SPEC §2 ①，硬规则 4b)：「在飞」现在是【驱动进程自己 fork 的子进程数】——直接量，
// 不是估的。旧的三个代理量（worktree 数 / 任务 subagent 数 / 遥测括号 implementing 段）双向偏差，
// 根因是「让被测对象自己数自己」。本驱动是 spawner ⇒ 它数的子进程数是真值（AC1：在飞 = 驱动子进程数，
// 与任何代理量比对不一致时以驱动为准）。
//
// 权责边界（SPEC §3.2，人裁定的硬线）：
//   驱动  ⛔ 不做任何 commit  ⛔ 不调用 LLM 做判断  ✅ 起/杀 worker、数并发、超时、stash 主检出、记录 outcome
//   worker ✅ 自己的 worktree 内全权  ✅ 最后 ff merge 到 develop  ⛔ 除最后 merge 外不碰 develop
//   主检出 纯粹是驱动的镜像 —— 驱动 checkout 最新 develop 前，若发现未提交变更即 stash（⛔ 不 discard）。
//
// 阶段 2 新增（AC116，相对阶段 1 的三条能力）：
//   ① 并发 N —— --task 可重复、--concurrency N 上限；在飞 = 驱动当前活子进程数（直接量，非硬编码 1）。
//   ② 超时 SIGTERM —— --timeout <ms>（缺省 0 = 无超时，SPEC §4④：成本结构未知前不设阈值）。超时 ⇒
//      SIGTERM worker、保留 worktree（驱动从不 remove/prune worktree）、outcome 记 final_state=timed-out。
//   ③ checkout 前 stash —— spawn 前 `git stash push --include-untracked`（⛔ 不 discard），非 git 仓库 no-op。
//
// outcome 记录（SPEC §4③，人裁定「跨任务行为检查由 outer 执行 ⇒ outer 只能读记录」）：
//   每任务一条 JSONL，写入 <root>/.quay/worker-outcome.jsonl（gitignored 运行时日志，
//   dispatch-record.jsonl 同族）。字段 = SPEC §4③ {task, selector 理由, worker exit code, 墙钟,
//   终态, 失败原因} + 直接量的在飞计数（AC1）+ 超时标记（AC3）+ 时间戳/pid/runId。
//
// ## Retires（AC116，SPEC §5 阶段 2 退役清单——本阶段退役了什么、现在由什么防）：
//   ① cap-from-gate / process-budget 的并发裁决用途 —— 驱动数自己的子进程（直接量），不再读
//      effective_cap / total-process-budget 来裁决派发并发。标记落点：cap-from-gate.sh / cap-from-gate.ts /
//      process-budget.sh 头部「并发裁决用途 RETIRED」横幅。剩余面（observation / test.sh C 面 /
//      resource-gate A 面）不退役。
//   ② A6「检查 fan-in 是否走 workflow」—— 驱动直接以 scriptPath 调 fan-in-execute workflow（见
//      defaultWorkerArgv），结构上不需要事后检查「有没有走」。标记落点：fan-in-workflow-check.ts 头部
//      「A6 检查退役面」横幅（过渡期仍保留给旧循环，驱动路径不消费它）。
//
// Run:
//   node --experimental-strip-types plugin/scripts/worker-driver.ts \
//     --root <repo> --task <id> [--task <id> …] [--reason "<selector reason>"] \
//     [--concurrency <N>] [--timeout <ms>] [--worker-cmd "<argv>"] \
//     [--pid-file <path>] [--outcome <path>] [--run-id <id>] [--json]
//   --task <id>         要跑的任务 id（可重复；无 --task ⇒ 报错退出——selector 属后续阶段）
//   --reason <r>        selector 理由（一句话「为什么选它」）；缺省 = "explicit --task selection"
//   --concurrency <N>   并发上限（同时存活 worker 数）。缺省读 QUAY_MAX_TASK_SUBAGENTS（定义点），
//                       再缺省 = 任务数。驱动数自己的子进程，达 cap 则等一个结束再起下一个。
//   --timeout <ms>      单任务墙钟超时（毫秒）。缺省 0 = 无超时（SPEC §4④：先无阈值记录时长分布）。
//                       超时 ⇒ SIGTERM worker、保留 worktree、final_state=timed-out。
//   --worker-cmd <s>    覆盖 worker 命令（空格分隔 argv，⛔ 无 shell 元字符）。缺省 = `claude -p <prompt>`。
//                       取假/测试缝：`node -e process.exit(7)`、`sleep 100`。
//   --pid-file <path>   spawn 后把 worker pid 写到此文件（每 worker 一行；外部可观测 + 杀 worker 抓手）。
//   --outcome <path>    outcome 文件，缺省 <root>/.quay/worker-outcome.jsonl
//   --run-id <id>       run id，缺省 = `fm-<task>-<unix-ms>`
//   --json             spawn 后向 stdout 打 JSON 事件行（stash / worker-spawned / worker-done）
// Exit: 0 = 全部 worker 退出码 0（completed）；非 0 = 首个非零（worker 非零 / 被杀 / 超时 / spawn 失败）。
//       ⛔ 任何终态都写 outcome 记录（阶段 1 AC3：杀 worker 不静默丢任务）。

import fs from "node:fs";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { isDirectEntry } from "./gate-script-base.ts";

// ── 常量 ───────────────────────────────────────────────────────────────────────────────────────────

/** outcome 文件的仓库相对路径（gitignored 运行时日志，dispatch-record.jsonl 同族）。 */
export const WORKER_OUTCOME_REL = ".quay/worker-outcome.jsonl";

/** 终态枚举：completed（退出码 0）/ failed（非零退出）/ killed（被信号杀）/ timed-out（超时 SIGTERM）/
 *  spawn-failed（起不来）。 */
export const FINAL_STATES = ["completed", "failed", "killed", "timed-out", "spawn-failed"] as const;

/** 并发上限的定义点（concurrency-literal-check 的唯一定义点旋钮①，人 2026-08-13）。缺省并发读它。 */
export const MAX_TASK_SUBAGENTS_ENV = "QUAY_MAX_TASK_SUBAGENTS";

/** checkout 前 stash 的缺省 message（`git stash list` 可核的标记，AC2）。 */
export const DEFAULT_STASH_MESSAGE = "worker-driver: stash before checkout (SPEC §5 阶段 2)";

// ── 纯函数（可单测） ───────────────────────────────────────────────────────────────────────────────

/**
 * 一条结构化 outcome 记录（SPEC §4③ 字段齐全 + 直接量 + 超时标记）。
 * @returns {object} { ts, task, selector_reason, exit_code, signal, wall_clock_ms, final_state,
 *   failure_reason, started_at, ended_at, worker_pid, run_id, in_flight_count, timed_out }
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
  inFlightCount = 1,
  timedOut = false,
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
  timedOut?: boolean;
}) {
  // AC3（能取假，超时路径）：timedOut ⇒ final_state=timed-out（区别于外部 kill 的 killed）。
  //   被信号杀（非超时）⇒ final_state=killed + signal 落盘，⛔ 静默丢任务。
  let finalState = "completed";
  let failureReason = null;
  let exit = exitCode;
  if (spawnError) {
    finalState = "spawn-failed";
    failureReason = spawnError;
    exit = null;
  } else if (timedOut) {
    finalState = "timed-out";
    failureReason = `worker timed out and was SIGTERM'd (worktree preserved)`;
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
    timed_out: timedOut,
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

/** 缺省 worker 命令：claude -p <full-chain prompt>（argv 形，child 即 worker，超时 SIGTERM 杀得准）。
 *  prompt 里【直接】要求 worker 以 scriptPath 调 fan-in-execute workflow——驱动直调 ⇒ A6「检查 fan-in
 *  是否走 workflow」退役（SPEC §5 阶段 2 退役清单②）。 */
export function defaultWorkerArgv(task: string, root: string): string[] {
  const prompt = [
    `You are a per-task worker in the quay repo (SPEC-worker-driven-inner §5 阶段 2).`,
    `Task: ${task}. Repo root: ${root}.`,
    `Run the full task chain: (1) create an isolated git worktree for ${task},`,
    `(2) implement the task per its Proposal/Plan/AC/DoD, (3) run the suite,`,
    `(4) ff-merge to develop via the fan-in-execute workflow (scriptPath, args={task,worktree,root,runId,mergeTarget}).`,
    `You own your worktree fully; apart from the final merge do not touch develop.`,
  ].join(" ");
  return ["claude", "-p", prompt];
}

/** 常见信号的 shell 惯例退出码（128+signum）；未知信号给 0（被杀本身已是非零）。 */
export function signalExitCode(signal: string): number {
  const map: Record<string, number> = { SIGHUP: 1, SIGINT: 2, SIGQUIT: 3, SIGKILL: 9, SIGTERM: 15 };
  return map[signal] ?? 0;
}

/**
 * 并发上限（AC116 阶段 2 ①）：显式 N 优先 → 定义点 QUAY_MAX_TASK_SUBAGENTS → 任务数（无字面量，
 * 不依赖宿主规格）。驱动数自己的子进程，达 cap 则等一个结束再起下一个。
 */
export function resolveConcurrency(
  explicit: number | undefined,
  taskCount: number,
  env: NodeJS.ProcessEnv = process.env,
): number {
  if (explicit != null && Number.isInteger(explicit) && explicit >= 1) return explicit;
  const envN = Number(env[MAX_TASK_SUBAGENTS_ENV]);
  if (Number.isInteger(envN) && envN >= 1) return envN;
  return Math.max(1, taskCount);
}

/** 解析 --timeout <ms>（毫秒）。缺省/非法 → 0 = 无超时（SPEC §4④ 先无阈值）。 */
export function parseTimeoutMs(raw: string | undefined): number {
  if (raw == null) return 0;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

/** 一次 stash 的结果（AC2 可核：stashed=true 且 git stash list 可见；⛔ 绝不 discard）。 */
export interface StashResult {
  stashed: boolean;
  files: string[];
  error: string | null;
}

/**
 * checkout 前 stash（AC116 阶段 2 ③）：主检出有未提交变更 ⇒ `git stash push --include-untracked`，
 * ⛔ 不 discard（不做 `git checkout -- .` / `git reset --hard` / `git clean`）。非 git 仓库 ⇒ no-op
 * （阶段 1 测试的临时目录不是仓库）。stash 后可核：`git stash list` 出现带 message 的 entry。
 */
export function stashIfDirty(root: string, stashMessage: string = DEFAULT_STASH_MESSAGE): StashResult {
  const inRepo = spawnSync("git", ["-C", root, "rev-parse", "--is-inside-work-tree"], { encoding: "utf8" });
  if (inRepo.status !== 0) return { stashed: false, files: [], error: null };
  const before = spawnSync("git", ["-C", root, "status", "--porcelain"], { encoding: "utf8" });
  if (before.status !== 0) return { stashed: false, files: [], error: (before.stderr || "").trim() || "git status failed" };
  const files = String(before.stdout ?? "").split("\n").map((s) => s.trim()).filter(Boolean);
  if (files.length === 0) return { stashed: false, files: [], error: null };
  const stash = spawnSync("git", ["-C", root, "stash", "push", "--include-untracked", "-m", stashMessage], {
    encoding: "utf8",
  });
  if (stash.status !== 0) return { stashed: false, files, error: (stash.stderr || "").trim() || "git stash failed" };
  const after = spawnSync("git", ["-C", root, "status", "--porcelain"], { encoding: "utf8" });
  const stillDirty = after.status === 0 && String(after.stdout ?? "").trim() !== "";
  return { stashed: true, files, error: stillDirty ? "stash ran but main checkout still dirty" : null };
}

/** 纯函数：解析多任务输入 → { tasks, selectorReason, runPrefix, workerArgv } 或 { error }。 */
export function resolveRun({
  tasks,
  reason,
  workerCmd,
  root,
  runId,
  nowMs,
}: {
  tasks: string[];
  reason: string | undefined;
  workerCmd: string | undefined;
  root: string;
  runId: string | undefined;
  nowMs: number;
}) {
  const taskIds = (tasks ?? []).map((t) => t.trim()).filter(Boolean);
  if (taskIds.length === 0) {
    return { error: "no --task given (selector worker is a later phase; pass --task <id> [--task <id> …])" };
  }
  const selectorReason = (reason && reason.trim()) || "explicit --task selection";
  const workerArgv = workerCmd ? splitArgs(workerCmd) : null; // null ⇒ 每任务用 defaultWorkerArgv
  if (workerArgv !== null && workerArgv.length === 0) return { error: "empty worker command" };
  return { taskIds, selectorReason, runPrefix: runId || `fm-${nowMs}`, workerArgv };
}

// ── worker 单例运行（含超时） ─────────────────────────────────────────────────────────────────────

export interface WorkerRunResult {
  taskId: string;
  outcome: ReturnType<typeof computeOutcome>;
  exitCode: number;
}

/**
 * spawn 一个 worker 并等待其终态（含超时 SIGTERM）。超时 ⇒ kill("SIGTERM")（保留 worktree——驱动从不
 * remove/prune worktree），close 事件带 signal=SIGTERM，timedOut 标记落 outcome final_state=timed-out。
 */
function runOneWorker({
  taskId,
  selectorReason,
  runId,
  workerArgv,
  rootDir,
  outcomeFile,
  timeoutMs,
  inFlightCount,
  json,
  pidFile,
}: {
  taskId: string;
  selectorReason: string;
  runId: string;
  workerArgv: string[];
  rootDir: string;
  outcomeFile: string;
  timeoutMs: number;
  inFlightCount: number;
  json: boolean;
  pidFile?: string;
}): Promise<WorkerRunResult> {
  return new Promise((resolve) => {
    const [cmd, ...cmdArgs] = workerArgv;
    const startedAtMs = Date.now();
    let child: ReturnType<typeof spawn> | null = null;
    let spawnError: string | null = null;
    try {
      child = spawn(cmd, cmdArgs, { cwd: rootDir, stdio: "inherit", detached: false });
    } catch (e) {
      spawnError = e && typeof e === "object" && "message" in e ? String(e.message) : String(e);
    }
    const workerPid = child && child.pid ? child.pid : null;
    let timedOut = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let finished = false;

    const finish = (code: number | null, signal: string | null, spawnErr: string | null) => {
      if (finished) return;
      finished = true;
      if (timer) clearTimeout(timer);
      const endedAtMs = Date.now();
      const outcome = computeOutcome({
        task: taskId, selectorReason, exitCode: code, signal,
        startedAtMs, endedAtMs, workerPid, runId,
        spawnError: spawnErr, inFlightCount, timedOut,
      });
      appendOutcomeToFile(outcomeFile, outcome);
      if (json) process.stdout.write(`${JSON.stringify({ event: "worker-done", task: taskId, ...outcome })}\n`);
      let exitCode: number;
      if (outcome.final_state === "completed") exitCode = 0;
      else if (outcome.final_state === "timed-out") exitCode = 128 + signalExitCode(signal ?? "SIGTERM");
      else if (outcome.final_state === "killed") exitCode = 128 + (signal ? signalExitCode(signal) : 0);
      else if (outcome.final_state === "spawn-failed") exitCode = 2;
      else exitCode = code ?? 2;
      resolve({ taskId, outcome, exitCode });
    };

    // spawn 同步抛错（罕见，如非法 options）：无 ChildProcess ⇒ 直接终态。
    if (!child) {
      finish(null, null, spawnError || "spawn failed");
      return;
    }

    // ⛔ ENOENT 等 spawn 失败：spawn 返回 ChildProcess 但 child.pid === undefined，'error' 事件
    // 异步发出（若无监听器会变成未捕获异常把驱动打成 exit 1）。因此【无条件】先挂 'error' 监听，
    // 再由随后的 'close'（code=-2/signal 空）走 spawn-failed 终态。spawn 成功时才报 worker-spawned。
    child.on("error", (err) => {
      spawnError = String(err && err.message ? err.message : err);
    });
    child.on("close", (code, s) => {
      finish(code, s ?? null, spawnError);
    });

    if (child.pid && json) {
      process.stdout.write(
        `${JSON.stringify({ event: "worker-spawned", task: taskId, worker_pid: workerPid, in_flight_count: inFlightCount, run_id: runId })}\n`,
      );
    }
    if (pidFile && workerPid) {
      try {
        fs.mkdirSync(path.dirname(path.resolve(pidFile)), { recursive: true });
        fs.appendFileSync(path.resolve(pidFile), `${workerPid}\n`, "utf8");
      } catch {
        /* pid-file 是观测抓手，写失败不改变主流程 */
      }
    }

    if (timeoutMs > 0) {
      timer = setTimeout(() => {
        timedOut = true;
        // 超时 ⇒ SIGTERM worker（保留 worktree）。close 事件随后触发并带走 signal=SIGTERM。
        try { child!.kill("SIGTERM"); } catch { /* 已退出 */ }
      }, timeoutMs);
    }
  });
}

// ── CLI 主流程 ─────────────────────────────────────────────────────────────────────────────────────

export async function main(argv: string[]): Promise<number> {
  const args = argv.slice(2);
  let root: string | undefined;
  const tasks: string[] = [];
  let reason: string | undefined;
  let workerCmd: string | undefined;
  let concurrency: number | undefined;
  let timeoutRaw: string | undefined;
  let pidFile: string | undefined;
  let outcomePath: string | undefined;
  let runId: string | undefined;
  let json = false;

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--root") root = args[++i];
    else if (a === "--task") tasks.push(args[++i]);
    else if (a === "--reason") reason = args[++i];
    else if (a === "--worker-cmd") workerCmd = args[++i];
    else if (a === "--concurrency") concurrency = Number(args[++i]);
    else if (a === "--timeout") timeoutRaw = args[++i];
    else if (a === "--pid-file") pidFile = args[++i];
    else if (a === "--outcome") outcomePath = args[++i];
    else if (a === "--run-id") runId = args[++i];
    else if (a === "--json") json = true;
    else if (a === "--help" || a === "-h") {
      console.log(
        "worker-driver — SPEC §5 阶段 2：spawn 多 claude -p worker（并发 N + 超时 SIGTERM + checkout 前 stash）\n" +
          "  --task <id> [--task <id> …] [--reason \"<一句为什么选它>\"] [--concurrency <N>] [--timeout <ms>]\n" +
          "  [--root <repo>] [--worker-cmd \"<argv>\"] [--pid-file <p>] [--outcome <p>] [--run-id <id>] [--json]",
      );
      return 0;
    } else {
      console.error(`worker-driver: unknown argument: ${a}`);
      return 2;
    }
  }

  const rootDir = root ? path.resolve(root) : path.resolve(process.cwd());
  const outcomeFile = outcomePath ? path.resolve(outcomePath) : path.join(rootDir, WORKER_OUTCOME_REL);
  const resolved = resolveRun({ tasks, reason, workerCmd, root: rootDir, runId, nowMs: Date.now() });
  if (resolved.error) {
    console.error(`worker-driver: ${resolved.error}`);
    return 2;
  }
  const { taskIds, selectorReason, runPrefix, workerArgv: sharedWorkerArgv } = resolved;
  const timeoutMs = parseTimeoutMs(timeoutRaw);
  const cap = resolveConcurrency(concurrency, taskIds.length);

  // checkout 前 stash（阶段 2 ③，AC2）：主检出有未提交变更 ⇒ stash，⛔ 不 discard。非 git 仓库 no-op。
  const stash = stashIfDirty(rootDir);
  if (json) {
    process.stdout.write(
      `${JSON.stringify({ event: "stash", stashed: stash.stashed, files: stash.files, error: stash.error })}\n`,
    );
  }

  // 并发调度（阶段 2 ①）：最多 cap 个同时存活。经典 worker-pool——cap 个 dispatcher，每个从共享
  // 游标拉下一个任务跑，一个结束立即补下一个；在飞 = 当前活子进程数（runTask 里直接量增减）。
  const results: WorkerRunResult[] = new Array(taskIds.length);
  let next = 0;
  let inFlight = 0;

  const runTask = async (idx: number): Promise<void> => {
    const taskId = taskIds[idx];
    inFlight += 1;
    const argv = sharedWorkerArgv ?? defaultWorkerArgv(taskId, rootDir);
    const runIdForTask = runId ?? `${runPrefix}-${taskId}`;
    const r = await runOneWorker({
      taskId, selectorReason, runId: runIdForTask, workerArgv: argv, rootDir, outcomeFile,
      timeoutMs, inFlightCount: inFlight, json, pidFile,
    });
    inFlight -= 1;
    results[idx] = r;
  };

  const dispatchers: Promise<void>[] = [];
  for (let i = 0; i < Math.min(cap, taskIds.length); i++) {
    dispatchers.push((async () => {
      while (true) {
        const idx = next;
        if (idx >= taskIds.length) return;
        next += 1;
        await runTask(idx);
      }
    })());
  }
  await Promise.all(dispatchers);

  // 退出码 = 首个非零 worker 退出码（按任务顺序）；全部 completed ⇒ 0。
  const bad = results.find((r) => r && r.exitCode !== 0);
  return bad ? bad.exitCode : 0;
}

// Direct entry guard (gate-script-base convention)：仅当本文件是入口时跑 main()。
if (isDirectEntry(import.meta, undefined, "worker-driver")) {
  main(process.argv).then((code) => {
    process.exitCode = code;
  });
}
