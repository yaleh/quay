---
id: gap-driver-start-false-confirms-unsettled-driver
title: driver start 在驱动未就绪时误报 started:（存活确认守卫是定值 250ms，宿主启动延迟一超即失效）—— 套件 3/3
  轮红，已挡两个互不相关任务着地
status: done
labels:
  - gap
  - mechanism
parent: null
children: []
extra: {}
depends_on: []
---
## Finding

**一句话**：`quay driver start` 会对**尚未就绪（甚至马上就要退出）**的 driver 打印 `started:` 并 exit 0 —— 因为它唯一的「稳定」守卫是一个**定值常量**（`CONFIRM_POLL_MS = 250`ms），而它要区分的量（进程从 spawn 到「真的在服务」的延迟）**随宿主负载变化**。宿主启动一慢过 250ms，守卫就不再区分「起来了」与「刚 spawn 出来、还在初始化、马上要退」，**回到该功能修好之前那个「报成功但实际死亡」的形态**（硬规则 4 推论二：字面量的合理性依赖宿主 ⇒ 换台机器/换个负载即失效，且静默）。

### 机制（读码可得，本轮已逐行核过）

- `plugin/scripts/driver-runtime.ts:1080` —— **supervisor** 在 spawn 出子进程后立刻写 driver pid 文件（`writePidFile(st.driverPidFile, child.pid)`）。
  ⇒ `aliveness()`（`:1143-1147`）里的 `driverAlive` 实际含义是**「那个子进程此刻存在」**，**包含**「刚 spawn、还在 import/初始化」与「即将 exit」。它**不是**「driver 已进入常驻循环」。
- `awaitDriverConfirmation`（`:1261-1292`）唯一的稳定判据是 `settleMs = CONFIRM_POLL_MS`（`:1233` `= 250`，`:1272`）：双活读数**连续两次**（相隔 ≥250ms）⇒ `confirmed`。
  ⇒ 一个「活 800ms 然后 exit(1)」的进程，**必然**跨过 ≥2 个 250ms 轮询点 ⇒ 被判 `confirmed`。守卫的注释（`:1268-1271`）自陈它要挡的正是这种「尚未 import 完就自己退了」的进程 —— 而它用来挡的那个数是个**定值**。

### 现场发生率（硬规则 12：先给次数，再谈机制）

AC4 判据于 `8bff44425`（2026-09-13T03:22:31Z）落 develop。**此后一共有 3 份套件日志，3/3 都红在本文件上，跨 2 个互不相关的任务分支**（`ls -t .quay/fan-in-suite-*.log`）：

| 时刻 | 任务 | 判词 |
|---|---|---|
| 05:30 | `gap-quay-server-lightweight-peer-identity-spike` | `未确认存活 ⇒ 非零退出：started: supervisor pid=2765126 kind=promotion run_id=dr-ac4-short driver pid=2765880 **confirmed_ms=1045**` |
| 06:13 | `gap-ac203-two-distinct-kinds-no-production-run` | `慢启动的确认耗时确实 > 窗口(1s)：**confirmed_ms=530**`（step ② 断言） |
| 06:51 | 同上 | `未确认存活 ⇒ 非零退出：started: … driver pid=955909 **confirmed_ms=1044**` |

前两条里的 `confirmed_ms≈1044/1045` **是 step ① 的断言**（`driver-runtime.test.mjs:732` `assert.notEqual(short.status, 0)`）：夹具 `SLOW_START_DRIVER`（`:672`）在前 3 秒**每次启动都 exit(1)**，1s 的确认窗内它**不可能**是常驻的 ⇒ 任何 `started:` 都是误报。两个不同 worktree、互不相关的 delta、**1044 与 1045 两条几乎相同的读数** ⇒ 不是随机噪声，是同一个机制。

### 本轮对照实验（硬规则 4 推论四：给不出对照就不得作为结论投递）

**唯一变量 = driver 进程的启动耗时**，命令、root 结构、confirm 窗口（1s）全部相同（夹具 = 与测试同一份 `SLOW_START_DRIVER`，只多/少一段 busy-wait）：

