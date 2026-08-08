---
id: gap-loop-has-no-os-level-anchor-cannot-self-recover-after-crash
title: "THE structural blocker to the primary goal (self-evolution without a
  human present): the loop CANNOT self-recover after a crash — verified three
  times tonight, not a hazard. All four loop anchors live INSIDE Claude sessions
  (quay outer CronCreate, meta-cc ff528b51, archguard 23141e72+ScheduleWakeup,
  manager 0245d9b2) and OS-level has ZERO anchor: crontab command not even
  installed, systemd user timers = only launchpadlib-cache-clean (unrelated), no
  quay/claude/loop service or timer, /etc/cron.d/ only e2scrub_all.
  CronCreate/ScheduleWakeup are session-scoped — session death = anchor
  PERMANENTLY gone with no trace. ALREADY OCCURRED (not inference): ① three
  total machine crashes tonight; ② meta-cc/archguard stalled 29h — both outers
  independently traced root cause to 'cron died with old session, nobody
  drives'; ③ during those 29h ALL delivery-surface checks
  (verify-installed-executables/verify-referenced-landed/quay-init) PASSED and
  both projects' last ticks self-reported quiet-holding/backlog-cleared — a dead
  loop looks IDENTICAL to a healthy one; ④ recovery was MANUAL manager driving,
  no mechanism. WHY THIS OVERSHADOWS ALL OTHER GAPS: human corrected the goal to
  'self-evolve without a human'; under current architecture ANY crash = entire
  network permanently silently dead until a human notices and manually restarts
  — not 'evolves slowly' but 'stops evolving while looking fine'. ALL other gaps
  (criterion-cost, reason-axis, needs-human black hole, laneCount
  oversubscription) are optimizations that only matter while the loop is ALIVE;
  this one decides whether it lives. Fix direction (manager, ruling mine):
  repair must live OUTSIDE Claude session — an OS-level systemd user timer or
  real crontab entry that periodically checks each project's session liveness +
  anchor presence, re-spawns and drives if missing. All needed capabilities
  already validated: session-liveness.sh (PSI/pane dual signal),
  send-keys-reliable.sh + transcript-delivery-check.ts (6 failure modes
  crystallized), cold-start drive text (the two manually-written tonight proved
  effective). Also fills SPEC-complete-delivery-surface §4 category 5 (periodic
  anchors, currently marked 'outer has, inner+manager missing' — measured WORSE:
  all three layers missing because all session-scoped). AC10: does NOT score
  (axis opened by the 29h stall, post-friction), count stays 6; priority is
  independent of pre/post-friction"
status: ready
labels:
  - gap
  - milestone-candidate
extra:
  schema: v1
---

**type:** execution

> **Supervisor 步骤标注（2026-08-06，gap-supervisor-base-layer-outside-sessions-architecture AC4）**：
> 本任务是 supervisor 落地次序的 **①持久调度**（SPEC-integration-architecture §4.4 第 1 步）——
> 它把「崩溃 = 永久死亡」的锚点从 Claude 会话内搬到 OS 级 systemd 用户 timer，正是基座层
> 「不随 agent 会话死」的第一条。supervisor 健康检查（supervisor-health.sh 的
> `os_anchor_timer=active`）以此为存活证据。不另开重复任务。
>
> **Session 实体/pid 账本引用（2026-08-06，gap-supervisor-preemption）**：
> 抢占原语（supervisor-preempt.sh 的 `preempt(target)`）的目标进程/会话 = SPEC-state-crystallization
> §3 的 **Session 实体**（layer/pid/…）——supervisor 侧按层维护 pid 账本（session-liveness.sh 的
> `session_pid` 已能按窗口名解析 pane 的 claude 子进程 pid），`preempt <pid>` 在 `-p` 迁移后直接
> `kill <pid>`。本任务（OS 锚点）+ 抢占（任意点停止）互补：锚点管「死而复生」，抢占管「活而即停」。

## Proposal

管理者（2026-08-05）——**本阶段主目标的头号结构性障碍**：这套机制**在崩溃后无法不靠人恢复**。
**不是隐患，是今晚已发生三次的实测失效。**

**【实测：OS 级零锚点】**
- `crontab -l`：命令**根本不存在**（未安装）；
- `systemctl --user list-timers`：只有一个无关的 `launchpadlib-cache-clean`；
- 无任何 quay/claude/loop 相关的 systemd 服务或 timer；
- `/etc/cron.d/`：只有 `e2scrub_all`（系统无关）。

