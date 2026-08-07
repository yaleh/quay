---
id: gap-dod-two-green-runs-and-over90-budget-are-mathematically-incompatible
title: "DoD's 'two consecutive green suites' and OVER90's 90-minute budget are
  mathematically incompatible at the current concurrency — one suite measured
  37.5min (2248421ms, 20:48:01-21:25:29), so DoD alone consumes 74.9min = 83% of
  the 90-minute budget, leaving <16min for the actual work; observer-registry
  (106min) and manager-layer (102min) both crossed 90 on 2026-08-07 and neither
  was stuck — crossing is STRUCTURAL for any task that runs its DoD, not a
  property of the task; the 90-minute budget was calibrated when a suite took
  7-15min (SPEC-suite-speed 2026-08-03: 402.9-896.6s, 6 serial suites = 42-90min)
  and was never re-verified after the concurrency default became effective at 1
  on 2026-08-06 14:21 (e846cedd); same 6 serial suites now cost 3.7 hours"
status: todo
labels:
  - gap
  - defect
  - milestone-candidate
parent: null
children: []
extra: {}
---

## Finding

**三个判据在当前并发下只能保两个,现在三个都在生效,所以每个跑 DoD 的任务结构上必然踩 OVER90。**

| 判据 | 当前值 | 出处 |
|---|---|---|
| 单次全量套件 | **37.5 分钟**(2248421ms) | 实测 20:48:01→21:25:29,`.quay/suite-state-events.jsonl` |
| DoD「连跑 2 次全绿」 | ⇒ **74.9 分钟** | 判据本身,`SPEC-suite-speed.md` 明写「闸不动」 |
| OVER90 预算 | **90 分钟** | `inner-blocked-signal.ts` `TASK_OVER_90M_MS` |

⇒ **DoD 单独就占预算 83%,留给实际工作 <16 分钟。**

## 这不是"慢",是结构性必然

2026-08-07 实测:`observer-registry` **106min**、`manager-layer` **102min** 双双越过 90,
**两者都经进程血统与 inner subagent 面板核实为真实执行中,不是卡死**。
⇒ **踩线与任务本身无关,是判据组合的必然产物。**

## 为什么现在才暴露

`SPEC-suite-speed.md`(2026-08-03)记的旧世界:单次 **402.9–896.6s(7–15 分钟)**、
每任务 6 次串行套件 **= 42–90 分钟**。**90 分钟预算正是在那个世界里校准的。**

而并发默认值 **2026-08-06 14:21(`e846cedd`)** 才真正从长期实际生效的硬编码 8
降到推导值 1(4 核 ⇒ `max(1,floor(4/2.1))=1`)——**8 倍并行度损失**。
同样 6 次串行套件现在 **= 3.7 小时**。

⇒ **并发回退是刻意裁定(「make reality catch up to claims」,避免 4.25 倍超订),
本任务不主张回退它**;真正的缺口是**所有在旧并发下校准的下游常数从未随之重新核实**。

## 性质

**不是任何单一机制的 bug**——DoD、OVER90、并发推导三者各自都是"对"的。
是**三个判据的乘积在当前参数下不自洽**,而没有任何一处做过这个乘法。

## 需要的是一个数字裁定,不是新机制

90 分钟预算 / DoD 连跑 2 次 / 并发 1 —— **三者只能保两个**。松哪个属于**改判据**,
按管理者边界 §1.5 归人裁定;本任务负责把算式与实测摆清,不预设答案。

## AC（draft）

- [ ] AC1: 把上表三个数在**当前实测值**下重算一遍并贴出(不用本文件的历史数字)
- [ ] AC2: 给出被选中的裁定及其代价——**明写放弃了什么**(如放宽 OVER90 ⇒ 真卡死的检出延迟变长)
- [ ] AC3: **负控制**——按裁定后的参数,构造一个跑满 DoD 的任务,**不得踩 OVER90**
- [ ] AC4: 建立一条机械检查:任一常数变更后,**乘积关系被重新核实**(防同类复发)

## DoD（draft）

- [ ] AC1-AC4 实跑输出贴进任务体
- [ ] 完整套件绿

## Touches
- tasks/gap-dod-two-green-runs-and-over90-budget-are-mathematically-incompatible.md
- plugin/scripts/inner-blocked-signal.ts（OVER90 预算常数）
- orchestration/SPEC-suite-speed.md（历史基线，交叉标注）

## Evidence
- 单次套件 2248421ms 实测（`.quay/suite-state-events.jsonl`，SUITE-GREEN 20:48:01→21:25:29）
- observer-registry 106min / manager-layer 102min 越线且均 live（2026-08-07 02:01Z manager 实测）
- SPEC-suite-speed.md:16,19 旧基线 402.9–896.6s / 6 次串行 42–90 分钟
- e846cedd 2026-08-06 14:21 并发推导真正生效
