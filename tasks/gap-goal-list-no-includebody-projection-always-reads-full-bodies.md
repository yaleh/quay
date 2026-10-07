---
id: gap-goal-list-no-includebody-projection-always-reads-full-bodies
title: goal list 在 --json 和非 --json 下同样慢（~1.3s/234 条）——goal ABI 从没有 includeBody
  投影，不是 task list 那种耦合 bug
status: done
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
---
## Finding
**背景**：另一会话在复核 `gap-cli-task-list-json-body-coupled-to-json-flag` 时提示"`goal list --json` 在他们那边是第二大
单项（1.3s/1.1MB），接受 task 的 flag 修复后新上界会落到这条"，问要不要查同因、要不要立——本任务是查证结果。

**实测（本仓库真实 store，234 个 goal）**：
```
time (.quay/plugin/bin/quay goal list        | wc -c)   # 1.305s / 31642 字节
time (.quay/plugin/bin/quay goal list --json | wc -c)   # 1.275s / 1113148 字节
```
**两种模式耗时几乎相同**——这和 `gap-cli-task-list-json-body-coupled-to-json-flag` 的情形**不是同一种根因**：task 那条
是"省读路径已经存在且快、只是 `--json` 模式没开关用它"；goal 这条是**两种模式都慢**，说明 goal 的省读路径根本不存在。

**代码确认**：`packages/quay/src/cli/goal.ts` 的 `list` 分支（约 258-267 行）：
```
const goals = await client.goalList(filter);
if (wantsJson) printJson(goals); else ...
```
`client.goalList(filter)` 调用**不带任何 `includeBody`/分页参数**——`filter` 只有 `status`/`kind`/`goal`，无论
`wantsJson` 真假都是同一次全量调用。对照 `task list` 的 Provider ABI（`packages/quay-native/src/store.ts` 的
`includeBody:false` 两阶段省读）：goal 的 Provider ABI 侧目前**没有对应的 includeBody 概念**（未在本任务内逐行核实
quay-native 的 goal store 实现，留给实现时查证——这正是本任务判定为 `finding` 而非直接给修法的原因：task 那条的修法
是"接一个已经验证可行的现成省读路径"，风险小；goal 这条如果真的从 ABI 到 Provider 都没有省读概念，修法需要新增这条
能力，范围和风险都不是简单的 CLI flag 接线，值得先立案查清楚再决定怎么改，不预先假定修法）。

**不下结论的部分（留给后续）**：1.3s 对 234 个 goal（task list 的 2589 个任务读全量 body 要 3.4s，goal 按比例应该更快，
实际慢于比例预期）——是 goal body 平均更大、是别的慢路径（例如逐条额外的 I/O，如 staleness 计算 `goalStalenessMark`
是否有逐条额外开销）、还是别的原因，本任务未查证，留给实现时先做 profile 再动手（同一会话之前查 task list 时用了
`node --cpu-prof`，这里应该先照做一次，不要直接假定"body 更大"就是唯一原因）。

## Touches
- `packages/quay/src/cli/goal.ts`
- `packages/quay-native/src/store.ts`
- `tasks/gap-goal-list-no-includebody-projection-always-reads-full-bodies.md`

## AC
- [x] 用 `node --cpu-prof` 或同等手段对 `goal list --json`（真实 store）做一次性能剖析，贴出耗时最高的几个函数/调用点，确认瓶颈具体在哪一层（Provider 调用本身 / frontmatter 解析 / body 解析 / `goalStalenessMark` 之类的逐条附加计算 / 其它），不要假设。
- [x] 核实 quay-native 的 goal store（Provider 实现）是否已有 `includeBody` 或等价的轻量投影能力但未被 `client.goalList` 使用，还是确实从 ABI 到 Provider 都不存在——把结论（存在but未接 / 完全不存在）写进完成记录，附具体文件/行号证据。
- [x] 基于上一条 AC 的结论，判定本 gap 是否值得立一个后续实现任务（不在本任务内实现修复）；若判定"值得"，在完成记录里写出后续任务该做什么（不要在本任务内动代码）。
- [x] `bash scripts/test.sh --for-task gap-goal-list-no-includebody-projection-always-reads-full-bodies` 退出 0（本任务只读查证+记录，不改产品代码，预期不需要新测试文件，但仍需确认这条命令本身不因为任务文件改动而红）。

