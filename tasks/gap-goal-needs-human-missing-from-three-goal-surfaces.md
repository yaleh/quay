---
id: gap-goal-needs-human-missing-from-three-goal-surfaces
title: Goal status needs-human is missing from three goal surfaces registered as
  KNOWN_DRIFT with no owning task
status: ready
labels:
  - gap
  - architecture-discovery
parent: null
children: []
extra:
  schema: execution
  role: primitive
---
## Proposal
`plugin/scripts/enum-surface-parity-check.ts` registers three `goal-status` surfaces in `KNOWN_DRIFT`, each `missing: ["needs-human"]`, and each reason ends "归位待另行立案" (to be filed separately). No task was ever filed, so the drift has no owner. The ABI (`packages/quay/src/abi.ts` `GOAL_STATUSES`) and the store (`goal-store.ts` `VALID_GOAL_STATUSES`) both have 6 values, including `needs-human`. The surfaces are:
1. `serve-goal-status-order`: `packages/quay/src/serve-goal.ts` `GOAL_STATUS_ORDER` (around line 225). A needs-human goal sinks to the bottom as an "unknown" status, but it is a state that needs a human.
2. `serve-goal-status-tabs`: the `statusNav` literal `["draft","active","achieved","superseded","retired"]` in `serve-goal.ts` (around line 623). There is no filter link that reaches `?status=needs-human`.
3. `native-goal-write-desc`: the `goal_write` description in `packages/quay-native/src/mcp-server.ts` (around line 454) says `status ∈ draft|active|achieved|superseded|retired`.

The defect is latent: 0 goals are in needs-human today. The checker at HEAD prints "PASS: all 25 registered surfaces consistent (6 known drift, 0 not evaluated)".

<!-- dedup-ref --> `gap-enum-surfaces-hand-copied-across-cli-web-docs` (done) built the checker and decided needs-human belongs in the ABI. It left these three as reported-only ledger entries. The three driver-kind `KNOWN_DRIFT` entries (`start-drivers-kinds`, `claude-md-driver-kind`, `drivers-skill-kind`) are OUT of scope: each needs a judgment call (intended subset or stale copy), so they are not determinable.

## Plan
- Add `needs-human` to `GOAL_STATUS_ORDER`. Place it directly after `draft` (both need a human action). Update the order comment.
- Add `needs-human` to the goals-tab status filter list.
- Add `needs-human` to the quay-native `goal_write` description.
- Remove the three entries from `KNOWN_DRIFT`. The ledger is shrink-only.
- Do not touch `serve-dashboard.ts` `AC_ROLLUP_IN_DOMAIN_STATUSES`. It is an intentional subset with its own rationale and exhaustiveness test, and it serves as the negative control.
- **[found during implementation — the 5b carrier scan]** Two MORE goal-status delivery surfaces carried the same 5-value list and were NOT in the ledger, because the registry never knew about them: Core's own `goal_list` / `goal_write` tool descriptions in `packages/quay/src/mcp-handlers.ts`. They are a LATER surface than the registry (the `goal_*` family was re-exposed in Core on 2026-10-03 — see the comment above `registerGoalHandlers`), and the checker's `--discover` only finds array/string-union literals, so an `a|b|c` TEXT surface is structurally invisible to it (hard rule 5: "not found in a source ≠ absent"). Fixed here and REGISTERED (`core-goal-list-desc`, `core-goal-write-desc`) so they cannot drift silently again. Reporting them "for a later task" is precisely the pattern this task exists to fix — the ledger reason "归位待另行立案" is what left three surfaces ownerless in the first place.

