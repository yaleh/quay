---
id: gap-instrument-decay-dedup-reader-round-log-path
title: instrument-decay 的立案去重台账在生产上恒为空：readPriorInstrumentDecayFilings 读
  <root>/quality-round.jsonl，而心跳写在 .quay/ —— 同一 (载体,形态) 反复重开 gap-filing
  agent（2026-10-22 已 4 轮，全部「不立案」）
status: needs-human
labels:
  - gap
  - defect
  - meta
parent: null
children: []
extra:
  schema: execution
---
## Proposal

**机制**：`runInstrumentDecayRound`（`plugin/scripts/quality-gate-driver.ts`）用 `readPriorInstrumentDecayFilings(resolvedRoot, opts.roundLogPath)` 读「上一轮已立案的 (载体,形态)」去重集合；生产装配路径 `instrumentDecayRoutineFromConfig(rootDir)` 不传 `opts` ⇒ `opts.roundLogPath === undefined` ⇒ 读取函数落到 `path.join(root, ROUND_LOG_REL)`，而 `ROUND_LOG_REL = "quality-round.jsonl"` 是 **`.quay/` 相对路径**，真实心跳在 `<root>/.quay/quality-round.jsonl`。`readFileSync` 抛 ENOENT，函数 `catch { return out; }` 返回**空 Set**——与「确实没有任何已立案 pair」在读数上完全同形（硬规则 3b）。于是每个 (载体,形态) 每轮都被重新 spawn 一个 gap-filing agent，`already-filed` 分支在生产上**结构上永不发生**。

**写手侧早已修过同一个 bug**：同一文件 `:3940` 用 `path.join(rootDir, ".quay", ROUND_LOG_REL)`，注释逐字写着「⛔ 直接 join rootDir 会把心跳写到 repo-root quality-round.jsonl」（`gap-meta-round-log-rel`，done）。读侧是同一文件里的**兄弟实例**，未被一并修（硬规则 5b）。

**直接读数（2026-10-22，主检出 `/data/home/yale/work/quay`）**：

```
ROUND_LOG_REL = "quality-round.jsonl"
readPriorInstrumentDecayFilings(root)                      → prior size = 0   ← 生产缺省路径
readPriorInstrumentDecayFilings(root, ".quay/quality-round.jsonl") → prior size = 2
  KEY fan-in-step-trace.jsonl|rate-stopped
  KEY arch-cycle-history.jsonl|stale-evaluated
```

`.quay/quality-round.jsonl` 里同一天已有 4 个 instrument-decay 轮次把**同一个 pair** 记为 `filing:"filed"`，且每轮 agent 的 summary 都写着「no task written」：

```
2026-10-22T04:03:23.376Z run_id=qg-prod-anchor pid=2212166 :: fan-in-step-trace.jsonl|rate-stopped:filed
2026-10-22T04:13:14.317Z run_id=qg-prod-anchor pid=1651389 :: fan-in-step-trace.jsonl|rate-stopped:filed
2026-10-22T04:29:17.933Z run_id=qg-prod-anchor pid=3809482 :: fan-in-step-trace.jsonl|rate-stopped:filed
2026-10-22T04:51:57.193Z run_id=qg-prod-anchor pid=316772 :: fan-in-step-trace.jsonl|rate-stopped:filed
```

`filing:"filed"` 的落账条件是「子进程被 spawn 过」（该字段无条件写 `filed`，不区分 agent 是否真的写了任务），所以去重键本该在**第一轮之后**就进入 prior 集合；实际四轮全部重开。04:51Z 那轮的 summary 已自述「the gap-filing channel re-spawns a worker for the same already-adjudicated pair (three such rounds ran today …)」——症状被记录，根因未定位。

**为什么 prior task 的 AC5 没抓到**：`gap-instrument-decay-check-unwired-and-blind-to-content-dark` 的 AC5 断言「紧接的第二轮不重复立案」，但其测试（`plugin/test/quality-gate-driver.test.mjs:3067/3076`）**显式传 `roundLogPath`**，从未走生产缺省路径 ⇒ 判据只被 fixture 满足，不是测量（硬规则 4 推论三）。

