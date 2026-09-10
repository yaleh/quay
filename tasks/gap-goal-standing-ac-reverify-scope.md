---
id: gap-goal-standing-ac-reverify-scope
title: 长期保证 AC 的复验域不随 GOAL 关闭而消失——I5 checkAchievedFailing 作用域加显式声明通道，读数枚举 inScope
status: done
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
goal_ac: AC-216
---
## Proposal

正本：`goals/AC-216-长期保证-ac-的复验域不随-goal-关闭而消失-达成即停止复验会让-上移一层-变成换层藏同一缺陷.md`（GOAL-010 名下 criterion），判据 = `node --no-warnings --experimental-strip-types --test plugin/test/goal-standing-ac-reverify-scope.test.mjs` + python 半对 `.quay/goal-round.jsonl` 的生产读数。

**现状（实测，非主张）**：
- I5 `checkAchievedFailing` 作用域逐字为「achieved ACs under ACTIVE goals」（`packages/quay/src/goal-store.ts:515-540`，`if (!activeGoalIds.has(String(ac.goal))) continue;`）。GOAL 一经 I2 机械 flip achieved，其名下全部 AC 一起离开复验域，此后判据变假无人报红。
- 实证（AC-216 origin，已复核）：GOAL-007 的 AC-188/189/190 末次被评估 = `2026-09-07T20:21:30.836Z`，正是 GOAL-007 翻 achieved 那一刻；此后有 criteria 的 1419 轮里评估次数 = 0 ⇒「长期保证从 task 层上移 goal 层」只是换一层楼藏同一缺陷（AC-188 标题「能被每轮重评估」现在是假的）。
- `checkAchievedFailing` 返回值只有 `{ achievedButFailing, evaluated, scopeSize }`，**不枚举在域集合**——`goal-driver.ts` 的 fact 里 `value.achievedFailing` 没有 `inScope` 数组，外部无法枚举「到底哪些 AC 在复验域」（硬规则③枚举不布尔）。

**修法（两处源码 + 一处新测试 + 三条载体 AC 标记）**：
1. `packages/quay/src/goal-store.ts`：AC 记录支持显式「长期保证」声明——顶层 frontmatter 字段 `long-term: true` 进 `GoalFrontmatter` / `GoalViewModel` / `OWNED_KEYS`（`:98-101`）/ `toViewModel`（`:349-379`）投影，使 `goal-store list` 读回该字段。I5 作用域条件改为：**active GOAL 名下 achieved AC（不变）∪ 显式声明 `long-term: true` 的 achieved AC（其 GOAL 已 achieved/关闭也仍在域）**；未声明的按现状随 GOAL 关闭离开作用域（控成本——AC-216 origin 成本边界：51 条 achieved AC 全跑 ≈36–50s/轮，超 `drivers.yml` goal.interval_ms=30000）。并在返回值加 `inScope: string[]`（在 guard 之前的枚举位置，同现有 `scopeSize`）。`check --achieved-failing` 子命令已 `JSON.stringify(r)` 整个返回对象（`:1009`），`inScope` 自动落进 stdout JSON。
2. `plugin/scripts/goal-driver.ts`：`checkAchievedFailing` reader（`:236-253`）与 `GoalRoundReadings["achievedFailing"]`（`:594`）加 `inScope: string[]` 透传，使 fact 的 `value.achievedFailing.inScope` 落进 `.quay/goal-round.jsonl`。
3. 新建 `plugin/test/goal-standing-ac-reverify-scope.test.mjs`：双向负控制——方向①声明 `long-term: true` 的 achieved AC 其 GOAL 已 achieved ⇒ 仍在 inScope；方向②未声明的 achieved AC 其 GOAL 已 achieved ⇒ 不在 inScope（随 GOAL 关闭离开）。测作用域条件（纯函数 / 注入 records），⛔ 不跑真实 criterion。
4. 标记三条载体 AC：`goals/AC-188-goal-ac-criterion.md`、`goals/AC-189-task-goal-spec.md`、`goals/AC-190-task-ac.md` 各加顶层 `long-term: true`（GOAL-007 已 achieved、三条均 achieved、criterion 非空——正是 AC-216 origin 实证二的当事人），使生产轮记录出现 ≥1 条 inScope 含「GOAL 已 achieved 的 AC」。

⛔ 范围外（各自另有 AC，本任务不碰）：五态 draft 分诊（AC-210）；retire→needs-human 写面（AC-211）；充分性闸与 not-evaluated（AC-212/213）；交付证据新鲜度（AC-214）；posture（AC-215）。AC-214 依赖本任务落地（其 origin 明言），⛔ 本任务不反向依赖它。

## AC

