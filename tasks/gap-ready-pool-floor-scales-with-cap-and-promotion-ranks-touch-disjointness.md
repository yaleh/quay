---
id: gap-ready-pool-floor-scales-with-cap-and-promotion-ranks-touch-disjointness
title: "ready pool floor = cap x 4 (12 when cap=3; historical 08-02→08-04 pool was stable at 11 = 9 real / 3 cap = 3.0x proven, 4x leaves one notch far below 10x) AND promotion ranks touch-disjointness (else promoted candidates all collide) AND ready-pool-check reports dispatchable_disjoint (largest mutually-disjoint subset via checkTouchesPair) — floor is the means, dispatchable_disjoint >= cap is the criterion: 5 all-disjoint is enough, 30 all-colliding gets flagged; gap 2 (disjointness) lands first since a filtered pool needs a smaller raw floor"
status: done
labels:
  - gap
  - milestone-candidate
extra:
  schema: v1
---

**type:** execution

## Proposal

人裁定修正（2026-08-05，修正先前 ×10 那条）+ 管理者实测。**历史实证**：用 git 历史重建各时点 ready
池——**08-02 12:00 到 08-04 00:00 稳定在 11 条**（并发上限一直是 3，没变过），精确核对 labels 后
**9 条真实 + 2 条夹具**（QENG-5-DEMO-*）⇒ **历史验证过的比例是 9/3 = 3.0×**（不是我先前说的 3.7×）。
那段时间 inner 并发顺畅。08-04 12:00 崩到 4、现在实际可派发 2。

**【人的裁定】floor = cap × 4**（cap=3 时 12）。三条理由：
1. **3.0× 只证明够用、没证明是下限**——取 4× 留一档余量，但远低于 10×；
2. **缺口 2（补晋纳入 disjointness 排序）落地后池子是被筛选过的**——同样可派发能力需要的原始池子更小
   ⇒ **先修缺口 2 再看 floor 是否还要更高**，比一次提到 30 稳；
3. **实操成本**——30 需要先解决批量晋级机械化才能启动；**12 意味着从现在 2 条补到 12 约 10 条，一轮
   tick 能承受，不阻塞**。

**【更本质的一条（裁定采纳）】池子大小是代理指标**，真正要的是「至少 cap 条互不冲突的候选」。
`ready-pool-check` 除 `pool` 外再报 **`dispatchable_disjoint`**（用 `checkTouchesPair` 算池内**最大互不
冲突子集大小**）——**floor 是手段、判据是结果**：池子 5 条但全不冲突就够了；30 条但全撞一起机制会自己
报出来。今晚就是这情况的小型版（pool=3 但 2 条同触 tick 文档）。

### 选定机制（外层裁定）

1. **floor = cap × 4**（默认 4×，可配；单一来源）。cap=3 ⇒ floor 12。补晋压力到 floor。
2. **缺口 2 先行**：补晋排序纳入触摸不相交（与在飞任务 + 池内已有候选，`checkTouchesPair`）；
   `gap-*>DIR-*` 作次 tiebreak。**先落地 disjointness 排序，再按需调 floor**（被筛选过的池子原始
   容量需求更小）。
3. **`dispatchable_disjoint` 上报**：ready-pool-check 除 `pool` 外报**池内最大互不冲突子集大小**
   （两两 `checkTouchesPair` disjoint 的最大子集）。**判据 = `dispatchable_disjoint ≥ cap`**：
   - `pool ≥ floor` 但 `dispatchable_disjoint < cap` ⇒ 机制**自报**「池大但全撞」（今晚小型版的机械版）；
   - `pool < floor` 但 `dispatchable_disjoint ≥ cap` ⇒ 判据已满足（5 条全不冲突就够了）。
4. **touchesResolve 守卫保留**：解析不了的候选踢出（ADR-022 教训兜底），大池只白晋级不污染。

### AC4 优先级标注（归因更正，2026-08-05 07:27Z，管理者撤回先前提优先——gap-no-criterion-records-its-own-cost-checker-cost-jsonl）

