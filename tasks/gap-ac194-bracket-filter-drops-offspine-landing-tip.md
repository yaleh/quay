---
id: gap-ac194-bracket-filter-drops-offspine-landing-tip
title: AC-194 判据第三次变假：bypass-check 的括注准入要求落地 tip 在当前 first-parent spine 上 ⇒ 6 条已
  fan-in 的提交 unclassifiable ⇒ NOT-EVALUATED exit 1
status: ready
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: execution
goal_ac: AC-194
---
## Proposal

正本：`goals/AC-194-no-direct-to-develop-bypass.md`（判据）+ `goals/GOAL-007-done-fixture.md`（题面）。本任务是 GOAL-007 题面的**第三次实测实例**，来源是 goal 层 gate 报出 `fail`。

**当前读数（2026-09-15，主检出 `/home/yale/work/quay`，逐字贴出，⛔ 非转述）**：

```
$ node --no-warnings --experimental-strip-types plugin/scripts/direct-to-develop-bypass-check.ts \
    --root . --baseline develop~100 --json ; echo EXIT=$?
{ "evaluated": false, "ok": true, "reason": "unclassifiable-commits-in-range",
  "unclassifiableCommits": 6,
  "classification": { "classified": 94, "total": 100, "ratio": 0.94, "firstParent": 100 } }
EXIT=1
```

台账尾（`.quay/gate-events.jsonl`，actor=goal-sweep）：`2026-09-15T09:07:25.159Z` `verdict=fail`、`payload.reason = "acceptance failed (exit 1) — AC-194 fail - plugin/scripts/direct-to-develop-bypass-check.ts did not pass (--baseline develop~100) unclassifiable-commits-in-range"`、`criterionHash = d3eb8d7a6165b156`。

**⇒ 这不是陈旧读数**：判据逐字重跑，`exit 1` 当场复现（`ok:true` 表示**零直投**，红的只有 `evaluated:false`）。`tasks/gap-ac194-frozen-verdict-predates-fix.md`（done，2026-09-15）当时的结论「真值已恢复、⛔ 勿再找不存在的缺陷」**对当时成立**（台账 `03:46:13 / 05:31:53 / 07:34:53` 三轮 pass），但**已被 09:07:25 的 fail 取代**——同一个 `criterionHash`、判据本身未变，变的是 develop 的生产状态。

**根因（可复现，⛔ 不是推断）**：6 条 unclassifiable 全部是**已被 ref-level 落地 fan-in 进 develop 的提交**，而 checker 的括注过滤把它们漏掉了。

1. 6 条 = `git rev-list --first-parent develop~100..develop` 的第 15–20 位：`4e93a695 / 18705fb7 / f1a6f49d / a9cde62a / e26fd759 / 3f2384de`（主题含 `AC-255` / `task/gap-ac255-driver-internalization-pid-le2-six-kinds-fresh`）。
2. 把它们引入 develop 的那次落地**在 reflog 里有条目**：`develop@{141}`，`push`，**T=`d8937165`**（主题 `tasks: 翻 gap-ac255-... done（driver 机械 fan-in）`），P=`1a36a001`。实测 `git rev-list --first-parent 1a36a001..d8937165` = 20 条，**与窗内 spine 的交集恰为上述 6 条**（第 15–20 位）。
3. 而这条括注被 `plugin/scripts/direct-to-develop-bypass-check.ts:750` **跳过**：`if (!spineSet.has(T)) continue;` —— 因为 **T=`d8937165` 不在当前窗的 first-parent spine 上**（`spineSet` = `rev-list --first-parent develop~100..develop`），尽管它**是 develop 的祖先**（`git merge-base --is-ancestor d8937165 develop` → 真）。
4. `:746-749` 给这条过滤写的理由是「一次 ref-level 落地到 develop 必然让 T 成为 develop tip（spine 成员）」。**该前提被实测证伪，且不是边角情形**：develop reflog 最近 **200** 条 tip 里**只有 4 条**在当前 spine 上，**196 条是 develop 的祖先但不在当前 first-parent spine 上**。成因是常规操作——任务分支在工作树里 `git merge develop`（把当时的 develop tip 记成**第二父**）、随后该分支被 ff fan-in 到 develop ⇒ develop 的 first-parent spine 走的变成**任务分支那条线**，先前的落地 tip 落进第二父位置（可达、离脊）。
5. **覆盖算术闭合**：把该括注的 `intro ∩ spine` 并入 `refMoveCovered` ⇒ unclassifiable 恰减少这 6 条 ⇒ 归零；而 `ok:true` 说明窗内**零真直投** ⇒ 判据 `exit 0` 可达。两条同源读数均已当场跑出。