## Acceptance Criteria
- [x] `node --experimental-strip-types plugin/scripts/enum-surface-parity-check.ts` exits 0, and its output reports `3 known drift` (down from 6) and `0 not evaluated`.
  - Evidence (all five goal-status surfaces now in sync — three fixed, two newly registered):
    ```
    $ node --experimental-strip-types plugin/scripts/enum-surface-parity-check.ts; echo "exit=$?"
      [in-sync] core-goal-list-desc (goal-status) packages/quay/src/mcp-handlers.ts — 6 值 {draft, active, achieved, superseded, retired, needs-human} · 差集为空
      [in-sync] core-goal-write-desc (goal-status) packages/quay/src/mcp-handlers.ts — 6 值 {draft, active, achieved, superseded, retired, needs-human} · 差集为空
      [in-sync] native-goal-write-desc (goal-status) packages/quay-native/src/mcp-server.ts — 6 值 {draft, active, achieved, superseded, retired, needs-human} · 差集为空
      [in-sync] serve-goal-status-order (goal-status) packages/quay/src/serve-goal.ts — 6 值 {active, draft, needs-human, achieved, superseded, retired} · 差集为空
      [in-sync] serve-goal-status-tabs (goal-status) packages/quay/src/serve-goal.ts — 6 值 {draft, needs-human, active, achieved, superseded, retired} · 差集为空
    PASS: all 27 registered surfaces consistent (3 known drift, 0 not evaluated)
    exit=0
    ```
  - ⚠️ The surface count reads **27**, not the 25 in the Proposal: the Plan's 5b bullet registered two surfaces the registry had never carried. The two numbers this AC pins (`3 known drift`, `0 not evaluated`) are unchanged by that; the three remaining ledger rows are the out-of-scope driver-kind ones.
- [x] `grep -c 'native-goal-write-desc\|serve-goal-status-order\|serve-goal-status-tabs' plugin/scripts/enum-surface-parity-check.ts` still finds the three registry rows, but none of them appears in the `KNOWN_DRIFT` array. The registry stays; only the ledger shrinks.
  - Evidence:
    ```
    $ grep -c 'native-goal-write-desc\|serve-goal-status-order\|serve-goal-status-tabs' plugin/scripts/enum-surface-parity-check.ts
    3
    $ grep -n 'native-goal-write-desc\|serve-goal-status-order\|serve-goal-status-tabs' plugin/scripts/enum-surface-parity-check.ts
    189:  { id: "native-goal-write-desc", authority: "goal-status", file: "packages/quay-native/src/mcp-server.ts", extract: "text", anchor: "one goal record[^\\n]*?status ∈ ([a-z|-]+)", policy: "exact" },
    190:  { id: "serve-goal-status-order", authority: "goal-status", file: "packages/quay/src/serve-goal.ts", extract: "ts-array", symbol: "GOAL_STATUS_ORDER", policy: "exact" },
    194:  { id: "serve-goal-status-tabs", authority: "goal-status", file: "packages/quay/src/serve-goal.ts", extract: "ts-array", anchor: "\\[\"draft\",\\s*\"needs-human\"", policy: "exact" },
    $ awk '/^const KNOWN_DRIFT/,/^\];/' plugin/scripts/enum-surface-parity-check.ts | grep -c 'serve-goal-status\|native-goal-write-desc'
    0
    ```
  - All three counts are 3 lines in `SURFACES` and 0 lines in the ledger: the rows stay, the entries go. `KNOWN_DRIFT` shrinks 6 → 3.
  - ⚠️ One registry row **did** change, and it is not a deletion: `serve-goal-status-tabs`'s anchor was `\["draft",\s*"active"` — it anchors the tab array's first two elements, and `needs-human` was inserted at the head, so the anchor was re-pinned to `\["draft",\s*"needs-human"`. A stale anchor is NOT a silent pass: `extractTsArray` returns `anchor … matched 0 times` ⇒ the surface becomes `not-evaluated` ⇒ exit 3, which AC1's `0 not evaluated` would have caught.
