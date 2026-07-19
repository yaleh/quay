# M35-native-relation-sync — iteration-0 self-report

**Branch:** `exp5-m35-iteration-0` (worktree:
`experiments/quay-perpetual-stream/milestones/M35-native-relation-sync/worktrees/iteration-0`)
**Base commit:** `48f0d8f` (SELECT m35) · **Head commit after this iteration:** `76f3c40`

## §0. Preconditions / HARD GATES

- **GATE-HASH-REF check:** ran `it0-gate-hash-check.sh --by-reference` against the charter ->
  `PASS: ... GATE-HASH-REF (5023da8232f12579e9a8db0ce26c5a5d1aadd5a7d095380016636330c63d2c93)
  matches current pinned source ... sha256.` The literal HARD GATES text (ITERATION-PROMPTS.md
  lines 100-131) is confirmed unchanged and applies verbatim.
- **`experiments/quay-continuous-bootstrap/directives/pending/` listing:** empty (`ls -1` returned
  nothing). No dispositions needed from that directory this iteration.
- **`experiments/quay-perpetual-stream/directives/pending/` listing:** one file,
  `DIR-017-dod-installation-program-mandatory-order-and-the-meta-enforcer-human-verified-foothold.md`.
  **Disposition: applied (already installed, no new action this iteration).** DIR-017 called for
  installing a standing, non-self-exemptible DoD meta-enforcer before other work proceeds; per prior
  iterations (DIR-017 gate cleared ~m31, DIR-019/M30 fixed the clause-5 blind spot) that mechanism
  is exactly `inherited-core.md`'s DoD clauses, which this milestone's own task file's
  "Definition of Done" section invokes directly (clauses 0/1/2/3/5/7). No further installation action
  is needed from this iteration; the directive's intent is already operative and this iteration
  operated under it (Clause 7 test-floor honored below).
- **manda `.manda/hub.addr` / healthz gate:** **N/A this milestone** — charter's own HARD GATES
  section states this explicitly ("no Web UI surface touched"), re-confirmed: this milestone touches
  only `packages/quay-native/`, no manda/hub involvement.
- **port-4173 reachability gate (G7):** **N/A this milestone** — same reasoning, no Web UI surface.
- **Worktree isolation:** all edits made under
  `experiments/quay-perpetual-stream/milestones/M35-native-relation-sync/worktrees/iteration-0/`,
  committed to `exp5-m35-iteration-0` directly (confirmed via `git log`/`git diff --stat` below).

## What I implemented

`packages/quay-native/src/store.js`'s `write()` now performs bidirectional parent/children sync,
matching the github provider's `writeRelations()` contract (github-client.js ~L771-830, read as the
reference behavioral contract only — its checkbox-markdown mechanics were NOT ported, per charter
scope):

1. **`findCurrentParents(id)`** — a full-directory scan (`listIds()` + per-file read/parse) that
   finds every OTHER task currently listing `id` in its own `children` array. No persistent reverse
   index was added (explicitly out of scope per charter); a scan is acceptable at this store's scale.
2. **`removeChildRef(parentId, childId)` / `addChildRef(parentId, childId)`** — small, focused
   read-modify-write helpers for mutating one other task's `children` array. Each is a no-op if the
   target state is already correct (idempotent), so a racing writer or an already-correct parent link
   is handled safely without duplicate entries or spurious writes.
3. **`write()`'s parent-write path** — when `parent` is part of the call (`parent !== undefined`,
   including `parent: null` to unset): pre-scans for current parents, removes `id` from every old
   parent that isn't the new target, and adds `id` to the new parent's `children` if not already
   present. `children` and `parent` fields, when both supplied in the same call, are applied
   independently in the same order github uses: children first, then parent (documented in the
   updated doc comment above `write()`) — there is no actual interaction between the two, this only
   matches the reference ordering for predictability.
4. The sync logic **only** runs when `parent` is explicitly part of the `write()` call
   (`parentWriteRequested = parent !== undefined`) — an unrelated field write (e.g. `title`) never
   triggers a scan or touches any other task's file. Verified by test case 4 below.

## Lock-order reasoning (deadlock-safety strategy)

**Chosen strategy:** a new `withLocks(ids, fn)` helper (alongside the existing single-id `withLock`)
that:
1. De-duplicates the full set of ids the operation needs (child + old parent(s) + new parent, via
   `[...new Set(ids)]`),
2. Sorts that set into **one fixed lexicographic order**,
3. Acquires every lock in that order (all-before-running-`fn`), and releases them in reverse order in
   a `finally` block.

`write()` computes its full lock set (`lockIds`) via an **unlocked pre-scan** (`findCurrentParents`)
*before* calling `withLocks`, so the complete set is known before any lock is taken.

**Why this is deadlock-safe:** the classic lock-ordering discipline — if every writer that needs
locks on some subset of ids always acquires them in the same global order, no two writers can each be
holding a lock the other is waiting for (a cycle in the wait-for graph is impossible when all lock
acquisition follows one total order). This directly addresses the charter's flagged risk: two
concurrent writes referencing the same two ids in opposite "natural" order (e.g. writer 1 wants
child-X1 then parent-A then parent-B; writer 2 wants child-Y1 then parent-B then parent-A) cannot
deadlock because both sort their needed locks into the same order before acquiring anything.

**Why the unlocked pre-scan is safe despite being racy against a concurrent parent-write:** the
child's own lock (`id`) is always in the acquired set, so once all locks are held, the actual mutation
re-reads each candidate parent's file fresh inside the lock (not the pre-scan's stale snapshot) — the
`removeChildRef`/`addChildRef` helpers are no-ops if the target state is already correct. A parent
relationship that changed between the pre-scan and lock acquisition is therefore re-validated, never
blindly trusted. The one residual gap (a brand-new concurrent parent relationship naming an id outside
the pre-scanned set) cannot corrupt anything: that other writer must itself lock the same child id, so
the two operations are fully serialized (one completes entirely before the other starts), not
interleaved — ordinary last-writer-wins sequencing, identical to how every other field this store
already handles concurrent writes. This reasoning is also stated as an in-code comment directly above
`write()` in `store.js`.

