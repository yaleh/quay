---
id: gap-fan-in-step-trace-rate-stopped-adjudication
title: fan-in-step-trace.jsonl 的 5 个 rate-stopped 分组：4
  个是罕见例外路径、suite-rerun-green 被持续基线红条件性遮蔽；Shape B 没有机器可读的「已裁定例外」
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

**现状读数**（2026-10-23，主检出 `/data/home/yale/work/quay`，`node --experimental-strip-types plugin/scripts/instrument-decay-check.ts --root . --carrier fan-in-step-trace.jsonl --json`）：载体仍在写（`evaluated:true`、`totalRecords:19022`、`freshest:2026-10-23T09:44:03.300Z`、`groupCount:27`），但下列 5 个分组末次写入比伴生分组老超过 24h，被报成 `rate-stopped`：

| 分组 | count | lastWrite (Z) | 本轮裁定 |
|---|---|---|---|
| `verification-round-record` | 7 | 2026-10-14T11:41:51 | 罕见例外路径 |
| `catch-up-develop` | 96 | 2026-10-10T19:13:58 | 罕见例外路径 |
| `suite-rerun-green` | 79 | 2026-10-21T16:36:58 | **常路径，被持续基线红条件性遮蔽** |
| `suite-recovery-certified` | 2 | 2026-10-21T04:50:38 | 罕见例外路径（当前由 baseline-exempt 出口取代） |
| `suite-recovery-new-regression` | 1 | 2026-10-22T01:41:45 | 罕见例外路径（真回归信号） |

**逐组现场取证（本轮已做，结论如上）**

1. `verification-round-record` —— 写手 `recordDelegatedRound(force)`（`plugin/scripts/worker-fan-in.ts:2831`，trace 在 `:2855`）只在 `hungByWatchdog || spawnFailed` 时补写。`.quay/verification-round.jsonl` 2961 轮中 `reason:"watchdog-killed"` 共 7 轮、`spawn-failed` 0 轮；最后一轮 `watchdog-killed` 的 `startedAt = 2026-10-14T11:21:43.476Z`，晚于该分组 lastWrite 的为 **0** ⇒ 触发事件没有发生，写手路径在。
2. `catch-up-develop` —— 只有 mergeTarget ≠ develop（goal 分支落地）才走这一步（`worker-fan-in.ts:2664`）。同一载体 `kind:"goal-merge"` 最后一次执行是 2026-10-10T19:27:53.409Z（GOAL-036），此后 **0** 次 ⇒ 没有 goal 分支落地这一输入。
3. `suite-rerun-green` —— **不是例外路径**：79 条、2026-10-11→10-21 每天多次；写手在 `worker-fan-in.ts:3169-3177`，与同函数写出的 `rerun` 事件同源。last green 之后 `rerun` 仍写 47 条（44 `rerun-red` + 3 `rerun-not-evaluated`），0 green。根因可从载体直接读出：`plugin/test/task-granularity-advice.test.mjs` 自 2026-10-21T22:50Z 起持续红，`ts > 2026-10-21T22:50Z` 的 **42** 条 `rerun-red` **每一条**都把该文件列在 `files[]` 里（缺它的 = 0）；该文件同时出现在 `.quay/baseline-red-rounds.jsonl` 的 **11** 条基线红签名中（首 2026-10-21T22:52:41Z、末 2026-10-23T04:46:49Z）⇒ 它是 develop 基线红，同一棵树上重跑它不可能变绿。绿分支因此在当前基线下**条件性不可达**，不是写手腐烂。
4. `suite-recovery-certified` —— 「恢复轮干净跑完」的终端分支（`worker-fan-in.ts:3048`）。2026-10-21T04:50Z 之后恢复流程仍发生 **7** 次，全部经另一终端分支 `suite-recovery-baseline-exempt`（7 条）落地并写 `suite-recovery-accepted`（7 条，最后 2026-10-23T06:39:00.873Z）⇒ 恢复机制在跑，只是 certified 触发未发生。
5. `suite-recovery-new-regression` —— 只在「原并发下通过的文件在更低并发下变红」时写（`worker-fan-in.ts:3067`），全历史 1 条 ⇒ 真回归信号，本身低频。

