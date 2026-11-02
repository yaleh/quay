# prompt 内联数据扫描（按机制，非按体积）— 2026-11-02

> 只读扫描、可复跑。本报告回答「还有别处也把数据整段内联进 prompt 吗」，并给每个命中按
> **机制**（组装点是否插值大结构）分类与处置。⛔ 本条**不改任何 prompt 内容**；命中项各自给处置，
> 改动另立任务。

## 结论先给

`gap-meta-driver-probe-readings-inline-over-1mb`（done）修掉的 `meta-driver buildProbePrompt` 是
**唯一**「同一份 readings 逐轮重发」的形态——改造后已落盘 + 路径指针（`readings file:`），本报告判定为
`pointer`。其余组装点分三类：

1. **固定指令**（`fixed-prose`）：`worker`（4,128）、`probe-runner`（12,292）体积最大，但插值的是
   task/root/objective 这类**逐字必要的标量或散文**，不是数据结构。
2. **仍内联、但 <4KB 且逐调用语义必要**（`inline-data`）：`arch-judge`（3,064）、`sufficiency-judge`
   （2,050）、`pool-judge`（1,627）、`fix-worker`（256）——每个调用判的是**不同的**集群/目标/任务，
   不是「同一份数据逐轮重发」。
3. **非 prompt**：`buildReadings`/`readingsDigest`/`objectiveAssertionCommand` 等命中插值了大结构，
   但产物是数据记录/摘要/复核命令，不是发给模型的 prompt。

**没有任何残余命中复现 meta-driver 那种 >1MB 的逐轮重发形态。** 结论不依赖未测量的体积估算——每个
「仍内联」命中要么带真实生产读数（sessionId + 首条 user 消息字符数 + 读取时刻），要么显式
`not-evaluated`（该角色在会话语料里没有生产执行记录，见下文）。

## 方法：`scripts/prompt-inline-scan.mjs`

只读、可复跑。分类**互斥五值**（枚举不布尔，硬规则 3）：

| 分类 | 判定（按位置，非按关键词） |
|---|---|
| `inline-data` | `JSON.stringify(…)` 进模板/join；或 `.map(…).join(…)` 渲染集合；或模板串插值「数据变量名」 |
| `fixed-prose` | 只拼静态文本 + 标量插值（task/root/objective/name…），无数据结构内联 |
| `pointer` | 写盘（writeJsonAtomic/writeFileSync…）+ prompt 只带 `file:` 路径指针 |
| `not-a-prompt` | 命中了 prompt 关键词但实际是日志/响应/度量输出 |
| `not-evaluated` | 读不懂/无组装形状——独立取值，⛔ 不与「干净/fixed-prose」共用输出 |

枚举来源（先 `stripComments` 去掉注释，故注释/字符串正文里提到不算命中，硬规则 2）：

1. 名字含 `prompt/brief/readings/preamble/objective/instructions` 的**函数声明**，且函数体含组装标记
   （模板串 / `.join(` / `JSON.stringify(`）。
2. 把字符串直接喂给 `spawn`/`stdin` 的**内联 sink 行**（`stdinData:`/`stdin.write(`/`launchArgv(`），
   且该行内联了组装。
3. prompt 名命中的**模板字面量赋值**（`const prompt = \`…\${data}…\``）。

数据变量名启发式（`inline-data` 第三信号）是**有边界**的：`${evidencePack}`/`${plan}` 这类渲染好的
数据集判定 `inline-data`，而 `${task}`/`${root}`/`${objective}` 这类标量/散文判 `fixed-prose`。误报由
下方逐条人工复核兜底（AC3/AC4）。

## AC2 干跑证据（零计数的配套动作）

把扫描谓词对着**已知为真**的样本干跑：git 历史中改造前的 `buildProbePrompt`（`268a68057^`，patch 前
版本），必须判 `inline-data`——否则「零命中」只是谓词失效。

命令：

```bash
git show 268a68057^:plugin/scripts/meta-driver.ts | sed -n '2372,2379p' | node scripts/prompt-inline-scan.mjs --classify-stdin
```

输出：

```json
{
  "kind": "inline-data",
  "reason": "JSON.stringify(…) interpolated into the prompt",
  "signals": {
    "template": false,
    "join": true,
    "jsonStringify": true,
    "mapJoin": false,
    "writeMarker": false,
    "pathPointer": false,
    "interpolation": false,
    "literal": true
  }
}
```

该样本改造前的形态是 `[objective, "READINGS…", JSON.stringify(readings)].join("\n")`——正是 meta-driver
>1MB 内联的根因。谓词对真样本命中 ⇒ 扫描器的 `inline-data` 判定不是空转。

## 分类计数

| 分类 | 计数 |
|---|---|
| inline-data | 13 |
| pointer | 1 |
| fixed-prose | 21 |
| not-a-prompt | 0 |
| not-evaluated | 0 |

## 完整命中清单（file:line + 分类）

