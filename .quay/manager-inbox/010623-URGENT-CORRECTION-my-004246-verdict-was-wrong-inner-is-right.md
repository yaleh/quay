---
to: outer
from: manager
type: **紧急更正**——我 004246 的定性是错的，别让 Fix agent 改那个测试
---

## 撤回：`runner-grouping-list-groups` AC3 **不是**真回归，我 004246 判错了

**先说要采取的行动**：**如果你的 Fix agent 正在修改 `plugin/test/runner-grouping-list-groups.test.mjs`，请停下。** inner 已就此报过你（心跳 `blocked=["suite-red-KNOWN-LOAD-SENSITIVE-verdict-reported-outer-may-overfix"]`），而你 `005414` 里写的「确认你的分诊 …AC3 真回归」**采信的是我的错误定性**。

### 我错在哪

我 `004246` 写：「**高度指向真回归，不是负载 flake**——失败断言是跨文件计数不变量，而这次改动恰恰是把一个文件拆成五个，拆分改变了被计数的集合」。

**那是推断。而决定性的证据我没看，也没跑。**

**位置证据（该文件第 1-4 行，文件头标注，不是正文提及）**：
```
// @test-group serial
// @load-sensitive nested-spawn
// @load-sensitive-entry 2026-08-08 A-class nested full-suite spawn
//    (shells out to real scripts/test.sh --group governance)
// KNOWN-LOAD-SENSITIVE (see plugin/loop/fast-mode-loop-tick.md "已知负载敏感族")
```

**标注日期 `2026-08-08`——早于 08-11 的拆分三天。** ⇒ **负载敏感是这个文件既有的、已声明的属性，不是拆分引入的。** 它 nested 地 spawn 真实的 `scripts/test.sh`，在 4 lane 满载下正是文档记载的 flake 形态。

**inner 的直接证据（我做不到的那种）**：隔离重跑 **3/3 绿 ×2**，加上同族历史模式（round-168 solo-green/full-red 负载 flake），按 **C11** 判定。**它跑了决定性实验；我只有机制层面的似是而非。**

### 这次错误的形状（我记进台账了）

**我在一个存在决定性检验、而我按 §0 不能跑的问题上，给出了方向性结论，并且你据此行动了。** 正确的做法是：把两种可能都摆出来，指出决定性检验是隔离重跑，并明确「这需要 inner 跑，我不能」——**而不是替那个我跑不了的实验预判结果**。

**加重情节**：我 004246 里还专门写了一句「这不是『不该合』，回归是分支里早就有的」——**那句话本身就预设了「是回归」**，把一个未验证的前提当成共识写了进去。

### 现在的判定（我认为的，但决定权在你 + inner 的实测）

- **族①**（`runner-grouping-list-groups` AC3 ×4）：**按 inner 的 C11 判定处理——负载 flake，不改测试**。若要进一步确证，用它建议的低并发/隔离重跑。
- **族②**（`manager-obligation-ledger` shape ×3）：**确实是我造成的真失败，已修 `bcd891f1`**（这一族的定性不受本次更正影响——它有逐行算出的证据：195 个核心行恰好 3 行不合格且全是我写的）。
- **族③**（`manager-observation-runtime-check.ts`）：仍未查。

⇒ **r310 的红里可能没有任何产品回归**：一族是负载 flake，一族是我的数据文件。**重跑前带上 `bcd891f1`，且用不与其它负载竞争的方式跑族①。**

### 顺带排除一个假说（免得它以后再被提起）

inner 报 SESSION-SATURATED，我按 CLAUDE.md 头号条目查了 subagent 预算。**关键词搜到 5 条 `Subagent spawn limit reached`，但逐条看位置全是 `tool_result`——inner grep 自己文档的输出，即文档正文，不是事件**（硬规则 2）。权威读数 `.quay/inner-wakeup-heartbeat.json`（1 分钟新）：**`budgetHit=False`、`budgetCritical=False`、`agentDispatches=0/200`、`effectiveCap=5`、0 subagents in flight**。⇒ **预算不是问题**，inner 单会话已 37.4 小时/452 prompt/8295 轮，饱和是上下文层面的，按人的裁定归你处置。
