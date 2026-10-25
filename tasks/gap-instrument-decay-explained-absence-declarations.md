---
id: gap-instrument-decay-explained-absence-declarations
title: instrument-decay 的 3 个 rate-stopped 分组（suite-skip / suite-recovery /
  suite-recovery-blocked）经查全是「已解释缺席」，但 MANIFEST 没有机器可读裁定 ⇒ 常驻检测器每轮重报、人工取证重做
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
## Proposal

**现状读数**（2026-10-25T05:01Z，主检出 `/data/home/yale/work/quay`，HEAD `8b4c0ac75`）：

```
node --experimental-strip-types plugin/scripts/instrument-decay-check.ts \
  --root /data/home/yale/work/quay --carrier fan-in-step-trace.jsonl --json
⇒ ok:false evaluated:true totalRecords:20025 freshest:2026-10-24T23:25:07.034Z groupCount:27 decayedCount:3
  suite-skip              rate-stopped  count 79   lastWrite 2026-10-23T08:42:04.648Z
  suite-recovery          rate-stopped  count 121  lastWrite 2026-10-23T23:15:27.308Z
  suite-recovery-blocked  rate-stopped  count 44   lastWrite 2026-10-23T23:15:27.308Z
```

全 MANIFEST 运行：`decayedCount:3 / adjudicatedCount:5 / healthyCount:4 / uncoveredCount:2`——**这 3 组就是当前整个 workspace 的唯一 decay**。

**逐组取证（2026-10-25 实读；结论：三组都是 conditional-on-input 的「已解释缺席」，不是写手腐烂）**

1. **`suite-skip`** —— 写手在 `plugin/scripts/worker-fan-in.ts:3265`（`traceSuiteEvent("suite-skip", …)`），触发是 `needSuite === false`（`worker-fan-in.ts:2716`：`codeDelta === ""` 的 doc-only delta，或 `reuseSkip` 的 develop-advance-doc-only-reuse）。
   - 写手路径在，且**最后一次写入本身就是一次真实触发**：该次任务（`gap-goal911-exit-condition3-unencapsulated-e2e-uncovered`）的 per-run 日志逐字记着 `"step":"delta" … "reason":"doc-only delta → skip suite"`。
   - 此后载体里有 **22 次任务落地**（各有 `ff`），**每一次**的 per-run delta 读数都是 code delta（例如 `code delta (plugin/scripts/worker-fan-in.ts\nplugin/test/worker-driver-fan-in-s09.test.mjs) → run suite`），doc-only 落地 = **0** ⇒ 跳过分支的输入确实没有发生。
   - 节奏：79 条自 2026-09-17 起；最近 20 个间隔中位数 **4.1h**、全历史最大 **117.4h**；当前 38.7h **仍在自身历史包络内**。

2. **`suite-recovery`** —— 写手在 `worker-fan-in.ts:3042` / `:3051`，触发是某个恢复档返回 `no-conclusion` 或 `incomplete`（**降档**）。
   - 最后一次写入之后：`suite-incomplete` 发生 **2** 次（2026-10-24T00:01:07.835Z、2026-10-24T15:43:31.916Z，均 `oom-killed`）；**两次恢复轮都在第一档（concurrency 64）就产出完整判词**，经 `suite-recovery-baseline-exempt` + `suite-recovery-accepted` 落地（00:15:35.319Z、16:01:38.391Z）。**降档次数 = 0** ⇒ 该组自己的触发确实没有发生。
   - 121 条几乎全部来自 2026-10-23 的 OOM 风暴（当日 `suite-incomplete` 32 次 ⇒ `suite-recovery` 65 条 / `blocked` 24 条）；2026-10-24 只有 2 次 incomplete 且都首档成功 ⇒ 0 / 0。**读数下降是 OOM 修复的结果**（`gap-fan-in-recovery-ladder-inert-bucket-full-drops-test-concurrency`、`gap-suite-oom-lane-scaled-ladder-floor-32-no-lower-rung`），不是写手停摆。

3. **`suite-recovery-blocked`** —— 写手在 `worker-fan-in.ts:3135`，触发是 `certifiedRun === null`（阶梯耗尽、没有任何一档认证）。
   - 同一窗口的 2 次恢复轮都经 baseline-exempt 认证 ⇒ `certifiedRun !== null` ⇒ 触发未发生。
   - 节奏：44 条自 2026-10-14 起；最近 20 个间隔中位数 **0.6h**、**全历史最大 1.8h**；当前约 24h **远超自身历史最大间隔**——按「触发是否远超自身节奏」这一条，本组满足「值得立案」的判据（`suite-skip` 则仍在包络内；两者的结论都是 rare-by-design/conditional-on-input，**均非 writer rot**）。

