---
id: gap-routine-quota-window-ms-parsed-but-inert
title: routine_quota.window_ms is parsed from drivers.yml but no consumer reads
  it; both filing paths use a hard-coded window constant
status: done
labels:
  - gap
  - architecture-discovery
parent: null
children: []
extra:
  schema: execution
---
## Proposal
`plugin/scripts/driver-config.ts` `loadRoutineQuotaConfig` parses `routine_quota.window_ms`, around line 197: `const windowMs = pick("window_ms", d.windowMs);`. The only exported consumers are `routineK` (around line 232) and `routineGlobalCeiling` (around line 240). Nothing reads `.windowMs`: a grep for `\.windowMs` outside driver-config and tests finds only unrelated windows (`meta-driver.ts` action-record config, `worker-driver.ts` retry exemption). Both filing paths count the window with the constant `FILING_WINDOW_MS`: `probe-routine.ts` (imported around line 56) and `meta-driver.ts` (`countRecentFilings` around line 1775).

So editing `window_ms` silently does nothing. That is a declared knob that is inert (hard rule 3b / rule 9). There is zero impact today, because the configured value (86400000) equals the constant.

## Plan
Export a `routineWindowMs(root)` from driver-config, shaped like `routineK` / `routineGlobalCeiling`. Use it at every `countRecentFilings` call site in `probe-routine.ts` and `meta-driver.ts`. Keep the default equal to today's constant, so there is no behaviour change at the default.

## Acceptance Criteria
- [x] `node --test plugin/test/driver-config.test.mjs plugin/test/probe-routine.test.mjs plugin/test/meta-driver.test.mjs` exits 0. New cases:
  - (a) In a fixture with `window_ms: 3600000` and a filing record 2 hours old, `selectFilings` does NOT count that record toward the per-routine or global quota. With the default config, it does.
  - (b) Same for the meta-driver `driveItems` global count.
  Output — 174 pass / 0 fail; the four new cases (both (a) arms on the real chain, plus the (b) arm and the config unit):

  ```
  ✔ routineWindowMs — 窗口宽度的单一入口：读 drivers.yml 的 window_ms；缺省/荒谬 ⇒ 回退旧常量（迁移兼容）
  ✔ FILING WINDOW AC1(a) — per-routine 读数：window_ms:3600000 让 2h 前的记录不占 K（缺省 24h 则占）
  ✔ FILING WINDOW AC1(a) — 全局读数：window_ms:3600000 让 2h 前的记录不占全局天花板（缺省 24h 则占）
  ✔ driveItems AC1(a) — 全局计数尊 `window_ms`：1h 窗下 2h 前的记录不计数（缺省 24h 则计数 ⇒ global-rate:）
  ℹ tests 174
  ℹ pass 174
  ℹ fail 0
  ```
  Each (a)/(b) arm is a positive/negative control on the SAME fixture — the only moving part is `window_ms` (1h vs default 24h) over the same 2h-old record. The narrow arm is accepted, the default arm is rejected (`rate:` per-routine / `global-rate:` global), and the fixture self-check asserts `routineWindowMs(root)` and `countRecentFilings(...)` take both readings.
- [x] Static check: `grep -n 'FILING_WINDOW_MS' plugin/scripts/probe-routine.ts plugin/scripts/meta-driver.ts` shows no use as a `countRecentFilings` window argument. Paste the output.
  Output — five hits, all COMMENTS (hard rule 2: judge by position, not keyword); no code reference survives in either file (the import was removed from both):

  ```
  plugin/scripts/probe-routine.ts:78:// 消费（两个立案计数点各自引用常量 FILING_WINDOW_MS）⇒ 改 `window_ms` 静默无效。现在窗口同样从本面读。
  plugin/scripts/probe-routine.ts:412:  // ⓪d rate 窗口宽度：两个读数共用。缺省（调用方未提供）⇒ 24h，与旧常量 FILING_WINDOW_MS 逐字相等，
  plugin/scripts/probe-routine.ts:992:          // rate 窗口同样从 drivers.yml 读出（⛔ 不是孤儿常量 FILING_WINDOW_MS）——见 routineWindowMs。
  plugin/scripts/meta-driver.ts:66:// `routine_quota.window_ms` 读，⛔ 不再引用孤儿常量 FILING_WINDOW_MS（它曾让 window_ms 改了没用）。
  plugin/scripts/meta-driver.ts:1837:  // 窗口从 drivers.yml `routine_quota.window_ms` 读（⛔ 不是常量 FILING_WINDOW_MS）——与 probe-routine.ts
  ```
- [x] Mutation control: make `routineWindowMs` return the old constant regardless of config and show case (a) goes red. Paste the output, then revert.
  Output — mutation `return DEFAULT_ROUTINE_QUOTA_WINDOW_MS;` (config ignored) reds all four new cases; revert restores 174/0:

  ```
  $ routineWindowMs -> return DEFAULT_ROUTINE_QUOTA_WINDOW_MS;
  ✖ routineWindowMs — 窗口宽度的单一入口：...
  ✖ driveItems AC1(a) — 全局计数尊 `window_ms`：...
  ✖ FILING WINDOW AC1(a) — per-routine 读数：...
  ✖ FILING WINDOW AC1(a) — 全局读数：...
  ℹ pass 170
  ℹ fail 4
  --- revert ---
  $ routineWindowMs -> return loadRoutineQuotaConfig(root).windowMs;
  ℹ pass 174
  ℹ fail 0
  ```

## Definition of Done
- All AC ticked with output pasted.
- `scripts/test.sh --for-task gap-routine-quota-window-ms-parsed-but-inert` green.

## Touches
- tasks/gap-routine-quota-window-ms-parsed-but-inert.md
- plugin/scripts/driver-config.ts
- plugin/scripts/probe-routine.ts
- plugin/scripts/meta-driver.ts
- plugin/test/driver-config.test.mjs
- plugin/test/probe-routine.test.mjs
- plugin/test/meta-driver.test.mjs
