---
id: AC-149
title: 会话真正退役 + 不留双真相源 + 产能不塌
status: superseded
kind: criterion
goal: GOAL-002
criterion: |
  node --no-warnings --experimental-strip-types -e 'import("./plugin/scripts/session-retirement-check.ts").then(m=>{process.exit(m.runCheck(".").ok?0:1)})'
expect: exit 0
origin: >
  人 2026-08-23 方向「彻底取消 outer 会话（inner 会话应已被 worker-driver 机制代替）」。

  交叉引用：gap-b0-retirement-precondition-checker-call-surface（status: ready）是
  AC149-1/-3 的

  一个具体子条件——枚举 outer 执行核引用的全部 checker，逐个确认留存调用面或显式退役。
statusLog:
  - at: 2026-09-12T01:46:29.129Z
    from: achieved
    to: superseded
    actor: worker:gap-achieved-ac-rot-invisible-when-ledger-tail-is-stale-pass
    reason: 判据引用的 plugin/scripts/session-retirement-check.ts 已由 gap-ac158（AC158
      批次一：零调用死集归档，2026-09-07）git mv 进 archive/2026-09-07-zero-call-scripts/ ⇒
      判据恒为 ERR_MODULE_NOT_FOUND、结构上不再可满足。其对象（outer/inner 会话退役 + 无双真相源）已由
      2026-09-03/09-04 的退役裁定与 worker-driver 取代完成（见
      orchestration/SPEC-tmux-retirement-2026-09-03.md）👉 显式处置为 superseded。
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


