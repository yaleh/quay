# 任务级端到端效率基线（E1）
> 只读、可复跑。本文件由 `scripts/task-efficiency-baseline.mjs` 生成。
> 身份关联规则见工具 `--help`；费用/CPU 缺失维度明确 not-evaluated。

## 复跑命令
```bash
node scripts/task-efficiency-baseline.mjs --root /data/home/yale/work/quay --sessions-dir /data/home/yale/.claude/projects/-data-home-yale-work-quay --window-start 2026-08-23T07:18:06.081Z --window-end 2026-11-01T12:16:58.513Z
```

窗口（含）：`2026-08-23T07:18:06.081Z` → `2026-11-01T12:16:58.513Z`（时区 UTC）。

代码版本 / 输入指纹：`git HEAD=8f76183a6458`，脚本 sha256=`3c1b87d3206e`，输入 sha256=`da4efe02d715`。

## 数据来源与字段清单
| 来源 | 记录数 | 字段 | 身份键 |
|---|---|---|---|
| worker-outcome.jsonl | 3592 | ts, task, selector_reason, exit_code, wall_clock_ms, final_state, started_at, ended_at, worker_pid, run_id, in_flight_count, timed_out, failure_reason, worktree_cleaned, … | (task, started_at, ts) |
| fan-in 过程日志 | 1440 | step/ts/wall_ms/ok | (task, run_id) + 尝试窗口 |
| fan-in-lock-events.jsonl | 5670 | event, ts, epoch, taskId, pid, runId, lock | (taskId, pid, ts) |
| verification-round.jsonl | 3270 | round, startedAt, durationMs, laneCount, pass, fail, cancelled, tests, per_test_ms, load, state, reason, runner, scope, … | round（全局唯一）→ (taskId, startedAt) |
| worker-round.jsonl | 67807 | ts, round, run_id, pid, action, in_flight, pool, stop_reason, liveness, cold_start_inflight, needs_human, needs_human_committed, in_flight_tasks, reconciled_needs_human, … | (round, run_id, ts) |
| fast-mode telemetry（按 runId 去重） | 340 | taskId, runId, minutes, outcome, _file, fanInCommit | (taskId, runId) — fm-* 空间，只盘点不 join |
| workflow events | 1092 | agentLabel, attempt, baseCommit, candidateId, commandIdentity, dispatchMode, eventKind, executionCwd, observedWrites, recordedAtMs, runId, schemaVersion, stage, taskId, … | runId |
| worker 会话 | 945 | sessionId/task/file | sessionId → taskId |
| CSV | 0 |  | 缺失（费用 not-evaluated） |

## 两套分母与聚合
| 量 | 值 |
|---|---|
| 尝试总数（窗口内，去重后） | 3581 |
| 去重丢弃的重复记录 | 0 |
| 缺 started_at 的记录（未纳入尝试） | 3 |
| 缺 ended_at 的尝试（时长 not-evaluable） | 0 |
| 不同任务数 | 1645 |
| 成功落地任务数（分母①，仅 ff ok 证明） | 1274 |
| 明确未落地任务数 | 12 |
| 落地未知任务数（证据不足，不计入成功分母） | 359 |
| 所有尝试（分母②） | 3581 |
| 落地任务 / 所有尝试 | 0.356 |
| 有返工（>1 次尝试）的任务 | 797 |
| 单任务最大尝试数 | 27 |
| 被复用到 >1 任务的 run_id 数 | 43 |
| 尝试 wall-clock p50 / p90 | 24.4min / 56.6min |
| fan-in 锁等待 p50 / p90 | 44ms / 12.1min |
| suite 执行 p50 / p90（fan-in 日志） | 4.1min / 8.9min |
| suite 等槽 p50 / p90（verification-round lock_wait_ms，真实锁计量） | 1.3min / 17.4min |
| suite 等槽可测记录数（唯一 suite） | 81 |
| 验证时长 p50 / p90（verification-round durationMs，身份去重） | 4.6min / 10.1min（2592 条唯一 suite） |
| CPU-seconds p50 / p90（仅 gnu-time 实测，身份去重） | 50.3min / 1.95h |
| CPU-seconds 合计（仅 gnu-time 实测，身份去重后） | 235.15h（217 条唯一 suite；另有 242 条 gnu-time 记录未唯一归属，不参与聚合） |
| 墙钟归属覆盖率 p50 / p90（attributedWallMs / endToEndWallMs） | 0.334 / 0.686 |
| 墙钟归属覆盖率 >1（重叠/重复累计，不截断）的尝试 | 11 |

