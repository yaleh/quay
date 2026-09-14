---
id: gap-abi-task-list-times-out-at-2000-tasks-head-of-line-blocks-mcp
title: ABI task_list 在 2123 个任务时超时并队头阻塞整个 MCP 读面——ABI-only 的 quay-task subagent
  结构上不可用（gap-serve-search-timeout-all-body-fetch 的兄弟实例，硬规则 5b）
status: done
labels:
  - gap
  - defect
parent: null
children: []
extra: {}
---
## Finding

**当前任务库 2,123 个任务时，MCP 上的 `task_list` 超时，并因服务端串行处理形成队头阻塞，
把整个 Provider ABI 读面拖垮——这使得文档指定的任务变更主路径（ABI-only 的
`quay:quay-task` subagent，其工具白名单只有 MCP 动词）在当前规模下结构上不可用。**

实测（2026-09-14 04:4xZ，真实生产任务库，非 fixture）：

| 读法 | 耗时 | 结果 |
|---|---|---|
| CLI `quay task list`（全量，新 provider 进程） | **37.7 s** | 成功，2,123 行 |
| CLI `quay task view <单个 id>` | 2.3 s | 成功 |
| CLI `quay task list --json`（重定向到文件） | >120 s | **超时，0 字节** |
| MCP `task_list({pageSize:1})` | — | `MCP error -32001: Request timed out` |
| MCP `task_list({status,prefix,search,provider}` 各种组合，7 次） | — | 全部 -32001 |
| MCP `task_get(<单个已存在 id>)` ×4 | — | 全部 -32001 |
| MCP `task_check(DIR-028)` | — | -32001 |

一次 subagent 会话里连续 18 次 -32001，覆盖**每一个**读动词与每一种 payload 形状。

**关键判读**：`pageSize:1` 也超时 ⇒ 不是响应体大小问题，分页发生在**全量载入之后**；
`task_get` 单条在 CLI 上只要 2.3 s 却在 MCP 上超时 ⇒ 不是该动词自身慢，而是
**一个 37 s 的 `task_list` 占住串行服务端，后续请求排队陪绑**（队头阻塞）。

## 这是一个已修复缺陷的兄弟实例（硬规则 5b）

`tasks/gap-serve-search-timeout-all-body-fetch.md`（**status: done**）记录的是同一个机制、
同一个错误码：「serve /tasks `?q=` 搜索超时——`?q=` 全量取 **1572 任务** body 致
**MCP -32001 超时**、搜索恒空」。当时的修复只打在 **serve 搜索面**上；同样的
「全量取 body → 超时」在 **`task_list` 这个 ABI 动词**上原样复发，任务数从 1,572 涨到 2,123。

⊢ 这正是硬规则 5b（「在某处修好 X ≠ X 只在那一处」）的实例：缺陷成簇，兄弟实例常在同一层。
修本条时必须同时枚举**所有**会全量载入任务 body 的读路径，把命中数与清单贴进提交，
而不是只修被报出来的这一个。

## 影响

1. `quay:quay-task` subagent（CLAUDE.md 指定的任务 CRUD/生命周期唯一入口）**完全不能工作**：
   它的工具白名单只有 MCP 动词，没有 Bash/CLI 退路。
2. 任何查重（立案纪律的前置）在 MCP 上做不了 ⇒ 要么不查重硬写（违纪），要么立不了案。
3. 超时通道上的**写**尤其危险：可能服务端落地却给调用方返回错误，产生一个读不回来的变更。
4. 本缺陷是自我加速的：任务库只会继续增长，而 `ready-pool-check` 已实测是 O(池大小)
   （见 `docs/analysis/suite-got-5x-faster-and-throughput-did-not-follow.md` §4：
   75,571 次调用、中位 9.5 s、累计 212.7 h，占全部 checker 成本 97.8%，
   且三周内从 3.7 h/天 涨到 19 h/天）。

