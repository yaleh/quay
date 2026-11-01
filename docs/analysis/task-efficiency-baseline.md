# 任务级端到端效率基线（E1）
> 只读、可复跑。本文件由 `scripts/task-efficiency-baseline.mjs` 生成。
> 身份关联规则见工具 `--help`；费用/CPU 缺失维度明确 not-evaluated。

## 复跑命令
```bash
node scripts/task-efficiency-baseline.mjs --root /data/home/yale/work/quay --sessions-dir /data/home/yale/.claude/projects/-data-home-yale-work-quay --window-start 2026-08-23T07:18:06.081Z --window-end 2026-11-01T12:16:58.513Z
```

窗口（含）：`2026-08-23T07:18:06.081Z` → `2026-11-01T12:16:58.513Z`（时区 UTC）。

## 数据来源与字段清单
| 来源 | 记录数 | 字段 | 身份键 |
|---|---|---|---|
| worker-outcome.jsonl | 3584 | ts, task, selector_reason, exit_code, wall_clock_ms, final_state, started_at, ended_at, worker_pid, run_id, in_flight_count, timed_out, failure_reason, worktree_cleaned, … | (task, started_at, ts) |
| fan-in 过程日志 | 1435 | step/ts/wall_ms/ok | (task, run_id) + 尝试窗口 |
| fan-in-lock-events.jsonl | 5655 | event, ts, epoch, taskId, pid, runId, lock | (taskId, pid, ts) |
| verification-round.jsonl | 3263 | round, startedAt, durationMs, laneCount, pass, fail, cancelled, tests, per_test_ms, load, state, reason, runner, scope, … | (taskId, startedAt) — runId 是 fm-*/mfi-* 空间 |
| worker-round.jsonl | 67732 | ts, round, run_id, pid, action, in_flight, pool, stop_reason, liveness, cold_start_inflight, needs_human, needs_human_committed, in_flight_tasks, reconciled_needs_human, … | (round, run_id, ts) |
| fast-mode telemetry（按 runId 去重） | 340 | taskId, runId, minutes, outcome, _file, fanInCommit | (taskId, runId) — fm-* 空间，只盘点不 join |
| workflow events | 1092 | agentLabel, attempt, baseCommit, candidateId, commandIdentity, dispatchMode, eventKind, executionCwd, observedWrites, recordedAtMs, runId, schemaVersion, stage, taskId, … | runId |
| worker 会话 | 938 | sessionId/task/file | sessionId → taskId |
| CSV | 0 |  | 缺失（费用 not-evaluated） |

## 两套分母与聚合
| 量 | 值 |
|---|---|
| 尝试总数（窗口内，去重后） | 3581 |
| 去重丢弃的重复记录 | 0 |
| 缺 started_at 的记录（未纳入尝试） | 3 |
| 缺 ended_at 的尝试（时长 not-evaluable） | 0 |
| 不同任务数 | 1645 |
| 成功落地任务数（分母①） | 1471 |
| 所有尝试（分母②） | 3581 |
| 落地任务 / 所有尝试 | 0.411 |
| 有返工（>1 次尝试）的任务 | 797 |
| 单任务最大尝试数 | 27 |
| 被复用到 >1 任务的 run_id 数 | 43 |
| 尝试 wall-clock p50 / p90 | 24.4min / 56.6min |
| fan-in 锁等待 p50 / p90 | 44ms / 12.1min |
| suite 执行 p50 / p90（fan-in 日志） | 4.1min / 8.9min |
| suite 等槽 p50 / p90（verification-round lock_wait_ms，真实锁计量） | 4ms / 12.9min |
| suite 等槽可测尝试数 | 145 |
| CPU-seconds p50 / p90（仅 gnu-time 实测） | 51.2min / 2.06h |
| CPU-seconds 合计（仅 gnu-time 实测） | 2645.52h |
| ITE（Idle Time Efficiency，已归属墙钟/端到端）p50 / p90 | 0.181 / 0.617 |

