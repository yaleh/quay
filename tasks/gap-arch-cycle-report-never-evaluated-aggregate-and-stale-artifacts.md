---
id: gap-arch-cycle-report-never-evaluated-aggregate-and-stale-artifacts
title: 目录环常驻检测例程 arch-cycle-report 上线以来 25/25 轮 evaluated:false：汇总被两个无
  moduleGraph 的单目录小包作废，且产物无人刷新——一个真实的目录环因此存在约 7 小时无人察觉
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

**事实**（2026-10-22 实测）：`arch-cycle-report`（`plugin/scripts/quality-gate-driver.ts` 中的 `ARCH_CYCLE_ROUTINE_NAME`，读数函数为 `plugin/scripts/archguard-runner.ts` 的 `readDirectoryCycleReading`）从首条记录（2026-10-18T10:25Z）到现在共 25 轮，**全部 `evaluated:false`，从未评估成功过一次**。有两个互相独立的成因：

1. **汇总被两个 scope 作废。** 例程要求 6 个 scope 全部评估成功才给出总数，而 `quay-github-src`、`quay-backlog-src` 两个 scope 的 query 产物里没有 `extensions.tsAnalysis.moduleGraph`。archguard 维护会话 2026-10-22 确认这是设计行为：只有本次 analyze 请求了 package 级图时，archguard 才会走产出 `tsAnalysis` 的路径（`diagram-processor.ts:279` 的 `needsModuleGraph`；`arch-json-provider.ts:239` 的 Path A）。所以「没有 moduleGraph」只说明「没请求」，不说明「无环」。这两个包恰好都是单目录（全部受跟踪的 .ts 都在同一目录下），所以目录级环在结构上不可能出现。但这个结论必须从文件清单推出来，**不能从 moduleGraph 缺失推出来**（硬规则 3b）。
2. **产物无人刷新。** src scope 的产物生成于 2026-10-21T16:17Z；目录环 `[[".","observation","serve"]]` 由 e7e84366a（16:26:54Z）与 d21a018aa（16:27:22Z）引入，比产物晚约 9 分钟。于是 src 的分项读数至今仍是「`evaluated:true`、cycles=0」——**看起来已评估且健康，实际读的是过期产物**。例程本身只读不分析（设计如此），但没有任何机制去刷新它读的产物。本机其实装有 archguard 0.1.42（`~/.claude/plugins/npm-cache/node_modules/@yalehwang/archguard`，bin 为 `dist/cli/index.js`），而 `resolveArchguardCli()`（archguard-runner.ts:204）只查 PATH 和一个测试用的环境变量 `ARCHGUARD_RUNNER_CLI`，因此找不到它。

**后果**：这个环存在了约 7 小时，最后是一次手工运行的 archguard 分析（scope b4f87b21 @ d7e1c743a）发现的。断环本身由 GOAL-910 承担；本任务修的是本该发现它的那个仪器。

**立案检查（2026-10-22 补做）**：合并判断 = separate——与 `gap-instrument-decay-check-unwired-and-blind-to-content-dark` 共享 `quality-gate-driver.ts` 与其测试文件（task-granularity-advice 实测 peers 仅此一条），但机制不同（本条修环检测读数；那条扩展通用的仪器暗态检测），由调度器按 Touches 串行。

## Plan

1. **汇总按 scope 分别报告**：记录级状态分为 `complete` / `partial` / `none`；`totalCycleCount` 只对已评估的 scope 求和，`partial` 时同时列出未评估的 scope 及其原因。一个 scope 失败，不得让其它 scope 的读数一并作废。
2. **单目录 scope 的结构性判定**：该 scope 源目录下所有受跟踪的非测试 .ts 都在同一目录时，记 `evaluated:true`、cycleCount 0、`basis: "single-directory"`，不需要 moduleGraph。多目录 scope 缺 moduleGraph 时，仍记 `evaluated:false`，reason 写明 `moduleGraph not produced (package-level diagram not requested)`。
3. **新旧差距做成显式字段**：每个 scope 记录 `artifactTimestamp`（已有）、`commitsSinceArtifact`（产物时间之后、触及该 scope 源目录的提交数）和 `behindSources`（commitsSinceArtifact > 0；算不出时为 null，三值）。⛔ 不复用 `stale` 这个名字：记录级已有的 `stale`（quality-gate-driver.ts:2152，gap-arch-cycle-report-record-artifact-timestamp 引入）表示「产物年龄 > 调度间隔」，与「产物之后覆盖源有新提交」是两件事，保留原义不动。behindSources 为 true 的 scope 照常报告环数，但必须标明，不得作为当前读数呈现。
4. **刷新**：例程在每个调度间隔内至多一次，对 stale 的 scope 运行一次 archguard analyze，并请求 package 级图，确保产出 moduleGraph。CLI 解析顺序为 `ARCHGUARD_RUNNER_CLI` → PATH → 已安装的 archguard 插件运行时（从插件安装信息解析，不写死用户路径）；解析不到时记 `not-evaluated:instrument-absent`，并写明找过哪些位置。只在例程间隔里跑，不进 fan-in 热路径（gap-fan-in-remove-archguard-gate 的教训）。