**缺陷（机制，不是症状）**：`instrument-decay-check.ts` 的 Shape B 唯一判据是「末次写入比载体最新老超过 `--stale-seconds`」，它无法区分「按设计/条件性缺席」与「写手腐烂」（硬规则 3b）。上一轮 `gap-fan-in-step-trace-rate-stopped-adjudication`（done）已经造出正确的机器可读落点 `CarrierSpec.adjudicated[]`（`group` / `kind` / `reason` / `conditionCmd` / `reviewAfter`），但**只声明了 5 个分组**；本任务点名的 3 个「已解释缺席」没有声明 ⇒ 常驻检测器每轮把它们重报为 `decayed`，并要求每轮重做同一份人工取证。同一批分组已经在 2026-10-22 的 content-dark 任务、2026-10-23 的 adjudication 任务上被人工裁定过两次——**这是第三次**。这正是「解释只活在散文里、不活在机制里」的漂移。

**修法方向**：给这 3 个分组补 `adjudicated` 声明，全部用 **`conditional-on-input`**（⛔ 不是 `rare-by-design` 的无条件豁免）：
- 每条 `conditionCmd` 必须**可执行、只读、亚秒级、可证伪**：读载体尾部，判断「该分组缺席的直接成因在最近窗口里是否仍成立」。条件 `exit 0` ⇒ `explained-absent`；`exit≠0` ⇒ 回到 `decayed[]`。
- `reviewAfter` 必填且有界（例如 +28 天），过期自动回到 `decayed[]`。
- 被裁定的分组**仍出现在 `adjudicated[]` 并带真实 `count` / `lastWrite`**，⛔ 不从读数里消失。
- 更新 `plugin/test/instrument-decay-check.test.mjs` 里钉住生产 MANIFEST 的用例（当前钉 5 条），并加负控制。

条件命令的建议形态（实现者可调整，但必须满足上面的性质）：
- `suite-recovery` / `suite-recovery-blocked`：取载体尾部的最后一次 `suite-incomplete`；断言其后存在 `suite-recovery-accepted` 或 `suite-recovery-baseline-exempt`，且两者之间**没有** `suite-recovery`（降档）记录 ⇒ 恢复轮首档认证、这两组缺席已解释。
- `suite-skip`：取最后一次 `suite-skip` 之后的窗口；断言每个含 `ff` 的 runId 也都含 `suite-start`（全部落地都跑了全量 suite，没有 doc-only delta）⇒ 跳过分支的输入不存在。

<!-- dedup-ref --> 合并判断 = **separate**：open `gap-instrument-decay-dedup-reader-round-log-path`（todo，已有在飞 worktree）与本任务同属 instrument-decay 子系统，但机制不同——那条修「去重台账读错路径 ⇒ 同一 pair 每轮重新 spawn」，本条修「MANIFEST 缺少已解释缺席的声明 ⇒ 同三个分组每轮重报、人工取证重做」。Touches 不重叠（它改 `quality-gate-driver.ts`，本条改 `instrument-decay-check.ts` + 其测试），`task-granularity-advice.ts` 对本任务 Touches 返回 `peers: []`。

**prior-claim**（DONE，均已在当前 HEAD / 真实载体上复核）：
- `gap-fan-in-step-trace-rate-stopped-adjudication`（done）—— 造出 `adjudicated[]` 机制并裁定 5 个分组；本任务点名的 3 个**不在**其 5 条声明里，载体当前仍把它们报为 `decayed`（硬规则 5b：done ≠ absent）。
- `gap-instrument-decay-check-unwired-and-blind-to-content-dark`（done）—— 曾把 `suite-recovery-blocked` 记作「稀有但活着，不立案」；那是散文裁定，没有机制落点，故本任务重报。
- `gap-instrument-decay-postlanding-two-rounds`（ready）/ `gap-instrument-decay-dedup-reader-round-log-path`（todo）—— 同子系统、不同机制，见上。

## AC

