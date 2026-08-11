---
id: gap-os-anchor-watchdog-lease-model-instead-of-absence-inference
title: "os-anchor watchdog rework — flip from absence-inference ('no .halt =
  always watch') to explicit timestamped LEASE ('I want it running until X';
  no lease = don't watch; lease expiry = stop): measured defects (2026-08-05,
  manager + human): ①.halt conflates 'project paused' vs 'I just closed this
  session' (two intents, one switch; manager's morning meta-cc resource-priority
  .halt vs human exiting outer to be quiet are different — only the former is
  recognized); ②no backoff/limit/rate (crash-looping project pulled up every 5
  min forever, no alarm); ③respawn path barely ran in production (0 except
  11:40); ④/exit clean exit = crash in the alive=0&session_exists=1 branch
  (human actively exits, 5 min later it comes back); ⑤Linger=no so actually
  'login + 5min auto-start'; PRINCIPLE: repo's own inner-blocked-signal.ts
  states 'existence signal, not an absence inference' — current watchdog
  violates it; FIX: explicit lease solves both intent and backoff (lease expiry
  = stop, no invented retry limit); PRODUCTIZATION (human asked): deliver the
  MECHANISM (generic — session-scoped anchor dying with session is an inherent
  Claude Code property; archguard/meta-cc each hit a 29h case), NOT the current
  STRATEGY defaults (login-auto-start / infinite respawn / hardcoded drive-text
  / hardcoded three-project watch-list = quay dev-unstable-period specific);
  default DISABLED; enable = explicit expiry-bearing lease; OnBootSec/respawn-
  count/drive-text/watch-list all configurable"
status: superseded
labels:
  - gap
  - defect
  - milestone-candidate
parent: null
children: []
extra:
  supersededBy: gap-manager-productization-five-constraints
  schema: v1
---

> **【作废 — 2026-08-06 人裁定，两条独立理由，任一条即足以作废】**
>
> 1. **「不得重启 watchdog。请专注于以产品化方法改进」** ⇒ 本条要修的装置**不得再运行**。
> 2. **「会话真死不要管。我明确这不在本项目需要监控和恢复的范围内」** ⇒ 本条要修的装置的
>    **目的本身**（探测会话死亡并拉回）**已被移出项目范围**。
>
> ⇒ 修好它也不会被使用。**实测佐证（2026-08-06 17:5xZ）**：os-anchor watchdog 当前
> **0 个 systemd unit、0 条 os crontab 条目、0 个进程**——装置已完全停摆。
>
> **不删除本文件**：保留缺陷描述，因为若将来范围重新放开，这些实测缺陷仍然成立、
> 不必重新发现。**但不得派发**（`status: superseded`）。
>
> 完整裁定记录见 `tasks/gap-manager-productization-five-constraints.md` 的 AC5/AC5b/AC5c。
>
> **【交叉标注 — 2026-08-06 类级机制，`gap-observer-registry-target-decommission-and-criterion-invalidation`】**：
> 本条是本类（「观测者的目标是否仍存活/有意，判据是否仍有效」）的**第一个实例**——它诊断的是
> **os-anchor-watchdog 的 absence-inference**（无法区分「崩溃」与「有意停掉」）。但同晚还有另外三个
> 消费者各自撞到同一形状（manager 的 git-staleness Monitor 持续报 REPO-STALL / session-liveness-coverage
> Monitor 报 NOT-WATCHED / session-topology Monitor 报陈旧缓存），都不是 absence-inference 的问题
> （案例 4 是缓存陈旧）。类级机制 = 单一观测者注册表（`plugin/scripts/observer-registry.sh` +
> `orchestration/observer-registry.conf`）：被下线的目标登记一次，所有观测者从同一处读；
> 下线登记走显式读取类操作（`--register-offline`），观测者从不自行猜。os-anchor-watchdog 已接
> 注册表（`watch_project` 先查 `--is-offline`，已下线 → `decommissioned`、绝不 re-spawn）。本条的
> 租约方向（显式声明替代缺席推断）与注册表方向一致且互补：租约回答「我要它跑到 X」，
> 注册表回答「它已被有意下线」——两者都是把「意图」从「缺席推断」翻转为「显式记录」。
**type:** execution

