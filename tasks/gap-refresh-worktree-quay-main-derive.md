---
id: gap-refresh-worktree-quay-main-derive
title: refresh-worktree-quay.sh auto-derive 取 git worktree list 首项当 main——顺序不保证 main 在前 ⇒ verify 轮 AC4 断言失败（ff714bc0 落地新脚本真实逻辑弱点）
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

**（outer 2026-08-15 08:4xZ round197 分诊定案：refresh-worktree-quay.test.mjs AC4「root auto-derived」真实 AssertionError，C17 归 inner）**。

**现象**：`plugin/test/refresh-worktree-quay.test.mjs` AC4 断言失败（real AssertionError，非超时，@4159ms）。根因在 `plugin/scripts/refresh-worktree-quay.sh:65`：
```sh
root="$(git -C "${worktree}" worktree list --porcelain 2>/dev/null | awk '/^worktree /{print $2; exit}')"
```
**取 `git worktree list` 首项当 main checkout，但顺序不保证 main 在前** ⇒ 在 AC4 的 makeRepo 临时仓库（或一次性 verify worktree 里）可能解析到非 main worktree ⇒ 断言 false。隔离复跑 5/5 通过（makeRepo 恰好 main 在前），verify 轮里暴露。

**这是 ff714bc0（provisioning）落地的新脚本的真实逻辑弱点**——auto-derive 应选 **main worktree**（按 `[develop]`/bare / git-common-dir / 主工作树判据）而非首项。

**判据1**：`refresh-worktree-quay.sh` 的 root auto-derive 在任意 worktree 上下文中解析到**主检出**（非首项假设）。
**判据2（能取假·真样本）**：AC4 在 makeRepo 临时仓库（main 非首项的构造）+ verify worktree 上下文通过；`git worktree list` 首项非 main 时仍解析正确。
**判据3**：既有测试全绿；`--for-task` scoped 门绿。

**不覆盖**：不改 refresh 的复制语义（只修 root 解析）。

**本任务不新建过程纪律型 AC**：负控制沿用 AC49。

## Plan

1. 读 refresh-worktree-quay.sh:60-70（root 解析）+ refresh-worktree-quay.test.mjs AC4（makeRepo 构造）。
2. 修法：选 main worktree（`git rev-parse --git-common-dir` 推导 / `[develop]` / bare 判据），不取首项。
3. 判据2 能取假：AC4 在 makeRepo + verify worktree 上下文通过；构造 main 非首项样本。
4. 既有测试全绿 + `--for-task` scoped 门绿。

## Acceptance Criteria

- [x] AC1 判据1：root auto-derive 在任意 worktree 上下文解析到主检出（非首项假设）。
- [x] AC2 判据2 能取假：AC4 在 makeRepo/verify worktree 通过；main 非首项构造样本正确解析。
- [x] AC3 判据3：既有测试全绿；`--for-task` scoped 门绿。

## Definition of Done

- [x] refresh-worktree-quay.sh root auto-derive 选 main（非首项）+ AC4 在 verify 上下文绿 + 测试绿。

## Touches

- plugin/scripts/refresh-worktree-quay.sh（root auto-derive 改选 main worktree）
- plugin/test/refresh-worktree-quay.test.mjs（AC4 补 main 非首项构造用例）
- tasks/gap-refresh-worktree-quay-main-derive.md（自身）

## Evidence

（2026-08-15 inner Build 落地回填）

**round197 真实根因（修正分诊，非首项假设）**：verify 轮是 one-shot（full-suite-state.json `oneShotWorktree:true`），full-suite-runner.ts:2602 给 suite 子进程 env 设 `QUAY_MAIN_CHECKOUT=<real main>`；AC4 的 spawnSync 继承该 env ⇒ 脚本 :48 `root="${QUAY_MAIN_CHECKOUT:-}"` 直接取到真实 main ⇒ 复制的 config 无 fixture gate `zz-refresh-probe-gate` ⇒ 断言失败。实证复现：`QUAY_MAIN_CHECKOUT=/home/yale/work/quay` 下跑脚本复制 35 文件（真实 main 的 .quay），grep fixture gate=0。隔离 5/5 过是因为无 env 时走 derive。**顺序非首项在 git 2.43 上不可构造**：`get_worktrees()` 源码强制 main 在 index 0（已查 v2.43 worktree.c），任何真实 repo 首项恒为 main ⇒ 原「首项假设」分诊不成立。

**修复（两半）**：
1. 脚本 derive 改为 order-independent：`git rev-parse --path-format=absolute --git-common-dir` 的 dirname（共享 .git 的父目录 = 主检出），带旧 git（无 --path-format）相对路径 fallback。不再读 `git worktree list` 首项。
2. 测试 AC4 清除子进程 `QUAY_MAIN_CHECKOUT`（使 derive 真正被测），AC4b 用 git shim 反转 `worktree list` 顺序构造「首项非 main」样本（git 2.43 真实 repo 构造不出，shim 是诚实等价物），AC4c 验证 detached verify worktree 上下文 derive 仍得 main。

**测试结果（直接 `node --test plugin/test/refresh-worktree-quay.test.mjs`）**：7/7 pass（AC1-AC5 + AC4b + AC4c），duration ~1379ms。能取假验证：旧首项 derive 在 shim 反转下得 wt==root ⇒ no-op ⇒ config 未复制 ⇒ AC4b 断言失败；新 derive 不受 list 顺序影响 ⇒ 复制成功。derive 实测（task worktree，无 env）→ `/home/yale/work/quay`；main checkout 运行 → no-op。

## 标注（gap-fan-in-delta-scope-inventory-annotate）

> **⚠️ 落地未经全量轮验证**（runId `fm-gap-fan-in-delta-scope-inventory-annotate-1787312000000-inv`，2026-08-21）
> 父任务 gap-fan-in-delta-scope-doc-only-skip AC1 枚举：本任务 fan-in 记录 `fullSuiteRan=false` ∧ `skipReason=doc-only-delta`，但实际 diff 含非 doc 文件，落地当时未被全量轮覆盖：
> ```
>     plugin/scripts/refresh-worktree-quay.sh
>     plugin/test/refresh-worktree-quay.test.mjs
> ```
> **补跑判定（AC2）：不需补跑全量轮** —— 落地（merge `aafaf685ec33e66338fc44a612fa8a0eaa3d2935` @ `2026-08-15T09:10:54+00:00`）后 develop 已有 **194** 轮 `fullSuiteRan=true` 全量轮运行（green **190** 轮，最后 gap-docs-t3-webui-doc-and-screenshots @ 2026-08-21T13:12:56.151Z）覆盖其改动。
