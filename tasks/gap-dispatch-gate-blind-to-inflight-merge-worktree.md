---
id: gap-dispatch-gate-blind-to-inflight-merge-worktree
title: 派发闸看不见在飞 merge worktree 的冲突面 → 缓派失效（inner 派掉了外层缓派的任务）
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

**实证（2026-08-12，vhs-merge 协调事故）**：`slot-refill --json` 的 `deferred` 9 条理由全是
`touches-overlap-in-flight (peer <task>)`——**没有一条提到 vhs-merge worktree**。一棵 merge 中的
worktree 持有一个冲突面（bin/quay.ts/serve.ts/tick-core/闸文件），而派发闸**结构上看不见它**。

**后果**：外层因「与 vhs-merge 同文件冲突」而缓派的任务（cli-import-command-migration、load-fields），
inner 的 slot-refill 链照常派掉了。「缓派」只存在于外层队列里，**没有任何机制表达它**。

**根因**：派发闸的 touches-overlap 判定只覆盖「在飞的任务 worktree」，不覆盖「在飞的 merge worktree」。
merge worktree 在 git 层面可见（`git worktree list`），但其冲突面没被纳入 touches-overlap 计算。

## Plan

1. 扩展派发闸的 touches-overlap 判定：把「在飞 merge worktree」的冲突面（其 diff 到的文件集）纳入。
2. 判定方法：`git -C <merge-worktree> diff --name-only HEAD`（merge 中的未提交面）加入 overlaps 集合。
3. deferred 理由里能显式写出「touches-overlap-in-flight (merge-worktree <name>)」。
4. scoped 绿 → 全量验证轮 → fan-in。

## AC

- [x] AC1: 派发闸把在飞 merge worktree 的 diff 面纳入 touches-overlap 判定
- [x] AC2: deferred 理由区分「peer task」与「merge-worktree」（不再只报 peer）
- [x] AC3: 负控制——造一个含 `UU` 的 worktree ⇒ 闸必须把触及这些文件的任务判为 deferred（否则又是「机制建成、零次真触发」——AC36 同下场：轴在、45 条标签在、可派发集合里 0 条）
- [x] AC4: 既有测试全绿；`--for-task` scoped 门绿

## Definition of Done

- [ ] AC1–AC4 全部勾上
- [ ] 复现用例（merge worktree 在飞 + 外层缓派同文件任务 → deferred 含 merge-worktree 理由）贴出
- [ ] 全量套件绿

## Touches

- plugin/scripts/slot-refill.ts（touches-overlap 判定扩展 merge-worktree 面）
- plugin/scripts/ready-pool-check.ts（deferred 理由区分）
- tasks/gap-dispatch-gate-blind-to-inflight-merge-worktree.md（自身）

## Evidence (inner 2026-08-13)

**实现**：

- `plugin/scripts/ready-pool-check.ts`：新增 merge-worktree 冲突面检测器 `computeMergeWorktreeSurfaces(root)`
  与判定器 `mergeSurfaceBlock(parsed, surfaces, expand)`（deferred 理由区分，AC2）。检测器枚举
  `git worktree list --porcelain`（复用 fast-mode-telemetry 的 `listWorktrees`，非平行解析），跳过主检出，
  对每个在飞 merge worktree（`MERGE_HEAD` 存在 **或** `git ls-files -u` 非空 = `UU` 态）用
  `git -C <wt> diff --name-only HEAD`（merge 的未提交面）取冲突面。判定器用与 peer 臂同一个
  `checkTouchesPair`（merge 面合成 `{hasSection:true, globs:files}`——具体路径不论是否存在都参与比较），
  返回 `{blocked, name}`。`analyzeTasks` 的 `dispatchable_disjoint` 现排除触及 merge 面的候选（判据不再虚高）。
  全程 fail-soft：非 git 根 / 不可读 worktree list ⇒ []，绝不从不可用来源造出 block（硬规则 5）。

- `plugin/scripts/slot-refill.ts`：step-4 check 3 先查 merge 面再查 peer。merge 面在每次 evaluate 算一次
  （`computeMergeWorktreeSurfaces(root)`），候选触及 merge 面 ⇒
  `defer(id, "touches-overlap-in-flight (merge-worktree <name>)")`；仅 merge 面不挡的候选才落到
  `(peer <id>)` 臂。无 merge 在飞 ⇒ 该臂是 no-op（既有 peer 行为字节不变，AC4 负控制）。

**AC3 负控制（真实 UU worktree，实测）**：`/tmp/mwac3` 建真 git 仓库，两分支 `b1`/`b2` 各自以不同内容
add `bin/quay.ts`，`git worktree add --detach wt-merge b1` 后 `git merge --no-commit b2` ⇒
`AA bin/quay.ts`（`ls-files -u` 有 stage 2/3 无 base）→ `git diff --name-only HEAD` = `bin/quay.ts`。
仓库含两个 ready 任务：`gap-merge-collide`（touches `bin/quay.ts (new)`，与 merge 面同文件）、
`gap-free`（touches `serve.ts (new)`，不相交）。`slot-refill.ts --root /tmp/mwac3 --cap 3 --json` 实测：

```json
recommended: ["gap-free"]
deferred: [
  { "id": "gap-merge-collide",
    "reason": "touches-overlap-in-flight (merge-worktree wt-merge)" }
]
```

⇒ `gap-merge-collide` 被 deferred 且理由显式写出 merge worktree（不再只报 peer）；`gap-free` 仍被推荐。
`ready-pool-check.ts --root /tmp/mwac3` 实测 `dispatchable_disjoint: 1`（pool=2 中触及 merge 面的候选不计入）
⇒ 判据也诚实。**非「机制建成、零次真触发」。**

**scoped 门**：`bash scripts/test.sh --for-task gap-dispatch-gate-blind-to-inflight-merge-worktree`（worktree 根）
→ **137 tests, pass 137, fail 0**；scoped 静态检查全 PASS（task-contract-check no violations /
superseded-capability-check / judgment-consumer-check / tick-core-static-check 42+54+44 /
delivery-inventory-drift-gate）。`npx tsc --noEmit -p tsconfig.json` 0 errors。
