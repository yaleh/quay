---
id: gap-a-token-held-by-nobody-can-starve-a-live-waiter
title: "The heavy-op token can be held by a dead pid indefinitely while a live waiter starves — 12 suite attempts, zero acquisitions"
status: todo
labels:
  - gap
  - milestone-candidate
extra:
  schema: v1
---

**type:** execution

## Proposal

内层 fan-in 需要一次绿套件。套件走 `scripts/test.sh` → heavy-op token。**连续 12 次尝试全部没跑成**
（`/tmp/batch7-suite5|7|9|10|11|12.log`）。中止原文（`batch7-suite11.log`，逐字）：

```
heavy-op-token: HELD by archguard (pid 3103154 dead, mtime only 8s old) — NOT stale:
  reclaim needs BOTH mtime timeout AND dead pid — quay did not acquire
waited_ms=0 acquired=no
scripts/test.sh: heavy-op token HELD by another project — not running the full suite
```

**读一遍这句话就能看出问题：`pid 3103154 dead`。持有者已经死了——此刻没有任何进程在做重活——
而一个活着的、要做重活的等待者拿不到令牌。**

### 机制：两个条件的 AND 在对面 churn 时变成无界饥饿通道

回收判据是 `mtime 超时(30s)` **AND** `pid 不活`（脚本 44-46 行有明确注释，设计意图是
**保护一个合法长跑的持有者不被误抢**）。但实测下来：

| 时刻 | holder | pid 状态 | mtime 时龄 | 能否回收 |
|---|---|---|---|---|
| 19:42Z | archguard 2898949 | 死 | 405s | 可（外层实测，随后 quay 确实抢到） |
| 19:47Z | archguard 2917738 | 死 | 380s | 可 |
| 20:22Z | archguard 3103154 | **死** | **8s** | **否——mtime 没长到 30s** |

**archguard 每几秒重取一次，每次重取都刷新 mtime。** pid 一直是死的，但 **mtime 永远长不到阈值**，
于是 quay 永远等不到那个可回收的窗口。`stale_reclaims` 从 7 涨到 11 说明回收确实在发生——
**只是每次都被下一次 churn 抢在前面。**

**关键推论：一旦 pid 已确认死亡，mtime 宽限期就不再保护任何东西**——一个死进程不可能是
「合法长跑的持有者」。宽限期真正要防的是**刚写完令牌、进程尚未可见**的竞态，那是**首次**获取后的
一个短窗口，**不是每次重取都该重新开始计时**。

### 代价（真实分母）

**12 次套件尝试、约 40 分钟、三个任务（cold8 / checkers / sl2）的 fan-in 全部停摆**——
三者代码早已合入 master（`353dfe69` / `c92f72db`），卡的只是关闭前那次绿套件。
**内层因此先后走进两条死路**：二分「后台任务能活多久」、用 Monitor 等一个永不到来的空闲事件
（见 `gap-token-status-reports-a-dead-holder-as-busy` 的活体事故）。

## Contract

```
measure starve_attempts = 连续 `--acquire <p> --timeout 0` 失败次数字段
measure held_by_dead_ms = `--status` 中 holder pid 已死却仍持有的累计毫秒字段
band held_by_dead_ms = <30000
invariant 持有者进程已确认死亡时，令牌不保护任何正在进行的重活；等待者必须能在有界时间内获得它
invoke `bash plugin/scripts/heavy-op-token.sh --acquire quay --timeout 0`
control A 持续每 5 秒重取并立即死亡 ⇒ B 必须在有界时间内拿到（不得无限饥饿）；A 活着长跑 ⇒ B 必须拿不到
resume 先用可复现夹具重现饥饿，再改判据
```

## Chosen mechanism

**先重现，再改。** 顺序照搬本仓已生效的教训：一个从没重现过饥饿的修复，与「碰巧不再发生」不可区分。

