// worker-driver.ts — SPEC-worker-driven-inner-2026-08-16 §5 阶段 2：机械驱动进程 spawn 多个
// claude -p worker 跑完整任务（选择 → worktree → 开发 → suite → ff），并发由驱动数自己的子进程控制，
// 超时 SIGTERM、⛔ 不 stash 主检出（gap-worker-driver-stashifdirty-stashes-others-uncommitted）。退出码 + 结构化 outcome 落盘；任何异常死亡终态清理 orphan
// worktree（⛔ exited-not-landed = exit 0 跑到 fan-in 底但没落地——needs-human 闸拒绝属工作有效，保留
// 分支/worktree 供续做，不走销毁；见 gap-worker-needs-human-destroys-branch-worktree）。
//
// WHY THIS EXISTS (SPEC §2 ①，硬规则 4b)：「在飞」现在是【驱动进程自己 fork 的子进程数】——直接量，
// 不是估的。旧的三个代理量（worktree 数 / 任务 subagent 数 / 遥测括号 implementing 段）双向偏差，
// 根因是「让被测对象自己数自己」。本驱动是 spawner ⇒ 它数的子进程数是真值（AC1：在飞 = 驱动子进程数，
// 与任何代理量比对不一致时以驱动为准）。
//
// 权责边界（SPEC §3.2，人裁定的硬线）：
//   驱动  ⛔ 不做任何 commit  ⛔ 不调用 LLM 做判断  ⛔ 不 stash 主检出  ✅ 起/杀 worker、数并发、超时、记录 outcome
//   worker ✅ 自己的 worktree 内全权  ✅ 最后 ff merge 到 develop  ⛔ 除最后 merge 外不碰 develop
//   主检出 是【共享面】（manager/outer 都在此工作）——驱动【不】checkout、也【不】stash 它：驱动自己的
//         写入全在 .quay/（gitignored），主检出上任何可被 stash 的未提交改动必属他人（gap-worker-driver-
//         stashifdirty-stashes-others-uncommitted）。ff 前的干净判据由 fan-in-ff-merge.sh 自持，非驱动代劳。
//
// 阶段 2 新增（AC116，相对阶段 1 的三条能力）：
//   ① 并发 N —— --task 可重复、--concurrency N 上限；在飞 = 驱动当前活子进程数（直接量，非硬编码 1）。
//   ② 超时 SIGTERM —— --timeout <ms>（缺省 0 = 无超时，SPEC §4④：成本结构未知前不设阈值）。超时 ⇒
//      SIGTERM worker、outcome 记 final_state=timed-out（worktree_preserved=true）。⛔ 超时【保留
//      worktree】（SPEC §1 设计点3「超时即杀 worker 会话，但保留 worktree」；gap-worker-print-bg-wait-
//      ceiling-600s AC3）——超时≠其它异常死亡（failed/killed/exited-not-landed 仍清 orphan worktree，
//      gap-worker-driver-no-record-on-abnormal-death AC2）。
//   ③ ⛔ 不 stash 主检出 —— spawn 前【观察】主检出脏状态但不 stash（归属检查：可被 stash 的脏改动必属
//      他人，卷走 = 本缺陷）。非 git 仓库 no-op。ff 的干净判据在 fan-in-ff-merge.sh，不在这里。
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
//   ② A6「检查 fan-in 是否走 workflow」—— worker 永不自己调 fan-in-execute workflow（创建 + 续做
//      两条 prompt 都走 driverFanInNote：worker 实现后退出、driver 接手机械跑 fan-in；语义兜底归
//      driver 按 red step 决定），结构上不需要事后检查「有没有走」。标记落点：fan-in-workflow-check.ts
//      头部「A6 检查退役面」横幅（过渡期仍保留给旧循环，驱动路径不消费它）。
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
//                       缺省 = launchArgv 经 L2 policy 解析（profile launcher + --settings + --model + -n）。
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
import { spawn, spawnSync } from "node:child_process";
import { isDirectEntry } from "./gate-script-base.ts";
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
// AC152：派发前过滤的【可组合谓词列表】单一实现（driver-filters.ts）。worker 的派发环消费
// applyTaskFilters（函数级复用，⛔ 不各写一遍）。readTaskStatus 亦上收到 driver-filters.ts，
// 本文件 re-export 保持旧 import 面（worker-driver.test.mjs / computeLandingState 等）。
import { applyTaskFilters, makeFilterContext, readTaskStatus, advanceRetryCap, markNeedsHuman, RETRY_CAP_DEFAULT, type RetryState } from "./driver-filters.ts";
export { readTaskStatus } from "./driver-filters.ts";
// AC155：并发 cap / 轮询间隔 / 协调地板的单一真相源（drivers.yml 经 driver-config 加载，⛔ 不各写一份字面量、
// ⛔ 不再读 QUAY_MAX_TASK_SUBAGENTS env——env 源已并入声明式配置）。
import { defaultDriverConfig, loadDriverConfig, driverCap } from "./driver-config.ts";
// AC153：核心不变式单一实现（「⛔ 不信执行者自述，用独立量复核」）+ DriverResult 词表强制含
// not-evaluated。computeLandingState 消费它（⛔ 不各写一遍 exitCode/自述判定）。
import { verifyIndependently, type DriverResult } from "./driver-result.ts";
// AC153：re-export verifyIndependently 值——测试用「同一函数身份」证两 driver 共用单一实现（⛔ 非平行副本）。
export { verifyIndependently } from "./driver-result.ts";
export type { DriverResult } from "./driver-result.ts";
import { listWorktrees, taskIdFromBranch } from "./fast-mode-telemetry.ts";
import { isDue } from "./routine-scheduler.ts";
// AC151：worker 继承 Layer 0（driver-runtime：profile/liveness/loop/stopCondition）+ Layer 1a
// （task-processing：source/select）。⛔ 不各写一遍 launchArgv/liveness/shuffle/readyPoolCheck/
// selector——全部经 import 消费单一实现。runAsync 只 import 不 re-export（本文件内部用，非公开面）。
import {
  splitArgs,
  launchArgv,
  runAsync,
  defaultLivenessCheckArgv,
  runLivenessCheck,
  runLivenessCheckAsync,
  LIVENESS_CHECK_TIMEOUT_MS,
  shuffle,
  defaultReadyPoolArgv,
  readyPoolCheck,
  defaultSelectorArgv,
  parseSelectorOutput,
  runSelectorWorker,
  makeStopCondition,
  type LivenessResult,
} from "./driver-runtime.ts";
// 机械 fan-in（gap-fan-in-driver-mechanical-orchestration / SPEC-fan-in-driver-mechanical-
// orchestration-2026-08-27）：suite 不再 detach（setsid+&+disown 孤儿）——改由 driver 直接 spawn 并 wait
// （进程级父子，ppid 指向 driver，AC3）。复用 suite-driver.ts 的 spawnSuiteAndWait（同一单飞槽语义 +
// 静默看门狗，⛔ 不新写一份 suite 生命周期）。suiteLockBase 读 TS 侧单一真相源槽路径。
import { spawnSuiteAndWait, writeRedSuiteRecord, type SuiteOutcome, type SuiteRunResult } from "./suite-driver.ts";
import { suiteLockBase } from "./suite-lock-slots.ts";
// D7：机械 fan-in 的 bucket suite 绿后，把本轮 suite 状态镜像到权威载体 full-suite-state.json
// （复用 mirror-full-suite-state.ts 的 build/write/skip 单一实现，⛔ 不另写一份 state shape）。
import { buildMirrorState, writeMirrorState, shouldSkipMirrorWrite, readCurrentState } from "./mirror-full-suite-state.ts";
// D7：laneCount 取 full-suite-runner.ts 的 defaultLaneCount（nproc-derived 单一真相源，读宿主 + QUAY_MAX_*
// 定义点，⛔ 不写字面量 1——concurrency-literal-check P4 会把 `laneCount: 1` 判为未声明并发字面量违规）。
import { defaultLaneCount } from "./full-suite-runner.ts";
export {
  splitArgs,
  launchArgv,
  defaultLivenessCheckArgv,
  runLivenessCheck,
  runLivenessCheckAsync,
  LIVENESS_CHECK_TIMEOUT_MS,
  shuffle,
  defaultReadyPoolArgv,
  readyPoolCheck,
  defaultSelectorArgv,
  parseSelectorOutput,
  runSelectorWorker,
  makeStopCondition,
  type LivenessResult,
} from "./driver-runtime.ts";

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

/** 并发上限的旧 env 定义点（concurrency-literal-check 的旧旋钮①）。AC155：env 源已退役——并发缺省
 *  改读 driver-config 的 drivers.yml（loadDriverConfig / driverCap 单一真相源）。本常量保留仅为历史
 *  引用/命名稳定性，⛔ 不再是并发解析的输入。 */
export const MAX_TASK_SUBAGENTS_ENV = "QUAY_MAX_TASK_SUBAGENTS";

/** 存活 worker 进程的 `-n` 名（launchArgv 经 profile-policy.ts 解析 .quay/profiles.yml 的
 *  `roles["task-worker"].name` 承载；AC140-2 测试钉死 name 以 quay- 开头）。
 *  冷启动在飞枚举用它识别存活 worker 进程的 cmdline（/proc/<pid>/cmdline）。
 *  AC150-3：控制态常量（CONTROL_STATE_REL/CONTROL_CALLERS_ENV/DEFAULT_CALLERS/CONTROL_HEADER/
 *  CONTROL_HEADER_NAME）已随控制面抽到 driver-shared.ts 并在本文件 re-export；本常量是 worker
 *  独有（进程名识别），保留在本文件。 */
export const WORKER_PROCESS_NAME = "quay-task-worker";

/** 常驻循环【无在飞 worker 且瞬时 WAIT】时的轮询间隔（ms，测试缝经 --interval 传小值）。与
 *  promotion-driver 的 INTERVAL_MS_DEFAULT 同语义：resource-gate-wait / pool-empty 是瞬时态
 *  （闸随负载降会放行、池随 promotion-driver 持续补），等 intervalMs 后重读而非退出
 *  （gap-worker-driver-stopreason-latch-permanent-stop）。AC155：值从 driver-config 的
 *  drivers.yml 派生（单一真相源，⛔ 本文件不再有独立字面量）。 */
export const RESIDENT_INTERVAL_MS_DEFAULT = defaultDriverConfig().worker.intervalMs;

/** 协调地板（gap-worker-driver-reconcile-interval，SPEC §5.5）的缺省周期：至少每 N 秒协调一次，
 *  哪怕所有边沿事件（worker 退出）都丢了 ⇒ 降级「慢但正确」而非「静默停摆」（AC155 AC3 兜底轮询）。
 *  缺省【保守】——协调一趟只是读文件+扫进程+算 diff（配合异步化后廉价且有界），300s = 5 分钟：
 *  远小于停摆窗口（今日实测 1h48m），又不会高频重算 ready 池浪费资源（硬规则 4 推论：成本结构已知
 *  为「廉价」后才设值）。AC155：值从 driver-config 的 drivers.yml 派生（单一真相源）。 */
export const RECONCILE_INTERVAL_SECS_DEFAULT = defaultDriverConfig().worker.reconcileIntervalSecs;

// ── 纯函数（可单测） ───────────────────────────────────────────────────────────────────────────────

/**
 * 一条结构化 outcome 记录（SPEC §4③ 字段齐全 + 直接量 + 超时标记 + 落地判定 + transcript session_id）。
 * @returns {object} { ts, task, selector_reason, exit_code, signal, wall_clock_ms, final_state,
 *   failure_reason, started_at, ended_at, worker_pid, run_id, in_flight_count, timed_out, session_id }
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
  sessionId = null,
  lockWaitMs = null,
  lockHoldMs = null,
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
  /** 本次尝试的 transcript session id（gap-worker-task-transcript-access-webui AC1：spawn 传
   *  `--session-id <uuid>`，同一 uuid 落盘 ⇒ web 可逐次访问该尝试的 transcript）。null = 无会话
   *  （not-dispatched 等未 spawn 路径）。 */
  sessionId?: string | null;
  /** gap-suite-lock-starvation-long-validation-hold AC2 — the suite's single-flight flock metrics,
   *  读自 verification-round.jsonl（与 worker 的 runId 对齐）。null = 无记录 / 该轮没取锁（scoped/doc
   *  / 读不懂）⇒ outcome 字段缺省（缺键，⛔ 不是伪造的 0）。 */
  lockWaitMs?: number | null;
  lockHoldMs?: number | null;
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
    session_id: sessionId,
    // gap-suite-lock-starvation-long-validation-hold AC2 — the suite's flock metrics, so a reader of
    //   worker-outcome.jsonl can distinguish「长时间持锁」(high lock_hold_ms) from「worker 慢 / 排队饿死」
    //   (high lock_wait_ms + low lock_hold_ms = starved in the queue; low both + high wall_clock = slow
    //   outside the lock). Absent (缺键) when the suite didn't take the lock or no record matches the runId.
    ...(lockWaitMs !== null && lockWaitMs !== undefined ? { lock_wait_ms: lockWaitMs } : {}),
    ...(lockHoldMs !== null && lockHoldMs !== undefined ? { lock_hold_ms: lockHoldMs } : {}),
  };
}

