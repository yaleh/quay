---
id: gap-routine-architecture-analysis-mjs-primitives-outside-both-dependency-graphs
title: "architecture-analysis: The AC-916 guard's walkTs matches only /\\.ts$/
  and import-graph-check's candidate filter is `/\\.(ts|mts|cts)$/`, while 4
  runtime primitives exist as .mjs — s"
status: done
labels:
  - gap
  - routine-filed
  - architecture-analysis
parent: null
children: []
extra: {}
---
## Finding
The AC-916 guard's walkTs matches only /\.ts$/ and import-graph-check's candidate filter is `/\.(ts|mts|cts)$/`, while 4 runtime primitives exist as .mjs — session-liveness.mjs and session-schema.mjs are imported by packages/quay/src/observation.ts:67-68, delivery-audit.mjs by packages/quay/src/serve/io/serve-send.ts:53, and session-liveness.mjs crosses the package boundary into plugin/scripts/orphan-session-check.ts:51; measured: walkTs sees 192 files and pty-frame.mjs/3 siblings are absent, matching archguard's own reconciliation 'sourceFiles=192 vs git ls-files=203 (diff -11)' = 4 .mjs + 4 .d.mts + 1 .md + 1 .json + 1 .css. So 'zero directory cycles' is asserted over a graph that omits 4 real modules, and rule 5 applies: a source that is not complete cannot prove absence.

载体记录（逐字来源）：`.quay/routine-findings.jsonl` · routine `architecture-analysis` · probe `architecture-analysis` · runId `architecture-analysis-1794127547195` · ts `2026-11-08T08:45:47.195Z`。

该 finding 由例程的机械通道产出，本任务由**同一条通道**依赖 `plugin/scripts/routine-file-gate.ts` 的三道闸
（quality / dedup / rate）机械立案 —— ⛔ 不是由人转抄，也不是由探针自行执行。

- 观测符号：`walkTs`、`analyzeDirectoryCycles`、`buildGraph`、`readTranscriptMtime`、`validateSessionRecord`
- 涉及文件：
- `packages/quay/test/directory-cycle.test.mjs:62`
- `plugin/scripts/import-graph-check.ts:552`
- `packages/quay/src/primitives/session-liveness.mjs:1`
- `packages/quay/src/primitives/session-schema.mjs:1`
- `packages/quay/src/observation.ts:67`
- `packages/quay/src/serve/io/serve-send.ts:53`
- `plugin/scripts/orphan-session-check.ts:51`
- kind：`coverage-gap`
- verdict：`CONFIRMED coverage gap — no cycle is hidden today, but the invariant does not cover 4 live files`

## Requested action
Widen both walkers to /\.(ts|mts|mjs)$/ (excluding .d.mts/.d.ts) and add a fixture where alpha/index.ts -> primitives/x.mjs -> beta/index.ts must be detected as a cycle.

## Effect Prediction
- metric: concept_recurs_after_merge
- expected: false
- statement: 修复后 `<none>` 不再以同一 subject 复发（同 concept_key 的后续记录数应为 0）
- recorded_at: 2026-11-08T08:45:47.195Z

## 复核与处置 (2026-11-08)

**复核（读数，非印象）**。载体行 `.quay/routine-findings.jsonl:3983`（kind=finding · findingId=`mjs-primitives-outside-both-dependency-graphs` · runId=`architecture-analysis-1794127547195` · dupKind=`coverage-gap`）。修复前逐处实测确认：

- `packages/quay/test/directory-cycle.test.mjs` 的 `walkTs` = `/\.ts$/`（仅排除 `.d.ts`）⇒ 真实树只走 **192** 个文件；4 个 `.mjs` 原语全不在图里。
- `plugin/scripts/import-graph-check.ts` 的节点过滤器 = `/\.(ts|mts|cts)$/` ⇒ 真实树读数 **files=563 edges=1752**，`.mjs` 只以 `notAnalyzed.mjs=83` 的形式出现在「范围外」计数里。
- 4 个 `.mjs` 是**运行时**模块而非声明：`packages/quay/src/primitives/{delivery-audit,pty-frame,session-liveness,session-schema}.mjs`（同目录的 4 个 `.d.mts` 才是声明）。

**处置：修掉**（不是「已有机制在管」）。changed surface 四处：

1. `walkTs` → `walkSources`：`/\.(ts|mts|mjs)$/`，排除 `/\.d\.(ts|mts|cts)$/`。
2. `import-graph-check.ts` 节点过滤器：`/\.(ts|mts|cts|mjs)$/`。
3. `isExcludedPath`：`.d.ts` → `.d.(ts|mts|cts)`。原实现只排除 `.d.ts`，而 `.d.mts` / `.d.cts` 通过各自的 `mts` / `cts` 尾巴**混进了节点集**当普通模块 —— 同一类缺陷低一层，一并修掉。
4. `notAnalyzed` 去掉 `mjs` 字段：它现在是节点，留一个结构上只能读 0 的字段不是测量（硬规则 4）；`.js`（实测 10 个）仍如实报数。

**修复后读数（可复核，一条命令）**：

- `node --experimental-strip-types plugin/scripts/import-graph-check.ts` ⇒ `files=639 edges=1838 (value 1674 / type 164)`、`valueSccs=0 typeSccs=0 reverseEdges=0`、exit 0（merge develop 前的一次同命令读数是 1837 边；修复前 563 节点 / 1752 边，三个棘轮量同为 0）。
  ⛔ **如实归因**：今天**没有**环被藏住，被修的是不变量的**覆盖范围**（finding 的 verdict 原文即「no cycle is hidden today, but the invariant does not cover 4 live files」）。三个量从 0 到 0 是**预期**，不是「没修成」。
