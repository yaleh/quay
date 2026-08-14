---
id: gap-in-flight-resolve-by-task-id-not-worktree-name
title: --in-flight 传 worktree 目录名被截断致在飞少算 1 ⇒ slots_free 虚高 ⇒ AC53 闸误拒心跳（jsonl 56→57 恢复实证）
status: ready
labels:
  - gap
  - mechanism
parent: null
children: []
extra:
  schema: execution
depends_on: []
---

**type:** execution

## Proposal

**（--in-flight 传 worktree 目录名而非真任务 id，目录名截断 ⇒ 在飞少算 ⇒ slots_free 虚高 ⇒ 闸误拒写入——2026-08-14 12:4xZ inner 实证 + manager 定位，立案归 outer）**。

**根因链（实测）**：
```
inner 的 slot-refill --in-flight 传 worktree 目录/分支名（非真任务 id）
worktree 目录名被截断：gap-workflows-dual-copy-drift（真任务 id 缺 -unchecked）
                      gap-test-isolation-backlog-44（真 id 缺 -violations-unmeasured）
⇒ 在飞识别少 1 ⇒ slots_free 虚高
⇒ AC53 结束不变式闸（should_refill ∧ slots_free>0 拒写）误拒心跳写入
⇒ inner 传真任务 id 后：in_flight=5/slots=0/should_refill=false ⇒ 闸放行 ⇒ jsonl 56→57
```

**代价链**：`--in-flight` 少算 ⇒ `slots_free` 虚高 ⇒ `should_refill=true` 误导派发评估；且 AC53 闸（对 should_refill 诚实）因此拒写心跳，心跳追加恢复被延迟到「传真 id」这一刻。**根在【在飞集合的构成来源】——用 worktree 目录名（可截断的派生量）冒充任务 id（真量）**（4b：代理量优先 vs 直接量）。

**判据1**：`--in-flight` 解析按【任务 id 匹配】——任何传入的在飞标识（worktree 目录名 / 分支名 / task id）先归一到任务 id（如按 `tasks/<id>.md` 存在性 + 目录名前缀匹配），**截断的目录名也能解析到真 id**——一次修所有截断（manager 倾向 (a)）。
**判据2（能取假）**：现状传 `gap-workflows-dual-copy-drift`（截断目录名）⇒ 在飞少算 ⇒ slots_free 虚高（真样本=本次实证，jsonl 56→57 前）；修后传截断名也能解析到真 id、in_flight 不偏。
**判据3**：AC53 闸不再因在飞少算而误拒——修复后在飞读数准（=真实任务数），should_refill 正确，闸只在该拒时拒。
**判据4**：既有测试全绿 + `--for-task` scoped 门绿。

**不覆盖**：不改 AC53 闸的判据（闸对 should_refill 诚实是正确行为）；不改 worktree 命名约定（截断本身不是缺陷，解析不认截断才是）。

**本任务不新建过程纪律型 AC**：负控制沿用 AC49。

## Plan

1. 读 slot-refill.ts 的 `--in-flight` 解析 + inner tick doc 的在飞集合构成（fast-mode-loop-tick.md:338）。
2. 判据1：`--in-flight` 解析按任务 id 匹配（worktree 目录名/分支名/task id 归一，截断可解）。
3. 判据2 能取假：截断目录名回放红（在飞少算）+ 修后绿（解析到真 id）。
4. 判据3：AC53 闸不再误拒（在飞读数准）。
5. 既有测试全绿 + `--for-task` scoped 门绿。

## Acceptance Criteria

- [ ] AC1 判据1：`--in-flight` 解析按任务 id 匹配，截断 worktree 名可归一到真 id。
- [ ] AC2 判据2 能取假：截断目录名（gap-workflows-dual-copy-drift）回放不再在飞少算。
- [ ] AC3 判据3：AC53 闸不再因在飞少算误拒（jsonl 追加恢复可复核）。
- [ ] AC4 既有测试全绿；`--for-task` scoped 门绿。

## Definition of Done

- [ ] `--in-flight` 按任务 id 解析（截断 worktree 名归一到真 id），在飞读数不再少算，AC53 闸不再误拒心跳追加。

## Touches

- plugin/scripts/slot-refill.ts（--in-flight 解析按任务 id 匹配）
- plugin/test/slot-refill.test.mjs（补截断名解析测试）
- tasks/gap-in-flight-resolve-by-task-id-not-worktree-name.md（自身）

## Evidence

（落地后回填）
