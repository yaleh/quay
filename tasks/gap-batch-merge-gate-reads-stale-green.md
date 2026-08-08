---
id: gap-batch-merge-gate-reads-stale-green
title: 批量合闸门只读 .quay/full-suite-state.json 的
  state==green，不读新鲜度——7b1ac3a1（06:07:22） 批量合前后一次 suite 都没跑，拿的是 02:50:28→03:02:26
  三小时前、测完全不同一批提交的绿当通行证； state 文件 mtime 04:49:29 远早于 merge；按
  orchestrator-loop-tick.md:638-649 批量合硬前置是 suiteGreen==true，闸门满足但新鲜度为零——管理者判准
  ②「陈旧当现状」长在批量合闸门上
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

**批量合 integration→develop 的闸门只读 `state == green`，不读新鲜度——三小时前的旧绿
成了此刻这棵树的通行证。**

### 实测（管理者 2026-08-08 报告，外层独立复核）

- 合并 `7b1ac3a1` 发生在 **2026-08-08 06:07:22 +0000**。
- `.quay/full-suite-state.json` 终态是 **02:50:28→03:02:26** 那次 green（`durationMs: 718203`），
  **state 文件 mtime = 04:49:29**，merge 前后 runner 数 = 0。
- **这次批量合前后一次 suite 都没跑。** 中间已落了 AC19 全套、README 修复、管理者五次判准改动——
  那个绿测的是完全不同的一批提交。

### 根因

`orchestrator-loop-tick.md` 步骤 3b（638-649 行）批量合的硬前置是 `suiteGreen == true`，
而 `suiteGreen` 的定义（724 行）就是「读 `.quay/full-suite-state.json` 的 `state`——`green` ⇒ true」。
**只判 `state` 字段，不判新鲜度**（`finishedAt` 相对当前时刻的间隔、是否晚于最近一次 fan-in）。

⇒ 一个针对另一棵树的旧绿，成了此刻这棵树的通行证。这正是管理者判准 ② 那条
「陈旧当现状」（`gap-suite-state-split-across-worktree-and-gate` 一族）长在批量合闸门上。

### 代价（已实际发生）

7b1ac3a1 批量合发生在没有任何 suite 跑过的情况下，把一批未经当前树验证的 integration 内容
并入了 develop——闸门形同虚设。

### 范围

立项。修法方向（外层+内层设计）：`suiteGreen` 判定加新鲜度维度——`finishedAt` 必须晚于
最近一次 integration fan-in（或晚于 state 文件 mtime 的某个窗口），否则按「无有效绿」处理
（red/aborted/缺 state 同路径：不批量合）。注意 `fast-mode-loop-tick.md` 与
`orchestrator-loop-tick.md` 两处读 state 的地方要同步改（同源，防漂移）。

## Contract

```
measure suite_freshness = `python3 -c "import json,time; d=json.load(open('.quay/full-suite-state.json')); print(int(time.time()-d.get('finishedAt',0)))"` stdout 数字段
band suite_freshness = <窗口秒数>（修复后 finishedAt 距今 ≤ 窗口才视为有效绿；当前 7b1ac3a1 场景远超窗口）
invoke `python3 -c "import json; d=json.load(open('.quay/full-suite-state.json')); print(d.get('finishedAt'))"`
control 对照：新绿（suite 刚跑完）必须放行；旧绿（如 7b1ac3a1 场景，3 小时前）必须拦截为「无有效绿」
resume 若中断，先跑 measure 确认 finishedAt 距今秒数，不要假设已修
```

## Acceptance Criteria

- [ ] AC1: **新鲜度闸门**——`suiteGreen` 判定加入新鲜度（`finishedAt` 距今 ≤ 窗口 且 晚于最近
      fan-in），旧绿不再当通行证
- [ ] AC2: **7b1ac3a1 场景复测**——3 小时前绿 + 期间有新 fan-in ⇒ 批量合被拦（不跑
      integration-batch-merge.sh）；新绿 ⇒ 放行
- [ ] AC3: 两份文档同步——`fast-mode-loop-tick.md` 与 `orchestrator-loop-tick.md` 的 suiteGreen
      定义一致（同源防漂移）
- [ ] AC4: 与 gap-suite-state-split-across-worktree-and-gate、gap-batch-merge-bypassed-* 交叉标注

## Definition of Done

- [ ] AC1-AC4 实跑输出贴任务体（新旧绿对照 + 拦截/放行）

