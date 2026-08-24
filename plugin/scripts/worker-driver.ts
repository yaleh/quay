// worker-driver.ts — SPEC-worker-driven-inner-2026-08-16 §5 阶段 2：机械驱动进程 spawn 多个
// claude -p worker 跑完整任务（选择 → worktree → 开发 → suite → ff），并发由驱动数自己的子进程控制，
// 超时 SIGTERM、checkout 前 stash 主检出。退出码 + 结构化 outcome 落盘；任何异常死亡终态清理 orphan
// worktree（⛔ exited-not-landed = exit 0 跑到 fan-in 底但没落地——needs-human 闸拒绝属工作有效，保留
// 分支/worktree 供续做，不走销毁；见 gap-worker-needs-human-destroys-branch-worktree）。
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
//      SIGTERM worker、outcome 记 final_state=timed-out。⛔ 超时也是异常死亡（worker 没落地）⇒ 其
//      orphan worktree 一并清理（gap-worker-driver-no-record-on-abnormal-death，AC2：不清理则挡下轮重派）。
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
//     [--concurrency <N>] [--timeout <ms>] [--worker-cmd "<prefix>"] [--worker-cmd-exact "<argv>"] \
//     [--pid-file <path>] [--outcome <path>] [--run-id <id>] [--json]
//   --task <id>         要跑的任务 id（可重复；无 --task ⇒ 常驻选择环——见阶段 4）
//   --reason <r>        selector 理由（一句话「为什么选它」）；缺省 = "explicit --task selection"
//   --concurrency <N>   并发上限（同时存活 worker 数）。缺省读 QUAY_MAX_TASK_SUBAGENTS（定义点），
//                       再缺省 = 任务数。驱动数自己的子进程，达 cap 则等一个结束再起下一个。
//   --timeout <ms>      单任务墙钟超时（毫秒）。缺省 0 = 无超时（SPEC §4④：先无阈值记录时长分布）。
//                       超时 ⇒ SIGTERM worker、保留 worktree、final_state=timed-out。
//   --worker-cmd <s>    覆盖 worker 命令【前缀】（AC140-3 覆盖语义统一：prompt 仍作为末参数追加）。
//                       缺省 = `quay-launch.sh task-worker -p <prompt>`（launcher/model 由 config 承载）。
//   --worker-cmd-exact <s> 整体替换 worker 命令（测试捕获/注入专用，⛔ prompt 不进 argv）。
//                          取假/测试缝：`node -e process.exit(7)`、`sleep 100`。
//   --pid-file <path>   spawn 后把 worker pid 写到此文件（每 worker 一行；外部可观测 + 杀 worker 抓手）。
//   --outcome <path>    outcome 文件，缺省 <root>/.quay/worker-outcome.jsonl
//   --run-id <id>       run id，缺省 = `fm-<task>-<unix-ms>`
//   --json             spawn 后向 stdout 打 JSON 事件行（stash / worker-spawned / worker-done）
// Exit: 0 = 全部 worker 退出码 0（completed）；非 0 = 首个非零（worker 非零 / 被杀 / 超时 / spawn 失败）。
//       ⛔ 任何终态都写 outcome 记录（阶段 1 AC3：杀 worker 不静默丢任务）。
//
// 阶段 3 新增（AC117，SPEC §5 阶段 3——MCP 控制面）：
//   ① MCP 面（HTTP/SSE）—— serveControlPlane 起一个 StreamableHTTPServerTransport（streamable HTTP，
//      同时支持 POST JSON-RPC 与 GET SSE），暴露三操作 halt / setPreference / forceDispatch。
//   ② 调用方身份显式传且可核（AC2）—— 身份走【header `Mcp-Caller-Id`】或【tool 参数 `caller`】，
//      与 Mcp-Session-Id 无关（后者只能区分「连接」，2026-08-16 实测不知道调用方是 outer 还是 manager）。
//      可核 = 校验调用方 ∈ knownCallers()（QUAY_CONTROL_CALLERS，缺省 outer,manager）。
//   ③ 取假验证（AC3）—— 不带身份调用 ⇒ 拒（isError + "no caller identity"），⛔ 不得按默认身份放行；
//      未知身份（不在 knownCallers）同样拒（"unknown caller"）。
//   halt 语义（AC1）—— 停止【新】派发、⛔ 不杀在飞：halt 只写控制态 halted=true；派发环在【spawn 前】
//   逐任务读控制态，halted ⇒ 记一条 final_state=not-dispatched 的 outcome 并跳过（已 spawn 的在飞 worker
//   完全不受影响——驱动从不因 halt 发信号杀在飞）。
//
// 单一真相源（SPEC §5 阶段 3 退役清单）：
//   `.halt` 文件机制对【驱动】退役 —— 驱动的停机态 = `.quay/worker-control.json`（MCP halt 写、派发环读），
//   ⛔ 驱动【不再】读 `.halt`、⛔ 不两者并存（两个真相源）。worker-control.json 与 worker-outcome.jsonl 同族
//   （gitignored 运行时状态）。读失败 fail-closed（读失败/解析失败 ⇒ halted=true，硬规则 3b：读不懂 ≠ 合格）。
//   注：.halt 仍被【旧三层循环】的 halt-check.sh / slot-refill.ts 等消费——它们的退役属外层 SPEC 迁移范围，
//   本文件只管【驱动】这一条停机来源，不读 .halt、也不与它并存为驱动停机态。
//
// 控制态文件（.quay/worker-control.json，单一真相源）：
//   { schemaVersion:1, halted:boolean, halted_by, halted_at, preference:{k:v}, forced:[{task,reason,caller,at}] }
//   - halt({halted=true})  ⇒ 写 halted/halted_by/halted_at
//   - setPreference(k,v)   ⇒ 写 preference[k]=v（selector 的倾向存储，SPEC §3.1）
//   - forceDispatch(task)  ⇒ append forced[]（强制派发记录，驻留驱动的 selector 环消费；本阶段驱动仍用
//     显式 --task，forceDispatch 落盘记录即可观测）
//
// Run（MCP 控制面）:
//   node --experimental-strip-types plugin/scripts/worker-driver.ts --serve \
//     --root <repo> [--host 127.0.0.1] [--port <n>] [--json]
//
// 阶段 4 新增（AC129，SPEC §5 阶段 4——常驻驱动 + 自主选任务，把「谁决定现在跑哪个任务」从 inner 的
// LLM tick 会话移到本常驻进程）：
//   ① 常驻循环 —— 无 --task 启动 ⇒ 驱动不再「单次 spawn 后退出」，而是常驻：跑完一个 worker 不退出，
//      池非空且未达并发 cap 时自动起下一个（AC1）。
//   ② 选择环 —— 每次起新 worker 前，调 ready-pool-check 取可行集 → 减内存中在飞集 → 打散 → 交短命
//      selector worker（LLM 语义选择，SPEC §1 设计点1）挑一个，`selector_reason` 落 selector 的真实理由
//      （不再恒为 "explicit --task selection"，AC2）。selector 无有效选择 ⇒ fail-closed 回退打散后首个。
//   ③ 判停（AC3，能取假）—— 起新 worker 前逐轮判：MCP halt（isHalted，AC117 单一真相源）/
//      resource-gate 报 WAIT（exit 非 0，fail-closed）/ 池空 ⇒ 停止起新 worker，⛔ 不杀在飞（在飞 worker
//      跑完才退出）。⛔ 不读 `.halt` 文件（与 AC117 退役清单一致——驱动停机态只有一个真相源）。
//
// Run（常驻选择环）:
//   node --experimental-strip-types plugin/scripts/worker-driver.ts \
//     --root <repo> [--concurrency <N>] [--timeout <ms>] [--worker-cmd "<prefix>"] [--worker-cmd-exact "<argv>"] \
//     [--selector-cmd "<argv>"] [--ready-pool-cmd "<argv>"] [--resource-gate-cmd "<argv>"] \
//     [--pid-file <path>] [--outcome <path>] [--run-id <id>] [--json]
//   ⛔ 无 --task ⇒ 常驻选择环（不再报错退出）。--task 仍走显式批量派发（行为不变）。
//   --selector-cmd <s>      selector worker 命令（短命 LLM，输出一行 `<task-id> <一句理由>`）。
//                           缺省 = `claude -p <选择 prompt（内联打散后的候选 id 列表）>`。
//   --ready-pool-cmd <s>    覆盖 ready-pool-check 命令（测试缝）。缺省 = `node …ready-pool-check.ts
//                           --root <root> --cap <cap> [--in-flight <ids>] --json`。输出须为 analyzeTasks
//                           JSON（读其 `ready` 数组）。解析失败/非零 ⇒ fail-closed 视为池空。
//   --resource-gate-cmd <s> 覆盖 resource-gate 命令（测试缝）。缺省 = `bash …resource-gate.sh
//                           --for full-suite --json`。exit 0 = GO，非 0 = WAIT（fail-closed）。

import fs from "node:fs";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { isDirectEntry, readFrontmatter } from "./gate-script-base.ts";
// AC150-3：资源门判定 + 控制态 + 身份闸 + MCP 控制面，抽到 driver-shared.ts 供 promotion-driver 复用
// （函数级复用，⛔ 非复制粘贴）。本文件仍 re-export 保持旧 import 面（worker-driver.test.mjs 等）。
import {
  resourceGateCheck,
  serveControlPlane,
  isHalted,
} from "./driver-shared.ts";
export {
  CONTROL_STATE_REL,
  CONTROL_CALLERS_ENV,
  DEFAULT_CALLERS,
  CONTROL_HEADER,
  CONTROL_HEADER_NAME,
  defaultControlState,
  mergeControlState,
  readControlState,
  writeControlState,
  isHalted,
  applyHalt,
  applyPreference,
  applyForceDispatch,
  knownCallers,
  resolveCaller,
  headerValue,
  resourceGateCheck,
  serveControlPlane,
} from "./driver-shared.ts";
import { parseTask, readDependsOn } from "./task-schema.ts";
import { parseTouches, checkTouchesPair } from "./touches-orthogonality-check.ts";
import { expandDeclaredTouches } from "./concurrent-batch-scheduler.ts";
import { listWorktrees, taskIdFromBranch } from "./fast-mode-telemetry.ts";

