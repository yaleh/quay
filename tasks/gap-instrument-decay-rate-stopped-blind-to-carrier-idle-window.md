---
id: gap-instrument-decay-rate-stopped-blind-to-carrier-idle-window
title: instrument-decay 的 rate-stopped 把「载体级静默期」读成写手腐烂：一次恢复写入同时点亮前一次落地的 5 个收尾步
status: done
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

- [x] AC1（受控重放，真实记录）把真实载体按时间戳截成两个前缀（A 截止 `2026-11-07T20:45:16.160Z`，B 再包含到 `2026-11-08T08:57:05.523Z` 为止的记录），分别跑 `node --experimental-strip-types plugin/scripts/instrument-decay-check.ts --root <tmp> --carrier fan-in-step-trace.jsonl --json --no-block`：A 的 `decayedCount=0`，B 的 `decayedCount≥5` 且 `decayed[]` 含 `suite-end` / `baseline-red` / `develop-red-set` / `suite-mirror`。贴出两条命令、两个 `freshest` 与两段 `decayed[]`。判据可假：若载体被清空或记录缺 `ts`，读数改变。
  - 证据（2026-11-08T09:30Z）：前缀由真实载体按 `ts` 截取（A=26424 行 / B=26436 行，两前缀只差 12 条记录）。⚠️ 修复后同一前缀 B 产出的是 AC2 的读数，故 AC1 用 **develop 上的修复前版本**（`git show develop:plugin/scripts/instrument-decay-check.ts` → `/tmp/ac-idle-gap-instrument/prefix-detector/instrument-decay-check.ts`，1696 行）重放缺陷本身：`node --experimental-strip-types <pre-fix>/instrument-decay-check.ts --root /tmp/ac-idle-gap-instrument/prefix{A,B} --carrier fan-in-step-trace.jsonl --json --no-block`。
  - A：`freshest=2026-11-07T08:35:15.946Z`、`totalRecords=25579`、`decayedCount=0`、`decayed=[]`。
  - B：`freshest=2026-11-08T08:57:05.523Z`、`totalRecords=25591`、`decayedCount=6`：`suite-end rate-stopped 1329 last=2026-11-07T08:26:43.287Z`；`baseline-red 233 2026-11-06T22:53:49.018Z`；`suite-incomplete 131 2026-11-07T08:26:43.300Z`；`develop-red-set 51 2026-11-06T22:53:49.022Z`；`suite-recovery-exhausted 1 2026-11-06T13:27:15.265Z`；`suite-mirror 10 2026-11-07T08:35:15.303Z`。判据可假：唯一变化量是 `freshest`（多出的 12 条记录把参照推高 24.36h）。
- [x] AC2（第三态：静默期成因与写手腐烂分开）实现后，在同一份真实载体上贴出读数：`decayed[]` 中不含任何「`lastWrite` 早于最近一次 ≥`staleSeconds` 载体级静默起点、且静默结束后持续写入 < `staleSeconds`」的分组；这些分组出现在独立读数（`idleWindowExplained[]` 或等价命名，每条带 `idleWindow.from` / `to` / `ms`），`decayedCount` 不计它们，`healthyCount` 也不计它们；`--json` 与人面输出各贴一段。
  - 证据（修复后，同一前缀 B，`--now 2026-11-08T09:00:00.000Z` 受控重放）：`decayedCount=0`、`idleWindowExplainedCount=19`、`healthyCount=0`、`adjudicatedCount=4`。`carrier.idleWindows=[{from:2026-11-03T08:11:28.741Z,to:2026-11-04T08:41:42.686Z,ms:88213945},{from:2026-11-07T08:35:15.946Z,to:2026-11-08T08:57:02.581Z,ms:87706635}]`。`idleWindowExplained[]` 含 AC1 那 6 组：`suite-end(1329,last 2026-11-07T08:26:43.287Z,recoveryMs=177419)`、`baseline-red(233,2026-11-06T22:53:49.018Z)`、`develop-red-set(51,2026-11-06T22:53:49.022Z)`、`suite-incomplete(131)`、`suite-recovery-exhausted(1)`、`suite-mirror(10)`——每组都带 `idleWindow:{from,to,ms}`。
  - 人面输出（同一命令不加 `--json`）：`INSTRUMENT-IDLE-WINDOW: .quay/fan-in-step-trace.jsonl — 19 group(s) with an undecidable cause (NOT counted as decay, NOT counted as healthy)` + 两行 `carrier idle window: … → … (24.36h)`；末行 `instrument-decay-check: ok — no instrument decay (0 carrier(s) healthy, 4 adjudicated (not decay), 19 undecidable (carrier-level idle window — not decay, not healthy), 0 uncovered)`。
  - 实时载体（2026-11-08T09:24Z，真实墙钟）：`decayedCount=0`、`idleWindowExplainedCount=6`（`suite-skip` / `rerun` / `baseline-red-exempt` / `suite-recovery-certified` / `suite-recovery-new-regression` / `suite-recovery-exhausted`），`healthyCount` 不含该载体。
