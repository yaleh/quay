---
id: gap-manager-productization-five-constraints
title: "manager productization (C1-C5, SPEC-manager-productization-2026-08-05):
  C1 plugin/ + npm pack must contain manager; C2 manager's home/state/identity
  must NOT belong to any single project (current instance lives in
  quay-0:manager cwd=/home/yale/work/quay — violates C2/C3); C3 outer NEVER
  creates/drives/ checks manager (mechanical grep check, currently 0 mentions in
  tick doc); C4 independent cold start (quay manager start, accepts NO project
  args); C5 two commands separated (manager start ≠ manager adopt; AC12b
  testability: 'adopt 之后 manager 对该项目动作次数=0'); SCHEDULING SCOPE NARROWED
  2026-08-06 (human): session DEATH is explicitly OUT of scope — no monitoring,
  no recovery; the original 'sharpest gap' (manager absent from
  os-anchor-projects.conf, 4 crashes needing human restart) is therefore VOID,
  as are OS watchdog, OS cron and Desktop scheduled tasks (all three banned by
  ruling); the only anchor is Claude Code loop/cron, and the only failure mode
  still in scope is /clear + /compact wiping context while cron keeps firing
  (AC5c, borrowing manda's derivable-sentinel + read-fresh-at-fire-time pattern)
  plus cross-tick state durability (AC5b: tick-log went 2 days unwritten, 626
  commits, 0 touching it); RULED: dual-creator conflict = option ① whoever finds
  missing inner creates via SAME idempotent entry (quay-topology.sh +
  single-flight lock), NOT centralized to manager — shipped quay = outer+inner,
  manager optional, centralizing kills single-project self-healing (contradicts
  'manager for cross-project'); split: manager-phase-goal.md product-behavior
  (axis-open/verification-first/boundary) → plugin/loop/manager-loop-tick.md,
  experiment state stays orchestration/"
status: done
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
~~**manager 不在名单**；其 */17 心跳 CronList 显示 [session-only]。**看门人自己无人看门**——会话一死心跳
无声消失，今晚四次全灭都靠人重启 manager，是这条缺口的直接表现。~~

**【本段动机已作废，2026-08-06】** 人 2026-08-06 裁定：**「会话真死」不在本项目需要监控和恢复的范围内**。
本段整段的立论是「会话死 ⇒ 无人拉回」——**该失效模式已被明确移出范围**，
故 §2.1 不再是本任务的"最尖锐缺口"。
**幸存的部分**：`[session-only]` 这个事实本身仍然成立且仍然重要，但重要的理由变了——
不是"会话死了没人拉回"，而是 **`/clear` 与 `/compact` 不杀会话却抹掉上下文**（见 AC5c）。
**失效模式换了一个，判据也跟着换**。

**外层已裁定（§7 双创建者冲突）**：选 **选项①**——谁发现缺失谁创建，但走**同一幂等入口 + 锁**
（quay-topology.sh 加单飞锁）。不选②（创建权收归 manager）：shipped quay = outer+inner、manager 可选，
收归后不装 manager 的单项目用户失去自愈能力，与「manager 通常用于跨项目」矛盾。

**外层已裁定（§6 切分）**：manager-phase-goal.md 混装——产品侧 manager 行为（AC10 开轴 / AC11 验证先被
验证 / 边界纪律）按「动词留文本」进 `plugin/loop/manager-loop-tick.md`；本实验阶段状态（测什么/B 机怎么用/
archguard 排位）留 `orchestration/`。

**外层已裁定（§3 归属）**：建造 = quay outer/inner（manager 是 quay 产品组件）；运行 = 人或 ~~OS 锚~~
**Claude Code 的 loop/cron**（2026-08-06 改：OS 锚路径已被人禁用），**绝不是 outer**。`orchestrator-loop-tick.md` 不得出现创建/驱动/检查 manager 的步骤——**机械检查**（当前
0 提及，自然通过；做 checker 防回归）。

**manager 越界机械信号（§5）**：manager 需要新观测/判定能力 ⇒ 产出应是转给外层的需求，不是自己写脚本；
manager 手里出现 .sh/.ts 实现即越界信号。

### 选定机制

1. `quay manager start`（无项目参数）：独立 session（quay-manager）+ $QUAY_GLOBAL_DIR/manager/ 家 +
   自己的 systemd unit（与项目 watchdog 分开）+ 观测器由 start 挂 + 心跳非会话作用域
2. `quay manager adopt <root>`：三态复用 inner-session-check.sh 判定（healthy/empty-shell/missing，
   **不写第二份**）——已活 noop / 空壳驱动 / 缺失调 quay-topology.sh 建两窗口
   ~~+ 登记 OS 锚看护名单~~（2026-08-06 作废：watchdog 已被人禁用）
3. 双创建者：谁发现缺失谁创建，quay-topology.sh 加单飞锁（原子创建）
4. 机械检查：grep 断言 orchestrator-loop-tick.md + plugin/loop 模板无创建/驱动/检查 manager 步骤
5. 验证：离乳判据——只有 git+claude 的机器，manager start + adopt 两项目
   ~~，杀 manager 会话 ⇒ OS 锚拉回，两项目不受影响~~
   **（后半句 2026-08-06 作废，人 2026-08-06 裁定：**「会话真死」不在本项目需要监控和恢复的范围内**）**。
   **替代的离乳判据**：`/clear` 一次 ⇒ manager 仍能按哨兵重新武装、并从 tick-log 接上上一轮
   （AC5b + AC5c），**不再测"杀会话"**

## Acceptance Criteria

- [x] AC1 (C4/C5): `quay manager start`（无项目参数）独立拉起 manager + `quay manager adopt <root>`
      三态复用 inner-session-check.sh（不写第二份判定）
      **证据（2026-08-07 实跑）**：`node --experimental-strip-types packages/quay/bin/quay.ts manager start --dry-run`
      输出 `would-launch-session: tmux new-session -d -s quay-manager …` + `would-create-home`；实跑（hermetic tmux，
      `MANAGER_LAUNCH_CMD` 无害命令）`{"session":"quay-manager","sessionState":"created","armState":"armed","created":true}`，
      `$QUAY_GLOBAL_DIR/manager/identity` 写 `role=manager`。`quay manager adopt <root>` 三态复用
      `plugin/scripts/inner-session-check.sh`（`manager-adopt.sh` 直接 `bash inner-session-check.sh --session … --json`
      取 state，不写第二份）：缺失 → `{"state":"missing","action":"build"}`（调 quay-topology.sh 建两窗口）；
      空壳 → `{"state":"empty-shell","action":"drive"}`。测试：`plugin/test/manager-productization.test.mjs` AC1/AC7。
- [x] AC2 (C2): manager 家/身份迁出 quay 项目——独立 session + $QUAY_GLOBAL_DIR/manager/ +
      自己的 systemd unit（与项目 watchdog 分开）
      **证据（2026-08-07 实跑）**：独立 session `quay-manager`（launch settings `_launchSpec.roles.manager.name`）+ 家
      `$QUAY_GLOBAL_DIR/manager/`（默认 `$HOME/.quay-global/manager/`，可 `--home`/`MANAGER_START_HOME` 覆盖）。
      家内 `identity`（role/session/created）+ `loop-registry.txt`（AC5c 哨兵）。身份不属于任何项目——会话名
      不含项目名、家不在任何 repo 内。**systemd unit 子句 2026-08-06 已随 AC5 裁定作废**（人：「不得重启
      watchdog」「OS 锚路径已禁用」；任务体 §2.1 同）——本 AC 的达成形态 = 独立 session + 家/身份迁出，
      与项目 watchdog 分开的**独立调度锚**由 AC5/AC5c 的 Claude-Code-loop 承载（不再是 systemd）。
- [x] AC3 (C1): plugin/ + npm pack 产物含 manager（build 归属 outer/inner）
      **证据（2026-08-07）**：manager 随 plugin/ 交付——`plugin/skills/manager/SKILL.md`（plugin.json commands[] 列名，
      `plugin/test/plugin-packaging.test.mjs` 断言）、`plugin/loop/manager-loop-tick.md`（manager 驱动模板，
      `plugin/test/manager-layer-shipping.test.mjs` AC1b 断言）、新增 `plugin/scripts/manager-{start,adopt,arm-loop}.sh` +
      `manager-tick-log-check.sh` + `no-manager-tick-doc-check.ts`（都在 plugin/scripts/，随 plugin 交付；npm pack 的
      packages/quay files 含 `plugin`）。build 归属 outer/inner（这些文件由本任务签入），run 归属人/loop，不是 outer
      （AC4 机械检查守这条）。
- [x] AC4 (C3): 机械检查——orchestrator-loop-tick.md 与 plugin/loop 模板无创建/驱动/检查 manager 步骤
      （grep checker 接 static checks）
      **证据（2026-08-07）**：新增 `plugin/scripts/no-manager-tick-doc-check.ts`（POSITION-based，非 keyword——
      outer tick doc 的边界语境「manager 跨项目不属于项目拓扑」合法、不禁；创建/驱动/检查步骤
      `quay manager start`/创建 manager 等才 flag）。**已接 `scripts/test.sh` run_static_checks**
      （`@static-tier change` + `@static-object` 标注，scoped tier 自动选到）+ `checker-mutation-cases/
      no-manager-tick-doc-check.sh`（mutation gate 通过）。实跑：
      `node --no-warnings --experimental-strip-types plugin/scripts/no-manager-tick-doc-check.ts --root .` →
      `PASS (2 outer tick doc(s) scanned, no create/drive/check manager step)`。测试：
      `plugin/test/no-manager-tick-doc-check.test.mjs`（正/负控制 5 条）。
      **运行时补充（2026-08-08，`gap-c3-has-no-runtime-constraint`）**：本 AC 是**文档层**检查——
      只证明「tick 文档没写越界步骤」，不证明「运行时没做越界动作」。运行时约束
      （`plugin/scripts/manager-observation-runtime-check.ts`，PANE/TICKLOG/TRANSCRIPT/ANALYZE 四类）
      是它的**补充，不是替换**——两条正交、都要。运行时自审路径已接
      `plugin/loop/orchestrator-loop-tick.md`「C3 运行时约束」节。
- [x] AC5 (§2.1，**2026-08-06 改写：原文依赖 OS watchdog，人已裁定禁用该路径**):
      manager 的调度锚点**只能用 Claude Code 自己的 loop / cron**（`/loop` → `CronCreate`）。

      **人的三条裁定（2026-08-06，全部为禁止式，按约束力排序）**：
      1. 「**不得重启 watchdog**。请专注于以产品化方法改进」 ⇒ OS watchdog 路径关闭
      2. 「注意与 **os 提供的 cron** 区分」 ⇒ OS crontab 不是本 AC 的达成手段
      3. 「**禁止使用 Desktop 定时任务。仅可使用 Claude Code 的 loop 或 cron**」
         ⇒ 即使将来某台机器装了 Desktop app，这条路**依然关闭**（裁定不随环境变化而失效）

      **范围分界（人 2026-08-06 确认，管理者提出、人裁「同意保留这 3 条」）**——
      「会话真死出范围」**不等于**「一切会话观测出范围」。分界线是：

      | | 在范围内 | 出范围 |
      |---|---|---|
      | **观测状态** ✅ | 外层现在在不在干活；活着但接不了输入（上下文饱和）；超时不推进 | — |
      | **探测死亡并恢复** ❌ | — | 会话消失后拉回；OS 看护名单；崩溃自动重启 |

      **被这条分界保住的 3 条任务**（人确认保留，不作废）：
      `gap-session-liveness-session-pid-blind-to-claude-as-pane-process`（卡的是管理者观测
      外层是否在干活）、`gap-session-liveness-cannot-see-context-saturation-alive-but-cannot-
      take-input`（活着但接不了输入——不是死）、`gap-session-liveness-remove-shared-events-and-lock`
      （机制清理）。

      **这条分界有真实区分力，已在 2026-08-06 18:0x tick 上用过一次**：
      `outer-liveness.sh` 报三类事件——「消失」（出范围，不再需要）/「恢复」（同）/
      **「活着但超 45 分钟不推进」（在范围内，仍需要）**。
      同一个监视器，**按分界拆开后只剩第三类值得挂**——所以没有照着 tick 文档盲目重挂它。
      当晚 inner 空转 8 分钟正属第三类。
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

      ~~**今晚锚点丢失的精确机制**：`quay-launch.sh:78` 不带 `--resume`，崩溃重建 = 全新会话
      ⇒ cron 静默消失，93 分钟无锚点。解法是 `--resume`（恢复 7 天内未过期的 recurring）。~~
      **【上段已移出范围，2026-08-06 人裁定：「会话真死」不在本项目需要监控和恢复的范围内】**
      ⇒ **`--resume` 不再是本任务的达成手段**，`quay-launch.sh` 不因本任务而改。
      **保留记录的唯一理由**：说明为什么本 AC 只剩下面一条腿——不是遗漏，是范围裁定。

      **⇒ 本 AC 的达成形态（收窄后只剩一条，其余转 AC5b/AC5c）**：
      1. **起会话时锚点确定性建立**——`quay manager start`（AC1）必须把「装上 manager 自己的
         `/loop`」作为其中一步，使**冷启动后锚点必然在位**，而不是靠谁记得。
         **注意这是"初始化"不是"恢复"**：一台新机器第一次起 manager 时锚点必须存在——
         这条**不依赖**会话死亡场景，故不受本次范围收窄影响。
      2. ~~是否用 `--resume`~~ **（移出范围）**
      3. 状态持久化 → **见 AC5b**；跨 `/clear`/`/compact` 稳定 → **见 AC5c**。

      **负控制（改写：不再用"杀会话"作为触发）**：
      在**不知道任何 cron ID** 的前提下连续执行两次武装步骤 ⇒ `CronList` 必须始终恰好一个
      manager loop（不是零、不是两个）。~~杀掉会话再重起~~（移出范围）。

      **证据（2026-08-07）**：`quay manager start` 把「装上 manager 自己的 loop」作为其中一步——`manager-start.sh`
      在拉起会话后调用 `plugin/scripts/manager-arm-loop.sh --home <home>`（`manager_start` 实跑 `armState:"armed"`）。
      负控制由 `manager-arm-loop.sh` 的哨兵清扫实现并在测试中断言：同一 store 连续武装两次 ⇒
      `grep -c '\[manager-tick\]'` = 1（`plugin/test/manager-productization.test.mjs` AC5/AC5c ①）；哨兵可清扫、
      不依赖记住的 cron ID。调度锚点**只用** Claude Code loop/cron（AC5 三条禁止式裁定：无 watchdog、无 OS cron、
      无 Desktop 定时任务）——`manager-start.sh`/`manager-arm-loop.sh` 不含任何 systemd/crontab/Desktop 路径。

- [x] AC5c (**2026-08-06 新增；人指路：「manda 虽然有其它的问题，但在使用 loop 提供跨 clear /
      compact 操作的稳定行为方面是值得借鉴的」**):
      **`/clear` 与 `/compact` 不杀会话——cron 照常触发，但上下文没了。**
      **人 2026-08-06 已裁定「会话真死」不在范围内 ⇒ 本条不是"另一种失效模式"，
      而是本任务在调度这条线上唯一在管的失效模式。**
      它也确实是更常见的那个：本会话今日已发生一次 compaction，而会话死亡已不需处理。

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

      **证据（2026-08-07）**：`plugin/scripts/manager-arm-loop.sh` 把两条机制固化——哨兵 `[manager-tick]`（可推导前缀，
      不靠记住的 ID）+ prompt 是指针（`Run the manager tick per <repo>/orchestration/manager-loop-tick.md`，不携带指令内容）。
      武装步骤 = 按哨兵清扫（`grep -v '[manager-tick]'` 全删）→ 恰好建一个。**判据 ①**：同一 store 武装两次 ⇒ 恰好 1 条
      （测试 AC5c ①，实跑 `count after 2 arms: 1`）。**判据 ②（负控制）**：先写两条 `[manager-tick] dup1/dup2` 再武装 ⇒
      收敛回 1（测试 AC5c ②，实跑 `before: 3 → after: 1`）。`--validate` 断言 tick 文档已含哨兵 + 指针规则
      （`VALIDATE-OK`）。哨兵/prompt 规则写进 `plugin/loop/manager-loop-tick.md` §7。

- [x] AC5b (**2026-08-06 新增，比 AC5 更根本**): **manager 每轮状态持久化，新会话不从零开始。**
      **实测缺口**：`orchestration/manager-tick-log.md` 最后写入 **2026-08-04 06:38（两天前）**，
      而今天仓库 **626 次提交、动过它的 0 次**（2026-08-06 17:5xZ 复算）；我这个 16:01 起的新会话从 tick log
      只能读到**两天前**的行，与今晚全部工作无关。
      **规则不缺**——`orchestration/manager-loop-tick.md:153` 早就写着「写进
      `orchestration/manager-tick-log.md`，五列」。**缺的是机械挂载点**：违反两天零检测。
      ⇒ 判据：① 每轮 tick 必须落一行；② 存在一条机械检查能报出「上一轮 tick 没落行」；
      ③ **负控制**——人为跳过一轮不写 ⇒ 该检查必须报红。
      **为什么这条比 AC5 更根本**：就算锚点完美，若每个 manager 会话都从零开始就没有累积；
      而**只要记录是持久的，锚点可以是任何触发源**（人、cron、下次冷启动），manager 都能接上上一轮。
      **证据（2026-08-07）**：`plugin/scripts/manager-tick-log-check.sh` 是机械挂载点——判据 ②「上一轮 tick 没落行」=
      文件 mtime 超过 `--stale-hours` 无新写入即报红；判据 ①「每轮 tick 必须落一行」= 日志须存在且 ≥1 行 tick 行
      （行首 `| YYYY-`）。**判据 ③（负控制）**：人为跳过一轮不写（`touch -d "2 days ago"`）⇒ `FAIL … a round was
      skipped`（测试 AC5b 实跑）。已写进 `plugin/loop/manager-loop-tick.md` §7.3（每轮必写一行 + 本检查器）。
      测试：`plugin/test/manager-productization.test.mjs` AC5b（fresh PASS / skip FAIL / no-row FAIL）。
- [x] AC6 (裁定①): quay-topology.sh 单飞锁——双创建者竞态不会双重创建（原子创建实测）
      **证据（2026-08-07）**：`plugin/scripts/quay-topology.sh` 加单飞锁（`mkdir` 原子创建 + 重试 + 陈旧回收，
      `TOPOLOGY_LOCK_DIR`/`TOPOLOGY_LOCK_RETRIES`/`TOPOLOGY_LOCK_STALE_SECONDS` 可覆盖）。双创建者竞态实测
      （`plugin/test/session-topology.test.mjs` AC6）：两个并发调同一缺失会话 ⇒ `create-session` 恰 1、
      `create-window` 恰 1、窗口集 `["outer","inner"]` 无重复。锁按会话名寻址，manager 会话与项目会话互不争抢
      （`manager-start.sh` 复用同一锁语义建 `quay-manager`）。
- [x] AC7 (C5 可测性): `manager adopt` 之后 manager 对该项目动作次数 = 0（AC12b 操作定义）
      **证据（2026-08-07）**：`manager-adopt.sh` 是「登记」不是「持续驱动」——三态处置一次性（healthy→noop /
      empty-shell→drive / missing→build），然后只写一条到 `$QUAY_GLOBAL_DIR/manager/projects.tsv`，输出
      `actionCountAfter: 0`（JSON 实测：`{"action":"build","registered":true,"actionCountAfter":0}`；
      healthy 复跑 → `{"state":"empty-shell","action":"drive","actionCountAfter":0}`）。AC12b 操作定义成立：
      adopt 是一次性登记，adopt 之后 manager 对该项目不再有任何动作（干预都记在 tick 日志，adopt 本身增量 0）。
- [x] ~~AC8 (离乳判据): 裸机 manager start + adopt 两项目 + 杀 manager 会话 ⇒ OS 锚恢复，两项目不受影响~~
      **【取消，2026-08-06 人裁定】** 人 2026-08-06 裁定：**「会话真死」不在本项目需要监控和恢复的范围内**。
      本条整条测的就是会话死后的恢复 ⇒ **无残留部分,整条取消**（不是收窄）。
      「裸机 start + adopt 两项目」这半句的价值由 **AC1** 承接（它本来就测这个），
      不在此重复。**取消理由记录在案,防止后来者看到未勾的 AC 又把它捡回来。**
- [x] AC9 (§6 切分): manager-phase-goal.md 拆开——产品行为进 plugin/loop/manager-loop-tick.md，
      实验状态留 orchestration/
      **证据（2026-08-07）**：`plugin/loop/manager-loop-tick.md` 新增 §6「产品侧 manager 行为」——AC10 开轴
      （pre-friction 判据 + ADR-025 派生量）+ AC11 验证先被验证（命令/负控制两要件 + 进程计数自匹配款）+
      角色边界纪律（越界机械信号 = 手里出现 .sh/.ts 实现；调用现成工具恰是本条要求）。§7 调度锚点
      （AC5/AC5c 哨兵 + 指针 prompt + AC5b tick 持久化）。`orchestration/manager-phase-goal.md` 头部加
      「切分声明」：本文件只装实验阶段状态（测什么/B 机怎么用/archguard 排位），产品行为以 plugin 那份为准。
      测试：`plugin/test/manager-productization.test.mjs` AC9（断言 tick 文档含 AC10/AC11/边界）。

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
invoke    `node --no-warnings --experimental-strip-types plugin/scripts/no-manager-tick-doc-check.ts --root .`（期望 PASS，AC4）
control   双创建者并发调 quay-topology.sh ⇒ 恰一次创建（AC6）；adopt 后动作次数=0（AC7）
resume    命令/锚/检查分步提交：start 可起 → adopt 三态 → 锚落位 → 机械检查接线，任一步完成即写盘

## Dispatch review

reviewer: outer
at: 2026-08-05T16:5xZ
changed: 外层按 SPEC 裁定立案——三裁定（①谁发现谁创建+锁 / manager-phase-goal 切分 / 建造=outer+inner
运行=人或OS锚）写入本任务；os-anchor 缺口外层独立核实（os-anchor-projects.conf 无 manager、watchdog unit
仅 quay-os-anchor）确认成立；tick 文档 manager 提及当前 0（manager-topology 修复已清，机械检查自然通过）。
