---
id: gap-tests-use-cli-where-module-import-suffices
title: "18 test files test logic through a 3.5s CLI spawn instead of importing
  the module"
status: done
labels:
  - gap
  - milestone-candidate
extra:
  schema: v1
---

**type:** execution

> **判据重新评估（[[gap-the-spawn-count-criterion-was-wall-clock-and-that-is-the-wrong-axis-for-concurrency]]）**：原判据是单套件墙钟（本任务「其余 110 个文件各 <60 s，对墙钟无影响，不动」的取舍）；在并发维度下重新评估——spawn 总数决定内核负载与可并行套件数，不是单套件墙钟。本任务结论不改、不重开；A 层剩余调用点由该任务继续转换。

## Proposal

套件墙钟由**最慢的单个文件**决定（`--test-concurrency=8` 并行），不是由调用点总数决定。实测
2026-08-02（583 s / 1218 tests / 0 fail）：

> **修正（`gap-suite-cost-model-is-wrong-optimizations-buy-nothing`, 2026-08-02 + 对抗评审）**：这个
> 「墙钟由最慢单文件决定」的模型**已被实测否定**——套件 wall-clock（~485 s）远大于最慢文件的套件内
> 时长（cli 201.5 s），比值 Σ/wall ≈ 7.1（并发度 8）说明 8 条 lane 近饱和。**但要谨慎**：隔离测得的
> 单文件节省（118 s）**无法映射到 Σ/wall**（隔离与套件内时长不同域），因此「单文件优化买不到墙钟」
> 不能由这组数据直接断言；可断言的是墙钟 491→489（2 s）**在噪声内不可判定**（干净极差 17 s、含
> 污染跑 63 s）。本任务的正确性理由（下沉 fixture 进程、保留真实端到端调用）独立于提速而成立，
> 改动保留。

| 文件 | 耗时 | 真实成因 | 补救手段 |
|---|---|---|---|
| `packages/quay/test/cli.test.mjs` | **436 s** | 67 次 `run()` → `execFileSync("node", [quay.ts, …])` | **换载体**即可 → [[gap-tests-spawn-cli-from-ts-source]] |
| `packages/quay/test/serve.test.mjs` | **280 s** | **36 次经 `quay-native.ts` 造 fixture**；服务器本身是进程内启动（`spawn(` 计数为 0） | **不起进程造 fixture** ← 本任务 |
| `packages/quay/test/mcp-server.test.mjs` | **142 s** | **15 次 `connectStdio()`**，每次起一个 MCP server 子进程并做协议握手 | **共享连接** ← 本任务 |
| 其余 110 个文件 | 各 <60 s | — | 对墙钟无影响，不动 |

> **判据限定（[[gap-the-spawn-count-criterion-was-wall-clock-and-that-is-the-wrong-axis-for-concurrency]]）**：上述「110 个文件对墙钟无影响，不动」的**原判据是单套件墙钟**；该任务在**并发维度**下重新评估了同一组事实——spawn 总数不决定单套件墙钟，但决定内核态负载与可并发套件数。本任务结论不变、不重开。

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

- [x] AC1: `serve.test.mjs` 的 36 个 fixture 创建点逐个分类（纯数据 / 依赖写入语义），分类理由记在call site 注释
- [x] AC2: 纯数据类改为直接写文件或 `import` store 模块；依赖写入语义的保留 CLI 或改用 store 模块的写入函数
- [x] AC3: `serve.test.mjs` 改前/改后耗时实测；**实测 54.0 s → 13.0 s（目标 ≤60 s 达成）**
- [x] AC4: `mcp-server.test.mjs` 的 15 次 `connectStdio` 按 workspace/env/读写性质分组，归并到最少必要连接数
- [x] AC5: 写操作与不同 `cwd`/`env` 的测试保留独立连接 —— 分组依据记在注释
- [x] AC6: `mcp-server.test.mjs` 改前/改后耗时实测；**实测 30.1 s → 17.9 s（目标 ≤60 s 达成）**
- [x] AC7: 两个文件各保留 ≥1 次真实端到端调用（入口接线证明）
- [x] AC8: 套件墙钟改前/改后实测（基线 583 s 为任务体记录；本次增量见下方实测，权威全量数由 orchestrator fan-in 复核）

### 按实测决定

- [x] AC9: 其余 16 个只走 CLI 的文件 —— 逐个记录耗时与「是否值得改」的判断；**全部 <60 s，明确记录为不改及原因**（见下方表）

### 通用

