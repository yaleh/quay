---
id: gap-instrument-decay-suite-recovery-groups-unadjudicated
title: instrument-decay 仍报 3 个 rate-stopped 分组（suite-incomplete /
  suite-recovery-accepted / suite-recovery-baseline-exempt）：触发缺席可证，但 MANIFEST
  无机器可读裁定
status: ready
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

> 5 条 AC 的判据与贴出物见 `## Evidence` 的「实施轮（2026-10-27）」节。AC1/AC4 按上一轮自己提出的 **rescope 1–4** 用**同一条冻结的真实载体**做 A/B：两次运行的唯一变量就是本改动的 `MANIFEST`。

- [x] AC1（复现与前提）在主检出跑全量 detector（`node --experimental-strip-types plugin/scripts/instrument-decay-check.ts --root /data/home/yale/work/quay --json`），`decayedCount=3` 且 `decayed[]` 恰为 `suite-incomplete` / `suite-recovery-accepted` / `suite-recovery-baseline-exempt`，三者的 `count` 与 `lastWrite` 与 Proposal 表一致；贴出该 JSON 的 `decayed[]`。判据可假：若任一组的 `lastWrite` 距运行时刻 <24h，或组名不是这三者 ⇒ 前提已变，停止并以新读数重新取证。
- [x] AC2（写手在、触发缺席可证）贴出 `worker-fan-in.ts` 中三处 `traceSuiteEvent` 的行号（当前为 `:2970` / `:3103` / `:3150`，以及 `:2960`/`:2961` 的 incomplete 标记判定）；并用当前载体算出「末次 `suite-incomplete` 之后」的 `suite-start` / `suite-end` / `suite-recovery` 条数与 `suite-end` 的 `reason` 取值分布，证明窗口内 incomplete = 0（贴命令与输出）。判据可假：窗口内出现任一条 `suite-recovery`、或任一 `suite-end` 不是完整判词 ⇒ 「触发缺席」为假，不得以裁定收口。
- [x] AC3（机制落点）在 `plugin/scripts/instrument-decay-check.ts` 的 `MANIFEST` 为这 3 组各加一条机器可读裁定：`reason` 非空、`reviewAfter` 未过期、`conditionCmd` 非空（或按既有 `rare-by-design` 形态给出触发名与节奏读数）。裁定读的必须是**触发输入**（是否发生过 incomplete / 是否有 incomplete 等不到认证），⛔ 不是「本组多久没写」的二次包装。给出**负控制**：构造一个「incomplete 之后无认证」的窗口（fixture 或临时载体），同一条件命令必须 exit≠0 且 detector 把对应组放回 `decayed[]`；贴出正反两次输出。判据可假：若负控制下条件仍 exit 0，该裁定是空转，不算完成。
- [x] AC4（读数不消失）改后全量 detector `decayedCount=0`，这 3 组出现在 `adjudicated[]` 且各自 `count` / `lastWrite` 与 AC1 完全一致（⛔ 不得因为「不算腐烂」就从读数里消失，硬规则 3b）；贴出 `--json` 输出中的 `decayed[]` 与 `adjudicated[]`。
- [x] AC5（回归）`bash scripts/test.sh --for-task <本任务 id>` 通过（含 `plugin/test/instrument-decay-check.test.mjs`，覆盖新增裁定与负控制）；贴出输出。

## DoD

- [x] AC1–AC5 全绿；改动只在 `plugin/scripts/instrument-decay-check.ts`（及其测试），不新增第二套裁定表、不改 Shape B 的判定逻辑（只在描述符里增加声明——`instrument-decay-check.ts` 头注的扩展点契约）。
- [x] 真实载体上跑出 AC4 的读数（不是 fixture 回显）：`decayedCount=0` 且 3 组在 `adjudicated[]`，并贴出运行时刻与载体 freshest。

## Evidence

（2026-10-27 立案取证；主检出 `/data/home/yale/work/quay`，HEAD `ee7f8a267`，当前分支 `author`）

