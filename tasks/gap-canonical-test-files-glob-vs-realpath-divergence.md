---
id: gap-canonical-test-files-glob-vs-realpath-divergence
title: canonicalTestFiles 整组复制进 3 checker，2 份偏离 shell 正本的 realpath 语义（glob
  顺序凑巧掩盖分歧，无测试守）
status: done
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

抽 `canonicalTestFiles` 公共库（单一来源，放 `plugin/scripts/canonical-test-files.ts`），采用 realpath 语义（与 shell 正本一致）；3 个 checker（test-group-downgrade-check / test-framework-policy-check / test-impl-census-check）改为 import 公共库，删各自拷贝；补负控制 fixture（符号链接在其目标之前被 glob 到，测试放 `plugin/test/canonical-test-files-symlink-order.test.mjs`），断言抽库前后行为一致（realpath 语义）。⛔ 新建文件按上述命名落地，不另取名。

## Acceptance Criteria

- [x] AC1（能取假，单一来源）：`canonicalTestFiles` 抽为公共导出，3 个 checker 全部 import 它（grep 无各自的重复拷贝）；（⛔ 仍有重复拷贝 ⇒ 假）。
      → 实测：`grep -rn "function canonicalTestFiles\|function parseCanonicalGlobs\|function expandGlob" plugin/scripts/{test-group-downgrade,test-framework-policy,test-impl-census}-check.ts` 命中 0（无各自重复拷贝）；唯一定义在 `plugin/scripts/canonical-test-files.ts`，三 checker 均 `import { canonicalTestFiles } from "./canonical-test-files.ts"` 并 `export { canonicalTestFiles }`。
- [x] AC2（能取假，负控制）：构造「符号链接在其目标之前被 glob 到」的 fixture，3 个 checker 的输出一致（都 realpath 去重，与 shell 正本一致）；（⛔ 输出仍分歧 ⇒ 假）。
      → 实测：`plugin/test/canonical-test-files-symlink-order.test.mjs` 建 glob 顺序 `experiments/.../test/*` 先于 `plugin/test/*` 的 fixture，断言 shared/fromDowngrade/fromPolicy/fromCensus 四路输出逐字节一致 = `["plugin/test/shared.test.mjs"]`；`node --experimental-strip-types --test` → 2 pass 0 fail。
- [x] AC3（能取假，语义正确）：公共库采用 realpath 语义（与 `scripts/test.sh build_deduped_files` 一致），测试断言 symlink 指向的目标被去重；（⛔ glob 语义残留 ⇒ 假）。
      → 实测：公共库 `canonicalTestFiles` 用 `fs.realpathSync` 去重并输出 realpath 的 repo-relative 路径（`path.relative(repoRoot, rp)`），与 `scripts/test.sh:813 rp="$(realpath "$f")"` 同语义；测试断言 symlink 目标 `plugin/test/shared.test.mjs` 仅出现一次且为 realpath（非 glob 路径）。

## Definition of Done

- [x] `canonicalTestFiles` 单一来源 + realpath 语义；3 checker 迁 import；AC1/AC2/AC3 全勾；负控制 fixture 绿。
      → 实测：三 checker `--selftest` 全绿（downgrade 11/0、policy 22/0、census PASS）；负控制 fixture `node --test` 2 pass 0 fail；capability-catalog `--summary` 293 declared / 0 unclassified。

## Execution evidence

```
$ grep -rn "function canonicalTestFiles\|function parseCanonicalGlobs\|function expandGlob" \
    plugin/scripts/test-group-downgrade-check.ts plugin/scripts/test-framework-policy-check.ts \
    plugin/scripts/test-impl-census-check.ts plugin/scripts/canonical-test-files.ts
plugin/scripts/canonical-test-files.ts:24:export function parseCanonicalGlobs(...)
plugin/scripts/canonical-test-files.ts:41:export function expandGlob(...)
plugin/scripts/canonical-test-files.ts:76:export function canonicalTestFiles(...)

$ node --no-warnings --experimental-strip-types --test plugin/test/canonical-test-files-symlink-order.test.mjs
✔ symlink globbed before its target collapses to the realpath, once (AC2/AC3)
✔ distinct real files are all returned — realpath dedup is not false-dedup
tests 2 · pass 2 · fail 0

$ node --no-warnings --experimental-strip-types plugin/scripts/test-group-downgrade-check.ts --selftest
test-group-downgrade-check --selftest: 11 passed, 0 failed
$ node --no-warnings --experimental-strip-types plugin/scripts/test-framework-policy-check.ts --selftest
test-framework-policy-check --selftest: 22 passed, 0 failed
$ node --no-warnings --experimental-strip-types plugin/scripts/test-impl-census-check.ts --selftest
SELFTEST PASS: impl-deleted test flagged; live/mirror/no-impl tests clean.

$ bash plugin/scripts/capability-catalog.sh --summary
capability-catalog: 293 scripts | 293 declared | 0 unclassified | 288 ship
```

## Touches

- plugin/scripts/canonical-test-files.ts (new)（canonicalTestFiles 公共库，realpath 语义）
- plugin/scripts/test-group-downgrade-check.ts（迁移到公共库）
- plugin/scripts/test-framework-policy-check.ts（迁移到公共库）
- plugin/scripts/test-impl-census-check.ts（迁移到公共库）
- plugin/test/canonical-test-files-symlink-order.test.mjs (new)（symlink 顺序负控制 fixture）
- plugin/scripts/capability-catalog.sh（canonical-test-files.ts 六表注册）
- plugin/scripts/quay-init.sh（canonical-test-files.ts 显式 laydown 注册——test-framework-policy-check.ts 被铺设并经 ESM import 本库，closure (d) 只扫 shell `${SCRIPT_DIR}/` 引用扫不到 ESM import）
- tasks/gap-canonical-test-files-glob-vs-realpath-divergence.md（自身）

## Needs-Human

**执行 2026-08-28T16:19:44.203Z — 连续修满重试上限仍不合格（标 needs-human）**

- 阻碍原因：worker-driver 连续 3 次 exited-not-landed 未落地（重试上限）