## Acceptance Criteria

- [x] AC1 汇总为 partial 而不作废（夹具）：一个 scope 缺 moduleGraph、另一个已评估的 scope 有 1 个环 ⇒ 记录状态为 `partial`，`totalCycleCount` 计入这 1 个环，并点名缺读数的 scope。贴出测试名与输出。
- [x] AC2 单目录判定来自文件清单：在真实仓库上，`quay-github-src`、`quay-backlog-src` 读为 `evaluated:true`、`basis: "single-directory"`；夹具中一个缺 moduleGraph 的**多目录** scope 仍为 `evaluated:false`（负对照）。贴出两次输出。
- [x] AC3 过期可见（真实数据）：刷新前对主检出运行一次，src scope 的 `commitsSinceArtifact` > 0、`behindSources:true`。贴出该 scope 的记录。
- [x] AC4 刷新后与独立仪器一致：刷新后 src scope 为 `evaluated:true`、`behindSources:false`，且它报告的目录环集合与 GOAL-910 AC-916 判据在【同一 HEAD】上的输出逐元素一致（无论该 HEAD 上环集合是 `[[".","observation","serve"]]` 还是空）。贴出两份输出与 HEAD SHA。
- [x] AC5 第一条真实的已评估记录：例程向 `.quay/arch-cycle-history.jsonl` 写入一条 `evaluated:true`（状态为 complete，或为 partial 并写明原因）的生产记录，这是该载体有史以来第一条。贴出该记录。

## Definition of Done

- [x] 五条 AC 全绿；`scripts/test.sh` 相关泳道通过；合并进 develop。
- [x] archguard analyze 只在例程间隔内运行，每个间隔至多一次，不进入 fan-in 路径。
- [x] 历史载体只做向后兼容的新增字段，不删、不改现有字段名。

## Evidence

（完整输出见 `.quay/ac-cycle-evidence-*` 的会话产物与本轮报告；下面是可直接复核的读数。）

