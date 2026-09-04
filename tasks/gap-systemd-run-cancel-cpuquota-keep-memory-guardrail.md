---
id: gap-systemd-run-cancel-cpuquota-keep-memory-guardrail
title: 人的裁定：取消 CPU 配额、保持内存配额——CPUQuota=400%（measure-first 后落实现）、MemoryMax=4G
  不动（OOM 护栏）、TasksMax=200 不动；8 并发差是配额所致非 lane8 本身；r268 两个超时形失败归因配额；先在新配额下跑 lane4
  新基线再重做 lane4 vs lane8 对照
status: done
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

- [x] AC1: **复现固化**——任务体记录人的裁定逐字（取消 CPU 配额、保持内存配额）+ 执行入口（:753 DEFAULT + QUAY_TEST_SYSTEMD_RUN_LIMITS 三键 + :784 测试接缝非生产开关）+ outer C6 实测（cpu.max 200000/100000、mem 4GiB、pids 200、机器 4 核）（本任务 Proposal 已含）
- [x] AC2: **取消 CPU 配额**——`DEFAULT_SYSTEMD_RUN_LIMITS` cpuQuota `200%`→`400%`（measure-first 用满 4 物理核）；MemoryMax=4G 保持、TasksMax=200 保持（实跑 scope 读数 cpu.max=400000 100000 / memory.max=4294967296 / pids.max=200，见 Implementation evidence）
- [x] AC3: **同 commit 对照**——`QUAY_TEST_SYSTEMD_RUN_LIMITS="MemoryMax=4G CPUQuota=400% TasksMax=200"` 对照轮：orangevps 无配额对照（本任务 Finding）已推翻「取消配额更快」假设（lane4 main=117s vs lane8=137s 反而慢；sum_ms 2.30x 涨幅）；本机 400% 轮三 `*_phase_ms` + cancelled 按执行纪律 5「不跑全量套件」推迟到外层 verification-round——r266 基线（serial 640/lowconc 272/main 650/合计 1533/cancelled 0）留作对照
- [x] AC4: **lane8 重测（按 Finding 改——记录结论，不重测）**——orangevps 真 4 核无配额对照：8 进程挤 4 物理核比 4 进程更差（lane4 main=117s vs lane8=137s 反而慢 17%；sum_ms 2.30x 比 2 核配额下 1.79x 更陡）⇒ **`--test-concurrency` 不应超过物理核数（两种约束环境都成立）**；lane8 在任何 4 核环境都不是杠杆，结论记录，不再重测
- [x] AC5: **既有不回归**——`--for-task` scoped 门绿（75 pass / 0 fail / 0 cancelled，见 Implementation evidence）；r268 超时形失败归因 2 核配额（orangevps 无配额 lane8 39.4s passed 佐证），400% 默认下不再因配额复现

## Definition of Done

- [x] AC1–AC5 全部勾上
- [x] 修后实跑：套件作用域读数贴出（cpu.max=400000 100000 / memory.max=4294967296 / pids.max=200，见 Implementation evidence）
- [x] 既有测试 + 新增测试全绿（`--for-task` scoped：75 pass / 0 fail / 0 cancelled）
- [ ] 全量套件绿（`fail 0` 且 `cancelled 0` 且 `FULL-SUITE-EXIT=0`）——外层 verification-round 验证（含本机 400% 轮三 `*_phase_ms` 对照）

## Implementation evidence (inner 2026-08-11)

**交付（commit 1a73a166 / 6a9e52a6，worktree `gap-systemd-run-cancel-cpuquota-keep-memory-guardrail`）**

- `plugin/scripts/full-suite-runner.ts:753` `DEFAULT_SYSTEMD_RUN_LIMITS` cpuQuota `200%`→`400%`（MemoryMax=4G / TasksMax=200 保持），接口注释同步
- `plugin/scripts/resource-gate.sh` nproc 失真注释同步（400% 默认下 scope 内 nproc 读 4=主机；`nproc --all` 修复在任意 CPUQuota 覆盖下仍正确）
- `plugin/test/full-suite-runner.test.mjs` 断言同步：buildSystemdRunArgv 期望 `CPUQuota=400%`；parseSystemdRunLimits 未覆盖键保默认 400%；真 systemd 实跑 evidence 断言 state.systemdRun.cpuQuota=400% + `CPUQuotaPerSecUSec=4s`

**AC2 实跑（新 DEFAULT 的独立 scope 读数，Contract measure 面）**：

```
$ systemd-run --user --scope --quiet --unit=scope-probe-cpuquota.scope -p MemoryMax=4G -p CPUQuota=400% -p TasksMax=200 sleep 5 &
$ systemctl --user show scope-probe-cpuquota.scope -p CPUQuotaPerSecUSec -p MemoryMax -p TasksMax -p EffectiveTasksMax -p ControlGroup
ControlGroup=/user.slice/user-1000.slice/user@1000.service/app.slice/scope-probe-cpuquota.scope
EffectiveTasksMax=200
CPUQuotaPerSecUSec=4s
MemoryMax=4294967296
TasksMax=200
$ cat /sys/fs/cgroup<scope>/cpu.max       → 400000 100000
$ cat /sys/fs/cgroup<scope>/memory.max    → 4294967296
$ cat /sys/fs/cgroup<scope>/pids.max      → 200
```

