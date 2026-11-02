---
id: gap-e1-baseline-window-ignored-by-rounds-e5
title: E1 只读基线工具的 --window-start/--window-end 未作用于轮数分解与 E5 小节——窗口外恒定读数伪装成窗口读数
status: ready
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: execution
---
## Proposal

`scripts/task-efficiency-baseline.mjs --help` 声明 `--window-start` / `--window-end` 为窗口边界（含）。实测两个不同窗口（`2026-10-31T14:00:00Z→2026-11-01T12:00:00Z` 与 `2026-11-01T18:00:00Z→2026-11-02T13:30:00Z`）的 `--json` 输出中，`rounds.totalRounds`（169144）、`rounds.sessionsTotal`（904）、`e5.stopReasonCounts`（`{"dispatched(no-stop)":2824,...,"pool-empty":49411}`）逐字相同；而同一份输出的 `summary.wallClockP50` 与 `e5.fanInLockWaitP50` 随窗口变化。⇒ 窗口参数只作用于 attempts 侧，没有作用于会话轮数分解，也没有作用于 E5 里除锁等待以外的小节。

代码证据（2026-11-02 按位置核对）：
- `classifyRounds(src, args, ctx)` 只按 `args.task` 过滤，遍历全部 `src.workerSessions`，从不读 `args.window`（`scripts/task-efficiency-baseline.mjs:691-693`）。
- `e5Evidence(src, ctx)` 的 `stopReasonCounts` 遍历全量 `src.workerRound`，`queueDelay*` 遍历全量 `src.workflowEvents`；只有锁等待经 `ctx.attempts` 间接受窗口限制（`scripts/task-efficiency-baseline.mjs:758-805`）。

后果是一个硬规则 3b 形状：一个窗口外恒定的读数与"已按窗口统计"同形，读者无法从输出上区分"查过且按窗口"与"根本没按窗口查"。2026-11-02 的效率核查已经踩到它一次——两个窗口的逐字相同输出被先当作真实窗口读数读取。

<!-- dedup-ref -->
与已 done 的 `gap-task-efficiency-baseline` / `gap-task-efficiency-baseline-attribution-semantics`（E1 工具本身与统计口径）保持独立：那两条建立工具与修正关联语义，本条只修窗口过滤的作用域，不重复其身份/落地判定工作。

## Plan

1. 把窗口 `{start,end}` 显式传进 `classifyRounds` 与 `e5Evidence`，在会话首条记录时间戳、`worker-round` 的 `ts`、workflow-event 的 `recordedAtMs` 上做与 attempts 相同的包含式过滤。
2. 取不到时间戳的记录不得静默丢弃：按小节单列 `unwindowed` 计数（"无法评估"要有独立取值，不得与"已按窗口统计"共用输出）。
3. 报告页在每个受影响的小节标题下打印窗口区间与 `unwindowed` 计数；`--json` 输出携带 `window` 与 `unwindowed`。
4. 测试加反例：同一份记录、两个不同窗口 ⇒ 两个小节的读数必须不同；窗口外记录必须落在 `unwindowed`，不得计入窗口读数，也不得静默丢弃。
5. 用上述两个窗口重跑，把两窗口的新读数与旧（恒定）读数贴进报告。

## Acceptance Criteria

- [ ] AC1 `node --test scripts/task-efficiency-baseline.test.mjs` exit 0；新增反例至少覆盖：①同一语料两个窗口的 `rounds.*` 与 `e5.stopReasonCounts` 读数必须不同；②窗口外会话/派发轮既不计入窗口读数、也不被静默丢弃，而是计入独立 `unwindowed`；③缺时间戳记录同样进入 `unwindowed`，不得变成 0 或成功。
- [ ] AC2 用两个不同窗口各跑一次 `--json`，`rounds.totalRounds`、`rounds.sessionsTotal`、`e5.stopReasonCounts`、`e5.poolEmptyRounds` 四项中至少三项必须不同；把两窗口的这四个读数与完整命令贴进报告。
- [ ] AC3 `--help` 明确写出每个小节的窗口语义与 `unwindowed` 语义；报告页在每个受影响小节标题下打印窗口区间与 `unwindowed` 计数。
- [ ] AC4 在 `docs/analysis/task-efficiency-baseline.md` 重跑并记录：旧（恒定）读数 → 修正后两窗口读数，逐项给差异；原报告既有数值不得被静默改写，必须标注"旧口径下的全量读数"。
- [ ] AC5 `git diff --check` exit 0，改动只在声明 Touches 内；不修改 attempts 侧的关联/落地判定，不放宽任何 fail-closed。

## Definition of Done

- 工具对当前工作区真实遥测运行，两个不同窗口的同一小节给出不同读数，且窗口外记录在 `unwindowed` 中有非零计数；只有 fixture 反例通过不算交付。
- 报告显式撤回"窗口读数"用法下的全量数字，读者能用一条命令复现两窗口差异。
- 变更经相应检查，并通过约定的落地流程进入 develop。

- 该轴仍暗,理由:只修只读统计工具的窗口过滤，不改依赖结构或分层，无 L_D/L_G 可测读数。

## Touches

- scripts/task-efficiency-baseline.mjs
- scripts/task-efficiency-baseline.test.mjs
- docs/analysis/task-efficiency-baseline.md
- tasks/gap-e1-baseline-window-ignored-by-rounds-e5.md