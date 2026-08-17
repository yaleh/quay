---
id: gap-verification-round-phases-overlap-merged
title: "full-suite-runner 分相可见性在 PHASE_OVERLAP 下归零——serial+lowconc+main 合成一桶（硬规则 3b：结构完整、数字合理、语义错误）"
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

**来源**：manager 2026-08-17 03:0xZ（已核实，附引行号）+ outer 复验（verification-round.jsonl 实读）。

**问题**：`plugin/scripts/full-suite-runner.ts` 在 `PHASE_OVERLAP` 激活时把 **serial+lowconc+main 三相合成一个「serial」桶**，分相可见性归零。机制：
- `:2875-2880` 命中 `overlap: running` 时置 `overlapPhaseActive=true`（注释原文「it closes at the `__OVERHEAD__` burst」）。
- `__OVERHEAD__` 爆发在 **main 相之后**；期间 main 的 `__GROUP__` 被 `:2885-2887` 分支**显式忽略**（overlapPhaseActive ⇒ 不关窗）。
- AC101 把 `PHASE_OVERLAP` 默认翻 1（`scripts/test.sh:1024`）的同一轮，分相可见性归零。

**实证（verification-round.jsonl）**：
```
round 218 顺序:  static 43.6 | serial 232.4 | lowconc 183.3 | main 286.1 | 总 747s
round 224 overlap: static 49.5 | serial 444.2 | 总 500.8s
                   ⇒ main 在 serial 的 444.2 里（49.5+444.2+0.5 = 494.2 ≈ 500.8）
```

**影响（硬规则 3b 形态——不是缺字段，是给出结构完整、数字合理、语义错误的值）**：任何读 `phases[]` 的人会得出「serial 相 444s，去优化 serial」，而 **serial 真值约 157–230s**（manager 装箱模拟：serial 32 文件 Σ1262s，LPT@8=158s）。归因方向被误导。

**⛔ 止损：不需要 —— 理由（读数，manager 枚举 + 负对照）**：`phases[]` 无机件读端。枚举 30 个提到 `verification-round` 的机件，grep `phases` 命中 6 条**全部是注释**（`scripts/test.sh:986/1013/1266`、`full-suite-runner.ts:98/832/926`），无一处读 `record.phases`；负控制：同一谓词对已知为真的样本（写端 full-suite-runner.ts）干跑命中 3 条 ⇒ 谓词能命中，零读端是真零。AC101 判据读 `durationMs/tests/laneCount/scope/state`，不读 `phases`。⇒ 错记只损失归因能力，不产生错误的绿/红。**⚠️ 完备性限制（硬规则 5）**：只覆盖了那 30 个机件；经变量传路径的读端/散文正本里的人读消费者覆盖不到 ⇒ 「这 30 个机件里无读端」≠「全仓无读端」。

**⊢ 为什么先修这个（manager ② 的前置）**：manager 的 suite 并发分析（QUAY_MAX_OVERSUBSCRIPTION 分相 lane 试探）需要分相仪器判定效果——**仪器现在是瞎的，任何 lane 改动的效果无法判定**。本任务先修仪器，② 再谈。

**⊢ 复发证据（manager 2026-08-17 03:1xZ 追补，发生率 = 每一轮）**：round 226（green, 621.6s, tests=5004, lanes=8, susp=1, load=8.43）phases = `[('static',52.6), ('serial',566.8), ('end',0.7)]`——**serial 桶 566.8s 仍装着 serial+lowconc+main**。发生率从「立案时的推断」坐实为「每一轮」。止损结论不变（仍无机件读端 ⇒ 不产生错误绿/红）。

**⊢ 121s 缺口护栏（⛔ 修复前别查）**：round224（500.8s, 机器基本空闲）vs round226（621.6s, load=8.43）差 **120.8s 无已知成因**——manager 原预留解释（「满负载才回 600s+」）已被 round226 证否（同量级负载）。**⛔ 仪器修好前不要去查这 121s**：round226 的 566.8s 桶里 serial/lowconc/main 各占多少结构上不可知 ⇒ 121s 当前无法归因到任何一相——查了会得到一个自洽的错答案（硬规则 4 推论四）。本任务修好仪器后，121s 归因才有依据。

## Acceptance Criteria

- [ ] AC1: `PHASE_OVERLAP` 激活时 `phases[]` 仍区分 serial/lowconc/main 三相（各报各的子时，或显式报 overlap-window 且带三相分解）——⛔ 不得再合成一桶。
- [ ] AC2: 取假——构造 overlap 轮，`phases[]` 的 serial 桶不得吞 main（读 phases 能区分三相；round 224 那类 444s 桶必须能拆回 serial≈157-230 / lowconc / main 三段）。
- [ ] AC3: 修复后 overlap 轮的 `phases[]` 分相求和 ≈ `durationMs`（round 224 类记录：49.5+serial+lowconc+main+end ≈ 500.8，可机械核对）。
- [ ] AC4: 修复不改变 `PHASE_OVERLAP` 的排程行为（只修仪器，不修排程——② 的 lane 试探是另一个任务）。

## Definition of Done

- [ ] overlap 轮的 `phases[]` 分相可见性恢复（serial/lowconc/main 可区分，求和 ≈ durationMs）；仪器修复不碰排程。

## Touches

- plugin/scripts/full-suite-runner.ts（overlap 分相合并逻辑 :2875-2887）
- scripts/test.sh（PHASE_OVERLAP 相关，如需要同步分相报告）
- plugin/test/full-suite-runner.test.mjs（取假对照：overlap 轮分相）
- tasks/gap-verification-round-phases-overlap-merged.md（自身）
