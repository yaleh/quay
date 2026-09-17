---
id: gap-readme-drivers-cold-start-dev-loop-drift
title: README 的「启动 drivers/serve」「冷启动」「实际开发」三节与真实运维机制/仍在分发的 skill 不一致
status: ready
labels:
  - gap
parent: null
children: []
extra:
  schema: finding
---
**type:** execution

## Finding

复核会话历史里"实际怎样启动服务/drivers、怎样冷启动、怎样实际驱动开发"这条真实运维路径后，对照 README.md 现有文字，发现三处具体、可核实的缺口（另有 `gap-readme-option-a-npm-release-artifact-retired` 已单独覆盖"安装渠道优先级"这个不同问题，两者不重叠）。**本任务只描述机制本身，不引用任何具体第三方部署环境的主机名/项目名**——那些只是观察样本，不是文档该记录的内容。

### 缺口1：「启动 drivers + web server」一节只给了"一键调用"这一层，没给它包装的是什么

README `:412-413`（Enablement flow 步骤④）：

> `# 4. in that session, start the drivers + web server (one idempotent call):`
> `/quay:drivers`

`quay:drivers` skill 自身的定位（skill 清单原话）是"Start the promotion + worker drivers and the web server in ONE idempotent in-session call — wraps `quay driver start --kind promotion|worker` + `quay serve` via `plugin/scripts/start-drivers.ts`"。但 README 的「Driver processes」一节（`:562-588`）只列出了 `quay driver <verb> --kind <kind>` 这一个统一入口的 verb 语义表，完全没有说明：
- 一次正常运行的部署实际是 **promotion driver + worker driver 两个独立常驻进程**（各自可单独 start/stop/drain/resume/restart），不是"driver"这个抽象名词的单个实例；
- `quay serve` 是**独立的第三个进程**，生命周期与 driver 进程彼此独立（重启一个不必重启另一个）；
- `/quay:drivers` 包装的等价手工分步命令是什么——README 目前没给出，读者若在不支持 slash skill 的宿主环境下（裸 CLI/非 Claude Code 宿主）想手工达到同样效果，无处可查。

### 缺口2：「冷启动 skill 已退役」这句话与仍在分发的 `plugin/skills/cold-start/SKILL.md` 矛盾

README `:424-426`（紧接步骤④之后）原文：

> "The retired `outer`/`inner` two-session tmux model ... was **deleted, not migrated** ... The cold-start skill that re-created the "outer cron + drive inner" model is likewise retired; the drivers + manager skills above are its successors."

实测：`plugin/skills/cold-start/SKILL.md` **文件当前存在**，且是本仓库随插件分发、在会话技能清单里实际可调用的 skill（自述：「re-create the 20-minute outer cron, EXPLICITLY drive the inner session to start fast mode and dispatch the first task, then PROVE the loop is live by reading a real --task-start telemetry record in `.workflow-events/`」）。README 把它写成"已退役（likewise retired）"，与代码/skill 清单的现状不符——这是本仓库反复强调的"文档 vs 代码漂移"的又一具体实例，且发生在很容易被下一个采用者当真的一句话上。

此外，README 现有四步（install→init→drivers→manager）完全没有区分**"证明冷启动活性"**（一次性动作：装好之后读一条 `--task-start` telemetry 记录，确认循环真的在跑，而不是进程存在但事件送不到任何人——这条区分本身也是 `gap-cold-start-needs-a-human-to-dictate-eight-steps` 这条已 done 任务里明确落地过的判据）与**"持续派发"**（loop 靠 **cron** 周期性触发重新评估/派发任务，不是靠人反复手动触发）这两件不同的事——读者读完不知道装完之后任务是怎么开始被派发的。

### 缺口3：「Task lifecycle」一节只给了状态机命令形状，没有描述真实的自动化开发闭环

README `:656-696`「Task lifecycle: `todo` → `ready` → `done`」一节自己声明"not a transcript of this repo's own board"——只展示 `promote`/`complete`/`retreat`/`gate` 四个 CLI 动作的抽象命令形状。完全没有说明一个任务从 `ready` 被派发到真正"落地"之间，worker driver 实际做了什么：
- 每个被派发的任务在**独立 git worktree** 里隔离执行（implement → self-audit → gate），不是在主检出上直接改；
- 任务状态可能不是一条直线：`ready` 之后可能卡在 **`needs-human`**（需要人工介入的终态），再由人工或后续机制 `retreat` 回 `todo` 重来；
- 状态翻到 `done` 和"代码已经真正落地"是两件不同的事——真正落地还要经过 **fan-in**（合并回 `develop`、跑 scoped/全量测试、快进合并）这一步，README 目前完全没提 fan-in 环节。

## Acceptance Criteria

- [ ] AC1: README「Driver processes」一节（或紧邻处）补充说明：一次部署包含 promotion driver + worker driver 两个独立常驻进程 + 独立的 `quay serve` 进程，并给出 `/quay:drivers` 包装的等价手工分步命令。取假判据：`grep -c 'kind promotion' README.md` 与 `grep -c 'kind worker' README.md` 改后均较改前增加（贴改前/改后计数对照）。
- [ ] AC2: 删除或改写 README `:424-426` "The cold-start skill ... is likewise retired" 这句话，使其与 `plugin/skills/cold-start/SKILL.md` 当前仍存在且被分发的事实一致。取假判据：`test -f plugin/skills/cold-start/SKILL.md && ! grep -qi 'cold-start skill.*retired' README.md`（改后 exit 0；改前 exit 1，贴对照）。
- [ ] AC3: README 补一段区分"证明冷启动活性"（一次性，读 `--task-start` telemetry 记录）与"持续派发"（cron 周期触发）。取假判据：改后 `grep -c 'cron' README.md` 与 `grep -c 'telemetry' README.md` 均较改前增加。
- [ ] AC4:「Task lifecycle」一节补一段说明真实自动化开发闭环：worktree 隔离执行、`needs-human`/`retreat` 可能反复迁移、以及 fan-in（合并回 develop + 测试 + 快进）是"done 状态"之外必经的落地步骤。取假判据：改后在该小节附近 `grep -c 'fan-in'` 与 `grep -c 'worktree'` 均较改前增加。
- [ ] AC5: 改动前后分别贴出这三处 README 原文与改后文本的 diff，以及支撑证据（`plugin/skills/cold-start/SKILL.md`、`plugin/skills/drivers/SKILL.md` 现有内容核对）；**不得在改动文字里引入任何具体第三方主机名/项目名**（负控制：`grep -iE 'tokyo-alpha|ad-arm1' README.md` 必须为 0 命中）。

## Definition of Done

- [ ] AC1-AC5 全部满足，且 AC5 的 diff/证据已贴入任务体；README.md 三处更新落地后，本任务体身列出的每条取假判据命令都已实跑并贴出改前/改后输出对照，不是描述性断言。

## Touches

- README.md
- tasks/gap-readme-drivers-cold-start-dev-loop-drift.md（自身）