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

- [x] AC1 机制与归属被指名并可复算：给出「不落地 ⇒ 看板不可见」的**两处**逐字读数（上列 1、2 两条），并指名负责写入的代码位置（文件 + 函数/行）；不得只给结论。 —— 见 `## Evidence` §AC1：读数 1（任务自己点名的实例，今天复算仍为 0）与读数 2（改用**当前卡住**的 `gap-ac355-…`）逐字给出；**提案第 2 条读数经按位置判定被证伪**（`lastFailure` 不是 canonical schema 的键，那两处命中在正文散文里）；归属指名到 `fan-in-ac-completion-gate.ts:63` / `driver-filters.ts:770` / `worker-driver.ts` `computeOutcome`→`appendOutcomeToFile`；任务记录写入面此前不存在。
- [x] AC2 判据（机械、不给 checkout 分支）：在**不 checkout 该任务分支**的前提下，**一条命令**能读到「该任务上一次卡住的原因」。逐字给出命令与其输出。若认为 `gate-events.jsonl` + `worker-outcome.jsonl` 已经够用，必须**证明**它能一条命令按 task 取到最近一次 `exited-not-landed` 的 reason；证明不了就补通道。 —— 先证明逃生口**不成立**（台账 `.quay/worker-outcome.jsonl` 被 gitignore ⇒ 干净 checkout 上读到 `carrier-absent`），故**补通道**；通道 = 任务记录，一条命令在**干净 checkout** 上逐字读出原因（见 `## Evidence` §AC2）。
- [x] AC3 反例控制（承重）：对**已正常落地**的任务，同一条命令**不产生噪声**（要么明确为空，要么明确指向「未卡住」）；并构造/复用一个真实卡住的实例证明它确实命中。 —— 见 `## Evidence` §AC3：同一命令对已落地的 `gap-cli-serve-port-test-flaky-ci-timeout` 输出为空；真实卡住的 `gap-ac355-…` 命中（AC2 的逐字输出）。
- [x] AC4 复用还是新增：明文裁定（a) 复用任务记录上既有的 `lastFailure` 槽（把 worker 失败原因写进去），还是 (b) 新增独立通道；给出理由与实现位置。⛔ 不接受「两个都加」这种不裁定的收尾。 —— 裁定：**复用任务记录作为唯一的通道**（不新开独立通道、不新增 frontmatter 槽）；a) 点名的 `lastFailure` 槽**并不存在**，故载体取任务记录**正文**的 `## Blocker` 段。理由与实现位置见 `## Evidence` §AC4；**⛔ 只有一个通道**。
- [x] AC5 范围受控：`git diff --name-only $(git merge-base HEAD develop) HEAD` ⊆ `## Touches`；不改 `fan-in-ac-completion-gate.ts` 的**判词语义**（若因本条必须改动，须在 AC4 里点名并说明为何不弱化闸）。 —— 见 `## Evidence` §AC5：diff = `plugin/scripts/worker-driver.ts` 单文件；`fan-in-ac-completion-gate.ts` 一个字节都没动，且实测同一任务体加 `## Blocker` 段前后 `flipAcGateVerdict` 逐字相同。

## DoD

真实落地判据：AC2 的那条命令在**干净 checkout** 上对「当前卡住的任务」真的读得到原因，读数是本轮实测、不是设计说明；AC3 的反例控制跑过；AC4 的裁定写死在文件里。仅「加了个字段」而无 AC2/AC3 的读数不算达标。

## Touches

- plugin/scripts/worker-driver.ts
- plugin/scripts/fan-in-ac-completion-gate.ts
- tasks/gap-worker-blocker-reason-invisible-on-the-board.md (self)

## Notes

- 来源：`quay-task-worker` 会话 2026-10-10 的带外升级所附发现；人 yale 同日要求「另立或复用任务处理，列明归属与验收」。
- 本条**不改**任何任务的 AC，也不改闸的松紧；它只处理「卡住原因是否可见」。

## Evidence

（2026-10-10，本 worker；所有读数本轮实测。改动：`plugin/scripts/worker-driver.ts`，唯一被改文件。）

### AC1 —— 两处逐字读数 + 归属

**读数 1（任务自己点名的实例，今天复算仍为 0）**：

