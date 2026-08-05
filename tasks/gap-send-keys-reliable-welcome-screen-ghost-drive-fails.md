---
id: gap-send-keys-reliable-welcome-screen-ghost-drive-fails
title: "send-keys-reliable pane-empty check fails on welcome-screen ghost text
  (Try \"fix lint errors\" = real visible text, C-u can't clear, CLEAR_MAX=50
  fail-loud) — the TRUE root of watchdog 11:40 drive failure; NBSP fix (11:46
  sync) doesn't cover it; fix: fresh-session (no transcript/zero user msgs)
  skips clear-loop, sends directly (archguard manual seq proven)"
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

**send-keys-reliable 判空不覆盖 welcome 屏 ghost 文本——watchdog 11:40 驱动失败的真根因（管理者复核确认）**：

**实测（archguard 第一份交付验证数据）**：NBSP 修复版在 fresh welcome 屏**仍然失败**。`pane_input_box_empty`
只显式剥 NBSP 两字节 + ANSI，然后 `case *[![:space:]]*` 判非空。而 welcome 屏 `❯ Try "fix lint errors"`
的 ❯ 后有**真实可读文本**（UI 渲染层的 ghost suggestion）——必然判非空，C-u 清不掉 → 死循环跑满
CLEAR_MAX=50 → fail loud → rc=1。

**两个失败场景不同**：NBSP 修复覆盖「空框渲染成 ❯+NBSP」；watchdog 撞的是「welcome 屏 ❯ 后有真实
ghost 文本」。11:46 同步 NBSP 修复版过去**没有修好这个**。

**修法（archguard 手工序列已验证成功）**：判空不应试图「清空」ghost 占位符（清不掉），而应把
**fresh session（transcript 不存在或零条 user 消息）当成已知分支【跳过清屏直接发】**。

**优先级（管理者 13:3xZ 裁定）**：这是 **AC12b（产品主判据，两层无人干预区间）的唯一硬阻塞**——
B 机（orangevps）是唯一干净测量场，但 fresh-session 分支命中 0，welcome 屏缺陷原封不动，cold-start
INNER-DRIVEN 用它驱动内层。**排在任何其它任务之前**。

**AC11 一族**：管理者 11:46 说「已同步并校验一致」是真的，但隐含断言「问题已解决」没验证。

### 选定机制

1. `send-keys-reliable.sh`：检测 fresh session（目标 transcript 不存在 或 零条 user 消息）⇒ 跳过清屏循环，直接发送驱动文本
2. 保留 NBSP 修复（空框场景仍需要），但 fresh-session 分支优先
3. 验证：fresh welcome 屏（ghost 文本）⇒ 直接发送成功（archguard 场景）；正常空框 ⇒ 走 NBSP 清屏路径

## Acceptance Criteria

- [ ] AC1: fresh welcome 屏（`❯ Try "..."` ghost 文本）⇒ send-keys-reliable 跳过清屏直接发送，rc=0（archguard 场景，负控制——当前会 fail loud rc=1）
- [ ] AC2: 正常空框（`❯`+NBSP）⇒ 仍走 NBSP 清屏路径（不回归）
- [ ] AC3: 与 gap-os-anchor-watchdog-drive-retry-and-rc-semantics 交叉标注（watchdog 驱动依赖此修复）
- [ ] AC4: 实测：kill archguard outer → watchdog relaunch → drive 成功（transcript 出现 user 消息）——AC2 完整闭环

## Definition of Done

- [ ] AC1–AC4 全部勾上
- [ ] fresh welcome 屏实测：send-keys-reliable 跳过清屏直接发送，rc=0，transcript 出现驱动文本的 user 消息（AC1/AC4 实跑输出贴任务体）
- [ ] 正常空框（`❯`+NBSP）仍走 NBSP 清屏路径，rc=0（AC2 不回归，实跑输出贴任务体）
- [ ] 全量套件绿（`fail 0` 且 `cancelled 0` 且 `FULL-SUITE-EXIT=0`）

## Touches

- plugin/scripts/send-keys-reliable.sh（fresh-session 分支）
- plugin/test/send-keys-reliable.test.mjs（AC1-AC2 测试）
- tasks/gap-os-anchor-watchdog-drive-retry-and-rc-semantics.md（AC3 交叉标注）

## Contract

measure   fresh_welcome_drive = `bash plugin/scripts/send-keys-reliable.sh <fresh-pane> <text> 2>&1 | grep -c 'fail loud\|CLEAR_MAX'` stdout 数字段
band      fresh_welcome_drive = 0（fresh 屏不再 fail loud）
invariant fresh_session_skips_clear = 1（transcript 不存在/零 user 消息 ⇒ 跳过清屏直接发）
invoke    `grep -n 'fresh\|transcript\|skip\|CLEAR_MAX' plugin/scripts/send-keys-reliable.sh`
control   fresh welcome 屏（ghost 文本）⇒ rc=0 直接发（AC1）；空框 ⇒ NBSP 路径（AC2）
resume    fresh-session 分支与测试分步提交，任一步完成即写盘