// ── suite 锁指标（gap-suite-lock-starvation-long-validation-hold AC2）────────────────────────────
// worker（claude -p）是黑盒，driver 不直接看到 suite 日志；但 worker 跑 fan-in 时，verification-round.jsonl
// （<root>/.quay/，经 git common-dir 解析到主检出）会落一条带 runId 的记录，其 lock_wait_ms/lock_hold_ms
// 就是本次尝试的锁等待/持有分段。worker 退出后读【最后一个 runId+taskId 匹配】的记录取这两个字段。
// 读不到（无记录 / 该轮没取锁 / 字段缺省 / JSON 坏行）⇒ null（缺键，⛔ 不伪造 0）。runId 复用重派时，
// 最后一个匹配记录是【本次尝试】的（后落盘者最新）——旧轮同 runId 记录被顺序覆盖。
export function readLockMetricsForRun(
  root: string,
  runId: string,
  taskId: string,
): { lockWaitMs: number | null; lockHoldMs: number | null } {
  const file = path.join(root, ".quay", "verification-round.jsonl");
  let text = "";
  try {
    text = fs.readFileSync(file, "utf8");
  } catch {
    return { lockWaitMs: null, lockHoldMs: null };
  }
  let lockWaitMs: number | null = null;
  let lockHoldMs: number | null = null;
  for (const line of text.split("\n")) {
    const t = line.trim();
    if (!t) continue;
    let rec: Record<string, unknown>;
    try {
      rec = JSON.parse(t);
    } catch {
      continue;
    }
    if (rec.runId !== runId) continue;
    if (taskId && rec.taskId !== taskId) continue;
    if (typeof rec.lock_wait_ms === "number") lockWaitMs = rec.lock_wait_ms;
    if (typeof rec.lock_hold_ms === "number") lockHoldMs = rec.lock_hold_ms;
  }
  return { lockWaitMs, lockHoldMs };
}

// ── 落地判定（gap-worker-driver-fake-completion-exit-0）──────────────────────────────────────────
// exit_code=0 只是「进程正常退出」，⛔ 不是「任务落地」。写 final_state=completed 前必须读一次任务侧
// 直接量：status=done（任务文件 frontmatter）∧ 无残留 worktree（`git worktree list` 无 task/<id> 分支）。
// 共同纪律（同族 gap-fix-worker-edit-exit-4）：驱动写任何终态之前，必须读任务侧的直接量。
// readTaskStatus / depsSatisfied / touchesDisjoint 已上收 driver-filters.ts（AC152 单一实现），本文件
// 只 re-export readTaskStatus、派发环消费 applyTaskFilters。

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

/** worktreePresentForTask 的异步版（常驻循环体用——⛔ spawnSync git 会冻住协调地板）。语义一致：
 *  读失败（git 失败）⇒ null（读不懂 ≠ 无残留），⛔ 不是 false。 */
export async function worktreePresentForTaskAsync(root: string, taskId: string): Promise<boolean | null> {
  const r = await runAsync(["git", "-C", root, "worktree", "list", "--porcelain"], { timeoutMs: 5_000 });
  if (r.error || r.status !== 0) return null;
  const re = new RegExp(`^branch refs/heads/task/${escapeRegExp(taskId)}$`, "m");
  return re.test(String(r.stdout ?? ""));
}

/** worktreePathsForTask 的异步版（常驻循环体用）。读失败 ⇒ []（与同步版一致）。 */
export async function worktreePathsForTaskAsync(root: string, taskId: string): Promise<string[]> {
  const r = await runAsync(["git", "-C", root, "worktree", "list", "--porcelain"], { timeoutMs: 5_000 });
  if (r.error || r.status !== 0) return [];
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

/** listWorktrees 的异步版（常驻循环体用——⛔ fast-mode-telemetry.listWorktrees 用 execFileSync 会冻住
 *  协调地板）。解析逻辑与其一致：`git worktree list --porcelain` → [{path, branch}]，git 失败 ⇒ []（fail-soft）。 */
async function listWorktreesAsync(root: string): Promise<Array<{ path: string; branch: string | null }>> {
  const r = await runAsync(["git", "-C", root, "worktree", "list", "--porcelain"], { timeoutMs: 5_000 });
  if (r.error || r.status !== 0) return [];
  const worktrees: Array<{ path: string; branch: string | null }> = [];
  let cur: { path: string; branch: string | null } | null = null;
  for (const line of r.stdout.split("\n")) {
    if (line.startsWith("worktree ")) {
      cur = { path: line.slice("worktree ".length), branch: null };
      worktrees.push(cur);
    } else if (line.startsWith("branch ") && cur) {
      cur.branch = line.slice("branch ".length);
    }
  }
  return worktrees;
}

/** enumerateTaskWorktreeTasks 的异步版（常驻循环体用）。 */
async function enumerateTaskWorktreeTasksAsync(root: string): Promise<string[]> {
  const ids: string[] = [];
  for (const wt of await listWorktreesAsync(root)) {
    const id = taskIdFromBranch(wt?.branch);
    if (id != null) ids.push(id);
  }
  return ids;
}

/** enumerateColdStartInflight 的异步版（常驻循环体用）：git worktree list 改 spawn；/proc 扫进程仍是
 *  同步 fs（廉价、无 spawnSync 阻塞——task 4 只点名 git，不点名 /proc）。opts 测试缝同同步版。 */
export async function enumerateColdStartInflightAsync(
  root: string,
  opts: { worktreeTasks?: string[] | null; workerCmdlines?: string[] | null } = {},
): Promise<Set<string>> {
  const worktreeTasks = opts.worktreeTasks ?? await enumerateTaskWorktreeTasksAsync(root);
  if (worktreeTasks.length === 0) return new Set(); // 无 task worktree ⇒ 无冷启动在飞（⛔ 不白扫 /proc）
  const workerCmdlines = opts.workerCmdlines ?? enumerateLiveWorkerCmdlines();
  const out = new Set<string>();
  for (const taskId of worktreeTasks) {
    if (hasLiveWorkerForTask(taskId, workerCmdlines)) out.add(taskId);
  }
  return out;
}

/** exit_code=143（128+SIGTERM=15）⇒ 外部 SIGTERM 杀——wrapper/shell 把信号转成退出码上报（Node 的 close
 *  事件 code=143、signal=null），区别于 worker 自崩（真实非零退出码）。failed 桶正是用它区分「外部杀」
 *  （driver 重启误伤 / 外部 kill，worker 正干着活被打断）与「自崩」（worker 缺陷）。 */
export function isSigtermExitCode(exitCode: number | null): boolean {
  return exitCode === 128 + signalExitCode("SIGTERM");
}

/** 该 task 分支相对 develop 是否有提交（直接量、可取假）：`git log develop..task/<id>` 非空 ⇒ 有实现
 *  产出（worker 在 worktree 里提交过）；空 ⇒ 零提交无产出。读失败（非 git 仓库 / develop 或 task/<id>
 *  分支不存在 / git 错误）⇒ null（硬规则 3b：读不懂 ≠ 无产出，⛔ 不得当「零提交」清掉）。 */
export function taskBranchHasCommits(root: string, taskId: string): boolean | null {
  const r = spawnSync("git", ["-C", root, "log", `develop..task/${taskId}`, "--oneline"], { encoding: "utf8" });
  if (r.status !== 0 || r.error) return null;
  return String(r.stdout ?? "").trim().length > 0;
}

/** orphan worktree 清理结果（可观测：removed/分支删除/错误/存活跳过/产出判定/信号区分）。 */
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
  /** 清理前 `git log develop..task/<id>` 判产出的读数（直接量）。true = 有提交、false = 零提交、
   *  null = 读不懂。false ⇒ 可清；true ⇒ 保留；null ⇒ fail-closed 保留（读不懂 ≠ 无产出）。 */
  hasCommits: boolean | null;
  /** 因「有提交 ⇒ 有实现产出」而跳过清理（⛔ 与 skippedLiveWorker 区分：后者是存活 worker 在用，前者是
   *  分支有产出）。仅 hasCommits === true 时为 true。 */
  preservedForCommits: boolean;
  /** failed 桶按信号区分：final_state=failed 且 exit_code=143 ⇒ 外部 SIGTERM 杀（区别于 worker 自崩）。 */
  sigtermExternal: boolean;
}

/**
 * orphan worktree 清理（gap-worker-driver-no-record-on-abnormal-death AC2）：worker 异常死亡（failed /
 * killed——worker 没跑完、无完成实现）后，其 orphan worktree 永久残留会挡 driver 下轮对同一
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
 *
 * gap-worker-cleanup-judgment-precision（清理判据精确化，AC1+AC2）：清理前查 `git log develop..task/<id>`
 * 判有无产出（直接量、可取假）——零提交 ⇒ 无产出可清；有提交 ⇒ 有实现保留（⛔ 纯终态字符串布尔判断
 * 会误删 SIGTERM 打断时有提交的 worktree）。failed 桶按信号区分：exit_code=143（外部 SIGTERM 杀）vs
 * 自崩，前者有提交则保留。outcome 是终态上下文（finalState/exitCode）——测试与调用方注入，null ⇒ 不
 * 区分信号（sigtermExternal=false，仅按 git log 判产出）。
 */
export function cleanupOrphanWorktree(
  root: string,
  taskId: string,
  workerCmdlines: string[] | null = null,
  outcome: { finalState?: string | null; exitCode?: number | null } | null = null,
): OrphanCleanupResult {
  const paths = worktreePathsForTask(root, taskId);
  if (paths.length === 0) {
    return {
      removed: false, worktreePath: null, branchDeleted: false, error: null, skippedLiveWorker: false,
      hasCommits: null, preservedForCommits: false, sigtermExternal: false,
    };
  }
  const live = workerCmdlines ?? enumerateLiveWorkerCmdlines();
  if (hasLiveWorkerForTask(taskId, live)) {
    return {
      removed: false, worktreePath: paths[0] ?? null, branchDeleted: false, error: null, skippedLiveWorker: true,
      hasCommits: null, preservedForCommits: false, sigtermExternal: false,
    };
  }
  // 判产出（AC1）：零提交 ⇒ 清；有提交 ⇒ 保留；读不懂 ⇒ fail-closed 保留（⛔ 不得当「零提交」清掉）。
  const hasCommits = taskBranchHasCommits(root, taskId);
  const sigtermExternal = (outcome?.finalState ?? null) === "failed" && isSigtermExitCode(outcome?.exitCode ?? null);
  if (hasCommits !== false) {
    // hasCommits === true（有提交）⇒ 保留；=== null（读不懂）⇒ 保留但不声称「有提交」。
    return {
      removed: false, worktreePath: paths[0] ?? null, branchDeleted: false, error: null, skippedLiveWorker: false,
      hasCommits, preservedForCommits: hasCommits === true, sigtermExternal,
    };
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
  return {
    removed, worktreePath: paths[0] ?? null, branchDeleted, error, skippedLiveWorker: false,
    hasCommits, preservedForCommits: false, sigtermExternal,
  };
}

/** verified 态的证据载体：status 已读为 "done"、worktree 已确认无残留。 */
export interface LandingEvidence {
  status: "done";
  worktreePresent: false;
}

/** `landedSha` 是否为 `branch`（缺省 develop）的 tip 或祖先（`git merge-base --is-ancestor`）。
 *  D5：机械 fan-in 落地后，落地判定从 ff 结果派生——读【正确的】独立量（git develop 状态），
 *  ⛔ 不再读主检出工作分支的 `tasks/*.md`（主检出停 doc-only 分支 = 合法滞后，读它 ⇒ 假 not-landed）。
 *  git 读失败（非 git 仓库 / 对象不存在 / rev-parse 失败）⇒ null（读不懂 ≠ 非祖先）。 */
export function isShaAncestorOfBranch(root: string, sha: string, branch: string = "develop"): boolean | null {
  const tip = spawnSync("git", ["-C", root, "rev-parse", branch], { encoding: "utf8" });
  if (tip.status !== 0 || tip.error || !(tip.stdout ?? "").trim()) return null;
  const r = spawnSync("git", ["-C", root, "merge-base", "--is-ancestor", sha, (tip.stdout ?? "").trim()], { encoding: "utf8" });
  if (r.error) return null;
  return r.status === 0;
}

/** 落地判定（AC1 判据），经 AC153 单一不变式 verifyIndependently 表达成 DriverResult（⛔ 不信
 *  exitCode，读任务侧独立直接量）。两态输入：
 *   - `landedSha`（机械 fan-in 落地后传入）= ff 结果的落地 sha ⇒ 判定从 ff 结果派生
 *     （landedSha 是 develop tip/祖先 ∧ 无残留 worktree），⛔ 不读 readTaskStatus（D5）；
 *   - `landedSha` null（未跑机械 fan-in / red / 旧路径）⇒ 沿用 status-based 判定（status=done ∧ 无残留）。
 * 三态（证伪优先）：
 *   verified      = 落地判据证实（独立判据证实落地）
 *   failed        = 任一独立量证伪（⛔ 不需读全另一量）
 *   not-evaluated = 既未证真也未证伪（读不懂，⛔ 不伪造成 failed）
 * 下游 computeOutcome 把 verified→completed、failed/not-evaluated→exited-not-landed（fail-closed 朝
 * 「未完成」，但保留 reason 区分「证伪」与「未评估」）。 */
export function computeLandingState(root: string, taskId: string, landedSha: string | null = null): DriverResult<LandingEvidence> {
  const worktreePresent = worktreePresentForTask(root, taskId);

  // D5：机械 fan-in 落地后，判定从 ff 结果派生（读 git develop 状态，⛔ 非主检出工作分支的 tasks/*.md）。
  if (landedSha != null && landedSha !== "") {
    const ancestor = isShaAncestorOfBranch(root, landedSha);
    const failedParts: string[] = [];
    if (ancestor === false) failedParts.push(`landedSha ${landedSha} is not develop tip/ancestor`);
    if (worktreePresent === true) failedParts.push(`leftover worktree task/${taskId} still present`);
    return verifyIndependently(
      {
        value: { status: "done", worktreePresent: false },
        verifiedBy: "landedSha is develop tip/ancestor ∧ no leftover worktree (ff-result-derived, ⛔ not stale main-checkout status)",
        failedReason: failedParts.join(" and "),
        notEvaluatedReason:
          ancestor === null
            ? "landedSha ancestry unreadable (git merge-base failed)"
            : "worktree state unreadable (git worktree list failed)",
      },
      () => {
        // 证伪优先：landedSha 不在 develop 历史 / 残留 worktree，任一证伪 ⇒ failed。
        if (ancestor === false) return false;
        if (worktreePresent === true) return false;
        // 证真：landedSha 是 develop tip/祖先 ∧ 确认无残留。
        if (ancestor === true && worktreePresent === false) return true;
        // 读不懂（ancestor 或 worktree 读不到，且未证伪）⇒ not-evaluated。
        return null;
      },
    );
  }

  const status = readTaskStatus(root, taskId);
  return verifyIndependently(
    {
      value: { status: "done", worktreePresent: false },
      verifiedBy: "task status=done ∧ no leftover worktree (independent task-side read)",
      failedReason: landingFailedReason(status, worktreePresent, taskId),
      notEvaluatedReason:
        status === null
          ? "task status unreadable (task file missing or unreadable)"
          : "worktree state unreadable (git worktree list failed)",
    },
    () => {
      // 证伪优先：任一独立量可读且证伪 ⇒ failed（⛔ 不等另一量）。
      if (status !== null && status !== "done") return false; // status 可读且 ≠ done
      if (worktreePresent === true) return false; // 残留 worktree
      // 证真：status=done ∧ 确认无残留。
      if (status === "done" && worktreePresent === false) return true;
      // 读不到（status 或 worktree 读不到，且未证伪）⇒ not-evaluated（⛔ 不伪造成 failed）。
      return null;
    },
  );
}

/** 证伪理由（独立判据证伪落地时用：status≠done 或 残留 worktree，逐条拼）。 */
function landingFailedReason(status: string | null, worktreePresent: boolean | null, taskId: string): string {
  const parts: string[] = [];
  if (status !== null && status !== "done") parts.push(`task status=${status} (not done)`);
  else if (status === null) parts.push("task status unreadable");
  if (worktreePresent === true) parts.push(`leftover worktree task/${taskId} still present`);
  return parts.join(" and ");
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

// liveness 检查（gap-resident-driver-stable-carrier-liveness Finding）已上收 driver-runtime.ts
// （Layer 0 · liveness）：defaultLivenessCheckArgv / runLivenessCheck / runLivenessCheckAsync /
// LivenessResult / LIVENESS_CHECK_TIMEOUT_MS / runAsync 全部经 import 消费（⛔ 不各写一遍存活判定）。
// 单一真相源从「bash promotion-driver-launch.sh liveness」改为「node driver-runtime.ts liveness」——
// supervisor 港进 TS 后 liveness 子命令随 kernel 一起（AC151）。

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
  /** 本轮现观测到的冷启动在飞 task id（排序后）。空数组 = 观测过且无（⛔ 与「没观测」可区分）。 */
  coldStartInflight: string[];
  /** 本轮 markNeedsHuman 翻转的结果（含 committed——gap-mark-needs-human-commit-after-write：翻转写盘
   *  即提交，committed=false 表示 repo-less no-op / 提交失败，可观测非静默）。缺省 = 本轮无翻转。 */
  needsHuman?: Array<{ id: string; ok: boolean; committed: boolean; reason: string }>;
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
    cold_start_inflight: opts.coldStartInflight,
    needs_human: (opts.needsHuman ?? []).map((n) => n.id),
    needs_human_committed: (opts.needsHuman ?? []).map((n) => ({ id: n.id, committed: n.committed })),
  };
}

