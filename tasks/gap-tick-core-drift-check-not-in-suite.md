---
id: gap-tick-core-drift-check-not-in-suite
title: tick-core --check-drift 存在但不在 run_static_checks——三份执行核双向漂移（A12 行号 :31 vs :45 已实际误导；第五次同族：仪器在消费者无）
status: todo
labels:
  - gap
  - defect
  - mechanism
parent: null
children: []
extra:
  schema: execution
---

**type:** execution

## Proposal

**实证（manager 2026-08-13 人指令「全面检查 tick 文件冗余与错误」，用项目自己的机件）**：
```
$ bash plugin/scripts/quay-init.sh --check-drift
drift-report: 漂移 3 / 缺失 0 / 一致 94 (derived-set 97)
  drift: orchestration/fast-mode-tick-core.md
  drift: orchestration/manager-tick-core.md
  drift: orchestration/orchestrator-tick-core.md
行数：fast-mode 81 vs plugin/loop 94 · manager 106 vs 84 · orchestrator 100 vs 80
```
**双向分歧**（各有一份对方没有的内容），不是单向落后。

**已实际造成伤害（2026-08-13 当晚）**：A12 在 `orchestration/` 是 **:31**、在 `plugin/loop/` 是 **:45**——
三层各引一份，花了一轮消息对齐（manager 先引 :31 报错、outer 核为 :45，更正后才对齐）。**不是理论风险。**

**缺口（第五次同族：仪器在消费者无）**：`--check-drift` 只在有人**手动**跑时执行——`tick-core-static-check.ts`
头注释自己写着 `grep -c "tick-core" scripts/test.sh = 0`，**套件里没有它**。仪器已经存在，缺的是消费者
（前四次：treeMutatedMidRound 无后果 / assert-clean-tree.sh 零调用 / malformed 字段无消费者 / phase_ac_checked 生产无）。

## Plan

1. 把 `--check-drift` 的 3 条漂移（三份 tick-core）接进 `run_static_checks`（scoped tier 同面）——检查已存在，加消费者。
2. 漂移时打印两侧行数 + 差异摘要（不是「漂移/一致」布尔）。
3. 负控制：当前 3 条漂移被检出（修复前就是红）。

## AC

- [ ] AC1: `--check-drift` 的 3 条 tick-core 漂移接进 run_static_checks（scoped tier 同面）
- [ ] AC2: 漂移时打印两侧行数 + 差异摘要
- [ ] AC3: 负控制——当前 3 条漂移被检出
- [ ] AC4: 既有测试全绿；`--for-task` scoped 门绿

## Definition of Done

- [ ] AC1–AC4 全部勾上
- [ ] 负控制样例贴出（当前 3 条漂移被检出）
- [ ] 全量套件绿

## Touches

- scripts/test.sh（run_static_checks 加 drift 检查）
- plugin/scripts/quay-init.sh（--check-drift 已存在，接消费者）
- plugin/scripts/tick-core-static-check.ts（如需）
- tasks/gap-tick-core-drift-check-not-in-suite.md（自身）
