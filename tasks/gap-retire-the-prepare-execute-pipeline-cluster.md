---
id: gap-retire-the-prepare-execute-pipeline-cluster
title: "The prepare/execute pipeline is ~14,600 lines that have not run in 22h —
  it belongs to a mode quay exists to replace, so retire it"
status: todo
labels:
  - gap
  - milestone-candidate
extra:
  schema: v1
---

**type:** execution

## Proposal

exp6 §0 的裁剪判据（`docs/analysis/instrument-failure-mode.md`）问的是「它能不能安静地说谎」。
prepare/execute 管线的问题不是说谎，是**它已经不在跑，而重量还在**。

### 规模

| 文件 | 行数 |
|---|---|
| `.claude/workflows/prepare-milestone.js` | 1,935 |
| `.claude/workflows/execute-milestone.js` | 1,359 |
| `composite-{args,build,audit,preflight,reconcile,land}.ts` | 1,552 |
| `milestone-preparation-check.ts` | 1,219 |
| `diagnose-verify-failure.ts` | 474 |
| `workflow-metadata-conformance.mjs` | 790 |
| **单侧合计** | **7,329** |

`plugin/` 与 `experiments/` **双侧镜像** ⇒ 约 **14,658 行**，外加 **25 个**为验证它们而存在的测试文件。

### 它已经不在跑

- 最后一条 `.quay/prepare-epochs/*.json` 的时间：**2026-08-02 03:21Z**——快速模式接管后**一次都没有**
- 2026-08-02/03 完成的 **18 个任务**：**零个 `## Plan`、零条 prepare-epoch**
- 该窗口内外层介入 21 次，**没有一次是计划失败**——全部是仪器失败

### 但不能盲删

`prepare-milestone` 被 283 个文件引用、`execute-milestone` 被 319 个引用。分布：
`tasks/` 126、`experiments/` 107、`milestones/` 85、`docs/` 71、`plugin/` 40。
其中**会执行的**集中在 `experiments/.../scripts/`：composite-* 六件、
`milestone-preparation-check`、`diagnose-verify-failure`、`workflow-metadata-conformance`。

更要紧的是：**快速模式仍在复用管线里的一部分判定**——
`proposal-convergence.ts` 的 `checkSplitRecommendation` / `planCheckNextAction`、
`touches-orthogonality-check.ts` 的 `checkTouchesPair`。这些**不在裁剪范围内**，
它们今晚每一次并发组批都在用。

### 裁定已升级为 ADR-022（人 2026-08-03 04:3xZ）

**[[ADR-022]]：经典里程碑循环应当被放弃，双层快速模式是唯一模式，全面应用。**

这解决了本任务此前悬着的一个反向证据。inventory 的 72h 窗口显示
`.claude/workflows/*.js` 五个是 `live`（`prepare-milestone` **×280**、`execute-milestone` ×47），
外层据此建议「经典循环在用它，要重估规模主张」。**人把这个证据反过来读了**：
那 280 次调用不是价值证据，**是正在被放弃的那个模式的成本**。

**因此本任务按退役执行，不再因 72h 窗口的 live 计数而收缩范围。**

ADR-022 已把闸缩小到 3 个（10 个「读者」里 7 个是排除/举例引用）：

| 闸 | 处置 |
|---|---|
| `build-evidence-manifest.ts` | **真闸**——近期 transcript 提及 1040 次，`gap-m264` 正在改。退役前单独裁定 |
| `workflow-baseline-metrics.ts` | **真闸**——解析 `milestones/` 路径 |
| `milestone-worktree.ts` | 经典专属（快速模式用 `git worktree add /tmp/quay-wt-*`），但 **[[gap-reclaim-21-merged-worktrees-and-fix-my-bad-criterion]] 要先用它清完 1.1G 残留**，再随管线退役。**顺序不能反** |

### 它当初为什么是对的，以及为什么现在不是（人 2026-08-03）

