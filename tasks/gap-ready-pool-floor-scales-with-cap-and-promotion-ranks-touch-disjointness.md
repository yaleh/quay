---
id: gap-ready-pool-floor-scales-with-cap-and-promotion-ranks-touch-disjointness
title: "ready pool floor=3 is ZERO BUFFER for a concurrency cap of 3 — the pool
  must supply 3 NON-CONFLICTING tasks, and tonight 2 of 3 in-pool touched the
  same plugin/loop doc (any conflict empties a slot); human ruling: floor should
  be ~10x the cap (3 ⇒ ~30) because over-promotion is front-loaded not wasted
  (4-piece sets are needed anyway, touchesResolve already kicks unresolvable)
  while empty slots are pure waste — AND promotion ordering (gap>DIR only) must
  rank touch-disjointness vs in-flight + pool candidates, else even floor 30 may
  not yield 3 dispatchable; both changes together"
status: ready
labels:
  - gap
  - milestone-candidate
extra:
  schema: v1
---

**type:** execution

## Proposal

人裁定 + 管理者实测（2026-08-05）。**实测现状**：`ready-pool-check` 报 pool=2 / floor=3 / deficit=1——
**就绪池比并发上限还小**（并发 3），而 todo 积压 **58 条**。

**【人的裁定】就绪池应显著大于 inner 并发上限，甚至大一个数量级（并发 3 ⇒ floor 约 30）。** 理由：
池子要提供的不是 3 条任务，是 **3 条互不冲突的任务**；今晚实测冲突率高（池里 3 条有 2 条同触
`plugin/loop/` tick 文档），**floor=3 等于零缓冲，任一冲突就空槽**。

**【成本不对称支持这个方向】**：
- **晋级的工作不会白做**——那些 todo 迟早要写四件套，提前写只是**前移不是额外开销**；
- **空槽是纯浪费**——闲掉的 subagent 时间不回来。
⇒ **过量晋级代价是「早做了」，欠量代价是「没做」，应偏向过量。**

**【已有机制能兜住陈旧风险】**：ADR-022 那次 8 条 ready 指向已删文件的教训，`touchesResolve` 已经会
把解析不了的候选踢出 pool——**大池子只会白晋级、不会污染可派发集**。

**【第二条缺口，同样无人认领】**：§3.6 补晋按 `gap-*>DIR-*` 顺序挑，**不看候选之间及与在飞任务的触摸
相交性** ⇒ 补进来的可能全撞一起，**floor 提到 30 也可能凑不出 3 条能并发的**。建议补晋时把
「与在飞任务及池内已有候选触摸不相交」纳入排序。

**两条一起才有效，单改 floor 不够。**

### 选定机制

1. **floor 随并发上限缩放**：`POOL_FLOOR = 并发上限 × 10`（默认倍数 10，可配；并发上限取单一来源
   ——出厂文档的并发常量或共享配置）。并发 3 ⇒ floor 30。**补晋压力常开**（池常 <30），机制（或
   tick）批量补晋到 floor——补晋应用机械化，不是每 tick 手工 27 条。
2. **补晋排序纳入触摸不相交**：候选按「与在飞任务 + 与池内已有候选 **触摸不相交**」排前（用
   `checkTouchesPair`/`concurrent-batch-scheduler` 现有 disjointness 机制）；`gap-*>DIR-*` 作次排序
   tiebreak 保留。
3. **touchesResolve 守卫保留**：解析不了的候选踢出（ADR-022 教训兜底），大池只白晋级不污染。
4. **成本不对称写进文档**：过量晋级 = 前移（非浪费）、欠量 = 空槽（纯浪费），偏向过量——loop 文档
   或 ready-pool-check 头注。

**归属**：ready-pool-check 是产品机制（人已裁定「晋级节奏是机制不是角色自觉」）；本条是它的
**容量与多样性**修正。

## Acceptance Criteria

