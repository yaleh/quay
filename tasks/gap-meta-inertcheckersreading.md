---
id: gap-meta-inertcheckersreading
title: Inert-guard reading cannot distinguish an in-flight suite from a dropped
  notEvaluatedCheckers dimension
status: ready
labels:
  - meta-driver
  - driver-candidate
parent: null
children: []
extra: {}
---
## Finding
full-suite-runner writes the carrier with state:'running' and no notEvaluatedCheckers field (full-suite-runner.ts:3608), while collectInertCheckers maps ANY missing field to cause:'dimension-missing' (meta-driver.ts:1893-1897). That is the exact value three landed tasks (gap-meta-extractnotevaluatedchecker / gap-meta-parsenotevaluatedcheckers / gap-not-evaluated-checkers-never-persisted) built to flag a mirror that DROPS the field — so a transient in-flight suite and a regressed mirror render identically, and this round's dark inert-guard dimension cannot be attributed to either.

本轮读数（inertCheckers.evaluated）= `false`，采于 2026-11-07T04:22:28Z，由 meta-driver 机械采集。
涉及机制关键词：`InertCheckersReading`（立案前已搜既有任务，无人认领）。

## AC（draft）
- [ ] `node --experimental-strip-types --input-type=module -e "import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {collectInertCheckers} from './plugin/scripts/meta-driver.ts';const mk=(o)=>{const d=fs.mkdtempSync(path.join(os.tmpdir(),'ic-'));fs.mkdirSync(path.join(d,'.quay'),{recursive:true});fs.writeFileSync(path.join(d,'.quay','full-suite-state.json'),JSON.stringify(o));return d};const a=collectInertCheckers(mk({state:'running'}));const b=collectInertCheckers(mk({state:'green'}));const c=collectInertCheckers(mk({state:'green',notEvaluatedCheckers:[]}));if(a.evaluated!==false){console.error('running carrier wrongly reported as measured');process.exit(1)}if(b.cause!=='dimension-missing'){console.error('finished carrier without the field lost its dimension-missing cause: '+JSON.stringify(b));process.exit(1)}if(a.cause===b.cause){console.error('suite-running and dropped-dimension share one cause: '+JSON.stringify(a));process.exit(1)}if(c.evaluated!==true||c.cause!==null){console.error('measured carrier not recognised: '+JSON.stringify(c));process.exit(1)}console.log(JSON.stringify({running:a.cause,missing:b.cause}))"` ⇒ A carrier with state:'running' and no field reports a cause distinct from 'dimension-missing'; a FINISHED carrier with no field still reports 'dimension-missing'; a carrier carrying the field (even []) reports evaluated:true — so a dark inert-guard round is attributable to 'suite in flight' rather than silently colliding with a landed-fix regression.

## DoD（draft）
- [ ] 上面的判据实跑通过，且判据本身能取假（改坏实现时会红）
- [ ] 若结论是「已有机制在管、只是失败」，则修那个机制，⛔ 不新建并行机制

## Touches
- `plugin/scripts/meta-driver.ts`
- `plugin/test/meta-driver.test.mjs`
- `tasks/gap-meta-inertcheckersreading.md`