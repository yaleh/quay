---
id: gap-routine-architecture-analysis-god-package-plugin-scripts-cef0939f
title: "architecture-analysis: plugin/scripts holds 317 files / 4777 entities
  (77.7% of repo's 6144) in a flat 2-subdir directory, fanOut=3622"
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
plugin/scripts holds 317 files / 4777 entities (77.7% of repo's 6144) in a flat 2-subdir directory, fanOut=3622

载体记录（逐字来源）：`.quay/routine-findings.jsonl` · routine `architecture-analysis` · probe `architecture-analysis` · runId `architecture-analysis-1793622670475` · ts `2026-11-02T12:31:10.475Z`。

该 finding 由例程的机械通道产出，本任务由**同一条通道**依赖 `plugin/scripts/routine-file-gate.ts` 的三道闸
（quality / dedup / rate）机械立案 —— ⛔ 不是由人转抄，也不是由探针自行执行。

- 观测符号：`runResidentLoop`、`runOpenSemanticDiscovery`、`withPerFileCpuPreload`
- 涉及文件：
- `plugin/scripts/worker-driver.ts:5822`
- `plugin/scripts/open-semantic-discovery-routine.ts:3816`
- `plugin/scripts/full-suite-runner.ts:239`
- kind：`god-package`
- verdict：`CONFIRMED`

## Requested action
Split plugin/scripts into thematic subdirs (drivers/, probes/, readers/, gates/) by responsibility

## Effect Prediction
- metric: concept_recurs_after_merge
- expected: false
- statement: 修复后 `<none>` 不再以同一 subject 复发（同 concept_key 的后续记录数应为 0）
- recorded_at: 2026-11-02T12:31:10.475Z

## Disposition

复核时间 2026-11-02，worktree `gap-routine-architecture-analysis-god-package-plugin-scripts-cef0939f` @ develop `b1a32ee1f`。

### 1. 读数复核：逐字命中，一处 7 行漂移已定位

| 量 | finding | 本次实测 | 命令 |
|---|---|---|---|
| top-level `.ts` 数 | 317 files | **317** | `git ls-files 'plugin/scripts/*.ts' \| wc -l` |
| entityCount / fanOut / fanIn | 4777 / 3622 / — | **4777 / 3622 / 0** | `.archguard/metrics-history.jsonl` `plugin/scripts` 行 @ 2026-11-02T12:31:53.549Z |
| 77.7% | 4777/6144 | 0.7775… | 同轮 scope `inventory.plugin/scripts=4777`，总实体 6144 |
| runOpenSemanticDiscovery 定义行 | :3816 | **:3816** | `grep -n 'export async function runOpenSemanticDiscovery' plugin/scripts/open-semantic-discovery-routine.ts` |
| withPerFileCpuPreload 定义行 | :239 | **:239** | `grep -n 'export function withPerFileCpuPreload' plugin/scripts/full-suite-runner.ts` |
| runResidentLoop 定义行 | :5822 | **:5829**（+7） | `grep -n 'export async function runResidentLoop' plugin/scripts/worker-driver.ts` |

`runResidentLoop` 的 7 行漂移已定位：finding 立案后 `9b785a5cb docs(worker-driver): record god-module
disposition pointer at runResidentLoop` 在函数上方插入 7 行 disposition 指针注释（worker-driver 7149→7156 行）。
finding 立案时刻 :5822 属实，非误报。

「flat 2-subdir」是探针 LLM 的措辞；可核实读数是 **1 个 tracked 子目录**（`checker-mutation-cases/`，
93 个 fixture）+ **317 个 top-level `.ts`**，无 drivers/probes/readers/gates 任何一层（
`git ls-files 'plugin/scripts/' | sed 's#^plugin/scripts/##' | grep / | cut -d/ -f1 | sort -u` = 仅
`checker-mutation-cases`）。结构本质（扁平、无主题子目录）成立。

### 2. 复发诊断：同一根 god-package 的第三次立案；dedup 键仍不收敛

- 前两轮 disposition：`gap-routine-architecture-analysis-plugin-scripts-flat-god-directory`
  （status: done，2026-10-22，runId `architecture-analysis-1792599464308`）、
  `gap-routine-architecture-analysis-god-package-plugin-scripts`（status: done，2026-10-31，
  runId `architecture-analysis-1793401956536`）。本 finding 是**第三轮**。
- 三轮观测符号集（`routine-file-gate.ts` 的 dedup subject 键 = 精确符号集，`findingSubjectKey` :84-92）：
  - 10-22：`resolveworkerprocessname,runautotightenpass,isfinalstate,readjsonlines,readjsonllines`
  - 10-30：`withperfilecpupreload,isstaticcheckfailureline,extractstaticcheckdetail`
  - 11-02：`runopensemanticdiscovery,runresidentloop,withperfilecpupreload`（本轮 `dedup_state.state=novel`）
  - 三轮两两无整集相等 ⇒ **同一包跨轮不被 dedup、只被 rate 兜底**。
- 本轮新成员：`runOpenSemanticDiscovery`（`open-semantic-discovery-routine.ts`，5668 行 megascript，
  定义行 :3816）替代了上轮的 `isStaticCheckFailureLine`/`extractStaticCheckDetail` —— 符号漂移的活样本。
- 跨包同根：sibling `gap-routine-architecture-analysis-god-package-quay-src-root`（done）同样记「第三次立案」，
  `god-package-core`（done）同样点名 dedup 键缺陷 ⇒ 不是本包独有，是 `routine-file-gate.ts` 的 kind 级缺口。

### 3. 已有机制在管哪一部分、失败在哪一步（AC2 的答案）

| 机制 | 管什么 | 失败在哪一步 |
|---|---|---|
| `routine-file-gate.ts` dedup 闸（:60-68 已声明边界） | 防同 subject 重复立案 | subject 键 = **精确符号集相等**；god-package 符号每轮随 archguard 采样漂移 ⇒ 不 dedup、退化 rate 兜底（:66-67 自认残余） |
| `import-graph-check.ts` | value/type SCC、层间越界、kernel/gate-layer 边界 | 无 domain 维度；无环扁平命名空间按定义 PASS（本轮 `valueSccs=[] typeSccs=[] reverseEdges=[]`，kernelChecked/gateLayerChecked 均 true） |
| `archguard-runner.ts` | 每次 analyze 记 entityCount/fanOut/fanIn | 只记录不判定（:20-21 留待数据积累）；`.archguard/` gitignored，不成棘轮 |
| 前序 disposition（flat-god-directory / god-package-plugin-scripts / god-package-quay-src-root / god-package-core） | 已点名增量①「`routine-file-gate.ts` 对 `dupKind: god-package` 用包身份做 dedup 键」 | **从未被立为任务**：`ls tasks/ | grep -i 'routine-file-gate.*dedup'` = 0，增量在 prose 里丢失 ⇒ 复发持续 |

**失败在哪一步（一句话）**：dedup 键是精确符号集，god-package 的符号集每轮漂移，因此同一根包跨轮
不被 dedup；而 4 个 sibling disposition 点名要修的「包身份 dedup 键」从未被立成任务 ⇒ 缺口跨轮存活。

### 4. 处置结论

- 复核结论：finding **成立且未过期**；本任务**不修布局**——承重约束与前序
  `gap-routine-architecture-analysis-plugin-scripts-flat-god-directory` §4 相同（`build-plugin-dist.mjs`
  入口发现、`driver-runtime.ts` resolveKernelSibling、`select-static-checks-for-touches.ts` top-level
  glob、`experiments/quay-perpetual-stream/scripts/` 61 个符号链接），任何单 domain 移动会打断四条链，
  是「先让四条链支持子目录、再逐个迁移」的多任务程序，非本 finding Touches 能承载的单次移动。
- 本任务也不改 `routine-file-gate.ts` 的 dedup 键（那是 filing 机制的修复，不属于本 finding 的
  Touches 面）。
- **本任务的实际处置 = 把 4 个 sibling 已点名、却从未立案的增量① 立成任务**：
  `gap-routine-file-gate-god-package-dedup-by-package-identity`（status: todo，本工作树已通过
  `task create` 立案）。这是把「下一个增量」从 prose 变成 pool 项——⛔ 不是第五次「已注意到」。
- 增量②（domain 声明表 + 只判「top-level 文件是否属于某已声明 domain」的检查器，零文件移动）
  仍留给该 dedup 任务之后的后续程序任务，顺序不可交换（先让复发可被 dedup 收敛，再降扁平度读数）。

### 5. 复核命令（可重跑）

```bash
git ls-files 'plugin/scripts/*.ts' | wc -l                                # 317
wc -l plugin/scripts/worker-driver.ts plugin/scripts/open-semantic-discovery-routine.ts plugin/scripts/full-suite-runner.ts
grep -n 'export async function runOpenSemanticDiscovery' plugin/scripts/open-semantic-discovery-routine.ts
node --experimental-strip-types plugin/scripts/import-graph-check.ts --json   # 0/0/0, kernelChecked=true
ls tasks/ | grep -i 'routine-file-gate.*dedup'                          # 期望 1（本任务立案的增量）
```

### 6. 读数（ADR-007）
- L_D import-graph-check: valueSccs=0 typeSccs=0 reverseEdges=0 files=555 edges=1711
- L_G archguard: entityCount=4777 fanOut=3622 fanIn=0 plugin_scripts_top_level_ts=317
- L_G import-graph-check: valueSccs=0 typeSccs=0 reverseEdges=0

## AC
- [x] `.quay/routine-findings.jsonl` 中 finding `god-package-plugin-scripts`（routine `architecture-analysis`，runId `architecture-analysis-1793622670475`）所描述的问题被复核并处置
- [x] 处置结论可核：要么修掉，要么写明「已有机制在管、失败在哪一步」，⛔ 不以「已注意到」结案

## DoD
- [x] 上面的判据实跑通过
- [x] ⛔ 探针只立案不执行：本任务若需要跑产出者/修复，由派发链执行，⛔ 不由例程代跑

## Touches
- `plugin/scripts/worker-driver.ts`
- `plugin/scripts/open-semantic-discovery-routine.ts`
- `plugin/scripts/full-suite-runner.ts`
- `tasks/gap-routine-file-gate-god-package-dedup-by-package-identity.md`
- `tasks/gap-routine-architecture-analysis-god-package-plugin-scripts-cef0939f.md`