final_state 分布：`{"completed":1597,"exited-not-landed":1807,"failed":176,"killed":1}`

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
- 有 suite 记录关联的尝试：3179
- 有 gnu-time CPU 实测的尝试：337（9.4%）
- 有 fan-in 锁等待读数的尝试：2355

### 费用维度
**not-evaluated**：未提供 `--csv`。所缺输入：把 attempt→费用 映射的 CSV（含 task/attempt 身份与计费额）。⛔ 不把 token 估计写成实际账单。

### CPU 维度
只取 `verification-round.jsonl` 中 `cpu_time_s` 且 `cpu_source=gnu-time` 的实测值。其余记录不参与 CPU 聚合。

### ready 事件维度
ready 事件 = `gate-events.jsonl` 中 gate=promote 的条数：**99**。gate 分布：`{"retreat":169,"complete":1366,"acceptance":22,"dod":108,"promote":99,"goal":695672,"dark-axis":207,"goal-merge-request":22,"goal-merge-result":66,"adr-001":28,"adr-007":28}`

## suite 跑/跳过/分类失败分母（AC5，尝试级：从本次尝试 fan-in trace 步骤直接数）
| 类别 | 尝试数 |
|---|---|
| suite 跑（有 suite-end） | 2039 |
| suite 跳过（suite-skip） | 116 |
| suite 未完成（suite-incomplete，起了没 end） | 0 |
| 分类失败（有 trace 但无 suite-end/skip/incomplete） | 204 |
| suite recovery 阻塞（suite-recovery-blocked） | 34 |
> ⛔ 不用 11/177（历史分类失败次数）或全窗口平均并发替代真实分母。

## 每任务明细（AC3：累计墙钟/ITE/返工；费用 not-evaluated，无 CSV）
> 只列尝试数最多的前 20 个任务。cost=not-evaluated（未提供费用 CSV）。
| task | 尝试 | 返工 | 累计 wall | ITE | 落地 |
|---|---|---|---|---|---|
| gap-retire-session-liveness | 27 | 26 | 855.1min | 0.118 | true |
| gap-test-file-snapshot-worktree-drops-realinstall | 23 | 22 | 444.2min | 0.486 | true |
| gap-ac207-e2e-target-driver-driven-real-commit-task-done | 20 | 19 | 469.8min | 0.012 | true |
| gap-bypass-check-unclassifiable-exits-zero | 17 | 16 | 445.0min | 0.523 | true |
| gap-mechanical-fan-in-writes-no-complete-gateevent | 17 | 16 | 342.7min | 0.428 | true |
| gap-web-session-drops-queue-operation-records | 17 | 16 | 260.0min | 0.000 | true |
| gap-execution-loop-productization-p2-p4 | 16 | 15 | 377.6min | 0.323 | true |
| gap-ac301-criterion-carrier-absence-not-evaluated | 16 | 15 | 181.0min | 0.234 | true |
| gap-verification-round-static-fail-no-record | 15 | 14 | 518.3min | 0.000 | false |
| gap-ac179-criterion-cmdline-port-literal-stale | 15 | 14 | 211.0min | 0.357 | true |
| gap-ac303-criterion-carrier-absence-not-evaluated | 15 | 14 | 162.6min | 0.221 | true |
| gap-suite-round-pass-fail-cancel-parser-breaks-under-force-color-ansi | 14 | 13 | 595.9min | 0.000 | false |
| gap-scd-load-sensitive-bucket-isolation | 14 | 13 | 548.7min | 0.082 | true |
| gap-retire-governance-group-merge-into-bucket | 14 | 13 | 357.9min | 0.264 | true |
| gap-suite-split-long-multi-test-files | 13 | 12 | 907.1min | 0.000 | false |
| gap-full-suite-runner-test-poll-timeout-load-flake | 13 | 12 | 389.7min | 0.000 | false |
| gap-meta-carrierstats | 13 | 12 | 327.6min | 0.532 | true |
| gap-scoped-gate-m120-negative-control-false-positive | 13 | 12 | 232.1min | 0.382 | true |
| gap-ac291-criterion-carrier-absence-not-evaluated | 13 | 12 | 153.5min | 0.270 | true |
| gap-retire-inner-session-references | 12 | 11 | 418.8min | 0.072 | false |

