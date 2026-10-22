---
id: gap-design-evolution-readings-emit-findings
title: 设计演化读数只报不动作——不产出 finding、与既有立案通道零接线；改为在相对回归与连续 未评估时产出可去重的 finding，交现成
  routine-file-gate 立案
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

**来源**：claudecodeui 会话「Quay 的 OO 设计重构」2026-10-22 经 `SendMessage` 提出，希望 quay 提供「架构优化 driver」——读设计演化读数，检出回归就自动在任务库立案；它明确 claudecodeui 侧不自建仪器、不立 directive，只运行并接受产出的任务。人 2026-10-22 同意按本任务收窄后的设计推进。

**现状（2026-10-22 实测）**：
1. **读数例程是 report-only，且与立案通道零接线**。`plugin/scripts/quality-gate-driver.ts:200-227` 明确写它是「声明式 report-only 例程」「零 LLM、零 spawn 模型」，只 append 到 `.quay/design-evolution-history.jsonl`，读数「不算 failed，也不 ratchet」。它**不产出任何 finding**。
2. **立案通道已经存在，无需新建**。`.quay/routine-findings.jsonl` 共 2924 条（`semantic-dedup-scan` 1707、`freshness-refresh` 1195、`architecture-analysis` 22），由 `plugin/scripts/routine-file-gate.ts` 做质量 / 去重 / 速率三道闸；其中 `architecture-analysis` 已经在产出 finding。缺的不是通道，是**这条读数源没接上去**。
3. **发生率不足以支撑「新 driver」**（硬规则 12）：`.quay/design-evolution-history.jsonl` 只有 7 条记录，同类读数几乎恒定（serve 1.31% ×7、worker-history 82.46% ×6；worker-post-909 有 6 条 `evaluated:true` 记录全为 100%，分母从 172 涨到 288，**中心增量的增量全部落在中心文件、非中心增量为 0**，另有 1 条 `evaluated:false`）。历史上本该被这类机制抓到的事件只有 2 次：目录环存在约 7 小时（`tasks/gap-arch-cycle-report-never-evaluated-aggregate-and-stale-artifacts.md`）、worker god 文件增长（`gap-worker-driver-god-file-decomposition-investigation`）——两次都是人工分析发现，不是读数例程。
4. **绝对阈值不可校准**（硬规则 4 推论）：读数尚无方差，任何 `>50%` / `>1%` 之类的数都是凭空设的。

**设计取舍**：
- ⛔ **不新建 driver**。动作面复用既有 `routine-file-gate` → `quay:run-routines` skill 的立案路径；本任务只负责把「读数」变成「finding」。
- **触发条件只用结构量，不用绝对阈值**：
   - (a) `share-up`：同一 baseline 的同一子系统，本轮相对上一条读数**分母增加且中心增量 > 0**（即有新行产生、且有新行落在中心文件）。finding 里带上**增量口径**：`Δcentral / Δdenominator` 与累计占比。⛔ 不设「占比超过 X% 才报」的阈值——噪声由既有 `routine-file-gate` 的**去重闸**吸收（同一子系统的同一 trigger 只会立一次案），而不是由一个凭空设的数吸收。
   - (b) `dark-streak`：某子系统连续 ≥2 轮 `evaluated:false`。
   - (c) `source-missing`：某子系统在连续读数中消失。
   仅 (b) 需要一个轮次计数，默认 2，写在配置里，并在注释里写明它是**策略选择**（一次失败可能是瞬时，两次才值得立案），不冒充测量结果。
- **仪器变暗本身要立案**：否则这项机制恰好在仪器失明时失明（同 `gap-instrument-decay-check-unwired-and-blind-to-content-dark` 的教训，不重复其检测内容，只消费它的暗态读数）。
- **首期只对 quay 自身生效**：跑够有真实信号后再让 claudecodeui 接入；跨 workspace 只需对方在自己的 `.quay/config.yml` 声明这条例程，代码本身与 workspace 无关。

## Plan