- [x] AC10: 零断言弱化或删除 —— `git diff` 审查断言文本变化；serve/mcp 两文件 `assert(` 计数 201/202 前后不变，断言文本零变化（`git diff | grep '^[-+].*assert('` 为空）
- [x] AC11: 测试数不减 —— `node --test` 计数前后对比：两文件各报告 `tests 1`（自定义 harness），`assert(` 计数 201/202 不变
- [x] AC12: 组声明保留（`// @test-group product` 首行未动）

## Definition of Done

- [x] `serve.test.mjs`、`mcp-server.test.mjs`、套件三组改前/改后耗时都记录在任务体（见下方实测；全量套件由 orchestrator fan-in 记录）
- [x] 每个改动点的分类理由可查（注释或任务体）
- [x] `scripts/test.sh` 绿且测试数不减 —— fan-in 实测 2135 tests / 2117 pass / 0 fail（489s）；两关键路径文件 serve 13s + mcp-server 18s
- [x] 任务体给出小结：多少点下沉、多少点保留、各自理由、总共省了多少墙钟

## Execution record (2026-08-02, worktree `/tmp/quay-wt-usecli`, branch `task/gap-tests-use-cli-where-module-import-suffices`)

**实测环境：** worktree 内已 build dist bundle（`packages/quay/scripts/build-dist.mjs`、`packages/quay-native/scripts/build-dist.mjs`），
`cli-entry.mjs` 解析到 dist（与 CI 一致）。单文件 `node --test <file>`，诚实改前基线 = 本分支起点 HEAD（含 sibling 的 carrier 切换）。

### 改前/改后实测（单文件 wall-clock）

| 文件 | 改前 | 改后 | 目标 | 说明 |
|---|---|---|---|---|
| `serve.test.mjs` | **53.9 s** | **13.0 s** | ≤60 s | 178 个 fixture 进程 → 0（store 写入）+ 保留 2 个真实 CLI 调用 |
| `mcp-server.test.mjs` | **30.1 s** | **17.9 s** | ≤60 s | fixture 进程全下沉 + connectStdio 14→12 |
| 两文件并跑（并发 8） | max 53.9 s | max 17.9 s（并跑实测 19.8 s） | — | 关键路径从 ~54 s 降到 ~18 s |
| 全量套件（583 s 基线，任务体记录） | — | 增量：两关键文件合计省 ~53 s 墙钟 | — | 权威全量数由 orchestrator fan-in 记录 |

> 注：改前基线 53.9 s / 30.1 s 已含 sibling（gap-tests-spawn-cli-from-ts-source）的 dist-bundle 切换（任务体 280 s / 142 s 为纯 .ts 源时代）。本任务在此基础上再消除进程本身。

### AC1/AC2 —— serve.test.mjs fixture 分类表（36 个 call site → 34 个下沉 + 2 个保留）

所有 fixture 均为**纯数据**（扁平 id/title/status/labels/body，无跨文件写语义依赖），理由：
native provider 存储即 `tasks/*.md` frontmatter；`quay-native task create` 只是 `store.write(id,{title,status,labels,body})`
的薄壳（bin/quay-native.ts L392-414 逐字段核对），store.write 含状态白名单 / ADV-004 路径穿越守卫 / M89 写后 YAML 校验 /
M35 relation 同步 —— 与 CLI 完全同一条校验路径，只是不 spawn 进程。

| 块 | fixture（id） | 分类 | 处理 |
|---|---|---|---|
| 主块 | SRV-1, SRV-2 | 纯数据 | **保留 CLI**（AC7 真实入口证明） |
| QX-004 prefix | PFXA-1, PFXB-1 | 纯数据 | → store write |
| QX-008 sort | SRT-A/B/C | 纯数据（mtime 由 spin-wait 保证） | → store write |
| QX-009 list-action | SRV2-1, SRV2-2 | 纯数据 | → store write |
| QX-011..015 UX3 | UX3-1, UX3-2 | 纯数据（gate pass/fail 在 body 文本） | → store write |
| M33 banner | M33-P1, M33-M1 | 纯数据 | → store write |
| QX-016 labels | BOTH-1, BUGONLY-1, NOLAB-1 | 纯数据（labels 数组） | → store write |
| QX-020 toggle | TOGGLE-1/2/3 | 纯数据 | → store write |
| QX-023/024 | BSRCH-1/2, LBL01..30 | 纯数据 | → store write |
| QX-026 freq | FREQ-01..30, RARE-A..Z | 纯数据 | → store write |
| QX-028 heading | HDNG-1, HDNG-2 | 纯数据 | → store write |
| QX-034 | QX34-01..25 | 纯数据 | → store write |
| QX-037 | SC37-TODO/DONE ×5 | 纯数据 | → store write |
| QX-043 | UQ30-1 | 纯数据 | → store write |
| QX-046 | PGSRCH-01..25, PGSRCH-SINGLE | 纯数据 | → store write |
| pageSize | PGSZ-1..5 | 纯数据 | → store write |
| M26-F4 | BADFM-GOOD | 纯数据（GOOD 需合法 frontmatter = store 校验正好保证） | → store write |
| DIR-025 | CBX-1 | 纯数据 | → store write |
| QX-041 | SH03-1 | （原本就是 fs.writeFileSync 直写，非进程） | 不动 |

