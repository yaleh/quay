---
id: gap-manager-productization-five-constraints
title: "manager productization (C1-C5, SPEC-manager-productization-2026-08-05):
  C1 plugin/ + npm pack must contain manager; C2 manager's home/state/identity
  must NOT belong to any single project (current instance lives in quay-0:manager
  cwd=/home/yale/work/quay — violates C2/C3); C3 outer NEVER creates/drives/
  checks manager (mechanical grep check, currently 0 mentions in tick doc);
  C4 independent cold start (quay manager start, accepts NO project args);
  C5 two commands separated (manager start ≠ manager adopt; AC12b testability:
  'adopt 之后 manager 对该项目动作次数=0'); SHARPEST GAP: manager not in
  os-anchor-projects.conf + */17 heartbeat is session-only CronList = the
  watchdog has NO ONE watching it, 4 crashes tonight needed human restart
  (direct manifestation); RULED: dual-creator conflict = option ① whoever
  finds missing inner creates via SAME idempotent entry (quay-topology.sh +
  single-flight lock), NOT centralized to manager — shipped quay = outer+inner,
  manager optional, centralizing kills single-project self-healing (contradicts
  'manager for cross-project'); split: manager-phase-goal.md product-behavior
  (axis-open/verification-first/boundary) → plugin/loop/manager-loop-tick.md,
  experiment state stays orchestration/"
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

**manager 产品化——人给五条约束，管理者写成规格（SPEC-manager-productization-2026-08-05），外层裁定立案。**

**当前实例违反四条（实测，非设计讨论）**：tmux 位置 quay-0:manager（在 quay 会话里）、cwd=/home/yale/
work/quay、transcript 在 quay 目录、目标文档签入 quay 仓库、plugin/loop/ 无 manager 文档——C1/C2/C3
各违反。唯一没违反的是 C3 一半（quay-topology.sh 已改 ROLES="outer inner"）。

**最尖锐缺口（§2.1，外层实测确认）**：`os-anchor-projects.conf` 只看护 quay/meta-cc/archguard 的 outer，
**manager 不在名单**；其 */17 心跳 CronList 显示 [session-only]。**看门人自己无人看门**——会话一死心跳
无声消失，今晚四次全灭都靠人重启 manager，是这条缺口的直接表现。

**外层已裁定（§7 双创建者冲突）**：选 **选项①**——谁发现缺失谁创建，但走**同一幂等入口 + 锁**
（quay-topology.sh 加单飞锁）。不选②（创建权收归 manager）：shipped quay = outer+inner、manager 可选，
收归后不装 manager 的单项目用户失去自愈能力，与「manager 通常用于跨项目」矛盾。

**外层已裁定（§6 切分）**：manager-phase-goal.md 混装——产品侧 manager 行为（AC10 开轴 / AC11 验证先被
验证 / 边界纪律）按「动词留文本」进 `plugin/loop/manager-loop-tick.md`；本实验阶段状态（测什么/B 机怎么用/
archguard 排位）留 `orchestration/`。

**外层已裁定（§3 归属）**：建造 = quay outer/inner（manager 是 quay 产品组件）；运行 = 人或 OS 锚，
**绝不是 outer**。`orchestrator-loop-tick.md` 不得出现创建/驱动/检查 manager 的步骤——**机械检查**（当前
0 提及，自然通过；做 checker 防回归）。

**manager 越界机械信号（§5）**：manager 需要新观测/判定能力 ⇒ 产出应是转给外层的需求，不是自己写脚本；
manager 手里出现 .sh/.ts 实现即越界信号。

### 选定机制

1. `quay manager start`（无项目参数）：独立 session（quay-manager）+ $QUAY_GLOBAL_DIR/manager/ 家 +
   自己的 systemd unit（与项目 watchdog 分开）+ 观测器由 start 挂 + 心跳非会话作用域
2. `quay manager adopt <root>`：三态复用 inner-session-check.sh 判定（healthy/empty-shell/missing，
   **不写第二份**）——已活 noop / 空壳驱动 / 缺失调 quay-topology.sh 建两窗口 + 登记 OS 锚看护名单
3. 双创建者：谁发现缺失谁创建，quay-topology.sh 加单飞锁（原子创建）
4. 机械检查：grep 断言 orchestrator-loop-tick.md + plugin/loop 模板无创建/驱动/检查 manager 步骤
5. 验证：离乳判据——只有 git+claude 的机器，manager start + adopt 两项目，杀 manager 会话 ⇒ OS 锚
   拉回，两项目不受影响

## Acceptance Criteria

- [ ] AC1 (C4/C5): `quay manager start`（无项目参数）独立拉起 manager + `quay manager adopt <root>`
      三态复用 inner-session-check.sh（不写第二份判定）
- [ ] AC2 (C2): manager 家/身份迁出 quay 项目——独立 session + $QUAY_GLOBAL_DIR/manager/ +
      自己的 systemd unit（与项目 watchdog 分开）
- [ ] AC3 (C1): plugin/ + npm pack 产物含 manager（build 归属 outer/inner）
- [ ] AC4 (C3): 机械检查——orchestrator-loop-tick.md 与 plugin/loop 模板无创建/驱动/检查 manager 步骤
      （grep checker 接 static checks）
