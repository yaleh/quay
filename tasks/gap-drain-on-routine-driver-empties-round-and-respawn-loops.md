---
id: gap-drain-on-routine-driver-empties-round-and-respawn-loops
title: 例程型 driver 被 drain 后整轮空转退出 ⇒ supervisor 每 5s 重生一次（14 小时 0 次 → 15 分钟 138
  次），且与 goal-driver 自己的 halt 语义直接矛盾
status: done
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: execution
---
## Proposal

`quay driver drain --kind goal` 对**例程型（routine）driver**（goal / quality / outer / meta 共用同一常驻循环）的实际效果不是「挡新派发、继续观测」，而是：

1. 常驻循环读到 `halted` ⇒ 写一条 `facts: []` 的空轮记录 ⇒ **`break` 退出循环 ⇒ 进程 `return 0` 结束**；
2. supervisor 看到 `exited code=0` ⇒ **5 秒后重生** ⇒ 新进程第一轮又读到 `halted` ⇒ 再退出；
3. 结果是一个**每 5 秒起停一次 node 进程**的重生循环，同时往 `.quay/goal-round.jsonl` 灌空轮记录（`round` 恒为 1，`pid` 每次不同）。

**根因位置**：`plugin/scripts/quality-gate-driver.ts:692-697`（`runResidentQualityGateLoop`）——
```ts
if (isHalted(root, process.env, controlStateRel)) {
  const rec = computeRoundRecord({ ..., facts: [], halted: true });
  fs.appendFileSync(roundLogFile, JSON.stringify(rec) + "\n", "utf8");
  break;            // ⇐ 退出整个 while ⇒ 进程结束 ⇒ supervisor 重生
}
```

### 实测（区分性对照，硬规则 4 推论四）

`.quay/goal-driver-supervisor.log` 覆盖 2026-09-06T21:47Z 起约 14 小时：

```
drain 之前（14 小时）的 respawn 次数 = 0
drain 时刻                        = 2026-09-07T11:48:42Z
首次 respawn                      = 2026-09-07T11:49:25Z   （drain 后 43 秒）
drain 之后 ~15 分钟的 respawn 次数 = 138
```

同期 `.quay/goal-round.jsonl` 上 run_id `gl-prod-1788781024` 的轮记录：**有 facts 的 2 条，`facts: []` 的 131 条**，后者全部 `halted: true`、`round: 1`、`pid` 各不相同。⇒ 只改「halt 与否」这一个变量，行为翻转；无第二个变量参与。

### 为什么这是缺陷而不是设计

**① 与 goal-driver 自己写下的 halt 语义直接矛盾。** `plugin/scripts/goal-driver.ts:601` 的注释逐字写着：

> halt 与资源门在 spawn pass 内读……**机械 criterion/缺口读数不受 halt 约束（观测性，零 LLM），只有 spawn 被 halt 挡住**

而 `runGapSpawnPass` 确实实现了这个意图（`if (gapAcs.length === 0 || opts.halted) return { spawned: 0, ... }`）。**但共用的例程循环在更外层先把进程杀了**，那一轮根本走不到 G9 ⇒ **goal-driver 自己的 halt 处理成了死代码**，而 drain 的实际语义变成「连观测一起停，并附赠一个重生循环」。同一个概念在两层实现、意图相反、外层胜出。

**② `drain` 的自述与实际不符。** `driver-runtime.ts:1169` 打印的是 `drained: goal halted (no new dispatch; in-flight workers untouched)`，`:1157` 的注释是「只挡新派发/新一轮」。**实际是挡掉了整个进程。**

**③ 仓库已经知道这个失效形态，但只堵了一半（硬规则 5b）。** `driver-runtime.ts:1070-1072` 的注释（`gap-driver-drain-no-inverse` AC2）逐字写着：

> drain 写 halted=true 后，若 start 照常 spawn supervisor，驱动会立刻……无活 supervisor 且控制态 halted ⇒ 明确拒绝并提示解闸命令（退出 1），**⛔ 不静默进 respawn 循环**

⇒ 「不得进 respawn 循环」这条原则**已经想明白并落实到了 `start` 路径**（`:1080` 的拒绝分支），**却漏了「running 中被 drain」这条路径**——而那正是 drain 的主用法。**兄弟实例在同一个文件、相隔十行。**

### 影响面

例程型的四个 kind（`goal` / `quality` / `outer` / `meta`）共用 `runResidentQualityGateLoop`，因此**都适用**。目前只有 goal 被 drain 过，故只有它显形；`quality` 自 2026-09-06 08:10 起持续运行、未被 drain，无症状 ⇒ **这是一个「还没被触发」的缺陷，不是 goal 独有**。

### 修法方向（不预设实现，但排除两种做法）

