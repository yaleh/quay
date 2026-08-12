---
id: gap-precommit-guard-running-round-rejects-assertion-surface-commits
title: pre-commit 守卫——state=running 且触及断言面文件 ⇒ 拒提交（覆盖全部写入者，三独立实证）
status: todo
labels:
  - gap
  - defect
  - mechanism
parent: null
children: []
extra:
  schema: execution
---

**type:** execution

## Proposal

**实证（2026-08-12，三独立支撑，manager 判定）**：「round 期间零提交」约定守不住：
① **约定无产物（C17）**——round 60 约定后 26s 即破（外层 47023142）；
② **连事后都难区分**——要靠人拿 `startedAt` 逐笔比对 commit 时刻，今天只有 manager 在做；
③ **参与方不完整且名单无人维护（最硬）**——inner 从不在约定里，round 63 窗口内以 30-40s 一次提交 4 笔任务体更新，无人告诉它有一轮在跑。
**①② 可靠「更小心」缓解，③ 结构上不可能靠小心解决。** round 60/63 的窗口内提交验证「无害」是运气不是机制——验证轮的 verifiedCommit 判定与 clean-window 语义被污染，靠事后读原文才能排除。

## Plan

1. **pre-commit 钩子或 commit 包装脚本**：提交时读 `.quay/full-suite-state.json`。
   - `state == "running"` **且** 本次提交触及【断言面内文件】⇒ 拒提交（exit 非 0），打印
     `round <N> 正在跑（startedAt=…），本次提交会使该轮结论不可用；用 --allow-dirty-round 显式覆盖，或等终态`。
   - **fail-loud（manager 2026-08-12 四次同族谓词错误的正确失败模式）**：state 文件缺失 / 字段 null ⇒ 拒——
     **参照系缺失时谓词必须崩，不给看似合理的值**（`[ -nt 不存在文件 ]` 恒真 / 裸文件名判存在失败等）。
2. **断言面集合不手工维护**：从测试自声明的判定对象聚合（A0b③ 机制，
   `gap-check-set-after-change-diff-nameonly-intersect-judged-objects`）——守卫的白名单手工维护会与测试漂移，
   正是它要防的病的同一形态。
3. **覆盖全部写入者**：outer / manager / inner 的提交都过守卫（shared hook 或各层 commit 命令改走包装脚本）——
   约定的参与方名单不可维护，守卫必须覆盖名单之外的写入者。
4. **守卫拒绝后给预检清单**：作者被拒时手里应已有一份预检清单（等待期可做、只读、可反复），
   不是被拒后才开始想约束——「强制等待让预检可做」的推广（manager 2026-08-12）。
5. **`--allow-dirty-round` 显式覆盖**（有记录可追责，不静默绕过）。

**与已立案任务的关系**：与 `gap-concurrent-write-mutable-tree-false-positive-red` 是同一件事两半——
那条记录「红可能是假的」，这条阻止「制造假红」（只有后者能真正消掉它，因为前者仍要求判读时想起来）。
与 `gap-suite-start-verifies-target-commit`（起跑验 verifiedCommit 含目标修复）互补——那条防「验了不该验的树」，
本条防「验证轮窗口内被写入」。

## AC

- [ ] AC1: 守卫存在，state=running 且触及断言面文件 ⇒ 拒提交（exit 非 0）+ 明确消息
- [ ] AC2: fail-loud——state 文件缺失/null ⇒ 拒（不给看似合理的值）
- [ ] AC3: 覆盖全部写入者（outer/manager/inner 的提交都过守卫）
- [ ] AC4: 断言面集合从测试自声明判定对象聚合（非手工维护）
- [ ] AC5: 负控制——重现 round 63 形态（inner 在 running 轮提交任务体）被拦住；round 60 形态（约定后 26s 提交）被拦
- [ ] AC6: 既有测试全绿；`--for-task` scoped 门绿

## Definition of Done

- [ ] AC1–AC6 全部勾上
- [ ] 负控制样例贴出（见 Evidence）
- [ ] 全量套件绿

## Touches

- pre-commit 钩子 / commit 包装脚本（plugin/scripts/ 或 scripts/）
- 断言面判定对象注册表（与 gap-check-set-after-change-diff-nameonly-intersect-judged-objects 共享）
- tasks/gap-precommit-guard-running-round-rejects-assertion-surface-commits.md（自身）