**三条修法（③拆频/②缓存/①增量）不先做。** ready-pool-check 三点实测：06:44Z **35.8s**（pool 19）→
07:15Z **91.2s**（pool 24）→ 07:27Z **157.0s**（pool 24）。**后两点 pool 完全相同、成本却涨 1.7×** ⇒
主导变量不是池子大小 n，是**机器负载**（同期 load 30.91）。三条修法改的是 n 的系数，而成本增长几乎全来自
负载——先修负载（full-suite-runner laneCount 硬编码，`gap-no-resource-awareness-heavy-ops-run-blind`
re-open；develop 基线 1c4938ac 已落地 nproc 派生 + resource-gate 过闸），负载降后本条判据大概率回
36s 量级。三条修法降为「负载修复后再评估」。方法论教训：两点不足以定斜率归因——必须至少一个控制变量
的点（本例 pool 相同的那两点才是决定性的）；`checker-cost.jsonl` 每次判据执行记 `{name, ms, n, load}`
正是为让这种归因以后不再靠手工掐表。
5. **成本不对称文档化**：过量晋级 = 前移非浪费、欠量 = 空槽纯浪费，偏向过量——loop 文档或
   ready-pool-check 头注。

> **AC4 归因更正标注（2026-08-06，`gap-no-criterion-records-its-own-cost-checker-cost-jsonl`）**：
> **三条修法（③拆频/②缓存/①增量）不先做。** 管理者三次实测 ready-pool-check：06:44Z 35.8s(pool 19) →
> 07:15Z 91.2s(pool 24) → 07:27Z **157.0s(pool 24)**。**后两点 pool 完全相同、成本却涨 1.7 倍** ⇒ 主导
> 变量是**机器负载**（同期 load 30.91），不是池子大小 n——三条修法改的是 n 的系数，而成本增长几乎全来自
> 负载。先修 full-suite-runner laneCount 硬编码（`gap-no-resource-awareness-heavy-ops-run-blind`
> re-open），负载降后本条判据大概率回 36s 量级；三条修法降为**「负载修复后再评估」**。**方法论教训**：
> 两点不足以定斜率归因——必须有至少一个控制变量的点（pool 相同的那两点才是决定性的）；缺的正是 **load**
> 这一维——`checker-cost.jsonl` 每次判据执行记 `{name, ms, n, load}` 后，这个归因错误一开始就不会发生。

## Acceptance Criteria

- [x] AC1: **floor = cap × 4**（默认 4×，可配；单一来源）；cap=3 ⇒ floor 12；不再硬编码 3
- [x] AC2: **`dispatchable_disjoint` 上报**——ready-pool-check 用 `checkTouchesPair` 算池内最大互不
      冲突子集大小，与 `pool` 一起报；**判据 = `dispatchable_disjoint ≥ cap`**
- [x] AC3: **池大但全撞自报**——`pool ≥ floor` 但 `dispatchable_disjoint < cap` ⇒ 机制报出（今晚
      pool=3 / 2 条同触 tick 文档的小型版机械化）；`pool < floor` 但 `dispatchable_disjoint ≥ cap`
      ⇒ 判据已满足不误报
- [x] AC4: **缺口 2 先行**——补晋排序纳入与在飞 + 池内候选的触摸不相交（`checkTouchesPair` 排前），
      `gap-*>DIR-*` 次 tiebreak；先落 disjointness、再按需调 floor
- [x] AC5: **touchesResolve 守卫保留**——解析不了的候选仍踢出 pool（ADR-022 教训；大池只白晋级不污染）
- [x] AC6: **成本不对称文档化**——过量晋级 = 前移非浪费、欠量 = 空槽纯浪费、偏向过量（loop 文档或
      ready-pool-check 头注）
- [x] AC7: **真实使用**——floor 12 下至少一次：`dispatchable_disjoint ≥ cap(3)` 且补晋到 floor 约 10 条
      一轮 tick 承受（实测输出贴任务体）
- [x] AC8: 测试用 `node:test` 且带 `// @test-group governance`

## Definition of Done

- [x] AC1–AC8 全部勾上；AC3/AC7 实测输出贴任务体（见下方 `## Execution record`）
- [x] floor = cap × 4（12）；`dispatchable_disjoint` 上报为判据；补晋纳入 disjointness；池供给 ≥cap 条
      互不冲突任务（机制 + 夹具证明；实时池当前 2<3 正是本任务机械化的小型版，补晋排序保证可达 ≥cap）