## 无法关联记录与覆盖率
| 载体 | 总量 | 可关联 | 无法唯一关联/未归属 |
|---|---|---|---|
| verification-round.jsonl | 3263 | 3016 | 247（缺 runId/taskId） |
| fan-in 过程日志（尝试级） | 3581 | 2359 | 1222（无日志/窗口外） |

## 轮数分解（可下钻至原会话）
> 分类是启发式（每轮 = 一条 assistant 消息）：exploration（首次 Read/Grep/Glob/find）/ tool-wait（本轮无工具动作，等待/思考）/ repeated-read（再读已读文件）/ verification（测试/task_check/gate）/ fix（Edit/Write/git 变更）/ unclassified（无法判断，保守单列）。下钻靠 sessionId（会话 jsonl）。
| 类别 | 轮数 |
|---|---|
| exploration | 12058 |
| tool-wait | 93205 |
| repeated-read | 3403 |
| verification | 19277 |
| fix | 12225 |
| unclassified | 35154 |

- worker 会话数：938；总轮数：175322
- 不能分类者单列（unclassified）：35154

抽查（每任务尝试数与 sessionId 可见，下钻到 `/data/home/yale/.claude/projects/-data-home-yale-work-quay/<sessionId>.jsonl`）：
| task | sessionId | 轮数 | exploration | verification | fix | unclassified |
|---|---|---|---|---|---|---|
| gap-routine-architecture-analysis-god-package-serve-view-7368b251 | 0030eedc-1ab0-453f-b976-81787a96d815 | 277 | 31 | 29 | 15 | 60 |
| gap-routine-semantic-dedup-scan-canonical-buckets | 00577cde-205d-4910-b8fc-5a8105ce2086 | 154 | 25 | 24 | 19 | 16 |
| gap-serve-host-spawned-in-caller-session-cgroup-dies-when-cloudcli-restarts | 00a687e2-536f-4d5c-b41b-d241236b8bfe | 251 | 21 | 34 | 25 | 37 |
| gap-shipped-plugin-tree-excludes-dev-only-content-and-has-a-shrink-only-size-ratchet | 00c8d772-96c6-42af-b080-83c0d7d840be | 354 | 13 | 52 | 50 | 57 |
| gap-meta-goaldriverchildtimeoutms | 0118571c-def8-416d-bf35-636a98474ec5 | 414 | 66 | 40 | 48 | 47 |
| gap-discovery-method-reflection-unified-trigger-and-candidate-generation | 01850ecc-6a39-4c26-a477-0c744fadb4a0 | 459 | 24 | 28 | 27 | 71 |
| gap-goal911-exit-condition3-unencapsulated-e2e-uncovered | 01b6b614-2e1e-4aa2-8487-39adb98e0f1a | 228 | 43 | 8 | 5 | 56 |
| gap-ac322-goal-branch-catchup-landing-real-reading | 01bbd38e-8c4b-474a-bee6-431ea3b014a4 | 96 | 6 | 8 | 3 | 26 |
| gap-serve-host-has-no-loaded-version-reading-driver-status-covers-anchor-only | 020d67af-370a-4ee6-8cfd-81f455ec8e05 | 218 | 7 | 32 | 11 | 49 |
| gap-ac356-criterion-environment-fatal-window-check-unsatisfiable | 023192d3-36b9-4c3d-baca-6fbac9de1ba7 | 62 | 1 | 0 | 0 | 27 |
| gap-fan-in-lock-hold-pairing-two-divergent-keys | 02376212-f911-4aa5-975e-752e37994944 | 190 | 10 | 18 | 13 | 39 |
| gap-routine-semantic-dedup-scan-read-file-join-root-pair | 028cebb3-ade5-4542-8fdc-fb757537df48 | 123 | 14 | 15 | 4 | 21 |
| gap-goal904-merge-drill-record-doc | 02ba4dac-4291-4974-9376-585b48db385a | 130 | 12 | 10 | 10 | 22 |
| gap-goal-merge-infra-red-mislabelled-and-rerequest-never-retries | 031a9eda-a56c-4e56-a018-5db260418681 | 45 | 0 | 4 | 0 | 13 |
| gap-architecture-analysis-probe-not-wired-into-driver-routine-or-init | 031d175e-8aa2-4cfd-83cb-a42b97d9155c | 75 | 3 | 15 | 1 | 17 |
| gap-routine-semantic-dedup-scan-read-file-or-empty | 032f08ed-1925-4af9-8ed5-fa97ade422de | 244 | 65 | 6 | 14 | 27 |
| gap-codex-mcp-sync-installs-stale-dist-from-detached-worktree | 03323a1c-d02c-4836-9a5d-57306de6aa61 | 184 | 24 | 15 | 10 | 44 |
| gap-cross-project-semantic-dogfooding-routine-configurable-source-projects | 033f2a79-8e1d-47ce-b84e-e4194d887f10 | 105 | 2 | 4 | 3 | 34 |
| gap-goal033-selfhost-and-archguard-evidence | 034ebb38-466e-41f0-bcdc-b49b408936f7 | 220 | 22 | 5 | 5 | 71 |
| gap-codex-plugin-surface-not-installable | 03b73ec3-b700-4da6-b50c-441723cc15e5 | 110 | 9 | 15 | 8 | 16 |