// ── 常量 ───────────────────────────────────────────────────────────────────────────────────────────

/** outcome 文件的仓库相对路径（gitignored 运行时日志，dispatch-record.jsonl 同族）。 */
export const WORKER_OUTCOME_REL = ".quay/worker-outcome.jsonl";

/** round 记录（无条件心跳）的仓库相对路径（gitignored 运行时日志，worker-outcome.jsonl 同族）。 */
export const WORKER_ROUND_REL = ".quay/worker-round.jsonl";

/** 终态枚举：completed（退出码 0 且落地）/ exited-not-landed（退出码 0 但没落地）/ failed（非零退出）/
 *  killed（被信号杀）/ timed-out（超时 SIGTERM）/ spawn-failed（起不来）/ not-dispatched（halt 未派）。 */
export const FINAL_STATES = ["completed", "exited-not-landed", "failed", "killed", "timed-out", "spawn-failed", "not-dispatched"] as const;

/** 驱动对 exited-not-landed 的退出码（gap-worker-driver-fake-completion-exit-0：exit 0 ≠ 落地，
 *  区别于 spawn-failed=2 / killed=128+sig / timed-out=128+SIGTERM=143 / failed=worker 码）。 */
export const EXITED_NOT_LANDED_EXIT = 3;

/** 并发上限的定义点（concurrency-literal-check 的唯一定义点旋钮①，人 2026-08-13）。缺省并发读它。 */
export const MAX_TASK_SUBAGENTS_ENV = "QUAY_MAX_TASK_SUBAGENTS";

/** checkout 前 stash 的缺省 message（`git stash list` 可核的标记，AC2）。 */
export const DEFAULT_STASH_MESSAGE = "worker-driver: stash before checkout (SPEC §5 阶段 2)";

/** 存活 worker 进程的 `-n` 名（quay-launch.sh 由 .claude/launch.settings.json 的
 *  `_launchSpec.roles["task-worker"].name` 承载；AC140-2 测试钉死 name 以 quay- 开头）。
 *  冷启动在飞枚举用它识别存活 worker 进程的 cmdline（/proc/<pid>/cmdline）。
 *  AC150-3：控制态常量（CONTROL_STATE_REL/CONTROL_CALLERS_ENV/DEFAULT_CALLERS/CONTROL_HEADER/
 *  CONTROL_HEADER_NAME）已随控制面抽到 driver-shared.ts 并在本文件 re-export；本常量是 worker
 *  独有（进程名识别），保留在本文件。 */
export const WORKER_PROCESS_NAME = "quay-task-worker";

/** 常驻循环【无在飞 worker 且瞬时 WAIT】时的轮询间隔（ms，测试缝经 --interval 传小值）。与
 *  promotion-driver 的 INTERVAL_MS_DEFAULT 同语义：resource-gate-wait / pool-empty 是瞬时态
 *  （闸随负载降会放行、池随 promotion-driver 持续补），等 intervalMs 后重读而非退出
 *  （gap-worker-driver-stopreason-latch-permanent-stop）。 */
export const RESIDENT_INTERVAL_MS_DEFAULT = 30_000;

// ── 纯函数（可单测） ───────────────────────────────────────────────────────────────────────────────

/**
 * 一条结构化 outcome 记录（SPEC §4③ 字段齐全 + 直接量 + 超时标记 + 落地判定）。
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
  landed = null,
  landReason = null,
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
  landed?: boolean | null;
  landReason?: string | null;
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
  } else if (landed !== true) {
    // gap-worker-driver-fake-completion-exit-0：exit 0 只是「进程正常退出」，⛔ 不是「任务落地」。
    //   completed 必须与 status=done ∧ 无残留 worktree 一致（AC1 判据不写在 exit_code 上）。
    //   landed=false（确认没落地）与 landed=null（读不懂，fail-closed 朝未落地）都不等于完成——
    //   两者共用独立取值 exited-not-landed（硬规则 3b：跑完没落地 ≠ 完成，⛔ 不伪造成 completed）。
    finalState = "exited-not-landed";
    failureReason =
      landReason ??
      (landed === false
        ? "worker exited 0 but task did not land (status≠done or leftover worktree)"
        : "worker exited 0 but landing not verified (task status / worktree read failed)");
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

// ── 落地判定（gap-worker-driver-fake-completion-exit-0）──────────────────────────────────────────
// exit_code=0 只是「进程正常退出」，⛔ 不是「任务落地」。写 final_state=completed 前必须读一次任务侧
// 直接量：status=done（任务文件 frontmatter）∧ 无残留 worktree（`git worktree list` 无 task/<id> 分支）。
// 共同纪律（同族 gap-fix-worker-edit-exit-4）：驱动写任何终态之前，必须读任务侧的直接量。

/** 读任务文件 status frontmatter（`<root>/tasks/<id>.md`）。缺失/读失败 ⇒ null。 */
export function readTaskStatus(root: string, taskId: string): string | null {
  try {
    const fm = readFrontmatter(path.join(root, "tasks", `${taskId}.md`));
    return fm?.status ?? null;
  } catch {
    return null;
  }
}

/**
 * 派发前 depends_on 二次过滤（gap-worker-driver-dispatch-pre-filter-missing AC1）：读候选任务的
 * `depends_on` 关系边（task-schema 的 readDependsOn——与 ready-pool-check 的 depsReadyFor 读同一
 * 字段，单一真相源，⛔ 不重写依赖解析），逐个核对依赖的 status。任一依赖未 done（或依赖文件缺失，
 * 读不懂 ⇒ fail-closed 不派发）⇒ false。无依赖 ⇒ true（⛔ 空依赖是「真无依赖」，不是「读不懂」——
 * 候选自身文件读失败才 ⇒ false，硬规则 3b：读不懂 ≠ 无依赖）。与 gap-launch-script-worker-cap-broken
 * AC3 的 Touches 互斥过滤同属「spawn 前候选过滤」的两半。
 */
export function depsReadyForDispatch(root: string, taskId: string): boolean {
  let deps: string[];
  try {
    const text = fs.readFileSync(path.join(root, "tasks", `${taskId}.md`), "utf8");
    deps = readDependsOn(parseTask(text).frontmatterRaw);
  } catch {
    return false; // 候选文件不可读 ⇒ fail-closed（不派发）
  }
  if (deps.length === 0) return true;
  for (const depId of deps) {
    if (readTaskStatus(root, depId) !== "done") return false;
  }
  return true;
}

/** 转义正则元字符（task id 进 `new RegExp` 前）。 */
function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** 是否存在本任务残留 worktree（`git worktree list --porcelain` 里的 `branch refs/heads/task/<id>`）。
 *  fan-in 成功后 `git worktree remove` + `git branch -d task/<id>` 把该分支删掉 ⇒ 无该行 = 无残留。
 *  读失败（非 git 仓库 / git 错误）⇒ null（硬规则 3b：读不懂 ≠ 无残留）。 */
export function worktreePresentForTask(root: string, taskId: string): boolean | null {
  const r = spawnSync("git", ["-C", root, "worktree", "list", "--porcelain"], { encoding: "utf8" });
  if (r.status !== 0 || r.error) return null;
  const re = new RegExp(`^branch refs/heads/task/${escapeRegExp(taskId)}$`, "m");
  return re.test(String(r.stdout ?? ""));
}

/** 本任务残留 worktree 的路径列表（`git worktree list --porcelain` 里 `branch refs/heads/task/<id>` 行
 *  对应的 `worktree <path>` 行）。读失败（非 git 仓库 / git 错误）⇒ []（硬规则 3b：读不懂 ≠ 确认无残留，
 *  用 worktreePresentForTask 区分「读不懂」（null）与「确认无残留」（false））。 */
export function worktreePathsForTask(root: string, taskId: string): string[] {
  const r = spawnSync("git", ["-C", root, "worktree", "list", "--porcelain"], { encoding: "utf8" });
  if (r.status !== 0 || r.error) return [];
  const paths: string[] = [];
  let current: string | null = null;
  for (const line of String(r.stdout ?? "").split("\n")) {
    if (line.startsWith("worktree ")) {
      current = line.slice("worktree ".length).trim();
    } else if (line === `branch refs/heads/task/${taskId}` && current != null) {
      paths.push(current);
    }
  }
  return paths;
}

// ── 冷启动在飞枚举（gap-worker-driver-cold-start-inflight-blind）───────────────────────────────────
// driver 的 running 是纯内存数组、冷启动从空集起：restart / supervisor 崩溃自动 respawn 后，新进程
// 不认得重启前就存活的 worker。`ready-pool-check` 的 notInFlight 完全依赖调用方传入的 in-flight id
// 列表、无独立「该 task 已有存活 worktree」维度 ⇒ 新 driver 会重复派发这些 task（撞同一 worktree），
// 重复者被杀后 failed 终态又触发 cleanupOrphanWorktree 误删原 worker 仍在用的共享 worktree+分支。
// 修法（manager 裁定）：枚举真实存活的 task worktree + 交叉核对存活 quay-task-worker 进程 pid，
// 把「worktree 在 ∧ 存活 worker 在」的 task 预先纳入「已在飞」排除集。worktree 复用 fast-mode-
// telemetry 的 listWorktrees/taskIdFromBranch（单一真相源，⛔ 不另写 porcelain 解析器）。

/** 枚举所有开着的 task worktree 的 task id（`task/<id>` 分支）。git 失败 / 非 git 仓库 ⇒ []。 */
export function enumerateTaskWorktreeTasks(root: string): string[] {
  const ids: string[] = [];
  for (const wt of listWorktrees(root)) {
    const id = taskIdFromBranch(wt?.branch);
    if (id != null) ids.push(id);
  }
  return ids;
}

/** 扫描 /proc/<pid>/cmdline，返回所有含 `quay-task-worker` 的存活进程 cmdline（空格 join，读失败跳过）。
 *  procDir 是测试缝（缺省 /proc）。读不到 /proc（非 Linux / 权限）⇒ []（硬规则 3b：读不懂 ≠ 无存活，
 *  由调用方 fail-closed——enumerateColdStartInflight 交集为空即不排除，方向是「少排除 ⇒ 可能重派」，
 *  比「误判全部存活」安全）。 */