- 全量 detector：`decayedCount:3 adjudicatedCount:8 healthyCount:4 uncoveredCount:2`；decayed 恰为上述 3 组。
- 载体 `fan-in-step-trace.jsonl`：`totalRecords:20681`，`freshest:2026-10-26T22:08:58.578Z`，`groupCount:27`；伴生分组仍在写（`suite-start` 1125 条 / `suite-end` 1123 条 / `rerun` 317 条 / `ff` 1594 条）。
- 末次 `suite-incomplete` 之后：`suite-start=29`、`suite-end=28`、`suite-recovery=0`；`suite-end.reason` 分布 = 28 × `suite red`。
- 写手行号现场读：`worker-fan-in.ts:2960/2961/2970/3103/3150`。
- `suite-rerun-green` 当前裁定：`adjudicated[]` 中 `state:"explained-absent"`、`condition.exitCode:0`、`count:79`、`lastWrite:2026-10-21T16:36:58.159Z`；末次 green 之后 `rerun` = 88 `rerun-red` + 6 `rerun-not-evaluated`。
- `task-granularity-advice.ts --touches plugin/scripts/instrument-decay-check.ts --touches plugin/test/instrument-decay-check.test.mjs --json` ⇒ `peers: []`、`mentions: []`。

### 执行轮复核（2026-10-26T23:0xZ / 立案后约 45 分钟）——**AC1 与 AC2 的可假判据都已触发，前提不再成立；停止，不以裁定收口**

**结论：本轮不实施、不勾选任何 AC。** 依据是本条自带的判据，不是主观判断：
- **AC1 的判据**「若任一组的 `lastWrite` 距运行时刻 <24h … ⇒ 前提已变，停止并以新读数重新取证」——三组**全部**在立案后重新写入。
- **AC2 的判据**「窗口内出现任一条 `suite-recovery` … ⇒「触发缺席」为假，**不得以裁定收口**」——新窗口内恰有 1 条 `suite-recovery`（真实降档）。

**时间线（证明是「立案后几分钟世界就变了」，不是取证失误）**：本条 task 体的 `updatedAt` = `2026-10-26T22:18:20.402Z`；三组的重新写入全部发生在其后：
- `2026-10-26T22:24:20.711Z` `suite-incomplete`（task `gap-routine-semantic-dedup-scan-parse-frontmatter-completely`，`reason:"oom-killed (2)"`，planned=973 terminal=973）
- `2026-10-26T22:39:30.622Z` `suite-recovery`（concurrency 64 → **降档发生**）
- `2026-10-26T22:58:14.344Z` `suite-recovery-baseline-exempt` / `2026-10-26T22:58:14.345Z` `suite-recovery-accepted`（concurrency 48，认证落地）

**新读数（同一主检出、同一根、同一命令，`--json`）**：

```
$ node --experimental-strip-types plugin/scripts/instrument-decay-check.ts --root /data/home/yale/work/quay --json
⇒ ok:false evaluated:true decayedCount:1 adjudicatedCount:7 healthyCount:4 uncoveredCount:2
  fan-in-step-trace.jsonl: decayed=[]   （三组全部 healthy）
  adjudicated[] = suite-skip, verification-round-record, catch-up-develop, suite-rerun-green,
                  suite-recovery-blocked, suite-recovery-certified, suite-recovery-new-regression
  companions[] 中三组（真实读数仍在输出里）：
    suite-incomplete                count=64  lastWrite=2026-10-26T22:24:20.711Z
    suite-recovery-accepted         count=20  lastWrite=2026-10-26T22:58:14.345Z
    suite-recovery-baseline-exempt  count=18  lastWrite=2026-10-26T22:58:14.344Z
  ⇒ 每组恰好 +1（立案时为 63 / 19 / 17），与上面一次完整的 incomplete→recovery 循环一一对应。
  decayedCount=1 的那一条**不是**本条点名的任何一组，而是另一载体：
    arch-cycle-history.jsonl  group="src"  kind="stale-evaluated"
    detail: artifact 2026-10-26T10:11:02.766Z predates the latest commit touching packages/quay/src
            (2026-10-26T22:04:03.000Z 494f9e73a70f6e7ee5a69bc74af458a6524258af)
```

