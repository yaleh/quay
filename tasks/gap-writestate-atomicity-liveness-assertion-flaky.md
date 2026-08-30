---
id: gap-writestate-atomicity-liveness-assertion-flaky
title: writestate-atomicity-split liveness 断言 flaky——seen.has("B")&&seen.has("C") 负载下漏采样，挡全量 fan-in
status: todo
labels:
  - gap
  - defect
parent: null
children: []
extra: {}
---
**type:** execution

## Proposal

`plugin/test/writestate-atomicity-split.test.mjs:99` 的 liveness 断言 `assert.ok(seen.has("B") && seen.has("C"))` flaky：读者必须采样到两个交替 marker B/C，但 B/C 各只存在一个写盘窗口那么短，16-lane 满负载（round 719 load=45.48）下读者采样间隔拉长就漏 B（报 `reader must observe both written markers; saw A,C`）。**真正的原子性契约 `torn == 0`（:98）在失败轮是过的**——writeJsonAtomic 的 tmp+rename 原子性没坏，挂的是采样型 liveness 断言。

**实证**：round 719（2026-08-30 06:08, runId c031a448）全量 suite 红，挡 `gap-suite-parallel-independent-installs` 机械 fan-in（exited-not-landed 两次 05:54/06:27）。该测试自己 fan-in suite（08-29 10:24）绿、rounds 692-718（~27 轮）全过、719 首败 ⇒ flaky/负载敏感类，非确定性回归。

## Plan

放宽 liveness 断言为 `torn == 0` +「至少观测到一个非初始 marker」（如 `seen.has("B") || seen.has("C")`），保留负对照 test 2（in-place 写 `torn > 0`，证读者能咬 in-place 写——test 1 不空转的前提）。⛔ 不拉长写窗（写窗依赖 timing，放宽采样才是根修）。若保留更强 liveness 需按 `gap-load-sensitive-requires-predeclared-marker` 预声明此测试为 load-sensitive。

## Acceptance Criteria

- [ ] AC1（能取假，主修）：断言放宽后 `torn == 0` 仍挡原子性回归（writeJsonAtomic 改 in-place ⇒ torn > 0 ⇒ 红），且不再因漏采 B/C 误红；（⛔ 改 in-place 仍绿 ⇒ 假）。
- [ ] AC2（能取假，负对照保留）：test 2 in-place 写仍 `torn > 0`（证读者能咬）；（⛔ 删负对照 ⇒ 假）。
- [ ] AC3（能取假，负载）：16-lane 满负载下 liveness 不再 flaky（放宽后不漏采误红）。

## Definition of Done

liveness 断言放宽为 torn==0 + 至少一个非初始 marker；AC1-AC3 全勾；全量 suite 绿；writestate 不再因漏采 B/C flaky 挡 fan-in。

## Touches

- plugin/test/writestate-atomicity-split.test.mjs（放宽 liveness 断言）
- tasks/gap-writestate-atomicity-liveness-assertion-flaky.md（自身）