## 诊断（立案体要求的第一步：先判定队头阻塞在哪一层）

**判定结果（按证据，不按推测）：**

1. **实例粒度：每个 provider 一条独立连接，不是共享实例。** `packages/quay/src/mcp-server.ts:204`
   的 `clients` Map 按 providerId 缓存 `connectToProvider()` 的 Promise；每个 `quay mcp` 进程各持有
   自己的一份。所以「另一条连接仍能建任务」与「这条连接被堵死」可以并存——立案体末尾那条
   反证（自主循环仍在建任务）由此解释，且**不是**「没有缺陷」的证据。
2. **队头阻塞发生在 Core MCP server 这一层，机制是【同步 CPU 段】而非 await。**
   handler 是 async 的，await 期间事件循环本该空闲；真正堵住后续请求的是**解 14.4 MB 响应体
   那一段同步工作**（SDK `ReadBuffer` → `JSON.parse` → zod `JSONRPCMessageSchema.parse`），
   它在事件循环上跑，期间 `task_get`（2 ms 真实工作）连被调度的机会都没有。
3. **代价的真正量纲不是「walk」也不是「序列化」，是【响应体字节数】。**
   实测（同一进程、同一真实库）：全量 walk 冷 1,547 ms / 热 40 ms，`JSON.stringify` 紧凑 384 ms /
   美化 210 ms，都不是 30 s 级。而**同一个 `task_list` 换个 payload 大小**：
   `includeBody:false`（878 KB）**741 ms** vs `includeBody:true`（14.4 MB）**34,024 ms**。
   ⇒ 16 倍字节 → 46 倍耗时，**超线性**。根因在 SDK 的 stdio 分帧
   （`dist/esm/shared/stdio.js` `ReadBuffer.append` 对**每个入站 chunk** 做一次
   `Buffer.concat([this._buffer, chunk])` ⇒ 4 MB 消息按 64 KB 到达即 ~64 次拷贝、每次拷到 4 MB，
   叠加接收侧对整个消息的 `JSON.parse` + zod 校验）。
   **这是 SDK 的性质，不是本仓库能改的；唯一可动的杠杆就是 payload 大小。**

**⇒ 因此修复方向确定为「让响应体正比于调用方要的那一页，而不是整个库」，而不是「让查询变快」。**
`pageSize` 此前只是**已经在全量传输之后**才切的一刀（这正是立案体「`pageSize:1` 也超时」的判读）。

**第二条独立根因（同一次测量暴露，与上条正交）：同一份 JSON 被发了两遍。**
MCP tool 结果同时带 `content[0].text` 与 `structuredContent`，SDK 把**整个结果对象**序列化上线
⇒ 每个 `task_list` 响应都携带两份相同字节。实测合成探针（1.6 MB 数据）：
响应 3,345,096 字节 ≈ 2×。因为代价超线性，这一份重复本身就是「可用」与「队头阻塞」的分界。

## 修复

1. **`packages/quay-native/src/store.ts` — 新增 `queryPage()`，把「解析匹配集合」与「取回这一页的
   条目」拆成两相**：
   - 相位 1 解析匹配的 **id 集合**，**不读 body**——「有过滤条件」时走**仅 frontmatter 的走查**
     （持久解析缓存 stat 命中即不 `readFileSync`，body 永不进内存）；只有 `search` 因为要匹配正文
     才必须读 body（这是 `gap-serve-search-timeout-all-body-fetch` 建立的既有行为，保持不变）。
   - 相位 2 **只为这一页窗口**取回完整 task，上限 `pageSize` 条，与库大小无关。
   - 两相共用**同一个** `matchesListFilter` 谓词，且都经 `toViewModel` 构造视图模型
     （status 非法值强转、id 回退、labels 归一），所以「索引路径」与「走查路径」**结构上不可能
     选出不同的集合**。
   - `malformed` 语义保持不变（**未分页时仍然完整**——见下「实现中的一次自纠」），并新增
     `scannedFiles` 明确区分「扫过且没有坏文件」与「根本没扫」（硬规则 3b：未评估不得与合格同形）。
   - `includeBody:false` 时相位 2 直接用 frontmatter 索引构造该页，**一个 body 都不读**。
