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

## AC（draft）
- [ ] `node --no-warnings --experimental-strip-types --test plugin/test/meta-driver.test.mjs && node -e "const fs=require('fs');const r=JSON.parse(fs.readFileSync('.quay/meta-driver-readings.json','utf8'));const p=fs.readFileSync('plugin/probes/meta-driver.md','utf8');const miss=Object.keys(r).filter(k=>!p.includes(k));if(miss.length){console.error('undeclared readings keys: '+miss.join(','));process.exit(1)}console.log('all '+Object.keys(r).length+' readings keys declared')"` ⇒ 本仓真实 readings 的每一个顶层键都在 `plugin/probes/meta-driver.md` 里被具名、给出含义与处置口径（parking 的处置 = unpark-passed 的 id 路由到人/manager，⛔ 机件不自行删标记），且 `plugin/test/meta-driver.test.mjs` 含一条负控（少声明一个键必须判红）；此条今日为红（缺上述四个键）。

## DoD（draft）
- [ ] 上面的判据实跑通过，且判据本身能取假（改坏实现时会红）
- [ ] 若结论是「已有机制在管、只是失败」，则修那个机制，⛔ 不新建并行机制

## Touches
- `plugin/probes/meta-driver.md`
- `plugin/scripts/meta-driver.ts`
- `plugin/test/meta-driver.test.mjs`
- `plugin/shipped-set-baseline.json`
- `tasks/gap-meta-readingsdigestpartsforparking.md`