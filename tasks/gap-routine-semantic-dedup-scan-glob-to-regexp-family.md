---
id: gap-routine-semantic-dedup-scan-glob-to-regexp-family
title: "semantic-dedup-scan: Four wildcard grammars: design supports ** and
  slash-scoped *, shipped-set omits **, release-model lets * cross '/', touches
  escapes '?' as a literal and lets "
status: ready
labels:
  - gap
  - routine-filed
  - semantic-dedup-scan
parent: null
children: []
extra: {}
---
## Finding
Four wildcard grammars: design supports ** and slash-scoped *, shipped-set omits **, release-model lets * cross '/', touches escapes '?' as a literal and lets ** match zero directories — one parameterised builder could cover all behind 3-4 flags.

载体记录（逐字来源）：`.quay/routine-findings.jsonl` · routine `semantic-dedup-scan` · probe `semantic-dedup-scan` · runId `semantic-dedup-scan-1794222946369` · ts `2026-11-09T11:15:46.369Z`。

该 finding 由例程的机械通道产出，本任务由**同一条通道**依赖 `plugin/scripts/routine-file-gate.ts` 的三道闸
（quality / dedup / rate）机械立案 —— ⛔ 不是由人转抄，也不是由探针自行执行。

- 观测符号：`globToRegExp`
- 涉及文件：
- `plugin/scripts/design-evolution-readings.ts:206`
- `plugin/scripts/release-model-check.ts:165`
- `plugin/scripts/shipped-set-rules.ts:93`
- `plugin/scripts/touches-orthogonality-check.ts:123`
- kind：`same-symbol-multi-file`
- verdict：`divergent-implementation`

## Requested action
extract

## Effect Prediction
- metric: concept_recurs_after_merge
- expected: false
- statement: 修复后 `<none>` 不再以同一 subject 复发（同 concept_key 的后续记录数应为 0）
- recorded_at: 2026-11-09T11:15:46.369Z

## Disposition

**结论：修掉（`extract` 已落地）—— ⛔ 不是「已注意到」。**

复核：四个 `globToRegExp` 不是四个 bug，而是四种**方言**（path / branch / rsync / touches）。
差异逐行可核：`*` 是否跨 `/`；`**` 是否跨目录、是否吃一个 `/<`（因而匹配零层目录）；`?` 是
非 `/` 字符 / 任意字符 / 字面 `?`。把它们折叠成一种语法会静默改变某一侧的行为（分支名里的 `/`
是名字的一部分 —— `rel/*` 必须匹配 `rel/1.0`；路径里的 `/` 是分隔符），因此处置是**参数化抽取**，
不是统一语法。

落地：
- 唯一实现 `compileGlobPattern(glob, dialect)` @ `plugin/scripts/gate-script-base.ts`（四个载体
  本来就 import 该模块 ⇒ **无新增 import 边**）。
- 四个载体保留历史 1 参 `globToRegExp`，各自委派到自己的命名方言：
  `design-evolution-readings.ts:208 → path`、`release-model-check.ts:169 → branch`、
  `shipped-set-rules.ts:96 → rsync`、`touches-orthogonality-check.ts:128 → touches`。
- 反证与读数（实跑）：
  - 抽取前：四个载体各有一个 `function globToRegExp`（`git show 80e662258:… | grep -c` 均 = 1，共 4）。
  - 抽取后：`grep -rl 'function compileGlobPattern' plugin/scripts/ | wc -l` ⇒ `1`；四个载体私有编译残留
    `grep -l 'new RegExp(' …` ⇒ `0`。
  - `node --test plugin/test/glob-dialects.test.mjs` ⇒ 9 pass / 0 fail（单一实现 ratchet、委派负控制、
    四条分叉行双向断言、删掉导出即链接失败的机制负控制）。
  - 四个载体既有测试 ⇒ 132 pass / 0 fail / 1 skipped。
  - 本任务 scoped gate `bash scripts/test.sh --for-task gap-routine-semantic-dedup-scan-glob-to-regexp-family --allow-thin`
    ⇒ exit 0，264 pass / 0 fail / 1 skipped。
- L_D import-graph: new_import_edges=0, glob_compiler_definitions=1

## AC
- [x] `.quay/routine-findings.jsonl` 中 finding `glob-to-regexp-family`（routine `semantic-dedup-scan`，runId `semantic-dedup-scan-1794222946369`）所描述的问题被复核并处置
- [x] 处置结论可核：要么修掉，要么写明「已有机制在管、失败在哪一步」，⛔ 不以「已注意到」结案

## DoD
- [x] 上面的判据实跑通过
- [x] ⛔ 探针只立案不执行：本任务若需要跑产出者/修复，由派发链执行，⛔ 不由例程代跑

## Touches
- `plugin/scripts/design-evolution-readings.ts`
- `plugin/scripts/release-model-check.ts`
- `plugin/scripts/shipped-set-rules.ts`
- `plugin/scripts/touches-orthogonality-check.ts`
- `plugin/scripts/gate-script-base.ts`
- `plugin/test/glob-dialects.test.mjs`
- `tasks/gap-routine-semantic-dedup-scan-glob-to-regexp-family.md`