```
控制组（boot ~50ms，= 出厂夹具）   : start-pending + rc=1   （5/5）
处理组（boot ~600ms，其余逐字相同）: started: + rc=0        （≥1 次，fresh root）
```

⇒ **若「误报由启动延迟驱动」为假、即守卫真的能区分「就绪」与「刚 spawn」，处理组的退出码不会与控制组不同。** 对照给出了相反预测并命中。（如实标注：我自己的实验里干净观测到 **1** 次误报；处理组另 1 次 rc=0 来自复用了旧 stamp 的合法确认，不计入。现场那 2 条 `confirmed_ms≈1044` 是第 2、3 次观测。）

**附带读数（排除「测试本身坏了」）**：单跑 `node --test plugin/test/driver-runtime.test.mjs` = **绿**（`[AC4 窗口=1s] exit=1 wall_ms=1892`，`start-pending … elapsed_ms=1013`）。⇒ 本文件不是坏了，是**只有在套件级并发（把 node 启动推到 >250ms）时才红**。

### 为什么这**不是**「测试 flaky」，而是**生产缺陷**（⛔ 本条决定修法方向）

判据要的语义是「驱动未就绪时不得报成功」。夹具的未就绪态（前 3 秒每次都 exit）**是正确的未就绪态**；生产的确认规则却把它读成就绪。**测试是 true positive，被测代码是错的。** ⇒ ⛔ 不得用「注 seam / 放宽断言 / 加 retry / 加 sleep / 挪 `@test-group`」把它变绿 —— 那只是让红消失，不是让判定可靠（`gap-load-sensitive-tests-read-live-host-class-level-seam` 的 Plan 2/3 已逐条禁止这四种）。

**同理，本文件注 `@load-sensitive` 无效**（本轮已核）：`full-suite-runner.ts:138` 的 `scanFamily`/`kindForFile` **只**在红的时候写分区（`:238`、`:2114`）供 triage 用；`scripts/test.sh` 根本不消费 `known-load-sensitive.ts` ⇒ **标注 ≠ 挪出主泳道**（`annotation ≠ lane routing`）。

### 影响面（为什么值得优先）

- `driver start` 是 **cold start / `verify-deliver-coldstart.sh` step④（AC-203）** 的判活入口：一次误报会让 AC-203 记录写下 `driver_alive=1` 而该 driver 其实没在服务 ⇒ **判据的输入本身失真**（硬规则 4b：用代理量当直接量）。
- 它同时**挡住任何任务的 fan-in**：套件红 ⇒ `exited-not-landed` ⇒ 与失败者自己的 delta 无关（3/3 轮，2 个任务）。

### 候选修法（⛔ 留给出题者判定，本条不预设；每条都需自己的取假控制）

1. **把「已就绪」换成直接量**：supervisor 自己就在日志里写 `supervisor: started driver pid=N` / `supervisor: driver exited code=C`（`:1081`/`:1083`）⇒ 「当前 pid 的 start 行之后没有 exit 行」是一个**与负载无关**的直接信号，实现上可让确认在「该 pid 已被记过死亡」时**永不确认**。⚠️ 需核日志不可读时的取值（⛔ 不得与「就绪」同形，硬规则 3b）。
2. **改 pid 文件的写者**：由 **driver 自己**在进入常驻循环后写 pid 文件，而不是 supervisor 在 spawn 时替它写（`:1080`）⇒ `driverAlive` 的含义变成「driver 走到了自己的循环」。⚠️ 与 `:1027` 注释声明的「权威写 driver pid」语义冲突，需一并裁定。
3. **测试侧（仅在被保留的断言确有必要时）**：step ② 的 `confirmed_ms >= 1000`（`:746`）断言的是**测试自己的墙钟**（①② 共用一个 3s stamp），不是生产的性质 ⇒ 该断言若要留，必须相对化（例如 ② 前删掉 stamp，使下一次 respawn 重建一个完整窗口），否则它测的是宿主。

