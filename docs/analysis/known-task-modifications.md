# 已知任务修改清单

**日期:** 2026-08-02
**依据:** ADR-021 四项原则 + split-correctness-review 逐任务机制数分析 + task-granularity-code-evidence 颗粒度分析

---

## 一、已完成子任务 → 标记父任务状态

### 1.1 DIR-124-A3：边界拆分，子任务都已完成

| 项 | 值 |
|---|---|
| 当前状态 | parent `status: todo`, A3a `done`, A3b `done` |
| 修改 | parent → `status: done`（ADR-014: parent-done-iff-children） |
| 理由 | 2 机制（边界），拆了也能完成——A3a ✅ A3b ✅ |

### 1.2 DIR-124-A3a / A3b：无后续动作

两个子任务已完成，无需修改。

---

## 二、不应拆分 → 废弃拆分决策，任务作为单 milestone 执行

### 2.1 DIR-124-A1b：合并回单任务（1 机制）

| 项 | 值 |
|---|---|
| 当前状态 | `status: todo`, `children: []`, 0 AC, 323 行, `prepare-decisions/DIR-124-A1b.json` 存在 (split) |
| 问题 | 被错误拆分——14 wiring claims 是覆盖率，不是 14 个机制。实际只有 **1 个机制**（8 阶段 instrumentation） |
| 修改 | 1. 为 1 个机制重新撰写 Proposal/AC（6-10 AC，覆盖 8 个边界 + error path + mirror parity）<br>2. 删除 `milestones/prepare-decisions/DIR-124-A1b.json`（或标记为 superseded）<br>3. `status: todo`，进入普通 prepare-milestone 流程 |
| 依赖 | DIR-124-A1a 已完成（workflow-event-schema.mjs 已落地）——A1b 可以直接引用 |

### 2.2 DIR-124-A4：合并回单任务（1 机制）

| 项 | 值 |
|---|---|
| 当前状态 | `status: todo`, `children: []`, 0 AC, 299 行, `prepare-decisions/DIR-124-A4.json` 存在 (split) |
| 问题 | 被错误拆分——16 个发现集中在同一子系统 (wiring-coverage)，repairable=true。实际只有 **1 个机制**（workflow-metadata-conformance checker） |
| 修改 | 1. 为 Proposal 的 8 个 WIRING-CLAIM 添加 AC 复选框（这是 ProposalReview 发现的真正缺口）<br>2. 删除 `prepare-decisions/DIR-124-A4.json`<br>3. `status: todo`，进入 prepare-milestone（应先消耗 repairable bypass） |

### 2.3 gap-build-evidence-manifest-missing：合并回单任务（余下 2 机制）

| 项 | 值 |
|---|---|
| 当前状态 | `status: ready`, `children: [path, per-phase, git-fail-soft]`（3 个子任务 .md 存在但内容为 2 行占位符）, `prepare-decisions/` 存在 (split) |
| 问题 | 机制 1（输出路径修复）已 commit（`2b1d67c2`）。余下 **2 个机制** ≤2 阈值 |
| 修改 | 1. 从 `children:` 中移除已完成的机制 1（或将子任务标记为 done）<br>2. 余下 2 机制合并为单 milestone<br>3. 删除子任务占位符文件或标记为 superseded<br>4. 删除 split decision 或标记为 invalidated |

### 2.4 gap-prepare-milestone-epoch-scope-change-grants-full-review：合并回单任务（1 机制）

| 项 | 值 |
|---|---|
| 当前状态 | `status: todo`, `children: [A]`, A 子任务存在（118 行, 9 AC, todo）, `prepare-decisions/` 存在 (split) |
| 问题 | 只有 **1 个机制**（bodyScopeHash）。A-J 实现步骤是同一机制的细节，不是独立机制。拆分原因是 wiring-coverage 缺口 |
| 修改 | 1. 将子任务 A 的 AC 合并回父任务（补充缺失的 wiring-coverage AC 复选框）<br>2. 删除子任务 A 或标记为 superseded<br>3. 清空 `children: []`<br>4. 删除 split decision<br>5. `status: todo`，进入 prepare-milestone（应先消耗 repairable bypass） |