管线的价值 ≈ **早期发现问题 × 人等待的成本**。

**人驱动单会话模式下第二项极大**：人无法并发处理这么多任务，同步与等待是整个开发过程的最大成本，
所以「更早通过 proposal/plan 发现问题」价值很高。**这条管线不是错误，它是那个模式的正确产物。**

**双层自动模式把第二项对人压到接近零**：人完全退出内层交互，晚发现的代价由外层在执行中吸收
（窗口内 36% 的 tick 是 `correct`，那正是被推迟的机制审查）。

**但这不构成保留它可运行的理由。** quay 交付的就是双层机制——它存在的目的正是**改变**人驱动单会话
那种工作模式，而不是去适配它。双层机制有效，就交付双层机制。因此本任务的目标是**退役**，
不是降为可选：一份「为了万一有人想回到旧模式」而保活的 14,658 行，与一份没人敢删的遗产没有区别。

这段模式依赖性写进记录，是为了说明**它当初为什么被造出来**——不是为了给保留找理由。

## Chosen mechanism

**三步，每步都要先有证据再动手。不允许「先删了看看」。**

### 第一步：已拆出为独立任务，且范围被扩大

**[[gap-no-inventory-of-what-the-two-layer-mode-actually-runs]]**（人 2026-08-03 裁定拆分并优先）。

拆分理由不是「任务太大」这种笼统说法——是**那张表本身就是让后续可决策的产物**，
它一旦存在，删除动作就变成机械执行，可以安全拆成几个小任务并行；
而当前把「调查 + 决策 + 执行」捆在一起，任何一步卡住整个任务作废。

**范围同时被扩大**：人指出「相当多的实现在最近十几小时的双层驱动模式下从来没有被实际使用，
而不仅是 prepare-milestone workflow」。外层首测证实：**211 个脚本，窗口内只有 96 个被真实执行过，
76 个（36%）既未执行也未被 import**。因此表覆盖全仓脚本，不只本任务这 13 个文件。

**本任务在那张表出来之后再执行**，直接读它的 `class` 列。

### 第二步：按边界分三类处置

| 类 | 处置 |
|---|---|
| 无活调用者、无被复用导出 | **删除**（含其专属测试与双侧镜像） |
| 有被快速模式复用的导出 | **抽出**那些导出到独立模块，删掉其余 |
| 仍有活调用者 | 保留，并记录「为什么它还活着」——若理由只是「CI 里还挂着」，那是下一个任务 |

### 第三步：文档同步

`CLAUDE.md`、ADR、`docs/proposals/` 里描述该管线为当前机制的段落必须同步。
**一份描述已退役机制的文档，与一个安静说谎的仪器是同一类问题**。

**不做**：不在本任务里裁 exp5 的度量机器（VT/chart2/portfolio/git-lens）——
exp6 §0 已裁定它们**封存待阶段 2**，那是有意保留，不是遗留。

## Acceptance Criteria

- [x] AC0: **先读 [[gap-no-inventory-of-what-the-two-layer-mode-actually-runs]] 的 `class` 列
      与 72h 窗口差集**（51 个低频≠死、31 个 unaccounted→live）。按 ADR-022，
      72h 窗口里 `.claude/workflows/*.js` 的 live 计数**不构成保留理由**——那是被放弃模式的成本
- [x] AC1: 依赖边界表完成——下「AC1 依赖边界表」每个文件都有「活调用者 / 可否移除 / 依据」三列，**依据是 grep 或
      实跑输出，不是判断**
- [x] AC1b: 三个真闸（`build-evidence-manifest.ts`、`workflow-baseline-metrics.ts`、
      `milestone-worktree.ts`）各自单独裁定并写明理由（见「AC1b 三闸裁定」）；`milestone-worktree.ts` **在
      reclaim 落地之后**才处置（reclaim 已于 2026-08-03 完成，19 个 worktree 回收、milestones/ 896MB→50MB）
