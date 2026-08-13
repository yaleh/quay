---
id: gap-ac47-completion-predicate-consumer-fail-closed
title: AC47 谓词装上翻 done 闸前置：fail-open 修复 + 消费者落 inner 翻 done 路径 + 历史 done 不得当证据
status: todo
labels:
  - gap
  - mechanism
  - defect
parent: null
children: []
extra:
  schema: execution
---

**type:** execution

## Proposal

**AC47 谓词早就是对的作用域（`countCompletionCheckboxes`，AC+DoD 两段一并计），缺的是消费者**——
翻 done 已移交 inner（AC46 判据3）⇒ 调用点应落 inner 的翻 done 路径。**但在装闸之前必须先修 fail-open**：

**fail-open 实测（manager 2026-08-13 更正，方向相反于我此前「漏数 7 条」的归类）**：
```
task-status-drift-check.ts:126  if (!acSection) return { total: 0, checked: 0, unchecked: 0 };
extractSectionByShape 认不出 `## Acceptance Criteria (runnable — …)` 这类带后缀标题 ⇒ 返回 null
⇒ countAcCheckboxes(null) ⇒ unchecked: 0 ⇒ countCompletionCheckboxes 报零未勾 ⇒ 该任务被判【完成】
```
**实测**：DIR-014 有 5 个未勾框（在 `## Acceptance Criteria (runnable — …)` 下），countCompletionCheckboxes 报
`{total:0, checked:0, unchecked:0}` ⇒ 被判合格。**7 条同类任务不是「被漏数」，是被放行。**
`unchecked: 0` 同时表示「查了，零未勾」与「根本没找到那一段」——两个含义共用一个返回值（硬规则 3：布尔化把
「对象没了」伪装成「检查通过」）。**且该 fail-open 已活在 slot-refill 的 LANDED-IMPLEMENTATION 推荐路径上**
（countCompletionCheckboxes 喂 landed 判定）——不是只有未来的闸受影响。

**发生率**：盲区 7 条（实测）；危害发生率目前 0（无闸消费）。**但 AC47 的动作正是加消费者** ⇒
这不是凭空设前置（硬规则 12），是「在把已知放行路径接到闸上之前先堵掉它」——触发条件是我们自己计划中的下一步。

## Plan

1. **fail-closed 修复（装闸前置，两个入口都覆盖）**：把「段不存在」与「段存在且零未勾」分开——
   `countAcCheckboxes(null)` 不再返回零未勾；返回可区分的态（如 `{sectionFound:false}`）。
   `extractSectionByShape` 返回 null ⇒ **fail closed**（不算完成）。
   **⚠️ 全量消费者枚举（manager 2026-08-13 第三跳，按位置，排除定义处与测试）= 5 个**：
   ```
   countCompletionCheckboxes 消费者
     slot-refill.ts:373        isLandedCodeComplete          ← 主 fail-open（total===0 → true，实测 DIR-014 true）
     ready-pool-check.ts:793   :760 注释 "(countCompletionCheckboxes, total > 0)" → 已守 total>0 ⇒ fail-CLOSED
     ready-pool-check.ts:1754  解构 cb.unchecked（段不可读 → unchecked=0 → acOpen=0 → nyfBacklogCount++，误分「干净积压」）
   countAcCheckboxes 直接消费者（绕过 countCompletionCheckboxes）
     slot-refill.ts:274        const { total, checked } = countAcCheckboxes(ac)   ← 解构，段不可读 → total=0 → return false
     task-status-drift-check.ts:810  acBoxes.total > 0 守卫 ⇒ 隐式 fail-CLOSED
   ```
   **⚠️ 结构坑（同一课题上一级）**：改根的返回形状 ≠ 所有消费者的行为——`:126` 返回 `sectionFound:false`
   只有显式读该字段的站点才 fail-closed；**解构式站点（:274/:1754）拿不到新字段，照旧放行**。
   **收口（不靠「记得改每个消费者」——那是意志不是产物，C17）**：让旧读法拿不到零——
   段不可读时返回解构后必然不合格的值（如 `total: NaN` 使 `total===0` 与 `checked===total` 都为假），
   **或**把 `:126` 拆成两个函数、旧名保留给「段确定存在」路径。**判据（一行可查）**：
   修完后对 DIR-014 跑全部 5 个消费者，没有任何一个报「完成/landed」。
   **为什么这个形态能停（manager 通则，2026-08-13）**：枚举依赖修法（逐个消费者改读 sectionFound）的正确性
   =「我们找全了消费者」⇒ 每多一个消费者 = 一次新失守、未来才写的消费者必不在任何枚举里 ⇒ 追不完；
   **不依赖枚举的修法**（旧读法结构上得不出合格）对「还没写出来的消费者」同样成立 ⇒ 可以停。
   负控制（AC2 覆盖 5 站）是**证据**（当下没漏），形态（NaN/拆函数）是**保证**（不复发）——两者不互相替代。
   同根异象：同一 fail-open 在不同消费者表现不同（landed / 干净积压 / 不跳过）⇒ 按现象找缺陷会漏。
