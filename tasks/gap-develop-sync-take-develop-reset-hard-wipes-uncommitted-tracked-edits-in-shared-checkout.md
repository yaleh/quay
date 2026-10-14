---
id: gap-develop-sync-take-develop-reset-hard-wipes-uncommitted-tracked-edits-in-shared-checkout
title: doc↔develop 同步的 take-develop 对共享主检出 reset --hard 前不查脏工作树：ClaudeCodeUI
  已授权的 .quay/config.yml 启用被静默抹掉（9+4 次 reset 历史）
status: ready
labels:
  - gap
  - defect
parent: null
children: []
extra: {}
---
## Proposal
**Sibling of `gap-develop-sync-reset-hard-destroys-third-party-project-tree` (done). That task guarded the doc↔develop sync's `git reset --hard develop` against discarding unique *commits*. It does not guard uncommitted *working-tree* changes to tracked files, and that half has now destroyed operator configuration on a real host.**

**Measured 2026-10-14 on ClaudeCodeUI (`.quay/doc-develop-sync.jsonl` + main-checkout reflog):**
```
06:43:39Z doc-develop-sync-ff-error  phase=merge  "untracked working tree files would be overwritten by merge: experiments/voice-realtime-relay-mode-replay/{README.md,digest.py}"
06:43:41Z doc-develop-sync-semantic  phase=begin  branch=author
06:43:48Z doc-develop-sync-semantic-conflict  phase=merge
06:43:48Z doc-develop-sync-semantic-resolved  phase=take-develop  resolution=discarded-doc-commits  discardedCount=0
reflog: HEAD@{2026-10-14 14:43:48 +0800} reset: moving to develop
```
`takeDevelopDiscardingDoc` (`plugin/scripts/driver-filters.ts`, `reset --hard develop` at `:533`) consulted only `discardedCommitsAreDisposable` (0 commits ⇒ "disposable") and reset the shared author checkout. That checkout held a human-authorized, then-uncommitted edit to the tracked `.quay/config.yml`: the `arch_discovery` and `discovery_method` enablement blocks plus an OSD budget value. The edit was silently wiped, and **both routines stopped being enabled on the host with no event naming the loss.** `driver-filters.ts` contains no dirty-tree check at all (`porcelain` / `dirty` / `stash` / `untracked`: 0 hits).

**Frequency (12b, history).** take-develop hard resets recorded: **ClaudeCodeUI 9** (latest 2026-10-08T17:03, 10-13T04:02, 10-13T14:01, 10-14T06:43), **quay 4** (2026-09-06, 09-07 ×2, 09-15). Every one of them would have discarded any uncommitted tracked edit in the shared checkout. The event record cannot say whether earlier ones did, which is itself the 3b gap: the sync records what it discarded in commits, never what it discarded in the working tree.

**Distinct from operator hygiene.** The fix is not "operators should commit faster". The shared main checkout is a documented live input that other layers write (CLAUDE.md hard rule 11b), so an automatic destructive operation on it must not destroy state it has not enumerated.

## Plan
1. Before any `reset --hard` on the shared checkout, enumerate `git status --porcelain` (tracked modifications + staged). If non-empty, **refuse** with a legible `doc-develop-sync-semantic-take-develop-refused` event listing the dirty paths. The working tree stays untouched, and the existing semantic-sync fallback ladder handles the refusal like any other refusal. Untracked files that block the merge are recorded as such, not "resolved" by reset.
2. Alternatively, preserve rather than refuse (a stash or patch saved under `.quay/` with its path in the event, re-applied after). Choose one and give the reason. **Refusing is the conservative default.** Preserving must prove the re-apply step, including conflict handling.
3. Record working-tree losses in the event schema, so that "reset discarded nothing" becomes a measured statement rather than an assumption.

## Acceptance Criteria
- [x] AC1: fixture: an author checkout with an uncommitted edit to a tracked file plus a sync conflict that triggers take-develop. Pre-fix: the edit is gone after sync, and the event says `discardedCount:0` (pasted negative control). Post-fix: the edit survives and the event lists the dirty path with a refusal (or preserve) reason (pasted).
- [x] AC2: a clean tree with the same conflict behaves exactly as before: reset proceeds, event unchanged (pasted).
- [x] AC3: the untracked-blocks-merge case seen in production (`untracked working tree files would be overwritten by merge`) is recorded with the blocking paths and does not cause a tracked-file loss (fixture pasted).
- [x] AC4: `scripts/test.sh --for-task <this task>` green.

## Definition of Done
- AC1-AC4 checked with pasted evidence. No change to the commit-discardability guard from the sibling task.

## Touches
- tasks/gap-develop-sync-take-develop-reset-hard-wipes-uncommitted-tracked-edits-in-shared-checkout.md
- plugin/scripts/driver-filters.ts
- plugin/test/driver-filters.test.mjs

## Evidence（内层实现 2026-10-14）

