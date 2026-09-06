---
id: gap-meta-carrierstats
title: quality 载体时间戳键 judgedAt 不被 carrierStats 读取——meta-driver 对 quality 的
  staleSecs 恒 null
status: todo
labels:
  - meta-driver
  - driver-candidate
parent: null
children: []
extra: {}
---
## Finding
carrierStats 只读记录 j.ts，而 quality-round.jsonl 轮记录用 judgedAt 作时间戳键 ⇒ quality 有 15 条记录却 carrierLastTs=null、staleSecs=null，quality driver 停摆与健康同形（缺值被伪装成未查）

本轮读数（drivers.quality.carrierLastTs）= `null`，采于 2026-09-06T22:38:43Z，由 meta-driver 机械采集。
涉及机制关键词：`carrierStats`（立案前已搜既有任务，无人认领）。

## AC（draft）
- [ ] `node --experimental-strip-types -e 'import("./plugin/scripts/driver-runtime.ts").then(m=>{const s=m.carrierStats(process.cwd(),"quality");const ok=!!s.lastTs&&!Number.isNaN(Date.parse(s.lastTs));console.log(JSON.stringify({records:s.records,lastTs:s.lastTs}));process.exit(ok?0:1)})'` ⇒ carrierStats(root,'quality').lastTs 返回可解析的 ISO 时间戳（quality 停摆可被观测到）

## DoD（draft）
- [ ] 上面的判据实跑通过，且判据本身能取假（改坏实现时会红）
- [ ] 若结论是「已有机制在管、只是失败」，则修那个机制，⛔ 不新建并行机制

## Touches
- `plugin/scripts/driver-runtime.ts`
- `plugin/scripts/quality-gate-driver.ts`
- `tasks/gap-meta-carrierstats.md`