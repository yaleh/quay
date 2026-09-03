---
id: gap-retry-cap-flip-conflates-own-defect-with-unrelated-flaky
title: 机械 needs-human 翻转不区分「任务自身缺陷」与「与本任务改动无关的既有 flaky」——两者共用同一份 3 次重试预算
status: todo
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: execution
---
**type:** execution

## Proposal

**实测（48h needs-human 复盘，2026-09-01~09-03）**：`driver-filters.ts:167` `RETRY_CAP_DEFAULT = 3`，`worker-driver.ts:3614` `markNeedsHuman` 在连续 3 次 `exited-not-landed` 后机械翻 needs-human，**判定逻辑不看 suite red 命中的失败测试文件是否落在该任务 `Touches` 声明范围内**——任务自己改动引入的真缺陷、和与本任务完全无关的既有测试基础设施 flaky，消耗的是同一份 3 次预算。

窗口内 26 次 needs-human 进入事件（21 个不同任务）里，约 8-9 次进入事件的真实断言（逐条核实 suite log 得到，非猜测）是同一条 session-liveness probe 饿死症状（`AssertionError: probe must be alive` 等），与各自任务的实际改动毫无关系，靠人事后诊断批量翻回 ready。当前仍卡住的 2 个任务（`gap-test-file-snapshot-worktree-drops-realinstall`、`gap-mechanical-fan-in-writes-no-complete-gateevent`）在 22:18 被判定"probe 饿死已根治"批量翻回重派后，**不到 1 小时内又用同一类不相关断言二次失败**，说明这不是个案，而是持续在发生的浪费——同一个基础设施问题反复烧掉多个不相关任务的重试预算。

**这不是要求先解决 probe 饿死本身**（那是另一条任务线，已有多个任务在跟进/已 done）——本任务解决的是**判定机制本身**：无论基础设施稳不稳，重试预算的消耗都应该按"是否是这个任务自己造成的"来算，而不是被 3 次里恰好有几次撞上不相关红就一起算账。

## Plan

1. 在 suite 判红处（`worker-driver.ts` `failSuite` 调用前后）取得本次失败的测试文件集合，复用 `plugin/scripts/touches-parser.ts` 的 `parseTouchEntries`/`parseTouchEntriesWithTags` 读出该任务 `## Touches` 声明的文件集合，做交集判定。
2. 维护"近期失败断言签名"的判据——复用既有 `.quay/worker-outcome.jsonl` 里 `mechanical_fan_in.reason`/`step` 字段做跨任务同签名计数（⛔ 不新增持久存储，硬规则 1：先查有没有同类机件）；"已知反复出现"= 近期窗口内 ≥2 个不同任务命中同一签名。
3. 失败测试文件**不在**该任务 Touches 范围 **且** 该签名判定为"已知反复出现" ⇒ 本次尝试不计入该任务自身的重试计数（走延后重派或标记"基础设施疑似不稳"，⛔ 不是无条件豁免）。
4. 签名数据不足 / 判定歧义 ⇒ 回退现状（照常计入重试、照常翻转）——fail-closed，不得把"判不出"伪装成"判为无关"（硬规则 3b）。

## Acceptance Criteria

- [ ] AC1（能取假）：构造 fixture——suite red 失败测试文件不在任务 Touches 范围内且该断言签名跨任务已出现 ≥2 次，第 3 次失败不应导致该任务被标 needs-human（仍应继续重派/改判）；同一 fixture 若签名只出现 1 次（未达阈值）⇒ 仍维持现状机械翻转（负控制半边，证明不是无条件放行）。
- [ ] AC2（能取假，防滥用负控制）：suite red 失败测试文件落在该任务自身 Touches 范围内（即便该断言文本此前也出现过）⇒ 仍计入该任务自身重试预算，3 次后照常翻 needs-human——证明本机制不会把"任何反复出现的失败"都当豁免。
- [ ] AC3（真实生产载体验证，非 fixture）：实现落地之后，对 `gap-test-file-snapshot-worktree-drops-realinstall` 与 `gap-mechanical-fan-in-writes-no-complete-gateevent`（两者最近失败断言已知落在此模式内）重新派发一次，不应再被同一条不相关既有断言消耗重试预算——贴出判定过程的实际输出。
- [ ] AC4：`--for-task` scoped 门 + 全量 suite 绿；`retryCapNotExhausted`/`markNeedsHuman` 既有单测不回归。
- [ ] AC5（三态可区分，硬规则 3b）：判定结果在日志/记录里能区分「判定为不相关 flaky 豁免」/「判定为任务自身缺陷正常计入」/「签名数据不足回退现状」三态，不得让"判不出"与"判为无关"同形。

## Definition of Done

真实一次 worker-driver 派发因不相关既有 flaky 命中豁免路径，该任务未被消耗自身重试预算（可用 `.quay/worker-outcome.jsonl` 或任务体记录核验，N 只计实现落地之后的时间窗——硬规则 4 推论三）；同时至少一次真实"任务自身缺陷"仍照常在第 3 次后翻 needs-human（证明未破坏原有止损，AC2 的生产对应）；AC1-AC5 全部勾选；全量 suite 绿；改动经 fan-in 落到 develop 并可 `git show develop:` 核验。

## Touches

- plugin/scripts/driver-filters.ts（retryCapNotExhausted / markNeedsHuman 判定逻辑）
- plugin/scripts/worker-driver.ts（failSuite 失败归因 + Touches/签名比对）
- plugin/scripts/touches-parser.ts（如需新增比对辅助函数）
- plugin/test/driver-filters.test.mjs
- plugin/test/worker-driver-fan-in.test.mjs
- tasks/gap-retry-cap-flip-conflates-own-defect-with-unrelated-flaky.md（自身）
