---
id: gap-needs-human-note-missing-real-error-line
title: "## Needs-Human 记录「失败步/判词」suite red 时恒为「suite red」——缺真实报错首行，人工每次要开日志 grep"
status: ready
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

**实测（48h needs-human 复盘）**：`markNeedsHuman`（`driver-filters.ts:704`）写入 `## Needs-Human` 记录时，「失败步/判词」字段来自 `formatExitedNotLandedReason`（`driver-filters.ts:591`），suite-red 情形下值恒为 `step=suite: suite red`——`worker-driver.ts:3259` `failSuite(\`suite ${sr.outcome}${sr.error ? \`: ${sr.error}\` : ""}\`, sr.exitCode)`，`sr.error` 常为空 ⇒ 拼出的字符串**不携带任何真实错误内容**，只是一句固定套话。

本次 48h needs-human 复盘中，为判断两个当前卡住任务（`gap-test-file-snapshot-worktree-drops-realinstall`、`gap-mechanical-fan-in-writes-no-complete-gateevent`）的真实失败原因，**被迫两次分别打开原始 suite log**（单份 500KB-1MB）手动 grep `AssertionError` 才拿到真实报错行（`probe must be alive`；`the new claude child must come up`），而不是从任务体记录直接读到。`worker-driver.ts:2579` 已有 `extractFailureSummary(combined: string): string` 函数（`:3088` 用于其它非 suite 步骤提取失败摘要），suite 判红路径没有复用它——**机件已经存在，只是没接上这一路**（硬规则 1）。

这是最低成本的一处改动：不改判定逻辑，只是把已经拿得到的日志内容摘要出第一行真实错误，塞进已经存在的字段里。

## Plan

1. suite 判红处（`worker-driver.ts` 调用 `failSuite` 之前，`:3259` 附近）对 suite 日志的失败区段跑 `extractFailureSummary`（或同一手法），取得第一条真实断言/报错行。
2. 把该行拼入 `failSuite` 的 `summary`（进而 `mechanical_fan_in.reason`），取代恒定字符串 `"suite red"`。
3. `markNeedsHuman` 写入 `## Needs-Human` 的「失败步/判词」行不需要改读取逻辑——它已经透传 `mechanical_fan_in.reason`，改了源头这里自动跟着变。
4. 无法提取（日志缺失/格式异常/无匹配行）时保留现状的通用文案，不得伪造/截断出无意义内容（硬规则 3b：三态可区分）。

## Acceptance Criteria

- [ ] AC1（能取假）：构造一个 suite 输出含明确 `AssertionError`（或等价失败标记）的 fixture，`markNeedsHuman` 写入的 `## Needs-Human` 记录「失败步/判词」行包含该错误原文（而非泛化的 `suite red`）。
- [ ] AC2（能取假，负控制）：suite 输出不含可提取的具体错误（仅非零退出码、日志缺失或无匹配行）时，仍回退到现有的通用文案，不得伪造/截断出误导性内容。
- [ ] AC3（真实生产载体验证，非 fixture）：实现落地之后，一次真实 worker-driver suite red 触发的 needs-human 写入，任务体 `## Needs-Human` 记录的「失败步/判词」行包含真实断言文本——贴出该行原文。
- [ ] AC4：`--for-task` scoped 门 + 全量 suite 绿；`formatExitedNotLandedReason`/`failSuite` 既有单测不回归。

## Definition of Done

真实一次 suite red 触发的 needs-human 记录里，「失败步/判词」不再是恒定的 `step=suite: suite red`，而是携带取自 suite 日志的第一条真实错误/断言行；AC1-AC4 全部勾选，且 AC3 落在实现落地**之后**的真实运行载体上核验过（硬规则 4 推论三：N 只计实现落地之后的时间窗）；全量 suite 绿；改动经 fan-in 落到 develop 并可 `git show develop:` 核验。

## Touches

- plugin/scripts/worker-driver.ts（failSuite 调用处 + extractFailureSummary 复用）
- plugin/scripts/driver-filters.ts（如 formatExitedNotLandedReason 的展示逻辑需跟随调整）
- plugin/test/worker-driver-fan-in.test.mjs
- plugin/test/driver-filters.test.mjs
- tasks/gap-needs-human-note-missing-real-error-line.md（自身）