**修法方向**：读侧按写手同一派生方式拼 `.quay/`（`path.join(root, ".quay", ROUND_LOG_REL)`），或由驱动把已算好的 `roundLogFile` 注入 `buildInstrumentDecayRoutine`（单一来源，⛔ 不新增第二个路径常量）。测试必须覆盖**缺省路径**：在临时 workspace 放 `.quay/quality-round.jsonl`（含一条 `filing:"filed"`），不传 `roundLogPath` ⇒ 第二轮必须记 `already-filed`。

<!-- dedup-ref -->合并判断 = separate：与 ready 的 `gap-adr007-half1-selfcheck-probes-archived-and-gate-never-invoked` 共享 `plugin/scripts/quality-gate-driver.ts`，但机制不同（那条修 ADR-007 self-check 探针与门未被调用；本条修 instrument-decay 的立案去重台账），由调度器按 Touches 串行。

**prior-claim**：
- `gap-meta-round-log-rel`（done）—— 同一路径 bug 的写手侧实例，已修；本条是同一文件里漏掉的读侧兄弟（硬规则 5b）。
- `gap-instrument-decay-check-unwired-and-blind-to-content-dark`（done）—— 读侧函数的作者，其 AC5 声称「第二轮不重复立案」，生产上不成立。

## AC

- [x] AC1 生产缺省路径取真：在主检出上不传 `roundLogPath` 调用 `readPriorInstrumentDecayFilings("<root>")`，当 `.quay/quality-round.jsonl` 尾部 500 行含 `filing:"filed"` 的键时返回非空集合且含 `fan-in-step-trace.jsonl|rate-stopped`。贴出修前（0）与修后（≥1）两次读数。判据可假：把 `.quay/` 从 join 里去掉 ⇒ 回到 0。
- [x] AC2 负对照（正确文件里没有 filing）：临时 workspace 的 `.quay/quality-round.jsonl` 只有无 filings 的轮记录 ⇒ 返回空集；同时 `<root>/quality-round.jsonl` 放一条 `filing:"filed"` ⇒ 仍须返回空集（证明读的是 `.quay/`，不是根目录）。贴出两次输出。
- [x] AC3 两轮不重复立案（缺省路径，不经注入）：在带真实 `.quay/` 布局的临时 workspace 上跑 `runInstrumentDecayRound` 两次，`gapWorkerCmd` 用计数桩；第一轮 spawn 计数 = 1 且记 `filed`，第二轮记 `already-filed` 且 spawn 计数仍 = 1。贴出两轮的 `filings` 与计数。⛔ 测试内不得显式传 `roundLogPath`。
- [x] AC4 单一来源：读侧与写手使用同一 `.quay/` 派生（复用 `ROUND_LOG_REL`），`grep -c 'quality-round.jsonl' plugin/scripts/quality-gate-driver.ts` 的词面量不增加；贴出 grep 结果与 diff。

## DoD

- [ ] AC1-AC4 全绿；`scripts/test.sh --for-task <id>` 通过；改动合入 develop。
- [ ] 真实落地（不是 fixture）：合入后至少两个生产 instrument-decay 轮次中，同一 pair 的第二轮记为 `already-filed`、gap-filing spawn 数不增；贴出两轮的 `ts` / `filings`（读 `.quay/quality-round.jsonl`），窗口起点必须晚于本任务落地提交。
- [ ] 不新增第二份去重台账，也不改 `filing:"filed"` 的语义（该语义仍表示「已交给 agent」）。

## Evidence

（2026-10-23 worker 轮；主检出 `/data/home/yale/work/quay`，实现分支 `task/gap-instrument-decay-dedup-reader-round-log-path`，提交 `d9610e05a`）

