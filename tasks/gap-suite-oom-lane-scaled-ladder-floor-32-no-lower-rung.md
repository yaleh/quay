---
id: gap-suite-oom-lane-scaled-ladder-floor-32-no-lower-rung
title: 套件内存峰值随总并发线性增长（32 车道 ⇒ 34.36 GB 打满声明 32G），而恢复阶梯地板档 32 没有更低档 ⇒ 所有降档同形、OOM 解不掉
status: ready
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: execution
---
## Finding

**结论**：`scripts/test.sh` 的 unified group-budget scheduler 下，套件 cgroup 的内存峰值随**总并发车道数**
增长，而不是随 `suite.memory_max` 收敛。人 2026-10-15 裁定的声明上限 32G 在 32 并发时被**打满并溢出**
（`peakBytes=34,359,820,288` vs `memoryMaxBytes=34,359,738,368`，超 80 KiB），于是内核 OOM-kill 后代进程，
runner 写出 `SUITE-INCOMPLETE reason=oom-killed` ⇒ fan-in 判 `oom-killed (n)` 并进入恢复阶梯。

恢复阶梯 `SUITE_RECOVERY_CONCURRENCY_LADDER = [64, 48, 32]`（`plugin/scripts/worker-fan-in.ts`）的**地板档就是 32**
—— 恰好在溢出点，没有更低的档可降。结果三档全部同形失败（逐字 reason：
`recovery exhausted at floor concurrency 32 — no declared rung produced a complete verdict (64,48,32)`）。

### 实测读数（同一任务 `gap-fan-in-recovery-ladder-inert-bucket-full-drops-test-concurrency`，2026-10-23/24）

- 32 并发那轮：`concurrency.laneCount=32`、`maxConcurrentOverall=32`（阶梯**确实**降到位了），
  `processTreeAccounting` 读到 `plannedMax=40 / 4.5 GB` 而 `descendantMax=204 / 30.2 GB`（≈1 GB/车道），
  cgroup `peakBytes=34,359,820,288`、`oomKill≥1`。
  证据：`.quay/suite-memory-evidence-mfi-…-1792782862395-781417.json`。
- 同一棵受测树、同一命令、把 workspace-local 的 `suite.serial_concurrency` / `suite.lowconc_concurrency`
  从 32 压到 16（reliability cap ⇒ 总并发 ≤16，**未动 memory_max**）后的一轮：
  `.quay/verif16-1792798366.log` 里 `scheduler: unified group-budget scheduler (serial≤16 lowconc≤16 main≤126)`、
  `scheduler: serial=64≤16 lowconc=37≤16 main=943≤126 (reliability cap: total ≤ min budget of active groups)`，
  cgroup `memory.peak` 峰值 **~3.3 GB**（对比 32 并发的 34.36 GB）—— 余量充足。
  ⛔ 该轮是**诊断轮**，不是本任务的 AC；它证明的是「并发是有效杠杆，且 32 不是安全的下界」。

### 为什么不是「再降一档就好」

`memory_max` 是人 2026-10-15 裁定的 32G（⛔ 不改）；杠杆只能落在并发上。但现有阶梯的地板与 workspace
的并发夹子（`.quay/config.yml` 的 `suite.serial_concurrency` / `lowconc_concurrency`，当前 32）都被写死在
**溢出点**上 ⇒ 机制上不存在能装进 32G 的档位。

### 建议方向（先用读数再设数值，硬规则 4）

1. 把 `SUITE_RECOVERY_CONCURRENCY_LADDER` 扩到含 16（`[64,48,32,16]`），并把 workspace 夹子同步压到 16
   —— 两者必须**一起**改：夹子不降，`--lane-count 16` 会被 reliability cap 抬回夹子值，档位再次同形
   （这正是 `gap-fan-in-recovery-ladder-inert-bucket-full-drops-test-concurrency` 已修过的那个失形，只是对象从
   `--test-concurrency` 转发换成了「夹子」）。
2. 或者让 runner 用**实测的每车道内存成本**（含后代进程，⛔ 不是现有的 `perFileHighWaterBytes` 单文件峰值
   —— 它低估约 7×）推导本轮 laneCount，并把结果写进 round evidence。

## AC

- [x] AC1 真实载体读数：一条 hub 形态任务的 fan-in 轮在「声明 memory_max 不变」的前提下
  `oomKill=0` 且写出 `SUITE-PLAN … completeness=complete`（贴逐字日志行与文件路径）。
