# 任务级端到端效率基线（E1）
> 只读、可复跑。本文件由 `scripts/task-efficiency-baseline.mjs` 生成。
> 身份关联规则见工具 `--help`；费用/CPU 缺失维度明确 not-evaluated。

## 复跑命令
```bash
node scripts/task-efficiency-baseline.mjs --root /data/home/yale/work/quay --sessions-dir /data/home/yale/.claude/projects/-data-home-yale-work-quay --window-start 2026-10-26T16:00:00.000Z --window-end 2026-11-02T16:00:00.000Z
```

窗口（含）：`2026-10-26T16:00:00.000Z` → `2026-11-02T16:00:00.000Z`（时区 UTC）。

代码版本 / 输入指纹：`git HEAD=e36f26a201f1`，脚本 sha256=`65a754d0b521`，输入 sha256=`3262f7e600e4`。

## 数据来源与字段清单
| 来源 | 记录数 | 字段 | 身份键 |
|---|---|---|---|
| worker-outcome.jsonl | 3611 | ts, task, selector_reason, exit_code, wall_clock_ms, final_state, started_at, ended_at, worker_pid, run_id, in_flight_count, timed_out, failure_reason, worktree_cleaned, … | (task, started_at, ts) |
| fan-in 过程日志 | 1565 | step/ts/wall_ms/ok | (task, run_id) + 尝试窗口 |
| fan-in-lock-events.jsonl | 5710 | event, ts, epoch, taskId, pid, runId, lock | (taskId, pid, ts) |
| verification-round.jsonl | 3294 | round, startedAt, durationMs, laneCount, pass, fail, cancelled, tests, per_test_ms, load, state, reason, runner, scope, … | round（全局唯一）→ (taskId, startedAt) |
| worker-round.jsonl | 69161 | ts, round, run_id, pid, action, in_flight, pool, stop_reason, liveness, cold_start_inflight, needs_human, needs_human_committed, in_flight_tasks, reconciled_needs_human, … | (round, run_id, ts) |
| fast-mode telemetry（按 runId 去重） | 340 | taskId, runId, minutes, outcome, _file, fanInCommit | (taskId, runId) — fm-* 空间，只盘点不 join |
| workflow events | 1092 | agentLabel, attempt, baseCommit, candidateId, commandIdentity, dispatchMode, eventKind, executionCwd, observedWrites, recordedAtMs, runId, schemaVersion, stage, taskId, … | runId |
| worker 会话 | 893 | sessionId/task/file | sessionId → taskId |
| CSV | 0 |  | 缺失（费用 not-evaluated） |

## 两套分母与聚合
| 量 | 值 |
|---|---|
| 尝试总数（窗口内，去重后） | 130 |
| 去重丢弃的重复记录 | 0 |
| 缺 started_at 的记录（未纳入尝试） | 3 |
| 缺 ended_at 的尝试（时长 not-evaluable） | 0 |
| 不同任务数 | 94 |
| 成功落地任务数（分母①，仅 ff ok 证明） | 94 |
| 明确未落地任务数 | 0 |
| 落地未知任务数（证据不足，不计入成功分母） | 0 |
| 所有尝试（分母②） | 130 |
| 落地任务 / 所有尝试 | 0.723 |
| 有返工（>1 次尝试）的任务 | 27 |
| 单任务最大尝试数 | 7 |
| 被复用到 >1 任务的 run_id 数 | 1 |
| 尝试 wall-clock p50 / p90 | 33.0min / 59.8min |
| fan-in 锁等待 p50 / p90 | 14ms / 29.7min |
| suite 执行 p50 / p90（fan-in 日志） | 8.5min / 15.4min |
| suite 等槽 p50 / p90（verification-round lock_wait_ms，真实锁计量） | not-evaluated / not-evaluated |
| suite 等槽可测记录数（唯一 suite） | 0 |
| 验证时长 p50 / p90（verification-round durationMs，身份去重） | 8.2min / 15.1min（129 条唯一 suite） |
| CPU-seconds p50 / p90（仅 gnu-time 实测，身份去重） | not-evaluated / not-evaluated |
| CPU-seconds 合计（仅 gnu-time 实测，身份去重后） | 0.0s（0 条唯一 suite；另有 459 条 gnu-time 记录未唯一归属，不参与聚合） |
| 墙钟归属覆盖率 p50 / p90（attributedWallMs / endToEndWallMs） | 0.491 / 0.796 |
| 墙钟归属覆盖率 >1（重叠/重复累计，不截断）的尝试 | 0 |

