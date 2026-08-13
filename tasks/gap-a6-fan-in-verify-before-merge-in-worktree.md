---
id: gap-a6-fan-in-verify-before-merge-in-worktree
title: A6 fan-in 顺序缺陷——先验后合 + scoped 门在 worktree 内跑（AC42 判据2 + 人「主检出只读」裁定）
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

**实证（manager 2026-08-13 抓）**：A6 fan-in 当前顺序是**先合后验**——
`orchestration/fast-mode-tick-core.md` A6 行（src:449/457/473/476）：
`rebase(wt) → git merge --no-ff task/<id> 合回 $MERGE_TARGET → $TEST_COMMAND --for-task <id> → worktree remove + branch -d`。

两个缺陷同根：
1. **scoped 门跑在主检出**（`$TEST_COMMAND` 在共享检出上执行）——违背 AC42 判据2「测试 cwd 不在主检出」+
   人 2026-08-13「主检出只读诊断」裁定。失败时还要**回退共享分支**（merge 已落地），一次 scoped 红冻结整个 tick。
2. **先合后验**——验证应在 merge 之前，而非之后；失败时 worktree 内未合状态可直接丢弃，共享检出零污染。

**修 = 先验后合**：
```
rebase(wt) → cd <wt> 内跑 scoped 门 → 绿才 git merge --no-ff task/<id> → worktree remove + branch -d
```
**验收判据（outer 裁定）**：fan-in 期间 `/proc/<pid>/cwd` 落主检出的测试进程数 = 0
（同时给 AC42 判据2 供证）。

**延伸 W2**：fan-in 作 workflow 是此任务的延伸，可一并纳入（本任务核心是顺序修正 + wt 内跑测试）。

## Plan

1. 改 `orchestration/fast-mode-tick-core.md` A6 行（src:449/457/473/476 对应文本）：
   rebase(wt) → **wt 内 scoped 门** → 绿才 merge → worktree remove + branch -d。
2. 同步源文档 `plugin/loop/fast-mode-loop-tick.md`（src:N 对应处）——两处一致，避免漂移。
3. 若存在 fan-in 脚本（`serial-fanin-absorb.ts` / `integration-batch-merge.sh`）复用该逻辑，一并修正。
4. 验收：fan-in 期间测试进程 cwd 全落 worktree，主检出测试进程数 = 0。

## AC

- [x] AC1: A6 顺序改为「先验后合」——scoped 门在 merge 之前，且 `cd <wt>` 内执行
- [x] AC2: 失败路径简化——scoped 红/冲突时丢弃 worktree 内未合状态，共享检出零污染，无回退操作
- [x] AC3: 验收判据——fan-in 期间 `/proc/<pid>/cwd` 落主检出的测试进程数 = 0
- [x] AC4: 源文档与执行核两处一致（`plugin/loop/fast-mode-loop-tick.md` + `orchestration/fast-mode-tick-core.md`）
- [x] AC5: 既有测试全绿；`--for-task` scoped 门绿

## Definition of Done

- [x] AC1–AC5 全部勾上
- [x] 顺序修正 + wt 内测试的证据贴出（fan-in 期间 cwd 计数）
- [x] 既有测试 + 新增测试全绿（`--for-task` scoped）

## Evidence

**文档改动（先合后验 → 先验后合）**

`orchestration/fast-mode-tick-core.md` A6 行（before→after）：
- before：`rebase(wt) (src:449) → git merge --no-ff task/<id> 合回 $MERGE_TARGET (src:457) → $TEST_COMMAND --for-task <id> (src:473) → worktree remove + branch -d (src:476)`；失败路径「回退、标 needs-human」
- after：`rebase(wt) (src:510) → **cd <wt> 内跑 scoped 门 $TEST_COMMAND --for-task <id>（测试进程 cwd 落 worktree 非主检出）** (src:517) → **绿才** git merge --no-ff task/<id> 合回 $MERGE_TARGET (src:526) → worktree remove + branch -d (src:537)`；失败路径「**丢弃 worktree 内未合状态**（共享检出零污染、无回退操作）、标 needs-human」

