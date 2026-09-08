---
id: gap-meta-driver-has-no-visible-carrier-or-tools-unlike-task-goal-adr
title: meta-driver 的产出没有对外可见的载体与操作面——task/adr/goal 都是 git 跟踪的逐对象文件 + CLI（task 另有
  MCP+subagent），而 meta 只有一个 gitignored 的 jsonl、零 CLI、零 MCP；连它自己的回执别人也看不到
status: superseded
labels:
  - gap
  - meta-driver
parent: null
children: []
extra:
  schema: execution
  acceptance: node --experimental-strip-types --test plugin/test/meta-driver.test.mjs
---
## Finding

**人 2026-09-07 裁定：meta-driver 需要与 goal/task 对应的载体和工具，且它们应对本项目更广泛的会话可见。**

### 一、现状对照（实测，非印象）

| 对象 | 载体 | git 跟踪 | CLI | MCP | subagent / skill |
|---|---|---|---|---|---|
| **task** | `tasks/*.md` | ✓ **1801** 个文件 | `quay task list/view/create/edit/check` + `promote/retreat/complete/adjudicate/gate/gate-log/action/run` | `task_list` `task_get` `task_write` `task_check` `task_delete` `lifecycle_*` `gate_*` `action_*` | `quay:quay-task` subagent + `quay-file-task` / `quay-directive` / `author` 等 skill |
| **adr** | `adr/*.md` | ✓ **35** | `quay adr list/view/new/accept/deprecate/reject/supersede` | `adr_get` `adr_list` `adr_write` | — |
| **goal** | `goals/*.md` | ✓ **48** | `quay goal list/show/write` + `goal-store.ts gate/check` | **无** | — |
| **meta-driver** | `.quay/meta-driver-round.jsonl` | **✗ 未跟踪** | **无** | **无** | **无** |

`.quay/` 下确有 74 个受跟踪文件，但全是 fixture / prepare-epochs；三个 round 载体（`meta-driver-round.jsonl` / `goal-round.jsonl` / `meta-control.json`）**逐个核过，`git ls-files` 均为 0**。仓库中也不存在 `findings/` `observations/` 之类目录。

### 二、代价（本会话内实际发生，非设想）

- **要读它必须手搓解析**：本会话被问「meta-driver 发现了什么」多次，每次都得对一个 gitignored 的 jsonl 写 node 单行去拆 `facts[0].value`。这既违反硬规则①（用机件不手搓），也让任何**没有本机文件访问**的会话根本无从查起。
- **它的分析对 git 历史不可见**：迄今 61 个有内容轮次、99 条 interpretations、762 条偏离报告，`git log` 里一个字都没有。换机器 / 清 `.quay` 即全部归零。
- **回执看不到（最要紧的一条）**：`addressedTaskOpinions`（2026-09-07 03:46 落地）是「立一条 `label:meta-driver` 任务把要求发给它」这条通道的**唯一回执**，而它写进的正是这个不可见载体 ⇒ **发件人看不到答复**。入口是 git 可见的 task，出口却是本机 jsonl，两端不对称。
- **goal 也缺 MCP**（只是没有 meta 那么严重）：`quay goal` 有 CLI 无 MCP，故任何只有 MCP 面的会话/subagent 读不到 goal。本条主修 meta，goal 的 MCP 缺口一并记录，由执行者判断是否顺带补齐（⛔ 不得因此扩大到重写 goal 层）。

### 三、⚠️ 已有正确设计不要推翻

meta-driver 的**可落地产出已经有 git 可见载体**，⛔ 不要为它们再造一份：

| 输出通道 | 现有载体 | 状态 |
|---|---|---|
| `proposals` | `goals/AC-*.md` | ✓ 已跟踪 |
| `autoDrive` | `tasks/*.md` | ✓ 已跟踪 |
| `decisions` | draft GOAL / needs-human task | ✓ 已跟踪 |
| `divergences` / `interpretations` / `addressedTaskOpinions` | **仅 `.quay/meta-driver-round.jsonl`** | ✗ 不可见 |

⇒ **缺口精确地是「它的判断与回执」这一类**，不是它的全部产出。

**⚠️ 两条必须避开的坑（都在本仓库付过代价）**：
1. **SPEC §6.3 警告的「第五个登记面」**：probe 规格自己记着 `addressedTasks` 入口刻意**不新建收件箱**（escalations.md 的死法：12 条未答、死 10 天）。新载体若变成又一个没人读的面，就是重蹈覆辙。
2. **提交洪水**：`goal-round.jsonl` 之所以不进 git 是有道理的——2026-09-07 实测，单条 AC 的 verdict 每 6.5 分钟翻一次就产生 21 次/90 分钟的提交，占 develop 66%，直接打断全部 fan-in。⛔ **不得把一个每轮追加的 jsonl 直接纳入版本控制**。