---

## 三、拆得太细 → 合并子任务

### 3.1 DIR-124-F：6 子任务合并为 3 个

| 项 | 值 |
|---|---|
| 当前状态 | `status: todo`, children: F1-F6（每个 73-113 行, 7-9 AC, 全部 todo） |
| 问题 | 实际 ~3 个机制，拆成 6 个子任务太碎——每个只有 ~80 行/8 AC，是"实现步骤"而非"架构决策" |
| 修改 | **方案 A（推荐）：** 合并为 3 个子任务<br>&nbsp;&nbsp;F-core: Registry 数据 + CLI + 种子 + 验证（合并 F1+F3+F4+F5, ~400 行, ~15 AC, 1 机制）<br>&nbsp;&nbsp;F-plancheck: PlanCheck 类型化发现（F2, ~90 行, 9 AC, 1 机制）<br>&nbsp;&nbsp;F-learn: 学习循环 + 接线（F6, ~90 行, 9 AC, 1 机制）<br>**方案 B：** 恢复原始 DIR-124-F 为独立任务（3 机制，边界略超），进入 prepare-milestone，依赖 ProposalReview 判断是否需要拆分<br>**推荐 A**——3 个子任务各 1 机制，正好是"原子任务"的完美粒度 |

### 3.2 DIR-124-A1：恢复为单任务或保留为 2 子任务

| 项 | 值 |
|---|---|
| 当前状态 | `status: todo`, children: A1a (done ✅) + A1b (todo, limbo) |
| 问题 | 2 机制（schema + instrumentation），不触发 >2 阈值。但已拆成 A1a（已完成）+ A1b |
| 修改 | **A1 不需回退**——拆分虽然不必要，但结果可接受<br>1. 修复 A1b（见 2.1）<br>2. A1b 完成后，A1 标记 `status: done`（ADR-014）<br>3. 拆分决策文件保留但添加 note："2 机制，边界——实际不触发 split-multi-mechanism，但拆分结果可接受" |

---

## 四、依赖桩 → 标记阻塞，不进入 prepare-milestone

以下任务提案密度 < 20%，正文以"Depends on DIR-xxx"为主——它们是依赖桩，在上游完成前不应进入管线：

### 4.1 DIR-124-C（25 AC, 366 行，提案密度极低）

| 项 | 值 |
|---|---|
| 问题 | commit decision 已记录（`prepare-decisions/DIR-124-C.json`）。依赖 DIR-124-B |
| 修改 | 不进入 prepare-milestone，直到 DIR-124-B 的 4 个子任务全部完成 |

### 4.2 DIR-124-D（17 AC, 175 行）

| 项 | 值 |
|---|---|
| 问题 | Proposal: "N/A — depends on DIR-124-C" |
| 修改 | 不进入管线，直到 DIR-124-C 完成 |

### 4.3 DIR-124-E（17 AC, 139 行）

| 项 | 值 |
|---|---|
| 问题 | Proposal 引用 `[[DIR-123]]`, `[[DIR-124-B]]`, `[[DIR-124-C]]`, `[[DIR-124-D]]` |
| 修改 | 不进入管线，直到 DIR-124-B/C/D 全部完成 |

---

## 五、已正确拆分 → 继续推进

### 5.1 DIR-124-A（5 机制 → 5 子任务）

正确拆分。A2 ✅ A5 ✅。A1 修复（见 2.1 + 3.2）、A3 ✅、A4 修复（见 2.2）后 parent → done。

### 5.2 DIR-124-B（4 机制 → 4 子任务）

正确拆分。B1-B4 均可直接进入 prepare-milestone。B1（RunIdentity, 235 行, 8 AC）、B3（verify cache, 240 行, 12 AC）、B4（receipt envelope, 94 行, 11 AC）为原子任务。B2（stage journal, 573 行, 11 AC）可能偏大但仍为 1 机制。

