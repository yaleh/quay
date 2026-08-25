---
id: gap-b3-readfilesafe-normalizerel-unification
title: B3·readFileSafe(4)+normalizeRel(4) 合一——各 →1（canonicalTestFiles 已另立）
status: todo
labels:
  - gap
  - feature
parent: null
children: []
extra: {}
---
**type:** execution

## Proposal

SPEC §1.6 实测：`readFileSafe`(4) TRUE_DUP（另有 50 处 inline try/catch 散在 37 文件）；`normalizeRel`(4) TRUE_DUP（两份注释各自声称自己是规范版）。目标各合一为单一来源。⛔ `canonicalTestFiles` 组已单独立案 `gap-canonical-test-files-glob-vs-realpath-divergence`，本任务不重复（只收 readFileSafe + normalizeRel）。

## Plan

抽 `readFileSafe`、`normalizeRel` 单一实现；各迁移 4 处调用点；棘轮挡新增重定义。⛔ normalizeRel 两份「各自声称规范版」——实现时读两份注释与各自测试，判定哪份语义是正本（或合并差异）。

## Acceptance Criteria

- [ ] AC1（能取假，单一来源）：`readFileSafe` 与 `normalizeRel` 的独立定义数各 4 → 1（grep 计数）；（⛔ 仍 4 处 ⇒ 假）。
- [ ] AC2（能取假，负控制）：删共享 `readFileSafe`/`normalizeRel`，调用点编译/运行必须红；（⛔ 删了不红 ⇒ 假）。
- [ ] AC3（能取假，语义正确）：normalizeRel 合并后语义正确（两份声称规范版，合并后测试覆盖两者差异）；（⛔ 语义漂移 ⇒ 假）。

## Definition of Done

`readFileSafe` + `normalizeRel` 各单一来源；8 处迁移完；AC1/AC2/AC3 全勾。

## Touches

- plugin/scripts/（readFileSafe + normalizeRel 单一实现 + 8 处迁移）
- plugin/test/（合并语义测试 + 负控制）
- tasks/gap-b3-readfilesafe-normalizerel-unification.md（自身）
