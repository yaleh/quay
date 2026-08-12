---
id: gap-compound-depsreadyfor-structural-deadlock
title: compound 任务 depsReadyFor 结构性死锁 — parent 聚合语义被当前驱语义解（AC16③ 唯一机制堵点）
status: ready
labels:
  - gap
  - defect
  - milestone-candidate
parent: null
children: []
extra: {}
---
**type:** execution

## Proposal

**结构性死锁（manager 2026-08-12 00:33 003351 源码级确认，双向互等）**：AC16③ 那棵 compound 子树永久不可派。

**方向一 —— parent 派不出去**：`gap-quay-has-never-self-hosted-its-own-cold-start` 是 `role: compound`，其 `## Touches` 按约定写「(compound task — see each child's own `## Touches`)」。`slot-refill.ts:366` 对每个候选跑 `selfTouchCheck`，而 `touches-orthogonality-check.ts:321` 要求任务体 Touches 里含字面 `tasks/<id>.md` 条目 ⇒ compound 任务按其自身约定永远不含 self-touch ⇒ 永远 `deferred: self-touch-missing-c8`。

**方向二 —— 每个 child 也派不出去**：`ready-pool-check.ts:993` 的 `depsReadyFor` 把 `parent` 计入 deps 且要求父 `done`；而 compound parent 只有在 children 全 done 之后才可能 done。

⇒ **双向互等，整棵子树永久不可派**（grep 确认 `depsReadyFor` 附近无任何 `role: compound` 豁免）。

**根因**：`depsReadyFor` 把两种语义完全相反的关系混成一条边：
- `depends_on` 是**前驱**——A 必须先完成，B 才能开始。「父必须 done」对它成立。
- `parent`（compound 分解）是**聚合**——parent 就是 children 的和，**children 是 parent 的实现方式，不是它的后继**。

**影响面（manager 量化）**：全库 149 任务带 `parent`，39 因父未 done depsReady=False；其中 36 已终态不受影响；真正被卡住且想干活的只有 2 个——cold-start 树的两个 todo child。**唯一一棵死锁的 compound 树就是 AC16③ 这棵。**

**修法方向（outer 裁定）**：`depsReadyFor` 遇 `role: compound` 的 parent 时不把它计入 deps；或更彻底——compound 任务根本不该进可派集，派发只认叶子。实现归 inner，判定归 outer。

**验证锚**：修后 (a) cold-start 树的两个 todo child 可派（depsReady=True）；(b) compound parent 不进推荐；(c) `--for-task` scoped 门绿；(d) 不回归。

## Acceptance Criteria

- [ ] AC1: **复现固化**——任务体记录死锁双向互等源码位置（ready-pool-check.ts:993 depsReadyFor parent 计入 + slot-refill.ts:366 selfTouch + touches-orthogonality-check.ts:321 字面 tasks/<id>）（本任务 Proposal 已含）
- [ ] AC2: **聚合语义修复**——`depsReadyFor` 遇 `role: compound` parent 不计入 deps（或 compound 不进可派集只认叶子）
- [ ] AC3: **cold-start 子树解锁**——两个 todo child（gap-cold-start-skill-has-no-recovery-branch / gap-no-formalized-bare-metal-session-bootstrap）depsReady=True 可派
- [ ] AC4: **既有不回归**——`--for-task` scoped 门绿

## Definition of Done

- [ ] AC1–AC4 全部勾上
- [ ] 修后实跑：cold-start 两 child depsReady=True 读数贴出
- [ ] 既有测试 + 新增测试全绿（`--for-task` scoped）
- [ ] 全量套件绿（`fail 0` 且 `cancelled 0` 且 `FULL-SUITE-EXIT=0`）——外层 verification-round 验证

## Touches

- plugin/scripts/ready-pool-check.ts（depsReadyFor compound parent 豁免）
- plugin/scripts/slot-refill.ts（selfTouchCheck compound 处理）
- plugin/scripts/touches-orthogonality-check.ts（compound self-touch 判定）
- plugin/test/ready-pool-check.test.mjs（compound 死锁用例）
- tasks/gap-quay-has-never-self-hosted-its-own-cold-start.md（交叉标注——死锁解除后子树可派）
- tasks/gap-compound-depsreadyfor-structural-deadlock.md（自身：勾 AC + 贴证据）

## Contract

measure   compound_children_depsready = `node --no-warnings --experimental-strip-types plugin/scripts/ready-pool-check.ts --root . --cap 5 --json` 对 gap-cold-start-skill-has-no-recovery-branch 的 depsReady 读数
band      compound_children_depsready = true（修后两 child depsReady=True）
invariant compound_parent_not_dispatchable = 1（compound parent 不进推荐/可派集）
invariant no_self_touch_false_negative = 1（compound 不再因 self-touch-missing 被 defer）
invoke    `node --no-warnings --experimental-strip-types plugin/scripts/ready-pool-check.ts --root . --cap 5 --json`（贴 cold-start 两 child depsReady 读数）
control   compound 聚合语义修复；cold-start 子树可派；既有不回归
resume    depsReadyFor / slot-refill / touches-orthogonality 分步提交，任一步完成即写盘

## Dispatch review

reviewer: outer
at: 2026-08-12
changed: manager 003351 源码级定位（双向互等）。AC16③ 唯一剩余机制堵点。outer 裁定修法方向（compound parent 不计入 deps / compound 不进可派集）。实现归 inner。