export function enumerateLiveWorkerCmdlines(procDir: string = "/proc"): string[] {
  let entries: string[];
  try {
    entries = fs.readdirSync(procDir);
  } catch {
    return [];
  }
  const out: string[] = [];
  for (const e of entries) {
    if (!/^\d+$/.test(e)) continue;
    let buf: Buffer;
    try {
      buf = fs.readFileSync(path.join(procDir, e, "cmdline"));
    } catch {
      continue; // 进程已退 / 无权限 ⇒ 跳过
    }
    const cmdline = buf.toString("utf8").replace(/\0/g, " ").trim();
    if (cmdline.includes(WORKER_PROCESS_NAME)) out.push(cmdline);
  }
  return out;
}

/** 该 task 是否有存活 worker 正在跑：某存活进程 cmdline 同时含 `quay-task-worker`（-n 名）与该 task id
 *  （worker prompt 里的 "Task: <id>"）。纯谓词，cmdline 列表注入（缺省由调用方从 /proc 取）。
 *  task id 用【词边界】匹配，⛔ 不用裸 substring——短 id（如 `gap-t`）会作为前缀命中 `gap-test-…` /
 *  `gap-todo-…` 的存活 worker cmdline（2026-08-24 实测：测试 task `gap-t` 误命中生产 worker
 *  `gap-test-fixture-pollutes-bash-history` ⇒ cleanupOrphanWorktree 假跳过）。边界字符类 = 字母/数字/
 *  下划线/连字符（task id 全由它们组成 ⇒ `gap-t` 后跟 `e` 或 `-` 都不算命中，后跟 `.`/空格/行尾才算）。 */
export function hasLiveWorkerForTask(taskId: string, workerCmdlines: string[]): boolean {
  const re = new RegExp(`(^|[^a-zA-Z0-9_-])${escapeRegExp(taskId)}(?![a-zA-Z0-9_-])`);
  return workerCmdlines.some((cmd) => cmd.includes(WORKER_PROCESS_NAME) && re.test(cmd));
}

/** 冷启动「已在飞」排除集：task id 同时满足 ① 有 task/<id> worktree、② 有存活 worker 进程。二者缺一
 *  不纳入（只有 worktree 无进程 = orphan，可清、可重派；只有进程无 worktree = 尚未 fork，由内存
 *  running 覆盖）。opts.worktreeTasks / opts.workerCmdlines 是测试缝（null ⇒ 用真实 git / /proc）。 */
export function enumerateColdStartInflight(
  root: string,
  opts: { worktreeTasks?: string[] | null; workerCmdlines?: string[] | null } = {},
): Set<string> {
  const worktreeTasks = opts.worktreeTasks ?? enumerateTaskWorktreeTasks(root);
  if (worktreeTasks.length === 0) return new Set(); // 无 task worktree ⇒ 无冷启动在飞（⛔ 不白扫 /proc）
  const workerCmdlines = opts.workerCmdlines ?? enumerateLiveWorkerCmdlines();
  const out = new Set<string>();
  for (const taskId of worktreeTasks) {
    if (hasLiveWorkerForTask(taskId, workerCmdlines)) out.add(taskId);
  }
  return out;
}

/** orphan worktree 清理结果（可观测：removed/分支删除/错误/存活跳过）。 */
export interface OrphanCleanupResult {
  /** 找到 worktree 且 `git worktree remove --force` 全部成功。 */
  removed: boolean;
  /** 首个被移除（或移除失败）的 worktree 路径；未找到 ⇒ null。 */
  worktreePath: string | null;
  /** `task/<id>` 分支是否删除成功（worktree remove 不删分支；分支还在 ⇒ 下一轮 `-b` 重建仍失败）。 */
  branchDeleted: boolean;
  /** 移除失败的错误（worktree 找到但 remove 失败）；无错误 ⇒ null。 */
  error: string | null;
  /** worktree 有存活 worker 正在用 ⇒ 跳过清理（⛔ 不是「没找到」也不是「remove 失败」——独立取值，
   *  硬规则 3b：跳过 ≠ 已清）。false = 未跳过（已清 / 无 worktree / 正常失败）。 */
  skippedLiveWorker: boolean;
}

/**
 * orphan worktree 清理（gap-worker-driver-no-record-on-abnormal-death AC2）：worker 异常死亡（failed /
 * killed / timed-out——worker 没跑完、无完成实现）后，其 orphan worktree 永久残留会挡 driver 下轮对同一
 * task 的 `git worktree add`（撞已存在路径 / 分支失败 ⇒ 需人工 remove）。清理 =
 * `git worktree remove --force <path>` + `git branch -D task/<id>`。⛔ 只在 worker 已退出（close 事件后）
 * 调用；⛔ completed 路径不调（落地判定已确认无残留）；⛔ exited-not-landed 路径不调——那是 worker
 * exit 0 跑到 fan-in 底但没落地（needs-human 闸拒绝 = 工作有效，套件绿 + 实现完成），分支/worktree
 * 必须保留供续做（gap-worker-needs-human-destroys-branch-worktree AC1），销毁会让完成实现永久丢失。
 * best-effort：移除失败（脏树 / 锁 / 活进程）不致命，error 落盘供观测，⛔ 不抛。
 *
 * gap-worker-driver-cold-start-inflight-blind AC2（存活校验）：重复派发场景下，被 kill 的【重复者】走
 * failed 终态触发本清理，而【原 worker】仍活、仍在用同一个 worktree——此时删除会连带误删原 worker 的
 * 共享 worktree+分支。故移除前先核：worktree 有存活 worker 正在用 ⇒ 跳过（skippedLiveWorker=true，
 * ⛔ 只清真 orphan）。workerCmdlines 是测试缝（null ⇒ 读真实 /proc）。
 */
export function cleanupOrphanWorktree(root: string, taskId: string, workerCmdlines: string[] | null = null): OrphanCleanupResult {
  const paths = worktreePathsForTask(root, taskId);
  if (paths.length === 0) {
    return { removed: false, worktreePath: null, branchDeleted: false, error: null, skippedLiveWorker: false };
  }
  const live = workerCmdlines ?? enumerateLiveWorkerCmdlines();
  if (hasLiveWorkerForTask(taskId, live)) {
    return { removed: false, worktreePath: paths[0] ?? null, branchDeleted: false, error: null, skippedLiveWorker: true };
  }
  let error: string | null = null;
  let removed = true;
  for (const p of paths) {
    const rm = spawnSync("git", ["-C", root, "worktree", "remove", "--force", p], { encoding: "utf8" });
    if (rm.status !== 0) {
      removed = false;
      error = (rm.stderr || "").trim() || `git worktree remove ${p} failed`;
    }
  }
  let branchDeleted = false;
  if (removed) {
    const bd = spawnSync("git", ["-C", root, "branch", "-D", `task/${taskId}`], { encoding: "utf8" });
    branchDeleted = bd.status === 0;
  }
  return { removed, worktreePath: paths[0] ?? null, branchDeleted, error, skippedLiveWorker: false };
}

/** 落地判定（AC1 判据）：landed = status=done ∧ 无残留 worktree。任一读失败 ⇒ landed=false
 *  （fail-closed 朝「未落地」，硬规则 3b：读不懂 ≠ 落地）。返回详细 reason（写进 failure_reason）。 */