/** 把一条 round 记录追加写入指定文件（mkdir -p + appendFileSync，一行一 JSON，⛔ 不截断不覆盖）。 */
export function appendRoundToFile(file: string, record: ReturnType<typeof computeWorkerRoundRecord>): string {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, JSON.stringify(record) + "\n", "utf8");
  return file;
}

/** worker 命令覆盖的两个旋钮（AC140-3 覆盖语义统一）：prefix = 前缀（prompt 追加）；exact = 整体替换（测试专用）。 */
export interface WorkerCmdOptions {
  prefix: string | null;
  exact: string | null;
}

/** fan-in 归属说明（gap-fan-in-driver-mechanical-orchestration）：worker 只实现、实现后退出，
 *  driver 接手 worktree 机械跑 fan-in（锁/merge/delta/typecheck/scoped门/suite/ff）——worker 不再自己
 *  跑 suite、也不再以 scriptPath 调 fan-in-execute workflow（那套「子代理串行跑机械步骤」被 driver 取代，
 *  只作机械失败的语义兜底）。创建 prompt 与续做 prompt 共用（步骤序号由调用方填）。 */
function driverFanInNote(): string {
  return [
    `exit — the worker-driver takes over your worktree and mechanically runs fan-in`,
    `(merge develop → delta 判定 → typecheck → archguard结构闸 → scoped门 → suite → ff) to develop.`,
    `You do NOT run the suite and do NOT call the fan-in workflow yourself.`,
  ].join(" ");
}

/** dispatch-worktree-setup.sh 调用签名（gap-dispatch-worktree-setup-zero-production-callers）：每个
 *  被派发的 worktree 创建后【必须】跑一次（node_modules symlink-or-install + config.yml 经
 *  worktree-include.sh），机制接管 bootstrap——worker 不再手工 `ln -s`/`cp config.yml`（正是该脚本被
 *  写出来要消灭的 AGENT-REMEMBERING 失败模式）。脚本幂等：已 provision 的 worktree 重跑是 no-op。 */
function dispatchSetupSignature(root: string, worktree: string): string {
  const setupScript = path.join(root, "plugin", "scripts", "dispatch-worktree-setup.sh");
  return `bash ${setupScript} ${worktree}`;
}

/** 创建 prompt（无保留 worktree 时的 implement-only prompt，单一真相源）。续做 prompt 见
 *  buildContinueWorkerPrompt；两者由 workerPromptForTask 按「保留 worktree 在不在」择一。
 *  gap-fan-in-driver-mechanical-orchestration：worker 只实现、实现后退出（⛔ 不自己跑 suite / 不调
 *  fan-in workflow），driver 接手 worktree 机械跑 fan-in——取代旧「worker 以 scriptPath 调
 *  fan-in-execute workflow 子代理」的全链式 prompt（fanInSignature 已退役）。 */
export function buildWorkerPrompt(task: string, root: string): string {
  return [
    `You are a per-task worker in the quay repo (SPEC-worker-driven-inner §5 阶段 2).`,
    `Task: ${task}. Repo root: ${root}.`,
    `Run the implementation chain: (1) create an isolated git worktree for ${task}, then immediately`,
    `provision it by running \`${dispatchSetupSignature(root, "<the worktree path you created in step 1>")}\``,
    `(node_modules symlink-to-main + config.yml via worktree-include — the mechanism, not agent-remembering);`,
    `(2) implement the task per its Proposal/Plan/AC/DoD, committing your implementation on the task branch;`,
    `(3) ${driverFanInNote()}`,
    `⚠️ CRITICAL: every Read/Edit/Write file_path MUST be the absolute path of the worktree you created in step 1 — never the main-checkout path \`${root}\`, never a relative path. Claude Code's file tools use absolute paths and do NOT sense shell \`cd\`; a main-checkout or relative path lands your implementation in the develop shared checkout, not your worktree.`,
    `You own your worktree fully; apart from the final merge (done by the driver) do not touch develop.`,
  ].join(" ");
}

/** 按覆盖旋钮解析一个 task 的 worker argv（单一构造 + AC140-3 覆盖语义统一）：
 *  exact 非空 ⇒ 整体替换（--worker-cmd-exact，测试捕获/注入专用，prompt 不进 argv 是预期）；
 *  否则 prefix 非空 ⇒ 前缀 + prompt（--worker-cmd，wrapper/测试前缀可用，prompt 作为末参数追加）；
 *  否则 ⇒ launchArgv("task-worker", prompt)（配置承载的缺省，经 policy 解析 kind → profile）。 */
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

/** 缺省 worker 命令：launchArgv("task-worker", <full-chain prompt>)（argv 形，child 即 worker，超时
 *  SIGTERM 杀得准）。launcher/model/--bare 由 `.quay/profiles.yml` 的 profiles/roles 承载（AC140-2 可配，
 *  L3 经 profile-policy.ts 解析）。prompt（创建 + 续做）都走 driverFanInNote——worker 只实现后退出、
 *  ⛔ 永不自己以 scriptPath 调 fan-in-execute workflow（机械 fan-in 由 driver 接手；语义兜底归 driver
 *  按 red step 决定）⇒ A6「检查 fan-in 是否走 workflow」退役（SPEC §5 阶段 2 退役清单②）。 */
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
 *  驱动在主检出跑、仍停在 develop（不 checkout、不 stash，见 gap-worker-driver-stashifdirty-stashes-
 *  others-uncommitted））。git 失败 / 分支不存在 ⇒ null（读不懂 ≠ 0 提交）。 */
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

/** countBranchCommits 的异步版（常驻循环体用——⛔ spawnSync git 会冻住协调地板）。语义一致：
 *  git 失败 / 分支不存在 ⇒ null（读不懂 ≠ 0 提交）。 */
export async function countBranchCommitsAsync(root: string, taskId: string): Promise<number | null> {
  const r = await runAsync(["git", "-C", root, "rev-list", "--count", `HEAD..task/${taskId}`], { timeoutMs: 5_000 });
  if (r.error || r.status !== 0) return null;
  const out = r.stdout.trim();
  if (out === "") return 0;
  const n = Number(out);
  return Number.isFinite(n) ? n : null;
}

/** branchHeadSubject 的异步版（常驻循环体用）。无自己的提交 / 读失败 ⇒ null。 */
export async function branchHeadSubjectAsync(root: string, taskId: string): Promise<string | null> {
  const r = await runAsync(["git", "-C", root, "log", "-1", "--format=%s", `HEAD..task/${taskId}`], { timeoutMs: 5_000 });
  if (r.error || r.status !== 0) return null;
  const out = r.stdout.trim();
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

/** continueStateForTask 的异步版（常驻循环体用——⛔ spawnSync git 会冻住协调地板）。语义一致：
 *  无 worktree（worktreePresentForTaskAsync 非 true）⇒ null（创建路径）；worktree 读不懂（null）⇒ null
 *  （创建，与「确认无残留」同向）。/proc 与任务文件读仍是同步 fs（廉价，task 4 只点名 git，不点名 /proc）。 */
export async function continueStateForTaskAsync(root: string, taskId: string): Promise<ContinueWorkerState | null> {
  if ((await worktreePresentForTaskAsync(root, taskId)) !== true) return null;
  const paths = await worktreePathsForTaskAsync(root, taskId);
  const ac = readAcCheckState(root, taskId);
  return {
    worktreePath: paths[0] ?? null,
    branchCommits: await countBranchCommitsAsync(root, taskId),
    branchHeadSubject: await branchHeadSubjectAsync(root, taskId),
    acChecked: ac.checked,
    acTotal: ac.total,
    failureReason: lastExitedNotLandedReason(root, taskId),
  };
}

/** 冲突消解协议（gap-continue-prompt-conflict-resolution-protocol）：机械 fan-in 的 merge develop 步
 *  在 CONTINUE 轮撞冲突时，旧 prompt 只带失败原因、不含消解指令 ⇒ 消冲突靠 worker 自行发挥（运气）。
 *  本段按文件类型分派消解动作：derived 文件重算（⛔ 不手并计数）、code 文件取语义并集、然后
 *  `git commit --no-edit` 完成 merge——⛔ 禁止带着 unmerged paths（UU）退出，否则下一轮 fan-in 的
 *  merge step 再失败。 */
function continueConflictResolutionNote(): string {
  return [
    `CONFLICT RESOLUTION — if the prior mechanical fan-in left the worktree with unmerged paths (UU in \`git status\`), or \`git merge develop\` reports CONFLICT, resolve it BEFORE continuing implementation; ⛔ never exit while unmerged paths remain (the next fan-in merge step would fail again).`,
    `(1) derived files (docs/proposals/quay-product-outline.md §6 DELIVERY-INVENTORY counts — mechanically derived): apply your own change, then re-run \`node --experimental-strip-types plugin/scripts/verify-delivery-surface.ts --write-inventory\` to recompute the counts; ⛔ do NOT hand-merge the counts.`,
    `(2) code files (e.g. worker-driver.ts): read both sides of the diff and take the semantic union of the two changes (keep both changes where they do not conflict).`,
    `(3) \`git add <resolved files>\` then \`git commit --no-edit\` to complete the merge.`,
  ].join(" ");
}

/** 续做 prompt（AC1/AC2）：复用已有 worktree（⛔ 不 create，create 撞已存在对象 fatal），并携带前一轮
 *  状态（分支提交 / AC 勾选 / 失败原因）供 worker 从保留 worktree 继续。⛔ 不含 "create an isolated
 *  git worktree"（AC1 取假判据——旧 prompt 逐字说 create 是撞死根因）。
 *  gap-fan-in-continue-prompt-not-migrated-to-mechanical：续做同样用 driverFanInNote()（worker 实现后
 *  退出、driver 接手机械跑 fan-in），⛔ 不再写 fanInSignature（旧 workflow 兜底签名——worker 永不自己
 *  调 fan-in-execute workflow；语义兜底是 driver 按机械 red step 的决定，不再写进下一轮 worker 的 prompt）。 */
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
    `${continueConflictResolutionNote()}`,
    `Re-provision the existing worktree first (idempotent, no-op if already set up): \`${dispatchSetupSignature(root, wt)}\`.`,
    `Run the remaining chain in the existing worktree: (1) continue implementing per the task's`,
    `Proposal/Plan/AC/DoD (⛔ do not redo the ${commits} commits already on the branch),`,
    `(2) ${driverFanInNote()}.`,
    `⚠️ CRITICAL: every Read/Edit/Write file_path MUST be the worktree absolute path ${wt} — never the main-checkout path \`${root}\`, never a relative path. Claude Code's file tools use absolute paths and do NOT sense shell \`cd\`; a main-checkout or relative path lands your change in develop, not your worktree.`,
    `You own this worktree fully; apart from the final merge do not touch develop.`,
  ].join(" ");
}

/** 派发前选 prompt：保留 worktree 在 ⇒ 续做 prompt，无 ⇒ 创建 prompt。单一决策点——显式批量派发
 *  （runTask）与常驻选择环（spawnSelected）都经 workerArgvForTask 走到这里。 */
export function workerPromptForTask(task: string, root: string): string {
  const state = continueStateForTask(root, task);
  return state != null ? buildContinueWorkerPrompt(task, root, state) : buildWorkerPrompt(task, root);
}

