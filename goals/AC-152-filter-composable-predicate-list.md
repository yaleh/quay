---
id: AC-152
title: Filter 是可组合谓词列表
status: active
kind: criterion
goal: GOAL-002
criterion: |
  node --no-warnings --experimental-strip-types -e 'import("./plugin/scripts/driver-filters.ts").then(m=>{const names=new Set(m.TASK_FILTERS.map(f=>f.name));const want=["notInFlight","depsSatisfied","touchesDisjoint","retryCapNotExhausted","notNeedsHuman"];process.exit(want.every(n=>names.has(n))?0:1)})'
expect: exit 0
origin: >
  人 2026-08-23 裁定「前述可重用机制应当分层抽象，以支持这两层上的重用」；

  正本 orchestration/SPEC-unified-driver-architecture-2026-08-23.md
  §2.1/§2.5/§2.6。
evidence:
  at: 2026-09-06T17:03:31.548Z
  verdict: pass
  reading: acceptance passed (exit 0)
---

**判据（能取假）**：`notInFlight`/`depsSatisfied`/`touchesDisjoint`/`retryCapNotExhausted`/
`notNeedsHuman` 是**一个列表里的元素**，两个任务处理型 kind 共用。

**取假（一条命令可验）**：给两个 driver 同时新增一个谓词，**若需要改两处以上 ⇒ 假**。
⊢ 发生率已实测：缺 `depsSatisfied` ⇒ ac138 白烧 15 分钟；缺 `touchesDisjoint` ⇒ Git-History
群组撞 `serve-handlers.ts` 的风险（2026-08-23，同一个缺失抽象的两种表现）。


