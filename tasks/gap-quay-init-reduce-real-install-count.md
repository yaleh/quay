---
id: gap-quay-init-reduce-real-install-count
title: 8 个 real-install 测试文件 ~40 次真安装——torn-read 族可 source 直调函数免安装
status: todo
labels:
  - gap
parent: null
children: []
extra: {}
---
**type:** execution

## Proposal

8 个 real-install/session-liveness 文件合计 ~40 个真安装，文件内 node:test 串行 → 单文件 ~33s×N 延迟链。torn-read 族（consumer-doc-refs ~7 + quay-init ~3 个真安装）只测稳定性检查（重试 + verify-referenced-landed: OK），可 **source quay-init.sh 直接调 `_read_declarations` / `_reference_set_once` / `derive_loop_scripts`**（假 grep 注入保留），免完整安装。

## Plan

1. torn-read 族改 source quay-init.sh 直调函数（保留假 grep 注入），免完整安装。
2. ⚠️ `--dry-run` 不跑 verify_referenced_landed（`[ "$DRY_RUN" != true ]` 门控）——若走 dry-run 路线，AC 必须先证明 dry-run 覆盖到被测路径，否则改法无效（硬规则 4c：判据穿过中间层）。
3. 负控制（AC2/AC37/AC91 negative 等）只断言 verify 失败：考虑给 quay-init 增 `--verify-only`（对已装 workspace 重跑门，`--check-drift` 只读同胞），负控制改对 fixture 复制跑。⛔ 此项若增产品入口与任务 A 有交集——实现前先核 A 是否已加，避免重复。

## Acceptance Criteria

- [ ] AC1（能取假，免安装）：torn-read 族（consumer-doc-refs + quay-init）改 source 直调后真安装次数下降，稳定性断言强度不变；（⛔ 仍走完整安装 ⇒ 假）。
- [ ] AC2（能取假，负控制保留）：AC2/AC37/AC91 negative 仍断言 verify 失败（verify 门不被免安装绕开）；（⛔ 负控制失效 ⇒ 假）。
- [ ] AC3（能取假，dry-run 覆盖）：若走 dry-run/--verify-only 路线，先证明该路径覆盖到被测门（verify_referenced_landed 确被跑）；（⛔ 未证明 ⇒ 假，硬规则 4c）。

## Definition of Done

torn-read 族免完整安装、真安装次数下降；AC1-AC3 全勾；套件绿；serial+lowconc 重叠窗口下降（无需设数值阈值）。

## Touches

- plugin/test/quay-init-loop-consumer-doc-refs.test.mjs（torn-read 族 source 直调）
- plugin/test/quay-init.test.mjs（torn-read 族 source 直调）
- plugin/scripts/quay-init.sh（若增 --verify-only，与任务 A 边界协调）
- tasks/gap-quay-init-reduce-real-install-count.md（自身）