1. 在 `plugin/scripts/design-evolution-readings.ts` 增加**纯函数** `judgeEvolutionRegression(prev, curr)`（零 LLM），四态输出：
   - `stable`（有前一条读数、无触发）；
   - `regression`（附 `triggers` 数组：`share-up` / `dark-streak` / `source-missing`）；
   - `no-prior`（首次读数，**不等于 stable**）；
   - `NOT-EVALUATED`（本轮读数本身 `evaluated:false` 或读不懂记录）。
   四态必须两两可分（硬规则 3b）：`no-prior` 与 `stable` 在输出字段上不同，`NOT-EVALUATED` 不带空的 `triggers` 冒充「无触发」。
2. **finding 的机械去重键**：key = `evolution:<subsystem>:<trigger>`，由读数自身机械生成，⛔ 不把 LLM 复述的理由放进 key。依据：`routine-file-gate.ts` 头注释记录的实测——`semantic-dedup-scan` 的散文 key 跨轮零重复，76 个簇从未产出相同 key。
3. **只写 finding，不写任务**：finding 追加到既有 routine findings 载体，带 `routine: "design-evolution-readings"`、`target`（子系统）、`trigger`、以及产生它的读数记录 id/ts。任务由既有 `quay:run-routines` skill 经 `routine-file-gate` 立案；本任务**不**在任何 driver 里调用 `task_write`。
4. **每轮都留评估痕**：即使 `stable` 也记一条（轻量），否则日后无法回答「这条例程到底评估过几轮、触发过几次」——这是 `arch-cycle-report` 25/25 `evaluated:false` 那次的直接教训。
5. **配置**：`dark_streak_rounds`（默认 2）、`enabled`。默认值写在 `design-evolution-readings.ts` 一处，经 `driver-config.ts` 派生，⛔ 不在两处各写一份。
6. **首期范围**：只在 quay 本工作区启用；不向 claudecodeui 推送任何改动。

**实施中确定的两处口径**（写进代码注释，因为它们是判据的一部分）：
- `source-missing` 的**身份**是 `baseline` + 中心文件集，⛔ 不是标签。实测依据：真实载体第 1 条把 `worker` 改名为 `worker-history`（同一 baseline `2440b52d0`、同一组中心文件）。按标签判定会为一次**配置改名**立一条「子系统消失」的案。
- `share-up` 的**已声明边界**：`Δdenominator <= 0` 时不算 share-up，即使 `Δcentral > 0`（「行只搬进中心文件」不是「新代码落进中心文件」）。该形态不在本条三个 trigger 内，⛔ 不偷偷扩成一个新 trigger。

## Acceptance Criteria

- [x] AC1 四态可分：单测覆盖 `stable` / `regression` / `no-prior` / `NOT-EVALUATED` 四种输入，断言 `no-prior` 的输出与 `stable` 在判别字段上不同、`NOT-EVALUATED` 携带非空 reason 且不带 `triggers: []`；贴测试名与断言条数。
  - 测试：`AC1 — the four judgment states are PAIRWISE DISTINGUISHABLE (硬规则 3b)`（`plugin/test/design-evolution-readings.test.mjs`），**16 条断言调用 / 20 个具体判定**：四态集合互异（1）、`priorTs` 两次（2）、`state` 互异（1）、`reason` 类型+非空（2）、三个非 regression 态 `triggers === null`（3）、regression 的 `triggers` 非空数组 + trigger/target/Δcentral/Δdenominator/reason（6）、四态 `summary` 非空（1 次断言循环 4 个）。
  - 附：`AC1b — a share-up needs BOTH the denominator and the central delta to grow`（6 条断言）把「高占比 ≠ 触发」钉住：serve 1.31% 恒定不触发，worker-history 82.46% 恒定不触发，只有 `Δcentral>0 ∧ Δdenominator>0` 才触发。