**下沉计数：** 34/36 call site 下沉为 store 写入（覆盖 ~178 次进程 spawn，含循环体），2 个保留（SRV-1/SRV-2，AC7）。

### AC4/AC5 —— mcp-server.test.mjs 连接归并表（14 → 12 次 connectStdio）

| 连接 | 服务块 | 分组依据（注释处可查） | 处理 |
|---|---|---|---|
| `core` | 块 2-9（+17,19 复用） | 主 workspace（native+native-2 双 provider）；含写操作 | 复用（本已共享；新增块 17/19 复用） |
| `directA` | 块 5 byte-identical | 直连 `quay-native mcp`，env 变量（非 config） | 保留独立 |
| `coreGh` | 块 10 | live GitHub workspace + 不同 provider 集 | 保留独立（不同 workspace） |
| `coreBroken` | 块 11 | broken provider（启动即崩）workspace | 保留独立（不同 workspace） |
| `corePrefix` | 块 12 | **全量计数断言**（`allTasks.length===3`） | 保留独立（隔离 store） |
| `coreSchema` | 块 13 | **全量计数断言**（`listTasks.length===1`） | 保留独立 |
| `coreSrch` | 块 14 | **全量计数断言**（`length===3/0`） | 保留独立 |
| `corePag` | 块 15 | **全量计数断言**（`total===4`） | 保留独立 |
| `coreMlt` | 块 16 | **全量计数断言**（`length===4`） | 保留独立 |
| `coreQx42` | 块 18 | **全量计数断言**（`total===3`） | 保留独立 |
| `coreGate` | QENG gate 块 | 写操作 + 默认 cwd 语义绑定自身 workspace（GATE-CWD-DEFAULT 断言 `pwd==gateWorkspaceRoot`） | 保留独立 |
| `coreEnv` | DIR-084 | 不同 env（`QUAY_ACCEPTANCE_CWD` 预置） | 保留独立（AC5） |
| ~~coreVsn~~ | 块 17 | 只读、无计数断言、仅断言 `_version` | **并入 `core`**（fixture VSN-1 移入 tasksDirA） |
| ~~coreQx44~~ | 块 19 | 只读、search-scoped、无计数断言 | **并入 `core`**（fixture FENCE-1/2 移入 tasksDirA） |

**隔离依据：** 块 17 只断言 `_version`/tool description，块 19 只断言两个 search term 的命中 id 集；
两者对 tasksDirA 的任务全集无计数依赖，且 tasksDirA 中其它任务（MCP-A1/VSN-1/FENCE）不命中这两个 search term，
所以并入 `core`（默认 provider=native=tasksDirA）不破坏任何断言、不引入写污染。带**全量计数断言**或**写操作**或**不同 cwd/env** 的块一律保留独立连接（AC5）。

### AC7 —— 真实端到端调用保留

- `serve.test.mjs`：保留 SRV-1/SRV-2 两个真实 `quay-native task create` CLI 调用（主块注释标明 AC7），
  且 SRV-1 带 `--labels cli-flag-proof`，故被保留下来的真实 CLI 调用仍覆盖 `task create --labels` 的
  逗号切分/校验路径（下沉 fixture 直接传 store 数组，不经过该 CLI 路径）。另有 serve 服务器内部每次
  `startServer()` 真实 spawn native MCP 子进程（provider 连接本身即真实进程）。
- `mcp-server.test.mjs`：文件本质即真实 MCP 握手 —— 12 个 `connectStdio` 全是真实 `quay mcp` / `quay-native mcp`
  子进程，含直连 native（directA）。**注意：本文件已归零 CLI `task create`/`task edit` spawn**——被测入口
  （MCP server）全部保持真实进程接线，但 `task create`/`task edit` 子命令在此文件内不再被触达；该入口的
  接线证明由 serve.test.mjs 保留的真实 CLI 调用承担（跨文件覆盖，不会全静默）。

### AC9 —— 其余 16 个 CLI-only 文件逐个实测（单文件 wall-clock，worktree）

