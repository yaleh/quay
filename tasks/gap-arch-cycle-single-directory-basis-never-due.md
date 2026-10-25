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

- [x] AC1 writer（夹具 + 负对照）：单目录 basis 的 scope 记录不再携带 `commitsSinceArtifact: 0`；记录携带可机读 provenance 且与 `basis:"single-directory"` 一致。贴出改动前后同一夹具的记录片段；负控制：module-graph basis 的 scope 仍正常计算 `commitsSinceArtifact`（仍能取非 0）。
- [x] AC2 检测器（夹具 + 负对照）：artifact 描述符能识别 artifact-independent scope 并显式报告。同一夹具中 (a) 单目录 live 读数 + 旧 `artifactTimestamp` ⇒ shape D 为 `fresh`/`artifact-independent`（不是 `stale`）；(b) module-graph scope + 旧 `artifactTimestamp` ⇒ 仍为 `stale`。贴出两种输出。
- [x] AC3 负控制（前提失效）：夹具中给单目录 scope 加一个子目录 .ts ⇒ `singleDirectoryBasis` 返回 false，该 scope 回到常规 due/降级路径，不再被标 artifact-independent。贴出输出。
- [ ] AC4 生产载体：落地并同步到 develop/主检出后的下一轮记录，同一 HEAD 上 `node --experimental-strip-types plugin/scripts/instrument-decay-check.ts --root /data/home/yale/work/quay --carrier arch-cycle-history.jsonl --json` 的 `decayed` 不含 `arch-cycle-history.jsonl`，且载体不再出现「`evaluated:true` + `artifactTimestamp` 早于覆盖源最新提交 + `commitsSinceArtifact:0`」组合。贴出记录行与检测器输出。（待外部）
- [x] AC5 scoped gate：`bash scripts/test.sh --for-task gap-arch-cycle-single-directory-basis-never-due --allow-thin` ⇒ EXIT=0，含 `arch-cycle-reading.test.mjs` 与 `instrument-decay-check.test.mjs`；贴出测试计数与退出码。

## Definition of Done

- [ ] 五条 AC 全绿（AC4 待外部）、改动合并进 develop（待外部）
- [ ] 生产载体在报告时刻是当前的：`evaluated:true` 的 scope 其 freshness provenance 要么是当前产物（不早于覆盖源最新提交），要么被显式标注 artifact-independent 且带可核的直接量（live file list 读取时刻）；⛔ 不存在「旧产物 + git 派生 0」组合。（待外部）
- [x] 单目录豁免不掩盖前提失效：scope 一旦不再是单目录，立即回到常规 due/降级路径（AC3）。
- [x] 无新增 spawn：本条不把 analyze 加进任何新路径；例程 tick 的 analyze 次数不因本条增加。

## Touches

- tasks/gap-arch-cycle-single-directory-basis-never-due.md
- plugin/scripts/archguard-runner.ts
- plugin/scripts/instrument-decay-check.ts
- plugin/scripts/quality-gate-driver.ts
- plugin/test/arch-cycle-reading.test.mjs
- plugin/test/instrument-decay-check.test.mjs

## Evidence（立案读数，2026-10-25T17:29Z 主检出 @ 68b6dcedd）

- 检测器：`node --experimental-strip-types plugin/scripts/instrument-decay-check.ts --json` ⇒ `arch-cycle-history.jsonl.staleEvaluated.state:"stale"`，`decayed:[{group:"scripts",kind:"stale-evaluated",count:1,detail:"artifact 2026-10-25T15:09:56.787Z predates the latest commit touching plugin/scripts (2026-10-25T16:49:01.000Z 850a33bea16e01ec3d2366689f48ff9ed940dc84)"}]`。
- 载体最后一行（`ts=2026-10-25T17:27:35.403Z`）：scripts scope `{evaluated:true, cycleCount:0, basis:"single-directory", artifactTimestamp:"2026-10-25T15:09:56.787Z", commitsSinceArtifact:0, behindSources:false}`；记录级 `{status:"complete", totalCycleCount:0, behindScopes:[], refresh:{attempted:true, refreshedScopes:[{scope:"src",...}], deferredScopes:[]}}`。
- 独立直接量：`git rev-list --count --since=2026-10-25T15:09:57Z HEAD -- plugin/scripts` ⇒ `5`；`git log --format='%cI %h %s' --since=2026-10-25T15:09:57Z HEAD -- plugin/scripts` 首行 `2026-10-26T00:49:01+08:00 850a33bea Merge branch 'develop' into task/gap-routine-semantic-dedup-scan-write-state-atomic-split`。
- 代码锚点：`plugin/scripts/archguard-runner.ts:861-866`（`git blame` ⇒ `9876faf64`，2026-10-22，来自 done 任务 `gap-arch-cycle-report-never-evaluated-aggregate-and-stale-artifacts`）；`scopeNeedsRefresh` 在 `:954-964`；检测器描述符在 `plugin/scripts/instrument-decay-check.ts:326-341`。

