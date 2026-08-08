---
id: gap-systemd-run-limits-for-suite-and-heavy-ops
title: "systemd-run cgroup limits for suite + heavy ops — cgroup v2 available
  (verified), limits can't be 'forgotten to call' (resource-gate WAS bypassed: 0
  calls in runner at ABORT#5, 8-way concurrency in WAIT state); suite in
  MemoryMax/CPUQuota/TasksMax scope, blocks
  tmux-leak(217)/concurrency-8/ugrep-8.8GB classes, comms unchanged"
status: ready
labels:
  - gap
  - defect
parent: null
children: []
extra: {}
---
**type:** execution

## Proposal

**今晚 6 起事故的 80% 收益中间步（管理者 SPEC-isolation-and-resource-governance-2026-08-05）**：
cgroup v2 本机已可用（cpuset cpu io memory pids 已核实），systemd-run 也在 ⇒ 不需要 Docker 就能拿
硬限额。**限额不可被绕过**：resource-gate.sh 曾被绕过（ABORT #5 实测 full-suite-runner 0 次调用，
8 路并发在 WAIT 态开跑，load 31.7）——「必须被主动调用才生效的限额 = 没有限额」。cgroup 限额无法
被「忘记调用」。

**6 起事故对照（实测数字）**：
- tmux 泄漏 217 进程 → PID 限额（TasksMax）
- 套件 concurrency=8（nproc=4）→ CPU 限额（CPUQuota）——变慢而非饿死全机
- ugrep 单进程 8.8GB（正则灾难回溯）→ 内存限额（MemoryMax）——OOM 杀一个非全机进 swap
- 三次整机崩溃 → 若成因是资源耗尽，限额挡住

**中间步价值**：①②④ 立刻被挡住，**通信通道一行不改**（同机同 tmux 同文件系统）。
也是容器化方案的验证——如果连 systemd-run 限额都没人记得加，容器化同样会被绕过。

**注意**：runner-structure 已修 resource-gate 接入（AC3，16068661），但「主动调用才能生效」的结构
弱点仍在——本任务用 cgroup 硬限额补上「无法被忘记调用」。

**新增实测证据（2026-08-05 14:56，管理者 + 外层核实）**：quay 资源门会因**其它项目**的活动报
WAIT——resource-gate 读整机 /proc/pressure/cpu，不区分负载来自哪个项目。实测：CPU 最高进程是
archguard-worktrees（task-66 tsc 102% + task-68 eslint 76%），PSI 58.37 高但**全是 archguard 自己
的 vitest/tsc**，quay 完全空闲。⇒ SPEC-isolation 核心论据（资源门看不到项目边界）真实运行实锤——
cgroup 限额（每项目 scope）天然解决此问题。

### 选定机制

1. **套件 runner 包 systemd-run**：`full-suite-runner.ts` 起套件时用
   `systemd-run --user --scope -p MemoryMax=4G -p CPUQuota=200% -p TasksMax=200` 包裹命令
2. **重型脚本限额**：ready-pool-check / ugrep 等重脚本运行时过同型限额（或全局默认）
3. **通信不改**：同机同 tmux，只有子进程的 cgroup 边界
4. 验证：套件在限额下正常跑；模拟泄漏（pid 爆）→ 被 TasksMax 挡，机器不崩溃

## Acceptance Criteria

- [x] AC1: `full-suite-runner.ts` 套件在 systemd-run 限额下跑（MemoryMax/CPUQuota/TasksMax），实测 cgroup 生效（`systemctl --user show <scope>` 显示 EffectiveMemoryMax=4G / CPUQuotaPerSecUSec=2s / EffectiveTasksMax=200；证据落盘 `.quay/suite-cgroup-evidence.txt`——见 Evidence AC1）
- [x] AC2: PID 爆（模拟 tmux 泄漏）⇒ TasksMax 挡住，机器其他进程不受影响（负控制，见 Evidence AC2：TasksMax=20 下 fork 200 个子进程在第 19 个被 EAGAIN 挡住；机器进程数平稳、scope 外 fork 正常）
- [x] AC3: 内存爆（模拟 ugrep 灾难回溯）⇒ MemoryMax 杀一个进程，非全机进 swap（负控制，见 Evidence AC3：MemoryMax=64M + MemorySwapMax=0 下 4GB 分配被 OOM 杀，机器可用内存 delta 7MB、未进全机 swap）
- [x] AC4: 通信通道零改动（同机 tmux/file，实测驱动/送达正常——见 Evidence AC4：cgroup scope 只移动子进程边界，套件 stdout/stderr 仍流入同一 full-suite.log、状态仍写同一路径）
- [x] AC5: 与 gap-no-resource-awareness-heavy-ops-run-blind + SPEC-isolation 交叉标注（见 Evidence AC5：SPEC §4/§6 与 no-resource-awareness 任务均已引用本任务）
- [x] AC6: **跨项目隔离实锤**——资源门因其它项目活动报 WAIT 时，本机 cgroup 限额下 quay 自身套件不受影响（见 Evidence AC6：并发双 scope——CPU 燃烧器（模拟 archguard 高负载）+ quay 套件在自身 scope 内正常跑完）

