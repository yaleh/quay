---
id: gap-e1-round-count-and-landing-carrier
title: E1 计数修正：轮数按 message.id 去重（现 2.2× 高估）、落地证据并集 fan-in-step-trace（现少算 17 个任务）
status: todo
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: execution
---
## Proposal

2026-11-03 的交叉核对（`docs/analysis/rounds-ledger-2026-11-03.md` 的 AC6 节）发现 E1 只读基线工具有两个会**改变结论**的计数缺陷：

1. **轮数高估 2.2 倍**：同一窗口（`2026-10-26T16:00:00Z → 2026-11-02T16:00:00Z`）下，E1 报 `totalRounds = 22,863`，轮数台账报 **10,392**。原因在 `scripts/task-efficiency-baseline.mjs` 的 `classifyRounds`：它逐行遍历 `o.type === "assistant"` 并把每行当一轮；而同一个 API 响应（同一 `message.id`）会被 `apiBlockIndex` 拆成多条记录（thinking / text / tool_use 各一条）。⇒ 轮数被放大一倍以上。
2. **落地数低估**：同窗口 E1 报 `landedTasks = 77`，台账报 **94**。原因在落地证据只读 `.quay/fan-in-<task>-<runId>.log`（`src.fanInTraceFiles` 只收 `fan-in-*.log`）；近期 run 缺 `.log` 载体，而 `fan-in-step-trace.jsonl` 里 `ff` + `ok:true` 的事件是齐的（台账用它计数）。

影响：E1 是"成本/落地任务"这个目标函数唯一现成的通用工具（费用 CSV 就绪后它会直接给费用）。轮数分母偏大 2.2×、落地分母偏小 18% ⇒ 任何用 E1 算出的"每落地任务成本/轮数"都会被系统性放大，且方向相反的两处偏差不会互相抵消，读者无法从输出上看出问题（硬规则 3b 的形状）。

本条只修这两个计数口径与报告复跑，⛔ 不改 attempts / suite / 锁等待 / 费用维度的语义，也不改落地的定义（ff ok 仍是唯一证据）。

<!-- dedup-ref -->
与已 done 的 `gap-task-efficiency-baseline`（建立工具）/ `gap-task-efficiency-baseline-attribution-semantics`（修关联与缺失语义）/ `gap-e1-baseline-window-ignored-by-rounds-e5`（修窗口作用域）保持独立：那三条分别建立工具、修关联语义、修窗口过滤；本条修的是**轮数去重**与**落地证据载体集合**，不重复上述工作。

## Plan

1. `classifyRounds`：把同一 `message.id` 的多条记录归并为一轮（同一轮内多个 content block 只算一轮，分类取该轮的工具动作并集）；缺 `message.id` 的记录逐条计轮，但写进独立计数器 `roundsMissingId`，⛔ 不与去重后的轮数合并。
2. 落地证据：除 `.log` 外读 `fan-in-step-trace.jsonl` 的 `step === "ff" && ok === true`（`event === "step-end"`），按 `(task, runId)` 归并；每条尝试记录来源 `log` / `step-trace` / `both`；两处都没有 ⇒ 保持 `unknown`。
3. 去重：同一 `(task, runId)` 的 ff ok 只计一次；同一任务有多个 run 时仍按尝试窗口归属，⛔ 不把后一次落地回填给前一次。
4. `--help` 与报告注明新的计数规则与 `roundsMissingId` 语义。
5. 用固定窗口 `2026-10-26T16:00:00Z → 2026-11-02T16:00:00Z` 重跑，与轮数台账交叉核对。
6. 更新 `docs/analysis/task-efficiency-baseline.md`：旧→新读数逐项列出并显式撤回旧值。

## Acceptance Criteria

- [ ] AC1 `node --test scripts/task-efficiency-baseline.test.mjs` exit 0；新增反例至少覆盖：①同一 `message.id` 的多条 block 记录只计 1 轮；②缺 `message.id` 的记录计入 `roundsMissingId` 而不是静默丢弃或合并；③落地来自 `.log`、来自 `step-trace`、来自两者（只计 1 次）；④两处都没有 ⇒ `unknown`，不并入成功分母；⑤同一 `(task, runId)` 重复 ff ok 不重复计数。
- [ ] AC2 同窗口真实运行：`totalRounds` 必须等于 10,392（轮数台账同窗口读数）；若不等，报告必须逐项解释差异，⛔ 不得改窗口或改任务集合去凑数。
- [ ] AC3 同窗口真实运行：`landedTasks` 必须等于 94；不等则解释（含每个来源的计数：`log` / `step-trace` / `both` / `unknown`）。
- [ ] AC4 `docs/analysis/task-efficiency-baseline.md` 更新：旧值 22,863 轮 / 77 落地 → 新值，显式标注旧值为"未按 message.id 去重的行数口径"，并给出复跑命令。
- [ ] AC5 attempts / suite / 锁等待 / 费用维度的判定语义与输出字段不变；`--help` 增加轮数去重与落地载体并集的说明；`roundsMissingId` 在 JSON 与 Markdown 中都可见。
- [ ] AC6 `git diff --check` exit 0，改动只在声明 Touches 内；不修改任何 gate / AC / DoD / driver 配置。

## Definition of Done

- 工具对当前工作区真实遥测运行，轮数与落地数分别与轮数台账同窗口读数一致（或被逐项解释）；只有 fixture 通过不算交付。
- 报告显式撤回旧的 22,863 轮与 77 落地两个读数，读者能用一条命令复现新值。
- 变更经相应检查，并通过约定的落地流程进入 develop。

- 该轴仍暗,理由:只修只读统计工具的计数口径与证据载体集合，不改依赖结构或分层，无 L_D/L_G 可测读数。

## Touches

- scripts/task-efficiency-baseline.mjs
- scripts/task-efficiency-baseline.test.mjs
- docs/analysis/task-efficiency-baseline.md
- tasks/gap-e1-round-count-and-landing-carrier.md