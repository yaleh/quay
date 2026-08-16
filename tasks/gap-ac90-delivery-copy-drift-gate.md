---
id: gap-ac90-delivery-copy-drift-gate
title: "AC90: 交付副本与正本的漂移必须有【接线的】闸——现状自称有、实查无（硬规则⑨教科书形状）"
status: todo
labels:
  - gap
  - mechanism
parent: null
children: []
extra:
  schema: execution
depends_on: []
---

**type:** execution

## Proposal

**判据正本（直接引用，勿转述）**：`orchestration/manager-phase-goal.md` 「🆕 AC90–AC93」区块 → `### AC90`。

**实测（一条命令可复算，manager 已跑过）**：交付的执行核副本 `plugin/loop/` 与正本 `orchestration/`
存在大量漂移（manager-tick-core 114 行 / fast-mode-tick-core 46 行 / manager-loop-tick 2198 行差异）；
`orchestration/manager-tick-{criteria,closing,sending}.md`（466 行判准正本）在 `plugin/` 内**无对应文件**
⇒ 交付面根本没有这三件；`plugin/sync.sh:15` 自称有 CI 防漂闸但 `grep .github/workflows/ = 0`、
`grep scripts/ = 0`、plugin/test 只断言文件存在可执行 ⇒ **这个防漂闸从来没有执行者**；且 sync.sh 只同步
`.claude/workflows/` → `plugin/workflows/`，结构上不覆盖 `orchestration/` → `plugin/loop/`。

**⇒ 硬规则⑨的教科书形状**：守与不守在记录上无法区分 ⇒ 只能靠意志 ⇒ 已实际漂了。

## Plan

1. 建一个**每轮/每次提交会被执行**的检查（接进 `scripts/test.sh` 静态层或 pre-commit），对任一
   副本-正本对出现差异时**报红**（不是只写在注释里）。
2. 覆盖面**显式枚举**并包含 `orchestration/*-tick-core.md → plugin/loop/`（现有
   `workflows-dual-copy-drift-check.ts` 只守 3 个 workflow，不覆盖 loop 文档）。
3. **负控制**：故意改正本一行不改副本 ⇒ 检查必须红；不红则本 AC 不成立。
4. ⛔ 不接受「把 plugin/ 副本手工同步一次」当达成——那修的是这一次的值，不是闸。

## Acceptance Criteria

- [ ] AC1: 存在一个每轮/每次提交会被执行的漂移检查（接进 test.sh 静态层或 pre-commit），对任一
      副本-正本对差异报红。
- [ ] AC2: 检查覆盖面显式枚举并含 `orchestration/*-tick-core.md → plugin/loop/`。
- [ ] AC3: 负控制成立——故意改正本一行不改副本 ⇒ 检查必红（不红则本 AC 不成立）。
- [ ] AC4: 达成的证据是「闸存在且接线」，不是「手工同步了一次副本」。

## Definition of Done

- [ ] 交付副本-正本漂移有接线的闸：接进 scripts/test.sh 静态层或 pre-commit 使每轮/每次提交都会执行，
      任一副本-正本对出现差异即报红；覆盖面显式枚举并包含 orchestration/*-tick-core.md → plugin/loop/；
      负控制（故意改正本一行不改副本 ⇒ 必红）验证通过。达成证据是「闸存在且接线」，不是手工同步一次
      副本的值——守与不守在记录上可区分，不再靠意志。

## Touches

- plugin/scripts/*（漂移检查器，或扩展现有 workflows-dual-copy-drift-check.ts）
- scripts/test.sh（接线静态层）
- tasks/gap-ac90-delivery-copy-drift-gate.md（自身）
