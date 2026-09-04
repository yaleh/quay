---
id: gap-send-keys-verified-hash-mistakes-typed-for-submitted
title: send-keys-verified.sh 送达判据分不清 typed/submitted——哈希变化仅被键入也会变,今晚 3
  条粘连输入框+10;1c 是复现（text delivered Enter NOT processed）;原任务被按 superseded 关掉(0/7
  AC 未勾)缺陷仍在生产工具;修工具判据(哈希→已提交信号或 WARN)+重开任务
status: done
labels:
  - gap
  - defect
parent: "null"
children: []
extra: {}
---
**type:** execution

## Proposal（2026-08-10 撤销——基于误判立的 sibling 任务）

**本任务（tasks/gap-send-keys-verified-hash-mistakes-typed-for-submitted.md）基于误判 false-done 而立项——原任务 gap-send-keys-verified-hash-check 的 done+superseded 是正确关闭（ruling F 用 send-keys-reliable.sh 取代），工具判据已是 transcript-delivery-check.ts（纯判据：目标会话 transcript 真实 user 消息），不存在 typed/submitted 问题。本任务撤销（证据见本行路径——invoke 入口路径已入正文）。**

### 实证（manager 2026-08-10 更正 + outer 复核）

- 原任务正确关闭（ruling F 取代,机制换非缺陷）。
- supervisor-deliver.sh 内部包 send-keys-reliable.sh 五步硬化 + transcript-delivery-check.ts 纯判据——送达判据已是「transcript 真实 user 消息」,无 typed/submitted 问题。
- 本任务立项前提（hash-mistakes-typed-for-submitted）已被原任务正确关闭证伪。

**为什么重要**：撤销基于误判立的任务，避免 inner 在错误前提上实现无用功能（与 crosscut 误判同模式）。

## Acceptance Criteria

- [x] AC1: 任务体记录撤销理由（原任务正确关闭,判据已是 transcript-delivery-check,前提证伪）
- [x] AC2: 任务状态改为 done（撤销——不实现,因为前提证伪）
- [x] AC3: 既有不回归

## Contract

measure   sibling_status = `grep -E '^status:' tasks/gap-send-keys-verified-hash-mistakes-typed-for-submitted.md` 的 stdout
band      sibling_status = done（撤销）
invoke    `grep -E '^status:|撤销' tasks/gap-send-keys-verified-hash-mistakes-typed-for-submitted.md`（贴撤销后状态）
control   状态 done（撤销）；前提证伪记录在档
resume    撤销即完成

## Dispatch review

reviewer: outer
at: 2026-08-10
changed: manager 更正——原任务正确关闭（ruling F 取代,判据已是 transcript-delivery-check）,本任务基于误判立项,前提证伪。撤销:状态 done,不实现。
