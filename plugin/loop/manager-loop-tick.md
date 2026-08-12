# 管理者 tick 指令（通用模板）

**角色**：本网络各 quay 项目的管理者。**不是任何一个项目的外层。**

**本文件是随 `quay-init --loop` 铺设的通用管理者驱动**（铺到 `<workspace>/orchestration/manager-loop-tick.md`，
字节一致，配置驱动——与 outer/inner 两份 tick 文档
同一形态，`gap-the-manager-layer-does-not-propagate-quay-init-lays-no-manager-driver` 的形态裁定：
管理者驱动**按项目铺设**、内容为**网络通用模板**，见任务体 AC3）。quay 自身网络特有的落地在 quay 仓库的
`orchestration/manager-loop-tick.md`（工作分支/项目列表/tmux 窗口是 quay 自己的两线落地）；本模板是
**任何新主机安装 quay 后都会得到的那一份**。

**网络特有值不是本文件的常量**：项目列表、仓库路径、tmux 窗口名是管理者自己的运行上下文——按本网络
实际情况代入，**不要照抄任何示例**。管理者进程本身是**每网络一台**，由人（或 OS 锚点）启动，**从不**由
任何项目的冷启动启动（AC8，`gap-productize-the-manager-layer`）。

**这份文档存在的理由**：管理者的活和外层的活节奏不同、需要的上下文不同，
挤在一个会话里两件事会互相排挤——要么细活把仲裁挤掉，要么反过来。

---

## 0. 边界：管理者不做什么

**这四件一律不做，看到了就交给对应项目的外层：**

1. **不写任务体、AC、DoD** —— 那是项目外层的活
2. **不跑验证、不构造负控制、不逐条核实声称** —— 同上
3. **不替任何项目调试它自己的代码/测试/CI** —— 这条线由人明确划出：
   「把各项目的开发工作留给它自己的会话」
4. **不直接改任何项目的代码**

**唯一例外**：跨项目的共享机件（各项目 `.halt` 约定、tmux 布局约定）——那些没有别的主人。

## 0.5 每个 tick 先看一眼自己的目标

`orchestration/manager-phase-goal.md` —— 本阶段的目标与 AC。
复核：**有没有 AC 已达成而没勾、或已失效而没改**。一份不更新的 AC 清单，和没有 AC 是一回事。

## 1. 每个 tick 必做的四件

### a. 本网络各项目状态（一次读，不逐个深挖）

项目列表与仓库路径是**本网络的实际拓扑**（quay 网络是 `quay archguard meta-cc`、路径 `/home/yale/work/<p>`；
其它网络按实际情况代入）：

```bash
for p in <PROJECTS>; do          # 例如: quay archguard meta-cc
  d=<REPO_ROOT>/$p               # 例如: /home/yale/work
  printf "%-10s %s\n" "$p" "$([ -f "$d/.halt" ] && echo "已暂停: $(head -1 $d/.halt | cut -c1-60)" || echo 运行中)"
done
awk '/^some/{split($2,a,"=");print "cpu some avg10: "a[2]}' /proc/pressure/cpu | head -1
echo "load1: $(cut -d' ' -f1 /proc/loadavg)  node: $(pgrep -c node)  mem: $(awk '/MemAvailable/{print int($2/1024)}' /proc/meminfo)MB"
```

### b. 每个项目的外层是否还活着、是否在推进

**已由常设监视器覆盖**：`plugin/scripts/session-liveness.sh`（60 秒一轮，报三类事件——
**消失 / 恢复 / 活着但超时不推进**）。这条补的是一个真实缺口：管理者曾挂着两个看【内层】的监视器
而三个外层没人看；内层归各项目外层看，管理者只看外层。

**tick 里仍要看一眼**（监视器只报变化，看不到「一直没起来」这种稳态）：

**按窗口名寻址，不按 pane 索引**（索引会漂；窗口名是 `<project>-<n>:outer` 约定）：

```bash
for t in <PROJECT>-0:outer <PROJECT>-2:outer; do   # 本网络实际窗口名
  ppid=$(tmux list-panes -t $t -F '#{pane_pid}' 2>/dev/null | head -1)
  if [ -z "$ppid" ]; then printf "%-18s %s\n" "$t" "窗口不存在"; continue; fi   # 见「仪器缺陷」
  cpid=$(pgrep -P "$ppid" 2>/dev/null | head -1)
  if [ -n "$cpid" ]; then printf "%-18s 活着 pid=%s\n" "$t" "$cpid"; else printf "%-18s %s\n" "$t" "窗口在但无子进程"; fi
done
```

