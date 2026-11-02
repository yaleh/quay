---
id: gap-meta-collectactionrecordfailures
title: Activate the action-record failure aggregation reading (min_sessions +
  scan_ttl)
status: done
labels:
  - meta-driver
  - driver-candidate
parent: null
children: []
extra: {}
---
## Finding
Reading actionRecordFailures.state is unthresholded and thresholdSessions is null, and its scan has not refreshed since 2026-09-12: the seventh meta-driver reading was shipped by a now-done task but .quay/config.yml has no action_record_failures section, so minSessions and scanTtlMs are both null and the instrument can never emit crossed/none.

本轮读数（actionRecordFailures.state）= `"unthresholded"`，采于 2026-11-02T20:17:14Z，由 meta-driver 机械采集。
涉及机制关键词：`collectActionRecordFailures`（立案前已搜既有任务，无人认领）。

## AC（draft）
- [x] `node --experimental-strip-types -e 'import("./plugin/scripts/meta-driver.ts").then(m=>{const c=m.readActionRecordConfig(process.cwd());if(c.minSessions===null||c.scanTtlMs===null){console.error("action_record_failures unactivated: "+JSON.stringify(c));process.exit(1)}console.log("activated: "+JSON.stringify(c))}).catch(e=>{console.error(String(e));process.exit(1)})'` ⇒ The main checkout .quay/config.yml gains action_record_failures.min_sessions (>=1) and scan_ttl, so readActionRecordConfig reports both non-null and the production reading leaves the unthresholded state.

## DoD（draft）
- [x] 上面的判据实跑通过，且判据本身能取假（改坏实现时会红）
- [x] 若结论是「已有机制在管、只是失败」，则修那个机制，⛔ 不新建并行机制

## ADR-007 暗轴记录
- L_G 该轴仍暗,理由:本任务零代码改动（仅 .quay/config.yml 运行时配置 + 任务文件），无依赖/结构面可测

## Evidence

AC 判据实跑（主检出，`process.cwd()` = `/data/home/yale/work/quay`）——RC=0：

```
activated: {"minSessions":2,"windowMs":null,"scanTtlMs":86400000,"scanTimeoutMs":600000}
```

负控制（临时目录，config 无该段）——RC=1，判据能取假：

```
action_record_failures unactivated: {"minSessions":null,"windowMs":null,"scanTtlMs":null,"scanTimeoutMs":null}
```

生产读数（读既有载体、`allowScan:false` 不重扫）——`state` 已离开 `unthresholded`：

```
{"state":"crossed","thresholdSessions":2,"recordsScanned":3636,"aggCount":2617,"top":{"signature":"Exit code <n>","sessions":91,"crossed":true}}
```

修复形态：机制（`readActionRecordConfig`/`collectActionRecordFailures`）已存在，缺的只是 `.quay/config.yml` 的 `action_record_failures` 段；本任务只激活该段（`min_sessions: 2` / `scan_ttl: 24h` / `scan_timeout: 10m`），⛔ 未新建并行机制。

## Touches
- `.quay/config.yml`
- `tasks/gap-meta-collectactionrecordfailures.md`