- 4 个原语现在是节点，且与外部共有 **7** 条可解析边：1 条发出（`delivery-audit.mjs:20 → pty-frame.mjs`）+ 6 条来自外部。6 条中 3 条在 `packages/quay/src/`（`observation.ts:67`、`:68`、`serve/io/serve-send.ts:53`），3 条在 `plugin/scripts/` —— finding 只列了 `orphan-session-check.ts:51`，实测还有 `inner-blocked-signal.ts:149` 与 `peer-identity-probe.ts:32`（同一跨包边界，finding 漏报）。
- `node --test packages/quay/test/directory-cycle.test.mjs` ⇒ **7/7 pass**（`arm 1b` 直接读生产载体：真实树 walk 到那 4 个 `.mjs`，且没有任何 `.d.*` 混入）。
- `node --test plugin/test/import-graph-check.test.mjs` ⇒ **33/33 pass**。
- `bash scripts/test.sh --for-task gap-routine-architecture-analysis-mjs-primitives-outside-both-dependency-graphs --allow-thin` ⇒ **208/208 pass, exit 0**（fan-in 的同一个 scoped 门，在已 merge develop 的工作树上跑）。

**判据能取假（负控制，先红后绿）**。新增的 4 条断言全部先在**修复前的代码**上实跑过并失败，再在修复后转绿：

- directory-cycle：把 walker 临时改回 `/\.ts$/` ⇒ `arm 1b`（真实树看到 4 个 `.mjs`）与 `arm 2c`（`alpha/index.ts → primitives/x.mjs → beta/index.ts`）双双 ✖，其余 5 条仍 ✔。
- import-graph：`git checkout -- plugin/scripts/import-graph-check.ts` 回到修复前 ⇒ 新增的 `a .mjs module IS a node` 与 `declaration files are NOT nodes` 双双 ✖，其余 31 条仍 ✔。
- `arm 2c` 修复前的读数是 `evaluated:true, sccs:[]` —— 正是硬规则 3b 的失败形态：walker 少测，读数与「干净」同形。该 fixture 的 `.mjs` 是**边的发出者**，走不到 `.mjs` 整条边就消失，所以「只断言 .mjs 出现在文件列表里」的测试取不到假，这里刻意不用那种写法。

**硬规则 5b 扫描（同一载体里同类点的计数）**。grep `\.ts$` / `endsWith(".ts")` 于 `plugin/scripts` + `packages/*/src` + `packages/quay/test` 共 **21** 处命中；按「是不是依赖/覆盖图的遍历器」过滤后，同类残留 **1** 处：

- `plugin/scripts/fs-walk.ts:461` `KERNEL_SURFACE_SCAN_ROOTS` 把 `packages/quay/src` 写成 `ext: /\.ts$/`，而它是 `kernel-sibling-resolution-check.ts` + `target-identity-literal-check.ts` 的扫描面 ⇒ 同样漏这 4 个 `.mjs`，且这两个 checker **没有** `notAnalyzed` 式的如实报数（静默遗漏）。实测把 ext 放宽到 `/\.(ts|mjs)$/` 后扫描面 525 → 529 文件、两个 checker 仍 PASS —— 安全，但属于那两个 checker 自己的范围声明（两份 header 都写 `packages/quay/src/**/*.ts`），且 `fs-walk.ts` 不在本任务 `## Touches` 内 ⇒ **本任务不改，作为残留记录在此**（新任务立案归 manager/例程）。
- 非同类的两处，说明为什么不动：`packages/quay/test/kernel-pure-judges.test.mjs:67` 的 `walkTs` 主体是「这 8 个纯判官函数在 `.ts` 迁移面上只声明一次」，`.mjs` 不可能声明它们；`plugin/scripts/fan-in-ts-typecheck-gate.ts:65` 判的是「新增/移动的 `.ts`」对类型图的影响，`.mjs` 不在 `tsc` 的类型图里。

**ADR-007 暗轴记录**

- L_D import-graph-check (2026-11-08, .mjs 已入节点集): files=639 edges=1838 valueSccs=0 typeSccs=0 reverseEdges=0
- L_G archguard: cycles=0 （沿用本仓既有 readings；本任务未改 archguard 侧，其 sourceFiles vs `git ls-files` 对账差异仍由 `archguard-runner.ts` 如实点名，未静默吞）

## AC
- [x] `.quay/routine-findings.jsonl` 中 finding `mjs-primitives-outside-both-dependency-graphs`（routine `architecture-analysis`，runId `architecture-analysis-1794127547195`）所描述的问题被复核并处置
- [x] 处置结论可核：要么修掉，要么写明「已有机制在管、失败在哪一步」，⛔ 不以「已注意到」结案

## DoD
- [x] 上面的判据实跑通过
- [x] ⛔ 探针只立案不执行：本任务若需要跑产出者/修复，由派发链执行，⛔ 不由例程代跑

## Touches
- `packages/quay/test/directory-cycle.test.mjs`
- `plugin/scripts/import-graph-check.ts`
- `plugin/test/import-graph-check.test.mjs`
- `packages/quay/src/primitives/session-liveness.mjs`
- `packages/quay/src/primitives/session-schema.mjs`
- `packages/quay/src/observation.ts`
- `packages/quay/src/serve/io/serve-send.ts`
- `plugin/scripts/orphan-session-check.ts`
- `tasks/gap-routine-architecture-analysis-mjs-primitives-outside-both-dependency-graphs.md`