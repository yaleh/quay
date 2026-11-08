---
id: gap-instrument-decay-rate-stopped-blind-to-carrier-idle-window
title: instrument-decay 的 rate-stopped 把「载体级静默期」读成写手腐烂：一次恢复写入同时点亮前一次落地的 5 个收尾步
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
**type:** execution

## Proposal

**现状读数（真实载体，主检出 `.quay/fan-in-step-trace.jsonl`，2026-11-08T08:57:05Z 快照）**：载体仍在写（`evaluated:true`、`totalRecords:25591`、`freshest:2026-11-08T08:57:05.523Z`、`groupCount:31`），检测器报 5 个 `rate-stopped` 分组：`suite-end`（1329，末次 2026-11-07T08:26:43.287Z）、`baseline-red`（233，2026-11-06T22:53:49.018Z）、`develop-red-set`（51，2026-11-06T22:53:49.022Z）、`suite-recovery-exhausted`（1，2026-11-06T13:27:15.265Z）、`suite-mirror`（10，2026-11-07T08:35:15.303Z）。

**机制（受控重放，不是推断）**：把**同一份真实载体**按记录时间戳截成两份前缀——前缀 A 截止 `2026-11-07T20:45:16.160Z`（静默期中段），前缀 B 再包含到 `2026-11-08T08:57:05.523Z` 为止的记录（恢复轮的头 8 条）。同一份记录，只多出恢复轮的开头几条：

- 前缀 A：`freshest=2026-11-07T08:35:15.946Z`、`decayedCount=0`
- 前缀 B：`freshest=2026-11-08T08:57:05.523Z`、`decayedCount=6`（`suite-end` / `baseline-red` / `develop-red-set` / `suite-incomplete` / `suite-recovery-exhausted` / `suite-mirror`）

⇒ 腐烂判定的**唯一变化量是 `freshest` 这一条参照**：载体在 `2026-11-07T08:35:15.946Z` → `2026-11-08T08:57:02.581Z` 之间**一条记录都没有**（24.36h 载体级静默）。静默期内 `freshest` 自己也停在旧值，所有分组的 gap 都在 24h 阈值之下 ⇒ 读数干净；恢复轮写下第一条记录，`freshest` 跳 24.36h，**前一次落地的收尾步**同时越线。这不是五个写手同时停摆，而是 Shape B 把**载体级静默**读成了**逐组写手腐烂**。

**9 分钟后自愈的现场证据**：快照里被点名的 `suite-end` 于 `2026-11-08T09:06:44.869Z` 重新写入（新一轮 suite 结束），未做任何修复即离开 `decayed[]`。⇒ 至少这一个分组确定是恢复瞬间的假阳，不是腐烂。

**逐组裁定（2026-11-08T09:12Z 实读）**：

| 分组 | count | 末次写入 | 裁定 |
|---|---|---|---|
| `suite-end` | 1330 | 2026-11-08T09:06:44.869Z | 已自愈；静默期尾步，不是腐烂 |
| `suite-mirror` | 10 | 2026-11-07T08:35:15.303Z | 静默期前最后一条记录；写手 `worker-fan-in.ts:4189` 在，触发是「一次 suite 走完」，而 09:06 那一轮仍在恢复阶梯中未走完 ⇒ 触发条件尚未到达。自身节奏中位数 0.41h（10 条，2026-11-07T03:00→08:35） |
| `baseline-red` | 233 | 2026-11-06T22:53:49.018Z | **条件性不可达**：写手 `worker-fan-in.ts:3295` 在 `runBaselineEquivalence` 内，而带 `SUITE-INCOMPLETE` 标记的红轮在 `:3823` 就走恢复阶梯、根本不调用它（调用点在 `:4108`）。该组末次写入之后的 **6/6** 条 `suite-end ok:false` 都等到同 task 的 `suite-incomplete`（缺它的 = 0）⇒ A/B 结构上不可达，不是写手停摆 |
| `develop-red-set` | 51 | 2026-11-06T22:53:49.022Z | 同上——写手在同一函数的 `:3456`，与 `baseline-red` 同生同灭 |
| `suite-recovery-exhausted` | 1 | 2026-11-06T13:27:15.265Z | **罕见例外路径**：只在原轮并发 ≤ 地板 16 时写（`SUITE_RECOVERY_CONCURRENCY_LADDER=[64,48,32,16]`，`recoveryConcurrencySteps` 返回空 ⇒ `:3860` 分支），全历史 1 条；写手 `:3862` 在。按本仓裁定惯例属 `rare-by-design`，不作为本次立案的理由 |

