---
id: gap-worker-driver-complete-logging-doc
title: worker-driver 可观测性——每步完整记录 stdout+stderr + 日志路径单一正本（防 reason 载体失真再犯）
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

可观测性载体失真（硬规则 3b/4b/9 同族）已复发 6+ 次（reason stderr 优先丢 stdout / resource.node_count comm 恒 0 / outer.ticklog 行形谓词 / goal.phase_ac_checked 复选框 / verification-round cpu_usec / pgrep comm 恒零）。未知异常不可机械化检测（签名 = 假设可枚举，对未知不成立）。机制修法两条，都不新增检测器：

1. **worker-driver 每步完整记录 stdout + stderr**（⛔ 不做 stderr 优先/丢弃——`gap-scoped-gate-reason-stderr-drops-stdout` 的 reason 掩蔽根因就是 `fail()` 的 `a.stderr || a.stdout` 短路）。
2. **日志路径单一正本文档**：列全全部载体（worker-outcome / worker-round / pid / liveness / suite-capture+log / lock-events / archguard mirror / worker-control）+ 每条写什么 + 关键不变量（「失败必记 stdout+stderr」）。

**与实例缺陷的分工**：`gap-scoped-gate-reason-stderr-drops-stdout`（实例：scoped-gate fail reason）+ `gap-mark-needs-human-commit-after-write`（实例：写盘不提交）是两处具体缺陷；本任务是**机制层防再犯**（每步完整日志 + 单一正本），不等同于、也不取代那两条。

## Plan

1. worker-driver 每步（merge/delta/typecheck/archguard/scoped-gate/doc/suite/anti-drift/ac-gate/flip/ff）落 stdout+stderr（失败必记全）。
2. 新建日志路径规则正本文档（单一来源，列全载体 + 每条写什么 + 失败必记 stdout+stderr 不变量）。

## Acceptance Criteria

- [ ] AC1（能取假，失败必记全）：某步失败时，其日志/outcome reason 含 stdout 失败签名（⛔ 只含 stderr 良性 preamble ⇒ 假）。
- [ ] AC2（能取假，正本覆盖）：日志路径正本文档覆盖全部载体，且「失败必记 stdout+stderr」不变量在文档中（⛔ 漏载体 / 无不变量 ⇒ 假）。

## Definition of Done

worker-driver 每步 stdout+stderr 全记；日志路径正本文档落地；AC1-AC2 全勾。

## Touches

- plugin/scripts/worker-driver.ts（每步落 stdout+stderr，失败必记全）
- orchestration/worker-driver-log-carriers.md（新建日志路径单一正本，列全载体 + 不变量）
- plugin/test/worker-driver.test.mjs（失败 reason 含 stdout 签名负控制）
- tasks/gap-worker-driver-complete-logging-doc.md（自身）
