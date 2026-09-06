---
id: gap-mechanical-fan-in-red-lock-times-null
title: 机械 fan-in 红(失败)结果的锁持有时间恒 null——数据已落盘，只是失败路径的结果构造函数从不读取
status: ready
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: execution
---
**type:** execution

## Finding

`worker-outcome.jsonl` 里 `outcome:"red"` 的 `mechanical_fan_in` 记录，`lockHoldSecs`/`lockAcquireEpoch`/
`lockReleaseEpoch` 三个字段**恒为 `null`**（本任务由 dashboard Fan-in 卡的分段时间轴调查引出——红色记录
因此无法在时间轴上绘出区间段）。已定位到精确代码行，并用真实生产数据做了负控制验证：**不是数据不存在，
是失败路径的结果构造函数从不读取已经落盘的数据。**

**代码路径**（`plugin/scripts/worker-driver.ts`，`runMechanicalFanIn`）：

```
:3372  fanInLock = await acquireFanInLock({ root, task, runId })
       —— acquireFanInLock() 的 Promise 只在 holder 子进程已经把 "acquire" 事件写进
          .quay/fan-in-lock-events.jsonl 后才 resolve（:2950 `stdoutBuf.includes('"event":"acquire"')`
          才 settle）——即调用成功返回的那一刻，acquire 事件已保证落盘。
  try {
    // 5 个机械步骤（merge / anti-drift / typecheck+doc-check / scoped-gate / suite / ff）
    :3337  return fail(step, a)        —— 经 verdictOf（:3314）硬编码
    :3396  return failSuite(summary,…) —— 硬编码
    :3341  return failClean(step,…)    —— 硬编码
           所有三处一致：`lockHoldSecs: null, lockAcquireEpoch: null, lockReleaseEpoch: null`
  } catch (e) {
    return failClean("exception", …)  —— 同样硬编码 null（:3617）
  } finally {
    await releaseLock()  —— release 事件在这里才真正落盘（:2937-2943 release() 的 Promise
           在 holder 子进程 close 事件后才 resolve，即调用完成时 release 事件已保证落盘，:3620）
  }
  // 只有【成功路径】（try 内没有提前 return，落到 try 语句之后）才会读锁时间：
  :3625  const lock = readFanInLockHold(root, task, runId)
  :3627  return { outcome: "landed", ...lock, … }
```

`readFanInLockHold`（:2835-2866）全仓只有这一个调用点（`grep -c "readFanInLockHold(" plugin/scripts/worker-driver.ts`
= 2，一处定义一处调用）——**失败路径全部在 `try` 内部直接 `return`，永远走不到 :3625 这一行**，不是
"锁没拿到所以没法记"，是代码没有为失败路径设计读取路径。

`fail`/`verdictOf`/`failSuite`（:3314/3327/3396）与 `catch` 块的 `failClean("exception", …)`（:3617）
这几条路径**全部发生在 `acquireFanInLock()` 成功之后**——也就是说 acquire 事件对它们而言必然已经存在。

**真实生产数据负控制**（不是推理，是实测；已在本会话前一轮核验过）：`gap-branch-rename-manager-doc-to-author`
先后两次机械 fan-in 尝试，第一次 anti-drift 步骤失败（red），第二次成功（landed）。直接查
`.quay/fan-in-lock-events.jsonl`：
```
acquire  18:43:57Z (epoch 1788633837)  pid=3096226   ← 第一次(失败)尝试的锁
release  18:44:17Z (epoch 1788633857)  pid=3096226   ← 持锁 20 秒，完整记录在案
acquire  18:54:02Z (epoch 1788634442)  pid=3255111   ← 第二次(成功)尝试的锁
release  18:58:33Z (epoch 1788634713)  pid=3255111   ← 持锁 271 秒(=worker-outcome.jsonl 里 landed 记录的 lockHoldSecs=271)
```
而 `worker-outcome.jsonl` 里那条 red 记录的 `lockAcquireEpoch`/`lockReleaseEpoch` 却是 `null`——
数据在，只是没人去读。

**一个必须注意的陷阱（修法必须绕开，否则会引入新缺陷）**：`runId` 在这份数据里是**同一个 worker 会话级 id**
（本例中两次尝试都是 `wk-prod-1788285192`），同一个任务的两次尝试共用同一个 `runId`。`readFanInLockHold`
目前的实现（:2849-2863）是"顺序扫描整份文件、把匹配 taskId+runId 的 acquire/release 逐条覆盖，取最后一次
匹配"——**这意味着修法必须在"这次尝试失败、锁刚释放的那一刻"就同步调用读取**（和现有成功路径:3625的调用
时机完全一致：在 `releaseLock()` 之后立即读，不能延后），不能是任何形式的"事后补读"（例如 dashboard 渲染时
才回头查 `worker-outcome.jsonl` 反查 `fan-in-lock-events.jsonl`）——如果任务后续被重试过、又产生了更新的
acquire/release 事件，`readFanInLockHold(root, task, runId)` 会取到**后一次尝试**的锁区间，张冠李戴到这条
早已写死的失败记录上（本例中若延后读取，会把 271 秒的 landed 区间错误地贴到只持锁 20 秒的 red 记录上）。

