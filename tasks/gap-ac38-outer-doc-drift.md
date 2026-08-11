---
id: gap-ac38-outer-doc-drift
title: outer 双份文档漂移——plugin/loop/orchestrator-loop-tick.md（1309 行）与
  orchestration/orchestrator-loop-tick.md（1164 行）共同行 954、各有 200-350 行独有；与 AC41
  判据 2（单一批行为文件）同判据，由 gap-ac41-coldstart-skill-reference-only 一并收（切分声明 + 产品行为进
  plugin / 本层状态留 orchestration）
status: done
labels:
  - gap
  - defect
  - delivery-critical
parent: null
children: []
extra: {}
---
**type:** finding

## Finding

**outer 双份文档漂移（AC38）**：`plugin/loop/orchestrator-loop-tick.md`（1309 行，产品模板）与
`orchestration/orchestrator-loop-tick.md`（1164 行，quay 自身消费副本）**共同行 954、各有 200-350 行
独有**——同一行为两份正文，改一处漏另一处。这与 AC41 判据 2（单一批行为文件）是**同一条判据在文档层的
实例**：都要求「单一真源 + 引用，不复述」。manager 已按此切分（plugin 322 / orchestration 1505 / 共同 181，
「产品行为进 plugin / 本层状态留 orchestration」）；outer 这份尚未切分。

**本任务由 `gap-ac41-coldstart-skill-reference-only` 一并收**（同判据，实现归 inner）：在该任务里加切分声明、
把冷启动 skill 理由段搬入被引用文件、让 tick 与冷启动引用同一批行为文件。

## Acceptance Criteria

- [x] AC1: **复现固化**——任务体记录 plugin 1309 / orchestration 1164、共同行 954、各有 200-350 行独有（本任务 Finding 已含）
- [x] AC2: **切分声明在场**——`plugin/loop/orchestrator-loop-tick.md` 与 `orchestration/orchestrator-loop-tick.md` 各有一句切分声明（产品行为进 plugin / 本层状态留 orchestration）
- [x] AC3: **与 gap-ac41-coldstart-skill-reference-only 一并收**——该任务已实施切分并留证据

## Definition of Done

- [ ] AC1–AC3 全部勾上
- [ ] 切分声明在场；两份独有内容各自可解释（由 gap-ac41-coldstart-skill-reference-only 验证并贴证据）

## Evidence

**AC1 — 复现固化（invoke：切分前 `git show 3f9000fd~1` 行数核对）**

切分前（`3f9000fd~1`，即 `gap-ac41-coldstart-skill-reference-only` 实施切分的前一提交）：
```
plugin/loop/orchestrator-loop-tick.md    1309 行
orchestration/orchestrator-loop-tick.md  1165 行（≈任务体记录的 1164，末行换行差 1）
共同行（sort 后 comm -12）               954 行
```
与任务体 Finding 记录（plugin 1309 / orchestration 1164、共同行 954、各有 200-350 行独有）一致——复现固化成立。

**AC2 — 切分声明在场（invoke：`grep -nE "切分声明" plugin/loop/orchestrator-loop-tick.md orchestration/orchestrator-loop-tick.md`）**
```
orchestration/orchestrator-loop-tick.md:35:> **切分声明（AC38，2026-08-10）**：本文件是 quay 自身消费的**本层状态**（工作分支两线、integration
plugin/loop/orchestrator-loop-tick.md:35:> **切分声明（AC38，2026-08-10）**：本文件是**产品行为正本**（随 `quay-init --loop` 原样铺到目标项目
```
`split_declared = 2`（两份各至少一句切分声明，band 达标）。产品行为进 plugin（产品模板）/ 本层状态留 orchestration（quay 副本），与 manager 层同判据。

**AC3 — 与 gap-ac41-coldstart-skill-reference-only 一并收（invoke：`grep -nE "^status:|AC4|切分声明" tasks/gap-ac41-coldstart-skill-reference-only.md`）**
```
6:status: done
45:- [x] AC4: **AC38 一并收**——outer 双份文档按 manager 先例切分（产品行为进 plugin / 本层状态留 orchestration），留切分声明
72:**AC4 — AC38 切分声明在场（invoke：`grep -nE "切分声明" ...`）**
74:plugin/loop/orchestrator-loop-tick.md:35:> **切分声明（AC38，2026-08-10）**：本文件是**产品行为正本**…
```
该任务已实施切分并留证据（其 AC4 勾选 + 切分声明在场证据），本任务为同判据交叉标注。

## Touches

- tasks/gap-ac38-outer-doc-drift.md（自身文件：self-touch，2026-08-10 outer 补——缺此条被 C8 拒派发，见 touches-orthogonality-check --self-touch-scan）

## Contract

measure   split_declared = `grep -cE "切分声明" plugin/loop/orchestrator-loop-tick.md orchestration/orchestrator-loop-tick.md` 的 stdout 数字
band      split_declared = 2（两份各至少一句切分声明）
invariant ac38_split_declared = 1
invoke    `grep -nE "切分声明" plugin/loop/orchestrator-loop-tick.md orchestration/orchestrator-loop-tick.md`（贴在场证据）
control   切分声明在场；独有内容各自可解释
resume    n/a（由 gap-ac41-coldstart-skill-reference-only 一并收，无独立执行步）

## Dispatch review

reviewer: outer
at: 2026-08-10
changed: AC38 双份文档漂移（plugin 1309 / orchestration 1164，共同 954）与 AC41 判据 2 同判据，由 gap-ac41-coldstart-skill-reference-only 一并收——本任务为交叉标注，实现/证据在该任务。
