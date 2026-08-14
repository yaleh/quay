---
id: gap-ac64-precommit-guard-clause2-retire
title: AC64 precommit-guard ② 退役（危险随 AC42 消失）+ ① 保留；立条教训留档
status: ready
labels:
  - gap
  - mechanism
parent: null
children: []
extra:
  schema: execution
depends_on:
  - gap-ac62-fan-in-ff-merge-lock-protocol
---

**type:** execution

## Proposal

**AC64（precommit-guard 两职责去向不同）判据（SPEC §6 逐字）**：`precommit-guard.ts:2-3` 做两件不相干的事：

| | 职责 | 去向 |
|---|---|---|
| ① | 文档类检查（AC51 断言面拆分，7 个 doc checker） | **保留**，且必须在 AC62 协议第 3 步被显式调用（AC63） |
| ② | 拒绝「轮 running 且触及断言面」的写入 | **退役** |

**② 退役的理由（manager 修正「重建参照系」为准确的表述）**：不是「参照系失效」，是**「它保护的危险已经不存在」**——
```
② 原本保护   suite 正在跑时别改它正在读的文件——因为当年 suite 读【共享检出】
AC42 之后    per-task suite 跑在各自 worktree，读的是 worktree 的文件副本
⇒ 改共享检出的 develop 完全不影响正在跑的 worktree suite
⇒ ② 保护的那个危险随 AC42 结构性消失（属「输入不存在」那一族）
```
**而 merge 锁保护的是【另一个、新出现的】危险**（两个 ff 同时改 develop ref）——**两者不是同一个东西** ⇒ 不是「② 换个参照系」，是「② 退役 + 新增一个不同的保护」（新增保护归 AC62）。

**⚠️ ② 的立条理由必须留档（`precommit-guard.ts:19-25` 逐字，三条支撑）**：
「round 期间零提交」的约定守不住——①约定无产物（round 60 约定后 26s 即破）②事后都难区分 ③参与方名单不可维护（inner 从不在约定里）。
**⇒ 那三条教训在新协议下仍成立**：所以 **merge 锁必须是共享的机制（钩子/文件锁），不能是「各层记得调的约定」**——这正是 ② 当初选择 pre-commit 钩子而非 commit 包装的理由。**退役时把这条写进 archive（按 AC58 落点映射形态）。**

**本任务不新建过程纪律型 AC**：负控制沿用 AC49。

## Plan

1. 按 AC58 形态把 ② 迁出（退役条款从 precommit-guard.ts 删除/标注 → archive，落点映射强制）。
2. ① 保留不动（doc 检查仍由 pre-commit 触发，且 AC62 第 3 步显式调用）。
3. 立条教训（三条支撑）随迁出留档进 archive。
4. 既有测试全绿 + `--for-task` scoped 门绿。

## Acceptance Criteria

- [x] AC1 precommit-guard ②（拒绝轮 running 且触及断言面）退役迁出（按 AC58 落点映射形态）。
- [x] AC2 ① 保留不动（doc 检查，AC51 断言面拆分 7 个 doc checker）。
- [x] AC3 立条教训留档：merge 锁必须是共享机制（钩子/文件锁），不得是「各层记得调的约定」——三条支撑（无产物/难区分/名单不可维护）写进 archive。
- [x] AC4 退役理由写准：危险随 AC42 结构性消失（per-task suite 读 worktree 副本），非「参照系失效」。
- [x] AC5 既有测试全绿；`--for-task` scoped 门绿。

## Definition of Done

- [x] ② 迁出完成：高频文件 0 正文、archive 全有家、落点映射贴删除提交（AC58 形态）。
- [x] ① 保留不动（doc 检查仍由 pre-commit 触发 + AC62 第 3 步显式调用）。
- [x] 三条立条教训（无产物/难区分/名单不可维护）随迁出留档 archive——merge 锁必须共享机制不得是约定。
- [x] 既有测试全绿、`--for-task` scoped 门绿。

## Touches

- plugin/scripts/precommit-guard.ts（② 退役 + ① 保留——按 AC58 落点映射形态）
- orchestration/archive/AC58-retired-clauses.md（退役条款落点，含三条教训）
- plugin/test/precommit-guard-retire-negative-control.test.mjs（负控制 fixture——AC64 ② 退役负控制：曾拒的 running-round 写入形状现在放行）
- tasks/gap-ac64-precommit-guard-clause2-retire.md（自身）

## Evidence

- ② 退役迁出（AC58 落点映射形态）：precommit-guard.ts 的 ② 正文（三条立条教训实证）删除，高频文件仅留指针；落点 `orchestration/archive/AC58-retired-clauses.md#R27`，注册进 `retired-clause-check.ts` REGISTRY（id R27，source `plugin/scripts/precommit-guard.ts`，markers = 约定无产物（C17）/ 参与方不完整且名单无人维护 / ③结构上不可能靠小心解决）。`retired-clause-check` 全量 GREEN：`OK — 27 entries migrated (41 unique tokens: all gone from source, all present in archive)`。
- ① 保留：precommit-guard 现为 doc-check-only —— `judge()` 只跑 `runDocChecks()`（`bash scripts/test.sh --static-checks-doc`），失败拒（reason=doc-check-failed）、通过放行；pre-commit + pre-merge-commit 钩子仍由 `--install-hook` 写入（AC63：AC62 协议第 3 步显式跑 doc 检查，ff-only 无钩子触发）。`resolveAssertionSurface` 保留供 full-suite-runner.ts mid-round-edit 检测复用。
- 三条立条教训 + 退役理由（AC42 结构性消失，非「参照系失效」）写进 archive#R27。
- 负控制 fixture：`plugin/test/precommit-guard-retire-negative-control.test.mjs` —— 曾拒的 running-round + tasks/** 提交现在放行（verdict allow）、缺失 state 放行（fail-loud 退役）、不再写拒绝台账、① 文档检查失败仍拒。
- 既有测试全绿 + scoped 门绿：`scripts/test.sh --for-task gap-ac64-precommit-guard-clause2-retire --allow-thin` exit 0，15 tests pass（precommit-guard.test.mjs 10 + 负控制 5），static checks（retired-clause-check / ac61-staleness-disposition / concurrency-literal / landing-target / delivery-inventory / capability-catalog / test-framework-policy / test-isolation 等）全 PASS。
- ts-typecheck gate：`fan-in-ts-typecheck-gate.ts` ADMITTED（无 new/moved .ts）。
- 落地 commit SHA：`4e115aa1`（本 worktree 分支 task/gap-ac64-precommit-guard-clause2-retire）
