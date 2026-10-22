---
id: gap-arch-cycle-refresh-first-stale-wins-starves-later-scopes
title: arch-cycle-report 的刷新按固定顺序只取第一个 stale scope：plugin/scripts 每间隔都 stale ⇒
  quay-native-src / experiments-scripts 永久饿死（experiments-scripts 产物已落后 18 天，检测器
  stale-evaluated 三组常亮）
status: ready
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

**事实（2026-10-22T04:06:29.026Z，主检出实测）**：仪器腐烂检测器对 `.quay/arch-cycle-history.jsonl` 报 `stale-evaluated` 三组——scripts / quay-native-src / experiments-scripts。载体最后一轮记录（`evaluated:true`、`status:"complete"`）自己就写着 `behindScopes:["scripts","quay-native-src","experiments-scripts"]`：

| scope | artifactTimestamp | commitsSinceArtifact | 覆盖源目录最新提交 |
|---|---|---|---|
| scripts | 2026-10-22T00:58:26.699Z | 9 | 2026-10-22T03:49:13Z f3cac0424365334f19a41bd7e9aeba8cd17b6957 |
| quay-native-src | 2026-10-21T16:17:53.847Z | 1 | 2026-10-21T16:26:54Z e7e84366a49f44edae815467404a1ba3b5c28fd1 |
| experiments-scripts | 2026-09-06T06:26:41.707Z | 18 | 2026-09-24T09:04:48Z 39df7b2ee2a70a58c5ffb17cc3164adfe7fcccd7 |

`experiments-scripts` 的产物比其覆盖源目录的最新提交还早 18 天，从那次提交算起已 stale 约 28 天（≈112 个 360m 间隔）。

**机制：不是「刷新太慢」，是后序作用域永远轮不到。**

1. `refreshBehindScopes`（`plugin/scripts/archguard-runner.ts:929`）用 `reading.scopes.find(scopeNeedsRefresh)` 选目标——按 `SCOPES` 的固定声明顺序（`archguard-runner.ts:98-105`：src → scripts → quay-native-src → quay-github-src → quay-backlog-src → experiments-scripts）取**第一个** stale scope；既不比较陈旧程度，也不记录上次刷新的是谁。
2. `runArchCycleRound` 的间隔闸（`plugin/scripts/quality-gate-driver.ts:2230-2235`）规定「每个调度间隔至多一次 analyze」。于是每个 360m 间隔里，只有排在最前的那个 stale scope 能被刷新。
3. `plugin/scripts` 几乎每个合并提交都会触及（00:58Z 刷新后 3 小时内又有 9 个提交），因此 scripts 在每个间隔都是 stale、都排在最前 ⇒ **quay-native-src 与 experiments-scripts 结构性永久饿死**。直接证据：00:58:21Z 那轮 `refresh.refreshedScope:"scripts"`，而同一轮 `behindScopes` 已经列出 quay-native-src 与 experiments-scripts；04:06:29Z 那轮连尝试都没有，`skipped:"within-interval"`。
4. 后果不是「偶尔读到旧数」：只要这两个作用域还 stale，检测器的 shape D 就会持续报同一组，而载体仍把它们的 `evaluated:true` + `cycleCount:0` 当作当前读数呈现——与健康状态同形（硬规则 3b）。

<!-- dedup-ref -->
**与既有任务的关系**：prior-claim = `gap-arch-cycle-report-never-evaluated-aggregate-and-stale-artifacts`（done）。它引入了「刷新 stale scope 后再报告」，但把预算定为「每间隔至多一次 analyze」，目标选择又是固定顺序的第一个；它的 AC4 只验证了 src 一个作用域，落地后其余作用域仍永久 stale ⇒ 同一腐烂仍在当前载体上（done ≠ absent，硬规则 5b）。本任务修的是选择/预算机制，不重做它的汇总修复。

<!-- dedup-ref -->
**合并判断**：与在开的 `gap-adr007-half1-selfcheck-probes-archived-and-gate-never-invoked`（ready）共享 `plugin/scripts/quality-gate-driver.ts`，但机制不同（那条修 ADR 门 / selfcheck 的调用面，本条修 arch-cycle 刷新的公平性）⇒ separate，由调度器按 Touches 串行。`task-granularity-advice.ts` 实测 peers 仅此一条。

## Plan

