---
id: gap-meta-buildprobeprompt
title: meta-driver readings carrier exceeds the probe's 256KB Read cap — the
  documented lazy-read path fails every round
status: ready
labels:
  - meta-driver
  - driver-candidate
parent: null
children: []
extra: {}
---
## Finding
buildProbePrompt persists the full readings JSON to .quay/meta-driver-readings.json and tells the probe 'Read that file', but the carrier is larger than the Read tool's 256KB cap, so the one documented way for the semantic half to obtain readings is mechanically unreadable on the very rounds that need numbers (follow-on defect of the done task that moved readings off the prompt).

本轮读数（actionRecordFailures.state）= `"crossed"`，采于 2026-11-06T20:53:59Z，由 meta-driver 机械采集。
⚠️ 机制词 `buildProbePrompt` 命中【已完成】任务：gap-goal-sufficiency-insufficient-has-no-followup-signal.md[done]、gap-meta-addressedtasks-input-truncates-body-only-title-reaches-probe.md[superseded]、gap-meta-driver-probe-readings-inline-over-1mb.md[done]、gap-prompt-inline-data-scan.md[done]——问题仍在而任务已 done ⇒ 先查那些任务为何没解决它，⛔ 不要在它们旁边新造一个并行机制。

## AC（draft）
- [x] `node --experimental-strip-types --input-type=module -e "import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'; const { buildProbePrompt } = await import('./plugin/scripts/meta-driver.ts'); const criteria = Array.from({length:1200},(_,i)=>({id:'AC-'+i,title:'SENTINEL-READINGS-MARKER',goal:'GOAL-000',status:'achieved',criterion:'true',verdict:'pass',reason:'x'.repeat(600),cause:null,supersedes:[],supersededBy:[]})); const readings = {goals:[{id:'GOAL-000',title:'t',status:'active'}],criteria,divergences:[],drivers:[],syncHealth:{lastEvent:'none',lastDocToDevelop:'ok'},metaRecords:[],inertCheckers:[],timeSeries:[],actionRecordFailures:{state:'none',aggregates:[]},parking:{},focus:null}; const root = fs.mkdtempSync(path.join(os.tmpdir(),'mdr-')); const prompt = buildProbePrompt('objective', readings, {root}); const named = [...new Set(prompt.split(/\\s+/).map(t=>t.replace(/[,;]+$/,'')).filter(t=>t.startsWith('/')))].filter(p=>{try{return fs.statSync(p).isFile()}catch{return false}}); if(named.length < 1){console.error('prompt names no readable readings file');process.exit(1)} if(named.map(p=>fs.readFileSync(p,'utf8')).join('\n').indexOf('SENTINEL-READINGS-MARKER') < 0){console.error('named files do not carry the readings content');process.exit(1)} const over = named.filter(p=>fs.statSync(p).size >= 262144); if(over.length > 0){console.error('prompt names readings file(s) over the 256KB Read cap: '+over.map(p=>p+' '+fs.statSync(p).size).join(', '));process.exit(1)} console.log(JSON.stringify({namedFiles:named.length}));"` ⇒ For a readings payload of realistic size, every file the prompt tells the probe to read exists, each is under the Read tool's 256KB cap, and together they still carry the full readings content — exit 0. Today it exits 1 because the single named carrier is over the cap.

## DoD（draft）
- [x] 上面的判据实跑通过，且判据本身能取假（改坏实现时会红）
- [x] 若结论是「已有机制在管、只是失败」，则修那个机制，⛔ 不新建并行机制

## Evidence
- 判据实跑（工作树 `/home/yale/work/quay-worktrees/gap-meta-buildprobeprompt`，2026-11-07，含 suite-red 修复后的当前 HEAD）：`{"namedFiles":11}`，exit 0 —— 11 个被点名文件 = manifest 3,322 B + 10 个 part（最大 114,419 B），逐个 statSync 实测全部 < 262,144 B，合起来带 `SENTINEL-READINGS-MARKER`。
- 生产读数实跑：现行 `.quay/meta-driver-readings.json` = **753,799 B**（> Read 上限，缺陷复现）⇒ 同一份 readings 切成 **6 个 part**（最大 116,339 B）+ manifest 2,434 B；按 part 文件自带的 `note` 语义重建后 `isDeepStrictEqual(重建, 原 readings) === true`（⛔ 不是靠丢字段把文件变小）。
- 负控（判据能取假，`plugin/test/meta-driver.test.mjs`）：同一夹具下单文件 ≥ 256KB 被断言为真；把 prompt 指回单文件 ⇒ 同一条「超限」谓词命中 1 个 ⇒ 证明该臂可红；修复后的真实 prompt 不再点名该单文件。
- 边界用例：300KB 单个超长字符串字段按字符切、逐字可还原；上一轮多出来的 part 不残留（整目录重建）；小读数仍是一条完整值切片（⛔ 不无谓切碎）。
- **suite-red 修复（上一轮 exited-not-landed 的真因）**：`reshardTighter` 曾内联第 13 份 escape body，被 `packages/quay/test/kernel-regex-escape.test.mjs` ①（byte-identical body 只许一处）/④（family 判定）判红——red 面确由本任务引入，非环境。改为复用文件里**已存在**的 `./regex-escape.ts` 导入后：kernel-regex-escape 6/6 pass、`plugin/test/meta-driver.test.mjs` 181/181 pass、`packages/quay/test/build-plugin-dist.test.mjs` 45/45 pass。
- `bash scripts/test.sh --for-task gap-meta-buildprobeprompt --allow-thin` = exit 0（本轮重跑见下）；`plugin/test/meta-driver.test.mjs` 181/181 pass。
- 机制归属（DoD 第 2 条）：修的是**同一个**落盘点 `buildProbePrompt`（它的落盘载体从「一个超限单文件」变成「manifest + 预算内切片」，单文件仍写出供 jq/node/cat 这类不吃 Read 上限的消费者用）；⛔ 未新建第二个 prompt 组装点、未新建并行读数采集机制。

## Touches
- `plugin/scripts/meta-driver.ts`
- `plugin/test/meta-driver.test.mjs`
- `plugin/probes/meta-driver.md`
- `.gitignore`
- `tasks/gap-meta-buildprobeprompt.md`

## ADR-007 暗轴（L_D）
- L_D import-graph-check: valueSccs=0 typeSccs=0 reverseEdges=0 files=562 edges=1741