final_state 分布：`{"completed":93,"exited-not-landed":34,"failed":3}`
落地状态分布：`{"landed":94,"not-landed":24,"unknown":12}`
落地证据来源分布（log / step-trace / both / unknown）：`{"both":94,"unknown":36}`
suite 关联分布：`{"proven":98,"missing":32}`

## 分阶段墙钟（有 fan-in 日志的尝试）
> 只有真实可测部分可宣称已建立基线；CPU 只取真实 CPU 计量（cpu_source=gnu-time），⛔ 不用 wall-time 换算。
| 阶段 | 累计 wall_ms | 覆盖尝试数（113） |
|---|---|---|
| acquire-fan-in-lock | 62231270 | 113 |
| suite-end | 51797415 | 113 |
| suite-recovery-baseline-exempt | 5628649 | 113 |
| rerun | 4240090 | 113 |
| suite-recovery-certified | 4113493 | 113 |
| suite-recovery | 4016390 | 113 |
| baseline-red | 3989225 | 113 |
| scoped-gate | 3636897 | 113 |
| doc-check | 2500049 | 113 |
| merge-develop | 1427407 | 113 |
| suite-recovery-new-regression | 1080788 | 113 |
| ff | 977687 | 113 |
| cleanup | 212705 | 113 |
| slice-readings-post | 71699 | 113 |
| typecheck | 55496 | 113 |
| catch-up-develop | 49843 | 113 |
| ac-precheck | 30489 | 113 |
| ac-gate | 25793 | 113 |
| anti-drift | 17096 | 113 |
| delta | 13702 | 113 |
| instrument-probe | 12713 | 113 |
| anti-drift-land | 12643 | 113 |
| flip-done | 6096 | 113 |
| delta-shadow | 2095 | 113 |
| release-fan-in-lock | 582 | 113 |
| doc-face-done-sync | 385 | 113 |
| dark-axis | 195 | 113 |
| append-complete-gate-event | 44 | 113 |
| suite-start | 0 | 113 |
| suite-incomplete | 0 | 113 |
| suite-recovery-accepted | 0 | 113 |
| baseline-red-exempt | 0 | 113 |
| develop-red-set | 0 | 113 |
| suite-skip | 0 | 113 |
| suite-rerun-green | 0 | 113 |
| suite-recovery-blocked | 0 | 113 |

- 有 trace 的尝试：113 / 130
- 有 proven suite 记录关联的尝试：98
- 有 gnu-time CPU 实测（且 proven 关联）的尝试：0（0.0%）
- 有 fan-in 锁等待读数的尝试：113

### 费用维度
**not-evaluated**：未提供 `--csv`。所缺输入：把 attempt→费用 映射的 CSV（含 task/attempt 身份与计费额）。⛔ 不把 token 估计写成实际账单。

### CPU 维度
只取 `verification-round.jsonl` 中 `cpu_time_s` 且 `cpu_source=gnu-time` 的实测值，且该记录被**唯一**关联到某次尝试（proven）。歧义/未归属记录单列、不参与 CPU 聚合。

### ready 事件维度
ready 事件 = `gate-events.jsonl` 中 gate=promote 的条数：**99**。gate 分布：`{"retreat":169,"complete":1389,"acceptance":22,"dod":108,"promote":99,"goal":704676,"dark-axis":230,"goal-merge-request":22,"goal-merge-result":66,"adr-001":31,"adr-007":31}`

## suite 结局分类（AC5，尝试级互斥）
| 类别 | 尝试数 | 说明 |
|---|---|---|
| suite 跑完（suite-end，完整 verdict） | 72 | green=27 red=45 |
| suite 未完成（suite-incomplete verdict） | 20 | suite-end 为 red 且 files 不完整 |
| suite 跳过（suite-skip，doc-only） | 13 | |
| 缺结束事件（suite-start 无 end/skip/incomplete） | 6 | 日志不足，⛔ 不算分类失败 |
| 前序中止（有日志、未到 suite-start） | 2 | delta/doc-check/typecheck/ac-precheck/anti-drift 等前序拒绝 |
| 分类器失败（明确证据） | 0 | instrument-probe 明确 classifier≠available |
| 缺日志（无 fan-in trace） | 17 | 无法判断 |
> ⛔ 「无 suite-end/skip」不再自动判为分类失败；分类失败只认 instrument-probe 的明确失败证据。