1. **预算从「每间隔一次 analyze」改为「每个 scope 每间隔至多一次 analyze」**：一轮内刷新所有 `scopeNeedsRefresh` 的 scope（上限 = scope 数 6；一次批量 ≈6×27s ≈ 2.7 min，间隔 360m）。间隔闸按 scope 判，不再用一个全局 `readLastRefreshAt` 挡住全部 scope。
2. **选择顺序改为最陈旧优先**：按 `commitsSinceArtifact` 降序、artifact 时刻升序排序；即便某轮只处理一个 scope，后序也不会被永久饿死。
3. **不可刷新时不得伪装成当前读数**：到期但 analyze 失败 / 仪器缺失 / 被上限截断的 stale scope，其 `evaluated` 记 `false`、`cycleCount` 记 `null`、reason 含 `artifact-behind-sources`（点名 artifact 与最新提交），记录级 `status` 为 `partial` 并列出这些 scope。⛔ 不允许继续以 `evaluated:true` + `cycleCount:0` 呈现过期读数；刷新成功的 scope 保持原样。
4. **记录可诊断**：`refresh` 从单个 `refreshedScope` 扩为 `refreshedScopes[]`（每项含 scope / artifactTimestamp / exitCode），失败或截断的 scope 单独列出；现有 `skipped` 枚举保留。
5. **测试**：`plugin/test/arch-cycle-reading.test.mjs:390`（"at most ONE scope per call"）、`:395`（"exactly one analyze per refresh"）、`:410`（"the other scopes were NOT swept"）三条断言钉的正是本条要改掉的旧规则，必须随规则改写而不是绕过。新断言：三个 stale scope 一轮全部刷新、每个至多一次 analyze；fresh scope 零 analyze；刷新失败的 scope 降级为 not-evaluated。

## Acceptance Criteria

- [x] AC1 无饿死（夹具，负对照）：夹具中 scripts / quay-native-src / experiments-scripts 三个 scope 同时 stale（artifact 早于各自源目录最新提交），跑一轮 arch-cycle ⇒ 三个 scope 各被 analyze 一次（`refresh.refreshedScopes` 含三者），刷新后三者 `behindSources:false`。贴出改动前后两次输出——旧实现下同一夹具只刷 scripts、另两个保持 stale。
- [x] AC2 预算仍有界（夹具，负对照）：同一轮里已 fresh 的 src / quay-github-src / quay-backlog-src 被 analyze 0 次；同一间隔内对同一 scope 的 analyze 次数 ≤1。贴出 fake-archguard 的 argv 计数。
- [x] AC3 刷新失败/截断不得伪装当前（夹具）：让 fake archguard 对 experiments-scripts 退出非 0（或删除该 scope 的产物），该 scope 的记录必须是 `evaluated:false`、`cycleCount:null`、reason 含 `artifact-behind-sources`，记录级 `status:"partial"` 且点名该 scope；同一轮刷新成功的 scripts 仍为 `evaluated:true`。负控制：把同样的失败注入施加在 fresh scope 上，不得把它降级（它本来就不该被 analyze）。
- [ ] AC4 生产载体在报告时是当前的（待外部）
  落地并同步到 develop 后，`.quay/arch-cycle-history.jsonl` 最后一轮记录 `behindScopes` 为空（或非空 scope 全部 `evaluated:false` 且 reason 含 `artifact-behind-sources`），且同一 HEAD 上 `node --experimental-strip-types plugin/scripts/instrument-decay-check.ts --root /data/home/yale/work/quay --carrier arch-cycle-history.jsonl --json` 的 `decayed` 不含该载体。贴出记录与检测器输出。
- [x] AC5 语义反转被显式处理：上述三条旧断言已按新规则改写，`scripts/test.sh --for-task gap-arch-cycle-refresh-first-stale-wins-starves-later-scopes` 相关泳道通过；并贴出「同一新断言在旧实现上为红」的输出，证明判据能取假。

## Definition of Done

- [ ] 五条 AC 全绿、`--for-task` scoped 静态检查与相关泳道通过、合并进 develop（AC4 待外部）
- [x] 不再存在「固定顺序 + 单次预算」造成的永久饿死：在任意 ≥2 个 stale scope 的夹具上，连续 ≥2 个间隔后所有 stale scope 都至少被刷新过一次。
- [x] 载体中任何 `evaluated:true` 的 scope，在报告时刻其 artifactTimestamp 不早于覆盖源目录的最新提交；做不到时该 scope 必须是 `evaluated:false` + `artifact-behind-sources`，⛔ 不得是 `cycleCount:0`。
- [x] 刷新仍只在例程 tick 内发生，不进 fan-in / per-task 热路径。

## Touches

- tasks/gap-arch-cycle-refresh-first-stale-wins-starves-later-scopes.md
- plugin/scripts/archguard-runner.ts
- plugin/scripts/quality-gate-driver.ts
- plugin/test/arch-cycle-reading.test.mjs

