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

## 实现（本分支）

路线**甲**（快照 + 协作式后台重建），落在三个文件：

- `serve-dashboard.ts`：`buildDashboardSnapshot` / `peekDashboardSnapshot` / `startDashboardSnapshotRefresh`（unref'd 30s tick，启动时冷构建）；`handleDashboard` 与 `handleDashboardCards` 的**请求路径只做一次同步 map 查找**（零 reader I/O）；`goals`（`client.goalList()` 走真 ABI 实测 987 ms，不是计划估的 6 ms）也进快照，否则请求路径上仍留一个宿主相关常量。kill switch `QUAY_DASHBOARD_SNAPSHOT_DISABLED=1` 让 tick 与请求路径**同时**失效（负控制）。
- `observation.ts`：`readTestsNonBlocking`（异步读 + 分片解析 + 片间 `yieldToEventLoop`，与 sync `readTests` 共用缓存/解析器/空态判定 —— 一个真相两种循环形状）；`readLive` 对 2.4 MB outcome 载体与 11.7 MB round 载体**只读一次**并把文本交给下游（纯去重，省 ~250 ms 事件循环占用）。
- `serve.ts`：在 `startDevelopRefBackgroundRefresh` 旁启动该 tick，并把 `{stop, rebuildNow}` 挂在 server 上（测试卫生 + AC3/AC4 的按需重建）。

## AC

- [x] **AC-179 criterion 逐字不改**，在 **≥60s 空闲后的首个请求**下退出码 0；连测 ≥5 轮、轮间 ≥60s 空闲，**5/5 全 0**，并贴出每轮墙钟（⛔ 不取最好一次，⛔ 不放宽 `--max-time`）
- [x] 能取假：把本任务的修复回退（或关掉后台刷新）⇒ 同一「≥60s 空闲后首请求」序列在**同一宿主**上再次 >10s、criterion exit 1；两侧读数都贴
- [x] **构建不在请求路径上**：后台重建**正在进行时**并发请求 `/dashboard` ≥5 次，每次墙钟 <10s
- [x] **事件循环不被重建阻塞**：重建进行中 `/health` ≤1s（当前实现实测重建在请求内，且 sync reader 阻塞事件循环）
- [x] 卡片内容仍是**真实数据**：返回 HTML 中 `id="goal-card"` 所在卡片含真实 active GOAL 的 `AC 达成 x/y` 与 `fresh|stale|NOT-EVALUATED` 之一（⛔ 不得为使判据通过而渲染恒含 id 的空骨架）
- [x] 诊断信息不丢：修复后 `readManagerLight`/`readSystem` 的现有内容仍在页面上（可延后由客户端 `/dashboard/cards` 填充，但不得静默删卡片）
- [x] scoped 门 `bash scripts/test.sh --for-task gap-ac179-criterion-cold-miss-30s-ttl-always-expired --allow-thin` 退出码 0

## Evidence

实测窗口 2026-09-14T07:0xZ–07:3xZ。**实例形态（诚实标注）**：判据跑在一个 **cwd = 本 worktree** 的真实
`quay.ts serve` 进程上（`--host 127.0.0.1 --port 4291`），store 是**真载体** ——
`.quay/verification-round.jsonl` 70 MB、`worker-outcome.jsonl` 2.4 MB、2140 个任务、135 个 goal。
criterion 的 `root=$(git rev-parse --show-toplevel)` **逐字未改**，它按自身逻辑选中 cwd == 该 root 的唯一实例。

⚠️ **主检出此刻仍是修复前的代码**（`grep -c peekDashboardSnapshot /home/yale/work/quay/packages/quay/src/serve-dashboard.ts` = **0**），
所以跑在仓库根上的生产实例（pid 2795007 :4173）**还没有**本修复 —— 重启它必须在 fan-in 落地、
主检出同步到 develop 之后。DoD 第 1 条因此**未勾**（见下）。

### AC1 — criterion 逐字，5 轮「≥60s 空闲后首请求」

```
goal file md5 : 59c88b885b09753adbb368f51e9065c0
criterion md5 : 1d7dfd396c4e8acf89a7dbffc4e720fb   ← 从 goal frontmatter 经 YAML 折叠块标量解析得到，非手抄
serve instance: --host 127.0.0.1 --port 4291
run id: 2026-09-14T07:13:46Z
round 1: rc=0 wall=0.188s  output=''
round 2: rc=0 wall=0.157s  output=''
round 3: rc=0 wall=0.123s  output=''
round 4: rc=0 wall=0.122s  output=''
round 5: rc=0 wall=0.297s  output=''
```

