---
id: gap-fan-in-ff-merge-token-gate-fail-closed
title: fan-in-ff-merge.sh --acquire-workflow-lock 加 token 闸——非 driver 一次性 token
  者 fail-closed（掐死所有非机械路径，L1）
status: needs-human
labels:
  - gap
  - defect
  - delivery-critical
parent: null
children: []
extra:
  schema: execution
  depends_on:
    - gap-fan-in-continue-prompt-not-migrated-to-mechanical
---
**type:** execution

## Proposal

`fan-in-ff-merge.sh --acquire-workflow-lock` 加调用者校验：只认 worker-driver 注入的一次性 token，非携带者 fail-closed。这一个缝掐死所有非机械路径（文件可再建、agent 可现写脚本，无锁永远 ff 不了 develop）。

**前置（⛔ 硬依赖，先于 L0 完成）**：续做 prompt 迁移到机械（`gap-fan-in-continue-prompt-not-migrated-to-mechanical`）。若 L1 先落，续做 prompt 还在派 workflow ⇒ workflow 调 `--acquire-workflow-lock` 无 token 被 fail-closed 拒 ⇒ 语义兜底直接全断（比 A6 假红更硬的断链）。

**配套（driver 侧，同任务）**：全机械化后 suite 由 driver 直接 spawn（父子关系已有）；任务 not-landed 时 driver killTree 其 suite——僵尸占槽形态一并消失。

**⛔ 边界（人裁定迁移序 L0→L1→L2→L3）**：本任务是 L1，依赖 L0（续做迁移）先落。

## Plan

1. `fan-in-ff-merge.sh --acquire-workflow-lock` 加 token 校验（worker-driver 注入一次性 token，非携带者 fail-closed）。
2. `worker-driver.ts` 注入 token + 传参。
3. 「未携带 token」拒绝必须有可区分输出（⛔ 不与其它 acquire 失败同形，硬规则 3b），判据只从 L1 生效时刻起计窗（⛔ 拿生效前 fm- 事件误判，硬规则 4 推论三同族）。

## Acceptance Criteria

- [ ] AC1（能取假，非机械路径被拒）：无 token 的 `--acquire-workflow-lock` 调用 fail-closed（⛔ 放行 ⇒ 假）。
- [ ] AC2（能取假，机械路径不受阻）：driver 注入 token 的机械 fan-in acquire 正常（⛔ 被误拒 ⇒ 假）。
- [ ] AC3（能取假，可区分输出 + 计窗）：未携带 token 的拒绝输出可区分（非「exit null」同形），判据只从 L1 生效时刻起计窗（⛔ 拿生效前 fm- 事件误判 ⇒ 假）。

## Definition of Done

token 闸落地；AC1-AC3 全勾；非机械路径无法 acquire workflow 锁；机械路径正常；僵尸 suite 由 driver killTree 清理。

## Touches

- plugin/scripts/fan-in-ff-merge.sh（--acquire-workflow-lock token 校验 fail-closed）
- plugin/scripts/worker-driver.ts（注入 token + 传参 + not-landed killTree suite）
- plugin/test/fan-in-ff-protocol-check.test.mjs（token 测试缝）
- plugin/test/fan-in-driver-mechanical-orchestration.test.mjs（token 测试缝）
- plugin/test/worker-driver.test.mjs（token 注入 + killTree）
- tasks/gap-fan-in-ff-merge-token-gate-fail-closed.md（自身）

## Needs-Human

**执行 2026-08-27T21:33:59.347Z — 连续修满重试上限仍不合格（标 needs-human）**

- 阻碍原因：worker-driver 连续 3 次 exited-not-landed 未落地（重试上限）

**⛔ 重派裁定（2026-08-28 人裁定）**：等 `gap-adr034-fan-in-lock-holder-supervised`（ADR-034）落地后重派——3 次失败根因是同一孤儿持锁问题（gap-path-join 孤儿 holder ~21:48 释放前排队等锁触顶重试上限），非代码缺陷（worktree 内 AC 3/3 已勾）。ADR-034 根治后重派；且 P2（`gap-execution-loop-productization-p2-p4` AC1）吸收含本任务 token 闸语义，落地后别丢。
