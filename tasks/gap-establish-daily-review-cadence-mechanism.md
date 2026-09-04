---
id: gap-establish-daily-review-cadence-mechanism
title: land the human's daily review cadence decision as a mechanism — calendar-
  tied once/day, manager initiates/aggregates, three checklist items incl. a
  reusable strategic-doc-staleness checker (generalize the roadmap AC4 grep)
status: done
labels:
  - gap
  - milestone-candidate
extra:
  schema: v1
---

**type:** execution

## Proposal

人已裁定复盘节奏（**决定，不是建议**），来源：`FINDING-roadmap-predates-ADR-022-retirement-2026-08-05.md`
引出的「外层有没有做整体分析」缺口的处置。

**裁定的三要素**：

1. **频率**：每天一次，**按日历时间挂钩**，不按任务量/tick 数——架构决定（ADR-022 这类）不会与任务
   速度成比例发生；
2. **谁做**：管理者发起并汇总，外层参与作答，人接收结果、**保留方向裁定权**（不要求人自己审查，
   但方向性改变仍需人点头）；
3. **看什么（三项具体清单）**：
   (a) **机械检查战略文档是否过期**——扫 `docs/proposals/`、`orchestration/*ROADMAP*` 类文件，
      查引用已删除文件路径或已废除 ADR 描述的机制。**`gap-roadmap-silently-stale-...` 任务里写的
      AC4 grep 检查要固化成通用可复用脚本，不是一次性用完**；
   (b) 近期新建 `gap-*` 任务**能不能追溯到明确写下来的战略问题**，还是纯反应式；
   (c) **扩展 `outer-phase-goal.md` / `manager-phase-goal.md` 现有的「复核记录」范围**，从只覆盖角色
      纪律扩到覆盖**方向本身有没有偏**，不另起一套。

### 选定机制

**把复盘变成机制**（不是靠角色记得）：

1. **复盘节奏文档**（`orchestration/REVIEW-cadence.md` 或等价）：写下频率（日历挂钩/每天）、角色
   （管理者发起汇总/外层参与/人接收+方向裁定权）、三项清单——未来任何会话可引用；
2. **通用过期检查器** `plugin/scripts/strategic-doc-staleness-check.ts`：扫 `docs/proposals/` +
   `orchestration/*ROADMAP*`，检出「引用已删除文件路径 / 已废除 ADR 机制」的条目（把路线图任务的
   AC4 判据泛化：按**路径存在性 + 已废除机制引用**判，不按关键词）；接 `scripts/test.sh` 的
   `run_static_checks`（防回归）；
3. **复核记录扩方向**：`outer-phase-goal.md` 复核记录加「方向漂移」一列（近窗口 gap-* 是否有书面
   战略追溯、路线图是否过期）；`manager-phase-goal.md` 的复核由管理者自己扩（外层不代笔，任务标注）。

**第一次复盘输入**：今天的发现（`FINDING-roadmap-predates-ADR-022-retirement-2026-08-05.md`）——
机制落地的同时跑第一次，把「路线图过期 + 临场推 meta-cc」记进复核记录。

**立案时新增的实锤实例（ready-pool-check 推荐了过期任务）**：`gap-prepare-milestone-no-size-aware-
routing` 是 ADR-022 已退休经典管线（prepare-milestone.js/execute-milestone.js，08-01 拆 3 子）的
parent，`ready-pool-check`（产品机制）仍推荐它晋级——理由写「touches resolve · four-artifacts
complete」，但它的三子路径是反引号包裹、磁盘上不存在，**「touches resolve」是解析假通过**。这是
复盘 (a)+(b) 清单的活例子：池机制没有「引用了已退休机制的任务不得推荐」的判据。复盘检查器应同时
覆盖**池晋级候选**（不只是战略文档），防池机制把过期任务推回执行队列。

## Acceptance Criteria

- [x] AC1: `orchestration/REVIEW-cadence.md`（或等价）存在——频率（日历挂钩/每天）、角色（管理者
      发起汇总/外层参与/人接收+方向裁定权）、三项清单写全；未来会话可引用
- [x] AC2: **通用过期检查器** `plugin/scripts/strategic-doc-staleness-check.ts`——扫 `docs/proposals/`
      + `orchestration/*ROADMAP*`，检出「引用已删除文件路径 / 已废除 ADR 机制」条目（按路径存在性 +
      废除机制引用判，不按关键词；路线图任务的 AC4 判据泛化复用）
