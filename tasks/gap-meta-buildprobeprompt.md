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
- [ ] `node --experimental-strip-types --input-type=module -e "import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'; const { buildProbePrompt } = await import('./plugin/scripts/meta-driver.ts'); const criteria = Array.from({length:1200},(_,i)=>({id:'AC-'+i,title:'SENTINEL-READINGS-MARKER',goal:'GOAL-000',status:'achieved',criterion:'true',verdict:'pass',reason:'x'.repeat(600),cause:null,supersedes:[],supersededBy:[]})); const readings = {goals:[{id:'GOAL-000',title:'t',status:'active'}],criteria,divergences:[],drivers:[],syncHealth:{lastEvent:'none',lastDocToDevelop:'ok'},metaRecords:[],inertCheckers:[],timeSeries:[],actionRecordFailures:{state:'none',aggregates:[]},parking:{},focus:null}; const root = fs.mkdtempSync(path.join(os.tmpdir(),'mdr-')); const prompt = buildProbePrompt('objective', readings, {root}); const named = [...new Set(prompt.split(/\\s+/).map(t=>t.replace(/[,;]+$/,'')).filter(t=>t.startsWith('/')))].filter(p=>{try{return fs.statSync(p).isFile()}catch{return false}}); if(named.length < 1){console.error('prompt names no readable readings file');process.exit(1)} if(named.map(p=>fs.readFileSync(p,'utf8')).join('\n').indexOf('SENTINEL-READINGS-MARKER') < 0){console.error('named files do not carry the readings content');process.exit(1)} const over = named.filter(p=>fs.statSync(p).size >= 262144); if(over.length > 0){console.error('prompt names readings file(s) over the 256KB Read cap: '+over.map(p=>p+' '+fs.statSync(p).size).join(', '));process.exit(1)} console.log(JSON.stringify({namedFiles:named.length}));"` ⇒ For a readings payload of realistic size, every file the prompt tells the probe to read exists, each is under the Read tool's 256KB cap, and together they still carry the full readings content — exit 0. Today it exits 1 because the single named carrier is over the cap.

## DoD（draft）
- [ ] 上面的判据实跑通过，且判据本身能取假（改坏实现时会红）
- [ ] 若结论是「已有机制在管、只是失败」，则修那个机制，⛔ 不新建并行机制

## Touches
- `plugin/scripts/meta-driver.ts`
- `plugin/test/meta-driver.test.mjs`
- `plugin/probes/meta-driver.md`
- `tasks/gap-meta-buildprobeprompt.md`