**结构上确实拿不到、null 是正确值的两种例外**（不在本任务修复范围内，仅记录避免误伤）：
- `failClean("acquire-fan-in-lock", …)`（:3380）——锁本身没拿到，`acquireFanInLock()` 抛异常，
  没有 acquire 事件可读。
- `spawnMechanicalFanIn` 里子进程整体 spawn 失败/输出不可解析的 `red()`（:3662）——子进程有没有
  走到锁获取这一步、走到哪个环节死的，父进程结构上无法确定，一概而论会引入误报。

## Acceptance Criteria

- [x] AC1（覆盖范围可数）：`plugin/scripts/worker-driver.ts` 里所有【发生在 `acquireFanInLock()` 成功
      之后】的失败结果构造点（`fail`/`verdictOf`/`failSuite`/`catch` 块的 `failClean("exception", …)`，
      共 4 处调用点，1 个共享的 `verdictOf` 定义）在修复后都改为读取真实锁时间，而不是硬编码 `null`；
      `failClean("acquire-fan-in-lock", …)` 与 `spawnMechanicalFanIn` 的 `red("spawn-mechanical-fan-in", …)`
      两处结构性例外保持 `null`（对照组，见 Finding 末段）。用 `grep -c "lockHoldSecs: null, lockAcquireEpoch: null, lockReleaseEpoch: null"`
      在改动前后计数：改动前 ≥6（4 处待修 + 2 处结构性例外），改动后恰好 2（只剩两处结构性例外）。
- [x] AC2（时机正确性，防"事后补读"回归）：单元测试构造一个 fixture `fan-in-lock-events.jsonl`，
      内含同一 taskId+runId 的两组 acquire/release（模拟"先失败重试后成功"），验证【失败那次】的
      结果对象拿到的是**第一组**（更早的）acquire/release 时间，不是文件里最后一组——直接复现
      Finding 里描述的"张冠李戴"陷阱，证明修法在写入时序上是对的，不是靠巧合过的。
- [x] AC3（真实数据回归，非 fixture）：`plugin/test/worker-driver-fan-in.test.mjs` 已有 `readFanInLockHold`
      的两处既有断言（:1428/:1463，均针对成功/hang-then-release 路径）——新增一条针对【真实失败步骤】
      （如 anti-drift HARD FAIL 或 suite 红）的等价断言：锁被真实持有的场景下，`runMechanicalFanIn` 返回
      的失败结果里 `lockAcquireEpoch`/`lockReleaseEpoch` 不再是 `null`，而是与该测试自己驱动产生的
      `fan-in-lock-events.jsonl` 里对应 acquire/release 一致的具体数值（用测试自建的临时 workspace，
      不改动 `.quay/` 生产 jsonl 里已经写死的历史记录）。
- [x] AC4（下游联动不回归）：`node --experimental-strip-types --test packages/quay/test/gap-dashboard-fanin-panel-and-timeline-bars.test.mjs`
      exit 0——本任务修复后，dashboard Fan-in 卡的分段时间轴（G/H 任务落地的 `renderTimelineBarSvg`）
      对新产生的 red 记录能画出区间段而非跳过（该测试文件本身不需要为此改动，只作为下游不回归的验证面；
      若 `gap-dashboard-fanin-timestamp-timeline-anchor` 那条任务先落地，一并跑其测试）。
- [x] AC5（既有 worker-driver 测试不回归）：`scripts/test.sh --for-task gap-mechanical-fan-in-red-lock-times-null`
      （或等价 scoped 调用，覆盖 `plugin/scripts/worker-driver.ts` 及 `plugin/test/worker-driver-fan-in.test.mjs`）
      exit 0。

## Definition of Done

- 代码改动已合入 `develop`。
- `scripts/test.sh --for-task gap-mechanical-fan-in-red-lock-times-null`（或等价 scoped 调用）绿。
- 手工核验一次：让一次机械 fan-in 在某个中间步骤真实失败（或读取修复后新产生的一条 red 记录），
  确认 `worker-outcome.jsonl` 里该条 `mechanical_fan_in.lockAcquireEpoch`/`lockReleaseEpoch` 是具体数值
  而非 `null`，且与同一时刻 `.quay/fan-in-lock-events.jsonl` 里对应的 acquire/release 事件一致。
- `quay task check gap-mechanical-fan-in-red-lock-times-null --json` 的 `missing` 为 `[]`。

## Touches

- plugin/scripts/worker-driver.ts
- plugin/test/worker-driver-fan-in.test.mjs
- tasks/gap-mechanical-fan-in-red-lock-times-null.md