**缺陷（机制，不是症状）**：Shape B 的唯一判据是「末次写入比载体最新老超过 `--stale-seconds`」（`instrument-decay-check.ts:593-599`）。描述符里唯一承载人工裁定的字段是自由文本 `note`，**判定逻辑从不读它**。后果有三：
① 「按设计罕见」与「写手腐烂」在输出上同形（硬规则 3b），同一批分组每轮被重报为 `rate-stopped`；
② 「本轮已裁定」没有耐久、机器可读的落点 ⇒ 每个 decay 轮都要重新做一遍同样的取证（`gap-instrument-decay-check-unwired-and-blind-to-content-dark` 的现场记录里这些组就写着「尚未裁定」）；
③ `suite-rerun-green` 的**条件性不可达**（输入条件恒假）与真正的写手腐烂压成同一个 `rate-stopped`，掩盖了「基线红导致该分支不可达」这一真实读数。

**修法方向**：给 `CarrierSpec` 增加机器可读的裁定声明（例：`adjudicated: [{ group, kind: "rare-by-design" | "conditional-on-input", reason, preconditionCmd?, reviewAfter }]`）。Shape B 命中时：已声明且未过期 ⇒ 进独立读数（如 `adjudicated[]`），**不进 `decayed[]`、不计入 `decayedCount`**，但必须在输出里可见；`reviewAfter` 已过 ⇒ 回到 `decayed[]`（裁定不得永久化）。`suite-rerun-green` 用 `conditional-on-input` 声明其条件（点名红文件不在 develop 基线红集合）并给出可执行的条件读数命令：条件命令 exit 0 ⇒ 报 `explained-absent`；条件不成立 ⇒ 仍报腐烂。`quality-gate-driver` 的轮次 reason 同时写出 `adjudicated` 数量，⛔ 不得因为「不算腐烂」就从读数里消失。

<!-- dedup-ref --> 合并判断 = **separate**：open `gap-instrument-decay-dedup-reader-round-log-path`（todo）与本任务共享 `plugin/scripts/quality-gate-driver.ts`，但机制不同——那条修「读侧路径恒空 ⇒ 同一 pair 每轮重新 spawn」，本条修「Shape B 无法表达『已裁定例外』⇒ 读数本身把例外报成腐烂」。两者验收独立，由调度器按 Touches 串行；本任务不改变那条任务的去重语义。

**prior-claim**（DONE，均已在当前 HEAD 复核：载体仍暗，故不构成「已修复」）：
- `gap-instrument-decay-check-unwired-and-blind-to-content-dark`（done）—— 把检测器接上生产，并首次报出这批 rate-stopped 分组，但把它们留作「尚未裁定」。
- `gap-fan-in-step-trace-suite-step-stopped-writing`（done）—— 本载体 Shape B 腐烂的前一次立案（suite 决策步骤写手分裂）。
- `gap-suite-verdict-green-on-oom-killed-incomplete-run-lands-on-11-percent-of-files`（done）—— `suite-rerun-green` / `suite-recovery-certified` / `suite-recovery-new-regression` 三个写手的作者。
- `gap-in-round-suite-rerun-never-executed-in-production`（done）—— 让 `rerun` 在生产上真正执行。
- `gap-goal-branch-catch-up-develop-at-landing`（done）—— `catch-up-develop` 写手的作者。
- `gap-watchdog-killed-round-writes-no-verification-round-record`（done）—— `verification-round-record` 补写路径的作者。

## AC

