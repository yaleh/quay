# 规格：完整冷启动 + 持续正确驱动，到底要交付什么

**日期**：2026-08-05（管理者），2026-08-06 升级为活文档
**触发**：人问「真正完整地冷启动 quay 并可以正确持续驱动开发，要完整交付的到底是什么？
显然应当维护一份文档，并建立相应的校验机制，这才能说是产品化交付。」

**本文件的性质**：交付面的**测量结果**（不是提案）——每一项都标注了当前是否在交付物里、
以及证据。**AC/DoD 与校验机制的实现交给外层**，管理者只给清单与缺口。

> **活文档（AC1，2026-08-06）**：本文件是六类交付面的**活清单**——六类 + 每类对应交付物 +
> 归属任务 + 校验判据。随交付物变化更新（单源），不是冻结快照。机械约束：
> `node --experimental-strip-types plugin/scripts/verify-delivery-surface.ts --surface`
> 的 `spec_is_live` 字段必须 = 1（本文件的 L1-MANIFEST 块与可执行清单逐项一致）；若交付物
> 变了而本文没更新，L1 检查会报 `spec_is_live=0`。

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
`plugin/scripts/`、`tasks/`、`.quay/runtime/`（运行时落点，见 §6——不是 `vendor/`/`dist/`，
见 `gap-the-runtime-has-nowhere-safe-to-land` AC9；`scripts/` 不再铺——`--gate-scripts` 类别退役，
见上）。

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

## 4. 完整交付面清单（活文档：六类 + 交付物 + 归属任务 + 校验判据）

一份「装得上且能持续正确运转」的交付，至少要覆盖六类。**L1 完整性检查
（`plugin/scripts/verify-delivery-surface.ts`，AC2）逐类核对下方「交付物」列是否存在于
交付包 / 目标项目**；「归属任务」列是 AC4 的无空洞判据——每条 gap 可解析到已立案任务。
下表随交付物变化更新（单源）；机器可读副本在文末 L1-MANIFEST 块（`spec_is_live` 钉住一致）。

| # | 类别 | 交付物 | 归属任务 | 校验判据 |
|---|---|---|---|---|
| 1 | **机件与运行时** | `plugin/scripts/quay-init.sh`、`sync-vendor.sh`、`verify-installed-executables.sh` | —（自足） | referenced-set ⊆ landed-set（verify_referenced_landed）+ 已铺可执行文件逐字节（verify-installed-executables）；vendor 运行时由 sync-vendor.sh 构建、quay-init 铺入目标 |
| 2 | **循环文档** | `plugin/loop/fast-mode-loop-tick.md`（inner）、`plugin/loop/orchestrator-loop-tick.md`（outer） | `gap-productize-the-manager-layer` | outer+inner 两层 tick 文档随包，铺入 `docs/analysis/` + `orchestration/`；manager 层缺 → 归属该任务 |
| 3 | **启动配置** | `.claude/launch.settings.json`、`plugin/scripts/quay-launch.sh` | `gap-crystallize-launch-config-into-checked-in-settings-file` | 启动命令/模型/上下文环境变量/TUI 环境变量结晶进检查进仓库的 settings 文件；quay-launch.sh 读取并生成启动命令，不再靠手打一行 shell |
| 4 | **会话拓扑** | `plugin/scripts/quay-topology.sh`、`topology-check.sh`、`plugin/skills/session-topology/SKILL.md` | `gap-tmux-session-topology-no-factory-definition` | 三窗口（outer/inner/manager）拓扑出厂定义：每层起什么命令、谁驱动谁（topology-check 钉住） |
| 5 | **周期锚点** | `plugin/scripts/os-anchor-install.sh`、`os-anchor-watchdog.sh` | `gap-loop-has-no-os-level-anchor-cannot-self-recover-after-crash` | OS 级周期锚点（systemd user timer + watchdog）——跨崩溃存活的真实锚点，不依赖任何 Claude 会话 |
| 6 | **观测与校验** | `plugin/scripts/verify-delivery-surface.ts`（L1）、`plugin/skills/cold-start/SKILL.md`（AC8c 六键） | `gap-quality-criteria-are-point-in-time-no-trend-criteria`（L2） | L1 六类完整性检查（本条）+ AC8c 六键（启动瞬间）+ L2 趋势判据（§3 其余三类补进 trend-criteria 任务，AC3） |

