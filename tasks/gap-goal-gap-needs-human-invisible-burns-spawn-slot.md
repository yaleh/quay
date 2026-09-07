---
id: gap-goal-gap-needs-human-invisible-burns-spawn-slot
title: 缺口计算只认 todo|ready ⇒ 关联任务翻 needs-human 后该 AC 永远报 gap 而非 stalled，环启动后已为
  AC-158 空派 10 轮、每轮占掉 spawn_cap 的 1/3
status: done
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: execution
goal_ac: AC-185
---
## Proposal

`computeGoalGaps`（`plugin/scripts/goal-driver.ts:340`）的 `associated` 过滤写死为
`t.status === "todo" || t.status === "ready"`，`needs-human` 不在其中。后果链：一条 active AC 的
唯一关联任务翻到 `needs-human` ⇒ `associated` 为空 ⇒ `count === 0` ⇒ 该 AC 报 `gap`（而不是
`stalled`）⇒ G9 语义环的选取面 `:513 gaps.filter((g) => g.state === "gap")` 每轮都把它选中 ⇒
派一个短命 gap-filing agent ⇒ agent 按 `quay-file-task` 的按机制去重（prompt 里明确 "ANY status,
including needs-human"）找到既有任务、正确地不立案 ⇒ 下一轮完全重演。

**实测发生率（硬规则 12，查历史不等下一轮）**：环于 2026-09-07T11:47:34Z 起在 `.quay/goal-round.jsonl`
留痕，此后**有 spawn 的轮里 AC-158 有 10 轮处于 `gap`**；其唯一关联任务
`gap-ac158-execute-archive-batch-one` 自始为 `needs-human`。`drivers.yml` 的 `goal.spawn_cap`
当前为 3 ⇒ **每轮 1/3 的立案配额被一个结构上不可能立案的缺口吃掉**，且 `needs-human` 无自动恢复
路径 ⇒ 该配额永不释放。

**与已实现的 `stalled` 第四态的关系（这是它漏掉的镜像半边，硬规则 5b）**：G9 已落地的 `stalled`
（`:345`）覆盖「任务**仍在** todo/ready 但过不了晋升门」；本缺口是「任务**已离开** todo/ready，
故连 `associated` 都进不去」。两者同一根因——判「有没有人在做」时把状态过滤和能否前进混在一起。

**修法方向**：把 `needs-human` 纳入 `associated`，并判为 `stalled`（有处理者、但不能自行前进），
⛔ 不是放宽 `gap` 的定义、也不是在选取面加一层排除名单——后者会让 `taskCount` 继续说谎（读数为 0
而实际有 1 条任务），违反硬规则 4b（代理量偏离直接量）。`done`/`superseded` 仍不计入（那是真的
没有在做的任务，`gap` 正确）。

## AC

- [x] **needs-human ⇒ stalled**：关联任务全为 `needs-human` 的 active AC，`computeGoalGaps` 输出
      `state === "stalled"` 且 `taskCount` 等于该 AC 的 needs-human 任务数（**不再是 0**）。单测直接
      `import { computeGoalGaps }`，构造 taskFacts 含 `{goalAc:"AC-X", status:"needs-human"}`，
      断言 `{state:"stalled", taskCount:1}`
- [x] **负控制（判据能取假，三态互不相同）**：同一 fixture 把该任务 status 改成 `ready` 且 judgment
      判其可晋升 ⇒ `state === "in-progress"`；把 taskFacts 换成不含该 goalAc 的任务 ⇒
      `state === "gap"` 且 `taskCount === 0`。三次断言的 state 必须两两不等
- [x] **`done` 不被误纳**：关联任务全为 `done` 的 active AC 仍报 `gap`、`taskCount === 0`
      （负控制：确认改动只放开 `needs-human`，没有顺手放开全部非 todo/ready 状态）
- [x] **stalled 不再消耗 spawn 名额**：`:513` 的选取面对含 `stalled` 的缺口列表返回**不含**该 AC 的
      候选集。单测断言选取结果的 `ac` 集合与仅 `state==="gap"` 的子集逐一相等
- [x] **`not-evaluated` 保留（硬规则 3b）**：`taskFacts === null` 时仍逐条 `not-evaluated`，不因本
      改动退化成 `stalled` 或 `gap`
- [ ] **生产载体验证（硬规则 4 推论三，只计实现落地之后的时间窗）**：实现落地提交之后写入的（待外部）
      `.quay/goal-round.jsonl` 记录中，**至少一轮**存在 `{ac:"AC-158", state:"stalled", taskCount:1}`，
      且该轮的 gap-filing spawn 未包含 AC-158。判据脚本须按 `ts > <实现落地提交时刻>` 过滤，落地前的
      轮一律不算（否则它只证明「能产出」不证明「已产出」）

## DoD

**不是「单测绿」**：生产上 goal-driver 真的跑过一轮，且那一轮的 `.quay/goal-round.jsonl` 记录里
AC-158 报 `stalled`（`taskCount: 1`）并且**没有为它派 agent**——即 spawn_cap 的那 1/3 名额被真实
释放、可用于其它缺口。同时 `scripts/test.sh --for-task gap-goal-gap-needs-human-invisible-burns-spawn-slot`
的 scoped 门退出 0。fixture 与注入数据是必要不充分条件（DIR-026 Reading A）。

## Touches

- plugin/scripts/goal-driver.ts
- plugin/test/goal-driver.test.mjs
- tasks/gap-goal-gap-needs-human-invisible-burns-spawn-slot.md