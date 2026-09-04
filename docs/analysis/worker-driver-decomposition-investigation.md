# worker-driver.ts 拆分调查（gap-worker-driver-god-file-decomposition-investigation）

> 立案任务：`tasks/gap-worker-driver-god-file-decomposition-investigation.md`
> 本调查产物：消费者分组表（AC2）、纠缠对清单（AC3）、拆分方案（AC4）+「不拆」反向证据（AC5）。
> 本任务**不修改** `worker-driver.ts` 本身——只产出可执行的调查结论，供后续任务直接引用作 Proposal 依据。

---

## TL;DR（结论先行，细节见后）

1. **现场基线（AC1）**：`worker-driver.ts` = **4445 行** / **140 个导出行**（其中 135 个「本文件定义」的导出 + 5 个 re-export 行，re-export 行展开为 **38 个符号**，来自 5 个已拆出的兄弟模块）。立案时量到 4435 行，本次再量 +10 行——「仍在长」成立。
2. **双向缠结已过期（AC2 核心发现）**：文档 §2.8 R10 的「入度 19」是**旧快照**。当前 `worker-driver.ts` 的**全部静态消费者 = 11 个文件，且全是 test 文件**（`packages/quay/test/serve.test.mjs` + 10 个 `plugin/test/*`），**生产代码零消费者**。AC150–AC155 已把「共享面」抽到 `driver-shared.ts` / `driver-filters.ts` / `driver-config.ts` / `driver-result.ts` / `driver-runtime.ts` 等，本文件只剩「旧 import 面的 re-export」+ 一条长线性驱动主线。
3. **不是共享可变状态纠缠（AC3 核心发现）**：全文件模块级**可变**私有状态 ≈ 0——只有 2 个 `const`（`QUICK_DEATH_FINAL_STATES` 只读 `Set`、`FAN_IN_LOCK_HOLDER` 字符串），无模块级单例 config / cache / 计数器。文件大，是因为它是**一条从 worktree → outcome → prompt → spawn → fan-in → 常驻环的长线性驱动**，不是「互相调用 + 共享闭包状态」的缠结团。
4. **拆分结论（AC4/AC5）**：**值得局部拆**，且有一个干净的高价值缝——**机械 fan-in 区域（2581–3741，1161 行，28 个导出）近乎自包含**（对文件内其它区域**仅 1 处真实调用** `scopedGateCommandFor`，且该调用自带 `opts.scopedGateCommand ??` 注入缝；`computeLandingState` 在该区域的 2 处出现**全是注释**，非真实依赖），是最优先的提取目标。其余区域是线性驱动的骨架，缺乏外部消费压力与共享状态纠缠，进一步拆分的收益递减（详见 §AC5 的反向证据）。

---

## AC1 — 现场基线（真实命令与输出）

在任务 worktree（off `develop` @ `a39e61ed2`）执行：

```bash
$ cd /home/yale/work/quay-worktrees/gap-worker-driver-god-file-decomposition-investigation
$ wc -l plugin/scripts/worker-driver.ts
4445 plugin/scripts/worker-driver.ts
$ grep -c "^export " plugin/scripts/worker-driver.ts
140
$ grep -cE "^(export |export\{)" plugin/scripts/worker-driver.ts
140
```

对照：文档 `docs/proposals/archguard-generation-era-primitives.md:72` 量到 **4364 行 / 135 导出**；本任务立案时量到 **4435 行 / 140 导出**；本次再量 **4445 行 / 140 导出**。三次数列 `4364 → 4435 → 4445`，验证了「机制层持续沉积」——导出数不再涨（135→140 的增量是 AC150–AC155 把共享面抽出去后新增的 re-export 面，见下），但行数仍在长。

### 140 个「导出行」的构成（关键拆解）

`grep -c "^export "` 数的是**行**，不是符号。140 行 = 135 个单符号导出行 + 5 个 re-export 行（其中 2 个是多行 `export { ... }` 块）。5 个 re-export 行展开为 **38 个符号**，全部来自已经拆出去的兄弟模块：

| re-export 行 | 来自 | 符号数 | 符号 |
|---|---|---|---|
| `:139` `export { ... }` | `./driver-shared.ts` | 18 | `CONTROL_STATE_REL`, `CONTROL_CALLERS_ENV`, `DEFAULT_CALLERS`, `CONTROL_HEADER`, `CONTROL_HEADER_NAME`, `defaultControlState`, `mergeControlState`, `readControlState`, `writeControlState`, `isHalted`, `applyHalt`, `applyPreference`, `applyForceDispatch`, `knownCallers`, `resolveCaller`, `headerValue`, `resourceGateCheck`, `serveControlPlane` |
| `:163` | `./driver-filters.ts` | 4 | `readTaskStatus`, `lastExitedNotLandedReason`, `exitedNotLandedAttempts`, `WORKER_OUTCOME_REL` |
| `:171` | `./driver-result.ts` | 1 | `verifyIndependently` |
| `:172` | `./driver-result.ts` | 1 | `DriverResult`（type） |
| `:211` `export { ... }` | `./driver-runtime.ts` | 14 | `splitArgs`, `launchArgv`, `defaultLivenessCheckArgv`, `runLivenessCheck`, `runLivenessCheckAsync`, `LIVENESS_CHECK_TIMEOUT_MS`, `shuffle`, `defaultReadyPoolArgv`, `readyPoolCheck`, `defaultSelectorArgv`, `parseSelectorOutput`, `runSelectorWorker`, `makeStopCondition`, `LivenessResult`（type） |

