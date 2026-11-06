---
id: gap-meta-collectactionrecordfailures-3
title: action-failure reading reports a clean state from a zero-record carrier
  that predates the extractor fix
status: ready
labels:
  - meta-driver
  - driver-candidate
parent: null
children: []
extra: {}
---
## Finding
This round `actionRecordFailures` = {state:"none", recordsScanned:0, reason:null, scannedAt:"2026-11-06T00:05:20.357Z"}, but `aggregateActionFailures` returns `none` for an empty record array (zero records is shaped exactly like "examined and clean" — hard rule 3b), and that zero-record carrier was produced 18.8 h BEFORE the extractor fix `4b6f9692e` ("read meta-cc's projected error_text", committed 2026-11-06T18:52Z → 02:52+08:00); `collectActionRecordFailures` still treats it as fresh because freshness is `scan_ttl` (24h) from `scannedAt` alone, with no notion of which extractor produced it ⇒ the reading is doubly unearned yet reads as green.

本轮读数（actionRecordFailures）= `{"state":"none","aggregates":[],"reason":null,"scannedAt":"2026-11-06T00:05:20.357Z","scanMs":57191,"since":null,"thresholdSessions":2,"recordsScanned":0}`，采于 2026-11-06T20:04:49Z，由 meta-driver 机械采集。
⚠️ 机制词 `collectActionRecordFailures` 命中【已完成】任务：gap-meta-collectactionrecordfailures-2.md[done]、gap-meta-collectactionrecordfailures.md[done]、gap-meta-locatemetaccmcp.md[done]——问题仍在而任务已 done ⇒ 先查那些任务为何没解决它，⛔ 不要在它们旁边新造一个并行机制。

## AC（draft）
- [x] `node --experimental-strip-types --input-type=module -e "import { aggregateActionFailures } from './plugin/scripts/meta-driver.ts'; const empty = aggregateActionFailures([], { minSessions: 2 }); if (empty.state !== 'not-evaluated') { console.error('empty corpus reported as ' + empty.state); process.exit(1); } const hit = aggregateActionFailures([{sessionId:'a',signature:'s',example:'x',ts:null},{sessionId:'b',signature:'s',example:'x',ts:null}], { minSessions: 2 }); if (hit.state !== 'crossed') { console.error('two-session signature reported as ' + hit.state); process.exit(1); } console.log(JSON.stringify({empty: empty.state, crossed: hit.state}));"` ⇒ An empty corpus yields `not-evaluated` with a named reason (never `none`), while two sessions sharing one signature still yields `crossed` — so "read nothing" and "examined, clean" stop sharing a shape without the instrument going vacuous. Also stamp the scan carrier with the producing extractor's identity so a carrier written by a superseded implementation is not served as fresh.

## DoD（draft）
- [x] 上面的判据实跑通过，且判据本身能取假（改坏实现时会红）
- [x] 若结论是「已有机制在管、只是失败」，则修那个机制，⛔ 不新建并行机制

## ADR-007 暗轴记录
- 该轴仍暗,理由:本次只改读数判定与扫描载体字段（无新增 import ⇒ 无新增依赖边），未触碰 L_D/L_G 的结构面，故未取新的结构读数

## Evidence
（全部在 worktree `/data/home/yale/work/quay-worktrees/gap-meta-collectactionrecordfailures-3` 内实跑）

1. AC 实跑（正臂，落地的实现）：
   ```
   $ node --experimental-strip-types --input-type=module -e "<AC 原文>"
   empty: not-evaluated | empty-corpus: scan yielded 0 records — indistinguishable from an extractor that recognized nothing | aggregates: null
   hit: crossed [{"signature":"s","sessions":2,"count":2,"crossed":true,"example":"x"}]
   extractor: 47af7081bfb62aee
   ```
2. AC 取假控制（把 `if (records.length === 0)` 改成 `if (false)` 的同源副本）：
   ```
   empty corpus reported as none
   mutant exit=1
   ```
3. 第二半（载体抽取器身份）的取假控制（把 `s.extractor === ACTION_RECORD_EXTRACTOR_ID` 放宽成 `s !== null`）：
   ```
   ✖ 载体抽取器身份：旧实现写的载体在 TTL 内 ⛔ 也不得被当新鲜读数
     AssertionError: 旧实现写的载体 ⛔ 不得冒充当前读数
   ℹ pass 0 / fail 1      （恢复后 sha256 校验 OK）
   ```
4. `node --no-warnings --experimental-strip-types --test plugin/test/meta-driver.test.mjs` ⇒ `tests 177 / pass 177 / fail 0`。
5. 新增测试用**假 meta-cc**（JSON-RPC over stdio）走完真扫 → 落载体 → `extractor: ACTION_RECORD_EXTRACTOR_ID` → 正臂采信（crossed）；改标 `superseded000000` 与删掉该键 ⇒ 都 `not-evaluated`（reason 分别 `superseded-extractor:` / `<unstamped>`）；改回当前 id ⇒ 又採信（结论由身份驱动）。

## Touches
- `plugin/scripts/meta-driver.ts`
- `plugin/test/meta-driver.test.mjs`
- `plugin/probes/meta-driver.md`
- `tasks/gap-meta-collectactionrecordfailures-3.md`
