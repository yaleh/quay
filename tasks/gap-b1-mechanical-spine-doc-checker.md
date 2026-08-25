---
id: gap-b1-mechanical-spine-doc-checker
title: B1·层 1 机械脊柱写成文档+检查器（exit 0/1/2 语义 + --json 输出契约，不符者 N→0）
status: ready
labels:
  - gap
  - feature
parent: null
children: []
extra: {}
---
**type:** execution

## Proposal

checker 的层 1「机械脊柱」目前是 CODIFY-EXISTING（几乎免费）：SPEC §2.3 实测 exit 0/1/2 语义 12/14 已符合、`--json` 输出 13/14 已支持（56/77）。但该契约没写下来、没检查器守着，所以不符者会静默漂移。写一份「checker 机械脊柱契约」文档（exit 码语义 + `--json` 输出形状）+ 一个检查器，把不符者计出来（棘轮：只减不增）。

## Plan

写 `checker-mechanical-spine` 契约文档（正本）+ 一个检查器：对 77 个 `.ts` checker（+ 32 `.sh`）逐个跑/静态判 exit 码语义与 `--json` 支持，输出不符者清单；配套 exemption list 棘轮（历史不符者豁免、新增不符者红）。⛔ 层 2 判定契约（复用 driver-result）归 B4，层 3 输入形状归 B5，不并入本任务。

## Acceptance Criteria

- [ ] AC1（能取假，契约文档）：机械脊柱契约文档存在（exit 0/1/2 语义 + --json 形状，逐条可 grep）；（⛔ 无文档 ⇒ 假）。
- [ ] AC2（能取假，棘轮计数）：不符者数 N 从当前值（~1-2 个 exit 码不符 + ~1 个 --json 不符）降到 0，且检查器守新增违例；（⛔ 不符者不降或新增违例不红 ⇒ 假）。
- [ ] AC3（能取假，负控制）：造一个用 exit 3 的 checker（不符契约），检查器必须红；（⛔ 不红 ⇒ 假）。

## Definition of Done

机械脊柱契约文档 + 检查器落地；AC1/AC2/AC3 全勾；不符者清零 + 棘轮挡回潮。

## Touches

- plugin/scripts/（checker-mechanical-spine 检查器 + 契约文档正本）
- plugin/test/（检查器负控制测试）
- tasks/gap-b1-mechanical-spine-doc-checker.md（自身）