该轴仍暗，理由：本任务是只读性能剖析与根因查证，不改动产品代码，不新增模块或包间依赖，L_D/L_G（依赖结构/重复抽象）轴
对纯诊断性任务不提供信号。

## DoD
真实落地：完成记录里有一次真实 `--cpu-prof`（或等效工具）剖析输出的具体读数（函数名+耗时占比，不是"应该是 xxx"的
推断），以及"goal 的省读能力存在但未接 / 完全不存在"这一判定的具体文件/行号证据；是否值得立后续实现任务的判断连同
理由写清楚。

## Evidence

**AC1 结论：瓶颈不是 body / 逐条附加计算，而是每次 goal 读取都对全量 `.quay/gate-events.jsonl`
做「整体读入 + 逐行 JSON.parse」（`ledgerEvidenceMap` → `queryGateEvents`）——固定 per-call 成本，
与 `--json` 无关、与返回条数无关。frontmatter(YAML) 解析只占 ~4%；`body` 从不被解析（只是已读文件
的一个子串，原样挂在 view-model 上）；`goalStalenessMark` 是 CLI 侧一行小函数，非瓶颈。**

**真实 store 复现**（`/data/home/yale/work/quay`，234 个 goal carrier；源码入口
`node --experimental-strip-types packages/quay/bin/quay.ts`，与 finding 用的 `.quay/plugin/bin/quay` 同量级）：
```
goal list --json      1.34s      goal list (plain)  1.30s     # 复现原 finding：两模式几乎相同
goal list --kind=goal 1.36s                                 # 过滤到 GOAL 记录仍全速 ⇒ 过滤省不了
goal show GOAL-020    1.30s                                 # 单条读取同样慢 ⇒ 固定 per-call 成本
```

**`node --cpu-prof` 读数**（`NODE_OPTIONS="--cpu-prof --cpu-prof-dir=…"` 同时覆盖父 CLI 与 provider 子进程；
self-time = 采样 timeDelta 之和）：
- 父（`quay` CLI）进程：wall 1417ms，**`(idle)` 1171ms（82.7%）**——父进程几乎全在等 MCP 子进程；
  `printJson` self 3.2ms、`concat` 14.8ms。⇒ 父侧无实工。
- provider 子进程（native MCP server，wall 1133ms）self-time 前列：
  ```
  303.3ms 26.8%  (anonymous)  @ packages/quay/src/gate/gate-event-store.ts:95   # .map(line => JSON.parse(line))
  170.2ms 15.0%  readFileSync @ node:fs:473                                     # 读 123MB ledger
  139.0ms 12.3%  (garbage collector)                                            # 481k 行 JSON.parse 的 GC 压力
   90.5ms  8.0%  queryGateEvents @ packages/quay/src/gate/gate-event-store.ts:90
   50.0ms  4.4%  readFileUtf8  @ :0
   36.5ms  3.2%  ledgerEvidenceMap @ packages/quay/src/goal-store.ts:547
  ```
  按模块聚合：`gate/gate-event-store.ts` **402.1ms（35.5%）**、`node:fs` 174.4ms（15.4%）、
  `goal-store.ts` 44.5ms（3.9%）、YAML（lexer+parser）≈44ms。**最大单项 = gate-event ledger 的读入与逐行解析。**

**隔离测量**（in-process，真实 ledger = **123.2 MB / 481293 行**）：
```
queryGateEvents(log, {gate:"goal"})   ← list()/get() 实际走的那条   692 ms/call
readFileSync(log) 裸读                                             242 ms/call
filter 命中 gate:"goal" 的事件                                       480038 / 481293
```
`queryGateEvents`（`gate-event-store.ts:90-95`）**先 `readFileSync` 全量 → `.split("\n")` → `.map(JSON.parse)`，
之后才在 `:97` 应用 filter** ⇒ `{gate:"goal"}` 省不掉任何 parse（且 480k/481k 事件本就命中）。