- [x] AC2 去重键跨轮稳定：同一子系统同一 trigger 的两条 finding，即使理由文字完全不同，机械 key 相同；不同 trigger 或不同子系统 key 不同。用两条真实格式的 finding 文本跑 `routine-file-gate` 的 dedup 分支验证，贴两次判定与 key。
  - 测试：`AC2 — the dedup key is MECHANICAL: same subsystem+trigger ⇒ same key, whatever the prose`。两条 rationale 逐字不同的 finding（一条中文、一条英文复述）经 `evolutionFindingRecord` → `routineFindingCandidateText` → 真 `findingKey`：**同为** `symbols:evolution:worker-post-909:share-up`；换 trigger → `symbols:evolution:worker-post-909:dark-streak`；换子系统 → `symbols:evolution:serve:share-up`。真 `gateFinding`：第一条 `ACCEPT: accepted: actionable, novel, within rate`；第二条（理由不同、key 相同）`REJECT: dedup: an equivalent finding is already OPEN on the board (matched key: symbols:evolution:worker-post-909:share-up, holder: gap-routine-worker-post-909-share-up.md [status: todo])`。见下方 AC7 原文。
  - 附：`AC2b` 用 `recurrenceByKey` 证明同一 key 的两轮记录被计成**同一主语**（2 个 runId ⇒ recurrence=2）。
- [x] AC3 读真实载体（非注入）：对 `.quay/design-evolution-history.jsonl` 现有的 7 条真实记录逐条跑判定，输出每条记录的 `{ts, subsystem, state, Δcentral, Δdenominator}` 全表。预期：**至少 1 条 `share-up`**，且必须点名 `worker-post-909` 在 `2026-10-22T04:24:51.164Z` 那条（相对上一条 Δcentral=116、Δdenominator=116、非中心增量 0）；其余为 `stable`。若判定为 0 条 `share-up`，说明增量口径写错了。贴完整表与判定命令。
  - ⚠️ **前提漂移（如实记录）**：载体现在是 **9 条**（任务写就时 7 条，之后又落了 2 轮）。全表按 9 条输出。
  - 判定命令：`node --no-warnings --experimental-strip-types /tmp/der-ev/replay.mjs`（脚本只 `import` 本仓库的 `readDesignEvolutionHistory` / `judgeEvolutionRegression` / `priorDarkRoundsFor` / `evolutionFindings`，逐条喂真实记录；无任何注入）。
  - 结果：**恰 1 条 `share-up`**，正是 `2026-10-22T04:24:51.164Z` 的 `worker-post-909`，`Δcentral=116 Δdenominator=116 Δnon-central=0 share=100%` —— 与 AC 预期逐字相符。逐轮状态：`#0 no-prior`、`#1 not-evaluated`（该轮 worker-post-909 读数 `evaluated:false`，暗 1 轮 < 阈值 2）、`#2..#6 stable`、`#7 regression(share-up)`、`#8 stable`。
  - 与 AC 预期的一处**偏差**：`#1` 不是 `stable` 而是 `not-evaluated` —— 那一轮的读数本身读不出来（`non-positive-denominator`）。硬规则 3b 要求「判不了」不能与「无变化」同形，故它保留自己的取值；这不是判定错误。
  - 全表（35 行 = 9 条记录 × 各自子系统 + `rm2` 行）：