2. **`packages/quay-native/src/mcp-server.ts`** — `task_list` 接受 `prefix`/`page`/`pageSize`
   （`label` 同时接受 string 与 string[]，AND-join），响应新增
   `total`/`page`/`pageSize`/`totalPages`/`paged`/`scannedFiles`。**加性、可选**：不传
   `pageSize` 时行为与修复前**逐字节相同**。
3. **`packages/quay/src/provider-client.ts`** — `TaskListResult` 转发上述 paging 元数据；
   字段**只在存在时**透传，所以「provider 没说」与「provider 分页了」保持可区分（硬规则 3b）。
4. **`packages/quay/src/mcp-handlers.ts`（Core MCP `task_list`，即 subagent 走的那条）** —
   把 status/label/prefix/search/page/pageSize **下推**给 Provider；仅当 Provider 回
   `paged:true` 时才采信它的 `total` 与这一页，否则回落到**原有的**「取全量 + 本地过滤 + 本地分页」
   路径（不认识这些可选参数的 provider 行为**完全不变**）。下推调用若被 provider 的 schema
   拒绝（`label` 数组是唯一可能），**重试原有调用形状** `{status}` 再走回落路径——读路径永远不会
   因为「参数形状不被认识」而失败。
5. **去重**：`task_list` 的 `content[0].text` 在 payload ≤ 256 KB 时**逐字保留**（所有既有小响应
   与读它的测试**字节不变**），超过则改为一行摘要、数据只经 `structuredContent` 走一次
   （见上「第二条独立根因」）。native provider 侧与 Core 侧各一处。

**实现中的一次自纠（留档，不藏）**：第一版把「无过滤条件」一律短路到目录列举，于是**任何**
未分页调用的 `malformed` 都恒为空——把「扫遍全库且没有坏文件」变成了「根本没看」，而消费这个字段的
正是 web board 的坏文件行渲染。这是硬规则 3b 的形态，且是我自己在复查时才发现的。
**修法**：短路只在**调用方要的是一页**时生效；未分页请求保留完整走查
（也因此未分页的答案与修复前的 `listWithMalformed()` 逐字节兼容）。见 `147524439`。

## Touches

- `packages/quay/src/mcp-handlers.ts`
- `packages/quay/src/provider-client.ts`
- `packages/quay-native/src/store.ts`
- `packages/quay-native/src/mcp-server.ts`
- `packages/quay/src/cli/task-list.ts`
- `packages/quay/src/gate/driver.ts`
- `packages/quay/test/gap-abi-task-list-pagination-payload-bound.test.mjs`
- `plugin/test/driver-resolves-code-root-separate-from-workspace.test.mjs`
- `tasks/gap-abi-task-list-times-out-at-2000-tasks-head-of-line-blocks-mcp.md`

> **最后一条 Touches 是后加的，理由见 `## Evidence`「fan-in 被一条无关的 suite 红挡下」**：
> 该测试文件是本任务 delta 的一部分（本分支确实改了它），不是「把别人的红算进自己的范围」。
> 详见该节的双向控制与 5b 扫描读数。

## 实测读数（真实生产任务库，非 fixture）

**环境**：`<worktree>/tasks/` = **2,136** 个真实任务（立案时 2,123，库在增长）。
**通道**：Core 的 MCP 服务器（`quay mcp`）——即 `quay:quay-task` subagent 走的那条。
**方法**：每条腿先做一次预热调用，把 Core+provider 子进程启动（~1 s，且与库大小无关）排除在读数外。

