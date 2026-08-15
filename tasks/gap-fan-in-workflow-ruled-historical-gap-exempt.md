---
id: gap-fan-in-workflow-ruled-historical-gap-exempt
title: fan-in-workflow-check 加 ruled-historical-gap 豁免表——gap-ac81-inner-verify-wiring 分类定案（AC81 doc-only 直投，manager-phase-goal.md:226/:681 已记已知例外；⛔ 不补正式 dispatch 掩盖记录）
status: ready
labels:
  - gap
  - mechanism
parent: null
children: []
extra:
  schema: execution
depends_on: []
---

**type:** execution

## Proposal

**（inner 裁定，outer 2026-08-15 05:2xZ 认可：选② 分类定案，不补正式 dispatch）**。

**现象**：carriers fbd69edd（QUAY_MAIN_CHECKOUT）落地后，fan-in-workflow-check 在 worktree 轮真评估 ⇒ 每轮 RED `missing=[gap-ac81-inner-verify-wiring]`。这是 carriers AC3 verdict-consistency 设计的预期新信号（surface 真实历史差集），但差集必须被处理掉（AC3 钉死判据：差集被处理掉时主检出与 worktree 同转 ok=true）。

**gap-ac81-inner-verify-wiring 证据链（outer round188 分诊）**：
- 任务文件从未立案（tasks/ 无此文件）
- lock event 2026-08-14 22:04:00Z（post-boundary，boundary=09:20:07Z）runId `fm-gap-ac81-inner-verify-wiring-doc`，acquire+release 同秒
- 真实双亲 merge `8e833277`（develop→task/gap-ac81-inner-verify-wiring，改动 orchestrator-tick-core.md 7 行）
- meta-cc 查**零** Workflow(fan-in-execute.js) 调用 ⇒ 走的是 fan-in-ff-merge.sh 非 workflow
- manager-phase-goal.md:226「未定案，留 outer/inner」；:681「AC81 doc-only 落地走的是 fan-in-ff-merge.sh 而非本 workflow」

**⛔ 不选①（补正式 dispatch）**：历史事实是直投 ff-merge，重跑 workflow 只会让记录看起来合规（回填掩盖，AC3 语义被腐蚀）。选② 是诚实的承载——检查器加**可见可审计的 ruled-historical-gap 豁免表**（同 bypass-check design-internal 排除集先例：checked-in 列表 + reason，非静默掩盖）。

**判据1**：fan-in-workflow-check 加 ruled-historical-gap 豁免表（checked-in 列表 + reason，可 grep 可审计）；gap-ac81-inner-verify-wiring 入表（reason 引 manager-phase-goal.md:226/:681 + 证据链）。
**判据2（能取假）**：豁免后主检出 fan-in-workflow-check ok=true；worktree（carriers 接线）读主检出同数据 ⇒ 同 verdict ok=true（AC3 钉死判据满足）。非豁免的新直投仍红（豁免不覆盖任意任务）。
**判据3**：既有测试全绿；`--for-task` scoped 门绿。

**不覆盖**：不补 gap-ac81 的正式 dispatch；不改 carriers AC3 判据；豁免表只承载已定案的历史缺口（新增缺口走正常定案流程）。

**本任务不新建过程纪律型 AC**：负控制沿用 AC49。

## Plan

1. 读 fan-in-workflow-check.ts（withCalls 覆盖逻辑 + runId 匹配）+ 其测试。
2. 加 ruled-historical-gap 豁免表（checked-in 数组 + reason），gap-ac81-inner-verify-wiring 入表。
3. 判据2 能取假：豁免后主检出 ok=true；未豁免新直投仍红。
4. 既有测试全绿 + `--for-task` scoped 门绿。

## Acceptance Criteria

- [x] AC1 判据1：fan-in-workflow-check ruled-historical-gap 豁免表落地；gap-ac81-inner-verify-wiring 入表（reason 引 manager-phase-goal.md:226/:681）。
- [x] AC2 判据2 能取假：豁免后主检出 ok=true + worktree 同 verdict（AC3 满足）；非豁免新直投仍红。
- [x] AC3 判据3：既有测试全绿；`--for-task` scoped 门绿。

## Definition of Done

- [x] ruled-historical-gap 豁免表（gap-ac81 入表 + reason）+ 主检出 ok=true + worktree 同 verdict + 非豁免仍红 + 测试绿。

## Touches

- plugin/scripts/fan-in-workflow-check.ts（ruled-historical-gap 豁免表）
- plugin/test/fan-in-workflow-check.test.mjs（豁免用例：gap-ac81 绿 + 未豁免仍红）
- tasks/gap-fan-in-workflow-ruled-historical-gap-exempt.md（自身）

## Evidence

（2026-08-15 落地回填——Build 阶段实现 + 测试，见下；证据链见 Proposal）

**实现**：`plugin/scripts/fan-in-workflow-check.ts` 加 `RULED_HISTORICAL_GAPS` ruled-historical-gap 豁免表
（checked-in 数组 `{taskId, reason}`），`gap-ac81-inner-verify-wiring` 入表（reason 引
manager-phase-goal.md:226/:681 + 证据链：lock event 2026-08-14T22:04:00Z runId
`fm-gap-ac81-inner-verify-wiring-doc`、真实双亲 merge 8e833277、meta-cc 零 Workflow(fan-in-execute) 调用）。
`checkWorkflowCoverage` 增第 6 参 `ruledHistoricalGaps`（默认 `[]` 向后兼容），入表任务在差集逻辑【之前】
短路 → 移出 `missing`/`unresolvableDispatch`，报为新字段 `ruledHistoricalGaps`（可见 + 可审计，非静默掩盖）。

**判据2（能取假）实测**（worktree 内直跑，读主检出数据）：
- 主检出 fan-in-workflow-check → `ok=true` `evaluated=true`，`missing=[]`、`unresolvableDispatch=[]`、
  `ruledHistoricalGaps=[gap-ac81-inner-verify-wiring]`（reason 完整）。
- worktree（carriers 接线）读主检出同数据 → 同 verdict `ok=true`（AC3 判据满足）。
- 非豁免新直投（`gap-post-baseline`）同 fixture 追加 → `ok=false` `missing=[gap-post-baseline]`，
  `ruledHistoricalGaps` 仍只含 gap-ac81（豁免有界，能取假）。

**判据3 实测**：`plugin/test/fan-in-workflow-check.test.mjs` 61/61 绿（含新增豁免用例）；
`scripts/test.sh --for-task gap-fan-in-workflow-ruled-historical-gap-exempt` scoped 门绿
（scoped 静态检查含 fan-in-workflow-check `--root ${main_root}` exit 0）。

**round188 red 定位**：carriers fbd69edd 接线后 worktree 轮真评估 ⇒ 每轮 RED
`missing=[gap-ac81-inner-verify-wiring]`；本任务按 inner 裁定选② 分类定案（豁免表承载），不补正式 dispatch。
