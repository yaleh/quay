---
id: gap-driver-start-false-confirms-unsettled-driver
title: driver start 在驱动未就绪时误报 started:（存活确认守卫是定值 250ms，宿主启动延迟一超即失效）—— 套件 3/3
  轮红，已挡两个互不相关任务着地
status: todo
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

## Touches

- plugin/scripts/driver-runtime.ts
- plugin/test/driver-runtime.test.mjs
- tasks/gap-driver-start-false-confirms-unsettled-driver.md

## Acceptance Criteria

- [ ] AC1（能取假·双向对照，改前读数）：把「driver 启动耗时」作为**唯一变量**复现误报——同一命令、同一夹具，boot ~50ms ⇒ `start-pending` + 非 0；boot >250ms ⇒ `started:` + 0。判据：**两种条件退出码不同**，且各 ≥2 次、读数落盘。⛔ 不得只贴处理组的红。
- [ ] AC2（正控制·防「改成永不确认」）：改后，**boot 被拉长到 >250ms** 的条件下 `start` 必须 ≥3/3 非 0（`start-pending`），**且**在驱动真就绪的条件下仍必须确认成功（`started:` / `already-running: confirmed`，exit 0）。两个方向都要有读数——只有前者不足以证明修好。
- [ ] AC3（硬规则 4 推论三：判据挪到生产载体）：改后 `plugin/test/driver-runtime.test.mjs` 在**套件并发**下连续 ≥3 轮绿，读数取自 `.quay/verification-round.jsonl` 的 perFile 聚合（⛔ 不以「单跑绿」结案——单跑本来就在绿，不含信息）。
- [ ] AC4（硬规则 5b：修一处 ≠ 只此一处）：把「用『进程存在』当『已就绪』∧ 守卫是定值」这个形态在同一载体里枚举——`aliveness()` 的全部消费者（`statusForKind` / `livenessForKind` / `startKind` 的 already-running 路径 / `restartKind`），贴**命中数**与前 3 条实际内容。
- [ ] AC5：`--confirm-timeout` 的语义在改动后仍与 `:1549-1551` 的 `--help` 逐字一致（三态 `started:` / `start-failed:` / `start-pending:` ⛔ 不得被压成布尔）。

## Definition of Done

- [ ] 真落地（DIR-026 Reading A）：**一次真实的 `driver start`** 在「驱动未就绪」条件下产出 `start-pending`（贴 stdout/stderr/退出码），**并且**一次真实的 `driver start` 在驱动真就绪条件下产出 `started:` 且该 driver 随后**真的在服务**（贴其载体读数）——两个方向都在生产载体上取到，⛔ 不是夹具回声。
- [ ] 落点映射：被改动的确认语义 → 其正本（`driver-runtime.ts` 的函数头注释 / `--help` 文本）同步更新，⛔ 不留第二份描述。
- [ ] 两条现场证据（`confirmed_ms=1045` / `=1044`）与本条的 AC3 读数在同一载体上可核。
