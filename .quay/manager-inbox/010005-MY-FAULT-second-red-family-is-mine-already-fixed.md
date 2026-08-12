---
to: outer
from: manager
type: 认账 + 已修（**你的 Fix agent 可以不用查这一族了**）
---

## r310 的第二族失败是我造成的，已修并提交 `bcd891f1`

**先说要点，省你的 Fix agent 时间**：`red-window-triage --partition` 报 `not-in-family (6)` 里的 **`plugin/test/manager-obligation-ledger.test.mjs`** 那一族，**根因是我，不是产品代码**。**已修完提交，请重跑时带上 `bcd891f1`。**

### 是什么

失败断言：`✖ shape: the manager ledger's obligation rows carry the first-class-object fields the engine derives`（`manager-obligation-ledger.test.mjs:60`）。

该断言要求每个 `id` 以 `OB-` 开头的核心行**至少携带 `true` / `live` / `condition` / `reading` 之一**。

**我 00:19 往 `orchestration/manager-obligation-ledger.jsonl` 追加了 3 条教训行，字段写成 `{id, ts, kind, what, truth, why_hard, rule, cost}` —— 用了 `truth`，而断言认的是 `true`/`live`/`condition`/`reading`。** 逐行算：**195 个核心 `OB-` 行，恰好 3 行不合格，全是我那 3 行**（217/218/219）。

### 已怎么修

按台账既有的房屋风格 `{id, at, kind, reading, truth, fix, asked_human}` 重映射：`what→reading`、`ts→at`、`rule→fix`，补 `asked_human`，保留 `truth`/`why_hard`/`cost`。**内容一字未删。** 落地前逐项校验：非空行数 215→215 不变、非法 JSON 0 行、**按断言逻辑重算仍不合格行 = 0**。提交 `bcd891f1`。

### 两族的划分（请据此排 Fix）

| 族 | 文件 | 归属 | 状态 |
|---|---|---|---|
| ① | `runner-grouping-list-groups.test.mjs` AC3 realpath dedup ×4 | 产品/测试拆分回归（suite-floor fan-in 面） | **仍需你的 Fix agent** |
| ② | `manager-obligation-ledger.test.mjs` shape ×3 | **我的台账数据** | **已修 `bcd891f1`** |
| ③ | `manager-observation-runtime-check.ts`（分诊里 1 条） | 未查 | 若重跑后仍红我来查 |

### 我该早知道的

**我从没意识到我手写的台账在测试覆盖下。** 我一直把 `orchestration/manager-*` 当成「我自己的文档，§0 豁免」，而 `manager-obligation-ledger.jsonl` **是被 `plugin/test/` 里的测试断言着的数据文件**——它同时是我的记录本和产品的测试夹具。**「这是我自己的文件」不等于「改它没有外部后果」。** 已记台账（会用合规字段写）。

**顺带**：这也说明我 00:19 那次「写完立刻提交」的纪律还不够——**提交不等于不破坏**。真正该有的是：改 `manager-obligation-ledger.jsonl` 后跑一次针对它的 scoped 检查。但**跑验证在我 §0 边界外**，所以更合适的落点可能是让该文件的写入走一个带 schema 校验的机件（现有 `plugin/scripts/obligation-ledger.ts` 是推导版、不收作者写入）。**要不要立案归你**，我只报形状。

### 本轮其余读数

**你 `005414` 那封我读了全文，四组执行我核过**：`needs-human` **32→8**、其中「分支已合入 integration」**14→2**（正是你说的待绿那 2 条）；`candidates 16→28`、`promotions 0→1`、`pool=2 deficit=18 dd=1`；closure ok（nyf=9 fresh）；`diverge(d/i)=0/33`；`in_flight=1/5`（AC25 支，`verify-01f6c692`，未合、00:30:24）；**AC16①`lastDelivered=6386ff86`、develop 领先 0**；②`plugin_in_files=True`；outer=busy / inner=waiting-input；无 `.halt`。
