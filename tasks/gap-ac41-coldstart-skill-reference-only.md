---
id: gap-ac41-coldstart-skill-reference-only
title: '冷启动 skill 与 tick 引用同一批行为文件，不各自复述——plugin/skills/cold-start/SKILL.md 现 388 行，## Steps 240 行 cmd=23（动作）、其余 148 行（如 Why…nohup does NOT pass cmd=0）是理由；理由段搬去被引用文件，Steps 留下，tick 与冷启动引用同一批文件；与 AC38（outer 双份文档漂移）同判据，一起收'
status: todo
labels:
  - gap
  - defect
  - delivery-critical
parent: null
children: []
extra: {}
---
**type:** execution

## Proposal

**冷启动 skill 与 tick 必须引用同一批行为文件，不各自复述。`plugin/skills/cold-start/SKILL.md` 现 388 行——`## Steps` 240 行 cmd=23（动作），其余 148 行（如 `Why…nohup does NOT pass` cmd=0）是理由。理由段搬去被引用文件，Steps 留下，并确保 tick 与冷启动引用同一批文件。**

**这是 AC41 判据 2（单一批文件）。** 与 AC38（outer 双份文档共同行 954、各有 200-350 行独有 = 漂移）是**同一条判据在文档层的实例**——都要求「单一真源 + 引用，不复述」。

### 实证（manager 2026-08-10 10:0x + outer 复核）

- **cold-start SKILL.md = 388 行**（outer 复核 `wc -l` = 388）。
- **`## Steps` 240 行 cmd=23（动作）**；**其余 148 行是理由**（如 `Why…nohup does NOT pass`，cmd=0）。
- **人裁定方向**：「冷启动 skill 也应像 manager tick 一样精简、只提供对相应文件的引用，把行为固化在这些文件里，tick 等处引用同一批文件。」
- **AC38 同判据**：outer 双份文档（plugin 1309 / orchestration 1164）共同行 954，各有 200-350 行独有 = 漂移；manager 已切分（plugin 322 / orchestration 1505 / 共同 181）——「产品行为进 plugin / 本层状态留 orchestration」。

**为什么重要**：行为固化（AC41 的目标）要求「一份正本，多处引用」。skill 里 148 行理由 + tick 里的复述 = 双份漂移源——改一处漏另一处，与 AC38 同型。冷启动 skill 是别人拿到 quay 后第一个接触的面，理由段会误导（把它当步骤）。

### 选定机制方向（实现归 inner，判定归 outer）

1. **理由段搬走**：`Why…nohup does NOT pass` 等 148 行理由搬去被引用文件（如 `orchestration/*-tick-core.md` 的档案段或 `docs/analysis/`），SKILL.md 只留 `## Steps` 动作。
2. **tick 引用同一批文件**：manager/orchestrator/fast-mode tick 核引用的行为文件集合 = 冷启动 skill 引用的集合（同一批）。
3. **AC38 一并收**：outer 双份文档按 manager 先例切分（产品行为进 plugin / 本层状态留 orchestration），留切分声明。

**验证锚**：修后 (a) SKILL.md 理由段 0（或全部引用）；(b) tick 与冷启动引用同一批行为文件；(c) 无同一内容在 skill + tick 双份出现；(d) AC38 切分后两份独有内容各自可解释。

## Acceptance Criteria

- [ ] AC1: **复现固化**——任务体记录 SKILL.md 388 行（Steps 240 cmd=23 / 理由 148 cmd=0）+ 人裁定方向 + AC38 同判据（本任务 Proposal 已含）
- [ ] AC2: **理由段搬走**——SKILL.md 理由段（Why…nohup 等）搬去被引用文件，Steps 留下
- [ ] AC3: **同一批文件**——tick 与冷启动引用同一批行为文件（集合相等）
- [ ] AC4: **AC38 一并收**——outer 双份文档按 manager 先例切分（产品行为进 plugin / 本层状态留 orchestration），留切分声明
- [ ] AC5: **既有不回归**——`--for-task` scoped 门绿

## Definition of Done

- [ ] AC1–AC5 全部勾上
- [ ] 修后实跑：SKILL.md 理由段搬走（贴 diff）；tick 与冷启动引用同一批文件（贴集合对比）
- [ ] 既有测试 + 新增测试全绿（`--for-task` scoped）
- [ ] 全量套件绿（`fail 0` 且 `cancelled 0` 且 `FULL-SUITE-EXIT=0`）——外层 verification-round 验证

## Touches

- plugin/skills/cold-start/SKILL.md（AC2：理由段搬走，Steps 留下）
- orchestration/manager-tick-core.md / orchestrator-tick-core.md / fast-mode-tick-core.md（AC3：引用同一批行为文件）
- orchestration/orchestrator-loop-tick.md（AC4：与 plugin/loop/orchestrator-loop-tick.md 切分）
- plugin/loop/manager-loop-tick.md / orchestrator-loop-tick.md / fast-mode-loop-tick.md（AC4：产品行为正本）
- orchestration/manager-phase-goal.md（AC41 判据 2 正本——本任务 Proposal 已引用）
- tasks/gap-ac41-actionize-state-worded-clauses.md（交叉标注——同 AC41 判据 1）
- tasks/gap-ac41-red-on-omission-artifact.md（交叉标注——同 AC41 判据 3）
- tasks/gap-ac38-outer-doc-drift.md（交叉标注——AC38 同判据，一并收）
- tasks/gap-ac41-coldstart-skill-reference-only.md（自身：勾 AC + 贴证据）

## Contract

measure   skill_reason_lines = `grep -cE "Why|because|理由|为什么" plugin/skills/cold-start/SKILL.md` 的 stdout 数字
band      skill_reason_lines = 0（理由段搬走，Steps 留下）
invariant tick_coldstart_same_files = 1（tick 与冷启动引用同一批行为文件）
invariant ac38_split_declared = 1（AC38 切分声明在场）
invoke    `grep -nE "Why|because" plugin/skills/cold-start/SKILL.md`（贴搬走前后）
control   理由段搬走；同一批文件；AC38 切分；既有不回归
resume    理由段搬走 / 同一批文件 / AC38 切分分步提交，任一步完成即写盘

## Dispatch review

reviewer: outer
at: 2026-08-10
changed: 人裁定「冷启动 skill 精简、只引用相应文件，行为固化在这些文件里，tick 引用同一批」+ manager AC41 判据 2。SKILL.md 388 行（理由 148）→ 理由搬去被引用文件。AC38 同判据一并收。实现归 inner
