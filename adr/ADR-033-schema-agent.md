---
id: ADR-033
title: 形式选择按「值从哪来」定：需要语义的值必须走带 schema 的 agent()，脚本只做值到手后的算术
status: proposed
date: 2026-08-09
tags:
  - methodology
  - workflow
  - crystallization
  - form-selection
---
## Context

2026-08-09 夜，人两次驳回管理者对同一问题的形式建议，逼出这条原则。

**触发案例**：外层连续 5 次 tick 全判 `no-action`，而三条强制动作条件每次都为真（在飞 0~1 < cap 4、pool 11 < floor 16、nyf 17），欠 15 个动作交付 0 个。管理者建议立一个 checker script 强制「`no-action` 需举证」，理由是「无扇出、输入确定、无需模型判断 ⇒ 三问全指向 script，workflow 买不到任何东西」。

人驳回两处：

**驳一：把 workflow 的价值等同于扇出，是错的。** 反例是管理者自己的 tick workflow —— 它有价值不是因为并行，而是因为**控制流是代码**：A 段读数被跑是因为脚本跑它，B 段产出被写是因为脚本要它，与该轮注意力无关。当晚全部失效（机制在场没被调用、读数在场没被判、`no-action` 零成本）**都是意志/注意力失效**，workflow 正是把意志从环里拿掉的那个形式。

**驳二：说那五条不等式的输入是确定性的，是错的。** 逐条查值的来源：

| 不等式 | 值从哪来 | 需要语义 |
|---|---|---|
| `in_flight < cap` | `slot-refill` 的 `in_flight_count` 是**入参不是测量**；真测量只能读 pane/transcript，判断某个 `◯ general-purpose …` 是不是占槽的任务 agent、「括号已闭但 agent 还活着」算不算占槽 | 是 |
| `pool < floor` | `ready-pool-check` 内部靠 `taskWorkLanded(task.body, …)` 解析 Touches + git 历史**猜**「工作是否落地」 | 是（且已知会猜错） |
| `nyf > 0` 且工作已落地 | 同上，正是那个语义判断本身 | 是 |
| integration 领先且绿 ⇒ 该合 | 基本确定，但有 freshness gate / doc-only 例外 | 部分 |
| suite red ⇒ 分诊 | 真红 vs 幻影红——当晚三例证明正则决定不了 | 全是 |

三条的**值**要靠语义才能产生，第五条的**动作**整个是语义。脚本能做的只是值到手之后的算术，而当晚出错的地方**全在产生值这一步**：内层的「唯一真实候选」是语义误判、外层把 `1/4` 抄写不判是语义缺席、三次幻影红是正则替语义干活干砸了。

## Decision

**形式选择的判据不是「有没有扇出」，是「值从哪来」（value provenance）。**

1. **需要语义才能产生的值，必须由带 schema 的 `agent()` 产出**，不得由正则/启发式脚本产生。让脚本去产生这类值，就是在制造下一个幻影红家族。
2. **值到手之后的算术、门槛、判词、动作路由，必须写成普通 JS**（确定、可复现、无意志），不得交给模型自由裁量。
3. **script 与 workflow 不是二选一 —— script 是 workflow 里的确定性部分。** 二者是包含关系，不是替代。
4. **workflow 的首要价值是「控制流不依赖会话意志」**，扇出只是其用途之一，不是选它的理由。凡是「机制已存在却没被调用」「读数已在场却没被判」这类失效，都指向 workflow，与并行度无关。

**推论（接线）**：任何按本 ADR 建的机制，若只在被检查的那个会话自愿调用时才跑，它就与被检查对象**共享失效域**（同 `orchestration/FINDING-tool-crystallization-quantified-2026-08-09.md` §5 fate-sharing）—— 那个没跑 `slot-refill` 的会话，同样不会跑检查它的 checker。必须接到不依赖该会话意志的位置。

**推论（新鲜度）**：重新测量型的裁判只能在**检查时刻**取值，不是被检查行的**产生时刻**。中间量会变，所以被检查的行必须自带时间戳 + 原始读数，裁判校验「行内自洽 + 新鲜度上界」，不是拿此刻真值去判 20 分钟前的行（同 manager-tick-core C14）。

## Consequences

**当前违反本 ADR 的已知场点（7 处，全有实证）：**

| # | 现在由什么产生值 | 证据 |
|---|---|---|
| 1 | `FAILURE_PATTERNS` 正则判红（`full-suite-runner.ts`） | 2026-08-09 三次幻影红：`^✖`(c83ce4be)、`^__PERFILE__`(a1b78104)、`tmux-leak-scan`(未锚定) |
| 2 | `taskWorkLanded`/`notYetFlipped`（`ready-pool-check.ts`） | `nyf=17` 全靠它 |
| 3 | `countMechanisms()`（`wiring-coverage-check.ts`） | 实测 3/5 正确 ⇒ `checkSplitRecommendation` 至今未接线（CLAUDE.md 明写） |
| 4 | pane 数 `◯` 得 in_flight | 判不了「括号已闭但 agent 还活着」占不占槽 |
| 5 | session-liveness 忙/闲分类器 | `gap-session-liveness-busy-mask-idle-with-subagents` |
| 6 | 红窗分诊（真红 vs 幻影红） | 当晚三次全靠人/agent 读 |
| 7 | `overdue` 阈值判 `nyf` | 外层每轮读到 `nyf: 17 / overdue: False` |

**采用现状（2026-08-09 15:3x 实测）**：全项目 627 次 `Workflow` 调用中，外层会话（`7795bb75`）与内层会话（`728a4610`）**各 0 次 —— 从未调用过**。最后一次调用是管理者会话 `2026-08-08T07:35:32`（在 compaction 边界静默死亡，距今 32 小时）。占比最大的 `prepare-milestone.js`(354) + `execute-milestone.js`(118) 属 ADR-022 已退役的经典环。**即 workflow 这个形式在两层日常里等于不存在**，而它恰是唯一具备「控制流不依赖会话意志」性质的机制。

**与 ADR-009 的关系**：ADR-009（用后台 workflow 驱动开发）说了「要用 workflow」，但全文没有 `script` / `checker` / `schema` / `agent()` 四个词——它从未说明**形式如何选**。本 ADR 补的正是这一层。

## 立本 ADR 过程中的一次真实事故（保留为证据）

管理者第一次写本 ADR 时用了 `id: ADR-023`，**没有先看该编号是否已被占用**。`adr_write` 没有拒绝，而是**直接改写了既有的 `ADR-023`（status: accepted，DoD gate SHAPE_REGISTRY）的 title/status/body**，无任何警告。因该文件已被 git 跟踪，`git checkout --` 完整还原，无损失。

两条结论：
1. **人的指令「覆盖前先看目标」在此被违反**——编号占用是一次 `ls` 就能查的事实，没查。
2. **`adr_write` 对既有 id 的静默全量改写是一个产品缺陷**：ADR 是决策记录，一个 `accepted` 的 ADR 被无警告改写，比任务被改写严重得多。应当 fail-closed（要求显式 `--force` 或 patch 语义），否则任何 id 猜错都会静默销毁一条既有决策。此项应立任务给内层。