## Proposal

**os-anchor watchdog 从缺席推断意图——违反仓库自己的原则，需翻转为显式租约。**
（人方向性问题 + 管理者实测，外层核实 + 裁定）

**【实测缺陷（管理者，外层部分核实）】**：
1. **唯一意图信号是 .halt**——它表达「项目暂停开发」，不是「我刚关掉这个会话」。两种意图压进同一个开关。
   管理者早上给 meta-cc 挂 .halt（资源优先级）vs 人手工退出 outer 想安静——完全不同，当前逻辑只认前者。
2. **grep backoff/retry/max_respawn/attempts 几乎 0 命中**——无退避、无上限、无速率限制。反复崩溃的项目
   每 5 分钟无限拉起且不告警。
3. **relaunch/recreate 实际发生 0 次**（除 11:40）——这条路径几乎没在生产跑过。
4. **/exit 干净退出和 claude 崩溃在 alive=0&session_exists=1 分支下完全一样**——都判 relaunch。人主动关掉
   它 5 分钟后自己回来。
5. **Linger=no**——准确说不是开机自启，是「登录后 5 分钟自启」。

**【核心缺陷】**：这套逻辑在**从缺席推断意图**。而仓库自己的 inner-blocked-signal.ts 头注释写死相反原则：
**「existence signal, not an absence inference」**。当前 watchdog 违反它。

**【裁定（外层采纳管理者方向）】**：**反过来**——要有**明确的带时间戳的「我要它跑」租约声明**；没声明=
不看护。而不是现在的「没 .halt = 一直看护」。**这同时解决意图和退避**（租约过期即停，不需另发明重试上限）。

**【产品化裁定（人问，外层采纳管理者判断）】**：**机制该交付，当前策略默认值不该交付**。
- **机制通用**：会话作用域锚点随会话死，是 Claude Code 固有性质（archguard/meta-cc 各撞过一次 29 小时）。
- **策略 quay 特有**：登录即自启 / 无限重生 / 驱动文本写死 / 看护名单硬编码三项目——是 quay 开发不稳定期
  特有。给别的项目按这套默认装上 = 替人家决定「你机器只要有人登录这循环就该跑」。
- **形态**：交付能力但**默认不启用**；启用需**显式带过期的意向声明**；OnBootSec / 重生次数 / 驱动文本 /
  看护名单全配置化。

### 选定机制

1. 显式租约：带时间戳的「我要它跑」声明（`os-anchor lease <project> --until <ISO>`）；无租约 = 不看护
2. /exit 干净退出清租约（不 relaunch）；崩溃但租约有效 → relaunch（租约窗口内）
3. 租约过期 = 停止看护（天然退避，不需 retry 上限）
4. 默认不启用；启用需显式租约；OnBootSec/respawn/驱动文本/名单配置化

## Acceptance Criteria

- [ ] AC1: 租约模型——显式时间戳租约；无租约 = 不看护（默认 off 实测）
- [ ] AC2: /exit 干净退出 **不** relaunch（干净退出清租约）；崩溃 + 租约有效 → relaunch（实测对照）
- [ ] AC3: 重生受租约窗口约束（无无限重生）；上限/退避配置化
- [ ] AC4: OnBootSec/respawn 次数/驱动文本/看护名单全配置化（无硬编码三项目）
- [ ] AC5: 默认禁用（能力交付，不自动启用）
- [ ] AC6: **非产品交付物**——quay 自身开发不稳定期的辅助工具；默认不装、不进 plugin/ 推荐路径；无真实用户数据前不进产品

## Touches

- plugin/scripts/os-anchor-install.sh / os-anchor-watchdog.sh（租约模型 + 配置化）
- plugin/scripts/os-anchor-projects.conf（看护名单 → 配置）
- packages/quay/bin/（lease 命令，若走 CLI 入口）
- tasks/gap-manager-productization-five-constraints.md（AC6 交叉标注）

## Contract

