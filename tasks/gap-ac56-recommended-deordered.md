---
id: gap-ac56-recommended-deordered
title: AC56 去锚——机制输出不再携带有意义的序（recommended 无序可行集或字典序+标注）
status: ready
labels:
  - gap
  - mechanism
parent: null
children: []
extra:
  schema: execution
depends_on:
  - gap-ac55-dispatch-record-fingerprint-reason
---

**type:** execution

## Proposal

**AC56（去锚）判据（phase-goal 逐字）**：
- 判据1：`recommended` 改为**无序可行集**，或按**明显无意义的稳定序**（字典序）并**明确标注"序无意义"**。
- 判据2（能取假）：**若输出仍按 `1/cost` 排 ⇒ 检查必须变红。**
- 判据3（防"只改文案"）：**判据必须读【输出本身】，不得只读文档标注**——仅在注释里写"序无意义"而实际仍有序 ⇒ **不算达成**。
- 理由（SPEC §5）：**inner 拿到有序列表会被锚定**，即使它有语义倾向也很难无视"机制推荐的第一个" ⇒ 不去序，新划分就只是名义上的。

**顺序（SPEC §6，不可改）**：本任务**不先于 AC55**（去了序而没有产物 = 把排序权交出去却无法核实它被怎么用了）。

**本任务不新建过程纪律型 AC**：负控制沿用既有 AC49。

## Plan

1. `slot-refill` 的 `recommended` 改为无序可行集，或字典序 + 明确标注「序无意义」。
2. 写检查器**读【输出本身】**（不是读文档标注）：若 `recommended` 仍按 `1/cost` 排（有意义的序）⇒ 红；字典序 + 标注「序无意义」或无序 ⇒ 绿。
3. 负控制：构造一个仍按 `1/cost` 排序的输出样本 ⇒ 必须红（AC49 判据1 归属限定）。

## Acceptance Criteria

- [x] AC1 `recommended` 无序可行集，或字典序 + 明确标注「序无意义」。
- [x] AC2 检查器读【输出本身】：仍按 1/cost 排 ⇒ 红；防"只改文案"。
- [x] AC3 负控制：1/cost 排序样本 ⇒ 红。
- [x] AC4 既有测试全绿；`--for-task` scoped 门绿。

## Definition of Done

- [x] recommended 去序落地 + 检查器读输出本身 + 负控制红。
- [x] 顺序正确（不先于 AC55）。

## Touches

- plugin/scripts/slot-refill.ts（recommended 去序 + recommended_order 标注 + ranking 改按优先级序）
- plugin/scripts/ac56-recommended-deordered-check.ts（检查器——读输出本身）
- plugin/test/ac56-recommended-deordered-check.test.mjs（判据1/2/3 正反控制测试）
- plugin/scripts/checker-mutation-cases/ac56-recommended-deordered-check.sh（L_S 变异样例）
- plugin/test/slot-refill.test.mjs（recommended 序断言更新为去序 + ranking 断言）
- plugin/test/ac36-sortkey-criterion-check.test.mjs（E2E 断言更新：recommended 去序、ranking 保优先级）
- scripts/test.sh（run_static_checks 接线，@static-tier change）
- plugin/scripts/capability-catalog.sh（五表声明）
- docs/proposals/quay-product-outline.md（`--write-inventory` 重新生成 §6 快照）
- tasks/gap-ac56-recommended-deordered.md（自身）

## Evidence

**AC1（recommended 去序，判据1 option 2）**：`plugin/scripts/slot-refill.ts` 的 `recommended` 在组装后按 id 字典序重排（`recommended.sort((a,b)=>a.localeCompare(b))`），并在输出携带显式标注 `recommended_order: "lexicographic-by-id (order meaningless — 字典序，不代表优先级)"`。实测真实 slot-refill 输出（含 delivery-critical 任务）：
```json
{"recommended":["gap-a","gap-b"],"recommended_order":"lexicographic-by-id (order meaningless — 字典序，不代表优先级)","ranking":[{"id":"gap-b","deliveryCritical":true,"rank":0},{"id":"gap-a","deliveryCritical":false,"rank":1}]}
```
`recommended` 为字典序（DC 任务不在首位——inner 不会被锚定）；`ranking` 仍保优先级序（DC rank 0）——AC36 诊断面未破坏（rank 语义 = 优先级序内位置，非去序后的 recommended 位置）。

**AC2（检查器读输出本身，判据3）**：`plugin/scripts/ac56-recommended-deordered-check.ts` 只读输出的 `recommended` 数组 + `recommended_order`/`recommended_unordered` 字段（按位置不按关键词，硬规则 2），不读任何文档/注释。三态判定：`recommended` 长度>1 必须字典序（否则 `recommended-not-lexicographic` ⇒ 红）+ 必须带「序无意义」标注（否则 `order-meaningless-annotation-missing` ⇒ 红）；长度≤1 平凡绿；`recommended` 缺值/非数组 ⇒ 红（硬规则 6 缺值=未查）。`--root` 模式跑真实 slot-refill CLI 并核实时输出（standing static-check 面）。

**AC3（负控制，判据2）**：`plugin/test/ac56-recommended-deordered-check.test.mjs` 12 条全绿——1/cost 排序样本（DC 首位）⇒ RED（recommended-not-lexicographic）；「只改文案」样本（标注称序无意义但数组仍优先级序）⇒ RED；字典序但无标注 ⇒ RED（order-meaningless-annotation-missing）；真实 slot-refill CLI 输出 ⇒ GREEN。变异样例 `checker-mutation-cases/ac56-recommended-deordered-check.sh` 全绿（基线→优先级序→红→恢复→删标注→红→恢复）。`checker-mutation-check --check` 通过：checkers_total=35（新增 1），checkers_with_mutation=35，mutations_that_stayed_green=0，uncovered=0。

**AC4（既有测试 + scoped 门）**：`scripts/test.sh --for-task gap-ac56-recommended-deordered --allow-thin` 全绿（exit 0）——117 tests / 117 pass / 0 fail（slot-refill + ac56-recommended-deordered-check + ac36-sortkey-criterion-check + capability-catalog 四文件）；scoped static checks 全过（含 `ac56-recommended-deordered-check` PASS、`delivery-inventory-drift-gate` PASS、capability-catalog 五表声明）。`fan-in-ts-typecheck-gate --task … --merge-target develop` GREEN（exit 0，type graph changed 含新 .ts）。既有测试的 recommended 序断言已按去序语义更新（slot-refill.test.mjs 75 条 / ac36 E2E 14 条全绿），ranking 承接优先级序断言（AC36 判据② 仍机械可核）。

**与 AC55 顺序**：AC55（产物·承重）status: done 已先落地；本任务（去序）在其后实现，SPEC §6 顺序未违反。
