---
id: gap-baseline-red-breaker-cannot-distinguish-reanchor
title: baseline-red 断路器不能区分 re-anchor 与 LOOP DEADLOCK：只比签名、诊断恒写死锁，被红 checker 自身
  exit 0 的信号缺失
status: ready
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: execution
---
## Proposal

**atom H12**：同签名红 3 轮看似死锁，先看被红 checker 自身 exit 0（是则欠 re-anchor）。

**carrier**：`code`（签名死锁已承载；re-anchor 判别未承载）。

**carrierRef 目标**：`plugin/scripts/worker-fan-in.ts:1529-1559`。

**负臂读数（现在）**：`decideBaselineRedCircuitBreaker` 只比 `signature`；`:1551` 无条件生成 `LOOP DEADLOCK: …` 诊断；`grep -c -E 're-anchor|checkerExit' plugin/scripts/worker-fan-in.ts` = **0**；`BaselineRedRound`（`:1481-1488`）只有 `{task, signature, ts, blocked}`，无 checker exit 字段。

**判据上的关键裁决（必须写进实现）**：re-anchor 信号**不能**从 `BaselineRedRound` 记录或 suite 结果取——它们记录的是**产生红的那一轮**，那一刻 checker 按定义就是非 0，存下来对判别零信息（硬规则 4）。必须**在判定时刻新鲜测量**：cap 命中时对被挡住的 red point 各自的 checker 跑一次（**有界超时**），拿它自己的 exit。

**D 收缩预期**：H12 fresh→stale（⛔ 不作验收）。

## Plan

1. `decideBaselineRedCircuitBreaker` 保持**纯函数**，新增入参 `checkerProbes: Array<{ point: string; exit: number | null }>`（调用方测量后传入）。
2. 判词三态（`CircuitBreakerVerdict` 加 `re-anchor` 分支）：
   - `exit === 0` ⇒ 新判词 `{ kind: "re-anchor", … }`，诊断逐字写「欠 re-anchor，不是死锁」；
   - `exit !== 0` ⇒ 维持 `stop-terminal` + 现有 LOOP DEADLOCK 诊断；
   - `exit === null`（没跑成/超时）⇒ 维持 `stop-terminal`，但诊断**必须写「未评估」**，⛔ 不得与 `exit === 0` 同形（硬规则 3b）。
3. 测量侧：在 cap 命中处调用，逐 red point 跑其 checker，**有界超时**（给出上限值并说明依据），⛔ 不得让断路器自己变成卡死点。
4. 纯函数不读盘子；测量与 I/O 留在调用方。

## Acceptance Criteria

- [ ] AC1: 正臂——`checkerProbes` 含 `exit: 0` 时返回 `kind: "re-anchor"`，诊断含「欠 re-anchor」；含非 0 时返回 `stop-terminal` 与现有 LOOP DEADLOCK 诊断（两条行为测试）。
- [ ] AC2（**null 臂单独一条，不得并入 AC1**）: `exit: null` 时返回 `stop-terminal`，且诊断含「未评估」；断言其输出与 `exit: 0` 的输出**逐字不同形**（给出两侧逐字读数）。
- [ ] AC3: 新鲜测量与有界超时——给出调用点的测量代码位置、超时上限值、以及「测量失败 ⇒ null 而非抛异常」的负臂读数（注入一个必然超时的 checker）。

## Definition of Done

- 三条 AC 勾选并附逐字读数与可复跑命令。
- `scripts/test.sh --for-task gap-baseline-red-breaker-cannot-distinguish-reanchor` 绿；全量 suite 不回归。
- `CircuitBreakerVerdict` 的三态在类型层面可区分（不是靠字符串判断）；`re-anchor` 的消费者若存在，必须显式处理，⛔ 不得默认落回 stop-terminal 而静默。
- ⛔ 完成证据中不得出现「|D| 下降」。

## Touches

- plugin/scripts/worker-fan-in.ts
- plugin/test/worker-fan-in-baseline-red.test.mjs
- tasks/gap-baseline-red-breaker-cannot-distinguish-reanchor.md