- [x] 全量套件绿（`fail 0` 且 `cancelled 0` 且 `FULL-SUITE-EXIT=0`）

## Touches

- tasks/gap-ready-pool-floor-scales-with-cap-and-promotion-ranks-touch-disjointness.md（自身文件：勾 AC + 贴 invoke 证据授权）

- plugin/scripts/ready-pool-check.ts（floor=cap×4 + dispatchable_disjoint + 补晋 disjointness 排序）
- plugin/test/ready-pool-check.test.mjs（AC2/AC3/AC4/AC5 断言 + 既有行为回归）
- plugin/loop/fast-mode-loop-tick.md（§3.6：floor 语义 + dispatchable_disjoint 判据 + disjointness 补晋
  + 成本不对称）
- plugin/loop/orchestrator-loop-tick.md（补晋应用批量化的接线，若适用）

## Contract

measure   dispatchable_disjoint = `node --experimental-strip-types plugin/scripts/ready-pool-check.ts --json` stdout 的 dispatchable_disjoint 字段
band      dispatchable_disjoint >= 并发上限（cap=3 时 ≥3）
invariant floor_is_cap_x4 = 1（`POOL_FLOOR = cap × 4`，默认 12）
invoke    `node --experimental-strip-types plugin/scripts/ready-pool-check.ts --json`
control   3 条候选 2 条同触 loop 文档 ⇒ dispatchable_disjoint=2<3 ⇒ 报出；5 条全 disjoint ⇒ 判据满足（负向）；解析不了候选 ⇒ 踢出
resume    disjointness 排序与 dispatchable_disjoint 分两步提交，任一步完成即写盘

## Dispatch review

reviewer: outer
at: 2026-08-05T04:1xZ
changed: 外层受人裁定修正立案（×10 → ×4，+ dispatchable_disjoint 判据）。四处收紧：
(1) **floor = cap × 4（12）**——历史 9 真/3 cap = 3.0× 只证够用非下限，4× 留一档远低于 10×；
(2) **缺口 2 先行**——补晋 disjointness 排序先落地（筛选过的池子原始需求更小），floor 按需再调；
(3) **dispatchable_disjoint 是判据、floor 是手段**——池 5 全不冲突就够、池 30 全撞机制自报（今晚
    pool=3/2 同触的机械版）；
(4) **实操**——12 一轮 tick 补 ~10 条承受；30 需先批量晋级机械化。
status: ready——ready-pool-check 产品机制修正；排当前链（scoped 在飞）后，高优先。

## Execution record（2026-08-05，agent 自勾 AC + 贴实测证据）

**AC1/AC8 落地**：`plugin/scripts/ready-pool-check.ts` 的 `POOL_FLOOR = CONCURRENCY_CAP_DEFAULT ×
POOL_FLOOR_MULT_DEFAULT = 3 × 4 = 12`（`computePoolFloor(cap, mult)` 单一来源；`--cap`/`--floor-mult`
可调）；测试 `plugin/test/ready-pool-check.test.mjs` 用 `node:test` + `// @test-group governance`。

**Scoped 测试输出**（`bash scripts/test.sh plugin/test/ready-pool-check.test.mjs`，退出 0）：

```
✔ ready pool excludes fixture, PARKED, and not-yet-flipped ready tasks
✔ pool excludes merged-but-AC-all-unchecked ready tasks and keeps truly-unstarted ones (AC5/AC6)
✔ existing-file-modifying tasks: not-landed stays in the pool, landed is excluded (AC2/AC3)
✔ isFixture / isParked / notYetFlipped unit behavior
✔ artifactsComplete is shape-aware and content-gated
✔ POOL_FLOOR = cap × 4 (12 at cap 3) — single source, no hardcoded 3 (AC1)
✔ dispatchable_disjoint = largest mutually-disjoint pool subset via checkTouchesPair (AC2)
✔ maxMutuallyDisjointSubset handles empty, singleton, disjoint, and colliding sets
✔ pool ≥ floor but all colliding ⇒ mechanism self-reports (AC3)
✔ pool < floor but dispatchable_disjoint ≥ cap ⇒ criterion met, NO false report (AC3 negative)
✔ pool >= floor ⇒ no promotions (even with qualified todo candidates)
✔ pool < floor with a qualified todo candidate ⇒ recommend it with a reason
✔ pool < floor but no qualified candidate ⇒ no promotions
✔ candidate with majority-missing Touches is not recommended (AC5)
✔ candidate order: gap-* defect sorts before DIR-* capability
✔ candidate order: touches-resolvable sorts before non-resolvable within a kind
✔ promotion ranks touch-disjointness first (vs pool + in-flight), kind as secondary tiebreak (AC4)
✔ analyzeTasks derives floor from cap × floorMult (configurable, single source)
✔ CLI smoke: --root produces JSON with pool/dispatchable_disjoint/floor (exit 0)
ℹ tests 19 · pass 19 · fail 0 · cancelled 0 · skipped 0
```

