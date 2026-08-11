---
id: gap-inner-blocked-signal-comment-refs-retired-inner-state-sh
title: inner-blocked-signal.ts:810 comment references inner-state.sh which no
  longer exists — a comment pointing at a dead mechanism
status: todo
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

- `sed -n '808,812p' plugin/scripts/inner-blocked-signal.ts`：注释含 "inner-state.sh OVER90 signal"（已修复，行号漂移至 ~:873）
- `find . -name 'inner-state.sh'` = 0 命中（文件不存在）

## Evidence (implementation)

- 注释更新（`plugin/scripts/inner-blocked-signal.ts` ~:873）：`"This is the inner-state.sh OVER90 signal"` → `"inner-blocked-signal.ts's OWN over-90m detector (reason task-over-90m)... the over-90m signal is produced HERE, from this telemetry store, not by any external observer."` 注释现指向实际机制（本模块自有的 `task-over-90m` 判定、读 `.workflow-events/` telemetry store），不再指向已退役的 inner-state.sh。
- **AC1 proof**：`grep -c "inner-state.sh" plugin/scripts/inner-blocked-signal.ts` = 0（grep exit 1 = 零命中）。
- **AC2 proof**：注释指向实际存在的机制——`task-over-90m` reason、`.workflow-events/` telemetry store、本模块自身的 over-90m 探测器；且明说 "not by any external observer"。
- **SCOPED TEST**：`bash scripts/test.sh --for-task gap-inner-blocked-signal-comment-refs-retired-inner-state-sh --allow-thin` — **EXIT 0 PASS**。selector 选中 0 个测试文件（thin allowed，touched .ts 无直接映射测试）；scoped static checks 全绿：task-contract-check no violations / superseded-capability PASS / tick-core-static-check PASS。
- **DoD 宽 grep 说明**：`grep -rn "inner-state.sh" plugin/scripts/` 剩余 11 命中，分布在 7 个 **out-of-scope** 文件（session-liveness.sh、inner-idle-log.ts、monitor-mount-check.sh、quay-init.sh、loop-shipping-exclusion-data.mjs、dead-loop-check.sh、threshold-scope-check.ts）——全部是**合法的退役/惯例注解**（如 "inner-state.sh 已退役"、"deliberately NOT here"、"旧 inner-state.sh"、BASH_SOURCE 惯例对照、shipping-exclusion 列表条目），并非误导性的「活机制」引用。Touches 仅限 inner-blocked-signal.ts，删除这些注解超出本任务范围且会削弱可读性。
