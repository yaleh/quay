---
id: gap-cli-task-list-page-size-post-hoc-slice-not-pushed-down
title: quay task list CLI 的 --page-size 是取全量 body 后客户端 slice，未接入已有的 ABI 分页省读路径
status: ready
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
---
## Proposal
**现象（另一会话在 claudecodeui 侧定位并实测，本会话在 quay 仓库复现确认）**：对本仓库自己的 store（2575 任务）跑
`.quay/plugin/bin/quay task list --json | wc -c` 耗时 ~3.4s、26MB；加 `--page-size 10` 后输出降到 60KB，**耗时几乎不变**
（~3.5s）——说明开销不在打印，在取数路径本身。

**根因（已读代码确认，非猜测）**：`packages/quay/src/cli/task-list.ts`——
- 第 66 行 `const wantBodiesInOutput = wantsJson === true;`：只要用了 `--json`，无论有没有 `--page-size`，都强制要 body。
- 第 67-75 行构造 `providerFilter` 时只转发 `status`/`label`/`prefix`/`search`/`includeBody`，**从未转发 `page`/`pageSize`**
  给 `client.taskList(...)`。
- 第 153 行 `const paged = pageSize != null ? sorted.slice(0, pageSize) : sorted;`——`--page-size` 只是在**拿到全量结果之后**
  做的数组截断。

而 Provider ABI 层早就有现成的、省读的分页实现：`packages/quay-native/src/store.ts` 的两阶段解析（phase 1 只读目录/frontmatter
确定匹配 id 集合，phase 2 只对**页窗口**内的文件读 body）是 `gap-abi-task-list-times-out-at-2000-tasks-head-of-line-blocks-mcp`
已经做好、且已经在用的能力——**本仓库自己的 Core MCP handler** `packages/quay/src/mcp-handlers.ts:142-188` 已经按这个模式把
`page`/`pageSize` **下推**给 `client.taskList({..., page, pageSize})`，并在 `listRes.paged === true` 时直接信任 Provider
的分页结果，不再本地二次处理。**`cli/task-list.ts` 没有照这个已经验证过的模式走**，是同一个修复里唯一没覆盖到的消费点
（dedup 检查：grep `task-list.ts`/`page-size`/`sorted.slice` 命中的是上述两个 done 任务和 `gap-stripheadings-quadruple-
duplication-cli-task-list-client-filter`——后者把 status/label/prefix/search 下推了，但同样没碰 page/pageSize，不是本任务
的重复）。

<!-- dedup-ref -->相关（延续，非前置，均 done）：`gap-abi-task-list-times-out-at-2000-tasks-head-of-line-blocks-mcp`
（建了 Provider 的两阶段分页能力）；`gap-stripheadings-quadruple-duplication-cli-task-list-client-filter`（把
status/label/prefix/search 下推，但没碰 page/pageSize）。

**修法方向**：把 `--page-size`（以及需要的话补一个 `--page`）接进 `providerFilter.page`/`providerFilter.pageSize`，镜像
`mcp-handlers.ts:166-199` 已经验证过的「下推 → 信任 `listRes.paged===true` → 否则走全量 fallback」形状；同时当
`pageSize != null` 时不应再无条件把 `includeBody` 撑成 true——只在分页窗口内读 body，而不是全量读了再截断。Provider 不支持
下推（旧 Provider / schema 拒绝新参数）时保留现有全量+本地 slice 的 fallback 行为，不改变其正确性，只改变有能力下推时的成本。

**消费方风险的更正（2026-10-07，另一会话实测核实，更正此前错误表述）**：此前本段写"claudecodeui 侧不需要改调用方式，继续传
`--page-size` 即可"——**这个前提是错的**。claudecodeui 的 `server/modules/quay/quay.service.ts:755` 实际发的是裸
`['task','list','--json']`，从不传 `--page-size`。本任务对 claudecodeui 的 Quay 面板**零直接收益**——它的性能问题不会
因为这个修复而变化。且**不能**事后建议 claudecodeui 补传 `--page-size`：它的 `summarizeTasks()`
（`quay.service.ts:359-378`）靠 `value.length` 数全量 `total`/`byStatus`，而分页后的 `--json` 输出是不带 `total` 字段的
裸数组（已实测 `--page-size 3` → 长度 3 的纯数组）——加 `--page-size` 会把面板计数从「2583 tasks」静默错成「3 tasks」，
是正确性回归，不是提速。真正能帮到该面板的是另一种能力（全量 frontmatter 投影,不截断、但不读 body，见
`gap-cli-task-list-json-body-coupled-to-json-flag`——已另立，Touches 与本任务重叠，会被调度器自然序列化在本任务之后）。
本任务仍然值得做：任何真的传 `--page-size` 的调用方（非 claudecodeui）今天都在付全量读的代价，这是本任务独立的、仍然
真实的收益面。

该轴仍暗，理由：本任务改动范围限于单个 CLI 命令文件（`cli/task-list.ts`）内把既有 `--page-size` 参数下推给已经存在的
Provider ABI 分页能力，镶入既有的 `providerFilter` 调用形状，不新增模块、不新增包间依赖、不改变调用图结构，L_D/L_G
（依赖结构/重复抽象）轴对此类单文件参数下推改动不提供信号。

## Touches
- `packages/quay/src/cli/task-list.ts`
- `packages/quay/test/cli.test.mjs`
- `tasks/gap-cli-task-list-page-size-post-hoc-slice-not-pushed-down.md`

## AC
- [ ] 复现基线：在本仓库 `.quay/plugin/bin/quay task list --json --page-size 10` 实测耗时（当前基线 ~3.5s/60KB），把读数贴进完成记录。
- [ ] 代码改动后同一命令耗时显著下降（量级上接近 Provider 两阶段分页的 phase-1 读目录/frontmatter 成本，不是全量 body 读的成本），把改动前后两组真实耗时数字都贴进完成记录（不是估算）。
- [ ] `node --experimental-strip-types --test packages/quay/test/*.mjs` 中覆盖 `task-list`/`cli` 的既有用例全部通过，且新增至少一个用例断言：给 `--page-size N` 时，`client.taskList` 调用收到的 filter 对象里带有 `pageSize`（或 `page`），而不是只在返回后做 `.slice()`（用注入的假 provider/client 捕获调用参数断言，不是读输出长度去猜）。
- [ ] 未传 `--page-size` 时的既有行为（全量输出、`--sort`、`malformed` 报告、`--prefix`/`--label`/`--search` 下推）零回归：`node --experimental-strip-types --test packages/quay/test/cli.test.mjs` 退出 0。
- [ ] `bash scripts/test.sh --for-task gap-cli-task-list-page-size-post-hoc-slice-not-pushed-down` 退出 0，且执行了 ≥1 个测试文件。

## DoD
真实落地：在本仓库自己的真实 store（而不是一个小夹具）上，`quay task list --json --page-size N`（N 远小于 store 任务总数)
的实测耗时明显低于当前的全量读基线，且该读数是**实跑**量出来的（附命令与耗时），不是依据代码推断「应该会更快」。
