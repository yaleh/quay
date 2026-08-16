---
id: gap-ac91-delivery-core-refs-undelivered-files
title: "AC91: 交付的执行核不得指向【未交付】的文件——全量枚举引用解析（非只修两条抽样）"
status: ready
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

**判据正本（直接引用，勿转述）**：`orchestration/manager-phase-goal.md` 「🆕 AC90–AC93」区块 → `### AC91`。

**实测（manager 已跑过）**：交付的 `plugin/loop/orchestrator-tick-core.md` 在 `:39` 引用
`.claude/workflows/execute-suite-fix.js`、在 `:70` 引用 `.claude/workflows/pool-quality-judge.js`；
而 `plugin/workflows/` 只有 3 个双拷贝（drain-directives / fan-in-execute / run-routines），
`quay-init --workflows` 也只从 `plugin/workflows/` 铺（`quay-init.sh:23`）⇒ **装完 tgz 的目标机上，
这两步指向不存在的文件**。

**⇒ 这正是 `referenced-not-landed` 类，但它逃过了那个 guard**（`quay-init.sh:1131` 的三条件 AND 里
「在 init/SKILL.md 声明过」这条会豁免掉——**⛔ 需实读确认是哪条豁免的，别猜**，读完判定分支再下结论）。

## Plan

> **排期建议（非前置，depends_on 已拆，manager 2026-08-16 裁定）**：建议在 AC90 land 之后做
> （派发顺序，人手执行）；无真前置——AC91 的引用解析不依赖 AC90 的漂移闸产出（AC90 是 diff 闸，
> 不产出「交付集」机械枚举；交付集来自 package.json files + package.sh，非 AC90 实现）。

1. **实读** `quay-init.sh:1131` 附近三条件 AND 的判定分支，确认哪条豁免了 execute-suite-fix /
   pool-quality-judge 的 referenced-not-landed。
2. 对**交付面全体**（`plugin/` 内所有 .md/.sh/.ts→dist）做一次引用解析，枚举「引用了一个不在
   交付集里的路径」的**全部条目**（枚举，不是布尔，硬规则③）——先给全量条数。
3. 条数降到 0 或每条有显式豁免记录。
4. 有一个会被执行的检查守住它。
5. ⛔ 不得只修 :39/:70 这两条了事——必须先给出全量条数，否则修的是抽样。

## Acceptance Criteria

- [ ] AC1: 交付面全体的引用解析枚举出全部「引用未交付路径」条目（全量条数，非抽样）。
- [ ] AC2: 条数降到 0 或每条有显式豁免记录。
- [ ] AC3: 存在一个会被执行的检查守住它（不会再次漏）。
- [ ] AC4: 实读了 quay-init.sh:1131 的判定分支，记录哪条豁免了 referenced-not-landed（非猜测）。

## Definition of Done

- [ ] 交付的执行核不再指向未交付的文件（全量枚举归零 + 守住检查 + 豁免理由记录）。

## Touches

- plugin/loop/*（交付副本的引用修复）
- plugin/scripts/*（引用解析检查器）
- packages/quay/scripts/quay-init.sh（如豁免逻辑需修正）
- tasks/gap-ac91-delivery-core-refs-undelivered-files.md（自身）
