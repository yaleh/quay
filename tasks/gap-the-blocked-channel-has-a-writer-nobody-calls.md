---
id: gap-the-blocked-channel-has-a-writer-nobody-calls
title: "The blocked channel is fully built — writer, reader, and an instruction in the inner's own tick doc — and has never once been used, including during a real 68-minute block"
status: todo
labels:
  - gap
  - milestone-candidate
extra:
  schema: v1
---

**type:** execution

## Proposal

管理者单独立此条，**明确不与 [[gap-retire-inner-state-one-observer-targets-by-parameter]] 混在一起**，
**因为两者处置相反**：

> 退役 `inner-state` 是**清理一个从没生效的观测工具**；
> 而 `inner-blocked` 是**一个真实需求配了一个没人调用的实现**。

### 前置问题（管理者要求先回答）：那 68 分钟，有没有任何机制能让外层知道？

**答案：没有。** 外层是那次事故的当事人，逐项列出当时手上**真正有的**信号：

| 当时可得的信号 | 「在攻难题」时长什么样 | 「在等人批准」时长什么样 |
|---|---|---|
| 遥测：任务 in-progress | 一样 | 一样 |
| worktree：1 个提交、0 脏、50 分钟前 | 一样 | 一样 |
| `.quay/inner-blocked.json` | **从未写入** | **从未写入** |

**⇒ 三个信号里，两个在两种情形下完全同形，第三个从未产生。**
外层在 17:42 与 18:16 两次读到同一组数字，两次判为正常推进——
**而 80 分钟前刚诊断过同样的形状。**

**AC9c 是那次事故之后才有的**（外层自加的机械判定：树干净且末次提交 > 20 分钟 ⇒ 必须去读 pane），
**它是外层侧的轮询启发式，不是内层侧的推送**：

> **推送带着「为什么卡住」和「需要什么」；轮询只带着「可能有问题，去看看」。
> 那次事故里，这个差别是 68 分钟。**

**⇒ 按管理者给的判据：答案是「没有」⇒ 不是删掉信道，而是把它接上。**

### 实测：信道是完整的，只是从未被用过

| 环节 | 状态 |
|---|---|
| 写入侧 `plugin/scripts/inner-blocked-signal.ts` | **存在**（`VALID_BLOCKED_REASONS` 含 `ruling-required`） |
| 读取侧 | `inner-state.sh:32`、`restart-readiness-check.sh:51` **都在读** |
| **调用指令** | **`plugin/loop/fast-mode-loop-tick.md:321,327` 明写让内层调它** |
| `.quay/inner-blocked.json` | **从未存在**——无文件，**全历史 0 次提交**；三个项目均无 |

**⇒ 这不是「没接线」。写、读、以及内层自己 tick 文档里的调用指令**都在**——
**一条写在文档里的指令，从未被执行过。**

**这决定了修法**：**再加一条文档指令不会有用**——同一条已经在那里了。

## Contract

```
measure blocked_file_writes = `git log --all --oneline -- .quay/inner-blocked.json | wc -l` 的历史写入次数字段
measure blocked_fires_in_test = `scripts/test.sh plugin/test/inner-blocked-signal.test.mjs` 中「真实阻塞路径触发写入」的用例数字段
band blocked_fires_in_test = >0
invariant 阻塞信道的价值等于它在真实阻塞时被写入的次数；写不出来的信道等于没有信道
invoke `node --no-warnings --experimental-strip-types plugin/scripts/inner-blocked-signal.ts --status`
control 构造一次真实阻塞（内层停下等裁定）⇒ 文件必须产生且带 reason；阻塞解除 ⇒ 必须清除
resume 先回答「68 分钟那次有没有机制」，再决定接上还是退役——已回答：没有 ⇒ 接上
```

## Chosen mechanism

**处置已定：接上，不退役。** 依据是上面那个前置问题的答案。

1. **不加文档指令**——`fast-mode-loop-tick.md:321,327` 已经有了，**而它没被执行**。
   **再写一遍是把同一个失败重复一次。**
2. **让触发变成机械的，而不是自觉的**：内层进入「停下等外层」这个状态时，
   **写入应当发生在它已经在做的动作上**（例如：向外层提问 / 停止推进这个动作本身就落一次写入），
   而不是要求它**额外记得**再跑一条命令。
   **一个需要「记得」的信道，在最需要它的时刻最容易被忘记**——因为那时注意力都在被卡住的事情上。