## Test results

**New test file:** `packages/quay-native/test/relation-sync.test.mjs` (+ helper process
`test/reparent-writer.mjs`, following the existing `concurrent-writer.mjs`/`cas-writer-helper.mjs`
convention of spawning a real separate Node process for concurrency proofs). 21 assertions, all
passing, covering:
- Case 1: reparenting updates BOTH old and new parent's `children` (the exact M28 repro shape).
- Case 2: reparenting to an already-listing parent does not create a duplicate entry; unrelated
  sibling children are untouched.
- Case 3: `parent: null` removes from the old parent and adds nowhere else (scanned across the whole
  store via `store.list()`).
- Case 4: writing an unrelated field (no `parent` key) does not trigger the sync scan or touch any
  other task.
- Case 5: two REAL, separate OS processes concurrently cross-reparent (child X1: A->B, child Y1: B->A —
  the lock-order-critical overlapping-pair case) — asserts both complete without hanging (no
  deadlock), `store.list()` still parses every file afterward (no corruption), both parents end up
  correctly cross-swapped, and no lock files are left behind.

Ran the new test file 3x in a row to check for flakiness in the concurrency case — stable, all pass
each time.

**Full existing suite** (`packages/quay-native/test/*.test.mjs`, 10 pre-existing files, run
individually via `node test/<file>.test.mjs` — the established per-file convention, no shared runner
script exists in this package): all 10 pass, unchanged, both **before** my change (baseline run) and
**after** (final run with the new test file included) —

```
PASS: test/adversarial-eval.test.mjs
PASS: test/cas-write.test.mjs
PASS: test/compound-gate-recursive.test.mjs
PASS: test/compound-gate.test.mjs
PASS: test/create-validation.test.mjs
PASS: test/edit-validation.test.mjs
PASS: test/gate-checked-state.test.mjs
PASS: test/gate-correctness.test.mjs
PASS: test/gate-gameability.test.mjs
PASS: test/lock.test.mjs
PASS: test/relation-sync.test.mjs
```

No regressions. Clause 7 test-floor: satisfied with real, run coverage (21 assertions across 5 cases,
including a genuine two-process concurrency proof) of the new sync logic specifically — no
`WAIVER:` needed.

## Before/after live demonstration (CLI, reproducing M28's exact repro scenario)

Ran against a scratch tasks dir (`/tmp/m35-demo`, cleaned up after), using the actual
`bin/quay-native.js` CLI end-to-end (not a unit-test-only demonstration).

**Setup:** `PARENT-A`, `PARENT-B` created; `CHILD-1` created with `--parent PARENT-A`; `PARENT-A`
edited to list `children: [CHILD-1]`.

**BEFORE the fix** (verified by `git stash`-ing my change and re-running the identical scenario
against a separate scratch dir): running `quay-native task edit CHILD-1 --parent PARENT-B` left the
bug exactly as M28 described —
```
-- PARENT-A (bug: still shows CHILD-1) --
children: ['CHILD-1']
-- PARENT-B (bug: stays empty) --
children: []
```

**AFTER the fix** (with my change applied), the same action:
```
### BEFORE reparent ###
-- PARENT-A -- children: ['CHILD-1']
-- PARENT-B -- children: []
-- CHILD-1 -- parent: PARENT-A

### Action: quay-native task edit CHILD-1 --parent PARENT-B ###
updated CHILD-1

### AFTER reparent ###
-- PARENT-A -- children: []
-- PARENT-B -- children: ['CHILD-1']
-- CHILD-1 -- parent: PARENT-B
```
`PARENT-A` correctly loses `CHILD-1`, `PARENT-B` correctly gains it, and `CHILD-1.parent` correctly
reflects `PARENT-B` — the bug is fixed, confirmed via the live CLI (not just the unit tests).

## `git diff --stat` summary

```
$ git diff --stat 48f0d8f 76f3c40
 packages/quay-native/src/store.js                | 156 +++++++++++++++++-
 packages/quay-native/test/relation-sync.test.mjs | 191 +++++++++++++++++++++++
 packages/quay-native/test/reparent-writer.mjs    |  14 ++
 3 files changed, 359 insertions(+), 2 deletions(-)
```

## Scope confirmation

Only `packages/quay-native/` files were touched (plus this report, which lives outside the worktree
at the shared milestone path per the dispatch instructions, and is therefore not part of the
worktree's own `git diff`). No CLI (`bin/quay-native.js`) or MCP (`src/mcp-server.js`) call-site
signature changes were needed — the sync logic lives entirely inside `write()`'s existing signature,
confirming the charter's "single chokepoint" premise held in practice. No checkbox-markdown mechanics
were ported from github-client.js. No persistent reverse-index/cache was added — `findCurrentParents`
is a plain per-call directory scan, as scoped.

## Notes / deviations

- None from the charter's explicit scope. Direction (a) (bidirectional sync) implemented as directed;
  direction (b) (document-only) not pursued.
- One judgment call not explicitly specified by the charter: `removeChildRef`/`addChildRef` degrade
  silently (no-op, no error) if a parent id's file has vanished concurrently or doesn't resolve to a
  real task — consistent with this store's existing pattern of failing soft on missing-file edge cases
  elsewhere (e.g. `childrenStatus`'s `"missing"` status classification) rather than throwing and
  aborting the child's own otherwise-valid write.
