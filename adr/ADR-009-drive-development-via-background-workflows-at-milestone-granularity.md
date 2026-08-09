---
id: ADR-009
title: Drive development via background Claude Code workflows at milestone granularity
status: accepted
date: 2026-07-19
accepted-date: 2026-07-20
supersedes: []
superseded-by: []
tags:
  - methodology
  - workflow
  - process
---
## Context
Typical development on this repo is already executed by an autonomous outer loop (exp5, `OUTER-LOOP.md`) that builds quay one milestone at a time, run in the background on `master`. This ADR records that operating mode as a first-class decision rather than an incidental fact, so its granularity and hygiene constraints are explicit.

## Decision
Typical development activity is executed through a **Claude Code workflow, run in the background**, with granularity **aligned to a milestone** (one workflow episode ≈ one milestone). Human steering follows DIR-027 hygiene: pause via the `.halt` sentinel, or work in a private worktree off `master` and fast-forward at a clean window — never race the loop on `master`.

<!-- enforcement: N/A — a process norm, not a Π_{S→E} candidate (not cleanly mechanizable: "landed via a workflow episode vs ad-hoc commit" has no crisp check). Honored by discipline, not a gate. (OQ1, human-confirmed 2026-07-19.) Promoted proposed→accepted 2026-07-20: enforcement question resolved N/A, nothing left to land per ADR-011. -->

## Consequences
- **Forbids:** open-ended, granularity-free background runs that don't bottom out at a milestone boundary; racing the loop on `master`.
- **Enables:** predictable milestone-cadence checkpoints where scheduled e2e (ADR-010) and dark-axis instruments (ADR-007) attach.
- **Scope / relations:** pairs with ADR-010 (scheduled milestone e2e) as the two halves of the milestone cadence; the active phase per ADR-008 determines what the workflow does.

## Amendment 2026-08-09 — the `enforcement: N/A` judgment is FALSIFIED by measurement

**这条修订推翻的是本 ADR 自己那行 enforcement 注释**（原文：*"not cleanly mechanizable:
'landed via a workflow episode vs ad-hoc commit' has no crisp check". Honored by discipline,
not a gate.*）。**判据存在，而且是现成的；"靠纪律"这个结论在实测中失效了。**

### 实测（manager 层，2026-08-09 05:0xZ，人追问后查）

ADR-022 退役经典里程碑循环之后，workflow 曾在 **manager tick** 上重新落地并证明有效：

| 时刻 | 事件 |
|---|---|
| 2026-08-07 11:19 | 人授权，首次调用 `.claude/workflows/manager-tick-readings.js` |
| 08-07 11:3x | **首轮即产出 `trustworthy: false` + 10 条可疑读数**——按 manager 当轮自述，"一轮查出的真缺陷多过此前十几轮 tick 的总和"；其中一条推翻了连续数轮的判断（`grep -m1 '^\| 2026' tick-log.md` 已失效、恒返回旧时刻） |
| 08-07 11:19 → 08-08 04:48 | `manager-tick-readings.js` 约 70 次 |
| 08-08 04:58 → 07:35 | 换为 `manager-tick-core.js`，10 次 |
| **08-08 07:35:32** | **最后一次调用**（工具结果为 `Workflow launched in background. Task ID: wuahokye4`，**无错误**） |
| 08-08 07:57 起 | tick 继续每 20 分钟触发并落行，**workflow 调用为 0** |
| 2026-08-09 05:00 | 累计静默 **21.5 小时**，无人发现，直到人追问 |

### 根因（已排除两个替代假设）

- **不是它坏了**：最后一次调用正常后台启动，无报错。
- **不是文档改了**：`orchestration/manager-loop-tick.md` **从未把 workflow 写成编号步骤**——
  全文仅两处提及，均为历史注记（第 616 行标注某条判据失效、第 730 行讨论 meta-cc）。
- **真因**：该实践由人在 08-07 11:1x 口头授权后建立，**只活在会话上下文里**。
  §2.5 的锚是纯指针（"内容现读"），指向的文档里没有这一步；上下文一压缩、注意力一转向别的调查线，
  实践即蒸发。**没有任何文档、检查或提示能把它唤回。**

### 判据（推翻 `enforcement: N/A`）

crisp check 存在，且本仓已有工具：

```
mcp__meta-cc__query_session_content role=tool block_type=tool_use tool_name=Workflow
  → 返回每次 Workflow 调用的 timestamp
判据：last(timestamp) 与声称周期比对；超过 N 个周期未调用 ⇒ 报红
```

⇒ **`enforcement` 从 `N/A` 改为：可机械化，判据为"最近一次真实调用时刻 vs 声称周期"。**

### 更一般的教训（本条的真正价值，跨 ADR）

同夜同形态第二次实证：`plugin/loop/orchestrator-loop-tick.md:687` 的
「### 1b. 异步收尾例程（**强制**）」写明"每 tick 执行"，实际
**08-08 20:08 后静默停摆 8.5 小时**（判据：`git log | grep 'outer: close'` 从每 ~20 分钟一次变为零），
同期 not-yet-flipped 任务从 61% 涨到 82%。

**两例共同形状：机制存在 ≠ 机制在跑。** 此前本仓记录的四例（`forkBaseline` 默认分支从未走到、
`decideIntegrationToDevelopMerge` 无非测试调用者、`scope` 字段无人读、`manager-tick-log-check`
行判据只认旧格式）**全是静态形态**——查"有没有调用者"。这两例是**动态形态**：调用者有、
文档写着强制、它就是不跑。

⇒ **判据升级（建议提升为跨 ADR 的通用条款）**：
**任何声称周期性执行的机制，必须有一个"最近一次真实执行时刻"可被外部查询，并与其声称周期比对。**
静态的"有没有被调用"不足以判定一个机制有效。

**并且收据的粒度必须匹配判据**：manager 的 `manager-tick-log-check.sh`（tick 留行 + mtime 新鲜度）
在这 21.5 小时里**每轮都 PASS**——因为行是手敲读数后手写的。
**收据证明"轮次发生过"，不证明"轮次里的步骤用什么方式执行"**；粒度错了的收据比没有收据更危险，
因为它让棘轮报绿。