- [x] AC1（现状复现）在主检出运行 `node --experimental-strip-types plugin/scripts/instrument-decay-check.ts --root . --carrier fan-in-step-trace.jsonl --json`：`carriers[0].evaluated === true`、`decayed[]` 含本任务点名的 5 个 `rate-stopped` 分组（若期间新增其它分组，逐一裁定并写回本任务），且 5 组的 `count` / `lastWriteMs` 与本 Proposal 表一致；贴出该 JSON 的 `carriers[0]` 片段。判据可假：分组恢复写入或载体被清空时该读数改变。
  **验收（2026-10-23T10:04Z 实读）**：判据取到了——`evaluated:true`、`totalRecords:19038`、`freshest:2026-10-23T10:03:54.501Z`、`groupCount:27`，5 组的 `count`/`lastWrite` 与 Proposal 表**逐条一致**（7/11:41:51.225Z、96/19:13:58.281Z、79/16:36:58.159Z、2/04:50:38.383Z、1/01:41:45.734Z），期间**未新增**其它 rate-stopped 分组。⚠️ 由于本任务的修法已落地，带裁定声明跑时这 5 组**不再**出现在 `decayed[]`（这正是修法要的结果）⇒ 上句的「现状复现」读数用**负控制**取：把同一份真实载体的声明删掉后重跑，得到的 `decayed[]` 即修复前的读数（片段见 Evidence ①）。这也正是 AC4 ② 的负控制 B，两处是同一次读数。
- [x] AC2（4 个例外路径的触发普查，全部为 0）逐条打印并断言：① `.quay/verification-round.jsonl` 中 `reason === "watchdog-killed"` 且 `startedAt > 2026-10-14T11:41:51Z` 的记录数 = 0（`spawn-failed` 全历史 = 0）；② 载体中 `kind === "goal-merge"` 且 `ts > 2026-10-10T19:13:58Z` 的记录数 = 0；③ 恢复终端读数 `suite-recovery-baseline-exempt` 与 `suite-recovery-accepted` 在 `ts > 2026-10-21T04:50:38Z` 各 ≥ 1（证明恢复机制在跑、只是 certified 触发未发生）；④ `suite-recovery-new-regression` 在 `ts > 2026-10-22T01:41:45Z` = 0。贴出四条命令与输出。
  **验收（实读，命令与输出见 Evidence ②）**：① `watchdog-killed` 7 轮、最后一轮 `startedAt=2026-10-14T11:21:43.476Z`；`startedAt > 2026-10-14T11:41:51Z` = **0**；`spawn-failed` 全历史 = **0**。③ `suite-recovery-baseline-exempt` 7 条、`suite-recovery-accepted` 8 条（均 > 04:50:38Z）⇒ ≥1 成立。④ 以该记录自己的毫秒边界 `2026-10-22T01:41:45.734Z` 计 = **0**（若照 AC 原文的秒级截断 `01:41:45Z` 会把这条自身计入得 1——边界必须取记录自己的精度）。⚠️ **② 的谓词已按实读修正（原文在该边界上不成立）**：`kind === "goal-merge"` 且 `ts > 2026-10-10T19:13:58Z` 的记录数是 **18**，不是 0；这 18 条**全部挂在同一个 `runId = gm-GOAL-036-1791660244969`**（19:24:04Z–19:27:53Z），即 19:13:58Z 那批 `catch-up-develop` 所在落地的**收尾步**（任务先落 `goal/GOAL-036`，该 goal 分支随后并入 develop），不是新的触发。改以「最后一次 goal 落地之后」为界：`ts > 2026-10-10T19:27:53.409Z` 的 goal-merge 记录 = **0**，且当前 `goal/*` 分支数 = **0**。实质结论（此后没有新的 goal 分支落地输入）不变，故本条判定为满足。
- [x] AC3（`suite-rerun-green` 的条件性不可达是读数）对 `ts > 2026-10-21T16:36:58Z` 的 47 条 `rerun` 记录做三段断言并贴出数字：① 状态分布 = 44 `rerun-red` + 3 `rerun-not-evaluated` + 0 `rerun-green`；② `ts > 2026-10-21T22:50Z` 的每一条 `rerun-red` 的 `files[]` 都含 `plugin/test/task-granularity-advice.test.mjs`，缺它的记录数 = 0；③ 同一文件在 `.quay/baseline-red-rounds.jsonl` 的签名中出现 11 次（首 2026-10-21T22:52:41Z、末 2026-10-23T04:46:49Z）⇒ 它是 develop 基线红。判据可假：若出现一条不含该基线红的 `rerun-red`，绿分支就可能可达，本裁定必须重做。
  **验收（实读，见 Evidence ③）**：① 以该记录自己的毫秒边界 `2026-10-21T16:36:58.159Z` 计，`ts >` 的 `rerun` 记录 = **47**，分布 **44 `rerun-red` + 3 `rerun-not-evaluated` + 0 `rerun-green`**（秒级截断会把 `suite-rerun-green` 与 `rerun` 的同一次 16:36:58.159Z 事件算进来，得 48/含 1 green ⇒ 边界取毫秒）；② `rerun-red` 42 条，**42/42** 含该文件，缺它的 = **0**；③ 该文件在基线红签名中出现 **11** 次，首 `2026-10-21T22:52:41.332Z`、末 `2026-10-23T04:46:49.015Z`。
