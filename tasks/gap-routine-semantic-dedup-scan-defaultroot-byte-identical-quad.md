---
id: gap-routine-semantic-dedup-scan-defaultroot-byte-identical-quad
title: "semantic-dedup-scan: Three defaultRoot bodies are byte-identical
  (path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')) and a
  fourth sibling has already migrated "
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
Three defaultRoot bodies are byte-identical (path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')) and a fourth sibling has already migrated to the sanctioned path.resolve(mainCheckoutRoot(here) or repoRoot(here)) form.

载体记录（逐字来源）：`.quay/routine-findings.jsonl` · routine `semantic-dedup-scan` · probe `semantic-dedup-scan` · runId `semantic-dedup-scan-1792033478766` · ts `2026-10-15T03:04:38.766Z`。

该 finding 由例程的机械通道产出，本任务由**同一条通道**依赖 `plugin/scripts/routine-file-gate.ts` 的三道闸
（quality / dedup / rate）机械立案 —— ⛔ 不是由人转抄，也不是由探针自行执行。

- 观测符号：`defaultRoot`
- 涉及文件：
- `plugin/scripts/checker-count-drift-check.ts:151`
- `plugin/scripts/import-graph-check.ts:834`
- `plugin/scripts/sh-census-check.ts:1035`
- `plugin/scripts/task-granularity-advice.ts:909`
- kind：`byte-identical-body`
- verdict：`real-duplication`

## Requested action
merge

## Disposition
**复核结论：finding 属实（`real-duplication`），处置 = 修掉（merge）。** 不是「已注意到」，也不是「已有机制在管」。

三处逐字节相同的私有 `defaultRoot()`（`plugin/scripts/checker-count-drift-check.ts`、`import-graph-check.ts`、
`sh-census-check.ts`）各自把「脚本所在目录向上恰好两级」当成仓根的【定义】。第四个被点文件复核后确认
**不是待修项**：`task-granularity-advice.ts:909` 的 `defaultRoot(here)` 起手就写成
`path.resolve(mainCheckoutRoot(here) || repoRoot(here))`，即共享访问器形态，本身不含第二份拷贝（它是 finding 用来
对照「sanctioned form」的那一侧）。

**改法**：三处私有函数删除，调用点改用 `repoRoot(here)`（`plugin/scripts/repo-root.ts` 的共享访问器，
全仓 90+ 文件已在 import）。共享的家本来就存在 ⇒ 这是纯粹的 copy-instead-of-call 债，与
`gate-script-base.ts` 里 `flagValue`/`resolveRoot`/`parseJsonArg` 三次同款抽取的先例同族。

**行为等价的取证（本条的硬读数，实跑不是推断）**：

- 替换式与原式在这三个位置**同值**：`repoRoot(plugin/scripts) === path.resolve(plugin/scripts, "..", "..")` ⇒ `true`，值为本 worktree 根。
- 三个检查器**不带 `--root`** 各跑一次，全部 `exit 0`（`checker-count-drift-check` 自报 root=本 worktree 根；`import-graph-check` files=471 edges=1347；`sh-census-check` 145 tracked .sh · 6566 embedded-interpreter lines）。
- 归零读数：被点的三个文件里该形态的出现数 **1/1/1 → 0/0/0**（`git show develop:<file>` 对拍盘上文件，逐文件测）。
- 专抓此形态的棘轮 `plugin/scripts/repo-root-derivation-check.ts` 扫 381 个文件 **PASS**（exit 0）。
- 既有测试 47/47 绿（`plugin/test/{checker-count-drift-check,import-graph-check,sh-census-check}.test.mjs`）。

**⛔ 有意不照抄第四处的 `mainCheckoutRoot(here) || repoRoot(here)`** —— 这是有理由的分叉，不是遗留的不一致。
这三个是**检查器**，必须评判「调用者正在编辑的那棵树」；实测 `mainCheckoutRoot(plugin/scripts)` =
`/data/home/yale/work/quay`（主检出），而 `repoRoot(plugin/scripts)` = 本 worktree 根。照抄会让 worktree 里的一次
运行静默改读主检出的源码，把本工作树的改动静默判成「不存在」——正是硬规则 4b 那一族（代理量偏离实际、且与
「一切正常」同形）。第四处是**报告生成器**（读历史产报告），要的恰是主检出。两者的正确取值本就不同。

**划界（本条不声称什么）**：本条只消除 finding 点名的这 3 处。同一内联形态在 `plugin/scripts` 其余 **12 个文件、
12 处**仍然存在（`ac61-staleness-disposition-check.ts:271`、`dispatch-preference-check.ts:120`、
`arch-discovery-routine.ts:80`、`cross-project-dogfood-routine.ts:750`、`dispatch-record.ts:116` …，共 12 处，
`grep -rn 'path.dirname(fileURLToPath(import.meta.url)), "..", ".."' plugin/scripts/*.ts | wc -l` = 12）。
本条**不动**它们：那是同一轮探针另外立案、却被 `routine-file-gate` 的 rate 闸按
「rate: 3 routine-filed tasks this window ≥ cap 3」**拒收**的两条更宽 finding（`repo-root-walkup-replicated`、
`repo-root-derivation-check-blind-to-inline-form`）的范围。
另记一条本轮复核的旁证：现存的 `repo-root-derivation-check` 之所以对这 12 处零命中，是因为它的判据要求第一实参
是【本文件已声明的脚本目录常量】（标识符），而内联形态的第一实参是表达式 —— 这个盲区就是被拒的那条
`repo-root-derivation-check-blind-to-inline-form`，本条不改棘轮。

**验证读数**：scoped gate `bash scripts/test.sh --for-task gap-routine-semantic-dedup-scan-defaultroot-byte-identical-quad --allow-thin` **exit 0**（静态层全绿：`checker-count-drift-check` / `repo-root-derivation-check` / `import-graph-check` valueSccs=typeSccs=reverseEdges=0 / `sh-census-check` 6566≤6566、0≤0 / suite-slot-ssot / concurrency-literal 均 PASS）；
`anti-drift-touches-check --merge-target develop` **OK —— 3 个实际改动文件全在声明的 Touches 内（5 glob）**。
实现提交：`4e3f2962c`（分支 `task/gap-routine-semantic-dedup-scan-defaultroot-byte-identical-quad`）。

## AC
- [x] `.quay/routine-findings.jsonl` 中 finding `defaultroot-byte-identical-quad`（routine `semantic-dedup-scan`，runId `semantic-dedup-scan-1792033478766`）所描述的问题被复核并处置
- [x] 处置结论可核：要么修掉，要么写明「已有机制在管、失败在哪一步」，⛔ 不以「已注意到」结案

## DoD
- [x] 上面的判据实跑通过
- [x] ⛔ 探针只立案不执行：本任务若需要跑产出者/修复，由派发链执行，⛔ 不由例程代跑

## Touches
- `plugin/scripts/checker-count-drift-check.ts`
- `plugin/scripts/import-graph-check.ts`
- `plugin/scripts/sh-census-check.ts`
- `plugin/scripts/task-granularity-advice.ts`
- `tasks/gap-routine-semantic-dedup-scan-defaultroot-byte-identical-quad.md`