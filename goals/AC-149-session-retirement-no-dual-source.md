---
id: AC-149
title: 会话真正退役 + 不留双真相源 + 产能不塌
status: active
kind: criterion
goal: GOAL-002
origin: |
  人 2026-08-23 方向「彻底取消 outer 会话（inner 会话应已被 worker-driver 机制代替）」。
  交叉引用：gap-b0-retirement-precondition-checker-call-surface（status: ready）是 AC149-1/-3 的
  一个具体子条件——枚举 outer 执行核引用的全部 checker，逐个确认留存调用面或显式退役。
---

**判据（能取假，三条缺一不可）**：
- **AC149-1（真停）**：outer / inner 会话停止；其 cron 锚、tick-log、执行核文档按 AC135/AC141/B9
  的**同一套写法**标退役（删除线 + 指针 + 边界条件）。**取假**：会话停了而文档仍写着"每轮必跑" ⇒ 假
  （正是本会话 09:0xZ 刚修掉的 B9 漂移形态，⛔ 一次性退役十几条会批量制造它）。
- **AC149-2（产能不塌，⛔ 这是真判据不是仪式）**：停会话后连续 ≥24h，任务**持续 land**（`develop`
  上有新的 fan-in 合并提交），且速率不低于停机前同长度窗口的 X%（X 落笔方定，⛔ manager 不设未测量
  过的阈值——硬规则④推论一）。**取假**：停机后 land 速率归零或断崖 ⇒ 假，回滚。
- **AC149-3（无双真相源）**：停机后不存在任何"两个执行者做同一件事"的路径。**取假**：任一职责
  同时有 driver 路径与人工/会话路径且都在用 ⇒ 假。

**⊢ criterion 留空**：本条是语义判据、无可跑 shell 判据；`gate` fail-closed（红）是诚实状态（SPEC-0809 §3）。