final_state 分布：`{"completed":1597,"exited-not-landed":1807,"failed":176,"killed":1}`
落地状态分布：`{"unknown":1274,"not-landed":1029,"landed":1278}`
suite 关联分布：`{"proven":2379,"missing":1198,"ambiguous":4}`

## 分阶段墙钟（有 fan-in 日志的尝试）
> 只有真实可测部分可宣称已建立基线；CPU 只取真实 CPU 计量（cpu_source=gnu-time），⛔ 不用 wall-time 换算。
| 阶段 | 累计 wall_ms | 覆盖尝试数（2359） |
|---|---|---|
| suite-end | 615143255 | 2359 |
| acquire-fan-in-lock | 560028677 | 2359 |
| scoped-gate | 111125378 | 2359 |
| doc-check | 47421511 | 2359 |
| suite-recovery | 34268749 | 2359 |
| merge-develop | 32442609 | 2359 |
| rerun | 19078709 | 2359 |
| baseline-red | 15141635 | 2359 |
| suite-recovery-baseline-exempt | 13800320 | 2359 |
| ff | 11577412 | 2359 |
| suite-recovery-certified | 2234722 | 2359 |
| archguard-structure | 1939229 | 2359 |
| typecheck | 1831619 | 2359 |
| cleanup | 1392149 | 2359 |
| ac-precheck | 963736 | 2359 |
| suite-recovery-new-regression | 901060 | 2359 |
| ac-gate | 685024 | 2359 |
| delta | 541775 | 2359 |
| anti-drift | 521911 | 2359 |
| anti-drift-land | 317718 | 2359 |
| catch-up-develop | 271557 | 2359 |
| flip-done | 160781 | 2359 |
| instrument-probe | 118213 | 2359 |
| slice-readings-post | 111921 | 2359 |
| release-fan-in-lock | 32692 | 2359 |
| verification-round-record | 9936 | 2359 |
| append-complete-gate-event | 2867 | 2359 |
| doc-face-done-sync | 2068 | 2359 |
| dark-axis | 261 | 2359 |
| suite-start | 0 | 2359 |
| suite-skip | 0 | 2359 |
| suite-rerun-green | 0 | 2359 |
| baseline-red-exempt | 0 | 2359 |
| suite-incomplete | 0 | 2359 |
| suite-recovery-blocked | 0 | 2359 |
| suite-recovery-accepted | 0 | 2359 |
| develop-red-set | 0 | 2359 |

- 有 trace 的尝试：2359 / 3581
- 有 proven suite 记录关联的尝试：2379
- 有 gnu-time CPU 实测（且 proven 关联）的尝试：163（4.6%）
- 有 fan-in 锁等待读数的尝试：2355

### 费用维度
**not-evaluated**：未提供 `--csv`。所缺输入：把 attempt→费用 映射的 CSV（含 task/attempt 身份与计费额）。⛔ 不把 token 估计写成实际账单。

### CPU 维度
只取 `verification-round.jsonl` 中 `cpu_time_s` 且 `cpu_source=gnu-time` 的实测值，且该记录被**唯一**关联到某次尝试（proven）。歧义/未归属记录单列、不参与 CPU 聚合。

