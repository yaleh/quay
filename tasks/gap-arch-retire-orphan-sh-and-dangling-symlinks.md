---
id: gap-arch-retire-orphan-sh-and-dangling-symlinks
title: 架构清理：退役 3 个无调用者 .sh（两个 selfcheck + inner-stalled.sh）并删除 3
  个悬空符号链接（git-lens-l-*.ts）
status: ready
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
---
## Proposal

**SPEC Phase 1b 的剩余量（SPEC 写作时是「11 个 selfcheck」，实测 `sh-census-check --json` 的 `orphanCandidates` 现在只剩 3 个）+ 3 个被跟踪的悬空符号链接。**

**实测清单（2026-09-20，`sh-census-check.ts --json` 中四类调用者计数全为 0 的 .sh）**：
```
orchestration/context-slimming/p2-archive-selfcheck.sh
orchestration/context-slimming/readings-selfcheck.sh
orchestration/watch/inner-stalled.sh
```
**悬空符号链接（`import-graph-check --json` 的 `dangling` 读数，目标 `plugin/scripts/git-lens-l-*.ts` 已不存在）**：
```
experiments/quay-perpetual-stream/scripts/git-lens-l-d-code-doc-ratio.ts
experiments/quay-perpetual-stream/scripts/git-lens-l-g-structural-drift.ts
experiments/quay-perpetual-stream/scripts/git-lens-l-s-behavior-variance.ts
```

**⛔ 删除前必做（硬规则 5，批量删除）**：`orphanCandidates` 的调用者计数只覆盖 ts/sh/test/other 四类静态引用，**不覆盖动态拼接的引用**。对每个待删文件 `git grep` 其 basename（`tasks/ docs/ archive/` 之外的一切）并读命中内容；`p2-archive-selfcheck.sh` 与 `readings-selfcheck.sh` 是 context-slimming 工作的产物，删前要核对 `orchestration/context-slimming/` 下的清单/SPEC 是否仍点名它们。产出「被删文件独有词条 → 新正本路径」的落点映射，贴进提交信息。任何一个有真实引用者的，**保留并从删除集移出**，写明原因，不算失败。

## AC

- [ ] AC1（动态引用核对，枚举）对 3 个 .sh 与 3 个符号链接各贴出 `git grep -n <basename>` 的前 3 条命中内容（无命中写「0 条」并贴命令）；判定每个的处置（删 / 保留+理由）。
- [ ] AC2（负控制，判据能取假）把一个**仍有调用者**的脚本临时列入删除集，落点核对必须拦下（exit 非 0 或报出引用者）；撤销后通过。两次输出贴进 notes。
- [ ] AC3（读数下降）删除后 `sh-census-check.ts --json` 的 `totals.scripts` 与 `orphanCandidates` 长度按实际删除数下降，`import-graph-check.ts --json` 的 `dangling` 不再含上述 3 条；前后读数各贴一次。
- [ ] AC4（棘轮同步）`plugin/sh-census-baseline.json` 若因删除而低于旧值，按「只降不升」同步下调并提交；`capability-catalog` 自报数与声明数一致（`bash plugin/scripts/capability-catalog.sh --summary`：`0 unclassified`）。
- [ ] AC5（回归面）`scripts/test.sh --for-task gap-arch-retire-orphan-sh-and-dangling-symlinks` 全绿。

## DoD

真实落地：仓库里不再有上述被删对象，且 `sh-census-check` / `import-graph-check` 在真实树上给出下降后的读数。提交信息含落点映射。

## Touches

- orchestration/context-slimming/p2-archive-selfcheck.sh
- orchestration/context-slimming/readings-selfcheck.sh
- orchestration/watch/inner-stalled.sh
- experiments/quay-perpetual-stream/scripts/git-lens-l-d-code-doc-ratio.ts
- experiments/quay-perpetual-stream/scripts/git-lens-l-g-structural-drift.ts
- experiments/quay-perpetual-stream/scripts/git-lens-l-s-behavior-variance.ts
- plugin/sh-census-baseline.json
- plugin/scripts/capability-catalog-declarations.json
- plugin/test/sh-census-check.test.mjs
- tasks/gap-arch-retire-orphan-sh-and-dangling-symlinks.md
