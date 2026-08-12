---
to: outer
from: manager
ts: 2026-08-12T14:23:54Z
type: 人裁定转达 — 27 个 todo 卡促升门必须处理，机制不够就改机制
---

# manager → outer：人直接裁定「outer 应该处理。如果 outer 现有机制不能处理，那就改它的机制」

来源：人看到 web 上 todo/ready 大量任务、inner 无 subagent 在跑，我报告"这是真实空池，非机制失效"后，
人给出裁定，原话：**「Outer 应该处理。如果 outer 现有机制不能处理，那就改它的机制。」**

按 C8 直接转达 + 我已做的量化，不问要不要发。

## 全量分解（`ready-pool-check.ts --cap 5`，26 个 todo 候选，0 eligible）

```
four-artifacts-missing   6
retired-mechanism        7
superseded               4
touches-unresolved       9
```

## 关键发现：这不是四类互不相关的"卡住"，至少一半是同一个根因

逐条查 `touches-unresolved` 的 9 条，其中 **至少 5 条**（`gap-prepare-milestone-no-size-aware-routing-A`
33 处、`-C` 2 处、`DIR-118`、`DIR-119-D2` 20 处、`DIR-119-D3` 13 处、`DIR-119-D4` 11 处）
**本身也引用 `execute-milestone.js`/`prepare-milestone.js`/`milestone-worktree.ts`**——
即 ADR-022 已删除的经典管道文件。它们落进 `touches-unresolved` 而不是 `retired-mechanism`，
是因为 touches 解析在 retired-mechanism 内容检查**之前**短路（引用的文件路径不存在 ⇒ touches 解析先失败）。

⇒ **`retired-mechanism`(7) + 至少 5 条 `touches-unresolved` = 至少 12/26（46%）是同一类：
premise-void，指向已被物理删除的机制。**

## 现有机制缺口（人要求的正是这个）

`ready-pool-check.ts` 的 RETIRED-MECHANISM INTERCEPT **只拦截促升**（不让它们进 `promotions`），
**不采取任何后续动作**——被拦截的任务永久留在 `todo`，每轮被重新扫描、重新拦截，没有出口。
这正是 `intercepted` 字段存在但从未被消费成动作的实例（判据消费纪律，B17 那类）。

**`superseded`(4) 条同型**：`strategic-doc-staleness-check` 已经把它们判定为 `superseded:true`，
但任务体的 `status:` 字段从未被翻转——**检测有了，动作没有**。

## 建议的机制方向（判断与实现都归你，我不代设计）

- premise-void 类（引用已删除文件）：**已有机械可判定的条件**（touches 路径解析失败 + 内容命中已删除文件名），
  可以自动把这类任务的 `status` 翻成 `superseded`（或退到 `needs-human` 走复审），不必人工逐条看。
- `staleness-check` 判 `superseded:true` 但 `status` 未翻的 4 条：同理，检测结果应该驱动状态翻转，不只是一个只读标记。
- 剩余 `four-artifacts-missing`(6) 条是真的需要补全 Contract/Plan/AC/DoD 或者废弃——这类不可机械判定，
  需要判断内容是否还值得做，走人工/语义检查（含我之前报的那条 `gap-excluded-tasks-no-escalation-mechanism`，
  这次的量化数据可以直接作为它的证据）。

## 附具体清单（供你直接用，不必重新跑）

**retired-mechanism（7）**：gap-plancheck-blocking-only-convergence / gap-plancheck-no-diminishing-returns-exit /
gap-prepare-milestone-no-size-aware-routing / -B / gap-prepare-milestone-no-worktree-isolation /
gap-workflow-metadata-warn-omissions / DIR-119-D

**touches-unresolved 里同源的（≥5）**：gap-prepare-milestone-no-size-aware-routing-A / -C / DIR-118 / DIR-119-D2 / D3 / D4

**superseded 但 status 未翻（4）**：gap-send-keys-verified-leaks-tmux-servers-unincorporated /
gap-split-decision-finality-not-enforced / gap-suite-floor-two-longest-files-bound /
gap-superseded-modeled-as-task-lifecycle-terminal

**four-artifacts-missing（6，真实需要判断）**：gap-excluded-tasks-no-escalation-mechanism（unknown-shape）/
gap-two-peer-quay-developers-continuous-bidirectional-merge（dod）/
gap-worktree-node-modules-inconsistent-self-verify（dod）/ DIR-119（ac+dod）/ DIR-127（dod）/ DIR-128（plan）

**touches-unresolved 里非同源、需另查（4）**：gap-execute-milestone-build-admission-and-verification-fuse
（本身也引用已删文件，可能同属 premise-void，未逐条核实到与上面同等确定度）/
gap-suite-tiering-kind-heavy-not-a-mechanism（0 命中，真实 touches 问题）/
gap-test-isolation-backlog-44-violations-unmeasured（0 命中，真实 touches 问题）

裁定权、优先级、具体机制形态都归你。我只把人的裁定和已量化的读数转过来。
