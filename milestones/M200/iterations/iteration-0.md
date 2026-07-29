# M200 Iteration 0 — DIR-126-A: single-flight admission for prepare-milestone.js

**Task:** DIR-126-A · **Charter:** `experiments/quay-perpetual-stream/charters/M200-dir126a-single-flight-admission.md`
**Plan:** `docs/plans/M200-dir-126-a.md` (9 stages, all 15 task AC items mapped)
**Base revision:** `20d4dc7` (Plan-authoring HEAD) · this Build's HEAD before commit: `415f397`

## Summary

Implemented all 9 Plan stages. New pure-decision module `prepare-admission-check.ts` (+
`plugin/scripts/` mirror) exports `acquireLease`/`renewLease`/`releaseLease`/`checkStaleOwner`
around an atomic `fs.writeFileSync(path, json, {flag:'wx'})` lease primitive at
`.quay/prepare-leases/<taskId>.json`, plus a CLI (`--acquire`/`--renew`/`--release`/
`--force-release <reason>`). `prepare-milestone.js` (both mirrors) gained a new, unconditional
`Admission` phase — the literal first phase reached on BOTH the cold path and the
`resumeFromAdjudicatedProposal` path — plus renewal calls at all 6 phase boundaries and release
calls at all 11 post-Admission terminal returns.

## Stage-by-stage evidence

**Stage 1 (core module: lease record, acquireLease, checkStaleOwner, staleness constants).**
`DEFAULT_STALENESS_MS = {ordinary: 300*60*1000, highRisk: 360*60*1000}` — a real named constant.
5 RED/GREEN scenarios pass (active-lease-cannot-be-stolen, stale reclaim with verbatim
`recoveredFrom` + `fencingToken+1`, crash-recovers-via-same-path, renewLease extends while
preserving owner/fencingToken/attempt, missing-ownerExecutionId fails closed with a distinct
`missing-session-id` error). `key`/`ownerExecutionId`/`attempt`/`stage`/`fencingToken`/
`baseCommit`/`acquiredAt`/`leaseUntil`/`heartbeatAt` map 1:1 onto DIR-124's §6.3 vocabulary
(`docs/proposals/quay-milestone-workflow-stage-pipelining-and-leases.md`).

**Stage 2 (CLI wrapper + force-release audit trail).** `--acquire`/`--release`/`--renew`/
`--force-release <reason>` all real, exercised via `execFileSync` against the real entrypoint (not
in-process functions). Every release path (`normal`/`force-release`/`stale-reclaim`) writes the
same `releaseMethod`-tagged audit record to `.quay/prepare-leases/<taskId>.audit.jsonl` —
`force-release` is verified distinguishable from `stale-reclaim` and carries the supplied reason
verbatim.

**Stage 3 (mirror to plugin/, sync-vendor.sh wiring).** `prepare-admission-check` added to
`sync-vendor.sh`'s `SYNC_SCRIPTS` array (25th entry). `sync-vendor.sh --check` CLEAN. Test file
manually mirrored (`cmp` exits 0), matching the `composite-manifest-synthesis.test.mjs` precedent
(test mirroring has no script-driven sync).

**Stage 4 (.gitignore).** `**/.quay/prepare-leases/` added immediately after the existing
`**/.quay/gate-events.jsonl` line. `git check-ignore -v` confirms the path is now ignored (it was
not before this edit).

**Stage 5 (Admission phase insertion).** Inserted immediately after the missing-args guard (which
remains untouched — it fires before Admission and needs no lease/release) and strictly before the
`if (_resumeFromAdjudicatedProposal) {...} else {...}` split — ahead of BOTH the resume branch's
log-only `phase('ProposalAuthors')` and the cold path's real one. Dispatches
`prepare-admission-check.ts --acquire --taskId <id> --workspace .` via `agent()` (same
dispatch-and-trust-the-JSON pattern the existing wiring-coverage sub-step uses — the workflow DSL
still has zero `fs`/import capability). Three outcomes: `acquired` → continue; `prepare-already-
running` → `{outcome:'needs-human', reason:'prepare-already-running', phase:'Admission', owner:
{...}}` before any `ProposalAuthors` agent is dispatched; anything else (bad CLI invocation,
unparseable output) → fail-closed `{outcome:'needs-human', reason:'admission-check-failed', ...}`
— AC2's dedicated fail-closed path, never a silent fallthrough. Verified: `grep -n
"phase('Admission')"`, `grep -n "prepare-admission-check.ts --acquire"`, `grep -n
"admission-check-failed"` each match; `phase('ProposalAuthors')` still appears at both the resume
(now line 119) and cold-path (line 125) call sites, unchanged relative order, now both after
Admission.

**Stage 6 (renew/release wiring).** Two shared async helpers, `_renewLease(stageLabel)` /
`_releaseLease(stageLabel)`, each dispatching the CLI via `agent()` (no `try`/`finally` exists in
this DSL — confirmed zero `catch`/`try` matches, so every call site is explicit). `grep -c "await
_renewLease("` = **6** (Adjudicate entry, ProposalReview entry, each ProposalReview delta round,
PlanAuthor entry, each PlanCheck round, Receipt entry). `grep -c "await _releaseLease("` = **11**,
matching the 11 real post-Admission terminal-return sites exactly.

