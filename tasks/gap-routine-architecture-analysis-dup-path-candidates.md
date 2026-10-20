---
id: gap-routine-architecture-analysis-dup-path-candidates
title: "architecture-analysis: Structurally identical 28-line path resolution
  clone (archguard dup hash 4cf914f3bbd40659, 316 tokens) inside two independent
  static checkers, so scope-resol"
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
Structurally identical 28-line path resolution clone (archguard dup hash 4cf914f3bbd40659, 316 tokens) inside two independent static checkers, so scope-resolution semantics can drift between gates.

载体记录（逐字来源）：`.quay/routine-findings.jsonl` · routine `architecture-analysis` · probe `architecture-analysis` · runId `architecture-analysis-1792481915389` · ts `2026-10-20T07:38:35.389Z`。

该 finding 由例程的机械通道产出，本任务由**同一条通道**依赖 `plugin/scripts/routine-file-gate.ts` 的三道闸
（quality / dedup / rate）机械立案 —— ⛔ 不是由人转抄，也不是由探针自行执行。

- 观测符号：`pathCandidates`
- 涉及文件：
- `plugin/scripts/threshold-scope-check.ts:162`
- `plugin/scripts/tick-core-static-check.ts:253`
- kind：`duplication`
- verdict：`confirmed`

## Requested action
Extract to a shared plugin/scripts/path-scope.ts consumed by both; AC: repo-wide grep finds one definition and both checkers' existing tests stay green.

## AC
- [x] `.quay/routine-findings.jsonl` 中 finding `dup-path-candidates`（routine `architecture-analysis`，runId `architecture-analysis-1792481915389`）所描述的问题被复核并处置
- [x] 处置结论可核：要么修掉，要么写明「已有机制在管、失败在哪一步」，⛔ 不以「已注意到」结案

## DoD
- [x] 上面的判据实跑通过
- [x] ⛔ 探针只立案不执行：本任务若需要跑产出者/修复，由派发链执行，⛔ 不由例程代跑

## Touches
- `plugin/scripts/threshold-scope-check.ts`
- `plugin/scripts/tick-core-static-check.ts`
- `plugin/scripts/path-scope.ts`
- `plugin/test/path-scope-single-source.test.mjs`
- `plugin/scripts/capability-catalog-declarations.json`
- `tasks/gap-routine-architecture-analysis-dup-path-candidates.md`

## Blocker

**2026-10-20T08:04:21.772Z — worker 未落地（exited-not-landed）**

- 未落地原因：step=suite: AssertionError [ERR_ASSERTION]: no live reference to the moved files' old paths may remain (update callers to plugin/loop/ + plugin/scripts/)
- run_id：wk-prod-anchor
- session_id：03cfad1c-c137-4159-a1c9-ec81217e4784

## Evidence

**处置：已修掉**（dup 消除；不是「已有机制在管」也不是「已注意到」）

- **唯一正本**：`plugin/scripts/path-scope.ts` 定义 `pathCandidates` + 它需要的两个常量
  `TOP_LEVELS` / `PATH_EXT_RE`。`plugin/test/path-scope-single-source.test.mjs` ② 按位置枚举
  `plugin/scripts/*.ts`，断言定义点**恰为** `["path-scope.ts"]`（先把注释剥掉，硬规则 2 两半都跑过：
  谓词对真定义命中、对注释里的同名文本不命中）；① 用 `assert.equal` 断言两个 checker re-export 的是
  **同一个函数引用**，而不是各自一份行为相同的副本。
- **公开表面不变**：`threshold-scope-check.ts` / `tick-core-static-check.ts` 继续 re-export
  `pathCandidates`（沿用 `fs-walk.ts` 的抽取先例），调用点无需改动；两个 checker 的既有测试与两组
  静态检查在同一轮 scoped gate 中全绿。
- **上一轮 suite 红的根因与本轮修复**：`plugin/test/loop-shipping.test.mjs` 的 AC1b（"5 个退役旧路径
  不得有活引用"）扫到了本任务新测试的 fixture —— 那条 `:NNN` 引文用例当时引用了 tick doc 的**退役旧址**。
  fixture 只需要一个路径形状的 token 带行号引文，不需要引用退役路径 ⇒ 改用现址
  `plugin/loop/orchestrator-loop-tick.md:302`，该 fixture 不再产生旧路径活引用。
  `loop-shipping.test.mjs` + `path-scope-single-source.test.mjs` 合跑 **30/30 绿**。
- **验证**：`scripts/test.sh --for-task gap-routine-architecture-analysis-dup-path-candidates --allow-thin`
  exit 0；`anti-drift-touches-check.ts --merge-target develop` exit 0（5 个实际改动文件全部在
  `## Touches` 内）。
