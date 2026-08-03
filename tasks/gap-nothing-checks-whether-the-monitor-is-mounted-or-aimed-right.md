---
id: gap-nothing-checks-whether-the-monitor-is-mounted-or-aimed-right
title: Nothing checks that the outer's Monitor is mounted, aimed at this repo, and
  owned by this session — two silent misses found only because a human asked
status: todo
labels:
  - gap
  - milestone-candidate
extra:
  schema: v1
---

**type:** execution

## Proposal

**铺设层面已经交付**（管理者 2026-08-03 实测）：临时项目里
`quay-init --loop --test-command 'npm test' --tmux-session 'demo-1:inner'` 退出 0；
铺出的外层文档 Monitor 段指向目标项目自己的 `plugin/scripts/inner-state.sh`；
整份铺设结果里 `/home/yale/work/quay` 出现 **0 次**；占位符替换到位（测试命令 3 处、会话名 6 处、残留 0）；
`--loop` 缺 `--test-command` 时**失败关闭**。

**缺的是保证：没有任何东西检查 monitor 是否真的挂上、挂对了没有。文档只是指令。**

### 两个反证——都不是被信号发现的，是人问起来才发现的

| 实例 | 形态 |
|---|---|
| archguard 外层 | **从来没挂上**。冷启动照着 tick 文档做，Monitor 那一步没发生，没有任何东西报错 |
| 管理者自己 | **挂了 18 小时挂在错的目标上**——两个监视器都在看【内层】，而它当时该看的是三个【外层】；`plugin/scripts/outer-liveness.sh` 的文件头把这次实测写了下来：「内层被看两遍，三个外层没人看」 |

**一个盯错东西的 monitor 和一个正确的 monitor，从外面看一模一样。**
这正是本仓一直在追的「不报错的降级」族——与 `CLAUDE.md:151` 明令禁止的读 TUI 那次
（缺文件不报错，只让方法静默退化）同形。

### 外层实测：这件事是可机械判定的，判据有三条不是一条

**(1) monitor 是一个真进程**，argv 就是脚本的绝对路径 ⇒ **挂没挂、挂的是哪个仓库的副本**可直接读：

```
1277284 :: bash /home/yale/work/quay/plugin/scripts/inner-state.sh
1305244 :: bash /home/yale/work/quay/plugin/scripts/inner-state.sh
```

（两个 pid 是同一个逻辑 monitor：脚本每轮起子 shell。判据必须容忍 N>1。）

**(2) 目标可判**：`inner-state.sh` 按 `BASH_SOURCE` 自定位工作根（`_INNER_STATE_DEFAULT_ROOT`），
`INNER_STATE_WORK_ROOT` 可覆盖 ⇒ **有效根 = argv 路径的 `../..`，除非环境变量覆盖**，
后者在 `/proc/<pid>/environ` 里同样可读。**「挂在别的项目上」在 argv 里就看得见。**

**(3) 归属可判**：monitor 的 ppid 链是
`1277284 → 1277252（bash -c 包装）→ 966759（claude）`，
而本会话自己的链同样收敛到 **966759** ⇒ **「这个 monitor 是不是本会话的」可比对**。
这条是必需的：一个上个会话遗留的进程会显示「活着」，但它的事件送不到现在这个会话。

### 判据必须避开的坑（外层在验证可行性时当场踩了）

第一版用**子串**找 `inner-state.sh`，结果**匹配到发起查询的命令自己两次**——
那两条 `bash -c … eval …` 的命令行里写着脚本名。这与 tick 文档步骤 0 记的
`pgrep -f` 自匹配是同一个坑。

**正确谓词：argv 的前两个 token 精确等于 `bash <绝对脚本路径>`**（不是子串）。
实测该谓词返回 2 个真进程、**自匹配 0 个**。

## Contract

```
measure mounted = `bash plugin/scripts/monitor-mount-check.sh --json` 输出的 mounted 布尔字段
measure target_ok = `bash plugin/scripts/monitor-mount-check.sh --json` 输出的 targetRoot 与本仓根是否相等的布尔字段
measure owned = `bash plugin/scripts/monitor-mount-check.sh --json` 输出的 ownedByThisSession 布尔字段
band mounted = true
invariant 检查器不写任何文件（`inner-state.sh` 的纯读契约同样约束它的检查器）；不得匹配到发起查询的进程自身
invoke `bash plugin/scripts/monitor-mount-check.sh --json`
control 停掉 monitor ⇒ mounted=false；挂一个指向别的仓库副本的 ⇒ targetRoot 不等；用上个会话遗留的进程 ⇒ owned=false
resume 三条判据各自独立可测，逐条落地
```

## Chosen mechanism

**三条判据一个脚本，`/proc` 读取、零写入。**

