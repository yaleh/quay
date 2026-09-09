---
id: gap-taskid-from-subject-form4-prefix-guard
title: taskIdFromSubject Form 4 缺 known-prefix 守卫——`git-history:` 前缀遮蔽 Form 6 尾括号 id
status: done
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: execution
---
## Proposal
`taskIdFromSubject`（packages/quay/src/serve-git.ts:231-268）的 Form 4 正则 `^([A-Za-z0-9][A-Za-z0-9_-]*-[A-Za-z0-9_-]+):\s` 把任何带连字符的前缀都当 task id，缺少 Form 5/6 共有的 known-prefix 守卫（`gap|DIR|exp5|QN|QX|QC|QW|QENG|ARCH|cand|SU|PROBE|TEST`）。于是 `git-history: full-width opaque sticky legend + stale comment fix (gap-git-graph-no-bounded-scroll-panel)` 先命中 Form 4、返回假 id `git-history`，轮到 Form 6（尾括号 id）之前就被截走；`layoutTaskGraph` 据此把这两条提交错归到 `git-history` 组，使 `gap-git-graph-task-view-aggregate-commits-by-task-id.test.mjs` AC6 生产数据对账失败（group count 6 ≠ subject-mention count 8），全量 suite 恒红、阻塞所有任务 fan-in。修法：给 Form 4 加与 Form 5/6 相同的 known-prefix 守卫，使其只匹配 `<known-prefix>-<id>: ` 形态，`git-history:` 等组件名前缀落到 Form 6 提取尾括号 id。这是 2026-09-09 由 `gap-git-graph-no-bounded-scroll-panel` 两条 `git-history: ... (gap-…)` 实现提交暴露的数据依赖回归。

## AC
- [x] `taskIdFromSubject("git-history: full-width opaque sticky legend + stale comment fix (gap-git-graph-no-bounded-scroll-panel)")` 返回 `gap-git-graph-no-bounded-scroll-panel` 而非 `git-history`（测试文件内直接单测断言）。
- [x] 负控制：Form 4 仍匹配真实 `gap-*: <说明>` 形态——`taskIdFromSubject("gap-123: implement the fix") === "gap-123"`。
- [x] `node --test packages/quay/test/gap-git-graph-task-view-aggregate-commits-by-task-id.test.mjs` 通过（AC6 生产数据对账 group count == subject-mention count）。

## DoD
- [x] 修法只落在 `taskIdFromSubject`（serve-git.ts）内，未触碰其它 render/layout 函数。
- [x] 测试文件新增覆盖 `git-history: ... (gap-<id>)` 形态的断言，且 AC6 对账在生产数据上绿。
- [x] `scripts/test.sh --for-task gap-taskid-from-subject-form4-prefix-guard --allow-thin` 绿。

## Touches
- packages/quay/src/serve-git.ts
- packages/quay/test/gap-git-graph-task-view-aggregate-commits-by-task-id.test.mjs
- tasks/gap-taskid-from-subject-form4-prefix-guard.md