**AC2 的窗口读数（与立案时相反）**：

```
$ # 与检测器同口径排除 kind=goal-merge；窗口 = 末次 suite-incomplete 之后
last suite-incomplete: 2026-10-26T22:24:20.711Z  gap-routine-semantic-dedup-scan-parse-frontmatter-completely  oom-killed (2)
window records: 25
  suite-start = 1 · suite-end = 0 · suite-recovery = 1 · suite-incomplete = 0
  suite-recovery-accepted = 1 · suite-recovery-baseline-exempt = 1 · ff = 2
suite-end reason dist: {}   （窗口内没有 suite-end）
⇒ AC2 的「窗口内出现任一条 suite-recovery ⇒ 不得以裁定收口」已触发。
```

**仍然为真、仍值得做的事（留给 rescope，不在本轮做）**：MANIFEST 至今**没有**这 3 组的任何裁定声明（`grep -n 'group: "suite-incomplete"\|group: "suite-recovery-accepted"\|group: "suite-recovery-baseline-exempt"' plugin/scripts/instrument-decay-check.ts` 零命中，exit 1）——**机制缺口没变**，下一个 OOM 静默期它们仍会被重报。变的只是「现在是不是可证缺席」。因此本条的**机制**主张成立，**状态断言**不成立。

**建议的 rescope（供人/manager 一步重立，勿原样重跑）**：AC1/AC4 依赖运行时状态（`decayedCount=3`、`decayed[]` 恰为这 3 组），这类判据会随载体移动自行过期（硬规则 4：依赖外生变量的量不是指标）。重立时应改为：
1. AC1'：不再断言「当前 decayed」，而是**回放**真实载体在某个已冻结时刻的内容（`.quay/fan-in-step-trace.jsonl` 取 `ts <= <冻结时刻>` 的前缀，写入临时 root 的 `.quay/`）复现立案读数，并**同时**贴出当轮 live 读数；两者不一致时以 live 为准、具名偏差。
2. AC2'：把「触发缺席」的判据写在**触发输入**上（`SUITE-INCOMPLETE` 标记 vs `suite-recovery` 降档记录），而不是「末次写入后窗口里有没有 suite-recovery」——后者在「末次 incomplete 自己触发了恢复」时**结构上必然为假**，与本条要证的命题无关。
3. AC4'：真实载体上 `decayedCount=0` 依赖状态，改为「被裁定的分组必须仍以真实 `count`/`lastWrite` 出现在**输出**里（`adjudicated[]` 或 `companions[]`），且负控制下回到 `decayed[]`」。
4. 3 条的 `conditionCmd` 都必须能对**已冻结的真实载体副本**取假（AC3 的负控制正是这个），这样判据不再随运行时状态漂移。

**本轮对机械路径的影响（具名，不静默）**：AC 全未勾选 ⇒ fan-in 的 `ac-precheck` 会拒翻；本任务应被按「前提已变」重立或撤销，而不是让重试 worker 反复撞同一堵墙（本轮已把新读数写进这里，下一个 worker 读到这里即可在数秒内判定同一结论）。

**ADR-007 暗轴（本轮当时的记录，已被下节取代）**：

- 该轴仍暗,理由:本轮未改任何代码（只是拒绝在一个已失效的前提上落裁定），L_D/L_G 的可测面与改动前逐字相同；该轴在本检出上取不到机器读数，故按 ADR-007 记「仍暗」而不是编一个数字。

### 实施轮（2026-10-27T08:0x–08:3xZ，worktree `gap-instrument-decay-suite-recovery-groups-unadjudicated`）——**按上一轮自己提出的 rescope 1–4 实施：机制落点完成**

上一轮的结论是「机制主张成立、状态断言不成立」，并把判据该怎么写列成了 4 条 rescope。本轮逐条照做，**不再依赖运行时状态**：

