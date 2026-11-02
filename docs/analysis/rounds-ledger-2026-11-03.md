# 轮数台账（按落地任务）
> 只读、可复跑。本文件由 `scripts/rounds-ledger.mjs` 生成。
> 轮 = 按 `message.id` 去重后的 assistant 消息；落地 = fan-in-step-trace 的 `ff` 步骤 `ok:true`。

## 复跑命令
```bash
node scripts/rounds-ledger.mjs --root /data/home/yale/work/quay --sessions-dir /data/home/yale/.claude/projects/-data-home-yale-work-quay --window-start 2026-10-26T16:00:00.000Z --window-end 2026-11-02T16:00:00.000Z
```

窗口（含）：`2026-10-26T16:00:00.000Z` → `2026-11-02T16:00:00.000Z`（UTC）。
代码版本 / 输入指纹：git HEAD=`8ab2c4d49064`，脚本 sha256=`7c2c2f3cd53b`，输入 sha256=`dca66cb7d3a1`。

## 基线复现（AC3）
| 量 | 值 | 目标 |
|---|---|---|
| 落地任务数 | 94 | 94 |
| worker 会话数 | 129 | 129 |
| 轮数 | 10392 | 10,392 |
| 轮 / 任务 | 110.55 | 110.6 |
| 加权 eq（0.1×/5×） | 185.792M | 185.8M |
| 加权 eq（0.05×/5×） | 123.482M | （仅记录） |

## 数据来源
| 来源 | 记录数 | 用途 |
|---|---|---|
| 会话文件（扫描） | 4094 | 会话→任务 / 轮数 / 阶段 / 成本 |
| 其中非 worker 会话 | 3197 | 排除 |
| worker 但读不到 Task id（not-evaluated） | 0 | 单列，不猜 |
| 窗口外/缺时间戳会话（unwindowed） | 768（窗口外 768，缺时间戳 0） | 不计入窗口读数 |
| worker-outcome.jsonl | 3608 | 返工归因 |
| fan-in-step-trace.jsonl | 24218 | 落地 / fan-in-red（任务级，全量） |
| 全量 ff ok 事件 | 876 | 落地证据 |
| 全量 ok:false 步骤 | 1460 | fan-in-red 证据 |

## 全局阶段占比（AC4）
> 阶段是启发式（每轮 = 一条按 message.id 去重后的 assistant 消息）；无工具/无法映射的轮单列 unclassified。
| 阶段 | 轮数 | 占比 |
|---|---|---|
| verify | 1812 | 17.4% |
| edit | 947 | 9.1% |
| inspect | 4877 | 46.9% |
| fix | 912 | 8.8% |
| orchestration | 1412 | 13.6% |
| unclassified | 432 | 4.2% |

- 总轮数：10392；缺 message.id 逐条计 1 轮的记录：0；缺 usage 的轮（成本 not-evaluated）：0

## top 10 任务阶段拆解（AC4）
| task | 会话 | 轮 | eq(0.1×) | verify | edit | inspect | fix | orchestration | unclassified | 返工 |
|---|---|---|---|---|---|---|---|---|---|---|
| gap-goal-branch-preview-trial-surface-declarable | 7 | 443 | 9.724M | 88 | 36 | 209 | 26 | 76 | 8 | crash-or-timeout |
| gap-codex-plugin-mcp-json-nested-in-wrong-level | 2 | 322 | 7.418M | 51 | 38 | 165 | 39 | 13 | 16 | worker-exited |
| gap-codex-mcp-cwd-any-root-spawn-verify | 3 | 246 | 5.044M | 40 | 15 | 126 | 25 | 30 | 10 | fan-in-red |
| gap-real-install-family-build-dedup-once-per-suite | 1 | 244 | 4.801M | 68 | 29 | 114 | 21 | 5 | 7 | — |
| gap-routine-architecture-analysis-god-package-serve-view-7368b251 | 2 | 218 | 4.420M | 31 | 9 | 123 | 19 | 27 | 9 | fan-in-red |
| gap-routine-architecture-analysis-god-package-core | 2 | 216 | 4.174M | 41 | 4 | 104 | 20 | 31 | 16 | fan-in-red |
| gap-routine-semantic-dedup-scan-transcript-set-copy | 3 | 208 | 2.548M | 62 | 24 | 70 | 23 | 19 | 10 | fan-in-red |
| gap-routine-semantic-dedup-scan-a1 | 2 | 201 | 3.745M | 32 | 3 | 108 | 27 | 23 | 8 | fan-in-red |
| gap-quay-init-codex-host-trio-laydown | 2 | 198 | 4.136M | 40 | 22 | 107 | 15 | 11 | 3 | fan-in-red |
| gap-routine-architecture-analysis-fan-hub-quay-src | 2 | 193 | 3.655M | 24 | 10 | 92 | 29 | 31 | 7 | fan-in-red |

