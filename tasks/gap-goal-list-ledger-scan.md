---
id: gap-goal-list-ledger-scan
title: goal list --no-evidence：跳过 gate-events.jsonl 全量扫描
status: done
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

- [x] AC1 输出 parity：`goal list --json --no-evidence` 的 goal id 集合 == `goal list --json` 的 id 集合，且每条 `evidence`/`staleness`/`lastProgressAt` 三键缺席（JSON.stringify 后无该 key，钉死「缺席」这一种形态）。
- [x] AC2 负控制（ledger 未读）：fs-trace 断言 `--no-evidence` 路径对 `.quay/gate-events.jsonl` 零 read；对照 = 同条件下不带 flag 的 `goal list --json` 产生该 read（证明旁路是 flag 造成的）。
- [x] AC3 MCP parity：MCP `goal_list` 传 `includeEvidence:false` 后，goal id 集合与 CLI 一致、三键同样缺席。
- [x] AC4 计时基线（同 N 前后对照，非 CI 硬门）：冷 `goal list --json --no-evidence` 与不带 flag 的 `goal list --json` 各 ≥3 次，wall-time 记录进 `## Evidence`；`--no-evidence` median 应显著低于不带 flag（预期 ~1.4s → ~0.1s 级）。
- [x] AC5 测试绿：`scripts/test.sh` scoped（goal-store 相关）通过。

## Definition of Done

`--no-evidence` 在 CLI 与 MCP 两表面可调 + AC1–AC3 测试落地且绿 + AC4 现场冷计时读数记录在案。

## Evidence

**AC1–AC3 — `packages/quay/test/gap-goal-list-no-evidence.test.mjs`（3/3 pass）：**
- AC1：`goal list --json --no-evidence` 的 id 集合 == 不带 flag 的 id 集合（fixture: GOAL-001 + AC-001）；每条记录 `evidence`/`staleness`/`lastProgressAt` 三键缺席（对 **parsed JSON** 断言，即 stringify 之后的形态）。**对照**：同一 fixture 不带 flag 时三键全部在场（AC-001 有 `evidence`+`lastProgressAt`，GOAL-001 有 `staleness`+`lastProgressAt`）——否则「缺席」断言是空转。
- AC2：preload（`NODE_OPTIONS=--require`，随 env 进入 CLI 及它 spawn 的 Provider 子进程）patch `fs.openSync`/`readFileSync`/`readFile` 并记录对本 workspace ledger 的每次访问。⚠️ `scanGoalLedger` 用的是 `openSync`+`readSync`（goal-store.ts:556/573），只 patch `readFileSync` 会得到恒空 trace ⇒ 空转通过；故三者都 patch。
  - `--no-evidence`：**0 次** ledger 访问。
  - 对照（同命令去掉 flag）：**非空**——仪器本身被证明有效（trace 恒零 = 零信息，硬规则 4）。
- AC3：真实 Core aggregator（`node <quay> mcp`，StdioClientTransport）调用 `goal_list {includeEvidence:false}` → id 集合与 CLI 一致、三键缺席；`{}` 对照三键在场。

**AC4 — 现场冷计时（同一 workspace / 同 N=275 goals；ledger 164,944,331 bytes / 587,746 行；dist bundles；每次独立进程）：**

| 形态 | run1 | run2 | run3 | median |
|---|---|---|---|---|
| `goal list --json`（带 evidence） | 1253 ms | 1209 ms | 1235 ms | **1235 ms** |
| `goal list --json --no-evidence` | 411 ms | 420 ms | 426 ms | **420 ms** |
| 地板：空 goals 目录 + `--no-evidence` | 225 ms | 235 ms | 225 ms | **225 ms** |

⇒ ledger 扫描占 **≈815 ms**（1235→420）；剩余 420 ms = CLI+Provider 进程/MCP 往返地板（225 ms）+ 275 个 goal 文件的读取/序列化（≈195 ms，body 也在 JSON 里）。两者 id 数均为 275。源码头入口（`bin/quay.ts` 类型剥离，每进程 +~500 ms 加载地板）同向：1474 ms → 609 ms。注：Proposal 的 ~125 ms 估计对应「地板 + goal 文件」，本测量含真实 Provider 子进程/MCP 往返，故绝对值更高——**可去除的 ledger 成本才是指标**（≈815 ms 已归零）。

**AC5 — scoped gate：** `bash scripts/test.sh --for-task gap-goal-list-ledger-scan --allow-thin` → **208 tests, 208 pass, 0 fail**（22.5s）。selection 内含 `packages/quay/test/gap-goal-list-no-evidence.test.mjs` 与 `packages/quay/test/goal-store.test.mjs`。

**类型检查：** `npx tsc --noEmit -p packages/quay/tsconfig.json` 与 `packages/quay-native/tsconfig.json` 均 exit 0。

## Touches

- packages/quay/src/goal-store.ts
- packages/quay/src/cli/goal.ts
- packages/quay/src/cli/help.ts
- packages/quay/src/mcp-handlers.ts
- packages/quay/src/provider-client.ts
- packages/quay-native/src/mcp-server.ts
- packages/quay/test/goal-store.test.mjs
- packages/quay/test/gap-goal-list-no-evidence.test.mjs
- tasks/gap-goal-list-ledger-scan.md
