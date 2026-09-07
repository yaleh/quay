---
id: gap-meta-divergences-not-routed-by-handler-existence
title: divergences 三种 kind 输出同形，其中 99.3% 有处理者会自愈 ⇒ 259 次把「goal-driver 停了」报成 259
  条 AC 症状，病因就在它自己的读数里却从未被报出
status: done
labels:
  - gap
  - defect
  - meta-driver
parent: null
children: []
extra:
  schema: execution
  acceptance: node --experimental-strip-types --test plugin/test/meta-driver.test.mjs
depends_on:
  - gap-meta-divergence-recommendation-recurrence-invisible
---
## Finding

**结论**：`computeDivergences` 产出三种 kind，**输出形态完全相同**，但它们的处理者存在性截然不同——两种有处理者（会自愈），一种没有。同形导致的直接代价：**259 次把「goal-driver 没在跑」报成 259 条 AC 的状态症状，而病因（`drivers.goal.staleSecs`）就在同一份读数里，一次也没被报出来。**

### 一、按 kind 拆开后结构完全不同（全载体累计，非窗口采样）

`.quay/meta-driver-round.jsonl` 共 951 轮，其中 61 轮有 `facts[0].value` 内容，累计 **762 条**偏离：

| kind | 次数 | 处理者 | 实证（可复核） |
|---|---|---|---|
| `no-criterion` | **481**（AC-143..155 共 13 条 × 37 轮，09-06T14:25→19:04） | task → worker，**但需被显式触发** | 补判据的 task 于 19:03 落地，该类**当轮消失** |
| `pass-but-unflipped` | **276**（AC-170..179、181） | goal-driver `:267`，**全自动** | goal-driver 于 21:47 常驻；**AC-177 于 21:54 被 `goal-store` 写自动翻 achieved**（`a885938ec`），该类随即消失 |
| `achieved-but-failing` | **5**（AC-172 × 4、AC-179 × 1） | **无**（见 `gap-goal-achieved-but-failing-no-handler`） | AC-172 自 01:48 报到 02:47，立案时仍在报 |

⇒ **757/762 = 99.3% 属于「有处理者、会自愈」的种类**；真正需要人或新机制的只有 5 条，而它们在输出里与那 757 条**逐字段同形**。

### 二、最贵的一次：报了 259 遍症状，从未报病因

09-06T14:25→19:04 的 `pass-but-unflipped` 共 7 个 AC（AC-170..176）× 37 轮 = 259 条。逐条读它们的解读，全部是「判据够强，是记录滞后 ⇒ 应翻 achieved」——**每一条都正确**。

而这 7 条同时不翻的真因只有一个：**那段时间 goal-driver 根本没有常驻**（`.quay/goal-round.jsonl` 按小时分桶：19 时 3 轮（手工干跑）、20 时 **0 轮**、21 时 17 轮起才是常驻）。

**关键**：`drivers` 读数里就有 `{kind:"goal", running, staleSecs, carrierRecords}`——**病因是它自己每轮都读到的量**。它却把结论落在了 7 个 AC 上，而不是落在 `drivers.goal` 上。

⊢ 这是硬规则 4b 的教科书形态：**AC 的未翻状态是代理量，goal-driver 的活性是直接量**；报代理量得到 259 条正确但无用的结论，报直接量只需 1 条。

### 三、错的分类轴

现有 `computeDivergences` 按「AC 的 status × verdict 组合」分类。**这个轴决定不了该输出什么**——同一组合（pass 而未翻）在 goal-driver 活着时是**正常时延窗口**（实测 <7 分钟），在它停摆时是**唯一值得报的事**（而且该报的对象不是 AC）。

**正确的轴是「这条偏离的处理者是否存在、是否在跑」**：

| 处理者状态 | 该输出什么 | ⛔ 不该输出什么 |
|---|---|---|
| 存在且健康 | **什么都不输出**（降为 reading，等它处理） | 一条针对该对象的偏离 |
| 存在但停摆/陈旧 | **一条针对该处理者的结论**（"goal-driver 停了 N 秒"） | N 条针对被处理对象的症状 |
| 存在但需显式触发（`no-criterion`） | **一次** autoDrive（出 task） | 每轮重报同一条 |
| **不存在** | escalate（这才是 divergence 的本义） | 与前三类同形的输出 |

### 四、与既有任务的关系（⚠️ 非重复，且有先后）

