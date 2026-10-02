# TTL 缓存重复：RUP 分析与设计

范围：只做分析与设计，未改任何源码。源码引用均来自主检出 `/data/home/yale/work/quay/packages/quay/src/`。
图文件：`ttl-cache-current.puml`、`ttl-cache-proposed.puml`、`ttl-cache-seq.puml`。
**PlantUML 未渲染校验**（本机无 java/plantuml），仅逐行人工核对 `@startuml/@enduml`、花括号与基础语法。

标注约定：**[实测]** = 读了代码或跑了 grep 且已核对命中内容；**[假说]** = 未被检验，每条写出「若为假会看到什么」。

## 1. 现状

### 1.1 十二处缓存对比 [实测]

行号以本次读到的为准（与任务给出的行号一致或相差几行）。所有缓存都是 `Map<string,{at:number; <value>}>`，命中判据都是「现在 - at < TTL」（严格小于）。

| # | 缓存（文件:行） | TTL(ms)/常量 | 键 | 同步/异步 | 失败/空值是否入缓存 | in-flight 去重 | 上限/清理 | 时钟 | 计数器/测试钩子 |
|---|---|---|---|---|---|---|---|---|---|
| 1 | taskStatusRefCache obs:1565 | 2000 `TASK_STATUS_REF_CACHE_TTL_MS` | root\nref | 同步（execFileSync） | 全入（git 失败得空 map 也缓存 2s） | 无 | 无上限；仅测试用 clear（与 2、3 同清） | 参数 `nowMs`、`ttlMs`、`force` | `taskStatusRefBuildCount`(1606) = 未命中即 ++ |
| 2 | taskTitleRefCache obs:1566 | 同上 | 同上 | 同步 | 全入 | 无 | 同上 | 同上 | 无 |
| 3 | taskCommitTimesRefCache obs:1570 | 同上 | 同上 | 同步 | 全入；值多带 `head` | 无 | 同上 | 同上，另有 `cacheOnly` | `developRefFullWalkCount`/`BoundedWalkCount`(1588-1589) |
| 4 | landingCache obs:2446 | 30000 `LANDING_CACHE_TTL_MS` | root | 异步（子进程） | 只缓存 ok 与 timedOut；其它 error 不缓存（2523、2543） | 无 | 无上限；`clearLandingCache` | `Date.now()` | `landingColdRunCount`(2455) |
| 5 | gitHistoryCache obs:2828 | 30000 | root\nlimit\nbefore\nskip | 同步 | 全入；注入 `exec` 时绕过缓存（2853） | 无 | 无上限；`clearGitHistoryCache` | `Date.now()`（另有 `nowMs` 参数但仅用于 7 天窗口，与缓存无关） | 无 |
| 6 | poolMetricsCache obs:3320 | 30000 `POOL_METRICS_CACHE_TTL_MS` | root | async 函数内同步读文件 | 仅成功入缓存（empty 提前 return） | 无 | `clearPoolMetricsCache` | `Date.now()` | 无 |
| 7 | driverStatusCache obs:3506 | 借用 `POOL_METRICS_CACHE_TTL_MS`（3531） | root | 异步 | 全入（kernel 缺失得 `[]` 也缓存 30s） | 无（但内部 `loadDriverRuntime` 自带一个无 TTL 的 promise 记忆） | `clearDriverStatusCache` | `Date.now()` | 无 |
| 8 | verificationRoundCache obs:3881 | 30000 `VERIFICATION_ROUND_CACHE_TTL_MS` | root | 同步 `readTests` 与异步 `readTestsNonBlocking` **共用一个缓存**（3892、4023） | 全入 | 无 | `clearVerificationRoundCache` | `Date.now()` | 无；注释承诺命中返回「同一对象」 |
| 9 | taskSummaryCache sd:1543 | 30000 `TASK_SUMMARY_CACHE_TTL_MS` | root | 异步 | 成功入；抛错自然不入 | 无 | `clearTaskSummaryCache` | `Date.now()` | 无 |
| 10 | dashboardLiveCache sd:1581 | 30000 `DASHBOARD_LIVE_CACHE_TTL_MS` | root | 同步 | 全入 | 无 | `clearDashboardLiveCache` | `Date.now()` | 无 |
| 11 | dashboardSysCache sd:1608 | 借用 `DASHBOARD_LIVE_CACHE_TTL_MS`（1619） | root | 异步 | 返回什么入什么（注释写「只缓存成功」，见假说 H3） | 无 | `clearDashboardProbeCache`（与 12 同清） | `Date.now()` | 无 |
| 12 | dashboardMgrLightCache sd:1609 | 同 11 | root | 异步 | 同 11 | 无 | 同 11 | `Date.now()` | 无 |