export function computeLandingState(root: string, taskId: string): {
  landed: boolean;
  status: string | null;
  worktreePresent: boolean | null;
  reason: string;
} {
  const status = readTaskStatus(root, taskId);
  const worktreePresent = worktreePresentForTask(root, taskId);
  const statusOk = status === "done";
  const worktreeOk = worktreePresent === false; // false = 确认无残留；null = 读不懂 ⇒ 视为未落地
  const landed = statusOk && worktreeOk;
  let reason: string;
  if (landed) {
    reason = "landed (status=done, no leftover worktree)";
  } else if (statusOk && worktreePresent === true) {
    reason = `status=done but leftover worktree task/${taskId} still present`;
  } else if (statusOk && worktreePresent === null) {
    reason = "status=done but worktree state unreadable (git worktree list failed)";
  } else if (!statusOk && worktreeOk) {
    reason = `task status=${status ?? "missing"} (not done)`;
  } else {
    reason = `task status=${status ?? "missing"} (not done) and worktree ${worktreePresent === null ? "unreadable" : "still present"}`;
  }
  return { landed, status, worktreePresent, reason };
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

// ── liveness 检查（gap-resident-driver-stable-carrier-liveness Finding：liveness 子命令零调用者）──
// AC2 承诺的「driver/supervisor 死时有机件在窗口内检测并报告」此前没有任何东西触发 liveness 子命令
// （log 13h 无更新）。修法（Finding）：driver 自身 round 循环每轮顺手调一次 liveness——supervisor 死后
// driver 成孤儿仍在跑，它的下一轮即检出 supervisor_dead 并让 liveness 子命令写 DEATH 告警（⛔ 载体停更
// ≠ 一切正常）。复用的是 launch 脚本已测的 liveness 子命令（单一真相源），⛔ 不在驱动里重写存活判定。

/** liveness 检查的 wall-clock 上限（spawnSync timeout，毫秒）。轻量（kill -0 判定），远小于 round。 */
export const LIVENESS_CHECK_TIMEOUT_MS = 10_000;

/** 缺省 liveness 检查命令：复用 promotion-driver-launch.sh 的 liveness 子命令（单一真相源）。kind 是
 *  驱动文件身份（worker-driver.ts 恒 worker；promotion-driver.ts 恒 promotion，同函数传不同 kind）。
 *  exit 0 = 健康（deaths=none），exit 1 = 检出死亡（deaths 非空）——两者都是「查过」。 */
export function defaultLivenessCheckArgv(root: string, kind: "promotion" | "worker"): string[] {
  return [
    "bash", path.join(root, "plugin", "scripts", "promotion-driver-launch.sh"),
    "liveness", "--kind", kind, "--root", root, "--json",
  ];
}

/** 单轮 liveness 检查结果。checked=false ⇒ 未查成（launch 脚本缺失 / spawn 失败 / 输出不可解析）——
 *  这是「未评估」，⛔ 不是「健康」（硬规则 3b：无法评估 ≠ 合格，独立取值）。deaths=null + checked=true
 *  ⇒ 查过且健康（deaths=none）；deaths 非空 ⇒ 查过且检出死亡。running = supervisor_alive && driver_alive。 */
export interface LivenessResult {
  checked: boolean;
  deaths: string | null;
  running: boolean;
}

/** 跑一次 liveness 检查（复用 launch 脚本 liveness 子命令，⛔ 不重写存活判定）。cmd 覆盖命令（测试缝，
 *  同 --ready-pool-cmd/--selector-cmd 的形状）；缺省 = defaultLivenessCheckArgv(root, kind)。 */
export function runLivenessCheck(root: string, kind: "promotion" | "worker", cmd: string[] | null = null): LivenessResult {
  const argv = cmd ?? defaultLivenessCheckArgv(root, kind);
  try {
    const r = spawnSync(argv[0], argv.slice(1), {
      encoding: "utf8", timeout: LIVENESS_CHECK_TIMEOUT_MS, maxBuffer: 1024 * 1024,
      stdio: ["ignore", "pipe", "ignore"],
    });
    // 脚本缺失 ⇒ bash exit 127、stdout 空 ⇒ JSON.parse 抛 ⇒ catch 归 checked:false；spawn 失败 / 无状态
    // 亦归 checked:false（未查成）。exit 1（检出死亡）r.error 为 null ⇒ 正常走 parse。
    if (r.error || r.status === null) return { checked: false, deaths: null, running: false };
    const j = JSON.parse(String(r.stdout ?? "").trim());
    const deaths = j && typeof j.deaths === "string" && j.deaths !== "none" && j.deaths !== "" ? String(j.deaths) : null;
    return { checked: true, deaths, running: !!j.running };
  } catch {
    return { checked: false, deaths: null, running: false };
  }
}

/**
 * 一条 worker round 记录（AC138-3 无条件心跳）：⛔ 与 outcome 分工——outcome 只在任务真完成（或
 * 终态）时写，池空时 outcome 停更会被 supervisor status 的 last_record_ts（读全载体 max）误读为
 * 「死亡」；round 每轮循环无条件写一条（含池空/判停轮），作 liveness 直接量。ts 是首字段
 * （supervisor _carrier_stats 的 `"ts"` grep 依赖）。
 */
export function computeWorkerRoundRecord(opts: {
  round: number;
  runId: string;
  pid: number;
  at: string;
  action: "start" | "dispatch" | "idle" | "stop";
  inFlight: number;
  pool: number | null;
  stopReason: string | null;
  liveness?: LivenessResult | null;
}) {
  return {
    ts: opts.at,
    round: opts.round,
    run_id: opts.runId,
    pid: opts.pid,
    action: opts.action,
    in_flight: opts.inFlight,
    pool: opts.pool,
    stop_reason: opts.stopReason,
    liveness: opts.liveness ?? null,
  };
}

/** 把一条 round 记录追加写入指定文件（mkdir -p + appendFileSync，一行一 JSON，⛔ 不截断不覆盖）。 */
export function appendRoundToFile(file: string, record: ReturnType<typeof computeWorkerRoundRecord>): string {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, JSON.stringify(record) + "\n", "utf8");
  return file;
}

/** 空格分隔 argv 切分（⛔ 无 shell 元字符 / 引号；用于 --worker-cmd/--worker-cmd-exact 与默认 claude -p）。 */
export function splitArgs(cmd: string): string[] {
  return cmd.trim().split(/\s+/).filter(Boolean);
}

/**
 * 单一真相源（AC140-1）：驱动 LLM spawn 的 argv 构造——走 `quay-launch.sh <role> -p <prompt>`。
 * launcher / model / --bare / -n 全部由 `.claude/launch.settings.json` 的 `_launchSpec.roles[<role>]`
 * 承载（⛔ 不在驱动里硬编码 claude/wrapper/model，四处分立的 `["claude","-p",…]` 全部归到这一处）。
 * role ∈ task-worker | selector | fix-worker。wrapper 的贡献全在 env（claude-fjdac 末行 `exec claude`），
 * 故本 argv 只看得见 `bash` + `quay-launch.sh`——AC2 取假须读 spawn 出的 worker 进程 env（ANTHROPIC_BASE_URL）。
 */
export function launchArgv(role: string, prompt: string, root: string): string[] {
  return ["bash", path.join(root, "plugin", "scripts", "quay-launch.sh"), role, "-p", prompt];
}

/** worker 命令覆盖的两个旋钮（AC140-3 覆盖语义统一）：prefix = 前缀（prompt 追加）；exact = 整体替换（测试专用）。 */
export interface WorkerCmdOptions {
  prefix: string | null;
  exact: string | null;
}

/** 创建 prompt（无保留 worktree 时的 full-chain prompt，单一真相源）。续做 prompt 见
 *  buildContinueWorkerPrompt；两者由 workerPromptForTask 按「保留 worktree 在不在」择一。 */
export function buildWorkerPrompt(task: string, root: string): string {
  return [
    `You are a per-task worker in the quay repo (SPEC-worker-driven-inner §5 阶段 2).`,
    `Task: ${task}. Repo root: ${root}.`,
    `Run the full task chain: (1) create an isolated git worktree for ${task},`,
    `(2) implement the task per its Proposal/Plan/AC/DoD, (3) run the suite,`,
    `(4) ff-merge to develop via the fan-in-execute workflow (scriptPath, args={task,worktree,root,runId,mergeTarget}).`,
    `You own your worktree fully; apart from the final merge do not touch develop.`,
  ].join(" ");
}

/** 按覆盖旋钮解析一个 task 的 worker argv（单一构造 + AC140-3 覆盖语义统一）：
 *  exact 非空 ⇒ 整体替换（--worker-cmd-exact，测试捕获/注入专用，prompt 不进 argv 是预期）；
 *  否则 prefix 非空 ⇒ 前缀 + prompt（--worker-cmd，wrapper/测试前缀可用，prompt 作为末参数追加）；
 *  否则 ⇒ launchArgv("task-worker", prompt)（配置承载的缺省，走 quay-launch.sh）。 */
export function workerArgvForTask(task: string, root: string, opts: WorkerCmdOptions = { prefix: null, exact: null }): string[] {
  const prompt = workerPromptForTask(task, root);
  if (opts.exact != null) {
    const a = splitArgs(opts.exact);
    return a.length > 0 ? a : launchArgv("task-worker", prompt, root);
  }
  if (opts.prefix != null) {
    const p = splitArgs(opts.prefix);
    return p.length > 0 ? [...p, prompt] : launchArgv("task-worker", prompt, root);
  }
  return launchArgv("task-worker", prompt, root);
}

/** 缺省 worker 命令：quay-launch.sh task-worker -p <full-chain prompt>（argv 形，child 即 worker，超时
 *  SIGTERM 杀得准）。launcher/model/--bare 由 `_launchSpec.roles["task-worker"]` 承载（AC140-2 可配）。
 *  prompt 里【直接】要求 worker 以 scriptPath 调 fan-in-execute workflow——驱动直调 ⇒ A6「检查 fan-in
 *  是否走 workflow」退役（SPEC §5 阶段 2 退役清单②）。 */
export function defaultWorkerArgv(task: string, root: string): string[] {
  return launchArgv("task-worker", workerPromptForTask(task, root), root);
}

// ── 续做复用（gap-worker-worktree-continue-reuse）──────────────────────────────────────────────
// destroy-path 修复（0a8e7a8d）落地后 exited-not-landed 的 worktree 被【正确保留】但没人接着做：
// 派发 prompt 仍是 buildWorkerPrompt 的「create an isolated git worktree」⇒ 重派 worker 一上来就
// `git worktree add` 撞已存在对象硬失败（路径+分支都在 ⇒ fatal）。本段补「派发前检测已有 worktree ⇒
// 走续做 prompt（复用 + 携带前一轮状态）」，让保留的 worktree 被【接着做】而非从头重做（57 次量级）。
// ⛔ 驱动仍只做机械读取（git log / 任务文件 AC 段 / worker-outcome.jsonl），不调 LLM 判断。

/** 续做状态：exited-not-landed 保留 worktree 的任务重派时，派发前机械搜集「前一轮做到哪」。 */
export interface ContinueWorkerState {
  /** 保留 worktree 的路径（`git worktree list --porcelain` 的 worktree <path> 行）。null = 读不懂。 */
  worktreePath: string | null;
  /** task/<id> 分支【自己】的提交数（HEAD..task/<id>，⛔ 不含继承历史）。null = 读不懂（git 失败）；0 = 读懂了但无提交。 */
  branchCommits: number | null;
  /** 分支最新【自己】提交主题（HEAD..task/<id>）。null = 无提交 / 读不懂。 */
  branchHeadSubject: string | null;
  /** AC 勾选状态（勾了几条）。null = 任务文件 AC 段读不懂（硬规则 3b：读不懂 ≠ 零）。 */
  acChecked: number | null;
  /** AC 总条数。null = 任务文件 AC 段读不懂（与 checked 同源）。 */
  acTotal: number | null;
  /** 上次 exited-not-landed 的失败原因（worker-outcome.jsonl 该 task 最近一条）。null = 无记录 / 读不懂。 */
  failureReason: string | null;
}

/** AC 勾选状态（AC2）：读任务文件的 Acceptance Criteria 段，数 `- [x]`（勾）与 `- [ ]`（未勾）。
 *  段从 `## Acceptance Criteria` / `## AC`（含 `（draft）` / `(draft)` 后缀）标题起，到下一个 `## ` 标题止。
 *  文件缺失 / 无 AC 段 ⇒ {checked:null,total:null}（硬规则 3b：读不懂 ≠ 零——与「读到 0 条」可区分）。 */
export function readAcCheckState(root: string, taskId: string): { checked: number | null; total: number | null } {
  let text: string;
  try {
    text = fs.readFileSync(path.join(root, "tasks", `${taskId}.md`), "utf8");
  } catch {
    return { checked: null, total: null };
  }
  const lines = text.split("\n");
  let inAc = false;
  let found = false;
  let checked = 0;
  let total = 0;
  for (const line of lines) {
    if (/^##\s+/i.test(line)) {
      if (inAc) break; // 下一个标题 ⇒ AC 段结束
      if (/^##\s+(Acceptance Criteria|AC)\b/i.test(line)) {
        inAc = true;
        found = true;
      }
      continue;
    }
    if (!inAc) continue;
    if (/^\s*-\s*\[[xX]\]/.test(line)) {
      checked += 1;
      total += 1;
    } else if (/^\s*-\s*\[\s*\]/.test(line)) {
      total += 1;
    }
  }
  if (!found) return { checked: null, total: null };
  return { checked, total };
}

