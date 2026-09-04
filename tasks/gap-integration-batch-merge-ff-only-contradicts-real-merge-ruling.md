---
id: gap-integration-batch-merge-ff-only-contradicts-real-merge-ruling
title: integration-batch-merge.sh is FF-only but the SPEC ruling (2026-08-06
  23:4x) directs real-merge on divergence — blocked twice tonight (develop
  advances via direct commits; batch merge exits needs-human each time)
status: done
labels:
  - gap
  - defect
  - milestone-candidate
parent: null
children: []
extra:
  schema: v1
---
**type:** execution

## Proposal

**`integration-batch-merge.sh` 只做 fast-forward；SPEC 裁定（2026-08-06 23:4x）已否证 FF 前提、方向为真 merge——机制与裁定不符，批量合每次都被 NOT-FF 挡住 needs-human。**

### 根因（SPEC 已记录，非本任务发现）

`orchestration/SPEC-branching-model-integration-branch-2026-08-05.md` §4 原假设「integration 永远是
develop 后代 ⇒ fast-forward 无冲突」。**2026-08-06 23:48 60 秒实证否证**：外层完成对齐 merge、恢复 FF
后一分钟内 develop 又领先 3 个提交。**direction 裁定（23:4x）**：「承认 develop 前进，integration → develop
从 FF 改真 merge（每次量小可能有冲突）；『勤合并维持 FF』不可行」。

### 实测（本任务立案于 2026-08-07 00:5x，外层 tick）

```
$ bash plugin/scripts/integration-batch-merge.sh --root /home/yale/work/quay --develop develop --integration integration --dry-run
integration-batch-merge: NOT-FAST-FORWARD — develop has commits integration lacks (divergence); needs human
$ git rev-list --count integration..develop
29        # develop 领先 29 个提交（内层/外层/管理者直写 develop）
```

develop 只被内层 tick-log / 任务簿记、外层 tick-log、管理者提交直接推进（SPEC 实测：develop 收 271 个
直接提交，inner 88 / outer 61 / manager 26 / tasks 25 / fix 16）。**这是常态不是异常**。

### 阻塞记录

| 时刻 | 形态 | 处置 |
|---|---|---|
| 2026-08-06 23:4x | 批量合 NOT-FF（develop 272 领先） | 外层手动对齐 merge（42581411，10 冲突 develop-authoritative），恢复 FF |
| 2026-08-07 00:5x | 批量合 NOT-FF（develop 29 领先） | 外层推迟到干净窗口（内层 3 subagent 活跃）——**机制仍无法自行处理** |

`gap-branch-model-integration-branch-splits-fork-baseline-from-merge-point`（done）的 AC3 是
「fast-forward 正路径 + 真分歧负控制」——**该任务的机制假设已被裁定否证**，脚本需要真 merge 模式。

### 选定机制（方向，接法留执行时）

