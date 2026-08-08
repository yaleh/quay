# 规格：manager 的产品化交付

**日期**：2026-08-05（管理者，人给出五条约束）
**性质**：把「manager 是产品的一部分」从口头共识变成可判定的交付面。
**AC/DoD 与立案由外层判断**——但见 §3：**外层建造 manager，外层不运行 manager。**

---

## 1. 人给出的五条约束（原话拆解）

| # | 约束 | 判定形态 |
|---|---|---|
| C1 | **它是产品交付的一部分** | `plugin/` 里必须有它；`npm pack` 的产物里必须有它 |
| C2 | **它（通常）用于跨项目** | 它的家、状态、身份都不得属于任何单个项目 |
| C3 | **outer 不应该管 manager** | 项目拓扑工厂、outer 的 tick、outer 的自举，都不得创建或驱动 manager |
| C4 | **它应当可以独立地冷启动** | 在零项目、零会话的机器上，一条命令把 manager 自己拉起来 |
| C5 | **它能启动多个项目的 outer+inner，但这一启动与它自身的启动分开** | 两条命令，不是一条带参数的命令 |

---

## 2. 实测：当前的 manager 违反了其中四条

**这不是设计讨论，是当前实例的实际位置。** 2026-08-05 16:4xZ 实测：

| 证据 | 实测值 | 违反 |
|---|---|---|
| tmux 位置 | `quay-0:manager`——**在 quay 的会话里**，与 outer/inner 同级 | C2、C3 |
| 工作目录 | `/home/yale/work/quay` | C2 |
| transcript 目录 | `~/.claude/projects/-home-yale-work-quay/` | C2 |
| 目标/AC 文档 | `orchestration/manager-*.md`——**签入 quay 仓库** | C2 |
| `plugin/loop/` 内容 | 只有 `orchestrator-loop-tick.md`、`fast-mode-loop-tick.md`，**无 manager 文档** | C1 |
| `plugin/` 里的 manager 提及 | 全部是**注释里说明"manager 不属于这里"**，没有一行是 manager 的实现 | C1 |
| 冷启动路径 | **不存在**——当前实例是一夜手工拼装的 | C4 |
| 启动项目的能力 | 有（`quay-topology.sh`），但**没有"启动我自己"这一半** | C5 |

**唯一没被违反的是 C3 的一半**：`quay-topology.sh` 已于今日改成 `ROLES="outer inner"`，
manager 已从项目拓扑工厂中移除（`gap-manager-baked-into-project-topology-factory`）。
**那次修的是"outer 不该创建 manager"，而这份规格要修的是"manager 不该住在 outer 家里"。**

### 2.1 最尖锐的一条：看门人自己无人看门

```
os-anchor-projects.conf  →  看护 quay / meta-cc / archguard 的 outer
manager                  →  不在名单里
manager 的 */17 心跳     →  CronList 显示 [session-only]
```

**manager 是唯一一个观测所有项目存活的角色，而它自己既不被 OS 锚看护，
心跳又是会话作用域的——会话一死，心跳随之消失，且不会有任何告警。**

这与今晚四次全灭的成因完全同型（所有周期锚点都是会话作用域），
只是那四次修的是 outer 的锚，manager 的锚从来没修过。
**今晚四次全灭都靠人重启 manager，这不是巧合，是这条缺口的直接表现。**

---

## 3. 关键区分：建造归属 ≠ 运行归属

C3 说「outer 不应该管 manager」，但 manager 的代码总得有人写。这两件事不冲突，
因为它们是不同的时态：

| | 归谁 | 依据 |
|---|---|---|
| **建造**（写 manager 的代码、进 `plugin/`、进 npm 包） | **quay 的 outer/inner** | manager 是 quay 这个产品的组件，与 CLI/MCP/web 同级 |
| **运行**（谁创建 manager 会话、谁驱动它、谁重启它） | **人 或 OS 锚，绝不是 outer** | manager 在 outer 之上，被下级创建则层级倒置 |

**判据**：`plugin/` 里可以有 manager 的实现；`orchestrator-loop-tick.md` 里
**不得出现任何创建/驱动/检查 manager 的步骤**。今天已经踩过一次——
我在转达外层自举需求时写了「创建三窗口」，人当场纠正。**这条要成为机械检查，不是纪律。**

---

## 4. 两条分开的启动（C5 的核心）

### 4.1 `manager start` —— 启动我自己，**不接受项目参数**

```
quay manager start
  ├─ 建自己的会话：独立 tmux session（如 `quay-manager`），不进任何项目的 session
  ├─ 设自己的家：$QUAY_GLOBAL_DIR/manager/（状态、目标、tick 日志、观测器配置）
  ├─ 装自己的 OS 锚：systemd user timer，与项目的 watchdog 分开的 unit
  ├─ 挂自己的观测器：由启动流程挂，不是人手工挂
  └─ 起自己的心跳：不得用会话作用域的 cron
```

