# AC58 退役条款归档（retired-clauses archive）

> **本文件是 AC58（`tasks/gap-ac58-retired-clauses-delete-and-archive.md`）的落点。**
> 每条退役条款 / 退役标注从高频读取文件删除后，**正文落在此处**；高频文件只留**一行指针**指向本节。
> **落点映射**：每条的唯一词条 → 本文件的 `<id>` 锚点。删除提交必须携带本映射（CLAUDE.md 硬规则⑤：
> 验的是「全部有家」不是「抽查几个有家」）。
>
> 校验器：`plugin/scripts/retired-clause-check.ts` —— 每条注册项：①正文词条必须**已从源文件删除**
> （源文件 0 命中）；②正文词条必须**在本文件有家**（本文件 ≥1 命中）。负控制（AC58 判据3）见
> `plugin/test/retired-clause-check.test.mjs` 与 `plugin/scripts/checker-mutation-cases/retired-clause-check.sh`。

---

## R01 — outer B4 批量合（integration-batch-merge.sh 退役）

**来源**：`orchestration/orchestrator-tick-core.md` B 段 B4
**退役**：AC48 2026-08-13，integration 分支已退役
**正文**（原文迁出保留）：

```
- **B4 批量合【RETIRED — AC48 2026-08-13,integration 分支已退役】**:原为 `integration-batch-merge.sh --develop develop --integration integration` 把 integration 批量合回 develop——integration 删除后该命令无目标、不再执行（全局轮亦已停,per-task 模型下每任务合入 develop 即生效）。**develop 落后上界(2026-08-10 裁定)仍有效但引用对象变了**:integration 领先 develop 改指「develop 落后 origin/vhs 对应线」或直接删（开发落后是唯一在累积的成本,保留 escalate 判据） (src:890 "批量合 integration→develop",902 "develop 不推进";AC48 退役)
```

---

## R02 — inner-state.sh 退役说明（orchestrator-loop-tick.md 0b 事件式监测）

**来源**：`orchestration/orchestrator-loop-tick.md` 0b 事件式监测
**退役**：2026-08-02 实测后 inner-state.sh 退役（不观测会话）
**正文**（原文迁出保留）：

```
`inner-state.sh` 已退役——它不观测会话（`tmux` 命中 0），它的招牌信号 `.quay/inner-blocked.json`
在三个项目里从未产生，包括我们撞上过的唯一一次真实事故（那 68 分钟也没有它）。
```

---

## R03 — AC12 已随 inner-state.sh 退役而收口

**来源**：`orchestration/orchestrator-loop-tick.md` 外层监视器
**退役**：AC12 随 inner-state.sh 退役而收口
**正文**（原文迁出保留）：

```
**外层挂一个监视器（AC12 已随 inner-state.sh 退役而收口）——它答「会话还在不在」：**
```

---

## R04 — AC48 integration 分支退役（orchestrator-loop-tick.md 实例量）

**来源**：`orchestration/orchestrator-loop-tick.md` 实例量表（工作分支 / 外层工作 checkout）
**退役**：AC48 2026-08-13 退役 integration 分支（AC50 已切 develop）
**正文**（原文迁出保留）：

```
| 工作分支（**单线**，AC48 2026-08-13 退役 integration） | `fork_baseline: develop` / `merge_target: develop`（`.quay/config.yml` `loop:` 节）——per-task 模型：任务从 develop fork、worktree 内验证、merge 回 develop | 步骤 3b / A6 fan-in |
| 外层工作 checkout | **develop**（AC50 已切，AC48 确认 integration 退役）——外层一切提交落 develop，无第二线 | 启动方式 / 各提交步 |
```

---

## R05 — `.claude/loop.md` 已删除（exp5 退役）——调用方式

**来源**：`plugin/loop/fast-mode-loop-tick.md` 顶部「调用方式」
**退役**：exp5 退役（`.claude/loop.md` 已删除）
**正文**（原文迁出保留）：

```
**调用方式**（`.claude/loop.md` 已删除——exp5 退役；`/loop` 带显式 prompt 时不读该文件）：
```

---

## R06 — heavy-op-token.sh 整体退休 + 「一次只跑一个重测试」约束退役

