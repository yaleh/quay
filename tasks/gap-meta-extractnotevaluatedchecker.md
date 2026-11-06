---
id: gap-meta-extractnotevaluatedchecker
title: 机械 fan-in 的镜像 state 丢掉 notEvaluatedCheckers，meta-driver 的惰性守卫读数因此在生产上恒为 []
status: done
labels:
  - meta-driver
  - driver-candidate
parent: null
children: []
extra: {}
---
## Finding
full-suite-state.json 有两个写者而形状不同：full-suite-runner 的终态写「总是」带 notEvaluatedCheckers（本轮的载体 .quay/full-suite-state.json 正是 mirrorMechanicalFanInSuiteState 写的机械 fan-in 记录——runId mfi-gap-meta-buildprobeprompt-…、finishedAt 是 epoch、runner/scope 恰为镜像写死的 inner/worktree——它没有该字段），而 collectInertCheckers 对「字段缺失」和「空数组」都返回 []，这与它自己文档里写明的契约（empty array 必须与 missing dimension 可区分）相反；更糟的是镜像写在 on-disk 是终态时不被 shouldSkipMirrorWrite 挡住，会把 runner 已经测过的完整载体覆盖成缺维度的载体 ⇒ 本轮 readings.inertCheckers=[] 是「未测量」，不是「没有惰性守卫」。

本轮读数（inertCheckers）= `[]`，采于 2026-11-06T22:08:36Z，由 meta-driver 机械采集。
涉及机制关键词：`extractNotEvaluatedChecker`（立案前已搜既有任务，无人认领）。

## AC
- [x] `cd "$(git rev-parse --show-toplevel)" && node --experimental-strip-types --input-type=module -e 'import fs from "node:fs"; import os from "node:os"; import path from "node:path"; import { collectInertCheckers } from "./plugin/scripts/meta-driver.ts"; import { buildMirrorState } from "./plugin/scripts/mirror-full-suite-state.ts"; const real = JSON.parse(fs.readFileSync(".quay/full-suite-state.json","utf8")); const r = collectInertCheckers("."); if (!r || typeof r !== "object" || typeof r.evaluated !== "boolean" || !Array.isArray(r.names)) { console.error("collapsed reading on the real carrier: "+JSON.stringify(r)); process.exit(1); } if (!Array.isArray(real.notEvaluatedCheckers) && r.evaluated !== false) { console.error("carrier has no notEvaluatedCheckers yet the reading claims a measured verdict"); process.exit(1); } const tmp = fs.mkdtempSync(path.join(os.tmpdir(),"inert-ctl-")); fs.mkdirSync(path.join(tmp,".quay"),{recursive:true}); const f = path.join(tmp,".quay","full-suite-state.json"); fs.writeFileSync(f, JSON.stringify({state:"green",notEvaluatedCheckers:[]})); const empty = collectInertCheckers(tmp); if (!empty || empty.evaluated !== true || empty.names.length !== 0) { console.error("measured-zero control broken: "+JSON.stringify(empty)); process.exit(1); } fs.writeFileSync(f, JSON.stringify({state:"green",notEvaluatedCheckers:[{name:"direct-to-develop-bypass-check"}]})); const named = collectInertCheckers(tmp); if (!named || named.evaluated !== true || !named.names.includes("direct-to-develop-bypass-check")) { console.error("named control lost the checker: "+JSON.stringify(named)); process.exit(1); } const m = buildMirrorState({state:"green",startedAt:"2026-01-01T00:00:00.000Z",durationMs:1,laneCount:1,commit:"a".repeat(40),notEvaluatedCheckers:[]}); if (!m || !m.state || !Array.isArray(m.state.notEvaluatedCheckers)) { console.error("mirror state drops notEvaluatedCheckers: "+JSON.stringify(m)); process.exit(1); } console.log(JSON.stringify({realCarrierHasField:Array.isArray(real.notEvaluatedCheckers),reading:r}));'` ⇒ collectInertCheckers 返回三态 {evaluated,names,cause}：载体没有 notEvaluatedCheckers ⇒ evaluated:false（⛔ 不是 []），空数组 ⇒ evaluated:true/names:[]，具名惰性守卫 ⇒ 逐名列出；且 buildMirrorState 能携带该字段（生产接线：由 worker-fan-in.ts 的 mirrorMechanicalFanInSuiteState 用既有的 extractNotEvaluatedChecker 解析本轮 suite 抓取后传入），使机械 fan-in 路径的载体不再缺这一维。

## DoD
- [x] 上面的判据实跑通过，且判据本身能取假（改坏实现时会红）
- [x] 若结论是「已有机制在管、只是失败」，则修那个机制，⛔ 不新建并行机制

## Touches
- `plugin/scripts/meta-driver.ts`
- `plugin/scripts/mirror-full-suite-state.ts`
- `plugin/scripts/worker-fan-in.ts`
- `plugin/probes/meta-driver.md`
- `plugin/test/meta-driver.test.mjs`
- `plugin/test/mirror-full-suite-state.test.mjs`
- `plugin/test/worker-driver.test.mjs`
- `tasks/gap-meta-extractnotevaluatedchecker.md`

## ADR-007 暗轴记录
该轴仍暗,理由:本 delta 只把既有写者/读者的一维读数补成三态并接通同一条写路径，未新增模块、包或依赖边，L_D/L_G 结构面无变化，故未另取 archguard 读数。

## 验证记录（2026-11-07）
- 判据（AC 那条命令）实跑：`{"realCarrierHasField":false,"reading":{"evaluated":false,"names":[],"cause":"dimension-missing"}}`，exit 0。
- 负控制：把 dimension-missing 分支改回 `evaluated:true`（即缺陷形态）后判据 exit 1，打印 `carrier has no notEvaluatedCheckers yet the reading claims a measured verdict`；改回后复绿。
- 单测：`plugin/test/meta-driver.test.mjs` 181/181、`plugin/test/mirror-full-suite-state.test.mjs` 8/8、`plugin/test/worker-driver.test.mjs` 的 D7 + 新增镜像维度用例通过。
- 生产接线：`mirrorMechanicalFanInSuiteState` 现在从**被记录那一轮**（认证的恢复轮优先，其次原轮）的 suite 日志用 `extractNotEvaluatedChecker` 逐行解析；日志读不出 ⇒ 字段缺席（未测量），且**不覆盖**一个已带该维的载体（镜像 write 的 `shouldSkipMirrorWrite` 之外的第二条保守闸）。
