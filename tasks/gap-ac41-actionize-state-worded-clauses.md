---
id: gap-ac41-actionize-state-worded-clauses
title: 结果状态型条款改写成动作+可核产物——三份执行核 95% 是动作，唯一 5% 状态描述正是坏掉的那条（orchestrator
  的「自测绿」）；实证：两个 suite-fix subagent 同一份条文行为相反（引文件的失败 scope=main、全散文的成功
  scope=worktree）；自测绿正确写法=「worktree 里跑 scripts/test.sh 直到
  verification-round.jsonl 出现 scope=worktree 且 state=green」；measure=状态描述型措辞计数→0
status: done
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

- [x] AC1: **复现固化**——任务体记录反直觉实证（两 subagent 对照表）+ 措辞分布（95% 动作 / 1 处状态描述 = 自测绿）+ 自测绿坏因（本任务 Proposal 已含）
- [x] AC2: **枚举**——三份执行核 + 被 skill 引用的行为文件枚举全部结果状态型可执行条款（清单见本任务「执行证据」）
- [x] AC3: **逐条动作化**——每条改成「命令 + 可核产物」形态；首条 `自测绿` →「worktree 跑 scripts/test.sh 直到 verification-round.jsonl 有 scope=worktree+green 记录」
- [x] AC4: **measure 归零**——状态描述型措辞计数 = 0（基线 1/1/0）；检查器可机械核（新 `plugin/scripts/state-worded-clause-check.ts`，@static-tier change）
- [x] AC5: **既有不回归**——`--for-task` scoped 门绿（17/17 绿 exit 0，`--allow-thin`）

## 执行证据（inner 2026-08-10）

**枚举清单（AC2）——三份执行核 + 被引用的行为文件全部结果状态型可执行条款：**
- `orchestration/orchestrator-tick-core.md` A15 ④：`自测绿`（结果状态）→ 动作化；同条 `未绿退出`（结果状态）→ 一并动作化（`直到.*绿` 同一行跨句命中使裸 measure 计 1，修后归零）。
- `orchestration/fast-mode-tick-core.md` A19：`心跳无机械保证`（literal measure 命中 `保证`）→ `心跳缺机械产物`（措辞计数归零所必需；语义对齐 C17「缺的是产物不是可见性」）。
- `orchestration/manager-tick-core.md`：0 处（人的裁定引语不计，扫描确认无新增）。
- `plugin/skills/`：0 处状态描述型（枚举后无需改写）。
- 源文档 `orchestrator-loop-tick.md` 的 `确保`/`机械保证` 是理由档案散文（同段紧邻具体命令），非执行核、不在 measure 面，不改。

**改写前后（Contract invoke `grep -nE "自测绿|确保|保证" orchestration/orchestrator-tick-core.md`）：**
- 改前：`…→修→自测绿→(a)branch 合回…`（line 35 命中 `自测绿`）。
- 改后：`…→修→在自带 worktree 里跑 \`scripts/test.sh\` 直到 \`verification-round.jsonl\` 出现 \`scope=worktree\` 且 \`state=green\` 记录→(a)branch 合回…`；同条 `未绿退出 ⇒` → `\`verification-round.jsonl\` 无 \`scope=worktree\` 且 \`state=green\` 记录 ⇒ 退出并…`。grep 零命中。

**measure 归零（Contract `grep -cE "自测绿|确保|保证|直到.*绿" orchestration/{manager,orchestrator,fast-mode}-tick-core.md`）：**
```
orchestration/manager-tick-core.md:0
orchestration/orchestrator-tick-core.md:0
orchestration/fast-mode-tick-core.md:0
```

**新检查器可机械核（AC4）：**
```
$ node --no-warnings --experimental-strip-types plugin/scripts/state-worded-clause-check.ts --root . --json
{ "count": 0, "band": 0, "hits": [] }
```
负向控制：`--judge` 一个含 `自测绿` 的临时文件 ⇒ exit 1 报出；actionized 形 ⇒ exit 0（见 `plugin/test/state-worded-clause-check.test.mjs` 5 例 + `plugin/scripts/checker-mutation-cases/state-worded-clause-check.sh`）。

**scoped 门（AC5）：** `./scripts/test.sh --for-task gap-ac41-actionize-state-worded-clauses --allow-thin` ⇒ **exit 0，17 pass / 0 fail / 0 cancelled**（含 5 个新 checker 测试 + capability-catalog 全族）。Touches 以文档改写为主、可解析测试少，按 selector 文档语义用 `--allow-thin`（选中集确实跑了且全绿，未静默欠选）。

**交叉标注（同 AC41 判据 2/3）：** 两个 sibling 任务（`gap-ac41-coldstart-skill-reference-only.md` / `gap-ac41-red-on-omission-artifact.md`）仅存在于 integration（d5418679），不在 develop fork；从主检出拷入字节一致副本（fan-in 无冲突）。二者的 Touches 已指向本任务（同 AC41 判据 1）；`gap-ac41-red-on-omission-artifact.md` 的裸目录 Touches 声明被 `task-contract-check` 检出违规（bare-dir-uncertain-touch），按其自身 Contract measure 落为具体路径 `plugin/scripts/red-on-omission-audit.ts`（机械清理，非行为变更）。

## Definition of Done

- [x] AC1–AC5 全部勾上
- [x] 修后实跑：措辞计数 = 0（贴输出）；自测绿新写法可执行（worktree 跑 test.sh → 等 scope=worktree+green）
- [x] 既有测试 + 新增测试全绿（`--for-task` scoped）
- [ ] 全量套件绿（`fail 0` 且 `cancelled 0` 且 `FULL-SUITE-EXIT=0`）——外层 verification-round 验证

## Touches

- orchestration/orchestrator-tick-core.md（A15 ④：`自测绿` + `未绿退出` → 动作化写法）
- orchestration/manager-tick-core.md（扫描确认 0 处——裁定引语不计，无改动）
- orchestration/fast-mode-tick-core.md（A19 `心跳无机械保证` → `心跳缺机械产物`，措辞计数归零所必需）
- plugin/skills/（被引用的行为文件——枚举 0 处状态描述型，无需改写）
- plugin/scripts/state-worded-clause-check.ts（新检查器：状态描述型措辞计数，@static-tier change）
- plugin/scripts/checker-mutation-cases/state-worded-clause-check.sh（新 mutation case，checker-mutation 门 AC1b）
- plugin/test/state-worded-clause-check.test.mjs（新测试，node:test + @test-group governance）
- scripts/test.sh（注册 state-worded-clause-check 进 run_static_checks）
- plugin/scripts/capability-catalog.sh（AC1c：新 checker 声明其问题）
- orchestration/manager-phase-goal.md（AC41 判据 1 正本——本任务 Proposal 已引用）
- tasks/gap-ac41-coldstart-skill-reference-only.md（交叉标注——同 AC41 判据 2；从 integration 拷入字节一致副本）
- tasks/gap-ac41-red-on-omission-artifact.md（交叉标注——同 AC41 判据 3；从 integration 拷入字节一致副本）
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

## 交叉标注 (gap-ac41-red-on-omission-artifact, 2026-08-10)

本任务（AC41 判据 1 动作化）解决「条文质量」，`gap-ac41-red-on-omission-artifact`（判据 3）解决
「执行保障」——两条同属 AC41，行为固化的完整形态 = 条文（动作化）+ 单源（引用）+ 执行保障（不做会
变红）。`state-worded-clause-check`（判据 1 的执行体）与 `red-on-omission-audit`（判据 3 的执行体）
都在 test.sh run_static_checks 里，同为 `@static-tier change`。
