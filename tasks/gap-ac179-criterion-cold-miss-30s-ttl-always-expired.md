---
id: gap-ac179-criterion-cold-miss-30s-ttl-always-expired
title: AC-179 判据恒冷：/dashboard 的 30s TTL 与每小时复验节奏结构性错开 ⇒ 每次复验都是冷未命中（实测冷 19.17s /
  热 1.61s），越过 criterion 的 --max-time 10
status: ready
labels:
  - gap
  - defect
  - delivery-critical
parent: null
children: []
extra:
  schema: execution
goal_ac: AC-179
---
## Finding

**结论**：`goals/AC-179-web-card-and-cli.md` 的 criterion 在**未被改动的生产服务器上**反复翻转；根因不是卡片没了，而是 criterion 的 `--max-time 10` 打在一条**每次复验都必然冷未命中**的路径上。`/dashboard` 的所有 reader 都带 30s TTL 缓存，而 AC-179 的唯一消费者是**每小时一次**的 goal-sweep 轮转，两次请求间隔恒 >30s ⇒ TTL 结构性恒过期 ⇒ 每次复验都在请求路径里现付全额构建成本。

### 一、实测（活服务器，非 fixture；2026-09-14 05:0xZ–05:2xZ，本机 load 70–120）

同一 URL、同一进程、同一时刻，只差缓存状态：

```
空闲 40s 后首个请求（冷）   rc=0  wall=19.17s  bytes=78277  id="goal-card" ×1
紧接的第二个请求（热）       rc=0  wall= 1.61s  bytes=78277  id="goal-card" ×1
```

同一时刻的**帽对照**（决定性——证明失败形态是「端点慢过帽」，不是「卡片没渲染」）：

```
curl -sf --max-time 10  /dashboard   rc=28（超时）  wall=10.12s  bytes=0
curl -sf --max-time 60  /dashboard   rc= 0         wall= 1.43s  bytes=78277  id="goal-card" ×1
```

逐组件读数（直接 import 打点，冷/热）：

| reader | 冷 | 热 |
|---|---|---|
| `readManagerLight` | **6995 ms** | 缓存 |
| `readSystem` | 1870 ms | 缓存 |
| `readTests` | 1770 ms | 0 ms |
| `readLive(computeBlocking:false)` | 1199 ms | 986 ms |
| `readTaskSummary`（2,136 任务、`includeBody:false`） | 438 ms | 1 ms |
| `readGitHistory` | 174 ms | 0 ms |
| `goalList` | 6 ms | — |

冷路径 ≈12s 的**工作**（`Promise.all` 组与 sync 组部分重叠），宿主 load 70–120 下实测输出为 19.17s。

### 二、为什么前两次修复都没保住这一条

- `gap-dashboard-goal-card-provider-backed`（done，`goal_ac: AC-179`）把卡片做出来了——卡片一直在，本条从来不是「卡片缺失」。
- `gap-webui-dashboard-regressed-to-12-60s-past-two-done-tasks`（done）把 12–60 秒压回亚秒，**用的是 30s TTL 缓存**。它优化的是**稳态**（30 秒内的重复请求）；而 AC-179 的复验节奏是**每小时一次**，结构上永远落在 TTL 之外 ⇒ **那次修复优化的是 AC-179 从不走的那条路径。**

⚠️ 这是硬规则 4 推论一/二的形态：criterion 里写死的 `--max-time 10` 是一个**依赖宿主**的常量（同一时刻 `/health` 在 load 200 时也要 2.03s），而端到端耗时取决于外生变量（宿主负载）⇒ **任何固定帽最终都会重新翻转**。前序任务已立过「⛔ 不得调大 `--max-time`」的约束，本任务沿用。

### 三、台账现状（本条的影响面不止一条 AC）

```
2026-09-14T04:49:58Z  AC-179  goal-sweep  fail  criterion wrote no output to stderr/stdout
2026-09-14T04:53:40Z  AC-241  goal-cli    fail  unattributable failing goal AC(s): AC-179: …
2026-09-14T04:53:44Z  AC-242  goal-cli    fail  stale-pass: frozen achieved AC(s) whose criterion is CURRENTLY false: AC-179
```

第二条 fail 是 criterion 末尾 `exit 1` 的静默形态（零输出 ⇒ 归因模板），第三条是 AC-242 读台账尾事件得出的。⇒ **一条 AC 的冷未命中，让 GOAL-009 的两条判据结构上无法通过。** 注：09-13 全天到 09-14T03:14Z 共 660 次复跑全 pass，只有 04:49:58 那一次 fail —— fail 是间歇的，而**间歇的 fail 在台账上与真缺陷同形**。

### 四、方向倾向（供执行者判断，非强制）

必须满足的性质只有一条：**请求路径不承担构建成本**。两条路线，执行者自行取舍并给出理由：