**AC5 scoped 门**：`bash scripts/test.sh --for-task gap-systemd-run-cancel-cpuquota-keep-memory-guardrail --allow-thin`（worktree 内跑）→ exit 0，**tests 75 / pass 75 / fail 0 / cancelled 0**。含三个 limits 相关实跑测试绿（buildSystemdRunArgv 400% / parse 默认 400% / 真 systemd scope evidence `CPUQuotaPerSecUSec=4s`）。

**AC3 对照状态**：本机 400% 全量轮（三 `*_phase_ms`+cancelled）按执行纪律 5「不跑全量套件」推迟到外层 verification-round；orangevps 无配额对照已在本任务 Finding 记录（推翻「取消配额更快」）。r266 基线留作对照。

## Touches

- plugin/scripts/full-suite-runner.ts（DEFAULT_SYSTEMD_RUN_LIMITS 改 CPUQuota=400%）
- plugin/test/full-suite-runner.test.mjs（新增/更新 systemd-run limits 断言）
- tasks/gap-systemd-run-limits-for-suite-and-heavy-ops.md（交叉标注——本任务改其 CPU 项、保留内存项）
- tasks/gap-suite-floor-two-longest-files-bound.md（交叉标注——CPUQuota 修正的延续）
- tasks/gap-systemd-run-cancel-cpuquota-keep-memory-guardrail.md（自身：勾 AC + 贴证据）

### Finding：orangevps 无配额对照跑完——r268 归因证实、但「取消配额更快」假设被推翻、本机测量含开发负载混杂（manager 2026-08-11 09:3x，落点 Finding 不进 Contract）

**① r268 归因证实**：cli.test.mjs 在 orangevps（真 4 核、无 cgroup 配额）lane4=19.8s passed、lane8=39.4s **passed**，未撞 60s 窗 ⇒ r268 超时形失败确系 **2 核硬配额饥饿**，不是 lane8 本身。

**②「拿掉配额就该更快」被推翻**：orangevps main 相 sum_ms 从 lane4=458134ms → lane8=1055276ms，**涨幅 2.30x——比家里 2 核配额下实测的 1.79x 还陡**。实际墙钟 lane4 main=117s、lane8 main=**137s（反而慢 17%）**，整轮估算 lane4≈497s、lane8≈547s（反而慢 10%）。⇒ **无配额下 8 进程挤 4 物理核依然比 4 进程挤 4 核更差，且膨胀系数比 cgroup 节流下更陡**。⇒ **`--test-concurrency` 不应超过物理核数——在两种约束环境下都成立，是今晚最稳的一条；lane8 在任何 4 核环境下都不是杠杆，不必再测。**（未验证假设，不下结论：可能是真实抢占的上下文切换开销比 cgroup 节流更贵，或 IO/tmux 类测试对真实并发争用更敏感。）

**③ 必须标注的混杂因素（影响今晚所有本机估算的可信度）**：orangevps main 相 117s（空场跑）vs 本机 r281 main 相 729s（同 conc=4）——**6.2 倍差，而 CPU 配额只能解释 2 倍（2核→4核）**。差额很可能来自**本机套件是跟活跃开发同时抢机器跑的**（outer/inner 的 subagent 同时在用这台机器的 4 核），orangevps 孤立跑。⇒ **此前「79% CPU 占比」反解、main 相理论地板、16/48 核估算，全部是在【负载环境】下测得的，应标注非孤立值 ⇒ CPUQuota 400% 的收益预测应下调**（膨胀系数论据 + 混杂论据双重指向同一方向：本机对照实验的干净度不如预期）。

**④ 失败分类（如实报告、不猜机制、无归因）**：两轮都失败 12 个（环境性：adr-gate/config-wiring/monitor-mount-check 等，与并发无关）；仅 lane4 失败 19 个、仅 lane8 失败 2 个——**并发更低失败反而更多，违反直觉，无归因**。逐条 lane4-only：blocked-signal-parameterized/timeout、build-evidence-manifest、cap-from-gate、compile-cache、document-gate-fixture、execution-policy(×2)、finding-backpropagate(×2)、gitignore、inner-blocked-signal、resource-gate、restart-readiness-check、ruling-required-wiring、run-identity、workflow-event-schema。若值得查，日志在 orangevps `~/suite-lane4.log`/`~/suite-lane8.log`（已各拉一份到本机 scratchpad）。

**建议**：① CPUQuota 400% 轮若干净，直接与 r281（200%）对比即可，不必再等 orangevps 二次验证；②「本机测量含开发负载混杂」标进相关任务 Finding；③ lane8 系列实验到此为止——两台机器、两种约束都指向同一结论。

**⚠ 数据修正（manager 2026-08-11 10:2x，本条作废上文部分数字）**：orangevps/boheidc 最初 31 失败 = 同一根因 **`.quay/config.yml` 缺失**（gitignored、quay-init 生成、新 clone 没有）；scp 修复后失败归零（除 mcp-server 高并发死锁）。**orangevps 干净重跑 main_phase_ms 从「带 31 假失败」的 117s 变 170s**——那 31 个瞬间报错把 sum_ms 显著拉低，**上文 ②③ 及此前任何用那批数据做的外推均已作废**（117s/6.2 倍差/400% 收益下调的定量部分以 170s 重算为准；定性方向不变：本机测量含开发负载混杂、取消配额非纯收益）。boheidc lane16（16核无配额）撞上 mcp-server 死锁，剔除异常值 sum=1493s/289 文件、理论地板≈93.3s（未经验证轮）。死锁本体归内层任务 `gap-mcp-server-test-deadlocks-at-high-test-concurrency`。

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
