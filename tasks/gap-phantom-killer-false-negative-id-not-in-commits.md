---
id: gap-phantom-killer-false-negative-id-not-in-commits
title: phantom-killer 假阴性——hasLandedImplementation 靠 commit-message
  id-grep，实现提交不含 id 则漏判落地 ⇒ 已落地任务被推荐派发
status: done
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

**⚠️ AC47 触发条件（manager 2026-08-13 写死，一行可查）**：本任务的候选补法（「ACs 全勾 + 未勾项均为外层验证 ⇒ 视同 landed」）字面上与 AC47 的「任何未勾框 ⇒ 不算 landed」相反，但按位置查消费者不冲突——`isLandedCodeComplete`/`hasLandedImplementation` 在 slot-refill.ts 之外**零消费者**，唯一用处 `:589 defer(id,"landed-implementation")` 只用于推荐排除、从不决定翻 done（"还要不要派" vs "能不能翻 done"是两个问题）。**触发条件**：这两个谓词一旦出现**翻 done 路径上的消费者**，AC47 即被静默击穿 ⇒ 届时必须复核本候选补法与 AC47 的相容性。

## Acceptance Criteria

- [x] AC1 发生率观察点建立（假阴性计数）。
- [x] AC2 task-body 侧 landed 信号实现（若评估通过）：ACs 全勾 + 未勾项均为外层验证 ⇒ 视同 landed。
- [x] AC3 负控制：superseded-modeled 形态判 landed；真新任务判非 landed。
- [x] AC4 既有 phantom-killer 测试全绿；`--for-task` scoped 门绿。

## Definition of Done

- [x] 发生率记录 + 补法实现（或评估后明确不做 + 理由）。
- [x] 无假阴性回归（已落地不被推荐）。

## Touches

- plugin/scripts/slot-refill.ts（hasLandedImplementation 或 isLandedCodeComplete 扩展）
- plugin/test/slot-refill.test.mjs（假阴性用例）
- tasks/gap-phantom-killer-false-negative-id-not-in-commits.md（自身）

## Evidence

（inner 2026-08-13 落地，见提交信息）

**AC1 发生率观察点**：slot-refill 结果 JSON 新增 `phantom_killer_false_negative_caught` ——
每次求值中「body-side landed 信号抓到、而 git-grep `hasLandedImplementation` 漏掉」的 ready 任务数
（`bodyLanded && !gitLanded`）。0 表示本次求值未观察到假阴性方向。实证基线 = **1**（
superseded-modeled，今日 17 条 landed-but-not-flipped 中被假阴性漏判的唯一一条）。

**AC2 补法实现**：`isBodyLanded(body)`（slot-refill.ts 导出）——ACs 全勾 + 未勾项均为外层验证
⇒ 视同 landed，OR 进派发判定的 landed 信号：`const landed = hasLandedImplementation(root,id) || isBodyLanded(text)`。
外层验证项识别 = 复用 pool 单一来源 `isExternalVerificationItem`（`（待外部）`）+ 新增
`isOuterVerificationItem` 外层全量验证族（`全量套件绿…——外层 verification-round 验证` /
`外层全量验证`）。`isLandedCodeComplete` 第三臂同步从 `isExternalVerificationItem` 扩为
`isOuterVerificationItem`（非平行造：`（待外部）` 臂仍走 pool 单一来源）。`isBodyLanded` 要求
`total > 0`——无复选框的真新任务不得仅凭任务体判 landed（防假阳性）。

**AC3 负控制（实测）**：
- superseded-modeled 形态（实现提交无 id、ACs 全勾 + 唯一未勾是外层全量套件项 `——外层 verification-round 验证`）
  → `isBodyLanded` true → **判 landed**，deferred `landed-implementation`，不再被推荐。
- 真新任务（lanes-nproc 类，id 只命中 task-creation 提交 tasks/<id>.md）→ `hasLandedImplementation` false +
  `isBodyLanded` false → **判非 landed**，仍被推荐。`phantom_killer_false_negative_caught` 保持 0。

**AC4 scoped 门**：`scripts/test.sh --for-task gap-phantom-killer-false-negative-id-not-in-commits --allow-thin`
**exit 0**——72/72 pass、0 fail、0 cancelled；静态检查全 PASS（含 task-contract-check: no violations）。
slot-refill.test.mjs 新增 3 条 PHANTOM-KILLER FALSE NEGATIVE 用例（含 `makeLandedNoIdWorkspace`
真 git 仓库——develop 上实现已 merge 但无任何提交消息含任务 id）。
