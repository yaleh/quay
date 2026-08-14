---
id: gap-ac70-serial-family-cross-suite-exclusion
title: AC70 已收编 serial 族跨 suite 并发重叠——并发 cert 的 serial 相互斥或降 1-slot【人裁定终止 2026-08-14 04:4xZ，不实施】
status: superseded
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

> **⚠️ 人裁定终止（2026-08-14 04:4xZ，立即）**：本任务（serial 族跨 suite 互斥 / 降 1-slot）**不实施**。人逐字「要求终止这一调整。保持前面已经明确的 lane 设置。」理由（manager 留档，非回辩）：AC68/AC69 两条止损均已判「不需要」（实测代价 ~2min / load 未饱和），**无新读数支撑改并发模型本身**——这是硬规则 4 推论（成本结构未知前不设数值阈值）的又一例；AC68 任务体已写死处置（per_suite_lane_budget 二选一），改并发模型不在其中也不在 AC69。**本任务保留为记录**（下次有人再想起同方向，记录上看得到它被判过）。inner 的串行止损（AC61 后 1-slot 手动串行）同按此终止。

**AC70（已收编 serial 族跨 suite 并发重叠——C15 触发更正后立）**。

> **⚠️ 立案前提事实更正·终版（manager 2026-08-14 05:0xZ 二次更正——上一条证据错，撤回）**：本任务标题与背景的「已收编 serial 族」**第一环就错了**——但 manager 04:5xZ 给的「红的全是 lowconc」**也是错的，一并撤回**（inner 拿着真 cert 输出逐条列出实际失败文件：cert5 session-liveness-sweep=**serial** / cert6 supervisor-observe=**governance** / cert7 relation-sync=**serial**；manager 点名的 thresholds-observers=**lowconc** 四轮全绿）。**manager 错因**：从 inner tick-log 文本 grep `ol-par4`（一个测试名）→ 定位到该名所在文件 thresholds-observers → 当成失败文件，**而同一行里的 `relation-sync` 才是真红的**——「名字对得上」当成「就是它」，硬规则② 违反（命中了但命中不是我要的）。**inner 的错同形**：把跨 serial/governance 两组的失败归并成「同一个已收编族」。**两次都不是读数错，是归并错。**
> **什么仍成立 / 不成立**：不成立=「红的全是 lowconc」+「收编根本没覆盖红的那几个」（依赖上一条，一并撤回）；**仍成立**=①「『session-liveness 族已收编 serial、4 例同族』是过度归并」（实际横跨 serial 与 governance，governance 不属于已收编族，inner 认了）②「不是 flake，是文档化已知限制」（同类文件头注释带该声明，inner 确认）③「取证之后要有处置，不能再变观察项」。**结论方向（那条推理链断了）仍成立，但 manager 给的证据错**。
> **第三条路（不碰并发模型，候选不实施）**：把红的文件移 serial 泳道（同族 sweep 本来就在那）——泳道标注改动，不是 lane/槽/QUAY_MAX_CONCURRENT_SUITES，落人裁定内；但「serial 泳道能否扛跨 suite 重叠」无量，C15 要求先 isolated-rerun 取证（inner 串行跑正是此步，不违反裁定）。

**背景（2026-08-14，4 例实证）**：`session-liveness-sweep.test.mjs` 等 load-sensitive serial 族**早已按 C15 收编**（`@test-group serial` + `@load-sensitive wall-clock`，2026-08-08；known-load-sensitive.ts:19 wall-clock kind）。但 **2-slot 并发 cert 下每条 suite 都跑自己的 serial 相 ⇒ 两条并发 worktree 的 serial 相彼此重叠 ⇒ 同族测试跨 suite 并发**：
```
AC55 cert1   session-liveness-sweep 红（tmux-leak FAIL）
AC57 cert5   session-liveness-sweep 红
AC57 cert6   supervisor-observe AC3d 红
AC57 cert7   tmux-leak FAIL（ol-par4/ol-trueidle/ol-subagent 残留）
```
**⇒ C15 的 per-suite serial 化防不了跨 suite 重叠——这是 C15 覆盖不到的那层。**

**与 AC69 同层**：AC69=槽满排队（第三条 suite 该排队不白等）；AC70=并发 cert 的 load-sensitive serial 族不该各自跑（互相重叠）。都指向「2-slot 并发模型对 load-sensitive 族的处理」。

**处置形态（inner 提 + outer 裁，二选一或组合）**：
- **① 1-slot 降级**：并发 cert 中，load-sensitive serial 族所在 suite 降为 1-slot（跑 serial 相时另一条等）——简单，代价是墙钟。
- **② serial 相跨 suite 互斥**：并发 cert 的 serial 相加跨 suite 锁（一个跑 serial 时另一个等）——保留 2-slot 并发，只对 serial 相串行。

**止损（inner 已执行，不等本任务）**：并发 cert 停用 2-slot 对 serial 族——从 AC61 之后（含 AC62）串行跑 cert（一次 1 条），避免 serial 相重叠；AC57 不再并发跑。

**本任务不新建过程纪律型 AC**：负控制沿用 AC49。

## Plan

1. 读 known-load-sensitive.ts（wall-clock kind 清单）+ test.sh serial 相 + 2-slot 并发模型（AC69 相邻）。
2. 形态：① 1-slot 降级（serial 族 suite 并发时降 1-slot）或 ② serial 相跨 suite 互斥（一个跑 serial 时另一个等）——按实测选。
3. 能取假：两条并发 cert 的 serial 相**时间上重叠** ⇒ 红（重叠=未互斥）。
4. 既有测试全绿 + `--for-task` scoped 门绿。

## Acceptance Criteria

- [ ] AC1 并发 cert 的 load-sensitive serial 族不跨 suite 重叠（1-slot 降级 或 serial 相跨 suite 互斥，二选一或组合）。
- [ ] AC2 能取假：两条并发 cert 的 serial 相时间重叠 ⇒ 红。
- [ ] AC3 止损已执行（串行 cert，AC61 后）+ 已收编 serial 族不回退。
- [ ] AC4 既有测试全绿；`--for-task` scoped 门绿。

## Definition of Done

- [ ] 并发 cert 的 load-sensitive serial 族不跨 suite 重叠（1-slot 降级 或 serial 相跨 suite 互斥）——机械可查（两 suite serial 相时间重叠 ⇒ 红）。
- [ ] 止损串行落地（AC61 后 1-slot 串行 cert，AC57 不再并发跑）+ 已收编 serial 族不回退。
- [ ] 既有测试全绿、`--for-task` scoped 门绿。

## Touches

- plugin/scripts/known-load-sensitive.ts（serial 族跨 suite 互斥清单/判定）
- scripts/test.sh（serial 相跨 suite 锁 或 1-slot 降级——AC69 相邻）
- plugin/scripts/（检查器 + 负控制 fixture——serial 相重叠判定）
- tasks/gap-ac70-serial-family-cross-suite-exclusion.md（自身）

## Evidence

（落地后回填）