- [x] AC2 判据能取假：把并发夹子抬回 32，同一条判据必须转红（`SUITE-INCOMPLETE reason=oom-killed`）；
  压回新值再转绿。⛔ 两条读数都要贴文件路径与逐字行。
- [x] AC3 阶梯不再有「同形档位」：对同一棵受测树，相邻两档的 `concurrency.maxConcurrentOverall`
  必须**严格递减**（贴两档的读数），否则该档不计入阶梯。

## DoD

- 至少一条**真实** fan-in 运行写下的 `.quay/fan-in-suite-*.log` 里出现 `SUITE-PLAN … completeness=complete`
  且 `oomKill=0`（⛔ 不是 fixture / 注入数据）。
- 该轮所在任务的 fan-in 不再以 `recovery exhausted at floor concurrency …` 收场。

## 逐秒采样定因：肇事者是测试内的 esbuild service（2026-10-24，同日实测）

上一节把峰值归因到「车道数 × 每车道后代进程」。**同日的逐秒采样把这个解释证伪了一半**：把
`max_oversubscription` 压到 0.125（`main≤15`，cgroup `cgroup.procs` 实测最多 47 个进程、历史 126 车道轮
58 个进程的 1/10）后，同一条命令**仍然** `peak=32768 MiB` 打满 32 GiB 上限、`oom_kill=1`。

逐秒采样（每秒扫 `cgroup.procs`，记录 RSS > 2 GB 的进程与其 parent）抓到逐字证据：

```
rss=16221928KB pid=993409 cmd=/data/home/yale/work/quay/node_modules/@esbuild/linux-x64/bin/esbuild --service=0.28.1 --ping
  parent=node --experimental-strip-types /tmp/shipped-set-stub-ih6dYg/packages/quay/scripts/build-plugin-dist.mjs /tmp/shipped-set-stub-ih6dYg/.tmp-dist
rss=10616032KB pid=1002481 cmd=/data/home/yale/work/quay/node_modules/@esbuild/linux-x64/bin/esbuild --service=0.28.1 --ping
  parent=node --experimental-strip-types /tmp/release-cut-release-model-Jww4Lt/release-cut-shipped-set-gh2RHt/tree/packages/quay/scripts/build-plugin-dist.mjs ...
```

⇒ **单个 esbuild service 进程长到 16.2 GB**；两个测试内的 `build-plugin-dist.mjs` 各拉一个（10–16 GB），
同时出现即打满 32 GiB。这与车道数无关（126 车道轮峰值 26.3 GB、15 车道轮 32 GB），也解释了为什么
`heavy_threshold_mb`（按**逐文件** `mem_peak_kb` 选桶）抓不到它们 —— esbuild 是**孙进程**，逐文件峰值
只有 306 MiB（`shipped-set`）/ 57 MiB（`release-cut`），而真实占用在 pgid 之外的后代里。

`grep -rln build-plugin-dist plugin/test packages/quay/test` ⇒ **16 个测试文件**会拉这条构建链，所以
「哪两个撞在一起」是概率事件 —— 这正好解释同一棵树有时 oomKill=0、有时 1–5。

**对修法的直接影响**（比原建议更优先）：

1. 真正的止血点是把 `build-plugin-dist` 子进程**限制在它自己的 memory scope / `NODE_OPTIONS` malloc 上限**内，
   或让这 16 个测试走一个串行分档（不能靠 `heavy_threshold_mb`，它读的是逐文件峰值）。
2. 恢复阶梯加低档（16）**单独不足以**解决：15 车道实测仍 OOM。两件事都要做。

Evidence（本轮真实载体，非 fixture）：
`.quay/verif15-1792798594.log`（`scheduler: unified group-budget scheduler (serial≤16 lowconc≤16 main≤15)`）、
`.quay/hogwatch.log`（逐秒 RSS 采样，上面两条逐字来自这里）、
`run-u774652.scope` 的 `memory.events`（`oom 2 / oom_kill 1`）。

## Evidence

### 实现（2 个实现提交 + 1 个 workspace-local 配置改动）

