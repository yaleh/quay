---
id: gap-quay-init-doc-branch-behind-baseline-reports-satisfied
title: ensureDocBranch 把主检出切到落后基线的 doc 分支且不带落后量读数；checkDocBranchInvariant 同时报
  satisfied
status: todo
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: execution
---
## Proposal

`ensureDocBranch`（`packages/quay/src/core/branch-model.ts:656-745`）对「已存在的相关 doc 分支」只用
`isAncestor` 双向判定区分 related / collision；当 doc 分支是 `develop` 的**祖先**（即落后）时走 `reusable`
分支直接 `git checkout name`，报告文案是「unchanged, never renamed or re-pointed」，而
`checkDocBranchInvariant` 同时报 `satisfied`。⇒ 主检出不发一声退回旧树。

为什么这是缺陷（而不是「只是没打印」）：本仓把「主检出落后 develop」明列为生产风险（跑旧代码），
而输出里没有任何一个数能看出落后量——「合格」与「落后 N 个提交」共用同一个输出形态（硬规则 3b）。

实测（2026-11-04）：quay-fleet 的 `author` 曾落后 `develop` 1057 提交，`quay init --dry-run` 的 `[SWITCHED]`
行只报分支名与 sha、不报落后量；`checkDocBranchInvariant` 报 `satisfied`。

本任务**只加读数与判别，不改 checkout 行为**（无损快进是下一条任务，已依赖本条）。

修法：
1. `DocBranchReport` 增加显式落后量（如 `behindBaseline: number | null`；`null` = 未评估，⛔ 不用 0 冒充），
   由 `git rev-list --count <name>..develop` 求得；
2. `state` / `detail` 对「related 且落后」给出独立取值，不得与「related 且同 tip / 领先」同形；
3. `checkDocBranchInvariant` 在落后时不得报 `satisfied`——给独立态并在人读输出里打印落后量；
4. `--dry-run` 与真跑都要打印该读数。

## AC

- [ ] 单测：构造 doc 分支落后 develop N（N ≥ 1）的仓库，`ensureDocBranch` 报告 `behindBaseline === N`——`node --test packages/quay/test/doc-branch-lag-report.test.mjs` exit 0。
- [ ] 单测：同条件下 `checkDocBranchInvariant` 的 state 不等于 `satisfied`，且报告携带同一落后量。
- [ ] 负控制：doc 分支与 develop 同 tip 时仍报 `satisfied` 且 `behindBaseline === 0`（证明不是把「一切非基线」都打成红）。
- [ ] 人读输出（非 `--json`）在落后时打印落后数：断言 `quay init --dry-run` 的 doc-branch 行文本含该数字。
- [ ] 行为不变负控制：落后场景下本任务实现前后 `git rev-parse --abbrev-ref HEAD` 结果一致（本条不引入任何 ref 移动）。
- [ ] 范围门绿：`bash scripts/test.sh --for-task gap-quay-init-doc-branch-behind-baseline-reports-satisfied --allow-thin`。

## DoD

在落后 ≥1 的临时仓库上真跑 `quay init --dry-run`（非单测替身），贴原始输出：doc-branch 行含落后量、
invariant 不再报 `satisfied`；再贴一次同 tip 的正样本对照（仍报 satisfied）。`--for-task` 范围门绿。

## Touches

- packages/quay/src/core/branch-model.ts
- packages/quay/src/cli/init.ts
- packages/quay/test/doc-branch-lag-report.test.mjs (new)
- tasks/gap-quay-init-doc-branch-behind-baseline-reports-satisfied.md