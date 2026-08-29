---
id: gap-retire-slot-refill-halt-mount
title: 退役 slot-refill.ts 的 .halt 挂载（checkHaltSentinel + should_refill 耦合）与 slot-free-trigger.ts 对它的 import——inner 旧派发环死层，.halt 状态信号由 outer A3 直读保留
status: todo
labels:
  - gap
  - mechanism
parent: null
children: []
extra:
  schema: execution
depends_on: []
---

**type:** execution

## Proposal

**来源**：manager 讨论「`.halt` 机制是否应退役」的 B 类消费者枚举（2026-08-29）。

**背景**：`.halt` 对【驱动】已退役——`driver-shared.ts:14` 与 `worker-driver.ts:79-83` 明说驱动不读 `.halt`
（单一真相源 = `.quay/<kind>-control.json` 的 `halted` 字段，`quay driver drain/resume` + MCP control-plane 操作）。
但 inner 旧派发环仍挂着 `.halt` 的读点，是死层的残留：

- `plugin/scripts/slot-refill.ts:414` 定义 `checkHaltSentinel`，`:837` 在 `analyzeSlotRefill` 内
  `const halt = checkHaltSentinel(root)` → `should_refill=false` + `no_refill_reason` 点名 halt。
  这是 inner 的派发闸挂载（`gap-supervisor-preemption` AC2）。inner 已退役；worker-driver 派发走自己的
  selector + control-state halt，**不读 slot-refill、不读 `.halt`**。
- `plugin/scripts/slot-free-trigger.ts:87` `import { checkHaltSentinel } from "./slot-refill.ts"`
  （`:221`/`:280` 调用），用于「halted 时抑制 SLOT-FREE 事件」。但 slot-free-trigger **已退役**
  （`gap-retire-outer-monitors-after-reconciler`：外层 Monitor 挂载已移除，脚本本体保留为共享库）。

**⛔ 关键限定（防越界）**：`slot-refill.ts` 本身**不退役**——它仍被
`fan-in-ac-completion-gate.ts:35`（`isLandedCodeComplete`）、`inner-wakeup-heartbeat.ts:66`（`FIXED_DISPATCH_CAP`）、
`inner-wakeup-heartbeat-check.ts:36`（`analyzeSlotRefill`）import，且 `outer-driver.ts` A6/A18 仍跑
`slot-refill --json` 读读数。**本任务只退 `.halt` 挂载，不退 slot-refill。**

**`.halt` 信号不消失**：outer 已有独立直读——`outer-driver.ts:208` A3 `haltStatusRoutine` 直接读 `<root>/.halt`
（存在性 + 内容 + develop 末次提交时距），不经 slot-refill。去掉 slot-refill 的 `no_refill_reason="halt"` 后，
`.halt` 状态仍由 A3 报出——这是**去重**（同一信号两个载体），不是删除信号。

## Plan

1. **复核消费者枚举**（一条命令级，按位置判定，排除注释/任务名引用）：
   `grep -rn 'checkHaltSentinel' plugin/` → 确认唯一 import = `slot-free-trigger.ts:87`、唯一内部调用 = `slot-refill.ts:837`；
   `grep -rn 'no_refill_reason\|should_refill' plugin/scripts/outer-driver.ts` → 确认 A18 只读读数不门控派发（派发归 worker-driver）。
2. 从 `slot-refill.ts` 移除 `checkHaltSentinel` 定义（`:407-422` 区块）+ `:837` 挂载调用（`analyzeSlotRefill` 内 halt 分支）。
3. 从 `slot-free-trigger.ts` 移除 `checkHaltSentinel` import（`:87`）+ 两处调用（`:221`/`:280`）。
4. 同步测试：`slot-refill.test.mjs` / `slot-refill-heartbeat.test.mjs` / `slot-free-trigger.test.mjs` 里对
   `.halt` 阻断逻辑（should_refill=false / 抑制 SLOT-FREE）的断言——移除或改断言，不留「测一个已删挂载」的红。
5. `grep -rn '.halt' plugin/scripts/capability-catalog.sh` → 若 catalog 声明了 slot-refill 的 `.halt` 能力面，同步。
6. scoped 绿 → fan-in land。

## Acceptance Criteria

- [ ] AC1（grep 判据）: 全仓 `grep -rn checkHaltSentinel plugin/` 命中 0（定义+调用全移除）；且 `slot-refill.ts`
  仍 export `isLandedCodeComplete` / `FIXED_DISPATCH_CAP` / `analyzeSlotRefill`（其余消费不破）。
- [ ] AC2（信号不丢）: `outer-driver.ts` 的 `haltStatusRoutine` 仍直接读 `<root>/.halt`（grep `haltStatusRoutine` +
  `.halt` 均命中）——`.halt` 状态信号不因本任务消失。
- [ ] AC3（测试绿）: `plugin/test/slot-refill.test.mjs` + `slot-refill-heartbeat.test.mjs` +
  `slot-free-trigger.test.mjs` scoped 绿；`.halt` 阻断断言已同步。

## Definition of Done

- [ ] 消费者枚举复核完成 + 移除 + 三测试文件 scoped 绿；AC1-3 全勾；land 到 develop。

## Touches

- plugin/scripts/slot-refill.ts
- plugin/scripts/slot-free-trigger.ts
- plugin/test/slot-refill.test.mjs
- plugin/test/slot-refill-heartbeat.test.mjs
- plugin/test/slot-free-trigger.test.mjs
- tasks/gap-retire-slot-refill-halt-mount.md
