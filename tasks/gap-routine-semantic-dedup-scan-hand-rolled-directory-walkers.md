---
id: gap-routine-semantic-dedup-scan-hand-rolled-directory-walkers
title: "semantic-dedup-scan: Twelve hand-rolled readdirSync walkers; none
  imports fs-walk.ts walkFiles although the traversal skeleton is the same."
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
Twelve hand-rolled readdirSync walkers; none imports fs-walk.ts walkFiles although the traversal skeleton is the same.

载体记录（逐字来源）：`.quay/routine-findings.jsonl` · routine `semantic-dedup-scan` · probe `semantic-dedup-scan` · runId `semantic-dedup-scan-1794127147981` · ts `2026-11-08T08:39:07.981Z`。

该 finding 由例程的机械通道产出，本任务由**同一条通道**依赖 `plugin/scripts/routine-file-gate.ts` 的三道闸
（quality / dedup / rate）机械立案 —— ⛔ 不是由人转抄，也不是由探针自行执行。

- 观测符号：`walk`、`walkFiles`
- 涉及文件：
- `plugin/scripts/fs-walk.ts:187`
- `plugin/scripts/capability-catalog.ts:225`
- `plugin/scripts/crystallization-half-life.ts:338`
- `plugin/scripts/driver-runtime.ts:2057`
- `plugin/scripts/fan-in-materialize-check.ts:340`
- `plugin/scripts/freshness-producer-coverage-check.ts:589`
- `plugin/scripts/profiles-role-coverage-check.ts:183`
- `plugin/scripts/task-file-bypass-check.ts:217`
- kind：`same-symbol-multi-file`
- verdict：`real-duplication`

## Requested action
merge onto fs-walk.ts with per-caller skip/depth options

## Effect Prediction
- metric: concept_recurs_after_merge
- expected: false
- statement: 修复后 `<none>` 不再以同一 subject 复发（同 concept_key 的后续记录数应为 0）
- recorded_at: 2026-11-08T08:39:07.981Z

## AC
- [x] `.quay/routine-findings.jsonl` 中 finding `hand-rolled-directory-walkers`（routine `semantic-dedup-scan`，runId `semantic-dedup-scan-1794127147981`）所描述的问题被复核并处置
- [x] 处置结论可核：要么修掉，要么写明「已有机制在管、失败在哪一步」，⛔ 不以「已注意到」结案

## DoD
- [x] 上面的判据实跑通过
- [x] ⛔ 探针只立案不执行：本任务若需要跑产出者/修复，由派发链执行，⛔ 不由例程代跑

## Disposition

复核按**逐个核到源码**做的（不是按关键词）：finding 列出的 8 个 `file:line` 里，`fs-walk.ts:187` 是
**正本自身的 `WalkOptions`/`walkFiles` 定义处**，不是重复；其余 7 处才是真正的 hand-rolled walker。
（`rationale` 说"Twelve"，但载体记录只列出这 8 条 —— 数字无法从记录复现，故本任务只处置**被点名的** 7 处，
不做全域 sweep，见文末"范围外观察"。）