⇒ 文件自述（`:132–133`）「本文件仍 re-export 保持旧 import 面」是准确的：**38 个导出符号根本不是本文件定义的**，是「向后兼容 import 面」。真正在本文件定义的是 **135 个导出**，落在 `:232`–`:4445`（约 4200 行）。

---

## AC2 — 消费者分组表（140 个导出 → 消费者 → 功能区域）

### AC2-0：全局消费者事实（最重要的一个数字）

```bash
$ grep -rlE "from ['\"].*worker-driver(\.ts)?['\"]" --include="*.ts" --include="*.mjs" --include="*.js" . \
    | grep -vE "node_modules|/\.git/|quay-worktrees|/\.claude/worktrees/" | sort
```

结果 **11 个文件，全部在 `test/` 下**；再对非 test 源（`.ts/.mjs/.js/.sh`）grep `worker-driver`，命中**全是注释**（`slot-refill.ts` / `cap-from-gate.ts` / `process-budget.sh` / `promotion-driver.ts` 等 20+ 处的提及都是「已退役 / 与 worker-driver 同族 / 同源」的注释，无一处 import）。

| 消费者文件 | 从 worker-driver 导入的符号 | 消费性质 |
|---|---|---|
| `plugin/test/worker-driver.test.mjs` | 约 100+ 符号（主测试，全区域） | 本文件的主测试 |
| `plugin/test/worker-driver-fan-in.test.mjs` | 108 符号（含 fan-in 区域全部 + 公共区） | fan-in 机械编排测试 |
| `plugin/test/worker-driver-resident.test.mjs` | 约 100 符号 | 常驻环测试 |
| `plugin/test/driver-runtime.test.mjs` | `import * as worker`（namespace） | Layer 0/1a 复用身份验证 |
| `plugin/test/driver-filters.test.mjs` | `readTaskStatus`（别名 `workerReadTaskStatus`） | 验证 re-export 面 = 同源实现 |
| `plugin/test/driver-result.test.mjs` | `verifyIndependently`（别名） | 验证 re-export 面 = 同源实现 |
| `plugin/test/promotion-driver.test.mjs` | `resourceGateCheck`, `isHalted`（别名） | 验证两 driver 共享 driver-shared 实现 |
| `plugin/test/fan-in-driver-mechanical-orchestration.test.mjs` | `runMechanicalFanIn`, `readFanInLockHold`, `acquireFanInLock` | fan-in 锁 / 编排 |
| `plugin/test/fan-in-workflow-lock.test.mjs` | `acquireFanInLock`, `readFanInLockHold` | fan-in 锁 |
| `plugin/test/helpers/worker-driver-harness.mjs` | `WORKER_OUTCOME_REL`, `WORKER_ROUND_REL` | 测试 harness 常量 |
| `packages/quay/test/serve.test.mjs` | `computeWorkerRoundRecord` | **唯一跨包消费者**（仍是 test） |

**推论**：文档 §2.8 R10 的「入度 19 / 出度 24 / 跨 5 层，全组唯一既被广泛消费又广泛消费别人」描述的是**旧快照**。AC150–AC155 之后，本文件在**生产代码里已没有消费者**——它的「被广泛消费」属性已经被 `driver-shared.ts` 等 5 个模块接走了（`promotion-driver.ts` 直接 import `driver-shared.ts` / `driver-runtime.ts`，不再经 `worker-driver.ts` 中转，见 `promotion-driver.ts:65`「⛔ 不再经 worker-driver 中转」）。**「拆分会伤到 19 个生产消费者」的风险不复存在**——现在唯一会伤到的是 11 个 test 文件，而测试迁移是机械可循的。

### AC2-1：本文件定义的 135 个导出 → 消费者 → 功能区域（完整表）

「消费者」列按上表 11 个文件的短名缩写：
`W` = worker-driver.test.mjs，`F` = worker-driver-fan-in.test.mjs，`R` = worker-driver-resident.test.mjs，
`RT` = driver-runtime.test.mjs（namespace），`DF` = driver-filters.test.mjs，`DR` = driver-result.test.mjs，
`P` = promotion-driver.test.mjs，`FO` = fan-in-driver-mechanical-orchestration.test.mjs，
`FL` = fan-in-workflow-lock.test.mjs，`H` = worker-driver-harness.mjs，`S` = packages/quay/test/serve.test.mjs。
`prod` = 生产代码消费者（**全部为空**）。

