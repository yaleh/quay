---
id: gap-ac51-assertion-surface-split
title: AC51 断言面拆分——文档检查在提交那一刻跑、不进全量套件（绿态很短 + override 作废认证 + 59% 纯文档 + 三层已付代价账）
status: ready
labels:
  - gap
  - defect
  - mechanism
  - delivery-critical
parent: null
children: []
extra:
  schema: execution
---

**type:** execution

## Proposal

**AC51（正本 orchestration/manager-phase-goal.md:2767 + SPEC §13：文档检查在提交那一刻跑、不进全量套件）。
今晚实测把 AC51 从「更方便」抬成「没有别的可行选项」——两条绕开路都有成本（踏空 / override 作废认证），
且 **59% 的提交是纯文档断言面**（下方实测）：**

**① 绿态很短（n=66，中位 60s）⇒ 任何以【绿】为前提的动作易踏空**：`.quay/suite-state-events.jsonl` 全量
（384 事件，08-12 03:28 → 08-13 04:48）——SUITE-GREEN → 下一 SUITE-RUNNING 间隔 **n=66，中位 60s**
（p25 40s / p75 121s / min 10s / max 488s；<120s 68%）。**它回答的不是「能不能提交」**（守卫条件是
`state==running`，红也是终态放行——`precommit-guard.ts:14/:535`），**而是「绿有多短」**——任何以【绿】为
前提的动作（如批量合的 freshness 门要求 state==green）都易踏空。

**② 守卫拦 commit 不拦 write**：跑轮读的是主检出工作树——断言面文档在**保存那一刻**就进入本轮视野，
提交与否不改变本轮所见。守卫在 commit 处拦截，拦的是一个已经发生过的风险的影子
（`gap-precommit-guard-blocks-commits-not-working-tree-edits`）。

**②' override 的代价 = 作废一轮认证（本条实证）**：`4676de07`（manager 的 SPEC 二次更正）落在 round 121
（verify `7139fc22`）轮中，用 `QUAY_ALLOW_DIRTY_ROUND=1` 提交 ⇒ 按 A15③ 冻结规则该轮须标
`treeMutatedMidRound/infra-error`——**它的绿既不能认证 7139fc22、也不覆盖 4676de07**。
override 让测试结果不受影响，但认证语义作废（manager 记账：推理只覆盖了「这轮会不会变红」，
没覆盖「这轮还算不算数」）。

```
绿态很短  ⇒  要么【踏空】（以绿为前提的动作踏空）
           ⇒  要么【override】——而 override 的代价是【作废一轮认证】
⇒ 两条路都有成本
⇒ 唯一零成本的路：让文档编辑根本不进套件断言面（AC51）
```

**三层已付代价账（今晚，全部落在文档类改动上——而文档类改动不需要跑任何测试）**：
- manager：踏空 3 次 + 作废 1 轮认证（~450s 套件 + 一次 batch-merge freshness 门 fail-closed 等待）
- outer（本层）：round 84 / 109 / 110 三次文档错误各等 8 分钟（CLAUDE.md、SPEC 新建、quay-init 闸各一次）
- ⇒ 这些是**已经付出**的代价，不是预期收益——比「反馈从 8 分钟变秒级」更有说服力。

**断言面实测覆盖（SPEC §13，枚举 `@static-object` 声明，不是推测）**：`CLAUDE.md / orchestration/ / tasks/ /
docs/proposals/ / plugin/loop/*.md` ⇒ **正是三层每天写的地方**。

**59% 纯文档 ⇒ AC51 移出去的量（近 6h 有文件变更的 39 次提交，按断言面分类，逐条枚举+打印命中）**：
```
① 纯文档断言面（AC51 能移出去） 23 (59%)  例：12a5ab0c（三个 tasks/）· 4676de07（SPEC+phase-goal）
② 文档+代码混合                13 (33%)  例：72b7b2e5 · 5652604f
③ 纯非断言面                    3 ( 8%)  例：4592b68e/2de41fab（plugin/skills/*）
```
**AC51 立论不依赖排队模型**（ρ 排队模型已撤回——守卫条件是 `state==running`，红也是终态放行，
非 running 时间 13.9 分钟/小时足以放下 8.7 次/小时，队列不发散）；**59% 是实数，就是 AC51 的收益量**。

**计量边界**：39 ≠ 52（52=提交总数，39=有文件变更，差额=merge 提交 `--name-only` 空——引用说清分母）。

## Plan（正本 SPEC §13 断言面拆分，人 2026-08-13 裁定 (b)）

