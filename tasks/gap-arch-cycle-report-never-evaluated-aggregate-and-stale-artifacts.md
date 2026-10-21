---
id: gap-arch-cycle-report-never-evaluated-aggregate-and-stale-artifacts
title: 目录环常驻检测例程 arch-cycle-report 上线以来 25/25 轮 evaluated:false：汇总被两个无
  moduleGraph 的单目录小包作废，且产物无人刷新——一个真实的目录环因此存在约 7 小时无人察觉
status: todo
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

## Plan

1. **汇总按 scope 分别报告**：记录级状态分为 `complete` / `partial` / `none`；`totalCycleCount` 只对已评估的 scope 求和，`partial` 时同时列出未评估的 scope 及其原因。一个 scope 失败，不得让其它 scope 的读数一并作废。
2. **单目录 scope 的结构性判定**：该 scope 源目录下所有受跟踪的非测试 .ts 都在同一目录时，记 `evaluated:true`、cycleCount 0、`basis: "single-directory"`，不需要 moduleGraph。多目录 scope 缺 moduleGraph 时，仍记 `evaluated:false`，reason 写明 `moduleGraph not produced (package-level diagram not requested)`。
3. **新旧差距做成显式字段**：每个 scope 记录 `artifactTimestamp`（已有）、`commitsSinceArtifact`（产物时间之后、触及该 scope 源目录的提交数）和 `stale`（commitsSinceArtifact > 0）。stale 的 scope 照常报告环数，但必须标明 stale，不得作为当前读数呈现。
4. **刷新**：例程在每个调度间隔内至多一次，对 stale 的 scope 运行一次 archguard analyze，并请求 package 级图，确保产出 moduleGraph。CLI 解析顺序为 `ARCHGUARD_RUNNER_CLI` → PATH → 已安装的 archguard 插件运行时（从插件安装信息解析，不写死用户路径）；解析不到时记 `not-evaluated:instrument-absent`，并写明找过哪些位置。只在例程间隔里跑，不进 fan-in 热路径（gap-fan-in-remove-archguard-gate 的教训）。

## Acceptance Criteria

- [ ] AC1 汇总为 partial 而不作废（夹具）：一个 scope 缺 moduleGraph、另一个已评估的 scope 有 1 个环 ⇒ 记录状态为 `partial`，`totalCycleCount` 计入这 1 个环，并点名缺读数的 scope。贴出测试名与输出。
- [ ] AC2 单目录判定来自文件清单：在真实仓库上，`quay-github-src`、`quay-backlog-src` 读为 `evaluated:true`、`basis: "single-directory"`；夹具中一个缺 moduleGraph 的**多目录** scope 仍为 `evaluated:false`（负对照）。贴出两次输出。
- [ ] AC3 过期可见（真实数据）：刷新前对主检出运行一次，src scope 的 `commitsSinceArtifact` > 0、`stale:true`。贴出该 scope 的记录。
- [ ] AC4 刷新后与独立仪器一致：刷新后 src scope 为 `evaluated:true`、`stale:false`，且它报告的环集合与 GOAL-910 AC-916 判据在同一 HEAD 上的输出一致（GOAL-910 未落地时双方都应是 `[[".","observation","serve"]]`，落地后双方都应是 0）。贴出两份输出与 HEAD。
- [ ] AC5 第一条真实的已评估记录：例程向 `.quay/arch-cycle-history.jsonl` 写入一条 `evaluated:true`（状态为 complete，或为 partial 并写明原因）的生产记录，这是该载体有史以来第一条。贴出该记录。

## Definition of Done

- [ ] 五条 AC 全绿；`scripts/test.sh` 相关泳道通过；合并进 develop。
- [ ] archguard analyze 只在例程间隔内运行，每个间隔至多一次，不进入 fan-in 路径。
- [ ] 历史载体只做向后兼容的新增字段，不删、不改现有字段名。

## Touches

- tasks/gap-arch-cycle-report-never-evaluated-aggregate-and-stale-artifacts.md
- plugin/scripts/archguard-runner.ts
- plugin/scripts/quality-gate-driver.ts
- plugin/test/quality-gate-driver.test.mjs
- plugin/test/arch-cycle-reading.test.mjs
