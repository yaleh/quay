---
id: gap-phantom-killer-false-negative-id-not-in-commits
title: phantom-killer 假阴性——hasLandedImplementation 靠 commit-message id-grep，实现提交不含 id 则漏判落地 ⇒ 已落地任务被推荐派发
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

**实证（2026-08-13，inner A6 前置发现）**：`gap-superseded-modeled-as-task-lifecycle-terminal` 是
done-but-not-flipped phantom——实现早已在 develop（deba6463/8a8fc8f6/f12863a8/8bf44f9f/2d3caab0/23c8fee3
均 ancestor），任务体 ACs 8/9，唯一未勾是外层全量验证，status 仍 ready。

**根因**：`hasLandedImplementation`（slot-refill.ts:338）用 `git log develop --grep <taskId>` 判落地——
本次实现提交消息里**从不含任务 id**（deba6463 等写「VALID_STATUSES 加 superseded」）⇒ grep 全 miss ⇒
**已落地任务仍被推荐**（实测：移出 in-flight 重跑 slot-refill，`recommended: ['gap-superseded-modeled-…']`）。

**这是 phantom-killer 的假阴性方向**（假阳性 51699289/1f99e276 已修——实现类文件白名单）。

**发生率（先测再定，硬规则 12 纪律）**：今日 landed-but-not-flipped 类共 17 条，其中被假阴性漏判 = **1 条**（superseded-modeled）。
**缓解已存在**：A6 fan-in 前置检查在 re-dispatch 前抓到了它（0 ahead、无物可 merge ⇒ 闭括号 + 清 worktree）。
⇒ **发生率低 + 已有缓解 ⇒ 本任务按候选（todo）立，非紧急前置**；若将来发生率上升（id-grep 漏判增多），升级。

**候选补法（inner 建议）**：task-body 侧信号——ACs 全勾 + 唯一未勾是外层验证项（（待外部）/「外层全量验证」标注）⇒
视同 landed（与 isLandedCodeComplete 的（待外部）判据同源，非平行造）。

## Plan

1. 记录发生率的观察点：phantom-killer 假阴性导致的「已落地被推荐」次数。
2. 候选补法评估：task-body 侧 landed 信号（ACs 全勾 + 未勾项均为外层验证）并入 hasLandedImplementation 或 isLandedCodeComplete。
3. 负控制：superseded-modeled 形态必须判 landed（不再被推荐）；真新任务（lanes-nproc/two-peer 类，id 只命中创建/框架提交）仍判非 landed。

## Acceptance Criteria

- [ ] AC1 发生率观察点建立（假阴性计数）。
- [ ] AC2 task-body 侧 landed 信号实现（若评估通过）：ACs 全勾 + 未勾项均为外层验证 ⇒ 视同 landed。
- [ ] AC3 负控制：superseded-modeled 形态判 landed；真新任务判非 landed。
- [ ] AC4 既有 phantom-killer 测试全绿；`--for-task` scoped 门绿。

## Definition of Done

- [ ] 发生率记录 + 补法实现（或评估后明确不做 + 理由）。
- [ ] 无假阴性回归（已落地不被推荐）。

## Touches

- plugin/scripts/slot-refill.ts（hasLandedImplementation 或 isLandedCodeComplete 扩展）
- plugin/test/slot-refill.test.mjs（假阴性用例）
- tasks/gap-phantom-killer-false-negative-id-not-in-commits.md（自身）

## Evidence

（落地后回填）