- [ ] AC5 (§2.1，**2026-08-06 改写：原文依赖 OS watchdog，人已裁定禁用该路径**):
      manager 的调度锚点**只能用 Claude Code 自己的 loop / cron**（`/loop` → `CronCreate`）。

      **人的三条裁定（2026-08-06，全部为禁止式，按约束力排序）**：
      1. 「**不得重启 watchdog**。请专注于以产品化方法改进」 ⇒ OS watchdog 路径关闭
      2. 「注意与 **os 提供的 cron** 区分」 ⇒ OS crontab 不是本 AC 的达成手段
      3. 「**禁止使用 Desktop 定时任务。仅可使用 Claude Code 的 loop 或 cron**」
         ⇒ 即使将来某台机器装了 Desktop app，这条路**依然关闭**（裁定不随环境变化而失效）
      **原 AC5 文本（"OS 锚看护名单含 manager 或独立 unit"）当前无路可走，故改写。**

      **实测的三条产品路径与各自的结论**（`code.claude.com/docs/en/scheduled-tasks` 对照表，
      manager 2026-08-06 实查）：

      | | Cloud Routines | Desktop 定时任务 | `/loop`（CronCreate） |
      |---|---|---|---|
      | 需开着会话 | 否 | **否** | **是** |
      | 跨重启持久 | 是 | **是** | 仅 `--resume` 且未过期 |
      | **访问本地文件** | **否（fresh clone）** | 是 | 是 |
      | 最小间隔 | 1 小时 | 1 分钟 | 1 分钟 |

      - **Cloud Routines 结构性不可用**——fresh clone、无本地文件访问，
        而 manager 必须读本地 git 状态、跑本地脚本、驱动本地 tmux。
      - **Desktop 定时任务：人明令禁止**（裁定 3）。附带实测：本机也确实不可用——
        无 Desktop 进程、无 `~/.claude/scheduled-tasks/` 目录，本机是无头 Linux。
        **但禁令独立于这条实测成立**：换一台装了 Desktop 的机器也不得使用。
      - ⇒ **`/loop` / `CronCreate` 是唯一允许路径**，其会话级限制是**产品固有属性**，
        不是本仓缺陷 ⇒ 本 AC 不得以"换一种调度器"来达成，只能在会话级限制内解决。

      **今晚锚点丢失的精确机制（实测，非推断）**：`plugin/scripts/quay-launch.sh:78` 是
      `CMD=( "$LAUNCHER" "--settings" "$SETTINGS_ARG" )`——**不带 `--resume`**。崩溃后
      `session-bootstrap.sh` → `quay-launch.sh` 起的是**全新会话**，而文档原文：
      **「Starting a fresh conversation clears all session-scoped tasks」** ⇒ manager 的
      `*/17` cron 静默消失，93 分钟无锚点，直到人开口问才被发现。
      文档同时给出解法：**「Resuming with `claude --resume` / `--continue` restores tasks
      that have not expired（recurring 任务 7 天内）」**。

      **⇒ 本 AC 的达成形态（两条都要，缺一不可）**：
      1. **起会话时锚点确定性重建**——`quay manager start`（AC1）必须把「装上 manager 自己的
         `/loop`」作为其中一步，使**冷启动后锚点必然在位**，而不是靠谁记得。
         是否用 `--resume` 由执行时权衡并记录理由：`--resume` 保住 cron 但会继承可能已饱和的
         上下文（**B 机 outer 今日正是撞 100% context 死的**），全新会话上下文干净但丢调度。
      2. **状态持久化，不依赖会话**——见 AC5b。
      3. **跨 `/clear` 与 `/compact` 的稳定行为**——见 AC5c（人 2026-08-06 指路借鉴 manda）。

      **负控制**：起完 manager 后 `CronList` 必须显示恰好一个 manager loop；
      杀掉会话再按 AC1 重起 ⇒ `CronList` 必须再次显示恰好一个（不是零、不是两个）。

