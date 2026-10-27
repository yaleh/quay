---
id: gap-routine-semantic-dedup-scan-write-state-atomic-split
title: "semantic-dedup-scan: Five writeState helpers: two re-implement the
  tmp+rename atomic idiom inline while red-window-triage/runner-state-write
  already delegate to kernel writeJsonAto"
status: done
labels:
  - gap
  - routine-filed
  - semantic-dedup-scan
parent: null
children: []
extra: {}
---
## Finding
Five writeState helpers: two re-implement the tmp+rename atomic idiom inline while red-window-triage/runner-state-write already delegate to kernel writeJsonAtomic and meta-driver does a plain (non-atomic, torn-read-prone) writeFileSync — one behaviour with three implementations.

载体记录（逐字来源）：`.quay/routine-findings.jsonl` · routine `semantic-dedup-scan` · probe `semantic-dedup-scan` · runId `semantic-dedup-scan-1792940684375` · ts `2026-10-25T15:04:44.375Z`。

该 finding 由例程的机械通道产出，本任务由**同一条通道**依赖 `plugin/scripts/routine-file-gate.ts` 的三道闸
（quality / dedup / rate）机械立案 —— ⛔ 不是由人转抄，也不是由探针自行执行。

- 观测符号：`writeState`、`writeJsonAtomic`
- 涉及文件：
- `plugin/scripts/ci-runs-collect.ts:1226`
- `plugin/scripts/driver-anchor.ts:583`
- `plugin/scripts/meta-driver.ts:1558`
- `plugin/scripts/red-window-triage.ts:160`
- `plugin/scripts/runner-state-write.ts:55`
- `packages/quay/src/kernel/write-json-atomic.ts:45`
- kind：`divergent-implementation`
- verdict：`real-duplication`

## Requested action
merge

## Effect Prediction
- metric: concept_recurs_after_merge
- expected: false
- statement: 修复后 `<none>` 不再以同一 subject 复发（同 concept_key 的后续记录数应为 0）
- recorded_at: 2026-10-25T15:04:44.375Z

## Disposition（复核 + 处置，逐条可核）

**结论：修掉（merge），不是「已注意到」。** 五种 `writeState` 现在共用 kernel 的**唯一**原子写实现
`packages/quay/src/kernel/write-json-atomic.ts`（tmp + renameSync，`randomBytes` 唯一后缀）。

复核读数（每个符号的实际处置，位置为本 worktree 当前行号）：

| 文件 | 修前 | 处置后 |
|---|---|---|
| `plugin/scripts/ci-runs-collect.ts` | 内联复写 tmp+rename（`JSON.stringify` 单行 + `.tmp-<pid>`） | `:1233` 委托 `writeJsonAtomic` |
| `plugin/scripts/driver-anchor.ts` | 内联复写 tmp+rename | `:597` 委托 `writeJsonAtomic` |
| `plugin/scripts/meta-driver.ts` | **裸 `writeFileSync`（非原子，O_TRUNC）** | `:1568` 委托 `writeJsonAtomic` |
| `plugin/scripts/red-window-triage.ts` | 已委托 | `:161` 委托（未改动，核过） |
| `plugin/scripts/runner-state-write.ts` | 已委托 | `:64` 委托（未改动，核过） |

`meta-driver.ts` 那一条是本 finding 里**唯一真正会咬人的**：裸写在并发读者眼里可产生零长度/半写文件，
读侧把它当成「没有状态」⇒ 退化为 never-judged ⇒ 多判一次（与「读到旧值」同形，硬规则 3b）。

**硬规则 5b（同一原则在同一载体里的其它适用点）**——同两个文件里另有两处回读面载体也是裸写，一并修：
- `plugin/scripts/driver-anchor.ts:314` `writeTakeoverRecord`（`.quay/anchor-takeover.json`）
- `plugin/scripts/meta-driver.ts:1051` action-record scan 载体（`.quay/action-record-scan.json`）

**5b 全库扫数**（`source-text-lib.codeOnlyText` 屏蔽注释/字面量后，`plugin/scripts` + `packages/quay/src`，
排除 kernel 自身）：`renameSync(` 共 **20 处 / 13 个文件**。前 3：`carrier-retention.ts:3`、
`ci-runs-collect.ts:1`（**JSONL 文本载体**的就地补全重写——行导向文本，不是 JSON 状态写，
`writeJsonAtomic` 表达不了；新测试里这条是**具名 allowance**）、`doc-check-cache.ts:1`。
其余站点**不在本 finding 命名的 `writeState` 家族内、也不在本任务 Touches 内** ⇒ 在此如实登记，⛔ 不静默略过。

**防复发（不是散文）**：新增 `plugin/test/writestate-single-implementation.test.mjs`——按**位置**判定
（复用 `source-text-lib.codeOnlyText`，注释/字面量先屏蔽）：五个 writer 必须调用 `writeJsonAtomic`、
`renameSync(` 不得超过具名 allowance、不得出现 `writeFileSync(...JSON.stringify...)`。
它自带两条控制：**正控制**（kernel 源码里必须仍看得到 `renameSync(`，否则零计数只是谓词失明，硬规则 4）、
**负控制**（同一谓词对修前的两种形态必须报红、对「注释里提到该惯例」必须沉默，硬规则 2）。

**实跑证据**（均在本 worktree，Node `--experimental-strip-types`）：
- `plugin/test/writestate-single-implementation.test.mjs` → 3/3 pass
- `plugin/test/ci-runs-collect.test.mjs` → 60/60 pass
- `plugin/test/meta-driver.test.mjs` → 143/143 pass
- `plugin/test/anchor-state-atomicity.test.mjs` + `writestate-atomicity-split-s01/s02` → 5/5 pass
  （含 M2 并发读臂：对**真 anchor** 的 `.quay/anchor.json` 并发读 0 例 torn）
- `driver-anchor-takeover` + `driver-anchor-declaration` + `red-window-triage` → 23/23 pass
- `for d in packages/*/; do npx tsc --noEmit -p "$d"; done` → exit 0
- `scripts/test.sh --for-task gap-routine-semantic-dedup-scan-write-state-atomic-split --allow-thin` → exit 0

**ADR-007 暗轴记录**（本次合并只收敛写侧实现，不新增/删除模块间依赖方向）：
- L_D import-graph-check: valueSccs=0 typeSccs=0 reverseEdges=0 (files=511 edges=1538 kernelChecked=true kernelViolations=0)

## AC
- [x] `.quay/routine-findings.jsonl` 中 finding `write-state-atomic-split`（routine `semantic-dedup-scan`，runId `semantic-dedup-scan-1792940684375`）所描述的问题被复核并处置
- [x] 处置结论可核：要么修掉，要么写明「已有机制在管、失败在哪一步」，⛔ 不以「已注意到」结案

## DoD
- [x] 上面的判据实跑通过
- [x] ⛔ 探针只立案不执行：本任务若需要跑产出者/修复，由派发链执行，⛔ 不由例程代跑

## Touches
- `plugin/scripts/ci-runs-collect.ts`
- `plugin/scripts/driver-anchor.ts`
- `plugin/scripts/meta-driver.ts`
- `plugin/scripts/red-window-triage.ts`
- `plugin/scripts/runner-state-write.ts`
- `packages/quay/src/kernel/write-json-atomic.ts`
- `plugin/test/writestate-single-implementation.test.mjs`
- `tasks/gap-routine-semantic-dedup-scan-write-state-atomic-split.md`