- [x] AC1（现状复现 + 全量对照）在主检出实读并贴出 JSON：`--carrier fan-in-step-trace.jsonl` ⇒ `evaluated:true`、`decayed[]` 含本任务点名的 3 个 `rate-stopped` 分组（若期间**新增**其它分组，逐一同样取证并纳入本任务的声明集合），且 `adjudicated[]` 中**不含**这 3 个分组；同时贴出全 MANIFEST 运行读数（当前 `decayedCount:3 / adjudicatedCount:5 / healthyCount:4 / uncoveredCount:2`）。判据可假：任一分组恢复写入或载体被清空时该读数改变。
- [x] AC2（写手路径存在 + 触发普查，逐组贴命令与数字）① `grep -n 'traceSuiteEvent("suite-skip"' plugin/scripts/worker-fan-in.ts` 命中，且 `needSuite` 判定分支仍在；统计最后一次 `suite-skip` 之后含 `ff` 的 runId 数 = N、其中含 `suite-start` 的 = N、doc-only 落地 = 0。② 统计最后一次 `suite-recovery` 之后 `suite-incomplete` 次数（≥1）、`suite-recovery`（降档）次数 = 0、`suite-recovery-accepted`/`suite-recovery-baseline-exempt` 次数 ≥1。③ 统计同一窗口 `suite-recovery-blocked` 次数 = 0，且每次 `suite-incomplete` 之后都有认证事件。三条合起来证明「触发条件未发生、写手路径仍在」，即不是腐烂。
- [x] AC3（声明落地 + 真实载体读数）`MANIFEST` 中 fan-in-step-trace 的 `adjudicated[]` 新增上述 3 条 `conditional-on-input` 声明（每条带非空 `reason`、未来 `reviewAfter`、可执行 `conditionCmd`）。在真实 `.quay/fan-in-step-trace.jsonl` 上运行检测器：3 组**不在** `decayed[]`，而出现在 `adjudicated[]`，`state:"explained-absent"`、`condition.exitCode:0`，且各自仍带真实 `count` 与 `lastWrite`（⛔ 不从读数里消失）；贴出 JSON 片段。
- [x] AC4（三条负控制，全部贴读数）① 把任一 `reviewAfter` 改到过去 ⇒ 该组回到 `decayed[]`，`detail` 点名过期；② 把任一 `conditionCmd` 换成 `exit 1` ⇒ 该组回到 `decayed[]`，`detail` 点名条件不成立；③ 构造一个「含 `ff` 但没有 `suite-start` 的 runId」的合成载体 ⇒ `suite-skip` 的声明**不**豁免它。三项在 `plugin/test/instrument-decay-check.test.mjs` 各有对应用例；贴出用例名与 `node --test` 的通过数。
- [x] AC5（回归 + 读数面）更新钉住生产 MANIFEST 的既有用例（当前断言 5 条裁定），使其断言本任务后的完整裁定集合，且**不**把「已裁定」当成「载体健康」；`bash scripts/test.sh --for-task gap-instrument-decay-explained-absence-declarations` 绿；贴出尾部逐字计数。
- [ ] AC6（生产轮次读数）合入 `develop` 之后的下一个真实 `instrument_decay` 质量轮次上读 `.quay/quality-round.jsonl`：该轮 `decayed` 不含这 3 组，`reason` 可见 `adjudicated` 计数，且 pair `fan-in-step-trace.jsonl|rate-stopped` 的 filing 语义未被永久豁免。贴出该轮 `ts` / `reason` / `filings` 与窗口起点晚于的落地提交 sha（待外部）

## DoD

- [ ] AC1–AC5 全绿并贴出实读证据；AC6 的生产轮次读数已贴出（待外部）
- [x] **真实落地**：常量不止活在测试里——在**主检出的真实载体**上、不带任何 fixture / 注入切换跑一次检测器，得到这 3 组不在 `decayed[]` 而带真实读数出现在 `adjudicated[]`（若该时刻另有分组变暗，逐一具名报告，⛔ 不得静默忽略，也不得因此判本条失败），并把命令与输出贴进 Evidence。fixture / 注入数据满足不算（硬规则 4 推论三）。
- [x] 声明**可过期、不可永久化**：`reviewAfter` 全部是未来的具体时刻；把任一改到过去都能让对应分组回到 `decayed[]`（AC4 ① 即该判据）。
- [x] ⛔ 不为让读数变绿而删分组、删 `expected` 词表项或加「永久豁免」开关；「不算腐烂」不得等于「从读数里消失」。

## Evidence

