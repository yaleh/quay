---
id: gap-worker-driver-resident-loop-decomposition-discovery
title: worker-driver.ts 7266 行 / runResidentLoop@6017 出度 30 是 loop
  生产核心最大单体——把四关注点与出度图落到可查询载体（后续切片 goal 的输入）
status: ready
labels:
  - gap
  - architecture
parent: null
children: []
extra:
  schema: execution
---
## Finding

实测（archguard scope b4f87b21 @ HEAD 6473463e3）：plugin/scripts/worker-driver.ts 全长 7266 行，其中 runResidentLoop 定义于第 6017 行、出度 30（archguard_summary topByOutDegree 第 3 位，仅次于 run=39 / handleAllRoutes=35）。同层 goal-driver.ts 5059 行、full-suite-runner.ts >3065 行。对照：packages/quay/src/serve-handlers.ts 曾是 3559 行 monolith，已按关注点拆成 22 个 serve-*.ts、现 349 行——同一仓库内已有验证过的分割模板。判断（JUDGMENT）：worker-driver.ts 的 runResidentLoop 同时装着四个关注点（状态机 retryState/counts/needsHuman、派发决策 slot-refill/claim/ready-pool、派发执行 spawn/fan-in、落账 outcome ledger），是本层最大的单体；但它是否值得按片拆、按什么边界拆，取决于尚未落到可查询载体的出度/关注点清单。本 finding 只做「把四关注点 + 函数出度图落到任务体」这件事，不实现拆分、不开 goal。

<!-- dedup-ref --> 关联（非重复）：gap-plugin-scripts-monolith-convergence-unmeasured（done）已对 plugin/scripts 整体做包级收敛判断并结论不立项；本条是同一领域的单文件切片发现（worker-driver.ts 的 runResidentLoop 出度 30 与四关注点），机制不同，不与其合并。

### 读数与证据（FACT，2026-10-21 复测）

**§E1 文件/函数位置（grep 可复核）**

| 量 | 读数 | 复核 |
|---|---|---|
| worker-driver.ts 行数 | 7266 | `wc -l plugin/scripts/worker-driver.ts` |
| runResidentLoop 定义 | `:6017` | `grep -n "export async function runResidentLoop" plugin/scripts/worker-driver.ts` |
| runResidentLoop 区间 | `:6017–:6930`（914 行） | archguard `sourceLocation` 与 grep 的起始行一致 |
| goal-driver.ts / full-suite-runner.ts | 5059 / 5867 行 | `wc -l`（Finding 原文 ">3065" 是下界；3065 实为 full-suite-runner.ts 内 `run()` 的**起始行**，不是行数） |
| 分割模板 | serve-handlers.ts 349 行 + 22 个 `serve-*.ts` | `ls packages/quay/src/serve-*.ts \| wc -l` |

**§E2 出度读数（`archguard_summary` topByOutDegree，scope `b4f87b21`，generatedAt `2026-10-20T22:29:53.899Z`，快照 commit `6473463e3`）**

| 排名 | 实体 | outDegree |
|---|---|---|
| 1 | run | 39 |
| 2 | handleAllRoutes | 35 |
| 3 | **runResidentLoop** | **30** |
| 4 | runArchitectureReview | 28 |
| 5 | runOpenSemanticDiscovery | 24 |

**独立复核（不经 MCP，直接读持久化产物；DoD 要求）**

```
$ node -e 'const j=require("./.archguard/query/b4f87b21/arch-index.json");const c=new Map();for(const [id,ts] of Object.entries(j.dependencies))c.set(id,new Set(ts).size);const n=j.idToName;[...c].sort((a,b)=>b[1]-a[1]).slice(0,5).forEach(([id,k])=>console.log(k,n[id]||id))'
39 run
35 handleAllRoutes
30 runResidentLoop
28 runArchitectureReview
24 runOpenSemanticDiscovery
```

⚠️ **计数口径（两把尺子，不是矛盾）**：`archguard_summary` / `arch-index.dependencies` 按**去重后的依赖边**计数；同 scope 的原始关系图 `.archguard/query/b4f87b21/arch.json`（dependency+composition+inheritance 全关系）按 source 计数得 `44 / 37 / 32 / 31 / 30`。**前 5 名排序完全相同** ⇒ 「第 3 位」对口径不敏感；但引用**绝对数**时必须带口径。

