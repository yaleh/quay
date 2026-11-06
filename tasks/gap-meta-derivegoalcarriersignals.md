---
id: gap-meta-derivegoalcarriersignals
title: goal-round streak 信号必须跨「被中止的一轮」继续可评估
status: done
labels:
  - meta-driver
  - driver-candidate
parent: null
children: []
extra: {}
---
## Finding
deriveGoalCarrierSignals 把不带 criteria 读数的 stopped-mid-round 轮记成 null：该 null 既让尾值缺失（整份 timeSeries 全部 evaluated:false），又打断 unchangedStreak，于是「连续 8 轮 verdict 不变」与「spawn 了却零产出」两个安全网在任一被中止轮附近都量不出来——而 goal-round 载体最近的轮里 stopped-mid-round 记录是常态。

本轮读数（timeSeries.0.evaluated）= `false`，采于 2026-11-06T15:10:19Z，由 meta-driver 机械采集。
涉及机制关键词：`deriveGoalCarrierSignals`（立案前已搜既有任务，无人认领）。

生产实测复核（2026-11-07，`.quay/goal-round.jsonl` 全量 20625 轮）：其中 73 轮的 goal-ring fact 是 `abandonedMidRoundFact` 形状（`stopped_mid_round:true / observed:false`），最近 40 轮里占 7 轮，**最后一条就是**——旧实现在这个窗口上对前 3 个 AC 派生出的 6 条信号全部 `evaluated:false`。

## Acceptance Criteria
- [x] `node --experimental-strip-types --input-type=module -e "import {deriveGoalCarrierSignals as d} from './plugin/scripts/meta-driver.ts'; const ok={facts:[{name:'goal-ring',value:{criteria:[{id:'AC-1',verdict:'fail'}],gaps:[],gap_spawns:[]}}]}; const ab={stopped_mid_round:true,facts:[{name:'goal-ring',value:{stopped_mid_round:true,observed:false,grace_ms:5000}}]}; const v=d([ok,ok,ab],['AC-1']).find(x=>x.key==='goal:AC-1:verdict'); if(!v||v.evaluated!==true||v.count<2){console.error('signal',JSON.stringify(v));process.exit(1)} console.log(JSON.stringify(v));"` ⇒ 尾轮是 stopped-mid-round 记录时，信号仍由最近带 criteria 读数的轮派生（evaluated:true 且 count≥2），被跳过的轮以独立字段可见而不是把一个 null 伪装成「无历史」——今天该命令以 {"evaluated":false,"count":0} 退出 1，故它可被改坏、也可被改好。
  - 实跑（工作树 `gap-meta-derivegoalcarriersignals`）：改前 `signal {"key":"goal:AC-1:verdict","mode":"unchanged","count":0,"crossed":false,"evaluated":false,"threshold":8,"value":null}` / `EXIT=1`；改后 `{"key":"goal:AC-1:verdict","mode":"unchanged","count":2,"crossed":false,"evaluated":true,"threshold":8,"skippedAbortedRounds":1,"value":"fail"}` / `EXIT=0`。
  - 反向控制：把派生层那句 `if (goalRingRoundAborted(round)) { skippedAbortedRounds++; continue; }` 改成 `if (false) …` 后同一条命令 `EXIT=1` ⇒ 判据能取假，不是恒真。（改回后工作树 `git status --porcelain` 为空。）

## Definition of Done
- [x] 上面的判据实跑通过，且判据本身能取假（改坏实现时会红）—— 正反两条实跑读数见上（`EXIT=0` / 关掉跳过 ⇒ `EXIT=1`）。
- [x] 若结论是「已有机制在管、只是失败」，则修那个机制，⛔ 不新建并行机制 —— 修的就是 `deriveGoalCarrierSignals` 本身（新增 `goalRingRoundAborted` 判定 + 派生层跳过），⛔ 没有新开一条并行的 streak 派生路径、没有新载体、没有新阈值。
- [x] ADR-007 暗轴记录（本改动只在一个纯函数体内，无 import 增删）：
  - L_D archguard detect-cycles (package granularity, scope b4f87b21): cycles=0, maxScc=1

## Touches
- `plugin/scripts/meta-driver.ts`
- `plugin/test/meta-driver.test.mjs`
- `tasks/gap-meta-derivegoalcarriersignals.md`