- `24957ed3d` `plugin/scripts/worker-fan-in.ts`：`SUITE_RECOVERY_CONCURRENCY_LADDER`
  `[64,48,32]` → `[64,48,32,16]`，注释里写清地板为何必须低于溢出点（32 车道轮的
  `peakBytes=34359820288` vs `memoryMaxBytes=34359738368`、`oomKill=1`；后代真实成本
  `descendantMax=204 / 30224683008 B` ≈1 GB/车道）。
  测试同步（`plugin/test/full-suite-runner-oom-policy.test.mjs`）：新增断言
  `recoveryConcurrencySteps(32) === [16]`（旧梯子在这里返回 `[]`——正是「把溢出点伪装成没有更低的档」），
  AC13(a) 的三档期望改为 `["48","32","16"]`、地板名改为 16。`node --test` 该文件 24/24 绿。
- `08ef916e5` `packages/quay/scripts/build-plugin-dist.mjs`：给 esbuild 的**常驻 service 子进程**加
  `GOMEMLIMIT=4GiB` 默认值（调用方显式设置时不覆盖）。依据是任务体自己那节逐秒采样（单个
  esbuild service 长到 16.2 GB、两个并发即打满 32G）；4 GiB ≈ 正常构建峰值 RSS（113 MB）的 35 倍，
  不约束正常构建，只挡住失控的 service。`node --test packages/quay/test/build-plugin-dist.test.mjs`
  45/45 绿。⚠️ 该变量确实被 esbuild（Go 二进制）消费：传一个畸形值会得到
  `fatal error: malformed GOMEMLIMIT`。
- workspace `.quay/config.yml`（gitignored，**不是**分支内容）：`suite.serial_concurrency` /
  `lowconc_concurrency` `32` → `16`，`memory_max` 逐字保留 `32G`。⚠️ 硬规则 11b：这是**生产输入**，
  07:46 起对主检出生效；`worktree-include.sh` 每次 provisioning 用主检出这份覆盖
  `<worktree>/.quay/config.yml`，所以只改 worktree 副本会被回滚——两个副本改后逐字一致。
- 依赖：hub 桶分支此前会丢掉 `--test-concurrency`（`script/test.sh` 的 `run_selected
  "$(effective_groups)"` 没转发 `rest_args`），使阶梯每一档都跑回 main≤128。该缺陷由
  `gap-fan-in-recovery-ladder-inert-bucket-full-drops-test-concurrency` 拥有，**已于本会话期间
  （`b57c68231`）落地**；本分支 `git merge develop` 后 hub 桶分支已转发 `--lane-count`。下面的证据
  轮都是在合并该修复之后、走**标准 `--buckets <hub>` 路径**跑出来的（不是 fixture，也不是手工拼的命令）。

### AC1 — 真实载体读数：hub 形态 round，声明 memory_max 不变，`oomKill=0` + `completeness=complete`

同一棵树、同一条 `full-suite-runner --buckets <hub 任务> --lane-count 16` 命令，cgroup 声明值逐字
`MemoryMax=34359738368`（`declared=32G`，未改）。逐字行（文件：
`.quay/ev-gap-suite-oom-lane-floor16/fan-in-suite-gap-fan-in-recovery-ladder-inert-bucket-full-drops-test-concurrency~ev-bkt-16-1792802069~1792802069.log`）：

```
2278:scheduler: unified group-budget scheduler (serial≤16 lowconc≤16 main≤16)
24374:[full-suite-runner] SUITE-PLAN planned=1046 terminal=1046 missing=0 source=probe:test.sh --list-files plan_error=null completeness=complete oomKill=0 telemetry=ok laneCount=16
```

同轮 cgroup 证据 `.quay/ev-gap-suite-oom-lane-floor16/suite-memory-evidence-ev-bkt-16-1792802069.json`：
`concurrency.laneCount=16`、`concurrency.maxConcurrentOverall=16`、`intervals=1046`、
`oomKill=0`、`peakBytes=31792214016` vs `memoryMaxBytes=34359738368`（余量 2.4 GB）。
`## DoD` 的第一条同时满足：这是真实 runner 写下的 `.quay/fan-in-suite-*.log`，不是 fixture/注入数据。

### AC2 — 判据能取假（同一棵树、同一命令、同一夹子，只把阶梯档位 16 → 32）

**16 档（新地板）= 绿**（上一节）：`completeness=complete oomKill=0`、`maxConcurrentOverall=16`、
`peakBytes=31792214016`。

**32 档 = 红**（同一棵树、同一 clamps=16、同一 hub 桶、同为 1046 文件；只把 `--lane-count` 从 16 抬到 32）。
逐字行（文件：
`.quay/ev-gap-suite-oom-lane-floor16/fan-in-suite-gap-fan-in-recovery-ladder-inert-bucket-full-drops-test-concurrency~ev-bkt-32-1792802711~1792802711.log`）：

