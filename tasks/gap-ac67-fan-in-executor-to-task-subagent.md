---
id: gap-ac67-fan-in-executor-to-task-subagent
title: AC67 fan-in 的执行者必须落到任务 subagent——AC62 搬了锁没搬执行者（人追问触发）
status: todo
labels:
  - gap
  - mechanism
parent: gap-ac62-fan-in-ff-merge-lock-protocol
children: []
extra:
  schema: execution
depends_on:
  - gap-ac62-fan-in-ff-merge-lock-protocol
---

**type:** execution

## Proposal

> **止损（2026-08-14 04:1xZ，人 提活行为缺陷两义务：修机制+止损）：需要 + 当轮可做。** inner 判断「能，现在做」——无锁段（rebase + ts-typecheck + scoped + 全量 suite + doc 检查，全在任务 worktree 内）挪 subagent，ff 留主线程；不依赖 AC62（无锁段三步全由 develop 现有机件构成：git merge 内置 / fan-in-ts-typecheck-gate 在 develop / scripts/test.sh+--static-checks-doc 在 develop；fan-in-ff-merge.sh 只服务持锁段，止损不动它）。在飞任务保持现有流程不中途换执行者（避免半新半旧），**从 AC62 fan-in 起**改走 subagent 无锁段。
> **止损判据（manager 2026-08-14 04:1xZ，4b 修正——基线 phase 是自述量，换标法即同形）**：**止损生效 ⇔ 无锁段三步（`git merge develop` / 全量 suite / `--static-checks-doc`）的 Bash 调用出现在 inner 的 `subagents/agent-*.jsonl` 里，且【不再】出现在其主 `<session>.jsonl` 里。** 读法：`ls -S <session>/subagents/agent-*.jsonl` 定位 → `meta-cc inspect_session_files --files <显式路径>`（`query_session_content` 不递归 subagents，CLAUDE.md 硬规则① 已记）。**这个量不由 inner 产生，它停摆时不会跟着停止更新 ⇒ 满足 4b**（基线 phase 由 inner 自写，止损做了/只是改标法在此量上同形——循环论证，作废）。**且它是 AC67 判据2 的现成弱化落点**：判据2 要「ff 记录加 agent 标识 ≠ 主会话」，止损版用「无锁段 agent 标识 ≠ 主会话」的同一判据弱化形式，不需要等 `fan-in-ff-merge.sh`（无锁段本就不经过它）。基线（manager）：近 40 轮 fan-in 族 68% / 全历史 27%（此基线仅参考，不作判据——判据是 transcript 落点）。

**AC67（fan-in 的【执行者】必须落到任务 subagent —— AC62 搬了锁，没搬执行者；人 2026-08-14 03:5xZ 追问「inner 任务 subagent 自行 merge 什么时候才能发生」）判据（phase-goal 逐字）**：

**发现经过**：人问「outer 和 inner 仍然在用 fan-in 这样的描述，我们期望的 subagent 自行 merge 什么时候发生」。manager 原以为答案是「AC62 落地那一刻」，核了才知道不是——**AC62 交付的是协议形态，不是执行者位置**。

**证据（三条，位置判定）**：
```
① AC62 五条判据 grep -c 'subagent' = 0（零计数已按硬规则②另一半干跑验证谓词有效：CLAUDE.md=6 / fast-mode-tick-core.md=3 ⇒ 真零）
   五条分别是：协议本体 / 能取假 / 重试记录 / 两锁不交叉 / 测试绿 —— 【没有一条约束"谁执行"】
② A6 改写后主语仍是「Fan-in 已返回任务」，动作形态 `git -C <wt>`、`<本会话在飞集合>`
   ⇒ 主线程【从外面】操作别人的 worktree，且任务【已经先返回了】
③ inner 自报 2026-08-14：「Waiting on cert monitors to drive fan-in per A6」⇒ 主线程等 suite，等完自己做 fan-in
```
**而人的裁定原文主语是 subagent**：「**每个 subagent 应在 merge 前**把 develop 最新变更 merge 回自己的 worktree 并执行 suite 测试」（SPEC-fan-in-ff-merge-lock-2026-08-14 §0 逐字）。**⇒ AC62 落地不会让它发生。缺的是这一条。**

