---
id: gap-post-merge-verification-failure-batch
title: 合并后完整验证暴露多根因失败批次（8 文件，非 flake）：catalog QUESTION 表丢 cross-machine-verify /
  session-liveness 拆分后 B2-B4 断 / 文档断言未同步 / inert exclusion / loop-driver——逐个修
status: done
labels: []
parent: null
children: []
extra: {}
---
**type:** execution

## Proposal

**合并 integration→develop（a862c914）后的完整验证暴露失败批次。经红窗归因（管理者 2026-08-08 提示），本任务收窄为【独立项】——doc-asserting/install 家族已归 40→6 任务（gap-forty-to-six-remerge-needs-tests-updated-first，已升级 ready）持有根因，避免重复修同一根因。**

### 归因（本轮 8 失败文件分两类）

**A. 40→6 家族（doc-asserting/install——归 40→6 任务，本任务不碰）**
- inner-blocked-signal（tick must reference the CLI）
- loop-shipping-necessity（inert exclusion retainedNote）
- quay-session / session-topology / cold-start / session-bootstrap（bootstrap command / single-driver / 拓扑工厂引用）
- quay-init-loop-driver（laid-down driver）

这些断言期望 40→6 新行为，但 40→6 被回滚（7642849a）、实现是旧的。由 gap-forty-to-six-remerge 统一修测试再重合并。

**B. 独立项（本任务）**
1. **capability-catalog**：`unclassified: cross-machine-verify.sh`——合并丢 QUESTION 条目。该脚本来自独立任务 gap-no-post-merge（5674e0ea/05456e96，非 40→6 内容）；integration(354be03e) catalog 表含它（grep=1）、develop(7f43fc78) 不含（grep=0）。修：QUESTION 表补 cross-machine-verify 一行（从 integration 版本找回 question 文本）。
2. **session-liveness-events B2/B3/B4**：claude-as-pane alive=0，隔离 fail 3——session-liveness 拆 3 文件后检测测试断（helpers 的 pane_pid 检测可能被动）。查 session-liveness-helpers.mjs。

**C. serial 趟未跑（新现象，需调查）**
本轮日志只有 product,engine + lowconc 两趟 selected，**无 serial 3 files**。前几轮（r7/r9）red 也跑两趟 ⇒ 非既有行为。查 test.sh 主趟红后为何跳过 serial 趟（退出路径）。

### 处置方向

1. **catalog**：capability-catalog.sh 的 QUESTION 表补 cross-machine-verify（从 integration 354be03e 找回）；
2. **session-liveness B2-B4**：查 helpers 的 pane_pid 检测，拆分引入的问题修复；
3. **serial 未跑**：查 test.sh 主趟 fail 后的退出路径为何跳 serial（可能 set -e / 主趟红即退出），修复让 serial 趟照常跑。

**验证**：每项隔离 0-fail；serial 趟恢复跑；全量三趟 fail 0 / cancelled 0（与 40→6 修复后合并验证）。

## Contract

measure catalog_green = `cd /tmp/quay-suite-int && bash plugin/scripts/capability-catalog.sh --json >/dev/null 2>&1; echo $?` stdout 数字段（修复后 catalog exit 0）
measure liveness_events = `cd /tmp/quay-suite-int && timeout 90 node --test plugin/test/session-liveness-events.test.mjs 2>&1 | grep -E "^ℹ fail"` stdout 数字段（修复后 fail 0）
measure serial_runs = `grep -c "selected 3 files (groups=serial)" .quay/full-suite.log` stdout 数字段（修复后 serial 趟在场，≥1）
band catalog_green = 0 且 liveness_events = fail 0 且 serial_runs = ≥1
invoke `bash scripts/test.sh --for-task gap-post-merge-verification-failure-batch 2>&1 | tail -3`
control 每项隔离 0-fail；serial 趟恢复；全量三趟 fail 0 / cancelled 0（与 40→6 修复合并验证）
resume 若中断，先跑 measure 读 catalog exit + liveness fail + serial 趟数