- [x] AC4（检测器：机器可读裁定 + 三态 + 负控制）在真实载体上贴出三次读数：① 声明存在且未过期 ⇒ 5 组不出现在 `decayed[]`，而出现在独立的 `adjudicated[]`（每条带 `group` / `kind` / `reason` / `reviewAfter`），`decayedCount` 不计它们；② 负控制：删掉声明（或把 `reviewAfter` 改到过去）⇒ 同一批组回到 `decayed[]`；③ `suite-rerun-green` 的 `conditional-on-input` 在条件命令 exit 0 时输出 `explained-absent` 并附条件读数，负控制把该命令改成 `exit 1`（条件不成立）时仍报 `rate-stopped`。三项在 `plugin/test/instrument-decay-check.test.mjs` 各有对应用例；贴出 JSON 片段与用例名。
  **验收（三次读数全部在真实 `.quay/fan-in-step-trace.jsonl` 上，只改描述符的声明，见 Evidence ④）**：① `decayedCount=0`、`adjudicatedCount=5`、`decayed[]=[]`；5 条 `adjudicated[]` 各带 `group`/`kind`/`reason`/`reviewAfter` 与**真实 `count`/`lastWrite`**（7/96/79/2/1），`suite-rerun-green` 的 `state=explained-absent` 且 `condition.exitCode=0`。② 负控制 A（`reviewAfter` 改到 `2026-10-01`）与 B（删除声明）都回到 `decayedCount=5`，A 每条 `detail` 点名 `adjudication expired at ... — not a permanent exemption`。③ 生产条件命令 `exit 0` ⇒ `explained-absent`；把 `conditionCmd` 换成 `exit 1` ⇒ 该组回到 `decayed[]`、`detail = condition command did not hold (exit 1) — the declared cause is gone; the absence is unexplained`，其余 4 条裁定不受影响。对应用例（`node --test plugin/test/instrument-decay-check.test.mjs`，34/34 绿）：`裁定 — 声明存在且未过期：rare-by-design 进 adjudicated[] 而非 decayed[]，decayedCount 不计它`、`裁定负控制 — reviewAfter 已过（或删掉声明）⇒ 同一批组回到 decayed[]，且 detail 点名过期`、`裁定 — 读不懂的声明不产生豁免（无 reason / reviewAfter 读不出 / 未知 kind）`、`裁定 — conditional-on-input：条件命令 exit 0 ⇒ explained-absent 并附条件读数；exit 1 ⇒ 仍报 rate-stopped`、`生产 MANIFEST — 5 个 rate-stopped 分组全部被裁定（4 rare-by-design + 1 explained-absent），0 腐烂`、`生产 MANIFEST 负控制 — 最新的 rerun 变绿 ⇒ suite-rerun-green 的条件不成立 ⇒ 回到 decayed[]`、`CLI --json — 裁定在机器面上：decayedCount 不含它们，adjudicated[] 独立可见`。
- [ ] AC5（生产轮次读数，落地后）在合入 develop 之后的下一个真实 quality-gate `instrument_decay` 轮次上读 `.quay/quality-round.jsonl`：该轮 `reason` / `filings` 显示这 5 组不再计入 `decayed`（并可见 `adjudicated` 计数），且 pair `fan-in-step-trace.jsonl|rate-stopped` 的 filing 语义不被永久豁免。贴出该轮 `ts`、`reason`、`filings` 与窗口起点晚于的落地提交 sha。落地前已取到的最近读数（≠本条，只证明轮次逻辑；详据见 Evidence ⑤）：`runInstrumentDecayRound` 在真实 root 上得 `state=verified`、`decayedCount=0`、`adjudicatedCount=5`、`filings=0`（待外部）

