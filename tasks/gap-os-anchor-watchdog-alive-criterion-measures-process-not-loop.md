---
id: gap-os-anchor-watchdog-alive-criterion-measures-process-not-loop
title: "os-anchor-watchdog alive criterion measures process-exists not
  loop-running (AC10 +1, manager 11:52Z): archguard stalled (transcript stopped)
  but watchdog noop healthy — same axis as gap-l2 (judges
  'installed/in-existence' not 'turning'); fix: alive = process AND
  (transcript-new OR git-commit) + cross-cycle relaunch-failed-drive marker"
status: superseded
labels:
  - gap
  - defect
parent: null
children: []
extra: {}
---

> **【作废 — 2026-08-06 人裁定，两条独立理由，任一条即足以作废】**
>
> 1. **「不得重启 watchdog。请专注于以产品化方法改进」** ⇒ 本条要修的装置**不得再运行**。
> 2. **「会话真死不要管。我明确这不在本项目需要监控和恢复的范围内」** ⇒ 本条要修的装置的
>    **目的本身**（探测会话死亡并拉回）**已被移出项目范围**。
>
> ⇒ 修好它也不会被使用。**实测佐证（2026-08-06 17:5xZ）**：os-anchor watchdog 当前
> **0 个 systemd unit、0 条 os crontab 条目、0 个进程**——装置已完全停摆。
>
> **不删除本文件**：保留缺陷描述，因为若将来范围重新放开，这些实测缺陷仍然成立、
> 不必重新发现。**但不得派发**（`status: superseded`）。
>
> 完整裁定记录见 `tasks/gap-manager-productization-five-constraints.md` 的 AC5/AC5b/AC5c。
**type:** execution

## Proposal

**watchdog alive 判据量化「进程存在」而非「循环在跑」——AC10 记账 +1（管理者 11:52Z 实测）**：

**实测**：archguard outer 停摆（transcript 停 11:38:27、最后提交 09:01Z tick #58），但 watchdog 11:50:51 判
`noop (alive=1 session=1)` + `healthy`——**进程活着，循环没在跑**。watchdog 头注释 31 行明确
`alive=1 → noop (healthy — nothing to do)`，而 alive 实现是 `pane_has_claude`（pgrep claude 进程存在）。

**为什么严重**：这是 11:40:09 RECOVERY-FAILED（relaunch 成功但 drive 失败）的直接后果——watchdog 忘
记了自己刚失败过：11:40 relaunch 出空会话 + drive 失败 rc=1；11:50 看见「进程在」就报 healthy。
**两个周期之间没携带「该项目被重启过但从未被驱动」状态**。未驱动空会话与正常会话在它判据下完全一样。

**同型复发**：gap-l2-continuous-health-dead-loop-criterion-loop-running-not-installed（07:01 立案：
meta-cc/archguard 停摆 29h 而交付面检查全绿）——**同一根轴：判据量化「装没装/在不在」，不量化
「转没转」**，这次长在刚落地的 watchdog 上。

**修复（管理者建议，两条一起）**：
1. **alive 判据补一维**：进程存在 **且**（transcript N 分钟内有新增 **或** 该项目 git N 分钟内有提交）。
   transcript 和 git 两个信号今晚反复验证可信（transcript 0 次误判；pane 哈希 3 次假阳、heartbeat
   冻结 42 分钟——不要用后两者）。
2. **跨周期状态**：relaunch 成功但 drive 失败时写标记，下周期读到该标记就**不判 healthy，直接重试
   驱动**——否则 recovery 只有一次机会，失败即永久静默。

## Acceptance Criteria

- [ ] AC1: alive 判据含循环推进信号——进程存在 且（transcript 新增 或 git 提交），仅进程存在不算 alive
- [ ] AC2: relaunch 成功但 drive 失败写标记，下周期读到不判 healthy 直接重试驱动（recovery 多次机会）
- [ ] AC3: 实测负控制：archguard 停摆（进程在、transcript 停）⇒ watchdog 判非 healthy（不再误报）
- [ ] AC4: 与 gap-l2-continuous-health 交叉标注（同型：判据量化在不在不量化转没转）

## Touches

- plugin/scripts/os-anchor-watchdog.sh（alive 判据 + 跨周期标记）
- plugin/test/os-anchor-watchdog.test.mjs（AC1-AC3 测试）
- tasks/gap-l2-continuous-health-dead-loop-criterion-loop-running-not-installed.md（AC4 交叉标注）

## Contract

measure   false_healthy = `bash plugin/scripts/os-anchor-watchdog.sh --check archguard 2>&1 | grep -c 'noop\|healthy'` stdout 数字段（archguard 停摆时）
band      false_healthy = 0（修后停摆项目不报 healthy）
invoke    `bash plugin/scripts/os-anchor-watchdog.sh --check archguard`
control   进程在但 transcript 停（archguard 现状）⇒ 修后判非 healthy（AC3）；进程在且 transcript 新增 ⇒ healthy
resume    alive 判据与跨周期标记分步提交，任一步完成即写盘
## Dispatch review

reviewer: none
at: 2026-08-05T18:2xZ
changed: contract-ratchet compliance，外层 18:2xZ 补齐（未审）
