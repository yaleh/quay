# worker-driver 日志载体单一正本（worker-driver-log-carriers）

> **单一真相源**（DIR-028 / ADR-004「单一真相源 + 可执行不变式」）：worker-driver 写/读的全部观测载体。
> 任何「worker-driver 的日志写在哪 / 写什么 / 失败记什么」的判据只引用本文件，⛔ 不在别处复制一份
> 载体清单（复制即漂移，同 CLAUDE.md「清单属于各自正本」）。
>
> **可执行源（本文件不复制其字段/逻辑，只指路）**：
> - `plugin/scripts/worker-driver.ts` — outcome / round / 机械 fan-in 单步 log / suite capture / lock 事件 / archguard 镜像。
> - `plugin/scripts/driver-runtime.ts` — `statePaths()` 派生的进程/存活状态路径（prefix=`worker-driver`，`DRIVER_KINDS.worker`）。
> - `plugin/scripts/suite-driver.ts` — `spawnSuiteAndWait` 的 suite 裸流 log（worker-driver 直接调它，⛔ 不经常驻 suite loop）。

---

## 关键不变量（失败必记 stdout+stderr）

> **机械 fan-in 每一步（merge / delta / typecheck / archguard / scoped-gate / doc / suite / anti-drift /
> ac-gate / flip / ff）失败时，其 stdout+stderr 必须全量可观测——⛔ 不做 stderr 优先、⛔ 不丢弃任一流。**
>
> **为什么**（`gap-scoped-gate-reason-stderr-drops-stdout` 实证）：旧 `fail()` 的 `a.stderr || a.stdout`
> 短路，当 stderr 恒非空恒良性（refresh 成功行 + `MODULE_TYPELESS` 噪声）时，stdout 的真失败签名
> （esbuild `Could not resolve` / node:test `not ok`）被整体丢弃 ⇒ reason 与「没失败」同形（硬规则 3b/4b/9
> 同族：未知异常签名不可枚举，故必须记全两流，而非假设「失败都在 stderr」）。
>
> **机件**（worker-driver.ts）：
> - `combinedOutput(stdout, stderr)` — 合并两流的单一机件（⛔ 不丢任一流），`fail()` 与 flip 共用；
> - `fail(step, a)` — 合并流【全量】dump 进 `/tmp/fan-in-step-<task>-<runId>-<step>.log`，`reason`
>   是 `extractFailureSummary(合并流)` 的去噪摘要（⛔ 裸流、⛔ 只取 stderr）；
> - flip 的 `git add`/`git commit` 失败 reason 用 `combinedOutput`（⛔ 旧 `a.stderr || exit` 丢 stdout）。
>
> **已知边界（本任务如实记录，不隐藏）**：suite 裸流的 stderr 在 `spawnSuiteAndWait` 里只做静默看门狗
> 活性检测（`lastActivityMs`），⛔ 不落盘——`/tmp/fan-in-suite-<task>-<runId>.log` 只持久化 stdout。
> （suite 的 stdout 是 TAP/构建结果主通道；stderr 落盘属 suite-driver 的独立改动面，非本任务 Touches。）

---

## 载体清单

### A. 运行时 JSONL 日志（gitignored，`<root>/.quay/`）

| 载体 | 写者 | 何时写 | 每行/内容 |
|---|---|---|---|
| `.quay/worker-outcome.jsonl` | `appendOutcome` / `appendOutcomeToFile`（worker-driver.ts:788，**含 `assertFinalState` 词表闸**） | 每任务终态一次（取值见下「`final_state` 的成功态是 `completed`」；**成功态 = `completed`**） | 终态、exit_code、reason、worker_pid、run_id、session_id、wall clock、`mechanical_fan_in{step, verdict{step,exitCode,summary,logFile}, reason, lockHoldSecs, suiteOutcome, suitePid, landedSha}`、worktree_cleanup_* |
| `.quay/worker-round.jsonl` | `appendRoundToFile` / `computeWorkerRoundRecord`（worker-driver.ts:844） | 常驻循环【每轮】无条件一条（含池空/判停轮，作 liveness 直接量） | ts（首字段）、round、run_id、pid、action(start/dispatch/idle/stop)、in_flight、pool、stop_reason、liveness、cold_start_inflight、needs_human、needs_human_committed |

- **分工**（⛔ 不混用）：outcome 只在任务真终态写；round 每轮写。池空时 outcome 停更会被 supervisor
  `last_record_ts`（读全载体 max）误读为「死亡」，故 round 是无条件心跳。
