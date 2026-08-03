---
id: gap-retire-the-prepare-execute-pipeline-cluster
title: "The prepare/execute pipeline cluster is ~14,600 lines and has not run
  in 22 hours — decide its fate on evidence, then act"
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

## Chosen mechanism

**三步，每步都要先有证据再动手。不允许「先删了看看」。**

### 第一步：画出真实依赖边界（本任务的主要产出）

对上表每个文件，逐个回答：

1. 是否有**活的调用者**（CI、`scripts/`、其它非归档脚本）？还是只被文档/任务体/里程碑归档提及？
2. 它导出的函数里，哪些**仍被快速模式使用**（如 `checkSplitRecommendation`）？
3. 删掉它会让哪些测试失效？那些测试是在测它，还是在测别的东西而顺带用到它？

**输出一张表**：文件 → 活调用者 → 可否移除 → 依据。

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

- [ ] AC1: 依赖边界表完成——上表每个文件都有「活调用者 / 可否移除 / 依据」三列，**依据是 grep 或
      实跑输出，不是判断**
- [ ] AC2: 明确列出**仍被快速模式复用的导出**（至少已知 `checkSplitRecommendation`、
      `planCheckNextAction`、`checkTouchesPair`），并确认它们的宿主文件的处置方式
- [ ] AC3: 实际删除第一类文件（含双侧镜像与专属测试），记录删除的行数与文件数
- [ ] AC4: `scripts/test.sh` **连跑 2 次**全绿——删除不得留下断引用
- [ ] AC5: `.github/workflows/*.yml` 无对已删文件的引用
- [ ] AC6: `CLAUDE.md` 与相关 ADR 里描述该管线为当前机制的段落已同步；若管线保留则说明理由
- [ ] AC7: 任务体记录**总共删除多少行**，与本任务体开头的 14,658 行对照
- [ ] AC8: 测试带 `// @test-group engine` 声明

## Definition of Done

- [ ] AC1 的依赖边界表与 AC7 的删除统计贴进任务体
- [ ] `scripts/test.sh` 连跑 2 次全绿
- [ ] 明确记录：**保留的每一个文件都要给出「它还活着的理由」**——
      「没人敢删」不是理由，那正是这份 14,658 行积累起来的方式

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
