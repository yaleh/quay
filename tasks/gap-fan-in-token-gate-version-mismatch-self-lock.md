---
id: gap-fan-in-token-gate-version-mismatch-self-lock
title: L1 token 闸自锁——机械 fan-in 版本错位（旧签发者×新校验者，fan-in-ff-merge.sh 的
  token 闸在 worktree 而注入在主检出旧守护）
status: needs-human
labels:
  - gap
  - defect
  - delivery-critical
parent: null
children: []
extra:
  schema: execution
---
**type:** execution

## Proposal

`gap-fan-in-ff-merge-token-gate-fail-closed`（L1 token 闸）已 needs-human（3× exited-not-landed 至重试上限）。根因不是实现错，是**版本错位**：

- 闸在任务 worktree 的 `fan-in-ff-merge.sh:202-234`（`--acquire-workflow-lock` fail-closed 要求 token）；
- 注入在 worktree 的 `worker-driver.ts:1654-1661`（生成 token + 传参）；
- 但 `runMechanicalFanIn` 的 `scriptsDir` 默认 = worktree/plugin/scripts（`worker-driver.ts:1614`），而**运行中的守护进程是主检出旧代码（无注入）**。

⇒ 旧签发者 × 新校验者：任务自己的 fan-in 用 worktree 的新闸（要求 token），但发起 fan-in 的守护是主检出旧 worker-driver.ts（不注入 token）⇒ 无 token 穿新闸被 fail-closed 拒。

**类级缺陷**：任何「改了 worker-driver.ts 但守护仍是旧的」的任务都会命中——不是 token 闸一例，是「fan-in 脚本从 worktree 加载、但发起者从主检出旧进程运行」的**架构错位**。

## Plan

机制修法（⛔ 不打补丁，四个都做）：

1. **每任务新进程执行**：机械 fan-in 改为每任务起新进程执行（加载当前代码），消灭「改了 worker-driver.ts 但守护是旧的」整个类。
2. **token 改数据文件**：token 在 dispatch 时以 per-task 数据文件生成、fan-in 读文件传参（不依赖进程内状态）。
3. **落地顺序**：注入半先合入 develop + 守护吃到新代码，再让闸半合入（闸的 fan-in 已带 token，不自锁）。
4. **AC2 用真实穿闸 dry-run 验证**：真实机械 fan-in 穿真实闸 dry-run，而不是只测「注入存在」。

**当前 needs-human 处置**：L1 需先撤回（retreat）、注入半合入后重派。

## Acceptance Criteria

- [ ] AC1（能取假，版本错位已消）：改了 worker-driver.ts 的任务 fan-in 不再因「守护旧代码」而用旧注入/旧闸（⛔ 仍版本错位 ⇒ 假）。
- [ ] AC2（能取假，真实穿闸）：真实机械 fan-in 穿真实 token 闸 dry-run 通过（⛔ 只测「注入存在」/fixture-only ⇒ 假，硬规则 4 推论三）。
- [ ] AC3（能取假，不自锁）：token 闸任务自己的 fan-in 带 token 通过闸（⛔ 自锁 needs-human 再现 ⇒ 假）。

## Definition of Done

每任务新进程 + token 数据文件 + 落地顺序（注入先于闸）落地；AC1-AC3 全勾；L1 撤回重派后不再自锁。

## Touches

- plugin/scripts/worker-driver.ts（每任务新进程 + token 数据文件 + scriptsDir 加载当前代码）
- plugin/scripts/fan-in-ff-merge.sh（闸半 + 读数据文件 token）
- plugin/test/fan-in-driver-mechanical-orchestration.test.mjs（新进程 + 真实穿闸 dry-run）
- plugin/test/fan-in-ff-protocol-check.test.mjs（token 闸协议）
- plugin/test/worker-driver.test.mjs（token 注入 + 新进程）
- tasks/gap-fan-in-token-gate-version-mismatch-self-lock.md（自身）

## Needs-Human

**执行 2026-08-28T14:40:28.870Z — 连续修满重试上限仍不合格（标 needs-human）**

- 阻碍原因：worker-driver 连续 3 次 exited-not-landed 未落地（重试上限）
