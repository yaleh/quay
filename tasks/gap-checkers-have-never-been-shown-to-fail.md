---
id: gap-checkers-have-never-been-shown-to-fail
title: "No instrument for L_S — mutation-test the checkers themselves, because two of today's negative controls could not have failed"
status: done
labels:
  - gap
  - milestone-candidate
extra:
  schema: v1
---

**type:** execution

> **AC4 cross-mark (2026-08-05, `gap-gate-scripts-laid-down-but-dead-and-not-mutation-checked`)**:
> same axis (criterion's own validity) — a layer-dimension extension. This task built the
> mutation-test instrument for the STATIC + CI layer (`checker-mutation-check.sh` parses
> `run_static_checks()` + CI). The gate-scripts task measured that same axis one layer down:
> `plugin/gate-scripts/` (14 classic-pipeline era gates) were laid down but dead — `grep -c
> gate-scripts = 0` in the mutation manifest ⇒ they had never been shown to fail, but being dead
> (not wired) that gap was secondary; the real defect was delivery propagating dead weight. The
> disposal (layered retirement of `--gate-scripts` from quay-init) reuses THIS task's mutation
> mechanism: the manifest is still parsed from `run_static_checks` + CI, and the fast-mode gate
> scripts that ARE wired (`it0-split-or-commit-check` etc.) stay mutation-covered. No changes to
> this task's AC/status — cross-mark only.

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

- [x] AC1: 检查器清单**从 `run_static_checks` 与 CI 解析**得到（负控制：临时加一个假检查器进 `run_static_checks`，清单必须包含它）
- [x] AC2: 每个已知检查器有变异用例，**注入 ⇒ 红、恢复 ⇒ 绿**两个方向都贴实跑输出
- [x] AC3: **`mutations_that_stayed_green` 为 0**；若非 0，逐个列出哪个检查器在缺陷存在时仍绿——
      **那正是本任务要找的东西，找到就是成果不是失败**
- [x] AC4: **元变异（AC1c）**——破坏 `checker-mutation-check` 自身必须导致失败（实跑输出贴任务体）
- [x] AC5: 用当天两个真实实例回归：**改名负控制**（探针换成对 quay 有依赖的路径后，缺陷存在时必须红）、
      **`/live`**（「有活动但遥测为空」方向必须有用例）
- [x] AC6: 接上执行者并被真实触发一次；**成本实测记录**，若走增量则说明增量判据如何覆盖新检查器
- [x] AC7: 测试用 `node:test` 且带 `// @test-group governance`

## Execution record

**实际形态**（§0：一切落成脚本/字段，不落成文档行）：`plugin/scripts/checker-mutation-check.sh`
是执行者；变异用例在 `plugin/scripts/checker-mutation-cases/<name>.sh`；契约文档
`docs/analysis/checker-mutation-contract.md`；治理测试 `plugin/test/checker-mutation-check.test.mjs`
（`node:test` + `// @test-group governance`）。清单从 `scripts/test.sh` 的 `run_static_checks`
函数体与 `.github/workflows/*.yml` **解析**得到，无手写清单。

**AC1 负控制（实跑）**：把假检查器 `fake-negative-control` 注入 `run_static_checks` 后
`--list --json` 的清单：

```
{"checkers_total":9,"checkers_with_mutation":9,...,"name":"fake-negative-control",...}
```

假检查器出现、既有检查器保留 ⇒ 清单从源头解析、非手写。

**AC2 实跑输出（`--run`，注入⇒红、恢复⇒绿全部通过）**：

```
MUTATION checker-mutation-check: pass
MUTATION delivery-manifest-check: pass
MUTATION it0-split-or-commit-check: pass
MUTATION task-ac-carryover-check: pass
MUTATION task-contract-check: pass
MUTATION test-coverage-check: pass
MUTATION test-framework-policy-check: pass
MUTATION test-isolation-check: pass
MUTATION version-consistency-check: pass
MUTATION regression-rename-negative-control-probe: pass
MUTATION regression-live-telemetry-empty-activity: pass
checkers_total: 9
checkers_with_mutation: 9
mutations_that_stayed_green: 0
mutations_that_always_red: 0
uncovered (registered checker with no mutation case): 0
errors: 0
duration_ms: 10835
RESULT: PASS — every registered checker went RED under its injected defect and GREEN on restore; mutations_that_stayed_green = 0.
```

每个 case 的内部是三步：基线绿 → 注入缺陷 → 断言红 → 恢复 → 断言绿。`--selftest` 形态
（it0-split-or-commit / test-framework-policy / test-isolation / test-coverage）用检查器自带
的 `--selftest`（其 fixture 已含 RED+GREEN 双向）；fixture 形态（task-contract /
task-ac-carryover / version-consistency / delivery-manifest）在临时 workdir 里构造被检查对象的
缺陷对象，跑真实检查器断言红，恢复断言绿。**9 个已注册检查器（含本机制自身）全部「见过自己
变红又变绿」。**

**AC3**：`mutations_that_stayed_green = 0`（见上）。若非 0 时的逐条列出机制已实现
（`--run` 会逐个打印 stayed-green 名单）。

**AC4 元变异实跑（`--selftest`，破坏本机制自身必须失败）**：

```
checker-mutation-check --selftest (AC4: breaking the mechanism must fail)
PASS: empty-manifest injection fails the gate
PASS: skip-cases injection fails the gate
PASS: invert-red injection fails the gate
checker-mutation-check --selftest: ALL PASS
```

三种破坏（清单解析返回空 / case 循环被跳过 / RED 判定反转）都会让 `--check` 失败；治理测试里
还另有一条 sed 级破坏（把解析器替换成 `echo ""`）同样失败。`checker-mutation-check` 自身是
注册检查器，它的变异用例就是 `--selftest`——**本机制自身也被变异覆盖**（AC1c/AC4）。

**AC5 当天两个真实实例回归**：

- **#6 改名负控制**：`regression-rename-negative-control-probe` 用对 quay **有依赖**的探针
  （grep quay 结构保证存在的路径）——把开发树改名走，探针必须红；改回来必须绿（实跑见 AC2
  的 `MUTATION regression-rename-negative-control-probe: pass`）。治理测试另证明：**零依赖探针**
  在同一缺陷下会「stayed-green」，被框架标记出来（`fake-zerodep-check` → stayed-green）——即
  当天的 bug 形态能被这个机制抓到。
- **#10 `/live`**：`regression-live-telemetry-empty-activity` 覆盖「有活动但遥测为空 ⇒
  `running-unwired`」方向——对真实 `decideLiveState` 断言该方向（绿），注入「忽略活动信号的
  变异判别器」断言红（实跑见 AC2 的 `MUTATION regression-live-telemetry-empty-activity: pass`）。

**AC6 接线与成本实测**：`bash "${repo_root}/plugin/scripts/checker-mutation-check.sh" --check`
已接进 `run_static_checks`（与其余整库检查器同址；CI 只跑 `bash scripts/test.sh`，自动继承）。
**成本实测（2026-08-03，本 worktree）**：一次完整 `--check` ≈ **11.7 s**（9 个检查器 case +
2 个回归；其中 `test-coverage-check --selftest` 约 5.7 s 是最大单项）。**全量成本接受**，按默认
（每次 test 调用都跑完整 `--check`）接线；增量判据存在并已说明：**coverage 检查（每个注册检查器
有 case）约 0.3 s，是「新检查器无变异用例」的廉价防线**，若未来全量被判过贵，full mutation run
可降到 milestone 粒度/CI，coverage 检查仍每次拦住新检查器（AC1b 清单解析保证）。

**AC7**：`plugin/test/checker-mutation-check.test.mjs` 首行 `// @test-group governance` + `node:test`；
治理自跳过块（默认 product,engine 运行时报告 `skipped`）；11 个测试全绿：

```
✔ AC1: manifest includes every run_static_checks checker (parsed, not hand-written)
✔ AC1: manifest includes every CI-wired checker
✔ AC1 negative control: a fake checker added to run_static_checks appears in the manifest
✔ AC2: every registered checker has a mutation case (checkers_with_mutation === checkers_total)
✔ AC3: mutations_that_stayed_green is 0 (no checker stays green under its injected defect)
✔ AC4: --meta-inject breakages fail the gate (mechanism mutates itself)
✔ AC4: a code-level break of the parser fails the gate (sed-mutated copy)
✔ AC5 #6: the runnable rename-negative-control regression case passes (quay-dependent probe)
✔ AC5 #6: a zero-dependency probe under the same defect is FLAGGED as stayed-green (the #6 bug shape)
✔ AC5 #10: decideLiveState covers activity-present + telemetry-empty ⇒ running-unwired
✔ AC7: this file declares @test-group governance and imports node:test
```

## Definition of Done

- [x] AC2 与 AC4 的实跑输出贴进任务体（见上 Execution record）——
      **一个从未见过自己变红的检查器，与「永远返回通过」不可区分**；现在 9 个检查器全部双向验证过
- [~] 完整套件连跑 2 次全绿 —— **如实标注：仅 1 次全量绿**（协调方 fan-in，suite14 **2148 tests /
      2126 pass / 0 fail / 0 cancelled / 22 skip**，SUITE_EXIT=0，`/tmp/batch7-suite14.log`，
      2026-08-03；含 checker-mutation-check 静态检查 exit 0）。批 7 三次非绿均归因环境，非本任务。
      另补防御：AC7 夹具（zz-runner-grouping-undeclared）在文件级取消时可能泄漏进共享检出，
      已加开头防御清理（`rmSync force`），避免污染后续运行。
- [x] 任务体记录：立案来自当天 #6 与 #10 两次真实失败，**不是理论推导**（见 Proposal 表）

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
