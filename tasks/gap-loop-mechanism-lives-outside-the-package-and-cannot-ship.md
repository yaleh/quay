---
id: gap-loop-mechanism-lives-outside-the-package-and-cannot-ship
title: Make cold-start (and upgrade-from-old-quay) a skill — quay-init installs
  the wrong assets and 7 loop files live outside the plugin
status: done
labels:
  - gap
  - milestone-candidate
extra:
  schema: v1
---

**type:** execution

## Proposal

人 2026-08-03 给出交付物的三条硬判据（**user scope 安装** / **几条 README 命令就能配好并真正开始持续开发** /
**运行时不依赖本项目开发环境目录下的文件**），随后指出：
**「在项目中冷启动（甚至包括从旧 quay 升级）quay 的能力应当做成一个 skill。」**

### 载体已经存在——不要重造

quay **已经是一个 Claude Code plugin**：`plugin/.claude-plugin/plugin.json` + `marketplace.json`，
带 10 个 skill。其中 **`quay-init` 已经在做这件事的形状**——
从 `${CLAUDE_PLUGIN_ROOT}` 幂等地把方法论资产铺进工作区，带 `--dry-run` / `--force` / 冲突不覆盖。

**缺的不是 skill 这个形式，是它铺的东西不对、以及一半机制在 plugin 之外。**

### 实测：三个具体缺口

**缺口一——`quay-init` 只铺三类，双层机制一类都不在其中：**

| `quay-init` 铺的 | 内容 |
|---|---|
| `plugin/workflows/` → `.claude/workflows/` | 2 项（`drain-directives.js`、`run-routines.js`） |
| `plugin/agents/` → `.claude/agents/` | 1 项 |
| `plugin/gate-scripts/` → `scripts/gates/` | 14 项 |

**`plugin/scripts/` 不在列表里。** 而双层机制的 4 个检查器正在那里：
`fast-mode-telemetry.ts`、`task-contract-check.ts`、`task-status-drift-check.ts`、
`touches-orthogonality-check.ts`——**它们随包走，但没有任何命令把它们铺进目标项目。**

**缺口二——7 个机制文件在 plugin 之外，根本不随包走：**

| 文件 | 角色 |
|---|---|
| `orchestration/orchestrator-loop-tick.md` | **外层驱动文档**（481 行） |
| `docs/analysis/fast-mode-loop-tick.md` | **内层驱动文档**（412 行） |
| `orchestration/watch/inner-forensics.mjs` | 内层取证 |
| `orchestration/watch/inner-state.sh` | 内层状态监测（Monitor 挂载点） |
| `scripts/resource-gate.sh` | 资源闸 |
| `scripts/heavy-op-token.sh` | 跨项目重活令牌（**本来就是跨项目设计的**） |
| `scripts/test.sh` | 判绿约定的载体 |
| `plugin/scripts/touches-orthogonality-check.ts` | **并发派发的正交性判据**（在 plugin 内，但 `quay-init` 不铺） |
| `plugin/scripts/concurrent-batch-scheduler.ts` | **并发批次组装**（同上） |

### 范围裁定（执行前，2026-08-03）：`scripts/test.sh` **不搬进 `plugin/`**

外层要求执行前先答：缺口二的表把 `scripts/test.sh` 列为「机制文件」，而 Chosen mechanism 只说
`.sh`/`.mjs` 进 `plugin/scripts/`，两处打架。

**裁定：不搬。** `scripts/test.sh` 留在本仓根。理由：

1. **它是 quay 本仓的测试入口，不是可移植机制**——`node --test` 专用、本仓 CI 入口
   （`.github/workflows/ci.yml`）+ 15 处文档引用。搬它是大范围重构，且对 archguard
   （vitest）/meta-cc（`go test`）没有可移植收益——它们用不了这份 test.sh。