```bash
cd <worktree> && node --experimental-strip-types --input-type=module -e '
import {Client} from "@modelcontextprotocol/sdk/client/index.js";
import {StdioClientTransport} from "@modelcontextprotocol/sdk/client/stdio.js";
const t=new StdioClientTransport({command:"node",args:["--experimental-strip-types","packages/quay/bin/quay.ts","mcp"],cwd:process.cwd(),stderr:"pipe"});
t.stderr?.on("data",()=>{});
const c=new Client({name:"probe",version:"0"}); await c.connect(t);
await c.callTool({name:"task_list",arguments:{pageSize:1}});                       // 预热
const s=Date.now(); const r=await c.callTool({name:"task_list",arguments:{pageSize:1}});
console.log(Date.now()-s,"ms  total=",r.structuredContent.total,
            " bytes=",JSON.stringify(r.structuredContent).length);
await c.close();'
```

| AC | 读法 | 修复前（develop `c1cea6663`） | 修复后（本分支） |
|---|---|---|---|
| ① | `task_list({pageSize:1})` 热 | **28,549 ms** | **13 ms** |
| ① | `task_list({pageSize:1})` 冷（含启动） | **`MCP error -32001: Request timed out`** | 1,076 ms |
| ② | `task_list({pageSize:50})` 热 | — | 54 ms（响应 422,237 B） |
| ② | `task_list({pageSize:200})` 热 | **15,812 ms** | **755 ms**（响应 2,868,309 B） |
| ③ | 并发 `task_get`（heavy `task_list` 在飞） | **20,387 ms** | **647 ms** |

> 修复前的「超时」不是脚注：控制组上**同一脚本的预热调用本身就返回
> `MCP error -32001: Request timed out`**（60 s 客户端上限），立案体记录的症状原样复现。
> 修复前两次独立运行的 `pageSize:1` 分别为 28,549 ms 与 33,632 ms——都在 5 s 上限的 5 倍以上。

### ② 的子集／全集对比（同一脚本、同一台机器）

| 库 | `pageSize:1` 中位（5 次样本） | 其响应 | `pageSize:200` 中位 | 其响应 |
|---|---|---|---|---|
| 全集 **2,136** | **13 ms** | **3,220 B** | 447 ms | 2,868,309 B |
| 子集 **200**（真实库前 200 个文件） | **10 ms** | **3,219 B** | 600 ms | 2,868,336 B |

- **代价随 pageSize 增长** ⇒ 与**返回条数**相关：13 ms → 447 ms（34×），响应 3,220 B → 2,868,309 B（890×）。
- **代价不随任务总数线性增长**：库大 10.7×，`pageSize:1` 从 10 ms 变 13 ms（落在噪声内，
  且**更慢的是小库**），响应**逐字节同性质**（3,220 vs 3,219 B = 一个任务）。
  修复前同一对比是 **28,549 ms（全集）vs 1,430 ms（子集）≈ 20×**——即在跟着库走。
- 残下的与库相关成本只剩一次目录 `readdir`（无过滤且分页时**一个任务文件都不读**），
  在 5 s 预算里占 ~0.3%。

## 兄弟实例枚举（硬规则 5b）

`grep -rn "\.taskList(" packages/ plugin/ --include=*.ts --include=*.js | grep -v '/(test|vendor|node_modules)/'`
⇒ **11 行命中，其中 2 行是注释**（`migrate.ts:57`、`serve-dashboard.ts:1380`）⇒ **9 个真实调用点**
（硬规则 2：注释不算命中）。前 3 条实际内容：

```
packages/quay/src/serve-board.ts:200:    const r = await client.taskList({ includeBody: false });
packages/quay/src/migrate.ts:70:  const { tasks } = await source.taskList({});
packages/quay/src/mcp-handlers.ts:183:        listRes = await client.taskList({        (Core MCP task_list — 被报出来的那一个)
```

逐条处置：

