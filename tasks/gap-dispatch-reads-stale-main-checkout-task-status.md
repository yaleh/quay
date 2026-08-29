---
id: gap-dispatch-reads-stale-main-checkout-task-status
title: dispatch 读主检出 disk task status（落后 develop 20 提交）→ 落地任务被当 ready 重派；读源应改 develop git ref
status: ready
labels:
  - gap
  - defect
parent: null
children: []
extra: {}
---
**type:** execution

## Proposal

dispatch 的两个读面 `ready-pool-check.ts`（:1976 `fs.readFileSync(path.join(tasksDir, f))` + :2407/:2485/:2517）与 `slot-refill.ts`（:466 `fs.readFileSync(...)` + :469 `readFrontField(...status)`）都从**主检出 disk 的 `tasks/*.md`** 读 task status。但主检出是 manager 工作分支（main/manager-doc），**落后 develop 20 提交**（已分叉 1 领先 + 20 落后）——task landing（worktree → task 分支 → ff develop）直接进 develop，不回主检出 ⇒ 主检出的 status 是陈旧值。

**实证 2026-08-29**：`gap-ready-pool-notyflipped-allchecked-leftover-worktree-exemption` 落地后 flip-done 已进 develop（8d5ffa30e「翻 done」，`git show develop:该任务 = status:done`），但主检出仍是 ready ⇒ dispatch 读主检出见 ready≠done ⇒ 落地后重派 3 次撞 retry cap ⇒ needs-human。同类 drift 还有 `gap-retire-halt-file-driver-based`（主检出 ready / develop done）。

**根因**：dispatch 的读面应是单一正源 develop，不是 manager 工作分支的 working tree。工作分支天然落后/分叉，把它当读面 = 让 dispatch 依赖「manager 记得同步」——这正是当前缺陷（硬规则 4b：读面是代理量，develop 是直接量）。

## Plan

dispatch 的 task status 读源从「主检出 disk」改「develop git ref」——复用/推广 worker-driver.ts:2029 已有的 `readTaskStatusAtRef(root, "develop", id)`（或等价 `git show develop:tasks/<id>.md`），ready-pool-check 与 slot-refill 的 status 读面都走它。body/AC 读面同理（Touches/dispatch 判定读 develop 版任务体，非主检出 disk）。⛔ 不做 (甲) 主检出 ff 同步——它是 band-aid，读 develop ref 一次性根除。

## Acceptance Criteria

- [x] AC1（能取假，主修）：构造「主检出 status=ready、develop status=done」的 case（git 层面 stale 主检出）→ dispatch 按 develop 判 done、不重派该任务；（⛔ 仍按主检出 ready 重派 ⇒ 假）。— 单测 `dispatch reads task status from the develop ref, not the stale working tree (AC1/AC3)`：`readTaskStatusAtRef(root,"develop",id)=done` 且 `analyzeTasks({taskReadRef:"develop"})` 不含该任务；负控制 `analyzeTasks({})`（旧 disk 读）仍见 ready（rDisk.ready 含 id，即缺陷形状）。
- [x] AC2（能取假，回归）：fresh 任务（主检出与 develop 同 status）→ dispatch 正常判定，不受读源改影响。— 既有 ready-pool-check 129 + slot-refill 113 全绿（plain-dir fixture 无 develop ⇒ `readTaskFileAtRef` 返回 null ⇒ 回退 disk，行为不变）；我的 AC1 测试的负控制分支也覆盖「同 status 读源一致」路径。
- [x] AC3（能取假，单测）：ready-pool-check.test.mjs / slot-refill.test.mjs 断言「主检出 stale 时按 develop 判定」+「读源 = develop ref 非 disk」，改掉任一 ⇒ 红。— 两个测试各新增一条：直接断言 `readTaskStatusAtRef/readTaskFileAtRef` 读 develop（done）而 `fs.readFileSync` 读 stale（ready）；把 `analyzeTasks`/`analyzeSlotRefill` 的 `taskReadRef` 接线去掉（或忽略该参数）⇒ `rDev.ready.includes(id)===false` 断言翻转 ⇒ 红。

## Definition of Done

dispatch 读面（ready-pool-check + slot-refill）的 task status/body 改读 develop git ref；AC1-AC3 全勾；全量 suite 绿；落地任务不再因主检出陈旧 status 被重派（gap-ready-pool 类 defect 根除）。

## Touches

- plugin/scripts/ready-pool-check.ts（status/body 读面改 develop ref）
- plugin/scripts/slot-refill.ts（status 读面改 develop ref）
- plugin/scripts/task-schema.ts（若 readTaskStatusAtRef 推广落点在此）
- plugin/test/ready-pool-check.test.mjs（AC3 单测）
- plugin/test/slot-refill.test.mjs（AC3 单测）
- tasks/gap-dispatch-reads-stale-main-checkout-task-status.md（自身）
