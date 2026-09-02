---
id: gap-session-liveness-marker-stale-fires-on-tick-log
title: session-liveness marker-stale 误判 fresh tick log 为 session-activity——gating 用 tr_path 非空而非「心跳源是 transcript」
status: todo
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

`session-liveness-signals-kinds.test.mjs` AC2「fresh TICK LOG (not transcript) + idle pane 不该 fire marker-stale」真实断言失败（`192348ms`，非超时）。

**lowconc=8 假说被证伪**（硬规则 4 推论四：能解释但被证伪）：`gap-lowconc-concurrency-8-starves-bclass-waiting` 落地后 lowconc 已降到 3（scheduler 行 `lowconc≤3`、`LOWCONC_CONCURRENCY_DEFAULT=3`），session-liveness 仍失败，且这次失败类型是 marker-stale AC2、非「probe must be alive 饿死」。回顾 subagent 自提取的 6 次失败，类型本就多样（probe must be alive / SESSION-GONE 取代 SESSION-IDLE / CANT-SEND / marker-stale），非单一「饿死」。

**代码根因（读码定位）**：marker-stale 交叉正控制的 gating（`session-liveness.sh:1646`）用 `[ -n "$tr_path" ]`（transcript **路径存在**）判定，而非「**心跳源是 transcript**」。注释 `:1639` 明确「只对『心跳是 transcript』的目标成立——tick 日志是 loop 写的，不是会话活动的证据」，但代码没实现这个 gating。测试里 `makeHermeticProbe` 的 probe 自带 transcript（`tr_path` 非空），而目标心跳配的是 tick log（`tickLogs: ts <tick>`）⇒ 误进 marker-stale 分支并 fire。

**修法方向**：marker-stale gating 补「该目标心跳源是 transcript」判定（`heartbeat_is_outer_default` 的否定，或显式「SESSION_TRANSCRIPTS 配置 / 心跳解析结果为 transcript」检查），而非仅 `tr_path` 非空。tick-log 心跳目标即使 pid 映射出 transcript，也不该 fire marker-stale。

## Plan

1. 定位该目标「心跳源」的解析结果（SESSION_TRANSCRIPTS > SESSION_HEARTBEATS > 默认 tick-log 的优先级，heartbeat_for 处已知）。
2. marker-stale gating 改为「心跳源是 transcript」+ `tr_path` 非空（而非仅 `tr_path` 非空）。
3. 验证：fresh tick log + idle pane 不再 fire marker-stale；fresh transcript + idle pane 仍 fire（正控制不退化）。

## Acceptance Criteria

- [ ] AC1（能取假）：fresh tick log（tick-log 心跳源）+ idle pane 不 fire marker-stale——测试 AC2 绿；（⛔ 仍 fire ⇒ 假）。
- [ ] AC2（能取假，正控制不退化）：fresh transcript（transcript 心跳源）+ idle pane 仍 fire marker-stale——测试 AC2 正控制仍绿；（⛔ 误放行 transcript 侧 ⇒ 假）。

## Definition of Done

marker-stale gating 按「心跳源是 transcript」判定；AC1/AC2 勾；fresh tick log 不 fire、fresh transcript 仍 fire；全量 suite 绿。

## Touches

- plugin/scripts/session-liveness.sh（marker-stale gating 补心跳源判定）
- plugin/test/session-liveness-signals-kinds.test.mjs（AC2 负控制 + 正控制断言）
- tasks/gap-session-liveness-marker-stale-fires-on-tick-log.md（自身）
