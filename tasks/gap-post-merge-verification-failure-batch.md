---
id: gap-post-merge-verification-failure-batch
title: 合并后完整验证暴露多根因失败批次（8 文件，非 flake）：catalog QUESTION 表丢 cross-machine-verify /
  session-liveness 拆分后 B2-B4 断 / 文档断言未同步 / inert exclusion / loop-driver——逐个修
status: ready
labels: []
parent: null
children: []
extra: {}
---
**type:** execution

## Proposal

**合并 integration→develop（a862c914）后的完整验证暴露多根因失败批次（8 文件）。manager-tick-log referenced-not-landed 已修（7f43fc78）；剩余是合并首次把 integration 代码带进 develop 后，配套声明/引用/拆分未同步的确定性失败（非 flake，隔离复现）。**

### 实测（合并后第 2 轮全量 850s red，真实失败 8 文件）

| 失败文件 | 根因 | 隔离复现 |
|---|---|---|
| capability-catalog | **cross-machine-verify.sh 缺 QUESTION 声明**：integration(354be03e) catalog 表含它（grep=1），develop(7f43fc78) 不含（grep=0）——合并丢了 integration 的 catalog 条目 | 是（catalog exit 1, unclassified=cross-machine-verify） |
| session-liveness-events | B2/B3/B4 claude-as-pane alive=0——session-liveness 拆分后检测测试确定性失败 | 是（隔离 fail 3） |
| quay-session / session-topology / cold-start / session-bootstrap | 文档断言：cold-start must reference bootstrap command / single-driver check / 拓扑工厂——引用未同步 | 待逐个确认 |
| inner-blocked-signal / loop-shipping-necessity | inert FILE-level exclusion 缺 retainedNote / tick assert-before-stop | 待确认 |
| quay-init-loop-driver | laid-down driver 断言 | 隔离 pass 13/fail 2 |

### 处置方向

1. **capability-catalog**：capability-catalog.sh 的 QUESTION 表补 cross-machine-verify 一行（从 integration 354be03e 版本找回 question 文本）；
2. **session-liveness-events B2/B3/B4**：拆分后 helpers/环境变化导致 claude-as-pane 检测 fail——查 session-liveness-helpers.mjs 的 pane_pid 检测逻辑（拆分可能动了它）；
3. **文档断言（bootstrap/single-driver/拓扑工厂）**：合并引入新引用但文档没同步——逐个对齐（可能仍是 reference-doc 声明或文档措辞）；
4. **inert exclusion / tick assert-before-stop**：loop-shipping-exclusion-data.mjs 补 retainedNote 或移除 inert 项；
5. **quay-init-loop-driver**：laid-down driver 断言对齐。

**逐个验证**：每个根因修完隔离重跑对应文件 pass 0 fail；全部修完全量三趟 fail 0 / cancelled 0。

## Contract

measure catalog_green = `cd /tmp/quay-suite-int && bash plugin/scripts/capability-catalog.sh --json >/dev/null 2>&1; echo $?` stdout 数字段（修复后 catalog exit 0）
measure liveness_events = `cd /tmp/quay-suite-int && timeout 90 node --test plugin/test/session-liveness-events.test.mjs 2>&1 | grep -E "^ℹ fail"` stdout 数字段（修复后 fail 0）
band catalog_green = 0 且 liveness_events = fail 0
invoke `bash scripts/test.sh --for-task gap-post-merge-verification-failure-batch 2>&1 | tail -3`
control 每个根因隔离重跑 pass 0 fail；全量三趟 fail 0 / cancelled 0
resume 若中断，先跑 measure 读 catalog exit + liveness fail 数

## Acceptance Criteria

- [ ] AC1: **capability-catalog**——QUESTION 表补 cross-machine-verify（从 integration 版本找回）；catalog exit 0
- [ ] AC2: **session-liveness-events B2/B3/B4**——拆分后检测测试恢复（claude-as-pane alive=1）
- [ ] AC3: **文档断言**——cold-start bootstrap command / single-driver / 拓扑工厂引用对齐（各文件隔离过）
- [ ] AC4: **inert exclusion / tick assert-before-stop**——loop-shipping-exclusion-data 补 retainedNote 或移除；tick 文档补引用
- [ ] AC5: **quay-init-loop-driver**——laid-down driver 断言恢复
- [ ] AC6: **全栈并发 8 绿**——全量三趟 fail 0 / cancelled 0

## Definition of Done

- [ ] AC1-AC5 实跑输出贴任务体（每个根因修复前后隔离对照）
- [ ] 并发 8 全量套件连跑 2 次全绿（fail 0 且 cancelled 0）

## Touches
- plugin/scripts/capability-catalog.sh（QUESTION 表补 cross-machine-verify）
- plugin/test/session-liveness-events.test.mjs 或 plugin/test/session-liveness-helpers.mjs（B2/B3/B4）
- plugin/skills/cold-start/SKILL.md 或相关文档（bootstrap/single-driver/拓扑工厂引用）
- plugin/scripts/loop-shipping-exclusion-data.mjs（retainedNote）
- 相关 tick 文档（assert-before-stop）
- tasks/gap-merge-introduced-referenced-not-landed-manager-tick-log.md（AC6 交叉标注：同批次）

## Dispatch review

reviewer: outer
at: 2026-08-08T00:5xZ
changed: 合并后第 2 轮全量 red（8 文件，非 flake 隔离复现）。根因：合并首次把 integration 代码带进 develop，
  配套声明/引用/拆分未同步——catalog QUESTION 表丢 cross-machine-verify（integration 有、develop 无）、
  session-liveness 拆分后 B2/B3/B4 断、文档断言未同步等。manager-tick-log 已单独修。建批次任务逐个修。