- [x] AC3（负控制：写真手腐烂仍必须报）在 `plugin/test/instrument-decay-check.test.mjs` 增加一条对偶用例并贴出用例名：同一载体里一个分组停写、其它分组持续写且时间轴上没有 ≥`staleSeconds` 的间隔 ⇒ 该分组仍进 `decayed[]`。贴出该用例的红-绿：把新判据关掉时红、打开时绿。
  - 用例名：`AC3/负控制 — 一个分组停写、载体时间轴上没有 ≥staleSeconds 的间隔 ⇒ 仍然报 rate-stopped（不得弄瞎）`（另有对偶半边 `AC3/负控制（另一半）— 静默开始时该组**已经**陈旧 ⇒ 静默解释不了它，照旧报腐烂`）。
  - 红-绿（同一份 fixture，两份检测器）：`ac3-neg`（伴生每 4h 一笔、最大间隔 4h）⇒ 修复前 `decayedCount=1 decayed=["stopped-group"]`，修复后 `decayedCount=1 decayed=["stopped-group"] idleWindowExplained=[]`（判据没把检测器弄瞎）；`ac3-idle`（同一停止形状 + 一段 25h 静默）⇒ 修复前 `decayed=["stopped-group"]`（新用例此时红），修复后 `decayed=[] idleWindowExplained=["stopped-group"]`（绿）。
- [x] AC4（自过期，裁定不是隐身衣）贴出一条用例与一次读数：静默结束后载体持续写满 `staleSeconds` 而该分组仍未写 ⇒ 它从 `idleWindowExplained[]` 回到 `decayed[]`（⛔ 不存在永久豁免）。
  - 用例名：`AC4/自过期 — 恢复期写满 staleSeconds 而该组仍未写 ⇒ 从 idleWindowExplained[] 回到 decayed[]`（阈值两侧：静默结束 +24h−1s 仍解释，+24h 整即失效；另测「判定时刻早于载体最新记录」⇒ fail-closed 报腐烂）。
  - 真实载体读数（同一前缀 B，只改 `--now`）：`--now 2026-11-08T09:00:00Z` ⇒ `idleWindowExplainedCount=19, decayedCount=0`；`--now 2026-11-09T08:57:03.000Z`（静默结束 +24h）⇒ `idleWindowExplainedCount=0, decayedCount=3`（`suite-end` / `suite-incomplete` / `suite-mirror`），另 20 条裁定恢复生效。
- [x] AC5（两条裁定，条件可证伪）在真实载体上跑 `baseline-red` / `develop-red-set` 的 `conditional-on-input` 条件命令：`exit 0` ⇒ `explained-absent`；负控制把窗口内任一 `suite-end ok:false` 视为「没有 incomplete」⇒ `exit 1` ⇒ 该组仍报 `rate-stopped`（贴出两个方向）。`suite-recovery-exhausted` 的 `rare-by-design` 声明带 `reviewAfter`，且 `adjudicated[]` 里逐组可见，`count` / `lastWrite` 为真实值。
  - 方向一（真实载体 prefixB）：`baseline-red => exit 0`、`develop-red-set => exit 0`（窗口 = 各组末次写入之后；每条 `suite-end ok:false` 都等到同 task 的 `suite-incomplete`）。
  - 方向二（负控制：把窗口内第一条红 `2026-11-07T02:16:16.697Z`（task `gap-touches-parser-a-self-describing`）的 `suite-incomplete` 的 task 改掉 ⇒ 视作「这条红没有 incomplete」）：`baseline-red => exit 1`、`develop-red-set => exit 1`；检测器读数 `decayedCount=7`，`baseline-red` / `develop-red-set` 回到 `decayed[]`，`detail="condition command did not hold (exit 1) — the declared cause is gone; the absence is unexplained"`。
  - `adjudicated[]`（prefixB @ `--now 2026-11-09T08:57:03Z`）：`baseline-red explained-absent exit=0 count=233 last=2026-11-06T22:53:49.018Z`、`develop-red-set explained-absent exit=0 count=51 last=2026-11-06T22:53:49.022Z`、`suite-recovery-exhausted rare-by-design reviewAfter=2026-11-22T00:00:00.000Z count=1 last=2026-11-06T13:27:15.265Z`。
