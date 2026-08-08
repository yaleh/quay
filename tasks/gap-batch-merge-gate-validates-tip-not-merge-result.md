---
id: gap-batch-merge-gate-validates-tip-not-merge-result
title: 批量合闸门验的是 integration tip 的绿，放行的是 integration ⊕ develop 的合并结果—— 两者只在
  develop 侧无新提交时才等价，而 develop 每轮都有新提交（manager tick 记账就往 develop 落， 08-08 单轮 4
  个）；7094ba88（08:08:15，双亲 b0b2bbfd + e8cc87de）实测 5 个文件
  （orchestration/manager-loop-tick.md、manager-tick-sending.md、gap-adr016-md5-ban-*、已收尾
  2 任务） 没进过被测树（git diff e8cc87de..develop 非空）——本次全 .md 无害，但哪天 develop 侧有代码提交，
  闸门会在从未被一起测过的状态上放行，而所有时间戳都是新鲜的；与 stale-green（时间轴问题）不同： 本条是【被测对象 ≠
  被放行对象】的对象问题，判据形态也不同（查 git diff <被测点>..<合并目标> 非空） ——管理者 2026-08-08
  实测报告，建议独立立案不并入 stale-green
status: ready
labels:
  - gap
  - defect
parent: null
children: []
extra: {}
---
**type:** execution

## Proposal

**批量合闸门验的是 integration tip 的绿，放行的是 integration ⊕ develop 的合并结果——两者只在
develop 侧无新提交时才等价。**

### 管理者 2026-08-08 实测报告（未修，按边界只报不修）

**一、正面证据（stale-green 未复发）**：绿 finishedAt=08:07:44.593Z → 批量合 7094ba88 提交于
08:08:15Z，相隔 31 秒；被测点 /tmp/quay-intg2 HEAD=e8cc87de 与 integration tip 完全一致
（落后 integration=0）。对照早前 7b1ac3a1（3 小时前绿）、再早（落后 32 提交的树）——这次两个坑都没踩。

**二、但闸门验的是 integration 的 tip，不是【合并结果】。**
7094ba88 双亲 = b0b2bbfd(develop tip) + e8cc87de(integration tip=被测点)。
`git diff --name-only e8cc87de..develop` = 5 个文件（管理者原报 3，外层复核含 2 个已收尾任务文件），
**全部没进过被测树**：
- orchestration/manager-loop-tick.md
- orchestration/manager-tick-sending.md
- tasks/gap-adr016-md5-ban-violated-in-shipped-md-and-checker-scope-gap.md
- tasks/gap-load-sensitive-requires-predeclared-marker.md
- tasks/gap-send-keys-reliable-false-fail-on-long-text-paste.md

本次无害——全 .md/tasks，其中两个还是 manager 的。**但形态是结构性的**：
闸门给的是「integration tip 绿」，放行的是「integration ⊕ develop 的合并结果」，
两者只在 develop 侧无新提交时才等价。而 develop 侧【每轮都有】新提交
（manager 的 tick 记账就在往 develop 上落，单轮 4 个）。

⇒ 今晚是 .md 所以无害；哪天 develop 侧那几个提交里有一个是代码，闸门会在一个从未被一起测过的
状态上放行，而所有时间戳都是新鲜的。

### 与已立案 gap-batch-merge-gate-reads-stale-green 的区别（建议不合并）

| | stale-green（已立案） | 本条（本任务） |
|---|---|---|
| 缺陷轴 | 绿本身旧 / 被测树旧 | 绿是新的、被测树也是对的，但【被测对象 ≠ 被放行对象】 |
| 类型 | 时间轴问题 | 对象问题 |
| 判据形态 | 查时间戳（finishedAt 距今 / 是否晚于 fan-in） | 查 `git diff --name-only <被测点>..<合并目标>` 是否为空 |

### 修法方向（设计归外层+内层，不预设）

