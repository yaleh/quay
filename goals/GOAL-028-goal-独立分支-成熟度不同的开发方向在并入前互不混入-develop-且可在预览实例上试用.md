---
id: GOAL-028
title: goal 独立分支——成熟度不同的开发方向在并入前互不混入 develop，且可在预览实例上试用
status: achieved
kind: goal
origin: 人 2026-10-01「为 goal 提供一个单独的 branch」→ 三轮讨论成文
  orchestration/SPEC-goal-branch-2026-10-03.md（d4b7ca1c2，裁定①–㉓）；人
  2026-10-03「按上面的建议，新建一个 GOAL，同时手工预先立好 §10 的任务」。
activatedAt: 2026-10-03T07:49:29.821Z
statusLog:
  - at: 2026-10-03T07:49:29.821Z
    from: draft
    to: active
    actor: cli
    reason: 人 2026-10-03 裁定立条并激活（「新建一个 GOAL，同时手工预先立好 §10 的任务」）：11
      个承载任务已立，AC-321..328 各有至少一个 goal_ac 关联任务，激活不会触发乱序自动立案；draft GOAL 名下的 AC
      不在分诊对象集内，故须显式激活
  - at: 2026-10-03T20:30:12.328Z
    from: active
    to: achieved
    actor: goal-driver
    reason: "I2: all ACs achieved + sufficiency covered"
---
## 背景

正本：`orchestration/SPEC-goal-branch-2026-10-03.md`（提交 `d4b7ca1c2`，状态 ruled，人裁定 ①–㉓）。

现状：所有任务都直接 fan-in 到 `develop`。几个开发方向并行时，它们的变更在 develop 上交替出现，无法区分；一个方向的半成品与其它方向混在同一条将要发布的线上。实测（SPEC §2.1，`develop` 上 2026-09-03 起的机械 fan-in 翻 done 提交）：305 条带 `goal_ac` 的落地分属 23 个 GOAL，按时间排成 **138 个同 goal 连续段**（平均每 2.2 条被别的方向打断一次）；有落地的 22 天里 **17 天**有 ≥2 个方向同日混入。

本 GOAL 把 SPEC 的机制落地：goal 可 opt-in 一条 `goal/<GOAL-NNN>` 分支；它的任务先 fan-in 到该分支并每次追平 develop；人在该 goal 的预览实例上试用，pre-merge AC 也在那里求值；人触发后由 worker-driver 以 `--no-ff` 合并提交整体并入 develop；之后照现有机制走到 achieved。

## 范围与非目标

范围（每项对应 AC）：
① 隔离：未放弃的 branch-mode goal 的任务只经其 goal 分支（或并入它的那个合并提交）进入 develop，不直落 develop——**AC-321**；
② 追平：每次 goal 分支落地都包含其追平时刻的 develop——**AC-322**；
③ 不重派：落到 goal 分支的任务不再被派发（`done` = 已落到 mergeTarget + 状态双写）——**AC-323**；
④ 并入前可见：pre-merge AC 在并入前就能被判为 pass（判据在 goal 的判据 worktree 上求值）——**AC-324**；
⑤ 人工并入：develop 上每个 goal 合并提交都有一条先于它的人工并入请求，且 goal 的 achieved 晚于并入——**AC-325**；
⑥ 废弃：被 retired/superseded 的 branch-mode goal 分支已删除，被丢弃的 tip SHA 留在 statusLog——**AC-326**；
⑦ 混入度：每个并入的 goal 经恰好一个合并提交进入 develop，并入前的任务落地都只经它进入——**AC-327**；
⑧ 并入前试用：live-probe 类 pre-merge AC 在预览实例上 pass 之后才并入——**AC-328**。

非目标（⛔ 有意排除）：
- 本 GOAL 自身**不开** branch 模式：功能尚不存在，且它改的是 driver/循环机制本身（SPEC §4.10 末：这类 goal 开分支得不到试用价值）。承载任务照常直落 develop。
- 嵌套分支、goal 分支之间的相互依赖、自动救援 cherry-pick、影子工作区（独立 clone + 全套 driver）——SPEC §8。
- 不改 release / hotfix / master 规则；不改未 opt-in 的 goal 与无 `goal_ac` 任务的行为。

## 判据形态

