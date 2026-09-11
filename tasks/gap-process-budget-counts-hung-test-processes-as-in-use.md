---
id: gap-process-budget-counts-hung-test-processes-as-in-use
title: process-budget 把挂死的测试进程计入 in_use，活套件被压到 1 车道
status: ready
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: execution
---
## Proposal

`plugin/scripts/process-budget.sh` 的 `read_test_procs` 把「cmdline 里带 `--test-concurrency` / `--test-coverage-*` / `--test-*` 等标志的 node 进程」全部计入 `in_use`，**没有任何活性判定**。于是一棵挂死的套件进程树——父进程已成 init 的孤儿、几乎不消耗 CPU、存活数十小时——会被当成「正在占用预算的测试进程」一直数下去。

消费者是 `plugin/scripts/full-suite-runner.ts` 的 `defaultLaneCount()`：`max(1, floor((nproc − in_use) × oversub / S))`。`in_use` 被僵死进程抬高 ⇒ 真正在跑的套件拿到的车道数被压到地板 1，而 `--test-concurrency` 是在 spawn 时 splice 进命令行的，**进程起来之后不会再重算**——一旦被压到 1，这一整轮套件就以串行跑到底。

这是一个自我强化的坑：套件被压慢 ⇒ 单个套件占用时间从分钟级拉到小时级 ⇒ 同期堆积的 fan-in 变多、挂死机会变多 ⇒ 僵死进程更多 ⇒ 车道更少。

修法方向：`in_use` 只应计入**真正在消耗 CPU 的**测试进程。⛔ 判别量不得是写死的年龄秒数或进程数字面量（硬规则④推论二：依赖当前机器规格的字面量换台机器就失效），应读宿主可观测量——例如采样窗口内该进程的 CPU 时间增量。⛔ 本任务不负责自动回收僵死进程，那是另一个决定；本任务只要求预算读数不再把它们算作在用。

## Evidence

2026-09-11 实测（直接量，逐条打印命中项）：

`process-budget.sh --json` 报 `in_use=12, available=4`（nproc=16）。把这 12 个逐条列出后，**10 个是僵死的**，分属 6 棵早已死掉的套件树，对应任务均不在飞：

| 套件树（worktree/任务） | 进程数 | 最老 |
|---|---|---|
| gap-ac168-criterion-sh-incompatible | 3 | 85 小时 |
| gap-task-branch-prefix-assumption-scattered-read-sites-orphan-enumeration-blind | 3 | 70 小时 |
| gap-goal-needs-human-blocking | 3 | 51 小时 |
| gap-goal-standing-ac-reverify-scope | 3 | 47 小时 |
| gap-ac228-conformance-target-fixture-real-quay-init | 3 | 29 小时 |
| gap-meta-readings-no-timeseries-derivation | 2 | 23 小时 |

活性对照：这 10 个进程在 30 秒采样窗口内的 CPU 时间增量合计 **2 秒**（≈0.07 核），而它们历史累计 CPU 有 17,666 秒——即曾经真在跑、后来挂死。

前后对照（清理这 17 个进程前后，同一台机器同一分钟）：

- `in_use` 12 → 3，`available` 4 → 13
- `defaultLaneCount()` 的取值由 1（实际 splice 进在跑套件命令行的值）升到 **13**

代价实测：被压到 1 车道的那个套件在跑 570 个测试文件，抽样每文件约 15–20 秒且严格串行 ⇒ 约 3 小时；按 13 车道估算是 20 分钟量级。该套件位于一个 active goal 的关键路径上。

### 实现后的实测（2026-09-11，本分支 d8823e2b4 + b85007733）

修法落在 `process-budget.sh`（唯一权威；`testProcessesInUse()` 读它的 `in_use`）。真机真进程双向对照，同机同分钟，K=3 个 hung（stdin 阻塞、0 CPU）+ 1 个 running（烧 CPU）的 `--test` 形进程同时存活：

| 读数 | 改前脚本（HEAD~3） | 改后脚本 |
|---|---|---|
| `in_use` | 30 | 2 |
| `available` | 0 | 14 |
| K 个 hung pid 是否在 `excluded` | （无该字段） | `[true, true, true]`，`cpu_delta_ticks=[0,0,0]` |
| running pid 是否在 `excluded` | — | `false`（⇒ 仍被计入，AC4 双向控制） |

现场遗留的僵死进程（PPID=1、存活 84,295 秒）改后也进了 `excluded`，`cpu_delta_ticks=0`。

红控制（真改前脚本换回跑本任务的 4 条新测试）：**pass 0 / fail 4**；换回本修复后 pass 4 / fail 0，且换回后文件 diff 逐字节一致。

识别量本身的两点加固（b85007733）：① `/proc/<pid>/stat` 的 comm 字段带括号且**可能含空格/括号**（设了 `process.title` 的 Node 进程），朴素的 `$14+$15` 按空白切分会读错 CPU 字段——而它**照样返回一个看着合理的数字**（硬规则 4 的典型形态）；改为锚在**最后一个 `)`** 上切分（字段 3 = 第 1 个 token ⇒ utime = 第 12、stime = 第 13）。② 整个候选集用**一次 awk**读完，不再每 pid 起一个 awk：窗口之外的开销由 ~1.85s 降到 ~0.34s（窗口 2000ms 时端到端 3.84s → 2.34s）——这一项直接决定下面那个钳制上界能不能守住消费者的 5s 子进程超时。