1. **`plugin/scripts/monitor-mount-check.sh`**：扫 `/proc/*/cmdline`，按**前两个 token 精确匹配**
   `bash <本仓>/plugin/scripts/inner-state.sh`（容忍 N>1 个 pid），
   解出 `targetRoot`（argv 路径的 `../..`，若 `/proc/<pid>/environ` 有 `INNER_STATE_WORK_ROOT` 则以它为准），
   并沿 ppid 链找最近的 `claude` 进程与本进程的链比对，得出 `ownedByThisSession`。
   **不写任何文件**——`inner-state.sh` 的纯读契约（`gap-telemetry-report-writes-and-deadlocks-readiness`
   的教训：观测命令写文件会让 readiness 永不通过）同样适用于它的检查器，所以**不要用心跳文件**。
2. **让 `INIT` 事件自报身份**：`inner-state.sh` 的首条事件已经正确地标 `INIT`（不是 `START`），
   给它加上**解析出的工作根**。这样「挂错目标」在**挂载当时**就看得见，而不是 18 小时后。
   这条最便宜且不需要任何人记得跑什么。
3. **写进两份 tick 文档的步骤 0 与「每个 tick 必报」**：必报项从 5 条变 6 条，多的那条是
   monitor 三判据。**诚实说明这一条的强制力**：它仍然靠 tick 文档被读到——
   真正的改进不是「有了强制器」，而是**把一个需要判断的问题变成一条命令**。

**不做**：**不自动重挂**（外层静默重挂会掩盖「会话正在死」这个更重要的信号，
而重挂本身是外层已经在做的动作，见 tick-log 11:38Z）；不建心跳文件（违反纯读契约）；
不重复 `plugin/scripts/outer-liveness.sh`——**那个已经在管三个项目的外层进程存活**，
本任务管的是**外层挂的 monitor 本身**，两者不同层，不要合并。

## Acceptance Criteria

- [x] AC1: `monitor-mount-check.sh` 落地，`--json` 输出 `mounted` / `targetRoot` / `ownedByThisSession` 三字段
- [x] AC2: **自匹配负控制**——在检查器自己的命令行里写上脚本名再跑，`mounted` 不得因此变 true
      （实跑输出贴任务体；这是外层验证可行性时当场踩到的坑）
- [x] AC3: **未挂载负控制**——停掉 monitor ⇒ `mounted=false`；重新挂上 ⇒ `mounted=true`。两个方向都贴
- [x] AC4: **挂错目标负控制**——挂一个指向另一个仓库副本的 monitor ⇒ `targetRoot` 不等于本仓根且被报出
- [x] AC5: **归属负控制**——构造一个不属于本会话的进程（或模拟其 ppid 链）⇒ `ownedByThisSession=false`
- [x] AC6: 一个逻辑 monitor 有多个 pid 时（实测 2 个）不误报为「多个 monitor」
- [x] AC7: 检查器零写入——跑完后 `git status --short` 无变化，且 `strace`/审计不必要时至少给出
      「本脚本只读 /proc 与 git」的显式说明与一条测试
- [x] AC8: `inner-state.sh` 的 `INIT` 事件带上解析出的工作根（实跑输出贴任务体）
- [x] AC9: 两份 tick 文档的步骤 0 与「每个 tick 必报」都加上这一条
- [x] AC10: 测试用 `node:test` 且带 `// @test-group governance`

## Definition of Done

- [x] AC2/AC3/AC4/AC5 四个负控制的实跑输出全部贴进任务体——
      **一个只会说「一切正常」的检查器，与没有检查器不可区分**；本任务的全部理由就是这句话
- [ ] 完整套件连跑 2 次全绿（**由协调方 fan-in 承担**——本任务 worktree 内按纪律不自启全量套件；
      scoped 测试已全绿：`plugin/test/monitor-mount-check.test.mjs` 10/10，
      `plugin/test/{loop-shipping,inner-state,quay-init-loop}.test.mjs` 14/14）
- [x] 任务体记录：两个反证（archguard 从未挂上、管理者 18 小时挂错目标）**都是人问起来才发现的**，
      不是任何信号报出的

## Evidence（实跑输出，2026-08-03）

### AC2 自匹配负控制 — 检查器自己的命令行里写上脚本名

命令：`MONITOR_CHECK_INNER_STATE=<tmp>/plugin/scripts/inner-state.sh bash plugin/scripts/monitor-mount-check.sh --json <tmp>/plugin/scripts/inner-state.sh`
（`<tmp>` 为 `mktemp -d` 临时工作根；检查器 argv[2] 携带完整脚本名，`mounted` 仍为 false）：

```json
{
  "mounted": false,
  "targetRoot": "",
  "targetOk": false,
  "ownedByThisSession": false,
  "pids": [],
  "targets": []
}
```

### AC3a 未挂载负控制 — 没有任何 monitor

```json
{
  "mounted": false,
  "targetRoot": "",
  "targetOk": false,
  "ownedByThisSession": false,
  "pids": [],
  "targets": []
}
```

### AC3b 重新挂上 — 挂一个真的进程，argv == `bash <inner-state>`

```json
{
  "mounted": true,
  "targetRoot": "/tmp/tmp.…mz",
  "targetOk": true,
  "ownedByThisSession": true,
  "pids": [ 1422867 ],
  "targets": [ { "pid": 1422867, "targetRoot": "/tmp/tmp.…mz", "owned": true } ]
}
```

