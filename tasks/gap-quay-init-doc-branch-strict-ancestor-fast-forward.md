---
id: gap-quay-init-doc-branch-strict-ancestor-fast-forward
title: ensureDocBranch 对严格祖先的 doc 分支应无损快进到基线再切换（真分叉保持只切不动）
status: ready
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: execution
depends_on:
  - gap-quay-init-doc-branch-behind-baseline-reports-satisfied
---
## Proposal

在 `gap-quay-init-doc-branch-behind-baseline-reports-satisfied` 给出落后读数之后（本条依赖它），让
`ensureDocBranch` 对**严格祖先**情形（`baselineContainsName === true && !nameContainsBaseline`）做无损快进：
`git branch -f <name> develop` 后再 `git checkout <name>`。此情形下 doc 分支没有任何独有提交 ⇒ 不丢内容；
这也是人手工处理同一场景时用的做法（quay-fleet 2026-11-04 即为 `git branch -f author develop`）。

边界（写进实现，缺一不可）：
- 只在主检出当前在基线上（既有 `checkedOut === develop` 前置）时才进入；
- `--dry-run` 只报告 `would fast-forward`，⛔ 不动 ref；
- 真分叉（doc 分支有独有提交，`nameContainsBaseline === true`）保持现有行为：只切、不并、不改 ref，并明确报告 diverged；
- 不引入备份 ref（ff 无内容丢失）；`git branch -f` 失败按既有 `failed` 态报告，⛔ 静默。

## AC

- [x] 单测：doc 分支是 develop 严格祖先且落后 N ⇒ 跑后 `git rev-parse <name>` 等于 `git rev-parse develop`，`git log --oneline <name>..develop` 为空，报告带 `fast-forwarded` 的独立取值与 N——`node --test packages/quay/test/doc-branch-fast-forward.test.mjs` exit 0。
- [x] 负控制（真分叉）：doc 分支有独有提交 ⇒ ref 的 sha 前后相同、报告明确写出 diverged、不发生 ff。
- [x] `--dry-run` 负控制：落后场景下 dry-run 前后 ref sha 不变，输出含 `would fast-forward`。
- [x] 可达性断言：ff 前后 `git rev-list --count develop..<name>` 为 0 且无新增不可达提交（`git fsck --no-dangling` 前后一致）。
- [x] 幂等：ff 后再跑一次 init，ref 不再移动、报告不再是 fast-forwarded。
- [x] 范围门绿：`bash scripts/test.sh --for-task gap-quay-init-doc-branch-strict-ancestor-fast-forward --allow-thin`。

## DoD

在临时仓库（主检出在 `develop`、`author` 落后 2 提交）上真跑 `quay init`，贴前后 `git rev-parse author develop`、
`git status`、init 原始输出；随后第二次重跑无进一步 ref 动作（幂等）。`--for-task` 范围门绿。

## Touches

- packages/quay/src/core/branch-model.ts
- packages/quay/src/core/branch-model-types.ts
- packages/quay/src/cli/init.ts
- packages/quay/test/doc-branch-fast-forward.test.mjs (new)
- packages/quay/test/doc-branch-lag-report.test.mjs
- tasks/gap-quay-init-doc-branch-strict-ancestor-fast-forward.md

## ADR-007 dark-axis

该轴仍暗,理由: 本任务只改 ensureDocBranch 的分支判定（严格祖先快进），不改变包依赖结构或环，未跑 archguard 分析。