## AC

- [x] AC1（缺陷复现，可取假）：造一个含 K 个「有测试标志但无 CPU 增量」的 node 进程的环境（真进程或 seam），改前 `bash plugin/scripts/process-budget.sh --json` 的 `in_use` 把这 K 个全部计入。→ 实测：K=3 真 hung 进程存活时，改前脚本 `in_use=30`（该脚本没有 `excluded` 字段，即无排除机制）；且这 3 个 pid 出现在改后 `excluded` 集里，而 `excluded` **由构造只从已被分类为测试进程的候选中抽取** ⇒ 分类轴确实把它们计入了。红控制：把改前脚本（HEAD~3）换回跑本任务 4 条新测试 ⇒ pass 0 / fail 4；换回后 diff 逐字节一致。
- [x] AC2（修法）：`in_use` 只计入采样窗口内有 CPU 时间增量的测试进程；判别量读宿主可观测值，⛔ 不得引入写死的年龄秒数或进程数字面量。→ 判别量 = `/proc/<pid>/stat` 的 utime+stime（字段 14+15）在窗口内的增量 > 0——内核直接量，不问进程自己（硬规则 4b）。窗口是 env 旋钮 `PROCESS_BUDGET_SAMPLE_WINDOW_MS`（默认 1000ms，钳制 **200..2000**）；两个钳制界的依据是【/proc tick 分辨率】与【消费者 `testProcessesInUse()` 的 5s 子进程超时】这两个**外部契约**，不是宿主规格（硬规则 4 推论二禁的是「其合理性依赖当前机器规格的字面量」；且该超时一旦触发会 fail-open 成 `in_use=0`，即预算静默失效）。**无年龄阈值、无进程数阈值**。实测分离度：blocked 进程 0 ticks/s，running 进程 104 ticks/s。
- [x] AC3（改后读数）：同一环境下 `in_use` 不再计入那 K 个。→ 同一次运行：3 个 hung pid 全部进 `excluded`，`cpu_delta_ticks` 均为 0，`reason=no_cpu_delta`；`in_use` 30 → 2，`available` 0 → 14。
- [x] AC4（双向控制）：一个**真正在跑**的 `node --test` 子进程仍被计入——改后在该进程存活期间 `in_use` ≥ 1，证明修法没有把活进程一并排除。→ **同一次运行、同一环境**里 running 进程不在 `excluded` 中（⇒ 被计入），`in_use ≥ 1`；改前脚本同一瞬间 `in_use=30`。若修法连活进程一并排除，这一行会红（红控制实测 4/4 全红）。
- [x] AC5（消费者层）：同一环境下 `full-suite-runner.ts` 的 `defaultLaneCount()` 由地板值升到宿主派生值（枚举打印 nproc / in_use / S / oversub / 结果四个数，不是布尔）。→ 测试走**真实消费者链** `defaultLaneCount() → testProcessesInUse() → process-budget.sh`（`RESOURCE_GATE_TEST_NODE_PROCS` 留空，不钉捷径），枚举输出：`nproc=4 S=2 oversub=1 | in_use=3 ⇒ laneCount=1（地板）| in_use=0 ⇒ laneCount=2（宿主派生）`。真机读数同向：`in_use` 30→2 时 `available` 0→14。
- [x] AC6（排除可见，硬规则③b）：`process-budget.sh --json` 新增一个可枚举字段，列出被判为「不在消耗预算」而排除的进程（pid、存活秒数、窗口内 CPU 增量）；⇒ 「排除了 N 个」与「一个都没有」在输出上可区分，不静默。→ `--json` 新增 `excluded[]`（`pid` / `age_s` / `cpu_delta_ticks` / `reason` / `cmdline`）与 `excluded_count`，report 模式新增 `excluded_count`；测试断言 `excluded_count === excluded.length`。另有 `liveness_source`（`sampled` / `seam` / `classification-only-seam` / `pinned`）——`RESOURCE_GATE_TEST_PROC_CMDLINES` 这个**无 pid 的** seam 结构上采样不了活性轴，输出必须点名「哪条轴被真正评估过」，否则「没评估」与「评估合格」同形（硬规则 3b 的镜像半边）。
- [ ] AC7（全量绿）：`scripts/test.sh` 全量绿（由 driver 机械 fan-in 的全量 suite 步骤验证；worker 侧已跑本任务 scoped 门全绿）（待外部）

## DoD

生产读数上可验证：在存在僵死套件树的真实机器上，`in_use` 反映的是实际在消耗 CPU 的测试进程数，且一个新起的全量套件拿到宿主派生的车道数而非地板 1。fixture 与单测是必要不充分条件（DIR-026 Reading A）。

## Touches

- plugin/scripts/process-budget.sh
- plugin/test/resource-gate.test.mjs
- plugin/test/cap-from-gate-process-budget-path.test.mjs
- tasks/gap-process-budget-counts-hung-test-processes-as-in-use.md