```
$ git show develop:tasks/gap-release-workflow-definition-lags-one-release.md | grep -c '本轮复核'
0
$ git show author:tasks/gap-release-workflow-definition-lags-one-release.md  | grep -c '本轮复核'
0
$ ls -d /home/yale/work/quay-worktrees/gap-release-workflow-definition-lags-one-release
ls: cannot access '/home/yale/work/quay-worktrees/gap-release-workflow-definition-lags-one-release': No such file or directory
```

即：分支侧那份记录**今天已连同 worktree 一起被清理** —— 不落地的东西连「留待日后」都做不到。

**读数 2（改用【当前卡住】的实例 `gap-ac355-criterion-false-from-goal-acceptance-active-guard`，按位置复算）**：

```
$ grep 'gap-ac355-criterion-false-from-goal-acceptance-active-guard' .quay/worker-outcome.jsonl | grep -c 'exited-not-landed'
1
$ git show develop:tasks/gap-ac355-criterion-false-from-goal-acceptance-active-guard.md | grep -c '未落地原因'
0
$ git show author:tasks/gap-ac355-criterion-false-from-goal-acceptance-active-guard.md  | grep -c '未落地原因'
0
$ node packages/quay/bin/quay.js task view gap-ac355-… --json | jq -r .body | grep -c '未落地原因'
0
```

⇒ **信息存在（台账里 1 条 `exited-not-landed`）、看板读不到（develop / author / `task view` 全 0）。**

**⚠️ 提案第 2 条读数被证伪（按位置判定，硬规则 2）**：`lastFailure` 不是 canonical schema 的键
（`grep -c lastFailure plugin/scripts/task-schema.ts` = 0）。提案里那两处「命中」
（`tasks/gap-cli-serve-port-test-flaky-ci-timeout.md:30`、`tasks/gap-build-phase-null-result-not-gated.md:71`）
都在**正文**（frontmatter 分别止于第 17 / 16 行），是散文「The single failure:」而非 frontmatter 键。
⇒ 「槽存在但没被写」不成立；实情是**从来没有这个槽**，也没有任何失败字段被写。

**归属（代码位置）**：

- 产生原因文本：`plugin/scripts/fan-in-ac-completion-gate.ts:63`（`AC 未全勾（checked …）`）与机械 fan-in
  的 suite 红行 —— 经 `plugin/scripts/driver-filters.ts:770` `formatExitedNotLandedReason` 归一。
- 写进私有台账：`plugin/scripts/worker-driver.ts` `computeOutcome`（`failure_reason`）→
  `appendOutcomeToFile`（`worker-outcome.jsonl` 的**唯一**落盘点；`appendOutcome` 包装同经它）。
- 任务记录写入面：**此前不存在**（本次新增 `projectBlockerToTaskRecord`，调用点 = `runOneWorker`
  终态处）。

### AC2 —— 一条命令 + 逐字输出（**干净 checkout**，不 checkout 任务分支）

先证明「`worker-outcome.jsonl` 已经够用」这条逃生口**不成立**：

```
$ git check-ignore -v .quay/worker-outcome.jsonl
.gitignore:64:**/.quay/worker-outcome.jsonl	.quay/worker-outcome.jsonl
$ git ls-files .quay/worker-outcome.jsonl | wc -l
0
# 干净 checkout（无该运行态文件）上，同一读取器读到的是 carrier-absent：
$ node packages/quay/bin/quay.js driver log --kind worker --task gap-ac355-…
carrier: .quay/worker-outcome.jsonl  status: carrier-absent
lines: 0 (0 unparseable)  attempts: 0
```

⇒ 必须**补通道**（DoD 要的是**干净 checkout** 上读得到，而运行态台账在干净 checkout 里不存在）。

**补的通道 + 一条命令**（在**干净 checkout** = 只含 git 跟踪文件的目录上跑；该目录**没有**
`.quay/worker-outcome.jsonl`）：