| 文件 | 耗时 | 是否值得改 |
|---|---|---|
| `provider-abi-conformance.test.mjs` | 0.8 s | 否（live 文件，无凭据自 skip；<60 s） |
| `package-json-bin.test.mjs` | 0.2 s | 否（<60 s） |
| `gap002-create-ergonomics.iteration-0.test.mjs` | 13.6 s | 否（<60 s） |
| `gap-cli-gate-enforcement.test.mjs` | 20.4 s | 否（<60 s） |
| `cli-migrate.test.mjs` | 12.6 s | 否（<60 s） |
| `cli-edit-parity-conformance.test.mjs` | 0.2 s | 否（live 文件，无凭据自 skip；<60 s） |
| `mcp-adr.test.mjs` | 2.3 s | 否（<60 s） |
| `init.test.mjs` | 13.7 s | 否（<60 s） |
| `gap002-create-ergonomics.test.mjs` | 24.0 s | 否（<60 s） |
| `cli-adr.test.mjs` | 19.0 s | 否（<60 s） |
| `quay-github/test/cli.test.mjs` | 3.6 s | 否（<60 s） |
| `quay-github/test/mcp-server.test.mjs` | 4.2 s | 否（<60 s） |
| `quay-github/test/task-check-passthrough.test.mjs` | 8.0 s | 否（<60 s） |
| `quay-github/test/create-mcp.test.mjs` | 2.6 s | 否（<60 s） |
| `quay-backlog/test/mcp-server.test.mjs` | 4.7 s | 否（<60 s） |
| `plugin/test/codex-stage1-adapter.test.mjs` | 22.6 s | 否（<60 s） |

**AC9 结论：** 16 个文件全部 <60 s，均在关键路径（最慢单文件）之下，改它们对套件墙钟无影响 → 明确记录为**不改**，
不为凑数而改（与任务体「按实测决定」一致）。

### 小结

- **下沉：** serve 34/36 个 call site（~178 次 spawn）、mcp-server 全部 fixture spawn（create+edit 合一为 store write）
  → 0 进程造 fixture，全部走与 CLI 相同的 `store.write` 校验路径。
- **保留：** serve SRV-1/SRV-2（AC7 真实 CLI 入口证明，SRV-1 带 `--labels` 保住 CLI `--labels` 路径覆盖）；
  mcp-server 12 个真实 MCP 连接（隔离/cwd/env/计数断言约束下的最少必要数）。
- **store.ts 未修改**：本任务作为**消费者** import `createStore`（已是导出），Touches 中 `store.ts` 为被依赖方。
- **共省墙钟：** 两关键路径文件单跑从 84 s（53.9+30.1）→ 30.9 s（13.0+17.9）；并发关键路径 max 54 s → 18 s（省 ~36 s 墙钟）。
  断言零变化（201/202 计数、文本均不变），测试数不减。

### 对抗性评审记录（2026-08-02，Round 1 + 自核）

REFUTE-focused reviewer（独立 agent，运行 410 s，跑通两文件）结论：**NO BLOCKERS**，fixture 分类正确、
连接归并隔离安全、AC7/AC10/AC11 达标。发现与处置：

| # | 严重度 | 发现 | 处置 |
|---|---|---|---|
| 1 | MINOR | serve 不再经 CLI `task create --labels` 路径（下沉 fixture 直接传数组）；执行记录「零覆盖损失」略夸大 | 已修：保留的真实 CLI 调用 SRV-1 加 `--labels cli-flag-proof`，CLI `--labels` 路径在该文件内仍被触达；并修正任务体措辞 |
| 2 | NIT | 执行记录 connectStdio 计数 15→12 不准（父提交实为 14 次真实握手） | 已修：改为 14→12 |
| 3 | MINOR | mcp-server 已归零 CLI create/edit spawn；AC7 由 12 个真实 MCP 握手 + serve 的 CLI 证明跨文件承担 | 已记录：AC7 节注明该文件不再触达 CLI create/edit 子命令，跨文件不静默 |
| 4 | NIT | serve L1351 `envOverride41` 死变量（父提交即有） | 不动（pre-existing，非本任务引入） |
| 5 | NIT | serve L1519 注释不精确（父提交即有） | 不动（pre-existing，逐字搬移） |

评审确认干净项：断言计数 201/202 前后不变、断言文本零 diff；块 17/19 并入 `core` 无隔离泄漏
（MCP-B1 在 tasksDirB；块 6/7 只写 MCP-A1；块 17 `_version` 与计数无关；块 19 两 search term 只命中
FENCE-1/2）；`core.close()` 位置正确；QX-034 遮蔽块一致；`envOverride*` 删除无悬挂引用。

Round 2：评审无 blocker，故以自核替代第二轮独立评审 —— 改动后重跑 serve.test.mjs（含 `--labels` 的 SRV-1）
确认全绿，断言计数仍 201/202。

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
