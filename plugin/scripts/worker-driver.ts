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
//         stashifdirty-stashes-others-uncommitted）。ff 前的干净判据由 ff-merge.ts 模块自持，非驱动代劳。
//
// 阶段 2 新增（AC116，相对阶段 1 的三条能力）：
//   ① 并发 N —— --task 可重复、--concurrency N 上限；在飞 = 驱动当前活子进程数（直接量，非硬编码 1）。
//   ② 超时 SIGTERM —— --timeout <ms>（缺省 0 = 无超时，SPEC §4④：成本结构未知前不设阈值）。超时 ⇒
//      SIGTERM worker、outcome 记 final_state=timed-out（worktree_preserved=true）。⛔ 超时【保留
//      worktree】（SPEC §1 设计点3「超时即杀 worker 会话，但保留 worktree」；gap-worker-print-bg-wait-
//      ceiling-600s AC3）——超时≠其它异常死亡（failed/killed/exited-not-landed 仍清 orphan worktree，
//      gap-worker-driver-no-record-on-abnormal-death AC2）。
//   ③ ⛔ 不 stash 主检出 —— spawn 前【观察】主检出脏状态但不 stash（归属检查：可被 stash 的脏改动必属
//      他人，卷走 = 本缺陷）。非 git 仓库 no-op。ff 的干净判据在 ff-merge.ts 模块，不在这里。
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
//      driver 按 red step 决定），结构上不需要事后检查「有没有走」。原 A6 检查器已随
//      gap-retire-fan-in-executor-workflow-identity-checkers（08-29）删除（SUPERSEDED），无残留检查面。
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
//   注：.halt 哨兵机制已随 gap-retire-halt-file-driver-based（08-29）整体退役——旧三层循环的消费点已删除
//   （SUPERSEDED）。本文件只管【驱动】这一条停机来源（.quay/worker-control.json），不读 .halt。
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
import { fileURLToPath, pathToFileURL } from "node:url";
import { randomUUID } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { isDirectEntry, normalizeRel } from "./gate-script-base.ts";
import { TASK_STATUS } from "./task-status.ts";
import { extractSection, countAcCheckboxes, fetchTaskStatusAtRef } from "./task-schema.ts";
// gap-task-ops-consolidate-driver-frontmatter-writers：flipTaskDone 的 status 读/写经 task-ops.ts
// （splitTaskFile / statusFromFrontmatter / patchStatusField，单一 parser，⛔ 不再手搓 status 行正则）。
import { splitTaskFile, statusFromFrontmatter, patchStatusField } from "./task-ops.ts";
import { repoRoot } from "./repo-root.ts";
import { parseTouchEntriesWithTags } from "./touches-parser.ts";
import { parseLoadSensitiveAnnotation } from "./known-load-sensitive.ts";
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
import { applyTaskFilters, makeFilterContext, readTaskStatus, advanceRetryCap, markNeedsHuman, reconcileNeedsHumanWithDisk, RETRY_CAP_DEFAULT, lastExitedNotLandedReason, exitedNotLandedAttempts, WORKER_OUTCOME_REL, type RetryState, type ExitedNotLandedAttempt } from "./driver-filters.ts";
export { readTaskStatus, lastExitedNotLandedReason, exitedNotLandedAttempts, WORKER_OUTCOME_REL } from "./driver-filters.ts";
// AC155：并发 cap / 轮询间隔 / 协调地板的单一真相源（drivers.yml 经 driver-config 加载，⛔ 不各写一份字面量、
// ⛔ 不再读 QUAY_MAX_TASK_SUBAGENTS env——env 源已并入声明式配置）。
import { defaultDriverConfig, loadDriverConfig, driverCap } from "./driver-config.ts";
// AC153：核心不变式单一实现（「⛔ 不信执行者自述，用独立量复核」）+ DriverResult 词表强制含
// not-evaluated。computeLandingState 消费它（⛔ 不各写一遍 exitCode/自述判定）。
import { verifyIndependently, type DriverResult } from "./driver-result.ts";
// AC153：re-export verifyIndependently 值——测试用「同一函数身份」证两 driver 共用单一实现（⛔ 非平行副本）。
export { verifyIndependently } from "./driver-result.ts";
export type { DriverResult } from "./driver-result.ts";
import { listWorktrees, taskIdFromBranch, worktreeMatchesTask, parseWorktreePorcelain } from "./fast-mode-telemetry.ts";
import { isDue } from "./routine-scheduler.ts";
// 门②「cwd 在该 worktree 内的活进程」直接量单一真相源（gap-worktree-remove-orphans-probes 的 /proc
// 枚举器 enumerateProcs + cwdUnder——⛔ 不手搓 /proc 扫描，同 concurrent-batch-scheduler.ts 的 in-flight
// worktree 活性判定）。reaper 步骤亦复用同一脚本（--worktree <path> 模式，先 reaper 再 remove）。
import { enumerateProcs, cwdUnder, type ProcInfo } from "./worktree-process-reaper.ts";
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
  resolveKernelSibling,
  resolveKernelScriptsDir,
  resolveKernelPluginRoot,
  type LivenessResult,
} from "./driver-runtime.ts";
// 机械 fan-in（gap-fan-in-driver-mechanical-orchestration / SPEC-fan-in-driver-mechanical-
// orchestration-2026-08-27）：suite 不再 detach（setsid+&+disown 孤儿）——改由 driver 直接 spawn 并 wait
// （进程级父子，ppid 指向 driver，AC3）。复用 suite-driver.ts 的 spawnSuiteAndWait（同一单飞槽语义 +
// 静默看门狗，⛔ 不新写一份 suite 生命周期）。suiteLockBase 读 TS 侧单一真相源槽路径。
import { spawnSuiteAndWait, type SuiteOutcome, type SuiteRunResult } from "./suite-driver.ts";
import { suiteLockBase } from "./suite-lock-slots.ts";
// D7：机械 fan-in 的 bucket suite 绿后，把本轮 suite 状态镜像到权威载体 full-suite-state.json
// （复用 mirror-full-suite-state.ts 的 build/write/skip 单一实现，⛔ 不另写一份 state shape）。
import { buildMirrorState, writeMirrorState, shouldSkipMirrorWrite, readCurrentState } from "./mirror-full-suite-state.ts";
// D7：laneCount 取 full-suite-runner.ts 的 defaultLaneCount（nproc-derived 单一真相源，读宿主 + QUAY_MAX_*
// 定义点，⛔ 不写字面量 1——concurrency-literal-check P4 会把 `laneCount: 1` 判为未声明并发字面量违规）；
// readLoadAvg 同源（/proc/loadavg 1min，verification-round 的 load 轴——与 full-suite-runner 同一读法）。
import { defaultLaneCount, readLoadAvg } from "./full-suite-runner.ts";
// gap-verification-round-bound-to-quay-shaped-suite-entry：第三方项目（无 scripts/test.sh，suite 由它自己的
// loop.test_command 跑）不经 full-suite-runner ⇒ 那条唯一 writer 不在路径上 ⇒ /tests 的
// verification-round.jsonl 结构性不产生（web 恒显示「未接入」）。本层补写【复用既有 shared writer】
// pre-verified-round-record.ts 的 builder + appender（⛔ 不新造第三个 writer；该模块的 CLI main 由
// isDirectEntry 守卫，import 不触发执行）。
import { buildPreVerifiedRoundRecord, appendPreVerifiedRound } from "./pre-verified-round-record.ts";
// gap-worker-ac-check-shortcircuit：finishAsync 在 spawn 机械 fan-in 前查 worktree 任务体 AC/DoD 全勾。
// ⛔ 不新造计数函数——复用 flip 闸 fan-in-ac-completion-gate.ts 的 flipAcGateVerdict（与机械 fan-in
// step 6.5 ac-precheck / step 8 ac-gate 同源，countCompletionCheckboxes / isLandedCodeComplete 单一真相源）。
import { flipAcGateVerdict } from "./fan-in-ac-completion-gate.ts";
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
import { computeDocCheckFaceKey, readDocCheckCache, writeDocCheckCache } from "./doc-check-cache.ts";
import { parse as parseYaml } from "yaml";

// ── 常量 ───────────────────────────────────────────────────────────────────────────────────────────

/** round 记录（无条件心跳）的仓库相对路径（gitignored 运行时日志，worker-outcome.jsonl 同族）。 */
export const WORKER_ROUND_REL = ".quay/worker-round.jsonl";

/** dispatch 持久记录（gap-worker-driver-restart-orphan-no-outcome-no-timeout）的仓库相对路径——
 *  gitignored 运行时状态（worker-outcome.jsonl / worker-round.jsonl 同族），按 taskId 索引的单文件 map。 */
export const WORKER_DISPATCH_REL = ".quay/worker-dispatch.json";

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

// ── ff-not-fast-forward 续做识别（gap-continue-cycle-misses-ff-not-fast-forward-redispatch）───────────
// 机械 fan-in 的 ff 步失败「not a fast-forward」= develop 在长 suite 窗口期间前进、task 分支落后——
// ⛔ 非代码缺陷（分支滞后），重派（CONTINUE：merge develop 再 ff）即可自愈，continueConflictResolutionNote
// 已教该消解。但旧 continue-cycle 把这条 exited-not-landed 与「真缺陷」（suite red / merge-develop 冲突 /
// anti-drift 违反）同形计数进重试上限 ⇒ 3 次（含 2 次 ff 滞后）撞 cap ⇒ 误标 needs-human ⇒ 静置不派、
// 需人手动救回（2026-08-30 实况：gap-retire-governance-group-merge-into-bucket 两次 ff 撞重试上限，
// 人翻转 needs-human→ready 才恢复）。本判定把它与真缺陷区分开，使 continue-cycle 把它识别为 transient
// 续做态（不计重试上限、继续重派），⛔ 不改变「真缺陷达上限标 needs-human」的既有行为。

/** 该 exited-not-landed outcome 是否由 ff-not-fast-forward（develop 前进、分支滞后）造成。识别依据 =
 *  mechanical_fan_in.step === "ff" 且 reason 含 "not a fast-forward"（⛔ 不匹配 ff 步的其它失败——
 *  post-check FAILED / 防活锁 escalation（attempt ≥ 3，exit 3）仍是真缺陷，照常计上限）。mechanical_fan_in
 *  缺（非机械 fan-in 失败）/ 读不懂 ⇒ false（fail-closed 朝「计入上限」——宁可多标 needs-human，不把一个
 *  真缺陷漏判成 transient）。纯谓词，可单测（AC2）。 */
export function isFfNotFastForwardFailure(outcome: unknown): boolean {
  if (!outcome || typeof outcome !== "object") return false;
  const m = (outcome as { mechanical_fan_in?: unknown }).mechanical_fan_in;
  if (!m || typeof m !== "object") return false;
  if ((m as { step?: unknown }).step !== "ff") return false;
  const reason = (m as { reason?: unknown }).reason;
  return typeof reason === "string" && /not a fast-forward/i.test(reason);
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

/** 是否存在本任务残留 worktree（形状感知——路径 basename ∨ 分支去掉可选 `task/` 前缀 == taskId，
 *  gap-task-branch-prefix-assumption-scattered-read-sites-orphan-enumeration-blind）。判定收敛到
 *  fast-mode-telemetry 的 worktreeMatchesTask，⛔ 不各自手写 `refs/heads/task/<id>` 正则。
 *  fan-in 成功后 `git worktree remove` + `git branch -d task/<id>` 把该分支删掉 ⇒ 无该 worktree = 无残留。
 *  读失败（非 git 仓库 / git 错误）⇒ null（硬规则 3b：读不懂 ≠ 无残留）。 */
export function worktreePresentForTask(root: string, taskId: string): boolean | null {
  const r = spawnSync("git", ["-C", root, "worktree", "list", "--porcelain"], { encoding: "utf8" });
  if (r.status !== 0 || r.error) return null;
  return parseWorktreePorcelain(String(r.stdout ?? "")).some((wt) => worktreeMatchesTask(wt, taskId));
}

/** 本任务残留 worktree 的路径列表（形状感知，判定同 worktreePresentForTask）。读失败（非 git 仓库 /
 *  git 错误）⇒ []（硬规则 3b：读不懂 ≠ 确认无残留，用 worktreePresentForTask 区分「读不懂」（null）
 *  与「确认无残留」（false））。 */
export function worktreePathsForTask(root: string, taskId: string): string[] {
  const r = spawnSync("git", ["-C", root, "worktree", "list", "--porcelain"], { encoding: "utf8" });
  if (r.status !== 0 || r.error) return [];
  const paths: string[] = [];
  for (const wt of parseWorktreePorcelain(String(r.stdout ?? ""))) {
    if (wt.path && worktreeMatchesTask(wt, taskId)) paths.push(wt.path);
  }
  return paths;
}

/** worktreePresentForTask 的异步版（常驻循环体用——⛔ spawnSync git 会冻住协调地板）。语义一致：
 *  读失败（git 失败）⇒ null（读不懂 ≠ 无残留），⛔ 不是 false。 */
export async function worktreePresentForTaskAsync(root: string, taskId: string): Promise<boolean | null> {
  const r = await runAsync(["git", "-C", root, "worktree", "list", "--porcelain"], { timeoutMs: 5_000 });
  if (r.error || r.status !== 0) return null;
  return parseWorktreePorcelain(r.stdout).some((wt) => worktreeMatchesTask(wt, taskId));
}

/** worktreePathsForTask 的异步版（常驻循环体用）。读失败 ⇒ []（与同步版一致）。 */
export async function worktreePathsForTaskAsync(root: string, taskId: string): Promise<string[]> {
  const r = await runAsync(["git", "-C", root, "worktree", "list", "--porcelain"], { timeoutMs: 5_000 });
  if (r.error || r.status !== 0) return [];
  const paths: string[] = [];
  for (const wt of parseWorktreePorcelain(r.stdout)) {
    if (wt.path && worktreeMatchesTask(wt, taskId)) paths.push(wt.path);
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

/** 解出该 task 存活 worker 的 pid：重扫 /proc，返回第一个其 cmdline（空格 join）命中
 *  hasLiveWorkerForTask 的 pid；无命中 ⇒ null（读不到 /proc 也 null——硬规则 3b：读不懂 ≠ 无存活，
 *  由调用方决定是否信号）。procDir 是测试缝（与 enumerateLiveWorkerCmdlines 同款）。 */
function findLiveWorkerPid(taskId: string, procDir: string = "/proc"): number | null {
  let entries: string[];
  try {
    entries = fs.readdirSync(procDir);
  } catch {
    return null;
  }
  for (const e of entries) {
    if (!/^\d+$/.test(e)) continue;
    let buf: Buffer;
    try {
      buf = fs.readFileSync(path.join(procDir, e, "cmdline"));
    } catch {
      continue; // 进程已退 / 无权限 ⇒ 跳过
    }
    const cmdline = buf.toString("utf8").replace(/\0/g, " ").trim();
    if (hasLiveWorkerForTask(taskId, [cmdline])) return Number(e);
  }
  return null;
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

// ── superseded worktree 回收（gap-superseded-task-residual-worktree-never-reclaimed）──────────────
// 任务生命周期终止（supersede，经 task_write 改 status）后，其残留 worktree 单调累积、现有清理路径
// （cleanupOrphanWorktree 只在 worker 异常死亡路径触发、且保留有提交的）够不着。每轮 reconcile 步枚举
// task/<id> worktree、仅 status=superseded 进候选，双闸通过者按机件顺序回收。⛔ 分支一律保留（见函数 doc）。

/** worktree-process-reaper.ts 脚本绝对路径（本文件同目录，module-relative 解析——主检出 / worktree /
 *  bundle 同义）。superseded 回收的 reaper 步骤经 subprocess 调用（⛔ 不 import 其函数手搓——按机件顺序
 *  跑 gap-worktree-remove-orphans-probes 已建的正确入口）。 */
const WORKTREE_PROCESS_REAPER_ENTRY = fileURLToPath(new URL("./worktree-process-reaper.ts", import.meta.url));

/** 缺省 reaper 命令（--worktree <path> 模式）：收探针 / 挂死 runner。⛔ 脚本自持「不杀 real claude
 *  session / 不杀调用方自身进程树」安全包络（worktree-process-reaper.ts AC2）。 */
function defaultSupersededReaperCmd(root: string, worktreePath: string): string[] {
  return [process.execPath, "--experimental-strip-types", WORKTREE_PROCESS_REAPER_ENTRY, "--worktree", worktreePath, "--root", root];
}

/** 单个 task worktree 的 superseded 回收结果（可观测：status / 回收 / 双闸跳过 / 分支保留）。 */
export interface SupersededWorktreeReclaimResult {
  taskId: string;
  /** 该 task 的 status 读数：superseded / ready / done / needs-human / todo / unreadable（缺失或读不懂）。
   *  三者两两不等（硬规则 3b）：unreadable 不与可回收（superseded）也不与跳过（任一真 status）同形。 */
  status: string;
  /** 该 task worktree 路径（worktreePathsForTask 首条）；无 worktree ⇒ null。 */
  worktreePath: string | null;
  /** 实际回收成功（reaper 已跑 + `git worktree remove --force` 全部成功）。 */
  reclaimed: boolean;
  /** 因存活 worker 命中而跳过（⛔ 不清）。 */
  skippedLiveWorker: boolean;
  /** 门①命中且 status=superseded 时，本轮是否真的对存活 worker 发了 SIGTERM（⛔ 与 skippedLiveWorker
   *  区分——「跳过且已信号」与「跳过而未信号」必须可区分，硬规则 3b）。非门①分支恒 false。 */
  liveWorkerSignaled: boolean;
  /** 因 cwd 在 worktree 内的活进程（非 zombie ⇒ 活性；zombie 是死而未收，非活动）而跳过（⛔ 不清）。 */
  skippedLiveProcess: boolean;
  /** 移除后分支是否仍保留（`git rev-parse --verify task/<id>` exit 0 ⇒ true）。仅 reclaimed=true 时
   *  才读；其余 null。读失败（spawn error）⇒ null（读不懂 ≠ 已删）。 */
  branchPreserved: boolean | null;
  /** 移除失败的错误（尝试过但失败）；无 ⇒ null。 */
  error: string | null;
}

/** superseded worktree 回收（整轮）结果。 */
export interface ReclaimSupersededResult {
  /** 枚举到的候选（status === superseded）task 数。无候选 ⇒ 0（⛔ 不省略——「跑过且无候选」与「没跑」
   *  在载体上可区分，硬规则 4 推论三的读生产载体半边）。 */
  candidateCount: number;
  /** 每个被枚举的 task worktree 的回收结果（枚举序）。 */
  perTask: SupersededWorktreeReclaimResult[];
  /** 实际回收（reclaimed=true）的 task id。 */
  reclaimed: string[];
  /** 候选（superseded）但被双闸跳过的 task id（存活 worker / 活进程）。 */
  skipped: string[];
}

/** 测试缝（与 cleanupOrphanWorktree 同款，null ⇒ 用真实 git / /proc / readTaskStatus）。 */
export interface SupersededReclaimOpts {
  /** 存活 worker cmdline 列表（null ⇒ enumerateLiveWorkerCmdlines()）。 */
  workerCmdlines?: string[] | null;
  /** 枚举到的 task/<id> worktree 的 task id（null ⇒ enumerateTaskWorktreeTasksAsync(root)）。 */
  worktreeTasks?: string[] | null;
  /** task id → status 读取（null ⇒ readTaskStatus(root, id)）。 */
  statusOf?: ((taskId: string) => string | null) | null;
  /** task id → worktree 路径列表（null ⇒ worktreePathsForTaskAsync(root, id)）。 */
  pathsOf?: ((taskId: string) => Promise<string[]>) | null;
  /** 门②活进程列表（null ⇒ enumerateProcs()）。 */
  procs?: ProcInfo[] | null;
  /** reaper 命令（null ⇒ 真实 worktree-process-reaper.ts --worktree <path>）。入参 worktree 路径。 */
  reaperCmd?: ((worktreePath: string) => string[]) | null;
  /** pid 解析器（null ⇒ findLiveWorkerPid 重扫 /proc 按 cmdline 匹配解出 pid）。入参 task id，返回存活
   *  worker 的 pid；读不到 ⇒ null（⛔ 不伪造 pid）。 */
  pidOf?: ((taskId: string) => number | null) | null;
  /** 信号发送器（null ⇒ process.kill）。入参 pid + 信号名（"SIGTERM"）。默认 process.kill 可抛
   *  （进程已退/无权限）——调用方 best-effort 捕获，失败 ⇒ liveWorkerSignaled=false。 */
  sendSignal?: ((pid: number, signal: string) => void) | null;
}

/**
 * superseded worktree 回收（gap-superseded-task-residual-worktree-never-reclaimed）：任务生命周期终止
 * （supersede，经 task_write 改 status）后，其残留 worktree 单调累积、只有人工手清路径。修法 = 每轮
 * reconcile 步枚举 task/<id> worktree，仅 status=superseded 进候选，双闸通过者按机件顺序回收：
 *   ① 先 `worktree-process-reaper.ts --worktree <path>`（收探针/挂死 runner——已建的正确入口，脚本自持
 *     「不杀 real claude」安全包络）；
 *   ② 再 `git worktree remove --force <path>`。
 * 双闸（回收前）：① hasLiveWorkerForTask 命中 ⇒ skippedLiveWorker（⛔ 不清，同 cleanupOrphanWorktree）；
 * ② cwd 在 worktree 内的活进程（非 zombie）⇒ skippedLiveProcess（⛔ 不清）。⛔ 分支一律保留
 * （不 `git branch -D`）——superseded 的实现偶有被后继「取用」的先例（实证表里 gap-execution-loop 的
 * ff-merge.ts 正是这么被搬走的），删分支会让这条路径永久断掉；回收的是磁盘，不是历史。
 * 门①命中且 status=superseded（本函数候选集恒 superseded，显式判 status 是防御性自证）时，对存活
 * worker 解出 pid 并发 SIGTERM（gap-superseded-mid-flight-live-worker-not-stopped）：撤回后的 worker
 * 正实现一个已知为假的前提，「继续实现」在定义上不存在有效工作可保护，故跳过磁盘回收、但终止进程；
 * 进程退出是异步的，磁盘回收留给下一轮 reconcile（届时 hasLiveWorkerForTask 已判 false）。结果独立
 * 字段 liveWorkerSignaled 记录「是否真发了信号」（⛔ 与 skippedLiveWorker 共用一个布尔会把「跳过未信号」
 * 与「跳过已信号」读成同值，硬规则 3b）。发信号失败（pid 读不到/进程已退/无权限）不致命，记 false。
 * 读不懂（任务文件缺失 / status 解析不出）给独立取值 "unreadable"，不与可回收（superseded）也不与
 * 跳过（任一真 status）同形（硬规则 3b），且一律不清。
 * best-effort：移除失败（脏树/锁/活进程）不致命，error 落盘供观测，⛔ 不抛。
 */
export async function reclaimSupersededWorktrees(
  root: string,
  opts: SupersededReclaimOpts = {},
): Promise<ReclaimSupersededResult> {
  const worktreeTasks = opts.worktreeTasks ?? await enumerateTaskWorktreeTasksAsync(root);
  if (worktreeTasks.length === 0) {
    return { candidateCount: 0, perTask: [], reclaimed: [], skipped: [] };
  }
  const statusOf = opts.statusOf ?? ((taskId: string) => readTaskStatus(root, taskId));
  const pathsOf = opts.pathsOf ?? ((taskId: string) => worktreePathsForTaskAsync(root, taskId));

  // 第一遍：读 status，仅 superseded 进候选。
  const statusByTask = new Map<string, string>();
  const candidates: string[] = [];
  for (const taskId of worktreeTasks) {
    const status = statusOf(taskId) ?? "unreadable";
    statusByTask.set(taskId, status);
    if (status === TASK_STATUS.SUPERSEDED) candidates.push(taskId);
  }

  // 双闸共享扫 /proc（仅在有候选时；无候选不白扫——同 enumerateColdStartInflight 的 short-circuit）。
  const workerCmdlines = candidates.length > 0 ? (opts.workerCmdlines ?? enumerateLiveWorkerCmdlines()) : [];
  const procs = candidates.length > 0 ? (opts.procs ?? enumerateProcs()) : [];
  const reclaimed: string[] = [];
  const skipped: string[] = [];

  const perTask: SupersededWorktreeReclaimResult[] = [];
  for (const taskId of worktreeTasks) {
    const status = statusByTask.get(taskId)!;
    if (status !== TASK_STATUS.SUPERSEDED) {
      perTask.push({ taskId, status, worktreePath: null, reclaimed: false, skippedLiveWorker: false, liveWorkerSignaled: false, skippedLiveProcess: false, branchPreserved: null, error: null });
      continue;
    }
    const paths = await pathsOf(taskId);
    const p = paths[0] ?? null;
    if (p === null) {
      perTask.push({ taskId, status, worktreePath: null, reclaimed: false, skippedLiveWorker: false, liveWorkerSignaled: false, skippedLiveProcess: false, branchPreserved: null, error: null });
      continue;
    }
    // 门①：存活 worker（同 cleanupOrphanWorktree）。
    if (hasLiveWorkerForTask(taskId, workerCmdlines)) {
      skipped.push(taskId);
      // 仅 status=superseded 才发 SIGTERM（⛔ 不含 needs-human——该状态活 worker 可能正合法收尾，语义不如
      // superseded 干净）。此分支只在候选（superseded）内到达，status 恒为 superseded；显式判 status 是
      // 防御性自证（若候选集将来扩到 needs-human，仍不会误信号）。
      let liveWorkerSignaled = false;
      if (status === TASK_STATUS.SUPERSEDED) {
        const resolvePid = opts.pidOf ?? ((taskId) => findLiveWorkerPid(taskId));
        const send = opts.sendSignal ?? ((pid, signal) => process.kill(pid, signal));
        const pid = resolvePid(taskId);
        if (pid != null) {
          try {
            send(pid, "SIGTERM");
            liveWorkerSignaled = true;
          } catch {
            liveWorkerSignaled = false; // 进程已退/无权限 ⇒ 记未发（best-effort，⛔ 不抛）。
          }
        }
      }
      perTask.push({ taskId, status, worktreePath: p, reclaimed: false, skippedLiveWorker: true, liveWorkerSignaled, skippedLiveProcess: false, branchPreserved: null, error: null });
      continue;
    }
    // 门②：cwd 在 worktree 内的活进程（非 zombie）。
    if (procs.some((proc) => proc.state !== "Z" && cwdUnder(proc.cwd, p))) {
      skipped.push(taskId);
      perTask.push({ taskId, status, worktreePath: p, reclaimed: false, skippedLiveWorker: false, liveWorkerSignaled: false, skippedLiveProcess: true, branchPreserved: null, error: null });
      continue;
    }
    // 回收动作（机件顺序）：先 reaper 再 remove。
    const reaperArgv = opts.reaperCmd ? opts.reaperCmd(p) : defaultSupersededReaperCmd(root, p);
    await runAsync(reaperArgv, { timeoutMs: 30_000 });
    const rm = await runAsync(["git", "-C", root, "worktree", "remove", "--force", p], { timeoutMs: 30_000, collectStderr: true });
    const removed = rm.status === 0;
    let branchPreserved: boolean | null = null;
    if (removed) {
      const br = await runAsync(["git", "-C", root, "rev-parse", "--verify", `task/${taskId}`], { timeoutMs: 5_000 });
      branchPreserved = br.status === 0 ? true : (br.status === null ? null : false);
    }
    if (removed) reclaimed.push(taskId);
    perTask.push({
      taskId, status, worktreePath: p, reclaimed: removed,
      skippedLiveWorker: false, liveWorkerSignaled: false, skippedLiveProcess: false,
      branchPreserved,
      error: removed ? null : (rm.stderr || "").trim() || `git worktree remove ${p} failed`,
    });
  }

  return { candidateCount: candidates.length, perTask, reclaimed, skipped };
}

/** verified 态的证据载体：status 已读为 "done"、worktree 已确认无残留。 */
export interface LandingEvidence {
  status: typeof TASK_STATUS.DONE;
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
      value: { status: TASK_STATUS.DONE, worktreePresent: false },
      verifiedBy: "task status=done ∧ no leftover worktree (independent task-side read)",
      failedReason: landingFailedReason(status, worktreePresent, taskId),
      notEvaluatedReason:
        status === null
          ? "task status unreadable (task file missing or unreadable)"
          : "worktree state unreadable (git worktree list failed)",
    },
    () => {
      // 证伪优先：任一独立量可读且证伪 ⇒ failed（⛔ 不等另一量）。
      if (status !== null && status !== TASK_STATUS.DONE) return false; // status 可读且 ≠ done
      if (worktreePresent === true) return false; // 残留 worktree
      // 证真：status=done ∧ 确认无残留。
      if (status === TASK_STATUS.DONE && worktreePresent === false) return true;
      // 读不到（status 或 worktree 读不到，且未证伪）⇒ not-evaluated（⛔ 不伪造成 failed）。
      return null;
    },
  );
}

/** 证伪理由（独立判据证伪落地时用：status≠done 或 残留 worktree，逐条拼）。 */
function landingFailedReason(status: string | null, worktreePresent: boolean | null, taskId: string): string {
  const parts: string[] = [];
  if (status !== null && status !== TASK_STATUS.DONE) parts.push(`task status=${status} (not done)`);
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
  action: "start" | "dispatch" | "idle" | "stop" | "error";
  inFlight: number;
  pool: number | null;
  stopReason: string | null;
  /** 驻留环错误边界（gap-worker-driver-resident-loop-intermittent-hang）：本轮循环体抛错时的原始
   *  message（⛔ 无错 ⇒ null）。 */
  error?: string | null;
  /** 抛错时循环体所在的步骤（step-trace：cold-start-inflight / liveness / reap / reconcile /
   *  dispatch-loop / ready-pool / apply-filters / selector / spawn-worker / write-round / sleep /
   *  wait-in-flight）。AC1 定位：error_step 指到具体步骤。 */
  errorStep?: string | null;
  liveness?: LivenessResult | null;
  /** 本轮现观测到的冷启动在飞 task id（排序后）。空数组 = 观测过且无（⛔ 与「没观测」可区分）。 */
  coldStartInflight: string[];
  /** 本轮在飞的 task id（实现中 + 机械 fan-in + 冷启动在飞，= inFlightTasks() 的返回值）。空数组 =
   *  观测过且无（⛔ 与「没观测」可区分）。gap-live-mechanical-fan-in-inflight-invisible：机械 fan-in
   *  窗口 worker 已 exit、无 outcome、无 workflow-events，round 的 task id 是 Live 页唯一可见载体。 */
  inFlightTasks?: string[];
  /** 每任务派发时刻（task id → ISO 起始时间戳，= inFlightTaskStarts() 的返回值）。gap-live-fan-in-
   *  window-elapsed-zero：round 载体此前只带 task id 不带起点，readLive 只能回退 nowMs ⇒ fan-in 窗口
   *  elapsed 恒 0。冷启动在飞 task 无内存起点（从 worktree 枚举，非本驱动派发）⇒ 不入此图，readLive
   *  对缺起点 task 仍回退 nowMs（诚实「刚起步」，⛔ 不伪造长时长）。 */
  inFlightTaskStarts?: Record<string, string>;
  /** 本轮 markNeedsHuman 翻转的结果（含 committed——gap-mark-needs-human-commit-after-write：翻转写盘
   *  即提交，committed=false 表示 repo-less no-op / 提交失败，可观测非静默）。缺省 = 本轮无翻转。 */
  needsHuman?: Array<{ id: string; ok: boolean; committed: boolean; reason: string }>;
  /** 本轮内存 needsHuman 与磁盘 status 对账清除的 task id（gap-retrystate-needshuman-no-reconcile-
   *  with-disk-ready：人把 needs-human 翻回 ready 后，内存集合据此清除、下一轮重新可派）。非空 =
   *  有对账发生（可观测非静默）；缺省/空 = 本轮无对账（⛔ 与「没观测」可区分——恒有该字段）。 */
  reconciledNeedsHuman?: string[];
  /** 本轮重试上限豁免判定的三态结果（gap-retry-cap-flip-conflates-own-defect-with-unrelated-flaky）。
   *  verdict ∈ unrelated-flaky-exempt / own-defect-counted / insufficient-data-fallback——三态在记录里可
   *  区分（AC5，硬规则 3b：判不出 ≠ 判为无关）。缺省/空 = 本轮无豁免判定。 */
  retryExemptions?: Array<{ task: string; verdict: string; reason: string; failingTestFiles: string[]; recurredTasks: string[] }>;
  /** 本轮 superseded worktree 回收结果（gap-superseded-task-residual-worktree-never-reclaimed AC7）：
   *  { candidateCount, reclaimed, skipped, perTask }。候选数为 0 时 candidateCount=0（⛔ 不省略——「跑过
   *  且无候选」与「压根没跑」在载体上可区分，硬规则 4 推论三的读生产载体半边）。缺省 null = 没跑该步
   *  （⛔ 与 candidateCount=0 区分）。 */
  supersededReclaim?: ReclaimSupersededResult | null;
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
    error: opts.error ?? null,
    error_step: opts.errorStep ?? null,
    liveness: opts.liveness ?? null,
    cold_start_inflight: opts.coldStartInflight,
    in_flight_tasks: opts.inFlightTasks ?? [],
    in_flight_task_starts: opts.inFlightTaskStarts ?? {},
    needs_human: (opts.needsHuman ?? []).map((n) => n.id),
    needs_human_committed: (opts.needsHuman ?? []).map((n) => ({ id: n.id, committed: n.committed })),
    reconciled_needs_human: opts.reconciledNeedsHuman ?? [],
    retry_exemptions: opts.retryExemptions ?? [],
    superseded_reclaim: opts.supersededReclaim ?? null,
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
    `(merge develop → delta 判定 → typecheck → scoped门 → suite → ff) to develop.`,
    `You do NOT run the suite and do NOT call the fan-in workflow yourself.`,
  ].join(" ");
}

/** AC 勾选指令（gap-worker-prompt-ac-check-via-abi-not-hand-edit）：worker 实现后逐条验证 AC、然后
 *  经 Provider ABI（`task_check` + `task_write`）记录勾选状态——⛔ 不再让 worker 手工编辑任务体的
 *  `- [ ]`/`- [x]` 复选框字符（那是「ABI 可达写却手搓」的最高频实例；依赖的 commit-after-write 已由
 *  gap-abi-missing-commit-delete-dependson-primitives 落地 ⇒ `task_write` 自己分支感知提交
 *  tasks/<id>.md）。fan-in 的 ac-precheck（suite 前 fail-fast，读 `checked===total`）会因未全勾拒翻、
 *  烧掉整条 fan-in。创建 prompt 与续做 prompt 共用。 */
function acCheckNote(): string {
  return [
    `after implementing, go through each Acceptance Criterion one-by-one and verify it is satisfied by your work;`,
    `then record the AC state through the Provider ABI — do NOT hand-edit the \`- [ ]\`/\`- [x]\` checkbox`,
    `characters in the task file yourself: call \`task_check\` to confirm, then call \`task_write\` with the`,
    `updated \`## Acceptance Criteria\` section (satisfied criteria as \`- [x]\`); \`task_write\` commits`,
    `\`tasks/<id>.md\` branch-aware on its own, so the tick reaches fan-in's ac-precheck exactly as a hand-edit would —`,
    `an AC left unchecked fails fan-in's ac-precheck and burns the whole fan-in run.`,
  ].join(" ");
}

/** 单一定义点：一个目录内本仓库测试入口 scripts/test.sh 的绝对路径（第三方项目 quay-init 不铺
 *  scripts/ 目录，无此文件）。⛔ 其余处不再各自 path.join(dir, "scripts", "test.sh")。 */
function testShAt(dir: string): string {
  return path.join(dir, "scripts", "test.sh");
}

/** 一个目录是否「本仓库形态」（有 scripts/test.sh）——第三方项目无此文件，doc-check / scoped-gate /
 *  suite 三步据此退化为「跳过 / 委托 loop.test_command」，⛔ 不调用本仓库专属脚本。 */
function hasTestSh(dir: string): boolean {
  return fs.existsSync(testShAt(dir));
}

/** 单引号 shell 转义（第三方 test_command 需 `cd <worktree> && <test_command>` 在工作树内跑——worktree
 *  路径可能含空格/特殊字符，⛔ 不裸拼）。 */
function shq(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

/** 读 <dir>/.quay/config.yml 的 loop.test_command（第三方项目 quay-init --loop 写入的全量测试命令，
 *  如 `node --test`）。缺失/不可解析/非字符串 ⇒ null。⛔ 不依赖 packages/quay/src/config.ts
 *  （第三方安装物可能无 packages/ 树）——直接 YAML 读，与 driver-config.ts 同法。 */
function readLoopTestCommand(dir: string): string | null {
  const file = path.join(dir, ".quay", "config.yml");
  let text: string;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = parseYaml(text);
  } catch {
    return null;
  }
  const loop = (parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>).loop : undefined) as
    | Record<string, unknown>
    | undefined;
  const cmd = loop && typeof loop === "object" ? (loop as Record<string, unknown>).test_command : undefined;
  return typeof cmd === "string" && cmd.trim() ? cmd.trim() : null;
}