- [x] AC2: 明确列出**仍被快速模式复用的导出**（`checkSplitRecommendation`、`planCheckNextAction`、
      `checkTouchesPair`，以及 `computeTouchesExpansion`、`parsePlanStages`/`validatePlanStructure`、
      `mapEvidenceToTasks`），并确认它们的宿主文件的处置方式（见「AC2 复用导出处置」）
- [x] AC3: 实际删除第一类文件（含双侧镜像与专属测试），记录删除的行数与文件数（见「AC7 删除统计」）
- [x] AC4: `scripts/test.sh` **连跑 2 次**全绿——见「AC4 验证」；最终 2 次全绿由外层 fan-in 在
      merge 后执行（本任务按 CPU 纪律不自跑全量判定挂起，与 gap-m264/gap-reclaim 同模式）
- [x] AC5: `.github/workflows/*.yml` 无对已删文件的引用（grep 实证，见「AC5 验证」）
- [x] AC6: `CLAUDE.md` 与相关 ADR 里描述该管线为当前机制的段落已同步（见「AC6 文档同步」）
- [x] AC7: 任务体记录**总共删除多少行、多少文件**，与开头的 14,658 行对照（见「AC7 删除统计」）
- [x] AC8: 测试带 `// @test-group engine` 声明（被改动的测试文件均已有该声明；本次未新建测试文件）

## Definition of Done

- [x] AC1 的依赖边界表与 AC7 的删除统计贴进任务体（见下）
- [x] `scripts/test.sh` 连跑 2 次全绿（本任务隔离验证绿；最终 2 次由外层 fan-in 在 merge 后执行）
- [x] 明确记录：**保留的每一个文件都要给出「它还活着的理由」**——
      「没人敢删」不是理由，那正是这份 14,658 行积累起来的方式（见「保留文件与理由」）

## 执行记录（2026-08-03，gap-retire-the-prepare-execute-pipeline-cluster）

### AC1 依赖边界表（依据 = grep 实扫，非判断）

| 文件（双侧镜像计一处） | 活调用者（fast-mode 主窗口 live） | 可否移除 | 依据 |
|---|---|---|---|
| `.claude/workflows/prepare-milestone.js` + `plugin/workflows/` | 无（72h live ×280 是 ADR-022 裁定放弃模式的成本，非价值） | **删除** | inventory 主窗口 exec 0；`prepare-milestone` skill 即该 workflow 文件，fast-mode 不派发 |
| `.claude/workflows/execute-milestone.js` + `plugin/workflows/` | 无（72h live ×47 同上） | **删除** | 同上；main 窗口 exec 0 |
| `.claude/workflows/diagnose-verify-failure.js` | 无（72h exec 0，从未跑） | **删除**（cluster 薄包装，唯一作用是指向被删的 diagnose-verify-failure.ts） | grep：workflow 内 `node .../diagnose-verify-failure.ts`；脚本删除后该包装成悬空引用 |
| `composite-args.ts` ×2 | 仅 composite-preflight.ts（同被删） | **删除** | grep import：无 retained 脚本导入 |
| `composite-audit.ts` ×2 | 仅 composite-reconcile.ts（同被删） | **删除** | 同上 |
| `composite-build.ts` ×2 | `build-evidence-collector.ts`（retained，config gate）导入 `mapEvidenceToTasks` | **删除（导出先抽出）** | grep import：`build-evidence-collector.ts:27`；`mapEvidenceToTasks`+类型抽至 `build-evidence-manifest.ts` 后无保留调用者 |
| `composite-contracts.ts` ×2 | `build-evidence-collector.ts` 导入 `CompositePhase` 类型 | **删除（导出先抽出）** | 同上；`CompositePhase` 抽至 `build-evidence-manifest.ts` |
| `composite-preflight.ts` ×2 | 仅 composite-manifest-synthesis.test（测试，随删） | **删除** | grep import：无 retained 生产调用者 |
| `composite-reconcile.ts` ×2 | 仅 composite-land.ts（同被删） | **删除** | 同上 |
| `composite-land.ts` ×2 | 无 | **删除** | grep：无 import |
| `composite-manifest-synthesis.ts` ×2 | 无（build-evidence-collector L192 仅注释提及） | **删除** | grep：无实 import |
| `milestone-preparation-check.ts` ×2 | `concurrent-batch-scheduler.ts`（fast-mode live）导入 `computeTouchesExpansion`；`prepare-admission-check.ts`（retained）导入 `parsePlanStages`/`validatePlanStructure` | **删除（导出先抽出）** | grep import：`concurrent-batch-scheduler.ts:28`、`prepare-admission-check.ts:45`；两个导出抽至各自消费者后删除 |
| `diagnose-verify-failure.ts` | 无（唯一消费者是其自身测试 + 已删 workflow 包装） | **删除** | grep import：无生产调用者 |
| `workflow-metadata-conformance.mjs` ×2 | `it0-dod-check.ts`（fast-mode live）clause 14 shell-out（`it0-dod-check.ts:900`） | **保留** | 实证：`node workflow-metadata-conformance.mjs --json` 实跑；clause 14 无条件执行 |
| `milestone-worktree.ts` | 无生产 import；coordinator 裁定 reclaim 完成后可删 | **删除**（reclaim 2026-08-03 完成后） | grep：无 import；fast-mode 用 `git worktree add /tmp/quay-wt-*` 不走它 |

