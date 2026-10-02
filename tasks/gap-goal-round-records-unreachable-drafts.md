---
id: gap-goal-round-records-unreachable-drafts
title: draft GOAL 及其名下 draft AC 在任何轮记录 field 里都不存在——goalCount 只数 active，分诊只收
  active GOAL 名下的 draft，该形态被静默吞掉
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
## Finding

`plugin/scripts/goal-driver.ts` 的两个既有读数都不覆盖「draft GOAL 名下的 draft AC」：`goalCount` 只数 `status === "active"` 的 GOAL；`triage` 的对象集是 **active GOAL 名下**的 draft AC（同文件 `:2254-2256` 的文档注释），且 ⑧ 只消费 `activate`；`computeGoalGaps` 只数 active AC；`closeBlocks` 只见 active GOAL。⇒ **draft GOAL 连同它吞掉的 N 条 AC 不出现在任何 field 里**，「被静默吞掉」与「不存在」同形（硬规则 3b）。

**实测代价（2026-10-02，`/data/home/yale/work/quay`）**：GOAL-026（4 条 AC）+ GOAL-027（3 条 AC）自 2026-09-21 / 09-23 起被静默吞着。人工 `quay goal write <id> --status active --reason …` 激活后：`goalCount 2→4`、`criterionCount 43→50`、`triage 0→7`（全判 activate），**7 条里 6 条立即 pass**——工作早已做完，只是从未被判定；GOAL-026 随即 achieved。

**Fix already implemented（描述它，不重规划）**：`plugin/scripts/goal-driver.ts` 新增纯读数 `value.unreachableDrafts = { goals: string[]; acs: string[]; evaluated: boolean }`——`goals` = draft GOAL 的 id（`kind=goal ∧ status=draft`）；`acs` = 父 GOAL ∈ `goals` 的 draft AC 的 id（`kind=criterion ∧ status=draft ∧ goal` 指向 draft GOAL）；`evaluated` 恒 true 且只在 `records` 读取成功后构造（读不到时整轮走 list-failed 分支、`value` 不构造、本字段不出现）。⛔ 不改任何 spawn / flip / 分诊判定。

## AC

- [x] AC1（能取假，突变对照）：把 `value` 里的 `unreachableDrafts` 去掉 ⇒ `plugin/test/goal-triage.test.mjs` 中「draft GOAL 名下的 draft AC 出现在 value.unreachableDrafts」这一条转红，其余条不受影响。（改掉字段名或删字段 ⇒ 必须红）
- [x] AC2（负控制）：挂在 **active** GOAL 名下的 draft AC ⛔ **不得**进 `unreachableDrafts`（它是分诊对象集成员，那条路径负责它）；反向：draft GOAL 名下的 draft AC ⛔ **不得**出现在 `triage`。
- [x] AC3（无回归）：`node --test plugin/test/goal*.test.mjs` 全绿（实现时实测 234/234）。
- [x] AC4（读生产载体，落地后才能满足）：`<root>/.quay/goal-round.jsonl` 的最新轮 `facts[]` 中 `goal-ring` 的 `value.unreachableDrafts` 字段存在且 `evaluated === true`。（待外部）

## DoD

真实落地判据不是「fixture 用例绿」：本任务落地后，新读数必须在**一次真实生产轮**里出现——本仓 `<root>/.quay/goal-round.jsonl` 最新轮的 `goal-ring` fact 携带 `value.unreachableDrafts.evaluated === true`，并枚举出 draft GOAL 及其名下 draft AC。此后「一个 draft GOAL 连同它吞掉的 N 条 AC」不再与「不存在」同形；fixture 只能证明「能产出该读数」，不足以证明「生产已产出」（硬规则 4 推论三）。

## Touches

- plugin/scripts/goal-driver.ts
- plugin/test/goal-triage.test.mjs
- tasks/gap-goal-round-records-unreachable-drafts.md

## 执行期记录（执行者，2026-10-02）

**AC1 突变对照（实测）**：`cp` 备份 `plugin/scripts/goal-driver.ts` 后，删掉 `return {…}` 里的 `unreachableDrafts,` 一行 ⇒ `node --test plugin/test/goal-triage.test.mjs` 得 **7 pass / 1 fail**，唯一转红的正是新增那条；`cp` 还原后 8/8 绿。

**AC2 负控制突变对照（实测）**：把 `acs` 的筛选条件从 `isAc ∧ status=draft ∧ 父GOAL ∈ draftGoalIds` 放松为 `isAc ∧ status=draft` ⇒ 同一条转红——证明负控制断言 `!u.acs.includes('AC-900')` 非空转（fixture 里 `acs` 同时含 AC-912/AC-913，筛选确有区分力）。

**AC3**：`node --test plugin/test/goal*.test.mjs` ⇒ **240 pass / 0 fail**（develop 合并后计数由授权时记录的 234 增至 240）。⚠️ 必须在**干净 env** 下读：本 worker 会话进程自带 `QUAY_GOAL_ACCEPTANCE_ACTIVE=1`，未清时该族 **43 红**，`env -u QUAY_GOAL_ACCEPTANCE_ACTIVE` 后 **0 红** —— 红全部是 env 污染，与本 delta 无关（`scripts/test.sh` 入口已 unset 该变量，故 scoped 门不受影响）。

**scoped 门**：`bash scripts/test.sh --for-task gap-goal-round-records-unreachable-drafts --allow-thin` ⇒ **exit 0 绿**（8/8）；已写 scoped-gate-cache，developSha `a4e358c6e`。

**AC4（待外部，落地后复核）**：本轮读 `<root>/.quay/goal-round.jsonl` 最新轮（`2026-10-02T02:13:44Z`）的 `goal-ring` fact，`value` 键表**不含** `unreachableDrafts` —— 符合预期：本 delta 尚未落地，生产跑的是 develop 上的旧代码。落地并经过一次真实生产轮后，该字段应以 `evaluated === true` 出现（并枚举 draft GOAL 及其名下 draft AC）。