### AC4 挂错目标负控制 — monitor 的 `INNER_STATE_WORK_ROOT` 指向另一个仓库副本

```json
{
  "mounted": true,
  "targetRoot": "/tmp/tmp.ixSsYhlwvm",
  "targetOk": false,
  "ownedByThisSession": true,
  "pids": [ 1423070 ],
  "targets": [ { "pid": 1423070, "targetRoot": "/tmp/tmp.ixSsYhlwvm", "owned": true } ]
}
```

`targetRoot` 被报出且不等于本仓根（`/tmp/tmp.…mz`），`targetOk=false`。

### AC5 归属负控制 — 上一个会话遗留的进程（孤儿，ppid 链不经过本会话 claude）

孤儿进程 `ppid` 实测回到 1；`mounted=true`（它确实活着）但 `ownedByThisSession=false`：

```json
{
  "mounted": true,
  "targetRoot": "/tmp/tmp.…mz",
  "targetOk": true,
  "ownedByThisSession": false,
  "pids": [ 1423214 ],
  "targets": [ { "pid": 1423214, "targetRoot": "/tmp/tmp.…mz", "owned": false } ]
}
```

### AC8 — `inner-state.sh` 的 INIT 事件带解析出的工作根

用临时工作根 + 一个报告在飞任务的假 `fast-mode-telemetry.ts` 实跑
`INNER_STATE_WORK_ROOT=<tmp> timeout 3 bash plugin/scripts/inner-state.sh`：

```
INIT 挂载时的在飞任务: AC8-demo | work_root=/tmp/tmp.urdbd4o88n
```

### 真实环境（非 fixture）— 检查本仓真实 monitor

对 `/home/yale/work/quay`（真实 monitor 所在，pids 1277284 + 子 shell 每轮新起）跑
`MONITOR_CHECK_INNER_STATE=/home/yale/work/quay/plugin/scripts/inner-state.sh bash plugin/scripts/monitor-mount-check.sh --json`：

```json
{
  "mounted": true,
  "targetRoot": "/home/yale/work/quay",
  "targetOk": true,
  "ownedByThisSession": false,
  "pids": [ 1277284, 1423415 ],
  "targets": [ { "pid": 1277284, "targetRoot": "/home/yale/work/quay", "owned": false },
               { "pid": 1423415, "targetRoot": "/home/yale/work/quay", "owned": false } ]
}
```

两个 pid 是同一个逻辑 monitor（AC6 真实现行）；`ownedByThisSession=false` 因为本检查是在
本任务 worktree 会话里跑的，不是挂 monitor 的那个外层会话——第三条判据的分辨力正在这里。

## Touches

- plugin/scripts/monitor-mount-check.sh
- plugin/test/monitor-mount-check.test.mjs
- plugin/scripts/inner-state.sh
- plugin/loop/orchestrator-loop-tick.md
- plugin/loop/fast-mode-loop-tick.md

## Dispatch review

reviewer: outer
at: 2026-08-03T11:45:00Z
changed: 管理者给了证据与一个方向（tick 步骤 0 自检），把「是否成任务、怎么定范围」交给外层。
**判定成任务**，理由是两个反证都属于「不报错的降级」——本仓优先级最高的一族。
**外层做的是把「可不可判」从设想变成实测**：monitor 是真进程（argv 即绝对路径）、
目标可从 argv 的 `../..` 或 `INNER_STATE_WORK_ROOT` 解出、归属可沿 ppid 链比对 claude pid
（实测本会话 monitor 1277284 → 966759，与本会话自身的链一致）。
**判据因此从一条变三条**：挂没挂 / 挂的哪个仓库 / 是不是本会话的——
只查第一条会漏掉管理者那次（进程活着、目标错），只查前两条会漏掉上个会话遗留的进程。
**并把一个坑写成 AC2**：外层验证时第一版用子串匹配，**当场匹配到发起查询的命令自己两次**；
正确谓词是 argv 前两 token 精确等于 `bash <绝对路径>`，实测自匹配 0。
**范围上砍掉两样**：不自动重挂（会掩盖会话正在死）、不建心跳文件
（`inner-state.sh` 有明文纯读契约，写文件会重演 readiness 死锁那次事故）。
**并明确不与 `plugin/scripts/outer-liveness.sh` 合并**——那个管的是三个项目的外层进程存活，
本任务管的是外层挂的 monitor 本身。
**诚实限度写进机制第 3 条**：这一条最终仍靠 tick 文档被读到，
改进是「把一个需要判断的问题变成一条命令」，不是「有了强制器」。
**派发时机**：与在飞的产品化任务在 `plugin/scripts/inner-state.sh` 与 `plugin/loop/*` 上重叠，
**必须等它收尾后再派**。

reviewer: inner
at: 2026-08-03T12:00:00Z
changed: 闸口结果——task-contract-check **0 新增**（violations 5 / ceiling 5 / new since baseline 0）；
checkTouchesPair（规范化 expand）与 gap-tmp-leak-*、gap-tasksperhour-* **两两 DISJOINT**，
可同批派发（产品化任务已收尾，重叠已解除）。
