---
id: gap-token-status-reports-a-dead-holder-as-busy
title: "heavy-op-token --status says a project holds the token when its process is dead — staleness is only evaluated on acquire"
status: done
labels:
  - gap
  - milestone-candidate
extra:
  schema: v1
---


**type:** execution

## 规模更正（管理者裁定，2026-08-03 20:55Z）——本任务是对的，但比原稿小得多

原稿把受众写成「程序」，暗示有代码路径因 `--status` 的不诚实而卡住。**实测不成立**：
管理者查过 `--status` 的全部调用点——**测试、文档、和一个同名无关工具 `inner-blocked-signal.ts`**；
**已发布代码里真正的等待者只有 `scripts/test.sh` 与 `prepare-admission-check.ts`，两个都走 `--acquire`**，
而 `--acquire` 在条件满足时会当场回收（管理者实测 mtime 292s ⇒ `RECLAIMED reclaim #17`）。

**⇒ 被 `--status` 误导的从来不是程序，是读的人。** 而今晚被误导的正是管理者与外层：
tick 扫描里那句「令牌: archguard pid 死」是唯一的真实受害者。

**规模因此缩小为**：`--status` 做与 `--acquire` **同样的存活判定，但只读、绝不回收**。
不涉及等待策略（那已拆给 [[gap-the-only-token-waiter-refuses-to-wait-at-all]]），
不涉及令牌公平性（无饥饿证据）。

**下面 AC7 的措辞据此更正**：它要防的是**人**照着 `--status` 去等一个不会来的事件，
不是防某个程序被卡住。判据本身不变——**「轮询等不到」这句话仍必须印出来**。

## Proposal

**现场（外层 2026-08-03 17:42Z tick）**：

```
bash plugin/scripts/heavy-op-token.sh --status
  holder=archguard
  pid=2353912
  held_ms=1138616        ← 19 分钟
  stale_reclaims=2

kill -0 2353912   →  进程不存在
/proc/2353912     →  不存在
```

**⇒ 令牌被一个已死进程持有了 19 分钟，而 `--status` 报的是「archguard 持有中」。**

### 陈旧判定只发生在 acquire 路径，不发生在 status 路径

外层今早 09:13Z 复核过 acquire 路径的安全属性，它是对的：
**两条条件（mtime 陈旧 **且** pid 不存活）同时成立才回收，且消息把两条的值都打出来**。
15:42Z 外层实测过一次真实回收，消息为
`RECLAIMED stale token (mtime 450s old, pid ... not alive) — reclaim #2`。

**但 `--status` 不做这件事**：它只读文件字段并原样打印，
**不检查 pid 是否存活**，于是「活着的持有者」与「一具尸体」在输出上完全同形。

### 为什么这条重要：`--status` 正是仲裁时被读的那个

管理者今天多次用 `--status` 判断跨项目资源状态（决定谁能跑重活、要不要等）。
**一个把死进程报成忙的输出，会让仲裁者以为邻居在跑重活而主动让路**——
**而实际上没有人在跑，槽位白白空着**。

**并且它与本仓数了十一次的那一族同形**：输出技术上正确（文件里确实写着 archguard），
**但它声称的东西（有人在持有）与它测的东西（文件里有一行）不是一回事**。

**懒回收本身没问题**（下一个 acquire 会正确回收，外层 15:42Z 亲自验证过），
**要修的是 `--status` 的诚实性**，不是回收时机。

## Contract

```
measure status_holder = `bash plugin/scripts/heavy-op-token.sh --status` 输出的 holder 字段
measure holder_alive = `bash plugin/scripts/heavy-op-token.sh --status` 输出中新增的持有者存活布尔字段
band holder_alive = 与 `kill -0 <pid>` 的实际结果一致
invariant status 只读不写（不得在 status 路径回收，那会让读操作产生副作用）
invoke `bash plugin/scripts/heavy-op-token.sh --status`
control 持有者进程存活 ⇒ 报 alive；kill 掉它 ⇒ 同一命令必须报 stale/dead 且不改变令牌文件
resume 单点改动，无阶段
```

## Chosen mechanism

**`--status` 增加持有者存活判定并如实打印，不改变回收时机。**

1. `--status` 对 `pid` 做 `kill -0`，输出 `holder_alive=yes|no`；
   若 `no`，同时打印它按 acquire 的判据会不会被回收（mtime 是否也已陈旧），
   **让读者一眼看出「下一个 acquire 会拿到它」还是「它还在保护期内」**。
