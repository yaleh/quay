---
id: gap-ac41-actionize-state-worded-clauses
title: 结果状态型条款改写成动作+可核产物——三份执行核 95% 是动作，唯一 5% 状态描述正是坏掉的那条（orchestrator
  的「自测绿」）；实证：两个 suite-fix subagent 同一份条文行为相反（引文件的失败 scope=main、全散文的成功
  scope=worktree）；自测绿正确写法=「worktree 里跑 scripts/test.sh 直到
  verification-round.jsonl 出现 scope=worktree 且 state=green」；measure=状态描述型措辞计数→0
status: ready
labels:
  - gap
  - defect
  - delivery-critical
parent: null
children: []
extra: {}
---
**type:** execution

## Proposal

**三份执行核 + 被 skill 引用的行为文件里，每一条可执行条款必须是「跑什么命令 / 产出什么可核物」，不写「确保 / 保证 / 自测绿」这类结果状态。当前 95% 是动作（~20 处可执行命令型），唯一的 5% 状态描述正是今晚坏掉的那条——orchestrator 执行核 A15 ④ 的「自测绿」。**

### 实证（manager 2026-08-10 10:0x 措辞分布实测 + 反直觉 subagent 对照 + outer 复核）

- **反直觉实证（本条存在的全部理由）**：两个 suite-fix subagent 拿同一份 A15 ④ 条文，行为相反——
  | | 第一个 04:11（**成功** scope=worktree，出绿+merge） | 第二个 08:50（**失败** scope=main） |
  |---|---|---|
  | prompt 长度 | 5260 字符 | **4020 字符（短 1240）** |
  | 引用文件 | **无——全是现写散文** | `['A15 ④','orchestrator-tick-core.md']` |
  | `run the suite` | **3 次** | **0 次** |
  | `self-test` | 1 次 | 2 次 |
  ⇒ **引用了文件的那个失败了，全是散文的那个成功了。** 差别不在「引用 vs 复述」，**在「动作」被压缩成了「结果状态」**：`run the suite` → `self-test`。一个拿到 `self-test` + 文件引用的执行体，可以完全合理地把"自测"理解成"观察 suite 状态直到它绿"——它就是这么做的，且不觉得违反了任何条文。
- **措辞分布（outer 复核）**：三份执行核**状态描述型 1 处 / 可执行命令型 ~20 处**（三层均如此）；orchestrator 的唯一 1 处逐字是 `integration 切 branch→修→【自测绿】→fan-in→批量合`。manager 那 1 处是人的裁定引语（非执行条），fast-mode 0 处。
- **`自测绿` 为什么坏**：它是**结果状态**（"green"），不是动作。执行体无法从它推出「跑什么命令、等到哪个可核读数」。正确写法是动作+产物：「在自己的 worktree 里跑 `scripts/test.sh`，直到 `verification-round.jsonl` 出现一条 `scope=worktree` 且 `state=green` 的记录」——每一步都是命令/产物，缺一步即不可执行。

**为什么重要**：这是 AC41 判据 1（动作化）。行为固化（进 skill/workflow/tick）的前提是条文本身可执行——结果状态型措辞让执行体「看起来遵守了、实际做的是另一件事」，且不觉得违反条文。这与今晚 scope=main 失败、A15 裁定5 连续 9 轮未执行同族。

### 选定机制方向（实现归 inner，判定归 outer）

1. **扫描 + 枚举**：三份执行核（`orchestration/{manager,orchestrator,fast-mode}-tick-core.md`）+ 被 skill 引用的行为文件里，枚举所有「结果状态型」可执行条款（`自测绿` / `确保` / `保证` / `直到绿` 等）。
2. **逐条改写**：每条改成「跑什么命令 / 产出什么可核物」形态。首条即 `自测绿` →「worktree 里跑 `scripts/test.sh` 直到 `verification-round.jsonl` 出现 `scope=worktree` 且 `state=green` 记录」。
3. **measure 归零**：状态描述型措辞计数 → 0（基线 manager 1（人的裁定引语，非执行条）/ orchestrator 1（自测绿）/ fast-mode 0）。

