---
id: gap-task-list-route-is-linear-in-task-count
title: "The task-list route costs ~8ms per task and the store only grows — 608 tasks render in 4.2s while every other route is under 0.1s"
status: todo
labels:
  - gap
  - milestone-candidate
extra:
  schema: v1
---

**type:** execution

## Proposal

管理者实测：`/` 的渲染时间**随任务数线性增长**，约 **8–9 毫秒一个任务**——
quay 608 个任务 **4.90 秒**，archguard 27 个任务 **0.25 秒**；
而**同一个服务**的 `/adr` 是 0.14 秒、`/live` 0.02 秒。**慢的只有任务列表这一条路由。**
任务只增不减：**今天一天就从 605 涨到 608**。

**外层独立复测确认，并把成本拆成了两半**（这一步是本任务的关键，避免优化错一半）：

| 量 | 实测 |
|---|---|
| `/`（真实服务器，30 秒超时） | **4.245 s** |
| `/adr` | 0.082 s |
| `/live` | 0.012 s |
| **`quay-native task list --json`（不经 web，纯 provider）** | **1,977 ms** |
| 任务数 | 608 |

**⇒ provider 单独就占 ~2.0 秒 / ~47%**，其余 ~2.2 秒在 MCP 往返序列化 + 渲染。
**每个任务光「读+解析」就 3.25 毫秒。**

**只优化渲染，最好也只能砍掉一半。** 这正是本仓栽过的「分母错了/瓶颈找错」那一族
（`cli.test.mjs` 占 34.8% 那次），**所以本任务的第一步是把这两半各自量出来，不是直接改代码**。

### 一个必须守住的约束

`CLAUDE.md` 明写 serve **每次请求实时读任务库**（reads the task store live per request）。
**任何缓存都必须在文件变更时失效**，否则会用「页面变快了」换来「页面显示的是旧任务」——
**后者是静默的**，比慢更糟。**AC5 就是这条的负控制。**

## Contract

```
measure route_ms = `curl -s -o /dev/null -w '%{time_total}' --max-time 30 http://<host>:<port>/` 的秒数字段
measure provider_ms = `node --experimental-strip-types packages/quay-native/bin/quay-native.ts task list --json` 的墙钟毫秒字段
measure per_task_ms = 上面两个量分别除以 `ls tasks/*.md | wc -l` 的每任务毫秒字段
band route_ms = <1.0
invariant 页面内容与实时任务库一致；任何缓存必须在文件变更时失效
invoke `curl -s -o /dev/null -w '%{time_total}' --max-time 30 http://127.0.0.1:4173/`
control 写一个新任务文件 ⇒ 下一次请求必须立刻出现它；把任务数翻倍 ⇒ 耗时增长必须低于线性
resume 先量出 provider 与渲染各占多少，再定改哪一半
```

## Chosen mechanism

1. **先分解再优化**：把 `provider_ms` 与 `route_ms − provider_ms` 分别量出来并记录，
   **按占比决定改哪一半**。外层已给出起点（2.0 s / 2.2 s），实现者应在自己的机器上复测。
2. **provider 侧**：608 个文件 1,977 ms ⇒ **每文件 3.25 ms**。查清是**每文件 I/O**、
   **整文件 YAML+markdown 解析**、还是**逐文件进程/序列化开销**——**先归因再改**。
3. **渲染/传输侧**：MCP 往返把 608 个任务的完整 body 序列化一遍；
   列表页**只需要 frontmatter 字段**（id/title/status/labels），**不需要 body**。
   若能只取所需字段，这一半可能大幅下降——**但这是 Provider ABI 的改动，要写明兼容性**。
4. **缓存（若采用）必须按 mtime 失效**，并有 AC5 的负控制。

**不做**：不引入后台预热或定时重建索引（那会让「显示的是什么时候的库」变成一个新问题）；
不为了达标而分页——**分页改变的是产品语义，不是性能**，若要做需单独裁定；
不缓存不失效。

## Acceptance Criteria

- [ ] AC1: **成本分解实测**：`provider_ms` 与渲染/传输各自占比，在实现者机器上复测并记录
- [ ] AC2: **归因**：provider 侧每文件 3.25 ms 花在哪（I/O / 解析 / 序列化），给出证据
- [ ] AC3: **主判据**：608 个任务下 `/` 的 `route_ms` **< 1.0 秒**（实跑输出贴任务体）
- [ ] AC4: **线性性改善可验证**：把任务数翻倍（复制到临时 store）⇒ 耗时增长**低于线性**，两组数据都贴
- [ ] AC5: **实时性负控制**——写入一个新任务文件后**下一次请求立刻出现它**；
      若引入缓存，另贴「修改已有任务 ⇒ 立刻反映」的输出。**这条不过，性能改善不算数**
- [ ] AC6: `/adr` 与 `/live` 的耗时**不因本次改动上升**（负控制：改动前后各测一次）
- [ ] AC7: 测试用 `node:test` 且带 `// @test-group product`（web 路由是用户可见契约）

## Definition of Done

- [ ] AC5 的实时性负控制实跑输出贴进任务体——
      **用「页面显示旧数据」换来的速度，是把一个可见的慢换成一个静默的错**
- [ ] 完整套件连跑 2 次全绿（若只到 1 次，如实标 `[~]` 并写明）
- [ ] 任务体记录成本分解的起点数字（2.0 s provider / 2.2 s 其余，608 任务），
      **以便下一个人知道这次改的是哪一半**

## Touches

- packages/quay/src/serve-handlers.ts
- packages/quay/src/provider-client.ts
- packages/quay-native/src/store.ts
- packages/quay/test/serve.test.mjs

## Dispatch review

reviewer: outer
at: 2026-08-03T15:55:00Z
changed: 管理者给了实测（8–9 ms/任务、608 个 4.90 s、其它路由 <0.15 s）并把是否成任务交给外层。
**判定成任务**，理由是它随任务数**线性增长**且任务只增不减（今天 605→608）。
**外层复测确认并把成本拆成两半**：`/` 实测 **4.245 s**，而 **`quay-native task list --json` 单独就 1,977 ms**
⇒ **provider ~47%、其余 ~53%**。**这一步是本任务最重要的贡献**——
没有它，实现者可能只优化渲染，而那最多砍掉一半，正是本仓「分母错了」那一族。
**并预先钉住一个会被顺手破坏的约束**：`CLAUDE.md` 明写 serve 每次请求实时读库，
**任何缓存必须按 mtime 失效**；AC5 是它的负控制，且写明**这条不过性能改善不算数**——
**用「显示旧数据」换来的快，是把可见的慢换成静默的错**。
**范围上砍掉两条**：不做后台预热/定时索引（会让「显示的是什么时候的库」变成新问题）、
**不为达标而分页**（那是产品语义变更，要单独裁定）。
**派发时机**：在飞已满 3，等槽位。