**频次（硬规则 12）**：该载体历史上 ≥20h 的载体级静默 **6 次**，其中跨过 24h 阈值（会直接制造这一批假阳）的 **2 次**（`2026-11-03T08:11`→`11-04T08:41`，24.5h；`2026-11-07T08:35`→`11-08T08:57`，24.36h）。⇒ 不是一次性偶发。

**为什么这是仪器缺陷而不是数据缺陷**：Shape B 的判据是 `freshest - group.lastWrite > staleSeconds`（`instrument-decay-check.ts:1307-1320`），而 `freshest` 由**同一个载体的写手**产生。载体整体停摆时 `freshest` 与各分组一起停——这正是硬规则 4b 说的「由被测对象自己产生的量不能用来判断被测对象是否活着」：静默期读数干净（生产轮 `2026-11-07T14:44` / `20:45` / `2026-11-08T02:50` 三次实读 `decayedCount:0`），恢复瞬间读数爆炸，两个方向都不反映写手状态。

**同轮观察（本任务不覆盖，留痕以免再被当成新发现）**：09:06 那一轮进入恢复阶梯后，`suite-recovery` / `suite-recovery-blocked` / `suite-recovery-accepted` 三个分组的 `conditional-on-input` 条件命令在**阶梯在飞**时判 `exit 1`（`condition command did not hold — the declared cause is gone`），使 `decayedCount` 在 15 分钟内从 5 漂到 7。这是同一族「读数随管线相位闪烁」的第二个实例，修法不同（条件命令须容忍在飞的 incomplete），不在本任务的 AC 内。

**修法方向**：

1. **载体级静默读数（新状态，不与「健康」同形）**：对每个载体算记录时间轴上 ≥`staleSeconds` 的最大间隔。若某分组的 `lastWrite` 落在该间隔起点之前 `staleSeconds` 以内（静默前它还是新鲜的）、且静默结束后载体持续写入的时间 < `staleSeconds`，则该条 `rate-stopped` 的成因**无法与「整个管线停摆」区分** ⇒ 进独立读数（如 `idleWindowExplained[]`，每条带 `idleWindow:{from,to,ms}`），**不**计入 `decayedCount`、**也**不计入 `healthyCount`（硬规则 3b：第三态必须有自己的取值）。
   - **自过期**：静默结束后载体持续写满 `staleSeconds`，该分组若仍未写 ⇒ 自动回到 `decayed[]`。⛔ 不做永久豁免。
   - **负控制（同轮必证）**：某分组停写而其它分组一直在写（载体时间轴上没有 ≥`staleSeconds` 的间隔）⇒ 仍然报 `rate-stopped`。这次修改不得把检测器弄瞎。
2. **两条机器可读裁定**（沿用 `gap-fan-in-step-trace-rate-stopped-adjudication` 建立的 `adjudicated[]` 机制）：`baseline-red` / `develop-red-set` → `conditional-on-input`，条件命令读载体：该组末次写入之后，每条 `suite-end ok:false` 都必须等到同 task 的 `suite-incomplete`（`exit 0` ⇒ `explained-absent`；出现一条无 incomplete 的红 ⇒ `exit 1` ⇒ 仍报腐烂）。`suite-recovery-exhausted` → `rare-by-design`（ladder-at-floor），带 `reviewAfter`。
3. **可见性**：新读数必须进 `--json`、人面输出与 `quality-gate-driver` 的 `Fact`/`reason`——与既有 `adjudicatedCount` 同规矩：不算腐烂，但**不得**从读数里消失。

<!-- dedup-ref --> **dedup / prior-claim**（全部 DONE，已按 2026-11-08 的当前载体复核，故不构成「已修复」）：`gap-fan-in-step-trace-rate-stopped-adjudication`（同一载体同一形态，点的是另外 5 个分组；建立了 `adjudicated[]` 机制，本任务沿用）、`gap-instrument-decay-explained-absence-declarations`、`gap-instrument-decay-suite-recovery-groups-unadjudicated`、`gap-instrument-decay-suite-red-blocks-landing-steps-unadjudicated`（三次都是给另一批分组补声明）、`gap-fan-in-step-trace-suite-step-stopped-writing`（`suite-end` 上一次的立案；本次该组已在 `09:06:44` 重新写入 ⇒ 那一条对 `suite-end` 已经修好，本任务不重复点它）、`gap-instrument-decay-check-unwired-and-blind-to-content-dark`（把检测器接上生产）。当前 `todo` / `ready` / `needs-human` 里没有任何任务声明这条载体/形态（`tasks/` 全量扫过）。

