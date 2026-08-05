# 规格：完整冷启动 + 持续正确驱动，到底要交付什么

**日期**：2026-08-05（管理者）
**触发**：人问「真正完整地冷启动 quay 并可以正确持续驱动开发，要完整交付的到底是什么？
显然应当维护一份文档，并建立相应的校验机制，这才能说是产品化交付。」

**本文件的性质**：交付面的**测量结果**（不是提案）——每一项都标注了当前是否在交付物里、
以及证据。**AC/DoD 与校验机制的实现交给外层**，管理者只给清单与缺口。

---

## 1. 当前在交付物里的（`plugin/`，共 290 个文件）

| 类别 | 数量 | 说明 |
|---|---|---|
| `plugin/scripts/` | 107 | 机件（其中 **19 个由文档引用派生**，`quay-init` 只铺这 19 个 + 硬编码补充） |
| `plugin/test/` | 98 | 测试 |
| `plugin/fixtures/` | 38 | 夹具 |
| `plugin/skills/` | 20 | 技能（含 `cold-start`、`init`） |
| `plugin/gate-scripts/` | 14 | 闸门（**RETIRED 2026-08-05**：经典管线 era 门，铺进目标项目但无调用方=死重；分层退役，文件留树、`quay-init` 不再铺、`sync.sh` 不再 sync） |
| `plugin/probes/` | 4 | 探针 |
| `plugin/vendor/` | 4 | **自包含运行时**（`quay/dist/quay.js`、`quay-native/dist/quay-native.js` + `provider.yml`） |
| `plugin/loop/` | 2 | `fast-mode-loop-tick.md`（inner）、`orchestrator-loop-tick.md`（outer） |
| `plugin/workflows/` | 2 | |
| `plugin/agents/` | 1 | |

`quay-init` 铺进目标项目的目录：`.claude/`、`.quay/`、`docs/`、`orchestration/`、
`plugin/scripts/`、`tasks/`、`vendor/quay/dist/`、`vendor/quay-native/dist/`（`scripts/` 不再铺——
`--gate-scripts` 类别退役，见上）。

---

## 2. 交付物里【没有】的——逐项实测

| 缺失项 | 证据 | 后果 |
|---|---|---|
| **启动命令 / 模型 / 环境变量** | `grep -rl "917000\|claude-deepseek" plugin/` ⇒ 无命中 | `claude-deepseek --model deepseek-v4-flash` + `CLAUDE_CODE_MAX_CONTEXT_TOKENS/AUTO_COMPACT_WINDOW=917000` + `AUTOCOMPACT_PCT_OVERRIDE=80` + `DISABLE_ALTERNATE_SCREEN/MOUSE=1` 是**部落知识**。管理者 2026-08-05 亲自起错过一次（误起成 Anthropic Opus），靠翻 `~/.bash_history` 才找回 |
| **tmux 会话/窗口拓扑约定** | `plugin/loop/`、`plugin/skills/` 无 `:outer`/`:inner`/`:manager` 命名约定 | `<project>-N:outer` / `:inner` / `:manager` 这套三窗口结构没有出厂定义；人手工建的 `meta-cc-3`/`archguard-4` 实测**只有单个 `bash` 窗口、无 claude 进程** |
| **manager 层全部机制** | `plugin/loop/manager*` 不存在；`orchestration/manager-loop-tick.md` 只在 quay 本地 | **交付的是双层、实跑的是三层**。§1.5 ask-vs-act、§1.6 事件 triage、跨项目仲裁、优先级转达全部不随包走 |
| **inner 的周期锚点** | inner `CronCreate` 调用数 = 0（整晚 59 次驱动全来自 outer 的 send-keys） | inner 唯一锚点是 outer 现写的散文 ⇒ 实测措辞漂移：outer 已停用「批」字后 inner 仍复读自己上下文里的 `Batch of N` |
| **升级通道** | meta-cc 缺的 8 个派生脚本里 **7 个是 08-03 之后造的** | 目标项目装完就冻结在那一刻。**漂移不是装错，是交付面自己长大了而目标没有升级路径** |

---