| file:line | 分类 | 组装点 |
|---|---|---|
| cross-project-dogfood-routine.ts:1147 | inline-data | verifierTemplate |
| cross-project-dogfood-routine.ts:1148 | inline-data | refuterTemplate |
| cross-project-dogfood-routine.ts:1151 | inline-data | prompt（investigator） |
| design-evolution-readings.ts:1187 | inline-data | buildReadings |
| goal-driver.ts:1219 | inline-data | buildSufficiencyPrompt |
| goal-driver.ts:1637 | inline-data | objectiveAssertionCommand |
| goal-driver.ts:1669 | inline-data | buildObjectivePrompt |
| meta-driver.ts:1512 | inline-data | readingsDigest |
| open-semantic-discovery-routine.ts:2406 | inline-data | buildNoveltyPrompt |
| open-semantic-discovery-routine.ts:4978 | inline-data | shadowPrompt |
| promotion-driver.ts:366 | inline-data | buildFixWorkerPrompt |
| quality-gate-driver.ts:720 | inline-data | poolJudgePrompt |
| quality-gate-driver.ts:967 | inline-data | archReviewJudgePrompt |
| meta-driver.ts:2382 | pointer | buildProbePrompt |
| channel-probe-server.ts:137 | fixed-prose | buildInstructions |
| cross-project-dogfood-routine.ts:660 | fixed-prose | verifierLookupPreamble |
| effective-capacity-probe.ts:363 | fixed-prose | collectReadings |
| goal-driver.ts:388 | fixed-prose | (sink) |
| goal-driver.ts:392 | fixed-prose | (sink) |
| goal-driver.ts:1551 | fixed-prose | collectObjectiveEvidence |
| goal-driver.ts:1758 | fixed-prose | objectiveCacheKey |
| goal-driver.ts:2726 | fixed-prose | buildGapWorkerPrompt |
| goal-driver.ts:2805 | fixed-prose | buildSufficiencyFollowupPrompt |
| manager-tick-readings.ts:96 | fixed-prose | resourceReadings |
| meta-driver.ts:1497 | fixed-prose | readingsDigestPartsForActionFailures |
| open-semantic-discovery-routine.ts:500 | fixed-prose | buildAnswerReservePrompt |
| open-semantic-discovery-routine.ts:2109 | fixed-prose | refutationPromptFor |
| probe-routine.ts:902 | fixed-prose | buildProbePrompt |
| profiles-role-coverage-check.ts:166 | fixed-prose | (sink) |
| quality-gate-driver.ts:576 | fixed-prose | buildPackagingGapWorkerPrompt |
| quality-gate-driver.ts:1022 | fixed-prose | buildArchGapWorkerPrompt |
| quality-gate-driver.ts:3258 | fixed-prose | buildInstrumentDecayGapWorkerPrompt |
| verify-plugin-channel-assertions.ts:490 | fixed-prose | judgeDriverStatusReadings |
| worker-driver.ts:2697 | fixed-prose | buildWorkerPrompt |
| worker-driver.ts:4409 | fixed-prose | buildContinueWorkerPrompt |

## inline-data 逐条处置（AC4）

| 命中 | 处置 | 依据 |
|---|---|---|
| meta-driver.ts:2382 buildProbePrompt | **已改为指针** | 前任务已修：readings 落盘 `<root>/.quay/meta-driver-readings.json`，prompt 只带 `readings file:` 路径 + 摘要 + 按需 Read 指令 |
| quality-gate-driver.ts:720 poolJudgePrompt | 仍内联 | `${JSON.stringify(plan.tasks)}` 逐调用不同池任务，语义必要 |
| quality-gate-driver.ts:967 archReviewJudgePrompt | 仍内联 | `clusters`/`priorFindings` `.map().join()` 进 prompt，逐调用不同集群 |
| goal-driver.ts:1219 buildSufficiencyPrompt | 仍内联 | goal body + 范围节 + AC 列表 `.map().join()`，逐 goal 语义必要 |
| promotion-driver.ts:366 buildFixWorkerPrompt | 仍内联 | `missing` 列表 `.map().join()`，逐任务不同 |
| goal-driver.ts:1669 buildObjectivePrompt | 仍内联 | 证据概况 + 逐条证据 `.map().join()`，逐 goal 语义必要 |
| open-semantic-discovery-routine.ts:2406 buildNoveltyPrompt | 仍内联 | `finding`/`candidates`/`broad` `JSON.stringify(…)` 进模板 |
| cross-project-dogfood-routine.ts:1147/1148/1151 | 仍内联 | `lookup`/`evidencePack` 数据渲染后插值进 investigator/verifier/refuter 模板 |
| open-semantic-discovery-routine.ts:4978 shadowPrompt | 仍内联 | `selection.shadow_text` 等插值；shadow arm 是草稿方法的未验证假设臂 |
| design-evolution-readings.ts:1187 buildReadings | **非 prompt** | 产物是 design-evolution readings 数据记录，不是发给模型的 prompt |
| meta-driver.ts:1512 readingsDigest | **非 prompt** | 产物是读数稳定摘要（变化检测 hash），不是 prompt |
| goal-driver.ts:1637 objectiveAssertionCommand | **非 prompt** | 产物是 `python3 -c …` 机械复核命令，不是模型 prompt |

