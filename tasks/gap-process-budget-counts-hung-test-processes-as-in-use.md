---
id: gap-process-budget-counts-hung-test-processes-as-in-use
title: process-budget 把挂死的测试进程计入 in_use，活套件被压到 1 车道
status: todo
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

## AC

- [ ] AC1（缺陷复现，可取假）：造一个含 K 个「有测试标志但无 CPU 增量」的 node 进程的环境（真进程或 seam），改前 `bash plugin/scripts/process-budget.sh --json` 的 `in_use` 把这 K 个全部计入。
- [ ] AC2（修法）：`in_use` 只计入采样窗口内有 CPU 时间增量的测试进程；判别量读宿主可观测值，⛔ 不得引入写死的年龄秒数或进程数字面量。
- [ ] AC3（改后读数）：同一环境下 `in_use` 不再计入那 K 个。
- [ ] AC4（双向控制）：一个**真正在跑**的 `node --test` 子进程仍被计入——改后在该进程存活期间 `in_use` ≥ 1，证明修法没有把活进程一并排除。
- [ ] AC5（消费者层）：同一环境下 `full-suite-runner.ts` 的 `defaultLaneCount()` 由地板值升到宿主派生值（枚举打印 nproc / in_use / S / oversub / 结果四个数，不是布尔）。
- [ ] AC6（排除可见，硬规则③b）：`process-budget.sh --json` 新增一个可枚举字段，列出被判为「不在消耗预算」而排除的进程（pid、存活秒数、窗口内 CPU 增量）；⇒ 「排除了 N 个」与「一个都没有」在输出上可区分，不静默。
- [ ] AC7（全量绿）：`scripts/test.sh` 全量绿。

## DoD

生产读数上可验证：在存在僵死套件树的真实机器上，`in_use` 反映的是实际在消耗 CPU 的测试进程数，且一个新起的全量套件拿到宿主派生的车道数而非地板 1。fixture 与单测是必要不充分条件（DIR-026 Reading A）。

## Touches

- plugin/scripts/process-budget.sh
- plugin/test/resource-gate.test.mjs
- plugin/test/cap-from-gate-process-budget-path.test.mjs
- tasks/gap-process-budget-counts-hung-test-processes-as-in-use.md