```
$ node packages/quay/bin/quay.js task view gap-ac355-criterion-false-from-goal-acceptance-active-guard \
      --json | jq -r .body | awk '/^## Blocker/{f=1;print;next} f&&/^## /{exit} f'
## Blocker

**2026-10-10T07:56:10.224Z — worker 未落地（exited-not-landed）**

- 未落地原因：step=suite: __PERFILE__ duration_ms=2825 /data/home/yale/work/quay-worktrees/gap-ac355-…/plugin/test/shipped-entry-runnable.test.mjs passed=false end_ms=1791618889559 cpu_ms=2161.901 mem_peak_kb=53344
- run_id：wk-prod-anchor
- session_id：4eeb8bb2-0561-469d-9ea1-7c5467e1d813
```

### AC3 —— 反例控制（承重）

同一命令，对**已正常落地**的 `gap-cli-serve-port-test-flaky-ci-timeout`（`status: done`，台账中 0 条
`exited-not-landed`）：

```
$ node packages/quay/bin/quay.js task view gap-cli-serve-port-test-flaky-ci-timeout --json \
      | jq -r .body | awk '/^## Blocker/{f=1;print;next} f&&/^## /{exit} f'
（空输出）
```

正例（真实卡住实例）见 AC2 的逐字输出 —— 命中。另：`completed` 时投影**清除**该段
（`projectBlockerToTaskRecord(..., 'completed', ...)` ⇒ `{ok:true,changed:true,committed:true}` 且文件逐字
还原；再跑一次 ⇒ `{ok:true,changed:false,committed:false}`），故「卡住→落地」的任务不留残段。
同一原因重复投影 ⇒ `changed:false`（不 churn）。

### AC4 —— 裁定：复用任务记录作为唯一通道

**裁定**：复用**任务记录**（`tasks/<id>.md`）作为唯一通道；⛔ 不新开独立通道、⛔ 不新增 frontmatter 槽。

理由（位置性的）：看板读的是 **provider 任务存储**（`quay task view` / `/task/<id>` 的 `body`）；通道不在
任务记录里就**结构上**看不到 —— `worker-outcome.jsonl` **正是**那条「独立通道」，它的不可见**就是**本
缺陷。而 a) 点名的 `lastFailure` 槽**并不存在**（AC1 已证伪），故载体取任务记录的**正文**：driver 独占的
`## Blocker` 段（与既有 `markNeedsHuman` 的 `## Needs-Human` 同形），而非 frontmatter——frontmatter 无处
安放一段自由文本。

**实现位置**：`plugin/scripts/worker-driver.ts` 新增 `projectBlockerToTaskRecord`（+ `buildBlockerSection` /
`upsertBlockerSection` / `stripBlockerSection` / `blockerReasonInBody`），调用点 = `runOneWorker` 终态落盘
（`appendOutcomeToFile(outcomeFile, finalOutcome)` 之后）；写盘即提交（`commitTaskFile`，与
`markNeedsHuman` 的 COMMIT-AFTER-WRITE 同族）+ `syncDocDevelopBidirectional`。**⛔ 只有一个通道**。

### AC5 —— 范围受控

```
$ git diff --name-only $(git merge-base HEAD develop) HEAD
plugin/scripts/worker-driver.ts
```

⊆ `## Touches`。`fan-in-ac-completion-gate.ts` **未被修改**（diff 里没有它），判词语义不变——实测：同一
真实任务体，加 `## Blocker` 段前后 `flipAcGateVerdict` 逐字相同（`identical=true`，
`{"ok":true,"status":"pass","total":6,"checked":6}`）。另确认与看板 needs-human 面不互串：
`extractNeedsHumanReason(<含 Blocker 段的体>)` ⇒ `null`（段里用 `未落地原因：` 而非 `阻碍原因：`）。

### 验证口径（如实标注）

端到端读数在一个**分阶段 root** 上取得：真实 `tasks/*.md` + 真实 `.quay/worker-outcome.jsonl`（从生产
台账**逐字拷贝**），经**真实**的 `exitedNotLandedAttempts`（未改）与**真实**的 `projectBlockerToTaskRecord`
跑通；干净 checkout 用 `git archive HEAD` 模拟。⚠️ 这**不是**「生产 driver 跑过一轮」——本轮生产 driver
未运行本次改动（改动尚未落 develop）；读数是**机制在真实数据上的实测**，非设计说明。

scoped gate 绿：`bash scripts/test.sh --for-task gap-worker-blocker-reason-invisible-on-the-board --allow-thin`
⇒ exit 0（129 tests / 0 fail；scoped 静态检查全过）。
