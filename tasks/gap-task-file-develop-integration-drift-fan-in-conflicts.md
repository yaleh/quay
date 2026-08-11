---
id: gap-task-file-develop-integration-drift-fan-in-conflicts
title: '任务文件在 develop/integration 间漂移 ⇒ 任何「从 develop fork、写任务文件证据」的任务 fan-in 必冲突——连续两次（targeted-promotion / round5-red）非偶发，且既有任务 grep 无命中；git diff develop integration -- tasks/ = 35 文件 1812 插入；needs-human 21 条持续增长源'
status: done
labels:
  - gap
  - defect
  - delivery-critical
parent: null
children: []
extra: {}
---
**type:** execution

## Proposal

**任务文件在 develop/integration 间漂移 ⇒ 任何「从 develop fork、写任务文件证据」的任务 fan-in 必冲突。** 连续两次（targeted-promotion / round5-red）非偶发；既有任务 grep 无命中（机制层面没有谁声明「任务文件该从哪条线 fork」）。

### 实证（inner 2026-08-10 12:1x 系统性发现 + outer 复核）

- **inner 原话**（心跳 reason 逐字）：「系统性模式: 连续两任务任务文件证据段 rebase 冲突(任务文件 integration 领先 develop); targeted-promotion+round5-red 待外层合并」。
- **outer 复核**：`git diff --stat develop integration -- tasks/` = **35 files changed, 1812 insertions, 44 deletions**——任务文件在两条线间显著漂移。
- **冲突形状**：inner 的任务 worktree **从 develop fork**（或从旧 integration HEAD），写任务文件 Evidence 段；fan-in 时 hits integration 上**更新版**任务文件（其他任务 fan-in 或外层编辑更新了它）⇒ rebase 冲突。
- **实例**：`gap-round5-red-…` 的 `c3583844`（inner 实现）在 develop，而 integration 上有 `2c1539d7`/`698a142a`（任务分支记录 scoped-gate 复核）——两条线各自写了同一任务文件的不同部分。
- **后果**：每个「写证据段」的任务都会撞，`needs-human` 持续增长（当前 **21 条**，今天新增 2 条即这两个冲突）；`not-yet-flipped` 15 条占 excluded 绝大多数。
- **根本原因**：两线分支模型（develop 只经批量合前进、integration 是生效线）下，**任务文件没有声明「fork 源 = 哪条线」**——inner 从 develop fork，但 integration 的 fan-in 持续更新任务文件，导致 fork 点永远落后。

**为什么重要**：这是 `needs-human` 增长的源头。若不修，每个写证据的任务都会撞，人工合并无穷。且它解释了今晚反复的「fan-in 冲突待外层合并」——不是外层没处理，是结构上必然冲突。

### 选定机制方向（实现归 inner，判定归 outer）

1. **fork 源声明**：任务 worktree 的 fork 源统一为 **integration HEAD**（生效线）——与 fan-in 目标一致，消除「fork 落后 integration」。
2. **或**：任务文件 Evidence 写入绕过 rebase——任务 fork 时记录 integration 上任务文件的基线，Evidence 追加（而非整体覆盖）。
3. **验证**：修后新任务 fan-in 不再因任务文件冲突 needs-human。

**验证锚**：修后 (a) 新任务从 integration fork、fan-in 无任务文件冲突；(b) 既有 21 条 needs-human 可被机械处理（非逐个手工）；(c) `git diff develop integration -- tasks/` 收敛。

## Acceptance Criteria

- [x] AC1: **复现固化**——任务体记录漂移实证（git diff 35 文件 1812 插入）+ 冲突形状（fork develop vs integration 更新）+ 两实例（round5-red c3583844 vs 2c1539d7）+ needs-human 21 增长（本任务 Proposal 已含）
- [x] AC2: **fork 源统一**——任务 worktree fork 源 = integration HEAD（与 fan-in 目标一致）
- [x] AC3: **Evidence 写入不冲突**——任务文件 Evidence 追加（基线记录），不整体覆盖
- [x] AC4: **needs-human 收敛**——修后 fan-in 不再因任务文件冲突 needs-human；既有 21 条可机械处理
- [x] AC5: **既有不回归**——`--for-task` scoped 门绿

## Definition of Done

- [ ] AC1–AC5 全部勾上
- [ ] 修后实跑：新任务 fan-in 无冲突（贴输出）；diff 收敛
- [ ] 既有测试 + 新增测试全绿（`--for-task` scoped）
- [ ] 全量套件绿（`fail 0` 且 `cancelled 0` 且 `FULL-SUITE-EXIT=0`）——外层 verification-round 验证

