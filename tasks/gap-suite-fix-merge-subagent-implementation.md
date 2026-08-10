---
id: gap-suite-fix-merge-subagent-implementation
title: suite-fix-merge subagent 执行体实现——人裁定(2026-08-10 完整裁定集)已入执行核 A15/D,现需实现:A15
  定何时判/判什么/产物,本任务定谁去跑/跑在哪;subagent 从 integration 切 branch→修(含
  tasks/*.md)→自测绿→fan-in 回 integration→批量合 develop 到确切提交(COVERAGE
  天然满足,verifiedCommit 多余);评价 subagent 输出= suite-health-last-run.json;执行保障=连续 3
  轮心跳缺失⇒.halt,再 3 轮⇒/clear
status: ready
labels:
  - gap
  - mechanism
parent: "null"
children: []
extra: {}
---
**type:** execution

## Proposal

**人的完整裁定集（2026-08-10）已入执行核（A15 执行体 + D 边界 .halt 判据，outer f641d3ca），本任务是它的实现。** A15 定「何时判、判什么、产物是什么」，本提案定「谁去跑、跑在哪」——做成一件事，不并立两套。

### 实证（人裁定 5 条 + outer 核实）

- **裁定1（合并路径，采纳）**：`subagent 从 integration 切 branch → 修 → 自测绿 → (a) branch 合回 integration（fan-in 形态）→ (b) 批量合并把 develop 推到那个确切提交`。(b) 仍走 `integration-batch-merge.sh` 的 ref-level update-ref + CAS 单写入者路径 ⇒ 两线不变式不破；被验证的提交就是 branch tip ⇒ COVERAGE 天然满足，verifiedCommit 补丁多余；修复同时落两条线。
- **裁定2（终止，.halt）**：subagent 未绿即退出 ⇒ 设 `.halt`（人的原话「系统说它无法绿窗了」）。`.halt` 触发条件 = **「具备完全修复权限的执行体已经失败」**，不是「红了」——与旧死锁反对（停派发好让 outer 修红）不冲突。上限待定，建议 ≥8 轮或 ≥3 小时（今晚 8 轮 164 分钟收敛的实测）。
- **裁定3（修复范围）**：授权 subagent 修 `tasks/*.md`。subagent fail ⇒ **outer 必须停下其它事处理**（强制，不是记一笔继续）。
- **裁定4（A15 合并）**：评价 subagent 的输出**就是 `.quay/suite-health-last-run.json`**，不另立产物。
- **裁定5（执行保障）**：连续 3 轮 A15 心跳缺失（`meta-cc query tool_name=Agent` last(timestamp) 无新 ts）⇒ 先 `.halt`；再 3 轮仍缺 ⇒ `/clear`。**背景 subagent 对 outer 是从没做过的动作**（全历史 Agent 调用=1 次且 run_in_background=None）——按 C17 需要有产物，心跳时间戳正是它。

### 选定机制方向（实现归 inner，判定归 outer）

1. **suite-fix-merge subagent**：outer 起后台 subagent（Agent run_in_background:true），自带 git worktree；从 integration 切 branch → 跑套件 → 修（含 tasks/*.md）→ 自测绿 → (a) fan-in 回 integration → (b) 批量合 develop 到 branch tip。
2. **评价 subagent**：输出 `.quay/suite-health-last-run.json`（结构化，零发现也写 0），专注套件耗时 + 合并中发现的问题，可创建任务。
3. **执行保障**：A15 心跳（meta-cc Agent timestamp）缺失 3 轮 ⇒ .halt；再 3 轮 ⇒ /clear。
4. **终止**：≥8 轮或 ≥3 小时上限（建议值），未绿 ⇒ .halt + outer 停其它事。

**验证锚**：修后 (a) outer 起 suite-fix-merge subagent（run_in_background:true）成功且产生 heartbeat ts；(b) 修复落到 integration（fan-in）且 develop 到确切提交；(c) 评价 subagent 产出 suite-health-last-run.json 带时间戳。

## Acceptance Criteria

- [ ] AC1: **复现固化**——任务体记录 5 裁定 + outer 核实（develop 单写入者实证、outer Agent 历史 1 次前台）（本任务 Proposal 已含）
- [ ] AC2: **suite-fix-merge subagent**——outer 后台起 subagent（run_in_background:true）+ 自带 worktree，integration 切 branch→修→自测绿→(a)fan-in→(b)批量合到确切提交
- [ ] AC3: **tasks/*.md 授权**——subagent 可修 tasks/*.md（裁定3）
- [ ] AC4: **评价 subagent 产物**——输出 = `.quay/suite-health-last-run.json`（结构化，零发现写 0）
- [ ] AC5: **执行保障接线**——A15 心跳（meta-cc Agent ts）缺失 3 轮 ⇒ .halt，再 3 轮 ⇒ /clear
- [ ] AC6: **终止上限**——≥8 轮或 ≥3 小时，未绿 ⇒ .halt + outer 停其它事
- [ ] AC7: **既有不回归**——`--for-task` scoped 门绿

## Definition of Done

- [ ] AC1–AC7 全部勾上
- [ ] 修后实跑：outer 起 subagent 产生 heartbeat ts + 修复落两条线（贴输出）
- [ ] 既有测试 + 新增测试全绿（`--for-task` scoped）
- [ ] 全量套件绿（`fail 0` 且 `cancelled 0` 且 `FULL-SUITE-EXIT=0`）——外层 verification-round 验证

## Touches

- orchestration/orchestrator-tick-core.md（A15 执行体已入；实现如需同步核）
- plugin/scripts/ 或 workflow 模板（suite-fix-merge subagent + 评价 subagent）
- plugin/test/（subagent 相关测试，若脚本化）
- tasks/gap-suite-fix-merge-subagent-implementation.md（自身：勾 AC + 贴输出）

## Contract

measure   suite_fix_subagent_wired = `grep -c "suite-fix-merge\|run_in_background: true" orchestration/orchestrator-tick-core.md plugin/scripts/*.ts` 的 stdout 数字
band      suite_fix_subagent_wired >= 1（subagent 执行体接线）
invariant merge_path_integration_first = 1（integration 切 branch→fan-in→批量合 develop,非直合）
invariant eval_output_is_suite_health = 1（评价 subagent 输出=suite-health-last-run.json）
invariant heartbeat_ladder = 1（3 轮心跳缺⇒.halt,再 3 轮⇒/clear）
invoke    `bash plugin/scripts/<suite-fix-subagent>.sh --check`（贴输出：subagent 起 + 修复落两条线）
control   合并路径 integration 先；可修 tasks/*.md；评价产物=suite-health；终止上限；心跳阶梯
resume    subagent / 评价者 / 执行保障分步提交，任一步完成即写盘

## Dispatch review

reviewer: outer
at: 2026-08-10
changed: 人完整裁定集(5 条)已入执行核(f641d3ca);本任务是实现(归 inner)——A15 执行体实现;合并路径 integration 先(不变式不破,COVERAGE 天然);可修 tasks/*.md;未绿⇒.halt;评价输出=suite-health-last-run.json;心跳阶梯 3→.halt→3→/clear