（obs = observation.ts，sd = serve-dashboard.ts。）

汇总 [实测]：TTL 值只有两种（2000 ×3、30000 ×9）；9 个缓存的键就是 root；**12 个里没有任何一个做 in-flight 去重**；**没有任何缓存有容量上限或逐出**（obs 内 grep `.delete(`、`MAX_…CACHE`、`evict` 仅 1 条命中，即 1310 行无关的 `held.delete`）；生产代码从不调用任何 `clearXxxCache`（src 内这些名字只出现在定义文件，消费者全是测试）。

交叉读（不是纯 get/set）[实测]：`readTaskAtRefMeta`(obs:1487) 与 `readTaskCommitTimeAtRef`(obs:1822) 直接读 1/2/3 的 Map 而不看 TTL（命中就用，未命中才起子进程）；`readTaskCommitTimesAtRef` 的 `cacheOnly` 分支返回已过期条目；增量重建用上一个条目的 `head`。这三处要求缓存提供 **peek（忽略 TTL）**，仅 get/getOrLoad 不够。

### 1.2 形状不同但同类的缓存：真实重复数是否大于 12 [实测，受 grep 能力限制]

搜索手段与前 3 条命中：
- `Date.now() - X.at < …TTL` 模式：src 与 plugin/scripts 内命中 10 处，全部落在 observation.ts 与 serve-dashboard.ts（如 `serve-dashboard.ts:1565`、`observation.ts:2480`、`observation.ts:2857`），即上表的 9 个调用点族。plugin/scripts 里按位置判定为「超时/静默判断」而非缓存的：`driver-runtime.ts:3216`、`suite-driver.ts:231`、`inner-blocked-signal.ts:1086`，均不是读缓存。
- `Map<string,{at…}|Promise>` 模式：除 12 个外命中 `serve-board.ts:337`、`serve-dashboard.ts:1698/1702`（in-flight Promise 表）、`mcp-server.ts:315`（provider 连接 Promise 记忆）。

结论：**同形状（带时间戳的 TTL 值缓存）的真实数量 = 12，未发现第 13 个**。另有三类「邻近但不同机理」，不计入 12 但设计时要划界：
1. 快照 + 后台重建：`dashboardSnapshots/Rebuilds/FollowUps`（sd:1697-1702）、`boardSnapshots/Rebuilds`（serve-board.ts:336-337）。无 TTL，靠定时器刷新，自带 in-flight 表和 `StepHook` 测试钩子。**这是仓库里唯一已有 in-flight 去重的地方**，也是 getOrLoadAsync 语义的先例。
2. 无时间的记忆化：plugin/scripts 里 `defect-latency-pair.ts:684-686`、`task-status-drift-check.ts:213/378/835`、`registry-bare-filename-scan.ts:534` 等（进程内永不过期）；`driver-runtime.ts` 的 `driverRuntimePromise`。
3. 以 mtime+size 校验的缓存：`packages/quay-native/src/store.ts:786/802/1261`（失效判据是文件指纹，不是时间）；`goal-driver.ts:1171/1653` 的 sufficiency/objective 缓存（落盘、`ts` 仅记录写入时刻，不做过期）。

