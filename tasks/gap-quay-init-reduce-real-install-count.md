---
id: gap-quay-init-reduce-real-install-count
title: 8 个 real-install 测试文件 ~40 次真安装——torn-read 族可 source 直调函数免安装
status: done
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

- [x] AC1（能取假，免安装）：torn-read 族（consumer-doc-refs + quay-init）改 source 直调后真安装次数下降，稳定性断言强度不变；（⛔ 仍走完整安装 ⇒ 假）。
- [x] AC2（能取假，负控制保留）：AC2/AC37/AC91 negative 仍断言 verify 失败（verify 门不被免安装绕开）；（⛔ 负控制失效 ⇒ 假）。
- [x] AC3（能取假，dry-run 覆盖）：若走 dry-run/--verify-only 路线，先证明该路径覆盖到被测门（verify_referenced_landed 确被跑）；（⛔ 未证明 ⇒ 假，硬规则 4c）。**实际未走 dry-run/--verify-only**——torn-read 负控制直调 `verify_referenced_landed`（被测门本身），其 FAIL 输出即「门确被跑」的证明（强于 dry-run 覆盖证明）。

## Definition of Done

torn-read 族免完整安装、真安装次数下降；AC1-AC3 全勾；套件绿；serial+lowconc 重叠窗口下降（无需设数值阈值）。

## Implementation

1. `plugin/scripts/quay-init.sh` 变可 source：加 library-mode guard（`BASH_SOURCE[0] != $0` 时 `return 0`，置于全部函数定义之后、安装流之前）；把 `verify_referenced_landed` 内嵌的 `_read_declarations` 提为顶层函数（成功设全局 `QUAY_INIT_SELFCREATE`/`QUAY_INIT_REFDOC`，verify 改读全局）——**执行路径行为不变**（`bash -n` 过；`--check-drift` 执行态实测正常）。
2. torn-read 族 8 个测试改 `runSourced`（`bash -c 'source quay-init.sh; <fn>'`，arg 经 `_fargs` 传入、source 前 `set --` 清空 `$@` 以避 quay-init 顶层参数解析拒收）；稳定性/control 直调 `_read_declarations` / `_read_references` / `derive_loop_scripts`，负控制直调 `verify_referenced_landed` 对 `laydownWorkspace()` 复制跑（共享 fixture，非新安装）。
3. 真安装：torn-read 族 8 个 per-test 安装 → 0；目标文件 targeted 验证 `node --test` 8/8 + 13/13 全绿。AC2/AC37/AC91 negative（`runInit` 真安装，非 torn-read 族）未动，仍断言 verify 失败。

## Touches

- plugin/test/quay-init-loop-consumer-doc-refs.test.mjs（torn-read 族 source 直调）
- plugin/test/quay-init.test.mjs（torn-read 族 source 直调）
- plugin/scripts/quay-init.sh（library-mode guard + `_read_declarations` 提为顶层；未增 --verify-only）
- tasks/gap-quay-init-reduce-real-install-count.md（自身）
