---
id: gap-meta-divergence-recommendation-recurrence-invisible
title: divergences 是唯一没有执行器的通道，而 meta-driver 每轮全新上下文 ⇒ 结构上无法发现自己已重复同一建议 5 轮
status: ready
labels:
  - gap
  - defect
  - meta-driver
parent: null
children: []
extra: {}
---
## Finding

**结论**：`divergences` 是四条输出通道里**唯一没有执行器**的一条，而 meta-driver **在结构上无法发现这一点**——因为它每轮全新上下文，且读数里没有任何自我历史。

**实测（全载体累计）**：meta-driver 迄今共 offered **7 项**（autoDrive 5 / decision 2 / proposal 0），逐条核对，**没有一条**关于「divergences 无执行器」。

**它为什么发现不了（两条并列，缺一不可）**：
1. `.quay/profiles.yml:77` 明写设计：「短命 claude -p，每轮全新上下文——**抗漂移靠这个**，不靠提示词」。
2. `MetaRoundReadings`（`meta-driver.ts:80-92`）= `goals / criteria / divergences / drivers / syncHealth / addressedTasks / focus`——**没有任何自我历史**；`drivers` 里 meta 那条也只有 carrierRecords/staleSecs 计数，不含内容。
⇒ 每一轮它都是**第一次**看见同一条偏离，给出同样正确的解读，**无从知道这条建议已被忽略过 4 次**。

**代价已实测**：19:20 / 19:46 / 20:03 / 20:27 / 20:45 **连续五轮**对 AC-177 给出同一条解读与同一条建议（「判据读的是生产载体 `.quay/goal-round.jsonl`、≥3 条带 verdict 的真实记录，非 fixture ⇒ 判据够强，是记录滞后」→「翻 achieved」），跨约 **2 小时无人执行**。五轮的语义半都真跑了（各 293–645 秒）。

**通道对比（为什么说它是唯一没有执行器的）**：
| 通道 | 产出落到哪里 |
|---|---|
| `autoDrive` | `quay-native task create` ⇒ 真任务，被 promotion/worker 接手 |
| `decisions` | draft GOAL 或 needs-human 任务 ⇒ 有可关闭的面 |
| `proposals` | `goal-store write` ⇒ 真 AC 记录 |
| **`divergences`** | **只有一句 recommendation 写进轮记录，没有任何机制消费它** |

⊢ 这是本项目反复出现的同一形状**今天的第三个实例**：①`interpretations` 曾只留计数、丢弃正文（已修，2026-09-06 15:52）；②`STATIC_CHECK_NOT_EVALUATED` 只写 stderr 从不落库（已立 `gap-not-evaluated-checkers-never-persisted`）；③本条——**正文现在落库了，却没有任何读者**。信息被诚实产生，然后没被送到能用它的地方。

**⛔ 修法不是给它加记忆**：往 prompt 里塞历史会直接破坏 `profiles.yml:77` 声明的抗漂移设计。正确形态是——**把一个机械可算的量作为读数交给它**：从它自己的载体 `.quay/meta-driver-round.jsonl` 算出「这条 (id, kind) 已连续多少轮给出建议」，作为 `divergences` 的一个字段或一项独立读数。机械层算术、语义层判断，与 ADR-033 的切分一致。

**⚠️ 一个必须避开的陷阱**：该重复计数**不得进 `readingsDigest`**。它每轮都会变（+1）⇒ 摘要恒不相等 ⇒ 变化检测闸失效 ⇒ 每轮都派 LLM，成本直接翻数倍。这与载体里已有的注释同源（「⛔ 不取 staleSecs/记录数——它们每轮都变，取了会让摘要恒不相等」）。

## AC

- [ ] 读数里出现可枚举的重复计数：对每条 divergence 给出「已连续多少轮产生同一 (id, kind) 的建议」，且**逐条带上 id 与上次的 recommendation 文本**（⛔ 不是一个总数——SPEC §5.3：不枚举、不给对象、零指引价值）。
- [ ] 能取假：喂一个含同一 (id, kind) 连续 5 轮记录的载体 ⇒ 该条计数为 5；喂一个空载体 ⇒ 计数为 0。两个方向都要断言。
- [ ] ⛔ 该计数**不进** `readingsDigest`：断言在只有重复计数变化（无 verdict/status/偏离类别变化）时 `readingsDigest` 返回值**不变**。这条是成本护栏，必须能取假。
- [ ] probe 规格写明如何使用：一条建议连续重复 ≥N 轮而对象状态未变 ⇒ **这本身就是「该通道缺执行器」的证据**，属 `autoDrive` 的适用形态（机制失败 + 修法是修那个机制 + 可由命令判定），⛔ 不是再重复一次那条建议。

## DoD

- [ ] 上述判据本轮实跑并贴出输出，⛔ 不是转述。
- [ ] 生产载体证据（非 fixture）：改动落地后至少一轮真实记录里出现非零重复计数，或说明当前无重复项（且该说明由读数支撑，不是断言）。
- [ ] ⛔ 未向 probe prompt 注入历史上下文——抗漂移的「每轮全新上下文」保持不变；新增的只是一个机械算出的读数字段。
- [ ] ⛔ 未给 `divergences` 加自动执行器（例如自动翻 achieved）——那是另一个决定，且 probe 规格明写「⛔ You never flip a status yourself」。本条只让「无人执行」这件事变得可被发现。

## Touches

- `plugin/scripts/meta-driver.ts`
- `plugin/probes/meta-driver.md`
- `plugin/test/meta-driver.test.mjs`
- `tasks/gap-meta-divergence-recommendation-recurrence-invisible.md`
