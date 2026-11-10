---
id: gap-meta-readmetacarrier
title: 修复 meta-driver 的重复计数仪器：整文件读超过 V8 上限的载体时 readMetaCarrier 静默返回「没有历史」
status: done
labels:
  - meta-driver
  - driver-candidate
parent: null
children: []
extra: {}
---
## Finding
`plugin/scripts/meta-driver.ts` 的 `readRoundCarrier`（被 `readMetaCarrier` 调用）用 `fs.readFileSync(path,'utf8')` 整读 `.quay/meta-driver-round.jsonl`；该载体现约 2.2 GB，超过 V8 最大字符串长度 0x1fffffe8，抛 ERR_STRING_TOO_LONG 后被 `catch { return [] }` 吞成空历史 ⇒ `computeDivergenceRecurrence` 对每条 (id,kind) 恒返回 repeatCount=0 / lastRecommendation=null，重复建议的自纠机制完全失效（本轮 readings 的 `divergences` 正是这一读数）。硬规则 3b：读不懂输入与「没有历史」同形。`tasks/gap-prod-data-audit-whole-file-read-crashes-on-carrier-over-v8-string-limit.md` 已把 `meta-driver.ts` 这一处明确标为「只上报、应单独立一条 gap」，本条即该 gap。

本轮读数（divergences）= `[{"id":"AC-936","status":"active","verdict":"fail","reason":"acceptance failed (exit 1) — no goal-requests ledger","kind":"active-but-failing","handler":{"kind":"none","state":"absent"},"repeatCount":0,"lastRecommendation":null}]`，采于 2026-11-10T02:43:34Z，由 meta-driver 机械采集。
涉及机制关键词：`readMetaCarrier`（立案前已搜既有任务，无人认领）。

立案时实测：`stat -c %s .quay/meta-driver-round.jsonl` = **2,236,702,877 B**；逐行流式扫描实测 **39,320 行 / 7.94 s**，最大行 1,327,648 B（远低于单行读取预算 16 MiB）。

## Acceptance Criteria
- [x] `node --test --test-reporter=tap --test-name-pattern='oversize carrier' plugin/test/meta-driver.test.mjs | grep -qE '^# pass 1$'` ⇒ 在 `plugin/test/meta-driver.test.mjs` 新增一条确定性用例（稀疏 fixture：ftruncate 使 st_size > 0x1fffffe8、盘上仅数 KB），断言 `readMetaCarrier` 对该载体不再静默返回 `[]`——要么流式读出真实记录（非空），要么返回可区分的 unreadable/未评估信号；`# pass 1` 证明该用例确实被跑到并通过（⛔ 不是 0 条用例的空跑）。 — **DONE。** 实跑 `node --test --test-reporter=tap --test-name-pattern='oversize carrier' plugin/test/meta-driver.test.mjs | grep -qE '^# pass 1$'` ⇒ **exit 0**（TAP：`# tests 1 / # pass 1 / # fail 0`，用例名 `oversize carrier: readMetaCarrier streams (or reports a distinguishable not-evaluated), never a silent "no history"`）。fixture 是**稀疏**的：`ftruncate` 到 `0x1fffffe8 + 4096`，实测 `st_size > 0x1fffffe8` 且 `blocks*512 < 1 MiB`（盘上仅数 KB）。用例内含三件：①负控制——被删掉的那条整文件读在该夹具上**真的抛** `ERR_STRING_TOO_LONG`（否则夹具什么也没证明）；②结构性判据——把 `fs.readFileSync` 包一层计数器，断言这条路径对载体**零次**整文件读（「包进 try/catch 再吞掉」不合格）；③AC 的析取 `streamsRealRecords || distinguishableUnreadable`，并额外断言返回值**不是裸数组**（旧的静默 `[]` 形态）。该夹具走 OR 的第二支：洞构成一条超预算行 ⇒ `{ok:false, code:"line-too-long"}`（记录数不给偏小值，硬规则 3b）。生产侧走第一支：见 DoD 2 的实跑读数。