| # | 位置 | 修复前取回的 payload | 同样受影响？ | 本任务内 |
|---|---|---|---|---|
| 1 | `packages/quay/src/mcp-handlers.ts:183`（Core MCP `task_list`） | 每一页都取全库 body | **是（被报出来的那一个）** | **已修**（下推 + 分页 + 去重） |
| 2 | `packages/quay/src/mcp-handlers.ts:202` | 全库 body | 只在外来 provider 拒绝下推形状时可达 | **保留**（它就是那条回落路径，读路径不因形状不认识而失败） |
| 3 | `packages/quay/src/cli/task-list.ts:41` | 全库 body | **是**（立案体：37.7 s；本次实测 **30.6 s**） | **已修**：表格视图不渲染 body，改取 frontmatter 投影 |
| 4 | `packages/quay/src/gate/driver.ts:96`（`scanActionable`） | 每次 pass 取全部 ready 的 body | **是**（promotion driver 每趟都付费） | **已修**：只读 `status`/`id`/`extra.acceptance` |
| 5 | `packages/quay/src/migrate.ts:70` | 全库 body | 是 | **不改**：迁移的产出**就是**每一条 body（`--json` 全量导出同理），不是「取了不用的字节」 |
| 6 | `packages/quay/src/serve-needs-human.ts:112` | `needs-human` 的 body | 否（子集小） | **不改**：body 是**故意**要的（要从 `## Needs-Human` 段提取理由），池子规模小 |
| 7 | `packages/quay/src/serve-task.ts:55` | 匹配集 / frontmatter | 否 | 兄弟任务 `gap-serve-search-timeout-all-body-fetch` 已修 |
| 8 | `packages/quay/src/serve-board.ts:200` | frontmatter | 否 | 同上 |
| 9 | `packages/quay/src/serve-dashboard.ts:1396` | frontmatter + 30 s TTL 缓存 | 否 | 同上 |

另有一条**不同载体**的同类：`packages/quay-native/bin/quay-native.ts:312` 在**进程内**直接
`store.list()`（不经 stdio）——它也把 body 全读进来，但**没有 MCP 分帧那一跳**，因此不受本缺陷影响
（冷 ~1.5 s / 热 ~40 ms）。

**#3 的读数（同一条命令，同一台机器）**：`node packages/quay/bin/quay.ts task list`
⇒ 修复前 **30.6 s** → 修复后 **2.29 s**。`--json`（全量导出，见 #5）10.2 s。
两条腿是同一份 `withProvider`，所以这条读路径与 #1 是同一个修复面。

## 回归测试（AC⑤）

新增 `packages/quay/test/gap-abi-task-list-pagination-payload-bound.test.mjs`（`@test-group product`）：
N = **2,000** 的合成任务库、每个任务 ~4 KB body（≈8 MB body），断言
（a）热 `task_list({page:1,pageSize:1})` 在 **5 s** 内返回；
（b）该响应**不携带整个库**（< 64 KB；这条是**确定性**断言，不依赖机器速度，因此在任何负载下
都能把修复前后分开）；（c）`paged:true` / `total` 是过滤后计数 / `pageSize` 条数；
（d）下推后的过滤+分页**逐条等于 store 自己的过滤结果**（谓词漂移会在这里现形）；
（e）不传 page 参数时保持「全集」契约。

| 同一测试文件 | 结果 |
|---|---|
| 修复前（control worktree，develop `c1cea6663`） | **0 pass / 3 fail**；第 1 条用例的**预热调用**即 `MCP error -32001: Request timed out`（用例耗时 61,329 ms） |
| 修复后（本分支） | **3 pass / 0 fail**（1.4 s） |

## Definition of Done 状态

- **`quay:quay-task` subagent 已实际唤起一次**并完成真实 `task_list({pageSize:1})` → `task_get`
  → `task_write` 往返，**三次调用全部成功、无 -32001**：`total`=2,138、`tasks.length`=1；
  `task_get` 返回 `status=ready`、`labels=["gap","defect"]`；`task_write` 幂等重写同一对标签成功
  （该 subagent 的回报已按其原话记录，未改一字）。
