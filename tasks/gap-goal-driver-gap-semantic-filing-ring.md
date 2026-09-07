---
id: gap-goal-driver-gap-semantic-filing-ring
title: goal-driver 缺口语义环 —— 派短命 agent 经 ABI 立案，下一轮以 taskCount 独立复核
status: todo
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
---
## Proposal

判据正本：`goals/AC-185-*.md`。SPEC 正本：`orchestration/SPEC-goal-mechanism-2026-09-06.md`（本任务为其 **G9** 期）。

**问题（立案当轮实测，非引用旧结论）**：`goal-driver.ts` 408 行**零 LLM 路径**——`:89`/`:113` 的 `spawn` 全是机械 node 子进程（跑 criterion / 写 status）。缺口环因此**只报不立**：GOAL-003 激活后 `gaps: 11` 会一直报着，目标不会自己前进。`:19` 的「⛔ 不机械写 `tasks/*.md`」是「**driver 自己不得手写任务文件，立案要走语义 agent 经 ABI**」，同一行写着「缺口立案属 G7 的语义环，**本期不做**」——延后不是禁止。

**四块拼图已有三块，缺的只是 spawn 那一半**：

| 部件 | 现状 | 位置 |
|---|---|---|
| 结构化输入 | ✅ | `computeGoalGaps:193` 产出 `{goal, ac, state, taskCount}`，三态含 `not-evaluated`（`taskFacts === null` 时不与合格同形） |
| 独立复核面 | ✅ | `readTaskFacts:138` 按 G7 的 `goal_ac` 计数 ⇒ 「agent 到底立没立」可在下一轮机械回答，**不读 agent 自述** |
| 派发形态先例 | ✅ | `promotion-driver.ts` 的 `spawnFixWorker`：捕获 stdout/stderr/timeout、`--fix-worker-cmd` 测试缝、spawn 前过 `resourceGateCheck`（AC150-1）、halt 读控制态（AC150-2）、`llm_invoked` 派生自真实 argv（AC140-4）；纪律逐字「spawn 即达成；⛔ 不验证修没修好；⛔ 不信 worker 自述」（AC132/AC133） |
| spawn 半边 | ❌ | 本任务 |

**照现成形态实现，不发明新形态**：缺口非空 ⇒ 过资源门与 halt ⇒ 按每轮上限派短命 agent（结构化缺口清单作输入，经 ABI 立案）⇒ 轮记录写 `spawned` 计数与 `llm_invoked` ⇒ **下一轮**同一条 AC 的 `taskCount` 由 0 变 ≥1 即闭环。

**顺带校正一处漂移**：SPEC §7 的分期→AC 映射与 `goals/` 记录标题**对不上**（表写 G6→AC-176 / G7→AC-177 / G8→AC-178，而记录标题分别是「G6 goal driver…」=AC-177、「G7 goal ↔ task…」=AC-178、「G8 dashboard…」=AC-179）。记录是正本（G3 已断散文权威），本任务加 G9 行时一并把该表对齐记录。

**⛔ 不越界**：只加「缺口非空 ⇒ 派 agent 立案」这一个环。`draft→active` 激活与 `active→retired` 放弃仍是人的裁定；driver 仍不直接改 task 状态、不自己手写 `tasks/*.md`。

## AC

- [ ] **AC-185 正本判据**退出码 0：生产载体 `.quay/goal-round.jsonl` 中存在两轮 R1 < R2 —— R1 某条 AC `state=gap` 且该轮 `spawned > 0`，R2 同一条 AC `state=in-progress`
- [ ] 负控制（证明上一条非恒真）：把派发命令换成不立案的命令后，同一判据退出码非 0
- [ ] halt 能取假：`.quay/goal-control.json` 置 halted ⇒ 该轮轮记录 `spawned == 0`
- [ ] 资源门能取假：`resourceGateCheck` 判 WAIT ⇒ 该轮 `spawned == 0`（复用 worker/promotion 同一判定，⛔ 不另写一套）
- [ ] 每轮 spawn 上限**读配置而非字面量**：改 `drivers.yml` 中该值后，实测同一轮的 `spawned` 随之改变（硬规则 4 推论二：写死的数字换台机器就失效）
- [ ] `llm_invoked` **派生自真实 argv**：把派发命令换成非 LLM 命令 ⇒ 该轮 `llm_invoked` 为 false（⛔ 不得硬编码为 true）
- [ ] SPEC §7 新增 G9 行，且该表分期→AC 映射与 `goals/` 记录标题逐条一致（G6→AC-177、G7→AC-178、G8→AC-179、G9→AC-185）
- [ ] scoped 门 `bash scripts/test.sh --for-task gap-goal-driver-gap-semantic-filing-ring --allow-thin` 退出码 0

## DoD

**生产上真的发生过一次闭环**，而非仅测试绿：`.quay/goal-round.jsonl` 里能指出具体两轮 —— 前一轮派了 agent（`spawned > 0`）、后一轮某条原为 `gap` 的 AC 变成 `in-progress`，且这条 AC 对应的 `tasks/*.md` 确实带 `goal_ac` 顶层字段、可被 `grep -l '^goal_ac:'` 机械枚举。反例判据（硬规则 4 推论三）：若把派发测试缝关掉后该 DoD 仍能满足，它才是测量；只由 fixture 构造的轮记录满足的不算。上限旋钮与 halt/资源门三条负控制各留一份实跑输出在任务体，供 fan-in 复核。

## Touches

- plugin/scripts/goal-driver.ts
- plugin/test/goal-driver.test.mjs
- plugin/scripts/drivers.yml
- orchestration/SPEC-goal-mechanism-2026-09-06.md
- tasks/gap-goal-driver-gap-semantic-filing-ring.md