## 3. 现有校验机制的覆盖边界

**`cold-start/SKILL.md` 的 AC8c 六键**：`MONITORS-MOUNTED` / `MONITORS-DELIVERING` /
`CRON-CREATED` / `INNER-DRIVEN` / `TELEMETRY-RECORD` / `FIRST-TASK`。

**它们证明的是「循环启动了」，止于第一个任务派发。** 不覆盖：

- **持续健康**：晋级速率、就绪池水位与多样性（`dispatchable_disjoint`）、套件耗时趋势、
  每测试成本趋势、早期 RED 检测延迟——今晚每一条都恶化过且**无人报出，靠人问出来**
- **语义一致**：inner 的自述措辞是否与出厂语义一致（措辞漂移实测存在）
- **升级正确性**：目标项目的机件与当前交付物的差异（meta-cc 实测 **漂移 10 / 缺失 68 / 一致 8**）
- **三层完整性**：manager 层是否存在、是否有周期锚点

---

## 4. 完整交付面清单（建议的文档结构，供外层立案）

一份「装得上且能持续正确运转」的交付，至少要覆盖六类：

1. **机件与运行时**——已有（`plugin/scripts`、`vendor/`），`quay-init` 派生铺设已修好
2. **循环文档**——已有两层（`fast-mode` / `orchestrator`），**缺 manager 层**
3. **启动配置**——**全缺**：模型、服务商 launcher、上下文环境变量、TUI 环境变量、`--prompt-suggestions false`
4. **会话拓扑**——**全缺**：三窗口命名、每层起什么命令、谁驱动谁
5. **周期锚点**——**三层全缺，OS 级锚点为真实落点**（AC5 修正，2026-08-05）：`gap-loop-has-no-os-level-anchor` 落地后
   （`os-anchor-install.sh` systemd user timer + `os-anchor-watchdog.sh`），锚点不再依赖任何 Claude 会话——
   cron/`ScheduleWakeup`/`CronCreate` 全随会话死，OS 级 timer 才是跨崩溃存活的真实周期锚点
6. **观测与校验**——AC8c 六键（启动瞬间）+ **缺持续健康判据**（第 3 节那五类）

---

## 5. 校验机制的两个层次（这是「才能说是产品化交付」的关键）

**层次一：交付完整性检查**（静态，装之前/装之后都能跑）
判据形如「本清单六类中每一类都有对应交付物，且目标项目落地后逐项可解析」。
现有的 `verify-referenced-landed`（`gap-init-ships` 的产物）只覆盖第 1 类。

**层次二：持续健康检查**（动态，运转期间周期性跑）
现有全部判据都是**点状**的（这次绿了吗、这条合规吗），**没有一条是趋势型**。
今晚已立案 `gap-quality-criteria-are-point-in-time-no-trend-criteria`，
但它的实例只有「每测试成本」与「早期 RED 检测延迟」两条，**第 3 节列的其余三类还没进去**。

**层次二活实例（2026-08-05，`gap-l2-continuous-health-dead-loop-criterion-loop-running-not-installed`）——
「循环在转」判据**：本文件 §2 实测的 meta-cc/archguard「29 小时零进展却全绿 + 自报健康」暴露了
L1 判据全部在查「仪器铺没铺」、没有一条查「循环转没转」。该任务把最小判据固化成了机制
`plugin/scripts/dead-loop-check.sh`（Contract measure：`loop_alive` 字段）：
最近 N 分钟（默认 30）目标项目 outer/inner transcript 有新的 user 消息 或 项目 git 有提交
——任一存在 ⇒ `alive`；都无 ⇒ `dead`（dead-loop）。**与 backlog 空无关**（invariant
`liveness_independent_of_backlog=1`）——队列空（queue-empty）与没人驱动（dead-loop）从此可区分。
这就是「层次二 = 动态、运转期间周期性跑」的第一个落盘实例（层次一查交付完整性、层次二查持续健康）。

---

**本文件不建 AC/DoD、不排优先级——那是外层的活。**
管理者提供的是：交付面的实测清单、五处实测缺口、以及校验机制该分两个层次这个结构判断。
