---
id: gap-canonical-test-files-glob-vs-realpath-divergence
title: canonicalTestFiles 整组复制进 3 checker，2 份偏离 shell 正本的 realpath 语义（glob 顺序凑巧掩盖分歧，无测试守）
status: ready
labels:
  - gap
  - defect
parent: null
children: []
extra: {}
---
**type:** execution

## Proposal

`canonicalTestFiles`/`parseCanonicalGlobs`/`expandGlob`/`readFileSafe` 整组（~221 行中 ~146 行纯重复）被复制进 3 个 checker：`test-group-downgrade-check.ts`、`test-framework-policy-check.ts`、`test-impl-census-check.ts`。三份里有两份在拷贝时偏离了 shell 正本的 realpath 语义：
```
scripts/test.sh build_deduped_files()   realpath（正本，AC3 注释「deduped by realpath」）
test-group-downgrade-check.ts           realpath ← 与正本一致
test-framework-policy-check.ts          glob 匹配路径 ← 偏离
test-impl-census-check.ts               glob 匹配路径 ← 偏离
```
目前因 glob 顺序凑巧（`plugin/test` 早于 `experiments/.../test`，10 个符号链接都指回前者）两者输出相同，**但改 glob 顺序或在被链接目录之前新增 symlink 就会分歧，且无任何测试守着**。

## Plan

抽 `canonicalTestFiles` 公共库（单一来源），采用 realpath 语义（与 shell 正本一致）；3 个 checker 改为 import 公共库，删各自拷贝；补负控制 fixture（符号链接在其目标之前被 glob 到），断言抽库前后行为一致（realpath 语义）。

## Acceptance Criteria

- [ ] AC1（能取假，单一来源）：`canonicalTestFiles` 抽为公共导出，3 个 checker 全部 import 它（grep 无各自的重复拷贝）；（⛔ 仍有重复拷贝 ⇒ 假）。
- [ ] AC2（能取假，负控制）：构造「符号链接在其目标之前被 glob 到」的 fixture，3 个 checker 的输出一致（都 realpath 去重，与 shell 正本一致）；（⛔ 输出仍分歧 ⇒ 假）。
- [ ] AC3（能取假，语义正确）：公共库采用 realpath 语义（与 `scripts/test.sh build_deduped_files` 一致），测试断言 symlink 指向的目标被去重；（⛔ glob 语义残留 ⇒ 假）。

## Definition of Done

`canonicalTestFiles` 单一来源 + realpath 语义；3 checker 迁 import；AC1/AC2/AC3 全勾；负控制 fixture 绿。

## Touches

- plugin/scripts/（canonicalTestFiles 公共库 + 3 checker 迁移）
- plugin/test/（symlink 顺序负控制 fixture）
- tasks/gap-canonical-test-files-glob-vs-realpath-divergence.md（自身）