## 会话级下钻（AC4，top 1 任务）
任务：`gap-goal-branch-preview-trial-surface-declarable`（7 会话，443 轮）
| 会话 | 轮 | verify | edit | inspect | fix | orchestration | unclassified | 结局 |
|---|---|---|---|---|---|---|---|---|
| 3361c3eb-1dbc-433a-8c2e-9ddf22f96330 | 1 | 0 | 0 | 0 | 0 | 0 | 1 | crash-or-timeout |
| 1fa95090-b66f-40de-9af9-f1e467fb999c | 135 | 20 | 26 | 69 | 11 | 8 | 1 | crash-or-timeout |
| a376aa0c-49b1-4625-a044-b0f624fdbbd7 | 59 | 14 | 6 | 25 | 2 | 11 | 1 | crash-or-timeout |
| 71658115-f9e8-437f-91d9-f70ad79e7c1f | 35 | 7 | 0 | 13 | 2 | 12 | 1 | crash-or-timeout |
| fffbf274-f991-4577-9346-919ff1005518 | 39 | 11 | 0 | 12 | 0 | 15 | 1 | crash-or-timeout |
| 823bc9bf-08f3-4154-9aee-5ffc98908609 | 87 | 18 | 1 | 45 | 5 | 16 | 2 | crash-or-timeout |
| 12673518-a2d4-40cd-a611-c02d7b0348b9 | 87 | 18 | 3 | 45 | 6 | 14 | 1 | landed |

## 返工台账（AC5）
> 非首次会话按任务级归因后广播到每个返工会话；unknown 单列、不并入已知类。
| 原因 | 返工会话数 | 占比 |
|---|---|---|
| crash-or-timeout | 8 | 22.9% |
| fan-in-red | 25 | 71.4% |
| worker-exited | 2 | 5.7% |
| superseded | 0 | 0.0% |
| unknown | 0 | 0.0% |

- 返工会话总数：35；落地证据不足的任务（有会话但无 step-trace ff ok，not-evaluated）单列：0
| task | 原因 | 返工会话 | 轮 |
|---|---|---|---|
| gap-goal-branch-preview-trial-surface-declarable | crash-or-timeout | 6 | 443 |
| gap-codex-plugin-mcp-json-nested-in-wrong-level | worker-exited | 1 | 322 |
| gap-codex-mcp-cwd-any-root-spawn-verify | fan-in-red | 2 | 246 |
| gap-routine-architecture-analysis-god-package-serve-view-7368b251 | fan-in-red | 1 | 218 |
| gap-routine-architecture-analysis-god-package-core | fan-in-red | 1 | 216 |
| gap-routine-semantic-dedup-scan-transcript-set-copy | fan-in-red | 2 | 208 |
| gap-routine-semantic-dedup-scan-a1 | fan-in-red | 1 | 201 |
| gap-quay-init-codex-host-trio-laydown | fan-in-red | 1 | 198 |
| gap-routine-architecture-analysis-fan-hub-quay-src | fan-in-red | 1 | 193 |
| gap-codex-mcp-sync-installs-stale-dist-from-detached-worktree | fan-in-red | 1 | 191 |
| gap-codex-plugin-json-version-not-a-carrier | fan-in-red | 1 | 166 |
| gap-instrument-decay-suite-recovery-groups-unadjudicated | fan-in-red | 2 | 162 |
| gap-routine-architecture-analysis-probe-fallback-instrument-archived-undeclared | fan-in-red | 1 | 157 |
| gap-routine-semantic-dedup-scan-is-ancestor-three-semantics | fan-in-red | 1 | 150 |
| gap-codex-mcp-json-overwrites-claude-plugin-mcp-json | fan-in-red | 1 | 150 |
| gap-codex-plugin-surface-not-installable | fan-in-red | 1 | 145 |
| codex-stage1-live-proof-check | fan-in-red | 1 | 140 |
| gap-meta-codex-stage1-spawn-verify-sh | crash-or-timeout | 2 | 135 |
| gap-routine-architecture-analysis-retired-gate-scripts-hand-synced-orphan | fan-in-red | 1 | 134 |
| gap-goal-branch-unmerged-goal-912 | fan-in-red | 1 | 133 |
| gap-role-effort-tiering-selector-pool-judge-meta-driver | fan-in-red | 1 | 129 |
| gap-mcp-blacklist-extend-meta-cc-archguard-plantuml | fan-in-red | 1 | 124 |
| gap-routine-semantic-dedup-scan-normalize-touched | fan-in-red | 1 | 111 |
| gap-instrument-decay-postlanding-two-rounds | worker-exited | 1 | 103 |
| gap-goal912-merge-suite-gitignore-blanket-and-l1-test-stale | fan-in-red | 1 | 102 |
| gap-e1-baseline-window-ignored-by-rounds-e5 | fan-in-red | 1 | 98 |

