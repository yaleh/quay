---
id: gap-wiring-claim-ac-misflags-position-grep
title: wiring-claim-ac 误报 position-based grep AC——grep 真文件是位置判定的真探针，非 no-probe
status: ready
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: execution
---
**type:** execution

## Proposal

`wiring-claim-ac-requires-real-input-probe` 的启发式（反引号标识符 + 接线动词）把「grep `<literal>` `<真文件>` 命中 ≥1」误判为「无真实输入探针的接线声明」，挡住 DIR-130（directive，done）的 AC2/AC4，经 `it0-split-or-commit-check` whole-store 扫描连带挡死 bclass、legacy-phase-splitting-cleanup 等全部 fan-in。

**这是误报，非 DIR-130 的 AC 设计缺陷**：DIR-130 AC2/AC4 用 `grep -n "DIR-130" <真文件>` 判「引用在正确位置」——这是硬规则②「按位置判定」的正确做法，**grep 真文件本身就是真输入探针**（那个真文件就是被读的真实输入）。而该规则要抓的是另一类：声称「X 认到/读到真实数据」却用**合成桩**（字符串直调 / mkdtemp / fixture）验收（如两条历史坏例 `readDependsOn("...\n")` 字符串直调、把样本抄进 mkdtemp）。

**注**：rule task Touches 称 `checkWiringClaimAcProbe` + `REAL_INPUT_PROBE_RE` 在 `wiring-coverage-check.ts`，但该文件现为 DIR-117/DIR-122 的 mechanism-claim checker（无 `checkWiringClaimAcProbe` export）——worker 需先核实函数实际位置（疑似被后续重构 clobber 或 `task-contract-check.ts:62` 的 import 已陈旧），再修。

## Plan

1. 定位 `checkWiringClaimAcProbe` 实际所在（`task-contract-check.ts` 的 check 8 / `checkWiringClaimAcProbeGated` 或 `wiring-coverage-check.ts`）。
2. 扩展启发式/RE：识别 `grep <literal> <真文件>`（含 `-n` / `命中 ≥1` / `零命中` / `打印命中行与上下文`）为**合法位置判定探针**，不判 no-probe。
3. 负控制：两条历史坏例仍报红；字符串直调 / fixture / mkdtemp 合成桩的接线声明仍报红（不连带放行）。

## Acceptance Criteria

- [ ] AC1（能取假）：DIR-130 AC2/AC4 不再报 `wiring-claim-ac-no-probe`（grep 真文件被判合法探针）——`task-contract-check --json` 对 DIR-130 0 违规；（⛔ 仍报 ⇒ 假）。
- [ ] AC2（能取假，无回归）：两条历史坏例（`gap-readdepends-on-indented-extra-depends_on` / `gap-ac146-human-interface-explicit-owner`）仍报红；（⛔ 误放行 ⇒ 假）。
- [ ] AC3（能取假，负控制）：字符串直调 / fixture / mkdtemp 合成样本的接线声明仍报红——不因「grep 真文件」豁免连带放行合成桩。

## Definition of Done

启发式区分「grep 真文件的位置判定」（合法探针）与「声称认到真实数据却读合成桩」（no-probe）；AC1-AC3 勾；DIR-130 / bclass / legacy-phase-splitting-cleanup 不再被此静态检查误挡；全量 suite 绿。

## Touches

- plugin/scripts/task-contract-check.ts（check 8 / checkWiringClaimAcProbeGated / wiring-claim-ac-no-probe 违规产出）
- plugin/scripts/wiring-coverage-check.ts（checkWiringClaimAcProbe 启发式所在——worker 先核实）
- plugin/test/task-contract-check.test.mjs（grep 位置判定正例 + 两坏例负控制）
- tasks/gap-wiring-claim-ac-misflags-position-grep.md（自身）