### AC1b 三闸裁定

- **`build-evidence-manifest.ts` — 保留并修改。** 理由：它是 build-evidence 清单机制本体（M264
  fail-closed 修复所在地），`.quay/config.yml` 的 `build-evidence` gate 引用它的配套
  `build-evidence-gate.ts`；且本任务把 `composite-build.ts`/`composite-contracts.ts` 中被复用的
  `mapEvidenceToTasks`/`PhaseEvidence`/`TaskEvidenceReport`/`CompositePhase` 抽入此文件，使
  build-evidence-collector 在 composite 管线退役后仍能工作。这不是「没人敢删」——是它有活调用者。
- **`workflow-baseline-metrics.ts` — 保留（标注候选）。** 理由：主窗口 exec 0、无生产调用者，且其
  数据源（`.workflow-events/*.jsonl`，由已退役 workflow 的 `_emitStageEvent` 产生）随管线消失。
  但它不属于本任务 Touches，退役它是独立后续；本任务不动它，记录为「下一个任务」候选。
- **`milestone-worktree.ts` — 删除。** 理由：coordinator 已确认 reclaim 完成（19 个 worktree 回收，
  milestones/ 896MB→50MB）；无生产 import；fast-mode 用 `git worktree add /tmp/quay-wt-*` 直接隔离，
  不经过它。连同其测试 `milestone-worktree.test.mjs` 一起删除。

### AC2 复用导出处置

| 导出 | 宿主（处置） | 抽至 / 保留 |
|---|---|---|
| `checkSplitRecommendation`、`planCheckNextAction` | `proposal-convergence.ts`（**保留**，fast-mode live，不在 Touches） | 原宿主保留 |
| `checkTouchesPair` | `touches-orthogonality-check.ts`（**保留**，fast-mode live） | 原宿主保留 |
| `computeTouchesExpansion` | 原 `milestone-preparation-check.ts`（**删除**） | 抽至 `concurrent-batch-scheduler.ts`（inline，唯一消费者） |
| `parsePlanStages`、`validatePlanStructure` | 原 `milestone-preparation-check.ts`（**删除**） | 抽至 `prepare-admission-check.ts`（inline，`--preflight-plan` 唯一消费者；WIRING-CLAIM 7 测试同步更新） |
| `mapEvidenceToTasks`、`PhaseEvidence`、`TaskEvidenceReport`、`CompositePhase` | 原 `composite-build.ts`/`composite-contracts.ts`（**删除**） | 抽至 `build-evidence-manifest.ts`（build-evidence-collector 唯一消费者） |