- [x] `node --no-warnings --experimental-strip-types --test plugin/test/goal-standing-ac-reverify-scope.test.mjs` 退出码 0（AC-216 criterion 前半逐字）
- [x] 方向一（负控制①，声明跨 GOAL 关闭）：测试断言声明 `long-term: true` 的 achieved AC 其 GOAL 已 achieved ⇒ 在 `checkAchievedFailing` 返回的 `inScope` 里（`grep -n "inScope" plugin/test/goal-standing-ac-reverify-scope.test.mjs` 命中该断言点）
- [x] 方向二（负控制②，未声明随 GOAL 关闭）：测试断言未声明的 achieved AC 其 GOAL 已 achieved ⇒ **不在** `inScope` 里——证明「放宽作用域」不是无差别（同硬规则④推论三，两条负控制各带「改坏 ⇒ 测试红」的取假路径）
- [x] `inScope` 枚举落进生产载体：`packages/quay/src/goal-store.ts` 的 `checkAchievedFailing` 返回值含 `inScope: string[]`，`plugin/scripts/goal-driver.ts` reader 与 fact 透传之（`grep -n "inScope" packages/quay/src/goal-store.ts plugin/scripts/goal-driver.ts` 命中 ≥3 处：store 枚举 + reader 透传 + fact 类型）
- [x] 声明字段读回：`long-term` 进 `GoalFrontmatter` / `GoalViewModel` / `OWNED_KEYS` / `toViewModel`（`grep -n "long-term" packages/quay/src/goal-store.ts` 命中 ≥3 处）
- [x] 三条载体 AC 标记：AC-188/189/190 各带顶层 `long-term: true` 且 `goal-store list` 读回可见（`grep -n "long-term" goals/AC-188-goal-ac-criterion.md goals/AC-189-task-goal-spec.md goals/AC-190-task-ac.md` 各命中 ≥1）
- [ ] AC-216 criterion 后半（生产读数）exit 0：`.quay/goal-round.jsonl` 存在 ≥1 条 fact 的 `value.achievedFailing.inScope` 含某条其 GOAL 已 achieved 的 AC——读主检出生产载体、只计落地之后时间窗，⛔ 靠 fixture 注入满足 = 未完成（硬规则④推论三）。**⛔ 需本任务 fan-in 落地后主检出 goal-driver 生产轮才产出（本 worker ⛔ 不碰主检出，同 gap-ac144 先例）。**（待外部）
- [x] `node packages/quay/bin/quay.ts task check gap-goal-standing-ac-reverify-scope --json` 的 `missing` 为 `[]`


## Evidence

- AC-216 criterion 前半（单测）：`node --no-warnings --experimental-strip-types --test plugin/test/goal-standing-ac-reverify-scope.test.mjs` exit 0——3 pass / 0 fail（方向① / 方向② / baseline）。
- 实跑 inScope 枚举（worktree 真数据，`QUAY_GOAL_ACCEPTANCE_ACTIVE=1` 只枚举不跑 criterion）：`node packages/quay/src/goal-store.ts check --achieved-failing --root <worktree>` 返回 `inScope: ["AC-188","AC-189","AC-190","AC-208","AC-209","AC-210","AC-211","AC-215"]`，其中 AC-188/189/190 的 GOAL-007 已 achieved 仍在域（long-term 声明生效）；scopeSize=8。
- 生产载体透传（grep）：`grep -n inScope packages/quay/src/goal-store.ts plugin/scripts/goal-driver.ts` 命中 store 枚举(542/563/565/583)+reader(240/250)+fact 类型(711) 共 ≥3；`grep -n long-term packages/quay/src/goal-store.ts` 命中 ≥3（GoalFrontmatter/GoalViewModel/OWNED_KEYS/toViewModel/ordered-keys）。
- 三条载体 AC：`grep -n long-term goals/AC-188-goal-ac-criterion.md goals/AC-189-task-goal-spec.md goals/AC-190-task-ac.md` 各命中 ≥1（第 7 行 `long-term: true`）；`goal-store list` 读回 `longTerm: true`（AC-188/189/190）。
- typecheck：`node_modules/.bin/tsc --noEmit -p tsconfig.json` exit 0。
- AC-216 criterion 后半（生产读数）为（待外部）：`.quay/goal-round.jsonl` 是主检出生产载体、由主检出 goal-driver 每轮写——须本任务 fan-in 落地 + 主检出 sync 后才有 `value.achievedFailing.inScope` 含 GOAL 已 achieved 的 AC（本 worker ⛔ 不碰主检出，同 gap-ac144「生产载体未产出前不勾本条」先例）。
## DoD

AC-216 criterion 两半都满足：①双向负控制单测绿（声明 `long-term: true` 的 achieved AC 跨 GOAL 关闭仍在 I5 复验域、未声明的随 GOAL 关闭离开）；②生产轮记录 `.quay/goal-round.jsonl` 出现 ≥1 条 fact 的 `value.achievedFailing.inScope` 含某条【其 GOAL 已 achieved】的 AC（读主检出生产载体，只计落地之后时间窗）——证明复验在生产上真的跨过 GOAL 关闭，而非只在单测里成立（硬规则④推论三）。实跑输出贴本任务体供 fan-in 复核；改动经 fan-in 落地 develop，`git show develop:plugin/test/goal-standing-ac-reverify-scope.test.mjs` 可见该文件。⛔ 未声明的 AC 仍随 GOAL 关闭离开作用域（不无差别放宽——控成本，AC-216 origin 成本边界）。

## Touches

- packages/quay/src/goal-store.ts
- plugin/scripts/goal-driver.ts
- plugin/test/goal-standing-ac-reverify-scope.test.mjs
- goals/AC-188-goal-ac-criterion.md
- goals/AC-189-task-goal-spec.md
- goals/AC-190-task-ac.md
- tasks/gap-goal-standing-ac-reverify-scope.md