---

## 窗口口径差异（AC3 的「差异原因」：Plan §4 写 17:00，基线对应 16:00）

> 本任务 Plan §4 写的固定窗口是 `2026-10-26T16:00:00Z → 2026-11-02T17:00:00Z`，但
> Proposal 的基线（129 会话 / 10,392 轮 / 110.6 轮/任务 / 185.8M eq）对应的窗口终点是
> `2026-11-02T16:00:00Z`（正好 7 天，与 Proposal 的「7 天」一致）。两者差异**只有一条会话**，
> 逐项列出，不静默改口径。

| 项目 | 17:00 终点（Plan §4 字面） | 16:00 终点（= 7 天，基线） | 差异 |
|---|---|---|---|
| 落地任务数 | 94 | 94 | 无 |
| worker 会话数 | 130 | 129 | +1 |
| 轮数 | 10,414 | 10,392 | +22 |
| 轮 / 任务 | 110.79 | 110.55 | +0.24 |
| 加权 eq（0.1×/5×） | 186.158M | 185.792M | +0.366M |

差异会话：`gap-prompt-inline-data-scan` 的会话 `e02058f0-c961-46a2-be9b-002e9eb89d66`
（首条时间戳 `2026-11-02T16:13:43.874Z`，22 轮）。它落在 17:00 终点内、16:00 终点外，
所以 17:00 口径多 1 会话 / 22 轮 / 0.366M eq。基线（129/10,392/185.8M）只能在 16:00 终点复现；
本报告主口径用 16:00 终点，17:00 口径如上表单列。

复跑命令（两窗口差异）：
```bash
node scripts/rounds-ledger.mjs --json --window-start 2026-10-26T16:00:00Z --window-end 2026-11-02T16:00:00Z
node scripts/rounds-ledger.mjs --json --window-start 2026-10-26T16:00:00Z --window-end 2026-11-02T17:00:00Z
```

---

## E1 交叉核对（AC6：同窗口、同任务子集）

> 与本工具同源/可比的部分逐项列出；不可比的部分不声称「一致」。

| 字段 | rounds-ledger | E1（task-efficiency-baseline） | 可比性 |
|---|---|---|---|
| worker 会话数 | 129 | 129 | **可比**（同源规则：首条 user 消息 + Task: <id>；同窗口） |
| 落地任务数 | 94 | 77 | **语义同源、载体不同**：本工具用 `fan-in-step-trace.jsonl` 的 `ff` ok；E1 用 `.quay/fan-in-<task>-<runId>.log` 的 `ff` ok 且按尝试窗口匹配。E1 的 `.log` 载体不含全部近期 run ⇒ 少算 17 个落地任务 |
| 轮数 | 10,392（按 message.id 去重） | 22,863（按 jsonl 行数） | **不可比（口径不同）**：E1 按 `type:assistant` 行数计，同一个 message.id 被 apiBlockIndex 拆成多条 ⇒ 多 block 重复计；本工具按 message.id 去重。两者是不同量，不是本工具「更准/更差」 |
| 加权 eq | 185.792M（0.1×/5×） | not-evaluated（无费用 CSV） | **不可比**：E1 无费用维度，不产出成本；本工具的 eq 来自会话 usage 字段 |

复跑 E1（同窗口）：
```bash
node scripts/task-efficiency-baseline.mjs --json --window-start 2026-10-26T16:00:00Z --window-end 2026-11-02T16:00:00Z
```

---

## 阶段读数与「下一刀切哪里」的读数（AC4 只给读数，不预设结论）

- 全局阶段占比：inspect 46.9% / verify 17.4% / orchestration 13.6% / edit 9.1% / fix 8.8% / unclassified 4.2%。
  - 读作：近一半轮是 inspect（读/搜/查）；verify + orchestration + fix + edit 合计 48.9%。
- top 任务 `gap-goal-branch-preview-trial-surface-declarable`（443 轮 / 7 会话）里 inspect 209 轮（47.2%）、verify 88、orchestration 76、edit 36、fix 26、unclassified 8。
- 返工（35 个返工会话）：fan-in-red 71.4% / crash-or-timeout 22.9% / worker-exited 5.7% / superseded 0 / unknown 0。
  - 读作：返工主要来自套件/校验红（fan-in-red），不是 worker 崩溃或中途退出。
- 成本：110.6 轮 / 落地任务，185.792M eq（0.1×/5×），123.482M eq（0.05×/5×）。
- 这些是读数，不预设「应该先结晶哪个阶段」——结晶点的选择由后续实验在读数之上另作判定。