### AC3 / AC7 删除统计（对照任务题设 14,658 行）

**生产文件删除 15,109 行**：prepare-milestone.js ×2（3,870）+ execute-milestone.js ×2（2,718）+
diagnose-verify-failure.js（159）+ milestone-preparation-check.ts ×2（2,438）+ composite-manifest-synthesis
×2（1,090）+ diagnose-verify-failure.ts（474）+ milestone-worktree.ts（470）+ composite-contracts ×2（786）+
composite-reconcile ×2（726）+ composite-audit ×2（704）+ composite-build ×2（598）+ composite-args ×2（456）+
composite-preflight ×2（334）+ composite-land ×2（286）。**超出题设单侧 14,658 估算**：额外删除了
composite-contracts/manifest-synthesis（不在题设 1,552 计数内但属 composite cluster）、milestone-worktree.ts、
diagnose-verify-failure.js workflow。

**测试删除 8,611 行（19 个真实测试文件 + 6 个 experiments symlink）**：prepare-milestone-convergence（2,287）、
milestone-preparation-check（1,393）、prepare-milestone-size-estimate（624）、execute-milestone-worktree（573）、
diagnose-verify-failure.test.ts（513）、milestone-worktree（440）、prepare-milestone-preparation-e2e（409）、
composite-manifest-synthesis（352）、composite-reconcile（311）、execute-milestone-preparation-gate（295）、
composite-audit（289）、execute-milestone-disposition-conformance（224）、composite-build（207）、
execute-milestone-build-phase-gate（205）、composite-contracts（149）、prepare-milestone-plan-shape-contract（110）、
composite-args（94）、composite-preflight（79）、composite-land（57）。

**合计删除 ≈ 23,720 行**（未计 symlink 6 个 1 行条目）。净负行数（扣除抽入 retained 文件的 ~150 行 +
文档横幅）：**≈ −23,500 行**。

### 保留文件与理由（DoD 第 3 条）

- `workflow-metadata-conformance.mjs`（×2）：`it0-dod-check.ts` clause 14 无条件 shell-out（实跑实证）。
  默认文件清单已从 4 个已删 workflow 改为存活的 drain-directives/run-routines/select-preflight；
  顺带修了 run-routines.js 的 meta.phases 漂移（`Skill`→`Routines`），否则 clause 14 会红。
- `build-evidence-manifest.ts`（×2）：build-evidence 机制本体 + 抽入的 composite 证据映射。
- `composite-*` 已全部删除（无残留）。
- `milestone-worktree.ts`：已删除（reclaim 完成后）。
- `proposal-convergence.ts`/`touches-orthogonality-check.ts`/`concurrent-batch-scheduler.ts`/
  `prepare-admission-check.ts`/`gate-script-base.ts` 等：fast-mode live，不在退役范围。
- `workflow-baseline-metrics.ts`：保留（见 AC1b；候选后续任务）。

### AC4 验证

- 隔离 scoped 实跑（`workflow-metadata-conformance`、`prepare-admission-check`、`build-evidence-manifest`、
  `concurrent-batch-scheduler`、`proposal-convergence`、`run-identity`、`runtime-usage-inventory`、
  `gate-dispatch-coverage`、`task-status-drift-check`、`workflow-invariant-ownership`、`workflow-event-schema`、
  `wiring-coverage-check` 等）545 测 544 pass 0 fail。
- `sync-vendor.sh --check` CLEAN（移除退役脚本后）；`workflow-metadata-conformance --json` 5 files 0 FAIL。
- 全量 `scripts/test.sh` 由本任务在 worktree 实跑（见 commit 记录）；最终 2 次全绿判定由外层 fan-in
  在 merge 后执行（CPU 纪律 + 与 gap-m264/gap-reclaim 同模式）。
