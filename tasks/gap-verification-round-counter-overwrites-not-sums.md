---
id: gap-verification-round-counter-overwrites-not-sums
title: verification-round tests/pass/fail 是覆盖式计数器（最后一批），非套件总量
status: ready
labels:
  - gap
  - defect
  - mechanism
parent: null
children: []
extra: {}
---
**type:** execution

## Proposal

**实证（manager 2026-08-12 + outer git diff 核实）**：四条裁定落地后 rounds 的 `tests/pass/fail` 停在 0 而 `failures[]` 有真实内容——仪器自相矛盾。根因不是 ②/① 回归（git diff 两提交都没碰计数解析），是 **`full-suite-runner.ts:1324` 覆盖式计数器**：对每条 `ℹ pass N`/`ℹ fail N`/`ℹ cancelled N`（node:test spec reporter 每批一条）`tapPass = Number(m[1])` 覆盖不累加。所以 `tests` = **最后一批**的计数，从来不是套件总量（真实 ~3000）。

- rounds 4-8 的 `tests=145` 已经是错的（= 最后一批 145，非 ~3000）——既有缺陷非新引入。
- round-12（861s，16 失败）`tests=0`：kill-on-red 关闭 ⇒ 套件跑完，最后一批 summary 与 ①开启时的截断点不同 + 双套件事故污染流。
- round-13（确认套件，无双套件）结束后核对——若 `tests>0` 则坐实 round-12 的 0 是污染。

**选定机制**：`full-suite-runner.ts` 的 onLine 里 `ℹ pass/fail/cancelled` 从覆盖改为**累加**（`tapPass += Number(m[1])`），或改为从 per-file 可靠计数（`__PERFILE__ passed=` 逐文件累加）推导。两者选一，测试覆盖。

**验证锚**：(a) 多批运行后 `tests` = 各批之和（非最后一批）；(b) 单批运行行为不变；(c) `--for-task` scoped 门绿；(d) 既有 full-suite-runner 测试绿。

## Plan

1. 读 `full-suite-runner.ts` onLine 的 tapPass/tapFail/tapCancelled 解析（~:1320）。
2. 决定口径：累加 `ℹ` 行 vs 从 `__PERFILE__` 逐文件数。推荐后者（PERFILE 每文件一条、passed=bool 可靠、不受批次 summary 顺序影响）。
3. 改 + 单测（构造多批流：两批各 `ℹ pass 5` ⇒ tests=10 非 5）。
4. 回归：full-suite-runner 测试 + `--for-task` scoped + 确认一轮验证。

## AC

- [ ] AC1: 多批运行 `tests/pass/fail` = 各批之和（覆盖式不复现）
- [ ] AC2: 单批运行行为不变（不回归）
- [ ] AC3: `failures[]` 与 `tests/pass/fail` 不自相矛盾（有失败行 ⇒ fail≥1 或 cancelled≥1）
- [ ] AC4: 新测试覆盖 (a)(b)(c)；`--for-task` scoped 门绿
- [ ] AC5: 既有 full-suite-runner 测试全绿

## Definition of Done

- [ ] AC1–AC5 全部勾上
- [ ] 修后实跑：多批流 tests=和贴出（见 Evidence）
- [ ] 既有测试 + 新增测试全绿（`--for-task` scoped）
- [ ] 全量套件绿（`fail 0` 且 `cancelled 0` 且 `FULL-SUITE-EXIT=0`）——外层 verification-round 验证

## Touches

- plugin/scripts/full-suite-runner.ts（onLine 的 tapPass/tapFail/tapCancelled 覆盖→累加）
- plugin/test/full-suite-runner.test.mjs（多批流用例）
- tasks/gap-verification-round-counter-overwrites-not-sums.md（自身：勾 AC + 贴证据）