## Definition of Done

- [x] AC1-AC6 全勾（套件在 systemd-run 限额下跑 cgroup 生效；PID 爆 TasksMax 挡住；内存爆 MemoryMax 杀单进程；通信通道零改动；与 no-resource-awareness + SPEC-isolation 交叉标注；跨项目隔离实锤 archguard 高负载时 quay 套件自身 scope 正常）
- [x] 两个负控制实测（PID 爆不影响机器其他进程；内存爆不进全机 swap）
- [x] scoped 门 `scripts/test.sh --for-task gap-systemd-run-limits-for-suite-and-heavy-ops` 绿

## Definition of Done

- [ ] AC1-AC6 全勾（套件在 systemd-run 限额下跑 cgroup 生效；PID 爆 TasksMax 挡住；内存爆 MemoryMax 杀单进程；通信通道零改动；与 no-resource-awareness + SPEC-isolation 交叉标注；跨项目隔离实锤 archguard 高负载时 quay 套件自身 scope 正常）
- [ ] 两个负控制实测（PID 爆不影响机器其他进程；内存爆不进全机 swap）
- [ ] scoped 门 `scripts/test.sh --for-task gap-systemd-run-limits-for-suite-and-heavy-ops` 绿

## Touches
- tasks/gap-systemd-run-limits-for-suite-and-heavy-ops.md（自身文件——self-touch，2026-08-08 内层补：缺此条不满足派发资格闸 step 4.5）

- plugin/scripts/full-suite-runner.ts（套件包限额）
- plugin/test/full-suite-runner.test.mjs（AC1-AC3 测试）
- orchestration/SPEC-isolation-and-resource-governance-2026-08-05.md（AC5/AC6 引用）
- tasks/gap-no-resource-awareness-heavy-ops-run-blind.md（AC5 交叉标注）

## Contract

measure   suite_cgroup = `systemctl --user show 'run-*.scope' 2>&1 | grep -cE 'MemoryMax|CPUQuotaPerSecUSec|TasksMax'` stdout 数字段（套件跑时有限额属性；2026-08-08 内层改：status 视图不含属性字面量，show 视图含 MemoryMax/CPUQuotaPerSecUSec/TasksMax）
band      suite_cgroup >= 2（套件实际在 cgroup 限额下，MemoryMax/CPUQuota/TasksMax 属性可见）
invoke    `systemd-run --user --scope -p MemoryMax=4G -p CPUQuota=200% -p TasksMax=200 bash -c 'echo ok'`
control   无限额跑（当前形态）⇒ 无 cgroup 属性；限额跑 ⇒ 有（AC1）
resume    套件限额与重脚本限额分步提交，任一步完成即写盘

## Evidence (2026-08-08, inner 实现与实测)

### AC1 — 套件在 systemd-run 限额下跑，cgroup 生效可见

`plugin/scripts/full-suite-runner.ts` 在 systemd-run 可用时把套件包进
`systemd-run --user --scope -p MemoryMax=4G -p CPUQuota=200% -p TasksMax=200 bash -c <command>`。
state 带 `systemdRun: {applied, memoryMax, cpuQuota, tasksMax}`；实际生效的 cgroup 属性
（`systemctl --user show <scope>`）在套件运行时落盘 `<state-dir>/suite-cgroup-evidence.txt`：

```
scope_unit=run-p1289161-i68384306.scope
limits_applied=1 memoryMax=4G cpuQuota=200% tasksMax=200
EffectiveMemoryMax=4294967296
EffectiveTasksMax=200
CPUQuotaPerSecUSec=2s
MemoryMax=4294967296
TasksMax=200
ControlGroup=/user.slice/user-1000.slice/user@1000.service/app.slice/run-p1289161-i68384306.scope
```

（`systemctl --user status <scope>` 视图显示 `Memory: … (max: 4G)` / `Tasks: … (limit: 200)`；
`show` 视图直接暴露 `MemoryMax`/`CPUQuotaPerSecUSec`/`TasksMax` 属性字面量——Contract measure 据此
用 `show`。）新测试 `AC1 — the runner wraps the suite in a systemd-run cgroup scope…` 端到端断言：
state 带 systemdRun、evidence 文件含 EffectiveMemoryMax=4G / CPUQuotaPerSecUSec=2s / EffectiveTasksMax=200。

