---
id: gap-dispatch-gate-blind-to-inflight-merge-worktree
title: 派发闸看不见在飞 merge worktree 的冲突面 → 缓派失效（inner 派掉了外层缓派的任务）
status: todo
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

- [ ] AC1: 派发闸把在飞 merge worktree 的 diff 面纳入 touches-overlap 判定
- [ ] AC2: deferred 理由区分「peer task」与「merge-worktree」（不再只报 peer）
- [ ] AC3: 负控制——造一个含 `UU` 的 worktree ⇒ 闸必须把触及这些文件的任务判为 deferred（否则又是「机制建成、零次真触发」——AC36 同下场：轴在、45 条标签在、可派发集合里 0 条）
- [ ] AC4: 既有测试全绿；`--for-task` scoped 门绿

## Definition of Done

- [ ] AC1–AC4 全部勾上
- [ ] 复现用例（merge worktree 在飞 + 外层缓派同文件任务 → deferred 含 merge-worktree 理由）贴出
- [ ] 全量套件绿

## Touches

- plugin/scripts/slot-refill.ts（touches-overlap 判定扩展 merge-worktree 面）
- plugin/scripts/ready-pool-check.ts（deferred 理由区分）
- tasks/gap-dispatch-gate-blind-to-inflight-merge-worktree.md（自身）