1. **夹具重现**：A 每 5 秒 `--acquire` 一次并立即退出（模拟 archguard 的 churn），
   B 每秒 `--acquire --timeout 0`。**当前实现下 B 必须饿死**——这是修复前的必备证据。
2. **改判据（择一并写明理由）**：
   - **首次获取计时**：mtime 宽限期从**该持有者首次获取**起算，重取不重置——
     churn 因此无法无限延长宽限期；
   - 或**死亡即可回收 + 极短固定宽限**（如 2s），只覆盖「刚写完、进程尚未可见」的竞态。
   **不做**：不移除 pid 存活检查（它是保护长跑持有者的那一半，见脚本 44-46 行注释）；
   不加后台清扫守护进程（本仓已裁定懒回收是对的）。
3. **等待者要能表达意图**：`--acquire` 带 `--timeout > 0` 时应在等待期内**持续重试**，
   而不是一次判定即返回——否则每次获取都是一场裸竞态。

## Acceptance Criteria

- [ ] AC1: **饥饿重现夹具**——A churn + B 轮询，**当前实现下 B 在 N 秒内零次获取**（实跑输出贴任务体）
- [ ] AC2: **修复后同一夹具** ⇒ B 在**有界时间内**获得令牌，界写进任务体（实跑输出贴任务体）
- [ ] AC3: **反向负控制（不得误抢）**——A **活着**且长跑（如 sleep 120）时，B 必须**始终拿不到**；
      **这一条不过，AC2 不算数**（否则就是把饥饿换成误抢，而误抢会杀掉别人正在跑的重活）
- [ ] AC4: **死持有者上界**——持有者 pid 已死时，`held_by_dead_ms` 有上界且 < 30s（实测贴出）
- [ ] AC5: **重取不重置宽限期**（若采用方案一）——同一持有者连续重取 5 次，
      宽限期仍从首次起算（实跑输出贴任务体）
- [ ] AC6: 测试用 `node:test` 且带 `// @test-group governance`，扩进 `plugin/test/heavy-op-token.test.mjs`

## Definition of Done

- [ ] AC1 与 AC3 两个方向的实跑输出都贴进任务体——
      **只证明「不再饥饿」而不证明「仍不误抢」，是把一个吵闹的等待换成一次静默的中断**
- [ ] 完整套件连跑 2 次全绿（若只到 1 次，如实标 `[~]` 并写明）
- [ ] 任务体记录真实分母：**12 次尝试、约 40 分钟、三个任务 fan-in 停摆**

## Touches

- plugin/scripts/heavy-op-token.sh
- plugin/test/heavy-op-token.test.mjs

## Dispatch review

reviewer: outer
at: 2026-08-03T20:22:00Z
changed: 外层查 AC9c 命中（套件进程消失而三个 worktree 仍干净，正是我上一 tick 预登记的恢复条件）
时读到内层的重试循环，逐条量清了机制：**回收判据的 AND 在对面高频 churn 时变成无界饥饿通道**，
并用三个时刻的实测（405s 可回收 / 380s 可回收 / **8s 不可回收**）证明**不是运气，是机制**。
**最尖锐的一句写进了 Proposal**：`pid 3103154 dead`——**令牌此刻谁也没在用，而活着的等待者拿不到**；
**一旦 pid 确认死亡，mtime 宽限期就不再保护任何东西**，因为死进程不可能是合法长跑的持有者。
**预先堵住两条最省事的错误修法**：不许移除 pid 存活检查（那是保护长跑那一半）、
不许加后台清扫守护进程（本仓已裁定懒回收是对的）。
**AC3 是本任务的真判据**：把饥饿换成误抢会杀掉别人正在跑的重活——
**一个吵闹的等待换成一次静默的中断**，后者更糟。明写「AC3 不过则 AC2 不算数」。
**归属说明**：脚本在本仓，所以修在这里；但**触发方是 archguard 每几秒重取并立即死亡**，
那是跨项目行为，**不在本任务范围内**，已作为独立观察上报管理者。
