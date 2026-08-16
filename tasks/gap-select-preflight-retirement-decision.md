---
id: gap-select-preflight-retirement-decision
title: "select-preflight 退役决策：唯一非测试消费者 = ADR-022 退役经典循环入口——退役是产品决策，单独裁定"
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

**来源**：suite-fix 红基线诊断的副产品（manager 2026-08-16 消费者枚举完成）。

**消费者枚举（manager ✅ 逐条复算，按位置判定）**：`select-preflight.ts` 的**非测试消费者只剩一个**——
`.claude/workflows/select-preflight.js:28`（唯一真正 exec 它的地方），而该 workflow 自述是
「Encapsulate **OUTER-LOOP** SELECT preflight… per `/loop` wake-up」——**即 ADR-022 已退役的经典循环入口**。
其余 40+ 处 `grep select-preflight` 命中**全是注释里的任务名引用**或 `config-wiring-check.ts:139` 对
workflow 文件路径的接线检查——按位置判定，没有一个是调用。两层执行核
（`orchestration/{manager,orchestrator,fast-mode}-tick-core.md`、`plugin/loop/*.md`）零处调用；
`capability-catalog.sh` 零命中。

**⇒ 退役前提成立。但⛔ 退役是产品决策**，不应由修 flake 顺手做——本任务单独承载该决策。

## Plan

1. 复核消费者枚举（一条命令级：grep 按位置判定，排除注释/任务名引用）。
2. 决策点：退役 `select-preflight.ts` / 其 workflow / 相关测试？还是保留（留作未来用）？
3. 若退役：移除实现 + 测试 + workflow + wiring，记录退役理由与消费者枚举。

## Acceptance Criteria

- [ ] AC1: 消费者枚举复核完成（非测试消费者 = ADR-022 退役经典循环入口，无现行调用）。
- [ ] AC2: 退役决策记录（退役 or 保留，理由 + 裁定）。
- [ ] AC3: 若退役，实现/测试/workflow/wiring 全部移除且无残留引用（按位置判定）。

## Definition of Done

- [ ] select-preflight 的存废有明确裁定（退役记录理由 + 枚举，或保留理由），不留「待查」悬置。

## Touches

- experiments/quay-perpetual-stream/scripts/select-preflight.ts（退役删除——真实路径，非 packages/quay/src/）
- .claude/workflows/select-preflight.js（退役删除）
- experiments/quay-perpetual-stream/test/select-preflight-cli.test.mjs（退役删除）
- experiments/quay-perpetual-stream/test/select-preflight.test.mjs（退役删除）
- experiments/quay-perpetual-stream/test/candidate-synthesis.test.mjs（移除 getCandidates legacy 测试）
- experiments/quay-perpetual-stream/scripts/workflow-metadata-conformance.mjs（C6 文件集 5→4）
- plugin/scripts/workflow-metadata-conformance.mjs（双副本，与 experiments/ 逐字一致）
- plugin/scripts/config-wiring-check.ts（移除 select-preflight 引用）
- plugin/test/workflow-metadata-conformance.test.mjs（C6 断言更新）
- tasks/gap-select-preflight-retirement-decision.md（自身）
