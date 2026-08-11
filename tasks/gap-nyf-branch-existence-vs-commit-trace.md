---
id: gap-nyf-branch-existence-vs-commit-trace
title: "ready-pool 的 not-yet-flipped 判据依赖 task/<id>
  分支是否存在且未合——分支一旦合并并删除，信号消失，任务又像崭新的 ready 工作（16 条幽灵池实证）；与 worktree
  泄漏同根形状：拿短暂产物（分支存在/worktree 存在）当持久事实（工作已落地/执行体存活）的信号，短暂产物一消失判据就静默翻转；处方=nyf
  判据换成持久证据：integration 存在 inner: <id> 或 fan-in: task/<id> 提交 ⇒ 工作已落地，不得再算作可派"
status: ready
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

**`ready-pool-check` 的 not-yet-flipped 判据依赖 `task/<id>` 分支是否存在且未合。分支一旦合并并删除，这个信号就消失，任务看起来又像一条崭新的 ready 工作——16 条实现已落地却仍占 ready 池的幽灵任务。这与今晚的 worktree 泄漏是同一个根形状：拿一个短暂的产物（分支存在 / worktree 存在）当作一个持久事实（工作已落地 / 执行体存活）的信号。短暂产物一消失，判据就翻转，而且是静默翻转。**

### 实证（manager 2026-08-11 05:2x 按位置判定 + outer 复核）

- **按位置判定**（只认 `inner: <id>` 实现提交 与 `fan-in: task/<id>`，不认仅提到该 id 的提交）：18 条 ready 里 **16 条的实现早已合进 integration**，真正未开工的只有 1 条（gap-quay-init-never-writes-branch-model-config）；仅有立案提交的 1 条（gap-prerequisite-gates）。
- **outer 复核**：16 条逐条 `git log --all | grep -E "inner: <id>|fan-in: task/<id>"` 全命中——工作确已落地。
- **为什么 ready-pool-check 看不见**：not-yet-flipped 判据依赖 `task/<id>` 分支存在且未合；分支合并+删除后信号消失 ⇒ 任务又像新 ready 工作 ⇒ 池子报 pool=18/dd=10 而真·可派只有 1。
- **与 worktree 泄漏同根形状**：分支存在（短暂）/ worktree 存在（短暂）被当作「工作已落地/执行体存活」（持久事实）的信号——短暂产物一消失判据就静默翻转。
- **后果**：B9 按 deficit 持续晋升更多 todo，而池子里 16 条幽灵仍占 dispatchable_disjoint 这个数——补池补的是一个假指标。

### 选定机制方向（实现归 inner，判定归 outer）

**把 nyf 判据从分支存在性换成提交痕迹**（持久证据，不随分支删除失效）：
1. **提交痕迹判据**：integration（或 git 历史）里存在 `inner: <id>` 或 `fan-in: task/<id>` 提交 ⇒ 该任务的工作已落地，不得再算作可派。
2. **与 B9 补池判据同一件事的两半**：真·可派数 = ready − 已落地未翻 done − 待 fan-in − 冲突不可并行者 − 前置未满足（manager 04:2x 提的）。本条 = 「已落地未翻 done」那一项。
3. **散文前置无边 fail-closed**（交叉：gap-prerequisite-gates-prose-invisible-to-mechanisms）。

**验证锚**：修后 (a) 分支合并+删除后该任务不再算可派（提交痕迹在）；(b) 未落地任务仍可派；(c) 真·可派数正确反映 ready − 已落地 − 待fan-in − 冲突 − 前置；(d) `--for-task` scoped 门绿。

## Acceptance Criteria

- [ ] AC1: **复现固化**——任务体记录 16 条幽灵池实证（18 ready 里 16 已落地、按位置判定 inner:/fan-in: 提交）+ 根形状（分支存在 vs 工作已落地）（本任务 Proposal 已含）
- [ ] AC2: **nyf 判据换提交痕迹**——integration/git 历史存在 `inner: <id>`/`fan-in: task/<id>` ⇒ 不得再算可派（不随分支删除失效）
- [ ] AC3: **真·可派数正确**——ready − 已落地 − 待fan-in − 冲突 − 前置；B9 补池用真·可派数而非 pool 数
- [ ] AC4: **既有不回归**——`--for-task` scoped 门绿

## Definition of Done

- [ ] AC1–AC4 全部勾上
- [ ] 修后实跑：构造分支合并+删除 ⇒ 该任务不再可派（贴输出）；未落地仍可派
- [ ] 既有测试 + 新增测试全绿（`--for-task` scoped）
- [ ] 全量套件绿（`fail 0` 且 `cancelled 0` 且 `FULL-SUITE-EXIT=0`）——外层 verification-round 验证

## Touches

- plugin/scripts/ready-pool-check.ts（nyf 判据：分支存在性 → 提交痕迹）
- plugin/test/ready-pool-check.test.mjs（新增提交痕迹判据用例）
- tasks/gap-worktree-leak-after-fan-in-occupies-slot-permanently.md（交叉标注——同根形状：短暂产物当持久信号）
- tasks/gap-slot-free-not-an-event-slots-stay-empty-missed-without-trace.md（交叉标注——B9 补池判据）
- tasks/gap-nyf-branch-existence-vs-commit-trace.md（自身：勾 AC + 贴证据）

## Contract

measure   landed_but_ready_count = `node --no-warnings --experimental-strip-types plugin/scripts/ready-pool-check.ts --root "$PWD" --cap 5 --json` 对构造的「分支已合+删除」任务的 stdout 中该任务是否在 dispatchable
band      landed_but_ready_count = 0（工作已落地 ⇒ 不得算可派）
invariant commit_trace_persistent = 1（提交痕迹不随分支删除失效）
invariant true_dispatchable_formula = 1（真·可派 = ready − 已落地 − 待fan-in − 冲突 − 前置）
invoke    `node --no-warnings --experimental-strip-types plugin/scripts/ready-pool-check.ts --root "$PWD" --cap 5 --json`（贴真·可派数）
control   已落地不可派；未落地可派；B9 用真·可派；既有不回归
resume    提交痕迹判据 / 真·可派数 / 测试分步提交，任一步完成即写盘

## Dispatch review

reviewer: outer
at: 2026-08-11
changed: manager 05:2x——18 ready 里 16 实现已落地（按位置判定 inner:/fan-in: 提交），分支合并删除后 nyf 信号消失、任务像新 ready；与 worktree 泄漏同根形状（短暂产物当持久信号）。处方：nyf 判据换提交痕迹 + B9 用真·可派数。实现归 inner，判定归 outer
