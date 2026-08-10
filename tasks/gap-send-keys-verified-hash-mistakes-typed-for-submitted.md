---
id: gap-send-keys-verified-hash-mistakes-typed-for-submitted
title: send-keys-verified.sh 送达判据分不清 typed/submitted——哈希变化仅被键入也会变,今晚 3
  条粘连输入框+10;1c 是复现（text delivered Enter NOT processed）;原任务被按 superseded 关掉(0/7
  AC 未勾)缺陷仍在生产工具;修工具判据(哈希→已提交信号或 WARN)+重开任务
status: ready
labels:
  - gap
  - defect
parent: "null"
children: []
extra: {}
---
**type:** execution

## Proposal（2026-08-10 重开——原任务被按 superseded 关掉而非修好,缺陷仍在生产工具）

**`send-keys-verified.sh` 的送达判据是「发送前后 pane 哈希变化」——但文本仅被键入也会改哈希，分不清 typed 与 submitted。这个缺陷自 2026-08-03 至今未变（08-09 那次只是加 --help）。原任务 `gap-send-keys-verified-hash-check-cannot-tell-typed-from-submitted` 标题就是这个缺陷，status=done 但 7 条 AC/DoD 一条没勾（0 勾 7 未勾）——翻 done 的提交是 2026-08-04「F supersedes send-keys-verified (done+superseded)」，按 superseded 关掉的，不是修好的。缺陷仍在生产工具里，任务却是 done。**

### 实证（人 2026-08-10 裁定 + outer 复核）

- **缺陷仍在**：`plugin/scripts/send-keys-verified.sh:43` —— `hash_before=$(tmux capture-pane ... | md5sum)`，发送后比较哈希；`#   - 发送后 pane 哈希未变 → 未送达`。**哈希变化 = typed 或 submitted 都可能**，分不清。
- **工具自认**（头部注释）：「并在发完后确认送达（比较发送前后的 pane 哈希，未变则报失败）」。
- **今晚复现实例**（2026-08-10）：我 01:43/01:44/01:48 三条派发卡 inner 输入框首尾相接没提交（合并形态丢 Enter），末尾粘终端 DA 应答 `10;1c`——用 send-keys-verified.sh 的哈希判据会报「已送达」（哈希变了），实际 Enter 没被处理。**这正是 AC1 要的形状：「text delivered, Enter NOT processed」**。
- **原任务状态**：`status: done`，AC/DoD **0 勾 / 7 未勾**；翻 done 提交 25eb1c30（2026-08-04T14:35:26Z）「F supersedes send-keys-verified (done+superseded, branch preserved 6a51f964)」——**按 superseded 关掉的，不是修好的**。
- **人在 2026-08-10 的裁定**：该脚本的送达判据不可信，别把它当检测——它提供的是**预防**（永远三次分开、不会因合并丢 Enter），不是检测；送达判据仍须另取只有已提交才产生的信号。

**为什么重要**：缺陷在工具里但任务 done——下一个人用工具会误信哈希判据报的「已送达」。重开任务修掉 typed/submitted 不分，或至少让工具在哈希判据上加显式提示（「哈希变化不证明已提交，请用 committed 信号确认」）。

### 选定机制方向（实现归内层，接法留执行时）

1. **修工具判据**：`send-keys-verified.sh` 的送达确认从「哈希变化」改为「已提交信号」（inner transcript 新增 user 消息 / pane 已提交块 / inner 转忙）——或至少哈希判据报「已送达」时加显式 WARN「哈希变化不证明已提交，需 committed 信号确认」。
2. **重开任务**：`gap-send-keys-verified-hash-check-cannot-tell-typed-from-submitted` 从 done 退回 ready（或另立 gap-send-keys-verified-hash-mistakes-typed-for-submitted）。

**验证锚**：修后 (a) 工具不再以哈希变化当「已送达」证据（或加 WARN）；(b) 哈希判据与 committed 信号区分；(c) 今晚复现实例在 AC1。

## Acceptance Criteria

- [ ] AC1: **复现固化**——任务体记录今晚复现实例（3 条粘连输入框 + 10;1c,哈希判据会误报已送达——text delivered, Enter NOT processed）（本任务 Proposal 已含）
- [ ] AC2: **工具判据修正**——send-keys-verified.sh 送达确认从哈希变化改为已提交信号，或加 WARN「哈希不证明已提交」
- [ ] AC3: **重开任务**——原 gap-send-keys-verified-hash-check 从 done 退回 ready（或另立）,不再 status:done 挂着生产缺陷
- [ ] AC4: **既有不回归**——`--for-task` scoped 门绿

## Definition of Done

- [ ] AC1–AC4 全部勾上
- [ ] 修后实跑：工具送达判据修正（贴任务体）；今晚复现实例在 AC1
- [ ] 既有测试 + 新增测试全绿（`--for-task` scoped）
- [ ] 全量套件绿（`fail 0` 且 `cancelled 0` 且 `FULL-SUITE-EXIT=0`）——外层 verification-round 验证

## Touches

- plugin/scripts/send-keys-verified.sh（送达判据：哈希变化 → 已提交信号，或加 WARN）
- plugin/test/send-keys-verified.test.mjs 或等价（AC2 测试：typed vs submitted 区分）
- tasks/gap-send-keys-verified-hash-check-cannot-tell-typed-from-submitted.md（重开,勾 AC）
- tasks/gap-drive-sent-to-manager-pane-not-inner.md（交叉标注——00:22 目标错,① 类）
- orchestration/orchestrator-tick-core.md（交叉标注——C1 工具 mandate）
- tasks/gap-send-keys-verified-hash-mistakes-typed-for-submitted.md（自身：勾 AC + 贴复现）

## Contract

measure   tool_delivery_criterion_fixed = `grep -c "已提交\|committed\|WARN.*哈希" plugin/scripts/send-keys-verified.sh` 的 stdout 数字
band      tool_delivery_criterion_fixed >= 1（工具不再以哈希变化当已送达,或加 WARN）
invariant typed_vs_submitted_distinguished = 1（哈希判据与 committed 信号区分）
invariant false_done_reopened = 1（原任务不再 status:done 挂着生产缺陷）
invoke    `bash plugin/scripts/send-keys-verified.sh quay-0:inner "test"`（贴输出:哈希变化 + 是否加 WARN/committed 信号）
control   工具判据修正；typed/submitted 区分；任务重开
resume    工具判据 / 任务重开分步提交，任一步完成即写盘

## Dispatch review

reviewer: outer
at: 2026-08-10
changed: 人 2026-08-10 裁定——send-keys-verified.sh 哈希判据分不清 typed/submitted,今晚 3 条粘连输入框 + 10;1c 是复现实例（text delivered, Enter NOT processed）。原任务 gap-send-keys-verified-hash-check 被按 superseded 关掉（0/7 AC 未勾,非修好）,缺陷仍在生产工具。重开:修工具判据（哈希→已提交信号或 WARN）+ 任务从 done 退回 ready。实现归内层