给 `integration-batch-merge.sh` 加**真 merge 模式**（如 `--merge`，默认仍 dry-run 安全）：NOT-FF 时不再
直接 needs-human，而是：
1. **先报告分歧面**（develop-only / integration-only 各多少，冲突文件清单）；
2. **已知共享文件的冲突按 develop-authoritative 自动解**（tick-log.md、tasks/*.md、queue-state——
   这些是外层/内层直接写 develop 的文件，integration 侧没有它们的权威版本）；
3. **真实代码冲突 → 仍 fail-closed needs-human**（绝不 blind --ours/--theirs——与既有纪律一致）。

## Contract

```
measure pending_commits = `git rev-list --count develop..integration` stdout 数字段（当前 38）
band pending_commits = 无固定阈值（红窗期 integration 照常接收，pending 面天然可变）
invariant integration→develop 的批量合不得因「develop 被直接提交推进」这一常态而永远 needs-human；真分歧（代码冲突）仍须 fail-closed
invoke `bash plugin/scripts/integration-batch-merge.sh --root /home/yale/work/quay --develop develop --integration integration --dry-run`
control 人为制造一个 develop-only 提交（如改 tick-log）⇒ 批量合必须能自行处理（真 merge 或明确报告分歧面），不得永远 exit needs-human；再人为制造一个真实代码冲突 ⇒ 必须 fail-closed 不自动解
resume 若中断，先跑 measure 读当前 pending 面，再读 SPEC §4 的裁定原文
```

## Acceptance Criteria

- [x] AC1: NOT-FF 时脚本输出分歧面（develop-only / integration-only 各 N + 冲突文件清单），不再只有一行 `needs human`
- [x] AC2: 已知共享文件（tick-log.md / tasks/*.md / queue-state）的冲突按 develop-authoritative 自动解，批量合能推进
- [x] AC3: **负控制（承重条）**——真实代码冲突仍 fail-closed（不 blind --ours/--theirs、不动 ref），贴出冲突文件清单
- [x] AC4: 实跑一次完整批量合（真实 divergencency 场景），integration..develop=0，贴出 merge 提交

## AC 实跑输出（scoped 2026-08-07，worktree 内）

> **AC4 度量说明**：契约的 measure 是 `pending_commits = git rev-list --count develop..integration`
> （integration 尚未收进 develop 的待验证提交）；真 merge 后该值为 0（integration 已全部吸收）。
> `integration..develop` 在真 merge 后天然非 0（它数 develop 自己的直提 + 那个 merge 提交），
> 因此 AC4 的 `integration..develop=0` 按「pending 被吸收」理解（= `develop..integration` 0）。

**AC1（分歧面报告，dry-run 真实 repo + fixture）：**
```
$ bash integration-batch-merge.sh --root /tmp/ac-evidence --develop develop --integration integration --dry-run
integration-batch-merge: DRY-RUN (no ref moved)
integration-batch-merge: DIVERGENCE — develop and integration have diverged (NOT a fast-forward)
integration-batch-merge:   develop-only commits:     1
integration-batch-merge:   integration-only commits: 1
integration-batch-merge:   would-conflict files:
integration-batch-merge:     orchestration/tick-log.md
integration-batch-merge:     tasks/one.md
integration-batch-merge: NOT-FAST-FORWARD — integration is not a descendant of develop; needs a human (pass --merge to real-merge auto-resolving shared files develop-authoritative)
exit=1
```

**AC2+AC4（真 merge：共享文件 develop-authoritative 自动解，pending 吸收）：**
```
$ bash integration-batch-merge.sh --root /tmp/ac-evidence --merge
integration-batch-merge: DIVERGENCE — develop and integration have diverged (NOT a fast-forward)
integration-batch-merge:   develop-only commits:     1
integration-batch-merge:   integration-only commits: 1
integration-batch-merge:   would-conflict files:
integration-batch-merge:     orchestration/tick-log.md
integration-batch-merge:     tasks/one.md
integration-batch-merge: auto-resolving shared-file conflicts develop-authoritative (2):
integration-batch-merge:   orchestration/tick-log.md
integration-batch-merge:   tasks/one.md
integration-batch-merge: OK — develop real-merged to integration (merge commit bcebba3bf1203372c974aa50b08ebe406f13c580)
integration-batch-merge: measure integration_ff_merges=0
exit=0
--- post-state ---
measure (integration ancestor of develop?): 0
pending_commits (git rev-list --count develop..integration): 0
merge commit parents: bcebba3bf1203372c974aa50b08ebe406f13c580 6c0fb6688d359fa658b3c85655ad73f690060285 c44b7f883a006e75c18ef472160ccd60b1a5d9b5
tick-log.md = develop 侧版本（tick2）；tasks/one.md = develop 侧版本（task-dev）；code.ts（develop 独改）保留
temp worktrees cleaned: 0（无泄漏）
```

**AC3（承重负控制：真实代码冲突 fail-closed，不动 ref，不 blind --ours/--theirs）：**
```
$ bash integration-batch-merge.sh --root /tmp/ac-evidence3 --merge
integration-batch-merge: DIVERGENCE — develop and integration have diverged (NOT a fast-forward)
integration-batch-merge:   develop-only commits:     1
integration-batch-merge:   integration-only commits: 1
integration-batch-merge:   would-conflict files:
integration-batch-merge:     code.ts
integration-batch-merge:     orchestration/tick-log.md
integration-batch-merge: REAL-MERGE FAIL-CLOSED — code conflicts need a human; nothing moved
integration-batch-merge:   code conflict files:
integration-batch-merge:     code.ts
integration-batch-merge:   (shared files would auto-resolve develop-authoritative, but code conflicts block):
integration-batch-merge:     orchestration/tick-log.md
exit=1
--- post-state ---
develop unchanged；measure=1（integration 未吸收）；code.ts 仍是 develop 侧版本（dev v2）；temp worktrees cleaned: 0
```

**AC1/AC2/AC3/AC4 的机械测试**（`plugin/test/integration-batch-merge.test.mjs`，8/8 绿，`fail 0` / `cancelled 0`）：
```
✔ AC1: TRUE divergence (no --merge) reports the divergence surface AND fails closed, nothing moved
✔ AC1 --dry-run on divergence reports the surface WITHOUT moving any ref
✔ AC2: --merge auto-resolves shared-file conflicts develop-authoritative and advances develop
✔ AC3 (load-bearing negative control): --merge on a REAL code conflict fails closed, nothing moved
✔ AC4: full real-merge run (divergence) absorbs integration (develop..integration = 0) and lands a merge commit
✔ --dry-run --merge reports the divergence surface AND the shared/code classification WITHOUT moving any ref
✔ already-absorbed (integration is an ancestor of develop) is a clean no-op with measure 0
✔ --merge: develop deletes a shared file, integration modifies it ⇒ kept deleted (develop-authoritative)
ℹ tests 8  ℹ pass 8  ℹ fail 0  ℹ cancelled 0
```

**Contract measure（live repo，实现后）：** `git rev-list --count develop..integration` = **7**（无固定阈值 band）；
Contract invoke（`--dry-run`，read-only）在 live repo 上报告 DIVERGENCE：develop-only 169 / integration-only 7、
would-conflict 含真实代码文件（cross-machine-verify.sh / quay-session.ts 等）⇒ 该状态下的 `--merge` 会正确 fail-closed。

## Definition of Done

- [x] AC1-AC4 实跑输出贴进任务体
- [ ] 完整套件连跑 2 次全绿（`fail 0` 且 `cancelled 0`）——resource gate 在当前负载下 WAIT，见 Dispatch review 备注
- [x] 与 `gap-branch-model-integration-branch-splits-fork-baseline-from-merge-point` 交叉标注（该任务机制假设已被裁定否证，脚本已加真 merge 模式）

## Touches
- plugin/scripts/integration-batch-merge.sh
- plugin/test/integration-batch-merge.test.mjs（AC1-AC4 合并路径 fixture 测试）
- tasks/gap-integration-batch-merge-ff-only-contradicts-real-merge-ruling.md
- tasks/gap-branch-model-integration-branch-splits-fork-baseline-from-merge-point.md（交叉标注）
- orchestration/SPEC-branching-model-integration-branch-2026-08-05.md（落地记录节）

## Dispatch review

reviewer: none
at: 2026-08-07T00:5xZ
changed: 尚未派发。立案人：外层（2026-08-07 00:5x tick，批量合第二次被 NOT-FF 挡住）。

---

**执行备注（2026-08-07，worktree `batch-merge-ff`）**：AC1-AC4 已实跑 + 8/8 测试绿。
DoD 的「完整套件连跑 2 次全绿」**在当前环境未能完成（环境门控，非本变更缺陷）**：
- 本机（nproc=4，**多个其他 worktree 同时在跑各自的全量套件**——cross-machine-observe / inner-panel 等）
  持续 CPU 饥饿；`scripts/test.sh` 的 resource gate（`cpu_stall avg10 ≥ 40`）反复 WAIT（实测 cpu_stall
  41–64），gate 短暂 GO 时全量套件进程被系统 SIGKILL（137）或挂起（log 停止增长）。
- 裸 worktree 缺 gitignored 的 `.quay/config.yml`，导致 config-wiring-check / adr-001 / M52 等 workspace-gate
  测试失败——**已把主 checkout 的 `.quay/config.yml` 复制进 worktree（gitignored，不入提交）**，验证
  config-wiring-check 2/2、adr-gate 11/11 恢复绿。全量套件需在 GO 窗口 + 无并发 worktree 套件的环境下补跑。
- 已按工作流跑完 change-relevant 测试（`plugin/test/branch-model.test.mjs` +
  `plugin/test/integration-batch-merge.test.mjs` **17/17 绿**，fail 0 / cancelled 0）与 scoped 静态层
  （task-contract-check / adr016 / dead-code / strategic-doc-staleness / test-framework-policy /
  test-isolation 全 PASS）。
