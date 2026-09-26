---
id: gap-routine-semantic-dedup-scan-seeded-prng-three-copies-two-names-reproducibili
title: "semantic-dedup-scan: three copies under two names; a literal-level
  comparison (not just comment-stripped) confirms the two cited bodies are
  identical INCLUDING every constant, and "
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
three copies under two names; a literal-level comparison (not just comment-stripped) confirms the two cited bodies are identical INCLUDING every constant, and an empirical 6-seed by 10000-draw comparison confirms the third is output-equivalent today, which is the reproducibility primitive cross-report seed comparability depends on

载体记录（逐字来源）：`.quay/routine-findings.jsonl` · routine `semantic-dedup-scan` · probe `semantic-dedup-scan` · runId `semantic-dedup-scan-1790417424782` · ts `2026-09-26T10:10:24.782Z`。

该 finding 由例程的机械通道产出，本任务由**同一条通道**依赖 `plugin/scripts/routine-file-gate.ts` 的三道闸
（quality / dedup / rate）机械立案 —— ⛔ 不是由人转抄，也不是由探针自行执行。

- 观测符号：`mulberry32`、`makeRng`
- 涉及文件：
- `plugin/scripts/defect-latency-pair.ts:306`
- `plugin/scripts/discovery-path-classify.ts:424`
- `plugin/scripts/rework-predictors.ts:345`
- kind：`same-symbol-multi-file`
- verdict：`real-duplication`

## Requested action
extract one seededRng and re-export it under both existing names so seeds stay comparable

## AC
- [x] `.quay/routine-findings.jsonl` 中 finding `seeded-prng-three-copies-two-names-reproducibility-primitive`（routine `semantic-dedup-scan`，runId `semantic-dedup-scan-1790417424782`）所描述的问题被复核并处置
- [x] 处置结论可核：要么修掉，要么写明「已有机制在管、失败在哪一步」，⛔ 不以「已注意到」结案

## DoD
- [x] 上面的判据实跑通过
- [x] ⛔ 探针只立案不执行：本任务若需要跑产出者/修复，由派发链执行，⛔ 不由例程代跑

## 复核（两半各自独立复算，⛔ 不转抄 finding 的结论）
- 命中范围：`grep -rn '0x6d2b79f5' plugin/scripts/*.ts` 收敛前 3 处、收敛后余 1 处（`plugin/scripts/gate-script-base.ts`，即新 canonical）。
- 「前两份逐字相同」：对 develop 上的本体逐行比对，两份 `mulberry32` / `makeRng` 除函数名与注释外逐字相同。
- 「第三份输出等价」：把 **develop 上的旧代码本体**用 `git show develop:<file>` 抽出函数体重建，与新 canonical 逐一对比 —— 12 seed × 20000 draw，三个 pre/post 对 mismatches 均 `= 0 / 240000`。
- 该零计数的配套对照（硬规则 2）：同一比较器对刻意扰动的增量读 `100000/100000` ⇒ 零是测量结果，不是盲仪器。第一次写的比较器因在 draw 循环内重建旧 RNG 而读出 239988，正是这个对照让它现形。

## 处置（修掉，不是「已注意到」）
- canonical = `plugin/scripts/gate-script-base.ts` 的 `seededRng`。落点理由：该模块本就是三个站点里两个（`discovery-path-classify.ts` / `rework-predictors.ts`）已经 import 的「gate scripts 共享原语」模块；同族先例是本 routine 的 `arg-parsing-helper-family` 把 `flagValue` 收进同一模块。
- 三个站点各自 `export { seededRng as <历史名> }`：`defect-latency-pair.ts` / `rework-predictors.ts` → `mulberry32`，`discovery-path-classify.ts` → `makeRng`。⛔ 公共 API 名一个都没改，因此文档/报告里记过的 seed 仍给同一序列。
- 三处内部调用点改调 canonical 名（`seededRng`），使再导出名不再是可以再次分叉出第二本体的引用点。
- 逐值不变是硬要求（跨报告 seed 可比就是这条 primitive 的全部意义），故上面的等价性是对**旧代码本体**实测的，不是对自身回显。

## 实跑
- `node --test` 四个相关测试文件：`gate-script-base` 38、`defect-latency-pair` 17、`discovery-path-classify` 18、`rework-predictors` 25 —— 合计 98，`fail 0`。
- `import-graph-check.ts`：`valueSccs=0 typeSccs=0 reverseEdges=0` —— 未造环、未增反向边。
- `anti-drift-touches-check.ts --task <本任务> --worktree <本任务的 worktree> --merge-target develop`：把 `plugin/scripts/gate-script-base.ts` 补进 `## Touches` 后 `0 out-of-declared`（补之前它确实硬红在 `out-of-declared: task wrote plugin/scripts/gate-script-base.ts`，本地 1 秒跑出来而不是烧掉整轮 fan-in）。

## Touches
- `plugin/scripts/gate-script-base.ts`
- `plugin/scripts/defect-latency-pair.ts`
- `plugin/scripts/discovery-path-classify.ts`
- `plugin/scripts/rework-predictors.ts`
- `tasks/gap-routine-semantic-dedup-scan-seeded-prng-three-copies-two-names-reproducibili.md`