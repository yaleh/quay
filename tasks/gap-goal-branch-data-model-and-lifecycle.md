---
id: gap-goal-branch-data-model-and-lifecycle
title: goal 的 branch 字段、goal 分支生命周期（懒创建 / 废弃时记 tip 后删除）与身份检查认可 goal/GOAL-NNN
status: todo
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
depends_on: []
goal_ac: AC-326
---
## Proposal

**机制**（`orchestration/SPEC-goal-branch-2026-10-03.md` §4.1、§4.2、§4.8，裁定④⑦⑨㉑）：

1. **数据模型**：goal frontmatter 新增 `branch: true`（opt-in，缺省 false）。分支名是派生量 `goal/<GOAL-NNN>`，⛔ 不存储、⛔ 不允许人填任意名字。改动约束：只在 draft，或 active 且分支尚未创建时可改；分支创建后锁定，并入后仍锁定（不得重开）。`quay goal write` 增加对应参数。
2. **分支生命周期**（`packages/quay/src/branch-model.ts` 新增 goal 角色，今天只有 develop 一个落地基线角色 `:67`）：goal 处于 active 且 `branch: true` 时从当时的 develop tip 懒创建 `goal/<id>`（⛔ 不在建档时创建）；goal 转 retired / superseded 时，先把分支 tip SHA 写进进入该状态的 statusLog 条目 reason，再删除分支——这是人工救援的唯一留痕。创建与删除只能各有一个调用点。
3. **身份检查**（`plugin/scripts/target-identity-literal-check.ts:67` `LEGAL_IDENTITY_VALUES`）：保留现有 5 个字面量；token 匹配 `^goal/GOAL-\d{3,}$` 且对应 GOAL 存在、`branch: true`、状态不是 superseded/retired ⇒ 合法；读不到 goal store ⇒ exit 3（NOT-EVALUATED），⛔ 不当作合法。

<!-- dedup-ref -->相关但机制不同：`gap-fan-in-merge-target-hardcoded-develop-blocks-third-party-landing`（done）处理的是第三方项目的落地基线怎么确定；本任务新增的是同一仓库内按 goal 划分的临时分支。

## AC

- [ ] `packages/quay/test/goal-store.test.mjs` 新增用例断言：draft goal 可写 `branch: true`；active 且分支已存在时改 `branch` 被拒；未声明时读出为 false（或缺省）。
- [ ] `packages/quay/test/branch-model.test.mjs` 新增用例（临时仓库）：goal 角色的创建函数在 develop tip 上建出 `goal/GOAL-901`，重复调用幂等；删除函数移除它。
- [ ] 新增用例：一个已有分支的 branch-mode goal 写为 retired 后，分支不存在，且 statusLog 中进入 retired 的条目 reason 含原 tip 的 40 位 SHA。
- [ ] `plugin/test/target-identity-literal-check.test.mjs` 新增用例：`goal/GOAL-901` 在记录为 active + branch:true 时合法、retired 时非法、goal store 不可读时退出 3；突变用例 `plugin/scripts/checker-mutation-cases/target-identity-literal-check.sh` 同步更新后仍能把检查器打红。
- [ ] 取假：把本任务的核心改动临时回退（用 `cp` 备份恢复，⛔ 不用 `git checkout --`）后，上面新增用例至少 1 条变红；在 `## Evidence` 贴实跑输出与恢复后的绿输出。
- [ ] 对真实仓库跑 GOAL-028 的 AC-326 判据（`node packages/quay/bin/quay.js goal gate AC-326 --dry-run --json`），verdict 为 not-evaluated（此时尚无被放弃的 branch-mode goal）——证明判据与本实现的识别规则（frontmatter 独立一行 `branch: true`）一致；输出贴进 Evidence。
- [ ] `bash scripts/test.sh --for-task gap-goal-branch-data-model-and-lifecycle` 退出 0，且确实执行了 ≥1 个测试文件（非 thin；在 `## Evidence` 贴出被执行的测试文件名）。

## DoD

真实落地判据：人能对一个 goal 设 `branch: true`，激活后 `goal/<id>` 出现，放弃后分支消失且 tip SHA 可从 statusLog 取回。生产读数由 GOAL-028 的 AC-326 在一次真实的废弃演练后取得。

## Touches

- packages/quay/src/goal-store.ts
- packages/quay/src/branch-model.ts
- packages/quay/src/cli/goal.ts
- packages/quay/src/cli/help.ts
- packages/quay/src/abi.ts
- plugin/scripts/target-identity-literal-check.ts
- plugin/scripts/checker-mutation-cases/target-identity-literal-check.sh
- packages/quay/test/goal-store.test.mjs
- packages/quay/test/branch-model.test.mjs
- plugin/test/target-identity-literal-check.test.mjs
- tasks/gap-goal-branch-data-model-and-lifecycle.md
