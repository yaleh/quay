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

## AC

- [ ] 正控：造 N 个**真正在跑**的 `node --test` worker（采样窗口内持续消耗 CPU），`process-budget.sh --json` 的 `in_use` **≥ N**（贴读数，⛔ 不是断言）。
- [ ] 本缺陷形态的边界正控：构造「刚 spawn、窗口内 0 CPU tick 但进程活着」的 worker ⇒ 它**不得**以 `no_cpu_delta` 被静默排除；输出必须给出一个与「hung」**可区分**的取值（如 `state:"starting"` / `reason:"unknown-cpu-delta"`），并在 `excluded[]` 之外可见。
- [ ] 负控：一个真的挂死进程（0 tick + 老年龄）仍被 `excluded[]` 排除且 `reason` 具名 —— 证明修法没有把排除轴整个删掉。
- [ ] `age_s` 是真实年龄：对任一被排除的 pid，`excluded[].age_s` 与 `/proc/<pid>/stat` starttime 的换算值一致；不可得时为 `null`。测试对 `age_s > 现代宿主 uptime` 这类值 fail-closed，⛔ 不得出现 4123168608。
- [ ] `in_use` 与 `node_cmdline_procs` 同时上报且二者的差值有具名解释（硬规则 3b：让「低两个数量级」在读数上可区分，而不是只把数字改大）。
- [ ] `bash scripts/test.sh --for-task gap-process-budget-in-use-undercounts-real-test-load --allow-thin` exit 0。
- [ ] 全量 `bash scripts/test.sh` 绿（由 driver 机械 fan-in 验证）（待外部）。

## DoD

生产读数上可验证，⛔ 不接受 fixture-alone：在同一台 128 vCPU / 246 GB 共享宿主的**真实高负载时刻**（`pgrep -f 'test-isolation=process'` 数十个 worker 同时在跑、`loadavg` 在百量级）复采一次 `process-budget.sh --json`，`in_use` 与实际活 worker 数同量级（不是 12 vs 45–66），且 `excluded[]` 中不再有活 worker；修复前后的两次读数逐字贴进任务体。另需证明消费者随之改变：`full-suite-runner` 派生出的 `--test-concurrency` 不再等于 nproc。单测与 fixture 是必要不充分条件（DIR-026 Reading A）。

## Touches

- plugin/scripts/process-budget.sh
- plugin/scripts/runner-concurrency.ts
- plugin/test/process-budget-liveness.test.mjs (new)
- plugin/test/resource-gate-s08.test.mjs
- tasks/gap-process-budget-in-use-undercounts-real-test-load.md
