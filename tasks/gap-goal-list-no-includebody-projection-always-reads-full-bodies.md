---
id: gap-goal-list-no-includebody-projection-always-reads-full-bodies
title: goal list 在 --json 和非 --json 下同样慢（~1.3s/234 条）——goal ABI 从没有 includeBody
  投影，不是 task list 那种耦合 bug
status: ready
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
---
## Finding
**背景**：另一会话在复核 `gap-cli-task-list-json-body-coupled-to-json-flag` 时提示"`goal list --json` 在他们那边是第二大
单项（1.3s/1.1MB），接受 task 的 flag 修复后新上界会落到这条"，问要不要查同因、要不要立——本任务是查证结果。

**实测（本仓库真实 store，234 个 goal）**：
```
time (.quay/plugin/bin/quay goal list        | wc -c)   # 1.305s / 31642 字节
time (.quay/plugin/bin/quay goal list --json | wc -c)   # 1.275s / 1113148 字节
```
**两种模式耗时几乎相同**——这和 `gap-cli-task-list-json-body-coupled-to-json-flag` 的情形**不是同一种根因**：task 那条
是"省读路径已经存在且快、只是 `--json` 模式没开关用它"；goal 这条是**两种模式都慢**，说明 goal 的省读路径根本不存在。

**代码确认**：`packages/quay/src/cli/goal.ts` 的 `list` 分支（约 258-267 行）：
```
const goals = await client.goalList(filter);
if (wantsJson) printJson(goals); else ...
```
`client.goalList(filter)` 调用**不带任何 `includeBody`/分页参数**——`filter` 只有 `status`/`kind`/`goal`，无论
`wantsJson` 真假都是同一次全量调用。对照 `task list` 的 Provider ABI（`packages/quay-native/src/store.ts` 的
`includeBody:false` 两阶段省读）：goal 的 Provider ABI 侧目前**没有对应的 includeBody 概念**（未在本任务内逐行核实
quay-native 的 goal store 实现，留给实现时查证——这正是本任务判定为 `finding` 而非直接给修法的原因：task 那条的修法
是"接一个已经验证可行的现成省读路径"，风险小；goal 这条如果真的从 ABI 到 Provider 都没有省读概念，修法需要新增这条
能力，范围和风险都不是简单的 CLI flag 接线，值得先立案查清楚再决定怎么改，不预先假定修法）。

**不下结论的部分（留给后续）**：1.3s 对 234 个 goal（task list 的 2589 个任务读全量 body 要 3.4s，goal 按比例应该更快，
实际慢于比例预期）——是 goal body 平均更大、是别的慢路径（例如逐条额外的 I/O，如 staleness 计算 `goalStalenessMark`
是否有逐条额外开销）、还是别的原因，本任务未查证，留给实现时先做 profile 再动手（同一会话之前查 task list 时用了
`node --cpu-prof`，这里应该先照做一次，不要直接假定"body 更大"就是唯一原因）。

## Touches
- `packages/quay/src/cli/goal.ts`
- `packages/quay-native/src/store.ts`
- `tasks/gap-goal-list-no-includebody-projection-always-reads-full-bodies.md`

## AC
- [ ] 用 `node --cpu-prof` 或同等手段对 `goal list --json`（真实 store）做一次性能剖析，贴出耗时最高的几个函数/调用点，确认瓶颈具体在哪一层（Provider 调用本身 / frontmatter 解析 / body 解析 / `goalStalenessMark` 之类的逐条附加计算 / 其它），不要假设。
- [ ] 核实 quay-native 的 goal store（Provider 实现）是否已有 `includeBody` 或等价的轻量投影能力但未被 `client.goalList` 使用，还是确实从 ABI 到 Provider 都不存在——把结论（存在but未接 / 完全不存在）写进完成记录，附具体文件/行号证据。
- [ ] 基于上一条 AC 的结论，判定本 gap 是否值得立一个后续实现任务（不在本任务内实现修复）；若判定"值得"，在完成记录里写出后续任务该做什么（不要在本任务内动代码）。
- [ ] `bash scripts/test.sh --for-task gap-goal-list-no-includebody-projection-always-reads-full-bodies` 退出 0（本任务只读查证+记录，不改产品代码，预期不需要新测试文件，但仍需确认这条命令本身不因为任务文件改动而红）。

该轴仍暗，理由：本任务是只读性能剖析与根因查证，不改动产品代码，不新增模块或包间依赖，L_D/L_G（依赖结构/重复抽象）轴
对纯诊断性任务不提供信号。

## DoD
真实落地：完成记录里有一次真实 `--cpu-prof`（或等效工具）剖析输出的具体读数（函数名+耗时占比，不是"应该是 xxx"的
推断），以及"goal 的省读能力存在但未接 / 完全不存在"这一判定的具体文件/行号证据；是否值得立后续实现任务的判断连同
理由写清楚。
