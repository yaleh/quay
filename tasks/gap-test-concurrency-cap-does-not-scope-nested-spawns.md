---
id: gap-test-concurrency-cap-does-not-scope-nested-spawns
title: --test-concurrency cap only constrains top-level workers —
  quay-init/session tests spawn nested node --test (15 of 19), bypassing the cap
  → 2.5x oversubscription on 4 cores
status: todo
labels:
  - gap
  - defect
  - milestone-candidate
parent: null
children: []
extra: {}
---
## Finding

并发上限的作用域**不含嵌套派生**：`scripts/test.sh` 的 `--test-concurrency` 只约束**顶层 worker 数**，而 quay-init 族 / 会话族测试（`quay-init-check-drift` / `quay-init-drift-report` / `quay-init-laydown-closure` / `session-liveness` / `session-topology` / `runtime-usage-inventory`）内部再 spawn `node --test`——**嵌套派生绕过上限**。

## 实测（2026-08-06 21:16Z，套件 running 中）

管理者同一轮内三次读数（外层复核 load 一致）：

| 项 | 值 |
|---|---|
| nproc | **4** |
| load1 | 6.14 → 7.99 → **10.05**（持续上升） |
| cpu some avg10 | 80.48 → 84.31 → 83.41 |
| `node --test` 进程 | **19** |
| 其中父进程也是 `node --test` | **15**（嵌套派生） |

即顶层 `--test-concurrency=1`（1 个 worker），实际并发达 **19 进程 = 4 核上 2.5× 超订**。外层复核（21:1x）：load 9.89，嵌套间歇出现（压力随 quay-init/session 族测试进入而升）。

## 为什么值得修

CLAUDE.md 记载并发推导 `max(1, floor(nproc/2.1))` 正是为避免超订（"硬编码 8 在 4 核 = 4.25× 超订——8 workers + spawned subprocesses = 17 进程"）。本轮实测说明：**推导只约束顶层，嵌套派生绕过它**——那条推导修好的是一半问题。且这正是 `gap-no-resource-awareness-heavy-ops-run-blind` AC5（并发推导）与 `gap-tests-leak-tmux-servers-...`（泄漏）**都不覆盖**的形状。

## 性质

既不是"推导写错了"（顶层推导是对的），也不是"进程泄漏"（是嵌套测试的合法派生）——是**上限的作用域不含嵌套派生**。需要单列。

## 修复方向（接法留执行时）

1. 给 `scripts/test.sh` 的顶层并发加**总进程预算**（含嵌套派生），或
2. 让会 spawn 嵌套 `node --test` 的测试（quay-init/session 族）走资源闸 / 串行，或
3. 嵌套测试改为 import 被测模块（`gap-ac8-import-over-spawn` 方向——不 spawn 就没有嵌套）。

## AC（draft）

- [ ] 套件全量运行时，`node --test` 总进程数 ≤ 顶层 concurrency 的合理倍数（不超订）
- [ ] 负控制：构造嵌套 spawn 测试 ⇒ 总进程数受预算约束
- [ ] 与 `gap-no-resource-awareness-heavy-ops-run-blind` AC5 交叉标注

## DoD（draft）

- [ ] 4 核上全量套件峰值 `node --test` 进程数 ≤ 8（不再 19）
- [ ] 完整套件绿

## Evidence

- 21:16Z 三次读数：load1 6.14→7.99→10.05；cpu avg10 80.48→84.31→83.41；19 `node --test`、15 嵌套
- 嵌套目标：quay-init 族（check-drift/drift-report/laydown-closure）+ 会话族（session-liveness/session-topology/runtime-usage-inventory）
- 外层复核（21:1x）：load 9.89，嵌套间歇
