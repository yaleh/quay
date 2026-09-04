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
status: done
labels:
  - gap
  - milestone-candidate
parent: null
children: []
extra:
  schema: v1
  needs_human_reason: "fan-in conflict: cherry-pick 69e517b3 onto integration → 2
    conflicts, both same-position heartbeat steps. Integration already has
    cross-machine-verify heartbeat at fast-mode 4b + orchestrator 3d (from
    gap-no-post-merge's fan-in 05456e96); observer-registry adds its own
    registry-audit heartbeat at the SAME 4b/3d positions. Two live heartbeat
    tasks claiming identical doc positions — genuine two-task conflict, same
    class as probe-mechanism
    (gap-probe-mechanism-dead-15-days-rewire-to-two-layer, also needs-human for
    the same step-4b clash). Per doc: conflict → needs-human, never --skip/-X
    ours. Work fully implemented + verified (observer-registry 5/5,
    os-anchor/session-liveness/sync-lag 23/23, session-liveness 49/49, scoped
    56/56; full-suite 3 runs all cancelled-0 with only env load-flakes).
    Worktree/branch
    task/gap-observer-registry-target-decommission-and-criterion-invalidation
    preserved at 69e517b3. Needs human to merge/renumber the heartbeat steps
    (cross-machine-verify + observer-registry at 4b/4c and 3d/3e, or merge into
    one heartbeat section) — this is the SAME adjudication as probe-mechanism's
    step-4b, can be resolved together."
---
**type:** execution

> **翻 done（人 2026-08-12 00:4x 裁定，A 组）**：代码已合入 integration 且被 r308-green 覆盖，AC18 复核 measure 通过。

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
measure registered_targets = `bash plugin/scripts/observer-registry.sh --list --json | python3 -c "import json,sys;print(len(json.load(sys.stdin)))"` stdout 的数字段
measure stale_observer_reports = `bash plugin/scripts/observer-registry.sh --audit --json | python3 -c "import json,sys;print(sum(1 for c in json.load(sys.stdin)['consumers'] if c['stale']))"` stdout 的数字段
band stale_observer_reports = 0
invariant 一个目标被登记为下线后，所有读该登记表的观测者必须在下一次输出前正确反映"已下线"，不得需要人工逐个 TaskStop/重挂
invoke `bash plugin/scripts/observer-registry.sh --list`
control 登记一个目标为下线，然后模拟四类消费者各自采样一次 ⇒ 全部必须正确报"已下线"而非旧状态；若任一消费者仍报旧状态，说明登记表没有被真正共用
resume 若中断，先跑 measure 读当前登记表与各消费者的一致性，不要假设已经同步
```

## Acceptance Criteria

- [x] AC1: 登记表存在且可读——列出当前登记的目标及其状态，贴出实跑输出
- [x] AC2: 至少覆盖本任务列出的 4 个已知消费者（os-anchor-watchdog / manager 的 git-staleness /
      coverage / topology 观测），每个消费者改为读登记表而非各自硬编码目标列表
- [x] AC3: **负控制（承重条）**——登记一个目标为下线后，4 个消费者各跑一次，全部正确报"已下线"；
      若任一个仍报旧状态，本任务无效，不得以 AC1/AC2 通过为由结案
- [x] AC4: 与 `gap-os-anchor-watchdog-lease-model-instead-of-absence-inference` 交叉标注——
      那条是本类的第一个实例（absence-inference），本任务是类级机制，覆盖它未覆盖的另外三个消费者
- [x] AC5: 下线登记本身走**读取类操作**（人/manager 显式登记，不是观测者自己猜），且不引入新的
      系统 crontab（复用本仓已有的双触发源模式，与 `sync-lag-check.sh` 同款）

## Definition of Done

- [x] AC1-AC5 实跑输出贴进任务体
- [ ] 完整套件连跑 2 次全绿（`fail 0` 且 `cancelled 0`）
- [x] 任务体记录本类今晚的全部 4 个已知实例，作为该类的登记册

## Touches
- tasks/gap-observer-registry-target-decommission-and-criterion-invalidation.md
- plugin/scripts/os-anchor-watchdog.sh
- plugin/scripts/os-anchor-install.sh
- tasks/gap-os-anchor-watchdog-lease-model-instead-of-absence-inference.md（交叉标注）
- plugin/scripts/observer-registry.sh（新增：类级机制本体）
- orchestration/observer-registry.conf（新增：注册表数据文件）
- plugin/scripts/session-liveness.sh（消费者 #2/#3 读面）
- plugin/scripts/topology-check.sh（消费者 #4 读面）
- plugin/scripts/capability-catalog.sh（新增 shipped check 的问题声明）
- plugin/test/observer-registry.test.mjs（新增：机制测试）
- plugin/loop/fast-mode-loop-tick.md（AC5 双触发源引用）
- plugin/loop/orchestrator-loop-tick.md（AC5 双触发源引用）
- plugin/skills/init/SKILL.md（self-create 声明：orchestration/observer-registry.conf）

## Dispatch review

reviewer: none
at: 2026-08-06T16:1xZ
changed: 尚未派发/审阅（人直接裁定立案并转外层，管理者代笔）

---

## 实施记录（2026-08-07，外层执行于 worktree `observer-registry`）

### 交付物

| 文件 | 角色 |
|---|---|
| `plugin/scripts/observer-registry.sh` | **类级机制本体**：单一注册表（`--list` / `--list --json` / `--status` / `--is-offline` / `--is-offline-session` / `--register-offline` / `--register-active` / `--audit --json`） |
| `orchestration/observer-registry.conf` | 注册表数据文件（单一来源；登记 quay / meta-cc / archguard） |
| `plugin/scripts/os-anchor-watchdog.sh` | 消费者 #1：`watch_project` 先查 `--is-offline`，已下线 → `decommissioned`、绝不 re-spawn |
| `plugin/scripts/os-anchor-install.sh` | 消费者 #1 安装侧：重建 watch-list 时跳过注册为下线的兄弟项目 |
| `plugin/scripts/session-liveness.sh` | 消费者 #2/#3：对每个目标先查 `--is-offline`，已下线 → 报 `decommissioned`、不评估任何事件（无 REPO-STALL / GONE / OVERDUE / IDLE） |
| `plugin/scripts/topology-check.sh` | 消费者 #4：会话注册为下线 → 报 `decommissioned`，不读 live tmux 状态（陈旧缓存被注册表压过） |
| `plugin/test/observer-registry.test.mjs` | 5 个测试：AC1 可读 / AC2+AC3 负控制 / AC2 无假阳性 / AC5 显式登记 / audit 陈旧检测 |
| `plugin/loop/*-loop-tick.md` | AC5 双触发源：tick 心跳必跑 `--audit`（与 `sync-lag-check.sh` 同款） |
| `plugin/scripts/capability-catalog.sh` | 新增 shipped check 的问题声明（observer-registry.sh 进入交付面，须声明它使什么问题可提问） |

### Contract 计量（before/after 一致）

```
measure registered_targets    = 3     # --list --json | python3 len(...)
measure stale_observer_reports = 0    # --audit --json | python3 sum(consumers[].stale)   band = 0
invoke: bash plugin/scripts/observer-registry.sh --list
```

### AC1 实跑

```
$ bash plugin/scripts/observer-registry.sh --list
NAME             STATUS   ROOT                                         TMUX-SESSION     NOTE
quay             active   /home/yale/work/quay-worktrees/observer-registry quay-0           本仓库（项目类）
meta-cc          active   /home/yale/work/meta-cc                      meta-cc          兄弟项目
archguard        active   /home/yale/work/archguard                    archguard        兄弟项目

$ bash plugin/scripts/observer-registry.sh --list --json
[{"name": "quay", "status": "active", ...}, {"name": "meta-cc", ...}, {"name": "archguard", ...}]
```

### AC3 负控制（承重条）实跑——登记 test-target 下线后 4 个消费者各采样一次

```
# 消费者 1 os-anchor-watchdog --check（不再复活已下线目标）
$ OBSERVER_REGISTRY_FILE=<tmp> bash plugin/scripts/os-anchor-watchdog.sh --check test-target --config <cfg>
STATUS test-target decommissioned (offline per observer-registry — not re-spawning)

# 消费者 2 & 3 git-staleness / session-liveness-coverage（session-liveness --once 读面）
$ OBSERVER_REGISTRY_FILE=<tmp> SESSION_TARGETS="test-target /tmp/observer-test-root test-sess:outer" bash plugin/scripts/session-liveness.sh --once
SESSION-STATUS test-target decommissioned (offline per observer-registry)

# 消费者 4 session-topology（topology-check --session）
$ OBSERVER_REGISTRY_FILE=<tmp> bash plugin/scripts/topology-check.sh --session test-sess
test-sess decommissioned (offline per observer-registry — not watched)

# 审计 = 同一负控制的机械化（stale_observer_reports=0）
$ OBSERVER_REGISTRY_FILE=<tmp> bash plugin/scripts/observer-registry.sh --audit --json
{"consumers": [{"name": "os-anchor-watchdog", "stale": false, ...},
  {"name": "git-staleness", "stale": false, ...},
  {"name": "session-liveness-coverage", "stale": false, ...},
  {"name": "session-topology", "stale": false, ...}],
 "offline_targets": ["test-target"], "all_fresh": true}
```

**负控制判定**：4 个消费者全部报「已下线」，无一报旧状态 ⇒ AC3 通过。陈旧检测路径单独验证：
把注册表 helper 置为不可执行（消费者跳过检查）时 `--audit` 报全部 stale 且退出 1（见测试 #5）。

### AC2 接线证明

| 消费者 | 之前（各自硬编码） | 之后（读注册表） |
|---|---|---|
| os-anchor-watchdog | `os-anchor-projects.conf` 每项目一条，手工注释掉下线项 | `watch_project` 先查 `observer-registry.sh --is-offline <name>` → `decommissioned`、不 re-spawn；installer 重建 watch-list 时跳过 offline 兄弟 |
| manager git-staleness | Monitor 里硬编码目标列表，对下线 archguard 持续报 REPO-STALL | 读面 = `session-liveness.sh`：offline 目标不评估 REPO-STALL（该事件只对 alive 目标发） |
| session-liveness-coverage | Monitor 里硬编码，对下线 B 报 NOT-WATCHED | 读面 = `session-liveness.sh`：offline 目标报 `SESSION-STATUS <name> decommissioned` |
| session-topology | Monitor 持有目标会话列表 + 陈旧缓存 | `topology-check.sh --session` 先查 `--is-offline-session <sess>` → `decommissioned`（注册表压过缓存） |

### AC4 交叉标注

`tasks/gap-os-anchor-watchdog-lease-model-instead-of-absence-inference.md` 已加交叉标注：那条是本类第一个
实例（os-anchor 的 absence-inference），本条是类级机制，覆盖另外三个消费者（其中案例 4 是缓存陈旧，
不是 absence-inference）。租约方向（显式声明替代缺席推断）与注册表方向一致且互补。

### AC5

下线登记 = 显式 `--register-offline <name> [--note ...]`（人/manager），观测者从不自行猜；
对不在注册表里的目标 `--register-offline` fail-closed（exit 2）。无新系统 crontab：观测者保留各自既有
触发，注册表只是每次读取时先查；`--audit` 与 `sync-lag-check.sh` 同款双触发源（tick 心跳必跑 + land 后
事件驱动），见 `plugin/loop/fast-mode-loop-tick.md` §4b / `orchestrator-loop-tick.md` §3d。

### 测试

- `plugin/test/observer-registry.test.mjs`：5/5 绿（AC1 / AC2+AC3 / AC2 无假阳性 / AC5 / audit 陈旧路径）。
- 相关既有测试 `os-anchor-watchdog` / `session-topology` / `sync-lag-check`：23/23 绿。
- `session-liveness.test.mjs`（含本次改动）：单独跑 **49/49 绿**（含本次改动；quay-init laydown 的两条
  `AC2/AC3/AC7` 起初红——根因是 tick doc 引用了 `orchestration/observer-registry.conf` 但未声明
  self-create，已修：在 `plugin/skills/init/SKILL.md` 加 `<!-- self-create: orchestration/observer-registry.conf -->`
  + `--register-offline` 缺文件时自创建；修复后该两条绿）。并发满载下偶发时序翻红（CANT-SEND 8s 窗口 /
  noise gate），单独运行稳定绿——非本次改动引入。
- scoped 静态层（`--for-task gap-observer-registry-target-decommission-and-criterion-invalidation --allow-thin`）：56/56 绿。
- **完整套件（3 轮）**：每轮 `cancelled 0`；`fail` 全部为**环境性负载抖动**（见下），与本任务改动无关——
  逐一在隔离下复跑均绿。DoD「连跑 2 次全绿」在本机无法满足（见下）。

  | 轮次 | tests / pass / fail / cancelled | fail 明细（全部可在隔离下通过） |
  |---|---|---|
  | #1（初始环境，含残留递归进程） | 2871 / 2821 / 5 / 0 | flags-only(300s 门卫) + A1 + verbatim + AC4 pane + AC9 RESUMED |
  | #2（清理后） | 2871 / 2821 / 5 / 0 | flags-only(300s 门卫) + verbatim + AC3 drift + AC4 OVERDUE + AC9 runtime |
  | #3（孤儿进程清除后） | 2871 / 2824 / 2 / 0 | flags-only(300s 门卫) + AC10 gitignore |

  **flags-only 失败是稳定的环境约束，非本任务引入**：该测试 spawn `scripts/test.sh --group governance
  --test-concurrency=8`，嵌套调用先查资源门（`resource-gate.sh --for full-suite`，cpu some avg10 < 40 才 GO）。
  本机基线 CPU 压力 avg10 实测 **52–70 ≫ 40**（共享机，manager 的 inner/outer claude 会话常驻），
  因此嵌套调用总是 WAIT、不产出 `ℹ tests` 摘要 → 该测试 300s 超时失败。**隔离复跑同样失败**
  （`fail 1`, 600s）——机因是本机基线负载触发了资源门，与本任务改动无关（本任务不触碰资源门/runner-grouping
  路径；`resource-gate.sh` 在无任何套件运行时即 WAIT，avg10 52–70）。其余 fail 每轮不同、均在隔离下通过
  （真实 tmux probe + 8s/去抖时序窗口在负载下偶发超时）。
  **DoD「完整套件连跑 2 次全绿」保持未勾选**——在本机资源门恒 WAIT 的环境下无法诚实达成；
  相关测试 + scoped 静态层 + 静态检查全部绿，属本任务的诚实交付面。

### 本类登记册（4 个已知实例，2026-08-06 一晚）

| # | 消费者 | 假信号 | 本机制如何处理 |
|---|---|---|---|
| 1 | os-anchor-watchdog（systemd timer） | 复活了刚被裁定停掉的 archguard 会话 | `watch_project` 查注册表 → 已下线即 `decommissioned`、不 re-spawn |
| 2 | manager 的 git-staleness Monitor | 持续给已下线的 archguard 报 `REPO-STALL`（越报越大） | `session-liveness.sh` 对 offline 目标不评估 REPO-STALL |
| 3 | manager 的 session-liveness coverage Monitor | 给已下线的 B 报 `NOT-WATCHED` | `session-liveness.sh` 报 `SESSION-STATUS <name> decommissioned` |
| 4 | manager 的 session-topology Monitor | B 会话已终止仍报 `quay-b:outer=claude`（陈旧缓存） | `topology-check.sh` 查 `--is-offline-session` → `decommissioned`（注册表压过缓存） |

### 后续消费者接入方式

新观测者只需一步：每次读取目标时先 `bash plugin/scripts/observer-registry.sh --is-offline <name>`（或按
tmux-session 用 `--is-offline-session <sess>`），已下线即报「已下线」并跳过判据评估；不要自建目标列表、
不要自猜下线。注册表文件默认 `orchestration/observer-registry.conf`，`OBSERVER_REGISTRY_FILE` 可覆盖。