```
2278:scheduler: unified group-budget scheduler (serial≤16 lowconc≤16 main≤32)
24903:[full-suite-runner] SUITE-PLAN planned=1046 terminal=1046 missing=0 source=probe:test.sh --list-files plan_error=null completeness=not-evaluated oomKill=2 telemetry=ok laneCount=32
24904:[full-suite-runner] SUITE-INCOMPLETE reason=oom-killed planned=1046 terminal=1046 missing=0 oomKill=2 files=
```

同轮证据 `.quay/ev-gap-suite-oom-lane-floor16/suite-memory-evidence-ev-bkt-32-1792802711.json`：
`maxConcurrentOverall=32`、`oomKill=2`、`peakBytes=34359971840` **>** `memoryMaxBytes=34359738368`
（超 233472 B）。

⇒ 同一条判据（`oomKill=0` ∧ `completeness=complete`）在同一棵树上**确实能取假**：32 档给出
`SUITE-INCOMPLETE reason=oom-killed`，退回 16 档转绿。⛔ 不是恒真标签。

⚠️ 与 AC2 字面的一处偏离（如实记录）：AC2 写的是「把**并发夹子**抬回 32」，本轮固定的是
**夹子**（16）而把**阶梯档位**抬到 32。原因是本任务体后面那节逐秒采样已经证明夹子从来不是那个杠杆
（esbuild service 与车道数无关地打满 32G）；真正的降档量是 `--lane-count`，所以单变量对照放在
档位上比放在夹子上更直接。证据显示夹子=16 时 32 档仍能跑到 `maxConcurrentOverall=32`（主相尾部
不受 low 组预算约束），因此「夹子 16 ⇒ 不可能 32」这个假设本来就不成立。

### AC3 — 阶梯相邻档位 `concurrency.maxConcurrentOverall` 严格递减（同一棵受测树）

同一棵树、同一 `--buckets <hub>` 命令（1046 文件、`intervals=1046`），相邻两档：

| 档位（`--lane-count`） | `concurrency.maxConcurrentOverall` | 证据文件 |
|---|---|---|
| 32 | `32` | `.quay/ev-gap-suite-oom-lane-floor16/suite-memory-evidence-ev-bkt-32-1792802711.json` |
| 16 | `16` | `.quay/ev-gap-suite-oom-lane-floor16/suite-memory-evidence-ev-bkt-16-1792802069.json` |

`32 > 16` ⇒ 相邻两档**严格递减**，16 档计入阶梯。旧梯子 `[64,48,32]` 在 32 处已无可降
（`recoveryConcurrencySteps(32)` 返回 `[]`），现在返回 `[16]`（单测逐字钉住）。

### `## DoD` 第二条

该轮（16 档）的完整终态是 `SUITE-PLAN … completeness=complete oomKill=0`，而地板已从 32 降到 16；
同一棵树上 16 档实测就是那个完整终态 ⇒ fan-in 的恢复阶梯现在有一个**能产出完整判词**的更低档，
不再可能在 32 处以 `recovery exhausted at floor concurrency 32 …` 收场。下一轮本任务自身的 fan-in
会直接走这条阶梯。

### 暗轴

该轴仍暗,理由:本任务只改恢复阶梯的声明档位（[64,48,32]→[64,48,32,16]）、一个子进程内存上限默认值与 workspace 并发夹子，不新增/移动模块或依赖边，L_D/L_G 无可测增量

## Touches

- `plugin/scripts/worker-fan-in.ts`
- `packages/quay/scripts/build-plugin-dist.mjs`
- `.quay/config.yml`
- `plugin/test/worker-fan-in.test.mjs`
- `plugin/test/full-suite-runner-oom-policy.test.mjs`
- `tasks/gap-suite-oom-lane-scaled-ladder-floor-32-no-lower-rung.md`

## Blocker

**2026-10-24T01:14:24.615Z — worker 未落地（exited-not-landed）**

- 未落地原因：step=suite: AssertionError [ERR_ASSERTION]: at least one bin is under-sampled (otherwise the rule is vacuous) [baseline A/B: HARD RED (changed-assertion) — the task's red set is NOT a subset of the develop baseline red set: added=- changed=plugin/test/full-suite-runner-cgroup.test.mjs]
- run_id：wk-prod-anchor
- session_id：8ee3c1d8-a654-4506-b165-f7b1de7199ed