**验证锚**：修后 (a) 状态描述型措辞计数 = 0；(b) `自测绿` 不再以结果状态形式出现；(c) 每条可执行条款都能指出「跑什么 / 等什么读数」。

## Acceptance Criteria

- [ ] AC1: **复现固化**——任务体记录反直觉实证（两 subagent 对照表）+ 措辞分布（95% 动作 / 1 处状态描述 = 自测绿）+ 自测绿坏因（本任务 Proposal 已含）
- [ ] AC2: **枚举**——三份执行核 + 被 skill 引用的行为文件枚举全部结果状态型可执行条款（清单贴任务体）
- [ ] AC3: **逐条动作化**——每条改成「命令 + 可核产物」形态；首条 `自测绿` →「worktree 跑 scripts/test.sh 直到 verification-round.jsonl 有 scope=worktree+green 记录」
- [ ] AC4: **measure 归零**——状态描述型措辞计数 = 0（基线 1/1/0）；检查器可机械核
- [ ] AC5: **既有不回归**——`--for-task` scoped 门绿

## Definition of Done

- [ ] AC1–AC5 全部勾上
- [ ] 修后实跑：措辞计数 = 0（贴输出）；自测绿新写法可执行（worktree 跑 test.sh → 等 scope=worktree+green）
- [ ] 既有测试 + 新增测试全绿（`--for-task` scoped）
- [ ] 全量套件绿（`fail 0` 且 `cancelled 0` 且 `FULL-SUITE-EXIT=0`）——外层 verification-round 验证

## Touches

- orchestration/orchestrator-tick-core.md（A15 ④：`自测绿` → 动作化写法）
- orchestration/manager-tick-core.md（如有人裁定引语外的状态描述条）
- orchestration/fast-mode-tick-core.md（基线 0，扫描确认无新增）
- plugin/skills/（被引用的行为文件——枚举后按需改写）
- plugin/scripts/（新检查器或复用：状态描述型措辞计数，@static-tier）
- orchestration/manager-phase-goal.md（AC41 判据 1 正本——本任务 Proposal 已引用）
- tasks/gap-ac41-coldstart-skill-reference-only.md（交叉标注——同 AC41 判据 2）
- tasks/gap-ac41-red-on-omission-artifact.md（交叉标注——同 AC41 判据 3）
- tasks/gap-ac41-actionize-state-worded-clauses.md（自身：勾 AC + 贴证据）

## Contract

measure   state_worded_clauses = `grep -cE "自测绿|确保|保证|直到.*绿" orchestration/{manager,orchestrator,fast-mode}-tick-core.md` 的 stdout 数字
band      state_worded_clauses = 0（基线 1/1/0；manager 裁定引语不计）
invariant every_clause_actionable = 1（每条可执行条款 = 命令 + 可核产物）
invariant self_test_actioned = 1（自测绿 = worktree 跑 test.sh 直到 scope=worktree+green）
invoke    `grep -nE "自测绿|确保|保证" orchestration/orchestrator-tick-core.md`（贴改写前后）
control   措辞计数 0；自测绿动作化；每条可执行；既有不回归
resume    枚举 / 逐条动作化 / 计数归零分步提交，任一步完成即写盘

## Dispatch review

reviewer: outer
at: 2026-08-10
changed: 人裁定「同意上述意见…更新 AC、创建任务并推进」+ manager AC41 落盘。反直觉实证：两 subagent 同一条文行为相反（引文件失败/全散文成功），差别=动作被压缩成结果状态（run the suite→self-test）。措辞分布 95% 动作 / 1 处状态描述 = 自测绿。立案：结果状态型条款动作化。实现归 inner，判定归 outer
