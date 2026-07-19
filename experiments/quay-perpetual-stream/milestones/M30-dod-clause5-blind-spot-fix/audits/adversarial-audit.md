# M30-dod-clause5-blind-spot-fix — Adversarial Audit (fresh-context, refutation-charged)

**Auditor role:** fresh-context adversarial auditor, charged to REFUTE, not re-derive or
rubber-stamp. Everything below was independently re-run from first principles; no prior claim
(including DIR-019's own Resolution section) was trusted without verification.

## VERDICT: NO REFUTATION FOUND — with 2 non-blocking CONCERNS

The fix is correct, narrowly scoped, and matches DIR-019's acceptance predicate exactly. No case
was found where the fix (a) fails to catch an undeclared line-budget/impl-row self-exemption, (b)
false-positives on a legitimate clause-1/2 no-op, or (c) blocks a genuinely-waivered clause-3/4
exemption. One real (but out-of-scope, pre-existing) coverage gap was found in the exemption-
language regex, and the process-deviation reasoning has a minor logical soft spot — both are
documented as CONCERNS, not refutations, because neither falls within DIR-019's stated scope or
acceptance predicate.

---

## 1. Code read: `scripts/it0-dod-check.mjs`, clause 5

Read in full. Confirmed structure matches DIR-019's description of both the bug and the fix:

- `dispositionedClauses` is populated unconditionally by clauses 3 (line-budget) and 4 (impl-row)
  on every run (`dispositionedClauses.add("line-budget")` / `.add("impl-row")` fire on both the
  try and catch paths — i.e. regardless of PASS/FAIL outcome), and conditionally by clauses 1/2
  (only when a disposition statement is actually found in the ABSORB text).
- Post-fix clause 5 logic:
  ```js
  const MECHANICALLY_UNCONDITIONAL_CLAUSES = new Set(["line-budget", "impl-row"]);
  ...
  if (dispositionedClauses.has(key) && !MECHANICALLY_UNCONDITIONAL_CLAUSES.has(key)) continue;
  ```
  This restricts the "already dispositioned ⇒ skip" carve-out to keys NOT in the unconditional
  set — i.e. only `adversarial-audit` and `V_meta consolidation-lag`. For `line-budget`/`impl-row`,
  the carve-out never applies, so the waiver-line check always runs when exemption language is
  detected for those two clauses. This is exactly what DIR-019 item 1 requested.

## 2. DIR-019 read in full

Read `experiments/quay-perpetual-stream/directives/archive/DIR-019-dod-clause5-blind-to-
unconditionally-dispositioned-gates-fix-and-external-red-test.md` end to end. Bug report, root
cause, requested fix (items 1-4), and Resolution section all read. Acceptance predicate per item 2:
"DIR-019 done" = `dod-fixture-selfcheck.sh` exits 0 with fixtures **unchanged**. Item 3 explicitly
forbids using the enforcer's own PASS as done-evidence.

## 3. `dod-fixture-selfcheck.sh` — independently run

```
$ bash experiments/quay-perpetual-stream/scripts/dod-fixture-selfcheck.sh; echo "EXIT: $?"
PASS: M98-fake-compliant — exit 0 (expected 0) [fixtures/dod/compliant-stub.md]
PASS: M99-fake-violating — exit 1 (expected 1) [fixtures/dod/violating-stub.md]
PASS: M96-fake-linebudget-self-exempt — exit 1 (expected 1) [fixtures/dod/self-exempt-linebudget-stub.md]
PASS: M95-fake-implrow-self-exempt — exit 1 (expected 1) [fixtures/dod/self-exempt-implrow-stub.md]

PASS: all 4 DoD fixtures behaved as asserted.
EXIT: 0
```
Matches DIR-019's required outcome exactly.

## 4. Fixture cleanliness — independently confirmed

```
$ git status --short experiments/quay-perpetual-stream/fixtures/dod/
(no output — clean)

$ git log --oneline -5 -- experiments/quay-perpetual-stream/fixtures/dod/
8432a67 DIR-019 (exp5): DoD clause-5 blind spot + external red test
a7b29dd Merge exp5-m25-iteration-0 into exp5-outer-driver: M25-dod-meta-enforcer
494c17b M25-dod-meta-enforcer iteration-1: DoD meta-enforcer (DIR-017 Step 1), independent re-derivation
e29142f M25-dod-meta-enforcer iteration-0: DoD meta-enforcer (DIR-017 Step 1)

$ git diff --stat 8432a67 HEAD -- experiments/quay-perpetual-stream/fixtures/dod/
(no output — no diff since fixtures were introduced)
```
The 4 fixtures (`compliant-stub.md`, `violating-stub.md`, `self-exempt-linebudget-stub.md`,
`self-exempt-implrow-stub.md`) were all introduced together in commit `8432a67` (the DIR-019
authoring commit itself, human-authored, off-loop). The M30 fix commit (`5c4be91`) touches ONLY
`scripts/it0-dod-check.mjs`:
```
$ git show --stat 5c4be91
 .../scripts/it0-dod-check.mjs | 24 ++++++++++++++--------
 1 file changed, 15 insertions(+), 9 deletions(-)
```
Confirmed: the fix lives entirely in the checker, not the test. No Goodhart risk found — this
satisfies DIR-019 item 3's explicit anti-Goodhart requirement.

## 5. Adversarial probes

### 5a. Fixture-driven checks (from `dod-fixture-selfcheck.sh`, individually re-run)

```
$ ./scripts/it0-dod-check.sh M98-fake-compliant fixtures/dod/compliant-stub.md fixtures/dod/compliant-stub.md
... PASS: DoD check passed — all clauses satisfied (5 disposition(s) confirmed) ...
EXIT: 0

$ ./scripts/it0-dod-check.sh M99-fake-violating fixtures/dod/violating-stub.md fixtures/dod/violating-stub.md
... FAIL: clause1-adversarial-audit ... FAIL: clause4-impl-row ...
FAIL: clause5-no-self-exemption: ... exempts "adversarial-audit" ... offending line: "- This
milestone is **exempt from the adversarial-audit gate** ..."
EXIT: 1

$ ./scripts/it0-dod-check.sh M96-fake-linebudget-self-exempt fixtures/dod/self-exempt-linebudget-stub.md fixtures/dod/self-exempt-linebudget-stub.md
FAIL: clause5-no-self-exemption: ... exempts "line-budget" ... offending line: "- This milestone
is **exempt from the line-budget gate** ..."
EXIT: 1

$ ./scripts/it0-dod-check.sh M95-fake-implrow-self-exempt fixtures/dod/self-exempt-implrow-stub.md fixtures/dod/self-exempt-implrow-stub.md
FAIL: clause5-no-self-exemption: ... exempts "impl-row" ... offending line: "- This milestone is
**exempt from the impl-row gate** ..."
EXIT: 1
```
`compliant-stub.md` (documented no-ops on clause 1/2, no exemption language) still exits 0 — the
fix did NOT turn a legitimate no-op into a false FAIL. `violating-stub.md` still exits 1 with the
same 3 violations as before (clause1, clause4, clause5-adversarial-audit) — no regression. Both
new self-exempt fixtures now correctly exit 1, each naming the exempted clause in the FAIL message,
per human-verification item 2's explicit requirement.

### 5b. Own throwaway fixture — WAIVER-present pass path (does the fix overcorrect?)

Constructed `/tmp/dod-audit/waiver-present.md`: a milestone that exempts `line-budget` in
"Explicitly OUT of scope" AND supplies a matching `WAIVER: M94-waiver-present | line-budget | ...`
line in the ABSORB-entry section.

```
$ ./scripts/it0-dod-check.sh M94-waiver-present /tmp/dod-audit/waiver-present.md /tmp/dod-audit/waiver-present.md
PASS: clause5-no-self-exemption: no undeclared self-exemption language found (or all found
exemptions have a matching WAIVER line)
EXIT: 0
```
Confirms the `waiverPattern` regex code path is still reachable and functions correctly for
clauses 3/4 under the new logic — the fix blocks only UNDECLARED exemptions, not all exemptions.
No overcorrection found.

### 5c. Own throwaway fixture — alternate exemption phrasing (CONCERN, not a refutation of the fix)

Constructed `/tmp/dod-audit/adv-phrasing.md` using phrasings not in the two shipped fixtures:
"skips the impl-row gate entirely" and "was bypassed" (vs. the fixtures' "exempt from ... gate").

```
$ ./scripts/it0-dod-check.sh M97-adv-phrase /tmp/dod-audit/adv-phrasing.md /tmp/dod-audit/adv-phrasing.md
PASS: clause5-no-self-exemption: no undeclared self-exemption language found ...
EXIT: 0   <-- should arguably be 1; both lines assert an undeclared exemption with no waiver
```
Root cause: `exemptionLangPattern = /\b(exempt|exempted|exempts|does not apply|skip the gate|
skips? this gate|not applicable to this gate)\b/i` requires the literal phrase "this gate" or "the
gate" (word-for-word) — "skips the impl-row gate" (naming the gate directly, no "this/the gate"
placeholder) and "was bypassed" do not match.

**This is a real coverage gap, but it is NOT part of DIR-019's fix or scope**, confirmed by git
blame:
```
$ git log -p --follow -- .../it0-dod-check.mjs | grep -n "exemptionLangPattern"
69:         if (pattern.test(rawLine) && exemptionLangPattern.test(rawLine)) {
344:+  const exemptionLangPattern = /\b(exempt|...)\b/i;
```
The regex was introduced verbatim in commit `8432a67` (DIR-019's own fixture-authoring commit,
the RED test itself) and is byte-identical in the pre-fix and post-fix versions of
`it0-dod-check.mjs` — M30's diff (`5c4be91`) never touches this line. DIR-019's stated bug was
specifically the `dispositionedClauses` carve-out being unreachable for clauses 3/4; it was never
about the exemption-language pattern's phrasing coverage. Filing as CONCERN, not REFUTED.

**CONCERN 1**: `exemptionLangPattern`'s phrasing coverage is narrower than a determined
self-exempter could exploit (e.g. "was bypassed", "skips the X gate" without "this/the gate").
Recommend a follow-up (not blocking M30) to broaden the regex or move to a semantic check.

## 6. Real M29 regression check

```
$ diff /tmp/m29-absorb-entry.md /tmp/m29-absorb-recheck.md; echo "diff exit: $?"
diff exit: 0
```
Both pre-existing `/tmp` files are identical, and independently confirmed to match
`dashboard.md`'s "## ABSORB m29" section content (read directly, lines 2473-2530+).

```
$ ./experiments/quay-perpetual-stream/scripts/it0-dod-check.sh exp5-M-QUAY-CLI-CREATE-ERGONOMICS \
    experiments/quay-perpetual-stream/charters/M29-cli-create-ergonomics.md /tmp/m29-absorb-recheck.md
PASS: clause1-adversarial-audit: disposition statement present (verdict)
PASS: clause2-vmeta-lag: disposition statement present
PASS: clause3-line-budget: PASS — ...
PASS: clause4-impl-row: PASS — ...
PASS: clause5-no-self-exemption: no undeclared self-exemption language found ...
PASS: DoD check passed — all clauses satisfied (5 disposition(s) confirmed), no undeclared self-exemption.
EXIT: 0
```
No regression against the real M29 milestone. Additionally verified this PASS is not accidentally
masking a real exemption: read M29's charter "Explicitly OUT of scope" section (lines 161-176) —
all listed items are genuine scope notes (GAP-007 latency, quay-native's own bug, other GAPs, other
milestones, scratch-tasks-directory discipline) with no clause name + exemption-language pairing.
Clause 5's PASS here is a true negative, not a blind spot.

## 7. Process-deviation evaluation (single-commit fix vs. two-iteration dispatch)

DIR-019's Resolution section self-discloses a deviation from "the standing two-iteration pattern"
(confirmed as the actual standing pattern by reading `inherited-core.md` line 392: "the existing
two-iteration build+verify template (iteration-0 builds, iteration-1 [independently re-derives])
... UNCHANGED"). This audit evaluates that reasoning adversarially:

**What holds up:**
- Reason (c) is verifiably true and load-bearing: DIR-019 item 3 explicitly forbids using the
  enforcer's own PASS as done-evidence, and `dod-fixture-selfcheck.sh` genuinely is an external,
  off-loop, human-authored, adversarially-designed acceptance predicate — confirmed independently
  in this audit (section 3-4). This is a real, non-circular verification substitute for at least
  the correctness-of-fix question.
- Reason (a) ("narrow and mechanical — one conditional... in a file already fully read this
  session") is consistent with what this audit found: the diff is genuinely minimal (15
  insertions, 9 deletions, one file, one logical change — confirmed in section 4/1).
- Empirically, in THIS instance, no quality defect traceable to skipping the second iteration was
  found (sections 3-6 all pass; the one real gap found, CONCERN 1, is a pre-existing regex-scope
  limitation predating M30, not something a second iteration would have plausibly caught either,
  since the pattern was authored in DIR-019's own commit, not M30's).

**Where the reasoning is weaker (CONCERN 2, not a refutation):**
- Reason (b) ("the acceptance predicate... is a stronger check than a second same-context agent
  re-deriving the same fix would be") conflates two different risk categories. An external red
  test is a strong check on WHETHER a given fix satisfies a specified I/O contract (correctness-
  of-fix), but the two-iteration pattern's actual value (per `inherited-core.md`'s own framing of
  iteration-1 as "independent skeptical re-derivation") is catching alternative-approach blind
  spots, scope-interpretation errors, and unstated assumptions the FIRST author didn't think to
  test for — exactly the category `dod-fixture-selfcheck.sh` cannot cover, because it was written
  BEFORE the fix, by the same reasoning process that diagnosed the bug, and encodes only the
  specific bug already found. A second independent agent might have asked, e.g., "is
  `exemptionLangPattern`'s phrasing coverage itself sufit ficient?" (this audit's CONCERN 1) or
  proposed a structurally different fix (e.g., splitting `dispositionedClauses` into two named sets
  at the point of population, rather than gating clause 5's read with an exception set) — a design
  simplification a same-context second pass might have surfaced but which a red test targeting the
  original bug cannot force. This doesn't mean the deviation was wrong here (the fix IS correct,
  confirmed above), but the STATED justification overclaims what the red test can substitute for.
  The Resolution section itself flags this as "left as an open question for that pass, not decided
  unilaterally" — which is the right epistemic posture, and this audit concurs it should remain
  open rather than be treated as settled precedent.
- Structural observation: no `charters/M30-*.md` file and no other content under
  `milestones/M30-dod-clause5-blind-spot-fix/` existed prior to this audit creating the `audits/`
  subdirectory — M30 has no charter, unlike M01-M29. This is consistent with (and further
  evidences) the self-disclosed single-commit-outside-normal-process nature of this fix, but it
  also means M30 lacks the artifact trail (charter, Done-when clauses, backlog row) that the DoD
  enforcer itself would require of any OTHER milestone — a mild irony given the fix's own subject
  matter, though not a defect in the fix's correctness.

**Conclusion on process deviation**: reasoned, self-disclosed, and not a silent skip — the explicit
"left as an open question" framing is appropriate. Reason (b) overclaims; reasons (a) and (c) are
sound and, combined with this audit's independent re-verification, are sufficient to accept the
outcome in THIS instance. Recommend NOT yet codifying "mechanical + externally-red-tested may skip
two-iteration dispatch" as a standing exception — treat as a one-off, per the Resolution's own
stated open-question framing, pending more instances.

## Summary of findings

| # | Item | Result |
|---|------|--------|
| 1 | Code reads as DIR-019 fix describes | Confirmed |
| 2 | DIR-019 read in full | Confirmed |
| 3 | `dod-fixture-selfcheck.sh` exits 0, 4/4 fixtures as asserted | Confirmed (independently run) |
| 4 | Fixtures unmodified (git status clean, diff since 8432a67 empty) | Confirmed |
| 5a | Individual fixture runs match required exit codes + FAIL messages | Confirmed |
| 5b | WAIVER-present case still PASSes (no overcorrection) | Confirmed (own fixture) |
| 5c | Alternate-phrasing self-exemption ("skips the gate", "bypassed") not caught | CONCERN 1 (pre-existing, out of DIR-019 scope) |
| 6 | Real M29 regression check still PASSes, 5/5 clauses | Confirmed |
| 7 | Process-deviation reasoning | Sound overall; reason (b) overclaims — CONCERN 2 |

**VERDICT: NO REFUTATION FOUND.** Two non-blocking CONCERNS logged (exemption-language regex
phrasing coverage; process-deviation reason (b) overclaim) — neither invalidates DIR-019's
acceptance predicate or this fix's correctness.