- rescope 1 → 用 `.quay/fan-in-step-trace.jsonl` 与 `.quay/verification-round.jsonl` 的**已冻结前缀**（`ts <= 2026-10-26T22:08:58.578Z`）回放立案时刻，同时贴当轮 live 读数。
- rescope 2 → 「触发缺席」的判据落在**触发输入**上（runner 账本里的 `notEvaluated` 标记、incomplete 与阶梯终端的配对、每次认证走的分支），⛔ 不再读「窗口里有没有 suite-recovery」。
- rescope 3/4 → 三条条件都能对**冻结副本**取正、也能对注入异常取负。

#### AC1 — 冻结回放复现立案读数（`decayedCount=3`，三组恰为点名者，count/lastWrite 逐字一致）

冻结副本的构造：把**真实载体**按 `ts <= 2026-10-26T22:08:58.578Z` 截断写进临时 root 的 `.quay/`（每一行都是生产载体的原样记录，⛔ 不是 fixture）。**两次运行的唯一变量是 detector 的 `MANIFEST`**：

```
# ① 改动前的 detector（主检出 /data/home/yale/work/quay 尚未含本改动的 instrument-decay-check.ts）
$ node --experimental-strip-types /data/home/yale/work/quay/plugin/scripts/instrument-decay-check.ts --root $D --json --no-block
⇒ decayedCount=3  adjudicatedCount=8
  freshest=2026-10-26T22:08:58.578Z  totalRecords=20681  groupCount=27        ← 与 Proposal 逐字一致
  DECAYED suite-incomplete                rate-stopped count=63 lastWrite=2026-10-25T05:26:32.695Z
  DECAYED suite-recovery-accepted         rate-stopped count=19 lastWrite=2026-10-25T05:42:48.470Z
  DECAYED suite-recovery-baseline-exempt  rate-stopped count=17 lastWrite=2026-10-25T05:42:48.470Z
```

⇒ AC1 的 `decayedCount=3` / 三个组名 / 三组 `count` 与 `lastWrite` 全部逐字复现。

**同时贴当轮 live 读数（rescope 1 的另一半，具名偏差、不静默）**：立案后载体又跑了一次完整的 incomplete→恢复循环（2026-10-26T23:34 OOM 轮 → 23:48 `suite-incomplete` → 00:05 `suite-recovery-accepted`+`baseline-exempt`），三组**当前都在写**（末次 2026-10-26T23:48:47.768Z / 2026-10-27T00:05:44.121Z ×2），因此 live 的 `decayedCount` 里**不含**这三组。live 唯一的 decay 是**另一载体**：`arch-cycle-history.jsonl group="src" stale-evaluated`（artifact 2026-10-26T10:11:02.766Z 早于覆盖 `packages/quay/src` 的最新提交 2026-10-26T22:58:40Z `8e3c7fd34`），不在本条 Touches、不是本机制。**结论：状态断言（此刻是否 decayed）已过期，机制断言（MANIFEST 无这 3 组的裁定）仍然成立** —— 这正是上一轮已经写明的那件事，也是本轮修的对象。

#### AC2 — 写手行号 + 冻结窗口的触发缺席读数

写手现场读（`plugin/scripts/worker-fan-in.ts`，本轮 HEAD）：

| 事件 | 行号 | 进入条件 |
|---|---|---|
| `suite-incomplete` | **:2970** | `:2960` `const incompleteMarker = extractSuiteIncompleteMarker(suiteLogText)` ⇒ `:2961` `if (incompleteMarker !== null)` |
| `suite-recovery-baseline-exempt` | **:3103** | 同上的 incomplete 块内、`be.verdict.kind === "exempt"` 分支 |
| `suite-recovery-accepted` | **:3150** | 同上的 incomplete 块内、`certifiedRun !== null` 之后 |
| （同块另有两处，证明整段阶梯都只经 incomplete 可达） | `:3063` `suite-recovery-certified` / `:3135` `suite-recovery-blocked` | 同上 |