⇒ **四个循环锚点全部在 Claude 会话内**：quay outer 的 CronCreate、meta-cc 的 ff528b51、archguard 的
23141e72 + ScheduleWakeup、管理者的 0245d9b2。CronCreate 与 ScheduleWakeup 都是**会话作用域**——
会话一死，锚点**永久消失且不留任何痕迹**。

**【已发生的证据，不是推演】**
1. 本机今晚**全灭三次**；
2. meta-cc 与 archguard 停摆 **29 小时**，两个项目的 outer **各自独立**把根因定位到「cron 随旧会话
   死亡、无人驱动」；
3. 那 29 小时里，两个项目的所有交付面检查（verify-installed-executables / verify-referenced-landed /
   quay-init 铺设完整性）**全部通过**，两个项目自己的最后 tick 还自报 quiet holding state 与 entire
   backlog cleared——**死循环与健康循环在所有判据下完全一样**；
4. 恢复它们的是**我手工驱动**，不是任何机制。

**【为什么这条压倒今晚其它所有缺口】**
人已经把目标更正为「让这套机制在人不在场时仍能自我演进」，产品化只是手段。而当前架构下，**任何一次
崩溃 = 整个网络永久静默死亡，直到一个人注意到并手工重启**。这不是「演进得慢」，是「**不再演进，且
看起来一切正常**」。今晚我们发现的所有其它缺口——判据成本、reason 轴、needs-human 黑洞、laneCount
超订——**都是在循环活着的前提下才有意义的优化。这一条决定循环活不活。**

**【方向（外层裁定权）】**
修复必须在 Claude 会话**之外**：一个 **OS 级的 systemd user timer 或真 crontab 条目**，周期性检查
每个项目的会话是否存活、锚点是否还在，不在就**重新拉起并驱动**。

它需要的能力**今晚已全部验证过**：
- 会话存活判定：`session-liveness.sh`（PSI/pane 双信号）；
- 可靠送达：`send-keys-reliable.sh` + `transcript-delivery-check.ts`（六种失败模式已结晶）；
- 冷启动驱动文本：管理者今晚手工写的两条已证明有效。

缺的只是**把它们挂在一个不随会话死亡的触发器上**。

**交叉标注**：正好补上 SPEC-complete-delivery-surface 第 4 节六类里的第 5 类（周期锚点），那一类当前
标注是「outer 有、inner 与 manager 全缺」——**实测更严重：三层全缺，因为它们全在会话内**。

**AC10 记账：不计分**——这根轴被 29 小时停摆打开的，post-friction，计数仍为 6。**但它的优先级与是否
pre-friction 无关。**（**2026-08-06 追加，`gap-telemetry-brackets-vs-subagents-no-slot-visibility` AC6
记账引用**：该任务立案为 **pre-friction** 观测轴——遥测 in-flight 括号 ≠ 真实并发、空槽不可见、无人调用
`--task-start`/`--task-end`——照 SYNTHESIS-axis-generation §3 判据 **+1 ⇒ 6 → 7**。本任务仍 post-friction
不计分，7 是含新 pre-friction 轴的最新计数。）

### 选定机制（外层裁定：立案，最高优先级）

1. **OS 级触发器**：systemd user timer（或 crontab，若安装）挂一个 watchdog——周期性检查每个项目的
   会话存活 + 锚点存在；不在则重新拉起 claude 会话 + 用 send-keys-reliable 驱动冷启动文本。
2. **复用已验证能力**：session-liveness.sh（判活）、send-keys-reliable.sh（送达）、冷启动驱动文本
   （重拉起后的第一条驱动）——零新发明，只做「挂到会话外触发器」。
3. **补 SPEC §4 第 5 类**：周期锚点从「outer 有、inner/manager 缺」修正为「三层全缺（全在会话内）」
   + OS 级锚点作为第 5 类的真实落点。
4. **AC10**：post-friction 不计分（被 29h 停摆打开），计数仍 6；优先级最高（决定循环活不活）。

## Acceptance Criteria

