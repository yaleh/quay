---
id: ADR-025
title: "Axes are first-class records in the ADR store (status: proposed + tag: axis),
  not a bare count in a manager file — an axis converging into a decision becomes a
  lifecycle transition on one record, not two separate systems"
status: accepted
date: 2026-08-06
tags:
  - methodology
  - governance
  - single-source-of-truth
applies-to:
  - adr/
  - orchestration/manager-phase-goal.md
---

## 裁定

**轴（axis）与 ADR 存在同一个抽屉里：一根轴就是一条 `status: proposed` + `tag: axis` 的
ADR 记录；轴收敛成决定，就是同一条记录从 `proposed` 走到 `accepted`。**

人 2026-08-06 裁定（"同意该方案"）。

## 触发：一个上下游关系被记录形式颠倒了

人指出：**"既然轴是 ADR 的上游，那应该更突出才对。"**

而本仓现状恰好相反（管理者实测）：

| | 轴 | ADR |
|---|---|---|
| 存在形式 | `orchestration/manager-phase-goal.md` 里的**一个计数**（当时 = 1） | `adr/ADR-*.md`，一文件一条 |
| 可查询 | ❌ 无 | ✅ `quay-native adr list` / MCP `adr_list` |
| 单条记录 | ❌ 无（只有计数 + 散在正文的叙述） | ✅ id / status / tags / applies-to |
| 生命周期 | ❌ 无（开了之后没有"填满/关闭"状态） | ✅ proposed / accepted / superseded |

**上游的东西没有下游的东西突出**——这本身就是记录形式与概念结构不符。

## 轴与 ADR 的关系（本 ADR 依据的定义）

| | **轴** | **ADR** |
|---|---|---|
| 回答 | "**我们从来没看过哪个方向？**" | "**我们决定了什么，为什么？**" |
| 时态 | 开放、未完成 | 封闭、已完成 |
| 来源 | 发现（多个同型实例归纳） | 决定（一次权衡的结论） |
| 消亡 | 被填满后收敛成决定 | 被 supersede，记录永存 |

**没有轴的 ADR 是拍脑袋的决定；没有 ADR 的轴是永远开着的口子。**

## 决定

1. **一根轴 = 一条 ADR 记录**，`status: proposed` + `tag: axis`。
   `adr_list --tag axis` 立刻可查——**不新建任何机制**（ADR provider 已支持 status/tag）。
2. **收敛 = 生命周期转移**：轴被反复撞到、最终收敛出一个决定时，
   **同一条记录**从 `proposed` 走到 `accepted`，并在正文写清它是从哪根轴收敛来的。
   ⇒ **上下游关系变成一条记录的状态变化，而不是两套要保持同步的东西。**
3. **AC10 的计数改为派生量**，不再是手写数字：
   开轴数 = `tag: axis` 且 `status: proposed` 的记录数（+ 已收敛为 accepted 的那些的历史计数）。
   ⇒ 计数不可能与实际记录漂移——本仓反复付学费的「同一事实存两份」在这里被结构性排除。
4. **轴记录保持轻**：轴是"还没看过的方向"，不是完成的分析。
   一条轴记录只需要：它问什么、为什么怀疑那里有东西、目前撞到过哪些同型实例。
   **不要求**轴记录有落地方案——有方案就说明它该收敛成 ADR 了。

## 明确不做

- **不新建轴的存储/查询机制**——复用 ADR provider 是本方案成立的关键（人要的是"最小的修法"）。
- **不追溯把历史上所有被讨论过的方向都补成轴记录**——只记录当前真实开着的轴。
- **不把 `tag: axis` 的记录当作 ADR 对待**（例如不要求它有"落地与验证"节）——
  它们共用存储，不共用完备性要求。
- **不改 ADR 的既有编号空间**：轴记录与 ADR 共用 `ADR-NNN` 编号，因为它们本就是同一条
  记录在不同生命周期阶段的两个名字。

## 与 ADR-024 的关系

ADR-024（裁定与其机械化检查必须可追溯绑定）的正文里把"轴不如 ADR 突出"记为
**一个已暴露、未处置的不对称**。**本 ADR 就是处置它的那一条**——
且处置方式恰好符合 ADR-024 自己的精神：不让同一个事实（开了几根轴）存在两个地方
（一个手写计数 + 一堆散落叙述），而是让计数**派生自**记录。

## 落地与验证

- 本 ADR 落地时，同时把当前真实存在的轴迁成 `tag: axis` 记录（见 `adr/` 中
  `status: proposed` + `tag: axis` 的各条）。
- 验证：`adr_list --tag axis` 能列出它们；`orchestration/manager-phase-goal.md` 的 AC10
  改为指向这个查询，不再手写数字。
- 负控制：新开一根轴而**不**建记录 ⇒ AC10 的派生计数不会变化，
  即"开了轴但没记录"在计数上不可见——这是本方案刻意接受的代价，
  换来的是"记录存在则计数必然正确"（宁可漏计，不可虚计）。