## Evidence (立案读数)

- 检测器（主检出，2026-10-22）：`instrument-decay-check.ts --carrier arch-cycle-history.jsonl --json` ⇒ `staleEvaluated.state:"stale"`，`decayed` 三组，detail 与 Proposal 表格逐字一致。
- 载体共 32 行；最后一轮 `ts=2026-10-22T04:06:29.026Z`，`refresh:{attempted:false, skipped:"within-interval", detail:"last refresh at 2026-10-22T00:58:21Z is within this routine's 360m interval — at most one analyze per interval"}`。
- 00:58:21Z 那轮：`refresh:{attempted:true, refreshedScope:"scripts", detail:"archguard analyze --diagrams package → plugin/scripts"}`，`behindScopes:["quay-native-src","experiments-scripts"]`（刷新已经选完目标，另两个仍在队尾）。
- 配置：`.quay/config.yml` `loop.arch_cycle_report:{enabled:true, interval:interval:360m}`。

## Evidence (本轮：实现与逐条验证，2026-10-22)

- **AC1 负对照（同一夹具，旧实现 vs 新实现）**：夹具 = scripts / quay-native-src / experiments-scripts 的 artifact 时间戳 `2026-01-01T00:00:00Z` 且其后各有 1 个提交；src / quay-github-src / quay-backlog-src 的 artifact 在 2999 年（fresh）。
  - 旧实现（`git show develop:plugin/scripts/archguard-runner.ts`）：`refreshedScope:"scripts"`、`analyzeCounts:{plugin/scripts:1}`、`totalAnalyzes:1`、`behindAfter:["quay-native-src","experiments-scripts"]`。
  - 新实现：`refreshedScopes:[experiments-scripts, quay-native-src, scripts]`（最陈旧优先），`analyzeCounts` 三者各 1、`totalAnalyzes:3`、`behindAfter:[]`。
- **AC2 argv 计数**：同一夹具下 fresh 的 src / quay-github-src / quay-backlog-src 的 `-s` 出现 0 次。`runArchCycleRound` 连续三轮（t0 / t0+60s / t0+120s，interval=60m）的 analyze 序列为 `[packages/quay/src, plugin/scripts]`：src 在间隔内不被重跑，而刷新后新变 stale 的 scripts 仍能被刷新（旧全局时钟在这一步答 `within-interval`，正是饿死机制）。
- **AC3**：fake archguard 对 experiments-scripts 退出 3 ⇒ 该 scope `evaluated:false` / `cycleCount:null` / `cycles:null` / `basis:null`，reason = `artifact-behind-sources: artifact 2020-01-01T00:00:00Z is behind … commit(s) touching … — analyze exited 3; …`；同一轮 scripts 仍 `evaluated:true`、`behindSources:false`；记录级 `status:"partial"`、`notEvaluatedScopes:["experiments-scripts"]`、`refresh.skipped:"partial"`。负控制：同一失败注入 fresh 的 src ⇒ src 的 `-s` 出现 0 次、仍 `evaluated:true`、记录级仍 `complete`。仪器缺失时同样降级（全无当前读数时记录级 `status:"none"`，Fact `not-evaluated`）。
- **AC5 旧实现上为红**：`refreshedScopes` 字段在 `git show develop:plugin/scripts/quality-gate-driver.ts` 中出现 0 次（旧记录只有单个 `refreshedScope`）；旧 runner 在同一夹具上只刷 1 个 scope、`behindAfter` 仍有两项（见 AC1 对照）。三条旧断言（`at most ONE scope per call` / `exactly one analyze per refresh` / `the other scopes were NOT swept`）已按新规则改写为逆向断言，并保留各自的负控制。
- **scoped gate**：`bash scripts/test.sh --for-task gap-arch-cycle-refresh-first-stale-wins-starves-later-scopes --allow-thin` ⇒ EXIT=0，123 tests / 123 pass / 0 fail（含 `arch-cycle-reading.test.mjs` 16 项与 `quality-gate-driver.test.mjs` 全量）。
- **AC4 承接者（待外部的合法性条件）**：`loop.arch_cycle_report`（`.quay/config.yml`，interval 360m）在主检出上每间隔跑一次 `runArchCycleRound`；落地并由 driver 把 develop 同步到主检出后，其下一轮 append 的记录即 AC4 要求的载体行（无需人工派发；最后一步是常驻例程自动产生）。复验即 AC4 正文两条命令（先读最后一行 `behindScopes` / 各 scope `evaluated` + reason，再跑 `instrument-decay-check.ts --root /data/home/yale/work/quay --carrier arch-cycle-history.jsonl --json`）。
