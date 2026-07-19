# DIR-019

- status: pending
- created_by: human (Yale Huang), asserted directly in this live conversation
- created_at: 2026-07-19
- title: The DoD meta-enforcer's no-self-exemption clause (clause 5) is blind to self-exemptions of the two gates it can mechanically inspect (line-budget, impl-row), because those clauses are dispositioned unconditionally and clause 5 skips any already-dispositioned clause — fix clause 5, and gate DIR-017 Step 2/3 on an EXTERNAL, human-authored red test that does not trust the enforcer's own self-report

## Finding

DIR-017's human-verification gate (step #5: "the no-self-exempt clause is present and
testable — the synthetic self-exemption case must FAIL") was verified against the
DoD meta-enforcer (`scripts/it0-dod-check.{sh,mjs}`, built at M25) by a human this
session. **Step #5 FAILS.** The enforcer's clause 5 (no-self-exemption) does not
catch a self-exemption of two of the four gates it is documented to inspect.

Root cause, confirmed by reading `scripts/it0-dod-check.mjs`:

- Clause 3 (line-budget) and clause 4 (impl-row) shell out to their sibling scripts
  **unconditionally** and, on every run, add their key to `dispositionedClauses`
  (lines ~158/163 and ~198/203).
- Clause 5 skips any clause already in `dispositionedClauses`
  (`if (dispositionedClauses.has(key)) continue;`, line ~240), on the theory that a
  recorded disposition means a legitimate non-firing rather than a silent skip.
- Because clauses 3 and 4 are *always* dispositioned by construction, clause 5's
  self-exemption scan for those two clause names is **dead code — it can never fire**.
  A charter may write "exempt from the line-budget gate" or "exempt from the impl-row
  gate" in its "Explicitly OUT of scope" section, with no waiver line anywhere, and
  the enforcer exits 0 (PASS).

This directly contradicts `inherited-core.md`'s own clause-5 text, which claims:
"for clauses 3 (line-budget) and 4 (impl-row), the charter/ABSORB text is directly
inspectable — `it0-dod-check.mjs` scans for exemption-adjacent language paired with
an absent waiver line." The scan is described in prose but unreachable in code —
**the exact "designed-not-wired / enforcement-half-never-built" disease (DIR-002,
DIR-012/M18) reproducing inside the very mechanism built to end it** (DIR-017's
central self-referential-bootstrapping risk, realized).

The enforcer's own two shipped fixtures did not catch this: `violating-stub.md` only
exercises a *clause-1* (adversarial-audit) self-exemption — and clause 1 is
dispositioned from the ABSORB-entry text conditionally, so its clause-5 path *is*
reachable. No fixture exercised a clause-3 or clause-4 self-exemption, so the blind
spot shipped green.

**Live reproduction (human-run this session, in an isolated worktree):** two new
adversarial fixtures were authored —
`fixtures/dod/self-exempt-linebudget-stub.md` and
`fixtures/dod/self-exempt-implrow-stub.md` — each compliant on every clause except a
single undeclared self-exemption of line-budget / impl-row respectively. A new
acceptance runner, `scripts/dod-fixture-selfcheck.sh`, asserts the expected exit
code for all four fixtures and currently prints:

```
PASS: M98-fake-compliant           — exit 0 (expected 0)
PASS: M99-fake-violating           — exit 1 (expected 1)
FAIL: M96-fake-linebudget-self-exempt — exit 0 but EXPECTED 1
FAIL: M95-fake-implrow-self-exempt    — exit 0 but EXPECTED 1
```

## Requested action

1. **Fix clause 5 of `scripts/it0-dod-check.mjs`** so it catches an undeclared
   self-exemption of ANY of the four clauses, including line-budget and impl-row.
   The fix must distinguish two genuinely different states that the current
   `dispositionedClauses` set conflates:
   - "this clause was *mechanically executed* this run" (true for clauses 3/4 always;
     NOT evidence that a self-exemption is legitimate), versus
   - "this clause's trigger was recorded as legitimately not firing, with its
     disposition stated in the record" (clause 1/2's real semantics).
   Concretely: a charter naming a clause with exemption language in "Explicitly OUT
   of scope", absent a matching `WAIVER:` line, must FAIL clause 5 **regardless of
   whether that clause's own gate mechanically ran** — the presence of exemption
   *language* is itself the violation, per `inherited-core.md`'s clause-5 definition.
   Do NOT weaken the legitimate-non-firing carve-out for clauses 1/2 (a documented
   no-op with no exemption language must still PASS).

