---
id: gap-prod-data-accounting-audit
title: 生产数据入账审计（人 14:5xZ 令 outer 安排）——按载体聚合三态判定，先跑第一遍计数不做修复
status: ready
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

**（生产数据入账审计——人 2026-08-14 14:5xZ 逐字「要求 outer 安排审计」，推翻 manager 14:5x 的「不回查只前向生效」建议，以人为准）**。

**背景**：`gap-phase-boundary-differential-accounting` done 但生产 0 数据（测试绿靠注入假 cgroup，证明「能产出」非「已产出」）——AC83 判据2 的「只能被 fixture 满足的 AC 不作完成依据」。今天已翻 42 个任务 done，多少是「测试绿+生产零数据」形态**现在没有任何检查能告诉我们**。

**审计轴：按载体聚合，不按任务聚合**（同一个载体常被多条 AC 引用，读一次可裁决多条，便宜一个量级）。

**三态判定（⛔ 不得布尔化，硬规则③）**：
```
① 有真实数据   载体中【实现落地提交时刻之后】的记录数 ≥1
② 零数据       载体存在但落地后记录数 = 0        ← 今天那个仪器就是这一态
③ 未评估       载体不存在 / 定位不到 / 无法确定落地时刻
   ⛔ ③ 不得记为「通过」（硬规则 3b：读不懂不得与合格同形）
```

**审计自身两条自检（防重演今天形态）**：
```
⊢ 审计判据读【生产载体】，⛔ 不得读任务体自述的「已落地/已验证」
  —— 今天那个仪器任务体写着「落地 640ad48a，scoped 141/0 绿」全是真的，而生产数据是 0
⊢ 审计脚本自己也适用硬规则 4 推论三：把 fixture/注入 seam 关掉后仍能跑出结论才叫审计
```

**第一遍已跑（计数，未核实到底，量级非清单）**：
```
done 任务总数 1112 · AC 提到载体/记录/入账/遥测 609（宽松正则，含假阳性——落地时按位置重取）
具体载体引用 top：verification-round.jsonl 18 · events.jsonl 11 · checker-cost.jsonl 10 ·
  full-suite-state.json 6 · inner-blocked.json 5 · heavy-op-token-events.jsonl 5 · gate-events.jsonl 5 ...
载体三态初步：inner-blocked.json NOT-FOUND（被 5 done 任务 AC 引用）· inner-agent-budget.json NOT-FOUND（4 条）
  · heavy-op-token-events.jsonl 全仓不存在（5 条）
```

**判据1**：审计第一遍落地——按载体聚合输出三态计数与清单（①有数据/②零数据/③未评估），**不做任何修复**；那一遍成本可测，跑完再谈修不修、修哪些（「范围」未知量变成读数）。
**判据2（能取假）**：三态判定不得布尔化——③未评估必须独立取值（NOT-EVALUATED），不与①通过同形；载体存在但落地后 0 记录必须报②零数据而非通过。
**判据3**：审计读生产载体，不读任务体自述；审计脚本关掉 fixture/注入 seam 仍能跑出结论。
**判据4**：疑点按位置重查再下判——不凭正则截断的线索当结论。
**判据5（载体类型前置分类——manager 15:0xZ 补，暴露三态缺维度）**：三态判定前先分类载体【应该】长什么样：
```
累积载体（append-only） ⇒ 「落地后记录数 ≥1」是对的判据   例：verification-round.jsonl
状态文件（有/无即语义） ⇒ 「不存在」可能正是正常态         例：inner-blocked.json（CLI 唯一写入，--clear 归档，无=正常）
已退役载体             ⇒ 「不存在」是预期                 例：heavy-op-token-events（2026-08-06 人裁定退休）
```
⊢ 每个载体先查两件事（各一条命令）：**a) 全仓非测试写入者？零 ⇒ 疑似真命中；b) 出现在 retired-clause-check.ts / loop-shipping-exclusion-data.mjs ⇒ 已退役直接出局**。这两步滤掉假命中再进人工核实（manager 3 分钟滤 2/3）。
**判据6（谓词自检——manager 判准 ③b 首次执行）**：每报一个 NOT-FOUND，同时打印一个已知存在载体的命中作谓词自检（区分「文件真不在」与「find 写错」——审计的全部价值压在这个区分上）。
**判据7**：既有测试全绿 + `--for-task` scoped 门绿。

