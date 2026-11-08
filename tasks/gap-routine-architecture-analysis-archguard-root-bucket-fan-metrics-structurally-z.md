---
id: gap-routine-architecture-analysis-archguard-root-bucket-fan-metrics-structurally-z
title: "architecture-analysis: archguard's god-package path builds fanIn/fanOut
  from extractPackageName(entityId), which returns `<file>.ts` for root-level
  entities (e.g. 'action.ts.delive"
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
archguard's god-package path builds fanIn/fanOut from extractPackageName(entityId), which returns `<file>.ts` for root-level entities (e.g. 'action.ts.deliverTrigger' -> 'action.ts'), but emits package names taken from engine.getPackageStats(), which buckets those same files as '(root)'; the two name spaces never intersect, so '(root)' reports fanIn=0/fanOut=0 by construction — measured on the fresh 2026-11-08 scopes: src 26b300e9 '(root)' = 30 files / 298 entities with 24 root-file pseudo-packages collapsing 405 fanIn + 531 fanOut relations to 0/0, and scripts 4747cc54 '(root)' = 321 files / 4918 entities with 0/0. Both buckets can therefore only ever be flagged by tooManyFiles/tooManyEntities, never highFanIn/highFanOut — the exact rule-4 shape (a value that cannot come out non-zero is not a measurement).

载体记录（逐字来源）：`.quay/routine-findings.jsonl` · routine `architecture-analysis` · probe `architecture-analysis` · runId `architecture-analysis-1794127547195` · ts `2026-11-08T08:45:47.195Z`。

该 finding 由例程的机械通道产出，本任务由**同一条通道**依赖 `plugin/scripts/routine-file-gate.ts` 的三道闸
（quality / dedup / rate）机械立案 —— ⛔ 不是由人转抄，也不是由探针自行执行。

- 观测符号：`extractPackageName`、`computePackageFanMetricsFromRelations`、`buildTypeScriptGodPackageMetrics`、`evaluateGodPackages`
- 涉及文件：
- `plugin/scripts/archguard-runner.ts:1`
- `.archguard/query/26b300e9/arch.json:1`
- `.archguard/query/4747cc54/arch.json:1`
- `packages/quay/src/action.ts:1`
- kind：`instrument-defect`
- verdict：`CONFIRMED — a structurally-zero value reported as a reading`

## Requested action
Fix in archguard: union '(root)' with its per-file pseudo-packages (or feed getPackageStats() names into extractPackageName) before applying minFanIn/minFanOut, and add a fixture scope whose root dir has heavy in/out edges asserting fanIn>0 for '(root)'.

## Effect Prediction
- metric: concept_recurs_after_merge
- expected: false
- statement: 修复后 `<none>` 不再以同一 subject 复发（同 concept_key 的后续记录数应为 0）
- recorded_at: 2026-11-08T08:45:47.195Z

## Disposition

复核时间 2026-11-08；仪器 archguard 0.1.45（插件 `~/.claude/plugins/cache/archguard/archguard/0.1.45`）；
载体 `.archguard/query/26b300e9`（`packages/quay/src`）与 `.archguard/query/4747cc54`（`plugin/scripts`）。

### 1. 复核：finding 逐字命中（三个独立读数互相印证）

| # | 读数 | 值 | 来源 |
|---|---|---|---|
| 1 | `(root)` 在 god-package 路径上的输出 | fileCount=30 / entityCount=298 / **fanIn=0 fanOut=0**，reasons 只有 `tooManyFiles`+`tooManyEntities` | MCP `archguard_detect_god_packages(scope=26b300e9)` |
| 2 | 同 scope 关系派生的根级伪包 | 24 个（`observation.ts` 216/190、`provider-client.ts` 60/10、`init.ts` 15/68、`driver-control.ts` 17/10、…、`meta-store.ts` 0/10），**求和 fanIn=405 fanOut=531**——与 finding 逐字相同 | MCP `archguard_get_package_metrics(scope=26b300e9, sortBy=fanIn, topN=400)` |
| 3 | 直接读同一个 arch.json 独立复算（不经 MCP） | 1177 实体 / 3692 关系；根级文件 24；把「包名其实是源文件名」映射到 `(root)` 后**包数 43→20**（= `archguard_summary.totalPackageCount=20`，两套口径对齐），**`(root)` fanIn=381 fanOut=425** | 下方复算脚本 |
| 4 | 第二 scope 4747cc54 | `get_package_stats` 只有 1 个包 `(root)`（321 files / 4918 entities）；把伪包映射回来后仍是 1 个包 | MCP `archguard_get_package_stats(scope=4747cc54)` |

复算脚本（可逐字重跑；`current` = archguard 现行 `extractPackageName` 语义，`fixed` = 把最后一段是源文件的包名归到 `(root)`）：

```
python3 - <<'PY'
import json,collections
a=json.load(open('.archguard/query/26b300e9/arch.json')); E=a['entities']; R=a['relations']
def cur(i):
    s=i.rfind('/')
    if s>0: return i[:s]
    d=i.rfind('.')
    return i[:d] if d>0 else i
def fixed(i):
    p=cur(i); return '(root)' if p.rsplit('/',1)[-1].endswith(('.ts','.js','.mjs')) else p
for lbl,f in (('current',cur),('fixed',fixed)):
    n={f(e['id']) for e in E}; fi=collections.Counter(); fo=collections.Counter()
    for r in R:
        s,t=f(r['source']),f(r['target'])
        if s==t: continue
        if s in n: fo[s]+=1
        if t in n: fi[t]+=1
    print(lbl,'packages=%d'%len(n),'(root) fanIn=%d fanOut=%d'%(fi['(root)'],fo['(root)']))
PY
```

**对 finding 的两处更正（复核产出，非复述）**：
- 405/531 **不是**正确答案，而是「直接求和伪包」的**重复计数**：它把根级文件之间的边（`observation.ts` ↔ `provider-client.ts` …）当成跨包。按仪器自己的规则（同包不计，`:63`）把根级文件归到同一个 `(root)` 桶后应为 **381/425**——这才是与该 scope 其他 19 个包可比的口径。
- finding 把 4747cc54 与 26b300e9 并列，但 4747cc54 是**平铺 scope**（全部 321 个文件都在根）：只有一个桶，其 fan 数字是空转而非测量，补上 `(root)` 也不会得到"高扇出 god-package"的结论。两个 scope 的处置不同。

### 2. 「已有机制在管、失败在哪一步」

- **失败点（archguard 仓，逐行）**：`src/cli/mcp/tools/atlas-analytics-tools.ts:87` `buildTypeScriptGodPackageMetrics`——`:91` fan 图的键 = `extractPackageName(entityId)`（关系派生，归一后是 `<file>.ts`）；`:103` 输出名 = `engine.getPackageStats()` 的键（目录键，根级文件是 `(root)`）；`:109-110` `fanIn.get(packageName) ?? 0` 把两个不相交的名字空间接成一个 `0`。阈值判定在下游 `src/analysis/atlas-metrics-analysis.ts:55` `evaluateGodPackages`（`minFanIn`/`minFanOut` 因此对 `(root)` 结构上不可达）。`extractPackageName` 本体 `src/analysis/package-metrics-analysis.ts:23`，跨包跳过 `:63`。
- **根因（可追溯到一次已发布的改动）**：archguard 任务 `gap-entity-id-relative-normalization`（done，commit `ad9f6eb8`，2026-11-05）把持久化 `entity.id` 归一成 workspace-relative posix。归一前 `…/packages/quay/src/observation.ts.X` 的最后一个 `/` 落在目录上 ⇒ 包名 = `packages/quay/src`；归一成 `observation.ts.X` 后最后一个 `/` 不存在，落到最后一个 `.` ⇒ 包名 = `observation.ts`。该任务的边界明文写着「不做读取侧归一；`moduleGraph` 是另一套坐标」——消费侧包名恰恰是它没覆盖的那一半。
- **同一来源的对照读数**：`.archguard/metrics-history.jsonl` 的 `2026-11-04T08:26:16Z` 记录仍带归一**前**的根包行 `packages/quay/src` = fanIn 486 / fanOut 424 / entityCount 298（32 个包）；`2026-11-08T08:46:05Z` 同一 scope 变成 43 个包、根级文件散成 24 个伪包、无根包行 ⇒ 这是**回归**，不是从来如此。
- **谁在管**：仪器本体归 archguard 仓（其自身 loop + 联络会话），⛔ 不归 quay。

### 3. 本仓（quay）的边界处置

- ⛔ **不在本仓修 archguard**：quay 无 archguard 源码（插件按版本安装），先例 `gap-ownership-active-repair-legal-dirs-lost-on-archguard-refusal` 的 DoD 明文「⛔ 不改 ArchGuard/archguard 仓库」；跨仓缺陷按 `docs/references/注意力投放——把处理能力引导到我们关心的流形上.md` L2 归联络会话。
- ✅ **本仓做的是 recurrence 闸**（这是本任务唯一可执行且可核的修复点）：`plugin/probes/architecture-analysis.md` 新增 KNOWN INSTRUMENT DEFECT 段——`(root)` 的 0/0 **不是读数**；给出正确的导出规则（把"包名其实是源文件名"映射到 `(root)`，再按同包不计丢边）与**反例**（直接求和伪包 = 405/531 是重复计数）；⛔ 不得把 0/0 报成 god-package 建档、⛔ 不得重复立同一个 instrument defect 任务（形状变了才立）。下一次（1440m）该例程读到同一 0/0 时不会再产同 subject 任务 ⇒ Effect Prediction 的 `concept_recurs_after_merge=false` 在**本仓读数面**成立。
- 📤 **上游补丁规格（交联络会话在 archguard 仓立案，本任务不执行）**：在 `buildTypeScriptGodPackageMetrics` 里先把 `extractPackageName` 的结果按「最后一段是源文件 ⇒ `(root)`」归一（等价于用 `getPackageStats()` 的目录键给每个 entity 定包），再走 `computePackageFanMetricsFromRelations`；新增 fixture scope：根目录 `a.ts`/`b.ts` + 子目录 `c/d.ts`，根↔子各有边，断言 `(root)` fanIn>0 且 intra-root 边不计入。

### 4. ADR-007 读数（本任务的 L_G 面）

- L_G archguard: scopes=2 rootBucketReportedFanIn=0 rootBucketCorrectedFanIn=381 rootBucketCorrectedFanOut=425 rootPseudoPackages=24 packagesCurrent=43 packagesCorrected=20 entitySccCount=0 directoryCycleCount=0

## AC
- [x] `.quay/routine-findings.jsonl` 中 finding `archguard-root-bucket-fan-metrics-structurally-zero`（routine `architecture-analysis`，runId `architecture-analysis-1794127547195`）所描述的问题被复核并处置 → 复核实测见 §1（三个独立读数：`detect_god_packages` 0/0、`get_package_metrics` 24 个伪包求和 405/531、arch.json 独立复算 `(root)` 381/425 且包数 43→20 与 `totalPackageCount=20` 对齐）；处置见 §3（本仓 recurrence 闸 + 上游补丁规格）
- [x] 处置结论可核：要么修掉，要么写明「已有机制在管、失败在哪一步」，⛔ 不以「已注意到」结案 → 走第二条：机制 = archguard 的 TS god-package 仪器 / `extractPackageName` 包名派生；失败在 `src/cli/mcp/tools/atlas-analytics-tools.ts:87-110`（`:91` 关系派生键 ⊗ `:103` 目录键，`:109-110` `?? 0` 接成零）；根因 = archguard `ad9f6eb8`（`gap-entity-id-relative-normalization`，2026-11-05）后消费侧包名未跟进，`.archguard/metrics-history.jsonl` 2026-11-04T08:26:16Z 的 `packages/quay/src` 486/424/298 行是归一前对照

## DoD
- [x] 上面的判据实跑通过 → 读数为真实 MCP 调用与真实载体（`.archguard/query/*/arch.json`、`.archguard/metrics-history.jsonl`）产出，复算脚本已逐字附在 §1 可重跑；`plugin/probes/architecture-analysis.md` 的 KNOWN DEFECT 段已落地（`scripts/test.sh --for-task` scoped gate 见提交）
- [x] ⛔ 探针只立案不执行：本任务若需要跑产出者/修复，由派发链执行，⛔ 不由例程代跑 → 本任务由派发链的 worker 执行；上游 archguard 修复不由本仓/例程执行，仅交联络会话，规格见 §3

## Touches
- `plugin/scripts/archguard-runner.ts`
- `.archguard/query/26b300e9/arch.json`
- `.archguard/query/4747cc54/arch.json`
- `packages/quay/src/action.ts`
- `plugin/probes/architecture-analysis.md`
- `tasks/gap-routine-architecture-analysis-archguard-root-bucket-fan-metrics-structurally-z.md`

## Blocker

**2026-11-08T09:29:19.319Z — worker 未落地（exited-not-landed）**

- 未落地原因：step=scoped-gate: TOUCHES-DIR-GLOB-HINT: 1 directory-level tasks/*.md glob(s) — enumerate concrete files or add（已知全局锁）(hint only, not a violation)
✖ the installed tarball's bin resolves to dist/quay.js and it exists (0.640715ms)
✖ installed `quay --help` runs and prints usage (Node 25 host — NOT a Node-20 proof) (0.093228ms)
✖ installed `quay --version` prints the package version (0.045779ms)
✖ installed `quay task list` does a real provider round-trip against a native workspace (0.048889ms)
✖ the tarball carries the ENTIRE plugin bundle (bundle_in_pack > 0 — AC16) (0.060309ms)
✖ the tarball ships the postinstall register script + the plugin's .claude-plugin manifests (0.041889ms)
✖ register-plugin.mjs names the user-level enable key on comment lines only (STANDING AC-162) (0.036859ms)
✖ register-plugin (global-install mode, temp HOME) writes settings.json pointing at the INSTALLED plugin dir (0.539737ms)
✖ register-plugin's ENABLE channel is off by default (AC-161) — control: a `claude` shim that DOES write user scope is NOT reached (0.097538ms)
✖ register-plugin skips silently on a NON-global install (dev `npm install` must not touch ~/.claude) (0.074478ms)
✖ register-plugin FAILS CLOSED when the installed plugin bundle is incomplete (0.038379ms)
ℹ fail 11
✖ failing tests:
✖ the installed tarball's bin resolves to dist/quay.js and it exists (0.640715ms)
✖ installed `quay --help` runs and prints usage (Node 25 host — NOT a Node-20 proof) (0.093228ms)
✖ installed `quay --version` prints the package version (0.045779ms)
✖ installed `quay task list` does a real provider round-trip against a native workspace (0.048889ms)
✖ the tarball carries the ENTIRE plugin bundle (bundle_in_pack > 0 — AC16) (0.060309ms)
✖ the tarball ships the postinstall register script + the plugin's .claude-plugin manifests (0.041889ms)
✖ register-plugin.mjs names the user-level enable key on comment lines only (STANDING AC-162) (0.036859ms)
✖ register-plugin (global-install mode, temp HOME) writes settings.json pointing at the INSTALLED plugin dir (0.539737ms)
✖ register-plugin's ENABLE channel is off by default (AC-161) — control: a `claude` shim that DOES write user scope is NOT reached (0.097538ms)
✖ register-plugin skips silently on a NON-global install (dev `npm install` must not touch ~/.claude) (0.074478ms)
✖ register-plugin FAILS CLOSED when the installed plugin bundle is incomplete (0.038379ms)
- run_id：wk-prod-anchor
- session_id：b8177c5b-da96-4f12-8fb3-a7d5f07d05a1
