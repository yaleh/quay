---
id: gap-goal-merge-infra-red-mislabelled-and-rerequest-never-retries
title: goal 并入的非冲突失败被标成 merge-conflict，且 tip
  未变时人重发请求也不会被重试——基础设施红之后请求永久卡死（GOAL-904 演练读到）
status: done
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: execution
depends_on:
  - gap-goal-branch-worktrees-lack-node-modules
goal_ac: AC-325
---
## Proposal

**机制**（同一次演练读到，`goal-merge-result` 事件与 `packages/quay/src/goal-merge.ts:359-380` `pendingGoalMerges`）：

1. **红的标签说谎**：`runGoalMergeFanIn`（`plugin/scripts/worker-fan-in.ts`）在 `git merge --no-ff` 失败时一律写 `step: "merge-conflict"`。GOAL-904 那次的真因是 pre-merge-commit 钩子因缺依赖崩了（reason 里是 `ERR_MODULE_NOT_FOUND … Not committing merge; use 'git commit' to complete the merge.`），不是内容冲突——读 `step` 的人（和下游 gap-filing）会被误导去找冲突（硬规则 3b：读不懂的失败不得与已知成因同形）。
2. **重发请求不会被重试**：`pendingGoalMerges` 只比较「上次结果的 tip」（`:376` `prev.tipSha === tipSha ⇒ 不重试`），与请求事件无关。并入因**基础设施**原因红了（tip 不会前进去「修复」）之后，人再发一次 `quay goal merge` 记录了新的请求事件，却仍被这一行压住——请求永久卡死，只有 goal 分支前进才能解。裁定⑳ 只说「tip 前进后自动重试」，没有说「人明确再请求也不重试」。

**修法（方向，实现者可调）**：
1. 并入失败按原因分类写入 `step`：内容冲突（`git merge` 退出码 1 且工作树有未合并路径）保持 `merge-conflict`；其它（钩子失败、spawn 失败等）用独立取值（如 `merge-failed`），`reason` 保留原文。
2. 一条**晚于最近一次结果**的请求事件视为人的显式重试：即使 tip 未变也进入待执行。⛔ 不改自动重试规则（tip 没前进且没有新请求 ⇒ 仍不重跑，同一棵树重跑全量 suite 只是在赌偶发）。

## AC

- [x] `packages/quay/test/goal-merge.test.mjs` 新增用例：构造「有请求 + 最近一次结果为 red + tip 未变」的账本——无新请求时 `pendingGoalMerges` 不含该 goal；其后追加一条时间更晚的请求事件，`pendingGoalMerges` 含该 goal；tip 前进时（无新请求）仍含该 goal（既有规则不变）。
- [x] `plugin/test/worker-driver.test.mjs` 新增两臂用例（临时仓库）：① 真实内容冲突的并入，结果 `step` 为 `merge-conflict`；② 并入被一个失败的 pre-merge-commit 钩子中止（非冲突），结果 `step` 不是 `merge-conflict`，且 `reason` 含钩子的原始输出。
- [x] 取假：把本任务的核心改动临时回退（用 `cp` 备份恢复，⛔ 不用 `git checkout --`）后，上面新增用例至少 1 条变红；在 `## Evidence` 贴实跑输出与恢复后的绿输出。
- [x] `node --test packages/quay/test/goal-merge.test.mjs plugin/test/worker-driver.test.mjs` 退出 0。
- [x] 5b 邻近扫描：在 `plugin/scripts/worker-fan-in.ts` 内 grep 其它把多种失败折成同一个 `step` 取值的 `red(` 调用点，把命中数与前 3 条贴进 Evidence，逐条判断是否同样会误标；需要且在 Touches 内的一并改。

## Evidence

**AC3 取假**（`cp` 备份核心改动 → 回退 → 新增用例变红 → `cp` 恢复 → 变绿；⛔ 全程未用 `git checkout --`）：

回退后（红）——两条新增用例各断言各自的修复点：
```
✖ pendingGoalMerges: a red result at a frozen tip does NOT retry, but a request NEWER than that result does (explicit human retry)
  AssertionError [ERR_ASSERTION]: a request newer than the last red result is an explicit retry
✖ goal-merge e2e — 失败分类两臂：真实内容冲突写 merge-conflict；pre-merge-commit 钩子失败写 merge-failed 且 reason 带钩子原文
  AssertionError [ERR_ASSERTION]: 钩子失败不得被标成内容冲突（实测 step=merge-conflict）
```

`cp` 恢复后（绿；两源文件 `git diff` 为空 = 与已提交修复逐字一致）：
- `node --test packages/quay/test/goal-merge.test.mjs` → tests 10 / pass 10 / fail 0
- `node --test --test-name-pattern="goal-merge e2e" plugin/test/worker-driver.test.mjs` → tests 5 / pass 5 / fail 0（含新增两臂）

**AC4**：`node --test packages/quay/test/goal-merge.test.mjs plugin/test/worker-driver.test.mjs` → `EXIT=0`，`tests 130 / pass 130 / fail 0`（输出存档 `.quay/ac-verify/ac4-full-run.txt`）。

**AC5 5b 邻近扫描**：`grep -n 'red("' plugin/scripts/worker-fan-in.ts` 命中 **12** 条（修复点现写作 `red(step, …)`，故不再计入；修前为 13）。前 3 条：
```
2367:    return red("spawn-mechanical-fan-in", r.error?.message ?? …);
2378:  return red("parse-mechanical-fan-in", `unparseable fresh mechanical fan-in output: …`, r.status);
2539:      return red("acquire-goal-lock", (e as Error)?.message ?? String(e));
```
逐条判断：12 个取值各出现 1 次，且**全部命名的是【步骤】而非【成因】**（spawn/parse-mechanical-fan-in、acquire-goal-lock / acquire-develop-lock、read-develop、worktree-add、merge-commit、anti-drift、typecheck、suite、ff、exception）——它们不声称某个已知成因，故不会像 `merge-conflict` 那样把成因说错。唯一"折多种成因"的是 `2621: red("exception", …)` 的 catch-all，但其名只声称"抛出了异常"、且原文保留在 `reason`，不构成误标。结论：**误标点唯一（即本任务所修），其余无需改**。

## DoD

真实落地判据：落地之后，goal 并入因非冲突原因红时，`goal-merge-result.step` 不再写 `merge-conflict`；人对一个卡在红上的 goal 再发一次 `quay goal merge`，worker-driver 在下一轮重新执行它。生产读数由 GOAL-028 的 AC-325 在 GOAL-904 演练的并入完成后取得（需人对 GOAL-904 再发一次请求）。

## Touches

- plugin/scripts/worker-fan-in.ts
- packages/quay/src/goal-merge.ts
- plugin/test/worker-driver.test.mjs
- packages/quay/test/goal-merge.test.mjs
- tasks/gap-goal-merge-infra-red-mislabelled-and-rerequest-never-retries.md