**⚠️ 一般形态（值得单记）**：**一个协议可以被完整实现，而它要解决的那个问题原封不动**——协议描述的是【动作序列】，问题出在【谁执行这个序列】，而判据只查了序列。同族于 FAMILY「字面为真且恒真」，但更隐蔽：这里判据不恒真、能取假、也确实红过绿过，**只是它测的维度与目标的维度正交**。⇒ **写判据时要问的不只是"它能取假吗"，还有"它取假的那个维度是目标维度吗"。**

- **判据1（执行者的位置）**：无锁段 ①②③ + 持锁段 ④ **全部在任务 subagent 自己的回合内完成**，**subagent 在 ff 成功之后才返回**；inner 主线程的 A6 上**不再有任何 merge 动作** ⇒ A6 的主语从「Fan-in 已返回任务」改掉，`git -C <wt>` 形态消失（subagent 在自己树里直接 `git merge`）。
- **判据2（能取假·产物是本来就要写的东西）**：`fan-in-ff-merge.sh` 已被 AC62 判据3 要求写记录（任务 id/第几次/develop 头/时刻/runId）⇒ **该记录加一个调用方 agent 标识字段**，**判据 = 该标识 ≠ inner 主会话**。**不是新增打卡动作**，是给一条已经必写的记录加一列（同 AC66 判据2 的 A22 样板）。
- **判据3（能取假·用真样本，不构造）**：**现行 A6 每一次主线程 fan-in 都是现成的真实缺席样本**（近 6 小时 4 次 merge，SPEC §8 实测）⇒ **回放其中任一次必须报红**。合 D2。
- **⚠️ 不覆盖**：不改 AC62 已落的协议本体（无锁段/持锁段/ff-only/两锁不交叉全部照旧）；不引入队列/优先级/让步（活锁仍观察项，触发写死同任务 ff 失败 ≥3 次）；不要求 subagent 承担 needs-human 之外的路由判断。

**依赖 AC62 落地**（协议先在，才谈交给谁执行）。

**本任务不新建过程纪律型 AC**：负控制沿用 AC49。

## Plan

1. 读 SPEC §0 裁定原文 + AC62 已落协议 + 现行 A6（fast-mode-tick-core.md）。
2. 判据1：无锁段①②③+持锁段④ 全移到任务 subagent 自己回合内，ff 成功后才返回；A6 主语改掉、`git -C <wt>` 形态消失。
3. 判据2：`fan-in-ff-merge.sh` 的 ff 记录加调用方 agent 标识字段，判据=标识 ≠ inner 主会话。
4. 判据3：现行 A6 主线程 fan-in（近 6h 4 次）回放任一次必须报红（真样本，D2）。
5. 既有测试全绿 + `--for-task` scoped 门绿。

## Acceptance Criteria

- [ ] AC1 判据1：无锁段①②③+持锁段④ 全在任务 subagent 自己回合内，ff 成功后才返回；A6 主语改掉、`git -C <wt>` 形态消失。
- [ ] AC2 判据2：fan-in-ff-merge 记录加调用方 agent 标识字段，判据=标识 ≠ inner 主会话（非新增打卡）。
- [ ] AC3 判据3 能取假：现行 A6 主线程 fan-in（近 6h 4 次）回放任一次必须报红——真样本不构造（D2）。
- [ ] AC4 不改 AC62 协议本体（无锁段/持锁段/ff-only/两锁不交叉照旧）；不引入队列/让步。
- [ ] AC5 既有测试全绿；`--for-task` scoped 门绿。

## Definition of Done

- [ ] fan-in 执行者落到任务 subagent（ff 成功后才返回）+ agent 标识记录 + 主线程 fan-in 真样本回放红。
- [ ] 接线 + 既有测试绿。

## Touches

- orchestration/fast-mode-tick-core.md（A6 主语改掉、`git -C <wt>` 形态消失——C17 外层落盘）
- plugin/scripts/fan-in-ff-merge.sh（ff 记录加 agent 标识字段——AC62 已建的脚本）
- （检查器 + 主线程 fan-in 真样本回放 fixture）
- tasks/gap-ac67-fan-in-executor-to-task-subagent.md（自身）

## Evidence

（落地后回填）