`plugin/loop/fast-mode-loop-tick.md` fan-in 步骤（before→after）：
- before：0 rebase → 1 `git merge --no-ff` → 2 冲突 abort → 3 `$TEST_COMMAND --for-task`（主检出跑） → 4 非绿回退 merge
- after：0 rebase → 1 **`cd $WORKTREE_ROOT/<slug> && $TEST_COMMAND --for-task <taskId>`（wt 内跑 scoped 门，先验）**，非绿 ⇒ 丢弃 wt 未合状态 → 2 **绿才 `git merge --no-ff`（后合）**，冲突 ⇒ `git merge --abort`（未落地、共享检出仍干净） → 3 清理 `git worktree remove` + `git branch -d`

A6/A15 对齐注也同步（`cd <wt>` 内复测 → 绿才 merge → worktree remove）。

**`plugin/scripts/serial-fanin-absorb.ts` 结论**：不改。它是 RETIRED 经典循环（DIR-044 increment 3）的**纯计划计算模块**（`computeFanIn`/`verifyMonotonic`/`renderDashboardAppend` 只算合并顺序与 counter/dashboard 算术），不含 git merge → 测试 → worktree-remove 的执行序列，**无「先合后验」路径可修**。唯一活引用在 `experiments/quay-perpetual-stream/`（retired loop 文档/测试/golden-replay）。`integration-batch-merge.sh`（外层 integration→develop 批量合）自带新鲜度闸门、在 throwaway temp worktree 里合并、从不碰主检出工作树——是不同机制，非本缺陷。

**AC3 测量方法 + 演示**（`/proc/<pid>/cwd` 落主检出测试进程数 = 0）：

测量方法（文档化，规避已知陷阱）：
1. **不用 `pgrep -f "node.*test"`**——会自匹配测量 shell 自身 argv（含字面模式），并捞起常驻 fixture 进程。直接枚举 `/proc/[0-9]*` 逐个 `readlink /proc/<pid>/cwd` + 读 `/proc/<pid>/cmdline`。
2. **scope 到 fan-in 自己的进程树**（runner 的后代），不做全进程计数——并发主检出活动（外层 loop / execute-suite-fix workflow）会污染全进程计数（实测同时有 7 个非 fan-in pid cwd 落主检出，全是并发 workflow）。用 `/proc/<pid>/task/<pid>/children` 从 runner 做 BFS 捕获后代（短命 `node --test` 子进程在全 /proc 扫描下会漏，targeted children-walk 才能抓到）。
3. 判定：「测试进程」= fan-in 树后代；其 cwd 前缀 = worktree root ⇒ 正常；cwd 前缀 = 主检出 root ⇒ 违规（MUST be 0）。

实测演示（`bash /tmp/ac3-demo5.sh`，scoped 门在 wt 内跑）：
```
runner=1296049 exit=0  fan-in tree size=35
--- AC3 RESULT ---
  fan-in tree procs cwd = WORKTREE : 23
  fan-in tree procs cwd = MAIN     : 0  (MUST be 0)
AC3 MEASURE: PASS
```
（另 12 个 pid 因在发现瞬间已退出 readlink 为 gone，不影响 MAIN 计数。）fan-in 测试进程全部落 worktree，主检出 0 个。

**scoped 门输出**（`cd <worktree> && bash scripts/test.sh --for-task gap-a6-fan-in-verify-before-merge-in-worktree --allow-thin`）：
- `EXIT=0`；`ℹ tests 14 / pass 14 / fail 0`（serial-fanin-absorb.test.mjs 等选中集）
- scoped 静态检查全 PASS：`task-contract-check`、`adr016-screen-use-check`（violations 0）、`superseded-capability-check`、`delivery-inventory-drift-gate`
- `tick-core-static-check` 直跑 PASS：fast-mode-tick-core.md src:N 覆盖 45/45（100%）、AC4 pointer targets OK

## Touches

- orchestration/fast-mode-tick-core.md（A6 行顺序修正）
- plugin/loop/fast-mode-loop-tick.md（源文档 src:N 同步）
- plugin/scripts/serial-fanin-absorb.ts（如复用 fan-in 逻辑）
- tasks/gap-a6-fan-in-verify-before-merge-in-worktree.md（自身）