### AC2 — PID 爆负控制（模拟 tmux 泄漏）实测

```
$ systemd-run --user --scope --quiet -p TasksMax=20 python3 -c "<fork 200 个长活子进程，计数>"
fork blocked at i=19: [Errno 11] Resource temporarily unavailable
successful_forks=19
```

TasksMax=20 在第 19 个子进程处挡住（EAGAIN），模拟的 tmux 泄漏（217 进程类）被 cgroup 边界关在
scope 内。**机器其他进程不受影响**：scope 外 `os.fork()` 正常（`outside-fork-ok`），机器进程数
before/after 平稳（测试断言增量 < 100，实际约 0）。新测试 `AC2 — negative control: TasksMax blocks
a PID blowout…` 自动化复测。

### AC3 — 内存爆负控制（模拟 ugrep 灾难回溯）实测

```
$ systemd-run --user --scope --quiet -p MemoryMax=64M -p MemorySwapMax=0 python3 -c "<分配 4GB>"
Killed   （exit 137，SIGKILL——cgroup OOM 杀进程）
available_mb_before=10109   available_mb_after=10116   delta=+7MB
```

单个内存黑洞进程被 MemoryMax 杀掉，**机器没有进全机 swap**（可用内存 delta 7MB，远低于噪声阈值）。
新测试 `AC3 — negative control: MemoryMax OOM-kills a single memory hog…` 自动化复测（断言 hog 未存活、
exit 非 0、可用内存无崩塌）。`MemorySwapMax=0` 明确禁止 scope 逃逸进 swap——正是「非全机进 swap」
要证的边界。

### AC4 — 通信通道零改动

cgroup scope 只移动**子进程边界**：套件 stdout/stderr 仍流入 runner 的同一管道 → 同一
`full-suite.log`；state 仍写同一 `.quay/full-suite-state.json`；同机同 tmux 同文件系统一字未动。
新测试 `AC4 — the cgroup scope is a process boundary, not a comm-channel change…` 断言限额下套件的
marker 行仍到达共享 log。本任务的 diff 只碰 runner 的 spawn 包装、测试与交叉标注文件——无任何
tmux/socket/file-delivery 通道改动。

### AC5 — 交叉标注（双向）

- `orchestration/SPEC-isolation-and-resource-governance-2026-08-05.md` §4 增补「落地任务
  （gap-systemd-run-limits-for-suite-and-heavy-ops）」、§6 增补本任务条目（§4 中间步的落地）。
- `tasks/gap-no-resource-awareness-heavy-ops-run-blind.md` 增补「交叉标注（AC5）」——本任务是
  gate 的 cgroup 硬限额上位解（限额不可被绕过 vs 必须主动调用）。
- 本任务 Proposal/AC 已引用两者。新测试 `AC5 — cross-annotation…` 断言三个文件互相引用。

### AC6 — 跨项目隔离实锤（并发双 scope）

资源门读整机 `/proc/pressure/cpu`，看不到项目边界（SPEC §2 实测：archguard 负载使 quay gate 报
WAIT、quay 空闲）。cgroup 每项目 scope 天然解决：quay 套件在**自身 scope** 内拿自己的
CPUQuota，不需要整机空闲。新测试 `AC6 — cross-project isolation…` 并发跑两个 scope：
A = CPU 燃烧器（`CPUQuota=100%`，`while :; do :; done`，模拟 archguard 高负载），
B = quay 套件（自身限额）——B 在 A 燃烧期间正常跑完（exit 0，state green，state.systemdRun 证明
它在自身 scope）。自动化 + 本机实测均绿。

## Dispatch review

reviewer: none
at: 2026-08-05
changed: 交叉标注（AC8，gap-adaptive-concurrency-cap-tied-to-resource-gate 引用本任务为 cgroup 硬限额的上位解对照——本任务补「限额不可被绕过」，自适应并发补「cap 随资源回落」；两者同源于 SPEC-isolation-and-resource-governance-2026-08-05）

reviewer: inner (implementation)
at: 2026-08-08
changed: 任务从 integration 分叉实现并提交（fork baseline = integration——Touches 与 integration 上
  dod-over90/known-load-sensitive/suite-cutoff/full-suite-state-race 的 full-suite-runner.ts 工作相交）。
  full-suite-runner.ts 起跑套件时包 systemd-run --user --scope（MemoryMax/CPUQuota/TasksMax），state 带
  systemdRun 字段，cgroup 属性证据落盘 suite-cgroup-evidence.txt；AC1-AC6 全勾（见 Evidence）。Contract
  measure 由 `systemctl --user status` 改为 `systemctl --user show`（status 视图不含属性字面量，show 视图
  含 MemoryMax/CPUQuotaPerSecUSec/TasksMax）。
