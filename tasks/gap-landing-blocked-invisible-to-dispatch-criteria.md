---
id: gap-landing-blocked-invisible-to-dispatch-criteria
title: "LANDING-BLOCKED is invisible to dispatch criteria — ready-pool-check criterion_met=True answers 'are there >=cap mutually-disjoint candidates' (touches-conflict graph only, grep-verified: no merge/land/landing state read) and slot-refill only measures slot-release; when landing is STRUCTURALLY blocked (e.g. AC17 catch-up: task branches can't rebase because develop/integration frozen 2h at 926d771b while master has 62 commits, B pushed 105 to GitHub develop), criterion_met still reports True — 'dispatchable visible, landable invisible' = heartbeat-vs-consciousness instance; manager usage-perspective probe 2026-08-06: criterion has no basis yet still answers"
status: ready
labels:
  - gap
  - milestone-candidate
extra:
  schema: v1
---
**type:** execution

## Proposal

**落地阻塞对派发判据不可见——criterion_met=True 只测派发能力，不测落地能力。**

**【实测（管理者使用视角提问 + 外层核实，2026-08-06）】**：
- `ready-pool-check.ts` 只读 touches 冲突图（`checkTouchesPair` 互斥候选），**不读任何合并/落地状态**
  （grep 确认：merge/fan-in/landed 只出现在注释，不读真实合并状态）。
- `slot-refill.ts` 只测「槽位是否释放」（completion frees slot），不读落地是否被阻塞。
- ⇒ `criterion_met=True` 回答「有没有 ≥cap 个互斥候选可派发」，**tick 把它当流水线健康读**。
- **实例**：AC17 catch-up 时落地被结构性阻塞（任务分支 rebase 不到 develop——develop/integration
  冻结 2h 于 926d771b，master 62 提交未迁，B 又推 105 到 GitHub develop），`criterion_met` **照样报 True**。

**【性质】「只测心跳不测意识」**：派发能力可见，落地能力不可见。落地被阻塞时 criterion 无依据仍给答案——
正是管理者的升级形态：**判据在没有依据时会不会仍然给出答案**（会）。

### 选定机制

1. **新增落地可见性轴**：criterion_met 之外，加一个「landing blocked」信号——当在飞任务无法合并/
   rebase（分支基线不可达 / 冻结 / 冲突）时，即便有候选可派发也标 landing-blocked
2. 或：把「develop/integration 是否落后 master 且冻结」纳入就绪池健康报告（catch-up 未完成时明确报）

## Acceptance Criteria

- [ ] AC1: criterion_met 之外有 landing-blocked 信号——落地被阻塞时明确报（非「有候选=健康」）
- [ ] AC2: AC17 catch-up 场景可被观测——develop 落后 master 且冻结时，就绪池报 landing-blocked
- [ ] AC3: 与 gap-ready-pool-check-counts-merged（done）交叉标注——本任务是它「只测心跳」的补充
- [ ] AC4: 负控制——落地正常时 landing-blocked 不误报（不打断正常派发）

## Definition of Done

- [ ] AC1-AC4 全勾（criterion_met 之外有 landing-blocked 信号，落地被阻塞明确报；AC17 catch-up 场景可观测；与 gap-ready-pool-check-counts-merged 交叉标注；负控制落地正常不误报）
- [ ] landing-blocked 场景实测：develop 落后+冻结时就绪池报出，正常时不报
- [ ] scoped 门 `scripts/test.sh --for-task gap-landing-blocked-invisible-to-dispatch-criteria` 绿

## Touches
- tasks/gap-landing-blocked-invisible-to-dispatch-criteria.md（自身文件——self-touch，2026-08-08 内层补：缺此条不满足派发资格闸 step 4.5）

- plugin/scripts/ready-pool-check.ts（landing-blocked 信号）
- plugin/scripts/slot-refill.ts（若需）
- plugin/loop/fast-mode-loop-tick.md（就绪池健康读法：criterion + landing）
- tasks/gap-ready-pool-check-counts-merged-not-flipped-tasks-in-the-pool.md（AC3 交叉标注）

## Contract

measure   landing_blocked = `node --experimental-strip-types plugin/scripts/ready-pool-check.ts --root "$(pwd)" --json 2>&1 | grep -c 'landing-blocked\|landingBlocked'` stdout 数字段
band      landing_blocked 在落地阻塞时 >= 1（catch-up 未完成时明确报）
invoke    `grep -rn 'landing\|merge\|rebase' plugin/scripts/ready-pool-check.ts`
control   AC17 catch-up 未完成 ⇒ landing-blocked 报（AC2）；落地正常不误报（AC4）
resume    信号与就绪池接线分步提交，任一步完成即写盘

## Dispatch review

reviewer: outer
at: 2026-08-06T08:1xZ
changed: 管理者使用视角提问立案——criterion_met 只测派发候选不测落地，落地被结构阻塞时照样 True。
「只测心跳不测意识」实例。落地可见性新轴，与 AC16/AC17 并行不阻塞。
