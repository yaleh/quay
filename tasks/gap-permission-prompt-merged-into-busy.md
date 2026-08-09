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

- [x] AC1: **复现固化**——任务体记录实证（session-liveness.sh:355 permission-prompt 并进 busy + 语义矛盾 + 第二道遮蔽）（本任务 Proposal 已含；内层补：构造 permission-prompt pane 复现读数 busy）
- [x] AC2: **permission-prompt 单列**——不再并进 busy（新状态如 intervention-required / 独立标志），与「在干活」可区分
- [x] AC3: **触发上层动作**——permission-prompt 出现即触发 escalate/报告（非等 3 次 busy）
- [x] AC4: **正常忙碌不误报**——inner 真在干活仍 busy，不触发 intervention（负控制）
- [x] AC5: **既有机制不回归**——`--for-task` scoped 门绿（含 session-liveness / pane-state-classify 契约检查）

## Definition of Done

- [x] AC1–AC5 全部勾上
- [x] 修后实跑：构造 permission-prompt pane ⇒ 读数新状态 + 触发动作；正常忙碌仍 busy（贴任务体）
- [x] 既有测试 + 新增测试全绿（`--for-task` scoped）
- [ ] 全量套件绿（`fail 0` 且 `cancelled 0` 且 `FULL-SUITE-EXIT=0`）——外层 verification-round 验证

## Evidence（内层实现 2026-08-09）

### 根因与修复

**根因**：`plugin/scripts/session-liveness.sh` 的 `_sl_pane_verdict`（原 :355）把 `permission-prompt` 并进
`busy`——`case busy|permission-prompt|error-banner) _sl_pane_busy=1`。「卡权限框」与「在干活」在忙闲读数
同形，上层看到 busy 以为在推进、实际卡在权限框（同 ADR-033 读数无法表达关键区别源；第二道遮蔽——第一道
`last-pane.txt` 死快照见 `tasks/gap-last-pane-txt-has-no-writer.md`）。

**修复（候选 A 单列 + 候选 B 触发动作）**：
1. **`_sl_pane_verdict` 状态单列**：`permission-prompt` 不再并进 busy，映射为 `_sl_pane_busy=0` +
   `_sl_pane_intervention=1`；`busy|error-banner` 保持 busy=1；`waiting-input/unknown` 保持 busy=0。
   分类器 `ENUMERATED_STATES` 五态**未改动**（`blocked-signal-parameterized.test.mjs` 锁定闭集）——单列
   在 verdict 层完成，不新增分类器状态。
2. **`SESSION-INTERVENTION-REQUIRED` 事件（AC3）**：主循环检测到 `_sl_pane_intervention=1` 即
   **边沿触发** escalate/报告（PREV_INTERVENTION 承担边沿；每段介入只报一次，离开 permission-prompt 清
   0 → 新段可再报）。不是等 3 次 busy、不依赖 transcript 陈旧度、启动首轮也报（挂载时就卡权限框的会话
   此刻就要介入）。
3. **`--check` 契约接缝（Contract measure/invoke）**：自包含自检，构造 permission-prompt / busy /
   waiting-input 三种 pane，验证三条契约带并输出
   `permission_prompt_class=intervention-required` / `busy_true_work_not_flagged=1` /
   `intervention_triggered=1`，退出 0。
4. **`--pane-state` 接缝**：输出加 `intervention=<0|1>`（`state=/busy=` 保持向后兼容）。
5. 文件头注释 + 候选 B WARN 文案更新（permission-prompt 已单列非忙，"SESSION-IDLE 被阻断" 的说法不再成立）。

### 契约带实跑

```text
$ bash plugin/scripts/session-liveness.sh --check
permission_prompt_class=intervention-required (raw permission-prompt; busy=0 intervention=1)
intervention_triggered=1 (permission-prompt ⇒ SESSION-INTERVENTION-REQUIRED 事件立即发出，非等 3 次 busy)
busy_true_work_not_flagged=1 (busy ⇒ busy=1 intervention=0——正常忙碌不误报)
session-liveness --check: PASS — permission-prompt 单列非 busy + 触发 intervention；正常忙仍 busy
（退出 0）
```

构造 permission-prompt pane ⇒ `--pane-state` 读数 `state=permission-prompt busy=0 intervention=1`（修复前
读 busy=1）；主循环发出 `SESSION-INTERVENTION-REQUIRED`。正常忙碌（esc to interrupt）⇒ `busy=1
intervention=0`，不触发 intervention（负控制）。

### 变更文件

- `plugin/scripts/session-liveness.sh`（单列 + 事件 + --check/--pane-state 接缝 + 注释）
- `plugin/test/session-liveness-helpers.mjs`（新增 `makePanePermissionPrompt` helper）
- `plugin/test/session-liveness-signals.test.mjs`（新增 5 测试：AC1/AC2 单列、AC4 负控制单元、Contract
  --check、AC3 主循环边沿触发、AC4 主循环负控制）
- `tasks/gap-last-pane-txt-has-no-writer.md`（交叉标注——第一道遮蔽，同检测链）
- `tasks/gap-permission-prompt-merged-into-busy.md`（自身：勾 AC + 贴证据）

### scoped 门结果

`bash scripts/test.sh --for-task gap-permission-prompt-merged-into-busy --allow-thin`（worktree 内）：

```text
task-contract-check: no violations.
adr016-screen-use-check — violations: 0
dead-code-after-return-check — violations: 0
tests 55, pass 55, fail 0, cancelled 0
（退出 0）
```

55 测试 = `pane-state-classify.test.mjs`（20）+ `session-liveness-signals.test.mjs`（35，含 5 新增）。
既有候选 B WARN 测试、D5、饱和度等全部保持绿（无回归）。

### 内层给外层的备注

- **worktree 基线缺第一道遮蔽任务文件**：`tasks/gap-last-pane-txt-has-no-writer.md` 不在本 worktree
  （fork 自 develop 2e7ccc5a；该文件在 integration 分支上）。已用 `git show integration:<path>` 带入
  worktree 并加交叉标注。若外层合并/集成时该文件已有，留意同一文件的两处来源。
- 全量套件由外层 verification-round 验证（DoD 末行未勾，`status: ready` 不变）。

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