- [ ] AC1: **floor 随并发上限缩放**——`POOL_FLOOR = 并发上限 × 10`（默认 10×，可配；单一来源）；
      并发 3 ⇒ floor 30；不再硬编码 3
- [ ] AC2: **补晋排序纳入触摸不相交**——候选与在飞任务 + 池内已有候选的 disjointness 排前
      （`checkTouchesPair`）；`gap-*>DIR-*` 作次 tiebreak 保留
- [ ] AC3: **池确实能供给 ≥并发上限 条互不冲突任务**——floor 30 下，可派发集里 ≥3 条两两 disjoint
      （实测：今晚「3 条 2 条同触 loop 文档」场景不再空槽）
- [ ] AC4: **touchesResolve 守卫保留**——解析不了的候选仍踢出 pool（ADR-022 8 条 ready 指向已删文件
      的教训；大池只白晋级不污染可派发集）
- [ ] AC5: **成本不对称文档化**——过量晋级 = 前移非浪费、欠量 = 空槽纯浪费、偏向过量（loop 文档或
      ready-pool-check 头注）
- [ ] AC6: **补晋应用机械化**——机制（或 tick）批量补晋到 floor，不手工逐条（floor 30 下每 tick 应补
      多条）；既有 `gap>DIR` 顺序保留为次 tiebreak
- [ ] AC7: **真实使用**——floor 缩放下至少一次：池 ≥30 且可派发集 ≥3 条两两 disjoint（实测输出贴任务体）
- [ ] AC8: 测试用 `node:test` 且带 `// @test-group governance`

## Definition of Done

- [ ] AC1–AC8 全部勾上；AC3/AC7 实测输出贴任务体
- [ ] floor 随 cap 缩放（3 ⇒ 30）；补晋纳入 disjointness；池供给 ≥3 条互不冲突任务
- [ ] 全量套件绿（`fail 0` 且 `cancelled 0` 且 `FULL-SUITE-EXIT=0`）

## Touches

- plugin/scripts/ready-pool-check.ts（floor 缩放 + 补晋 disjointness 排序）
- plugin/test/ready-pool-check.test.mjs（AC2/AC3/AC4 断言 + 既有行为回归）
- plugin/loop/fast-mode-loop-tick.md（§3.6：floor 语义 + disjointness 补晋 + 成本不对称）
- plugin/loop/orchestrator-loop-tick.md（补晋应用批量化的接线，若适用）

## Contract

measure   pool_floor = `grep -n 'POOL_FLOOR' plugin/scripts/ready-pool-check.ts` stdout 的值
band      pool_floor = 并发上限 × 10（默认 30，可配）
invariant pool_yields_cap_disjoint = 1（floor 30 下可派发集 ≥3 条两两 disjoint）
invoke    `node --experimental-strip-types plugin/scripts/ready-pool-check.ts --json`
control   构造 3 条同触 loop 文档的候选 ⇒ 补晋后池仍 ≥3 条 disjoint（AC3）；解析不了的候选 ⇒ 踢出（AC4）
resume    floor 缩放与 disjointness 排序分两步提交，任一步完成即写盘

## Dispatch review

reviewer: outer
at: 2026-08-05T03:5xZ
changed: 外层受人裁定 + 管理者实测立案（一条任务两缺口，一起才有效）。四处收紧：
(1) **floor 随 cap 缩放**——3 ⇒ 30（10×，可配）；池供给的是「3 条互不冲突」不是「3 条」；
(2) **补晋纳入 disjointness**——与在飞 + 池内候选的触摸不相交排前（checkTouchesPair），否则 floor 30
    也凑不出 3 条并发；
(3) **成本不对称写死**——过量 = 前移非浪费、欠量 = 空槽纯浪费，偏向过量；touchesResolve 兜陈旧；
(4) **补晋应用机械化**——floor 30 下批量补晋，不手工逐条。
status: todo——ready-pool-check 产品机制修正；排当前链（c 块在飞 → scoped）后，高优先。
