---
id: gap-instrument-decay-suite-recovery-groups-unadjudicated
title: instrument-decay 仍报 3 个 rate-stopped 分组（suite-incomplete /
  suite-recovery-accepted / suite-recovery-baseline-exempt）：触发缺席可证，但 MANIFEST
  无机器可读裁定
status: todo
labels:
  - gap
  - defect
  - meta
parent: null
children: []
extra:
  schema: execution
---
## Proposal

**现状读数**（2026-10-27，主检出 `/data/home/yale/work/quay`，HEAD `ee7f8a267`，全量 `instrument-decay-check.ts --json`）：

```
ok:false evaluated:true decayedCount:3 adjudicatedCount:8 healthyCount:4 uncoveredCount:2
fan-in-step-trace.jsonl  (freshest=2026-10-26T22:08:58.578Z, totalRecords=20681, groupCount=27)
  decayed: suite-incomplete                rate-stopped count=63 lastWrite=2026-10-25T05:26:32.695Z
  decayed: suite-recovery-accepted         rate-stopped count=19 lastWrite=2026-10-25T05:42:48.470Z
  decayed: suite-recovery-baseline-exempt  rate-stopped count=17 lastWrite=2026-10-25T05:42:48.470Z
```

这 3 组是当前整个 workspace 的**唯一** decay（其余 4 个已登记载体 healthy；另 2 个 uncovered 已声明）。

**为什么它们同时停写——一条因果链，不是三次独立腐烂**：
- `suite-incomplete` 写手在 `plugin/scripts/worker-fan-in.ts:2970`，触发条件是该轮 suite 日志里能解析出 incomplete 标记（`:2960` `extractSuiteIncompleteMarker(suiteLogText)`；`:2961` `if (incompleteMarker !== null)`），标记形如 `oom-killed (n)` 或 `incomplete suite (missing/planned files)`。
- `suite-recovery-accepted`（`:3150`）与 `suite-recovery-baseline-exempt`（`:3103`）都只在这个 `if (incompleteMarker !== null)` 的**恢复阶梯内部**可达；没有 incomplete ⇒ 阶梯根本不进入 ⇒ 两个终端分支都不写。
- 载体实读：末次 `suite-incomplete`（2026-10-25T05:26:32.695Z）之后有 **29** 条 `suite-start`、**28** 条 `suite-end`（全部是完整判词 `reason:"suite red"`）、**0** 条 `suite-recovery` ⇒ 窗口内没有一轮 incomplete，阶梯确实没被触发过。63 条 `suite-incomplete` 里 61 条是 `oom-killed`、2 条是 `incomplete suite`，其成因（OOM）已由 `gap-fan-in-recovery-ladder-inert-bucket-full-drops-test-concurrency` / `gap-suite-oom-lane-scaled-ladder-floor-32-no-lower-rung` 修复。

**节奏读数（证明不是「刚过 24h 阈值」的噪声）**：

| 分组 | 历史条数 | 间隔中位数 | p90 | 全历史最大 | 当前间隔 |
|---|---|---|---|---|---|
| suite-incomplete | 63 | 0.54h | 7.96h | 86.85h | 42.6h |
| suite-recovery-accepted | 19 | 2.79h | 19.19h | 21.09h | 42.3h |
| suite-recovery-baseline-exempt | 17 | 2.39h | 13.69h | 19.19h | 42.3h |

后两组的当前间隔已是**全历史最大间隔的约 2 倍**；`suite-incomplete` 也远超 p90。

**机制缺陷（本条的落点）**：`CarrierSpec.adjudicated[]` 这个机器可读落点已由 `gap-fan-in-step-trace-rate-stopped-adjudication`（done）建好，2026-10-25 的 `gap-instrument-decay-explained-absence-declarations`（done）又为上游的 `suite-skip` / `suite-recovery` / `suite-recovery-blocked` 补了裁定——但**下游这 3 组至今没有任何裁定声明**。于是 Shape B 每轮把它们重新报成 `decayed`，同一份人工取证已被迫重做（2026-10-23、2026-10-25 两轮），而「解释只活在散文里、不活在机制里」正是硬规则 5b 的兄弟实例遗漏形态。

**`suite-rerun-green` 不在本条范围内（现场复核结论）**：同一 (载体, 形态) 的第 4 个组在本次读数里已进入 `adjudicated[]`（`explained-absent`，条件命令 exit 0）。读数：末次 green = 2026-10-21T16:36:58.159Z，之后 94 条 `rerun` 全部是允许态（88 `rerun-red` + 6 `rerun-not-evaluated`）⇒ 裁定成立，**不再报 decay**。本条只处理上述 3 组。

**prior-claim**（都是 done；按当前载体复核，腐烂仍在 ⇒ 本条不是重复立案）：
- `gap-instrument-decay-explained-absence-declarations`（done）—— 处理同一 OOM→incomplete→恢复链的**上游 3 组**，未覆盖下游这 3 组。
- `gap-fan-in-step-trace-rate-stopped-adjudication`（done）—— 建了 `adjudicated[]` 机制，声明 5 组，不含这 3 组。
- `gap-instrument-decay-suite-rerun-green-condition-misreads-not-evaluated` / `gap-instrument-decay-suite-rerun-green-file-pin-expired`（均 done）—— 修 `suite-rerun-green` 的条件；本次复核该组已不再 decay。