**来源**：`plugin/loop/fast-mode-loop-tick.md` 已知负载敏感族
**退役**：2026-08-06 人裁定整体退休 heavy-op-token.sh；放宽实验前提不再存在
**正文**（原文迁出保留）：

```
放宽实验（第三步：把重活令牌从单飞放宽到两个
并发套件，= 负载翻倍——`heavy-op-token.sh` 已随 2026-08-06 人裁定整体退休，「一次只跑一个
重测试」约束退役，此放宽实验前提不再存在）
```

---

## R07 — 旧的 inner-state.sh 现已退役（session-liveness 理由）

**来源**：`plugin/loop/fast-mode-loop-tick.md` 会话存活监视
**退役**：2026-08-03 实测
**正文**（原文迁出保留）：

```
旧的 `inner-state.sh`，现已退役
```

---

## R08 — 旧 inner-state.sh 的「在做什么」事件集随其退役而撤下

**来源**：`plugin/loop/fast-mode-loop-tick.md` 观测只有一个工具
**退役**：inner-state.sh 退役
**正文**（原文迁出保留）：

```
旧 `inner-state.sh` 的「在做什么」
事件集随其退役而撤下
```

---

## R09 — exp5 已退役 + `.halt` 语义从「暂停 exp5 循环」改为快速模式唯一停止开关

**来源**：`plugin/loop/fast-mode-loop-tick.md` 停止哨兵
**退役**：exp5 退役（`.claude/loop.md` 已删除）
**正文**（原文迁出保留）：

```
exp5 已退役（`.claude/loop.md` 已删除），`.halt` 从「暂停 exp5 循环」改为**快速模式的唯一停止开关**。
```

---

## R10 — 旧「声明依赖 / touches 相交 → integration」fork 判据退役

**来源**：`plugin/loop/fast-mode-loop-tick.md` 分支模型（分叉基线新模型）
**退役**：AC48 2026-08-13 / fork-baseline.ts 一律 develop
**正文**（原文迁出保留）：

```
旧「声明依赖 / touches 相交 → integration」的 fork 判据**退役**
（`--force-integration` 已删除，`fork-baseline.ts` 传它 exit 2）。机械判定现为恒 `$FORK_BASELINE`
（见步骤 4；`fork-baseline.ts` 默认路径仅单线下游用）。
```

---

## R11 — inner-state.sh 已退役（Monitor 挂载自检）

**来源**：`plugin/loop/fast-mode-loop-tick.md` Monitor 挂载自检
**退役**：inner-state.sh 退役
**正文**（原文迁出保留）：

```
（观测只有一个工具；`inner-state.sh`
已退役）
```

---

## R12 — 旧「touches 与 $MERGE_TARGET 上未验证任务相交」fork 判据与 --force-integration 一并退役

**来源**：`plugin/loop/fast-mode-loop-tick.md` 分叉基线（步骤 4 前）
**退役**：AC48 2026-08-13 / fork-baseline.ts exit 2
**正文**（原文迁出保留）：

```
旧「touches 与 `$MERGE_TARGET` 上未验证任务相交 ⇒
`$MERGE_TARGET`」的 fork 判据与 `--force-integration` 一并退役（`fork-baseline.ts` 传它 exit 2；
其默认路径仅单线下游用，`--develop master --integration master` 恒返回 master）。
```

---

## R13 — 旧的 --force-integration（统一 integration HEAD）已退役

**来源**：`plugin/loop/fast-mode-loop-tick.md` 派发就绪任务（步骤 4 分叉基线）
**退役**：AC48 2026-08-13 / fork-baseline.ts exit 2
**正文**（原文迁出保留）：

```
旧的 `--force-integration`（统一 integration HEAD，`gap-task-file-develop-integration-drift-fan-in-conflicts`
AC2）**已退役**（`fork-baseline.ts` 现在传它 exit 2）——它当初要解的「fork 落后 integration 的
任务文件证据段冲突」由 **A6 rebase-重跑循环**吸收：fan-in 前先 `git -C <wt> rebase $FORK_BASELINE`，
任务文件漂移就地合并、套件重跑通过再合并（**代价 = rebase 后要重跑套件**，人 2026-08-13 裁定④已同意）。
依赖由派发闸 A15② PARENT-DONE-IFF-CHILDREN 串行化——B 等 A 合入 develop 后再派，B fork develop 时
已含 A ⇒ **一律 fork 自 develop，无例外**。分支名**从配置代入，不字面写死**：
```