- [ ] AC5c (**2026-08-06 新增；人指路：「manda 虽然有其它的问题，但在使用 loop 提供跨 clear /
      compact 操作的稳定行为方面是值得借鉴的」**):
      **`/clear` 与 `/compact` 不杀会话——cron 照常触发，但上下文没了。**
      这是与 AC5（会话死）**不同的失效模式**，且更常见：本会话今日已发生一次 compaction。

      **从 `manda/plugin/skills/manda-monitor/SKILL.md` 实读到的两条机制（原文引用）**：

      1. **触发后的行为「现读」，不留在上下文里**——
         > *"Runtime — what to do when an event arrives — is out of scope: it is `Read`
         > fresh from `reference/` at the instant you act, never recalled from here
         > (**a Monitor outlives /clear ∧ compaction, so this text may be gone by then**)."*

         ⇒ 技能体只装「如何武装」，**不装「触发后做什么」**。上下文被压缩也无从降级——
         因为本来就没指望上下文里有东西。
         **现状**：manager 的 cron prompt 已是指向 `orchestration/manager-loop-tick.md`
         的指针（本条**天然满足**），但这是碰巧，**没有写成约定** ⇒ 需固化为规则：
         **manager loop 的 prompt 不得携带指令内容，只得携带指针。**

      2. **身份用可推导的哨兵串，不用记住的 ID**——
         > *`Sentinel = "manda-monitor " <> name` — **identity across /clear; NOT a task id***
         > *…… **Sweep by sentinel, never by remembered id.***

         ⇒ 武装前**无条件**按哨兵清扫同名旧任务，再建一个 ⇒ **幂等，且零记忆可执行**。
         **现状即缺口（实测）**：manager 今晚换 cron 靠的是**记住 ID**（删 `65c83f66` 建
         `b0e7007f`）。`/clear` 之后 ID 记不住，就只能盲建第二个——
         **重复累积且无从发现**，而 AC5 的「恰好一个」负控制正是要防这个。
         ⇒ 需固化：manager loop 的 prompt **必须以固定可推导前缀开头**（如 `[manager-tick]`），
         武装步骤 = `CronList` → 删除所有含该前缀者 → `CronCreate` 一个。

      **判据（两条都要，都是零记忆可执行）**：
      - ① 在**不知道任何 cron ID** 的前提下执行武装步骤 ⇒ `CronList` 恰好一个 manager loop；
      - ② **负控制**：先人为建两个重复的 manager loop，再执行同一武装步骤
        ⇒ 必须收敛回恰好一个（不是三个）。

      **边界说明**：manda 的 monitor 每个事件自足，**没有跨轮状态**；manager 的 tick **有**
      （「上一轮裁定了什么」）。所以本条**不能替代 AC5b**——
      哨兵解决「同一性」，AC5b 解决「连续性」，两条正交。

- [ ] AC5b (**2026-08-06 新增，比 AC5 更根本**): **manager 每轮状态持久化，新会话不从零开始。**
      **实测缺口**：`orchestration/manager-tick-log.md` 最后写入 **2026-08-04 06:38（两天前）**，
      而今天仓库 **626 次提交、动过它的 0 次**（2026-08-06 17:5xZ 复算）；我这个 16:01 起的新会话从 tick log
      只能读到**两天前**的行，与今晚全部工作无关。
      **规则不缺**——`orchestration/manager-loop-tick.md:153` 早就写着「写进
      `orchestration/manager-tick-log.md`，五列」。**缺的是机械挂载点**：违反两天零检测。
      ⇒ 判据：① 每轮 tick 必须落一行；② 存在一条机械检查能报出「上一轮 tick 没落行」；
      ③ **负控制**——人为跳过一轮不写 ⇒ 该检查必须报红。
      **为什么这条比 AC5 更根本**：就算锚点完美，若每个 manager 会话都从零开始就没有累积；
      而**只要记录是持久的，锚点可以是任何触发源**（人、cron、下次冷启动），manager 都能接上上一轮。
- [ ] AC6 (裁定①): quay-topology.sh 单飞锁——双创建者竞态不会双重创建（原子创建实测）
- [ ] AC7 (C5 可测性): `manager adopt` 之后 manager 对该项目动作次数 = 0（AC12b 操作定义）
- [ ] AC8 (离乳判据): 裸机 manager start + adopt 两项目 + 杀 manager 会话 ⇒ OS 锚恢复，两项目不受影响
- [ ] AC9 (§6 切分): manager-phase-goal.md 拆开——产品行为进 plugin/loop/manager-loop-tick.md，
      实验状态留 orchestration/

## Touches

- tasks/gap-manager-productization-five-constraints.md
- plugin/scripts/（manager start/adopt 命令、quay-topology.sh 单飞锁、无-manager-tick-doc checker）
- plugin/loop/manager-loop-tick.md（新建，产品侧 manager 行为）
- orchestration/manager-phase-goal.md（切分）
- packages/quay/bin/（若 manager 命令走 quay CLI 入口）
- orchestration/SPEC-manager-productization-2026-08-05.md（规格引用）

## Contract

measure   manager_start = `quay manager start 2>&1 | grep -c 'quay-manager\|started'` stdout 数字段
band      manager_start >= 1（独立 session 可起）
invoke    `grep -n 'manager' orchestration/orchestrator-loop-tick.md`（期望 0 命中，AC4）
control   双创建者并发调 quay-topology.sh ⇒ 恰一次创建（AC6）；adopt 后动作次数=0（AC7）
resume    命令/锚/检查分步提交：start 可起 → adopt 三态 → 锚落位 → 机械检查接线，任一步完成即写盘

## Dispatch review

reviewer: outer
at: 2026-08-05T16:5xZ
changed: 外层按 SPEC 裁定立案——三裁定（①谁发现谁创建+锁 / manager-phase-goal 切分 / 建造=outer+inner
运行=人或OS锚）写入本任务；os-anchor 缺口外层独立核实（os-anchor-projects.conf 无 manager、watchdog unit
仅 quay-os-anchor）确认成立；tick 文档 manager 提及当前 0（manager-topology 修复已清，机械检查自然通过）。
