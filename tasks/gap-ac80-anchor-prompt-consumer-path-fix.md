---
id: gap-ac80-anchor-prompt-consumer-path-fix
title: AC80 [inner-tick] prompt 的 plugin/loop 自引用违反 loop-shipping AC1c + outer-cron-registry worktree 上下文正本查找失败（round172 暴露，2eedf16c 引入）
status: done
labels:
  - gap
  - mechanism
parent: null
children: []
extra:
  schema: execution
depends_on: []
---

**type:** execution

## Proposal

**（round172 红窗暴露两个缺陷，均来自 AC80 的 [inner-tick] prompt（2eedf16c 落地）——归属 inner 实现面）**。

**现象（outer 分诊）**：
```
① loop-shipping.test.mjs AC1c 红：plugin/loop/fast-mode-loop-tick.md:1215 的 [inner-tick] prompt
   自引用 plugin/loop/fast-mode-loop-tick.md（"理由/实测/代价在 plugin/loop/…"）。
   AC1c 判据：tick-doc 模板 live 行不得引用 plugin/loop/（quay-init 只铺 orchestration/+docs/analysis/，
   plugin/loop/ 对消费方是死路径）。round168 该文件 0 个 plugin/loop 引用（绿）；2eedf16c 引入第 1 个。
② outer-cron-registry.test.mjs NOT-EVALUATED（exit 2）：报「本 worktree 无 AC80 段」，但 AC80-INNER-ANCHOR 段
   实际存在（fast-mode-loop-tick.md:1207-1216，3 命中）⇒ checker 的 inner canonical 查找在 verify worktree
   上下文路径解析失败（outer-cron-registry.ts:367 path.join(root, "plugin","loop","fast-mode-loop-tick.md")）。
```

**修复方向（outer 建议）**：
- ① line 1215 的 rationale 路径改 consumer-resolvable（如 `$REPO_ROOT/docs/analysis/fast-mode-loop-tick.md`——同一文件其他地方已用此形态）。**注意：这改变 [inner-tick] prompt 文本 ⇒ 需重建 CronCreate 锚（CronDelete + CronCreate 新 prompt）+ 更新注册表 sha256 + 同步 AC80-INNER-ANCHOR 正本段**。锚重建是主会话动作（CronCreate 会话级），impl 准备新 prompt 文本 + 验证 sha256，主会话执行重建。
- ② outer-cron-registry 的 AC80 段查找适配 worktree 上下文（canonical 路径解析根）。

**判据1**：loop-shipping.test.mjs AC1c 通过（prompt 不再引用 plugin/loop/）。
**判据2**：outer-cron-registry.test.mjs 通过（worktree 上下文能定位 AC80 段，不再 NOT-EVALUATED）。
**判据3（能取假）**：round172 两失败测试重跑全绿；`--for-task` scoped 门绿。
**判据4**：AC81 锚核实仍 OK（重建后四判据全真 + 剩余寿命正常——新锚 createdAt 重置）。

**不覆盖**：不动 reference-doc 声明机制（已修）；不改 pointerization 方向。

**本任务不新建过程纪律型 AC**：负控制沿用 AC49。

## Plan

1. 读 loop-shipping.test.mjs AC1c 判据 + outer-cron-registry.ts:367 canonical 路径解析 + 注册表结构。
2. 判据1：改 [inner-tick] prompt 的 rationale 路径为 consumer-resolvable；同步 AC80-INNER-ANCHOR 正本段 + 准备新 prompt（sha256 验证）。
3. 判据2：outer-cron-registry canonical 查找适配 worktree 上下文。
4. 判据3：两失败测试重跑绿 + scoped 门绿。
5. 判据4：锚重建后 AC81 核实 OK（主会话重建，impl 提供新 prompt）。

## Acceptance Criteria

- [x] AC1 判据1：loop-shipping AC1c 通过（prompt 无 plugin/loop/ 引用）。
- [x] AC2 判据2：outer-cron-registry.test.mjs 通过（worktree 上下文定位 AC80 段）。
- [x] AC3 判据3 能取假：round172 两失败测试重跑全绿；`--for-task` scoped 门绿。
- [x] AC4 判据4：AC81 锚核实四判据全真（重建后）+ 剩余寿命正常。

## Definition of Done

- [x] AC80 prompt consumer-path 修复（AC1c + checker 路径）+ 锚重建协调 + 测试绿。

## Touches

- plugin/loop/fast-mode-loop-tick.md（AC80-INNER-ANCHOR 正本段 prompt 改 consumer-path）
- plugin/scripts/outer-cron-registry.ts（canonical 查找适配 worktree 上下文——LAYERS 单一来源）
- plugin/scripts/outer-anchor-check.ts（LAYERS.inner.requiredPointers 改 consumer-resolvable——prompt 指针变化后的机械耦合）
- plugin/test/outer-cron-registry.test.mjs（round172 回归：worktree 上下文默认路径正本查找 + 保留正本缺失 NOT-EVALUATED）
- plugin/test/outer-anchor-check.test.mjs（INNER_PROMPT 常量 + requiredPointers 断言对齐新 prompt）
- plugin/test/loop-shipping.test.mjs（若断言需对齐——AC1c 现绿）
- plugin/scripts/loop-shipping-exclusion-data.mjs（AC1b 排除表：outer-anchor-check 两文件新增 consumer-laid 目标布局引用）
- plugin/scripts/outer-cron-registry.json（锚重建后 sha256 更新——主会话协调；impl 不改）
- tasks/gap-ac80-anchor-prompt-consumer-path-fix.md（自身）

## Evidence

（落地后回填——round172：AC1c 红（prompt 自引用）+ outer-cron-registry NOT-EVALUATED（worktree 路径解析失败），均 2eedf16c 引入）
