---
id: gap-routine-architecture-analysis-god-package-plugin-scripts-flat-317-files
title: "architecture-analysis: single flat directory holds the entire
  methodology script surface; largest entity cluster in the repo"
status: ready
labels:
  - gap
  - routine-filed
  - architecture-analysis
parent: null
children: []
extra: {}
---
## Finding
single flat directory holds the entire methodology script surface; largest entity cluster in the repo

载体记录（逐字来源）：`.quay/routine-findings.jsonl` · routine `architecture-analysis` · probe `architecture-analysis` · runId `architecture-analysis-1793780643192` · ts `2026-11-04T08:24:03.192Z`。

该 finding 由例程的机械通道产出，本任务由**同一条通道**依赖 `plugin/scripts/routine-file-gate.ts` 的三道闸
（quality / dedup / rate）机械立案 —— ⛔ 不是由人转抄，也不是由探针自行执行。

- 观测符号：`takeLdFileReading`、`readDirectoryCycleReading`
- 涉及文件：
- `plugin/scripts/phase-declare.ts:443`
- `plugin/scripts/archguard-runner.ts:1`
- kind：`god-package`
- verdict：`god-package: 4784 entities / 317 files, fanOut=3630 (repo max)`

## Requested action
group scripts into role subdirs (orchestration/, probes/, driver/, checks/)

## Effect Prediction
- metric: concept_recurs_after_merge
- expected: false
- statement: 修复后 `<none>` 不再以同一 subject 复发（同 concept_key 的后续记录数应为 0）
- recorded_at: 2026-11-04T08:24:03.192Z

## Disposition（处置结论，可核）

**已有机制在管、失败在哪一步 —— 不是「已注意到」。** 复核载体记录：`.quay/routine-findings.jsonl` 里
runId `architecture-analysis-1793780643192` 共 9 条，findingId `god-package-plugin-scripts-flat-317-files`
verdict `god-package: 4784 entities / 317 files, fanOut=3630 (repo max)`、suggestedAction
`group scripts into role subdirs (orchestration/, probes/, driver/, checks/)` 与任务体 `## Finding` /
`## Requested action` 逐字一致 ⇒ 观测对象存在且属实（`grep -c "architecture-analysis-1793780643192"
.quay/routine-findings.jsonl` → 9）。

**第 4 次同 subject 立案**：dedup 键修复已落地——本轮 filing-round 的 `dedup_state` 里本 finding 的
`matchedKey` = `package:plugin/scripts`（不再是精确符号集），state=`done-only`（前 3 轮任务
`…-cef0939f` / `…-god-package-plugin-scripts` / `…-flat-god-directory` 均 done）⇒ 键已收敛，
但 `dedupReading` 对 `done-only` 仍 `block:false`（「a finished task does not close the READING」，
`routine-file-gate.ts` 的 status 维度）。所以本 finding 能再度立案的**直接原因**是：探针每轮仍报
`suggestedAction` 为 group/split（`hasRequestedAction` 通过），而 dedup 只挡 `live` 不挡 `done-only`。

**复核结论：该 finding 是 god-package 检测器把「承重的扁平脚本面」误读成缺陷；group 动作会打断四条
承重链，故不执行 group。** 四条链本轮在 worktree 上逐条实测（非引用前序 prose）：

| 承重机制 | 位置 | 打断后果 |
|---|---|---|
| build 入口发现 | `packages/quay/scripts/build-plugin-dist.mjs:100` `INVOCATION_RE` = `(scripts\|gate-scripts)/<name>.ts`，产出固定 `scripts/dist/<name>.js`（:27） | 子目录同时改变发现规则与产物布局 |
| driver sibling 解析 | `plugin/scripts/driver-runtime.ts:355` `resolveKernelSibling` = `path.join(dir, name)` | 移走即按名解析不到 |
| shipped check-set 推导 | `plugin/scripts/select-static-checks-for-touches.ts:179` `ls plugin/scripts/*.{sh,ts,mjs}` top-level glob | 移入子目录的文件静默退出 check-set |
| 61 个符号链接 | `experiments/quay-perpetual-stream/scripts/`（`git ls-files -s … \| awk '$1=="120000"' \| wc -l` → 61） | 移走目标即断链 |

`plugin/scripts` 的真实结构（本轮实测）：318 个 top-level `.ts`（finding 立案时刻 317，+1 漂移）、
0 目录 SCC（`node --experimental-strip-types plugin/scripts/import-graph-check.ts . --json` →
`valueSccs=0 typeSccs=0 reverseEdges=0 files=556 edges=1715`，verdict.ok=true，PASS）。
`fanOut=3630` 是 ~318 个独立入口脚本的实体级边计数，不是集中度缺陷；扁平目录没有领域子边界，
但拆分前先要四条链支持子目录，这是「先改造承重链、再逐个 domain 迁移」的多任务程序，不是单 finding
的 Touches 能承载的单次移动。

**已有机制 + 失败在哪一步**：① dedup 键按包身份（`gap-routine-file-gate-god-package-dedup-by-
package-identity` done）——已落地，`matchedKey` 收敛到 `package:plugin/scripts`，但只挡 live 不挡
done-only；② `import-graph-check.ts` / `archguard-runner.ts` 管 SCC/层间边——无环扁平命名空间按定义
PASS（本轮 0/0/0），管不到 domain 维度；③ `routine-file-gate.ts` 的 `hasRequestedAction`
（`NO_ACTION_RE`）只把 `suggestedAction: leave` 判为「测量非工作」——**失败在哪一步**：探针规格
`plugin/probes/architecture-analysis.md` 只写了「CYCLE-CONSTRAINED HUBS 报 leave」，**没写
「LOAD-BEARING FLAT SURFACE 报 leave」**，所以 `plugin/scripts` 每轮仍被报成可 group 的缺陷。

**处置动作（本轮落地，非仅诊断）**：把「承重扁平脚本面」约束写进探针规格
`plugin/probes/architecture-analysis.md`——新增 `LOAD-BEARING FLAT SCRIPT SURFACES ARE NOT
GOD-PACKAGES TO SPLIT` 段，指示探针在建议 group/split 前先对拍四条承重链，凡移动会断链的扁平脚本面
一律报 `suggestedAction: leave`、⛔ 不报 group/split。这样下一轮 `probe-routine.ts:470`
`hasRequestedAction(f)` 返回 false、以 `action:` 闸拒绝立案 ⇒ 同一 subject（`package:plugin/scripts`）
不再复发（Effect Prediction: concept_recurs_after_merge = false）。

## ADR-007 dark axis
- 该轴仍暗,理由:本修复只改探针规格 markdown 不移动包/依赖结构，L_D/L_G 读数不因本任务变化

## AC
- [x] `.quay/routine-findings.jsonl` 中 finding `god-package-plugin-scripts-flat-317-files`（routine `architecture-analysis`，runId `architecture-analysis-1793780643192`）所描述的问题被复核并处置
- [x] 处置结论可核：要么修掉，要么写明「已有机制在管、失败在哪一步」，⛔ 不以「已注意到」结案

## DoD
- [x] 上面的判据实跑通过
- [x] ⛔ 探针只立案不执行：本任务若需要跑产出者/修复，由派发链执行，⛔ 不由例程代跑

## Touches
- `plugin/probes/architecture-analysis.md`
- `tasks/gap-routine-architecture-analysis-god-package-plugin-scripts-flat-317-files.md`