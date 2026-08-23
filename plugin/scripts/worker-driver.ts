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
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { spawn, spawnSync } from "node:child_process";
import { isDirectEntry, readFrontmatter } from "./gate-script-base.ts";

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

/** 控制态文件的仓库相对路径（gitignored 运行时状态，worker-outcome.jsonl 同族）。单一真相源。 */
export const CONTROL_STATE_REL = ".quay/worker-control.json";

/** known-callers 定义点（读 QUAY_CONTROL_CALLERS，逗号分隔；缺省 outer,manager）。 */
export const CONTROL_CALLERS_ENV = "QUAY_CONTROL_CALLERS";

/** 缺省 known-callers（SPEC §5 阶段 3：调用方是 outer 或 manager；身份可核 = 成员在此集合内）。 */
export const DEFAULT_CALLERS = ["outer", "manager"] as const;

/** 身份 header 的【小写】键（HTTP header 名大小写不敏感，Node 统一小写）。 */
export const CONTROL_HEADER = "mcp-caller-id";

/** 身份 header 的展示名（文档/错误消息用）。 */
export const CONTROL_HEADER_NAME = "Mcp-Caller-Id";

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

/** 缺省 worker prompt（单一真相源：worker 的 full-chain prompt 内容只在此一处）。 */
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
  const prompt = buildWorkerPrompt(task, root);
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
  return launchArgv("task-worker", buildWorkerPrompt(task, root), root);
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

// ── 阶段 3（AC117）MCP 控制面：控制态 + 身份 + halt 派发闸 ──────────────────────────────────────────

/** 一条强制派发记录（forceDispatch 落盘，驻留驱动的 selector 环消费）。 */
export interface ForcedDispatch {
  task: string;
  reason: string | null;
  caller: string;
  at: string;
}

/** 控制态（单一真相源）。halted = 停止【新】派发（不杀在飞）；preference = selector 倾向存储。 */
export interface ControlState {
  schemaVersion: 1;
  halted: boolean;
  halted_by: string | null;
  halted_at: string | null;
  preference: Record<string, string>;
  forced: ForcedDispatch[];
}

export function defaultControlState(): ControlState {
  return { schemaVersion: 1, halted: false, halted_by: null, halted_at: null, preference: {}, forced: [] };
}

/** 把任意解析结果合并为 ControlState（缺失字段取缺省，不信任输入形状）。 */
export function mergeControlState(parsed: unknown): ControlState {
  const d = defaultControlState();
  if (!parsed || typeof parsed !== "object") return d;
  const p = parsed as Record<string, unknown>;
  return {
    schemaVersion: 1,
    halted: typeof p.halted === "boolean" ? p.halted : d.halted,
    halted_by: typeof p.halted_by === "string" ? p.halted_by : null,
    halted_at: typeof p.halted_at === "string" ? p.halted_at : null,
    preference:
      p.preference && typeof p.preference === "object" && !Array.isArray(p.preference)
        ? { ...(p.preference as Record<string, string>) }
        : {},
    forced: Array.isArray(p.forced)
      ? (p.forced as unknown[]).filter((f): f is ForcedDispatch => !!f && typeof f === "object")
      : [],
  };
}

/**
 * 读控制态（单一真相源）。缺失 ⇒ 缺省（未 halt）；任何【读失败/解析失败】⇒ fail-closed（halted=true，
 * 硬规则 3b：读不懂 ≠ 合格，绝不伪装成「未 halt」）。返回 { state, parseError }。
 */
export function readControlState(
  root: string,
  env: NodeJS.ProcessEnv = process.env,
): { state: ControlState; parseError: string | null } {
  const file = path.join(root, CONTROL_STATE_REL);
  let text: string;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch (e) {
    const code = e && typeof e === "object" && "code" in e ? (e as { code?: string }).code : undefined;
    if (code === "ENOENT") return { state: defaultControlState(), parseError: null };
    return { state: { ...defaultControlState(), halted: true }, parseError: `could not read control state at ${file}` };
  }
  try {
    return { state: mergeControlState(JSON.parse(text)), parseError: null };
  } catch {
    return { state: { ...defaultControlState(), halted: true }, parseError: `unparseable control state at ${file}` };
  }
}

