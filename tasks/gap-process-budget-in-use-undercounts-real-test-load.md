---
id: gap-process-budget-in-use-undercounts-real-test-load
title: process-budget.sh 的 in_use 把真实 test workers 判成 no_cpu_delta，读数比实际低两个数量级
status: ready
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
---
## Finding

**实测（2026-11-06 17:00，宿主 128 vCPU / 246 GB，共享机）**：宿主 `loadavg` 158、`pgrep -f 'test-isolation=process'` = **45–66 个 worker** 的同一时刻，`bash plugin/scripts/process-budget.sh --json` 返回：

```json
{"total_budget":128,"in_use":12,"available":116,"verdict":"GO","node_cmdline_procs":1208,"excluded_count":14}
```

`excluded` 数组里装的是**活着的** `node --test ...` worker，`reason:"no_cpu_delta"` —— 单个 **1 秒**采样窗口对「阻塞在 I/O」或「刚 spawn 还没被调度」的 worker 读到 0 个 CPU tick，于是把它们当成不占预算的进程排除了。另一条 `excluded` 条目的 `"age_s": 4123168608`（离谱年龄，uptime/解析缺陷），说明该字段本身也不可信。

**后果**：每个套件都从 `max(1, floor((nproc − in_use) × oversub / S))` 派生车道数 ⇒ 「减去在用」这一项在这台机器上**从未减去任何东西**，套件实际拿到 64/92/111/125/127/128 条并发车道。

> 判读：这条缺陷的方向与历史上两条已修任务**相反**。`gap-process-budget-counts-hung-test-processes-as-in-use`（done）引入 CPU-tick 增量判别轴来**排除**挂死进程；本缺陷是那条轴的**假阴性半边** —— 一个真在跑、只是这一秒被 I/O 阻塞或刚启动的 worker 也会读到 0 tick，被静默归入「挂死」。硬规则 4 推论三/3b 的形态：读数看起来合理（12 < 128，verdict=GO），而它与「一切正常」同形。

### Proposed fix

- 让活性判别量鲁棒：采样窗口更长/自适应，或把「已 spawn 但尚未被调度」当作 in-use（一个**独立于 hung 的**「unknown / just-started」状态），使一棵活的 worker 树**结构上不可能**读成 0；
- 修 `age_s` 的离谱值（不可得时给 `null`，⛔ 不得给一个看似合理的巨大数）；
- 加 checker/test，带**正控**（一个真在忙的 worker 必须被计入）与**负控**（一个挂死的 worker 必须被排除）。

### Dedup / merge 决定

<!-- dedup-ref -->与 `gap-process-budget-counts-hung-test-processes-as-in-use`（done）与 `gap-process-budget-in-use-structurally-zero-never-throttles`（done）机制相邻但不同：前两者分别建立「排除挂死」轴与修「恒零」，本条修该轴的**假阴性**（活进程被判 `no_cpu_delta`），不是对它们的重新开工。按机制去重（`process-budget` / `in_use` / `no_cpu_delta`）在 todo/ready 池内命中均为 **0** ⇒ 无 open peer。merge-candidate：Touches 仅与上述两条 **done** 任务重叠，无 open 任务与本条抢同一批文件，故**独立立案**。

### 实现（本任务落地的两条独立半边）

1. **树活性（tree liveness）**：自身 0 tick 的候选，若其**后代**在窗口内烧了 CPU 就计入 `in_use`（采样的是**整张 /proc 进程表**，不只 node 进程 —— 树里挂一个 `bash` 子进程也算）。理由：`node --test` **runner** 阻塞在等子进程输出，自身 ~0 tick，但整棵树在干活。单独上报为 `live_by_descendant_cpu`。
2. **starting ≠ hung**：比观测窗口**更年轻**的候选不判 hung，而是进第三态 `unknown[]`（`reason:"unknown_cpu_delta"`）并**计入 `in_use`** —— 窗口还没观测够，不是「没跑」。hung 判定保留原条件（整窗 0 tick **且** 年龄大到窗口无法豁免），负控因此仍然成立。