**两个「消费者列」口径（避免误读）**：
- **`type` = 接口/type 导出**（`interface X` / `export type X`，共 **19 个**）——运行时被擦除，无任何 `.mjs` 消费者；其消费者列标 `type`，只在本文件内作类型注解。
- **`无（死导出）` / `无外部` = 无消费者的 value 导出**——本调查发现 **2 个死导出**（`MAX_TASK_SUBAGENTS_ENV`、`appendOutcome`：0 内部 + 0 外部引用）与 **2 个仅内部消费的导出**（`isShaAncestorOfBranch` ← `computeLandingState`；`suiteRedAttemptsInWindow` ← `judgeRetryExemption`）。这是「杂物袋」的实锤残留：导出面 135 个里至少 2 个已无任何调用方。
- **`W/F/R` 的粒度** = 「这三个大测试文件的 import 面」；个别符号的实际 import 面可能更窄（如只被 F import）。这不影响本调查的承重结论（**0 生产消费者**）——符号级精确 import 清单以各测试文件自己的 `import { … }` 块为准。

#### 区域 R2 — 常量（`:232`–`:278`，8 导出，~50 行）

| 导出 | 消费者 | 区域 |
|---|---|---|
| `WORKER_ROUND_REL` | W,F,R,H | round 记录常量 |
| `WORKER_DISPATCH_REL` | W,F,R | dispatch store 常量 |
| `FINAL_STATES` | W,F,R | 终态枚举 |
| `EXITED_NOT_LANDED_EXIT` | W,F,R | exit code 常量 |
| `MAX_TASK_SUBAGENTS_ENV` | **无（死导出）** | env 名常量（AC155 把 env 源并入 driver-config 后遗留的孤儿，0 内部 + 0 外部引用） |
| `WORKER_PROCESS_NAME` | W,F,R | 进程名常量 |
| `RESIDENT_INTERVAL_MS_DEFAULT` | W,F,R | 轮询间隔缺省 |
| `RECONCILE_INTERVAL_SECS_DEFAULT` | W,F,R | 协调地板缺省 |

#### 区域 R3 — outcome / 落地判定（`:280`–`:845`，21 导出，~566 行）

| 导出 | 消费者 | 区域 |
|---|---|---|
| `computeOutcome` | W,F,R | outcome 结构 |
| `isFfNotFastForwardFailure` | W,F,R | ff 失败判定 |
| `readLockMetricsForRun` | W,F,R | suite 锁度量读 |
| `worktreePresentForTask` | W,F,R | worktree 探测 |
| `worktreePathsForTask` | W,F,R | worktree 路径 |
| `worktreePresentForTaskAsync` | W,F,R | worktree 探测（async） |
| `worktreePathsForTaskAsync` | W,F,R | worktree 路径（async） |
| `enumerateTaskWorktreeTasks` | W,F,R | 任务 worktree 枚举 |
| `enumerateLiveWorkerCmdlines` | W,F,R | 活 worker cmdline 枚举 |
| `hasLiveWorkerForTask` | W,F,R | 活 worker 判定 |
| `enumerateColdStartInflight` | W,F,R | 冷启动在飞枚举 |
| `enumerateColdStartInflightAsync` | W,F,R | 冷启动在飞（async） |
| `isSigtermExitCode` | W,F,R | SIGTERM exit code 判定 |
| `taskBranchHasCommits` | W,F,R | 分支 commit 探测 |
| `OrphanCleanupResult`（interface） | type | orphan 清理结果类型 |
| `cleanupOrphanWorktree` | W,F,R | orphan worktree 清理 |
| `LandingEvidence`（interface） | type | 落地证据类型 |
| `isShaAncestorOfBranch` | **无外部**（仅 `computeLandingState` 内部调用） | sha 祖先判定 |
| `computeLandingState` | W,F,R | 落地三态判定（核心） |
| `appendOutcomeToFile` | W,F,R | outcome 落盘 |
| `appendOutcome` | **无（死导出）** | outcome 落盘（root 便捷包装，0 内部 + 0 外部调用） |

#### 区域 R4 — round 记录（`:846`–`:915`，2 导出，~70 行）

| 导出 | 消费者 | 区域 |
|---|---|---|
| `computeWorkerRoundRecord` | W,F,R,S（**S = 唯一跨包消费者**） | round 记录结构 |
| `appendRoundToFile` | W,F,R | round 落盘 |

#### 区域 R5 — worker 命令 / prompt 构建（`:916`–`:1041`，5 导出，~126 行）

| 导出 | 消费者 | 区域 |
|---|---|---|
| `WorkerCmdOptions`（interface） | type | 命令选项类型 |
| `scopedGateCommandFor` | W（+ **R15 内部引用 ×1**） | scoped 门命令 |
| `buildWorkerPrompt` | W,F,R | 首次 worker prompt |
| `workerArgvForTask` | W,F,R | worker argv |
| `defaultWorkerArgv` | W,F,R | worker argv 缺省 |

