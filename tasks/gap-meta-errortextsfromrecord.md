---
id: gap-meta-errortextsfromrecord
title: "meta-driver action-record reading is a false clean: extractor drops
  meta-cc's `error_text` field"
status: done
labels:
  - meta-driver
  - driver-candidate
parent: null
children: []
extra: {}
---
## Finding
`actionRecordFailures.state` reads `none` with `recordsScanned: 0` after a 57s full-corpus scan, but the corpus does return errors: `errorTextsFromRecord()` in meta-driver.ts only accepts `message.content[].is_error===true` or a string `rec.error`, while meta-cc's `query_session_signals type=errors` returns records shaped `{category, error_text, session_id, timestamp, tool_name}`. Every record is silently skipped, so the whole cross-session-repeated-failure class reads as CLEAN (hard rule 3b's exact mirror: read the input, understood zero, reported 'checked and nothing found').

本轮读数（actionRecordFailures.state）= `"none"`，采于 2026-11-06T18:36:24Z，由 meta-driver 机械采集。
涉及机制关键词：`errorTextsFromRecord`（立案前已搜既有任务，无人认领）。

## Fix
修的是既有机制（`errorTextsFromRecord` 一支，⛔ 未新建并行提取器）：把候选承载点从「只有 `message.content[].is_error` + 裸 `error`」扩成**枚举**（`error_text` / `errorText` / `error` / `error_message` / `errorMessage`），保留原始 transcript 分支作为第二条路。同一载体里的兄弟实例已按硬规则 5b 查过：`error_text` 的生产消费点全仓只有这 1 处（`grep -rn "error_text" plugin/scripts packages` = 0 命中；`is_error` 的其余出现分属另外两个读数，与 meta-cc 交付形态无关）。

## Acceptance Criteria
- [x] `node --experimental-strip-types --input-type=module -e "import { extractActionFailureRecords, aggregateActionFailures } from './plugin/scripts/meta-driver.ts'; const payload={data:[{category:'bash_exit_code',error_text:'Exit code 1\nls: boom',session_id:'s1',timestamp:'2026-11-06T00:00:00Z',tool_name:'Bash'},{category:'bash_exit_code',error_text:'Exit code 1\nls: boom',session_id:'s2',timestamp:'2026-11-06T00:00:01Z',tool_name:'Bash'}]}; const recs=extractActionFailureRecords(payload); if(!recs||recs.length<2){console.error('extractor yielded '+JSON.stringify(recs)+' for a real meta-cc type=errors payload');process.exit(1)} const agg=aggregateActionFailures(recs,{minSessions:2}); if(agg.state!=='crossed'){console.error('aggregate state '+agg.state);process.exit(1)} console.log(JSON.stringify({records:recs.length,sessions:agg.aggregates[0].sessions,state:agg.state}))"` ⇒ The extractor pulls both records out of the real `{data:[{error_text,…}]}` transport shape and aggregation reaches `crossed` at min_sessions=2; today it extracts `[]`. After landing, the next meta round's `recordsScanned` must be > 0 against the live corpus (this criterion deliberately uses the captured real shape so it is runnable in a task worktree, where meta-cc's project lookup has no sessions).
  - 实跑（任务 worktree，修复后）：`{"records":2,"sessions":2,"state":"crossed"}`，exit 0。修复前同一命令 exit 1、`extractor yielded []`（这是本次的取假控制）。
  - 生产载体读数（真语料，`query_session_signals type=errors`，`limit=5`，42.6s）：`extracted=5` / `recordsScanned=5`；修复前同路径恒为 `0`。

## Definition of Done
- [x] 上面的判据实跑通过，且判据本身能取假（改坏实现时会红）—— 修复前 AC 命令 exit 1；另做**变异取假**：把 `error_text` 从候选键表里删掉后，新增回归测试 `真实交付形态：投影记录（error_text / session_id）…` 是**唯一**变红的用例（175 pass / 1 fail），恢复后 176 pass / 0 fail。
- [x] 若结论是「已有机制在管、只是失败」，则修那个机制，⛔ 不新建并行机制 —— 只改了 `errorTextsFromRecord` 的承载点枚举，无新提取器、无新载体、无新读数键。

## Dark axis (ADR-007)
- L_G: 该轴仍暗,理由:本任务只补一个纯函数的字段识别分支（同文件内 4 行逻辑 + 回归测试），不移动模块边界、不新增依赖边，架构轴读数不会因它改变，任何「跑了 archguard 得到 cycles=N」都不可归因于本任务

## Touches
- `plugin/scripts/meta-driver.ts`
- `plugin/test/meta-driver.test.mjs`
- `tasks/gap-meta-errortextsfromrecord.md`