`age_s` 改由 `/proc/<pid>/stat` 第 22 字段（starttime）+ `/proc/uptime` 换算（HZ 由 `getconf CLK_TCK` 读宿主，⛔ 不写字面量 100）；不可得即 `null`。原因：本机 procps-ng 4.0.4 的 `ps -o etimes=` 对普通短命进程返回 **4123168608**（≈130 年）——「看起来像读数、其实不是」。

## AC

- [x] 正控：造 N 个**真正在跑**的 `node --test` worker（采样窗口内持续消耗 CPU），`process-budget.sh --json` 的 `in_use` **≥ N**（贴读数，⛔ 不是断言）。
- [x] 本缺陷形态的边界正控：构造「刚 spawn、窗口内 0 CPU tick 但进程活着」的 worker ⇒ 它**不得**以 `no_cpu_delta` 被静默排除；输出必须给出一个与「hung」**可区分**的取值（如 `state:"starting"` / `reason:"unknown-cpu-delta"`），并在 `excluded[]` 之外可见。
- [x] 负控：一个真的挂死进程（0 tick + 老年龄）仍被 `excluded[]` 排除且 `reason` 具名 —— 证明修法没有把排除轴整个删掉。
- [x] `age_s` 是真实年龄：对任一被排除的 pid，`excluded[].age_s` 与 `/proc/<pid>/stat` starttime 的换算值一致；不可得时为 `null`。测试对 `age_s > 现代宿主 uptime` 这类值 fail-closed，⛔ 不得出现 4123168608。
- [x] `in_use` 与 `node_cmdline_procs` 同时上报且二者的差值有具名解释（硬规则 3b：让「低两个数量级」在读数上可区分，而不是只把数字改大）。
- [x] `bash scripts/test.sh --for-task gap-process-budget-in-use-undercounts-real-test-load --allow-thin` exit 0。
- [x] 全量 `bash scripts/test.sh` 绿（由 driver 机械 fan-in 验证）—— 本行勾选 = 交由 fan-in 机械判定；suite 红则本任务不得翻 done。

## DoD

生产读数上可验证，⛔ 不接受 fixture-alone：在同一台 128 vCPU / 246 GB 共享宿主的**真实高负载时刻**（`pgrep -f 'test-isolation=process'` 数十个 worker 同时在跑、`loadavg` 在百量级）复采一次 `process-budget.sh --json`，`in_use` 与实际活 worker 数同量级（不是 12 vs 45–66），且 `excluded[]` 中不再有活 worker；修复前后的两次读数逐字贴进任务体。另需证明消费者随之改变：`full-suite-runner` 派生出的 `--test-concurrency` 不再等于 nproc。单测与 fixture 是必要不充分条件（DIR-026 Reading A）。

### Evidence（生产读数，逐字）

**同一瞬间（2026-11-06，宿主 128 vCPU，共享机；修复前后两个脚本【并发】执行 ⇒ 同一负载时刻）**

```
loadavg at sample: 32.57 36.71 70.84 203/34574 1866674
pgrep -cf test-isolation=process: 120
pgrep -cf 'node --test': 137
nproc: 128
```

修复前（`git show develop:plugin/scripts/process-budget.sh`，逐字）：

```json
{"total_budget": 128, "in_use": 106, "available": 22, "verdict": "GO", "node_cmdline_procs": 1362, "excluded_count": 41}
```

修复后（本分支 `plugin/scripts/process-budget.sh --json`，逐字）：

```json
{"total_budget": 128, "in_use": 112, "available": 16, "verdict": "GO", "node_cmdline_procs": 1353, "excluded_count": 35, "unknown_count": 0, "classified_test_candidates": 147, "infra_node_procs": 1206, "live_by_self_cpu": 104, "live_by_descendant_cpu": 8}
```

`count_accounting`: `evaluated=true`、`node_cmdline_procs_equals_infra_plus_candidates=true`、`candidates_equal_live_plus_unknown_plus_excluded=true`。

**「excluded[] 里还有没有活的 worker」—— 独立探针（不依赖脚本自报，直接读 /proc CPU 计数）**

取各自 `excluded[]` 中 `reason:"no_cpu_delta"` 的全部 pid，在其被排除之后连续 5 秒读 `/proc/<pid>/stat` 的 utime+stime：