/** 写控制态（原子：写 .tmp 再 rename，避免派发环读到半截）。返回落盘路径。 */
export function writeControlState(root: string, state: ControlState): string {
  const file = path.join(root, CONTROL_STATE_REL);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2) + "\n", "utf8");
  fs.renameSync(tmp, file);
  return file;
}

/** halt 闸（AC1）：派发环在 spawn 前读它。halted=true ⇒ 停止【新】派发（不杀在飞）。fail-closed。 */
export function isHalted(root: string, env: NodeJS.ProcessEnv = process.env): boolean {
  return readControlState(root, env).state.halted;
}

/** halt 操作（AC1 语义）：只翻 halted/halted_by/halted_at，不触碰任何在飞 worker。 */
export function applyHalt(
  state: ControlState,
  caller: string,
  halted = true,
  nowIso = new Date().toISOString(),
): ControlState {
  return { ...state, halted, halted_by: halted ? caller : null, halted_at: halted ? nowIso : null };
}

/** setPreference 操作：写 preference[k]=v（selector 的倾向存储）。 */
export function applyPreference(state: ControlState, key: string, value: string): ControlState {
  return { ...state, preference: { ...state.preference, [key]: value } };
}

/** forceDispatch 操作：append 一条强制派发记录（驻留驱动的 selector 环消费）。 */
export function applyForceDispatch(
  state: ControlState,
  task: string,
  reason: string | null,
  caller: string,
  nowIso = new Date().toISOString(),
): ControlState {
  return { ...state, forced: [...state.forced, { task, reason, caller, at: nowIso }] };
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

// ── 身份（AC2/AC3）：显式传 + 可核 + 无身份拒 ───────────────────────────────────────────────────────

/** known-callers（可核 = 调用方必须在此集合内）。读 CONTROL_CALLERS_ENV，缺省 DEFAULT_CALLERS。 */
export function knownCallers(env: NodeJS.ProcessEnv = process.env): Set<string> {
  const raw = env[CONTROL_CALLERS_ENV];
  const list = raw && raw.trim() ? raw.split(",").map((s) => s.trim()).filter(Boolean) : [...DEFAULT_CALLERS];
  return new Set(list);
}

export type CallerResolution =
  | { ok: true; caller: string }
  | { ok: false; reason: string; code: "no-caller" | "unknown-caller" };

/**
 * 身份解析（AC2/AC3 核心）：tool 参数 `caller` 优先，其次 header `Mcp-Caller-Id`；两者皆缺 ⇒ 拒
 * （⛔ 不得按默认身份放行）；不在 knownCallers ⇒ 拒（unknown-caller）。Mcp-Session-Id 完全不参与。
 */
export function resolveCaller(opts: {
  toolArg?: string | null | undefined;
  header?: string | null | undefined;
  env?: NodeJS.ProcessEnv;
}): CallerResolution {
  const raw = (opts.toolArg ?? "").trim() || (opts.header ?? "").trim();
  if (!raw) {
    return {
      ok: false,
      code: "no-caller",
      reason: `no caller identity — pass the \`caller\` tool arg or the ${CONTROL_HEADER_NAME} header (⛔ no default identity)`,
    };
  }
  const callers = knownCallers(opts.env);
  if (!callers.has(raw)) {
    return {
      ok: false,
      code: "unknown-caller",
      reason: `unknown caller "${raw}" (known callers: ${[...callers].sort().join(", ")})`,
    };
  }
  return { ok: true, caller: raw };
}

/** 从 requestInfo.headers 取一个 header（兼容 string / string[] / Headers.get 三种形态）。 */
export function headerValue(
  headers: Record<string, string | string[] | undefined> | { get(name: string): string | null } | undefined,
  name: string,
): string | null {
  if (!headers) return null;
  if (typeof (headers as { get?: (n: string) => string | null }).get === "function") {
    return (headers as { get(n: string): string | null }).get(name);
  }
  const v = (headers as Record<string, string | string[] | undefined>)[name];
  if (v == null) return null;
  return Array.isArray(v) ? (v[0] ?? null) : String(v);
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
      appendOutcomeToFile(outcomeFile, outcome);
      if (json) process.stdout.write(`${JSON.stringify({ event: "worker-done", task: taskId, ...outcome })}\n`);
      let exitCode: number;
      if (outcome.final_state === "completed") exitCode = 0;
      else if (outcome.final_state === "timed-out") exitCode = 128 + signalExitCode(signal ?? "SIGTERM");
      else if (outcome.final_state === "killed") exitCode = 128 + (signal ? signalExitCode(signal) : 0);
      else if (outcome.final_state === "spawn-failed") exitCode = 2;
      else if (outcome.final_state === "exited-not-landed") exitCode = EXITED_NOT_LANDED_EXIT;
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

/** 判停条件之二：resource-gate 是否报 WAIT（AC3）。cmd 覆盖是测试缝；缺省 = 本仓库 resource-gate.sh
 *  `--for full-suite --json`。exit 0 = GO，非 0 = WAIT（读不懂/读失败 ⇒ fail-closed WAIT，硬规则 3b）。 */
export function resourceGateCheck(root: string, cmd: string[] | null): { go: boolean; reason: string } {
  const argv = cmd ?? ["bash", path.join(root, "plugin", "scripts", "resource-gate.sh"), "--for", "full-suite", "--json"];
  let r: ReturnType<typeof spawnSync>;
  try {
    r = spawnSync(argv[0], argv.slice(1), {
      encoding: "utf8", timeout: 20_000, maxBuffer: 1 * 1024 * 1024, stdio: ["ignore", "pipe", "ignore"],
    });
  } catch (e) {
    const msg = e && typeof e === "object" && "message" in e ? String(e.message) : String(e);
    return { go: false, reason: `resource-gate spawn failed (${msg}) — fail-closed` };
  }
  if (r.error) return { go: false, reason: `resource-gate failed (${String(r.error.message || r.error)}) — fail-closed` };
  const stdout = String(r.stdout ?? "").trim();
  if (r.status === 0) {
    try {
      const j = JSON.parse(stdout);
      if (j && typeof j.verdict === "string") {
        return { go: j.verdict === "GO", reason: j.reason || `resource-gate verdict ${j.verdict}` };
      }
    } catch {
      /* not JSON — use exit code */
    }
    return { go: true, reason: stdout ? stdout.slice(0, 200) : "resource-gate GO" };
  }
  return { go: false, reason: stdout ? stdout.slice(0, 200) : `resource-gate WAIT (exit ${r.status})` };
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
}

/**
 * 常驻选择环（AC1 常驻 + AC2 自主选任务 + AC3 判停）。
 *   循环：reap 已完成的 worker → 池非空且未达 cap 且未判停 ⇒ 走选择环（ready-pool-check → 减在飞集 →
 *   打散 → selector worker）→ spawn → 等一个结束 → 再 reap。判停（MCP halt / resource-gate WAIT /
 *   池空）⇒ 停止起新 worker，⛔ 不杀在飞（在飞 worker 全部跑完才退出）。退出码 = 首个非零 worker 码。
 */
export async function runResidentLoop(opts: ResidentOptions): Promise<number> {
  const { rootDir, cap, timeoutMs, workerCmdOpts, selectorArgv, readyPoolArgv, resourceGateArgv, outcomeFile, runId, runPrefix, json, pidFile, livenessCmd } = opts;

  // checkout 前 stash（阶段 2 ③）：主检出脏 ⇒ stash 一次（常驻循环起跑前），⛔ 不 discard。非 git no-op。
  const stash = stashIfDirty(rootDir);
  if (json) {
    process.stdout.write(`${JSON.stringify({ event: "stash", stashed: stash.stashed, files: stash.files, error: stash.error })}\n`);
  }

  const running: RunningWorker[] = [];
  const results: WorkerRunResult[] = [];
  let stopReason: string | null = null;

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

  /** 判停（AC3）：起新 worker 前逐轮读。halt 优先，其次 resource-gate WAIT；池空在选择环返回 null 时判。 */
  const stopCondition = (): { stop: boolean; reason: string | null } => {
    if (isHalted(rootDir)) {
      return { stop: true, reason: "mcp-halt (control state halted — no new dispatch; in-flight workers untouched)" };
    }
    const rg = resourceGateCheck(rootDir, resourceGateArgv);
    if (!rg.go) return { stop: true, reason: `resource-gate-wait: ${rg.reason}` };
    return { stop: false, reason: null };
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
    let poolSeen: number | null = null;
    while (running.length < cap && !stopReason) {
      const sc = stopCondition();
      if (sc.stop) {
        stopReason = sc.reason;
        break;
      }
      const pool = readyPoolCheck(rootDir, readyPoolArgv, running.map((r) => r.task), cap);
      poolSeen = pool.pool;
      const active = new Set(running.map((r) => r.task));
      const candidates = shuffle(pool.ready.filter((id) => !active.has(id)));
      if (candidates.length === 0) {
        stopReason = "pool-empty (no dispatchable candidate in the ready pool)";
        break;
      }
      const sel = runSelectorWorker(candidates, selectorArgv, rootDir);
      if (!sel) {
        // 候选非空但 selector 未能给出任何选择（理论上 parseSelectorOutput 必回退首个，不会 null）。
        stopReason = "pool-empty (selector returned no candidate)";
        break;
      }
      spawnSelected(sel);
    }

    // AC138-3 无条件心跳：每轮循环写一条（⛔ 池空/判停轮也写——outcome 在这些轮不写）。
    writeRound(round, running.length, poolSeen, stopReason, liveness);

    // 3. 无在飞 ⇒ 循环终了（判停，或池已排空）。
    if (running.length === 0) break;

    // 4. 等在飞 worker 结束（至少一个），再回环 reap + 补位。⛔ 从不主动杀在飞。
    await Promise.race(running.map((r) => r.promise));
  }

  if (json && stopReason) {
    process.stdout.write(`${JSON.stringify({ event: "resident-stop", reason: stopReason })}\n`);
  }
  const bad = results.find((r) => r && r.exitCode !== 0);
  return bad ? bad.exitCode : 0;
}

// ── MCP 控制面（HTTP/SSE，AC117）──────────────────────────────────────────────────────────────────

/** serveControlPlane 返回的句柄（url 可观测，close 停服）。 */
export interface ControlPlaneHandle {
  url: string;
  port: number;
  close(): Promise<void>;
}

/**
 * 起 MCP 控制面（HTTP/SSE，streamable HTTP——同时支持 POST JSON-RPC 与 GET SSE）。暴露三操作
 * halt / setPreference / forceDispatch，全部走【身份闸】resolveCaller（AC2 header 或 tool 参数、
 * AC3 无身份拒）。SDK 与 zod 惰性 import（仅 --serve 路径加载，派发环/纯函数零 SDK 依赖）。
 */
export async function serveControlPlane(opts: {
  root: string;
  host?: string;
  port?: number;
  env?: NodeJS.ProcessEnv;
}): Promise<ControlPlaneHandle> {
  const root = path.resolve(opts.root);
  const host = opts.host ?? "127.0.0.1";
  const env = opts.env ?? process.env;

  const [{ McpServer }, { StreamableHTTPServerTransport }, { isInitializeRequest }, { z }] = await Promise.all([
    import("@modelcontextprotocol/sdk/server/mcp.js"),
    import("@modelcontextprotocol/sdk/server/streamableHttp.js"),
    import("@modelcontextprotocol/sdk/types.js"),
    import("zod"),
  ]);

  // 身份闸：resolveCaller 不过 ⇒ 返回 isError 结果；过 ⇒ null。三个工具共用（AC2/AC3 统一）。
  const reject = (reason: string) => ({
    isError: true,
    content: [{ type: "text" as const, text: `rejected: ${reason}` }],
  });
  const ok = (payload: unknown) => ({
    content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }],
  });

  // 每个会话一个独立 McpServer（低层 Server 只支持单 transport ⇒ SDK simpleStreamableHttp 示例
  // 也是每会话新建一个 server）。工具注册是纯函数，同一套工具挂到每个会话自己的 server 上。
  const registerControlTools = (server: any) => {
    server.registerTool(
      "halt",
      {
        title: "halt — stop NEW dispatch (never kill in-flight)",
        description:
          "MCP halt (SPEC §5 阶段 3): set halted=true to stop NEW dispatch; in-flight workers are NOT killed " +
          "(same boundary as the retired .halt sentinel). halted=false resumes. Identity is REQUIRED and " +
          `verifiable — pass \`caller\` (tool arg) or the ${CONTROL_HEADER_NAME} header; a call with no identity ` +
          "is rejected (no default identity).",
        inputSchema: {
          halted: z.boolean().optional().describe("true = halt (stop new dispatch); false = resume. Default true."),
          caller: z.string().optional().describe(`Caller identity (e.g. "outer" | "manager"); alternative to the ${CONTROL_HEADER_NAME} header.`),
        },
      },
      async (args: { halted?: boolean; caller?: string }, extra: any) => {
        const header = headerValue(extra?.requestInfo?.headers, CONTROL_HEADER);
        const res = resolveCaller({ toolArg: args.caller, header, env });
        if (!res.ok) return reject(res.reason);
        const state = readControlState(root, env).state;
        const next = applyHalt(state, res.caller, args.halted ?? true);
        writeControlState(root, next);
        return ok({
          halted: next.halted,
          halted_by: next.halted_by,
          halted_at: next.halted_at,
          note: "halt stops NEW dispatch only; in-flight workers are NOT killed",
        });
      },
    );

    server.registerTool(
      "setPreference",
      {
        title: "setPreference — write a selector preference",
        description:
          "MCP control plane (SPEC §5 阶段 3): write a key/value preference the selector loop reads. " +
          "Identity is REQUIRED (caller arg or header); no identity is rejected.",
        inputSchema: {
          key: z.string().describe("Preference key."),
          value: z.string().describe("Preference value."),
          caller: z.string().optional().describe(`Caller identity; alternative to the ${CONTROL_HEADER_NAME} header.`),
        },
      },
      async (args: { key: string; value: string; caller?: string }, extra: any) => {
        const header = headerValue(extra?.requestInfo?.headers, CONTROL_HEADER);
        const res = resolveCaller({ toolArg: args.caller, header, env });
        if (!res.ok) return reject(res.reason);
        const state = readControlState(root, env).state;
        const next = applyPreference(state, args.key, args.value);
        writeControlState(root, next);
        return ok({ preference: next.preference });
      },
    );

    server.registerTool(
      "forceDispatch",
      {
        title: "forceDispatch — record a forced dispatch",
        description:
          "MCP control plane (SPEC §5 阶段 3): record a forced-dispatch request (consumed by the resident " +
          "driver's selector loop). Identity is REQUIRED (caller arg or header); no identity is rejected.",
        inputSchema: {
          task: z.string().describe("Task id to force-dispatch."),
          reason: z.string().optional().describe("Why this task is force-dispatched."),
          caller: z.string().optional().describe(`Caller identity; alternative to the ${CONTROL_HEADER_NAME} header.`),
        },
      },
      async (args: { task: string; reason?: string; caller?: string }, extra: any) => {
        const header = headerValue(extra?.requestInfo?.headers, CONTROL_HEADER);
        const res = resolveCaller({ toolArg: args.caller, header, env });
        if (!res.ok) return reject(res.reason);
        const state = readControlState(root, env).state;
        const next = applyForceDispatch(state, args.task, args.reason ?? null, res.caller);
        writeControlState(root, next);
        return ok({ forced: next.forced });
      },
    );
  };

  // 多会话（stateful）路由：每个会话一个【独立 McpServer + transport】，按 Mcp-Session-Id 分流
  // （SDK simpleStreamableHttp 示例的 canonical 模式）。outer 与 manager 各连各的会话，互不干扰。
  const transports = new Map<string, any>();
  const servers = new Set<any>();

  const newTransport = async () => {
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (sid: string) => {
        transports.set(sid, transport);
      },
    });
    transport.onclose = () => {
      const sid = transport.sessionId;
      if (sid && transports.get(sid) === transport) transports.delete(sid);
    };
    const server = new McpServer({ name: "worker-driver-control", version: "0.6.1" });
    registerControlTools(server);
    servers.add(server);
    await server.connect(transport);
    return transport;
  };

  const httpServer = createServer((req, res) => {
    void (async () => {
      try {
        const sessionId = headerValue(req.headers as Record<string, string | string[] | undefined>, "mcp-session-id");
        const method = req.method ?? "GET";
        // GET（SSE 流）/ DELETE（会话终止）：必须带已知 session id。
        if (method === "GET" || method === "DELETE") {
          if (!sessionId || !transports.has(sessionId)) {
            res.writeHead(400, { "content-type": "application/json" });
            res.end(JSON.stringify({ jsonrpc: "2.0", error: { code: -32000, message: "Invalid or missing session ID" }, id: null }));
            return;
          }
          await transports.get(sessionId)!.handleRequest(req, res);
          return;
        }
        // POST：带已知 session id ⇒ 复用该会话的 transport；否则必须是 initialize（开新会话）。
        if (sessionId && transports.has(sessionId)) {
          await transports.get(sessionId)!.handleRequest(req, res);
          return;
        }
        const body = await readRequestBody(req);
        let parsed: unknown = null;
        try {
          parsed = body ? JSON.parse(body) : null;
        } catch {
          /* fall through to 400 */
        }
        if (!parsed || !isInitializeRequest(parsed)) {
          res.writeHead(400, { "content-type": "application/json" });
          res.end(JSON.stringify({ jsonrpc: "2.0", error: { code: -32000, message: "Bad Request: no valid session ID provided" }, id: null }));
          return;
        }
        const transport = await newTransport();
        await transport.handleRequest(req, res, parsed);
      } catch {
        if (!res.headersSent) {
          res.writeHead(500, { "content-type": "application/json" });
          res.end(JSON.stringify({ jsonrpc: "2.0", error: { code: -32603, message: "Internal server error" }, id: null }));
        }
      }
    })();
  });
  await new Promise<void>((resolve, rejectListen) => {
    httpServer.once("error", rejectListen);
    httpServer.listen(opts.port ?? 0, host, () => resolve());
  });
  const address = httpServer.address();
  const boundPort = address && typeof address === "object" ? address.port : (opts.port ?? 0);

  return {
    url: `http://${host}:${boundPort}`,
    port: boundPort,
    close: async () => {
      for (const s of [...servers]) {
        try {
          await s.close();
        } catch {
          /* best-effort */
        }
      }
      for (const t of [...transports.values()]) {
        try {
          await t.close();
        } catch {
          /* best-effort session teardown */
        }
      }
      await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    },
  };
}

/** 读原始 HTTP 请求体为 UTF-8 字符串（Node 无 express 时 body 需手动读）。 */
export function readRequestBody(req: { on(ev: "data", cb: (chunk: unknown) => void): unknown; on(ev: "end", cb: () => void): unknown; on(ev: "error", cb: (e: unknown) => void): unknown }): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (c) => {
      data += String(c);
    });
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
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
    const handle = await serveControlPlane({ root: rootDir, host, port });
    if (json) process.stdout.write(`${JSON.stringify({ event: "control-plane-serving", url: handle.url, port: handle.port })}\n`);
    else console.log(`worker-driver control plane serving at ${handle.url}`);
    const stop = () => { void handle.close(); };
    process.on("SIGINT", stop);
    process.on("SIGTERM", stop);
    return 0;
  }

  const outcomeFile = outcomePath ? path.resolve(outcomePath) : path.join(rootDir, WORKER_OUTCOME_REL);
  const timeoutMs = parseTimeoutMs(timeoutRaw);

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