## Evidence（实现轮，2026-10-26，worktree @ 5cb7023de + merge develop 110143476）

**AC1 同一夹具的改动前后片段**。夹具生成器 `.quay/worker-evidence-ac1/snippet.mjs`（worktree 内、gitignored）：单目录 scope = `packages/quay-backlog/src`（query 产物无 moduleGraph），全部 `artifactTimestamp=2025-06-01T00:00:00Z`，随后 `2026-01-02T00:00:00Z` 有一个提交触及 `plugin/scripts`。同一脚本分别以 **develop 树**（改动前）与本分支（改动后）为 import 目标运行：

改动前（develop 110143476）：
```
carrier record — quay-backlog-src (single-directory):
{"scope":"quay-backlog-src","source":"packages/quay-backlog/src","evaluated":true,"cycleCount":0,"basis":"single-directory",
 "artifactTimestamp":"2025-06-01T00:00:00Z","commitsSinceArtifact":0,"behindSources":false}
carrier record — scripts (module-graph 负对照):
{"scope":"scripts","source":"plugin/scripts","evaluated":true,"cycleCount":0,"basis":"module-graph",
 "artifactTimestamp":"2025-06-01T00:00:00Z","commitsSinceArtifact":2,"behindSources":true}
```

改动后（本分支）：
```
carrier record — quay-backlog-src (single-directory):
{"scope":"quay-backlog-src","source":"packages/quay-backlog/src","evaluated":true,"cycleCount":0,"basis":"single-directory",
 "artifactTimestamp":"2025-06-01T00:00:00Z","readingFreshness":"live-file-list","fileListReadAt":"2026-10-25T17:41:32.638Z",
 "commitsSinceArtifact":null,"behindSources":null}
carrier record — scripts (module-graph 负对照):
{"scope":"scripts","source":"plugin/scripts","evaluated":true,"cycleCount":0,"basis":"module-graph",
 "artifactTimestamp":"2025-06-01T00:00:00Z","readingFreshness":"artifact","fileListReadAt":null,
 "commitsSinceArtifact":2,"behindSources":true}
```
⇒ 单目录行不再有假 0；provenance（`readingFreshness:"live-file-list"` + `fileListReadAt`，即 live file list 的读取时刻）与 `basis:"single-directory"` 一致，`artifactTimestamp` 保留但只是 provenance；module-graph 行仍取到非 0（2）并保持 `behindSources:true`。

**AC2 检测器（同一记录、正/负对照）**。新增测试 `形态 D — 同一记录里 single-directory（live）标 artifact-independent，module-graph 仍判 stale（AC2 正/负对照）`，绿。同一记录里两个 scope：
- (a) `scripts`（`basis:"single-directory"`，artifactTs=`2026-10-21T16:17:56.117Z`，覆盖源最后提交 `2026-10-21T16:26:00Z`）⇒ `{state:"artifact-independent", commitMs:null, artifactTs:"2026-10-21T16:17:56.117Z", independence:{field:"basis", value:"single-directory", readAt:"2026-10-21T23:00:00.000Z"}, reason:"'basis'='single-directory' ⇒ this reading comes from the live file list read at …; artifactTimestamp … is provenance only and is NOT compared against the latest commit touching plugin/scripts"}`，记录级 `artifactIndependentScopes:["scripts"]`；只含该 scope 的记录整体 `staleEvaluated.state:"fresh"`。
- (b) `src`（`basis:"module-graph"`，同一旧产物，覆盖源最后提交 `2026-10-21T16:27:00Z`）⇒ `{state:"stale", commitMs:1789…}`，`decayed:[{group:"src",kind:"stale-evaluated"}]`，整体 `staleEvaluated.state:"stale"`。
- 负对照：同一份数据去掉 `basis` 声明 ⇒ 仍判 `stale`、`artifactIndependentScopes:[]`（豁免不是「这个夹具永远不报」）。

