---
id: gap-session-saturated-composite-condition-emitter
title: SESSION-SATURATED 复合条件发射端——饱和 && develop 静默 ≥ T && 在飞集合无变化（T 可配
  SATURATION_SILENCE_MIN，非字面量；事件名与实际断言一致「失能」非仅「饱和」）
status: ready
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

- [x] AC1: SESSION-SATURATED 仅在三条件全满足时发（饱和 && develop 静默 ≥ T && 在飞集合无变化）
- [x] AC2: T 可配置（`SATURATION_SILENCE_MIN` env，非硬编码 30）
- [x] AC3: 事件名与实际断言一致（「失能」形态，非仅「饱和」）；饱和但活跃/在飞变 ⇒ 不发（负控制）
- [x] AC4: 不关事件（真饱和到失能仍报）；非恒报（硬规则 4 自检）
- [x] AC5: 既有测试全绿；`--for-task` scoped 门绿

## Definition of Done

- [x] AC1–AC5 全部勾上
- [x] 三条件真/假各态实测贴出（饱和活跃不发 / 饱和静默在飞变不发 / 全满足发）
- [ ] 全量套件绿（session-liveness 全家族 103 pass/0 fail + scoped 5/5 绿；全量套件由 outer fan-in 后跑）

## 落地说明（2026-08-13）

**实现**（`plugin/scripts/session-liveness.sh`）：
- 新增 `SATURATION_SILENCE_MIN=${SATURATION_SILENCE_MIN:-10}`（env 可配，同 SATURATION_TOKENS 形态；非字面量 30）。
- 事件 6 改为复合条件发射端：`_sl_develop_silent`（`git -C $root log -1 --format=%ct develop` 距今 ≥ T）、`_sl_worktree_set`（`git worktree list --porcelain` 路径 basename 排序集合）、`_sl_sat_disabled_verdict`（纯函数：饱和 && 静默 && 集合无变化 ⇒ emit）。首轮无集合基线 ⇒ 判「有变化」不误发；连续两轮同集合才判「无变化」。
- 事件名改名 `SESSION-SATURATED` → `SESSION-DISABLED`（选 A：事件名与实际断言一致「失能」非仅「饱和」）；`--states` 词汇表同步（保留 "saturated" 恰好一次，Contract measure 不变）。
- 边沿触发改为按【复合判定】置位 `PREV_SATURATED`（复合首次为真才发一次），非按裸饱和——真饱和到失能仍报，非恒报。

**测试**（`plugin/test/session-liveness.test.mjs`，5 用例全绿）：
- 全满足发：backdated develop（静默）+ 稳定 worktree 集合 + 饱和 ⇒ `SESSION-DISABLED` 发，且一段只发一次。
- 饱和但 develop 活跃 ⇒ 不发（fresh develop < T）。
- 饱和且静默但在飞变 ⇒ 不发（每轮加 worktree，集合逐轮变）。
- 不饱和 ⇒ 不发（负控制）。
- `SATURATION_SILENCE_MIN` 实际门控：T=1 时 2 分钟前 develop 发；T=100 时不发。

**改名连带**（超出 Touches 的一处，理由：DoD「全量套件绿」）：`plugin/test/session-liveness-signals-kinds.test.mjs` 的承重条断言 `SESSION-SATURATED` → `SESSION-DISABLED`（2 处 regex + 注释）。`--states` 的 "saturated" 恰好一次 measure 未改即绿（`session-liveness-signals-integration.test.mjs` 不需动）。

**实测证据**（`scripts/test.sh --for-task gap-session-saturated-composite-condition-emitter --allow-thin` → 5/5 pass + scoped 静态检查全 PASS）：
```
✔ AC1/AC4 — all-three ⇒ SESSION-DISABLED fires; exactly one emission per spell
✔ AC3 负控制 — 饱和但 develop 活跃 ⇒ 不发
✔ AC3 负控制 — 饱和且静默但在飞变 ⇒ 不发
✔ AC1 负控制 — 不饱和 ⇒ 不发
✔ AC2 — SATURATION_SILENCE_MIN env 可配且实际门控
tests 5  pass 5  fail 0
```
session-liveness 全家族：`node --test plugin/test/session-liveness*.test.mjs` → 103 pass / 0 fail / 1 skip（真实 probe 用例，需 manager 探针）。

## Touches

- plugin/scripts/session-liveness.sh（SESSION-SATURATED 复合门 + SATURATION_SILENCE_MIN）
- plugin/test/session-liveness.test.mjs（复合条件 + 负控制用例）
- tasks/gap-session-saturated-composite-condition-emitter.md（自身）