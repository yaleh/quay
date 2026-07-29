# M200 / DIR-126-A — Iteration-0 Adversarial Acceptance Audit

**Audit session id:** 9b3ffa31-5bd7-4274-86f3-74def2f0a1f1

**Verdict: REFUTED**

Fresh-context adversarial audit against the real build artifacts for DIR-126-A (single-flight
admission for `prepare-milestone.js`, M200/DIR-126's first split child). No prior context from the
build was carried in; every claim below was independently re-derived from source reads, live test
runs, and mechanical gates run during this audit.

## Summary

The core mechanism is real and mostly correctly wired: a new atomic-`wx`-create lease module
(`prepare-admission-check.ts`) plus a new, unconditional `Admission` phase inserted strictly before
`phase('ProposalAuthors')` on BOTH the cold path and the `resumeFromAdjudicatedProposal` path in
`prepare-milestone.js`. 10 of 15 Acceptance Criteria items and 2 of 4 Definition of Done items are
CONFIRMED with real, independently-reproduced evidence (all cited test runs were re-executed live
during this audit, not taken from the build's self-report). However, **4 AC items and 1 DoD item
are REFUTED/UNCONFIRMED** — each a genuine, non-trivial gap between what the AC/DoD text explicitly
demands and what evidence actually exists, most importantly the "Single-flight RED/GREEN" AC item
and its parallel DoD item: no real two-concurrent-`prepare-milestone.js`-`Workflow`-dispatch proof
exists; the only real-concurrency evidence races the lease CLI directly, bypassing the workflow
harness and `ProposalAuthors` agent-dispatch counting the AC text explicitly requires. This gap is
**self-disclosed by the Build itself** in `milestones/M200/iterations/iteration-0.md`'s "Honest
disclosures" section — this audit independently confirmed the disclosure is accurate and the gap is
real, not merely repeated the self-report.

The mechanical gate (`it0-dod-check.sh`) was re-run after write-back and FAILS (exit 1,
clause0-ac-dod-present) on exactly the 4 AC items this audit could not confirm — REFUTED by
construction, consistent with this audit's independent verdict.

## AC-by-AC findings (refute-first)

Full checklist write-back with line-level evidence citations is in `tasks/DIR-126-A.md`'s own
`## Acceptance Criteria` / `## Definition of Done` sections (each item now carries an
`**AUDIT: ...**` line). Summary:

| # | AC item | Verdict | Basis |
|---|---|---|---|
| 1 | Real production wiring (both branches) | **CONFIRMED** | Direct source read: `.claude/workflows/prepare-milestone.js` lines 66-125 — `Admission` phase + `--acquire` dispatch strictly precede both `phase('ProposalAuthors')` call sites (line 119 resume, line 125 cold). Mirror `cmp`'d clean. |
| 2 | Admission-phase error fail-closed | **REFUTED/UNCONFIRMED** | Branching logic is real and correct on read (lines 99-105), but NO test anywhere drives `prepare-milestone.js` itself into this branch and asserts `{outcome:'needs-human', reason:'admission-check-failed'}`. The two "Admission-phase-error CLI shape" tests only test the CLI's own stdout shape, not the workflow's handling of it. |
| 3 | Single-flight RED/GREEN | **REFUTED/UNCONFIRMED** | Only real-concurrency evidence is `milestones/M200/stage9-two-process-race-evidence.md`, which races `prepare-admission-check.ts --acquire` directly via two OS processes — never a real `prepare-milestone.js` `Workflow` dispatch, no `ProposalAuthors` agent-dispatch-count journal evidence. Self-disclosed gap, independently confirmed real. |
| 4 | Lease recovery fail-closed | **CONFIRMED** | `prepare-admission-check.test.mjs`, re-run live (20/20 pass): active-lease-not-stolen, stale-reclaim-with-recoveredFrom, crash-recovers-via-same-path all pass. |
| 5 | Force-release audit trail | **CONFIRMED** | CLI-level test re-run live, passing: genuine release, reason recorded verbatim, `releaseMethod` distinguishable from `stale-reclaim`. |
| 6 | Renewal-at-every-phase-boundary proven | **REFUTED/UNCONFIRMED** | Static wiring confirmed (`grep -c "await _renewLease("` = 6, at the right 6 sites), but the AC demands a fixture proving renewal "across every existing phase boundary" — what exists are two abstract single-boundary module-level simulations, and the `admissionRenews`/`admissionAcquires`/`admissionReleases` counters collected in the two pre-existing workflow-integration test files' mocks are never asserted against an expected count anywhere. |
| 7 | Staleness window 300m/360m | **CONFIRMED** | `DEFAULT_STALENESS_MS = {ordinary:300*60*1000, highRisk:360*60*1000}`, asserted by a passing unit test. |
| 8 | Every terminal return releases (line-by-line) | **CONFIRMED** | Independently re-derived via live `grep`, not trusted from the build's count: line 27 (pre-Admission, correctly unreleased), lines 104/109 (2 NEW Admission-phase pre-acquisition returns, correctly unreleased since no lease was ever held), and all 11 post-acquisition sites each immediately preceded by `await _releaseLease(...)`. Real total is 14 terminal returns now (12 original + 2 new), not 12 — the AC's line-number enumeration is stale relative to the final file, but the underlying invariant is fully verified met. |
| 9 | Mirror byte-identity | **CONFIRMED** | `cmp` exits 0 for all 4 pairs; `sync-vendor.sh --check` reports CLEAN, including the new script. |
| 10 | `.quay/prepare-leases/` gitignored | **CONFIRMED** | `git check-ignore -v` matches `.gitignore:27`. |
| 11 | Grounding group 1 (problem framing) | **CONFIRMED** | Independently re-verified via direct source read. |
| 12 | Grounding group 2 (precedent) | **CONFIRMED** | `gate-event-store.ts:82` uses plain `appendFileSync`; `frontmatter-store-base.ts:91` and `store.ts:196` use `wx` — independently confirmed. |
| 13 | Grounding group 3 (phase-wiring/defaults) | **REFUTED/UNCONFIRMED** | Every sub-claim confirmed except one: the item asserts real production wiring is "confirmed distinct from and additional to the module's own `--selftest` self-check mode" — but `prepare-admission-check.ts` has NO `--selftest` mode at all (`grep -n "selftest"` on it returns zero matches, unlike several sibling scripts in the same directory). This specific sub-claim is factually false against the final artifact. |
| 14 | Grounding group 4 (verbatim vocabulary) | **CONFIRMED** | All cited identifiers independently re-confirmed via direct source read. |
| 15 | Grounding group 5 (exhaustive identifiers) | **CONFIRMED** | Same identifiers, re-confirmed; does not repeat group 3's disproven `--selftest` claim. |

## DoD findings

| DoD item | Verdict | Basis |
|---|---|---|
| Landed on `master` | **N/A (not yet applicable)** | Audit runs pre-Land; working tree still carries uncommitted Build changes at audit time. Not a defect. |
| Real, non-fixture two-concurrent-dispatch proof, journal output | **REFUTED/UNCONFIRMED** | Same gap as AC item 3 above. |
| RED/GREEN evidence: stale-lease-reclaim + crash/restart | **CONFIRMED** | Same evidence as AC item 4, re-run live. |
| Fresh independent audit confirms real production callsite | **CONFIRMED — this is that audit.** | Direct source read, not unit-test reachability. |

## Additional findings not tied to a specific numbered AC item (informational)

- **Minor, self-disclosed:** the lease/audit file path builder (`safeTaskIdSegment`) sanitizes
  `taskId` to prevent path traversal via `/`/`\`, added live during Build as a defense-in-depth fix
  after discovering several pre-existing test fixtures use path-like `taskId` values — but no
  dedicated unit test exercises the traversal-prevention behavior itself (only indirectly covered
  by clean real-taskId CLI tests). Not AC-blocking; flagged for completeness per the Build's own
  honest disclosure.
- **Minor:** `.claude/workflows/prepare-milestone.js` now contains a `try { ... } catch { ... }`
  block (line 97, JSON-parsing the Admission verdict) — the Proposal's own WIRING-CLAIM 5 grounding
  text ("the workflow DSL has confirmed zero `try`/`catch` semantics... `grep -n "catch\|try {"`...
  returns no matches") was accurate of the PRE-Build file but is now stale against the final
  artifact. This is a normal, correct JS `try/catch` around a synchronous `JSON.parse` — not a
  design defect, and does not undermine the "no `try/finally`-based automatic lease cleanup" design
  rationale (the fail-closed path is an explicit `if`-check, not exception-unwinding). Noted for
  completeness only.
- Full test suites re-run live during this audit (not trusted from self-report): 20/20
  `prepare-admission-check.test.mjs`, 28/28 combined `prepare-milestone-convergence.test.mjs` +
  `prepare-milestone-preparation-e2e.test.mjs`, 34/34 `plugin-packaging.test.mjs`. All green.
  `sync-vendor.sh --check` CLEAN. `git check-ignore` confirms gitignore coverage.

## Mechanical gate

`bash experiments/quay-perpetual-stream/scripts/it0-dod-check.sh DIR-126-A
experiments/quay-perpetual-stream/charters/M200-dir126a-single-flight-admission.md
milestones/M200/absorb-entry.md` — run AFTER the checklist write-back above and the disposition
append to `absorb-entry.md` — **exit 1 (FAIL)**: `clause0-ac-dod-present` hard-blocks on the same
4 unchecked AC items enumerated above. REFUTED by construction, consistent with this audit's
independent verdict.

## Deviation-log write-back

Per DIR-017 Step 3, a caught-by:machine deviation row (this audit's own finding, this same pass)
has been appended to `experiments/quay-perpetual-stream/dashboard.md`'s "Homeostatic variables"
table — see that file's diff. No caught-by:human ABSORB-entry disclosure needed transcription
beyond what is already captured above (the Build's own honest disclosures were self-authored by the
Build, not a separate human-steered disclosure requiring a distinct row per the charge's
instructions; the REFUTED items above are this audit's own machine-caught findings).

## Conclusion

**Verdict: REFUTED.** The single-flight admission mechanism is real, correctly wired into the
production control-flow, and most of its safety properties (lease-recovery fail-closed,
force-release audit trail, staleness-window derivation, release-on-every-terminal-return, mirror
byte-identity, gitignore coverage) are independently confirmed with real, reproduced evidence. But
4 Acceptance Criteria items and 1 Definition-of-Done item — most importantly the real
two-concurrent-`prepare-milestone.js`-dispatch proof this milestone exists to deliver — are not yet
met as literally worded, and the mechanical gate fails accordingly. This child is not yet DoD-clean
and should not be landed as `done` without either producing the missing evidence or an explicit,
documented scope adjustment to the AC text.
