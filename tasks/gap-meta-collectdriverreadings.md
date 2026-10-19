---
id: gap-meta-collectdriverreadings
title: meta driver 的载体读数把「读不了」静默折叠成 0 条，活驱动与从未跑过同形
status: ready
labels:
  - meta-driver
  - driver-candidate
parent: null
children: []
extra: {}
---
## Finding
drivers.meta 报 running=true，但同一读数的 carrierRecords=0、carrierLastTs=null、staleSecs=null；collectDriverReadings→carrierStats 用 readFileSync 整文件读载体，超过 V8 最大字符串长度时抛错被 per-file catch 静默折算为 0 条，于是「载体读不出」与「载体为空」输出同形（硬规则 3b）。

本轮读数（drivers.meta.carrierRecords）= `0`，采于 2026-10-19T12:52:33Z，由 meta-driver 机械采集。
涉及机制关键词：`collectDriverReadings`（立案前已搜既有任务，无人认领）。

## AC（draft）
- [x] `d=$(mktemp -d) && mkdir -p "$d/.quay" && printf '\n' > "$d/.quay/meta-driver-round.jsonl" && truncate -s 536874984 "$d/.quay/meta-driver-round.jsonl" && node --experimental-strip-types --input-type=module -e 'import { carrierStats } from "./plugin/scripts/driver-runtime.ts"; process.exit(carrierStats(process.argv[1], "meta").records > 0 ? 0 : 1);' "$d"; rc=$?; rm -rf "$d"; exit $rc` ⇒ 对一个超过 V8 字符串上限的稀疏载体，carrierStats 通过流式读取报出真实记录数（>0）而不是静默 0；若实现选择显式 NOT-EVALUATED 取值，同一判据须改为断言该状态可区分，但不得与 0 条同形。

## DoD（draft）
- [x] 上面的判据实跑通过，且判据本身能取假（改坏实现时会红）
- [x] 若结论是「已有机制在管、只是失败」，则修那个机制，⛔ 不新建并行机制

## Touches
- `plugin/scripts/driver-runtime.ts`
- `plugin/scripts/meta-driver.ts`
- `plugin/test/driver-runtime-s02.test.mjs`
- `plugin/test/meta-driver.test.mjs`
- `tasks/gap-meta-collectdriverreadings.md`