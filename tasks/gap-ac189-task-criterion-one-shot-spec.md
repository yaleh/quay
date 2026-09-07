---
id: gap-ac189-task-criterion-one-shot-spec
title: 把「task 层判据是一次性的、需长期维持的保证上移 goal 层」写进 SPEC 正本（标题含 task 层判据、正文含 上移+goal
  层、≥200 非空白字符）
status: done
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
goal_ac: AC-189
---
## Proposal

正本：`goals/AC-189-task-goal-spec.md`（判据）+ `goals/GOAL-007-done-fixture.md`（层级不对称段原文）。

AC-189 判据当前取假（2026-09-07 干跑：`awk` 在 `orchestration/SPEC-goal-mechanism-2026-09-06.md` 里找不到标题含「task 层判据」的章节，exit 1）。人已裁定方向【丁：不修，上移 goal 层】（AC-189 origin 逐字）：承认 task 层判据是一次性的，把需长期维持的保证显式上移为 goal 层 AC（goal-driver 每轮约 42s 已对其跑 gateCriterion）。GOAL-007「层级不对称」段逐字记录根因：goal 层每轮对每条 active AC 跑 gateCriterion 并报 achieved-but-failing，task 层的 extra.acceptance 只在 fan-in 当轮跑一次、此后再不重跑，「能取假」的负控制当轮验证一次即被丢弃。这条不对称必须进正本，否则它只活在一次对话里。

范围边界（AC-189 origin 已划清）：本任务只写 SPEC 正本一节（标题含「task 层判据」、正文显式含「上移」与「goal 层」、非空白字符 ≥200）。不创建新的 goal 层 AC（那是 AC-188 已立任务 gap-ac188-three-long-term-guarantee-goal-acs）、不查这些 AC 是否跑过（AC-191）、不处理 achieved-but-failing（已有 handler）。

## Plan

1. 读 `orchestration/SPEC-goal-mechanism-2026-09-06.md` 现有章节（§0–§10），确定新节插入位置（放在 §6 driver 设计之后、§7 分期与验收之前；以不破坏 §7 分期表里各 AC 编号引用为准）。
2. 从 `goals/GOAL-007-done-fixture.md`「层级不对称」段与 `goals/AC-189-task-goal-spec.md` origin 提炼条文：task 层判据一次性、goal 层每轮再评估、需长期维持的保证上移 goal 层。
3. 写入新节：标题形如 `## N. task 层判据是一次性的，需长期维持的保证上移 goal 层`（含「task 层判据」）；正文显式写「上移」与「goal 层」，记录层级不对称根因与「丁」对甲/乙/丙的取舍。
4. 干跑 AC-189 判据确认 exit 0、非空白字符 ≥200；负控制：改动前已实测 exit 1（章节不存在），完成前后读数不同 ⇒ 排除恒真。
5. 确认落点合规：CLAUDE.md 头部逐字「它的行数是本仓库最稀缺的资源」——本条是机制细节，写 SPEC 正本而非 CLAUDE.md，正符 AC-189 origin 的落点裁定。

## AC

- [x] AC-189 判据 exit 0：`awk '/^##.*task 层判据/'` 命中一节，其正文含「上移」与「goal 层」，非空白字符 ≥200
- [x] 可证伪性（硬规则④）：改动前干跑 exit 1（章节不存在）已记录，完成前后读数不同，排除恒真
- [x] 落点在 `orchestration/SPEC-goal-mechanism-2026-09-06.md` 而非 CLAUDE.md（守 CLAUDE.md 头部「行数稀缺」纪律）
- [x] 新节编号与现有 §0–§10 不冲突（`grep -n '^## '` 无重复编号），SPEC 结构自洽
- [x] `node packages/quay/bin/quay.ts task check gap-ac189-task-criterion-one-shot-spec --json` 的 `missing` 为 `[]`

## DoD

`orchestration/SPEC-goal-mechanism-2026-09-06.md` 新增一节，AC-189 判据在生产工作树上 exit 0（章节存在 + 正文含「上移」+「goal 层」+ 非空白字符 ≥200）——不是靠 fixture 注入，而是对真实 SPEC 文件跑 awk/grep 读出的真值。仅口头声称已写而判据仍 exit 1、或章节 <200 字符（一个标题加一句话）⇒ 不算完成。

## Touches

- orchestration/SPEC-goal-mechanism-2026-09-06.md
- tasks/gap-ac189-task-criterion-one-shot-spec.md
