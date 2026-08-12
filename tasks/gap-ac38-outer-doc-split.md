---
id: gap-ac38-outer-doc-split
title: "AC38: outer 双份文档漂移未切分（按 manager 先例同形切分）"
status: done
labels:
  - gap
  - milestone-candidate
parent: null
children: []
extra: {}
---
**type:** execution

## Proposal

**AC38（manager 034125 实测）**：outer 双份文档漂移未切分。`plugin/loop/orchestrator-loop-tick.md` 1508 行 vs `orchestration/orchestrator-loop-tick.md` 1267 行，共同 727 行，**各有 540-780 行独有 = 漂移仍在**。

**对照 manager 已切分先例**：plugin 322 / orchestration 1647 —— manager 已完成同形切分，outer 没做。

**判据原文**：「outer 完成同形切分，切分后两份的独有内容各自可解释（产品行为 / 本层实例状态），并留切分声明」。

**实现归 inner。**

**验证锚**：修后 (a) 切分后两份独有内容各自可解释；(b) 留切分声明；(c) 按 manager 先例同形；(d) `--for-task` scoped 门绿。

## Acceptance Criteria

- [x] AC1: **复现固化**——任务体记录漂移实测（plugin 1508 vs orchestration 1267，共同 727，各 540-780 独有）（本任务 Proposal 已含）
- [x] AC2: **同形切分**——按 manager 先例（plugin 322 / orchestration 1647）切分 outer 双份
- [x] AC3: **独有内容可解释**——切分后两份独有内容各自可解释（产品行为 / 本层实例状态）
- [x] AC4: **切分声明**——留切分声明
- [x] AC5: **既有不回归**——`--for-task` scoped 门绿

## Definition of Done

- [ ] AC1–AC5 全部勾上
- [ ] 修后实跑：切分后两份独有行数 + 切分声明贴出（见 Evidence）
- [ ] 既有测试 + 新增测试全绿（`--for-task` scoped）
- [ ] 全量套件绿（`fail 0` 且 `cancelled 0` 且 `FULL-SUITE-EXIT=0`）——外层 verification-round 验证

## Evidence

**Contract invoke（2026-08-12，切分后）**：

```
$ comm -3 <(sort plugin/loop/orchestrator-loop-tick.md) <(sort orchestration/orchestrator-loop-tick.md) | wc -l
1271
```

**切分后两份独有行数**：plugin `plugin/loop/orchestrator-loop-tick.md` = 1066 行；orchestration
`orchestration/orchestrator-loop-tick.md` = 1269 行；独有总行数 1271（plugin 独有 534 = 产品行为 /
orchestration 独有 737 = 本层实例状态）；共同 532 行（共享的是命令块与脚本名）。对照切分前共同 727-1043 行。

**切分声明在场**（AC4）：`plugin/loop/orchestrator-loop-tick.md`、`orchestration/orchestrator-loop-tick.md`、
`plugin/loop/fast-mode-tick-core.md`、`orchestration/orchestrator-tick-core.md` 四处各 1 条（`grep -c 切分声明`）。

**scoped 门**（AC5，`bash scripts/test.sh --for-task gap-ac38-outer-doc-split --allow-thin`，exit 0）：
新增 `plugin/test/outer-loop-tick-split.test.mjs` 5/5 绿；scoped 静态检查全绿（adr016 / strategic-doc-staleness /
drive-contract / threshold-scope / tick-core-static / instrument-failure / red-on-omission / test-framework-policy /
test-isolation / test-impl-census / task-contract / capability-catalog / judgment-consumer / state-worded-clause）。
quay-init 相关 25 测试 + tick/batch 词汇 13 测试全绿（不回归）。
DoD 最后一条（全量套件绿）留外层 verification-round 验证。

## Touches

- plugin/loop/orchestrator-loop-tick.md（切分到产品行为）
- orchestration/orchestrator-loop-tick.md（切分到本层实例状态）
- plugin/loop/fast-mode-tick-core.md（切分声明）
- orchestration/orchestrator-tick-core.md（切分声明）
- plugin/test/（切分一致性用例）
- tasks/gap-ac38-outer-doc-split.md（自身：勾 AC + 贴证据）

## Test-Files

- `plugin/test/outer-loop-tick-split.test.mjs`

## Contract

measure   doc_unique_lines = `comm -3 <(sort plugin/loop/orchestrator-loop-tick.md) <(sort orchestration/orchestrator-loop-tick.md) | wc -l` 的 stdout 数字
band      doc_unique_lines = 切分后每份独有可解释（各自主题单一）
invariant split_declared = 1（切分声明在场）
invoke    `comm -3 <(sort plugin/loop/orchestrator-loop-tick.md) <(sort orchestration/orchestrator-loop-tick.md) | wc -l`（贴切分后独有行数）
control   同形切分；独有可解释；切分声明；既有不回归
resume    切分 / 声明 / 测试分步提交，任一步完成即写盘

## Dispatch review

reviewer: outer
at: 2026-08-12
changed: manager 034125 全量 AC 求值。AC38 未开工，判据明确、红窗可做。实现归 inner。
