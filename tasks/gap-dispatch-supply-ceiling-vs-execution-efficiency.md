---
id: gap-dispatch-supply-ceiling-vs-execution-efficiency
title: 派发环 93–98% tick 空闲的主因是任务存量枯竭而非执行效率——量化供给上限后再决定优化目标落在哪一层
status: done
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
---
## Proposal

2026-11-02 的效率核查把"执行慢"与"没活干"分开了：

- 执行侧（E1 工具，两窗口同口径）：attempt wall p50 42.0→41.4 min；fan-in 锁等待 p50 5.1→5.2 min；suite 执行 9.2→9.3 min —— 持平。
- 供给侧（按窗口过滤 `.quay/worker-round.jsonl` 的 `stop_reason`）：`pool-empty` + `filtered-empty` 占 10-31 的约 99%、11-01 的约 99%、11-02 的约 100%。
- 任务存量（2026-11-02T13:45Z 前后按 frontmatter 位置读取）：`done` 3030、`superseded` 76、`ready` 1、`todo` 0、`needs-human` 1。

⇒ "吞吐低"当前不是执行慢，而是没有可派发的工作。任何以"每轮 token / 每次会话耗时"为目标的优化，其总收益都会被空闲率乘掉。本条任务不预设结论：它要求把供给上限量化，并据此决定优化预算该落在哪一层（任务生成/发现、promotion、还是执行）。

口径纪律：
- `pool-empty` 只代表"当前无可派发候选"，不等于需求不存在；`filtered-empty` 代表有候选但被依赖/Touches/在飞/资源门过滤。
- `status: todo` 的计数必须按 frontmatter 位置读。2026-11-02 已实测：`grep -l '^status: todo' tasks/*.md` 报 49，但 49 条全部是正文散文行（`status: todo——…`），真实 frontmatter `todo` = 0。引用计数前必须先打印前 3 条匹配内容。

<!-- dedup-ref -->
与已 done 的 `gap-task-efficiency-baseline` / `gap-task-efficiency-baseline-attribution-semantics`（E1 工具与统计口径）保持独立：本条不修工具，只产出供给侧决策报告；与已 done 的 `gap-fan-in-queueing-model-does-concurrency-help` 独立：那条分析锁竞争，本条分析"有没有活可干"。

## Plan

1. 建立可复跑的供给口径读数（不新增常驻脚本）：按 frontmatter 逐状态计数任务库；按窗口统计 `worker-round.jsonl` 的 stop_reason 分布；统计每窗口"有新工作可派"的 tick 数。
2. 把"可用工作"作为分母，重算最近 7 天的产出率（落地任务数 / 可派发 tick 数），并与 / 总 tick 的旧算法并列给出。
3. 分清三种"没有派发"：真空闲（无 ready/todo）、被过滤（`filtered-empty`）、资源门拒绝（`resource-gate-wait`），分别给占比。
4. 给出决策：优化预算应落在生成层（routine/discovery）、promotion 层、还是执行层；若结论是"存量已枯竭"，必须给出下一批工作的来源与判据，而不是把空闲当异常去修。
5. 把读数与决策写入 `docs/analysis/` 报告，附完整复跑命令、时间窗与读取时刻。

## Acceptance Criteria

- [x] AC1 报告给出任务库逐状态计数，且按位置核对：把 `grep -n '^status: <value>'` 的前 3 条实际匹配内容贴出，区分 frontmatter 与正文散文行；给出真实 frontmatter 分布（申报时实测 done/superseded/ready/todo/needs-human = 3030/76/1/0/1，执行当日必须重取，不得沿用本读数）。
- [x] AC2 报告给出至少 3 个整日的 stop_reason 窗口读数，把 `pool-empty`、`filtered-empty`、`resource-gate-wait` 分开列示并给出各自占该日 tick 的百分比；命令必须显式带窗口。
- [x] AC3 产出率用两套分母各算一次：落地任务数 / 总 tick，与 落地任务数 / 可派发 tick；两套数字都写进报告，不得只给后者。
- [x] AC4 报告明确写出结论层：当可用工作 = 0 时，"执行效率优化"不可测（not-evaluated），不得用空闲率反推执行变差；若可用工作 > 0 仍有长时间 `pool-empty`，必须指出被什么过滤。
- [x] AC5 报告给出"下一批工作从哪里来"的可执行判据（生成层 / 发现层 / 人工注入 三者之一），并明确本条不改变任何派发、promotion 或 AC/DoD 门。
- [x] AC6 `git diff --check` exit 0，改动只在声明 Touches 内。

## Definition of Done

- 报告落盘，且每个数字都能用一条命令在当前工作区复跑；至少一个数字来自执行当日的真实读取，不得全部是 2026-11-02 的历史快照。
- 读者能据此回答"现在该优化哪一层"，且答案与读数一致（若读数是存量枯竭，结论不得写成执行慢）。
- 变更经相应检查，并通过约定的落地流程进入 develop。

- 该轴仍暗,理由:只读分析报告，不改依赖结构或分层，无 L_D/L_G 可测读数。

## Touches

- docs/analysis/dispatch-supply-ceiling-2026-11-02.md (new)
- tasks/gap-dispatch-supply-ceiling-vs-execution-efficiency.md