2. **Adopt the external red test as this DIR's SOLE acceptance predicate.** Keep the
   two new fixtures and `scripts/dod-fixture-selfcheck.sh` (authored by a human,
   off-loop). "DIR-019 done" is defined as: `dod-fixture-selfcheck.sh` exits 0 with
   the fixtures **unchanged**. Wire this runner into the same standing-check discipline
   as the other `it0-*`/fixture pairs so it re-runs and guards against regression.

3. **Do NOT use the DoD gate's own self-report (`it0-dod-check` PASS) as evidence
   that this DIR is done.** The bug is inside that gate; it is blind to its own
   defect. The acceptance predicate for a fix to the enforcer MUST live outside the
   enforcer — that is `dod-fixture-selfcheck.sh`, run by a human. Any milestone that
   closes this DIR by citing the enforcer's own PASS, or by editing the fixtures to
   go green, has reproduced the disease and must be sent back.

4. **This DIR is a hard prerequisite of DIR-017 Step 2/3.** DIR-017's ordering makes
   Step 1's meta-enforcer the load-bearing foothold that must be human-confirmed
   *operative* before the remaining DoD clauses (escrow-Δv, test-floor) and leakage
   metrics proceed. Step #5 of that human-verification gate currently fails, so
   DIR-017 stays `pending` and Steps 2/3 stay blocked until THIS DIR's red test is
   green under human hands. Do not advance any further DoD clause until then.

5. **(Process note, not blocking this fix.)** This work was done concurrently with a
   running exp5 (mid-M29) using a private git worktree on a branch off `master`,
   because DIR-018/M23 isolated the loop's *branch* but not its *working tree* (the
   loop still commits to `exp5-outer-driver` in the shared main tree and checks out
   `master` there at publish). Consider capturing the "human works in a separate
   worktree off master, folds in at a deliberate clean window" pattern as an addendum
   to DIR-018, so future human steering is collision-free by construction.

## Resolution
<!-- added when moved to archive/, or updated in place if deferred:
- resolved_by: iteration-N / milestone M-NN
- outcome: applied | deferred | rejected
- evidence: dod-fixture-selfcheck.sh exits 0 with fixtures unchanged; pasted output -->

## Human verification when exp5 marks this DIR done

Do NOT trust the DONE mark, and do NOT trust the DoD enforcer's own PASS:
1. **The red test is green with fixtures unchanged.** Run
   `experiments/quay-perpetual-stream/scripts/dod-fixture-selfcheck.sh` yourself — it
   must exit 0, and `git log`/`git diff` on `fixtures/dod/self-exempt-*-stub.md` must
   show the fixtures were NOT altered to pass (the fix is in `it0-dod-check.mjs`, not
   the fixtures).
2. **The two self-exempt fixtures now individually FAIL the enforcer.** Run
   `it0-dod-check.sh M96-fake-linebudget-self-exempt fixtures/dod/self-exempt-linebudget-stub.md fixtures/dod/self-exempt-linebudget-stub.md`
   and the impl-row equivalent — each must exit 1 with a clause-5 message naming the
   exempted clause.
3. **Clauses 1/2 legitimate-non-firing still PASSes.** `compliant-stub.md` must still
   exit 0 — the fix must not turn documented no-ops into false failures.
4. **The runner is wired as a standing check**, not a one-shot — it re-runs on the
   same cadence as the other `it0-*` checks, so this blind spot cannot silently
   return.
5. Only after #1–#4 hold is DIR-017 step #5 satisfied; re-run DIR-017's full 6-point
   verification before greenlighting DIR-017 Steps 2/3.
