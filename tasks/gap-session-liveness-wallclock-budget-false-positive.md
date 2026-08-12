---
id: gap-session-liveness-wallclock-budget-false-positive
title: session-liveness 测试墙钟预算当对错判据（waitForAlive 5000ms）→ 假阳性红
status: done
labels:
  - gap
  - defect
  - test
parent: null
children: []
extra: {}
---
**type:** execution

## Proposal

**实证（manager 2026-08-12 机制查清）**：session-liveness 测试用**固定墙钟预算**判对错——`waitForAlive(timeoutMs=5000)`、`Date.now()+2000/5000/20000/30000`。被测对象 session-liveness.sh（1512 行/108 分支/35 IO+时间调用）是**轮询循环**（sleep $INTERVAL 默认 60s，多判据要 2 轮）。测试用真 tmux（helpers 52 处）造环境。

**⇒ 测试问「事件在 N 毫秒内发生」，它想问「机制对不对」。** 负载上来 ⇒ 循环+真 tmux+派生变慢 ⇒ 事件在预算后到 ⇒ 红。**产品没坏，是测量窗口太窄。** 写死的 5000ms 正是硬规则 4 推论二点名的那类（合理性依赖机器规格的字面值，与 cpuQuota:"400%" 同族）。

**不是"测试写得糙"**：真 tmux/真轮询/真时间测实时监视器 = 最高保真。保真与确定互斥，选了保真 ⇒ 不可靠是选择的代价，不是代码错误。**改进方向 = 改「在哪里测什么」，不是把测试写好点。**

**② 修法（当轮可做）**：waitForAlive 的 5000 本意是防挂死安全网，实际成了对错判据。改**等真实信号**（marker 文件出现 / round 计数增加——countRounds/waitForRounds 已是此形态）+ **宽松上限**（预算只防挂死，不判对错）。或预算放宽到 60s / 读宿主 loadavg·nproc 缩放。

**验证锚**：(a) 高负载下 session-liveness 家族不再假阳性红（load 注入对比）；(b) 断言不变（弱化不算）；(c) 真挂死仍被抓（负控制）；(d) 全量套件绿。

## Plan

1. 读 session-liveness 测试的 waitForAlive/waitForRounds/countRounds 实现。
2. 改：等真实信号 + 宽松上限（预算只防挂死）。
3. load 注入对比验证（高负载下不再假红）。
4. 回归。

## AC

- [ ] AC1: waitForAlive/预算改等真实信号 + 宽松上限（预算只防挂死）
- [ ] AC2: 高负载下 session-liveness 家族不再假阳性红（load 对比实测）
- [ ] AC3: 断言不变（无弱化）；真挂死仍被抓（负控制）
- [ ] AC4: 既有测试全绿；`--for-task` scoped 门绿
- [ ] AC5: 无回归

## Definition of Done

- [ ] AC1–AC5 全部勾上
- [ ] 修前/修后高负载对比贴出（见 Evidence）
- [ ] 既有测试 + 新增测试全绿（`--for-task` scoped）
- [ ] 全量套件绿——外层 verification-round 验证

## Touches

- plugin/test/session-liveness-*（waitForAlive/预算实现）
- plugin/scripts/session-liveness.sh（若需暴露真实信号/round 计数）
- tasks/gap-session-liveness-wallclock-budget-false-positive.md（自身）
