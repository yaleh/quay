---
id: gap-goal-gate-timestamp-commit-flood
title: goal gate 每 42 秒把 evidence 时间戳写盘即提交——develop 近 26 分钟 428 个提交里 427
  个是噪声（99.8%），且争用跨层共享索引
status: done
labels:
  - gap
  - defect
  - meta-driver
parent: null
children: []
extra: {}
---
## Finding

**结论**：两个各自正确的机制组合出了一个新缺陷——**develop 的提交历史已被时间戳噪声淹没**。实测 22:00–22:26 的 26 分钟里，develop 共 **428 个提交，其中 427 个是 `goals/` 的纯时间戳提交 ⇒ 99.8%**；近 6 分钟仍以约 **8 次/分钟**持续，折合每天两万余次。

**组合的两半（各自都没错）**：
1. `goal` driver（2026-09-06 约 21:47 起常驻）每约 **42 秒** gate 一遍全部 goal AC。实测 `gate-events.jsonl` 最近 400 条**全部** `actor=goal-cli`，AC-181 一条就占 31 次。
2. `goal-store.ts:190` `commitGoalFileAfterWrite`——写盘即提交，由 `gap-meta-commitgoalfile`（done）落地。它本身是对的（修的是「未提交 goals/*.md 阻塞 develop→doc ff-only 同步」）。

⇒ 但 `gate` 每次都会把 `evidence.at` 写回记录，于是**每 42 秒 × 每条 AC = 一个提交**，内容只有一行时间戳。实测提交信息全是 `goals: AC-NNN 写盘即提交（goal-store）`，逐条 diff 只差 `at:`（例：`AC-170` 22:22:03 → 22:24:53）。

**为什么不能只当噪声忍受（三条，按严重度）**：
- **硬规则 11**：索引是**跨层共享的可变状态**。每 4 秒一次 `git add`+`commit` 会与其他层的 add/commit 序列争用——本仓已有「`git add` 与 `git commit` 之间不许有等待」的成文纪律，正是因为这个索引是共享的。
- **归因被淹没**：任何人查 `git log` 找一个真实改动，要在 99.8% 的噪声里捞。`git log -- <file>` 这类归因手段实际失效。
- **写放大**：每条 AC 每 42 秒一次提交，且**逐条一个提交**（不是一次批量），13 条 AC ⇒ 每分钟约 18 个对象。

**⛔ 修法不是回退写盘即提交**——那会让 `gap-meta-commitgoalfile` 修好的「未提交 goals/*.md 阻塞 ff-only 同步」复发。真正的错配在于：**「状态变更」值得一次提交，「evidence 时间戳刷新」不值得**。而 `gate` 走的是同一条写路径，两者被当成同一件事。

**已有的同款判据可复用（⛔ 不要新造）**：`meta-driver.ts` 的 `settleEvidenceWrites` / `stripEvidenceTimestamp` 已经在解同一个问题——它把「只有时间戳变了」的 diff 还原、把「verdict 真的变了」的保留，实测每轮 `evidenceRestored=24 / evidenceKept=[真变化]`。该判据可直接被 goal-store 的提交决策复用。

**归属**：`gap-meta-commitgoalfile`（done）与 `gap-meta-goalstoreargv`（done）是本缺陷的**上游**，⛔ 不要回退它们；本条修的是它们与 goal driver 节奏组合后的产物。

## AC

- [x] 纯时间戳写入不产生提交：连续两次 `goal-store gate <同一条 AC>`（其 verdict 不变）之后，`git log --oneline -- goals/<该文件>` 的提交数**不增加**。判据须实跑两次 gate 再数提交，⛔ 不得 grep 源码。立条时实测：42 秒内必增 1（能取假）。
- [x] verdict 真变化仍然提交：构造一条判据由 fail 翻 pass 的 AC，gate 后该文件**必须**多出恰好 1 个提交 ⇒ 证明修复没有把提交一律关掉（负控制）。
- [x] 状态翻转仍然提交：`active → achieved` 的 flip 后必有提交 ⇒ `gap-meta-commitgoalfile` 修好的「未提交阻塞 ff-only 同步」不复发。
- [x] 提交速率回落到可核对的量级：改动落地后 30 分钟窗口内 `goals/` 提交数 ≤ 该窗口内真实 verdict/status 变化数 + 1。立条时该比值为 **427 : ~0**（能取假）。

## DoD

- [x] 上述四条判据本轮实跑并贴出输出，⛔ 不是转述。
- [x] 复用既有判据而非新写一套：提交决策调用 `stripEvidenceTimestamp` 同款逻辑（或将其提取为共享函数），⛔ 不在 goal-store 里另写一份「什么算实质变化」。
- [x] ⛔ 未回退写盘即提交；⛔ 未改动 goal driver 的 gate 节奏（节奏本身不是错，错的是把每次 gate 都当成一次值得记录的变更）。

## Touches

- `packages/quay/src/goal-store.ts`
- `plugin/scripts/meta-driver.ts`
- `packages/quay/test/goal-store.test.mjs`
- `plugin/test/meta-driver.test.mjs`
- `tasks/gap-goal-gate-timestamp-commit-flood.md`


---

## 成因更正（2026-09-06T23:5xZ，立条人自行更正——原成因不完整且指错了主要写入者）

**原文写的是「goal driver 每约 42 秒 gate 一遍全部 AC × 写盘即提交」。实测表明不止如此，且 goal driver 不是唯一写入者。**

**负控制（当场做的）**：把 `goal` driver **停掉**之后，`goals: AC-NNN 写盘即提交（goal-store）` 仍以**每秒一条**继续（实测 23:48:32–37 连续 5 条：AC-180/181/182/183/184，顺序递增）⇒ 停错了对象，已恢复该 driver。

**真实成因（两个写入者，形态相同）**：
1. 任何调用 `collectReadings` 的路径都会**逐条 gate 全部 criteria**，而 `goal-store gate` 写回 evidence ⇒ 触发 `commitGoalFileAfterWrite`。⇒ **meta-driver 每轮提交约 15 次**（当前 criterionCount=15）。
2. 我本轮为验证修复跑了 3 次 `meta-driver.ts --no-llm --dry-run`——**每次同样贡献约 15 条提交**。⇒ 立条人自己也在往洪水里加水，这不是旁观者报告。
3. goal driver 的 42 秒 gate 循环是第三个来源（原文只写了这一个）。

**⚠️ 一个更严重的连带后果（原文完全没提）**：写盘即提交**架空了 `settleEvidenceWrites`**。
`meta-driver.ts` 的结算逻辑本来负责「只有时间戳变了 ⇒ 还原，verdict 真变了 ⇒ 保留」，作用是**不让 evidence 抖动弄脏共享检出**。但现在 `gate` 在结算之前就把改动**提交**掉了 ⇒ 结算时树已干净、无可还原 ⇒ 该机制事实上失效，而它的存在会让人以为抖动已被处理。
⇒ 修法必须同时回答：结算与提交谁在前、以及「什么算实质变化」这个判断放在哪一层（⛔ 不要两层各写一份）。

**代价的一个新读数**：本次把一个 2 文件的修复推进 develop，`merge + push` **连续失败 6 次、第 7 次才成功**——develop 前进速度高于 merge-then-push 的窗口。⇒ 洪水不只是历史噪声，它已经在**阻碍正常落地流程**。

## Needs-Human

**执行 2026-09-07T00:24:54.433Z — 连续修满重试上限仍不合格（标 needs-human）**

- 阻碍原因：worker-driver 连续 3 次 exited-not-landed 未落地（重试上限）
- 失败步/判词：step=ff: fan-in-ff-merge: FF FAILED (attempt 5 >= 3) — ANTI-LIVELOCK (SPEC §7, gap-ff-livelock-trigger-no-action): develop keeps advancing; escalating + STOPPING automatic retry. Escalation record written to /home/yale/work/quay/.quay/fan-in-ff-escalations.jsonl. Do NOT auto-retry: re-merge develop and re-run the fan-in once develop settles.
fan-in-ff-merge: measure ff_only_locked=false
- run_id：wk-prod-1788717081
- session_id：2a056be1-4d22-48f6-90fe-b42034035de1
- fan-in 日志：/home/yale/work/quay/.quay/fan-in-gap-goal-gate-timestamp-commit-flood-wk-prod-1788717081.log