| 站点 | 处置 | 留在原文件里的策略（**未**被"统一"掉，逐条与旧实现同义） |
|---|---|---|
| `capability-catalog.ts#deriveScripts` | 已并入 `walkFiles`（`capability-catalog.ts:237`） | dirent + `entry.isFile()`（符号链接从来不算脚本）；仅剪目录，按 basename 复用 `isExcludedDirRelPath`（其正则按段锚定 `(^|/)archive/` ⇒ 逐层按 basename 判定与按 rel 路径判定等价）；返回 basename 键 |
| `crystallization-half-life.ts#buildRepoIndex` | 已并入（`:346`） | name-only prune（与 skip 集**同名**的普通文件也丢，旧实现先判名再判目录）；`sort:false` —— `stems` 按遍历序构建，**顺序是契约** |
| `fan-in-materialize-check.ts#findMaterializedWorkflowFiles` | 已并入（`:346`） | `node_modules` 仅按目录剪；`wf_*.json` 判定**无** `isFile()` 守卫（旧实现的 `else` 分支会把符号链接计入，保留） |
| `freshness-producer-coverage-check.ts#listSourceFiles` | 已并入（`:599`） | 符号链接先丢（`entry.isFile()` + dirent 下"目录链接不是目录" ⇒ 既不下钻也不记录，与旧 `isSymbolicLink()` 前置 `continue` 同结果）；hidden/skip 仅剪目录；结果**不排序**（旧实现返回遍历序） |
| `profiles-role-coverage-check.ts#driverSources` | 已并入（`:189`） | `CORPUS_EXCLUDES` 仅剪目录；`entry.isFile()` 保持符号链接不入 |
| `task-file-bypass-check.ts#scanSurface` | 已并入（`:240`） | dirent（指向目录的符号链接不下钻，旧 `isDirectory()` 对它为假）；prune 仅目录；扩展名判定**无** `isFile()` 守卫（收窄会静默缩小 gate 的语料 ⇒ 硬规则 3b） |
| `driver-runtime.ts#listSharedHostScopes` | **留在原地**，理由具名写在 `driver-runtime.ts:2069` 的 walker 上 | 它枚举的是**目录**（`.scope` 单元），且要**按目录上报读失败**（`unreadableDirs`/`rootError` 带 errno 文本）。`walkFiles` 只产出非目录项，且按设计**吞掉** readdir 失败 —— 把后者交给会吞失败的遍历，正是硬规则 3b 的形态：读不到会与"读到了、一个都没有"同形 ⇒ `count: 0`。要上收必须先给 `walkFiles` 加【目录项 + 按目录回报失败】通道，那是给一个调用方加的第二套协议，不是共享骨架。⛔ 不要在没加通道前"补完 sweep" |

**等价性是测出来的，不是声称的。** 差分对照（旧实现 = 主检出 f4efd0f47 的原始 body；新实现 = 本 worktree；
**两侧跑同一个 root**）在真实仓库树 + 一棵刻意构造的树（文件符号链接 / 悬空链接 / 目录链接、隐藏目录、
与 skip 集**同名**的文件、嵌套 `archive/`、大写扩展名）以及**不存在的 root** 上跑同一批输入 ⇒
**25 组比较逐字节相同**；`profiles-role-coverage-check` 的 JSON 报告（`driverSources` 是私有函数，
无法直接对比）两侧 `corpusFiles=321` 且除随机临时目录名外逐字节相同。

**机械读数**（位置判定；注释/字符串已用 `source-text-lib.codeOnlyText` 屏蔽，谓词先对已知为真的样本试跑过）：

- `plugin/scripts/*.ts` 里 `readdirSync(` 调用点：164 → **158**（−6，恰为并入的 6 个 walker）
- `import { walkFiles } from "./fs-walk.ts"` 的文件数：5 → **11**（文件名清单见提交说明；+6 恰为这 6 个）
- 逐文件计数变化可复核：`capability-catalog 3→2`、`crystallization-half-life 2→1`、其余四个各 `1→0`（无反向变化）

**范围外观察（⛔ 本任务未处置）**：`plugin/scripts` 其它模块仍有递归 walker（本 finding 的 `files` 列表
未点名，且不在本任务 `## Touches` 内）；若要全域收口，需另立 finding —— 本任务只交付被点名集合的处置。

L_D import-graph-check: files=609 edges=1854 valueSccs=0 typeSccs=0 reverseEdges=0 kernelViolations=0（本任务新增 6 条指向 `fs-walk.ts` 的边：无环、无反向边、无内核层违规）

## Evidence

### 2026-11-08 · suite-red 真因与修复（第 2 轮落地）

上一轮 exited-not-landed 记录的原因写的是 `step=suite: incomplete suite (647/647 files) — recovery exhausted at floor concurrency 16`。
逐字读那次的 suite log（`.quay/fan-in-suite-gap-routine-semantic-dedup-scan-hand-rolled-directory-walkers~wk-prod-anchor~1794128335237-227877.log`），
`planned=647 terminal=0 missing=647` 的真因是**一个测试都没跑**：前置静态闸先红了，suite 根本没开始。

```
STATIC_CHECK_FAILED: checker-mutation-check-changed exit=1
STATIC_CHECK_FAILED: checker-mutation-check exit=1
# suite red static-check
```