### ready 事件维度
ready 事件 = `gate-events.jsonl` 中 gate=promote 的条数：**99**。gate 分布：`{"retreat":169,"complete":1373,"acceptance":22,"dod":108,"promote":99,"goal":696707,"dark-axis":214,"goal-merge-request":22,"goal-merge-result":66,"adr-001":28,"adr-007":28}`

## suite 结局分类（AC5，尝试级互斥）
| 类别 | 尝试数 | 说明 |
|---|---|---|
| suite 跑完（suite-end，完整 verdict） | 1979 | green=1162 red=817 |
| suite 未完成（suite-incomplete verdict） | 60 | suite-end 为 red 且 files 不完整 |
| suite 跳过（suite-skip，doc-only） | 116 | |
| 缺结束事件（suite-start 无 end/skip/incomplete） | 37 | 日志不足，⛔ 不算分类失败 |
| 前序中止（有日志、未到 suite-start） | 167 | delta/doc-check/typecheck/ac-precheck/anti-drift 等前序拒绝 |
| 分类器失败（明确证据） | 0 | instrument-probe 明确 classifier≠available |
| 缺日志（无 fan-in trace） | 1222 | 无法判断 |
> ⛔ 「无 suite-end/skip」不再自动判为分类失败；分类失败只认 instrument-probe 的明确失败证据。

## 每任务明细（AC3：累计墙钟/墙钟归属覆盖率/返工；费用 not-evaluated，无 CSV）
> 只列尝试数最多的前 20 个任务。cost=not-evaluated（未提供费用 CSV）。landed=证明落地；not-landed=明确未落地；unknown=证据不足。
| task | 尝试 | 返工 | 累计 wall | 墙钟归属覆盖均值 | 落地 |
|---|---|---|---|---|---|
| gap-retire-session-liveness | 27 | 26 | 855.1min | 0.139 | landed |
| gap-test-file-snapshot-worktree-drops-realinstall | 23 | 22 | 444.2min | 0.486 | landed |
| gap-ac207-e2e-target-driver-driven-real-commit-task-done | 20 | 19 | 469.8min | 0.121 | landed |
| gap-bypass-check-unclassifiable-exits-zero | 17 | 16 | 445.0min | 0.556 | landed |
| gap-mechanical-fan-in-writes-no-complete-gateevent | 17 | 16 | 342.7min | 0.428 | landed |
| gap-web-session-drops-queue-operation-records | 17 | 16 | 260.0min | not-evaluated | unknown |
| gap-execution-loop-productization-p2-p4 | 16 | 15 | 377.6min | 0.431 | unknown |
| gap-ac301-criterion-carrier-absence-not-evaluated | 16 | 15 | 181.0min | 0.234 | landed |
| gap-verification-round-static-fail-no-record | 15 | 14 | 518.3min | not-evaluated | unknown |
| gap-ac179-criterion-cmdline-port-literal-stale | 15 | 14 | 211.0min | 0.446 | landed |
| gap-ac303-criterion-carrier-absence-not-evaluated | 15 | 14 | 162.6min | 0.237 | landed |
| gap-suite-round-pass-fail-cancel-parser-breaks-under-force-color-ansi | 14 | 13 | 595.9min | not-evaluated | unknown |
| gap-scd-load-sensitive-bucket-isolation | 14 | 13 | 548.7min | 0.572 | landed |
| gap-retire-governance-group-merge-into-bucket | 14 | 13 | 357.9min | 0.411 | landed |
| gap-suite-split-long-multi-test-files | 13 | 12 | 907.1min | not-evaluated | unknown |
| gap-full-suite-runner-test-poll-timeout-load-flake | 13 | 12 | 389.7min | not-evaluated | unknown |
| gap-meta-carrierstats | 13 | 12 | 327.6min | 0.577 | landed |
| gap-scoped-gate-m120-negative-control-false-positive | 13 | 12 | 232.1min | 0.382 | landed |
| gap-ac291-criterion-carrier-absence-not-evaluated | 13 | 12 | 153.5min | 0.270 | landed |
| gap-retire-inner-session-references | 12 | 11 | 418.8min | 0.215 | landed |