```
old: no_cpu_delta exclusions=18  still-alive=11  ALIVE-AND-BURNING-OVER-5s=7
   old: pid=1814764 ticks+=1/5s   node --test-coverage-functions=0 --test-concurrency=…
   old: pid=1814880 ticks+=2/5s   …
   old: pid=1864383 ticks+=2/5s   …
   old: pid=1864546 ticks+=2/5s   …
   old: pid=1865437 ticks+=7/5s    …
   old: pid=1866454 ticks+=10/5s  …
   old: pid=1869926 ticks+=2/5s   …
new: no_cpu_delta exclusions=6   still-alive=3   ALIVE-AND-BURNING-OVER-5s=0
```

即：修复前把 **7 个仍在消耗 CPU 的活 worker** 判成「挂死」并排除；修复后同一探针在 `excluded[]` 里找到 **0 个**仍在烧 CPU 的进程。（第二次同形采样：old 18 排除 / 9 alive-and-burning，new 0 alive-and-burning。）

**消费者随之改变（`full-suite-runner` → `--test-concurrency`）**

另一时刻（`loadavg: 58.10 43.25 71.97`、`test-isolation=process` worker = 35）读到的 `in_use=27`、`node_cmdline_procs=1228`：

```json
{
 "nproc": 128,
 "post_fix_reading": { "in_use": 27, "node_cmdline_procs": 1228 },
 "with_real_reading": { "lane": 99, "direct": 105 },
 "with_in_use_pinned_0": { "lane": 128, "direct": 128 }
}
```

⇒ `defaultLaneCount()` / `defaultTestConcurrency()` 不再是 nproc（128），而是 99 / 105 —— 「减去在用」这一项现在真的在减。

**AC1–AC5 的直接读数**（`plugin/test/process-budget-liveness.test.mjs`，真进程、非 fixture）

- AC1 正控：3 个真在烧 CPU 的 `node --test`-shaped worker ⇒ `in_use ≥ 3`（同一测试内逐个确认三个 pid 都不在 `excluded[]`/`unknown[]`）。
- AC2 边界正控：刚初始化完、整窗 0 tick 的活 worker ⇒ `unknown[]` 命中 `{"pid":3830594,"age_s":0,"cpu_delta_ticks":0,"reason":"unknown_cpu_delta"}`，`in_use=3`（含它），**不在** `excluded[]`。
- AC3 负控：0 tick + 老年龄 ⇒ `excluded[]` 命中 `{"pid":3835684,"age_s":2,"cpu_delta_ticks":0,"reason":"no_cpu_delta"}`，`unknown_count=0`。
- AC3b 树活性：自身窗口内 0 tick、但有烧 CPU 子进程的 runner ⇒ 计入，且测试独立读 `/proc` 证明该 runner 自身 tick 增量 = 0（⇒ 只可能是被后代轴计入）。
- AC4 年龄：`excluded[].age_s` 落在「读数前后两次 `/proc` starttime 换算值」区间内；全部 `excluded`/`unknown` 条目的 `age_s` 均为 `null` 或 `≤ 宿主 uptime`（宿主 uptime ≈ 4501607 s）；源码层断言 `-o etimes=` 已从代码中消失。
- AC5 具名分解：`node_cmdline_procs = infra_node_procs + classified_test_candidates` 且 `classified_test_candidates = live_by_self_cpu + live_by_descendant_cpu + unknown_count + excluded_count`，`count_accounting.evaluated=true`；一旦某个 term 被 seam 钉死 ⇒ `evaluated=false` 且两个恒等式读数均为 `null`（⛔ 不与「通过」同形）。

**ADR-007 暗轴**

- L_D archguard package-cycles: cycles=0 maxScc=1 (evaluated=true, projectRoot=/data/home/yale/work/quay, snapshot 2026-11-06T06:59Z 略早于 HEAD；本改动为 bash 脚本 + 测试，未新增模块依赖边)
- 该轴仍暗,理由:L_G（god-package / duplicated-abstraction 的语义读数）本次未取，改动不引入新模块与跨包依赖

## Touches

- plugin/scripts/process-budget.sh
- plugin/scripts/runner-concurrency.ts
- plugin/test/process-budget-liveness.test.mjs (new)
- plugin/test/resource-gate-s08.test.mjs
- tasks/gap-process-budget-in-use-undercounts-real-test-load.md
