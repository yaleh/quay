---
id: ADR-035
title: 横切机制落地即注册能力声明——不得直接 filepath 引用（抽象半采用的代价：session-liveness 退役碰 141 处散引用）
status: proposed
date: 2026-09-03
tags:
  - architecture
  - abstraction
  - cross-cutting
  - capability-registry
---

## Decision

**横切机制（被 ≥2 个下游引用的能力）必须通过能力注册表被引用，不得直接引用具体脚本路径。** 三条规则：

1. **能力注册，而非 filepath**：一个被多个下游消费的机制（session-liveness、monitor-mount-check、observer、tmux-isolated 等），下游必须通过 `observer-registry.sh`（观测目标登记）或 `capability-catalog.sh`（能力声明）触达，不得直接写 `plugin/scripts/<name>.sh` 路径。
2. **落地即注册**：新机制落地那一刻就注册能力声明（进 registry），不是事后回填。
3. **退役面收敛到注册表**：退役一个横切机制，改动面 = 注册表一处 + 该机制的实现文件，而非 N 处散引用。

## 背景（实证 2026-09-03）

退役 `session-liveness` **一个**机制，牵扯 **147 文件**（Touches 实测），其中 **141 处直接引用** `session-liveness.sh` / `session-liveness-mount.sh` 路径。而本项目**早已有**这个问题的类级解药：

`observer-registry.sh` 头注释 THE CLASS 段（2026-08-06）——

> 一夜四个独立消费者撞同一形状：各自维护 target list + 各自 criterion，没有一个机制知道 target 被 decommissioned。…… 3. a session-liveness-coverage Monitor reported NOT-WATCHED for a decommissioned B machine

即：这个抽象在 2026-08-06 就为「session-liveness 退役时消费者不知情」这个病而建，但**建了之后没有回填**——141 处散引用原样保留。抽象停在 registry 一处，引用没收敛。

这是**「抽象半采用」（half-adopted abstraction）**：比没有抽象更危险——既有的 registry 给人一种「已封装」的错觉，而实际引用仍是散的。退役时每处散引用都重新暴露一次，付费方是未来每一个退役动作。

## 与既有 ADR 的关系

本条是 **ADR-013「ABI, not file paths」在 plugin/scripts 层的推广**。ADR-013 约束 product 层（Core↔provider 跨 package，禁 `../../../quay-native/...`）；本条约束 methodology/plugin 层的**横切机制之间**（plugin 脚本↔plugin 脚本）。同一条原则在两个层各缺一半：013 管住了 Core，本条管 plugin 横切。

## 被否的替代

- **现在回填 session-liveness 的 141 处引用到 registry**：否——机制本身要退役，往将删的靶子上泼漆无意义。本条约束的是**未来新机制**，不回头补将删的旧机制。

## Consequences

- 新机制落地即注册 → 退役时改动面可预测（注册表 + 实现文件），不再付 141 处散引用的全价。
- `capability-catalog.sh` / `observer-registry.sh` 成为「这个机制让哪个问题可提问 / 哪个目标被观测」的单一真相源。
- 硬规则 5b「修好 X ≠ X 只在那一处」在横切机制上得到机制化保证（不再是靠意志的自觉）。
- 待落实：本 ADR accepted 后，新机制的文件撰写 / 派发路径（quay-file-task skill / dispatch 校验）需检查「是否已注册能力声明」；下一个退役的横切机制（tmux-isolated / monitor-mount-check）应据本 ADR 收敛其引用面。
