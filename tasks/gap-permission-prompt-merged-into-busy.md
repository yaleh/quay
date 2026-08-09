---
id: gap-permission-prompt-merged-into-busy
title: session-liveness.sh:355 把 permission-prompt 并进
  busy——「卡权限框」与「在干活」在忙闲读数同形（第二道遮蔽，同 ADR-033 读数无法表达关键区别源），permission-prompt
  应单列并直接触发上层动作
status: ready
labels:
  - gap
  - defect
parent: null
children: []
extra: {}
---
**type:** execution

## Proposal

**session-liveness.sh:355 把 `permission-prompt` 并进 `busy`——`busy|permission-prompt|error-banner) _sl_pane_busy=1`。「卡在权限对话框」与「在干活」在忙闲读数里同形——与今晚 `1/4 in-flight` 被抄成状态标签、三次幻影红（正则替语义干活）完全同一族失效：读数无法表达该表达的区别。permission-prompt 语义上需要「人/上层介入」，与「在干活」相反。**

### 实证（manager 2026-08-09 实测 + outer 复核）

- **session-liveness.sh:355**：`case "$_sl_pane_state" in busy|permission-prompt|error-banner) _sl_pane_busy=1 ;; *) _sl_pane_busy=0 ;; esac`——permission-prompt 归入 busy=1。
- **语义矛盾**：`permission-prompt` = inner 需要人/上层裁决或授权，是「需要介入」状态；`busy` = 在干活。两者在忙闲读数里同形，上层看到 busy 以为在推进，实际卡在权限框。
- **同族**：与 `1/4` 被抄成标签（读数无法表达 in_flight<cap 该触发派发）、三次幻影红（正则替语义）同源——读数存在的区别无法表达。
- **第二道遮蔽**：即使 A7/last-pane.txt 修好（gap-last-pane-txt-has-no-writer），permission-prompt 仍被并进 busy，检测链第二层还是看不见「需要介入」。

**为什么重要**：permission-prompt 是需要人/上层介入的信号，是「该 escalate/该人工」的关键区别。它被压进 busy 后，上层把「卡住等人」当「在干活」，无提示、无升级、无响应。这是今晚失效族（读数无法表达关键区别）的又一实例。

**修的方向（实现归内层）**：
- 候选 A：**permission-prompt 单列**——`case busy|error-banner) busy=1 ;; permission-prompt) 新状态 _sl_pane_intervention=1（或单独状态名）;; *) busy=0`——permission-prompt 不再并进 busy，单独可检测。
- 候选 B：**直接触发上层动作**——permission-prompt 出现即触发 escalate/报告（不是等 3 次，是立即标记需介入）。
- 候选 C：**状态机扩展**——pane-state-classify 的状态集合加 `intervention-required` 或 `awaiting-input` 明确区分，busy 只保留「真在干活」。

**验证锚**：修后，(a) inner 停在 permission-prompt 时读数不再是 busy（是新状态）；(b) 该状态可被上层检测并触发动作（报告/escalate）；(c) 正常忙碌仍 busy 不误报。

## Acceptance Criteria

- [ ] AC1: **复现固化**——任务体记录实证（session-liveness.sh:355 permission-prompt 并进 busy + 语义矛盾 + 第二道遮蔽）（本任务 Proposal 已含；内层补：构造 permission-prompt pane 复现读数 busy）
- [ ] AC2: **permission-prompt 单列**——不再并进 busy（新状态如 intervention-required / 独立标志），与「在干活」可区分
- [ ] AC3: **触发上层动作**——permission-prompt 出现即触发 escalate/报告（非等 3 次 busy）
- [ ] AC4: **正常忙碌不误报**——inner 真在干活仍 busy，不触发 intervention（负控制）
- [ ] AC5: **既有机制不回归**——`--for-task` scoped 门绿（含 session-liveness / pane-state-classify 契约检查）

## Definition of Done

- [ ] AC1–AC5 全部勾上
- [ ] 修后实跑：构造 permission-prompt pane ⇒ 读数新状态 + 触发动作；正常忙碌仍 busy（贴任务体）
- [ ] 既有测试 + 新增测试全绿（`--for-task` scoped）
- [ ] 全量套件绿（`fail 0` 且 `cancelled 0` 且 `FULL-SUITE-EXIT=0`）——外层 verification-round 验证

## Touches

- plugin/scripts/session-liveness.sh（候选 A/B/C：permission-prompt 单列 + 触发动作）
- plugin/scripts/pane-state-classify.ts（候选 C：状态集合扩展）
- plugin/test/session-liveness-signals.test.mjs（新增：permission-prompt ⇒ 非 busy）
- tasks/gap-last-pane-txt-has-no-writer.md（交叉标注——同检测链，第一道遮蔽）
- tasks/gap-permission-prompt-merged-into-busy.md（自身：勾 AC + 贴证据）

## Contract

measure   permission_prompt_class = `bash plugin/scripts/session-liveness.sh --check` 的 pane 状态分类（构造 permission-prompt pane 后）
band      permission_prompt_class = 非 busy（新状态如 intervention-required，可区分于在干活）
invariant busy_true_work_not_flagged = 1（正常忙碌不触发 intervention）
invariant intervention_triggered = 1（permission-prompt ⇒ 上层动作触发）
invoke    `bash plugin/scripts/session-liveness.sh --check`（构造 permission-prompt 贴回）
control   permission-prompt ⇒ 非 busy + 触发动作；正常忙 ⇒ busy 不误报
resume    状态单列 + 动作触发 + 测试分步提交，任一步完成即写盘

## Dispatch review

reviewer: outer
at: 2026-08-09
changed: 建任务（manager 实测：session-liveness.sh:355 permission-prompt 并进 busy——「卡权限框」与「在干活」同形，第二道遮蔽；同 ADR-033「读数无法表达关键区别」源。实现归内层）