## 无法关联记录与覆盖率（AC3）
| 量 | 值 |
|---|---|
| verification-round.jsonl 总量 | 3270 |
| 唯一 suite 数（proven 关联） | 2592 |
| 关联覆盖率（唯一 suite / 总量） | 0.793 |
| 未归属/歧义/缺身份记录 | 678 |
| fan-in 过程日志（尝试级）：有 trace | 2359 / 3581 |

## 轮数分解（可下钻至原会话）
> 分类是启发式（每轮 = 一条 assistant 消息）：exploration（首次 Read/Grep/Glob/find）/ tool-wait（本轮无工具动作，等待/思考）/ repeated-read（再读已读文件）/ verification（测试/task_check/gate）/ fix（Edit/Write/git 变更）/ unclassified（无法判断，保守单列）。下钻靠 sessionId（会话 jsonl）。
| 类别 | 轮数 |
|---|---|
| exploration | 12189 |
| tool-wait | 93805 |
| repeated-read | 3448 |
| verification | 19376 |
| fix | 12282 |
| unclassified | 35404 |

- worker 会话数：945；总轮数：176504
- 不能分类者单列（unclassified）：35404

## E5 证据（锁等待 + 队列等待 + 供给/资源拒绝；只输出直接读数，不做无依据推断）
| 量 | 值 |
|---|---|
| fan-in 锁等待 p50 / p90 / max | 44ms / 12.1min / 111.5min |
| fan-in 锁等待可测尝试数 | 2355 |
| 队列等待（queuedAt→startedAt）p50 / p90 | not-evaluated / not-evaluated |
| 队列等待可测记录 / 缺 queuedAtMs 记录 | 0 / 394（缺值 = 未查，⛔ 不是 0） |
| ready 池空轮数（pool-empty，供给状态） | 48408 |
| 资源门阻塞轮数（resource-gate-wait，资源拒绝） | 691 |
| 派发环 stop_reason 分布 | `{"dispatched(no-stop)":2823,"resource-gate-wait":691,"mcp-halt":3810,"backoff":939,"filtered-empty":11136,"pool-empty":48408}` |
| 持续队列判定 | not-evaluated（需要待处理量/等待区间直接证据；pool-empty + resource-gate-wait 相加不等于持续队列） |

结论：吞吐瓶颈是否成立，本报告保持未知——只给锁等待、队列等待、供给/资源拒绝的直接读数；不修改锁、fail-closed、AC/DoD 或 G3。