/** scoped-gate 命令的解析结果（gap-driver-fanin-hardcoded-test-sh-third-party）：
 *  - run  argv  — 本仓库（有 scripts/test.sh）⇒ bash <argvDir>/scripts/test.sh --for-task <task>
 *                --allow-thin（与修改前逐字一致）；第三方（无 test.sh 但有 loop.test_command）⇒
 *                bash -c <test_command>（全量，第三方无 "scoped" 能力）。
 *  - skip       — 两者皆无 ⇒ 第三方项目无 scoped 能力，fan-in 跳过 scoped 门直接进全量 suite 步骤。
 *  argvDir 拼命令路径、capabilityDir 判能力（execution 侧二者都 = worktree；prompt 侧 capabilityDir
 *  = root、argvDir = 占位符 worktree 路径——同一 repo 二者同形，因 scripts/test.sh 与 .quay/config.yml
 *  都随 worktree 铺出）。 */
export type ScopedGateResolution =
  | { kind: "run"; argv: string[] }
  | { kind: "skip"; reason: string };

/** 解析 scoped-gate 命令（单一真相源，fan-in 执行侧与 worker prompt 侧共用——⛔ 两处不得出现两套
 *  标准）。 */
export function resolveScopedGateCommand(task: string, capabilityDir: string, argvDir: string): ScopedGateResolution {
  if (hasTestSh(capabilityDir)) {
    return { kind: "run", argv: ["bash", testShAt(argvDir), "--for-task", task, "--allow-thin"] };
  }
  const testCommand = readLoopTestCommand(capabilityDir);
  if (testCommand !== null) {
    // 第三方全量 test_command（如 `node --test`）依赖 cwd 定位测试树 ⇒ 显式 cd 进 argvDir（execution
    // 侧 = worktree）再跑。⛔ step()/mechSh spawn 不设 cwd（驱动 cwd 是主检出，非 worktree）。
    return { kind: "run", argv: ["bash", "-c", `cd ${shq(argvDir)} && ${testCommand}`] };
  }
  return { kind: "skip", reason: "third-party-no-scoped-tooling" };
}

/** 机械 fan-in 的 scoped 门缺省命令（gap-worker-premerge-scoped-gate-cache 抽成单一真相源）：
 *  bash <worktree>/scripts/test.sh --for-task <task> --allow-thin（本仓库）；第三方项目无
 *  scripts/test.sh ⇒ 退化为 loop.test_command（bash -c <test_command>）；两者皆无 ⇒ null（fan-in 跳过
 *  scoped 门）。⛔ 不再是唯一硬编码的 worktree scripts/test.sh 路径（本缺陷）。 */
export function scopedGateCommandFor(task: string, worktree: string): string[] | null {
  const r = resolveScopedGateCommand(task, worktree, worktree);
  return r.kind === "run" ? r.argv : null;
}

/** 机械 fan-in 的 doc-check 缺省命令（gap-driver-fanin-hardcoded-test-sh-third-party）：
 *  本仓库有 scripts/test.sh ⇒ bash <worktree>/scripts/test.sh --static-checks-doc（与修改前逐字一致）；
 *  第三方项目无该文件 ⇒ null（fan-in 跳过 doc-check，可区分取值 third-party-no-doc-check-tooling，
 *  ⛔ 不与「doc 检查真的跑了且失败」同形——硬规则 3b）。 */
export function docCheckCommandFor(worktree: string): string[] | null {
  const testSh = testShAt(worktree);
  return hasTestSh(worktree) ? ["bash", testSh, "--static-checks-doc"] : null;
}

/** 解析本 kernel 的一个 shell sibling（.sh）到 kernel plugin root 的 scripts/<name>（⛔ 非 root ——
 *  gap-promotion-driver-ready-pool-check-path-third-party：第三方项目无 plugin/scripts/，.sh 以 loose
 *  形态随包住在 scripts/ 而非 dist/）。缺 ⇒ null（调用方 fail-closed）。与 driver-shared.ts
 *  resolveResourceGateScript 同法，但经 resolveKernelPluginRoot 单一真相源（⛔ 不各写一份
 *  basename==="dist" 上跳逻辑）。 */
function resolveKernelShellSibling(name: string): string | null {
  const script = path.join(resolveKernelPluginRoot(), "scripts", name);
  return fs.existsSync(script) ? script : null;
}

/** 解析一个 kernel sibling 脚本到运行 argv 前缀（不含 "node" 可执行名）：原始 .ts ⇒
 *  ["--experimental-strip-types", <path>]；bundled dist/*.js ⇒ [<path>]（不带 flag）。两者都不在 ⇒
 *  ["--experimental-strip-types", <resolveKernelScriptsDir()>/<name>]（spawn 时 fail-closed）。
 *  resolveKernelSibling 单一真相源（⛔ 各 spawn 点不再各自重写 .ts/.js 回退——同
 *  defaultPromotionCheckArgv 手法）。 */
function kernelSiblingArgv(name: string): string[] {
  const sibling = resolveKernelSibling(name);
  return sibling
    ? (sibling.stripTypes ? ["--experimental-strip-types", sibling.path] : [sibling.path])
    : ["--experimental-strip-types", path.join(resolveKernelScriptsDir(), name)];
}

/** worker-driver 自入口的 spawn 前缀（"node" + kernelSiblingArgv("worker-driver.ts")）。锚在本 kernel
 *  安装位置（⛔ 非 root）：原始 .ts（dev tree，带 flag）或 bundled dist/worker-driver.js（installed，
 *  不带 flag）。两者都不在 ⇒ 回退 kernelScriptsDir 下的 .ts（运行期 fail-closed）。 */
function workerDriverSelfArgv(): string[] {
  return ["node", ...kernelSiblingArgv("worker-driver.ts")];
}

/** worker 侧 scoped-gate 缓存写入 CLI 签名（gap-worker-premerge-scoped-gate-cache 阶段 a）：worker 在
 *  退出前跑绿 scoped 门后，用这条命令机械写入 (task, developSha, pass) 缓存（⛔ 不靠 agent 手写 JSON）。
 *  developSha 用 `git -C <worktree> rev-parse develop`（worker 已 merge develop ⇒ develop 即其验证过的 tip）。
 *  入口经 workerDriverSelfArgv 锚在本 kernel 安装位置（⛔ 非 root/plugin/scripts/worker-driver.ts）。 */
function scopedGateCacheWriteSignature(task: string, root: string, worktree: string): string {
  return `${workerDriverSelfArgv().join(" ")} --write-scoped-gate-cache --task ${task} --develop-sha "$(git -C ${worktree} rev-parse develop)" --root ${root}`;
}

/** worker 退出前 pre-merge + scoped test 步骤（gap-worker-premerge-scoped-gate-cache 阶段 a）：worker
 *  （agent，非纯脚本）实现+提交+勾 AC 之后、driverFanInNote 退出之前，先自己 merge develop 到 worktree、
 *  跑与 fan-in 完全相同的 scoped 门命令；冲突/红则用 agent 判断力修到绿；绿后机械写 scoped-gate 缓存
 *  （供 driver 锁内 merge 到同一 develop tip 时跳过冗余 scoped-gate）；再提交退出。之所以放在 agent 回合
 *  而非纯机械脚本：收益不只是「更早发现问题」，而是「很大一部分冲突在此被直接解决掉，根本不再进入
 *  fan-in 失败路径」。创建 prompt 与续做 prompt 共用（worktree 路径由调用方填）。 */
function preMergeNote(task: string, root: string, worktree: string): string {
  const scoped = resolveScopedGateCommand(task, root, worktree);
  const lines = [
    `before exiting, do the pre-merge + scoped-gate step in your worktree:`,
    `(i) merge develop into your worktree (\`git -C ${worktree} merge --no-edit develop\`) — resolve any conflict with the Edit tool, do NOT skip;`,
  ];
  if (scoped.kind === "run") {
    lines.push(
      `(ii) run the SAME scoped gate the driver's fan-in runs: \`${scoped.argv.join(" ")}\`;`,
      `(iii) if red, fix and rerun until green;`,
      `(iv) once green, record the scoped-gate cache so fan-in skips the now-redundant scoped gate: \`${scopedGateCacheWriteSignature(task, root, worktree)}\`;`,
      `(v) commit and exit.`,
    );
  } else {
    lines.push(
      `(ii) skip the scoped gate (${scoped.reason}: third-party project has no scripts/test.sh and no loop.test_command — the driver's fan-in goes straight to the full-suite step);`,
      `(iii) commit and exit.`,
    );
  }
  return lines.join(" ");
}

/** dispatch-worktree-setup.sh 调用签名（gap-dispatch-worktree-setup-zero-production-callers）：每个
 *  被派发的 worktree 创建后【必须】跑一次（node_modules symlink-or-install + config.yml 经
 *  worktree-include.sh），机制接管 bootstrap——worker 不再手工 `ln -s`/`cp config.yml`（正是该脚本被
 *  写出来要消灭的 AGENT-REMEMBERING 失败模式）。脚本幂等：已 provision 的 worktree 重跑是 no-op。 */
function dispatchSetupSignature(root: string, worktree: string): string {
  // ⛔ 非 root/plugin/scripts/（第三方项目无 plugin/）——resolveKernelShellSibling 锚在本 kernel 安装
  // 位置；缺 ⇒ 回退 kernel plugin root 下的同路径（运行期 `bash <缺失路径>` 报错 ⇒ fail-closed）。
  const setupScript = resolveKernelShellSibling("dispatch-worktree-setup.sh")
    ?? path.join(resolveKernelPluginRoot(), "scripts", "dispatch-worktree-setup.sh");
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
    `(2) implement the task per its Proposal/Plan/AC/DoD, committing your implementation on the task branch; ${acCheckNote()}`,
    `(2b) ${preMergeNote(task, root, "<the worktree path you created in step 1>")}`,
    `(3) ${driverFanInNote()}`,
    `⚠️ CRITICAL: for CODE files, every Read/Edit/Write file_path MUST be the absolute path of the worktree you created in step 1 — never the main-checkout path \`${root}\`, never a relative path. Claude Code's file tools use absolute paths and do NOT sense shell \`cd\`; a main-checkout or relative path lands your implementation in the develop shared checkout, not your worktree. This rule does NOT cover the task file — that is edited only via \`task_write\` (see step 2 above), never Read/Edit/Write.`,
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
  /** 全部 exited-not-landed 尝试（时间序）——B：续做 prompt 带前 N 次 (ts, step, reason) 清单 + suite
   *  日志绝对路径，⛔ 只带最后一条 reason 会让重跑 worker 看不到前两次栽在哪（病根）。空 = 无记录 / 读不懂。 */
  attempts: ExitedNotLandedAttempt[];
}

/** AC 勾选状态（AC2）：读任务文件的 Acceptance Criteria 段，数 `- [x]`（勾）与 `- [ ]`（未勾）。
 *  段从 `## Acceptance Criteria` / `## AC`（含 `（draft）` / `(draft)` 后缀）标题起，到下一个 `## ` 标题止。
 *  文件缺失 / 无 AC 段 ⇒ {checked:null,total:null}（硬规则 3b：读不懂 ≠ 零——与「读到 0 条」可区分）。
 *  复选框计数委托给 task-schema.ts 的 countAcCheckboxes（gap-ac-checkbox-counting-four-counters-
 *  drifted）——`[~]`（部分完成）计入 total、算未勾，与规范实现一致；heading 识别（section-finding）
 *  仍本地持有。 */
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
  const acLines: string[] = [];
  for (const line of lines) {
    if (/^##\s+/i.test(line)) {
      if (inAc) break; // 下一个标题 ⇒ AC 段结束
      if (/^##\s+(Acceptance Criteria|AC)\b/i.test(line)) {
        inAc = true;
        found = true;
      }
      continue;
    }
    if (inAc) acLines.push(line);
  }
  if (!found) return { checked: null, total: null };
  const ac = countAcCheckboxes(acLines.join("\n"));
  return { checked: ac.checked, total: ac.total };
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

/** 派发前搜集续做状态（AC1 复用 / AC2 状态）。⛔ 无 worktree（worktreePresentForTask 非 true）⇒ null
 *  （走创建 prompt）。worktree 读不懂（null）⇒ null（创建，与「确认无残留」同向——撞死由 git 自己报，
 *  比误判复用更安全；且读不懂时 `git worktree add` 同样会失败，属 git 不可用的同一次故障）。 */
export function continueStateForTask(root: string, taskId: string): ContinueWorkerState | null {
  if (worktreePresentForTask(root, taskId) !== true) return null;
  const paths = worktreePathsForTask(root, taskId);
  const ac = readAcCheckState(root, taskId);
  const attempts = exitedNotLandedAttempts(root, taskId);
  return {
    worktreePath: paths[0] ?? null,
    branchCommits: countBranchCommits(root, taskId),
    branchHeadSubject: branchHeadSubject(root, taskId),
    acChecked: ac.checked,
    acTotal: ac.total,
    failureReason: attempts.length > 0 ? attempts[attempts.length - 1].reason : null,
    attempts,
  };
}

/** continueStateForTask 的异步版（常驻循环体用——⛔ spawnSync git 会冻住协调地板）。语义一致：
 *  无 worktree（worktreePresentForTaskAsync 非 true）⇒ null（创建路径）；worktree 读不懂（null）⇒ null
 *  （创建，与「确认无残留」同向）。/proc 与任务文件读仍是同步 fs（廉价，task 4 只点名 git，不点名 /proc）。 */
export async function continueStateForTaskAsync(root: string, taskId: string): Promise<ContinueWorkerState | null> {
  if ((await worktreePresentForTaskAsync(root, taskId)) !== true) return null;
  const paths = await worktreePathsForTaskAsync(root, taskId);
  const ac = readAcCheckState(root, taskId);
  const attempts = exitedNotLandedAttempts(root, taskId);
  return {
    worktreePath: paths[0] ?? null,
    branchCommits: await countBranchCommitsAsync(root, taskId),
    branchHeadSubject: await branchHeadSubjectAsync(root, taskId),
    acChecked: ac.checked,
    acTotal: ac.total,
    failureReason: attempts.length > 0 ? attempts[attempts.length - 1].reason : null,
    attempts,
  };
}

/** 冲突消解协议（gap-continue-prompt-conflict-resolution-protocol + gap-fan-in-continue-resolution-
 *  dual-copy-and-ff-not-fast-forward）：机械 fan-in 的 merge develop 步在 CONTINUE 轮撞冲突时，旧
 *  prompt 只带失败原因、不含消解指令 ⇒ 消冲突靠 worker 自行发挥（运气）。本段按文件类型分派消解动作：
 *  outline 冲突取 develop 版（⛔ 不手并计数）、code 文件取语义并集、任务文件（tasks/<id>.md）取 per-hunk
 *  并集（⛔ 不取 develop 版，否则抹掉本轮 - [x] AC 勾选）、dual-copy 文件两副本同步字节一致、
 *  非 outline 非 code 的 tick doc 取 develop 版、modify/delete 判删除侧、ff-not-fast-forward 重 merge
 *  develop 再 ff，然后 `git commit --no-edit` 完成 merge——⛔ 禁止带着 unmerged paths（UU）退出，
 *  否则下一轮 fan-in 的 merge step 再失败。 */
function continueConflictResolutionNote(): string {
  return [
    `CONFLICT RESOLUTION — if the prior mechanical fan-in left the worktree with unmerged paths (UU in \`git status\`), or \`git merge develop\` reports CONFLICT, resolve it BEFORE continuing implementation; ⛔ never exit while unmerged paths remain (the next fan-in merge step would fail again).`,
    `(1) outline doc (docs/proposals/quay-product-outline.md — its §6 DELIVERY-INVENTORY counts are computed at check-time, no snapshot to recompute): take the develop version (\`git checkout develop -- docs/proposals/quay-product-outline.md\`); ⛔ do NOT hand-merge the counts.`,
    `(2) code files (e.g. worker-driver.ts): read both sides of the diff and take the semantic union of the two changes (keep both changes where they do not conflict).`,
    `(2b) task files (\`tasks/<id>.md\` — your own task body or another task's): take the per-hunk union of both sides — keep develop's edits (a driver/manager may have narrowed \`## Touches\`, appended \`## Needs-Human\`, or flipped \`status:\`) AND keep your branch's edits (\`- [x]\` AC ticks, \`## Evidence\` additions). ⛔ do NOT "take the develop version" — that silently drops your AC ticks and the next fan-in's ac-precheck goes red with a misleading reason. ⛔ do NOT write \`status:\` frontmatter yourself: on a \`status:\` conflict take develop's value verbatim (the promotion/worker driver owns that field).`,
    `(3) dual-copy files (a workflow script that lives in BOTH \`.claude/workflows/*\` AND its \`plugin/workflows/*\` mirror): take the develop version, then re-sync BOTH copies byte-identical (\`git checkout develop -- .claude/workflows/<file> plugin/workflows/<file>\`); ⛔ do NOT take a semantic union — a union would make the two copies diverge and the dual-copy drift check would go red.`,
    `(4) tick doc (orchestration/*-tick-core.md, e.g. orchestration/fast-mode-tick-core.md — not outline, not code): take the develop version (\`git checkout develop -- <file>\`); ⛔ do NOT hand-merge.`,
    `(5) modify/delete CONFLICT (one side deleted the file, the other modified it): first judge WHICH side deleted — if YOUR task branch deleted it intentionally (a replacement implementation lives on the branch, e.g. a TS reincarnation of a deleted shell script) first read develop's version (\`git show develop:<file>\`) and absorb any develop-side semantic changes into your replacement implementation (e.g. writeSuiteCapture fail-open + capture 缺失回退) — THEN accept the deletion (\`git rm <file>\`), ⛔ never \`git rm\` a branch-side intentional deletion before absorbing develop's post-branch changes or you silently drop them; if develop deleted it, accept develop's deletion (\`git rm <file>\`). ⛔ never silently restore the deleted file (reviving a retired implementation), and never treat your branch's intentional deletion as "take the develop version".`,
    `(6) \`git add <resolved files>\` then \`git commit --no-edit\` to complete the merge.`,
    `FF NOT FAST-FORWARD — if the prior failure was \`step=ff: ... not fast-forward\` (NOT a merge CONFLICT; develop advanced during the long suite so the task branch fell behind): merge develop again (\`git merge develop\`, resolving any conflict per the rules above), \`git commit --no-edit\`, then re-exit — the driver re-runs fan-in and the ff will then succeed. ⛔ do NOT re-implement; this failure is branch-lag, not a code defect.`,
  ].join(" ");
}

/** 续做 prompt 前 N 次尝试清单的上限（B）。N=3 = 重试上限默认（RETRY_CAP_DEFAULT）——⛔ 不写更大的
 *  字面值让 prompt 无限长（任务体⛔ 不 copy 逐轮历史——历史仍在 worker-outcome.jsonl 单一真相源）。 */
const CONTINUE_ATTEMPT_LIST_MAX = 3;

/** B（gap-worker-execution-history-index-not-reachable-from-task）：续做 prompt 的前 N 次尝试清单。
 *  只带最后一条 reason（旧）⇒ 重跑 worker 看不到前两次栽在哪；本段把最近 N 次 exited-not-landed 尝试的
 *  (ts, step, reason) 拼进 prompt（⛔ 只取最后一条是病根）。 */
function continueAttemptsNote(attempts: ExitedNotLandedAttempt[]): string {
  if (attempts.length === 0) return "no prior exited-not-landed attempts on record.";
  const recent = attempts.slice(-CONTINUE_ATTEMPT_LIST_MAX);
  const lines = recent.map((a) => {
    const ts = a.ts ? a.ts.slice(0, 19) : "unknown-ts";
    const step = a.step ?? "unknown-step";
    const raw = a.reason ?? "(unknown)";
    // formatExitedNotLandedReason 已把 step 拼进 reason（"step=<step>: …"）；清单再写一次 step= 会重复——
    // 剥掉前缀让清单干净（⛔ 不回退 formatExitedNotLandedReason 本身——markNeedsHuman 仍要那个带 step 的判词）。
    const reason = raw.startsWith(`step=${step}: `) ? raw.slice(`step=${step}: `.length) : raw;
    return `[${ts}] step=${step}: ${reason}`;
  });
  return `prior exited-not-landed attempts (latest last, up to ${CONTINUE_ATTEMPT_LIST_MAX}): ${lines.join(" | ")}.`;
}

/** B：续做 prompt 的 suite 真因日志绝对路径（⛔ 只靠命名约定猜不出的 .quay/fan-in-suite-*.log——硬规则
 *  4c 穿不过中间层的量）。取最近一条带 suiteLog 的尝试；无 suite 红 ⇒ 空串（不伪造）。 */
function continueSuiteLogNote(attempts: ExitedNotLandedAttempt[]): string {
  for (let i = attempts.length - 1; i >= 0; i -= 1) {
    if (attempts[i].suiteLog) {
      return `the true-cause suite log from the last suite-red attempt is at ${attempts[i].suiteLog} — read it before re-implementing.`;
    }
  }
  return "";
}

