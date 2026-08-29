---
id: gap-semantic-layer-observability-resident-prompt
title: 语义层常驻可观测检查 prompt——manager/outer 每 tick 读当次日志 + 历史复发，未解释/复发即报
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

可观测性载体失真（硬规则 3b/4b/9 同族）已复发 6+ 次，未知异常不可机械化检测（签名 = 假设可枚举，对未知不成立）。机制修法的语义层半边：**manager/outer 常驻检查 prompt**——每 tick 读当次日志找异常，grep 该 task 历史 outcome 看复发，未解释或复发即报（prompt 一句话量级，⛔ 非 ad-hoc 现场临时想起）。

**与机制任务的另一半**：`gap-worker-driver-complete-logging-doc`（每步完整日志 + 日志路径正本）是「载体侧」；本任务是「消费侧」——载体失真若不被人/语义层读到，仍是不可见（硬规则 9：可见性 ≠ 执行，得给产物）。

## Plan

manager/outer 常驻 tick 增加「读当次日志 + 历史复发」一步（prompt 一句话量级），产出 = 未解释/复发异常的上报。

## Acceptance Criteria

- [ ] AC1（能取假，常驻注入）：语义层检查 prompt 常驻注入可被检查到（grep tick-core 文档命中该步）（⛔ 非 ad-hoc / 无注入点 ⇒ 假）。
- [ ] AC2（能取假，读历史复发）：检查含「grep 该 task 历史 outcome 看复发」这一步（⛔ 只读当次不看历史 ⇒ 假）。

## Definition of Done

manager/outer 常驻 tick 增加可观测检查 prompt；AC1-AC2 全勾。

## Touches

- orchestration/manager-tick-core.md（常驻可观测检查 prompt 一步，manager 侧）
- orchestration/orchestrator-tick-core.md（常驻可观测检查 prompt 一步，outer 侧）
- tasks/gap-semantic-layer-observability-resident-prompt.md（自身）