#### 区域 R6 — 续做（continue）状态（`:1042`–`:1242`，8 导出，~201 行）

| 导出 | 消费者 | 区域 |
|---|---|---|
| `ContinueWorkerState`（interface） | type | 续做状态类型 |
| `readAcCheckState` | W,F,R | AC 勾选态读 |
| `countBranchCommits` | W,F,R | 分支 commit 计数 |
| `branchHeadSubject` | W,F,R | 分支 HEAD subject |
| `countBranchCommitsAsync` | W,F,R | 分支 commit 计数（async） |
| `branchHeadSubjectAsync` | W,F,R | 分支 HEAD subject（async） |
| `continueStateForTask` | W,F,R | 续做状态 |
| `continueStateForTaskAsync` | W,F,R | 续做状态（async） |

#### 区域 R7 — relatedness / 重试豁免（`:1243`–`:1631`，18 导出，~389 行）

| 导出 | 消费者 | 区域 |
|---|---|---|
| `RelatednessVerdict`（type） | type | relatedness 三态 |
| `RelatednessSignal`（interface） | type | relatedness 信号类型 |
| `failingTestFilesFromSuiteLog` | W,F | suite log 解析 |
| `taskTouches` | W | Touches 读 |
| `taskDeltaFiles` | W | delta 文件 |
| `computeDeltaPaths` | W | delta 路径 |
| `directImportRels` | W | 直接 import 关系 |
| `classifyDeltaRelatedness` | W | relatedness 判定 |
| `classifyLoadSensitive` | W | load-sensitive 判定 |
| `relatednessSignalsFor` | W | relatedness 信号汇总 |
| `formatRelatednessNote` | W | relatedness note 格式化 |
| `continueRelatednessNote` | W | 续做 relatedness note |
| `RetryExemptionVerdict`（type） | type | 豁免三态 |
| `RetryExemptionJudgment`（interface） | type | 豁免判定类型 |
| `RETRY_EXEMPTION_WINDOW_MS_DEFAULT` | W,F | 豁免窗口缺省 |
| `assertionSignaturesFromSuiteLog` | W,F | assertion 签名解析 |
| `suiteRedAttemptsInWindow` | **无外部**（仅 `judgeRetryExemption` 内部调用） | 窗口内红次数 |
| `judgeRetryExemption` | W,F（+ **R16 内部引用 ×1**） | 豁免判定 |

#### 区域 R8 — 续做 prompt（`:1632`–`:1690`，4 导出，~59 行）

| 导出 | 消费者 | 区域 |
|---|---|---|
| `buildContinueWorkerPrompt` | W,F,R | 续做 prompt |
| `workerPromptForTask` | W,F,R | worker prompt（sync） |
| `workerPromptForTaskAsync` | W,F,R | worker prompt（async） |
| `workerArgvForTaskAsync` | W,F,R | worker argv（async） |

#### 区域 R9 — 配置解析（`:1691`–`:1760`，6 导出，~70 行）

| 导出 | 消费者 | 区域 |
|---|---|---|
| `signalExitCode` | W,F,R | 信号→exit code |
| `resolveConcurrency` | W,F,R | 并发解析 |
| `parseTimeoutMs` | W,F,R | 超时解析 |
| `parseIntervalMs` | W,F,R | 间隔解析 |
| `parseReconcileIntervalSecs` | W,F,R | 协调地板解析 |
| `parseMaxRetries` | W,F,R | 重试上限解析 |

#### 区域 R10 — 快速死亡退避（`:1761`–`:1882`，12 导出，~122 行）

| 导出 | 消费者 | 区域 |
|---|---|---|
| `QuickDeathBackoffConfig`（interface） | type | 退避配置类型 |
| `QUICK_DEATH_BACKOFF_DEFAULT` | W,F,R | 退避缺省 |
| `isQuickDeath` | W,F,R | 快速死亡判定 |
| `backoffDelayMs` | W,F,R | 退避延迟 |
| `QuickDeathBackoffState`（interface） | type | 退避状态类型 |
| `newQuickDeathBackoffState` | W,F,R | 退避状态初始化 |
| `isBackedOff` | W,F,R | 退避中判定 |
| `recordQuickDeathBackoff` | W,F,R | 退避记录 |
| `parseQuickDeathMs` | W,F,R | quickDeath 解析 |
| `parseBackoffBaseMs` | W,F,R | base 解析 |
| `parseBackoffMaxMs` | W,F,R | max 解析 |
| `parseBackoffThreshold` | W,F,R | 阈值解析 |

#### 区域 R11 — stash（`:1883`–`:1909`，2 导出，~27 行）

| 导出 | 消费者 | 区域 |
|---|---|---|
| `StashResult`（interface） | type | stash 结果类型 |
| `stashIfDirty` | W,F,R | 主检出脏状态观察 |

#### 区域 R12 — 停泊 outcome / 运行解析（`:1910`–`:2006`，3 导出，~97 行）