**ADR-007 暗轴记录**（续做轮修正行首形态：上一轮把 `该轴仍暗` 写在 `**…**：` 之后的行中，而 `packages/quay/src/gate/dark-axis-record.ts` 的 `DISCLAIM_ZH_RE` 要求 `该轴仍暗` 位于行首（可选 `- `/`> `/`**` 前缀之后），故被判 MISSING）：

- 该轴仍暗,理由:本任务只在常驻检测器 `plugin/scripts/instrument-decay-check.ts` 的 MANIFEST 里新增 3 条常量声明及对应用例——零新 import、零新模块、零跨包边，L_D/L_G 的可测面与改动前完全相同；本轮实读 `node experiments/quay-perpetual-stream/scripts/git-lens-instrument.mjs lg --work-dir /data/home/yale/work/quay` 返回 NOT-EVALUATED（scope-not-evaluated: 读不到 query/manifest.json），即该轴在本检出上取不到机器读数，故按 ADR-007 记「仍暗」而不是编一个数字。

### AC1 — 改动前的现状复现（2026-10-25，主检出 `/data/home/yale/work/quay`）

```
$ node --experimental-strip-types plugin/scripts/instrument-decay-check.ts --root /data/home/yale/work/quay --carrier fan-in-step-trace.jsonl --json
⇒ ok:false evaluated:true totalRecords:20025 freshest:2026-10-24T23:25:07.034Z groupCount:27 decayedCount:3
  decayed[]:  suite-skip(79, 2026-10-23T08:42:04.648Z) / suite-recovery(121, 2026-10-23T23:15:27.308Z)
              / suite-recovery-blocked(44, 2026-10-23T23:15:27.308Z)   —— 三者 kind=rate-stopped, detail:null
  adjudicated[]: 5 条，**不含**上述 3 组（verification-round-record / catch-up-develop /
                 suite-rerun-green / suite-recovery-certified / suite-recovery-new-regression）

$ node --experimental-strip-types plugin/scripts/instrument-decay-check.ts --root /data/home/yale/work/quay --json
⇒ ok:false decayedCount:3 adjudicatedCount:5 healthyCount:4 uncoveredCount:2
  uncovered = fan-in-failure-classification.jsonl(evaluated-but-undescribed) / measure-history.jsonl(declared-uncovered)
```
该时刻**没有**新增其它 dark 分组（decayed 恰好只有任务点名的 3 组）。

### AC2 — 写手路径 + 触发普查（逐组）

```
① $ grep -n 'traceSuiteEvent("suite-skip"' plugin/scripts/worker-fan-in.ts
   3265:      traceSuiteEvent("suite-skip", { exit: 0, wall_ms: 0, ok: true, reason: reuseSkip ? "develop-advance-doc-only-reuse" : "doc-only-delta" });
   $ grep -n 'needSuite' plugin/scripts/worker-fan-in.ts
   2716:    const needSuite = opts.forceSuite === true || codeDelta === CLASSIFY_FAILED || (codeDelta !== "" && !reuseSkip);
   2875:    if (needSuite) {
```
普查口径（与检测器同口径排除 `kind==="goal-merge"`；生产载体里 `runId` 恒为 `wk-prod-anchor`，**不能**当 run 键 ⇒ 按 `task` 关联）：

- **suite-skip**：末次写入 `2026-10-23T08:42:04.648Z` 之后 `ffTouches=23 / withSuiteStart=22 / withoutSuiteStart=1`
  （`gap-goal911-exit-condition3-unencapsulated-e2e-uncovered`）。
  ⚠️ **偏差具名（不静默忽略）**：AC2 原文预期「N/N、doc-only=0」，实测是 22/23。唯一例外正是**写出这条
  `suite-skip` 的那次 doc-only 落地本身**——它的 `ff` 时间戳晚于它自己写下的 `suite-skip` 记录，所以落进
  窗口。因此成立的读数是「**除末次 suite-skip 自身那次之外**，doc-only 落地 = 0」，这也正是声明里条件命令所
  读的谓词（按 `task` 身份排除那一次）；负控制 ③ 另行证明「无关的 ff 无 suite-start」会把条件打回假。