- **甲（快照 + 后台重建）**：进程内按 root 保存「最后一次成功渲染的 HTML」，请求路径**只读快照**立即返回；重建交给后台 tick。现成先例：`packages/quay/src/serve.ts` 的 `startDevelopRefBackgroundRefresh`（同样是 unref'd 后台 tick + 启动时冷构建，其注释逐字写着 "keeps the develop-ref read caches warm OFF the request path"）。⚠️ 若重建本身是**同步**的（`readManagerLight` 7.0s / `readSystem` 1.9s 都是 shell-out，`readTests`/`readLive` 是 `readFileSync`），tick 会把事件循环卡住 ⇒ 必须同时让重建不阻塞（改 async，或把重建放到子进程），否则 AC3/AC4 不成立。
- **乙（首屏只渲染有界部分，贵的交给已有的客户端自刷新）**：`/dashboard/cards` 已经是页面里 `setInterval(refresh, 30s)` 的自刷新端点；`/dashboard` 首屏只同步渲染有界的部分（`goalList` 6ms + `readTaskSummary` 438ms + sync 组 3.1s），mgr/live/sys 卡片由客户端填充。⚠️ 更小，但**必须保证 goal-card 本身是真数据**（AC5），而不是把判据要的那个 id 留在骨架里。

⛔ **不接受**：①调大 criterion 的 `--max-time`（掩盖真缺陷；任何固定帽随宿主负载最终都会重新翻转）；②只把 TTL 调长而不改「未命中在请求路径内付」（TTL 再长第一次总是冷的，且用陈旧度换不到确定性）；③加 `try/catch` 让超时返回 200 空页（把判据变成回声，硬规则 4 推论三）。

<!-- dedup-ref -->
**相关但机制不同的在飞任务**：`gap-abi-task-list-times-out-at-2000-tasks-head-of-line-blocks-mcp`（ready）修的是 MCP ABI 读面 `task_list` 全量载入 body 导致的队头阻塞。本任务**不是**它的兄弟实例：已实测 dashboard 侧的 `readTaskSummary`（`includeBody:false`、2,136 任务）冷读数仅 **438 ms**，不是本条的耗时构成项；本条的本体是 `/dashboard` 各 reader 的 30s TTL 在每小时复验节奏下恒冷。

## AC

- [ ] **AC-179 criterion 逐字不改**，在 **≥60s 空闲后的首个请求**下退出码 0；连测 ≥5 轮、轮间 ≥60s 空闲，**5/5 全 0**，并贴出每轮墙钟（⛔ 不取最好一次，⛔ 不放宽 `--max-time`）
- [ ] 能取假：把本任务的修复回退（或关掉后台刷新）⇒ 同一「≥60s 空闲后首请求」序列在**同一宿主**上再次 >10s、criterion exit 1；两侧读数都贴
- [ ] **构建不在请求路径上**：后台重建**正在进行时**并发请求 `/dashboard` ≥5 次，每次墙钟 <10s
- [ ] **事件循环不被重建阻塞**：重建进行中 `/health` ≤1s（当前实现实测重建在请求内，且 sync reader 阻塞事件循环）
- [ ] 卡片内容仍是**真实数据**：返回 HTML 中 `id="goal-card"` 所在卡片含真实 active GOAL 的 `AC 达成 x/y` 与 `fresh|stale|NOT-EVALUATED` 之一（⛔ 不得为使判据通过而渲染恒含 id 的空骨架）
- [ ] 诊断信息不丢：修复后 `readManagerLight`/`readSystem` 的现有内容仍在页面上（可延后由客户端 `/dashboard/cards` 填充，但不得静默删卡片）
- [ ] scoped 门 `bash scripts/test.sh --for-task gap-ac179-criterion-cold-miss-30s-ttl-always-expired --allow-thin` 退出码 0

## DoD

- [ ] 判据在**运行中的生产 serve 实例**上实跑（须重启该实例以加载新代码），贴出：5 轮冷请求读数 + `.quay/gate-events.jsonl` 中 `item_id=AC-179` **最新一条 `verdict=pass`** 的原始行
- [ ] 取假那条实跑并贴出（回退后 exit 1）
- [ ] ⛔ **未改** `goals/AC-179-web-card-and-cli.md` 的 `criterion` / `expect` 两字段任何字节（沿用前序任务已立约束）
- [ ] 写清**为什么前两次修复没有保住这一条**（30s TTL 在 AC-179 的复验节奏下结构性恒冷；上一次优化的是它从不走的稳态路径）
- [ ] ⛔ 不得以「加了缓存所以没问题」收口——须给出「重建进行中请求仍 <10s」的读数（AC3/AC4）
- [ ] 若 5 轮中仍有一轮超时，须写出根因并说明与本任务的关系，⛔ 不得以「差不多」收口

## Touches

- packages/quay/src/serve-dashboard.ts
- packages/quay/src/observation.ts
- packages/quay/src/serve.ts
- packages/quay/test/gap-ac179-criterion-cold-miss-dashboard-snapshot.test.mjs（new）
- tasks/gap-ac179-criterion-cold-miss-30s-ttl-always-expired.md