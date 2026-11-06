---
id: gap-suite-default-oversubscription-assumes-dedicated-host
title: suite 默认 max_oversubscription=1 假设独占宿主：每个新项目默认按 nproc 开满车道
status: ready
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
---
## Finding

**实测（2026-11-06，128 vCPU / 246 GB 共享机，全机读数来自 bpftrace 与 /proc）**：

派生式是 `max(1, floor((nproc − in_use) × oversub / S))`，其中 `oversub`（`max_oversubscription`）默认 **1**、`S`（`max_concurrent_suites`）默认 **1** ⇒ 单套件在这台机器上**被授权约 128 条车道**。

同一台机器上：**25 个 anchor 分布在 21 个项目根、8 个用户**。没有 `suite:` 段的 workspace（claudecodeui、cantus、archguard、meta-cc、plantuml-js、quay-fleet）**全部跑在默认值**上，于是同时出现 `--test-concurrency=92 / 111 / 125 / 127 / 128` 的套件；`loadavg` 103 → 171 → 158；单个套件域的峰值 **65.7 核 / 1,093 个进程**；14:02–16:53 之间 **88 次 cgroup OOM kill**（受害者：node workers、python3、esbuild、chrome）。

关键一点：每个 repo 的 suite 锁（`suite-lock-slots.ts`）明确是 **PER-REPO** 的 —— 所以**没有任何宿主级预约**。默认值的语义是「这台机器全是我的」，而真实语义是「我与另外 20 个项目根共享这台机器」。

> 判读：这不是某个 workspace 配置错了，而是**默认值本身假设了独占**。修某个项目的 `.quay/config.yml` 只能治一个项目，且该文件未受版本控制、换机即回退 —— 判据必须落在**默认值**上。

### Proposed fix（需要人裁定形状）

三个候选，⛔ 不要由执行者自行挑一个实现：

1. 让**默认值**反映「宿主的一份」而非「整台宿主」——例如读一个宿主级声明的项目数/份额（**读宿主，不写字面量**），或
2. 在 init 模板里就带上 `suite:` 段，使**新 workspace 一出生就被限流**；或
3. 在封闭 schema 里加一个显式的 `test_concurrency` 上限键（今天这个上限只能借 `oversub` 乘数**间接**表达，语义错位）。

第 3 条与 `gap-concurrency-literal-only-at-definition-points`（done）确立的「并发值只在唯一定义点出现、其余派生」纪律相符，但会新增一个键，须人确认。

### Dedup / merge 决定

<!-- dedup-ref -->与 `gap-suite-budget-oversubscribe`（done）机制相邻但不同：那条修的是**公式形状**（`Σ lane ≤ nproc × oversub` 不变式、三条推导都读旋钮②），前提是同一 workspace 内的并发套件数 `S`；本条问的是**默认值本身**（`oversub=1`、`S=1`）在**多 workspace / 多用户共享宿主**上的语义，per-repo 锁管不到这个维度。按机制去重（`oversubscription` / `max_oversubscription` / `defaultLaneCount` / 宿主份额）在 todo/ready 池内命中仅为 **0**（`defaultLaneCount` / `oversubscription` 的命中全为 done） ⇒ 无 open peer；merge-candidate 无 open 任务声明 `suite-params.ts` / `runner-concurrency.ts` ⇒ **独立立案**。

## AC

- [ ] 人先裁定修法形状（上面三条中的一条，或第四条），并把裁定逐字记入本任务体；⛔ 执行者不得自行选择实现方向（待外部）。
- [ ] 新初始化的 workspace 得到**有界**默认：`quay init` 之后（或按裁定等价路径）派生的 `--test-concurrency` **严格小于** `os.availableParallelism()`（两个数都贴出来）。
- [ ] 默认值是**宿主派生**的：该值的产生处 grep 不到机器规格字面量（128 / 64 / 16 …），且改动宿主读数（seam）会改变派生值。
- [ ] 老 workspace 同受约束（负控）：**没有** `suite:` 段的 workspace 跑同一默认，⛔ 不是只对 init 新项目生效。
- [ ] 显式上限端到端可见：按裁定设置上限 V ⇒ 被 spawn 的测试进程命令行逐字含 `--test-concurrency=V`，且**不随 nproc 变化**（seam 里改 nproc 读数 ⇒ V 不变）。
- [ ] 不误伤单套件：单 workspace 单套件时仍能用满有界默认允许的车道（⛔ 修复不得把一切压到 1 车道）。
- [ ] `bash scripts/test.sh --for-task gap-suite-default-oversubscription-assumes-dedicated-host --allow-thin` exit 0。
- [ ] 全量 `bash scripts/test.sh` 绿（由 driver 机械 fan-in 验证）（待外部）。

## DoD

在**多项目共享**的真实宿主上（≥5 个项目根、≥2 个套件可能同时起）跑一轮默认配置的套件，贴出：① 被 spawn 的 `--test-concurrency=` 逐字值；② 该轮 `loadavg` 与本套件域的核/进程读数。判据是**默认**不再等于「按 nproc 开满」，⛔ 不是「某个项目被手工写了个小值」；只改 init 模板而老 workspace 仍走 nproc 也不算（负控 AC 会红）。fixture 与单测必要不充分（DIR-026 Reading A）。

## Touches

- plugin/scripts/suite-params.ts
- plugin/scripts/runner-concurrency.ts
- plugin/scripts/full-suite-runner.ts
- plugin/scripts/quay-init.sh
- plugin/test/suite-params.test.mjs
- plugin/test/suite-default-host-share.test.mjs (new)
- tasks/gap-suite-default-oversubscription-assumes-dedicated-host.md

> Touches 里 `quay-init.sh` 是 init 侧的落点；若裁定走「init 模板带 `suite:` 段」而模板实际在别处（skill 模板 / provider 维护代码），执行器按实情把真实路径补进本节并留痕。