| 导出 | 消费者 | 区域 |
|---|---|---|
| `computeHaltedOutcome` | W,F,R | halt 未派 outcome |
| `resolveRun` | W,F,R（+ **R16 内部引用 ×1**） | 多任务输入解析 |
| `WorkerRunResult`（interface） | type | 单 worker 结果类型 |

#### 区域 R13 — dispatch store / orphan 恢复（`:2007`–`:2304`，13 导出，~298 行）

| 导出 | 消费者 | 区域 |
|---|---|---|
| `DispatchRecord`（interface） | type | dispatch 记录类型 |
| `dispatchStoreFile` | W,F,R | store 路径 |
| `readDispatchStore` | W,F,R | store 读 |
| `writeDispatchStore` | W,F,R | store 写 |
| `upsertDispatchRecord` | W,F,R | record upsert |
| `removeDispatchRecord` | W,F,R | record 移除 |
| `readPidCmdline` | W,F,R | pid cmdline 读 |
| `classifyOrphanDispatch` | W,F,R（+ **R16 内部引用 ×1**） | orphan 分类 |
| `orphanDispatchCandidates` | W,F,R（+ **R16 内部引用 ×1**） | orphan 候选 |
| `computeOrphanFinalizedOutcome` | W,F,R | orphan 补终态 |
| `computeAdoptedOutcome` | W,F,R | orphan adopt |
| `finalizeOrphanDispatch` | W,F,R（+ **R16 内部引用 ×2**） | orphan finalize |
| `adoptOrphanWorker` | W,F,R（+ **R16 内部引用 ×2**） | orphan adopt worker |

#### 区域 R14 — session id / AC 短路 / runOneWorker（`:2305`–`:2580`，2 导出 + 1 私有，~276 行）

| 导出 | 消费者 | 区域 |
|---|---|---|
| `newSessionId` | W,F,R | session id 生成 |
| `acShortCircuitVerdict` | W,F | AC 未全勾短路判定 |
| `runOneWorker`（**私有**） | ——（内部，被 R12 `resolveRun` / R16 `runResidentLoop` 调） | **中央编排器** |

#### 区域 R15 — 机械 fan-in（`:2581`–`:3741`，28 导出，~1161 行）⭐ 最大提取目标

| 导出 | 消费者 | 区域 |
|---|---|---|
| `MechanicalFanInOptions`（interface） | type | fan-in 选项类型 |
| `MechanicalFanInStepVerdict`（interface） | type | step 判定类型 |
| `MechanicalFanInResult`（interface） | type | fan-in 结果类型 |
| `mechSh` | W,F,R | 机械 shell 执行 |
| `appendFanInStepTrace` | W,F,R | step trace 追加 |
| `combinedOutput` | W,F,R | stdout/stderr 合并 |
| `extractFailureSummary` | W,F,R | 失败摘要提取 |
| `extractFirstFailureLine` | W,F,R | 首失败行提取 |
| `readFanInLockHold` | W,F,R,FO,FL | fan-in 锁持有读 |
| `fanInLockFile` | W,F,R | 锁文件路径 |
| `FanInLockHandle`（interface） | type | 锁句柄类型 |
| `acquireFanInLock` | W,F,R,FO,FL | fan-in 锁获取 |
| `readPreviousGreenSuiteCommit` | W,F | 上次绿 commit 读 |
| `appendCompleteGateEvent` | W,F | complete gate 事件追加 |
| `newMechanicalSuiteRunId` | W,F,R | suite runId 生成 |
| `defaultMechanicalSuiteCommand` | W,F,R | suite 命令缺省 |
| `fanInLogFileName` | W,F,R | fan-in 日志名 |
| `suiteLogFileName` | W,F,R | suite 日志名 |
| `newSuiteLogAttemptSuffix` | W | suite 尝试后缀 |
| `pruneTaskSuiteLogs` | W,F,R | suite 日志清理 |
| `appendFanInTrace` | W,F,R | fan-in trace 追加 |
| `scopedGateKey` | W | scoped gate key |
| `ScopedGateCacheEntry`（interface） | type | cache 类型 |
| `readScopedGateCache` | W | cache 读 |
| `writeScopedGateCache` | W | cache 写 |
| `runMechanicalFanIn` | W,F,R,FO | 机械 fan-in 主流程 |
| `spawnMechanicalFanIn` | W,F,R（+ **R16 内部引用 ×1**） | 机械 fan-in spawn |
| `mirrorMechanicalFanInSuiteState` | W,F,R | suite state 镜像 |

#### 区域 R16 — 常驻环 + main（`:3742`–`:4445`，3 导出，~704 行）

| 导出 | 消费者 | 区域 |
|---|---|---|
| `ResidentOptions`（interface） | type | 常驻选项类型 |
| `runResidentLoop` | W,F,R | 常驻选择环 |
| `main` | W（argv 入口） | CLI 入口 |

---

## AC3 — 纠缠组 vs 独立组（两类都有具体依据）

### AC3-0：模块级私有状态清单（判定「共享状态纠缠」的依据）

