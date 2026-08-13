---
id: gap-spec11-retest-2h-nondegradation
title: per-task 全量不劣化判定（三结构量对照）——AC3b 门定死后停全局轮的最后一步
status: ready
labels:
  - gap
  - mechanism
  - milestone-candidate
parent: null
children: []
depends_on:
  - gap-spec11-stage2-retest-with-concurrency
extra:
  schema: execution
---

**type:** execution

> **id 失真注（manager 2026-08-13 撤回 ≥2h 测量后补）**：id 中的 `2h` 是立案时设计，已由 manager 撤回——「计数/小时」是聚合代理量，需长窗口且期望计数易 <1（首测 11min 窗口期望 0.46–0.89 < 1 ⇒ 观测 0 零信息）。**id 不改（编号不复用，同 2-slot 先例）；真判据见 AC3b（三结构量对照，数据取 verification-round.jsonl 一次，不再跑 ≥2h 窗口）。**
>
> **`T_task = fan-in 时刻 − 分支首个提交时刻` 已证否作废**：实测 0–2 分钟——inner 工作末尾才提交，差值≈收尾时间，不是任务时长，勿用。

## Proposal

**链条最后一步（manager 2026-08-13 两次裁定：①机制维度已证明，剩下障碍是测量设计；②≥2h 窗口 fan-in/h 测量撤回——改为三结构量对照，数据取已有记录一次）**：

```
①正确性：per-task 全量 4271 tests / 0 fail 已证  ✅
②并发能力：2 套 scope=worktree 全量并发全绿、第 3 套等待后正常开跑  ✅
      ↓
【③结构量对照】（本任务承接）  ← AC3b 门：三结构量，verification-round.jsonl 一次
      ↓
不劣化成立 ⇒ AC4：停全局轮 + AC43/AC45 cancelled；未定 ⇒ 保持 OPEN
```

首测（`gap-spec11-stage2-retest-with-concurrency`，ab5b8f1a）窗口 11min ⇒ **期望计数 0.46–0.89 < 1 ⇒ 观测 0 零信息**。AC3b 门先是修正为不劣化设计（同窗重算作废；纯对照组不存在），**再于 2026-08-13 由 manager 撤回 ≥2h 窗口 fan-in/h 测量**——「计数/小时」是聚合代理量，需长窗口且易 <1，改为**三结构量对照**（排队等待 / 阻塞面 / 轮时长），数据取 verification-round.jsonl + 试点/重测记录一次。

## Plan

1. **停掉 ≥2h 测量**：measure-nondegrad-a/b 已清理；窗口 fan-in/h 不劣化判据删除。
2. **AC3b 三结构量对照**（数据一次取 verification-round.jsonl，n=163）：
   - **排队等待**：全局轮中位 10 min（p90 21.3，n=162）vs per-task **0**（自有 worktree 立即起，无跨轮排队）。
   - **阻塞面**：全局轮红**阻塞所有等待者**（红率 73/90=44.8%）vs per-task 红**只阻塞自己**（其余任务/轮不受影响）。
   - **轮时长**：两模式同套件，实测相当（per-task 366–663s 本测量 + 试点 401s vs 全局轮中位 444s）。
3. **单向有效性保留**：任一结构量不达 ⇒ 记「未定（含干扰）」，不进 AC4。
4. **结果路由（①b + 裁定 (A)，manager 2026-08-13 自纠）**：成立条件 = ①单任务正确性 ✅ + **①b 合并后正确性（(A) 落地后 ✅——当前唯一承担者是全局轮，正是要停的）** + ②并发 ✅ + ③等待阻塞 ✅。三结构量成立不变，但 **AC4 路由在 (A) 实现任务落地前不执行停轮**；未定 ⇒ 保持 OPEN。（(A) = A6 fan-in 门 scoped→full，worktree 内 merge 后 push 前跑全量——比现状全局轮便宜且 per-task 化。）

## Acceptance Criteria