### 实施（worker 落地，2026-09-13）

**采用候选 2**，并**只经 registry 既有的 `pidSelf` 旗标**表达（⛔ 不新造机制）：`runSupervisor` 不再替
`pidSelf=true` 的 kind 预写 driver pid 文件（worker 保留 supervisor 写）。于是该文件对 5 个 kind 变成
**驱动产出的就绪标记**（与负载无关的直接量），`CONFIRM_POLL_MS` 降级为纯去抖。候选 1 被否：本轮实测
treatment 误报发生于 `confirmed_ms=758`，**那一刻日志里还没有 `driver exited` 行**（驱动 600ms 才退），
⇒ 「没有 exit 行」不能替代「已就绪」，它只是「还没死」。

**⚠️ Touches 扩了一条（硬规则 5b：修一处 ≠ 只此一处，命中数 = 2）**：这个修法把 `pidSelf` 从**注释性
约定**变成**承重契约**（说「写者是驱动」就必须真由驱动写）。按此契约枚举全部替身夹具后，**唯一不符的
是 `plugin/test/driver-cli.test.mjs:87`**（给 promotion 用了一个只 idle、不自写 `--pid-file` 的假驱动
—— 它之所以够用，恰因 supervisor 的预写掩盖了这一点）。**若不改它，该文件 9 条测试会红**（`alive=1`
断言）。⇒ 如实登记并加入 Touches，⛔ 不静默。

**生产侧已核（5/5 真驱动自写并确认）**：promotion / outer / quality / meta / goal 逐个用真 kernel +
真 driver 起（`--confirm-timeout 30`）⇒ 全部 `started:` + rc0，且 `.quay/<prefix>.pid` 由驱动自己写。

## Touches

- plugin/scripts/driver-runtime.ts
- plugin/test/driver-runtime.test.mjs
- plugin/test/driver-cli.test.mjs
- tasks/gap-driver-start-false-confirms-unsettled-driver.md

## Acceptance Criteria

- [x] AC1（能取假·双向对照，改前读数）：把「driver 启动耗时」作为**唯一变量**复现误报——同一命令、同一夹具，boot ~50ms ⇒ `start-pending` + 非 0；boot >250ms ⇒ `started:` + 0。判据：**两种条件退出码不同**，且各 ≥2 次、读数落盘。⛔ 不得只贴处理组的红。
- [x] AC2（正控制·防「改成永不确认」）：改后，**boot 被拉长到 >250ms** 的条件下 `start` 必须 ≥3/3 非 0（`start-pending`），**且**在驱动真就绪的条件下仍必须确认成功（`started:` / `already-running: confirmed`，exit 0）。两个方向都要有读数——只有前者不足以证明修好。
- [x] AC3（硬规则 4 推论三：判据挪到生产载体）：改后 `plugin/test/driver-runtime.test.mjs` 在**套件并发**下连续 ≥3 轮绿，读数取自 `.quay/verification-round.jsonl` 的 perFile 聚合（⛔ 不以「单跑绿」结案——单跑本来就在绿，不含信息）。
- [x] AC4（硬规则 5b：修一处 ≠ 只此一处）：把「用『进程存在』当『已就绪』∧ 守卫是定值」这个形态在同一载体里枚举——`aliveness()` 的全部消费者（`statusForKind` / `livenessForKind` / `startKind` 的 already-running 路径 / `restartKind`），贴**命中数**与前 3 条实际内容。
- [x] AC5：`--confirm-timeout` 的语义在改动后仍与 `:1549-1551` 的 `--help` 逐字一致（三态 `started:` / `start-failed:` / `start-pending:` ⛔ 不得被压成布尔）。

## Definition of Done