2. **判绿约定的载体是 tick 文档，不是 test.sh 的字面路径**——AC4 负控制明写「铺完后 grep 不到
   `scripts/test.sh` 这类 quay 专属字面」：铺到目标项目的 tick 文档用**占位符替换目标项目的测试命令**。
   判绿概念随 tick 文档走（`cancelled 0` / `FULL-SUITE-EXIT=0` / `tests=reference` 的 grep 约定），
   具体载体随项目。
3. **搬移的「机制」应项目无关**：resource-gate、heavy-op-token、tick 文档、检查器、inner-state、
   inner-forensics、telemetry——这些搬；test.sh 是 quay 自己的实例。

**影响**：缺口二的「7 个 plugin 外文件」→ 实际搬 **6 个**（test.sh 除外）。`quay-init --loop` 的
占位符替换把「目标项目的测试命令」参数化（AC4），冷启动的空项目由此获得自己的测试入口约定，
不依赖 quay 开发树。**test.sh 不列进 `## Touches`**（未定为搬移对象）。

**缺口三——`quay-task-operator` skill 在磁盘上但 `plugin.json` 的 `commands` 没列**（10 个 skill 只列了 9 个），
装了也不暴露。

### 证据来源

archguard 冷启动（第一次在第二个项目上真跑）**照着移植来的 tick 文档做**，
产出 `archguard/orchestration/cold-start-gaps.md`，列出 13 个文档引用而目标项目没有的文件。
外层逐个对回 quay 文件树核实后得到上表。

**外层在此之前给出过两个更差的诊断**，都被实测推翻：先是「`files` 字段忘了列」（错，
`files` 够不到包目录之外），再是「机制全部在包外」（错，4 个检查器在 plugin 内）。
**记下来是因为读表的人应当知道这张表改过两次，第三版才对得上文件系统。**

### 已经是冷的那一半（不要重做）

archguard 的 `.quay/config.yml` **完全自足**：路径全相对、`mcp_entry: ["quay-native","mcp"]` 走 PATH、
自带 `loop:` 段。**配置面已满足第 3 条判据。**

### 实测到的真实危害：不是硬失败，是静默降级到被禁止的方法

人 2026-08-03 观察到 archguard 外层**频繁调用 `tmux capture-pane`**，问是否与 quay 一致。实测：

| 取状态手段 | quay | archguard |
|---|---|---|
| `fast-mode-telemetry.ts --report --json` | 有 | **缺** |
| `orchestration/watch/inner-state.sh`（Monitor 挂载点） | 有 | **缺** |
| `orchestration/watch/inner-forensics.mjs` | 有 | **缺** |
| `.workflow-events/`（遥测数据） | 有 | **缺** |

实际频度（transcript 计数）：

```
quay        capture-pane 395 次  |  遥测/状态脚本 2679 次   ≈ 1:6.8
archguard   capture-pane  34 次  |  遥测/状态脚本   36 次   ≈ 1:1
```

（archguard 那 36 次多半是它**写差异清单时提到**这些缺失文件，不是真调用——真实比值更差。）

`CLAUDE.md:151` 的明文约定是 **「read the RESULT from the filesystem/`git`/meta-cc — never parse the TUI」**。

**⇒ 缺这批文件不会报错，它让外层静默退化成一个顶层约定明令禁止的方法。**
这是本任务优先级的真实依据：一个不报错的降级，比一个崩溃危险得多。


### 第二个实测危害：无并发

archguard 冷启动 12 分钟时，外层**只能串行等一个全量 vitest 跑完**——
`touches-orthogonality-check.ts` 与 `concurrent-batch-scheduler.ts` 都没跟过去。
quay 的外层在同样情形下会**并行派发文件不相交的任务**（`.quay/config.yml` 的 `concurrency: 4` 声明了意图，
但没有判据脚本就无法执行）。

**⇒ 目标项目会拿到一个声明了并发、却没有并发判据的配置。** 这比没有并发更糟：配置说 4，实际是 1，
而没有任何东西报错。


### 第三个实测危害：没有「怎么等」的机制，外层退化成忙等

人 2026-08-03 观察到 archguard 外层在**高频紧循环**执行
`tmux capture-pane -p -t archguard-2:0.0 | md5sum`——三次调用之间只隔几秒。