对全文件做「列 0 处、非 export 的声明」枚举，得 **28 个模块级私有声明**，其中**可变**的只有 2 个，且都是 `const`：

| 行 | 声明 | 类型 | 可变？ |
|---|---|---|---|
| `:1782` | `QUICK_DEATH_FINAL_STATES` | `ReadonlySet<string>`（`new Set(["failed","spawn-failed","killed"])`） | 否（const，只读） |
| `:2897` | `FAN_IN_LOCK_HOLDER` | 字符串（bash flock 脚本） | 否（const） |

其余 26 个全是 `function` / `async function` / `interface` / `const` 纯值（`escapeRegExp` `:446`、`listWorktreesAsync` `:578`、`enumerateTaskWorktreeTasksAsync` `:595`、`landingFailedReason` `:814`、`driverFanInNote` `:925`、`acCheckNote` `:937`、`scopedGateCacheWriteSignature` `:957`、`preMergeNote` `:968`、`dispatchSetupSignature` `:983`、`continueConflictResolutionNote` `:1183`、`CONTINUE_ATTEMPT_LIST_MAX` `:1199`、`continueAttemptsNote` `:1204`、`continueSuiteLogNote` `:1221`、`importHitsDelta` `:1334`、`recurringSignatureTasks` `:1533`、`appendWorkerPid` `:1986`、`runOneWorker` `:2350`、`MechShResult` `:2675`、`isNoiseLine` `:2767`、`isFailureSignalLine` `:2789`、`writeSuiteCapture` `:2979`、`readTaskStatusAtRef` `:3018`、`commitTaskStatusChange` `:3029`、`flipTaskDone` `:3052`、`SUITE_LOG_DELIM` `:3183`、`RunningWorker` `:3732`）。

**结论**：**不存在**典型「god file」那种跨导出共享的模块级可变单例（config 对象 / 缓存 / 计数器）。因此「拆开会不会打破共享闭包状态」这个风险**基本不存在**——这是本调查对 AC3 最要紧的一条证据。

### AC3-1：互相纠缠的导出组（有调用/共享证据）

纠缠的来源不是共享状态，而是**中央编排器把各区域串起来**。核心是私有函数 `runOneWorker`（`:2350`），它在 `finish` 闭包里一次性调用：`computeLandingState` → `readLockMetricsForRun` → `computeOutcome` → `cleanupOrphanWorktree` → `appendOutcomeToFile` → `removeDispatchRecord` / `dispatchStoreFile` → `signalExitCode` / `EXITED_NOT_LANDED_EXIT`（`runOneWorker` 代码 `:2403–2473` 实拍）。

**纠缠组 A（驱动主线）**：`runOneWorker` + `resolveRun` + `runResidentLoop` + `main` 把 R2/R3/R5/R6/R8/R12/R13/R14/R15/R16 串成一条链。这个「组」不是可以外移的单元——**它就是文件本身**（长线性驱动）。

**纠缠组 B（fan-in 区域内部）**：`runMechanicalFanIn`（`:3292`）调用 `acquireFanInLock` / `mechSh` / `appendFanInStepTrace` / `extractFailureSummary` / `combinedOutput` / `readPreviousGreenSuiteCommit` / `readScopedGateCache` / `writeScopedGateCache` / `defaultMechanicalSuiteCommand` / `newMechanicalSuiteRunId` / `appendFanInTrace` / `appendCompleteGateEvent` + 私有 `readTaskStatusAtRef` / `commitTaskStatusChange` / `flipTaskDone`。这些 28 个导出 + 4 个私有 helper **彼此紧密调用**，构成一个自包含的「机械 fan-in」子图。

**纠缠组 C（dispatch/orphan 区域内部）**：`classifyOrphanDispatch` / `orphanDispatchCandidates` / `computeOrphanFinalizedOutcome` / `computeAdoptedOutcome` / `finalizeOrphanDispatch` / `adoptOrphanWorker` / `readDispatchStore` / `writeDispatchStore` / `upsertDispatchRecord` / `removeDispatchRecord` / `readPidCmdline` 彼此调用，构成「orphan 恢复」子图。

**纠缠组 D（relatedness/重试豁免区域内部）**：R7 的 18 个导出 + 私有 `importHitsDelta` / `recurringSignatureTasks` 彼此调用（`classifyDeltaRelatedness` → `taskDeltaFiles`/`computeDeltaPaths`/`directImportRels`；`judgeRetryExemption` → `assertionSignaturesFromSuiteLog`/`suiteRedAttemptsInWindow`）。

### AC3-2：真正独立、可安全外移的导出组（有证据）

判定「独立」的判据：**该区域的导出对区域外的符号引用数 ≤ 2，且无外部区域反向调用它的私有 helper**（跨区域引用用 `sed -n '<range>p' | grep -oE '<区域外符号>' | uniq -c` 实测）。