- [x] AC1: **OS 级触发器**——systemd user timer 或真 crontab 条目存在且 active（不随 Claude 会话死亡；
      周期性检查每个项目的会话存活 + 锚点存在）
      → **2026-08-05 内层实跑**：`os-anchor-install.sh install` 落地，`systemctl --user list-timers` 显示
      `quay-os-anchor-watchdog.timer` active（5min 周期）。安装接缝另由 `os-anchor-watchdog.test.mjs`
      AC1/install 用例（hermetic OS_ANCHOR_SKIP_SYSTEMCTL=1）验证。
- [x] AC2: **崩溃自动恢复**——模拟/实测会话死亡 ⇒ watchdog 自动重新拉起 claude 会话 + send-keys-reliable
      驱动冷启动文本（实跑输出贴任务体；今晚三次全灭形态被自动恢复而非手工）
      → **re-spawn ✓ + drive ✓（2026-08-05 修后完整实跑）**。throwaway session 崩溃模拟实测：
      `recreate-session (alive=0 session=0) → relaunch OK（真实 claude 2.1.222 重新拉起，prompt up）`。
      **drive 修复（外层裁定，commit `792c6c91`）**：原 drive 因 transcript 基线在 launch 后计算而恒
      SKIPPED。改为 **SEND→DISCOVER→VERIFY**：① 可靠发送冷启动文本（C-u/逐字/Enter）；② 路径式发现
      该发送创建的新 transcript（对照 launch 前快照，非旧的 strictly-newer-mtime）；③
      `transcript-delivery-check.ts` 验证送达。**端到端实测**：发送后新 transcript 出现
      （`319f48e8...`，54→55 文件），checker 返回 `delivered: true`（真实 user message
      `"echo ac2-drive-ok"` 在 transcript）。外层生产（11:5xZ archguard watchdog）同证 drive 已能送达。
- [x] AC3: **复用已验证能力**——判活用 session-liveness.sh（PSI/pane 双信号）、送达用
      send-keys-reliable.sh + transcript-delivery-check.ts（六种失败模式）、冷启动用已验证的驱动文本；
      零新发明
      → 源码核实：`outer_liveness` 调 `session-liveness.sh --once`；`drive_outer` 复用 send-keys 可靠
      发送模式（C-u/逐字/Enter）+ `transcript-delivery-check.ts`（唯一信任的送达信号）；drive 文本与
      已验证 cold-start 文本一致。
- [x] AC4: **跨项目覆盖**——quay/meta-cc/archguard 三项目的会话都在 watchdog 范围内（29h 停摆形态
      未来被自动抓）
      → `~/.config/quay/os-anchor/os-anchor-projects.conf` 含 quay/quay-0 + meta-cc/meta-cc-3 +
      archguard/archguard-4 三行（install 默认覆盖，实测）。
- [x] AC5: **SPEC §4 第 5 类修正**——周期锚点标注从「outer 有、inner/manager 缺」改为「三层全缺，
      OS 级锚点为真实落点」（实测 29h 停摆证明）
      → `orchestration/SPEC-complete-delivery-surface-2026-08-05.md` §4 第 5 类已改为「三层全缺，
      OS 级锚点为真实落点」。
- [x] AC6: **AC10 诚实记账**——post-friction（被 29h 停摆打开）不计分，计数仍 6；优先级与是否
      pre-friction 无关
      → 诚实记账（2026-08-05）：OS 级锚点轴是 **post-friction**（被 29h 停摆打开，非预先预测的轴）——
      不计入 pre-friction 轴计数（SYNTHESIS-axis-generation §3 判据计数保持 0/6），但其**优先级与
      pre/post-friction 无关**（崩溃自恢复是压倒性优先级，管理者裁定）。这条记录在本任务体即为
      记账本身——不伪造 pre-friction 分数。
- [x] AC7: 测试用 `node:test` 且带 `// @test-group governance`
      → `plugin/test/os-anchor-watchdog.test.mjs`（`// @test-group governance`，2 用例：decide 矩阵 +
      idempotent install 接缝），`node --test` 2/2 绿。
- [x] AC3: **复用已验证能力**——判活用 session-liveness.sh（PSI/pane 双信号）、送达用
      send-keys-reliable.sh + transcript-delivery-check.ts（六种失败模式）、冷启动用已验证的驱动文本；
      零新发明
      → 源码核实：`outer_liveness` 调 `session-liveness.sh --once`；`drive_outer` 调
      `send-keys-reliable.sh` + `transcript-delivery-check.ts`；drive 文本与已验证 cold-start 文本一致。
