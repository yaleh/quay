---
id: gap-goal-gapfiling-card-facing-summary
title: "gap 立案写 card-facing 决策摘要：## Needs-Human 阻碍原因 / ## Proposal 首行结论"
status: ready
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
---
## Proposal

`goalSufficiencyVerdict`（`plugin/scripts/goal-driver.ts:1182`）的两条机械 insufficient 分支——GOAL body 无非空 `## 退出条件` 节、或在域 AC 集合为空——在充分性 followup 的 gap 立案路径手里**已经算好**，`buildSufficiencyFollowupPrompt` 也已把「NONE / EMPTY」如实喂给立案 agent。但 prompt 只让 agent「quote 退出条件 + 说 why 不覆盖」，**没让它把机械根因写成一句 card-facing 的决策摘要**落到任务体。下游 cockpit 读卡时，卡出生即缺「阻碍原因」这一行，人得从 body 重新拼。本任务：在 followup prompt 里加一条指令，让立案 agent 把「GOAL-<id> 充分性 insufficient：正文缺非空 ## 退出条件 节」或「GOAL-<id> 充分性 insufficient：在域 AC 集合为空」（`<id>` 用真实 GOAL id 替换）写进任务体 `## Needs-Human`（`阻碍原因：…`）或 `## Proposal` 首行。零 LLM（句子按机械分支选定，不生成）、不改 reader（只动 prompt 文本与测试）。

## Plan

1. 在 `buildSufficiencyFollowupPrompt` 的 "Your job" 段新增指令：立案任务体必须携带 card-facing 摘要——二选一：(a) `## Needs-Human` 节含一行 `阻碍原因：<句子>`；(b) `## Proposal` 首行即 `<句子>`。句子按机械分支确定：无退出条件 ⇒「GOAL-<id> 充分性 insufficient：正文缺非空 ## 退出条件 节」；零在域 AC ⇒「GOAL-<id> 充分性 insufficient：在域 AC 集合为空」。`<id>` 用 prompt 已有 `goal_id` 真实值。
2. 在 `plugin/test/goal-sufficiency-followup.test.mjs` 补断言：机械 insufficient 两样例（无退出条件 / 零在域 AC）的 prompt 输出各含对应句子（GOAL id 已替换），且 prompt 点名 `## Needs-Human` 与 `## Proposal`；端到端 `runGoalRound` 机械 insufficient 样例捕获的真实 filed prompt 也含对应句子。
3. 跑 scoped 测试全绿 + schema/task 自检，落地提交。

## AC

- [x] 分支①：`buildSufficiencyFollowupPrompt({id:'GOAL-018',title:'t',body:'## body\nx'},[],'/tmp/r',1)` 输出含 `GOAL-018 充分性 insufficient：正文缺非空 ## 退出条件 节`（由新增单测断言，机械可查）。
- [x] 分支②：`buildSufficiencyFollowupPrompt({id:'GOAL-005',title:'t',body:'## 退出条件\n\n1. x\n'},[],'/tmp/r',1)` 输出含 `GOAL-005 充分性 insufficient：在域 AC 集合为空`。
- [x] prompt 输出同时点名 `## Needs-Human` 与 `## Proposal`（各 `String.includes` 为真，单测断言）。
- [x] `node --no-warnings --experimental-strip-types --test plugin/test/goal-sufficiency-followup.test.mjs` exit 0。
- [x] `node plugin/scripts/task-schema-check.ts tasks/gap-goal-gapfiling-card-facing-summary.md` exit 0 且 `node packages/quay/bin/quay.ts task check gap-goal-gapfiling-card-facing-summary --json` 的 `missing` 为 `[]`。

## DoD

`buildSufficiencyFollowupPrompt` 是生产函数（followup agent 经 `buildSufficiencyFollowupArgv` 收到的正是它的返回串），改动后其真实输出携带 card-facing 指令与两条分支句子；`plugin/test/goal-sufficiency-followup.test.mjs` **直接 import 该函数**断言（非 fixture 注入、非只测「能产出」），且 `runGoalRound` 端到端样例捕获的真实 filed prompt 也含该句子；scoped 测试在真实 suite 入口 `scripts/test.sh` 下绿；落地提交 `git show --stat HEAD` 仅含 `plugin/scripts/goal-driver.ts`、`plugin/test/goal-sufficiency-followup.test.mjs` 与本任务自身，无 reader/consumer 侧文件改动。

## Touches

- plugin/scripts/goal-driver.ts
- plugin/test/goal-sufficiency-followup.test.mjs
- tasks/gap-goal-gapfiling-card-facing-summary.md

## ADR-007 暗轴

该轴仍暗,理由:仅改 prompt 文本与单测，未触碰依赖结构/目标闭包轴