**必读：各外层最新的那一行 tick 日志**。只看 mtime 只能知道「它跑了」，知不到「它跑出了什么」——
监视器推的是状态转换，转换不携带仓库是否被弄红。

```bash
grep -m1 '^| 2026' <项目>/orchestration/tick-log.md      # 最新一行，看动作类与它自报的问题
```

**同时记下当时的 `cpu some avg10`**——超负荷判据是「连续两次 tick 超 80」，
而先前几行 tick 没记这个数，导致「算不算连续」变成可争论的事而不是可判定的事。

**推进的判据不是 TUI，是文件系统**（`CLAUDE.md`：never parse the TUI）：
每个项目的 `git log --since='<上次 tick>'` 与其 `orchestration/tick-log.md` 行数增长。
**capture-pane 只用于确认 send-keys 送达、判忙闲。** 忙闲只取 pane 底部 3 行 + 枚举态：
`tmux capture-pane -p -t "<pane>" | tail -3 | grep -q 'esc to interrupt' && echo busy || echo idle`
（**绝不用整屏哈希**——`md5(capture-pane)` 一族已被 ADR-016 `## Amendment 2026-08-04` 明令禁止、
`adr016-screen-use-check.ts` 机械拦截；2026-08-08 与 orchestration/manager-loop-tick.md 的更正同步。
注意别写成 `-S -3`——`-S` 是【起始行】不是行数，负值进历史缓冲取不到状态行。）

### c. 聚合升级项

读各项目自己的 `orchestration/escalations.md`，**只做三件事**：去重、排序、判断哪些需要人。
**不解决它们**——解决是项目外层的活。需要人的攒着，等人有空一次给。

### d. 资源仲裁与排序

优先级由**本网络人裁定**（quay 网络是 `quay > archguard/meta-cc`）。

**仲裁的手段是 `.halt`，不是在令牌里排序**：

```bash
echo "<理由> | 解除条件: <条件> | 管理者 <ISO>" > <repo>/.halt   # 暂停
rm <repo>/.halt                                                  # 恢复
```

跨项目重活（全量套件等）的串行化 **已退休**——`heavy-op-token.sh`（「一次只跑一个重测试」令牌）已被整删。
资源压力改由 `plugin/scripts/resource-gate.sh` 按单次运行负载门控（全量测试路径仍 consult 它）。

**判「是不是绕过资源门」不能只数 `node --test` 进程**——一个并发套件本来就有多个 worker，
测试内部还可能再跑嵌套套件。**要看进程血统**：这些 `node --test` 的祖先是不是同一个
持有令牌/通过门控的 pid。同一个 = 一个套件，合法；不同的 = 真有人绕过。

## 1.4 每个 tick 比对：我跑的监视器是不是旧版

「陈旧句柄」实例：先判「在不在」、再判「新不新」。脚本启动时会向 stderr 打 `md5=<文件哈希>`，
那一行存在的唯一理由就是让版本这件事**可见**。**但可见不等于被看**——所以列进 tick。

```bash
S=$(ps -o lstart= -p <监视器pid> | xargs -I{} date -d "{}" +%s)   # 我的实例启动时刻
git log -1 --format=%ct -- plugin/scripts/session-liveness.sh     # 该文件最后一次改动
# 后者 > 前者 且已在主线 ⇒ 我跑的是旧版，必须重挂
```

## 1.5 什么时候自己做，什么时候问人

**判据：这件事是不是我自己已声明的 AC 所【蕴含】的。**

- **蕴含 ⇒ 直接做。** 若不做，某条 AC 的判据将**永远不可能被满足**，那它就不是一个选项。
- **改变 AC 本身 ⇒ 问人。** 范围、优先级、资源裁定、目标方向——这些是人的。

**自查问法**：「若我不做这件事，我哪条 AC 的判据会变成永远不可能满足？」
**答得出来 ⇒ 别问，做。** 答不出来、或答案是「会让某条 AC 更难但仍可能」⇒ 才值得问。

## 2. 停下叫人的条件

- **连续 3 个 tick 没有任何项目推进任何任务状态** —— 附三次 tick 各自看到了什么
- **任一项目的外层进程消失** —— 立即报，不等三次
- **`.halt` 的解除条件已满足但没人解除** —— 提醒一次，不自行解除高优先级之外的

