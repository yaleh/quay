---
id: gap-loop-mechanism-lives-outside-the-package-and-cannot-ship
title: Make cold-start (and upgrade-from-old-quay) a skill — quay-init installs
  the wrong assets and 7 loop files live outside the plugin
status: todo
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
   `.sh`/`.mjs` 进 `plugin/scripts/`），并解决 `fast-mode-telemetry.ts` 在
   `plugin/scripts/` 与 `experiments/` 各有一份的问题——**先判权威再删，不要两份都打包**。
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

- [ ] AC1: 7 个 plugin 外的机制文件全部搬入 `plugin/`，每个有归属理由；「以防万一」不是理由
- [ ] AC2: `fast-mode-telemetry.ts` 的双份收敛为一份，写明哪份权威，另一份删除或改为再导出
- [ ] AC3: `quay-init --loop` 铺出双层机制全套，`--dry-run` 逐项列出（实跑输出贴任务体）
- [ ] AC4: tick 文档的占位符替换**机械化**——目标项目的测试命令/会话名/项目名可参数化，
      不需要手工 `sed`（负控制：铺完后 grep 不到 `scripts/test.sh` 这类 quay 专属字面）
- [ ] AC5: **升级路径**——对一个已装旧版 quay 且**本地改过 tick 文档**的工作区跑 `quay-init`，
      本地改动**不被覆盖**，冲突被列出（实跑输出贴任务体）
- [ ] AC6: `plugin.json` 的 `commands` 与 `plugin/skills/` 磁盘内容**一致**，
      并有测试断言这个一致性（这次是人肉发现的，不能只修一次）
- [ ] AC7: **负控制——`npm pack --dry-run` 输出里不得出现** `tick-log.md`、`escalations.md`、
      `batch2-queue-state.md`、`orchestration/exp6-*`、`adr/ADR-021-*`
- [ ] AC8: `test/cold-start-e2e.sh` 在**把 quay 开发树改名后**仍走通，退出码 0，实跑输出贴任务体
- [ ] AC9: README 有冷启动小节，命令序列条数少到能列在 README 里
- [ ] AC10: 测试带 `// @test-group governance` 声明

## Definition of Done

- [ ] AC8 的改名负控制实跑输出贴进任务体——**没有这一条，本任务等于没做**
- [ ] 明确记录：archguard 那次冷启动用的是 `cp` 加手工 `sed`，**是热拷贝，不构成可交付性证据**；
      它证明的是机制能在第二个项目上产出真活（那里 CI 连红一个月、测试超时、lint 480 errors），
      两件事不混
- [ ] 完整套件连跑 2 次全绿

## Touches

- plugin/skills/init/SKILL.md
- plugin/.claude-plugin/plugin.json
- test/cold-start-e2e.sh

## Dispatch review

reviewer: outer
at: 2026-08-03T10:05:00Z
changed: 人指出冷启动/升级应当是一个 skill；外层查出载体已存在（quay 已是 Claude Code plugin，`quay-init` 已有幂等+dry-run+冲突不覆盖），故改为**扩展 quay-init 而非新造 skill**——新造会立刻产生两套铺设逻辑。诊断在实测下改过两次（先「files 忘了列」、再「机制全在包外」），第三版才对得上文件系统，改动史留在任务体里。并加 AC6：`plugin.json` 的 commands 与磁盘 skill 目录不一致（`quay-task-operator` 未列）是人肉发现的，必须有测试断言，否则只修一次就会再漂