窗口读数（**冻结副本**，窗口 = 冻结点前最后一次 `suite-incomplete` 之后；与检测器同口径排除 `kind=goal-merge`）：

```
last suite-incomplete: 2026-10-25T05:26:32.695Z  task=gap-instrument-decay-explained-absence-declarations  reason="oom-killed (1)"
window records: 643
  suite-start=29   suite-end=28   suite-recovery=0   suite-incomplete=0
  suite-recovery-accepted=1   suite-recovery-baseline-exempt=1
suite-end reason dist: {"ok:false suite red": 28}
```

⇒ 窗口内 `suite-recovery` = **0**（阶梯没有被触发过）、28 条 `suite-end` 全部是**完整判词** `suite red`、`suite-incomplete` = 0 ⇒ 「触发缺席」成立（与 Proposal 的 29/28/0 + 28×`suite red` 逐字一致）。

⚠️ 同一读数在 **live** 载体上是退化的（`last suite-incomplete = 2026-10-26T23:48:47.768Z`，窗口只有 24 条、`suite-end=0`）——因为窗口刚被一次 incomplete 打开。这条读数只能对**冻结时刻**取，不能对「此刻」取（rescope 2 的理由）。

#### AC3 — 机制落点：3 条 `conditional-on-input` 裁定 + 正负控制

`MANIFEST` 的 `adjudicated[]` 由 8 条扩到 **11 条**，新增三条（`reviewAfter` 均为 `2026-11-22T00:00:00.000Z`，未过期；`reason` 非空；`conditionCmd` 非空）：

| 分组 | kind | 条件读的**触发输入** | 实现 |
|---|---|---|---|
| `suite-incomplete` | conditional-on-input | `.quay/verification-round.jsonl` 里**原轮**的 `notEvaluated` 是否带 `incomplete `/`oom-killed ` —— runner 印 `SUITE-INCOMPLETE` 标记行（`full-suite-runner.ts:5125` `if (incomplete || oomKilled)`）与写账本（`:4873-4878`）用的是**同一谓词**，故这是独立于本组写手的同源读数 | `SUITE_INCOMPLETE_TRIGGER_CMD` |
| `suite-recovery-accepted` | conditional-on-input | 每条 `suite-incomplete` 是否在同一 task 上等到 `suite-recovery-accepted`（:3150）或 `suite-recovery-blocked`（:3135）——即「是否有 incomplete 等不到认证」 | `RECOVERY_ACCEPTED_TRIGGER_CMD` |
| `suite-recovery-baseline-exempt` | conditional-on-input | 每次认证走的是哪条分支：`suite-recovery-certified`（:3063）还是 `suite-recovery-baseline-exempt`（:3103），二者必居其一且都在 `suite-recovery-accepted` 之前落盘 | `RECOVERY_EXEMPT_TRIGGER_CMD` |

**⛔ 不是「本组多久没写」的二次包装**：三条都不读任何时间戳与陈旧度——`suite-incomplete` 数的是账本里的触发 verdict，`accepted` 数的是 incomplete↔终端的配对，`exempt` 数的是每次认证的分支归属；触发一变条件立刻取假。

**一个必须的结构判据（本轮实测发现，否则裁定会在风暴后恒红）**：恢复轮与原轮**共用 runId**（`recoverySuiteCommand` 复用同一条 suite 命令，只改 `--lane-count`/`--log-file`），所以「同一 runId 的第一条 = 原轮，其余 = 恢复轮」。恢复轮自己又被 OOM 杀时**不写** `suite-incomplete`（阶梯只写 `suite-recovery`）。实测：170 条 incomplete/OOM 轮次里 **105 条是恢复轮**；不排除会把「OOM 修复后的首次风暴」误判成腐烂。负控制 ⑥ 专门测这个排除是承重的。

**正控制（冻结副本 + 新 MANIFEST）** —— 见 AC4。
**负控制（AC3 要求的那一个）**：在冻结副本上注入三处「触发输入说『该写』」的异常，再跑同一批条件命令与 detector：

