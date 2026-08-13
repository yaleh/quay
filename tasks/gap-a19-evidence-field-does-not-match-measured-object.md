---
id: gap-a19-evidence-field-does-not-match-measured-object
title: A19 取证字段与被测对象不对应（runner 恒 outer 140/140 零反例）——重写：执行形态=launch tool_use 的
  transcript 文件类别（主会话/agent/workflow 互斥），invariant 换可取假者（manager 2026-08-13 规格）
status: ready
labels:
  - gap
  - defect
  - mechanism
parent: null
children: []
extra:
  schema: execution
---
**type:** execution

## Proposal

**A19 的取证字段与被测对象不对应——它从来就不是测量（manager 2026-08-13 裁定，与今日已修三处同族：AC42 判据1/2、AC50 判据5、AC53 闸读自述字段）。**

**直接证据（140 轮零反例）**：`full-suite-runner.ts:238` 把 `runner` 类型声明为 `"outer" | "inner"`；140 轮记录里 runner 取值分布 = `{'outer': 140}`（单一取值，从无例外）⇒ `consecutive_outer_rounds` **结构上永不归零** ⇒ A19 的 signal 只单调增，测的是「轮数」不是「回落」。**按硬规则 4：一个结构上不可能取假的量不是测量。**

**为什么不是「新模型取代」**：`full-suite-runner` 写 `runner` 字段时只知道自己被谁调用的**名义角色**（`:21-22` 硬编码 `"outer" as const`，无 `--runner` 旗标，workflow 治理的轮次也记 outer），**不知道调用者是主会话回合、workflow、还是 subagent**——它测不了「套件跑在哪」。140 轮零反例在旧模型下也成立 ⇒ A19 在旧模型下也从未有效过。

**invariant 是恒真恒等式**：`runner_field_tracked = 1`（"verification-round.jsonl 已记 runner 字段"）——「字段被记录了」永远为真，**不检验该字段是否有意义**（硬规则 4）。重写时 invariant 换能取假的那种：「三类形态在近 N 轮里至少出现过两类」。

**要防的坏事仍然真实**：套件在主会话回合里直跑（占回合、无隔离、崩溃不自愈）。

## 重写规格（manager 2026-08-13，已核实现）

**要测的对象**：这一轮套件是被**什么形态**发起的（主会话回合 / subagent / workflow）。

**取证必须由 harness 产生，不能由被测者自报**（硬规则 4b）。现成的满足这条的量只有一个——**launch 的 tool_use 落在哪一类 transcript 文件里**：
```
主会话     <project>/<session>.jsonl
subagent   <project>/<session>/subagents/agent-*.jsonl
workflow   <project>/<session>/subagents/workflows/<run>/agent-*.jsonl
```
三类已在盘上枚举且路径互斥：主会话 jsonl 26 / agent-*.jsonl 196 / 其中 workflows 下 102。

**判据**：取含 `full-suite-runner.ts` 的 Bash tool_use，其时间戳落在 `[round.startedAt ± ε]` ⇒ **它所在文件的类别就是执行形态**。三类互斥且都有实据 ⇒ 可取三个值中任一个（能取假）。`runner` 是「层身份」枚举，结构上装不下「执行形态」。

**负控制不必构造（manager 边界：不生成新实验数据）**——历史已有：**OOM 后 5 轮 runner=outer 零 Workflow、主会话直跑**。回放那几轮：必须报 main-session（OOM 5 轮）；必须【不】报 main-session（由 suite-fix workflow 发起的轮）。两侧都用既有记录。

## 对 workflow 停调记录的更正（manager 2026-08-13）

「runner 恒 outer ⇒ 不驱动切回 workflow」**理由用错了方向**：零信息判据在**两个方向都不是证据**——既不能说"该用 workflow"，也不能说"不该用"。

**动作（不据 A19 驱动）仍然成立，但只因为它驱动不了任何东西，不是因为 workflow 该停。**
**workflow 的真实状态（按此记，不从裁定推）**：
- 没调 workflow 的实际原因是 manager 会话的系统级约束「Do not use workflows unless the user requested it」——**外部给的，不是判断**；
- **代价已被测量**（CLAUDE.md:18）：停调 workflow 19 小时 ⇒ 判准/收尾/发消息 466 行全部缺席 ⇒ **8 条违规**。所以「不用」不是中性默认值；
- ⇒ **暂时，非持久；解除权在人。**

## Plan

1. 重写 `suite-execution-form-counter.ts`：弃 `runner` 字段为信号（降为展示/标注「非执行面取证」），改读 launch tool_use 的 transcript 文件类别（主会话/agent/workflow 三类，按 `[round.startedAt ± ε]` 时间窗匹配含 `full-suite-runner.ts` 的 Bash tool_use）。
2. invariant 换能取假者：「近 N 轮三类形态出现过 ≥2 类」（不是 `runner_field_tracked=1` 的恒真恒等式）。
3. 负控制回放：OOM 后 5 轮（必报 main-session）+ suite-fix workflow 发起的轮（必不报 main-session）——既有记录，不造数据。
4. 测试：构造三类 transcript 的 fixture ⇒ 各报对应形态；时间窗错开 ⇒ 不误报。

## AC

- [ ] AC1: 执行形态取证 = launch tool_use 的 transcript 文件类别（主会话/agent/workflow 互斥三类，`[startedAt ± ε]` 窗匹配含 full-suite-runner.ts 的 Bash tool_use）——不再以 runner 字段为信号
- [ ] AC2: invariant 能取假——「近 N 轮三类形态出现 ≥2 类」（替换恒真的 `runner_field_tracked=1`）
- [ ] AC3: 负控制回放：OOM 后 5 轮 ⇒ 报 main-session；suite-fix workflow 发起轮 ⇒ 不报 main-session（既有记录，不造数据）
- [ ] AC4: `full-suite-runner.ts` 的 `runner` 字段标注「非执行面取证」或降为展示
- [ ] AC5: 既有测试全绿；`--for-task` scoped 门绿

## Definition of Done

- [ ] AC1–AC5 全部勾上
- [ ] 三类 transcript 的实测读数贴出（主会话 26 / agent 196 / workflows 102）+ OOM 5 轮回放正负两侧各一条
- [ ] 全量套件绿

## Touches

- plugin/scripts/suite-execution-form-counter.ts（取证重写：transcript 文件类别）
- plugin/scripts/full-suite-runner.ts（runner 字段标注/降级）
- orchestration/orchestrator-tick-core.md（A19 判据改新取证）
- tasks/gap-a19-evidence-field-does-not-match-measured-object.md（自身）