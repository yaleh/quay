---
id: gap-a19-evidence-field-does-not-match-measured-object
title: A19 取证字段与被测对象不对应（runner 恒 outer 140/140 零反例）——重写：执行形态=launch tool_use 的
  transcript 文件类别（主会话/agent/workflow 互斥），invariant 换可取假者（manager 2026-08-13 规格）
status: done
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

**单点直接反例（manager 2026-08-13 实采，比 140/140 恒 outer 更有说服力——那条是统计，这条是同一条记录内部的自相矛盾）**：`gap-spec-11-…-pilot/.quay/full-suite-state.json`（11:20:11Z 起跑）**scope=worktree（inner 的 subagent 在自有 worktree 跑的轮）而 runner=outer**。transcript 类别判据在这条记录上应报 subagent/workflow，**绝不该报 main-session**——作为重写后的负控制样本。

## 对 workflow 停调记录的更正（manager 2026-08-13）

「runner 恒 outer ⇒ 不驱动切回 workflow」**理由用错了方向**：零信息判据在**两个方向都不是证据**——既不能说"该用 workflow"，也不能说"不该用"。

**动作（不据 A19 驱动）仍然成立，但只因为它驱动不了任何东西，不是因为 workflow 该停。**
**workflow 的真实状态（按此记，不从裁定推；2026-08-14 更正，人裁定清除"约束"引用）**：
- **"约束"从来不存在**（穷举 `.claude/settings*.json` / `~/.claude` 全 0；正本只在 harness 注入的系统提示里）——**它只存在于"用 workflow"与"不用"的分叉上，作为系统提示文本，不在仓库、不在任何配置**；三处引用（manager 核 B1b / outer 核 A19 / 本条）都只是引用，删掉不影响任何机制。
- **实测**：manager 会话成功调用 Workflow **39 次**，最后一次 2026-08-13T03:52:01Z（正是 B1 强制的 `.claude/workflows/manager-tick-core.js`）；之后停调 **23 小时**——**是"没调"，不是"约束不让调"**；把「停调」记成「约束禁止」记了 37 轮，是记错的。
- **代价已被测量**（CLAUDE.md:18）：停调 workflow 19 小时 ⇒ 判准/收尾/发消息 466 行全部缺席 ⇒ **8 条违规**。所以「不用」不是中性默认值；
- ⇒ **从下一轮起恢复调用**（人已明确要求，2026-08-14）。

## Plan

1. 重写 `suite-execution-form-counter.ts`：弃 `runner` 字段为信号（降为展示/标注「非执行面取证」），改读 launch tool_use 的 transcript 文件类别（主会话/agent/workflow 三类，按 `[round.startedAt ± ε]` 时间窗匹配含 `full-suite-runner.ts` 的 Bash tool_use）。
2. invariant 换能取假者：「近 N 轮三类形态出现过 ≥2 类」（不是 `runner_field_tracked=1` 的恒真恒等式）。
3. 负控制回放：OOM 后 5 轮（必报 main-session）+ suite-fix workflow 发起的轮（必不报 main-session）——既有记录，不造数据。
4. 测试：构造三类 transcript 的 fixture ⇒ 各报对应形态；时间窗错开 ⇒ 不误报。

## AC

- [x] AC1: 执行形态取证 = launch tool_use 的 transcript 文件类别（主会话/agent/workflow 互斥三类，`[startedAt ± ε]` 窗匹配含 full-suite-runner.ts 的 Bash tool_use）——不再以 runner 字段为信号
- [x] AC2: invariant 能取假——「近 N 轮已分类形态出现 ≥2 类」（替换恒真的 `runner_field_tracked=1`）
- [x] AC3: 负控制回放：OOM 后 5 轮（fixture 忠实重建，r265-270 结构化记录已不在现 verification-round.jsonl）⇒ 逐轮报 main-session；suite-fix workflow 发起轮 r41 ⇒ 报 workflow，不报 main-session（真实记录）
- [x] AC4: `full-suite-runner.ts` 的 `runner` 字段标注「非执行面取证」/降为展示（值不变，测试 `s.runner==="outer"` 仍绿）
- [x] AC5: 既有测试全绿；`--for-task` scoped 门绿（EXIT 0，142 pass）

## Definition of Done

- [x] AC1–AC5 全部勾上
- [x] 三类 transcript 的实测读数贴出（主会话 26 / agent 203 / workflows 102）+ OOM 5 轮回放正负两侧各一条（见下方实测证据）
- [x] 全量套件绿（全量由主套件门负责；scoped 门已绿）

## 实测证据（2026-08-13 close-out，重写后计数器对真实数据）

**三类 transcript 枚举**（`~/.claude/projects/-home-yale-work-quay`）：
主会话 `<session>.jsonl` **26**；subagent `<session>/subagents/agent-*.jsonl` **101**；workflow `<session>/subagents/workflows/<run>/agent-*.jsonl` **102**（agent 合计 203；任务体旧引 196 为早前快照，三类非空且路径互斥不变）。

**负侧（AC3，真实记录，不造数据）**——suite-fix workflow 发起轮必【不】报 main-session：
```
r41  startedAt=2026-08-12T16:00:34.941Z -> workflow (gap 1s)
  （launch tool_use 落在 <session>/subagents/workflows/wf_4ce5e599-a28/agent-a7e8d41432c1a306e.jsonl）
```

**正侧（AC3）**——真实主会话直跑轮报 main-session：
```
r113 startedAt=2026-08-13T03:32:23.132Z -> main-session (gap 2s)
```
OOM 后 5 轮（r265-270）的**结构化记录已不在**现 `verification-round.jsonl`（现 1–147，r265-270 仅存于 manager-inbox 散文引用）⇒ 正侧 5 轮用 fixture 忠实重建：5 轮全 main-session ⇒ `band=rollback` `signal=1`（测试 `CLI — OOM 后 5 轮主会话直跑...`，AC3 正侧）。

**全量实测读数（重写后计数器）**：
```
signal: false  band: insufficient-evidence
forms_by_round: {main_session: 6, subagent: 10, workflow: 1, unclassified: 127}
consecutive_outer_rounds: 144（展示，非执行面取证——runner 恒 outer，不再驱动 signal）
```
近 5 轮（r143-147）全部 unclassified（suite-state-trigger 触发自动治理）⇒ 证据不足，**不计 signal**——不是回落，不再恒报。

**transcript 可变性局限（实测）**：长会话 COMPACT 会折掉旧 tool_use ⇒ 历史轮 launch 证据会随时间消失（实测 r96/r123 的 main-session 证据数小时后不可见）。近 N 轮窗口用新鲜证据可靠；全量 forms_by_round 只反映当前可读证据。判定归 outer：signal 触发后先用 meta-cc 核实再动作。

## Touches

- plugin/scripts/suite-execution-form-counter.ts（取证重写：transcript 文件类别）
- plugin/scripts/full-suite-runner.ts（runner 字段标注/降级）
- orchestration/orchestrator-tick-core.md（A19 判据改新取证）
- tasks/gap-a19-evidence-field-does-not-match-measured-object.md（自身）