**第一遍重核结果（manager 逐条按位置查证，2/3 是假命中）**：
```
inner-blocked.json       假命中——状态文件，无=正常（inner-blocked-signal.ts:16 CLI 唯一写入）
heavy-op-token-events    假命中——已退役（retired-clause-check.ts:62，2026-08-06 人裁定）
inner-agent-budget.json  真命中——全仓零写入者（含测试），被 4 条 done 任务 AC 引用
```

**不覆盖**：不设审计范围/批次/阈值（成本结构未知，归人）；第一遍不做任何修复。

**本任务不新建过程纪律型 AC**：负控制沿用 AC49。

## Plan

1. 读 manager 筛法（按载体聚合三态）+ 已跑第一遍的载体清单。
2. 判据1：审计脚本落地（按载体聚合三态计数，无修复）。
3. 判据2：三态不布尔化（③未评估独立取值）。
4. 判据3：读生产载体 + 关注入 seam 仍可跑。
5. 判据4：疑点按位置重查。
6. 既有测试全绿 + `--for-task` scoped 门绿。

## Acceptance Criteria

- [x] AC1 判据1：按载体聚合三态审计落地（①/②/③ 计数与清单，无修复）。
- [x] AC2 判据2：三态不布尔化（③未评估独立取值）。
- [x] AC3 判据3：读生产载体 + 关注入 seam 仍可跑。
- [x] AC4 判据4：疑点按位置重查。
- [x] AC5 判据5：载体类型前置分类（累积/状态文件/已退役）——两命令过滤假命中。
- [x] AC6 判据6：NOT-FOUND 同时打印已知存在载体的命中作谓词自检。
- [x] AC7 既有测试全绿；`--for-task` scoped 门绿。

## Definition of Done

- [ ] 生产数据入账审计第一遍落地（按载体聚合三态计数+清单）+ 不布尔化 + 载体类型前置分类 + 谓词自检 + 疑点重查。

## Touches

- plugin/scripts/prod-data-audit.ts (new，按载体聚合三态审计)
- plugin/scripts/capability-catalog.sh（登记 prod-data-audit.ts 的 capability 声明——select-static-checks-for-touches 要求新增 plugin/scripts 文件带注册）
- plugin/test/prod-data-audit.test.mjs (new)
- tasks/gap-prod-data-accounting-audit.md（自身）
- docs/proposals/quay-product-outline.md（§6 DELIVERY-INVENTORY 快照——新增 plugin/scripts 文件的机械同步，delivery-inventory-drift-gate 要求同变更更新）

## Evidence

（2026-08-14 15:29Z 落地回填——第一遍审计实跑输出，`plugin/scripts/prod-data-audit.ts --json`；对真实生产树 `/home/yale/work/quay`，非 fixture）

**第一遍读数（按载体聚合，边界化引用，无修复）**：
```
生产根            /home/yale/work/quay
done 任务总数      1115
发现生产载体       163（.quay/ + .workflow-events/ + milestones/fast-mode-telemetry/）
报告载体数        15（显式命名 8 + 被 done 任务 AC 边界化引用的发现载体）
三态计数          ① has-data=11 · ② zero-data=0 · ③ not-evaluated=4
谓词自检（判据6）  verification-round.jsonl@/home/yale/work/quay/.quay/verification-round.jsonl
```