## DoD

- [x] AC1-AC4 全绿；`scripts/test.sh --for-task gap-fan-in-step-trace-rate-stopped-adjudication` 通过；贴出输出。
  **验收**：`bash scripts/test.sh --for-task gap-fan-in-step-trace-rate-stopped-adjudication --allow-thin` **EXIT=0**（scoped static checks 全过 + 命中文件 150 tests / 150 pass / 0 fail；log 落在 `/data/home/yale/work/quay-scratch/ac-adj-evidence/scoped-gate.log`）。另外两个目标文件单跑：`instrument-decay-check.test.mjs` 34/34、`quality-gate-driver.test.mjs` 116/116。
- [x] 裁定是**可过期**的：`reviewAfter` 已过的声明必须重新进入 `decayed[]`（AC4 ② 即该判据），⛔ 不提供永久豁免开关。
  **验收**：`reviewAfter` 是 `Adjudication` 的**必填**字段；读不出 ⇒ 不豁免（`adjudication reviewAfter ... is unreadable`）；已过 ⇒ 不豁免（`adjudication expired at ... — re-review it`）；缺 `reason` ⇒ 不豁免。三种拒绝路径各有单测（`裁定 — 读不懂的声明不产生豁免`、`裁定负控制 — reviewAfter 已过`），且真实载体上的负控制 A 已被 AC4 ② 贴出。没有「留空即永久」的入口。
- [ ] AC5 的生产读数已贴出（待外部）

## Touches

- plugin/scripts/instrument-decay-check.ts
- plugin/test/instrument-decay-check.test.mjs
- plugin/scripts/quality-gate-driver.ts
- plugin/test/quality-gate-driver.test.mjs
- tasks/gap-fan-in-step-trace-rate-stopped-adjudication.md

## Evidence

**① AC1 的修复前读数（同一份真实载体，删掉声明后的负控制）**

```
{ "file": "fan-in-step-trace.jsonl", "evaluated": true, "totalRecords": 19038,
  "freshest": "2026-10-23T10:03:54.501Z", "groupCount": 27, "decayedCount": 5,
  "decayed": [
    { "group": "verification-round-record",      "kind": "rate-stopped", "count": 7,  "lastWrite": "2026-10-14T11:41:51.225Z" },
    { "group": "catch-up-develop",               "kind": "rate-stopped", "count": 96, "lastWrite": "2026-10-10T19:13:58.281Z" },
    { "group": "suite-rerun-green",              "kind": "rate-stopped", "count": 79, "lastWrite": "2026-10-21T16:36:58.159Z" },
    { "group": "suite-recovery-certified",       "kind": "rate-stopped", "count": 2,  "lastWrite": "2026-10-21T04:50:38.383Z" },
    { "group": "suite-recovery-new-regression",  "kind": "rate-stopped", "count": 1,  "lastWrite": "2026-10-22T01:41:45.734Z" } ] }
```

**② AC2 的四条触发普查（真实载体实读）**

```
②-a  verification-round total: 2963 | watchdog-killed: 7 | last startedAt: 2026-10-14T11:21:43.476Z
②-b  watchdog-killed with startedAt > 2026-10-14T11:41:51Z: 0 | spawn-failed all-history: 0
②-c  goal-merge total: 296 | last ts: 2026-10-10T19:27:53.409Z
②-d  goal-merge with ts > 2026-10-10T19:13:58Z: 18 | distinct runIds: gm-GOAL-036-1791660244969   ← 同一次 GOAL-036 落地的收尾步
②-e  goal-merge with ts > 2026-10-10T19:27:53.409Z (after the last goal landing): 0
②-f  suite-recovery-baseline-exempt: total=7 after 2026-10-21T04:50:38Z=7 last=2026-10-23T06:39:00.873Z
②-f  suite-recovery-accepted:        total=9 after 2026-10-21T04:50:38Z=8 last=2026-10-23T06:39:00.873Z
②-f  suite-recovery-new-regression:  total=1 … 以该记录自己的毫秒边界 2026-10-22T01:41:45.734Z 计：0
     goal/* branches: 0
```