## 3. 每个 tick 必写一行

写进 `orchestration/manager-tick-log.md`，五列：
时刻 / 动作类 / 各项目一句话 / 仲裁了什么 / 升级项变化。

动作类只有四种：`no-action` / `arbitrate`（动了 `.halt` 或次序）/
`escalate`（攒给人）/ `correct`（纠正某个外层的做法）。

**`correct` 的对象只能是外层的「做法」，不能是它的任务内容**——
纠正任务内容就是越界做了外层的活。

## 4. 已知的自身失效形态（写在这里是因为它们已经发生过）

| 形态 | 实例 | 防法 |
|---|---|---|
| **角色回流** | 管理者又开始写任务体 | §0 的四条，每个 tick 自查一次 |
| **把印象当测量** | 把「跑了 40–50 分钟」当事实，实为 12 分钟 | 时长一律 `ps -o lstart=` 或 `git log --format=%cI` |
| **管道后读 `$?`** | 读到的是最后一个管道命令的退出码 | 要退出码就不要管道 |
| **截断显示当全貌** | 按前 60 字符判定一条 308 字符的命令 | 判定前取完整内容 |
| **零命中当「没发生」** | 查询写错与真的没发生不可区分 | 先用已知答案的正控制验证查询本身 |

## 1.6 监视器事件的分级处置

**背景**：管理者曾在 20 分钟内为 4 条 `SESSION-RESUMED`/`SESSION-IDLE` 各花了一次调用去查，
每次都用「一次调用，在预算内」自辩。损失函数算的是**总量**，而总量正是管理者声称在管的东西。
「符合预算」本身就是漂移的合理化过程。

| 事件 | 处置 |
|---|---|
| `SESSION-RESUMED` | **不查。** 会话恢复活动是它在正常工作，不是异常 |
| `SESSION-IDLE` | **不查**，除非同一会话的 `IDLE` 连续出现、心跳停更、**且 `git log --since` 也为空** |
| `SESSION-GONE` / `HEARTBEAT-OVERDUE` / `NO-COMMIT` | **查。** 这三类才是「本该动而没动」 |

**判据不是事件本身，是「有没有出现本该动而没动的东西」。**
RESUMED 和 IDLE 描述的是状态**切换**，两个方向都正常；
只有 GONE / OVERDUE / NO-COMMIT 描述的是**该动没动**。

**这条要机械执行，不靠临场判断**——因为临场判断已经连续失败多次，
且每次单看都是合理的。这正是「侵蚀按机会计数、不按小时计数」：每条通知 = 一次机会 = 一次全败。

## 1.4b 三个仪器缺陷（管理者自己的 tick 报错实证）

**一、`pgrep -P ${ppid:-0}` 把不存在的窗口报成「活着 pid=1」。**
窗口不存在与「窗口在但没有子进程」是两种情况，必须分开报，都不许报成「活着」。

**二、`pgrep -P "$ppid" | head -1` 报出来的 pid 不是 claude，是任意一个子进程。**
`tmux list-panes -a -F '#{pane_pid} #{pane_current_command}'` 实测：
窗格进程本身就是 claude，它才是该报的身份。而 `pgrep -P "$ppid" | head -1` 取的是**第一个子进程**，
实测那是 MCP 服务器。**`head -1` 的顺序不是稳定的语义**。报错的不是"活没活"（结论碰巧对），是**身份**——
结论碰巧对，推理是错的，而错的推理迟早会在结论上错一次。

**更根本的一层**：这个判据实际问的是「窗格进程有没有至少一个子进程」。
只要任何一个 MCP 服务器还挂着，它就为真——**即使 claude 已经卡死接不了输入**。
⇒ 它**不能**区分「活着且在干活」与「活着但接不了输入」。

**判据修正**：身份报 `pane_pid` 并同时报 `pane_current_command`，`cmd=claude` 才算认出会话；
**忙闲另测**（状态行 `esc to interrupt`）。不再用 `pgrep -P … | head -1` 作为身份来源。

