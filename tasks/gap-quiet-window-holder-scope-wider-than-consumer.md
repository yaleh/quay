---
id: gap-quiet-window-holder-scope-wider-than-consumer
title: quiet-window holder 声明「除 fan-in-executor 外所有层」但唯一消费者是 promotion-driver 自己——manager/outer 提交结构上无法被挡 ⇒ ff-livelock 反复落空（15h 实证）
status: ready
labels:
  - gap
  - defect
  - delivery-critical
parent: null
children: []
extra:
  schema: execution
---
**type:** execution

## Proposal

`gap-fan-in-ff-livelock-quiet-window-no-consumer`（done，c82b50fe）的 AC2 只判「quiet-window 有真消费者」为真，**没检验「消费者集合是否覆盖 holder 字段声明的范围」**。缺口（manager 报，我读码复核）：

- `quietWindowActive(` 全仓库**唯一调用者 = promotion-driver.ts 自己**（:158 定义、:739 调用，`grep` 只 2 处命中同文件）；
- escalation 记录的 `holder` 字段声明 **"all-layers-except-fan-in-executor"**（:732 注释「兑现 escalation 的 holder」）；
- ⇒ **manager 自己的 git 提交、outer 的 git 提交，都不在消费者集合里，结构上无法被该窗口挡住**。

**精确复现实例（sampler-orphan 第 3 次尝试内，全读原始记录）**：22:39:58Z ff-escalation 写 quietWindow 请求（windowMinutes:20，criterion "git log develop --since=… empty"）→ 22:43:22Z **manager 自己提交 develop**（「五项手跑」修复）⇒ 距窗口开始仅 3m24s 窗口被破坏 → 22:45:33Z worker 放弃 exited-not-landed（5.6 分钟，远未到 20 分钟）。

**累计代价（worker-outcome.jsonl 直接量，今日）**：sampler-orphan 3 次尝试 727.8 分钟=12.13h + ac155 2 次 173.9 分钟=2.90h，**合计 15.03h worker 墙钟**，且期间套件几乎全绿（sampler-orphan 6/6 fullSuiteRan=true 轮全 green fail=0）——本质是「在等一个不会来的安静窗口」。`fan-in-retries.jsonl` 共 **175 条** "Diverging branches can't be fast-forwarded"。

**与锁饥饿（46.2%）同族不同层**：锁饥饿是「排队」，这条是「追不上」——重跑越久 develop 移动越多次、ff 越难追上，两者互相加剧。

## Plan

三个方向候选（manager 不代拍，落笔方判）：① manager/outer 提交前查 quiet-window active 并暂缓；② 把 holder 范围收窄到实际覆盖的（promotion-driver 晋升 + fix-worker 派发）；③ fan-in 侧改用 rebase-retry 绕开整条路（`gap-ac75-fan-in-merge-not-rebase-delta-check` done 但报错仍是 ff，说明此路径未覆盖）。

## Acceptance Criteria

- [ ] AC1（能取假，声明范围=实际覆盖）：quiet-window 的 holder 声明范围与实际消费范围一致（收窄 holder / 或把 manager+outer 纳入消费），⛔ 声明宽于覆盖的缺口仍在；（⛔ 仍宽于覆盖 ⇒ 假）。
- [ ] AC2（能取假，负控制回放）：回放「quiet-window active 期间 manager 提交 develop」场景（22:43:22Z 那次），修复后该提交不再静默破坏窗口（被挡 / 或窗口不受该层提交影响）；（⛔ 仍静默破坏 ⇒ 假）。
- [ ] AC3（能取假，ff-livelock 不再空等）：修复后 sampler-orphan/ac155 类任务的 ff 不再因「安静窗口等不来」反复 exited-not-landed（直接量：`fan-in-retries.jsonl` 的 "Diverging branches" 不再累积）；（⛔ 仍反复落空 ⇒ 假）。

## Definition of Done

quiet-window holder 声明与实际消费一致；AC1-AC3 全勾；sampler-orphan/ac155 不再空等安静窗口；"Diverging branches" 不再累积。

## Touches

- plugin/scripts/promotion-driver.ts（quietWindowActive 消费范围 / holder 声明收窄）
- plugin/scripts/（fan-in-ff-merge.sh 或 fan-in-execute.js 的 rebase-retry 或 quiet-window 联动，若走方向③/①）
- tasks/gap-quiet-window-holder-scope-wider-than-consumer.md（自身）
