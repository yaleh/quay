---
id: gap-session-saturated-composite-condition-emitter
title: SESSION-SATURATED 复合条件发射端——饱和 && develop 静默 ≥ T && 在飞集合无变化（T 可配
  SATURATION_SILENCE_MIN，非字面量；事件名与实际断言一致「失能」非仅「饱和」）
status: todo
labels:
  - gap
  - defect
  - mechanism
parent: null
children: []
extra:
  schema: execution
---
**type:** execution

## Proposal

**SESSION-SATURATED 事件报的是判断的一个分量，不是判断本身（manager 2026-08-13，连续 3 次投递 0/3 升级）**。

**现象**：`SESSION-SATURATED` 连续投递 3 次，按预立三条件逐条判全不升级：
```
① 饱和事件仍在报         真
② develop 静默 ≥ T       假（实测 1 分钟）
③ 在飞树无变化           假（集合差 2 项变化）
```
**根因**：事件当前条件 = `cache_read ≥ SATURATION_TOKENS && 最后一条未应答`（session-liveness.sh:1609-1616）——**只有「收不进指令」的一个分量**（上下文大小 proxy）。「收不进」可被直接检验：饱和 **且** 提交静默 **且** 在飞集合冻结。事件名「饱和」而读者按「失能」处理，两者不等价，每个读者都要自己补那三条件（manager 补了三次）。同族：仪器测代理量（上下文大小），要判的是能力（还能不能接收并推进）。

**⚠️ 不要关掉**：它**不是恒报**（cache_read + 末条未应答两子句可变，硬规则 4 自检通过）——真饱和到失能时需要它。

**规格（manager 2026-08-13，选 A）**：把判断搬进发射端——`SESSION-SATURATED` 改为**复合条件**才发：
```
饱和（现有：cache_read ≥ SATURATION_TOKENS && 末条未应答）
 && 该层 develop 提交静默 ≥ T
 && 在飞 worktree 集合无变化
```
**T 用现有配置或读宿主，不写字面量 30**（脚本已有 env 可配阈值：SATURATION_TOKENS/STALL_MIN/OVERDUE_MIN——新增 `SATURATION_SILENCE_MIN` 同形态，默认值是可调配置非硬编码）。**A 优于 B**（B=抑制到状态改变只是少吵；A=让事件名与实际断言一致——「失能」而非「饱和」）。

**附带**：manager 侧把「三条件逐条判」写进执行核后，发射端修好可删（事件自带判断）。

## Plan

1. `plugin/scripts/session-liveness.sh` 发射端（:1609-1616 附近）：SESSION-SATURATED 门加复合条件——`饱和 && develop 提交静默 ≥ T && 在飞 worktree 集合无变化`。
2. 新增 `SATURATION_SILENCE_MIN`（env 可配，同 SATURATION_TOKENS 形态）；「该层 develop」按目标的 workspace 解析（git log -1 --format=%ci develop）。
3. 「在飞 worktree 集合无变化」：脚本跟踪每目标上轮 worktree 名字集合，集合差 = 有变化（复用 manager 判据6 的集合差手法，不用时间戳）。
4. 测试：饱和但 develop 活跃 ⇒ 不发；饱和且静默但在飞变 ⇒ 不发；三条件全满足 ⇒ 发（边沿）。负控制：不满足不发。

## AC

- [ ] AC1: SESSION-SATURATED 仅在三条件全满足时发（饱和 && develop 静默 ≥ T && 在飞集合无变化）
- [ ] AC2: T 可配置（`SATURATION_SILENCE_MIN` env，非硬编码 30）
- [ ] AC3: 事件名与实际断言一致（「失能」形态，非仅「饱和」）；饱和但活跃/在飞变 ⇒ 不发（负控制）
- [ ] AC4: 不关事件（真饱和到失能仍报）；非恒报（硬规则 4 自检）
- [ ] AC5: 既有测试全绿；`--for-task` scoped 门绿

## Definition of Done

- [ ] AC1–AC5 全部勾上
- [ ] 三条件真/假各态实测贴出（饱和活跃不发 / 饱和静默在飞变不发 / 全满足发）
- [ ] 全量套件绿

## Touches

- plugin/scripts/session-liveness.sh（SESSION-SATURATED 复合门 + SATURATION_SILENCE_MIN）
- plugin/test/session-liveness.test.mjs（复合条件 + 负控制用例）
- tasks/gap-session-saturated-composite-condition-emitter.md（自身）