```
ts | subsystem | state | Δcentral | Δdenominator | Δnon-central | share%
2026-10-21T23:14:08.556Z | serve | no-prior | - | - | - | 0.98
2026-10-21T23:14:08.556Z | worker | no-prior | - | - | - | 69.97
2026-10-21T23:14:08.556Z | rm2 | stable | - | - | - | -
2026-10-22T00:40:48.667Z | serve | stable | 0 | -3957 | -3957 | 1.31
2026-10-22T00:40:48.667Z | worker-history | stable | 400 | -472 | -872 | 82.46
2026-10-22T00:40:48.667Z | worker-post-909 | not-evaluated | - | - | - | -
2026-10-22T00:40:48.667Z | rm2 | stable | - | - | - | -
2026-10-22T01:44:17.784Z | serve | stable | 0 | 0 | 0 | 1.31
2026-10-22T01:44:17.784Z | worker-history | stable | 0 | 0 | 0 | 82.46
2026-10-22T01:44:17.784Z | worker-post-909 | no-prior | - | - | - | 100
2026-10-22T01:44:17.784Z | rm2 | stable | - | - | - | -
2026-10-22T02:16:32.646Z | serve | stable | 0 | 0 | 0 | 1.31
2026-10-22T02:16:32.646Z | worker-history | stable | 0 | 0 | 0 | 82.46
2026-10-22T02:16:32.646Z | worker-post-909 | stable | 0 | 0 | 0 | 100
2026-10-22T02:16:32.646Z | rm2 | stable | - | - | - | -
2026-10-22T02:40:27.430Z | serve | stable | 0 | 0 | 0 | 1.31
2026-10-22T02:40:27.430Z | worker-history | stable | 0 | 0 | 0 | 82.46
2026-10-22T02:40:27.430Z | worker-post-909 | stable | 0 | 0 | 0 | 100
2026-10-22T02:40:27.430Z | rm2 | stable | - | - | - | -
2026-10-22T03:59:40.751Z | serve | stable | 0 | 0 | 0 | 1.31
2026-10-22T03:59:40.751Z | worker-history | stable | 0 | 0 | 0 | 82.46
2026-10-22T03:59:40.751Z | worker-post-909 | stable | 0 | 0 | 0 | 100
2026-10-22T03:59:40.751Z | rm2 | stable | - | - | - | -
2026-10-22T04:06:32.742Z | serve | stable | 0 | 0 | 0 | 1.31
2026-10-22T04:06:32.742Z | worker-history | stable | 0 | 0 | 0 | 82.46
2026-10-22T04:06:32.742Z | worker-post-909 | stable | 0 | 0 | 0 | 100
2026-10-22T04:06:32.742Z | rm2 | stable | - | - | - | -
2026-10-22T04:24:51.164Z | serve | stable | 0 | 0 | 0 | 1.31
2026-10-22T04:24:51.164Z | worker-history | stable | 0 | 0 | 0 | 82.46
2026-10-22T04:24:51.164Z | worker-post-909 | share-up | 116 | 116 | 0 | 100
2026-10-22T04:24:51.164Z | rm2 | stable | - | - | - | -
2026-10-22T04:49:46.360Z | serve | stable | 0 | 0 | 0 | 1.31
2026-10-22T04:49:46.360Z | worker-history | stable | 0 | 0 | 0 | 82.46
2026-10-22T04:49:46.360Z | worker-post-909 | stable | 0 | 0 | 0 | 100
2026-10-22T04:49:46.360Z | rm2 | stable | - | - | - | -
```

  - 同一份输出里可核的另一条：`worker` 在 `#1` 消失**没有**产生 `source-missing`（`worker-history` 与它同 baseline、同中心文件集 ⇒ 改名不是消失）。
- [x] AC4 暗态会立案：用真实的 `evaluated:false` 记录序列（该载体中存在）回放，连续 2 轮后判定为 `dark-streak` 并产出 finding；把序列减到 1 轮则判定为 `NOT-EVALUATED` 且不产出 finding。贴两次输出。
  - 回放用的真实记录：`2026-10-22T00:40:48.667Z`（`evaluated:false`，原因是 `worker-post-909: non-positive-denominator`）。命令：`node --no-warnings --experimental-strip-types /tmp/der-ev/ac4.mjs`。
  - 序列减到 1 轮：

```
=== A: ONE consecutive evaluated:false round ===
state   : not-evaluated
triggers: null
reason  : current-round-not-evaluated: rm1: worker-post-909: non-positive-denominator: centralΔ=0 nonCentralΔ=0 (sum 0) — a share of a non-growing subsystem is not a reading
findings: []
```

  - 连续 2 轮：

```
=== B: TWO consecutive evaluated:false rounds ===
state   : regression
triggers: [{"trigger":"dark-streak","target":"worker-post-909","deltaCentral":null,"deltaNonCentral":null,"deltaDenominator":null,"sharePercent":null,"darkRounds":2}]
findings: 1
  key       : evolution:worker-post-909:dark-streak
  trigger   : dark-streak
  darkRounds: 2
  files     : ["plugin/scripts/worker-driver.ts","plugin/scripts/worker-fan-in.ts"]
```

  - 阈值确实是**旋钮**而非常量：`dark_streak_rounds: 3` 时同一对记录回到 `not-evaluated`（单测 `AC4` 已钉）。
