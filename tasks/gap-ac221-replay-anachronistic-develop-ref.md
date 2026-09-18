---
id: gap-ac221-replay-anachronistic-develop-ref
title: AC-221 判据的 develop 历史态回放【时代错置】——`git log develop --until=<ts>` 按提交日期过滤【当前
  DAG】，取到「事件当时还没进入 develop、之后才 merge 进来」的提交，把一条 16.5 秒的传播竞态误报为 2026-09-07
  那类真复发；改用 reflog 忠实重建 ref（1 真复发 → 0，且正控制证明仍能取假）
status: ready
labels:
  - gap
  - defect
  - mechanism
parent: null
children: []
extra:
  schema: plan
goal_ac: AC-221
---
**type:** plan

## Proposal

AC-221 的 criterion 本轮实测 FAIL（`fail 1`）：判据报「发现 1 条真复发」。**该真复发是判据自身回放方法的假阳性，不是 2026-09-07 那类事故的复发。**

判据 failure 原文：

```
发现 1 条真复发(2026-09-07 那类假阴性,develop 历史态其实已全勾却被短路)：gap-goal-batch-dry-run-noop@2026-09-18T11:12:40.533Z(develop@ca1a8276d(2026-09-18T11:12:40.533Z 前最近提交) 的 tasks/gap-goal-batch-dry-run-noop.md: status=pass checked 6/6)
```

根因（硬规则 4c 的形状：判据点名的量没有穿过中间层）：`developTipAt()`（`plugin/test/goal011-ac-shortcircuit-false-negative-recurrence.test.mjs:73-83`）用 `git log develop --format=%H --until <ts> -1` 重建「develop 在事件时刻的状态」。`--until` 是对**当前 DAG** 按**提交日期**做的过滤，**不是**「该时刻 develop ref 的值」——它可以返回一个事件当时还没进入 develop、之后才经 merge 进来的提交。

## Evidence（本轮全部为直接量，可逐条复核）

决定性对照（两条独立读法互校，同一事件）：

| 回放方法 | 取到的 commit | `flipAcGateVerdict` |
|---|---|---|
| 现判据 `git log develop --until=<ts> -1` | `ca1a8276d`（提交日期 11:11:34） | `ok=true`, 6/6 ⇒ 判「真复发」 |
| develop ref 的真实历史（`git reflog show develop`） | `b3d0ea5f3`（11:00:28） | `ok=false`, 0/6 ⇒ 判「真阴性」 |

ref 的真实移动时刻（reflog 逐条，直接量）：

```
ca1a8276d develop@{2026-09-18 11:12:57 +0000}: push
b3d0ea5f3 develop@{2026-09-18 11:00:28 +0000}: push
```

事件时刻 = `11:12:40.533Z`（`.quay/worker-outcome.jsonl:2210`）⇒ **ref 移动发生在事件之后 16.5 秒**；`ca1a8276d` 当时的 parent = `b3d0ea5f3`（= 那时 develop 的 tip）⇒ 它是一次正常 ff，只是晚到。⇒ 事件当刻 develop **确实**是 0/6，短路在当时是正确的；按 AC-221 自己写下的定义（「develop 历史态当时已全勾却被短路」）它是**真阴性**。

全窗口读数（53 条落地后短路事件，两种方法逐条比）：

```
M1 = 现判据(date-filtered)  recurrences=1  unclassified=0   ← 判据 FAIL
M2 = reflog 忠实重建         recurrences=0  unclassified=0   ← 判据 PASS
两法不一致的事件数 = 1（即上面这条）
```

判据不会因此变恒真（硬规则 4：必须保留取假能力）——正控制实测：对落地前 14 条短路事件跑 M2，**4 条**判为真复发，第一条逐字就是 GOAL-011 立条时引用的那次事故：

```
gap-cli-write-surface-lacks-toplevel-fields@2026-09-07T03:37:36.503Z → develop ref 8d8e353db = 8/8 全勾
```

端到端可行性已实测：把 `developTipAt` 换成 reflog 重建的 scratch 副本跑 criterion ⇒ **3/3 绿**（`pass 3 / fail 0`）。

reflog 覆盖深度实测：4481 条、最早 `2026-08-23T03:25:46Z` ⇒ 覆盖本判据要求的整个窗口（≥2026-09-09）。最新条目 = `1b9ce780b` = 当前 develop tip（自检见 Plan 2）。

