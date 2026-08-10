---
id: ADR-033
title: 形式选择按「值从哪来」定：需要语义的值必须走带 schema 的 agent()，脚本只做值到手后的算术
status: accepted
date: 2026-08-10
tags:
  - methodology
  - workflow
  - crystallization
  - form-selection
---
## Decision（2026-08-10 由 proposed → accepted）

**形式选择的判据不是「有没有扇出」，是「值从哪来」（value provenance）。**

1. **需要语义才能产生的值，必须由带 schema 的 `agent()` 产出**，不得由正则/启发式脚本产生。让脚本去产生这类值，就是在制造下一个幻影红家族。
2. **值到手之后的算术、门槛、判词、动作路由，必须写成普通 JS**（确定、可复现、无意志），不得交给模型自由裁量。
3. **script 与 workflow 不是二选一 —— script 是 workflow 里的确定性部分。** 二者是包含关系，不是替代。

## 接受理由（2026-08-10 人提出 + outer 裁定）

人的提案正是这条原则的应用实例，且本仓库已在 2026-08-09 证明过一次然后丢失：

- **证明实例**：`nyf-semantic-judge` workflow（16:49 后台起跑 → 17:13 翻转 4 个 done，24 分钟，并行做其它 tick 事务）。19 个 nyf 任务每个一个 schema agent 出 `{verdict, acCompleteness, evidence, recommendFlip}`，筛选计数用普通 JS——**触发用机械量、判定用 agent**，正是本 ADR 的完整形态。
- **丢失原因**：三层执行核（orchestrator-tick-core / fast-mode-tick-core / manager-tick-core）都有「检测 workflow 没被调用」的仪器，没有一层有「调用 workflow」的步骤——**仪器在测一个从未被规定过的动作**。与 manager 84 次读数 workflow 死于压缩同一条死因：只活在意志里，不在锚指向的文件里。
- **应用**：pool 任务质量保障是 outer 的语义活——机械脚本只能辅助。把 `nyf-semantic-judge` 泛化为「pool 任务质量语义闸」，判词含 `should-remove`（前提证伪 → 撤出/重定范围，如 gap-crosscut-checks-zero-coverage-of-plugin-scripts 前提被证伪手工 RESCOPE 的案例），做成执行核带机械触发条件的编号步骤。

## 状态迁移

- 2026-08-09：proposed（人两次驳回管理者的形式建议，逼出本原则）
- 2026-08-10：accepted（人提出 pool 语义质量闸，outer 裁定接受——本原则从 proposed 到 accepted，成为约束）

## Consequences

- 任何「需要语义才能产生的值」（pool 任务质量、nyf 是否落地、真红 vs 幻影红、in_flight 测量）必须走带 schema 的 agent()，脚本只做值到手后的算术。
- 外层执行核必须有「调用 workflow」的编号步骤（机械触发），不能只有「检测没被调用」的仪器。
