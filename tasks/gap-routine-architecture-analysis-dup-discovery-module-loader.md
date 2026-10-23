---
id: gap-routine-architecture-analysis-dup-discovery-module-loader
title: "architecture-analysis: archguard dup hash d5a5945972ad7036 (177 tokens /
  17 lines): the `load` arrow that resolves an engine module, memoizes into
  _engineModuleCache, imports via p"
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
archguard dup hash d5a5945972ad7036 (177 tokens / 17 lines): the `load` arrow that resolves an engine module, memoizes into _engineModuleCache, imports via pathToFileURL and pushes an `unresolved` message is byte-identical in the two sibling routine files (2,241 and 5,682 lines), so the unresolved-reason wording and cache semantics must be edited twice.

载体记录（逐字来源）：`.quay/routine-findings.jsonl` · routine `architecture-analysis` · probe `architecture-analysis` · runId `architecture-analysis-1792752934532` · ts `2026-10-23T10:55:34.532Z`。

该 finding 由例程的机械通道产出，本任务由**同一条通道**依赖 `plugin/scripts/routine-file-gate.ts` 的三道闸
（quality / dedup / rate）机械立案 —— ⛔ 不是由人转抄，也不是由探针自行执行。

- 观测符号：`load`、`loadDiscoveryModules`、`loadOpenDiscoveryModules`、`resolveEngineModule`、`_engineModuleCache`
- 涉及文件：
- `plugin/scripts/discovery-method-routine.ts:1187`
- `plugin/scripts/open-semantic-discovery-routine.ts:1950`
- kind：`duplication`
- verdict：`confirmed`

## Requested action
Extract one `makeEngineModuleLoader(root, cache, unresolved[])` into a shared routine lib and have both loaders call it.

## Effect Prediction
- metric: concept_recurs_after_merge
- expected: false
- statement: 修复后 `<none>` 不再以同一 subject 复发（同 concept_key 的后续记录数应为 0）
- recorded_at: 2026-10-23T10:55:34.532Z

## Resolution
处置：**修掉**（提取到共享 routine lib），⛔ 不是「已有机制在管」。

- 新的唯一正本：`plugin/scripts/routine-engine-module-loader.ts`
  - `resolveEngineModuleIn(root, file, dirRel)` —— 两候选解析（脚本自身仓库根优先、被观察 workspace 次之），
    未命中时把**两个**候选路径都返回，供拒绝理由点名。
  - `importEngineModuleAt(absPath, cache)` —— 运行时 `import()`（`/* @vite-ignore */ pathToFileURL(...)`），
    按**已解析路径**记忆化。
  - `makeEngineModuleLoader(root, cache, unresolved, dirRel)` —— finding 请求的那个累积式 loader：
    每个解析/导入失败只往 `unresolved[]` 推**一条具名理由**，自身从不抛。
  - `SCRIPT_REPO_ROOT` —— 该表达式（`dirname(import.meta.url)/../..`）此前在四个文件里各算一次。
- 两个被 finding 点名的消费者降为一行委托，各自只保留**自己的**模块文件清单、自己的缓存 map 与自己的拒绝前缀：
  - `discovery-method-routine.ts` `loadDiscoveryModules` → `makeEngineModuleLoader(...)`；
    `resolveEngineModule` → `resolveEngineModuleIn(...)`
  - `open-semantic-discovery-routine.ts` `loadOpenDiscoveryModules` → `makeEngineModuleLoader(...)`；
    `resolveEngineModule` → `resolveEngineModuleIn(...)`；`loadStreamDiagnostics` 的导入段 → `importEngineModuleAt(...)`

### 硬规则 5b（同一载体内的兄弟实例：grep 计数与前 3 条）
对 `plugin/scripts/*.ts` 按「两候选解析循环」与「引擎模块运行时导入」两个谓词各 grep 一次：

- `git grep -lF 'for (const candidate of tried)' develop -- 'plugin/scripts/*.ts'` ⇒ **4 个文件**（前 3 条：
  `arch-discovery-routine.ts`、`cross-project-dogfood-routine.ts`、`discovery-method-routine.ts`，
  第 4 条 `open-semantic-discovery-routine.ts`）。**修复后 1 处**，且是 `routine-engine-module-loader.ts`。
