# 快速模式执行 Prompt

**用法：** 在 `/home/yale/work/quay` 启动一个新的 Claude Code 会话，把下面 `---` 之间的全部内容作为首条消息粘贴进去。

---

你在 `/home/yale/work/quay` 工作。按**快速模式**执行下列任务——不使用 `prepare-milestone` / `execute-milestone` workflow，直接实现。

## 为什么是快速模式

232 次真实 prepare-milestone dispatch 的遥测：成功率 6.9%，73.5 小时 wall-clock 只有 12.1 小时产出可用收据。两个散文审查阶段（ProposalReview + PlanCheck）占 55%，且 PlanCheck 93% 用满 3 轮、79% 失败——因为审查对象是散文，缺陷无界，收敛判据不可达。

对照 7 月 31 日：13 次内联对抗审查，全部收敛。差别只有一个——**审查对象是已写好的代码 + 真实测试输出，判据有界**。

依据 `adr/ADR-021-adaptive-budget-self-regulating-methodology.md` 和 `docs/analysis/prepare-pipeline-reduction-plan.md`。

## 执行纪律

每个任务按这个循环：

1. **读任务文件** `tasks/<id>.md` 的 `## Proposal` / `## Acceptance Criteria` / `## Touches`
2. **读真实代码**——不要从任务描述推断现状。任务体可能过时（下面「已知陷阱」有实例）
3. **实现**——先写测试（RED），再实现，再跑测试（GREEN）
4. **对抗审查**：实现完成后，用 `Agent` 起一个**独立的**审查子代理，让它**尝试反驳**你的实现（不是让它确认）。它必须自己跑测试、自己读代码，不能只读你的总结
5. **修**审查发现的真实问题，需要就再来一轮。收敛判据：审查者跑完测试后找不出真实缺陷
6. **同步镜像**（见下）
7. **跑测试**（见下）
8. **关闭任务状态**（见下）
9. **提交**

## 硬性约束

**镜像字节一致。** 这些成对文件必须 `cmp` 干净：

| 单一来源 | 镜像 |
|---|---|
| `experiments/quay-perpetual-stream/scripts/*.ts` | `plugin/scripts/*.ts` |
| `.claude/workflows/*.js` | `plugin/workflows/*.js` |
| `experiments/quay-perpetual-stream/test/*.test.mjs` | `plugin/test/*.test.mjs`（仅当该测试确实需要在 CI 跑） |

改完必用 `cmp -s A B && echo OK || echo DIFF` 验证。

**测试基线。** `scripts/test.sh` 当前有 **18 个预先存在的失败**，全部在这些未受影响的表面：gate engine（M63 / Section 1 / Section 4 / DIR-120 Phase 2）、adr list（E3 A4）、sync-vendor（M136 / DIR-070-B）、execute-milestone worktree（GOLDEN REPLAY / WORKTREE MODE）、size-estimate。**不要去修它们**，它们不在本批任务范围内。你的任务只需保证：不新增失败。

验证方法：改动前后各跑一次 `scripts/test.sh`，比较失败数。若增加了，是你引入的。

**测试文件放哪。** `scripts/test.sh` 的 glob 只覆盖 `packages/*/test/*.test.mjs` 和 `plugin/test/*.test.mjs`。放在 `experiments/quay-perpetual-stream/test/` 的测试**不会在 CI 跑**。需要 CI 覆盖就放 `plugin/test/`。若两处都放，注意 repo root 深度不同（`plugin/test/` 是 2 层，`experiments/.../test/` 是 3 层）——用向上查找标记目录的方式求根，别硬编码层数。

**关闭任务状态。** 这是当前流程的真实缺口：直接执行时没有任何机制更新任务状态，我刚发现 7 个任务的代码已在树里但 status 仍是 `todo`。你必须手动改 `tasks/<id>.md` 的 `status:`：

- 全部 AC 已由测试证明 → `done`
- 代码完成但某条 AC 要求「真实 dispatch 验证」→ `ready`（不是 `done`）

## 已知陷阱

**任务体可能与代码不符。** 实例：`gap-planauthor-shape-rules-not-injected` 原本写「stage 格式没注入 PlanAuthor」——读代码发现格式**早就注入了**，真正缺的是另外两个约束。任务描述被修正后实现才正确。**先读代码，发现不符就先修任务体，再实现。**