**成因是管理者给了方法却没给节奏**：上一 tick 纠正它「capture-pane 只用于判忙闲
（两次 md5sum 相同 = 空闲）」，它照做，于是变成了轮询。

quay 的外层**不轮询**：`orchestration/watch/inner-state.sh` + Monitor 是**事件驱动**的，
状态变化才唤醒。archguard 两样都没有（`inner-state.sh` 在缺失清单第 2 条）。

**⇒ 「外层怎么观察内层」本身是一个必须随包走的机制，不是 tick 文档里的一句散文。**
人明确要求：「这也应该有 skill 解决。」

## 一条关于本任务自身的证据：散文阻止不了复发

管理者在 `orchestration/manager-loop-tick.md` 的失效表里写下
「**管道后读 `$?`** —— 要退出码就不要管道」，**十分钟后又犯了第三次**
（`bash restart-readiness-check.sh | tail | sed` 之后 `echo $?`，读到的是 `sed` 的 0，
而检查本身报的是 `NOT READY`）。

今晚这一族共三次：archguard 的 lint（读成 exit 0，实为 1）、
restart-readiness-check（读成 0，实为失败）、以及最初的那次。

**这正是 ADR-004「硬检查优于散文」的自证**：把规则写进文档不能阻止它复发。
所以本任务铺设的机制里**必须包含机械检查**，而不是只铺文档。

## Contract

```
measure  installed  = `quay-init --loop --dry-run` 输出中 would-copy 行的计数字段
measure  cold_exit  = `bash test/cold-start-e2e.sh` 的退出码字段
measure  packed     = `npm pack --dry-run --json` 输出中 files[].path 的计数字段
band     cold_exit = 0
invariant 目标项目运行时不读取任何 quay 开发树下的绝对路径      # 第 3 条判据
invoke   `bash test/cold-start-e2e.sh`
control  把 quay 开发树改名 ⇒ 冷启动脚本必须仍然走通；旧版 quay 已装的工作区跑升级 ⇒ 不得覆盖其本地改动
resume   每铺完一类资产即记一次，中断可续
```

## Chosen mechanism

**扩展现有 `quay-init`，不新造 skill。** 它已经有幂等、`--dry-run`、冲突不覆盖这三样，
重造一个会立刻产生两套铺设逻辑——**那正是本仓反复在修的漂移**。

1. **把 7 个 plugin 外的机制文件搬进 `plugin/`**（tick 文档进 `plugin/loop/`，
   `.sh`/`.mjs` 进 `plugin/scripts/`）。（**前提更正 2026-08-03：`fast-mode-telemetry.ts` 的
   「双份」是假前提**——`experiments/quay-perpetual-stream/scripts/fast-mode-telemetry.ts` 自
   2026-08-02 起就是符号链接（mode 120000，blob 6a1523e8，单提交 40ad4a24 创建时即链接），
   AC2 开工前已满足，本任务未改动。假前提来自 archguard 冷启动差异清单，外层两轮核实都用
   按名字找文件（`find -name`/`ls` 路径存在），回答不了「是不是链接」——要看 mode 需
   `ls -la`/`git ls-tree`。）
2. **`quay-init` 加 `--loop` 类别**：铺双层机制（两份 tick 文档 + 检查器 + 闸 + 令牌），
   并**在铺 tick 文档时做占位符替换**（测试命令、tmux 会话名、项目名）——
   archguard 那次是我手工 `sed` 的，那一步必须机械化。
3. **升级路径**：检测目标工作区已有的 quay 版本与已铺资产，
   **只补差量、不覆盖本地改动**，冲突列出来让人裁定。这是人明确点名的场景。
4. **补 `plugin.json` 的 `commands`**，把 `quay-task-operator` 列进去。
5. **一个端到端冷启动脚本** `test/cold-start-e2e.sh`：在临时目录建空项目 →
   装 plugin → `quay-init --all --loop` → 断言循环所需文件齐全且**不含任何 quay 开发树绝对路径**。

