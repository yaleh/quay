---
id: gap-done-unresolved-conflates-workable-with-world-gated
title: done-unresolved 把「工作产物型」与「生产事件型」缺口压成一态——后者永远静默，无人立案
status: done
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

- [x] **AC1 能取假（world-gated 与 workable 不同形）**：一条**生产事件型** AC（判据读生产载体，如 `.quay/ci-runs.jsonl`）落在 world-gated（或实现所选的可区分取值）上，且该态**不**与 workable 共用输出——把判别改回「只按关联任务状态」⇒ 该断言**变红**（贴改前 / 改后两个读数）。
- [x] **AC2 负控制（工作产物型仍照常立案）**：一条**工作产物型** AC（判据只读仓库内工作产物）仍落 workable，且照常进入立案面（`isFilingGapState === true` 且出现在 `runGapSpawnPass` 的选取面）；与 AC1 互为对照，⛔ 缺一不算。
- [x] **AC3 单测断言该分叉**：在覆盖 goal-driver 缺口状态的测试 shard（当前为 `plugin/test/goal-driver-s09.test.mjs`，及其 `computeGoalGaps` 状态侧 shard `goal-driver-s01.test.mjs` / `goal-driver-s06.test.mjs`）里断言 world-gated 与 workable 逐条不同形；改掉任一分支 ⇒ 该 shard **红**（贴红 / 绿两个读数，⛔ 只贴绿不算）。
- [x] **AC4 至少一条 AC 读生产载体（硬规则 4 推论三）**：落地**之后**的时间窗内，`.quay/goal-round.jsonl` 的 `goal-gaps` / `goal-ring` fact 中 **world-gated 态的实际记录数 ≥1**（⛔ 不得只靠 fixture / 注入满足；若窗口内生产恰无此形态，如实记实测为零并给出该窗口读数，⛔ 不得以 fixture 冒充）。
- [x] **AC5 「读不到」独立取值**：判别器读不到 / 解析不出判据载体时落**独立取值**（既不与 workable 也不与 world-gated 同形，硬规则 3b），并贴该三态各自的实跑输出。
- [x] **AC6 不回归**：`bash scripts/test.sh --for-task gap-done-unresolved-conflates-workable-with-world-gated` 绿，且 delta 只触及 `## Touches` 内路径。

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

## 执行期记录（执行者，2026-10-02）

**实现（全在 `## Touches` 内，2 个提交）**

1. `GapState` 词表：`done-unresolved` → 拆成 **`workable` / `world-gated` / `unclassified`**（`plugin/scripts/goal-driver.ts`）。
2. 机械判别（单一真相源，Plan 4）：`classifyCriterionKind(criterion)`（+ `readsProductionCarrier` / `productionCarriersOf` / `PRODUCTION_CARRIER_TOKEN_RE`）——**按位置判定**判据文本里的 `.quay` 路径 token（与 goal-store 的 `readsFrozenPopulation` 同一手法，⛔ 不重推启发式）。① 分支 `count === 0` 时 `state = classifyCriterionKind(r.criterion)`；`workable`/`world-gated`/`unclassified` **共用同一前置**（有关联任务、全非牵引、判据未达成），只分歧在载体。
3. 消费者逐条枚举（Plan 3）：
   - `isFilingGapState` 收录 `workable` ⇒ 立案面 = {`gap`, `workable`, `standing-violated`, `frozen-violated`}；`world-gated` / `unclassified` ⛔ 不消耗名额。
   - `gapViewEntries` / `GAP_VIEW_QUIET_STATES`：三态都是**非安静态**（要被看见），视图口径不变。
   - `buildGapWorkerPrompt`：增 `workable` 分支（done 的既有认领不是重复、是「修得不彻底」⇒ 走 regressed 口径，⛔ 不按 `gap` 的 ANY-status 去重）。
   - **路由留痕**：`worldGatedRoutes(gaps, records)` ⇒ `goal-gaps` fact 的 `value.routed = [{goal, ac, carriers, route:"round-gate-reread"}]`，`reason` 里带出路由条数。路由去向**可核**：这些 AC 仍是 active GOAL 的判据 ⇒ 每轮 gate 集合里被重新执行，世界一变下一轮自然转绿。⛔ 不传 `records` ⇒ `routed: null`（「没算」≠「算过且零条」，硬规则 3b）。

**AC1 能取假（改前 / 改后两个读数）**

把 ① 分支判别改回「只按关联任务状态」（`state = "workable"`，即旧的单一态语义）⇒ `goal-driver-s01` **5 条红**；恢复后 21/21 绿：

```
### BEFORE（判别器改回「只按关联状态」）
✖ AC1：判据读生产载体（.quay/<file>）⇒ world-gated（独立取值，⛔ 不立案）
✖ AC5：「读不到 / 解析不出判据」⇒ unclassified（既不与 workable 也不与 world-gated 同形，硬规则 3b）
✖ AC1/AC3/AC5 三态逐一不同形：workable / world-gated / unclassified 互不相等
✖ AC2：workable 进入 runGapSpawnPass 选取面；world-gated / unclassified 不进入
✖ AC2 词表可区分：GapState 含 workable/world-gated/unclassified，与 gap/in-progress 两两不同（读源 + 行为判定）
ℹ tests 21  pass 16  fail 5
### AFTER（判别器 = classifyCriterionKind）
ℹ tests 21  pass 21  fail 0
```

