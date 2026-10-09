---
id: gap-driver-shared-sleep-timer-not-cleared-on-early-wake
title: driver-shared.ts residentLoopStop().sleep() 的 setTimeout 在提前唤醒时未被
  clearTimeout——driver-shared.test.mjs 耗时从 3.8s 回归到 62.7s（源于 07c0c3ee3）
status: done
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
---
## Finding

**优先级 P0**：本任务是用户 2026-10-09 授权的一组性能改进里顺位最高的一项（driver-shared 定时器泄漏 → direct-to-develop git fixture 成本 → cold-start 台账收口 → 跨项目资源准入协同）。

**根因（已读代码确认，非猜测）**：`plugin/scripts/driver-shared.ts:134-136` 的 `residentLoopStop().sleep(ms)` 实现：

```
sleep: (ms: number) => new Promise<void>((resolve) => {
  wakeResolve = resolve;
  setTimeout(() => { if (wakeResolve === resolve) wakeResolve = null; resolve(); }, ms);
}),
```

`setTimeout` 的返回值（timer handle）从未被保存，也从未在任何地方 `clearTimeout`。当 `requestStop()` 通过 `wakeResolve` 提前 resolve 这个 Promise 时（`driver-shared.ts:130-133`），原本排定的那个 `setTimeout` 回调**仍然留在事件循环里**，要等到它自己的 `ms` 毫秒后才触发（触发时只是一个无害的 no-op，因为 `wakeResolve` 已经是 null）——但在此之前，这个悬空定时器会拖着 Node 进程/测试文件不退出。

**直接复现**：`plugin/test/driver-shared.test.mjs:144-153` 的测试 `"residentLoopStop — requestStop 唤醒在飞的 sleep（提前 resolve，⛔ 不等满 interval）"` 调用 `ctl.sleep(60_000)` 后立刻 `ctl.requestStop()`；测试自己的断言 `elapsed < 2_000` 确实通过（Promise 层面提前 resolve 没问题），但那个 60000ms 的 `setTimeout` handle 仍然活着，整个测试文件因此要等满 60 秒才能退出。

**生产台账实测（`.quay/verification-round.jsonl`，直接读数非代理量）**：
- commit `07c0c3ee3`（"extract residentLoopStop"，2026-10-08T07:20:56Z）**之前** 781 个轮次里 `driver-shared.test.mjs` 的 durationMs 中位数：**3811ms**（常态基线）。
- 该 commit **之后** 29 个轮次中位数：**62674ms**（min 2400 为个别异常，其余稳定在 62000-66700ms 区间，2026-10-08T15:21Z ~ 2026-10-09T01:41Z）——约 16 倍回归，与悬空的 60000ms 定时器精确吻合，不是宿主噪声（同窗口其它文件没有这个量级的跳变）。

**与既有 done 任务的关系（不是重复立案）**：`gap-routine-semantic-dedup-scan-driver-sleep-requeststop-triple`（done，落地 commit 正是 `07c0c3ee3`）的 AC 只验证了三个行为语义点（到点 resolve / requestStop 提前唤醒 / 幂等不抛），11/11 测试全绿——但这三点都只关心 Promise **何时 resolve**，没有任何断言检查原定时器的 **handle 是否被释放**。这是该实现里一个未被那次 AC 覆盖到的真实缺陷，不是对那个任务的重新开工。

## AC