- **诚实标注**：该 subagent 连的是**生产 MCP 服务器**，它跑的是
  `plugin/vendor/quay/dist/quay.js`（gitignored 的**构建产物**，`ps` 实测：
  `node /home/yale/work/quay/plugin/vendor/quay/dist/quay.js mcp`），**本次修复尚未落进它**。
  所以这一条证明的是「ABI 主路径可达、往返完整」，**不构成「修复在生产生效」的证据**；
  后者要等 fan-in 落 develop、构建产物刷新、主检出 config 同步之后才成立。
  ⛔ 刻意**没有**手工去重建那个 bundle 来「满足」这条 DoD——那正是
  「生产形态 AC 靠手工起动未落地代码满足 ⇒ 重启即回退」的形态。
- **修复本身在生产代码路径上的证据**是下面那条**机械往返**（同一个 Core MCP 服务器、同样三个动词、
  跑在本分支的修复代码上）：`task_list({pageSize:1})` **10–15 ms**、`task_get` **8–12 ms**、
  `task_write` **75–101 ms**、读回一致。
- **反例判据**（DoD 要求）：把 fixture/注入 seam 关掉后上述耗时 AC 仍成立——上面的读数**全部**取自
  真实生产任务库（2,136 个真任务），不是夹具；合成库只用于 AC⑤ 那条可重复的回归断言。

## Acceptance Criteria

- [x] 在**真实**任务库（≥2,100 个任务，不是 fixture）上，MCP `task_list({pageSize:1})`
      在 5 秒内返回；命令行与耗时读数贴进任务体。
      ⇒ 热 **13 ms** / 冷 1,076 ms（库 2,136 个真实任务）；修复前 28,549 ms、冷调用直接
      `-32001` 超时。命令与对照见上「实测读数」。
- [x] 分页不再全量载入 body：对同一真实库，`pageSize:1` 与 `pageSize:200` 的耗时差
      必须随 pageSize 增长（证明代价与返回条数相关），且 `pageSize:1` 的耗时
      **不随任务总数线性增长**——用 `tasks/` 的子集与全集两次实测对比给出读数。
      ⇒ 13 ms → 447 ms（34×）、响应 3,220 B → 2,868,309 B（890×）；全集 2,136 vs 子集 200：
      **13 ms vs 10 ms**（响应 3,220 vs 3,219 B = 一个任务）。修复前同一对比 ≈20×（28,549 vs 1,430 ms）。
- [x] 队头阻塞消除的**双向控制**：并发发起一个全量 `task_list` 与一个 `task_get(<id>)`，
      `task_get` 必须在 5 秒内返回（当前：超时）。负控制 = 在修复前的提交上重跑同一脚本，
      `task_get` 应超时；两次读数都贴进任务体。
      ⇒ 修复后 **647 ms**；修复前 **20,387 ms**（>5 s 上限 4 倍），且同一控制组上同一脚本的
      `task_list` 曾直接 `-32001` 超时（60 s 上限）。两次读数均见上表。
- [x] 按硬规则 5b 枚举兄弟实例：列出仓库内**所有**会「全量载入任务 body」的读路径
      （给出 grep 命中数 + 前 3 条实际内容 + 文件:行号），逐条说明是否同样受影响、
      是否在本任务内一并修复；写不出这个清单视为只修了被报出来的那一个。
      ⇒ 11 行命中 / 9 个真实调用点，前 3 条与实际内容、9 条逐条处置表见上「兄弟实例枚举」；
      本任务内**已修** 3 条（#1 Core MCP、#3 CLI 表格视图、#4 gate driver），另 6 条逐条给了
      「不受影响」或「不改也是对的」的理由，并单列了 1 条不同载体的同类（进程内 `store.list()`）。
