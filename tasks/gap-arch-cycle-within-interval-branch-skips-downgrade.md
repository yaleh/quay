---
id: gap-arch-cycle-within-interval-branch-skips-downgrade
title: arch-cycle-report 的 within-interval 分支不执行 stale 降级：唯一 due scope 被间隔预算推迟时
  plugin/scripts 仍以 evaluated:true + cycleCount:0 上报（检测器 stale-evaluated 常亮）
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

**事实（2026-10-22，主检出 `/data/home/yale/work/quay` @ 6a4ffe950，== develop）**：仪器腐烂检测器对 `.quay/arch-cycle-history.jsonl` 报 `staleEvaluated.state:"stale"`、`decayed=[{group:"scripts",kind:"stale-evaluated"}]`：

```
scope=scripts  artifactTs=2026-10-22T00:58:26.699Z
commitTs=2026-10-22T05:01:39.000Z  sha=a05e71cbd910c63739c08ce53e4d3dad3677c7f7
reason=artifact 2026-10-22T00:58:26.699Z predates the latest commit touching plugin/scripts
```

载体最后一轮（`ts=2026-10-22T05:16:43.221Z`）却把它当**当前读数**上报：`status:"complete"`、`evaluated:true`、`totalCycleCount:0`、`notEvaluatedScopes:[]`、`behindScopes:["scripts"]`，且 scripts scope 自己仍是 `evaluated:true` / `artifactTimestamp:"2026-10-22T00:58:26.699Z"` / `commitsSinceArtifact:19`；`refresh:{attempted:false,skipped:"within-interval",deferredScopes:[{scope:"scripts",reason:"within-interval: last refresh at 2026-10-22T00:58:21Z is within this routine's 360m interval"}]}`。

**同一载体上 27 分钟前的记录证明降级逻辑本身是好的，只是这条分支没走到**：`ts=2026-10-22T04:49:37.513Z` 的记录里 scripts 同样是 `artifactTimestamp=2026-10-22T00:58:26.699Z`、同样被 within-interval 推迟，但 `evaluated:false`、`cycleCount:null`、reason 含 `artifact-behind-sources`，记录级 `status:"partial"`、`notEvaluatedScopes:["scripts"]`。两轮的唯一差别是：04:49 那轮还有 `experiments-scripts` / `quay-native-src` 两个 pending scope，05:16 那轮 `pending.length === 0`。

**机制（`plugin/scripts/quality-gate-driver.ts` 的 `runArchCycleRound`）**：

- `due = selectRefreshTargets(readingBeforeRefresh)` 取所有 `behindSources === true` 的 scope；
- 每个 due scope 若上次刷新在 `intervalMinutes` 内 ⇒ 进 `deferred`，否则进 `pending`；
- `pending.length === 0` 时直接走 `within-interval` 分支（`:2303-2310`）返回，**不写 `downgradeCauses`**；而 `downgradeCauses` 的填充只写在 `else`（`pending.length > 0`）分支里（`:2334-2351`）；
- 于是 `downgradeStaleScopes(reading, downgradeCauses)`（`:2356-2358`，本任务要守的「诚实闸」）在有 due-but-deferred scope 的纯间隔内轮次里是空操作 ⇒ 过期读数以 `evaluated:true` + `cycleCount:0` 呈现，与健康读数同形（硬规则 3b）。

**为什么这不是「罕见但按设计」**：`plugin/scripts` 几乎每个合并提交都会触及（实测 00:58Z 刷新后至 05:01Z 已有 19 个提交），而例程间隔 360m（`.quay/config.yml` `loop.arch_cycle_report.interval:360m`）⇒ 00:58:21Z 那次刷新之后、06:58:21Z 之前，只要没有别的 scope 变 due，每一轮都走 `pending.length === 0`。这是该 scope 的**多数轮次**，不是例外路径；故按真缺陷立案，不按 rare-by-design 裁定。

<!-- dedup-ref -->
prior-claim: gap-arch-cycle-refresh-first-stale-wins-starves-later-scopes

该前序任务（done，同一载体同一形态）修掉了另外两个 scope 的永久饿死（本轮实测 quay-native-src / experiments-scripts 的产物已刷新为 04:49Z，检测器由 3 组降到 1 组），并把 `downgradeStaleScopes` 写成「analyze 失败 / 仪器缺失 / **deferred** 都必须降级」。但它的 AC4「生产载体在报告时是当前的（待外部）」在落地任务文件里仍未勾选，且正文要求检测器 `decayed` 不含该载体——当前 HEAD 上仍在含 ⇒ 同一腐烂仍在当前载体上（done ≠ absent，硬规则 5b）。本条只补 `pending.length === 0` 分支的降级遗漏，不重做它的选择/预算机制。

<!-- dedup-ref -->
**与在开任务的关系（merge-candidate 读数：`task-granularity-advice.ts` peers=2）**：