**§E3 前 3 条按位置核对（硬规则 2：非零计数先打印命中的实际内容）**

1. `runResidentLoop` out=30 ↔
   `plugin/scripts/worker-driver.ts:6017: export async function runResidentLoop(opts: ResidentOptions): Promise<number> {`
   （`grep -n` 同行号；archguard `sourceLocation` = 6017–6930）
2. `run` out=39 ↔
   `plugin/scripts/full-suite-runner.ts:3065: export async function run(argv: string[]): Promise<number> {`
   （所在文件 5867 行；archguard `sourceLocation` = 3065–5580）
3. `handleAllRoutes` out=35 ↔
   `packages/quay/src/serve-handlers.ts:54: export async function handleAllRoutes(`
   （所在文件 349 行；archguard `sourceLocation` = 54–349）

⚠️ **仪器边界（硬规则 5）**：① 全库有 **10 个**同名实体 `run`（carrier-retention / identity-replication-check / …），`archguard_summary` 只给 name+outDegree、**不给 file** ⇒ 单看 summary 无法断定 39 属于哪一个；上面的 file 归属来自 arch-index 的 `idToFile` 与 `sourceLocation` 交叉核对。② 同一读数给 `runResidentLoop` **inDegree=0**，而 `worker-driver.ts:7173` 确实调用它 ⇒ 出度是**相对排序信号**，不是完整调用图。

**§E4 四关注点与行号区间（grep 可核对）**

| # | 关注点 | 行号区间 | 锚点（`行号: 实际内容`） |
|---|---|---|---|
| ① | 状态机 retryState/counts/needsHuman | 6035–6058；6260–6452；6650–6656 | `6040: const retryState: RetryState = { counts: new Map(), needsHuman: new Set() };`；`6285: const onWorkerFinished = (rw: RunningWorker, r: WorkerRunResult): WorkerRunResult => {`；`6656: reconciled = reconcileNeedsHumanWithDisk(retryState, rootDir);` |
| ② | 派发决策 slot-refill/claim/ready-pool | 6060–6071；6628–6634；6734–6827 | `6738: step = "dispatch-loop";`；`6750: const exclusion = computeDispatchExclusion(running, coldInflight, retryState);`；`6751: const pool = await readyPoolCheck(rootDir, readyPoolArgv, exclusion.inFlight, cap);`；`6763: step = "apply-filters";`；`6806: step = "selector";` |
| ③ | 派发执行 spawn/fan-in | 6453–6493；6538–6600；6885–6912 | `6454: const spawnSelected = async (sel: { task: string; reason: string }): Promise<void> => {`；`6469: rw.promise = runOneWorker({`；`6546: const reconcileOrphanDispatches = (): void => {`；`6564: rw.promise = resumeExitedOrphanFanIn({`；`6590: rw.promise = adoptOrphanWorker({` |
| ④ | 落账 outcome ledger | 6125–6228；6850–6878 | `6128: const writeRound = (round: number, …`；`6185: const writeErrorRound = (round: number, …`；`6859: writeRound(round, running.length, stopReason ?? waitReason, …);`；`6915: writeErrorRound(round, step, message, stack, liveness, poolSeen, running.length);` |

**③ 的边界修正（FACT，与 Finding 原措辞有出入）**：fan-in **本体不在** `runResidentLoop` 内——它由 `spawnSelected` → `runOneWorker`（定义 `5591–5949`）触发，`spawnMechanicalFanIn` 调用在 `worker-driver.ts:5861`；机械 fan-in 步链早已抽到 `worker-fan-in.ts`（`runMechanicalFanIn` @ `2290`，抽取记录见 `worker-driver.ts:356–366` 注释）。故 ③ 在本函数内的实际内容是 **spawn + adopt/finalize + wait**；"fan-in" 只剩调用点。

**一次打印全部锚点的复核命令**：
`sed -n '6040p;6285p;6656p;6738p;6750p;6751p;6763p;6806p;6454p;6469p;6546p;6564p;6590p;6128p;6185p;6859p;6915p' plugin/scripts/worker-driver.ts`