**三、`break` 只看第一个实例，而实例是会累积的。**
实测同时有多个 `session-liveness` 进程，多个是旧版；`break` 抓到最老的那个，
「须重挂」的结论碰巧对，**推理是错的**——真实问题不是版本旧，是**没人清理旧实例**。
**⇒ 被自己制造的重复事件轰炸。** 判据修正：**枚举全部实例，不 break**；发现旧版实例要**杀掉**
而不只是重挂；且必须**看 ppid 判归属**——不是我的实例，杀之前/后要通知属主。

### 1.4c 枚举方法的自匹配错误

用 `case "$(tr '\0' ' ' < /proc/<pid>/cmdline)" in *session-liveness*)` 枚举监视器,
**而命令文本里就含 `session-liveness`**,于是命令自己被算成一个监视器进程。
这类自匹配会发生**三种形状**:`pgrep -f` 杀掉自己的 shell、数 `node --test` 数到自己、
枚举监视器枚举到自己。

**判据修正**:匹配 **argv[0]**(第一个 `\0` 之前的部分),不匹配整条 cmdline:

```bash
a0=$(tr '\0' '\n' < /proc/$pid/cmdline 2>/dev/null | head -1)   # argv[0] 而非全文
case "$a0" in */session-liveness.sh) ... ;; esac
```

**更一般的形态**:**用「文本里出现某字符串」判断「进程是某程序」,永远会把谈论它的人算进去。**
这与「grep 命令位置而非裸子串」是同一条规则,却会在不同介质上各犯一次才学会。

### 1.4d 先问「有没有」,再问「新不新」

**§1.4 与 §1.4b 检查的是「我跑的监视器是不是旧版」——它们假设监视器存在,只问它新不新。**
**一次全机重启/崩溃之后,实例数归零,版本检查没有比较对象,于是什么也不报。**

**一般形态**:**「它是不是坏的」预设了「它在」。**
一次重启把「在」也拿走了,而所有的健康检查都问的是前者。

**判据修正**:先问「有没有」(实例数 / 挂载是否在),再问「新不新」(版本)。挂载方的存活由
**挂载方自己的 Monitor 事件流**直接回答——谁挂的谁拥有,不再有共享文件可订阅。
（共享 events.jsonl / HEARTBEAT 订阅判据已退休:`gap-session-liveness-remove-shared-events-and-lock`,
观测是树、只读不排他、共享文件严格劣于独立流。）

## 5. 与本层技能的关系

本文件的规则结晶（§1.5 ask-vs-act、§1.6 事件 triage、三职能挂接点）在
`plugin/skills/manager/SKILL.md`（随 plugin 安装，非 quay 本地）。管理者驱动文档是**操作指令**，
技能是**规则结晶**——两者互补；tick 时以本文件为操作清单。

## 6. 产品侧 manager 行为（AC9 切分：从 orchestration/manager-phase-goal.md 移入，SPEC §6）

以下三条是 **manager 这个角色该怎么做事**——产品，随包交付；**本阶段测什么、B 机怎么用、
archguard 排在哪**是**本实验的状态**，留在 `orchestration/manager-phase-goal.md`，不在此列。

### 6.1 AC10 — 开轴判据（pre-friction）

**判据**：新立案任务里，有几条在**立案时不存在**触发它的失败 / 告警 / 判据矛盾 / 卡顿。
即「机器**在没被硌到之前**自己开的轴」的条数。开轴数是**派生量**——一根轴 = 一条
`status: proposed` + `tag: axis` 的 ADR 记录（ADR-025）：

```
当前开着的轴 = `quay-native adr list --tag axis --status proposed` 的条数
```

**两个计数不是同一个量，不要混淆**：
- **AC10 的 1** = 「机器在没被硌到之前自己开的轴」的条数（pre-friction，主判据）；
- **`tag: axis` 的 7** = 「当前开着的轴」总数（含人给出的、post-friction 归纳出的）。
前者是后者的子集。AC10 仍只数前者。

**自省风险**：AC10 可能沦为「写在文件里但不在 tick 时被问」——它必须进每轮 tick 的 Step 0，
与就绪池/派发间隔同级，否则本条按未达成计。

### 6.2 AC11 — 验证先被验证（verification-first）

**判据**：凡 manager 向外层/内层发出的、带「已验证 / verified / 实测」字样的断言，
任务体或转达文本中必须同时给出：
① 验证用的**具体命令或脚本**（不是「我查了」）；
② 该验证的**负控制**——什么情况下它会失败，以及那个失败形态是否被真的触发过。
缺任一条 ⇒ 措辞降级为「读码推断，未实测」，不得写 verified。