**为什么必须不接受项目参数**：见 §4.3。

### 4.2 `manager adopt <project-root>` —— 启动一个项目的 outer+inner

```
quay manager adopt /path/to/project
  ├─ 观察：该项目的 tmux 窗口与会话是否已存在且真活
  ├─ 已活   ⇒ noop（可能是别人建的，不要动）
  ├─ 空壳   ⇒ 驱动，不重建
  ├─ 不存在 ⇒ 调 quay-topology.sh 建两窗口（outer+inner）
  └─ 登记：写进 manager 自己的项目登记表 + OS 锚的看护名单
```

**三态语义与 `inner-session-check.sh` 完全一致**（healthy / empty-shell / missing）——
**这不是巧合，应当复用同一段判定，而不是写第二份。**
今天已经证明这类判定手写一次就错一次（pane 哈希 3 次假阳、heartbeat 42 分钟冻结、
discovery 认错 transcript）。

### 4.3 为什么两者必须分开（四条独立理由）

1. **生命期不同**——manager 必须比任何项目活得久；退掉一个项目不该碰 manager。
2. **故障隔离**——一个坏项目不得阻塞 manager 拉起。今晚四次全灭后的恢复顺序永远是
   「先起 manager，再逐个起项目」，**合成一条命令就无法表达这个顺序**。
3. **部分存活时无正确语义**——若 3 个项目里 1 个活着，一条组合命令该做什么？
   分开后答案平凡：`start` 幂等、`adopt` 逐项目幂等。
4. **可测性——这条最重要**：AC12b 要求「manager 发出一条命令后什么都不碰」。
   若启动与驱动是同一条命令，**"没有干预"就无法被测量**。
   分开之后，AC12b 的操作定义变成一句可核对的话：
   > **`manager adopt` 之后，manager 对该项目的动作次数 = 0。**

---

## 5. manager 拥有什么 / 绝不拥有什么

**拥有**（跨项目，且只有它在这个位置）：
- 跨项目的优先级与排序
- 网络级存活观测（谁死了、谁空转）
- 跨项目发现的转达（一个项目测出的缺陷传给另一个）
- 共享资源视图（一台主机、多个项目——**这个视角只有 manager 有**）
- 跨主机协调（A 机 / B 机）

**绝不拥有**（今晚三次违反，全部由人纠正）：

| 违反 | 我做了什么 | 为什么错 |
|---|---|---|
| 1 | 建议 archguard 自己做资源观测 | 与 archguard 的定位无关；机制应由 quay 做一次往下游流 |
| 2 | 建议 archguard 自己设计自适应并发 | 同上——**下游不该各自发明机制** |
| 3 | 自己手搭 waiting-for-input 观测器 | 仓库里已有 `classifyPaneState`，更严谨；**manager 不造 quay 该提供的能力** |

**由此得出一条可机械化的判据**：
> **manager 若需要一个新的观测/判定能力，它的产出应当是一条转给外层的需求，
> 而不是一个自己写的脚本。** manager 手里出现 `.sh`/`.ts` 实现即为越界信号。

**措辞澄清（人 2026-08-06 追问后补，因为原文可被误读成相反的意思）**：

| | 判定 |
|---|---|
| manager **自己写**一个 `.sh`/`.ts` 实现 | ❌ **越界**——这是本条禁止的行为 |
| manager **调用**产品化的 `.sh`/`.ts` 工具 | ✅ **恰恰是本条要求的**——见上表违反 3 的理由原文：「仓库里已有 `classifyPaneState`，更严谨；manager 不造 quay 该提供的能力」 |

**两半是同一件事**：禁止自己写，正因为应该用现成的。原文「manager 手里出现 `.sh`/`.ts` **实现**」
里，「实现」二字承担了全部区分，字面上容易被读成「碰都不能碰」——**不是那个意思**。

**2026-08-06 的实证（管理者自曝）**：管理者在读过本节的同一个会话里，**两半都违反了**——
既自己手写了 8 个已有能力的劣质替代品（违反前半：pane 忙闲判定、循环死活判定、AC10 计数、
生成器问句、tmux 泄漏扫描、同步落后量计算、裸 `tmux send-keys`、用 `send-keys-reliable.sh`
而非窄接口 `supervisor-deliver.sh`），又因此没有使用对应的现成工具（违反后半）。
⇒ **本节作为散文规则被证明无效**，落地机制见
`tasks/gap-manager-skill-missing-mandatory-tool-reuse-checklist.md`（强制挂载点，写脚本前先查目录）
与 `tasks/gap-tmux-isolated-guard-has-zero-consumers-fifth-machine-wipe.md` AC3/AC9（机械静态检查）。