/** task/<id> 分支「自己的」提交数（AC2「分支已有提交」）——`HEAD..task/<id>`：只数前一轮 worker 提交的
 *  实现（⛔ 不含继承的 develop 历史，否则恒为整库提交数、无信息）。HEAD = 主检出当前分支（=develop，
 *  驱动在主检出跑、stash 后仍停在 develop）。git 失败 / 分支不存在 ⇒ null（读不懂 ≠ 0 提交）。 */
export function countBranchCommits(root: string, taskId: string): number | null {
  const r = spawnSync("git", ["-C", root, "rev-list", "--count", `HEAD..task/${taskId}`], { encoding: "utf8" });
  if (r.status !== 0 || r.error) return null;
  const out = String(r.stdout ?? "").trim();
  if (out === "") return 0;
  const n = Number(out);
  return Number.isFinite(n) ? n : null;
}

/** task/<id> 分支最新【自己】提交主题（AC2「分支已有提交」的 head 上下文，`HEAD..task/<id>`）。
 *  无自己的提交 / 读失败 ⇒ null。 */
export function branchHeadSubject(root: string, taskId: string): string | null {
  const r = spawnSync("git", ["-C", root, "log", "-1", "--format=%s", `HEAD..task/${taskId}`], { encoding: "utf8" });
  if (r.status !== 0 || r.error) return null;
  const out = String(r.stdout ?? "").trim();
  return out === "" ? null : out;
}

/** 该 task 最近一条 exited-not-landed 的失败原因（AC2「上次失败原因」，读 worker-outcome.jsonl）。
 *  无记录 / 读失败 ⇒ null（读不懂 ≠ 无失败——但续做 prompt 以 "(unknown)" 呈现，不伪装成「没有失败」）。 */
export function lastExitedNotLandedReason(root: string, taskId: string): string | null {
  let text: string;
  try {
    text = fs.readFileSync(path.join(root, WORKER_OUTCOME_REL), "utf8");
  } catch {
    return null;
  }
  let last: string | null = null;
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let rec: { task?: unknown; final_state?: unknown; failure_reason?: unknown };
    try {
      rec = JSON.parse(trimmed);
    } catch {
      continue;
    }
    if (rec.task === taskId && rec.final_state === "exited-not-landed") {
      last = typeof rec.failure_reason === "string" ? rec.failure_reason : null;
    }
  }
  return last;
}

/** 派发前搜集续做状态（AC1 复用 / AC2 状态）。⛔ 无 worktree（worktreePresentForTask 非 true）⇒ null
 *  （走创建 prompt）。worktree 读不懂（null）⇒ null（创建，与「确认无残留」同向——撞死由 git 自己报，
 *  比误判复用更安全；且读不懂时 `git worktree add` 同样会失败，属 git 不可用的同一次故障）。 */
export function continueStateForTask(root: string, taskId: string): ContinueWorkerState | null {
  if (worktreePresentForTask(root, taskId) !== true) return null;
  const paths = worktreePathsForTask(root, taskId);
  const ac = readAcCheckState(root, taskId);
  return {
    worktreePath: paths[0] ?? null,
    branchCommits: countBranchCommits(root, taskId),
    branchHeadSubject: branchHeadSubject(root, taskId),
    acChecked: ac.checked,
    acTotal: ac.total,
    failureReason: lastExitedNotLandedReason(root, taskId),
  };
}

/** 续做 prompt（AC1/AC2）：复用已有 worktree（⛔ 不 create，create 撞已存在对象 fatal），并携带前一轮
 *  状态（分支提交 / AC 勾选 / 失败原因）供 worker 从保留 worktree 继续。⛔ 不含 "create an isolated
 *  git worktree"（AC1 取假判据——旧 prompt 逐字说 create 是撞死根因）。 */
export function buildContinueWorkerPrompt(task: string, root: string, state: ContinueWorkerState): string {
  const wt = state.worktreePath ?? "(unknown path)";
  const commits = state.branchCommits == null ? "?" : String(state.branchCommits);
  const head = state.branchHeadSubject ? ` (head: "${state.branchHeadSubject}")` : "";
  const ac = state.acChecked == null || state.acTotal == null ? "?" : `${state.acChecked}/${state.acTotal}`;
  const reason = state.failureReason ?? "(unknown)";
  return [
    `You are a per-task worker in the quay repo (SPEC-worker-driven-inner §5 阶段 2).`,
    `Task: ${task}. Repo root: ${root}.`,
    `CONTINUE (reuse, ⛔ do NOT create): a worktree for ${task} already exists at ${wt}`,
    `on branch task/${task} from a prior exited-not-landed round — reuse it; do NOT run \`git worktree add\``,
    `(it would fail: the path/branch already exists). Prior round state: branch task/${task} already has`,
    `${commits} commits${head}; Acceptance Criteria currently checked ${ac};`,
    `the last round exited-not-landed because: ${reason}.`,
    `Run the remaining chain in the existing worktree: (1) continue implementing per the task's`,
    `Proposal/Plan/AC/DoD (⛔ do not redo the ${commits} commits already on the branch),`,
    `(2) run the suite, (3) ff-merge to develop via the fan-in-execute workflow`,
    `(scriptPath, args={task,worktree,root,runId,mergeTarget}; worktree=${wt}).`,
    `You own this worktree fully; apart from the final merge do not touch develop.`,
  ].join(" ");
}

/** 派发前选 prompt：保留 worktree 在 ⇒ 续做 prompt，无 ⇒ 创建 prompt。单一决策点——显式批量派发
 *  （runTask）与常驻选择环（spawnSelected）都经 workerArgvForTask 走到这里。 */
