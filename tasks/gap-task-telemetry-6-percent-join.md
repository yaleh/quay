---
id: gap-task-telemetry-6-percent-join
title: 任务落地记录与遥测记录 6% join — fan-in 提交需带 runId 桥接两套记录
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

**机制缺陷（manager 2026-08-12 021354 实测）**：任务落地记录与遥测记录几乎不相交（join 率 6%）。

**实测（可复核）**：
| 量 | 值 |
|---|---|
| git 里 `merge: fan-in task/*` 的不同任务名 | 139 |
| `milestones/fast-mode-telemetry/*.json` 里的不同 taskId | 152 |
| 两者交集 | **9（6%）** |
| 只在 git 没遥测 | 130 |
| 只在遥测没 git | 143 |

**不是命名问题**：85% 相似度模糊匹配 44 个未匹配 git 名 → 命中 0。

**后果**：一个任务落地了，没有机械路径查出它跑了多久；一条遥测记录存在，没有机械路径查出它的代码在哪。吞吐分析失去地基（git 寿命系统性低估，真工时在遥测里差一个量级）；AC18「自己重跑 measure」对象无法回溯到代码；遥测结局（abandoned/needs-human）无法对应分支。

**修法方向（outer 裁定）**：fan-in 提交信息带 `runId`——`merge: fan-in task/<id> (runId: fm-...)`，按位置可解析、零新机件；或反向在遥测记录里存 fan-in commit sha。**实现归 inner，判定归 outer。**

**验证锚**：修后 (a) 新 fan-in 提交含 runId；(b) 从遥测 taskId 能机械回溯到 git 分支；(c) `--for-task` scoped 门绿。

## Acceptance Criteria

- [ ] AC1: **复现固化**——任务体记录 6% join 实测（139 git vs 152 遥测，交集 9）（本任务 Proposal 已含）
- [ ] AC2: **fan-in 带 runId**——`merge: fan-in task/<id>` 提交信息含 `(runId: fm-...)`（按位置可解析）
- [ ] AC3: **回溯可达**——从遥测 taskId 能机械查到其 fan-in 提交/分支
- [ ] AC4: **既有不回归**——`--for-task` scoped 门绿

## Definition of Done

- [ ] AC1–AC4 全部勾上
- [ ] 修后实跑：新 fan-in 提交含 runId + 回溯样例贴出
- [ ] 既有测试 + 新增测试全绿（`--for-task` scoped）
- [ ] 全量套件绿（`fail 0` 且 `cancelled 0` 且 `FULL-SUITE-EXIT=0`）——外层 verification-round 验证

## Touches

- plugin/scripts/integration-batch-merge.sh（fan-in 提交带 runId）
- plugin/scripts/fast-mode-telemetry.ts（遥测记录存 fan-in commit sha / 读 runId）
- plugin/scripts/fan-in-runid-check.ts（新：runId 存在性检查器）
- plugin/test/（fan-in runId 用例）
- tasks/gap-task-telemetry-6-percent-join.md（自身：勾 AC + 贴证据）

## Contract

measure   fanin_runid_present = `git log -1 --format=%s <最新 fan-in merge>` 的 stdout 是否含 `runId:`
band      fanin_runid_present = true（新 fan-in 提交带 runId）
invariant telemetry_traceable = 1（遥测 taskId → git 分支机械可回溯）
invoke    `git log --oneline -3 | grep -E 'fan-in.*runId'`（贴带 runId 的 fan-in 提交）
control   fan-in 带 runId；回溯可达；既有不回归
resume    fan-in runId / 遥测回溯 / 检查器 / 测试分步提交，任一步完成即写盘

## Dispatch review

reviewer: outer
at: 2026-08-12
changed: manager 021354 实测（6% join）。fan-in 提交带 runId 桥接两套记录。实现归 inner。
