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
// Run（MCP 控制面）—— ⛔ 本文件没有控制面入口：控制面由每个 kind 的 supervisor 起（Layer 0，
// `driver-runtime.ts` 的 runSupervisor → serveKindControlPlane）。逐 kind 的 URL/端口回读面 =
// `<root>/.quay/<prefix>-control-plane.json`（`statePaths().controlPlaneFile`）。见 GOAL-017/AC-252。
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
import { randomUUID, createHash } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { isDirectEntry, normalizeRel } from "./gate-script-base.ts";
import { readProcCmdlineText } from "../../packages/quay/src/kernel/proc-identity.ts";
import { TASK_STATUS } from "./task-status.ts";
import { extractSection, countAcCheckboxes, fetchTaskStatusAtRef } from "./task-schema.ts";
// gap-task-ops-consolidate-driver-frontmatter-writers：flipTaskDone 的 status 读/写经 task-ops.ts
// （splitTaskFile / statusFromFrontmatter / patchStatusField，单一 parser，⛔ 不再手搓 status 行正则）。
import { splitTaskFile, statusFromFrontmatter, patchStatusField } from "./task-ops.ts";
import { repoRoot } from "./repo-root.ts";
// 转义正则元字符（task id 进 `new RegExp` 前）—— the single regex-literal escaper, the kernel leaf
// reached via the plugin shim. Own copy was one of the twelve byte-identical bodies extracted by
// gap-routine-semantic-dedup-scan-escapere-escaperegex-escaperegexp-fndefre-stemre.
import { escapeRegExp } from "./regex-escape.ts";
import { parseTouchEntriesWithTags } from "./touches-parser.ts";
import { parseLoadSensitiveAnnotation } from "./known-load-sensitive.ts";
// AC150-3：资源门判定 + 控制态 + 身份闸 + MCP 控制面，抽到 driver-shared.ts 供 promotion-driver 复用
// （函数级复用，⛔ 非复制粘贴）。本文件仍 re-export 保持旧 import 面（worker-driver.test.mjs 等）。
import {
  resourceGateCheck,
  isHalted,
  // environment-fatal 停机（gap-worker-quick-death-environment-fatal-halts-driver）：写控制态 halted。
  // 经 driver-shared 的 re-export（单一真相源 = kernel control-state.ts），⛔ 不在此手搓 JSON 写盘。
  readControlState,
  writeControlState,
  applyHalt,
  CONTROL_STATE_REL,
  type ControlState,
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
// 名字→真实任务 id 的绑定（gap-worktree-task-id-mismatch-defeats-leftover-worktree-exemption）：本文件
// 多处把 worktree/分支名【当作任务 id】去查状态或路径。名字掉了后缀（实测 2026-09-15）时逐字相等判据
// 全数落空 ⇒ 用截断名查真实任务库 ⇒ 判 `unreadable`（"读不懂"的伪装）或找不到路径。resolveTaskName /
// resolveWorktreeTaskId 是那条绑定的单一实现，⛔ 不在此另写前缀匹配。
import {
  listTaskIds,
  listWorktrees,
  parseWorktreePorcelain,
  resolveTaskName,
  resolveWorktreeTaskId,
  taskIdFromBranch,
  worktreeMatchesTask,
} from "./fast-mode-telemetry.ts";
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
  kindStopRequested,
  makeStopCondition,
  registerKindStop,
  resolveKernelSibling,
  resolveKernelScriptsDir,
  resolveKernelPluginRoot,
  resolveKernelShellSibling,
  resolveQuaySrcModule,
  type LivenessResult,
} from "./driver-runtime.ts";
// gap-reconcile-finalizes-live-worker-as-exited-and-double-dispatches-same-task：worker 进程名是
// 【配置】而非常量（`.quay/profiles.yml` roles["task-worker"].name）⇒ 存活探测必须先解析它，
// ⛔ 不沿用写死的 `quay-task-worker`（第三方项目改名后探测恒不命中，见 resolveWorkerProcessName）。
import { loadProfiles, resolveRole } from "./profile-policy.ts";
// 机械 fan-in（gap-fan-in-driver-mechanical-orchestration / SPEC-fan-in-driver-mechanical-
// orchestration-2026-08-27）：suite 不再 detach（setsid+&+disown 孤儿）——改由 driver 直接 spawn 并 wait
// （进程级父子，ppid 指向 driver，AC3）。复用 suite-driver.ts 的 spawnSuiteAndWait（同一单飞槽语义 +
// 静默看门狗，⛔ 不新写一份 suite 生命周期）。suiteLockBase 读 TS 侧单一真相源槽路径。
import { spawnSuiteAndWait, type SuiteOutcome, type SuiteRunResult } from "./suite-driver.ts";
import { suiteLockBase } from "./suite-lock-slots.ts";
// gap-ac271-finish-step-needs-self-acting-carrier：release 收尾步的【自作用】载体。AC-271 的两种合规
// 形态里，SPEC §12.2 把版本 tag 钉在合回 develop 的合并点上 ⇒ `tag --points-at <branch>` 恒空 ⇒ 形态 (b)
// 对按规程切的版结构上不可达 ⇒ **删除是唯一可达的合规形态**，整条长期保证全压在收尾这一步上。而这一步
// 此前只靠人记得（实测 3 次：v0.10.0 / ac4-reading / v0.11.0 的残留与零痕迹消失）。与本步同族——
// janitor 走 AC-271【同一份枚举】，红且被 tag 持有者【经 release-branch-finish.sh】结束（⛔ 不自己
// `git branch -D`），无许可者【留在原地】（判据必须继续抓到的形态）；结果进本轮 round 记录（生产载体）。
import { runReleaseBranchJanitor, type JanitorResult } from "./release-branch-janitor.ts";
// D7：机械 fan-in 的 bucket suite 绿后，把本轮 suite 状态镜像到权威载体 full-suite-state.json
// （复用 mirror-full-suite-state.ts 的 build/write/skip 单一实现，⛔ 不另写一份 state shape）。
import { buildMirrorState, writeMirrorState, shouldSkipMirrorWrite, readCurrentState } from "./mirror-full-suite-state.ts";
// D7：laneCount 取 full-suite-runner.ts 的 defaultLaneCount（nproc-derived 单一真相源，读宿主 + QUAY_MAX_*
// 定义点，⛔ 不写字面量 1——concurrency-literal-check P4 会把 `laneCount: 1` 判为未声明并发字面量违规）；
// readLoadAvg 同源（/proc/loadavg 1min，verification-round 的 load 轴——与 full-suite-runner 同一读法）。
import { defaultLaneCount, readLoadAvg } from "./full-suite-runner.ts";
// gap-fan-in-suite-refusal-reports-as-suite-red AC1/AC2：suite log 里「本轮没跑（拒绝）」的标记前缀。
// ⛔ 前缀的唯一真相源在 full-suite-runner.ts（writer 侧）——本层是 reader，import 同一常量而不是自己
// 写一份字面量（两份前缀 = 漂移，硬规则 5b：改了 writer 忘了 reader 时判据静默恒假）。
import { SUITE_LOG_NOT_RUN_PREFIX, SUITE_LOG_RUN_START_PREFIX } from "./full-suite-runner.ts";
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
// gap-fan-in-instrument-availability-self-check：仪器可用性读数（分类器 / reaper 是否可解析）的类型。
// ⛔ `import type`（编译期擦除）——运行期符号仍经 loadFfMergeModule 的动态 import 取（见其注释）；若改成
// 值 import，Core 源码树字面量就会以【静态边】进入本 kernel 的 bundle，而它必须仍由 coreSrcAliasPlugin
// 按同一处 specifier 内联。
import type { InstrumentProbe } from "../../packages/quay/src/fan-in/ff-merge.ts";
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
// 环境级签名（单一真相源 = driver-runtime.ts，见该处「为什么这份表住在 Layer 0」）：① `quay driver
// start` 的启动冒烟与 ② 本文件的快速死亡分类器**必须共用同一份清单**（两份 = 漂移：签名加在一处、
// 另一处静默漏判）。方向只能这一个——worker-driver 已从 driver-runtime import，反向会造出新的
// value SCC（import-graph-check 是 shrink-only 棘轮，基线 valueSccs=0 ⇒ 直接红）。
import { matchEnvironmentFatalSignature } from "./driver-runtime.ts";
export { ENVIRONMENT_FATAL_SIGNATURES, type EnvFatalSignature } from "./driver-runtime.ts";
import { computeDocCheckFaceKey, readDocCheckCache, writeDocCheckCache } from "./doc-check-cache.ts";
import { runPushLagCheck, resolvePushLagThresholdMs, type PushLagOutcome } from "./fan-in-push-lag-check.ts";
import { parse as parseYaml } from "yaml";
// gap-arch-worker-fan-in-extract-from-worker-driver：机械 fan-in 区域（含其独占的工具面：scoped 门 /
// doc-check 命令解析、kernel sibling argv 前缀、scoped-gate 缓存写入签名、ff-merge 模块加载与仪器摘要）
// 已抽到 worker-fan-in.ts。该模块 ⛔ 不反指本文件 ⇒ 无值环（AC4）；下面两条语句是【同一处】的两半：
//   · import —— 本文件仍需【直接调用】的少数符号（⛔ `export { … } from` 不建立本地绑定，不能替代）；
//   · re-export —— 保持既有 test 文件对 worker-driver.ts 的 import 面逐字不变（AC2），零测试迁移成本。
//
// 机械 fan-in 步链【不含】archguard 结构闸步（gap-fan-in-remove-archguard-gate：零发火、零指引、
// 27s/次串行关键路径），已降级为【按需命令】——⛔ 不是静默消失，需要结构信号时手动跑：
//   node --experimental-strip-types plugin/scripts/archguard-runner.ts --root <repo-root>
// 步链本体（连同该说明的完整正文）现随机械 fan-in 一并住在 worker-fan-in.ts；此处留指路牌，使读本文件
// （机械 fan-in 的驱动侧入口）的人在同一处看得到这件事。
import {
  runMechanicalFanIn,
  spawnMechanicalFanIn,
  appendCompleteGateEvent,
  scopedGateKey,
  writeScopedGateCache,
  scopedGateCacheWriteSignature,
  resolveScopedGateCommand,
  type MechanicalFanInResult,
} from "./worker-fan-in.ts";
export {
  resolveScopedGateCommand,
  scopedGateCommandFor,
  resolveDocCheckCommand,
  docCheckCommandFor,
  readLoopFanInContract,
  readLoopTestOutput,
  type CapabilityDecl,
  type LoopFanInContract,
  type ScopedGateResolution,
  type MechanicalFanInOptions,
  type MechanicalFanInStepVerdict,
  type MechanicalFanInResult,
  mechSh,
  appendFanInStepTrace,
  combinedOutput,
  extractSuiteNotRunLine,
  extractFailureSummary,
  extractFirstFailureLine,
  readFanInLockHold,
  fanInLockFile,
  type FanInLockHandle,
  acquireFanInLock,
  readPreviousGreenSuiteCommit,
  resolveKernelSrcModule,
  appendCompleteGateEvent,
  newMechanicalSuiteRunId,
  defaultMechanicalSuiteCommand,
  suiteRunsOutsideRunner,
  appendDelegatedSuiteRound,
  fanInLogFileName,
  suiteLogFileName,
  newSuiteLogAttemptSuffix,
  pruneTaskSuiteLogs,
  appendFanInTrace,
  scopedGateKey,
  type ScopedGateCacheEntry,
  readScopedGateCache,
  writeScopedGateCache,
  runMechanicalFanIn,
  spawnMechanicalFanIn,
  mirrorMechanicalFanInSuiteState,
} from "./worker-fan-in.ts";

// ── 常量 ───────────────────────────────────────────────────────────────────────────────────────────

/** round 记录（无条件心跳）的仓库相对路径（gitignored 运行时日志，worker-outcome.jsonl 同族）。 */
export const WORKER_ROUND_REL = ".quay/worker-round.jsonl";

/** dispatch 持久记录（gap-worker-driver-restart-orphan-no-outcome-no-timeout）的仓库相对路径——
 *  gitignored 运行时状态（worker-outcome.jsonl / worker-round.jsonl 同族），按 taskId 索引的单文件 map。 */
export const WORKER_DISPATCH_REL = ".quay/worker-dispatch.json";

/** 终态枚举：**completed（退出码 0 且落地——成功态就是它）** / exited-not-landed（退出码 0 但没落地）/
 *  failed（非零退出）/ killed（被信号杀）/ timed-out（超时 SIGTERM）/ spawn-failed（起不来）/
 *  not-dispatched（halt 未派）。
 *
 *  🔴 词表陷阱（gap-worker-outcome-final-state-landed-is-a-dead-value）：同一条 outcome 记录里的
 *  `mechanical_fan_in.outcome` 用的是**另一个**词表（`"landed" | "red"`）。两者描述同一个事件
 *  （机械 fan-in 是否落地）却**不同名** ⇒ `landed` 极易被写进 `final_state`。实测生产载体
 *  `.quay/worker-outcome.jsonl` 里有 **1** 条这样的记录（2026-08-28，一次手工 fan-in 的手写落盘，
 *  非本文件任何代码路径所写）。**后果**：任何按 `final_state == "landed"` 统计吞吐的消费者读到 **0**，
 *  与「系统完全停摆」同形、且不可区分（硬规则 3b/4b）——本任务的定量复核作者本人就在这里栽过一跤
 *  （见 `docs/analysis/suite-got-5x-faster-and-throughput-did-not-follow.md` §6）。
 *  ⇒ `landed` ⛔ 不是本词表的取值；**成功态是 `completed`**。
 *  **enforce**：`assertFinalState` 在唯一落盘闸 `appendOutcomeToFile` 上拒收词表外的取值
 *  （硬规则 9：给规则造产物，不靠提醒；硬规则 3b：写不对 ⇒ 不得与「合格」同形）。 */
export const FINAL_STATES = ["completed", "exited-not-landed", "failed", "killed", "timed-out", "spawn-failed", "not-dispatched"] as const;

/** `v` 是否为 `final_state` 词表内取值（`FINAL_STATES.includes` 的类型谓词版——供落盘闸与读者共用，
 *  ⛔ 不各写一份词表副本）。 */
export function isFinalState(v: unknown): v is (typeof FINAL_STATES)[number] {
  return typeof v === "string" && (FINAL_STATES as readonly string[]).includes(v);
}

/** 落盘闸把关：`final_state ∉ FINAL_STATES` ⇒ **抛**（⛔ 不静默写入、⛔ 不归一化伪造成合法值——
 *  归一化会把「写错了」变成「写对了」，正是硬规则 3b 禁止的「读不懂 ⇒ 与合格同形」）。
 *
 *  **它为什么不是恒真闸**：本文件四个 outcome 构造器（computeOutcome / computeAdoptedOutcome /
 *  computeOrphanFinalizedOutcome / computeHaltedOutcome）都只产出词表内取值 ⇒ 生产路径上本断言
 *  不可达，**恰恰因此它才是测量**（硬规则 4）——它拦的是「未来某个调用方 / 重构 / 手工脚本写进一个
 *  词表外的取值」。没有它，2026-08-28 那条 `final_state:"landed"` 就是**静默**落盘的；
 *  负控制见 `plugin/test/worker-driver.test.mjs`（传 `"landed"` 必须抛，传词表内取值必须不抛）。 */
export function assertFinalState(value: unknown, ctx: string): void {
  if (isFinalState(value)) return;
  const trap =
    value === "landed" || value === "red"
      ? ` — ${JSON.stringify(value)} 是 mechanical_fan_in.outcome 的取值，⛔ 不是 final_state；成功态写 "completed"`
      : "";
  throw new Error(
    `worker-driver: refusing to write an out-of-vocabulary final_state ${JSON.stringify(value)} (${ctx})${trap}. ` +
      `Known final_state values: ${FINAL_STATES.join(" | ")}`,
  );
}

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
/** ⚠️ 这是【缺省值】，不是「本 workspace 的 worker 名」。真实名由 `.quay/profiles.yml` 的
 *  `roles["task-worker"].name` 承载 ⇒ 一律经 resolveWorkerProcessName(root) 取（见下）。
 *  字面常量只作解析失败时的历史缺省（quay 自己的 profiles.yml 恰好就是这个名字）。 */
export const WORKER_PROCESS_NAME = "quay-task-worker";

/** 本 workspace 的 worker 进程名（`-n <name>`）：读 `.quay/profiles.yml` 的 roles["task-worker"].name。
 *
 *  🔴 为什么必须解析而不能用上面的字面常量（gap-reconcile-finalizes-live-worker-as-exited-and-double-
 *  dispatches-same-task，2026-09-13 第一手对照）：字面量 `quay-task-worker` 是【quay 自己】的命名；
 *  第三方项目按 quay-init 的注释自行改名（quay-fleet: `fleet-task-worker`）。此前所有存活探测
 *  （enumerateLiveWorkerCmdlines / hasLiveWorkerForTask / findLiveWorkerPid）都写死该字面量 ⇒
 *  在 quay-fleet 上**恒不命中任何真实 worker**（硬规则 4b：一个依赖宿主的字面量，换项目就静默失效）。
 *  后果是 reconcile 把【在飞】worker 判为「已退出」（假失败记录）并清掉冷启动排除集 ⇒ 同任务双派、
 *  两个 worker 共用一个 worktree。对照：同一份 argv 只改角色名，hasLiveWorkerForTask 给出相反取值。
 *
 *  解析失败（无 profiles.yml / 无该角色 / yaml 读不懂）⇒ 回落到 WORKER_PROCESS_NAME（历史行为），
 *  ⛔ 不抛——探测是观测，观测不得让驱动停摆；且回落方向的残余危害由 finalizeOrphanDispatch 的
 *  /proc 存活实测兜底（见该函数）。 */
export function resolveWorkerProcessName(root: string | null | undefined): string {
  if (!root) return WORKER_PROCESS_NAME;
  try {
    const name = resolveRole(loadProfiles(root), "task-worker").name;
    return name && name.length > 0 ? name : WORKER_PROCESS_NAME;
  } catch {
    return WORKER_PROCESS_NAME;
  }
}

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
 *   ＋ 快速死亡时追加 `quick_death_cause`（"environment-fatal" | "transient-external" | "ordinary" |
 *   "unclassifiable"；非快速死亡 ⇒ 缺键。见下方发射点注释）
 *   ＋ 捕获到 worker stderr 尾部时追加 `worker_stderr_tail`（未捕获 ⇒ 缺键）。
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
  stderrTail = null,
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
  /** worker stderr 的【末尾】捕获（runOneWorker 边转发边留的尾部窗口）。null = 未捕获（未 spawn /
   *  孤儿 finalize 等无子进程路径）。它同时是成因分类的第二个判定面（`classifyQuickDeathEvidence`）
   *  与生产载体字段 `worker_stderr_tail` 的来源——本条缺陷的一个成因就是「worker stderr 以
   *  stdio:"inherit" 流走，判定面与载体都看不到它」。 */
  stderrTail?: string | null;
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
    // 快速死亡成因（gap-worker-driver-counts-transient-rate-limit-as-fast-death-and-parks-task-needs-human
    // AC5）：踩生产载体 .quay/worker-outcome.jsonl 的字段——含 "session limit" 的记录取值为
    // "transient-external"。⛔ 只在【本记录是快速死亡】时发射（缺键 = 不适用，硬规则 6：缺值 ≠ 某个取值；
    // hard rule 3b：completed/exited-not-landed 不得落成某个成因取值）。⛔ 此处按机制缺省 quickDeathMs
    // 判定；driver 的 --quick-death-ms 覆盖只影响退避决策，不回溯改写已落盘记录——记录同带 final_state
    // + wall_clock_ms，自定义阈值下的读者可自行复算（差异在此注明，⛔ 不静默）。
    ...(isQuickDeath(finalState, endedAtMs - startedAtMs)
      ? { quick_death_cause: classifyQuickDeathCause(selectorReason, stderrTail) }
      : {}),
    // worker stderr 尾部（gap-worker-quick-death-environment-fatal-halts-driver）：只有【捕获到了】
    // 才发射（null ⇒ 缺键，硬规则 6：缺值 ≠ 空字符串）。这是生产实例里「载体中 model_not_found 出现
    // 0 次」的直接修法——分类判据与事后取证读的是同一个面，⛔ 不再需要谁去翻 driver 的日志流。
    ...(typeof stderrTail === "string" && stderrTail.length > 0 ? { worker_stderr_tail: stderrTail } : {}),
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

/** 是否存在本任务残留 worktree（形状感知——路径 basename ∨ 分支去掉可选 `task/` 前缀 == taskId，
 *  gap-task-branch-prefix-assumption-scattered-read-sites-orphan-enumeration-blind）。判定收敛到
 *  fast-mode-telemetry 的 worktreeMatchesTask，⛔ 不各自手写 `refs/heads/task/<id>` 正则。
 *  fan-in 成功后 `git worktree remove` + `git branch -d task/<id>` 把该分支删掉 ⇒ 无该 worktree = 无残留。
 *  读失败（非 git 仓库 / git 错误）⇒ null（硬规则 3b：读不懂 ≠ 无残留）。
 *
 *  名字掉了后缀的 worktree 由逐字相等判据看不见（gap-worktree-task-id-mismatch-defeats-leftover-
 *  worktree-exemption）⇒ 在逐字相等之外并上 resolveWorktreeTaskId 的后缀截断臂，对真实任务 id 集接地
 *  （listTaskIds fail-soft ⇒ 空集 ⇒ 该臂贡献为零，逐字相等臂仍照判）。 */