## Definition of Done
- [x] 上面的判据实跑通过，且判据本身能取假（改坏实现时会红） — **DONE。** 两次真变异控制（改完均回退，`grep -c MUTANT plugin/scripts/meta-driver.ts` ⇒ **0**）：
  (a) 把被删的整文件读原样放回 `readRoundCarrier`（`try { fs.readFileSync(file,"utf8") } catch { return {ok:true,records:[]} }`）⇒ 用例红：`the whole-file read must be GONE from this path, not merely try/caught`，`# pass 0 / # fail 1`；
  (b) 只把 `readMetaCarrier` 改成 `return {ok:true,records:[]}`（不提整文件读，纯「谎报没有历史」）⇒ 用例红：`readMetaCarrier must not silently report "no history": got {"ok":true,"records":[]}`。两半各自独立咬合，不是一条被另一条遮住。
- [x] 若结论是「已有机制在管、只是失败」，则修那个机制，⛔ 不新建并行机制 — **DONE。** 修的是 `readRoundCarrier` 本体（不是新造第二条读取路径）：逐行读取复用 `prod-data-audit.ts` 已导出的 `streamLines`（gap-prod-data-audit-whole-file-read-crashes-on-carrier-over-v8-string-limit 落地的那条机制），`meta-driver.ts` 只加了**一条 import**，没有新增脚本/文件、没有第二份逐行读取器。返回形状从裸数组改为三态 `{ok:true,records} | {ok:false,code}`（缺文件仍是 `ok:true + []`——那是真正的「没有历史」）；`Divergence` 增 `recurrenceEvaluated` / `recurrenceCause`，`repeatCount` 允许 `null`（未评估）以不与 0（本轮首次）同形；`readingsDigest` 增稳定的 `u`/`e` token，使「载体由可读变不可读」这一刻成为一次结论变更（语义半才会被唤醒）。

## Evidence

### 生产路径实跑（本任务的真判据：读数能不能取到）
```
$ node --experimental-strip-types -e '… readMetaCarrier("/data/home/yale/work/quay") …'
{"records":39325,"judgeRounds":402,"secs":9.084}
```
修复前同一调用返回 `[]`（整文件读抛 ERR_STRING_TOO_LONG 后被吞），⇒ `repeatCount` 恒 0。修复后对真实载体算重复计数：
```
AC-936 :: active-but-failing → repeatCount=10, lastRecommendation="人/manager 二选一，⛔ 不再造第 N 个载体…"
AC-936 :: pass-but-unflipped / achieved-but-failing / no-criterion → 0 / 0 / 0   （真实地没有，不是读不懂）
```
即：本条立案时引用的那条读数（`repeatCount:0 / lastRecommendation:null`）**不是「本轮首次」，是仪器瞎了**；修好后同一条建议已连续 10 轮。

### 测试与闸
```
$ node --test --test-reporter=tap plugin/test/meta-driver.test.mjs
# tests 190 / # pass 190 / # fail 0
$ node --experimental-strip-types plugin/scripts/fan-in-ts-typecheck-gate.ts --task gap-meta-readmetacarrier --worktree <wt>
ADMITTED (exit 0) — no new/moved .ts in the declared write surface
```

### ADR-007 暗轴
- L_D import-graph: valueSccs=0 typeSccs=0 reverseEdges=0 files=641 edges=1853 verdict=ok evaluated=true （本改动后在工作树内实跑 `plugin/scripts/import-graph-check.ts --json`；新增的边 `meta-driver.ts → prod-data-audit.ts` 同在 plugin/scripts 层，未引入环、未引入 kernel 反向边）
- L_G archguard: 本 delta 只改一个函数体内的读取方式（整文件 → 逐行流），未改变任何包的职责/边界，无 god-package 或重复抽象增量；该侧未单独取数。

### 遗留（⛔ 不在本任务 Touches，只上报）
- `plugin/probes/meta-driver.md` 的重复计数段落仍写「`repeatCount ≥ 1`」而未提 `null`（未评估）这一取值。语义半读到 `repeatCount:null` + `recurrenceEvaluated:false` 时不会误判为「本轮首次」，但 probe 文档应补一句——probe 文件不在本任务 Touches 内，未改。
- 每轮读 2.2 GB 载体实测 **9.1 s**。旧实现是「瞬间返回假 0」，现在是「9 s 返回真读数」；若日后该载体的成本成为问题，那是**载体保留/轮转**的问题（`carrier-retention`），不是本读取器的问题。

## Touches
- `plugin/scripts/meta-driver.ts`
- `plugin/test/meta-driver.test.mjs`
- `tasks/gap-meta-readmetacarrier.md`
