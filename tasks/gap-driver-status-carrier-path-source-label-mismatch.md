---
id: gap-driver-status-carrier-path-source-label-mismatch
title: driver status 的 carrier_path 与 last_record_ts 不同源 ⇒ server status 的 §6.10
  source 串谎报自己读的是哪个载体
status: ready
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

- [x] AC1：`quay driver status --kind <k> --json` 必须暴露**实际**提供 `last_record_ts` 的那个载体（例如新字段 `last_record_carrier`），且该字段的值必须是一个「其自身末条 ts == 所报 `last_record_ts`」的载体。**负控制**：在一个「首个存在载体 ≠ 最大 ts 载体」的 fixture 上断言该字段 == 最大 ts 载体——只重命名标签、没把真载体接出来的修法在此必红。
- [x] AC2：`quay server status --json` 的 `drivers[].liveness.source` 必须点名提供该 ts 的载体，或干脆不声称具体载体——只断言实际量到的那个事实。**负控制**：把渲染出的 source 串里点名的那些载体与各自末条 ts 对照，出现「点名的载体 ts ≠ 所报 ts」即判失败。
- [x] AC3（负控制，改前必须红）：把 fixture 指向一个「首个存在载体 ≠ 最大 ts 载体」的 kind——`promotion` 恰是这样（`promotion-outcome.jsonl` 存在但陈旧、`promotion-round.jsonl` 新鲜）——断言所报载体 == 最大 ts 载体。**改前**：报了 `promotion-outcome.jsonl` 而 ts 来自 `promotion-round.jsonl` ⇒ 红；**改后** ⇒ 绿。
- [x] AC4：人可读一行形（`driver-runtime.ts:1686-1687`）携带同一修正后的并置关系——显示的 path 就是 ts 的来源，或该 ts 明确标注为「跨载体最大值」。**负控制**：用与 AC3 相同的 fixture 读非 `--json` 输出。

## DoD

真正落地：修正在本工作区的**权威分支（`develop`）**上，且新字段/路由在**真实工作区**上可观测正确——在 `/home/yale/work/quay` 上跑 `quay driver status --kind promotion --json`，其「ts 来源」须为 `promotion-round.jsonl`，并且 `quay server status --json` 的 source 串与之一致。**fixture 满足不算数**（硬规则 4 推论三：只能被 fixture 满足的判据不是测量）。同时，钉住 `carrier_path` 语义的既有测试（`plugin/test/driver-status-carrier-path.test.mjs`）仍须通过，外加 scoped 门与全量 `scripts/test.sh` 绿。

## Touches

- packages/quay/src/cli/server.ts
- plugin/scripts/driver-runtime.ts
- plugin/test/driver-status-carrier-path.test.mjs
- packages/quay/test/cli.test.mjs
- tasks/gap-driver-status-carrier-path-source-label-mismatch.md

## Evidence（2026-09-13T23:0x–23:2xZ · 生产数据 + 改前/改后对照）

**实现（本分支 1 提交 `01e024f9b`；随后 merge develop 至 `0b9b843af`）**
- `plugin/scripts/driver-runtime.ts`：`CarrierStats` 增 `lastTsCarrier`（与 `primaryPath` **分开跟踪**同一趟扫描的胜出者；比较仍是严格 `>` ⇒ 并列时与 `lastTs` 取同一个来源）；`statusForKind` 的 JSON 增 `last_record_carrier`；一行形在 `last_record_ts` 紧邻处打印它，且来源 ≠ `carrier_path` 时给该 ts 标注 `(cross-carrier max)`。`carrier_path` 取值语义**未改**（由既有 AC1b 测试钉住）。
- `packages/quay/src/cli/server.ts`：`driverServiceReport` 的 `source` 改点名 `last_record_carrier`；kernel 未报来源时**不点名任何载体**（⛔ 不退回 `carrier_path` 再谎报一次）。

**⛔ 前置依赖（诚实登记）**：本任务判据所依赖的渲染面（`driverServiceReport` / `drivers[]`）由**同日在飞的兄弟任务** `gap-ac255-driver-internalization-pid-le2-six-kinds-fresh` 引入，而立案时它**尚未落到 develop** ⇒ 本分支把它的 6 个提交（tip `4e93a6950`，彼时已含 develop tip）作为前置**并入**（fast-forward；**SHA 不变** ⇒ 它自己落地时无冲突、不产生重复提交）。这也是落地前 `quay server status --json` 根本没有 `drivers[]` 的原因。

