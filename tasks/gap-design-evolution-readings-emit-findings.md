---
id: gap-design-evolution-readings-emit-findings
title: 设计演化读数只报不动作——不产出 finding、与既有立案通道零接线；改为在相对回归与连续 未评估时产出可去重的 finding，交现成
  routine-file-gate 立案
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

## Acceptance Criteria

- [ ] AC1 四态可分：单测覆盖 `stable` / `regression` / `no-prior` / `NOT-EVALUATED` 四种输入，断言 `no-prior` 的输出与 `stable` 在判别字段上不同、`NOT-EVALUATED` 携带非空 reason 且不带 `triggers: []`；贴测试名与断言条数。
- [ ] AC2 去重键跨轮稳定：同一子系统同一 trigger 的两条 finding，即使理由文字完全不同，机械 key 相同；不同 trigger 或不同子系统 key 不同。用两条真实格式的 finding 文本跑 `routine-file-gate` 的 dedup 分支验证，贴两次判定与 key。
- [ ] AC3 读真实载体（非注入）：对 `.quay/design-evolution-history.jsonl` 现有的 7 条真实记录逐条跑判定，输出每条记录的 `{ts, subsystem, state, Δcentral, Δdenominator}` 全表。预期：**至少 1 条 `share-up`**，且必须点名 `worker-post-909` 在 `2026-10-22T04:24:51.164Z` 那条（相对上一条 Δcentral=116、Δdenominator=116、非中心增量 0）；其余为 `stable`。若判定为 0 条 `share-up`，说明增量口径写错了。贴完整表与判定命令。
- [ ] AC4 暗态会立案：用真实的 `evaluated:false` 记录序列（该载体中存在）回放，连续 2 轮后判定为 `dark-streak` 并产出 finding；把序列减到 1 轮则判定为 `NOT-EVALUATED` 且不产出 finding。贴两次输出。
- [ ] AC5 只写 finding 不写任务：`grep -n 'task_write\|createTask' plugin/scripts/design-evolution-readings.ts plugin/scripts/quality-gate-driver.ts` 对本次新增代码零命中；贴 grep 原文与本次改动的 diff 摘要。
- [ ] AC6 每轮留痕：跑一次真实的读数轮，`.quay/design-evolution-history.jsonl` 新增 1 条记录，且同轮在评估载体里留下 `state`（即使为 `stable`）；贴新增记录与评估痕。
- [ ] AC7 接入既有闸：把一次 `regression` 的 finding 交给 `plugin/scripts/routine-file-gate.ts`，质量/去重/速率三道闸各有一次可复现的判定输出（至少展示 dedup 与 rate 两道的实际输出）；贴原文。

## Definition of Done

- 读数轮在 `regression` 时产出 finding、`stable` 时只留评估痕，两条路径都有真实运行输出（不是只有 fixture）。
- finding 经 `routine-file-gate` 可被 `quay:run-routines` 立案，且重复运行同一触发不会重复产生任务（dedup 生效的实测）。
- 阈值全部来自配置且只有一处定义；文档里写明默认值为什么是策略选择而非测量结果。
- 首期范围限定在 quay 本工作区，claudecodeui 侧零改动。

## Touches

- plugin/scripts/design-evolution-readings.ts
- plugin/scripts/quality-gate-driver.ts
- plugin/test/design-evolution-readings.test.mjs
- plugin/scripts/driver-config.ts
- tasks/gap-design-evolution-readings-emit-findings.md
