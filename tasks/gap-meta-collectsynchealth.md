---
id: gap-meta-collectsynchealth
title: syncHealth 暴露 notFf 的 benign 分解（ahead-only vs behind）
status: done
labels:
  - meta-driver
  - driver-candidate
parent: null
children: []
extra: {}
---
## Finding
syncHealth.notFf=108 在 window=200 中占主导，但 collectSyncHealth 不读事件的 benign 字段，meta-driver 无法区分良性 ahead-only 与真分叉（behind>0）

本轮读数（syncHealth.notFf）= `108`，采于 2026-09-07T09:23:23Z，由 meta-driver 机械采集。
涉及机制关键词：`collectSyncHealth`（立案前已搜既有任务，无人认领）。

## AC（draft）
- [x] `node --experimental-strip-types --input-type=module -e 'import {collectSyncHealth} from "./plugin/scripts/meta-driver.ts"; import fs from "node:fs"; import os from "node:os"; import path from "node:path"; const d=fs.mkdtempSync(path.join(os.tmpdir(),"sh-")); fs.mkdirSync(path.join(d,".quay")); fs.writeFileSync(path.join(d,".quay","doc-develop-sync.jsonl"), JSON.stringify({event:"doc-develop-sync-not-ff",ts:"2026-09-07T00:00:00Z",benign:true})); const h=collectSyncHealth(d); process.exit((("notFfBenign" in h)||("notFfAhead" in h)||("notFfBehind" in h))?0:1);'` ⇒ 带 benign:true 的 not-ff 事件经 collectSyncHealth 后能返回 benign/ahead/behind 分解键

## DoD（draft）
- [x] 上面的判据实跑通过，且判据本身能取假（改坏实现时会红）
- [x] 若结论是「已有机制在管、只是失败」，则修那个机制，⛔ 不新建并行机制

## Touches
- `plugin/scripts/meta-driver.ts`
- `tasks/gap-meta-collectsynchealth.md`