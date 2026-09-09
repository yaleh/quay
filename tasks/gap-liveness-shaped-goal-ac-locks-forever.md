---
id: gap-liveness-shaped-goal-ac-locks-forever
title: AC-184/186 是活性形状判据（同 AC-181 已退役的类别错误）——无反向翻转 ⇒ 激活即永久锁死
status: todo
labels:
  - gap
  - mechanism
parent: null
children: []
extra: {}
goal_ac: AC-184
---
## Proposal

**AC-184 与 AC-186 是活性形状的判据**——它们断言「某个常驻进程在跑」（AC-184：常驻 driver 进程不得
早于其 driver 源码最近一次提交；AC-186：goal-driver 常驻消费者必须在线）。这与**已被退役的 AC-181**
（「meta-driver 必须在生产载体上留下新鲜轮次」，`96f3f162b`，2026-09-06，draft→retired，**从未 active**）
是**同一类别错误**。

**为什么照原样激活是危险的**：`goal-driver.ts:633` 在判据 pass 且 AC 为 active 时机械 flip 成
achieved，而 `:640-643` 明写**驱动不做反向翻转**（achieved→active 与「激活归人」的裁定 3 打架）。
⇒ **一个会回退的量一旦翻成 achieved 就永久锁死**，此后进程死了也不会有任何东西把它翻回来。
这正是硬规则 4 要防的形态：一个结构上不可能再取假的判据不是测量。

AC-181 的退役给出了可复用的筛子：**「这个量会不会回退？会回退的属监控面，不属目标判据面。」**
目标判据面的量应当是**单调达成**的（做完就做完了）；活性是**随时可回退**的，天然属于监控。

## Plan

1. 用上述筛子逐条判定 AC-184 / AC-186，比照 AC-181 经 ABI 置为 `retired`，origin 写明**类别错误**
   与去向（⛔ 不删记录、不改号）。
2. 确认这两个量在**监控面**已有等价读数（`quay driver status --kind <k>` 的 `alive` /
   `supervisor_stale`；若缺则补），使退役不造成观测缺口——⛔ 退役不等于不再观测。
3. 把这条筛子写进 goal 机制正本 `orchestration/SPEC-goal-mechanism-2026-09-06.md`，
   使「什么样的量可以当 AC」成为可引用的成文判准，而不是只活在这一次对话里。

## Acceptance Criteria

- [ ] AC1 AC-184 / AC-186 status = retired，origin 写明类别错误与监控面去向
- [ ] AC2 两者对应的活性读数在监控面可读（给出实际命令与一次真实输出，⛔ 非「应该有」）
- [ ] AC3 SPEC 中新增该筛子，且明确「会回退的量不得作为 goal AC」
- [ ] AC4 负控制：对一条**单调达成**型 AC 套用该筛子 ⇒ 判定为「可作 AC」（证明筛子不是一律否决）
- [ ] AC5 `scripts/test.sh` 全量绿

## Definition of Done

AC1–AC5 全绿；且 `quay goal list --goal GOAL-001` 中两条为 retired，
监控面读数经一次真实执行确认存在（把命令与输出写进任务 Evidence）。

## Touches

- goals/AC-184-driver-driver.md
- goals/AC-186-goal-driver-goal-store-kind-goal.md
- orchestration/SPEC-goal-mechanism-2026-09-06.md
- tasks/gap-liveness-shaped-goal-ac-locks-forever.md