- 引擎模块运行时导入 `import(/* @vite-ignore */ pathToFileURL(...))`：**修复前 4 处 → 修复后 0 处（例程侧）/ 1 处（共享 lib）**。
- 因此另外两个兄弟实例也一并归并，而不是只修被报出来的那一对：
  - `arch-discovery-routine.ts` 的 `resolveInstrument` ⇒ `resolveEngineModuleIn`（同一两候选顺序：
    脚本根优先、workspace 次之）。`SCRIPT_PLUGIN_ROOT` 改为从共享 lib 重导出（该文件历史拼写保持不变）。
  - `cross-project-dogfood-routine.ts` 的 `loadEngineModule` ⇒ `resolveEngineModuleIn` + `importEngineModuleAt`；
    它**自己的**拒绝形态（单个抛出 `CROSS_PROJECT_ENGINE_UNRESOLVED`，而不是累积 `unresolved[]`）保留在原处。

**明确不并入的两处**（不是同一谓词，理由可核，⛔ 不静默丢弃）：
- `resource-anomaly-detector.ts` 的 `resolveConceptKeyOf`：候选顺序**相反**（workspace 优先、脚本根其次，
  因为它要读的是「已 land 的 ledger」），且自带独立错误契约 —— 并入会**静默改变它的解析优先级**。
- `discovery-closed-loop-report.ts` 的 `loadEngineModules`：**已经**经 OSD 的 `resolveEngineModule` 委托到本 lib，
  只剩导入一行；它的失败要降级成报告里的 `not-evaluated:` 而不是抛/累积，且按报告每次重新导入是刻意的。

### 静态控制随代码走
`plugin/test/discovery-method-routine.test.mjs`（case 8 侧）与
`plugin/test/open-semantic-discovery-routine.test.mjs`（case i 侧）各有一条「必须用已解析路径 import」的
源码文本控制。它们原先钉在各自例程的源码上，提取后该文本只剩于共享 lib ⇒ 这两条断言改为读
`routine-engine-module-loader.ts`；「不得静态 import `docs/analysis`」那一半**仍判定各自例程的源码**。
控制本身没有变弱：谓词、它的非零 mutation 对照都原样保留，只是跟随到了唯一实现处。

### 能力目录（QUESTION / CADENCE / INVALIDATION / LAST_REAFFIRMED / MATCHING **+ CONSUMER**）
新增 `plugin/scripts/*.ts` 必须带声明（`capability-catalog.sh` 的 AC1c：未声明即红）。
`plugin/scripts/capability-catalog-declarations.json` 的 QUESTION / CADENCE / INVALIDATION / LAST_REAFFIRMED / MATCHING
五表各补一行；实跑 `bash plugin/scripts/capability-catalog.sh --summary` ⇒ `398 scripts | 398 declared | 0 unclassified`。

**第六张表 CONSUMER —— 上一轮遗漏，正是那次 suite 红的真因（本轮补上）**：本文件 cadence 声明为 `按需`，
而 `rhythm-consumer-check` 判据2 要求「按需」机制必须有一行 CONSUMER 说明**谁按、在什么条件下按**，
否则「按需」=「无人」⇒ RED。缺这一行 ⇒ `STATIC_CHECK_FAILED: rhythm-consumer-check exit=1` ⇒ 整套 suite 判红
（上一轮 `exited-not-landed` 的 `step=suite ... incomplete` 是它的下游表现，不是 suite 基础设施故障）。
补上后的实测读数：`node --experimental-strip-types plugin/scripts/rhythm-consumer-check.ts --check` ⇒
判据1 238 judged / 0 violation · 判据2 155 judged / 0 violation · 判据3 5 judged / 0 violation，**exit 0**。

## Effect Prediction 复核
`concept_recurs_after_merge` 的终局判据是下一次 archguard 读数里同一 concept 不再复发；本轮能取到的直接量是
**实现处计数**：两候选解析循环 4 文件 → 1；引擎模块运行时导入 4 处 → 1。同一段拒绝措辞与缓存语义此后只有一处可编辑。

