---
id: gap-systemd-run-cancel-cpuquota-keep-memory-guardrail
title: "人的裁定：取消 CPU 配额、保持内存配额——CPUQuota=400%（measure-first 后落实现）、MemoryMax=4G 不动（OOM 护栏）、TasksMax=200 不动；8 并发差是配额所致非 lane8 本身；r268 两个超时形失败归因配额；先在新配额下跑 lane4 新基线再重做 lane4 vs lane8 对照"
status: todo
labels:
  - gap
  - defect
  - performance
parent: null
children: []
extra: {}
---
**type:** execution

## Proposal

**人的裁定（2026-08-11 06:4xZ，逐字）：「那就取消 CPU 配额，保持内存配额。」**——覆盖 manager 06:41 的建议（其中 MemoryMax 提高至 8G/10G 的部分被否决）。最初指令（06:3xZ）：「取消这一硬配额。并进一步分析之前 8 并发表现不好是否是受此影响。」落点：分析写 Finding/Proposal，**不进 Contract**（manager 明确指示）。

### 执行入口（manager 读实现后给形式）

`plugin/scripts/full-suite-runner.ts:753` `DEFAULT_SYSTEMD_RUN_LIMITS = { memoryMax: "4G", cpuQuota: "200%", tasksMax: "200" }`；覆盖入口 `QUAY_TEST_SYSTEMD_RUN_LIMITS`（空格分隔 `Key=Value`，只认 MemoryMax/CPUQuota/TasksMax 三键，:760-772）；`QUAY_TEST_SYSTEMD_RUN_AVAILABLE=0` 可整体绕过 systemd-run 但实现注释 :784 标明是**测试接缝（for hermetic tests）**，不是生产开关——不用它实现本次变更。

### 实测复核（outer 2026-08-11 06:4x，C6）

套件真实作用域 `.../app.slice/run-p*.scope` = **cpu.max 200000/100000（2 核）、memory.max 4294967296（4 GiB）、pids.max 200**；机器 4 物理核 ⇒ 套件被限一半。resource-gate 判 nproc=2 由此而来（真限制非假门）。

### 执行形式（manager 06:4x 给出，三项分别处理、别一刀切）

- **CPUQuota：取消**。本机 4 物理核 ⇒ 等价形式 `CPUQuota=400%`（用满全部物理核，最省事、可立即测），或在实现里不再传 `-p CPUQuota=`（更彻底、持久修法）。**建议先用前者做 measure-first 对照，确认收益后再落实现**。
- **MemoryMax：保持 4G 不变**。人明确要求保留——它是 01:07 整机 OOM 之后的护栏，别动。
- **TasksMax：保持 200 不变**。人未提及。若后续 nested-spawn 类测试高并发下撞上它（pids.max 满表现为 spawn 失败而非变慢），再单独立案。

**最省事一步（无代码改动、立即可测）**：起下一轮带 `QUAY_TEST_SYSTEMD_RUN_LIMITS="MemoryMax=4G CPUQuota=400% TasksMax=200"`，其余参数与上一轮完全相同、同 commit。收尾记三 `*_phase_ms` + cancelled + 逐文件 `__PERFILE__`，与 r266 基线（serial 640s / lowconc 272s / main 650s / 合计 1533s / cancelled 0）对照。
**预期（理论外推、非数据推论）**：CPU 项与核数成反比 ⇒ main 636s → 约 385s、整轮约 1533s → 约 1050s。**若实测明显偏离 ⇒ 「79% CPU 占比」反解有问题——那也是有价值的读数，别当失败。**

### 风险提示（manager，与指令一起判断，最终取舍人的裁定）

`MemoryMax=4G` 是今晚 01:07 **整机 OOM**（manager 会话被 global_oom 杀、cron 幸存）后立的护栏，立案 `gap-systemd-run-limits-for-suite-and-heavy-ops`，实现注释「由内核强制、不会被忘记调用」。⇒ 人已裁定：**取消 CPU 配额（纯收益）、保持内存配额**（OOM 护栏）。**这条同时把 lane4 vs lane8 对照往后排**：先在新配额下拿 lane4 新基线，再谈 lane8 是否值得（r268 两个超时形失败归因 2 核配额下每进程 0.25 核，非 lane8 本身）。

### 8 并发差是否受配额影响（manager 量化）——**是**

- **现状每文件模型**由 r266/r268 两点解出 `nW=543 文件秒(等待) / nC/K=500 核秒/核`。**K 从这两点不可辨识**（只把 nC 等比缩放），真测到的是聚合量 `nC/K=500s` ⇒ 「取消配额后地板 250s」是**理论外推**（CPU 项与核数成反比）**非数据推论**——如实标注。
- **逐文件推算稳**：`cli.test.mjs` 实测 lane4/2核 = 115.7s passed、lane8/2核 = 192.8s FAILED（单条断言 60134ms 撞 60s 窗），两点解出该文件 W=38.6s / C=38.6s；**核数翻倍 ⇒ lane8 下 ≈ 116s = 它今天 lane4 的耗时（passed）**。
- **机制**：lane8 在 2 核配额下每进程只分 **0.25 核**；4 核下分 **0.5 核** = 今天 lane4 每进程份额。⇒ **r268 两个超时形失败归因配额，不归因 lane8 本身**。