> **落地状态（2026-08-07，`gap-manager-skill-missing-mandatory-tool-reuse-checklist` 执行后）**：
> 本节的「从文档走向可执行」已随包落在 `plugin/skills/manager/SKILL.md` §9「工具复用强制挂载点」——manager
> 在写任何新 `.sh`/`.ts` 前必须先跑 `bash plugin/scripts/capability-catalog.sh | grep -i <关键词>` 作为
> Step 0 前置检查（AC2）；8 项复用对照表随 SKILL 铺设（AC1）……

今晚的对照数据支持这条：我手工造的观测判据，**连续四次**都不如已有机制严谨
（pane 哈希、heartbeat、`pgrep -f` 自匹配、`grep -c` 自匹配）。

---

## 6. 独立冷启动（C4）具体需要什么

| 要素 | 现状 | 需要 |
|---|---|---|
| **家** | 在 quay 仓库里 | `$QUAY_GLOBAL_DIR/manager/`，与项目无关 |
| **身份** | `quay-0:manager` | 独立 session，名字不含任何项目名 |
| **锚** | 无（心跳 session-only、不在 watchdog 名单） | 自己的 systemd unit，与项目 watchdog 分开 |
| **观测器** | 人手工挂，参数错了三次 | 由 `manager start` 挂，参数固化 |
| **项目发现** | 硬编码在我的提示词里 | 登记表（`adopt` 写入），或按会话命名约定扫描 |
| **目标/AC** | `orchestration/manager-phase-goal.md`（quay 仓库内） | 分开：**产品侧的 manager 行为**进 `plugin/`；**本实验的阶段目标**留 `orchestration/` |

**最后一行是个真实的切分难点，值得单独说**：当前 `manager-phase-goal.md` 里
混着两种东西——「manager 这个角色该怎么做事」（AC10 开轴、AC11 验证方式先被验证、
角色边界纪律）是**产品**；「本阶段测什么、B 机怎么用、archguard 排在哪」是**本实验的状态**。
按 `SPEC-state-crystallization` 的判据（名词进代码、动词留文本）：
**前者是动词，应进 `plugin/loop/manager-loop-tick.md`；后者是名词，留在实验层。**

---

## 7. 一个必须先裁定的冲突：谁创建 inner

今天落地的 `inner-session-check.sh` 让 **outer 会在 inner 缺失时创建它**。
而本规格的 `manager adopt` 也会创建 outer+inner。⇒ **两个创建者。**

今晚已经有一个同型教训：`$QUAY_GLOBAL_DIR` 单飞锁在跨主机时失效，
根因是「多个写入者，无人是权威」（`SPEC-state-crystallization` §3）。

**可选的解**（我倾向第一个，但**裁定权在外层**）：
1. **谁发现缺失谁创建，但创建必须走同一个幂等入口 + 锁**——保留双方的自愈能力，
   代价是必须有一个真的原子创建（`quay-topology.sh` 加单飞锁）；
2. **只有 manager 能创建，outer 只能报告缺失**——层级更干净，
   但**牺牲了 C4 的对偶**：没有 manager 的单项目用户就失去了 outer 自愈能力。

**②的代价是决定性的**：shipped quay = outer + inner，manager 是可选的。
若创建权收归 manager，则**不装 manager 的用户拿不到自愈**——这与「manager 通常用于跨项目」
（言下之意：单项目可以不用）矛盾。⇒ **倾向 ①。**

---

## 8. 未验证的部分（不要读成已完成）

按 AC11：以下全部是**读码 + 实测当前状态**得出，但**没有一条被真的跑过**：

- `manager start` **不存在**，因此「能独立冷启动」是设计意图，不是已验证事实；
- manager 的 OS 锚**从未装过**，第 2.1 节的缺口是实测的，但修法未验证；
- 两条命令的分离**从未在真实崩溃恢复中用过**——今晚四次恢复全是人手工按 RUNBOOK 做的；
- §7 的锁**不存在**，双创建者的竞态**尚未真的发生过**（因为 manager 从没自动创建过项目）。

**判据**：本规格落地后，第一个该测的不是功能，是
> **在一台只有 git 和 claude 的机器上，`manager start` 之后 `manager adopt` 两个项目，
> 然后杀掉 manager 的会话——OS 锚能否把它拉回来，且两个项目在此期间不受影响。**

这一条同时覆盖 C1–C5 全部五条，且**它是"离乳"判据的 manager 版本**：
manager 能否在没有创建它的那个人在场时维持自身。

---

**本文件不建 AC/DoD、不排优先级——那是外层的活。**
管理者提供：五条约束的可判定形态、当前实例违反四条的实测证据、
建造/运行归属的时态区分、两条命令分离的四条理由（含 AC12b 可测性）、
manager 越界的机械信号、以及双创建者冲突的两个选项与倾向。
