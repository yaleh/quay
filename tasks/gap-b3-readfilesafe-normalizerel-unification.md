---
id: gap-b3-readfilesafe-normalizerel-unification
title: B3·readFileSafe(4)+normalizeRel(4) 合一——各 →1（canonicalTestFiles 已另立）
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

SPEC §1.6 实测：`readFileSafe`(4) TRUE_DUP（另有 50 处 inline try/catch 散在 37 文件）；`normalizeRel`(4) TRUE_DUP（两份注释各自声称自己是规范版）。目标各合一为单一来源。⛔ `canonicalTestFiles` 组已单独立案 `gap-canonical-test-files-glob-vs-realpath-divergence`，本任务不重复（只收 readFileSafe + normalizeRel）。

## Plan

抽 `readFileSafe`、`normalizeRel` 单一实现；各迁移 4 处调用点；棘轮挡新增重定义。⛔ normalizeRel 两份「各自声称规范版」——实现时读两份注释与各自测试，判定哪份语义是正本（或合并差异）。

## Acceptance Criteria

- [x] AC1（能取假，单一来源）：`readFileSafe` 与 `normalizeRel` 的独立定义数各 4 → 1（grep 计数）；（⛔ 仍 4 处 ⇒ 假）。— `grep -rnE "function (readFileSafe|normalizeRel)" plugin/scripts/*.ts` 各仅 1 处（`gate-script-base.ts`）；test `AC1 — readFileSafe/normalizeRel is defined exactly once`。
- [x] AC2（能取假，负控制）：删共享 `readFileSafe`/`normalizeRel`，调用点编译/运行必须红；（⛔ 删了不红 ⇒ 假）。— 8 处旧局部拷贝已删、各消费点改 import `gate-script-base.ts`；test `AC2 — deleting the shared export makes a consumer import fail`（scratch 删导出 ⇒ 消费 import SyntaxError 红，恢复 ⇒ 绿）。
- [x] AC3（能取假，语义正确）：normalizeRel 合并后语义正确（两份声称规范版，合并后测试覆盖两者差异）；（⛔ 语义漂移 ⇒ 假）。— 两份「声称规范版」代码逐字节相同，合并为该代码；test `AC3 — normalizeRel preserves the full normalization contract` 覆盖 14 个归一化边例（`./`、`//`、`.`、`..`、尾 `/`、反斜杠、通配符、前导 `..` 等）。

## Definition of Done

`readFileSafe` + `normalizeRel` 各单一来源；8 处迁移完；AC1/AC2/AC3 全勾。

## Evidence

- 单一来源：`readFileSafe` + `normalizeRel` 定义收敛到 `gate-script-base.ts`（框架原语库，已具 `node:fs`/`node:path` 导入、40+ 消费方）。它是 sync-vendor.sh `SYNC_SCRIPTS` vendored 文件（SOURCE=`experiments/quay-perpetual-stream/scripts/`、镜像=`plugin/scripts/`，`--check` 要求两副本字节一致——故源与镜像各 +31 行，两副本字节一致）。
- 8 处迁移：readFileSafe 4 处（test-framework-policy-check / test-impl-census-check / test-group-downgrade-check / config-wiring-check）+ normalizeRel 4 处（select-static-checks-for-touches / select-tests-for-touches / suite-bucket-attribution / inner-exec-mode-report）各删局部拷贝、改 import；另有 3 处既有 readFileSafe import（test-isolation-check / tmp-leak-pairing-check / live-repo-literal-assert-check）改指向 gate-script-base。
- 棘轮 + 负控制 + 语义测试：`plugin/test/gap-b3-readfilesafe-normalizerel-unification.test.mjs`（7 测试全绿）。
- 越界同名词（非本任务收口，SPEC §1.6 只数 plugin/scripts）：`scripts/test-coverage-check.ts` 自带 readFileSafe（顶层产品层 checker）、`packages/quay/src/serve-tests.ts` 自带 normalizeRel（产品核心，零 plugin import 边界）——均非 plugin/scripts 方法学层 checker，本任务按 Touches 不触碰。

## Touches

- plugin/scripts/（readFileSafe + normalizeRel 单一实现 + 8 处迁移）
- plugin/test/（合并语义测试 + 负控制）
- experiments/quay-perpetual-stream/scripts/gate-script-base.ts（sync-vendor SOURCE 副本，与 plugin 镜像字节一致）
- tasks/gap-b3-readfilesafe-normalizerel-unification.md（自身）
