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

- [ ] AC1: `full-suite-runner.ts` 套件在 systemd-run 限额下跑（MemoryMax/CPUQuota/TasksMax），实测 `systemctl --user status` 能看到 cgroup 生效
- [ ] AC2: PID 爆（模拟 tmux 泄漏）⇒ TasksMax 挡住，机器其他进程不受影响（负控制）
- [ ] AC3: 内存爆（模拟 ugrep 灾难回溯）⇒ MemoryMax 杀一个进程，非全机进 swap（负控制）
- [ ] AC4: 通信通道零改动（同机 tmux/file，实测驱动/送达正常）
- [ ] AC5: 与 gap-no-resource-awareness-heavy-ops-run-blind + SPEC-isolation 交叉标注
- [ ] AC6: **跨项目隔离实锤**——资源门因其它项目活动报 WAIT 时，本机 cgroup 限额下 quay 自身套件不受影响（实测：archguard 高负载时 quay 套件在自身 scope 内正常跑）

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

measure   suite_cgroup = `systemctl --user status 'scope-*' 2>&1 | grep -c 'MemoryMax\|CPUQuota'` stdout 数字段（套件跑时有限额属性）
band      suite_cgroup >= 1（套件实际在 cgroup 限额下）
invoke    `systemd-run --user --scope -p MemoryMax=4G -p CPUQuota=200% -p TasksMax=200 bash -c 'echo ok'`
control   无限额跑（当前形态）⇒ 无 cgroup 属性；限额跑 ⇒ 有（AC1）
resume    套件限额与重脚本限额分步提交，任一步完成即写盘
## Dispatch review

reviewer: none
at: 2026-08-05
changed: 交叉标注（AC8，gap-adaptive-concurrency-cap-tied-to-resource-gate 引用本任务为 cgroup 硬限额的上位解对照——本任务补「限额不可被绕过」，自适应并发补「cap 随资源回落」；两者同源于 SPEC-isolation-and-resource-governance-2026-08-05）