2. **SHAPE_SECTIONS 登记带后缀标题**（manager 倾向此修法而非前缀匹配——前缀会把
   `## Acceptance Criteria for the OLD design` 也吞进来，给已出问题的匹配器加不确定性）：
   显式枚举 `## Acceptance Criteria (runnable — …)` / `## Definition of Done — REAL LANDING is the bar` 等
   变体；**未登记的走 fail-closed 而不是被静默吞掉**（与本仓库 shape-aware 既有形态一致——`（draft）` 变体当初就这么加的）。
3. **消费者落 inner 翻 done 路径**：翻 done 前用 countCompletionCheckboxes 核 AC/DoD 无未勾框
   （`sectionFound:false` 时**拒绝翻 done 并报「AC/DoD 段未识别」**，不静默通过）。
4. **历史 done 不当证据**：`status: done` 目前不等于「AC+DoD 已满足」（440/1069 带未勾框，多为 DIR 类未来工作，
   不清理）。**任何机制不得把历史 `done` 当作「AC/DoD 已满足」的证据**——前向闸只保证从今往后，不追溯、也不该被读成追溯过。

## Acceptance Criteria

- [ ] AC1 fail-closed：`extractSectionByShape` 返回 null（段未识别）⇒ 不计为完成；`sectionFound:false` 可区分于「段存在且零未勾」。
- [ ] AC2 负控制（**全部 5 个消费者**，一行可查）：对 DIR-014（带后缀标题+未勾框），没有任何一个消费者报「完成/landed」——
      `slot-refill.ts:373 isLandedCodeComplete` 不判 landed · `slot-refill.ts:274 isNotYetFlippedSkip` 不误放行 ·
      `ready-pool-check.ts:793` 不判 allChecked · `ready-pool-check.ts:1754` 不误分「干净积压」·
      `task-status-drift-check.ts:810` 不误过。
- [ ] AC3 SHAPE_SECTIONS 登记带后缀变体；未登记变体走 fail-closed。
- [ ] AC4 消费者落 inner 翻 done 路径：`sectionFound:false` 时拒绝翻 done 并报「AC/DoD 段未识别」。
- [ ] AC5 历史 done 不当证据：任务体写明「任何机制不得把历史 done 当作 AC/DoD 已满足的证据」。
- [ ] AC6 既有测试全绿；`--for-task` scoped 门绿。

## Definition of Done

- [ ] fail-closed 修复落地 + 负控制通过（DIR-014 不再判合格）。
- [ ] 消费者落翻 done 路径 + `sectionFound:false` 拒绝并报出。
- [ ] 历史 done 不当证据禁令写入任务体。

## Touches

- plugin/scripts/task-status-drift-check.ts（countAcCheckboxes fail-closed）
- plugin/scripts/ready-pool-check.ts（countCompletionCheckboxes 区分 sectionFound / SHAPE_SECTIONS 登记变体）
- plugin/scripts/slot-refill.ts（LANDED-IMPLEMENTATION 推荐路径消费 sectionFound）
- plugin/test/（fail-closed 负控制用例）
- tasks/gap-ac47-completion-predicate-consumer-fail-closed.md（自身）

## Evidence

（落地后回填）
