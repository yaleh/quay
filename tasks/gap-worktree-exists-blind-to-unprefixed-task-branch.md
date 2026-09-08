---
id: gap-worktree-exists-blind-to-unprefixed-task-branch
title: worktreeExists 只认 refs/heads/task/<id>，无 task/ 前缀的遗留 worktree 判为不存在 ⇒ NYF
  leftover-worktree 豁免失效、任务永久出池
status: done
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
---
## Proposal

`plugin/scripts/fast-mode-telemetry.ts:371` `worktreeExists(root, taskId)` 把分支名硬编码为
`refs/heads/task/${taskId}`，只有当遗留 worktree 的分支带 `task/` 前缀时才返回 true。
`ready-pool-check.ts:989-990` 的 leftover-worktree 豁免（`return doneFlipReady || (allChecked && !hasLeftoverWorktree)`）
用它作为「fan-in 尚未完成」的直接量；探针漏认 ⇒ 豁免不触发 ⇒ `allChecked && !hasLeftoverWorktree` 取真
⇒ 任务判 not-yet-flipped、永久离开 ready 池，且没有任何检查会报出来。

生产实证（2026-09-08 05:4xZ 主检出实测，非 fixture）：两个 worktree 的分支无 `task/` 前缀 ——
`/home/yale/work/quay-worktrees/gap-perfile-psi-window-join`（分支 `gap-perfile-psi-window-join`）与
`/home/yale/work/quay-worktrees/gap-meta-ffpushtodevelop`（分支 `gap-meta-ffpushtodevelop`）。
对这两个 id 干跑 `worktreeExists` 返回 **false**，而对同批带前缀的
`gap-perfile-failure-rate-baseline-step-change` / `gap-mechanical-fan-in-loses-per-phase-accounting` 返回 **true**
—— 这是一个能区分的负控制（硬规则 推论四）：唯一差别就是分支前缀。
后果：两条任务的实际未落地产出（`plugin/scripts/psi-window-join.ts` 224 行 + 测试 98 行；
`driver-filters.ts` ff stderr 捕获 24 行 + 测试 33 行）在 develop 中缺席，
而任务停在 ready 且被判 NYF 出池，19 小时~2 天无人重派、也无人 fan-in。

## Plan

1. 把 worktree 存在性从「按分支名字面前缀匹配」改为**穿过中间层的直接量**（硬规则 4c）：
   枚举 `git worktree list --porcelain`（已有 `listWorktrees`），按 **worktree 路径 basename == taskId**
   ∨ 分支 ref 去掉可选 `task/` 前缀后 == taskId 判定命中，两者取或。路径 basename 是 worker 建 worktree 时的约定
   （`/home/yale/work/quay-worktrees/<task-id>`，CLAUDE.md 钉死），不依赖分支命名习惯。
2. 保持 fail-soft 语义不变：任何 git 失败 ⇒ false（不得因探针改造把「读不到」变成「存在」）。
3. 单测覆盖三种形态：`task/<id>` 分支、裸 `<id>` 分支、detached-HEAD（按路径命中）；
   并加一条负控制：不相关 id 不得命中（防止 basename 前缀式误匹配）。
4. 复查同一原则的其它适用点（硬规则 5b）：grep `refs/heads/task/` 全仓命中并把计数与前 3 条贴进提交。

## AC

- [x] `grep -c 'refs/heads/task/' plugin/scripts/fast-mode-telemetry.ts` 在改动后不再是 `worktreeExists` 的唯一判据（贴改动前后两次读数，⛔ 非转述）
- [x] 单测：为裸 `<id>` 分支的 worktree 断言 `worktreeExists(root, id) === true`（改动前该用例必须先红——贴红的输出，排除恒真）
- [x] 单测：为 `task/<id>` 分支的 worktree 断言仍为 `true`（回归，原行为不得退化）
- [x] 单测负控制：一个不存在 worktree 的 id 断言 `false`；一个 id 为另一 id 前缀的场景断言不误命中
- [x] `node --test plugin/test/fast-mode-telemetry.test.mjs` 全绿，贴 pass/fail 计数
- [x] 全仓 `refs/heads/task/` 剩余命中数与前 3 条实际内容贴进提交信息（硬规则 5b 产物）

## DoD

生产载体读数：改动落地后，对主检出实跑一次 `ready-pool-check.ts --json`，
`excluded` 中 `gap-perfile-psi-window-join` 与 `gap-meta-ffpushtodevelop` 不再仅因
`allChecked && !hasLeftoverWorktree` 被判 not-yet-flipped（贴 JSON 片段）。
⛔ 单测绿是必要非充分——必须读主检出生产载体（硬规则 4 推论三）。

## Touches

- plugin/scripts/fast-mode-telemetry.ts
- plugin/test/fast-mode-telemetry.test.mjs
- tasks/gap-worktree-exists-blind-to-unprefixed-task-branch.md
- docs/analysis/quay-init-closure-ratchet.baseline.json

## Verification

负控制：把 worktree 的分支从裸 `<id>` 改回 `task/<id>` 后判定仍为 true；
把 worktree 整个删掉后判定翻 false —— 两个方向都翻，排除恒真/恒假（硬规则 4）。