**[假说 H1] 以上搜索可能漏掉不用 `Date.now()` 而用 `performance.now()` 或自写 `isFresh()` 的缓存。** 若为假：对 `isFresh|expired|staleAt|expiresAt` 在 packages/*/src 与 plugin/scripts 做 grep 应零命中；本次未做完整该项扫描，故降为假说。

## 2. 分析类（RUP stereotype）

- **缓存 = 《control》**（策略对象）：它不拥有数据，职责是在「边界对象（serve-*.ts 的 HTTP 处理器、dashboard 渲染）」与「昂贵的实体来源（git 子进程、文件、MCP、插件脚本）」之间决定「这次读是否复用上次结果」。它不发起业务动作，只仲裁新鲜度。
- **缓存条目 = 《entity》**（值对象：`{value, at}`，另有 #3 的 `head`）。
- **读取函数（readBoardLanding、readPoolMetrics…）= 《boundary》**，对外保持原签名；缓存是它们的内部协作者，不应泄漏到调用方。
- **职责**：①按键存取；②判新鲜（TTL）；③可选：负缓存策略、并发合并、容量治理；④测试可重置。
- **不变量**（现状全部成立，迁移必须保持）[实测]：
  1. 命中判据严格 `age < ttl`；`age == ttl` 视为未命中。
  2. 命中返回**同一对象引用**（不克隆；`readTests` 注释与 `readLive` 命中语义依赖它）。
  3. 键按 workspace root 分桶，两个 workspace 绝不串读。
  4. 失败的读不得被当成合格读固化（各缓存的「哪些入缓存」不同，见 1.1 第 5 列）。这条与硬规则 3b 同源：缓存不得把「没读成」缓存成「读到了空」。
  5. 缓存只服务展示面；driver 自己的读取不经缓存（obs:3300 注释的 AC3）。

## 3. 设计元素

### 3.1 形态权衡：class / 闭包工厂 / 纯函数

| 形态 | 优点 | 缺点 | 判断 |
|---|---|---|---|
| 纯函数 `fresh(entry, ttl, now)` + 调用方自己持有 Map | 零新概念 | 12 处的重复恰恰是 Map + set + clear 的样板，纯函数只省了一行比较，**不解决问题** | 否 |
| `class TtlCache<K,V>` | 熟悉；可 `extends` | 本仓库此类代码全是模块级 `const` + 函数导出（无继承需求）；类带来 `this` 绑定和 `new`，测试里要传方法引用时易出错；没有任何使用点需要多态 | 非必要 |
| **闭包工厂 `createTtlCache<V>(opts)` 返回对象字面量**（接口类型 `TtlCache<V>`） | 状态（Map、in-flight 表、世代号）被闭包私有；返回值是接口，测试可传 fake；与现有 `const xCache = …; export function clearXCache()` 的风格一致；无继承诉求时 TS 惯用 | 不能 `instanceof`（本仓库无此需求） | **推荐** |

理由：本问题是「一份状态 + 几个操作」的小而稳定的值，没有继承、没有多态、没有生命周期钩子，闭包工厂是 TS 里最小的足够形态。选类的唯一理由会是风格偏好，不是需求。

### 3.2 API（`packages/quay/src/ttl-cache.ts`，新叶子模块，无 import，见 proposed 图）

```ts
interface TtlCacheOptions<V> {
  ttlMs: number;                       // 默认 TTL
  now?: () => number;                  // 可注入时钟，默认 Date.now
  maxEntries?: number;                 // 默认无上限 = 与现状等价
  cacheIf?: (v: V) => boolean;         // 负缓存策略，默认全入
}
interface TtlCache<V> {
  get(key: string, o?: { ttlMs?: number; nowMs?: number }): V | undefined; // 只返回新鲜的
  peek(key: string): { value: V; at: number } | undefined;                  // 忽略 TTL
  set(key: string, value: V, o?: { nowMs?: number }): V;
  getOrLoad(key: string, loader: () => V): V;                               // 同步，无法去重
  getOrLoadAsync(key: string, loader: () => Promise<V>): Promise<V>;        // 并发合并
  delete(key: string): boolean;
  clear(): void;
  stats(): { hits: number; misses: number; loads: number; joins: number };
}
```

关键语义（序列图见 `ttl-cache-seq.puml`）：
- 同步与异步分成两个方法而不是一个重载：同步 loader 不可能有并发，硬塞 in-flight 只会制造假象。
- 异步合并：未命中时登记 `inflight[key]`，后来者复用同一 Promise；loader 抛错则清掉 in-flight、**不缓存**、向所有等待者重抛。
- **世代号**：`clear()` 令 generation+1；loader 完成时若世代已变则不写入。现状是「清了之后慢读回来仍写入」，测试 hygiene 上更安全，但这是一处**行为差异**，见 3.3。
- `maxEntries`：超出时淘汰最旧插入项（FIFO 足够，不上 LRU）。默认不设，等价现状。

### 3.3 十二处差异：真需求 vs 偶然

| 差异 | 判断 | 在新抽象里的表达 |
|---|---|---|
| TTL 2000 vs 30000 | 真需求（2s 防同一渲染突发内重复，30s 对齐前端刷新周期） | `ttlMs` 选项 |
| 键构造（root / root+ref / root+limit+before+skip） | 真需求，但**键拼接是调用方职责**，缓存只收 string | 调用方自拼；保留各自的分隔符以保证等价 |
| 只缓存成功（#4 部分、#6）vs 全缓存 | 真需求（硬规则 3b：失败不固化）；但各处边界不一致，见 H3 | `cacheIf` |
| 命中时 peek 忽略 TTL（#1-3 的交叉读与 `cacheOnly`） | 真需求 | `peek` |
| #3 额外存 `head`、增量重建读旧条目 | 真需求 | V 本身就是 `{head,map}`；用 `peek`+`set` 而非 `getOrLoad` |
| 调用方传 `nowMs`/`ttlMs`/`force`（仅 #1-3） | 半偶然：公开签名里有，但测试中 `ttlMs` 零使用（对 packages/quay/test/*.mjs grep `ttlMs` 无命中）| `get/set` 的 `o.nowMs`、`o.ttlMs` 保留以免改公开签名；`force` 留在调用方（跳过 get） |
| 时钟：`Date.now()` 写死 vs 可注入 | 偶然（只是没抽象；#1-3 的 `nowMs` 是局部补丁） | 工厂 `now`；测试用假时钟代替 `nowMs` 参数 |
| 子类缓存各自的 `clearXxx` 导出 | 真需求（测试用）但样板重复 | 保留导出名，函数体改为 `cache.clear()`；#1-3 一起清、#11-12 一起清保持原样 |
| 无 in-flight 去重 | 偶然（见 H2） | `getOrLoadAsync`，**分阶段启用** |
| 借用别的 TTL 常量（#7 借 POOL，#11-12 借 LIVE） | 偶然耦合：改 POOL 常量会悄悄改 driver 状态的新鲜度 | 迁移时给各自一个同值常量；这会是**代码层的显式化，不改数值** |
| 无上限 | 偶然（键空间小时无害）；#5 键含 limit/before/skip，见 H4 | `maxEntries` 默认关；先观测再决定 |
| 测试计数器（`xxxCount`） | 真需求（测试断言「命中时零子进程」），**但计的是领域动作，不是缓存动作** | 见 3.4 |
| 注入 `exec` 时绕过缓存（#5） | 真需求（硬规则 3b：注入数据不得与生产读数同形） | 调用方在调缓存**之前**分流，缓存不知情 |
| #8 同步/异步共用一缓存 | 真需求（同一真相） | 同一个 `TtlCache` 实例，同步侧用 get/set，异步侧用 getOrLoadAsync 或 get/set |

### 3.4 计数器如何保留 [实测 + 设计]

现有 5 个 `let xxxCount`：`singleTaskGitSpawnCount`、`developRefFullWalkCount`、`developRefBoundedWalkCount`、`taskStatusRefBuildCount`、`landingColdRunCount`。
- `singleTaskGitSpawnCount`、两个 walk 计数：计的是「子进程种类」，缓存不知道，**原地保留**。
- `taskStatusRefBuildCount`：在未命中处 `++`，等于 loader 次数，可改读 `stats().loads`，但**第一步不动**（保持导出的 `get/reset` 函数不变），等缓存迁完再合并。`resetTaskStatusRefBuildCount` 在测试中零使用 [实测：test/*.mjs grep 命中 0]。
- `landingColdRunCount` 在子进程 spawn 之前才 `++`（obs 约 2511 行），早于它的「脚本不存在」提前返回不计数，**不一定等于 loads**，不得无证据地替换。
- 原则（硬规则 4）：计数器要计「被保护的昂贵动作」，不要计缓存自己的 miss 事件，否则测试变成回声。`stats()` 只作为补充。

## 4. 迁移方案

### 4.1 受影响测试 [实测]（`/data/home/yale/work/quay/packages/quay/test/`，以符号名 grep 得到）

- `observation.test.mjs`：clearTaskStatusRefCache、`getDevelopRefFullWalkCount/BoundedWalkCount/resetDevelopRefWalkCounts`
- `serve-task.test.mjs`：单任务 spawn 计数的 get/reset
- `gap-ac292-board-request-path-cold-build.test.mjs`：clearTaskStatusRefCache、clearLandingCache、`getLandingColdRunCount`、`getTaskStatusRefBuildCount`
- `serve-board.test.mjs`：clearTaskStatusRefCache、clearLandingCache、`getLandingColdRunCount`
- `gap-webui-board-transient-columns-drowned-by-history.test.mjs`、`serve-board-body-i18n.test.mjs`：clearLandingCache
- `gap-dashboard-parallelize.test.mjs`、`gap-git-graph-cross-column-edges-drawn-as-fixed-stubs-not-anchored.test.mjs`、`gap-git-graph-pagination-appends-page-relative-col-and-torow.test.mjs`：clearGitHistoryCache（parallelize 另清 pool/verification/summary）
- `gap-ac136-web-truth-source.test.mjs`：clearPoolMetricsCache、clearTaskSummaryCache
- `gap-dashboard-driver-status-card.test.mjs`：clearDriverStatusCache
- `gap-ac179-criterion-cold-miss-dashboard-snapshot.test.mjs`：clearDashboardLiveCache、clearDashboardProbeCache、clearTaskSummaryCache、clearVerificationRoundCache
- clearVerificationRoundCache 共 9 个文件引用，另含：`gap-webui-accent-palette-no-success-color`、`gap-webui-dashboard-tests-card-latest-round-no-live-signal`、`gap-webui-tests-page-*`（3 个）、`serve-tests-empty-state` 等
- `gap-webui-goal-task-rollup-via-shared-summary-cache.test.mjs`、`gap-dashboard-taskcard-multistatus-minitable.test.mjs`、`gap-webui-list-table-no-overflow-container.test.mjs`：clearTaskSummaryCache 等
- 间接：`/data/home/yale/work/quay/plugin/test/third-party-capability-degradation.test.mjs` 命中符号 grep，但本次未读，不断言它依赖缓存。

要点 [实测]：**所有 `clearXxx`/`getXxxCount` 导出名都被测试直接 import，且 src 内无生产消费者**——所以只要保留导出名与签名，测试几乎不用改。没有测试用 `mock.timers`，也没有测试注入时钟测 TTL（TTL 过期本身目前没有专门断言：[假说 H5]）。

### 4.2 迁移顺序（每步独立提交、可独立回滚）

0. **新增** `ttl-cache.ts` + `ttl-cache.test.mjs`（假时钟测：严格 `<`、同对象引用、`peek` 忽略 TTL、`cacheIf`、`clear` 世代、异步合并/抛错不缓存、`maxEntries`）。零行为改动。
1. **serve-dashboard 四个**（#9-12）：最简单，键=root，无交叉读。保留 `TASK_SUMMARY_CACHE_TTL_MS`、`DASHBOARD_LIVE_CACHE_TTL_MS` 导出。#11/12 暂时仍借 LIVE 常量（保持同值），显式化留到后面。
2. **verificationRoundCache**（#8）→ **poolMetricsCache**（#6，`cacheIf` 无需，因为它只在成功路径 set；保持原写法用 get/set）→ **driverStatusCache**（#7）。#8 的同步与异步读共用实例并断言同一引用。
3. **gitHistoryCache**（#5）：保持「`exec !== realGitExec` 先分流」在缓存调用之前。
4. **landingCache**（#4）：用 get/set（不用 getOrLoadAsync），只在 ok 与 timedOut 才 set，原样保留；与 `landingColdRunCount` 不改。
5. **三个 ref 缓存**（#1-3）最后做：它们有 `peek`、`nowMs`、`head`、`cacheOnly`、交叉读，风险最高。分两小步：先 #1/#2（形状一致），再 #3。
6. **（可选，单独评审）** 启用 `getOrLoadAsync` 去重于 #4/#6/#7/#9/#11/#12；这是**有意的行为变更**，不与上面的纯等价步骤混提交。

### 4.3 等价性保持

- 每步只替换「Map 声明 + 读 + 写 + clear」，不动 loader 与上下游。保留所有导出常量与 `clearXxx` 名。
- `age < ttl` 严格不等式、命中返回同引用、键字符串逐字不变（含 `\n` 分隔符）。
- 时钟：#1-3 的 `nowMs` 参数同时用于判新鲜和写 `at`（`set(...,{nowMs})`），其余用工厂 `now`。
- 每步后运行 4.1 中对应测试；全量走 `scripts/test.sh`（唯一入口）。
- 迁移前先写一个**特征化测试**：对每个缓存，用同一键调两次，断言第二次零 loader 调用、返回同引用；这能对旧新实现都通过（否则不是等价）。**对照**（硬规则 4 推论三/四）：把 `ttl-cache` 的 TTL 比较改成 `<=` 后该测试必须变红，否则它是回声。

### 4.4 风险与回滚

| 风险 | 触发条件 | 缓解/回滚 |
|---|---|---|
| 新模块被 dist 打包漏掉 [假说 H6：src 内新叶子文件会被现有打包流程自动带上] | `dist-verify-node-floor`（CI）才会暴露，`scripts/test.sh` 不覆盖 | 若为假：dist 产物运行时 import 失败。迁移 PR 必须单独跑 build-dist 校验；回滚=还原该步提交 |
| #1-3 交叉读（obs:1487/1822）改走 peek 后误用 `get`，使「命中过期」变「未命中」，增加子进程 | 步骤 5 | 测试 `serve-task.test.mjs` 的 spawn 计数（命中必须零 spawn）会红 |
| `clear()` 世代号改变「清后慢读仍写入」的行为 | 异步缓存 + 测试在 in-flight 时 clear | 仅影响 `getOrLoadAsync` 路径，步骤 6 才启用 |
| 命中判据在时钟回拨时的行为 | `now - at` 为负仍判命中（现状如此） | 保持现状，不改；写进测试注释 |
| 共享检出被并行任务改写 | 三层共用检出 | 按 CLAUDE.md：在任务 worktree 内改，提交后快进，不抢 master |

## 5. 开放问题（需人拍板）

1. **要不要做步骤 6（异步去重）？** 它会改变并发语义（少起子进程，但「同一次读的失败」会同时传给多个等待者）。若不做，抽象就只是样板消除，收益主要是统一和可测。
2. **`maxEntries` 默认值**：保持无上限（等价）还是给 #5 gitHistory 一个上限（见 H4）？需要先看生产键数量读数。
3. **`taskStatusRefBuildCount`/`landingColdRunCount` 是否并入 `stats().loads`**：会让「计领域动作」变成「计缓存事件」，与 3.4 的原则有张力。
4. **范围是否扩展到邻近三类**（快照+重建表、无时间记忆化、mtime 指纹缓存）：本设计明确只管 TTL 值缓存；快照重建表是否也抽成 `createSingleFlight`？
5. **是否把 #7/#11/#12 借用的 TTL 常量拆成各自常量**：数值不变，但改变「改 POOL 常量会同时改三处」的现状，需确认这是否被某处刻意依赖。

## 附：未验证假说清单

- **H2**（无去重造成重复子进程）：代码上异步读在 `await` 前读缓存、`await` 后写缓存，并发两次冷调用会各起一次 loader（读代码结论）。**若为假**：对 `readBoardLanding` 并发调两次，`getLandingColdRunCount()` 增量应为 1 而非 2。本次未运行。上层「快照重建」可能已在请求路径上掩盖它，故生产影响未知。
- **H3**（#11/12 注释写「只缓存成功」，代码对任何返回值都 set）：若 `readSystem`/`readManagerLight` 在失败时返回带 error 状态的对象而不抛错，则失败被缓存 30s。**若为假**：让 readSystem 返回 error 态后立刻再调，应看到再次执行（本次未读这两个函数的失败分支）。
- **H4**（#5 键空间随分页增长且无逐出）：键含 `limit/before/skip`。**若为假**：长时间运行的 serve 进程里该 Map 的 size 应保持个位数；本次未取生产读数。
- **H5**（TTL 过期没有专门测试）：**若为假**：应能在 test/ 下 grep 到推进时间或 `ttlMs: 0` 的断言；本次对 `ttlMs` 的 grep 无命中，但可能有别的手法（如 sleep）未被该 grep 覆盖。
- **H1、H6** 见上文。