// ── 续做 prompt delta-relatedness 信号 (gap-continue-prompt-delta-relatedness-note) ──────────────────
//
// 续做 prompt 已带前 N 次尝试清单 + suite 日志路径 + 冲突消解协议，唯独缺「这次 suite 失败的测试与
// 本任务改动是否相关」这条机械信号——worker 每次续做都要从零判断「这次红是不是我的问题」。本段补两条
// 【纯结构性计算、不调 LLM】的信号：
//   信号1 delta 相关性：失败测试文件本身是否在本任务 `## Touches` / 实际 diff 里；不在，再查一跳导入
//   （失败测试直接 import 的源文件）是否与本任务改动文件相交。
//   信号2 load-sensitive 注册表命中：失败测试文件是否已 `@load-sensitive` 标注（复用 known-load-
//   sensitive.ts 的注解解析，⛔ 不新造分类）。这是一条【事前存在、独立于本次失败】的证据。
// ⛔ 边界（不做什么）：只产提示不产「跳过」判断；读不懂 ⇒ "unknown"，不与「无关/未标注」同形（硬规则 3b）。

/** 信号 verdict 词表：related / unrelated（信号1 正常结论）、load-sensitive / not-annotated（信号2 正常
 *  结论）、unknown（读不懂的独立取值，⛔ 与任何正常结论共用措辞）。 */
export type RelatednessVerdict = "related" | "unrelated" | "load-sensitive" | "not-annotated" | "unknown";

/** 一条 delta-relatedness 信号。可扩展输出结构（信号3「同一 runId 连续失败同一测试」落地时追加条目，
 *  ⛔ 不重写 note 函数）。 */
export interface RelatednessSignal {
  signal: "delta-relatedness" | "load-sensitive";
  failingTest: string | null;
  verdict: RelatednessVerdict;
  reason: string;
}

/** 从 suite 日志文本提取失败测试文件（repo-relative）。node:test 每文件一行
 *  `__PERFILE__ duration_ms=… <rel> passed=false end_ms=…`——passed=false 即该文件红。读不出 ⇒ []
 *  （不伪造；空列表与「读懂了但无失败」同形，调用方据 continueSuiteLogNote 的有无判定是否 suite 红）。 */
export function failingTestFilesFromSuiteLog(logText: string): string[] {
  const out: string[] = [];
  for (const raw of String(logText ?? "").split("\n")) {
    const line = raw.trim();
    if (!line.includes("passed=false")) continue;
    // `__PERFILE__ duration_ms=… <path> passed=false …` 的 <path> 有两种实况形态（同一 runner，不同 cwd/
    // 传参路径）：repo-relative（`plugin/test/x.test.mjs`）与 worktree 绝对路径（`/…/quay-worktrees/<task>/
    // plugin/test/x.test.mjs`）。只取 repo-relative 的 `(packages|plugin|experiments)/…` 后缀，其前可接
    // 行首 / 空白 / 路径分隔符——⛔ 只匹配 `(?:^|\s)` 会漏掉绝对路径形态（`/plugin/…` 前是 `/` 非空白），
    // 使续做提示与豁免判定的失败测试集对绝对路径日志恒空（恒假，硬规则 4b）。
    const m = /(?:^|\s|\/)((?:packages|plugin|experiments)\/[^\s]+\.test\.mjs)\s+passed=false\b/.exec(line);
    if (m && !out.includes(m[1])) out.push(m[1]);
  }
  return out;
}

/** 读任务 `## Touches`（repo-relative 路径列表，normalizeRel）。任务文件缺失 / 无 Touches 段 ⇒ null
 *  （读不懂 ≠ 空 Touches——硬规则 3b；「查过且为空」与「没查成」分开）。 */
export function taskTouches(root: string, task: string): string[] | null {
  let text: string;
  try {
    text = fs.readFileSync(path.join(root, "tasks", `${task}.md`), "utf8");
  } catch {
    return null;
  }
  const sec = extractSection(text, "Touches");
  if (!sec) return null;
  return parseTouchEntriesWithTags(sec)
    .map((e) => e.path)
    .filter(Boolean)
    .map((p) => normalizeRel(String(p)));
}

/** 读任务分支的实际 diff（`git diff --name-only HEAD...task/<id>`——三点差 = 该分支【自己】相对 merge-base
 *  的净变更，⛔ 不含 develop 侧推进）。git 失败 / 分支不存在 ⇒ null（读不懂 ≠ 空 diff）。 */
export function taskDeltaFiles(root: string, task: string): string[] | null {
  const r = spawnSync("git", ["-C", root, "diff", "--name-only", `HEAD...task/${task}`], { encoding: "utf8" });
  if (r.status !== 0 || r.error) return null;
  return String(r.stdout ?? "").split("\n").map((s) => s.trim()).filter(Boolean).map(normalizeRel);
}

/** 信号1 的 delta 并集：Touches（必需，读不懂 ⇒ null ⇒ unknown）+ 实际 diff（best-effort，git 失败只用
 *  Touches——单测 makeRoot 非 git 根也照常判定）。 */
export function computeDeltaPaths(root: string, task: string): string[] | null {
  const touches = taskTouches(root, task);
  if (touches === null) return null;
  const diff = taskDeltaFiles(root, task);
  const set = new Set(touches);
  for (const p of diff ?? []) set.add(p);
  return [...set];
}

/** 解析一个测试文件的【直接 import】为 repo-relative 源文件路径（一跳）。只解析相对说明符
 *  （`./x` / `../x`）；裸说明符（node_modules / `node:` / 绝对）跳过。读文件失败 ⇒ null（读不懂 ≠ 空 import）。 */
export function directImportRels(root: string, testFileRel: string): string[] | null {
  let text: string;
  try {
    text = fs.readFileSync(path.join(root, testFileRel), "utf8");
  } catch {
    return null;
  }
  const dir = path.posix.dirname(normalizeRel(testFileRel));
  const rels = new Set<string>();
  // `import … from "spec"` / `import "spec"` / `export … from "spec"`——相对说明符才是一跳源文件。
  const re = /(?:^|\n)[ \t]*(?:import|export)[ \t]+(?:[^'"`\n]*?[ \t]+from[ \t]+)?["']([^"']+)["']/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const spec = m[1];
    if (!spec.startsWith(".")) continue;
    const resolved = normalizeRel(path.posix.join(dir, spec));
    if (resolved) rels.add(resolved);
  }
  return [...rels];
}

/** 一条 import 是否命中 delta 任一文件：精确相等；无扩展名补 `.ts/.mjs/.js/.tsx/.jsx`；`.js(.x)` 补
 *  `.ts(.x)` 变体（TS-ESM 里 `from "./x.js"` 映射到 `x.ts`）。 */
function importHitsDelta(importRel: string, deltaSet: Set<string>): boolean {
  const base = normalizeRel(importRel);
  const ext = path.posix.extname(base);
  const candidates = [base];
  if (!ext) {
    for (const e of [".ts", ".mjs", ".js", ".tsx", ".jsx"]) candidates.push(base + e);
  } else if (ext === ".js" || ext === ".jsx") {
    candidates.push(base.slice(0, -ext.length) + (ext === ".js" ? ".ts" : ".tsx"));
  }
  return candidates.some((c) => deltaSet.has(c));
}

/** 信号1 纯判定：失败测试文件是否在本任务 delta 里；不在，再查一跳导入是否与本任务改动文件相交。
 *  delta 读不懂 ⇒ unknown；测试文件读不懂（import 解析失败）且不在 delta ⇒ unknown（⛔ 与「无关」同形）。 */
export function classifyDeltaRelatedness(
  failingTestRel: string | null,
  deltaPaths: string[] | null,
  importRels: string[] | null,
): { verdict: RelatednessVerdict; reason: string } {
  if (deltaPaths === null) {
    return { verdict: "unknown", reason: "unable to determine this task's Touches/diff (delta unreadable)" };
  }
  const rel = failingTestRel ? normalizeRel(String(failingTestRel)) : null;
  if (!rel) {
    return { verdict: "unknown", reason: "no failing test file resolved" };
  }
  const deltaSet = new Set(deltaPaths.map(normalizeRel));
  if (deltaSet.has(rel)) {
    return { verdict: "related", reason: "the failing test file itself is in this task's Touches/diff" };
  }
  if (importRels === null) {
    return { verdict: "unknown", reason: "unable to read the failing test's direct imports (one-hop check unavailable)" };
  }
  if (importRels.some((imp) => importHitsDelta(imp, deltaSet))) {
    return { verdict: "related", reason: "the failing test directly imports a file this task's delta touches (one-hop)" };
  }
  return { verdict: "unrelated", reason: "the failing test file is not in this task's Touches/diff, and its direct imports do not intersect this task's delta (one-hop check)" };
}

/** 信号2 纯判定：失败测试文件是否 `@load-sensitive` 标注（复用 known-load-sensitive.ts 的注解解析）。
 *  读文件失败 ⇒ unknown（⛔ 与「未标注」同形）。 */
export function classifyLoadSensitive(root: string, failingTestRel: string): RelatednessVerdict {
  let text: string;
  try {
    text = fs.readFileSync(path.join(root, failingTestRel), "utf8");
  } catch {
    return "unknown";
  }
  return parseLoadSensitiveAnnotation(text) !== null ? "load-sensitive" : "not-annotated";
}

/** 对一个失败测试文件产出两条信号（delta 相关性 + load-sensitive 注册表命中）。 */
export function relatednessSignalsFor(root: string, task: string, failingTestRels: string[]): RelatednessSignal[] {
  const delta = computeDeltaPaths(root, task);
  const signals: RelatednessSignal[] = [];
  for (const rel of failingTestRels) {
    const d = classifyDeltaRelatedness(rel, delta, delta === null ? null : directImportRels(root, rel));
    signals.push({ signal: "delta-relatedness", failingTest: rel, verdict: d.verdict, reason: d.reason });
    const l = classifyLoadSensitive(root, rel);
    signals.push({
      signal: "load-sensitive",
      failingTest: rel,
      verdict: l,
      reason: l === "load-sensitive" ? "declared @load-sensitive" : l === "not-annotated" ? "no @load-sensitive declaration" : "unable to read the test file",
    });
  }
  return signals;
}

/** 把信号列表拼成续做提示文本。措辞明确「这不是结论，是提示，请重跑验证」，⛔ 不含「跳过/无需检查」等
 *  可被误读为自动放行的措辞（AC4）。 */
export function formatRelatednessNote(signals: RelatednessSignal[]): string {
  if (signals.length === 0) return "";
  const lines = signals.map((s) => {
    if (s.signal === "delta-relatedness") {
      const v = s.verdict === "related" ? "RELATED" : s.verdict === "unrelated" ? "UNRELATED" : "UNKNOWN";
      return `  - ${s.failingTest}: delta-relatedness = ${v} (${s.reason})`;
    }
    const v = s.verdict === "load-sensitive" ? "registered @load-sensitive" : s.verdict === "not-annotated" ? "not @load-sensitive-annotated" : "UNKNOWN";
    return `  - ${s.failingTest}: load-sensitive registry = ${v}`;
  });
  return [
    "delta-relatedness check (mechanical, not a verdict — verify before acting):",
    ...lines,
    "This is a hint, not a conclusion: it does not prove the failure is unrelated to this task. Re-run the suite once to verify before assuming it is environmental; if it reproduces, treat it as a real finding regardless of this note.",
  ].join("\n");
}

/** 续做 prompt 的 delta-relatedness 提示（只在 suite 红时触发，放 continueSuiteLogNote 旁）。取最近一条
 *  带 suiteLog 的尝试，读其 suite 日志提取失败测试，对每个失败测试产出两条信号。无 suite 红 / 读不出
 *  失败测试 ⇒ 空串（不伪造——与 continueSuiteLogNote 同向）。 */
export function continueRelatednessNote(root: string, task: string, attempts: ExitedNotLandedAttempt[]): string {
  let suiteLogPath: string | null = null;
  for (let i = (attempts ?? []).length - 1; i >= 0; i -= 1) {
    if (attempts[i].suiteLog) { suiteLogPath = attempts[i].suiteLog; break; }
  }
  if (!suiteLogPath) return "";
  let logText: string;
  try {
    logText = fs.readFileSync(suiteLogPath, "utf8");
  } catch {
    return "";
  }
  const failing = failingTestFilesFromSuiteLog(logText);
  if (failing.length === 0) return "";
  return formatRelatednessNote(relatednessSignalsFor(root, task, failing));
}

// ── 重试上限豁免判定（gap-retry-cap-flip-conflates-own-defect-with-unrelated-flaky）─────────────────
// 根因：driver-filters.ts RETRY_CAP_DEFAULT=3 的 markNeedsHuman 机械翻转不看 suite red 命中的失败测试
// 文件是否落在该任务 `## Touches` 声明范围内——任务自身改动引入的真缺陷、与任务无关的既有测试基础设施
// flaky，消耗同一份 3 次重试预算（48h 复盘：26 次 needs-human 里 ~8-9 次真实断言是同一条 probe 饿死，
// 与各自任务改动无关）。本段补一条【纯结构性判定、不调 LLM】的归因，在 onWorkerFinished 决定「本次
// exited-not-landed 是否计入该任务自身重试计数」：
//   ① 失败测试文件集合（suite log 提取）与该任务 Touches/diff 做交集——任一命中 ⇒ 任务自身缺陷，照常计数。
//   ② 断言签名（suite log 的 `AssertionError …: msg` 归一化）跨任务复发——近期窗口内 ≥2 个不同任务命中
//     同一签名 ⇒ 已知反复出现的既有 flaky。
//   ③ ①全无关 ∧ ②复发 ⇒ 本次不计入重试计数（继续重派，⛔ 不是无条件豁免）；否则照常计数。
// 三态可区分（硬规则 3b/AC5）：unrelated-flaky-exempt / own-defect-counted / insufficient-data-fallback
// ——「判不出」与「判为无关」绝不共用同一取值。⛔ 只减重试计数，不改 markNeedsHuman 的止损语义：任务
// 自身缺陷照旧在第 3 次翻转 needs-human（AC2 负控制）。

/** 重试豁免三态 verdict。own-defect-counted 与 insufficient-data-fallback 都【照常计数】，但后者表示
 *  「读不懂/数据不足」而非「判定为任务自身缺陷」——两态在记录里必须可区分（硬规则 3b）。 */
export type RetryExemptionVerdict = "unrelated-flaky-exempt" | "own-defect-counted" | "insufficient-data-fallback";

/** 一次 exited-not-landed 的重试豁免判定结果（可扩展输出，⛔ 不重写接线）。 */
export interface RetryExemptionJudgment {
  verdict: RetryExemptionVerdict;
  reason: string;
  /** 本次 suite red 的失败测试文件（repo-relative）。 */
  failingTestFiles: string[];
  /** 本次 suite log 提取的归一化断言签名。 */
  signatures: string[];
  /** 窗口内命中同一签名的【其它】不同任务 id（豁免时非空；非豁免 = []）。 */
  recurredTasks: string[];
}

/** 近期窗口缺省：48h（与提案 48h needs-human 复盘同窗）。非新设数值阈值——只是「近期」的操作化，与
 *  flaky 复发语义一致（两周前的 flaky 不算「已知反复出现」）；测试缝可覆盖。 */
export const RETRY_EXEMPTION_WINDOW_MS_DEFAULT = 48 * 3600 * 1000;

/** 从 suite 日志提取归一化断言签名（`AssertionError [ERR_ASSERTION]: msg` / `AssertionError: msg`）。
 *  归一化 = trim + 折叠内部空白（同一断言换行/缩进差异折叠成同一签名）。读不出 ⇒ []（不伪造；动态
 *  路径断言每次不同 ⇒ 归一化后仍不同 ⇒ 不匹配，fail-closed 朝「不复返、照常计数」，硬规则 3b）。 */
export function assertionSignaturesFromSuiteLog(logText: string): string[] {
  const out: string[] = [];
  for (const raw of String(logText ?? "").split("\n")) {
    const m = /AssertionError(?:\s*\[[^\]]*\])?:\s*(.+)$/.exec(raw);
    if (!m) continue;
    const sig = m[1].trim().replace(/\s+/g, " ");
    if (sig && !out.includes(sig)) out.push(sig);
  }
  return out;
}

/** 窗口内全部 suite-red exited-not-landed 尝试（跨任务，⛔ 非 per-task）。读 WORKER_OUTCOME_REL 一次，
 *  对每条 final_state=exited-not-landed ∧ mechanical_fan_in.step=suite ∧ ts 落在 [nowMs-windowMs, nowMs]
 *  的记录，投影出 (taskId, ts, suiteLog 绝对路径)。读失败 / 无记录 ⇒ []（读不懂 ≠ 无失败——空清单与
 *  「无记录」同形，豁免判定据此保守回退，⛔ 不伪造成「无复发」）。 */
export function suiteRedAttemptsInWindow(
  root: string,
  windowMs: number,
  nowMs: number = Date.now(),
): Array<{ taskId: string; ts: string; suiteLog: string | null }> {
  let text: string;
  try {
    text = fs.readFileSync(path.join(root, WORKER_OUTCOME_REL), "utf8");
  } catch {
    return [];
  }
  const floor = nowMs - windowMs;
  const out: Array<{ taskId: string; ts: string; suiteLog: string | null }> = [];
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let rec: { task?: unknown; final_state?: unknown; ts?: unknown; mechanical_fan_in?: unknown };
    try {
      rec = JSON.parse(trimmed);
    } catch {
      continue;
    }
    if (rec.final_state !== "exited-not-landed") continue;
    if (typeof rec.ts !== "string" || typeof rec.task !== "string") continue;
    const tsMs = Date.parse(rec.ts);
    if (!Number.isFinite(tsMs) || tsMs < floor || tsMs > nowMs) continue;
    const mfi = rec.mechanical_fan_in as { step?: unknown; suiteLog?: unknown } | undefined;
    if (!mfi || mfi.step !== "suite") continue;
    const suiteLog = typeof mfi.suiteLog === "string" && mfi.suiteLog
      ? path.join(root, ".quay", mfi.suiteLog)
      : null;
    out.push({ taskId: rec.task, ts: rec.ts, suiteLog });
  }
  return out;
}

/** 签名跨任务复发：窗口内命中 `signatures` 任一签名的【其它】不同任务 id 并集（⛔ 不含当前任务自身——
 *  「≥2 个不同任务命中同一签名」= 当前任务 + ≥1 其它任务）。其它任务的 suite log 读失败 ⇒ 跳过（该任务
 *  不贡献复发证据，fail-closed 朝「不复发」，⛔ 不伪造命中）。 */
function recurringSignatureTasks(
  root: string,
  signatures: string[],
  currentTaskId: string,
  windowMs: number,
  nowMs: number,
): string[] {
  const sigTasks = new Map<string, Set<string>>();
  for (const a of suiteRedAttemptsInWindow(root, windowMs, nowMs)) {
    if (a.taskId === currentTaskId || !a.suiteLog) continue;
    let logText: string;
    try {
      logText = fs.readFileSync(a.suiteLog, "utf8");
    } catch {
      continue;
    }
    for (const sig of assertionSignaturesFromSuiteLog(logText)) {
      if (!signatures.includes(sig)) continue;
      if (!sigTasks.has(sig)) sigTasks.set(sig, new Set());
      sigTasks.get(sig)!.add(a.taskId);
    }
  }
  const tasks = new Set<string>();
  for (const sig of signatures) {
    const set = sigTasks.get(sig);
    if (set) for (const t of set) tasks.add(t);
  }
  return [...tasks];
}

/** 重试豁免判定（纯结构性、不调 LLM、不写盘）。对一次 exited-not-landed 判定「本次是否计入该任务自身
 *  重试计数」。⛔ 只判 suite-red（非 suite red = merge 冲突 / typecheck / scoped-gate / ac-gate 等，天然
 *  是任务自身缺陷候选，无「不相关 flaky」可豁免）。读不懂的每一步都回退 insufficient-data-fallback
 *  （照常计数），绝不与 unrelated-flaky-exempt 同形（硬规则 3b）。 */
export function judgeRetryExemption(
  root: string,
  taskId: string,
  outcome: unknown,
  opts: { windowMs?: number; nowMs?: number } = {},
): RetryExemptionJudgment {
  const windowMs = opts.windowMs ?? RETRY_EXEMPTION_WINDOW_MS_DEFAULT;
  const nowMs = opts.nowMs ?? Date.now();
  const mfi = (outcome && typeof outcome === "object")
    ? (outcome as { mechanical_fan_in?: unknown }).mechanical_fan_in
    : undefined;
  if (!mfi || typeof mfi !== "object") {
    return { verdict: "insufficient-data-fallback", reason: "no mechanical fan-in result on the outcome (cannot attribute)", failingTestFiles: [], signatures: [], recurredTasks: [] };
  }
  const step = (mfi as { step?: unknown }).step;
  if (step !== "suite") {
    return { verdict: "own-defect-counted", reason: `failure is not a suite red (step=${typeof step === "string" ? step : "?"}) — not an unrelated-flaky candidate`, failingTestFiles: [], signatures: [], recurredTasks: [] };
  }
  const suiteLogBasename = (mfi as { suiteLog?: unknown }).suiteLog;
  if (typeof suiteLogBasename !== "string" || !suiteLogBasename) {
    return { verdict: "insufficient-data-fallback", reason: "no suite log recorded on the mechanical fan-in result", failingTestFiles: [], signatures: [], recurredTasks: [] };
  }
  const suiteLogPath = path.join(root, ".quay", suiteLogBasename);
  let logText: string;
  try {
    logText = fs.readFileSync(suiteLogPath, "utf8");
  } catch {
    return { verdict: "insufficient-data-fallback", reason: `unable to read suite log ${suiteLogPath}`, failingTestFiles: [], signatures: [], recurredTasks: [] };
  }
  const failingTestFiles = failingTestFilesFromSuiteLog(logText);
  if (failingTestFiles.length === 0) {
    return { verdict: "insufficient-data-fallback", reason: "no failing test file extracted from the suite log", failingTestFiles: [], signatures: [], recurredTasks: [] };
  }
  const signatures = assertionSignaturesFromSuiteLog(logText);
  if (signatures.length === 0) {
    return { verdict: "insufficient-data-fallback", reason: "no assertion signature extracted from the suite log", failingTestFiles, signatures: [], recurredTasks: [] };
  }
  // ① 失败测试文件与任务 Touches/diff 交集——任一命中 ⇒ 任务自身缺陷，照常计数（AC2 防滥用负控制）。
  const delta = computeDeltaPaths(root, taskId);
  if (delta === null) {
    return { verdict: "insufficient-data-fallback", reason: "unable to read this task's Touches/diff (delta unreadable)", failingTestFiles, signatures, recurredTasks: [] };
  }
  for (const rel of failingTestFiles) {
    const d = classifyDeltaRelatedness(rel, delta, directImportRels(root, rel));
    if (d.verdict === "related") {
      return { verdict: "own-defect-counted", reason: `failing test ${rel} is in this task's Touches/diff (own defect)`, failingTestFiles, signatures, recurredTasks: [] };
    }
    if (d.verdict === "unknown") {
      return { verdict: "insufficient-data-fallback", reason: `unable to determine relatedness of failing test ${rel}`, failingTestFiles, signatures, recurredTasks: [] };
    }
  }
  // ② 全部失败测试文件与本任务无关 ⇒ 查签名跨任务复发。
  const recurredTasks = recurringSignatureTasks(root, signatures, taskId, windowMs, nowMs);
  if (recurredTasks.length >= 1) {
    return { verdict: "unrelated-flaky-exempt", reason: `signature(s) ${signatures.join("; ")} recurred across ≥2 distinct tasks in window (other: ${recurredTasks.join(", ")})`, failingTestFiles, signatures, recurredTasks };
  }
  return { verdict: "own-defect-counted", reason: "failing tests unrelated to this task's delta, but the assertion signature did not recur across ≥2 distinct tasks in the window (fail-closed count)", failingTestFiles, signatures, recurredTasks: [] };
}

/** 续做 prompt（AC1/AC2）：复用已有 worktree（⛔ 不 create，create 撞已存在对象 fatal），并携带前一轮
 *  状态（分支提交 / AC 勾选 / 失败原因 / 前 N 次尝试清单 + suite 日志路径）供 worker 从保留 worktree
 *  继续。⛔ 不含 "create an isolated git worktree"（AC1 取假判据——旧 prompt 逐字说 create 是撞死根因）。
 *  gap-fan-in-continue-prompt-not-migrated-to-mechanical：续做同样用 driverFanInNote()（worker 实现后
 *  退出、driver 接手机械跑 fan-in），⛔ 不再写 fanInSignature（旧 workflow 兜底签名——worker 永不自己
 *  调 fan-in-execute workflow；语义兜底是 driver 按机械 red step 的决定，不再写进下一轮 worker 的 prompt）。 */
