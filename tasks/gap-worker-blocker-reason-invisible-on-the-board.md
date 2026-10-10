---
id: gap-worker-blocker-reason-invisible-on-the-board
title: worker 写在任务分支上的阻塞记录到不了 develop/author（且任务记录的 lastFailure/failure 槽从未被写）⇒
  任务为何卡住在看板上不可见、循环静默
status: ready
labels:
  - gap
parent: null
children: []
extra: {}
---
**type:** execution

## Proposal

**问题**：一个任务连续多轮卡住时，「它为什么卡住」在**看板上不可见** —— 而看板正是人看的地方。循环因此静默：任务看起来只是停在 `ready`（或 `needs-human`），没有原因可读。

**两条互相独立的证据（本轮实测，不是推断）**：

1. **worker 写在任务分支上的阻塞记录不落地**。worker 在 worktree 里往 `tasks/<id>.md` 追加 `## Evidence` / `## Needs-Human` 段；该文件只有在 fan-in 的 ff 真的落地时才进 develop。任务因故不落地 ⇒ **它自己的说明永远不落地**。实测（`gap-release-workflow-definition-lags-one-release`，连卡 3 轮）：`git show develop:tasks/<id>.md | grep -c '本轮复核'` = **0**、`git show author:tasks/<id>.md | grep -c '本轮复核'` = **0**，而该分支的工作树副本里有整整两段。
2. **任务记录上的失败槽存在但没被写**。任务记录**有** `lastFailure` / `failure` 字段（部分任务文件确实带该 frontmatter 键，如 `tasks/gap-cli-serve-port-test-flaky-ci-timeout.md`、`tasks/gap-build-phase-null-result-not-gated.md`），但同一个连卡 3 轮的任务 `task view --json` 读到的是 **`lastFailure: null, failure: null`** —— 而失败原因其实**已经在** `.quay/worker-outcome.jsonl` 里（`failure_reason` 字段，逐字：「AC 未全勾（checked 3/5，剩余未勾 2）——续做只需验证并勾选 AC」）。⇒ **信息存在、通道存在、没人接**。

**为什么值得单独一条**：这不是某一个任务的缺陷，而是「任务卡住」这一类事件的**可见性**缺陷。2026-10-10 另有一个项目（claudecodeui）因 develop 全局红让所有 fan-in 变成 `unattributable`、静默停摆约 3 小时，其归因同样只存在于任务分支上、看板读不到 —— 同一根因、不同实例。

**归属**：quay 自身 —— worker 落地路径（`plugin/scripts/worker-driver.ts` 写 `worker-outcome.jsonl` 的那一段）与任务记录的字段写入面；`fan-in-ac-completion-gate.ts` 的结构性阻塞判词是第二个候选落点。

## AC

- [ ] AC1 机制与归属被指名并可复算：给出「不落地 ⇒ 看板不可见」的**两处**逐字读数（上列 1、2 两条），并指名负责写入的代码位置（文件 + 函数/行）；不得只给结论。
- [ ] AC2 判据（机械、不给 checkout 分支）：在**不 checkout 该任务分支**的前提下，**一条命令**能读到「该任务上一次卡住的原因」。逐字给出命令与其输出。若认为 `gate-events.jsonl` + `worker-outcome.jsonl` 已经够用，必须**证明**它能一条命令按 task 取到最近一次 `exited-not-landed` 的 reason；证明不了就补通道。
- [ ] AC3 反例控制（承重）：对**已正常落地**的任务，同一条命令**不产生噪声**（要么明确为空，要么明确指向「未卡住」）；并构造/复用一个真实卡住的实例证明它确实命中。
- [ ] AC4 复用还是新增：明文裁定（a) 复用任务记录上既有的 `lastFailure` 槽（把 worker 失败原因写进去），还是 (b) 新增独立通道；给出理由与实现位置。⛔ 不接受「两个都加」这种不裁定的收尾。
- [ ] AC5 范围受控：`git diff --name-only $(git merge-base HEAD develop) HEAD` ⊆ `## Touches`；不改 `fan-in-ac-completion-gate.ts` 的**判词语义**（若因本条必须改动，须在 AC4 里点名并说明为何不弱化闸）。

## DoD

真实落地判据：AC2 的那条命令在**干净 checkout** 上对「当前卡住的任务」真的读得到原因，读数是本轮实测、不是设计说明；AC3 的反例控制跑过；AC4 的裁定写死在文件里。仅「加了个字段」而无 AC2/AC3 的读数不算达标。

## Touches

- plugin/scripts/worker-driver.ts
- plugin/scripts/fan-in-ac-completion-gate.ts
- tasks/gap-worker-blocker-reason-invisible-on-the-board.md (self)

## Notes

- 来源：`quay-task-worker` 会话 2026-10-10 的带外升级所附发现；人 yale 同日要求「另立或复用任务处理，列明归属与验收」。
- 本条**不改**任何任务的 AC，也不改闸的松紧；它只处理「卡住原因是否可见」。
