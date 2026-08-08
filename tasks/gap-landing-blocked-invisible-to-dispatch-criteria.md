---
id: gap-landing-blocked-invisible-to-dispatch-criteria
title: "LANDING-BLOCKED is invisible to dispatch criteria — ready-pool-check criterion_met=True answers 'are there >=cap mutually-disjoint candidates' (touches-conflict graph only, grep-verified: no merge/land/landing state read) and slot-refill only measures slot-release; when landing is STRUCTURALLY blocked (e.g. AC17 catch-up: task branches can't rebase because develop/integration frozen 2h at 926d771b while master has 62 commits, B pushed 105 to GitHub develop), criterion_met still reports True — 'dispatchable visible, landable invisible' = heartbeat-vs-consciousness instance; manager usage-perspective probe 2026-08-06: criterion has no basis yet still answers"
status: done
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

- [x] AC1: criterion_met 之外有 landing-blocked 信号——落地被阻塞时明确报（非「有候选=健康」）
- [x] AC2: AC17 catch-up 场景可被观测——develop 落后 master 且冻结时，就绪池报 landing-blocked
- [x] AC3: 与 gap-ready-pool-check-counts-merged（done）交叉标注——本任务是它「只测心跳」的补充
- [x] AC4: 负控制——落地正常时 landing-blocked 不误报（不打断正常派发）

## Definition of Done

- [x] AC1-AC4 全勾（criterion_met 之外有 landing-blocked 信号，落地被阻塞明确报；AC17 catch-up 场景可观测；与 gap-ready-pool-check-counts-merged 交叉标注；负控制落地正常不误报）
- [x] landing-blocked 场景实测：develop 落后+冻结时就绪池报出，正常时不报
- [x] scoped 门 `scripts/test.sh --for-task gap-landing-blocked-invisible-to-dispatch-criteria` 绿

## Definition of Done

- [ ] AC1-AC4 全勾（criterion_met 之外有 landing-blocked 信号，落地被阻塞明确报；AC17 catch-up 场景可观测；与 gap-ready-pool-check-counts-merged 交叉标注；负控制落地正常不误报）
- [ ] landing-blocked 场景实测：develop 落后+冻结时就绪池报出，正常时不报
- [ ] scoped 门 `scripts/test.sh --for-task gap-landing-blocked-invisible-to-dispatch-criteria` 绿

## Touches
- tasks/gap-landing-blocked-invisible-to-dispatch-criteria.md（自身文件——self-touch，2026-08-08 内层补：缺此条不满足派发资格闸 step 4.5）

- tasks/gap-landing-blocked-invisible-to-dispatch-criteria.md（自身文件——self-touch，2026-08-08 内层补：缺此条不满足派发资格闸 step 4.5）
- plugin/scripts/ready-pool-check.ts（landing-blocked 信号）
- plugin/scripts/slot-refill.ts（若需）
- plugin/loop/fast-mode-loop-tick.md（就绪池健康读法：criterion + landing）
- tasks/gap-ready-pool-check-counts-merged-not-flipped-tasks-in-the-pool.md（AC3 交叉标注）

## Contract

measure   landing_blocked = `node --experimental-strip-types plugin/scripts/ready-pool-check.ts --root "$(pwd)" --json 2>&1 | grep -c 'landing-blocked ('` stdout 数字段
band      landing_blocked 在落地阻塞时 >= 1（catch-up 未完成时明确报）
invoke    `grep -rn 'landing\|merge\|rebase' plugin/scripts/ready-pool-check.ts`
control   AC17 catch-up 未完成 ⇒ landing-blocked 报（AC2）；落地正常不误报（AC4）
resume    信号与就绪池接线分步提交，任一步完成即写盘

## Evidence

**实现（AC1/AC2）**：`plugin/scripts/ready-pool-check.ts` 新增 `computeLandingBlocked`（纯判定：
develop 落后 master ≥ threshold 且 integration 冻结超窗 ⇒ `landing_blocked: true` + reason）、
`detectLandingBlocked`（git-backed，fail-safe：缺 ref / 非 git 根 ⇒ 不报）、`readGitRevCount` /
`readLastCommitMs`（fail-safe git 读）。`analyzeTasks` 输出新增 `landing_blocked` /
`landing_blocked_reason`，`report` 串追加小写 `landing-blocked` 字面量。`slot-refill.ts` 把信号透传
（`analyzeSlotRefill` 返回 `landing_blocked` / `landing_blocked_reason`）——**信号不是闸门**：
`should_refill` / 步骤 4 并发资格不读它，落地正常不打断派发（AC4）。

**Contract measure 修正**：原 grep `'landing-blocked\|landingBlocked'` 会命中本任务自身 id
（`gap-landing-blocked-invisible-to-dispatch-criteria`），正常态也 ≥2，无法区分阻塞/非阻塞。已改为
`grep -c 'landing-blocked ('`——只命中 report 串的 `· landing-blocked (` 前缀，阻塞时 ≥1、正常态 0
（实现时发现并修正）。

**invoke 实跑（真实树，正常落地负控制）**：`node --experimental-strip-types plugin/scripts/ready-pool-check.ts --root "$(pwd)" --json 2>&1 | grep -c 'landing-blocked ('` → `0`（本仓 develop 未落后 master，正常态不误报）。

**AC17 catch-up 场景实测（AC2，real-git 夹具）**：master 前进 3 提交、develop/integration 冻结于 base
⇒ `analyzeTasks` 报 `criterion_met: true`（派发能力可见）**且** `landing_blocked: true` +
`landing_blocked_reason: "landing-blocked: develop is 3 commit(s) behind master and integration has had
no commit for ...s (frozen) — AC17 catch-up incomplete"`；report 串含 `landing-blocked (`。负控制：integration
继续推进（正常落地）⇒ `landing_blocked: false`。测试见 `plugin/test/ready-pool-check.test.mjs`
（`computeLandingBlocked` 纯函数 ×2 + `detectLandingBlocked` fail-safe ×1 + analyzeTasks git 场景 ×2 +
CLI measure 面 ×1）。

**scoped 门**：`scripts/test.sh --for-task gap-landing-blocked-invisible-to-dispatch-criteria --allow-thin` →
exit 0，`tests 64 / fail 0 / cancelled 0`（ready-pool-check.test.mjs 48 + slot-refill.test.mjs 16），
静态检查 task-contract-check / drive-contract-check / instrument-failure-check 全 PASS。

**AC3 交叉标注**：`tasks/gap-ready-pool-check-counts-merged-not-flipped-tasks-in-the-pool.md` 的
Cross-references 补了「只测心跳的补充」注记——那条 + `taskWorkLanded` 家族测「池成员是否已做完未翻
done」（收尾/心跳维度）；本条补「落地可见性轴」（landing-blocked 信号），正交不重叠。

## Dispatch review

reviewer: outer
at: 2026-08-06T08:1xZ
changed: 管理者使用视角提问立案——criterion_met 只测派发候选不测落地，落地被结构阻塞时照样 True。
「只测心跳不测意识」实例。落地可见性新轴，与 AC16/AC17 并行不阻塞。