- [x] 修复 `sleep(ms)`：保存 `setTimeout` 返回的 handle，并在 `requestStop()` 提前唤醒对应的 sleep 时 `clearTimeout` 该 handle。语义逐字保留——`wakeResolve` 仍只在仍等于本次 resolve 时清空；`requestStop` 仍是立即 resolve、不等满 interval；幂等、无在飞 sleep 时调用不抛。既有测试全部保持通过（`node --test plugin/test/driver-shared.test.mjs` 现有 11 条断言；`outer-driver.test.mjs` + `quality-gate-driver.test.mjs` 45/45；`promotion-driver-s0*.test.mjs` + `driver-runtime-s*.test.mjs` + `driver-runtime-control-plane.test.mjs` 97/97；测试数量不得减少）。
- [x] 新增至少一条**能取假**的回归断言，直接证明"提前唤醒后原定时器已被清除"，而不是只测 Promise 提前 resolve（现状测试已经测了后者且仍然通过，因为问题根本不在 resolve 时序上）。可选手法：mock/spy 全局 `setTimeout`/`clearTimeout`（例如 Node `node:test` 的 `t.mock.timers`，或手工替换 `globalThis.setTimeout`/`clearTimeout` 并在 afterEach 还原）断言 `clearTimeout` 被以 `setTimeout` 返回的同一个 handle 调用恰好一次；或等价的、能看见"原 timer 不再产生副作用"的判据。写明判据为什么能取假（例如：若 clearTimeout 调用被删掉，这条新断言必须失败）。
- [ ] 前后对照实测（同机、隔离单文件、同一并发/环境条件，避免全量套件噪声）：命令 `time node --test plugin/test/driver-shared.test.mjs`。Before 基线复用上面 Finding 里已有的生产台账真实读数（commit 07c0c3ee3 之后 29 轮中位数 62674ms；之前 781 轮中位数 3811ms），不得重新假设或预测数字。修复落地并经过真实 worktree/driver 执行后，从 `.quay/verification-round.jsonl` 取 commit 落地之后 ≥5 个新轮次的该文件 durationMs，写入任务体，核实已回落到常态量级（参考回归前 3811ms 中位数，允许合理噪声，但不应停留在 60000ms+ 这个量级）。只写实测到的数字，不写"预期节省"。（待外部）
- [x] scoped 门：`bash scripts/test.sh --for-task gap-driver-shared-sleep-timer-not-cleared-on-early-wake --allow-thin` exit 0。

## Evidence

**AC1 — 语义逐字保留 + 既有断言全绿（实测，worktree 绝对路径 `/data/home/yale/work/quay-worktrees/gap-driver-shared-sleep-timer-not-cleared-on-early-wake`）**
- `node --test plugin/test/driver-shared.test.mjs` ⇒ **13 tests / 13 pass / 0 fail**（改前 11 条 + 新增 2 条 ⇒ 只增不减），real 2.590s。
- `node --test plugin/test/outer-driver.test.mjs plugin/test/quality-gate-driver.test.mjs plugin/test/promotion-driver-s0*.test.mjs plugin/test/driver-runtime-s*.test.mjs plugin/test/driver-runtime-control-plane.test.mjs` ⇒ **142 tests / 142 pass / 0 fail**（含 AC 点名的 45/45 与 97/97 两组），real 21.499s。
- 语义保留方式（读代码可核）：`clearTimeout` **只**加在 `requestStop` 的提前唤醒分支；到点分支**不** clear，只把 `wakeTimer` 置 `null`；`wakeResolve` 仍只在 `wakeResolve === resolve` 时清空；`requestStop` 仍立刻 resolve（⛔ 不等满 interval）；幂等、无在飞 sleep 时调用不抛（既有 3 条语义测试逐字未改、全绿）。

**AC2 — 能取假的回归断言（其「取假」已真跑验证，非推理）**
新增两条于 `plugin/test/driver-shared.test.mjs`：
1. `回归（timer 泄漏）— requestStop 提前唤醒后，本觉排定的定时器被 clearTimeout 恰一次（能取假）`：`withTimerSpies` 用 sentinel 替身接管 `globalThis.setTimeout`/`clearTimeout`（**不真正排定任何定时器**），断言 `sleep(60_000)` 排定的 handle 被 `clearTimeout` **以同一引用**清除恰好一次。
2. `回归（负控制）— 自然到点 resolve 的 sleep 不 clearTimeout（⛔ 防「一律 clear」的过度修复）`：手工触发替身定时器回调（模拟到点）⇒ `clearTimeout` 调用数须为 **0**，且此后 `requestStop()` 不再 clear、不抛。半边对照。
**取假实证（负控制真跑）**：把 `driver-shared.ts` 的 `clearTimeout(wakeTimer);` 临时删除后重跑 ⇒ **恰好这 1 条断言变红**（`✖ 回归（timer 泄漏）…`，12/13 pass/1 fail），而既有那条「requestStop 唤醒在飞的 sleep（提前 resolve）」**仍然通过**——正印证 Finding 的判断：缺陷不在 resolve 时序上，旧断言结构上测不到它。恢复该行后 13/13 复绿（`grep -n "clearTimeout(wakeTimer)"` ⇒ `driver-shared.ts:146`）。

