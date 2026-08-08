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

- [x] AC1: 每 tick 收尾 pass 有机械判据——本轮 ≥1 收尾 ⇒ verification-round.jsonl 尾部 round 前进
       1（追加前 assert last+1；失败即 tick 异常非静默）
- [x] AC2: 负控制——无收尾的 tick 不要求写 jsonl（round 不前进不报警，避免把「无收尾」当异常）
- [x] AC3: 与 gap-closure-sync-is-the-true-batch-boundary（done）交叉标注——本任务是它落地后的
       记账完整性问题，不是重开；并与 gap-full-suite-state-race-last-write-wins-no-generation-guard
       交叉标注（同「状态文件完整性」家族、机制不同：本任务 = 写路径未执行/未落盘，race 任务 = 写路径
       竞态覆盖——full-suite-state.json 的 last-write-wins 无 generation guard）
- [x] AC4: 本轮补记 round 14-18 已由外层执行（2026-08-06 02:0xZ），jsonl 现在 round 连续 1-18

## Definition of Done

- [x] AC1-AC4 全勾（收尾 pass 机械判据：本轮 ≥1 收尾 ⇒ jsonl round 前进 1，追加前 assert last+1；无收尾 tick 不要求写 jsonl；与 closure-sync 交叉标注；round 14-18 已补记连续 1-18）
- [x] jsonl round 连续性实测（追加前 assert last+1，失败即 tick 异常非静默）
- [x] scoped 门 `scripts/test.sh --for-task gap-verification-round-record-skipped-for-five-closures` 绿

## Definition of Done

- [ ] AC1-AC4 全勾（收尾 pass 机械判据：本轮 ≥1 收尾 ⇒ jsonl round 前进 1，追加前 assert last+1；无收尾 tick 不要求写 jsonl；与 closure-sync 交叉标注；round 14-18 已补记连续 1-18）
- [ ] jsonl round 连续性实测（追加前 assert last+1，失败即 tick 异常非静默）
- [ ] scoped 门 `scripts/test.sh --for-task gap-verification-round-record-skipped-for-five-closures` 绿

## Touches
- tasks/gap-verification-round-record-skipped-for-five-closures.md（自身文件——self-touch，2026-08-08 内层补：缺此条不满足派发资格闸 step 4.5）

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

## Evidence

**AC1（收尾 pass 机械判据）**：`orchestration/orchestrator-loop-tick.md` 步骤 1b 步骤 4 已加入机械判据
块（2026-08-08 内层落地）：「本轮 `closed` 非空（≥1 收尾）⇒ **追加前**读
`.quay/verification-round.jsonl` 尾部 round 得 `last`，断言 `N == last+1`；**追加后**再断言尾部
round == `N`（本轮必须前进 1）。任一断言失败（尾部 round 没前进）即**本轮 tick 异常**，不得静默
跳过——补一行记录或按「红窗分诊」needs-human 处置，并把异常记进本轮报告。」Contract invoke
（`grep -n 'assert.*round\|last+1\|写轮次记录' orchestration/orchestrator-loop-tick.md`）命中：
步骤 4 标题「写轮次记录」（行 719）+ 判据块「断言 `N == last+1`」（行 732）。

**AC2（负控制）**：同一判据块显式声明「本轮 `closed` 为空（无收尾）⇒ **不要求写 jsonl**：round
不前进、不报警（负控制，AC2）——『无收尾』不是异常。」——无收尾的 tick 不触发报警，与 AC1 的
「≥1 收尾 ⇒ 必须前进」构成互补判据。

**AC3（交叉标注）**：
- `gap-closure-sync-is-the-true-batch-boundary`（done）：本任务是它把记账从调度同步点降级为可选项后
  的**记账完整性**缺口（写路径存在但无「每轮必须落盘」的机械判据，执行是自觉、自觉会漏），**不是重开**
  ——closure-sync 的机制（探测 taskWorkLanded + 写 verification-round + inner 停止条件改读 suite-state）
  原样保留，本任务只在写入方补断言。判据块在 tick 文档中引用该 gap id 标注「落地后的记账完整性补强」。
- `gap-full-suite-state-race-last-write-wins-no-generation-guard`：同「状态文件完整性」家族、机制不同
  ——本任务 = **写路径未执行/未落盘**（closure 时 round 记录被跳过），race 任务 = **写路径竞态覆盖**
  （full-suite-state.json 的 last-write-wins 无 generation guard）。本任务不修 race 的竞态，race 任务
  不修本任务的落盘判据。

**AC4（round 14-18 补记连续性）**：`.quay/verification-round.jsonl` 实测（2026-08-08，主检出）：
125 行**全部可解析**（Contract measure：`python3 -c "import json;[json.loads(l) for l in
open('.quay/verification-round.jsonl')]"` 无异常）；round **1-18 连续**（`nums[:18] == list(range(1,19))`
为 True）——外层 2026-08-06 02:0xZ 的 14-18 补记使缺口闭合。此后 jsonl 由 full-suite-runner 每轮套件
完成追加（现尾部 round 125）。注：round>34 段存在非单调（并发 runner 追加的 line-count+1 语义），属
race 任务家族的运行时现象，不在本任务 band（band 明确「补记后 1-18」）范围内。