1. 文档类检查下沉到 **pre-commit / 提交那一刻**跑，移出全量套件（断言面拆分）。
2. 主检出编辑断言面文档不再使任何在跑的轮变红。
3. 文档编辑不需要窗口、守卫不需要管文档——① ② ②' 全部不再是问题。

## AC

- [x] AC1: 文档类检查从全量套件移出（提交时刻跑 / pre-commit）
- [x] AC2: 负控制——故意在主检出编辑一个断言面文档，确认**不再**使任何在跑的轮变红（SPEC :475 AC42 判据 3）
- [x] AC3: 既有测试全绿；`--for-task` scoped 门绿

## Definition of Done

- [x] AC1–AC3 全部勾上
- [x] 负控制样例贴出（主检出编辑断言面文档、在跑轮不变红）
- [ ] 全量套件绿（**deferred to fan-in** —— 受零并发约束，本 worktree 不跑全量；直接相关的测试文件全部单跑绿）

## 执行记录（2026-08-13）

**改动**（AC51 断言面拆分，SPEC §13，人裁定 (b)）：
- `scripts/test.sh`：7 个文档类检查器（strategic-doc-staleness / drive-contract / threshold-scope /
  state-worded-clause / red-on-omission / tick-core-static / instrument-failure）从 `run_static_checks()`
  （全量套件闸）移出，进新的 `run_doc_checks()`（`# @static-class doc` 标注），唯一调用方是
  `scripts/test.sh --static-checks-doc`（pre-commit）。`run_static_checks` 只剩 15 个代码类检查器。
- `plugin/scripts/precommit-guard.ts`：
  - `runDocChecks()` —— 提交那一刻 shell 到 `bash scripts/test.sh --static-checks-doc`，任一文档检查
    失败 ⇒ 拒提交（reason=`doc-check-failed`，输出含文件+行号 = 补救位置 SPEC §13.4）。portability：
    test.sh 没有 `run_doc_checks`/`--static-checks-doc` 的第三方 workspace 不启用该闸。
  - `docClassFiles()` —— 从 `run_doc_checks` 的 `@static-class doc` 对象的 `.md` 文件派生「文档面」；
    `resolveAssertionSurface` 两个分支（registry / fallback-narrowed）都剔除文档面 ⇒ 断言面只剩代码类，
    编辑文档不再使在跑的轮变红（`--allow-dirty-round` 只覆盖轮窗口门，不覆盖文档检查失败）。
- `plugin/scripts/checker-mutation-check.sh`：manifest 解析 `run_static_checks` ∪ `run_doc_checks`
  （移出的文档检查器的 mutation case 仍进全量套件 —— L_S 不被削弱）。
- 测试更新：`plugin/test/precommit-guard.test.mjs` 加 5 条 AC51 用例（文档编辑在跑轮放行 / task 仍拦 /
  文档检查失败拒 / allow-dirty-round 不覆盖文档失败 / 文档失败即使被排除也拦）；`scoped-static-checks
  .test.mjs` 与 `tick-core-static-check.test.mjs` 的 wiring 断言改为 run_doc_checks / 移出 scoped。

**AC1 证据**：`awk` 枚举 —— `run_static_checks` 内文档检查器 0 个，`run_doc_checks` 内 7 个；且
`bash scripts/test.sh --static-checks-doc` 干净跑绿（~1.3s）。

**AC2 负控制（真实样例，worktree 上模拟 running 轮）**：
```
state=written-running (runId=ac51-neg-control, finishedAt=null)
staged=orchestration/manager-tick-core.md      ← 断言面文档（tick-core-static/state-worded 对象）
guard_exit=0  verdict=allow  reason=no-assertion-surface-touched  touchedAssertion=[]
（同轮下 tasks/ 文件仍拦：reason=running-round-assertion-surface）
```

**AC3 证据**（直接相关的测试文件单跑全绿）：
```
precommit-guard.test.mjs            25/25   scoped-static-checks.test.mjs  11/11
tick-core-static-check.test.mjs     14/14   checker-mutation-check.test.mjs 11/11
select-static-checks-for-touches    16/16   checker-cost.test.mjs           12/12
red-window-shared-gate.test.mjs     14/14   + 7 个文档检查器自身的测试全绿
capability-catalog --json           exit 0（无 unclassified）
scripts/test.sh --for-task gap-ac51-assertion-surface-split --allow-thin  exit 0
```

## Touches

- plugin/scripts/（文档检查下沉 pre-commit 的实现）
- scripts/test.sh（全量套件移出文档类检查）
- plugin/test/（断言面拆分相关测试更新：precommit-guard / scoped-static-checks / tick-core-static-check —— 行为变更的必然产物，anti-drift 认证）
- tasks/gap-ac51-assertion-surface-split.md（自身）