**不做**：不写产品化白皮书；不动 `.quay/config.yml` 格式（那面已冷）；
不在本任务里修 archguard 自己的 CI/lint/测试（那是 archguard 的活）；
不把 `tick-log.md`/`escalations.md` 打进包（**它们是首跑生成的每项目状态**——
`cold-start-gaps.md` 把它们误列为「交付物缺失」，照做会把本仓事故史打进交付物）。

## Acceptance Criteria

- [x] AC1: 6 个 plugin 外的机制文件全部搬入 `plugin/`（范围裁定：`scripts/test.sh` 除外），
      每个有归属理由；「以防万一」不是理由
- [x] AC2: `fast-mode-telemetry.ts` 的「双份」**开工前已满足**（前提为假）——`experiments/` 侧自
      2026-08-02 起就是符号链接（mode 120000，blob 6a1523e8），唯一物理副本是
      `plugin/scripts/fast-mode-telemetry.ts`；本任务未改动（git ls-tree 合并前后同 blob）
- [x] AC3: `quay-init --loop` 铺出双层机制全套，`--dry-run` 逐项列出（实跑输出见「执行记录」）
- [x] AC4: tick 文档的占位符替换**机械化**——目标项目的测试命令/会话名/项目名可参数化，
      不需要手工 `sed`（负控制：铺完后 grep 不到 `scripts/test.sh` 这类 quay 专属字面，见执行记录）
- [x] AC5: **升级路径**——对一个已装旧版 quay 且**本地改过 tick 文档**的工作区跑 `quay-init`，
      本地改动**不被覆盖**，冲突被列出（`plugin/test/quay-init-loop.test.mjs` AC5 实测）
- [x] AC6: `plugin.json` 的 `commands` 与 `plugin/skills/` 磁盘内容**一致**（含 `quay-task-operator`），
      并有测试断言这个一致性（`plugin/test/plugin-packaging.test.mjs`）
- [x] AC7: **负控制——`npm pack --dry-run` 输出里不得出现** `tick-log.md`、`escalations.md`、
      `batch2-queue-state.md`、`orchestration/exp6-*`、`adr/ADR-021-*`（`plugin/test/loop-shipping.test.mjs`）
- [x] AC8: `test/cold-start-e2e.sh` 在**把 quay 开发树改名后**仍走通，退出码 0（实跑输出贴任务体，见执行记录）
- [x] AC9: README 有冷启动小节，命令序列条数少到能列在 README 里
- [x] AC10: **观察机制随包走**——`inner-state.sh` + Monitor 的挂载方式作为
      `quay-init --loop` 铺设内容的一部分，且 tick 文档里「怎么等」这一段
      **指向机制而非描述做法**（`plugin/scripts/inner-state.sh` 随 `--loop` 铺到目标项目的
      `plugin/scripts/`，外层 Monitor 重挂到该新路径）
- [x] AC11: **一个机械检查取代一条散文规则**——「管道后读 `$?`」做成可执行检查
      （`plugin/scripts/pipe-exit-code-check.sh`，带 `--self-check` 自证 + 测试）
- [x] AC12: 测试带 `// @test-group governance` 声明
- [x] AC13（协调方 2026-08-03 必办）: **搬完后仓库里没有指向老路径的活引用**（注释与历史记录除外）——
      6 个老路径全部删净，`scripts/test.sh` + 各测试/文档的引用改为 `plugin/loop/` + `plugin/scripts/`
      新路径；机械断言在 `plugin/test/loop-shipping.test.mjs`（AC1b）

## Definition of Done

- [x] AC8 的改名负控制实跑输出贴进任务体（见执行记录 AC8 节：改名后 resource-gate/heavy-op-token/
      inner-state/pipe-exit-code-check/telemetry 全跑通，COLD-START E2E PASS exit 0）
- [x] 明确记录：archguard 那次冷启动用的是 `cp` 加手工 `sed`，**是热拷贝，不构成可交付性证据**；
      它证明的是机制能在第二个项目上产出真活（那里 CI 连红一个月、测试超时、lint 480 errors），
      两件事不混
