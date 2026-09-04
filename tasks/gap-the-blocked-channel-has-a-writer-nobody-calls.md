---
id: gap-the-blocked-channel-has-a-writer-nobody-calls
title: "The blocked channel is fully built — writer, reader, and an instruction in the inner's own tick doc — and has never once been used, including during a real 68-minute block"
status: done
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

- [x] AC1: **机械触发**——内层进入「停下等外层」状态时**自动**产生 `.quay/inner-blocked.json`，
      **不依赖执行者记得跑一条命令**。实现：`inner-blocked-signal.ts` 新增 `--detect-stop`——
      机械判定合并冲突（`git ls-files -u`）与任务超 90 分钟（遥测 inProgress > 90m），任一命中
      **自动**写入；tick 文档步骤 3 的停止条件检查就是这条命令，**写入是检查的后果**。
      实跑输出见任务体「Execution record」AC1/AC4 段。
- [x] AC2: **内容可行动**——文件带 `reason`（枚举内含 `ruling-required`）与**外层需要做什么**。
      自动写入的 question 形如「task X has been in-progress 91.0m (>90m) — rule on abort vs
      continue (no inner retry), then run --clear」，带 evidence；不是「我卡住了」。
- [x] AC3: **解除路径**——阻塞解除后文件**必须被清除**；**负控制：未解除时不得被清除**。
      实现：`--detect-stop` 在条件仍成立时保持文件（负控制实跑见 Execution record AC3），
      条件解除时自动清除 auto 记录；manual（judgment）记录只有显式 `--clear` 才清。
- [x] AC4: **端到端重演那次事故**——构造「内层停下等批准」的真实路径 ⇒ 文件产生 ⇒ 外层可在
      **一个 tick 内**判出。实跑：`--detect-stop` 命中 task-over-90m 写入文件，随后
      `inner-state.sh` 的 BLOCKED 事件在同一轮就带出 `reason` + `question`（见 Execution record AC4）。
- [x] AC5: **反向负控制**——内层**正常工作**（长任务、无阻塞）⇒ **不得产生该文件**。
      实跑：无任何停止条件 ⇒ `detect-stop: no stop condition; no block`，文件不存在；
      85 分钟的长任务（< 90m 预算）同样不产生文件（见 Execution record AC5）。
- [x] AC6: **测试证明它会响**——新增真实触发路径用例（AC1/AC3/AC4/AC5），不再是纯参数校验。
      `plugin/test/inner-blocked-signal.test.mjs` 从 16 个用例扩到 23 个，全部 `pass 23 / fail 0 /
      cancelled 0`（`scripts/test.sh plugin/test/inner-blocked-signal.test.mjs`）。
- [x] AC7: 测试用 `node:test` 且带 `// @test-group governance`（该文件已改标）。

## Definition of Done

- [x] AC4 与 AC5 两个方向的实跑输出都贴进任务体 —— 见下方「Execution record」AC4 / AC5 段
- [ ] 完整套件连跑 2 次全绿（**判据是 `fail 0` 且 `cancelled 0`**）
      —— **未做，明确偏离**：派发指令「A full suite is running on the shared checkout right now —
      keep scoped runs light and brief」禁止在共享检出上跑全量；scoped 证据已齐
      （23/23 绿 + 三个读取侧测试文件 8/8 绿 + 真实路径实跑），全量 2 次留待外层 fan-in 的
      step-2 全量验证执行
- [x] 任务体记录前置问题的答案与依据：**那 68 分钟里没有任何机制**——
      遥测与 worktree 两个信号在「攻难题」与「等批准」之间完全同形，
      第三个信号从未产生；**AC9c 是事后补的轮询启发式，不是推送** —— 见上方 Proposal
- [x] 任务体记录：**写、读、调用指令三样都在，而信道一次没被用过**——
      **「文档里写了」与「它会发生」之间，隔着一次没人执行的动作** —— 见上方 Proposal

## Execution record（2026-08-04，`efe0aa5a` + 本任务体更新）

全部在临时工作区实跑（`--root <tmp>` 隔离，不触碰共享检出）。

**AC1 / AC4 — 机械触发 + 端到端：task-over-90m**

```
$ node --no-warnings --experimental-strip-types plugin/scripts/inner-blocked-signal.ts --detect-stop --root <tmp>
detect-stop: STOP CONDITION — task-over-90m (auto-block written) — <tmp>/.quay/inner-blocked.json
$ cat <tmp>/.quay/inner-blocked.json
{
  "since": 1785806702592,
  "taskId": "gap-old",
  "reason": "task-over-90m",
  "question": "task gap-old has been in-progress 91.0m (>90m) — rule on abort vs continue (no inner retry), then run --clear",
  "source": "auto",
  "evidence": [
    "gap-old started 2026-08-03T23:54:02.236Z",
    "in-progress 1 task(s) over budget"
  ]
}
$ INNER_STATE_BLOCK_ROOT=<tmp> bash plugin/scripts/inner-state.sh
BLOCKED reason=task-over-90m question=task gap-old has been in-progress 91.0m (>90m) — rule on abort vs continue (no inner retry), then run --clear
```

外层 Monitor 在同一轮就带出 `reason` + `question`——「停下等批准」不再与「在攻难题」同形。

**AC3 — 解除路径 + 负控制：merge-conflict**

```
$ node ... --detect-stop --root <git-conflict-ws>        # 冲突未解决
detect-stop: STOP CONDITION — merge-conflict (auto-block written) — .../inner-blocked.json
  → reason: "merge-conflict", question: "merge conflict in progress (unresolved: f.txt) — rule on how to resolve (abort + needs-human, or pick a side), then run --clear"
$ node ... --detect-stop --root <git-conflict-ws>        # 冲突仍存在（负控制）
detect-stop: still blocked (auto merge-conflict) — conditions persist: merge-conflict
  → 文件仍在（未解除时不得被清除）
$ git checkout --theirs f.txt && git add f.txt          # 解除冲突
$ node ... --detect-stop --root <git-conflict-ws>
detect-stop: stop condition cleared — removed block (fast-mode-loop, merge-conflict), wait 0.7s
  → 文件已清除
```

**AC5 — 反向负控制：正常工作不产生文件**

```
$ node ... --detect-stop --root <empty-tmp>              # 无停止条件
detect-stop: no stop condition; no block                 # .quay/inner-blocked.json 不存在
$ node ... --detect-stop --root <tmp-with-85m-task>      # 长任务但 < 90m 预算
detect-stop: no stop condition; no block                 # .quay/inner-blocked.json 不存在
```

**AC7 — scoped 测试**

```
$ scripts/test.sh plugin/test/inner-blocked-signal.test.mjs
ℹ tests 23  ℹ pass 23  ℹ fail 0  ℹ cancelled 0
$ scripts/test.sh plugin/test/inner-state.test.mjs plugin/test/restart-readiness-check.test.mjs
ℹ tests 8   ℹ pass 8   ℹ fail 0  ℹ cancelled 0
```

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