正确语义应是**「halted ⇒ 本轮不做受闸的动作，但循环继续、心跳继续、观测继续」**——即把 `break` 换成 `continue`（并照常 sleep 到下一轮），让 halt 成为**轮内的闸**而不是**进程的终止条件**。⛔ 不要靠「让 supervisor 别重生」来绕（那会把 halt 变成不可恢复的停机，且 `resume` 后没有活进程去响应）；⛔ 也不要给 goal 单独打补丁而留下其余三个 kind（硬规则 5b 正是本缺陷自己的教训）。

### 当前生产状态（实现者需知，含恢复步骤）

- goal driver 已 **stop**（`quay driver stop --kind goal`，重生抖动已终止）；
- `.quay/goal-control.json` 仍为 `halted: true`（`halted_by: quay-driver-drain`, `halted_at: 2026-09-07T11:48:42.394Z`）——**保留不清，因为一旦 resume 且启动，`gap-goal-gap-filing-spawn-budget-too-small-ring-spins-empty` 那个 180s 空转会立刻恢复烧 LLM**；
- 因此恢复必须是两步且有先后：**先修好 spawn 预算（那个任务），再** `quay driver resume --kind goal` **然后** `quay driver start --kind goal`。⚠️ 顺序不能反：`driver-runtime.ts:1080` 在控制态 halted 时会拒绝 `start`（退出 1），这是设计如此。

## AC

- [x] **halt 不再终止进程**：`runResidentQualityGateLoop` 在 `isHalted` 为真时**继续循环**（写 halted 轮记录后进入下一轮的 sleep），而不是 `break`。判据：单测起一个 `halted` 控制态下的循环，传 `maxRounds: 3`，断言写出的轮记录条数为 3 且 `round` 依次为 1/2/3。⛔ 只写出 1 条、或 `round` 恒为 1 ⇒ 假。
- [x] **受闸的只是动作，不是观测**：halted 轮的记录中，机械读数仍然产生（`facts` 非空），只有需要闸的动作被跳过。判据：以 goal 为对象，halted 状态下的一轮里 `facts[0].value.criterionCount > 0` 且 `spawned === 0`。⛔ halted 轮 `facts: []` ⇒ 假（这正是当前行为）。
- [ ] **supervisor 不再重生**：在 halted 状态下让 driver 跑满一个观测窗口（≥ 3 个轮间隔），`.quay/<kind>-driver-supervisor.log` 中该窗口内 `respawning` 出现次数为 **0**。⛔ 出现任意次 ⇒ 假。（待外部）
- [x] **四个例程型 kind 一并覆盖（硬规则 5b）**：修改落在共用的 `runResidentQualityGateLoop` 上，而非 goal 的调用点；并在提交中给出 `grep` 读数证明该循环的消费者集合（预期 goal / quality / outer / meta 四个）已全部受益。⛔ 只在 `goal-driver.ts` 侧加分支 ⇒ 假。
- [x] **drain 的自述与实际一致**：`driver-runtime.ts` 中 drain 的输出文案与注释若仍声称「只挡新派发」，则实际行为必须确实如此；否则文案须改到与实际相符。判据：`quay driver drain --kind goal` 后 30 秒内 driver 进程仍存活（`kill -0` 为真）。⛔ 进程消失而文案仍称 in-flight untouched ⇒ 假。
- [ ] **生产载体验证（⛔ 不得由 fixture 满足，硬规则 4 推论三）**：修复落地后，在生产上实做一次 drain → 观察 ≥ 3 轮 → resume，`.quay/goal-round.jsonl` 中该窗口的轮记录 `halted: true` 且 `facts` 非空、`round` 单调递增、`pid` 全程不变。⛔ `pid` 发生变化 ⇒ 仍在重生 ⇒ 假。（待外部）

## DoD

真实运行过的对象：在生产上对一个例程型 driver 完成一次「drain → 持续观测若干轮 → resume → 恢复受闸动作」的完整往返，且全程 supervisor 零 respawn、进程 pid 不变、轮记录连续且带非空 facts。

⛔ 以下都不算完成：①单测绿但没在生产做过一次真实 drain/resume 往返（等于只证明能产出、没证明已产出）；②改了 goal 的调用点而 `quality`/`outer`/`meta` 仍会重生（缺陷只是换了个 kind 显形）；③把 supervisor 的重生策略调成「不重生」来消症状——那会让 halt 变成不可恢复的停机，`resume` 后无活进程响应，属于换一个更贵的缺陷。

**关联**：与 `gap-goal-gap-filing-spawn-budget-too-small-ring-spins-empty` 是两个独立机制（那个是 spawn 预算不足导致环空转；本条是 halt 语义把进程杀掉导致重生循环），但**恢复 goal driver 需要两者都修好**，先后顺序见上文「当前生产状态」。

## Touches

- `plugin/scripts/quality-gate-driver.ts`
- `plugin/scripts/driver-runtime.ts`
- `plugin/scripts/outer-driver.ts`
- `plugin/test/quality-gate-driver.test.mjs`
- `plugin/test/outer-driver.test.mjs`
- `tasks/gap-drain-on-routine-driver-empties-round-and-respawn-loops.md`