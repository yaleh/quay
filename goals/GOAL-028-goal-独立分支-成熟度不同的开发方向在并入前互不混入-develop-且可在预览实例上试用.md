---
id: GOAL-028
title: goal 独立分支——成熟度不同的开发方向在并入前互不混入 develop，且可在预览实例上试用
status: draft
kind: goal
origin: 人 2026-10-01「为 goal 提供一个单独的 branch」→ 三轮讨论成文
  orchestration/SPEC-goal-branch-2026-10-03.md（d4b7ca1c2，裁定①–㉓）；人
  2026-10-03「按上面的建议，新建一个 GOAL，同时手工预先立好 §10 的任务」。
---
## 背景

正本：`orchestration/SPEC-goal-branch-2026-10-03.md`（提交 `d4b7ca1c2`，状态 ruled，人裁定 ①–㉓）。

现状：所有任务都直接 fan-in 到 `develop`。几个开发方向并行时，它们的变更在 develop 上交替出现，无法区分；一个方向的半成品与其它方向混在同一条将要发布的线上。实测（SPEC §2.1，`develop` 上 2026-09-03 起的机械 fan-in 翻 done 提交）：305 条带 `goal_ac` 的落地分属 23 个 GOAL，按时间排成 **138 个同 goal 连续段**（平均每 2.2 条被别的方向打断一次）；有落地的 22 天里 **17 天**有 ≥2 个方向同日混入。

本 GOAL 把 SPEC 的机制落地：goal 可 opt-in 一条 `goal/<GOAL-NNN>` 分支；它的任务先 fan-in 到该分支并每次追平 develop；人在该 goal 的预览实例上试用，pre-merge AC 也在那里求值；人触发后由 worker-driver 以 `--no-ff` 合并提交整体并入 develop；之后照现有机制走到 achieved。

## 范围与非目标

范围（每项对应 AC）：
① 隔离：branch-mode goal 的任务落地不出现在 develop 的 first-parent 链上——**AC-321**；
② 追平：每次 goal 分支落地都包含其追平时刻的 develop——**AC-322**；
③ 不重派：落到 goal 分支的任务不再被派发（`done` = 已落到 mergeTarget + 状态双写）——**AC-323**；
④ 并入前可见：pre-merge AC 在并入前就能被判为 pass（判据在 goal 的判据 worktree 上求值）——**AC-324**；
⑤ 人工并入：develop 上每个 goal 合并提交都有一条先于它的人工并入请求，且 goal 的 achieved 晚于并入——**AC-325**；
⑥ 废弃：被 retired/superseded 的 branch-mode goal 分支已删除，被丢弃的 tip SHA 留在 statusLog——**AC-326**；
⑦ 混入度：每个并入的 goal 在 develop first-parent 链上恰为一个提交——**AC-327**；
⑧ 并入前试用：live-probe 类 pre-merge AC 在预览实例上 pass 之后才并入——**AC-328**。

非目标（⛔ 有意排除）：
- 本 GOAL 自身**不开** branch 模式：功能尚不存在，且它改的是 driver/循环机制本身（SPEC §4.10 末：这类 goal 开分支得不到试用价值）。承载任务照常直落 develop。
- 嵌套分支、goal 分支之间的相互依赖、自动救援 cherry-pick、影子工作区（独立 clone + 全套 driver）——SPEC §8。
- 不改 release / hotfix / master 规则；不改未 opt-in 的 goal 与无 `goal_ac` 任务的行为。

## 判据形态

- 8 条判据全部读**生产载体**（硬规则 4 推论三）：git 提交图与 `develop` reflog、`goals/*.md` frontmatter、`.quay/gate-events.jsonl`、`.quay/worker-round.jsonl` 的 `in_flight_task_starts`。⛔ 没有一条读夹具或注入数据。
- **三态**：exit 0 = 成立；exit 1 = 违反，同一行输出 `CAUSE=`；exit 3 = 未评估（无 branch-mode goal / 尚无落地 / 尚无并入 / 载体缺字段）。**在第一个试点 goal 跑起来之前，全部 8 条读 exit 3 是正确输出，不是缺陷。**
- 识别规则（判据与实现之间的契约，实现须遵守）：branch-mode = goal frontmatter 中独立一行 `branch: true`；opt-in 时刻 = 首次引入该行的提交时间（`git log -S`）；任务落地 = 现有 `flipTaskDone` 的提交消息 `tasks: 翻 <id> done（driver 机械 fan-in）`；goal 合并提交 = develop first-parent 上 subject 含 `goal/GOAL-NNN` 的 merge commit；人工并入请求 = gate-events 中 `gate: "goal-merge-request"`、`item_id: GOAL-NNN`；预览求值根 = goal gate 事件 `payload.evaluationRoot`。
- 落笔当轮的读数（2026-10-03，主检出，`/bin/sh` 执行）：8 条全部 exit 3。每条的通过臂与违反臂都在合成 git 仓库上实跑过（可控的提交与 reflog 时间）：AC-321/327 直落 develop 的任务 ⇒ exit 1；AC-322 不追平 ⇒ exit 1；AC-323 落地后再派发 ⇒ exit 1；AC-324 并入前无 pass ⇒ exit 1；AC-325 无请求 / achieved 早于并入 ⇒ exit 1；AC-326 分支未删 / 未记 SHA ⇒ exit 1；AC-328 求值根为主检出 ⇒ exit 1；各自的通过场景 exit 0。
- ⚠️ 已知局限：AC-322 依赖 `develop` 的 reflog（默认 90 天过期）；过期后读不到的落地被跳过，全部读不到时 exit 3，⛔ 不会误判通过。AC-328 用判据文本含 `quay.ts serve` 选出 live-probe 样本——这只用于选样本，不用于给 AC 分相（分相靠显式 `phase` 字段，SPEC §4.7）。

## 退出条件

8 条 AC 全部 achieved，且以下两个人的动作已发生（它们是 AC 能取到 exit 0 的前提，goal-driver 不会替人完成——实现任务全部 done 而试点未跑时，各 AC 会停在 exit 3）：
1. **试点**：人选一个真实的较大改进（建议带 Web UI 面，能用上预览实例），对其 goal 设 `branch: true` 并走完「任务落地 → 预览试用 → `quay goal merge` → 并入」一轮——使 AC-321..325/327/328 取到真实读数；
2. **废弃演练**：人对一个小的 branch-mode goal 执行一次 retired（或 superseded）——使 AC-326 取到真实读数。

## 承载 task

AC-321 ← `gap-goal-branch-dispatch-wiring-and-task-fan-in`；AC-322 ← `gap-goal-branch-antidrift-two-line-base`；AC-323 ← `gap-goal-branch-done-means-landed-on-merge-target`；AC-324 ← `gap-goal-branch-criteria-evaluated-on-goal-worktree`、`gap-goal-branch-ac-phase-field-and-split-evaluation`；AC-325 ← `gap-goal-branch-human-merge-verb-and-execution`；AC-326 ← `gap-goal-branch-data-model-and-lifecycle`；AC-327 ← `gap-goal-branch-ff-merge-source-param`；AC-328 ← `gap-goal-branch-reaper-accepts-preview-serve`、`gap-goal-branch-gate-event-evaluation-root`、`gap-goal-branch-preview-instance`。依赖顺序见各任务的 `depends_on`（SPEC §10：B1/B2 落地前 ⛔ 不接线）。
