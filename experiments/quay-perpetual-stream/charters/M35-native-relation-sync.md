# Charter M35-native-relation-sync — bidirectional parent/children relation
# writes in the native provider (matching github's writeRelations() contract)

**Milestone id:** M35-native-relation-sync · **surface:** provider-abi (product-touching:
`packages/quay-native/src/store.js`, `bin/quay-native.js`, `src/mcp-server.js` if a signature change
propagates) · **type:** exploit (real, dogfooding-confirmed data-integrity bug), capability-growth
**Source:** `tasks/exp5-M-NATIVE-RELATION-SYNC.md` (SELECTed m35) — forward-looking candidate created
@m28 DRAIN/SELECT boundary from `M28-outcome-eval`'s Scenario 5, gap `G-S5-01`. Not selected @m29
(M-QUAY-CLI-CREATE-ERGONOMICS chosen instead, anchored on the then-more-severe GAP-002).
**Charter authored:** m34→m35 boundary, 2026-07-19. Base commit: `exp5-outer-driver` HEAD `26f8f0e`
(post-m34-publish-and-sync, confirmed via `git rev-parse exp5-outer-driver`).

## SELECT reasoning (do not silently assume — required by M33/M34's own Note-for-ABSORB discipline)
Two open candidates at this DRAIN boundary: `exp5-M-NATIVE-RELATION-SYNC` (this milestone) and a
DIR-017 Step 3-sourced candidate (leakage metrics onto `dashboard.md`, not yet materialized as a
task). Chose `exp5-M-NATIVE-RELATION-SYNC` to diversify the value portfolio — M25/M30/M32/M34 have
all been governance/method-infra (DoD-program lineage); this is a real, dogfooding-confirmed
data-integrity asymmetry on a product surface (`surface:provider-abi`), continuing the M12-abi-parent-
write lineage instead. DIR-017 Step 3 remains genuinely open and stays in `directives/pending/` for a
future SELECT — not dropped, just not chosen this cycle.

## Acceptance Criteria / Definition of Done
Authored into the task, not duplicated here — see `tasks/exp5-M-NATIVE-RELATION-SYNC.md`'s
`## Acceptance Criteria` (5 checklist items, checklist form per DIR-020/M34) and
`## Definition of Done` sections.

## Value hypothesis
- Value type(s): **exploit (primary)** — fixes a real, dogfooding-confirmed provider-ABI asymmetry
  (native's `write()` leaves the OLD/NEW parent's `children` array un-synced when a child's `parent`
  field is edited; github's `writeRelations()` is fully bidirectional). **capability-growth
  (secondary)** — closes a gap in the Provider-ABI cross-provider contract directly relevant to
  M12-abi-parent-write's own prior work.
- **Direction decided at charter-authoring time (per the task's own instruction not to defer
  further): direction (a)** — add a `writeRelations()`-style bidirectional-sync mechanism to
  `store.js`'s `write()` path, NOT direction (b) (document children as non-authoritative). Reasoning:
  native and github are two providers behind the SAME Provider-ABI surface; ABI-surface callers
  (CLI, MCP tools, any future provider-agnostic caller) must see the same relation-write contract
  regardless of provider, per M12-abi-parent-write's own established expectation. Direction (b) would
  push the asymmetry onto every caller instead of fixing it once at the chokepoint.
- **Δv̂:** VT chart-1, `surface:provider-abi` cell — a correctness fix to an already-scored surface,
  same precedent as M29 (CLI, +0.50)/M33 (Web UI, +0.40): small Δcov bump (e.g. +0.02-0.04 depending
  on how central relation-integrity is judged to the surface) — re-confirm the exact weight/current
  cov against `v-tracker.md`'s live chart-1 at charter-dispatch time, do not assume from this
  charter's placeholder.
- Metric `Y`: the task's 5 Acceptance Criteria, verbatim (see task file).

## Current-state notes (re-verified directly against source at charter-authoring time)
- `packages/quay-native/src/store.js`'s `write(id, {..., parent, children, ...})` (lines 309-352) is
  the SINGLE chokepoint both `bin/quay-native.js` (CLI, lines ~142/171) and `src/mcp-server.js` (MCP
  tool, line ~108) funnel through — confirmed via direct grep, no other write path exists. This is
  where the sync logic belongs; no ABI-surface signature change is required if the fix stays internal
  to `write()`'s implementation (do not widen scope to touch CLI/MCP call sites unless the sync logic
  genuinely cannot live inside `write()` alone).