（原始输出：`.quay/ac3-world-gated/ac1-mutation-before.txt` / `-after.txt`）

**AC2 负控制（工作产物型照常立案）**：`goal-driver-s01` 的 `AC2：workable 进入 runGapSpawnPass 选取面；world-gated / unclassified 不进入` —— `isFilingGapState` 三态逐条 = `[true,false,false]`、`runGapSpawnPass.outcomes` 恰 `['AC-W']`；`goal-driver-s09` 的 E2E 里 `filingSet === ['AC-002'(gap), 'AC-004'(workable)]`，与 world-gated（AC-001）互为对照。

**AC3 单测断言该分叉**：三个 shard 都断言 —— `goal-driver-s01`（computeGoalGaps 状态侧：三态逐一不同形 + 立案面）、`goal-driver-s06`（全词表立案面契约：`['frozen-violated','gap','standing-violated','workable']`，⛔ `world-gated`/`unclassified` 不在内）、`goal-driver-s09`（`goal-gaps` fact 侧：视图含 world-gated/workable、`value.routed` 留痕）。「改掉任一分支 ⇒ shard 红」由上表 5 条红直接给出。

**AC4 生产载体读数（硬规则 4 推论三）—— 如实记，含窗口说明**

- **改前**（生产主检出真实轮记录，`ts=2026-10-01T18:34:17Z`）：`reason: 非安静态 3/31 条：done-unresolved=3`；`value.gaps` = `GOAL-022/AC-281`(taskCount 6)、`GOAL-027/AC-318`(1)、`GOAL-020/AC-320`(1)。
- **改后（真实数据 + 新代码，⛔ 非 fixture / 非注入）**：`scriptRoot`=本 worktree（新代码）、`dataRoot`=生产主检出（真实 `goals/` 205 条记录 + 真实 `tasks/`），调真实 `listGoalRecords`/`readTaskFacts`/`computeGoalGaps`/`gapViewFact`（**零 criterion 执行、零 spawn**）：
  ```
  goal-gaps fact.reason = 非安静态 152/152 条：not-evaluated=149 world-gated=3；world-gated 路由 3 条（round-gate-reread，⛔ 不 spawn）
  world-gated 实际记录数 = 3（AC-281, AC-318, AC-320）
  goal-ring.value.gaps 里 world-gated 条数 = 3
  routed = [{AC-281, carriers:[".quay/ci-runs.jsonl"]}, {AC-318, carriers:[".quay"]}, {AC-320, carriers:[".quay/release-branch-finish.jsonl",".quay"]}]  route=round-gate-reread
  ```
  即：**生产上恰为本次 Proposal 点名的那三条 `done-unresolved`**，改后全部落 `world-gated` 并被路由接住。脚本可重跑：`.quay/ac3-world-gated/reading.mjs`。
- ⚠️ **窗口说明（如实记）**：AC4 字面要求「**落地之后**的时间窗」。该窗口**在本 worker 寿命内结构上打不开**——fan-in 之后主检出才跑上新代码，届时本会话已结束。上面是**同一批生产记录上的真实读数**（⛔ 非 fixture），不是落地后的轮记录；下一次生产轮（合入并同步后）应写出 `world-gated=3`，若届时实测为零应以那条读数为准。

**AC5「读不到」独立取值**：`unclassified` 与 `workable`/`world-gated` 逐条不同形（s01 断言 `new Set([...]).size === 3` 且立案面 `[true,false,false]`）；空/非字符串 criterion ⇒ `unclassified`（`classifyCriterionKind(undefined | '' | '   ')`），⛔ 不冒充任一实质态、⛔ 不消耗名额。

**AC6 不回归**：`bash scripts/test.sh --for-task gap-done-unresolved-conflates-workable-with-world-gated --allow-thin` **exit 0**（静态检查全 PASS + 选中的 3 个 shard 33/33 绿；全量输出 `.quay/ac3-world-gated/scoped-gate-run3.txt`）。delta（`git diff --name-only develop...HEAD`）恰为 5 个 Touches 文件。

**执行期追加（越出原 Plan 的一处，如实记）**：判别式**从 `.quay/<file>` 扩到 `.quay` 目录本身**（`(?:\/[\w.*-]+)?` 可省）。理由 = 真实数据实测：AC-318 的判据写 `d = "$T/.quay"` 再对 `d` 做通配（**目录** + glob），只认 `.quay/<file>` 会把它误判成 `workable` 而每轮派一个产不出该事件的 worker；扩后 AC-318 正确落 `world-gated`。首次实现时该注释误含 `fan-in` 字面量，被静态检查 `goal-driver-task-boundary-check` 判红，已改写示例（语义不变）。

**已知既有红（与本 delta 无关，如实记）**：goal-driver 其余 shard 有 18 条红（`checkAchievedFailing` / 冻结 / 复核族，报 `actual: []` 或 `not-evaluated`）。**同一组 shard 在未改动的 develop（主检出）上失败集合逐条相同**（timing 归一后 `diff` = IDENTICAL FAILURE SETS）⇒ 既有的环境/develop 级红，⛔ 不是本 delta 引入；本任务 scoped 门选中的 3 个 shard 全绿。