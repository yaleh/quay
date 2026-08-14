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

- [x] AC1 倾向文件 git 可见（不在 .quay/ 下），含默认段/覆盖段/维护者字段三段。
- [x] AC2 删任一段 ⇒ 检查变红（负控制三个缺段样本全红，落地方产出）。
- [x] AC3 文件形态不预设具体路径/格式（SPEC §7 不覆盖——实现面自定）。
- [x] AC4 既有测试全绿；`--for-task` scoped 门绿。

## Definition of Done

- [x] 倾向文件落地（git 可见、三段齐全）+ 检查器 + 负控制三个缺段样本全红。
- [x] 为 AC55 的内容指纹提供稳定来源。

## Touches

- orchestration/dispatch-preference.md（倾向文件正本——git 可见、三段齐全；实现面自定路径/格式，SPEC §7 不规定）
- plugin/scripts/dispatch-preference-check.ts（检查器——三段任一缺失/过薄 ⇒ RED）
- plugin/test/dispatch-preference-check.test.mjs（负控制：三个缺段样本全红 + 真实文件全绿）
- plugin/scripts/capability-catalog.sh（为新检查器补 QUESTION/CADENCE/INVALIDATION/LAST_REAFFIRMED/MATCHING 五表声明）
- plugin/scripts/checker-mutation-cases/dispatch-preference-check.sh（mutation case——注入「删掉覆盖段」⇒ 检查器必须红；L_S 仪器）
- scripts/test.sh（把检查器接入 run_static_checks，`@static-tier change`）
- docs/proposals/quay-product-outline.md（`--write-inventory` 重新生成 §6 DELIVERY-INVENTORY 快照：scripts 227→228）
- tasks/gap-ac54-dispatch-preference-file.md（自身）

## Evidence

**AC1（git 可见 + 三段）**：倾向文件 = `orchestration/dispatch-preference.md`（实现面自定路径/格式，SPEC §7 不规定）。git 可见——`git ls-files orchestration/` 跟踪，不在 gitignored 的 `.quay/` 下；`git check-ignore orchestration/dispatch-preference.md` 返回非零（未被忽略）。三段齐全：`## 默认段`（manager 不在时生效：红窗优先 → gap 优先于 DIR → 其余任选）/ `## 覆盖段`（manager 在时的当前倾向：本阶段 AC54–AC57 优先）/ `## 维护者字段`（维护者：manager）。

**AC2（负控制，AC49 判据1 D2 归属限定——落地方产出）**：检查器 `plugin/scripts/dispatch-preference-check.ts`。三个缺段样本（各删一段）全红（exit 1），由测试 `plugin/test/dispatch-preference-check.test.mjs` 逐条断言：
```
delete 默认段 ⇒ exit=1 RED（missing: 默认段）
delete 覆盖段 ⇒ exit=1 RED（missing: 覆盖段）
delete 维护者字段 ⇒ exit=1 RED（missing: 维护者字段）
```
（另含「内容删空、标题留壳」样本 ⇒ RED，堵 empty-vs-absent 混淆。）

**AC3（不预设路径/格式）**：路径与格式由本实现面自定（`orchestration/dispatch-preference.md` + `## 段标题` 格式）；SPEC §7 不覆盖，未被他处预设。

**AC4（既有测试 + scoped 门）**：`scripts/test.sh --for-task gap-ac54-dispatch-preference-file --allow-thin` 全绿——26 tests / 26 pass / 0 fail（capability-catalog.test.mjs + dispatch-preference-check.test.mjs）；scoped static checks 全过（test-framework-policy / test-isolation / tmp-leak-pairing / dispatch-preference-check / capability-catalog / delivery-inventory-drift-gate 等）。`scripts/test.sh --static-checks-doc` 亦绿（exit 0；tick-core-drift 为既有 `--no-block` 报告，非本改动引入）。

**AC55 指纹来源**：`orchestration/dispatch-preference.md` 的 git blob hash（`git hash-object orchestration/dispatch-preference.md`）——AC55 的派发记录据此指认「用的是哪一版」。