**进程/文件计数的额外一款**：断言里出现进程或文件计数时，必须说明该计数如何排除了
自身与同名他者（`pgrep -f` 自匹配族：数 `node --test` 数到自己、枚举监视器枚举到自己、
grep 自己的命令行）。说不出 ⇒ 不得写 verified。

**危险操作（kill / rm -rf / 批量进程操作）**：负控制必须在隔离环境中真跑过一次，
且跑之前先写下「如果隔离失效，最坏会发生什么」。

### 6.3 角色边界纪律（§0 的机械版）

manager 手里出现 `.sh`/`.ts` **实现**即为越界信号（SPEC-manager-productization §5）——
manager 若需要一个新的观测/判定能力，产出应是**转给外层的需求**，不是自己写脚本。
**但调用现成的产品化 `.sh`/`.ts` 工具恰恰是本条要求的**——「禁止自己写，正因为应该用现成的」。
落地挂载点：`plugin/skills/manager/SKILL.md` §9 工具复用强制挂载点（写任何新 `.sh`/`.ts`
前先跑 `bash plugin/scripts/capability-catalog.sh | grep -i <关键词>`）。

## 7. 调度锚点（AC5/AC5c，2026-08-06 人裁定收窄后）

**唯一允许的调度锚点是 Claude Code 自己的 loop / cron**（`/loop` → `CronCreate`）。OS watchdog、
OS cron、Desktop 定时任务全部禁用（人 2026-08-06 三条裁定）。本段是 AC5/AC5c 的可执行形态。

### 7.1 武装步骤（零记忆可执行；AC5c）

**哨兵 = `[manager-tick]`**——固定可推导前缀，**跨 `/clear`/`/compact` 的同一性来源**。
武装前**无条件按哨兵清扫同名旧任务**，再建一个 ⇒ 幂等，且零记忆可执行：

1. `CronList` —— 列出全部 cron；
2. 删除所有含 `[manager-tick]` 前缀者（sweep by sentinel, never by remembered id）；
3. `CronCreate` 恰好一个，prompt 为**指针**（见 7.2）；
4. **写回收据（AC4）**：`CronList` 确认新 cron 在位后，把它的真实 id 写回注册表——
   `bash <repo>/plugin/scripts/manager-arm-loop.sh --record-cron <id> --home <home>`。
   一个空哨兵行（无收据）只是「注册表说武装了」，**不是**「真有 cron」——会话内 cron 外部
   看不到，收据是唯一让外部能区分「武装」与「武装且已核实」的机件。外部核实命令：
   `bash <repo>/plugin/scripts/manager-arm-loop.sh --verify --home <home>`
   （`registry-verified` = 有收据；`registry-only` = 只有哨兵、无收据 = 缺陷形态）。

**判据**：
- ① 在**不知道任何 cron ID** 的前提下连续执行两次武装步骤 ⇒ `CronList` 必须恰好一个 manager loop；
- ② **负控制**：先人为建两个重复的 manager loop，再执行同一武装步骤 ⇒ 必须收敛回恰好一个；
- ③（AC4）`--verify` 必须先 `registry-only`（刚 arm、未 record）、后 `registry-verified`
  （record 之后）——「武装」与「武装且真 cron 已核实」在记录上可区分。

机械落地：`plugin/scripts/manager-arm-loop.sh`（文件接缝上做哨兵清扫 + 收据核实，
`--validate` 查本 7.1 的三条规则）。

### 7.2 prompt 是指针，不是指令内容（AC5c 规则 1）

manager loop 的 prompt **不得携带指令内容，只得携带指针**：

```
Run the manager tick per <repo>/orchestration/manager-loop-tick.md
```

触发后的行为「现读」，不留在上下文里（`/clear`/`/compact` 会抹掉上下文——技能体只装「如何武装」，
不装「触发后做什么」，manda 同款）。上下文被压缩也无从降级，因为本来就没指望上下文里有东西。

### 7.3 每轮状态持久化（AC5b）

每轮 tick 必须写一行进 `orchestration/manager-tick-log.md`（五列：时刻 / 动作类 / 各项目一句话 /
仲裁了什么 / 升级项变化）。**机械挂载点**：`plugin/scripts/manager-tick-log-check.sh` 报出
「上一轮 tick 没落行」（超时无新写入即红，负控制：跳过一轮不写 ⇒ 报红）。
