---
id: gap-meta-readingsdigestpartsforparking
title: 语义半的读数契约缺了四个键：timeSeries / inertCheckers / actionRecordFailures / parking
  送到却无释义、无输出落点
status: ready
labels:
  - meta-driver
  - driver-candidate
parent: null
children: []
extra: {}
---
## Finding
`plugin/probes/meta-driver.md` 只声明了 readings 的一部分顶层键；`timeSeries` / `inertCheckers` / `actionRecordFailures` / `parking` 四个键每轮随 readings 一并送达语义半，却既无释义也无任何输出通道承接（同类缺陷 `gap-meta-addressedtasks-input-without-output-channel` 修过一次，兄弟实例原样留在同一文件里）。本轮后果是活的：`parking.parked.entries` 点名的两条 unpark-passed 任务（其宣告式解停检查已通过）无人处置，GOAL-914 的 end-to-end AC 仍被 PARKED 的 `gap-goal-driver-filing-ledger` 挡着。

本轮读数（parking.parked.reportedPassed）= `2`，采于 2026-11-06T16:17:48Z，由 meta-driver 机械采集。
涉及机制关键词：`readingsDigestPartsForParking`（立案前已搜既有任务，无人认领）。

## AC
- [x] `node --no-warnings --experimental-strip-types --test plugin/test/meta-driver.test.mjs && node -e "const fs=require('fs');const r=JSON.parse(fs.readFileSync('.quay/meta-driver-readings.json','utf8'));const p=fs.readFileSync('plugin/probes/meta-driver.md','utf8');const miss=Object.keys(r).filter(k=>!p.includes(k));if(miss.length){console.error('undeclared readings keys: '+miss.join(','));process.exit(1)}console.log('all '+Object.keys(r).length+' readings keys declared')"` ⇒ 本仓真实 readings 的每一个顶层键都在 `plugin/probes/meta-driver.md` 里被具名、给出含义与处置口径（parking 的处置 = unpark-passed 的 id 路由到人/manager，⛔ 机件不自行删标记），且 `plugin/test/meta-driver.test.mjs` 含一条负控（少声明一个键必须判红）；此条今日为红（缺上述四个键）。

## DoD
- [x] 上面的判据实跑通过，且判据本身能取假（改坏实现时会红）
- [x] 若结论是「已有机制在管、只是失败」，则修那个机制，⛔ 不新建并行机制

## 验收注记（2026-11-07 worker）

判据两条命令在 worktree 内**原样实跑**（⛔ 非转述）：

1. `node --no-warnings --experimental-strip-types --test plugin/test/meta-driver.test.mjs`
   ⇒ `tests 175 / pass 175 / fail 0`（新增 5 条：键覆盖、四键逐个负控、未评估态、释义+处置口径、薄块负控）。
2. 第二条命令（读生产 `.quay/meta-driver-readings.json` 与 probe 规格逐键比对）
   ⇒ `all 11 readings keys declared`，exit 0。

**判据能取假（实测）**：删掉 `parking` 的**整个声明块**并抹掉残留提及后，同一条命令 ⇒
`undeclared readings keys: parking`，**exit 1**。只删块不抹提及不够——`Unparking` 这类散文里的
同名子串会被 `includes` 满足，负控就永远取不到假（这一条也写进了测试的负控材料生成器）。

**键清单不是手写清单**：判据的键清单从 `MetaRoundReadings` 接口体按位置取出（`readingsTopLevelKeys`），
实测与生产 readings 的 11 个顶层键**集合完全相同**——所以「零缺声明」不是「清单没取全」造成的假绿。
读不出接口 / 规格为空 ⇒ 返回 `null`（未评估），⛔ 不与 `[]`＝「查过、全声明」同形。

**四个键各自补了什么**（每块都同时给释义与处置口径，⛔ 不是只出现一个键名）：
- `inertCheckers` — 惰性守卫是**坏掉的仪器**不是绿的守卫；点名是哪个、它让什么变成未测。`[]` 也可能来自
  载体读不到，⛔ 不得读成「所有守卫都跑过」。
- `timeSeries` — 唯一的跨轮派生层；`crossed` 才是「持续了」这个位，`evaluated:false` 是「无历史/读不出」
  （⛔ 不是 streak=0），`skippedAbortedRounds>0` 说明尾值不是最近一轮的。
- `actionRecordFailures` — 唯一读**会话语料**的读数；四态（crossed/none/unthresholded/not-evaluated）
  各自不同形，⛔ `not-evaluated` 不得当「零失败」。
- `parking` — 两臂三态；`unpark-passed` 的 id 连证据（command/expectedOutput/exitCode/output）一起路由到
  **人/manager**，⛔ 机件不自行删 `PARKED` 标记（这是人的宣告，不是 `autoDrive` 能做的事）。

**DoD-2**：没有新建并行机制——改的就是既有的 probe 规格（语义半的唯一输入契约）与其单测；
`collectReadings` / `readingsDigest` / 载体一概未动。

## ADR-007 暗轴记录
- 该轴仍暗,理由:本改动只增 probe 规格的声明段与单测断言，不新增/移动模块、不新增依赖边，L_D/L_G 无归因于本改动的读数。

## Touches
- `plugin/probes/meta-driver.md`
- `plugin/scripts/meta-driver.ts`
- `plugin/test/meta-driver.test.mjs`
- `plugin/shipped-set-baseline.json`
- `tasks/gap-meta-readingsdigestpartsforparking.md`
