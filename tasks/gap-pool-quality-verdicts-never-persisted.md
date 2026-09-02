---
id: gap-pool-quality-verdicts-never-persisted
title: pool-quality-judge 判词从无载体——8 次判过的结果只活在 transcript，无法算准确率；已知 should-remove
  误判率 2/3 却无人可查
status: ready
labels:
  - gap
  - mechanism
parent: null
children: []
extra:
  schema: execution
---
**type:** execution

## Proposal

**实测（2026-09-02）**：pool-quality-judge（ADR-033）的**逐任务判词从来没有过一个可查的载体**。三条路径都不落盘：
- `.quay/quality-round.jsonl` **不存在**（`ls` 报 No such file）；`quality-gate-driver` 从未在生产激活过（`ps aux` 无该进程，`.quay/quality-control.json` 不存在，`gap-ac144-quality-gate-shape-separated-driver:13` 已 RETREATED 并记录此事）
- workflow 路径 `plugin/workflows/pool-quality-judge.js:159-167` 只 `return { actions, results, shouldRemoveIds }` 给调用方，**无任何持久化步骤**
- 现存唯一 quality 载体 `.quay/pool-quality-judge-state.json` 只有 `{"lastRound":627,"judgedAt":"..."}`，**是触发器状态，不含任何判词**

⇒ 判过的东西只活在 workflow transcript 里。本次取证必须走硬规则 5 的三步法（`grep -rl` 定位文件 → `inspect_session_files` → `grep` 取内容）才挖得出来，**且 meta-cc 对 `subagents/workflows/` 不递归，普通查询返回 0**。

**代价是一个具体的数字：判词准确率无人可算，而实测它很差。** 从 transcript 挖出全部 8 次 judged 运行，`should-remove` 共出现 **4 次、落在 3 个任务上**，逐个追踪归宿：

| 任务 | 是否被 apply | 今天的真实 status | 判词 |
|---|---|---|---|
| `gap-worker-driver-periodic-exit-resident` | 是（`f25b55812` rescope → `b74594a7f` superseded） | superseded | ✅ 对 |
| `gap-archguard-zero-production-calls` | 是（`b74594a7f`） | **done**（`900f7e5e2`，08-27 落地真代码） | ❌ 错 |
| `gap-verification-round-static-fail-no-record` | **否**（无人 apply） | **done**（`a96df90f0`，08-29 落地真重构） | ❌ 错 |

**误判率 2/3。唯一「存活」的机制是人工不作为。** 误判机理有完整纠错链：`gap-archguard-zero-production-calls` 12:01 被 apply 成 `superseded`、**12:05 被人工推翻**（`5f56036c6`，仅 4 分钟），推翻理由逐字「pool-quality-judge **误判** should-remove（**采信 07-20 过期注释**）」——judge 引用了一条 07-20 的代码注释当作当前事实，而该问题 07-23 已修（硬规则 4b 代理量的教科书形态）。**这 4 分钟窗口纯属侥幸**：apply 与复核恰好在同一个活跃会话里连续发生。

**本条只做载体，明确不做 auto-apply**（理由是上面的 2/3 误判率，以及两个未解前置）：
- `remove-or-rescope` **在全仓没有任何定义**——13 处命中全是 `actionFor()` 的 return 字面量、测试断言、注释复述，**零消费者零写盘**；ADR-033:26 与 `gap-pool-quality-semantic-gate:44` 都只写散文「撤出/重定范围」，没说改成什么 status。**这是一个待做的裁定，不是一个待写的实现。**
- 目标态 `superseded` 是人 2026-08-12 裁定的 **HARD terminal**，`packages/quay/src/gate/lifecycle.ts:36-45` 里 `ready→superseded` **没有合法边**（`superseded` 的 forward/back 双 null，注释逐字「Resurrection requires a human re-filing a fresh task」）⇒ 自动写入 = 机械制造不可逆状态。

**修法**：让判词落进 `.quay/quality-round.jsonl`（每轮一条记录，含逐任务 `{taskId, verdict, action, evidence, judgedAt, round}`），driver 与 workflow **两条路径都写**（双 writer 同形，参照 `verification-round` 的既有教训）。`should-remove` **只产出建议 + 标记待复核，不改任何 status**。载体建起来之后才谈得上算准确率基线，也才谈得上讨论 apply。

**相关任务（非重复，机制不同）**：`gap-b15-pool-quality-judge-state-persist`（done，补的是**触发器状态** `lastRound` 的写端，本条补的是**判词内容**的载体，两者是不同的量）；`gap-pool-quality-semantic-gate`（ADR-033 母任务）；`gap-ac144-quality-gate-shape-separated-driver`（RETREATED，driver 本体）。

## Acceptance Criteria

- [x] AC1: **载体写入（driver 路径）**——`quality-gate-driver.ts` 每轮 judge 完成后向 `.quay/quality-round.jsonl` 追加一条记录，含逐任务 `{taskId, verdict, action, evidence, judgedAt, round}` 五键以上；判词为空时不写空记录
- [x] AC2: **载体写入（workflow 路径）**——`plugin/workflows/pool-quality-judge.js` 与 `.claude/workflows/pool-quality-judge.js` **两副本**同样落盘且**字节一致**（`diff` exit 0）；单边编辑会被 drift-check 报红
- [x] AC3: **三态可区分（硬规则 3b）**——judge 未触发 / 判词解析失败 / 判过且有结果，三者在载体记录里取值不同，「读不懂」不得与「没问题」同形
- [x] AC4: **不改 status（本条的范围硬边界）**——实现后 `grep` 确认 quality 路径无任何 `status:` 写入、无 `superseded` 写入；`should-remove` 只落进载体记录与建议输出
- [x] AC5: **真实生产载体验证（非 fixture）**——实现落地**之后**跑一次真实 judge，`.quay/quality-round.jsonl` 中出现 ≥1 条含逐任务判词的记录，且 `judgedAt` 晚于实现落地时刻（硬规则 4 推论三：只计落地后的时间窗）
- [x] AC6: **负控制（能取假）**——关掉写入那一步后重跑，载体不增长；恢复后增长。两次读数都贴出来
- [x] AC7: **既有不回归**——`--for-task` scoped 门 + 全量 suite 绿；`.quay/pool-quality-judge-state.json` 的既有触发器语义不变

## Definition of Done

一次**真实**（非 fixture、非注入）的 pool-quality-judge 运行在 `.quay/quality-round.jsonl` 里留下了含逐任务判词的记录，且该记录的 `judgedAt` 晚于本任务实现的落地时刻——**判据读生产载体，不读测试**；AC6 的双向负控制读数已贴出；两个 workflow 副本 `diff` exit 0；实现后经 `grep` 证明 quality 路径**零 status 写入**（本条明确不引入 apply）；改动经 fan-in 落到 develop 并可 `git show develop:` 核验。**后续的准确率基线与 apply 与否是另一条任务，本条不做也不预设结论。**

## Touches

- plugin/scripts/quality-gate-driver.ts（每轮判词追加写 .quay/quality-round.jsonl + 三态取值）
- plugin/scripts/pool-quality-judge.ts（聚合结果携带逐任务判词记录结构供落盘）
- plugin/workflows/pool-quality-judge.js（workflow 路径同样落盘；与 .claude 副本字节一致）
- .claude/workflows/pool-quality-judge.js（双副本之二，须与 plugin 副本字节一致）
- plugin/test/quality-gate-driver.test.mjs（载体写入断言 + AC6 负控制）
- plugin/test/pool-quality-judge.test.mjs（判词记录结构与三态断言）
- tasks/gap-pool-quality-verdicts-never-persisted.md（自身）