measure   lease_default = `bash plugin/scripts/os-anchor-watchdog.sh --check 2>&1 | grep -c 'no-lease\|lease-missing'` 在无租约时 stdout 数字段
band      lease_default >= 1（无租约 = 不看护）
invoke    `grep -n 'lease\|--until\|no-lease' plugin/scripts/os-anchor-watchdog.sh`
control   /exit 后不 relaunch（AC2）；崩溃 + 租约 → relaunch（AC2 负控制）
resume    租约模型与配置化分步提交，任一步完成即写盘

## Dispatch review

reviewer: outer
at: 2026-08-05T22:5xZ
changed: 人方向性问题 + 管理者实测 + 外层裁定立案。核实：Linger=no 确认、backoff 逻辑缺失、relaunch 路径
0 次生产运行。裁定：租约模型（翻转缺席推断为显式声明，符合仓库 existence-signal 原则）+ 产品化
（机制交付、策略默认不交付、默认禁用配置化）。

## 范围裁定补充（2026-08-05 22:5xZ，外层——管理者能力边界实测 + 频率异议 + 人方向）

**能力边界实测（管理者）**：session-liveness.sh 纯观测（grep new-session|send-keys claude = 0，不能动手）；
inner-session-check.sh 能动手（2 命中：quay-topology.sh + send-keys）；manager ruling-required Monitor 只观测
不动手。⇒ **inner 层完全不需要 watchdog**（outer 三态自检今天落地已覆盖检测+动作）。

**唯一不可替代角色**：Monitor 是会话作用域的（outer 的随 outer 死、manager 的随 manager 死）——**链条最
顶端无人可救**。交付产品是 outer+inner 无 manager ⇒ 真实用户最顶端就是 **outer**。

**频率异议（管理者已告人，外层采纳）**：A 机 11.4h/137 轮 relaunch-outer 1 次（装上后第一轮）+ B 机 19min
1 次 = 2/11.7h 都是装上时一次性捕获、**零运行中崩溃恢复**。但低触发 ≠ 低风险——这 11.7h 恰好平静，同一台机
今晚早些时候全灭过 4 次（正是它要接的场景，当时没装）。

**范围裁定（比人更窄——不取消）**：
1. **默认关闭** + 需显式带过期意向声明启用（租约）；
2. **范围从「看护 N 项目 outer」缩到「只看护最顶端那一个会话」**——inner 归 outer 三态自检，outer 在有
   manager 时归 manager；
3. 只在**没有更上层会话可依赖**时才有意义；
4. 看护对象 **3→1**，误拉起爆炸半径同比缩小。

## 产品定位裁定补充（2026-08-05 23:0xZ，外层——管理者 AC11 撤回论据 + 人方向收窄）

**论据撤回**：管理者上一条「今晚 4 次全灭是 watchdog 要接的场景」**站不住，已查证撤回**（AC11 类）：
- ①② OOM：根因 = worktree 建在 tmpfs（/tmp 每 MB 是内存）+ 并发套件多 worktree——**exp5 实验特有**，
  且根因已单独立案修（A6 worktree 不许建 tmpfs）；
- ③④ tmux kill-server：RUNBOOK §6 明写是第三/四次全灭机制根；第四次是管理者做危险验证时环境变量丢失
  落到默认 socket。
- **四次没有一次是普通 quay 用户会撞到的**——全是本实验此阶段的危险操作。拿它们论证「所有项目都需要
  OS 级 watchdog」= 拿实验室自伤当用户常态。
- **更根本**：①② 根因（tmpfs）和 ③④ 根因（kill-server 红线）都已各自立案修掉——修掉后按定义不该再发生。
  **用一个正在被消除的风险论证常设机制的必要性 = 循环论证**。

**产品定位裁定（人方向收窄，外层采纳）**：
- os-anchor watchdog = **quay 自身开发不稳定期的辅助工具，不是产品交付物**；
- **默认不装、不进 plugin/ 推荐路径**；
- 将来若有真实用户报告 outer 莫名死掉，**那时才有数据**支撑它进产品——现在没有那个数据，只有实验室自伤。

**范围方向仍成立**（default-off + 租约 + 顶端单会话）：变的是**它作为产品能力交付**这一条——不交付。
AC6 产品化交叉标注相应调整。