- `gap-adr007-half1-selfcheck-probes-archived-and-gate-never-invoked`（ready）共享 `plugin/scripts/quality-gate-driver.ts`，但机制不同（ADR 门/selfcheck 的调用面 vs arch-cycle 的降级分支）⇒ separate，由调度器按 Touches 串行。
- `gap-instrument-decay-dedup-reader-round-log-path`（needs-human）也共享该文件，修的是 instrument-decay 立案去重台账的读路径，与本条的降级分支不同 ⇒ separate。

## Plan

1. `runArchCycleRound`：把「due 但本轮未刷新」的 scope 原因台账（`downgradeCauses`）从 `else` 分支里提出来，改为对所有仍 due 的 scope 计算——至少在 `pending.length === 0` 分支里把每个 `deferred` scope 以 `deferredByScope` 的原因写入 `downgradeCauses`，使 `downgradeStaleScopes` 在这条路径上也生效。语义仍保留「within-interval 不跑 analyze」（不增加 spawn）。
2. 降级后记录形状与 partial 路径保持一致：`status:"partial"`、`notEvaluatedScopes` 含该 scope、`cycleCount:null` / `cycles:null` / `basis:null`、reason 含字面 token `artifact-behind-sources`；`refresh.attempted` 仍为 `false`、`skipped` 仍为 `within-interval`（「没跑 analyze」与「读数过期」必须能同时读到）。
3. 负控制：同一轮里 fresh 的 scope 不得被降级（它们本来就不 due）；无 due scope 的轮次仍为 `skipped:"no-scope-needs-refresh"` 且 `status:"complete"`。
4. 测试：在 `plugin/test/arch-cycle-reading.test.mjs` 增一条回归用例——夹具中只有 `plugin/scripts` 一个 scope behind，且其上次刷新在间隔内 ⇒ 断言上述降级形状与零 analyze；并贴出同一夹具在旧实现上为 `evaluated:true` + `cycleCount:0` + `status:"complete"` 的对照（判据能取假）。

## Acceptance Criteria

- [x] AC1（夹具 + 负对照）：夹具中只有 `plugin/scripts` 一个 scope `behindSources:true`，`refresh.at` 落在 `intervalMinutes` 内；跑一轮 `runArchCycleRound` 后，该 scope 为 `evaluated:false`、`cycleCount:null`、`cycles:null`、reason 含 `artifact-behind-sources`；记录级 `status:"partial"`、`notEvaluatedScopes:["scripts"]`、`refresh.attempted:false`、`refresh.skipped:"within-interval"`。贴出同一夹具在改动前（`git show develop:plugin/scripts/quality-gate-driver.ts`）的输出：`evaluated:true` + `cycleCount:0` + `status:"complete"`。
- [x] AC2（负控制）：同一夹具里 fresh 的其它 5 个 scope 一个都不被降级；当无任何 scope due 时，轮次仍是 `skipped:"no-scope-needs-refresh"`、`status:"complete"`、零降级。贴出两者的 `scopes[].evaluated` 与记录级 `status`。
- [x] AC3（零新增 spawn）：上述降级轮次里 fake archguard 的 argv 计数为 0（`within-interval` 仍不跑 analyze）。贴出计数输出。
- [ ] AC4（生产载体）：落地并同步到 develop/主检出后的下一轮 within-interval 记录里，`scripts` 为 `evaluated:false` + `artifact-behind-sources`（或已被刷新为当前），且同一 HEAD 上 `node --experimental-strip-types plugin/scripts/instrument-decay-check.ts --root /data/home/yale/work/quay --carrier arch-cycle-history.jsonl --json` 的 `decayed` 不含 `arch-cycle-history.jsonl`。贴出记录行与检测器输出。（待外部）
- [x] AC5：`bash scripts/test.sh --for-task gap-arch-cycle-within-interval-branch-skips-downgrade --allow-thin` ⇒ EXIT=0，含 `arch-cycle-reading.test.mjs` 全量；贴出测试计数与退出码。

## Definition of Done

- [ ] 五条 AC 全绿（AC4 待外部）、改动合并进 develop（待外部）
- [x] 载体不变式成立且由机制（不是 prose）保证：任何 `evaluated:true` 的 scope，其 `artifactTimestamp` 不早于覆盖源路径的最新提交；做不到时该 scope 必须是 `evaluated:false` + reason 含 `artifact-behind-sources`，⛔ 不得是 `cycleCount:0`。该不变式在 `pending.length === 0` 的纯间隔内轮次同样成立。
- [x] `within-interval` 轮次仍不跑 analyze（零新增 spawn），刷新仍只在例程 tick 内发生，不进 fan-in / per-task 热路径。
- [x] 记录级 `status` 与 scope 级 `evaluated` 不再互相矛盾：有降级 scope ⇒ `status:"partial"` 且 `notEvaluatedScopes` 点名，绝不出现 `status:"complete"` + 某 scope `evaluated:false`。

