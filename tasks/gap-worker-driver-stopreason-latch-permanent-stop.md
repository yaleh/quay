---
id: gap-worker-driver-stopreason-latch-permanent-stop
title: worker-driver stopReason 一旦赋值永不复位 ⇒ 瞬时闸拒绝被永久 latch ⇒ 1h48m 零派发（234 槽·分钟 ≈
  3.4 条任务损失，正在复发）
status: done
labels:
  - gap
  - defect
  - delivery-critical
parent: null
children: []
extra: {}
---
**type:** execution

## Proposal

**根因（manager 2026-08-24 07:0xZ 定位，证据=driver 心跳载体 `.quay/worker-round.jsonl` 直接量，非自述）**：`worker-driver.ts:1203-1241` 派发循环里 `stopReason` 一旦赋值就**永不复位**——`:1203` `while (running.length < cap && !stopReason)` 的 `!stopReason` 恒假 ⇒ 内层 while 体再不执行 ⇒ `stopCondition()` 再不被调用 ⇒ 那次瞬时拒绝的读数被永久冻结。

**证据（现读，非历史）**：04:37:02 dispatch in_flight=5 → 05:09:52 stop in_flight=4 stop_reason=resource-gate-wait{cpu73.33 load44.82} → 之后 05:17/05:21/05:50/06:23 四条 stop 的 stop_reason **逐字节相同**、in_flight 3/2/1/0 → 06:23:11 supervisor 重启 driver（新 pid 4044391）→ 06:30:15 立刻派满。

**负控制（排除「无货可派」）**：停摆窗口内 promotion-driver 晋升 6 条 ready（ac151-155 + tmux-tmpdir），4 个 worker 释放槽位 ⇒ 有货有槽就是不派。

**⊢ 逐字节不变的「实时读数」= 该读数未被重采集，与「系统稳定」同形**（硬规则 4 变体）。

**三个 stopReason 触发条件全是瞬时、无一个该 latch**：`resource-gate-wait`（名字含 WAIT，负载高恰因 5 worker 在跑、worker 结束负载降但闸再没被读——自我锁死反馈环）/ `pool-empty`（promotion-driver 持续补池）/ `mcp-halt`（人可解除）。

## Plan

1. **区分 WAIT 与 STOP**：瞬时闸拒绝（resource-gate-wait / pool-empty）应让本轮不派、下一轮重新评估（stopCondition 每次重读），⛔ 不写进永久 latch；只有真终态（人 halt 且明示终止）才 latch。
2. **running.length===0 时不要直接 break 退出**：池非空或闸可能已放行时退出 = 把「恢复」外包给 supervisor 重启。

## Acceptance Criteria

- [x] AC1（能取假，WAIT 不 latch）：构造一轮闸先拒后放行，断言同一个 driver 进程【不重启】前提下恢复派发（stopReason 不复位即恒不派 ⇒ 假）。
- [x] AC2（能取假，读数重采集）：`worker-round.jsonl` 相邻两条 `stop` 记录的 resource 读数**不得逐字节相同**（恒定读数 = 未重采集）。
- [x] AC3（能取假，不假退出）：pool 非空时 running.length===0 不直接退出；构造「池非空 + 闸刚放行」轮，断言 driver 不退出而是继续派发。

## Definition of Done

WAIT/STOP 区分 + 不假退出落地 develop；AC1-3 全勾；一个 driver 进程在闸先拒后放行场景下不重启连续派发（AC1 复现）；worker-round.jsonl 相邻 stop 读数不再逐字节相同（AC2）。

## Touches

- plugin/scripts/worker-driver.ts（stopReason latch / stopCondition 调用点 / running.length===0 退出）
- plugin/test/worker-driver.test.mjs（AC1-3 复现）
- tasks/gap-worker-driver-stopreason-latch-permanent-stop.md（自身）