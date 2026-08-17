---
id: gap-fan-in-realsuite-bypasses-verification-round-ledger
title: 真跑 suite 的 fan-in 落地绕开 verification-round.jsonl——pre-verified 修复只补了预验证分支，真跑分支仍零入账（发生率 3+，2026-08-17 实测）
status: ready
labels:
  - gap
  - defect
  - instrumentation
parent: null
children: []
extra:
  schema: execution
---
**type:** execution

## Proposal

**现象（outer 2026-08-17 20:5xZ 实测，独立核实）**：`verification-round.jsonl`（full-suite 趋势账本，`/tests` 页 + suite 成本分析数据源）**今天的最后三条真跑 fan-in 落地全部无记录**：
- `gap-fan-in-turn-budget-suite-timeout` land @19:45（37b8afcf）→ **0 条**
- `gap-webui-root-should-show-dashboard` land @20:36（3a8552ac）→ **0 条**
- `gap-fixture-hash-omits-workflows-dirs` land @20:52（9b28d589，suite 20:46-20:52 真跑 2592 CPU-s）→ **0 条**

而 pre-verified 分支的落地有记录（15:39/16:33/16:54，`preverified:true`，fm-* runId）。今天 25 个 flip-to-done 落地 / 33 条 per-task-suite 记录，但 verification-round 只有 6 条（其中 3 条是早上的真跑 + 3 条下午的 pre-verified）——**真跑分支的结构性空白**。

**根因（读代码核实）**：`gap-preverified-suite-bypasses-verification-round-ledger`（done，00664f9b）只给 **pre-verified 分支**补了写入（`pre-verified-round-record.ts`，fan-in-execute.js step 4.5 `# preverified-round-block` 在 `suite_preverified=1` 时调用）。但**真跑分支没有等价写入**：`fan-in-execute.js` 的 `SUITE_LAUNCH` 直接 `setsid bash -c 'cd "$worktree" && bash scripts/test.sh'`——**从不经过 `full-suite-runner.ts`**（后者是唯一写 verification-round 的 full-suite 入口，`--state-dir` 指向主检出的 `.quay`）；`scripts/test.sh` 自身**从不写 verification-round**（grep 证实）。⇒ 真跑分支的 verification-round 写入点**不存在**。

**与既有任务的关系**：`gap-preverified-suite-bypasses-verification-round-ledger`（done）的根因是「pre-verified 路径跳过 full-suite-runner ⇒ 从不触发 verification-round 写入」，修的是**预验证分支**；本条是**同一根因的真跑分支**（hard rule 5b：在某处修好 X ≠ X 只在那一处）。它当初诊断的「04:13 起 7h+ 空档」就是真跑+pre-verified 双分支都空的结果——pre-verified 修好了，真跑分支**依然**空着。

**引入点（inner 独立核实，2026-08-17 21:0xZ 确认）**：`turn-budget` detached 模型（9327056a）把 fan-in-execute step 4 改成 detached 直跑 `bash scripts/test.sh`（setsid + /usr/bin/time），使真跑 suite 不再经过 full-suite-runner.ts；00664f9b 只给 pre-verified 分支补了写入点，**真跑分支的结构性写入点不存在**。实测佐证：verification-round.jsonl 最后写入 17:11Z，19:00–20:52 窗口零条目。

**影响**：趋势账本对「最新最常用的落地路径」仍然结构性变瞎。真跑 fan-in 是 25 条落地的主体（pre-verified 只是 call 方回合外跑 suite 的特殊情况）；`/tests` 页与 suite 成本分析（AC101 600s 天花板、trend）读不到真跑分支的耗时/成本数据 ⇒ suite 变慢的问题继续兼职由「suite 能否在回合内跑完」担任唯一判据（这正是 pre-verified 任务 AC4 想消除的盲点，真跑分支没接上）。

**能取假（⊢ 对照）**：修复后，一次真跑 suite 的 fan-in 落地（无 pre-verified capture，`full_suite_ran=true`）在 verification-round.jsonl 产生一条新记录（`preverified` 缺省/`false` + durationMs=真跑墙钟 + scope=worktree），且 `/tests` 能读到它；不再需要手动 grep /tmp 日志现拼。

## Plan

1. 读 fan-in-execute.js step 4.5（`# preverified-round-block`，ec434eb8 + 00664f9b 后）与 `pre-verified-round-record.ts`，确认真跑分支的等价写入缺失。
2. 决定写入点（inner 提示，非阻塞）：真跑分支的写入点应落在**持锁段 suite 完成之后**（step 4.5 或 ff 前）——suite 绿、per-task-suite-record 入账后，追加与 pre-verified-round-record 结构等价的写入——`preverified:false`（或缺省）+ 复用 capture 的 `wall_ms`（真跑墙钟）+ `suite_head` 钉死 + scope=worktree；**记录字段须与 full-suite-runner 写入的 verification-round 同构**（startedAt/cpu_usec/psi 等）——AC4 时长检查对 pre-verified 记录有判据，真跑记录别比它薄。倾向路径：复用 `pre-verified-round-record.ts` 加 `--preverified 0` 形态；或「detached 启动也走 full-suite-runner（而非裸 test.sh）」——后者能复用现有 writer，但须核实 full-suite-runner 的 cgroup 捕获 seam 在 detached 下是否生效（QUAY_TEST_CGROUP_SCRIPT 注入点是它）。
3. **两个分支共用同一 writer/判定**（不复制逻辑）：pre-verified 与真跑统一走一个 verification-round 入账函数，`preverified` 布尔由 `suite_preverified` 标记决定——避免再出现「修了一个分支、另一个还是空的」。
4. 对照实测：一次真跑 fan-in（不删 fixtures、无 capture）→ verification-round 产生记录；`/tests` 可读。
5. scoped 门（`--for-task`）+ 全量验证，fan-in。

## Acceptance Criteria

- [ ] AC1: 真跑 suite 的 fan-in 落地（`full_suite_ran=true` 且非 pre-verified）在 verification-round.jsonl 产生一条新记录（`preverified` 缺省/`false`、durationMs=真跑墙钟、scope=worktree），趋势账本对真跑分支恢复可见。
- [ ] AC2: 记录 schema 与 full-suite-runner / pre-verified-round-record 既有记录兼容（`/tests` 与成本分析可读）。
- [ ] AC3: pre-verified 分支写入不被破坏（回归）；两个分支共用同一入账函数/判定（不复制）。
- [ ] AC4: 对照实测：一次真跑 fan-in 落地（无 capture）→ 产生记录；`/tests` 读得到。
- [ ] AC5: 测试全绿 + `--for-task` scoped 门绿。

## Definition of Done

- [ ] 真跑分支的 fan-in 落地补 verification-round 入账（与 pre-verified 共用 writer），趋势账本对两条落地路径都可见，scoped + 全量绿。

## Touches

- plugin/workflows/fan-in-execute.js（step 4.5 真跑分支补 verification-round 入账；双拷贝）
- .claude/workflows/fan-in-execute.js（同 dual-copy 的 landed 副本，与 plugin/workflows 逐字节一致）
- plugin/scripts/pre-verified-round-record.ts（或新增等价真跑 writer——与 pre-verified 共用结构）
- plugin/test/fan-in-execute-paths.test.mjs（真跑分支 verification-round 入账路径测试）
- plugin/test/pre-verified-round-record.test.mjs（共用 writer 回归）
- packages/quay/test/serve-ac95-views.test.mjs（/tests 读取真跑记录）
- capability-catalog.sh（新增/变更 writer 的能力声明）
- tasks/gap-fan-in-realsuite-bypasses-verification-round-ledger.md（自身）