**为什么先前的修复没保持住（题面要求逐字写明）**：前两次修复的对象与本次**不是同一个根**，却共用同一个 `reason` 字符串——① `gap-ac194-bypass-check-unclassifiable-window`（done）把全 DAG 扫描换成 first-parent spine 扫描；② `gap-ac194-reflog-action-vocabulary-incomplete`（done，`69f608384`）把 reflog action 分类从「两种拼法白名单」改成按结构判定，修的是**读不懂第 4 种拼法**。本次的根是**括注准入的前提（`T ∈ spine`）**，不是拼法词汇表 ⇒ 「未分类计数」这个**症状读数**再次出现时，前两次的修法结构上都不覆盖它。⇒ 本任务按**结构**（T 是不是 develop 的祖先 / 括注是否带出窗内 spine 提交）修，⛔ 不按拼法或计数修。

**范围与红线**：

- ⛔ 不放松 fail-closed：真 unclassifiable（无 ledger、无 reflog 条目、不在任何括注内）必须**保持** NOT-EVALUATED（硬规则③b）。
- ⛔ 不碰 fan-in 机制、不改 `direct` 的优先级：`classifySpineLandingMode:523-529` 里 `directSet` **先于** `refMoveCovered` 判定 ⇒ 扩大括注覆盖**结构上不可能**把真直投洗成 fan-in（已读码确认）。
- ⛔ 不新增机件；只改这一个 checker 的括注准入，并保持 `--baseline develop~100` 窗在 goal-gate 的 60s criterion 预算内（判据正本自陈现状 ~2s）。

## Plan

1. 复现：跑上面两条命令，把 `unclassifiableCommits:6` 与 `develop@{141}` 的覆盖交集落成可重跑的读数。
2. 改 `direct-to-develop-bypass-check.ts` 的括注准入：把「T 必须在当前 spine 上」换成**能证明该括注带出了窗内 spine 提交**的判据（候选：对 reflog 由新到旧遍历，`T` 一旦是窗底 `develop~100` 的祖先即停——reflog 对单个 ref 是时间序 append-only，故更旧的条目结构上也更旧；再对候选跑 `rev-list --first-parent P..T` 取与 `spineSet` 的交集）。`refMoveIntroduced` 的**可见性读数**可继续按当前口径收窄（避免 JSON 膨胀），但 `refMoveCovered` 必须用完整候选集。
3. 回归测试写进 `plugin/test/direct-to-develop-bypass-check.test.mjs`：**离脊落地 tip 的括注仍覆盖其 intro 提交**（夹具形按本次实测）。
4. 负控制两条（判据能取假，硬规则④）：①真 unclassifiable 仍 `evaluated:false`、退出码非 0；②落在括注区间内的**真直投**仍报 `direct`。
5. 量测并贴出判据墙钟（须在 60s goal-gate 预算内），与改前同命令对照。
6. 走 fan-in 落地 develop；落地后重跑判据并读台账尾。

## AC

- [ ] `node --no-warnings --experimental-strip-types plugin/scripts/direct-to-develop-bypass-check.ts --root . --baseline develop~100 --json` → `exit 0` 且 `evaluated:true`、`ok:true`、`unclassifiableCommits:0`（贴出完整 JSON 与退出码）。
- [ ] AC-194 判据逐字（`goals/AC-194-no-direct-to-develop-bypass.md` 的 `criterion`）→ `exit 0`（贴出 stdout/stderr 与退出码）。
- [ ] 新回归用例：构造一个 **tip T 是 develop 祖先但不在窗内 spine 上**的括注，断言其 `intro ∩ spine` 提交被判 `fan-in`（⛔ 不是 unclassifiable）；该用例在改前**必红**、改后绿（贴出改前红读数）。
- [ ] 负控制①（fail-closed 保持）：无 ledger / 无 reflog 条目 / 不在任何括注内的 spine 提交仍判 `unclassifiable` ⇒ `evaluated:false`、退出码非 0（贴出读数）。
- [ ] 负控制②（不掩真直投）：落在某括注区间内但**是直投**的提交仍判 `direct` 并报红（贴出读数）。
- [ ] 判据墙钟贴出且 ≤ 60s（goal-gate criterion 预算），同时给出改前同命令墙钟作对照。

## DoD

- [ ] `plugin/scripts/direct-to-develop-bypass-check.ts` 的括注准入改动已 land 到 `develop`（`git merge-base --is-ancestor <commit> develop` → 真）。
- [ ] `goals/AC-194-no-direct-to-develop-bypass.md` 的判据在**落地后**重跑 `exit 0`；`.quay/gate-events.jsonl` 中 AC-194 的 **goal-sweep 事件尾条** `verdict=pass`（贴出该条事件原文与时间戳）。
- [ ] 三条测试/负控制读数与 JSON 原文贴进任务体 `## Resolution`（⛔ 无凭记忆字面量）。

## Touches

- plugin/scripts/direct-to-develop-bypass-check.ts（括注准入 + refMoveCovered 候选集）
- plugin/test/direct-to-develop-bypass-check.test.mjs（离脊 tip 括注 + 两条负控制）
- plugin/scripts/checker-mutation-cases/direct-to-develop-bypass-check.sh（该 checker 的 mutation 分支若需同步）
- tasks/gap-ac194-bracket-filter-drops-offspine-landing-tip.md（自身）
