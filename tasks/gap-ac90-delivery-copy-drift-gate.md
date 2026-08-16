---
id: gap-ac90-delivery-copy-drift-gate
title: "AC90: 交付副本与正本的漂移必须有【接线的】闸——现状自称有、实查无（硬规则⑨教科书形状）"
status: done
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

- [x] AC1: 存在一个每轮/每次提交会被执行的漂移检查（接进 test.sh 静态层或 pre-commit），对任一
      副本-正本对差异报红。
- [x] AC2: 检查覆盖面显式枚举并含 `orchestration/*-tick-core.md → plugin/loop/`。
- [x] AC3: 负控制成立——故意改正本一行不改副本 ⇒ 检查必红（不红则本 AC 不成立）。
- [x] AC4: 达成的证据是「闸存在且接线」，不是「手工同步了一次副本」。

## Definition of Done

- [x] 交付副本-正本漂移有接线的闸：接进 scripts/test.sh 静态层或 pre-commit 使每轮/每次提交都会执行，
      任一副本-正本对出现差异即报红；覆盖面显式枚举并包含 orchestration/*-tick-core.md → plugin/loop/；
      负控制（故意改正本一行不改副本 ⇒ 必红）验证通过。达成证据是「闸存在且接线」，不是手工同步一次
      副本的值——守与不守在记录上可区分，不再靠意志。

## Evidence

**实现形态**：漂移闸落在 `plugin/scripts/tick-core-static-check.ts --check-drift`（它已覆盖
`orchestration/*-tick-core.md → plugin/loop/` 的 DRIFT_PAIRS 显式枚举——manager 判据②要求的覆盖面
早在此存在；任务 Touches 里「扩展现有 workflows-dual-copy-drift-check.ts」是写任务时的旧心智，实际
loop-doc 漂移机件是 tick-core-static-check）。本任务修的是「闸存在但没接线（--no-block）+ fast-mode
对用了错误的 byte-identical 判据」。

- **AC1（闸存在且接线，任一副本-正本对差异报红）**：`scripts/test.sh` `run_doc_checks`（pre-commit
  doc 面，`--static-checks-doc`）里 `tick-core-drift-check` 由 `--check-drift --no-block` 改为
  `--check-drift`（硬闸）。复算：`bash scripts/test.sh --static-checks-doc`（当前 4/4 一致 ⇒ exit 0）；
  单测 `plugin/test/tick-core-static-check.test.mjs`「AC2: the real repo's shipped copies are all
  consistent」断言真仓 drift-GREEN。
- **AC2（覆盖面显式枚举并含 orchestration/*-tick-core.md → plugin/loop/）**：
  `plugin/scripts/tick-core-static-check.ts` `DRIFT_PAIRS` 显式列出 4 对：orchestrator-tick-core
  （byte-identical）/ fast-mode-tick-core（**normalized-byte**，本任务新增——init/SKILL.md:71 明示
  fast-mode 副本非 byte-identical，byte-identical 判据恒红且 232e4171 字节同步被 cddc55e2 回退）/
  manager-tick-core + manager-loop-tick（pointer）。复算：`grep -n "DRIFT_PAIRS" -A 12
  plugin/scripts/tick-core-static-check.ts`。
- **AC3（负控制：改正本一行不改副本 ⇒ 必红）**：两层。① mutation
  `plugin/scripts/checker-mutation-cases/tick-core-static-check.sh` INJECT #6：改
  orchestration/fast-mode-tick-core.md A 行 → `--check-drift` RED（exit 1），恢复 → GREEN。② 单测
  `plugin/test/tick-core-static-check.test.mjs`「AC90 negative control: a one-line edit of the
  fast-mode 正本...」：临时 root 基线 PASS → 只改正本 A1 行 → RED（exit 1）+ diffStat 1 hunk。③ 手工复算：
  改 `orchestration/fast-mode-tick-core.md` 的 `effective_cap=5` 一行不改副本 ⇒
  `node --experimental-strip-types plugin/scripts/tick-core-static-check.ts --check-drift` exit 1。
- **AC4（达成=闸存在且接线，非手工同步一次）**：闸的接线是交付物——pre-commit 硬闸 + 负控制证明它对
  **未来**的单边编辑必红。`plugin/loop/fast-mode-tick-core.md` 的语义对齐是让闸可过的**一次性前置**
  （当时 fast-mode 副本是 stale 语义落地：还在教 target 旧 cap/心跳/dispatch-record 行为），不是达成
  本身；达成是「守与不守在记录上可区分」——`--no-block` 窗口已关闭，`rhythm-consumer-check` 判据3 的
  `--no-block` 计数由 3 → 2（`plugin/test/rhythm-consumer-check.test.mjs`）。

**fast-mode normalized-byte 判据**：比较行为体（从第一个 `## A.` 起的 A/B/C/D 表）在归一化 loop-doc
源路径角色差（plugin/loop/ ↔ docs/analysis/）后的字节一致；role-specific 头（切分声明/落地副本标注/
路径引用）排除。复算：`node --experimental-strip-types plugin/scripts/tick-core-static-check.ts
--check-drift` 报 `4 consistent / 0 drifted`。

## Touches

- plugin/scripts/tick-core-static-check.ts（--check-drift 增 normalized-byte 模式 + DRIFT_PAIRS 显式枚举）
- plugin/scripts/checker-mutation-cases/tick-core-static-check.sh（AC90 负控制 INJECT #6）
- plugin/scripts/capability-catalog.sh（tick-core-static-check 的 CONSUMER 行更新：--no-block → hard 闸）
- plugin/test/tick-core-static-check.test.mjs（normalized-byte 模式断言 + AC90 负控制单测 + 真仓 drift-GREEN）
- plugin/test/rhythm-consumer-check.test.mjs（--no-block 计数 3 → 2）
- plugin/loop/fast-mode-tick-core.md（落地副本语义对齐正本——AC90 配平前置，非达成本身）
- scripts/test.sh（tick-core-drift-check 由 --no-block 转硬闸）
- tasks/gap-ac90-delivery-copy-drift-gate.md（自身）