## 每任务明细（AC3：累计墙钟/墙钟归属覆盖率/返工；费用 not-evaluated，无 CSV）
> 只列尝试数最多的前 20 个任务。cost=not-evaluated（未提供费用 CSV）。landed=证明落地；not-landed=明确未落地；unknown=证据不足。
| task | 尝试 | 返工 | 累计 wall | 墙钟归属覆盖均值 | 落地 |
|---|---|---|---|---|---|
| gap-goal-branch-preview-trial-surface-declarable | 7 | 6 | 212.0min | 0.372 | landed |
| gap-codex-mcp-cwd-any-root-spawn-verify | 3 | 2 | 102.2min | 0.297 | landed |
| gap-routine-semantic-dedup-scan-transcript-set-copy | 3 | 2 | 84.8min | 0.560 | landed |
| gap-instrument-decay-suite-recovery-groups-unadjudicated | 3 | 2 | 44.8min | 0.823 | landed |
| gap-meta-codex-stage1-spawn-verify-sh | 3 | 2 | 39.7min | 0.166 | landed |
| gap-routine-architecture-analysis-probe-fallback-instrument-archived-undeclared | 2 | 1 | 154.6min | 0.835 | landed |
| gap-routine-architecture-analysis-god-package-serve-view-7368b251 | 2 | 1 | 138.4min | 0.625 | landed |
| gap-routine-semantic-dedup-scan-a1 | 2 | 1 | 129.0min | 0.598 | landed |
| gap-routine-semantic-dedup-scan-normalize-touched | 2 | 1 | 126.0min | 0.910 | landed |
| gap-routine-architecture-analysis-god-package-core | 2 | 1 | 99.2min | 0.556 | landed |
| gap-codex-plugin-mcp-json-nested-in-wrong-level | 2 | 1 | 95.4min | 0.204 | landed |
| gap-e1-baseline-window-ignored-by-rounds-e5 | 2 | 1 | 93.9min | 0.701 | landed |
| gap-goal912-merge-suite-gitignore-blanket-and-l1-test-stale | 2 | 1 | 90.9min | 0.684 | landed |
| gap-role-effort-tiering-selector-pool-judge-meta-driver | 2 | 1 | 82.7min | 0.502 | landed |
| gap-codex-plugin-json-version-not-a-carrier | 2 | 1 | 77.7min | 0.381 | landed |
| gap-codex-mcp-sync-installs-stale-dist-from-detached-worktree | 2 | 1 | 73.4min | 0.423 | landed |
| gap-quay-init-codex-host-trio-laydown | 2 | 1 | 68.4min | 0.313 | landed |
| gap-routine-architecture-analysis-fan-hub-quay-src | 2 | 1 | 66.8min | 0.145 | landed |
| gap-routine-semantic-dedup-scan-is-ancestor-three-semantics | 2 | 1 | 64.6min | 0.666 | landed |
| gap-routine-architecture-analysis-dup-parse-iso-since-two-verbs | 2 | 1 | 62.4min | not-evaluated | landed |

## 无法关联记录与覆盖率（AC3）
| 量 | 值 |
|---|---|
| verification-round.jsonl 总量 | 3294 |
| 唯一 suite 数（proven 关联） | 129 |
| 关联覆盖率（唯一 suite / 总量） | 0.039 |
| 未归属/歧义/缺身份记录 | 3165 |
| fan-in 过程日志（尝试级）：有 trace | 113 / 130 |

## 轮数分解（可下钻至原会话）
窗口：`2026-10-26T16:00:00.000Z` → `2026-11-02T16:00:00.000Z`；unwindowed 会话：764（窗口外 764，缺时间戳 0，不计入窗口读数）。
> 分类是启发式（每轮 = 一条按 message.id 去重后的 assistant 消息）：exploration（首次 Read/Grep/Glob/find）/ tool-wait（本轮无工具动作，等待/思考）/ repeated-read（再读已读文件）/ verification（测试/task_check/gate）/ fix（Edit/Write/git 变更）/ unclassified（无法判断，保守单列）。下钻靠 sessionId（会话 jsonl）。
| 类别 | 轮数 |
|---|---|
| exploration | 2189 |
| tool-wait | 146 |
| repeated-read | 447 |
| verification | 2189 |
| fix | 1314 |
| unclassified | 4107 |

- worker 会话数：129；总轮数（按 message.id 去重）：10392
- 缺 message.id 逐条计 1 轮的记录（roundsMissingId，⛔ 不与去重后的轮数合并）：0
- 不能分类者单列（unclassified）：4107