**分层归因**（in-process `createGoalStore(realGoalDir).list({})` 分解，多次均值）：
```
list({})                775 ms/call
  readdirSync+readFile    3.5 ms  ( 0.5%)
  parseFrontmatter       34.7 ms  ( 4.5%)
  remainder (model build + evidenceMap + progress/staleness 注解)  737 ms (95.1%)   ← 主体即上面的 ledger 读
```
**旁证**：同一份 goal 数据，**无 ledger 的 worktree**（fresh worktree 没有 `.quay/gate-events.jsonl`）
跑 `goal list --json` 仅 **0.54s**；真实 store（123MB ledger）1.34s —— 差值 ~0.8s ≈ ledger 成本。

**兄弟路径（硬规则 5b）**：`store.get("GOAL-020")` = 862ms、`quay goal show GOAL-020` = 1.30s ——
`get()` 在 `goal-store.ts:1803` 同样调 `ledgerEvidenceMap`；web `/goal` 页每次 `client.goalList()`
（`serve-goal.ts:573`）以及 `serve-dashboard.ts` 的 `client.goalList()` 调用点都付同一固定成本。
⇒ 不是「list 特有」，而是**所有 goal 读取面共有的开销**。

**AC2 结论：`includeBody` / 等价轻量投影 —— 完全不存在（从 ABI 到 Provider）**，文件/行号：
- ABI 客户端：`packages/quay/src/provider-client.ts:254` `goalList(filter)` 把 filter 原样透传给
  `goal_list`，无 includeBody、无分页。
- Provider MCP 工具 schema：`packages/quay-native/src/mcp-server.ts:415` = `inputSchema: { status, kind, goal }`
  —— **只有这三个键**。对照 `task_list` 同文件 `:159` 有 `includeBody: z.boolean().optional()`，`:160-161`
  有 `page`/`pageSize`。
- Provider store 实现：`packages/quay/src/goal-store.ts:1828-1863` `listWithMalformed` **无条件**
  `fs.readFileSync` 每个 carrier 文件并 `toViewModel`（`:1750`），view-model 的 `body`（`:1787`）与
  `criterion`/`expect` 无条件带上；**无任何投影分支**。
- 注：本 task 的 `## Touches` 写的是 `packages/quay-native/src/store.ts`，但 goal store 的**正身在 Core**
  的 `packages/quay/src/goal-store.ts`；`packages/quay-native/src/goal-store.ts` 只是 re-export shim。
  `store.ts` 里的 `includeBody` 只服务 task_list。

**AC3 判定：值得立后续实现任务 —— 但修法的靶子要改（原 finding 的假设被证伪为主要成因）**。
原假设是「goal 缺 includeBody 投影 ⇒ 需要新增省读能力」，但 profiling 显示 `--json` 与非 `--json` 同为
1.3s、父进程 82.7% 在等子进程、body 序列化近零 —— 加 includeBody 只会砍掉 1MB payload 的小头，
**不足以**解决 1.3s。后续任务应做：
1. **（首要）** 消除 `ledgerEvidenceMap`/`queryGateEvents` 每次对 123MB ledger 的整表 parse：
   例如按 ledger `mtime+size` 做进程内缓存、或改流式扫描只在命中行上 JSON.parse、或预建索引。
   ⚠️ 注意 `ledgerEvidenceMap` 同时要每个 pipeline_id 的**最后一条**（last-wins，`:563-567`）与
   **第一条**（`firstAt`，即 `firstEvidenceAt`）——单纯从尾部反向扫描只解决 last，仍需为 first 另想办法
   （缓存 / 头部索引 / 一次构建两用），实现时要把这个约束带进去。
   目标：让 `goal list`/`goal show` 的耗时与 goal 条数成比例，而非每次固定 ~0.7s。
2. **（次要）** 若仍要减传输，再给 goal ABI 加 `includeBody`(+`page`/`pageSize`)：CLI 文本模式只打印
   id/status/kind/title（`cli/goal.ts:266`），`--json`/`goal show` 才需要 body。此项**单独做不够**。
3. 连带核实同一固定成本的兄弟面：`goal show`、`serve-goal.ts:573`、`serve-dashboard.ts` 的
   `client.goalList()` 调用点。

**AC4**：`bash scripts/test.sh --for-task gap-goal-list-no-includebody-projection-always-reads-full-bodies
--allow-thin` → **EXIT 0**（105 tests pass / 0 fail）。scoped 门的选择对本任务 task 文件（勾 AC + 追加
本 Evidence 段）不敏感。