export function worktreePresentForTask(root: string, taskId: string): boolean | null {
  const r = spawnSync("git", ["-C", root, "worktree", "list", "--porcelain"], { encoding: "utf8" });
  if (r.status !== 0 || r.error) return null;
  const taskIdSet = new Set(listTaskIds(root));
  return parseWorktreePorcelain(String(r.stdout ?? "")).some(
    (wt) => worktreeMatchesTask(wt, taskId) || resolveWorktreeTaskId(wt, taskIdSet).taskId === taskId,
  );
}

/** 本任务残留 worktree 的路径列表（形状感知，判定同 worktreePresentForTask，含后缀截断臂）。读失败
 *  （非 git 仓库 / git 错误）⇒ []（硬规则 3b：读不懂 ≠ 确认无残留，用 worktreePresentForTask 区分
 *  「读不懂」（null）与「确认无残留」（false））。 */
export function worktreePathsForTask(root: string, taskId: string): string[] {
  const r = spawnSync("git", ["-C", root, "worktree", "list", "--porcelain"], { encoding: "utf8" });
  if (r.status !== 0 || r.error) return [];
  const taskIdSet = new Set(listTaskIds(root));
  const paths: string[] = [];
  for (const wt of parseWorktreePorcelain(String(r.stdout ?? ""))) {
    if (wt.path && (worktreeMatchesTask(wt, taskId) || resolveWorktreeTaskId(wt, taskIdSet).taskId === taskId)) {
      paths.push(wt.path);
    }
  }
  return paths;
}

/** worktreePresentForTask 的异步版（常驻循环体用——⛔ spawnSync git 会冻住协调地板）。语义一致：
 *  读失败（git 失败）⇒ null（读不懂 ≠ 无残留），⛔ 不是 false。 */
export async function worktreePresentForTaskAsync(root: string, taskId: string): Promise<boolean | null> {
  const r = await runAsync(["git", "-C", root, "worktree", "list", "--porcelain"], { timeoutMs: 5_000 });
  if (r.error || r.status !== 0) return null;
  const taskIdSet = new Set(listTaskIds(root));
  return parseWorktreePorcelain(r.stdout).some(
    (wt) => worktreeMatchesTask(wt, taskId) || resolveWorktreeTaskId(wt, taskIdSet).taskId === taskId,
  );
}

