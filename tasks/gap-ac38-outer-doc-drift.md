---
id: gap-ac38-outer-doc-drift
title: outer 双份文档漂移——plugin/loop/orchestrator-loop-tick.md（1309 行）与 orchestration/orchestrator-loop-tick.md（1164 行）共同行 954、各有 200-350 行独有；与 AC41 判据 2（单一批行为文件）同判据，由 gap-ac41-coldstart-skill-reference-only 一并收（切分声明 + 产品行为进 plugin / 本层状态留 orchestration）
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

- [ ] AC1: **复现固化**——任务体记录 plugin 1309 / orchestration 1164、共同行 954、各有 200-350 行独有（本任务 Finding 已含）
- [ ] AC2: **切分声明在场**——`plugin/loop/orchestrator-loop-tick.md` 与 `orchestration/orchestrator-loop-tick.md` 各有一句切分声明（产品行为进 plugin / 本层状态留 orchestration）
- [ ] AC3: **与 gap-ac41-coldstart-skill-reference-only 一并收**——该任务已实施切分并留证据

## Definition of Done

- [ ] AC1–AC3 全部勾上
- [ ] 切分声明在场；两份独有内容各自可解释（由 gap-ac41-coldstart-skill-reference-only 验证并贴证据）

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
