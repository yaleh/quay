---
id: gap-meta-collectactionrecordfailures-2
title: collectActionRecordFailures 刷新失败时静默服务 52 天旧载体（reason=null）
status: done
labels:
  - meta-driver
  - driver-candidate
parent: null
children: []
extra: {}
---
## Finding
actionRecordFailures 读数 scannedAt=2026-09-12（52 天前，config scan_ttl=24h）却 state=crossed 且 reason=null：刷新失败（meta-cc CLI 二进制不在 locateMetaCcMcp 任一路径）时静默回退旧载体，与新鲜读数同形（硬规则 3b），且 digest 只取 crossed 签名、对过期盲视。

本轮读数（actionRecordFailures.scannedAt）= `"2026-09-12T01:40:29.297Z"`，采于 2026-11-02T21:59:56Z，由 meta-driver 机械采集。
⚠️ 机制词 `collectActionRecordFailures` 命中【已完成】任务：gap-meta-collectactionrecordfailures.md[done]——问题仍在而任务已 done ⇒ 先查那些任务为何没解决它，⛔ 不要在它们旁边新造一个并行机制。

## AC（draft）
- [x] `node --experimental-strip-types --input-type=module -e "import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'; import { collectActionRecordFailures, ACTION_RECORD_SCAN_REL } from './plugin/scripts/meta-driver.ts'; const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'afr-stale-')); fs.mkdirSync(path.join(tmp, '.quay'), { recursive: true }); fs.writeFileSync(path.join(tmp, ACTION_RECORD_SCAN_REL), JSON.stringify({ scannedAt: new Date(Date.now() - 7*86400000).toISOString(), scanMs: 1, since: null, records: [{ sessionId: 's1', signature: 'x', example: 'x', ts: null }, { sessionId: 's2', signature: 'x', example: 'x', ts: null }] })); const r = await collectActionRecordFailures(tmp, { cfg: { minSessions: 2, windowMs: null, scanTtlMs: 3600000, scanTimeoutMs: null }, binary: null }); fs.rmSync(tmp, { recursive: true, force: true }); if (r.reason == null) { console.error('stale fallback silent: reason null'); process.exit(1); } console.log('reason surfaced:', r.reason);"` ⇒ 刷新失败并回退旧载体时读数 reason 非空并命名扫描失败，使 stale-served 与 fresh 读数可区分。

## DoD（draft）
- [x] 上面的判据实跑通过，且判据本身能取假（改坏实现时会红）
- [x] 若结论是「已有机制在管、只是失败」，则修那个机制，⛔ 不新建并行机制

## ADR-007 暗轴记录
- L_G 该轴仍暗,理由:本任务对 meta-driver 聚合路径做 reason 传播的局部逻辑修复，无新增 import/依赖/模块边界，L_D/L_G 结构面无可测增量

## Evidence
结论：已有机制 `collectActionRecordFailures` 在管、只是失败（刷新失败时静默回退旧载体），修该机制，⛔ 未新建并行机制（DoD 第 2 条）。上一任务 gap-meta-collectactionrecordfailures 只激活了 `.quay/config.yml` 的 `action_record_failures` 段，未触及刷新失败路径，故问题仍在。

修复：`collectActionRecordFailures` 在「扫描失败但有旧载体」分支把扫描失败原因经 `aggregateActionFailures` 的 `reason` 字段传出（`aggregateActionFailures` 成功路径此前硬编码 `reason: null`，改为 `opts.reason ?? null`）。

AC 判据实跑（worktree，EXIT=0）：

```
reason surfaced: scan-failed: meta-cc-mcp not found (set QUAY_META_CC_MCP or install meta-cc) (served stale carrier scannedAt=2026-10-26T22:09:55.159Z)
```

负控制（把 `reason: staleReason` 临时改回 `reason: null` 再跑同一判据）——EXIT=1，判据能取假：

```
stale fallback silent: reason null
```

测试：`node --test plugin/test/meta-driver.test.mjs` 145 pass / 0 fail（含新增断言：stale fallback 的 reason 非空且以 `scan-failed` 开头）。

## Touches
- `plugin/scripts/meta-driver.ts`
- `plugin/test/meta-driver.test.mjs`
- `tasks/gap-meta-collectactionrecordfailures-2.md`