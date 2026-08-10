---
id: gap-send-keys-verified-hash-check-cannot-tell-typed-from-submitted
title: send-keys-verified.sh reports delivered on pane-hash change alone — that
  changes the instant text is typed, before Enter is confirmed processed, so a
  lost/delayed Enter is misreported as delivered
status: ready
labels:
  - gap
  - milestone-candidate
extra:
  schema: v1
  superseded: true
  superseded_by: gap-pane-state-is-hashed-not-classified-so-needs-input-is-unobservable
  superseded_at: 2026-08-04
---
**type:** execution

## Proposal（2026-08-10 重开——原被按 superseded 关掉,缺陷仍在生产工具）

**本任务标题所述缺陷（send-keys-verified.sh 的送达判据「发送前后 pane 哈希变化」分不清 typed 与 submitted）自 2026-08-03 至今未变（08-09 只加 --help）。原被 2026-08-04 按 superseded 关掉（commit 25eb1c30「F supersedes send-keys-verified (done+superseded)」），status: done 但 AC/DoD 0 勾 / 7 未勾——不是修好的，是跳过。2026-08-10 人裁定重开：缺陷仍在生产工具里，任务不得 status:done 挂着。**

### 实证（人 2026-08-10 裁定 + outer 复核）

- **缺陷仍在**：`plugin/scripts/send-keys-verified.sh:43` —— `hash_before=$(tmux capture-pane ... | md5sum)`，发送后比较哈希。哈希变化 = typed 或 submitted 都可能，分不清。
- **今晚复现实例**（2026-08-10）：3 条派发卡 inner 输入框首尾相接没提交（合并形态丢 Enter），末尾粘终端 DA 应答 `10;1c`——哈希判据会报「已送达」（哈希变了），实际 Enter 没被处理。**text delivered, Enter NOT processed**。
- **重开状态**：done → ready。新任务 gap-send-keys-verified-hash-mistakes-typed-for-submitted 承载实现（修工具判据），本任务承载复现固化 + 状态更正。

**为什么重要**：false-done 是「绕过不是罪，不留痕才是」的又一实例——缺陷在生产工具里但任务 done，下一个人会误信。

### 选定机制方向（实现归内层，接法留执行时）

1. **本任务重开**（done → ready）：复现固化 + 状态更正，AC 补齐。
2. **实现归 gap-send-keys-verified-hash-mistakes-typed-for-submitted**：修工具判据（哈希→已提交信号或 WARN）。

**验证锚**：修后 (a) 本任务不再 status:done 挂着生产缺陷；(b) 复现实例在 AC1；(c) 工具判据修正由 sibling 任务承载。

## Acceptance Criteria

- [ ] AC1: **复现固化**——任务体记录缺陷（哈希判据 typed/submitted 不分）+ 今晚复现实例（3 条粘连输入框 + 10;1c）（本任务 Proposal 已含）
- [ ] AC2: **重开**——status: done → ready，不再 false-done 挂着生产缺陷
- [ ] AC3: **实现转交**——工具判据修正归 gap-send-keys-verified-hash-mistakes-typed-for-submitted
- [ ] AC4: **既有不回归**——`--for-task` scoped 门绿

## Definition of Done

- [ ] AC1–AC4 全部勾上
- [ ] 修后实跑：复现实例贴任务体；状态 ready
- [ ] 既有测试 + 新增测试全绿（`--for-task` scoped）
- [ ] 全量套件绿（`fail 0` 且 `cancelled 0` 且 `FULL-SUITE-EXIT=0`）——外层 verification-round 验证

## Touches

- tasks/gap-send-keys-verified-hash-check-cannot-tell-typed-from-submitted.md（重开 done→ready,勾 AC）
- tasks/gap-send-keys-verified-hash-mistakes-typed-for-submitted.md（交叉标注——实现转交）
- plugin/scripts/send-keys-verified.sh（工具判据——由 sibling 任务修）

## Contract

measure   reopened_status = `grep -E '^status:' tasks/gap-send-keys-verified-hash-check-cannot-tell-typed-from-submitted.md` 的 stdout
band      reopened_status = ready（不再 done 挂着生产缺陷）
invariant repro_in_ac1 = 1（复现实例在 AC1）
invariant impl_transferred = 1（工具判据修正归 sibling）
invoke    `grep -E '^status:|AC1|10;1c' tasks/gap-send-keys-verified-hash-check-cannot-tell-typed-from-submitted.md`（贴重开后状态）
control   状态 ready；复现固化；实现转交 sibling
resume    重开 / 复现固化分步提交，任一步完成即写盘

## Dispatch review

reviewer: outer
at: 2026-08-10
changed: 人 2026-08-10 裁定——原被按 superseded 关掉（25eb1c30,0/7 AC 未勾非修好）,缺陷仍在生产工具。重开 done→ready:复现固化 + 状态更正;工具判据修正归 sibling gap-send-keys-verified-hash-mistakes-typed-for-submitted。实现归内层
