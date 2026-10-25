---
id: gap-arch-cycle-single-directory-basis-never-due
title: arch-cycle-report 的单目录 scope 把 commitsSinceArtifact 硬编码为 0：plugin/scripts
  永不进 due 集，旧产物以 evaluated:true 上报（检测器 stale-evaluated 常亮）
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

**事实（2026-10-25T17:27:35Z，主检出 `/data/home/yale/work/quay` @ 68b6dcedd，检测器与载体同一 HEAD）**：`node --experimental-strip-types plugin/scripts/instrument-decay-check.ts --json` 对 `.quay/arch-cycle-history.jsonl` 报 `staleEvaluated.state:"stale"`、`decayed=[{group:"scripts",kind:"stale-evaluated",count:1}]`：

```
scope=scripts  artifactTs=2026-10-25T15:09:56.787Z
commitTs=2026-10-25T16:49:01.000Z  sha=850a33bea16e01ec3d2366689f48ff9ed940dc84
reason=artifact 2026-10-25T15:09:56.787Z predates the latest commit touching plugin/scripts
```

同一轮载体记录（最后一行，`ts=2026-10-25T17:27:35.403Z`）却把 scripts 当**当前**读数上报：scope 级 `evaluated:true`、`cycleCount:0`、`basis:"single-directory"`、`artifactTimestamp:"2026-10-25T15:09:56.787Z"`、`commitsSinceArtifact:0`、`behindSources:false`；记录级 `status:"complete"`、`totalCycleCount:0`、`behindScopes:[]`；`refresh:{attempted:true,refreshedScopes:[src],deferredScopes:[]}` —— scripts **连 due 集都没有进**。

**git 直接量（同一 HEAD）**：`git rev-list --count --since=2026-10-25T15:09:57Z HEAD -- plugin/scripts` = **5**（最近一个 850a33bea，`2026-10-26T00:49:01+08:00`）。所以记录里的 `commitsSinceArtifact:0` 不是「读数为 0」，而是一个关于 git 历史的**假读数**。

**机制**：

1. `readDirectoryCycleReading`（`plugin/scripts/archguard-runner.ts:861-866`）对 `basis === "single-directory"` 的 scope **直接写 `commitsSinceArtifact = 0`**，理由是「单目录读数取自 live file list ⇒ 不可能落后于源」。这个理由对 `cycleCount:0` 这个**结论**成立（`singleDirectoryBasis` 在读取时跑 `git ls-files`），但它把一个**结构上不可能非 0 的常量**写进了 git 派生字段（硬规则 4：恒真的量不是测量），同时该 scope 的 `artifactTimestamp` 仍然来自一个旧产物。
2. `scopeNeedsRefresh`（`archguard-runner.ts:954-964`）只认 `behindSources === true`（或 `moduleGraph not produced`）⇒ 单目录且已评估的 scope **永不 due** ⇒ 既不会被刷新，也不会走先前补的 deferred 降级（那条只对 `deferred` 生效，而 scripts 连 due 都不是）。
3. 检测器的 shape D 描述符（`instrument-decay-check.ts:326-341`）只读 `scopes[].{source,artifactTimestamp}` + `scope.evaluated`，**不读 `basis`** ⇒ 它无法区分「cycle 结论真的来自这个旧产物」与「cycle 结论来自 live file list、`artifactTimestamp` 只是附带 provenance」。

⇒ 三个读数互相矛盾（载体 behindSources:false / git 5 commits / 检测器 stale）。一条过期读数与健康读数在当前记录里同形，正是硬规则 3b 的形态。

**为什么不是 rare-by-design**：`single-directory` 是 6 个 scope 中 4 个（scripts / quay-native-src / quay-github-src / quay-backlog-src）的常态 basis；`plugin/scripts` 几乎每个合并提交都被触及 ⇒ 这是本载体的**多数轮次**状态，不是例外路径。

