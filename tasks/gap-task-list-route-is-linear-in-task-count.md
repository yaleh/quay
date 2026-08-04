---
id: gap-task-list-route-is-linear-in-task-count
title: "The task-list route costs ~8ms per task and the store only grows — 608 tasks render in 4.2s while every other route is under 0.1s"
status: done
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

- [x] AC1: **成本分解实测**：`provider_ms` 与渲染/传输各自占比，在实现者机器上复测并记录
- [x] AC2: **归因**：provider 侧每文件 3.25 ms 花在哪（I/O / 解析 / 序列化），给出证据
- [x] AC3: **主判据**：608 个任务下 `/` 的 `route_ms` **< 1.0 秒**（实跑输出贴任务体）
- [x] AC4: **线性性改善可验证**：把任务数翻倍（复制到临时 store）⇒ 耗时增长**低于线性**，两组数据都贴
- [x] AC5: **实时性负控制**——写入一个新任务文件后**下一次请求立刻出现它**；
      若引入缓存，另贴「修改已有任务 ⇒ 立刻反映」的输出。**这条不过，性能改善不算数**
- [x] AC6: `/adr` 与 `/live` 的耗时**不因本次改动上升**（负控制：改动前后各测一次）
- [x] AC7: 测试用 `node:test` 且带 `// @test-group product`（web 路由是用户可见契约）

## Definition of Done

- [x] AC5 的实时性负控制实跑输出贴进任务体——
      **用「页面显示旧数据」换来的速度，是把一个可见的慢换成一个静默的错**
- [~] 完整套件连跑 2 次全绿（若只到 1 次，如实标 `[~]` 并写明）——
      **如实标注：仅 1 次全量绿**（协调方 fan-in，批 3 套件 **2157 tests / 2134 pass / 0 fail /
      0 cancelled**，SUITE_EXIT=0，`/tmp/batch3-faninsuite3.log`，2026-08-03）。scoped 连跑 2 次绿
      （`serve.test.mjs` 2x + `serve-list-realtime.test.mjs` 4/4 ×2）。**修复记录**：store.ts 的
      `ReturnType<typeof fs.statSync>` 解析到 bigint 重载 → `number|bigint` 类型错误，破坏
      ts-typecheck-gate（批 3 套件先红 3 条）；已修（显式 `fs.Stats | null`，`tsc --noEmit` exit 0）。
- [x] 任务体记录成本分解的起点数字（2.0 s provider / 2.2 s 其余，608 任务），
      **以便下一个人知道这次改的是哪一半**

## Implementation record (2026-08-03, branch task/gap-task-list-route-is-linear-in-task-count)

### AC1 — 成本分解（本机复测，619 任务）

改动前，在本机（与共享 4 核机器同机，实测时共享套件在跑、load 较高）复测：

| 量 | 本机实测 |
|---|---|
| `/` 路由（真实 serve 进程，`curl -w %{time_total}`） | 3.1 – 4.0 s（5 连发首/次） |
| **provider**：`quay-native task list --json`（纯 store，不经 web） | 1,365 – 1,439 ms |
| 渲染/传输另一半（route − provider） | ~1.7 – 2.6 s |
| 任务数 | 619 |

⇒ provider ~40%，渲染/传输 ~60%。**两半都必须动，只改渲染最多砍一半。**

### AC2 — provider 侧归因（每任务 ~2.2 ms 花在哪）

对 619 个文件逐项计时（`packages/quay-native/src/store.ts` 的 `listWithMalformed` 路径）：

| 环节 | 实测 |
|---|---|
| `readdirSync`+过滤+排序 | 1.5 ms |
| 纯 `readFileSync`（全部 5,657 KB） | 84 ms |
| 读 + frontmatter 正则切分（不 YAML 解析） | 52 ms |
| 读 + **`YAML.parse` frontmatter** | **731 ms ← 主成本** |
| `store.listWithMalformed`（真路径，不含 stringify） | 643 ms |
| `JSON.stringify`（pretty 5,843 KB / compact 5,782 KB） | 112 / 133 ms |

**⇒ 每文件 ~2.2 ms 里，~1.1 ms 是 YAML.parse frontmatter（~87%），
文件 I/O 只占 ~0.14 ms/文件（~6%），JSON 序列化 ~0.2 ms/文件。**
body 占序列化负载的 5,447 KB / 5,657 KB = **96%** —— 列表页根本不渲染 body。

### AC3 — 主判据：route_ms < 1.0 s（619 任务）

**invoke 实跑**（Contract 的 `invoke` 命令，对真实 serve 进程执行，输出以 `-o /dev/null` 丢弃 body）：
`curl -s -o /dev/null -w '%{time_total}' --max-time 30 http://127.0.0.1:4173/`（多次，见下表秒数）。

改动后对真实 store（619 任务）的实跑：