<!-- L1-MANIFEST-BEGIN -->
```json
{
  "schemaVersion": 1,
  "categories": [
    {
      "id": 1,
      "name": "mechanism-and-runtime",
      "label": "机件与运行时",
      "deliverables": [
        "plugin/scripts/quay-init.sh",
        "plugin/scripts/sync-vendor.sh",
        "plugin/scripts/verify-installed-executables.sh"
      ],
      "attribution": [],
      "criterion": "referenced-set ⊆ landed-set（verify_referenced_landed，verify-installed-executables 钉住逐字节）；vendor 运行时由 sync-vendor.sh 构建、quay-init 铺入目标"
    },
    {
      "id": 2,
      "name": "loop-docs",
      "label": "循环文档",
      "deliverables": [
        "plugin/loop/fast-mode-loop-tick.md",
        "plugin/loop/orchestrator-loop-tick.md"
      ],
      "attribution": ["gap-productize-the-manager-layer"],
      "criterion": "outer+inner 两层 tick 文档随包（铺入 docs/analysis/ 与 orchestration/）；manager 层缺 → 归属 gap-productize-the-manager-layer"
    },
    {
      "id": 3,
      "name": "launch-config",
      "label": "启动配置",
      "deliverables": [
        ".claude/launch.settings.json",
        "plugin/scripts/quay-launch.sh"
      ],
      "attribution": ["gap-crystallize-launch-config-into-checked-in-settings-file"],
      "criterion": "启动命令/模型/上下文环境变量/TUI 环境变量结晶进检查进仓库的 .claude/launch.settings.json；quay-launch.sh 读取并生成启动命令（不再靠手打一行 shell）"
    },
    {
      "id": 4,
      "name": "session-topology",
      "label": "会话拓扑",
      "deliverables": [
        "plugin/scripts/quay-topology.sh",
        "plugin/scripts/topology-check.sh",
        "plugin/skills/session-topology/SKILL.md"
      ],
      "attribution": ["gap-tmux-session-topology-no-factory-definition"],
      "criterion": "三窗口（outer/inner/manager）拓扑出厂定义：quay-topology.sh + topology-check.sh + session-topology skill（每层起什么命令、谁驱动谁）"
    },
    {
      "id": 5,
      "name": "periodic-anchor",
      "label": "周期锚点",
      "deliverables": [
        "plugin/scripts/os-anchor-install.sh",
        "plugin/scripts/os-anchor-watchdog.sh"
      ],
      "attribution": ["gap-loop-has-no-os-level-anchor-cannot-self-recover-after-crash"],
      "criterion": "OS 级周期锚点（os-anchor-install.sh systemd user timer + os-anchor-watchdog.sh）——跨崩溃存活的真实周期锚点，不依赖任何 Claude 会话"
    },
    {
      "id": 6,
      "name": "observation-and-verification",
      "label": "观测与校验",
      "deliverables": [
        "plugin/scripts/verify-delivery-surface.ts",
        "plugin/skills/cold-start/SKILL.md"
      ],
      "attribution": ["gap-quality-criteria-are-point-in-time-no-trend-criteria"],
      "criterion": "L1 六类完整性检查（本条）+ AC8c 六键（启动瞬间）+ L2 趋势判据（gap-quality-criteria-are-point-in-time-no-trend-criteria 承载）"
    }
  ]
}
```
<!-- L1-MANIFEST-END -->

**AC4 归属无空洞（2026-08-06，`gap-complete-delivery-surface-spec-and-l1-verification`）**：本文档 §2
每个缺口都可逐项解析到已立案任务（L1 检查的 `attribution` 列 + `attributionHoles` 报出机械钉住）：
- manager 层（循环文档第 3 层）→ `gap-productize-the-manager-layer`
- 启动配置 → `gap-crystallize-launch-config-into-checked-in-settings-file`
- 会话拓扑 → `gap-tmux-session-topology-no-factory-definition`
- 周期锚点 → `gap-loop-has-no-os-level-anchor-cannot-self-recover-after-crash`（OS 级锚点）
- 升级通道 → `gap-delivery-surface-grows-but-target-freezes-no-upgrade`（+ `gap-upgrade-channel-cant-sync-build-artifacts-dist-stale`）
- L2 持续健康（趋势判据）→ `gap-quality-criteria-are-point-in-time-no-trend-criteria`

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

## 6. 落地集合与 G2 的关系（`gap-the-runtime-has-nowhere-safe-to-land` AC6）

**落地集合（landed set）的定义**：**quay-init 机械铺进目标工作区的文件集合**——按落盘操作
（filesystem laydown）定义，**不是按「目标是否提交进 git」定义**。运行时（`.quay/runtime/bin/
quay.js`、`quay-native.js`、`.quay/runtime/provider.yml`）**算落地集合的一员**（算 ⇒ 字节相同）。

**G2「落地文件全部与产物字节相同」判据怎么算**：G2 的字节相同判据是**落盘时的文件系统比较**——
每个铺下的文件（含运行时）与产物字节相同，由 `copy_one` 的可 `cmp` 复制 + e2e `artifactDiffs`
断言机械钉住。**git 是否跟踪是另一条正交的轴**：gitignore 是目标项目的 VCS 策略，**不改变落地
文件的字节身份**。被 gitignore 的运行时仍在落地集合里、仍与产物字节相同——**G2 成立**。

**这不是定义漏洞**（外层的前置问题），因为三点机械成立：
1. 落地集合从未按「提交的文件」定义——e2e 一直数文件系统文件（`loopLaidDownFiles`），不是
   git 跟踪文件；
2. 字节相同判据仍作用于运行时（`copy_one` + `artifactDiffs`），gitignore 不豁免任何字节身份；
3. **gitignore 条目由 quay-init 自己写入**（AC10，`ensure_runtime_gitignore`）——不是让使用者
   打补丁 ⇒ **G0（人工补丁数 = 0）成立**。让使用者自己加 gitignore 例外，等价于要求他打一条
   补丁，正是 G0 明令为 0 的东西。

**为什么运行时不该进目标 git**（约束 #2）：`packages/quay/dist/quay.js` 单文件 **1,340,008 字节**
（2026-08-06 实测；任务立案时 1,329,851——产物在长），而 `pre-commit` 的 `check-added-large-files`
默认阈值 **500KB**（= 512,000 字节）。提交运行时会撞任何装了默认阈值钩子的目标；**不提交 + 由
init 写 gitignore** 才是「运行时是产物不是源码」这一事实的机械落地。

---

**本文件不建 AC/DoD、不排优先级——那是外层的活。**
管理者提供的是：交付面的实测清单、五处实测缺口、以及校验机制该分两个层次这个结构判断。