**实现（Plan 点 1；选定【拒绝】）**：`takeDevelopDiscardingDoc` 在 `git reset --hard develop` 之前新增一道【工作树】守卫 `workingTreeDirtiness`（`git status --porcelain --untracked-files=all`），判定序：读不懂 ⇒ 拒绝（fail-closed）；有已跟踪文件的未提交改动 ⇒ 拒绝（`reason: dirty-working-tree`）；未跟踪文件的路径存在于 develop 树中（`reset --hard` 会静默覆盖）⇒ 拒绝（`reason: untracked-would-be-overwritten`）。拒绝 ⇒ 落一条可区分的 `doc-develop-sync-semantic-take-develop-refused` 事件（携带 `offendingPaths` + `workingTree:{trackedDirty,untracked}`），工作树原样不动、`return false`。干净树 ⇒ 行为逐字不变（`resolved` 事件**不带** `workingTree` 键）。⛔ 未改 sibling 任务的 `discardedCommitsAreDisposable`（DoD）。

**为何【拒绝】而非【保留】（Plan 点 2 要求给出理由）**：拒绝是 Plan 点明的保守默认；保留（stash/patch + re-apply）必须证明 re-apply 步（含冲突处理），凭空多一条失败路径（「stash 重放冲突」），并把「同步是否成功」与「重放是否成功」两件事耦合。拒绝零副作用、可证（工作树未被触碰），且既有语义兜底阶梯已把任何 refusal 当普通拒绝处理。用 `--untracked-files=all`：裸 porcelain 把未跟踪目录折叠成 `?? dir/`，使「路径是否在 develop 树里」判据失真（实测 `experiments/x/README.md` → `?? experiments/`）。

**AC1 — pre-fix 负控制**（在 develop 检出的【未修】代码上跑同一夹具；探针脚本在临时工作树，未提交）：
```
BEFORE  git status:  M .quay/config.yml          BEFORE config.yml has arch_discovery?  true
AFTER   syncDocDevelopBidirectional => synced
AFTER   config.yml:  providers / native / enabled: true / # develop-side change   （arch_discovery 行消失）
AFTER   config.yml has arch_discovery?  false   (⛔ false = 编辑被抹掉)   AFTER HEAD == develop?  true
EVENTS:
 {"event":"doc-develop-sync-ff-error","phase":"merge","detail":"error: Your local changes to the following files would be overwritten by merge: | \t.quay/config.yml | Please commit your changes or stash them before you merge."}
 {"event":"doc-develop-sync-semantic","phase":"begin","branch":"author"}
 {"event":"doc-develop-sync-semantic-conflict","phase":"merge","branch":"author"}
 {"event":"doc-develop-sync-semantic-resolved","phase":"take-develop","branch":"author","resolution":"discarded-doc-commits","discardedCount":0,"discarded":[]}
```
pre-fix：未提交的已跟踪改动被抹掉，事件序列与生产逐字同形（ff-error phase=merge → semantic → conflict → resolved take-develop **discardedCount:0**）。

**AC1 — post-fix**（`plugin/test/driver-filters.test.mjs`，测试 `AC1 — author 检出上有【已跟踪文件的未提交改动】阻塞 merge ⇒ 拒绝 take-develop，改动存活`）：PASS。断言：`config.yml` 内容仍含 `arch_discovery`（直接量）；HEAD 未落在 develop（未 reset）；`refused.reason == "dirty-working-tree"`；`offendingPaths` 含 `.quay/config.yml`；`workingTree.trackedDirty == [".quay/config.yml"]`；`discardedCount == 0`；无 `resolved` 事件。

**AC2**（测试 `AC2 — 干净工作树 + 同样走终局解 ⇒ 行为与 pre-fix 逐字不变`）：PASS。干净树 ⇒ `reset --hard develop` 照旧执行（HEAD == develop），`resolved.resolution == "discarded-doc-commits"`、`branch == "author"`、**`"workingTree" in resolved === false`**（事件逐字不变），无任何 refusal 事件。（注：clean 树只能经**已提交的**结构冲突走到终局解——AC1 那种「工作树阻塞 merge」在 clean 树上结构上不成立，故 AC2 用 modify/delete 结构冲突夹具；走的是同一条终局解路径。）

**AC3**（测试 `AC3 — 生产形态：未跟踪文件阻塞 merge（develop 树里有同名路径）被记录，且无已跟踪文件损失`）：PASS。夹具 = author 落后 develop + 未跟踪 `experiments/voice-realtime-relay-mode-replay/README.md`（develop 树里有该路径）+ 已跟踪未提交改动 `docs/notes.md`。断言：`doc-develop-sync-ff-error`(phase=merge) 的 detail 命中 `/untracked working tree files would be overwritten by merge/`（= 生产 06:43:39 那条）；`docs/notes.md` 的未提交改动存活（**无已跟踪文件损失**）；refused 事件 `workingTree.untracked` 含阻塞路径；未跟踪文件本身未被覆盖。附 `AC3②`：仅未跟踪（无已跟踪改动）⇒ `reason == "untracked-would-be-overwritten"`（与 `dirty-working-tree` 可区分）。附 `AC3③`（纯函数）：`parsePorcelain` 按位置区分已跟踪改动/未跟踪/rename；非 git 目录 ⇒ `readable:false`。

**AC4 — scoped gate**：`bash scripts/test.sh --for-task gap-develop-sync-take-develop-reset-hard-wipes-uncommitted-tracked-edits-in-shared-checkout --allow-thin` ⇒ **exit=0**，`ℹ tests 90 / pass 90 / fail 0`，scoped static checks 全 PASS（含 test-isolation / checked-in-write / touches-one-entry-one-path / task-contract 等）。`tsc --noEmit` exit=0。anti-drift Touches check：`ANTI-DRIFT OK … 2 actual file(s), all within declared Touches`。
