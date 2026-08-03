---
id: gap-checkers-have-never-been-shown-to-fail
title: "No instrument for L_S — mutation-test the checkers themselves, because two of today's negative controls could not have failed"
status: todo
labels:
  - gap
  - milestone-candidate
extra:
  schema: v1
---

**type:** execution

## Proposal

规格 `orchestration/SPEC-typed-axes-and-standing-dynamics.md` AC1（管理者定，最优先）。

**立案来自当天两次真实失败，都不是理论**：

| # | 实例 | 形态 |
|---|---|---|
| 6 | 外层的改名负控制 | **探针在缺陷存在时也不会失败**——用对 quay 零依赖的 `resource-gate.sh` 当探针，开发树在不在它都 exit 0，**我据此报过两次「通过」** |
| 10 | `/live` 的验收 | **只测了数据缺失方向**——「无数据」验了，「有活动但遥测为空」没验，于是 archguard 那类状态从未被覆盖 |

**⇒ 「负控制必须能在缺陷存在时失败」这条，是从失败里反推出来的**——
而它本可以由轴名事先给出。**L_S 这根轴目前没有任何仪器。**

**做法：对检查器做变异测试，不是对产品代码。** 故意破坏被检查的对象，
**断言对应的检查器会红**；不红即说明该检查器与「永远通过」不可区分。

### §0 约束（决定形态，不可绕过）

管理者实测自己「每 tick 必记 cpu some avg10」的遵守率是 **39%（15/38）**。
**外层把同一把尺子量了自己**，结果更有信息量：

| 记录项 | 遵守率 |
|---|---|
| cpu / 压力 | **28/57 = 49%** |
| 在飞任务数 | 53/57 = 93% |
| 核实列非空 | **57/57 = 100%** |

**⇒ 规律不是「散文规则会失效」，而是「只为记录而记的会失效，记录者自己要用的不会」**——
核实列 100% 是因为它是我判断的依据，cpu 49% 是因为它只进日志。
**这条预测了哪些散文规则会漂**，比 39% 这个数本身更有用。
**因此本任务的一切必须落成脚本或字段，不得落成文档行。**

## Contract

```
measure checkers_total = `bash plugin/scripts/checker-mutation-check.sh --list` 输出的检查器总数字段
measure checkers_with_mutation = 同一命令输出中已有变异用例的检查器数字段（`--list --json` 的 covered 计数）
measure mutations_that_stayed_green = `bash plugin/scripts/checker-mutation-check.sh --run --json` 输出中破坏后仍未报红的变异数字段
band mutations_that_stayed_green = 0
invariant 检查器清单从 run_static_checks 与 CI 解析得到，不得手写；本机制自身也须被变异覆盖
invoke `bash plugin/scripts/checker-mutation-check.sh --run --json`
control 对任一检查器注入其应当捕获的缺陷 ⇒ 该检查器必须红；移除注入 ⇒ 必须绿
resume 先解析清单、再逐个补变异用例、最后接执行者
```

## Chosen mechanism

1. **清单从源头解析（AC1b）**：检查器列表由 `scripts/test.sh` 的 `run_static_checks` 与
   `.github/workflows/*.yml` **解析**得到，**不得手写**——
   否则「新加的检查器没有变异用例」会静默漏掉，而那正是本任务要防的形态。
2. **每个检查器一个变异用例**：注入它**声称能抓**的那种缺陷，断言它红；恢复，断言它绿。
   **两个方向都要**（只证明能红与「永远红」同形）。
3. **元判据（AC1c）**：**本机制自己也要有变异用例**——破坏 `checker-mutation-check` 本身
   必须导致失败。**否则它就是它自己要抓的那种东西。**
4. **接执行者**：与其余检查器同址（`run_static_checks`）。**成本先测再定**：
   变异测试要反复调用检查器，若全量成本过高，则按「新增/改动的检查器」增量跑，
   **但增量判据必须能发现「新检查器无变异用例」**（AC1b 的清单解析保证这一点）。

**不做**：不对产品代码做变异测试（那是另一件事、成本高得多，且当天零个实例指向它）；
不为达标而放宽任何现有检查器；**不写「以后记得给新检查器加变异用例」这类文档行**（§0）。

## Acceptance Criteria

- [ ] AC1: 检查器清单**从 `run_static_checks` 与 CI 解析**得到（负控制：临时加一个假检查器进 `run_static_checks`，清单必须包含它）
- [ ] AC2: 每个已知检查器有变异用例，**注入 ⇒ 红、恢复 ⇒ 绿**两个方向都贴实跑输出
- [ ] AC3: **`mutations_that_stayed_green` 为 0**；若非 0，逐个列出哪个检查器在缺陷存在时仍绿——
      **那正是本任务要找的东西，找到就是成果不是失败**
- [ ] AC4: **元变异（AC1c）**——破坏 `checker-mutation-check` 自身必须导致失败（实跑输出贴任务体）
- [ ] AC5: 用当天两个真实实例回归：**改名负控制**（探针换成对 quay 有依赖的路径后，缺陷存在时必须红）、
      **`/live`**（「有活动但遥测为空」方向必须有用例）
- [ ] AC6: 接上执行者并被真实触发一次；**成本实测记录**，若走增量则说明增量判据如何覆盖新检查器
- [ ] AC7: 测试用 `node:test` 且带 `// @test-group governance`

## Definition of Done

- [ ] AC2 与 AC4 的实跑输出贴进任务体——
      **一个从未见过自己变红的检查器，与「永远返回通过」不可区分**
- [ ] 完整套件连跑 2 次全绿（若只到 1 次，如实标 `[~]` 并写明）
- [ ] 任务体记录：立案来自当天 #6 与 #10 两次真实失败，**不是理论推导**

## Touches

- plugin/scripts/checker-mutation-check.sh
- plugin/test/checker-mutation-check.test.mjs
- docs/analysis/checker-mutation-contract.md
- scripts/test.sh

## Dispatch review

reviewer: outer
at: 2026-08-03T18:02:00Z
changed: 管理者定为规格最优先项并问「可否并入在飞的 ac-carryover」。**外层判：并入已不可能——
`ac-carryover` 已收尾**（任务体 `status: done`、AC 全勾、证据齐全），**所以 AC1 必须单独成任务**。
（顺带实测到它收尾差一步：遥测里仍 `inProgress`、`--task-end` 未调用，已通报内层补。）
**§0 的约束外层用自己的日志复核了**，并把结论收窄得更有用：不是「散文规则会失效」，
而是**「只为记录而记的会失效，记录者自己要用的不会」**——核实列 100%、在飞 93%、cpu 49%，
**三个数的差别正好落在「这个值我判断时用不用得上」**。这条预测了哪些散文规则会漂。
**AC1b 与 AC1c 原样落进 AC1/AC4**：清单解析防「新检查器无用例」，元变异防它自己成为它要抓的东西。
**AC5 用当天两个真实失败做回归**，避免这个机制只在人造用例上绿。
**规格的 AC2（`axis:` 字段）与 AC3（四个常设动力学量）未在本任务内**——
它们是另外两个独立可落地的机制，按本仓拆分政策不该塞进来；**待槽位另建**，
此处写明是为了让「暂未建」是一个被记录的选择。