### 判断（JUDGMENT）

**J1（JUDGMENT）— 值得拆，但按「可独立验证的关注点」拆，不按行数均分。**

边界候选，价值从高到低：

1. **④ 落账**（6125–6228 + 6850–6878）：`writeRound`/`writeErrorRound` 只读闭包变量、不控制循环 ⇒ 可抽成 `worker-round-ledger.ts` 的写侧，主循环只保留闭包装配。**最小、风险最低、收益确定**：round 记录是生产唯一可见载体，抽出后有独立单测面。
2. **① 状态机**（6035–6058 + 6260–6452 + 6650–6656）：`retryState`/`backoffState`/`counts`/`needsHuman` 已有一半在 `driver-filters.ts`（`advanceRetryCap`/`markNeedsHuman`）；彻底化 = 把「终态 → 计数/退避/needs-human」收成一个状态机对象，循环只喂 `WorkerRunResult`。
3. **② 派发决策 / ③ 派发执行**：这是 `while` 的控制脊——状态是 `running`/`coldInflight`/`stopReason`，与时序强耦合 ⇒ 现在硬抽会产生大量参数穿梭，**不建议作为第一刀**。

**反模式警告**：按行数均分切成 4 个 ~230 行的文件，会同时切断 ①↔② 的共享状态（`retryState` 既被派发过滤读、又被终态记账写）与 ②↔③ 的时序（`cap`/`running`），把可读的单体换成四个需要来回跳的文件。

**J2（JUDGMENT）— 「是否真的值得」取决于一个尚未测量的量：单体的真实代价。**

- 已测到的**代价代理量**（PROXY，不是结论）：`worker-driver.ts` 累计 **251** 次提交（全部落在近 90 天）；**232** 个任务的 `## Touches` 声明了该文件（抽样前 3 条均为真实修改点：`gap-ac142-llm-worker-spawn-chain-fix` / `gap-ac153-core-invariant-single-impl-not-evaluated-vocab` / `gap-ac140-llm-command-configurable`）。Touches 重叠是派发互斥的输入 ⇒ 单文件是**串行化热点**。
- **未测到**（因此 J1 保持条件式）：因文件过大直接造成的缺陷率、评审成本、编辑冲突次数。按硬规则 4 推论四，「我认为复杂度导致了 X」在没有对照前只是**假说**，不作为结论。

**反事实对照（AC2 要求）**：**若 7266 行单体并不导致真实代价，则结论不同**——若测量显示 `worker-driver.ts` 的缺陷密度/回退率与同层小文件无差异，且无一次事故可归因于「改 A 关注点撞坏 B 关注点」，则正确结论是**不拆**（拆分只增加跨文件跳转成本、不产生收益），本条发现降级为「记录在案的读数」而非「切片 goal 的输入」。反之，只要出现一次可归因的跨关注点误伤，或 Touches 互斥导致的可测等待，J1 的 ④→① 顺序即为切片顺序。

**DoD 边界（FACT）**：本条不实现拆分、不动 `plugin/scripts/worker-driver.ts`、不开 goal；是否立切片 goal 另行决定。

## Acceptance Criteria

- [x] 把 runResidentLoop 的函数出度读数（archguard summary topByOutDegree）与 worker-driver.ts 的四关注点清单（状态机/派发决策/派发执行/落账，各附该关注点代码的行号区间）落到本任务 body，并贴出前 3 条按位置核对的证据。
- [x] 判断标注 FACT / JUDGMENT，且「是否值得拆分、按什么边界」明确是 JUDGMENT，附「若 7266 行单体并不导致真实代价，则结论不同」的反事实对照。

## Definition of Done

- 两条 AC 全绿；出度读数可独立复核（重跑 archguard summary 或读 .archguard/output 产物），四关注点的行号区间可 grep 核对。
- 不实现拆分、不开 goal；是否立切片 goal 另行决定。

## Touches

- tasks/gap-worker-driver-resident-loop-decomposition-discovery.md
- plugin/scripts/worker-driver.ts