### 修正 manager 03:3x 结论

「lane8 在这台 4 核机上不是杠杆、916b1feb 降 nproc 没错」——**前半句前提（4 核）错了**。正确：**2 核配额下 lane8 必然撞窗；配额取消后 lane8 是否值得需重测**。建议顺序：先取消配额跑一轮 lane4 拿新基线（纯配置变更、成本最低提速），再在新基线上重做 lane4 vs lane8 对照。

### 验证锚

修后 (a) 套件作用域 cpu.max=400000/100000（或不再传 `-p CPUQuota=`）、MemoryMax=4G 不变、TasksMax=200 不变；(b) 同 commit 对照（覆盖 QUAY_TEST_SYSTEMD_RUN_LIMITS="MemoryMax=4G CPUQuota=400% TasksMax=200"，其余不变）比三 `*_phase_ms` 与 cancelled；(c) `--for-task` scoped 门绿；(d) 不回归。

## Acceptance Criteria

- [ ] AC1: **复现固化**——任务体记录人的裁定逐字（取消 CPU 配额、保持内存配额）+ 执行入口（:753 DEFAULT + QUAY_TEST_SYSTEMD_RUN_LIMITS 三键 + :784 测试接缝非生产开关）+ outer C6 实测（cpu.max 200000/100000、mem 4GiB、pids 200、机器 4 核）（本任务 Proposal 已含）
- [ ] AC2: **取消 CPU 配额**——CPUQuota=400%（measure-first 用满 4 物理核），MemoryMax=4G 保持、TasksMax=200 保持
- [ ] AC3: **同 commit 对照**——`QUAY_TEST_SYSTEMD_RUN_LIMITS="MemoryMax=4G CPUQuota=400% TasksMax=200"` 跑一轮 lane4，贴新基线三 `*_phase_ms` + cancelled，与 r266（serial 640/lowconc 272/main 650/合计 1533/cancelled 0）对照
- [ ] AC4: **lane8 重测**——新基线上重做 lane4 vs lane8 对照，判定 lane8 是否值得（2 核配额取消后）
- [ ] AC5: **既有不回归**——`--for-task` scoped 门绿；r268 超时形失败不再因配额复现

## Definition of Done

- [ ] AC1–AC5 全部勾上
- [ ] 修后实跑：套件作用域读数贴出（cpu.max/memory.max/pids.max）
- [ ] 既有测试 + 新增测试全绿（`--for-task` scoped）
- [ ] 全量套件绿（`fail 0` 且 `cancelled 0` 且 `FULL-SUITE-EXIT=0`）——外层 verification-round 验证

## Touches

- plugin/scripts/full-suite-runner.ts（DEFAULT_SYSTEMD_RUN_LIMITS 改 CPUQuota=400%）
- plugin/test/full-suite-runner.test.mjs（新增/更新 systemd-run limits 断言）
- tasks/gap-systemd-run-limits-for-suite-and-heavy-ops.md（交叉标注——本任务改其 CPU 项、保留内存项）
- tasks/gap-suite-floor-two-longest-files-bound.md（交叉标注——CPUQuota 修正的延续）
- tasks/gap-systemd-run-cancel-cpuquota-keep-memory-guardrail.md（自身：勾 AC + 贴证据）

## Contract

measure   suite_scope_cpu_max = `cat /sys/fs/cgroup/*/*/*/*/app.slice/run-p*.scope/cpu.max | head -1` 的 stdout
band      suite_scope_cpu_max = `400000 100000`（CPUQuota 取消至 4 核满——用满物理核）
invariant memory_guardrail_kept = 1（MemoryMax=4G 保持——01:07 OOM 护栏，人明确要求不动）
invariant tasksmax_unchanged = 1（TasksMax=200 保持——人未提及，不顺手改）
invoke    `QUAY_TEST_SYSTEMD_RUN_LIMITS="MemoryMax=4G CPUQuota=400% TasksMax=200" bash scripts/test.sh` 跑一轮 lane4 对照，贴 `*_phase_ms` + cancelled
control   CPU 配额取消（400%）；内存护栏保持 4G；TasksMax 保持 200；lane4 新基线；lane8 重测；既有不回归
resume    改 DEFAULT CPUQuota / 同 commit 对照 / lane8 重测分步提交，任一步完成即写盘

## Dispatch review

reviewer: outer
at: 2026-08-11
changed: 人 06:3x 裁定取消硬配额 + 06:4x 裁定「取消 CPU 配额、保持内存配额」（覆盖 manager 06:41 建议中的 MemoryMax 提高部分）。manager 给执行形式（CPUQuota=400% measure-first 后落实现 / MemoryMax=4G 不动 / TasksMax=200 不动）+ 量化（r268 超时归因 2 核配额每进程 0.25 核、非 lane8 本身；K 不可辨识、预期 1050s 是理论外推非数据推论）。outer C6 实测复核（cpu.max 200000/100000、mem 4GiB、pids 200、4 物理核）。实现归 inner（full-suite-runner.ts 属验证机件，判据B task 路径），判定归 outer