<!-- dedup-ref --> **合并判断 = separate**：open `gap-instrument-decay-dedup-reader-round-log-path`（todo）共用 `plugin/scripts/quality-gate-driver.ts` 的 instrument-decay 轮次面，但机制不同——那条修「读侧去重台账路径恒空 ⇒ 同一 pair 每轮重 spawn」（raw recipe 与验收都在轮次账本上），本条修「MANIFEST 缺少这 3 组的机器可读裁定 ⇒ Shape B 每轮把已解释缺席重报成 decay」。`gap-instrument-decay-postlanding-two-rounds`（ready）是那条的 post-landing 观察，同样不是本机制。`task-granularity-advice.ts` 对 `plugin/scripts/instrument-decay-check.ts` + `plugin/test/instrument-decay-check.test.mjs` 返回 `peers: []`，无 Touches 重叠的 open 任务。

## AC

- [ ] AC1（复现与前提）在主检出跑全量 detector（`node --experimental-strip-types plugin/scripts/instrument-decay-check.ts --root /data/home/yale/work/quay --json`），`decayedCount=3` 且 `decayed[]` 恰为 `suite-incomplete` / `suite-recovery-accepted` / `suite-recovery-baseline-exempt`，三者的 `count` 与 `lastWrite` 与 Proposal 表一致；贴出该 JSON 的 `decayed[]`。判据可假：若任一组的 `lastWrite` 距运行时刻 <24h，或组名不是这三者 ⇒ 前提已变，停止并以新读数重新取证。
- [ ] AC2（写手在、触发缺席可证）贴出 `worker-fan-in.ts` 中三处 `traceSuiteEvent` 的行号（当前为 `:2970` / `:3103` / `:3150`，以及 `:2960`/`:2961` 的 incomplete 标记判定）；并用当前载体算出「末次 `suite-incomplete` 之后」的 `suite-start` / `suite-end` / `suite-recovery` 条数与 `suite-end` 的 `reason` 取值分布，证明窗口内 incomplete = 0（贴命令与输出）。判据可假：窗口内出现任一条 `suite-recovery`、或任一 `suite-end` 不是完整判词 ⇒ 「触发缺席」为假，不得以裁定收口。
- [ ] AC3（机制落点）在 `plugin/scripts/instrument-decay-check.ts` 的 `MANIFEST` 为这 3 组各加一条机器可读裁定：`reason` 非空、`reviewAfter` 未过期、`conditionCmd` 非空（或按既有 `rare-by-design` 形态给出触发名与节奏读数）。裁定读的必须是**触发输入**（是否发生过 incomplete / 是否有 incomplete 等不到认证），⛔ 不是「本组多久没写」的二次包装。给出**负控制**：构造一个「incomplete 之后无认证」的窗口（fixture 或临时载体），同一条件命令必须 exit≠0 且 detector 把对应组放回 `decayed[]`；贴出正反两次输出。判据可假：若负控制下条件仍 exit 0，该裁定是空转，不算完成。
- [ ] AC4（读数不消失）改后全量 detector `decayedCount=0`，这 3 组出现在 `adjudicated[]` 且各自 `count` / `lastWrite` 与 AC1 完全一致（⛔ 不得因为「不算腐烂」就从读数里消失，硬规则 3b）；贴出 `--json` 输出中的 `decayed[]` 与 `adjudicated[]`。
- [ ] AC5（回归）`bash scripts/test.sh --for-task <本任务 id>` 通过（含 `plugin/test/instrument-decay-check.test.mjs`，覆盖新增裁定与负控制）；贴出输出。

## DoD

- [ ] AC1–AC5 全绿；改动只在 `plugin/scripts/instrument-decay-check.ts`（及其测试），不新增第二套裁定表、不改 Shape B 的判定逻辑（只在描述符里增加声明——`instrument-decay-check.ts` 头注的扩展点契约）。
- [ ] 真实载体上跑出 AC4 的读数（不是 fixture 回显）：`decayedCount=0` 且 3 组在 `adjudicated[]`，并贴出运行时刻与载体 freshest。

## Evidence

（2026-10-27 立案取证；主检出 `/data/home/yale/work/quay`，HEAD `ee7f8a267`，当前分支 `author`）

- 全量 detector：`decayedCount:3 adjudicatedCount:8 healthyCount:4 uncoveredCount:2`；decayed 恰为上述 3 组。
- 载体 `fan-in-step-trace.jsonl`：`totalRecords:20681`，`freshest:2026-10-26T22:08:58.578Z`，`groupCount:27`；伴生分组仍在写（`suite-start` 1125 条 / `suite-end` 1123 条 / `rerun` 317 条 / `ff` 1594 条）。
- 末次 `suite-incomplete` 之后：`suite-start=29`、`suite-end=28`、`suite-recovery=0`；`suite-end.reason` 分布 = 28 × `suite red`。
- 写手行号现场读：`worker-fan-in.ts:2960/2961/2970/3103/3150`。
- `suite-rerun-green` 当前裁定：`adjudicated[]` 中 `state:"explained-absent"`、`condition.exitCode:0`、`count:79`、`lastWrite:2026-10-21T16:36:58.159Z`；末次 green 之后 `rerun` = 88 `rerun-red` + 6 `rerun-not-evaluated`。
- `task-granularity-advice.ts --touches plugin/scripts/instrument-decay-check.ts --touches plugin/test/instrument-decay-check.test.mjs --json` ⇒ `peers: []`、`mentions: []`。

## Touches

- plugin/scripts/instrument-decay-check.ts
- plugin/test/instrument-decay-check.test.mjs
- tasks/gap-instrument-decay-suite-recovery-groups-unadjudicated.md