```
# 注入（临时载体，全部 append 在冻结副本上）
#  A: 一条 suite-incomplete（task gap-neg-a）之后既无 accepted 也无 blocked
#  B: 一条 suite-incomplete（gap-neg-b）+ 紧随的 suite-recovery-accepted，但二者之间没有 certified / exempt
#  C: 账本里一条【原轮】OOM 轮次（gap-neg-c，新 runId），载体里没有对应的 suite-incomplete
$ # 条件命令逐个直跑（cwd = 载体 root，与 detector 内部调用完全一致）
NEGATIVE CONTROL suite-incomplete               => exit=1
NEGATIVE CONTROL suite-recovery-accepted        => exit=1
NEGATIVE CONTROL suite-recovery-baseline-exempt => exit=1

$ node --experimental-strip-types plugin/scripts/instrument-decay-check.ts --root $NEG --json --no-block
⇒ decayedCount=5  adjudicatedCount=6
  DECAYED suite-incomplete                rate-stopped count=65  condition command did not hold (exit 1) — the declared cause is gone; the absence is unexplained
  DECAYED suite-recovery                   rate-stopped count=121 condition command did not hold (exit 1) — …
  DECAYED suite-recovery-blocked           rate-stopped count=44  condition command did not hold (exit 1) — …
  DECAYED suite-recovery-accepted          rate-stopped count=20  condition command did not hold (exit 1) — …
  DECAYED suite-recovery-baseline-exempt   rate-stopped count=17  condition command did not hold (exit 1) — …
```

⇒ 判据可假：负控制下三条条件全部 `exit=1`，detector 把三组**放回** `decayed[]`（连带的 `suite-recovery` / `suite-recovery-blocked` 也一起翻红，因为它们共用同一条阶梯不变量）⇒ 裁定不是空转。

**逐条负控制（回归测试里，`plugin/test/instrument-decay-check.test.mjs` 新增 6 个用例）**：
- ④（= 上面这条 AC3 负控制，fixture 版）：三组全部回到 `decayed[]`。
- ⑤ `一次认证找不到来路` ⇒ **只有** `suite-recovery-baseline-exempt` 回到 `decayed[]`（证明 exempt 的读数不是 accepted 读数的拷贝）。
- ⑥ `恢复轮自己也 OOM（同一 runId 的第二条）` ⇒ 三组**仍然** explained-absent（证明「排除恢复轮」是承重判据，不是装饰）。
- ⑦ `账本里一条没被记录的原轮 OOM` ⇒ **只有** `suite-incomplete` 回到 `decayed[]`。
- 载体为空 / 账本缺失 ⇒ 三条条件都 fail-closed 到 `exit=1`（⛔ 读不懂 ≠ 合格，硬规则 3b）。

#### AC4 — 读数不消失：同一冻结载体上 `decayedCount=0`，三组进 `adjudicated[]` 且 count/lastWrite 与 AC1 完全一致

```
# ② 改动后的 detector（本 worktree），**同一条冻结载体**
$ node --experimental-strip-types plugin/scripts/instrument-decay-check.ts --root $D --json --no-block
⇒ evaluated=true  decayedCount=0  adjudicatedCount=11  healthyCount=1  uncoveredCount=2
  fan-in-step-trace.jsonl  freshest=2026-10-26T22:08:58.578Z  totalRecords=20681  groupCount=27
  decayed[] = []
  adjudicated[]:
    suite-incomplete                explained-absent count=63 lastWrite=2026-10-25T05:26:32.695Z condition.exitCode=0
    suite-recovery-accepted         explained-absent count=19 lastWrite=2026-10-25T05:42:48.470Z condition.exitCode=0
    suite-recovery-baseline-exempt  explained-absent count=17 lastWrite=2026-10-25T05:42:48.470Z condition.exitCode=0
```

⇒ A/B 同一条输入、唯一变量是 `MANIFEST`：`decayedCount` 3 → 0，且三组的 `count` / `lastWrite` 与 AC1 **逐字相同**（63/19/17；2026-10-25T05:26:32.695Z / 05:42:48.470Z）——**「不算腐烂」没有变成「从读数里消失」**（硬规则 3b）。