**③ AC3 的三段断言（真实载体实读）**

```
③-① rerun strictly after 2026-10-21T16:36:58.159Z: 47 {"rerun-not-evaluated":3,"rerun-red":44}
③-② rerun-red after 2026-10-21T22:50Z: 42 | naming plugin/test/task-granularity-advice.test.mjs: 42 | missing: 0
③-③ baseline-red signatures naming the file: 11 | first: 2026-10-21T22:52:41.332Z | last: 2026-10-23T04:46:49.015Z
```

**④ AC4 的三次真实载体读数（只改描述符的声明）**

```
① live declarations   : decayedCount=0 adjudicatedCount=5 exitWouldBe=0  decayed[]=[]
                        adjudicated[]: verification-round-record/rare-by-design(7), catch-up-develop/rare-by-design(96),
                                       suite-rerun-green/explained-absent(79, conditionExit=0),
                                       suite-recovery-certified/rare-by-design(2), suite-recovery-new-regression/rare-by-design(1)
② neg-control A       : reviewAfter→2026-10-01 ⇒ decayedCount=5 adjudicatedCount=0 exitWouldBe=1
                        (detail: "adjudication expired at 2026-10-01T00:00:00.000Z — re-review it (an adjudication is not a permanent exemption)")
② neg-control B       : declarations deleted ⇒ decayedCount=5 adjudicatedCount=0 exitWouldBe=1
③ cond exit 0         : suite-rerun-green state=explained-absent condition.exitCode=0
③ neg-control exit 1  : suite-rerun-green back in decayed[] (decayedCount=1), detail="condition command did not hold (exit 1) — the declared cause is gone; the absence is unexplained"; 其余 4 条仍 adjudicated
```

**⑤ 生产例程的轮次读数（落地前，真实 root，`halted:true` 零 spawn）**

```
state: verified
reason: no instrument decay; 5 adjudicated (not decay; reviewAfter-bounded) — fan-in-step-trace.jsonl: verification-round-record (rare-by-design), … suite-rerun-green (explained-absent), … suite-recovery-new-regression (rare-by-design); 2 uncovered carrier(s) NOT counted healthy (…)
value.decayedCount: 0   value.adjudicatedCount: 5   value.filings: 0
```

**实现落点**：`plugin/scripts/instrument-decay-check.ts`（`CarrierSpec.adjudicated` / `Adjudication` / `AdjudicatedFinding` / `evaluateAdjudication`；Shape B 命中后先问裁定；`analyzeAll` 聚合 `adjudicatedCount`；人面 `INSTRUMENT-ADJUDICATED:` 与 JSON `adjudicated[]`）、`plugin/scripts/quality-gate-driver.ts`（Fact 带 `adjudicatedCount` + 每载体 `adjudicated`；`verified`/`instrument-dark` 两条 reason 都点名裁定数，⛔ 不因「不算腐烂」而消失）。

**条件命令的设计注记**：`suite-rerun-green` 的条件读的是**载体尾部最后一条 `rerun` 记录**（它仍 `rerun-red` 且点名该基线红文件 ⇒ exit 0），而不是 append-only 的 `.quay/baseline-red-rounds.jsonl`——后者只增不减，一旦为真就永远为真，是单向闩锁而不是读数（硬规则 4）。任一方向的变化（变绿 / 不再点名该文件）都会让条件立刻不成立。

**ADR-007 暗轴记录**
- L_G：该轴仍暗,理由：本任务只改一个检测器的判定逻辑与其生产接线（无新增/移动模块、无包依赖结构变化），L_D/L_G 的可测结构面在本切片上没有可归因的位移。

**硬规则 5b 自查**：修完 `quality-gate-driver` 的读数面后，在同一载体里 grep 了「裁定/decayed 计数」的其它适用点——`readPriorInstrumentDecayFilings`（去重输入）、`buildInstrumentDecayGapWorkerPrompt`（立案 prompt）与 `formatInstrumentDecayAssembly`（启动日志）三处；前两处按 pair 构造，adjudicated 分组不进 `decayed` ⇒ 本来就不在 pair 集合里（无需改动，且这正是「不被永久豁免」的机制）；第三处已补上 adjudication 的说明。