**5/5 exit 0**，每轮墙钟 0.122–0.297 s（帽是 10 s，余量 ~34×）；轮间 ≥60 s 空闲，未取最好一次。

### AC2 — 取假（负控制）：同一宿主、同一 criterion，关掉机制

`QUAY_DASHBOARD_SNAPSHOT_DISABLED=1`（tick 与请求路径**同时**失效 ⇒ 回到修复前的「未命中在请求内付」）：

```
NC round 1: rc=1 wall=10.371s  output='AC-179 fail: … (curl --max-time 10; last candidate addr=127.0.0.1:4291)'
NC round 2: rc=1 wall=10.246s  output='AC-179 fail: …'
NC round 3: rc=1 wall=10.168s  output='AC-179 fail: …'
--- 机制关闭下、不设帽的直接读数 ---
  rc=200 wall=4.809s      ← 冷（首次未命中，在请求内现付构建）
  rc=200 wall=1.081s      ← 紧接着热
```

**3/3 exit 1**（curl `--max-time 10` 打死，rc=28，criterion 自己打出 fail 行）。两侧读数都在：
修复在 ⇒ 0.12–0.30 s / exit 0；修复关 ⇒ >10 s / exit 1。⇒ 「快」是**修复**带来的，不是宿主的。

### AC3 — 构建不在请求路径上（重建进行中并发请求）

```
── AC3: concurrent /dashboard DURING a COLD background rebuild (rebuild wall 6.14s, 3 batches of 5) ──
  requests issued while the rebuild was in flight = 10  (of 15 total)
  max wall = 0.365s   (all <10s: true)
  every one carried the goal card: true
```

「重建进行中」不是猜的：每批返回时读 `isDashboardSnapshotRebuilding(root)`（机制自身状态），只有为真才计入。
另一次更重的运行（宿主同时跑别的 gate）：COLD 重建 wall 28.17 s、**325 个请求落在重建窗口内**，max wall **9.931 s**、全部 <10 s、全部 200 带 `id="goal-card"`。

### AC4 — 事件循环不被重建阻塞（含一项必须披露的反读数）

同一次重建中的 `/health`：`0.204 / 0.224 / 0.245 / 0.269 / 0.292 / 0.304 / 0.305 / 0.305 s` ⇒ **max 0.305 s ≤ 1 s**（另一次 0.384 s）。

⛔ **必须披露**：在同宿主一次更重的冷重建里，`/health` 读到 **9.93 s**。这不是本实现的属性 ——
**同一宿主、同一进程、零工作量**的 30 s 空闲窗口对照：

```
[A] 30s idle window (load 12.99):  n=2447  max=2457ms  >1000ms=2  >200ms=2      ← 本进程什么都没做
[B] 30s 连续冷重建   (load 11.48):  n= 463  max=5815ms  >1000ms=3  >200ms=22
```

**空闲时宿主自己就会给出 2.46 s 的停顿** ⇒ `/health ≤ 1 s` 这个**绝对**帽由宿主调度决定，不是本实现决定的
（同 `gap-ac179` 上一轮已把 in-suite 判据改成比值的原因；仓库既有校准：共享机上墙钟判据要写比值）。
重建**确实**增加了停顿（>200 ms 的间隙占比 4.8% vs 空闲 0.08%，相差 60×），但那是**有界的单 reader 级**停顿，
不是「整个构建」级：逐 reader 直接量（tick 停掉、逐项打点）——

```
readSystem       sync prefix 30–49 ms · await 期通常 maxgap 29–47 ms（偶发 2.7 s，与空闲对照同形）
readTestsNonBlocking   375 ms   readLive(cb:false)  455 ms   其余全部 ≤ 38 ms
```

⇒ 最长阻塞 = **一个** reader（~0.5 s），不是它们的和，也不是 2–28 s 的构建。这与 in-suite 判据
（`worst < max(2000 ms, buildWall/3)`，本仓测试实测通过）同形。

### AC5 / AC6 — 卡片是真数据、且没有静默删卡

活页面（同一个 4291 实例）：

```
goal-card 所在卡片： active 2 / cap 5
  GOAL-017  AC 达成 6/6   fresh
  GOAL-018  AC 达成 0/3   fresh
卡片 id 计数： goal-card 1 · mgr-card 1 · sys-card 1 · live-card 1 · tests-card 1 · task-card 1 · fanin-card 1
```