两个红**各有真因**（不是同一个），且都由本轮的 `capability-catalog.ts` 改动触发：

1. `--check-changed` → `capability-catalog: always-red`。`checker-mutation-cases/capability-catalog.sh`
   把 catalog 的 entry + 声明数据 **cp 进合成 fixture 树**再跑；本轮 `deriveScripts` 改走 `fs-walk.ts#walkFiles` 之后，
   fixture 里没有 `fs-walk.ts` ⇒ `ERR_MODULE_NOT_FOUND` ⇒ 连 baseline 都红，案例报「checker always-red?」。
   **红的是 fixture 的依赖清单，不是 checker 的行为。**
2. `--check` → `rhythm-consumer-check: stayed-green`。同一根因的另一面：该案例**也**把 catalog entry cp 进 fixture，
   缺 `fs-walk.ts` ⇒ `--json` 零行 ⇒ 判据1 的判定集为空 ⇒ 注入的未接线机制**没被判定**，报「stayed-green」。
   这是更危险的一半：它把一个**坏掉的 fixture** 伪装成「checker 抓不到缺陷」（硬规则 3b 的同形失败）。

**修复**（不是把两处 `cp` 补成三行）：两个 fixture 各加一个 `copy_local_imports`，从 entry 自身的
`^\s*import … "./x.ts"` 相对说明符**递归取传递闭包**，缺谁补谁。手写依赖清单正是同一缺陷的下一层
（此前已为 `repo-root.ts` 手写一行，这次换成 `fs-walk.ts` 就断）。⛔ 不抽成共享 lib 是有意的：
`plugin/scripts/` 下新文件需要自己的 capability-catalog 声明，而 `checker-mutation-cases/` 被 catalog 的
`SKIPPED_SEGMENTS` 跳过 ⇒ 两处各留一份，注释里写明理由。

**实跑读数**（本 worktree，修复前 → 修复后）：

- `bash plugin/scripts/checker-mutation-check.sh --check`：`stayed_green=1, always_red=1` → `RESULT: PASS`，
  `checkers_total: 88 / checkers_with_mutation: 88 / mutations_that_stayed_green: 0 / uncovered: 0 / errors: 0 / not_evaluated: 0`
- `node … checker-mutation-check.ts --check-changed --repo-root <worktree>`：`capability-catalog = always-red` → `RESULT: PASS`（5/5 本 delta 的 checker carrier）
- 两个案例单独跑（`bash plugin/scripts/checker-mutation-cases/{capability-catalog,rhythm-consumer-check}.sh <tmpdir>`）⇒ `exit 0`，
  且 fixture 目录里可见 `plugin/scripts/fs-walk.ts` —— 传递闭包**真的生效**，不是靠猜

**给下一轮的读数教训**：`planned=N terminal=0 missing=N` 的 suite log **必须先看静态闸段**，它意味着
「一个测试都没跑」而不是「suite 跑到一半丢了」。把它记成「recovery 耗尽」会把一个**确定性**的静态红
误判成**负载抖动**，于是 recovery 每一档都注定复现同一个红。

## Touches
- `plugin/scripts/fs-walk.ts`
- `plugin/scripts/capability-catalog.ts`
- `plugin/scripts/crystallization-half-life.ts`
- `plugin/scripts/driver-runtime.ts`
- `plugin/scripts/fan-in-materialize-check.ts`
- `plugin/scripts/freshness-producer-coverage-check.ts`
- `plugin/scripts/profiles-role-coverage-check.ts`
- `plugin/scripts/task-file-bypass-check.ts`
- `plugin/scripts/checker-mutation-cases/capability-catalog.sh`
- `plugin/scripts/checker-mutation-cases/rhythm-consumer-check.sh`
- `tasks/gap-routine-semantic-dedup-scan-hand-rolled-directory-walkers.md`

## Blocker

**2026-11-08T09:42:37.647Z — worker 未落地（exited-not-landed）**

- 未落地原因：step=suite: oom-killed (2) — recovery red set is NOT a subset of the develop baseline red set: added=plugin/test/freshness-distance-counting.test.mjs,plugin/test/freshness-distance-counting.test.mjs changed=- — needs a code fix
- run_id：wk-prod-anchor
