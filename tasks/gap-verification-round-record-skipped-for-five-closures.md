---
id: gap-verification-round-record-skipped-for-five-closures
title: "outer closure bookkeeping: 5 closures (rounds 14-18) landed + flipped done but verification-round.jsonl was NOT appended for any of them (last record round 13 @00:25Z, next write 02:0xZ backfill) — the closure-sync AC2 routine wrote the narrative queue-state but the machine-readable round record silently fell off; nobody notices because nothing READS the round record for closure completeness (inner reads suite-state, not verification-round); '存在≠生效' recurrence on the outer's own bookkeeping; fix: a per-tick assertion or the tick itself must check verification-round.jsonl tail round == number of merged closures"
status: ready
labels:
  - gap
  - defect
  - milestone-candidate
extra:
  schema: v1
---
**type:** execution

## Proposal

**外层收尾记账：5 个 closure（round 14-18）落地翻 done，但 verification-round.jsonl 一个都没追加。**

**【实测（外层 2026-08-06 02:0xZ tick）】**：`.quay/verification-round.jsonl` 停在 round 13
（2026-08-06T00:25Z，closed: two-machine-collab），而 git log 显示 round 14（complete-delivery /
branch-model 40134a6d）、15（two-machine d9376f0b）、16（delivery-grows dff3b1de）、17+18
（telemetry-brackets + ghost-suggestion 1bf88a64）都已落地并翻 done——**连续 5 轮收尾没写机器可读
轮次记录**。batch2-queue-state.md（叙事）写了，jsonl（机械）没写。

**【为什么没人发现】**：inner 的停止条件读 suite-state（`fast-mode-loop-tick.md` 步骤 3），**不读
verification-round.jsonl**——closure-sync AC3 把它从 inner 读取面撤下后，它就只剩「外层自己的历史
记录」这一个消费者。closure-sync AC2 说「每 tick 用 taskWorkLanded 探测 + 写 verification-round」，
但没有「每轮必须落盘」的机械判据——**记账从调度同步点降级为可选项后，没人执行也没人校验**。

**【形态】「存在≠生效」在**外层自己**的书桌上的第 N 次**：写入方存在（步骤 1b 步骤 4）、读取方已撤
（inner 不读），中间的执行是外层每 tick 的自觉——自觉会漏。

### 选定机制

1. **补一个机械判据**：每 tick 收尾 pass 末尾断言
   `verification-round.jsonl` 尾部 round == 本轮已确认收尾数对应的期望（或至少：本轮有 ≥1 收尾
   ⇒ 本轮必须写一行）。最简单形态：步骤 1b 步骤 4 的「写轮次记录」前断言「本轮 closed 非空 ⇒ 追加
   必然执行」——加一个 `assert round == last+1` 在追加前（失败即本轮 tick 异常，不能静默跳过）。
2. 或：把 jsonl 的「轮次完整性」并入 monitor-mount-check 或 ready-pool-check 的验证面（另一类已有
   消费者）。

## Acceptance Criteria

- [ ] AC1: 每 tick 收尾 pass 有机械判据——本轮 ≥1 收尾 ⇒ verification-round.jsonl 尾部 round 前进
       1（追加前 assert last+1；失败即 tick 异常非静默）
- [ ] AC2: 负控制——无收尾的 tick 不要求写 jsonl（round 不前进不报警，避免把「无收尾」当异常）
- [ ] AC3: 与 gap-closure-sync-is-the-true-batch-boundary（done）交叉标注——本任务是它落地后的
       记账完整性问题，不是重开
- [ ] AC4: 本轮补记 round 14-18 已由外层执行（2026-08-06 02:0xZ），jsonl 现在 round 连续 1-18

## Definition of Done

- [ ] AC1-AC4 全勾（收尾 pass 机械判据：本轮 ≥1 收尾 ⇒ jsonl round 前进 1，追加前 assert last+1；无收尾 tick 不要求写 jsonl；与 closure-sync 交叉标注；round 14-18 已补记连续 1-18）
- [ ] jsonl round 连续性实测（追加前 assert last+1，失败即 tick 异常非静默）
- [ ] scoped 门 `scripts/test.sh --for-task gap-verification-round-record-skipped-for-five-closures` 绿

## Touches

- orchestration/orchestrator-loop-tick.md（步骤 1b 步骤 4：追加前 assert last+1）
- .quay/verification-round.jsonl（AC4 补记证据——gitignored 运行时态，不回测）

## Contract

measure   round_continuity = `python3 -c "import json;[json.loads(l) for l in open('.quay/verification-round.jsonl')]"` 后读最后一个 round 值（无异常即所有行可解析）
band      round_continuity = 连续递增（无 gap；补记后 1-18）
invoke    `grep -n 'assert.*round\|last+1\|写轮次记录' orchestration/orchestrator-loop-tick.md`
control   本轮 ≥1 收尾 ⇒ jsonl 尾部 round 前进 1（AC1）；无收尾 tick 不报警（AC2）
resume    断言与补记分步提交，任一步完成即写盘

## Dispatch review

reviewer: outer
at: 2026-08-06T02:1xZ
changed: 外层 tick 实测发现立案——5 轮收尾未写 jsonl（叙事写了、机械没写），根因是 closure-sync 把
记账从调度同步点降级为可选项后无人执行也无人校验。本轮已补记 14-18，任务记录形态 + 防再犯判据。