3. **测试必须证明它会响**：构造一次真实的阻塞路径 ⇒ 文件产生、带 `reason`；
   解除 ⇒ 清除。**不许只测 `inner-blocked-signal.ts` 的参数校验**——
   那只证明「写入函数能写」，不证明「阻塞时会被调用」。

**不做**：不退役写入侧（前置问题的答案是「没有机制」）；
不把它并进观测工具（**它是内层主动写的显式信道，不是观测**——
见 `SPEC-one-observer-two-surfaces.md` AC2）；
不用「外层轮询更勤」代替它（**AC9c 已经在做，那次仍然是 68 分钟**）。

## Acceptance Criteria

- [ ] AC1: **机械触发**——内层进入「停下等外层」状态时**自动**产生 `.quay/inner-blocked.json`，
      **不依赖执行者记得跑一条命令**（实跑输出贴任务体）
- [ ] AC2: **内容可行动**——文件带 `reason`（枚举内含 `ruling-required`）与**外层需要做什么**；
      **只有「我卡住了」不算通过**——那与轮询启发式给的信息量相同
- [ ] AC3: **解除路径**——阻塞解除后文件**必须被清除**（实跑贴出）；
      **负控制：未解除时不得被清除**
- [ ] AC4: **端到端重演那次事故**——构造「内层停下等批准」的真实路径 ⇒
      文件产生 ⇒ 外层可在**一个 tick 内**判出（实跑输出贴任务体）
- [ ] AC5: **反向负控制**——内层**正常工作**（长任务、无阻塞）⇒ **不得产生该文件**。
      **这条不过，AC1 不算数**——**一个总在报阻塞的信道，与从不报的一样没用**
- [ ] AC6: **测试证明它会响**，而不是只证明写入函数能写——
      现有 `inner-blocked-signal.test.mjs` 若只覆盖参数校验，**必须补真实触发路径的用例**
- [ ] AC7: 测试用 `node:test` 且带 `// @test-group governance`

## Definition of Done

- [ ] AC4 与 AC5 两个方向的实跑输出都贴进任务体
- [ ] 完整套件连跑 2 次全绿（**判据是 `fail 0` 且 `cancelled 0`**）
- [ ] 任务体记录前置问题的答案与依据：**那 68 分钟里没有任何机制**——
      遥测与 worktree 两个信号在「攻难题」与「等批准」之间完全同形，
      第三个信号从未产生；**AC9c 是事后补的轮询启发式，不是推送**
- [ ] 任务体记录：**写、读、调用指令三样都在，而信道一次没被用过**——
      **「文档里写了」与「它会发生」之间，隔着一次没人执行的动作**

## Touches

- plugin/scripts/inner-blocked-signal.ts
- plugin/loop/fast-mode-loop-tick.md
- plugin/test/inner-blocked-signal.test.mjs

## Dispatch review

reviewer: outer
at: 2026-08-04T00:45:00Z
changed: 管理者要求**单独立项、不与 `inner-state` 退役混在一起**，**因为两者处置相反**——
一个是清理从没生效的观测工具，一个是真实需求配了没人调用的实现。
**管理者给的前置问题由外层回答，因为外层就是那次事故的当事人**：
**那 68 分钟里没有任何机制能让外层知道**——遥测「任务 in-progress」与 worktree
「1 个提交、0 脏、50 分钟前」这两个信号，**在「攻难题」与「等批准」之间完全同形**；
第三个信号（`.quay/inner-blocked.json`）**从未产生**。
**⇒ 按管理者给的判据，答案是「没有」⇒ 接上，不删。**
**外层实测把问题定得更准**：这不是「没接线」——**写入侧、读取侧、
以及内层自己 tick 文档 `fast-mode-loop-tick.md:321,327` 里的调用指令，三样都在**，
而 `.quay/inner-blocked.json` **全历史 0 次提交、三个项目均无**。
**⇒ 一条写在文档里的指令从未被执行 ⇒ 再加一条文档指令不会有用。**
**因此机制段的核心是「让触发变成机械的而不是自觉的」**：
**一个需要「记得」的信道，在最需要它的时刻最容易被忘记**，因为那时注意力都在被卡住的事情上。
**AC5 是真判据**：一个总在报阻塞的信道，与从不报的一样没用。
**AC2 明令「只有『我卡住了』不算通过」**——那与外层已有的轮询启发式信息量相同，
**而那次事故证明轮询启发式不够**（AC9c 是事后补的，当时并不存在）。