## Acceptance Criteria

- [x] AC1: **catalog QUESTION 表**——补 cross-machine-verify（从 integration 找回）；catalog exit 0
      **证据**：commit 23ced8d7 → develop 6866da3f。integration 354be03e 的 QUESTION 行（supervisor-preempt 与
      sync-lag 之间）原样恢复。实跑：`capability-catalog.sh` → `159 scripts | 159 declared | 0 unclassified | 154 ship`，exit 0。
- [x] AC2: **session-liveness B2/B3/B4**——拆分后检测测试恢复（claude-as-pane alive=1）
      **证据**：commit 46255fcd → develop 6866da3f。合并（a862c914）把 integration 侧 a09ddb56 的
      `_is_claude_pid` + session_pid pane_pid 自检 + 窗口后缀解析（DEFAULT_TARGET 硬编码 :outer 剥掉 :inner）
      解析成 develop 旧版丢失。恢复后实跑：`session-liveness-events` B2/B3/B4 → **pass 3 / fail 0**。
- [x] AC3: **serial 趟恢复**——test.sh 主趟红后不再跳过 serial；serial 3 文件照常跑
      **证据**：commit f0092a70 → develop 6866da3f。原 `if [ "$code" -eq 0 ]` 守卫在主趟红时整段跳过 serial
      （round 95 只有 product,engine + lowconc 两趟 selected、无 serial 3 files）——serial 3 文件的失败不可见。
      改为无条件跑 serial（与 lowconc 同语义），serial exit code 合并进 `code`。实跑：
      `--group serial` → `selected 3 files (groups=serial)`（serial 趟在场）。
      **如实注**：serial 3 文件里 `quay-init-loop-core` 的 3 条失败是 **40→6 家族**（断言 manager-loop-tick.md
      须铺装，而 quay-init 未铺——7642849a 回滚后测试断言新行为、实现旧），归 gap-forty-to-six-remerge 任务。
- [x] AC4: 与 gap-forty-to-six-remerge（doc-asserting/install 家族归它）、
      gap-merge-introduced-referenced-not-landed-manager-tick-log（同批次合并问题）交叉标注
      **证据**：本任务 Proposal + AC3 注记录归属；gap-forty-to-six-remerge 任务体已列本批次同源。
- [ ] AC5: **全栈并发 8 绿**——与 40→6 修复合并后，全量三趟 fail 0 / cancelled 0
      **状态**：本批 3 项修复已落 develop；全量绿依赖 40→6 家族测试更新（quay-init-loop-core 等），未勾。

## Definition of Done

- [x] AC1-AC3 实跑输出贴任务体（每项修复前后隔离对照、serial 趟恢复前后）——见各 AC 证据
- [ ] 与 40→6 重合并合并验证后，全量三趟 fail 0 / cancelled 0——依赖 40→6 家族收口

## Touches
- plugin/scripts/capability-catalog.sh（QUESTION 表补 cross-machine-verify）
- plugin/test/session-liveness-events.test.mjs 或 plugin/test/session-liveness-helpers.mjs（B2/B3/B4）
- scripts/test.sh（serial 趟未跑调查——主趟红后退出路径）
- tasks/gap-forty-to-six-remerge-needs-tests-updated-first.md（AC4 交叉标注）
- tasks/gap-merge-introduced-referenced-not-landed-manager-tick-log.md（AC4 交叉标注）

## Dispatch review

reviewer: outer
at: 2026-08-08T01:0xZ
changed: 收窄批次任务（管理者 2026-08-08 红窗归因）：doc-asserting/install 家族归 40→6 任务（已升级 ready）
  持有根因，本任务只留独立项（catalog QUESTION 表补 cross-machine-verify、session-liveness B2-B4）
  + 新增 serial 趟未跑调查（本轮缺 serial 趟，管理者第一点）。避免同一根因修多次。
