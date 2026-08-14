---
id: gap-ac54-dispatch-preference-file
title: AC54 正本——倾向文件存在且三段齐全（默认/覆盖/维护者），git 可见可取假
status: ready
labels:
  - gap
  - mechanism
parent: null
children: []
extra:
  schema: execution
depends_on:
  - gap-ac46-pool-criteria-in-gate-plus-revaluation-executor
---

**type:** execution

## Proposal

**人裁定（2026-08-14）**：下一阶段目标 = 实现 `SPEC-dispatch-ordering-semantic-2026-08-13.md`——把「先派谁」的决定权从退化的 `1/cost` 机制排序移交给 inner 的语义选择，并使这次移交【可核】：
机制只答「能不能派」，inner 答「先派谁」，而「inner 按什么在选」任何人都能查。

**AC54（正本）判据（phase-goal 逐字）**：
- 判据1：单一文件、**git 可见**（不得放 gitignored 的 `.quay/` 下——抗 compact、跨会话重启存活是它的立身理由），且同时含 **默认段 / 覆盖段 / 维护者字段** 三者。
- 判据2（能取假，负控制由落地方产出——沿用 AC49 判据1 的 D2 归属限定）：**删掉任一段 ⇒ 检查必须变红**；一个从未在缺段样本上红过的检查不算判据。
- 为什么三段都必要（SPEC §4.4 逐字）：**没有默认段与维护者字段，manager 消失后它会变成孤儿**——内容还在、没人更新、而 inner 仍按它选；那正是「写着的东西比它的前提活得久」的形态。
- **⚠️ 不规定路径与格式**（SPEC §7）——那是实现面。

**本任务不新建过程纪律型 AC**：负控制/隔离自证沿用既有 AC49。

## Plan

1. 创建倾向文件（git 可见路径，含 **默认段**（manager 不在时生效）/ **覆盖段**（manager 在时的当前倾向）/ **维护者字段**（谁负责更新）），三段结构清晰。
2. 写检查器验证三段齐全（缺任一段 ⇒ 红）。
3. **负控制（AC49 判据1 归属限定）**：对三个缺段样本（各删一段）跑检查器，必须全红；未曾在缺段样本上红过的检查不算达成。
4. 与 AC55 对接：倾向文件的内容指纹（git blob hash 或等价）由 AC55 的派发记录消费。

## Acceptance Criteria

- [ ] AC1 倾向文件 git 可见（不在 .quay/ 下），含默认段/覆盖段/维护者字段三段。
- [ ] AC2 删任一段 ⇒ 检查变红（负控制三个缺段样本全红，落地方产出）。
- [ ] AC3 文件形态不预设具体路径/格式（SPEC §7 不覆盖——实现面自定）。
- [ ] AC4 既有测试全绿；`--for-task` scoped 门绿。

## Definition of Done

- [ ] 倾向文件落地（git 可见、三段齐全）+ 检查器 + 负控制三个缺段样本全红。
- [ ] 为 AC55 的内容指纹提供稳定来源。

## Touches

- （实现面自定路径/格式——倾向文件；SPEC §7 不规定）
- （检查器 + 负控制 fixture）
- tasks/gap-ac54-dispatch-preference-file.md（自身）

## Evidence

（落地后回填）
