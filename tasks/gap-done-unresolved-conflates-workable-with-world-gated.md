---
id: gap-done-unresolved-conflates-workable-with-world-gated
title: done-unresolved 把「工作产物型」与「生产事件型」缺口压成一态——后者永远静默，无人立案
status: todo
labels:
  - gap
  - defect
  - mechanism
parent: null
children: []
extra:
  schema: plan
---
## Proposal

`plugin/scripts/goal-driver.ts` 的缺口状态 `done-unresolved` 的定义是「有关联任务、但全部为非牵引态（done/superseded）而 AC 判据仍未达成 ⇒ ⛔ 不再 spawn」（见该文件 `GapState` 文档注释）。设计动机是避免每轮重复 spawn 同一条任务。但它把两类**性质完全不同**的缺口压成了同一态：

- (A) **工作产物型**（workable）：判据的真值是一个仓库内的工作产物（代码 / 文件 / 测试），差的是「工作量不足或需要复验」⇒ 还有一个 task 能改变它。
- (B) **生产事件型**（post-filing / world-gated）：判据的真值是**立案之后的未来生产事件**读数——例如 AC-320 读 `.quay/release-branch-finish.jsonl` 要「立条之后切出的 release tag」；AC-281 读 `.quay/ci-runs.jsonl` 要「立案之后一次 CI 跑进 30 秒」。**没有任何 worker 能产出它**；只有世界发生变化 + 有人回头复读。

对 (B)，`done-unresolved` 是**终点黑洞**：任务做完了、判据仍红、机制按设计不立案 ⇒ 永久静默，无人立案。

**实测（2026-10-02，`/data/home/yale/work/quay/.quay/goal-round.jsonl`）**：`goal-gaps` fact 非安静态 3 条，**全部**是 `done-unresolved`：`GOAL-020/AC-320`（1 条关联任务，全 done）、`GOAL-022/AC-281`（6 条关联任务，全 done）、`GOAL-027/AC-318`（1 条关联任务，全 done）。其中 AC-320 与 AC-281 均为生产事件型。

**同一失败模式已有守卫，但只覆盖另外两个 population**：`standing-violated` 与 `frozen-violated` 的文档注释都逐字写着「曾经 done 的关联任务**不覆盖回归**（那正是「回归后再无人立案」的成因），只有 todo/ready/needs-human 才算有人接手」。①（active AC）这个 population **没有**这道守卫——正是本条要补的那一半。

<!-- dedup-ref -->
本条与 `gap-goal-driver-computed-gaps-never-surfaced-as-a-round-fact`（done）相关但不重复：那条只把 `done-unresolved` 等态**落痕可见**（纯观测性新增，明令不改 spawn 行为）；本条补的是**语义分叉**——同一 `done-unresolved` 下两种成因的可执行去向不同，落痕可见并不解决「谁去复读生产事件」。与本条相邻的既有可见性实现落在 `plugin/test/goal-driver-s09.test.mjs`（`goal-gaps` fact 视图）。

## Plan

要求的方向（落笔方按实际代码定，⛔ 不照抄本任务体）：把 `done-unresolved` 拆成两个**取值不同形**的状态（硬规则 3b），判别必须是**机械的**：

1. **机械判别谓词**：AC 的判据是否读**生产载体**（如 `.quay/ci-runs.jsonl` / `.quay/release-branch-finish.jsonl` 这类由生产写入、不在仓库工作产物内的 jsonl/json）。
   - 读生产载体 ⇒ **world-gated 态**（独立取值）：**不 spawn worker**，但要路由给能触发 / 复读的 owner（常设 routine / 人 / 带 deadline 的定期复读），且**该路由本身要留痕**（轮记录可读）。
   - 否则 ⇒ **workable 态**：照现有语义（照常进入立案面）。