**AC3 前提失效负控制**。测试 `negative control — a scope that STOPS being single-directory loses the live-file-list basis and returns to the normal due path (AC3)`，绿。基线 `{basis:"single-directory", readingFreshness:"live-file-list", scopeNeedsRefresh:false}`；加入 `packages/quay-backlog/src/nested/deep.ts` 并提交后 ⇒ `{basis:null, readingFreshness:null, evaluated:false, fileListReadAt:null, reason:/moduleGraph not produced … NOT single-directory/, scopeNeedsRefresh:true}`，且 `selectRefreshTargets(...)` 含 `quay-backlog-src` ⇒ 回到常规 due/降级路径。

**AC4（待外部）**。检测器侧已在**生产载体**上转绿：
```
node --experimental-strip-types plugin/scripts/instrument-decay-check.ts --root /data/home/yale/work/quay --carrier arch-cycle-history.jsonl --json
⇒ {"ok":true,"evaluated":true,"decayedCount":0,"healthyCount":1,...,"staleEvaluated":{"state":"fresh","recordTs":"2026-10-25T17:27:35.403Z",
   "artifactIndependentScopes":["scripts","quay-native-src","quay-github-src","quay-backlog-src"],...}}
```
记录侧仍待**下一轮**写入（因此 AC4 保持未勾）：现存最后一行（`ts=2026-10-25T17:27:35.403Z`，改动前写入）仍带 `commitsSinceArtifact:0` —— 这是本次修复要消除的历史形状，新记录会以 `readingFreshness:"live-file-list"` + `fileListReadAt` + `commitsSinceArtifact:null` 出现。

**AC5 scoped gate**：`bash scripts/test.sh --for-task gap-arch-cycle-single-directory-basis-never-due --allow-thin` ⇒ **EXIT=0**，实跑两次（同一命令，两种 Touches 状态）：
- Touches 尚未含 `plugin/scripts/quality-gate-driver.ts` 时：`tests 58 / pass 58 / fail 0`；
- 最终树（Touches 已含该文件 ⇒ 选择面更宽）：`tests 174 / pass 174 / fail 0`。
两次都含 `plugin/test/arch-cycle-reading.test.mjs`（19，含本任务两条新测试）与 `plugin/test/instrument-decay-check.test.mjs`（39，含本任务两条新测试）。完整日志：worktree `.quay/worker-evidence-ac1/scoped-gate.txt`（58）与 `scoped-gate-final.txt`（174）。

**DoD 无新增 spawn**：`refreshBehindScopes` / `runArchCycleRound` 的 spawn 路径未改；`scopeNeedsRefresh` 对 `behindSources:null` 仍返回 false（单目录 scope 仍不进 due 集，Plan item 4），故例程 tick 的 analyze 次数不因本条增加。`plugin/scripts/quality-gate-driver.ts` 的改动只是把新字段写进载体记录的形状声明（`ArchCycleHistoryRecord.scopes[]`），无行为变化。

## Dark axis（ADR-007）

- 该轴仍暗,理由:本条只改 arch-cycle 读数的 provenance 字段与检测器的 artifact-independence 判定，未触碰模块/依赖结构；且 DoD 明确不新增 analyze spawn，本轮没有运行结构分析 ⇒ 没有 L_D/L_G 数值读数可用（结构轴对本条没有输入，不等于「已测为 0」）。

## Fleet 台账对账（case_757bce6ae882，2026-10-25T20:20Z，主检出 @ c2cb9cada）