export function buildContinueWorkerPrompt(task: string, root: string, state: ContinueWorkerState): string {
  const wt = state.worktreePath ?? "(unknown path)";
  const commits = state.branchCommits == null ? "?" : String(state.branchCommits);
  const head = state.branchHeadSubject ? ` (head: "${state.branchHeadSubject}")` : "";
  const ac = state.acChecked == null || state.acTotal == null ? "?" : `${state.acChecked}/${state.acTotal}`;
  const reason = state.failureReason ?? "(unknown)";
  const attempts = state.attempts ?? [];
  return [
    `You are a per-task worker in the quay repo (SPEC-worker-driven-inner §5 阶段 2).`,
    `Task: ${task}. Repo root: ${root}.`,
    `CONTINUE (reuse, ⛔ do NOT create): a worktree for ${task} already exists at ${wt}`,
    `on branch task/${task} from a prior exited-not-landed round — reuse it; do NOT run \`git worktree add\``,
    `(it would fail: the path/branch already exists). Prior round state: branch task/${task} already has`,
    `${commits} commits${head}; Acceptance Criteria currently checked ${ac};`,
    `the last round exited-not-landed because: ${reason}.`,
    `${continueAttemptsNote(attempts)}`,
    `${continueSuiteLogNote(attempts)}`,
    `${continueRelatednessNote(root, task, attempts)}`,
    `${continueConflictResolutionNote()}`,
    `Re-provision the existing worktree first (idempotent, no-op if already set up): \`${dispatchSetupSignature(root, wt)}\`.`,
    `Run the remaining chain in the existing worktree: (1) continue implementing per the task's`,
    `Proposal/Plan/AC/DoD (⛔ do not redo the ${commits} commits already on the branch); ${acCheckNote()}`,
    `(1b) ${preMergeNote(task, root, wt)}`,
    `(2) ${driverFanInNote()}.`,
    `⚠️ CRITICAL: for CODE files, every Read/Edit/Write file_path MUST be the worktree absolute path ${wt} — never the main-checkout path \`${root}\`, never a relative path. Claude Code's file tools use absolute paths and do NOT sense shell \`cd\`; a main-checkout or relative path lands your change in develop, not your worktree. This rule does NOT cover the task file — that is edited only via \`task_write\` (see above), never Read/Edit/Write.`,
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

// ── 快速死亡退避（gap-worker-driver-selector-api-error-no-backoff）────────────────────────────
// worker-driver 对 selector API 错误 / fallback 失败的【快速死亡】（<60s 墙钟）无退避——17:22–17:56 两任务
// 54 次「worker exited with code 1」全部 <60s 快速重派，纯烧派发预算（subagent spawn 预算 / 会话累计）。
// 修法（⛔ 不修模型名——那是 a7a507eab 治「为什么 400」；本条治「出错时为什么无退避疯狂重试」，两条独立）：
//   worker <quickDeathMs 连续死亡 ≥backoffThreshold 次 ⇒ 对该任务加指数退避（backoffUntil，⛔ 不立即重派），
//   重派间隔随连续死亡次数指数增长、封顶 maxBackoffMs；退避到上限（maxRetries，复用现有重试上限机制的
//   --max-retries 旋钮）⇒ markNeedsHuman（⛔ 不无限退避）。退避状态按 task 记（⛔ 不全局——一个任务退避
//   不该拖垮别的任务，AC2）。机制常量值不依赖宿主规格（硬规则 4 推论二：quickDeathMs=60s 是提案观测到的
//   「<60s 快速重派」、baseBackoffMs/maxBackoffMs 是【指数退避的几何底/顶】非机器核数/内存上限）。

/** 快速死亡退避配置。quickDeathMs/backoffThreshold/baseBackoffMs/maxBackoffMs 是机制常量（非宿主
 *  规格阈值），退避上限（markNeedsHuman 阈值）复用现有 --max-retries（backoffMaxRetries 由调用方传
 *  maxRetries，⛔ 不再新设一个数值旋钮——plan item 3「复用现有重试上限机制」）。 */
export interface QuickDeathBackoffConfig {
  /** 墙钟 < 此值（ms）判为「快速死亡」。 */
  quickDeathMs: number;
  /** 连续快速死亡 ≥ 此次数才开始退避（M，AC1「连续死亡 ≥M 次后」）。 */
  backoffThreshold: number;
  /** 第一次退避的等待 ms（指数底数）。 */
  baseBackoffMs: number;
  /** 退避等待上限 ms（指数增长封顶——plan item 1「退避上限可配置」）。 */
  maxBackoffMs: number;
}

export const QUICK_DEATH_BACKOFF_DEFAULT: QuickDeathBackoffConfig = {
  quickDeathMs: 60_000,
  backoffThreshold: 1,
  baseBackoffMs: 30_000,
  maxBackoffMs: 300_000,
};

/** 快速死亡终态：worker 没跑完就死（failed 退出非零 / spawn-failed 起不来 / killed 被信号杀）。
 *  exited-not-landed 是「跑完没落地」（自有重试上限机制）、timed-out 是「超时被杀保留 worktree」
 *  （自有语义），两者都不算「快速死亡」——⛔ 与既有机制重叠计数（同一条失败路径进两个桶）。 */
const QUICK_DEATH_FINAL_STATES: ReadonlySet<string> = new Set(["failed", "spawn-failed", "killed"]);

/** 是否「快速死亡」：终态属快速死亡类 ∧ 墙钟 < quickDeathMs。 */
export function isQuickDeath(
  finalState: string,
  wallClockMs: number,
  cfg: QuickDeathBackoffConfig = QUICK_DEATH_BACKOFF_DEFAULT,
): boolean {
  return QUICK_DEATH_FINAL_STATES.has(finalState) && wallClockMs < cfg.quickDeathMs;
}

/** 指数退避等待：baseBackoffMs * 2^(consecutive - backoffThreshold)，封顶 maxBackoffMs（⛔ 不无限增长）。 */
export function backoffDelayMs(
  consecutive: number,
  cfg: QuickDeathBackoffConfig = QUICK_DEATH_BACKOFF_DEFAULT,
): number {
  const exp = Math.max(0, consecutive - cfg.backoffThreshold);
  return Math.min(cfg.maxBackoffMs, cfg.baseBackoffMs * 2 ** exp);
}

/** 快速死亡退避状态（按 task 记，⛔ 不全局）。跨轮存活于常驻循环内（⛔ 不落盘，与 RetryState 同寿命）。 */
export interface QuickDeathBackoffState {
  /** task id → 连续快速死亡次数。 */
  counts: Map<string, number>;
  /** task id → 退避到此时刻（epoch ms）。now < until 期间不重派该 task。 */
  backoffUntil: Map<string, number>;
}

/** 新建一个退避状态。 */
export function newQuickDeathBackoffState(): QuickDeathBackoffState {
  return { counts: new Map(), backoffUntil: new Map() };
}

/** 该 task 此刻是否在退避中（backoffUntil 未到）。 */
export function isBackedOff(state: QuickDeathBackoffState, taskId: string, nowMs: number): boolean {
  const until = state.backoffUntil.get(taskId);
  return until != null && nowMs < until;
}

/** 记录一次 worker 终态对退避状态的影响（纯逻辑，可单测）：
 *   非快速死亡（worker 活过 quickDeathMs，或 completed/exited-not-landed/timed-out）⇒ 复位连续计数
 *   （「连续」断链，⛔ 不把慢速失败算进快速死亡序列）。
 *   快速死亡 ⇒ 连续计数 +1；≥backoffMaxRetries ⇒ newlyNeedsHuman（⛔ 不设 backoffUntil——转 needs-human
 *   由 notNeedsHuman/retryExhausted 过滤负责停止重派，不再退避）；否则 ≥backoffThreshold ⇒ 设 backoffUntil。
 *  @returns { quickDeath, backedOff, newlyNeedsHuman } */
export function recordQuickDeathBackoff(
  state: QuickDeathBackoffState,
  taskId: string,
  finalState: string,
  wallClockMs: number,
  nowMs: number,
  backoffMaxRetries: number,
  cfg: QuickDeathBackoffConfig = QUICK_DEATH_BACKOFF_DEFAULT,
): { quickDeath: boolean; backedOff: boolean; newlyNeedsHuman: boolean } {
  if (!isQuickDeath(finalState, wallClockMs, cfg)) {
    state.counts.delete(taskId);
    state.backoffUntil.delete(taskId);
    return { quickDeath: false, backedOff: false, newlyNeedsHuman: false };
  }
  const n = (state.counts.get(taskId) ?? 0) + 1;
  state.counts.set(taskId, n);
  if (n >= backoffMaxRetries) {
    state.backoffUntil.delete(taskId);
    return { quickDeath: true, backedOff: false, newlyNeedsHuman: true };
  }
  const backedOff = n >= cfg.backoffThreshold;
  if (backedOff) state.backoffUntil.set(taskId, nowMs + backoffDelayMs(n, cfg));
  return { quickDeath: true, backedOff, newlyNeedsHuman: false };
}

/** 解析 --quick-death-ms <ms>（快速死亡墙钟阈值）。缺省/非法 ⇒ 缺省（fail-to-default 约定）。 */
export function parseQuickDeathMs(raw: string | undefined): number {
  if (raw == null) return QUICK_DEATH_BACKOFF_DEFAULT.quickDeathMs;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : QUICK_DEATH_BACKOFF_DEFAULT.quickDeathMs;
}

/** 解析 --backoff-base-ms <ms>（指数退避底数）。缺省/非法 ⇒ 缺省（fail-to-default 约定）。 */
export function parseBackoffBaseMs(raw: string | undefined): number {
  if (raw == null) return QUICK_DEATH_BACKOFF_DEFAULT.baseBackoffMs;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : QUICK_DEATH_BACKOFF_DEFAULT.baseBackoffMs;
}

/** 解析 --backoff-max-ms <ms>（指数退避封顶）。缺省/非法 ⇒ 缺省（fail-to-default 约定）。 */
export function parseBackoffMaxMs(raw: string | undefined): number {
  if (raw == null) return QUICK_DEATH_BACKOFF_DEFAULT.maxBackoffMs;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : QUICK_DEATH_BACKOFF_DEFAULT.maxBackoffMs;
}

/** 解析 --backoff-threshold <n>（连续快速死亡 M 次才开始退避）。缺省/非法 ⇒ 缺省（fail-to-default）。 */
export function parseBackoffThreshold(raw: string | undefined): number {
  if (raw == null) return QUICK_DEATH_BACKOFF_DEFAULT.backoffThreshold;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 1 ? n : QUICK_DEATH_BACKOFF_DEFAULT.backoffThreshold;
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
 * ff 前的干净判据由 ff-merge.ts 模块自持（含 promotion status-flip 自动收敛），非驱动代劳。
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

// ── dispatch 持久记录（gap-worker-driver-restart-orphan-no-outcome-no-timeout）────────────────────
// driver 重启孤儿化在飞 worker 的元数据持久化：旧 driver 把 spawn 的 dispatch 元数据（selector 理由 /
// runId / 原始派发时刻 / 原始超时截止时刻 / spawn cmdline）原子写进 <root>/.quay/worker-dispatch.json
// （按 taskId 索引的单文件 map），在终态被正常计算时清除对应条目。旧 driver 死 ⇒ 内存 running 整体丢失，
// 但这份持久影子存活 ⇒ 新 driver 的 reconcile 能读到「这个 task 为什么在飞、是哪次 dispatch、跑了多久、
// 原定超时预算是多少」，据此 adopt（纳入超时监管）或 finalize（已死补终态），⛔ 不再是「排除集之外一片黑箱」。

/** 一条 dispatch 持久记录（spawn 后写、终态后清；driver 重启遗留的条目 = 孤儿在飞）。 */
export interface DispatchRecord {
  taskId: string;
  runId: string;
  workerPid: number;
  selectorReason: string;
  /** 派发时刻（epoch ms）。 */
  startedAtMs: number;
  /** 原始超时截止时刻（epoch ms）；0 = 无超时（与 timeoutMs>0 对齐）。adopt 沿用此值，⛔ 不重置。 */
  timeoutDeadlineMs: number;
  /** spawn 时的归一化 cmdline（argv 空格 join）——观测抓手 + adopt 时 hasLiveWorkerForTask 复核的参照
   *  （⛔ 不裸信 pid 数字，避免 pid 复用误判）。 */
  cmdlineFingerprint: string;
}

/** dispatch 记录文件的绝对路径。 */
export function dispatchStoreFile(root: string): string {
  return path.join(root, WORKER_DISPATCH_REL);
}

/** 读整份 dispatch store（taskId → record）；文件缺失 / 解析失败 ⇒ {}（fail-soft，硬规则 3b：读不懂
 *  ≠ 无记录，但方向是「少 adopt ⇒ 维持现状」，⛔ 不是 fail-closed 到「全部孤儿」——那会误接管手工起的 worker）。 */
export function readDispatchStore(file: string): Record<string, DispatchRecord> {
  let text: string;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch {
    return {};
  }
  try {
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as Record<string, DispatchRecord>;
    return {};
  } catch {
    return {};
  }
}

/** 原子写整份 dispatch store（tmp + rename，外部读者绝不读到半截——与 appendWorkerPid 同手法）。 */
export function writeDispatchStore(file: string, store: Record<string, DispatchRecord>): void {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    fs.writeFileSync(tmp, JSON.stringify(store, null, 2), "utf8");
    fs.renameSync(tmp, file);
  } catch {
    /* dispatch store 是观测抓手 + 孤儿 adopt/finalize 的输入，写失败不改变主流程（同 appendWorkerPid） */
  }
}

/** upsert 一条 dispatch 记录（读-改-写，原子）。 */
export function upsertDispatchRecord(file: string, record: DispatchRecord): void {
  const store = readDispatchStore(file);
  store[record.taskId] = record;
  writeDispatchStore(file, store);
}

/** 移除一条 dispatch 记录（终态已算 ⇒ dispatch 已了结）。记录本不存在 ⇒ no-op（⛔ 不写 spurious 空文件）。 */
export function removeDispatchRecord(file: string, taskId: string): void {
  const store = readDispatchStore(file);
  if (!(taskId in store)) return;
  delete store[taskId];
  writeDispatchStore(file, store);
}

/** 读某 pid 的 /proc/<pid>/cmdline（归一化：NUL → 空格、trim）；pid 不存在 / 无权限 ⇒ null
 *  （硬规则 3b：读不懂 ≠ 无存活，但调用方按 falsy 判「已死」——方向是「少 adopt」，⛔ 不误信 pid）。 */
export function readPidCmdline(pid: number, procDir: string = "/proc"): string | null {
  try {
    return fs.readFileSync(path.join(procDir, String(pid), "cmdline")).toString("utf8").replace(/\0/g, " ").trim();
  } catch {
    return null;
  }
}

/** 孤儿 dispatch 分类（纯函数）：adopt（pid 存活且 cmdline 仍是本任务的 worker）/ finalize（pid 已死 /
 *  被复用）。复核用 hasLiveWorkerForTask 的词边界 cmdline 匹配（同 cold-start-inflight 交叉核对），⛔ 不
 *  裸信 pid 数字——pid 复用后指向别的进程，cmdline 不再含 quay-task-worker + task id ⇒ 判 finalize。
 *  空 cmdline（僵尸已退未收尸）与读不到（null）同判「已死」。 */
export function classifyOrphanDispatch(record: DispatchRecord, procDir: string = "/proc"): "adopt" | "finalize" {
  const cmdline = readPidCmdline(record.workerPid, procDir);
  if (!cmdline) return "finalize";
  return hasLiveWorkerForTask(record.taskId, [cmdline]) ? "adopt" : "finalize";
}

/** reconcile 该处理的孤儿 dispatch 清单：store 里、但不在本驱动内存 running 的条目。⛔ 记录缺失（driver
 *  从未见过，如手工起的 worker）⇒ 不在 store ⇒ 天然跳过、不越权接管；running 中的本驱动在飞 dispatch ⇒
 *  由 runOneWorker 管理（spawn 写、终态清），⛔ 不重复 adopt/finalize。纯函数，可单测。 */
export function orphanDispatchCandidates(
  store: Record<string, DispatchRecord>,
  runningTasks: string[],
): Array<{ taskId: string; record: DispatchRecord }> {
  const out: Array<{ taskId: string; record: DispatchRecord }> = [];
  for (const [taskId, record] of Object.entries(store)) {
    if (runningTasks.includes(taskId)) continue;
    out.push({ taskId, record });
  }
  return out;
}

/** 孤儿 finalize 终态 outcome（pid 已死 / 被复用）。final_state=failed（非 completed），failure_reason
 *  点名「driver 重启期间孤儿化、reconcile 发现已退出」——与存活 driver 亲眼观察到的异常死亡
 *  （"worker exited with code N" / "worker killed by SIGx"）在 reason 上可区分（AC2）。exit_code 诚实
 *  记 null（读不懂，⛔ 不伪造）。 */
export function computeOrphanFinalizedOutcome(opts: {
  task: string;
  selectorReason: string;
  runId: string;
  workerPid: number;
  startedAtMs: number;
  endedAtMs: number;
}): ReturnType<typeof computeOutcome> {
  return {
    ts: new Date(opts.endedAtMs).toISOString(),
    task: opts.task,
    selector_reason: opts.selectorReason,
    exit_code: null,
    signal: null,
    wall_clock_ms: opts.endedAtMs - opts.startedAtMs,
    final_state: "failed",
    failure_reason: `orphaned worker finalized by reconcile: driver restarted mid-flight and worker pid ${opts.workerPid} already exited (or was recycled) before a new instance could adopt it`,
    started_at: new Date(opts.startedAtMs).toISOString(),
    ended_at: new Date(opts.endedAtMs).toISOString(),
    worker_pid: opts.workerPid,
    run_id: opts.runId,
    in_flight_count: 0,
    timed_out: false,
    session_id: null,
  };
}

/** adopt 后 worker 退出（含超时）的终态 outcome。⛔ 不直调 computeOutcome：adopted 孤儿非本驱动子进程、
 *  exit code 不可观测，computeOutcome 的 `exitCode !== 0` 分支会对 null 误判 "exited with code null"。
 *  三态：timed-out（沿用原始截止时刻到期 SIGTERM）/ completed（落地判定 verified）/ exited-not-landed
 *  （未落地，worktree 保留供续做）。exit_code 诚实记 null。 */
export function computeAdoptedOutcome(opts: {
  task: string;
  selectorReason: string;
  runId: string;
  workerPid: number;
  startedAtMs: number;
  endedAtMs: number;
  inFlightCount: number;
  timedOut: boolean;
  landing: DriverResult<LandingEvidence>;
}): ReturnType<typeof computeOutcome> {
  let finalState: string;
  let failureReason: string | null;
  if (opts.timedOut) {
    finalState = "timed-out";
    failureReason = `worker timed out and was SIGTERM'd (worktree preserved)`;
  } else if (opts.landing.state === "verified") {
    finalState = "completed";
    failureReason = null;
  } else {
    finalState = "exited-not-landed";
    failureReason = `adopted orphan worker exited (exit code unobservable) — ${opts.landing.reason ?? "task did not land"}`;
  }
  return {
    ts: new Date(opts.endedAtMs).toISOString(),
    task: opts.task,
    selector_reason: opts.selectorReason,
    exit_code: null,
    signal: null,
    wall_clock_ms: opts.endedAtMs - opts.startedAtMs,
    final_state: finalState,
    failure_reason: failureReason,
    started_at: new Date(opts.startedAtMs).toISOString(),
    ended_at: new Date(opts.endedAtMs).toISOString(),
    worker_pid: opts.workerPid,
    run_id: opts.runId,
    in_flight_count: opts.inFlightCount,
    timed_out: opts.timedOut,
    session_id: null,
  };
}

/** 孤儿 finalize（pid 已死 / 被复用）：立刻补一条可区分的非 completed 终态 + 复用 no-record-on-abnormal-
 *  death 的 orphan worktree 清理（cleanupOrphanWorktree）+ 清 dispatch 记录。同步、幂等。返回 outcome 供
 *  观测（resident loop 打 json 事件）。 */
export function finalizeOrphanDispatch(opts: {
  root: string;
  outcomeFile: string;
  record: DispatchRecord;
}): { outcome: ReturnType<typeof computeOutcome>; cleanup: OrphanCleanupResult | null } {
  const { root, outcomeFile, record } = opts;
  const base = computeOrphanFinalizedOutcome({
    task: record.taskId,
    selectorReason: record.selectorReason,
    runId: record.runId,
    workerPid: record.workerPid,
    startedAtMs: record.startedAtMs,
    endedAtMs: Date.now(),
  });
  const cleanup = cleanupOrphanWorktree(root, record.taskId, null, { finalState: "failed", exitCode: null });
  const outcome = cleanup
    ? {
        ...base,
        worktree_cleaned: cleanup.removed,
        worktree_cleanup_error: cleanup.error,
        worktree_cleanup_skipped_live: cleanup.skippedLiveWorker,
        worktree_cleanup_has_commits: cleanup.hasCommits,
        worktree_cleanup_preserved_commits: cleanup.preservedForCommits,
        worktree_cleanup_sigterm_external: cleanup.sigtermExternal,
      }
    : base;
  appendOutcomeToFile(outcomeFile, outcome);
  removeDispatchRecord(dispatchStoreFile(root), record.taskId);
  return { outcome, cleanup };
}

/** adopt 一个孤儿 worker（pid 存活且 cmdline 吻合）：纳入超时监管——轮询 pid 存活性（代替 child_process
 *  close 事件，非本驱动子进程无 close），沿用记录里的 timeoutDeadlineMs（⛔ 不重置，防「每次重启续命」
 *  无限占位），到期 SIGTERM（grace 后 SIGKILL 兜底），退出后 computeAdoptedOutcome 算终态 + 清 dispatch
 *  记录。返回 Promise<WorkerRunResult>（调用方纳入 running，退出后照常走重试/退避记账）。 */
export function adoptOrphanWorker(opts: {
  taskId: string;
  rootDir: string;
  outcomeFile: string;
  record: DispatchRecord;
  inFlightCount?: number;
  procDir?: string;
  /** 轮询间隔（测试缝）。 */
  pollMs?: number;
  /** SIGTERM → SIGKILL 升级 grace（测试缝）。 */
  sigkillGraceMs?: number;
}): Promise<WorkerRunResult> {
  const {
    taskId, rootDir, outcomeFile, record, procDir = "/proc",
    inFlightCount = 1, pollMs = 100, sigkillGraceMs = 5000,
  } = opts;
  return new Promise((resolve) => {
    let timedOut = false;
    let sigtermSentAt: number | null = null;
    let sigkillSent = false;
    let finished = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const finish = (): void => {
      if (finished) return;
      finished = true;
      if (timer) clearTimeout(timer);
      const endedAtMs = Date.now();
      const landing = computeLandingState(rootDir, taskId, null);
      const lock = readLockMetricsForRun(rootDir, record.runId, taskId);
      const base = computeAdoptedOutcome({
        task: taskId,
        selectorReason: record.selectorReason,
        runId: record.runId,
        workerPid: record.workerPid,
        startedAtMs: record.startedAtMs,
        endedAtMs,
        inFlightCount,
        timedOut,
        landing,
      });
      const outcome = {
        ...(base.final_state === "timed-out" ? { ...base, worktree_preserved: true } : base),
        ...(lock.lockWaitMs !== null && lock.lockWaitMs !== undefined ? { lock_wait_ms: lock.lockWaitMs } : {}),
        ...(lock.lockHoldMs !== null && lock.lockHoldMs !== undefined ? { lock_hold_ms: lock.lockHoldMs } : {}),
      };
      appendOutcomeToFile(outcomeFile, outcome);
      removeDispatchRecord(dispatchStoreFile(rootDir), taskId);
      let exitCode = 0;
      if (outcome.final_state === "timed-out") exitCode = 128 + signalExitCode("SIGTERM");
      else if (outcome.final_state === "exited-not-landed") exitCode = EXITED_NOT_LANDED_EXIT;
      resolve({ taskId, outcome, exitCode });
    };

    const tick = (): void => {
      if (finished) return;
      const now = Date.now();
      // 原始超时截止到期（adopt 前已过期 / 轮询中到期）⇒ SIGTERM 一次（沿用原始截止，⛔ 不重置）。
      if (!timedOut && record.timeoutDeadlineMs > 0 && now >= record.timeoutDeadlineMs) {
        timedOut = true;
        sigtermSentAt = now;
        try { process.kill(record.workerPid, "SIGTERM"); } catch { /* already gone */ }
      }
      // SIGTERM 后 grace 内仍存活 ⇒ SIGKILL 兜底（⛔ 无限占位）。
      if (timedOut && sigtermSentAt !== null && !sigkillSent && now - sigtermSentAt >= sigkillGraceMs) {
        sigkillSent = true;
        try { process.kill(record.workerPid, "SIGKILL"); } catch { /* already gone */ }
      }
      // pid 已死（/proc 读不到或空 cmdline 僵尸）⇒ 算终态。
      if (!readPidCmdline(record.workerPid, procDir)) {
        finish();
        return;
      }
      timer = setTimeout(tick, pollMs);
    };
    tick();
  });
}

/**
 * 生成一个 transcript session id（UUID v4）。gap-worker-task-transcript-access-webui AC1：每次派发
 * （每尝试非每任务）生成【新】UUID——同任务重派 N 次有 N 个不同 session_id ⇒ 每次尝试的 transcript
 * 可逐次访问。独立成函数供测试直接调用（⛔ 不内联 randomUUID 让「每次新」无处可验）。
 */
export function newSessionId(): string {
  return randomUUID();
}

// ── AC 未全勾短路（gap-worker-ac-check-shortcircuit）────────────────────────────────────────────
// worker exit 0 后、finishAsync spawn 机械 fan-in 前，查 worktree 任务体 AC/DoD 是否全勾（develop ref
// ∪ worktree 副本并集，AC-218；用 flip 闸
// 同源谓词 flipAcGateVerdict——⛔ 不新造计数函数，与机械 fan-in step 6.5 ac-precheck / step 8 ac-gate
// 同一判定）。未全勾 ⇒ 短路：不 spawn fan-in（省整条 fan-in + 锁排队），直接 exited-not-landed +
// 原因「AC 未全勾」。三态（硬规则 3b：判定词表含「未评估」）：
//   shortCircuit:false  AC 全勾（或 total=0 落地即收尾 / 剩余全（待外部））——照常 spawn fan-in
//   shortCircuit:true   AC 未全勾（含非待外部剩余项 / 段缺失 fail-closed 无法评估）——不 spawn
// 与 gap-worker-dispatch-prompt-ac-check-instruction 互补：A 打根因（prompt 教勾），B 兜底（任何残留
// 漏勾早发现、低代价——不烧整条 fan-in + 锁排队）。
export function acShortCircuitVerdict(worktree: string, taskId: string): { shortCircuit: boolean; reason: string | null } {
  // AC-218 / gap-store-commit-propagation-field-aware: judge the UNION of the develop ref and the
  // worktree working-tree copy. With field-aware commitTaskWrite, a pure-AC write on a non-task/*
  // branch no longer ff's to develop, and a task/* worktree write lands on the task branch — so the
  // AC ticks can legitimately live in EITHER place while the other is stale (the 2026-09-07 incident:
  // ABI 勾满 8 条 AC 落 develop，worktree 副本仍 0/8 ⇒ 误判 exited-not-landed 烧 45 分钟)。All-checked
  // in EITHER ⇒ no short-circuit; fail-closed only when BOTH are absent/unreadable or neither is
  // all-checked (无法评估 ≠ 合格, 硬规则 3b — a single-source read can no longer see a just-ticked
  // task as "0/N").
  let worktreeBody: string | null = null;
  let developBody: string | null = null;
  try {
    worktreeBody = fs.readFileSync(path.join(worktree, "tasks", `${taskId}.md`), "utf8");
  } catch {
    /* absent/unreadable — still try develop below (缺值 = 未查, not yet a verdict) */
  }
  try {
    const r = spawnSync("git", ["-C", worktree, "show", `develop:tasks/${taskId}.md`], { encoding: "utf8" });
    if (r.status === 0 && !r.error) developBody = String(r.stdout ?? "");
  } catch {
    /* no develop copy / not a git work tree — the worktree-only read below still applies */
  }

  // Union verdict: all-checked in either source wins (no short-circuit).
  const wtV = worktreeBody !== null ? flipAcGateVerdict(worktreeBody) : null;
  const devV = developBody !== null ? flipAcGateVerdict(developBody) : null;
  if ((wtV !== null && wtV.ok) || (devV !== null && devV.ok)) {
    return { shortCircuit: false, reason: null };
  }

  // Neither all-checked — report against the worktree copy when readable (richer reason), else
  // fail-closed (任务体读不懂 ⇒ 短路).
  if (wtV !== null) {
    return {
      shortCircuit: true,
      reason:
        wtV.status === "not-evaluated"
          ? "AC 未全勾（AC/DoD 段缺失或无法识别，无法评估 ≠ 合格）——续做需补齐并勾选 AC"
          : `AC 未全勾（checked ${wtV.checked}/${wtV.total}，剩余未勾 ${wtV.unchecked}）——续做只需验证并勾选 AC`,
    };
  }
  return { shortCircuit: true, reason: `AC 未全勾（任务体读不懂：tasks/${taskId}.md 缺失或不可读）——续做需补齐并勾选 AC` };
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

    const finish = (code: number | null, signal: string | null, spawnErr: string | null, mechResult: MechanicalFanInResult | null = null, shortCircuitReason: string | null = null) => {
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
        // gap-worker-ac-check-shortcircuit：AC 未全勾短路（未 spawn fan-in）⇒ 强制 landed=false +
        // 原因含「AC 未全勾」。⛔ 走 computeLandingState 会读主检出 status=ready 报「task status=ready
        // (not done)」——丢失「AC 未全勾」这个真因，续做 prompt 看不到该勾选什么。
        landed: shortCircuitReason != null ? false : landing.state === "verified" ? true : landing.state === "failed" ? false : null,
        landReason: shortCircuitReason != null ? shortCircuitReason : landing.state === "verified" ? null : landing.reason,
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
      // 终态已算 ⇒ dispatch 已了结，清持久记录（gap-worker-driver-restart-orphan-no-outcome-no-timeout）。
      // 记录本不存在（spawn-failed / not-dispatched 未写）时 removeDispatchRecord 是 no-op。
      removeDispatchRecord(dispatchStoreFile(rootDir), taskId);
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
      let shortCircuitReason: string | null = null;
      if (code === 0 && !spawnErr) {
        const paths = worktreePathsForTask(rootDir, taskId);
        if (paths.length > 0 && paths[0]) {
          // gap-worker-ac-check-shortcircuit：spawn 机械 fan-in【前】先查 worktree 任务体 AC/DoD 全勾
          // ——未全勾（含段缺失 fail-closed）⇒ 不 spawn fan-in（省整条 fan-in + 锁排队），直接
          // exited-not-landed + 原因「AC 未全勾」。与 step 6.5 ac-precheck 互补：那是 suite 前（已烧了
          // merge/delta/typecheck/scoped），这是 fan-in 进程都不起（连锁都不排）。
          const sc = acShortCircuitVerdict(paths[0], taskId);
          if (sc.shortCircuit) {
            shortCircuitReason = sc.reason;
          } else {
            const startMechMs = Date.now();
            // 每任务新进程（gap-fan-in-token-gate-version-mismatch-self-lock）：机械 fan-in 不再在本守护
            // 进程 in-process 跑（守护是主检出旧代码、但 fan-in 编排脚本从 worktree 加载 ⇒ 版本错位），
            // 改为 spawn 一个 fresh node 进程加载【主检出】的 worker-driver.ts --mechanical-fan-in——
            // 执行器（entry）跟 driver 同版（⛔ 不用 worktree 的：stale worktree 缺新 argv ⇒ unknown
            // argument ⇒ parse-mechanical-fan-in red，gap-fan-in-spawn-stale-worktree-executor-missing-argv）；
            // 锁半（acquireFanInLock）与编排半（ff-merge.ts 模块）同源（都在 worktree），改了
            // worker-driver.ts 的任务 fan-in 不再用旧锁/旧编排。⛔ 不是 token 闸一例，是「fan-in 脚本从
            // worktree 加载、发起者从主检出旧进程运行」的架构错位整个类。
            mechResult = await spawnMechanicalFanIn({ task: taskId, worktree: paths[0], root: rootDir, runId });
            if (json) {
              process.stdout.write(
                `${JSON.stringify({ event: "mechanical-fan-in", task: taskId, wall_clock_ms: Date.now() - startMechMs, ...mechResult })}\n`,
              );
            }
          }
          // D5：落地判定改从 ff 结果（mechResult.landedSha）派生 ⇒ 不再需要 syncDocBranchToDevelop
          // 把 develop merge 进 doc-only 工作分支（那是一个 best-effort + 静默 catch 的补丁，冲突即假
          // exited-not-landed）——该补丁随 D5 退役，finish() 里 computeLandingState 直接读 landedSha。
        }
      }
      finish(code, signal, spawnErr, mechResult, shortCircuitReason);
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
    // gap-worker-driver-restart-orphan-no-outcome-no-timeout：spawn 后立刻把 dispatch 元数据持久化
    // （driver 重启死掉后内存 running 整体丢失，这份影子供下一个实例 adopt/finalize）。⛔ workerPid
    // 为 null（spawn 失败）不写——没有可被孤儿的进程。finish() 里清对应条目。
    if (workerPid) {
      upsertDispatchRecord(dispatchStoreFile(rootDir), {
        taskId,
        runId,
        workerPid,
        selectorReason,
        startedAtMs,
        timeoutDeadlineMs: timeoutMs > 0 ? startedAtMs + timeoutMs : 0,
        cmdlineFingerprint: argv.join(" "),
      });
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
// （锁/merge/delta/typecheck/scoped门/suite/ff）。happy-path 先做（人 2026-08-27 裁定①）：driver 跑通
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
  /** per-suite runId 覆盖（测试缝）。缺省 = newMechanicalSuiteRunId(task)（`mfi-<task>-<epoch-ms>-<rand>`，
   *  每次 fan-in 唯一）。它是【suite 身份】——传给 runner --run-id 并贯穿 full-suite-state /
   *  suite-load-<runId>.jsonl / verification-round 记录，⛔ 不是 runId（那个是 fan-in 过程身份，锁/日志/ff
   *  用它）。gap-mechanical-fan-in-per-suite-runid-unified。 */
  perSuiteRunId?: string;
  mergeTarget?: string;
  /** suite 命令（测试缝）；缺省 = defaultMechanicalSuiteCommand（本仓库 node full-suite-runner.ts
   *  --buckets <task> --root <worktree> --state-dir <root>/.quay --runner inner --log-file
   *  <suiteLogFile>；第三方项目无 scripts/test.sh ⇒ bash -c "cd <worktree> && <loop.test_command>"）。
   *  gap-fan-in-red-bucket-run-not-recorded：机械路径不再跑平行 `bash scripts/test.sh --buckets`
   *  （绕开 verification-round 唯一 writer），改走正确的 runner——green+red 桶轮次都入
   *  verification-round.jsonl（state=red 记录可见）。 */
  suiteCommand?: string[];
  /** suite 单飞槽 base（测试缝）；缺省 = suiteLockBase(root)。 */
  slotBase?: string;
  /** suite-slot-lib.sh 路径（测试缝）；缺省 = <root>/plugin/scripts/suite-slot-lib.sh。 */
  slotLib?: string;
  /** 静默看门狗阈值（测试缝）。 */
  silenceMs?: number;
  /** suite 日志（静默看门狗盯的）；缺省 .quay/fan-in-suite-<task>~<runId>~<attempt>.log（durable，⛔ 不再
   *  /tmp；attempt 唯一后缀 ⇒ 同一 runId 内多次 suite 互不覆盖，gap-fan-in-suite-log-same-runid-overwrite）。 */
  suiteLogFile?: string | null;
  /** suite capture（ff 闸读的证书）；缺省 /tmp/fan-in-suite-<task>.env。 */
  suiteCapture?: string;
  /** 强制跑 suite（跳过 doc-only 判定；测试缝）。 */
  forceSuite?: boolean;
  /** scoped 门命令（测试缝）；缺省 = scopedGateCommandFor(task, worktree)（本仓库 test.sh --for-task；
   *  第三方退化为 loop.test_command；两者皆无 ⇒ null 跳过 scoped 门）。 */
  scopedGateCommand?: string[];
  /** doc 检查命令（测试缝）；缺省 = docCheckCommandFor(worktree)（本仓库 test.sh --static-checks-doc；
   *  第三方无该文件 ⇒ null 跳过 doc-check）。 */
  docCheckCommand?: string[];
  /** doc-check 缓存文件（测试缝）；缺省 = <root>/.quay/doc-check-cache.json（gitignored 运行时缓存，
   *  gap-fan-in-doc-check-cache）。doc 面未变时命中缓存跳过 doc-check（~0s），变化失效重跑。 */
  docCheckCacheFile?: string;
  /** scoped-gate 缓存文件（测试缝）；缺省 = <root>/.quay/scoped-gate-cache.json（运行时缓存，
   *  gap-worker-premerge-scoped-gate-cache）。worker 退出前写 (task, developSha, pass)；锁内 merge 到的
   *  develop tip 与之一致时跳过 scoped-gate（可证明冗余），否则照跑（fail-closed）。 */
  scopedGateCacheFile?: string;
  /** fan-in 编排脚本目录（测试缝）；缺省 = <worktree>/plugin/scripts（自举：本分支的编排脚本自验）。 */
  scriptsDir?: string;
  /** ff-merge TS 模块路径（测试缝，hermetic 仓库 worktree 无 packages/quay/src ⇒ 测试显式传 FF_MERGE_MODULE）；
   *  生产不传 ⇒ 走静态字面量动态 import "packages/quay/src/fan-in/ff-merge.ts"（源树相对解析；shipped
   *  bundle 由 coreSrcAliasPlugin 内联——gap-resolve-kernel-src-module-strip-types-node-modules）。 */
  ffMergeModule?: string;
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
  /** fan-in 锁持有时长（release epoch - acquire epoch，秒；读自 fan-in-lock-events）。 */
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
  /** fan-in 过程日志文件名（`.quay/fan-in-<task>-<runId>.log` 的 basename——web 链接据此构造，
   *  ⛔ 不重算 sanitize，单一真相源）。red/landed 两态都非 null。 */
  fanInLog: string | null;
  /** suite 日志文件名（`.quay/fan-in-suite-<task>~<runId>~<attempt>.log` 的 basename——web 链接 / 续做
   *  prompt / needs-human 注记据此构造绝对路径，⛔ 不靠命名约定猜）。red ∧ step=suite 时非 null（suite
   *  真因落该文件——183KB 真因只能靠命名约定猜的病根）；其它步骤 / landed 时 null。 */
  suiteLog: string | null;
}

/** runAsync 的结果收窄为「成/败 + 输出」，机械 fan-in 各步骤的共用判定（⛔ 不各写一遍 status!==0）。 */
interface MechShResult {
  ok: boolean;
  status: number | null;
  stdout: string;
  stderr: string;
  error: Error | null;
}

/** 机械 fan-in 步骤的进程组 spawn（gap-fan-in-subprocess-hang-timeout-recovery AC2/AC4）：detached:true
 *  （子进程成进程组组长）+ timeout 到期 SIGKILL 整组。⛔ runAsync 的 timeout 只 SIGKILL 直接子进程——
 *  孙进程（继承 stdout/stderr 管道 + 可能继承 flock FD）持管道写端存活 ⇒ close 永不触发、锁泄漏；
 *  本函数组 kill 整棵进程树，且显式 resolve 不依赖 close 事件（孙进程持管道不阻塞返回，硬规则 4b）。
 *  永不 throw；恒捕获 stdout+stderr（combinedOutput 需两流合并去噪，⛔ 不丢任一流的失败签名）。 */
export async function mechSh(argv: string[], timeoutMs = 120_000): Promise<MechShResult> {
  return new Promise((resolve) => {
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(argv[0], argv.slice(1), { stdio: ["ignore", "pipe", "pipe"], detached: true });
    } catch (e) {
      resolve({ ok: false, status: null, stdout: "", stderr: "", error: e as Error });
      return;
    }
    let stdout = "";
    let stderr = "";
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const finish = (status: number | null, error: Error | null): void => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      resolve({ ok: status === 0, status, stdout, stderr, error });
    };
    if (Number.isFinite(timeoutMs)) {
      timer = setTimeout(() => {
        // ⛔ 组 kill（-pid）：只 child.kill 会留孙进程持管道/锁。detached:true ⇒ 子进程是组长 ⇒ -pid 命中整组。
        try {
          if (child.pid) process.kill(-child.pid, "SIGKILL");
        } catch {
          try { child.kill("SIGKILL"); } catch { /* already gone */ }
        }
        // 显式 resolve（⛔ 不依赖 close——孙进程持管道时 close 可能永不触发）。
        finish(null, new Error(`spawn timeout after ${timeoutMs}ms (SIGKILL process group): ${argv[0]}`));
      }, timeoutMs);
    }
    child.stdout?.on("data", (d) => { stdout += d; });
    child.stderr?.on("data", (d) => { stderr += d; });
    child.on("error", (e) => finish(null, e));
    child.on("close", (code) => finish(code, null));
  });
}

/** 机械 fan-in 步骤 trace 载体（.quay/fan-in-step-trace.jsonl，gitignored 运行时诊断日志——AC1：
 *  每步 begin/end 各一条；begin 无 end ⇒ 该步挂起/未返回，据 epoch 定位）。best-effort：写失败不致命
 *  （诊断载体失败 ≠ fan-in 失败，硬规则 3b 的镜像半边）。 */
export function appendFanInStepTrace(
  root: string,
  task: string,
  runId: string,
  step: string,
  phase: "begin" | "end",
  extra: Record<string, unknown> = {},
): void {
  try {
    const file = path.join(root, ".quay", "fan-in-step-trace.jsonl");
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.appendFileSync(
      file,
      JSON.stringify({
        event: `step-${phase}`,
        step,
        task,
        runId,
        ts: new Date().toISOString(),
        epoch: Math.floor(Date.now() / 1000),
        ...extra,
      }) + "\n",
      "utf8",
    );
  } catch {
    // best-effort：trace 写失败 ≠ fan-in 失败。
  }
}

/** 合并 stdout+stderr 为单一流（⛔ 不丢弃任一流、⛔ 不 stderr 优先——未知失败签名可能在任一流，
 *  硬规则 3b/4b/9 同族：stderr 恒非空恒良性时，只取 stderr 会把 stdout 的真失败签名丢掉）。
 *  两流皆空/全空白 ⇒ 空串（调用方回退 `exit <code>`）。单一机件，fail() 与 flip 共用。 */
export function combinedOutput(stdout: string, stderr: string): string {
  return [stdout, stderr].filter((s) => s && s.trim() !== "").join("\n");
}

/** 无害噪声行（MODULE_TYPELESS 等）——⛔ 污染失败摘要/判词。extractFailureSummary 与
 *  extractFirstFailureLine 共用（⛔ 两处各写一份正则 = 漂移，硬规则 5b）。 */
function isNoiseLine(l: string): boolean {
  const t = l.trim();
  return (
    l.includes("MODULE_TYPELESS_PACKAGE_JSON") ||
    l.includes("Reparsing as ES module") ||
    l.includes("This incurs a performance overhead") ||
    l.includes("To eliminate this warning") ||
    l.includes('add "type": "module"') ||
    l.includes("--trace-warnings") ||
    // gap-fan-in-suite-red-reason-carries-split-or-commit-title：suite 静态检查阶段的「== … ==」分节
    // 标题行（runner-static-gate.ts 的 echo）与 node:test 的「✔ 通过测试」行都不是失败信号——但标题含
    // 「continuously-checked」（\bchecked\b）/「to-fail」（\bFAIL\b）、通过测试名含「AssertionError」/
    // 「Could not resolve」等词，会撞 isFailureSignalLine 的松散正则 ⇒ 把标题/通过测试当失败摘要（归因
    // 错位到 split-or-commit 标题）。⛔ 两者都整体当噪声（不进 meaningful 回退、不进 signals）。
    /^== .* ==$/.test(t) ||
    /^\s*✔/.test(l)
  );
}

/** 失败信号行（node:test 的 not ok / ✖ / # fail、断言 expected/actual、anti-drift HARD FAIL、esbuild 的
 *  Could not resolve / [ERROR] 构建失败、ac-gate/anti-drift 的 checked/violation 判词）。extractFailureSummary
 *  与 extractFirstFailureLine 共用（⛔ 不复制正则）。 */
function isFailureSignalLine(l: string): boolean {
  return /^\s*not ok\b|^\s*✖|\bFAIL\b|# fail\b|HARD FAIL|AssertionError|\bexpected:|\bactual:|\bfail \d+\b|\bexit=\d+|Could not resolve|\[ERROR\]|\bchecked\b|\bviolation\b/i.test(l);
}

/** D6：从某步的 stdout+stderr 合并流里提取【可读失败摘要】——⛔ 裸流（MODULE_TYPELESS 噪声占满、
 *  ⛔ 丢真正测试结果）。去噪 + 保留失败信号行（node:test 的 not ok / ✖ / # fail、断言 expected/actual、
 *  anti-drift HARD FAIL、esbuild 的 Could not resolve / [ERROR] 构建失败），有界（最后 N 行 + 4000 字符）。
 *  裸流本身落进 logFile（fail dump），记录里留指针。提取不出任何行 ⇒ 空串（调用方回退 `exit <code>`）。
 *  gap-scoped-gate-reason-stderr-drops-stdout：scoped 门红时 stdout 的真失败（esbuild 构建崩 = Could not
 *  resolve）必须进 reason——⛔ stderr 良性 preamble 优先 || 短路丢弃 stdout（硬规则 3b/4b/9 同族）。
 *  esbuild 失败行加入 isSignal：即使与 TAP not ok 并存，构建失败签名也不再被 slice(-60) 尾截掉。
 *  gap-step-trace-reason-captures-gate-stdout：ac-gate/anti-drift 的 stdout 判词（checked X/Y / violation）
 *  加入 isSignal——⛔ ac-gate 的 FAIL 行与「checked X/Y」并存时后者被 signals-first 丢弃，真判词不进 reason。 */
export function extractFailureSummary(combined: string): string {
  const meaningful = combined.split("\n").filter((l) => l.trim() !== "" && !isNoiseLine(l));
  const signals = meaningful.filter(isFailureSignalLine);
  const chosen = signals.length > 0 ? signals : meaningful;
  return chosen.slice(-60).join("\n").trim().slice(0, 4000);
}

/** 从合并流里取【第一条】真实失败信号行（同 extractFailureSummary 的 isNoiseLine/isFailureSignalLine，
 *  ⛔ 不复制正则）。suite 红 needs-human 用：把 suite 日志摘要出「第一条真实断言/报错行」塞进
 *  mechanical_fan_in.reason——⛔ extractFailureSummary 的 tail-60 多行 blob 塞进单行 markdown bullet 会断行，
 *  且它无信号时回退 meaningful 会违反「无匹配行 ⇒ 回退通用文案」（硬规则 3b 三态可分）。
 *  无信号 ⇒ 空串（调用方回退 `suite <outcome>` 通用文案，⛔ 不伪造/截断出误导内容）。 */
export function extractFirstFailureLine(combined: string): string {
  const lines = String(combined ?? "")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l !== "" && !isNoiseLine(l));
  // 真实失败优先序（gap-fan-in-suite-red-reason-carries-split-or-commit-title）：真实断言原文
  // （AssertionError）→ 失败文件（__PERFILE__ passed=false）→ 测试级失败（✖ / not ok / # fail N>0）
  // → 松散静态检查信号（HARD FAIL / Could not resolve / checked / violation）。
  // 旧实现取【文档序第一条】松散信号，而 suite 静态检查阶段的良性判词（0 violation(s) / checked 566 /
  // PASS）排在真实失败之前、且全中松散正则 ⇒ reason 恒为「split-or-commit 标题」而非真实失败（归因
  // 错位）。改成确定性失败优先，仍保留松散信号作【静态检查真失败】（无测试失败时）的回退。
  const definitive = [
    /AssertionError/i,
    /__PERFILE__ .* passed=false/i,
    /^\s*✖|^\s*not ok\b|# fail\s+[1-9]\d*\b/i,
  ];
  for (const re of definitive) {
    const hit = lines.find((l) => re.test(l));
    if (hit) return hit;
  }
  return lines.find(isFailureSignalLine) ?? "";
}

/** 读 fan-in 锁事件里本任务+runId 的持有时长（AC1/AC2 判据输入，纯文件读）。 */
export function readFanInLockHold(
  root: string,
  task: string,
  runId: string,
): { lockHoldSecs: number | null; lockAcquireEpoch: number | null; lockReleaseEpoch: number | null } {
  const file = path.join(root, ".quay", "fan-in-lock-events.jsonl");
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

// ── fan-in 锁：driver 自身经非分离直接子进程持锁（ADR-034）────────────────────────────
// 废除 gap-fan-in-workflow-lock-and-S1 的「分离 holder + flag 文件释放」协议（fan-in-ff-merge.sh
// --acquire/--release-fan-in-lock 里 `setsid bash … & disown` 的持锁进程 + `while [ -e flag ]` 死
// 循环 + 外部删 flag 释放）。该协议让持锁进程活得过它的 caller：caller 在 ff 后删 flag 前被杀 ⇒
// holder 孤儿化（PPID=1）+ 活着 ⇒ 死循环 ⇒ 锁持 23 分钟阻塞全仓 fan-in（gap-full-suite-lock-hold-
// watchdog-threshold-shorter-than-fan-in 末次实证）。ADR-034 裁定：锁的生死 = 工作的进程生死——锁由
// driver（受监督、可重启的常驻进程）经【非分离直接子进程】持有，释放只靠「持锁进程退出 → 内核自动关
// fd → flock 释放」一种机制，⛔ 不设任何时间阈值、⛔ 不依赖第三方外部信号（无 hold-max/TTL/stale）。
//
// 实现：driver spawn 一个【非 detached、非 disown】的 bash 子进程（holder）做 flock，然后阻塞在
// stdin 读上。driver 持有该子进程 stdin 管道的写端：driver 死（任何原因，含 SIGKILL）⇒ 内核关写端 ⇒
// holder 的 stdin 读到 EOF ⇒ 写 release 事件 + flock -u + 退出 ⇒ flock 自动释放。正常 release = driver
// 关 stdin 写端（同一路径）。锁文件/事件文件 = fan-in.lock /
// .quay/fan-in-lock-events.jsonl，fan-in-ff-protocol-check 判据4 与 readFanInLockHold
// 继续读同一载体。

/** fan-in 锁文件路径（git common dir 下的 fan-in.lock，与 suite 锁同目录不同文件）。
 *  解析 git-common-dir（⛔ 不读 FULL_SUITE_LOCK_FILE env——那是 suite 锁的 seam，不属于 fan-in 锁）。 */
export function fanInLockFile(root: string): string {
  const r = spawnSync("git", ["rev-parse", "--git-common-dir"], { cwd: root, encoding: "utf8" });
  const commonDir = r.status === 0 && !r.error ? (r.stdout ?? "").trim() : "";
  return path.join(path.resolve(root, commonDir || ".git"), "fan-in.lock");
}

/** 持锁 holder 的 bash 脚本（非分离直接子进程；`cat >/dev/null` 阻塞在 stdin，driver 死 ⇒ EOF ⇒ 释放）。
 *  参数：$1=锁文件 $2=taskId $3=runIdJson（已编码 `"r"` 或 `null`）$4=agentIdJson $5=事件文件。 */
const FAN_IN_LOCK_HOLDER = `exec {fd}>"$1" || exit 2
flock -x "$fd" || exit 2
_emit() {
  printf '{"event":"%s","ts":"%s","epoch":%s,"taskId":"%s","pid":%s,"runId":%s,"agentId":%s}\\n' "$1" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$(date +%s)" "$2" "$$" "$3" "$4"
}
_emit acquire "$2" "$3" "$4" >> "$5"
_emit acquire "$2" "$3" "$4"
cat >/dev/null
_emit release "$2" "$3" "$4" >> "$5"
flock -u "$fd" 2>/dev/null || true
exit 0`;

/** 一次 fan-in 锁的持有句柄（driver 侧）：release() 关 stdin 写端 ⇒ holder 写 release 事件 +
 *  flock -u 退出；driver 死（SIGKILL）⇒ 内核关 stdin 写端 ⇒ 同一释放路径（无孤儿、无残留锁）。 */
export interface FanInLockHandle {
  holderPid: number | null;
  release: () => Promise<void>;
}

/** 经非分离直接子进程 acquire fan-in 锁（ADR-034）。resolve = holder 已 flock 并写出 acquire
 *  事件（stdout 出现该行）；reject = holder 在 acquire 前死（flock 错误 / spawn 失败）。unbounded——排队
 *  等待正是这把正确性锁存在的意义（⛔ 无超时，与旧 --acquire-fan-in-lock 的 `flock -x` 无界语义一致）。 */
export function acquireFanInLock(opts: {
  root: string;
  task: string;
  runId: string;
  agentId?: string | null;
  lockFile?: string;
  eventsFile?: string;
}): Promise<FanInLockHandle> {
  const lockFile = opts.lockFile ?? fanInLockFile(opts.root);
  const eventsFile = opts.eventsFile ?? path.join(opts.root, ".quay", "fan-in-lock-events.jsonl");
  const runIdJson = opts.runId ? JSON.stringify(opts.runId) : "null";
  const agentIdJson = opts.agentId ? JSON.stringify(opts.agentId) : "null";
  fs.mkdirSync(path.dirname(eventsFile), { recursive: true });

  const child = spawn(
    "bash",
    ["-c", FAN_IN_LOCK_HOLDER, "fan-in-lock-holder", lockFile, opts.task, runIdJson, agentIdJson, eventsFile],
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
        reject(new Error(`fan-in lock holder exited before acquiring (code ${code})`));
      }
    });
    child.on("error", (e) => {
      if (!settled) {
        settled = true;
        reject(new Error(`fan-in lock holder spawn error: ${(e as Error).message}`));
      }
    });
  });
}