export function workerPromptForTask(task: string, root: string): string {
  const state = continueStateForTask(root, task);
  return state != null ? buildContinueWorkerPrompt(task, root, state) : buildWorkerPrompt(task, root);
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

/** 解析 --interval <ms>（常驻循环无在飞 worker 且瞬时 WAIT 时的轮询间隔）。缺省
 *  RESIDENT_INTERVAL_MS_DEFAULT；非法（非有限 / 负数）⇒ 缺省（⛔ 不因 flag 拼写炸常驻循环）。 */
export function parseIntervalMs(raw: string | undefined): number {
  if (raw == null) return RESIDENT_INTERVAL_MS_DEFAULT;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : RESIDENT_INTERVAL_MS_DEFAULT;
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

/** 因 halt 未派发的任务也落一条 outcome（final_state=not-dispatched，⛔ 不静默丢任务）。 */
export function computeHaltedOutcome({
  task,
  selectorReason,
  runId,
  nowMs,
  inFlightCount = 0,
}: {
  task: string;
  selectorReason: string;
  runId: string;
  nowMs: number;
  inFlightCount?: number;
}): ReturnType<typeof computeOutcome> {
  const iso = new Date(nowMs).toISOString();
  return {
    ts: iso,
    task,
    selector_reason: selectorReason,
    exit_code: null,
    signal: null,
    wall_clock_ms: 0,
    final_state: "not-dispatched",
    failure_reason: "dispatch halted (MCP halt) — no worker spawned; in-flight workers untouched",
    started_at: iso,
    ended_at: iso,
    worker_pid: null,
    run_id: runId,
    in_flight_count: inFlightCount,
    timed_out: false,
  };
}

/** 纯函数：解析多任务输入 → { tasks, selectorReason, runPrefix, workerCmdOpts } 或 { error }。 */
export function resolveRun({
  tasks,
  reason,
  workerCmd,
  workerCmdExact,
  root,
  runId,
  nowMs,
}: {
  tasks: string[];
  reason: string | undefined;
  workerCmd: string | undefined;
  workerCmdExact: string | undefined;
  root: string;
  runId: string | undefined;
  nowMs: number;
}) {
  const taskIds = (tasks ?? []).map((t) => t.trim()).filter(Boolean);
  if (taskIds.length === 0) {
    return { error: "no --task given in explicit mode (pass --task <id> [--task <id> …]; omit --task to run the resident selection loop)" };
  }
  const selectorReason = (reason && reason.trim()) || "explicit --task selection";
  const prefix = workerCmd != null ? workerCmd.trim() : null;      // --worker-cmd（前缀，prompt 追加）
  const exact = workerCmdExact != null ? workerCmdExact.trim() : null; // --worker-cmd-exact（整体替换，测试专用）
  if ((prefix !== null && splitArgs(prefix).length === 0) || (exact !== null && splitArgs(exact).length === 0)) {
    return { error: "empty worker command" };
  }
  return { taskIds, selectorReason, runPrefix: runId || `fm-${nowMs}`, workerCmdOpts: { prefix, exact } };
}

// ── worker 单例运行（含超时） ─────────────────────────────────────────────────────────────────────

export interface WorkerRunResult {
  taskId: string;
  outcome: ReturnType<typeof computeOutcome>;
  exitCode: number;
}

/** 原子追加 worker pid 到 pid-file（观测抓手）：读-改-写 tmp 再 rename，外部读者绝不读到半截/空文件。
 *  非原子的 appendFileSync 会在 open(O_CREAT) 与 write 之间暴露【空文件窗口】——全量 suite 高并发下
 *  外部轮询（worker-driver.test.mjs halt-mid 用例）读到 existsSync=true 但内容为空 ⇒ Number("")=0
 *  误判「未写 pid」假红（gap-ac140 回归）。本进程内全同步调用 ⇒ 无并发交错，rename 保证原子可见。 */
function appendWorkerPid(pidFile: string, workerPid: number): void {
  try {
    const file = path.resolve(pidFile);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const existing = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
    const tmp = `${file}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    fs.writeFileSync(tmp, existing + `${workerPid}\n`, "utf8");
    fs.renameSync(tmp, file);
  } catch {
    /* pid-file 是观测抓手，写失败不改变主流程 */
  }
}

/**
 * spawn 一个 worker 并等待其终态（含超时 SIGTERM）。超时 ⇒ kill("SIGTERM")，close 事件带 signal=SIGTERM，
 * timedOut 标记落 outcome final_state=timed-out。异常死亡终态（failed/killed/timed-out——worker 没跑完、
 * 无完成实现）清理 orphan worktree（gap-worker-driver-no-record-on-abnormal-death AC2）；⛔
 * exited-not-landed（exit 0 但没落地，含 needs-human 闸拒绝）保留分支/worktree 供续做
 * （gap-worker-needs-human-destroys-branch-worktree AC1）。
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
      // gap-worker-driver-fake-completion-exit-0：写终态前读一次任务侧直接量（status=done ∧ 无残留
      // worktree）。只在 exit 0 路径有意义——spawn-failed/killed/timed-out/failed 分支在 computeOutcome
      // 里优先于 landed，落盘 result 由终态分支决定；但统一读一次无害（落地读是廉价 fs/git 调用）。
      const landing = computeLandingState(rootDir, taskId);
      const outcome = computeOutcome({
        task: taskId, selectorReason, exitCode: code, signal,
        startedAtMs, endedAtMs, workerPid, runId,
        spawnError: spawnErr, inFlightCount, timedOut,
        landed: landing.landed, landReason: landing.reason,
      });
      // gap-worker-driver-no-record-on-abnormal-death（AC2，能取假）：worker 异常死亡（failed/killed/
      // timed-out——worker 没跑完、无完成实现）后，orphan worktree 永久残留会挡 driver 下轮对同一 task 的
      // `git worktree add`。写终态的同时清理（⛔ completed/spawn-failed/not-dispatched 无 worktree 可清；
      // spawn-failed 连 worker 都没起，not-dispatched 连派发都没派）。⛔ exited-not-landed 同样不清理
      // ——那是 exit 0 跑到 fan-in 底但没落地（needs-human 闸拒绝 = 套件绿 + 实现完成，工作有效），
      // 分支/worktree 保留供续做，销毁会让完成实现永久丢失（gap-worker-needs-human-destroys-branch-
      // worktree AC1）。清理结果落进 outcome（worktree_cleaned / worktree_cleanup_error）供生产观测。
      const shouldCleanup =
        outcome.final_state !== "completed" &&
        outcome.final_state !== "exited-not-landed" &&
        outcome.final_state !== "spawn-failed" &&
        outcome.final_state !== "not-dispatched";
      const cleanup = shouldCleanup ? cleanupOrphanWorktree(rootDir, taskId) : null;
      const finalOutcome = cleanup
        ? {
            ...outcome,
            worktree_cleaned: cleanup.removed,
            worktree_cleanup_error: cleanup.error,
            worktree_cleanup_skipped_live: cleanup.skippedLiveWorker,
          }
        : outcome;
      appendOutcomeToFile(outcomeFile, finalOutcome);
      if (json) process.stdout.write(`${JSON.stringify({ event: "worker-done", task: taskId, ...finalOutcome })}\n`);
      let exitCode: number;
      if (finalOutcome.final_state === "completed") exitCode = 0;
      else if (finalOutcome.final_state === "timed-out") exitCode = 128 + signalExitCode(signal ?? "SIGTERM");
      else if (finalOutcome.final_state === "killed") exitCode = 128 + (signal ? signalExitCode(signal) : 0);
      else if (finalOutcome.final_state === "spawn-failed") exitCode = 2;
      else if (finalOutcome.final_state === "exited-not-landed") exitCode = EXITED_NOT_LANDED_EXIT;
      else exitCode = code ?? 2;
      resolve({ taskId, outcome: finalOutcome, exitCode });
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
      appendWorkerPid(pidFile, workerPid);
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

// ── 阶段 4（AC129）常驻驱动 + 自主选任务：选择环 / selector worker / 判停 ───────────────────────────

/** Fisher–Yates 打散（AC2：候选顺序打散后交 selector，避免 selector 每次看到同一顺序）。返回新数组，
 *  不改动入参。 */
export function shuffle<T>(arr: readonly T[]): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * 派发前 Touches 互斥过滤（gap-launch-script-worker-cap-broken AC3）：cap=5 后池里可能同时有 2 条
 * `## Touches` 重叠的 ready 任务，若并发派发会各改同一文件、fan-in 才炸（两边都 exit 0 看起来都做完了，
 * 比 fake-completion 更难查）。本函数把候选里与【在飞任务】Touches 重叠的过滤掉——selector 只在滤后集合里
 * 选（⛔ 不指望 LLM selector 避开，它拿不到 Touches）。checkTouchesPair / parseTouches 是 ready-pool-check
 * 的同函数（不重实现）；读不懂（任务文件缺失/读失败）⇒ 视为无 Touches ⇒ checkTouchesPair 判 serialize ⇒
 * 滤掉（与 checkTouchesPair 的保守缺省同向，⛔ 不因读不懂放行冲突）。无在飞任务 ⇒ 无冲突对象 ⇒ 全通过。
 */
export function filterTouchesDisjoint(
  candidateIds: string[],
  inFlightIds: string[],
  rootDir: string,
): string[] {
  if (inFlightIds.length === 0) return candidateIds.slice();
  const expand = (globs: string[]) => expandDeclaredTouches(globs, rootDir);
  const readTouches = (id: string) => {
    const file = path.join(rootDir, "tasks", `${id}.md`);
    let raw: string;
    try {
      raw = fs.readFileSync(file, "utf8");
    } catch {
      return { hasSection: false, globs: [] as string[] };
    }
    return parseTouches(parseTask(raw).body);
  };
  const inFlight = inFlightIds.map(readTouches);
  return candidateIds.filter((id) => {
    const cand = readTouches(id);
    return inFlight.every((ifp) => checkTouchesPair(cand, ifp, expand).disjoint);
  });
}

/** 缺省 ready-pool-check 命令（选择环的第一步）。输出须为 analyzeTasks JSON（读其 `ready` 数组）。 */
export function defaultReadyPoolArgv(root: string, inFlight: string[], cap: number): string[] {
  const argv = [
    "node", "--experimental-strip-types", path.join(root, "plugin", "scripts", "ready-pool-check.ts"),
    "--root", root, "--cap", String(cap), "--json",
  ];
  if (inFlight.length > 0) argv.push("--in-flight", inFlight.join(","));
  return argv;
}

/** 调 ready-pool-check 取可行集（AC2 第一步）。cmd 覆盖是测试缝；缺省 = 本仓库 ready-pool-check.ts。
 *  解析失败/非零退出 ⇒ fail-closed 返回空池（硬规则 3b：读不懂 ≠ 「有候选」，⛔ 不得伪装成有货）。 */
export function readyPoolCheck(
  root: string,
  cmd: string[] | null,
  inFlight: string[],
  cap: number,
): { ready: string[]; pool: number; criterionMet: boolean; error: string | null } {
  const argv = cmd ?? defaultReadyPoolArgv(root, inFlight, cap);
  let r: ReturnType<typeof spawnSync>;
  try {
    r = spawnSync(argv[0], argv.slice(1), {
      encoding: "utf8", timeout: 120_000, maxBuffer: 64 * 1024 * 1024, stdio: ["ignore", "pipe", "ignore"],
    });
  } catch (e) {
    const msg = e && typeof e === "object" && "message" in e ? String(e.message) : String(e);
    return { ready: [], pool: 0, criterionMet: false, error: `ready-pool-check spawn failed (${msg})` };
  }
  if (r.error || r.status !== 0) {
    const msg = r.error ? String(r.error.message || r.error) : `ready-pool-check exited ${r.status}`;
    return { ready: [], pool: 0, criterionMet: false, error: msg };
  }
  try {
    const j = JSON.parse(String(r.stdout ?? "").trim());
    const ready = Array.isArray(j.ready) ? j.ready.filter((x: unknown) => typeof x === "string") : [];
    return {
      ready,
      pool: typeof j.pool === "number" ? j.pool : ready.length,
      criterionMet: !!j.criterion_met,
      error: null,
    };
  } catch {
    return { ready: [], pool: 0, criterionMet: false, error: "unparseable ready-pool-check output" };
  }
}

/** 缺省 selector worker 命令（短命 LLM——SPEC §1 设计点1「选择仍应是语义的」）。prompt 内联打散后的
 *  候选 id 列表，要求输出一行 `<task-id> <一句理由>`。launcher/model/--bare 由
 *  `_launchSpec.roles["selector"]` 承载（AC140-2 可配）。 */
export function defaultSelectorArgv(candidateIds: string[], root: string): string[] {
  const prompt = [
    `You are the resident task selector for the quay worker driver (SPEC §5 阶段 4 — AC129).`,
    `Candidate task ids (ready pool, in-flight subtracted, order shuffled): ${candidateIds.join(", ")}.`,
    `Before choosing, read orchestration/dispatch-preference.md — its 覆盖段 carries the current priority (manager-maintained). Honor it unless a candidate is structurally ineligible (Touches conflict / unmet deps). If no candidate matches the override priority, fall back to your own semantic judgment.`,
    `Pick exactly ONE task to dispatch next and reply with a single line: <task-id> <one-line reason>`,
    `and nothing else. Repo root: ${root}.`,
  ].join(" ");
  return launchArgv("selector", prompt, root);
}

/** 解析 selector worker 输出：第一行 `<task-id> <一句理由>`。task-id 须在候选集内（⛔ 不得放行一个
 *  未提交给它的任务）；无效输出 ⇒ fail-closed 回退打散后首个候选（循环永不因 selector 而 deadlock）。
 *  AC142 AC1：stderr 可选传入，兜底 reason 带上 stderr 截断（selector spawn 失败/认证失败可诊断）。 */
export function parseSelectorOutput(
  stdout: string,
  candidates: string[],
  exitCode: number | null,
  stderr: string | null = null,
): { task: string; reason: string } | null {
  const line = String(stdout ?? "").trim().split("\n")[0]?.trim() ?? "";
  const m = line.match(/^\s*(\S+)(?:\s+(.*))?$/);
  const task = m ? m[1] : null;
  const reason = m && m[2] ? m[2].trim() : "";
  if (task && candidates.includes(task)) {
    return { task, reason: reason || `selector picked ${task}` };
  }
  const fallback = candidates[0];
  if (!fallback) return null;
  const got = line ? `, got "${line.slice(0, 80)}"` : "";
  const errFrag = stderr ? `, stderr="${stderr.slice(0, 200)}"` : "";
  return {
    task: fallback,
    reason: `selector worker returned no valid pick (exit ${exitCode ?? "null"}${got}${errFrag}); fallback to first shuffled candidate`,
  };
}

/** 交短命 selector worker（AC2 末步）：spawn 覆盖命令（或 claude -p）→ 解析输出。永不 throw。
 *  AC142 AC1：捕获 stderr（连同 stdout + timeout 落进可查载体 selector_reason）。 */
export function runSelectorWorker(
  candidates: string[],
  fixedArgv: string[] | null,
  root: string,
): { task: string; reason: string } | null {
  if (candidates.length === 0) return null;
  const argv = fixedArgv ?? defaultSelectorArgv(candidates, root);
  let stdout = "";
  let stderr = "";
  let exitCode: number | null = null;
  try {
    const r = spawnSync(argv[0], argv.slice(1), {
      encoding: "utf8", timeout: 120_000, maxBuffer: 16 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"],
    });
    stdout = String(r.stdout ?? "");
    stderr = String(r.stderr ?? "").trim();
    exitCode = r.error ? null : r.status;
  } catch {
    exitCode = null;
  }
  return parseSelectorOutput(stdout, candidates, exitCode, stderr || null);
}

/** 常驻循环里一条在飞 worker 的追踪态（done 由 `.then` 置位，reap 据此移除）。 */
interface RunningWorker {
  task: string;
  done: boolean;
  promise: Promise<WorkerRunResult>;
}

/** 常驻循环的选项（`main` 无 --task 分支装配后传入）。 */
export interface ResidentOptions {
  rootDir: string;
  cap: number;
  timeoutMs: number;
  workerCmdOpts: WorkerCmdOptions;
  selectorArgv: string[] | null;
  readyPoolArgv: string[] | null;
  resourceGateArgv: string[] | null;
  outcomeFile: string;
  runId: string | undefined;
  runPrefix: string;
  json: boolean;
  pidFile?: string;
  /** liveness 检查命令覆盖（测试缝）；null = 用 defaultLivenessCheckArgv(rootDir, "worker")。 */
  livenessCmd: string[] | null;
  /** 无在飞 worker 且瞬时 WAIT 时的轮询间隔（ms）；缺省 RESIDENT_INTERVAL_MS_DEFAULT。测试缝传小值。 */
  intervalMs: number;
}

/**
 * 常驻选择环（AC1 常驻 + AC2 自主选任务 + AC3 判停）。
 *   循环：reap 已完成的 worker → 池非空且未达 cap 且未判停 ⇒ 走选择环（ready-pool-check → 减在飞集 →
 *   打散 → selector worker）→ spawn → 等一个结束 → 再 reap。判停分两态
 *   （gap-worker-driver-stopreason-latch-permanent-stop，⛔ stopReason 一旦赋值永不复位 = 瞬时拒被永久 latch）：
 *     - 终态（mcp-halt，人 halt 且明示终止）⇒ latch stopReason：停止起新 worker，在飞全部跑完才退出；
 *     - 瞬时 WAIT（resource-gate-wait / pool-empty / Touches-deps 过滤）⇒ ⛔ 不 latch：本轮不派、
 *       下一轮重读 stopCondition；无在飞 worker 时等 intervalMs 重读，⛔ 不退出（退出 = 把恢复外包给
 *       supervisor 重启）。退出码 = 首个非零 worker 码（仅在终态 latch 后返回）。
 */
export async function runResidentLoop(opts: ResidentOptions): Promise<number> {
  const { rootDir, cap, timeoutMs, workerCmdOpts, selectorArgv, readyPoolArgv, resourceGateArgv, outcomeFile, runId, runPrefix, json, pidFile, livenessCmd, intervalMs } = opts;

  // checkout 前 stash（阶段 2 ③）：主检出脏 ⇒ stash 一次（常驻循环起跑前），⛔ 不 discard。非 git no-op。
  const stash = stashIfDirty(rootDir);
  if (json) {
    process.stdout.write(`${JSON.stringify({ event: "stash", stashed: stash.stashed, files: stash.files, error: stash.error })}\n`);
  }

  const running: RunningWorker[] = [];
  const results: WorkerRunResult[] = [];
  let stopReason: string | null = null;

  // gap-worker-driver-cold-start-inflight-blind：冷启动在飞排除集。restart / supervisor 崩溃自动
  // respawn 后，新驱动的 running 是纯内存数组、从空集起——不认得重启前就存活的 worker。枚举真实
  // 存活的 task worktree + 交叉核对存活 quay-task-worker 进程，把「worktree 在 ∧ 存活 worker 在」的
  // task 预先纳入排除集，使本驱动不再对它们重复派发（重复派发撞同一 worktree，被杀后还会误删原
  // worker 仍在用的共享 worktree）。计算一次（冷启动）；存活 worker 落地 fan-in 后其 worktree 消失，
  // 本驱动对其整个寿命内都不再派发（安全方向）。这些 task 不占内存 running（无 promise 可 await），
  // 但作为「已在飞」参与 ready-pool 减项 / active 过滤 / Touches 互斥，⛔ 不阻塞其它 task 的派发。
  const coldInflight = enumerateColdStartInflight(rootDir);
  const inFlightTasks = (): string[] => running.map((r) => r.task).concat([...coldInflight]);
  if (json && coldInflight.size > 0) {
    process.stdout.write(
      `${JSON.stringify({ event: "cold-start-inflight", tasks: [...coldInflight].sort() })}\n`,
    );
  }

  // round 心跳（AC138-3）：worker-outcome 只在任务真完成时写，池空时 outcome 停更会被 supervisor
  // status 的 last_record_ts（读全载体 max）误读为「死亡」；round 每轮循环无条件写一条作 liveness 直接量。
  const roundFile = path.join(rootDir, WORKER_ROUND_REL);
  const writeRound = (round: number, inFlight: number, pool: number | null, reason: string | null, liveness: LivenessResult | null): void => {
    const record = computeWorkerRoundRecord({
      round,
      runId: runId ?? runPrefix,
      pid: process.pid,
      at: new Date().toISOString(),
      action: reason != null ? "stop" : inFlight > 0 ? "dispatch" : "idle",
      inFlight,
      pool,
      stopReason: reason,
      liveness,
    });
    try { appendRoundToFile(roundFile, record); } catch { /* 记录写失败不致命（运行时日志，⛔ 不因日志炸循环） */ }
    if (json) process.stdout.write(`${JSON.stringify({ event: "round", ...record })}\n`);
  };

  /** 判停（AC3）：起新 worker 前逐轮读。halt 优先（终态，latch）；其次 resource-gate WAIT（瞬时，
   *  ⛔ 不 latch——gap-worker-driver-stopreason-latch-permanent-stop：WAIT 名字含 WAIT，负载高恰因在飞
   *  worker 在跑、worker 结束负载降但闸再没被读 = 自我锁死反馈环）。瞬时 WAIT 只让本轮不派、
   *  下一轮重读 stopCondition。 */
  const stopCondition = (): { stop: boolean; reason: string | null; terminal: boolean } => {
    if (isHalted(rootDir)) {
      return { stop: true, reason: "mcp-halt (control state halted — no new dispatch; in-flight workers untouched)", terminal: true };
    }
    const rg = resourceGateCheck(rootDir, resourceGateArgv);
    if (!rg.go) return { stop: true, reason: `resource-gate-wait: ${rg.reason}`, terminal: false };
    return { stop: false, reason: null, terminal: false };
  };

  /** spawn 一个选中的 worker，并把 selector 的真实理由带进 outcome（AC2）。 */
  const spawnSelected = (sel: { task: string; reason: string }): void => {
    const runIdForTask = runId ?? `${runPrefix}-${sel.task}`;
    const rw = {} as RunningWorker;
    rw.task = sel.task;
    rw.done = false;
    rw.promise = runOneWorker({
      taskId: sel.task,
      selectorReason: sel.reason,
      runId: runIdForTask,
      workerArgv: workerArgvForTask(sel.task, rootDir, workerCmdOpts),
      rootDir,
      outcomeFile,
      timeoutMs,
      inFlightCount: running.length + 1,
      json,
      pidFile,
    }).then((r) => {
      rw.done = true;
      results.push(r);
      return r;
    });
    running.push(rw);
    if (json) {
      process.stdout.write(
        `${JSON.stringify({ event: "selector-picked", task: sel.task, selector_reason: sel.reason, in_flight_count: running.length, run_id: runIdForTask })}\n`,
      );
    }
  };

  // 无在飞 worker 且瞬时 WAIT 时的轮询（gap-worker-driver-stopreason-latch-permanent-stop）：等
  // intervalMs 后重读闸/池，⛔ 不退出（退出 = 把恢复外包给 supervisor 重启，正是 1h48m 停摆的根）。
  // plain setTimeout——驱动不注册 SIGTERM 处理器（默认终止），supervisor 的 stop 仍能即时杀掉驱动。
  const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

  let round = 0;
  while (true) {
    round += 1;

    // liveness 检查（gap-resident-driver-stable-carrier-liveness Finding 的接线）：每轮顺手调一次
    // launch 脚本的 liveness 子命令。supervisor 死后 driver 成孤儿仍在跑 ⇒ 下一轮即检出 supervisor_dead
    // 并让子命令写 DEATH 告警（⛔ 载体停更 ≠ 一切正常）。checked=false（脚本缺失/失败）≠ 健康（硬规则 3b）。
    const liveness = runLivenessCheck(rootDir, "worker", livenessCmd);

    // 1. reap 已完成的 worker（减在飞集）。
    for (let i = running.length - 1; i >= 0; i--) {
      if (running[i].done) running.splice(i, 1);
    }

    // 2. 池非空且未达 cap 且未判停 ⇒ 走选择环起下一个。
    //    ⛔ stopReason 是【终态 latch】（仅 mcp-halt）；瞬时闸拒绝只记本轮 waitReason，下一轮重读
    //    stopCondition（gap-worker-driver-stopreason-latch-permanent-stop：stopReason 一旦赋值永不复位 ⇒
    //    瞬时拒被永久 latch ⇒ 1h48m 零派发）。
    let poolSeen: number | null = null;
    let waitReason: string | null = null;
    while (running.length < cap && !stopReason) {
      const sc = stopCondition();
      if (sc.stop) {
        if (sc.terminal) stopReason = sc.reason;
        else waitReason = sc.reason;
        break;
      }
      const pool = readyPoolCheck(rootDir, readyPoolArgv, inFlightTasks(), cap);
      poolSeen = pool.pool;
      const active = new Set(inFlightTasks());
      const shuffled = shuffle(pool.ready.filter((id) => !active.has(id)));
      // AC3（gap-launch-script-worker-cap-broken）：派发前 Touches 互斥——候选里与在飞任务 Touches 重叠的
      // 先滤掉，selector 只在滤后集合里选（⛔ 并发派发 Touches 重叠 = fan-in 才炸）。冷启动在飞 task
      // 一并参与（它们的 Touches 是真实冲突面，⛔ 不是只从 ready 里减去）。
      const touchesFiltered = filterTouchesDisjoint(shuffled, inFlightTasks(), rootDir);
      // gap-worker-driver-dispatch-pre-filter-missing AC1：派发前二次过滤 depends_on——依赖未满
      // （depends_on 含未 done 任务）的候选不进候选集（⛔ 照单派发 ⇒ ac138 白烧一轮复现）。与
      // gap-launch-script-worker-cap-broken AC3 的 Touches 互斥过滤同属「spawn 前候选过滤」的两个维度，一并判。
      const candidates = touchesFiltered.filter((id) => depsReadyForDispatch(rootDir, id));
      if (candidates.length === 0) {
        // 真池空（ready 减在飞后无候选）⇒ 瞬时 WAIT：记 pool-empty，下一轮重读（⛔ 不再 latch）。
        //   池非空但全与在飞 Touches/deps 重叠 ⇒ 同为瞬时 WAIT：不设 stopReason（在飞 worker 结束释放
        //   Touches 或依赖由别的任务落地后重进选择环重新 filter）。两者都不退出——等 intervalMs 重读。
        if (shuffled.length === 0) waitReason = "pool-empty (no dispatchable candidate in the ready pool)";
        break;
      }
      const sel = runSelectorWorker(candidates, selectorArgv, rootDir);
      if (!sel) {
        // 候选非空但 selector 未能给出任何选择（理论上 parseSelectorOutput 必回退首个，不会 null）。
        waitReason = "pool-empty (selector returned no candidate)";
        break;
      }
      spawnSelected(sel);
    }

    // AC138-3 无条件心跳：每轮循环写一条（⛔ 池空/判停轮也写——outcome 在这些轮不写）。
    //   终态 stopReason 与瞬时 waitReason 都记 action=stop（观测面保留 stop_reason 读数，AC2）。
    writeRound(round, running.length, poolSeen, stopReason ?? waitReason, liveness);

    // 3. 无在飞 ⇒ 终态 halt（stopReason latch）才退出；瞬时 WAIT（池可能再补 / 闸可能已放行）⇒
    //    等 intervalMs 重读，⛔ 不退出（gap-worker-driver-stopreason-latch-permanent-stop AC3）。
    if (running.length === 0) {
      if (stopReason) break;
      await sleep(intervalMs);
      continue;
    }

    // 4. 等在飞 worker 结束（至少一个），再回环 reap + 补位。⛔ 从不主动杀在飞。
    await Promise.race(running.map((r) => r.promise));
  }

  if (json && stopReason) {
    process.stdout.write(`${JSON.stringify({ event: "resident-stop", reason: stopReason })}\n`);
  }
  const bad = results.find((r) => r && r.exitCode !== 0);
  return bad ? bad.exitCode : 0;
}

// ── CLI 主流程 ─────────────────────────────────────────────────────────────────────────────────────

export async function main(argv: string[]): Promise<number> {
  const args = argv.slice(2);
  let root: string | undefined;
  const tasks: string[] = [];
  let reason: string | undefined;
  let workerCmd: string | undefined;
  let workerCmdExact: string | undefined;
  let selectorCmd: string | undefined;
  let readyPoolCmd: string | undefined;
  let resourceGateCmd: string | undefined;
  let livenessCmd: string | undefined;
  let concurrency: number | undefined;
  let timeoutRaw: string | undefined;
  let intervalRaw: string | undefined;
  let pidFile: string | undefined;
  let outcomePath: string | undefined;
  let runId: string | undefined;
  let json = false;
  let serve = false;
  let host: string | undefined;
  let port: number | undefined;

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--root") root = args[++i];
    else if (a === "--task") tasks.push(args[++i]);
    else if (a === "--reason") reason = args[++i];
    else if (a === "--worker-cmd") workerCmd = args[++i];
    else if (a === "--worker-cmd-exact") workerCmdExact = args[++i];
    else if (a === "--selector-cmd") selectorCmd = args[++i];
    else if (a === "--ready-pool-cmd") readyPoolCmd = args[++i];
    else if (a === "--resource-gate-cmd") resourceGateCmd = args[++i];
    else if (a === "--liveness-cmd") livenessCmd = args[++i];
    else if (a === "--concurrency") concurrency = Number(args[++i]);
    else if (a === "--timeout") timeoutRaw = args[++i];
    else if (a === "--interval") intervalRaw = args[++i];
    else if (a === "--pid-file") pidFile = args[++i];
    else if (a === "--outcome") outcomePath = args[++i];
    else if (a === "--run-id") runId = args[++i];
    else if (a === "--json") json = true;
    else if (a === "--serve") serve = true;
    else if (a === "--host") host = args[++i];
    else if (a === "--port") port = Number(args[++i]);
    else if (a === "--help" || a === "-h") {
      console.log(
        "worker-driver — SPEC §5 阶段 2+3+4：spawn 多 worker（并发 N + 超时 SIGTERM + checkout 前 stash + MCP 控制面 + 常驻选择环）\n" +
          "  --task <id> [--task <id> …] [--reason \"<一句为什么选它>\"] [--concurrency <N>] [--timeout <ms>]\n" +
          "  [--root <repo>] [--worker-cmd \"<前缀>\"] [--worker-cmd-exact \"<argv>\"] [--pid-file <p>] [--outcome <p>] [--run-id <id>] [--json]\n" +
          "  ⛔ 无 --task ⇒ 常驻选择环（不再报错退出）\n" +
          "  [--selector-cmd \"<argv>\"] [--ready-pool-cmd \"<argv>\"] [--resource-gate-cmd \"<argv>\"] [--liveness-cmd \"<argv>\"]\n" +
          "  [--interval <ms>]   无在飞 worker 且瞬时 WAIT 时的轮询间隔（缺省 30000；测试缝传小值）\n" +
          "  --serve [--host <ip>] [--port <n>]  起 MCP 控制面（halt / setPreference / forceDispatch，身份 header 或 caller 参数）",
      );
      return 0;
    } else {
      console.error(`worker-driver: unknown argument: ${a}`);
      return 2;
    }
  }

  const rootDir = root ? path.resolve(root) : path.resolve(process.cwd());

  // --serve：起 MCP 控制面（常驻）。listening socket 保持事件循环存活 ⇒ 进程不退出，直到 SIGINT/SIGTERM。
  if (serve) {
    const handle = await serveControlPlane({ root: rootDir, host, port, name: "worker-driver-control" });
    if (json) process.stdout.write(`${JSON.stringify({ event: "control-plane-serving", url: handle.url, port: handle.port })}\n`);
    else console.log(`worker-driver control plane serving at ${handle.url}`);
    const stop = () => { void handle.close(); };
    process.on("SIGINT", stop);
    process.on("SIGTERM", stop);
    return 0;
  }

  const outcomeFile = outcomePath ? path.resolve(outcomePath) : path.join(rootDir, WORKER_OUTCOME_REL);
  const timeoutMs = parseTimeoutMs(timeoutRaw);
  const intervalMs = parseIntervalMs(intervalRaw);

  // 阶段 4（AC129）：无 --task ⇒ 常驻选择环（不再报错退出）。--task 显式批量派发路径不变。
  if (tasks.length === 0) {
    const cap = resolveConcurrency(concurrency, 0);
    return runResidentLoop({
      rootDir,
      cap,
      timeoutMs,
      workerCmdOpts: { prefix: workerCmd ?? null, exact: workerCmdExact ?? null },
      selectorArgv: selectorCmd ? splitArgs(selectorCmd) : null,
      readyPoolArgv: readyPoolCmd ? splitArgs(readyPoolCmd) : null,
      resourceGateArgv: resourceGateCmd ? splitArgs(resourceGateCmd) : null,
      outcomeFile,
      runId,
      runPrefix: runId || `fm-${Date.now()}`,
      json,
      pidFile,
      livenessCmd: livenessCmd ? splitArgs(livenessCmd) : null,
      intervalMs,
    });
  }

  const resolved = resolveRun({ tasks, reason, workerCmd, workerCmdExact, root: rootDir, runId, nowMs: Date.now() });
  if (resolved.error) {
    console.error(`worker-driver: ${resolved.error}`);
    return 2;
  }
  const { taskIds, selectorReason, runPrefix, workerCmdOpts } = resolved;
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
    const runIdForTask = runId ?? `${runPrefix}-${taskId}`;
    // 阶段 3 halt 闸（AC1）：spawn 前逐任务读控制态；halted ⇒ 记 not-dispatched 并跳过，
    // ⛔ 不杀在飞（已 spawn 的 worker 完全不受影响——闸只在【新】spawn 前生效）。
    if (isHalted(rootDir)) {
      const haltedOutcome = computeHaltedOutcome({
        task: taskId, selectorReason, runId: runIdForTask, nowMs: Date.now(), inFlightCount: inFlight,
      });
      appendOutcomeToFile(outcomeFile, haltedOutcome);
      if (json) process.stdout.write(`${JSON.stringify({ event: "worker-skipped", task: taskId, ...haltedOutcome })}\n`);
      results[idx] = { taskId, outcome: haltedOutcome, exitCode: 0 };
      return;
    }
    inFlight += 1;
    const argv = workerArgvForTask(taskId, rootDir, workerCmdOpts);
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
