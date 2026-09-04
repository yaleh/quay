---
id: gap-send-keys-verified-hash-check-cannot-tell-typed-from-submitted
title: send-keys-verified.sh reports delivered on pane-hash change alone — that
  changes the instant text is typed, before Enter is confirmed processed, so a
  lost/delayed Enter is misreported as delivered
status: done
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

## Proposal（2026-08-10 更正——撤回 false-done 重开,原 done+superseded 是正确关闭）

**原任务 `gap-send-keys-verified-hash-check-cannot-tell-typed-from-submitted` 的 done+superseded 是正确关闭——ruling F 用 send-keys-reliable.sh 取代了它（supervisor-deliver.sh 内部包 send-keys-reliable 五步硬化 + transcript-delivery-check 纯判据）,0/7 勾是因为机制被换掉而非缺陷未修。之前判它 false-done 只看勾数不看关闭理由,是错的。状态应保持 done。**

### 实证（manager 2026-08-10 更正 + outer 复核）

- **正确关闭**：send-keys-verified.sh 被 ruling F（send-keys-reliable.sh）取代——supervisor-deliver.sh 头注释「DELEGATES TO: send-keys-reliable.sh the hardened 5-step + transcript-delivery-check.ts the pure delivery verdict」；send-keys-reliable.sh 头注释「five-step algorithm from CRYSTALLIZED-reliable-send-2026-08-04.md as a script」。
- **0/7 勾的原因**：机制被换掉（superseded）而非缺陷未修——任务被正确关闭。
- **撤回理由**：之前只看勾数不看关闭理由就判 false-done，是错的（manager 更正）。

**为什么重要**：正确关闭的任务不应被重开——误重开会把已解决的机制问题当未修缺陷，浪费 inner 精力。

### 选定机制方向（实现归内层，接法留执行时）

1. **状态恢复 done**：`gap-send-keys-verified-hash-check-cannot-tell-typed-from-submitted` 从 ready 退回 done（正确关闭）。
2. **sibling 任务撤销**：`gap-send-keys-verified-hash-mistakes-typed-for-submitted`（基于误重开立的）应撤销或改标（工具判据已是 transcript-delivery-check,无 typed/submitted 问题）。

**验证锚**：修后 (a) 原任务 status:done（正确关闭）;(b) sibling 撤销或改标。

## Acceptance Criteria

- [ ] AC1: **复现固化**——任务体记录正确关闭理由（ruling F 取代,机制换非缺陷）+ 撤回误判（本任务 Proposal 已含）
- [ ] AC2: **状态恢复 done**——gap-send-keys-verified-hash-check 从 ready 退回 done
- [ ] AC3: **sibling 撤销/改标**——gap-send-keys-verified-hash-mistakes-typed-for-submitted 撤销或改标（工具判据已是 transcript-delivery-check）
- [ ] AC4: **既有不回归**——`--for-task` scoped 门绿

## Definition of Done

- [ ] AC1–AC4 全部勾上
- [ ] 修后实跑：原任务 done + sibling 处理（贴任务体）
- [ ] 既有测试 + 新增测试全绿（`--for-task` scoped）
- [ ] 全量套件绿（`fail 0` 且 `cancelled 0` 且 `FULL-SUITE-EXIT=0`）——外层 verification-round 验证

## Touches

- tasks/gap-send-keys-verified-hash-check-cannot-tell-typed-from-submitted.md（状态 done,撤回重开）
- tasks/gap-send-keys-verified-hash-mistakes-typed-for-submitted.md（撤销或改标）
- orchestration/CRYSTALLIZED-reliable-send-2026-08-04.md（交叉标注——正本）

## Contract

measure   hash_check_status = `grep -E '^status:' tasks/gap-send-keys-verified-hash-check-cannot-tell-typed-from-submitted.md` 的 stdout
band      hash_check_status = done（正确关闭恢复）
invariant sibling_handled = 1（hash-mistakes sibling 撤销或改标）
invoke    `grep -E '^status:|ruling F|superseded' tasks/gap-send-keys-verified-hash-check-cannot-tell-typed-from-submitted.md`（贴恢复后状态）
control   状态 done；sibling 处理；撤回误判
resume    状态恢复 / sibling 处理分步提交，任一步完成即写盘

## Dispatch review

reviewer: outer
at: 2026-08-10
changed: manager 更正——原 done+superseded 是正确关闭（ruling F 用 send-keys-reliable 取代,机制换非缺陷）,0/7 勾是因机制被换。撤回 false-done 误判:状态恢复 done,sibling 撤销/改标。实现归内层