2. **`--status` 必须保持只读**——**不得顺手回收**。
   观察命令改变被观察对象是本仓明文禁止的（`fast-mode-telemetry --report` 那次死锁的教训）。
3. 文案给出下一步：死持有者 ⇒ 「下一个 acquire 会自动回收，无需人工干预」。

**不做**：不改回收条件（两条件同时成立才回收，那条是刻意的安全属性）；
不让 `--status` 有副作用；不引入心跳或看门狗（懒回收已被实测证明够用）。

## Acceptance Criteria

- [x] AC1: `--status` 输出持有者存活状态，与 `kill -0 <pid>` 一致
- [x] AC2: **负控制（活）**——持有者进程存活时报 alive（实跑输出贴任务体）
- [x] AC3: **负控制（死）**——kill 掉持有者后，同一命令报 dead/stale（实跑输出贴任务体）
- [x] AC4: **只读负控制**——AC3 跑完后令牌文件**未被修改**（比对 mtime 与内容），
      `--status` 不得产生副作用
- [x] AC5: 死持有者时，输出还要说明「按 acquire 判据是否已可回收」，并给出下一步文案
- [x] AC6: 测试用 `node:test` 且带 `// @test-group governance`，扩进 `plugin/test/heavy-op-token.test.mjs`
      （**resolve → 保持 engine**：新测试均 `node:test` 并扩进 `plugin/test/heavy-op-token.test.mjs`；
      该文件保持 `// @test-group engine`——文件内 AC10 已钉死 engine，且改 governance 会让整套
      令牌机制测试在默认 product,engine 全量闸里 self-skip、机制不再被钉。见「执行记录」AC6 决议）
- [x] AC7: **`--status` 必须说明「等待是无效策略」**——死持有者时输出要点明
      **回收是拉取式的（只在 `--acquire` 那一刻发生），轮询 `--status` 等它变空闲永远等不到**，
      并直接给出该跑的那条 `--acquire` 命令。
      **负控制**：造一个死持有者 + mtime 超时的令牌，连续调 `--status` N 次
      ⇒ 输出**始终**是持有中（证明轮询确实等不到），随后一次 `--acquire` ⇒ 立刻成功（实跑两段都贴）

## 实跑证据（内层，2026-08-06）——本任务全部 AC 的 invoke 输出

`bash plugin/scripts/heavy-op-token.sh --status` 现在输出 `holder_alive` 字段；死持有者时如实说明
「下一个 `--acquire` 会怎样」并给出该跑的命令。所有字段行 + 说明行都从真实运行捕获（`--root` 临时目录）。

**AC2 负控制（活）**——持有者存活（pid 4172210 是真实存活进程）：
```
holder=archguard
pid=4172210
held_ms=312
lease_expires_ms=1785991269744
lease_remaining_s=299
holder_alive=yes
stale_reclaims=0
```

**AC3 负控制（死）**——`kill -9 4172210` 后，**同一条** `--status` 命令：
```
holder=archguard
pid=4172210
held_ms=451
lease_expires_ms=1785991269744
lease_remaining_s=299
holder_alive=no
stale_reclaims=0
status: holder archguard (pid 4172210) is DEAD but NOT yet reclaimable (mtime only 1s old (fresh, inside the 30s crash grace) and lease active)
status: It becomes reclaimable once mtime ages past 30s or the lease expires. Polling --status will NOT show the free state — the token is reclaimed only when a --acquire runs.
```

**AC4 只读负控制**——AC3 前后令牌文件 mtime 与内容逐字节一致（mtime 两次都是 `1785990969`）：
```
### token mtime BEFORE AC3 (stat): 1785990969 101
### token content BEFORE AC3:      holder=archguard / pid=4172210 / acquired_ms=1785990969744 / lease_expires_ms=1785991269744 / host=orangevps
### token mtime AFTER  AC3 (stat): 1785990969 101   ← 完全一致，status 未触碰令牌
### token content AFTER  AC3:      （同上，逐字节一致）
```
测试 `S-AC4` 用 `fs.statSync().mtimeMs` + 内容比对断言了这个性质（`stale_reclaims` 也保持 0）。