- [x] AC5 只写 finding 不写任务：`grep -n 'task_write\|createTask' plugin/scripts/design-evolution-readings.ts plugin/scripts/quality-gate-driver.ts` 对本次新增代码零命中；贴 grep 原文与本次改动的 diff 摘要。
  - 整文件 grep（两个文件）：**零命中**，`grep` 退出码 1。
  - 仅本次改动（`git diff develop...HEAD | grep '^+'`）：**零命中**，退出码 1。
  - diff 摘要：`plugin/scripts/design-evolution-readings.ts | 847 +`、`plugin/scripts/quality-gate-driver.ts | 73 +-`、`plugin/scripts/driver-config.ts | 11 +`、`plugin/test/design-evolution-readings.test.mjs | 306 +`（4 files, 1207 insertions, 30 deletions）。
  - 结构性保证（不只是 grep 通过）：finding 只 append 到 `.quay/routine-findings.jsonl`，任务由 `routine-file-gate` 那道闸的另一侧产生，本模块没有任何创建任务的能力。
- [x] AC6 每轮留痕：跑一次真实的读数轮，`.quay/design-evolution-history.jsonl` 新增 1 条记录，且同轮在评估载体里留下 `state`（即使为 `stable`）；贴新增记录与评估痕。
  - 命令（真实 git 读数 + 真实 `worker-outcome` 载体 + 真实上一条记录；history 用生产载体的逐字副本，以免在本工作树写 gitignored 之外的路径）：`node --no-warnings --experimental-strip-types plugin/scripts/design-evolution-readings.ts --root . --history /tmp/der-ev/ac6-history.jsonl --findings /tmp/der-ev/ac6-findings.jsonl --carrier /home/yale/work/quay/.quay/worker-outcome.jsonl`。
  - 载体 **9 行 → 10 行**（`wc -l` 前后各一次），`exit=0`，stderr：`record appended to /tmp/der-ev/ac6-history.jsonl`。
  - 新增记录的判定痕（`evolution` 字段，⛔ 不是只印在 stdout）：

```
evolution.state = stable
evolution.summary = stable @2026-10-22T05:00:25.900Z vs 2026-10-22T04:49:46.360Z
evolution.subsystems = [{"name":"serve","state":"stable","deltaCentral":0,"deltaNonCentral":0,"deltaDenominator":0,"sharePercent":1.31},
                       {"name":"worker-history",...82.46},{"name":"worker-post-909",...100},{"name":"rm2","state":"stable",...}]
has evolution field: True
```

  - 同一条命令在把上一条记录换成 `2026-10-22T04:06:32.742Z` 时（真实 git 读数，`worker-post-909` 从 172 涨到 288）走 **regression** 路径并真的写了 finding —— 见 AC7 的候选文本与 `## Definition of Done`。
- [x] AC7 接入既有闸：把一次 `regression` 的 finding 交给 `plugin/scripts/routine-file-gate.ts`，质量/去重/速率三道闸各有一次可复现的判定输出（至少展示 dedup 与 rate 两道的实际输出）；贴原文。
  - 候选来源：AC6 那条 regression 轮写进 `/tmp/der-ev/ac7-findings.jsonl` 的 finding，经 `routineFindingCandidateText` 渲染（同一条映射，未在测试/证据里另写一份）。命令：`node --no-warnings --experimental-strip-types plugin/scripts/routine-file-gate.ts --board <dir> --recent <n> --k 3 <candidate.md>`。

```
=== ① QUALITY arm（无证据的候选）===
REJECT: quality: no actionable `## Finding` with reproduction evidence
exit=1

=== ② ACCEPT（novel、空板、窗口内）===
ACCEPT: accepted: actionable, novel, within rate
exit=0

=== ②b DEDUP arm（同一主体已在板上、status: todo）===
REJECT: dedup: an equivalent finding is already OPEN on the board (matched key: symbols:evolution:worker-post-909:share-up, holder: gap-routine-worker-post-909-share-up.md [status: todo])
exit=1