- **AC1（生产缺省路径取真）**：主检出生产载体 `.quay/quality-round.jsonl`（15,332,066 B；尾部 500 行含 2 条 instrument-decay 轮）上的两次读数：
  - 修前（develop 版 `readPriorInstrumentDecayFilings(root)`，即 `roundLogPath ?? path.join(root, ROUND_LOG_REL)`）：`size = 0 []`
  - 修后（本分支同一调用，不传 `roundLogPath`）：`size = 1 ["fan-in-step-trace.jsonl|rate-stopped"]`；`resolveRoundLogFile(root)` = `/data/home/yale/work/quay/.quay/quality-round.jsonl`
  - 判据可假（负控制）：把读侧改回旧的 `join(root, ROUND_LOG_REL)` 后，两条新增测试由 `pass 2` 变 `fail 2 / pass 0`。
- **AC2（负对照两半）**：临时 workspace 两次输出——
  - `.quay/quality-round.jsonl` 只有无 filings 的轮记录、同时 `<root>/quality-round.jsonl` 放一条 `filing:"filed"` ⇒ `[]`（根目录那份不被读）
  - 再向 `.quay/quality-round.jsonl` 追加一条 `filing:"filed"` ⇒ `["dot-quay.jsonl|rate-stopped"]`
- **AC3（两轮不重复立案，缺省路径）**：`plugin/test/quality-gate-driver.test.mjs` 新增用例「runInstrumentDecayRound — 紧接的第二轮经【生产缺省路径】去重（⛔ 测试不传 roundLogPath）」绿：第一轮 `filing=filed`、`worker.calls()=1`；驱动把上一轮 Fact 写到 `<root>/.quay/quality-round.jsonl` 后，第二轮 `filing=already-filed`、`reason` 含 `already-filed=1`、`worker.calls()` 仍 `=1`。两轮均不传 `roundLogPath`（旧的 AC5 测试显式传路径 ⇒ 只被 fixture 满足）。
- **AC4（单一来源）**：`grep -c 'quality-round.jsonl' plugin/scripts/quality-gate-driver.ts`：develop `12` → 本分支 `11`（不增加）。diff：新增唯一派生 `resolveRoundLogFile(root, roundLogPath?)`，读侧 `readPriorInstrumentDecayFilings` 与写手（`main()` 的心跳落点）都改为调用它 —— `path.join(root, ".quay", ROUND_LOG_REL)` 只在 helper 内出现一次。
- **scoped 门**：任务 worktree 内 `scripts/test.sh --for-task gap-instrument-decay-dedup-reader-round-log-path` ⇒ 116 tests / 116 pass / 0 fail，exit 0（scoped 静态检查 tier 全绿；`it0-split-or-commit-check --changed` 报 NOT-EVALUATED 因子分支 delta 不含任务文件，不等同 PASS）。
- **DoD-3（不改语义）**：diff 只改路径派生；`filing:"filed"` 的写入点与取值未动，未新增任何去重台账（仍读同一 round 载体尾部 500 行）。
- **DoD 未勾选（诚实读数，⛔ 不自判）**：DoD-1 的「改动合入 develop」属于 fan-in/驱动动作；DoD-2 要求「落地提交之后」的两个生产轮次读数，执行者结构上无法在落地前取得 —— 本任务停在 needs-human 的机械判据（`unsatisfiableUnannotatedAc`）命中的正是 DoD-1 的「合入 develop」一句。未写 done/verifiedBy，未加「（待外部）」注解（自豁免，须由人/作者裁定）。

## ADR-007 dark axis

- L_D: valueSccs=0 typeSccs=0 reverseEdges=0 (import-graph-check: files=506 edges=1508, kernelChecked=true violations=0)
- L_G: 该轴仍暗,理由:本次只改一处路径派生（1 个 helper + 2 个调用点），未新增跨包 import 边，archguard 的包级依赖形状无增量。

## Touches

- plugin/scripts/quality-gate-driver.ts
- plugin/test/quality-gate-driver.test.mjs
- tasks/gap-instrument-decay-dedup-reader-round-log-path.md

## Needs-Human

**执行 2026-10-22T05:24:19.665Z — 连续修满重试上限仍不合格（标 needs-human）**

- 阻碍原因：unsatisfiableUnannotatedAc=[AC1-AC4 全绿；`scripts/test.sh --for-task <id>` 通过；改动合入 develop。]（连续 3 轮被结构上不可派的拦截挡住 ⇒ 作者/人改写；⛔ 不派 fix worker）
