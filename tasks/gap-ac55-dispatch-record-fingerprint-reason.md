---
id: gap-ac55-dispatch-record-fingerprint-reason
title: AC55 产物·承重条款——inner 派发记录带倾向文件指纹 + 一句为什么选它
status: ready
labels:
  - gap
  - mechanism
parent: null
children: []
extra:
  schema: execution
depends_on:
  - gap-ac54-dispatch-preference-file
---

**type:** execution

## Proposal

**AC55（产物·本阶段的承重条款）判据（phase-goal 逐字）**：
- 判据1：每条派发记录含 ①倾向文件的**内容指纹**（git blob hash 或等价，回答"用的是哪一版"）②**一句「为什么选它」**（回答"按倾向选还是随便选"）。
- 判据2（承重理由，C17）：**没有它，「读了没读」在记录上不可区分 ⇒ 只能靠意志 ⇒ 必然失守**——SPEC §4.2 已实证同一形态（manager 的 `A0b⑤(b)` 因"产物之后没人再用"而连续 4 轮被跳过）。
- 判据3（能取假）：拿一条**真实的**派发记录回放，**缺指纹或缺理由时必须报红**。
- **⚠️ 不要求解释每一次「不选」**（SPEC §7 逐字）——只解释**选了什么**，避免产物变成负担而被跳过（§4.2 教训的直接应用）。

**本任务不新建过程纪律型 AC**：负控制沿用既有 AC49。

## Plan

1. inner 的派发流程在派发记录里写入 ①倾向文件内容指纹（git blob hash，来自 AC54 的文件）②一句「为什么选它」。
2. 写检查器验证真实派发记录含指纹 + 理由（缺任一 ⇒ 红）。
3. **最强负控制（承重条款）**：拿一条**真实**派发记录回放，缺指纹或缺理由 ⇒ 必须报红（AC49 判据1 归属限定，落地方产出）。
4. 与 AC56 的顺序：**AC56（去序）不能先于本任务**（去了序而没有产物 = 把排序权交出去却无法核实它被怎么用了——SPEC §6）。

## Acceptance Criteria

- [x] AC1 每条派发记录含倾向文件内容指纹 + 一句「为什么选它」。
- [x] AC2 负控制（承重）：真实派发记录缺指纹或缺理由 ⇒ 检查变红。
- [x] AC3 不要求 inner 解释每一次「不选」（只解释选了什么——SPEC §7）。
- [x] AC4 既有测试全绿；`--for-task` scoped 门绿。

## Definition of Done

- [ ] 派发记录带指纹+理由落地 + 负控制（缺任一红）通过。
- [ ] 与 AC56 的顺序正确（AC56 不先于本任务）。

## Touches

- plugin/loop/fast-mode-loop-tick.md（inner 派发流程——步骤 4 新增第 7 步：派发记录写入点）
- orchestration/fast-mode-tick-core.md（A16b 行——派发记录 AC55 产物·承重，强制不可跳过）
- plugin/scripts/dispatch-record.ts（写入方——指纹 `git hash-object` + 一句理由，fail-closed）
- plugin/scripts/dispatch-record-fingerprint-reason-check.ts（检查器——缺指纹或缺理由 ⇒ 红）
- plugin/test/dispatch-record-fingerprint-reason-check.test.mjs（负控制：真实记录回放缺任一 ⇒ 红）
- plugin/scripts/checker-mutation-cases/dispatch-record-fingerprint-reason-check.sh（L_S 变异样例）
- scripts/test.sh（run_static_checks 接线，`@static-tier change`）
- plugin/scripts/capability-catalog.sh（五表声明）
- orchestration/dispatch-preference.md（指纹来源——AC54 正本）
- .gitignore（orchestration/dispatch-record.jsonl 运行时遥测条目）
- docs/proposals/quay-product-outline.md（`--write-inventory` 重新生成 §6 DELIVERY-INVENTORY 快照：scripts 228→230）
- tasks/gap-ac55-dispatch-record-fingerprint-reason.md（自身）

## Evidence

**AC1（指纹 + 一句理由，SPEC §4.3 产物）**：派发记录写入点 = `plugin/scripts/dispatch-record.ts`（inner 步骤 4 第 7 步 / tick-core A16b，先于 `--task-start`）。每条记录含 `preferenceFingerprint`（`git hash-object orchestration/dispatch-preference.md`，AC54 正本的 git blob hash）＋ `reason`（一句「为什么选它」）。实测一条真实记录：
```json
{"ts":"2026-08-14T01:50:22.469Z","taskId":"gap-smoke","preferenceFile":"orchestration/dispatch-preference.md","preferenceFingerprint":"e4881984fd7470da606eda4ba5104610c52bc2b7","reason":"覆盖段本阶段 AC55 优先——与阶段目标直接相关"}
```
（`e4881984…` = 真实 `git hash-object` 输出，与 AC54 证据一致。）

**AC2（负控制·承重，判据3，AC49 判据1 D2 归属限定）**：`plugin/scripts/dispatch-record-fingerprint-reason-check.ts` + `plugin/test/dispatch-record-fingerprint-reason-check.test.mjs`。拿**真实**派发记录（写入方产物）回放，三条负控制全红：
```
delete fingerprint ⇒ exit 1 RED（fingerprint-missing）
delete reason      ⇒ exit 1 RED（reason-too-thin）
reason = "随便"     ⇒ exit 1 RED（reason-too-thin，empty-vs-absent 守卫）
```
写入方 **fail-closed**：`--reason` 缺失/过薄 ⇒ exit 1、不写（真实负控制：`writer FAILS CLOSED` 测试断言记录文件不被创建）。变异样例 `checker-mutation-cases/dispatch-record-fingerprint-reason-check.sh` 全绿（基线→删指纹→红→恢复→删理由→红→恢复）。`checker-mutation-check --check` 通过：checkers_total=33（新增 1），checkers_with_mutation=33，mutations_that_stayed_green=0。

**AC3（不解释每一次「不选」，SPEC §7）**：写入方只要求一条 `--reason`（选了什么）；检查器只判「已派记录」的指纹+理由，**不**判任何未选任务。tick-core A16b 与 loop-driver 第 7 步均逐字「不要求解释每一次『不选』」。

**AC4（既有测试 + scoped 门）**：`scripts/test.sh --for-task gap-ac55-dispatch-record-fingerprint-reason --allow-thin` 全绿（exit 0）——33 tests / 33 pass / 0 fail（capability-catalog.test.mjs + dispatch-record-fingerprint-reason-check.test.mjs）；scoped static checks 全过（test-framework-policy / test-isolation / tmp-leak-pairing / test-impl-census / task-contract / malformed-task / adr016-screen-use / superseded-capability / dead-code-after-return / concurrency-literal / landing-target / commit-message-verified / delivery-inventory-drift-gate / dispatch-preference-check / **dispatch-record-fingerprint-reason-check** / capability-catalog / delivery-inventory）。doc-class：`tick-core-static-check` fast-mode=46/46（A16b 带 `(src:1020)`）PASS；`state-worded-clause-check` band 0 PASS。`delivery-inventory --write-inventory` 重新生成：scripts 228→230。

**与 AC56 顺序**：AC55（产物·承重）先落地；AC56（去序）不在本任务范围，SPEC §6 顺序未违反（产物在，去序才有可核依据）。