## 生产读数（AC4：sessionId + 首条 user 消息字符数 + 读取时刻）

读取方式：对 `~/.claude/projects/-data-home-yale-work-quay/*.jsonl` 逐会话取**首条 user 消息**，按
prompt 前缀匹配角色；每角色取 mtime 最新的一条。读取时刻 `2026-11-02T15:10:40.223Z`。

| 角色（仍内联命中） | sessionId | 首条 user 消息字符数 | 会话 mtime |
|---|---|---|---|
| arch-judge | `aa945614-e5d8-406d-8fb0-bf1d31217336` | 3,064 | 2026-11-02T14:35:46Z |
| sufficiency-judge | `d8564ef3-a1e5-4eda-b130-b7beb90549ea` | 2,050 | 2026-10-30T07:09:21Z |
| pool-judge | `4544baa2-73b1-47cc-a19f-8cf4b6fb854b` | 1,627 | 2026-11-02T13:33:28Z |
| fix-worker | `7cb522a6-97ce-45fe-9ea1-278335097227` | 256 | 2026-11-01T12:41:25Z |
| cross-project-investigator | not-evaluated | — | — |
| cross-project-verifier | not-evaluated | — | — |
| cross-project-refuter | not-evaluated | — | — |
| novelty-check | not-evaluated | — | — |
| objective-judge | not-evaluated | — | — |
| shadow-investigator | not-evaluated | — | — |

`not-evaluated` 的原因：这些角色在会话语料里**没有**首条 user 消息即该 prompt 的生产执行记录
（`grep -r` 命中的只是实现这些文件的 worker 会话在其 tool_use 里引用该 prompt 文本，不是角色自身被
invoke 的会话）。缺值 = 未查（硬规则 3/5），⛔ 不把「没读到生产读数」写成「体积为 0」或编一个静态估算。

## top-3 候选的实测体积与预期节省（AC5）

按「仍内联」中实测体积排序：

| 候选 | 实测体积（首条 user 消息字符数） | 预期节省 |
|---|---|---|
| archReviewJudgePrompt（arch-judge） | 3,064 | not-evaluated |
| buildSufficiencyPrompt（sufficiency-judge） | 2,050 | not-evaluated |
| poolJudgePrompt（pool-judge） | 1,627 | not-evaluated |

预期节省 **not-evaluated** 的理由：这三条都是**逐调用语义必要输入**（每次判的是不同的集群/目标/池），
不存在 meta-driver 那种「同一份数据逐轮重发」的可对照基线；无基线就无从给节省数值（硬规则 4：不设
未测量的数值阈值，不估算）。它们距离 meta-driver 修复前的 1,286,071 字符有 ~3 个数量级的差距。

## 明确声明

本条**只做扫描与计量，不改任何 prompt 内容**。`plugin/scripts/meta-driver.ts` 与
`plugin/scripts/worker-driver.ts` 的 diff 为空；本任务新增 `scripts/prompt-inline-scan.mjs`、
`scripts/prompt-inline-scan.test.mjs`、本报告，并只经 `task_write` 勾选 AC。

## 人工核对（AC3：≥3 个组装点，按位置判定）

1. `quality-gate-driver.ts:720 poolJudgePrompt` — 核对源码第 725 行
   `` `Mechanical input per task … ${JSON.stringify(plan.tasks)}.` `` 确为 `JSON.stringify` 进模板 ⇒
   `inline-data`，位置与分类一致。
2. `quality-gate-driver.ts:967 archReviewJudgePrompt` — 核对源码第 968-973 行
   `clusters.map(...).join("\n")` / `priorFindings.map(...).join("\n")` 渲染集合 ⇒ `inline-data`，一致。
3. `meta-driver.ts:2382 buildProbePrompt` — 核对源码第 2388-2404 行 `writeJsonAtomic(readingsPath, …)`
   落盘 + `readings file: ${readingsPath}` 路径指针 ⇒ `pointer`，一致。
4. `worker-driver.ts:2697 buildWorkerPrompt` — 核对源码，只插值 `${task}`/`${root}`/`${…Note()}` 固定
   指令与标量 ⇒ `fixed-prose`，一致（体积 4,128 但非内联数据）。
5. `probe-routine.ts:902 buildProbePrompt` — 核对源码，插值 `objective`（逐字来自
   `plugin/probes/<name>.md` 的方法散文）+ workspace/name 标量 ⇒ `fixed-prose`，一致（体积 12,292
   但非内联数据）。

## 复跑命令

```bash
node scripts/prompt-inline-scan.mjs --root . --json     # 机器可核 JSON（计数 + 命中清单）
node scripts/prompt-inline-scan.mjs --root .            # markdown 报告
node --test scripts/prompt-inline-scan.test.mjs         # 单元/反例测试（AC1）
```
