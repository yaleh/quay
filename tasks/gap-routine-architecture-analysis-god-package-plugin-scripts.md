---
id: gap-routine-architecture-analysis-god-package-plugin-scripts
title: "architecture-analysis: fanOut 3607 across 314 files / 4772 entities —
  flat scripts dir has outgrown one package; largest files are 4-7k lines
  (worker-driver 7155, full-suite-runner"
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
fanOut 3607 across 314 files / 4772 entities — flat scripts dir has outgrown one package; largest files are 4-7k lines (worker-driver 7155, full-suite-runner 5866)

载体记录（逐字来源）：`.quay/routine-findings.jsonl` · routine `architecture-analysis` · probe `architecture-analysis` · runId `architecture-analysis-1793401956536` · ts `2026-10-30T23:12:36.536Z`。

该 finding 由例程的机械通道产出，本任务由**同一条通道**依赖 `plugin/scripts/routine-file-gate.ts` 的三道闸
（quality / dedup / rate）机械立案 —— ⛔ 不是由人转抄，也不是由探针自行执行。

- 观测符号：`withPerFileCpuPreload`、`isStaticCheckFailureLine`、`extractStaticCheckDetail`
- 涉及文件：
- `plugin/scripts/full-suite-runner.ts:239`
- `plugin/scripts/worker-driver.ts:1`
- kind：`god-package`
- verdict：`CONFIRMED`

## Requested action
group scripts by surface (driver/check/reading) into sub-packages and split megascripts at their natural seams

## Effect Prediction
- metric: concept_recurs_after_merge
- expected: false
- statement: 修复后 `<none>` 不再以同一 subject 复发（同 concept_key 的后续记录数应为 0）
- recorded_at: 2026-10-30T23:12:36.536Z

## Disposition

复核时间 2026-10-31，worktree `gap-routine-architecture-analysis-god-package-plugin-scripts` @ develop `bdc27bb5d`。

### 1. 读数复核：逐字命中，但「314 files」与「fanOut/fanIn」分属两个 archguard 口径

| 量 | finding | 本次实测 | 来源 |
|---|---|---|---|
| worker-driver 行数 | 7155 | 7155 | `wc -l plugin/scripts/worker-driver.ts` |
| full-suite-runner 行数 | 5866 | 5866 | `wc -l plugin/scripts/full-suite-runner.ts` |
| entityCount / fanOut / fanIn | 4772 / 3607 / — | 4772 / 3607 / 0 | `.archguard/metrics-history.jsonl` `plugin/scripts` 包行 @ 2026-10-28T04:47:11.077Z |
| 314 files | 314 | 314（`sourceFiles`） | 同轮 scope 行 `scripts` @ 2026-10-28T04:46:56.124Z：`sourceFiles=314 vs git ls-files plugin/scripts=509 (diff -195)` |

「314 files」不是 top-level `.ts` 数——那是 `git ls-files 'plugin/scripts/*.ts' | wc -l`（本日 316，前序轮 299）；314 是 archguard `sourceFiles`（realpath 去重后实际分析到的文件数）。`fanIn 0` 是 source-root 结构恒等式（没有 scope 把整个包 import 进来），非集中度测量——与前序任务 `gap-routine-architecture-analysis-plugin-scripts-flat-god-directory` 已记的更正一致。

### 2. 复发诊断：同一 god-package 的第二次立案；megascript 成员第 1 轮已被 rate 拒绝

- 同包已 disposition：`gap-routine-architecture-analysis-plugin-scripts-flat-god-directory`（status: done，2026-10-22，runId `architecture-analysis-1792599464308`）已复核同一 `plugin/scripts` god-package，结论「布局修复是多任务程序、扁平命名空间承重」。
- 第 1 轮（2026-10-21）把本 finding 的 megascript 成员作为独立 finding 立案但被 rate 拒绝：`worker-driver-ts-god-module`、`full-suite-runner-ts-god-module`（`dedup_state` 记 `accepted:false`，理由 `rate:`）。
- 第 2 轮（2026-10-30）把它们以包级 finding 重新浮出：本 finding 符号集与第 1 轮 `full-suite-runner-ts-god-module` 的符号集共享 `isStaticCheckFailureLine`、`withPerFileCpuPreload`（均落在 `full-suite-runner.ts:322/239`）。

根因：`routine-file-gate.ts` 的 dedup subject 键 = **精确符号集相等**（`:60-66` 已声明边界，非 bug）。god-package 的观测符号每轮随 archguard 采样漂移 ⇒ 同一包跨轮**不被 dedup、只被 rate 兜底**。本轮 rate 闸确实兜底：6 候选 → 立案 3（serve-view / plugin-scripts / dup-release-yml-parsers）+ rate 拒绝 3（`god-package-cli`、`god-package-core`、`dup-fenced-bodies`，其中 2 个同为 god-package）。

### 3. 已有机制在管哪一部分、失败在哪一步

| 机制 | 管什么 | 失败在哪一步 |
|---|---|---|
| `import-graph-check.ts` | value/type SCC、层间越界、kernel/gate-layer 边界 | 无 domain 维度；无环扁平命名空间按定义 PASS（本日实测 valueSccs=0/typeSccs=0/reverseEdges=0 全绿） |
| `archguard-runner.ts` | 每次 analyze 记 maxInDegree/maxOutDegree | 只记录不判定（`:21` 留待数据积累）；`.archguard/` gitignored、不成棘轮 |
| `git-lens-l-g-structural-drift.ts` | 唯一带 god-module 阈值仪器 | 已退役（`archive/2026-09-07-zero-call-scripts/`） |
| `routine-file-gate.ts` dedup 闸 | 防同一 subject 重复立案 | subject 键 = 精确符号集；god-package 符号跨轮漂移 ⇒ 不 dedup、退化为 rate 兜底（已声明残余） |
| 前序 disposition `plugin-scripts-flat-god-directory` | 已结论该 god-package 布局需多任务程序 | 增量①（domain 声明表 + 扁平度检查器）尚未落地 |

### 4. 处置结论

- 复核结论：finding 成立且未过期；本任务**不修布局**——与同包前序 disposition 相同的承重约束（`build-plugin-dist.mjs` 入口发现、`driver-runtime.ts` resolveKernelSibling、`select-static-checks-for-touches.ts` top-level glob、`experiments/quay-perpetual-stream/scripts/` 61 个符号链接）。拆分 megascript 受同一约束：新 top-level 文件进 check-set/入口发现，子目录断 sibling 解析。
- 本 finding 的新价值 = 复发证据：把「god-package 用符号集做 dedup 键 ⇒ 同包跨轮复发、由 rate 而非 dedup 兜底」暴露为真实残余（对该 kind 是真实缺口）。
- 可执行下一个增量（本任务不执行，顺序不可交换）：①`routine-file-gate.ts` 对 `dupKind: god-package` 用包身份（package path / 已 disposition 包名抑制表）做 dedup 键；②落地前序任务增量①（domain 声明表 + 只判「top-level 文件是否属于某已声明 domain」的检查器，零文件移动）。

### 5. 复核命令（可重跑）

```bash
wc -l plugin/scripts/worker-driver.ts plugin/scripts/full-suite-runner.ts
git ls-files 'plugin/scripts/*.ts' | wc -l
node --experimental-strip-types plugin/scripts/import-graph-check.ts --json
```

### 6. L_G 读数（ADR-007）
- L_G archguard: entityCount=4772 fanOut=3607 fanIn=0
- L_G import-graph-check: valueSccs=0 typeSccs=0 reverseEdges=0

## AC
- [x] `.quay/routine-findings.jsonl` 中 finding `god-package-plugin-scripts`（routine `architecture-analysis`，runId `architecture-analysis-1793401956536`）所描述的问题被复核并处置
- [x] 处置结论可核：要么修掉，要么写明「已有机制在管、失败在哪一步」，⛔ 不以「已注意到」结案

## DoD
- [x] 上面的判据实跑通过
- [x] ⛔ 探针只立案不执行：本任务若需要跑产出者/修复，由派发链执行，⛔ 不由例程代跑

## Touches
- `plugin/scripts/full-suite-runner.ts`
- `plugin/scripts/worker-driver.ts`
- `tasks/gap-routine-architecture-analysis-god-package-plugin-scripts.md`