闸门在批量合前校验 `git diff --name-only <integration tip>..<merge target>` 为空（或仅限已知
无害文件集，如 tasks/*.md / *.md）；若 develop 侧有代码提交未进被测树，需先在 integration 上补测
该提交（或将该提交 fan-in 到 integration 后重跑）再批量合。

## Contract

```
measure unmerged_develop_files = `git diff --name-only <integration tip>..<合并目标> | grep -cE "\.(ts|js|mjs|sh)$"` stdout 数字段
band unmerged_develop_files = 0（修复后批量合前 develop 侧代码文件未进被测树 = 0；当前场景=0 因全是 .md，但结构性缺口存在）
invoke `git diff --name-only <integration tip>..develop`
control 负控制：develop 侧纯 .md/tasks 文件（如本次 5 个）可放行；develop 侧代码文件（.ts/.js/.mjs/.sh）必须拦截
resume 若中断，先跑 measure 确认 develop 侧未进被测树的代码文件数，不要假设已修
```

## Acceptance Criteria

- [x] AC1: **对象闸门**——批量合前校验 `git diff --name-only <integration tip>..<合并目标>`
      不含代码文件（.ts/.js/.mjs/.sh）；纯 .md/tasks 可放行（如本次 5 个）
      （证据：`integration-batch-merge.sh` 新增 `check_object_gate()` 前置校验（主流程在任何 ref 移动前调用）；
      three-dot 语义 `git diff --name-only <merge-base(integration,develop)> <develop>` 隔离 develop 侧
      变更。实跑——纯 md 场景 `measure unmerged_develop_files=0` 放行、真实合并成功；develop 侧
      `src/dev-code.ts` 场景 `measure unmerged_develop_files=1` + `OBJECT-GATE FAIL-CLOSED` + 报出
      `src/dev-code.ts`、`nothing moved`。测试：`plugin/test/integration-batch-merge.test.mjs` 新增 4 条
      OBJECT GATE 用例全绿。**实现精化**：任务体 Contract 字面用两-dot `git diff integration..develop`，
      但两-dot 会把 integration 自己（已测）的代码文件也算进去造成误伤（实测定 `src/feature.ts` 被误报）；
      three-dot 只取 develop 侧自分歧点起的变更，是「develop 侧代码文件未进被测树」的正确实现。）
- [x] AC2: **代码提交路径**——develop 侧代码提交未进被测树时，批量合被拦；需先 fan-in 到 integration
      补测再合
      （证据：实跑 develop 侧 `src/dev-code.ts` 未进被测树 ⇒ 批量合 exit 1、integration 未被吸收、develop tip
      未动；脚本 fail-closed 消息给出修法「fan-in 到 integration 补测再合」；测试「OBJECT GATE (AC1/AC2):
      develop-side .ts code never entered the tested tree ⇒ FAIL-CLOSED before any ref moves」断言
      `measure unmerged_develop_files=1` + 文件清单 + develop/ref 未变）
- [x] AC3: **与 stale-green 区分**——两条独立任务，各自 AC/Contract 不混淆（时间轴 vs 对象）
      （证据：本任务 measure = `unmerged_develop_files`（对象轴：`git diff --name-only <merge-base> <develop>`
      含代码文件数）；stale-green 任务 `tasks/gap-batch-merge-gate-reads-stale-green.md` measure =
      `suite_freshness`（时间轴：finishedAt 距今秒数）——两条独立 AC/Contract，本任务在
      `tasks/gap-batch-merge-gate-reads-stale-green.md` 追加交叉标注明确区分）
- [x] AC4: 与 gap-batch-merge-gate-reads-stale-green、gap-load-sensitive-requires-predeclared-marker
      交叉标注（闸门家族）
      （证据：`tasks/gap-batch-merge-gate-reads-stale-green.md` 与
      `tasks/gap-load-sensitive-requires-predeclared-marker.md` 各追加「交叉标注
      （gap-batch-merge-gate-validates-tip-not-merge-result）」节——批量合家族三件套
      闸门/对象/对账成文）

## Definition of Done

- [x] AC1-AC4 实跑输出贴任务体（git diff 对照 + 纯 md 放行 + 代码文件拦截）
      （证据见下方「修证据（2026-08-08 dispatch）」：纯 md 5 文件 `git diff --name-only` 对照 +
      放行实跑 + 代码文件拦截实跑全贴；scoped gate `scripts/test.sh --for-task
      gap-batch-merge-gate-validates-tip-not-merge-result` 通过）

## Touches
- plugin/loop/orchestrator-loop-tick.md（批量合步骤：加对象闸门校验）
- plugin/loop/fast-mode-loop-tick.md（同步）
- plugin/scripts/integration-batch-merge.sh（若需在脚本侧加校验）
- plugin/test/integration-batch-merge.test.mjs（对象闸门的测试）
- tasks/gap-batch-merge-gate-reads-stale-green.md（AC3 交叉标注）
- tasks/gap-load-sensitive-requires-predeclared-marker.md（AC4 交叉标注）

## 修证据（2026-08-08 dispatch）

**实跑 1 — 纯 md 放行（2026-08-08 报告那 5 个文件的形状）**：develop 侧推进 5 个 .md/tasks 文件
（orchestration/manager-loop-tick.md、manager-tick-sending.md、tasks/gap-*.md ×3），integration 有任务合并：

```
$ git diff --name-only <merge-base(integration,develop)> <develop>   # develop 侧自分歧点起的变更
orchestration/manager-loop-tick.md
orchestration/manager-tick-sending.md
orchestration/tick-log.md
tasks/gap-adr016-md5-ban.md
tasks/gap-load-sensitive-requires-predeclared-marker.md
tasks/gap-send-keys-reliable-false-fail.md
$ git diff --name-only <merge-base> <develop> | grep -cE '\.(ts|js|mjs|sh)$'   # gate measure
0
$ integration-batch-merge.sh --merge
integration-batch-merge: measure unmerged_develop_files=0
integration-batch-merge: OK — develop real-merged to integration (merge commit e934804…)
integration-batch-merge: measure integration_ff_merges=0
# exit 0 — 纯 .md/tasks 放行，合并成功
```

**实跑 2 — 代码文件拦截（AC2）**：develop 侧推进 `orchestration/tick-log.md`（md）**+ `src/dev-code.ts`（代码）**，
integration 有任务合并：

```
$ git diff --name-only <merge-base> <develop> | grep -cE '\.(ts|js|mjs|sh)$'
1
$ integration-batch-merge.sh --merge
integration-batch-merge: measure unmerged_develop_files=1
integration-batch-merge:   develop-side code files that never entered the tested tree (integration tip):
integration-batch-merge:     src/dev-code.ts
integration-batch-merge: OBJECT-GATE FAIL-CLOSED — the MERGE RESULT (integration ⊕ develop) would ship untested code; nothing moved
integration-batch-merge:   tested tree = integration tip (fc5276fa…)
# exit 1 — integration 未被吸收（merge-base --is-ancestor integration develop 非 0），develop tip 未变
```

**实现**：`integration-batch-merge.sh` 主流程「nothing-pending 早退」之后、任何 ref 移动之前调用
`check_object_gate()`；three-dot 语义（`git diff --name-only <merge-base> <develop>`）隔离 develop 侧变更。
**为何不用任务体 Contract 字面的两-dot**：`git diff --name-only integration..develop` 会把 integration
自己已测的代码文件也列出（实测 `src/feature.ts` 被误报为 develop 侧代码）——对象问题特指 develop 侧未测代码，
两-dot 无法区分方向，three-dot 才精确。**与 stale-green 的判据形态差异**（AC3）：stale-green 查时间戳
（`suite_freshness` = finishedAt 距今秒数），本任务查对象（`unmerged_develop_files` = develop 侧代码文件数），
两轴独立、各自 Contract 不混淆。

**测试**：`plugin/test/integration-batch-merge.test.mjs` 新增 4 条 OBJECT GATE 用例（develop 侧 .ts 拦截 /
纯 md 放行 / FF 已测代码不误伤 / dry-run 报 would-block），15/15 全绿。原 AC3 real-merge code-conflict 负控制
改为用 `code.json`（非闸门扩展名）构造，保证 real_merge 的 fail-closed 兜底仍可达、仍被覆盖。

## 交叉标注（gap-batch-merge-reconcile-destroys-uncommitted-work，2026-08-08 dispatch）

本任务 AC4 交叉标注：**批量合家族三件套——闸门（`gap-batch-merge-gate-reads-stale-green`，何时合）/
对象（本任务，合什么）/ 对账（`gap-batch-merge-reconcile-destroys-uncommitted-work`，合完主检出
HEAD/index 怎么办）**。`gap-batch-merge-reconcile-destroys-uncommitted-work` 已修：批量合是
REF-LEVEL（update-ref CAS），对账步骤由 `integration-batch-merge.sh --reconcile` 自己提供（ref
移动前 `git status --porcelain` 为空断言 + 合后 `git reset --mixed`，绝不用 `--hard`——inner 曾用
`--hard` 销毁 manager 未提交编辑，2026-08-08 08:08:24）。本任务管「批量合对象校验（代码文件不得进）」
，「合完后主检出状态」是同族第三面（对账）。

## Dispatch review

reviewer: none
at: 2026-08-08T08:1xZ
changed: 管理者 2026-08-08 实测报告（7094ba88 双亲 = develop tip + integration tip；5 文件未进被测树，
  本次全 .md 无害但结构性缺口成立；与 stale-green 不同轴、不同判据形态）。外层独立复核：
  git diff --name-only e8cc87de..develop 非空（5 文件，含 2 个已收尾任务）；integration tip ==
  被测点 e8cc87de；绿 fresh（31s 间隔）——发现成立，独立立案。
