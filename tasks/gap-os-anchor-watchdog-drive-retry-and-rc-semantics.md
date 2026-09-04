---
id: gap-os-anchor-watchdog-drive-retry-and-rc-semantics
title: "os-anchor-watchdog AC2 real-run exposed 2 defects: drive SKIPPED
  (transcript timing race — new claude jsonl not ready at relaunch, cold-start
  text never sent) + rc=1 RECOVERY-FAILED (drive temp-fail makes service FAILURE
  though relaunch succeeded); fix drive retry + rc semantics so relaunch-success
  + drive-pending exits 0"
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

**AC2 真实 kill 验证（2026-08-05 11:40，外层执行）暴露 watchdog 两个缺陷**：
kill archguard-4:outer claude 后，watchdog 在下一 timer 周期（11:40:08）正确：
- ✅ **检测死亡**：`STATUS archguard relaunch-outer (alive=0 session=1)`
- ✅ **重拉 claude**：`relaunch/launch OK — archguard-4:outer prompt up (re-spawned)`（新 claude 2284029）

但**两个缺陷**：
1. **drive SKIPPED（transcript 时序竞态）**：`drive_outer` 在 relaunch 后立即调 `transcript_for`，要求 `newest_ts > base_ts`（找比 launch 前更新的 jsonl）。但新 claude 刚启动、jsonl 还没创建（或 mtime 未超过 base_ts）→ `transcript_for` 返回空 → `drive SKIPPED — no transcript found` → **AC2 的「+ send-keys-reliable 驱动冷启动文本」未满足**。新 claude 停在欢迎界面（`Try "write a test..."`），冷启动文本没发。
2. **rc=1（service FAILURE）**：drive 失败 → `drive_outer` return 1 → `relaunch_outer` return 1 → `STATUS archguard RECOVERY-FAILED (relaunch-outer rc=1)` → `systemctl --user status` 显示 **Active: failed**。重拉其实成功，但 drive 失败使整个 service 报错。

**修复方向**：
1. **drive 重试**：relaunch 后不立即 drive，改为等待新 claude jsonl 出现（轮询几秒），或 drive 失败不立即放弃（记录 + 下一 tick 重试）。`drive_outer` 已注释「drive retries next tick」但 rc=1 使 service 失败，应该**非致命**。
2. **rc 语义**：drive 失败（transcript 未就绪）是**临时状态**（下一 tick 会重试），不应使 service 报 FAILURE。重拉成功 = 核心已达成，drive 失败应返回 0（或单独标记，不 fail service）。

**注意**：`drive_outer` 里 `[ -x "$skr" ] || return 1`（项目没 quay-init'd 时返回 1）——这个应保留（真错误），但「transcript 未就绪」是临时态，应区分。

**交叉标注（2026-08-05，gap-send-keys-reliable-welcome-screen-ghost-drive-fails AC3）**：watchdog 11:40 drive 失败的**真根因**是 fresh welcome 屏的 ghost 文本（`❯ Try "fix lint errors"` = 真实可见文本，C-u 清不掉）使 send-keys-reliable 清屏循环跑满 CLEAR_MAX=50 fail loud rc=1。send-keys-reliable.sh 已修：fresh session（target transcript 不存在或零条 user 消息）⇒ SKIP 清屏循环直接发（`--is-fresh` 纯判定）。**watchdog 驱动依赖此修复**——cold-start 用它驱动 fresh 内层时不再在 welcome 屏 fail loud；本任务修 drive 重试 + rc 语义时须一并验证 fresh 屏场景不回归。

## Acceptance Criteria

- [ ] AC1: relaunch 后 drive **重试而非立即放弃**——新 claude jsonl 出现前 drive 标记「待重试」不返回 1（service 不 FAILURE）；jsonl 出现后自动驱动成功
- [ ] AC2: **重拉成功但 drive 临时失败 ⇒ service 返回 0**（核心达成不算失败）；真错误（如缺 send-keys-reliable.sh）才返回 1
- [ ] AC3: 实测：kill archguard outer → watchdog 检测 + 重拉 + **最终驱动成功**（新 claude 收到冷启动文本，transcript 出现 user message）——完整 AC2 闭环
- [ ] AC4: 与 gap-loop-has-no-os-level-anchor 任务 AC2 交叉标注（本任务修后该 AC 可勾）

## Touches

- plugin/scripts/os-anchor-watchdog.sh（drive 重试 + rc 语义）
- plugin/test/os-anchor-watchdog.test.mjs（扩展覆盖 drive 时序 + rc 语义）
- tasks/gap-loop-has-no-os-level-anchor-cannot-self-recover-after-crash.md（AC4 交叉标注）

## Contract

measure   ac2_recovery = `journalctl --user -u quay-os-anchor-watchdog.service --since "1min ago" 2>&1 | grep -c "drive SKIPPED\|RECOVERY-FAILED"` stdout 数字段
band      ac2_recovery = 0（修后无 drive-skipped 且无 RECOVERY-FAILED）
invoke    `bash plugin/scripts/os-anchor-watchdog.sh --decide 0 1 0`
control   kill archguard outer（AC2 真实测试）⇒ watchdog 重拉 + 驱动成功（AC3）；relaunch 后 drive 临时失败 ⇒ service exit 0（AC2）
resume    drive 重试与 rc 语义分步提交，任一步完成即写盘

## Dispatch review

reviewer: none
at: 2026-08-05
changed: AC3 交叉标注——send-keys-reliable-welcome-screen-ghost-drive-fails：fresh welcome 屏 ghost
文本（`❯ Try "..."` 真实可见文本，C-u 清不掉）是 watchdog 11:40 drive 失败的真根因；
send-keys-reliable.sh 已加 fresh-session SKIP 清屏分支（target transcript 不存在/零 user 消息
⇒ 直接发，不再 CLEAR_MAX fail loud）。watchdog 驱动依赖此修复，本任务修 drive 重试 + rc 语义时
须验证 fresh 屏不回归。仅交叉标注，未改 status/AC/DoD。