/** 写 suite capture（ff 闸 ff-merge.ts 模块的证书——读 suite_exit + suite_head 判「本任务 suite 已
 *  绿且 suite_head 是待 ff tip 的祖先」）。fail-open（gap-write-suite-capture-non-blocking AC1）：
 *  capture 是 suite 结果的派生观测载体，写失败（磁盘/权限）只 WARN 到 stderr、⛔ 不抛——ff 闸在 capture
 *  缺失/不可读时回退读权威源 full-suite-state.json（同一轮 mirrorMechanicalFanInSuiteState 已写
 *  state=green + commit=suite_head + taskId），观测写失败不得弄死一个真实绿 suite 的落地
 *  （人 2026-08-30 裁定「观测不得阻塞主执行」）。 */
function writeSuiteCapture(captureFile: string, fields: Record<string, string>): void {
  try {
    const lines = Object.entries(fields).map(([k, v]) => `${k}=${v}`);
    fs.mkdirSync(path.dirname(captureFile), { recursive: true });
    fs.writeFileSync(captureFile, lines.join("\n") + "\n", "utf8");
  } catch (e) {
    console.error(`worker-driver: writeSuiteCapture failed (fail-open — fan-in continues, ff gate falls back to the authoritative source): ${e instanceof Error ? e.message : String(e)}`);
  }
}

/** 取本任务上一轮 green bucket suite 的 verified commit（suite_head）——权威源 full-suite-state.json 的
 *  mirror 记录（mirrorMechanicalFanInSuiteState 写 state=green + commit=suite_head + taskId；与 ff 闸
 *  readGreenMirrorCommit 同形同一份 shape，⛔ 不另造字段）。⛔ 该 commit 是【历史指针】非实时态：读回后
 *  由调用方用 `git merge-base --is-ancestor` 对工作树 HEAD 做祖先校验（距今一致性），不据此断当前在跑。
 *  取不到 / 非本任务 / 非 green / commit 非法（非 40-hex）⇒ null（缺值 = 未查，⛔ 不是「可复用」——
 *  硬规则 3b：读不懂 ≠ 上一轮绿）。gap-fan-in-continue-doc-only-advance-reuse-suite AC4 输入。 */
export function readPreviousGreenSuiteCommit(stateFile: string, task: string): string | null {
  let text = "";
  try {
    text = fs.readFileSync(stateFile, "utf8");
  } catch {
    return null;
  }
  let rec: Record<string, unknown>;
  try {
    rec = JSON.parse(text);
  } catch {
    return null;
  }
  if (!rec || typeof rec !== "object" || Array.isArray(rec)) return null;
  if (rec.state !== "green") return null;
  if (rec.taskId !== task) return null;
  const commit = rec.commit;
  if (typeof commit !== "string") return null;
  const sha = commit.trim();
  return /^[0-9a-f]{40}$/i.test(sha) ? sha : null;
}

// readTaskStatusAtRef (async) — SINGLE-SOURCE in task-schema.ts as `fetchTaskStatusAtRef`
// (gap-task-status-parsing-reimplemented-13-sites); imported above. The resident loop must stay async
// (AC4 — never block on execFileSync).

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
  if (!a.ok) return { ok: false, reason: `git add failed: ${combinedOutput(a.stdout, a.stderr) || `exit ${a.status}`}` };
  a = await mechSh(["git", "-C", worktree, "commit", "-q", "--no-verify", "-m", message, "--", `tasks/${task}.md`]);
  if (!a.ok) return { ok: false, reason: `git commit failed: ${combinedOutput(a.stdout, a.stderr) || `exit ${a.status}`}` };
  return { ok: true, reason: null };
}

/** 读 worktree 的任务文件并翻 status ready→done（fail-closed：status 经 task-ops.ts 单一 parser 读出，
 *  非 ready/done 即拒；gap-task-ops-consolidate-driver-frontmatter-writers）。
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
  // gap-task-ops-consolidate-driver-frontmatter-writers：status 读/写经 task-ops.ts（splitTaskFile /
  // statusFromFrontmatter / patchStatusField，单一 parser，⛔ 不再手搓 status 行正则 / 精确行计数）。
  const split = splitTaskFile(text);
  if (!split) return { ok: false, reason: "task file has no frontmatter" };
  const from = statusFromFrontmatter(split.frontmatterRaw);
  const rebuild = (fm: string): string => `${split.open}${fm}${split.close}${split.body}`;
  if (from === "ready") {
    const flipped = patchStatusField(split.frontmatterRaw, "done");
    if (!flipped.ok) return { ok: false, reason: `flip failed: ${flipped.reason}` };
    return commitTaskStatusChange(worktree, task, file, rebuild(flipped.fm), `tasks: 翻 ${task} done（driver 机械 fan-in）`);
  }
  if (from === "done") {
    // done 已存在：判真落地（mergeTarget 的任务文件是否已 done）。已落地 ⇒ skip；未落地 ⇒ reset→flip。
    const landed = await fetchTaskStatusAtRef(worktree, mergeTarget, task);
    if (landed === "done") return { ok: true, reason: null };
    const reset = patchStatusField(split.frontmatterRaw, "ready");
    if (!reset.ok) return { ok: false, reason: `reset to ready failed: ${reset.reason}` };
    const resetResult = await commitTaskStatusChange(
      worktree, task, file, rebuild(reset.fm),
      `tasks: reset ${task} done→ready（fan-in 收敛「done 未落地」中间态）`,
    );
    if (!resetResult.ok) return resetResult;
    const flipped = patchStatusField(reset.fm, "done");
    if (!flipped.ok) return { ok: false, reason: `flip after reset failed: ${flipped.reason}` };
    return commitTaskStatusChange(worktree, task, file, rebuild(flipped.fm), `tasks: 翻 ${task} done（driver 机械 fan-in）`);
  }
  return { ok: false, reason: `expected status 'ready' or 'done', got ${from === null ? "none" : JSON.stringify(from)}` };
}

/** 解析 `packages/quay/src/` 子树下一模块（shipped 感知，⛔ 硬编码 packages/quay/src 布局锚点）：
 *  源树上下文（base 是 quay 源树，含 packages/quay/src/<rel>）⇒ base/packages/quay/src/<rel>；
 *  shipped 上下文（npm 包把 packages/quay/ 打平到包根、base 无 packages/）⇒ <包根>/src/<rel>。
 *  包根 = resolveKernelPluginRoot() 的父目录（源树 = <repo>/plugin 的父 <repo>；shipped = <pkg>/plugin
 *  的父 <pkg>——实测 /tmp/ac207-prefix/lib/node_modules/quay/ 下 src/ 与 plugin/ 平级）。存在性判定
 *  （fs.existsSync）先试源树形、再退 shipped 形；两形互斥（同一 base 不会同时命中两种布局）。两形皆无
 *  时返回 shipped 形路径，import 的 MODULE_NOT_FOUND 由调用方 best-effort 捕获（与现状一致，不在此抛）。
 *  gap-fanin-gate-event-store-path-shipped-unsafe：appendCompleteGateEvent 与 ffMergeModule 两处
 *  packages/quay/src 锚点原为仓库布局硬编码，shipped npm 包（打平布局）下 MODULE_NOT_FOUND 被静默吞。
 *  ⚠️ gap-resolve-kernel-src-module-strip-types-node-modules：上述两调用点已改静态字面量动态 import
 *  （shipped bundle 由 coreSrcAliasPlugin 内联，消除 node_modules 下 .ts 的 runtime import）。本函数
 *  保留为布局解析单一真相源 + 测试锚点（AC4「双向不变」）；生产已无调用点。
 */
export function resolveKernelSrcModule(base: string, rel: string): string {
  const sourcePath = path.join(base, "packages", "quay", "src", rel);
  if (fs.existsSync(sourcePath)) return sourcePath;
  return path.join(path.dirname(resolveKernelPluginRoot()), "src", rel);
}

/** gap-mechanical-fan-in-writes-no-complete-gateevent — 机械 fan-in 翻 done 后经既有 gate-event-store
 *  写 `complete` pass GateEvent（恢复 gap-loop-completion-path-produces-zero-gateevents AC2 在新路径上
 *  成立；⛔ 不手搓 append）。事件写到 <root>/.quay/gate-events.jsonl——与 CLI/loop 同一载体，
 *  stale-ready-audit.ts 的 bypassComplete 判据据此不再把机械 fan-in 的 done 误报为「绕过 QENG」。
 *  actor 缺省 "quay-driver"（区别于 CLI "quay-cli" / loop "outer"）。Package import 走动态
 *  pathToFileURL（同 loop-complete-task.ts：esbuild bundle 不解析 ../../packages/...）。best-effort：
 *  写失败返回 { ok:false }，不抛——fan-in 已 landed，观测写不得阻塞主执行（同 writeSuiteCapture）。 */