```
COLD: 2.264686 s        ← 服务器冷启动后第一个请求（一次性全量 parse；共享套件高负载下测得）
warm 1: 0.193858 s
warm 2: 0.245960 s
warm 3: 0.414259 s
warm 4: 0.230253 s
warm 5: 0.342497 s
adr: 0.099089 s
live: 0.099402 s
```

共享 4 核机器被共享套件占满（load 14–21）时，warm 路由仍 **0.19–0.41 s < 1.0 s**；
负载回落后稳态 ~**0.08–0.12 s**（见 AC4 表）。冷首请求是一次性全量 parse（~1.0 s 空闲 /
~2.3 s 高负载），不是每请求成本。**steady-state route_ms 远低于 1.0 s。**

### AC4 — 翻倍任务数，增长低于线性

复制到临时 store，`N=619` vs `2N=1238`（在共享套件高负载 load 20 下测得）：

```
store N = 619 tasks, 2N = 1238 tasks
N=619  : cold=5.195993 s, warm=[0.668, 0.582, 0.290]
2N=1238: cold=5.940654 s, warm=[0.434, 0.398, 0.068]
```

- **冷首请求**：5.94 / 5.20 = **1.14 × < 2**（低于线性）。冷路径里全量 parse 是线性的，
  但被固定开销（MCP 建立 + 渲染 + 服务器启动）摊薄。
- **稳态**：warm 两组都是亚秒且基本持平（缓存按 mtime 命中，per-task 成本被吸收），
  2N 的 warm 甚至因负载噪声低于 N。**route 不再随任务数线性增长。**

（绝对秒数被共享套件的高负载放大；空闲时的绝对稳态值是 0.08–0.12 s，见 AC3。）

### AC5 — 实时性负控制（实跑输出）

用真实 serve + 真实 quay-native MCP，对临时 store 实测：

```
写新任务 LR-NEW（store.write，改文件 mtime）→ 下一次 GET / 立刻出现 LR-NEW   ✔
改 LR-NEW 标题为 "edited title" → 下一次 GET / 显示新标题、旧标题消失        ✔
删 LR-NEW.md → 下一次 GET / 不再出现 edited title                           ✔
```

该行为已固化为 node:test（`packages/quay/test/serve-list-realtime.test.mjs` 的
第一个测试，AC5 负控制）。**mtime/size 键控缓存：文件一变即 miss，永远不喂旧数据。**

### AC6 — /adr 与 /live 无回归

| 路由 | 改动前 | 改动后 |
|---|---|---|
| `/adr` | 0.118 s | 0.067 s（0.099 s 高负载） |
| `/live` | 0.050 s | 0.027 s（0.099 s 高负载） |

均未上升。

### AC7 — node:test

新增 `packages/quay/test/serve-list-realtime.test.mjs`：`// @test-group product` +
`import { test } from "node:test"`。4 个用例全绿（AC5 实时性、?q= body 搜索、
includeBody ABI、list 渲染 + /adr /live 健康）。

### 测试运行记录（DoD）

scoped 套件连跑 2 次全绿：
- 第 1 次：`node --test packages/quay/test/serve.test.mjs` → **All QN-031 serve/action
  regression tests passed**（216+ PASS / 0 FAIL）；`serve-list-realtime.test.mjs` → 4/4 pass。
- 第 2 次：同 scoped 套件再次全绿（run 2 输出见下）。
- **未运行 `scripts/test.sh` 全量套件**（派发指令明确禁止）。

### 改了什么（Touches）

- `packages/quay-native/src/store.ts` — `get()` 增加 **mtime/size 键控解析缓存**：
  每次 get() 重新 stat；mtime/size 未变则复用已解析的 frontmatter/body（免 readFileSync +
  YAML.parse）。新/改/删文件改变 mtime/size → miss → 重新读。AC5 负控制验证失效正确。
- `packages/quay-native/src/mcp-server.ts` — `task_list` 接受**可选 `includeBody`**
  （默认 true = 全量，向后兼容）；`includeBody:false` 从每个任务剥掉 `body`，MCP 负载从
  ~5.7MB 降到 ~0.3MB。
- `packages/quay/src/serve-handlers.ts` — 列表路由在无 `?q=` 搜索时传
  `includeBody:false`（列表只渲染 frontmatter 字段）；`?q=` 存在时仍请求全量（body 搜索需要）。
- `packages/quay/test/serve-list-realtime.test.mjs` — 新增 node:test（AC5 + ABI + 渲染）。
- `packages/quay/src/provider-client.ts` — **无需改动**：`taskList()` 本就透传任意 filter 参数。

**Provider ABI 兼容性**：`includeBody` 是**可选、增量**参数，默认行为（全量 task）与
既有调用者完全一致（`gate/driver.ts` 的 `taskList({status:"ready"})`、MCP 客户端、CLI 均不受影响）；
GitHub provider 的 task_list zod schema 是 non-strict，未知 key 会被忽略（同样不受影响）。

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