## E5 证据（锁等待 + 持续队列 + 资源门/ready 池空；只输出证据，不启动锁改造）
| 量 | 值 |
|---|---|
| fan-in 锁等待 p50 / p90 / max | 44ms / 12.1min / 111.5min |
| fan-in 锁等待可测尝试数 | 2355 |
| 队列等待（queuedAt→startedAt）p50 / p90 | not-evaluated / not-evaluated |
| 队列等待可测记录 / 缺 queuedAtMs 记录 | 0 / 394（缺值 = 未查，⛔ 不是 0） |
| ready 池空轮数（pool-empty） | 48376 |
| 资源门阻塞轮数（resource-gate-wait） | 691 |
| 派发环 stop_reason 分布 | `{"dispatched(no-stop)":2823,"resource-gate-wait":691,"mcp-halt":3810,"backoff":939,"filtered-empty":11093,"pool-empty":48376}` |
| 持续队列/阻塞证据（pool-empty + resource-gate-wait） | 49067 轮 |
| 锁等待显著（p50>60s）？ | false |

结论：吞吐瓶颈是否成立，本报告保持未知——只给锁等待与队列/阻塞的直接读数；不修改锁、fail-closed、AC/DoD 或 G3。

## 抽查实例（DoD：至少一个多次尝试任务 + 一个无法关联实例）
多次尝试任务：`gap-worker-driver-fake-completion-exit-0`（4 次尝试）
- started_at 2026-08-23T11:16:33.761Z final_state=completed wall=43.8min fanInLockWait=not-evaluated suiteExec=not-evaluated landed=true
- started_at 2026-08-23T12:14:01.887Z final_state=completed wall=19.2min fanInLockWait=not-evaluated suiteExec=not-evaluated landed=true
- started_at 2026-08-23T12:36:00.463Z final_state=completed wall=25.1min fanInLockWait=not-evaluated suiteExec=not-evaluated landed=true
- started_at 2026-08-23T13:02:56.039Z final_state=completed wall=19.5min fanInLockWait=not-evaluated suiteExec=not-evaluated landed=true
无法唯一关联实例（verification-round 缺 runId/taskId）：`{"round":1,"startedAt":"2026-08-12T03:28:00.289Z","runId":null,"taskId":null}`