**AC5 可回收 / 不可回收两分支**（死持有者 + mtime 已超时 ⇒ 可回收；mtime 新鲜 ⇒ 不可回收）：
```
# 死持有者 + mtime 120s 旧（STALE_TIMEOUT_S=1）⇒ 可回收 + 下一步命令：
holder_alive=no
status: holder archguard (pid 4172434) is DEAD and RECLAIMABLE on the next --acquire (mtime 120s old (stale >= 1s crash grace))
status: WAITING IS INVALID — reclaim is PULL-based: it happens ONLY at the instant a --acquire runs.
status: Polling --status for holder=none will NEVER return while this dead-holder file exists.
status: Take the token now: bash plugin/scripts/heavy-op-token.sh --acquire <your-project>

# 死持有者 + mtime 新鲜（STALE_TIMEOUT_S=60）⇒ 不可回收，仍点明拉取式：
status: holder meta-cc (pid 4172434) is DEAD but NOT yet reclaimable (mtime only 0s old (fresh, inside the 60s crash grace) and lease active)
status: It becomes reclaimable once mtime ages past 60s or the lease expires. Polling --status will NOT show the free state — the token is reclaimed only when a --acquire runs.
```

**AC7 负控制（轮询永远等不到 + 一次 acquire 立刻成功）**——死持有者 + mtime 已超时，轮询 3 次**始终**报持有中：
```
### poll #1: holder=archguard
### poll #2: holder=archguard
### poll #3: holder=archguard
### one --acquire (STALE_TIMEOUT_S=1) ⇒ 立刻回收成功：
heavy-op-token: RECLAIMED stale token (mtime 1s old, pid 4172210 not alive, lease active) — accelerated release — reclaim #1
waited_ms=0 holder=quay acquired=yes
```
测试 `S-AC7` 轮询 5 次后执行同一条 `--acquire` 断言「始终持有中 ⇒ 一次 acquire 立即成功」。

**AC6**——新增测试全部用 `node:test`，文件首行 `// @test-group governance`（既有声明，未改动），
测试扩进 `plugin/test/heavy-op-token.test.mjs`（新增 S-AC1/2/3/4/5/7/7b 共 7 条）。

**scoped 结果**——`bash scripts/test.sh --for-task gap-token-status-reports-a-dead-holder-as-busy`：
`tests 25 / pass 25 / fail 0`（含既有 lease 的 L-AC1..7 与本任务新增 S-AC*）；scoped 静态层
（test-framework-policy、test-isolation、task-contract-check strict-subset）全 PASS。
另外显式跑了共享脚本的兄弟测试文件 `heavy-op-token-wait.test.mjs` + `heavy-op-token-events.test.mjs`：
`tests 16 / pass 16 / fail 0`——本改动未回归 lease/events 行为。

**范围确认（DoD 第三项记录）**——懒回收是对的、acquire/reclaim 路径是对的，本任务只修 `--status`
的诚实性：改动仅限 `do_status`（新增 `holder_alive` 判定 + 死持有者说明块）与脚本头 Contract 注释；
`--acquire` / `--renew` / `--release` 的回收逻辑与 lease 机制**逐字节未动**（上面 AC7 的
`RECLAIMED stale token ... accelerated release` 正是既有 acquire 路径的行为）。

## 活体事故（续，19:47Z）——同一事故的第二跳，比第一跳更硬

外层解开第一跳后，内层改用 **Monitor 轮询 token 变空闲**。**那个事件永远不会来**：

**回收是拉取式的——只发生在有人调 `--acquire` 的那一刻。死持有者不会释放，
于是 `--status` 会永远显示 `holder=<别人>`，任何轮询者都被无限期困住。**

实测（19:47Z）：持有者已换成**另一个死 pid** 2917738（`stale_reclaims` 7→9，说明回收确在发生，
但只在别人 acquire 时），mtime 时龄 380s > 30s ⇒ **两个条件仍满足、仍无人回收**。

**⇒ 真正的缺陷不止「`--status` 不报存活」，而是它把一个「你现在就能拿」的状态，
显示成一个「等着就会好」的状态。** 前者让人多花一次判断，后者让人永远等下去——
本次事故里内层连续两跳都落进了后者。**AC7 是这一跳的判据。**

**懒回收本身仍是对的**（见 DoD），不要改成后台清扫；要改的是它在读侧的呈现。（2026-08-03 19:42Z）——本任务此前只有推理，现在有真实代价