- Today: editing a task's `parent` field only updates that task's own `frontmatter.parent` (line 335,
  `if (parent !== undefined) frontmatter.parent = parent;`) — no code anywhere in `store.js` reads or
  writes ANY OTHER task's `children` array as a side effect. Grep for `syncChildren`/`syncParent`/
  `reparent` in `store.js` returns nothing (confirms M28's finding still holds unpatched).
- Reference model: `packages/quay-github/src/github-client.js`'s `writeRelations()` (lines 771-830) —
  on a `parent` field write, re-derives `buildParentIndex()` from a full issue fetch, removes the
  child's reference from every CURRENT parent not equal to the new target, then adds it to the new
  target if not already present. Children-field writes and parent-field writes are applied
  independently (children first, then parent) in github's version — mirror this ordering unless a
  concrete reason argues otherwise (document if diverging).
- Native's storage model differs materially from github's (files on disk vs. issue-body checkbox
  markdown; per-id advisory file lock via `withLock`/`acquireLock`, lines 108-155, vs. github's
  API-call-per-issue model) — do NOT port github's implementation mechanically; re-derive the
  equivalent behavior (remove from old parent(s)' children array, add to new parent's children array)
  using native's own lock/read-modify-write primitives.
- **Lock-order risk (flag explicitly, do not silently accept):** `write()` currently locks only the
  target id (`withLock(id, ...)`, line 317). A parent-sync fix must touch the child's file AND one or
  two parent files. Any implementation must reason explicitly about lock ordering (e.g. always lock in
  a fixed order — child, then old parent(s) sorted, then new parent — or perform each file's
  read-modify-write as its own independently-locked step) to avoid a deadlock if two concurrent writes
  reference the same two ids in opposite order. State the chosen strategy and why it's deadlock-safe
  in the report.
- `packages/quay-native/test/` has 10 existing test files (`cas-write.test.mjs`, `lock.test.mjs`,
  `edit-validation.test.mjs`, etc.) — an established Node test-runner convention to extend, not a new
  framework to introduce. `surface:provider-abi` covers `packages/quay-native/`, which IS
  product-touching (test-floor Clause 7 applies, ≥80% real coverage of the new sync logic required).

## In scope
1. Implement bidirectional parent/children sync inside `store.js`'s `write()` path: writing a task's
   `parent` field removes the task id from every OTHER task currently listing it as a child (if the
   store can efficiently determine "every other task" — see item 2) and adds it to the new parent's
   `children` array (if not already present).
2. `store.js` currently has no reverse index ("which tasks list X as a child") — `list()` (confirm
   exact signature/behavior directly, do not assume) may need to be used internally to scan all tasks
   for the old-parent-removal step, mirroring github's `buildParentIndex()`-over-a-full-fetch pattern.
   State the chosen approach and its complexity/cost tradeoff explicitly in the report (a full-directory
   scan on every parent-write is the simplest correct approach at this scale; do not over-engineer an
   index unless the implementer judges the scan cost genuinely prohibitive).
3. Resolve the lock-order risk flagged above with a stated, reasoned strategy; add a test that
   exercises the multi-file write path (does not need to prove deadlock-freedom formally — a
   concurrent-edit test mirroring `cas-write.test.mjs`'s existing pattern is sufficient evidence).
4. Add real, run tests in `packages/quay-native/test/` covering: (a) reparenting a child updates both
   old and new parent's `children` arrays; (b) unsetting a parent (`parent: null`) removes the child
   from its former parent's `children` without adding it anywhere; (c) a live before/after
   demonstration (CLI or MCP call, per the task's AC item 5) reproducing M28's original repro scenario
   showing the fix.
5. Update or add doc/comment references analogous to github-client.js's existing writeRelations()
   documentation block, at the corresponding new/modified code in store.js, explaining the contract
   this now provides (concise — do not over-document; match the existing comment density/style in
   `store.js`, e.g. the ADV-004 comment block's level of detail is NOT the bar to match for a smaller
   change).

## Explicitly OUT of scope
- Direction (b) (document-only, non-authoritative children) — explicitly rejected above.
- Changing the CLI or MCP tool signatures/call sites unless the sync logic genuinely cannot live
  entirely inside `write()` — if a signature change turns out to be unavoidable, state why in the
  report rather than silently expanding scope.
- Porting github's checkbox-markdown-specific mechanics (`setChildCheckboxes`, `extractChildRefs`) —
  native has no equivalent markdown-checkbox body format; irrelevant to this fix.
- Building a persistent reverse-index data structure/cache — a full-directory scan per parent-write is
  acceptable at this milestone's scale (see item 2 above); do not add caching/indexing infrastructure
  unless correctness genuinely requires it.
- V_meta consolidation-lag gate: N/A pending re-confirmation at ABSORB — `v-meta-ledger.md`'s one row
  is already `consolidated` (m7), no `confirmed`-and-unresolved rows exist as of m34 (re-confirm, not
  assumed here).
- Design-only-milestone impl-row/escrow-Δv gates: N/A — ships real code/test changes directly.

## Done-when (binary clauses)
Mirrors the task's 5 Acceptance Criteria exactly (see `tasks/exp5-M-NATIVE-RELATION-SYNC.md`) plus:
1. Reparenting a child correctly removes it from the old parent's `children` and adds it to the new
   parent's `children`, verified by a real, run test (not asserted).
2. Unsetting a parent (`parent: null`) removes the child from its former parent's `children` without
   adding it anywhere.
3. Lock-order strategy for multi-file writes is stated and reasoned about explicitly; a
   concurrent-edit test exercises the multi-file write path.
4. Full existing `packages/quay-native/test/` suite still passes (no regression) alongside the new
   tests; ≥80% real coverage of the new sync logic specifically (Clause 7 test-floor).
5. `git diff --stat` confirms only `packages/quay-native/` (+ this milestone's own task/charter/
   dashboard bookkeeping files) touched; no unrelated files touched.

## HARD GATES (by-reference — see `experiments/quay-continuous-bootstrap/ITERATION-PROMPTS.md` lines
100-131 for the full literal text; both dispatched iteration prompts must include it verbatim):
GATE-HASH-REF: 5023da8232f12579e9a8db0ce26c5a5d1aadd5a7d095380016636330c63d2c93 (experiments/quay-continuous-bootstrap/ITERATION-PROMPTS.md lines 100-131)
gate-hash-by-reference mode: `it0-gate-hash-check.sh --by-reference` against this charter file, run
immediately before dispatch and re-confirmed unchanged (same discipline as M25-M34). The manda healthz
gate and port-4173 reachability gate are N/A this milestone (no Web UI surface touched) — state N/A
explicitly in each iteration's report, do not silently omit.

## it0 checks (run at charter-authoring time, before dispatch)
- `it0-ceiling-line-budget-check.sh` against this charter: 5 in-scope items — under the small-milestone
  threshold (8). PASS expected, re-confirm before dispatch.
- `it0-impl-row-check.sh exp5-M-NATIVE-RELATION-SYNC backlog.md`: not design-only, gate does not apply
  — PASS expected (re-run after `backlog.md` regen picks up this task's new row).

## Per-milestone acceptance audit (UNCONDITIONAL, `inherited-core.md` Clause 1)
Runs regardless of VT cadence. Dispatch a fresh-context, out-of-band adversarial-audit subagent at
ABSORB, refute-first stance against this task's 5 AC clauses + DoD. Must independently re-run the new
tests (not trust the implementation's self-report), and independently reproduce at least one of the
before/after `task view` demonstrations against the merged state directly (not read the report's
transcript as evidence). Per DIR-020/M34, the audit also ticks `- [x]` on each AC/DoD checklist item
it confirms, via a direct write-back to `tasks/exp5-M-NATIVE-RELATION-SYNC.md` — this is now the
standing mechanism (not novel to this milestone), state each tick's evidence inline as M34's audit did.

## Note for ABSORB
1. Confirm the multi-file lock-order strategy was reasoned about (not just tested) — cite the actual
   text/comment in the diff, not an assertion.
2. Confirm test-floor Clause 7 is satisfied with REAL run coverage of the new sync logic (not a bare
   percentage claim) — cite the actual test file(s) and what they exercise; a `WAIVER:` line is
   available (M33 precedent) only for a genuinely untestable-in-sandbox path, not as a shortcut.
3. Re-confirm VT chart-1's current cov/weight for `surface:provider-abi` directly against
   `v-tracker.md` before recording Realized Δv — do not reuse this charter's placeholder estimate
   unverified.
4. **Checkpoint cadence: DUE at THIS milestone's ABSORB.** `milestone_counter` becomes **35** at this
   ABSORB (m34 set it to 34) — the every-5-milestone non-blocking checkpoint is due now (last written
   cp-30). Do not miss it — write the checkpoint as part of this ABSORB, before continuing to m36.
5. State the m36 DRAIN/SELECT candidate note explicitly (per the same discipline used at m32→m33→m34→
   m35): after this milestone, what open candidates remain (DIR-017 Step 3 still open; check whether
   any new forward-looking candidates were created this cycle) — do not silently default.

## Dispatcher notes
Dispatch two independent `baime:iteration-executor` agents off this charter's base commit, same
worktree/branch-per-iteration pattern as M25-M34 (`experiments/quay-perpetual-stream/milestones/
M35-native-relation-sync/worktrees/iteration-{0,1}`, branches `exp5-m35-iteration-{0,1}`). Iteration-1
must NOT read iteration-0's materials (independent-verification discipline). Both iterations must
re-read `store.js`'s actual current `write()` code directly (not assume from this charter's summary)
before modifying it, and must run the FULL `packages/quay-native/test/` suite themselves (not just
their new tests) before reporting completion, confirming no regression.