=== ③ RATE arm（窗口内已有 3 条 routine 立案）===
REJECT: rate: 3 routine-filed tasks this window ≥ cap 3
exit=1
```

  - 三道闸的拒绝理由**互不同形**（`quality:` / `dedup:` / `rate:`），因此「被哪一道拒的」是可读的。

## Evidence

- 单测：`node --no-warnings --experimental-strip-types --test plugin/test/design-evolution-readings.test.mjs` → **41 tests / 41 pass / 0 fail / 0 skip**（其中 `AC3 (real carrier)` 在无运行态载体的工作树里回落到主检出的只读副本，故不再被跳过）。
- 驱动侧：`node --no-warnings --experimental-strip-types --test plugin/test/quality-gate-driver.test.mjs` → **107 pass**；`routine-file-gate.test.mjs` → **27 pass**。
- 围栏：`bash scripts/test.sh --for-task gap-design-evolution-readings-emit-findings --allow-thin` → **exit 0**（158 pass）。
- 防漂移：`anti-drift-touches-check.ts --task … --worktree … --merge-target develop` → `ANTI-DRIFT OK … 4 actual file(s), all within declared Touches (5 glob(s))`。
- 已声明的残留：`.quay/routine-findings.jsonl` 是 **tracked** 载体，本模块只 append、⛔ 不自行 commit（report-only 例程不得造提交）；落盘由既有 `probe-routine.ts` 对该路径的每轮 commit 带走。证据运行因此把 `--findings` 指向 `/tmp`，未污染工作树。

## Definition of Done

- 读数轮在 `regression` 时产出 finding、`stable` 时只留评估痕，两条路径都有真实运行输出（不是只有 fixture）。
  - `regression`：AC6/AC7 的真实轮 `state=regression — share-up:worker-post-909 (Δcentral=116 Δdenominator=116 Δnon-central=0 share=100%)`，同轮 `1 finding(s) appended to /tmp/der-ev/ac7-findings.jsonl`，记录内容见 AC7。
  - `stable`：AC6 的真实轮 `state=stable`，`findings: 0`，`evolution` 字段落在记录上。
- finding 经 `routine-file-gate` 可被 `quay:run-routines` 立案，且重复运行同一触发不会重复产生任务（dedup 生效的实测）。
  - AC7 ②b 的实测：同一条 finding 第二次进闸被 `dedup:` 拒，理由点名 `symbols:evolution:worker-post-909:share-up` 与持有者文件。跨轮同理：`AC2b` 证明两轮记录落成**同一个** subject key。
- 阈值全部来自配置且只有一处定义；文档里写明默认值为什么是策略选择而非测量结果。
  - `DESIGN_EVOLUTION_DARK_STREAK_ROUNDS_DEFAULT = 2` 定义在 `design-evolution-readings.ts` 一处（注释写明「策略选择，不是测量」），`driver-config.ts` 只做 re-export 派生，配置键 `dark_streak_rounds` 只**覆盖**它；非法值被拒绝而不是静默回落到 2。
- 首期范围限定在 quay 本工作区，claudecodeui 侧零改动。
  - 改动面只有 `plugin/scripts/*` 与 `plugin/test/*`；未触碰任何跨 workspace 的入口，也未向 claudecodeui 推送任何内容。

## Touches

- plugin/scripts/design-evolution-readings.ts
- plugin/scripts/quality-gate-driver.ts
- plugin/test/design-evolution-readings.test.mjs
- plugin/scripts/driver-config.ts
- tasks/gap-design-evolution-readings-emit-findings.md

## ADR-007 dark axis

- L_D design-evolution readings — serve_central_share_pct=1.31 worker_history_central_share_pct=82.46 worker_post_909_central_share_pct=100 worker_post_909_delta_central=116 worker_post_909_delta_denominator=116 worker_post_909_delta_non_central=0（真实载体 9 条记录逐条判定，2026-10-22，命令见 AC3）
- L_G：该轴仍暗,理由:本任务只新增一个纯判定函数 + 一次 append + 一次载体读取，未改变模块依赖结构（import 边只有 driver-config → design-evolution-readings 一条再导出），未取 archguard 读数，故不冒充测量。