---
id: gap-observer-registry-target-decommission-and-criterion-invalidation
title: "no mechanism answers 'is this observer's target still alive/intentional,
  and is this observer's own criterion still valid' — FOUR independent consumers
  hit this exact shape in one night: (1) os-anchor-watchdog revived a
  deliberately-decommissioned archguard session (absence-inference cannot
  distinguish crashed from intentionally-stopped, already diagnosed in
  gap-os-anchor-watchdog-lease-model-instead-of-absence-inference but scoped to
  that ONE consumer); (2) a manager git-staleness Monitor kept reporting growing
  STALL_Nm for the same decommissioned archguard; (3) a
  session-liveness-coverage Monitor reported NOT-WATCHED for a decommissioned B
  machine; (4) a session-topology Monitor reported a stale cached
  quay-b:outer=claude value 5 minutes after B's tmux server had cleanly
  terminated (confirmed via no server running + zero claude processes) — each
  consumer was individually hand-diagnosed and hand-fixed by the manager tonight
  (stop, rescope, restart), with NO shared mechanism; manager 2026-08-06, filed
  per human direction to transfer to outer for class-level design"
status: ready
labels:
  - gap
  - milestone-candidate
parent: null
children: []
extra:
  schema: v1
---
**type:** execution

## Proposal

**"这个观测目标是不是被有意下线了"和"这个监视器的判据是不是已经失效了"——今晚同一个问题
在四个完全独立的消费者身上各自炸了一次，管理者各修各的，没有共享机制。**

### 四个实例（同一晚，均为管理者手工发现+手工修复）

| # | 消费者 | 假信号 | 修复方式（一次性，无沉淀） |
|---|---|---|---|
| 1 | `os-anchor-watchdog`（systemd timer） | 复活了刚被人裁定停掉的 archguard 会话 | 从 `os-anchor-projects.conf` 手工注释掉该条 + 停用 systemd timer |
| 2 | manager 自建的 `git-staleness` Monitor | 持续给已下线的 archguard 报 `STALL_Nm`（数字只会越报越大） | `TaskStop` 旧 Monitor，重挂只看 quay 本机的版本 |
| 3 | manager 自建的 `session-liveness coverage` Monitor | 给已下线的 B 报 `NOT-WATCHED` | `TaskStop` 旧 Monitor，重挂移除 B 的版本 |
| 4 | manager 自建的 `session-topology` Monitor | B 会话已确认 `no server running` + 零 claude 进程，但监视器仍报 `quay-b:outer=claude`（5 分钟采样周期的陈旧缓存值） | `TaskStop` 旧 Monitor，重挂移除 B 的版本 |

**已有的诊断只覆盖第 1 个实例**：`gap-os-anchor-watchdog-lease-model-instead-of-absence-inference`
（todo）提出"absence-inference 应改为显式带时间戳的租约"，但**只针对 os-anchor 这一个消费者**，
没有覆盖第 2-4 个——它们甚至不是 absence-inference 的问题（案例 4 是缓存陈旧，不是推断错误）。

### 性质

**这不是四个独立缺陷，是一个类。** 共同结构：观测者假设"目标的存在性/状态在两次采样之间不变"，
一旦这个假设被人为打破（下线、停用、重新配置），观测者没有任何机制知道自己的判据已经不再成立。

### 选定机制（方向，接法留执行时）

不预设具体实现，但两条约束：

1. **单一登记表，不是四份配置**——被下线的目标写一次，所有消费者（watchdog / manager 的
   git-staleness / coverage / topology Monitor，以及未来的新消费者）从同一处读，而不是像今晚
   这样每个消费者各自维护一份目标列表、各自手工编辑。
2. **主动失效，不是被动缓存**——案例 4 证明"缩短采样周期"不能根治问题（陈旧缓存本质上
   是任意采样周期都会有的窗口）；正确方向是目标下线时**主动通知**已注册的观测者，而不是
   靠观测者自己下次采样时"恰好"发现变化。

## Contract

```
measure registered_targets = `bash plugin/scripts/<观测者注册表脚本> --list --json | python3 -c "import json,sys;print(len(json.load(sys.stdin)))"` stdout 的数字段
measure stale_observer_reports = `bash plugin/scripts/<观测者注册表脚本> --audit --json | python3 -c "import json,sys;print(sum(1 for c in json.load(sys.stdin)['consumers'] if c['stale']))"` stdout 的数字段
band stale_observer_reports = 0
invariant 一个目标被登记为下线后，所有读该登记表的观测者必须在下一次输出前正确反映"已下线"，不得需要人工逐个 TaskStop/重挂
invoke `bash plugin/scripts/<观测者注册表脚本> --list`
control 登记一个目标为下线，然后模拟四类消费者各自采样一次 ⇒ 全部必须正确报"已下线"而非旧状态；若任一消费者仍报旧状态，说明登记表没有被真正共用
resume 若中断，先跑 measure 读当前登记表与各消费者的一致性，不要假设已经同步
```

## Acceptance Criteria

- [ ] AC1: 登记表存在且可读——列出当前登记的目标及其状态，贴出实跑输出
- [ ] AC2: 至少覆盖本任务列出的 4 个已知消费者（os-anchor-watchdog / manager 的 git-staleness /
      coverage / topology 观测），每个消费者改为读登记表而非各自硬编码目标列表
- [ ] AC3: **负控制（承重条）**——登记一个目标为下线后，4 个消费者各跑一次，全部正确报"已下线"；
      若任一个仍报旧状态，本任务无效，不得以 AC1/AC2 通过为由结案
- [ ] AC4: 与 `gap-os-anchor-watchdog-lease-model-instead-of-absence-inference` 交叉标注——
      那条是本类的第一个实例（absence-inference），本任务是类级机制，覆盖它未覆盖的另外三个消费者
- [ ] AC5: 下线登记本身走**读取类操作**（人/manager 显式登记，不是观测者自己猜），且不引入新的
      系统 crontab（复用本仓已有的双触发源模式，与 `sync-lag-check.sh` 同款）

## Definition of Done

- [ ] AC1-AC5 实跑输出贴进任务体
- [ ] 完整套件连跑 2 次全绿（`fail 0` 且 `cancelled 0`）
- [ ] 任务体记录本类今晚的全部 4 个已知实例，作为该类的登记册

## Touches
- tasks/gap-observer-registry-target-decommission-and-criterion-invalidation.md
- plugin/scripts/os-anchor-watchdog.sh
- plugin/scripts/os-anchor-install.sh
- tasks/gap-os-anchor-watchdog-lease-model-instead-of-absence-inference.md（交叉标注）

## Dispatch review

reviewer: none
at: 2026-08-06T16:1xZ
changed: 尚未派发/审阅（人直接裁定立案并转外层，管理者代笔）