**逐载体三态 + 处置**（acRefs=AC 段边界化引用数；disp=处置）：
```
verification-round.jsonl  ① HAS_DATA  accumulator  acRefs=13  disp=OK        （167 条记录）
full-suite-state.json     ① HAS_DATA  state        acRefs=11  disp=OK
gate-events.jsonl         ① HAS_DATA  accumulator  acRefs=6   disp=OK        （38 条记录）
events.jsonl              ③ NOT_EVAL  accumulator  acRefs=5   disp=SUSPECT   仓内不存在，引用指向 $QUAY_GLOBAL_DIR 外
inner-blocked.json        ③ NOT_EVAL  state        acRefs=5   disp=NORMAL_ABSENT（状态文件，无=正常态）
checker-cost.jsonl        ① HAS_DATA  accumulator  acRefs=3   disp=OK        （8787 条记录）
inner-agent-budget.json   ③ NOT_EVAL  state        acRefs=3   disp=SUSPECT   全仓零写入者（含测试）
inner-wakeup-heartbeat.json ① HAS_DATA state       acRefs=3   disp=OK
closure-pass-last-run.json ① HAS_DATA  state        acRefs=2   disp=OK
suite-health-last-run.json ① HAS_DATA  state        acRefs=2   disp=OK
heavy-op-token-events.jsonl ③ NOT_EVAL retired     acRefs=1   disp=RETIRED  已退役（retired-clause-check.ts:62）直接出局
loop-driver.jsonl         ① HAS_DATA  accumulator  acRefs=1   disp=OK        （单 JSON 对象形态，按状态文件语义）
pool-quality-judge-state.json ① HAS_DATA state     acRefs=1   disp=OK
routine-last-run.json     ① HAS_DATA  state        acRefs=1   disp=OK
suite-state-events.jsonl  ① HAS_DATA  accumulator  acRefs=1   disp=OK        （503 条记录）
```

**manager 三条重核全部由载体复现**：
- `inner-blocked.json` → **假命中**（state 文件，无=正常态，inner-blocked-signal.ts 等 6 个非测试写入者存在）——disposition=NORMAL_ABSENT，不判 SUSPECT。
- `heavy-op-token-events.jsonl` → **假命中**（已退役，retired-clause-check.ts:62 / loop-shipping-exclusion-data.mjs）——disposition=RETIRED。
- `inner-agent-budget.json` → **真命中**（全仓可执行代码含测试零写入者 0+0，被 3 条 done 任务 AC 引用）——disposition=SUSPECT。

**本审计第一遍新增/与 manager 初步不同的发现**：
- `events.jsonl`：边界化后 5 条 AC 真引用，生产载体在仓内不存在、引用指向 `$QUAY_GLOBAL_DIR/session-liveness/events.jsonl`（仓外）——③ NOT_EVALUATED + SUSPECT（需人工决定是否追全局目录）。
- 宽松正则的假阳性被边界化滤掉：`gate-events.jsonl` 不再被计入 `events.jsonl`；`checker-cost.jsonl` 的 AC 引用由宽松 10 落到边界化 3。
- **载体级② zero-data=0**：当前快照没有任何「载体存在但落地后 0 记录」的载体级命中。今天 incident（gap-phase-boundary-differential-accounting）是【记录级】缺字段（verification-round.jsonl 167 轮中 `cpu_usec`/`psi` 字段为 0），载体级轴按设计看不到它——这正是审计轴（按载体）的边界。
- **stale-vs-latest-claim 严格判据**（①有数据但最近一条 claim 落地后零记录）：`verification-round.jsonl` 与 `full-suite-state.json` 的最近 claim 落地 2026-08-14T10:44:11Z，之后两载体零记录/零更新——今天 incident 形态在载体级的最近端可见（需人工判「载体是否本应持续被写」）。

**scoped 门**：`scripts/test.sh --for-task gap-prod-data-accounting-audit --allow-thin` exit 0；`node --test plugin/test/prod-data-audit.test.mjs` 10/10 绿（含真实生产载体路径）。