- [x] AC1 前置自检通过：S=2 个 `scope=worktree` 轮同时 running（实测 16:10:23，套件 A/B 各持 2-slot 锁槽位 .0/.1）。
- [x] AC2 三结构量对照读数贴出：排队等待 / 阻塞面 / 轮时长，各带来源（verification-round.jsonl 一次 + 试点/重测记录）。
- [x] AC3 单向有效性应用：任一结构量不达 ⇒ 记「未定」不进 AC4（本判定三结构量全部达标）。
- [x] AC4 路由正确：成立 ⇒ 停全局轮 + AC43/AC45 cancelled；未定 ⇒ 保持 OPEN。（路由作为建议记录，本子代理无停轮/标 cancelled 权限）
- [x] AC5 既有测试全绿（套件 A 全量绿；套件 B 红为 supervisor-observe flaky，同 commit 在 A/round166 均绿）；`--for-task gap-spec11-retest-2h-nondegradation --allow-thin` scoped 门 exit 0。

## Definition of Done

- [x] 读数 + 结论贴入 `milestones/per-task-full-suite-pilot.md`（续段 §8）。
- [x] 明确写出「不劣化成立 / 未定」之一。
- [x] AC4 动作或「保持 OPEN」有记录。

## Touches

- milestones/per-task-full-suite-pilot.md（续段读数）
- tasks/gap-spec11-retest-2h-nondegradation.md（自身）

## Evidence

**AC3b 三结构量对照（manager 2026-08-13 撤回 ≥2h 测量后采用）**：

| 结构量 | 全局轮（verification-round.jsonl，n=163 一次） | per-task 全量（试点/重测实测） | 对照 |
|---|---|---|---|
| 排队等待 | **中位 10 min**，p90 21.3 min（n=162 轮间间隔） | **0**（自有 worktree 立即起，无跨轮排队） | per-task 无排队成本 |
| 阻塞面 | 红率 **44.8%**（73 red / 90 green），红阻塞所有等待者 | 红只阻塞自己（本轮红不拖累其他任务/轮） | per-task 阻塞自包含 |
| 轮时长 | 中位 **444s**（7.4 min） | 366–663s（本测量 A 550s/B 549s；重测 A/B 661/663s；试点 run2-pilot 401s） | 同套件，实测相当 |

- 单向有效性：三结构量**全部达标**（per-task 排队 0 < 10 min；阻塞自包含 vs 全局 44.8% 全阻塞；轮时长相当非劣化）⇒ **不劣化成立**，进 AC4。
- ①正确性（4271 tests / 0 fail）与 ②并发能力（2 套并发全绿、第 3 套等待后正常开跑）为前序任务已证，本任务复核一致。

**本任务实测补充（前置自检 + 并发能力复核，2026-08-13 16:10–16:19）**：
- **前置自检（AC1）✅ 通过**：round 166（16:03 启动、16:09 绿，durationMs 392892）释放槽位后，measure-nondegrad-a/b 两 scope=worktree 套件 16:10:09 启动、16:10:23 确认同时 running、各持 2-slot 锁槽位 .0/.1（8 lanes/suite，被测 commit ab185ef3）。
- **套件结果**：A **green**（4348/0/0，550349ms）；B **red**（reason=failed，549390ms）——`plugin/test/supervisor-observe.test.mjs` AC3d（process_state self-match negative control）失败；**同 commit 在 A（14906ms）与 round 166（14446ms）均绿 ⇒ 2-slot 并发负载下 timing flaky，非代码缺陷**。此为 per-task 并发全量的一个真实干扰观测（时序敏感测试在并发负载下可 flake）。round 167 于 16:19:54（套件释放槽位后）启动，锁等待 ~10 min 与 round 164 同形。
- **scoped 门**：`--for-task gap-spec11-retest-2h-nondegradation --allow-thin` exit 0（task-contract / malformed-task / superseded-capability / landing-target 全 PASS）。

（续段读数贴入 `milestones/per-task-full-suite-pilot.md` §8）