## 抽查实例（AC6：历史重派任务 / 误关联验证轮 / 受测但未证实落地）
重派任务：`gap-retire-session-liveness`（27 次尝试）
| started_at | final_state | wall | suite 关联 | 落地 |
|---|---|---|---|---|
| 2026-09-03T09:13:10.489Z | exited-not-landed | 79.5min | missing | not-landed |
| 2026-09-03T10:33:19.465Z | exited-not-landed | 16.7min | missing | not-landed |
| 2026-09-03T10:50:51.244Z | exited-not-landed | 9.5min | missing | not-landed |
| 2026-09-03T11:09:44.314Z | exited-not-landed | 10.8min | missing | not-landed |
| 2026-09-03T11:21:24.317Z | exited-not-landed | 7.1min | missing | not-landed |
| 2026-09-03T11:29:14.196Z | exited-not-landed | 7.2min | missing | not-landed |
| 2026-09-03T11:55:38.003Z | exited-not-landed | 76.7min | missing | not-landed |
| 2026-09-03T13:13:19.772Z | exited-not-landed | 25.1min | missing | not-landed |
| 2026-09-03T13:39:09.888Z | exited-not-landed | 16.5min | missing | not-landed |
| 2026-09-03T15:11:52.594Z | failed | 17.0min | missing | unknown |
| 2026-09-03T15:29:31.847Z | exited-not-landed | 91.1min | missing | not-landed |
| 2026-09-03T17:01:29.766Z | exited-not-landed | 7.3min | missing | not-landed |
| 2026-09-03T17:09:32.392Z | exited-not-landed | 16.1min | missing | not-landed |
| 2026-09-03T22:15:26.537Z | exited-not-landed | 42.5min | missing | not-landed |
| 2026-09-03T22:58:30.403Z | exited-not-landed | 35.5min | missing | unknown |
| 2026-09-03T23:34:48.088Z | exited-not-landed | 40.6min | missing | not-landed |
| 2026-09-04T00:21:57.831Z | exited-not-landed | 73.5min | missing | not-landed |
| 2026-09-04T01:36:10.933Z | exited-not-landed | 8.2min | missing | not-landed |
| 2026-09-04T01:45:15.963Z | exited-not-landed | 19.4min | missing | not-landed |
| 2026-09-04T02:34:35.708Z | failed | 87.8min | missing | unknown |
| 2026-09-04T04:03:07.643Z | failed | 18.7min | missing | unknown |
| 2026-09-04T04:22:29.072Z | exited-not-landed | 47.2min | missing | not-landed |
| 2026-09-04T05:10:26.150Z | exited-not-landed | 7.8min | missing | not-landed |
| 2026-09-04T05:18:56.876Z | exited-not-landed | 35.9min | proven | not-landed |
| 2026-09-04T06:08:27.030Z | exited-not-landed | 13.1min | missing | not-landed |
| 2026-09-04T06:22:16.979Z | exited-not-landed | 24.3min | missing | not-landed |
| 2026-09-04T06:47:29.052Z | completed | 19.8min | proven | landed |
误关联验证轮示例：`gap-git-history-branch-summary-wrong-numbers` 尝试 started_at=2026-08-23T12:02:29.450Z 窗口内无 suite 记录（association=missing），旧实现会回填同任务其它 1 条记录；新口径判 missing/unknown，不把后一次落地回填给前一次。
受测但未证实落地示例：`gap-scheduler-inflight-detection-misses-fan-in-worktree` started_at=2026-08-23T07:18:06.081Z 受测 SHA=`8f92267886fe7deed1853c64a15c7b2b6cd64610`（suite 记录 round=441）但无 ff ok ⇒ 落地=unknown（受测 SHA 不是落地证据）。

## 旧报告撤回与修正（口径修正）
> 本任务（gap-task-efficiency-baseline-attribution-semantics）撤回旧口径下的下列读数，并给修正值/未评估。
| 旧口径读数 | 旧值 | 修正值/处置 | 原因 |
|---|---|---|---|
| 成功落地任务数（分母①） | 1471 | 1274 | 旧口径把 verification-round.commit 非空当落地；现在只有 ff ok 才证明落地 |
| CPU-seconds 合计 | 2645.52h | 235.15h | 旧口径按尝试累加，同一 suite 记录被回填到多个尝试 ⇒ 翻倍；现在按唯一 suite 身份去重 |
| 分类失败（有 trace 但无 suite-end/skip） | 204 | 0（明确分类器失败），前序中止 167，缺结束事件 37 | 旧口径把「suite 没跑完」全判成分类失败；现在分类失败只认明确证据 |
| ITE（Idle Time Efficiency）p50 / p90 | 0.181 / 0.617 | 墙钟归属覆盖率 p50/p90 0.334 / 0.686 | 旧名把「已归属墙钟/端到端」误称为 Idle Time Efficiency；已改独立指标并去 Math.min(1,…) 截断 |
| 持续队列/阻塞证据（pool-empty + resource-gate-wait） | 49067 轮 | not-evaluated | pool-empty 只代表供给状态、resource-gate-wait 只代表资源拒绝，两者相加不是持续队列 |
| 锁等待显著（p50>60s）？ | false | 已撤销该自动判词 | 阈值无依据；只保留描述性分位数 |