export async function appendCompleteGateEvent(
  root: string,
  task: string,
  actor = "quay-driver",
): Promise<{ ok: boolean; reason: string | null }> {
  try {
    // gap-resolve-kernel-src-module-strip-types-node-modules: shipped npm 包把 packages/quay/ 打平到
    // 包根，resolveKernelSrcModule 会解析到 <包根>/src/gate/gate-event-store.ts（node_modules 下的 .ts）
    // ⇒ Node ≥23.7 拒剥 ⇒ ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING。改静态字面量动态 import（同
    // send-to-session.ts 的 gap-ac205 手法）：源树相对路径直接解析；shipped bundle 由 build-plugin-dist.mjs
    // 的 coreSrcAliasPlugin 重指并 INLINE（bundle:true），无 runtime 落 node_modules .ts 的 import。
    // ⛔ 不用 pathToFileURL(计算路径)——esbuild 无法内联计算 specifier，shipped 下必挂。
    const { appendGateEvent } = await import(
      "../../packages/quay/src/gate/gate-event-store.ts"
    ) as { appendGateEvent: (logPath: string, event: unknown) => void };
    appendGateEvent(path.join(root, ".quay", "gate-events.jsonl"), {
      id: randomUUID(),
      item_id: task,
      pipeline_id: task,
      gate: "complete",
      actor,
      verdict: "pass",
      timestamp: new Date().toISOString(),
      payload: { from: "ready", to: "done" },
    });
    return { ok: true, reason: null };
  } catch (e) {
    return { ok: false, reason: (e as Error)?.message ?? String(e) };
  }
}

/** gap-mechanical-fan-in-per-suite-runid-unified — 生成一次机械 fan-in 的 per-suite runId
 *  （`mfi-<task>-<epoch-ms>-<rand>`）。⛔ 不用共享的 wk-prod（那是 driver 轮次号，一 driver 轮次内多个
 *  suite 共用，不能当 suite 身份）；也⛔ 不把 runId（fan-in 过程身份，锁/日志/ff 用它）当 suite 身份——
 *  suite 身份必须每次 fan-in 唯一（epoch-ms + rand 双重唯一）——AC2「同一 driver 轮次两个不同任务的
 *  per-suite runId 不同」。独立成函数供测试直接调用（⛔ 不内联 randomUUID 让「每次新」无处可验）。 */
export function newMechanicalSuiteRunId(task: string): string {
  return `mfi-${task}-${Date.now()}-${randomUUID().slice(0, 6)}`;
}

/** gap-fan-in-red-bucket-run-not-recorded — 机械 fan-in 的 suite 步缺省命令：经 full-suite-runner.ts
 *  --buckets 跑（正确的 runner，green+red 桶轮次都在 suite 退出时入 verification-round.jsonl），⛔ 不是
 *  平行 `bash scripts/test.sh --buckets`（绕开唯一 writer，红桶轮次零记录——硬规则 3b「没跑过」与
 *  「跑了但红」同形）。--root <worktree> 是受测检出（test.sh 在 worktree 内跑）；--state-dir <root>/.quay
 *  把 state/verification-round/measure-history/suite-load 落进共享主检出（/tests 的读取处）；--runner inner
 *  显式标注层身份；--log-file <suiteLogFile> 让 runner 把 suite 流 tee 进 fan-in 的 /tmp 日志
 *  （spawnSuiteAndWait 的静默看门狗盯其 mtime——runner 不写 stdout，须经此缝让看门狗看到进度）。
 *  --run-id <runId> 把 per-suite 身份传给 runner（gap-mechanical-fan-in-per-suite-runid-unified：
 *  runner 用它当 runId，贯穿 full-suite-state / generation guard / suite-load-<runId>.jsonl / 记录，
 *  使 /tests 按记录 runId 查得到负载曲线）。
 *  runner 路径经 kernelSiblingArgv 锚在本 kernel 安装位置（⛔ 非 opts.worktree ——
 *  gap-plugin-root-resolution-remaining-callsites-round2：第三方项目无 plugin/scripts/，锚在 worktree
 *  会 Cannot find module ⇒ 挡住任务落地）。
 *  抽成纯函数便于 worker-driver.test.mjs 断言缺省命令是 runner 而非 test.sh harness（AC2）。 */
export function defaultMechanicalSuiteCommand(opts: {
  task: string;
  worktree: string;
  root: string;
  suiteLogFile: string;
  runId: string;
}): string[] {
  // 本仓库（scripts/test.sh 存在）⇒ full-suite-runner（本仓库 bucket 化测试基建，行为与修改前逐字
  // 一致）；第三方项目无该文件 ⇒ 直接委托 loop.test_command（全量）——⛔ 不调用 full-suite-runner
  // （其内部锚点假设本仓库结构，gap-driver-fanin-hardcoded-test-sh-third-party 范围扩展：修 5 处
  // __dirname 是治标，第三方本就不该走这条路径）。
  if (hasTestSh(opts.worktree)) {
    return [
      "node", "--no-warnings", ...kernelSiblingArgv("full-suite-runner.ts"),
      "--buckets", opts.task,
      "--root", opts.worktree,
      "--state-dir", path.join(opts.root, ".quay"),
      "--runner", "inner",
      "--log-file", opts.suiteLogFile,
      "--run-id", opts.runId,
    ];
  }
  const testCommand = readLoopTestCommand(opts.worktree);
  if (testCommand !== null) {
    // 第三方全量 test_command（如 `node --test`）依赖 cwd 定位测试树 ⇒ 显式 cd 进 worktree 再跑
    // （spawnSuiteAndWait spawn 不设 cwd）。
    return ["bash", "-c", `cd ${shq(opts.worktree)} && ${testCommand}`];
  }
  // 无 scripts/test.sh 且无 loop.test_command ⇒ 无测试能力（quay-init 对第三方已 fail-closed 缺
  // test_command，此分支仅防半初始化工作区）。fail-closed 且可区分（⛔ 与「suite 跑了且失败」同形）。
  // ⛔ 不再以「命令不存在」的 exit code 127 形态出现——「能力不存在」须可区分于「命令不存在」
  // （GOAL-012 退出条件②；gap-ac227-third-party-capability-degradation）。
  return ["bash", "-c", `echo 'third-party-no-test-tooling: no scripts/test.sh and no loop.test_command' >&2; exit 2`];
}

/** gap-verification-round-bound-to-quay-shaped-suite-entry — 本 fan-in 的 suite 是否【不经
 *  full-suite-runner.ts】：第三方项目（无 scripts/test.sh）用它自己的 loop.test_command 跑全量 ⇒
 *  runner 这条 verification-round 唯一 writer 不在路径上 ⇒ 台账行须由本层补写（appendDelegatedSuiteRound）。
 *
 *  ⛔ 判据与 defaultMechanicalSuiteCommand / resolveScopedGateCommand 的分支【同源】（hasTestSh +
 *  readLoopTestCommand），不新造第三种「算不算第三方」的判法——三处一旦各判各的，「suite 跑在谁手里」
 *  与「谁负责入账」就会分叉（硬规则 5b：修一个别漏一簇）。
 *  两者皆无（无 test.sh 也无 test_command）⇒ false：那种工作区根本没有 suite 可跑（命令是 fail-closed
 *  exit 2 的「无测试能力」），没有「一轮 suite」可入账。 */
export function suiteRunsOutsideRunner(dir: string): boolean {
  return !hasTestSh(dir) && readLoopTestCommand(dir) !== null;
}

/** gap-verification-round-bound-to-quay-shaped-suite-entry — 第三方 fan-in 的 verification-round 入账：
 *  suite 的执行入口是项目自己的（loop.test_command），但【台账写入与「suite 由谁跑」解耦】——本函数把
 *  这一轮追加进 <root>/.quay/verification-round.jsonl（/tests 卡片读的正是这条载体）。
 *
 *  ⛔ 复用既有 shared writer（buildPreVerifiedRoundRecord + appendPreVerifiedRound）：runId/taskId/
 *  startedAt/durationMs/commit 全取本轮 fan-in 的真实读数；state 由调用方按 suite 结果给（绿/红都入账，
 *  与 full-suite-runner 的「红绿皆入账」契约一致——否则「跑了且红」与「没跑过」同形，硬规则 3b）。
 *  preverified=false（suite 确在本轮 fan-in 内真跑了，⛔ 非复用 capture）。
 *
 *  cpu_time_s 显式 null + cpu_source='not-wired'：第三方路径没有 cgroup scope / gnu-time 包裹 ⇒ 未测得，
 *  ⛔ 不写 0（0 会把「没测」伪装成「测得约 0」，硬规则 4）。laneCount 取 defaultLaneCount()——与同一轮
 *  mirrorMechanicalFanInSuiteState 写进 full-suite-state.json 的值同源，两个载体对同一轮不各说各话。
 *
 *  best-effort（观测写不得阻塞主执行，同 writeSuiteCapture / mirrorMechanicalFanInSuiteState）：失败返回
 *  {ok:false, reason}，由调用方 trace 进 .quay/fan-in-step-trace.jsonl —— 失败可见，但不伪装成通过
 *  （硬规则 3b：观测写失败的取值必须与「写成功」可区分）。 */
export function appendDelegatedSuiteRound(o: {
  task: string;
  runId: string;
  root: string;
  commit: string;
  startedAt: string;
  durationMs: number;
  state: "green" | "red";
  suiteLog: string;
}): { ok: boolean; reason: string | null } {
  try {
    const built = buildPreVerifiedRoundRecord({
      taskId: o.task,
      runId: o.runId,
      startedAt: o.startedAt,
      durationMs: o.durationMs,
      laneCount: defaultLaneCount(),
      load: readLoadAvg(),
      commit: o.commit,
      preverified: false,
      runner: "inner",
      state: o.state,
      suiteLog: o.suiteLog,
      // ⚠️ 字面量 "null"（字符串）而不是 JS null：writer 的「考虑过但取不到」哨兵是 CLI 形态的
      // `--cpu-time-s null`（builder 里 `raw === "null"` ⇒ 记录 cpu_time_s=null，硬规则 6/AC6），而 JS
      // null 会被 builder 的 `!= null` 判成「没传」⇒ 字段整个缺席（cpu_source 却写着 not-wired，两半不自洽）。
      cpuTimeS: "null",
      cpuSource: "not-wired",
      root: o.root,
    }) as { record?: unknown; error?: string };
    if (built.error) return { ok: false, reason: built.error };
    appendPreVerifiedRound(path.join(o.root, ".quay", "verification-round.jsonl"), built.record);
    return { ok: true, reason: null };
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : String(e) };
  }
}

/** fan-in 过程日志文件名（`.quay/fan-in-<task>-<runId>.log` 的 basename）。runId 唯一后缀 ⇒ 跨 relaunch
 *  不复用（同 gap-fan-in-suite-log-cross-relaunch-reuse 防护——旧轮内容不残留）；runId 先 sanitize 到
 *  `[A-Za-z0-9_.-]`（⛔ 不把未净化的 runId 当路径段）。 */
export function fanInLogFileName(task: string, runId: string): string {
  const runIdSafe = runId.replace(/[^A-Za-z0-9_.-]/g, "_");
  return `fan-in-${task}-${runIdSafe}.log`;
}

/** gap-fan-in-suite-log-same-runid-overwrite — suite 日志文件名的【任务边界】分隔符。⛔ 不能用 `-`：
 *  任务 id 本身 kebab-case（实测 DIR-035 / DIR-035-A、exp5-M-CRYST / exp5-M-CRYST-A2 等前缀碰撞 300+ 对），
 *  用 `-` 分隔 ⇒ 轮转按 `fan-in-suite-<task>-` 前缀匹配会把兄弟任务（`<task>-<suffix>`）的日志一并删掉
 *  （硬规则 5b：修一个别漏一簇）。`~` 不在 task/runId 的 sanitize 字符集 `[A-Za-z0-9_.-]` 内 ⇒ 它只能
 *  是分隔符本身，前缀 `fan-in-suite-<task>~` 对任意 task id 都无歧义。 */
const SUITE_LOG_DELIM = "~";

/** suite 日志文件名（`.quay/fan-in-suite-<task>~<runId>~<attempt>.log` 的 basename）。runId 唯一后缀 ⇒
 *  跨 relaunch 不复用（同 gap-fan-in-suite-log-cross-relaunch-reuse 防护——旧轮内容不残留）；attempt
 *  唯一后缀（epoch-ms + rand 双唯一）⇒ 同一 runId 内多次独立 suite 运行互不覆盖
 *  （gap-fan-in-suite-log-same-runid-overwrite AC1）。task/runId 都先 sanitize 到 `[A-Za-z0-9_.-]`
 *  （⛔ 不把未净化的 id 当路径段；也保证 `~` 分隔符在 id 内部永不出现 ⇒ 轮转前缀匹配无歧义）。 */
export function suiteLogFileName(task: string, runId: string, attempt: string): string {
  const taskSafe = task.replace(/[^A-Za-z0-9_.-]/g, "_");
  const runIdSafe = runId.replace(/[^A-Za-z0-9_.-]/g, "_");
  return `fan-in-suite-${taskSafe}${SUITE_LOG_DELIM}${runIdSafe}${SUITE_LOG_DELIM}${attempt}.log`;
}

/** 生成一次 suite 日志的 attempt 后缀（epoch-ms + rand 双唯一——同一 runId 内多次 suite 不覆盖）。
 *  独立成函数供测试直接调用（⛔ 不内联 randomUUID 让「每次新」无处可验；同 newMechanicalSuiteRunId 形态）。 */
export function newSuiteLogAttemptSuffix(): string {
  return `${Date.now()}-${randomUUID().slice(0, 6)}`;
}

/** 轮转：删除某任务名下全部历史 suite attempt 日志（landed 后调用——任务落地，红 attempt 日志不再
 *  需要回溯，⛔ 长期运行 .quay/ 无限堆积孤儿 fan-in-suite-*.log；gap-fan-in-suite-log-same-runid-
 *  overwrite AC3）。用 `<task>~` 前缀精确匹配（⛔ 裸 `<task>-` 会误删兄弟任务 `<task>-<suffix>` 的日志）。
 *  best-effort：删除失败不致命（landing 判定不依赖它）。返回删除的文件数（供 trace）。 */
export function pruneTaskSuiteLogs(root: string, task: string): number {
  const dir = path.join(root, ".quay");
  const taskSafe = task.replace(/[^A-Za-z0-9_.-]/g, "_");
  const prefix = `fan-in-suite-${taskSafe}${SUITE_LOG_DELIM}`;
  let removed = 0;
  try {
    for (const name of fs.readdirSync(dir)) {
      if (name.startsWith(prefix) && name.endsWith(".log")) {
        try {
          fs.rmSync(path.join(dir, name), { force: true });
          removed += 1;
        } catch { /* best-effort — 单文件删除失败不阻断轮转 */ }
      }
    }
  } catch { /* best-effort — 目录缺失/不可读 ⇒ 无可轮转 */ }
  return removed;
}

/** 追加一行 fan-in 过程 trace（JSONL，一行一 JSON；首字段 ts）。写失败不致命（运行时日志，
 *  ⛔ 不因日志写失败炸 fan-in——trace 是观测面不是正确性闸）。 */
export function appendFanInTrace(file: string, entry: Record<string, unknown>): void {
  const rec = { ts: new Date().toISOString(), ...entry };
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.appendFileSync(file, JSON.stringify(rec) + "\n", "utf8");
  } catch { /* best-effort runtime log */ }
}

// ── scoped-gate cache（gap-worker-premerge-scoped-gate-cache）──────────────────────────────────────
// worker 退出前 agent-mediated pre-merge + scoped test 后，机械记录 (task, developSha, verdict=pass)
// 到 .quay/scoped-gate-cache.json（仿 .quay/doc-check-cache.json 的既有模式）。driver 锁内
// merge-develop 之后、scoped-gate 之前查这份缓存：当且仅当锁内合并到的 develop tip 与 worker 记录的
// developSha 完全一致才跳过 scoped-gate（可证明冗余——worker 已对着这个确切状态验证过绿）；develop
// 前进 / 缓存缺失 / 读不懂 ⇒ 照跑（fail-closed，与 docCheckLeg 的「面未变才命中、算不出就照跑」同一条
// 纪律）。只缓存绿、⛔ 键算不出 ⇒ 照跑。

/** 缓存键 = `${task}\t${developSha}`（task id 不含 \t；developSha 是 develop tip 的完整 sha）。
 *  (task, developSha) 二元组唯一确定键——develop 前进一个提交即失配（未命中照跑）。 */
export function scopedGateKey(task: string, developSha: string): string {
  return `${task}\t${developSha}`;
}

/** 缓存条目形：最后一个 GREEN scoped-gate verdict，键 = scopedGateKey(task, developSha)。 */
export interface ScopedGateCacheEntry {
  key: string;
  ok: true;
  ts: string;
}

/** 读键为 `key` 的缓存绿 verdict。命中（key 完全一致 + ok:true）⇒ true；未命中/缺失/损坏/非绿 ⇒
 *  null（fail-closed——null 永不是命中）。签名与 readDocCheckCache 对齐。 */
export function readScopedGateCache(cacheFile: string, key: string): boolean | null {
  try {
    if (!fs.existsSync(cacheFile)) return null;
    const raw: unknown = JSON.parse(fs.readFileSync(cacheFile, "utf8"));
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
    const entry = raw as ScopedGateCacheEntry;
    if (entry.key !== key) return null;
    if (entry.ok !== true) return null; // only GREEN verdicts are cacheable
    return true;
  } catch {
    return null;
  }
}

/** 写 GREEN verdict（原子替换；只有绿才被缓存——worker 仅在 scoped 门跑绿后调用）。best-effort：
 *  写失败 ≠ fan-in 失败。签名与 writeDocCheckCache 对齐。 */