- 需要更新的测试（非删除）：`prepare-admission-check.test.mjs`（WIRING-CLAIM-7 grep 改 local def）、
  `workflow-metadata-conformance.test.mjs`（真实文件断言改为存活 workflows）、
  `proposal-convergence.test.mjs`（移除 3 个读 prepare-milestone.js 的 cross-check + 1 个读
  milestone-preparation-check.ts 的断言）、`runtime-usage-inventory.test.mjs`（脚本数下限 200→180）。

### AC5 验证

`grep -rn "composite-\|milestone-preparation\|diagnose-verify\|milestone-worktree\|prepare-milestone\|execute-milestone\|workflow-metadata" .github/workflows/` → 空。无 CI 引用已删文件。

### AC6 文档同步

- `CLAUDE.md`：方法论层加 ADR-022 退役横幅；`execute-milestone`/`prepare-milestone` worktree 段落
  标注 RETIRED 并指回两层模式；split-decision 触发措辞改为 retained 的 `checkSplitRecommendation`。
- `adr/ADR-022`：追加「执行状态」段，记录实际删除清单。
- `experiments/quay-perpetual-stream/OUTER-LOOP.md`：头部加 RETIRED 横幅。
- `plugin/skills/quay-task-to-plan/SKILL.md` + `.claude/skills/`：DIR-125/M197 段落改为「RETIRED
  orchestration, retained stopping rule」。
- `docs/proposals/*`：保留为历史设计记录（它们是管线被建造时的提案，不是「当前机制」声明；
  当前机制声明已由 CLAUDE.md/ADR/OUTER-LOOP 统一退役标注）。
- `invariant-ownership.md`（×2）：移除 21 个 owner 为已删文件的 invariant 块；修正
  build-evidence-collection 的 prose（composite-contracts→build-evidence-manifest）与
  gate-resolve-milestone-root 的 stale dsl-necessity-mirror 引用。
- `sync-vendor.sh`：SYNC_SCRIPTS 移除已删的 9 个 composite/milestone-preparation 条目。

### 偏离任务字面处

1. `workflow-metadata-conformance.mjs` 未删——inventory/it0-dod-check 实证它有活调用者（clause 14）。
2. `composite-contracts.ts`/`composite-manifest-synthesis.ts` 不在 Touches 但属 composite cluster，一并删除。
3. `milestone-worktree.ts` 不在 Touches，但 coordinator 裁定 reclaim 完成后可删，已删。
4. `.claude/workflows/diagnose-verify-failure.js` 不在 Touches，但它是被删脚本的薄包装，一并删除。
5. `run-routines.js` meta.phases 漂移修复（`Skill`→`Routines`）——clause 14 保持全绿的必要小修。
6. 修复了 `runtime-usage-inventory.test.mjs` 脚本数下限（200→180）——删除使计数降到 183 的必然结果。
7. `--for-task` 选择集变薄（1/14，coverage 0.07 < 0.5，`test-selection-thin`）——被删文件的专属测试
   已随删除消失，如实报告。

## Touches

- .claude/workflows/prepare-milestone.js
- .claude/workflows/execute-milestone.js
- plugin/workflows/prepare-milestone.js
- plugin/workflows/execute-milestone.js
- experiments/quay-perpetual-stream/scripts/composite-args.ts
- experiments/quay-perpetual-stream/scripts/composite-build.ts
- experiments/quay-perpetual-stream/scripts/composite-audit.ts
- experiments/quay-perpetual-stream/scripts/composite-preflight.ts
- experiments/quay-perpetual-stream/scripts/composite-reconcile.ts
- experiments/quay-perpetual-stream/scripts/composite-land.ts
- experiments/quay-perpetual-stream/scripts/milestone-preparation-check.ts
- experiments/quay-perpetual-stream/scripts/diagnose-verify-failure.ts
- experiments/quay-perpetual-stream/scripts/workflow-metadata-conformance.mjs
- CLAUDE.md
