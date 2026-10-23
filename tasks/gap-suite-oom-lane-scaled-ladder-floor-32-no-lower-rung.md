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

- [ ] AC1 真实载体读数：一条 hub 形态任务的 fan-in 轮在「声明 memory_max 不变」的前提下
  `oomKill=0` 且写出 `SUITE-PLAN … completeness=complete`（贴逐字日志行与文件路径）。
- [ ] AC2 判据能取假：把并发夹子抬回 32，同一条判据必须转红（`SUITE-INCOMPLETE reason=oom-killed`）；
  压回新值再转绿。⛔ 两条读数都要贴文件路径与逐字行。
- [ ] AC3 阶梯不再有「同形档位」：对同一棵受测树，相邻两档的 `concurrency.maxConcurrentOverall`
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

## Touches

- `plugin/scripts/worker-fan-in.ts`
- `.quay/config.yml`
- `plugin/test/worker-fan-in.test.mjs`
- `tasks/gap-suite-oom-lane-scaled-ladder-floor-32-no-lower-rung.md`
