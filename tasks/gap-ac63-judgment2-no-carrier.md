---
id: gap-ac63-judgment2-no-carrier
title: AC63 判据2 无载体——lock-events 无 doc 检查字段，结构上无法判「有 ff 而无 doc 检查」（manager 11:1xZ 报）
status: todo
labels:
  - gap
  - mechanism
parent: null
children: []
extra:
  schema: execution
depends_on: []
---

**type:** execution

## Proposal

**（AC63 判据2 无载体——manager 11:1xZ 实测）**。

**现状**：`.quay/fan-in-merge-lock-events.jsonl` 的 keys 打印为：
```
[agentId, epoch, event, pid, runId, taskId, ts]
```
**无任何 doc 检查字段** ⇒ 判据2「有 ff 而无 doc 检查」（fan-in 走了 ff-only 但没跑 `--static-checks-doc`）**结构上无法判**——记录里没有这个信息，判据恒无法取假（硬规则 4：结构上不可能取假的量不是测量）。

**判据1**：判据2 的载体落地——per-task 记录里带上 doc 检查的痕迹（如 `docChecked` 字段或 doc 检查的 runId/退出码），使「有 ff 而无 doc 检查」可判。**⚠️ 与 AC72 的 per-task-suite-record 的关系**：AC72 已落 per-task suite 记录（第三方可读）；doc 检查痕迹可并入该记录（不另起文件）或补 lock-events 字段。
**判据2（能取假）**：构造/回放一条「有 ff 而无 doc 检查」的真实记录 ⇒ 判据必须红；现状（无字段）⇒ 判据结构上无法评估（NOT-EVALUATED 或恒绿）即为真样本。
**判据3**：与 AC72（per-task suite 记录）合并或互相 depends_on——不重复造记录文件。

**不覆盖**：不改 fan-in 协议本体；不规定 doc 检查的格式（实现面）。

**本任务不新建过程纪律型 AC**：负控制沿用 AC49。

## Plan

1. 读 AC72 的 per-task-suite-record（现有记录形态）+ AC63 判据2 原文。
2. 判据1：doc 检查痕迹载体落地（并入 per-task-suite-record 或 lock-events 补字段）。
3. 判据2 能取假：「有 ff 而无 doc 检查」回放红；现状无字段回放为结构上不可判（真样本）。
4. 判据3：与 AC72 合并/互 depends_on，不重复造文件。
5. 既有测试全绿 + `--for-task` scoped 门绿。

## Acceptance Criteria

- [ ] AC1 判据1：doc 检查痕迹载体落地（可判「有 ff 而无 doc 检查」）。
- [ ] AC2 判据2 能取假：「有 ff 而无 doc 检查」回放红；现状无字段为真样本（结构上不可判）。
- [ ] AC3 判据3：与 AC72 per-task-suite-record 合并或互 depends_on。
- [ ] AC4 既有测试全绿；`--for-task` scoped 门绿。

## Definition of Done

- [ ] AC63 判据2 载体落地：doc 检查痕迹（如 docChecked 字段或并入 per-task-suite-record）使「有 ff 而无 doc 检查」结构上可判
- [ ] 能取假：「有 ff 而无 doc 检查」的真实记录回放红；现状无字段（结构上不可判）为真样本
- [ ] 与 AC72 per-task-suite-record 合并或互相 depends_on，不重复造记录文件

## Touches

- plugin/scripts/per-task-suite-record.ts（doc 检查痕迹并入——与 AC72 对齐）或 plugin/scripts/fan-in-ff-merge.sh（lock-events 补字段）
- plugin/scripts/per-task-suite-record-check.ts（判据2 检查更新）
- plugin/test/per-task-suite-record-check.test.mjs（补测）
- tasks/gap-ac63-judgment2-no-carrier.md（自身）

## Evidence

（落地后回填）