| 独立组 | 行范围 | 行数 | 区域外引用（实测） | 独立度 |
|---|---|---|---|---|
| **R15 机械 fan-in** | `2581`–`3741` | **1161** | `scopedGateCommandFor` ×1（**唯一真实外部符号**；`computeLandingState` 仅注释提及，非调用） | **最高**（唯一实质依赖是 R5 的「scoped 门命令」，自带 `opts.scopedGateCommand ??` 注入缝，可迁入或共享） |
| R13 dispatch/orphan | `2007`–`2304` | 298 | `WORKER_DISPATCH_REL` / `hasLiveWorkerForTask` / `enumerateLiveWorkerCmdlines`（R2/R3 常量 + 探测） | 高（依赖几个常量 + 2 个探测函数，可参数化） |
| R7 relatedness/豁免 | `1243`–`1631` | 389 | `parseTouchEntriesWithTags`（touches-parser）等，纯函数集群 | 高（几乎纯函数） |
| R10 quick-death 退避 | `1761`–`1882` | 122 | 无外部区域引用（`QUICK_DEATH_FINAL_STATES` 是模块内私有） | 最高（纯状态机，零外部依赖） |
| R9 配置解析 | `1691`–`1760` | 70 | `defaultDriverConfig`（driver-config） | 高（纯解析函数） |
| R11 stash | `1883`–`1909` | 27 | 无 | 高 |

**不可外移的区域**：R2（常量被全文件消费）、R3（outcome/落地，被 R14/R15 反向依赖）、R14（`runOneWorker` 是中央编排器）、R16（`runResidentLoop`/`main` 是入口，消费几乎全部区域）。

---

## AC4 — 可执行拆分方案（至少一个，具体到导出清单 + 依赖 + 行数估计）

### 方案：分两期，第一期只拆一个干净缝，第二期按收益递减裁量

#### 第一期（强烈建议）：抽出 `worker-fan-in.ts`（R15 机械 fan-in，1161 行）

- **新文件**：`plugin/scripts/worker-fan-in.ts`，含 R15 全部 28 个导出 + 私有 helper（`MechShResult` `:2675`、`isNoiseLine` `:2767`、`isFailureSignalLine` `:2789`、`FAN_IN_LOCK_HOLDER` `:2897`、`writeSuiteCapture` `:2979`、`readTaskStatusAtRef` `:3018`、`commitTaskStatusChange` `:3029`、`flipTaskDone` `:3052`、`SUITE_LOG_DELIM` `:3183`）。
- **行数估计**：~1161 行（整段平移）。
- **外部依赖（实测只有 1 处真实调用，处理简单）**：
  - `scopedGateCommandFor`（×1，`runMechanicalFanIn` 内 `opts.scopedGateCommand ?? scopedGateCommandFor(task, worktree)`）——R5 的函数，与 fan-in 的 `scopedGateKey`/`readScopedGateCache`/`writeScopedGateCache` 同属「scoped 门」语义。**建议把 `scopedGateCommandFor` 一起迁到 `worker-fan-in.ts`（它本就是 fan-in 的 scoped 门命令）**，或抽一个 `worker-scoped-gate.ts` 两个文件共享。调用处已有 `opts.scopedGateCommand` 注入缝 ⇒ 即使不迁移，也可在测试里注入覆盖，迁移零阻塞。
  - 注：区域内的 `computeLandingState` 2 处出现**全部是注释**（`:3051`「⛔ 不各写一遍 computeLandingState」、`:3612`「landing 判定（computeLandingState）会据残留 worktree…」），非真实调用——fan-in 区域的落地判定由它自己的 `readTaskStatusAtRef`/`flipTaskDone` + ff 结果承担，不依赖 R3 的 `computeLandingState`。无需「落地判定注入」这一层。
- **回填**：`worker-driver.ts` 对 R15 的 28 个导出改 `export { ... } from "./worker-fan-in.ts"`（re-export 面，保持 11 个 test 文件的 import 面不变，零测试迁移成本）。主测试 `worker-driver-fan-in.test.mjs` 可随后改为直接 import `worker-fan-in.ts`。
- **收益**：4445 → ~3284 行，一次削掉 **26%**；把「机械 fan-in 编排」这个独立子系统从「worker 驱动」里分离，职责边界清晰（驱动 spawn worker vs 驱动跑 fan-in 是两件事，SPEC §5 阶段 2 的头注释也把二者分开描述）。
- **风险**：低。fan-in 区域只有 1 处真实外部调用（`scopedGateCommandFor`，语义清晰的「scoped 门命令」接缝、自带注入缝）；无共享可变状态可破。

#### 第二期（裁量，收益递减，按需）：

