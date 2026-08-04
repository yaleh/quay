---
id: gap-the-one-condition-the-channel-was-built-for-still-has-no-trigger
title: "ruling-required is the reason the blocked channel was built for, and it is the one reason --detect-stop cannot fire"
status: todo
labels:
  - gap
  - milestone-candidate
extra:
  schema: v1
---

**type:** execution

## Proposal

[[gap-the-blocked-channel-has-a-writer-nobody-calls]] 已关闭，**交付是实的**：
`--detect-stop` 机械检测停止条件并自动写入，双向负控制齐全，测试从 16 例扩到 23 例全绿。
**本条不是否定它。**

**但外层核实时发现一处缺口**：`--detect-stop` 自动检测的是

| 条件 | 性质 |
|---|---|
| `merge-conflict`（`git ls-files -u`） | **结构性**，真停止条件 |
| `task-over-90m`（遥测 inProgress > 90m） | **年龄代理** |

而 **`ruling-required`**——枚举里明写 *any question the outer must rule on*——
**没有任何机械触发**：源码 `:60` 与 `:120` 明确它是 judgment 条件，
**只能靠 `--assert-blocked` 手动写入、且永不自动清除**。

### 这正是那 68 分钟对应的那个 reason

那次事故：内层停下等外层批准，**68 分钟**。按现在的实现：

- `merge-conflict`：不适用（没有冲突）；
- `task-over-90m`：**在第 90 分钟才触发** ⇒ **比事故实际被解决晚 22 分钟**；
- `ruling-required`：**需要内层记得手动写** ⇒ **正是原任务判定「行不通」的那条路径**。

**⇒ 为那次事故建的机制，抓不住那次事故。**

**而原任务的 AC1 文本写的是**「内层进入**停下等外层**这个状态时自动产生」，
**它被勾上了，但实现满足的是一个更弱的性质**：
**检测两个与「停下等外层」相关但不等价的条件。**

### 值得记住的形态（今晚第二次）

**一条 AC 的文本跨度大于实现，于是它在「已实现的那部分」上被勾上。**
今晚第一次是 `gap-the-dod-gate-encodes-a-retired-task-shape` 的 AC6
（「41 个全部可过闸、ready 队列不再为 0」被勾上，而它自己贴出的输出显示 `DIR-082` 仍不过闸）。

**⇒ 判据的写法要么收窄到实现能覆盖的范围，要么在勾选时标出未覆盖的部分。**
**两次都不是执行者不诚实——两次的实跑输出都原样贴着，缺口都是外层读输出才发现的。**

## Contract

```
measure ruling_required_auto_fires = `node --experimental-strip-types plugin/scripts/inner-blocked-signal.ts --detect-stop --root <fixture>` 在「内层停下等裁定」夹具下自动写出 reason=ruling-required 的次数字段
measure detection_latency_min = 从「内层停止推进」到文件产生的分钟数字段
band ruling_required_auto_fires = >0
invariant 停下等裁定必须由内层已在做的动作触发，不依赖它额外记得
invoke `node --experimental-strip-types plugin/scripts/inner-blocked-signal.ts --detect-stop`
control 内层停下等裁定 ⇒ 自动写出且 latency 远小于 90 分钟；内层正常长跑 ⇒ 不得写出
resume 先找出「停下等裁定」有没有可机械观测的痕迹，再决定触发点
```

## Chosen mechanism

**第一步是找痕迹，不是加条件。**

「停下等裁定」与「在攻难题」的区别，**必须有某处可机械观测**才谈得上触发。候选：

1. **内层向外层发问这个动作本身**——它已经在做（写进 pane / 发消息），
   **触发点应当挂在这个动作上**，而不是要求它之后再记得跑一条命令；
2. **会话 transcript 停止前进**——`session-liveness` 已在读它（心跳源）；
   **「transcript 不动 + 任务仍 in-progress + 工作树干净」** 三者合取，
   比单看任务年龄精确得多，**且延迟可以远小于 90 分钟**；
3. **停止推进时必然发生的某个状态写入**（若存在）。

**不做**：不把 `task-over-90m` 的阈值调小当作解决（**那是把代理调灵敏，不是换成结构信号**，
且会把正常长跑误报——今晚 e2e 正常跑了 78 分钟）；
不要求内层「记得」调用（**原任务已证明这条路行不通**）；
不退回轮询启发式（AC9c 已经在做，那次仍然是 68 分钟）。

## Acceptance Criteria

- [ ] AC1: **痕迹先落定**——「停下等裁定」在哪一处可机械观测，给出证据；
      **若找不到，如实写明并说明为什么**，本条转为「已知不可机械检测」而非硬凑一个代理
- [ ] AC2: **自动触发**——夹具中内层停下等裁定 ⇒ **自动**写出 `reason=ruling-required`（实跑贴出）
- [ ] AC3: **延迟可判**——记录 `detection_latency_min`，**必须远小于 90 分钟**（数字贴出）
- [ ] AC4: **反向负控制**——内层**正常长跑**（如 78 分钟的真实任务）⇒ **不得写出**（实跑贴出）。
      **这条不过，AC2 不算数**——**把「抓不到」修成「总在报」是更坏的交易**
- [ ] AC5: **不破坏既有两条**——`merge-conflict` 与 `task-over-90m` 的既有行为不变（实跑对照）
- [ ] AC6: 测试用 `node:test` 且带 `// @test-group governance`

## Definition of Done

- [ ] AC2 与 AC4 两个方向的实跑输出都贴进任务体
- [ ] 完整套件连跑 2 次全绿（**判据是 `fail 0` 且 `cancelled 0`**）
- [ ] 任务体记录：**为那次事故建的机制抓不住那次事故**——
      `task-over-90m` 会在第 90 分钟触发，**比事故实际被解决晚 22 分钟**

## Touches

- plugin/scripts/inner-blocked-signal.ts
- plugin/test/inner-blocked-signal.test.mjs

## Dispatch review
reviewer: outer
at: 2026-08-04T01:45:00Z
changed: **不重开** [[gap-the-blocked-channel-has-a-writer-nobody-calls]]——
它的交付是实的（机械触发、双向负控制、23 例全绿），**且它把全量套件未跑如实标了 `[ ]`
并写明是外层的派发指令禁止的**。**新建本条承接未覆盖的那一条件。**
**核实过程**：`--detect-stop` 自动检测 `merge-conflict`（结构性）与 `task-over-90m`（年龄代理），
而 `ruling-required`（枚举里明写 *any question the outer must rule on*）
**源码 `:60`/`:120` 明确是 judgment 条件、只能手动 `--assert-blocked`**
⇒ **那 68 分钟只会在第 90 分钟被抓到，晚于它实际被解决 22 分钟。**
**AC1 要求先找痕迹再加触发**，并**允许「找不到」作为合法结论**——
硬凑一个代理会重演 `task-over-90m` 的问题。
**并预先堵死最省事的错误修法**：**不许把 90 分钟阈值调小**——
那是把代理调灵敏而非换成结构信号，且会误报正常长跑（今晚 e2e 正常跑了 78 分钟）。
**排序如实说明**：本条**不在门槛的四条断言与十条缺陷清单内**
⇒ 按管理者 01:05Z 的裁定，**排在那六条之后**。