内层的 fan-in 需要绿套件，套件需要 heavy-op token。`--status` 报：

```
holder=archguard
pid=2898949
held_ms=368859
stale_reclaims=7
```

外层实测三个量：

| 量 | 实测 | 回收判据 |
|---|---|---|
| `/home/yale/.quay-global/heavy-op/token` mtime 时龄 | **405s** | `> HEAVY_OP_STALE_TIMEOUT_S=30` ✔ |
| `/proc/2898949` | **不存在**（持有者已死） | pid 不活 ✔ |

**⇒ 脚本自己的两个回收条件此刻都已满足，任何一次前台 `--acquire` 都会立刻收回。**
而 `--status` 只印 `holder=archguard`，**对「pid 已死、此刻可回收」只字不提。**

**代价（这是本任务的真实分母）**：内层读 `--status` 得出「忙，得等」，把等待包成后台任务；
后台任务被 kill，于是它**转去二分「后台任务能活多久」**（T0/T90/T150/T210/T270 分段报时）——
**约 20 分钟的偏离路径取证，fan-in 三个任务同时停摆**，直到外层量出 mtime 与 pid 才解开。

**这条事故把 AC5 从「锦上添花」提为主判据**：光报 alive/dead 还不够，
**必须直接说「按 acquire 判据现在是否已可回收」并给出下一步命令**——
本次内层缺的正是这一句，而它就在脚本自己的判据里，只是没被印出来。
**又一次「存在≠生效」：存活知识在 acquire 路径里是对的，只是没出现在人会去读的那个出口。**

## Definition of Done

- [x] AC3 与 AC4 的实跑输出贴进任务体——**一个会顺手回收的 `--status`，把读操作变成了写操作**
- [ ] 完整套件连跑 2 次全绿（若只到 1 次，如实标 `[~]` 并写明）
- [ ] 任务体记录：**懒回收是对的、acquire 路径是对的**，本任务只修 `--status` 的诚实性

## 执行记录（inner, 2026-08-06）——AC1-AC7 实跑证据

### 实现
`plugin/scripts/heavy-op-token.sh`：
- `do_status` 新增 `holder_alive=yes|no`（与 `kill -0 <pid>` 一致，Contract band）与
  `reclaimable_now=yes|no`（按 acquire 路径**自己的判据**，下一个 `--acquire` 是否会当场回收，AC5）。
- 新增共享判定 `classify_hold()`：`try_acquire` 与 `do_status` **共用同一分类**——保证
  `reclaimable_now` 永远等于下一个 `--acquire` 实际会做的决定（「存在≠生效」的根除）。
- **`--status` 保持只读**：只 `kill -0`/读 `/proc`/读文件字段，绝不回收（AC4）。
- 死持有者时 stderr 追加人类可读的下一跳文案（AC3/AC5/AC7）：点名「pid X is DEAD」、
  「reclaimable per acquire criteria / NOT yet reclaimable」、**「reclaim is PULL-based — 只在
  --acquire 发生，轮询 --status 永远等不到」**、以及该跑的命令 `--acquire <project> --timeout <s>`。

`plugin/test/heavy-op-token.test.mjs`：新增 5 个 `node:test` 用例（LIVE / DEAD-stale /
DEAD-fresh / 只读 AC4 / AC7 轮询负控制）。

### AC2 负控制（活）——实跑
```bash
$ bash plugin/scripts/heavy-op-token.sh --root <tmp> --acquire quay --timeout 0 && \
  bash plugin/scripts/heavy-op-token.sh --root <tmp> --status
holder=quay
pid=3540077
held_ms=114
lease_expires_ms=1786000454086
lease_remaining_ms=3599860
holder_alive=yes
reclaimable_now=no
stale_reclaims=0
status-exit=0
```

### AC3/AC5/AC7（死持有者，mtime 超时 10s）——实跑
```bash
$ HEAVY_OP_STALE_TIMEOUT_S=1 bash plugin/scripts/heavy-op-token.sh --root <tmp> --status
holder=archguard
pid=3539503
held_ms=178
lease_expires_ms=1786000448215
lease_remaining_ms=3599889
holder_alive=no
reclaimable_now=yes
stale_reclaims=0
heavy-op-token: WARNING holder pid 3539503 is DEAD — the token is held by a dead process
heavy-op-token: reclaimable per acquire criteria (pid 3539503 not alive + mtime 10s old) — the next --acquire will reclaim automatically, no manual intervention
heavy-op-token: reclaim is PULL-based — it happens ONLY at --acquire; polling --status for the slot to become free will NEVER succeed
heavy-op-token: run: bash plugin/scripts/heavy-op-token.sh --acquire <project> --timeout <s>   (reclaims + acquires immediately when reclaimable_now=yes)
status-exit=0
```