### 四、方向倾向（供执行者判断，非强制）

要同时满足「git 可见 / 可 diff / 跨会话可查」与「不制造提交洪水」，可行形态至少三种，**执行者须选一种并写明为何另两种不合适**：

- **甲（逐对象文件，仿 goal/adr）**：把「判断」升格为一等对象——每个**机制级发现**一个 `.md`（就地更新而非追加），与 `goals/AC-*.md` 同构。变更频率由「发现是否变了」决定，而非由轮次决定 ⇒ 天然避开洪水。配 `quay meta list/show/write` CLI + MCP。
- **乙（读工具，不改载体）**：保留 jsonl 为本机遥测，只加 `quay meta ...` 读动词 + MCP，把「手搓解析」变成机件。**代价：仍不进 git ⇒ 跨机不可见**，只解决了「不手搓」一半，**不满足人的「更广泛会话可见」要求** ⇒ 单用它不达标。
- **丙（甲+乙组合）**：判断进逐对象文件（git 可见），原始轮记录留 jsonl（本机遥测），读工具两者都能查。

⛔ **不接受**：①把 `meta-driver-round.jsonl` 直接 `git add`（洪水，第三节坑 2）；②新建一个只写不读的目录（第三节坑 1）；③为已有载体的三条输出通道（proposals/autoDrive/decisions）再造一份平行存储。

## AC

- [ ] 载体 git 可见：meta-driver 的**判断类产出**（至少 `divergences` 的解读与 `addressedTaskOpinions`）落在受版本控制的路径下，`git ls-files <该路径> | wc -l` 非零；⛔ 打印该计数，不是断言。
- [ ] **不产生提交洪水（能取假）**：在**判断内容未变**的连续 ≥5 轮里，该载体产生的提交数为 **0**；构造一次判断内容变化 ⇒ 恰产生 1 次提交。两个方向都断言（这条直接对着 2026-09-07 的洪水事故）。
- [ ] 有机件可读，⛔ 不再手搓：存在一条命令能列出/查看 meta-driver 的判断（例如 `quay meta list` / `quay meta show <id>`），退出码与 JSON 输出可被脚本消费；判据须**实跑该命令**，⛔ 不接受「文件在那里，自己 cat」。
- [ ] **MCP 面可用**：上述读能力经 MCP 暴露（与 `task_*` / `adr_*` 同级），使**没有本机文件访问**的会话也能查；判据须由一次真实 MCP 调用证明，⛔ 不是看源码里有注册代码。
- [ ] 回执可被发件人看到（端到端，本条是本任务的核心用例）：立一条 `label:meta-driver` 的任务 → 下一轮 meta-driver 判读 → **不读 `.quay/` 任何文件**、只用上述工具，能查到该任务对应的三态判定与 note。
- [ ] ⛔ 未给 proposals / autoDrive / decisions 造平行存储：断言这三类仍然只落在 `goals/` 与 `tasks/`（同一发现不得同时存在于两处）。

## DoD

- [ ] 上述判据本轮实跑并贴出输出（⛔ 不是转述），洪水那条两个方向都实跑确认能取假。
- [ ] **生产载体证据（非 fixture）**：在真实工作区跑一轮真实 meta-driver 判读后，用新工具查到它这一轮的判断；⛔ 不得以单测通过冒充（硬规则④推论三）。
- [ ] 三种形态（甲/乙/丙）选了哪一种、为何另两种不合适，写进任务体；⛔ 不接受不作说明直接实现。
- [ ] `goal` 缺 MCP 这一点给出结论：顺带补齐 / 另立任务 / 判定不必——三者任选其一但**必须写明**，⛔ 静默跳过不可接受。
- [ ] ⛔ 未把每轮追加的 jsonl 纳入版本控制；⛔ 未新建只写不读的登记面（SPEC §6.3）；⛔ 未新增 driver kind（SPEC §5.1）。
- [ ] 新增的 CLI/MCP 动词登记进 `plugin/scripts/capability-catalog.sh`（它自称唯一清单），并说明与 `quay driver` 未进 CLI help 那个已知表层缺口是否同源。

## Touches

- `packages/quay/bin/quay.ts`
- `packages/quay/src/mcp-server.ts`
- `plugin/scripts/meta-driver.ts`
- `plugin/probes/meta-driver.md`
- `plugin/scripts/capability-catalog.sh`
- `plugin/test/meta-driver.test.mjs`
- `docs/analysis/quay-init-closure-ratchet.baseline.json`
- `tasks/gap-meta-driver-has-no-visible-carrier-or-tools-unlike-task-goal-adr.md`