<!-- dedup-ref -->
**与既有任务的关系（done ≠ absent，硬规则 5b）**：prior-claim = `gap-arch-cycle-refresh-first-stale-wins-starves-later-scopes`（done）与 `gap-arch-cycle-within-interval-branch-skips-downgrade`（done）。前者修选择/预算与「刷新不成的 stale scope 必须降级」，后者补 `pending.length === 0` 分支的降级；两者的不变式都写成「任何 `evaluated:true` 的 scope，其 `artifactTimestamp` 不早于覆盖源最新提交；做不到则 `evaluated:false` + `artifact-behind-sources`」。但两者都**假设 `behindSources` 能正确检测落后**；本条证明该输入对单目录 scope 被硬编码为 0 ⇒ 两条前序修法都走不到。两者的 AC4/DoD 在生产上仍未满足（前者 AC4 至今未勾；后者 AC4 亦未勾），当前 HEAD 上检测器仍含该载体 ⇒ 同一腐烂仍在。本条只修 provenance/新鲜度输入，不重做它们的预算与降级逻辑。

<!-- dedup-ref -->
**与在开任务的关系（`task-granularity-advice.ts` 实测 peers=[]）**：`gap-routine-architecture-analysis-god-package-serve-fanout-556`（ready）只在 prose 里 mention `plugin/scripts/archguard-runner.ts`，未在 Touches 声明 ⇒ 不是 merge candidate；`gap-instrument-decay-dedup-reader-round-log-path`（todo）修的是立案去重台账读路径，机制不同 ⇒ separate。

## Plan

1. **writer 侧：停止伪造 git 派生 0。** 单目录 basis 的读数不再写 `commitsSinceArtifact: 0`。二选一（实现者定，记录必须可机读）：
   - 选项 A（推荐）：新增具名 provenance 字段（如 `readingFreshness:"live-file-list"` + `fileListReadAt`），`artifactTimestamp` 保留但不再被当作该 scope cycle 结论的 provenance；
   - 选项 B：`commitsSinceArtifact:null`、`behindSources:null`（该 basis 下不可计算），并写 `freshnessBasis:"single-directory"`。
   ⛔ 继续写一个恒为 0 的 git 派生字段不是选项。
2. **检测器：能读懂「读数不依赖产物」。** `instrument-decay-check.ts` 的 `artifact` 描述符增加一个 artifact-independence 判定（字段名/形态由实现定，例如 `{ field:"basis", equals:"single-directory" }`）；shape D 对这类 scope 跳过「产物时间戳 vs 最新提交」比较，并**显式输出** `artifact-independent`（⛔ 不是静默跳过——跳过本身必须可读，硬规则 3b）。module-graph scope 的既有比较不变。
3. **负控制：豁免不得掩盖前提失效。** `singleDirectoryBasis` 一旦返回 false（有人在 scope 下建子目录并加 .ts），该 scope 立即回到常规路径（due / 降级），不再被标记 artifact-independent。
4. **不采用「把单目录 scope 也纳入 refresh」作为主修法**：产物对该 basis 的 cycle 结论没有输入，每 360m 白跑一次 analyze，且间隔之间会以 `evaluated:false` 呈现一个本来有效的读数。
5. **测试**：`plugin/test/arch-cycle-reading.test.mjs` 增加单目录 provenance 断言（不再有假 0，provenance 与 basis 一致；module-graph scope 仍正常计数）；`plugin/test/instrument-decay-check.test.mjs` 增加 shape D 正/负夹具（单目录 live 读数 + 旧产物 ⇒ 非 stale；module-graph + 旧产物 ⇒ 仍 stale）。

## Acceptance Criteria