- **机械 fan-in 的权威记录**：`runMechanicalFanIn` 结果整体落进 outcome 的 `mechanical_fan_in`——
  单步失败是 `verdict`（step / summary / logFile 指针），不是裸流投影进 reason（D5/D6/D7 单一结构化来源）。

#### ⚠️ `final_state` 的成功态是 `completed`——⛔ 不是 `landed`（同名陷阱）

同一条 outcome 记录里躺着**两个词表**，它们描述**同一个事件**（机械 fan-in 是否落地）却**不同名**：

| 字段 | 成功取值 | 词表正本（⛔ 本文件不复制全表） |
|---|---|---|
| `final_state`（顶层） | **`completed`** | `worker-driver.ts` `FINAL_STATES` / `isFinalState` |
| `mechanical_fan_in.outcome`（子对象） | `landed` | `worker-driver.ts` `runMechanicalFanIn` 的 outcome 联合类型 |

⇒ **`landed` 不是 `final_state` 的取值**（本仓库另有**第三个**用 `landed` 的词表：live 页的
`InFlightPhase`，与本节无关——⛔ 别把三处一起「清理」）。

- **实证代价**（`gap-worker-outcome-final-state-landed-is-a-dead-value`）：生产载体里出现过 **1** 条
  `final_state:"landed"` 的记录（2026-08-28，一次**手工** fan-in 的手写落盘——非 `worker-driver.ts`
  任何代码路径所写）。任何按 `final_state == "landed"` 统计吞吐的消费者会读到 **0**，与「系统完全停摆」
  **同形且不可区分**（硬规则 3b/4b）；本任务的定量复核作者本人在初稿里就栽了这一跤。
- **enforce（不是靠记得）**：`assertFinalState` 挂在**唯一落盘点** `appendOutcomeToFile` 上 ⇒
  词表外的取值**写不进去**（抛错 + 不留半条记录），而不仅是在文档里声明它不合法（硬规则 9）。
  负控制：`plugin/test/worker-driver.test.mjs` 传 `"landed"` 必须抛。
- **读数口径**（用载体量吞吐）：成功态计数取 `final_state == "completed"` 的**任务数**；
  分母若用 `git log | grep '翻 … done'` 的**提交数**会**高估**（同一任务可在一天内被多次翻 done ⇒
  重复计数，实测 09-09 提交 71 vs 去重任务 54）。实测：去重任务口径下 09-08 → 09-14 连续 7 天
  成功态计数与落地数的偏差 ≤4.8%（见 `docs/analysis/suite-got-5x-faster-and-throughput-did-not-follow.md` §6）。

### B. 机械 fan-in 单步 / suite 裸流（`/tmp/`，⛔ 非 git，跨 relaunch 带 runId 隔离）

| 载体 | 写者 | 内容 |
|---|---|---|
| `/tmp/fan-in-step-<task>-<runId>-<step>.log` | `fail()` → `stepLogFile`（worker-driver.ts:1937） | 该步失败时的 stdout+stderr【全量】dump（⛔ 不丢任一流）。路径进 `mechanical_fan_in.verdict.logFile`，reason 只含去噪 summary |
| `/tmp/fan-in-suite-<task>-<runId>.log` | `spawnSuiteAndWait`（suite-driver.ts:200） | suite 子进程 stdout（append 追加，跨 relaunch 不轮转故文件名带 runId）。**stderr 只做活性检测，⛔ 不落盘**（见上「已知边界」） |
| `/tmp/fan-in-suite-<task>.env` | `writeSuiteCapture`（worker-driver.ts:1791） | suite capture 证书（ff 闸 fan-in-ff-merge.sh 读）：full_suite_ran / skip_reason / suite_exit / suite_head / start_iso / end_iso |

- 单步 log 命名带 `runId`（`gap-fan-in-suite-log-cross-relaunch-reuse`：不带 runId 会跨 relaunch 残留旧轮内容）。

### C. 锁载体

| 载体 | 写者 | 内容 |
|---|---|---|
| `<git-common-dir>/fan-in-workflow.lock` | `fanInWorkflowLockFile`（worker-driver.ts:1705） | flock 锁文件（ADR-034：driver 经非分离子进程持锁，driver 死 ⇒ 内核关 fd ⇒ 自动释放，⛔ 无时间阈值） |
| `.quay/fan-in-workflow-lock-events.jsonl` | `FAN_IN_WORKFLOW_LOCK_HOLDER`（worker-driver.ts:1713） | acquire/release 事件：event、ts、epoch、taskId、pid、runId、agentId。读者 `readWorkflowLockHold` → `mechanical_fan_in.lockHoldSecs` |