/** worktreePathsForTask 的异步版（常驻循环体用）。读失败 ⇒ []（与同步版一致）。 */
export async function worktreePathsForTaskAsync(root: string, taskId: string): Promise<string[]> {
  const r = await runAsync(["git", "-C", root, "worktree", "list", "--porcelain"], { timeoutMs: 5_000 });
  if (r.error || r.status !== 0) return [];
  const taskIdSet = new Set(listTaskIds(root));
  const paths: string[] = [];
  for (const wt of parseWorktreePorcelain(r.stdout)) {
    if (wt.path && (worktreeMatchesTask(wt, taskId) || resolveWorktreeTaskId(wt, taskIdSet).taskId === taskId)) {
      paths.push(wt.path);
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

/** 一个 task worktree 的「呈现名 → 真实任务 id」绑定（gap-worktree-task-id-mismatch-defeats-leftover-
 *  worktree-exemption）。`match` 是 resolveTaskName 的四值判定：exact / prefix（名字掉了后缀，唯一前缀
 *  指向一个真实任务 id）/ unmatched（接地过、绑不上）/ ungrounded（无任务库可接地——⛔ 与 unmatched 不同形）。 */
export interface TaskWorktreeRef {
  /** 分支呈现的名字（`task/<name>` 去掉前缀）——枚举口径与旧 enumerateTaskWorktreeTasks 一致。 */
  name: string;
  path: string | null;
  branch: string | null;
  /** 绑上的真实任务 id；unmatched / ungrounded ⇒ null（⛔ 不拿名字冒充 id）。 */
  taskId: string | null;
  match: "exact" | "prefix" | "unmatched" | "ungrounded";
}

/** 枚举所有开着的 task worktree 的名字→id 绑定（`task/<name>` 分支口径，同旧 enumerateTaskWorktreeTasks）。
 *  git 失败 / 非 git 仓库 ⇒ []。名字接地于真实任务库（listTaskIds，fail-soft ⇒ ungrounded）。 */
export function enumerateTaskWorktreeRefs(root: string): TaskWorktreeRef[] {
  const taskIdSet = new Set(listTaskIds(root));
  const refs: TaskWorktreeRef[] = [];
  for (const wt of listWorktrees(root)) {
    const name = taskIdFromBranch(wt?.branch);
    if (name == null) continue;
    const { taskId, match } = resolveTaskName(name, taskIdSet);
    refs.push({ name, path: wt.path ?? null, branch: wt.branch ?? null, taskId, match });
  }
  return refs;
}

/** 枚举所有开着的 task worktree 的 task id（`task/<id>` 分支）。git 失败 / 非 git 仓库 ⇒ []。
 *  名字绑不上真实任务时回落到名字本身（⛔ 不丢条目——丢条目会把「有个名字对不上的 worktree」变成
 *  「没有这个 worktree」，正是本任务要消除的静默）。绑得上时给出【真实】id：名字掉后缀的 worktree
 *  因此能对上存活 worker 的 cmdline（gap-worker-driver-cold-start-inflight-blind 的方向是「多排除 ⇒
 *  少重派」，偏安全）。诊断口径见 enumerateTaskWorktreeRefs（不丢名字，`match` 可区分）。 */
export function enumerateTaskWorktreeTasks(root: string): string[] {
  return enumerateTaskWorktreeRefs(root).map((r) => r.taskId ?? r.name);
}

/** 扫描 /proc/<pid>/cmdline，返回所有含 `quay-task-worker` 的存活进程 cmdline（空格 join，读失败跳过）。
 *  procDir 是测试缝（缺省 /proc）。读不到 /proc（非 Linux / 权限）⇒ []（硬规则 3b：读不懂 ≠ 无存活，
 *  由调用方 fail-closed——enumerateColdStartInflight 交集为空即不排除，方向是「少排除 ⇒ 可能重派」，
 *  比「误判全部存活」安全）。 */
export function enumerateLiveWorkerCmdlines(procDir: string = "/proc", workerName: string = WORKER_PROCESS_NAME): string[] {
  let entries: string[];
  try {
    entries = fs.readdirSync(procDir);
  } catch {
    return [];
  }
  const out: string[] = [];
  for (const e of entries) {
    if (!/^\d+$/.test(e)) continue;
    // 读 /proc/<pid>/cmdline 由 kernel leaf 单点实现（本文件原有第二份手搓副本 —
    // gap-judgment-rewrites-route-through-proc-identity-leaf）；procDir 原样透传作 leaf 的 procRoot。
    // ⛔ 读不成 ⇒ null ⇒ 跳过（与迁移前 catch 同路），不折成空串。
    const text = readProcCmdlineText(e, procDir);
    if (text === null) continue; // 进程已退 / 无权限 ⇒ 跳过
    const cmdline = text.trim();
    if (cmdline.includes(workerName)) out.push(cmdline);
  }
  return out;
}

/** 该 task 是否有存活 worker 正在跑：某存活进程 cmdline 同时含 `quay-task-worker`（-n 名）与该 task id
 *  （worker prompt 里的 "Task: <id>"）。纯谓词，cmdline 列表注入（缺省由调用方从 /proc 取）。
 *  task id 用【词边界】匹配，⛔ 不用裸 substring——短 id（如 `gap-t`）会作为前缀命中 `gap-test-…` /
 *  `gap-todo-…` 的存活 worker cmdline（2026-08-24 实测：测试 task `gap-t` 误命中生产 worker
 *  `gap-test-fixture-pollutes-bash-history` ⇒ cleanupOrphanWorktree 假跳过）。边界字符类 = 字母/数字/
 *  下划线/连字符（task id 全由它们组成 ⇒ `gap-t` 后跟 `e` 或 `-` 都不算命中，后跟 `.`/空格/行尾才算）。 */
export function hasLiveWorkerForTask(taskId: string, workerCmdlines: string[], workerName: string = WORKER_PROCESS_NAME): boolean {
  const re = new RegExp(`(^|[^a-zA-Z0-9_-])${escapeRegExp(taskId)}(?![a-zA-Z0-9_-])`);
  return workerCmdlines.some((cmd) => cmd.includes(workerName) && re.test(cmd));
}

/** 解出该 task 存活 worker 的 pid：重扫 /proc，返回第一个其 cmdline（空格 join）命中
 *  hasLiveWorkerForTask 的 pid；无命中 ⇒ null（读不到 /proc 也 null——硬规则 3b：读不懂 ≠ 无存活，
 *  由调用方决定是否信号）。procDir 是测试缝（与 enumerateLiveWorkerCmdlines 同款）。 */
function findLiveWorkerPid(taskId: string, procDir: string = "/proc", workerName: string = WORKER_PROCESS_NAME): number | null {
  let entries: string[];
  try {
    entries = fs.readdirSync(procDir);
  } catch {
    return null;
  }
  for (const e of entries) {
    if (!/^\d+$/.test(e)) continue;
    const text = readProcCmdlineText(e, procDir);
    if (text === null) continue; // 进程已退 / 无权限 ⇒ 跳过
    const cmdline = text.trim();
    if (hasLiveWorkerForTask(taskId, [cmdline], workerName)) return Number(e);
  }
  return null;
}

/** 某 pid 的存活【三值】读数（硬规则 3：三个取值互不同形，⛔ 缺「未评估」态就会把「没查成」读成“已退出”）。
 *   - "alive"   : procDir 可读 ∧ pid 条目在 ∧ 其 cmdline 可读且非空（真活进程）。
 *   - "exited"  : procDir 可读且**看得到进程表**（≥1 个 pid 条目）∧ pid 不在其中 ⇒ 测到的「不存在」；
 *                 或 pid 条目在但 cmdline 为空（僵尸/已退未收尸：读到了，它就是空的 ⇒ 也是测量）。
 *   - "unknown" : 读不到 procDir（非 Linux / 权限）∧ 或读到的是**没有任何 pid 条目的目录**
 *                 ⇒ 拿不到进程表 ⇒ 没查成，⛔ 不与 "exited" 同形（硬规则 3b）。
 *
 *  ⚠️ 判据选择：`≥1 个 pid 条目`而非「存在某个 procfs 特征文件」——本机 /proc 的 pid 条目数恒 ≥1
 *  （至少 pid 1），无需假设文件名；同时使「注入一个空目录」可被明确读成“没查成”而不是“进程都没了”。
 *  本函数只测【这个 pid 是否存在】，不测【它是不是本任务的 worker】（后者是 classifyOrphanDispatch
 *  的 hasLiveWorkerForTask 复核——两件事分开，⛔ 不合并成一个布尔）。 */
export type PidLiveness = "alive" | "exited" | "unknown";

export function probePidLiveness(pid: number, procDir: string = "/proc"): PidLiveness {
  let entries: string[];
  try {
    entries = fs.readdirSync(procDir);
  } catch {
    return "unknown";
  }
  const pids = entries.filter((e) => /^\d+$/.test(e));
  if (pids.length === 0) return "unknown"; // 看不到进程表 ⇒ 没查成（⛔ 不是「进程不存在」）
  if (!pids.includes(String(pid))) return "exited";
  // ⚠️ 这里【必须】用 Text 形而【不是】argv 形：本函数的契约要求区分「读不成」（⇒ unknown）与
  // 「读到了但空」（僵尸/已退未收尸 ⇒ exited，是【测量】而非「没查成」）。argv 形把空折成 null，
  // 那一折正好是硬规则 3b 的失败形态。读由 kernel leaf 单点实现
  // （gap-judgment-rewrites-route-through-proc-identity-leaf）；leaf 对二者分别给出 "" / null。
  const text = readProcCmdlineText(pid, procDir);
  if (text === null) return "unknown"; // 条目在但读不到（权限 / 竞态）⇒ 没查成
  return text.trim().length === 0 ? "exited" : "alive";
}

/** 冷启动「已在飞」排除集：task id 同时满足 ① 有 task/<id> worktree、② 有存活 worker 进程。二者缺一
 *  不纳入（只有 worktree 无进程 = orphan，可清、可重派；只有进程无 worktree = 尚未 fork，由内存
 *  running 覆盖）。opts.worktreeTasks / opts.workerCmdlines 是测试缝（null ⇒ 用真实 git / /proc）。 */
export function enumerateColdStartInflight(
  root: string,
  opts: { worktreeTasks?: string[] | null; workerCmdlines?: string[] | null; workerName?: string } = {},
): Set<string> {
  const worktreeTasks = opts.worktreeTasks ?? enumerateTaskWorktreeTasks(root);
  if (worktreeTasks.length === 0) return new Set(); // 无 task worktree ⇒ 无冷启动在飞（⛔ 不白扫 /proc）
  const workerName = opts.workerName ?? resolveWorkerProcessName(root);
  const workerCmdlines = opts.workerCmdlines ?? enumerateLiveWorkerCmdlines("/proc", workerName);
  const out = new Set<string>();
  for (const taskId of worktreeTasks) {
    if (hasLiveWorkerForTask(taskId, workerCmdlines, workerName)) out.add(taskId);
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

/** enumerateTaskWorktreeRefs 的异步版（常驻循环体用）。 */
async function enumerateTaskWorktreeRefsAsync(root: string): Promise<TaskWorktreeRef[]> {
  const taskIdSet = new Set(listTaskIds(root));
  const refs: TaskWorktreeRef[] = [];
  for (const wt of await listWorktreesAsync(root)) {
    const name = taskIdFromBranch(wt?.branch);
    if (name == null) continue;
    const { taskId, match } = resolveTaskName(name, taskIdSet);
    refs.push({ name, path: wt.path ?? null, branch: wt.branch ?? null, taskId, match });
  }
  return refs;
}

/** enumerateTaskWorktreeTasks 的异步版（常驻循环体用）。回落规则同同步版（⛔ 不丢条目）。 */
async function enumerateTaskWorktreeTasksAsync(root: string): Promise<string[]> {
  return (await enumerateTaskWorktreeRefsAsync(root)).map((r) => r.taskId ?? r.name);
}

/** enumerateColdStartInflight 的异步版（常驻循环体用）：git worktree list 改 spawn；/proc 扫进程仍是
 *  同步 fs（廉价、无 spawnSync 阻塞——task 4 只点名 git，不点名 /proc）。opts 测试缝同同步版。 */
export async function enumerateColdStartInflightAsync(
  root: string,
  opts: { worktreeTasks?: string[] | null; workerCmdlines?: string[] | null; workerName?: string } = {},
): Promise<Set<string>> {
  const worktreeTasks = opts.worktreeTasks ?? await enumerateTaskWorktreeTasksAsync(root);
  if (worktreeTasks.length === 0) return new Set(); // 无 task worktree ⇒ 无冷启动在飞（⛔ 不白扫 /proc）
  const workerName = opts.workerName ?? resolveWorkerProcessName(root);
  const workerCmdlines = opts.workerCmdlines ?? enumerateLiveWorkerCmdlines("/proc", workerName);
  const out = new Set<string>();
  for (const taskId of worktreeTasks) {
    if (hasLiveWorkerForTask(taskId, workerCmdlines, workerName)) out.add(taskId);
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
  workerName: string = WORKER_PROCESS_NAME,
): OrphanCleanupResult {
  const paths = worktreePathsForTask(root, taskId);
  if (paths.length === 0) {
    return {
      removed: false, worktreePath: null, branchDeleted: false, error: null, skippedLiveWorker: false,
      hasCommits: null, preservedForCommits: false, sigtermExternal: false,
    };
  }
  const live = workerCmdlines ?? enumerateLiveWorkerCmdlines("/proc", workerName);
  if (hasLiveWorkerForTask(taskId, live, workerName)) {
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
  /** 该 task 的 status 读数：superseded / ready / done / needs-human / todo / unreadable（缺失或读不懂），
   *  另有 "worktree-name-unmatched"（该 worktree 的名字绑不上任何真实任务 id —— 见 ReclaimSupersededResult.
   *  mismatchedWorktreeNames）。四者两两不等（硬规则 3b）：unreadable 不与可回收（superseded）也不与跳过
   *  （任一真 status）同形；worktree-name-unmatched 更不同形——它说的不是「任务读不懂」，而是「这个
   *  worktree 的名字根本对不上任务库」，旧实现把它伪装成 unreadable（用截断名查真实库自然查不到）。 */
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
  /** 枚举到的、名字绑不上任何真实任务 id 的 worktree 名（gap-worktree-task-id-mismatch-defeats-
   *  leftover-worktree-exemption AC2/AC3 诊断载体）。与 perTask 的 status 独立：`candidateCount` 只数
   *  superseded，这些名字永远不进候选，⛔ 不能靠「候选为 0」推断「没有名字对不上的 worktree」。 */
  mismatchedWorktreeNames: string[];
}

/** 测试缝（与 cleanupOrphanWorktree 同款，null ⇒ 用真实 git / /proc / readTaskStatus）。 */
export interface SupersededReclaimOpts {
  /** 存活 worker cmdline 列表（null ⇒ enumerateLiveWorkerCmdlines()）。 */
  workerCmdlines?: string[] | null;
  /** 枚举到的 task/<id> worktree 的 task id（null ⇒ enumerateTaskWorktreeTasksAsync(root)）。 */
  worktreeTasks?: string[] | null;
  /** 名字→真实任务 id 的绑定（null ⇒ enumerateTaskWorktreeRefsAsync(root)）。优先于 worktreeTasks；
   *  诊断口径（mismatchedWorktreeNames / status:"worktree-name-unmatched"）只在此路径上可测。 */
  taskWorktreeRefs?: TaskWorktreeRef[] | null;
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
  /** 本 workspace 的 worker `-n` 名（null ⇒ 解析自 root 的 .quay/profiles.yml）。⛔ 缺省不可回落到
   *  写死的 `quay-task-worker`——第三方项目改名后门①恒不命中 ⇒ 会回收（并 SIGTERM）在飞 worker 的
   *  worktree（与 orphan-finalize 同一缺陷面，见 resolveWorkerProcessName）。 */
  workerName?: string | null;
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
 *
 * 名字掉了后缀的 worktree（gap-worktree-task-id-mismatch-defeats-leftover-worktree-exemption）：
 * 旧实现把分支名直接当任务 id 去查（statusOf(name)），掉后缀的名字查不到真实任务 ⇒ 记成 "unreadable"
 * ——「用错误字符串查不到」伪装成了「读不懂」。修法：枚举改走 enumerateTaskWorktreeRefsAsync，名字先经
 * resolveTaskName 绑回真实任务 id（唯一前缀 ⇒ 正确关联，例：quay-worktrees/gap-worker-driver-counts-
 * transient-rate-limit → gap-worker-driver-counts-transient-rate-limit-as-fast-death-and-parks-task-
 * needs-human，绑不上 ⇒ 独立取值 "worktree-name-unmatched" 并落进 mismatchedWorktreeNames，⛔ 不冒充
 * unreadable）。
 * best-effort：移除失败（脏树/锁/活进程）不致命，error 落盘供观测，⛔ 不抛。
 */
export async function reclaimSupersededWorktrees(
  root: string,
  opts: SupersededReclaimOpts = {},
): Promise<ReclaimSupersededResult> {
  // 用 refs（名字→id 绑定）而非裸名字：诊断需要「名字」与「绑上的 id」两个值同时在场
  // （硬规则 3b——`unmatched` 必须与 `unreadable` 可区分）。worktreeTasks 测试缝保留（裸名字 ⇒ 视为
  // exact，与旧行为逐字一致）。
  const refs: TaskWorktreeRef[] = opts.taskWorktreeRefs
    ?? (opts.worktreeTasks
      ? opts.worktreeTasks.map((name) => ({ name, path: null, branch: null, taskId: name, match: "exact" as const }))
      : await enumerateTaskWorktreeRefsAsync(root));
  const mismatchedWorktreeNames = refs.filter((r) => r.match === "unmatched").map((r) => r.name);
  if (refs.length === 0) {
    return { candidateCount: 0, perTask: [], reclaimed: [], skipped: [], mismatchedWorktreeNames };
  }
  const statusOf = opts.statusOf ?? ((taskId: string) => readTaskStatus(root, taskId));
  // 路径查找优先用本轮枚举的 refs（它们的 path 就是这次的读数，且【名字对不上时也在场】——⛔ 不再按
  // 名字重跑一次精确匹配，否则掉后缀的 worktree 永远查不到路径、回收步骤对它形同虚设）；refs 没带路径时
  // （worktreeTasks 测试缝只给名字）回落到 worktreePathsForTaskAsync（它自己也带后缀截断臂）。
  const pathsOf = opts.pathsOf ?? (async (taskId: string) => {
    const fromRefs = refs.filter((r) => (r.taskId ?? r.name) === taskId && r.path).map((r) => r.path as string);
    return fromRefs.length > 0 ? fromRefs : worktreePathsForTaskAsync(root, taskId);
  });

  // 第一遍：读 status，仅 superseded 进候选。
  const statusByTask = new Map<string, string>();
  const candidates: string[] = [];
  for (const ref of refs) {
    const key = ref.taskId ?? ref.name;
    const status = ref.match === "unmatched" ? "worktree-name-unmatched" : (statusOf(key) ?? "unreadable");
    statusByTask.set(key, status);
    if (status === TASK_STATUS.SUPERSEDED) candidates.push(key);
  }

  // 双闸共享扫 /proc（仅在有候选时；无候选不白扫——同 enumerateColdStartInflight 的 short-circuit）。
  const workerName = opts.workerName ?? resolveWorkerProcessName(root);
  const workerCmdlines = candidates.length > 0 ? (opts.workerCmdlines ?? enumerateLiveWorkerCmdlines("/proc", workerName)) : [];
  const procs = candidates.length > 0 ? (opts.procs ?? enumerateProcs()) : [];
  const reclaimed: string[] = [];
  const skipped: string[] = [];

  const perTask: SupersededWorktreeReclaimResult[] = [];
  for (const ref of refs) {
    const taskId = ref.taskId ?? ref.name;
    const status = statusByTask.get(taskId)!;
    if (status !== TASK_STATUS.SUPERSEDED) {
      perTask.push({ taskId, status, worktreePath: ref.path ?? null, reclaimed: false, skippedLiveWorker: false, liveWorkerSignaled: false, skippedLiveProcess: false, branchPreserved: null, error: null });
      continue;
    }
    const paths = await pathsOf(taskId);
    const p = paths[0] ?? null;
    if (p === null) {
      perTask.push({ taskId, status, worktreePath: null, reclaimed: false, skippedLiveWorker: false, liveWorkerSignaled: false, skippedLiveProcess: false, branchPreserved: null, error: null });
      continue;
    }
    // 门①：存活 worker（同 cleanupOrphanWorktree）。
    if (hasLiveWorkerForTask(taskId, workerCmdlines, workerName)) {
      skipped.push(taskId);
      // 仅 status=superseded 才发 SIGTERM（⛔ 不含 needs-human——该状态活 worker 可能正合法收尾，语义不如
      // superseded 干净）。此分支只在候选（superseded）内到达，status 恒为 superseded；显式判 status 是
      // 防御性自证（若候选集将来扩到 needs-human，仍不会误信号）。
      let liveWorkerSignaled = false;
      if (status === TASK_STATUS.SUPERSEDED) {
        const resolvePid = opts.pidOf ?? ((taskId) => findLiveWorkerPid(taskId, "/proc", workerName));
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

  return { candidateCount: candidates.length, perTask, reclaimed, skipped, mismatchedWorktreeNames };
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

/** 把一条 outcome 追加写入指定文件（mkdir -p + appendFileSync，一行一 JSON）。
 *
 *  **词表闸**（gap-worker-outcome-final-state-landed-is-a-dead-value）：本函数是 `worker-outcome.jsonl`
 *  的**唯一**落盘点（4 个内部调用点 + appendOutcome 包装都经它）⇒ `assertFinalState` 放在这里，
 *  就把「`landed` 这类词表外取值」从**写入面**上移除掉了，而不仅是在文档里声明它不合法。
 *  闸在 mkdir/append **之前**：拒收时不留半条记录、不留新目录（负控制断言载体文件不存在）。 */
export function appendOutcomeToFile(file: string, outcome: ReturnType<typeof computeOutcome>): string {
  assertFinalState(outcome.final_state, `appendOutcomeToFile → ${path.basename(file)}`);
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

/** 本轮的 push 滞后检查读数（gap-fan-in-push-silently-fails-no-detection AC7 的**生产可观测载体**：
 *  生产 driver argv 无 `--json`，round 记录是它唯一每轮必写的载体——检测器的结论必须落在这里，否则
 *  「报出来了」只在测试里成立，硬规则 4 推论三的读生产载体半边缺席）。 */
export interface PushLagRoundRecord {
  verdict: string;
  ahead: number | null;
  behind: number | null;
  oldestAheadSha: string | null;
  lagMs: number | null;
  /** null = 阈值没解析出来（本步自己抛错的那一支）——⛔ 不与「阈值 = 0」共用取值。 */
  thresholdMs: number | null;
  thresholdSource: string;
  retry: string | null;
  laggingAtMeasure: boolean;
  eventFile: string | null;
}

/** 把一次 push 滞后判定投影成 round 载体的字段（⛔ 不整个 PushLagOutcome 塞进去：round 记录每轮写，
 *  reading 里的大对象会让载体无谓膨胀；投影保留全部【判定取值】字段，⛔ 不丢可区分性）。 */
export function projectPushLag(outcome: PushLagOutcome): PushLagRoundRecord {
  const r = outcome.reading;
  return {
    verdict: outcome.verdict,
    ahead: r.ahead, behind: r.behind,
    oldestAheadSha: r.oldestAheadSha,
    lagMs: r.lagMs,
    thresholdMs: r.thresholdMs,
    thresholdSource: r.thresholdSource,
    retry: outcome.retry,
    laggingAtMeasure: outcome.laggingAtMeasure,
    eventFile: outcome.eventFile,
  };
}

/** 常驻环每轮跑一次 push 滞后检查（gap-fan-in-push-silently-fails-no-detection AC7 的挂点实现）。
 *  **⛔ 本步抛错绝不冒泡**：远端不可达 / 凭据失效 / 瞬时 fs 异常都是「下一轮重试」而不是「整轮 error」。
 *  但也不返回 null——null 的语义是「本轮没跑该步」，与「跑了但炸了」混同就是硬规则 3b 的镜像半边
 *  （读不懂伪装成没这回事）。⇒ 返回一条 verdict=not-evaluated 的读数，来源串带上真因。 */
export function runPushLagPass(root: string, branch: string, remote: string, roundIntervalMs: number): PushLagRoundRecord {
  try {
    const th = resolvePushLagThresholdMs({ root, roundIntervalMs });
    return projectPushLag(runPushLagCheck({ root, branch, remote, thresholdMs: th.ms, thresholdSource: th.source }));
  } catch (e) {
    return {
      verdict: "not-evaluated",
      ahead: null, behind: null, oldestAheadSha: null, lagMs: null,
      thresholdMs: null,
      thresholdSource: `error:${(e as Error)?.message ?? "unknown"}`,
      retry: null, laggingAtMeasure: false, eventFile: null,
    };
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
  /** 本轮重试上限豁免判定的结果（gap-retry-cap-flip-conflates-own-defect-with-unrelated-flaky）。
   *  verdict ∈ unrelated-flaky-exempt / own-defect-counted / insufficient-data-fallback /
   *  static-phase-attributed——各态在记录里可区分（AC5，硬规则 3b：判不出 ≠ 判为无关 ≠ 静态相位已归因）。
   *  staticPhase* 三键（gap-suite-red-attribution-blind-to-static-phase AC5 的生产读数面）：静态相位红
   *  时记下点名的 checker 与文件，⛔ 只记 retry_exemptions 的既有键无法区分「读到了什么」。缺省/空 =
   *  本轮无豁免判定。 */
  retryExemptions?: Array<{
    task: string;
    verdict: string;
    reason: string;
    failingTestFiles: string[];
    recurredTasks: string[];
    staticPhaseRed?: boolean;
    staticPhaseCheckers?: string[];
    staticPhaseNamedFiles?: string[];
  }>;
  /** 本轮「suite 红但归因不出失败测试文件」的【后续动作】判定（gap-fan-in-suite-red-with-no-
   *  attributable-test-still-redispatches-worker）：{ task, kind, verdict, reason, suiteLogHash }。
   *  kind ∈ count-and-retry / stop-terminal——两取值可区分（AC3，硬规则 3b：读不懂的 verdict 不得与
   *  「已归因」共用同一动作）。缺省/空 = 本轮无该判定。 */
  exitedNotLandedStops?: Array<{ task: string; kind: string; verdict: string; reason: string; suiteLogHash: string | null }>;
  /** 本轮 superseded worktree 回收结果（gap-superseded-task-residual-worktree-never-reclaimed AC7）：
   *  { candidateCount, reclaimed, skipped, perTask }。候选数为 0 时 candidateCount=0（⛔ 不省略——「跑过
   *  且无候选」与「压根没跑」在载体上可区分，硬规则 4 推论三的读生产载体半边）。缺省 null = 没跑该步
   *  （⛔ 与 candidateCount=0 区分）。 */
  supersededReclaim?: ReclaimSupersededResult | null;
  /** 本轮 release 分支 janitor 的结果（gap-ac271-finish-step-needs-self-acting-carrier）。缺省 null =
   *  本轮**没跑**该步（⛔ 与「跑了、枚举为空」区分：后者 evaluated:true + branchCount:0，硬规则 4
   *  推论三的读生产载体半边——AC6 的生产读数正是读它）。 */
  releaseBranchJanitor?: JanitorResult | null;
  /** 本轮 push 滞后检查的读数（gap-fan-in-push-silently-fails-no-detection AC7）。缺省 null = 本轮
   *  **没跑**该步（⛔ 与「跑了且 in-sync」可区分——同 supersededReclaim 的约定，硬规则 4 推论三）。 */
  pushLag?: PushLagRoundRecord | null;
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
    exited_not_landed_stops: opts.exitedNotLandedStops ?? [],
    superseded_reclaim: opts.supersededReclaim ?? null,
    // gap-ac271-finish-step-needs-self-acting-carrier：本轮 release 分支 janitor 读数（枚举为空也记，
    // ⛔ 不省略——「跑过且无分支可处理」与「没跑该步」在载体上可区分；后者为 null）。
    release_branch_janitor: opts.releaseBranchJanitor ?? null,
    // gap-fan-in-push-silently-fails-no-detection AC7：本轮 push 滞后检查读数（in-sync 也记，
    // ⛔ 不省略——「跑过且无滞后」与「没跑该步」在载体上可区分；后者为 null）。
    push_lag: opts.pushLag ?? null,
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
  } else if (scoped.kind === "skip") {
    lines.push(
      `(ii) skip the scoped gate (${scoped.reason}: this project declares no loop.scoped_command in .quay/config.yml — the driver's fan-in goes straight to the full-suite step);`,
      `(iii) commit and exit.`,
    );
  } else {
    // 声明了但读不懂 ⇒ 本项目不会跑 scoped 门（fan-in 会 fail-closed）；prompt 里如实说明，⛔ 不假装跳过。
    lines.push(
      `(ii) NOTE: the scoped gate cannot run — ${scoped.reason}`,
      `(iii) fix loop.scoped_command in .quay/config.yml (or remove it) and re-run; the driver's fan-in fails closed on an unreadable declaration.`,
      `(iv) commit and exit.`,
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

// ── suite 失败行解析（gap-suite-failure-attribution-third-party-layout）─────────────────────────────
// 上游缺陷：本函数曾把【本仓库的测试布局】写死进判据——前缀只认 `(packages|plugin|experiments)/`、
// 后缀只认 `.test.mjs`。第三方项目（`server/**/*.test.ts`、`src/**/*.test.tsx`）匹配恒为 0 ⇒ 返回
// `[]` ⇒ judgeRetryExemption 判 insufficient-data-fallback ⇒ park 时的判词写成「the suite log names
// nothing a worker could fix」——**一个肯定断言，而它的依据只是「解析器没读懂」**（硬规则 3b 的镜像：
// 读不懂 ⇒ 伪装成判定）。生产读数（claudecodeui `.quay/worker-round.jsonl`，2026-09-20→09-23）：51 次
// retry_exemptions 中 failingTestFiles 非空 **0 次**，波及 29 个任务；其中一例真凶是一条可一行修的
// barrel 导入 lint 错误（`not ok - lint: server/…/model-context-window.test.ts:10:49: …`）。
//
// 修法：⛔ 不再按路径前缀/后缀白名单判定，改为**按 token 的形态**分三类（硬规则 3b 要求「读不懂」有
// 独立取值，⛔ 不与「合格」同形）：
//   - 带路径分隔符的 token ⇒ 真实文件位置（`server/x/y.test.ts`、worktree 绝对路径形态都算）
//   - 无路径且无扩展名的 token ⇒ **伪阶段名**（`lint` / `typecheck`——runner 的 per-file 记录里它们
//     占同一字段位，但它们不是文件；旧实现会把 `lint` 当测试文件）
//   - 其余（含句子碎片、无路径又非测试后缀的 token）⇒ **无法识别**，原样留证，⛔ 不混进 files
/** suite 日志失败行的解析结果。三态可区分（硬规则 3b）。 */
export interface SuiteLogFailureParse {
  /** 归因到的失败文件（repo-relative；worktree 绝对路径形态按 root 归一）。 */
  files: string[];
  /** 解析器识别出的失败行数 N（`__PERFILE__ … passed=false` 与 `not ok - …` 两类之和）——
   *  唯一能区分「日志里没有失败行」与「有失败行但解析器读不懂」的量（⛔ 旧实现两者同形）。 */
  failingLines: number;
  /** 识别为伪阶段名的 token（`lint` / `typecheck` 等）——⛔ 不是测试文件。 */
  pseudoStages: string[];
  /** 既非真实文件也非伪阶段名 ⇒ 读不懂的 token（原样留证）。 */
  unclassified: string[];
}

/** 测试文件后缀（node:test 的 `*.test.*` 与 jest/vitest 的 `*.spec.*`；本仓库自身用 .test.mjs）。 */
const SUITE_TEST_FILE_RE = /\.(?:test|spec)\.(?:mjs|cjs|js|ts|tsx|jsx|mts|cts)$/i;
/** 路径 token 的合法字符集——挡掉 `boundaries(dependencies):` 这类句子碎片混进文件名（那是"读不懂"）。 */
const SUITE_PATH_TOKEN_RE = /^[\w./@~+-]+$/;

/** 单个 token 的形态分类。⛔ 不查 worktree 是否存在：第三方日志里的失败文件常常不在本 worktree
 *  （其它模块/并行分支），存在性检查会把真实文件误判成读不懂（且 AC 用例的假 root 里文件不存在）。 */
function classifySuiteToken(token: string): "file" | "pseudo-stage" | "unclassified" {
  const t = String(token ?? "").trim().replace(/[,;]+$/, "");
  if (!t) return "unclassified";
  if (!SUITE_PATH_TOKEN_RE.test(t)) return "unclassified";
  if (t.includes("/")) return "file";
  if (!t.includes(".")) return "pseudo-stage";
  return SUITE_TEST_FILE_RE.test(t) ? "file" : "unclassified";
}

/** token → repo-relative；定位不出 ⇒ null（**读不懂的独立取值**，硬规则 3b）。
 *  绝对路径的 repo 根【只能】由 root 给出（生产里 `measure-suite-reporter` 发的是 full-path，而 suite
 *  在任务 worktree 里跑、调用方拿的是主检出 root）：先按 root 前缀剥离，不在 root 下则取「在 root 下
 *  真实存在」的最长后缀——存在性是判据。⛔ 不按 `packages|plugin|experiments` 关键词猜前缀（那正是本
 *  缺陷的成因）；⛔ 也不在无 root 时把绝对路径削成「看着像 repo-relative」的假路径——它会被当成已归因，
 *  直接污染 AC-317 的读数（假在产物字段上 ⇒ 比读不懂更坏）。 */
function toRepoRelToken(token: string, root: string | null): string | null {
  const raw = String(token ?? "").replace(/\\/g, "/").trim();
  if (!raw.startsWith("/")) return normalizeRel(raw) || null;
  const rootAbs = root ? `/${normalizeRel(root)}` : "";
  if (!rootAbs || rootAbs === "/") return null;
  if (raw === rootAbs || raw.startsWith(`${rootAbs}/`)) return normalizeRel(raw.slice(rootAbs.length)) || null;
  const parts = raw.split("/").filter(Boolean);
  for (let i = 1; i < parts.length; i += 1) {
    const cand = parts.slice(i).join("/");
    try {
      if (fs.statSync(path.join(rootAbs, cand)).isFile()) return cand;
    } catch { /* 该后缀不存在，继续缩短 */ }
  }
  return null;
}

/** `__PERFILE__ duration_ms=… <token> passed=false …` 的 <token> = `passed=false` 前那个字段。 */
function suiteTokenBeforePassedFalse(line: string): string | null {
  const idx = line.indexOf("passed=false");
  if (idx < 0) return null;
  const parts = line.slice(0, idx).trim().split(/\s+/);
  return parts.length ? parts[parts.length - 1] : null;
}

/** `not ok - <rest>` 的 <rest>（兼容 TAP 的 `not ok 1 - name` 编号形态）。无该形态 / 空 ⇒ null。
 *  ⛔ 这一个正则就是「什么算 not ok 行」的唯一定义：下面的 head / 指名文件两个读者共用它。 */
function suiteNotOkRest(line: string): string | null {
  const m = /^not ok\b(?:\s+\d+)?\s*-\s*(.*)$/i.exec(line);
  if (!m) return null;
  return m[1].trim() || null;
}

/** `<rest>` 里 `:` 之前的头部 token（`lint` / `server/a/b.test.ts`）；空 ⇒ ""（调用方按 unclassified 处置）。 */
function suiteNotOkHead(rest: string): string {
  const ci = rest.indexOf(":");
  return (ci < 0 ? rest : rest.slice(0, ci)).trim();
}

/** 伪阶段名后指名的真实文件：`lint: <rel>:<line>:<col>: <msg>` ⇒ `<rel>`。
 *  只在确实像路径/测试文件时返回（⛔ 不把 `not ok - lint: 5 problems` 的 `5` 当文件）。 */
function suiteFileNamedAfterStage(rest: string): string | null {
  const ci = rest.indexOf(":");
  if (ci < 0) return null;
  const chunk = (rest.slice(ci + 1).trim().split(/\s+/)[0] ?? "").replace(/(?::\d+){1,2}:?$/, "").replace(/:$/, "");
  if (!chunk) return null;
  if (!chunk.includes("/") && !SUITE_TEST_FILE_RE.test(chunk)) return null;
  return chunk;
}

/** suite 日志 → 失败行解析（三态）。N = 失败行数（`__PERFILE__ … passed=false` + `not ok - …`）。
 *  ⛔ N 与 files 分开返回：调用方据此把「日志里没有失败行」与「有 N 行但一行也归因不出」写成不同的判词
 *  （旧实现两者都只说「提取不出」，与「真的没有可修对象」同形）。 */
export function parseSuiteLogFailures(logText: string, root?: string | null): SuiteLogFailureParse {
  const files: string[] = [];
  const pseudoStages: string[] = [];
  const unclassified: string[] = [];
  let failingLines = 0;
  const notePseudo = (t: string): void => { if (t && !pseudoStages.includes(t)) pseudoStages.push(t); };
  const noteUnclassified = (t: string): void => { if (t && !unclassified.includes(t)) unclassified.push(t); };
  const addFile = (token: string): void => {
    // 定位不出 repo-relative（如无 root 的绝对路径）⇒ 归入「读不懂」，⛔ 不冒充已归因（硬规则 3b）。
    const rel = toRepoRelToken(token, root ?? null);
    if (!rel) { noteUnclassified(token); return; }
    if (!files.includes(rel)) files.push(rel);
  };

  for (const raw of String(logText ?? "").split("\n")) {
    const line = raw.trim();
    if (line.includes("passed=false")) {
      const token = suiteTokenBeforePassedFalse(line);
      if (!token) continue;
      failingLines += 1;
      const cls = classifySuiteToken(token);
      if (cls === "file") addFile(token);
      else if (cls === "pseudo-stage") notePseudo(token);
      else noteUnclassified(token);
      continue;
    }
    const rest = suiteNotOkRest(line);
    if (rest === null) continue;
    failingLines += 1;
    const head = suiteNotOkHead(rest);
    const cls = classifySuiteToken(head);
    if (cls === "file") { addFile(head); continue; }
    if (cls === "pseudo-stage") notePseudo(head);
    else noteUnclassified(head);
    // `not ok - <stage>: <rel>:<line>:<col>` 行把阶段失败【指名】到了真实文件上 ⇒ 归因到它。
    const named = suiteFileNamedAfterStage(rest);
    if (named !== null) {
      if (classifySuiteToken(named) === "file") addFile(named);
      else noteUnclassified(named);
    }
  }
  return { files, failingLines, pseudoStages, unclassified };
}

/** 判词的「读到了什么」半边：伪阶段名 + 读不懂的 token 摘要（judgeRetryExemption 与 stop-terminal 判词
 *  共用一份措辞，⛔ 不各写一遍——两份措辞就是两处漂移）。 */
function suiteTokenDetail(pseudoStages: string[], unclassified: string[]): string {
  const extra: string[] = [];
  if (pseudoStages.length) extra.push(`pseudo-stage tokens: ${pseudoStages.slice(0, 5).join(", ")}`);
  if (unclassified.length) extra.push(`unrecognized tokens: ${unclassified.slice(0, 5).join(", ")}`);
  return extra.length ? `; ${extra.join("; ")}` : "";
}

/** 从 suite 日志文本提取失败测试文件（repo-relative）。见 parseSuiteLogFailures。
 *  读不出 ⇒ []（不伪造；空列表与「读懂了但无失败」同形，调用方据 continueSuiteLogNote 的有无判定
 *  是否 suite 红，或据 parseSuiteLogFailures().failingLines 把两者分开）。 */
export function failingTestFilesFromSuiteLog(logText: string, root?: string | null): string[] {
  return parseSuiteLogFailures(logText, root).files;
}

// ── 静态相位失败的归因（gap-suite-red-attribution-blind-to-static-phase）────────────────────────────
// 上游缺陷：本模块的重试豁免归因【只有一条路】——失败测试文件（`__PERFILE__ … passed=false` /
// `not ok - …`）。而 suite 死在【静态相位】时日志里根本没有失败测试行（实测 `# tests 0`），真因写在
// `STATIC_CHECK_FAILED: <checker> exit=<rc>` 机器行 + 它上面那段 checker 违规输出里。于是
// `failingTestFiles.length === 0` 恒成立 ⇒ 一律 insufficient-data-fallback ⇒ 终局判词
// 「infra/contract suspected, not an implementable defect」——**而那个相位逐字点名了本任务新文件里的
// 可修缺陷**。实测（`gap-arch-tsify-checker-mutation-check-sh` 的 fan-in 日志，2026-09-20T20:37Z）：
//   checker-mechanical-spine-check — 133 checker(s), 1 violation(s), 0 exempted
//   FAIL: 1 unexempted violation(s):
//     - checker-mutation-check.ts (json): --json claimed but no JSON primitive
//   STATIC_CHECK_FAILED: checker-mechanical-spine-check exit=1
//   # tests 0 / # fail 47 / # suite red static-check
// 而该任务的 delta 里就有 `plugin/scripts/checker-mutation-check.ts`（本段修复时 grep 复核过）。
// 与硬规则 3b 同源、方向相反：一个「读不懂」的输入不得触发与「已读懂且判为不可修」相同的动作。

/** 静态相位失败的解析结果（三态可区分，硬规则 3b）。 */
export interface StaticPhaseFailureParse {
  /** 日志是不是【静态相位红】（`STATIC_CHECK_FAILED:` 机器行 或 `# suite red static-check` 结束行）。
   *  ⛔ 与「suite 红但走测试相位」分开：只有它为真才谈得上静态相位归因。 */
  staticPhaseRed: boolean;
  /** `STATIC_CHECK_FAILED: <name> exit=<rc>` 点名的 checker 名（去重，按出现序）。 */
  failedCheckers: string[];
  /** 失败块内【指名】的 artifact token（原样留证，⛔ 不解析成猜测路径；去重，按出现序）。 */
  namedArtifacts: string[];
}

/** `STATIC_CHECK_FAILED: <name> exit=<rc>`（checker-cost-lib 的 fail-closed 机器行，stderr）——静态相位
 *  【唯一】的机器可读失败信号。与 `full-suite-runner.ts` 的 `STATIC_CHECK_FAILED_RE` 同形（薄本地副本，
 *  ⛔ 不 import 那个模块：worker-driver 与 full-suite-runner 之间不新开一条边，import-graph 闸的
 *  valueSccs 基线为 0）。 */
const STATIC_CHECK_FAILED_LINE_RE = /^STATIC_CHECK_FAILED:\s*(\S+)\s+exit=(\d+)/;
/** 静态相位红的 suite 收尾行（test.sh 静态检查失败时打的字面量；与机器行互补——任一在 ⇒ 这是静态相位红）。 */
const STATIC_PHASE_RED_END_RE = /^#\s*suite red static-check\s*$/;
/** 静态相位失败【块】的起始行。⛔ 只在块内取指名 artifact：baselined 的违规明细在【通过】的 checker
 *  输出里照样逐条打印——本仓库实测一份 fan-in 日志里有 44 条 `VIOLATION:` 明细而 task-contract-check
 *  并未失败（它 print 的是 grandfather 名单）。不加这一层 scoping 会把既有违规误归因到每一个任务，
 *  那是硬规则 3b 的反面（把「不是我的」伪装成「是我的」）。形状取自 `full-suite-runner.ts` 的
 *  `isStaticCheckFailureLine`（a passing run never emits these）。 */
const STATIC_FAIL_BLOCK_START_RE =
  /^(?:FAIL:\s*\d+\s+(?:\S+\s+)?violation|new since baseline:\s*[1-9]|CEILING BREACH|ceiling was RAISED)/;
/** 失败块【内】一条违规明细行 → 它指名的 artifact token（无 ⇒ null）。两种形态各带一个结构标记
 *  （`(dimension)` / `— code:`），⛔ 纯 `  - foo:` 的句子碎片不算指名（那会引入假归因）。 */
function staticBlockNamedArtifact(line: string): string | null {
  const dash = /^\s+-\s+(\S+)\s+\([a-z0-9_-]+\)\s*:/.exec(line);
  if (dash) return dash[1];
  const vio = /^\s*VIOLATION:\s*(\S+)\s*(?:—|-)\s*\S+\s*:/.exec(line);
  if (vio) return vio[1];
  return null;
}

/** suite 日志 → 静态相位失败解析。⛔ 不返回「有没有可修对象」这种布尔——`staticPhaseRed`、
 *  `failedCheckers`、`namedArtifacts` 三个读数分开给，调用方据此写出如实判词（硬规则 3/3b）。 */
export function parseStaticCheckFailures(logText: string): StaticPhaseFailureParse {
  const failedCheckers: string[] = [];
  const namedArtifacts: string[] = [];
  let staticPhaseRed = false;
  let inBlock = false;
  for (const raw of String(logText ?? "").split("\n")) {
    const line = raw.replace(/\r$/, "");
    const trimmed = line.trim();
    if (!trimmed) continue;
    const m = STATIC_CHECK_FAILED_LINE_RE.exec(trimmed);
    if (m) {
      staticPhaseRed = true;
      inBlock = false; // 机器行是收尾汇总，它自己不开一个失败块
      if (!failedCheckers.includes(m[1])) failedCheckers.push(m[1]);
      continue;
    }
    if (STATIC_PHASE_RED_END_RE.test(trimmed)) { staticPhaseRed = true; inBlock = false; continue; }
    if (STATIC_FAIL_BLOCK_START_RE.test(trimmed)) { inBlock = true; continue; }
    if (!inBlock) continue;
    // 块内续行 = 缩进的明细行；非缩进行 ⇒ 块结束（下一段 checker 输出 / 下一节标题）。
    if (!/^\s/.test(line)) { inBlock = false; continue; }
    const tok = staticBlockNamedArtifact(line);
    if (tok && !namedArtifacts.includes(tok)) namedArtifacts.push(tok);
  }
  return { staticPhaseRed, failedCheckers, namedArtifacts };
}

/** checker/文件的扩展名孪生集。`.sh` ↔ `.ts` ↔ `.js` 是【同一条判断对象的两种壳】（本仓库的 shell→TS
 *  改写程序把同一个 checker 从 `.sh` 换成 `.ts`）⇒ 判「点名的是不是本任务改的那个文件」时它们等价。 */
const STATIC_ARTIFACT_EXTS = [".ts", ".sh", ".mjs", ".cjs", ".js", ".tsx", ".jsx", ".mts", ".cts"];

/** 去扩展名的 basename（`a/b/foo-check.ts` ⇒ `foo-check`）。 */
function artifactStem(p: string): string {
  const base = path.posix.basename(normalizeRel(p));
  const ext = path.posix.extname(base).toLowerCase();
  return STATIC_ARTIFACT_EXTS.includes(ext) ? base.slice(0, -ext.length) : base;
}

/** 同目录同 stem 的其它扩展名形态（`x.sh` ↔ `x.ts`）。 */
function artifactExtVariants(p: string): string[] {
  const rel = normalizeRel(p);
  const dir = path.posix.dirname(rel);
  const stem = artifactStem(rel);
  return STATIC_ARTIFACT_EXTS.map((e) => (dir === "." ? `${stem}${e}` : `${dir}/${stem}${e}`));
}

/** 一个被指名的 artifact 是否落在本任务 delta 内（AC2/AC3 的判定核）。
 *  ⛔ **不猜目录前缀**：`checker-mutation-check.ts` 出在日志里只有 basename，把 `plugin/scripts/` 当成
 *  前缀补上去正是 `gap-suite-failure-attribution-third-party-layout` 那个缺陷的成因（按本仓库布局写死
 *  判据）。改为**按名字判**，由 delta 侧提供目录：
 *    ① token 自带路径分隔符 ⇒ 整条路径相等，或同目录同 stem 的扩展名孪生（`.sh`↔`.ts`）。
 *    ② token 是裸名 ⇒ delta 里任一文件的 basename 相等，或同 stem（覆盖 `STATIC_CHECK_FAILED` 点名的
 *       checker 名——那是 checker 文件的 stem，不带扩展名）。 */
export function namedArtifactHitsDelta(artifact: string, deltaPaths: string[]): boolean {
  const art = normalizeRel(String(artifact ?? "").trim());
  if (!art) return false;
  const deltas = deltaPaths.map((d) => normalizeRel(String(d ?? ""))).filter(Boolean);
  const artStem = artifactStem(art);
  if (art.includes("/")) {
    const variants = artifactExtVariants(art);
    return deltas.some((d) => d === art || variants.includes(d));
  }
  return deltas.some((d) => path.posix.basename(d) === art || artifactStem(d) === artStem);
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
  const failing = failingTestFilesFromSuiteLog(logText, root);
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

/** 重试豁免 verdict。own-defect-counted 与 insufficient-data-fallback 都【照常计数】，但后者表示
 *  「读不懂/数据不足」而非「判定为任务自身缺陷」——两态在记录里必须可区分（硬规则 3b）。
 *
 *  `static-phase-attributed`（gap-suite-red-attribution-blind-to-static-phase）：suite 死在【静态相位】、
 *  日志里没有失败测试行，但静态相位的失败信号（`STATIC_CHECK_FAILED` 点名的 checker / 失败块指名的
 *  文件）落在本任务 Touches/diff 内 ⇒ 这是一条**本任务可修的实现缺陷**，⛔ 不得再落
 *  `insufficient-data-fallback`（那会把可修缺陷报成「infra/contract suspected, not an implementable
 *  defect」并推向 needs-human）。与 own-defect-counted 分开取值：成因不同，记录里必须能区分。 */
export type RetryExemptionVerdict =
  | "unrelated-flaky-exempt"
  | "own-defect-counted"
  | "insufficient-data-fallback"
  | "static-phase-attributed";

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
  /** 本次 suite 日志里解析器识别出的失败行数 N。⛔ 与 failingTestFiles 分开记：`0 of N` 才是
   *  「日志里有 N 行失败、一行也没归因出」的证据；N=0 则说明日志里连失败行形态都没有。
   *  两者在旧实现里同形（都只说「提取不出」）⇒ 判词曾写成「没有 worker 能修的东西」（硬规则 3b）。 */
  suiteFailingLines?: number;
  /** 解析器读不懂的 token（伪阶段名 / 句子碎片，原样留证）。 */
  suiteUnclassified?: string[];
  /** 解析器识别出的伪阶段名 token（`lint` / `typecheck`——它们不是测试文件）。 */
  suitePseudoStages?: string[];
  /** 本次 suite 红是不是【静态相位】红（`STATIC_CHECK_FAILED` / `# suite red static-check`）。缺省
   *  undefined = 没走到该分支（⛔ 与 false 区分：false = 读过、不是静态相位）。 */
  staticPhaseRed?: boolean;
  /** 静态相位点名的 checker 名（`STATIC_CHECK_FAILED: <name>`）。 */
  staticPhaseCheckers?: string[];
  /** 静态相位失败块指名的 artifact token（原样留证）。 */
  staticPhaseNamedFiles?: string[];
}

/** 近期窗口缺省：48h（与提案 48h needs-human 复盘同窗）。非新设数值阈值——只是「近期」的操作化，与
 *  flaky 复发语义一致（两周前的 flaky 不算「已知反复出现」）；测试缝可覆盖。 */
export const RETRY_EXEMPTION_WINDOW_MS_DEFAULT = 48 * 3600 * 1000;

/** 断言签名的【唯一】归一化点（gap-retry-exemption-signature-keeps-volatile-values）。
 *
 *  WHY：签名是「同一缺陷是否复发」的**身份**。签名里只要留下每次运行都变的量（pid / 毫秒 / 端口 /
 *  绝对路径 / 哈希），同一缺陷在**每个任务**上都会得到一个**新**签名 ⇒ 「≥2 个不同任务命中同一签名」
 *  结构上永不成立 ⇒ 这个专为「不相关 flaky 不该压垮受害任务」而造的豁免，对最需要它的那一半失败恒空
 *  （硬规则 4：一个结构上不可能取真的判据不是测量）。实证：同一生产缺陷（`driver-runtime.test.mjs`
 *  AC4）在 3 个任务的 suite log 里给出 3 条互不相同的签名，只因 pid/confirmed_ms 不同。
 *
 *  三分类的取舍：把「每次都会变、且不改变缺陷身份」的**量**折成占位；把**措辞**逐字保留——措辞才是
 *  缺陷身份。⛔ 不折词、不截断、不折长引文：`'change' !== 'full'` 里的引文正是区分「两种不同缺陷」
 *  的内容，折掉它就把「不同」变成「同一」（硬规则 3b 的镜像面：不得把「读不懂」变成「合格」，这里
 *  是不得把「不同缺陷」变成「同一缺陷」）。故本函数**不**复用 `meta-driver.ts:errorSignature`——那个
 *  正本面向「错误聚合」，会截断到 200 字符并折掉长引文，两者是**不同**的身份语义（AC5 已枚举该兄弟点）。
 *
 *  退化的归一化结果（折叠后除占位符外一个字母都不剩，如 `1 !== 2` ⇒ `<n> !== <n>`）**丢掉**，不当作
 *  签名：它在不同缺陷间恒等 ⇒ 留下它等于制造假豁免。全丢掉 ⇒ 调用侧落
 *  `insufficient-data-fallback`（照常计数），fail-closed。 */
export function normalizeAssertionSignature(text: string): string {
  let s = String(text ?? "").replace(/\s+/g, " ").trim();
  // ① 哈希/uuid/sha/commit（先于数字：32 位 sha 会被 ② 拆成一堆 <n>，拆完丢掉「这是个哈希」这一形）。
  //    要求命中里**同时含 a–f 与数字**：纯数字串是量不是哈希，交给 ②；只由 a–f 组成的英文词
  //    （`defaced`/`acceded`）不得被当成哈希抹掉，否则把不同缺陷并成一个签名。
  s = s.replace(/\b[0-9a-f]{7,40}\b/gi, (m) => (/[a-f]/i.test(m) && /\d/.test(m) ? "<hex>" : m));
  // ② 绝对路径（≥2 段）。⚠️ 前导 `/` 必须不在词中间：`AC1/AC2/AC3` 的前导 `/` 前面是 `1`（词字符）
  //    ⇒ 不匹配；路径在文本里总是空格/括号/冒号/= 之后 ⇒ 匹配。段字符类含 `-`（worktree 名 / 任务 id）。
  s = s.replace(/(?<![\w])(?:\/[\w.@+-]+){2,}\/?/g, "<path>");
  // ③ 数字字面量（pid / confirmed_ms / 端口 / 计数 / 行号）。⚠️ 只折【数字 token】——词内数字
  //    （`dr-ac4-short` 的 `4`）**不折**：那是**稳定**标识符的一部分，折掉它会把 `ac4` 与 `ac7` 两个
  //    不同的用例并成同一签名（正是本函数开头禁的「把不同缺陷变成同一缺陷」）。判据 = 数字串前面
  //    不是词字符；`530ms` 这类「数字+单位」仍折（单位文本保留）⇒ 数量变、单位不变 ⇒ 签名不变。
  s = s.replace(/(?<!\w)\d+(?:\.\d+)?/g, "<n>");
  return s.trim();
}

/** 从 suite 日志提取归一化断言签名（`AssertionError [ERR_ASSERTION]: msg` / `AssertionError: msg`）。
 *  归一化 = trim + 折叠内部空白 + **易变量折占位**（唯一正本点 `normalizeAssertionSignature`——所有
 *  消费者都经由本函数拿到**已归一化**的签名，⛔ 不存在第二份「哪些字符算易变量」的清单）。
 *  读不出 ⇒ []（不伪造），fail-closed 朝「不复返、照常计数」，硬规则 3b。 */
export function assertionSignaturesFromSuiteLog(logText: string): string[] {
  const out: string[] = [];
  for (const raw of String(logText ?? "").split("\n")) {
    const m = /AssertionError(?:\s*\[[^\]]*\])?:\s*(.+)$/.exec(raw);
    if (!m) continue;
    const sig = normalizeAssertionSignature(m[1]);
    // 退化签名（折叠后**除占位符外**一个字母都不剩，如 `1 !== 2` ⇒ `<n> !== <n>`）不当作身份：它在
    // 不同缺陷间恒等 ⇒ 留下它等于制造假豁免。⚠️ 判据必须先把占位符形态**泛型**剥掉再找字母——
    // `<n>` 自己含字母 `n`，不剥就会把退化签名误判成合格（本轮实测踩到过）。
    if (!sig || !/\p{L}/u.test(sig.replace(/<[a-z]+>/g, ""))) continue;
    if (!out.includes(sig)) out.push(sig);
  }
  return out;
}

/** 窗口内全部 suite-red exited-not-landed 尝试（跨任务，⛔ 非 per-task）。读 WORKER_OUTCOME_REL 一次，
 *  对每条 final_state=exited-not-landed ∧ mechanical_fan_in.step=suite ∧ ts 落在 [nowMs-windowMs, nowMs]
 *  的记录，投影出 (taskId, ts, suiteLog 绝对路径, 写入时留存的签名)。读失败 / 无记录 ⇒ []（读不懂 ≠
 *  无失败——空清单与「无记录」同形，豁免判定据此保守回退，⛔ 不伪造成「无复发」）。
 *
 *  `suiteSignatures` / `suiteSignaturesRecorded` 是**耐久证据面**（gap-unrelated-suite-red-exemption-
 *  unreachable）：签名由 `withRecordedSuiteSignatures` 在**写这条记录的那一刻**从 suite 日志抽出并落盘，
 *  复发判定此后只消费这里，⛔ 不再事后 `readFileSync(mfi.suiteLog)`——那些日志在任务落地时会被
 *  `pruneTaskSuiteLogs` 删掉（`worker-fan-in.ts:1628`），事后读它等于让判词取决于无关第三方任务的存活。
 *  三态可区分（硬规则 3b）：
 *    - `suiteSignaturesRecorded=true`  ∧ 数组（可能是 `[]`）⇒ 读了、这是当时的签名全集
 *    - `suiteSignaturesRecorded=false` ∧ `null` ⇒ 这条记录**没留下**证据（旧记录无该字段 / 写入时日志读不出）
 *    - 两者对复发判定同义（不贡献证据），但记录面可区分「查过没有」与「没查成」。 */
export function suiteRedAttemptsInWindow(
  root: string,
  windowMs: number,
  nowMs: number = Date.now(),
): Array<{ taskId: string; ts: string; suiteLog: string | null; suiteSignatures: string[] | null; suiteSignaturesRecorded: boolean }> {
  let text: string;
  try {
    text = fs.readFileSync(path.join(root, WORKER_OUTCOME_REL), "utf8");
  } catch {
    return [];
  }
  const floor = nowMs - windowMs;
  const out: Array<{ taskId: string; ts: string; suiteLog: string | null; suiteSignatures: string[] | null; suiteSignaturesRecorded: boolean }> = [];
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
    // 写入时留存的签名（⛔ 不在此处读日志——那正是本任务修掉的缺陷）。非数组（含 `null` = 写入时读
    // 不出、或字段缺失 = 旧记录）⇒ 不贡献证据，且 `suiteSignaturesRecorded=false` 如实标出。
    const rawSigs = (mfi as { suiteSignatures?: unknown }).suiteSignatures;
    const suiteSignatures = Array.isArray(rawSigs)
      ? rawSigs.filter((s): s is string => typeof s === "string")
      : null;
    out.push({ taskId: rec.task, ts: rec.ts, suiteLog, suiteSignatures, suiteSignaturesRecorded: Array.isArray(rawSigs) });
  }
  return out;
}

/** 签名跨任务复发：窗口内命中 `signatures` 任一签名的【其它】不同任务 id 并集（⛔ 不含当前任务自身——
 *  「≥2 个不同任务命中同一签名」= 当前任务 + ≥1 其它任务）。
 *
 *  ⛔ **不读任何日志**（gap-unrelated-suite-red-exemption-unreachable 的修法核心）：证据只取
 *  `suiteRedAttemptsInWindow` 投影出的**记录内留存签名**。旧实现在这里 `fs.readFileSync(a.suiteLog)`，
 *  而那些日志在任务落地时被 `pruneTaskSuiteLogs` 删掉 ⇒ 同一个任务、同一份 suite 日志，判词取决于
 *  **无关第三方任务**是否恰好已落地（实测两读：日志在 ⇒ unrelated-flaky-exempt；日志没了 ⇒
 *  own-defect-counted）。记录是 append-only、不轮转的 ⇒ 判定从此只依赖耐久载体，同一输入恒同判词。
 *
 *  计数随结果一并返回，供判词如实报出**证据基础**（硬规则 3b：`own-defect-counted` 有两种成因——
 *  「查过、确实没复发」与「窗口里根本没有带签名的记录可查」，必须在读数上可区分，⛔ 不得同形）。
 *  两者对**动作**同义（fail-closed 照常计数），故不新设 verdict。 */
function recurringSignatureTasks(
  root: string,
  signatures: string[],
  currentTaskId: string,
  windowMs: number,
  nowMs: number,
): { tasks: string[]; otherAttempts: number; evaluated: number } {
  const sigTasks = new Map<string, Set<string>>();
  let otherAttempts = 0;
  let evaluated = 0;
  for (const a of suiteRedAttemptsInWindow(root, windowMs, nowMs)) {
    if (a.taskId === currentTaskId) continue;
    otherAttempts += 1;
    // 没留下签名的记录（旧记录 / 写入时读不出）**不贡献证据**——⛔ 不回头读它的日志补齐。
    if (!a.suiteSignaturesRecorded || a.suiteSignatures === null) continue;
    evaluated += 1;
    for (const sig of a.suiteSignatures) {
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
  return { tasks: [...tasks], otherAttempts, evaluated };
}

/** 把本次 suite-red 的断言签名**随 outcome 记录一起留存**（gap-unrelated-suite-red-exemption-unreachable
 *  的写入侧半边；读取侧见 `suiteRedAttemptsInWindow` / `recurringSignatureTasks`）。
 *
 *  WHY 必须在**写入那一刻**抽出：日志是**易失**的（落地即被 `pruneTaskSuiteLogs` 删），记录是**耐久**的
 *  （append-only、不轮转）。把易失量在耐久载体里固化一次，是把「事后重读易失物」换成「读当时的读数」的
 *  唯一办法——⛔ 不是「多读一次日志」，而是**换证据来源**。
 *
 *  三态写入（硬规则 3b，⛔ 不与「读了但没有签名」同形）：
 *    - 非 suite-red（`step !== "suite"` / 无 `suiteLog`）⇒ **不加字段**（不适用，⛔ 不是「读了没有」）
 *    - 有 `suiteLog` 但读不出 ⇒ `suiteSignatures: null`（如实记「这次没留下」）
 *    - 读出 ⇒ `suiteSignatures: string[]`（可能是 `[]` = 读了、日志里确实没有断言签名）
 *  返回值是**新对象**（⛔ 不改调用方持有的 `mfi`——同一对象可能在别处还要用）。 */
export function withRecordedSuiteSignatures<T extends { step?: unknown; suiteLog?: unknown }>(
  root: string,
  mfi: T,
): T & { suiteSignatures?: string[] | null } {
  if (mfi.step !== "suite") return mfi;
  const basename = mfi.suiteLog;
  if (typeof basename !== "string" || !basename) return mfi;
  try {
    return { ...mfi, suiteSignatures: assertionSignaturesFromSuiteLog(fs.readFileSync(path.join(root, ".quay", basename), "utf8")) };
  } catch {
    return { ...mfi, suiteSignatures: null };
  }
}

/** 静态相位红的归因核（AC2/AC3）。检查两类被指名对象是否落在本任务 Touches/diff 内：
 *    ① `STATIC_CHECK_FAILED: <name>` 点名的 checker（按 stem 比 delta 的 basename）
 *    ② 失败块内指名的 artifact token（整条路径 / basename / 扩展名孪生）
 *  任一命中 ⇒ `static-phase-attributed`（本任务可修的实现缺陷，走既有重试上限路径，⛔ 不再被报成
 *  「infra/contract suspected, not an implementable defect」）。
 *  一个都不命中 ⇒ 仍回 insufficient-data-fallback（**走既有不相关路径**，AC3② 的负控制半边），但判词
 *  必须如实报出【静态相位读到了什么】——点名了哪些 checker/文件、且都不在本任务 delta 内。旧措辞
 *  （`0 of 0 failing lines`）在静态相位红上等于说「日志里什么都没有」，那是假话（硬规则 3b）。
 *  delta 读不懂（Touches 缺失/任务文件不在）⇒ 同样 fail-closed 回退，⛔ 不伪造成归因不上。 */
function judgeStaticPhaseAttribution(
  root: string,
  taskId: string,
  sp: StaticPhaseFailureParse,
  note: { staticPhaseRed: boolean; staticPhaseCheckers: string[]; staticPhaseNamedFiles: string[] },
): RetryExemptionJudgment {
  const base = { failingTestFiles: [] as string[], signatures: [] as string[], recurredTasks: [] as string[], ...note };
  const delta = computeDeltaPaths(root, taskId);
  if (delta === null) {
    return {
      verdict: "insufficient-data-fallback",
      reason: `static phase red but this task's Touches/diff is unreadable (cannot attribute)${staticPhaseDetail(sp)}`,
      ...base,
    };
  }
  const named: Array<{ token: string; origin: string }> = [
    ...sp.failedCheckers.map((c) => ({ token: c, origin: "STATIC_CHECK_FAILED" })),
    ...sp.namedArtifacts.map((t) => ({ token: t, origin: "failure-detail" })),
  ];
  const hit = named.find((n) => namedArtifactHitsDelta(n.token, delta));
  if (hit) {
    return {
      verdict: "static-phase-attributed",
      reason: `static phase red names ${hit.token} (${hit.origin}), which is in this task's Touches/diff (own defect)`,
      ...base,
    };
  }
  return {
    verdict: "insufficient-data-fallback",
    reason:
      `static phase red named ${named.length} artifact(s) and none is in this task's Touches/diff ` +
      `(no attribution to this task)${staticPhaseDetail(sp)}`,
    ...base,
  };
}

/** 静态相位判词的「读到了什么」半边：点名了哪些 checker / 哪些文件（截断到前 5 条，⛔ 与「什么都没读到」区分）。 */
function staticPhaseDetail(sp: StaticPhaseFailureParse): string {
  const parts: string[] = [];
  if (sp.failedCheckers.length) parts.push(`checkers: ${sp.failedCheckers.slice(0, 5).join(", ")}`);
  if (sp.namedArtifacts.length) parts.push(`named files: ${sp.namedArtifacts.slice(0, 5).join(", ")}`);
  return parts.length ? `; ${parts.join("; ")}` : "";
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
  const parsed = parseSuiteLogFailures(logText, root);
  const parseNote = {
    suiteFailingLines: parsed.failingLines,
    suiteUnclassified: parsed.unclassified,
    suitePseudoStages: parsed.pseudoStages,
  };
  const failingTestFiles = parsed.files;
  // 静态相位红：日志里【没有】失败测试行（`# tests 0`），真因在 STATIC_CHECK_FAILED / 失败块里。
  // ⇒ 走静态相位归因（旧实现对它恒返 insufficient-data-fallback，判词与真因完全不符）。
  const staticPhase = parseStaticCheckFailures(logText);
  const staticNote = {
    staticPhaseRed: staticPhase.staticPhaseRed,
    staticPhaseCheckers: staticPhase.failedCheckers,
    staticPhaseNamedFiles: staticPhase.namedArtifacts,
  };
  if (failingTestFiles.length === 0 && staticPhase.staticPhaseRed) {
    return judgeStaticPhaseAttribution(root, taskId, staticPhase, staticNote);
  }
  if (failingTestFiles.length === 0) {
    // ⛔ 判词不得写成肯定断言（旧措辞「没有 worker 能修的东西」——依据只是「解析器没读懂」，硬规则 3b）。
    // 只报可核的读数：解析器读到 N 行失败、0 行归因到文件。`0 of N` 与 `0 of 0` 是两种不同的实况。
    const detail = suiteTokenDetail(parsed.pseudoStages, parsed.unclassified);
    return {
      verdict: "insufficient-data-fallback",
      reason: `no failing test file extracted from the suite log (parser extracted 0 of ${parsed.failingLines} failing lines${detail})`,
      failingTestFiles: [],
      signatures: [],
      recurredTasks: [],
      ...parseNote,
    };
  }
  const signatures = assertionSignaturesFromSuiteLog(logText);
  if (signatures.length === 0) {
    return { verdict: "insufficient-data-fallback", reason: "no assertion signature extracted from the suite log", failingTestFiles, signatures: [], recurredTasks: [], ...parseNote };
  }
  // ① 失败测试文件与任务 Touches/diff 交集——任一命中 ⇒ 任务自身缺陷，照常计数（AC2 防滥用负控制）。
  const delta = computeDeltaPaths(root, taskId);
  if (delta === null) {
    return { verdict: "insufficient-data-fallback", reason: "unable to read this task's Touches/diff (delta unreadable)", failingTestFiles, signatures, recurredTasks: [], ...parseNote };
  }
  for (const rel of failingTestFiles) {
    const d = classifyDeltaRelatedness(rel, delta, directImportRels(root, rel));
    if (d.verdict === "related") {
      return { verdict: "own-defect-counted", reason: `failing test ${rel} is in this task's Touches/diff (own defect)`, failingTestFiles, signatures, recurredTasks: [] };
    }
    if (d.verdict === "unknown") {
      return { verdict: "insufficient-data-fallback", reason: `unable to determine relatedness of failing test ${rel}`, failingTestFiles, signatures, recurredTasks: [], ...parseNote };
    }
  }
  // ② 全部失败测试文件与本任务无关 ⇒ 查签名跨任务复发（证据 = 记录内留存签名，⛔ 不事后读日志）。
  const recurrence = recurringSignatureTasks(root, signatures, taskId, windowMs, nowMs);
  if (recurrence.tasks.length >= 1) {
    return { verdict: "unrelated-flaky-exempt", reason: `signature(s) ${signatures.join("; ")} recurred across ≥2 distinct tasks in window (other: ${recurrence.tasks.join(", ")})`, failingTestFiles, signatures, recurredTasks: recurrence.tasks };
  }
  // 判词的证据基础必须可区分两种成因（硬规则 3b）：①查过 N 条带签名的记录、确实没复发；②窗口里
  // 压根没有带签名的记录可查（旧记录 / 写入时读不出）。两者动作同义（照常计数），但读数不得同形。
  const evidence = recurrence.otherAttempts === 0
    ? "no other suite-red attempt in window to compare against"
    : recurrence.evaluated === 0
      ? `${recurrence.otherAttempts} other suite-red attempt(s) in window, none carried a recorded signature (legacy/pre-recording) — recurrence unevaluable, not evaluated-and-negative`
      : `${recurrence.otherAttempts} other suite-red attempt(s) in window, ${recurrence.evaluated} carried recorded signatures and none matched`;
  return { verdict: "own-defect-counted", reason: `failing tests unrelated to this task's delta, but the assertion signature did not recur across ≥2 distinct tasks in the window (fail-closed count; ${evidence})`, failingTestFiles, signatures, recurredTasks: [] };
}

// ── gap-fan-in-suite-red-with-no-attributable-test-still-redispatches-worker ─────────────────────────
// 缺陷：`insufficient-data-fallback`（suite 红但归因不出任何失败测试文件）与「已归因的实现缺陷」
// 走【同一条】重派路径 ⇒ 每轮烧一个完整 claude 会话，而那份日志里没有 worker 能修的东西（真因是
// suite 调用契约/基建，不是被测代码）。实测（本仓库 worker-round.jsonl 全量 291 条判定）：
// insufficient-data-fallback 占 127 条（44%）——接近一半的 suite-red 重试走的是这条路径。
// 这与硬规则 3b 同源、方向相反：一个【读不懂】的状态（判不出归因）不得触发与「已读懂且判为
// 实现缺陷」相同的动作。driver 在【读数】上是诚实的，坏在【动作】没有跟着读数分叉。
// ⇒ 终态两条判据（都指向「停」，但取值可区分）：
//   ① 同一任务的连续两轮 suite 日志【内容哈希相同】⇒ 重试不可能改变结果（比任何启发式都硬）。
//   ② 其余「归因不出」情形允许【至多一次】重试；第二次仍归因不出 ⇒ 停（⛔ 不再撞到重试上限）。
// 停在【任务级 needs-human 终态】（⛔ 不是静默丢弃）：理由落 ## Needs-Human + round 记录（机械可读）。
// ⛔ 与既有 verdict 语义不冲突：预算照扣（照常计数，⛔ 不因判不出而放行），只是不再拿新会话撞墙。

/** 一次 exited-not-landed 的【后续动作】判定（AC3：读数 ⇒ 动作分叉，⛔ 两 verdict 不共用重派分支）。
 *  kind 是【可区分取值】而不是布尔：`count-and-retry`（走既有重试上限路径）与 `stop-terminal`
 *  （立即停 + 标 needs-human）在记录里可区分，且调用点按 kind 分叉走【不同】分支。 */
export type ExitedNotLandedDecision =
  | { kind: "count-and-retry"; verdict: RetryExemptionVerdict; reason: string; suiteLogHash: string | null }
  | { kind: "stop-terminal"; verdict: RetryExemptionVerdict; reason: string; suiteLogHash: string | null };

/** 从一条 outcome 记录投影 suite 日志 basename（mechanical_fan_in.suiteLog）。缺失 / 读不懂 ⇒ null
 *  （缺值 = 未查，硬规则 6——⛔ 不与「日志为空」同形）。 */
export function suiteLogBasenameFromOutcome(outcome: unknown): string | null {
  const mfi = (outcome && typeof outcome === "object")
    ? (outcome as { mechanical_fan_in?: unknown }).mechanical_fan_in
    : undefined;
  if (!mfi || typeof mfi !== "object") return null;
  const b = (mfi as { suiteLog?: unknown }).suiteLog;
  return typeof b === "string" && b ? b : null;
}

/** suite 日志【内容】的 sha256（十六进制）。读不出 ⇒ null（⛔ 不返回空串/零哈希——那会把「读不到」
 *  伪装成「与另一份读不到的相同」，硬规则 3b）。 */
export function suiteLogContentHash(root: string, suiteLogBasename: string | null): string | null {
  if (!suiteLogBasename) return null;
  try {
    const text = fs.readFileSync(path.join(root, ".quay", suiteLogBasename), "utf8");
    return createHash("sha256").update(text).digest("hex");
  } catch {
    return null;
  }
}

/** 本任务在窗口内的历次 exited-not-landed 原始记录（含 mechanical_fan_in），供【重放历次判定】用——
 *  worker-outcome.jsonl 只记结构化失败步、⛔ 不记当轮 verdict ⇒ 复用同一 judgeRetryExemption 重算，
 *  ⛔ 不新造第二份分类器（硬规则 5b：同一判定只有一份实现）。窗口外的历史不入（48h 前的一次失败
 *  不该让今天的新失败直接停）。读不出文件 ⇒ []（保守回退「无历史」⇒ 至多一次重试，⛔ 不伪造历史）。 */
export function exitedNotLandedRecordsForTask(
  root: string,
  taskId: string,
  windowMs: number,
  nowMs: number,
): unknown[] {
  let text: string;
  try {
    text = fs.readFileSync(path.join(root, WORKER_OUTCOME_REL), "utf8");
  } catch {
    return [];
  }
  const floor = nowMs - windowMs;
  const out: unknown[] = [];
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let rec: { task?: unknown; final_state?: unknown; ts?: unknown };
    try {
      rec = JSON.parse(trimmed);
    } catch {
      continue;
    }
    if (rec.task !== taskId || rec.final_state !== "exited-not-landed") continue;
    if (typeof rec.ts !== "string") continue;
    const tsMs = Date.parse(rec.ts);
    if (!Number.isFinite(tsMs) || tsMs < floor || tsMs > nowMs) continue;
    out.push(rec);
  }
  return out;
}

/** 本任务【当前尝试之前】的、且当时也归因不出的历次尝试（窗口内）。返回每条的 suite 日志内容哈希
 *  （读不出 ⇒ null）。当前尝试自身按 ts 严格小于排除——ts 不可解析 ⇒ 返回 []（⛔ 分不清先后时
 *  不把当前尝试算成自己的历史：那会让【第一次】失败就被判「重试无效」）。 */
function unattributablePriorAttempts(
  root: string,
  taskId: string,
  currentOutcome: unknown,
  windowMs: number,
  nowMs: number,
): Array<{ tsMs: number; hash: string | null }> {
  const currentTsRaw = currentOutcome && typeof currentOutcome === "object"
    ? (currentOutcome as { ts?: unknown }).ts
    : undefined;
  const currentTsMs = typeof currentTsRaw === "string" ? Date.parse(currentTsRaw) : NaN;
  if (!Number.isFinite(currentTsMs)) return [];
  const out: Array<{ tsMs: number; hash: string | null }> = [];
  for (const rec of exitedNotLandedRecordsForTask(root, taskId, windowMs, nowMs)) {
    const tsMs = Date.parse(String((rec as { ts?: unknown }).ts));
    if (!Number.isFinite(tsMs) || tsMs >= currentTsMs) continue;
    const prior = judgeRetryExemption(root, taskId, rec, { windowMs, nowMs });
    if (prior.verdict !== "insufficient-data-fallback") continue;
    out.push({ tsMs, hash: suiteLogContentHash(root, suiteLogBasenameFromOutcome(rec)) });
  }
  return out;
}

/** stop-terminal 判词的归因依据。⛔ 只说【解析器读到了什么】，不做「日志里没有 worker 能修的东西」这类
 *  肯定断言——那句话的依据只是「解析器没读懂」（硬规则 3b：读不懂 ⇒ 伪装成判定）。N 是解析器读到的失败
 *  行数：`0 of N`（N>0）说明日志里有失败行却一行也没归因出；`0 of 0` 说明连失败行形态都没有。 */
function suiteAttributionEvidence(exemption: RetryExemptionJudgment): string {
  const n = exemption.suiteFailingLines;
  const base = typeof n === "number"
    ? `parser extracted 0 of ${n} failing lines and attributed none to a file`
    : "parser attributed no failing file (failure-line count unavailable on this judgment)";
  return `${base}${suiteTokenDetail(exemption.suitePseudoStages ?? [], exemption.suiteUnclassified ?? [])}`;
}

/** 后续动作判定（纯结构性、不写盘、不调 LLM）。输入 = 本轮 judgeRetryExemption 的判定；输出 =
 *  「照常计数重派」还是「立即停 + 标 needs-human」。⛔ 不重写既有重试上限逻辑：`count-and-retry`
 *  的诊断与计数仍由 onWorkerFinished 的 advanceRetryCap 路径负责，本函数只回答【该不该再拿一个
 *  worker 会话去撞同一堵墙】。 */
export function decideExitedNotLandedAction(
  root: string,
  taskId: string,
  outcome: unknown,
  exemption: RetryExemptionJudgment,
  opts: { windowMs?: number; nowMs?: number } = {},
): ExitedNotLandedDecision {
  // 非「归因不出」的 verdict（已归因的实现缺陷 / 判为无关 flaky）⇒ 动作不变（既有路径，⛔ 本改动
  // 不掐死正常重试——AC2 的双向控制半边）。
  if (exemption.verdict !== "insufficient-data-fallback") {
    return {
      kind: "count-and-retry",
      verdict: exemption.verdict,
      // AC4（gap-suite-red-attribution-blind-to-static-phase）：判词必须带上【归因到什么】——静态相位红
      // 上旧的终局判词是「infra/contract suspected, not an implementable defect（日志里没有 worker 能修
      // 的东西）」，而真因恰恰是日志点名的、本任务 delta 内的文件（真话在日志里，判词在说反话）。
      reason:
        `failure was attributed (${exemption.verdict}) — the existing retry-cap path applies` +
        (exemption.verdict === "static-phase-attributed" ? `: ${exemption.reason}` : ""),
      suiteLogHash: null,
    };
  }
  const windowMs = opts.windowMs ?? RETRY_EXEMPTION_WINDOW_MS_DEFAULT;
  const nowMs = opts.nowMs ?? Date.now();
  const currentHash = suiteLogContentHash(root, suiteLogBasenameFromOutcome(outcome));
  const priors = unattributablePriorAttempts(root, taskId, outcome, windowMs, nowMs);
  // ① 相同日志内容 ⇒ 重试不可能改变结果（最硬的那条：内容相等是【可复现】的直接证据，不是启发式）。
  if (currentHash !== null && priors.some((p) => p.hash === currentHash)) {
    return {
      kind: "stop-terminal",
      verdict: exemption.verdict,
      suiteLogHash: currentHash,
      reason:
        `suite log content is byte-identical to a prior unattributable round for this task ` +
        `(sha256 ${currentHash.slice(0, 12)}…) — a retry provably cannot change the result`,
    };
  }
  // ② 归因不出的情形只给【至多一次】重试：第二次仍归因不出 ⇒ 停（⛔ 不再撞到 3 次重试上限，
  //    每多一次都是整整一个 claude 会话，而成功率为零）。
  if (priors.length >= 1) {
    return {
      kind: "stop-terminal",
      verdict: exemption.verdict,
      suiteLogHash: currentHash,
      reason:
        `suite red could not be attributed to any failing test file in ${priors.length + 1} consecutive ` +
        `rounds (bounded to at most one retry) — infra/contract suspected, not an implementable defect ` +
        `(${suiteAttributionEvidence(exemption)}); stopping instead of spending another worker session`,
    };
  }
  return {
    kind: "count-and-retry",
    verdict: exemption.verdict,
    suiteLogHash: currentHash,
    reason: "first unattributable suite red for this task — one bounded retry allowed (a transient cause is still possible)",
  };
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

/** 是否「快速死亡」：终态属快速死亡类 ∧ 墙钟 < quickDeathMs。
 *  liveness（可选）：孤儿 finalize 的 /proc 存活实测取值。⛔ 只有【测到已退出】("exited") 才算死亡；
 *  "unknown"（没测成）与 "alive"（worker 还活着）都不是测量出来的死亡 ⇒ ⛔ 不烧重试预算
 *  （硬规则 4：一个没测量出来的死亡不是测量；硬规则 3：三个取值不得两两同形）。
 *  缺省 undefined = 无该字段（普通 worker 终态）⇒ 沿用原有语义，⛔ 行为不变。 */
export function isQuickDeath(
  finalState: string,
  wallClockMs: number,
  cfg: QuickDeathBackoffConfig = QUICK_DEATH_BACKOFF_DEFAULT,
  liveness: OrphanPidLiveness | null | undefined = undefined,
): boolean {
  if (liveness === "unknown" || liveness === "alive") return false;
  return QUICK_DEATH_FINAL_STATES.has(finalState) && wallClockMs < cfg.quickDeathMs;
}

// ── 快速死亡【成因】分类（gap-worker-driver-counts-transient-rate-limit-as-fast-death-and-parks-task-needs-human）
// 根因：上面的快速死亡退避把【一切】<quickDeathMs 的非零退出计入同一个桶（QUICK_DEATH_FINAL_STATES），
//   连续 ≥backoffMaxRetries 次即标 needs-human 终态。但账号级限流在【性质上不同】：瞬时的、外部的、
//   自愈的，且错误文本自带失效时刻。它被计入同一个桶 ⇒ 任务被永久停摆（终态不自愈），而真相是「等一会儿」。
// 实测（2026-09-13，第三方项目 quay-fleet，第一手载体 .quay/worker-outcome.jsonl）：连续三条记录的
//   selector_reason 逐字相同——`selector worker returned no valid pick (exit 1, got "You've hit your
//   session limit · resets 11:30am (UTC)"); fallback to first shuffled candidate`，对应 wall_clock_ms =
//   4643 / 7685 / 5106（三次都 <60s ⇒ 三次都计入上限）⇒ 任务 fleet-agent-sessions-screen-endpoint 被机械
//   翻 needs-human，成因类记成 human-adjudication（"需要人裁决"，而真相是"等 17 分钟"）。
//   ⚠️ 这段是 2026-09-13 的事实记录：其中的「成因类」字段已于 2026-09-20 整套退役
//   （gap-retire-needs-human-cause-enumeration）——本分类器（下面的 classifyQuickDeathCause）保留，
//   它只决定重试计数与注记文字，⛔ 不再是任何 frontmatter 字段。
// ⛔ 关键点：driver 【已经握着能区分的证据】——限流原文完整落在 selector_reason 字段里并落了盘。
//   不是"看不出来"，是"看出来了但不分类"。
// 判据来源（⛔ 不新增探测面、⛔ 不做语义判断）：只用 driver 已捕获的 selector_reason 文本做【字面子串】
//   匹配（硬规则 2 按位置判定；硬规则 3 枚举不布尔；硬规则 3b 三个取值两两不同形）。
// 负控制（也解释它为何一直没被发现）：quay 自己的 .quay/worker-outcome.jsonl 实测 1889 条记录、含
//   "session limit" 的 0 条——quay 的 worker 经 ANTHROPIC_DEFAULT_*_MODEL 走别的后端，不消耗 Anthropic
//   账号额度 ⇒ 本缺陷只在 worker 使用 Anthropic 账号的第三方项目上暴露，本仓库的生产数据不会自然产生样本。

/** 快速死亡成因（可枚举四态，两两不同形）：
 *   - "environment-fatal"：命中【环境级】签名（模型名/密钥/launcher/网关不可用，见 driver-runtime.ts 的
 *     ENVIRONMENT_FATAL_SIGNATURES），或窗口内 ≥2 个【不同任务】以同一签名快速死亡 ⇒ 这是【所有 worker
 *     必然同样失败】的环境故障，⛔ 不是任务自身缺陷：动作是 **driver 自己 halt**（写控制态 halted），
 *     ⛔ 不翻转任何任务状态、⛔ 不计入任务的快速死亡计数
 *     （gap-worker-quick-death-environment-fatal-halts-driver；生产实例 claudecodeui 2026-09-20）。
 *   - "transient-external"：已捕获的文本命中【账号级限流/配额】签名 ⇒ 瞬时、外部、自愈 ⇒
 *     ⛔ 不计入 backoffMaxRetries 连续计数（否则终态停摆，正是本缺陷），改为退避重试。
 *   - "ordinary"：文本【读得懂】且不命中 ⇒ 普通快速死亡 ⇒ 沿用既有语义（计入连续计数，到上限转 needs-human）。
 *   - "unclassifiable"：文本缺失/读不懂（两个判定面都是 null / 非字符串 / 全空白）⇒ 第三个取值。⛔ 既不
 *     与 "transient-external" 同形（那会把读不懂静默当成自愈、让它无限重派），也不与 "ordinary" 同形
 *     （那会把读不懂静默当成任务自身缺陷）。判别式上按 ordinary 计（fail-safe 不无限重派），
 *     但【取值本身】可区分——这正是硬规则 3b：读不懂不得与任一合格态同形。 */
export type QuickDeathCause = "environment-fatal" | "transient-external" | "ordinary" | "unclassifiable";

/** 账号级限流/配额签名（【字面子串】，大小写归一后匹配；⛔ 无语义判断、⛔ 不调模型、⛔ 不新增探测面）。
 *  以 2026-09-13 quay-fleet 第一手样本 "You've hit your session limit · resets 11:30am (UTC)" 为准，
 *  并覆盖同族（API 速率限制 / 配额耗尽）的常见字面形态。⛔ 宁窄勿宽：每多一条签名，就多一条它能取假
 *  的反例要举（本条的反例 = "worker exited with code 1" 不命中）。 */
const TRANSIENT_EXTERNAL_SIGNATURES: readonly string[] = [
  "session limit", // 实测：You've hit your session limit · resets 11:30am (UTC)
  "rate limit",
  "rate_limit",
  "usage limit",
  "quota exceeded",
  "exceeded your current quota",
  "too many requests",
];

/** worker stderr 尾部捕获上限（字节）。⛔ 只留【末尾】——错误分类要的是最后一条致命错的原文，不是
 *  整段日志（几百 MB 的构建输出里翻签名会让判定面变成第二个日志存储）。机制常量，⛔ 不读宿主规格。 */
export const WORKER_STDERR_TAIL_MAX_BYTES = 4096;

/** 跨任务关联窗口（ms）：同一签名在【不同任务】上出现的最小时间跨度内 ⇒ 判 environment-fatal。
 *  机制常量（与 quickDeathMs 同族：观测到的「同一轮派发窗口」量级），⛔ 不是宿主规格阈值。 */
export const ENV_FATAL_FANOUT_WINDOW_MS = 600_000;

/** 一次分类的完整结果（硬规则 3：枚举，不布尔——`signature`/`evidence` 取 null 表示【没命中】，
 *  ⛔ 不与「命中某条」共用取值）。 */
export interface QuickDeathClassification {
  cause: QuickDeathCause;
  /** 命中的环境级签名名；⛔ null = 未命中（≠ 命中了某条）。 */
  signature: string | null;
  /** 判定所依据的【原文摘录】（停机原因里要附的「签名原文」）；⛔ null = 无依据可摘。 */
  evidence: string | null;
}

/** 两个判定面（selector_reason 与 worker stderr 尾部）里，哪一处【读得懂】：非空字符串。
 *  ⛔ 读不懂的输入不参与匹配，但它的存在也不能让整体判成「读不懂」（另一个面可能读得懂）。 */
function readableTexts(...inputs: Array<string | null | undefined>): string[] {
  return inputs.filter((t): t is string => typeof t === "string" && t.trim().length > 0);
}

/** 快速死亡成因分类（纯函数，判定面 = selector_reason + worker stderr 尾部）。
 *  只对 driver 已捕获的文本做【字面】匹配（硬规则 2 按位置判定）——⛔ 不读文件、⛔ 不看进程、⛔ 不调模型。
 *  优先级：环境级签名 ⇒ environment-fatal（停 driver 是最保守动作，故先判）> 限流类 ⇒ transient-external
 *  > 其余 ⇒ ordinary。
 *  输入【两个面都】读不懂（null / 非字符串 / 全空白）⇒ "unclassifiable"（⛔ 不与任一合格态同形，硬规则 3b）；
 *  只要有一面读得懂，结论就是读得懂的那一面的结论。
 *  环境级匹配走 `matchEnvironmentFatalSignature`（driver-runtime.ts 的单一真相源——启动冒烟用的是同一份
 *  清单，⛔ 不在此另写一份）。 */
export function classifyQuickDeathEvidence(
  selectorReason: string | null | undefined,
  stderrTail: string | null | undefined = undefined,
): QuickDeathClassification {
  const texts = readableTexts(selectorReason, stderrTail);
  if (texts.length === 0) return { cause: "unclassifiable", signature: null, evidence: null };
  for (const text of texts) {
    const m = matchEnvironmentFatalSignature(text);
    if (m != null) return { cause: "environment-fatal", signature: m.signature, evidence: m.evidence };
  }
  for (const text of texts) {
    const lower = text.toLowerCase();
    for (const sig of TRANSIENT_EXTERNAL_SIGNATURES) {
      if (lower.includes(sig)) return { cause: "transient-external", signature: null, evidence: null };
    }
  }
  return { cause: "ordinary", signature: null, evidence: null };
}

/** 成因取值（`classifyQuickDeathEvidence` 的薄封装，保持既有调用面/返回词表不变）。 */
export function classifyQuickDeathCause(
  selectorReason: string | null | undefined,
  stderrTail: string | null | undefined = undefined,
): QuickDeathCause {
  return classifyQuickDeathEvidence(selectorReason, stderrTail).cause;
}

/** 一次快速死亡的【签名指纹】——用于跨任务关联（item 2）：窗口内 ≥2 个【不同任务】以同一签名快速死亡
 *  ⇒ 同样判 environment-fatal（即使签名不在清单里）。
 *  取末尾一行（致命错通常最后落出），归一化**复用全仓唯一的签名归一化点** `normalizeAssertionSignature`
 *  （⛔ 不手搓第二份「哪些字符算易变量」的清单：两份清单必然漂移，且 s04 的结构判据盯着这件事）。
 *  它的语义正好是本场景要的——把每次都会变的**量**（pid / 毫秒 / 端口 / 路径 / 哈希）折成占位，把**措辞**
 *  逐字保留（措辞才是身份）；跨任务比较时不同任务的 pid/路径不该把同一个错拆成不同签名。
 *  ⛔ 不额外小写化：现有签名面（retry 豁免）也不小写，且不折能让「不同大小写的两个错」保持不同 ⇒ 更窄。
 *  两面都读不懂 ⇒ null（硬规则 6：缺值 = 未查，⛔ 不伪造成某个签名——一个空指纹会让所有读不懂的快速
 *  死亡互相「关联」）。退化指纹（折叠后除占位符外一个字母都不剩，如 `1 !== 2` ⇒ `<n> !== <n>`）同判：
 *  它在不同缺陷间恒等，留下它等于把所有数字型失败互相关联（判据同 assertionSignaturesFromSuiteLog）。 */
export function quickDeathSignature(
  selectorReason: string | null | undefined,
  stderrTail: string | null | undefined = undefined,
): { fingerprint: string; raw: string } | null {
  // stderr 尾部优先（它才是 worker 的原话），selector_reason 兜底。
  const texts = readableTexts(stderrTail, selectorReason);
  if (texts.length === 0) return null;
  const lines = texts[0].split("\n").map((l) => l.trim()).filter((l) => l.length > 0);
  const raw = lines.length > 0 ? lines[lines.length - 1] : texts[0].trim();
  if (raw.length === 0) return null;
  const fingerprint = normalizeAssertionSignature(raw);
  if (fingerprint.length === 0) return null;
  // ⚠️ 必须先把占位符形态泛型剥掉再找字母——`<n>` 自己含字母 `n`（同 assertionSignaturesFromSuiteLog
  // 实测踩到过的那个坑）。
  if (!/\p{L}/u.test(fingerprint.replace(/<[a-z]+>/g, ""))) return null;
  return { fingerprint, raw: raw.slice(0, 400) };
}

/** 从已捕获文本里解析账号限流的【重置时刻】（UTC）——错误文本自带，⛔ 不猜、⛔ 不新增探测面。
 *  支持 `resets 11:30am (UTC)` / `resets 3pm (UTC)` / `resets 11:30 (UTC)`（24h）。返回 epoch ms：
 *  当天该 UTC 时刻；【已过 ⇒ 次日同时刻】（日额度重置语义，⛔ 不回退到"立刻重试"）。
 *  解析不出 ⇒ null（硬规则 6：缺值 = 未查，⛔ 不伪造成某个时刻）——调用方据此【回落指数退避】，
 *  ⛔ 不得静默当成"立刻重试"，也 ⛔ 不得静默当成 needs-human。 */
export function parseRateLimitResetAtMs(text: string | null | undefined, nowMs: number): number | null {
  if (typeof text !== "string" || text.length === 0) return null;
  const m = /\bresets?\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s*\(utc\)/i.exec(text);
  if (!m) return null;
  let hour = Number(m[1]);
  const minute = m[2] != null ? Number(m[2]) : 0;
  const meridiem = m[3] ? m[3].toLowerCase() : null;
  if (!Number.isInteger(hour) || minute > 59) return null;
  if (meridiem) {
    if (hour < 1 || hour > 12) return null;
    hour = (hour % 12) + (meridiem === "pm" ? 12 : 0);
  } else if (hour > 23) {
    return null;
  }
  const now = new Date(nowMs);
  let at = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), hour, minute, 0, 0);
  // 已过（含恰在此刻）⇒ 次日同时刻。⛔ 不返回一个已过去的时刻（那会让 isBackedOff 立刻为假 =
  // 静默退化成"立刻重试"，正是 plan item 3 禁的那一种）。
  if (at <= nowMs) at += 24 * 60 * 60 * 1000;
  return at;
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
  /** task id → 连续【普通】快速死亡次数（计入 backoffMaxRetries 上限）。 */
  counts: Map<string, number>;
  /** task id → 连续【transient-external】快速死亡次数。⛔ 与 counts 【分开】记——混在一个 Map 里会让
   *  一段限流把计数顶到上限，随后一次普通快速死亡立刻误触 needs-human（成因维度丢失）。本计数只用来
   *  驱动「解析不出重置时刻」时的指数退避回落增长。 */
  transientCounts: Map<string, number>;
  /** task id → 退避到此时刻（epoch ms）。now < until 期间不重派该 task。 */
  backoffUntil: Map<string, number>;
  /** 签名指纹 → 最近一次以该指纹快速死亡的任务与时刻（跨任务关联，item 2）。⛔ 与 counts 分开记——
   *  它记的是「这个签名见过谁」，不是「某个任务死了几次」。 */
  signatureSeen: Map<string, { task: string; atMs: number; raw: string }>;
}

/** 新建一个退避状态。 */
export function newQuickDeathBackoffState(): QuickDeathBackoffState {
  return { counts: new Map(), transientCounts: new Map(), backoffUntil: new Map(), signatureSeen: new Map() };
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
 *  @returns { quickDeath, backedOff, newlyNeedsHuman }
 *  liveness（可选）：孤儿 finalize 的 /proc 存活实测取值，语义同 isQuickDeath。实测为
 *  "unknown"/"alive" 时**不动状态**（既不 +1 也不复位）：unknown 对计数是零信息，既不该算一次死亡
 *  （那会烧预算），也不该打断一次**已测量**的连续死亡序列（那会让交错注入 unknown 洗白真实streak）。
 *  ⛔ 与「非快速死亡 ⇒ 复位」那条分支刻意不同形——硬规则 3：第三个取值不得与前两者任一同形。
 *  成因分流（gap-worker-driver-counts-transient-rate-limit-as-fast-death-and-parks-task-needs-human）：
 *    selectorReason 判为 "transient-external" ⇒ ⛔ 【不计入】state.counts（因此 ⛔ 永不 newlyNeedsHuman，
 *    终态不自愈正是本缺陷），改记 state.transientCounts 并设 backoffUntil = 文本自带的重置时刻
 *    （解析不出 ⇒ 回落指数退避，⛔ 不是"立刻重试"）。连续计数【不动】：既不 +1（那不是任务自身缺陷），
 *    也不复位（那会让交错注入的限流洗白普通连续序列）——与 liveness === "unknown" 分支同族，
 *    硬规则 3b 的第三个取值形态。
 *    selectorReason 判为 "unclassifiable" ⇒ 取值如实为 "unclassifiable"（读者可区分），判别式上按普通
 *    快速死亡计（fail-safe：读不懂不无限重派）。
 *    liveness === "unknown"/"alive" 或 非快速死亡 ⇒ 两个连续计数一并复位（「连续」断链）。
 *  环境级分流（gap-worker-quick-death-environment-fatal-halts-driver）：
 *    两个判定面（selector_reason + worker stderr 尾部）命中 environment-fatal 签名，或【窗口内 ≥2 个
 *    不同任务以同一签名快速死亡】⇒ cause = "environment-fatal"。此时**该任务的状态一个字节都不动**：
 *    ⛔ 不进 counts（计数未增加，AC2）⇒ ⛔ 永不 newlyNeedsHuman，⛔ 不设 backoffUntil（该停的是 driver，
 *    不是这一个任务——逐任务退避仍会把池子逐个 park）。停机动作由调用方按 cause 承担（写控制态 halted）。
 *  @returns { quickDeath, backedOff, newlyNeedsHuman, cause, backoffUntil, signature, evidence }
 *    cause：本次的成因取值（非快速死亡 / 未评估 ⇒ null，缺值 ≠ 某个取值，硬规则 6）。
 *    backoffUntil：本次实际设下的退避时刻（未退避 ⇒ null），供调用方/载体观测。
 *    signature / evidence：环境级命中的签名名与原文摘录（供停机原因）；未命中 ⇒ null。 */
export function recordQuickDeathBackoff(
  state: QuickDeathBackoffState,
  taskId: string,
  finalState: string,
  wallClockMs: number,
  nowMs: number,
  backoffMaxRetries: number,
  cfg: QuickDeathBackoffConfig = QUICK_DEATH_BACKOFF_DEFAULT,
  liveness: OrphanPidLiveness | null | undefined = undefined,
  selectorReason: string | null | undefined = undefined,
  stderrTail: string | null | undefined = undefined,
  envFatalWindowMs: number = ENV_FATAL_FANOUT_WINDOW_MS,
): {
  quickDeath: boolean;
  backedOff: boolean;
  newlyNeedsHuman: boolean;
  cause: QuickDeathCause | null;
  backoffUntil: number | null;
  /** 命中的环境级签名名（⛔ null = 未命中 ≠ 命中某条）；跨任务关联命中的填 `cross-task:<fingerprint>`。 */
  signature: string | null;
  /** 判定依据的原文摘录（停机原因里要附的「签名原文」）；⛔ null = 无依据。 */
  evidence: string | null;
} {
  if (liveness === "unknown" || liveness === "alive") {
    return { quickDeath: false, backedOff: false, newlyNeedsHuman: false, cause: null, backoffUntil: null, signature: null, evidence: null };
  }
  if (!isQuickDeath(finalState, wallClockMs, cfg, liveness)) {
    state.counts.delete(taskId);
    state.transientCounts.delete(taskId);
    state.backoffUntil.delete(taskId);
    return { quickDeath: false, backedOff: false, newlyNeedsHuman: false, cause: null, backoffUntil: null, signature: null, evidence: null };
  }
  const cls = classifyQuickDeathEvidence(selectorReason, stderrTail);
  if (cls.cause === "environment-fatal") {
    // 环境级故障：⛔ 不进 state.counts（⛔ 不计入任务的快速死亡计数，⛔ 永不 newlyNeedsHuman）、
    // ⛔ 不设 backoffUntil（该停的是 driver，不是这一个任务——逐任务退避仍会逐个 park 整个池子）。
    // 只记一次签名观测（供后续同签名的跨任务关联）。动作（halt driver）由调用方按 cause 承担。
    const sig = quickDeathSignature(selectorReason, stderrTail);
    if (sig != null) state.signatureSeen.set(sig.fingerprint, { task: taskId, atMs: nowMs, raw: sig.raw });
    return {
      quickDeath: true, backedOff: false, newlyNeedsHuman: false, cause: cls.cause, backoffUntil: null,
      signature: cls.signature, evidence: cls.evidence ?? sig?.raw ?? null,
    };
  }
  if (cls.cause === "transient-external") {
    const cause = cls.cause;
    // 瞬时外部（账号级限流/配额）：⛔ 不进 state.counts ⇒ ⛔ 永不 newlyNeedsHuman（终态不自愈正是本缺陷）。
    // state.counts 也【不复位】——「连续普通快速死亡」序列不被限流打断，也不被限流洗白（同 unknown 分支）。
    const tn = (state.transientCounts.get(taskId) ?? 0) + 1;
    state.transientCounts.set(taskId, tn);
    // 退避时刻优先取错误文本自带的重置时刻（已知 ⇒ 不必猜）；解析不出 ⇒ 回落指数退避（⛔ 不是"立刻重试"）。
    const until = parseRateLimitResetAtMs(selectorReason, nowMs) ?? nowMs + backoffDelayMs(tn, cfg);
    const backedOff = tn >= cfg.backoffThreshold;
    if (backedOff) state.backoffUntil.set(taskId, until);
    return { quickDeath: true, backedOff, newlyNeedsHuman: false, cause, backoffUntil: backedOff ? until : null, signature: null, evidence: null };
  }
  // ── 跨任务关联（item 2）：窗口内 ≥2 个【不同任务】以同一签名快速死亡 ⇒ 同样判 environment-fatal ──
  // 判据是「同一签名 ∧ 不同任务 ∧ 窗口内」三者同时成立（缺一不判）：同一任务重复死是任务级缺陷（本条
  // 缺陷正是把环境级故障错当任务级），没有签名（读不懂）无从关联，超过窗口就不再是「同一个环境」。
  // ⛔ 只在【不命中】环境级/限流签名时做——限流类两任务同签名是预期形态（各等各的重置时刻），把它判成
  // 环境级会让 AC1④ 的 transient-external 语义回归。⛔ 判为 environment-fatal 后【不进 counts】。
  const sig = quickDeathSignature(selectorReason, stderrTail);
  if (sig != null) {
    const prev = state.signatureSeen.get(sig.fingerprint);
    if (prev != null && prev.task !== taskId && nowMs - prev.atMs <= envFatalWindowMs) {
      state.signatureSeen.set(sig.fingerprint, { task: taskId, atMs: nowMs, raw: sig.raw });
      return {
        quickDeath: true, backedOff: false, newlyNeedsHuman: false, cause: "environment-fatal", backoffUntil: null,
        signature: `cross-task:${sig.fingerprint}`, evidence: sig.raw,
      };
    }
    state.signatureSeen.set(sig.fingerprint, { task: taskId, atMs: nowMs, raw: sig.raw });
  }
  // ordinary / unclassifiable 共用既有判别式（fail-safe：读不懂不无限重派），但 cause 取值如实可区分。
  const cause = cls.cause;
  const n = (state.counts.get(taskId) ?? 0) + 1;
  state.counts.set(taskId, n);
  if (n >= backoffMaxRetries) {
    state.backoffUntil.delete(taskId);
    return { quickDeath: true, backedOff: false, newlyNeedsHuman: true, cause, backoffUntil: null, signature: null, evidence: null };
  }
  const backedOff = n >= cfg.backoffThreshold;
  const until = backedOff ? nowMs + backoffDelayMs(n, cfg) : null;
  if (until != null) state.backoffUntil.set(taskId, until);
  return { quickDeath: true, backedOff, newlyNeedsHuman: false, cause, backoffUntil: until, signature: null, evidence: null };
}

/** environment-fatal 的 halted_by 取值（控制态里的停机主体，人/`quay driver start` 拒绝时读它）。 */
export const ENVIRONMENT_FATAL_HALTED_BY = "worker-driver:environment-fatal";

/** 停机原因文本（含【签名原文】——AC2 要求 worker-control.json 的原因里能读到它）。
 *  `backoff` 是 recordQuickDeathBackoff 的环境级返回值：signature 给出签名名（含跨任务关联的
 *  `cross-task:<指纹>` 形态），evidence 给出原文摘录。⛔ 两者缺一 ⇒ 如实写「未捕获原文」，⛔ 不编造。 */
export function environmentFatalHaltReason(backoff: {
  signature: string | null;
  evidence: string | null;
  cause: QuickDeathCause | null;
}): string {
  const sig = backoff.signature ?? "unknown";
  const ev = backoff.evidence != null && backoff.evidence.length > 0 ? backoff.evidence : "(未捕获原文)";
  return (
    `worker-driver halted: environment-fatal — 所有 worker 会以同一方式失败（不是任务自身缺陷）。` +
    `签名: ${sig}；签名原文: ${ev}。` +
    `⛔ 未翻转任何任务状态、⛔ 未计入任务的快速死亡计数。修复环境后: quay driver resume --kind worker`
  );
}

/** environment-fatal ⇒ driver 自己 halt（写 `.quay/worker-control.json` halted:true + 原因与签名原文）。
 *  语义与 `quay driver drain` 同一条路（applyHalt ⇒ 派发环 spawn 前读到 halted ⇒ 停【新】派发，
 *  ⛔ 不杀在飞 worker）。⛔ 不翻转任何任务状态——那是「任务级缺陷」的动作，本条正是要把它与环境故障
 *  分开；⛔ 也不计入快速死亡计数（调用方在 recordQuickDeathBackoff 的 environment-fatal 分支里不碰
 *  counts）。`halt_reason` 是控制态的附加字段（kernel 的 ControlState 只认 halted/halted_by/halted_at，
 *  未知键在读回时被 mergeControlState 丢弃）——它落盘供人读，⛔ 不参与任何判定。 */
export function haltForEnvironmentFatal(root: string, reason: string, nowIso = new Date().toISOString()): string {
  const { state } = readControlState(root, process.env, CONTROL_STATE_REL);
  const next: ControlState & { halt_reason: string } = {
    ...applyHalt(state, ENVIRONMENT_FATAL_HALTED_BY, true, nowIso),
    halt_reason: reason,
  };
  return writeControlState(root, next, CONTROL_STATE_REL);
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
  /** 快速死亡判定（由常驻环注入的回调产出，见 QuickDeathJudge）。⛔ 缺键 = 没注入回调（批量路径 /
   *  孤儿 adopt 路径）≠「判过且无结论」——前者由调用方自行记录，后者是 cause: null。 */
  quickDeath?: ReturnType<typeof recordQuickDeathBackoff>;
}

/** 快速死亡判定回调（常驻环注入 runOneWorker）：**判定必须在写载体【之前】发生**——否则一条真正触发
 *  environment-fatal 的记录，其载体的 `quick_death_cause` 会按【逐记录的无状态重算】写成 ordinary，
 *  于是「driver 因它而停」与「载体说它是普通死亡」并存，读载体的人看不到真因（正是本任务要修的那类
 *  「载体里出现 0 次」的证据缺口）。回调同时承担状态记账（计数/退避/签名观测），⛔ 调用方不得再记一次。 */
export type QuickDeathJudge = (
  outcome: ReturnType<typeof computeOutcome>,
  stderrTail: string | null,
) => ReturnType<typeof recordQuickDeathBackoff> | null;

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
 *  （硬规则 3b：读不懂 ≠ 无存活，但调用方按 falsy 判「已死」——方向是「少 adopt」，⛔ 不误信 pid）。
 *  读由 kernel leaf 单点实现；⛔ 保留「空 cmdline ⇒ ""」这一取值（调用方按 falsy 与 null 同判
 *  「已死」，但取值本身不同形，见 `probePidLiveness` 对同一区分的用法）。 */
export function readPidCmdline(pid: number, procDir: string = "/proc"): string | null {
  const text = readProcCmdlineText(pid, procDir);
  return text === null ? null : text.trim();
}

/** 孤儿 dispatch 分类（纯函数）：adopt（pid 存活且 cmdline 仍是本任务的 worker）/ finalize（pid 已死 /
 *  被复用）。复核用 hasLiveWorkerForTask 的词边界 cmdline 匹配（同 cold-start-inflight 交叉核对），⛔ 不
 *  裸信 pid 数字——pid 复用后指向别的进程，cmdline 不再含 <worker 名> + task id ⇒ 判 finalize。
 *  空 cmdline（僵尸已退未收尸）与读不到（null）同判「已死」。
 *  workerName：本 workspace 的 worker `-n` 名（resolveWorkerProcessName(root)），⛔ 不用写死的
 *  `quay-task-worker`——第三方项目改名后本函数会对【在飞】worker 恒判 finalize（2026-09-13 quay-fleet 实证）。 */
export function classifyOrphanDispatch(
  record: DispatchRecord,
  procDir: string = "/proc",
  workerName: string = WORKER_PROCESS_NAME,
): "adopt" | "finalize" {
  const cmdline = readPidCmdline(record.workerPid, procDir);
  if (!cmdline) return "finalize";
  return hasLiveWorkerForTask(record.taskId, [cmdline], workerName) ? "adopt" : "finalize";
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

/** 孤儿 finalize 终态 outcome（pid 已死 / 被复用 / 无法判定 / 仍在飞）。final_state=failed（非 completed），
 *  failure_reason 点名「driver 重启期间孤儿化、reconcile 发现已退出」——与存活 driver 亲眼观察到的异常死亡
 *  （"worker exited with code N" / "worker killed by SIGx"）在 reason 上可区分（AC2）。exit_code 诚实
 *  记 null（读不懂，⛔ 不伪造）。
 *
 *  🔴 2026-09-13 修复（gap-reconcile-finalizes-live-worker-as-exited-and-double-dispatches-same-task）：
 *  本函数此前**无条件**写「already exited」——那是一句【断言】，不是【测量】（硬规则 4：结构上不可能取假
 *  的量不是测量）。实测代价：quay-fleet 上它把仍在飞（/proc 可读、etime 163s、CPU 23s）的 pid 3653433
 *  写成「already exited」，随后同任务被派了第二个 worker，两个 worker 共用一份 git 检出。现在先实测
 *  /proc（probePidLiveness），三个取值产出三条**互不同形**的 reason，并把取值落进
 *  `orphan_pid_liveness` 字段（机器可读；⛔ 不让下游去正则抠中文/英文措辞）。
 *   - "exited" ：pid 确已不在 ⇒ 保留原措辞（下游/既有断言按它判读，⛔ 不改）。
 *   - "alive"  ：pid 仍在 ⇒ ⛔ 不得声称已退出；这是「finalize 本不该发生」的自证（应改走 adopt）。
 *   - "unknown"：/proc 读不到 ⇒ ⛔ 不得与上两者任一同形，明写「未测量」。
 *  另：「存活但已不是本任务的 worker」（pid 复用）仍归 "alive" 的措辞面——它确实活着，只是不是我们的；
 *  出于 AC1 的双向对照要求，任何 alive 取值都不得含 "already exited"。 */
export type OrphanPidLiveness = PidLiveness;

export function computeOrphanFinalizedOutcome(opts: {
  task: string;
  selectorReason: string;
  runId: string;
  workerPid: number;
  startedAtMs: number;
  endedAtMs: number;
  /** /proc 存活探测的测试缝（缺省 /proc）。 */
  procDir?: string;
}): ReturnType<typeof computeOutcome> & { orphan_pid_liveness: OrphanPidLiveness } {
  const liveness = probePidLiveness(opts.workerPid, opts.procDir ?? "/proc");
  const failureReason =
    liveness === "exited"
      ? `orphaned worker finalized by reconcile: driver restarted mid-flight and worker pid ${opts.workerPid} already exited (or was recycled) before a new instance could adopt it`
      : liveness === "alive"
        ? `orphaned worker finalized by reconcile: driver restarted mid-flight and worker pid ${opts.workerPid} was STILL ALIVE at the reconcile probe — its death was NOT measured; a live worker must be adopted, not finalized`
        : `orphaned worker finalized by reconcile: driver restarted mid-flight and worker pid ${opts.workerPid} liveness UNKNOWN — /proc was not readable, so its death was NOT measured and is NOT claimed`;
  return {
    ts: new Date(opts.endedAtMs).toISOString(),
    task: opts.task,
    selector_reason: opts.selectorReason,
    exit_code: null,
    signal: null,
    wall_clock_ms: opts.endedAtMs - opts.startedAtMs,
    final_state: "failed",
    failure_reason: failureReason,
    started_at: new Date(opts.startedAtMs).toISOString(),
    ended_at: new Date(opts.endedAtMs).toISOString(),
    worker_pid: opts.workerPid,
    run_id: opts.runId,
    in_flight_count: 0,
    timed_out: false,
    session_id: null,
    orphan_pid_liveness: liveness,
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

/** 孤儿 finalize（pid 已死 / 被复用 / 无法判定）：立刻补一条可区分的非 completed 终态 + 复用
 *  no-record-on-abnormal-death 的 orphan worktree 清理（cleanupOrphanWorktree）+ 清 dispatch 记录。同步、
 *  幂等。返回 outcome 供观测（resident loop 打 json 事件）。
 *
 *  🛑 存活闸（Plan 第 4 步「判为仍存活时不得 finalize」）：只要 /proc 实测该 pid **仍存活**就拒绝，
 *  ⛔ 不写假终态、⛔ 不清 worktree、⛔ 不清 dispatch 记录——原样留着让下一轮 adopt。
 *  ⚠️ 判据刻意是【与 worker 名无关的】probePidLiveness，不是 classifyOrphanDispatch：
 *  classifyOrphanDispatch 要先知道「本 workspace 的 worker 叫什么」，而名字解析失败正是本缺陷在第三方
 * 项目的成因（quay-fleet 改名 ⇒ 恒判 finalize）。用一个需要名字的判据去兜「名字可能解析错」的底，
 *  是空的——所以这里用名字无关的直接量（/proc 存在性），它不依赖任何配置即可取假。
 *  代价（已知并接受）：pid 被复用成一个长命进程时，这条记录会一直留着不 finalize（不破坏任何东西，
 *  只是残留）；等到该 pid 消失即自愈。取舍方向是「宁可留残留，⛔ 不判死活 worker」——反向的代价是
 *  删掉在飞 worker 正在写的 worktree + 清掉记录 ⇒ 同任务双派（正是本缺陷）。 */
export function finalizeOrphanDispatch(opts: {
  root: string;
  outcomeFile: string;
  record: DispatchRecord;
  /** 测试缝（缺省 /proc）。 */
  procDir?: string;
  /** 本 workspace 的 worker `-n` 名（缺省解析自 root 的 .quay/profiles.yml）。 */
  workerName?: string;
}): { outcome: ReturnType<typeof computeOutcome> & { orphan_pid_liveness: OrphanPidLiveness }; cleanup: OrphanCleanupResult | null; refusedLiveWorker: boolean } {
  const { root, outcomeFile, record } = opts;
  const procDir = opts.procDir ?? "/proc";
  const workerName = opts.workerName ?? resolveWorkerProcessName(root);
  const base = computeOrphanFinalizedOutcome({
    task: record.taskId,
    selectorReason: record.selectorReason,
    runId: record.runId,
    workerPid: record.workerPid,
    startedAtMs: record.startedAtMs,
    endedAtMs: Date.now(),
    procDir,
  });
  if (base.orphan_pid_liveness === "alive") {
    // 活着 ⇒ 不 finalize。⛔ 不 appendOutcome（那是假记录）/ 不清 worktree / 不清记录。
    return { outcome: base, cleanup: null, refusedLiveWorker: true };
  }
  // "unknown"（/proc 读不到）：留一条**不声称死亡**的记录释放掉 in-flight 影子（⛔ 不黑洞），
  // 但⛔ 不动 worktree——读不到进程表时无法证明没人在里面写（清理闸同样读不到，会误清）。
  const cleanup = base.orphan_pid_liveness === "unknown"
    ? null
    : cleanupOrphanWorktree(root, record.taskId, null, { finalState: "failed", exitCode: null }, workerName);
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
  return { outcome, cleanup, refusedLiveWorker: false };
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
  judgeQuickDeath,
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
  /** 快速死亡判定回调（常驻环注入；批量路径不注入）。见 QuickDeathJudge 的头注释——判定必须在
   *  载体落盘【之前】发生，否则跨任务关联命中的那条记录会在载体里写成 ordinary。 */
  judgeQuickDeath?: QuickDeathJudge;
}): Promise<WorkerRunResult> {
  const argv = injectSessionId ? [...workerArgv, "--session-id", sessionId] : workerArgv;
  return new Promise((resolve) => {
    const [cmd, ...cmdArgs] = argv;
    const startedAtMs = Date.now();
    let child: ReturnType<typeof spawn> | null = null;
    let spawnError: string | null = null;
    // worker stderr 尾部捕获（gap-worker-quick-death-environment-fatal-halts-driver）：旧实现
    // stdio:"inherit" 让 worker 的 stderr 直接继承 driver 的 fd ⇒ 一个字节都不进判定面（生产实例里
    // 明明打了 `model_not_found`，`.quay/worker-outcome.jsonl` 里出现 0 次）。改为 stderr 走管道：
    // 【照常转发】到 driver 的 stderr（人的可观测性不变），同时留最后 N KB 作判定面与载体字段。
    // ⛔ stdin/stdout 仍是 inherit（不改 worker 的 stdout 契约，也不缓冲它的输出）。
    let stderrTail = "";
    try {
      child = spawn(cmd, cmdArgs, { cwd: rootDir, stdio: ["inherit", "inherit", "pipe"], detached: false });
    } catch (e) {
      spawnError = e && typeof e === "object" && "message" in e ? String(e.message) : String(e);
    }
    if (child?.stderr) {
      child.stderr.on("data", (chunk: Buffer | string) => {
        const s = typeof chunk === "string" ? chunk : chunk.toString("utf8");
        try {
          process.stderr.write(s); // 照常转发——⛔ 不因新增判定面而吞掉人的可观测性
        } catch { /* 转发失败（下游关闭）不影响判定面 */ }
        stderrTail = (stderrTail + s).slice(-WORKER_STDERR_TAIL_MAX_BYTES);
      });
      // 管道读错误（child 被杀等）⇒ 保留已捕获的尾部，⛔ 不因读取异常清空判定面。
      child.stderr.on("error", () => { /* best-effort */ });
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
        // 快速死亡成因的第二个判定面 + 生产载体字段（gap-worker-quick-death-environment-fatal-halts-driver）。
        stderrTail,
      });
      // 快速死亡【判定】先于载体落盘：判定可能依赖【跨任务】状态（同一签名窗口内 ≥2 个不同任务 ⇒
      // environment-fatal），逐记录的无状态重算看不到它。就地用判定结果校准载体的 quick_death_cause，
      // ⛔ 否则会出现「driver 因这条记录而停」而「载体说它是 ordinary」的错报。
      let quickDeath: ReturnType<typeof recordQuickDeathBackoff> | null = null;
      if (judgeQuickDeath != null) {
        quickDeath = judgeQuickDeath(outcome, stderrTail.length > 0 ? stderrTail : null);
        if (quickDeath != null && quickDeath.cause != null) {
          (outcome as unknown as Record<string, unknown>).quick_death_cause = quickDeath.cause;
        }
      }
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
      // 签名在**这一刻**从 suite 日志抽出并随记录落盘（gap-unrelated-suite-red-exemption-unreachable）：
      // 此后复发判定只读记录、⛔ 不再事后读日志——日志在任务落地时会被 `pruneTaskSuiteLogs` 删掉，事后
      // 读它会让判词取决于无关第三方任务的存亡。⚠️ 这是**唯一**产出 suite-red 记录的路径（全仓
      // `mechanical_fan_in` 只在此处写），故在此富化即覆盖全部生产写入面。
      const baseOutcome = mechResult
        ? { ...outcome, mechanical_fan_in: withRecordedSuiteSignatures(rootDir, mechResult) }
        : outcome;
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
      resolve({ taskId, outcome: finalOutcome, exitCode, ...(quickDeath != null ? { quickDeath } : {}) });
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
  /** push 滞后检查的被推分支（gap-fan-in-push-silently-fails-no-detection）：缺省 = 机械 fan-in 的
   *  merge target（develop）。⛔ 不硬编码在检查器里——第三方项目的基线分支不叫 develop。 */
  pushBranch?: string;
  /** push 滞后检查的远端名；缺省 origin。 */
  pushRemote?: string;
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
  // push 滞后检查的被推分支/远端（gap-fan-in-push-silently-fails-no-detection）：缺省 = 机械 fan-in 的
  // merge target（develop）/ origin —— 该分支正是本驱动 ff 落地的那条线，也是「领先 orgin 就该推」的对象。
  const pushBranch = opts.pushBranch ?? "develop";
  const pushRemote = opts.pushRemote ?? "origin";

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
  const retryExemptions: NonNullable<Parameters<typeof computeWorkerRoundRecord>[0]["retryExemptions"]> = [];
  // 归因不出的后续动作判定（gap-fan-in-suite-red-with-no-attributable-test-still-redispatches-worker）：
  // 每轮【新】的判定结果（splice(0) 快照清空，⛔ 不跨轮累积）。kind ∈ count-and-retry / stop-terminal
  // 在 round 记录里可区分（AC3 生产载体）。
  const exitedNotLandedStops: Array<{ task: string; kind: string; verdict: string; reason: string; suiteLogHash: string | null }> = [];

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
  // 本轮 push 滞后检查读数（gap-fan-in-push-silently-fails-no-detection AC7）。⚠️ 声明在 while 之外
  // （与 coldInflight 同族）⇒ writeRound / writeErrorRound 直接从闭包读它，两处调用的签名逐字不变；
  // 每轮开头显式复位 ⇒ ⛔ 上一轮的读数不会漏进本轮（尤其不会把「上一轮跑过」伪装成本轮跑过，硬规则 3b）。
  let pushLagReading: PushLagRoundRecord | null = null;
  // 本轮 release 分支 janitor 读数（gap-ac271-finish-step-needs-self-acting-carrier）。声明位置与上面
  // pushLagReading 同族（while 之外 + 每轮开头复位）：writeRound / writeErrorRound 直接从闭包读它，
  // 且错误轮（janitor 步【之后】才抛错）也能带上「本轮真跑过」的读数（⛔ 不抹成 null = 不让「跑过」
  // 与「没跑」在错误轮上不可区分，硬规则 3b）。⛔ 缺省 null = 没跑该步 ≠ evaluated:true+branchCount:0。
  let releaseBranchJanitorResult: JanitorResult | null = null;
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
      // gap-fan-in-suite-red-with-no-attributable-test-still-redispatches-worker：本轮「归因不出」的
      // 后续动作判定（splice(0) 快照清空）。kind 可区分（count-and-retry / stop-terminal）。
      exitedNotLandedStops: exitedNotLandedStops.splice(0),
      // gap-superseded-task-residual-worktree-never-reclaimed AC7：本轮 superseded worktree 回收结果
      // （候选数 0 也记 0，⛔ 不省略——「跑过且无候选」与「没跑」可区分）。
      supersededReclaim,
      // gap-ac271-finish-step-needs-self-acting-carrier：本轮 janitor 读数（同上，枚举为空也记）。
      releaseBranchJanitor: releaseBranchJanitorResult,
      // gap-fan-in-push-silently-fails-no-detection AC7（闭包读，见 pushLagReading 的声明注释）。
      pushLag: pushLagReading,
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
      exitedNotLandedStops: [],
      // 抛错发生在 push-lag 步【之后】时，本轮确实跑过该步 ⇒ 把它带上（⛔ 不因「本轮以 error 收尾」
      // 就抹成 null——那会让「跑过且无滞后」与「没跑」在错误轮上不可区分，硬规则 3b）。
      pushLag: pushLagReading,
      // gap-ac271-finish-step-needs-self-acting-carrier：同款——janitor 步【之后】才抛错时，本轮
      // 确实跑过它 ⇒ 带上读数（⛔ 不抹成 null）。
      releaseBranchJanitor: releaseBranchJanitorResult,
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
  // AC-255（SPEC §7 阶段 C）：停机登记。anchor 请求停本 kind 时，本循环**与 mcp-halt 走同一条路**：
  // 不再起新 worker（下面的 dispatch-loop 条件），在飞全部跑完后 break（`running.length === 0` 那一支）
  // ⇒ ⛔ 不杀在飞子进程（§6.9 不变式 3，与旧 `quay driver stop` 的语义逐字相同）。
  registerKindStop("worker");

  /** 快速死亡判定闭包（注入 runOneWorker）：**唯一记账点**（计数 / 退避 / 跨任务签名观测），且必须在
   *  载体落盘【之前】跑到——跨任务关联（同一签名 + 不同任务 + 窗口内 ⇒ environment-fatal）依赖状态，
   *  逐记录的无状态重算看不到它。见 QuickDeathJudge 的头注释。 */
  const judgeQuickDeathFor = (taskId: string): QuickDeathJudge => (outcome, stderrTail) =>
    recordQuickDeathBackoff(
      backoffState, taskId, outcome.final_state, outcome.wall_clock_ms, Date.now(), maxRetries, backoffCfg,
      undefined, // 自有子进程（非孤儿 adopt）：无 /proc 存活实测取值
      (outcome as { selector_reason?: string | null }).selector_reason ?? null,
      stderrTail,
    );

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
      const needsHumanWrites: Array<{ id: string; reason: string }> = [];
      if (!isFfNotFastForwardFailure(r.outcome)) {
        // 重试上限豁免（gap-retry-cap-flip-conflates-own-defect-with-unrelated-flaky）：suite red 的失败
        // 测试文件与任务 Touches/diff 无关 ∧ 断言签名跨任务复发（≥2 不同任务）⇒ 不计入该任务自身重试
        // 计数（继续重派，⛔ 不是无条件豁免）。三态判定结果经 writeRound 落 round 记录（AC5 生产载体），
        // json 事件供测试/手动观测。判不出 ⇒ insufficient-data-fallback，照常计数（fail-closed）。
        const exemption = judgeRetryExemption(rootDir, r.taskId, r.outcome);
        retryExemptions.push({
          task: r.taskId, verdict: exemption.verdict, reason: exemption.reason,
          failingTestFiles: exemption.failingTestFiles, recurredTasks: exemption.recurredTasks,
          // 静态相位红 × 已归因 的【生产读数面】（gap-suite-red-attribution-blind-to-static-phase AC5）：
          // 点名的 checker / 文件一并入 round 记录，⛔ 不让「读到什么」只活在本轮内存里。
          staticPhaseRed: exemption.staticPhaseRed,
          staticPhaseCheckers: exemption.staticPhaseCheckers,
          staticPhaseNamedFiles: exemption.staticPhaseNamedFiles,
        });
        if (json) process.stdout.write(`${JSON.stringify({ event: "retry-exemption", task: r.taskId, ...exemption })}\n`);
        // 动作跟着读数分叉（gap-fan-in-suite-red-with-no-attributable-test-still-redispatches-worker）：
        // 同一条 verdict 下，后续动作【不】与「已归因的实现缺陷」共用重派分支。判为「归因不出」且
        // 已用尽至多一次重试（或与上一轮日志内容逐字节相同）⇒ 停，标 needs-human 终态，
        // ⛔ 不再拿一个新 claude 会话去撞同一堵墙（每轮成功率零：日志里没有可修对象）。
        const decision = decideExitedNotLandedAction(rootDir, r.taskId, r.outcome, exemption);
        exitedNotLandedStops.push({ task: r.taskId, kind: decision.kind, verdict: decision.verdict, reason: decision.reason, suiteLogHash: decision.suiteLogHash });
        if (json) process.stdout.write(`${JSON.stringify({ event: "exited-not-landed-action", task: r.taskId, ...decision })}\n`);
        if (decision.kind === "stop-terminal") {
          // 停 = 不重派：内存集合（retryCapNotExhausted 过滤）挡下一轮 + 磁盘 status 翻转双保险。
          // 预算照扣（counts 记满，⛔ 不因判不出而放行——与既有「照常计数」语义一致），只是不再重派。
          if (!retryState.needsHuman.has(r.taskId)) {
            retryState.needsHuman.add(r.taskId);
            retryState.counts.set(r.taskId, maxRetries);
            needsHumanWrites.push({
              id: r.taskId,
              reason: `suite 红但归因不出任何失败测试文件（基建/契约疑似，非实现缺陷）——停止重派，⛔ 不再拿新会话撞同一堵墙：${decision.reason}`,
            });
          }
        } else if (exemption.verdict !== "unrelated-flaky-exempt") {
          for (const id of advanceRetryCap(retryState, [r.taskId], maxRetries)) {
            needsHumanWrites.push({ id, reason: `worker-driver 连续 ${maxRetries} 次 exited-not-landed 未落地（重试上限）` });
          }
        }
      }
      for (const w of needsHumanWrites) {
        // gap-mark-needs-human-commit-after-write：markNeedsHuman 写盘即提交，返回
        // { id, ok, reason, committed }——⛔ 不再丢弃 {ok,reason}；结果经 writeRound 落进 round 记录
        // （生产载体），json 事件供测试/手动观测。
        const nh = markNeedsHuman(rootDir, w.id, w.reason);
        needsHumanResults.push(nh);
        if (json) process.stdout.write(`${JSON.stringify({ event: "needs-human", ...nh })}\n`);
      }
    }
    // 快速死亡退避（gap-worker-driver-selector-api-error-no-backoff）：worker 快速死亡（<quickDeathMs）
    // ⇒ 对该 task 退避（backoffUntil，⛔ 不立即重派）；退避到上限（maxRetries）⇒ markNeedsHuman（复用
    // 现有重试上限机制，⛔ 不无限退避）。needsHuman 集合与 markNeedsHuman 的 status 翻转双保险——
    // 即使磁盘写失败，内存过滤（retryCapNotExhausted/notNeedsHuman）也挡重派。
    // 孤儿 finalize 的 outcome 带 orphan_pid_liveness（/proc 实测取值）时一并传：⛔ 没测出来的死亡
    // 不烧重试预算（AC4）。普通 worker 终态无该字段 ⇒ undefined ⇒ 行为不变。
    // 成因分类（gap-worker-driver-counts-transient-rate-limit-as-fast-death-and-parks-task-needs-human）：
    // 把 driver 【已捕获】的 selector_reason 交给纯分类器（⛔ 不新增探测面、⛔ 无语义判断）。
    // transient-external（账号级限流/配额）⇒ 内部不计入连续上限、只退避 ⇒ 下面的 newlyNeedsHuman
    // 分支对它永不成立（任务不再被终态停摆）；转而按错误文本自带的重置时刻退避重试。
    // 快速死亡判定已由 runOneWorker 在【写载体之前】做好（judgeQuickDeath 注入，见 QuickDeathJudge）
    // ——这里直接消费它的结论，⛔ 不再重算（重算会二次记账，且与载体写下的那一份可能不一致）。
    // 孤儿 adopt 路径的 outcome 不是 runOneWorker 产的（无该字段）⇒ 回落到原地的记录调用。
    const backoff = r.quickDeath ?? recordQuickDeathBackoff(
      backoffState, r.taskId, r.outcome.final_state, r.outcome.wall_clock_ms, Date.now(), maxRetries, backoffCfg,
      (r.outcome as { orphan_pid_liveness?: OrphanPidLiveness | null }).orphan_pid_liveness ?? undefined,
      (r.outcome as { selector_reason?: string | null }).selector_reason ?? null,
      // 第二个判定面：worker stderr 的末尾捕获（runOneWorker 边转发边留的尾部窗口）。
      (r.outcome as { worker_stderr_tail?: string | null }).worker_stderr_tail ?? null,
    );
    // 环境级故障（gap-worker-quick-death-environment-fatal-halts-driver）：worker 在 60s 内以
    // `model_not_found` / 401 / launcher ENOENT / DNS 不可解等【所有 worker 都会同样遇到】的方式死掉，
    // 或窗口内 ≥2 个【不同任务】以同一签名死掉 ⇒ 停的是 driver，不是任务。
    // ⛔ 不 markNeedsHuman（这正是本缺陷：逐个 park 任务直到池子清空，任务状态被动过、真因却丢了）；
    // ⛔ 不动 counts（AC2：涉事任务的快速死亡计数不增加）。
    if (backoff.cause === "environment-fatal") {
      const reason = environmentFatalHaltReason(backoff);
      const controlFile = haltForEnvironmentFatal(rootDir, reason);
      if (json) {
        process.stdout.write(
          `${JSON.stringify({ event: "environment-fatal-halt", task: r.taskId, signature: backoff.signature, quick_death_ms: r.outcome.wall_clock_ms, control_file: controlFile, reason })}\n`,
        );
      }
      return r;
    }
    if (backoff.newlyNeedsHuman) {
      retryState.needsHuman.add(r.taskId);
      // 注记必须让读者一眼区分真因（plan item 4）：本路径【没有】exited-not-landed 尝试 ⇒ 注记的
      // 「失败步/判词」行结构上缺省，若不带上快速死亡分类器的取值，这条翻转就只剩模板句、与其他路径
      // 同形。故如实把分类器取值写进阻碍原因（ordinary / unclassifiable 两态；transient-external
      // 结构上到不了这里）。⛔ 该分类器只管重试计数——它不再是「needs-human 成因字段」的一部分
      // （gap-retire-needs-human-cause-enumeration 已删除该字段）。⛔ transient-external 不自动回捞
      // （终态由人/上层裁决）。
      markNeedsHuman(
        rootDir,
        r.taskId,
        `worker-driver 连续 ${maxRetries} 次 <${backoffCfg.quickDeathMs}ms 快速死亡（退避上限）` +
          `；快速死亡分类：${backoff.cause ?? "unclassifiable"}`,
      );
    }
    if (backoff.quickDeath && json) {
      process.stdout.write(
        `${JSON.stringify({ event: "worker-backoff", task: r.taskId, cause: backoff.cause, consecutive_quick_deaths: backoffState.counts.get(r.taskId), consecutive_transient_deaths: backoffState.transientCounts.get(r.taskId), backed_off: backoff.backedOff, backoff_until: backoff.backoffUntil, needs_human: backoff.newlyNeedsHuman, wall_clock_ms: r.outcome.wall_clock_ms })}\n`,
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
      // 判定注入：写载体之前跑（见 QuickDeathJudge），onWorkerFinished 消费结论、⛔ 不再重算。
      judgeQuickDeath: judgeQuickDeathFor(sel.task),
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
  // ⚠️ 本 workspace 的 worker 名从 root 的 .quay/profiles.yml 解析（⛔ 不用写死的 `quay-task-worker`）：
  // 第三方项目改名后，写死名会让这两条分支都判错——finalize 假记录 + coldInflight 漏排除 ⇒ 同任务双派。
  const reconcileOrphanDispatches = (): void => {
    const store = readDispatchStore(dispatchStoreFile(rootDir));
    const workerName = resolveWorkerProcessName(rootDir);
    for (const { taskId, record } of orphanDispatchCandidates(store, running.map((r) => r.task))) {
      const cls = classifyOrphanDispatch(record, "/proc", workerName);
      if (cls === "finalize") {
        const res = finalizeOrphanDispatch({ root: rootDir, outcomeFile, record, workerName });
        if (res.refusedLiveWorker) {
          // 存活闸兜底（⛔ workerName 解析失败时这里仍拦住——闸用名字无关的 /proc 存在性）：pid 仍存活
          // ⇒ 不判死、不写终态、不清 worktree/记录；下一轮照常重试（进程真退出后即自愈）。
          if (json) process.stdout.write(`${JSON.stringify({ event: "orphan-finalize-refused-live", task: taskId, worker_pid: record.workerPid })}\n`);
          continue;
        }
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
    pushLagReading = null; // 每轮复位（见上面的声明注释）
    releaseBranchJanitorResult = null; // 每轮复位（同上：⛔ 上一轮的读数不漏进本轮）
    let poolSeen: number | null = null;
    let waitReason: string | null = null;
    let step = "start";
    try {
      // 冷启动在飞【现观测】（每趟 pass，SPEC §5.2 actual=observe()）：worker 退出 / worktree 消失任一
      // 发生 ⇒ task 即离开排除集、下一轮重新可派（⛔ 循环外一次性 const 快照 = 假在飞不可派，已修）。
      // 每轮重扫 task worktree + /proc 存活 worker 交叉核对；该结果同时写进本轮 round 记录（生产载体）。
      // 异步版（gap-worker-driver-async-selector-readypool）：git worktree list 不再 spawnSync 阻塞地板。
      step = "cold-start-inflight";
      // workerName 解析自 .quay/profiles.yml（每趟一次，⛔ 不用写死的 `quay-task-worker`——第三方项目
      // 改名后写死名会让本排除集恒为空 ⇒ 同任务双派，与 reconcile 的假 finalize 同源）。
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

      // 1b'. release 分支 janitor（gap-ac271-finish-step-needs-self-acting-carrier）——与上一步同族的
      //   机械家务：AC-271 的唯一可达合规形态是【删除】，而删除此前只靠人记得（实测 3 次残留/零痕迹消失）。
      //   每轮走 AC-271 同一份枚举，把「切版忘了删」在一个 tick 内收尾，⛔ 不需要任何人记得。
      //   ⛔ 本步**只**挂在这里：不进 goal gate / goal-driver 的判定路径——判定者不得成为被判定状态的
      //   修复者，否则判据变自证（硬规则 4）。无许可的红分支【留在原地】（那是判据必须继续抓到的
      //   「会丢工作」形态，⛔ janitor 不得代判为绿）。
      //   ⛔ 本步失败绝不能让整轮抛错（git 读失败 = 下一轮重试，不是错误轮）；异常就地吞成
      //   instrument-failure 读数，仍进 round 记录（可区分于「没跑」）。
      step = "release-branch-janitor";
      try {
        releaseBranchJanitorResult = runReleaseBranchJanitor(rootDir, {});
      } catch (e: any) {
        releaseBranchJanitorResult = {
          evaluated: false,
          verdict: "instrument-failure",
          exit: 2,
          cause: `CAUSE=release-branch-janitor-threw — the janitor step threw: ${e?.message ?? String(e)}`,
          branchCount: 0,
          decisions: [],
          redBranches: [],
          carrierCalls: [],
        };
      }
      if (json && (releaseBranchJanitorResult.redBranches.length > 0 || !releaseBranchJanitorResult.evaluated)) {
        process.stdout.write(
          `${JSON.stringify({ event: "release-branch-janitor", verdict: releaseBranchJanitorResult.verdict, branch_count: releaseBranchJanitorResult.branchCount, red_branches: releaseBranchJanitorResult.redBranches, cause: releaseBranchJanitorResult.cause })}\n`,
        );
      }

      // 1c. push 滞后检查（gap-fan-in-push-silently-fails-no-detection AC7 的挂点）。
      //   **这一条修的是事故本身**：`runMechanicalFanIn` 全段零 push（只有 ff-merge 的本地
      //   `git push . task/X:develop`），于是「任务 done」与「代码到达 origin/develop」脱钩——实测
      //   两次（2026-09-16 / 09-17），两次都靠人/别的 Monitor 偶然发现。
      //   ⛔ 不新造循环/驱动 kind：唯一真会做 fan-in 的常驻进程就是本循环，所以挂在这里（与上一步
      //   reclaim-superseded 同族：都是「每轮顺手做的机械家务」）。
      //   读数是【每轮必记】的（pushLagReading 进 round，见 AC7——生产 driver argv 无 --json，
      //   round 记录是它唯一的可观测载体）；检测器自己只在【有信号】时写 .quay/fan-in-push-lag.jsonl。
      //   ⛔ 本步失败绝不能让整轮抛错（net 抖动/凭据问题 ⇒ 下一轮重试，不是错误轮）。
      step = "push-lag";
      pushLagReading = runPushLagPass(rootDir, pushBranch, pushRemote, reconcileMs);
      if (json && pushLagReading && pushLagReading.verdict !== "in-sync") {
        process.stdout.write(`${JSON.stringify({ event: "push-lag", ...pushLagReading })}\n`);
      }

      // 2. 池非空且未达 cap 且未判停 ⇒ 走选择环起下一个。
      //    ⛔ stopReason 是【终态 latch】（仅 mcp-halt）；瞬时闸拒绝只记本轮 waitReason，下一轮重读
      //    stopCondition（gap-worker-driver-stopreason-latch-permanent-stop：stopReason 一旦赋值永不复位 ⇒
      //    瞬时拒被永久 latch ⇒ 1h48m 零派发）。
      step = "dispatch-loop";
      while (running.length < cap && !stopReason && !kindStopRequested("worker")) {
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
        if (stopReason || kindStopRequested("worker")) break;
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
  let mechanicalFanIn = false;
  let mechWorktree: string | undefined;
  let mechMergeTarget: string | undefined;
  let writeScopedGateCacheFlag = false;
  let scopedGateCacheDevelopSha: string | undefined;
  let appendCompleteGateEventFlag = false;
  let appendCompleteActor: string | undefined;

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
    else if (a === "--mechanical-fan-in") mechanicalFanIn = true;
    else if (a === "--worktree") mechWorktree = args[++i];
    else if (a === "--merge-target") mechMergeTarget = args[++i];
    else if (a === "--write-scoped-gate-cache") writeScopedGateCacheFlag = true;
    else if (a === "--develop-sha") scopedGateCacheDevelopSha = args[++i];
    else if (a === "--append-complete-gate-event") appendCompleteGateEventFlag = true;
    else if (a === "--actor") appendCompleteActor = args[++i];
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
          "  --append-complete-gate-event --task <id> [--actor <a>]  写 `complete` pass GateEvent 到 <root>/.quay/gate-events.jsonl（语义 fan-in workflow 的 flip 落地补写；exit 0=已写 / 2=缺参）\n" +
          "  ⛔ 无 --serve：MCP 控制面（halt / setPreference / forceDispatch）已上收进 Layer 0——由每个 kind 的\n" +
          "     supervisor（driver-runtime.ts runSupervisor）起，逐 kind 写 <prefix>-control-plane.json 回读面",
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

  // --append-complete-gate-event：把 `complete` pass GateEvent 写进 <root>/.quay/gate-events.jsonl。
  // gap-complete-gateevent-coverage-has-a-residual-gap 的第二条落地路径（`plugin/workflows/
  // fan-in-execute.js` 的 flip 块，commit `tasks: 翻 <id> done（AC78 fan-in-execute workflow）`）此前
  // 直接 `sed -i` 翻 status 并 commit，⛔ 全文零 GateEvent ⇒ 该路径的每一次落地在生产载体上都不留痕
  // （09-04~09-14 实测：该路径 2/2 落地零事件，而机械 fan-in 路径 386/388 有事件）。本 verb 让该
  // workflow 用【同一个】appendCompleteGateEvent（gate-event-store 的 appendGateEvent，⛔ 不手搓 JSON），
  // 与 `--mechanical-fan-in` 的 9.4b 写侧同源。stdout 单行 JSON；exit 0 = 已写 / 2 = 缺参（fail-closed）。
  if (appendCompleteGateEventFlag) {
    const task = tasks[0];
    if (!task) {
      console.error("worker-driver: --append-complete-gate-event requires --task <id>");
      return 2;
    }
    const r = await appendCompleteGateEvent(rootDir, task, appendCompleteActor ?? "quay-fan-in-workflow");
    process.stdout.write(`${JSON.stringify({ event: "complete-gate-event-appended", task, ok: r.ok, reason: r.reason })}\n`);
    return r.ok ? 0 : 2;
  }

  // ⛔ 本文件【不再】自带 serveControlPlane 调用点（GOAL-017/AC-252，SPEC §7 阶段 A1）：控制面已上收进
  // Layer 0——每个 kind 的 supervisor（driver-runtime.ts runSupervisor）起一个，六个 kind 全部从共享骨架
  // 获得入站控制面（⛔ 不是六个 kind 各自直调）。旧 `--serve` flag 一并删除，⛔ 不留「解析了但没人消费」
  // 的死 flag（硬规则 3b）；控制面入口在 Layer 0，不在本 kind 的 argv 面。

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
