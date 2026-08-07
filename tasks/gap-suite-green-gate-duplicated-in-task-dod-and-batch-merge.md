---
id: gap-suite-green-gate-duplicated-in-task-dod-and-batch-merge
title: "the full-suite green gate exists TWICE at two granularities — correctly at
  the batch-merge boundary (fast-mode-loop-tick.md:499: red blocks
  $MERGE_TARGET->$FORK_BASELINE, task merges to $MERGE_TARGET are NOT blocked) and
  redundantly in 92 of 825 task DoDs ('完整套件连跑 2 次全绿'); the duplicate couples
  every task to a slow global signal it cannot control — measured 2026-08-07: 5
  tasks held for a red caused by a SIGKILL misclassification unrelated to any of
  them, a subagent waiting 1h6m on a re-run nobody would start, and 64% of inner
  time polling suite logs (gap-two-thirds-...); human ruled 2026-08-07 to remove
  the duplicate, NOT to weaken the gate"
status: ready
labels:
  - gap
  - milestone-candidate
parent: null
children: []
extra: {}
---
**type:** execution

## Proposal

**同一个保护被实现了两次，粒度不同：一次在对的地方，一次在每个任务的收尾。**

| 位置 | 形态 | 判定 |
|---|---|---|
| **批量合边界**（`fast-mode-loop-tick.md:499`） | 套件红 ⇒ 暂缓 `$MERGE_TARGET`→`$FORK_BASELINE`；**任务合 `$MERGE_TARGET` 不受阻挡** | ✅ **正确，保留** |
| **任务 DoD** | `完整套件连跑 2 次全绿` —— **825 个任务中 92 个** | ❌ **重复，移除** |

## ⚠️ 与「闸不动」裁定的关系（执行前必读，否则会被挡回或被误做成削弱）

**本任务不是放宽 DoD。** 以下三处明确禁止放宽，**均继续有效**：

- `SPEC-suite-speed.md:10`「**『连跑 2 次全绿』这道闸不动**。C 是唯一不牺牲判据的路」
- `SPEC-suite-speed.md:38` **AC6（闸不动）**：全程**不得放宽**「连跑 2 次全绿」
- `SPEC-cut-the-waiting.md:41` **AC4（负控制，必须显式）**：DoD 的「最后连跑 2 次全量全绿」**不许放宽**

**区别在于「闸放在哪」，不是「闸松不松」**：批量合边界那道闸**原封不动**（`$FORK_BASELINE`
仍然只被验证过的树推进），移除的是**任务级那份重复**。**保护总量不变，耦合消失。**

⇒ **AC4 是本任务的承重条**：必须证明移除后 `$FORK_BASELINE` 的保护强度未变。

## 实测代价（2026-08-07，管理者现场观测）

| 代价 | 实测 |
|---|---|
| **耦合** | **5 个任务全被 held**，而红因是 **SIGKILL 被误分类为 `failed`**，与它们无一相关 |
| **死等** | inner subagent「Waiting on full-suite re-run」**1h6m42s**，主仓状态文件 **56 分钟未更新**，等的信号**无人产生** |
| **轮询** | `gap-two-thirds-of-a-task-is-polling-a-suite-log`：**64% 的 inner 时间在轮询套件日志**（meta-cc 实测 104.4 分钟会话） |
| **串行化** | 每任务压在 **13–37 分钟**的全局门后（今晚实测单次套件耗时区间） |

## 落实点（实测定位，非推断）

1. **规则源**：`plugin/loop/fast-mode-loop-tick.md:118-120`——写着「任务收尾（外层异步）仍必须按
   DoD 要求连跑 2 次全量全绿」。**这是新任务抄袭的源头，先改这里止血。**
2. **存量 92 条**：`grep -l '完整套件' tasks/*.md`。**不建议批量改写**（会掩盖历史判据），
   建议：新任务不再写；存量在各自收尾时按新规则处理，任务体注明依据。
3. **防复发**：`plugin/scripts/task-contract-check.ts` 已消费任务体，可加一条检查——
   新任务 DoD 出现「完整套件」⇒ 报出并指向本任务。

## 去掉之后，outer 跑套件发现问题怎么办（人的第二问，机制已存在）

**红窗规则已写好条件化处置**（`fast-mode-loop-tick.md:499` 之后），不需要新机制：
- 失败落在**共享闸门**（`run_static_checks`）⇒ 停新派发（所有任务被同一个红污染）
- 失败落在**具体测试文件且与新任务触摸集无关** ⇒ **派发继续**
- 失败文件与新任务触摸集**相交** ⇒ 该任务停派

**发现的问题 ⇒ 立新任务定向修，而不是把已完成的任务打回**：套件红说明「某处坏了」，
不说明「刚合进来的那条坏了」。**今晚即为例证**：红因是 SIGKILL 分类，与在飞 5 条毫无关系。
真是某任务引入的回归时，第三档（触摸集相交）会指出来。

## Contract

```
measure dod_suite_lines = `grep -l '完整套件' tasks/*.md | wc -l` stdout 的数字段（当前基线 92）
measure template_requires_suite = `grep -c '仍必须按 DoD 要求' plugin/loop/fast-mode-loop-tick.md` stdout 的数字段（当前基线 1，应降为 0）
invariant 批量合边界的闸门不得被削弱：`$FORK_BASELINE` 仍只由通过全量套件的树推进
invoke `grep -c '仍必须按 DoD 要求' plugin/loop/fast-mode-loop-tick.md`
control 构造一棵套件红的树 ⇒ 批量合 `$MERGE_TARGET`→`$FORK_BASELINE` 必须仍被拒绝（证明保护未削弱）
resume 若中断，先跑两个 measure 读当前值，不要假设模板已改
```

## Acceptance Criteria

- [ ] AC1: `plugin/loop/fast-mode-loop-tick.md:118-120` 改为「任务 DoD **不含**全量套件；全量套件是批量合边界的闸门」
- [ ] AC2: 新任务的 DoD 不再出现「完整套件」——加机械检查（并入 `task-contract-check.ts`），**负控制**：构造一条含该行的新任务 ⇒ 必须报出
- [ ] AC3: 存量 92 条的处置写进任务体（建议不批量改写，各自收尾时按新规则处理并注明依据）
- [ ] AC4: **承重条**——按 `control` 证明 `$FORK_BASELINE` 保护强度**未变**：套件红时批量合仍被拒绝
- [ ] AC5: 与 `SPEC-suite-speed.md` AC6、`SPEC-cut-the-waiting.md` AC4 交叉标注：**本任务不是放宽闸门，是移除重复**，两处「闸不动」继续有效

## Definition of Done

- [ ] AC1-AC5 实跑输出贴进任务体
- [ ] `--for-task` 选中集绿（**本任务自身不再要求完整套件——即以自身为首个应用**）

## Touches
- plugin/loop/fast-mode-loop-tick.md
- plugin/scripts/task-contract-check.ts
- orchestration/SPEC-suite-speed.md（交叉标注）
- orchestration/SPEC-cut-the-waiting.md（交叉标注）
- tasks/gap-suite-green-gate-duplicated-in-task-dod-and-batch-merge.md

## Dispatch review

reviewer: none
at: 2026-08-07T08:2xZ
changed: 人 2026-08-07 追问「是否应禁止任务 AC 列 suite 测试」并裁定落实；管理者查实闸门已在批量合边界存在，任务级那份是重复，据此立案
