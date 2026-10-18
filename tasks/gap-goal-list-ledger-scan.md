---
id: gap-goal-list-ledger-scan
title: goal list --no-evidence：跳过 gate-events.jsonl 全量扫描
status: todo
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
---
**type:** execution

## Proposal

`goal list` 每次调用都全量扫描 + 逐行 JSON.parse `.quay/gate-events.jsonl`（本仓库实测 165MB / 587k 行，单调增长：源码注释 goal-store.ts:516-517 记 2026-10-16 为 148.7MB / 560,752 行）。成本 ∝ ledger 尺寸、与 goal 数无关——实测 275 goal 冷启动 ~1.4s（其中 ~1.3s 是 ledger 扫描），而同仓库 `task list` 2872 任务 / 29.6MB 才 ~0.6s。fleet overview / CloudCLI server 等消费侧只需 goal frontmatter（1.19MB）投影 byStatus 计数，不必付 ledger 全扫。加 `--no-evidence`（filter `includeEvidence:false`）跳过证据派生，成本降到 ~125ms（105ms node 地板 + ~20ms goal 文件）。消费侧已确认接受「拿完整数组自己数」，不做 `--counts-only`。

## Plan

1. `goal-store.ts` `listWithMalformed`：接受 `includeEvidence:false` 选项；跳过 `ledgerEvidenceMap`（传空 Map）、跳过 `annotateGoalProgress`、跳过 `annotateGoalStaleness`。
2. CLI `goal list` 加 `--no-evidence` flag → filter `{ includeEvidence: false }`，照抄 `--no-body` 的 `includeBody:false` 惯用法（task-list.ts:114）。
3. MCP `goal_list`（mcp-handlers.ts）透传 `includeEvidence:false`。
4. 输出仍返回 `GoalViewModel[]`，`evidence`/`staleness`/`lastProgressAt` 三键缺席。

## Acceptance Criteria

- [ ] AC1 输出 parity：`goal list --json --no-evidence` 的 goal id 集合 == `goal list --json` 的 id 集合，且每条 `evidence`/`staleness`/`lastProgressAt` 三键缺席（JSON.stringify 后无该 key，钉死「缺席」这一种形态）。
- [ ] AC2 负控制（ledger 未读）：fs-trace 断言 `--no-evidence` 路径对 `.quay/gate-events.jsonl` 零 read；对照 = 同条件下不带 flag 的 `goal list --json` 产生该 read（证明旁路是 flag 造成的）。
- [ ] AC3 MCP parity：MCP `goal_list` 传 `includeEvidence:false` 后，goal id 集合与 CLI 一致、三键同样缺席。
- [ ] AC4 计时基线（同 N 前后对照，非 CI 硬门）：冷 `goal list --json --no-evidence` 与不带 flag 的 `goal list --json` 各 ≥3 次，wall-time 记录进 `## Evidence`；`--no-evidence` median 应显著低于不带 flag（预期 ~1.4s → ~0.1s 级）。
- [ ] AC5 测试绿：`scripts/test.sh` scoped（goal-store 相关）通过。

## Definition of Done

`--no-evidence` 在 CLI 与 MCP 两表面可调 + AC1–AC3 测试落地且绿 + AC4 现场冷计时读数记录在案。

## Touches

- packages/quay/src/goal-store.ts
- packages/quay/src/cli/goal.ts
- packages/quay/src/mcp-handlers.ts
- packages/quay/src/provider-client.ts
- packages/quay/test/goal-store.test.mjs
- tasks/gap-goal-list-ledger-scan.md