2. **⛔ 不得把「读不到」压成任一实质态**——判别器读不懂判据载体 / 判据不可解析时必须落**独立取值**，既不与 workable 同形也不与 world-gated 同形（硬规则 3b），且该取值**不消耗 spawn 名额**。
3. **枚举消费者**：新增状态值 ⇒ 逐条枚举 `GoalGap.state` 的全部消费者（`isFilingGapState`、`gapViewEntries` / `QUIET_GAP_STATES`、`buildGapWorkerPrompt`、`runGapSpawnPass`、既有 `goals/AC-*.md` 判据），确认不把「一种静默」换成「另一种无主静默」。
4. 判别落点尽量**单一真相源**：⛔ 不在 driver 里重推一套与判据/载体无关的启发式；能复用既有读数（如判据文本 / 载体路径解析）就复用。
5. `bash scripts/test.sh --for-task gap-done-unresolved-conflates-workable-with-world-gated` 绿。

## AC

- [ ] **AC1 能取假（world-gated 与 workable 不同形）**：一条**生产事件型** AC（判据读生产载体，如 `.quay/ci-runs.jsonl`）落在 world-gated（或实现所选的可区分取值）上，且该态**不**与 workable 共用输出——把判别改回「只按关联任务状态」⇒ 该断言**变红**（贴改前 / 改后两个读数）。
- [ ] **AC2 负控制（工作产物型仍照常立案）**：一条**工作产物型** AC（判据只读仓库内工作产物）仍落 workable，且照常进入立案面（`isFilingGapState === true` 且出现在 `runGapSpawnPass` 的选取面）；与 AC1 互为对照，⛔ 缺一不算。
- [ ] **AC3 单测断言该分叉**：在覆盖 goal-driver 缺口状态的测试 shard（当前为 `plugin/test/goal-driver-s09.test.mjs`，及其 `computeGoalGaps` 状态侧 shard `goal-driver-s01.test.mjs` / `goal-driver-s06.test.mjs`）里断言 world-gated 与 workable 逐条不同形；改掉任一分支 ⇒ 该 shard **红**（贴红 / 绿两个读数，⛔ 只贴绿不算）。
- [ ] **AC4 至少一条 AC 读生产载体（硬规则 4 推论三）**：落地**之后**的时间窗内，`.quay/goal-round.jsonl` 的 `goal-gaps` / `goal-ring` fact 中 **world-gated 态的实际记录数 ≥1**（⛔ 不得只靠 fixture / 注入满足；若窗口内生产恰无此形态，如实记实测为零并给出该窗口读数，⛔ 不得以 fixture 冒充）。
- [ ] **AC5 「读不到」独立取值**：判别器读不到 / 解析不出判据载体时落**独立取值**（既不与 workable 也不与 world-gated 同形，硬规则 3b），并贴该三态各自的实跑输出。
- [ ] **AC6 不回归**：`bash scripts/test.sh --for-task gap-done-unresolved-conflates-workable-with-world-gated` 绿，且 delta 只触及 `## Touches` 内路径。

## DoD

**落地判据是「生产事件型缺口不再永久静默」，不是「文件里的字变了」**：

- 一条 `done-unresolved` 的 active AC，其判据读生产载体时**不再**落进「永久静默」：它落 world-gated（可区分取值）并被路由给有 owner / 复读机制的一侧，且该路由在**轮记录里留痕**；同时一条工作产物型 AC 照常立案。
- **反例判据（一条命令可查）**：把判别器换回「只按关联任务状态」后，world-gated 与 workable 再次同形 ⇒ AC1/AC3 必红。
- **生产读数**：`.quay/goal-round.jsonl` 里报告 world-gated 态的**真实记录数 ≥1**，**且 N 只计实现落地之后的时间窗**（硬规则 4 推论三）——⛔ 只由 fixture / 注入数据满足的判据不算落地。
- **⛔ 三种凑绿不算**：① 只把 `done-unresolved` 改名而不做机械判别；② 让 world-gated 也照常 spawn worker（那是浪费 worker 名额，不是修复）；③ 让「读不到判别载体」落成 workable 或 world-gated 任一实质态（硬规则 3b 的镜像错误）。三者各自单列，⛔ 不得静默略过。

## Touches

- plugin/scripts/goal-driver.ts
- plugin/test/helpers/goal-driver-harness.mjs
- plugin/test/goal-driver-s01.test.mjs
- plugin/test/goal-driver-s06.test.mjs
- plugin/test/goal-driver-s09.test.mjs
- tasks/gap-done-unresolved-conflates-workable-with-world-gated.md