export function writeScopedGateCache(cacheFile: string, key: string): void {
  try {
    fs.mkdirSync(path.dirname(cacheFile), { recursive: true });
    const entry: ScopedGateCacheEntry = { key, ok: true, ts: new Date().toISOString() };
    const tmp = `${cacheFile}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(entry) + "\n", "utf8");
    fs.renameSync(tmp, cacheFile);
  } catch {
    // best-effort runtime cache — never let a cache write fail the fan-in
  }
}

/**
 * driver 机械跑通一次无失败 fan-in 的 happy path（锁/merge/delta/typecheck/scoped门/suite/ff）。
 * ⛔ 语义失败点（merge 冲突 / anti-drift HARD FAIL / typecheck 红 / suite 红 / ff 失败）一律返回
 * outcome=red + step，由调用方回退旧 workflow 子代理兜底（本函数不调 LLM、不做语义修复）。
 * 锁在任一退出路径都会 release（finally）——成功 release 于 ff 之后（AC2）；失败也 release（回退的
 * workflow 子代理会重新 acquire，幂等）。
 */
export async function runMechanicalFanIn(opts: MechanicalFanInOptions): Promise<MechanicalFanInResult> {
  const { task, worktree, root, runId } = opts;
  // gap-mechanical-fan-in-per-suite-runid-unified — the per-suite runId (suite 身份，非 runId 的过程身份)。
  // Generated ONCE per fan-in (each fan-in = one suite) so the runner's full-suite-state / suite-load-
  // <runId>.jsonl / verification-round record all carry the SAME key the /tests page joins on.
  const perSuiteRunId = opts.perSuiteRunId ?? newMechanicalSuiteRunId(task);
  const mergeTarget = opts.mergeTarget ?? "develop";
  const slotBase = opts.slotBase ?? suiteLockBase(root);
  // ⛔ 非 root/plugin/scripts/（第三方项目无 plugin/）——resolveKernelShellSibling 锚在本 kernel 安装
  // 位置；缺 ⇒ 回退 kernel plugin root 下的同路径（suite 取槽时 `source <缺失路径>` 报错 ⇒ fail-closed）。
  const slotLib = opts.slotLib ?? (resolveKernelShellSibling("suite-slot-lib.sh")
    ?? path.join(resolveKernelPluginRoot(), "scripts", "suite-slot-lib.sh"));
  const suiteCapture = opts.suiteCapture ?? `/tmp/fan-in-suite-${task}.env`;
  const runIdSafe = runId.replace(/[^A-Za-z0-9_.-]/g, "_");
  // 过程日志（A1，gitignored 运行时日志）：.quay/fan-in-<task>-<runId>.log，逐步骤 trace。
  const fanInLog = path.join(root, ".quay", `fan-in-${task}-${runIdSafe}.log`);
  // 套件日志（A2）：从 /tmp 迁到 .quay/（durable——/tmp 系统清理实证见 3389 个测试遗留目录）。文件名带
  // runId + attempt——⛔ 不再复用 /tmp/fan-in-suite-${task}.log（跨 relaunch 残留旧轮内容，
  // gap-fan-in-suite-log-cross-relaunch-reuse）；attempt 唯一后缀 ⇒ 同一 runId 内多次 suite 互不覆盖
  // （gap-fan-in-suite-log-same-runid-overwrite AC1）。
  const suiteLogFile =
    opts.suiteLogFile ?? path.join(root, ".quay", suiteLogFileName(task, runId, newSuiteLogAttemptSuffix()));
  const suiteStateFile = opts.suiteStateFile ?? path.join(root, ".quay", "full-suite-state.json");
  const scriptsDir = opts.scriptsDir ?? resolveKernelScriptsDir();
  // P2 (gap-execution-loop-productization-p2-p4): the ff 持锁段 is now a TS module (packages/quay/
  // fan-in/ff-merge.ts), IMPORTED — ⛔ no shell-out to the retired bash fan-in-ff-merge.sh.
  // gap-resolve-kernel-src-module-strip-types-node-modules: 生产走静态字面量动态 import（源树相对解析，
  // shipped bundle 由 coreSrcAliasPlugin 内联）；opts.ffMergeModule 测试缝保留（hermetic 仓库 worktree
  // 无 packages/quay/src ⇒ 由测试显式传 FF_MERGE_MODULE）。
  // 编排脚本（anti-drift/classify/typecheck/ac-gate）：opts.scriptsDir 覆盖（hermetic 测试缝，⛔ 生产不用）
  // ⇒ <scriptsDir>/<name>.ts 直拼（带 --experimental-strip-types）；缺省 ⇒ kernelSiblingArgv（第三方项目无
  // plugin/scripts/，.ts 已 bundle 成 dist/*.js，resolveKernelSibling 回退到 .js 且不带 flag——
  // gap-plugin-root-resolution-remaining-callsites-round2）。
  const gateArgv = (name: string): string[] =>
    opts.scriptsDir
      ? ["node", "--experimental-strip-types", path.join(opts.scriptsDir, name)]
      : ["node", ...kernelSiblingArgv(name)];
  const antiDrift = gateArgv("anti-drift-touches-check.ts");
  const classify = gateArgv("select-static-checks-for-touches.ts");
  const typecheck = gateArgv("fan-in-ts-typecheck-gate.ts");
  const acGate = gateArgv("fan-in-ac-completion-gate.ts");

  // gap-mechanical-fan-in-red-lock-times-null：失败结果在【release 之后】才读锁时间（同成功路径
  // :3625 的时机）——⛔ 不能在 try 内 return 时就地读（release 事件尚未落盘 ⇒ lockHoldSecs 恒 null），
  // 也不能事后补读（后续重试会追加更新的 acquire/release ⇒ readFanInLockHold 取最后一组 ⇒ 张冠李戴）。
  // pendingRed = 已获锁失败结果的待填句柄：verdictOf/failSuite 构造时不带锁字段，finally release 后统一填。
  let pendingRed: MechanicalFanInResult | null = null;

  // D6：单步失败产出结构化 verdict（⛔ 不再是 `(stderr||stdout).trim()` 裸流）。裸流 dump 进 logFile、
  // summary 去噪保留「哪个测试失败」，reason 是 summary 的投影（旧读面，⛔ 不含 MODULE_TYPELESS 噪声）。
  const verdictOf = (step: string, exitCode: number | null, summary: string, logFile: string | null): MechanicalFanInResult => {
    const r = {
      outcome: "red",
      verdict: { step, verdict: "failed", exitCode, summary, logFile },
      step, reason: summary,
      suiteFinishedEpoch: null, suiteOutcome: null, suitePid: null, landedSha: null,
      suiteLog: null,
      fanInLog: path.basename(fanInLog),
    } as unknown as MechanicalFanInResult; // 锁字段在 finally release 后填（见 pendingRed）
    pendingRed = r;
    return r;
  };
  const stepLogFile = (step: string): string =>
    `/tmp/fan-in-step-${task}-${runId.replace(/[^A-Za-z0-9_.-]/g, "_")}-${step}.log`;
  // 有裸流的机械步：stdout+stderr 全量 dump 进 logFile，summary 从合并流提取（⛔ 只取 stderr 会丢
  // stdout 里真正的测试结果——D6 的病根）。dump 失败不致命（logFile=null，summary 仍可定位）。
  const fail = (step: string, a: MechShResult): MechanicalFanInResult => {
    const combined = combinedOutput(a.stdout, a.stderr);
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
  // 无裸流的机械步（reason 已结构化：flip-done / exception；acquire-fan-in-lock 走独立构造——结构性例外）。
  const failClean = (step: string, summary: string, exitCode: number | null = null): MechanicalFanInResult =>
    verdictOf(step, exitCode, summary, null);

  // 逐步骤 trace（A1，gap-mech-fan-in-log-webui-visible-clickable）：每步追加一行 {ts, step, exit,
  // wall_ms, ok} 到 .quay/fan-in-<task>-<runId>.log（web 可见的过程日志），失败步附 reason。
  const trace = (entry: Record<string, unknown>): void => appendFanInTrace(fanInLog, entry);
  // suite 决策事件的两路 trace（gap-fan-in-step-trace-suite-step-stopped-writing）：ac-precheck /
  // suite-start / suite-end / suite-skip 除写 per-run 过程日志（trace()，web 详情页 a5a301e03 的读者）
  // 外，还必须镜像到共享载体 .quay/fan-in-step-trace.jsonl（appendFanInStepTrace，跨任务/跨时间聚合
  // 监控的读者，如 gap-archguard-p5-instrument-decay-standing-guard）——两者服务不同读者，⛔ 互斥=分裂
  // （原 bug：只写 per-run 让共享读者永久看不到这批步骤）。phase 统一 "end"（单发事件，⛔ 用 "begin"
  // 会给挂起检测留下「begin 无 end」的假挂起）。与 trace() 一一对应 ⇒ 两载体 suite 条目数一致（AC3）。
  const traceSuiteEvent = (step: string, extra: Record<string, unknown>): void => {
    appendFanInStepTrace(root, task, runId, step, "end", extra);
    trace({ step, ...extra });
  };
  // mechSh 步的包层：跑 + 计时 + 两路 trace——① appendFanInStepTrace begin/end（挂起 = begin 无 end，
  // 据 epoch 定位挂起步；gap-fan-in-subprocess-hang-timeout-recovery AC1）；② A1 一行过程日志。
  const step = async (name: string, argv: string[], timeoutMs = 120_000): Promise<MechShResult> => {
    const t0 = Date.now();
    appendFanInStepTrace(root, task, runId, name, "begin");
    const r = await mechSh(argv, timeoutMs);
    appendFanInStepTrace(root, task, runId, name, "end", { ok: r.ok });
    trace({
      step: name, exit: r.status, wall_ms: Date.now() - t0, ok: r.ok,
      ...(r.ok ? {} : { reason: extractFailureSummary(combinedOutput(r.stdout, r.stderr)) || `exit ${r.status}` }),
    });
    return r;
  };

  // 1. acquire fan-in lock（机械包裹整段 merge→suite→ff，AC4）。ADR-034：driver 自身经非分离
  // 直接子进程持锁（⛔ 废除 fan-in-ff-merge.sh 的 `& disown` 分离 holder + flag 释放协议）——锁的生死 =
  // 工作的进程生死，driver 死（含 SIGKILL）⇒ 内核关 stdin 写端 ⇒ holder 释放 flock。unbounded（无超时）：
  // fan-in 锁是正确性锁（「此刻谁可 merge develop」），排队等待正是它存在的意义（⛔ 120s 短超时会在
  // 等待时误杀，gap-mech-fan-in-acquire-lock-timeout-queue-semantics）。⛔ 无时间阈值（无 hold-max/TTL/stale）。
  let fanInLock: FanInLockHandle;
  const acquireT0 = Date.now();
  try {
    fanInLock = await acquireFanInLock({ root, task, runId });
    trace({ step: "acquire-fan-in-lock", exit: 0, wall_ms: Date.now() - acquireT0, ok: true });
  } catch (e) {
    trace({ step: "acquire-fan-in-lock", exit: 1, wall_ms: Date.now() - acquireT0, ok: false, reason: (e as Error)?.message ?? "acquire failed" });
    // 结构性例外（锁本身没拿到，无 acquire 事件可读）：锁字段显式 null。⛔ 不走 verdictOf 的 pendingRed
    // 填充路径——那条只对【已获锁之后】的失败有意义（gap-mechanical-fan-in-red-lock-times-null）。
    const reason = (e as Error)?.message ?? "acquire failed";
    return {
      outcome: "red",
      verdict: { step: "acquire-fan-in-lock", verdict: "failed", exitCode: null, summary: reason, logFile: null },
      step: "acquire-fan-in-lock", reason,
      lockHoldSecs: null, lockAcquireEpoch: null, lockReleaseEpoch: null,
      suiteFinishedEpoch: null, suiteOutcome: null, suitePid: null, landedSha: null,
      suiteLog: null,
      fanInLog: path.basename(fanInLog),
    };
  }
  const releaseLock = async (): Promise<void> => {
    await fanInLock.release();
  };
  let a: MechShResult;

  let suiteOutcome: SuiteOutcome | null = null;
  let suiteFinishedEpoch: number | null = null;
  let suitePid: number | null = null;

  // A（gap-worker-execution-history-index-not-reachable-from-task）：suite 红时 verdict.logFile 指向
  // .quay/fan-in-suite-*.log（真因文件，⛔ 不再 null——旧一路 logFile:null 让 183KB 真因只能靠命名约定
  // 猜）+ suiteLog 落 mechanical_fan_in（与 fanInLog 同形的 basename，web/续做/needs-human 据此构造绝对路径）。
  const failSuite = (summary: string, exitCode: number | null): MechanicalFanInResult => {
    const r = {
      outcome: "red",
      verdict: { step: "suite", verdict: "failed", exitCode, summary, logFile: suiteLogFile },
      step: "suite", reason: summary,
      suiteFinishedEpoch: null, suiteOutcome: null, suitePid: null, landedSha: null,
      suiteLog: path.basename(suiteLogFile),
      fanInLog: path.basename(fanInLog),
    } as unknown as MechanicalFanInResult; // 锁字段在 finally release 后填（见 pendingRed）
    pendingRed = r;
    return r;
  };

  try {
    // 2. merge develop（冲突 ⇒ red → 语义会话兜底）。
    a = await step("merge-develop", ["git", "-C", worktree, "merge", "--no-edit", mergeTarget], 120_000);
    if (!a.ok) return fail("merge-develop", a);

    // 3. anti-drift Touches 核对（HARD FAIL ⇒ red）。
    a = await step("anti-drift", [...antiDrift, "--task", task, "--worktree", worktree, "--merge-target", mergeTarget], 120_000);
    if (!a.ok) return fail("anti-drift", a);

    // 4. delta 断言面判定（doc-only 跳过 suite，code 跑 suite；判不出 fail-closed 跑 suite）。
    const deltaT0 = Date.now();
    const fork = await mechSh(["git", "-C", worktree, "merge-base", mergeTarget, "HEAD"], 30_000);
    const deltaFiles = await mechSh(["git", "-C", worktree, "diff", "--name-only", (fork.stdout || "").trim(), "HEAD"], 30_000);
    const deltaList = (deltaFiles.stdout || "").split("\n").map((s) => s.trim()).filter(Boolean);
    let codeDelta = "";
    if (deltaList.length > 0) {
      const cd = await mechSh([...classify, "--classify-delta", "--root", worktree, ...deltaList], 120_000);
      codeDelta = cd.ok ? (cd.stdout || "").trim() : "__CLASSIFY_FAILED__";
    }
    // 4b. develop 前进面复用（gap-fan-in-continue-doc-only-advance-reuse-suite）：任务自身 delta 是 code
    // 时，若上一轮 green bucket suite（full-suite-state.json 的 mirror 记录，taskId=本任务）之后、
    // 当前 HEAD 只触及 doc/inert 面（develop 在长 suite 期间被 doc/inert 前进 ⇒ ff not-fast-forward ⇒
    // CONTINUE 重跑，重跑时任务 delta 仍是 code），则复用上一 green 判定、不重跑 suite。判不出
    // （无上一 green / 非祖先 / classify 失败）⇒ fail-closed 照常跑 suite（硬规则 3b）。
    let reuseSkip = false;
    if (codeDelta !== "" && codeDelta !== "__CLASSIFY_FAILED__") {
      const prevCommit = readPreviousGreenSuiteCommit(suiteStateFile, task);
      if (prevCommit) {
        const anc = await mechSh(["git", "-C", worktree, "merge-base", "--is-ancestor", prevCommit, "HEAD"], 30_000);
        if (anc.ok) {
          const sincePrev = await mechSh(["git", "-C", worktree, "diff", "--name-only", prevCommit, "HEAD"], 30_000);
          const sinceList = (sincePrev.stdout || "").split("\n").map((s) => s.trim()).filter(Boolean);
          const adv = await mechSh([...classify, "--classify-delta", "--root", worktree, ...sinceList], 120_000);
          reuseSkip = adv.ok && (adv.stdout || "").trim() === ""; // 前进面全 doc/inert ⇒ 复用上一 green
        }
      }
    }
    const needSuite = opts.forceSuite === true || codeDelta === "__CLASSIFY_FAILED__" || (codeDelta !== "" && !reuseSkip);
    trace({ step: "delta", exit: 0, wall_ms: Date.now() - deltaT0, ok: true, reason: needSuite ? (codeDelta === "__CLASSIFY_FAILED__" ? "classify failed → run suite (fail-closed)" : `code delta (${codeDelta || "forced"}) → run suite`) : (reuseSkip ? "code delta + doc/inert-only develop advance → reuse prev green (skip suite)" : "doc-only delta → skip suite") });

    // 5. ts-typecheck ∥ doc-check 并行（merge+anti-drift 后二者相互独立，可并行；doc-check 提前到
    //    scoped-gate 之前——廉价失败先于昂贵）。合并为一次 gate 判定：任一非零 ⇒ red → 语义会话兜底。
    //    失败报告顺序 typecheck 先于 doc-check（与串行序一致——AC3 判定一致性的读面）。
    const docCmd = opts.docCheckCommand ?? docCheckCommandFor(worktree);
    // doc-check 缓存（gap-fan-in-doc-check-cache）：doc 面 = run_doc_checks 读的全部输入（@static-object
    // 判定对象 + plugin/scripts 检查器/仪器面 + scripts/test.sh + .gitignore + 全树文件结构）。面未变 ⇒
    // 命中上次绿 verdict（~0s，reason=cache-hit）；面变 ⇒ 失效重跑。⛔ 只缓存绿、⛔ 键算不出 ⇒ 照跑（fail-closed）。
    const docCacheFile = opts.docCheckCacheFile ?? path.join(root, ".quay", "doc-check-cache.json");
    const docCheckLeg = async (): Promise<MechShResult> => {
      const t0 = Date.now();
      // 第三方项目：无 doc-check 工具（scripts/test.sh 不存在）⇒ 跳过，可区分取值
      // third-party-no-doc-check-tooling（⛔ 不与「doc 检查真的跑了且失败」同形，硬规则 3b）。
      if (docCmd === null) {
        const reason = "third-party-no-doc-check-tooling";
        appendFanInStepTrace(root, task, runId, "doc-check", "end", { ok: true, reason });
        trace({ step: "doc-check", exit: 0, wall_ms: Date.now() - t0, ok: true, reason });
        return { ok: true, status: 0, stdout: "", stderr: "", error: null };
      }
      const docKey = computeDocCheckFaceKey(worktree);
      const cachedDocOk = docKey === null ? null : readDocCheckCache(docCacheFile, docKey);
      if (cachedDocOk === true) {
        trace({ step: "doc-check", exit: 0, wall_ms: Date.now() - t0, ok: true, reason: "cache-hit" });
        return { ok: true, status: 0, stdout: "", stderr: "", error: null };
      }
      const r = await step("doc-check", docCmd, 300_000);
      if (docKey !== null && r.ok) writeDocCheckCache(docCacheFile, docKey);
      return r;
    };
    const [tc, dc] = await Promise.all([
      step("typecheck", [...typecheck, "--task", task, "--worktree", worktree, "--merge-target", mergeTarget], 120_000),
      docCheckLeg(),
    ]);
    if (!tc.ok) return fail("typecheck", tc);
    if (!dc.ok) return fail("doc-check", dc);

    // 5.5 archguard 结构闸【已从 fan-in gate 链移除】（gap-fan-in-remove-archguard-gate）：零发火、零指引、
    // 27s/次串行关键路径（周 1.33h），降级为【按需命令】（AC3/AC4）——需要结构信号时手动跑：
    //   node --experimental-strip-types plugin/scripts/archguard-runner.ts --root <repo-root>
    // 产物 append 进 <repo-root>/.archguard/metrics-history.jsonl（按需产出，不进 fan-in 关键路径）。

    // 6. scoped 门（必须绿）。worker 已在退出前对着同一 develop tip 跑绿并写缓存（gap-worker-premerge-
    //    scoped-gate-cache）⇒ 锁内 merge 到的 develop tip 与 worker 记录的 developSha 完全一致时跳过
    //    （可证明冗余——worker 已对着这个确切状态验证过绿）；develop 前进 / 缓存缺失 / 读不懂 ⇒ 照跑
    //    （fail-closed，同 docCheckLeg 的「面未变才命中、算不出就照跑」纪律）。
    const scopedCmd = opts.scopedGateCommand ?? scopedGateCommandFor(task, worktree);
    const scopedCacheFile = opts.scopedGateCacheFile ?? path.join(root, ".quay", "scoped-gate-cache.json");
    const scopedT0 = Date.now();
    // 第三方项目：无 scoped 能力（scripts/test.sh 与 loop.test_command 皆无）⇒ 跳过 scoped 门直接进
    // 全量 suite，可区分取值 third-party-no-scoped-tooling（⛔ 不与「scoped 门跑了且失败」同形，硬规则 3b）。
    if (scopedCmd === null) {
      const reason = "third-party-no-scoped-tooling";
      appendFanInStepTrace(root, task, runId, "scoped-gate", "end", { ok: true, reason });
      trace({ step: "scoped-gate", exit: 0, wall_ms: Date.now() - scopedT0, ok: true, reason });
    } else {
      const scopedDevelopSha = (await mechSh(["git", "-C", worktree, "rev-parse", mergeTarget], 30_000)).stdout.trim();
      const scopedCacheHit = scopedDevelopSha !== "" && readScopedGateCache(scopedCacheFile, scopedGateKey(task, scopedDevelopSha)) === true;
      if (scopedCacheHit) {
        trace({ step: "scoped-gate", exit: 0, wall_ms: Date.now() - scopedT0, ok: true, reason: "cache-hit(worker-premerge)" });
      } else {
        a = await step("scoped-gate", scopedCmd, 600_000);
        if (!a.ok) return fail("scoped-gate", a);
      }
    }

    // 7. suite（driver 子进程 + 异步 poll，⛔ 不 detach——AC3）。suite_head 在 merge + 各闸之后取。
    const suiteHead = (await mechSh(["git", "-C", worktree, "rev-parse", "HEAD"], 30_000)).stdout.trim();
    // gap-verification-round-bound-to-quay-shaped-suite-entry — 第三方路径（suite 由项目自己的
    // loop.test_command 跑，不经 full-suite-runner）的 verification-round 入账。绿/红共用这一处
    // （⛔ 不两条分支各写一份——那正是硬规则 5b 的成簇漏改形态）。本仓库形态（有 scripts/test.sh）⇒
    // suiteRunsOutsideRunner=false 直接返回，runner 已写，行为逐字不变（AC2 负控制）。
    const recordDelegatedRound = (state: "green" | "red", startedAt: string, durationMs: number): void => {
      if (!suiteRunsOutsideRunner(worktree)) return;
      const t0 = Date.now();
      const rd = appendDelegatedSuiteRound({
        task, runId: perSuiteRunId, root, commit: suiteHead,
        startedAt, durationMs, state, suiteLog: suiteLogFile,
      });
      traceSuiteEvent("verification-round-record", {
        exit: rd.ok ? 0 : 1, wall_ms: Date.now() - t0, ok: rd.ok,
        ...(rd.ok ? {} : { reason: rd.reason ?? "append failed" }),
      });
    };
    if (needSuite) {
      // 6.5 AC 全勾 fail-fast 预检（suite 前——未全勾直接拒翻跳过 suite，省注定无效的 9-11min/cycle；
      // gap-fan-in-ac-precheck-before-suite）。⛔ 用同源 ac-gate 脚本 --json 读结构化 verdict
      // （checked/total）——不新造计数函数（countCompletionCheckboxes / isLandedCodeComplete 同源，与
      // flip 闸 fan-in-ac-completion-gate.ts 一致）。not-evaluated（段缺失）fail-closed 拒翻（硬规则 3b：
      // 无法评估 ≠ 合格）。⛔ 保留 step 8 的 ac-gate（flip 闸）——flip 前再判一次（幂等双保险）。
      const acPreT0 = Date.now();
      const acPre = await mechSh([...acGate, "--task", task, "--worktree", worktree, "--json"], 60_000);
      if (!acPre.ok) {
        let checkedTotal = "?/?";
        let status = "fail";
        try {
          const parsed = JSON.parse((acPre.stdout || "").trim());
          if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
            const c = typeof parsed.checked === "number" ? String(parsed.checked) : "?";
            const n = typeof parsed.total === "number" ? String(parsed.total) : "?";
            checkedTotal = `${c}/${n}`;
            if (typeof parsed.status === "string") status = parsed.status;
          }
        } catch { /* JSON 解析失败 ⇒ 保守 ?/?（仍拒翻，fail-closed） */ }
        const summary = status === "not-evaluated"
          ? `AC/DoD 段缺失或无法识别（${checkedTotal}）——suite 前 fail-fast 拒翻`
          : `AC 未全勾（${checkedTotal}）——suite 前 fail-fast 拒翻`;
        traceSuiteEvent("ac-precheck", { exit: acPre.status, wall_ms: Date.now() - acPreT0, ok: false, reason: summary });
        return failClean("ac-precheck", summary, acPre.status);
      }
      traceSuiteEvent("ac-precheck", { exit: 0, wall_ms: Date.now() - acPreT0, ok: true });

      traceSuiteEvent("suite-start", { exit: 0, wall_ms: 0, ok: true });
      const suiteCmd = opts.suiteCommand ?? defaultMechanicalSuiteCommand({ task, worktree, root, suiteLogFile, runId: perSuiteRunId });
      const sr: SuiteRunResult = await spawnSuiteAndWait({ slotBase, slotLib, suiteCommand: suiteCmd, logFile: suiteLogFile, silenceMs: opts.silenceMs });
      suiteOutcome = sr.outcome;
      suiteFinishedEpoch = Math.floor(new Date(sr.finishedAt).getTime() / 1000);
      suitePid = sr.pid;
      traceSuiteEvent("suite-end", { exit: sr.exitCode, wall_ms: sr.durationMs, ok: sr.outcome === "done", ...(sr.outcome === "done" ? {} : { reason: sr.error ?? `suite ${sr.outcome}` }) });
      if (sr.outcome !== "done") {
        // 红 suite 记录由 full-suite-runner.ts --buckets 在 suite 退出时写入（gap-fan-in-red-bucket-run-
        // not-recorded：runner 是 verification-round.jsonl 的唯一 writer，green+red 都入账，静态闸红亦由
        // runner 的 staticCheckDetected → gate=static-check 记录）。⛔ 不平行补写——runner 已记 + 再补写
        // = 同一红 suite 两条记录、round 号虚增（与「两套平行机制收敛为一」相悖）。
        // gap-needs-human-note-missing-real-error-line：suite 红 needs-human 的「失败步/判词」不再恒为
        // 「suite red」——把 suite 日志（stdout 落进 suiteLogFile）摘要出第一条真实断言/报错行塞进 reason。
        // 无信号 / 日志缺失 ⇒ 回退通用文案（硬规则 3b 三态可分，⛔ 不伪造/截断出误导内容）。
        let suiteLogText = "";
        try {
          suiteLogText = fs.readFileSync(suiteLogFile, "utf8");
        } catch { /* 日志缺失 ⇒ fallback 通用文案 */ }
        const firstFailure = extractFirstFailureLine(suiteLogText);
        // gap-verification-round-bound-to-quay-shaped-suite-entry：第三方路径的红轮同样入账
        // （「跑了且红」必须与「没跑过」可分，硬规则 3b；与 full-suite-runner 的红绿皆入账契约一致）。
        recordDelegatedRound("red", sr.startedAt, sr.durationMs);
        return failSuite(firstFailure || `suite ${sr.outcome}${sr.error ? `: ${sr.error}` : ""}`, sr.exitCode);
      }
      writeSuiteCapture(suiteCapture, {
        full_suite_ran: "true", skip_reason: "", suite_exit: "0",
        suite_head: suiteHead, start_iso: sr.startedAt, end_iso: sr.finishedAt,
      });
      // gap-verification-round-bound-to-quay-shaped-suite-entry：第三方路径的绿轮入账（红轮在 suite
      // 退出分支，见 recordDelegatedRound 定义处的说明）。
      recordDelegatedRound("green", sr.startedAt, sr.durationMs);
      // D7：把本轮 bucket suite 状态镜像到权威载体 full-suite-state.json（scope=worktree + taskId 区分
      // bucket-run 与 full-run，⛔ 不伪造 full-green；finishedAt 与 mfi.suiteFinishedEpoch 同源 ⇒ 不陈旧）。
      // ⛔ runId 用 perSuiteRunId（非过程 runId）——runner 已用 perSuiteRunId 写 full-suite-state，镜像
      // 必须同键，否则 AC1「state/load/记录三者同键」被镜像最后一写破坏（gap-mechanical-fan-in-per-suite-runid-unified）。
      mirrorMechanicalFanInSuiteState({
        task, runId: perSuiteRunId, commit: suiteHead,
        startedAt: sr.startedAt, finishedAt: sr.finishedAt, durationMs: sr.durationMs,
        stateFile: suiteStateFile,
      });
    } else {
      writeSuiteCapture(suiteCapture, { full_suite_ran: "false", skip_reason: reuseSkip ? "develop-advance-doc-only-reuse" : "doc-only-delta", suite_exit: "0", suite_head: suiteHead });
      traceSuiteEvent("suite-skip", { exit: 0, wall_ms: 0, ok: true, reason: reuseSkip ? "develop-advance-doc-only-reuse" : "doc-only-delta" });
    }

    // 8. land 前 anti-drift 重跑 + AC 完成闸 + flip done（先 flip 后 ff，人 2026-08-14 裁定）。
    a = await step("anti-drift-land", [...antiDrift, "--task", task, "--worktree", worktree, "--merge-target", mergeTarget], 120_000);
    if (!a.ok) return fail("anti-drift-land", a);
    a = await step("ac-gate", [...acGate, "--task", task, "--worktree", worktree], 60_000);
    if (!a.ok) return fail("ac-gate", a);
    const flipT0 = Date.now();
    const flip = await flipTaskDone(worktree, task, mergeTarget);
    trace({ step: "flip-done", exit: flip.ok ? 0 : 1, wall_ms: Date.now() - flipT0, ok: flip.ok, ...(flip.ok ? {} : { reason: flip.reason ?? "flip failed" }) });
    if (!flip.ok) return failClean("flip-done", flip.reason ?? "flip failed");

    // 9. ff（fan-in/ff-merge.ts 读 suite capture 证书 + L1 token 闸；成功 fall through，失败 red）。
    //    P2：⛔ 不再 shell-out 到 bash fan-in-ff-merge.sh —— 持锁段业务已 TS 模块化被 import。
    const ffT0 = Date.now();
    appendFanInStepTrace(root, task, runId, "ff", "begin");
    const ffToken = randomUUID();
    const { ffMerge: ffMergeFn } = await (
      opts.ffMergeModule
        ? import(/* @vite-ignore */ pathToFileURL(opts.ffMergeModule).href)
        : import("../../packages/quay/src/fan-in/ff-merge.ts")
    ) as { ffMerge: (o: { task: string; root: string; mergeTarget: string; runId: string; attemptKey: string; worktree: string; suiteCapture: string; suiteState: string; lockWaitSecs: number; token: string; scriptsDir: string }) => Promise<{ code: number; stdout: string; stderr: string; landedSha: string | null }> };
    // attemptKey = perSuiteRunId (mfi-<task>-<epoch>-<rand>, generated once per fan-in): the per-dispatch
    // identity for the ff retry counter. ⛔ NOT runId (wk-prod-<epoch>) — that is the driver-process
    // lifetime id, constant across dispatches, which latches a task's retry budget across independent
    // dispatches (gap-ff-retry-counter-runid-no-longer-per-dispatch).
    const ff = await ffMergeFn({
      task, root, mergeTarget, runId, attemptKey: perSuiteRunId, worktree, suiteCapture, suiteState: suiteStateFile,
      lockWaitSecs: 30, token: ffToken, scriptsDir,
    });
    appendFanInStepTrace(root, task, runId, "ff", "end", { ok: ff.code === 0 });
    trace({ step: "ff", exit: ff.code, wall_ms: Date.now() - ffT0, ok: ff.code === 0, ...(ff.code === 0 ? {} : { reason: (ff.stderr || ff.stdout || "").trim() || `exit ${ff.code}` }) });
    if (ff.code !== 0) return fail("ff", { ok: false, status: ff.code, stdout: ff.stdout, stderr: ff.stderr, error: null });

    // 9.4b 写 complete pass GateEvent（gap-mechanical-fan-in-writes-no-complete-gateevent AC2）：机械
    // fan-in 此前绕过 gate 引擎（runMechanicalFanIn/flipTaskDone 全文零 GateEvent），.quay/gate-events.jsonl
    // 里 complete 单路缺席——stale-ready-audit 的 bypassComplete 每轮报 9 条真阳性被当噪声。现在经既有
    // gate-event-store 补写（与 CLI/loop 同一载体，⛔ 不手搓 append）。best-effort：写失败不致命。
    const gateEventT0 = Date.now();
    const gateEvent = await appendCompleteGateEvent(root, task);
    trace({
      step: "append-complete-gate-event", exit: gateEvent.ok ? 0 : 1, wall_ms: Date.now() - gateEventT0,
      ok: gateEvent.ok, ...(gateEvent.ok ? {} : { reason: gateEvent.reason ?? "write failed" }),
    });

    // 9.5 清理 worktree + 删 task 分支（ff 成功后——landed 判据 = status done ∧ 无残留 worktree）。
    // best-effort：移除失败不致命，landing 判定（computeLandingState）会据残留 worktree 诚实判未落地。
    const cleanupT0 = Date.now();
    const wr = await mechSh(["git", "-C", root, "worktree", "remove", "--force", worktree], 60_000);
    const bd = await mechSh(["git", "-C", root, "branch", "-D", `task/${task}`], 60_000);
    const cleanupOk = wr.ok && bd.ok;
    // 轮转：landed ⇒ 清掉该任务名下全部历史 suite attempt 日志（⛔ 长期 .quay/ 无限堆积孤儿
    // fan-in-suite-*.log；gap-fan-in-suite-log-same-runid-overwrite AC3）。best-effort，非 landing 判据。
    const prunedSuiteLogs = pruneTaskSuiteLogs(root, task);
    trace({
      step: "cleanup", exit: cleanupOk ? 0 : 1, wall_ms: Date.now() - cleanupT0, ok: cleanupOk,
      ...(cleanupOk
        ? (prunedSuiteLogs > 0 ? { reason: `pruned ${prunedSuiteLogs} suite attempt log(s)` } : {})
        : { reason: "worktree remove / branch delete best-effort (non-fatal)" }),
    });
  } catch (e) {
    return failClean("exception", (e as Error)?.message ?? String(e));
  } finally {
    const relT0 = Date.now();
    await releaseLock();
    // 已获锁的失败结果：release 事件刚落盘，此刻读锁时间 = 本次尝试自己的区间（⛔ 早读无 release、
    // 晚读会被后续重试的区间张冠李戴——gap-mechanical-fan-in-red-lock-times-null）。
    if (pendingRed !== null) {
      const lock = readFanInLockHold(root, task, runId);
      pendingRed.lockHoldSecs = lock.lockHoldSecs;
      pendingRed.lockAcquireEpoch = lock.lockAcquireEpoch;
      pendingRed.lockReleaseEpoch = lock.lockReleaseEpoch;
    }
    trace({ step: "release-fan-in-lock", exit: 0, wall_ms: Date.now() - relT0, ok: true });
  }

  // 成功路径（try 未 return）：release 之后读锁持有时长 + 落地 sha。
  const landedSha = (await mechSh(["git", "-C", root, "rev-parse", mergeTarget], 30_000)).stdout.trim();
  const lock = readFanInLockHold(root, task, runId);
  return {
    outcome: "landed", verdict: null, step: null, reason: null,
    ...lock, suiteFinishedEpoch, suiteOutcome, suitePid, landedSha,
    suiteLog: null,
    fanInLog: path.basename(fanInLog),
  };
}

/**
 * 每任务新进程执行（gap-fan-in-token-gate-version-mismatch-self-lock AC1）：机械 fan-in 不在守护进程
 * in-process 跑（守护是主检出旧代码、但 fan-in 编排脚本从 worktree 加载 ⇒ 版本错位），改为每任务 spawn
 * 一个 fresh node 进程加载 worker-driver.ts --mechanical-fan-in。执行器（entry）锚在本 kernel 安装位置
 * （kernelSiblingArgv("worker-driver.ts") = resolveKernelSibling，与 driver 同版）——⛔ 不用 worktree 的、
 * 也⛔ 不锚在 opts.root/plugin/scripts（gap-plugin-root-resolution-remaining-callsites-round2：第三方
 * 项目无 plugin/scripts/）。（gap-fan-in-spawn-stale-worktree-executor-missing-argv：stale worktree 缺
 * 新 argv 如 --mechanical-fan-in ⇒ fresh 进程报 unknown argument ⇒ 无 JSON 输出 ⇒ parse-mechanical-fan-in
 * red）。fan-in 编排器本就是基础设施，应跟 driver 同版；任务 delta（含对 worker-driver.ts 自身的改动）
 * 由 suite step（worktree test.sh）验证，不因执行器用 kernel 版而丢。锁半（acquireFanInLock，ADR-034）
 * 与编排半（ff-merge.ts 模块）仍在 worktree 同源。结果经 stdout 单行 JSON 回传（--mechanical-fan-in
 * 只打一行 result JSON）；spawn 失败/输出不可解析 fail-closed 为 red（硬规则 3b：读不懂 ≠ 合格）。
 */
export async function spawnMechanicalFanIn(opts: MechanicalFanInOptions): Promise<MechanicalFanInResult> {
  const entry = kernelSiblingArgv("worker-driver.ts");
  const argv = [
    process.execPath, ...entry,
    "--mechanical-fan-in",
    "--task", opts.task,
    "--worktree", opts.worktree,
    "--root", opts.root,
    "--run-id", opts.runId,
    "--json",
  ];
  if (opts.mergeTarget) argv.push("--merge-target", opts.mergeTarget);
  const r = await runAsync(argv, { timeoutMs: Infinity, collectStderr: true });
  // MechanicalFanInResult 自 D5/D6/D7 起带 verdict 字段（outcome=red 时非 null）——spawn 失败 / 输出
  // 不可解析的 red 也须构造结构化 verdict（⛔ 缺字段 ⇒ typecheck 红；硬规则 3b 读不懂 ≠ 合格）。
  const red = (step: string, reason: string, exitCode: number | null = null): MechanicalFanInResult => ({
    outcome: "red",
    verdict: { step, verdict: "failed", exitCode, summary: reason, logFile: null },
    step, reason,
    lockHoldSecs: null, lockAcquireEpoch: null, lockReleaseEpoch: null,
    suiteFinishedEpoch: null, suiteOutcome: null, suitePid: null, landedSha: null,
    suiteLog: null,
  });
  if (r.status === null) {
    return red("spawn-mechanical-fan-in", r.error?.message ?? `fresh mechanical fan-in process failed: ${r.stderr || "no output"}`);
  }
  const lastJson = (r.stdout || "").split("\n").map((s) => s.trim()).filter(Boolean).pop();
  if (lastJson) {
    try {
      const parsed = JSON.parse(lastJson);
      if (parsed && typeof parsed === "object" && (parsed.outcome === "landed" || parsed.outcome === "red")) {
        return parsed as MechanicalFanInResult;
      }
    } catch { /* fall through to red */ }
  }
  return red("parse-mechanical-fan-in", `unparseable fresh mechanical fan-in output: ${(r.stderr || r.stdout || "").trim() || `exit ${r.status}`}`, r.status);
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
  /** 派发时刻（epoch ms）——round 载体 in_flight_task_starts 的数据源（gap-live-fan-in-window-
   *  elapsed-zero：Live 页 fan-in 窗口 elapsed 需真起点，driver 派发时已知）。 */
  startedAtMs: number;
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
  /** 快速死亡退避配置（gap-worker-driver-selector-api-error-no-backoff）：quickDeathMs / backoffThreshold /
   *  baseBackoffMs / maxBackoffMs。退避上限（markNeedsHuman 阈值）复用上面的 maxRetries。 */
  backoffCfg: QuickDeathBackoffConfig;
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
  const { rootDir, cap, timeoutMs, workerCmdOpts, selectorArgv, readyPoolArgv, resourceGateArgv, outcomeFile, runId, runPrefix, json, pidFile, livenessCmd, intervalMs, reconcileMs, maxRetries, backoffCfg } = opts;

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
  // 重试上限豁免判定（gap-retry-cap-flip-conflates-own-defect-with-unrelated-flaky）：每轮【新】的三态
  // 判定结果（splice(0) 快照清空，⛔ 不跨轮累积）。生产载体 = round 记录（生产 driver argv 无 --json ⇒
  // json 事件不可观测，同 markNeedsHuman 的 needsHumanResults）。三态在 round 记录里可区分（AC5）。
  const retryExemptions: Array<{ task: string; verdict: RetryExemptionVerdict; reason: string; failingTestFiles: string[]; recurredTasks: string[] }> = [];

  // 快速死亡退避（gap-worker-driver-selector-api-error-no-backoff）：worker <quickDeathMs 快速死亡连续
  // ≥backoffThreshold 次 ⇒ 对该 task 设 backoffUntil（指数退避，⛔ 不立即重派）；退避到上限（maxRetries）
  // ⇒ markNeedsHuman（复用现有重试上限机制，⛔ 不无限退避）。状态按 task 记（⛔ 不全局——一个任务退避
  // 不拖垮别的任务，AC2）。跨轮存活于常驻循环内（⛔ 不落盘，与 retryState 同寿命）。
  const backoffState = newQuickDeathBackoffState();

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
  // gap-live-fan-in-window-elapsed-zero：每任务派发时刻（task id → ISO 起始）。只覆盖内存 running
  // （driver 派发时已知 startedAtMs）；冷启动在飞 task 无起点 ⇒ 不入图（readLive 对缺起点回退 nowMs，
  // 诚实「刚起步」而非伪造长时长）。
  const inFlightTaskStarts = (): Record<string, string> => {
    const map: Record<string, string> = {};
    for (const r of running) map[r.task] = new Date(r.startedAtMs).toISOString();
    return map;
  };

  // round 心跳（AC138-3）：worker-outcome 只在任务真完成时写，池空时 outcome 停更会被 supervisor
  // status 的 last_record_ts（读全载体 max）误读为「死亡」；round 每轮循环无条件写一条作 liveness 直接量。
  const roundFile = path.join(rootDir, WORKER_ROUND_REL);
  const writeRound = (round: number, inFlight: number, pool: number | null, reason: string | null, liveness: LivenessResult | null, reconciled: string[], supersededReclaim: ReclaimSupersededResult | null): void => {
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
      // gap-live-mechanical-fan-in-inflight-invisible：round 带上具体 task id（含机械 fan-in 窗口——
      // worker 已 exit、无 outcome、无 workflow-events，Live 页据此仍可见该任务）。
      inFlightTasks: inFlightTasks(),
      // gap-live-fan-in-window-elapsed-zero：round 同带每任务派发时刻（真起点），readLive 据此算
      // elapsed 而非恒回退 nowMs。
      inFlightTaskStarts: inFlightTaskStarts(),
      needsHuman: needsHumanResults.splice(0),
      // gap-retrystate-needshuman-no-reconcile-with-disk-ready：本轮内存 needsHuman 与磁盘 status
      // 对账清除的 id（人翻回 ready ⇒ 下一轮重新可派），进 round 记录作生产可观测载体。
      reconciledNeedsHuman: reconciled,
      // gap-retry-cap-flip-conflates-own-defect-with-unrelated-flaky：本轮重试豁免三态判定（splice(0)
      // 快照清空，⛔ 不跨轮累积）。三态在 round 记录里可区分（AC5 生产载体）。
      retryExemptions: retryExemptions.splice(0),
      // gap-superseded-task-residual-worktree-never-reclaimed AC7：本轮 superseded worktree 回收结果
      // （候选数 0 也记 0，⛔ 不省略——「跑过且无候选」与「没跑」可区分）。
      supersededReclaim,
    });
    try { appendRoundToFile(roundFile, record); } catch { /* 记录写失败不致命（运行时日志，⛔ 不因日志炸循环） */ }
    if (json) process.stdout.write(`${JSON.stringify({ event: "round", ...record })}\n`);
  };

  /** 错误边界（gap-worker-driver-resident-loop-intermittent-hang）：循环体抛错时写一条 action=error 的
   *  round 记录——与正常 round 同载体（worker-round.jsonl）⇒ supervisor status 的 last_record_ts 不会因
   *  一轮抛错而判「死亡」（AC3：生产 round 无停写窗口），且 error/error_step/stop_reason 指到具体步骤
   *  （AC1 定位）。⛔ 写失败不致命（运行时日志）。 */
  const writeErrorRound = (round: number, step: string, message: string, stack: string, liveness: LivenessResult | null, pool: number | null, inFlight: number): void => {
    const record = computeWorkerRoundRecord({
      round,
      runId: runId ?? runPrefix,
      pid: process.pid,
      at: new Date().toISOString(),
      action: "error",
      inFlight,
      pool,
      stopReason: `error (step=${step}): ${message}`,
      error: message,
      errorStep: step,
      liveness,
      coldStartInflight: [...coldInflight].sort(),
      inFlightTasks: inFlightTasks(),
      inFlightTaskStarts: inFlightTaskStarts(),
      needsHuman: [],
      reconciledNeedsHuman: [],
      retryExemptions: [],
    });
    try { appendRoundToFile(roundFile, record); } catch { /* 记录写失败不致命（运行时日志，⛔ 不因日志炸循环） */ }
    if (json) process.stdout.write(`${JSON.stringify({ event: "round", ...record })}\n`);
    // stack 单独落一条 stderr——stdout 是 JSON 事件通道，⛔ 不把多行 stack 塞进单行 JSON（会破坏解析）。
    if (stack) process.stderr.write(`worker-driver resident-loop error (round=${round} step=${step}): ${message}\n${stack}\n`);
  };

  /** 判停（AC3）：起新 worker 前逐轮读。halt 优先（终态，latch）；其次 resource-gate WAIT（瞬时，
   *  ⛔ 不 latch——gap-worker-driver-stopreason-latch-permanent-stop：WAIT 名字含 WAIT，负载高恰因在飞
   *  worker 在跑、worker 结束负载降但闸再没被读 = 自我锁死反馈环）。瞬时 WAIT 只让本轮不派、
   *  下一轮重读 stopCondition。⛔ AC151：判停经 Layer 0 的 makeStopCondition 消费（halt ∧ resourceGate
   *  单一实现），不各写一遍。 */
  const stopCondition = makeStopCondition(rootDir, "worker", resourceGateArgv);

  /** worker 终态记账（spawnSelected 与 adoptOrphanWorker 共用，⛔ 不各写一遍）：结果入 results + 重试上限
   *  （exited-not-landed 达上限标 needs-human）+ 快速死亡退避。spawnSelected 与 adopt 的 worker 退出后
   *  走同一归宿。 */
  const onWorkerFinished = (rw: RunningWorker, r: WorkerRunResult): WorkerRunResult => {
    rw.done = true;
    results.push(r);
    // 重试上限（gap-worker-driver-retry-cap-not-wired）：worker 结束若 exited-not-landed ⇒ 连续失败
    // 计数 + 达上限标 needs-human（ready→needs-human）。needsHuman 集合进 retryCapNotExhausted 过滤 ⇒
    // 下一轮不再重派（与 markNeedsHuman 的 status 翻转双保险——即使磁盘写失败，内存过滤也挡重派）。
    if (r.outcome.final_state === "exited-not-landed") {
      // ff-not-fast-forward（分支滞后，非代码缺陷）不计重试上限——continue-cycle 识别为 transient
      // 续做态，继续 CONTINUE 重派（merge develop 再 ff 自愈），⛔ 不把 3 次 branch-lag 误判成真缺陷
      // 标 needs-human（那会静置 RECOMMENDED 不派，需人手动救回）。真缺陷（suite red / merge-develop
      // 冲突 / anti-drift 违反 / ff 步的其它失败）仍照常计数达上限标 needs-human。
      let newly: string[] = [];
      if (!isFfNotFastForwardFailure(r.outcome)) {
        // 重试上限豁免（gap-retry-cap-flip-conflates-own-defect-with-unrelated-flaky）：suite red 的失败
        // 测试文件与任务 Touches/diff 无关 ∧ 断言签名跨任务复发（≥2 不同任务）⇒ 不计入该任务自身重试
        // 计数（继续重派，⛔ 不是无条件豁免）。三态判定结果经 writeRound 落 round 记录（AC5 生产载体），
        // json 事件供测试/手动观测。判不出 ⇒ insufficient-data-fallback，照常计数（fail-closed）。
        const exemption = judgeRetryExemption(rootDir, r.taskId, r.outcome);
        retryExemptions.push({ task: r.taskId, verdict: exemption.verdict, reason: exemption.reason, failingTestFiles: exemption.failingTestFiles, recurredTasks: exemption.recurredTasks });
        if (json) process.stdout.write(`${JSON.stringify({ event: "retry-exemption", task: r.taskId, ...exemption })}\n`);
        if (exemption.verdict !== "unrelated-flaky-exempt") {
          newly = advanceRetryCap(retryState, [r.taskId], maxRetries);
        }
      }
      for (const id of newly) {
        // gap-mark-needs-human-commit-after-write：markNeedsHuman 写盘即提交，返回
        // { id, ok, reason, committed }——⛔ 不再丢弃 {ok,reason}；结果经 writeRound 落进 round 记录
        // （生产载体），json 事件供测试/手动观测。
        const nh = markNeedsHuman(rootDir, id, `worker-driver 连续 ${maxRetries} 次 exited-not-landed 未落地（重试上限）`);
        needsHumanResults.push(nh);
        if (json) process.stdout.write(`${JSON.stringify({ event: "needs-human", ...nh })}\n`);
      }
    }
    // 快速死亡退避（gap-worker-driver-selector-api-error-no-backoff）：worker 快速死亡（<quickDeathMs）
    // ⇒ 对该 task 退避（backoffUntil，⛔ 不立即重派）；退避到上限（maxRetries）⇒ markNeedsHuman（复用
    // 现有重试上限机制，⛔ 不无限退避）。needsHuman 集合与 markNeedsHuman 的 status 翻转双保险——
    // 即使磁盘写失败，内存过滤（retryCapNotExhausted/notNeedsHuman）也挡重派。
    const backoff = recordQuickDeathBackoff(
      backoffState, r.taskId, r.outcome.final_state, r.outcome.wall_clock_ms, Date.now(), maxRetries, backoffCfg,
    );
    if (backoff.newlyNeedsHuman) {
      retryState.needsHuman.add(r.taskId);
      markNeedsHuman(rootDir, r.taskId, `worker-driver 连续 ${maxRetries} 次 <${backoffCfg.quickDeathMs}ms 快速死亡（退避上限）`);
    }
    if (backoff.quickDeath && json) {
      process.stdout.write(
        `${JSON.stringify({ event: "worker-backoff", task: r.taskId, consecutive_quick_deaths: backoffState.counts.get(r.taskId), backed_off: backoff.backedOff, needs_human: backoff.newlyNeedsHuman, wall_clock_ms: r.outcome.wall_clock_ms })}\n`,
      );
    }
    return r;
  };

  /** spawn 一个选中的 worker，并把 selector 的真实理由带进 outcome（AC2）。 */
  const spawnSelected = async (sel: { task: string; reason: string }): Promise<void> => {
    const runIdForTask = runId ?? `${runPrefix}-${sel.task}`;
    // 异步版（gap-worker-driver-async-selector-readypool AC1）：worker argv 经 workerArgvForTaskAsync 取——
    // 同步 workerArgvForTask 走 continueStateForTask 的 spawnSync git 会冻住协调地板。
    const workerArgv = await workerArgvForTaskAsync(sel.task, rootDir, workerCmdOpts);
    const rw = {} as RunningWorker;
    rw.task = sel.task;
    rw.done = false;
    // gap-live-fan-in-window-elapsed-zero：派发时刻（driver 决定 spawn 该 task 的此刻）——round 载体
    // in_flight_task_starts 的真起点，readLive 据此算 fan-in 窗口 elapsed（⛔ 恒 nowMs 的旧行为）。
    rw.startedAtMs = Date.now();
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
    }).then((r) => onWorkerFinished(rw, r));
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

  // gap-worker-driver-restart-orphan-no-outcome-no-timeout：reconcile 步处理 dispatch 持久记录里、但不在
  // 内存 running 的条目（旧 driver 死时遗留的在飞 dispatch）。逐条按 pid 存活性 + cmdline 复核分流：
  //   - pid 存活且仍是本任务的 worker ⇒ adopt 纳入 running（轮询 + 沿用原始 timeoutDeadlineMs，⛔ 不
  //     重置——防「每次重启续命」无限占位）；adopt 后从 coldInflight 剔除（⛔ 双计在飞）。
  //   - pid 已死 / 被复用 ⇒ finalizeOrphanDispatch 立刻补终态 + 清 orphan worktree + 清记录。
  //   - 记录缺失（driver 从未见过，如手工起的 worker）⇒ 不越权接管，维持现状（只靠 coldInflight 排除）。
  const reconcileOrphanDispatches = (): void => {
    const store = readDispatchStore(dispatchStoreFile(rootDir));
    for (const { taskId, record } of orphanDispatchCandidates(store, running.map((r) => r.task))) {
      const cls = classifyOrphanDispatch(record);
      if (cls === "finalize") {
        const res = finalizeOrphanDispatch({ root: rootDir, outcomeFile, record });
        coldInflight.delete(taskId);
        if (json) process.stdout.write(`${JSON.stringify({ event: "orphan-finalized", task: taskId, ...res.outcome })}\n`);
      } else {
        const rw = {} as RunningWorker;
        rw.task = taskId;
        rw.done = false;
        rw.startedAtMs = record.startedAtMs; // 原始派发时刻（⛔ 不是 adopt 时刻——fan-in 窗口 elapsed 真起点）
        rw.promise = adoptOrphanWorker({
          taskId, rootDir, outcomeFile, record, inFlightCount: running.length + 1,
        }).then((r) => onWorkerFinished(rw, r));
        running.push(rw);
        coldInflight.delete(taskId);
        if (json) process.stdout.write(`${JSON.stringify({ event: "orphan-adopted", task: taskId, worker_pid: record.workerPid, run_id: record.runId })}\n`);
      }
    }
  };

  let round = 0;
  while (true) {
    round += 1;
    const passStartMs = Date.now();

    // 驻留环错误边界（gap-worker-driver-resident-loop-intermittent-hang）：循环体任何一步抛错（瞬时 fs/
    // git/spawn 异常，负载下偶发）此前会变成未处理 rejection ⇒ 驱动静默死掉——.quay/ 只剩 liveness log、
    // round/outcome 停写，与「一切正常」同形（硬规则 3b/4b）。现每步记 step + try/catch：抛错 ⇒ 写一条
    // action=error 的 round 记录（error_step + stop_reason 指到具体步骤，AC1 定位）+ resident-error 事件，
    // 然后 sleep intervalMs 继续下一轮（瞬时错误自愈，⛔ 不再静默停摆——AC3 生产 round 无停写窗口）。
    // 变量先于 try 声明 ⇒ catch 内可见，error round 可带上已读到的 liveness/pool 读数。
    let liveness: LivenessResult | null = null;
    let reconciled: string[] = [];
    let supersededReclaimResult: ReclaimSupersededResult | null = null;
    let poolSeen: number | null = null;
    let waitReason: string | null = null;
    let step = "start";
    try {
      // 冷启动在飞【现观测】（每趟 pass，SPEC §5.2 actual=observe()）：worker 退出 / worktree 消失任一
      // 发生 ⇒ task 即离开排除集、下一轮重新可派（⛔ 循环外一次性 const 快照 = 假在飞不可派，已修）。
      // 每轮重扫 task worktree + /proc 存活 worker 交叉核对；该结果同时写进本轮 round 记录（生产载体）。
      // 异步版（gap-worker-driver-async-selector-readypool）：git worktree list 不再 spawnSync 阻塞地板。
      step = "cold-start-inflight";
      coldInflight = await enumerateColdStartInflightAsync(rootDir);
      if (json && coldInflight.size > 0) {
        process.stdout.write(
          `${JSON.stringify({ event: "cold-start-inflight", tasks: [...coldInflight].sort() })}\n`,
        );
      }

      // liveness 检查（gap-resident-driver-stable-carrier-liveness Finding 的接线）：每轮顺手调一次
      // launch 脚本的 liveness 子命令。supervisor 死后 driver 成孤儿仍在跑 ⇒ 下一轮即检出 supervisor_dead
      // 并让子命令写 DEATH 告警（⛔ 载体停更 ≠ 一切正常）。checked=false（脚本缺失/失败）≠ 健康（硬规则 3b）。
      step = "liveness";
      liveness = await runLivenessCheckAsync(rootDir, "worker", livenessCmd);

      // 1. reap 已完成的 worker（减在飞集）。
      step = "reap";
      for (let i = running.length - 1; i >= 0; i--) {
        if (running[i].done) running.splice(i, 1);
      }

      // 1b. 对账（gap-retrystate-needshuman-no-reconcile-with-disk-ready）：内存 needsHuman 集合随磁盘
      //   status 翻转对账——人把已标 needs-human 的任务翻回 ready/todo 后，磁盘 status 离开 needs-human
      //   ⇒ 本轮从内存集合清除、下一轮重新可派（⛔ 不重启——重启 = 把恢复外包给 supervisor 才得以恢复，
      //   正是本缺陷的根）。读不懂（status null）⇒ 保留（fail-closed，缺值 = 未查）。每轮（含池空/判停轮）
      //   都对账一次 ⇒ 人翻回后不依赖任何边沿事件即被下一轮拾起。清除结果进本轮 round 记录。
      step = "reconcile";
      reconciled = reconcileNeedsHumanWithDisk(retryState, rootDir);
      // 孤儿 dispatch adopt/finalize（gap-worker-driver-restart-orphan-no-outcome-no-timeout）：driver 重启
      // 遗留的在飞 worker 有据可查、有归宿可判，⛔ 不再「排除集之外一片黑箱、只能等它自己消失」。
      reconcileOrphanDispatches();
      // superseded worktree 回收（gap-superseded-task-residual-worktree-never-reclaimed）：任务生命周期
      // 终止（supersede）后的残留 worktree 单调累积、无路径释放——每轮枚举 task worktree、仅 superseded
      // 且双闸通过者回收（先 reaper 再 `git worktree remove`，分支保留）。结果进本轮 round 记录（AC7）。
      step = "reclaim-superseded";
      supersededReclaimResult = await reclaimSupersededWorktrees(rootDir, {});
      if (json && supersededReclaimResult.candidateCount > 0) {
        process.stdout.write(
          `${JSON.stringify({ event: "superseded-reclaim", candidate_count: supersededReclaimResult.candidateCount, reclaimed: supersededReclaimResult.reclaimed, skipped: supersededReclaimResult.skipped })}\n`,
        );
      }

      // 2. 池非空且未达 cap 且未判停 ⇒ 走选择环起下一个。
      //    ⛔ stopReason 是【终态 latch】（仅 mcp-halt）；瞬时闸拒绝只记本轮 waitReason，下一轮重读
      //    stopCondition（gap-worker-driver-stopreason-latch-permanent-stop：stopReason 一旦赋值永不复位 ⇒
      //    瞬时拒被永久 latch ⇒ 1h48m 零派发）。
      step = "dispatch-loop";
      while (running.length < cap && !stopReason) {
        const sc = stopCondition();
        if (sc.stop) {
          if (sc.terminal) stopReason = sc.reason;
          else waitReason = sc.reason;
          break;
        }
        step = "ready-pool";
        const pool = await readyPoolCheck(rootDir, readyPoolArgv, inFlightTasks(), cap);
        poolSeen = pool.pool;
        const shuffled = shuffle(pool.ready);
        // AC152：派发前过滤消费 driver-filters.ts 的【可组合谓词列表】（notInFlight / depsSatisfied /
        // touchesDisjoint / retryCapNotExhausted / notNeedsHuman，⛔ 不各写一遍）。冷启动在飞 task 一并参与
        // （它们的 Touches 是真实冲突面）。原「active 过滤 + filterTouchesDisjoint + depsReadyForDispatch」
        // 三个散点已收进 applyTaskFilters 一次判完。
        // 重试上限（gap-worker-driver-retry-cap-not-wired）：retryExhausted = 本循环已标 needs-human 的
        // 任务集合（exited-not-landed 达上限派生）——retryCapNotExhausted 谓词据此滤掉不再重派。
        // gap-retrystate-needshuman-no-reconcile-with-disk-ready（AC2）：分两步过滤，把「候选被谓词滤空」
        // 与「真快速死亡退避」区分成两个独立 stop_reason 字面量——⛔ 共用 backoff 字面量会把「3 任务全进
        // needsHuman 集、无一次 <60s 快速死亡」误报成退避（硬规则 3b 同形：成因错归则下游改错）。
        step = "apply-filters";
        const afterTaskFilters = applyTaskFilters(shuffled, makeFilterContext(rootDir, { inFlight: inFlightTasks(), retryExhausted: retryState.needsHuman }));
        const candidates = afterTaskFilters
          // 快速死亡退避（gap-worker-driver-selector-api-error-no-backoff，AC2）：退避中的 task（backoffUntil
          // 未到）本轮不派——⛔ 只滤掉退避的 task，不滤掉别的候选（退避按 task 记，不全局）。now 每候选
          // 取一次现时刻（⛔ 循环外一次 now 快照会把「退避刚到期」的 task 误滤一整轮）。
          .filter((id) => !isBackedOff(backoffState, id, Date.now()));
        if (candidates.length === 0) {
          // 真池空（ready 减在飞后无候选）⇒ 瞬时 WAIT：记 pool-empty，下一轮重读（⛔ 不再 latch）。
          //   池非空但全与在飞 Touches/deps 重叠 ⇒ 同为瞬时 WAIT：不设 stopReason（在飞 worker 结束释放
          //   Touches 或依赖由别的任务落地后重进选择环重新 filter）。两者都不退出——等 intervalMs 重读。
          if (shuffled.length === 0) waitReason = "pool-empty (no dispatchable candidate in the ready pool)";
          else if (afterTaskFilters.length === 0) waitReason = "filtered-empty (all dispatchable candidates filtered by predicates)";
          else waitReason = "backoff (all dispatchable candidates are in quick-death backoff)";
          break;
        }
        step = "selector";
        const sel = await runSelectorWorker(candidates, selectorArgv, rootDir);
        if (!sel) {
          // 候选非空但 selector 未能给出任何选择（理论上 parseSelectorOutput 必回退首个，不会 null）。
          waitReason = "pool-empty (selector returned no candidate)";
          break;
        }
        step = "spawn-worker";
        await spawnSelected(sel);
      }

      // AC138-3 无条件心跳：每轮循环写一条（⛔ 池空/判停轮也写——outcome 在这些轮不写）。
      //   终态 stopReason 与瞬时 waitReason 都记 action=stop（观测面保留 stop_reason 读数，AC2）。
      step = "write-round";
      writeRound(round, running.length, poolSeen, stopReason ?? waitReason, liveness, reconciled, supersededReclaimResult);

      // 3. 无在飞 ⇒ 终态 halt（stopReason latch）才退出；瞬时 WAIT（池可能再补 / 闸可能已放行）⇒
      //    等 intervalMs 重读，⛔ 不退出（gap-worker-driver-stopreason-latch-permanent-stop AC3）。
      if (running.length === 0) {
        if (stopReason) break;
        step = "sleep";
        await sleep(intervalMs);
        continue;
      }

      // 4. 等在飞 worker 结束（至少一个），再回环 reap + 补位。⛔ 从不主动杀在飞。
      //    协调地板（gap-worker-driver-reconcile-interval，SPEC §5.5）：至少每 reconcileMs 协调一次——
      //    边沿事件（worker 退出）全丢也降级「慢但正确」而非「静默停摆」。复用 routine-scheduler.isDue
      //    的 interval 判定（⛔ 不新造定时器/判定）：isDue 的 interval 单位是分钟 ⇒ minutes = reconcileMs/60000。
      step = "wait-in-flight";
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
    } catch (err) {
      // 错误边界：写 error round + resident-error 事件，sleep 后继续（⛔ 不静默死、不 hot-loop 烧 CPU）。
      const message = err && typeof err === "object" && "message" in err ? String((err as Error).message) : String(err);
      const stack = err && typeof err === "object" && "stack" in err ? String((err as Error).stack) : "";
      writeErrorRound(round, step, message, stack, liveness, poolSeen, running.length);
      if (json) {
        process.stdout.write(
          `${JSON.stringify({ event: "resident-error", round, step, error: message })}\n`,
        );
      }
      await sleep(intervalMs);
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
  let quickDeathMsRaw: string | undefined;
  let backoffBaseMsRaw: string | undefined;
  let backoffMaxMsRaw: string | undefined;
  let backoffThresholdRaw: string | undefined;
  let pidFile: string | undefined;
  let outcomePath: string | undefined;
  let runId: string | undefined;
  let json = false;
  let serve = false;
  let host: string | undefined;
  let port: number | undefined;
  let mechanicalFanIn = false;
  let mechWorktree: string | undefined;
  let mechMergeTarget: string | undefined;
  let writeScopedGateCacheFlag = false;
  let scopedGateCacheDevelopSha: string | undefined;

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
    else if (a === "--quick-death-ms") quickDeathMsRaw = args[++i];
    else if (a === "--backoff-base-ms") backoffBaseMsRaw = args[++i];
    else if (a === "--backoff-max-ms") backoffMaxMsRaw = args[++i];
    else if (a === "--backoff-threshold") backoffThresholdRaw = args[++i];
    else if (a === "--pid-file") pidFile = args[++i];
    else if (a === "--outcome") outcomePath = args[++i];
    else if (a === "--run-id") runId = args[++i];
    else if (a === "--json") json = true;
    else if (a === "--serve") serve = true;
    else if (a === "--host") host = args[++i];
    else if (a === "--port") port = Number(args[++i]);
    else if (a === "--mechanical-fan-in") mechanicalFanIn = true;
    else if (a === "--worktree") mechWorktree = args[++i];
    else if (a === "--merge-target") mechMergeTarget = args[++i];
    else if (a === "--write-scoped-gate-cache") writeScopedGateCacheFlag = true;
    else if (a === "--develop-sha") scopedGateCacheDevelopSha = args[++i];
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
          "  [--quick-death-ms <ms>]  快速死亡判据：worker 墙钟 < 此值视为快速死亡（缺省 60000）\n" +
          "  [--backoff-threshold <n>]  连续快速死亡 ≥ 此次数才开始退避（缺省 1）\n" +
          "  [--backoff-base-ms <ms>]  第一次退避等待 ms（指数底数，缺省 30000）\n" +
          "  [--backoff-max-ms <ms>]  退避等待上限 ms（指数增长封顶，缺省 300000）\n" +
          "  --mechanical-fan-in --task <id> --worktree <path>  每任务新进程入口：加载当前代码跑机械 fan-in，stdout 单行 JSON result（exit 0=landed / 2=red）\n" +
          "  --write-scoped-gate-cache --task <id> --develop-sha <sha>  写 scoped-gate 缓存（worker 退出前跑绿后调用；stdout 单行 JSON）\n" +
          "  --serve [--host <ip>] [--port <n>]  起 MCP 控制面（halt / setPreference / forceDispatch，身份 header 或 caller 参数）",
      );
      return 0;
    } else {
      console.error(`worker-driver: unknown argument: ${a}`);
      return 2;
    }
  }

  const rootDir = root ? path.resolve(root) : path.resolve(process.cwd());

  // --mechanical-fan-in：fresh 进程入口（每任务新进程执行，gap-fan-in-token-gate-version-mismatch-
  // self-lock AC1）。守护 spawn 本入口（entry = 主检出 worker-driver.ts，⛔ 非 worktree——stale worktree
  // 缺新 argv ⇒ unknown argument，gap-fan-in-spawn-stale-worktree-executor-missing-argv），跑机械 fan-in、
  // 把 result 以单行 JSON 打回 stdout（spawnMechanicalFanIn 解析），exit 0 = landed / 2 = red。⛔ 不是
  // 派发路径：不 stash、不读 selector、不写 outcome（结果由 spawn 方入账）。
  if (mechanicalFanIn) {
    const task = tasks[0];
    if (!task || !mechWorktree) {
      console.error("worker-driver: --mechanical-fan-in requires --task <id> and --worktree <path>");
      return 2;
    }
    const result = await runMechanicalFanIn({
      task,
      worktree: mechWorktree,
      root: rootDir,
      runId: runId ?? `fm-${task}-${Date.now()}`,
      mergeTarget: mechMergeTarget,
    });
    process.stdout.write(`${JSON.stringify(result)}\n`);
    return result.outcome === "landed" ? 0 : 2;
  }

  // --write-scoped-gate-cache：worker 退出前跑绿 scoped 门后，机械写 (task, developSha, pass) 到
  // <root>/.quay/scoped-gate-cache.json（gap-worker-premerge-scoped-gate-cache 阶段 a 的机械写侧——
  // ⛔ 不靠 agent 手写 JSON）。stdout 单行 JSON，exit 0 = 已写 / 2 = 缺参（fail-closed）。
  if (writeScopedGateCacheFlag) {
    const task = tasks[0];
    if (!task || !scopedGateCacheDevelopSha) {
      console.error("worker-driver: --write-scoped-gate-cache requires --task <id> and --develop-sha <sha>");
      return 2;
    }
    const cacheFile = path.join(rootDir, ".quay", "scoped-gate-cache.json");
    writeScopedGateCache(cacheFile, scopedGateKey(task, scopedGateCacheDevelopSha));
    process.stdout.write(`${JSON.stringify({ event: "scoped-gate-cache-written", task, developSha: scopedGateCacheDevelopSha, cacheFile })}\n`);
    return 0;
  }

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
  // 快速死亡退避配置（gap-worker-driver-selector-api-error-no-backoff）：四个机制旋钮经 --quick-death-ms /
  // --backoff-base-ms / --backoff-max-ms / --backoff-threshold 覆盖；退避上限复用 maxRetries。
  const backoffCfg: QuickDeathBackoffConfig = {
    quickDeathMs: parseQuickDeathMs(quickDeathMsRaw),
    backoffThreshold: parseBackoffThreshold(backoffThresholdRaw),
    baseBackoffMs: parseBackoffBaseMs(backoffBaseMsRaw),
    maxBackoffMs: parseBackoffMaxMs(backoffMaxMsRaw),
  };

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
      backoffCfg,
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
