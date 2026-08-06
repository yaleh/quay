---
id: gap-global-count-assertions-fragile-relative-baseline
title: global-count assertions are inherently fragile — B3-2 went red because
  its worktree was built 13 min before B3-1's merge, staling a global
  test-file-count assertion; under the two-line branch model (develop lagging
  integration longer) they'd go red continuously (the model exposes a real
  defect from sporadic to always); fix them to RELATIVE-BASELINE criteria
  (compare against the fork baseline's snapshot, not an absolute global count)
  BEFORE the branch model goes live so its rounds aren't obscured by assertion
  noise (ruling ②)
status: ready
labels:
  - gap
  - milestone-candidate
extra:
  schema: v1
---

**type:** execution

## Proposal

`orchestration/SPEC-branching-model-integration-branch-2026-08-05.md` 开放问题②（外层裁定：**先修断言**）。
tick 文档已记载 B3-2：*"worktree 建立时对 master 取了快照…B3-2 就这样红的——它的 worktree 建于 B3-1
合并前 13 分钟，于是对**全局测试文件计数**的断言过期"*。

**根因**：**全局计数断言本身脆弱**——它假设「整棵树的测试文件数」在 worktree 生命周期内不变（断言的是
绝对计数），而并发任务合并会让它过期。**这是一个真实缺陷**，分支模型（develop 相对 integration 滞后
更久）会把它从偶发变必现。

**处置**（裁定②：先修断言，再让分支模型上线——模型轮次不被断言噪声遮蔽）：

把**全局计数断言改成相对基线判据**——断言相对于「worktree 建立时的 fork 基线快照」的计数，不是绝对
全局计数。worktree 建立时记基线快照（该时刻的测试文件集）；断言比对「当前树 = 基线 + 本任务 touch 的
新增」，不是「全局 = 某绝对数」。

**与分支模型的关系**：前置②（`gap-branch-model-integration-branch-...` AC4）；修复后分支模型上线时
develop/integration 滞后不再触发断言噪声。

## Acceptance Criteria

- [ ] AC1: **相对基线判据**——全局计数断言改为「worktree 建立时 fork 基线快照 + 本任务 touch 新增」
      的相对比对，非绝对全局计数（B3-2 族全部转换）
- [ ] AC2: **基线快照**——worktree 建立时记录测试文件集快照（可机械比对：当前 = 基线 + 本任务新增）
- [ ] AC3: **B3-2 场景不红**——worktree 建于并发合并前 13 分钟 ⇒ 断言不再过期（fixture 复现 B3-2 场景
      ⇒ 绿）
- [ ] AC4: 与分支模型前置②交叉标注（`gap-branch-model-integration-branch-...` AC4）
- [ ] AC5: 测试用 `node:test` 且带 `// @test-group governance`

## Definition of Done

- [ ] AC1–AC5 全部勾上；AC3 实跑输出贴任务体
- [ ] 全局计数断言全部相对化（B3-2 族不再脆）；分支模型上线不被断言噪声遮蔽
- [ ] 全量套件绿（`fail 0` 且 `cancelled 0` 且 `FULL-SUITE-EXIT=0`）

## Touches

- tasks/gap-global-count-assertions-fragile-relative-baseline.md
- plugin/test/（B3-2 族全局计数断言 → 相对基线判据）
- plugin/scripts/（基线快照 helper，若成脚本）
- tasks/gap-branch-model-integration-branch-splits-fork-baseline-from-merge-point.md（AC4 交叉标注）

## Contract

measure   global_count_assertions = `grep -rn '全局\|test files.*count\|assert.*files.*==' plugin/test/` stdout 数字段
band      global_count_assertions = 0（无绝对全局计数断言，全相对基线）
invariant relative_to_baseline = 1（断言 = fork 基线快照 + 本任务新增，非绝对数）
invoke    `grep -rn 'baseline\|基线快照' plugin/test/`
control   构造 worktree 建于并发合并前 13 分钟 ⇒ 断言不红（AC3 B3-2 fixture）；绝对计数断言 ⇒ 必须为 0
resume    断言相对化与基线快照分两步提交，任一步完成即写盘

## Dispatch review

reviewer: outer
at: 2026-08-05T06:5xZ
changed: 外层受分支模型 SPEC 开放问题②裁定立案（先修断言）。四处收紧：
(1) **根因 = 绝对全局计数断言本身脆**（B3-2 已记载），分支模型把它从偶发变必现；
(2) **相对基线判据**——worktree 建立时基线快照 + 本任务新增，非绝对全局数；
(3) **前置②**——先修再让分支模型上线（模型轮次不被断言噪声遮蔽）；
(4) **B3-2 场景 fixture**——worktree 建于并发合并前 ⇒ 不红。
status: todo——分支模型前置②；排分支模型前落地。