**AC1（生产数据 · 直接量）** — `driver status --kind promotion --json --root /home/yale/work/quay`：
- `carrier_path = /home/yale/work/quay/.quay/promotion-outcome.jsonl`（首个存在者，语义不变）
- `last_record_ts = 2026-09-13T23:02:20.711Z`
- `last_record_carrier = /home/yale/work/quay/.quay/promotion-round.jsonl` ← 新字段
- **可核（判据对「被点名的载体」本身取真读数）**：`promotion-round.jsonl` 自身末条 ts = `2026-09-13T23:02:20.711Z` **== 所报 ts**；`promotion-outcome.jsonl` 自身末条 ts = `2026-09-13T22:43:06.048Z` **≠ 所报 ts** ⇒ 改前点名的那个**确实没有供数**。
- 其余 kind 同形（如 `meta` ⇒ `meta-driver-round.jsonl`）。
- 测试：`plugin/test/driver-status-carrier-path.test.mjs` 新增 `provenance AC1` / `AC1b` 绿；**改前必红已实测**——把 `driver-runtime.ts` 换回 `4e93a6950` 版本跑同文件，4 条新增测试**全 ✖**。

**AC2（生产数据）** — `quay server status --json --root /home/yale/work/quay`（本分支代码 + 生产载体数据）：promotion 行 `source = carrier:/home/yale/work/quay/.quay/promotion-round.jsonl last ts`，`evaluated=true alive=true`；六个 kind 的 source 各自点名对应的 `<kind>-round.jsonl`（`meta` 为 `meta-driver-round.jsonl`），与所报 ts 同源。
- 端点判据（`packages/quay/test/cli.test.mjs` block30）：在「首个存在载体 ≠ 最大 ts 载体」的 fixture 上跑真 `quay server status --json`，断言 `source` 含 `promotion-round.jsonl` **且不含** `promotion-outcome.jsonl`；同时断言该行确实被评估、心跳新鲜（避免断言落在「no live carrying process」分支上空转）。

**AC3（负控制 · 改前必须红 · 双向实测）**
- 生产数据对照（同一份生产载体，只换 `packages/quay/src/cli/server.ts` 到 `4e93a6950` 版本）：**改前** `source = carrier:/home/yale/work/quay/.quay/promotion-outcome.jsonl last ts`（其自身末条 ts `22:43:06Z` ≠ 所报 ts）；**改后** `source = carrier:/home/yale/work/quay/.quay/promotion-round.jsonl last ts`（== 所报 ts）。
- 测试对照：同一 block30 在**改前 server.ts** 上 ⇒ 2 条 provenance 断言 FAIL（`source ⛔ 不得点名陈旧的那个载体（outcome）` 等）；改后 ⇒ 全 PASS。fixture 形态正是 AC3 点名的那个（outcome 存在但陈旧、round 新鲜）。

**AC4（一行形 · 非 `--json`）** — 生产读数逐字：
`promotion-driver: kind=promotion · host=anchor anchor_pid=3057428 · … · carrier_path=/home/yale/work/quay/.quay/promotion-outcome.jsonl · carrier_records=85153 · last_record_ts=2026-09-13T23:02:20.711Z (cross-carrier max) · last_record_carrier=/home/yale/work/quay/.quay/promotion-round.jsonl · carrier_files=promotion-outcome.jsonl:41970,promotion-round.jsonl:43183`
⇒ 来源 path **紧跟** ts，且该 ts 被明确标注为跨载体最大值。测试 `provenance AC4` 绿（含无载体形态：`last_record_carrier=null` 且**不出现**该标注——同态，硬规则 3b）。

**DoD**
- 修正落在本分支（`01e024f9b`），由 fan-in 进 `develop`。
- **真实工作区读数在场**（上列全部取自生产 root `/home/yale/work/quay`，⛔ 非夹具）。⚠️ 诚实标注读数形态：代码取**本分支**（`QUAY_PLUGIN_ROOT` 指本分支 `plugin/`），载体数据取**生产**——落地前主检出尚无本分支代码，这是能做到的最强形态；落地后主检出自身即产出同一读数。
- `plugin/test/driver-status-carrier-path.test.mjs` **8/8 pass**（含 4 条既有测试，其中 AC1b 钉住 `carrier_path` 语义未变）。
- scoped 门：`bash scripts/test.sh --for-task gap-driver-status-carrier-path-source-label-mismatch --allow-thin` ⇒ **EXIT=0，0 fail**（在 develop tip `0b9b843af` 上跑；two test 文件均在选中集内并各自产出 PASS）；scoped-gate 缓存已按该 develop sha 写入。
- 全量 `scripts/test.sh` 由 fan-in（driver）执行，本 worker 不跑（派发链规定）。