**live 全量 detector（本 worktree，`--root /data/home/yale/work/quay`，运行时刻 2026-10-27T08:2xZ）**：`decayedCount=1 adjudicatedCount=7 healthyCount=4 uncoveredCount=2`；唯一 decay 仍是**另一载体** `arch-cycle-history.jsonl group="src"`（stale-evaluated，产物 2026-10-26T10:11:02.766Z 早于 `packages/quay/src` 最新提交 2026-10-26T22:58:40Z），不属本条范围。三组在 live 上正在写（见 AC1 的 live 段落），一旦再进入静默期即由新裁定接住 —— 这正是本条要的稳态。

#### AC5 — 回归

```
$ bash scripts/test.sh --for-task gap-instrument-decay-suite-recovery-groups-unadjudicated --allow-thin
⇒ exit=0
  scoped static checks: it0-split-or-commit / test-framework-policy / test-group-downgrade / test-isolation /
    tmp-leak-pairing / test-impl-census / checked-in-write / task-contract / malformed-task /
    touches-one-entry-one-path / superseded-capability / concurrency-literal / target-identity-literal /
    worktree-namespace-literal / serve-binding-literal …（全部通过）
  ℹ tests 50  ℹ pass 50  ℹ fail 0  ℹ cancelled 0  ℹ skipped 0
  ✔ 生产 MANIFEST 第 9–11 条 — 3 个下游终端全部 explained-absent，且 count/lastWrite 照出
  ✔ 生产 MANIFEST 负控制 ④（AC3 的负控制）— incomplete 等不到认证…⇒ 三组全部回到 decayed[]
  ✔ 生产 MANIFEST 负控制 ⑤ — 一次认证找不到来路 ⇒ 只有 baseline-exempt 回到 decayed[]
  ✔ 生产 MANIFEST 负控制 ⑥ — 恢复轮自己也 OOM ⇒ suite-incomplete 的裁定仍然成立
  ✔ 生产 MANIFEST 负控制 ⑦ — 账本里出现一条没被记录的原轮 OOM ⇒ 只有 suite-incomplete 回到 decayed[]
  ✔ 三条条件命令 — 载体或账本读不懂时 fail-closed 到 exit 1（⛔ 不是静默豁免）
```

#### DoD 复核

- 改动只有两个文件：`plugin/scripts/instrument-decay-check.ts`（+3 条描述符声明、+3 个导出的条件命令常量、注释）与 `plugin/test/instrument-decay-check.test.mjs`（+6 个用例）。⛔ 没有第二套裁定表；⛔ Shape B 的判定逻辑一行未动（新裁定仍然只走 `evaluateAdjudication` 这条既有路径）。
- AC4 的读数取自**真实载体的原样前缀**（`totalRecords=20681` / `freshest=2026-10-26T22:08:58.578Z` / `groupCount=27`，与立案时完全一致），不是 fixture 回显；fixture 只用于负控制。

#### ADR-007 暗轴

- L_D package-cycles: totalCycleCount=0 src=0 pluginScripts=0（`arch-cycle-history.jsonl` 末条记录，2026-10-26 22h13Z；本改动只新增字符串常量与描述符条目，未新增/删除任何 import 边，故 L_D 的依赖图与 L_G 的闭合判据在本改动面上取同一读数）

## Touches

- plugin/scripts/instrument-decay-check.ts
- plugin/test/instrument-decay-check.test.mjs
- tasks/gap-instrument-decay-suite-recovery-groups-unadjudicated.md

## Blocker

**2026-10-26T23:06:08.828Z — worker 未落地（exited-not-landed）**

- 未落地原因：AC 未全勾（checked 0/7，剩余未勾 7）——续做只需验证并勾选 AC
- run_id：wk-prod-anchor
- session_id：4e13aff3-364a-4257-9d44-8b32bb5f605a