---

## R14 — 旧 --force-integration 统一 integration 已退役（分叉基线新模型行内）

**来源**：`plugin/loop/fast-mode-loop-tick.md` 分叉基线（新模型 = $FORK_BASELINE）
**退役**：AC48 2026-08-13
**正文**（原文迁出保留）：

```
旧 `--force-integration` 统一 integration 已退役；依赖声明语义见 `fork-baseline.ts` 默认路径
```

---

## R15 — 旧「fork 源统一 = integration」（--force-integration）已退役

**来源**：`plugin/loop/fast-mode-loop-tick.md` 每个任务 worktree 都从 $FORK_BASELINE 分叉
**退役**：AC48 2026-08-13
**正文**（原文迁出保留）：

```
旧「fork 源统一 = integration」
（`--force-integration`）已退役；它当初要解的任务文件证据段冲突（实证 2026-08-10：round5-red
c3583844 vs 2c1539d7 同文件不同段）由 **rebase-重跑循环**吸收：fan-in 前先 rebase 新 develop，
冲突就地合并、套件重跑通过再合并（**代价 = rebase 后重跑套件**，人 2026-08-13 裁定④已同意）。
```

---

## R16 — 旧的 inner-state.sh 曾用 inotifywait 监视阻塞信道，现随其退役

**来源**：`plugin/loop/fast-mode-loop-tick.md` 阻塞信号
**退役**：inner-state.sh 退役
**正文**（原文迁出保留）：

```
旧的 `inner-state.sh` 曾用 inotifywait 监视它，现随 inner-state.sh 一起退役——阻塞信道是
「内层主动写、外层主动读」的显式信道，不需要一个常驻轮询工具转达。
```

---

## R17 — CLAUDE.md「各 ≤80 行」判据退役（tick-core-static-check n=3 placeholder）

**来源**：`CLAUDE.md` 每轮必经「三层每轮该做什么」
**退役**：AC30(a) 明确退休（tick-core-static-check.ts:70/:94 自证「n=3 placeholder，已 RETIRED」）
**正文**（原文迁出保留）：

```
本行原写「各 ≤80 行」，而该判据已被 AC30(a) 明确退休（`tick-core-static-check.ts:70/:94` 自证「n=3 placeholder，已 RETIRED」），实测 106/100/81 三个全超却无人报错：一个被退休的判据留在本文件里，正是本文件开头警告的那种漂移
```

---

## R18 — RETIRED (ADR-022): classic milestone loop 退役说明

**来源**：`CLAUDE.md` Architecture — methodology layer
**退役**：ADR-022, 2026-08-03
**正文**（原文迁出保留）：

