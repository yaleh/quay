---
id: gap-session-liveness-scd-busy-disabled-composite-emit-flaky
title: 修 scd-busy 鲁棒性：disabled composite emit 时序断言在 serial+降并发下仍 flaky，挡退役 tmux 任务
status: superseded
labels:
  - gap
  - defect
parent: null
children: []
extra:
  superseded: true
  superseded_at: 2026-09-03
  superseded_reason: session-liveness 退役（gap-retire-session-liveness）将删除
    scd-busy.test.mjs，本任务「修 scd-busy 鲁棒性」的修改对象消失，多余——退役是更彻底的解法（删测试连同 flaky
    根因一起消）
  schema: execution
---
## Proposal

`session-liveness-scd-busy.test.mjs` 的「true-disabled phase」断言在 serial 相 + `max_oversubscription=1` 降并发下**仍 flaky**：`live.kill("SIGKILL")` 杀掉 worktree 里 `sleep` 进程后，断言 10 秒内 monitor 输出 `SESSION-DISABLED scd-g`（④ flips true → composite emits），但 10 秒内 monitor 未检测到「worktree 不再 busy」而失败（断言文本「after the worktree process dies (no longer busy) the disabled composite MUST emit — ④ can take true」）。

**竞态在「monitor 检测 worktree 进程死 → ④ 翻转 → emit」的时序，非并发**——调相（移 serial）+ 降并发（max_oversubscription=1）均已证否，仍 flaky。反复误杀 mechanical-fan-in / test-file-snapshot 等无关任务的 fan-in（suite red → retry cap → needs-human）。

**且挡住「退役 tmux 的任务」**：tmux 退役任务会碰 session-liveness 测试，其 fan-in 同样会被 scd-busy flaky 挡——不修 scd-busy 鲁棒性，退役 tmux 的任务无法执行（本轮人裁定）。

## Plan

1. 定位 flaky 时序：`live.kill("SIGKILL")` 后，monitor 检测「worktree 进程死」（④ flips true）的轮询/检测逻辑，确认 10 秒内为何未完成（是检测轮询间隔过长、还是 SIGKILL 后 /proc 状态清理延迟）。
2. 修：优先修「测试自身的等待鲁棒性」（`waitForOutput` 的重试/超时，容忍检测延迟），不轻易动 monitor 的检测语义（那会改变生产行为）；若根因确在 monitor 检测逻辑的竞态，再改 monitor。
3. 回归：饱和下 scd-busy 不再 flaky。

## Acceptance Criteria

- [ ] AC1（能取假）：饱和下 scd-busy 连续 N 轮（N≥3）不再因「disabled composite emit」失败；N 只计落地后（硬规则 4 推论三）。
- [ ] AC2（负控制，能取假）：busy phase「不 emit」（live 进程在 worktree 里 ④=false）仍被正确断言，不因加重试/加长超时而误放行。
- [ ] AC3（既有不回归）：全量 suite 绿。

## Definition of Done

scd-busy 的「disabled composite emit」断言在 serial 相 + 降并发下不再 flaky；mechanical-fan-in / test-file-snapshot 的 fan-in 不再因 scd-busy flaky 被挡；「退役 tmux 的任务」的前置（suite 里无 session-liveness flaky 挡路）满足。

## Touches

- plugin/test/session-liveness-scd-busy.test.mjs（修时序断言 / 等待鲁棒性）
- tasks/gap-session-liveness-scd-busy-disabled-composite-emit-flaky.md（自身）
