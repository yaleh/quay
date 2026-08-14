---
id: gap-c24-4-5-7-no-landing
title: AC76 判据5 的 C24-4/5/7 无落点——在飞维度退役的三条找不到任何载体（manager 11:1xZ 报）
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

**（AC76 判据5 的 C24 在飞派生退役——C24-4/5/7 无落点；manager 11:1xZ 逐条查实）**。

**背景**：AC76（在飞唯一读法 = inner 任务 subagent，人 09:1xZ 裁定）判据5 把 C24 清单的在飞派生退役为显式标注（AC48 判据2 做法）。manager 10:5xZ 逐条查：
```
C24-1/2/3  有 `RETIRED (AC76 C24-N…)` 标注 + 进 cap-counts-subagents-check.ts 的检查表   ✓ 有落点
C24-4      /live 与 observation 面的 realInFlight 消费端         → 查不到任何落点
C24-5      A16 --task-start 括号的【在飞】用途（派发留痕用途另议）→ 查不到任何落点
C24-7      cap 维度与在飞维度合并                                → 查不到任何落点
```

**判据1**：C24-4/5/7 三条的退役【落点】补齐——或按 AC48 判据2 形态标注（如 C24-1/2/3 那样进 cap-counts-subagents-check 的检查表），或显式写明「该条不适用/已并入」，**不允许「退役了但无落点」**（退役而不可查 = 记录上像退役、行为上没退役，AC66 族）。
**判据2（能取假）**：现状 = C24-1/2/3 有落点而 C24-4/5/7 无 ⇒ 真样本回放红（缺落点）；补后绿。
**判据3**：`cap-counts-subagents-check` 的 C24 检查表覆盖 C24-1/2/3，补 4/5/7 的对应行。

**不覆盖**：不改 C24 清单内容（在飞派生退役本身已定）；不改 cap-counts-subagents-check 的核心判据。

**本任务不新建过程纪律型 AC**：负控制沿用 AC49。

## Plan

1. 读 AC76 判据5 的 C24 清单 + cap-counts-subagents-check.ts 的检查表（C24-1/2/3 落点形态）。
2. 判据1：C24-4/5/7 落点补齐（标注进检查表，或显式「不适用/并入」）。
3. 判据2 能取假：现状（缺落点）回放红 + 补后绿。
4. 判据3：cap-counts-subagents-check 覆盖 4/5/7。
5. 既有测试全绿 + `--for-task` scoped 门绿。

## Acceptance Criteria

- [x] AC1 判据1：C24-4/5/7 退役落点补齐（标注或显式不适用），无「退役而无落点」。
- [x] AC2 判据2 能取假：现状缺落点回放红；补后绿。
- [x] AC3 判据3：cap-counts-subagents-check 检查表覆盖 C24-4/5/7。
- [x] AC4 既有测试全绿；`--for-task` scoped 门绿。

## Definition of Done

- [x] C24-4/5/7 退役落点补齐 + cap-counts-subagents-check 覆盖 + 能取假。

## Touches

- plugin/scripts/cap-counts-subagents-check.ts（C24-4/5/7 落点/检查表补行）
- plugin/test/cap-counts-subagents-check.test.mjs（补测）
- plugin/scripts/capability-catalog.sh（cap-counts-subagents-check 判据5 描述更新为 C24-1..7 全落点）
- tasks/gap-c24-4-5-7-no-landing.md（自身）

## Test-Files

- plugin/test/cap-counts-subagents-check.test.mjs（补测 4 条：judgeC24Coverage 现状回放红 / 真实表绿 / merged 空 mergedInto 红 / 未知 disposition 红；既有判据5 两测改按 `disposition==="annotation"` 过滤；CLI `--json` 断言新增 `judge5-c24-landing-coverage`）

## Evidence

**AC1 判据1 —— C24-4/5/7 退役落点补齐**：`plugin/scripts/cap-counts-subagents-check.ts` 的 C24 检查表 `C24_RETIREMENT` 由 3 行扩为 7 行，每条带 `disposition`（落点形态）：
- **C24-4**（/live 与 observation 面 realInFlight 消费端）→ `disposition:"merged"`，已并入本检查器**判据6 `judgeLiveVsTaskStatus`**（/live 把 done 误报在跑 ⇒ RED，2026-08-14 AC66/AC72/AC73 真样本）+ C24-1 对 /live producer（fast-mode-telemetry.ts）的在飞维度标注。
- **C24-5**（A16 --task-start 括号【在飞】用途）→ `disposition:"merged"`，已并入 **C24-1 fast-mode-telemetry.ts `RETIRED (AC76 C24-1)` 注释**（--task-start/--task-end 在飞用途随 producer 在飞维度一并退役；派发留痕用途保留）。
- **C24-7**（cap 维度与在飞维度合并）→ `disposition:"merged"`，已并入 **C24-6**（manager A3 外层独占；orchestration/manager-phase-goal.md AC76 ⑦）。
- **C24-6**（manager A3）→ `disposition:"outer-owned"`，显式记录外层落点（orchestration/manager-tick-core.md A3，C17 只建议不落盘）——整表 1-7 条无「退役而无落点」。

**AC2 判据2 能取假 —— 现状回放红 + 补后绿**：新判据 `judgeC24Coverage`（C24 落点覆盖判据）对「现状」（仅 C24-1/2/3 的 pre-fix 表）回放 RED：
```
{"ok":false,"evaluated":true,"reason":"c24-landing-coverage-missing (4): C24-4: no landing entry; C24-5: no landing entry; C24-6: no landing entry; C24-7: no landing entry",...}
```
对修复后真实表回放 GREEN：
```
{"ok":true,"evaluated":true,"reason":"c24-landing-coverage-complete (7/7)","missing":[]}
```

**AC3 判据3 —— 检查表覆盖 4/5/7**：`C24_RETIREMENT` 现含 C24-1..7 全部七行，dispositions = `annotation,annotation,annotation,merged,merged,outer-owned,merged`；检查器 CLI `--json` 新增 `judge5-c24-landing-coverage` 检查：
```
cap-counts-subagents-check: OK — cap-counts-subagents-pass
  [judge5-c24-retirement] ok — c24-in-flight-derivations-retired (3/3 annotated)
  [judge5-c24-landing-coverage] ok — c24-landing-coverage-complete (7/7)
```

**AC4 —— 既有测试全绿 + scoped 门绿**：`bash scripts/test.sh --for-task gap-c24-4-5-7-no-landing --allow-thin` → **27 tests pass / 0 fail**，scoped static checks 全 PASS（含 `cap-counts-subagents-check` 检查器），exit 0。ts-typecheck 闸 `fan-in-ts-typecheck-gate.ts` → 无新增/移动 .ts（仅修改既有 cap-counts-subagents-check.ts）⇒ `{"required":false,"verdict":"admitted","exit":0}`。
