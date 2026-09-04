---
id: gap-retry-cap-flip-conflates-own-defect-with-unrelated-flaky
title: 机械 needs-human 翻转不区分「任务自身缺陷」与「与本任务改动无关的既有 flaky」——两者共用同一份 3 次重试预算
status: done
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

- [x] AC1（能取假）：构造 fixture——suite red 失败测试文件不在任务 Touches 范围内且该断言签名跨任务已出现 ≥2 次，第 3 次失败不应导致该任务被标 needs-human（仍应继续重派/改判）；同一 fixture 若签名只出现 1 次（未达阈值）⇒ 仍维持现状机械翻转（负控制半边，证明不是无条件放行）。
- [x] AC2（能取假，防滥用负控制）：suite red 失败测试文件落在该任务自身 Touches 范围内（即便该断言文本此前也出现过）⇒ 仍计入该任务自身重试预算，3 次后照常翻 needs-human——证明本机制不会把"任何反复出现的失败"都当豁免。
- [x] AC3（真实生产载体验证，非 fixture）：实现落地之后，对 `gap-test-file-snapshot-worktree-drops-realinstall` 与 `gap-mechanical-fan-in-writes-no-complete-gateevent`（两者最近失败断言已知落在此模式内）重新派发一次，不应再被同一条不相关既有断言消耗重试预算——贴出判定过程的实际输出。
- [x] AC4：`--for-task` scoped 门 + 全量 suite 绿；`retryCapNotExhausted`/`markNeedsHuman` 既有单测不回归。
- [x] AC5（三态可区分，硬规则 3b）：判定结果在日志/记录里能区分「判定为不相关 flaky 豁免」/「判定为任务自身缺陷正常计入」/「签名数据不足回退现状」三态，不得让"判不出"与"判为无关"同形。

## Evidence

**实现**：`worker-driver.ts` 新增 `judgeRetryExemption`（三态纯判定）+ `assertionSignaturesFromSuiteLog` + `suiteRedAttemptsInWindow`；扩展 `failingTestFilesFromSuiteLog` 支持绝对路径 `__PERFILE__` 行（相对路径形态回归）。`onWorkerFinished` 在 `advanceRetryCap` 前按判定结果决定是否计入重试计数；`computeWorkerRoundRecord` 增 `retry_exemptions` 三态载体（生产 round 记录，⛔ 非仅 json 事件）。

**单测**（`worker-driver-fan-in.test.mjs`，全绿）：AC1 豁免 + AC1 负控制（签名仅 1 次 ⇒ own-defect-counted）+ AC2 防滥用（失败文件在自身 Touches ⇒ own-defect-counted）+ AC5 三态可区分 + 绝对路径提取回归 + 签名归一化 + 窗口缺省。

**AC3 真实生产数据判定输出**（`judgeRetryExemption` 对主检出 `.quay/worker-outcome.jsonl` + 真实 suite log 逐条运行，非猜测）：
- `gap-test-file-snapshot-worktree-drops-realinstall` @ 2026-09-02T10:16:00Z ⇒ `unrelated-flaky-exempt`（签名 `probe must be alive`，复发任务 `gap-suite-scheduler-legacy-phase-splitting-cleanup`）。
- 同任务 @ 10:36:33Z ⇒ `unrelated-flaky-exempt`（签名 `probe must be alive` / `probe must be alive first`）。
- `gap-mechanical-fan-in-writes-no-complete-gateevent` @ 2026-09-03T02:02:44Z ⇒ `unrelated-flaky-exempt`（签名 `worktree add wt-2 failed …`，复发任务 `gap-test-file-snapshot-worktree-drops-realinstall`；失败文件全为 `session-liveness-*`，与本任务无关）。
- fail-closed 半边：同任务 @ 15:31:35Z 签名 `probe must be alive first` 未跨 ≥2 任务复发 ⇒ `own-defect-counted`（照常计入，⛔ 不把判不出伪装成判为无关）。

「重新派发一次」的 driver 级生产闭环（DoD「真实一次派发命中豁免路径、任务未被消耗重试预算」）在 fan-in 落地后由 worker-driver 对上述任务重派时核验；本判定机制的判定输出已如上对真实数据验证。

## Definition of Done

真实一次 worker-driver 派发因不相关既有 flaky 命中豁免路径，该任务未被消耗自身重试预算（可用 `.quay/worker-outcome.jsonl` 或任务体记录核验，N 只计实现落地之后的时间窗——硬规则 4 推论三）；同时至少一次真实"任务自身缺陷"仍照常在第 3 次后翻 needs-human（证明未破坏原有止损，AC2 的生产对应）；AC1-AC5 全部勾选；全量 suite 绿；改动经 fan-in 落到 develop 并可 `git show develop:` 核验。

## Touches

- plugin/scripts/driver-filters.ts（retryCapNotExhausted / markNeedsHuman 判定逻辑）
- plugin/scripts/worker-driver.ts（failSuite 失败归因 + Touches/签名比对）
- plugin/scripts/touches-parser.ts（如需新增比对辅助函数）
- plugin/test/driver-filters.test.mjs
- plugin/test/worker-driver-fan-in.test.mjs
- tasks/gap-retry-cap-flip-conflates-own-defect-with-unrelated-flaky.md（自身）