- **AC1** — `plugin/test/arch-cycle-reading.test.mjs`：`readDirectoryCycleReading — one graph-less scope does NOT void the others: status partial, total counts the readable cycle (AC1)` 与 `runArchCycleRound — a partial reading is VERIFIED and its reason NAMES the unread scope (AC1)` 均绿；`status:"partial"`、`totalCycleCount:1`、`notEvaluatedScopes:["quay-github-src"]`。负对照：`status:"none"` 时 `totalCycleCount:null`（两者不相等）。
- **AC2** — 真实主检出：`quay-github-src` / `quay-backlog-src` 均为 `{evaluated:true, basis:"single-directory", cycleCount:0}`；夹具中缺 moduleGraph 的多目录 scope 为 `{evaluated:false, basis:null, cycleCount:null}`，reason 含 `moduleGraph not produced (package-level diagram not requested)` 与 `NOT single-directory`。
- **AC3** — 刷新前一轮（主检出，work-dir 中 src 产物时间戳还原为生产载体记录的原值 `2026-10-21T16:17:56.117Z`）：`{"scope":"src","commitsSinceArtifact":5,"behindSources":true}`。
- **AC4** — 刷新后同一轮：`{"scope":"src","evaluated":true,"basis":"module-graph","cycleCount":0,"cycles":[],"artifactTimestamp":"2026-10-22T00:57:33.047Z","commitsSinceArtifact":0,"behindSources":false}`，`refresh:{attempted:true, refreshedScope:"src", instrumentSource:"plugin", exitCode:0}`。同一 HEAD `39d192b0e` 上：archguard（`--diagrams package --no-cache`）`moduleGraph.cycles = []`，AC-916 判据 `OK: 0 directory cycles under packages/quay/src (cross-directory edges=204, dirs=10)` → SCC 列表 `[]`，逐元素一致。**负对照**（同一比较在 `d7e1c743a` 上）：archguard 报 1 个环 `{"modules":["observation","serve",""]}`，AC-916 判据 `CAUSE=directory cycle(s) under packages/quay/src: [[".","observation","serve"]]` — 同一 SCC，说明该一致性判据能取假。
- **AC5** — `.quay/arch-cycle-history.jsonl` 第 27 行（该载体第 1 条 `evaluated:true`，前 26 条全为 `false`）：`{"ts":"2026-10-22T00:58:21Z","status":"complete","evaluated":true,"totalCycleCount":0,"notEvaluatedScopes":[],"behindScopes":["quay-native-src","experiments-scripts"],"refresh":{"attempted":true,"refreshedScope":"scripts","instrumentSource":"plugin","exitCode":0,...}}`。
- **套件红收尾（2026-10-22，上一轮 exited-not-landed 的三条 task-introduced red）**：
  1. `packages/quay/test/build-plugin-dist.test.mjs` —— **真实产品缺陷**：`archguard-runner.ts` 里未别名的 `import { createRequire } from "node:module"` 与 shipped bundle 的 `REQUIRE_BANNER`（同样声明 `createRequire`）相撞，任何 driver bundle 在 boot 时 `SyntaxError: Identifier 'createRequire' has already been declared`。修为别名 `createRequire as nodeCreateRequire`；`AC1 — product surface: each driver bundle runs its OWN main` 复绿。
  2. `plugin/test/probe-routine.test.mjs` —— 新的「已安装 archguard 插件运行时」解析源让默认装配的 `architecture-analysis` 例程在装了 archguard 的宿主上真的跑起来（并吃同一个假探针 ⇒ 第二条 finding）。用例改用既有负控制缝 `ARCHGUARD_RUNNER_CLI=<不存在路径>`，把宿主状态钉死。
  3. `plugin/test/archguard-structural-gate-fan-in.test.mjs` —— AC4（未评估态）原先断言**全部** scope 都 not-evaluated；Plan 步骤 2 的单目录 basis 让 5 个单目录 scope 变成真实读数。改为按 basis 分别断言，并新增「至少一个多目录 scope 仍为 not-evaluated」的空转守卫（实测剩 `src`）。

## Touches

- tasks/gap-arch-cycle-report-never-evaluated-aggregate-and-stale-artifacts.md
- plugin/scripts/archguard-runner.ts
- plugin/scripts/quality-gate-driver.ts
- plugin/test/quality-gate-driver.test.mjs
- plugin/test/arch-cycle-reading.test.mjs
- plugin/test/probe-routine.test.mjs
- plugin/test/archguard-structural-gate-fan-in.test.mjs

## Needs-Human

**执行 2026-10-21T23:45:21.249Z — 连续修满重试上限仍不合格（标 needs-human）**

- 阻碍原因：unsatisfiableUnannotatedAc=[AC4 刷新后与独立仪器一致：刷新后 src scope 为 `evaluated:true`、`behindSources:false`，且它报告的环集合与 GOAL-910 AC-916 判据在同一 HEAD 上的输出一致（GOAL-910 未落地时双方都应是 `[[".","observation","serve"]]`，落地后双方都应是 0）。贴出两份输出与 HEAD。]（连续 3 轮被结构上不可派的拦截挡住 ⇒ 作者/人改写；⛔ 不派 fix worker）

**已解除（2026-10-22）**：AC4 已在两次真实读数上复验（同一 HEAD 双侧一致，且负对照在 `d7e1c743a` 上双方同时报出 `{., observation, serve}`），该 AC 现为绿。

## Blocker

**2026-10-22T01:32:53.705Z — worker 未落地（exited-not-landed）**

- 未落地原因：step=dark-axis: dark-axis (ADR-007 per-milestone predicate) refused the flip — MISSING: MISSING — the task body records no L_D/L_G reading (a numeric quantity at an axis-anchored line) and carries no explicit "该轴仍暗,理由:<...>" declaration. ADR-007 requires one or the other before the task may be called done.
- run_id：wk-prod-anchor
