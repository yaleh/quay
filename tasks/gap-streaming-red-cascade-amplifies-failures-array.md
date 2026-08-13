---
id: gap-streaming-red-cascade-amplifies-failures-array
title: 早红级联放大 failures[]——state=running 断言被级联红 + 无 file 条目不可归因（round 129/130 双实证）
status: done
labels:
  - gap
  - defect
  - mechanism
parent: null
children: []
extra:
  schema: execution
---

**type:** execution

## Proposal

**round 130（2026-08-13）终态 10 条 failures = 3 真 + 4 级联 + 3 不可归因**：
```
×3 plugin/test/checker-cost.test.mjs       ← 真失败源（in-family，隔离重跑 12/12 绿 = environmental）
×3 plugin/test/full-suite-runner.test.mjs  ← 级联：断言「state=running while suite runs」
×1 plugin/test/laydown-set-check.test.mjs  ← 同上级联
×3 (no file)                               ← file 字段缺失，连归因都做不了
```
**级联机制**：runner 的**早红特性**（AC2，一检测到失败立即标 state=red）把共享
`.quay/full-suite-state.json` 翻成 red；后续运行到的「state=running + finishedAt null」断言
（full-suite-runner.test AC1 / laydown-set-check.test AC1）读到 red ⇒ 失败。**任何轮只要某负载
敏感测试早红 ⇒ 级联红**——round 129（双起污染）与 round 130（checker-cost flake）都命中同一形状。

**fail=2 / 5 / 10 三数不一致**：verification-round.jsonl 记 fail=2、外层早读 5、state 终态 10——
「失败数」目前无单一权威。

**为什么值得修（manager 2026-08-13 量化）**：`failures[]` 是三个下游消费者的输入——
triage 分区（red-window-triage）、停派规则（红窗归因）、红率统计——**一个被级联放大 3× 的
failures[] 让三者同时失真，且各自看不出来**。无 file 的条目进不了 in-family 判定，
`--partition` 只能把它丢进 not-in-family。

## Plan

1. 级联条目标记 `derived`（或 source=cascade），不入 failures[] 主集——或者 AC1 断言改为
   容忍早红：`state ∈ {running, red}` 且 `finishedAt null`（断言的是「轮在跑」，不是「轮还绿」）。
2. 无 file 条目单列（`unattributed` 段），不进 failures[] 主集。
3. 附带：`computeSuiteBlocking`（ready-pool-check.ts:1175-1176）的 fail-open 分支
   `failureFiles.length===0 ⇒ windowActive=true + ids=空`——**manager 核后基本不可达**（collectFailureFiles
   累积全历史、无窗口 ⇒ 要空须全历史无任何带 file 失败；实测 127 轮中 49 轮有 file）。撤回「可能开着的闸」。
4. **真问题（manager 2026-08-13，同处）**：`collectFailureFiles` **累积全历史**（Set 只增不减）——
   全历史 239 个 vs 最近 3 轮 12 个 ⇒ **`touches ∩ failure_files ⇒ 停派` 挡的是「碰过任何历史失败文件」
   的任务，不是「碰当前红因」的任务**；单调收紧直至锁死池子，每步都看似正常（红窗确实活跃）。最小修法：
   只取**当前红窗内**轮次（`consecutiveRedRounds` 已算出连续红长度，切片即可）。验收：修前 239 → 修后 ≈12，
   **前后差本身即负控制**。另：`collectFailureFiles` 的 `if (f && f.file)` **静默丢弃无 file 条目**
   （round 130 的 10 条里 3 条无 file = 30% 被静默丢弃）——与「无 file 单列」同处，一并修。

## Implementation（2026-08-13，worktree 子代理落）

**runner 分段（`full-suite-runner.ts`，AC1/AC2/AC6）**：
- `SuiteFailure` 新增 `derived?: "cascade"`；`SuiteState` / `SuiteRoundRecord` 新增
  `derived?: SuiteFailure[]` / `unattributed?: SuiteFailure[]`。
- 新增 `STATE_ASSERTING_TEST_FILES` 清单（`plugin/test/full-suite-runner.test.mjs` +
  `plugin/test/laydown-set-check.test.mjs`——读共享 suite-state 并断言在飞形状的测试文件）+
  `isStateAssertingTestFile()` + `segmentFailures()` + `segmentedFailureFields()`。
- 每次红写（早红流内写 + 终态写 + round record）都用 `segmentedFailureFields`：
  `failures[]` 主集 = 真实、带 file、非级联的失败；级联条目 → `derived`（标 `derived:"cascade"`）；
  无 file 条目 → `unattributed`。`failures` 主集为空时省略字段（保住「never failures:[]」不变式）。
