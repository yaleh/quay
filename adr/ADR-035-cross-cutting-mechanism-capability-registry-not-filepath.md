---
id: ADR-035
title: 横切机制落地即登记消费者面——机制引用层缺失，退役靠 grep 散引用必然漏消费者（session-liveness 141 处 / monitor-mount-check 漏 idle-watch）
status: proposed
date: 2026-09-03
tags:
  - architecture
  - abstraction
  - cross-cutting
  - consumer-enumeration
---

## Decision

**横切机制（被 ≥2 个下游引用的能力）落地时须登记「消费者面」，退役前先枚举消费者逐个改判，不得靠 grep 全仓散引用。** 三条规则：

1. **机制落地即登记消费者面**：新机制落地那一刻，登记「哪些下游以何种方式依赖它」（consumer enumeration），作为单一真相源。
2. **退役先枚举消费者**：退役一个横切机制，第一步是读消费者面登记、逐个改判，而非 grep 全仓散引用碰运气。
3. **登记覆盖每个消费者的触达方式**：消费者面对每个消费者记录其触达方式（直接 filepath / 经抽象 / 事件订阅），退役时据此判断每个消费者是「随删」还是「改判」。

## 背景（实证 2026-09-03）

退役 `session-liveness` **一个**机制，牵扯 **147 文件**（Touches 实测），其中 **141 处直接引用** `session-liveness.sh` / `session-liveness-mount.sh` 路径。同一天，`monitor-mount-check.sh` 被删后暴露出**第二个消费者** idle-watch（`manager-start.sh` 的 `--check-idle-watch` 经「monitor-mount-check + --once 接缝」核实挂载）——任务提案只看到「检查 session-liveness 挂载」这一个消费者，漏了 idle-watch，退役即断在 fan-in 下一轮。

**根因不是「没有抽象」，是「机制引用层缺失」**。本项目已有两个相邻机制，但都不承担「消费者枚举」职责：

- `capability-catalog.sh`（`summary: 309 scripts`）是**能力自省声明**——每个 check 声明「它让哪个问题可提问」，下游**不通过它**触达任何脚本。它管「回答什么」，不管「被谁引用」。
- `observer-registry.sh`（`orchestration/observer-registry.conf`，实际 3 个 target：quay/meta-cc/archguard）是**观测目标退役登记**——让 4 个消费者（os-anchor-watchdog / git-staleness / session-liveness-coverage / session-topology）知道某个**仓库**退役了。session-liveness 在这里是**消费者**（coverage 读 target 状态），不是被管理的对象。它管「被看的仓库」，不管「机制被谁引用」。

两者都不承载「下游引用路由」。所以 141 处散引用没有现成的登记可收敛——退役时靠 grep，漏看一个消费者（idle-watch）就断在 fan-in 的下一轮。

## 与既有 ADR 的关系

本条是 **ADR-013「ABI, not file paths」在 plugin/scripts 层的推广**。ADR-013 约束 product 层（Core↔provider 跨 package，禁 `../../../quay-native/...`）；本条约束 methodology/plugin 层的**横切机制之间**（plugin 脚本↔plugin 脚本）。同一条原则在两个层各缺一半：013 管住了 Core，本条管 plugin 横切。

## 被否的替代

- **宣称 observer-registry / capability-catalog 已是「引用触达」层**：否——它们分别是「观测目标退役登记」与「能力自省声明」，都不管下游引用路由。把引用收敛到它们，是往一个管别的事的机制上塞职责。
- **现在回填 session-liveness 的 141 处引用**：否——机制本身要退役，往将删的靶子上泼漆无意义。本条约束的是**未来新机制**。

## Consequences

- 新机制落地即登记消费者面 → 退役时先枚举消费者、逐个改判，不漏（idle-watch 这类第二消费者在退役第一步就暴露，而非 fan-in 下一轮）。
- 「机制 → 消费者 → 触达方式」成为单一真相源，硬规则 5b「修好 X ≠ X 只在那一处」在横切机制上得到机制化保证（不再是靠意志的自觉）。
- 待落实：本 ADR accepted 后，确定消费者面登记的载体（扩展 capability-catalog 加 consumer 维度，或新建机制触达面登记）；下一个退役的横切机制（tmux-isolated / monitor-mount-check 的 idle-watch 接缝）应据本 ADR 先枚举消费者。