| 候选子模块 | 含哪些导出 | 行数 | 依赖 | 建议 |
|---|---|---|---|---|
| `worker-retry-exemption.ts` | R7 全部 18 导出（relatedness + 重试豁免） | ~389 | `touches-parser.ts` / `task-schema.ts`（纯函数集群） | **可拆**，纯函数、零跨区域可变依赖；但消费者只有 W/F 测试，收益中 |
| `worker-dispatch-store.ts` | R13 全部 13 导出（dispatch/orphan） | ~298 | `WORKER_DISPATCH_REL` / `hasLiveWorkerForTask` / `enumerateLiveWorkerCmdlines` | **可拆**，依赖可参数化；收益中 |
| `worker-quick-death.ts` | R10 全部 12 导出 + `QUICK_DEATH_FINAL_STATES` | ~122 | 无 | **可拆**（最干净的状态机），但体量小 |
| `worker-config.ts` | R9 全部 6 导出 | ~70 | `driver-config.ts` | **可拆**（纯解析），但体量小 |
| 保留在 `worker-driver.ts` | R2/R3/R4/R5/R6/R8/R11/R12/R14/R16（驱动主线 + 常量 + 落地判定 + prompt + 常驻环） | ~2600 | 内部互调 | **保留**——这是「驱动」本身，再拆就是把驱动骨架拆散，收益为负 |

**模块间依赖图（第一期落地后）**：

```
worker-driver.ts（驱动主线，~3284 行）
  ├─ import worker-fan-in.ts（机械 fan-in 编排）
  │     ├─ import driver-shared.ts / suite-driver.ts / suite-lock-slots.ts / mirror-full-suite-state.ts（已有）
  │     └─ 唯一真实文件内依赖 = scopedGateCommandFor（R5，迁入 worker-fan-in.ts 或共享，已有 opts 注入缝）
  ├─ re-export worker-fan-in.ts 的 28 个导出（保持旧 import 面）
  └─ …（其余不变）
```

**落盘约定**：第一期 = 一个 follow-up 任务可独立完成（只动 `worker-driver.ts` 的 re-export 面 + 新增 `worker-fan-in.ts` + 调整 1 处依赖 `scopedGateCommandFor`），第二期每项各一个可选任务。

---

## AC5 — 反向判据（「不拆」的证据；用于界定「拆到什么程度为止」）

本调查的结论是**「值得局部拆，但只拆到 R15 为止」**。对「为什么不进一步把 135 个导出全部原子化」给出可检验证据（不是「看起来复杂所以不拆」）：

1. **外部消费压力 = 0（可检验）**：`grep -rl "from .*worker-driver"`（非 node_modules）命中 **11 个 test 文件、0 个生产文件**（见 AC2-0）。「被 19 个生产实体广泛消费」的旧前提已失效 ⇒ 不存在「拆分以降低生产耦合」的迫切性。
2. **共享可变状态 = 0（可检验）**：模块级可变私有状态只有 2 个 `const`（`QUICK_DEATH_FINAL_STATES`、`FAN_IN_LOCK_HOLDER`），无模块级单例（见 AC3-0）。⇒ 不存在「拆分以解除共享闭包状态」的需求。
3. **纠缠形态是「线性链」不是「网状」（可检验）**：跨区域引用实测——R15 只回引 **1 处真实调用**（`scopedGateCommandFor`）；R16（入口）回引 ≥10 处、散布于 R4/R7/R12/R13/R15（符合「入口消费一切」的预期）；除 R15 外其余区域的私有 helper 无一被区域外引用。⇒ 拆 R15 收益明确（1161 行、26%），拆到 R13/R7 收益递减（每个仅 ~300 行，且各自已自包含、无共享状态风险）。
4. **re-export 面已是「半拆」状态（可检验）**：140 导出里 38 个符号（27%）已经是 re-export，定义在 5 个兄弟模块。⇒ 真正「在本文件内沉淀」的只有 135 导出 / ~4200 行，且其分布是「长线性 + 一个干净缝」，不是均匀的杂物堆。

**反例判定（一条命令可查）**：若未来 `worker-driver.ts` 行数继续增长（下一期超过 ~3300 行）或出现第 3 个模块级可变状态，则本「拆到 R15 为止」的结论需重评——那时 R13/R7 的拆分收益会重新超过其引入的 re-export 面成本。

---

## 附：可复核命令（读者可独立验证本文每个数字）

```bash
cd <repo-root>
wc -l plugin/scripts/worker-driver.ts                       # 4445
grep -c "^export " plugin/scripts/worker-driver.ts           # 140
grep -nE "^export " plugin/scripts/worker-driver.ts          # 导出清单 + 行号
# 消费者（AC2）
grep -rlE "from ['\"].*worker-driver(\.ts)?['\"]" --include="*.ts" --include="*.mjs" --include="*.js" . \
  | grep -vE "node_modules|/\.git/|quay-worktrees|/\.claude/worktrees/"
# 模块级私有声明（AC3）
grep -nE "^(const|let|var|function|async function|class|interface|type|enum) " plugin/scripts/worker-driver.ts \
  | grep -vE "^[0-9]+:(export )"
# 区域外引用（AC3/AC4）
sed -n '2581,3741p' plugin/scripts/worker-driver.ts | grep -oE "\b(computeLandingState|scopedGateCommandFor)\b" | sort | uniq -c
```
