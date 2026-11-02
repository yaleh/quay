---
id: gap-rounds-ledger-per-landed-task
title: 轮数台账：按落地任务拆分 inspect/edit/verify/fix/orchestration 轮数与返工原因，作为「成本/落地任务」的公共优化标尺
status: todo
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
---
## Proposal

2026-11-03 的效率核查给出一个可证伪的结论：**执行成本主要由"每个落地任务的轮数"决定**，而不是 prompt / base context / MCP schema。94 个落地 worker 任务的横截面（7 天，129 会话，10,392 轮）：

- `corr(轮数, 加权成本) = 0.965`（轮数单独解释约 93% 的方差）；
- 每轮上下文 C̄ 的 p10/p50/p90 = 66.8k / 104k / 160.7k（只有 2.4 倍跨度，二阶量）；
- **110.6 轮 / 每个落地任务**；
- 返工（非首次会话）= 27% 的会话、21% 的 worker 加权成本（38.6M eq/周）。

据此，人已确定三件事（2026-11-03 裁定）：

1. **目标函数：成本 / 落地任务优先，墙钟 / 落地任务其次。**
2. **范围：只优化 loop 内会话**；人机会话（human/interactive，约 23% 加权成本）由 quay-fleet 方向处理，不在本条范围。
3. **品质红线：只走"机械替代"，不砍验证面**——减轮必须来自把模型轮次换成机械步骤，⛔ 不允许通过减少测试/检查覆盖面来换轮数。

但现在的测量工具回答不了"下一刀切哪里"：E1 的轮数分解是**全语料**的（且不接窗口），不按"落地任务"聚合，也不分阶段。本任务交付一个只读的**轮数台账**：按落地任务聚合，把轮数拆成 inspect / edit / verify / fix / orchestration 五类，并把每个非首次会话归因到返工原因。它是后续所有结晶实验的公共标尺——先有台账，再选结晶点。

<!-- dedup-ref -->
与已 done 的 `gap-task-efficiency-baseline` / `gap-task-efficiency-baseline-attribution-semantics`（E1 工具）保持独立：E1 给的是语料级、全窗口的尝试/费用/落地区间；本条给的是**按落地任务**的阶段级轮数，且不改 E1 的判定语义；与 `docs/analysis/task-granularity-and-throughput-2026-10-07.md`（任务体量分档）互补：那份给 size 轴，本条给 rounds 轴。

## Plan

1. 实现只读工具 `scripts/rounds-ledger.mjs`：
   - 输入 `--sessions-dir`、`--root`、`--window-start/--window-end`、`--json`；
   - 会话→任务：首条 user 消息包含 `Task: <id>`（与 E1 同源规则；读不到 ⇒ `not-evaluated`，不猜）；
   - 轮数：按 `message.id` 去重后的 assistant 消息数（⛔ 不按 jsonl 行数，多 block 会重复计）；
   - 阶段：按该轮的工具调用分类，优先级 `verify > edit > inspect > fix-marker > orchestration`；混合工具按优先级取一，并在 `--json` 保留原始工具名计数；
   - 落地：沿用 E1 的定义——fan-in trace 中 `ff` 步骤 `ok:true` 才是落地证据；任务状态或受测 SHA 不算；
   - 成本：`fresh + cache_read × 0.1 + output × 5`，同时给 0.05× 口径；权重写进 `--help`，不隐藏。
2. 返工归因：同一任务的第 2..n 个会话，按 `worker-outcome.jsonl` 的 `final_state` + fan-in step trace 的失败步骤分类为 `fan-in-red` / `worker-exited` / `crash-or-timeout` / `superseded` / `unknown`；`unknown` 单列，⛔ 不并入任一已知类。
3. 产出 `docs/analysis/rounds-ledger-2026-11-03.md`：全局阶段占比、top 任务、返工原因分布、以及"哪些阶段值得结晶"的读数（只给读数，不预设结论）。
4. 用固定窗口 `2026-10-26T16:00:00Z → 2026-11-02T17:00:00Z` 复跑，核对本 Proposal 的 94 任务 / 129 会话 / 10,392 轮 / 110.6 轮/任务 / 185.8M eq；对不上就解释差异，⛔ 不得改口径去凑数。
5. 与 E1 工具做一次交叉核对（同窗口、同任务子集），列出可比字段与不可比字段。

## Acceptance Criteria

- [ ] AC1 `node --test scripts/rounds-ledger.test.mjs` exit 0；fixture 至少覆盖：①同一任务多会话正确合并；②同一 `message.id` 的多 block 记录只计 1 轮；③一轮内含 verify+edit 两种工具时按优先级只归一类且原始工具计数保留；④缺会话文件/fan-in trace ⇒ `not-evaluated`，不得变成 0 或成功；⑤返工原因无法判定 ⇒ `unknown` 单列，不并入已知类。
- [ ] AC2 `node scripts/rounds-ledger.mjs --help` exit 0，公开：会话→任务关联规则、轮数去重规则、阶段优先级、落地证据定义、成本权重（0.1× 与 0.05× 两套）与缺失语义。
- [ ] AC3 对固定窗口真跑并写入报告，复现基线：任务数 94、worker 会话 129、轮数 10,392、轮/任务 110.6、加权 eq 185.8M（0.1×/5×）；任一数字对不上必须给出差异原因，不得静默改口径。
- [ ] AC4 报告给出全局阶段占比（inspect / edit / verify / fix / orchestration）与 top 10 任务的阶段拆解；至少一个任务下钻到会话级（每会话的轮数、阶段、结局）。
- [ ] AC5 返工台账：每个非首次会话都有 `fan-in-red` / `worker-exited` / `crash-or-timeout` / `superseded` / `unknown` 之一，给出计数与占比；`unknown` 占比必须显式报告。
- [ ] AC6 与 E1 工具交叉核对：同一窗口、同一任务子集下，轮数与加权成本与 E1 的差异在报告中逐项列出（可比 / 不可比 / 解释），不得只声称"一致"。
- [ ] AC7 只读：`git diff` 不含 `.quay/profiles.yml`、`plugin/scripts/*driver*`、任何 gate/AC/DoD 文件；不改变派发、验证或 suite 覆盖面。
- [ ] AC8 `git diff --check` exit 0，改动只在声明 Touches 内。

## Definition of Done

- 工具对真实会话目录运行并产出报告；报告里的每个数字都能用一条命令复跑，且至少一个任务下钻到会话级。
- 基线数字（94 / 129 / 10,392 / 110.6 / 185.8M）被复现或被解释，读者能据此回答"下一刀该切哪个阶段"。
- 验证面零变化：不改 driver、不减少测试/检查、不新增会跳过验证的分支。
- 变更经相应检查，并通过约定的落地流程进入 develop。

- 该轴仍暗,理由:只读统计工具与报告，不改依赖结构或分层，无 L_D/L_G 可测读数。

## Touches

- scripts/rounds-ledger.mjs (new)
- scripts/rounds-ledger.test.mjs (new)
- docs/analysis/rounds-ledger-2026-11-03.md (new)
- tasks/gap-rounds-ledger-per-landed-task.md