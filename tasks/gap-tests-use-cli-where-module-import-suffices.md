---
id: gap-tests-use-cli-where-module-import-suffices
title: "18 test files test logic through a 3.5s CLI spawn instead of importing
  the module"
status: todo
labels:
  - gap
  - milestone-candidate
extra:
  schema: v1
---

**type:** execution

## Proposal

套件墙钟由**最慢的单个文件**决定（`--test-concurrency=8` 并行），不是由调用点总数决定。实测
2026-08-02（583 s / 1218 tests / 0 fail）：

| 文件 | 耗时 | 真实成因 | 补救手段 |
|---|---|---|---|
| `packages/quay/test/cli.test.mjs` | **436 s** | 67 次 `run()` → `execFileSync("node", [quay.ts, …])` | **换载体**即可 → [[gap-tests-spawn-cli-from-ts-source]] |
| `packages/quay/test/serve.test.mjs` | **280 s** | **36 次经 `quay-native.ts` 造 fixture**；服务器本身是进程内启动（`spawn(` 计数为 0） | **不起进程造 fixture** ← 本任务 |
| `packages/quay/test/mcp-server.test.mjs` | **142 s** | **15 次 `connectStdio()`**，每次起一个 MCP server 子进程并做协议握手 | **共享连接** ← 本任务 |
| 其余 110 个文件 | 各 <60 s | — | 对墙钟无影响，不动 |

三个文件三种成因，**不能用同一个手段**。这是本任务与 [[gap-tests-spawn-cli-from-ts-source]] 的分工：
那个任务换执行载体（对 `cli.test.mjs` 有效），本任务消除不必要的进程本身（对另外两个有效）。

### serve.test.mjs — 用 CLI 造 fixture

36 处 spawn 全部是 `execFileSync("node", [nativeBin, "task", "create", …])`，`nativeBin` 指向
`quay-native/bin/quay-native.ts`。**它们不测 serve，它们在准备数据。**

native provider 的存储格式就是 `tasks/*.md` 的 YAML frontmatter——一个 fixture 直接 `writeFileSync`
一个 markdown 文件即可，无需起一个 TypeScript CLI 进程。

**但要小心：** 直接写文件会绕过 `quay-native` 的写入校验（frontmatter schema、id 唯一性、relation
同步）。若某个 fixture 的正确性依赖那些校验，绕过它就是在测一个不可能存在的状态。所以：

- 纯数据 fixture（「存在两个 task，一个 todo 一个 done」）→ 直接写文件
- 依赖写入语义的 fixture（「创建时 relation 被同步」）→ 保留 CLI，或改为直接 `import` store 模块调用其写入函数

第二种优于第一种：`import` store 模块既有校验又无进程开销。

### mcp-server.test.mjs — 每个测试一次握手

15 次 `connectStdio()`，每次 `StdioClientTransport` + `client.connect()`。握手本身不可省，但
**连接数可以省**：多个只读断言可以复用同一个 client，只有需要不同 workspace/env 的才必须新建。

**边界：** 测试隔离不能牺牲。共享 client 的前提是那组测试不互相污染状态。凡是写操作、或依赖不同
`cwd`/`env` 的，必须保留独立连接。

## Chosen mechanism

按关键路径逐个处理，每个用它自己的手段：

1. **`serve.test.mjs`（280 s → 目标 ≤60 s）**：把 36 个 `task create` fixture 分类——纯数据的改为
   直接写 markdown 或 `import` store 模块；依赖写入语义的保留。记录每个的分类理由。
2. **`mcp-server.test.mjs`（142 s → 目标 ≤60 s）**：把 15 次 `connectStdio` 归并到最少必要连接数，
   按 workspace/env/读写性质分组。保留隔离，只合并真正无冲突的。
3. **其余 16 个只走 CLI 的文件**：**先实测再决定**。耗时 <60 s 的文件不在关键路径上，改它们对墙钟
   无影响——记录这个判断即可，不作为验收条件。