- [x] A test renders the goals list with one needs-human goal plus one goal in each other status. The needs-human row sorts right after draft and before achieved/superseded/retired. Its tab nav contains a link with `status=needs-human`.
  - Evidence: `packages/quay/test/serve-goal-status-needs-human.test.mjs` (new). It renders through the PRODUCTION path (`startServer` + a real HTTP GET over a fixture workspace on disk), not a fixture-only seam. The fixture files one goal per ABI status plus one goal whose status is not in the ABI at all (`bogus-status`), so three separate claims are measured: the order, the nav entry point, and the fact that unknown statuses STILL sink (the negative control that keeps "needs-human is not last" from being satisfied by a rank function that stopped fail-closing).
    ```
    $ node --experimental-strip-types --test packages/quay/test/serve-goal-status-needs-human.test.mjs
    ✔ AC3a: default order places needs-human immediately after draft (not last, not unknown) (263.277226ms)
    ✔ AC3b: the status filter row links to status=needs-human (5.669487ms)
    ✔ AC3c: following the needs-human link returns exactly the escalated goal (6.474968ms)
    ✔ AC3d: every ABI goal status has a nav link, and each one filters to its own goal (18.167264ms)
    ℹ tests 4   ℹ pass 4   ℹ fail 0
    ```
  - ⚠️ The claim above is a MEASUREMENT only if the test can fail. Mutation control on the test itself (revert BOTH `GOAL_STATUS_ORDER` and the tab array in the worktree to their pre-fix 5-value forms):
    ```
    ✖ AC3a … ✖ AC3b … ✖ AC3c … ✖ AC3d …
    ℹ tests 4   ℹ pass 0   ℹ fail 4
    ```
    Restored afterwards; the unmutated run is the pass above. (A sibling assertion in `gap-webui-goal-list-title-search-and-ac-rollup-sort.test.mjs` pins the filter row's href list verbatim and was re-pinned, not deleted — the new link is now the second entry.)
- [x] Negative control: after this change, run `enum-surface-parity-check.ts --discover`. It still lists `serve-dashboard.ts` `AC_ROLLUP_IN_DOMAIN_STATUSES` as an unregistered intentional subset, and that file has no diff in this task.
  - Evidence:
    ```
    $ node --experimental-strip-types plugin/scripts/enum-surface-parity-check.ts --discover | grep serve-dashboard
      packages/quay/src/serve-dashboard.ts:1009 ⊂ goal-status — {achieved, active, needs-human}
    $ git diff --name-only HEAD~1 HEAD | grep -c serve-dashboard
    0
    ```
  - The subset is still reported (the change neither widened nor silenced it) and the file is untouched.
- [x] Mutation control: temporarily delete `needs-human` from `GOAL_STATUS_ORDER` in the worktree. The checker must then exit non-zero, because the drift grew relative to the ledger. Record the output, then restore the line.
  - Evidence (mutated — the `cp` backup/restore discipline, never `git checkout`):
    ```
    $ sed -i 's/…"active", "draft", "needs-human", "achieved"…/…"active", "draft", "achieved"…/' packages/quay/src/serve-goal.ts
    $ node --experimental-strip-types plugin/scripts/enum-surface-parity-check.ts; echo "exit=$?"
      [violation] serve-goal-status-order (goal-status) packages/quay/src/serve-goal.ts — 5 值 {active, draft, achieved, superseded, retired} · extra=[] missing=[needs-human]
    FAIL: 1 violation(s): serve-goal-status-order
    exit=1
    ```
    Note the failure KIND: with the ledger entry gone, this is a bare `violation` (`missing`), not a `known-drift-*-grown` — i.e. the surface is now unguarded by the ledger, which is exactly why removing the entries had to ship together with the fix.
  - Evidence (restored):
    ```
    $ cp <backup> packages/quay/src/serve-goal.ts
    $ grep -n '^const GOAL_STATUS_ORDER' packages/quay/src/serve-goal.ts
    229:const GOAL_STATUS_ORDER = ["active", "draft", "needs-human", "achieved", "superseded", "retired"];
    $ node --experimental-strip-types plugin/scripts/enum-surface-parity-check.ts; echo "exit=$?"
    PASS: all 27 registered surfaces consistent (3 known drift, 0 not evaluated)
    exit=0
    ```

## Definition of Done
- All AC ticked with command output pasted into the task body.
- `scripts/test.sh --for-task gap-goal-needs-human-missing-from-three-goal-surfaces` green.

## Touches
- tasks/gap-goal-needs-human-missing-from-three-goal-surfaces.md
- packages/quay/src/serve-goal.ts
- packages/quay/src/mcp-handlers.ts
- packages/quay-native/src/mcp-server.ts
- plugin/scripts/enum-surface-parity-check.ts
- packages/quay/test/serve-goal-status-needs-human.test.mjs (new)
- packages/quay/test/gap-webui-goal-list-title-search-and-ac-rollup-sort.test.mjs
