---
id: gap-abi-task-list-times-out-at-2000-tasks-head-of-line-blocks-mcp
title: ABI task_list 在 2123 个任务时超时并队头阻塞整个 MCP 读面——ABI-only 的 quay-task subagent
  结构上不可用（gap-serve-search-timeout-all-body-fetch 的兄弟实例，硬规则 5b）
status: ready
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
   body」拆成两相**：
   - 相位 1 解析匹配的 **id 集合**，**不读 body**——无任何过滤条件时**直接来自 `listIds()` 目录列举
     （零文件读取）**；有 status/label/prefix 过滤时走**仅 frontmatter 的走查**（持久解析缓存
     stat 命中即不 `readFileSync`，body 永不进内存）；只有 `search` 因为要匹配正文才必须读 body
     （这是 `gap-serve-search-timeout-all-body-fetch` 建立的既有行为，保持不变）。
   - 相位 2 **只为这一页窗口**读取完整 task（含 body），上限 `pageSize` 个文件，与库大小无关。
   - 两相共用**同一个** `matchesListFilter` 谓词，且都经 `toViewModel` 构造视图模型
     （status 非法值强转、id 回退、labels 归一），所以「索引路径」与「走查路径」**结构上不可能
     选出不同的集合**。
   - `malformed` 语义保持不变，并新增 `scannedFiles` 明确区分「扫过且没有坏文件」与「根本没扫」
     （硬规则 3b：未评估不得与合格同形）。
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
6. **硬规则 5b 兄弟实例**（清单与逐条处置见下节）：一并修 `packages/quay/src/cli/task-list.ts`
   与 `packages/quay/src/gate/driver.ts` 两条同类全量取 body 的读路径。

## Touches

- `packages/quay/src/mcp-handlers.ts`
- `packages/quay/src/provider-client.ts`
- `packages/quay-native/src/store.ts`
- `packages/quay-native/src/mcp-server.ts`
- `packages/quay/src/cli/task-list.ts`
- `packages/quay/src/gate/driver.ts`
- `packages/quay/test/gap-abi-task-list-pagination-payload-bound.test.mjs`
- `tasks/gap-abi-task-list-times-out-at-2000-tasks-head-of-line-blocks-mcp.md`

## Acceptance Criteria

- [ ] 在**真实**任务库（≥2,100 个任务，不是 fixture）上，MCP `task_list({pageSize:1})`
      在 5 秒内返回；命令行与耗时读数贴进任务体。
- [ ] 分页不再全量载入 body：对同一真实库，`pageSize:1` 与 `pageSize:200` 的耗时差
      必须随 pageSize 增长（证明代价与返回条数相关），且 `pageSize:1` 的耗时
      **不随任务总数线性增长**——用 `tasks/` 的子集与全集两次实测对比给出读数。
- [ ] 队头阻塞消除的**双向控制**：并发发起一个全量 `task_list` 与一个 `task_get(<id>)`，
      `task_get` 必须在 5 秒内返回（当前：超时）。负控制 = 在修复前的提交上重跑同一脚本，
      `task_get` 应超时；两次读数都贴进任务体。
- [ ] 按硬规则 5b 枚举兄弟实例：列出仓库内**所有**会「全量载入任务 body」的读路径
      （给出 grep 命中数 + 前 3 条实际内容 + 文件:行号），逐条说明是否同样受影响、
      是否在本任务内一并修复；写不出这个清单视为只修了被报出来的那一个。
- [ ] 回归判据：新增一条测试，断言在 N≥2,000 的合成任务库上 `task_list({pageSize:1})`
      的耗时低于阈值；该测试在修复前的代码上必须红（贴出红的输出）。

## Definition of Done

修复后在**真实生产任务库**上跑通，不接受只在 fixture 上达标——把测试注入 seam 关掉后，
上述耗时 AC 仍应成立（反例判据：若某条 AC 在关掉 fixture 后仍通过，它才是测量）。
`quay:quay-task` subagent 必须被实际唤起一次并成功完成一次真实的 `task_list` + `task_get`
+ `task_write` 往返（贴出该 subagent 的回报），证明 ABI 主路径恢复可用——
仅仅「CLI 能跑」不构成完成，因为 CLI 从来没坏过，坏的是 MCP 这条被文档指定为主路径的通道。


反证（2026-09-14 04:5xZ，立案后同轮补记，避免结论过强）：同一时段自主循环本身仍在成功建任务——03:00 后落盘的 gap-ac255-driver-internalization-pid-le2-six-kinds-fresh / gap-ac257-ad-arm1-archguard-project-scope-quay-init-merge-rerun / gap-ac258-orangevps-meta-cc-user-scope-quay-init-merge-preserved 等 8 条均非本会话所建。⇒ 不是「ABI 全局不可用」，而是【本会话这条 MCP 连接/服务端实例】被一个 37 s 的全量 task_list 堵死后，其上后续所有请求陪绑超时。修复本任务时，第一步应先判定：是每连接一个 provider 实例、还是共享实例；队头阻塞发生在哪一层（Core MCP handler / provider-client / native mcp-server）。⛔ 不要把「循环还在工作」当成「没有缺陷」——37 s 的全量载入是实测事实，它只是还没有打到每一个消费者身上。
