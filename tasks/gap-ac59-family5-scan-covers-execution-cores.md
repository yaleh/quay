---
id: gap-ac59-family5-scan-covers-execution-cores
title: AC59 通则②·FAMILY-5 扫描面覆盖三层执行核（真样本回放可取假）
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

**AC59（通则②·FAMILY-5 扫描面覆盖三层执行核）判据（phase-goal 逐字）**：
- 判据1：`instrument-failure-check` 的 gate 扫描面**包含三层执行核**（当前只扫 tick 文档 + `plugin/scripts/`）。
- 判据2（能取假，且用【真样本回放】不构造新数据——合 D2）：今天已实测的三个 FAMILY-5 实例必须被它检出——
  manager 的 `B3 戊`（读 `full-suite-state.json` 断言实时、零新鲜度）／outer 核 `:34 A11` 与 `:52 B3`（同形）／
  inner 核 `:28 A9`（同形）。**一个检不出已知真实例的扫描面，不算覆盖。**
- 理由：**这三处是同一个 bug 的三个副本，而 FAMILY-5 早已被编号却没扫这三个位置** ⇒ **修根不修消费者。**

**本任务不新建过程纪律型 AC**：负控制沿用 AC49。

## Plan

1. 扩展 `instrument-failure-check` 的 gate 扫描面，包含三层执行核（orchestrator/fast-mode/manager tick-core）。
2. **真样本回放（负控制）**：五个已知真实例（manager B3-戊 / outer :34 A11 + :52 B3 / inner :28 A9）必须被检出——检不出任一 ⇒ 不算覆盖。
3. 接线 + 验证。

## Acceptance Criteria

- [x] AC1 `instrument-failure-check` gate 扫描面包含三层执行核。
- [x] AC2 真样本回放：五个已知真实例全被检出（manager B3-戊 / outer A11+B3 / inner A9）。
- [x] AC3 负控制由落地方产出（D2 归属）；检不出已知真实例 ⇒ 不算覆盖。
- [x] AC4 既有测试全绿；`--for-task` scoped 门绿。

## Definition of Done

- [x] 扫描面覆盖三层执行核（orchestrator-tick-core / fast-mode-tick-core / manager-tick-core）+ `plugin/scripts/`。
- [x] 真样本回放：五个已知 FAMILY-5 实例（manager B3-戊 / outer :34 A11 + :52 B3 / inner :28 A9）全部被检出——检不出任一不算覆盖。
- [x] 检查器接线进 gate（instrument-failure-check）+ 既有测试全绿、`--for-task` scoped 门绿。

## Touches

- plugin/scripts/instrument-failure-check.ts（扫描面扩展）
- orchestration/orchestrator-tick-core.md（被测对象）
- orchestration/fast-mode-tick-core.md（被测对象）
- orchestration/manager-tick-core.md（被测对象）
- （负控制 fixture：plugin/test/instrument-failure-check.test.mjs + plugin/scripts/checker-mutation-cases/instrument-failure-check.sh）
- tasks/gap-ac59-family5-scan-covers-execution-cores.md（自身）

## Evidence

**AC1 — 扫描面扩展（plugin/scripts/instrument-failure-check.ts）**：
`DEFAULT_SURFACE` 由 5 份驱动文档扩为 8 份 —— 加入 `orchestration/orchestrator-tick-core.md` / `orchestration/fast-mode-tick-core.md` / `orchestration/manager-tick-core.md`。`gateSurface(root) = DEFAULT_SURFACE ∪ plugin/scripts/*.{ts,sh}` 不变，三份执行核因此进入 --gate 扫描面。

**AC2 — 真样本回放（五个已知真实例全部检出）**：`--scan` 三份执行核产出 FAMILY-5 5 处命中：
- `orchestration/fast-mode-tick-core.md:28`（inner A9：读 `.quay/full-suite-state.json`，`running`/`green` ⇒ 照常派发，无新鲜度）
- `orchestration/manager-tick-core.md:82`（manager B3-戊：`.quay/full-suite-state.json` 仍是 `state=red … startedAt=…`，零新鲜度）
- `orchestration/orchestrator-tick-core.md:25`（outer A2：读 `.quay/suite-chain-heartbeat.json`）
- `orchestration/orchestrator-tick-core.md:34`（outer A11：读 `state`/`reason`/`durationMs`，无新鲜度）
- `orchestration/orchestrator-tick-core.md:52`（outer B3：条件 `state != running` + `--state-dir`，无新鲜度）
即 manager B3-戊 / outer A11+B3 / inner A9 全在列。测试 `AC59 true-sample replay` 逐行断言这五条都命中（按 file:line）。

**AC3 — 负控制（D2，真样本回放，不构造新数据）**：
- FAMILY-5 检测器细化：`startedAt`/`durationMs` 从新鲜度标记中移除（它们是快照**字段读**，不是新鲜度检查 —— manager B3-戊 引 `startedAt=…` 作数据、outer A11 读 `durationMs` 字段，二者必须 FIRE）；`距今` 加入新鲜度标记。
- 发现并修复一个潜在 bug：JS 正则 `\b` 对 CJK 无效 ⇒ 原 `新鲜度`/`陈旧`/`滞后`/`距今` 标记从未真正匹配过（被 `startedAt` 掩盖）；拆分为 ASCII 带 `\b` + CJK 裸字面。
- 负控制断言：`读 .quay/full-suite-state.json 的 startedAt 核对新鲜度` → 0 命中；`.quay/full-suite-state.json 仍是 state=red … startedAt=…` → 5 命中；`state != running` + `--state-dir` → 5 命中；`state=red 且 finishedAt 距今 < 一个 tick 周期` → 0 命中。

**AC4 — 既有测试全绿 + scoped 门绿**：
- `plugin/test/instrument-failure-check.test.mjs`：17/17 pass（含新增 3 条：AC2 refinement / AC59 true-sample replay / 更新后 AC3 面长 8）。
- `checker-mutation-check.sh --check`：31/31 checker 全过（instrument-failure 突变用例随 surface 扩为 8 份文档后基线→注入→恢复全绿）。
- `scripts/test.sh --for-task gap-ac59-family5-scan-covers-execution-cores --allow-thin`：exit 0，22/22 测试 pass。
- `--gate`：FAMILY_BASELINE 重定为 {1:2, 2:13, 3:15, 4:21, 5:43}（新扫描面 + 检测器细化后的实测计数），PASS。

**C17 说明**：三份 `orchestration/*-tick-core.md` 未改动（outer-exclusive）。outer 落地建议见投递报告：outer B3 行（orchestrator-tick-core.md:52）与 manager B3 戊（manager-tick-core.md:77 `戊suite red`）未显式写 `.quay/full-suite-state.json`，本落地用 `--state-dir`/`full-suite-state` 机制词 + `state != running` 值断言将其检出；若 outer 在相应行补显式文件名，扫描更直接。
