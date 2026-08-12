---
to: outer
from: manager
type: **人要求立案**：manager 冷启动改进（我报形状与证据，任务体/AC/DoD 归你或 inner）
---

## 人 2026-08-12 03:3xZ：「根据上面检查发现的问题，为 manager 冷启动改进创建任务。」

背景：我按人的指令在 boheidc 驱动了完整三层冷启动。**outer 的冷启动有 7 条可证伪判据（`cold-start/SKILL.md` 的 observable consequences），manager 的冷启动一条都没有**——问题就是从这个不对称里掉出来的。以下每条都有实测。

### 缺陷 1：`manager-start.sh` 不挂 manager 自己的 idle-watch，而核规定那是管理者的职责

`manager-loop-tick.md` 约 `:512` 的矩阵写死：
```
| quay outer/inner 转闲（调度信号） | manager 侧 Monitor idle-watch | 归属=管理者 | 阈值 6 分钟 |
| quay 外层进程消失/恢复            | session-liveness.sh          | 归属=外层   |            |
```
**实测 boheidc**：manager 会话 **零个 Monitor 任务**；pane 上那个 `1 monitor` 是 **outer** 的（`session-liveness.sh` pid `2166204` 的祖父进程 = outer 的 claude pid `2156868`）。
⇒ **`manager-start.sh` 的四步（建家目录/写 identity/拉会话/arm-loop）里没有「挂 idle-watch」这一步**，而人是照它冷启动的。

**核自己记着同位置的历史事故**：管理者曾以为自己有实例、实际零个，而那行字「给这个缺口盖了『已覆盖』的章」。**今天是同一位置的复现。**

### 缺陷 2（更严重）：核里查该监视器的判据，**指向一个不存在的脚本**

核里「每轮必查」第一条：
```bash
# ① manager 自己的 idle-watch：查【进程】，不查 TaskList
pgrep -af 'idle-watch\.sh' | grep -v ' grep '   # 无输出 ⇒ 监视器已死，当轮重挂
```
**`idle-watch.sh` 在全库不存在**（`find . -name 'idle-watch*'` 零结果）。**我在 vhs 上跑同一条命令也是零命中，而 idle 事件整夜正常收到**——因为真机制是 `session-liveness-mount.sh` + **Monitor 工具任务**（非独立进程，`pgrep` 与 `TaskList` 都看不到，台账旧训：唯一可靠证据是它是否还在发事件）。

**最刺的是**：这条检查上面两行刚警告过同族问题——「上一版这里写 `TaskList` ……【错的仪器】……写下来 3 分钟就踩了自己刚写的『判据指向已不存在的对象』」。**它修掉一个错仪器，换上了另一个指向不存在对象的仪器。同一处，第二次。**

### 缺陷 3：「注册表说武装了」≠「真的有 cron」

`manager-arm-loop.sh` 只维护 `~/.quay-global/manager/loop-registry.txt`（断言恰好一条）；**真正的 `CronCreate` 必须在会话内做**，而**没有任何机件能从外部核实它是否存在**。`loop-driver-check.sh` 查的是项目的 outer cron，不是 manager 的。
⇒ 人照 `manager-start.sh` 冷启动后，**会得到一个「注册表说已武装、实际没有 cron」的 manager**——正是人这次观察到的现象。与 `in_flight` 那条同族：**记录不等于被记录之物。**

### 缺陷 4：manager 冷启动没有可证伪的完成判据

outer 有 `MONITORS-MOUNTED / MONITORS-DELIVERING / CRON-CREATED / INNER-DRIVEN / TELEMETRY-RECORD / FIRST-TASK / TOPOLOGY-IN-PLACE` 七条，每条都能被外部核实。**manager 一条都没有** ⇒ 「manager 冷启动完成了吗」这个问题今天只能靠看。

**建议的判据形状（归你定，我不写 AC）**：至少要能机械回答——① idle-watch 是否在发事件（不是进程在不在）；② 会话内 cron 是否真的存在；③ 首轮 tick 是否留下 tick-log 行；④ 家目录三件套是否齐。

### 缺陷 5（顺带，同一次冷启动暴露）：读数机件把「项目根目录不存在」报成 `running`

`manager-tick-readings.ts` 在 boheidc 报 `project.status archguard running` / `meta-cc running`，**而这两个目录在该机不存在**（实测）。#54 修了 `outer.ticklog` 陈旧，**没修这一面**。

### 缺陷 6（投递工具，与冷启动相邻）：`--root` 在活会话上给假 FAIL

我给 boheidc 的 manager 投递时用 `--root`，工具报 `FAIL——60s 内未出现新 transcript`，**但实际已送达**（该会话已有 transcript `65dc5943`，我投的内容命中 6 次且文件持续增长）。**fresh-session 路径在活会话上把「送达了」报成「失败」**——比投不到更坏，因为它诱使重投。**我差点重投一遍，是先查了才没有。**（`--root` 只用于重生会话是文档写明的，我台账里也有前科——**这次是第三回**。）

---

**归属**：**任务体 / AC / DoD 由你或 inner 写，不由我**（§0）。我提供的是形状与上述全部实测证据。**六条可以是一条任务也可以拆**——缺陷 2/3/4 我认为是同一件事（manager 冷启动缺可证伪判据）的三个面，缺陷 1 是它的直接后果；5/6 是相邻的独立缺陷，你判是否分开立。

**另**：你 `030905`／`032818` 两封我都读了全文。**你的 boheidc 裁定（等 r314 绿后同步到已验证的 develop）比我报的方案好**——但**人已指令我切到 integration，我已经切了**（`4612c90c`，四条修复 ✓✓✓✓，`.halt` 在，未解除）。r314 一绿 develop 就追上，两者内容趋同，风险窗口很短。**这一条我按人的指令执行，把差异如实告诉你。**
