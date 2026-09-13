---
id: gap-driver-status-carrier-path-source-label-mismatch
title: driver status 的 carrier_path 与 last_record_ts 不同源 ⇒ server status 的 §6.10
  source 串谎报自己读的是哪个载体
status: todo
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
---
## Finding

`quay driver status --kind <k> --json` returns three fields that `packages/quay/src/cli/server.ts` renders as one provenance claim:

- `carrier_path` = `carrierStats().primaryPath` = the FIRST carrier that EXISTS on disk (per the registry `carriers` array order)
- `last_record_ts` = the MAX last-ts across ALL of that kind's carriers
- `carrier_records` = the SUM of line counts across all carriers

`server.ts`'s `driverServiceReport()` then emits `source: "carrier:${carrier_path} last ts"` — asserting the ts came from the carrier it names. It did not.

Measured 2026-09-13T22:33Z on the production root `/home/yale/work/quay`:

- `driver status --kind promotion --json` ⇒ `carrier_path = /home/yale/work/quay/.quay/promotion-outcome.jsonl`, `last_record_ts = 2026-09-13T22:33:30.546Z`
- truth: `promotion-outcome.jsonl` last ts = `2026-09-13T20:01:48.261Z` (mtime 20:01, 2.5h stale); `promotion-round.jsonl` last ts = `2026-09-13T22:33:30.546Z` — i.e. the reported ts actually came from `promotion-round.jsonl`, NOT from the carrier named.
- Root cause is intentional-in-isolation: `driver-runtime.ts:1653-1654` documents that `primaryPath` is the first EXISTING carrier and that the three fields come from "the same carrierStats reading" — but they are different quantities of that reading. The false provenance claim is introduced at the render site (`server.ts` source string).
- Impact: the §6.10 per-service liveness VERDICT stays correct (the ts is still from a carrier of that kind), but the reading's stated provenance is false, so a reader who checks the named file sees a 2.5h-stale carrier while the row claims 113s freshness. That is the 硬规则 3b / 4b family ("a reading whose stated source is not the source").
- Adjacent consumer to check: the human-readable one-line form at `driver-runtime.ts:1686-1687` (`carrier_path=… · carrier_records=… · last_record_ts=…`) has the same juxtaposition.

Related but NOT a duplicate: `gap-driver-status-carrier-path-names-first-entry-not-the-existing-one` (done) changed `primaryPath` to the first EXISTING carrier — that fix is exactly what makes this mismatch reachable on a real workspace. This task is its downstream provenance defect (which carrier supplied the ts), not the same mechanism (which carrier the path names).

## AC

- [ ] AC1：`quay driver status --kind <k> --json` 必须暴露**实际**提供 `last_record_ts` 的那个载体（例如新字段 `last_record_carrier`），且该字段的值必须是一个「其自身末条 ts == 所报 `last_record_ts`」的载体。**负控制**：在一个「首个存在载体 ≠ 最大 ts 载体」的 fixture 上断言该字段 == 最大 ts 载体——只重命名标签、没把真载体接出来的修法在此必红。
- [ ] AC2：`quay server status --json` 的 `drivers[].liveness.source` 必须点名提供该 ts 的载体，或干脆不声称具体载体——只断言实际量到的那个事实。**负控制**：把渲染出的 source 串里点名的那些载体与各自末条 ts 对照，出现「点名的载体 ts ≠ 所报 ts」即判失败。
- [ ] AC3（负控制，改前必须红）：把 fixture 指向一个「首个存在载体 ≠ 最大 ts 载体」的 kind——`promotion` 恰是这样（`promotion-outcome.jsonl` 存在但陈旧、`promotion-round.jsonl` 新鲜）——断言所报载体 == 最大 ts 载体。**改前**：报了 `promotion-outcome.jsonl` 而 ts 来自 `promotion-round.jsonl` ⇒ 红；**改后** ⇒ 绿。
- [ ] AC4：人可读一行形（`driver-runtime.ts:1686-1687`）携带同一修正后的并置关系——显示的 path 就是 ts 的来源，或该 ts 明确标注为「跨载体最大值」。**负控制**：用与 AC3 相同的 fixture 读非 `--json` 输出。

## DoD

真正落地：修正在本工作区的**权威分支（`develop`）**上，且新字段/路由在**真实工作区**上可观测正确——在 `/home/yale/work/quay` 上跑 `quay driver status --kind promotion --json`，其「ts 来源」须为 `promotion-round.jsonl`，并且 `quay server status --json` 的 source 串与之一致。**fixture 满足不算数**（硬规则 4 推论三：只能被 fixture 满足的判据不是测量）。同时，钉住 `carrier_path` 语义的既有测试（`plugin/test/driver-status-carrier-path.test.mjs`）仍须通过，外加 scoped 门与全量 `scripts/test.sh` 绿。

## Touches

- packages/quay/src/cli/server.ts
- plugin/scripts/driver-runtime.ts
- plugin/test/driver-status-carrier-path.test.mjs
- packages/quay/test/cli.test.mjs
- tasks/gap-driver-status-carrier-path-source-label-mismatch.md
