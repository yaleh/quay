---
id: gap-prod-data-accounting-audit
title: 生产数据入账审计（人 14:5xZ 令 outer 安排）——按载体聚合三态判定，先跑第一遍计数不做修复
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
**判据4**：疑点（inner-blocked.json 被 5 条引用但载体不在）按位置重查再下判——不凭正则截断的线索当结论。
**判据5**：既有测试全绿 + `--for-task` scoped 门绿。

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

- [ ] AC1 判据1：按载体聚合三态审计落地（①/②/③ 计数与清单，无修复）。
- [ ] AC2 判据2：三态不布尔化（③未评估独立取值）。
- [ ] AC3 判据3：读生产载体 + 关注入 seam 仍可跑。
- [ ] AC4 判据4：疑点按位置重查。
- [ ] AC5 既有测试全绿；`--for-task` scoped 门绿。

## Definition of Done

- [ ] 生产数据入账审计第一遍落地（按载体聚合三态计数+清单）+ 不布尔化 + 读生产载体 + 疑点重查。

## Touches

- plugin/scripts/prod-data-audit.ts 或 .mjs (new，按载体聚合三态审计)
- plugin/test/prod-data-audit.test.mjs (new)
- tasks/gap-prod-data-accounting-audit.md（自身）

## Evidence

（落地后回填——第一遍已跑初步读数进 Proposal）