> **2026-10-03 更正**：初稿的 AC-321/325/327 用了 develop 的 first-parent 链，真实 fan-in 会把多数提交挤出该链（实测 32 条里 22 条），AC-321 因此对直落 develop 的演练任务误判通过，AC-322/323 读到的也不是 goal 分支落地。已改为祖先关系并重开 AC-321/322/323；落地只计经 goal 分支的。夹具按真实 fan-in 形状重造，含反例臂。详见 SPEC §7「判据的拓扑前提」。

- 8 条判据全部读**生产载体**（硬规则 4 推论三）：git 提交图与 `develop` reflog、`goals/*.md` frontmatter、`.quay/gate-events.jsonl`、`.quay/worker-round.jsonl` 的 `in_flight_task_starts`。⛔ 没有一条读夹具或注入数据。
- **三态**：exit 0 = 成立；exit 1 = 违反，同一行输出 `CAUSE=`；exit 3 = 未评估（无 branch-mode goal / 尚无落地 / 尚无并入 / 载体缺字段）。**在第一个试点 goal 跑起来之前，全部 8 条读 exit 3 是正确输出，不是缺陷。**
- 识别规则（判据与实现之间的契约，实现须遵守）：branch-mode = goal frontmatter 中独立一行 `branch: true`；任务落地 = 现有 `flipTaskDone` 的提交消息 `tasks: 翻 <id> done（driver 机械 fan-in）`；goal 合并提交 = develop 上（⛔ 按祖先关系找，不用 first-parent）subject 形如 `merge: goal/GOAL-NNN into develop` 的 merge commit；opt-in 的起算时刻 = goal 的 `activatedAt`；已放弃（retired/superseded）的 goal 不计；人工并入请求 = gate-events 中 `gate: "goal-merge-request"`、`item_id: GOAL-NNN`；预览求值根 = goal gate 事件 `payload.evaluationRoot`。
- 落笔当轮的读数（2026-10-03，主检出，`/bin/sh` 执行）：8 条全部 exit 3。每条的通过臂与违反臂都在合成 git 仓库上实跑过（可控的提交与 reflog 时间）：AC-321/327 直落 develop 的任务 ⇒ exit 1；AC-322 不追平 ⇒ exit 1；AC-323 落地后再派发 ⇒ exit 1；AC-324 并入前无 pass ⇒ exit 1；AC-325 无请求 / achieved 早于并入 ⇒ exit 1；AC-326 分支未删 / 未记 SHA ⇒ exit 1；AC-328 求值根为主检出 ⇒ exit 1；各自的通过场景 exit 0。
- ⚠️ 已知局限：AC-322 依赖 `develop` 的 reflog（默认 90 天过期）；过期后读不到的落地被跳过，全部读不到时 exit 3，⛔ 不会误判通过。AC-328 用判据文本含 `quay.ts serve` 选出 live-probe 样本——这只用于选样本，不用于给 AC 分相（分相靠显式 `phase` 字段，SPEC §4.7）。

## 退出条件

8 条 AC 全部 achieved，且以下两个人的动作已发生（它们是 AC 能取到 exit 0 的前提，goal-driver 不会替人完成——实现任务全部 done 而试点未跑时，各 AC 会停在 exit 3）：
1. **试点**：人选一个真实的较大改进（建议带 Web UI 面，能用上预览实例），对其 goal 设 `branch: true` 并走完「任务落地 → 预览试用 → `quay goal merge` → 并入」一轮——使 AC-321..325/327/328 取到真实读数；
2. **废弃演练**：人对一个小的 branch-mode goal 执行一次 retired（或 superseded）——使 AC-326 取到真实读数。

## 承载 task

AC-321 ← `gap-goal-branch-dispatch-wiring-and-task-fan-in`；AC-322 ← `gap-goal-branch-antidrift-two-line-base`；AC-323 ← `gap-goal-branch-done-means-landed-on-merge-target`；AC-324 ← `gap-goal-branch-criteria-evaluated-on-goal-worktree`、`gap-goal-branch-ac-phase-field-and-split-evaluation`；AC-325 ← `gap-goal-branch-human-merge-verb-and-execution`；AC-326 ← `gap-goal-branch-data-model-and-lifecycle`；AC-327 ← `gap-goal-branch-ff-merge-source-param`；AC-328 ← `gap-goal-branch-reaper-accepts-preview-serve`、`gap-goal-branch-gate-event-evaluation-root`、`gap-goal-branch-preview-instance`。依赖顺序见各任务的 `depends_on`（SPEC §10：B1/B2 落地前 ⛔ 不接线）。