- **static-check 红例外**：static-check red（`staticCheckDetected && !redDetected`）的 fail-closed
  checker 条目（round-84 真因，无 file）**留在 failures[] 原样**——它们靠 `staticCheck:true` 标记路由
  共享闸，segment 出去会丢掉共享闸的 dispatch 输入（`gap-static-check-red-failures-capture-only-...`
  的 failures[] Contract 不许动）。
- `--fail-fast-check` 自检改读 failures + unattributed 两段合计（no-file 的控制行仍算 failureLocation）。

**断言修正（AC1，两个测试文件）**：`full-suite-runner.test.mjs` 的
「AC1 — while the suite runs」断言改为 `state ∈ {running, red}` 且 `finishedAt null`（断言「轮在跑」
而非「轮还绿」），超时放宽到 5s；`laydown-set-check.test.mjs` 新增「early-red 免疫」断言——fixture
根里放一个红 shared-state 文件，绿 derived 集仍绿（冷启动闸不读 suite-state，构造性免疫级联）。

**红窗归因（`ready-pool-check.ts`，AC3/AC5/AC6）**：
- `collectFailureFiles(rounds, stateFailures, windowSize?)` 按 `windowSize`（= 当前红窗 consecutiveRed）
  切片——修前全历史 Set 只增不减（239），修后只取当前红窗（≈12）；负控制测试钉死「200 历史红轮 +
  当前 3 红轮 ⇒ windowSize=3 只回当前文件」。
- 新增 `countUnattributedFailures(...)`（AC6）：数 failures[]/unattributed[]/state 段里的无 file 条目，
  30% 静默丢弃率归零（derived 有 file、不算 unattributed、由 `derived` 段单列）。
- `computeSuiteBlocking`：**eliminate fail-open 分支**（`failureFiles.length===0 ⇒ windowActive=true+ids=空`
  的早退删除，走单一通路）——红窗活跃但无 file 可归因时 `windowActive` 仍 true（slot-refill 的 cap
  收窄依赖它，2026-08-13 人裁定红窗单独即触发），`ids` 空、`unattributedCount` 报数；report 的
  `suite_blocking` 增 `unattributed_count`。

**AC4（triage/--band/停派不再被放大）**：三项都读 `state.failures` 主集，主集已无级联/无 file 条目
⇒ 读数不再被放大。`red-window-triage.ts` **未改**——主集干净后它天然读到正确输入（无 file 条目本就不能
进 in-family 判定，`--band` 不受影响）。

## AC

- [x] AC1: 级联红不再混入 failures[] 主集（derived 标记或断言修正，round 130 三数一致）
- [x] AC2: 无 file 条目单列可归因
- [x] AC3: computeSuiteBlocking fail-open 分支消除或 fail-closed（或证明不可达并注释）
- [x] AC4: 早红轮 + 负载 flake 并存时，`--band` / triage / 停派三者读数不再被级联放大
- [x] AC5: **collectFailureFiles 只取当前红窗内轮次**——修后全历史 239 → 最近 3 轮 ≈12，前后差即负控制
- [x] AC6: 无 file 条目不再静默丢弃（单列或计全），30% 丢弃率归零
- [x] AC7: 既有测试全绿；`--for-task` scoped 门绿

## Definition of Done

- [x] AC1–AC5 全部勾上
- [x] round 130 的 failures[] 重放样例贴出（真 3 / 级联 4 / 无 file 3 分列）
- [x] 全量套件绿（round 165 绿验 50375bfe 所在树，4345/0）

**round 130 重放样例（分段后）**：
```
failures[]    = 真 3（checker-cost ×3，带 file + in_family）        ← 停派/triage/红率只读这个
derived[]     = 级联 4（full-suite-runner ×3 + laydown-set-check ×1，标 derived:"cascade"）
unattributed[] = 无 file 3（✖ AC2 — ready-pool-check run 3x … 等）
```
`segmentedFailureFields` 主集为空时省略 `failures` 键；`derived`/`unattributed` 非空才带。

## Touches

- plugin/scripts/full-suite-runner.ts（早红标注 / failures[] 分段）
- plugin/test/full-suite-runner.test.mjs（AC1 断言修正 + 分段测试）
- plugin/test/laydown-set-check.test.mjs（AC1 断言修正 / early-red 免疫）
- plugin/scripts/ready-pool-check.ts（computeSuiteBlocking fail-open 消除 + collectFailureFiles 红窗切片 + 无 file 计数）
- tasks/gap-streaming-red-cascade-amplifies-failures-array.md（自身）
