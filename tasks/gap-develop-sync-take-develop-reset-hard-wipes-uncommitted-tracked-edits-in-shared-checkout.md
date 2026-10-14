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
- [ ] AC1: fixture: an author checkout with an uncommitted edit to a tracked file plus a sync conflict that triggers take-develop. Pre-fix: the edit is gone after sync, and the event says `discardedCount:0` (pasted negative control). Post-fix: the edit survives and the event lists the dirty path with a refusal (or preserve) reason (pasted).
- [ ] AC2: a clean tree with the same conflict behaves exactly as before: reset proceeds, event unchanged (pasted).
- [ ] AC3: the untracked-blocks-merge case seen in production (`untracked working tree files would be overwritten by merge`) is recorded with the blocking paths and does not cause a tracked-file loss (fixture pasted).
- [ ] AC4: `scripts/test.sh --for-task <this task>` green.

## Definition of Done
- AC1-AC4 checked with pasted evidence. No change to the commit-discardability guard from the sibling task.

## Touches
- tasks/gap-develop-sync-take-develop-reset-hard-wipes-uncommitted-tracked-edits-in-shared-checkout.md
- plugin/scripts/driver-filters.ts
- plugin/test/driver-filters.test.mjs