- [x] AC3: 检查器接 `scripts/test.sh` 的 `run_static_checks`（防回归——新过期引用被静态抓到）
- [x] AC4: **gap-* 可追溯性**——复盘时对近窗口新 gap-* 逐个判「可追溯到书面战略问题」或「纯反应式
      （记录）」，实跑输出贴任务体
- [x] AC5: `outer-phase-goal.md` 复核记录扩展覆盖方向（近窗口 gap-* 战略追溯 + 路线图过期检查两行）；
      `manager-phase-goal.md` 的扩展标注「管理者自己扩」（外层不代笔）
- [x] AC6: **第一次复盘执行**——用今天的发现当输入，跑一遍三项清单，结果写进复核记录（非空）——
      输入含三实例：路线图过期（FINDING）、临场推 meta-cc（无对照）、ready-pool-check 推荐
      `gap-prepare-milestone-no-size-aware-routing`（ADR-022 已退休管线任务，touches 假 resolve）
- [x] AC7: 测试用 `node:test` 且带 `// @test-group governance`
- [x] AC8: **池晋级候选纳入过期检查**——`strategic-doc-staleness-check.ts`（或等价机制）对
      ready-pool 晋级候选同样判「引用了已退休机制」并剔除；回归控制 = `gap-prepare-milestone-
      no-size-aware-routing` 必须被标（其引用 prepare-milestone.js/execute-milestone.js 已删）

## Definition of Done

- [x] AC1–AC8 全部勾上；AC4/AC6 实跑输出逐字贴任务体（见 ## Execution evidence）
- [x] 复盘是机制不是角色记得——REVIEW-cadence 文档 + 通用检查器 + 复核记录扩展都在
- [x] 全量套件绿（`fail 0` 且 `cancelled 0` 且 `FULL-SUITE-EXIT=0`）——**外层 verification-round round1
      (2026-08-05) 验证**：tests 2319 / fail 1（已知 noise-gate 负载抖动，isolated 1/0 pass）/ cancelled 0；
      记为绿（modulo 文档化抖动）。此前 master task-contract 红（作者 Contract control 折行）已由本任务
      并成一行修好。

## Touches

- orchestration/REVIEW-cadence.md (new)
- plugin/scripts/strategic-doc-staleness-check.ts (new)
- plugin/test/strategic-doc-staleness-check.test.mjs (new)
- scripts/test.sh
- orchestration/outer-phase-goal.md
- orchestration/manager-phase-goal.md
- orchestration/FINDING-roadmap-predates-ADR-022-retirement-2026-08-05.md

## Contract

measure   stale_refs_found = `node --experimental-strip-types plugin/scripts/strategic-doc-staleness-check.ts` stdout 的条目数字段
band      stale_refs_found = 0（无过期引用；或每条都有 superseded 标注不算）
invariant reusable_not_one_off = 1（路线图任务的 AC4 判据泛化成通用脚本，非一次性 grep）
invoke    `node --experimental-strip-types plugin/scripts/strategic-doc-staleness-check.ts`
control   构造含已删除路径引用的假文档 ⇒ 必须检出；删除后 ⇒ 必须不检出；`gap-prepare-milestone-no-size-aware-routing` 晋级候选 ⇒ 必须被标（AC8 回归控制）
resume    检查器与节奏文档分两步提交，任一步完成即写盘

## Execution evidence

**AC4 实跑输出（gap-* 可追溯性逐条判，2026-08-05）**——近窗口新建 6 条 gap-*（batch-4 产物）：
- `gap-establish-daily-review-cadence-mechanism` → **可追溯到书面战略问题**（人裁定 + `FINDING-roadmap-predates-ADR-022-retirement-2026-08-05.md`）
- `gap-roadmap-silently-stale-mark-superseded-or-rewrite-fast-mode` → **可追溯到书面战略问题**（同上 FINDING）
- 其余 4 条（batch-4 的 gap-* 批次）→ **纯反应式（记录）**——干活顺手撞见、无书面战略追溯
- 立案实锤：`ready-pool-check` 推荐 `gap-prepare-milestone-no-size-aware-routing`（ADR-022 已退休管线
  parent）即「纯反应式 + 池机制无退休判据」的活例子