### D. archguard 结构信号镜像

| 载体 | 写者 | 内容 |
|---|---|---|
| `<root>/.archguard/metrics-history.jsonl` | `mirrorArchguardMetrics`（worker-driver.ts:1829） | archguard-runner 写进 worktree 的 `.archguard/metrics-history.jsonl` 最后一条，镜像到主检出——worktree 的 `.archguard/` 随 `git worktree remove` 被删 ⇒ 必须持久化到主检出（硬规则④推论三：能产出≠已产出） |

### E. 控制 / 状态文件

| 载体 | 写者 | 内容 |
|---|---|---|
| `.quay/worker-control.json` | `writeControlState`（driver-shared.ts，re-export） | 驱动停机态单一真相源：schemaVersion、halted、halted_by、halted_at、preference{}、forced[]。⛔ 驱动不读 `.halt`（AC117 退役清单） |
| `.quay/full-suite-state.json` | `mirrorMechanicalFanInSuiteState`（worker-driver.ts:2083）→ `buildMirrorState`/`writeMirrorState` | 权威 suite 状态；机械 fan-in 的 bucket suite 绿后镜像（state、startedAt、finishedAt、durationMs、laneCount、commit、taskId、runId、runner=inner、scope=worktree）。⛔ 不伪造 full-green（scope/taskId 区分 bucket-run 与 full-run） |

### F. 进程 / 存活状态（driver-runtime.ts `statePaths()`，prefix=`worker-driver`）

| 载体 | 内容 |
|---|---|
| `.quay/worker-driver.pid` | driver 自身 pid（worker kind `pidSelf=false` ⇒ 不自写，用 inflight 文件做派发抓手） |
| `.quay/worker-driver-inflight.pid` | 在飞 worker pid（`--pid-file` 缺省目标；`appendWorkerPid` 原子 append，一行一 pid） |
| `.quay/worker-driver-supervisor.pid` | supervisor pid |
| `.quay/worker-driver.log` | driver 进程 stdout/stderr |
| `.quay/worker-driver-supervisor.log` | supervisor 进程 stdout/stderr |
| `.quay/worker-driver-liveness.log` | liveness 告警（`ok` / `DEATH` 行，`writeLivenessLog`） |
| `.quay/worker-driver.stop` | stop sentinel |

- **liveness 两个落点分工**：检查结果（ok/checked/DEATH）每轮嵌入 `worker-round.jsonl` 的 `liveness` 字段；
  告警行另落 `.quay/worker-driver-liveness.log`（供 supervisor 侧告警）。

### G. 边界 / 退役（本文件如实记录，非 worker-driver 写）

- **suite-driver 自己的载体**（常驻 suite loop，⛔ 非 worker-driver 的 suite 步）：`.quay/suite-round.jsonl`
  （三态 outcome done/red/hung）、`.quay/suite-control.json`、`.quay/suite-requests/`、`.quay/suite-results/`。
  worker-driver 直调 `spawnSuiteAndWait`（不经常驻 loop），故其 suite 步【不】写这些——suite 裸流只进
  `/tmp/fan-in-suite-<task>-<runId>.log`，outcome 进 `mechanical_fan_in.suiteOutcome`。
- **`.halt`** — 对驱动已退役（worker-driver.ts:79-83），仍被旧三层循环的 halt-check.sh / slot-refill.ts 消费。
- **`.quay/manager-inbox/`** — 已删除（人 2026-08-20 裁定范围A）。

---

## 为什么这份正本必须存在（防 reason 载体失真再犯）

可观测性载体失真（硬规则 3b/4b/9 同族）已复发 6+ 次：reason stderr 优先丢 stdout / resource.node_count
comm 恒 0 / outer.ticklog 行形谓词 / goal.phase_ac_checked 复选框 / verification-round cpu_usec / pgrep
comm 恒零。共同形态：**「读不懂 ⇒ 与『合格/没失败』同形」**——载体词表里没有「未评估」这一态，或只记了
其中一流。未知异常签名不可枚举 ⇒ 检测器补不完；机制修法是【每步记全两流】+【本文件把载体和不变式钉在
一处】，让任何「记在哪 / 记什么」的判据都能被【一条 grep 或读文件】当场核实，而不是靠想起。