- **suite-recovery**：窗口起点 = max(末次 `suite-recovery`, 末次 `suite-recovery-blocked`) = `2026-10-23T23:15:27.308Z`
  ⇒ `suite-incomplete=2 / suite-recovery(降档)=0 / suite-recovery-accepted=2 / suite-recovery-baseline-exempt=2 / suite-recovery-blocked=0`。
  逐条：incomplete `2026-10-24T00:01:07.835Z` → exempt+accepted `2026-10-24T00:15:35.319Z`；
  incomplete `2026-10-24T15:43:31.916Z` → exempt `16:01:38.391Z` + accepted `16:01:38.392Z`。
- **suite-recovery-blocked**：同一窗口 `blocked=0`，且两次 incomplete 都等到认证 ⇒ `certifiedRun !== null`。

### AC3 — 声明落地 + 真实载体读数（**无** fixture / 注入切换）

`plugin/scripts/instrument-decay-check.ts` 的 `MANIFEST[0].adjudicated[]` 新增 3 条 `conditional-on-input`
（`reason` 非空、`reviewAfter=2026-11-22T00:00:00.000Z`、`conditionCmd` 可执行；`suite-recovery` 与
`suite-recovery-blocked` 共用 `RECOVERY_LADDER_CONDITION_CMD`）。在**主检出的真实 `.quay/fan-in-step-trace.jsonl`** 上：

```
$ node --experimental-strip-types plugin/scripts/instrument-decay-check.ts --root /data/home/yale/work/quay --carrier fan-in-step-trace.jsonl --json
⇒ ok:true decayedCount:0 adjudicatedCount:8    decayed[] = []
  suite-skip              explained-absent count=79  lastWrite=2026-10-23T08:42:04.648Z  condition.exitCode=0
  suite-recovery          explained-absent count=121 lastWrite=2026-10-23T23:15:27.308Z  condition.exitCode=0
  suite-recovery-blocked  explained-absent count=44  lastWrite=2026-10-23T23:15:27.308Z  condition.exitCode=0

$ 同上（全 MANIFEST）⇒ ok:true decayedCount:0 adjudicatedCount:8 healthyCount:5 uncoveredCount:2
  uncovered 两个与改动前相同（fan-in-failure-classification / measure-history）

human 面：INSTRUMENT-ADJUDICATED: .quay/fan-in-step-trace.jsonl — 8 group(s) adjudicated (NOT counted as decay)
          adjudicated: suite-skip — explained-absent (last=2026-10-23T08:42:04.648Z, 79 records) … exit=0
```
⛔ `healthyCount` 4→5 只因为「没有 decay」这条读数变了，**它不是健康声明**：8 条裁定在同一次输出的
`adjudicated[]` 里逐条可见（含真实 count/lastWrite）。本任务**不**改 `healthyCount` 的语义（改它要触碰
`quality-gate-driver.ts` 的读数面，不在本任务 Touches）。该时刻**没有**其它分组变暗（decayedCount:0）。

### AC4 — 三条负控制（用例名 + 通过数）

```
$ node --experimental-strip-types plugin/test/instrument-decay-check.test.mjs
ℹ tests 37 / pass 37 / fail 0 / cancelled 0 / skipped 0 / todo 0
```
- ① `生产 MANIFEST 负控制 ① — 把 suite-skip 的 reviewAfter 改到过去 ⇒ 它回到 decayed[]，detail 点名过期`
  （detail 匹配 `adjudication expired at 2026-10-01`；其余 7 条仍生效）
- ② `生产 MANIFEST 负控制 ② — 把 suite-recovery 的 conditionCmd 换成 exit 1 ⇒ 它回到 decayed[]，detail 点名条件不成立`
  （detail 匹配 `condition command did not hold (exit 1)`；其余 7 条仍生效）
- ③ `生产 MANIFEST 负控制 ③ — 含 ff 但没有 suite-start 的落地 ⇒ suite-skip 的裁定不豁免它`
  （合成载体加一条 `task=gap-doc-only-landing` 的 ff；suite-skip 回到 decayed[]，其余 7 条仍生效）

### AC5 — 回归 + 读数面

钉住生产 MANIFEST 的用例改为断言本任务后的**完整**裁定集合（8 条 = 4 rare-by-design + 4 explained-absent），
并断言被判定的分组仍带真实 `count`/`lastWrite`；CLI 用例断言 `decayedCount` 与 `adjudicatedCount` 两条独立
读数，**不**把「已裁定」当成「载体健康」（用例内注释写明 `healthyCount` 语义未变、不在本任务范围）。

