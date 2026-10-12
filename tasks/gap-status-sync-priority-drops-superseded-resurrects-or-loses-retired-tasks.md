---
id: gap-status-sync-priority-drops-superseded-resurrects-or-loses-retired-tasks
title: status sync priority list omits 'superseded' ⇒ doc↔develop semantic sync
  resurrects (develop superseded→ready) or loses (author superseded) retired
  tasks — first independently-verified open-discovery finding
status: todo
labels:
  - gap
  - defect
  - open-discovery-finding
parent: null
children: []
extra: {}
---
## Proposal
**Origin: the first real hypothesis from open semantic discovery that was independently verified** (manual round 2026-10-12T18:4xZ, shadow arm guided by draft method `carrier-persistence-check`, hypothesis #4 "task-status vocabulary re-implemented as raw literals …"). The coordinator then verified it independently against the source and executed the function.

`plugin/scripts/driver-filters.ts:318` defines `STATUS_PRIORITY = ["todo","ready","needs-human","done"]`, and `resolveStatusPriority` (:330) filters out any status not in that list as "unreadable". `superseded`, a legal terminal status (`routine-file-gate.ts:378 CLOSED_TASK_STATUSES = ["done","superseded"]`), is therefore dropped. Measured by calling the exported function:

```
resolveStatusPriority("superseded","ready") => ready
resolveStatusPriority("ready","superseded") => ready
resolveStatusPriority("superseded",null)    => null
```

Consumer: `collectStatusAlignments` (:536-546) on the doc↔develop **semantic sync** path (`semanticSyncDocToDevelop`, :496), which is live in production: `.quay/doc-develop-sync.jsonl` has 94 `doc-develop-sync-semantic-resolved` and 144 `doc-develop-sync-semantic` events.
- **Case 1:** develop=`superseded`, author=`ready`/`todo`/`needs-human` ⇒ resolved = the live status ≠ develop ⇒ written back and ff-pushed to develop ⇒ **a retired task is resurrected as dispatchable.**
- **Case 2:** author=`superseded`, develop=live ⇒ resolved = develop's status ⇒ no alignment, and `merge -X theirs` keeps develop ⇒ **the retirement is silently lost.**

**Incidence so far (hard rule 12): 0 observed.** No task currently diverges author/develop on `superseded`. A history scan found no superseded→live reversal attributable to sync. So this is a latent mechanism defect, filed as a cheap fix, not a blocker.

## Plan
1. Put `superseded` into the deterministic order as a terminal status. A terminal status must never lose to a live one. Order: `todo < ready < needs-human < done`, with `superseded` terminal. `done` vs `superseded` must be decided explicitly; recommendation: keep `done` (it carries landed evidence) and record the tie in the sync event.
2. A status outside the vocabulary must not be silently dropped (hard rule 3b). Return a distinguishable `unknown:<value>` / not-evaluated so the alignment is skipped and an event is recorded, instead of letting the other side win.
3. Derive the vocabulary from the one canonical task-status list (the task schema / `TASK_STATUS`) rather than a fourth literal list; grep and paste the sibling literal lists (hard rule 5b).

## Acceptance Criteria
- [ ] AC1: unit tests: `(superseded, ready|todo|needs-human)` and the reverse ⇒ `superseded`; `(superseded, done)` ⇒ the documented choice; `(bogus, ready)` ⇒ an unknown/not-evaluated value, not `ready`. Negative control: restore the 4-element list ⇒ red. Paste.
- [ ] AC2: `collectStatusAlignments` on a fixture repo where develop has `superseded` and the author branch has `ready` produces NO alignment that writes `ready`. The reverse fixture writes `superseded`. Paste.
- [ ] AC3: the sibling literal status lists in `plugin/scripts` are listed (grep command + first 3 hits + count) and either derived from the canonical list or justified.

## Definition of Done
- `scripts/test.sh --for-task <this task>` green.

## Touches
- tasks/gap-status-sync-priority-drops-superseded-resurrects-or-loses-retired-tasks.md
- plugin/scripts/driver-filters.ts
- plugin/test/driver-filters.test.mjs
