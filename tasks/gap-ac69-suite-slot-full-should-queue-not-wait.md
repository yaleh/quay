---
id: gap-ac69-suite-slot-full-should-queue-not-wait
title: AC69 槽满时应排队不白等——第三条 suite 起跑即排队，槽空毫秒级接上（先量再改，量现成）
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

> **止损（2026-08-14 04:1xZ，人 提「活行为缺陷有两项义务：修机制+止损」）：不需要。** 现场实例：slot .1 空 130 秒后被接走，代价约 2 分钟——未达造机制量级（硬规则 12：先给发生率）。改法（先量再改：槽释放 vs 派发差值，零新机制）随任务落地，落地即止损。

**缺陷②（manager 2026-08-14 报，位置已核）**：**槽满时不排队，白等一个 tick 周期。**

三处都放行第三条：
```
资源闸    => GO（budget_available=14，load 2.49 / 上限 32，mem 8903MB）
槽        test.sh:888-894 两槽皆满时【不是失败，是 WAIT】（-n .0 → -n .1 → 等任一释放）
推导时机  拿锁(:1223) 之后 才推导(:1259) ⇒ 排队者醒来时读到的是当时真实 in_use，比现在这两条更准
```
**⇒ 第三条起了就排队，槽一空毫秒级接上，且它算出的 lane 数更准。** 现在的行为是槽空了要等 inner 下一个 tick 才被发现。

**对上 manager 上一个读数**：`.quay/inner-tick-log.jsonl` 近 40 轮 **fan-in 族 68% / dispatch 18%**（全历史 27%/23%）——槽释放到发现之间白等。

**⚠️ 先量再改（manager 建议），但量是现成的**：槽释放时刻（`/proc/locks` 或 suite 终态写入时刻）vs inner 下一次派发时刻的差——**零新机制**。若该差值稳定接近一个 tick 周期，改法就是「槽满也起、让它排队」。

**本任务不新建过程纪律型 AC**：负控制沿用 AC49。

**⚠️ 明确不覆盖（人 2026-08-14 04:4xZ 裁定终止）**：本任务**不动并发模型/lane 设置**——范围只含「槽满排队而非 WAIT」的落地形态（先量：槽释放 vs 派发差值，零新机制）；不降 1-slot、不做 serial 族跨 suite 串行（AC70 已标人裁定终止）。理由：止损已判「不需要」（实测代价 ~2min），无新读数支撑改并发模型（硬规则 4 推论）。

## Plan

1. 读 test.sh:888-894（两槽皆满 → WAIT）+ :1223/:1259（锁/推导时序）+ 资源闸放行三处。
2. **先量**：槽释放时刻 vs inner 下一次派发时刻的差（/proc/locks 或 suite 终态写入时刻，零新机制）。
3. 若差值稳定接近一个 tick 周期 ⇒ 改「槽满也起、排队等锁」（起跑即排队，槽空毫秒级接上，且推导读到真实 in_use）。
4. 既有测试全绿 + `--for-task` scoped 门绿。

## Acceptance Criteria

- [ ] AC1 先量再改：槽释放→下次派发的差已测（现成量，零新机制），结论支撑改法或维持。
- [ ] AC2 若改：第三条 suite 槽满即排队，槽空毫秒级接上，不再白等一个 tick 周期。
- [ ] AC3 排队时推导读到真实 in_use（拿锁后推导，比当前两条更准）。
- [ ] AC4 既有测试全绿；`--for-task` scoped 门绿。

## Definition of Done

- [ ] 槽释放→下次派发差值已实测（/proc/locks 或 suite 终态写入时刻，零新机制），结论支撑改法或维持。
- [ ] 若改：第三条 suite 槽满即排队、槽空毫秒级接上，排队者推导读到真实 in_use（非等 inner tick）。
- [ ] 既有测试全绿、`--for-task` scoped 门绿。

## Touches

- scripts/test.sh（槽满排队逻辑 + 锁/推导时序；本任务只接 ac69 检查器，不动 2-slot 模型）
- plugin/scripts/resource-gate.sh（放行配合——本任务未改，保留触碰声明）
- docs/analysis/ac69-slot-release-vs-dispatch-gap.json（测量记录——槽释放时刻 vs 派发时刻）
- plugin/scripts/ac69-slot-queue-gap-check.ts（测量记录检查器）
- plugin/scripts/checker-mutation-cases/ac69-slot-queue-gap-check.sh（检查器 mutation case）
- plugin/test/ac69-slot-queue-gap-check.test.mjs（检查器 fixture 测试）
- plugin/scripts/capability-catalog.sh（新 plugin/scripts 文件的登记——question + cadence/invalidation/last-reaffirmed/matching）
- docs/proposals/quay-product-outline.md（§6 DELIVERY-INVENTORY 快照随新脚本重生成）
- tasks/gap-ac69-suite-slot-full-should-queue-not-wait.md（自身）

## Evidence

**先量再改测量（2026-08-14 04:56Z，AC1/DoD）**：槽释放→下次派发差值已测，数据源 `.quay/verification-round.jsonl`（164 轮，2026-08-12T03:28Z..2026-08-13T16:19Z）。

- 方法：suite 终态写入时刻——每轮终态 = startedAt+durationMs（test.sh 退出即 flock 释放 = 该轮 suite 终态写入），下次派发 = 下一轮 startedAt；差值 = start(N+1) − end(N)。零新机制，全读现有记录。
- 结果：163 个差值，4 负（2-slot 重叠并发生效），159 正；中位 **123.4s**（约 2 分钟），均值 299.8s，min 6.7s，max 6300.8s；分布 <60s=47 / 60-300s=60 / 300-1200s=49 / >1200s=3。
- 稳态簇：300-1200s 桶的 33 个是 ~600s（10 分钟）自动重触发节拍——刻意的调度间隔，非槽竞争白等；近期轮 153-167 全 ~600s。
- 结论：**维持 2-slot 模型**——差值中位 ~2 分钟、非完整 tick 周期（1200-1800s），「白等一个 tick 周期」假设不被支持；第三条 suite 已由 test.sh `full_suite_lock_acquire` 进程内 flock WAIT（flock -w 1 轮询，~1s 粒度）排队，槽空即接上。与 2026-08-14 04:1xZ 止损裁定（实测代价 ~2 分钟，未达造机制量级，硬规则 12）一致。
- 机械产物：`docs/analysis/ac69-slot-release-vs-dispatch-gap.json`（结构化记录）+ `plugin/scripts/ac69-slot-queue-gap-check.ts`（检查器：缺席 ⇒ exit 2 / 损坏 ⇒ exit 3，与合格 exit 0 区分——硬规则 3b）+ fixture 测试 + mutation case。
- `--for-task` scoped 门绿；既有测试全绿。
