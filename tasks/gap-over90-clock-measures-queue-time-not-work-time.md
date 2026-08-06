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
- **预测实例（2026-08-06 22:16Z 记，结果待验）**：session-pid 括号年龄 49min（~22:57 到 90min），而 inner 正**正常推进**（CPU 42.3%，22:16 提交 "AC1-4 checked, AC5 deferred"）——若 inner 在 22:57 前未完成闭合，OVER90 将在【工作正常推进】时触发停派。这是"90 分钟时钟在测什么"最干净的样本：前三次成因（崩溃遗留/未闭合/排队）都可说"确实不该开着"，这次是"真在干活、时钟照样到点"。结果：若触发 → "OVER90 对正常工作误报"实测样本；若 inner 先闭合 → "靠速度躲过，非机制解决"。
- **代价量级（2026-08-06 22:31Z 补充，排优先级用）**：OVER90 触发不是"停那一条"，是**停掉全部派发**。实测依据：18:3x 两条崩溃遗留幽灵触发 OVER90，inner 派发被**全停 2 个多小时**，而那两条幽灵与当时在飞工作无关。⇒ 若 22:57 在 session-pid 触发，被停的是**三条正在正常推进的工作**。代价不是线性的：误报时钟 × 全局停派 = **在飞任务数 × 停派时长**（今晚两次实例：2 条在飞 / 3 条在飞）。
- **预测结果（2026-08-06 22:46 验，按预注册判据）**：session-pid **没有触发**——括号已在 90min 前从 inProgress 消失，任务仍 ready、4/9 AC。**记为【靠速度躲过，不是机制解决】**（inner 在 90min 内完成闭合；任务本身未完，闭合括号 ≠ 任务完成）。不记成"预测错了"，也不记成"机制没问题"。
- **同形态复发（2026-08-06 22:33 更强的实例）**：ac8 → needs-human 22:33:57（fan-in 冲突），**括号仍开着**（58min，~23:19 会触发 OVER90）——外层 22:4x 手动 `--task-end needs-human` 关闭。**手动关掉 chart2-s2（21:49）后 72 分钟，同一条代码路径又产生一个** ⇒ 21:49 是【补实例，不是修机制】。此问题已单列 `gap-needs-human-routing-does-not-close-bracket`。
