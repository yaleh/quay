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

**人的完整裁定集（2026-08-10）已入执行核（A15 执行体 + D 边界 .halt 判据，outer f641d3ca）。outer 已于 2026-08-10 04:10 用 `Agent(run_in_background:true)` 首次实跑 suite-fix-merge subagent（agent a4da8d45）——机件全部现成（git worktree add / scripts/test.sh / git merge / integration-batch-merge MERGE-TO-VERIFIED-COMMIT，后者 02:19:38 实测放行 183 提交），**不需要造任何新东西**。本任务角色已改：**把这次实跑的流程结晶成可复用的固定形态**（prompt 模板 / A15 心跳接线 / 评价 subagent 产物格式），不是「先造再用」——manager 2026-08-10 04:0x 纠正（人 2026-08-09T16:07 裁定过的形状：该自己执行，不是创建任务扔 inner）。

### 实证（人裁定 5 条 + outer 核实）

- **裁定1（合并路径，采纳）**：`subagent 从 integration 切 branch → 修 → 自测绿 → (a) branch 合回 integration（fan-in 形态）→ (b) 批量合并把 develop 推到那个确切提交`。(b) 仍走 `integration-batch-merge.sh` 的 ref-level update-ref + CAS 单写入者路径 ⇒ 两线不变式不破；被验证的提交就是 branch tip ⇒ COVERAGE 天然满足，verifiedCommit 补丁多余；修复同时落两条线。
- **裁定2（终止，.halt）**：subagent 未绿即退出 ⇒ 设 `.halt`（人的原话「系统说它无法绿窗了」）。`.halt` 触发条件 = **「具备完全修复权限的执行体已经失败」**，不是「红了」——与旧死锁反对（停派发好让 outer 修红）不冲突。**上限已定（outer 2026-08-10 05:50，manager 量化 RED_GRACE_MS=30s 击杀 ⇒ failures[] 结构上=1 ⇒ N 失败=N 轮×~31min）**：**首轮诊断轮（`QUAY_TEST_RED_GRACE_MS=3600000` 不 fail-fast）收全集 → 一轮修全部 + 一轮验证 ≈ 2–3 轮**；上限按「全集大小 + 1 验证轮」定，不是拍天数。未达绿 ⇒ .halt + outer 停其它事。
- **裁定3（修复范围）**：授权 subagent 修 `tasks/*.md`。subagent fail ⇒ **outer 必须停下其它事处理**（强制，不是记一笔继续）。
- **裁定4（A15 合并）**：评价 subagent 的输出**就是 `.quay/suite-health-last-run.json`**，不另立产物。
- **裁定5（执行保障）**：连续 3 轮 A15 心跳缺失（`meta-cc query tool_name=Agent` last(timestamp) 无新 ts）⇒ 先 `.halt`；再 3 轮仍缺 ⇒ `/clear`。**背景 subagent 对 outer 是从没做过的动作**（全历史 Agent 调用=1 次且 run_in_background=None）——按 C17 需要有产物，心跳时间戳正是它。

### 选定机制方向（结晶本次实跑，非造机制）

1. **本次实跑已发生**（outer 04:10 起 Agent a4da8d45，run_in_background:true）——机件全现成，无需 inner 造。
2. **结晶产物**：把实跑流程固化为可复用 prompt 模板（含 5 裁定 + ①-⑤ 机件清单 + 终止条件）→ A15 心跳接线（meta-cc Agent ts）→ 评价 subagent 产物格式（suite-health-last-run.json）。
3. **执行保障**：A15 心跳（meta-cc Agent timestamp）缺失 3 轮 ⇒ .halt；再 3 轮 ⇒ /clear。
4. **终止**：首轮诊断轮收全集（QUAY_TEST_RED_GRACE_MS 大值不 fail-fast）→ 一轮修全部 + 一轮验证 ≈ 2–3 轮；上限按全集大小 + 1 验证轮，未绿 ⇒ .halt + outer 停其它事。

**验证锚**：实跑已产 (a) outer 起 suite-fix-merge subagent（run_in_background:true）成功且产生 heartbeat ts（04:10 a4da8d45）；(b) 修复落到 integration（fan-in）且 develop 到确切提交（待实跑完成确认）；(c) 评价 subagent 产出 suite-health-last-run.json 带时间戳。

## Acceptance Criteria

- [ ] AC1: **复现固化**——任务体记录 5 裁定 + outer 核实（develop 单写入者实证、outer Agent 历史 1 次前台）+ manager 纠正（该自己执行非建任务扔 inner）（本任务 Proposal 已含）
- [ ] AC2: **首次实跑完成**——outer 04:10 起 suite-fix-merge subagent（run_in_background:true）实跑，integration 切 branch→修→自测绿→(a)fan-in→(b)批量合到确切提交（agent a4da8d45 结果回填）
- [ ] AC3: **tasks/*.md 授权验证**——subagent 实跑中确认可修 tasks/*.md（裁定3）
- [ ] AC4: **评价 subagent 产物**——输出 = `.quay/suite-health-last-run.json`（结构化，零发现写 0）
- [ ] AC5: **执行保障接线**——A15 心跳（meta-cc Agent ts）缺失 3 轮 ⇒ .halt，再 3 轮 ⇒ /clear
- [ ] AC6: **终止上限**——首轮诊断轮收全集（QUAY_TEST_RED_GRACE_MS 大值），上限按全集大小 + 1 验证轮，未绿 ⇒ .halt + outer 停其它事
- [ ] AC7: **既有不回归**——`--for-task` scoped 门绿

## Definition of Done

- [ ] AC1–AC7 全部勾上
- [ ] 修后实跑：outer 起 subagent 产生 heartbeat ts + 修复落两条线（贴输出）
- [ ] 既有测试 + 新增测试全绿（`--for-task` scoped）
- [ ] 全量套件绿（`fail 0` 且 `cancelled 0` 且 `FULL-SUITE-EXIT=0`）——外层 verification-round 验证

## Touches

- orchestration/orchestrator-tick-core.md（A15 执行体已入；结晶 prompt 模板若需同步核）
- tasks/gap-suite-fix-merge-subagent-implementation.md（自身：勾 AC + 贴实跑结果）

## Contract

measure   suite_fix_subagent_ran = `meta-cc query tool_name=Agent` last(timestamp) 的 stdout 时间戳
band      suite_fix_subagent_ran = 2026-08-10T04:10（首次实跑已发生,心跳存在）
invariant merge_path_integration_first = 1（integration 切 branch→fan-in→批量合 develop,非直合）
invariant eval_output_is_suite_health = 1（评价 subagent 输出=suite-health-last-run.json）
invariant heartbeat_ladder = 1（3 轮心跳缺⇒.halt,再 3 轮⇒/clear）
invoke    `meta-cc query tool_name=Agent → last(timestamp)`（贴输出：04:10 首次后台 subagent 实跑心跳）
control   实跑已发生(非造机制)；合并路径 integration 先；评价产物=suite-health；心跳阶梯
resume    结晶 prompt 模板 / 心跳接线 / 评价产物格式分步提交，任一步完成即写盘

## Dispatch review

reviewer: outer
at: 2026-08-10
changed: 人完整裁定集(5 条)已入执行核(f641d3ca);本任务是实现(归 inner)——A15 执行体实现;合并路径 integration 先(不变式不破,COVERAGE 天然);可修 tasks/*.md;未绿⇒.halt;评价输出=suite-health-last-run.json;心跳阶梯 3→.halt→3→/clear