**AC3 — 前置读数与本机前后对照已实测；落地后 ≥5 轮台账读数为【待外部】**
- Before 基线（**本轮重读** `.quay/verification-round.jsonl`，非引用 Finding 的旧数字）：以 `07c0c3ee3`（2026-10-08T07:20:56Z）为界，之前 773 轮 `driver-shared.test.mjs` durationMs **中位数 3835ms**（min 746）；之后 17 轮 **中位数 62384ms**（min 2400 / max 65279；末 6 轮 = 65279 / 62262 / 63118 / 63322 / 62384 / 62381）。
- 同机前后对照（命令即 AC 所写 `time node --test plugin/test/driver-shared.test.mjs`，同一 worktree、同一并发/环境条件）：删除 `clearTimeout` 调用（= 回归形态）⇒ **real 1m2.456s**；修复形态 ⇒ **real 0m2.590s**（文件内 `duration_ms` 2534.6）。两点与台账 3835ms / 62384ms 量级吻合。
- **为什么这一项【待外部】**：AC 要求「修复**落地**并经过真实 worktree/driver 执行后，从 `.quay/verification-round.jsonl` 取**落地 commit 之后** ≥5 个新轮次」——落地 commit 由 fan-in 的 ff-merge 在 worker 退出**之后**创建。worker 此刻能触发的轮次其 `commit` 字段必然**不含**本修复，写进去即是错误归属的记录（硬规则 4 推论三：只能被 fixture/注入满足的判据不是测量）。故按本仓库既有 214 个任务同款的 `（待外部）` 形态处置，⛔ 不勾选、⛔ 不抢跑写生产载体。
- **承接者**：常驻 suite 循环（`full-suite-runner.ts` 写 `.quay/verification-round.jsonl`，每轮记 `perFile[driver-shared.test.mjs].durationMs`——round 2464 / 2026-10-09T02:16Z 即刚落的一轮）。本任务落地后 fan-in 自身的 suite 轮即为第一条含修复的读数，其后逐轮累积；≥5 轮后由 manager 核对。**如实说明**：最后一跳是 manager/人工观测，**不会**自动回写本任务体。

**AC4 — scoped 门 exit 0（实测）**：`bash scripts/test.sh --for-task gap-driver-shared-sleep-timer-not-cleared-on-early-wake --allow-thin` ⇒ **exit=0**（13 tests / 13 pass / 0 fail）。

## DoD

修复必须经过真实的任务 worktree 执行与 fan-in（不是仅靠 fixture/单测自证），`.quay/verification-round.jsonl` 里要能看到落地之后的真实轮次读数印证 driver-shared.test.mjs 的 durationMs 已从 ~62.7s 回落（该落地后读数项见 AC3 的（待外部）说明与承接者）。新增的回归断言必须是能取假的（能具体指出：若 clearTimeout 调用被去掉，这条断言会变红——已在 AC2 的 Evidence 中真跑验证）。不弱化任何既有断言的语义，不减少测试数量（11 → 13）。

## Touches

- plugin/scripts/driver-shared.ts
- plugin/test/driver-shared.test.mjs
- tasks/gap-driver-shared-sleep-timer-not-cleared-on-early-wake.md

---