## AC
- [x] `.quay/routine-findings.jsonl` 中 finding `dup-discovery-module-loader`（routine `architecture-analysis`，runId `architecture-analysis-1792752934532`）所描述的问题被复核并处置
  - 复核：读该 runId 的 finding 记录（`findingId":"dup-discovery-module-loader"`、`verdict":"confirmed"`、
    `files` 指向两例程文件的 `load` 箭头），并在 develop 上确认两处 body 逐字相同。
  - 处置：见 `## Resolution` —— 提取 `routine-engine-module-loader.ts`，四个副本全部委托（两个被点名的 + 两个兄弟实例）。
- [x] 处置结论可核：要么修掉，要么写明「已有机制在管、失败在哪一步」，⛔ 不以「已注意到」结案
  - 结论 = **修掉**。可核读数：两候选解析循环 **4 文件 → 1 处**；引擎模块运行时导入 **4 处 → 1 处**；
    相关测试 59 + 132 + 55 + 25 实跑全绿；`import-graph-check` 实跑 `evaluated:true` / `ok:true`。

## DoD
- [x] 上面的判据实跑通过
  - `node --experimental-strip-types --test plugin/test/discovery-method-routine.test.mjs` ⇒ 59 pass / 0 fail
  - `node --experimental-strip-types --test plugin/test/open-semantic-discovery-routine.test.mjs` ⇒ 132 pass / 0 fail
  - `node --experimental-strip-types --test plugin/test/arch-discovery-routine.test.mjs plugin/test/cross-project-dogfood-routine.test.mjs` ⇒ 55 pass / 0 fail
  - `node --experimental-strip-types --test plugin/test/discovery-closed-loop-report.test.mjs` ⇒ 25 pass / 0 fail
  - 五个相关测试文件一次并跑（本轮 2026-10-23 复跑）⇒ tests 271 / pass 271 / fail 0
  - `bash plugin/scripts/capability-catalog.sh --summary` ⇒ 398 scripts | 398 declared | 0 unclassified
  - `node --experimental-strip-types plugin/scripts/rhythm-consumer-check.ts --check` ⇒ 判据1/2/3 全 ok，exit 0
  - `node --experimental-strip-types plugin/scripts/import-graph-check.ts . --json` ⇒ valueSccs=0 · typeSccs=0 · reverseEdges=0
- [x] ⛔ 探针只立案不执行：本任务若需要跑产出者/修复，由派发链执行，⛔ 不由例程代跑
  - 实现与验证均由派发链的 worker 会话在其任务 worktree 内执行；例程只产出 finding 与立案。

## ADR-007 暗轴记录
- L_D 依赖结构（`import-graph-check` 本 worktree 实测，2026-10-23）：valueSccs=0 · typeSccs=0 · reverseEdges=0 · files=507 · edges=1516（value=1379 / type=137）
- L_G: 该轴仍暗,理由: 本次仅为 plugin/scripts 内的引擎模块加载器归并，未运行 archguard god-package/重复度读数，不据此下结论

## Touches
- `plugin/scripts/routine-engine-module-loader.ts`
- `plugin/scripts/discovery-method-routine.ts`
- `plugin/scripts/open-semantic-discovery-routine.ts`
- `plugin/scripts/arch-discovery-routine.ts`
- `plugin/scripts/cross-project-dogfood-routine.ts`
- `plugin/scripts/capability-catalog-declarations.json`
- `plugin/test/discovery-method-routine.test.mjs`
- `plugin/test/open-semantic-discovery-routine.test.mjs`
- `tasks/gap-routine-architecture-analysis-dup-discovery-module-loader.md`

## Blocker

**2026-10-23T12:09:40.691Z — worker 未落地（exited-not-landed）**

- 未落地原因：step=suite: incomplete suite (615/615 files) — recovery exhausted at floor concurrency 32 — no declared rung produced a complete verdict (64,48,32); needs a code/config fix, see plugin/scripts/full-suite-runner.ts
- run_id：wk-prod-anchor
- session_id：82bb17ff-f221-4439-ab3b-cbaaee5de17d
- 真因（本轮查明并修复，非 suite 基础设施）：`rhythm-consumer-check` 判据2 RED —— 新文件声明为「按需」却缺 CONSUMER 行 ⇒ 静态门红 ⇒ suite 判红；已补 CONSUMER 行，`rhythm-consumer-check --check` 实测 exit 0。