- [ ] AC1 writer（夹具 + 负对照）：单目录 basis 的 scope 记录不再携带 `commitsSinceArtifact: 0`；记录携带可机读 provenance 且与 `basis:"single-directory"` 一致。贴出改动前后同一夹具的记录片段；负控制：module-graph basis 的 scope 仍正常计算 `commitsSinceArtifact`（仍能取非 0）。
- [ ] AC2 检测器（夹具 + 负对照）：artifact 描述符能识别 artifact-independent scope 并显式报告。同一夹具中 (a) 单目录 live 读数 + 旧 `artifactTimestamp` ⇒ shape D 为 `fresh`/`artifact-independent`（不是 `stale`）；(b) module-graph scope + 旧 `artifactTimestamp` ⇒ 仍为 `stale`。贴出两种输出。
- [ ] AC3 负控制（前提失效）：夹具中给单目录 scope 加一个子目录 .ts ⇒ `singleDirectoryBasis` 返回 false，该 scope 回到常规 due/降级路径，不再被标 artifact-independent。贴出输出。
- [ ] AC4 生产载体：落地并同步到 develop/主检出后的下一轮记录，同一 HEAD 上 `node --experimental-strip-types plugin/scripts/instrument-decay-check.ts --root /data/home/yale/work/quay --carrier arch-cycle-history.jsonl --json` 的 `decayed` 不含 `arch-cycle-history.jsonl`，且载体不再出现「`evaluated:true` + `artifactTimestamp` 早于覆盖源最新提交 + `commitsSinceArtifact:0`」组合。贴出记录行与检测器输出。（待外部）
- [ ] AC5 scoped gate：`bash scripts/test.sh --for-task gap-arch-cycle-single-directory-basis-never-due --allow-thin` ⇒ EXIT=0，含 `arch-cycle-reading.test.mjs` 与 `instrument-decay-check.test.mjs`；贴出测试计数与退出码。

## Definition of Done

- [ ] 五条 AC 全绿（AC4 待外部）、改动合并进 develop（待外部）
- [ ] 生产载体在报告时刻是当前的：`evaluated:true` 的 scope 其 freshness provenance 要么是当前产物（不早于覆盖源最新提交），要么被显式标注 artifact-independent 且带可核的直接量（live file list 读取时刻）；⛔ 不存在「旧产物 + git 派生 0」组合。
- [ ] 单目录豁免不掩盖前提失效：scope 一旦不再是单目录，立即回到常规 due/降级路径（AC3）。
- [ ] 无新增 spawn：本条不把 analyze 加进任何新路径；例程 tick 的 analyze 次数不因本条增加。

## Touches

- tasks/gap-arch-cycle-single-directory-basis-never-due.md
- plugin/scripts/archguard-runner.ts
- plugin/scripts/instrument-decay-check.ts
- plugin/test/arch-cycle-reading.test.mjs
- plugin/test/instrument-decay-check.test.mjs

## Evidence（立案读数，2026-10-25T17:29Z 主检出 @ 68b6dcedd）

- 检测器：`node --experimental-strip-types plugin/scripts/instrument-decay-check.ts --json` ⇒ `arch-cycle-history.jsonl.staleEvaluated.state:"stale"`，`decayed:[{group:"scripts",kind:"stale-evaluated",count:1,detail:"artifact 2026-10-25T15:09:56.787Z predates the latest commit touching plugin/scripts (2026-10-25T16:49:01.000Z 850a33bea16e01ec3d2366689f48ff9ed940dc84)"}]`。
- 载体最后一行（`ts=2026-10-25T17:27:35.403Z`）：scripts scope `{evaluated:true, cycleCount:0, basis:"single-directory", artifactTimestamp:"2026-10-25T15:09:56.787Z", commitsSinceArtifact:0, behindSources:false}`；记录级 `{status:"complete", totalCycleCount:0, behindScopes:[], refresh:{attempted:true, refreshedScopes:[{scope:"src",...}], deferredScopes:[]}}`。
- 独立直接量：`git rev-list --count --since=2026-10-25T15:09:57Z HEAD -- plugin/scripts` ⇒ `5`；`git log --format='%cI %h %s' --since=2026-10-25T15:09:57Z HEAD -- plugin/scripts` 首行 `2026-10-26T00:49:01+08:00 850a33bea Merge branch 'develop' into task/gap-routine-semantic-dedup-scan-write-state-atomic-split`。
- 代码锚点：`plugin/scripts/archguard-runner.ts:861-866`（`git blame` ⇒ `9876faf64`，2026-10-22，来自 done 任务 `gap-arch-cycle-report-never-evaluated-aggregate-and-stale-artifacts`）；`scopeNeedsRefresh` 在 `:954-964`；检测器描述符在 `plugin/scripts/instrument-decay-check.ts:326-341`。