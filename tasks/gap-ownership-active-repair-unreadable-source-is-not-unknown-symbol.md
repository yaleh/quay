---
id: gap-ownership-active-repair-unreadable-source-is-not-unknown-symbol
title: repair loop folds "declared source file unreadable at the locked commit"
  into UNKNOWN_SYMBOL — split it into a distinct not-evaluated state so the
  judge is told the file path is wrong, not that the symbol is fabricated
status: todo
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: execution
depends_on:
  - gap-ownership-active-repair-unknown-symbol-guard-false-positive
---
**type:** execution

## Finding

<!-- dedup-ref -->
`gap-ownership-active-repair-unknown-symbol-guard-false-positive`(fan-in 中)把修复环的符号存在性判据改为"图边 importedNames ∪ move 声明源文件在锁定 commit 上的真实导出"——方向正确、严格更强。但按位置核实其实现(该任务 worktree 中 `docs/analysis/ownership-active-proposal-repair.mjs` 的 `declaredExportsForMoves`,约第 199-209 行):一个 move **没有 `file`**、**路径无法规范化**、或**该 blob 在锁定 commit 上读不到**(文件不存在/是目录/是之后才新建的文件)时,映射为**空导出集合**;调用方 `unknownSymbols` 随后把该 move 的所有非边承载符号判为 unknown,`attemptRepair`(约第 490-491 行)以 `bucket:"unknown_symbol", matched:"UNKNOWN_SYMBOL"` 作废该轮。

即:"**无法评估**(拿不到源文件)"与"**已评估为否**(文件在、符号不在)"落进同一个输出形状——硬规则 3b("读不懂输入时不得返回与另一个实质结论同形的值";判据:词表里没有"未评估"这一态就无法区分"查过"与"没查成")。同一函数的注释自己写着 "could not read the file must never be reported in the same shape as the file proves the symbol",但这条保证只在函数内部成立,穿过调用方后丢失(硬规则 4c)。这与刚修掉的那类读法错误同源(把"拿不到证据"读成"符号是编造的"),由「Quay refactor architecture liaison」2026-10-11 指出、本侧按位置核实。

**后果**:方向仍是 fail-closed(不会放过任何东西),但①记录对真实存在的符号留下错误的"unknown"结论;②反馈给 judge 的是"符号未知",而真实问题是 **move.file 写错/文件不存在**——judge 会去改符号而不是改文件路径,在有界轮次里朝错误方向修。

**发生率**:生产中 0 次观测(上游修复尚未落地)。本任务不是新机制/新前置,而是对刚落地判据的输出词表补一个缺失的"未评估"态——硬规则 5b(在一处修好 X ≠ X 只在一处)。保持小改动。

保持分离而非并入上游的理由:上游任务已在 fan-in,不中途改其规格;本任务以 `depends_on` 串行,修改同一文件。

## AC

- [ ] AC1 `declaredExportsForMoves`(或其替代)对每个 move 区分三态:`exports`(读到文件,给出导出集合)/ `source_unreadable`(无 `file`、路径不可规范化、或锁定 commit 上读不到该 blob,附原因码)——不得再把后者表示为空集合。
- [ ] AC2 `attemptRepair` 对 `source_unreadable` 记录**独立**的 bucket/matched(例如 `source_unreadable` / `MOVE_SOURCE_NOT_AT_COMMIT`),不是 `unknown_symbol`;该轮仍不计算 delta、仍消耗轮次(fail-closed 不放宽);给 judge 的反馈文本点名"move.file 在锁定 commit 上不存在/不可读",不点名符号为未知。
- [ ] AC3 负对照①:move.file 指向锁定 commit 上不存在的路径(如 `gate/config/does-not-exist.ts`)、符号为真实导出 ⇒ 记录 `source_unreadable`,不出现 `UNKNOWN_SYMBOL`。
- [ ] AC4 负对照②(守卫仍有牙):move.file 正确、符号为编造名(`fabricatedLoaderFn`)⇒ 仍记录 `UNKNOWN_SYMBOL`;move.file 正确、符号为不与任何真实导出冲突的近似拼写(`loadWorkspaceGatez`,`git grep -w` 在 `packages`/`plugin/scripts` 0 命中)⇒ 仍为 `UNKNOWN_SYMBOL`。
- [ ] AC5 既有回归与上游任务的 AC2/AC3/AC4 测试全绿;准入门限/streak=3/fail-closed/只写 draft 不触碰;`bash scripts/test.sh --for-task gap-ownership-active-repair-unreadable-source-is-not-unknown-symbol` exit 0。

## DoD

修复环的符号存在性判据输出三态,"拿不到源文件"与"源文件里没有该符号"在记录与 judge 反馈上可区分;编造名与近似拼写仍被拦。⛔ 不改 ArchGuard,不放宽任何准入/fail-closed 行为,不创建/激活任何 Goal。

## Touches

- docs/analysis/ownership-active-proposal-repair.mjs
- plugin/test/ownership-active-proposal-repair.test.mjs
- tasks/gap-ownership-active-repair-unreadable-source-is-not-unknown-symbol.md