---

## 六、机制提取校准（根因修复）

### 6.1 extractMechanismClaims 校准

| 项 | 值 |
|---|---|
| 文件 | `experiments/quay-perpetual-stream/scripts/wiring-coverage-check.ts`（及 plugin mirror） |
| 问题 | 将覆盖率条目计为独立机制——"8 个边界"被计为 8 个机制而非 1 个 |
| 修改 | 合并规则：同一 Proposal 段落中、wording 仅数字/标签不同的相邻 claim → 计为 1 个机制<br>示例："E1 插桩"、"E2 插桩"…"E8 插桩" → 1 个机制 |
| 优先级 | 高——这是 A1b 和 A4 错误拆分的根因 |

### 6.2 编排器不应自动批准已拆分的任务进入管线

| 项 | 值 |
|---|---|
| 问题 | DIR-124-A1b 已有 split decision，但编排器仍可将其作为独立任务 dispatch |
| 修改 | `_decideSplitCli` 已返回 `content-dispatch-blocked`——编排器应检查此信号并阻止 dispatch |

---

## 七、新增任务

### 7.1 创建 fix-extractMechanismClaims-calibration

- **标题:** 校准 `extractMechanismClaims`——覆盖率条目应计为 1 个机制而非 N 个
- **类型:** execution, 1 机制
- **AC (6-8):** 覆盖合并相邻同模式 claim, 边界测试 (A1b 的 14 claims → 2 mechanisms, A4 的 16 findings → 1 mechanism), 不破坏 DIR-124-B 的正确 4 机制提取
- **优先级:** 高——阻塞 DIR-124-A1b 和 A4 的正确执行

### 7.2 创建 unlimbo-4-split-tasks（或将孤儿任务纳入现有队列）

拆分决策存在但子任务缺失的 4 个任务（A4, A1b, gap-build-evidence, gap-epoch-scope-change）需要：
- 删除或标记 superseded 的 split decision 文件
- 重新设定任务范围为 1-2 个机制
- 补充 AC 覆盖

可作为编排会话的直接操作（不创建新 task），而非独立 milestone。

---

## 修改汇总

| # | 任务 | 类型 | 动作 | 优先级 |
|---|---|---|---|---|
| 1.1 | DIR-124-A3 | 状态修正 | parent → done（子任务全完成） | 高 |
| 2.1 | DIR-124-A1b | 合并 | 重写为单机制任务（8 阶段 instrumentation），删除 split decision | 高 |
| 2.2 | DIR-124-A4 | 合并 | 补充 AC 复选框，删除 split decision | 高 |
| 2.3 | gap-build-evidence-manifest-missing | 合并 | 合并为单任务（余下 2 机制），删除子任务占位符 | 中 |
| 2.4 | gap-epoch-scope-change | 合并 | 合并子任务 A 的 AC 回父任务，删除 split decision | 中 |
| 3.1 | DIR-124-F | 合并 | 6 子任务合并为 3（F-core, F-plancheck, F-learn） | 中 |
| 3.2 | DIR-124-A1 | 保留 | 不需回退——A1a 已完成，修复 A1b 后 parent → done | 低 |
| 4.1 | DIR-124-C | 阻塞 | 不进入管线直到 DIR-124-B 完成 | 中 |
| 4.2 | DIR-124-D | 阻塞 | 不进入管线直到 DIR-124-C 完成 | 低 |
| 4.3 | DIR-124-E | 阻塞 | 不进入管线直到 B/C/D 完成 | 低 |
| 6.1 | extractMechanismClaims | 修复 | 合并覆盖率条目为 1 个机制 | 高 |
| 7.1 | (新) fix-extractMechanismClaims | 新任务 | 创建校准任务 | 高 |
| 7.2 | (直接操作) unlimbo | 直接操作 | 清理 4 个孤儿 split decision | 高 |