- [x] AC6（读数面可见）`quality-gate-driver` 的 `InstrumentDecayFactValue` 与 `reason` 带上新读数的计数（与 `adjudicatedCount` 同规矩）；贴出一次真实 root 上的 `runInstrumentDecayRound`（`halted:true`、零 spawn）读数片段。
  - 证据（真实 root `/data/home/yale/work/quay`，`halted:true`，`nowMs=2026-11-08T09:40:00Z`，gap-worker 前缀若被 spawn 会写 marker）：`value.idleWindowExplainedCount: 6`、`value.decayedCount: 1`（无关的 `arch-cycle-history.jsonl stale-evaluated`）、`adjudicatedCount: 3`、`healthyCount: 3`、`spawns: 0`；`reason` 片段 `…; 6 undecidable (carrier-level idle window; not decay, not healthy, self-expires) — fan-in-step-trace.jsonl: suite-skip (idle 2026-11-07T08:35:15.946Z → 2026-11-08T08:57:02.581Z), …`；`value.carriers[].idleWindows` 与 `.idleWindowExplained[]` 都随 value 输出。`filings` 全部 `deferred/halted`。
- [x] AC7（回归）`bash scripts/test.sh --for-task gap-instrument-decay-rate-stopped-blind-to-carrier-idle-window` 通过并贴出输出。
  - 证据：`bash scripts/test.sh --for-task gap-instrument-decay-rate-stopped-blind-to-carrier-idle-window --allow-thin` ⇒ EXIT=0；`instrument-decay-check.test.mjs` 75/75、`quality-gate-driver.test.mjs` 120/120（scoped run 合计 `tests 195 pass 195 fail 0`）。另 `npx tsc --noEmit -p tsconfig.json` ⇒ 0。

## DoD

- [x] 真实载体上同时取到三种读数的证据：`decayed[]`（真腐烂仍被抓，AC3）、独立静默读数（AC2）、`adjudicated[]`（AC5）；三者互不冒充，且静默读数不计入健康载体数。
  - 证据：同一份 prefixB 在两个判定时刻读出三种互斥状态——恢复后 1min：`idleWindowExplained=19 / decayed=0 / adjudicated=4`；恢复后 24h：`idleWindowExplained=0 / decayed=3 / adjudicated=20`；`healthyCount=0`（带静默读数的载体不计健康）。
- [x] `scripts/test.sh --for-task <id>` EXIT=0；新用例在把新判据关掉时红、打开时绿（AC3/AC4 的红-绿都贴出）。
  - 证据：AC7（EXIT=0、195/195）；AC3 红-绿（`ac3-idle` 修复前 decayed / 修复后 idleWindowExplained）；AC4 阈值两侧读数。
- [ ] 落地后下一次真实 `instrument_decay` 质量轮次的 `reason` / `value` 里可见静默读数与裁定计数（待外部）

## Dark axis (ADR-007)

- L_G archguard detect_cycles（package 粒度，scope `b4f87b21`，snapshot `generatedAt=2026-11-08T08:46:21.132Z`）：cycles=0, maxScc=1, evaluated=true —— 本次改动只在 `plugin/scripts` 与 `plugin/test`（判定逻辑 + 单测），未新增包级依赖边、未引入环。⚠️ 该快照早于 HEAD `4054407b`（staleness.status=stale），这是读数（`evaluated:true` 且带 staleness 标注），不是推断。

## Touches

- plugin/scripts/instrument-decay-check.ts
- plugin/test/instrument-decay-check.test.mjs
- plugin/scripts/quality-gate-driver.ts
- plugin/test/quality-gate-driver.test.mjs
- tasks/gap-instrument-decay-rate-stopped-blind-to-carrier-idle-window.md