- [x] 回归判据：新增一条测试，断言在 N≥2,000 的合成任务库上 `task_list({pageSize:1})`
      的耗时低于阈值；该测试在修复前的代码上必须红（贴出红的输出）。
      ⇒ `packages/quay/test/gap-abi-task-list-pagination-payload-bound.test.mjs`，
      修复前 **0/3 pass**（预热调用即 `-32001`，61,329 ms），修复后 **3/3 pass**。

## Definition of Done

修复后在**真实生产任务库**上跑通，不接受只在 fixture 上达标——把测试注入 seam 关掉后，
上述耗时 AC 仍应成立（反例判据：若某条 AC 在关掉 fixture 后仍通过，它才是测量）。
`quay:quay-task` subagent 必须被实际唤起一次并成功完成一次真实的 `task_list` + `task_get`
+ `task_write` 往返（贴出该 subagent 的回报），证明 ABI 主路径恢复可用——
仅仅「CLI 能跑」不构成完成，因为 CLI 从来没坏过，坏的是 MCP 这条被文档指定为主路径的通道。

> 状态见上「Definition of Done 状态」：subagent 往返已实际完成且成功；
> 但它连的生产 bundle 是构建产物，修复尚未落进去 —— 该条**不**被当成「修复已在生产生效」的证据，
> 也刻意没有手工重建 bundle 去凑。

反证（2026-09-14 04:5xZ，立案后同轮补记，避免结论过强）：同一时段自主循环本身仍在成功建任务——03:00 后落盘的 gap-ac255-driver-internalization-pid-le2-six-kinds-fresh / gap-ac257-ad-arm1-archguard-project-scope-quay-init-merge-rerun / gap-ac258-orangevps-meta-cc-user-scope-quay-init-merge-preserved 等 8 条均非本会话所建。⇒ 不是「ABI 全局不可用」，而是【本会话这条 MCP 连接/服务端实例】被一个 37 s 的全量 task_list 堵死后，其上后续所有请求陪绑超时。修复本任务时，第一步应先判定：是每连接一个 provider 实例、还是共享实例；队头阻塞发生在哪一层（Core MCP handler / provider-client / native mcp-server）。⛔ 不要把「循环还在工作」当成「没有缺陷」——37 s 的全量载入是实测事实，它只是还没有打到每一个消费者身上。

## Evidence

### fan-in 被一条无关的 suite 红挡下（2026-09-14，第 2/3 次续做轮）

前一轮 `exited-not-landed`，`step=suite`，唯一红：

```
✖ AC3a': kernelSiblingArgv / kernelConfigPath 锚在 kernel 安装位置（⛔ 非 workspace root）
  AssertionError [ERR_ASSERTION]: 配置路径必须落在 quay 安装树下（⛔ 非 workspace root）
    at plugin/test/driver-resolves-code-root-separate-from-workspace.test.mjs:190:10
# tests 2562 / # pass 2561 / # fail 1
```

**判读：不是本任务 delta 的缺陷，但也不是纯环境噪声——是本任务 worktree 里一条真红。**
机械 delta-relatedness 给的 `UNRELATED` 只是提示；按规矩重跑一次仍复现 ⇒ 按真发现处理。

**根因（一条命令可核）**：该用例断言的是**缺省**解析下的锚点，却从没中和 `QUAY_PLUGIN_ROOT`
（`driver-runtime.ts:290/297` 的显式指针缝）。生产环境的 driver 实测**带着**这个变量：

```
$ tr '\0' '\n' < /proc/<worker-supervisor-pid>/environ | grep QUAY_
QUAY_PLUGIN_ROOT=/home/yale/work/quay/plugin      ← 主检出，不是 worktree
$ env QUAY_PLUGIN_ROOT=/home/yale/work/quay/plugin node -e '…'
pluginRoot = /home/yale/work/quay/plugin
cfgPath    = /home/yale/work/quay/plugin/scripts/drivers.yml   ← 落在 REPO_ROOT（worktree）之外
```