- [x] 真落地（DIR-026 Reading A）：**一次真实的 `driver start`** 在「驱动未就绪」条件下产出 `start-pending`（贴 stdout/stderr/退出码），**并且**一次真实的 `driver start` 在驱动真就绪条件下产出 `started:` 且该 driver 随后**真的在服务**（贴其载体读数）——两个方向都在生产载体上取到，⛔ 不是夹具回声。
- [x] 落点映射：被改动的确认语义 → 其正本（`driver-runtime.ts` 的函数头注释 / `--help` 文本）同步更新，⛔ 不留第二份描述。
- [x] 两条现场证据（`confirmed_ms=1045` / `=1044`）与本条的 AC3 读数在同一载体上可核。

## Evidence

**注**：本节与 `## Acceptance Criteria`/`## Definition of Done` 的勾选只陈述**已在本轮取到的读数**；
每组读数都标明取自哪个载体，⛔ 不是夹具回声（硬规则 4 推论三）。

### E1（AC1/AC2）双向对照 —— 唯一变量 = 内核版本（本轮由 worker 亲自跑，⛔ 非沿用上轮读数）

同一夹具（busy 600ms 后 `exit(1)`，**从不写 `--pid-file`** ⇒ 从未进入常驻循环）、同一命令、同一窗口
（5s），唯一变量是内核：

| 内核 | 3 次读数 | 退出码 |
|---|---|---|
| **改前** `develop:plugin/scripts/driver-runtime.ts`（`:1167` 无 `pidSelf` 守卫） | `started:` confirmed_ms=1528 / 1530 / 1526 | **0（误报）** |
| **改后** worktree `HEAD`（`:1178` `if (child.pid && !spec.pidSelf)`） | `start-pending:` ×3 | **1（正确）** |

⇒ 两种条件退出码不同（0 vs 1）= AC1 的判据；改后同一夹具不再被确认 = AC2 的负方向。
（附带：window=1s 时**两个内核都给 start-pending** —— 本机 supervisor 启动 >1s，驱动在窗口内根本没被
spawn；记此为「窗口必须够长才 isolate 变量」的对照，⛔ 不拿它当结论。）

AC2 的**正方向**（真就绪必须确认）：`plugin/test/driver-runtime.test.mjs` 的
`[GDS 就绪 boot=600ms] exit=0 → started: … confirmed_ms=1517/3584`；真驱动方向见 E2。
读数落盘：`.quay/ac1-false-confirm-readings.jsonl`（`phase=MY-ROUND-…`）。

### E2（DoD 真落地）真驱动 · 真内核 · 生产载体

- **未就绪方向**：真 `promotion-driver.ts` + 真内核，`--confirm-timeout 1`（小于该驱动 ~1.26s 的就绪耗时）
  ⇒ `start-pending: …（supervisor alive=1，driver pid=3160917 alive=1，elapsed_ms=1012）`，**退出码 1**。
- **就绪方向**：同一组合、`--confirm-timeout 30` ⇒
  `started: supervisor pid=3271768 kind=promotion run_id=gds-serving4 driver pid=3272158 confirmed_ms=1262`，退出码 0。
  随后（35s 后）该驱动的**生产载体** `.quay/promotion-round.jsonl` 出现真实轮记录：
  `{"ts":"2026-09-13T09:49:45.227Z","round":1,"run_id":"gds-serving4","pid":3272158,"action":"none","pool":0,…,"liveness":{"checked":true,"running":true}}`
  ⇒ 它**真的在服务**，⛔ 不是「报成功就完了」。
- **写者承重契约已核实**：`.quay/promotion-driver.pid` 内容 = 3272158，而该 pid 的 cmdline 是
  `node --experimental-strip-types /tmp/…/plugin/scripts/promotion-driver.ts --root … --pid-file .quay/promotion-driver.pid --run-id gds-serving4`
  ⇒ **文件由驱动自己写**（supervisor 不再预写）。

### E3（AC3）套件并发下 ≥3 轮绿 —— 读数取 `.quay/verification-round.jsonl` 的 perFile

连续三轮，均在**含本修复的提交** `06fa4e40` 上跑（`grep -n '!spec.pidSelf'` 命中 `:1091`），
且该提交与本任务 `## Touches` 的三个文件**逐字节相同**
（`git diff 06fa4e40 HEAD -- plugin/scripts/driver-runtime.ts plugin/test/driver-runtime.test.mjs plugin/test/driver-cli.test.mjs` **为空**）：