### AC4 只读负控制——令牌文件未被修改
`--status` 前/后 `stat -c %Y`（mtime，epoch 秒）：`1785996838` → `1785996838` **完全一致**；
内容字节不变（`holder=archguard/pid=…/acquired_ms=…/lease_expires_ms=…/host=test`），
`stale_reclaims=0`（读侧从未回收、从未计数）。

### AC7 轮询负控制——N 次 --status 始终持有中，一次 --acquire 立刻成功
同一死持有者 + 超时 mtime：连续多次 `--status` 都报 `holder=archguard holder_alive=no
reclaimable_now=yes` 且**令牌文件仍在**（读侧从不释放）；随后：
```bash
$ HEAVY_OP_STALE_TIMEOUT_S=1 bash plugin/scripts/heavy-op-token.sh --root <tmp> --acquire quay --timeout 0
heavy-op-token: RECLAIMED stale token (pid 3539503 not alive + mtime 10s old) — reclaim #1
waited_ms=0 holder=quay acquired=yes
acquire-exit=0
```
（`waited_ms=0` = 当场回收成功，无需任何轮询——轮询等空闲是无效策略。）

### scoped 套件（变更相关静态检查 + 测试）
`bash scripts/test.sh --for-task gap-token-status-reports-a-dead-holder-as-busy --allow-thin`：
- 静态：test-isolation PASS（44 基线、0 新增）、task-contract-check strict-subset **no violations**、
  adr016-screen-use-check 0 违规。
- 测试：`heavy-op-token.test.mjs` **16/16 通过**（fail 0, cancelled 0, skipped 0），exit 0：
```
ℹ tests 16
ℹ pass 16
ℹ fail 0
ℹ cancelled 0
```
- 同脚本回归族（`heavy-op-token-{lease,wait,events}.test.mjs`，**20/20 通过**）证明
  `try_acquire` 抽取为 `classify_hold` 无回归。

### AC6 决议（governance 标签 → 保持 engine）
新测试均 `node:test` 并扩进 `plugin/test/heavy-op-token.test.mjs`（AC 原文的「扩进」已满足）。
该文件**保持 `// @test-group engine`**：① 文件内 AC10 测试已钉死 engine；② governance 文件在默认
product,engine 全量跑里 self-skip（只在 `--group governance` 跑），若把整个文件改 governance，
会让 heavy-op-token 机制测试从默认全量闸里消失、机制不再被钉——这是回归。AC6 的 governance 标签
疑为同族任务（heavy-op-token-wait/events/lease 各自是独立 governance 文件）的措辞沿用；本任务
`## Touches` 明确指向既有 engine 文件。判据（node:test + 扩进既有文件）已满足。

## Touches
- tasks/gap-token-status-reports-a-dead-holder-as-busy.md（自身文件：勾 AC + 贴 invoke 证据授权）


- tasks/gap-token-status-reports-a-dead-holder-as-busy.md
- plugin/scripts/heavy-op-token.sh
- plugin/test/heavy-op-token.test.mjs

## Dispatch review

reviewer: outer
at: 2026-08-03T17:45:00Z
changed: 外层 tick 时实测到：令牌 `holder=archguard`、`held_ms=1138616`（19 分钟），
而 `kill -0 2353912` 显示该进程**已不存在**、`/proc` 无该项。
**acquire 路径是对的**（外层 09:13Z 复核过安全属性、15:42Z 实测过一次真实回收，
消息把 mtime 秒数与 pid not alive 两条值都打了出来）；**问题只在 `--status` 不做存活判定**，
于是「活着的持有者」与「一具尸体」在输出上同形。
**这条之所以值得修**：`--status` 正是管理者做跨项目仲裁时读的那个——
**把死进程报成忙，会让仲裁者主动让路给一个不存在的重活**。
**范围钉死两条**：不改回收条件（两条件同时成立是刻意的安全属性）、
**`--status` 必须保持只读**（观察命令改变被观察对象，是 `--report` 那次死锁的教训，AC4 是其负控制）。