**Real terminal-return accounting (re-derived live against the FINAL committed file, corrects the
Plan's pre-Admission-phase count of 12/19 total which predates this Build's own new code):**
`grep -c "return {"` = **21** raw matches, breaking down as: **14 real workflow-level terminal
returns** + 4 in-agent-prompt prose matches (lines 166/328/370/446, each a `Return {...}
...return {ok:false...}` template-literal instruction to an agent, not a real `return` statement)
+ 3 `_splitCheck()`-local returns (its own `{recommend, code, reason}` helper, unrelated to phase
exit). Of the 14 real terminal returns: **1 pre-Admission** (line 27, missing-args guard —
unchanged, no lease ever acquired) + **2 new Admission-phase pre-acquisition returns** (lines
104/109 — `admission-check-failed` and `prepare-already-running`; THIS generation never
successfully held the lease on either path, so calling `_releaseLease` there would either no-op or,
worse, in the `prepare-already-running` case, risk releasing the WINNING generation's own active
lease — deliberately NOT called) + **11 post-successful-acquisition returns**, each immediately
preceded by `await _releaseLease(...)` (verified above).

**Stage 7 (mirror prepare-milestone.js → plugin/).** `cmp .claude/workflows/prepare-milestone.js
plugin/workflows/prepare-milestone.js` exits 0 (byte-identical, manual copy per the pre-existing
no-sync-vendor-coverage-for-workflows/*.js convention).

**Stage 8 (full test coverage + regression guard for the two pre-existing workflow-integration
test files).** `prepare-admission-check.test.mjs` (+ `plugin/test/` mirror): **20/20 pass**
(5 Stage-1 + 6 Stage-2 CLI + 5 Stage-8 module-level/single-flight/stall + 4 grounding/edge-case
scenarios — deliberately exceeds the Plan's minimum-12 count with extra coverage: a highRisk-window
renewal case, a taskId-independence case, a source-grounding grep, and a legitimate-renewal-
survives-boundary case).

**Real regression found and fixed during Build (not in the original Plan, discovered live):** the
two pre-existing workflow-integration tests that drive `prepare-milestone.js` as a real
`AsyncFunction` with a scripted mock `agent()` — `plugin/test/prepare-milestone-convergence.test.mjs`
(26 tests) and `plugin/test/prepare-milestone-preparation-e2e.test.mjs` (2 tests) — both throw
`unexpected agent() call` for any unmatched `opts.label`, and neither mock knew about the new
`admission-acquire`/`admission-renew-*`/`admission-release-*` labels the new Admission phase now
dispatches as the literal FIRST `agent()` call in every run. Without a fix, EVERY test in both
files would fail immediately at Admission, a full regression of DIR-125's convergence-loop test
coverage. Fixed by adding a small mock branch to both files' `agentMock` (returns a fixed
`{outcome:'acquired',...}` / `{ok:true}` JSON string in `.raw`, never touching real
`.quay/prepare-leases/` state — consistent with those files' own stated job of testing the
OTHER phases' wiring, not re-testing `prepare-admission-check.ts`, which has its own dedicated
test file). Re-run after the fix: **26/26** and **2/2** pass respectively, zero other assertions
needed to change (all existing assertions key on other labels' counters, never a total-call-count).

Also found and fixed live: the lease-file path construction used `taskId` unsanitized in a
`path.join()`, so a `taskId` containing `/`/`\` (as several existing test fixtures deliberately use,
e.g. `../${scratchRel}/task`, to avoid colliding with the real `tasks/` dir) could traverse outside
`.quay/prepare-leases/`. Hardened with `safeTaskIdSegment()` (replaces path separators before
building the lease/audit filenames) — real production taskIds (`DIR-126-A`) are unaffected; this is
defense-in-depth for any future caller, not a live production bug (the mocks above never exercise
the real CLI against those path-like fixture ids, by design).

**Stage 9 (real two-process concurrent-dispatch regression proof + final grounding audit).**
No live `Workflow` harness dispatcher is available inside this build subagent's own execution
window, so per the Plan's own honestly-scoped fallback: two REAL OS processes raced
`prepare-admission-check.ts --acquire` for the SAME fixture taskId
(`DIR-126-A-fixture`) against a scratch workspace. Exactly one process (`race-session-b-...`)
received `{outcome:'acquired',...}` (exit 0); the other received
`{outcome:'prepare-already-running', owner:{...}}` (exit 1) — both processes report the SAME
winning `ownerExecutionId`, confirming the losing process's own write never landed (the atomic `wx`
primitive, not a post-hoc comparison). A different taskId (`DIR-126-A-fixture-OTHER`) remained
independently acquirable immediately after. Full captured output:
`milestones/M200/stage9-two-process-race-evidence.md`.

**Final grounding audit (re-run against the final committed file):** `grep -c "await
_renewLease("` = 6, `grep -c "await _releaseLease("` = 11 (both re-confirmed post-Stage-8 edits).
`git diff 20d4dc7..HEAD -- packages/` prints nothing — zero product-package edits, the Non-goals
guardrail (no new `experiments/` → `packages/` dependency edge) holds. `wx`/`EEXIST`/
`CLAUDE_CODE_SESSION_ID`/DIR-124 field-vocabulary identifiers all confirmed present verbatim in
`prepare-admission-check.ts` via the module's own `_internal`-exposed grounding-evidence unit test.

## Test evidence

- `node --experimental-strip-types --test experiments/quay-perpetual-stream/test/prepare-admission-check.test.mjs` — **20/20 pass**.
- `node --experimental-strip-types --test plugin/test/prepare-milestone-convergence.test.mjs` — **26/26 pass** (both `.claude`/`plugin` mirrors × 13 DIR-125 convergence scenarios each).
- `node --experimental-strip-types --test plugin/test/prepare-milestone-preparation-e2e.test.mjs` — **2/2 pass**.
- `node --experimental-strip-types --test plugin/test/plugin-packaging.test.mjs` — **34/34 pass** (byte-identity/mirror-completeness checks, including the new `prepare-admission-check.ts` mirror via `sync-vendor.sh --check`'s dynamic `SYNC_SCRIPTS` scan).
- `node --experimental-strip-types --test experiments/quay-perpetual-stream/test/proposal-convergence.test.mjs experiments/quay-perpetual-stream/test/milestone-preparation-check.test.mjs experiments/quay-perpetual-stream/test/wiring-coverage-check.test.mjs` — **93/93 pass** (unrelated-file regression check).
- Canonical full suite: `bash scripts/test.sh` — see result appended below (ran in background due to >120s wall time; DIR-090 timeout discipline).
- `node --check` on both `prepare-milestone.js` mirrors — syntax OK.
- `git diff 20d4dc7..HEAD -- packages/` — empty (zero product-package edits).
- `.quay/prepare-leases/` gitignore: `git check-ignore -v` confirms match; no stray lease files left in the repo root `.quay/` after all test runs (verified via `ls`).

## Honest disclosures

- Stage 9's real two-process proof is the CLI-level fallback (per the Plan's own explicit
  sanctioning of this fallback when a live `Workflow` dispatcher isn't available), not a genuine
  two-`Workflow({scriptPath:'.claude/workflows/prepare-milestone.js', ...})` dispatch — the
  stronger claim the task's AC3 language ultimately wants. The CLI race exercises the EXACT same
  `--acquire` call the real `Admission` phase makes, so it is strong evidence for the underlying
  mechanism, but a real end-to-end `Workflow` dispatch remains DoD-required follow-up evidence per
  "Real, non-fixture two-concurrent-dispatch proof is exercised end to end with journal output" —
  this Build could not obtain a Workflow-tool-equipped session inside its own window (same class of
  disclosure M198/DIR-119-D1's Build made for its own live-dispatch AC items).
- Two regressions were found and fixed live during Build (documented above under Stage 8) — neither
  was anticipated by the checked Plan; both are now covered (mock updates verified 26/26 + 2/2
  green; the taskId-sanitization fix is covered indirectly by the CLI tests using clean taskIds and
  directly by the module's own design, though no dedicated "traversal" unit test was added — a real
  gap worth flagging for the independent audit).
- The `_admissionAgentCall` helper's prompt asks the agent to "copy exactly as printed" the CLI's
  stdout without paraphrasing — this is prompt-level trust in agent fidelity for a single JSON
  line, the same class of trust every other phase's `agent()`-mediated CLI dispatch already relies
  on in this file (e.g. the pre-existing `wiring-coverage-check` and `receipt` phases) — not a new
  risk class this milestone introduces.