| round | 时刻 | 全量套件 | 轮状态 | `plugin/test/driver-runtime.test.mjs` | `plugin/test/driver-cli.test.mjs` |
|---|---|---|---|---|---|
| 1618 | 2026-09-13T07:50:07Z | 622 文件 / laneCount=24 | green (fail=0) | **passed=true** (68.0s) | passed=true |
| 1619 | 2026-09-13T08:03:53Z | 622 文件 | green (fail=0) | **passed=true** (79.8s) | passed=true |
| 1620 | 2026-09-13T08:15:16Z | 622 文件 | red (fail=1，**别的文件**) | **passed=true** (72.8s) | passed=true |

**同一载体里的取假控制（DoD3）**：改前轮 1611/1612/1614/1615/1616 的 `perFile` 里
`driver-runtime.test.mjs passed=false`，与那两条现场证据（`confirmed_ms=1045` / `=1044`，见
`.quay/fan-in-suite-*.log`，任务体 Finding 表）指向同一批轮次 ⇒ **两个方向都在同一载体上可核**。

### E4（AC4）修一处 ≠ 只此一处 —— 枚举（命中数 + 前 3 条实际内容）

- `aliveness()` 的消费者（非注释行）：**命中数 = 8** ——
  `packages/quay/src/observation.ts:3027`（接口声明）、`observation.ts:3064 const a = runtime.aliveness(root, kind);`、
  `plugin/scripts/driver-runtime.ts:744 const a = aliveness(root, kind);`、`:1241`（定义）、`:1288`、`:1320`、`:1402`、
  `plugin/scripts/meta-driver.ts:1176 try { a = aliveness(root, kind); } catch { a = null; }`。
- driver pid 文件的读写点（=「进程存在」这个代理量）：**命中数 = 8**（`statePaths` 定义 / `:1178` 唯一写点 /
  `:1256`、`:1504`、`:1564` 读点 / `:1510`、`:1576` 清理）。
- 以字面量时长当就绪判据：**命中数 = 8**（`CONFIRM_POLL_MS` 定义 + 全部引用；改后它只承担去抖）。
- **残留（如实登记，⛔ 不静默）**：`pidSelf=false` 的 **worker** 支路仍是代理量（其 driver pid 文件仍由
  supervisor 写）⇒ `start --kind worker` 的就绪确认仍可能误报；修它需要 `worker-driver.ts` 自写该文件，
  **不在本任务 `## Touches` 内**。已由 `driverPidIsReadinessMarker()` 的头注释登记，并被测试断言为已知残留。
- 完整枚举落盘：`.quay/ac4-enumeration.txt`。

### E5（AC5）`--confirm-timeout` 的 `--help` 语义逐字未变

改前 vs 改后取出同一段 help 文本（879 字节）逐字节比较 ⇒ **IDENTICAL**；三态字面量
`started:` / `start-failed:` / `start-pending:` **各 1 次（3/3，⛔ 未被压成布尔）**。

### E6 本轮验证命令（可复跑）

- `node --test plugin/test/driver-runtime.test.mjs` ⇒ **25/25 pass**；`node --test plugin/test/driver-cli.test.mjs` ⇒ **9/9 pass**。
- `bash scripts/test.sh --for-task gap-driver-start-false-confirms-unsettled-driver --allow-thin` ⇒ **exit 0**
  （scoped 静态层 ≈20 个 checker + 上述两个测试文件，34/34 pass）。

### E7（DoD2）落点映射

被改动的确认语义的**唯一正本 = `plugin/scripts/driver-runtime.ts` 的函数头注释**
（`runSupervisor` 的写者注释 / `driverPidIsReadinessMarker` / `awaitDriverConfirmation` 的 `ConfirmVerdict` / `startKind` 的三态说明），
与本修复同提交更新；`--help` 文本按 AC5 **刻意保持不变**。⛔ 未新增第二份描述（⛔ 未在别处重述该语义）。