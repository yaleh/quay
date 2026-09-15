---
id: gap-ac263-marketplace-channel-has-no-dist-closure-gate
title: 主发布渠道（marketplace/publish-dist-branch）没有 dist 闭包闸——有闸的是次渠道 npm tarball，主渠道裸奔
status: todo
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
depends_on:
  - gap-dist-plugin-invoker-rewrite-emits-unresolvable-plugin-paths
goal_ac: AC-263
---
**type:** execution

## Proposal

**根因**：`--verify-closure` 只校验 **npm tarball** —— `packages/quay/scripts/package.sh:193-206` 调用，实现是 `packages/quay/scripts/build-plugin-dist.mjs:434-442` 的 `verifyDistClosure` + `:415-419` 的 `closureMissing`，匹配的是 **pack listing** 里的 `*/scripts/dist/<name>.js`。

marketplace 渠道走的是 `plugin/scripts/publish-dist-branch.sh`（`:127` 跑 build-plugin-dist、`:133` 删 raw `.ts`、`:139` 跑 `--rewrite`），**无任何等价断言**（当轮 grep：该脚本内 closure 零命中）。而 `orchestration/SPEC-plugin-lifecycle-single-bundle-2026-09-02.md:139` 恰恰把 marketplace 声明为**主发布渠道** ⇒ **有闸的是次渠道，主渠道裸奔。**

**两条渠道的读法不同，不能照搬**：tarball 侧的 verifier 吃的是 `npm pack` 的 listing（一串文件名文本）；publish 路径面对的是**目录形态**的待发布树，需要另一条读法（遍历目录 / 对 markdown 引用集做存在性核对）。

**闸必须能取假，且必须中止发布**：`|| exit` 守卫或 `set -e` 覆盖到该断言——否则闸失败也不中止发布，就成了一个**结构上不可能报红的检查**，而「不产生新红」正是这种检查会给出的结果（硬规则 3b：恒绿的检查是一个假的保证，比没有检查更贵）。

**为什么串行于 AC-260 那条**：本条与 `gap-dist-plugin-invoker-rewrite-emits-unresolvable-plugin-paths`（AC-260 的承接条）都改 `packages/quay/scripts/build-plugin-dist.mjs` ⇒ 声明 `depends_on` 以免 Touches 争用（两条并发会互相锁）。⚠️ 2026-09-15 并发立案撞车的结果：原先这条边指向 `gap-ac260-shipped-skill-dist-paths-carry-cwd-relative-plugin-prefix`，人复核后保留更全面的那条（覆盖 `rewriteShell()` 同形 + 全载体 260 条 + 11 条悬空 raw `.ts`）并删除重复条，故本条的前置边已换成保留的那一条；**依赖理由未变**。

**查重（按机制）**：全店搜 `verifyDistClosure` 命中 **0** 条任务 ⇒ 没有既存任务承接「publish 路径缺闭包闸」。`gap-delivery-laydown-dist-closure-gap`（done）改的是 quay-init 的闭包正则，属 laydown 侧、不是 publish 侧。

## Contract

measure publish_closure_gate_verdict = `bash plugin/scripts/publish-dist-branch.sh` 路径上闭包断言的 exit_code 与 missing_bundles 列表两个读数
band n/a: 闸门判词 + 缺失清单判据，无数值区间
invariant gate_can_take_false = 删掉一个被 markdown 引用的 dist bundle ⇒ publish 路径非零退出并中止，⛔ 不是打印告警后继续发布
invoke `bash plugin/scripts/publish-dist-branch.sh`
control 突变用例：从待发布树里删掉一个被引用的 scripts/dist/*.js ⇒ 闸必须红且后续推送步骤未执行；恢复 ⇒ 绿
resume 重跑 publish-dist-branch.sh 并读该闸的 exit_code 与 missing_bundles

## Acceptance Criteria

- [ ] AC1：publish 路径（`plugin/scripts/publish-dist-branch.sh`）有一个与 tarball 侧 `verifyDistClosure` 等价的 dist 闭包断言，按**目录形态**读待发布树（tarball 侧吃 pack listing，这里需要另一条读法），命中「被 markdown 引用但未落地的 dist bundle」时列出缺失项。
- [ ] AC2：闸**能取假且会中止发布**——`|| exit` 守卫或 `set -e` 覆盖到该断言；负控制实测「闸红 ⇒ 脚本非零退出 ∧ 后续推送步骤未执行」。⛔ 不接受「打印 WARN 但照样发布」（那是一个结构上不可能报红的检查，与「验过了」同形）。
- [ ] AC3：mutation case 钉住红面——`plugin/test/publish-dist-branch-closure-gate.test.mjs` 删掉一个被引用的 dist bundle ⇒ 闸红；恢复 ⇒ 绿（红绿两面都在测试里，不靠一次手跑）。
- [ ] AC4：真实交付面读数——在当前 `dist-plugin` 交付面上跑该闸，产出的 exit_code 与 missing_bundles 列表写进 `## Evidence`（生产载体读数，非 fixture）。

## Definition of Done

- [ ] AC1–AC4 全勾；按 inherited-core 的标准 DoD，REAL LANDING 是门槛——AC4 取自真实交付面，不是只在夹具上绿。
- [ ] 前置 `gap-dist-plugin-invoker-rewrite-emits-unresolvable-plugin-paths`（AC-260 的承接条）已落地后再动 `build-plugin-dist.mjs`（两条共享该文件，串行以免争用）。
- [ ] scoped 门 `bash scripts/test.sh --for-task gap-ac263-marketplace-channel-has-no-dist-closure-gate` 绿；全量由 fan-in 机械跑。

## Dispatch review

reviewer: human
at: 2026-09-15
changed: 立案当轮：无（根因、串行前置、目录形态读法要求均按人给定原样落盘）。2026-09-15 并发立案撞车修正：`depends_on` 由 gap-ac260-shipped-skill-dist-paths-carry-cwd-relative-plugin-prefix 换成人复核保留的 gap-dist-plugin-invoker-rewrite-emits-unresolvable-plugin-paths，Proposal 与 DoD 里的同一处 id 引用同步改口（依赖理由未变：两条都改 build-plugin-dist.mjs，必须串行以免 Touches 争用）

## Touches

- plugin/scripts/publish-dist-branch.sh
- packages/quay/scripts/build-plugin-dist.mjs
- plugin/test/publish-dist-branch-closure-gate.test.mjs (new)
- tasks/gap-ac263-marketplace-channel-has-no-dist-closure-gate.md
