---
id: gap-fan-in-step-trace-rate-stopped-adjudication
title: fan-in-step-trace.jsonl 的 5 个 rate-stopped 分组：4
  个是罕见例外路径、suite-rerun-green 被持续基线红条件性遮蔽；Shape B 没有机器可读的「已裁定例外」
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

- [ ] AC1（现状复现）在主检出运行 `node --experimental-strip-types plugin/scripts/instrument-decay-check.ts --root . --carrier fan-in-step-trace.jsonl --json`：`carriers[0].evaluated === true`、`decayed[]` 含本任务点名的 5 个 `rate-stopped` 分组（若期间新增其它分组，逐一裁定并写回本任务），且 5 组的 `count` / `lastWriteMs` 与本 Proposal 表一致；贴出该 JSON 的 `carriers[0]` 片段。判据可假：分组恢复写入或载体被清空时该读数改变。
- [ ] AC2（4 个例外路径的触发普查，全部为 0）逐条打印并断言：① `.quay/verification-round.jsonl` 中 `reason === "watchdog-killed"` 且 `startedAt > 2026-10-14T11:41:51Z` 的记录数 = 0（`spawn-failed` 全历史 = 0）；② 载体中 `kind === "goal-merge"` 且 `ts > 2026-10-10T19:13:58Z` 的记录数 = 0；③ 恢复终端读数 `suite-recovery-baseline-exempt` 与 `suite-recovery-accepted` 在 `ts > 2026-10-21T04:50:38Z` 各 ≥ 1（证明恢复机制在跑、只是 certified 触发未发生）；④ `suite-recovery-new-regression` 在 `ts > 2026-10-22T01:41:45Z` = 0。贴出四条命令与输出。
- [ ] AC3（`suite-rerun-green` 的条件性不可达是读数）对 `ts > 2026-10-21T16:36:58Z` 的 47 条 `rerun` 记录做三段断言并贴出数字：① 状态分布 = 44 `rerun-red` + 3 `rerun-not-evaluated` + 0 `rerun-green`；② `ts > 2026-10-21T22:50Z` 的每一条 `rerun-red` 的 `files[]` 都含 `plugin/test/task-granularity-advice.test.mjs`，缺它的记录数 = 0；③ 同一文件在 `.quay/baseline-red-rounds.jsonl` 的签名中出现 11 次（首 2026-10-21T22:52:41Z、末 2026-10-23T04:46:49Z）⇒ 它是 develop 基线红。判据可假：若出现一条不含该基线红的 `rerun-red`，绿分支就可能可达，本裁定必须重做。
- [ ] AC4（检测器：机器可读裁定 + 三态 + 负控制）在真实载体上贴出三次读数：① 声明存在且未过期 ⇒ 5 组不出现在 `decayed[]`，而出现在独立的 `adjudicated[]`（每条带 `group` / `kind` / `reason` / `reviewAfter`），`decayedCount` 不计它们；② 负控制：删掉声明（或把 `reviewAfter` 改到过去）⇒ 同一批组回到 `decayed[]`；③ `suite-rerun-green` 的 `conditional-on-input` 在条件命令 exit 0 时输出 `explained-absent` 并附条件读数，负控制把该命令改成 `exit 1`（条件不成立）时仍报 `rate-stopped`。三项在 `plugin/test/instrument-decay-check.test.mjs` 各有对应用例；贴出 JSON 片段与用例名。
- [ ] AC5（生产轮次读数，落地后）在合入 develop 之后的下一个真实 quality-gate `instrument_decay` 轮次上读 `.quay/quality-round.jsonl`：该轮 `reason` / `filings` 显示这 5 组不再计入 `decayed`（并可见 `adjudicated` 计数），且 pair `fan-in-step-trace.jsonl|rate-stopped` 的 filing 语义不被永久豁免。贴出该轮 `ts`、`reason`、`filings` 与窗口起点晚于的落地提交 sha。（待外部）

## DoD

- [ ] AC1-AC4 全绿；`scripts/test.sh --for-task gap-fan-in-step-trace-rate-stopped-adjudication` 通过；贴出输出。
- [ ] 裁定是**可过期**的：`reviewAfter` 已过的声明必须重新进入 `decayed[]`（AC4 ② 即该判据），⛔ 不提供永久豁免开关。
- [ ] AC5 的生产读数已贴出（待外部）。

## Touches

- plugin/scripts/instrument-decay-check.ts
- plugin/test/instrument-decay-check.test.mjs
- plugin/scripts/quality-gate-driver.ts
- plugin/test/quality-gate-driver.test.mjs
- tasks/gap-fan-in-step-trace-rate-stopped-adjudication.md