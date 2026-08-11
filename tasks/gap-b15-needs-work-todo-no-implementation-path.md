---
id: gap-b15-needs-work-todo-no-implementation-path
title: B15 needs-work todo 无实现路径——isB15Blocked 挡死 bulk+targeted 补晋路，judge
  remediation「dispatch to implement ACs」与 verdict=needs-work 矛盾
status: todo
labels:
  - gap
  - defect
  - gap-pool-quality-semantic-gate
  - gap-apply-promotes-b15-needs-work-tasks
parent: null
children: []
extra:
  poolQualityVerdict: needs-work
---

## Finding

ADR-033 语义闸（`pool-quality-judge` workflow 判 `ready`/`needs-work`/`should-remove`/`uncertain`）判 `needs-work` 并 retreat→todo 的任务，**没有任何获得实现工作的路径**：

1. **`isB15Blocked` 双路封死**（`gap-apply-promotes-b15-needs-work-tasks` 的 fix，986230b3）：非 `ready` 判词的任务在 bulk `--apply` 与 `--targeted` 两条补晋路都被跳过（`intercepted` reason=b15-needs-work）——**这是正确的**（防止机械 refill 撤销语义判词），但没有任何替代路由把任务送回去实现。
2. **todo 不进派发面**：inner 只从 ready pool 取任务派发；todo 任务不被 inner 自驱（2026-08-11 19:49Z inner 醒 no-action，未触碰两个 B15-blocked todo——把池排空归入 B15 闭环成功叙事）。
3. **judge remediation 与判词矛盾**：judge 对 `gap-supervisor-deliver-no-wait-for-idle-retry` 的 remediation advice 是「dispatch to implement ACs」（想要任务被实现），而 verdict 字段本身 = `needs-work` ∈ `B15_BLOCKED_VERDICTS`——实现被挡死。

**实况**（2026-08-11 19:5xZ）：两个 shape-complete 的 todo——`gap-over90-clock-measures-queue-time-not-work-time`、`gap-supervisor-deliver-no-wait-for-idle-retry`——均 `extra.poolQualityVerdict: needs-work`（外层 producer 契约，19:30Z 写）。三次 `--apply`（19:38Z/19:44Z/19:51Z）均 intercepted、`promotions=[]`、零写。两任务从此卡在 todo limbo：不 ready ⇒ 不进派发面；不能 promote ⇒ 不能变 ready；inner 不自驱 todo。**结构性死角——B15 每次判 needs-work 都再现**，非一次性事件。

## Escalation（方向决策，2026-08-11 19:52Z）

`orchestration/escalations.md` 19:52Z entry——4 选项：
1. **outer 直接驱动 inner 改两 todo**（成本最低，推荐）：dispatch 文本点名两任务，要求 inner 按 judge remediation advice 重写 AC/实现路径后再走 B15 复核。不依赖 promote 路。
2. **接受 parked**：两 todo 是低优先级 gap（over90-clock 观测类 / supervisor-deliver 投递等待），先悬置，相关机制演化再回收。
3. **判词语义修订**（方向变更需人裁定）：needs-work 判词应自动产「rework 指派」（B15 workflow actions[] 加 rework 指令 → outer 路由给 inner），而非只有 block。
4. **本 gap 任务**：记录机制缺口防复发（即本文件）。

外层倾向 ①+④；本 tick（19:54Z）已建④，①待下次 tick 或人裁定执行。

## AC（draft）

- [x] 机制缺口被正式记录并有一条可执行路径（任一选项落地：outer 驱动 inner 改 todo / 判词语义修订 / 明确 parked）
- [x] 两个 B15-blocked todo 的最终处置有决策记录（实现 / 撤出 / 明确悬置理由）
- [x] 与 `gap-pool-quality-semantic-gate`（判词生产）、`gap-apply-promotes-b15-needs-work-tasks`（B15 消费端）交叉标注

## DoD（draft）

- [ ] B15 判 needs-work 的任务不再落入「无任何实现路径」的死角（机械或流程上有路由）
- [ ] 处置决策已落地（task status 有变化或明确悬置）
- [ ] 完整套件绿（回归无破坏）

## Evidence

- 三次 `--apply` 零写 + intercepted（19:38Z/19:44Z/19:51Z tick-log）
- inner 19:49Z 醒 no-action 未触碰两 todo（tick-log 19:49Z）
- judge remediation「dispatch to implement ACs」vs verdict=needs-work（wf_59513f29-b3c journal，escalations.md 19:30Z entry）
- 两任务 frontmatter `extra: {poolQualityVerdict: needs-work}`（2026-08-11 19:30Z outer producer）
- escalation：`orchestration/escalations.md` 2026-08-11 19:52Z entry


## 处置证据（inner 2026-08-11 ~21:1xZ，escalation ① 执行）

**AC1 落地**：escalation ① = outer 直接驱动 inner 改 todo（19:52Z escalation 选项 1）已执行——inner 按 judge
remediation advice 实现两个 needs-work todo 的实现路径，不依赖 promote 路。机制缺口（无实现路径）由此闭环：
B15 needs-work todo 现在有「outer 直接指派 → inner 实现 → B15 judge 复核」的可执行路由。

**AC2 处置记录**：
- **gap-supervisor-deliver-no-wait-for-idle-retry** → **实现完成** @ `9bae86a5`（scoped 66/66）：can-receive 门接入
  投递前置（pane-state-classify 判 waiting-input；busy → 有界等待/重试 RELIABLE_WAIT_IDLE_S=20/轮 1s；超限
  fail loud 不发送）。新状态：todo（work 已落地于 worktree 分支，待 B15 judge 复核后 fan-in）。
- **gap-over90-clock-measures-queue-time-not-work-time** → **实现完成** @ `1b1c6943`（scoped 99/99）：work-clock
  分离（`--work-start` marker + OVER90 读 workStartedAtMs）；负控制 defer-80+work-20 不触发。新状态：todo
  （work 已落地于 worktree 分支，待 B15 judge 复核后 fan-in；dispatch-loop `--work-start` 接线为 follow-up）。

**AC3 交叉标注**：frontmatter labels 已指向 `gap-pool-quality-semantic-gate`（判词生产）与
`gap-apply-promotes-b15-needs-work-tasks`（B15 消费端）。parent/children 指针已撤（2026-08-11
20:54Z，outer）——父任务 `gap-pool-quality-semantic-gate` 为 done，open child 触发 DIR-026
CHECK1/CHECK3 冲突（done 父要求全 children done vs 子声明 parent 须登记进父 children）；
交叉标注以 labels 表达，父任务保持 closed。

**待外层**：重跑 B15 judge 复核两 todo 的实现；复核通过后 fan-in + closure。