**不要为了让测试通过而放宽断言。** 若已有测试与你的改动冲突，判断哪个是对的：若测试编码的是你正在改变的旧行为，改测试并在 commit message 说明；若测试是对的，改你的实现。

## 任务清单（按此顺序）

### 1. `gap-extract-mechanism-claims-calibration` ⭐ 先做这个

`extractMechanismClaims`（`experiments/quay-perpetual-stream/scripts/wiring-coverage-check.ts`）是收缩后 prepare 仅存三项机械确认之一的基础，当前**两个方向都错**。我已实测：

| 任务 | 真实机制数 | 提取数 | 偏差 |
|---|---|---|---|
| DIR-124-A1b | 1 | **24** | 过计 24× |
| DIR-124-A4 | 1 | **18** | 过计 18× |
| DIR-126-D | 1 | **21** | 过计 21× |
| DIR-124-A | 5 | **22** | 过计 4.4× |
| DIR-124-B | 4 | **2** | **欠计——真该拆的没拆** |

复现脚本（直接可跑）：

```js
const R = "/home/yale/work/quay";
const { extractMechanismClaims } = await import(`${R}/experiments/quay-perpetual-stream/scripts/wiring-coverage-check.ts`);
const { extractSection } = await import(`${R}/experiments/quay-perpetual-stream/scripts/task-schema.ts`);
// 对 tasks/<id>.md 取 ## Proposal，喂给 extractMechanismClaims，数长度
```

注意函数里已有一个 `_patternKey` 的 RC1 合并逻辑（别的会话加的），**它不够**——上表就是加了它之后的结果。欠计的 DIR-124-B 尤其要小心：修过计时不要把真正独立的机制也合并掉。

任务体的 AC 已列出这 5 个校准目标。上表的实测数字请写进任务体作为 grounded fact。

### 2. `DIR-124-F-plancheck`

PlanCheck 输出 schema 从标量 `{findings: number}` 扩展为带 `classification` 的类型化数组。这是让 `planCheckNextAction` 的 blocking-only 判据发挥全部效力的前提——当前走标量回退路径。

相关代码已落地：`proposal-convergence.ts` 的 `planCheckNextAction`，`.claude/workflows/prepare-milestone.js` 的 `_planCheckNextActionInline` 和 PlanCheck 循环（agent schema 已含 `blocking` 字段）。你要做的是让 `classification` 也типизирован并流到收据。

### 3. `DIR-124-A1b`

1 个机制：在 8 个阶段边界发射 stage event。A1a（`workflow-event-schema.mjs`）已完成，直接引用。任务体已重分类并补了 10 条 AC。

### 4. `DIR-124-A4`

1 个机制：`workflow-metadata-conformance.mjs` 一致性检查脚本 + DoD clause 13。任务体已补 11 条 AC。注意它的 8 个 WIRING-CLAIM 是同一脚本的实现细节，不是 8 个机制。

### 5. `DIR-124-B1`

RunIdentity 铸造。8 AC / 235 行。DIR-124-B 的 4 路拆分是正确拆分，B1 无依赖可直接做。

### 6. `gap-build-evidence-manifest-missing`（status 已是 `ready`）

余下 2 个机制（per-phase 证据消费、git 失败 fail-soft）。机制 1（输出路径）已在 `2b1d67c2` 提交。

## 提交

每个任务独立提交。commit message 说明：改了什么机制、测试证据、镜像已同步、任务状态改成了什么。不要把多个任务挤进一个 commit。

## 开始前

先跑一次 `scripts/test.sh` 记下失败数作为基线（应该是 18）。然后从任务 1 开始。

---

## 附：本批任务的上下文来源

| 文档 | 内容 |
|---|---|
| `adr/ADR-021-adaptive-budget-self-regulating-methodology.md` | 四项原则：元机制更简单、Phase 0 优先、数据校准、按代码路由 |
| `docs/analysis/prepare-pipeline-reduction-plan.md` | 收缩方案、量化依据、任务调整 |
| `docs/analysis/prepare-pipeline-cost-and-split-containment.md` | 232 条遥测的成本分解 |
| `docs/analysis/split-correctness-review.md` | 9 次拆分只有 2 次正确的逐任务分析 |
| commit `4f8495a7` | 已落地的 5 项机制（递归守卫、拆分终局性、blocking-only、收益递减、约束注入） |
| commit `5f20d228` | 遥测归档 + 任务调整 |