<!-- dedup-ref -->
与既有裁定的关系（先查存量）：`gap-direct-to-develop-check-reflog-to-revlist`（done）裁的是「reflog 作为 direct-to-develop 判定的唯一 ground truth」脆弱（会被 gc 剪）。本任务**复用**它的三态姿态而非推翻它：reflog 可读到 ⇒ 用它；读不到（最早条目晚于事件时刻／ref 不可读／reflog 不完整）⇒ NOT-EVALUATED，fail-closed——这正是 AC-221 原文要求：「回放不出历史态时fail-closed(判不出≠没复发)」。两处用途不同：那里要「全历史完备枚举」（剪了就灭失），这里要「某一刻 ref 的值」（窗口内条目在即可，剪枝由 fail-closed 兜住）。

⚠️ 本任务**不覆盖、也⛔ 不得静默收窄**的残留（如实记录，另需裁定）：本事件暴露的**另一个**真问题——AC 勾选写在 11:11:34 提交、直到 11:12:57 才到达 develop（**83 秒传播延迟**），而 worker 在 11:12:40 被短路 ⇒ 烧掉一个 worker 轮次。按 AC-221 自己写下的判据（develop 侧）它不算复发；但它与 09-07 事故**共享代价形状**（勾完了却被短路）。⛔ 本任务**不**把它塞进 AC-221 的判据里（那会重新引入 AC-221 于 2026-09-09 由人明确要求拆掉的 confound）——它需要**自己的一条 AC/裁定**。

## Plan

1. `developTipAt()` 改为忠实重建：读 `git reflog show develop --date=iso --format=<sha>\t<gd>`，取**时间戳 ≤ 事件 ts 的最新一条**条目的 sha；全无可用条目 ⇒ 返回 null（下游 fail-closed）。
2. 加完备性自检（⛔ 不静默）：reflog **最新一条** ≠ 当前 `develop` tip ⇒ reflog 不完整 ⇒ 返回 null（fail-closed）。
3. 负控制二（`gap-ac207` 已知真阴性样本）必须继续判「非复发」——M1/M2 在它上面**一致**（实测都是 2/5）。
4. 新增一条**正控制**进判据本体：对已知真复发样本 `gap-cli-write-surface-lacks-toplevel-fields@2026-09-07T03:37:36.503Z`（→ develop ref `8d8e353db` = 8/8）必须判为复发；把「本方法仍能取假」钉进判据本身，⛔ 不靠注释。
5. 重跑 criterion，必须 0 fail。

## Acceptance Criteria

- [ ] AC1（能取假）：`developTipAt` 对 `2026-09-18T11:12:40.533Z` 返回的 commit 的 `tasks/gap-goal-batch-dry-run-noop.md`，`flipAcGateVerdict` 判 `ok=false`（0/6）；⛔ 仍返回 `ca1a8276d` / `ok=true` ⇒ 假。
- [ ] AC2（正控制，判据自身保留取假能力）：判据里存在一条**读真实历史**的断言，对已知真复发样本（`gap-cli-write-surface-lacks-toplevel-fields@2026-09-07T03:37:36.503Z` → ref `8d8e353db` = 8/8）判为复发；**双向对照**：同一断言换成已知真阴性样本（`gap-ac207` 2026-09-09T14:26:02.187Z）时判非复发（两臂都要实测，缺一臂不算）。
- [ ] AC3（fail-closed 三态）：reflog 读不到 / 最早条目晚于事件 ts / 最新条目 ≠ 当前 develop tip 这三种情形下，`developTipAt` 返回 null，主判据走 `unclassified` 分支 **FAIL**（⛔ 不当作「没复发」）。用带窄时间窗的构造输入或临时仓库实测该三态。
- [ ] AC4（端到端）：`QUAY_GOAL_CRITERION_LIVE=1 node --no-warnings --experimental-strip-types --test plugin/test/goal011-ac-shortcircuit-false-negative-recurrence.test.mjs` 退出码 0、`fail 0`。
- [ ] AC5（不静默收窄范围）：判据头注如实写明「本判据的 develop 侧口径不覆盖『写已提交但尚未到达 develop』的传播竞态」+ 上面那份 83 秒实测读数；⛔ 不得把该残留写成已解决。
- [ ] AC6：`bash scripts/test.sh --for-task gap-ac221-replay-anachronistic-develop-ref` 绿（含改动/新增测试）。
- [ ] AC7（真阴性样本不被误伤）：负控制二（`gap-ac207` 2026-09-09T14:26:02.187Z）仍判 `recurrence === false`。

## Definition of Done

- [ ] `developTipAt` 用 reflog 忠实重建 develop ref（+ 完备性自检 + fail-closed 三态）落地；正控制断言进判据本体；AC1-AC7 全勾；criterion 端到端绿；land 到 develop。
- [ ] criterion 由 goal-driver 下一轮独立复跑，ledger tail 翻 pass（AC-221 由「当前为假」翻回真）。

## Touches

- plugin/test/goal011-ac-shortcircuit-false-negative-recurrence.test.mjs
- tasks/gap-ac221-replay-anachronistic-develop-ref.md