**保留 ≥1 次真实端到端调用。** 即使一个文件的所有断言都可以下沉，也必须留一次真实进程调用证明
CLI/MCP 入口确实接得上。全部下沉会让入口坏掉时隐形。

**覆盖不得缩小。** 下沉后的断言必须断言同一件事、覆盖同一条代码路径。若下沉会丢失对某层的覆盖，
那它就不是「不必要的进程」，保留。

## Acceptance Criteria

### 必做 — 关键路径

- [ ] AC1: `serve.test.mjs` 的 36 个 fixture 创建点逐个分类（纯数据 / 依赖写入语义），分类理由记在call site 注释
- [ ] AC2: 纯数据类改为直接写文件或 `import` store 模块；依赖写入语义的保留 CLI 或改用 store 模块的写入函数
- [ ] AC3: `serve.test.mjs` 改前/改后耗时实测；**目标 280 s → ≤60 s**
- [ ] AC4: `mcp-server.test.mjs` 的 15 次 `connectStdio` 按 workspace/env/读写性质分组，归并到最少必要连接数
- [ ] AC5: 写操作与不同 `cwd`/`env` 的测试保留独立连接 —— 分组依据记在注释
- [ ] AC6: `mcp-server.test.mjs` 改前/改后耗时实测；**目标 142 s → ≤60 s**
- [ ] AC7: 两个文件各保留 ≥1 次真实端到端调用（入口接线证明）
- [ ] AC8: 套件墙钟改前/改后实测

### 按实测决定

- [ ] AC9: 其余 16 个只走 CLI 的文件 —— 逐个记录耗时与「是否值得改」的判断；**耗时 <60 s 的明确记录为不改及原因**，不要为凑数而改

### 通用

- [ ] AC10: 零断言弱化或删除 —— `git diff` 审查断言文本变化，任何变化在 commit 说明
- [ ] AC11: 测试数不减 —— `node --test` 计数改前/改后对比
- [ ] AC12: 组声明保留（[[gap-test-suite-has-no-layer-grouping]]）

## Definition of Done

- [ ] `serve.test.mjs`、`mcp-server.test.mjs`、套件三组改前/改后耗时都记录在任务体
- [ ] 每个改动点的分类理由可查（注释或任务体）
- [ ] `scripts/test.sh` 绿且测试数不减
- [ ] 任务体给出小结：多少点下沉、多少点保留、各自理由、总共省了多少墙钟

## Touches

关键路径（必做）：

- packages/quay/test/serve.test.mjs
- packages/quay/test/mcp-server.test.mjs
- packages/quay-native/src/store.ts

非关键路径（先实测再决定是否改；列出以便 Touches 覆盖）：

- packages/quay/test/provider-abi-conformance.test.mjs
- packages/quay/test/package-json-bin.test.mjs
- packages/quay/test/gap002-create-ergonomics.iteration-0.test.mjs
- packages/quay/test/gap-cli-gate-enforcement.test.mjs
- packages/quay/test/cli-migrate.test.mjs
- packages/quay/test/cli-edit-parity-conformance.test.mjs
- packages/quay/test/mcp-adr.test.mjs
- packages/quay/test/init.test.mjs
- packages/quay/test/gap002-create-ergonomics.test.mjs
- packages/quay/test/cli-adr.test.mjs
- packages/quay-github/test/cli.test.mjs
- packages/quay-github/test/mcp-server.test.mjs
- packages/quay-github/test/task-check-passthrough.test.mjs
- packages/quay-github/test/create-mcp.test.mjs
- packages/quay-backlog/test/mcp-server.test.mjs
- plugin/test/codex-stage1-adapter.test.mjs

`packages/quay/test/cli.test.mjs` 不在本任务范围 —— 它的成因是执行载体，归
[[gap-tests-spawn-cli-from-ts-source]]。