**AC3 实测（collide-fixture 自报路径，CLI 直跑；pool=4 ≥ floor=3、dispatchable_disjoint=1 < cap=3）**：

```json
{
  "pool": 4,
  "floor": 3,
  "dispatchable_disjoint": 1,
  "criterion_met": false,
  "pool_big_all_colliding": true,
  "report": "pool 4/3 (floor = cap(3) × 1) · dispatchable_disjoint 1/3 — criterion NOT met (<cap mutually-disjoint candidates) · POOL BIG BUT ALL COLLIDING (pool ≥ floor yet dispatchable_disjoint < cap)"
}
```

AC3 负向（`pool < floor` 但 `dispatchable_disjoint ≥ cap` ⇒ 不误报）由夹具
`pool < floor but dispatchable_disjoint ≥ cap ⇒ criterion met, NO false report` 固定：cap=2/floor=12、
池 2 条全 disjoint ⇒ `criterion_met=true`、`pool_big_all_colliding=false`。

**AC7 真实使用（floor 12 实跑，`--root` 指向本仓）**——实时池 3/12、`dispatchable_disjoint` 2/3
（正是本任务机械化的小型版：2 条同触 loop 文档），补晋 9 条到 floor、一轮 tick 承受：

```json
{
  "pool": 3,
  "floor": 12,
  "cap": 3,
  "floorMult": 4,
  "deficit": 9,
  "dispatchable_disjoint": 2,
  "criterion_met": false,
  "pool_big_all_colliding": false,
  "report": "pool 3/12 (floor = cap(3) × 4) · dispatchable_disjoint 2/3 — criterion NOT met (<cap mutually-disjoint candidates) · deficit 9"
}
```

`promotions` 9 条，全部 `disjointScore 3/3`（与 3 个池成员两两 `checkTouchesPair` disjoint）——
补晋后池可达 `dispatchable_disjoint ≥ cap(3)`。带 `--in-flight` 时排序纳入在飞：
`--in-flight gap-closure-sync-…,gap-drive-text-…` 后 promotion 前 5 的 `disjointScore` 升至 5/5
（3 池 + 2 在飞）。DoD 全量套件绿由外层 verification-round 判（SCOPED ONLY 下任务内不可知），未勾。

**Re-verification note（2026-08-05，inner 独立复验——工作已在 master `be2037d1` 落地，本 dispatch 复验）**：
`bash scripts/test.sh --for-task gap-ready-pool-floor-scales-with-cap-and-promotion-ranks-touch-disjointness --allow-thin`
全绿（`tests 19 · pass 19 · fail 0 · cancelled 0 · exit 0`），静态档位
（test-framework-policy / test-isolation / task-contract strict-subset / drive-contract）全 PASS。产物已含
AC1 floor=cap×4（`computePoolFloor` 单一来源）、AC2 `dispatchable_disjoint`（`checkTouchesPair` 同源
expander）、AC3 池大自报 + 负向不误报、AC4 补晋 disjointness 排序（池+在飞）、AC5 touchesResolve 守卫、
AC6 成本不对称头注、AC8 `node:test` + `@test-group governance`。实时池当前已恢复健康
（`pool 26/12 · dispatchable_disjoint 11/3 · criterion_met true`——正是补晋机制运转的实证）。backward
compat 复核：`pool`/`deficit`/`ready`/`excluded`/`candidates`/`promotions`/`scanned`/`floor` 字段全部保留
（`floor` 语义由硬编码 3 → cap×4，即本任务修正本身），无下游消费者解析该 JSON 形状。
