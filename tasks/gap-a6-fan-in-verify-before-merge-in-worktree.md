---
id: gap-a6-fan-in-verify-before-merge-in-worktree
title: A6 fan-in 顺序缺陷——先验后合 + scoped 门在 worktree 内跑（AC42 判据2 + 人「主检出只读」裁定）
status: ready
labels:
  - gap
  - defect
  - mechanism
parent: null
children: []
extra:
  schema: execution
---

**type:** execution

## Proposal

**实证（manager 2026-08-13 抓）**：A6 fan-in 当前顺序是**先合后验**——
`orchestration/fast-mode-tick-core.md` A6 行（src:449/457/473/476）：
`rebase(wt) → git merge --no-ff task/<id> 合回 $MERGE_TARGET → $TEST_COMMAND --for-task <id> → worktree remove + branch -d`。

两个缺陷同根：
1. **scoped 门跑在主检出**（`$TEST_COMMAND` 在共享检出上执行）——违背 AC42 判据2「测试 cwd 不在主检出」+
   人 2026-08-13「主检出只读诊断」裁定。失败时还要**回退共享分支**（merge 已落地），一次 scoped 红冻结整个 tick。
2. **先合后验**——验证应在 merge 之前，而非之后；失败时 worktree 内未合状态可直接丢弃，共享检出零污染。

**修 = 先验后合**：
```
rebase(wt) → cd <wt> 内跑 scoped 门 → 绿才 git merge --no-ff task/<id> → worktree remove + branch -d
```
**验收判据（outer 裁定）**：fan-in 期间 `/proc/<pid>/cwd` 落主检出的测试进程数 = 0
（同时给 AC42 判据2 供证）。

**延伸 W2**：fan-in 作 workflow 是此任务的延伸，可一并纳入（本任务核心是顺序修正 + wt 内跑测试）。

## Plan

1. 改 `orchestration/fast-mode-tick-core.md` A6 行（src:449/457/473/476 对应文本）：
   rebase(wt) → **wt 内 scoped 门** → 绿才 merge → worktree remove + branch -d。
2. 同步源文档 `plugin/loop/fast-mode-loop-tick.md`（src:N 对应处）——两处一致，避免漂移。
3. 若存在 fan-in 脚本（`serial-fanin-absorb.ts` / `integration-batch-merge.sh`）复用该逻辑，一并修正。
4. 验收：fan-in 期间测试进程 cwd 全落 worktree，主检出测试进程数 = 0。

## AC

- [ ] AC1: A6 顺序改为「先验后合」——scoped 门在 merge 之前，且 `cd <wt>` 内执行
- [ ] AC2: 失败路径简化——scoped 红/冲突时丢弃 worktree 内未合状态，共享检出零污染，无回退操作
- [ ] AC3: 验收判据——fan-in 期间 `/proc/<pid>/cwd` 落主检出的测试进程数 = 0
- [ ] AC4: 源文档与执行核两处一致（`plugin/loop/fast-mode-loop-tick.md` + `orchestration/fast-mode-tick-core.md`）
- [ ] AC5: 既有测试全绿；`--for-task` scoped 门绿

## Definition of Done

- [ ] AC1–AC5 全部勾上
- [ ] 顺序修正 + wt 内测试的证据贴出（fan-in 期间 cwd 计数）
- [ ] 既有测试 + 新增测试全绿（`--for-task` scoped）

## Touches

- orchestration/fast-mode-tick-core.md（A6 行顺序修正）
- plugin/loop/fast-mode-loop-tick.md（源文档 src:N 同步）
- plugin/scripts/serial-fanin-absorb.ts（如复用 fan-in 逻辑）
- tasks/gap-a6-fan-in-verify-before-merge-in-worktree.md（自身）