## AC

- [ ] AC1（受控重放，真实记录）把真实载体按时间戳截成两个前缀（A 截止 `2026-11-07T20:45:16.160Z`，B 再包含到 `2026-11-08T08:57:05.523Z` 为止的记录），分别跑 `node --experimental-strip-types plugin/scripts/instrument-decay-check.ts --root <tmp> --carrier fan-in-step-trace.jsonl --json --no-block`：A 的 `decayedCount=0`，B 的 `decayedCount≥5` 且 `decayed[]` 含 `suite-end` / `baseline-red` / `develop-red-set` / `suite-mirror`。贴出两条命令、两个 `freshest` 与两段 `decayed[]`。判据可假：若载体被清空或记录缺 `ts`，读数改变。
- [ ] AC2（第三态：静默期成因与写手腐烂分开）实现后，在同一份真实载体上贴出读数：`decayed[]` 中不含任何「`lastWrite` 早于最近一次 ≥`staleSeconds` 载体级静默起点、且静默结束后持续写入 < `staleSeconds`」的分组；这些分组出现在独立读数（`idleWindowExplained[]` 或等价命名，每条带 `idleWindow.from` / `to` / `ms`），`decayedCount` 不计它们，`healthyCount` 也不计它们；`--json` 与人面输出各贴一段。
- [ ] AC3（负控制：写真手腐烂仍必须报）在 `plugin/test/instrument-decay-check.test.mjs` 增加一条对偶用例并贴出用例名：同一载体里一个分组停写、其它分组持续写且时间轴上没有 ≥`staleSeconds` 的间隔 ⇒ 该分组仍进 `decayed[]`。贴出该用例的红-绿：把新判据关掉时红、打开时绿。
- [ ] AC4（自过期，裁定不是隐身衣）贴出一条用例与一次读数：静默结束后载体持续写满 `staleSeconds` 而该分组仍未写 ⇒ 它从 `idleWindowExplained[]` 回到 `decayed[]`（⛔ 不存在永久豁免）。
- [ ] AC5（两条裁定，条件可证伪）在真实载体上跑 `baseline-red` / `develop-red-set` 的 `conditional-on-input` 条件命令：`exit 0` ⇒ `explained-absent`；负控制把窗口内任一 `suite-end ok:false` 视为「没有 incomplete」⇒ `exit 1` ⇒ 该组仍报 `rate-stopped`（贴出两个方向）。`suite-recovery-exhausted` 的 `rare-by-design` 声明带 `reviewAfter`，且 `adjudicated[]` 里逐组可见，`count` / `lastWrite` 为真实值。
- [ ] AC6（读数面可见）`quality-gate-driver` 的 `InstrumentDecayFactValue` 与 `reason` 带上新读数的计数（与 `adjudicatedCount` 同规矩）；贴出一次真实 root 上的 `runInstrumentDecayRound`（`halted:true`、零 spawn）读数片段。
- [ ] AC7（回归）`bash scripts/test.sh --for-task gap-instrument-decay-rate-stopped-blind-to-carrier-idle-window` 通过并贴出输出。

## DoD

- [ ] 真实载体上同时取到三种读数的证据：`decayed[]`（真腐烂仍被抓，AC3）、独立静默读数（AC2）、`adjudicated[]`（AC5）；三者互不冒充，且静默读数不计入健康载体数。
- [ ] `scripts/test.sh --for-task <id>` EXIT=0；新用例在把新判据关掉时红、打开时绿（AC3/AC4 的红-绿都贴出）。
- [ ] 落地后下一次真实 `instrument_decay` 质量轮次的 `reason` / `value` 里可见静默读数与裁定计数（待外部）

## Touches

- plugin/scripts/instrument-decay-check.ts
- plugin/test/instrument-decay-check.test.mjs
- plugin/scripts/quality-gate-driver.ts
- plugin/test/quality-gate-driver.test.mjs
- tasks/gap-instrument-decay-rate-stopped-blind-to-carrier-idle-window.md