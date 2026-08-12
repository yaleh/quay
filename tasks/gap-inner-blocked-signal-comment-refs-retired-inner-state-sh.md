---
id: gap-inner-blocked-signal-comment-refs-retired-inner-state-sh
title: inner-blocked-signal.ts:810 comment references inner-state.sh which no
  longer exists — a comment pointing at a dead mechanism
status: ready
labels:
  - gap
  - defect
parent: null
children: []
extra: {}
---
## Finding

`plugin/scripts/inner-blocked-signal.ts:810` 的注释引用 `inner-state.sh` 的 OVER90 信号：

> "This is the **inner-state.sh OVER90 signal** (a task the outer already flags) made into a block..."

但 `inner-state.sh` **全仓已不存在**（`find . -name 'inner-state.sh'` = 0 命中）——该文件已退役（`gap-retire-inner-state-one-observer-targets-by-parameter`：inner-state 不观测会话、其招牌信号从未产生）。注释指向一个已死的东西，后来者会以为存在一个叫 inner-state.sh 的观测脚本。

## 性质

与今晚反复出现的 "signal is dead / shipped-but-dead-reference" 类同族：文档/注释引用一个不存在的机制，把读者的判断引向死物。修复是**一行注释更新**（把 inner-state.sh 改为退役说明或指向替代者 session-liveness.sh / inner-blocked-signal.ts 自身）。

## 修复方向

把 :810 注释里 "the inner-state.sh OVER90 signal" 改为指向实际机制（inner-blocked-signal.ts 自己的 OVER90 判定 / session-liveness 事件），或注明 inner-state.sh 已退役。

## AC（draft）

- [x] `inner-blocked-signal.ts` 无对 `inner-state.sh` 的引用（grep 零命中）
- [x] 注释指向实际存在的机制或注明退役

## DoD（draft）

- [ ] `grep -rn "inner-state.sh" plugin/scripts/` = 0（退役文件不再被引用）
- [ ] 完整套件绿

## Evidence

- `sed -n '808,812p' plugin/scripts/inner-blocked-signal.ts`：注释含 "inner-state.sh OVER90 signal"（实测现位于 :873，行号漂移）
- `find . -name 'inner-state.sh'` = 0 命中（文件不存在）
- 修复（2026-08-12）：`plugin/scripts/inner-blocked-signal.ts:873` 注释改为「this file's own OVER90 detection」，不再引用已退役的 inner-state.sh；`grep -n "inner-state" plugin/scripts/inner-blocked-signal.ts` = 0 命中（AC1 零引用满足），同一 docstring 的 :871-872 已说明实际机制（读 `.workflow-events/` 遥测库 + TASK_OVER_90M_MS 判定）
- scoped 验证（2026-08-12）：`scripts/test.sh --for-task gap-inner-blocked-signal-comment-refs-retired-inner-state-sh` → scoped static checks 全绿（task-contract-check 0 violations）+ `plugin/test/inner-blocked-signal.test.mjs` **37 pass / 0 fail**，OVERALL EXIT 0

## Touches

- plugin/scripts/inner-blocked-signal.ts（:873 注释 inner-state.sh → 退役注记/指向真实机制）
- plugin/test/inner-blocked-signal.test.mjs（注释无 inner-state.sh 引用断言，若需）
- tasks/gap-inner-blocked-signal-comment-refs-retired-inner-state-sh.md（自身：勾 AC + 贴证据）
