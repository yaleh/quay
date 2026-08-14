---
id: gap-ac62-fan-in-ff-merge-lock-protocol
title: AC62 协议本体——fan-in 改 ff-only + 独立 merge 锁（锁只包 ff、持锁期间唯一动作是 ff）
status: ready
labels:
  - gap
  - mechanism
parent: null
children:
  - gap-ac63-ff-explicit-doc-check-before-merge
  - gap-ac64-precommit-guard-clause2-retire
extra:
  schema: execution
depends_on: []
---

**type:** execution

## Proposal

**人 2026-08-14 02:2xZ 裁定（SPEC-fan-in-ff-merge-lock-2026-08-14，74e28bcc 入本阶段）**：inner 的 A6 fan-in 目前整段在主会话串行（`fast-mode-tick-core.md:25` 明文「串行」），其中只有最后一步真正需要串行。改为：

```
无锁段（全部在自己的 worktree 内，不碰共享检出）
  1. git merge develop            ← 冲突【只可能在这里】出现，慢慢解，不占任何人
  2. 跑全量 suite                 ← 绿才继续
  3. 跑 doc 检查                  ← 补 ff 不触发任何钩子的缺口（AC63）
持锁段
  4. git merge --ff-only          ← 唯一允许的动作
解锁（成功或失败都立即释放）
  失败 ⇒ 回第 1 步，并写一条重试记录（AC62 判据 ②）
```

**AC62 判据（SPEC 逐字）**：
- 判据1（协议本体）：fan-in 落地 = 「无锁段自测（merge develop + 全量 suite + doc 检查）+ 锁内 `git merge --ff-only`」；**锁只包 ff**（持锁时长毫秒级），持锁期间禁一切其它动作。
- 判据2（能取假）：develop 上出现**非 ff** 的 fan-in merge ⇒ 红；持锁段内出现 suite 调用 ⇒ 红。
- 判据3（失败路径）：ff 失败 ⇒ 写重试记录（任务 id / 第几次 / 当时 develop 头 / 时刻）。
- 判据4（活锁）：不预造机制；触发条件写死「同一任务 ff 失败 ≥3 次」才谈防活锁——届时才有真实重试分布。
- ⚠️ 锁覆盖范围不得与 suite 锁交叉（suite 锁覆盖第 2 步、merge 锁覆盖第 4 步，时间不重叠、对象不相干——人要求「两把锁覆盖范围不得交叉」天然成立）。

**关键性质（为什么 ff-only 是安全的，不依赖锁正确性）**：
A 从 develop@X 建树 → merge develop@X → 跑绿；期间 B 先 ff 上去 develop 变 Y；A 去 ff ⇒ 失败（tip 不含 Y）⇒ A 绝不可能把「未与 Y 一起测过」的状态推上去。**ff 失败原因唯一（develop 前进了）、处置唯一（回第 1 步重跑），无「ff 冲突」这种情况 ⇒ 不需要 needs-human 路径。**

**本任务不新建过程纪律型 AC**：负控制沿用 AC49。

## Plan

1. 读 SPEC §1-§4 + 现有 A6（fast-mode-tick-core.md:25）+ suite 锁（full-suite.lock.0/.1）。
2. 实现协议：无锁段（merge develop + suite + doc 检查）+ 持锁段（ff-only）。
3. 实现独立 merge 锁（锁只包 ff，毫秒级；覆盖范围与 suite 锁不交叉）。
4. 失败路径：重试记录（任务 id/第几次/develop 头/时刻）。
5. 检查器/负控制：非 ff 的 fan-in merge ⇒ 红；持锁段内 suite 调用 ⇒ 红。
6. 既有测试全绿 + `--for-task` scoped 门绿。

## Acceptance Criteria

- [ ] AC1 协议本体落地：fan-in = 无锁段自测（merge develop + 全量 suite + doc 检查）+ 锁内 `git merge --ff-only`；锁只包 ff、持锁期间唯一动作是 ff。
- [ ] AC2 能取假：develop 上非 ff 的 fan-in merge ⇒ 红；持锁段内 suite 调用 ⇒ 红。
- [ ] AC3 失败路径：ff 失败写重试记录（任务 id/第几次/当时 develop 头/时刻）。
- [ ] AC4 锁覆盖范围不与 suite 锁交叉（时间不重叠、对象不相干）。
- [ ] AC5 既有测试全绿；`--for-task` scoped 门绿。

## Definition of Done

- [ ] 协议落地 + 两把锁互斥 + ff-only 机械强制（非 ff ⇒ 红）。
- [ ] 重试记录 + 既有测试绿。

## Touches

- orchestration/fast-mode-tick-core.md（A6 改为新协议——inner 执行核）
- plugin/scripts/integration-batch-merge.sh（若承载批量合——按 SPEC 不覆盖清单核对）
- （merge 锁实现 + 检查器 + 负控制 fixture）
- tasks/gap-ac62-fan-in-ff-merge-lock-protocol.md（自身）

## Evidence

（落地后回填）
