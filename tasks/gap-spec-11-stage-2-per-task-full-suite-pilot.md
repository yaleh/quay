---
id: gap-spec-11-stage-2-per-task-full-suite-pilot
title: SPEC §11 阶段 2 per-task 全量试点——停跑全局轮的唯一前置，消解 AC43/AC45（26% 代码为全局共享轮存在，试点成立即取消非实现）
status: ready
labels:
  - gap
  - exploration
  - mechanism
parent: null
children: []
extra:
  schema: execution
---
**type:** execution

## Proposal

**SPEC §11 阶段 2（per-task 全量试点）当前零任务——它是外层停跑全局轮的唯一前置，同时消解 AC43/AC45 的大部分、给 AC46「pool 可取消」提供前提（manager 2026-08-13 结构分析 + 阶段 AC 覆盖分析，裁定权 outer）。**

**结构事实（manager 11:2x 结构分析）**：15 个脚本 10595 行里 **2752 行（26%）** 只为「全局共享一轮」存在。**AC43（套件无 VCS 知识）与 AC45（记录 per-task 化）是【全局共享轮】结构的伴生物——per-task 全量试点一旦成立，它们大部分自动失去理由：不是被实现，是被取消。** 为一个即将消失的结构建维护任务，正是 SPEC §11 阶段 1 的错误（人当时否掉的就是这个）。

**试点是什么**：一个任务从 develop fork → worktree → 在**它自己的 worktree** 跑**全量套件**（不是 scoped）→ 绿 → 合回 develop。验证「per-task 全量自证」足以替代「全局轮」——即每个任务的验证完整、无需一个跨任务的共享轮。

**为什么是试点不是直接实施**：方向成立但未验证；先小样本（若干任务）跑通 + 测量（墙钟/CPU/验证完整性），成立才切模式。

## Plan

1. 设计试点：选 2-3 个 genuinely-new 任务（worktree 已就绪），在其 worktree 内跑**全量套件**（含 capability-catalog 等全断言面）→ 绿 → A6 fan-in 合 develop。
2. 测量：**在接近 cap 的并发度下**（≥3 个 per-task 全量同时在跑）per-task 全量的墙钟/CPU 对照（vs 全局轮）+ 验证完整性（scope=worktree green 记录存在）。**顺序跑读数不构成成立证据。**
3. 成立判据（写死）：per-task 全量在 N 个任务上全绿、无全局轮依赖、墙钟/资源可控 ⇒ 试点成立 ⇒ 外层停跑全局轮 + **AC43/AC45 标记 cancelled（不是实现）** + AC46 前提成立。
4. 不成立（某任务 per-task 全量红/依赖全局轮）⇒ 记录证据、回退、保留全局轮。

## AC

- [ ] AC1: 试点任务在自有 worktree 跑全量套件（scope=worktree + state=green 记录），非 scoped
- [ ] AC2: N（≥2）个试点任务全部 per-task 全量绿 + A6 fan-in 合 develop
- [ ] AC3: 成立判据写死——全绿 + 无全局轮依赖 + **端到端吞吐对照**（AC3b）；**对照必须在接近 cap 的并发度下测（≥3 个 per-task 全量同时在跑），不是 N≥2 顺序跑——顺序跑读数不构成成立证据**（顺序跑 6.5 核当量压 16 核宽裕必过；真实稳态 cap=5 ⇒ 32.5 核当量 ≈2× 超订只在关掉全局轮后显形）。**单轮墙钟变长是并发的预期后果，不是目标量——目标量=吞吐（manager 2026-08-13 裁定，人原话「开发吞吐率」）；按单轮墙钟设门会落在预测值上，过不过取决于噪声**
- [ ] AC3b: **可取假门 = 端到端吞吐对照**——per-task 全量在 ≥3 并发下，**单位时间合入 develop 的任务数** ≥ 同窗基线（**基线在试点期同窗重算，非引用历史常量**；历史读数仅为证明量可测：近 6h fan-in 14 任务=2.33/h、全局轮 25 轮占 59% 墙钟、red 19/green 6=76% 红）。若试点期吞吐低于同窗基线 ⇒ 记「试点不成立」走 AC4 回退分支。**不设数值阈值（硬规则 4 推论：成本结构未知前不设阈值——基线是实测不是拍脑袋）**
- [ ] AC4: 试点成立 ⇒ 全局轮停跑 + AC43/AC45 标 cancelled（非实现）；不成立 ⇒ 记录证据回退
- [ ] AC5: 既有测试全绿；`--for-task` scoped 门绿

## Definition of Done

- [ ] AC1–AC5 全部勾上
- [ ] 试点读数贴出：**并发（≥3 同时在跑）per-task 全量吞吐 vs 全局轮**，N 任务全绿证据
- [ ] **全局轮占墙钟比 + 红轮率 前后对照（试点前/后各测一次）**——试点成立与否最终体现在这两个数会不会掉（基线：近 6h 全局轮占 59% 墙钟 / red 76%）
- [ ] 成立/不成立结论 + AC43/AC45 处置记录

## Touches

- orchestration/orchestrator-tick-core.md（若试点成立：全局轮 → per-task 全量的调度改造）
- plugin/scripts/full-suite-runner.ts（若试点成立：round 语义 per-task）
- tasks/gap-spec-11-stage-2-per-task-full-suite-pilot.md（自身）