**结论：`status=ready` 是真读数，不是台账滞后。本轮 ⛔ 不改 status、⛔ 不写 done/verifiedBy——完成由本项目 fan-in 判。** Fleet 把它 escalate 成 attention 的理由（ephemeral-dev-session）核实为：实现已在任务分支上，但机械 fan-in 因等锁而长时间未落地。

**① 实现已在任务分支、develop 上还没有**：分支 `task/gap-arch-cycle-single-directory-basis-never-due` @ `12c72a900`（实现提交 `5cb7023de` + 5 次 `Merge branch 'develop' into task/...`）；`git diff --shortstat develop...task/...` ⇒ `5 files changed, 363 insertions(+), 32 deletions(-)`。直接量：`git show develop:plugin/scripts/archguard-runner.ts | grep -c readingFreshness` ⇒ `0` ⇒ develop 上仍是写死 `commitsSinceArtifact:0` 的旧行为。

**② 未落地的原因：机械 fan-in 在 `.git/fan-in.lock` 上等了 2h22m44s**（机器可读读数，非估算）：
- `.quay/fan-in-gap-arch-cycle-single-directory-basis-never-due-wk-prod-anchor.log` 首步 `{"step":"acquire-fan-in-lock","wall_ms":8564464}` ⇒ 8564464 ms。
- 等待链：`2953965`（`worker-driver --mechanical-fan-in --task <本任务>`，起 `2026-10-25T17:55:39Z`）→ `2954706` bash holder → `flock -x` 阻塞，直到 `2026-10-25T20:18:25Z` 才写出本任务**第一条** acquire 事件（此前 `.quay/fan-in-lock-events.jsonl` 里本任务 acquire 计数 = **0**）。
- 同一窗口内同一把锁被别的任务 acquire 至少 4 次：`18:26:09Z` dup-last-suite-start-offset、`18:46:50Z` quay-init / god-package-serve-fanout-556、`19:23:11Z` dup-last-suite、`19:43:28Z` 556（持锁至 `20:18:25Z`）。
- ⇒ **观察项（⛔ 不新立任务，硬规则 12：发生率目前 1）**：`acquireFanInLock`（`plugin/scripts/worker-fan-in.ts:1615-1620`）的注释把「排队」当作这把锁存在的价值（「unbounded——排队等待正是这把正确性锁存在的意义」），而 `flock(2)` **不提供 FIFO 公平性**：所有等待者等价竞争，先到者不优先；且等待期间**不发射任何事件**（只有 acquire 之后才有），所以「在等锁」与「在干活」在事件上同形。等待时长实测 2h22m44s。

**③ 驱动侧阶段读数是代理量（硬规则 4b）**：`.quay/worker-round.jsonl` round 28 @ `20:12:31Z` 的 `in_flight_tasks` 含本任务、`in_flight_task_starts` = `17:35:18.823Z`；`filter_trace` 里 `notInFlight` = `{blocker:null, waitedMinutes:164}`。`.quay/live-state.json` 把它投影为 `phase:"implementing"`，而同一时刻它的子进程实际是 `worker-driver --mechanical-fan-in` 且在等锁 ⇒ **live-state 的阶段字段与实际阶段不符**；判「这条任务是否在干活」要用 `git log` 的 worktree 末次提交时刻 / 子进程真实 argv。

**④ 报告时刻的进行态（⛔ 不是结论）**：`20:18:25Z` 拿到锁后，fan-in 依次通过 `merge-develop` / `anti-drift` / `delta`(code) / `typecheck` / `doc-check`（最后一条 `20:19:13Z`），suite 阶段尚未结束；**是否落地未知**，本记录不对它下结论。

**⑤ AC4 仍不可评估**：`plugin/scripts/arch-cycle-history.jsonl` 最后一行 `ts=2026-10-25T17:52:47.909Z`，`grep -c readingFreshness` = 0 ⇒ 生产载体还没跑过「落地之后」的一轮。解除条件：本任务 fan-in 落地 develop → 下一次 arch-cycle 例程轮写入带 `readingFreshness:"live-file-list"` 的记录 → 才可能勾 AC4 / DoD。