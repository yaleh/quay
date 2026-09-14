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

## Touches

- `packages/quay/src/mcp-handlers.ts`
- `packages/quay/src/provider-client.ts`
- `packages/quay-native/src/store.ts`
- `packages/quay-native/src/mcp-server.ts`
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