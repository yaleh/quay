---
id: gap-check-set-after-change-diff-nameonly-intersect-judged-objects
title: 改任何文件后跑哪些测试，用 git diff --name-only ∩ 测试自声明的判定对象机械求出（A0b③ 指错检查对象）
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

**实证（manager 2026-08-12，A0b③ 判据指错对象）**：manager 改随包副本
`plugin/loop/manager-tick-core.md`（cp 引入 `plugin/loop/orchestrator-loop-tick.md` 字面引用）后，
按 A0b③「改完自己的核就跑覆盖它的那一个检查」跑了 `tick-core-static-check` → PASS，
但该检查**不覆盖「随包副本禁 plugin/loop/ 引用」这条约束**——约束它的是
`quay-init-loop-consumer-doc-refs.test.mjs` AC3（20.3ms 纯内容检查，含 AC37 regression 负控）。
全量套件 round 59 红（~71 失败，12+ laydown 家族）才把维度指出来。错误链（manager 自述，完整）：
cp「安全」判定只核了 A 编号维 → 提交前跑覆盖文件的检查 PASS 强化了错误结论 → 直到看失败原文才定案。

**根因**：「改文件后跑哪个检查」靠作者记得（A0b③ 只写「覆盖它的那一个」，而
`plugin/loop/manager-tick-core.md` 没有同名测试，约束它的测试叫 `quay-init-loop-consumer-doc-refs`）。
**同名不够**——约束集合必须从测试的判定对象集合机械求出。

**一般形态**：与「合并验收 = diff --name-only ∩ 触及文件同名测试」是同一推广的两面
（作者自查 A0b③ + 合并验收）。同名测试覆盖不到「改 A 文件被 B 测试约束」的情形。

## Plan（manager 2026-08-12 补充：判定对象由测试自己声明，不建集中表）

1. **每个测试在文件头声明自己的判定对象集合**（像本仓库其它 checker 的判定手法，如
   `adr016-screen-use-check` / `test-framework-policy-check`）。声明格式：文件/路径模式列表——
   `quay-init-loop-consumer-doc-refs` 声明约束 `plugin/loop/*` 随包文档。
   **判据放在被约束者身上**：集中映射表会与测试漂移，今天已数过太多次「表与实体漂移」。
2. 改动后自查 / 合并验收时：`git diff --name-only` ∩ 判定对象集合 → 跑交集内全部测试。
3. 负控制：重现 manager 12a6b18b 的 cp 错误链——改 plugin/loop/manager-tick-core.md 时
   机械求出的集合必须包含 quay-init-loop-consumer-doc-refs（且不含 tick-core-static-check）。

## AC

- [ ] AC1: 判定对象声明机制存在，测试自声明（文件头），quay-init-loop-consumer-doc-refs 声明约束 plugin/loop/* 随包文档
- [ ] AC2: 改 plugin/loop/manager-tick-core.md 后机械求出的测试集合包含 quay-init-loop-consumer-doc-refs（负控：不含 tick-core-static-check）
- [ ] AC3: 负控制——重现 12a6b18b 的 cp 错误链，判据在提交前拦住（不靠全量套件兜底）
- [ ] AC4: 既有测试全绿；`--for-task` scoped 门绿

## Definition of Done

- [ ] AC1–AC4 全部勾上
- [ ] 负控制样例贴出（见 Evidence）
- [ ] 全量套件绿

## Touches

- 判定对象声明解析机件（plugin/scripts/ 或 plugin/test/）
- 作者自查 / 合并验收机件（gate 或 scripts/）
- tasks/gap-check-set-after-change-diff-nameonly-intersect-judged-objects.md（自身）
