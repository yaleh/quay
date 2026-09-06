---
id: AC-173
title: G3 断权威——manager-phase-goal.md 降级为归档，prompt 指针改读 store
status: achieved
kind: criterion
goal: GOAL-001
criterion: |
  grep -qE 'goals/|goal list|goal-store' orchestration/manager-tick-prompt.txt \
    && head -14 orchestration/manager-phase-goal.md | grep -q 'goals/'
expect: exit 0
origin: |
  规格 §7.1 与 GOAL-001 风险 1：上一次 goal-store 死于"散文继续是权威且编辑它零摩擦"。
  两个来源并存必然漂移——manager-phase-goal.md 自己就有实证：顶部横幅曾写死
  「AC54–AC78」并过期，2026-08-25 e389d3e58 才改成结构性描述。
evidence:
  at: 2026-09-06T22:24:12.615Z
  verdict: pass
  reading: acceptance passed (exit 0)
---

**判据（能取假）**：①`manager-tick-prompt.txt` 已指向 store；
②`manager-phase-goal.md` 顶部横幅（前 14 行）已声明正本在 `goals/`。

**取假**：今天两条都假。`manager-tick-prompt.txt:1` 现文为
「(3) orchestration/manager-phase-goal.md 拿当前阶段目标与 AC」，无任何 store 指向。

**待 repoint 的四处**（规格 §9）：`manager-tick-prompt.txt:1`、
`manager-loop-tick.md:66,80`、`manager-tick-core.md:33`（A20「每轮推进一条阶段 AC」）、
`REVIEW-cadence.md:27,93,155`。

**⛔ 文件不能删**：`outer-anchor-check.ts:81` 与 `manager-anchor-check.py:32` 要求它存在
⇒ 只能降级为归档。

**⚠️ 连带影响**：`integration-batch-merge.test.mjs:482,535-549` 拿该文件当
「manager 未提交编辑必须被 batch-merge 拒绝」的 fixture。文件停止被编辑后需换 fixture，
否则该测试失去承重面（**它会继续绿，但测的东西不再发生**——硬规则 4）。