## Touches

- tasks/gap-arch-cycle-within-interval-branch-skips-downgrade.md
- plugin/scripts/quality-gate-driver.ts
- plugin/test/arch-cycle-reading.test.mjs

## Evidence (立案读数)

- 检测器（主检出，2026-10-22）：`node --experimental-strip-types plugin/scripts/instrument-decay-check.ts --root /data/home/yale/work/quay --carrier arch-cycle-history.jsonl --json` ⇒ `staleEvaluated.state:"stale"`, `recordTs:"2026-10-22T05:16:43.221Z"`, `decayed:[{"group":"scripts","kind":"stale-evaluated","count":1,...}]`。
- 载体末条：`ts=2026-10-22T05:16:43.221Z`，`status:"complete"`，`behindScopes:["scripts"]`，`refresh:{attempted:false,skipped:"within-interval",deferredScopes:[scripts]}`。
- 载体前条：`ts=2026-10-22T04:49:37.513Z`，`status:"partial"`，`notEvaluatedScopes:["scripts"]`，scripts `evaluated:false` + `artifact-behind-sources`（reason 写明 behind 19 commits / within-interval）。
- 代码：`plugin/scripts/quality-gate-driver.ts:2303-2310`（`pending.length === 0` 分支不填 `downgradeCauses`）与 `:2334-2351`（只在 `else` 分支填）、`:2356-2358`（`downgradeStaleScopes` 调用）。
- 轮次分布：00:58:21Z 刷新 scripts 后至 05:01:39Z 之间 plugin/scripts 已有 19 个提交（`git log --format=%cI -- plugin/scripts`），例程间隔 360m。

## Implementation Evidence (2026-10-22, worktree `task/gap-arch-cycle-within-interval-branch-skips-downgrade`)

统一夹具（AC1/AC2/AC3 共用）：base commit @2025-12-01；六 scope artifact @2026-01-01（均带 moduleGraph ⇒ 全部 evaluated）；唯一后续提交 @2026-02-01 只触及 `plugin/scripts`；carrier 记 `scripts` 上次 refresh @2026-10-22T05:15:43.221Z，本轮 `now=2026-10-22T05:16:43.221Z`，`intervalMinutes=360` ⇒ 唯一 due scope 落在间隔内。

- AC1 后置（修复后同一夹具）：`status:"partial"`、`notEvaluatedScopes:["scripts"]`、`refresh:{attempted:false,skipped:"within-interval",deferredScopes:[{scope:"scripts",...}]}`；`scripts` scope：`evaluated:false`、`cycleCount:null`、`cycles:null`、`basis:null`、`behindSources:true`、`reason:"artifact-behind-sources: artifact 2026-01-01T00:00:00Z is behind 1 commit(s) touching plugin/scripts — within-interval: …"`。
- AC1 前置对照（同一夹具、`git show develop:plugin/scripts/quality-gate-driver.ts` 的旧实现，`/tmp/negctl-within-interval.mjs` 实测）：`status:"complete"`、`notEvaluatedScopes:[]`、`scripts:{evaluated:true, cycleCount:0, cycles:[], basis:"module-graph", reason:null}` ⇒ 判据能取假（旧实现上红）。
- AC2 负控制：同一轮另 5 scope 全部 `evaluated:true` + `cycleCount:0`（`[["src",true],["quay-native-src",true],["quay-github-src",true],["quay-backlog-src",true],["experiments-scripts",true]]`）；无任何 due scope 的独立夹具 ⇒ `refresh.skipped:"no-scope-needs-refresh"`、`refresh.attempted:false`、`status:"complete"`、`notEvaluatedScopes:[]`、六 scope 全 `evaluated:true`。
- AC3 零 spawn：上述降级轮次 `analyzedSources(record)`（fake archguard 每次调用追加一行 argv）⇒ `[]`，即 argv 计数 0。
- AC5：`bash scripts/test.sh --for-task gap-arch-cycle-within-interval-branch-skips-downgrade --allow-thin` ⇒ `EXIT=0`，`tests 131 / pass 131 / fail 0`；其中 `plugin/test/arch-cycle-reading.test.mjs` 17/17 通过，含新增用例 `runArchCycleRound — a DUE scope deferred by the interval budget is DOWNGRADED, not reported as a current reading (AC1/AC3)`。

## ADR-007 dark-axis record

该轴仍暗,理由:本任务只改 `runArchCycleRound` 的分支控制流（把 deferred scope 写进既有的 downgradeCauses 台账），未改变包依赖结构或上帝包分布，L_D/L_G 读数对本改动无判别力且本任务未测量。

## Evidence (立案读数)