worker 的 suite 子进程继承该变量 ⇒ 在**任何** task worktree 里跑，`cfgPath` 都落到主检出
⇒ `cfgPath.startsWith(REPO_ROOT)` 恒假。同文件紧邻的 `AC3a` 保存/复原了这个变量
（`:139-171`），`AC3a'` 漏了——**同一个文件里两个兄弟用例，一个中和、一个没中和**（硬规则 5b 形态）。

**旁证（不是自证）**：同一 runId 的**兄弟任务** `gap-fan-in-ts-typecheck-gate-cannot-read-third-party-config`
的 fan-in 日志（`wk-prod-1789367589`）**同一时刻同样只红这一条**，`# tests 4862 / # pass 4861 / # fail 1`，
同一行号。⇒ 这不是本任务独有的，是两个任务同时被同一条红挡下。

**修法（最小、且让判据重新成为测量）**：在 `AC3a'` 里保存/复原 `QUAY_PLUGIN_ROOT`（与 `AC3a` 同款），
使断言的对象回到 AC 所声明的那个量，并**与环境无关**。

**双向控制（都在本轮实跑）**：

| 条件 | 结果 |
|---|---|
| 环境带 `QUAY_PLUGIN_ROOT`（= 失败条件）+ **改前** | **红**：`AssertionError` @ `:190`（生产日志 2 次 + 本地复现 1 次） |
| 环境带 `QUAY_PLUGIN_ROOT` + **改后** | **绿**：`tests 6 / pass 6 / fail 0` |
| **不带** `QUAY_PLUGIN_ROOT` + 改后 | **绿**：`tests 6 / pass 6 / fail 0`（⛔ 无回归：不是靠删变量把用例变空转） |

第三行是关键：改后**两种环境取同一真值** ⇒ 判据不再由环境决定（硬规则 4b：读数不得由被测对象之外的量决定）。

**硬规则 5b 扫描（本缺陷的其它适用点）**，载体 = 全部 import 了 kernel 解析函数的测试文件：

```
$ grep -rln "resolveKernelPluginRoot\|resolveKernelScriptsDir\|kernelConfigPath\|resolveKernelSibling" plugin/test/ packages/*/test/
⇒ 14 个文件（含 2 个 fixture）
```

逐条看「是否断言绝对路径锚点、且未中和该变量」：**命中 1 处**，就是本文件 `AC3a'`。其余或
自带 save/restore（`driver-runtime` / `worker-driver*` / `promotion-driver` / `cap-from-gate-process-budget-path` /
`conformance-target-fixture` / `driver-third-party-fixture`），或断言**两侧同用同一函数**故 override 对称抵消
（`worker-driver-resident.test.mjs:268`：期望值与实得值都取自 `resolveKernelScriptsDir()`），
或只对源码文本做静态扫描（`kernel-sibling-resolution-check` / `registry-bare-filename-scan` /
`criterion-fidelity-historical-case` / `build-plugin-dist`）。⇒ **与本轮 suite 实测的 `# fail 1` 一致**。

**Touches 加这一条的理由（⛔ 不是把别人的红算进自己的范围）**：`git diff develop...HEAD` 里
本分支**确实**改了这个文件，所以它是本任务 delta 的一部分；anti-drift 是 **NON-WAIVABLE HARD FAIL**，
不声明就每轮报 `out-of-declared`。按纪律先问「develop 是否也在修它」——**没有**
（`git log develop -- <该文件>` 最后一条是 `00df3163a`，即引入该用例的那次；develop 侧无对应修复），
所以「再 merge 一次 develop 就会自愈」那条路不存在 ⇒ 走「登记 Touches 并写明理由」这一支。

**⛔ 未做的事（留档）**：没有去动生产侧的 `QUAY_PLUGIN_ROOT` 传递（driver 环境里带着它，
在 quay 自己的检出里与自解析同值、无害；它的**继承进 suite** 才是本次的触发条件）。
本轮只把**测试**改成 hermetic —— 那是该红所属的那一层，且无论生产侧将来怎么变都成立。