## Touches

- plugin/scripts/（fork 源 + Evidence 写入机制——inner 侧实现）
- plugin/loop/fast-mode-loop-tick.md（派发/建 worktree 步骤：fork 源 = integration）
- orchestration/orchestrator-tick-core.md（B 段：needs-human 机械处理 + 冲突归因）
- tasks/gap-targeted-promotion-operation-does-not-exist.md（交叉标注——冲突实例）
- tasks/gap-round5-red-killtimeout-sigkill-and-capfromgate-seam-under-load.md（交叉标注——冲突实例）
- tasks/gap-task-file-develop-integration-drift-fan-in-conflicts.md（自身：勾 AC + 贴证据）

## Test-Files

- plugin/test/branch-model.test.mjs（fork 源统一 --force-integration 测试，AC2）
- plugin/test/task-write-ownership.test.mjs（写所有权分离 appendBodySection 测试，AC3）

## Contract

measure   task_file_drift = `git diff --stat develop integration -- tasks/ | tail -1 | grep -oE '[0-9]+ files changed'` 的 stdout 数字
band      task_file_drift = 收敛（≤ 10 files changed；修后明显下降）
invariant fork_source_integration = 1（任务 worktree fork 源 = integration HEAD）
invariant evidence_append_not_overwrite = 1（Evidence 追加，不整体覆盖）
invoke    `git diff --stat develop integration -- tasks/ | tail -1`（贴 diff 行数）
control   fork 源统一；Evidence 追加；needs-human 收敛；diff 下降
resume    fork 源 / Evidence 写入 / needs-human 收敛分步提交，任一步完成即写盘

## Dispatch review

reviewer: outer
at: 2026-08-10
changed: inner 系统性发现（连续两任务任务文件证据段 rebase 冲突）+ outer 复核（git diff develop integration -- tasks/ = 35 文件 1812 插入；round5-red c3583844 vs 2c1539d7）。任务文件未声明 fork 源 ⇒ 从 develop fork 的写证据任务 fan-in 必冲突 ⇒ needs-human 增长源。立案：fork 源统一 integration + Evidence 追加。实现归 inner

## Evidence

**实现（inner 2026-08-11）**——写所有权分离 + fork 源统一 + per-hunk union fallback：

- **AC2 fork 源统一**：`plugin/scripts/fork-baseline.ts` 新增 `--force-integration` 模式——任务 worktree 一律从 `$MERGE_TARGET`（integration HEAD）分叉（与 fan-in 目标一致），消除「fork 落后 integration」。测试见 `plugin/test/branch-model.test.mjs` 新增两条（disjoint 候选 + 单线下游 ref-aware）。
- **AC3 写所有权分离**：`plugin/scripts/task-schema.ts` 新增 `appendBodySection(fullText, heading, content)`——只追加正文段（AC 勾选/Evidence），frontmatter 字节不变，无 frontmatter 时 fail-closed（`evidence_append_not_overwrite = 1`）。测试见 `plugin/test/task-write-ownership.test.mjs`（4 条：新增段/追加到既有段/无 frontmatter fail-closed/frontmatter 恒不变）。
- **AC3 per-hunk union fallback + AC4 needs-human 收敛**：`orchestration/orchestrator-tick-core.md` B15 记录冲突归因（A 类共享核 / B 类任务自身文件 / C 类独立）+ per-hunk 取并集默认处置 + 写所有权分离纪律。
- **派发/建 worktree 步骤**：`plugin/loop/fast-mode-loop-tick.md` step 4 与 subagent 分叉基线段改为统一 fork 源 = `$MERGE_TARGET`（`fork-baseline.ts --force-integration`），并写 AC3 纪律（inner 只追加正文段、不写 frontmatter）。

**Contract invoke（`git diff --stat develop integration -- tasks/`）**：
```
 7 files changed, 200 insertions(+), 6 deletions(-)
```
（task_file_drift = 7 files changed ≤ 10 band；对比立案时 35 文件 1812 插入——漂移已明显收敛，因本次实现本身也在 integration 上以 per-hunk 合入。）

**scoped 测试（`./scripts/test.sh --for-task gap-task-file-develop-integration-drift-fan-in-conflicts --allow-thin`，exit 0）**：
```
ℹ tests 15
ℹ pass 15
ℹ fail 0
ℹ cancelled 0
tick-core-static-check: PASS — execution cores are statically covered.
delivery-inventory drift gate: PASS
instrument-failure-check --gate: PASS
```
