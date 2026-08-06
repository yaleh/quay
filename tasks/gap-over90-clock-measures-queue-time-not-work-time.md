---
id: gap-over90-clock-measures-queue-time-not-work-time
title: OVER90's 90-min clock starts at task-start, which may precede actual work
  (defer/queue) — three triggers tonight (crash-leftover,
  needs-human-not-closed, queue-time) none was "work really timed out"
status: todo
labels:
  - gap
  - defect
parent: null
children: []
extra: {}
---
## Finding

OVER90 的 90 分钟时钟从 `--task-start` 起算，**可能先于实际工作开启**（括号在 touches-overlap defer / 排队前就已打开），因此它测的是【排队时间 + 工作时间】，不区分两者。设计意图是抓"started but never ended"（真实工作超时）。

## 今晚三次 OVER90 停派，没有一次是设计要抓的形态

| 实例 | 成因 | 是否"工作真的超时" |
|---|---|---|
| 15:53/16:23 崩溃遗留（manager-productization 双括号） | 崩溃 → `--task-end` 永不到来 | ❌ |
| chart2-s2 needs-human 未闭合（21:21） | 路由到 needs-human 时没关括号 | ❌ |
| ac8 defer 排队（21:49 起，touches 与 session-pid 重叠时开括号） | 括号在 defer 前开，时钟测排队 | ❌（ac8 实际在 22:0x 开始执行，13.5min 里含排队段） |

**三次触发，零次是"真实长工作/卡死"**——OVER90 的时钟口径与其设计意图系统性不符。

## 性质

与 `gap-chart2-s2` needs-human 未闭合、崩溃遗留幽灵同族（都是括号生命周期管理），但这是**时钟口径**问题：即使括号最终正常闭合，defer/排队段也被计入 90 分钟。任何 touches-overlap defer 的任务都可能因排队时间被 OVER90 误触停派。

## 修复方向（接法留执行时）

1. **括号开启时机移到 defer 之后**：touches-overlap 检查 defer 时，若括号已开则先 `--task-end`（或把 defer 前的时间不计入）。
2. **或分两个时钟**：排队时钟（defer/等待）与工作时钟（agent 实际运行）分开，OVER90 只看工作时钟。
3. 或让 defer 显式闭合括号，工作开始时重新 `--task-start`（fresh 时钟）。

## AC（draft）

- [ ] OVER90 的 90 分钟只计实际工作时间（排队/defer 段不计入）
- [ ] 负控制：构造"defer 后再工作"场景 ⇒ OVER90 不因排队段误触
- [ ] 与 `gap-chart2-s2` needs-human 未闭合、崩溃遗留幽灵任务交叉标注

## DoD（draft）

- [ ] 一个 touches-overlap defer 的任务排队 80min 后工作 20min ⇒ 不触发 OVER90（总 100min 但工作仅 20min）
- [ ] 完整套件绿

## Evidence

- ac8 括号 21:49 开（startedAtMs 1786052983264），21:4x inner 记录 touches-overlap defer，22:0x 才实际执行（agent 运行中）——13.5min 里含排队段
- 今晚三次 OVER90 触发均非"工作真的超时"（崩溃遗留 / needs-human 未闭合 / 排队）