## 演练证据（2026-10-03/04，GOAL-904 合并演练）

**结论**：8 条 AC 的判据在一次真实的 goal→develop 并入上全部读到 exit 0（AC-321…328）。演练载体是 GOAL-904（`branch: true`，一个任务、一条 live-probe AC，内容为一份说明演练的托管文档 DOC-904）。

| 读数 | 值 |
|---|---|
| 任务落点 | 翻 done 提交 `774f9c137` 经 `goal/GOAL-904` 落地，不在 develop 上；develop 的 `docs-managed/` 在并入前没有 DOC-904 |
| 追平 | 任务分支在 fan-in 内合入了 develop（新增的 `catch-up-develop` 步骤） |
| 锁 | `fan-in.goal-GOAL-904.lock`，事件带 `lock` 字段 |
| 试用 | 预览 `http://172.28.0.1:20204/doc` 列出 DOC-904，生产 `/doc` 不列；AC-904 的判据在预览 worktree 上 PASS（`evaluationRoot` = 判据 worktree，树 `23fa265f`→`0d5e13ef`）、在生产上 exit 1 |
| 并入 | 合并提交 `0e5c76a94`（`merge: goal/GOAL-904 into develop (request effad792…)`），第二父 = goal tip `774f9c137`；任务翻 done 提交只经第二父可达 |
| 顺序 | 并入先于 achieved：GOAL-904 在并入后的下一轮才翻 achieved（20:23Z），晚于合并提交；并入后 goal 分支、判据 worktree、预览实例均被清理 |

**演练暴露并已修的缺陷**（每条都有任务，单测都覆盖不到）：
1. 判据 worktree 在符号链接 root（`/home/yale`→`/data/home/yale`）下永远刷不新：`gap-goal-criterion-worktree-registered-check-blind-to-symlinked-root`。
2. 判据/预览 worktree 与并入临时 worktree 缺 `node_modules`（预览 serve 起不来、`pre-merge-commit` 钩子崩）：`gap-goal-branch-worktrees-lack-node-modules`。
3. 并入的非冲突失败被标成 `merge-conflict`，且同一 tip 上人重发请求不会被重试：`gap-goal-merge-infra-red-mislabelled-and-rerequest-never-retries`。
4. 设计漏洞：branch-mode goal 在并入之前就被 goal-driver 翻成 achieved，随后 `quay goal merge` 因非 active 被拒（死结）：`gap-goal-branch-goal-flips-achieved-before-its-branch-merges`，规则已补进 SPEC §4.7（close-block `blocked-unmerged-branch`）。
5. 本 GOAL 初稿判据依赖 develop 的 first-parent 链（真实 fan-in 把 69% 的落地挤出该链），改判据又打红了消费这些判据文本的测试（`gap-goal-criterion-rewrite-stale-test-fixtures`）。

**⚠️ 演练期间的手工操作与未被生产读数覆盖的部分**（不假装机制自己跑通了）：
- 手工把判据 worktree 刷新到新 tip（`checkout --detach --force`）——当时自动刷新因缺陷 1 失效。修复落地后，生产读数只出现过 `current`，**「刷新到新 tip」这条分支（`refreshed`）没有在生产上被读到过**。
- 手工把主检出的 `node_modules` 链接进判据 worktree 才起得了预览——**修复 2 的「判据/预览 worktree 自动装配依赖」没有在生产上被读到过**（并入临时 worktree 的装配则被真实执行：并入在没有任何手工干预下越过钩子并成功）。
- 样本很薄：AC-321/322/323/327 各只读到一个任务的落地；演练内容只是一份文档，没有覆盖「多任务落地到同一 goal 分支」与「goal 分支落后 develop 很多」。
- `plugin/test/live-web-address.test.mjs` 把语料数量钉死为字面量 18，之后每多一条用该 helper 的 AC 它会再次 develop-wide 变红（后续项）。

**仍未发生的退出条件**：上面「退出条件」第 1 条的**真实试点**（一个真实的较大改进开 `branch: true`）还没有做；本次演练只证明了机制能走通。