```
$ bash scripts/test.sh --for-task gap-instrument-decay-explained-absence-declarations
ℹ tests 37 / pass 37 / fail 0 / cancelled 0 / skipped 0 / todo 0 / duration_ms 941.955735

$ bash scripts/test.sh --for-task gap-instrument-decay-explained-absence-declarations --allow-thin   # driver fan-in 的同一道门
ℹ tests 37 / pass 37 / fail 0

$ node --no-warnings --experimental-strip-types plugin/scripts/anti-drift-touches-check.ts --task gap-instrument-decay-explained-absence-declarations --worktree <wt> --merge-target develop
ANTI-DRIFT OK: … 2 actual file(s), all within declared Touches (3 glob(s))
```

### AC6 — 生产轮次读数（待外部）

需合入 `develop` 后由下一个真实 `instrument_decay` 质量轮次产出（该轮 `ts` / `reason` / `filings` 与窗口起点
晚于的落地 sha）。**本 worker 未取得**：worker 不跑 suite、不 merge develop，轮次发生在 ff 之后。

**AC6 的承接者（「（待外部）」成立的条件）**：生产者是**常驻** `quality-gate-driver` 的 `instrument_decay`
例程（`.quay/config.yml:281` `enabled: true`、`interval: interval:360m`），每轮把 `instrument-decay` fact 写进
`.quay/quality-round.jsonl`，fact 自带 `decayedCount` / `adjudicatedCount` 两条独立读数；2026-10-25T05:08–05:09Z
的生产轮次 649/650 仍在产出 ⇒ **这一路是自动的、无需人派发**。复查承接任务：`gap-instrument-decay-postlanding-two-rounds`
（ready，同子系统，读同一 `.quay/quality-round.jsonl` 的落地后轮次）。

### 续做轮次复核（2026-10-25，CONTINUE round —— 复用既有 worktree，未重做实现）

上一轮已实现并勾选 AC1–AC5；本轮只做复核，并把最后一处 `（待外部）` 注解移到**行尾**：判据是
`isExternalVerificationItem` 的 `/（待外部）\s*$/`（`ready-pool-check.ts`），原 DoD 行尾多一个 `。` ⇒ 该行被判为
「待本任务」，fan-in 的 ac-completion gate 因此报 `checked 8/10，剩余未勾 2 含非待外部项`。复核读数（同一分支，
`git merge develop` 之后、无 fixture / 注入切换）：

```
$ node --experimental-strip-types plugin/scripts/instrument-decay-check.ts --root /data/home/yale/work/quay --carrier fan-in-step-trace.jsonl --json
⇒ ok:true evaluated:true decayedCount:0 adjudicatedCount:8   decayed[] = []
  suite-skip / suite-recovery / suite-recovery-blocked 均为 state=explained-absent、condition.exitCode=0，
  且各自仍带真实 count（79 / 121 / 44）与 lastWrite（2026-10-23T08:42:04.648Z / 2026-10-23T23:15:27.308Z）

$ node --experimental-strip-types --test plugin/test/instrument-decay-check.test.mjs
ℹ tests 37 / pass 37 / fail 0 / cancelled 0 / skipped 0 / todo 0
```

### DoD — 真实落地 / 可过期 / 不从读数消失

- 真实落地：见 AC3 —— 主检出的真实载体、无 fixture 切换、3 组带真实读数出现在 `adjudicated[]`；该时刻无其它分组变暗。
- 可过期：3 条 `reviewAfter` 均为未来具体时刻 `2026-11-22T00:00:00.000Z`；AC4 ① 证明改到过去即回到 `decayed[]`。
- 不从读数消失：`expected` 词表与分组未被删改；8 条裁定全部带 `count`/`lastWrite` 出现在 `adjudicated[]`，`--json` 面与 human 面都独立打印。

## Touches

- plugin/scripts/instrument-decay-check.ts
- plugin/test/instrument-decay-check.test.mjs
- tasks/gap-instrument-decay-explained-absence-declarations.md

## Blocker

**2026-10-25T05:43:09.706Z — worker 未落地（exited-not-landed）**

- 未落地原因：step=dark-axis: dark-axis (ADR-007 per-milestone predicate) refused the flip — MISSING: MISSING — the task body records no L_D/L_G reading (a numeric quantity at an axis-anchored line) and carries no explicit "该轴仍暗,理由:<...>" declaration. ADR-007 requires one or the other before the task may be called done.
- run_id：wk-prod-anchor
- session_id：97009f6f-a302-4e9f-9414-47ad150b3af2
