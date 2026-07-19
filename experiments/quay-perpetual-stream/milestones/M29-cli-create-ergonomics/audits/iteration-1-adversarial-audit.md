# M29-cli-create-ergonomics — adversarial audit (post both-iterations, post-merge cf04bb2)

**Role:** fresh-context, out-of-band adversarial audit, dispatched by the outer loop per
`inherited-core.md`'s "Adversarial-audit role" section. Explicitly charged to REFUTE, not
re-confirm, the milestone's Done-when claims and VT Δv̂. Read only: the charter, both iteration
reports, `inherited-core.md`, the actual merged code/tests at HEAD (`cf04bb2`), and the merge
commit. Did not read either iteration's own worktree beyond the files listed in the dispatch
instructions.

**Verdict: NO REFUTATION FOUND.** One CONCERNS-level finding worth recording (non-blocking,
already substantially self-disclosed by iteration-1's own report), detailed below. No claim was
found to be fabricated, unsupported, or arithmetically wrong.

## What was specifically tried (not just "looks fine")

### 1. Re-ran the actual reconciled test files
`node --test packages/quay/test/gap002-create-ergonomics.test.mjs
packages/quay/test/gap002-create-ergonomics.iteration-0.test.mjs` at HEAD (`cf04bb2`): **14/14
pass, 0 failures** (13 from iteration-1's node:test file + 1 collected top-level test from
iteration-0's standalone-assertion-script file, reconciled at merge as
`gap002-create-ergonomics.iteration-0.test.mjs`). Matches both reports' GREEN claims and the merge
commit's own "all 13 iteration-1 node:test cases + all iteration-0 standalone-script assertions
pass against the reconciled code" statement.

### 2. Re-ran the full repo test suite independently, from HEAD, isolated
`node --test --test-concurrency=1 packages/*/test/*.test.mjs`: **47 tests, 46 pass, 1 fail**
(`packages/quay/test/serve-github.test.mjs`, the exact same 2 assertions — `gh-3` id/title absent
from the default `GET /` list page — both iteration reports and the merge commit describe).
Independently re-ran `serve-github.test.mjs` standalone and got byte-identical failure output.
This is real evidence, not narrative: 0 unexplained failures, matching Done-when clause 6's
requirement and the merge commit's "0 unexplained failures" claim.

### 3. Checked the merge's stated reconciliation was a real, necessary conflict (not fabricated)
Verified via `git merge-tree $(git merge-base 1df7233 468efc0) 1df7233 468efc0` that a raw 3-way
merge without manual resolution would indeed have produced two `sub === "create"` blocks (both
iterations independently and correctly built a single handler each on their own branch — `d6e7301`
and `468efc0` each show exactly one `sub === "create"` occurrence). The final merged
`packages/quay/bin/quay.js` at HEAD has exactly one `task create` handler and one `task edit`
handler, confirmed by direct grep, and `node -c` / actual invocation both work. The "duplicate
dead-code handler, redundant first guard" story in the merge commit message is accurate, not an
invented justification for a suspicious diff.

### 4. Directly probed the exact code-path difference the dispatch brief asked about
Compared iteration-0's original `task edit` guard (`flags.title === undefined`, from `d6e7301`)
against the surviving merged guard (`patch.title === undefined || String(patch.title).trim() ===
""`, from `468efc0`/HEAD). Confirmed by direct source inspection AND live reproduction that the
surviving guard is a strict superset: it catches everything the deleted guard caught
(`flags.title === undefined` implies `patch.title === undefined`, since `patch.title` is only set
when `flags.title !== undefined`) **plus** the empty-string case the deleted guard missed. Live
reproduction: `task edit <new-id> --title "" --status todo` against pre-fix code (iteration-0's own
shape, if it had shipped alone) would NOT have been refused; against the merged/surviving code it
correctly refuses (`quay task edit: task ... does not exist yet; ... requires --title`). No case
covered by the deleted guard is silently dropped by the surviving one — this is the one item the
dispatch brief specifically asked to check, and it holds up.

### 5. Recomputed the arithmetic
- Charter's Δv̂: `25 (CLI weight, confirmed live in `dashboard.md` line 134's current-cov row) ×
  0.02 (estimated Δĉov) = 0.5`. Recomputes cleanly.
- Iteration-0's GAP-007 ratio: `(1.293+1.255+1.330+1.238+1.134)/5 = 1.250`,
  `(0.445+0.427+0.485+0.466+0.408)/5 = 0.4462`, `1.250/0.4462 = 2.8014...` → reported "2.80x".
  Recomputes cleanly (independently verified with a script, not eyeballed).
- No arithmetic errors found in either report.

### 6. Checked the VT-delta-vs-Δv̂ comparison the brief asked about
Found **no ABSORB entry for M29 exists yet anywhere** — `dashboard.md` ends at "SELECT m29",
`backlog.md`'s row for `exp5-M-QUAY-CLI-CREATE-ERGONOMICS` is still `SELECTED` (not `DONE`),
`v-meta-ledger.md` has no M29 row, and this milestone's own `audits/` directory was empty before
this report. This means: **there is no realized/recorded Δv to compare against the charter's
predicted Δv̂ ≈ 0.5 yet** — ABSORB (where that comparison and the actual cov-delta scoring happens)
has not run. This is consistent with the protocol, not a gap: per `inherited-core.md`, this
adversarial audit is itself a precondition gate for ABSORB, dispatched before the VT-curve append,
not after. There is therefore nothing to refute on the "VT delta doesn't match Δv̂" axis (c) at this
point in the process — that comparison is ABSORB's job, to be done after this audit clears.

### 7. Checked scope confinement at HEAD directly (not iteration-by-iteration)
`git diff --stat f7b3a0b cf04bb2 -- . ':!.../worktrees'`: touches only
`packages/quay/bin/quay.js`, the two new/reconciled test files, the charter, and both iteration
reports — 6 files, 1913 insertions / 3 deletions. No diff against `packages/quay-native/src/
store.js`, `packages/quay-github/src/github-client.js`, `packages/quay-native/bin/quay-native.js`,
or `packages/quay/src/provider-client.js` (the latter checked specifically because GAP-007's "no
code change" claim depends on it). Real repo-root `tasks/` confirmed untouched
(`git status --short -- tasks/` empty at HEAD). All matches both reports' and the merge commit's
scope claims.

### 8. Checked `--help` text at HEAD directly (not trusting either report's pasted block)
Ran `node packages/quay/bin/quay.js --help` live against HEAD: single, well-formed "Options for
task create:"/"Options for task edit:" sections, full flag surface listed, no duplicated or
truncated blocks (a plausible merge-reconciliation risk that did NOT materialize here).

### 9. Actively hunted for a code path the fix might still miss (per dispatch brief item (f))
Went beyond re-confirming iteration-1's own already-disclosed variant probes. Found:
**`task edit <existing-id> --title "" --append-notes "..."` on an EXISTING task silently blanks
its title to `""`, exit 0, no error.** Reproduced live against HEAD. Root cause: the
`--append-notes` branch (lines 524-536) does its own `client.taskWrite(...)` and returns *before*
the title-emptiness guard (lines 561-571) is ever reached — so the guard's protection does not
extend to the `--append-notes` code path at all, for either existing or non-existent ids.
Confirmed this exact `--title ""`-blanks-an-existing-task behavior (without `--append-notes`, the
simpler case) is **pre-existing, unchanged by this milestone**: reproduced byte-identically against
a pristine `f7b3a0b` worktree (`git worktree add /tmp/quay-m29-baseline f7b3a0b...`, fresh `npm
install`) — `task edit <existing-id> --title "" --status done` already silently blanked the title
pre-fix, exit 0. This is **not a regression introduced by M29**, and it is **not a hidden gap** —
iteration-1's own report (§7, "Explicitly checked and NOT extended further") explicitly discloses
and scopes out exactly this class: *"`task edit <existing-id> --title "" ...` (blanking an EXISTING
task's title) — deliberately left unguarded... a different, pre-existing, out-of-charter-scope
editing behavior... changing it here would be scope creep beyond GAP-002's stated mechanism."* The
`--append-notes` variant of the same already-disclosed gap was not itself named, but it is the same
disclosed defect class (existing-task title-blanking, out of GAP-002's scope, which is specifically
about the create-via-upsert/non-existent-id path) reached via one additional flag combination the
report didn't enumerate. **This is a CONCERNS-level finding, not REFUTED**: the milestone's charter
Done-when metric `Y` and GAP-002's own mechanism are both scoped to the create-via-upsert
(non-existent-id) path; blanking an *existing* task's title was never GAP-002's claim, and the
report already states plainly that existing-task title-editing hardening is out of scope. Logging
the `--append-notes` variant here is additive precision on an already-disclosed, already-scoped-out
observation — not a refutation of any Done-when clause or the VT Δv̂ claim.

## Findings by category (per dispatch brief's (a)-(f))

- **(a) narrative-only claims with no pasted evidence:** none found. Every Done-when clause in
  both reports has adjacent raw command output (test-runner output, `--help` text, `git diff
  --stat`, timing numbers). GAP-007's timing tables, the RED/GREEN transcripts, and the scope
  `git diff --stat` output are all real pasted output, independently re-run above and matching.
- **(b) evidence that doesn't support the specific claim made:** none found. No curl-standing-in-
  for-browser-type substitution applies here (this is a CLI-only milestone with no Web UI claim);
  the `--help` claims are backed by direct `--help` output, the test claims by direct `node --test`
  output, the scope claims by direct `git diff --stat` output.
- **(c) arithmetic that doesn't recompute cleanly:** none found (see item 5 above).
- **(d) VT deltas that don't match Δv̂ without a stated reason:** not yet applicable — no VT delta
  has been recorded yet (ABSORB has not run for M29; see item 6 above). Not a refutation.
- **(e) scope creep or self-granted exemption without outer-loop sign-off:** none found. The
  charter's explicit out-of-scope list (GAP-007 latency fix, `quay-native`'s own id-fallback bug,
  general edit-field-validation hardening for existing tasks) was respected by both iterations and
  the merge. iteration-1's own empty-title tightening (§7 of its report) was flagged as new
  material relative to iteration-0, but is squarely within GAP-002's own stated intent ("refuse...
  instead of silently upserting a titleless record" — the charter's own fix-shape decision language
  already covers the "titleless or degenerate title" class, not narrowly "missing key only"), not
  an unauthorized scope expansion.
- **(f) merge-reconciliation correctness (both iterations' independently-written code actually
  behaves as both claimed):** confirmed, see items 1-4 and 9 above. The specific guard-redundancy
  question the dispatch brief named was checked directly and holds: the surviving guard is a strict
  superset of the deleted one.

## Recommendation for ABSORB

- No REFUTED-level finding to block the ABSORB VT-curve append / Done-when completion claim.
- Suggest the ABSORB entry (or a follow-up future-candidate note, consistent with how iteration-1
  already logs `quay-native`'s id-fallback bug) additionally note the `--append-notes`-reaches-
  existing-task-title-blanking variant found in item 9 above, purely for future-candidate tracking
  parity with the already-disclosed simpler case — not as a blocking condition.
- The Δv̂ ≈ 0.5 vs. realized-Δv comparison (dispatch brief item (d)) should be performed at ABSORB
  once the actual chart-1 CLI cov re-scoring happens; nothing in this audit found grounds to expect
  that comparison to reveal an inflated or unstated-reason discrepancy, given the correctness-only,
  narrowly-scoped, disclosed nature of the actual code change.
