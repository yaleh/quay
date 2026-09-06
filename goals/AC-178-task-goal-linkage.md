---
id: AC-178
title: G7 goal ↔ task 关联落地，缺口计算成为机械量
status: achieved
kind: criterion
goal: GOAL-001
criterion: |
  test "$(grep -l '^goal_ac:' tasks/*.md | wc -l)" -ge 3
expect: exit 0（≥3 个真实任务声明了所属 AC）
origin: |
  没有关联，"哪条 AC 没有任何任务在推进"只能靠 LLM 语义匹配；
  有了它就是纯机械计数，driver 的缺口环才可能是机械的。
  字段放顶层而非 extra 嵌套的依据：depends_on 的既有教训——
  嵌在 extra 里的 depends_on 被 parseTask 失读（返回空字符串）。
evidence:
  at: 2026-09-06T22:29:18.455Z
  verdict: pass
  reading: acceptance passed (exit 0)
---

**判据（能取假）**：至少 3 个 `tasks/*.md` 在 frontmatter 顶层声明 `goal_ac:`。

**取假**：今天必假（该字段不存在）。

**字段定义**：`goal_ac: AC-170`，**可选**、**单向**（任务侧写）、**顶层**。

- **可选**：`gap-*` 缺陷任务不属于任何 goal，不填。⇒ goal 的进度**不能**靠 children 数量算，
  只能靠它自己的 AC——这反而是对的：**AC 是一等公民，任务只是达成手段**。
- **单向**：只在任务侧写，goal 侧不列 children ⇒ **无双向同步 ⇒ 无漂移面**
  （本仓反复强调的 single source of truth）。
- **顶层**：见 `origin` 的 `depends_on` 教训。

**缺口判据（driver 的机械量）**：
对每条未达成 AC，`count(task where goal_ac == AC and status ∈ {todo, ready, in-flight}) == 0` ⇒ 缺口。

**语义环（缺口非空时）**：driver 算出**结构化清单** → spawn 短命 agent 经 ABI 立案 children。
**driver 只记 `spawned: true`，不信 agent 自述**，下一轮用 `task_list` 独立复核——
照 `promotion-driver.ts:210-266` fix-worker 的现成模式，`:243-247` 明写该纪律。

**改动面**：`plugin/scripts/task-schema.ts` + `packages/quay/src/abi.ts`
+ 两个 provider 的 store + `docs/references/task-schema-canonical.md`。