## Touches
- plugin/loop/orchestrator-loop-tick.md（suiteGreen 定义：加新鲜度）
- plugin/loop/fast-mode-loop-tick.md（同步 suiteGreen 定义）
- plugin/scripts/full-suite-runner.ts（若需要写 finishedAt 的规范化）
- tasks/gap-suite-state-split-across-worktree-and-gate.md（AC4 交叉标注）
- tasks/gap-batch-merge-bypassed-integration-batch-merge-script.md（AC4 交叉标注）

## Confirmed by manager (2026-08-08 07:1x)

管理者确认：判据 ④ 的**文档形态与实际形态不一致**是可测事实（非意见）——
- `orchestrator-loop-tick.md:649` 写机械门：`suiteGreen == false（red/aborted/缺 state）⇒ 不跑批量合`；
- 实际执行是自判门：suite red（07:06:49）→ inner 隔离重跑通过 → 07:07:49 批量合（红后 1 分钟）。
- **文档说机械、实际是自判——差距本身就是缺口**，与本任务（闸门只读 state 不读新鲜度）同类。

## 交叉标注（gap-load-sensitive-requires-predeclared-marker，2026-08-08 dispatch）

本任务 AC5 交叉标注：**「红窗释放」也是同一个「闸门自判 vs 机械」族**——suite red 07:06:49 → inner
隔离重跑 serve.test.mjs 通过 → 07:07:49 批量合（红后 1 分钟），释放判据是 inner 自判（隔离通过即
放行），无机械准入。`gap-load-sensitive-requires-predeclared-marker` 已修：红窗释放改为**事前声明
KNOWN-LOAD-SENSITIVE 标记准入**（`docs/analysis/fast-mode-loop-tick.md`「红窗释放准入」两条路径 +
`plugin/scripts/load-sensitive-release-check.ts` 机械校验）。与本任务（批量合闸门读 state 不读
新鲜度）是同族缺口的两面：批量合「何时合」要机械判，红窗释放「凭什么放行」也要机械判。

## 交叉标注（gap-batch-merge-reconcile-destroys-uncommitted-work，2026-08-08 dispatch）

本任务 AC5 交叉标注：**批量合家族三件套——闸门（本任务，何时合）/ 对象（
`gap-batch-merge-gate-validates-tip-not-merge-result`，合什么）/ 对账（
`gap-batch-merge-reconcile-destroys-uncommitted-work`，合完主检出 HEAD/index 怎么办）**。
`gap-batch-merge-reconcile-destroys-uncommitted-work` 已修：批量合是 REF-LEVEL（update-ref CAS），
对账步骤由 `integration-batch-merge.sh --reconcile` 自己提供（ref 移动前 `git status --porcelain`
为空断言 + 合后 `git reset --mixed`，绝不用 `--hard`——inner 曾用 `--hard` 销毁 manager 未提交编辑，
2026-08-08 08:08:24）。本任务管「批量合闸门判绿」，「合完后主检出状态」是同族第三面（对账）。

## 交叉标注（gap-batch-merge-gate-validates-tip-not-merge-result，2026-08-08 dispatch）

本任务 AC6 交叉标注：**两轴独立，不混淆**——本任务（stale-green）是**时间轴**问题（绿旧/被测树旧，
判据 = 查 `finishedAt` 距今秒数 / 是否晚于最近 fan-in），`gap-batch-merge-gate-validates-tip-not-merge-result`
是**对象轴**问题（被测对象 ≠ 被放行对象，判据 = 查 `git diff --name-only <merge-base> <develop>` 是否含
代码文件）。各自 Contract measure 不同：本任务 = `suite_freshness`，对象任务 = `unmerged_develop_files`。
`integration-batch-merge.sh` 已为对象任务新增 `check_object_gate()`（three-dot 语义），与本任务要加的新鲜度
维度是同一脚本上互补的两道闸——「何时合」看新鲜度、「合什么」看对象。

## Dispatch review

reviewer: none
at: 2026-08-08T06:2xZ
changed: 管理者 2026-08-08 报告（7b1ac3a1 前后 0 次 suite、state 是 02:50-03:02 旧绿、mtime 04:49）；
  外层独立复核：state 文件 finishedAt=03:02:26、merge 06:07:22、期间零 runner——陈旧绿证据成立；
  闸门代码 orchestrator-loop-tick.md:724 只读 state 字段——根因确认。
  **2026-08-08 07:1x 管理者确认**：文档机械门 vs 实际自判门的差距是真实缺口（serve.test.mjs
  07:06:49 红 → 隔离通过 → 07:07:49 批量合），与本任务同类。