`gap-meta-divergence-recommendation-recurrence-invisible`（AC/DoD 已全勾，因 fan-in FF anti-livelock 停在 needs-human）加的是**重复计数**：一条建议已连续多少轮。本条加的是**处理者存在性路由**。两者互补且**本条要建在它之上**：重复计数回答「重复了几轮」，处理者路由回答「而且本来就没人会动」——只有合起来才能把「等待中」与「无人管」区分开。两者 Touches 相交（同一批文件），故本条 `depends_on` 它，⛔ 不并发。

### 五、成本护栏（沿用前一条任务已确立的约束）

新增的处理者状态判定**不得进 `readingsDigest`**：`staleSecs` 每轮都变，取了会让摘要恒不相等 ⇒ 变化检测闸失效 ⇒ 每轮都派 LLM。载体里已有同源注释（「⛔ 不取 staleSecs/记录数」）。可进摘要的是**离散化后的处理者状态**（healthy / stalled / absent），⛔ 不是秒数本身。

**方向倾向（供执行者判断，非强制）**：在 `computeDivergences` 产出的每条偏离上加一个机械可算的 `handler` 字段（`{kind, present, healthy}` 或三态枚举），由 `drivers` 读数派生；probe 规格据此规定输出纪律。⛔ **不接受**：把 `pass-but-unflipped` 直接删掉（goal-driver 停摆时它是唯一信号）；⛔ 在机械层直接替 LLM 下结论说"goal-driver 停了"（SPEC §5.3：语义解读归 probe，机械层只做证据采集与结构性不变式）。

## AC

- [x] 每条 divergence 携带可枚举的处理者信息：至少给出处理者标识与三态之一（存在且健康 / 存在但停摆 / 不存在），⛔ 不是布尔、不是总数；且「不存在」与「读不出」是**不同取值**（硬规则 3b：读不懂不得与合格同形）。
- [x] 三态双向能取假：喂一个 `drivers.goal` 健康的读数 ⇒ `pass-but-unflipped` 标为「处理者健康」；把同一读数改成 goal 缺席/陈旧 ⇒ 同一条偏离改标「停摆」或「不存在」；`achieved-but-failing` 在**两种**读数下都标「不存在」（因为它的处理者与 goal-driver 无关）。三个断言缺一不可。
- [x] ⛔ 该字段**不进** `readingsDigest`：断言「仅 `staleSecs` 数值变化而三态不变」时 `readingsDigest` 返回值**不变**；且「三态发生变化」时摘要**改变**。两个方向都断言——这条是成本护栏，必须能取假。
- [x] probe 规格写明输出纪律，且纪律可被判定：处理者健康 ⇒ 不就该对象产出 divergence；处理者停摆 ⇒ 结论落在**处理者**上（而非逐条列被处理对象）；处理者不存在 ⇒ 才是 escalate 的适用形态。
- [x] 既有行为不回归：承诺态判定（`active`/`achieved` 之外一律不报偏离）与三种 kind 的判定逻辑本身不变，`plugin/test/meta-driver.test.mjs` 全绿。

## DoD

- [x] 上述判据本轮实跑并贴出输出（⛔ 不是转述），三态与摘要护栏的负控制均实跑确认能取假。
- [x] **生产载体证据（非 fixture）**：改动落地后至少一轮真实记录里，每条 divergence 都带上非空的处理者三态；若彼时无偏离，须贴出「本轮确无偏离」的读数支撑（⛔ 不得以 fixture 通过冒充生产已验，硬规则④推论三）。
- [x] 用本任务实测的历史现场做一次回放核对：以 09-06T14:25–19:04 那段的读数形态（goal-driver 缺席）为输入，新逻辑须把 7 条 AC 的偏离归为「处理者停摆」，⛔ 而不是产出 7 条针对 AC 的偏离。
- [x] ⛔ 未向 probe prompt 注入历史上下文（抗漂移的「每轮全新上下文」不变，`.quay/profiles.yml:77`）；⛔ 未在机械层替 probe 下语义结论（SPEC §5.3）；⛔ 未删除 `pass-but-unflipped` 这一 kind。
- [x] ⛔ 未新增 driver kind、未新增周期性检查器（SPEC §5.1）。

## Touches

- `plugin/scripts/meta-driver.ts`
- `plugin/probes/meta-driver.md`
- `plugin/test/meta-driver.test.mjs`
- `docs/analysis/quay-init-closure-ratchet.baseline.json`
- `tasks/gap-meta-divergences-not-routed-by-handler-existence.md`