## E5 证据（锁等待 + 队列等待 + 供给/资源拒绝；只输出直接读数，不做无依据推断）
窗口：`2026-10-26T16:00:00.000Z` → `2026-11-02T16:00:00.000Z`；队列等待 unwindowed：394（窗口外 394，缺 recordedAtMs 0）；stop_reason unwindowed：62449（窗口外 62449，缺 ts 0）。
| 量 | 值 |
|---|---|
| fan-in 锁等待 p50 / p90 / max | 14ms / 29.7min / 111.5min |
| fan-in 锁等待可测尝试数 | 113 |
| 队列等待（queuedAt→startedAt）p50 / p90 | not-evaluated / not-evaluated |
| 队列等待可测记录 / 缺 queuedAtMs 记录 | 0 / 0（缺值 = 未查，⛔ 不是 0） |
| ready 池空轮数（pool-empty，供给状态） | 5711 |
| 资源门阻塞轮数（resource-gate-wait，资源拒绝） | 9 |
| 派发环 stop_reason 分布 | `{"filtered-empty":818,"dispatched(no-stop)":95,"pool-empty":5711,"resource-gate-wait":9,"mcp-halt":79}` |
| 持续队列判定 | not-evaluated（需要待处理量/等待区间直接证据；pool-empty + resource-gate-wait 相加不等于持续队列） |

结论：吞吐瓶颈是否成立，本报告保持未知——只给锁等待、队列等待、供给/资源拒绝的直接读数；不修改锁、fail-closed、AC/DoD 或 G3。

## 抽查实例（AC6：历史重派任务 / 误关联验证轮 / 受测但未证实落地）
重派任务：`gap-goal-branch-preview-trial-surface-declarable`（7 次尝试）
| started_at | final_state | wall | suite 关联 | 落地 |
|---|---|---|---|---|
| 2026-10-29T07:48:18.629Z | failed | 3.7s | missing | unknown |
| 2026-10-29T09:22:29.055Z | exited-not-landed | 50.8min | proven | not-landed |
| 2026-10-29T11:10:37.360Z | exited-not-landed | 30.5min | proven | not-landed |
| 2026-10-29T11:42:05.100Z | exited-not-landed | 23.5min | proven | not-landed |
| 2026-10-29T12:07:30.760Z | exited-not-landed | 22.9min | proven | not-landed |
| 2026-10-29T12:31:35.670Z | exited-not-landed | 44.4min | proven | not-landed |
| 2026-10-29T13:17:07.026Z | completed | 39.9min | proven | landed |
误关联验证轮示例：`gap-instrument-decay-suite-recovery-groups-unadjudicated` 尝试 started_at=2026-10-26T23:00:29.439Z 窗口内无 suite 记录（association=missing），旧实现会回填同任务其它 1 条记录；新口径判 missing/unknown，不把后一次落地回填给前一次。
受测但未证实落地示例：`gap-routine-semantic-dedup-scan-normalize-touched` started_at=2026-10-26T22:02:42.934Z 受测 SHA=`3a994966c45f6b9cd5b1a6c45e56512076f1e17c`（suite 记录 round=3110）但无 ff ok ⇒ 落地=not-landed（受测 SHA 不是落地证据）。

## 旧报告撤回与修正（口径修正）
> 本任务（gap-e1-round-count-and-landing-carrier）撤回旧口径下的下列读数，并给修正值。复跑命令见文首。
| 旧口径读数 | 旧值 | 修正值 | 原因 |
|---|---|---|---|
| 轮数（同窗口 totalRounds） | 22,863 | 10392 | 旧口径按 `type:assistant` 行数计，同一 `message.id` 被 apiBlockIndex 拆成多条记录（thinking/text/tool_use）重复计 ⇒ 2.2× 高估；这是「未按 message.id 去重的行数口径」。现在按 message.id 去重（缺 id 单列 roundsMissingId=0） |
| 成功落地任务数（同窗口 landedTasks） | 77 | 94 | 旧口径只读 `.log` 且 (a) 按文件名 `!f.includes("suite")` 误排除 task 名含 suite 的 `.log`、(b) 以尝试窗口 `[started_at, ended_at]` 上界过滤 ff（而 ff 发生在 worker ended_at 之后）⇒ 少算 17 个落地任务。现在修复 `.log` 扫描、并集 `fan-in-step-trace.jsonl` 的 `step=ff` 的 `step-end` 且 `ok:true`，且 ff 只归给任务最后一条尝试（落地证据来源分布 log/step-trace/both/unknown=`{"both":94,"unknown":36}`） |