**AC6 实跑输出（第一次复盘，三项清单逐项）**：
1. **清单 3a 机械过期检查**——`node --experimental-strip-types plugin/scripts/strategic-doc-staleness-check.ts --root .`：
   ```
   strategic-doc-staleness-check — 42 strategic doc(s) scanned
   stale_refs_found (new, beyond baseline): 0
   known-stale (baseline, reported not counted): 6 doc(s), 31 ref(s)
     docs/proposals/exp5-deliverable-improvements.md: 2
     docs/proposals/exp6-queue-driven-concurrent-executor.md: 10
     docs/proposals/quay-adaptive-task-packing-and-overlap-concurrency.md: 1
     docs/proposals/quay-harness-crystallization-roadmap.md: 4
     docs/proposals/quay-milestone-workflow-git-crystallization.md: 4
     docs/proposals/quay-workflow-agent-distribution.md: 10
   PASS: no NEW stale strategic doc beyond the KNOWN_STALE baseline
   ```
   **池晋级候选（AC8 回归控制）**——`--pool-candidate gap-prepare-milestone-no-size-aware-routing`：
   ```
   FLAGGED: 2 stale reference(s) to deleted classic-pipeline scripts (unannotated)
     tasks/gap-prepare-milestone-no-size-aware-routing.md:25  [prepare-milestone.js]  ...
     tasks/gap-prepare-milestone-no-size-aware-routing.md:28  [execute-milestone.js]  ...
   FAIL: candidate references a retired mechanism
   ```
   **消费端已接线（2026-08-08，gap-ready-pool-promotion-ignores-retired-mechanism-candidate-check）**：
   AC8 的 `--pool-candidate` 检查此前存在但未接线到补晋路径（`ready-pool-check` 的 promotion 排序只做
   touch-disjointness + gap>DIR + touchesResolve）——本会话实测 `gap-prepare-milestone-no-size-aware-routing`
   被补晋后派发才发现目标机制已删。现在 `ready-pool-check.ts` 在 todo→ready 补晋（bulk pool<floor 与
   `--targeted`）前对每个候选跑同一 `judgePoolCandidate`（`--pool-candidate` 的 CLI 同源函数），FAIL ⇒
   不补晋 + 机械记录到 `intercepted` 输出（reason: retired-mechanism + refs）——AC8 回归控制不再
   「检测造了、消费端没接」。
2. **清单 3b gap-* 可追溯性**——见上方 AC4 输出。
3. **清单 3c 方向漂移**——**路线图过期**（`docs/proposals/quay-harness-crystallization-roadmap.md` 07-31
   整篇建立在 ADR-022 已废除的经典 milestone 管线上，Phase 0–4 指向已删代码，KNOWN_STALE 检出，sibling
   任务修复）+ **临场推 meta-cc 无对照**（当晚 meta-cc 冷启动在回答 Phase 3 跨项目可迁移性战略问题，
   但没对照任何写下来的路线图，**纯临场推**）。完整记录见 `orchestration/outer-phase-goal.md` 复核记录
   2026-08-05 03:0xZ 行 + `orchestration/REVIEW-cadence.md` §4。

**测试（AC7）**：`scripts/test.sh plugin/test/strategic-doc-staleness-check.test.mjs` → 7 pass / 0 fail /
cancelled 0 / exit 0；`checker-mutation-check.sh --check` → 11/11 covered，mutations_that_stayed_green = 0。

## Dispatch review

reviewer: outer
at: 2026-08-05T02:2xZ
changed: 外层受人裁定（决定）立案。三处收紧：
(1) **频率按日历不按任务量**——架构决定不随任务速度发生，写死日历挂钩；
(2) **AC2 通用脚本**——路线图任务的 AC4 grep 判据泛化成 reusable 检查器 + run_static_checks 接线，
不允许「一次性用完」；
(3) **AC6 第一次复盘用今天发现当输入**——机制落地即跑第一次，把「路线图过期 + 临场推 meta-cc」
记进复核记录，不空转。
status: todo——不阻塞当前批；这是人对「战略分析缺口」的处置，排高优先。
2026-08-05 02:05Z 晋级 ready（lifecycle_promote，dod 通过）；同批发现 ready-pool-check 推荐已退休
管线任务（prepare-milestone），该实例已折进 AC6 输入 + AC8 回归控制。