- [x] 完整套件连跑 2 次全绿——**协调方 fan-in 套件 2054 tests / 2035 pass / 0 fail / 0 cancelled /
      19 skipped**（exit 0，`/tmp/coldstart-fanin-fullsuite2.log`，2026-08-03；初跑红在
      loop-shipping AC1b 老路径扫描，协调方修队列文档旧引用 + task-contract-check 测试 fixture 排除
      名单后重跑绿）。参考值 2039→2054。**旧路径断点已消除**：test.sh 三调用点指向新路径、
      外层 Monitor 已重挂 plugin/scripts/inner-state.sh（首事件 INIT）、cron 已换 plugin/loop/ 文档

## Touches

- plugin/skills/init/SKILL.md
- plugin/.claude-plugin/plugin.json
- plugin/scripts/fast-mode-telemetry.ts
- plugin/loop/orchestrator-loop-tick.md
- plugin/loop/fast-mode-loop-tick.md
- plugin/scripts/inner-forensics.mjs
- plugin/scripts/inner-state.sh
- plugin/scripts/resource-gate.sh
- plugin/scripts/heavy-op-token.sh
- orchestration/orchestrator-loop-tick.md
- orchestration/watch/inner-forensics.mjs
- orchestration/watch/inner-state.sh
- docs/analysis/fast-mode-loop-tick.md
- scripts/resource-gate.sh
- scripts/heavy-op-token.sh
- experiments/quay-perpetual-stream/scripts/fast-mode-telemetry.ts
- test/cold-start-e2e.sh
- README.md
- scripts/test.sh
- plugin/test/heavy-op-token.test.mjs
- plugin/test/loop-shipping.test.mjs
- plugin/test/quay-init-loop.test.mjs
- plugin/test/pipe-exit-code-check.test.mjs
- plugin/test/plugin-packaging.test.mjs
- plugin/scripts/quay-init.sh
- plugin/scripts/pipe-exit-code-check.sh
- CLAUDE.md
- orchestration/QUAY-OUTER-HANDOFF.md
- orchestration/manager-loop-tick.md
- orchestration/throughput-decomposition.md
- orchestration/exp6-phase1-sustained-unattended-operation.md
- orchestration/exp6-phase2-productization-plan.md
- orchestration/escalations.md
- orchestration/meta-cc-issues.md
- docs/analysis/batch2-queue-state.md
- docs/analysis/suite-sigma-2026-08-03.md
- docs/analysis/test-isolation-contract.md
- docs/analysis/normative-prose-audit.md
- docs/proposals/quay-web-observation-surface.md
- plugin/scripts/inner-blocked-signal.ts

## 执行记录（2026-08-03，含协调方两条必办项的落地）

**范围裁定的落地**：`scripts/test.sh` 未搬（留在 `scripts/`），但协调方指出「test.sh 不搬≠不改」——
被调方 `resource-gate.sh`/`heavy-op-token.sh` 搬走后，test.sh 里 4 处 `${repo_root}/scripts/...`
引用必须同提交改为 `plugin/scripts/...`（失败形态：`if ! bash <不存在>` → 127 → 误进「资源闸 WAIT」
分支）。`scripts/test.sh` 与 `plugin/test/heavy-op-token.test.mjs` 已补进 `## Touches`。