- [x] AC4: **跨项目覆盖**——quay/meta-cc/archguard 三项目的会话都在 watchdog 范围内（29h 停摆形态
      未来被自动抓）
      → `~/.config/quay/os-anchor/os-anchor-projects.conf` 含 quay/quay-0 + meta-cc/meta-cc-3 +
      archguard/archguard-4 三行（install 默认覆盖，实测）。
- [x] AC5: **SPEC §4 第 5 类修正**——周期锚点标注从「outer 有、inner/manager 缺」改为「三层全缺，
      OS 级锚点为真实落点」（实测 29h 停摆证明）
      → `orchestration/SPEC-complete-delivery-surface-2026-08-05.md` §4 第 5 类已改为「三层全缺，
      OS 级锚点为真实落点」。
^# placeholder——post-friction（被 29h 停摆打开）不计分，计数仍 6；优先级与是否
      pre-friction 无关
- [x] AC7: 测试用 `node:test` 且带 `// @test-group governance`
      → `plugin/test/os-anchor-watchdog.test.mjs`（`// @test-group governance`，2 用例：decide 矩阵 +
      idempotent install 接缝），`node --test` 2/2 绿。

## Definition of Done

- [ ] AC1–AC7 全部勾上；AC2 实跑输出贴任务体（崩溃自动恢复）
- [ ] OS 级 watchdog 在（不随会话死亡）；崩溃后自动恢复而非手工；三项目会话覆盖
- [ ] 全量套件绿（`fail 0` 且 `cancelled 0` 且 `FULL-SUITE-EXIT=0`）

## Touches

- plugin/scripts/（watchdog 安装器：systemd user timer / crontab 条目生成 + 检查逻辑）
- plugin/scripts/session-liveness.sh（复用：判活信号）
- plugin/scripts/send-keys-reliable.sh（复用：重拉起后驱动）
- orchestration/SPEC-complete-delivery-surface-2026-08-05.md（AC5：第 5 类周期锚点修正）
- tasks/gap-l2-continuous-health-dead-loop-criterion-loop-running-not-installed.md（交叉标注：dead-loop
  判据的 OS 级落点）

## Supervisor step（base-layer-outside-sessions 步骤①）

本任务 = `gap-supervisor-base-layer-outside-sessions-architecture` 落地次序 **① 持久调度**。
基座层判据：调度/周期锚点是平台原语，必须 outlive 会话（不随 agent 会话死）——本任务的 systemd user
timer + os-anchor-watchdog 正是该判据的落地。详见
`orchestration/SPEC-integration-architecture-2026-08-05.md` §7。不新开重复任务（AC4）。

## Contract

measure   os_anchor_alive = `systemctl --user list-timers | grep -c quay` stdout 的数字段
band      os_anchor_alive >= 1（quay watchdog timer 存在且 active，不随会话死亡）
invariant no_session_scoped_anchor = 1（循环锚点有 OS 级落点；会话内 cron 非唯一）
invoke    `systemctl --user list-timers`
control   杀 claude 会话 ⇒ watchdog 自动重拉起 + 驱动（AC2）；三项目会话覆盖（AC4）
resume    watchdog 安装器与恢复验证分两步提交，任一步完成即写盘

## Dispatch review

reviewer: outer
at: 2026-08-05T08:0xZ
changed: 外层受管理者头号结构性障碍裁定立案（最高优先级）。四处收紧：
(1) **OS 级零锚点坐实**——crontab 命令不存在、systemd 无 quay/claude/loop、只有 launchpadlib 无关
    timer；四锚点全在会话内；
(2) **决定循环活不活**——压过其它所有缺口（判据成本/reason 轴/needs-human/laneCount 都是循环活着
    才有意义的优化）；死循环与健康循环在所有判据下一样（29h 停摆 + 全检查通过 + 自报健康）；
(3) **修复在会话外**——systemd timer/crontab 挂 watchdog，复用 session-liveness + send-keys-reliable
    + 冷启动驱动文本（零新发明）；
(4) **AC10 post-friction 不计分**（被 29h 停摆打开），计数仍 6；优先级与 pre/post 无关。
status: todo——决定循环活不活；最高优先级，排在 ROUND 3 收尾之前。