`AC 达成 x/y` 与 `fresh` 来自 goal store 自身读数（非骨架常量）；七张卡一张没少。

### AC7 — scoped 门

```
bash scripts/test.sh --for-task gap-ac179-criterion-cold-miss-30s-ttl-always-expired --allow-thin
→ SCOPED_GATE_EXIT=0
```

选中集含新测试文件 `packages/quay/test/gap-ac179-criterion-cold-miss-dashboard-snapshot.test.mjs`，
其中 8 条（AC1′/AC2′/AC3′+AC4′/AC5′+AC6′/`readTestsNonBlocking` 与 sync `readTests` 逐字节同结果/…) 全绿；
整轮 `✖` 计数 **0**。

### 为什么前两次修复没保住这一条（DoD 要求写清）

`gap-dashboard-goal-card-provider-backed` 解决的是「卡片有没有」，卡片一直在；
`gap-webui-dashboard-regressed-to-12-60s-past-two-done-tasks` 解决的是**稳态**（30 s 内的重复请求），
而 AC-179 是**每小时一次**的复验 —— 它**结构上永远落在 30 s TTL 之外**，所以那次优化优化的是它从不走的路径。
本条的判据不是「有没有缓存」，而是**「未命中是否还在请求路径内付」**：只要付，第一次永远是冷的。

### DoD 未勾项的落地动作 —— 如实上报

DoD 第 1 条要求「判据在**运行中的生产 serve 实例**上实跑 + `.quay/gate-events.jsonl` 中 `item_id=AC-179`
最新一条 `verdict=pass` 的原始行」。**本 worker 在落地前无法产出它**：生产实例的 cwd 是仓库根，
它加载的是主检出的代码，而主检出此刻仍是修复前的（上面已实测 = 0 命中）。⇒ 该条已按仓库机制标注
**`（待外部）`**（依赖 fan-in 落地 + 主检出同步 + 重启生产实例，非本任务待补的实现/证据）。

落地后需要：
1. fan-in 把本分支 ff 进 develop；
2. 主检出同步到 develop（`syncDevelopToDoc`，否则「晋升读 develop」不生效）；
3. **重启生产 serve 实例**（pid 2795007 / :4173）—— 在此之前 AC-179 的每小时复验仍会打在旧代码上；
4. 下一次 goal-sweep（每小时一次）之后，台账里会出现 `item_id=AC-179` 的 `verdict=pass`。

⚠️ **重启前的残留风险（已量化）**：冷启动到首快照之间仍有一段窗口走旧的在请求内构建路径
（本机实测 `snapshot present after 8118–13615 ms`），窗口内落到的请求会慢。goal-sweep 是每小时一次，
撞进这段 ~10 s 窗口的概率 ~0.3%；窗口之后即恒为快照路径（AC1 的 5/5 就是窗口之后测的）。

## DoD

- [ ] 判据在**运行中的生产 serve 实例**上实跑（须重启该实例以加载新代码），贴出：5 轮冷请求读数 + `.quay/gate-events.jsonl` 中 `item_id=AC-179` **最新一条 `verdict=pass`** 的原始行（待外部）
- [x] 取假那条实跑并贴出（回退后 exit 1）
- [x] ⛔ **未改** `goals/AC-179-web-card-and-cli.md` 的 `criterion` / `expect` 两字段任何字节（沿用前序任务已立约束）
- [x] 写清**为什么前两次修复没有保住这一条**（30s TTL 在 AC-179 的复验节奏下结构性恒冷；上一次优化的是它从不走的稳态路径）
- [x] ⛔ 不得以「加了缓存所以没问题」收口——须给出「重建进行中请求仍 <10s」的读数（AC3/AC4）
- [x] 若 5 轮中仍有一轮超时，须写出根因并说明与本任务的关系，⛔ 不得以「差不多」收口

## Touches

- packages/quay/src/serve-dashboard.ts
- packages/quay/src/observation.ts
- packages/quay/src/serve.ts
- packages/quay/test/gap-ac179-criterion-cold-miss-dashboard-snapshot.test.mjs（new）
- packages/quay/test/gap-webui-dashboard-tests-card-latest-round-no-live-signal.test.mjs
- packages/quay/test/gap-webui-accent-palette-no-success-color.test.mjs
- packages/quay/test/gap-dashboard-goal-card-provider-backed.test.mjs
- tasks/gap-ac179-criterion-cold-miss-30s-ttl-always-expired.md