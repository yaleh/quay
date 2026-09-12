---
id: AC-242
title: 台账不得留下「已离开复验域却尾事件为 fail」的 AC —— 否则下游判据（AC-241）结构上永不通过，被误读成「还有真缺陷」
status: achieved
kind: criterion
goal: GOAL-009
criterion: >-
  node --no-warnings --experimental-strip-types packages/quay/src/goal-store.ts check --stale-pass
expect: >-
  exit 0 = 冻结population（achieved ∧ criterion 非空 ∧ ⛔ 不在 `inAchievedReverifyScope` 域内）中不存在
  【此刻为假】的 AC，且轮转至少跑过一次；exit 1 = 存在【此刻为假】的 AC，stderr 逐条点名（可归因，
  与 AC-241 同一纪律）；exit 3 = 台账不可读，**或**冻结population 非空而轮转从未跑过——
  后者是判据的「机制不在」态，⛔ 不与「查过且全好」同形（硬规则 3b）。判据本身【纯读】：
  只解析台账，⛔ 不跑任何 criterion（零 criterion 执行开销）。
  ⚠️ 「此刻为假」这一读数由【有界轮转】供给——判据无法凭台账得知判据当前真假，那需要跑：
  轮转（`check --stale-pass --sweep`，goal-driver 每轮调用一次）重跑冻结population 中**最久未被
  轮转验证**的至多 6 条（每条 ≤60s 判据超时，单次调用 ≤30s 墙钟），verdict 以 `actor=goal-sweep`
  落进**同一本台账**；判据读它，并把「轮转写过且在 4h 内」与「尾事件是 pass 但无人近期看过」
  分成 `verifiedFresh` 与 `staleUnverified` 两个**不同**的桶（后者是「不知道」，⛔ 不是「好」）。
  ⛔ 不把冻结population 无差别纳入每轮复跑——那是 AC-216 已裁定的成本边界之外；
  有界轮转的成本上界（实测 M=81、avg 1.31s/条 ⇒ 一次全轮 ≈106s，按 1h 周期摊薄 ≈106s/小时）
  写在 `goal-store.ts` 的 `DEFAULT_SWEEP_MIN_AGE_MS` 块注释里。
origin: "本轮 readings：criteria 里 AC-241 的 verdict=fail、reason 逐字为「unattributable
  failing goal AC(s): AC-161: acceptance failed (exit 1); AC-239: …」——即 AC-241
  点名的两个不可归因项之一。而 AC-161 不出现在本次给定的任何 criteria 条目里，按 readings 的构造（criteria = 各
  ACTIVE goal 名下全部 AC），它属于非 active goal ⇒ goal-driver 已不再跑它。旁证：`timeSeries` 键
  `goal:AC-241:verdict` mode=unchanged count=49 ⇒ AC-241 已连续 49
  轮为红；`.quay/gate-events.jsonl`（即 AC-241 判据自己读的台账）中 AC-161 的最后一条 goal 事件是
  2026-09-08T19:54:48.864Z verdict=fail，其后无新事件。⇒ 冻结的失败同时使 AC-241 结构上不可能转绿，与
  AC-216 的成本边界（未声明的 achieved AC 随 GOAL
  关闭离开复验域）叠加后无人拥有。旁证二：tasks/gap-goal-criteria-bare-failing-exit-unattributable.\
  md 正文第 32 行把 AC-161(3 处) 列为待修样例，但其 ## Touches 不含
  goals/AC-161-user-level-marketplace-only.md ⇒ 该 ready 任务在授权面内改不到这个文件，其 AC7（要求
  AC-241 干跑 exit 1→0）按现有计划不可满足。故本项不由任何既有任务覆盖。"
activatedAt: 2026-09-11T07:15:57.975Z
statusLog:
  - at: 2026-09-11T07:15:57.975Z
    from: draft
    to: active
    actor: goal-driver
    reason: "triage: activate"
  - at: 2026-09-11T12:00:57.374Z
    from: active
    to: achieved
    actor: goal-driver
    reason: "I2: criterion pass"
long-term: true
fidelity:
  verdict: faithful
  reason: "fidelity judge: faithful"
  at: 2026-09-11T07:15:57.974Z
---