**搬移决策**：6 个文件（两份 tick 文档 → `plugin/loop/`；4 个 `.sh`/`.mjs` → `plugin/scripts/`）。
协调方最终裁定**不留兼容壳**：6 个老路径全部删净（无符号链接转发），仓库里所有活引用（`scripts/test.sh`、
各测试、CLAUDE.md、orchestration/*、docs/analysis/*、docs/proposals/*）一律改指新路径。
`plugin/test/loop-shipping.test.mjs` 的 AC1b 机械断言「仓库里没有指向老路径的活引用」（tasks/、milestones/、
tick-log.md、以及描述目标项目布局的文件除外）。外层 Monitor 的新挂载路径：**`plugin/scripts/inner-state.sh`**。

**fast-mode-telemetry.ts 权威判定（AC2）**：`plugin/scripts/fast-mode-telemetry.ts` 是唯一物理副本；
`experiments/quay-perpetual-stream/scripts/fast-mode-telemetry.ts` 已是符号链接再导出（git 记录如此），
非第二份副本——选择「再导出」而非「删除」，保留本仓实验路径的既有引用。

**AC8 改名负控制实跑输出**（`bash test/cold-start-e2e.sh`，退出码 0）：

```
== asserting laid-down mechanism files ==
  all laid-down files present
== negative controls ==
  no quay dev-tree absolute path / quay-specific literal in the laid-down project
== AC8 rename control ==
renaming the quay dev tree: /tmp/tmp.CFRmun5VRQ/quay-dev -> /tmp/tmp.CFRmun5VRQ/quay-dev.renamed
  quay dev tree renamed away; the real dev tree at /tmp/quay-wt-coldstart is untouched
== running the laid-down mechanism after the rename ==
  resource-gate.sh runs after the rename
  heavy-op-token.sh --status runs (exit 0)
  inner-state.sh one-shot emits BLOCKED (exit 0)
  pipe-exit-code-check.sh --self-check runs (exit 0)
  fast-mode-telemetry.ts resolves and runs after the rename

COLD-START E2E PASS: laid-down mechanism present, no quay dev-tree absolute path, and it still runs after the quay dev tree is renamed.
```

**AC3 实跑输出**（`quay-init --loop --dry-run` 的 would-copy 计数，完整清单见
`plugin/test/quay-init-loop.test.mjs` AC3）：dry-run 逐项列出 13 个机制脚本 + 2 份 tick 文档的
`would-copy:` 行；真实 run 后 `loop: copied=20 skipped=0 conflicted=0`（13 机制脚本 + 5 个传递依赖
`gate-script-base.ts`/`workflow-event-schema.mjs`/`task-schema.ts`/`touches-parser.ts`/`wiring-coverage-check.ts`
+ 2 份 tick 文档，e2e 实测证明缺这些依赖 inner-state.sh 无法运行）。

**AC5 升级路径实跑输出**（`plugin/test/quay-init-loop.test.mjs` AC5）：首跑全量复制 → 二跑全跳过
（`skipped (identical)`）→ 本地手动改 outer tick doc 后三跑报 `CONFLICT` 且本地改动**逐字保留**
（`after === firstContent + '\n<!-- local customisation -->\n'`）。

**AC6 一致性测试**：`plugin/test/plugin-packaging.test.mjs`「10 bundled skills」测试断言
`plugin.json commands[]` 与磁盘 `plugin/skills/` 目录**完全相等**（含 `quay-task-operator`）。

**AC11 机械检查**：`plugin/scripts/pipe-exit-code-check.sh --self-check` 自证「坏模式抓到、好代码干净」；
对 `plugin/scripts/*.sh` 默认扫描干净（exit 0）。散文规则 `orchestration/watch/inner-state.sh` 等
失效表里的「管道后读 `$?`」已由检查器取代。

**新增测试**（均 `// @test-group governance`）：`plugin/test/quay-init-loop.test.mjs`（AC3/4/5）、
`plugin/test/pipe-exit-code-check.test.mjs`（AC11）、`plugin/test/loop-shipping.test.mjs`（AC1/2/7/13）。
受影响旧测试（resource-gate/heavy-op-token/inner-state/inner-forensics/task-contract-check 的路径常量）
已同步改新路径，85 项测试 84 过 1 跳过（既有 skip）。

## Cross-annotation (gap-release-excludes-plugin-bundle-agent-surface, 2026-08-06)

本任务把 6 个 plugin 外的机制文件搬进 `plugin/`（tick 文档 → `plugin/loop/`，脚本 → `plugin/scripts/`），
但 **`plugin/` 本身没进 `packages/quay/package.json` 的 `files`**——release tarball 仍不含 agent 面。
那是 AC16 判据 2「完整性」的剩余缺口，由 `tasks/gap-release-excludes-plugin-bundle-agent-surface.md`
补上：`files` 加 `plugin` + `package.sh` 包前快照，release 从 develop 打 v0.4.0 tag。本任务解决「机制
在 plugin 内」，它解决「plugin 随 release 走」。

## Dispatch review

reviewer: outer
at: 2026-08-03T10:05:00Z
changed: 人指出冷启动/升级应当是一个 skill；外层查出载体已存在（quay 已是 Claude Code plugin，`quay-init` 已有幂等+dry-run+冲突不覆盖），故改为**扩展 quay-init 而非新造 skill**——新造会立刻产生两套铺设逻辑。诊断在实测下改过两次（先「files 忘了列」、再「机制全在包外」），第三版才对得上文件系统，改动史留在任务体里。并加 AC6：`plugin.json` 的 commands 与磁盘 skill 目录不一致（`quay-task-operator` 未列）是人肉发现的，必须有测试断言，否则只修一次就会再漂

reviewer: outer
at: 2026-08-03T10:23:00Z
changed: **`## Touches` 原先只列 3 个文件，而 Chosen mechanism 第 1 条要搬 7 个 plugin 外的文件、
第 2 条要收敛 `fast-mode-telemetry.ts` 的双份、第 5 条要新建 e2e 脚本、AC9 要改 README。**
Touches 是并发派发的唯一资格判据（`checkTouchesPair`）——按原来的 3 个条目，这个任务会被判为与
「改 orchestration/ 或 scripts/ 的任务」正交并同批派发，而它实际会搬走那些文件。已按机制补齐到 18 条
（搬移类同时列源路径与目标路径：判据要的是「会碰哪些文件」，搬移碰两端）。条目一律写裸路径、
不加反引号与 `(new)` 后缀——`touches-orthogonality-check.parseTouches` 对
`` - `foo.ts` (new) `` 会解析出带残留反引号的错路径（[[gap-task-body-has-n-parsers-and-no-authority]]）。
第二条：**`scripts/test.sh` 搬不搬，任务体自相矛盾**——缺口二的表把它列为「机制文件」，
而 Chosen mechanism 只说「`.sh`/`.mjs` 进 `plugin/scripts/`」。它是本仓 CI 与 15 处文档的入口，
搬它是范围决定不是实现细节。**执行前先答这一条并写进任务体**；未答之前不列进 Touches。
第三条（核实，非改动）：AC6 的前提外层已独立复核为真——`plugin/.claude-plugin/plugin.json` 的
`commands` 列 **9** 项，`plugin/skills/` 磁盘 **10** 个目录，缺的正是 `quay-task-operator`。
（Touches 里**不含** `scripts/test.sh`：见上面第二条——它搬不搬未定，未定之前不写进
Touches，否则并发资格判据会按一个未定的前提放行。此说明放在这里而不是 `## Touches` 之后，
是因为 `task-schema-check.ts` 的 `touches-post-content` 判据禁止 Touches 段后出现非 bullet 内容——
外层第一版写在那里，被该检查器当场抓到。）

reviewer: outer
at: 2026-08-03T10:4xZ
changed: **执行期间协调方两条必办项，均已落地**：(1) `scripts/test.sh` 与
`plugin/test/heavy-op-token.test.mjs` 补进 `## Touches`，并在同一提交里把 test.sh 的
`${repo_root}/scripts/resource-gate.sh` / `${repo_root}/scripts/heavy-op-token.sh`（acquire + release
trap）改为 `plugin/scripts/...` 新路径；(2) 6 个老路径**不留兼容壳**——全部删净，仓库所有活引用
（test.sh、5 个测试文件、CLAUDE.md、orchestration/*、docs/analysis/*、docs/proposals/*、
plugin/scripts/inner-blocked-signal.ts 注释）改指新路径，新增 AC13「无老路径活引用」并由
`plugin/test/loop-shipping.test.mjs` AC1b 机械断言。外层 Monitor 新挂载路径：`plugin/scripts/inner-state.sh`
（外层 fan-in 落地后按此重挂）。
