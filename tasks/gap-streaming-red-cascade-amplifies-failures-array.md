---
id: gap-streaming-red-cascade-amplifies-failures-array
title: 早红级联放大 failures[]——state=running 断言被级联红 + 无 file 条目不可归因（round 129/130 双实证）
status: ready
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

## AC

- [ ] AC1: 级联红不再混入 failures[] 主集（derived 标记或断言修正，round 130 三数一致）
- [ ] AC2: 无 file 条目单列可归因
- [ ] AC3: computeSuiteBlocking fail-open 分支消除或 fail-closed（或证明不可达并注释）
- [ ] AC4: 早红轮 + 负载 flake 并存时，`--band` / triage / 停派三者读数不再被级联放大
- [ ] AC5: **collectFailureFiles 只取当前红窗内轮次**——修后全历史 239 → 最近 3 轮 ≈12，前后差即负控制
- [ ] AC6: 无 file 条目不再静默丢弃（单列或计全），30% 丢弃率归零
- [ ] AC7: 既有测试全绿；`--for-task` scoped 门绿

## Definition of Done

- [ ] AC1–AC5 全部勾上
- [ ] round 130 的 failures[] 重放样例贴出（真 3 / 级联 4 / 无 file 3 分列）
- [ ] 全量套件绿

## Touches

- plugin/scripts/full-suite-runner.ts（早红标注 / failures[] 分段）
- plugin/test/full-suite-runner.test.mjs（AC1 断言修正）
- plugin/test/laydown-set-check.test.mjs（AC1 断言修正）
- plugin/scripts/ready-pool-check.ts（computeSuiteBlocking :1175 fail-open）
- plugin/scripts/red-window-triage.ts（分区读 derived 标记）
- tasks/gap-streaming-red-cascade-amplifies-failures-array.md（自身）
