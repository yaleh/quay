---
id: AC-177
title: G6 goal-driver 机械环在生产载体留下带 verdict 的真实记录
status: achieved
kind: criterion
goal: GOAL-001
criterion: |
  test -s .quay/goal-round.jsonl \
    && test "$(grep -c '"verdict"' .quay/goal-round.jsonl)" -ge 3
expect: exit 0（≥3 条含真实 criterion verdict 的轮次记录）
origin: |
  硬规则 4 推论三（2026-08-14 实证，代价：一个仪器"完成"了 21 小时而真实数据为 0）：
  一个只能被 fixture / 注入数据满足的判据不是测量。
  同族先例即本 GOAL 的立条依据：gap-spec-goal-store-third-sibling-kind 标 done、
  AC 全绿，而 goals/ 从未存在、gate-events 中 "gate":"goal" 零条。
evidence:
  at: 2026-09-06T23:00:21.694Z
  verdict: pass
  reading: acceptance passed (exit 0)
---

**判据（能取假）**：`.quay/goal-round.jsonl` 非空且含 ≥3 条带 `verdict` 的记录。

**取假**：今天必假（无 `goal` driver kind，该载体不存在）。

**⊢ 只计实现落地之后写入的记录**。**反例判据（一条命令可查）**：
把 fixture / 注入 seam 关掉后本条仍能通过，它才是测量；否则只是回声。

**机械环（零 LLM，人裁定 3+5 划定的边界）**：
```
每轮：对每个 active GOAL
  ① 对其每条 AC：跑 criterion → verdict → 写 evidence（落 GateEvent）
  ② I2 推导 → 全达成则 flip achieved   ← 人 2026-09-06 明裁「不算自动晋升」
  ③ I3 判陈旧（三态）  ④ I4 查分歧
```

**⛔ driver 不做的三件事**：
①`draft → active`（激活）——人裁定 3，人/manager 手动；
②`active → retired`（放弃）——与①对称，放弃是判断不是计算，driver 只报红；
③直接改 task 状态 / 机械写 `tasks/*.md`——前者撞 `expectedStatus` CAS，
后者全仓四个 driver 零先例。

**新增 kind 的改动面**：`driver-runtime.ts:110`（`DriverKind`）+ `:138-207`（`DRIVER_KINDS`，
照 `quality`/`suite` 的例程型形状）+ `plugin/scripts/goal-driver.ts` + `drivers.yml`
+ `driver-config.ts:36-42,45-58,100-107` + **`packages/quay/src/cli/driver.ts:31` 的 `KINDS` 白名单**。

**⚠️ 最后一处已漂移过一次**：`cli/driver.ts:31` 是 `["promotion","worker","outer","quality"]`，
**缺 `suite`**，而 kernel 的 `DRIVER_KINDS` 有 5 个。新增必踩。

**⊢ 三态直接复用既有形态**：`Fact.state ∈ verified | not-evaluated | failed`
（`driver-runtime.ts:762`）正好承载 I3，不需要新增表达形态。
