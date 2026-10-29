---
id: gap-routine-semantic-dedup-scan-extract-section-copy
title: "semantic-dedup-scan: Byte-identical 9-line heading-section extractor
  (only delta is the non-null assertion `headingMatch.index!`);
  task-shape-artifacts.ts does not import the kerne"
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
Byte-identical 9-line heading-section extractor (only delta is the non-null assertion `headingMatch.index!`); task-shape-artifacts.ts does not import the kernel/extract-section.ts export it duplicates.

载体记录（逐字来源）：`.quay/routine-findings.jsonl` · routine `semantic-dedup-scan` · probe `semantic-dedup-scan` · runId `semantic-dedup-scan-1793251416079` · ts `2026-10-29T05:23:36.079Z`。

该 finding 由例程的机械通道产出，本任务由**同一条通道**依赖 `plugin/scripts/routine-file-gate.ts` 的三道闸
（quality / dedup / rate）机械立案 —— ⛔ 不是由人转抄，也不是由探针自行执行。

- 观测符号：`extractSection`、`findShapeSection`
- 涉及文件：
- `packages/quay/src/kernel/extract-section.ts:45`
- `packages/quay/src/kernel/task-shape-artifacts.ts:83`
- kind：`byte-identical-body`
- verdict：`real-duplication`

## Requested action
merge

## Effect Prediction
- metric: concept_recurs_after_merge
- expected: false
- statement: 修复后 `<none>` 不再以同一 subject 复发（同 concept_key 的后续记录数应为 0）
- recorded_at: 2026-10-29T05:23:36.079Z

## Disposition
- 判定：**真重复，已修掉**（⛔ 不是「已注意到」结案）。
- 动作：`packages/quay/src/kernel/task-shape-artifacts.ts` 删除本地九行 `findShapeSection` 实现，
  改为 `import { extractSection } from "./extract-section.ts"` +
  `export { extractSection as findShapeSection }` ⇒ **同一函数对象、一份 body**。历史名保留为
  re-export（task gap-ready-check-duplicated-algorithm-store-vs-ready-pool-check 的 AC2 把它列为该
  kernel 模块的对外面之一），仓库内零外部调用者。
- 为什么它活到今天：同一对 copy 在 10-09 / 10-13 / 10-21 / 10-24 / 10-28 被**重复上报五次**
  （`extract-section-three-independent-copies` / `extract-section-family` /
  `extract-section-triplication` / `xpkg-extractsection` /
  `extract-section-find-shape-section`），五次**全部被 rate 闸挡下**
  （`rate: 3 routine-filed tasks this window ≥ cap 3`）⇒ 从未有任务被执行。本次是第六次上报、
  首次穿过 rate 闸 —— 所以处置必须落在结构上，而不是把第三次观测再记一遍。

## Evidence
- 声明计数（按位置，不按关键词）：`grep -rn 'function findShapeSection' packages/quay/src plugin/scripts scripts`
  ⇒ **count=0**；`grep -rn 'export { extractSection as findShapeSection }' packages/quay/src`
  ⇒ 唯一命中 `packages/quay/src/kernel/task-shape-artifacts.ts:89`。
- identity 断言：`packages/quay/test/kernel-pure-judges.test.mjs` 的
  「② kernel shape judge's findShapeSection IS the kernel extractSection object」绿（11/11 pass）。
- **负控制（同一条判据能取假）**：把修复前的 body 恢复（`git checkout -- task-shape-artifacts.ts`）
  再跑同一套件 ⇒ 该断言 **FAIL**（`+ [Function: findShapeSection]`，10 pass / 1 fail）；恢复修复后
  再绿。⇒ 这条断言测的是结构，不是回声（硬规则 4 推论三）。
- 行为不变：`plugin/test/task-parsing-parity.test.mjs` + `packages/quay-native/test/gate-shape-dispatch.test.mjs`
  ⇒ 24/24 pass（含 "0 divergence across every real task file's headings"）；`tsc --noEmit` 对
  `packages/quay` 与 `packages/quay-native` 均 exit 0；scoped gate
  `scripts/test.sh --for-task <id> --allow-thin` exit=0（102/102）。
- ADR-007 暗轴：本改动新增的是一条 kernel→kernel import 边（正是 L_D 能取假的那一面），实测：
- L_D archguard: entitySccCount=0 directoryCycleCount=0 entities=1112 relations=3430 sourceFiles=156
  （六个 scope 全部 evaluated=true，runner 结论 `PASS — no dependency cycles in any scope`）
- 完整证据包：worktree `.quay/ac-extract-section-copy/evidence.txt` + `scoped-gate.log`。

## AC
- [x] `.quay/routine-findings.jsonl` 中 finding `extract-section-copy`（routine `semantic-dedup-scan`，runId `semantic-dedup-scan-1793251416079`）所描述的问题被复核并处置
- [x] 处置结论可核：要么修掉，要么写明「已有机制在管、失败在哪一步」，⛔ 不以「已注意到」结案

## DoD
- [x] 上面的判据实跑通过
- [x] ⛔ 探针只立案不执行：本任务若需要跑产出者/修复，由派发链执行，⛔ 不由例程代跑

## Touches
- `packages/quay/src/kernel/extract-section.ts`
- `packages/quay/src/kernel/task-shape-artifacts.ts`
- `packages/quay/test/kernel-pure-judges.test.mjs`
- `tasks/gap-routine-semantic-dedup-scan-extract-section-copy.md`