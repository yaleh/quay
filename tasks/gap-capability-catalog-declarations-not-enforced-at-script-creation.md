---
id: gap-capability-catalog-declarations-not-enforced-at-script-creation
title: "capability-catalog regressed twice this session (14 scripts entered artifact undeclared) — the AC1c gate exits 1 but the scoped static-tier defers it to full-suite, so a task creating plugin/scripts/* ships green and the catalog turns red only at the outer's verification round; fix: include capability-catalog in the scoped tier for tasks whose Touches create plugin/scripts/* files, or a creation-time check"
status: ready
labels:
  - gap
  - defect
parent: null
children: []
extra: {}
---
**type:** execution

## Proposal

**capability-catalog 的 AC1c 声明闸在任务创建新脚本时不被强制——本会话两次回归，14+ 脚本未声明就进 artifact。**

**证据（2026-08-05/06 实测）**：
- 第一次回归（16:5xZ）：cap-from-gate.sh/ts + inner-session-check.sh 3 个未声明（修 `d20673a2`）。
- 第二次回归（00:4xZ）：claim-task.sh/ts、dead-loop-check.sh、fork-baseline.ts、integration-batch-merge.sh、
  laydown-set-check.sh、release-task.sh、self-report-vocab-audit.ts、slot-refill.ts、test-file-snapshot.sh、
  verify-delivery-surface.ts **11 个未声明**（修 `73355f46`）。
- **共 14 个脚本进入 artifact 时未声明 question**——都是任务创建的新脚本。

**根因**：capability-catalog 的 AC1c gate（unclassified > 0 ⇒ exit 1）存在，但：
1. **scoped 静态层不强制它**——`select-static-checks-for-touches` 只选「change-relevant」checkers；
   capability-catalog 的对象是 `plugin/scripts/*`（glob），但新脚本任务的 scoped 跑通常不含它 ⇒ 任务绿、
   catalog 红，到外层全量验证才暴露。
2. **建任务/派发时不查**——任务的 ## Definition of Done

- [ ] AC1-AC5 全勾（任务 Touches 含 plugin/scripts/* 新建 ⇒ scoped 静态层含 capability-catalog 检查；未声明新脚本 ⇒ scoped 红；已声明 ⇒ 绿不误伤；负控制只查新脚本不重扫全 artifact；测试 node:test + @test-group governance）
- [ ] 创建时暴露实测：新脚本未声明 catalog ⇒ scoped 门红（非全量时）
- [ ] scoped 门 `scripts/test.sh --for-task gap-capability-catalog-declarations-not-enforced-at-script-creation` 绿

## Touches 声明 `plugin/scripts/xxx.sh（新建）` 时不检查该 basename
   是否已在 catalog 声明。

**为什么重要**：catalog 是「每个 check 声明它答什么问题」的可见性机制。新脚本不声明 ⇒ 可见性回归，
且修复总是事后补（两个 wave 都是我在 fan-in 时补的）。这是**进入 artifact 的入口闸**，应在创建时而非
全量时强制。

**选定机制方向**：
1. **scoped 静态层加入**：任务 Touches 含 `plugin/scripts/*` 新建文件 ⇒ scoped 跑含 capability-catalog
   （unclassified 新条目 ⇒ scoped 红，创建时即暴露）。
2. **派发闸检查**（更早）：派发前对 Touches 中的 `(new)` plugin/scripts 路径跑 catalog 声明检查，
   未声明 ⇒ 不派发。
3. 或两者结合（scoped 层保底，派发闸提前）。

**负控制**：不误伤存量——只查「新创建」的脚本（Touches `(new)` 标注或 git 未跟踪），不重扫全 artifact。

## Acceptance Criteria

- [ ] AC1: 任务 Touches 含 `plugin/scripts/*` 新建文件 ⇒ scoped 静态层含 capability-catalog 检查
- [ ] AC2: 该任务在 catalog 未声明其新脚本 ⇒ scoped 红（创建时暴露，非全量时）
- [ ] AC3: 已在 catalog 声明的脚本（如 claim-task.sh 等 11 个已补）⇒ scoped 绿（不误伤）
- [ ] AC4: 负控制——只查 Touches `(new)` / 未跟踪的新脚本，不重扫全 artifact（存量 0 影响）
- [ ] AC5: 测试 `node:test` + `// @test-group governance`

## Touches

- tasks/gap-capability-catalog-declarations-not-enforced-at-script-creation.md（自身文件：勾 AC + 贴 invoke 证据授权）

- plugin/scripts/select-static-checks-for-touches.ts（scoped 静态层：新脚本任务含 capability-catalog）
- plugin/scripts/capability-catalog.sh（保持；消费端不变）
- plugin/test/select-static-checks-for-touches.test.mjs（AC1-AC4 测试）
- tasks/gap-eighty-two-shipped-checks-and-none-says-what-it-answers.md（交叉标注：capability-catalog 源任务）

## Contract

measure   catalog_in_scoped = `node --experimental-strip-types plugin/scripts/select-static-checks-for-touches.ts <new-script-task>` stdout 含 capability-catalog
band      catalog_in_scoped >= 1（新脚本任务 scoped 层含 catalog 检查）
invoke    `bash plugin/scripts/capability-catalog.sh --json`（0 unclassified 保持）
control   未声明新脚本的任务 scoped 红（AC2）；已声明的不误伤（AC3）
resume    scoped 层与负控制分两步提交，任一步完成即写盘

## Dispatch review

reviewer: outer
at: 2026-08-06T03:1xZ
changed: 补充 Dispatch review 段（红窗分诊：contract-check ratchet 报 dispatch-review-missing，
由外层补写；任务本身 todo 待派发，范围不变）。