```
- **RETIRED (ADR-022, 2026-08-03): the classic milestone loop — `OUTER-LOOP.md` + `prepare-milestone.js` + `execute-milestone.js` + the `composite-*` phases + `milestone-preparation-check.ts` + `diagnose-verify-failure.ts` — is retired.** The **two-layer fast mode is the sole development mode**. The gap tasks below that described `execute-milestone.js`/`prepare-milestone.js` as current mechanisms now describe **retired** mechanisms: those workflow files and the composite pipeline were physically deleted at `gap-retire-the-prepare-execute-pipeline-cluster` (2026-08-03). The surviving pieces of that cluster are `workflow-metadata-conformance.mjs` (shelled out to by `it0-dod-check.ts` clause 14) and the fast-mode-reused pure functions that were extracted into their consumers (`computeTouchesExpansion` → `concurrent-batch-scheduler.ts`; `parsePlanStages`/`validatePlanStructure` → `prepare-admission-check.ts`; `mapEvidenceToTasks` + composite types → `build-evidence-manifest.ts`). The mechanics below that reference the deleted files are kept as historical record of WHY the two-layer mode exists; the live driver for new work is the two-layer fast mode (fast-mode telemetry aggregated under `milestones/fast-mode-telemetry/<date>.json` — the old `.quay/fast-mode-telemetry.jsonl` path was drifted/never-existing, fixed 2026-08-05 by manager finding; `## Contract` six-key + `task-contract-check.ts` replacing ProposalReview/PlanCheck, subagent REFUTE rounds replacing the Audit phase).
```

---

## R19 — RETIRED classic loop 的直接-master 工作树隔离历史记录（Land 锁 / 串并行机制）

**来源**：`CLAUDE.md` Architecture — methodology layer
**退役**：ADR-022, 2026-08-03
**正文**（原文迁出保留）：

```
- **The loop ran directly on `master`** (there is no driver branch — DIR-027 retired it) **under the RETIRED classic loop** (ADR-022). The worktree-isolation mechanics below are kept as historical record of the classic loop's concurrency design; the two-layer fast mode isolates per-task via a plain `git worktree add` directly (no `milestone-worktree.ts` — that tool was retired after the 2026-08-03 reclaim). **The path convention is `/home/yale/work/quay-worktrees/<task-id>`, NOT `/tmp/quay-wt-<task>` — worktrees must not live in `/tmp`**（**2026-08-12 实测更正**：本机 boheidc 的 `/tmp` **不是 tmpfs**——`stat -f` 报 ext2/ext3、`findmnt` 无独立条目,即它在根文件系统上。原文"`/tmp` is tmpfs here"应是在前一台宿主（vhs）上写的,**换机器即失效——与硬规则 4 推论二同族：把依赖宿主的事实写成普适断言**。**规则本身不变**（worktree 仍不放 `/tmp`）,只是它的理由不再是"内存盘",而是：`/tmp` 会被系统清理、且本机已实测积压 3389 个测试遗留目录/1.1G,不适合放需要存活的工作副本。） (正本 `orchestration/inner-brief-2026-08-04-restart.md:103`). **The only correct in-flight reading is therefore `git worktree list | grep -c quay-worktrees`** — an `ls` of any `/tmp` path silently returns 0 and disguises a working inner as an idle one (实证 2026-08-10：我照 `/tmp` 数了 5 轮 `worktree=0`，真值是 1，而我自己执行核的 A3 早就写着上面那条正确命令 —— **手搓复现了机件已经解决的问题，正是硬规则 1 的反面**). **Default (no-isolation) path — strictly serial:** with no `isolationMode` arg, `execute-milestone.js`'s Build phase edits "in place, commit, done" directly in the shared working tree, so **two default `execute-milestone` dispatches must never run concurrently against this repo, regardless of whether their tasks' own `## Touches` are disjoint** — the risk is the shared working tree itself (uncommitted Build-phase state colliding), not task-level file overlap; wait for one milestone's Land commit before dispatching the next. **Opt-in concurrent-safe path (DIR-123, 2026-07-31):** passing `$a.isolationMode: 'worktree'` routes Build/Audit/Gate through a REAL per-milestone `git worktree` (`milestones/M<NN>/worktrees/iteration-0`, created by `scripts/milestone-worktree.ts` before Build), so a file-disjoint dispatch's uncommitted state lives in its own worktree, NOT the shared checkout. **Land is the SOLE phase that touches the shared checkout, and it is serialized by a single-flight Land lock (`.quay/land-locks/shared-checkout.lock`) held for the ENTIRE Land phase** — not just the merge: in the SERIAL path the lock is acquired before the real `git merge --no-ff` of the worktree branch + `git worktree remove`/`git branch -d` and released only AFTER the CAPTURE commits, the dashboard.md `## Log` append, the `milestone_counter` increment, and the `it0-backlog-regen.ts` regeneration, so two concurrent worktree Lands serialize over EVERY shared-checkout mutation (no lost-update on `milestone_counter`/`dashboard.md`/`backlog.md`, no git-index/HEAD race on CAPTURE). In the CONCURRENT (`mode:'concurrent'`) path the workflow merges NOTHING — it returns `buildBranch` and the fan-in (`OUTER-LOOP.md` step g) is the SOLE merge owner, doing each survivor's merge + CAPTURE + worktree-remove under that same Land lock. The lock uses the atomic `wx`-create grant with an `rmSync` + retry-`wx` bounded-loop stale reclaim (mirroring `proposal-convergence.ts`'s hardened epoch lock — never a plain overwrite, never a permanent lockout). A crashed dispatch that stranded a worktree was recovered by `milestone-worktree.ts --clean-stale` (retired 2026-08-03 after the reclaim; cleans only a branch with ZERO commits ahead of master; a branch WITH commits fails closed to needs-human, never discarded). Pre-dispatch eligibility for concurrent dispatch REUSES the existing `concurrent-batch-scheduler.ts`'s `assembleBatch` → `touches-orthogonality-check.ts`'s `checkTouchesPair` as the real production eligibility mechanism (the named `worktreeDispatchEligibility` is a thin TEST-FACING wrapper over `assembleBatch` that additionally tags same-file conflicts — it has no separate production callers). Same-file overlap → rejected pre-dispatch and serialized, never left to collide at Land; a real merge conflict that nonetheless reaches Land is auto-aborted + needs-human, never a blanket --ours/--theirs. A requested-but-unusable isolation (unknown mode, or no numeric milestone) FAILS CLOSED rather than silently falling back to the shared tree. Omitted/empty `isolationMode` is byte-for-behavior the old direct-on-`master` path (golden-replay-proven; the only legacy delta is Land's corrected step-1 prompt text). **HARD PRECONDITION (mixed modes):** the default (no-isolation) path takes NO Land lock and commits directly to master in Build, so it is NOT serialized against worktree Lands — therefore a no-isolation dispatch must NEVER overlap a concurrent batch against the same checkout; concurrent batches are worktree-isolated BY CONSTRUCTION (`OUTER-LOOP.md` step a always passes `isolationMode:'worktree'`). **Status (RETIRED under ADR-022):** mechanism + concurrency-safety fixes were implemented and real-git fixture/golden-replay/lock tested; the "two genuinely concurrent real milestone journals" proof never ran because the classic loop was retired before it. The two-layer fast mode is the sole mode.
```

---

## R20 — prepare-milestone.js worktree-isolation 支持（RETIRED under ADR-022）

**来源**：`CLAUDE.md` Architecture — methodology layer
**退役**：ADR-022, 2026-08-03
**正文**（原文迁出保留）：

```
- **`prepare-milestone.js` also supported the SAME opt-in `isolationMode: 'worktree'`** (gap-prepare-milestone-no-worktree-isolation, M252) — **RETIRED under ADR-022** (the file is deleted; kept as historical record): a per-milestone `git worktree` (`milestones/M<NN>/worktrees/iteration-0`, branch `milestone/M<NN>/iteration-0` — the SAME path/branch convention execute-milestone's Build worktree uses) was created via `milestone-worktree.ts --add` BEFORE the Admission lease is acquired; coordination primitives (Admission lease, epoch records, generation telemetry, split-decision records) stayed in the primary checkout while CONTENT outputs (task Proposal/Plan edits, `docs/plans/*.md`, receipt/ledger/inventory files, ProposalReview checkpoints) happened EXCLUSIVELY in the worktree. Content-agent prompts carried a single module-level `_worktreeIsolationNote` prefix (empty string when isolation is off → byte-for-behavior golden replay) that routed agents to `cd <worktree>` and use Bash `cat`/`>>` instead of the MCP `task_get`/`task_write` (which resolve against the primary checkout). Every terminal return was wrapped by `_wtRet`, adding `worktreeRel` so a stranded worktree was discoverable by the caller. **prepare-merge** (AFTER Receipt success + lease release): commit worktree changes (`git add -A && git commit`) → `milestone-worktree.ts --merge` (real `git merge --no-ff`) → `--remove`; a merge conflict auto-aborts leaving master clean and the worktree intact, returning needs-human `prepare-merge-conflict` + the conflict file list (the lease is already released, so a merge failure never strands it). In CONCURRENT mode (`$a.mode === 'concurrent'`, AC8), prepare-merge COMMITS-ONLY on the branch and returned `{ outcome: 'building', buildBranch, worktreeRel }` — it did NOT merge/remove/take the Land lock; the fan-in (`OUTER-LOOP.md` concurrent_execute step g) was the SOLE merge owner of prepared worktrees before any execute-milestone dispatch. The concurrent prepare dispatch proof (two file-disjoint tasks on `master`) was task #22's scope; the mechanism was opt-in, not the default, and never became it.
```

---

## R21 — integration-branch-model.ts RETIRED 头注（AC48）

**来源**：`plugin/scripts/integration-branch-model.ts` 头注释
**退役**：AC48 判据2, 2026-08-13
**正文**（原文迁出保留）：

```
// integration-branch-model.ts — the two-line branch model core.
//
// RETIRED (AC48 判据2, 2026-08-13 — tasks/gap-ac48-code-retirement-pool-filter-and-scripts; catalog
// note per AC52): the two-line integration-branch model is retired. The branch itself was deleted and
// config merge_target → develop by the outer (d41feba6/fc39e997); under the new model every task forks
// from develop (`$FORK_BASELINE`, all tasks from develop) — `forkBaseline()` has ZERO production
// callers (confirmed 2026-08-13). This file is KEPT AS THE REASON ARCHIVE (not deleted): it and
// integration-batch-merge.sh + SPEC-branching-model-integration-branch-2026-08-05.md document the
// two-line model's design, its empirical negation, and the reverse-edge ruling. No production path
// should call it; the exported functions remain unit-tested for the archive only.
```

---

## R22 — integration-batch-merge.sh RETIRED 头注（AC48）

**来源**：`plugin/scripts/integration-batch-merge.sh` 头注释
**退役**：AC48 判据2, 2026-08-13
**正文**（原文迁出保留）：

```
# integration-batch-merge.sh — the integration→develop batch-merge helper of the two-line branch
# model (gap-branch-model-integration-branch-splits-fork-baseline-from-merge-point, AC3; real-merge
# mode per gap-integration-batch-merge-ff-only-contradicts-real-merge-ruling).
#
# RETIRED (AC48 判据2, 2026-08-13 — tasks/gap-ac48-code-retirement-pool-filter-and-scripts; catalog
# note per AC52): the two-line integration-branch model is retired — the branch was deleted and config
# merge_target → develop by the outer (d41feba6/fc39e997); every task now forks from develop and the
# verification-round merges directly to develop. This script is KEPT AS THE REASON ARCHIVE (not
# deleted): it + integration-branch-model.ts + SPEC-branching-model-integration-branch-2026-08-05.md
# document the two-line model's design, its empirical negation (2026-08-06), and the reverse-edge
# ruling. No production path should invoke it.
```

---

## R23 — SPEC-branching-model-integration-branch 🚫 退役块（AC48）

**来源**：`orchestration/SPEC-branching-model-integration-branch-2026-08-05.md` 顶部
**退役**：AC48 判据2, 2026-08-13
**正文**（原文迁出保留）：

```
**🚫 退役（2026-08-13，AC48 判据2）**：integration 分支已退役——per-task 验证模型
（`SPEC-per-task-suite-verification-2026-08-13.md`）取代了它：每个任务从 develop fork、worktree 内跑全量、
绿后直接 merge 回 develop，**不再使用 integration 分支**。退役证据：`develop..integration = 0`（无独有内容）、
`integration..develop = 187`（落后）、无生产路径写它（fork 恒 develop / fan-in 恒 develop）。本文件保留为
**理由档案**（为什么当初要两线、实测如何否定了 FF-only 假设），不删；AC/DoD 与是否立案由外层判断。
```

---

## R24 — 旧「单飞挂载 + 共享事件」设计及 heavy-op-token.sh 整体退休（fast-mode-loop-tick 观测流）

**来源**：`plugin/loop/fast-mode-loop-tick.md` 事件式监测（谁挂的谁拥有自己的 stdout 事件流）
**退役**：2026-08-06 人裁定整体退休
**正文**（原文迁出保留）：

```
（旧的「单飞挂载 + 共享事件」设计及 `heavy-op-token.sh` 已随人裁定整体退休。）
```