/** workerPromptForTask 的异步版（常驻循环体用——⛔ 同步版经 continueStateForTask 走 spawnSync git 会冻住
 *  协调地板）。保留 worktree ⇒ 续做 prompt，无 ⇒ 创建 prompt。 */
export async function workerPromptForTaskAsync(task: string, root: string): Promise<string> {
  const state = await continueStateForTaskAsync(root, task);
  return state != null ? buildContinueWorkerPrompt(task, root, state) : buildWorkerPrompt(task, root);
}

/** workerArgvForTask 的异步版（常驻循环体用）：覆盖语义同同步版（exact > prefix > 缺省 launchArgv），
 *  prompt 经 workerPromptForTaskAsync 取（⛔ 同步版走 continueStateForTask 的 spawnSync git）。 */
export async function workerArgvForTaskAsync(task: string, root: string, opts: WorkerCmdOptions = { prefix: null, exact: null }): Promise<string[]> {
  const prompt = await workerPromptForTaskAsync(task, root);
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

/** 常见信号的 shell 惯例退出码（128+signum）；未知信号给 0（被杀本身已是非零）。 */
export function signalExitCode(signal: string): number {
  const map: Record<string, number> = { SIGHUP: 1, SIGINT: 2, SIGQUIT: 3, SIGKILL: 9, SIGTERM: 15 };
  return map[signal] ?? 0;
}

/**
 * 并发上限（AC116 阶段 2 ①）：显式 N 优先 → 声明式配置 cap（driver-config 单一真相源，AC155——
 * ⛔ 不再读 QUAY_MAX_TASK_SUBAGENTS env）→ 任务数（无字面量，不依赖宿主规格）。驱动数自己的
 * 子进程，达 cap 则等一个结束再起下一个。`configCap` = 调用方经 driverCap(root,"worker") 现读的
 * drivers.yml cap（纯函数，不自己碰 fs/env）。
 */
export function resolveConcurrency(
  explicit: number | undefined,
  taskCount: number,
  configCap?: number,
): number {
  if (explicit != null && Number.isInteger(explicit) && explicit >= 1) return explicit;
  if (configCap != null && Number.isInteger(configCap) && configCap >= 1) return configCap;
  return Math.max(1, taskCount);
}

/** 解析 --timeout <ms>（毫秒）。缺省/非法 → 0 = 无超时（SPEC §4④ 先无阈值）。 */
export function parseTimeoutMs(raw: string | undefined): number {
  if (raw == null) return 0;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

/** 解析 --interval <ms>（常驻循环无在飞 worker 且瞬时 WAIT 时的轮询间隔）。缺省 = drivers.yml 的
 *  interval_ms（root 缺省时回退 RESIDENT_INTERVAL_MS_DEFAULT 常量）；非法（非有限 / 负数）⇒ 缺省
 *  （⛔ 不因 flag 拼写炸常驻循环）。 */
export function parseIntervalMs(raw: string | undefined, root?: string): number {
  const def = root ? loadDriverConfig(root).worker.intervalMs : RESIDENT_INTERVAL_MS_DEFAULT;
  if (raw == null) return def;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : def;
}

/** 解析 --reconcile-interval <s>（秒，协调地板周期）。缺省 = drivers.yml 的 reconcile_interval_secs
 *  （root 缺省时回退 RECONCILE_INTERVAL_SECS_DEFAULT 常量，保守）；非法（非有限 / 负数）⇒ 缺省
 *  （⛔ 不因 flag 拼写炸常驻循环）。返回毫秒（内部统一用 ms）。 */
export function parseReconcileIntervalSecs(raw: string | undefined, root?: string): number {
  const def = root ? loadDriverConfig(root).worker.reconcileIntervalSecs : RECONCILE_INTERVAL_SECS_DEFAULT;
  if (raw == null) return def * 1000;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) * 1000 : def * 1000;
}

/** 解析 --max-retries <n>（重试上限，gap-worker-driver-retry-cap-not-wired）。缺省 RETRY_CAP_DEFAULT
 *  （与 promotion 的 --max-fix-retries 同值单一真相源）；非法（非正整数）⇒ 缺省（⛔ 不因 flag 拼写
 *  炸常驻循环——与本文件其它 parse* 助手的 fail-to-default 约定一致）。 */
export function parseMaxRetries(raw: string | undefined): number {
  if (raw == null) return RETRY_CAP_DEFAULT;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 1 ? n : RETRY_CAP_DEFAULT;
}

/** 一次「主检出脏状态观察 + stash 决策」的结果（gap-worker-driver-stashifdirty-stashes-others-
 *  uncommitted AC1：stashed 恒 false——驱动【不】stash 共享主检出；files 列出观察到的脏文件供观测，
 *  与「检出干净」的 files=[] 区分）。⛔ 绝不 discard。 */
export interface StashResult {
  stashed: boolean;
  files: string[];
  error: string | null;
}

/**
 * 主检出脏状态归属检查（gap-worker-driver-stashifdirty-stashes-others-uncommitted AC1）：驱动【不】
 * stash 主检出的任何未提交改动。归属判据是结构性的、非逐路径猜：驱动自己的写入全在 .quay/
 * （gitignored）⇒ 主检出上【可被 `git stash --include-untracked` 卷走的】脏改动（tracked 未提交 +
 * untracked 非忽略）一律属 manager/outer，stash 它们 = 卷走他人工作（本缺陷）。故本函数只观察、
 * 恒不 stash（stashed=false），files 仍列出脏文件（供 --json 观测：驱动看见了脏、但正确地不碰）。
 * ff 前的干净判据由 fan-in-ff-merge.sh 自持（含 promotion status-flip 自动收敛），非驱动代劳。
 * 非 git 仓库 ⇒ no-op（阶段 1 测试的临时目录不是仓库）。⛔ 不 discard（不做 checkout -- . /
 * reset --hard / clean）。
 */
export function stashIfDirty(root: string): StashResult {
  const inRepo = spawnSync("git", ["-C", root, "rev-parse", "--is-inside-work-tree"], { encoding: "utf8" });
  if (inRepo.status !== 0) return { stashed: false, files: [], error: null };
  const before = spawnSync("git", ["-C", root, "status", "--porcelain"], { encoding: "utf8" });
  if (before.status !== 0) return { stashed: false, files: [], error: (before.stderr || "").trim() || "git status failed" };
  const files = String(before.stdout ?? "").split("\n").map((s) => s.trim()).filter(Boolean);
  // 有脏改动也【不】stash——它们不属于驱动。stashed 恒 false；files 供观测（⛔ 不碰这些文件）。
  return { stashed: false, files, error: null };
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
    session_id: null, // 未 spawn ⇒ 无 transcript 会话（诚实 null，⛔ 不伪造成「有会话」）
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
 * 生成一个 transcript session id（UUID v4）。gap-worker-task-transcript-access-webui AC1：每次派发
 * （每尝试非每任务）生成【新】UUID——同任务重派 N 次有 N 个不同 session_id ⇒ 每次尝试的 transcript
 * 可逐次访问。独立成函数供测试直接调用（⛔ 不内联 randomUUID 让「每次新」无处可验）。
 */
export function newSessionId(): string {
  return randomUUID();
}

/**
 * spawn 一个 worker 并等待其终态（含超时 SIGTERM）。超时 ⇒ kill("SIGTERM")，close 事件带 signal=SIGTERM，
 * timedOut 标记落 outcome final_state=timed-out（worktree_preserved=true，⛔ 不清理——SPEC §1 设计点3
 * 超时保留 worktree）。其它异常死亡终态（failed/killed——worker 没跑完、无完成实现）清理 orphan
 * worktree（gap-worker-driver-no-record-on-abnormal-death AC2）；⛔ exited-not-landed（exit 0 但没落地，
 * 含 needs-human 闸拒绝）保留分支/worktree 供续做（gap-worker-needs-human-destroys-branch-worktree AC1）。
 *
 * gap-worker-task-transcript-access-webui AC1：每次尝试生成新 session_id 并落盘 outcome；spawn 时把
 * `--session-id <uuid>` 追加进 argv（launchArgv 已直接出 argv，--session-id 作为末参数追加给 claude
 * ⇒ transcript 落 `~/.claude/projects/<slug>/<uuid>.jsonl`）。⛔ `--worker-cmd-exact` 测试缝（`node -e …`/`sleep` 等
 * 假命令）不追加（假命令不接受该 flag，追加会误杀全部既有测试）——但 session_id 仍生成并落盘
 * （AC1 的「每行有 session_id」对测试缝同样成立，只是不进 argv）。
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
  sessionId = newSessionId(),
  injectSessionId = true,
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
  sessionId?: string;
  injectSessionId?: boolean;
}): Promise<WorkerRunResult> {
  const argv = injectSessionId ? [...workerArgv, "--session-id", sessionId] : workerArgv;
  return new Promise((resolve) => {
    const [cmd, ...cmdArgs] = argv;
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

    const finish = (code: number | null, signal: string | null, spawnErr: string | null, mechResult: MechanicalFanInResult | null = null) => {
      if (finished) return;
      finished = true;
      if (timer) clearTimeout(timer);
      const endedAtMs = Date.now();
      // gap-worker-driver-fake-completion-exit-0：写终态前读一次任务侧直接量。机械 fan-in 落地后
      // （mechResult.outcome=landed）落地判定从 ff 结果（landedSha）派生，⛔ 不读主检出 stale status
      // （D5：主检出停 doc-only 工作分支 ⇒ readTaskStatus 是滞后视图 ⇒ 假 exited-not-landed）；未跑机械
      // fan-in / red 时仍走 status-based 判定。spawn-failed/killed/timed-out/failed 分支在 computeOutcome
      // 里优先于 landed，但统一读一次无害（廉价 fs/git 调用）。
      const landing = computeLandingState(
        rootDir,
        taskId,
        mechResult?.outcome === "landed" ? mechResult.landedSha : null,
      );
      // gap-suite-lock-starvation-long-validation-hold AC2 — read the suite's flock metrics from the
      // verification-round ledger (matched by this worker's runId) so worker-outcome.jsonl can
      // distinguish「长时间持锁」from「worker 慢」. Absent (null) on doc-only / scoped / no-record runs.
      const lockMetrics = readLockMetricsForRun(rootDir, runId, taskId);
      const outcome = computeOutcome({
        task: taskId, selectorReason, exitCode: code, signal,
        startedAtMs, endedAtMs, workerPid, runId,
        spawnError: spawnErr, inFlightCount, timedOut,
        // AC153：DriverResult → computeOutcome 的 landed 三态。verified ⇒ landed=true；failed ⇒
        // landed=false + 证伪 reason；not-evaluated ⇒ landed=null（读不懂，computeOutcome 的 landed
        // 缺省分支即「未评估」措辞，⛔ 与「证伪」区分）。
        landed: landing.state === "verified" ? true : landing.state === "failed" ? false : null,
        landReason: landing.state === "verified" ? null : landing.reason,
        sessionId,
        lockWaitMs: lockMetrics.lockWaitMs,
        lockHoldMs: lockMetrics.lockHoldMs,
      });
      // gap-worker-driver-no-record-on-abnormal-death（AC2，能取假）：worker 异常死亡（failed/killed——
      // worker 没跑完、无完成实现）后，orphan worktree 永久残留会挡 driver 下轮对同一 task 的
      // `git worktree add`。写终态的同时清理（⛔ completed/spawn-failed/not-dispatched 无 worktree 可清；
      // spawn-failed 连 worker 都没起，not-dispatched 连派发都没派）。⛔ exited-not-landed 同样不清理
      // ——那是 exit 0 跑到 fan-in 底但没落地（needs-human 闸拒绝 = 套件绿 + 实现完成，工作有效），
      // 分支/worktree 保留供续做，销毁会让完成实现永久丢失（gap-worker-needs-human-destroys-branch-
      // worktree AC1）。⛔ timed-out 是唯一例外（gap-worker-print-bg-wait-ceiling-600s AC3）：超时
      // 【保留 worktree】（SPEC §1 设计点3「超时即杀 worker 会话，但保留 worktree」），不清理——落
      // worktree_preserved=true。清理结果落进 outcome（worktree_cleaned / worktree_cleanup_error）供观测。
      const shouldCleanup =
        outcome.final_state !== "completed" &&
        outcome.final_state !== "exited-not-landed" &&
        outcome.final_state !== "spawn-failed" &&
        outcome.final_state !== "not-dispatched" &&
        outcome.final_state !== "timed-out";
      const cleanup = shouldCleanup
        ? cleanupOrphanWorktree(rootDir, taskId, null, { finalState: outcome.final_state, exitCode: outcome.exit_code })
        : null;
      // 机械 fan-in 结果落进 outcome（gap-fan-in-driver-mechanical-orchestration）：driver 接手 worktree
      // 跑机械 fan-in 的观测面（锁持有时长 / suite outcome / 落地 sha），⛔ 只在真跑过时非 null。
      const baseOutcome = mechResult ? { ...outcome, mechanical_fan_in: mechResult } : outcome;
      const finalOutcome = cleanup
        ? {
            ...baseOutcome,
            worktree_cleaned: cleanup.removed,
            worktree_cleanup_error: cleanup.error,
            worktree_cleanup_skipped_live: cleanup.skippedLiveWorker,
            worktree_cleanup_has_commits: cleanup.hasCommits,
            worktree_cleanup_preserved_commits: cleanup.preservedForCommits,
            worktree_cleanup_sigterm_external: cleanup.sigtermExternal,
          }
        : baseOutcome.final_state === "timed-out"
          ? { ...baseOutcome, worktree_preserved: true }
          : baseOutcome;
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

    // 机械 fan-in 接线（gap-fan-in-driver-mechanical-orchestration）：worker 只实现（prompt 要求实现后
    // 退出，⛔ 不自己跑 suite/ff），driver 在 worker exit 0 且 worktree 存在时【接手 worktree 跑机械
    // fan-in】——happy-path 机械跑通（锁/merge/delta/typecheck/scoped门/suite/ff）；失败（red）回退旧
    // workflow 子代理兜底（本函数不调 LLM，失败即按 exited-not-landed 保留 worktree 供续做/回退）。
    // 计算 landing 前先跑机械 fan-in ⇒ 成功则 landing=completed（status=done ∧ 无残留 worktree）。
    const finishAsync = async (code: number | null, signal: string | null, spawnErr: string | null): Promise<void> => {
      if (finished) return;
      let mechResult: MechanicalFanInResult | null = null;
      if (code === 0 && !spawnErr) {
        const paths = worktreePathsForTask(rootDir, taskId);
        if (paths.length > 0 && paths[0]) {
          const startMechMs = Date.now();
          mechResult = await runMechanicalFanIn({ task: taskId, worktree: paths[0], root: rootDir, runId });
          if (json) {
            process.stdout.write(
              `${JSON.stringify({ event: "mechanical-fan-in", task: taskId, wall_clock_ms: Date.now() - startMechMs, ...mechResult })}\n`,
            );
          }
          // D5：落地判定改从 ff 结果（mechResult.landedSha）派生 ⇒ 不再需要 syncDocBranchToDevelop
          // 把 develop merge 进 doc-only 工作分支（那是一个 best-effort + 静默 catch 的补丁，冲突即假
          // exited-not-landed）——该补丁随 D5 退役，finish() 里 computeLandingState 直接读 landedSha。
        }
      }
      finish(code, signal, spawnErr, mechResult);
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
      void finishAsync(code, s ?? null, spawnError);
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

// ── 机械 fan-in（gap-fan-in-driver-mechanical-orchestration / SPEC 2026-08-27）────────────────────
// 取消 fan-in-execute.js workflow 子代理串行跑机械步骤（每条命令间 ~3-5min 模型延迟把 ~10min 机械活
// 撑到 ~30min + 30min watchdog 强制释放），改由 driver 机械驱动 fan-in 的机械部分
// （锁/merge/delta/typecheck/archguard结构闸/scoped门/suite/ff）。happy-path 先做（人 2026-08-27 裁定①）：driver 跑通
// 「无失败 fan-in」，失败回退旧 workflow 子代理兜底。四判据：
//   AC1 锁时长塌缩——driver 持锁整段 merge→suite→ff，机械时长（非 30min 模型恒值）；
//   AC2 锁罩住 suite——release 不早于 suite 结束（driver 在 spawnSuiteAndWait 返回后才 release）；
//   AC3 无 detach——suite 是 driver 子进程（spawn+wait，ppid 指向 driver，⛔ setsid+&+disown 孤儿）；
//   AC4 ff-race 归零——锁罩住 merge→suite→ff 整段 ⇒ develop 在持锁期间不前进。

/** 一次机械 fan-in 的选项（suite 命令/锁路径/日志/静默阈值是测试缝）。 */
export interface MechanicalFanInOptions {
  task: string;
  worktree: string;
  root: string;
  runId: string;
  mergeTarget?: string;
  /** suite 命令（测试缝）；缺省 = bash <worktree>/scripts/test.sh --buckets <task>。 */
  suiteCommand?: string[];
  /** suite 单飞槽 base（测试缝）；缺省 = suiteLockBase(root)。 */
  slotBase?: string;
  /** suite-slot-lib.sh 路径（测试缝）；缺省 = <root>/plugin/scripts/suite-slot-lib.sh。 */
  slotLib?: string;
  /** 静默看门狗阈值（测试缝）。 */
  silenceMs?: number;
  /** suite 日志（静默看门狗盯的）；缺省 /tmp/fan-in-suite-<task>.log。 */
  suiteLogFile?: string | null;
  /** suite capture（ff 闸读的证书）；缺省 /tmp/fan-in-suite-<task>.env。 */
  suiteCapture?: string;
  /** 强制跑 suite（跳过 doc-only 判定；测试缝）。 */
  forceSuite?: boolean;
  /** scoped 门命令（测试缝）；缺省 = bash <worktree>/scripts/test.sh --for-task <task> --allow-thin。 */
  scopedGateCommand?: string[];
  /** doc 检查命令（测试缝）；缺省 = bash <worktree>/scripts/test.sh --static-checks-doc。 */
  docCheckCommand?: string[];
  /** archguard 结构闸命令（测试缝）；缺省 = node archguard-runner.ts --root <worktree>（分析待落地代码）。 */
  archguardCommand?: string[];
  /** fan-in 编排脚本目录（测试缝）；缺省 = <worktree>/plugin/scripts（自举：本分支的编排脚本自验）。 */
  scriptsDir?: string;
  /** 权威 suite 状态载体 full-suite-state.json 的路径（D7 测试缝）；缺省 = <root>/.quay/full-suite-state.json。 */
  suiteStateFile?: string;
}

/** 机械 fan-in 单步失败的【结构化 verdict】（D6）：⛔ 不再是 `(stderr||stdout).trim()` 裸流。
 *  step = 失败步骤、verdict = 该步判定（恒 "failed"，与 outcome=red 同向）、exitCode = 子进程退出码、
 *  summary = 去噪后的可读失败摘要（能定位「哪个测试失败」）、logFile = 裸流 dump 路径（记录留指针，
 *  ⛔ 不把裸流塞进 reason）。logFile=null 仅当该步无裸流（如 flip-done 的 reason 已结构化）。 */
export interface MechanicalFanInStepVerdict {
  step: string;
  verdict: "failed";
  exitCode: number | null;
  summary: string;
  logFile: string | null;
}

/** 机械 fan-in 的三态结果（landed / red）。not-evaluated 由调用方按「未落地」处理（硬规则 3b）。
 *  单步失败的富结构在 `verdict`（step/reason 是其投影，保持旧读面）。 */
export interface MechanicalFanInResult {
  outcome: "landed" | "red";
  /** 结构化 per-step verdict（outcome=red 时非 null；landed 时 null）。 */
  verdict: MechanicalFanInStepVerdict | null;
  /** 失败步骤名（= verdict.step；outcome=red 时非空，landed 时 null）。 */
  step: string | null;
  /** 失败原因（= verdict.summary，去噪后的摘要；outcome=red 时非空）。 */
  reason: string | null;
  /** fan-in workflow 锁持有时长（release epoch - acquire epoch，秒；读自 workflow-lock-events）。 */
  lockHoldSecs: number | null;
  /** 锁 acquire / release 的 epoch（秒）——AC2 判据（release ≥ suite 结束）的输入。 */
  lockAcquireEpoch: number | null;
  lockReleaseEpoch: number | null;
  /** suite 结束时刻（epoch 秒，仅真跑 suite 时非 null）。 */
  suiteFinishedEpoch: number | null;
  /** suite 三态 outcome（真跑时非 null）。 */
  suiteOutcome: SuiteOutcome | null;
  /** suite 子进程 pid（AC3 判据输入——ppid 指向 driver）。 */
  suitePid: number | null;
  /** 落地 sha（develop 被 ff 到的 tip；landed 时非 null）。 */
  landedSha: string | null;
}

/** runAsync 的结果收窄为「成/败 + 输出」，机械 fan-in 各步骤的共用判定（⛔ 不各写一遍 status!==0）。 */
interface MechShResult {
  ok: boolean;
  status: number | null;
  stdout: string;
  stderr: string;
  error: Error | null;
}

async function mechSh(argv: string[], timeoutMs = 120_000): Promise<MechShResult> {
  const r = await runAsync(argv, { timeoutMs, collectStderr: true });
  return { ...r, ok: r.status === 0 };
}

/** D6：从某步的 stdout+stderr 合并流里提取【可读失败摘要】——⛔ 裸流（MODULE_TYPELESS 噪声占满、
 *  ⛔ 丢真正测试结果）。去噪 + 保留失败信号行（node:test 的 not ok / ✖ / # fail、断言 expected/actual、
 *  anti-drift HARD FAIL、esbuild 的 Could not resolve / [ERROR] 构建失败），有界（最后 N 行 + 4000 字符）。
 *  裸流本身落进 logFile（fail dump），记录里留指针。提取不出任何行 ⇒ 空串（调用方回退 `exit <code>`）。
 *  gap-scoped-gate-reason-stderr-drops-stdout：scoped 门红时 stdout 的真失败（esbuild 构建崩 = Could not
 *  resolve）必须进 reason——⛔ stderr 良性 preamble 优先 || 短路丢弃 stdout（硬规则 3b/4b/9 同族）。
 *  esbuild 失败行加入 isSignal：即使与 TAP not ok 并存，构建失败签名也不再被 slice(-60) 尾截掉。 */
export function extractFailureSummary(combined: string): string {
  const isNoise = (l: string): boolean =>
    l.includes("MODULE_TYPELESS_PACKAGE_JSON") ||
    l.includes("Reparsing as ES module") ||
    l.includes("This incurs a performance overhead") ||
    l.includes("To eliminate this warning") ||
    l.includes('add "type": "module"') ||
    l.includes("--trace-warnings");
  const meaningful = combined.split("\n").filter((l) => l.trim() !== "" && !isNoise(l));
  const isSignal = (l: string): boolean =>
    /^\s*not ok\b|^\s*✖|\bFAIL\b|# fail\b|HARD FAIL|AssertionError|\bexpected:|\bactual:|\bfail \d+\b|\bexit=\d+|Could not resolve|\[ERROR\]/i.test(l);
  const signals = meaningful.filter(isSignal);
  const chosen = signals.length > 0 ? signals : meaningful;
  return chosen.slice(-60).join("\n").trim().slice(0, 4000);
}

/** 读 fan-in workflow 锁事件里本任务+runId 的持有时长（AC1/AC2 判据输入，纯文件读）。 */
export function readWorkflowLockHold(
  root: string,
  task: string,
  runId: string,
): { lockHoldSecs: number | null; lockAcquireEpoch: number | null; lockReleaseEpoch: number | null } {
  const file = path.join(root, ".quay", "fan-in-workflow-lock-events.jsonl");
  let text = "";
  try {
    text = fs.readFileSync(file, "utf8");
  } catch {
    return { lockHoldSecs: null, lockAcquireEpoch: null, lockReleaseEpoch: null };
  }
  let acquire: number | null = null;
  let release: number | null = null;
  for (const line of text.split("\n")) {
    const t = line.trim();
    if (!t) continue;
    let rec: { event?: unknown; taskId?: unknown; runId?: unknown; epoch?: unknown };
    try {
      rec = JSON.parse(t);
    } catch {
      continue;
    }
    if (rec.taskId !== task) continue;
    if (rec.runId !== runId) continue;
    if (typeof rec.epoch !== "number") continue;
    if (rec.event === "acquire") acquire = rec.epoch;
    else if (rec.event === "release") release = rec.epoch;
  }
  const lockHoldSecs = acquire !== null && release !== null ? Math.max(0, release - acquire) : null;
  return { lockHoldSecs, lockAcquireEpoch: acquire, lockReleaseEpoch: release };
}

// ── fan-in workflow 锁：driver 自身经非分离直接子进程持锁（ADR-034）────────────────────────────
// 废除 gap-fan-in-workflow-lock-and-S1 的「分离 holder + flag 文件释放」协议（fan-in-ff-merge.sh
// --acquire/--release-workflow-lock 里 `setsid bash … & disown` 的持锁进程 + `while [ -e flag ]` 死
// 循环 + 外部删 flag 释放）。该协议让持锁进程活得过它的 caller：caller 在 ff 后删 flag 前被杀 ⇒
// holder 孤儿化（PPID=1）+ 活着 ⇒ 死循环 ⇒ 锁持 23 分钟阻塞全仓 fan-in（gap-full-suite-lock-hold-
// watchdog-threshold-shorter-than-fan-in 末次实证）。ADR-034 裁定：锁的生死 = 工作的进程生死——锁由
// driver（受监督、可重启的常驻进程）经【非分离直接子进程】持有，释放只靠「持锁进程退出 → 内核自动关
// fd → flock 释放」一种机制，⛔ 不设任何时间阈值、⛔ 不依赖第三方外部信号（无 hold-max/TTL/stale）。
//
// 实现：driver spawn 一个【非 detached、非 disown】的 bash 子进程（holder）做 flock，然后阻塞在
// stdin 读上。driver 持有该子进程 stdin 管道的写端：driver 死（任何原因，含 SIGKILL）⇒ 内核关写端 ⇒
// holder 的 stdin 读到 EOF ⇒ 写 release 事件 + flock -u + 退出 ⇒ flock 自动释放。正常 release = driver
// 关 stdin 写端（同一路径）。锁文件/事件文件仍与旧协议同名同形（fan-in-workflow.lock /
// .quay/fan-in-workflow-lock-events.jsonl），fan-in-ff-protocol-check 判据4 与 readWorkflowLockHold
// 继续读同一载体。

/** fan-in workflow 锁文件路径（git common dir 下的 fan-in-workflow.lock，与 suite 锁同目录不同文件）。
 *  解析 git-common-dir（⛔ 不读 FULL_SUITE_LOCK_FILE env——那是 suite 锁的 seam，不属于 workflow 锁）。 */
export function fanInWorkflowLockFile(root: string): string {
  const r = spawnSync("git", ["rev-parse", "--git-common-dir"], { cwd: root, encoding: "utf8" });
  const commonDir = r.status === 0 && !r.error ? (r.stdout ?? "").trim() : "";
  return path.join(path.resolve(root, commonDir || ".git"), "fan-in-workflow.lock");
}

/** 持锁 holder 的 bash 脚本（非分离直接子进程；`cat >/dev/null` 阻塞在 stdin，driver 死 ⇒ EOF ⇒ 释放）。
 *  参数：$1=锁文件 $2=taskId $3=runIdJson（已编码 `"r"` 或 `null`）$4=agentIdJson $5=事件文件。 */
const FAN_IN_WORKFLOW_LOCK_HOLDER = `exec {fd}>"$1" || exit 2
flock -x "$fd" || exit 2
_wfl_emit() {
  printf '{"event":"%s","ts":"%s","epoch":%s,"taskId":"%s","pid":%s,"runId":%s,"agentId":%s}\\n' "$1" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$(date +%s)" "$2" "$$" "$3" "$4"
}
_wfl_emit acquire "$2" "$3" "$4" >> "$5"
_wfl_emit acquire "$2" "$3" "$4"
cat >/dev/null
_wfl_emit release "$2" "$3" "$4" >> "$5"
flock -u "$fd" 2>/dev/null || true
exit 0`;

/** 一次 fan-in workflow 锁的持有句柄（driver 侧）：release() 关 stdin 写端 ⇒ holder 写 release 事件 +
 *  flock -u 退出；driver 死（SIGKILL）⇒ 内核关 stdin 写端 ⇒ 同一释放路径（无孤儿、无残留锁）。 */
export interface FanInWorkflowLockHandle {
  holderPid: number | null;
  release: () => Promise<void>;
}

/** 经非分离直接子进程 acquire fan-in workflow 锁（ADR-034）。resolve = holder 已 flock 并写出 acquire
 *  事件（stdout 出现该行）；reject = holder 在 acquire 前死（flock 错误 / spawn 失败）。unbounded——排队
 *  等待正是这把正确性锁存在的意义（⛔ 无超时，与旧 --acquire-workflow-lock 的 `flock -x` 无界语义一致）。 */
export function acquireFanInWorkflowLock(opts: {
  root: string;
  task: string;
  runId: string;
  agentId?: string | null;
  lockFile?: string;
  eventsFile?: string;
}): Promise<FanInWorkflowLockHandle> {
  const lockFile = opts.lockFile ?? fanInWorkflowLockFile(opts.root);
  const eventsFile = opts.eventsFile ?? path.join(opts.root, ".quay", "fan-in-workflow-lock-events.jsonl");
  const runIdJson = opts.runId ? JSON.stringify(opts.runId) : "null";
  const agentIdJson = opts.agentId ? JSON.stringify(opts.agentId) : "null";
  fs.mkdirSync(path.dirname(eventsFile), { recursive: true });

  const child = spawn(
    "bash",
    ["-c", FAN_IN_WORKFLOW_LOCK_HOLDER, "wfl-holder", lockFile, opts.task, runIdJson, agentIdJson, eventsFile],
    { stdio: ["pipe", "pipe", "pipe"] },
  );

  let released = false;
  const release = (): Promise<void> => {
    if (released) return Promise.resolve();
    released = true;
    child.stdin?.end();
    if (child.exitCode !== null) return Promise.resolve();
    return new Promise<void>((res) => child.once("close", () => res()));
  };

  return new Promise((resolve, reject) => {
    let settled = false;
    let stdoutBuf = "";
    child.stdout?.on("data", (chunk: Buffer) => {
      stdoutBuf += chunk.toString("utf8");
      if (!settled && stdoutBuf.includes('"event":"acquire"')) {
        settled = true;
        resolve({ holderPid: child.pid ?? null, release });
      }
    });
    child.on("close", (code) => {
      if (!settled) {
        settled = true;
        reject(new Error(`fan-in workflow lock holder exited before acquiring (code ${code})`));
      }
    });
    child.on("error", (e) => {
      if (!settled) {
        settled = true;
        reject(new Error(`fan-in workflow lock holder spawn error: ${(e as Error).message}`));
      }
    });
  });
}

/** 写 suite capture（ff 闸 fan-in-ff-merge.sh 的证书——读 suite_exit + suite_head 判「本任务 suite 已
 *  绿且 suite_head 是待 ff tip 的祖先」）。写失败抛错（调用方 catch → red）。 */
function writeSuiteCapture(captureFile: string, fields: Record<string, string>): void {
  const lines = Object.entries(fields).map(([k, v]) => `${k}=${v}`);
  fs.mkdirSync(path.dirname(captureFile), { recursive: true });
  fs.writeFileSync(captureFile, lines.join("\n") + "\n", "utf8");
}

/** 读 `<ref>:tasks/<task>.md` 的 status frontmatter（git show；ref 不存在 / 文件缺失 / 读不懂 ⇒ null）。 */
async function readTaskStatusAtRef(worktree: string, ref: string, task: string): Promise<string | null> {
  const r = await mechSh(["git", "-C", worktree, "show", `${ref}:tasks/${task}.md`], 30_000);
  if (!r.ok) return null;
  const m = (r.stdout ?? "").match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) return null;
  const statusLine = m[1].split("\n").map((l) => l.trim()).find((l) => l.startsWith("status:"));
  if (!statusLine) return null;
  return statusLine.slice("status:".length).trim() || null;
}

/** 写 worktree 任务文件 + 提交（flip / reset 共用的机械步：写盘 → add → commit --no-verify）。 */
async function commitTaskStatusChange(
  worktree: string,
  task: string,
  file: string,
  nextText: string,
  message: string,
): Promise<{ ok: boolean; reason: string | null }> {
  fs.writeFileSync(file, nextText, "utf8");
  let a = await mechSh(["git", "-C", worktree, "add", `tasks/${task}.md`]);
  if (!a.ok) return { ok: false, reason: `git add failed: ${a.stderr || `exit ${a.status}`}` };
  a = await mechSh(["git", "-C", worktree, "commit", "-q", "--no-verify", "-m", message, "--", `tasks/${task}.md`]);
  if (!a.ok) return { ok: false, reason: `git commit failed: ${a.stderr || `exit ${a.status}`}` };
  return { ok: true, reason: null };
}

/** 把 archguard-runner 写进 worktree 的结构信号记录镜像到主检出的生产载体（AC2）。
 *  worktree 的 .archguard/ 在机械 fan-in 成功后随 `git worktree remove` 被删 ⇒ 记录必须持久化到
 *  root（主检出）的 .archguard/metrics-history.jsonl，post-landing 才可查（硬规则④推论三：能产出≠已产出）。
 *  archguard-runner 每次跑 append 一条，镜像最后一条（本次新写）；worktree 无记录（测试缝的 fake 命令
 *  不写）⇒ no-op 非失败。镜像失败 fail-closed（记录是「被某判据读」半边，载体写失败 ≠ 静默通过）。 */
function mirrorArchguardMetrics(worktree: string, root: string): { ok: boolean; reason: string | null } {
  const wtFile = path.join(worktree, ".archguard", "metrics-history.jsonl");
  let wtText: string;
  try {
    wtText = fs.readFileSync(wtFile, "utf8");
  } catch {
    return { ok: true, reason: null };
  }
  const lines = wtText.split("\n").map((s) => s.trim()).filter(Boolean);
  const last = lines[lines.length - 1];
  if (!last) return { ok: true, reason: null };
  const mainFile = path.join(root, ".archguard", "metrics-history.jsonl");
  try {
    fs.mkdirSync(path.dirname(mainFile), { recursive: true });
    fs.appendFileSync(mainFile, last + "\n", "utf8");
    return { ok: true, reason: null };
  } catch (e) {
    return { ok: false, reason: `cannot mirror archguard metrics to ${mainFile}: ${e instanceof Error ? e.message : String(e)}` };
  }
}

/** 读 worktree 的任务文件并翻 status ready→done（fail-closed：恰 1 行精确 `^status: ready$`，否则拒）。
 *  gap-fan-in-flip-done-already-done-not-landed：「先 flip 后 ff」（人 2026-08-14 裁定）留下的
 *  「done 但未落地」不一致中间态（worktree 已翻 done、develop 未含落地提交）在重跑时收敛——读到
 *  `status: done` 先判真落地：
 *    - 已真落地（mergeTarget 的 tasks/<task>.md status=done）⇒ skip（不 reset、不重翻，返回 ok）；
 *    - 未真落地（mergeTarget 仍是 ready / 读不到）⇒ reset 到 ready 再 flip（两提交，ff 落在新 flip tip）。
 *  正常 `status: ready` 的 flip 行为不变（AC4）。判落地用「mergeTarget 的任务文件 status」直接量
 *  （⛔ 不各写一遍 computeLandingState 的 landing 判定——本函数只判 flip 侧的一致性）。 */
async function flipTaskDone(
  worktree: string,
  task: string,
  mergeTarget: string,
): Promise<{ ok: boolean; reason: string | null }> {
  const file = path.join(worktree, "tasks", `${task}.md`);
  let text: string;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch (e) {
    return { ok: false, reason: `read task file failed: ${(e as Error).message}` };
  }
  const lines = text.split("\n");
  const readyCount = lines.filter((l) => l === "status: ready").length;
  if (readyCount === 1) {
    const flipped = text.replace(/^status: ready$/m, "status: done");
    if (!/^status: done$/m.test(flipped)) {
      return { ok: false, reason: "flip produced no 'status: done' line" };
    }
    return commitTaskStatusChange(worktree, task, file, flipped, `tasks: 翻 ${task} done（driver 机械 fan-in）`);
  }
  const doneCount = lines.filter((l) => l === "status: done").length;
  if (doneCount === 1) {
    // done 已存在：判真落地（mergeTarget 的任务文件是否已 done）。已落地 ⇒ skip；未落地 ⇒ reset→flip。
    const landed = await readTaskStatusAtRef(worktree, mergeTarget, task);
    if (landed === "done") return { ok: true, reason: null };
    const reset = text.replace(/^status: done$/m, "status: ready");
    if (!/^status: ready$/m.test(reset)) {
      return { ok: false, reason: "reset to ready produced no 'status: ready' line" };
    }
    const resetResult = await commitTaskStatusChange(
      worktree, task, file, reset,
      `tasks: reset ${task} done→ready（fan-in 收敛「done 未落地」中间态）`,
    );
    if (!resetResult.ok) return resetResult;
    const flipped = reset.replace(/^status: ready$/m, "status: done");
    if (!/^status: done$/m.test(flipped)) {
      return { ok: false, reason: "flip after reset produced no 'status: done' line" };
    }
    return commitTaskStatusChange(worktree, task, file, flipped, `tasks: 翻 ${task} done（driver 机械 fan-in）`);
  }
  return { ok: false, reason: `expected exactly 1 'status: ready' line, got ${readyCount}` };
}

/**
 * driver 机械跑通一次无失败 fan-in 的 happy path（锁/merge/delta/typecheck/archguard结构闸/scoped门/suite/ff）。
 * ⛔ 语义失败点（merge 冲突 / anti-drift HARD FAIL / typecheck 红 / 依赖环 / suite 红 / ff 失败）一律返回
 * outcome=red + step，由调用方回退旧 workflow 子代理兜底（本函数不调 LLM、不做语义修复）。
 * 锁在任一退出路径都会 release（finally）——成功 release 于 ff 之后（AC2）；失败也 release（回退的
 * workflow 子代理会重新 acquire，幂等）。
 */
export async function runMechanicalFanIn(opts: MechanicalFanInOptions): Promise<MechanicalFanInResult> {
  const { task, worktree, root, runId } = opts;
  const mergeTarget = opts.mergeTarget ?? "develop";
  const slotBase = opts.slotBase ?? suiteLockBase(root);
  const slotLib = opts.slotLib ?? path.join(root, "plugin", "scripts", "suite-slot-lib.sh");
  const suiteCapture = opts.suiteCapture ?? `/tmp/fan-in-suite-${task}.env`;
  // 独立日志/run：suite 日志文件名带 runId——⛔ 不再复用 /tmp/fan-in-suite-${task}.log（跨 relaunch
  // 残留旧轮内容，gap-fan-in-suite-log-cross-relaunch-reuse；本次「每次测试独立日志文件」指令）。
  const suiteLogFile =
    opts.suiteLogFile ?? `/tmp/fan-in-suite-${task}-${runId.replace(/[^A-Za-z0-9_.-]/g, "_")}.log`;
  const suiteStateFile = opts.suiteStateFile ?? path.join(root, ".quay", "full-suite-state.json");
  const scriptsDir = opts.scriptsDir ?? path.join(worktree, "plugin", "scripts");
  const ffMerge = path.join(scriptsDir, "fan-in-ff-merge.sh");
  const antiDrift = path.join(scriptsDir, "anti-drift-touches-check.ts");
  const classify = path.join(scriptsDir, "select-static-checks-for-touches.ts");
  const typecheck = path.join(scriptsDir, "fan-in-ts-typecheck-gate.ts");
  const archguardRunner = path.join(scriptsDir, "archguard-runner.ts");
  const acGate = path.join(scriptsDir, "fan-in-ac-completion-gate.ts");

  // D6：单步失败产出结构化 verdict（⛔ 不再是 `(stderr||stdout).trim()` 裸流）。裸流 dump 进 logFile、
  // summary 去噪保留「哪个测试失败」，reason 是 summary 的投影（旧读面，⛔ 不含 MODULE_TYPELESS 噪声）。
  const verdictOf = (step: string, exitCode: number | null, summary: string, logFile: string | null): MechanicalFanInResult => ({
    outcome: "red",
    verdict: { step, verdict: "failed", exitCode, summary, logFile },
    step, reason: summary,
    lockHoldSecs: null, lockAcquireEpoch: null, lockReleaseEpoch: null,
    suiteFinishedEpoch: null, suiteOutcome: null, suitePid: null, landedSha: null,
  });
  const stepLogFile = (step: string): string =>
    `/tmp/fan-in-step-${task}-${runId.replace(/[^A-Za-z0-9_.-]/g, "_")}-${step}.log`;
  // 有裸流的机械步：stdout+stderr 全量 dump 进 logFile，summary 从合并流提取（⛔ 只取 stderr 会丢
  // stdout 里真正的测试结果——D6 的病根）。dump 失败不致命（logFile=null，summary 仍可定位）。
  // ⛔ 保持旧函数名 `fail`（不改名 failStep）——archguard-structural-gate-fan-in.test.mjs 钉死
  // `fail("archguard-structure"` 源面；改名会破坏该结构不变量（D6 只改产出，不改接点命名）。
  const fail = (step: string, a: MechShResult): MechanicalFanInResult => {
    const combined = [a.stdout, a.stderr].filter((s) => s && s.trim() !== "").join("\n");
    const summary = extractFailureSummary(combined) || `exit ${a.status}`;
    const logFile = stepLogFile(step);
    try {
      fs.mkdirSync(path.dirname(logFile), { recursive: true });
      fs.writeFileSync(logFile, combined, "utf8");
    } catch {
      return verdictOf(step, a.status, summary, null);
    }
    return verdictOf(step, a.status, summary, logFile);
  };
  // 无裸流的机械步（reason 已结构化：flip-done / archguard-metrics / acquire-workflow-lock / exception）。
  const failClean = (step: string, summary: string, exitCode: number | null = null): MechanicalFanInResult =>
    verdictOf(step, exitCode, summary, null);

  // 1. acquire fan-in workflow lock（机械包裹整段 merge→suite→ff，AC4）。ADR-034：driver 自身经非分离
  // 直接子进程持锁（⛔ 废除 fan-in-ff-merge.sh 的 `& disown` 分离 holder + flag 释放协议）——锁的生死 =
  // 工作的进程生死，driver 死（含 SIGKILL）⇒ 内核关 stdin 写端 ⇒ holder 释放 flock。unbounded（无超时）：
  // workflow 锁是正确性锁（「此刻谁可 merge develop」），排队等待正是它存在的意义（⛔ 120s 短超时会在
  // 等待时误杀，gap-mech-fan-in-acquire-lock-timeout-queue-semantics）。⛔ 无时间阈值（无 hold-max/TTL/stale）。
  let workflowLock: FanInWorkflowLockHandle;
  try {
    workflowLock = await acquireFanInWorkflowLock({ root, task, runId });
  } catch (e) {
    return failClean("acquire-workflow-lock", (e as Error)?.message ?? "acquire failed");
  }
  const releaseLock = async (): Promise<void> => {
    await workflowLock.release();
  };
  let a: MechShResult;

  let suiteOutcome: SuiteOutcome | null = null;
  let suiteFinishedEpoch: number | null = null;
  let suitePid: number | null = null;

  try {
    // 2. merge develop（冲突 ⇒ red → 语义会话兜底）。
    a = await mechSh(["git", "-C", worktree, "merge", "--no-edit", mergeTarget], 120_000);
    if (!a.ok) return fail("merge-develop", a);

    // 3. anti-drift Touches 核对（HARD FAIL ⇒ red）。
    a = await mechSh(["node", "--experimental-strip-types", antiDrift, "--task", task, "--worktree", worktree, "--merge-target", mergeTarget], 120_000);
    if (!a.ok) return fail("anti-drift", a);

    // 4. delta 断言面判定（doc-only 跳过 suite，code 跑 suite；判不出 fail-closed 跑 suite）。
    const fork = await mechSh(["git", "-C", worktree, "merge-base", mergeTarget, "HEAD"], 30_000);
    const deltaFiles = await mechSh(["git", "-C", worktree, "diff", "--name-only", (fork.stdout || "").trim(), "HEAD"], 30_000);
    const deltaList = (deltaFiles.stdout || "").split("\n").map((s) => s.trim()).filter(Boolean);
    let codeDelta = "";
    if (deltaList.length > 0) {
      const cd = await mechSh(["node", "--experimental-strip-types", classify, "--classify-delta", "--root", worktree, ...deltaList], 120_000);
      codeDelta = cd.ok ? (cd.stdout || "").trim() : "__CLASSIFY_FAILED__";
    }
    const needSuite = opts.forceSuite === true || codeDelta === "__CLASSIFY_FAILED__" || codeDelta !== "";

    // 5. ts-typecheck 闸（非零 ⇒ red → 语义会话兜底）。
    a = await mechSh(["node", "--experimental-strip-types", typecheck, "--task", task, "--worktree", worktree, "--merge-target", mergeTarget], 120_000);
    if (!a.ok) return fail("typecheck", a);

    // 5.5 archguard 结构闸（依赖环 sccCount=0 ⇒ 绿；依赖环 ⇒ red → 语义会话兜底）。⛔ 分析 worktree
    // （merge develop 后的待落地代码）——非 root（root 是 doc-only 工作分支，不含本任务 delta，任务引入
    // 依赖环会被漏检）。archguard-runner 把结构信号 append 进 <worktree>/.archguard/metrics-history.jsonl；
    // worktree 的 .archguard 在 cleanup 时被删 ⇒ 镜像到主检出（root）的生产载体（AC2：能产出≠已产出）。
    const archguardCmd = opts.archguardCommand ?? ["node", "--experimental-strip-types", archguardRunner, "--root", worktree];
    a = await mechSh(archguardCmd, 600_000);
    if (!a.ok) return fail("archguard-structure", a);
    const mirrored = mirrorArchguardMetrics(worktree, root);
    if (!mirrored.ok) return failClean("archguard-metrics", mirrored.reason ?? "mirror failed");

    // 6. scoped 门 + doc 检查（必须绿）。
    const scopedCmd = opts.scopedGateCommand ?? ["bash", path.join(worktree, "scripts", "test.sh"), "--for-task", task, "--allow-thin"];
    a = await mechSh(scopedCmd, 600_000);
    if (!a.ok) return fail("scoped-gate", a);
    const docCmd = opts.docCheckCommand ?? ["bash", path.join(worktree, "scripts", "test.sh"), "--static-checks-doc"];
    a = await mechSh(docCmd, 300_000);
    if (!a.ok) return fail("doc-check", a);

    // 7. suite（driver 子进程 + 异步 poll，⛔ 不 detach——AC3）。suite_head 在 merge + 各闸之后取。
    const suiteHead = (await mechSh(["git", "-C", worktree, "rev-parse", "HEAD"], 30_000)).stdout.trim();
    if (needSuite) {
      const suiteCmd = opts.suiteCommand ?? ["bash", path.join(worktree, "scripts", "test.sh"), "--buckets", task];
      const sr: SuiteRunResult = await spawnSuiteAndWait({ slotBase, slotLib, suiteCommand: suiteCmd, logFile: suiteLogFile, silenceMs: opts.silenceMs });
      suiteOutcome = sr.outcome;
      suiteFinishedEpoch = Math.floor(new Date(sr.finishedAt).getTime() / 1000);
      suitePid = sr.pid;
      if (sr.outcome !== "done") {
        // gap-verification-round-static-fail-no-record AC1/AC2 — a red suite round must land a record.
        if (sr.outcome === "red") {
          await writeRedSuiteRecord({ task, runId, worktree, suiteHead, suiteLogFile, sr });
        }
        return failClean("suite", `suite ${sr.outcome}${sr.error ? `: ${sr.error}` : ""}`, sr.exitCode);
      }
      writeSuiteCapture(suiteCapture, {
        full_suite_ran: "true", skip_reason: "", suite_exit: "0",
        suite_head: suiteHead, start_iso: sr.startedAt, end_iso: sr.finishedAt,
      });
      // D7：把本轮 bucket suite 状态镜像到权威载体 full-suite-state.json（scope=worktree + taskId 区分
      // bucket-run 与 full-run，⛔ 不伪造 full-green；finishedAt 与 mfi.suiteFinishedEpoch 同源 ⇒ 不陈旧）。
      mirrorMechanicalFanInSuiteState({
        task, runId, commit: suiteHead,
        startedAt: sr.startedAt, finishedAt: sr.finishedAt, durationMs: sr.durationMs,
        stateFile: suiteStateFile,
      });
    } else {
      writeSuiteCapture(suiteCapture, { full_suite_ran: "false", skip_reason: "doc-only-delta", suite_exit: "0", suite_head: suiteHead });
    }

    // 8. land 前 anti-drift 重跑 + AC 完成闸 + flip done（先 flip 后 ff，人 2026-08-14 裁定）。
    a = await mechSh(["node", "--experimental-strip-types", antiDrift, "--task", task, "--worktree", worktree, "--merge-target", mergeTarget], 120_000);
    if (!a.ok) return fail("anti-drift-land", a);
    a = await mechSh(["node", "--experimental-strip-types", acGate, "--task", task, "--worktree", worktree], 60_000);
    if (!a.ok) return fail("ac-gate", a);
    const flip = await flipTaskDone(worktree, task, mergeTarget);
    if (!flip.ok) return failClean("flip-done", flip.reason ?? "flip failed");

    // 9. ff（fan-in-ff-merge.sh 读 suite capture 证书；成功 fall through，失败 red）。
    a = await mechSh(["bash", ffMerge, "--task", task, "--run-id", runId, "--root", root, "--merge-target", mergeTarget, "--worktree", worktree, "--suite-capture", suiteCapture, "--lock-wait", "30"], 120_000);
    if (!a.ok) return fail("ff", a);

    // 9.5 清理 worktree + 删 task 分支（ff 成功后——landed 判据 = status done ∧ 无残留 worktree）。
    // best-effort：移除失败不致命，landing 判定（computeLandingState）会据残留 worktree 诚实判未落地。
    await mechSh(["git", "-C", root, "worktree", "remove", "--force", worktree], 60_000);
    await mechSh(["git", "-C", root, "branch", "-D", `task/${task}`], 60_000);
  } catch (e) {
    return failClean("exception", (e as Error)?.message ?? String(e));
  } finally {
    await releaseLock();
  }

  // 成功路径（try 未 return）：release 之后读锁持有时长 + 落地 sha。
  const landedSha = (await mechSh(["git", "-C", root, "rev-parse", mergeTarget], 30_000)).stdout.trim();
  const lock = readWorkflowLockHold(root, task, runId);
  return {
    outcome: "landed", verdict: null, step: null, reason: null,
    ...lock, suiteFinishedEpoch, suiteOutcome, suitePid, landedSha,
  };
}

/** D7：机械 fan-in 的 bucket suite 绿后，把本轮 suite 状态镜像到权威载体 full-suite-state.json。
 *  ⛔ 不伪造 full-green：scope=worktree + taskId + runner=inner 区分 bucket-run（本任务的 --buckets 子集）
 *  与 full-run（scope=main + runner=outer 无 taskId）——读面据此可分辨「退休已修 suite 绿」≠「全量 suite 绿」。
 *  finishedAt 与 mfi.suiteFinishedEpoch 同源（同一 sr.finishedAt 派生）⇒ 载体不再 28h 陈旧（D7 AC3）。
 *  laneCount 取 defaultLaneCount()（nproc-derived 单一真相源，⛔ 非字面量——bucket suite 跑的是
 *  test.sh AC5 派生的真实 lane 数，不是 1 条）。
 *  best-effort：写失败 / 状态在飞（shouldSkipMirrorWrite）不致命——mfi 仍是这次 fan-in 的权威记录。 */
export function mirrorMechanicalFanInSuiteState(opts: {
  task: string;
  runId: string;
  commit: string;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  stateFile: string;
}): void {
  try {
    const built = buildMirrorState({
      state: "green", startedAt: opts.startedAt, finishedAt: opts.finishedAt,
      durationMs: opts.durationMs, laneCount: defaultLaneCount(), commit: opts.commit,
      taskId: opts.task, runId: opts.runId, runner: "inner", scope: "worktree",
    });
    if (built.error) return;
    if (shouldSkipMirrorWrite(readCurrentState(opts.stateFile))) return;
    writeMirrorState(opts.stateFile, built.state);
  } catch {
    // best-effort：镜像写失败 ≠ fan-in 失败（mfi 仍是权威）。
  }
}

// ── 阶段 4（AC129）常驻驱动 + 自主选任务：选择环 / selector worker / 判停 ───────────────────────────

// shuffle / defaultReadyPoolArgv / readyPoolCheck / defaultSelectorArgv / parseSelectorOutput /
// runSelectorWorker 已上收 driver-runtime.ts（Layer 1a · source/select）——派发环经 import 消费，
// ⛔ 不在此保留平行实现（AC151）。Touches 互斥过滤经 driver-filters.ts 的 touchesDisjoint 谓词。

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
  /** 协调地板（gap-worker-driver-reconcile-interval）：至少每 reconcileMs 协调一次，哪怕所有边沿事件
   *  （worker 退出）都丢了 ⇒ 降级「慢但正确」而非「静默停摆」。缺省 RECONCILE_INTERVAL_SECS_DEFAULT*1000。 */
  reconcileMs: number;
  /** 重试上限（gap-worker-driver-retry-cap-not-wired）：同一任务连续 N 次 exited-not-landed 未落地 ⇒
   *  标 needs-human 并停止重派。缺省 RETRY_CAP_DEFAULT（与 promotion 的 --max-fix-retries 同值）。 */
  maxRetries: number;
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
  const { rootDir, cap, timeoutMs, workerCmdOpts, selectorArgv, readyPoolArgv, resourceGateArgv, outcomeFile, runId, runPrefix, json, pidFile, livenessCmd, intervalMs, reconcileMs, maxRetries } = opts;

  // 主检出脏状态观察（阶段 2 ③，gap-worker-driver-stashifdirty-stashes-others-uncommitted）：⛔ 不 stash
  // 共享主检出（脏改动属他人）。stash 事件仍发射供观测（stashed=false + files 列出脏文件）。非 git no-op。
  const stash = stashIfDirty(rootDir);
  if (json) {
    process.stdout.write(`${JSON.stringify({ event: "stash", stashed: stash.stashed, files: stash.files, error: stash.error })}\n`);
  }

  const running: RunningWorker[] = [];
  const results: WorkerRunResult[] = [];
  let stopReason: string | null = null;

  // 重试上限（gap-worker-driver-retry-cap-not-wired）：worker 派发的任务可无限次 exited-not-landed 重派
  // ⇒ 补 retryExhausted 集合填充（同 promotion 的 RetryState 形态，单一真相源 = driver-filters.ts 的
  // advanceRetryCap / markNeedsHuman）。每 worker 结束若 exited-not-landed ⇒ 连续失败计数 + 达上限标
  // needs-human（ready→needs-human），needsHuman 集合同进 retryCapNotExhausted / notNeedsHuman 过滤 ⇒
  // 不再无限重派。跨轮存活于常驻循环内（⛔ 不落盘，与 promotion 的 RetryState 同寿命）。
  const retryState: RetryState = { counts: new Map(), needsHuman: new Set() };
  // gap-mark-needs-human-commit-after-write：markNeedsHuman 翻转结果（含 committed）经 writeRound 落进
  // 每轮 round 记录（生产载体——生产 driver argv 无 --json ⇒ json 事件不可观测，同 cold-start-inflight）。
  // splice(0) 快照并清空 ⇒ 每轮只报【本轮新】的翻转，⛔ 不累积跨轮。
  const needsHumanResults: Array<{ id: string; ok: boolean; committed: boolean; reason: string }> = [];

  // gap-worker-driver-cold-start-inflight-refresh：冷启动在飞排除集【每趟 pass 现观测】（SPEC §5.2
  // actual=observe()），不再是循环外一次性 const 快照——原 gap-worker-driver-cold-start-inflight-blind
  // 只修了「冷启动 ⇒ 不重复派发」一个方向（快照冻结 ⇒ 冷启动 worker 结束后其 task 仍永久假在飞、
  // 本驱动余生不可派，硬规则 5b 只修被报出来的那一个方向）。restart / supervisor 崩溃自动 respawn
  // 后，新驱动的 running 是纯内存数组、从空集起，不认得重启前就存活的 worker；枚举真实存活的 task
  // worktree + 交叉核对存活 quay-task-worker 进程，把「worktree 在 ∧ 存活 worker 在」的 task 纳入
  // 排除集（⛔ 重复派发撞同一 worktree，被杀后还会误删原 worker 仍在用的共享 worktree）。每轮重扫 ⇒
  // worker 退出 / worktree 消失任一发生，task 即离开排除集、重新可派（AC2 承重条）。观测结果落
  // round 记录（生产可见载体——生产 driver argv 无 --json，原「cold-start-inflight」诊断从不发射，
  // 硬规则 6 来源不完备）。这些 task 不占内存 running（无 promise 可 await），但作为「已在飞」参与
  // ready-pool 减项 / active 过滤 / Touches 互斥，⛔ 不阻塞其它 task 的派发。
  let coldInflight = new Set<string>();
  const inFlightTasks = (): string[] => running.map((r) => r.task).concat([...coldInflight]);

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
      coldStartInflight: [...coldInflight].sort(),
      needsHuman: needsHumanResults.splice(0),
    });
    try { appendRoundToFile(roundFile, record); } catch { /* 记录写失败不致命（运行时日志，⛔ 不因日志炸循环） */ }
    if (json) process.stdout.write(`${JSON.stringify({ event: "round", ...record })}\n`);
  };

  /** 判停（AC3）：起新 worker 前逐轮读。halt 优先（终态，latch）；其次 resource-gate WAIT（瞬时，
   *  ⛔ 不 latch——gap-worker-driver-stopreason-latch-permanent-stop：WAIT 名字含 WAIT，负载高恰因在飞
   *  worker 在跑、worker 结束负载降但闸再没被读 = 自我锁死反馈环）。瞬时 WAIT 只让本轮不派、
   *  下一轮重读 stopCondition。⛔ AC151：判停经 Layer 0 的 makeStopCondition 消费（halt ∧ resourceGate
   *  单一实现），不各写一遍。 */
  const stopCondition = makeStopCondition(rootDir, "worker", resourceGateArgv);

  /** spawn 一个选中的 worker，并把 selector 的真实理由带进 outcome（AC2）。 */
  const spawnSelected = async (sel: { task: string; reason: string }): Promise<void> => {
    const runIdForTask = runId ?? `${runPrefix}-${sel.task}`;
    // 异步版（gap-worker-driver-async-selector-readypool AC1）：worker argv 经 workerArgvForTaskAsync 取——
    // 同步 workerArgvForTask 走 continueStateForTask 的 spawnSync git 会冻住协调地板。
    const workerArgv = await workerArgvForTaskAsync(sel.task, rootDir, workerCmdOpts);
    const rw = {} as RunningWorker;
    rw.task = sel.task;
    rw.done = false;
    rw.promise = runOneWorker({
      taskId: sel.task,
      selectorReason: sel.reason,
      runId: runIdForTask,
      workerArgv,
      rootDir,
      outcomeFile,
      timeoutMs,
      inFlightCount: running.length + 1,
      json,
      pidFile,
      injectSessionId: workerCmdOpts.exact == null,
    }).then((r) => {
      rw.done = true;
      results.push(r);
      // 重试上限（gap-worker-driver-retry-cap-not-wired）：worker 结束若 exited-not-landed ⇒ 连续失败
      // 计数 + 达上限标 needs-human（ready→needs-human）。needsHuman 集合进 retryCapNotExhausted 过滤 ⇒
      // 下一轮不再重派（与 markNeedsHuman 的 status 翻转双保险——即使磁盘写失败，内存过滤也挡重派）。
      if (r.outcome.final_state === "exited-not-landed") {
        const newly = advanceRetryCap(retryState, [r.taskId], maxRetries);
        for (const id of newly) {
          // gap-mark-needs-human-commit-after-write：markNeedsHuman 写盘即提交，返回
          // { id, ok, reason, committed }——⛔ 不再丢弃 {ok,reason}；结果经 writeRound 落进 round 记录
          // （生产载体），json 事件供测试/手动观测。
          const nh = markNeedsHuman(rootDir, id, `worker-driver 连续 ${maxRetries} 次 exited-not-landed 未落地（重试上限）`);
          needsHumanResults.push(nh);
          if (json) process.stdout.write(`${JSON.stringify({ event: "needs-human", ...nh })}\n`);
        }
      }
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

  // 地板 race：等【任一 worker 退出】或【地板到期】取先到者。⛔ 地板定时器必须在 race 结束时清除
  // （gap-worker-driver-reconcile-interval AC 前置）：worker 先退出时，未触发的 setTimeout 仍挂起会让
  // 驱动进程在循环 break 后多活 reconcileMs 秒（默认 300s）——halt 后 driver 不退出 = 静默停摆的镜像。
  const raceWithFloor = (runningWorkers: RunningWorker[], floorMs: number): Promise<unknown> => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const floor = new Promise<void>((resolve) => { timer = setTimeout(resolve, floorMs); });
    return Promise.race([...runningWorkers.map((r) => r.promise), floor]).finally(() => {
      if (timer) clearTimeout(timer);
    });
  };

  let round = 0;
  while (true) {
    round += 1;
    const passStartMs = Date.now();

    // 冷启动在飞【现观测】（每趟 pass，SPEC §5.2 actual=observe()）：worker 退出 / worktree 消失任一
    // 发生 ⇒ task 即离开排除集、下一轮重新可派（⛔ 循环外一次性 const 快照 = 假在飞不可派，已修）。
    // 每轮重扫 task worktree + /proc 存活 worker 交叉核对；该结果同时写进本轮 round 记录（生产载体）。
    // 异步版（gap-worker-driver-async-selector-readypool）：git worktree list 不再 spawnSync 阻塞地板。
    coldInflight = await enumerateColdStartInflightAsync(rootDir);
    if (json && coldInflight.size > 0) {
      process.stdout.write(
        `${JSON.stringify({ event: "cold-start-inflight", tasks: [...coldInflight].sort() })}\n`,
      );
    }

    // liveness 检查（gap-resident-driver-stable-carrier-liveness Finding 的接线）：每轮顺手调一次
    // launch 脚本的 liveness 子命令。supervisor 死后 driver 成孤儿仍在跑 ⇒ 下一轮即检出 supervisor_dead
    // 并让子命令写 DEATH 告警（⛔ 载体停更 ≠ 一切正常）。checked=false（脚本缺失/失败）≠ 健康（硬规则 3b）。
    const liveness = await runLivenessCheckAsync(rootDir, "worker", livenessCmd);

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
      const pool = await readyPoolCheck(rootDir, readyPoolArgv, inFlightTasks(), cap);
      poolSeen = pool.pool;
      const shuffled = shuffle(pool.ready);
      // AC152：派发前过滤消费 driver-filters.ts 的【可组合谓词列表】（notInFlight / depsSatisfied /
      // touchesDisjoint / retryCapNotExhausted / notNeedsHuman，⛔ 不各写一遍）。冷启动在飞 task 一并参与
      // （它们的 Touches 是真实冲突面）。原「active 过滤 + filterTouchesDisjoint + depsReadyForDispatch」
      // 三个散点已收进 applyTaskFilters 一次判完。
      // 重试上限（gap-worker-driver-retry-cap-not-wired）：retryExhausted = 本循环已标 needs-human 的
      // 任务集合（exited-not-landed 达上限派生）——retryCapNotExhausted 谓词据此滤掉不再重派。
      const candidates = applyTaskFilters(shuffled, makeFilterContext(rootDir, { inFlight: inFlightTasks(), retryExhausted: retryState.needsHuman }));
      if (candidates.length === 0) {
        // 真池空（ready 减在飞后无候选）⇒ 瞬时 WAIT：记 pool-empty，下一轮重读（⛔ 不再 latch）。
        //   池非空但全与在飞 Touches/deps 重叠 ⇒ 同为瞬时 WAIT：不设 stopReason（在飞 worker 结束释放
        //   Touches 或依赖由别的任务落地后重进选择环重新 filter）。两者都不退出——等 intervalMs 重读。
        if (shuffled.length === 0) waitReason = "pool-empty (no dispatchable candidate in the ready pool)";
        break;
      }
      const sel = await runSelectorWorker(candidates, selectorArgv, rootDir);
      if (!sel) {
        // 候选非空但 selector 未能给出任何选择（理论上 parseSelectorOutput 必回退首个，不会 null）。
        waitReason = "pool-empty (selector returned no candidate)";
        break;
      }
      await spawnSelected(sel);
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
    //    协调地板（gap-worker-driver-reconcile-interval，SPEC §5.5）：至少每 reconcileMs 协调一次——
    //    边沿事件（worker 退出）全丢也降级「慢但正确」而非「静默停摆」。复用 routine-scheduler.isDue
    //    的 interval 判定（⛔ 不新造定时器/判定）：isDue 的 interval 单位是分钟 ⇒ minutes = reconcileMs/60000。
    if (reconcileMs > 0) {
      const nowMs = Date.now();
      const floorElapsed = isDue({ kind: "interval", minutes: reconcileMs / 60_000 }, { now: nowMs, lastRun: passStartMs });
      const floorMs = floorElapsed ? 0 : Math.max(0, passStartMs + reconcileMs - nowMs);
      // ⛔ 地板定时器必须在 race 结束时 clearTimeout：worker 先退出时，未触发的 setTimeout 仍挂起会让
      // 驱动进程在循环 break 后多活 reconcileMs 秒（默认 300s）——halt 后 driver 不退出、测试/生产停摆。
      await raceWithFloor(running, floorMs);
    } else {
      await Promise.race(running.map((r) => r.promise));
    }
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
  let reconcileRaw: string | undefined;
  let maxRetriesRaw: string | undefined;
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
    else if (a === "--reconcile-interval") reconcileRaw = args[++i];
    else if (a === "--max-retries") maxRetriesRaw = args[++i];
    else if (a === "--pid-file") pidFile = args[++i];
    else if (a === "--outcome") outcomePath = args[++i];
    else if (a === "--run-id") runId = args[++i];
    else if (a === "--json") json = true;
    else if (a === "--serve") serve = true;
    else if (a === "--host") host = args[++i];
    else if (a === "--port") port = Number(args[++i]);
    else if (a === "--help" || a === "-h") {
      console.log(
        "worker-driver — SPEC §5 阶段 2+3+4：spawn 多 worker（并发 N + 超时 SIGTERM + ⛔ 不 stash 主检出 + MCP 控制面 + 常驻选择环）\n" +
          "  --task <id> [--task <id> …] [--reason \"<一句为什么选它>\"] [--concurrency <N>] [--timeout <ms>]\n" +
          "  [--root <repo>] [--worker-cmd \"<前缀>\"] [--worker-cmd-exact \"<argv>\"] [--pid-file <p>] [--outcome <p>] [--run-id <id>] [--json]\n" +
          "  ⛔ 无 --task ⇒ 常驻选择环（不再报错退出）\n" +
          "  [--selector-cmd \"<argv>\"] [--ready-pool-cmd \"<argv>\"] [--resource-gate-cmd \"<argv>\"] [--liveness-cmd \"<argv>\"]\n" +
          "  [--interval <ms>]   无在飞 worker 且瞬时 WAIT 时的轮询间隔（缺省 30000；测试缝传小值）\n" +
          "  [--reconcile-interval <s>]  协调地板：至少每 N 秒协调一次，边沿事件全丢也降级「慢但正确」而非静默停摆（缺省 300；0 = 无地板）\n" +
          "  [--max-retries <n>]  重试上限：同一任务连续 N 次 exited-not-landed 未落地 ⇒ 标 needs-human 并停止重派（缺省 3，同 promotion --max-fix-retries）\n" +
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
  const intervalMs = parseIntervalMs(intervalRaw, rootDir);
  const reconcileMs = parseReconcileIntervalSecs(reconcileRaw, rootDir);
  const maxRetries = parseMaxRetries(maxRetriesRaw);

  // 阶段 4（AC129）：无 --task ⇒ 常驻选择环（不再报错退出）。--task 显式批量派发路径不变。
  if (tasks.length === 0) {
    const cap = resolveConcurrency(concurrency, 0, driverCap(rootDir, "worker"));
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
      reconcileMs,
      maxRetries,
    });
  }

  const resolved = resolveRun({ tasks, reason, workerCmd, workerCmdExact, root: rootDir, runId, nowMs: Date.now() });
  if (resolved.error) {
    console.error(`worker-driver: ${resolved.error}`);
    return 2;
  }
  const { taskIds, selectorReason, runPrefix, workerCmdOpts } = resolved;
  const cap = resolveConcurrency(concurrency, taskIds.length, driverCap(rootDir, "worker"));

  // 主检出脏状态观察（阶段 2 ③，gap-worker-driver-stashifdirty-stashes-others-uncommitted）：⛔ 不 stash
  // 共享主检出（脏改动属他人）。stash 事件仍发射供观测（stashed=false + files 列出脏文件）。非 git no-op。
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
      injectSessionId: workerCmdOpts.exact == null,
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
