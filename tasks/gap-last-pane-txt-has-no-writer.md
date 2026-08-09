---
id: gap-last-pane-txt-has-no-writer
title: "`.quay/last-pane.txt` 是没有写入者的死文件——mtime 4h 陈旧、无任何脚本写它（只有测试 fixture
  提及），A7 对着死快照永远判 busy/reset/0/3，inner 卡多久都不写块"
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

**`.quay/last-pane.txt` 是没有写入者的死文件——mtime 12:07:36（已 4 小时未更新），grep plugin/scripts 全部 .sh/.ts 无任何脚本写它（只有 checker-mutation-case 一个测试 fixture 提及）。A7 `inner-blocked-signal.ts --detect-stop --pane .quay/last-pane.txt` 对着这个死快照判 `pane_decision=busy branch=reset consecutive=0/3`——永远 busy、永远 reset、永远攒不到 3，inner 卡多久都不会写块。「看 inner 卡住没有」的机制存在但读到的是死数据。**

### 实证（manager 2026-08-09 实测 + outer 复核）

- **mtime 12:07:36 vs 此刻 16:03:32**：4 小时未更新。
- **内容对不上**：文件里写 `6 monitors still running`，inner 实况 pane 是 `1 shell`。
- **无写入者**：`grep -rln "last-pane.txt" plugin/scripts/ scripts/` 只命中 `checker-mutation-cases/manager-observation-runtime-check.sh`（一个测试 fixture 目录），无任何 `> .quay/last-pane.txt` / `capture-pane ... last-pane` 的写入点。只有若干 .md 文档提到它。
- **后果**：A7 判据是死的——`pane_decision=busy branch=reset consecutive=0/3`，永不触发停止条件。inner 卡在权限对话框/选择框多久，外层都看不到。

**为什么重要**：这是「机制存在但读死数据」——外层看 inner 停摆的机制（A7）实际不可用，属于 manager 说的「读数在场没被判」族的机制根。`1/4` 是读数在但没被判；这是读数（快照）本身没写入者，比没被判更底层。

**修的方向（实现归内层）**：
- 候选 A：**补写入者**——谁 capture pane、多久一次、写哪。应有一个常驻/每 tick 的 capture 把 inner pane 实况写进 `.quay/last-pane.txt`（如 capture-pane 每 30s 或 inner tick 时写）。
- 候选 B：**A7 改读活源**——`inner-blocked-signal.ts` 直接 `capture-pane` 实时读，不依赖磁盘快照（消除「快照陈旧」整类）。
- 候选 C：**移除死文件依赖**——A7 改为读 session-liveness 的实时输出或直接 pane，`.quay/last-pane.txt` 若不再被写就从判据链删除。

**验证锚**：修后，(a) `.quay/last-pane.txt` 有真实写入者（mtime 新鲜或改读活源）；(b) inner 停在 permission-prompt 时 A7 能检测（不再永远 reset）；(c) 正常忙碌不误报。

## Acceptance Criteria

- [ ] AC1: **复现固化**——任务体记录实证（mtime 4h 陈旧 + 无写入者 + A7 永远 reset + 内容对不上）（本任务 Proposal 已含；内层补：跑 A7 复现永远 reset）
- [ ] AC2: **写入者补齐或改读活源**——`.quay/last-pane.txt` 有真实写入（mtime 新鲜）或 `inner-blocked-signal.ts` 改实时 capture-pane 读 pane（候选 A/B 任一）
- [ ] AC3: **停止条件可触发**——inner 停在 permission-prompt/waiting-input 时 A7 能攒到连续 3 次并写块（不再永远 busy/reset）
- [ ] AC4: **正常忙碌不误报**——inner 正常干活时不误触发停止（负控制）
- [ ] AC5: **既有机制不回归**——`--for-task` scoped 门绿（含 inner-blocked / pane 契约检查）

## Definition of Done

- [ ] AC1–AC5 全部勾上
- [ ] 修后实跑：构造 inner 停 permission-prompt ⇒ A7 检测到并写块；mtime 新鲜（贴任务体）
- [ ] 既有测试 + 新增测试全绿（`--for-task` scoped）
- [ ] 全量套件绿（`fail 0` 且 `cancelled 0` 且 `FULL-SUITE-EXIT=0`）——外层 verification-round 验证

## Touches

- plugin/scripts/inner-blocked-signal.ts（候选 B：改实时 capture-pane 读 pane，或候选 A 的写入者）
- plugin/scripts/session-liveness.sh 或调度（候选 A：写入者——capture 频次 + 落盘）
- orchestration/orchestrator-tick-core.md（A7 判据——核实改读活源后文档同步）
- tasks/gap-last-pane-txt-has-no-writer.md（自身：勾 AC + 贴证据）

## Contract

measure   last_pane_staleness = `stat -c %Y .quay/last-pane.txt` 的 mtime 距 now 的秒数（或 inner-blocked-signal 判据是否可触发）
band      last_pane_staleness = ≤ 300s（新鲜；或改读活源后不依赖此文件）
invariant blocked_detectable = 1（inner 停 permission-prompt ⇒ A7 能检测写块）
invariant busy_not_false_positive = 1（正常忙碌不误报）
invoke    `node --no-warnings --experimental-strip-types plugin/scripts/inner-blocked-signal.ts --detect-stop --target inner --pane .quay/last-pane.txt`（修后实跑贴回）
control   inner 停 ⇒ 可检测；正常忙 ⇒ 不误报；mtime 新鲜
resume    写入者 / 活源改造 / 判据链清理分步提交，任一步完成即写盘

## Dispatch review

reviewer: outer
at: 2026-08-09
changed: 建任务（manager 实测：last-pane.txt 无写入者 4h 陈旧，A7 永远 reset 看不到 inner 卡住；同 ADR-033「读数无法表达关键区别」源。实现归内层）
